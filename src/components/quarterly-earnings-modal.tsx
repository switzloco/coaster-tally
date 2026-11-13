'use client';

import React, { useState } from 'react';
import { doc } from 'firebase/firestore';
import {
  Sparkles,
  Leaf,
  Loader2,
  RefreshCw,
  GlassWater,
  CalendarDays,
  Compass,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useFirebaseApp,
  useFirestore,
  useUser,
  useDoc,
  useMemoFirebase,
} from '@/firebase';
import { useHybridAi } from '@/components/hybrid-ai-provider';
import {
  ExecutionReceiptBadge,
  SecComplianceAlertPanel,
} from '@/components/execution-receipt-badge';
import {
  runTrendReflectionWithFallback,
  SecPrivacyLockBlockedError,
  type HybridExecutionReceipt,
  type SecComplianceAlert,
} from '@/lib/hybrid-ai';
import { computeTrendSummary, formatUnits, type TrendSummary } from '@/lib/drink-units';
import {
  healthService,
  type HealthData,
  type UserPreferences,
} from '@/lib/health-service';

interface TrendSpotterReport {
  headline: string;
  rhythmInsight: string;
  clearDayHighlight: string;
  mixBreakdown: string;
  swapIdeas: string[];
  nextWeekNudge: string;
  receipt: HybridExecutionReceipt;
}

/**
 * Sunny's 30-Day Trend Spotter Modal (`InferenceMode.PREFER_IN_CLOUD`).
 * Uses Cloud Gemini via Firebase Remote Config for multi-week rhythm synthesis
 * and zero-proof ideas, with downward fallback to Chrome Gemini Nano offline,
 * or strict on-device execution when Privacy Vault (`ONLY_ON_DEVICE`) is active.
 */
