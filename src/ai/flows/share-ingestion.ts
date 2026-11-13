/**
 * @fileOverview Genkit flow for Coaster Share Ingestion — parses shared drink notes,
 * bar receipts, tap lists, ABV bottle/can labels (text + optional photos) into
 * NIAAA Standard Drink Units logged to `food_log` and audited in `shared_data`.
 */

import { ai, CFO_LITE_MODEL, CFO_MODEL } from '@/ai/genkit';
import { trackAiUsage } from '@/lib/ai-usage';
import {
  calculateStandardUnits,
  formatUnits,
  getEntryUnits,
  isClearDayEntry,
  isZeroProofEntry,
  type CoasterFoodLogEntry,
  type DrinkCategory,
} from '@/lib/health-service';
import { inferMealFromTime } from '@/lib/food-exercise-types';
import { adminHealthService } from '@/lib/health-service-admin';
import { z } from 'genkit';
import { getAdminFirestore } from '@/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';

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

const SharedDrinkItemSchema = z.object({
  name: z.string().describe('Concise beverage or Clear Day label.'),
  drinkCategory: DrinkCategorySchema.default('other'),
  volumeOz: z.number().optional().describe('Total fluid volume in fl oz (convert mL via mL / 29.5735).'),
  abvPct: z.number().optional().describe('ABV percentage (0 for zero-proof or Clear Day).'),
  standardUnits: z
    .number()
    .describe('NIAAA Standard Drink Units: ((volumeOz * (abvPct / 100)) / 0.6) rounded to 1 decimal.'),
  isZeroProof: z.boolean().optional(),
  isClearDay: z.boolean().optional(),
  alternativeSuggested: z.string().optional(),
});

const ParsedShareDataSchema = z.object({
  domain: z
    .enum([
      'beverage',
      'clear_day',
      'zero_proof',
      'performance',
      'metabolic',
      'mixed',
      'unknown',
    ])
    .describe(
      'Use "beverage" for alcoholic pours/menus/receipts, "zero_proof" for NA drinks, "clear_day" for alcohol-free check-ins, or fallback domains.',
    ),
  category: z
    .string()
    .describe('Sub-category such as "craft_beer", "wine", "cocktail", "tap_list", "bar_receipt", "zero_proof", or "clear_day".'),
  summary: z
    .string()
    .describe('Warm 1-sentence Sunny summary confirming what was tallied on the coaster.'),
  totalStandardUnits: z
    .number()
    .optional()
    .describe('Sum of NIAAA Standard Drink Units across all parsed drinks (0 for clear_day / zero_proof).'),
  isClearDay: z.boolean().optional(),
  isZeroProof: z.boolean().optional(),
  drinksLogged: z
    .array(SharedDrinkItemSchema)
    .optional()
    .describe('Structured drink items extracted from shared text, URL title, or attached menu/bottle/receipt photo(s).'),
  foodLogIds: z.array(z.string()).optional(),
  // Optional legacy/fallback metric fields kept compatible for /incoming-share UI
  activityName: z.string().optional(),
  notes: z.string().optional(),
  rawText: z.string().describe('Original unmodified shared text or photo caption.'),
});

export type ParsedShareData = z.infer<typeof ParsedShareDataSchema>;

const SharePhotoAttachmentSchema = z.object({
  dataUri: z.string(),
  contentType: z.string().default('image/jpeg'),
});

const ShareIngestionInputSchema = z.object({
  userId: z.string(),
  rawText: z.string().describe('The raw shared text from the OS share sheet (or photo label).'),
  sourceTitle: z.string().optional(),
  sourceUrl: z.string().optional(),
  photoDataUris: z.array(SharePhotoAttachmentSchema).optional(),
  localDate: z.string().describe('YYYY-MM-DD from the client.'),
  localTime: z.string().describe('HH:MM from the client.'),
});

export type ShareIngestionInput = z.infer<typeof ShareIngestionInputSchema>;

