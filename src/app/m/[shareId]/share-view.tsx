'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUser } from '@/firebase';
import { FoodLogEntry, SharedMealItem } from '@/lib/food-exercise-types';
import { logSharedMeal, logEditedMeal } from '@/app/actions/share-meal';
import { editSharedMeal } from '@/app/actions/edit-shared-meal';
import { assessSharedMeal } from '@/app/actions/welcome-assessment';
import {
  formatUnits,
  getEntryUnits,
  isClearDayEntry,
  isZeroProofEntry,
} from '@/lib/drink-units';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft,
  Check,
  Leaf,
  Loader2,
  Plus,
  Sparkles,
  Wand2,
  Wine,
} from 'lucide-react';

interface CoasterShareItem extends SharedMealItem {
  standardUnits?: number;
  isClearDay?: boolean;
  isZeroProof?: boolean;
  volumeOz?: number;
  abvPct?: number;
  drinkCategory?: string;
}

export interface ShareDTO {
  id: string;
  title: string;
  createdByName?: string;
  items: CoasterShareItem[];
  totals: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
    standardUnits?: number;
  };
  totalUnits?: number;
  logCount: number;
  viewCount: number;
  cfoAssessment?: string;
}

function getLocalDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function itemUnits(item: CoasterShareItem): number {
  return getEntryUnits({
    ...item,
    id: 'preview',
    timestamp: new Date(),
    date: '2026-01-01',
  } as FoodLogEntry);
}

function itemIsClear(item: CoasterShareItem): boolean {
  return isClearDayEntry({
    ...item,
    id: 'preview',
    timestamp: new Date(),
    date: '2026-01-01',
  } as FoodLogEntry);
}

function itemIsZeroProof(item: CoasterShareItem): boolean {
  return isZeroProofEntry({
    ...item,
    id: 'preview',
    timestamp: new Date(),
    date: '2026-01-01',
  } as FoodLogEntry);
}

