'use client';

import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HealthData, HistoryEntry, healthService } from '@/lib/health-service';
import { FoodLogEntry, formatHHMM12h } from '@/lib/food-exercise-types';
import {
  calculateStandardUnits,
  mlToOz,
  formatUnits,
  DRINK_PRESETS,
  computeTrendSummary,
  getEntryUnits,
  isClearDayEntry,
  isZeroProofEntry,
} from '@/lib/drink-units';
import { useUser, useFirestore, useCollection, useDoc, useMemoFirebase } from '@/firebase';
import { collection, doc, query, where } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { useHybridAi } from '@/components/hybrid-ai-provider';
import { HybridTickerTerminal } from '@/components/hybrid-ticker-terminal';
import { OutreachInlinePrompt } from '@/components/outreach-inline-prompt';
import { ShareMealButton } from '@/components/share-meal-button';
import { VfDayDetail } from '@/components/vf-day-detail';
import {
  Beer,
  Calendar,
  ChevronLeft,
  ChevronRight,
  CupSoda,
  Leaf,
  Martini,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wine,
} from 'lucide-react';

type DrinkPreset = (typeof DRINK_PRESETS)[number];

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

export interface DashboardPourInput {
  name: string;
  volumeOz: number;
  abvPct: number;
  units: number;
  category: string;
  zeroProof?: boolean;
  clearDay?: boolean;
  date: string;
  consumedAt: string;
}

export interface DashboardCardsProps {
  data: HealthData | null;
  isLoading?: boolean;
  onLogPour?: (pour: DashboardPourInput) => Promise<void> | void;
}

const SUNNY_SWAP_CORNER = [
  {
    title: 'Bitters + Crisp Soda Tall',
    pairing: 'Swapping round two after an IPA or Manhattan',
    note: 'A few dashes of aromatic bitters in chilled soda with an expressed orange peel keeps the ritual, aroma, and slow sip pace at practically 0.0u.',
    trivia: 'Booth trivia: One standard 1.0u unit equals 14g (0.6 fl oz) of pure alcohol — whether it is 12 oz at 5% lager, 5 oz at 12% wine, or 1.5 oz of 80-proof spirits.',
  },
  {
    title: 'Hop-Infused Sparkling Water',
    pairing: 'Easy weeknight cooler when you want pine & citrus aroma',
    note: 'Dry-hopped sparkling cans nail the Citra & Amarillo snap of an IPA with zero alcohol and crisp carbonation.',
    trivia: 'Booth trivia: Moving from a 16 oz 7% craft IPA (1.9u) to a 12 oz 4.5% session pilsner (0.9u) cuts more than half the units in the same glass.',
  },
  {
    title: 'NA Amaro & Tonic on Ice',
    pairing: 'Before-dinner spritz or late-evening nightcap',
    note: 'Gentian root and grapefruit peel give a proper grown-up bitterness so your hands stay busy without pushing tomorrow’s rolling average.',
    trivia: 'Booth trivia: A 6 oz restaurant wine pour at 14.5% ABV carries 1.5 standard units — 50% more than the textbook 5 oz, 12% reference glass.',
  },
  {
    title: 'Ginger Lime Highball',
    pairing: 'Post-work unwind or weekend porch drink',
    note: 'Fiery pressed ginger, half a lime, and crushed ice gives that clean throat hit most mocktails miss.',
    trivia: 'Booth trivia: Logging two Clear Days mid-week brings a steady 7-day average down faster than counting drops on Saturday.',
  },
];