const ShareIngestionOutputSchema = z.object({
  success: z.boolean(),
  documentId: z.string().optional(),
  parsed: ParsedShareDataSchema.optional(),
  error: z.string().optional(),
});

export type ShareIngestionOutput = z.infer<typeof ShareIngestionOutputSchema>;

const SHARE_PARSER_SYSTEM = `You are Sunny · Coaster's Share Target parser. You convert shared text, bar receipts, brewery/menu URLs, ABV can/bottle labels, or attached drink photos into NIAAA Standard Drink Units.

NIAAA FORMULA (1.0u = 14g / 0.6 fl oz pure ethanol):
- standardUnits = Math.round(((volumeOz * (abvPct / 100)) / 0.6) * 10) / 10
- Convert mL to fl oz via mL / 29.5735 (e.g. 750mL = 25.36oz, 355mL = 12oz, 473mL tallboy = 16oz).
- Zero-proof drinks (Athletic NA, HopTea, sparkling yuzu, Phony Negroni, mocktails): isZeroProof=true, standardUnits=0, drinkCategory='zero_proof', domain='zero_proof'.
- Clear days ("Clear day", "0 drinks"): isClearDay=true, standardUnits=0, drinkCategory='clear_day', domain='clear_day'.
- If the share contains multiple drinks on a receipt or round, emit each distinct drink in \`drinksLogged\`.
- Tone in \`summary\`: warm, friendly, non-judgmental Sunny voice — zero scolding, zero CFO/VF jargon, zero drunk jokes.`;