export function ShareView({ share }: { share: ShareDTO }) {
  const { user } = useUser();
  const { toast } = useToast();

  const [editedItems, setEditedItems] = useState<CoasterShareItem[] | null>(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isLogging, setIsLogging] = useState(false);
  const [loggedDone, setLoggedDone] = useState(false);
  const [sunnyNote, setSunnyNote] = useState<string>(share.cfoAssessment || '');

  const displayItems = editedItems ?? share.items;

  const totalUnits = useMemo(() => {
    const sum = displayItems.reduce(
      (acc, item) => acc + (itemIsClear(item) ? 0 : itemUnits(item)),
      0
    );
    return Math.round(sum * 10) / 10;
  }, [displayItems]);

  useEffect(() => {
    if (sunnyNote) return;
    let active = true;
    assessSharedMeal({
      shareId: share.id,
      title: share.title,
      createdByName: share.createdByName,
      totals: {
        calories: share.totals.calories ?? 0,
        proteinG: share.totals.proteinG ?? 0,
        carbsG: share.totals.carbsG ?? 0,
        fatG: share.totals.fatG ?? 0,
        fiberG: share.totals.fiberG ?? 0,
      },
      items: share.items.map((item) => ({
        name: item.name,
        calories: item.calories ?? 0,
        proteinG: item.proteinG ?? 0,
        carbsG: item.carbsG ?? 0,
        fatG: item.fatG ?? 0,
      })),
    })
      .then((res) => {
        if (active && res.success) {
          setSunnyNote(res.assessment);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [share, sunnyNote]);

  const handleCustomize = async (e: React.FormEvent) => {
    e.preventDefault();
    const prompt = editPrompt.trim();
    if (!prompt || isEditing) return;

    setIsEditing(true);
    try {
      const res = await editSharedMeal(displayItems, prompt);
      if (!res.success) {
        throw new Error(res.error || 'Could not adjust round.');
      }
      setEditedItems(res.items as CoasterShareItem[]);
      setEditPrompt('');
      toast({
        title: 'Pour card adjusted',
        description: res.summary,
      });
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Adjustment failed',
        description: err instanceof Error ? err.message : 'Try rephrasing your tweak.',
      });
    } finally {
      setIsEditing(false);
    }
  };

  const handleLogToCoaster = async () => {
    if (!user) {
      toast({
        title: 'Open Coaster to save',
        description: 'Sign in on the main screen, then tap Log Round.',
      });
      return;
    }

    setIsLogging(true);
    try {
      const localDate = getLocalDateStr();
      const res = editedItems
        ? await logEditedMeal(user.uid, editedItems, localDate)
        : await logSharedMeal(user.uid, share.id, localDate);

      if (!res.success) {
        throw new Error(res.error || 'Could not add round to your coaster.');
      }
      setLoggedDone(true);
      toast({
        title: 'Added to Today’s Coaster',
        description: `${formatUnits(totalUnits)} saved to ${localDate}.`,
      });
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Could not log round',
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    } finally {
      setIsLogging(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#FAF6F0] text-[#1F1B18] py-8 px-4 sm:px-6">
      <div className="max-w-xl mx-auto space-y-5">
        <div className="flex items-center justify-between text-xs font-semibold text-[#6E6359]">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 hover:text-[#1F1B18]"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Open Coaster
          </Link>
          <span>Shared Coaster Card</span>
        </div>

        <Card className="bg-[#FFFDF9] border border-[#E8DFD1] shadow-sm rounded-3xl overflow-hidden">
          <CardHeader className="pb-4 bg-gradient-to-br from-[#FFFDF9] via-[#FAF6F0] to-[#F5EBDC] border-b border-[#E8DFD1]">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#C26D2D]">
              {share.createdByName ? `${share.createdByName} shared a round` : 'Shared Round'}
            </p>
            <div className="flex items-start justify-between gap-4 pt-1">
              <div>
                <CardTitle className="text-2xl font-black text-[#1F1B18] tracking-tight">
                  {share.title}
                </CardTitle>
                <CardDescription className="text-xs text-[#6E6359] mt-1">
                  {displayItems.length} {displayItems.length === 1 ? 'pour' : 'pours'} •{' '}
                  {share.logCount} saved to coasters
                </CardDescription>
              </div>

              <div
                className={`px-3.5 py-2 rounded-2xl border text-right shrink-0 ${
                  totalUnits === 0
                    ? 'bg-[#3F7D58]/10 border-[#3F7D58]/30 text-[#3F7D58]'
                    : 'bg-[#C26D2D]/10 border-[#C26D2D]/25 text-[#C26D2D]'
                }`}
              >
                <p className="text-2xl font-black tabular-nums leading-none">
                  {formatUnits(totalUnits)}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-wider mt-1">
                  Std Units
                </p>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-5 space-y-5">
            {sunnyNote && (
              <div className="rounded-2xl bg-[#FAF6F0] border border-[#E8DFD1] p-3.5 space-y-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#C26D2D] flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Sunny&apos;s Booth Note
                </p>
                <p className="text-xs text-[#1F1B18] leading-relaxed">{sunnyNote}</p>
              </div>
            )}

            <div className="space-y-2">
              {displayItems.map((item, idx) => {
                const u = itemUnits(item);
                const isClear = itemIsClear(item);
                const isZP = itemIsZeroProof(item);
                return (
                  <div
                    key={`${item.name}-${idx}`}
                    className="rounded-2xl bg-[#FAF6F0] border border-[#E8DFD1] px-3.5 py-2.5 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        {isClear ? (
                          <Leaf className="w-3.5 h-3.5 text-[#3F7D58]" />
                        ) : isZP ? (
                          <Sparkles className="w-3.5 h-3.5 text-[#3F7D58]" />
                        ) : (
                          <Wine className="w-3.5 h-3.5 text-[#C26D2D]" />
                        )}
                        <span className="text-sm font-bold text-[#1F1B18] truncate">
                          {item.name}
                        </span>
                        {isZP && !isClear && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#3F7D58]/15 text-[#3F7D58]">
                            Zero-Proof
                          </span>
                        )}
                      </div>
                      {(item.volumeOz || item.abvPct !== undefined) && (
                        <p className="text-[11px] text-[#6E6359]">
                          {item.volumeOz ? `${item.volumeOz} oz` : ''}
                          {item.volumeOz && item.abvPct !== undefined ? ' • ' : ''}
                          {item.abvPct !== undefined ? `${item.abvPct}% ABV` : ''}
                        </p>
                      )}
                    </div>
                    <span
                      className={`text-sm font-black tabular-nums shrink-0 ${
                        isClear || isZP || u === 0 ? 'text-[#3F7D58]' : 'text-[#C26D2D]'
                      }`}
                    >
                      {formatUnits(u)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Customize Round */}
            <form onSubmit={handleCustomize} className="space-y-2 pt-2 border-t border-[#E8DFD1]">
              <label className="text-xs font-bold uppercase tracking-wider text-[#6E6359] flex items-center gap-1.5">
                <Wand2 className="w-3.5 h-3.5 text-[#C26D2D]" />
                Adjust Before Logging (Optional)
              </label>
              <div className="flex gap-2">
                <Input
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  placeholder="e.g. Half pour on the wine, or swap beer to zero-proof"
                  className="h-9 bg-[#FAF6F0] border-[#E8DFD1] text-sm"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={isEditing || !editPrompt.trim()}
                  className="h-9 border-[#E8DFD1] bg-[#FFFDF9] text-xs font-bold shrink-0"
                >
                  {isEditing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Update'}
                </Button>
              </div>
            </form>

            {/* Primary Save CTA */}
            <div className="pt-1">
              {user ? (
                <Button
                  type="button"
                  disabled={isLogging || loggedDone}
                  onClick={handleLogToCoaster}
                  className="w-full h-11 rounded-full bg-[#1F1B18] hover:bg-[#352F2A] text-[#FAF6F0] text-sm font-bold"
                >
                  {isLogging ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : loggedDone ? (
                    <Check className="w-4 h-4 mr-2 text-[#84C39A]" />
                  ) : (
                    <Plus className="w-4 h-4 mr-2" />
                  )}
                  {loggedDone
                    ? 'Added to Today’s Coaster'
                    : `Log ${formatUnits(totalUnits)} to Today’s Coaster`}
                </Button>
              ) : (
                <Button
                  asChild
                  className="w-full h-11 rounded-full bg-[#1F1B18] hover:bg-[#352F2A] text-[#FAF6F0] text-sm font-bold"
                >
                  <Link href="/">Sign In on Coaster to Log This Round</Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
