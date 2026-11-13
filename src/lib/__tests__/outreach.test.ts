import crypto from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ai } from '@/ai/genkit';
import * as firebaseAdmin from '@/firebase/admin';
import {
  DRINK_PRESETS,
  calculateStandardUnits,
  computeDailyTrendSeries,
  computeTrendSummary,
  formatUnits,
  getEntryUnits,
  mlToOz,
  pickZeroProofAlternative,
  shouldSuggestAlternative,
  type CoasterFoodLogEntry,
} from '../health-service';
import {
  addIsoDays,
  diffIsoDays,
  resolveLocalClock,
  signOutreachToken,
  verifyOutreachToken,
} from '../outreach-auth';
import {
  composeOutreachDispatch,
  evaluateAutoSunset,
  isWindowAllowedForCadence,
} from '../outreach-composer';
import {
  renderOutreachEmailHtml,
  renderOutreachWelcomeEmailHtml,
  resolveGmailOutreachConfig,
} from '../outreach-email';
import {
  extractEmailReplyPartsFromRawMime,
  extractPlainTextFromRawMime,
} from '../outreach-gmail-inbound';
import {
  buildDiscordOutreachPayload,
  verifyDiscordSignature,
} from '../outreach-discord';
import {
  extractCleanReplyText,
  inferReplyDayOffset,
  isExplicitStopKeyword,
  parseOutreachMealText,
  resolveEntryConsumedAt,
} from '@/ai/flows/outreach-meal-parser';
import * as outreachService from '../outreach-service';
import { GET as outreachActionGet } from '@/app/api/outreach/action/route';
import { adminHealthService, isLikelyDuplicateOrRevisionMeal } from '../health-service-admin';
import { deriveFirstNameFromEmail } from '../../../scripts/enroll-outreach';
import type { FoodLogEntry } from '../food-exercise-types';

const FORBIDDEN_LEGACY_RE = /\b(the\s+cfo|chief\s+fitness\s+officer|visceral\s+fat|vf\s+score|lush)\b/i;

function makeDrink(overrides: Partial<CoasterFoodLogEntry> & { date?: string }): CoasterFoodLogEntry {
  return {
    name: 'Beer (12oz 5%)',
    drinkCategory: 'beer',
    volumeOz: 12,
    abvPct: 5,
    standardUnits: 1.0,
    alcoholDrinks: 1.0,
    isZeroProof: false,
    isClearDay: false,
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fiberG: 0,
    meal: 'dinner',
    date: '2026-11-11',
    consumedAt: '19:30',
    ...overrides,
  };
}

