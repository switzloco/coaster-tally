/**
 * @fileOverview Cost-optimized 1-pass drink, tap-list & photo parser + Sunny reply
 * for Email & Discord Coaster check-ins.
 *
 * Uses a single `CFO_LITE_MODEL` call with zero tool-loop round-trips so inbound
 * replies stay ultra-fast and affordable while supporting plain English, bar receipts,
 * can/bottle ABV labels, and Clear Day check-ins.
 */

import { ai, CFO_LITE_MODEL, CFO_MODEL } from '@/ai/genkit';
import { z } from 'genkit';
import { trackAiUsage } from '@/lib/ai-usage';
import { inferMealFromTime } from '@/lib/food-exercise-types';
import {
  calculateStandardUnits,
  formatUnits,
  pickZeroProofAlternative,
  shouldSuggestAlternative,
  type DrinkCategory,
} from '@/lib/health-service';

const DrinkCategorySchema = z.enum([
  'beer',
  'ipa',
  'wine',
  'spirit',
  'cocktail',
  'seltzer',
  'zero_proof',
  'clear_day',
  'other',
]);

export const ParsedOutreachMealItemSchema = z.object({
  name: z
    .string()
    .describe(
      'Concise beverage or clear-day label, e.g. "2 Hazy IPAs (16oz 6.8%)", "Pinot Noir (5oz 13%)", "Phony Negroni (0.0u)", or "Clear Day".',
    ),
  drinkCategory: DrinkCategorySchema.optional().describe('Category of drink or clear_day/zero_proof.'),
  volumeOz: z
    .number()
    .optional()
    .describe('Total fluid volume in fl oz across all servings in this entry (convert mL via mL / 29.5735).'),
  abvPct: z
    .number()
    .optional()
    .describe('Alcohol by volume percentage (e.g. 5.0 for lager, 6.8 for hazy IPA, 12.5 for wine, 40.0 for spirit; 0 for zero-proof/clear day).'),
  standardUnits: z
    .number()
    .optional()
    .describe('NIAAA Standard Drink Units: ((volumeOz * (abvPct / 100)) / 0.6) rounded to 1 decimal. Always 0 for clear_day or zero_proof.'),
  isZeroProof: z
    .boolean()
    .optional()
    .describe('True if non-alcoholic / zero-proof drink (e.g. Athletic NA, HopTea, sparkling yuzu, Phony Negroni).'),
  isClearDay: z
    .boolean()
    .optional()
    .describe('True if this logs an alcohol-free clear day ("Clear day", "0 drinks today", "skipping drinks tonight").'),
  alternativeSuggested: z
    .string()
    .optional()
    .describe('Optional 1-line tasty zero-proof or lower-ABV swap tailored to what they enjoy.'),
  portionG: z.number().default(0).describe('Approximate liquid/portion grams if helpful; 0 allowed.'),
  calories: z.number().default(0).describe('Optional calories estimate; 0 if unknown.'),
  proteinG: z.number().default(0).describe('Optional protein grams; usually 0 for drinks.'),
  carbsG: z.number().default(0).describe('Optional carb grams; 0 if unknown.'),
  fatG: z.number().default(0).describe('Optional fat grams; usually 0 for drinks.'),
  fiberG: z.number().optional().describe('Optional dietary fiber grams.'),
  plantMassG: z.number().optional().describe('Optional botanical/fruit grams.'),
  alcoholDrinks: z.number().optional().describe('Standard Drink Units mirror for compatibility (= standardUnits).'),
  hasSeedOils: z.boolean().optional().describe('Unused for drinks; leave false/omitted.'),
  dayOffset: z
    .number()
    .optional()
    .describe('0 for today (default), -1 for yesterday / "last night". Never merge yesterday and today items.'),
  consumedAt: z
    .string()
    .optional()
    .describe('24-hour HH:MM when enjoyed (e.g. "last night" -> "20:30", "at 6pm" -> "18:00"); omit if just now.'),
  meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
  source: z.enum(['usda', 'user_estimate']).optional(),
});

