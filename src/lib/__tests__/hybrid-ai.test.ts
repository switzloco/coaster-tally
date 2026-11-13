import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseApp } from 'firebase/app';

const { generateContentMock, getGenerativeModelMock } = vi.hoisted(() => {
  const genMock = vi.fn();
  const getModelMock = vi.fn(() => ({
    generateContent: genMock,
    initializeDeviceModel: vi.fn(),
  }));
  return {
    generateContentMock: genMock,
    getGenerativeModelMock: getModelMock,
  };
});

vi.mock('firebase/ai', () => ({
  getGenerativeModel: getGenerativeModelMock,
  InferenceMode: {
    PREFER_ON_DEVICE: 'prefer_on_device',
    ONLY_ON_DEVICE: 'only_on_device',
    PREFER_IN_CLOUD: 'prefer_in_cloud',
    ONLY_IN_CLOUD: 'only_in_cloud',
  },
  InferenceSource: {
    ON_DEVICE: 'on_device',
    IN_CLOUD: 'in_cloud',
  },
  Schema: {
    object: (v: unknown) => v,
    array: (v: unknown) => v,
    string: () => ({ type: 'string' }),
    number: () => ({ type: 'number' }),
    boolean: () => ({ type: 'boolean' }),
    enumString: (v: unknown) => v,
  },
}));

vi.mock('@/firebase/ai', () => ({
  getFirebaseAI: vi.fn((app: FirebaseApp) => ({ app, backend: 'google_ai' })),
  getFirebaseAgentPlatformAI: vi.fn((app: FirebaseApp) => ({ app, backend: 'agent_platform' })),
}));

vi.mock('@/firebase/app-check', () => ({
  ensureFirebaseAppCheck: vi.fn(() => ({ status: 'standby' })),
}));

import {
  SecPrivacyLockBlockedError,
  auditMealPhotoReceiptHybrid,
  clearTelemetry,
  estimateDrinkUnitsWithFallback,
  estimateMealWithFallback,
  formatExecutionBadge,
  getHybridCapabilities,
  initializeHybridAI,
  normalizeInferenceSource,
  runLocalAuditWithFallback,
  runQuarterlyEarningsWithFallback,
  runTrendReflectionWithFallback,
  subscribeTelemetry,
  type TelemetryEvent,
} from '@/lib/hybrid-ai';
import { sanitizeCloudModelName } from '@/firebase/remote-config';
import { buildDrinkLogEntry, type DrinkCategory } from '@/lib/drink-units';
import type { FoodLogEntry } from '@/lib/food-exercise-types';
import { reconcileDrinkDescription } from '@/lib/usda-local-reconciler';

const dummyApp = { name: 'coaster-test-app', options: {} } as unknown as FirebaseApp;

const FORBIDDEN_PERSONA_TERMS = [
  /chief fitness officer/i,
  /\bthe cfo\b/i,
  /visceral fat/i,
  /\bvf score\b/i,
  /\blush\b/i,
];

function assertSunnyClean(text: string) {
  for (const rx of FORBIDDEN_PERSONA_TERMS) {
    expect(text).not.toMatch(rx);
  }
}

function makeHybridLog(params: {
  name: string;
  volumeOz: number;
  abvPct: number;
  standardUnits: number;
  category: DrinkCategory;
  isZeroProof?: boolean;
  isClearDay?: boolean;
  date: string;
}): FoodLogEntry {
  return {
    ...buildDrinkLogEntry(params),
    id: `${params.date}_${params.name}`,
    timestamp: new Date(`${params.date}T19:00:00.000Z`) as unknown as FoodLogEntry['timestamp'],
  };
}