describe('NIAAA Standard Drink math & Coaster trends', () => {
  it('computes NIAAA standard drink units accurately across pours and mL conversions', () => {
    expect(calculateStandardUnits(12, 5)).toBe(1.0);
    expect(calculateStandardUnits(16, 6.8)).toBe(1.8);
    expect(calculateStandardUnits(5, 12)).toBe(1.0);
    expect(calculateStandardUnits(6, 13.5)).toBe(1.4);
    expect(calculateStandardUnits(1.5, 40)).toBe(1.0);
    expect(calculateStandardUnits(12, 0)).toBe(0);
    expect(mlToOz(750)).toBeCloseTo(25.36, 2);
    expect(calculateStandardUnits(mlToOz(750), 13)).toBe(5.5);
    expect(formatUnits(1.8)).toBe('1.8u');
    expect(formatUnits(-2)).toBe('0.0u');
  });

  it('tracks 7-day rolling averages, 30-day totals, Clear Days, and zero-proof swaps', () => {
    const logs: CoasterFoodLogEntry[] = [
      makeDrink({ date: '2026-11-05', standardUnits: 1.8, drinkCategory: 'ipa', name: 'Hazy IPA' }),
      makeDrink({ date: '2026-11-07', standardUnits: 2.0, drinkCategory: 'wine', name: 'Pinot Noir x2' }),
      makeDrink({
        date: '2026-11-09',
        standardUnits: 0,
        alcoholDrinks: 0,
        drinkCategory: 'zero_proof',
        isZeroProof: true,
        name: 'Phony Negroni',
      }),
      makeDrink({
        date: '2026-11-10',
        standardUnits: 0,
        alcoholDrinks: 0,
        drinkCategory: 'clear_day',
        isClearDay: true,
        name: 'Clear Day',
      }),
      makeDrink({ date: '2026-11-11', standardUnits: 1.0, drinkCategory: 'beer', name: 'Pilsner' }),
    ];

    const series7 = computeDailyTrendSeries(logs, '2026-11-11', 7);
    expect(series7).toHaveLength(7);
    expect(series7.map((d) => d.date)).toEqual([
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
    ]);
    // Tracked gap days (11-06, 11-08), zero-proof day (11-09), and explicit Clear Day (11-10)
    expect(series7.filter((d) => d.clearDay)).toHaveLength(4);

    const summary = computeTrendSummary(logs, '2026-11-11');
    expect(summary.todayUnits).toBe(1.0);
    expect(summary.sevenDayTotal).toBe(4.8);
    expect(summary.sevenDayAvg).toBe(0.7);
    expect(summary.thirtyDayTotal).toBe(4.8);
    // Does not falsely credit days before user's earliest log (2026-11-05)
    expect(summary.clearDaysLast30).toBe(4);
    expect(summary.zeroProofLast30).toBe(1);

    expect(DRINK_PRESETS.log_beer.standardUnits).toBe(1.0);
    expect(DRINK_PRESETS.log_zero_proof.standardUnits).toBe(0.0);
    expect(DRINK_PRESETS.log_clear_day.isClearDay).toBe(true);
    expect(getEntryUnits({ isClearDay: true, standardUnits: 2 })).toBe(0);
    expect(getEntryUnits({ isZeroProof: true, standardUnits: 2 })).toBe(0);
  });

  it('triggers zero-proof swaps roughly 1 in 3 pours or when asked', () => {
    expect(shouldSuggestAlternative(1)).toBe(false);
    expect(shouldSuggestAlternative(2)).toBe(false);
    expect(shouldSuggestAlternative(3)).toBe(true);
    expect(shouldSuggestAlternative(1, true)).toBe(true);
    expect(pickZeroProofAlternative('cocktail', 1).length).toBeGreaterThan(10);
  });
});

describe('outreach-auth: Coaster HMAC tokens & timezone helpers', () => {
  it('signs and verifies Coaster action tokens including cadence/nonce and rejects tampered tokens', () => {
    const nowSec = 1_800_000_000;
    const pourToken = signOutreachToken({
      uid: 'user_123',
      action: 'log_beer',
      date: '2026-11-11',
      window: 'night',
      nonce: 'abc123',
      exp: nowSec + 3600,
    });

    expect(verifyOutreachToken(pourToken, nowSec)).toEqual({
      uid: 'user_123',
      action: 'log_beer',
      date: '2026-11-11',
      window: 'night',
      nonce: 'abc123',
      exp: nowSec + 3600,
    });

    const cadenceToken = signOutreachToken({
      uid: 'user_123',
      action: 'set_cadence',
      cadence: '2x',
      exp: nowSec + 86400,
    });
    expect(verifyOutreachToken(cadenceToken, nowSec)?.cadence).toBe('2x');

    // Expired
    expect(verifyOutreachToken(pourToken, nowSec + 3601)).toBeNull();

    // Tampered
    const [body, sig] = pourToken.split('.');
    expect(verifyOutreachToken(`${body.slice(0, -2)}ab.${sig}`, nowSec)).toBeNull();
  });

  it('resolves local timezone clock and ISO day math cleanly', () => {
    const dt = new Date('2026-11-11T15:30:00Z');
    const clock = resolveLocalClock(dt, 'America/Los_Angeles');
    expect(clock.localDate).toBe('2026-11-11');
    expect(clock.hour).toBe(7);
    expect(clock.minute).toBe(30);
    expect(addIsoDays('2026-11-28', 5)).toBe('2026-12-03');
    expect(diffIsoDays('2026-11-01', '2026-11-11')).toBe(10);
  });
});

