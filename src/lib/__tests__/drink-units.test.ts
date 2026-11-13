import { describe, expect, it } from 'vitest';
import {
  DRINK_PRESETS,
  GRAMS_PER_STANDARD_DRINK,
  ML_PER_FL_OZ,
  PURE_ALCOHOL_OZ_PER_STANDARD_DRINK,
  addIsoDays,
  buildDrinkLogEntry,
  calculateStandardUnits,
  computeDailyTrendSeries,
  computeDayOfWeekPattern,
  computeTrendSummary,
  computeWeeklyTrendSeries,
  formatUnits,
  getEntryUnits,
  isClearDayEntry,
  isZeroProofEntry,
  mlToOz,
  normalizeDrinkCategory,
  standardUnitsToGrams,
} from '../drink-units';
import {
  DRINK_DATABASE,
  reconcileDrinkDescription,
  reconcileDrinkItems,
} from '../drink-reconciler';
import type { FoodLogEntry } from '../food-exercise-types';

function makeLog(
  date: string,
  name: string,
  units: number,
  opts?: Partial<FoodLogEntry>,
): FoodLogEntry {
  return {
    ...buildDrinkLogEntry({
      name,
      volumeOz: opts?.volumeOz ?? (units > 0 ? 12 : 0),
      abvPct: opts?.abvPct ?? (units > 0 ? 5 : 0),
      standardUnits: units,
      category: opts?.drinkCategory
        ? normalizeDrinkCategory(opts.drinkCategory)
        : opts?.isClearDay
          ? 'clear-day'
          : opts?.isZeroProof
            ? 'zero-proof'
            : 'beer',
      isZeroProof: opts?.isZeroProof,
      isClearDay: opts?.isClearDay,
      date,
    }),
    id: opts?.id ?? `${date}_${name}_${Math.random()}`,
    timestamp: new Date(`${date}T18:00:00.000Z`) as unknown as FoodLogEntry['timestamp'],
  };
}

describe('NIAAA Standard Drink Unit math & constants', () => {
  it('defines exact NIAAA constants', () => {
    expect(PURE_ALCOHOL_OZ_PER_STANDARD_DRINK).toBe(0.6);
    expect(GRAMS_PER_STANDARD_DRINK).toBe(14);
    expect(ML_PER_FL_OZ).toBeCloseTo(29.5735, 4);
  });

  it('computes NIAAA standard units accurately to 1 decimal place', () => {
    expect(calculateStandardUnits(12, 4.2)).toBe(0.8);
    expect(calculateStandardUnits(12, 5)).toBe(1.0);
    expect(calculateStandardUnits(16, 7)).toBe(1.9);
    expect(calculateStandardUnits(5, 12)).toBe(1.0);
    expect(calculateStandardUnits(6, 14.5)).toBe(1.5);
    expect(calculateStandardUnits(1.5, 40)).toBe(1.0);
  });

  it('handles zero, negative, and NaN inputs safely', () => {
    expect(calculateStandardUnits(0, 5)).toBe(0);
    expect(calculateStandardUnits(12, 0)).toBe(0);
    expect(calculateStandardUnits(-12, 5)).toBe(0);
    expect(calculateStandardUnits(NaN, 5)).toBe(0);
    expect(calculateStandardUnits(12, Number.NaN)).toBe(0);
  });

  it('converts ml to oz, units to ethanol grams, and formats display labels', () => {
    expect(mlToOz(355)).toBeCloseTo(12.0, 1);
    expect(mlToOz(750)).toBeCloseTo(25.36, 1);
    expect(mlToOz(-10)).toBe(0);
    expect(standardUnitsToGrams(1.0)).toBe(14);
    expect(standardUnitsToGrams(1.5)).toBe(21);
    expect(formatUnits(1.5)).toBe('1.5u');
    expect(formatUnits(0)).toBe('0.0u');
    expect(formatUnits(-2)).toBe('0.0u');
  });

  it('exposes all required quick-log presets including Zero-Proof & Clear Day', () => {
    const ids = DRINK_PRESETS.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'light-beer',
        'lager',
        'craft-ipa',
        'wine',
        'bold-wine',
        'spirit-shot',
        'cocktail',
        'seltzer',
        'zero-proof',
        'clear-day',
      ]),
    );

    const ipa = DRINK_PRESETS.find((p) => p.id === 'craft-ipa');
    expect(ipa?.units).toBe(1.9);

    const zero = DRINK_PRESETS.find((p) => p.id === 'zero-proof');
    expect(zero?.zeroProof).toBe(true);
    expect(zero?.units).toBe(0);

    const clear = DRINK_PRESETS.find((p) => p.id === 'clear-day');
    expect(clear?.clearDay).toBe(true);
    expect(clear?.units).toBe(0);
  });
});