export type ParsedOutreachMealItem = z.infer<typeof ParsedOutreachMealItemSchema>;

export const ParsedOutreachMealSchema = z.object({
  isFoodLog: z
    .boolean()
    .describe(
      'True if the message or attached photo describes drinks, pours, zero-proof swaps, or a Clear Day to log; false if unrelated, already logged, or a pure question.',
    ),
  isStopCommand: z
    .boolean()
    .describe('True if the user asks to stop, cancel, pause, opt out, or says "don\'t message me".'),
  scheduleMorningHour: z
    .number()
    .optional()
    .describe('If user asks to change morning check-in hour, 24-hour integer (5–11).'),
  scheduleMiddayHour: z
    .number()
    .optional()
    .describe('If user asks to add/change an afternoon check-in hour, 24-hour integer (11–16).'),
  scheduleNightHour: z
    .number()
    .optional()
    .describe('If user asks to change evening check-in hour, 24-hour integer (16–22).'),
  scheduleCadence: z
    .enum(['2x', 'daily', 'weekly', 'pause', '3x', 'morning_only'])
    .optional()
    .describe('If user asks to change check-in cadence ("2x", "daily", "weekly", "pause", "3x", "morning_only").'),
  scheduleTimezone: z
    .string()
    .optional()
    .describe('If user asks to change timezone (e.g. Eastern -> America/New_York, Pacific -> America/Los_Angeles).'),
  removeFoodId: z
    .string()
    .optional()
    .describe('If user asks to remove/undo a specific pour from Today or Yesterday Coaster Ledger, set exact id.'),
  name: z
    .string()
    .describe('Concise pour or Clear Day label (empty string if isFoodLog=false).'),
  drinkCategory: DrinkCategorySchema.optional(),
  volumeOz: z.number().optional(),
  abvPct: z.number().optional(),
  standardUnits: z.number().optional(),
  isZeroProof: z.boolean().optional(),
  isClearDay: z.boolean().optional(),
  alternativeSuggested: z.string().optional(),
  portionG: z.number().default(0),
  calories: z.number().default(0),
  proteinG: z.number().default(0),
  carbsG: z.number().default(0),
  fatG: z.number().default(0),
  fiberG: z.number().optional(),
  plantMassG: z.number().optional(),
  alcoholDrinks: z.number().optional(),
  hasSeedOils: z.boolean().optional(),
  dayOffset: z.number().optional().describe('0 for today (default), -1 for yesterday / "last night".'),
  consumedAt: z.string().optional().describe('24-hour HH:MM if user stated when they drank (e.g. "last night" -> "20:30").'),
  meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
  source: z.enum(['usda', 'user_estimate']).default('user_estimate'),
  entries: z
    .array(ParsedOutreachMealItemSchema)
    .optional()
    .describe(
      'One entry per distinct day or pour session. Split "last night" (dayOffset=-1, consumedAt="20:30") separately from "today" (dayOffset=0).',
    ),
  agentReply: z
    .string()
    .describe(
      'Warm, non-judgmental 1–2 sentence reply from Sunny (Coaster booth-buddy) confirming what was tallied or answering their question. Zero lecturing, zero clinical jargon, zero drunk jokes.',
    ),
});

export type ParsedOutreachMeal = z.infer<typeof ParsedOutreachMealSchema>;

/**
 * Strips quoted email threads ("On Nov 11, 2026 ... wrote:", "> " lines, signatures)
 * so only the user's fresh reply text is evaluated.
 */
