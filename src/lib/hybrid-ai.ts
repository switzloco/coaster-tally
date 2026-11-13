/**
 * @fileOverview Coaster Hybrid AI Engine (`firebase/ai` v13.3.0).
 *
 * Implements #BuildHybridAI 2026 architecture:
 * - Chrome Built-in AI (`window.LanguageModel`) passive probe & click-gated download warmup
 * - Remote Config (`gemini-3.8-flash` default) & Firebase App Check verification
 * - Live Telemetry pub/sub stream (`subscribeTelemetry`, `TelemetryEvent`)
 * - Feature A: Instant Natural-Language Drink Parser (`PREFER_ON_DEVICE` + offline fallback)
 * - Feature B: Multimodal Drink Menu & Bottle Label Auditor (`PREFER_ON_DEVICE`)
 * - Feature C: Privacy Vault Strict On-Device 30D Audit (`ONLY_ON_DEVICE` + local fallback)
 * - Feature D: 30D Trend Reflection & Tailored Zero-Proof Swap Synthesis (`PREFER_IN_CLOUD` + local fallback)
 *
 * STRICT SDK COMPLIANCE:
 * 1. `getGenerativeModel(ai, ...)` is NEVER called during module init or `initializeHybridAI()`.
 * 2. Cloud fallback model comes from Remote Config (`gemini-3.8-flash` default), never retired `gemini-2.0-*`.
 * 3. Sunny booth-buddy voice: warm, observant, zero judgment, never preachy, zero calorie/macro scoring.
 */

import type { FirebaseApp } from 'firebase/app';
import {
  getGenerativeModel,
  InferenceMode,
  InferenceSource,
  Schema,
  type Part,
} from 'firebase/ai';
import { getFirebaseAI, getFirebaseAgentPlatformAI } from '@/firebase/ai';
import { ensureFirebaseAppCheck, type AppCheckTelemetryStatus } from '@/firebase/app-check';
import {
  getCfoRemoteConfigSnapshot,
  getCoasterRemoteConfigSnapshot,
  sanitizeCloudModelName,
  type HybridDefaultModeKey,
} from '@/firebase/remote-config';
import {
  DRINK_CATEGORY_DEFAULTS,
  reconcileDrinkDescription,
  reconcileDrinkItems,
  type RawDrinkCandidateInput,
  type ReconciledDrink,
} from './drink-reconciler';
import {
  calculateStandardUnits,
  computeDayOfWeekPattern,
  computeTrendSummary,
  formatUnits,
  getEntryUnits,
  getSunnyPourNote,
  getSunnySwapSuggestion,
  isClearDayEntry,
  isZeroProofEntry,
  shouldOfferBuddySwap,
  type DrinkCategory,
  type TrendSummary,
} from './drink-units';
import type { ExerciseLogEntry, FoodLogEntry } from './food-exercise-types';
import type { HealthData, UserPreferences } from './health-service';
import {
  inferMealSlotByLocalHour,
  type ReconciledFoodDraft,
  type ReconciledWorkoutDraft,
} from './usda-local-reconciler';

// ── Types & Telemetry ─────────────────────────────────────────────────────────

export type NormalizedInferenceSource = 'ON_DEVICE' | 'IN_CLOUD';

export type LocalNanoStatus =
  | 'available'
  | 'downloadable'
  | 'downloading'
  | 'unavailable';

export type TelemetryFeature =
  | 'INIT'
  | 'CAPABILITIES'
  | 'WARMUP'
  | 'DRINK_PARSE'
  | 'DRINK_RECEIPT'
  | 'PRIVACY_VAULT'
  | 'TREND_REFLECTION'
  | 'BUDDY_CHAT'
  | 'TICKER_TAPE'
  | 'EXPENSE_RECEIPT'
  | 'SEC_BIOMETRIC_AUDIT'
  | 'EARNINGS_CALL'
  | 'HYBRID_COACH';

export interface TelemetryEvent {
  id: string;
  feature: TelemetryFeature;
  inferenceSource: NormalizedInferenceSource | 'LOCAL_FALLBACK';
  modeRequested: InferenceMode;
  modelName: string;
  latencyMs: number;
  success: boolean;
  fallbackUsed: boolean;
  appCheckStatus?: AppCheckTelemetryStatus;
  detail?: string;
  timestamp: number;
}

export interface HybridExecutionReceipt {
  id: string;
  inferenceSource: NormalizedInferenceSource;
  latencyMs: number;
  modeRequested: InferenceMode;
  cloudModelConfigured: string;
  badgeText: string;
  feature: TelemetryFeature;
  timestamp: number;
  fallbackUsed?: boolean;
}

export interface HybridCapabilities {
  nanoStatus: LocalNanoStatus;
  onDeviceAvailable: boolean;
  cloudAvailable: boolean;
  cloudModel: string;
  remoteConfigSource: 'default' | 'remote' | 'static';
  appCheckStatus: AppCheckTelemetryStatus;
  inferenceModesSupported: InferenceMode[];
  privacyVaultReady: boolean;
  checkedAt: number;
}

export interface SecComplianceAlert {
  code: 'SEC_LOCK_NANO_UNAVAILABLE';
  headline: string;
  summary: string;
  steps: string[];
}

export class SecPrivacyLockBlockedError extends Error {
  readonly alert: SecComplianceAlert;

  constructor(alert: SecComplianceAlert) {
    super(alert.summary);
    this.name = 'SecPrivacyLockBlockedError';
    this.alert = alert;
  }
}

const telemetryListeners = new Set<(event: TelemetryEvent) => void>();
const telemetryHistory: TelemetryEvent[] = [];
const MAX_TELEMETRY_HISTORY = 50;