export function QuarterlyEarningsModal() {
  const firebaseApp = useFirebaseApp();
  const db = useFirestore();
  const { user } = useUser();
  const {
    earningsModalOpen,
    setEarningsModalOpen,
    secPrivacyLock,
    setSecPrivacyLock,
    warmNano,
    remoteConfig,
    recordReceipt,
    isOnline,
  } = useHybridAi();

  const userDocRef = useMemoFirebase(
    () => (user ? doc(db, 'users', user.uid) : null),
    [db, user]
  );
  const { data: healthData } = useDoc<HealthData>(userDocRef);

  const prefsDocRef = useMemoFirebase(
    () => (user ? doc(db, 'users', user.uid, 'preferences', 'settings') : null),
    [db, user]
  );
  const { data: preferences } = useDoc<UserPreferences>(prefsDocRef);

  const [isRunning, setIsRunning] = useState(false);
  const [report, setReport] = useState<TrendSpotterReport | null>(null);
  const [summaryStats, setSummaryStats] = useState<TrendSummary | null>(null);
  const [complianceAlert, setComplianceAlert] = useState<SecComplianceAlert | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const handleRunTrendSpotter = async () => {
    if (!user) return;
    setIsRunning(true);
    setErrorText(null);
    setComplianceAlert(null);

    try {
      const recentLogs = await healthService
        .queryFoodLog(db, user.uid, undefined, 90)
        .catch(() => []);

      const stats = computeTrendSummary(recentLogs);
      setSummaryStats(stats);

      const rawResult = (await runTrendReflectionWithFallback({
        firebaseApp,
        logs: recentLogs,
        secPrivacyLock,
      })) as Partial<TrendSpotterReport> & {
        executiveSummary?: string;
        capitalDirectives?: string[];
        receipt: HybridExecutionReceipt;
      };

      const normalizedReport: TrendSpotterReport = {
        headline:
          rawResult.headline || "Sunny's 30-Day Coaster Snapshot",
        rhythmInsight:
          rawResult.rhythmInsight ||
          rawResult.executiveSummary ||
          `You averaged ${formatUnits(stats.sevenDayAvg)}/day over the last week and tallied ${formatUnits(stats.thirtyDayTotal)} across the last 30 days.`,
        clearDayHighlight:
          rawResult.clearDayHighlight ||
          `You noticed ${stats.clearDaysLast30} Clear Day${stats.clearDaysLast30 === 1 ? '' : 's'} and ${stats.zeroProofSwapsLast30} Zero-Proof Swap${stats.zeroProofSwapsLast30 === 1 ? '' : 's'} in the past month.`,
        mixBreakdown:
          rawResult.mixBreakdown ||
          'Across beer, wine, cocktails, and zero-proof pours, noticing your baseline is the clearest step.',
        swapIdeas:
          Array.isArray(rawResult.swapIdeas) && rawResult.swapIdeas.length > 0
            ? rawResult.swapIdeas.slice(0, 4)
            : Array.isArray(rawResult.capitalDirectives) && rawResult.capitalDirectives.length > 0
              ? rawResult.capitalDirectives.slice(0, 4)
              : [
                  'Sparkling yuzu over crushed ice with a twist of rosemary',
                  'Chilled Phony Negroni or bitter blood-orange apéritif spritz',
                  'Hop-infused sparkling water in a frosty pint glass on weeknights',
                ],
        nextWeekNudge:
          rawResult.nextWeekNudge ||
          'Pick one weeknight evening to trade your usual pour for something sparkling and tart, and log whatever actually happens without fuss.',
        receipt: rawResult.receipt,
      };

      setReport(normalizedReport);
      if (normalizedReport.receipt) {
        recordReceipt(normalizedReport.receipt);
      }
    } catch (err) {
      if (err instanceof SecPrivacyLockBlockedError) {
        setComplianceAlert(err.alert);
      } else {
        setErrorText(
          err instanceof Error
            ? err.message
            : 'Unable to synthesize your 30-day Coaster reflection right now.'
        );
      }
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Dialog open={earningsModalOpen} onOpenChange={setEarningsModalOpen}>
      <DialogContent className="w-[calc(100vw-1.25rem)] sm:w-full max-w-2xl rounded-3xl bg-[#FFFDF9] border border-[#E8DFD1] text-[#1F1B18] p-0 overflow-hidden max-h-[88dvh] flex flex-col shadow-2xl">
        <DialogHeader className="border-b border-[#E8DFD1] bg-[#FAF6F0] px-4 sm:px-6 py-4 space-y-1 shrink-0 text-left">
          <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
            <DialogTitle className="text-base sm:text-lg font-semibold text-[#1F1B18] flex items-center gap-2 font-['Newsreader',Georgia,serif]">
              <Sparkles className="w-4 h-4 text-[#C26D2D] shrink-0" />
              <span>Sunny&apos;s 30-Day Trend Spotter</span>
            </DialogTitle>
            <span className="rounded-md border border-[#E8DFD1] bg-[#FFFDF9] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-[#6E6359]">
              {secPrivacyLock ? 'ONLY_ON_DEVICE' : `PREFER_IN_CLOUD · ${remoteConfig.cfoCloudModel}`}
            </span>
          </div>
          <DialogDescription className="text-xs text-[#6E6359]">
            Spot gentle weekly rhythms, clear-day milestones, drink mix patterns, and zero-proof
            swaps tailored to what you enjoy.
            {!isOnline && ' (Offline: Chrome Gemini Nano fallback armed.)'}
          </DialogDescription>
        </DialogHeader>

        <div className="p-4 sm:p-6 overflow-y-auto space-y-4">
          {!report && !isRunning && !complianceAlert && (
            <div className="rounded-2xl border border-[#E8DFD1] bg-[#FAF6F0] p-6 text-center space-y-3.5">
              <div className="w-12 h-12 rounded-2xl bg-[#FFFDF9] border border-[#E8DFD1] flex items-center justify-center mx-auto shadow-xs">
                <Compass className="w-6 h-6 text-[#C26D2D]" />
              </div>
              <p className="text-base font-semibold text-[#1F1B18] font-['Newsreader',Georgia,serif]">
                Pull up a seat with Sunny
              </p>
              <p className="text-xs sm:text-sm text-[#6E6359] max-w-md mx-auto leading-relaxed">
                Uses <code className="font-mono text-[#C26D2D]">InferenceMode.PREFER_IN_CLOUD</code>{' '}
                via <code className="font-mono text-[#1F1B18]">{remoteConfig.cfoCloudModel}</code>{' '}
                for 30-day synthesis—or runs strictly on-device when Privacy Vault is turned on.
              </p>
              <button
                type="button"
                onClick={handleRunTrendSpotter}
                data-testid="execute-earnings-call-btn"
                className="inline-flex items-center gap-2 rounded-xl bg-[#C26D2D] hover:bg-[#A85B22] text-[#FFFDF9] px-5 py-2.5 text-xs sm:text-sm font-semibold shadow-sm transition-colors"
              >
                <Sparkles className="w-4 h-4" />
                Spot My 30-Day Trends
              </button>
            </div>
          )}

          {isRunning && (
            <div className="rounded-2xl border border-[#E8DFD1] bg-[#FAF6F0] p-8 flex flex-col items-center justify-center space-y-3">
              <Loader2 className="w-7 h-7 animate-spin text-[#C26D2D]" />
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6E6359]">
                Sunny is looking over your last 30 days...
              </p>
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
            <div className="rounded-xl border border-[#C26D2D]/40 bg-[#FEF3C7]/45 px-4 py-3 text-xs text-[#9A4E16]">
              {errorText}
            </div>
          )}

          {report && (
            <div data-testid="earnings-call-report" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {report.receipt && (
                  <ExecutionReceiptBadge
                    inferenceSource={report.receipt.inferenceSource}
                    latencyMs={report.receipt.latencyMs}
                  />
                )}
                {summaryStats && (
                  <span className="text-[11px] font-mono text-[#6E6359]">
                    30d Total: {formatUnits(summaryStats.thirtyDayTotal)} · 7d Avg:{' '}
                    {formatUnits(summaryStats.sevenDayAvg)}/day
                  </span>
                )}
              </div>

              {summaryStats && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="rounded-xl border border-[#E8DFD1] bg-[#FAF6F0] p-3">
                    <p className="text-[10px] uppercase tracking-wider text-[#6E6359] font-semibold">
                      30-Day Units
                    </p>
                    <p className="text-lg font-semibold text-[#1F1B18] font-mono mt-0.5">
                      {formatUnits(summaryStats.thirtyDayTotal)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#E8DFD1] bg-[#FAF6F0] p-3">
                    <p className="text-[10px] uppercase tracking-wider text-[#6E6359] font-semibold">
                      7-Day Daily Avg
                    </p>
                    <p className="text-lg font-semibold text-[#C26D2D] font-mono mt-0.5">
                      {formatUnits(summaryStats.sevenDayAvg)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#3F7D58]/30 bg-[#EAF3ED]/75 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-[#2B5C3F] font-semibold">
                      Clear Days (30d)
                    </p>
                    <p className="text-lg font-semibold text-[#2B5C3F] font-mono mt-0.5">
                      {summaryStats.clearDaysLast30}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#3F7D58]/30 bg-[#EAF3ED]/75 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-[#2B5C3F] font-semibold">
                      Zero-Proof Swaps
                    </p>
                    <p className="text-lg font-semibold text-[#2B5C3F] font-mono mt-0.5">
                      {summaryStats.zeroProofSwapsLast30}
                    </p>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-[#E8DFD1] bg-[#FAF6F0] p-4 space-y-2">
                <h3 className="text-base font-semibold text-[#1F1B18] font-['Newsreader',Georgia,serif]">
                  {report.headline}
                </h3>
                <p className="text-xs sm:text-sm text-[#4A4139] leading-relaxed">
                  {report.rhythmInsight}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-[#3F7D58]/30 bg-[#EAF3ED]/75 p-3.5 space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#2B5C3F] flex items-center gap-1.5">
                    <Leaf className="w-3.5 h-3.5" />
                    Clear Days &amp; Milestones
                  </p>
                  <p className="text-xs text-[#1F1B18] leading-relaxed">
                    {report.clearDayHighlight}
                  </p>
                </div>

                <div className="rounded-xl border border-[#E8DFD1] bg-[#FAF6F0] p-3.5 space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#C26D2D] flex items-center gap-1.5">
                    <CalendarDays className="w-3.5 h-3.5" />
                    Pour &amp; Beverage Mix
                  </p>
                  <p className="text-xs text-[#4A4139] leading-relaxed">
                    {report.mixBreakdown}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-[#E8DFD1] bg-[#FFFDF9] p-4 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#3F7D58] flex items-center gap-1.5">
                  <GlassWater className="w-3.5 h-3.5" />
                  Zero-Proof &amp; Lower-ABV Ideas From Sunny
                </p>
                <ul className="space-y-1.5 text-xs sm:text-sm text-[#1F1B18]">
                  {report.swapIdeas.map((idea, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-[#3F7D58] font-mono font-semibold">0{i + 1}.</span>
                      <span>{idea}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-[#D97706]/30 bg-[#FEF3C7]/40 px-4 py-3 text-xs text-[#4A4139] leading-relaxed">
                <strong className="text-[#9A4E16]">Sunny&apos;s gentle thought for next week:</strong>{' '}
                {report.nextWeekNudge}
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={handleRunTrendSpotter}
                  disabled={isRunning}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#E8DFD1] bg-[#FAF6F0] hover:bg-[#F3ECE1] px-3.5 py-2 text-xs font-semibold text-[#1F1B18]"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-[#C26D2D]" />
                  Refresh 30D Reflection
                </button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