export function extractCleanReplyText(rawText: string): string {
  if (!rawText) return '';
  const normalized = rawText
    .replace(/\r\n/g, '\n')
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/\nOn [\s\S]{10,260}?wrote:\s*\n[\s\S]*$/i, '');

  const lines = normalized.split('\n');
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^On .+wrote:$/i.test(trimmed)) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(trimmed)) break;
    if (/^From:\s+.+@/i.test(trimmed)) break;
    if (/^Sent from my (iPhone|Android|Galaxy|Pixel)/i.test(trimmed)) break;
    if (trimmed === '--') break;
    if (trimmed.startsWith('>')) continue;
    kept.push(line);
  }

  return kept.join('\n').trim().slice(0, 800);
}

/**
 * Deterministic check for stop/unsubscribe replies before spending any LLM tokens.
 */
export function isExplicitStopKeyword(cleanText: string): boolean {
  const lower = cleanText.trim().toLowerCase();
  if (/^(stop|unsubscribe|cancel|quit|end|off|pause|opt\s*out|remove\s*me)\b[.!]*$/i.test(lower)) {
    return true;
  }
  return /\b(don'?t|do\s+not|stop)\s+(message|dm|ping|email|text|contact)(?:ing)?\s+me\b/i.test(
    lower,
  );
}

const OUTREACH_DRINK_SYSTEM = `You are Sunny ("Sunny · Coaster") — a warm, upbeat, non-drinking booth-buddy who keeps tally of Standard Drink Units without judgment, lectures, scoring, or pressure.

PERSONA & HUMOR RULES:
- Treat every check-in with warmth and curiosity, whether the user had 3 double IPAs, 1 glass of pinot noir, a Phony Negroni, or a Clear Day.
- Light humor may playfully tease pretentious tasting notes ("hints of wet river stone"), wild craft beer names, or giant martini glasses — NEVER tease or joke about the user drinking too much or getting drunk.
- When asked for a swap OR when \`suggestZeroProofSwap\` is YES, include one genuinely delicious zero-proof or lower-ABV recommendation tailored to their taste in \`alternativeSuggested\` (and briefly mention it naturally in \`agentReply\`).

NIAAA STANDARD DRINK UNIT RULES (1.0u = 14g ethanol = 0.6 fl oz pure ethanol):
- Formula: standardUnits = Math.round(((volumeOz * (abvPct / 100)) / 0.6) * 10) / 10
- Benchmarks:
  • Light / classic beer (12oz @ 5.0% ABV) = 1.0u
  • Hazy / Craft IPA (16oz pint @ 6.8% ABV) = 1.8u (2 pints = 32oz @ 6.8% = 3.6u!)
  • Double IPA (16oz @ 8.5% ABV) = 2.3u
  • Wine (5oz @ 12.0% ABV) = 1.0u; generous restaurant pour (6oz @ 13.5% ABV) = 1.4u; bottle (750mL ≈ 25.36oz @ 13% ABV) = 5.5u
  • Spirit / Shot (1.5oz @ 40.0% ABV) = 1.0u; doubles = 2.0u
  • Cocktails: estimate total spirit oz & ABV (e.g. classic Negroni/Old Fashioned ≈ 1.4u–1.7u; skinny margarita ≈ 1.0u–1.2u)
  • Zero-proof drinks (Athletic NA, HopTea, sparkling yuzu, mocktails, soda water): isZeroProof=true, drinkCategory='zero_proof', standardUnits=0
  • Clear day ("clear day", "0 drinks", "dry day", "skipped tonight"): isFoodLog=true, isClearDay=true, drinkCategory='clear_day', standardUnits=0, name='Clear Day'

CHECK-IN PARSING RULES:
1. STOP / UNSUBSCRIBE: If the user asks to stop, pause, cancel, or unsubscribe, set isStopCommand=true, isFoodLog=false, and reply warmly: "Done — I've paused your Coaster check-ins. Whenever you want to pull up a stool again, just say the word."
2. SCHEDULE CHANGES: Populate scheduleMorningHour / scheduleMiddayHour / scheduleNightHour / scheduleCadence ('2x' | 'daily' | 'weekly' | 'pause' | '3x' | 'morning_only') / scheduleTimezone if requested.
3. MULTI-DAY SPLITTING (CRITICAL):
   - NEVER merge drinks from "last night" / "yesterday" with drinks from "today" / "this evening" into one entry!
   - For "last night" / "yesterday": set \`dayOffset: -1\`, \`consumedAt: "20:30"\` (or stated time).
   - For today / tonight / now: set \`dayOffset: 0\` and \`consumedAt\` to stated time or current localTime.
4. DUPLICATE CHECK:
   - Check \`Today's Coaster Ledger\` and \`Yesterday's Coaster Ledger\` before logging. If they ask whether something was already logged and it is already on the ledger, set isFoodLog=false (or only log missing drinks) and clarify gently in agentReply.
5. PHOTOS:
   - If a photo is attached (bar receipt, cocktail menu, tap list, wine glass, can/bottle label), extract the drink name(s), oz/mL volume, and ABV% directly from the label or pour size.
6. QUESTIONS / UNDO:
   - If asking a question about totals/trends/swaps without logging a drink, set isFoodLog=false and answer warmly in agentReply.
   - If asking to remove a specific logged entry, set \`removeFoodId\` to its exact id.`;

