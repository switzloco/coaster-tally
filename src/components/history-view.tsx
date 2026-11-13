'use client';

import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HistoryEntry, healthService } from '@/lib/health-service';
import {
  FoodLogEntry,
  formatHHMM12h,
  inferMealFromTime,
  minutesToHHMM,
  hhmmToMinutes,
} from '@/lib/food-exercise-types';
import {
  formatUnits,
  getEntryUnits,
  isClearDayEntry,
  isZeroProofEntry,
} from '@/lib/drink-units';
import {
  fetchAllLedger,
  ledgerToCSV,
  ledgerToJSON,
  downloadTextFile,
} from '@/lib/ledger-export';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { useHybridAi } from '@/components/hybrid-ai-provider';
import { VfScoreChart } from '@/components/vf-score-chart';
import { ProteinChart } from '@/components/protein-chart';
import { VfHeatmap } from '@/components/vf-heatmap';
import { VfDayDetail } from '@/components/vf-day-detail';
import { LedgerChat, ChatHistoryLog } from '@/components/ledger-chat';
import { MySharesSection } from '@/components/my-shares-section';
import { ShareMealButton } from '@/components/share-meal-button';
import { HybridTickerTerminal } from '@/components/hybrid-ticker-terminal';
import { ExecutionReceiptBadge } from '@/components/execution-receipt-badge';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import {
  Calendar,
  Check,
  Clock,
  Download,
  Leaf,
  Loader2,
  Search,
  Sparkles,
  Trash2,
  Wine,
  X,
} from 'lucide-react';

interface CoasterFoodLogEntry extends FoodLogEntry {
  id: string;
  standardUnits?: number;
  isClearDay?: boolean;
  isZeroProof?: boolean;
  drinkCategory?: string;
  volumeOz?: number;
  abvPct?: number;
  alternativeSuggested?: string;
}

type LogFilter = 'all' | 'alcoholic' | 'zero-proof' | 'clear-day';

interface TimingEditorState {
  entry: CoasterFoodLogEntry;
  targetDate: string;
  targetTime: string;
}

