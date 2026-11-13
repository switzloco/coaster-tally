'use client';

import React from 'react';
import {
  Cpu,
  Lock,
  Unlock,
  Wifi,
  WifiOff,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useHybridAi } from '@/components/hybrid-ai-provider';
import { cn } from '@/lib/utils';

function buildProgressBar(pct: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const filled = Math.round(clamped / 10);
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
}

/**
 * Top-Bar Hybrid AI Telemetry Strip for Coaster.
 * Surfaces Chrome Built-in AI (`LanguageModel`) readiness, 1-click Nano warmup,
 * Offline IndexedDB indicator, Privacy Vault (`ONLY_ON_DEVICE`) toggle,
 * and Sunny's 30-Day Trend Spotter trigger (`PREFER_IN_CLOUD`).
 */
export function LocalAiTelemetryBar() {
  const {
    nanoStatus,
    isWarmingNano,
    nanoDownloadPct,
    warmNanoError,
    warmNano,
    isOnline,
    secPrivacyLock,
    setSecPrivacyLock,
    remoteConfig,
    setEarningsModalOpen,
  } = useHybridAi();

  const pct = nanoDownloadPct ?? 0;

  return (
    <div className="w-full bg-[#241E19] border-b border-[#3D332B] px-2.5 md:px-6 py-1.5 font-mono text-[9.5px] md:text-[10px] text-[#FAF6F0] select-none shrink-0">
      <div className="flex items-center justify-between gap-1.5 whitespace-nowrap overflow-x-auto no-scrollbar">
        {/* Left: Local AI Engine Status + 1-Click Warmup */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#312821] border border-[#493C32]">
            <span
              className={cn(
                'w-1.5 h-1.5 md:w-2 md:h-2 rounded-full shrink-0',
                nanoStatus === 'available'
                  ? 'bg-[#6EE7B7] shadow-[0_0_8px_rgba(110,231,183,0.75)]'
                  : isWarmingNano || nanoStatus === 'downloading'
                    ? 'bg-[#FBBF24] animate-pulse'
                    : nanoStatus === 'downloadable'
                      ? 'bg-[#F59E0B]'
                      : 'bg-[#D97706]/80'
              )}
            />
            <Cpu className="w-3 h-3 text-[#E7D8C5] shrink-0 hidden sm:inline" />
            {isWarmingNano || nanoStatus === 'downloading' ? (
              <>
                <span className="sm:hidden text-[#FCD34D] font-bold tracking-wider">
                  NANO {pct}%
                </span>
                <span className="hidden sm:inline text-[#FCD34D] font-bold tracking-wider">
                  WARMING NANO: {pct}% [{buildProgressBar(pct)}]
                </span>
              </>
            ) : nanoStatus === 'available' ? (
              <>
                <span className="sm:hidden text-[#86EFAC] font-bold tracking-wider">
                  NANO · PRIVATE
                </span>
                <span className="hidden sm:inline text-[#86EFAC] font-bold tracking-wider">
                  ON-DEVICE NANO: READY
                </span>
              </>
            ) : nanoStatus === 'downloadable' ? (
              <>
                <span className="sm:hidden text-[#FCD34D] font-bold tracking-wider">
                  NANO READY
                </span>
                <span className="hidden sm:inline text-[#FCD34D] font-bold tracking-wider">
                  ON-DEVICE NANO: READY TO WARM
                </span>
              </>
            ) : (
              <>
                <span className="sm:hidden text-[#FDE68A] font-semibold tracking-wider">
                  HYBRID AI
                </span>
                <span className="hidden sm:inline text-[#FDE68A] font-semibold tracking-wider">
                  HYBRID ENGINE ({remoteConfig.cfoCloudModel})
                </span>
              </>
            )}
          </div>

          {nanoStatus !== 'available' && !isWarmingNano && (
            <button
              type="button"
              onClick={warmNano}
              data-testid="warm-local-nano-btn"
              className={cn(
                'items-center gap-1 rounded-md border border-[#3F7D58]/70 bg-[#3F7D58]/25 hover:bg-[#3F7D58]/40 px-2 py-0.5 text-[9.5px] md:text-[10px] font-bold uppercase tracking-wider text-[#A7F3D0] transition-colors',
                nanoStatus === 'downloadable' ? 'inline-flex' : 'hidden sm:inline-flex'
              )}
              title="Download and warm Chrome's built-in Gemini Nano model for private offline inference"
            >
              <Zap className="w-3 h-3 text-[#86EFAC]" />
              <span className="hidden md:inline">WARM LOCAL NANO</span>
              <span className="md:hidden">WARM NANO</span>
            </button>
          )}
        </div>

        {/* Right: Network Telemetry + Privacy Vault + 30D Trend Spotter */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-1.5 sm:px-2 py-0.5 border font-bold uppercase tracking-wider',
              isOnline
                ? 'border-[#493C32] bg-[#312821] text-[#A7F3D0]'
                : 'border-[#F59E0B]/60 bg-[#78350F]/50 text-[#FDE68A] animate-pulse'
            )}
            title={isOnline ? 'Network Online' : 'Offline — Local Coaster Ledger Active'}
          >
            {isOnline ? (
              <>
                <Wifi className="w-3 h-3" />
                <span className="hidden sm:inline">ONLINE</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3" />
                <span className="sm:hidden">OFFLINE</span>
                <span className="hidden sm:inline">OFFLINE · LOCAL COASTER</span>
              </>
            )}
          </span>

          <button
            type="button"
            onClick={() => setSecPrivacyLock(!secPrivacyLock)}
            data-testid="sec-privacy-lock-toggle"
            aria-pressed={secPrivacyLock}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-1.5 sm:px-2 py-0.5 border font-bold uppercase tracking-wider transition-all',
              secPrivacyLock
                ? 'border-[#6EE7B7]/70 bg-[#3F7D58]/35 text-[#D1FAE5] shadow-[0_0_10px_rgba(63,125,88,0.35)]'
                : 'border-[#493C32] bg-[#312821] text-[#D6C8B8] hover:border-[#C26D2D]/60 hover:text-[#FAF6F0]'
            )}
            title="Toggle Privacy Vault (InferenceMode.ONLY_ON_DEVICE)"
          >
            {secPrivacyLock ? (
              <>
                <Lock className="w-3 h-3 text-[#86EFAC]" />
                <span className="sm:hidden">VAULT: ON</span>
                <span className="hidden sm:inline">PRIVACY VAULT: ON</span>
              </>
            ) : (
              <>
                <Unlock className="w-3 h-3 text-[#F59E0B]" />
                <span className="sm:hidden">VAULT: OFF</span>
                <span className="hidden sm:inline">PRIVACY VAULT: OFF</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setEarningsModalOpen(true)}
            data-testid="header-earnings-call-btn"
            className="inline-flex items-center gap-1 rounded-md px-1.5 sm:px-2 py-0.5 border border-[#C26D2D]/70 bg-[#C26D2D]/25 hover:bg-[#C26D2D]/40 text-[#FDE68A] font-bold uppercase tracking-wider transition-colors"
            title="Open Sunny's 30-Day Trend Spotter (InferenceMode.PREFER_IN_CLOUD)"
          >
            <Sparkles className="w-3 h-3 text-[#FBBF24]" />
            <span className="hidden sm:inline">30D TREND SPOTTER</span>
            <span className="sm:hidden">30D</span>
          </button>
        </div>
      </div>

      {warmNanoError && (
        <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-[#F59E0B]/40 bg-[#78350F]/40 px-2 py-0.5 text-[9.5px] text-[#FDE68A]">
          <span className="truncate">{warmNanoError}</span>
        </div>
      )}
    </div>
  );
}
