/**
 * Pure NIAAA Standard Drink Unit backfill computation.
 * Aggregates daily drink logs in `windowDates` into chronological `HistoryEntry`
 * records with running cumulative units, clear-day counts, and zero-proof swaps.
 */

import { formatUnits, summarizeDayLogs } from './drink-units';
import type { ExerciseLogEntry, FoodLogEntry } from './food-exercise-types';
import type { HistoryEntry } from './health-service';

/** Compatibility helper retained for unowned callers; unused by Coaster drink unit math. */
export function estimateBMR(weightKg = 80, heightCm = 175, age = 40): number {
  return Math.round(10 * weightKg + 6.25 * heightCm - 5 * age + 5);
}

/** Compatibility helper retained for unowned callers; unused by Coaster drink unit math. */
export function estimateCaloriesOut(
  exerciseCal: number,
  weightKg?: number,
  heightCm?: number,
  age?: number,
): number {
  const bmr = estimateBMR(weightKg ?? 80, heightCm ?? 175, age ?? 40);
  return Math.round(bmr * 1.2 + exerciseCal);
}

export interface DayLogs {
  food: FoodLogEntry[];
  exercise?: ExerciseLogEntry[];
}

export interface BuildScoreHistoryInput {
  /** YYYY-MM-DD ascending dates to rebuild. */
  windowDates: string[];
  logsByDate: Record<string, DayLogs>;
  existingHistory: HistoryEntry[];
  /** Optional legacy inputs accepted safely and ignored by pure drink unit math. */
  fitbitCaloriesOutByDate?: Record<string, number | undefined>;
  weightKg?: number;
  bodyFatPct?: number;
  heightCm?: number;
  age?: number;
  proteinGoal?: number;
}

export interface BuildScoreHistoryResult {
  history: HistoryEntry[];
  totalUnits: number;
  clearDays: number;
  zeroProofSwaps: number;
  scoredDays: number;
  /** Compatibility alias equal to cumulative `totalUnits`. */
  visceralFatPoints: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildDayDetail(params: {
  totalUnits: number;
  drinkCount: number;
  zeroProofCount: number;
  isClearDay: boolean;
}): string {
  const { totalUnits, drinkCount, zeroProofCount, isClearDay } = params;
  if (isClearDay && totalUnits === 0 && zeroProofCount === 0) {
    return 'Clear Day (0.0u)';
  }
  const parts = [formatUnits(totalUnits)];
  if (drinkCount > 0) {
    parts.push(`${drinkCount} pour${drinkCount === 1 ? '' : 's'}`);
  }
  if (zeroProofCount > 0) {
    parts.push(`${zeroProofCount} zero-proof`);
  }
  if (isClearDay) {
    parts.push('Clear Day');
  }
  return parts.join(' · ');
}

export function buildScoreHistory(input: BuildScoreHistoryInput): BuildScoreHistoryResult {
  const byKey = new Map<string, HistoryEntry>();
  input.existingHistory.forEach((h, i) => byKey.set(h.isoDate || `__noiso_${i}`, h));

  let scoredDays = 0;

  for (const date of input.windowDates) {
    const food = (input.logsByDate[date]?.food ?? []).filter((entry) => !entry.ignored);
    if (food.length === 0) continue;

    scoredDays += 1;
    const summary = summarizeDayLogs(food, date);
    const [y, m, d] = date.split('-').map(Number);
    const displayDate = new Date(y, m - 1, d).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });

    const existing = byKey.get(date);
    const status: HistoryEntry['status'] =
      summary.isClearDay || summary.totalUnits === 0
        ? 'Bullish'
        : summary.totalUnits <= 2.0
          ? 'Stable'
          : 'Correction';

    byKey.set(date, {
      ...(existing ?? {}),
      date: displayDate,
      isoDate: date,
      gain: summary.totalUnits,
      status,
      detail: buildDayDetail(summary),
      equity: 0,
      scoringVersion: 'coaster-niaaa-v1',
    });
  }

  const ordered = Array.from(byKey.values()).sort((a, b) =>
    (a.isoDate || '').localeCompare(b.isoDate || ''),
  );

  let runningUnits = 0;
  let clearDays = 0;
  let zeroProofSwaps = 0;

  for (const entry of ordered) {
    runningUnits = round1(runningUnits + (entry.gain || 0));
    entry.equity = runningUnits;

    const dayLogs = entry.isoDate
      ? (input.logsByDate[entry.isoDate]?.food ?? []).filter((f) => !f.ignored)
      : [];
    if (dayLogs.length > 0 && entry.isoDate) {
      const sum = summarizeDayLogs(dayLogs, entry.isoDate);
      if (sum.isClearDay) clearDays += 1;
      zeroProofSwaps += sum.zeroProofCount;
    } else if (entry.isoDate && (entry.gain || 0) === 0 && /clear day/i.test(entry.detail || '')) {
      clearDays += 1;
    }
  }

  return {
    history: ordered,
    totalUnits: runningUnits,
    clearDays,
    zeroProofSwaps,
    scoredDays,
    visceralFatPoints: runningUnits,
  };
}
