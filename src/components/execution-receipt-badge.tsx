'use client';

import React from 'react';
import { Cpu, Cloud, ShieldAlert, LockOpen, Sparkles } from 'lucide-react';
import {
  formatExecutionBadge,
  type NormalizedInferenceSource,
  type SecComplianceAlert,
} from '@/lib/hybrid-ai';
import { cn } from '@/lib/utils';

interface ExecutionReceiptBadgeProps {
  inferenceSource: NormalizedInferenceSource;
  latencyMs?: number;
  className?: string;
  compact?: boolean;
}

/**
 * Monospace Hybrid AI execution receipt badge rendered on Sunny responses
 * and parsed Coaster drink entries (`ON_DEVICE` vs `IN_CLOUD`).
 */
export function ExecutionReceiptBadge({
  inferenceSource,
  latencyMs = 120,
  className,
  compact = false,
}: ExecutionReceiptBadgeProps) {
  const isOnDevice = inferenceSource === 'ON_DEVICE';
  const badgeString = formatExecutionBadge(inferenceSource, latencyMs);

  return (
    <span
      data-testid={`exec-badge-${inferenceSource.toLowerCase()}`}
      className={cn(
        'inline-flex items-center gap-1.5 font-mono uppercase tracking-tight rounded-md border px-2 py-0.5 select-all transition-colors',
        compact ? 'text-[9px] leading-tight' : 'text-[10px] leading-snug',
        isOnDevice
          ? 'bg-[#EAF3ED] text-[#2B5C3F] border-[#3F7D58]/40'
          : 'bg-[#FEF3C7]/70 text-[#9A4E16] border-[#D97706]/45',
        className
      )}
    >
      {isOnDevice ? (
        <Cpu className="w-3 h-3 shrink-0 text-[#3F7D58]" />
      ) : (
        <Cloud className="w-3 h-3 shrink-0 text-[#C26D2D]" />
      )}
      <span className="font-semibold">{badgeString}</span>
    </span>
  );
}

interface SecComplianceAlertPanelProps {
  alert: SecComplianceAlert;
  onDisableLock?: () => void;
  onWarmNano?: () => void;
  className?: string;
}

/**
 * Privacy Vault notice shown when `InferenceMode.ONLY_ON_DEVICE` blocks
 * cloud transmission before Chrome's on-device Gemini Nano engine is warmed.
 */
export function SecComplianceAlertPanel({
  alert,
  onDisableLock,
  onWarmNano,
  className,
}: SecComplianceAlertPanelProps) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-xl border border-[#D97706]/50 bg-[#FFFDF9] p-3.5 text-[#1F1B18] shadow-sm space-y-2.5',
        className
      )}
    >
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="w-4 h-4 text-[#C26D2D] shrink-0 mt-0.5" />
        <div className="space-y-1 flex-1 min-w-0">
          <p className="text-[11px] font-bold tracking-wider uppercase text-[#9A4E16] font-mono">
            {alert.headline}
          </p>
          <p className="text-xs text-[#4A4139] leading-relaxed">
            {alert.summary}
          </p>
        </div>
      </div>

      <ol className="space-y-1 pl-5 list-decimal text-[11px] text-[#3F7D58] leading-relaxed">
        {alert.steps.map((step, idx) => (
          <li key={idx}>{step}</li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {onWarmNano && (
          <button
            type="button"
            onClick={onWarmNano}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#3F7D58]/40 bg-[#EAF3ED] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#2B5C3F] hover:bg-[#DCECE1] transition-colors font-mono"
          >
            <Sparkles className="w-3 h-3" />
            Warm Local Nano Engine
          </button>
        )}
        {onDisableLock && (
          <button
            type="button"
            onClick={onDisableLock}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#C26D2D]/40 bg-[#FEF3C7]/60 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#9A4E16] hover:bg-[#FDE68A]/60 transition-colors font-mono"
          >
            <LockOpen className="w-3 h-3" />
            Switch to Hybrid Fallback (PREFER_ON_DEVICE)
          </button>
        )}
      </div>
    </div>
  );
}

export const PrivacyVaultAlertPanel = SecComplianceAlertPanel;