describe('Offline beverage database & natural-language reconciler', () => {
  it('contains well over 80 beverage profiles across every drink category', () => {
    expect(DRINK_DATABASE.length).toBeGreaterThanOrEqual(80);
    const categories = new Set(DRINK_DATABASE.map((d) => d.category));
    expect(categories).toEqual(
      new Set(['beer', 'wine', 'spirits', 'cocktail', 'seltzer', 'zero-proof', 'clear-day']),
    );
  });

  it('reconciles multipliers, half bottles, doubles, and explicit volume + ABV', () => {
    const ipas = reconcileDrinkDescription('2 hazy IPAs');
    expect(ipas).not.toBeNull();
    expect(ipas?.quantity).toBe(2);
    expect(ipas?.units).toBe(calculateStandardUnits(16 * 2, ipas!.abvPct));
    expect(ipas?.units).toBeGreaterThanOrEqual(3.4);

    const lights = reconcileDrinkDescription('3 Miller Lites');
    expect(lights?.quantity).toBe(3);
    expect(lights?.units).toBe(2.5); // 3 * 12oz * 4.2% / 0.6 = 2.52 -> 2.5u

    const halfBottle = reconcileDrinkDescription('half bottle cab');
    expect(halfBottle?.volumeOz).toBeCloseTo(12.7, 1);
    expect(halfBottle?.abvPct).toBe(14);
    expect(halfBottle?.units).toBe(3.0);

    const doubleGt = reconcileDrinkDescription('double G&T');
    expect(doubleGt?.quantity).toBe(2);
    expect(doubleGt?.units).toBe(2.0);

    const explicitOzAbv = reconcileDrinkDescription('16oz 6.8% hazy pint');
    expect(explicitOzAbv?.volumeOz).toBe(16);
    expect(explicitOzAbv?.abvPct).toBe(6.8);
    expect(explicitOzAbv?.units).toBe(1.8);

    const explicitMlAbv = reconcileDrinkDescription('375ml 14% pinot noir');
    expect(explicitMlAbv?.volumeOz).toBeCloseTo(12.7, 1);
    expect(explicitMlAbv?.abvPct).toBe(14);
    expect(explicitMlAbv?.units).toBe(3.0);

    const wineOz = reconcileDrinkDescription('5oz wine');
    expect(wineOz?.volumeOz).toBe(5);
    expect(wineOz?.units).toBe(1.0);
  });

  it('prioritizes zero-proof matches over alcoholic names and supports clear days', () => {
    const phony = reconcileDrinkDescription('Phony Negroni');
    expect(phony?.zeroProof).toBe(true);
    expect(phony?.category).toBe('zero-proof');
    expect(phony?.units).toBe(0);

    const heinekenZero = reconcileDrinkDescription('Heineken 0.0');
    expect(heinekenZero?.zeroProof).toBe(true);
    expect(heinekenZero?.units).toBe(0);

    const athletic = reconcileDrinkDescription('Athletic Run Wild');
    expect(athletic?.zeroProof).toBe(true);
    expect(athletic?.units).toBe(0);

    const clear = reconcileDrinkDescription('clear day');
    expect(clear?.isClearDay).toBe(true);
    expect(clear?.category).toBe('clear-day');
    expect(clear?.units).toBe(0);

    const af = reconcileDrinkDescription('taking an AF day today');
    expect(af?.isClearDay).toBe(true);
    expect(af?.units).toBe(0);
  });

  it('splits compound lists cleanly with reconcileDrinkItems', () => {
    const multi = reconcileDrinkItems('1 Guinness and a Sparkling Yuzu');
    expect(multi).toHaveLength(2);
    expect(multi[0]?.category).toBe('beer');
    expect(multi[0]?.units).toBeGreaterThan(0);
    expect(multi[1]?.zeroProof).toBe(true);
    expect(multi[1]?.units).toBe(0);
  });
});

