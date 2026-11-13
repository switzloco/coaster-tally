'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { HistoryEntry } from '@/lib/health-service';
import { FoodLogEntry } from '@/lib/food-exercise-types';
import { computeDailyTrendSeries, formatUnits } from '@/lib/drink-units';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { Leaf } from 'lucide-react';

type DailyPoint = ReturnType<typeof computeDailyTrendSeries>[number];

export interface VfHeatmapProps {
  history?: HistoryEntry[];
  onDayClick?: (entry: HistoryEntry) => void;
  logs?: FoodLogEntry[];
  anchorDateKey?: string;
}

function getLocalDateKeyOffset(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMonBasedWeekday(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return (dt.getDay() + 6) % 7; // Mon = 0 .. Sun = 6
}

function getCellAppearance(point: DailyPoint): {
  bgClass: string;
  textClass: string;
  label: string;
} {
  if (point.isClearDay || (point.zeroProofCount > 0 && point.units === 0)) {
    return {
      bgClass: 'bg-[#3F7D58] border-[#346949] hover:ring-2 hover:ring-[#3F7D58]/40',
      textClass: 'text-white',
      label: 'Clear Day',
    };
  }
  if (point.units === 0) {
    return {
      bgClass: 'bg-[#FAF6F0] border-[#E8DFD1] hover:border-[#C26D2D]/50',
      textClass: 'text-[#6E6359]',
      label: 'Quiet',
    };
  }
  if (point.units <= 1.5) {
    return {
      bgClass: 'bg-[#F4D5A6] border-[#E5BD7E] hover:ring-2 hover:ring-[#C26D2D]/30',
      textClass: 'text-[#1F1B18]',
      label: 'Light',
    };
  }
  if (point.units <= 3.0) {
    return {
      bgClass: 'bg-[#D98A43] border-[#C26D2D] hover:ring-2 hover:ring-[#C26D2D]/40',
      textClass: 'text-white',
      label: 'Moderate',
    };
  }
  return {
    bgClass: 'bg-[#A8541F] border-[#8A4215] hover:ring-2 hover:ring-[#A8541F]/40',
    textClass: 'text-white',
    label: 'Social',
  };
}

export function VfHeatmap({
  onDayClick,
  logs: propLogs,
  anchorDateKey,
}: VfHeatmapProps) {
  const { user } = useUser();
  const db = useFirestore();

  const anchor = anchorDateKey || getLocalDateKeyOffset(0);
  const cutoff90 = useMemo(() => getLocalDateKeyOffset(95), []);

  const logsQuery = useMemoFirebase(() => {
    if (propLogs || !user || !db) return null;
    return query(
      collection(db, 'users', user.uid, 'food_log'),
      where('date', '>=', cutoff90)
    );
  }, [propLogs, user, db, cutoff90]);

  const { data: queriedLogs } = useCollection<FoodLogEntry>(logsQuery);

  const activeLogs = useMemo(
    () => (propLogs ?? queriedLogs ?? []).filter((entry) => !entry.ignored),
    [propLogs, queriedLogs]
  );

  const series90 = useMemo(
    () => computeDailyTrendSeries(activeLogs, 90, anchor),
    [activeLogs, anchor]
  );

  const { columns, clearCount, socialDaysCount } = useMemo(() => {
    if (series90.length === 0) {
      return { columns: [] as (DailyPoint | null)[][], clearCount: 0, socialDaysCount: 0 };
    }

    const firstWeekday = getMonBasedWeekday(series90[0].dateKey);
    const padded: (DailyPoint | null)[] = [
      ...Array.from({ length: firstWeekday }, () => null),
      ...series90,
    ];
    const cols: (DailyPoint | null)[][] = [];
    for (let i = 0; i < padded.length; i += 7) {
      const slice = padded.slice(i, i + 7);
      while (slice.length < 7) slice.push(null);
      cols.push(slice);
    }

    let clear = 0;
    let social = 0;
    for (const pt of series90) {
      if (pt.isClearDay || (pt.zeroProofCount > 0 && pt.units === 0)) clear += 1;
      if (pt.units > 0) social += 1;
    }

    return { columns: cols, clearCount: clear, socialDaysCount: social };
  }, [series90]);

  const handleCellClick = (pt: DailyPoint) => {
    if (!onDayClick) return;
    onDayClick({
      isoDate: pt.dateKey,
      date: pt.label,
      gain: 0,
      status: 'Stable',
      detail: pt.isClearDay
        ? 'Clear Day (0.0u)'
        : `${formatUnits(pt.units)} • ${pt.drinkCount} ${pt.drinkCount === 1 ? 'pour' : 'pours'}`,
      equity: pt.units,
    });
  };

  const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <Card className="bg-[#FFFDF9] border border-[#E8DFD1] shadow-sm rounded-2xl overflow-hidden">
      <CardHeader className="pb-3 border-b border-[#E8DFD1]/70">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-base sm:text-lg font-bold text-[#1F1B18]">
              90-Day Coaster Calendar
            </CardTitle>
            <CardDescription className="text-xs text-[#6E6359] mt-0.5">
              Click any square to review pours or toggle a Clear Day.
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-[#3F7D58]/10 border border-[#3F7D58]/25 px-2.5 py-1 text-xs font-bold text-[#3F7D58]">
              <Leaf className="w-3 h-3" />
              {clearCount} Clear Days
            </span>
            <span className="inline-flex items-center rounded-full bg-[#FAF6F0] border border-[#E8DFD1] px-2.5 py-1 text-xs font-semibold text-[#6E6359]">
              {socialDaysCount} pour days
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        <div className="overflow-x-auto pb-1">
          <div className="inline-flex items-start gap-2 min-w-max">
            <div className="grid grid-rows-7 gap-1.5 pr-1 pt-0.5">
              {weekdayLabels.map((day, idx) => (
                <div
                  key={day}
                  className="h-5 sm:h-6 flex items-center text-[10px] font-semibold text-[#6E6359]"
                >
                  {idx % 2 === 0 ? day : ''}
                </div>
              ))}
            </div>

            <div className="flex gap-1.5">
              {columns.map((col, colIdx) => (
                <div key={colIdx} className="grid grid-rows-7 gap-1.5">
                  {col.map((pt, rowIdx) => {
                    if (!pt) {
                      return <div key={`empty-${colIdx}-${rowIdx}`} className="w-5 h-5 sm:w-6 sm:h-6" />;
                    }
                    const style = getCellAppearance(pt);
                    const isToday = pt.dateKey === anchor;
                    const titleText = `${pt.label} (${pt.dateKey}): ${formatUnits(pt.units)} — ${style.label}`;
                    return (
                      <button
                        key={pt.dateKey}
                        type="button"
                        onClick={() => handleCellClick(pt)}
                        title={titleText}
                        aria-label={titleText}
                        className={`w-5 h-5 sm:w-6 sm:h-6 rounded-md border transition-all cursor-pointer flex items-center justify-center ${style.bgClass} ${
                          isToday ? 'ring-2 ring-[#1F1B18] ring-offset-1 ring-offset-[#FFFDF9]' : ''
                        }`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#6E6359] pt-1 border-t border-[#E8DFD1]/60">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded bg-[#3F7D58] border border-[#346949]" />
              Clear (0.0u)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded bg-[#FAF6F0] border border-[#E8DFD1]" />
              Quiet
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded bg-[#F4D5A6] border border-[#E5BD7E]" />
              Light (&le;1.5u)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded bg-[#D98A43] border border-[#C26D2D]" />
              Moderate (&le;3.0u)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded bg-[#A8541F] border border-[#8A4215]" />
              Social (3.1u+)
            </span>
          </div>
          <span className="text-[10px] font-medium">Last 90 days</span>
        </div>
      </CardContent>
    </Card>
  );
}

export const VFHeatmap = VfHeatmap;
