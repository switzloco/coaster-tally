/**
 * @fileOverview NIAAA Standard Drink Unit math, quick-pour presets, Sunny's swap
 * suggestions, and pure time-series aggregations for Coaster.
 *
 * 1.0 NIAAA Standard Drink = 14 grams pure ethanol = 0.6 fl oz pure alcohol.
 */

import type {
  DailyLog,
  DashboardSummary,
  DrinkCategory,
  FoodLogEntry,
} from './food-exercise-types';

export type { DrinkCategory };

export const PURE_ALCOHOL_OZ_PER_STANDARD_DRINK = 0.6;
export const GRAMS_PER_STANDARD_DRINK = 14;
export const ML_PER_FL_OZ = 29.5735;

export interface DrinkPreset {
  id: string;
  label: string;
  shortLabel: string;
  category: DrinkCategory;
  volumeOz: number;
  abvPct: number;
  units: number;
  zeroProof?: boolean;
  clearDay?: boolean;
}

/**
 * Computes NIAAA Standard Drink Units from fluid ounces and ABV%, rounded to 1 decimal place.
 * Clamped >= 0 and safe against NaN, Infinity, or negative inputs.
 */
export function calculateStandardUnits(volumeOz: number, abvPct: number): number {
  if (!Number.isFinite(volumeOz) || !Number.isFinite(abvPct) || volumeOz <= 0 || abvPct <= 0) {
    return 0;
  }
  const pureOz = volumeOz * (abvPct / 100);
  const rawUnits = pureOz / PURE_ALCOHOL_OZ_PER_STANDARD_DRINK;
  return Math.max(0, Math.round((rawUnits + 1e-9) * 10) / 10);
}

/** Converts milliliters to US fluid ounces (rounded to 2 decimal places). */
export function mlToOz(ml: number): number {
  if (!Number.isFinite(ml) || ml <= 0) return 0;
  return Math.max(0, Math.round((ml / ML_PER_FL_OZ) * 100) / 100);
}

/** Converts NIAAA Standard Drink Units to grams of pure ethanol (14g per 1.0u). */
export function standardUnitsToGrams(units: number): number {
  if (!Number.isFinite(units) || units <= 0) return 0;
  return Math.max(0, Math.round((units * GRAMS_PER_STANDARD_DRINK + 1e-9) * 10) / 10);
}

/** Formats Standard Drink Units cleanly, e.g. "1.5u" or "0.0u". */
export function formatUnits(units: number): string {
  if (!Number.isFinite(units) || units <= 0) return '0.0u';
  const rounded = Math.max(0, Math.round((units + 1e-9) * 10) / 10);
  return `${rounded.toFixed(1)}u`;
}

export const DRINK_PRESETS: DrinkPreset[] = [
  {
    id: 'light-beer',
    label: 'Light Beer (12 oz · 4.2%)',
    shortLabel: 'Light Beer',
    category: 'beer',
    volumeOz: 12,
    abvPct: 4.2,
    units: calculateStandardUnits(12, 4.2), // 0.8u
  },
  {
    id: 'lager',
    label: 'Pilsner / Lager (12 oz · 5%)',
    shortLabel: 'Beer',
    category: 'beer',
    volumeOz: 12,
    abvPct: 5.0,
    units: calculateStandardUnits(12, 5.0), // 1.0u
  },
  {
    id: 'craft-ipa',
    label: 'Craft IPA Pint (16 oz · 7%)',
    shortLabel: 'Craft IPA',
    category: 'beer',
    volumeOz: 16,
    abvPct: 7.0,
    units: calculateStandardUnits(16, 7.0), // 1.9u
  },
  {
    id: 'wine',
    label: 'Table Wine (5 oz · 12%)',
    shortLabel: 'Wine',
    category: 'wine',
    volumeOz: 5,
    abvPct: 12.0,
    units: calculateStandardUnits(5, 12.0), // 1.0u
  },
  {
    id: 'bold-wine',
    label: 'Bold Red Wine (6 oz · 14.5%)',
    shortLabel: 'Bold Wine',
    category: 'wine',
    volumeOz: 6,
    abvPct: 14.5,
    units: calculateStandardUnits(6, 14.5), // 1.5u
  },
  {
    id: 'spirit-shot',
    label: 'Spirit Neat / Shot (1.5 oz · 40%)',
    shortLabel: 'Spirit',
    category: 'spirits',
    volumeOz: 1.5,
    abvPct: 40.0,
    units: calculateStandardUnits(1.5, 40.0), // 1.0u
  },
  {
    id: 'cocktail',
    label: 'Classic Cocktail (4 oz · ~30%)',
    shortLabel: 'Cocktail',
    category: 'cocktail',
    volumeOz: 4,
    abvPct: 30.0,
    units: calculateStandardUnits(4, 30.0), // 2.0u
  },
  {
    id: 'seltzer',
    label: 'Hard Seltzer (12 oz · 5%)',
    shortLabel: 'Seltzer',
    category: 'seltzer',
    volumeOz: 12,
    abvPct: 5.0,
    units: calculateStandardUnits(12, 5.0), // 1.0u
  },
  {
    id: 'zero-proof',
    label: 'Zero-Proof Swap (12 oz · 0%)',
    shortLabel: 'Zero-Proof',
    category: 'zero-proof',
    volumeOz: 12,
    abvPct: 0,
    units: 0.0,
    zeroProof: true,
  },
  {
    id: 'clear-day',
    label: 'Clear Day (Alcohol-Free · 0.0u)',
    shortLabel: 'Clear Day',
    category: 'clear-day',
    volumeOz: 0,
    abvPct: 0,
    units: 0.0,
    clearDay: true,
  },
];