describe('Coaster Hybrid AI & #BuildHybridAI 2026 stack', () => {
  beforeEach(() => {
    clearTelemetry();
    vi.clearAllMocks();
  });

  it('sanitizes Remote Config cloud models to gemini-3.8-flash and blocks retired 2.0/1.x models', () => {
    expect(sanitizeCloudModelName(undefined)).toBe('gemini-3.8-flash');
    expect(sanitizeCloudModelName('')).toBe('gemini-3.8-flash');
    expect(sanitizeCloudModelName('gemini-3.8-flash')).toBe('gemini-3.8-flash');
    expect(sanitizeCloudModelName('gemini-2.0-flash')).toBe('gemini-3.8-flash');
    expect(sanitizeCloudModelName('gemini-1.5-pro')).toBe('gemini-3.8-flash');
  });

  it('normalizes inference sources and formats execution receipts cleanly', () => {
    expect(normalizeInferenceSource('on_device')).toBe('ON_DEVICE');
    expect(normalizeInferenceSource('in_cloud')).toBe('IN_CLOUD');
    expect(formatExecutionBadge('ON_DEVICE', 42)).toBe('⚡ On-Device Nano (42ms)');
    expect(formatExecutionBadge('IN_CLOUD', 310)).toBe('☁️ Cloud Gemini (310ms)');
  });

  it('initializes passively without ever calling getGenerativeModel and emits telemetry', async () => {
    const events: TelemetryEvent[] = [];
    const unsubscribe = subscribeTelemetry((ev) => events.push(ev));

    const caps = await initializeHybridAI(dummyApp);
    expect(getGenerativeModelMock).not.toHaveBeenCalled();
    expect(caps.cloudModel).toBe('gemini-3.8-flash');
    expect(caps.privacyVaultReady).toBe(true);
    expect(events.some((e) => e.feature === 'CAPABILITIES')).toBe(true);
    expect(events.some((e) => e.feature === 'INIT')).toBe(true);

    const capsAgain = await getHybridCapabilities(null);
    expect(getGenerativeModelMock).not.toHaveBeenCalled();
    expect(capsAgain.cloudAvailable).toBe(false);

    unsubscribe();
  });

  it('parses drinks offline via local fallback and respects Sunny booth-buddy persona & 1-in-3 swaps', async () => {
    expect(estimateMealWithFallback).toBe(estimateDrinkUnitsWithFallback);

    const res = await estimateDrinkUnitsWithFallback('2 hazy IPAs', {
      alcoholicLogCount: 3, // 3 % 3 === 0 -> triggers 1-in-3 swap suggestion
    });

    expect(res.fallbackUsed).toBe(true);
    expect(res.inferenceSource).toBe('LOCAL_FALLBACK');
    expect(res.totalUnits).toBeGreaterThanOrEqual(3.4);
    expect(res.isClearDay).toBe(false);
    expect(res.isZeroProof).toBe(false);
    expect(res.alternativeSuggestion).toBeTruthy();
    assertSunnyClean(res.buddyNote);
    assertSunnyClean(res.alternativeSuggestion || '');

    // Clear day never triggers an alcohol swap suggestion
    const clear = await estimateDrinkUnitsWithFallback('clear day', { alcoholicLogCount: 3 });
    expect(clear.isClearDay).toBe(true);
    expect(clear.totalUnits).toBe(0);
    expect(clear.alternativeSuggestion).toBeUndefined();
    assertSunnyClean(clear.buddyNote);

    // Zero-proof pours stay 0.0u
    const zp = await estimateDrinkUnitsWithFallback('Phony Negroni', { alcoholicLogCount: 3 });
    expect(zp.isZeroProof).toBe(true);
    expect(zp.totalUnits).toBe(0);
    expect(zp.alternativeSuggestion).toBeUndefined();
  });

  it('routes drink parsing through Firebase AI Logic PREFER_ON_DEVICE and validates units deterministically', async () => {
    generateContentMock.mockResolvedValueOnce({
      response: {
        inferenceSource: 'on_device',
        text: () =>
          JSON.stringify({
            items: [
              {
                name: 'Triple-Dry-Hopped Existential Haze IPA',
                quantity: 1,
                volumeOz: 16,
                abvPct: 7.0,
                category: 'beer',
              },
            ],
            buddyNote: 'Quite a poem on that IPA label. Logged cleanly as 1.9u.',
          }),
      },
    });

    const res = await estimateDrinkUnitsWithFallback({
      firebaseApp: dummyApp,
      text: 'Triple-Dry-Hopped Existential Haze IPA pint',
      secPrivacyLock: false,
    });

    expect(getGenerativeModelMock).toHaveBeenCalledTimes(1);
    expect(res.fallbackUsed).toBe(false);
    expect(res.inferenceSource).toBe('ON_DEVICE');
    expect(res.totalUnits).toBe(1.9);
    expect(res.receipt.inferenceSource).toBe('ON_DEVICE');
    assertSunnyClean(res.buddyNote);
  });

  it('runs Privacy Vault local audit strictly ONLY_ON_DEVICE with deterministic fallback', async () => {
    const logs = [
      makeHybridLog({
        name: 'Sauvignon Blanc',
        volumeOz: 5,
        abvPct: 12.5,
        standardUnits: 1.0,
        category: 'wine',
        date: '2026-11-12',
      }),
      makeHybridLog({
        name: 'Clear Day',
        volumeOz: 0,
        abvPct: 0,
        standardUnits: 0,
        category: 'clear-day',
        isClearDay: true,
        date: '2026-11-13',
      }),
    ];

    const localAudit = await runLocalAuditWithFallback({
      logs,
      anchorDateKey: '2026-11-13',
    });

    expect(localAudit.onDeviceOnly).toBe(true);
    expect(localAudit.fallbackUsed).toBe(true);
    expect(localAudit.trendSummary.thirtyDayTotal).toBe(1.0);
    expect(localAudit.trendSummary.clearDaysLast30).toBe(1);
    assertSunnyClean(localAudit.summary);
    assertSunnyClean(localAudit.buddyNote);
  });

  it('generates 30D Trend Reflection (PREFER_IN_CLOUD) with mixBreakdown and tailored swapIdeas', async () => {
    expect(runQuarterlyEarningsWithFallback).toBe(runTrendReflectionWithFallback);

    const logs = [
      makeHybridLog({
        name: 'Hazy IPA',
        volumeOz: 16,
        abvPct: 7,
        standardUnits: 1.9,
        category: 'beer',
        date: '2026-11-11',
      }),
      makeHybridLog({
        name: 'Negroni',
        volumeOz: 3,
        abvPct: 24,
        standardUnits: 1.2,
        category: 'cocktail',
        date: '2026-11-12',
      }),
      makeHybridLog({
        name: 'Sparkling Yuzu',
        volumeOz: 12,
        abvPct: 0,
        standardUnits: 0,
        category: 'zero-proof',
        isZeroProof: true,
        date: '2026-11-13',
      }),
    ];

    generateContentMock.mockResolvedValueOnce({
      response: {
        inferenceSource: 'in_cloud',
        text: () =>
          JSON.stringify({
            headline: 'Steady Week: Beer & Cocktail Mix with Smart Swaps',
            rhythmInsight: 'Hoppy pints and bitter cocktails are your go-to pours this stretch.',
            clearDayHighlight: 'Sparkling Yuzu kept Nov 13 crisp and zero-proof.',
            mixBreakdown: [
              { category: 'beer', units: 1.9, pct: 61, label: 'Beer & Cider' },
              { category: 'cocktail', units: 1.2, pct: 39, label: 'Cocktails' },
            ],
            swapIdeas: [
              'Athletic Run Wild Non-Alcoholic IPA for a crisp hoppy pint',
              'St. Agrestis Phony Negroni over a big clear rock',
            ],
            nextWeekNudge: 'Try sliding one Phony Negroni into Friday evening.',
          }),
      },
    });

    const reflection = await runTrendReflectionWithFallback({
      firebaseApp: dummyApp,
      logs,
      anchorDateKey: '2026-11-13',
    });

    expect(reflection.inferenceSource).toBe('IN_CLOUD');
    expect(reflection.fallbackUsed).toBe(false);
    expect(reflection.swapIdeas.length).toBeGreaterThanOrEqual(2);
    expect(reflection.mixBreakdown.length).toBeGreaterThanOrEqual(1);
    expect(reflection.trendSummary.zeroProofSwapsLast30).toBe(1);
    assertSunnyClean(reflection.headline);
    assertSunnyClean(reflection.rhythmInsight);
    assertSunnyClean(reflection.nextWeekNudge);
  });

  it('throws SecPrivacyLockBlockedError when Privacy Vault blocks cloud multimodal scan offline', async () => {
    generateContentMock.mockRejectedValueOnce(new Error('Nano unavailable'));

    await expect(
      auditMealPhotoReceiptHybrid({
        firebaseApp: dummyApp,
        image: {
          mimeType: 'image/jpeg',
          base64Data: 'abc',
          previewDataUri: 'data:image/jpeg;base64,abc',
        },
        secPrivacyLock: true,
      }),
    ).rejects.toThrow(SecPrivacyLockBlockedError);
  });

  it('bridges drink reconciliation via usda-local-reconciler exports', () => {
    const matched = reconcileDrinkDescription('Athletic Run Wild');
    expect(matched?.zeroProof).toBe(true);
    expect(matched?.isZeroProof).toBe(true);
    expect(matched?.units).toBe(0);
  });
});