function emitTelemetry(event: Omit<TelemetryEvent, 'id' | 'timestamp'>): TelemetryEvent {
  const full: TelemetryEvent = {
    ...event,
    id: `tel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
  };
  telemetryHistory.push(full);
  if (telemetryHistory.length > MAX_TELEMETRY_HISTORY) {
    telemetryHistory.splice(0, telemetryHistory.length - MAX_TELEMETRY_HISTORY);
  }
  for (const listener of telemetryListeners) {
    try {
      listener(full);
    } catch {
      // Listener failures must never disrupt inference or fallback flows.
    }
  }
  return full;
}

export function subscribeTelemetry(listener: (event: TelemetryEvent) => void): () => void {
  telemetryListeners.add(listener);
  return () => {
    telemetryListeners.delete(listener);
  };
}

export function getRecentTelemetry(): TelemetryEvent[] {
  return [...telemetryHistory];
}

export function clearTelemetry(): void {
  telemetryHistory.length = 0;
}

// ── Chrome Built-in AI (`window.LanguageModel`) Global Typing ─────────────────

interface ChromePromptMonitor {
  addEventListener: (
    event: 'downloadprogress',
    cb: (e: { loaded?: number; total?: number }) => void,
  ) => void;
}

interface ChromeLanguageModelGlobal {
  availability?: (options?: {
    expectedInputs?: Array<{ type: 'text' | 'image' | 'audio' }>;
  }) => Promise<string>;
  create?: (options?: {
    monitor?: (m: ChromePromptMonitor) => void;
    expectedInputs?: Array<{ type: 'text' | 'image' | 'audio' }>;
  }) => Promise<{ destroy?: () => void }>;
}

function getChromeLanguageModelGlobal(): ChromeLanguageModelGlobal | null {
  if (typeof globalThis === 'undefined') return null;
  const g = globalThis as unknown as {
    LanguageModel?: ChromeLanguageModelGlobal;
    ai?: {
      languageModel?: ChromeLanguageModelGlobal & {
        capabilities?: () => Promise<{ available?: string }>;
      };
    };
  };
  if (g.LanguageModel) return g.LanguageModel;
  if (g.ai?.languageModel) return g.ai.languageModel;
  return null;
}

/**
 * Safe passive telemetry probe (NEVER calls `getGenerativeModel` or downloads weights).
 */
export async function probeLocalNanoAvailability(): Promise<LocalNanoStatus> {
  const lm = getChromeLanguageModelGlobal();
  if (!lm) return 'unavailable';

  try {
    if (typeof lm.availability === 'function') {
      const raw = await lm.availability({ expectedInputs: [{ type: 'text' }] });
      const val = String(raw || '').toLowerCase();
      if (val === 'available' || val === 'readily') return 'available';
      if (val === 'downloadable' || val === 'after-download') return 'downloadable';
      if (val === 'downloading') return 'downloading';
      return 'unavailable';
    }
    const legacy = lm as { capabilities?: () => Promise<{ available?: string }> };
    if (typeof legacy.capabilities === 'function') {
      const caps = await legacy.capabilities();
      const val = String(caps?.available || '').toLowerCase();
      if (val === 'readily' || val === 'available') return 'available';
      if (val === 'after-download' || val === 'downloadable') return 'downloadable';
    }
  } catch {
    return 'unavailable';
  }
  return 'unavailable';
}

/**
 * Passive capability probe & App Check/Remote Config verification.
 * Strictly NEVER invokes `getGenerativeModel(...)`.
 */
export async function getHybridCapabilities(
  firebaseApp?: FirebaseApp | null,
): Promise<HybridCapabilities> {
  const startedAt = nowMs();
  const nanoStatus = await probeLocalNanoAvailability();
  const appCheckTelemetry = firebaseApp
    ? ensureFirebaseAppCheck(firebaseApp)
    : { status: 'standby' as AppCheckTelemetryStatus };
  const rc = getCoasterRemoteConfigSnapshot(firebaseApp ?? null);
  const cloudAvailable = Boolean(firebaseApp) &&
    (typeof navigator === 'undefined' || navigator.onLine !== false);

  const capabilities: HybridCapabilities = {
    nanoStatus,
    onDeviceAvailable: nanoStatus === 'available',
    cloudAvailable,
    cloudModel: rc.coasterCloudModel || rc.cfoCloudModel,
    remoteConfigSource: rc.source,
    appCheckStatus: appCheckTelemetry.status,
    inferenceModesSupported: [
      InferenceMode.PREFER_ON_DEVICE,
      InferenceMode.ONLY_ON_DEVICE,
      InferenceMode.PREFER_IN_CLOUD,
      InferenceMode.ONLY_IN_CLOUD,
    ],
    privacyVaultReady: true,
    checkedAt: Date.now(),
  };

  emitTelemetry({
    feature: 'CAPABILITIES',
    inferenceSource: nanoStatus === 'available' ? 'ON_DEVICE' : 'LOCAL_FALLBACK',
    modeRequested: InferenceMode.PREFER_ON_DEVICE,
    modelName: capabilities.cloudModel,
    latencyMs: elapsedMs(startedAt),
    success: true,
    fallbackUsed: false,
    appCheckStatus: capabilities.appCheckStatus,
    detail: `nano=${nanoStatus}, remoteConfig=${rc.source}`,
  });

  return capabilities;
}

/**
 * Initializes passive Hybrid AI telemetry, App Check, Remote Config snapshot,
 * and Chrome Built-in AI availability status without creating models eagerly.
 */
export async function initializeHybridAI(
  firebaseApp?: FirebaseApp | null,
): Promise<HybridCapabilities> {
  const startedAt = nowMs();
  const caps = await getHybridCapabilities(firebaseApp);
  emitTelemetry({
    feature: 'INIT',
    inferenceSource: caps.onDeviceAvailable ? 'ON_DEVICE' : 'LOCAL_FALLBACK',
    modeRequested: InferenceMode.PREFER_ON_DEVICE,
    modelName: caps.cloudModel,
    latencyMs: elapsedMs(startedAt),
    success: true,
    fallbackUsed: false,
    appCheckStatus: caps.appCheckStatus,
    detail: `Coaster Hybrid AI ready (${caps.cloudModel}, nano=${caps.nanoStatus})`,
  });
  return caps;
}

/**
 * Triggers Chrome Gemini Nano weight download inside an explicit user click handler.
 */
export async function warmLocalNanoEngine(
  firebaseApp: FirebaseApp,
  onProgress: (percent: number) => void,
): Promise<LocalNanoStatus> {
  const startedAt = nowMs();
  onProgress(2);
  const lm = getChromeLanguageModelGlobal();

  if (lm && typeof lm.create === 'function') {
    const session = await lm.create({
      expectedInputs: [{ type: 'text' }],
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          const ratio = typeof e.loaded === 'number' ? e.loaded : 0;
          const pct = ratio <= 1 ? Math.round(ratio * 100) : Math.round(ratio);
          onProgress(Math.min(99, Math.max(2, pct)));
        });
      },
    });
    session?.destroy?.();
    onProgress(100);
    const status = await probeLocalNanoAvailability();
    emitTelemetry({
      feature: 'WARMUP',
      inferenceSource: 'ON_DEVICE',
      modeRequested: InferenceMode.PREFER_ON_DEVICE,
      modelName: 'gemini-nano',
      latencyMs: elapsedMs(startedAt),
      success: true,
      fallbackUsed: false,
      detail: `Chrome Nano warmed (${status})`,
    });
    return status;
  }

  // Fallback via Firebase AI Logic SDK device model initializer (inside click handler)
  const ai = getFirebaseAI(firebaseApp);
  const rc = getCfoRemoteConfigSnapshot(firebaseApp);
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_ON_DEVICE,
    inCloudParams: { model: rc.cfoCloudModel },
  });
  await model.initializeDeviceModel((progressValue) => {
    const pct =
      progressValue <= 1 ? Math.round(progressValue * 100) : Math.round(progressValue);
    onProgress(Math.min(99, Math.max(2, pct)));
  });
  onProgress(100);
  const status = await probeLocalNanoAvailability();
  emitTelemetry({
    feature: 'WARMUP',
    inferenceSource: 'ON_DEVICE',
    modeRequested: InferenceMode.PREFER_ON_DEVICE,
    modelName: 'gemini-nano',
    latencyMs: elapsedMs(startedAt),
    success: true,
    fallbackUsed: false,
    detail: `Firebase AI Nano initialized (${status})`,
  });
  return status;
}

// ── Execution Receipt & Privacy Vault Alert Helpers ───────────────────────────

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function elapsedMs(startedAt: number): number {
  return Math.max(1, Math.round(nowMs() - startedAt));
}

export function normalizeInferenceSource(
  rawSource?: InferenceSource | string | null,
): NormalizedInferenceSource {
  const upper = String(rawSource || '').toUpperCase();
  if (upper === 'ON_DEVICE' || rawSource === InferenceSource.ON_DEVICE) {
    return 'ON_DEVICE';
  }
  return 'IN_CLOUD';
}

export function formatExecutionBadge(
  source: NormalizedInferenceSource,
  latencyMs: number,
): string {
  const cleanMs = Math.max(1, Math.round(latencyMs));
  return source === 'ON_DEVICE'
    ? `⚡ On-Device Nano (${cleanMs}ms)`
    : `☁️ Cloud Gemini (${cleanMs}ms)`;
}

function buildExecutionReceipt(params: {
  rawSource?: InferenceSource | string | null;
  latencyMs: number;
  modeRequested: InferenceMode;
  cloudModelConfigured: string;
  feature: TelemetryFeature;
  fallbackUsed?: boolean;
}): HybridExecutionReceipt {
  const inferenceSource = normalizeInferenceSource(params.rawSource);
  const latencyMs = Math.max(1, Math.round(params.latencyMs));
  const badgeText = params.fallbackUsed
    ? `⚡ Local Coaster Engine (${latencyMs}ms)`
    : formatExecutionBadge(inferenceSource, latencyMs);
  return {
    id: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    inferenceSource,
    latencyMs,
    modeRequested: params.modeRequested,
    cloudModelConfigured: params.cloudModelConfigured,
    badgeText,
    feature: params.feature,
    timestamp: Date.now(),
    fallbackUsed: params.fallbackUsed ?? false,
  };
}

export function buildSecComplianceAlert(detail?: string): SecComplianceAlert {
  return {
    code: 'SEC_LOCK_NANO_UNAVAILABLE',
    headline: 'PRIVACY VAULT // ON-DEVICE ENGINE REQUIRED',
    summary:
      detail ||
      'Strict On-Device Mode (InferenceMode.ONLY_ON_DEVICE) kept all data local because Chrome Gemini Nano is not active in this browser session.',
    steps: [
      'Open Chrome Desktop (v138+) and navigate to chrome://flags/#optimization-guide-on-device-model -> set to Enabled BypassPerfRequirement.',
      'Navigate to chrome://flags/#prompt-api-for-gemini-nano-multimodal-input -> set to Enabled, then relaunch Chrome.',
      'Open Preferences -> Hybrid AI & Privacy Vault and click Download Local Model, or disable Strict Privacy Vault Lock.',
    ],
  };
}

function resolveRequestedMode(
  secPrivacyLock: boolean,
  remoteDefault: HybridDefaultModeKey,
  preferredOverride?: InferenceMode,
): InferenceMode {
  if (secPrivacyLock) {
    return InferenceMode.ONLY_ON_DEVICE;
  }
  if (preferredOverride) {
    return preferredOverride;
  }
  switch (remoteDefault) {
    case 'ONLY_ON_DEVICE':
      return InferenceMode.ONLY_ON_DEVICE;
    case 'PREFER_IN_CLOUD':
      return InferenceMode.PREFER_IN_CLOUD;
    case 'ONLY_IN_CLOUD':
      return InferenceMode.ONLY_IN_CLOUD;
    case 'PREFER_ON_DEVICE':
    default:
      return InferenceMode.PREFER_ON_DEVICE;
  }
}

// ── Sunny Booth-Buddy Persona Prompt Helpers ──────────────────────────────────

const SUNNY_SYSTEM_GUIDELINES = [
  'You are Sunny, a warm, friendly non-drinking booth-buddy in Coaster.',
  'Coaster counts drinks purely in NIAAA Standard Drink Units (1.0u = 14g pure ethanol = 0.6 fl oz pure alcohol).',
  'Zero calories, zero macros, zero protein, zero exercise points.',
  'Tone rules:',
  '- Warm, upbeat, observant, zero judgment, zero lecturing, zero guilt; NEVER joke about a person drinking heavily or tease their tolerance.',
  '- Humor may lightly poke fun at pretentious bar menus, absurd IPA names, or oversized glassware.',
  '- Respect zero-proof pours and clear days wholeheartedly.',
].join('\n');

const NANO_PROMPT_MAX_CHARS = 7_500;

function truncateForNanoBudget(text: string, maxChars = NANO_PROMPT_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  const headCount = Math.floor(maxChars * 0.72);
  const tailCount = maxChars - headCount - 48;
  return `${text.slice(0, headCount)}\n\n...[truncated for Nano budget]...\n\n${text.slice(-tailCount)}`;
}

// ── Cloud Model Candidate & Resilient Invocation Chain ────────────────────────

const CLOUD_MODEL_FALLBACK_CHAIN = [
  'gemini-3.8-flash',
  'gemini-2.5-flash',
] as const;

function buildCloudModelCandidates(primaryModel: string): string[] {
  const sanitizedPrimary = sanitizeCloudModelName(primaryModel);
  const seen = new Set<string>([sanitizedPrimary]);
  for (const candidate of CLOUD_MODEL_FALLBACK_CHAIN) {
    const clean = sanitizeCloudModelName(candidate);
    if (!seen.has(clean)) seen.add(clean);
  }
  return Array.from(seen);
}

function isModelOrBackendRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /404|429|402|prepayment credits|quota|resource_exhausted|not[\s_-]*found|does not exist|not supported for generateContent/i.test(
    msg,
  );
}

function isQuotaOrBillingDepletedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /429|402|prepayment credits|quota|resource_exhausted/i.test(msg);
}

function isOnDeviceQuotaOrUnavailableError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  const msg = err instanceof Error ? err.message : String(err || '');
  return (
    name === 'QuotaExceededError' ||
    /input is too large|quota[\s_-]*exceeded|not[\s_-]*available|prompt api|on-device/i.test(msg)
  );
}

let googleAiStudioQuotaDepleted = false;

async function runResilientHybridGenerateContent(params: {
  ai: ReturnType<typeof getFirebaseAI>;
  mode: InferenceMode;
  primaryCloudModel: string;
  request: string | Array<string | Part>;
  schema?: ReturnType<typeof Schema.object>;
  multimodal?: boolean;
}) {
  const { ai, mode, primaryCloudModel, request, schema, multimodal = false } = params;
  const cloudCandidates = buildCloudModelCandidates(primaryCloudModel);

  const invokeOnce = async (
    targetAi: ReturnType<typeof getFirebaseAI>,
    activeMode: InferenceMode,
    cloudModel: string,
    includeOnDeviceConstraint: boolean,
  ) => {
    const model = getGenerativeModel(targetAi, {
      mode: activeMode,
      inCloudParams: {
        model: cloudModel,
        ...(schema
          ? {
              generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: schema,
              },
            }
          : {}),
      },
      onDeviceParams: {
        createOptions: {
          expectedInputs: multimodal
            ? [{ type: 'image' as const }, { type: 'text' as const, languages: ['en'] }]
            : [{ type: 'text' as const, languages: ['en'] }],
        },
        ...(schema && includeOnDeviceConstraint
          ? {
              promptOptions: {
                responseConstraint: schema,
              },
            }
          : {}),
      },
    });
    return model.generateContent(request);
  };

  if (mode === InferenceMode.ONLY_ON_DEVICE) {
    try {
      return {
        result: await invokeOnce(ai, InferenceMode.ONLY_ON_DEVICE, cloudCandidates[0], true),
        resolvedCloudModel: cloudCandidates[0],
      };
    } catch (firstErr) {
      if (schema) {
        return {
          result: await invokeOnce(ai, InferenceMode.ONLY_ON_DEVICE, cloudCandidates[0], false),
          resolvedCloudModel: cloudCandidates[0],
        };
      }
      throw firstErr;
    }
  }

  const agentPlatformAi = getFirebaseAgentPlatformAI(ai.app);
  const backends: Array<ReturnType<typeof getFirebaseAI>> = googleAiStudioQuotaDepleted
    ? [agentPlatformAi, ai]
    : [ai, agentPlatformAi];

  let lastError: unknown = null;
  for (let bIdx = 0; bIdx < backends.length; bIdx++) {
    const targetAi = backends[bIdx];
    let switchBackend = false;

    for (let i = 0; i < cloudCandidates.length; i++) {
      const candidateModel = cloudCandidates[i];
      const effectiveMode = bIdx === 0 && i === 0 ? mode : InferenceMode.ONLY_IN_CLOUD;
      try {
        const result = await invokeOnce(targetAi, effectiveMode, candidateModel, true);
        return { result, resolvedCloudModel: candidateModel };
      } catch (err) {
        lastError = err;
        const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;

        if (
          effectiveMode !== InferenceMode.ONLY_IN_CLOUD &&
          isOnline &&
          isOnDeviceQuotaOrUnavailableError(err)
        ) {
          try {
            const cloudResult = await invokeOnce(
              targetAi,
              InferenceMode.ONLY_IN_CLOUD,
              candidateModel,
              false,
            );
            return { result: cloudResult, resolvedCloudModel: candidateModel };
          } catch (cloudErr) {
            lastError = cloudErr;
            if (bIdx === 0 && isQuotaOrBillingDepletedError(cloudErr)) {
              if (targetAi === ai) googleAiStudioQuotaDepleted = true;
              switchBackend = true;
              break;
            }
            if (isModelOrBackendRetryableError(cloudErr)) {
              continue;
            }
            throw cloudErr;
          }
        }

        if (bIdx === 0 && isQuotaOrBillingDepletedError(err)) {
          if (targetAi === ai) googleAiStudioQuotaDepleted = true;
          switchBackend = true;
          break;
        }
        if (isModelOrBackendRetryableError(err)) {
          continue;
        }
        throw err;
      }
    }

    if (!switchBackend) {
      break;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Hybrid AI cloud fallback failed across all candidate models.');
}

// ── Shared Structured Output Schemas (`Schema.object(...)`) ───────────────────

const DRINK_CATEGORY_ENUM: DrinkCategory[] = [
  'beer',
  'wine',
  'spirits',
  'cocktail',
  'seltzer',
  'zero-proof',
  'clear-day',
];

export const drinkParseSchema = Schema.object({
  properties: {
    items: Schema.array({
      items: Schema.object({
        properties: {
          name: Schema.string(),
          quantity: Schema.number(),
          volumeOz: Schema.number(),
          abvPct: Schema.number(),
          category: Schema.enumString({ enum: DRINK_CATEGORY_ENUM }),
          zeroProof: Schema.boolean(),
          isClearDay: Schema.boolean(),
        },
        optionalProperties: ['zeroProof', 'isClearDay'],
      }),
    }),
    buddyNote: Schema.string(),
    alternativeSuggestion: Schema.string(),
  },
  optionalProperties: ['alternativeSuggestion'],
});

export const drinkReceiptSchema = Schema.object({
  properties: {
    receiptTitle: Schema.string(),
    items: Schema.array({
      items: Schema.object({
        properties: {
          name: Schema.string(),
          quantity: Schema.number(),
          volumeOz: Schema.number(),
          abvPct: Schema.number(),
          category: Schema.enumString({ enum: DRINK_CATEGORY_ENUM }),
          zeroProof: Schema.boolean(),
          isClearDay: Schema.boolean(),
        },
        optionalProperties: ['zeroProof', 'isClearDay'],
      }),
    }),
    buddyNote: Schema.string(),
    alternativeSuggestion: Schema.string(),
  },
  optionalProperties: ['alternativeSuggestion'],
});

export const trendReflectionSchema = Schema.object({
  properties: {
    headline: Schema.string(),
    rhythmInsight: Schema.string(),
    clearDayHighlight: Schema.string(),
    mixBreakdown: Schema.array({
      items: Schema.object({
        properties: {
          category: Schema.enumString({ enum: DRINK_CATEGORY_ENUM }),
          units: Schema.number(),
          pct: Schema.number(),
          label: Schema.string(),
        },
      }),
    }),
    swapIdeas: Schema.array({
      items: Schema.string(),
    }),
    nextWeekNudge: Schema.string(),
  },
});

export const ledgerEntrySchema = drinkParseSchema;
export const expenseReceiptSchema = drinkReceiptSchema;
export const earningsCallSchema = trendReflectionSchema;

function safeJsonParse<T>(rawText: string): T | null {
  try {
    return JSON.parse(rawText) as T;
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

function categoryDisplayLabel(category: DrinkCategory): string {
  switch (category) {
    case 'beer':
      return 'Beer & Cider';
    case 'wine':
      return 'Wine';
    case 'cocktail':
      return 'Cocktails';
    case 'spirits':
      return 'Spirits';
    case 'seltzer':
      return 'Seltzers & RTDs';
    case 'zero-proof':
      return 'Zero-Proof Swaps';
    case 'clear-day':
      return 'Clear Days';
  }
}

function reconciledDrinkToFoodDraft(item: ReconciledDrink): ReconciledFoodDraft {
  return {
    name: item.name,
    portionG: Math.round(item.volumeOz * 29.57),
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fiberG: 0,
    hasSeedOils: false,
    alcoholDrinks: item.units,
    meal: item.isClearDay ? 'clear-day' : 'drink',
    source: 'preset',
    cfoClass: item.isZeroProof || item.isClearDay ? 'CAPITAL_ASSET_INFLOW' : 'OPERATING_FUEL',
    usdaMatched: item.matched,
  };
}

// ── Feature A: Instant Natural-Language Drink Parser ──────────────────────────

export interface EstimatedDrinkItem extends ReconciledDrink {
  confidence: 'exact' | 'matched' | 'estimated';
}

function toEstimatedDrinkItem(
  item: ReconciledDrink,
  confidence?: EstimatedDrinkItem['confidence'],
): EstimatedDrinkItem {
  return {
    ...item,
    confidence: confidence ?? (item.matched ? 'matched' : 'estimated'),
  };
}

export interface EstimateDrinkOptions {
  firebaseApp?: FirebaseApp | null;
  secPrivacyLock?: boolean;
  alcoholicLogCount?: number;
  askForSwap?: boolean;
  strictNanoOnly?: boolean;
}

export interface EstimateDrinkInput extends EstimateDrinkOptions {
  text?: string;
  rawText?: string;
  description?: string;
}

export interface EstimateDrinkResult {
  items: EstimatedDrinkItem[];
  foods: ReconciledFoodDraft[];
  totalUnits: number;
  totalVolumeOz: number;
  isClearDay: boolean;
  isZeroProof: boolean;
  category: DrinkCategory;
  buddyNote: string;
  alternativeSuggestion?: string;
  cfoAuditNote: string;
  inferenceSource: NormalizedInferenceSource | 'LOCAL_FALLBACK';
  fallbackUsed: boolean;
  receipt: HybridExecutionReceipt;
}

interface RawDrinkParseJson {
  items?: Array<{
    name: string;
    quantity?: number;
    volumeOz?: number;
    abvPct?: number;
    category?: DrinkCategory;
    zeroProof?: boolean;
    isClearDay?: boolean;
  }>;
  buddyNote?: string;
  alternativeSuggestion?: string;
}

function buildSunnyDrinkResponseMeta(params: {
  items: EstimatedDrinkItem[];
  text: string;
  alcoholicLogCount: number;
  askForSwap: boolean;
  aiBuddyNote?: string;
  aiSwapSuggestion?: string;
}): {
  totalUnits: number;
  totalVolumeOz: number;
  isClearDay: boolean;
  isZeroProof: boolean;
  primaryCategory: DrinkCategory;
  buddyNote: string;
  alternativeSuggestion?: string;
} {
  const totalUnits = round1(params.items.reduce((sum, item) => sum + item.units, 0));
  const totalVolumeOz = round1(
    params.items.reduce((sum, item) => sum + item.volumeOz * item.quantity, 0),
  );
  const isClearDay = params.items.every((item) => item.isClearDay) && params.items.length > 0;
  const isZeroProof = !isClearDay && params.items.every((item) => item.zeroProof || item.units === 0);
  const primaryCategory: DrinkCategory =
    params.items.find((item) => !item.isClearDay && !item.zeroProof)?.category ??
    params.items[0]?.category ??
    'beer';

  const userAskedForSwap =
    params.askForSwap ||
    /\b(swap|alternative|zero[- ]?proof|mocktail|na\b|non[- ]?alcoholic|lower abv)\b/i.test(
      params.text,
    );

  const shouldSuggestSwap =
    !isClearDay &&
    !isZeroProof &&
    totalUnits > 0 &&
    (userAskedForSwap || shouldOfferBuddySwap(params.alcoholicLogCount));

  const alternativeSuggestion = shouldSuggestSwap
    ? params.aiSwapSuggestion?.trim() ||
      getSunnySwapSuggestion(primaryCategory, params.alcoholicLogCount + params.text.length)
    : undefined;

  const firstItemName = params.items.map((item) => item.name).join(' + ') || params.text.trim();
  const buddyNote =
    params.aiBuddyNote?.trim() ||
    getSunnyPourNote({
      name: firstItemName,
      units: totalUnits,
      category: primaryCategory,
      isClearDay,
      isZeroProof,
      swapSuggestion: alternativeSuggestion,
    });

  return {
    totalUnits,
    totalVolumeOz,
    isClearDay,
    isZeroProof,
    primaryCategory,
    buddyNote,
    alternativeSuggestion,
  };
}

function normalizeParsedAiDrinks(
  parsed: RawDrinkParseJson | null,
  originalText: string,
): EstimatedDrinkItem[] {
  if (!parsed?.items || parsed.items.length === 0) {
    return reconcileDrinkItems(originalText).map((item) => toEstimatedDrinkItem(item));
  }
  const candidates: RawDrinkCandidateInput[] = parsed.items
    .filter((entry) => entry && typeof entry.name === 'string' && entry.name.trim().length > 0)
    .map((entry) => ({
      name: entry.name,
      quantity: typeof entry.quantity === 'number' && entry.quantity > 0 ? entry.quantity : 1,
      volumeOz: typeof entry.volumeOz === 'number' && entry.volumeOz >= 0 ? entry.volumeOz : undefined,
      abvPct: typeof entry.abvPct === 'number' && entry.abvPct >= 0 ? entry.abvPct : undefined,
      category: entry.category,
      isZeroProof: entry.zeroProof,
      zeroProof: entry.zeroProof,
      isClearDay: entry.isClearDay,
    }));

  if (candidates.length === 0) {
    return reconcileDrinkItems(originalText).map((item) => toEstimatedDrinkItem(item));
  }

  return reconcileDrinkItems(candidates).map((item) => toEstimatedDrinkItem(item, 'exact'));
}

/**
 * Parses natural-language beverage descriptions into deterministic NIAAA Standard Drink Units
 * using Firebase AI Logic (`PREFER_ON_DEVICE`, or `ONLY_ON_DEVICE` under Privacy Vault) and
 * cleanly falling back to the offline 115-beverage database reconciler.
 */
export async function estimateDrinkUnitsWithFallback(
  inputOrText: string | EstimateDrinkInput,
  options?: EstimateDrinkOptions,
): Promise<EstimateDrinkResult> {
  const inputObj: EstimateDrinkInput =
    typeof inputOrText === 'string'
      ? { ...options, text: inputOrText }
      : { ...options, ...inputOrText };

  const rawText = (inputObj.text ?? inputObj.rawText ?? inputObj.description ?? '').trim();
  if (!rawText) {
    throw new Error('Enter what you drank (for example "2 hazy IPAs" or "clear day") to log.');
  }

  const firebaseApp = inputObj.firebaseApp ?? null;
  const secPrivacyLock = Boolean(inputObj.secPrivacyLock);
  const alcoholicLogCount = inputObj.alcoholicLogCount ?? 0;
  const askForSwap = Boolean(inputObj.askForSwap);
  const strictNanoOnly = Boolean(inputObj.strictNanoOnly);

  const startedAt = nowMs();
  const rc = getCoasterRemoteConfigSnapshot(firebaseApp);
  const mode = resolveRequestedMode(
    secPrivacyLock,
    rc.hybridDefaultMode,
    InferenceMode.PREFER_ON_DEVICE,
  );
  const appCheckTelemetry = firebaseApp ? ensureFirebaseAppCheck(firebaseApp) : undefined;

  if (firebaseApp) {
    const ai = getFirebaseAI(firebaseApp);
    const prompt = truncateForNanoBudget(
      [
        SUNNY_SYSTEM_GUIDELINES,
        'Parse this drink log entry into beverages (including multipliers like 2x, double, half bottle, or "clear day" / zero-proof drinks).',
        'Return compact JSON matching the schema. Sunny writes a warm 1-2 sentence buddyNote (if it sounds like an IPA/cocktail with an absurd menu name or oversized glass, light playful tease is great; never judge or lecture).',
        `Entry: "${rawText}"`,
      ].join('\n\n'),
    );

    try {
      const { result, resolvedCloudModel } = await runResilientHybridGenerateContent({
        ai,
        mode,
        primaryCloudModel: rc.coasterCloudModel || rc.cfoCloudModel,
        request: prompt,
        schema: drinkParseSchema,
      });

      const latencyMs = elapsedMs(startedAt);
      const parsed = safeJsonParse<RawDrinkParseJson>(result.response.text());
      const items = normalizeParsedAiDrinks(parsed, rawText);
      const meta = buildSunnyDrinkResponseMeta({
        items,
        text: rawText,
        alcoholicLogCount,
        askForSwap,
        aiBuddyNote: parsed?.buddyNote,
        aiSwapSuggestion: parsed?.alternativeSuggestion,
      });
      const receipt = buildExecutionReceipt({
        rawSource: result.response.inferenceSource,
        latencyMs,
        modeRequested: mode,
        cloudModelConfigured: resolvedCloudModel,
        feature: 'DRINK_PARSE',
        fallbackUsed: false,
      });

      emitTelemetry({
        feature: 'DRINK_PARSE',
        inferenceSource: receipt.inferenceSource,
        modeRequested: mode,
        modelName:
          receipt.inferenceSource === 'ON_DEVICE' ? 'gemini-nano' : resolvedCloudModel,
        latencyMs,
        success: true,
        fallbackUsed: false,
        appCheckStatus: appCheckTelemetry?.status,
        detail: `${items.length} item(s), ${formatUnits(meta.totalUnits)}`,
      });

      return {
        items,
        foods: items.map(reconciledDrinkToFoodDraft),
        totalUnits: meta.totalUnits,
        totalVolumeOz: meta.totalVolumeOz,
        isClearDay: meta.isClearDay,
        isZeroProof: meta.isZeroProof,
        category: meta.primaryCategory,
        buddyNote: meta.buddyNote,
        alternativeSuggestion: meta.alternativeSuggestion,
        cfoAuditNote: meta.buddyNote,
        inferenceSource: receipt.inferenceSource,
        fallbackUsed: false,
        receipt,
      };
    } catch (err) {
      if (mode === InferenceMode.ONLY_ON_DEVICE && strictNanoOnly) {
        emitTelemetry({
          feature: 'DRINK_PARSE',
          inferenceSource: 'ON_DEVICE',
          modeRequested: mode,
          modelName: 'gemini-nano',
          latencyMs: elapsedMs(startedAt),
          success: false,
          fallbackUsed: false,
          appCheckStatus: appCheckTelemetry?.status,
          detail: err instanceof Error ? err.message : 'On-device parse blocked',
        });
        throw new SecPrivacyLockBlockedError(buildSecComplianceAlert());
      }
      // Otherwise drop smoothly into the zero-network deterministic local reconciler below.
    }
  }

  // Deterministic zero-network local fallback
  const items = reconcileDrinkItems(rawText).map((item) => toEstimatedDrinkItem(item));
  const latencyMs = elapsedMs(startedAt);
  const meta = buildSunnyDrinkResponseMeta({
    items,
    text: rawText,
    alcoholicLogCount,
    askForSwap,
  });
  const receipt = buildExecutionReceipt({
    rawSource: InferenceSource.ON_DEVICE,
    latencyMs,
    modeRequested: mode,
    cloudModelConfigured: rc.coasterCloudModel || rc.cfoCloudModel,
    feature: 'DRINK_PARSE',
    fallbackUsed: true,
  });

  emitTelemetry({
    feature: 'DRINK_PARSE',
    inferenceSource: 'LOCAL_FALLBACK',
    modeRequested: mode,
    modelName: 'local-drink-reconciler',
    latencyMs,
    success: true,
    fallbackUsed: true,
    appCheckStatus: appCheckTelemetry?.status,
    detail: `Offline reconcile: ${items.length} item(s), ${formatUnits(meta.totalUnits)}`,
  });

  return {
    items,
    foods: items.map(reconciledDrinkToFoodDraft),
    totalUnits: meta.totalUnits,
    totalVolumeOz: meta.totalVolumeOz,
    isClearDay: meta.isClearDay,
    isZeroProof: meta.isZeroProof,
    category: meta.primaryCategory,
    buddyNote: meta.buddyNote,
    alternativeSuggestion: meta.alternativeSuggestion,
    cfoAuditNote: meta.buddyNote,
    inferenceSource: 'LOCAL_FALLBACK',
    fallbackUsed: true,
    receipt,
  };
}

/** Alias preserving compatibility for callers importing `estimateMealWithFallback`. */
export const estimateMealWithFallback = estimateDrinkUnitsWithFallback;

// ── Legacy-Compatible Ticker Tape Wrapper ─────────────────────────────────────

export interface TickerTapeParseResult {
  foods: ReconciledFoodDraft[];
  workouts: ReconciledWorkoutDraft[];
  cfoAuditNote: string;
  totals: {
    caloriesIn: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    capexBurnKcal: number;
    standardUnits?: number;
  };
  items?: EstimatedDrinkItem[];
  totalUnits?: number;
  isClearDay?: boolean;
  isZeroProof?: boolean;
  alternativeSuggestion?: string;
  receipt: HybridExecutionReceipt;
}

export async function parseTickerTapeHybrid(params: {
  firebaseApp: FirebaseApp;
  rawText?: string;
  shorthandInput?: string;
  secPrivacyLock: boolean;
  userWeightKg?: number;
  alcoholicLogCount?: number;
}): Promise<TickerTapeParseResult> {
  const cleanText = (params.shorthandInput ?? params.rawText ?? '').trim();
  if (!cleanText) {
    throw new Error('Enter what you drank (or "clear day") to log.');
  }

  const parsed = await estimateDrinkUnitsWithFallback({
    firebaseApp: params.firebaseApp,
    text: cleanText,
    secPrivacyLock: params.secPrivacyLock,
    alcoholicLogCount: params.alcoholicLogCount,
    strictNanoOnly: true,
  });

  return {
    foods: parsed.foods,
    workouts: [],
    cfoAuditNote: parsed.buddyNote,
    totals: {
      caloriesIn: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      capexBurnKcal: 0,
      standardUnits: parsed.totalUnits,
    },
    items: parsed.items,
    totalUnits: parsed.totalUnits,
    isClearDay: parsed.isClearDay,
    isZeroProof: parsed.isZeroProof,
    alternativeSuggestion: parsed.alternativeSuggestion,
    receipt: {
      ...parsed.receipt,
      feature: 'TICKER_TAPE',
    },
  };
}

// ── Feature B: Multimodal Drink Menu, Can & Bottle Label Scanner ──────────────

export interface NormalizedInlineImage {
  mimeType: 'image/png' | 'image/jpeg';
  base64Data: string;
  previewDataUri: string;
}

export async function normalizeImageFileForHybrid(
  file: File,
  maxDimension = 1024,
): Promise<NormalizedInlineImage> {
  if (typeof window === 'undefined') {
    throw new Error('Image normalization can only run in the browser.');
  }
  const rawDataUri = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read drink image.'));
    reader.readAsDataURL(file);
  });

  return new Promise<NormalizedInlineImage>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height, 1));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context unavailable for image encoding.'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const targetMime: 'image/png' | 'image/jpeg' =
        file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const outUri =
        targetMime === 'image/png'
          ? canvas.toDataURL('image/png')
          : canvas.toDataURL('image/jpeg', 0.84);
      const base64Data = outUri.split(',')[1] || '';
      resolve({ mimeType: targetMime, base64Data, previewDataUri: outUri });
    };
    img.onerror = () => reject(new Error('Could not decode uploaded drink photo.'));
    img.src = rawDataUri;
  });
}

export function dataUriToInlineImage(dataUri: string): NormalizedInlineImage {
  const match = dataUri.match(/^data:(image\/png|image\/jpeg);base64,(.+)$/i);
  if (match) {
    const mimeType = match[1].toLowerCase() === 'image/png' ? 'image/png' : 'image/jpeg';
    return { mimeType, base64Data: match[2], previewDataUri: dataUri };
  }
  const fallbackBase64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
  return {
    mimeType: 'image/jpeg',
    base64Data: fallbackBase64,
    previewDataUri: dataUri,
  };
}

export interface ExpenseReceiptAuditResult {
  receiptTitle: string;
  foods: ReconciledFoodDraft[];
  items?: EstimatedDrinkItem[];
  totalUnits?: number;
  auditVerdict: 'APPROVED_ASSET' | 'CONDITIONAL_OPEX' | 'FLAGGED_LIABILITY';
  cfoCommentary: string;
  alternativeSuggestion?: string;
  totals: {
    caloriesIn: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    standardUnits?: number;
  };
  receipt: HybridExecutionReceipt;
}

/**
 * Multimodal Bar Menu, Bottle & Can Label Reader (`PREFER_ON_DEVICE`, or `ONLY_ON_DEVICE` under Privacy Vault).
 * Must be invoked directly from a user upload/click interaction.
 */
export async function auditMealPhotoReceiptHybrid(params: {
  firebaseApp: FirebaseApp;
  image: NormalizedInlineImage;
  note?: string;
  secPrivacyLock: boolean;
  alcoholicLogCount?: number;
}): Promise<ExpenseReceiptAuditResult> {
  const { firebaseApp, image, note, secPrivacyLock, alcoholicLogCount = 0 } = params;
  const ai = getFirebaseAI(firebaseApp);
  const rc = getCoasterRemoteConfigSnapshot(firebaseApp);
  const appCheckTelemetry = ensureFirebaseAppCheck(firebaseApp);
  const mode = resolveRequestedMode(
    secPrivacyLock,
    rc.hybridDefaultMode,
    InferenceMode.PREFER_ON_DEVICE,
  );

  const imagePart: Part = {
    type: 'inlineData',
    inlineData: {
      mimeType: image.mimeType,
      data: image.base64Data,
    },
  };

  const textPrompt = truncateForNanoBudget(
    [
      SUNNY_SYSTEM_GUIDELINES,
      'Inspect this bottle label, beer can, cocktail glass, or drink menu photo.',
      'Read any visible ABV %, bottle/can size (oz or ml), and pour count, and estimate NIAAA Standard Drink Units.',
      'Keep buddyNote light, warm, and descriptive (and if a zero-proof option fits, include a friendly note).',
      note?.trim() ? `User Note: "${note.trim()}"` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  const startedAt = nowMs();
  try {
    const { result, resolvedCloudModel } = await runResilientHybridGenerateContent({
      ai,
      mode,
      primaryCloudModel: rc.coasterCloudModel || rc.cfoCloudModel,
      request: [textPrompt, imagePart],
      schema: drinkReceiptSchema,
      multimodal: true,
    });

    const latencyMs = elapsedMs(startedAt);
    const parsed = safeJsonParse<RawDrinkParseJson & { receiptTitle?: string }>(
      result.response.text(),
    );
    const fallbackHint = note?.trim() || 'House Pour';
    const items = normalizeParsedAiDrinks(parsed, fallbackHint);
    const meta = buildSunnyDrinkResponseMeta({
      items,
      text: note?.trim() || items.map((i) => i.name).join(', '),
      alcoholicLogCount,
      askForSwap: false,
      aiBuddyNote: parsed?.buddyNote,
      aiSwapSuggestion: parsed?.alternativeSuggestion,
    });

    const receipt = buildExecutionReceipt({
      rawSource: result.response.inferenceSource,
      latencyMs,
      modeRequested: mode,
      cloudModelConfigured: resolvedCloudModel,
      feature: 'DRINK_RECEIPT',
    });

    emitTelemetry({
      feature: 'DRINK_RECEIPT',
      inferenceSource: receipt.inferenceSource,
      modeRequested: mode,
      modelName:
        receipt.inferenceSource === 'ON_DEVICE' ? 'gemini-nano' : resolvedCloudModel,
      latencyMs,
      success: true,
      fallbackUsed: false,
      appCheckStatus: appCheckTelemetry.status,
      detail: `${items.length} beverage(s), ${formatUnits(meta.totalUnits)}`,
    });

    return {
      receiptTitle: parsed?.receiptTitle || 'Drink Scan',
      foods: items.map(reconciledDrinkToFoodDraft),
      items,
      totalUnits: meta.totalUnits,
      auditVerdict:
        meta.isClearDay || meta.isZeroProof ? 'APPROVED_ASSET' : 'CONDITIONAL_OPEX',
      cfoCommentary: meta.buddyNote,
      alternativeSuggestion: meta.alternativeSuggestion,
      totals: {
        caloriesIn: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        standardUnits: meta.totalUnits,
      },
      receipt,
    };
  } catch (err) {
    if (mode === InferenceMode.ONLY_ON_DEVICE) {
      throw new SecPrivacyLockBlockedError(
        buildSecComplianceAlert(
          'Strict On-Device Drink Scan requires Chrome Gemini Nano with Multimodal Input enabled (`chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`). Zero image bytes left your browser.',
        ),
      );
    }
    throw err;
  }
}

// ── Feature C: Privacy Vault Strict On-Device Audit + Booth-Buddy Chat ────────

export interface LocalPrivacyAuditInput {
  firebaseApp?: FirebaseApp | null;
  logs: FoodLogEntry[];
  anchorDateKey?: string;
  days?: number;
  promptNote?: string;
  strictNanoOnly?: boolean;
}

export interface LocalPrivacyAuditResult {
  headline: string;
  summary: string;
  highlights: string[];
  trendSummary: TrendSummary;
  onDeviceOnly: true;
  inferenceSource: 'ON_DEVICE' | 'LOCAL_FALLBACK';
  fallbackUsed: boolean;
  buddyNote: string;
  receipt: HybridExecutionReceipt;
}

function buildDeterministicPrivacyVaultSummary(
  trend: TrendSummary,
  days: number,
  anchorDateKey?: string,
): {
  headline: string;
  summary: string;
  highlights: string[];
  buddyNote: string;
} {
  const rollingText =
    trend.rollingVsPriorPct === null
      ? 'Baseline window still filling in.'
      : trend.rollingVsPriorPct <= -5
        ? `Last 7 days are ${Math.abs(trend.rollingVsPriorPct)}% lighter than the prior 7 days.`
        : trend.rollingVsPriorPct >= 5
          ? `Last 7 days ran ${trend.rollingVsPriorPct}% higher than the prior 7 days.`
          : 'Your 7-day pace is holding steady right around your prior week.';

  const headline = `${days}D Private Summary: ${formatUnits(trend.thirtyDayTotal)} across ${trend.clearDaysLast30} clear days`;
  const summary = `Over the last 30 days${anchorDateKey ? ` (through ${anchorDateKey})` : ''}, you logged ${formatUnits(trend.thirtyDayTotal)} total (${formatUnits(trend.thirtyDayAvg)}/day average), ${trend.clearDaysLast30} alcohol-free clear days, and ${trend.zeroProofSwapsLast30} zero-proof pours. ${rollingText}`;
  const highlights = [
    `7-day rolling total: ${formatUnits(trend.sevenDayTotal)} (${formatUnits(trend.sevenDayAvg)}/day avg)`,
    `Clear days (last 30d): ${trend.clearDaysLast30} days`,
    `Zero-proof swaps (last 30d): ${trend.zeroProofSwapsLast30} pours`,
    rollingText,
  ];
  const buddyNote =
    trend.clearDaysLast30 >= 8 || trend.zeroProofSwapsLast30 >= 3
      ? 'Private reflection stayed 100% inside your browser. Lots of steady clear days and smart zero-proof pours in the mix.'
      : 'Private reflection stayed 100% inside your browser. Zero bytes left this device.';

  return { headline, summary, highlights, buddyNote };
}

/**
 * Privacy Vault 30-Day Audit (`InferenceMode.ONLY_ON_DEVICE`).
 * Strictly prohibits cloud transmission; uses Chrome Gemini Nano when active and
 * falls back cleanly to in-browser deterministic synthesis when Nano isn't downloaded yet.
 */
export async function runLocalAuditWithFallback(
  input: LocalPrivacyAuditInput,
): Promise<LocalPrivacyAuditResult> {
  const {
    firebaseApp = null,
    logs,
    anchorDateKey,
    days = 30,
    promptNote,
    strictNanoOnly = false,
  } = input;

  const startedAt = nowMs();
  const trendSummary = computeTrendSummary(logs, anchorDateKey);
  const deterministic = buildDeterministicPrivacyVaultSummary(
    trendSummary,
    days,
    anchorDateKey,
  );
  const rc = getCoasterRemoteConfigSnapshot(firebaseApp);
  const appCheckTelemetry = firebaseApp ? ensureFirebaseAppCheck(firebaseApp) : undefined;

  if (firebaseApp) {
    const ai = getFirebaseAI(firebaseApp);
    const prompt = truncateForNanoBudget(
      [
        SUNNY_SYSTEM_GUIDELINES,
        'Summarize these private 30-day NIAAA Standard Drink Unit stats warmly in 2-3 sentences for the user:',
        `- 30-day total: ${formatUnits(trendSummary.thirtyDayTotal)} (${formatUnits(trendSummary.thirtyDayAvg)}/day)`,
        `- 7-day rolling total: ${formatUnits(trendSummary.sevenDayTotal)} (${formatUnits(trendSummary.sevenDayAvg)}/day)`,
        `- Clear days (30d): ${trendSummary.clearDaysLast30}`,
        `- Zero-proof swaps (30d): ${trendSummary.zeroProofSwapsLast30}`,
        promptNote?.trim() ? `User note: ${promptNote.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      5_500,
    );

    try {
      const { result } = await runResilientHybridGenerateContent({
        ai,
        mode: InferenceMode.ONLY_ON_DEVICE,
        primaryCloudModel: rc.coasterCloudModel || rc.cfoCloudModel,
        request: prompt,
      });

      const latencyMs = elapsedMs(startedAt);
      const aiText = result.response.text().trim();
      const receipt = buildExecutionReceipt({
        rawSource: InferenceSource.ON_DEVICE,
        latencyMs,
        modeRequested: InferenceMode.ONLY_ON_DEVICE,
        cloudModelConfigured: 'gemini-nano',
        feature: 'PRIVACY_VAULT',
        fallbackUsed: false,
      });

      emitTelemetry({
        feature: 'PRIVACY_VAULT',
        inferenceSource: 'ON_DEVICE',
        modeRequested: InferenceMode.ONLY_ON_DEVICE,
        modelName: 'gemini-nano',
        latencyMs,
        success: true,
        fallbackUsed: false,
        appCheckStatus: appCheckTelemetry?.status,
        detail: `Private 30D audit (${formatUnits(trendSummary.thirtyDayTotal)}, ${trendSummary.clearDaysLast30} clear days)`,
      });

      return {
        headline: deterministic.headline,
        summary: aiText || deterministic.summary,
        highlights: deterministic.highlights,
        trendSummary,
        onDeviceOnly: true,
        inferenceSource: 'ON_DEVICE',
        fallbackUsed: false,
        buddyNote: aiText || deterministic.buddyNote,
        receipt,
      };
    } catch (err) {
      if (strictNanoOnly) {
        throw new SecPrivacyLockBlockedError(buildSecComplianceAlert());
      }
      // Safe deterministic in-browser fallback below — zero bytes ever leave the device.
    }
  } else if (strictNanoOnly) {
    throw new SecPrivacyLockBlockedError(buildSecComplianceAlert());
  }

  const latencyMs = elapsedMs(startedAt);
  const receipt = buildExecutionReceipt({
    rawSource: InferenceSource.ON_DEVICE,
    latencyMs,
    modeRequested: InferenceMode.ONLY_ON_DEVICE,
    cloudModelConfigured: 'gemini-nano',
    feature: 'PRIVACY_VAULT',
    fallbackUsed: true,
  });

  emitTelemetry({
    feature: 'PRIVACY_VAULT',
    inferenceSource: 'LOCAL_FALLBACK',
    modeRequested: InferenceMode.ONLY_ON_DEVICE,
    modelName: 'local-privacy-vault',
    latencyMs,
    success: true,
    fallbackUsed: true,
    appCheckStatus: appCheckTelemetry?.status,
    detail: `Local-only Privacy Vault audit (${formatUnits(trendSummary.thirtyDayTotal)})`,
  });

  return {
    headline: deterministic.headline,
    summary: deterministic.summary,
    highlights: deterministic.highlights,
    trendSummary,
    onDeviceOnly: true,
    inferenceSource: 'LOCAL_FALLBACK',
    fallbackUsed: true,
    buddyNote: deterministic.buddyNote,
    receipt,
  };
}