export const shareIngestionFlow = ai.defineFlow(
  {
    name: 'shareIngestionFlow',
    inputSchema: ShareIngestionInputSchema,
    outputSchema: ShareIngestionOutputSchema,
  },
  async (input) => {
    try {
      const photos = (input.photoDataUris ?? []).slice(0, 3);
      const combinedText = [
        input.sourceTitle ? `[Title: ${input.sourceTitle}]` : '',
        input.rawText || (photos.length > 0 ? '[Shared photo(s) from share sheet]' : ''),
        input.sourceUrl ? `[URL: ${input.sourceUrl}]` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const promptParts =
        photos.length > 0
          ? [
              ...photos.map((p) => ({ media: { url: p.dataUri, contentType: p.contentType } })),
              { text: combinedText },
            ]
          : combinedText;

      const generateConfig = {
        system: SHARE_PARSER_SYSTEM,
        prompt: promptParts,
        output: { schema: ParsedShareDataSchema },
        config: { temperature: 0.1 },
      };

      let llmResult;
      try {
        llmResult = await ai.generate({
          model: CFO_LITE_MODEL,
          ...generateConfig,
          use: [trackAiUsage({ uid: input.userId, feature: 'share_ingestion', model: CFO_LITE_MODEL })],
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[ShareIngestion] Primary model failed, trying fallback (${CFO_MODEL}):`, msg);
        llmResult = await ai.generate({
          model: CFO_MODEL,
          ...generateConfig,
          use: [trackAiUsage({ uid: input.userId, feature: 'share_ingestion', model: CFO_MODEL })],
        });
      }

      const { output } = llmResult;
      if (!output) {
        return { success: false, error: 'Could not parse shared drink data.' };
      }

      const normalizedDrinks = (output.drinksLogged ?? []).map((d) => {
        const isClear = Boolean(d.isClearDay) || d.drinkCategory === 'clear_day';
        const isZero = !isClear && (Boolean(d.isZeroProof) || d.drinkCategory === 'zero_proof');
        const computedUnits =
          isClear || isZero
            ? 0
            : typeof d.volumeOz === 'number' &&
                d.volumeOz > 0 &&
                typeof d.abvPct === 'number' &&
                d.abvPct >= 0
              ? calculateStandardUnits(d.volumeOz, d.abvPct)
              : Math.max(0, Math.round((d.standardUnits || 0) * 10) / 10);
        return {
          ...d,
          drinkCategory: (isClear
            ? 'clear_day'
            : isZero
              ? 'zero_proof'
              : d.drinkCategory ?? 'other') as DrinkCategory,
          standardUnits: computedUnits,
          isClearDay: isClear,
          isZeroProof: isZero,
        };
      });

      const firestore = getAdminFirestore();
      const foodLogIds: string[] = [];

      for (const drink of normalizedDrinks) {
        const entry = {
          name: drink.name,
          portionG: Math.max(0, Math.round((drink.volumeOz ?? 0) * 29.57)),
          calories: 0,
          proteinG: 0,
          carbsG: 0,
          fatG: 0,
          fiberG: 0,
          alcoholDrinks: drink.standardUnits,
          standardUnits: drink.standardUnits,
          drinkCategory: drink.drinkCategory,
          ...(drink.volumeOz !== undefined ? { volumeOz: drink.volumeOz } : {}),
          ...(drink.abvPct !== undefined ? { abvPct: drink.abvPct } : {}),
          isZeroProof: Boolean(drink.isZeroProof),
          isClearDay: Boolean(drink.isClearDay),
          ...(drink.alternativeSuggested
            ? { alternativeSuggested: drink.alternativeSuggested }
            : {}),
          source: 'user_estimate' as const,
          meal: inferMealFromTime(input.localTime),
          consumedAt: input.localTime,
          date: input.localDate,
        };
        const logId = await adminHealthService.logFood(
          firestore,
          input.userId,
          entry as unknown as Parameters<typeof adminHealthService.logFood>[2],
        );
        foodLogIds.push(logId);
      }

      if (foodLogIds.length > 0) {
        const todayEntries = (await adminHealthService.queryFoodLog(
          firestore,
          input.userId,
          input.localDate,
          60,
        )) as CoasterFoodLogEntry[];
        const dailyUnits =
          Math.round(todayEntries.reduce((s, e) => s + getEntryUnits(e), 0) * 10) / 10;
        await adminHealthService.updateHealthData(firestore, input.userId, {
          dailyAlcoholDrinks: dailyUnits,
          lastActiveDate: input.localDate,
        });
      }

      const totalStandardUnits =
        normalizedDrinks.length > 0
          ? Math.round(normalizedDrinks.reduce((s, d) => s + d.standardUnits, 0) * 10) / 10
          : Math.round((output.totalStandardUnits ?? 0) * 10) / 10;

      const parsed: ParsedShareData = {
        ...output,
        drinksLogged: normalizedDrinks,
        totalStandardUnits,
        foodLogIds,
        isClearDay:
          normalizedDrinks.length > 0
            ? normalizedDrinks.every((d) => isClearDayEntry(d))
            : output.isClearDay,
        isZeroProof:
          normalizedDrinks.length > 0
            ? normalizedDrinks.every((d) => isZeroProofEntry(d))
            : output.isZeroProof,
        summary:
          output.summary ||
          (normalizedDrinks.length > 0
            ? `Tallied ${normalizedDrinks.map((d) => d.name).join(', ')} (${formatUnits(totalStandardUnits)}).`
            : 'Saved shared note to your coaster.'),
        rawText: input.rawText,
      };

      const docData = {
        ...parsed,
        userId: input.userId,
        date: input.localDate,
        time: input.localTime,
        timestamp: FieldValue.serverTimestamp(),
        sourceTitle: input.sourceTitle || null,
        sourceUrl: input.sourceUrl || null,
        photoCount: photos.length,
        ingestedVia: 'share_target',
        ingestedAt: new Date().toISOString(),
      };

      const docRef = await firestore
        .collection(`users/${input.userId}/shared_data`)
        .add(docData);

      return {
        success: true,
        documentId: docRef.id,
        parsed,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[ShareIngestion] Error:', msg);
      return {
        success: false,
        error: msg || 'Unknown share parsing error.',
      };
    }
  },
);