export interface OutreachImageAttachment {
  dataUri: string;
  contentType: string;
}

export interface OutreachLedgerContextItem {
  id?: string;
  name: string;
  calories?: number;
  proteinG?: number;
  plantMassG?: number;
  standardUnits?: number;
  alcoholDrinks?: number;
  drinkCategory?: DrinkCategory;
  isClearDay?: boolean;
  isZeroProof?: boolean;
  consumedAt?: string;
  date?: string;
}

export function resolveEntryConsumedAt(params: {
  dayOffset: number;
  meal?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  explicitConsumedAt?: string;
  localTime: string;
}): string {
  const cleanExplicit = params.explicitConsumedAt?.trim();
  if (cleanExplicit && /^\d{1,2}:\d{2}$/.test(cleanExplicit)) {
    const [h, m] = cleanExplicit.split(':');
    const formatted = `${String(Number(h)).padStart(2, '0')}:${m}`;
    // Guard against the LLM copying a morning localTime onto a "last night" entry
    if (
      params.dayOffset < 0 &&
      formatted === params.localTime &&
      Number(h) < 15 &&
      params.meal !== 'breakfast' &&
      params.meal !== 'lunch'
    ) {
      return '20:30';
    }
    return formatted;
  }
  if (params.dayOffset < 0) {
    if (params.meal === 'breakfast') return '08:30';
    if (params.meal === 'lunch') return '12:30';
    return '20:30';
  }
  return params.localTime;
}

function normalizeParsedDrinkItem(
  item: ParsedOutreachMealItem,
  localTime: string,
  defaultSource: 'usda' | 'user_estimate',
): ParsedOutreachMealItem {
  const dayOffset = item.dayOffset && item.dayOffset < 0 ? -1 : 0;
  const resolvedTime = resolveEntryConsumedAt({
    dayOffset,
    meal: item.meal,
    explicitConsumedAt: item.consumedAt,
    localTime,
  });

  const isClear =
    Boolean(item.isClearDay) ||
    item.drinkCategory === 'clear_day' ||
    /\bclear\s*day\b/i.test(item.name);
  const isZero =
    !isClear &&
    (Boolean(item.isZeroProof) || item.drinkCategory === 'zero_proof');

  let units = 0;
  if (!isClear && !isZero) {
    if (
      typeof item.volumeOz === 'number' &&
      item.volumeOz > 0 &&
      typeof item.abvPct === 'number' &&
      item.abvPct >= 0
    ) {
      units = calculateStandardUnits(item.volumeOz, item.abvPct);
    } else if (typeof item.standardUnits === 'number' && Number.isFinite(item.standardUnits)) {
      units = Math.max(0, Math.round(item.standardUnits * 10) / 10);
    } else if (typeof item.alcoholDrinks === 'number' && Number.isFinite(item.alcoholDrinks)) {
      units = Math.max(0, Math.round(item.alcoholDrinks * 10) / 10);
    }
  }

  return {
    ...item,
    name: item.name.trim(),
    drinkCategory: isClear
      ? 'clear_day'
      : isZero
        ? 'zero_proof'
        : item.drinkCategory ?? 'other',
    standardUnits: units,
    alcoholDrinks: units,
    isClearDay: isClear,
    isZeroProof: isZero,
    portionG: item.portionG ?? 0,
    calories: item.calories ?? 0,
    proteinG: item.proteinG ?? 0,
    carbsG: item.carbsG ?? 0,
    fatG: item.fatG ?? 0,
    dayOffset,
    consumedAt: resolvedTime,
    meal: item.meal ?? inferMealFromTime(resolvedTime),
    source: item.source ?? defaultSource,
  };
}