function getLocalDateKeyOffset(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function formatDateHeading(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return "Today's Coaster";
  if (dateKey === shiftDateKey(todayKey, -1)) return "Yesterday's Coaster";
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function resolveCurrentHHMM(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function renderPresetIcon(preset: DrinkPreset) {
  if (preset.clearDay) return <Leaf className="w-3.5 h-3.5 text-[#3F7D58]" />;
  if (preset.zeroProof) return <Sparkles className="w-3.5 h-3.5 text-[#3F7D58]" />;
  if (preset.category === 'wine') return <Wine className="w-3.5 h-3.5 text-[#C26D2D]" />;
  if (preset.category === 'beer') return <Beer className="w-3.5 h-3.5 text-[#C26D2D]" />;
  if (preset.category === 'seltzer') return <CupSoda className="w-3.5 h-3.5 text-[#C26D2D]" />;
  return <Martini className="w-3.5 h-3.5 text-[#C26D2D]" />;
}

export function DashboardCards({ data, isLoading, onLogPour }: DashboardCardsProps) {
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();
  const { setEarningsModalOpen } = useHybridAi();

  const todayKey = useMemo(() => getLocalDateKeyOffset(0), []);
  const [selectedDateStr, setSelectedDateStr] = useState<string>(() => getLocalDateKeyOffset(0));

  // Quick Unit Calculator state
  const [volumeUnit, setVolumeUnit] = useState<'oz' | 'ml'>('oz');
  const [volumeInput, setVolumeInput] = useState<string>('12');
  const [abvInput, setAbvInput] = useState<string>('5');
  const [customName, setCustomName] = useState<string>('');
  const [calcExpanded, setCalcExpanded] = useState<boolean>(true);
  const [isLogging, setIsLogging] = useState<boolean>(false);

  // Sunny booth note cycler + Day detail sheet
  const [sunnyIndex, setSunnyIndex] = useState<number>(() => new Date().getDate() % SUNNY_SWAP_CORNER.length);
  const [daySheetOpen, setDaySheetOpen] = useState<boolean>(false);

  const cutoff90 = useMemo(() => getLocalDateKeyOffset(95), []);

  const userProfileRef = useMemoFirebase(() => {
    if (!user || !db) return null;
    return doc(db, 'users', user.uid);
  }, [user, db]);

  const { data: userProfileDoc } = useDoc<{ preferredZeroProofFlavors?: string[] }>(userProfileRef);

  const preferredFlavors =
    userProfileDoc?.preferredZeroProofFlavors ??
    (data as (HealthData & { preferredZeroProofFlavors?: string[] }) | null)
      ?.preferredZeroProofFlavors ??
    [];

  const logs90Query = useMemoFirebase(() => {
    if (!user || !db) return null;
    return query(
      collection(db, 'users', user.uid, 'food_log'),
      where('date', '>=', cutoff90)
    );
  }, [user, db, cutoff90]);

  const { data: rawLogs, isLoading: isLogsLoading } =
    useCollection<CoasterFoodLogEntry>(logs90Query);

  const activeLogs = useMemo(
    () => (rawLogs ?? []).filter((entry) => !entry.ignored),
    [rawLogs]
  );

  const selectedDayLogs = useMemo(() => {
    return activeLogs
      .filter((entry) => entry.date === selectedDateStr)
      .sort((a, b) => (b.consumedAt || '00:00').localeCompare(a.consumedAt || '00:00'));
  }, [activeLogs, selectedDateStr]);

  const trendSummary = useMemo(
    () => computeTrendSummary(activeLogs, selectedDateStr),
    [activeLogs, selectedDateStr]
  );

  const dayStats = useMemo(() => {
    let totalUnits = 0;
    let alcoholCount = 0;
    let zeroProofCount = 0;
    let clearCount = 0;

    for (const item of selectedDayLogs) {
      if (isClearDayEntry(item)) {
        clearCount += 1;
        continue;
      }
      const u = getEntryUnits(item);
      totalUnits += u;
      if (isZeroProofEntry(item) || u === 0) {
        zeroProofCount += 1;
      } else {
        alcoholCount += 1;
      }
    }

    totalUnits = Math.round(totalUnits * 10) / 10;
    const isClear = clearCount > 0 && alcoholCount === 0 && totalUnits === 0;
    const isZeroProofOnly = zeroProofCount > 0 && alcoholCount === 0 && totalUnits === 0;

    return {
      totalUnits,
      alcoholCount,
      zeroProofCount,
      isClear,
      isZeroProofOnly,
    };
  }, [selectedDayLogs]);

  const effectiveOz = useMemo(() => {
    const raw = parseFloat(volumeInput);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return volumeUnit === 'ml' ? mlToOz(raw) : raw;
  }, [volumeInput, volumeUnit]);

  const effectiveAbv = useMemo(() => {
    const raw = parseFloat(abvInput);
    if (!Number.isFinite(raw) || raw < 0) return 0;
    return Math.min(95, raw);
  }, [abvInput]);

  const liveCalculatorUnits = useMemo(
    () => calculateStandardUnits(effectiveOz, effectiveAbv),
    [effectiveOz, effectiveAbv]
  );

  const persistPour = async (pour: DashboardPourInput) => {
    if (onLogPour) {
      await onLogPour(pour);
      return;
    }
    if (!user || !db) return;
    await healthService.logFood(db, user.uid, {
      name: pour.name,
      portionG: Math.round(pour.volumeOz * 29.5735),
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      fiberG: 0,
      alcoholDrinks: pour.units,
      standardUnits: pour.units,
      volumeOz: Math.round(pour.volumeOz * 10) / 10,
      abvPct: Math.round(pour.abvPct * 10) / 10,
      drinkCategory: pour.category,
      isZeroProof: Boolean(pour.zeroProof),
      isClearDay: Boolean(pour.clearDay),
      source: 'user_estimate',
      meal: pour.clearDay ? 'snack' : 'dinner',
      consumedAt: pour.consumedAt,
      date: pour.date,
    } as FoodLogEntry);
  };

  const handlePresetTap = async (preset: DrinkPreset) => {
    if (!user && !onLogPour) {
      toast({
        variant: 'destructive',
        title: 'Sign in required',
        description: 'Sign in to save pours to your coaster.',
      });
      return;
    }
    setIsLogging(true);
    try {
      await persistPour({
        name: preset.label,
        volumeOz: preset.volumeOz,
        abvPct: preset.abvPct,
        units: preset.units,
        category: preset.category,
        zeroProof: preset.zeroProof,
        clearDay: preset.clearDay,
        date: selectedDateStr,
        consumedAt: resolveCurrentHHMM(),
      });
      toast({
        title: preset.clearDay
          ? 'Clear Day recorded (0.0u)'
          : `Added ${preset.shortLabel} (${formatUnits(preset.units)})`,
        description:
          selectedDateStr === todayKey ? 'Saved to Today’s Coaster.' : `Saved to ${selectedDateStr}.`,
      });
    } catch {
      toast({
        variant: 'destructive',
        title: 'Could not log pour',
        description: 'Try again in a moment.',
      });
    } finally {
      setIsLogging(false);
    }
  };

  const handleCustomLog = async () => {
    if (!user && !onLogPour) return;
    if (effectiveOz <= 0) {
      toast({
        variant: 'destructive',
        title: 'Enter a pour volume',
        description: 'Volume must be greater than 0.',
      });
      return;
    }
    const isZero = effectiveAbv === 0;
    const defaultLabel = isZero
      ? `Zero-Proof Pour (${Math.round(effectiveOz * 10) / 10} oz)`
      : `Pour (${Math.round(effectiveOz * 10) / 10} oz @ ${effectiveAbv}%)`;
    const drinkName = customName.trim() || defaultLabel;

    setIsLogging(true);
    try {
      await persistPour({
        name: drinkName,
        volumeOz: Math.round(effectiveOz * 10) / 10,
        abvPct: Math.round(effectiveAbv * 10) / 10,
        units: liveCalculatorUnits,
        category: isZero ? 'zero-proof' : 'cocktail',
        zeroProof: isZero,
        clearDay: false,
        date: selectedDateStr,
        consumedAt: resolveCurrentHHMM(),
      });
      toast({
        title: `Logged ${drinkName}`,
        description: `${formatUnits(liveCalculatorUnits)} added to your coaster.`,
      });
      setCustomName('');
    } catch {
      toast({
        variant: 'destructive',
        title: 'Could not save pour',
        description: 'Try again in a moment.',
      });
    } finally {
      setIsLogging(false);
    }
  };

  const handleToggleVolumeUnit = (nextUnit: 'oz' | 'ml') => {
    if (nextUnit === volumeUnit) return;
    const currentVal = parseFloat(volumeInput);
    if (Number.isFinite(currentVal) && currentVal > 0) {
      if (nextUnit === 'ml') {
        setVolumeInput(String(Math.round(currentVal * 29.5735)));
      } else {
        setVolumeInput(String(Math.round(mlToOz(currentVal) * 10) / 10));
      }
    } else {
      setVolumeInput(nextUnit === 'ml' ? '355' : '12');
    }
    setVolumeUnit(nextUnit);
  };

  const handleDeleteEntry = async (entry: CoasterFoodLogEntry) => {
    if (!user || !db) return;
    try {
      await healthService.setFoodEntryIgnored(db, user.uid, entry.id, true);
      toast({ title: 'Removed from coaster', description: entry.name });
    } catch {
      toast({ variant: 'destructive', title: 'Could not remove pour' });
    }
  };

  const handleMoveToPreviousDay = async (entry: CoasterFoodLogEntry) => {
    if (!user || !db) return;
    const prevDate = shiftDateKey(selectedDateStr, -1);
    try {
      await healthService.updateLedgerEntryTiming(db, user.uid, {
        id: entry.id,
        type: 'food',
        oldDate: selectedDateStr,
        newDate: prevDate,
        newTime: entry.consumedAt || '22:00',
        meal: 'dinner',
        todayIso: todayKey,
      });
      toast({
        title: 'Moved to night before',
        description: `${entry.name} moved to ${prevDate}.`,
      });
    } catch {
      toast({ variant: 'destructive', title: 'Could not move pour date' });
    }
  };

  const sunnyCard = SUNNY_SWAP_CORNER[sunnyIndex % SUNNY_SWAP_CORNER.length];

  const selectedDayEntry: HistoryEntry = {
    isoDate: selectedDateStr,
    date: formatDateHeading(selectedDateStr, todayKey),
    gain: 0,
    status: 'Stable',
    detail: `${formatUnits(dayStats.totalUnits)} • ${dayStats.alcoholCount} pours`,
    equity: dayStats.totalUnits,
  };

  return (
    <div className="space-y-5">
      {/* Main Today Coaster Hero Card */}
      <Card className="bg-[#FFFDF9] border border-[#E8DFD1] shadow-sm rounded-3xl overflow-hidden">
        <CardHeader className="pb-4 border-b border-[#E8DFD1]/80 bg-gradient-to-br from-[#FFFDF9] via-[#FAF6F0] to-[#F6EDE0]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-[#C26D2D]">
                Coaster Daily Ledger
              </p>
              <CardTitle className="text-xl sm:text-2xl font-black tracking-tight text-[#1F1B18] mt-0.5">
                {formatDateHeading(selectedDateStr, todayKey)}
              </CardTitle>
            </div>

            {/* Date Navigator */}
            <div className="inline-flex items-center gap-1 rounded-full bg-[#FFFDF9] border border-[#E8DFD1] px-2 py-1 shadow-xs">
              <button
                type="button"
                aria-label="Previous day"
                onClick={() => setSelectedDateStr((prev) => shiftDateKey(prev, -1))}
                className="p-1.5 rounded-full hover:bg-[#FAF6F0] text-[#6E6359] hover:text-[#1F1B18]"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <label className="inline-flex items-center gap-1.5 px-2 text-xs font-semibold text-[#1F1B18] cursor-pointer">
                <Calendar className="w-3.5 h-3.5 text-[#C26D2D]" />
                <input
                  type="date"
                  max={todayKey}
                  value={selectedDateStr}
                  onChange={(e) => {
                    if (e.target.value && e.target.value <= todayKey) {
                      setSelectedDateStr(e.target.value);
                    }
                  }}
                  className="bg-transparent text-xs font-bold text-[#1F1B18] focus:outline-none cursor-pointer"
                />
              </label>
              <button
                type="button"
                aria-label="Next day"
                disabled={selectedDateStr >= todayKey}
                onClick={() =>
                  setSelectedDateStr((prev) =>
                    prev < todayKey ? shiftDateKey(prev, 1) : prev
                  )
                }
                className="p-1.5 rounded-full hover:bg-[#FAF6F0] text-[#6E6359] hover:text-[#1F1B18] disabled:opacity-35"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Big Standard Drink Units Display + Status Badges */}
          <div className="mt-5 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-baseline gap-3">
                <span
                  className={`text-5xl sm:text-6xl font-black tracking-tight tabular-nums ${
                    dayStats.isClear || (dayStats.totalUnits === 0 && dayStats.isZeroProofOnly)
                      ? 'text-[#3F7D58]'
                      : dayStats.totalUnits > 0
                        ? 'text-[#C26D2D]'
                        : 'text-[#1F1B18]'
                  }`}
                >
                  {isLogsLoading && selectedDayLogs.length === 0
                    ? '—'
                    : formatUnits(dayStats.totalUnits)}
                </span>
                <span className="text-sm font-semibold text-[#6E6359]">
                  standard units
                </span>
              </div>
              <p className="text-xs text-[#6E6359]">
                1.0u = 14g (0.6 fl oz) pure alcohol • oz × ABV% ÷ 60
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {dayStats.isClear && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#3F7D58] text-white px-3 py-1 text-xs font-bold shadow-xs">
                  <Leaf className="w-3.5 h-3.5" />
                  Clear Day (0.0u)
                </span>
              )}
              {!dayStats.isClear && dayStats.isZeroProofOnly && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#3F7D58]/15 border border-[#3F7D58]/30 text-[#3F7D58] px-3 py-1 text-xs font-bold">
                  <Sparkles className="w-3.5 h-3.5" />
                  Zero-Proof Night
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFFDF9] border border-[#E8DFD1] px-3 py-1 text-xs font-semibold text-[#1F1B18]">
                <Wine className="w-3.5 h-3.5 text-[#C26D2D]" />
                {dayStats.alcoholCount} {dayStats.alcoholCount === 1 ? 'pour' : 'pours'}
                {dayStats.zeroProofCount > 0 ? ` + ${dayStats.zeroProofCount} NA` : ''}
              </span>
            </div>
          </div>

          {/* 3-Stat Coaster Rhythm Strip */}
          <div className="grid grid-cols-3 gap-2.5 mt-5">
            <div className="rounded-2xl bg-[#FFFDF9] border border-[#E8DFD1] px-3.5 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#6E6359]">
                7d Rolling Avg
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-lg font-black text-[#1F1B18] tabular-nums">
                  {formatUnits(trendSummary.sevenDayAvg)}
                </span>
                {trendSummary.rollingVsPriorPct !== null && (
                  <span
                    className={`inline-flex items-center text-[11px] font-bold tabular-nums ${
                      trendSummary.rollingVsPriorPct <= 0
                        ? 'text-[#3F7D58]'
                        : 'text-[#C26D2D]'
                    }`}
                  >
                    {trendSummary.rollingVsPriorPct <= 0 ? (
                      <TrendingDown className="w-3 h-3 mr-0.5" />
                    ) : (
                      <TrendingUp className="w-3 h-3 mr-0.5" />
                    )}
                    {trendSummary.rollingVsPriorPct > 0 ? '+' : ''}
                    {trendSummary.rollingVsPriorPct}%
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-2xl bg-[#FFFDF9] border border-[#E8DFD1] px-3.5 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#6E6359]">
                Clear Days (30d)
              </p>
              <p className="text-lg font-black text-[#3F7D58] tabular-nums mt-0.5">
                {trendSummary.clearDaysLast30}{' '}
                <span className="text-xs font-semibold text-[#6E6359]">days</span>
              </p>
            </div>

            <div className="rounded-2xl bg-[#FFFDF9] border border-[#E8DFD1] px-3.5 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#6E6359]">
                30d Total
              </p>
              <p className="text-lg font-black text-[#C26D2D] tabular-nums mt-0.5">
                {formatUnits(trendSummary.thirtyDayTotal)}
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-5 space-y-6">
          {/* 1-Tap Preset Pour Strip */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#6E6359]">
                1-Tap Preset Pours
              </h3>
              {preferredFlavors.length > 0 && (
                <span className="text-[11px] font-medium text-[#3F7D58]">
                  Swaps tuned to {preferredFlavors[0]}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {DRINK_PRESETS.map((preset) => {
                const isSage = Boolean(preset.clearDay || preset.zeroProof);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={isLogging || isLoading}
                    onClick={() => handlePresetTap(preset)}
                    className={`group rounded-2xl border px-3 py-2.5 text-left transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 ${
                      isSage
                        ? 'bg-[#3F7D58]/8 border-[#3F7D58]/25 hover:bg-[#3F7D58]/14 hover:border-[#3F7D58]'
                        : 'bg-[#FAF6F0] border-[#E8DFD1] hover:bg-[#F5EBDC] hover:border-[#C26D2D]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1F1B18] truncate">
                        {renderPresetIcon(preset)}
                        <span className="truncate">{preset.shortLabel}</span>
                      </span>
                      <span
                        className={`text-xs font-black tabular-nums shrink-0 ${
                          isSage ? 'text-[#3F7D58]' : 'text-[#C26D2D]'
                        }`}
                      >
                        {formatUnits(preset.units)}
                      </span>
                    </div>
                    <p className="text-[10px] text-[#6E6359] mt-0.5 truncate">
                      {preset.clearDay
                        ? 'Record intentional 0.0u day'
                        : `${preset.volumeOz} oz • ${preset.abvPct}% ABV`}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Interactive Quick Unit Calculator */}
          <div className="rounded-2xl bg-[#FAF6F0] border border-[#E8DFD1] p-4 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setCalcExpanded((prev) => !prev)}
                className="flex items-center gap-2 text-left"
              >
                <SlidersHorizontal className="w-4 h-4 text-[#C26D2D]" />
                <span className="text-sm font-bold text-[#1F1B18]">
                  Quick Unit Calculator
                </span>
              </button>

              <div className="inline-flex rounded-full bg-[#FFFDF9] border border-[#E8DFD1] p-0.5">
                {(['oz', 'ml'] as const).map((unit) => (
                  <button
                    key={unit}
                    type="button"
                    onClick={() => handleToggleVolumeUnit(unit)}
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase transition-colors ${
                      volumeUnit === unit
                        ? 'bg-[#1F1B18] text-[#FAF6F0]'
                        : 'text-[#6E6359] hover:text-[#1F1B18]'
                    }`}
                  >
                    {unit}
                  </button>
                ))}
              </div>
            </div>

            {calcExpanded && (
              <div className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-5 space-y-1">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-[#6E6359]">
                      Drink Name (optional)
                    </label>
                    <Input
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder="e.g. Hazy IPA, Pinot Noir, Negroni"
                      className="h-9 bg-[#FFFDF9] border-[#E8DFD1] text-sm"
                    />
                  </div>

                  <div className="sm:col-span-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-[#6E6359]">
                        Volume ({volumeUnit})
                      </label>
                      {volumeUnit === 'ml' && (
                        <span className="text-[10px] text-[#6E6359] tabular-nums">
                          {Math.round(effectiveOz * 10) / 10} oz
                        </span>
                      )}
                    </div>
                    <Input
                      type="number"
                      min="0.5"
                      step={volumeUnit === 'oz' ? '0.5' : '15'}
                      value={volumeInput}
                      onChange={(e) => setVolumeInput(e.target.value)}
                      className="h-9 bg-[#FFFDF9] border-[#E8DFD1] text-sm tabular-nums"
                    />
                  </div>

                  <div className="sm:col-span-2 space-y-1">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-[#6E6359]">
                      ABV %
                    </label>
                    <Input
                      type="number"
                      min="0"
                      max="95"
                      step="0.1"
                      value={abvInput}
                      onChange={(e) => setAbvInput(e.target.value)}
                      className="h-9 bg-[#FFFDF9] border-[#E8DFD1] text-sm tabular-nums"
                    />
                  </div>

                  <div className="sm:col-span-2 flex items-center justify-between sm:justify-end gap-2 bg-[#FFFDF9] border border-[#E8DFD1] rounded-xl px-3 h-9">
                    <span className="text-[10px] uppercase font-bold text-[#6E6359] sm:hidden">
                      Preview
                    </span>
                    <span
                      className={`text-base font-black tabular-nums ${
                        effectiveAbv === 0 ? 'text-[#3F7D58]' : 'text-[#C26D2D]'
                      }`}
                    >
                      {formatUnits(liveCalculatorUnits)}
                    </span>
                  </div>
                </div>

                {/* Tactile Volume + ABV Sliders */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-[#6E6359]">
                      <span>Pour size</span>
                      <span className="font-semibold text-[#1F1B18] tabular-nums">
                        {volumeInput || 0} {volumeUnit}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={volumeUnit === 'oz' ? 1 : 30}
                      max={volumeUnit === 'oz' ? 24 : 750}
                      step={volumeUnit === 'oz' ? 0.5 : 15}
                      value={parseFloat(volumeInput) || (volumeUnit === 'oz' ? 12 : 355)}
                      onChange={(e) => setVolumeInput(e.target.value)}
                      className="w-full accent-[#C26D2D] cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-[#6E6359]">
                      <span>Strength (ABV)</span>
                      <span className="font-semibold text-[#1F1B18] tabular-nums">
                        {effectiveAbv}% ABV
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={50}
                      step={0.5}
                      value={effectiveAbv}
                      onChange={(e) => setAbvInput(e.target.value)}
                      className="w-full accent-[#C26D2D] cursor-pointer"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: '12oz 5%', vol: 12, abv: 5 },
                      { label: '16oz 7%', vol: 16, abv: 7 },
                      { label: '5oz 12%', vol: 5, abv: 12 },
                      { label: '1.5oz 40%', vol: 1.5, abv: 40 },
                    ].map((quick) => (
                      <button
                        key={quick.label}
                        type="button"
                        onClick={() => {
                          setVolumeUnit('oz');
                          setVolumeInput(String(quick.vol));
                          setAbvInput(String(quick.abv));
                        }}
                        className="px-2 py-1 rounded-lg bg-[#FFFDF9] border border-[#E8DFD1] hover:border-[#C26D2D] text-[11px] font-semibold text-[#6E6359] hover:text-[#1F1B18]"
                      >
                        {quick.label}
                      </button>
                    ))}
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    disabled={isLogging || effectiveOz <= 0}
                    onClick={handleCustomLog}
                    className="bg-[#1F1B18] hover:bg-[#352F2A] text-[#FAF6F0] rounded-full px-4 font-bold text-xs"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1.5" />
                    Log This Pour ({formatUnits(liveCalculatorUnits)})
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Selected Day Logged Pours List */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#6E6359]">
                On This Coaster ({selectedDayLogs.length})
              </h3>
              <div className="flex items-center gap-2">
                {selectedDayLogs.length > 0 && (
                  <ShareMealButton
                    foodLogIds={selectedDayLogs.map((l) => l.id)}
                    label="Share round"
                    mealName={formatDateHeading(selectedDateStr, todayKey)}
                  />
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setDaySheetOpen(true)}
                  className="h-7 px-2.5 text-xs border-[#E8DFD1] text-[#1F1B18] bg-[#FFFDF9]"
                >
                  Edit pours
                </Button>
              </div>
            </div>

            {selectedDayLogs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#E8DFD1] bg-[#FAF6F0]/60 p-4 text-center text-xs text-[#6E6359]">
                No pours logged yet for {selectedDateStr}. Tap any preset above to start your coaster.
              </div>
            ) : (
              <div className="space-y-2">
                {selectedDayLogs.map((item) => {
                  const units = getEntryUnits(item);
                  const isClear = isClearDayEntry(item);
                  const isZP = isZeroProofEntry(item);
                  return (
                    <div
                      key={item.id}
                      className="rounded-2xl bg-[#FAF6F0] border border-[#E8DFD1] px-3.5 py-2.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
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
                        <p className="text-[11px] text-[#6E6359] mt-0.5">
                          {item.consumedAt ? formatHHMM12h(item.consumedAt) : 'Logged'}
                          {typeof item.volumeOz === 'number' && item.volumeOz > 0
                            ? ` • ${item.volumeOz} oz`
                            : ''}
                          {typeof item.abvPct === 'number' && !isClear
                            ? ` • ${item.abvPct}% ABV`
                            : ''}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={`text-sm font-black tabular-nums mr-1 ${
                            isClear || isZP || units === 0
                              ? 'text-[#3F7D58]'
                              : 'text-[#C26D2D]'
                          }`}
                        >
                          {formatUnits(units)}
                        </span>
                        {selectedDateStr === todayKey && (
                          <button
                            type="button"
                            onClick={() => handleMoveToPreviousDay(item)}
                            title="Move to yesterday"
                            className="px-2 py-1 rounded-lg text-[10px] font-semibold text-[#6E6359] hover:text-[#1F1B18] hover:bg-[#FFFDF9] border border-transparent hover:border-[#E8DFD1]"
                          >
                            Last night?
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteEntry(item)}
                          aria-label={`Delete ${item.name}`}
                          className="p-1.5 rounded-lg text-[#6E6359] hover:text-[#C26D2D] hover:bg-[#FFFDF9]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sunny's Booth-Buddy Note & Swap Corner */}
          <div className="rounded-2xl bg-gradient-to-br from-[#FBF5EC] to-[#F3EADF] border border-[#E8DFD1] p-4 space-y-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-[#C26D2D]/15 border border-[#C26D2D]/30 flex items-center justify-center text-[#C26D2D]">
                  <Sparkles className="w-3.5 h-3.5" />
                </span>
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-[#C26D2D]">
                    Sunny&apos;s Swap Corner
                  </p>
                  <p className="text-sm font-bold text-[#1F1B18]">{sunnyCard.title}</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setSunnyIndex((prev) => (prev + 1) % SUNNY_SWAP_CORNER.length)
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#FFFDF9] border border-[#E8DFD1] hover:border-[#C26D2D] text-[11px] font-semibold text-[#6E6359] hover:text-[#1F1B18]"
                >
                  <RefreshCw className="w-3 h-3" />
                  Next idea
                </button>
                <button
                  type="button"
                  onClick={() => setEarningsModalOpen(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#1F1B18] text-[#FAF6F0] text-[11px] font-bold hover:bg-[#352F2A]"
                >
                  Sunny Check-In
                </button>
              </div>
            </div>

            <p className="text-xs font-semibold text-[#3F7D58]">
              Good fit: {sunnyCard.pairing}
            </p>
            <p className="text-xs text-[#1F1B18]/90 leading-relaxed">{sunnyCard.note}</p>
            <p className="text-[11px] text-[#6E6359] italic pt-1 border-t border-[#E8DFD1]/80">
              {sunnyCard.trivia}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Companion Check-In Prompt & Local AI Terminal */}
      <OutreachInlinePrompt variant="idle" />
      <HybridTickerTerminal healthData={data} targetDateIso={selectedDateStr} />

      {/* Detailed Sheet for Selected Date */}
      <VfDayDetail
        entry={selectedDayEntry}
        dateKey={selectedDateStr}
        open={daySheetOpen}
        onOpenChange={setDaySheetOpen}
      />
    </div>
  );
}