export interface BiometricAuditResult {
  replyText: string;
  receipt: HybridExecutionReceipt;
}

export type BuddyHealthContext =
  | (Partial<HealthData> & {
      drinkLogs?: FoodLogEntry[];
      todayUnits?: number;
      clearDaysLast30?: number;
    })
  | null;

export type BuddyPreferencesContext =
  | (Partial<UserPreferences> & {
      zeroProofFavorites?: string[];
    })
  | null;

/**
 * Single-turn Sunny booth-buddy conversation (`PREFER_ON_DEVICE`, or `ONLY_ON_DEVICE` under Privacy Vault).
 */
export async function runHybridCoachTurn(params: {
  firebaseApp: FirebaseApp;
  userMessage: string;
  secPrivacyLock: boolean;
  healthData?: BuddyHealthContext;
  preferences?: BuddyPreferencesContext;
  attachedImages?: NormalizedInlineImage[];
}): Promise<BiometricAuditResult> {
  const {
    firebaseApp,
    userMessage,
    secPrivacyLock,
    healthData,
    preferences,
    attachedImages = [],
  } = params;

  const ai = getFirebaseAI(firebaseApp);
  const rc = getCoasterRemoteConfigSnapshot(firebaseApp);
  const appCheckTelemetry = ensureFirebaseAppCheck(firebaseApp);
  const mode = secPrivacyLock
    ? InferenceMode.ONLY_ON_DEVICE
    : resolveRequestedMode(false, rc.hybridDefaultMode, InferenceMode.PREFER_ON_DEVICE);

  const logs = healthData?.drinkLogs ?? [];
  const trend = computeTrendSummary(logs);
  const favs =
    preferences?.zeroProofFavorites?.join(', ') ||
    'Sparkling Yuzu, Phony Negroni, Ginger Hibiscus';
  const contextNote = [
    SUNNY_SYSTEM_GUIDELINES,
    `User context (NIAAA Standard Drink Units, 1.0u = 14g pure ethanol):`,
    `- Today: ${formatUnits(healthData?.todayUnits ?? trend.todayUnits)}`,
    `- 7-day rolling avg: ${formatUnits(trend.sevenDayAvg)}/day`,
    `- 30-day clear days: ${healthData?.clearDaysLast30 ?? trend.clearDaysLast30}`,
    `- Favorite zero-proof styles: ${favs}`,
    `Answer the user concisely and warmly as Sunny.`,
  ].join('\n');

  const promptBody = truncateForNanoBudget(
    `${contextNote}\n\nUser Question: ${userMessage}`,
    secPrivacyLock ? 5_800 : 8_000,
  );

  const parts: Array<string | Part> = [promptBody];
  for (const img of attachedImages.slice(0, 2)) {
    parts.push({
      type: 'inlineData',
      inlineData: {
        mimeType: img.mimeType,
        data: img.base64Data,
      },
    });
  }

  const startedAt = nowMs();
  try {
    const { result, resolvedCloudModel } = await runResilientHybridGenerateContent({
      ai,
      mode,
      primaryCloudModel: rc.coasterCloudModel || rc.cfoCloudModel,
      request: attachedImages.length > 0 ? parts : promptBody,
      multimodal: attachedImages.length > 0,
    });

    const latencyMs = elapsedMs(startedAt);
    const replyText = result.response.text().trim();
    const receipt = buildExecutionReceipt({
      rawSource: result.response.inferenceSource,
      latencyMs,
      modeRequested: mode,
      cloudModelConfigured: resolvedCloudModel,
      feature: 'BUDDY_CHAT',
    });

    emitTelemetry({
      feature: 'BUDDY_CHAT',
      inferenceSource: receipt.inferenceSource,
      modeRequested: mode,
      modelName:
        receipt.inferenceSource === 'ON_DEVICE' ? 'gemini-nano' : resolvedCloudModel,
      latencyMs,
      success: true,
      fallbackUsed: false,
      appCheckStatus: appCheckTelemetry.status,
    });

    return { replyText, receipt };
  } catch (err) {
    if (mode === InferenceMode.ONLY_ON_DEVICE) {
      throw new SecPrivacyLockBlockedError(buildSecComplianceAlert());
    }
    throw err;
  }
}