describe('Trend series, rolling averages, weekly & DoW aggregations', () => {
  const anchor = '2026-11-13'; // Friday

  it('builds 30-day daily series with accurate 7-day rolling averages', () => {
    const logs: FoodLogEntry[] = [
      makeLog(anchor, 'Pilsner', 1.0),
      makeLog(anchor, 'Sparkling Yuzu', 0, { isZeroProof: true, drinkCategory: 'zero-proof' }),
      makeLog(addIsoDays(anchor, -1), 'Clear Day', 0, { isClearDay: true, drinkCategory: 'clear-day' }),
      makeLog(addIsoDays(anchor, -2), 'Bold Cab', 2.0, { drinkCategory: 'wine' }),
      makeLog(addIsoDays(anchor, -8), 'Old Week Pour', 3.5, { drinkCategory: 'cocktail' }),
    ];

    const series = computeDailyTrendSeries(logs, 30, anchor);
    expect(series).toHaveLength(30);
    expect(series[series.length - 1]?.dateKey).toBe(anchor);
    expect(series[series.length - 1]?.units).toBe(1.0);
    expect(series[series.length - 1]?.drinkCount).toBe(1);
    expect(series[series.length - 1]?.zeroProofCount).toBe(1);
    expect(series[series.length - 1]?.isClearDay).toBe(false);

    // 7-day rolling on anchor = (1.0 + 0 + 2.0) / 7 = 3 / 7 -> 0.4
    expect(series[series.length - 1]?.sevenDayAvg).toBe(0.4);

    // Clear day entry check
    const yesterday = series[series.length - 2]!;
    expect(yesterday.isClearDay).toBe(true);
    expect(yesterday.units).toBe(0);

    const summary = computeTrendSummary(logs, anchor);
    expect(summary.todayUnits).toBe(1.0);
    expect(summary.sevenDayTotal).toBe(3.0);
    expect(summary.thirtyDayTotal).toBe(6.5);
    expect(summary.ninetyDayTotal).toBe(6.5);
    expect(summary.clearDaysLast30).toBe(1);
    expect(summary.zeroProofSwapsLast30).toBe(1);
    expect(summary.rollingVsPriorPct).toBe(-14); // 3.0 vs 3.5 = -14.28%
  });

  it('computes 12-week Monday–Sunday weekly points and 7-day DoW rhythm', () => {
    const logs: FoodLogEntry[] = [
      makeLog(anchor, 'Craft IPA', 1.9), // Friday
      makeLog(addIsoDays(anchor, -7), 'Craft IPA', 1.9), // Previous Friday
      makeLog(addIsoDays(anchor, -1), 'Clear Day', 0, { isClearDay: true, drinkCategory: 'clear-day' }),
    ];

    const weekly = computeWeeklyTrendSeries(logs, 12, anchor);
    expect(weekly).toHaveLength(12);
    expect(weekly[weekly.length - 1]?.totalUnits).toBe(1.9);
    expect(weekly[weekly.length - 1]?.clearDays).toBe(1);
    expect(weekly[weekly.length - 2]?.totalUnits).toBe(1.9);

    const dow = computeDayOfWeekPattern(logs, 30, anchor);
    expect(dow).toHaveLength(7);
    expect(dow[0]?.dayLabel).toBe('Mon');
    expect(dow[4]?.dayLabel).toBe('Fri');
    expect(dow[4]?.totalUnits).toBe(3.8);
    expect(dow[6]?.dayLabel).toBe('Sun');

    expect(getEntryUnits(logs[0]!)).toBe(1.9);
    expect(isClearDayEntry(logs[2]!)).toBe(true);
    expect(isZeroProofEntry(makeLog(anchor, 'Phony Negroni', 0, { isZeroProof: true }))).toBe(true);
  });
});
