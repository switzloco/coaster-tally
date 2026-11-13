'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useUser, useFirestore } from '@/firebase';
import { healthService } from '@/lib/health-service';
import { FoodLogEntry } from '@/lib/food-exercise-types';
import { calculateStandardUnits, formatUnits } from '@/lib/drink-units';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft,
  Check,
  ImagePlus,
  Loader2,
  Plus,
  Share2,
  Sparkles,
  Wine,
} from 'lucide-react';

interface IngestParsedResult {
  drinkName?: string;
  activityName?: string;
  summary?: string;
  standardUnits?: number;
  volumeOz?: number;
  abvPct?: number;
  isZeroProof?: boolean;
  isClearDay?: boolean;
  category?: string;
  notes?: string;
}

function getLocalDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getLocalTimeStr(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function IncomingShareContent() {
  const searchParams = useSearchParams();
  const { user } = useUser();
  const db = useFirestore();
  const { toast } = useToast();

  const initialTitle = searchParams.get('title') || '';
  const initialText = searchParams.get('text') || '';
  const initialUrl = searchParams.get('url') || '';
  const initialImageUrl = searchParams.get('image') || searchParams.get('imageUrl') || '';

  const [rawText, setRawText] = useState(() =>
    [initialTitle, initialText, initialUrl].filter(Boolean).join('\n')
  );
  const [sourceUrl, setSourceUrl] = useState(initialUrl);
  const [attachedImage, setAttachedImage] = useState<string>(initialImageUrl);

  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<IngestParsedResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [autoRan, setAutoRan] = useState(false);

  // Editable Coaster fields pre-filled from parsed output
  const [drinkName, setDrinkName] = useState(initialTitle || 'Shared Pour');
  const [volumeOz, setVolumeOz] = useState('12');
  const [abvPct, setAbvPct] = useState('5');
  const [savingPour, setSavingPour] = useState(false);
  const [savedDone, setSavedDone] = useState(false);

  const liveUnits = useMemo(() => {
    const oz = parseFloat(volumeOz);
    const abv = parseFloat(abvPct);
    if (!Number.isFinite(oz) || oz <= 0 || !Number.isFinite(abv) || abv < 0) {
      return typeof parsed?.standardUnits === 'number' ? parsed.standardUnits : 0;
    }
    return calculateStandardUnits(oz, abv);
  }, [volumeOz, abvPct, parsed]);

  const handleIngest = useCallback(async () => {
    if (!user) return;
    const textToSend = rawText.trim() || sourceUrl.trim() || (attachedImage ? 'Shared drink photo' : '');
    if (!textToSend) {
      setParseError('Paste a drink description, bar menu link, or tap a quick photo.');
      return;
    }

    setParsing(true);
    setParseError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/ingest-share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          rawText: textToSend,
          sourceTitle: initialTitle || undefined,
          sourceUrl: sourceUrl.trim() || undefined,
          imageUrl: attachedImage || undefined,
          localDate: getLocalDateStr(),
          localTime: getLocalTimeStr(),
        }),
      });

      const payload = await res.json();
      if (!res.ok || !payload?.success) {
        throw new Error(payload?.error || 'Could not parse shared item.');
      }

      const data = (payload.parsed ?? {}) as IngestParsedResult;
      setParsed(data);
      if (data.drinkName || data.activityName || initialTitle) {
        setDrinkName(data.drinkName || data.activityName || initialTitle);
      }
      if (typeof data.volumeOz === 'number' && data.volumeOz > 0) {
        setVolumeOz(String(data.volumeOz));
      }
      if (typeof data.abvPct === 'number' && data.abvPct >= 0) {
        setAbvPct(String(data.abvPct));
      }
    } catch (err: unknown) {
      setParseError(
        err instanceof Error ? err.message : 'Unable to parse share payload right now.'
      );
    } finally {
      setParsing(false);
    }
  }, [user, rawText, sourceUrl, attachedImage, initialTitle]);

  useEffect(() => {
    if (!autoRan && user && (initialText || initialUrl || initialTitle || initialImageUrl)) {
      setAutoRan(true);
      handleIngest();
    }
  }, [autoRan, user, initialText, initialUrl, initialTitle, initialImageUrl, handleIngest]);

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAttachedImage(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveToCoaster = async () => {
    if (!user || !db) return;
    const oz = parseFloat(volumeOz);
    const abv = parseFloat(abvPct);
    const validOz = Number.isFinite(oz) && oz > 0 ? Math.round(oz * 10) / 10 : 12;
    const validAbv = Number.isFinite(abv) && abv >= 0 ? Math.round(abv * 10) / 10 : 5;
    const units = calculateStandardUnits(validOz, validAbv);

    setSavingPour(true);
    try {
      await healthService.logFood(db, user.uid, {
        name: drinkName.trim() || 'Shared Pour',
        portionG: Math.round(validOz * 29.5735),
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        fiberG: 0,
        alcoholDrinks: units,
        standardUnits: units,
        volumeOz: validOz,
        abvPct: validAbv,
        drinkCategory: validAbv === 0 ? 'zero-proof' : 'cocktail',
        isZeroProof: validAbv === 0,
        isClearDay: false,
        source: 'user_estimate',
        meal: 'dinner',
        consumedAt: getLocalTimeStr(),
        date: getLocalDateStr(),
      } as FoodLogEntry);
      setSavedDone(true);
      toast({
        title: `Logged ${drinkName.trim() || 'Pour'}`,
        description: `${formatUnits(units)} saved to Today’s Coaster.`,
      });
    } catch {
      toast({
        variant: 'destructive',
        title: 'Could not save pour',
        description: 'Try again in a moment.',
      });
    } finally {
      setSavingPour(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#FAF6F0] text-[#1F1B18] py-8 px-4 sm:px-6">
      <div className="max-w-xl mx-auto space-y-5">
        <div className="flex items-center justify-between text-xs font-semibold text-[#6E6359]">
          <Link href="/" className="inline-flex items-center gap-1.5 hover:text-[#1F1B18]">
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Coaster
          </Link>
          <span>OS Share Sheet Intake</span>
        </div>

        <Card className="bg-[#FFFDF9] border border-[#E8DFD1] shadow-sm rounded-3xl overflow-hidden">
          <CardHeader className="pb-4 bg-gradient-to-br from-[#FFFDF9] via-[#FAF6F0] to-[#F5EBDC] border-b border-[#E8DFD1]">
            <div className="flex items-center gap-2 text-[#C26D2D]">
              <Share2 className="w-4 h-4" />
              <span className="text-[11px] font-bold uppercase tracking-widest">
                Coaster Share Intake
              </span>
            </div>
            <CardTitle className="text-xl font-black text-[#1F1B18] tracking-tight">
              Turn Shared Drink Links &amp; Notes into Units
            </CardTitle>
            <CardDescription className="text-xs text-[#6E6359]">
              Send menu links, taplist notes, or drink screenshots straight from iOS or Android.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-5 space-y-5">
            {!user ? (
              <div className="rounded-2xl bg-[#FAF6F0] border border-[#E8DFD1] p-5 text-center space-y-3">
                <p className="text-sm font-bold text-[#1F1B18]">
                  Sign in to Coaster to save shared pours
                </p>
                <Button
                  asChild
                  className="rounded-full bg-[#1F1B18] hover:bg-[#352F2A] text-[#FAF6F0] text-xs font-bold"
                >
                  <Link href="/">Sign In on Coaster</Link>
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-[#6E6359]">
                      Shared Text or Menu Description
                    </label>
                    <Textarea
                      value={rawText}
                      onChange={(e) => setRawText(e.target.value)}
                      rows={3}
                      placeholder="Paste beer label, cocktail recipe, or restaurant menu text..."
                      className="bg-[#FAF6F0] border-[#E8DFD1] text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-end">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-[#6E6359]">
                        Link URL (Optional)
                      </label>
                      <Input
                        value={sourceUrl}
                        onChange={(e) => setSourceUrl(e.target.value)}
                        placeholder="https://..."
                        className="h-9 bg-[#FAF6F0] border-[#E8DFD1] text-sm"
                      />
                    </div>

                    <label className="inline-flex items-center justify-center gap-2 h-9 px-3 rounded-xl bg-[#FAF6F0] border border-[#E8DFD1] hover:border-[#C26D2D] text-xs font-semibold text-[#1F1B18] cursor-pointer">
                      <ImagePlus className="w-3.5 h-3.5 text-[#C26D2D]" />
                      <span>{attachedImage ? 'Image attached' : 'Attach bottle / menu photo'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageFileChange}
                        className="hidden"
                      />
                    </label>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    disabled={parsing}
                    onClick={handleIngest}
                    className="w-full h-9 rounded-full border-[#E8DFD1] bg-[#FAF6F0] hover:border-[#C26D2D] text-xs font-bold text-[#1F1B18]"
                  >
                    {parsing ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        Analyzing with Sunny...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5 mr-1.5 text-[#C26D2D]" />
                        Parse Standard Units
                      </>
                    )}
                  </Button>

                  {parseError && (
                    <p className="text-xs text-[#C26D2D] font-medium">{parseError}</p>
                  )}

                  {parsed?.summary && (
                    <div className="rounded-2xl bg-[#FAF6F0] border border-[#E8DFD1] p-3 text-xs text-[#1F1B18]">
                      <strong className="text-[#C26D2D]">Parsed note:</strong> {parsed.summary}
                    </div>
                  )}
                </div>

                {/* Confirm & Log to Coaster */}
                <div className="rounded-2xl bg-[#FAF6F0] border border-[#E8DFD1] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#6E6359] flex items-center gap-1.5">
                      <Wine className="w-3.5 h-3.5 text-[#C26D2D]" />
                      Confirm Pour Details
                    </span>
                    <span
                      className={`text-lg font-black tabular-nums ${
                        liveUnits === 0 ? 'text-[#3F7D58]' : 'text-[#C26D2D]'
                      }`}
                    >
                      {formatUnits(liveUnits)}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                    <div className="sm:col-span-6 space-y-1">
                      <label className="text-[10px] font-bold uppercase text-[#6E6359]">
                        Drink Name
                      </label>
                      <Input
                        value={drinkName}
                        onChange={(e) => setDrinkName(e.target.value)}
                        className="h-9 bg-[#FFFDF9] border-[#E8DFD1] text-sm"
                      />
                    </div>
                    <div className="sm:col-span-3 space-y-1">
                      <label className="text-[10px] font-bold uppercase text-[#6E6359]">
                        Oz
                      </label>
                      <Input
                        type="number"
                        step="0.5"
                        min="0.5"
                        value={volumeOz}
                        onChange={(e) => setVolumeOz(e.target.value)}
                        className="h-9 bg-[#FFFDF9] border-[#E8DFD1] text-sm tabular-nums"
                      />
                    </div>
                    <div className="sm:col-span-3 space-y-1">
                      <label className="text-[10px] font-bold uppercase text-[#6E6359]">
                        ABV %
                      </label>
                      <Input
                        type="number"
                        step="0.1"
                        min="0"
                        max="95"
                        value={abvPct}
                        onChange={(e) => setAbvPct(e.target.value)}
                        className="h-9 bg-[#FFFDF9] border-[#E8DFD1] text-sm tabular-nums"
                      />
                    </div>
                  </div>

                  <Button
                    type="button"
                    disabled={savingPour || savedDone}
                    onClick={handleSaveToCoaster}
                    className="w-full h-10 rounded-full bg-[#1F1B18] hover:bg-[#352F2A] text-[#FAF6F0] text-xs font-bold"
                  >
                    {savingPour ? (
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    ) : savedDone ? (
                      <Check className="w-4 h-4 mr-1.5 text-[#84C39A]" />
                    ) : (
                      <Plus className="w-4 h-4 mr-1.5" />
                    )}
                    {savedDone
                      ? 'Logged to Today’s Coaster'
                      : `Log ${formatUnits(liveUnits)} to Today’s Coaster`}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default function IncomingSharePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#FAF6F0] flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-[#C26D2D]" />
        </div>
      }
    >
      <IncomingShareContent />
    </Suspense>
  );
}