// ── Feature D: 30D Trend Reflection & Tailored Zero-Proof Swaps (`PREFER_IN_CLOUD`) ───

export interface TrendMixItem {
  category: DrinkCategory;
  units: number;
  pct: number;
  label: string;
}

export interface TrendReflectionInput {
  firebaseApp?: FirebaseApp | null;
  logs: FoodLogEntry[];
  anchorDateKey?: string;
  secPrivacyLock?: boolean;
  strictNanoOnly?: boolean;
}

export interface TrendReflectionResult {
  headline: string;
  rhythmInsight: string;
  clearDayHighlight: string;
  mixBreakdown: TrendMixItem[];
  swapIdeas: string[];
  nextWeekNudge: string;
  trendSummary: TrendSummary;
  inferenceSource: NormalizedInferenceSource | 'LOCAL_FALLBACK';
  fallbackUsed: boolean;
  receipt: HybridExecutionReceipt;
}

function computeDrinkMixBreakdown(logs: FoodLogEntry[], days = 30): TrendMixItem[] {
  const byCategory = new Map<DrinkCategory, number>();
  let totalAlcoholicUnits = 0;

  // Inspect recent entries (if dates are present, keep all passed logs cleanly grouped)
  const sample = logs.slice(-Math.max(days * 6, 180));
  for (const entry of sample) {
    if (isClearDayEntry(entry)) continue;
    const units = getEntryUnits(entry);
    const cat: DrinkCategory =
      entry.drinkCategory ??
      (isZeroProofEntry(entry)
        ? 'zero-proof'
        : reconcileDrinkDescription(entry.name || '')?.category ?? 'beer');

    if (cat === 'zero-proof' || units === 0) {
      byCategory.set('zero-proof', (byCategory.get('zero-proof') ?? 0) + 1);
      continue;
    }

    totalAlcoholicUnits += units;
    byCategory.set(cat, round1((byCategory.get(cat) ?? 0) + units));
  }

  const mix: TrendMixItem[] = [];
  for (const [category, units] of byCategory.entries()) {
    const pct =
      category === 'zero-proof' || totalAlcoholicUnits <= 0
        ? 0
        : Math.round((units / totalAlcoholicUnits) * 100);
    mix.push({
      category,
      units: round1(units),
      pct,
      label: categoryDisplayLabel(category),
    });
  }

  mix.sort((a, b) => b.units - a.units);
  if (mix.length === 0) {
    mix.push({
      category: 'clear-day',
      units: 0,
      pct: 100,
      label: categoryDisplayLabel('clear-day'),
    });
  }
  return mix;
}