describe('outreach-composer: Morning/Evening 2x check-ins & cadences', () => {
  it('routes 2x, daily, weekly, and pause cadences accurately', () => {
    // 2026-11-08 is a Sunday; 2026-11-11 is a Wednesday
    expect(isWindowAllowedForCadence({ cadence: '2x', window: 'morning', localDate: '2026-11-11' })).toBe(true);
    expect(isWindowAllowedForCadence({ cadence: '2x', window: 'midday', localDate: '2026-11-11' })).toBe(false);
    expect(isWindowAllowedForCadence({ cadence: '2x', window: 'night', localDate: '2026-11-11' })).toBe(true);

    expect(isWindowAllowedForCadence({ cadence: 'daily', window: 'morning', localDate: '2026-11-11' })).toBe(true);
    expect(isWindowAllowedForCadence({ cadence: 'daily', window: 'night', localDate: '2026-11-11' })).toBe(false);

    expect(isWindowAllowedForCadence({ cadence: 'weekly', window: 'morning', localDate: '2026-11-08' })).toBe(true);
    expect(isWindowAllowedForCadence({ cadence: 'weekly', window: 'morning', localDate: '2026-11-11' })).toBe(false);
    expect(isWindowAllowedForCadence({ cadence: 'pause', window: 'morning', localDate: '2026-11-08' })).toBe(false);
  });

  it('composes warm, non-judgmental Morning and Evening Sunny briefings with drink tally & zero CFO/VF copy', () => {
    const recentLogs: CoasterFoodLogEntry[] = [
      makeDrink({ date: '2026-11-09', standardUnits: 1.8, drinkCategory: 'ipa', name: 'Hazy IPA' }),
      makeDrink({ date: '2026-11-10', standardUnits: 1.0, drinkCategory: 'wine', name: 'Pinot Noir' }),
      makeDrink({ date: '2026-11-11', standardUnits: 1.0, drinkCategory: 'beer', name: 'Lager' }),
    ];

    const morning = composeOutreachDispatch({
      window: 'morning',
      localDate: '2026-11-11',
      displayName: 'Marlo',
      cadence: '2x',
      recentLogs,
      lastFoodToday: recentLogs[2],
    });

    expect(morning.subject).toContain('Sunny · Coaster Morning');
    expect(morning.headline).toContain('Marlo');
    expect(morning.body).toContain('1.0u');
    expect(morning.quickActions.map((q) => q.action)).toContain('log_clear_day');
    expect(morning.swapSuggestion).toBeTruthy(); // 3rd alcoholic pour triggers gentle booth pick
    expect(morning.subject + morning.headline + morning.body).not.toMatch(FORBIDDEN_LEGACY_RE);

    const evening = composeOutreachDispatch({
      window: 'night',
      localDate: '2026-11-11',
      displayName: 'Marlo',
      cadence: '2x',
      recentLogs,
      lastFoodToday: recentLogs[2],
    });
    expect(evening.subject).toContain('Sunny · Coaster Evening');
    expect(evening.body).toContain("today's coaster");
    expect(evening.metricsLine).toContain('Today 1.0u');
    expect(evening.subject + evening.headline + evening.body).not.toMatch(FORBIDDEN_LEGACY_RE);
  });

  it('evaluates gentle auto-sunset thresholds at 3 and 7 silent days', () => {
    expect(
      evaluateAutoSunset({
        localDate: '2026-11-11',
        lastInteractionDate: '2026-11-10',
        currentCadence: '2x',
      }).decision,
    ).toBe('none');

    expect(
      evaluateAutoSunset({
        localDate: '2026-11-11',
        lastInteractionDate: '2026-11-08',
        currentCadence: '2x',
      }).decision,
    ).toBe('downshift_to_morning');

    expect(
      evaluateAutoSunset({
        localDate: '2026-11-11',
        lastInteractionDate: '2026-11-03',
        currentCadence: 'daily',
      }).decision,
    ).toBe('auto_pause');
  });
});