export interface DailyDrinkPoint {
  dateKey: string;
  label: string;
  units: number;
  sevenDayAvg: number;
  drinkCount: number;
  zeroProofCount: number;
  isClearDay: boolean;
}

export interface WeeklyDrinkPoint {
  weekStart: string;
  label: string;
  totalUnits: number;
  dailyAvg: number;
  clearDays: number;
  drinkCount: number;
}

export interface DayOfWeekPoint {
  dayIndex: number;
  dayLabel: string;
  avgUnits: number;
  totalUnits: number;
  sampleDays: number;
}

export interface TrendSummary {
  todayUnits: number;
  sevenDayTotal: number;
  sevenDayAvg: number;
  thirtyDayTotal: number;
  thirtyDayAvg: number;
  ninetyDayTotal: number;
  clearDaysLast30: number;
  zeroProofSwapsLast30: number;
  rollingVsPriorPct: number | null;
}

function round1(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + 1e-9) * 10) / 10;
}

/** Returns local YYYY-MM-DD for the current clock. */
export function getLocalDateKey(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA');
}

function parseIsoUtc(isoDate: string): Date {
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    const today = getLocalDateKey().split('-').map(Number);
    return new Date(Date.UTC(today[0], today[1] - 1, today[2]));
  }
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

/** Shifts a YYYY-MM-DD date key cleanly in UTC without local-DST drift. */
export function addIsoDays(isoDate: string, deltaDays: number): string {
  const dt = parseIsoUtc(isoDate);
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function formatShortUtcDate(isoDate: string): string {
  return parseIsoUtc(isoDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Returns true if an entry marks an explicit Clear Day (alcohol-free check-in). */
export function isClearDayEntry(entry: FoodLogEntry): boolean {
  if (!entry || entry.ignored) return false;
  if (entry.isClearDay === true || entry.drinkCategory === 'clear-day') {
    return true;
  }
  if (entry.meal === 'clear-day' && !(typeof entry.standardUnits === 'number' && entry.standardUnits > 0)) {
    return true;
  }
  return false;
}

/** Returns true if an entry is a zero-proof / non-alcoholic beverage swap. */
export function isZeroProofEntry(entry: FoodLogEntry): boolean {
  if (!entry || entry.ignored || isClearDayEntry(entry)) return false;
  return entry.isZeroProof === true || entry.drinkCategory === 'zero-proof';
}

/**
 * Extracts NIAAA Standard Drink Units for a ledger entry.
 * Supports Coaster `standardUnits`, legacy `alcoholDrinks`, and `volumeOz` + `abvPct`.
 */
export function getEntryUnits(entry: FoodLogEntry): number {
  if (!entry || entry.ignored) return 0;
  if (isClearDayEntry(entry) || isZeroProofEntry(entry)) return 0;

  if (typeof entry.standardUnits === 'number' && Number.isFinite(entry.standardUnits)) {
    return Math.max(0, round1(entry.standardUnits));
  }
  if (typeof entry.alcoholDrinks === 'number' && Number.isFinite(entry.alcoholDrinks)) {
    return Math.max(0, round1(entry.alcoholDrinks));
  }
  if (
    typeof entry.volumeOz === 'number' &&
    typeof entry.abvPct === 'number' &&
    Number.isFinite(entry.volumeOz) &&
    Number.isFinite(entry.abvPct)
  ) {
    return calculateStandardUnits(entry.volumeOz, entry.abvPct);
  }
  return 0;
}

interface DayAggregate {
  units: number;
  drinkCount: number;
  zeroProofCount: number;
  hasClearDayMarker: boolean;
  isClearDay: boolean;
}

function aggregateByDate(logs: FoodLogEntry[]): Map<string, DayAggregate> {
  const map = new Map<string, DayAggregate>();
  for (const entry of logs) {
    if (!entry || entry.ignored || !entry.date) continue;
    const dateKey = String(entry.date).slice(0, 10);
    let agg = map.get(dateKey);
    if (!agg) {
      agg = {
        units: 0,
        drinkCount: 0,
        zeroProofCount: 0,
        hasClearDayMarker: false,
        isClearDay: false,
      };
      map.set(dateKey, agg);
    }

    if (isClearDayEntry(entry)) {
      agg.hasClearDayMarker = true;
    } else if (isZeroProofEntry(entry)) {
      agg.zeroProofCount += 1;
    } else {
      const u = getEntryUnits(entry);
      if (u > 0) {
        agg.units = round1(agg.units + u);
        agg.drinkCount += 1;
      }
    }
  }

  for (const agg of map.values()) {
    agg.isClearDay = agg.hasClearDayMarker && agg.units === 0;
  }

  return map;
}

const EMPTY_DAY: DayAggregate = {
  units: 0,
  drinkCount: 0,
  zeroProofCount: 0,
  hasClearDayMarker: false,
  isClearDay: false,
};

/**
 * Computes chronological daily series (`days` ending at `anchorDateKey`) with 7-day rolling average.
 */
export function computeDailyTrendSeries(
  logs: FoodLogEntry[],
  days: number = 30,
  anchorDateKey?: string
): DailyDrinkPoint[] {
  const count = Math.max(1, Math.round(days));
  const anchor = anchorDateKey || getLocalDateKey();
  const byDate = aggregateByDate(logs);
  const start = addIsoDays(anchor, -(count - 1));

  const points: DailyDrinkPoint[] = [];
  for (let i = 0; i < count; i++) {
    const dateKey = addIsoDays(start, i);
    const dayAgg = byDate.get(dateKey) ?? EMPTY_DAY;

    let rollingSum = 0;
    for (let offset = 0; offset < 7; offset++) {
      const lookbackKey = addIsoDays(dateKey, -offset);
      rollingSum += byDate.get(lookbackKey)?.units ?? 0;
    }

    points.push({
      dateKey,
      label: formatShortUtcDate(dateKey),
      units: round1(dayAgg.units),
      sevenDayAvg: round1(rollingSum / 7),
      drinkCount: dayAgg.drinkCount,
      zeroProofCount: dayAgg.zeroProofCount,
      isClearDay: dayAgg.isClearDay,
    });
  }

  return points;
}

/**
 * Computes Monday–Sunday weekly series over the trailing `weeks` ending in the week of `anchorDateKey`.
 */
export function computeWeeklyTrendSeries(
  logs: FoodLogEntry[],
  weeks: number = 12,
  anchorDateKey?: string
): WeeklyDrinkPoint[] {
  const count = Math.max(1, Math.round(weeks));
  const anchor = anchorDateKey || getLocalDateKey();
  const byDate = aggregateByDate(logs);

  const anchorUtc = parseIsoUtc(anchor);
  const monOffset = (anchorUtc.getUTCDay() + 6) % 7; // 0 for Mon .. 6 for Sun
  const currentMonday = addIsoDays(anchor, -monOffset);

  const points: WeeklyDrinkPoint[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const weekStart = addIsoDays(currentMonday, -i * 7);
    let totalUnits = 0;
    let clearDays = 0;
    let drinkCount = 0;
    let daysInWeek = 0;

    for (let d = 0; d < 7; d++) {
      const dayKey = addIsoDays(weekStart, d);
      if (dayKey > anchor) break;
      daysInWeek += 1;
      const agg = byDate.get(dayKey);
      if (agg) {
        totalUnits += agg.units;
        drinkCount += agg.drinkCount;
        if (agg.isClearDay) clearDays += 1;
      }
    }

    const roundedTotal = round1(totalUnits);
    const divisor = Math.max(1, daysInWeek);
    points.push({
      weekStart,
      label: formatShortUtcDate(weekStart),
      totalUnits: roundedTotal,
      dailyAvg: round1(roundedTotal / divisor),
      clearDays,
      drinkCount,
    });
  }

  return points;
}

const MON_TO_SUN_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/**
 * Computes Monday–Sunday day-of-week averages over the trailing `days` window ending at `anchorDateKey`.
 */
export function computeDayOfWeekPattern(
  logs: FoodLogEntry[],
  days: number = 30,
  anchorDateKey?: string
): DayOfWeekPoint[] {
  const count = Math.max(1, Math.round(days));
  const anchor = anchorDateKey || getLocalDateKey();
  const byDate = aggregateByDate(logs);
  const start = addIsoDays(anchor, -(count - 1));

  const totals = new Array<number>(7).fill(0);
  const samples = new Array<number>(7).fill(0);

  for (let i = 0; i < count; i++) {
    const dateKey = addIsoDays(start, i);
    const monIdx = (parseIsoUtc(dateKey).getUTCDay() + 6) % 7;
    samples[monIdx] += 1;
    totals[monIdx] += byDate.get(dateKey)?.units ?? 0;
  }

  return MON_TO_SUN_LABELS.map((dayLabel, dayIndex) => {
    const totalUnits = round1(totals[dayIndex]);
    const sampleDays = samples[dayIndex];
    return {
      dayIndex,
      dayLabel,
      avgUnits: sampleDays > 0 ? round1(totalUnits / sampleDays) : 0,
      totalUnits,
      sampleDays,
    };
  });
}

/**
 * Summarizes today, 7-day, 30-day, 90-day, clear days, zero-proof swaps, and week-over-week delta.
 */
export function computeTrendSummary(
  logs: FoodLogEntry[],
  anchorDateKey?: string
): TrendSummary {
  const anchor = anchorDateKey || getLocalDateKey();
  const byDate = aggregateByDate(logs);

  const sumWindow = (len: number, endKey: string) => {
    let total = 0;
    let clearDays = 0;
    let swaps = 0;
    const startKey = addIsoDays(endKey, -(len - 1));
    for (let i = 0; i < len; i++) {
      const agg = byDate.get(addIsoDays(startKey, i));
      if (agg) {
        total += agg.units;
        if (agg.isClearDay) clearDays += 1;
        swaps += agg.zeroProofCount;
      }
    }
    return { total: round1(total), clearDays, swaps };
  };

  const todayUnits = round1(byDate.get(anchor)?.units ?? 0);
  const seven = sumWindow(7, anchor);
  const priorSeven = sumWindow(7, addIsoDays(anchor, -7));
  const thirty = sumWindow(30, anchor);
  const ninety = sumWindow(90, anchor);

  const rollingVsPriorPct =
    priorSeven.total > 0
      ? Math.round(((seven.total - priorSeven.total) / priorSeven.total) * 100)
      : null;

  return {
    todayUnits,
    sevenDayTotal: seven.total,
    sevenDayAvg: round1(seven.total / 7),
    thirtyDayTotal: thirty.total,
    thirtyDayAvg: round1(thirty.total / 30),
    ninetyDayTotal: ninety.total,
    clearDaysLast30: thirty.clearDays,
    zeroProofSwapsLast30: thirty.swaps,
    rollingVsPriorPct,
  };
}

/** Aggregates a single date into a `DailyLog` snapshot. */
export function summarizeDayLogs(logs: FoodLogEntry[], dateKey: string): DailyLog {
  const dayEntries = logs.filter((e) => !e.ignored && e.date === dateKey);
  const agg = aggregateByDate(dayEntries).get(dateKey) ?? EMPTY_DAY;
  return {
    date: dateKey,
    entries: dayEntries,
    totalUnits: agg.units,
    drinkCount: agg.drinkCount,
    zeroProofCount: agg.zeroProofCount,
    isClearDay: agg.isClearDay,
  };
}

/** Projects `logs` into `DashboardSummary` for Today & Trends cards. */
export function toDashboardSummary(
  logs: FoodLogEntry[],
  anchorDateKey?: string
): DashboardSummary {
  const anchor = anchorDateKey || getLocalDateKey();
  const trend = computeTrendSummary(logs, anchor);
  const today = summarizeDayLogs(logs, anchor);
  return {
    todayUnits: trend.todayUnits,
    sevenDayAvgUnits: trend.sevenDayAvg,
    thirtyDayTotalUnits: trend.thirtyDayTotal,
    clearDaysLast30: trend.clearDaysLast30,
    zeroProofSwapsLast30: trend.zeroProofSwapsLast30,
    sevenDayTotalUnits: trend.sevenDayTotal,
    ninetyDayTotalUnits: trend.ninetyDayTotal,
    todayDrinkCount: today.drinkCount,
    todayZeroProofCount: today.zeroProofCount,
    isTodayClearDay: today.isClearDay,
    rollingVsPriorPct: trend.rollingVsPriorPct,
  };
}

/** Builds a Firestore-compatible `food_log` entry draft for any beverage pour or Clear Day check-in. */
export function buildDrinkLogEntry(params: {
  name: string;
  volumeOz: number;
  abvPct: number;
  standardUnits?: number;
  units?: number;
  category?: DrinkCategory;
  isZeroProof?: boolean;
  zeroProof?: boolean;
  isClearDay?: boolean;
  alternativeSuggested?: string;
  date?: string;
  consumedAt?: string;
  source?: FoodLogEntry['source'];
  notes?: string;
  inferenceSource?: 'ON_DEVICE' | 'IN_CLOUD';
  inferenceLatencyMs?: number;
}): Omit<FoodLogEntry, 'timestamp'> {
  const isClearDay = Boolean(params.isClearDay || params.category === 'clear-day');
  const isZeroProof = Boolean(
    !isClearDay && (params.isZeroProof || params.zeroProof || params.category === 'zero-proof')
  );
  const rawUnits = params.standardUnits ?? params.units;
  const units =
    isClearDay || isZeroProof
      ? 0
      : typeof rawUnits === 'number' && Number.isFinite(rawUnits)
        ? Math.max(0, round1(rawUnits))
        : calculateStandardUnits(params.volumeOz, params.abvPct);

  const volumeOz = isClearDay ? 0 : Math.max(0, round1(params.volumeOz));
  const abvPct = isClearDay || isZeroProof ? 0 : Math.max(0, round1(params.abvPct));
  const now = new Date();
  const date = params.date || getLocalDateKey(now);
  const consumedAt = params.consumedAt || now.toTimeString().slice(0, 5);
  const drinkCategory: DrinkCategory = isClearDay
    ? 'clear-day'
    : isZeroProof
      ? 'zero-proof'
      : params.category || 'beer';

  return {
    name: params.name.trim(),
    standardUnits: units,
    alcoholDrinks: units,
    volumeOz,
    abvPct,
    isClearDay,
    isZeroProof,
    drinkCategory,
    ...(params.alternativeSuggested ? { alternativeSuggested: params.alternativeSuggested } : {}),
    ...(params.notes ? { notes: params.notes } : {}),
    portionG: Math.round(volumeOz * ML_PER_FL_OZ),
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fiberG: 0,
    source: params.source || 'coaster',
    meal: isClearDay ? 'clear-day' : 'drink',
    consumedAt,
    date,
    ...(params.inferenceSource ? { inferenceSource: params.inferenceSource } : {}),
    ...(typeof params.inferenceLatencyMs === 'number'
      ? { inferenceLatencyMs: params.inferenceLatencyMs }
      : {}),
  };
}

const SWAP_SUGGESTIONS_BY_CATEGORY: Record<DrinkCategory, string[]> = {
  beer: [
    'Athletic Run Wild IPA (0.0u) brings real West Coast hop bite without the afternoon fog.',
    'Lagunitas Hoppy Refresher (0.0u) hits that crisp citrus-hop sparkle right out of a cold glass.',
    'Session pilsner at 4.0% ABV keeps the crisp patio pour at ~0.8u.',
  ],
  wine: [
    'Sparkling yuzu tonic over ice with a rosemary sprig gives bright acidity and zero units.',
    'A 50/50 dry white wine spritzer with soda water stretches the pour while halving the units.',
    'Proxies or chilled hibiscus ginger iced tea in a stem glass feels dinner-party worthy at 0.0u.',
  ],
  spirits: [
    'Phony Negroni over a big rock nails that bitter botanical finish at 0.0u.',
    'Seedlip Spice 94 with ginger beer and fresh lime brings real cocktail snap with 0.0u.',
    'Tall soda with a heavy splash of bitters and orange peel keeps the ritual bright and light.',
  ],
  cocktail: [
    'Phony Negroni on a big cube is Sunny’s personal go-to when you want bar-craft bitterness at 0.0u.',
    'Ginger hibiscus mule (ginger beer, hibiscus tea, fresh lime) gives all the zing for 0.0u.',
    'Sparkling yuzu spritz with a salted rim delivers crisp citrus bar vibes with zero units.',
  ],
  seltzer: [
    'Sparkling yuzu or grapefruit Topo Chico with fresh lime keeps the cold-can fizz at 0.0u.',
    'Crisp ginger hibiscus seltzer gives bright botanical flavor without any alcohol.',
  ],
  'zero-proof': [
    'Sparkling yuzu with a twist of lime is pure refreshment at 0.0u.',
    'Phony Negroni over a clear ice sphere always hits the spot.',
  ],
  'clear-day': [
    'Ginger hibiscus fizz over crushed ice is a great evening cap on a clear day.',
  ],
};

/** Returns a concrete, tasty zero-proof or lower-ABV swap suggestion tailored to the drink style. */
export function getSunnySwapSuggestion(
  category: DrinkCategory = 'cocktail',
  seed: number = 0
): string {
  const pool = SWAP_SUGGESTIONS_BY_CATEGORY[category] || SWAP_SUGGESTIONS_BY_CATEGORY.cocktail;
  const idx = Math.abs(Math.floor(seed)) % pool.length;
  return pool[idx];
}

/** Triggers Sunny's swap suggestion roughly 1 in 3 alcoholic drink logs. */
export function shouldOfferBuddySwap(alcoholicLogCount: number): boolean {
  if (!Number.isFinite(alcoholicLogCount) || alcoholicLogCount <= 0) return false;
  return alcoholicLogCount % 3 === 0;
}

/**
 * Generates Sunny's warm, non-judgmental booth-buddy note for a reconciled drink log.
 * Lightly teases glassware or over-the-top menus — never judges or lectures.
 */
export function getSunnyPourNote(params: {
  name: string;
  units: number;
  category: DrinkCategory;
  isClearDay?: boolean;
  isZeroProof?: boolean;
  swapSuggestion?: string;
}): string {
  const { name, units, category, isClearDay, isZeroProof, swapSuggestion } = params;
  if (isClearDay) {
    return 'Clear day logged at 0.0u — I’m raising a sparkling yuzu from across the booth.';
  }
  if (isZeroProof) {
    return `${name} logged at 0.0u. Zero-proof pours always earn a nod from my side of the table.`;
  }
  const unitText = formatUnits(units);
  const lightQuip =
    category === 'beer' && /ipa|hazy|double|triple/i.test(name)
      ? `Tallied ${name} at ${unitText}. Craft brewers really treat label adjectives like a competitive sport.`
      : category === 'cocktail'
        ? `Tallied ${name} at ${unitText} — bar menus love a dramatic glass, so we keep the math grounded.`
        : `Tallied ${name} at ${unitText}. Clean and simple on the coaster.`;

  return swapSuggestion ? `${lightQuip} Idea for next round: ${swapSuggestion}` : lightQuip;
}