function buildTailoredSwapIdeas(mixBreakdown: TrendMixItem[]): string[] {
  const alcoholicCats = mixBreakdown
    .filter((m) => m.category !== 'zero-proof' && m.category !== 'clear-day' && m.units > 0)
    .map((m) => m.category);

  const suggestions: string[] = [];
  for (const cat of alcoholicCats) {
    suggestions.push(getSunnySwapSuggestion(cat, suggestions.length));
    if (suggestions.length >= 3) break;
  }

  const backupPool = [
    getSunnySwapSuggestion('cocktail', 1),
    getSunnySwapSuggestion('beer', 0),
    getSunnySwapSuggestion('seltzer', 1),
  ];
  for (const idea of backupPool) {
    if (suggestions.length >= 3) break;
    if (!suggestions.includes(idea)) suggestions.push(idea);
  }
  return suggestions.slice(0, 3);
}

function buildDeterministicTrendReflection(
  logs: FoodLogEntry[],
  anchorDateKey?: string,
): Omit<TrendReflectionResult, 'inferenceSource' | 'fallbackUsed' | 'receipt'> {
  const trendSummary = computeTrendSummary(logs, anchorDateKey);
  const dow = computeDayOfWeekPattern(logs, 30, anchorDateKey);
  const mixBreakdown = computeDrinkMixBreakdown(logs, 30);

  const busiestDay = [...dow].sort((a, b) => b.avgUnits - a.avgUnits)[0];
  const quietestDay = [...dow].sort((a, b) => a.avgUnits - b.avgUnits)[0];

  const rollingDeltaText =
    trendSummary.rollingVsPriorPct === null
      ? 'Your rolling baseline is taking shape nicely.'
      : trendSummary.rollingVsPriorPct <= -5
        ? `Rolling 7-day units eased ${Math.abs(trendSummary.rollingVsPriorPct)}% compared to the prior week.`
        : trendSummary.rollingVsPriorPct >= 5
          ? `Rolling 7-day units stepped up ${trendSummary.rollingVsPriorPct}% versus the prior week.`
          : 'Your 7-day pace is hovering right near your prior week.';

  const rhythmInsight =
    busiestDay && busiestDay.avgUnits > 0
      ? `${busiestDay.dayLabel} tends to be your liveliest pour day (~${formatUnits(busiestDay.avgUnits)} avg), while ${quietestDay?.dayLabel ?? 'midweek'} stays lightest (~${formatUnits(quietestDay?.avgUnits ?? 0)} avg). ${rollingDeltaText}`
      : `You are averaging ${formatUnits(trendSummary.sevenDayAvg)}/day this week. ${rollingDeltaText}`;

  const clearDayHighlight =
    trendSummary.clearDaysLast30 > 0 || trendSummary.zeroProofSwapsLast30 > 0
      ? `You banked ${trendSummary.clearDaysLast30} clear day${trendSummary.clearDaysLast30 === 1 ? '' : 's'} and ${trendSummary.zeroProofSwapsLast30} zero-proof pour${trendSummary.zeroProofSwapsLast30 === 1 ? '' : 's'} over the last 30 days.`
      : 'Logging your first clear day or zero-proof pour builds a nice rhythm on your 30-day calendar.';

  const headline =
    trendSummary.thirtyDayTotal === 0
      ? `Clear Stretch: ${trendSummary.clearDaysLast30} alcohol-free days logged`
      : `30D Mix: ${formatUnits(trendSummary.thirtyDayTotal)} total (${formatUnits(trendSummary.sevenDayAvg)}/day 7D avg)`;

  const topCat = mixBreakdown.find(
    (m) => m.category !== 'zero-proof' && m.category !== 'clear-day' && m.units > 0,
  );
  const nextWeekNudge = topCat
    ? `Next week, try tucking one crisp zero-proof pour between ${topCat.label.toLowerCase()} rounds on ${busiestDay?.dayLabel ?? 'Friday'} — zero fuss, same social groove.`
    : 'Keep enjoying the sparkling pours and clear nights at whatever cadence feels good to you.';

  return {
    headline,
    rhythmInsight,
    clearDayHighlight,
    mixBreakdown,
    swapIdeas: buildTailoredSwapIdeas(mixBreakdown),
    nextWeekNudge,
    trendSummary,
  };
}

