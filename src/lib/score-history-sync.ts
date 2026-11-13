/**
 * Server-side Firestore orchestration for NIAAA Standard Drink Unit history backfill.
 * Aggregates `food_log` entries over the requested window and updates `history` on the
 * user's health summary document without touching calorie/macro/VF calculations.
 */

import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from './health-service-admin';
import type { FoodLogEntry } from './food-exercise-types';
import type { HistoryEntry } from './health-service';
import { buildScoreHistory, type DayLogs } from './score-backfill';

function addDays(isoDate: string, delta: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/**
 * Rebuilds NIAAA Standard Drink Unit history over the inclusive window ending on `localDate`.
 */
export async function backfillScoreHistory(
  userId: string,
  localDate: string,
  days = 90,
): Promise<{ ok: boolean; scoredDays: number; totalUnits: number }> {
  const firestore = getAdminFirestore();
  const windowStart = addDays(localDate, -(days - 1));

  const [health, food] = await Promise.all([
    adminHealthService.getHealthSummary(firestore, userId),
    adminHealthService.queryLogRangeAll(firestore, userId, 'food_log', windowStart, localDate),
  ]);

  const logsByDate: Record<string, DayLogs> = {};
  const ensure = (date: string) => (logsByDate[date] ??= { food: [] });
  for (const f of food as unknown as FoodLogEntry[]) {
    if (f.date) ensure(f.date).food.push(f);
  }

  const windowDates: string[] = [];
  for (let d = windowStart; d <= localDate; d = addDays(d, 1)) {
    windowDates.push(d);
  }

  const { history, totalUnits, visceralFatPoints, scoredDays } = buildScoreHistory({
    windowDates,
    logsByDate,
    existingHistory: health?.history ?? [],
  });

  const prevSig = JSON.stringify(
    (health?.history ?? []).map((h: HistoryEntry) => [h.isoDate, h.gain, h.equity, h.detail]),
  );
  const nextSig = JSON.stringify(
    history.map((h: HistoryEntry) => [h.isoDate, h.gain, h.equity, h.detail]),
  );

  if (prevSig !== nextSig) {
    await adminHealthService.updateHealthData(firestore, userId, {
      history,
      visceralFatPoints,
    });
  }

  return { ok: true, scoredDays, totalUnits };
}
