'use client';

import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { FoodLogEntry } from '@/lib/food-exercise-types';
import {
  computeDayOfWeekPattern,
  computeWeeklyTrendSeries,
  formatUnits,
} from '@/lib/drink-units';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';

type WeeklyPoint = ReturnType<typeof computeWeeklyTrendSeries>[number];
type DayOfWeekPoint = ReturnType<typeof computeDayOfWeekPattern>[number];

export interface ProteinChartProps {
  logs?: FoodLogEntry[];
  anchorDateKey?: string;
}

function getLocalDateKeyOffset(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function ProteinChart({ logs: propLogs, anchorDateKey }: ProteinChartProps = {}) {
  const { user } = useUser();
  const db = useFirestore();
  const [view, setView] = useState<'weekly' | 'dow'>('weekly');

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

  const weeklySeries = useMemo(
    () => computeWeeklyTrendSeries(activeLogs, 12, anchor),
    [activeLogs, anchor]
  );

  const dowSeries = useMemo(
    () => computeDayOfWeekPattern(activeLogs, 90, anchor),
    [activeLogs, anchor]
  );

  const weeklySummary = useMemo(() => {
    const totalClear = weeklySeries.reduce((acc, w) => acc + w.clearDays, 0);
    const totalUnits = weeklySeries.reduce((acc, w) => acc + w.totalUnits, 0);
    const avgPerWeek =
      weeklySeries.length > 0 ? Math.round((totalUnits / weeklySeries.length) * 10) / 10 : 0;
    return { totalClear, avgPerWeek };
  }, [weeklySeries]);

  const dowHighlight = useMemo(() => {
    const peak = [...dowSeries].sort((a, b) => b.avgUnits - a.avgUnits)[0];
    const weeknightAvg =
      dowSeries
        .filter((d) => ['Mon', 'Tue', 'Wed', 'Thu'].includes(d.dayLabel))
        .reduce((sum, d) => sum + d.avgUnits, 0) / 4;
    const weekendAvg =
      dowSeries
        .filter((d) => ['Fri', 'Sat', 'Sun'].includes(d.dayLabel))
        .reduce((sum, d) => sum + d.avgUnits, 0) / 3;
    return {
      peakDay: peak && peak.avgUnits > 0 ? peak.dayLabel : null,
      weeknightAvg: Math.round(weeknightAvg * 10) / 10,
      weekendAvg: Math.round(weekendAvg * 10) / 10,
    };
  }, [dowSeries]);

  return (
    <Card className="bg-[#FFFDF9] border border-[#E8DFD1] shadow-sm rounded-2xl overflow-hidden">
      <CardHeader className="pb-3 border-b border-[#E8DFD1]/70">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-base sm:text-lg font-bold text-[#1F1B18]">
              {view === 'weekly' ? 'Weekly Pace (12 Weeks)' : 'Day-of-Week Rhythm (90 Days)'}
            </CardTitle>
            <CardDescription className="text-xs text-[#6E6359] mt-0.5">
              {view === 'weekly'
                ? 'See macro direction across full weeks instead of single evenings.'
                : 'Spot how weeknights compare with Friday through Sunday.'}
            </CardDescription>
          </div>

          <div className="inline-flex rounded-full bg-[#FAF6F0] border border-[#E8DFD1] p-1 self-start">
            <button
              type="button"
              onClick={() => setView('weekly')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                view === 'weekly'
                  ? 'bg-[#1F1B18] text-[#FAF6F0]'
                  : 'text-[#6E6359] hover:text-[#1F1B18]'
              }`}
            >
              Weekly Totals
            </button>
            <button
              type="button"
              onClick={() => setView('dow')}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                view === 'dow'
                  ? 'bg-[#1F1B18] text-[#FAF6F0]'
                  : 'text-[#6E6359] hover:text-[#1F1B18]'
              }`}
            >
              Day of Week
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-3">
          {view === 'weekly' ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FAF6F0] border border-[#E8DFD1] px-3 py-1 text-xs font-semibold text-[#1F1B18]">
                Avg week:{' '}
                <strong className="text-[#C26D2D] tabular-nums">
                  {formatUnits(weeklySummary.avgPerWeek)}
                </strong>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#3F7D58]/10 border border-[#3F7D58]/25 px-3 py-1 text-xs font-semibold text-[#3F7D58]">
                Clear days (12w):{' '}
                <strong className="tabular-nums">{weeklySummary.totalClear}</strong>
              </span>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FAF6F0] border border-[#E8DFD1] px-3 py-1 text-xs font-semibold text-[#1F1B18]">
                Mon–Thu avg:{' '}
                <strong className="text-[#3F7D58] tabular-nums">
                  {formatUnits(dowHighlight.weeknightAvg)}/day
                </strong>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FAF6F0] border border-[#E8DFD1] px-3 py-1 text-xs font-semibold text-[#1F1B18]">
                Fri–Sun avg:{' '}
                <strong className="text-[#C26D2D] tabular-nums">
                  {formatUnits(dowHighlight.weekendAvg)}/day
                </strong>
              </span>
              {dowHighlight.peakDay && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#C26D2D]/10 border border-[#C26D2D]/25 px-3 py-1 text-xs font-semibold text-[#C26D2D]">
                  Heaviest day: <strong>{dowHighlight.peakDay}</strong>
                </span>
              )}
            </>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-5">
        {isLoading && activeLogs.length === 0 ? (
          <div className="h-[230px] flex items-center justify-center text-xs text-[#6E6359]">
            Loading pattern data...
          </div>
        ) : view === 'weekly' ? (
          <div className="h-[230px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={weeklySeries}
                margin={{ top: 8, right: 12, left: -16, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E8DFD1" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#6E6359' }}
                  tickLine={false}
                  axisLine={{ stroke: '#E8DFD1' }}
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
                    const wk = payload[0].payload as WeeklyPoint;
                    return (
                      <div className="rounded-xl bg-[#1F1B18] text-[#FAF6F0] px-3.5 py-2.5 shadow-lg border border-[#352F2A] text-xs space-y-1">
                        <div className="font-bold flex items-center justify-between gap-4">
                          <span>Week of {wk.label}</span>
                          <span className="font-black text-[#F5B076] tabular-nums">
                            {formatUnits(wk.totalUnits)}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#D7CCC0] space-y-0.5">
                          <div>Daily avg: {formatUnits(wk.dailyAvg)}</div>
                          <div>
                            {wk.drinkCount} pours •{' '}
                            <span className="text-[#84C39A] font-semibold">
                              {wk.clearDays} clear {wk.clearDays === 1 ? 'day' : 'days'}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="totalUnits" radius={[6, 6, 0, 0]} maxBarSize={28}>
                  {weeklySeries.map((wk) => (
                    <Cell
                      key={wk.weekStart}
                      fill={wk.totalUnits === 0 && wk.clearDays > 0 ? '#3F7D58' : '#C26D2D'}
                      fillOpacity={wk.totalUnits === 0 && wk.clearDays === 0 ? 0.4 : 0.88}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-[230px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={dowSeries}
                margin={{ top: 8, right: 12, left: -16, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E8DFD1" vertical={false} />
                <XAxis
                  dataKey="dayLabel"
                  tick={{ fontSize: 12, fill: '#1F1B18', fontWeight: 600 }}
                  tickLine={false}
                  axisLine={{ stroke: '#E8DFD1' }}
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
                    const item = payload[0].payload as DayOfWeekPoint;
                    return (
                      <div className="rounded-xl bg-[#1F1B18] text-[#FAF6F0] px-3.5 py-2.5 shadow-lg border border-[#352F2A] text-xs space-y-1">
                        <div className="font-bold flex items-center justify-between gap-4">
                          <span>{item.dayLabel} average</span>
                          <span className="font-black text-[#F5B076] tabular-nums">
                            {formatUnits(item.avgUnits)}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#D7CCC0]">
                          {formatUnits(item.totalUnits)} across {item.sampleDays}{' '}
                          {item.dayLabel}s
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="avgUnits" radius={[6, 6, 0, 0]} maxBarSize={34}>
                  {dowSeries.map((item) => {
                    const isWeekend = ['Fri', 'Sat', 'Sun'].includes(item.dayLabel);
                    return (
                      <Cell
                        key={item.dayIndex}
                        fill={isWeekend ? '#C26D2D' : '#6E6359'}
                        fillOpacity={isWeekend ? 0.92 : 0.75}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