interface RawTrendReflectionJson {
  headline?: string;
  rhythmInsight?: string;
  clearDayHighlight?: string;
  mixBreakdown?: TrendMixItem[];
  swapIdeas?: string[];
  nextWeekNudge?: string;
}

/**
 * Intentional cloud synthesis (`InferenceMode.PREFER_IN_CLOUD`, or `ONLY_ON_DEVICE` under Privacy Vault)
 * producing Sunny's structured 30-day rhythm reflection and concrete drink-tailored swap ideas.
 */
export async function runTrendReflectionWithFallback(
  input: TrendReflectionInput,
): Promise<TrendReflectionResult> {
  const {
    firebaseApp = null,
    logs,
    anchorDateKey,
    secPrivacyLock = false,
    strictNanoOnly = false,
  } = input;

  const startedAt = nowMs();
  const base = buildDeterministicTrendReflection(logs, anchorDateKey);
  const rc = getCoasterRemoteConfigSnapshot(firebaseApp);
  const appCheckTelemetry = firebaseApp ? ensureFirebaseAppCheck(firebaseApp) : undefined;
  const mode = secPrivacyLock ? InferenceMode.ONLY_ON_DEVICE : InferenceMode.PREFER_IN_CLOUD;

  if (firebaseApp) {
    const ai = getFirebaseAI(firebaseApp);
    const mixText = base.mixBreakdown
      .map((m) => `${m.label}: ${formatUnits(m.units)} (${m.pct}%)`)
      .join('; ');

    const prompt = truncateForNanoBudget(
      [
        SUNNY_SYSTEM_GUIDELINES,
        'Generate a warm 30-day drink rhythm reflection as JSON with:',
        'headline, rhythmInsight, clearDayHighlight, mixBreakdown, swapIdeas (2-3 concrete zero-proof or lower-ABV drinks matched to their pours), nextWeekNudge.',
        `Stats:`,
        `- 7D total/avg: ${formatUnits(base.trendSummary.sevenDayTotal)} / ${formatUnits(base.trendSummary.sevenDayAvg)} per day`,
        `- 30D total/avg: ${formatUnits(base.trendSummary.thirtyDayTotal)} / ${formatUnits(base.trendSummary.thirtyDayAvg)} per day`,
        `- 90D total: ${formatUnits(base.trendSummary.ninetyDayTotal)}`,
        `- Clear days (30D): ${base.trendSummary.clearDaysLast30}`,
        `- Zero-proof swaps (30D): ${base.trendSummary.zeroProofSwapsLast30}`,
        `- Category mix: ${mixText}`,
        `- Pattern note: ${base.rhythmInsight}`,
      ].join('\n'),
      mode === InferenceMode.ONLY_ON_DEVICE ? 6_500 : 18_000,
    );

    try {
      const { result, resolvedCloudModel } = await runResilientHybridGenerateContent({
        ai,
        mode,
        primaryCloudModel: rc.coasterCloudModel || rc.cfoCloudModel,
        request: prompt,
        schema: trendReflectionSchema,
      });

      const latencyMs = elapsedMs(startedAt);
      const parsed = safeJsonParse<RawTrendReflectionJson>(result.response.text());
      const receipt = buildExecutionReceipt({
        rawSource: result.response.inferenceSource,
        latencyMs,
        modeRequested: mode,
        cloudModelConfigured: resolvedCloudModel,
        feature: 'TREND_REFLECTION',
      });

      emitTelemetry({
        feature: 'TREND_REFLECTION',
        inferenceSource: receipt.inferenceSource,
        modeRequested: mode,
        modelName:
          receipt.inferenceSource === 'ON_DEVICE' ? 'gemini-nano' : resolvedCloudModel,
        latencyMs,
        success: true,
        fallbackUsed: false,
        appCheckStatus: appCheckTelemetry?.status,
        detail: `30D Trend Reflection (${formatUnits(base.trendSummary.thirtyDayTotal)})`,
      });

      return {
        headline: parsed?.headline?.trim() || base.headline,
        rhythmInsight: parsed?.rhythmInsight?.trim() || base.rhythmInsight,
        clearDayHighlight: parsed?.clearDayHighlight?.trim() || base.clearDayHighlight,
        mixBreakdown:
          parsed?.mixBreakdown && parsed.mixBreakdown.length > 0
            ? parsed.mixBreakdown
            : base.mixBreakdown,
        swapIdeas:
          parsed?.swapIdeas && parsed.swapIdeas.length > 0
            ? parsed.swapIdeas.slice(0, 3)
            : base.swapIdeas,
        nextWeekNudge: parsed?.nextWeekNudge?.trim() || base.nextWeekNudge,
        trendSummary: base.trendSummary,
        inferenceSource: receipt.inferenceSource,
        fallbackUsed: false,
        receipt,
      };
    } catch (err) {
      if (mode === InferenceMode.ONLY_ON_DEVICE && strictNanoOnly) {
        throw new SecPrivacyLockBlockedError(buildSecComplianceAlert());
      }
      // Smooth local fallback below if offline/unavailable.
    }
  } else if (mode === InferenceMode.ONLY_ON_DEVICE && strictNanoOnly) {
    throw new SecPrivacyLockBlockedError(buildSecComplianceAlert());
  }

  const latencyMs = elapsedMs(startedAt);
  const receipt = buildExecutionReceipt({
    rawSource: InferenceSource.ON_DEVICE,
    latencyMs,
    modeRequested: mode,
    cloudModelConfigured: rc.coasterCloudModel || rc.cfoCloudModel,
    feature: 'TREND_REFLECTION',
    fallbackUsed: true,
  });

  emitTelemetry({
    feature: 'TREND_REFLECTION',
    inferenceSource: 'LOCAL_FALLBACK',
    modeRequested: mode,
    modelName: 'local-trend-reflection',
    latencyMs,
    success: true,
    fallbackUsed: true,
    appCheckStatus: appCheckTelemetry?.status,
    detail: `Local 30D reflection (${formatUnits(base.trendSummary.thirtyDayTotal)})`,
  });

  return {
    ...base,
    inferenceSource: 'LOCAL_FALLBACK',
    fallbackUsed: true,
    receipt,
  };
}

