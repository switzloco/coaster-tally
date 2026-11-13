'use client';

import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { HistoryEntry } from '@/lib/health-service';
import { FoodLogEntry } from '@/lib/food-exercise-types';
import {
  computeDailyTrendSeries,
  computeTrendSummary,
  formatUnits,
} from '@/lib/drink-units';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { TrendingDown, TrendingUp } from 'lucide-react';

type DailyPoint = ReturnType<typeof computeDailyTrendSeries>[number];

export interface VfScoreChartProps {
  history?: HistoryEntry[];
  onDayClick?: (entry: HistoryEntry) => void;
  logs?: FoodLogEntry[];
  anchorDateKey?: string;
  activeLevel?: unknown;
  levelHistory?: unknown;
}

function getLocalDateKeyOffset(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function VfScoreChart({
  onDayClick,
  logs: propLogs,
  anchorDateKey,
}: VfScoreChartProps) {
  const { user } = useUser();
  const db = useFirestore();
  const [rangeDays, setRangeDays] = useState<14 | 30 | 90>(30);

  const anchor = anchorDateKey || getLocalDateKeyOffset(0);
  const cutoff90 = useMemo(() => getLocalDateKeyOffset(95), []);

  const logsQuery = useMemoFirebase(() => {
    if (propLogs || !user || !db) return null;
    return query(
      collection(db, 'users', user.uid, 'food_log'),
      where('date', '>=', cutoff90)
    );
  }, [propLogs, user, db, cutoff90]);

  const { data: queriedLogs, isLoading } = useCollection<FoodLogEntry>(logsQuery);

  const activeLogs = useMemo(
    () => (propLogs ?? queriedLogs ?? []).filter((entry) => !entry.ignored),
    [propLogs, queriedLogs]
  );

  const series = useMemo(
    () => computeDailyTrendSeries(activeLogs, rangeDays, anchor),
    [activeLogs, rangeDays, anchor]
  );

  const summary = useMemo(
    () => computeTrendSummary(activeLogs, anchor),
    [activeLogs, anchor]
  );

  const handlePointClick = (point: DailyPoint) => {
    if (!onDayClick) return;
    const detail = point.isClearDay
      ? 'Clear Day (0.0u)'
      : `${formatUnits(point.units)} • ${point.drinkCount} ${point.drinkCount === 1 ? 'pour' : 'pours'}`;
    onDayClick({
      isoDate: point.dateKey,
      date: point.label,
      gain: 0,
      status: 'Stable',
      detail,
      equity: point.units,
    });
  };

  return (
    <Card className="bg-[#FFFDF9] border border-[#E8DFD1] shadow-sm rounded-2xl overflow-hidden">
      <CardHeader className="pb-3 border-b border-[#E8DFD1]/70">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-base sm:text-lg font-bold text-[#1F1B18]">
              Daily Units &amp; 7-Day Average
            </CardTitle>
            <CardDescription className="text-xs text-[#6E6359] mt-0.5">
              Tap any bar to open that day&apos;s coaster breakdown. Rolling line smooths out single nights.
            </CardDescription>
          </div>

          <div className="inline-flex rounded-full bg-[#FAF6F0] border border-[#E8DFD1] p-1 self-start">
            {([14, 30, 90] as const).map((days) => {
              const active = rangeDays === days;
              return (
                <button
                  key={days}
                  type="button"
                  onClick={() => setRangeDays(days)}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                    active
                      ? 'bg-[#1F1B18] text-[#FAF6F0]'
                      : 'text-[#6E6359] hover:text-[#1F1B18]'
                  }`}
                >
                  {days}D
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2.5 pt-3">
          <div className="rounded-xl bg-[#FAF6F0] border border-[#E8DFD1] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#6E6359]">
              7-Day Avg
            </p>
            <p className="text-base font-black text-[#1F1B18] tabular-nums">
              {formatUnits(summary.sevenDayAvg)}
              <span className="text-[11px] font-medium text-[#6E6359] ml-0.5">/day</span>
            </p>
          </div>

          <div className="rounded-xl bg-[#FAF6F0] border border-[#E8DFD1] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#6E6359]">
              30-Day Total
            </p>
            <p className="text-base font-black text-[#C26D2D] tabular-nums">
              {formatUnits(summary.thirtyDayTotal)}
            </p>
          </div>

          <div className="rounded-xl bg-[#FAF6F0] border border-[#E8DFD1] px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#6E6359]">
              Vs Prior 7d
            </p>
            <p className="text-base font-black tabular-nums flex items-center gap-1 text-[#1F1B18]">
              {summary.rollingVsPriorPct === null ? (
                <span className="text-[#6E6359] text-sm font-semibold">—</span>
              ) : (
                <>
                  {summary.rollingVsPriorPct <= 0 ? (
                    <TrendingDown className="w-3.5 h-3.5 text-[#3F7D58]" />
                  ) : (
                    <TrendingUp className="w-3.5 h-3.5 text-[#C26D2D]" />
                  )}
                  <span
                    className={
                      summary.rollingVsPriorPct <= 0 ? 'text-[#3F7D58]' : 'text-[#C26D2D]'
                    }
                  >
                    {summary.rollingVsPriorPct > 0 ? '+' : ''}
                    {summary.rollingVsPriorPct}%
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-5">
        {isLoading && activeLogs.length === 0 ? (
          <div className="h-[260px] flex items-center justify-center text-xs text-[#6E6359]">
            Loading your daily pours...
          </div>
        ) : (
          <div className="h-[270px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={series}
                margin={{ top: 10, right: 12, left: -16, bottom: 4 }}
                onClick={(state) => {
                  const idx = state?.activeTooltipIndex;
                  if (typeof idx === 'number' && series[idx]) {
                    handlePointClick(series[idx]);
                  }
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E8DFD1" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#6E6359' }}
                  tickLine={false}
                  axisLine={{ stroke: '#E8DFD1' }}
                  minTickGap={rangeDays >= 90 ? 28 : 16}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#6E6359' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `${v}u`}
                />
                <Tooltip
                  cursor={{ fill: '#FAF6F0', opacity: 0.7 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const pt = payload[0].payload as DailyPoint;
                    return (
                      <div className="rounded-xl bg-[#1F1B18] text-[#FAF6F0] px-3.5 py-2.5 shadow-lg border border-[#352F2A] text-xs space-y-1">
                        <div className="font-bold flex items-center justify-between gap-4">
                          <span>{pt.label}</span>
                          <span
                            className={`font-black tabular-nums ${
                              pt.isClearDay || pt.units === 0 ? 'text-[#84C39A]' : 'text-[#F5B076]'
                            }`}
                          >
                            {formatUnits(pt.units)}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#D7CCC0] space-y-0.5">
                          <div>
                            7-day avg:{' '}
                            <span className="font-bold text-white tabular-nums">
                              {formatUnits(pt.sevenDayAvg)}
                            </span>
                          </div>
                          <div>
                            {pt.isClearDay
                              ? 'Clear Day recorded'
                              : `${pt.drinkCount} alcoholic ${pt.drinkCount === 1 ? 'pour' : 'pours'}`}
                            {pt.zeroProofCount > 0
                              ? ` • ${pt.zeroProofCount} zero-proof`
                              : ''}
                          </div>
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="units"
                  radius={[5, 5, 0, 0]}
                  maxBarSize={rangeDays === 14 ? 26 : rangeDays === 30 ? 16 : 8}
                  className="cursor-pointer"
                >
                  {series.map((pt) => {
                    const isGreen =
                      pt.isClearDay || (pt.zeroProofCount > 0 && pt.units === 0);
                    const fill = isGreen
                      ? '#3F7D58'
                      : pt.units > 0
                        ? '#C26D2D'
                        : '#E8DFD1';
                    return (
                      <Cell
                        key={pt.dateKey}
                        fill={fill}
                        fillOpacity={pt.units === 0 && !isGreen ? 0.55 : 0.9}
                      />
                    );
                  })}
                </Bar>
                <Line
                  type="monotone"
                  dataKey="sevenDayAvg"
                  stroke="#1F1B18"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4, fill: '#1F1B18', stroke: '#FAF6F0', strokeWidth: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4 pt-3 text-[11px] text-[#6E6359]">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#C26D2D]" />
            Daily Standard Units
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#3F7D58]" />
            Clear / Zero-Proof Day
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-[#1F1B18]" />
            7-Day Rolling Avg
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export const VFScoreChart = VfScoreChart;