function formatLedgerLine(f: OutreachLedgerContextItem, idx: number): string {
  const units =
    f.isClearDay || f.isZeroProof
      ? 0
      : f.standardUnits ?? f.alcoholDrinks ?? 0;
  const tag = f.isClearDay
    ? 'Clear Day (0.0u)'
    : f.isZeroProof
      ? 'Zero-Proof (0.0u)'
      : formatUnits(units);
  return `#${idx + 1} [id=${f.id || 'none'}] ${f.consumedAt || ''} ${f.name} (${tag})`;
}

export async function parseOutreachMealText(params: {
  uid: string;
  rawText: string;
  localTime: string;
  photoDataUris?: OutreachImageAttachment[];
  todayFoods?: OutreachLedgerContextItem[];
  yesterdayFoods?: OutreachLedgerContextItem[];
  proteinGoal?: number;
  clientDisplayName?: string;
  alcoholicLogCount?: number;
}): Promise<ParsedOutreachMeal> {
  const cleanText = extractCleanReplyText(params.rawText);
  const photos = (params.photoDataUris ?? []).slice(0, 3);
  const hasPhotos = photos.length > 0;

  if (!cleanText && !hasPhotos) {
    return {
      isFoodLog: false,
      isStopCommand: false,
      name: '',
      standardUnits: 0,
      alcoholDrinks: 0,
      portionG: 0,
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      source: 'user_estimate',
      agentReply:
        'Just tell me what you poured (or snap a tap list, can, or receipt) and I will put it on your coaster.',
    };
  }

  if (!hasPhotos && isExplicitStopKeyword(cleanText)) {
    return {
      isFoodLog: false,
      isStopCommand: true,
      name: '',
      standardUnits: 0,
      alcoholDrinks: 0,
      portionG: 0,
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      source: 'user_estimate',
      agentReply:
        "Done — I've paused your Coaster check-ins. Whenever you want to pull up a stool again, just say the word.",
    };
  }

  const todayLines = (params.todayFoods ?? []).map(formatLedgerLine);
  const todayUnits = Math.round(
    (params.todayFoods ?? []).reduce(
      (s, f) => s + (f.isClearDay || f.isZeroProof ? 0 : f.standardUnits ?? f.alcoholDrinks ?? 0),
      0,
    ) * 10,
  ) / 10;
  const todayLedgerContext =
    todayLines.length > 0
      ? `Today's Coaster Ledger (${todayLines.length} entry/entries, ${formatUnits(todayUnits)} total):\n${todayLines.join('\n')}`
      : `Today's Coaster Ledger: 0 entries logged today (0.0u).`;

  const yesterdayLines = (params.yesterdayFoods ?? []).map(formatLedgerLine);
  const yesterdayUnits = Math.round(
    (params.yesterdayFoods ?? []).reduce(
      (s, f) => s + (f.isClearDay || f.isZeroProof ? 0 : f.standardUnits ?? f.alcoholDrinks ?? 0),
      0,
    ) * 10,
  ) / 10;
  const yesterdayLedgerContext =
    yesterdayLines.length > 0
      ? `Yesterday's Coaster Ledger (${yesterdayLines.length} entry/entries, ${formatUnits(yesterdayUnits)} total):\n${yesterdayLines.join('\n')}`
      : `Yesterday's Coaster Ledger: 0 entries logged yesterday.`;

  const clientNameLine = params.clientDisplayName?.trim()
    ? `Friend's name: ${params.clientDisplayName.trim()} (greet them warmly when natural)\n`
    : '';
  const swapAsked = /\b(swap|alternative|zero[- ]?proof|mocktail|na\b|non[- ]?alcoholic|lower abv|something else)\b/i.test(
    cleanText,
  );
  const suggestZeroProofSwap = shouldSuggestAlternative(
    (params.alcoholicLogCount ?? 0) + 1,
    swapAsked,
  );
  const swapHintLine = `suggestZeroProofSwap: ${suggestZeroProofSwap ? 'YES (include one crisp tailored recommendation in alternativeSuggested)' : 'NO (skip alternativeSuggested unless explicitly asked)'}\n`;
  const ledgerContext = `${clientNameLine}${swapHintLine}${todayLedgerContext}\n${yesterdayLedgerContext}`;

  const textPrompt = cleanText
    ? `Local time: ${params.localTime}\n${ledgerContext}\nFriend message: "${cleanText}"`
    : `Local time: ${params.localTime}\n${ledgerContext}\nFriend attached ${photos.length} photo(s) (bottle, can, glass, menu, or receipt) with no text — identify the drink(s), volume oz, and ABV% and calculate Standard Drink Units.`;

  const promptParts = hasPhotos
    ? [
        ...photos.map((p) => ({ media: { url: p.dataUri, contentType: p.contentType } })),
        { text: textPrompt },
      ]
    : textPrompt;

  const genOptions = {
    system: OUTREACH_DRINK_SYSTEM,
    prompt: promptParts,
    output: { schema: ParsedOutreachMealSchema },
    config: { temperature: 0.15 },
  };

  let result;
  try {
    result = await ai.generate({
      ...genOptions,
      model: CFO_LITE_MODEL,
      use: [trackAiUsage({ uid: params.uid, feature: 'outreach_meal_parse', model: CFO_LITE_MODEL })],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[OutreachDrinkParser] ${CFO_LITE_MODEL} failed, falling back to ${CFO_MODEL}:`, msg);
    result = await ai.generate({
      ...genOptions,
      model: CFO_MODEL,
      use: [trackAiUsage({ uid: params.uid, feature: 'outreach_meal_parse', model: CFO_MODEL })],
    });
  }

  const output = result.output;
  if (!output) {
    throw new Error('Could not parse check-in reply.');
  }

  const defaultSource = output.source ?? 'user_estimate';
  const rawEntries = (output.entries ?? []).filter((e) => e && e.name && e.name.trim().length > 0);
  const normalizedEntries: ParsedOutreachMealItem[] =
    rawEntries.length > 0
      ? rawEntries.map((entry) => normalizeParsedDrinkItem(entry, params.localTime, defaultSource))
      : output.isFoodLog && output.name?.trim()
        ? [
            normalizeParsedDrinkItem(
              {
                name: output.name.trim(),
                drinkCategory: output.drinkCategory,
                volumeOz: output.volumeOz,
                abvPct: output.abvPct,
                standardUnits: output.standardUnits,
                isZeroProof: output.isZeroProof,
                isClearDay: output.isClearDay,
                alternativeSuggested: output.alternativeSuggested,
                portionG: output.portionG ?? 0,
                calories: output.calories ?? 0,
                proteinG: output.proteinG ?? 0,
                carbsG: output.carbsG ?? 0,
                fatG: output.fatG ?? 0,
                fiberG: output.fiberG,
                plantMassG: output.plantMassG,
                alcoholDrinks: output.alcoholDrinks,
                hasSeedOils: output.hasSeedOils,
                dayOffset: output.dayOffset,
                consumedAt: output.consumedAt,
                meal: output.meal,
                source: defaultSource,
              },
              params.localTime,
              defaultSource,
            ),
          ]
        : [];

  const primary = normalizedEntries[0];
  const resolvedPrimaryTime =
    primary?.consumedAt ||
    resolveEntryConsumedAt({
      dayOffset: output.dayOffset && output.dayOffset < 0 ? -1 : 0,
      meal: output.meal,
      explicitConsumedAt: output.consumedAt,
      localTime: params.localTime,
    });

  const totalUnits =
    normalizedEntries.length > 0
      ? Math.round(normalizedEntries.reduce((s, e) => s + (e.standardUnits || 0), 0) * 10) / 10
      : Math.round((output.standardUnits ?? output.alcoholDrinks ?? 0) * 10) / 10;

  const hasAlcoholicLog = normalizedEntries.some(
    (e) => !e.isClearDay && !e.isZeroProof && (e.standardUnits ?? 0) > 0,
  );
  const resolvedSwap =
    output.alternativeSuggested ||
    primary?.alternativeSuggested ||
    (hasAlcoholicLog && suggestZeroProofSwap
      ? pickZeroProofAlternative(primary?.drinkCategory, params.alcoholicLogCount ?? 0)
      : undefined);

  return {
    ...output,
    isFoodLog: output.isFoodLog && normalizedEntries.length > 0,
    name:
      normalizedEntries.length > 1
        ? normalizedEntries.map((e) => e.name).join(' · ')
        : primary?.name || output.name || '',
    drinkCategory: primary?.drinkCategory ?? output.drinkCategory,
    volumeOz:
      normalizedEntries.length > 0
        ? Math.round(normalizedEntries.reduce((s, e) => s + (e.volumeOz || 0), 0) * 10) / 10
        : output.volumeOz,
    abvPct: primary?.abvPct ?? output.abvPct,
    standardUnits: totalUnits,
    alcoholDrinks: totalUnits,
    isZeroProof:
      normalizedEntries.length > 0
        ? normalizedEntries.every((e) => Boolean(e.isZeroProof))
        : output.isZeroProof,
    isClearDay:
      normalizedEntries.length > 0
        ? normalizedEntries.every((e) => Boolean(e.isClearDay))
        : output.isClearDay,
    alternativeSuggested: resolvedSwap,
    portionG:
      normalizedEntries.length > 0
        ? normalizedEntries.reduce((s, e) => s + (e.portionG || 0), 0)
        : output.portionG ?? 0,
    calories:
      normalizedEntries.length > 0
        ? normalizedEntries.reduce((s, e) => s + (e.calories || 0), 0)
        : output.calories ?? 0,
    proteinG:
      normalizedEntries.length > 0
        ? normalizedEntries.reduce((s, e) => s + (e.proteinG || 0), 0)
        : output.proteinG ?? 0,
    carbsG:
      normalizedEntries.length > 0
        ? normalizedEntries.reduce((s, e) => s + (e.carbsG || 0), 0)
        : output.carbsG ?? 0,
    fatG:
      normalizedEntries.length > 0
        ? normalizedEntries.reduce((s, e) => s + (e.fatG || 0), 0)
        : output.fatG ?? 0,
    dayOffset: primary?.dayOffset ?? (output.dayOffset && output.dayOffset < 0 ? -1 : 0),
    consumedAt: resolvedPrimaryTime,
    meal: primary?.meal ?? output.meal ?? inferMealFromTime(resolvedPrimaryTime),
    entries: normalizedEntries,
  };
}