/** Alias preserving compatibility for callers importing `runQuarterlyEarningsWithFallback`. */
export const runQuarterlyEarningsWithFallback = runTrendReflectionWithFallback;

// ── Legacy-Compatible 30D Reflection Modal Wrapper ────────────────────────────

export interface QuarterlyEarningsCallResult {
  headline: string;
  marketRating: 'STRONG_BUY' | 'OUTPERFORM' | 'HOLD' | 'UNDERPERFORM' | 'MARGIN_CALL';
  projected30dEquityDelta: number;
  metabolicBreakEvenKcal: number;
  executiveSummary: string;
  capitalDirectives: string[];
  liabilityRisks: string[];
  rhythmInsight?: string;
  clearDayHighlight?: string;
  mixBreakdown?: TrendMixItem[];
  swapIdeas?: string[];
  nextWeekNudge?: string;
  trendSummary?: TrendSummary;
  receipt: HybridExecutionReceipt;
}

export async function runQuarterlyEarningsCallHybrid(params: {
  firebaseApp: FirebaseApp;
  recentLogs?: Array<{
    date: string;
    totalUnits?: number;
    clearDay?: boolean;
    zeroProofCount?: number;
    foods?: FoodLogEntry[];
    caloriesIn?: number;
    proteinG?: number;
    caloriesOut?: number;
    vfScoreDelta?: number;
  }>;
  recentFoodLogs?: FoodLogEntry[];
  recentExerciseLogs?: ExerciseLogEntry[];
  healthData?: BuddyHealthContext;
  preferences?: BuddyPreferencesContext;
  secPrivacyLock: boolean;
}): Promise<QuarterlyEarningsCallResult> {
  const flatLogs: FoodLogEntry[] = [
    ...(params.healthData?.drinkLogs ?? []),
    ...(params.recentFoodLogs ?? []),
  ];
  for (const day of params.recentLogs ?? []) {
    if (Array.isArray(day.foods) && day.foods.length > 0) {
      flatLogs.push(...day.foods);
    } else if (day.clearDay) {
      flatLogs.push({
        id: `day_${day.date}`,
        name: 'Clear Day',
        portionG: 0,
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        fiberG: 0,
        standardUnits: 0,
        isClearDay: true,
        drinkCategory: 'clear-day',
        source: 'preset',
        meal: inferMealSlotByLocalHour(),
        timestamp: new Date(`${day.date}T12:00:00.000Z`) as unknown as FoodLogEntry['timestamp'],
        date: day.date,
      });
    } else if (typeof day.totalUnits === 'number' && day.totalUnits > 0) {
      flatLogs.push({
        id: `day_${day.date}`,
        name: 'Logged Pour',
        portionG: Math.round(day.totalUnits * 150),
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        fiberG: 0,
        standardUnits: day.totalUnits,
        drinkCategory: 'beer',
        source: 'preset',
        meal: inferMealSlotByLocalHour(),
        timestamp: new Date(`${day.date}T19:00:00.000Z`) as unknown as FoodLogEntry['timestamp'],
        date: day.date,
      });
    }
  }

  const reflection = await runTrendReflectionWithFallback({
    firebaseApp: params.firebaseApp,
    logs: flatLogs,
    secPrivacyLock: params.secPrivacyLock,
    strictNanoOnly: params.secPrivacyLock,
  });

  const weeklyDelta = reflection.trendSummary.rollingVsPriorPct ?? 0;
  return {
    headline: reflection.headline,
    marketRating:
      reflection.trendSummary.clearDaysLast30 >= 10
        ? 'STRONG_BUY'
        : weeklyDelta <= 0
          ? 'OUTPERFORM'
          : 'HOLD',
    projected30dEquityDelta: reflection.trendSummary.clearDaysLast30,
    metabolicBreakEvenKcal: Math.round(reflection.trendSummary.sevenDayAvg * 10) / 10,
    executiveSummary: `${reflection.rhythmInsight} ${reflection.clearDayHighlight}`,
    capitalDirectives: reflection.swapIdeas,
    liabilityRisks: [reflection.nextWeekNudge],
    rhythmInsight: reflection.rhythmInsight,
    clearDayHighlight: reflection.clearDayHighlight,
    mixBreakdown: reflection.mixBreakdown,
    swapIdeas: reflection.swapIdeas,
    nextWeekNudge: reflection.nextWeekNudge,
    trendSummary: reflection.trendSummary,
    receipt: {
      ...reflection.receipt,
      feature: 'EARNINGS_CALL',
    },
  };
}

// Re-export unit/reconciler helpers useful for consumers importing from hybrid-ai
export {
  calculateStandardUnits,
  DRINK_CATEGORY_DEFAULTS,
  type DrinkCategory,
  type ExerciseLogEntry,
  type ReconciledDrink,
};