function formatDayHeading(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getTodayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function HistoryView() {
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();
  const { setEarningsModalOpen, recentReceipts } = useHybridAi();

  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<LogFilter>('all');
  const [exportingFormat, setExportingFormat] = useState<'csv' | 'json' | null>(null);

  const [timingEditor, setTimingEditor] = useState<TimingEditorState | null>(null);
  const [savingTiming, setSavingTiming] = useState(false);

  const logsQuery = useMemoFirebase(() => {
    if (!user || !db) return null;
    return query(
      collection(db, 'users', user.uid, 'food_log'),
      orderBy('timestamp', 'desc'),
      limit(300)
    );
  }, [user, db]);

  const { data: rawLogs, isLoading } = useCollection<CoasterFoodLogEntry>(logsQuery);

  const activeLogs = useMemo(
    () => (rawLogs ?? []).filter((entry) => !entry.ignored),
    [rawLogs]
  );

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return activeLogs.filter((entry) => {
      const clear = isClearDayEntry(entry);
      const zero = isZeroProofEntry(entry);
      const units = getEntryUnits(entry);

      if (activeFilter === 'clear-day' && !clear) return false;
      if (activeFilter === 'zero-proof' && !(zero && !clear)) return false;
      if (activeFilter === 'alcoholic' && (clear || zero || units <= 0)) return false;

      if (!q) return true;
      const haystack = [
        entry.name,
        entry.drinkCategory,
        entry.date,
        entry.alternativeSuggested,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [activeLogs, activeFilter, searchQuery]);

  const groupedDays = useMemo(() => {
    const map = new Map<string, CoasterFoodLogEntry[]>();
    for (const entry of filteredLogs) {
      const dateKey = entry.date || 'Unknown';
      const arr = map.get(dateKey) ?? [];
      arr.push(entry);
      map.set(dateKey, arr);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([dateKey, entries]) => {
        const sortedEntries = [...entries].sort((a, b) =>
          (b.consumedAt || '00:00').localeCompare(a.consumedAt || '00:00')
        );
        const totalUnits =
          Math.round(
            sortedEntries.reduce(
              (sum, e) => sum + (isClearDayEntry(e) ? 0 : getEntryUnits(e)),
              0
            ) * 10
          ) / 10;
        const hasClear = sortedEntries.some((e) => isClearDayEntry(e));
        const hasZeroProof = sortedEntries.some((e) => isZeroProofEntry(e) && !isClearDayEntry(e));
        return {
          dateKey,
          entries: sortedEntries,
          totalUnits,
          hasClear,
          hasZeroProof,
        };
      });
  }, [filteredLogs]);

  const handleOpenDay = (entry: HistoryEntry) => {
    setSelectedEntry(entry);
    setSheetOpen(true);
  };

  const handleDeleteEntry = async (entry: CoasterFoodLogEntry) => {
    if (!user || !db) return;
    try {
      await healthService.setFoodEntryIgnored(db, user.uid, entry.id, true);
      toast({
        title: 'Pour removed',
        description: `${entry.name} removed from your timeline.`,
      });
    } catch {
      toast({
        variant: 'destructive',
        title: 'Could not remove pour',
        description: 'Try again in a moment.',
      });
    }
  };

  const handleApplyTimingUpdate = async () => {
    if (!user || !db || !timingEditor) return;
    setSavingTiming(true);
    try {
      const inferredMeal = inferMealFromTime(timingEditor.targetTime);
      await healthService.updateLedgerEntryTiming(db, user.uid, {
        id: timingEditor.entry.id,
        type: 'food',
        oldDate: timingEditor.entry.date,
        newDate: timingEditor.targetDate,
        newTime: timingEditor.targetTime,
        meal: inferredMeal,
        todayIso: getTodayIso(),
      });
      toast({
        title: 'Timing updated',
        description: `${timingEditor.entry.name} moved to ${timingEditor.targetDate} at ${formatHHMM12h(timingEditor.targetTime)}.`,
      });
      setTimingEditor(null);
    } catch {
      toast({
        variant: 'destructive',
        title: 'Could not update timing',
        description: 'Try again in a moment.',
      });
    } finally {
      setSavingTiming(false);
    }
  };

  const handleExport = async (format: 'csv' | 'json') => {
    if (!user || !db) return;
    setExportingFormat(format);
    try {
      const snapshot = await fetchAllLedger(db, user.uid);
      const stamp = getTodayIso();
      if (format === 'csv') {
        downloadTextFile(`coaster-ledger-${stamp}.csv`, ledgerToCSV(snapshot), 'text/csv');
      } else {
        downloadTextFile(
          `coaster-ledger-${stamp}.json`,
          ledgerToJSON(snapshot),
          'application/json'
        );
      }
      toast({
        title: `Exported ${format.toUpperCase()}`,
        description: 'Your Coaster pour history downloaded.',
      });
    } catch {
      toast({
        variant: 'destructive',
        title: 'Export failed',
        description: 'Could not download ledger archive.',
      });
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl bg-[#FFFDF9] border border-[#E8DFD1] p-4 shadow-sm">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#C26D2D]">
            Trending Over Time
          </p>
          <h2 className="text-xl font-black text-[#1F1B18] tracking-tight">
            Patterns, Clear Days &amp; Pour History
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {recentReceipts.length > 0 && (
            <ExecutionReceiptBadge
              inferenceSource={recentReceipts[recentReceipts.length - 1].inferenceSource}
              latencyMs={recentReceipts[recentReceipts.length - 1].latencyMs}
            />
          )}
          <Button
            type="button"
            size="sm"
            onClick={() => setEarningsModalOpen(true)}
            className="h-8 px-3 rounded-full bg-[#C26D2D] hover:bg-[#AD5D23] text-white text-xs font-bold"
          >
            <Sparkles className="w-3.5 h-3.5 mr-1.5" />
            30D Trend Check-In
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={exportingFormat !== null}
            onClick={() => handleExport('csv')}
            className="h-8 px-3 rounded-full border-[#E8DFD1] bg-[#FAF6F0] text-[#1F1B18] text-xs font-semibold"
          >
            {exportingFormat === 'csv' ? (
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5 mr-1" />
            )}
            CSV
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={exportingFormat !== null}
            onClick={() => handleExport('json')}
            className="h-8 px-3 rounded-full border-[#E8DFD1] bg-[#FAF6F0] text-[#1F1B18] text-xs font-semibold"
          >
            {exportingFormat === 'json' ? (
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5 mr-1" />
            )}
            JSON
          </Button>
        </div>
      </div>

      {/* 1. Daily Standard Drink Units + 7-Day Rolling Average */}
      <VfScoreChart logs={activeLogs} onDayClick={handleOpenDay} />

      {/* 2. Weekly Totals & Mon-Sun Day-of-Week Rhythm */}
      <ProteinChart logs={activeLogs} />

      {/* 3. 90-Day Coaster Calendar Heatmap */}
      <VfHeatmap logs={activeLogs} onDayClick={handleOpenDay} />

      {/* 4. Ask Sunny Ledger Chat */}
      <LedgerChat />

      {/* 5. Filterable Beverage & Clear Day Timeline */}
      <Card className="bg-[#FFFDF9] border border-[#E8DFD1] shadow-sm rounded-2xl overflow-hidden">
        <CardHeader className="pb-3 border-b border-[#E8DFD1]/70 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="text-base sm:text-lg font-bold text-[#1F1B18]">
                Pour &amp; Clear Day Timeline
              </CardTitle>
              <CardDescription className="text-xs text-[#6E6359]">
                Search logged drinks, adjust dates or times, or filter by Clear Days and swaps.
              </CardDescription>
            </div>
            <span className="text-xs font-semibold text-[#6E6359] tabular-nums">
              {filteredLogs.length} matching {filteredLogs.length === 1 ? 'entry' : 'entries'}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5 sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-[#6E6359] absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search pours, categories, dates..."
                className="pl-8 h-9 bg-[#FAF6F0] border-[#E8DFD1] text-sm"
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'alcoholic', label: 'Alcoholic Pours' },
                  { id: 'zero-proof', label: 'Zero-Proof Swaps' },
                  { id: 'clear-day', label: 'Clear Days' },
                ] as const
              ).map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setActiveFilter(pill.id)}
                  className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
                    activeFilter === pill.id
                      ? 'bg-[#1F1B18] text-[#FAF6F0] border-[#1F1B18]'
                      : 'bg-[#FAF6F0] text-[#6E6359] border-[#E8DFD1] hover:text-[#1F1B18]'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 sm:p-5 space-y-4">
          {isLoading && activeLogs.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#6E6359]">
              Loading your beverage timeline...
            </div>
          ) : groupedDays.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#E8DFD1] bg-[#FAF6F0]/60 py-10 px-4 text-center space-y-1">
              <p className="text-sm font-bold text-[#1F1B18]">No matching entries</p>
              <p className="text-xs text-[#6E6359]">
                Log a pour from Today&apos;s Coaster or clear your search filter.
              </p>
            </div>
          ) : (
            groupedDays.map((group) => (
              <div
                key={group.dateKey}
                className="rounded-2xl bg-[#FAF6F0] border border-[#E8DFD1] overflow-hidden"
              >
                <div className="px-4 py-2.5 bg-[#F5EDE1] border-b border-[#E8DFD1] flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      handleOpenDay({
                        isoDate: group.dateKey,
                        date: formatDayHeading(group.dateKey),
                        gain: 0,
                        status: 'Stable',
                        detail: `${formatUnits(group.totalUnits)} • ${group.entries.length} entries`,
                        equity: group.totalUnits,
                      })
                    }
                    className="inline-flex items-center gap-2 text-xs font-bold text-[#1F1B18] hover:text-[#C26D2D]"
                  >
                    <Calendar className="w-3.5 h-3.5 text-[#C26D2D]" />
                    <span>{formatDayHeading(group.dateKey)}</span>
                  </button>

                  <div className="flex items-center gap-2">
                    <ShareMealButton
                      foodLogIds={group.entries.map((e) => e.id)}
                      label="Share"
                      mealName={formatDayHeading(group.dateKey)}
                    />
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-black tabular-nums ${
                        group.hasClear || group.totalUnits === 0
                          ? 'bg-[#3F7D58]/15 text-[#3F7D58]'
                          : 'bg-[#C26D2D]/15 text-[#C26D2D]'
                      }`}
                    >
                      {formatUnits(group.totalUnits)}
                    </span>
                  </div>
                </div>

                <div className="divide-y divide-[#E8DFD1]/70">
                  {group.entries.map((item) => {
                    const units = getEntryUnits(item);
                    const clear = isClearDayEntry(item);
                    const zp = isZeroProofEntry(item);
                    return (
                      <div
                        key={item.id}
                        className="px-4 py-2.5 flex items-center justify-between gap-3 bg-[#FFFDF9]/70"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            {clear ? (
                              <Leaf className="w-3.5 h-3.5 text-[#3F7D58] shrink-0" />
                            ) : zp ? (
                              <Sparkles className="w-3.5 h-3.5 text-[#3F7D58] shrink-0" />
                            ) : (
                              <Wine className="w-3.5 h-3.5 text-[#C26D2D] shrink-0" />
                            )}
                            <span className="text-sm font-bold text-[#1F1B18] truncate">
                              {item.name}
                            </span>
                            {clear && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#3F7D58]/15 text-[#3F7D58]">
                                Clear Day
                              </span>
                            )}
                            {zp && !clear && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#3F7D58]/15 text-[#3F7D58]">
                                Zero-Proof
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-[#6E6359]">
                            {item.consumedAt ? formatHHMM12h(item.consumedAt) : 'Logged'}
                            {typeof item.volumeOz === 'number' && item.volumeOz > 0
                              ? ` • ${item.volumeOz} oz`
                              : ''}
                            {typeof item.abvPct === 'number' && !clear
                              ? ` • ${item.abvPct}% ABV`
                              : ''}
                            {item.drinkCategory ? ` • ${item.drinkCategory}` : ''}
                          </p>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <span
                            className={`text-sm font-black tabular-nums mr-1.5 ${
                              clear || zp || units === 0
                                ? 'text-[#3F7D58]'
                                : 'text-[#C26D2D]'
                            }`}
                          >
                            {formatUnits(units)}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setTimingEditor({
                                entry: item,
                                targetDate: item.date || getTodayIso(),
                                targetTime: item.consumedAt || '20:00',
                              })
                            }
                            aria-label={`Adjust time for ${item.name}`}
                            className="p-1.5 rounded-lg text-[#6E6359] hover:text-[#1F1B18] hover:bg-[#FAF6F0]"
                          >
                            <Clock className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteEntry(item)}
                            aria-label={`Delete ${item.name}`}
                            className="p-1.5 rounded-lg text-[#6E6359] hover:text-[#C26D2D] hover:bg-[#FAF6F0]"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Timing Editor Drawer/Floating Card */}
      {timingEditor && (
        <div className="fixed bottom-4 inset-x-4 max-w-lg mx-auto z-50 rounded-2xl bg-[#1F1B18] text-[#FAF6F0] border border-[#352F2A] shadow-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#F5B076]">
                Adjust Pour Timing
              </p>
              <p className="text-sm font-bold truncate">{timingEditor.entry.name}</p>
            </div>
            <button
              type="button"
              onClick={() => setTimingEditor(null)}
              aria-label="Close timing adjuster"
              className="p-1 rounded-lg hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              max={getTodayIso()}
              value={timingEditor.targetDate}
              onChange={(e) =>
                e.target.value &&
                setTimingEditor((prev) =>
                  prev ? { ...prev, targetDate: e.target.value } : null
                )
              }
              className="h-8 px-2.5 rounded-lg bg-[#2C2622] border border-[#423A34] text-xs font-bold text-[#FAF6F0]"
            />
            <button
              type="button"
              onClick={() =>
                setTimingEditor((prev) =>
                  prev
                    ? {
                        ...prev,
                        targetTime: minutesToHHMM(
                          hhmmToMinutes(prev.targetTime) - 30,
                          15
                        ),
                      }
                    : null
                )
              }
              className="px-2.5 h-8 rounded-lg bg-[#2C2622] hover:bg-[#3A322C] text-xs font-bold"
            >
              -30m
            </button>
            <input
              type="time"
              value={timingEditor.targetTime}
              onChange={(e) =>
                e.target.value &&
                setTimingEditor((prev) =>
                  prev ? { ...prev, targetTime: e.target.value } : null
                )
              }
              className="h-8 px-2.5 rounded-lg bg-[#2C2622] border border-[#423A34] text-xs font-bold text-[#FAF6F0]"
            />
            <button
              type="button"
              onClick={() =>
                setTimingEditor((prev) =>
                  prev
                    ? {
                        ...prev,
                        targetTime: minutesToHHMM(
                          hhmmToMinutes(prev.targetTime) + 30,
                          15
                        ),
                      }
                    : null
                )
              }
              className="px-2.5 h-8 rounded-lg bg-[#2C2622] hover:bg-[#3A322C] text-xs font-bold"
            >
              +30m
            </button>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setTimingEditor(null)}
              className="h-8 text-xs text-[#D7CCC0] hover:text-white hover:bg-white/10"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={savingTiming}
              onClick={handleApplyTimingUpdate}
              className="h-8 text-xs bg-[#C26D2D] hover:bg-[#AD5D23] text-white font-bold"
            >
              {savingTiming ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
              ) : (
                <Check className="w-3.5 h-3.5 mr-1" />
              )}
              Save Timing
            </Button>
          </div>
        </div>
      )}

      {/* Local Hybrid AI Log & Conversations */}
      <HybridTickerTerminal />
      <ChatHistoryLog />
      <MySharesSection />

      {/* Day Detail Sheet */}
      <VfDayDetail entry={selectedEntry} open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  );
}
