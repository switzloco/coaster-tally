'use client';

import React, { useMemo, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HistoryEntry, healthService } from '@/lib/health-service';
import { FoodLogEntry, formatHHMM12h } from '@/lib/food-exercise-types';
import {
  calculateStandardUnits,
  formatUnits,
  DRINK_PRESETS,
  getEntryUnits,
  isClearDayEntry,
  isZeroProofEntry,
} from '@/lib/drink-units';
import { useUser, useFirestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, doc, setDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import {
  Check,
  Leaf,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Wine,
  X,
} from 'lucide-react';

interface CoasterFoodLogEntry extends FoodLogEntry {
  id: string;
}

export interface VfDayDetailProps {
  entry: HistoryEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dateKey?: string;
  onLogsChanged?: () => void;
}

function formatReadableDate(isoDate: string, fallback?: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return fallback || 'Selected Day';
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function resolveCurrentHHMM(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export function VfDayDetail({
  entry,
  open,
  onOpenChange,
  dateKey,
  onLogsChanged,
}: VfDayDetailProps) {
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();

  const resolvedDateKey = useMemo(() => {
    if (dateKey && /^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
    if (entry?.isoDate && /^\d{4}-\d{2}-\d{2}$/.test(entry.isoDate)) return entry.isoDate;
    if (entry?.date && /^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return entry.date;
    return '';
  }, [dateKey, entry]);

  const dayLogsQuery = useMemoFirebase(() => {
    if (!open || !user || !db || !resolvedDateKey) return null;
    return query(
      collection(db, 'users', user.uid, 'food_log'),
      where('date', '==', resolvedDateKey)
    );
  }, [open, user, db, resolvedDateKey]);

  const { data: rawLogs, isLoading } = useCollection<CoasterFoodLogEntry>(dayLogsQuery);

  const pours = useMemo(() => {
    const active = (rawLogs ?? []).filter((item) => !item.ignored);
    return [...active].sort((a, b) => {
      const ta = a.consumedAt || '00:00';
      const tb = b.consumedAt || '00:00';
      return tb.localeCompare(ta);
    });
  }, [rawLogs]);

  const summary = useMemo(() => {
    let totalUnits = 0;
    let alcoholPours = 0;
    let zeroProofSwaps = 0;
    let clearEntries: CoasterFoodLogEntry[] = [];

    for (const item of pours) {
      if (isClearDayEntry(item)) {
        clearEntries.push(item);
        continue;
      }
      const units = getEntryUnits(item);
      totalUnits += units;
      if (isZeroProofEntry(item) || units === 0) {
        zeroProofSwaps += 1;
      } else {
        alcoholPours += 1;
      }
    }

    totalUnits = Math.round(totalUnits * 10) / 10;
    const isClearDay = clearEntries.length > 0 && alcoholPours === 0 && totalUnits === 0;
    return {
      totalUnits,
      alcoholPours,
      zeroProofSwaps,
      clearEntries,
      isClearDay,
    };
  }, [pours]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editOz, setEditOz] = useState('');
  const [editAbv, setEditAbv] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  const startEditing = (item: CoasterFoodLogEntry) => {
    setEditingId(item.id);
    setEditName(item.name || '');
    const oz =
      typeof item.volumeOz === 'number' && item.volumeOz > 0
        ? item.volumeOz
        : item.portionG > 0
          ? Math.round((item.portionG / 29.5735) * 10) / 10
          : 12;
    const abv =
      typeof item.abvPct === 'number' && item.abvPct >= 0
        ? item.abvPct
        : getEntryUnits(item) > 0 && oz > 0
          ? Math.round(((getEntryUnits(item) * 0.6) / oz) * 1000) / 10
          : 5;
    setEditOz(String(oz));
    setEditAbv(String(abv));
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditName('');
    setEditOz('');
    setEditAbv('');
  };

  const previewEditUnits = useMemo(() => {
    const oz = parseFloat(editOz);
    const abv = parseFloat(editAbv);
    if (!Number.isFinite(oz) || oz <= 0 || !Number.isFinite(abv) || abv < 0) return 0;
    return calculateStandardUnits(oz, abv);
  }, [editOz, editAbv]);

  const handleSaveEdit = async (item: CoasterFoodLogEntry) => {
    if (!user || !db) return;
    const oz = parseFloat(editOz);
    const abv = parseFloat(editAbv);
    if (!editName.trim() || !Number.isFinite(oz) || oz <= 0 || !Number.isFinite(abv) || abv < 0) {
      toast({
        variant: 'destructive',
        title: 'Check volume & ABV',
        description: 'Enter a drink name, positive oz amount, and ABV >= 0%.',
      });
      return;
    }

    const nextUnits = calculateStandardUnits(oz, abv);
    setIsBusy(true);
    try {
      await setDoc(
        doc(db, 'users', user.uid, 'food_log', item.id),
        {
          name: editName.trim(),
          volumeOz: Math.round(oz * 10) / 10,
          abvPct: Math.round(abv * 10) / 10,
          portionG: Math.round(oz * 29.5735),
          standardUnits: nextUnits,
          alcoholDrinks: nextUnits,
          isZeroProof: abv === 0 && !isClearDayEntry(item),
          isClearDay: false,
        },
        { merge: true }
      );
      toast({
        title: 'Pour updated',
        description: `${editName.trim()} is now ${formatUnits(nextUnits)}.`,
      });
      cancelEditing();
      onLogsChanged?.();
    } catch {
      toast({
        variant: 'destructive',
        title: 'Could not update pour',
        description: 'Try again in a moment.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeletePour = async (item: CoasterFoodLogEntry) => {
    if (!user || !db) return;
    setIsBusy(true);
    try {
      await healthService.setFoodEntryIgnored(db, user.uid, item.id, true);
      toast({
        title: 'Removed from coaster',
        description: item.name,
      });
      onLogsChanged?.();
    } catch {
      toast({
        variant: 'destructive',
        title: 'Could not remove entry',
        description: 'Try again in a moment.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleToggleClearDay = async () => {
    if (!user || !db || !resolvedDateKey) return;
    setIsBusy(true);
    try {
      if (summary.isClearDay && summary.clearEntries.length > 0) {
        await Promise.all(
          summary.clearEntries.map((c) =>
            healthService.setFoodEntryIgnored(db, user.uid, c.id, true)
          )
        );
        toast({
          title: 'Clear Day removed',
          description: formatReadableDate(resolvedDateKey),
        });
      } else {
        const clearPreset = DRINK_PRESETS.find((p) => p.clearDay);
        await healthService.logFood(db, user.uid, {
          name: clearPreset?.label || 'Clear Day',
          portionG: 0,
          calories: 0,
          proteinG: 0,
          carbsG: 0,
          fatG: 0,
          fiberG: 0,
          alcoholDrinks: 0,
          standardUnits: 0,
          volumeOz: 0,
          abvPct: 0,
          drinkCategory: clearPreset?.category || 'clear-day',
          isZeroProof: false,
          isClearDay: true,
          source: 'user_estimate',
          meal: 'snack',
          consumedAt: resolveCurrentHHMM(),
          date: resolvedDateKey,
        } as FoodLogEntry);
        toast({
          title: 'Marked Clear Day (0.0u)',
          description: formatReadableDate(resolvedDateKey),
        });
      }
      onLogsChanged?.();
    } catch {
      toast({
        variant: 'destructive',
        title: 'Could not update Clear Day',
        description: 'Try again in a moment.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleQuickPresetAdd = async (presetId: string) => {
    if (!user || !db || !resolvedDateKey) return;
    const preset = DRINK_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setIsBusy(true);
    try {
      await healthService.logFood(db, user.uid, {
        name: preset.label,
        portionG: Math.round(preset.volumeOz * 29.5735),
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        fiberG: 0,
        alcoholDrinks: preset.units,
        standardUnits: preset.units,
        volumeOz: preset.volumeOz,
        abvPct: preset.abvPct,
        drinkCategory: preset.category,
        isZeroProof: Boolean(preset.zeroProof),
        isClearDay: Boolean(preset.clearDay),
        source: 'user_estimate',
        meal: 'dinner',
        consumedAt: resolveCurrentHHMM(),
        date: resolvedDateKey,
      } as FoodLogEntry);
      toast({
        title: `Logged ${preset.shortLabel}`,
        description: `${formatUnits(preset.units)} on ${formatReadableDate(resolvedDateKey)}`,
      });
      onLogsChanged?.();
    } catch {
      toast({
        variant: 'destructive',
        title: 'Could not log pour',
        description: 'Try again in a moment.',
      });
    } finally {
      setIsBusy(false);
    }
  };

  const quickPresets = useMemo(
    () => DRINK_PRESETS.filter((p) => !p.clearDay).slice(0, 4),
    []
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto bg-[#FAF6F0] border-l border-[#E8DFD1] text-[#1F1B18]">
        <SheetHeader className="pb-4 border-b border-[#E8DFD1]">
          <div className="flex items-start justify-between gap-3 pr-6">
            <div>
              <SheetTitle className="text-xl font-bold tracking-tight text-[#1F1B18]">
                {formatReadableDate(resolvedDateKey, entry?.date)}
              </SheetTitle>
              <SheetDescription className="text-xs text-[#6E6359] mt-0.5">
                {resolvedDateKey || 'Coaster day breakdown'}
              </SheetDescription>
            </div>
            <div
              className={`px-3 py-1.5 rounded-full text-sm font-black tabular-nums border ${
                summary.isClearDay || summary.totalUnits === 0
                  ? 'bg-[#3F7D58]/10 text-[#3F7D58] border-[#3F7D58]/25'
                  : 'bg-[#C26D2D]/10 text-[#C26D2D] border-[#C26D2D]/25'
              }`}
            >
              {formatUnits(summary.totalUnits)}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-3">
            {summary.isClearDay && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#3F7D58] text-white px-2.5 py-0.5 text-[11px] font-bold">
                <Leaf className="w-3 h-3" />
                Clear Day
              </span>
            )}
            {summary.alcoholPours > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#FFFDF9] border border-[#E8DFD1] text-[#1F1B18] px-2.5 py-0.5 text-[11px] font-semibold">
                <Wine className="w-3 h-3 text-[#C26D2D]" />
                {summary.alcoholPours} {summary.alcoholPours === 1 ? 'pour' : 'pours'}
              </span>
            )}
            {summary.zeroProofSwaps > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#3F7D58]/10 border border-[#3F7D58]/25 text-[#3F7D58] px-2.5 py-0.5 text-[11px] font-semibold">
                <Sparkles className="w-3 h-3" />
                {summary.zeroProofSwaps} zero-proof {summary.zeroProofSwaps === 1 ? 'swap' : 'swaps'}
              </span>
            )}
          </div>
        </SheetHeader>

        <div className="space-y-5 py-5">
          {/* Quick Clear Day Toggle */}
          <div className="rounded-2xl bg-[#FFFDF9] border border-[#E8DFD1] p-3.5 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-[#1F1B18]">
                {summary.isClearDay ? 'Clear Day recorded' : 'Mark this a Clear Day?'}
              </p>
              <p className="text-xs text-[#6E6359]">
                {summary.alcoholPours > 0
                  ? 'Remove alcoholic pours below first to mark 0.0u Clear Day.'
                  : summary.isClearDay
                    ? 'Counted toward your 30-day Clear Days rhythm.'
                    : 'Records an intentional 0.0u day on your Coaster calendar.'}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={isBusy || summary.alcoholPours > 0 || !resolvedDateKey}
              onClick={handleToggleClearDay}
              variant={summary.isClearDay ? 'outline' : 'default'}
              className={
                summary.isClearDay
                  ? 'border-[#E8DFD1] text-[#6E6359] hover:text-[#1F1B18] shrink-0'
                  : 'bg-[#3F7D58] hover:bg-[#346949] text-white shrink-0'
              }
            >
              <Leaf className="w-3.5 h-3.5 mr-1.5" />
              {summary.isClearDay ? 'Unmark' : 'Clear Day'}
            </Button>
          </div>

          {/* Pour List */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#6E6359]">
                Logged Pours &amp; Swaps
              </h3>
              <span className="text-xs text-[#6E6359] tabular-nums">
                {pours.length} {pours.length === 1 ? 'entry' : 'entries'}
              </span>
            </div>

            {isLoading && (
              <div className="rounded-2xl bg-[#FFFDF9] border border-[#E8DFD1] p-6 text-center text-xs text-[#6E6359]">
                Loading pours for this day...
              </div>
            )}

            {!isLoading && pours.length === 0 && (
              <div className="rounded-2xl bg-[#FFFDF9] border border-dashed border-[#E8DFD1] p-6 text-center space-y-1">
                <p className="text-sm font-semibold text-[#1F1B18]">Quiet coaster</p>
                <p className="text-xs text-[#6E6359]">
                  Nothing logged on this date yet. Add a pour below or mark it Clear.
                </p>
              </div>
            )}

            {pours.map((item) => {
              const units = getEntryUnits(item);
              const isClear = isClearDayEntry(item);
              const isZP = isZeroProofEntry(item);
              const isEditing = editingId === item.id;

              if (isEditing) {
                return (
                  <div
                    key={item.id}
                    className="rounded-2xl bg-[#FFFDF9] border-2 border-[#C26D2D]/40 p-3.5 space-y-3"
                  >
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold uppercase text-[#6E6359]">
                        Drink Name
                      </label>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-9 bg-white border-[#E8DFD1] text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[11px] font-bold uppercase text-[#6E6359]">
                          Oz
                        </label>
                        <Input
                          type="number"
                          step="0.5"
                          min="0.5"
                          value={editOz}
                          onChange={(e) => setEditOz(e.target.value)}
                          className="h-9 bg-white border-[#E8DFD1] text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-bold uppercase text-[#6E6359]">
                          ABV %
                        </label>
                        <Input
                          type="number"
                          step="0.1"
                          min="0"
                          max="95"
                          value={editAbv}
                          onChange={(e) => setEditAbv(e.target.value)}
                          className="h-9 bg-white border-[#E8DFD1] text-sm"
                        />
                      </div>
                      <div className="flex flex-col justify-end pb-1.5 text-right">
                        <span className="text-[10px] uppercase font-bold text-[#6E6359]">
                          Units
                        </span>
                        <span className="text-base font-black text-[#C26D2D] tabular-nums">
                          {formatUnits(previewEditUnits)}
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={cancelEditing}
                        disabled={isBusy}
                        className="h-8 text-xs text-[#6E6359]"
                      >
                        <X className="w-3.5 h-3.5 mr-1" />
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => handleSaveEdit(item)}
                        className="h-8 text-xs bg-[#1F1B18] hover:bg-[#352F2A] text-white"
                      >
                        <Check className="w-3.5 h-3.5 mr-1" />
                        Save
                      </Button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={item.id}
                  className="rounded-2xl bg-[#FFFDF9] border border-[#E8DFD1] p-3.5 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-[#1F1B18] truncate">
                        {item.name}
                      </span>
                      {isClear && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#3F7D58]/15 text-[#3F7D58]">
                          Clear Day
                        </span>
                      )}
                      {isZP && !isClear && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#3F7D58]/15 text-[#3F7D58]">
                          Zero-Proof
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#6E6359]">
                      {item.consumedAt && <span>{formatHHMM12h(item.consumedAt)}</span>}
                      {typeof item.volumeOz === 'number' && item.volumeOz > 0 && (
                        <span>• {item.volumeOz} oz</span>
                      )}
                      {typeof item.abvPct === 'number' && !isClear && (
                        <span>• {item.abvPct}% ABV</span>
                      )}
                    </div>

                    {item.alternativeSuggested && (
                      <p className="text-[11px] text-[#3F7D58] font-medium">
                        Sunny swap idea: {item.alternativeSuggested}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`text-sm font-black tabular-nums mr-1 ${
                        isClear || isZP || units === 0 ? 'text-[#3F7D58]' : 'text-[#C26D2D]'
                      }`}
                    >
                      {formatUnits(units)}
                    </span>
                    {!isClear && (
                      <button
                        type="button"
                        onClick={() => startEditing(item)}
                        disabled={isBusy}
                        aria-label={`Edit ${item.name}`}
                        className="p-1.5 rounded-lg text-[#6E6359] hover:text-[#1F1B18] hover:bg-[#FAF6F0] transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeletePour(item)}
                      disabled={isBusy}
                      aria-label={`Delete ${item.name}`}
                      className="p-1.5 rounded-lg text-[#6E6359] hover:text-[#C26D2D] hover:bg-[#FAF6F0] transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick Add Pour to this Date */}
          {resolvedDateKey && (
            <div className="pt-2 border-t border-[#E8DFD1] space-y-2.5">
              <p className="text-xs font-bold uppercase tracking-wider text-[#6E6359]">
                Quick-Add Pour to This Date
              </p>
              <div className="flex flex-wrap gap-2">
                {quickPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleQuickPresetAdd(preset.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#FFFDF9] border border-[#E8DFD1] hover:border-[#C26D2D] text-xs font-semibold text-[#1F1B18] transition-colors"
                  >
                    <Plus className="w-3 h-3 text-[#C26D2D]" />
                    <span>{preset.shortLabel}</span>
                    <span className="text-[#C26D2D] font-bold tabular-nums">
                      {formatUnits(preset.units)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export const VFDayDetail = VfDayDetail;
