'use client';

import React, { useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  ChevronUp,
  CornerDownLeft,
  GlassWater,
  Leaf,
  Loader2,
  Receipt,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import { useFirebaseApp, useFirestore, useUser } from '@/firebase';
import { useHybridAi } from '@/components/hybrid-ai-provider';
import {
  ExecutionReceiptBadge,
  SecComplianceAlertPanel,
} from '@/components/execution-receipt-badge';
import {
  auditMealPhotoReceiptHybrid,
  estimateDrinkUnitsWithFallback,
  normalizeImageFileForHybrid,
  parseTickerTapeHybrid,
  SecPrivacyLockBlockedError,
  type HybridExecutionReceipt,
  type NormalizedInlineImage,
  type SecComplianceAlert,
} from '@/lib/hybrid-ai';
import {
  formatUnits,
  type DrinkCategory,
} from '@/lib/drink-units';
import { inferMealFromTime } from '@/lib/food-exercise-types';
import { healthService, type HealthData } from '@/lib/health-service';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface HybridTickerTerminalProps {
  healthData?: HealthData | null;
  targetDateIso?: string;
  compact?: boolean;
  collapsibleOnMobile?: boolean;
  onCommitted?: () => void;
  className?: string;
}

export interface ParsedDrinkDraft {
  name: string;
  volumeOz?: number;
  abvPct?: number;
  units: number;
  category: DrinkCategory;
  zeroProof?: boolean;
  isClearDay?: boolean;
  alternativeSuggested?: string;
}

interface ParsedDrinkPreview {
  items: ParsedDrinkDraft[];
  totalUnits: number;
  isClearDay: boolean;
  isZeroProof: boolean;
  buddyNote?: string;
  alternativeSuggestion?: string;
  receipt: HybridExecutionReceipt;
}

const QUICK_SHORTHAND_EXAMPLES = [
  '2x 12oz 5%',
  '3 Miller Lites',
  'half bottle cab',
  '16oz 7.2% hazy',
  'clear day',
];

function categoryPillStyle(category: DrinkCategory, zeroProof?: boolean, isClearDay?: boolean): string {
  if (isClearDay || zeroProof || category === 'clear-day' || category === 'zero-proof') {
    return 'border-[#3F7D58]/40 bg-[#EAF3ED] text-[#2B5C3F]';
  }
  if (category === 'wine' || category === 'cocktail' || category === 'spirits') {
    return 'border-[#C26D2D]/40 bg-[#FEF3C7]/60 text-[#9A4E16]';
  }
  return 'border-[#E8DFD1] bg-[#FAF6F0] text-[#4A4139]';
}

/**
 * Coaster Hybrid Shorthand & Menu/Label Scanner.
 * Parses fast drink shorthand ("2x 12oz 5%", "half bottle cab", "clear day") and
 * scans can/bottle/tap-list photos using Firebase Hybrid AI (`PREFER_ON_DEVICE`
 * or `ONLY_ON_DEVICE` Privacy Vault) with instant 1-tap Coaster logging.
 */
export function HybridTickerTerminal({
  healthData: _healthData,
  targetDateIso,
  compact = false,
  collapsibleOnMobile = false,
  onCommitted,
  className,
}: HybridTickerTerminalProps) {
  const firebaseApp = useFirebaseApp();
  const db = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();
  const {
    secPrivacyLock,
    setSecPrivacyLock,
    warmNano,
    recordReceipt,
    isOnline,
  } = useHybridAi();

  const [tickerInput, setTickerInput] = useState('');
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [committedBanner, setCommittedBanner] = useState<string | null>(null);

  const [stagedImage, setStagedImage] = useState<NormalizedInlineImage | null>(null);
  const [preview, setPreview] = useState<ParsedDrinkPreview | null>(null);
  const [complianceAlert, setComplianceAlert] = useState<SecComplianceAlert | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  const hasActiveContent = Boolean(
    isParsing ||
      stagedImage ||
      preview ||
      complianceAlert ||
      errorText ||
      committedBanner
  );
  const showCompactMobileLauncher = collapsibleOnMobile && !mobileExpanded && !hasActiveContent;

  const normalizePreview = (rawRes: any): ParsedDrinkPreview => {
    const rawItems: any[] = Array.isArray(rawRes?.items)
      ? rawRes.items
      : Array.isArray(rawRes?.foods)
        ? rawRes.foods
        : [];

    const items: ParsedDrinkDraft[] = rawItems.map((item) => {
      const isClear = Boolean(item.isClearDay || item.category === 'clear-day' || item.drinkCategory === 'clear-day');
      const isZp = Boolean(item.zeroProof || item.isZeroProof || item.category === 'zero-proof' || item.drinkCategory === 'zero-proof');
      const units = Number(
        item.standardUnits ?? item.units ?? item.alcoholDrinks ?? (isClear || isZp ? 0 : 1)
      );
      const category: DrinkCategory =
        item.category ??
        item.drinkCategory ??
        (isClear ? 'clear-day' : isZp ? 'zero-proof' : 'beer');

      return {
        name: String(item.name || (isClear ? 'Clear Day' : 'Standard Pour')),
        volumeOz: typeof item.volumeOz === 'number' ? item.volumeOz : undefined,
        abvPct: typeof item.abvPct === 'number' ? item.abvPct : undefined,
        units: Math.max(0, Math.round(units * 10) / 10),
        category,
        zeroProof: isZp,
        isClearDay: isClear,
        alternativeSuggested: item.alternativeSuggested || rawRes?.alternativeSuggestion,
      };
    });

    const totalUnits =
      typeof rawRes?.totalUnits === 'number'
        ? Math.max(0, Math.round(rawRes.totalUnits * 10) / 10)
        : Math.round(items.reduce((sum, item) => sum + item.units, 0) * 10) / 10;

    return {
      items,
      totalUnits,
      isClearDay: Boolean(rawRes?.isClearDay || items.some((i) => i.isClearDay)),
      isZeroProof: Boolean(rawRes?.isZeroProof || items.some((i) => i.zeroProof)),
      buddyNote: rawRes?.buddyNote || rawRes?.cfoCommentary || rawRes?.cfoAuditNote,
      alternativeSuggestion: rawRes?.alternativeSuggestion,
      receipt: rawRes.receipt,
    };
  };

  const runDrinkScanOrParse = async (textInput: string, img?: NormalizedInlineImage | null) => {
    setIsParsing(true);
    setErrorText(null);
    setComplianceAlert(null);
    setCommittedBanner(null);

    try {
      const res = img
        ? await auditMealPhotoReceiptHybrid({
            firebaseApp,
            image: img,
            note: textInput || undefined,
            secPrivacyLock,
          })
        : secPrivacyLock
          ? await parseTickerTapeHybrid({
              firebaseApp,
              shorthandInput: textInput,
              secPrivacyLock: true,
            })
          : await estimateDrinkUnitsWithFallback(textInput, { firebaseApp });
      const normalized = normalizePreview(res);
      setPreview(normalized);
      if (normalized.receipt) {
        recordReceipt(normalized.receipt);
      }
    } catch (err) {
      if (err instanceof SecPrivacyLockBlockedError) {
        setComplianceAlert(err.alert);
      } else {
        setErrorText(
          err instanceof Error
            ? err.message
            : 'Hybrid drink parser is temporarily unavailable. Check your connection or warm Local Nano.'
        );
      }
    } finally {
      setIsParsing(false);
    }
  };

  const handleParseSubmit = async (e?: React.FormEvent, overrideText?: string) => {
    if (e) e.preventDefault();
    const raw = (overrideText ?? tickerInput).trim();
    if (!raw && !stagedImage) return;
    await runDrinkScanOrParse(raw, overrideText ? null : stagedImage);
  };

  const handlePhotoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const normalized = await normalizeImageFileForHybrid(file);
      setStagedImage(normalized);
      await runDrinkScanOrParse(tickerInput.trim(), normalized);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Unable to process drink or label photo.');
    }
  };

  const handleCommitToCoaster = async () => {
    if (!user || !preview || preview.items.length === 0) return;
    setIsCommitting(true);
    const todayIso = new Date().toLocaleDateString('en-CA');
    const dateIso = targetDateIso || todayIso;
    const nowTime = new Date().toTimeString().slice(0, 5);
    const mealSlot = inferMealFromTime(nowTime);

    try {
      for (const item of preview.items) {
        await healthService.logFood(db, user.uid, {
          name: item.name,
          portionG: item.volumeOz ? Math.round(item.volumeOz * 29.57) : 0,
          calories: 0,
          proteinG: 0,
          carbsG: 0,
          fatG: 0,
          fiberG: 0,
          alcoholDrinks: item.units,
          standardUnits: item.units,
          isClearDay: Boolean(item.isClearDay),
          isZeroProof: Boolean(item.zeroProof),
          drinkCategory: item.category,
          ...(item.alternativeSuggested || preview.alternativeSuggestion
            ? { alternativeSuggested: item.alternativeSuggested || preview.alternativeSuggestion }
            : {}),
          meal: mealSlot,
          source: 'user_estimate',
          consumedAt: nowTime,
          date: dateIso,
          inferenceSource: preview.receipt?.inferenceSource,
          inferenceLatencyMs: preview.receipt?.latencyMs,
        });
      }

      if (dateIso === todayIso) {
        await healthService.updateHealthData(db, user.uid, {
          lastActiveDate: todayIso,
        });
      }

      const itemCount = preview.items.length;
      const syncLabel = isOnline ? 'Saved to Coaster' : 'Saved Offline (Local Coaster)';
      setCommittedBanner(
        `Added ${itemCount} entr${itemCount === 1 ? 'y' : 'ies'} (${formatUnits(preview.totalUnits)}) · ${syncLabel}`
      );
      toast({
        title: syncLabel,
        description: `${formatUnits(preview.totalUnits)} added to ${dateIso}.`,
      });

      setTickerInput('');
      setStagedImage(null);
      setPreview(null);
      onCommitted?.();
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'Could not save entry to your coaster.');
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <section
      data-testid="hybrid-ticker-terminal"
      className={cn(
        'shrink-0 rounded-2xl border border-[#E8DFD1] bg-[#FFFDF9] text-[#1F1B18] shadow-sm overflow-hidden',
        className
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handlePhotoFileChange}
        className="hidden"
        data-testid="expense-receipt-file-input"
      />

      {showCompactMobileLauncher && (
        <div className="sm:hidden flex items-center gap-2 p-2.5">
          <button
            type="button"
            onClick={() => {
              setMobileExpanded(true);
              setTimeout(() => textInputRef.current?.focus(), 40);
            }}
            className="flex-1 min-w-0 flex items-center gap-2 rounded-xl border border-[#E8DFD1] bg-[#FAF6F0] px-3 py-2 text-left"
          >
            <Terminal className="w-3.5 h-3.5 text-[#C26D2D] shrink-0" />
            <span className="text-xs text-[#6E6359] truncate font-mono">
              2x 12oz 5%, half bottle cab, clear day...
            </span>
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isParsing}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#C26D2D]/40 bg-[#FEF3C7]/60 px-3 py-2 text-xs font-semibold text-[#9A4E16] shrink-0"
            title="Scan can ABV label or bar menu"
          >
            <Camera className="w-3.5 h-3.5 text-[#C26D2D]" />
            <span>Scan</span>
          </button>
        </div>
      )}

      <div className={cn(showCompactMobileLauncher && 'hidden sm:block')}>
        {/* Header Bar */}
        <div className="flex items-center justify-between gap-2 border-b border-[#E8DFD1] bg-[#FAF6F0] px-3.5 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <Terminal className="w-3.5 h-3.5 text-[#C26D2D] shrink-0" />
            <span className="text-[11px] font-semibold text-[#1F1B18] truncate">
              Hybrid Shorthand &amp; Can / Menu Scanner
            </span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-wider shrink-0">
            <span
              className={cn(
                'rounded-md px-2 py-0.5 border font-semibold',
                secPrivacyLock
                  ? 'border-[#3F7D58]/40 bg-[#EAF3ED] text-[#2B5C3F]'
                  : 'border-[#E8DFD1] bg-[#FFFDF9] text-[#6E6359]'
              )}
            >
              {secPrivacyLock ? 'ONLY_ON_DEVICE' : 'PREFER_ON_DEVICE'}
            </span>
            {!isOnline && (
              <span className="rounded-md px-2 py-0.5 border border-[#D97706]/40 bg-[#FEF3C7] text-[#9A4E16] font-semibold">
                OFFLINE
              </span>
            )}
            {collapsibleOnMobile && !hasActiveContent && (
              <button
                type="button"
                onClick={() => setMobileExpanded(false)}
                className="sm:hidden inline-flex items-center rounded-md border border-[#E8DFD1] bg-[#FFFDF9] px-1.5 py-0.5 text-[#6E6359]"
                aria-label="Minimize shorthand bar"
              >
                <ChevronUp className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Input Form */}
        <div className="p-3 sm:p-3.5 space-y-2.5">
          <form onSubmit={(e) => handleParseSubmit(e)} className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1 flex items-center rounded-xl border border-[#E8DFD1] bg-[#FAF6F0] px-3 py-2 focus-within:border-[#C26D2D]">
              <input
                ref={textInputRef}
                type="text"
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value)}
                data-testid="ticker-tape-input"
                aria-label="Coaster Drink Shorthand Input"
                placeholder='e.g. "2x 12oz 5%", "3 Miller Lites", "half bottle cab", "clear day"'
                className="w-full bg-transparent text-sm sm:text-xs text-[#1F1B18] placeholder:text-[#6E6359]/70 focus:outline-none font-mono"
              />
              {tickerInput && (
                <button
                  type="button"
                  onClick={() => setTickerInput('')}
                  className="text-[#6E6359] hover:text-[#1F1B18] ml-1"
                  aria-label="Clear shorthand input"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isParsing}
                data-testid="expense-receipt-upload-btn"
                className="flex-1 sm:flex-initial justify-center inline-flex items-center gap-1.5 rounded-xl border border-[#E8DFD1] bg-[#FAF6F0] hover:bg-[#F3ECE1] px-3 py-2 text-xs font-medium text-[#1F1B18] transition-colors disabled:opacity-50"
                title="Scan a can, bottle ABV label, or bar menu"
              >
                <Camera className="w-3.5 h-3.5 text-[#C26D2D]" />
                <span>Scan Label / Menu</span>
              </button>

              <button
                type="submit"
                disabled={isParsing || (!tickerInput.trim() && !stagedImage)}
                data-testid="ticker-parse-submit-btn"
                className="flex-1 sm:flex-initial justify-center inline-flex items-center gap-1.5 rounded-xl bg-[#C26D2D] hover:bg-[#A85B22] px-3.5 py-2 text-xs font-semibold text-[#FFFDF9] transition-colors disabled:opacity-40"
              >
                {isParsing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Reading...</span>
                  </>
                ) : (
                  <>
                    <CornerDownLeft className="w-3.5 h-3.5" />
                    <span>Tally</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Quick Shorthand Chips */}
          {!compact && !preview && (
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar whitespace-nowrap">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6359] shrink-0">
                Quick try:
              </span>
              {QUICK_SHORTHAND_EXAMPLES.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => {
                    setTickerInput(sample);
                    handleParseSubmit(undefined, sample);
                  }}
                  className="rounded-lg border border-[#E8DFD1] bg-[#FAF6F0] hover:border-[#C26D2D]/50 px-2.5 py-1 text-[11px] font-mono text-[#4A4139] hover:text-[#1F1B18] transition-colors shrink-0"
                >
                  {sample}
                </button>
              ))}
            </div>
          )}

          {/* Staged Photo Preview */}
          {stagedImage && (
            <div className="flex items-center gap-3 rounded-xl border border-[#E8DFD1] bg-[#FAF6F0] p-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={stagedImage.previewDataUri}
                alt="Drink label or menu scan"
                className="w-11 h-11 rounded-lg object-cover border border-[#E8DFD1]"
              />
              <div className="flex-1 min-w-0 text-xs">
                <p className="font-semibold text-[#1F1B18] flex items-center gap-1.5">
                  <Receipt className="w-3.5 h-3.5 text-[#C26D2D]" />
                  <span>Label / Menu Photo Attached ({stagedImage.mimeType})</span>
                </p>
                <p className="text-[11px] text-[#6E6359] truncate">
                  Resized cleanly for on-device Chrome Gemini Nano &amp; Cloud Gemini.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setStagedImage(null);
                  setPreview(null);
                }}
                className="text-[#6E6359] hover:text-[#1F1B18] p-1"
                aria-label="Remove attached photo"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {complianceAlert && (
            <SecComplianceAlertPanel
              alert={complianceAlert}
              onWarmNano={warmNano}
              onDisableLock={() => {
                setSecPrivacyLock(false);
                setComplianceAlert(null);
              }}
            />
          )}

          {errorText && (
            <div className="rounded-xl border border-[#C26D2D]/40 bg-[#FEF3C7]/45 px-3 py-2 text-xs text-[#9A4E16]">
              {errorText}
            </div>
          )}

          {committedBanner && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-[#3F7D58]/35 bg-[#EAF3ED] px-3 py-2 text-xs text-[#2B5C3F]">
              <span className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="w-4 h-4 text-[#3F7D58] shrink-0" />
                {committedBanner}
              </span>
              <button
                type="button"
                onClick={() => setCommittedBanner(null)}
                className="text-[#2B5C3F] hover:text-[#1F1B18]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Parsed Drink Preview */}
          {preview && (
            <div
              data-testid="hybrid-parse-preview"
              className="rounded-2xl border border-[#E8DFD1] bg-[#FAF6F0] p-3.5 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E8DFD1] pb-2">
                {preview.receipt ? (
                  <ExecutionReceiptBadge
                    inferenceSource={preview.receipt.inferenceSource}
                    latencyMs={preview.receipt.latencyMs}
                  />
                ) : (
                  <span className="text-xs font-semibold text-[#6E6359]">Parsed Result</span>
                )}

                <span
                  className={cn(
                    'rounded-md border px-2 py-0.5 font-mono text-xs font-semibold',
                    preview.isClearDay || preview.isZeroProof
                      ? 'border-[#3F7D58]/40 bg-[#EAF3ED] text-[#2B5C3F]'
                      : 'border-[#C26D2D]/40 bg-[#FFFDF9] text-[#C26D2D]'
                  )}
                >
                  Total: {formatUnits(preview.totalUnits)}
                </span>
              </div>

              {preview.buddyNote && (
                <p className="text-xs text-[#4A4139] leading-relaxed border-l-2 border-[#C26D2D] pl-2.5">
                  {preview.buddyNote}
                </p>
              )}

              <div className="space-y-1.5">
                {preview.items.map((item, idx) => (
                  <div
                    key={`drink_${idx}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E8DFD1] bg-[#FFFDF9] px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {item.isClearDay || item.zeroProof ? (
                        <Leaf className="w-3.5 h-3.5 text-[#3F7D58] shrink-0" />
                      ) : (
                        <GlassWater className="w-3.5 h-3.5 text-[#C26D2D] shrink-0" />
                      )}
                      <span className="font-semibold text-[#1F1B18] truncate">{item.name}</span>
                      <span
                        className={cn(
                          'rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase',
                          categoryPillStyle(item.category, item.zeroProof, item.isClearDay)
                        )}
                      >
                        {item.category}
                      </span>
                    </div>
                    <div className="flex items-center gap-2.5 font-mono text-xs">
                      {item.volumeOz ? (
                        <span className="text-[#6E6359]">
                          {item.volumeOz}oz{item.abvPct ? ` · ${item.abvPct}%` : ''}
                        </span>
                      ) : null}
                      <span
                        className={
                          item.isClearDay || item.zeroProof
                            ? 'font-semibold text-[#3F7D58]'
                            : 'font-semibold text-[#C26D2D]'
                        }
                      >
                        {formatUnits(item.units)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {preview.alternativeSuggestion && (
                <div className="flex items-start gap-2 rounded-xl border border-[#3F7D58]/30 bg-[#EAF3ED]/75 px-3 py-2 text-xs text-[#2B5C3F]">
                  <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    <strong>Zero-proof idea:</strong> {preview.alternativeSuggestion}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setPreview(null);
                    setStagedImage(null);
                  }}
                  className="rounded-xl border border-[#E8DFD1] bg-[#FFFDF9] px-3 py-1.5 text-xs font-medium text-[#6E6359] hover:text-[#1F1B18]"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={handleCommitToCoaster}
                  disabled={isCommitting || preview.items.length === 0}
                  data-testid="commit-to-audit-ledger-btn"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#3F7D58] hover:bg-[#316345] px-4 py-1.5 text-xs font-semibold text-[#FFFDF9] transition-colors disabled:opacity-50"
                >
                  {isCommitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  <span>Add to Today&apos;s Coaster</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