describe('Gmail +coaster@ isolation, "A New Journey" welcome email, MIME & CLI', () => {
  it('uses +coaster@ plus-addressing instead of +cfo@', () => {
    const prevPass = process.env.GMAIL_APP_PASSWORD;
    const prevUser = process.env.GMAIL_USER;
    try {
      process.env.GMAIL_APP_PASSWORD = 'abcd efgh ijkl mnop';
      process.env.GMAIL_USER = 'nicholas.switzer@gmail.com';
      const cfg = resolveGmailOutreachConfig();
      expect(cfg).toEqual({
        user: 'nicholas.switzer@gmail.com',
        appPassword: 'abcdefghijklmnop',
        plusReplyTo: 'nicholas.switzer+coaster@gmail.com',
      });
    } finally {
      if (prevPass === undefined) delete process.env.GMAIL_APP_PASSWORD;
      else process.env.GMAIL_APP_PASSWORD = prevPass;
      if (prevUser === undefined) delete process.env.GMAIL_USER;
      else process.env.GMAIL_USER = prevUser;
    }
  });

  it('renders literary "A New Journey" welcome email personalized for Marlo and warm daily Coaster emails', () => {
    const composed = composeOutreachDispatch({
      window: 'night',
      localDate: '2026-11-11',
      displayName: 'Marlo',
      cadence: '2x',
      recentLogs: [makeDrink({ date: '2026-11-11', name: 'Pinot Noir', standardUnits: 1.0 })],
    });

    const welcome = renderOutreachWelcomeEmailHtml({
      uid: 'user_marlo',
      cadence: '2x',
      timezone: 'America/Los_Angeles',
      morningHour: 9,
      nightHour: 19,
      composed,
      recipientFirstName: 'Marlo',
    });

    expect(welcome.subject).toContain('A New Journey, Marlo');
    expect(welcome.html).toContain('A New Journey, Marlo');
    expect(welcome.html).toContain('Sunny');
    expect(welcome.html).toContain('NIAAA Standard Drink Units');
    expect(welcome.html).toContain('12oz 5% beer');
    expect(welcome.html).toContain('5oz 12% wine');
    expect(welcome.html).toContain('1.5oz 40% spirit');
    expect(welcome.html).toContain('Open Live Coaster &amp; Trends');
    expect(welcome.html).toContain('+1.0u Beer');
    expect(welcome.html).toContain('Clear Day 0.0u');
    expect(welcome.html).toContain('9:00 AM &amp; 7:00 PM (America/Los_Angeles)');
    // Asks gently about last night & highlights pics + more + mobile-first 375px CSS
    expect(welcome.html.toLowerCase()).toContain('how did last night go');
    expect(welcome.html.toLowerCase()).toContain("yesterday&rsquo;s coaster");
    expect(welcome.text.toLowerCase()).toContain('how did last night go');
    expect(welcome.text.toLowerCase()).toContain("yesterday's coaster");
    expect(welcome.html.toLowerCase()).toContain('pics');
    expect(welcome.html.toLowerCase()).toContain('and more');
    expect(welcome.html.toLowerCase()).toContain('exif');
    expect(welcome.html.toLowerCase()).toContain('share sheet');
    expect(welcome.text.toLowerCase()).toContain('pics');
    expect(welcome.text.toLowerCase()).toContain('and more');
    expect(welcome.html).toContain('max-width:560px;width:100%;box-sizing:border-box');
    expect(welcome.html).toContain('min-height:44px');
    expect(welcome.html).toContain('font-size:16px');
    expect(welcome.html).not.toMatch(FORBIDDEN_LEGACY_RE);
    expect(welcome.text).not.toMatch(FORBIDDEN_LEGACY_RE);

    const rendered = renderOutreachEmailHtml({
      uid: 'user_marlo',
      cadence: '2x',
      composed,
    });
    expect(rendered.unsubscribeUrl).toContain('/api/outreach/action?token=');
    expect(rendered.html).toContain('Open Live Coaster &amp; Trends');
    expect(rendered.html).toContain('Clear Day 0.0u');
    expect(rendered.html).toContain('max-width:560px;width:100%;box-sizing:border-box');
    expect(rendered.html).toContain('min-height:44px');
    expect(rendered.html).toContain('font-size:16px');
    expect(rendered.html).not.toMatch(FORBIDDEN_LEGACY_RE);
  });

  it('derives clean first names in enrollment CLI helper', () => {
    expect(deriveFirstNameFromEmail('miss.marlo@gmail.com')).toBe('Marlo');
    expect(deriveFirstNameFromEmail('nicholas.switzer@gmail.com')).toBe('Nicholas');
    expect(deriveFirstNameFromEmail('dr.alex_chen+test@gmail.com')).toBe('Alex');
  });

  it('extracts plain English + attached receipt/tap photos from MIME replies and strips quoted Coaster threads', () => {
    const wrappedReply = [
      '2 hazy IPAs at trivia and a glass of pinot',
      '',
      'On Thu, Nov 12, 2026 at 7:12\u202fPM Sunny · Coaster <nicholas.switzer@gmail.com>',
      'wrote:',
      '',
      '> A New Journey, Marlo',
    ].join('\r\n');

    expect(extractCleanReplyText(wrappedReply)).toBe('2 hazy IPAs at trivia and a glass of pinot');
    expect(isExplicitStopKeyword('STOP')).toBe(true);
    expect(isExplicitStopKeyword("please don't message me anymore")).toBe(true);
    expect(isExplicitStopKeyword('Clear day')).toBe(false);

    const mime = Buffer.from(
      [
        'From: miss.marlo@gmail.com',
        'To: nicholas.switzer+coaster@gmail.com',
        'Content-Type: multipart/alternative; boundary="b123"',
        '',
        '--b123',
        'Content-Type: text/plain; charset="UTF-8"',
        '',
        'Clear day tonight!',
        '--b123--',
      ].join('\r\n'),
      'utf8',
    );
    expect(extractPlainTextFromRawMime(mime)).toBe('Clear day tonight!');

    const fakeJpegBase64 = Buffer.alloc(1500, 0xab).toString('base64');
    const tinyPixelBase64 = Buffer.alloc(40, 0x01).toString('base64');
    const mixedMime = Buffer.from(
      [
        'From: miss.marlo@gmail.com',
        'To: nicholas.switzer+coaster@gmail.com',
        'Content-Type: multipart/mixed; boundary="mix99"',
        '',
        '--mix99',
        'Content-Type: text/plain; charset="UTF-8"',
        '',
        'Had half of this tap list pour',
        '--mix99',
        'Content-Type: image/gif; name="pixel.gif"',
        'Content-Transfer-Encoding: base64',
        '',
        tinyPixelBase64,
        '--mix99',
        'Content-Type: image/jpeg; name="receipt.jpg"',
        'Content-Disposition: attachment; filename="receipt.jpg"',
        'Content-Transfer-Encoding: base64',
        '',
        fakeJpegBase64,
        '--mix99--',
      ].join('\r\n'),
      'utf8',
    );

    const parts = extractEmailReplyPartsFromRawMime(mixedMime);
    expect(parts.text).toBe('Had half of this tap list pour');
    expect(parts.images).toHaveLength(1);
    expect(parts.images[0].contentType).toBe('image/jpeg');
  });

  it('keeps Discord Ed25519 signature verification and resolveEntryConsumedAt last-night backfill guard', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const spkiDer = publicKey.export({ format: 'der', type: 'spki' });
    const publicKeyHex = spkiDer.subarray(spkiDer.length - 32).toString('hex');
    const timestamp = '1762890000';
    const rawBody = JSON.stringify({ type: 1 });
    const sigHex = crypto
      .sign(null, Buffer.from(timestamp + rawBody, 'utf8'), privateKey)
      .toString('hex');

    expect(
      verifyDiscordSignature({ publicKeyHex, signatureHex: sigHex, timestamp, rawBody }),
    ).toBe(true);
    expect(
      verifyDiscordSignature({
        publicKeyHex,
        signatureHex: sigHex,
        timestamp,
        rawBody: JSON.stringify({ type: 2 }),
      }),
    ).toBe(false);

    const composed = composeOutreachDispatch({
      window: 'night',
      localDate: '2026-11-11',
      cadence: '2x',
      recentLogs: [],
    });
    const payload = buildDiscordOutreachPayload({ cadence: '2x', composed });
    expect(payload.embeds[0].title).toBe(composed.headline);
    expect(payload.components).toHaveLength(2);

    // Backdated "last night" entries default to evening 20:30 instead of morning reply clock
    expect(
      resolveEntryConsumedAt({
        dayOffset: -1,
        meal: 'dinner',
        localTime: '08:45',
      }),
    ).toBe('20:30');
    expect(
      resolveEntryConsumedAt({
        dayOffset: -1,
        meal: 'dinner',
        explicitConsumedAt: '08:45',
        localTime: '08:45',
      }),
    ).toBe('20:30');
    expect(
      resolveEntryConsumedAt({
        dayOffset: 0,
        meal: 'dinner',
        localTime: '19:15',
      }),
    ).toBe('19:15');

    // Confirm FoodLogEntry dedup behaves safely for distinct timestamps
    const pourA: FoodLogEntry = {
      id: 'p1',
      name: 'Hazy IPA',
      portionG: 473,
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      fiberG: 0,
      source: 'user_estimate',
      meal: 'dinner',
      date: '2026-11-11',
      consumedAt: '17:00',
      timestamp: new Date() as unknown as FoodLogEntry['timestamp'],
    };
    const pourLater: FoodLogEntry = { ...pourA, consumedAt: '21:15' };
    expect(isLikelyDuplicateOrRevisionMeal(pourA, pourLater)).toBe(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves "last night" and "yesterday" replies onto yesterday local dateKey and renders 375px-safe Live Coaster HTML', async () => {
    expect(inferReplyDayOffset('Last night I had a glass of pinot noir')).toBe(-1);
    expect(inferReplyDayOffset('Yesterday was a clear day')).toBe(-1);
    expect(inferReplyDayOffset('2 hazy IPAs right now')).toBe(0);

    // Even if LLM omits dayOffset (returns 0) and copies morning localTime, parser anchors onto yesterday
    vi.spyOn(ai, 'generate').mockResolvedValueOnce({
      output: {
        isFoodLog: true,
        isStopCommand: false,
        name: 'Pinot Noir (5oz 12%)',
        drinkCategory: 'wine',
        volumeOz: 5,
        abvPct: 12,
        standardUnits: 1.0,
        alcoholDrinks: 1.0,
        portionG: 148,
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        dayOffset: 0,
        consumedAt: '09:05',
        meal: 'dinner',
        source: 'user_estimate',
        agentReply: "Tucked that glass of pinot noir gently onto yesterday's coaster.",
      },
    } as never);

    const parsed = await parseOutreachMealText({
      uid: 'user_marlo',
      rawText: 'Last night I had a glass of pinot noir',
      localTime: '09:05',
      localDate: '2026-11-13',
      yesterdayDate: '2026-11-12',
    });

    expect(parsed.dayOffset).toBe(-1);
    expect(parsed.date).toBe('2026-11-12');
    expect(parsed.consumedAt).toBe('20:30');
    expect(parsed.entries?.[0].dayOffset).toBe(-1);
    expect(parsed.entries?.[0].date).toBe('2026-11-12');
    expect(parsed.entries?.[0].consumedAt).toBe('20:30');

    // End-to-end check on processOutreachFreeTextMeal timezone + yesterday dateKey write
    const fakeDoc = {
      get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const fakeCollection = {
      add: vi.fn().mockResolvedValue({ id: 'log_yday_1' }),
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ docs: [] }),
        }),
      }),
    };
    vi.spyOn(firebaseAdmin, 'getAdminFirestore').mockReturnValue({
      doc: vi.fn().mockReturnValue(fakeDoc),
      collection: vi.fn().mockReturnValue(fakeCollection),
    } as never);

    vi.spyOn(adminHealthService, 'getHealthSummary').mockResolvedValue({
      id: 'user_marlo',
      steps: 0,
      hrv: 0,
      sleepHours: 0,
      recoveryStatus: 'high',
      dailyProteinG: 0,
      dailyCarbsG: 0,
      dailyCaloriesIn: 0,
      dailyCaloriesOut: 0,
      visceralFatPoints: 0,
      history: [],
      isAnonymous: false,
      onboardingDay: 1,
      onboardingComplete: true,
      isDeviceVerified: false,
      entitlementTier: 'vip',
    });
    vi.spyOn(adminHealthService, 'getUserPreferences').mockResolvedValue({
      weeklySchedule: '',
      equipment: [],
      targets: { proteinGoal: 0, fatPointsGoal: 0 },
      profile: {
        name: 'Marlo',
        weightKg: 65,
        heightCm: 168,
        age: 34,
        gender: 'female',
        goal: 'mindful',
        activityLevel: 'moderate',
      },
      foundingFriend: true,
      outreach: {
        enabled: true,
        channel: 'email',
        cadence: '2x',
        email: 'miss.marlo@gmail.com',
        timezone: 'America/Los_Angeles',
        morningHour: 9,
        nightHour: 19,
      },
    } as never);
    vi.spyOn(adminHealthService, 'queryFoodLog').mockResolvedValue([]);
    vi.spyOn(adminHealthService, 'queryLogRangeAll').mockResolvedValue([]);
    vi.spyOn(adminHealthService, 'updateHealthData').mockResolvedValue(undefined);
    const logFoodSpy = vi.spyOn(adminHealthService, 'logFood').mockResolvedValue('log_yday_pinot');

    vi.spyOn(ai, 'generate').mockResolvedValueOnce({
      output: {
        isFoodLog: true,
        isStopCommand: false,
        name: 'Yesterday — Clear Day',
        drinkCategory: 'clear_day',
        isClearDay: true,
        standardUnits: 0,
        alcoholDrinks: 0,
        portionG: 0,
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        dayOffset: -1,
        consumedAt: '20:30',
        meal: 'dinner',
        source: 'user_estimate',
        agentReply: "Tucked yesterday's Clear Day cleanly onto your coaster.",
      },
    } as never);

    // 2026-11-13T17:05:00Z = 09:05 AM America/Los_Angeles -> yesterday is 2026-11-12
    const freeRes = await outreachService.processOutreachFreeTextMeal({
      uid: 'user_marlo',
      rawText: 'Yesterday was a clear day!',
      now: new Date('2026-11-13T17:05:00Z'),
    });

    expect(freeRes.status).toBe('logged');
    expect(freeRes.localDate).toBe('2026-11-12');
    expect(freeRes.isClearDay).toBe(true);
    expect(logFoodSpy).toHaveBeenCalledTimes(1);
    expect(logFoodSpy.mock.calls[0][2]).toMatchObject({
      date: '2026-11-12',
      consumedAt: '20:30',
      isClearDay: true,
    });

    // Zero-Login Live Coaster HTML route renders mobile-first 375px-safe layout
    const ledgerToken = signOutreachToken({ uid: 'user_marlo', action: 'view_ledger' });
    const req = new NextRequest(`https://coaster.example/api/outreach/action?t=${encodeURIComponent(ledgerToken)}`);
    const resp = await outreachActionGet(req);
    const html = await resp.text();
    expect(resp.status).toBe(200);
    expect(html).toContain('Live Coaster &amp; Trends');
    expect(html).toContain('max-width:560px;width:100%;box-sizing:border-box');
    expect(html).toContain('min-height:44px');
    expect(html).toContain('font-size:16px');
    expect(html).not.toContain('grid-template-columns:repeat(3,1fr)');
    expect(html).not.toMatch(FORBIDDEN_LEGACY_RE);
  });
});
