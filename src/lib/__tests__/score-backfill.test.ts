import { describe, expect, it } from 'vitest';
import { buildScoreHistory, type DayLogs } from '../score-backfill';
import { buildDrinkLogEntry, type DrinkCategory } from '../drink-units';
import type { FoodLogEntry } from '../food-exercise-types';
import type { HistoryEntry } from '../health-service';

function makeDrink(params: {
  name: string;
  volumeOz: number;
  abvPct: number;
  standardUnits: number;
  category: DrinkCategory;
  isZeroProof?: boolean;
  isClearDay?: boolean;
  date: string;
  ignored?: boolean;
}): FoodLogEntry {
  return {
    ...buildDrinkLogEntry(params),
    id: `${params.date}_${params.name}`,
    ignored: params.ignored,
    timestamp: new Date(`${params.date}T19:00:00.000Z`) as unknown as FoodLogEntry['timestamp'],
  };
}

describe('NIAAA Standard Drink Unit score backfill', () => {
  it('aggregates daily pours, clear days, zero-proof swaps, and cumulative units', () => {
    const logsByDate: Record<string, DayLogs> = {
      '2026-11-10': {
        food: [
          makeDrink({
            name: 'Craft IPA',
            volumeOz: 16,
            abvPct: 7,
            standardUnits: 1.9,
            category: 'beer',
            date: '2026-11-10',
          }),
          makeDrink({
            name: 'Sparkling Yuzu',
            volumeOz: 12,
            abvPct: 0,
            standardUnits: 0,
            category: 'zero-proof',
            isZeroProof: true,
            date: '2026-11-10',
          }),
        ],
      },
      '2026-11-11': {
        food: [
          makeDrink({
            name: 'Clear Day',
            volumeOz: 0,
            abvPct: 0,
            standardUnits: 0,
            category: 'clear-day',
            isClearDay: true,
            date: '2026-11-11',
          }),
        ],
      },
      '2026-11-12': {
        food: [
          makeDrink({
            name: 'Pinot Noir',
            volumeOz: 6,
            abvPct: 14.5,
            standardUnits: 1.5,
            category: 'wine',
            date: '2026-11-12',
          }),
        ],
      },
    };

    const res = buildScoreHistory({
      windowDates: ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'],
      logsByDate,
      existingHistory: [],
    });

    expect(res.scoredDays).toBe(3); // 11-09 unlogged -> skipped
    expect(res.totalUnits).toBe(3.4);
    expect(res.visceralFatPoints).toBe(3.4);
    expect(res.clearDays).toBe(1);
    expect(res.zeroProofSwaps).toBe(1);

    expect(res.history).toHaveLength(3);
    expect(res.history[0]?.isoDate).toBe('2026-11-10');
    expect(res.history[0]?.gain).toBe(1.9);
    expect(res.history[0]?.equity).toBe(1.9);
    expect(res.history[0]?.scoringVersion).toBe('coaster-niaaa-v1');
    expect(res.history[0]?.detail).toContain('zero-proof');

    expect(res.history[1]?.isoDate).toBe('2026-11-11');
    expect(res.history[1]?.gain).toBe(0);
    expect(res.history[1]?.status).toBe('Bullish');
    expect(res.history[1]?.detail).toContain('Clear Day');

    expect(res.history[2]?.isoDate).toBe('2026-11-12');
    expect(res.history[2]?.gain).toBe(1.5);
    expect(res.history[2]?.equity).toBe(3.4);
  });

  it('preserves out-of-window entries, skips ignored logs, and stays idempotent', () => {
    const oldEntry: HistoryEntry = {
      date: 'Oct 1',
      isoDate: '2026-10-01',
      gain: 2.0,
      equity: 2.0,
      status: 'Stable',
      detail: '2.0u · 2 pours',
    };

    const logsByDate: Record<string, DayLogs> = {
      '2026-11-12': {
        food: [
          makeDrink({
            name: 'Ignored Drink',
            volumeOz: 12,
            abvPct: 5,
            standardUnits: 1.0,
            category: 'beer',
            date: '2026-11-12',
            ignored: true,
          }),
          makeDrink({
            name: 'Pilsner',
            volumeOz: 12,
            abvPct: 5,
            standardUnits: 1.0,
            category: 'beer',
            date: '2026-11-12',
          }),
        ],
      },
    };

    const first = buildScoreHistory({
      windowDates: ['2026-11-12'],
      logsByDate,
      existingHistory: [oldEntry],
    });
    expect(first.history).toHaveLength(2);
    expect(first.history[0]?.isoDate).toBe('2026-10-01');
    expect(first.history[1]?.gain).toBe(1.0);
    expect(first.history[1]?.equity).toBe(3.0);

    const second = buildScoreHistory({
      windowDates: ['2026-11-12'],
      logsByDate,
      existingHistory: first.history,
    });
    expect(second.history).toEqual(first.history);
  });
});
