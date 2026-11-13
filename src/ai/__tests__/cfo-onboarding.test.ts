/**
 * @fileOverview COASTER-001 — Sunny · Coaster Onboarding, NIAAA Math & Persona Safety Suite
 *
 * Validates the deterministic drink-unit math, Clear Day / zero-proof tracking rules,
 * non-judgmental Sunny booth-buddy onboarding state, and coaching input contracts.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
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
} from '@/lib/health-service';
import { resolveEntryConsumedAt } from '@/ai/flows/outreach-meal-parser';
import { renderOutreachWelcomeEmailHtml } from '@/lib/outreach-email';
import { composeOutreachDispatch } from '@/lib/outreach-composer';

const FORBIDDEN_PERSONA_TERMS = /\b(the\s+cfo|chief\s+fitness\s+officer|visceral\s+fat|vf\s+score|lush)\b/i;

const flowInputSchema = z.object({
  userId: z.string(),
  userName: z.string().optional(),
  message: z.string(),
  currentDay: z.string(),
  localDate: z.string(),
  localTime: z.string(),
  photoDataUri: z.string().optional(),
  currentHealth: z.any().optional(),
  chatHistory: z
    .array(z.object({ role: z.enum(['user', 'model']), content: z.string() }))
    .optional(),
});

describe('COASTER-001: Sunny · Coaster onboarding & non-judgmental voice', () => {
  it('validates PersonalizedAICoachingInput shape for Sunny __init__ and drink logging turns', () => {
    const initTurn = flowInputSchema.safeParse({
      userId: 'marlo_uid',
      userName: 'Marlo',
      message: '__init__',
      currentDay: 'Friday',
      localDate: '2026-11-13',
      localTime: '18:30',
    });
    expect(initTurn.success).toBe(true);

    const drinkTurn = flowInputSchema.safeParse({
      userId: 'marlo_uid',
      userName: 'Marlo',
      message: '2 hazy IPAs at trivia and a sparkling yuzu',
      currentDay: 'Friday',
      localDate: '2026-11-13',
      localTime: '20:15',
      currentHealth: { dailyAlcoholDrinks: 0 },
      chatHistory: [
        {
          role: 'model',
          content:
            "Hey Marlo — I'm Sunny, your non-drinking booth-buddy here at Coaster. Tell me whatever's in your glass, snap a tap list, or tap Clear Day anytime.",
        },
      ],
    });
    expect(drinkTurn.success).toBe(true);
  });

  it('enforces zero CFO, VF Score, or drunk-shaming copy in onboarding & welcome artifacts', () => {
    const composed = composeOutreachDispatch({
      window: 'morning',
      localDate: '2026-11-13',
      displayName: 'Marlo',
      cadence: '2x',
      recentLogs: [],
    });
    const welcome = renderOutreachWelcomeEmailHtml({
      uid: 'marlo_uid',
      cadence: '2x',
      timezone: 'America/Los_Angeles',
      morningHour: 9,
      nightHour: 19,
      composed,
      recipientFirstName: 'Marlo',
    });

    const sampleSunnyGreeting =
      "A New Journey, Marlo — pull up a seat! I'm Sunny, usually nursing a Phony Negroni or sparkling yuzu. Drop a pour, snap a tap list, or log a Clear Day whenever you like — zero grades, zero lectures.";

    expect(sampleSunnyGreeting).not.toMatch(FORBIDDEN_PERSONA_TERMS);
    expect(welcome.subject).not.toMatch(FORBIDDEN_PERSONA_TERMS);
    expect(welcome.html).not.toMatch(FORBIDDEN_PERSONA_TERMS);
    expect(welcome.text).not.toMatch(FORBIDDEN_PERSONA_TERMS);
    expect(composed.body).not.toMatch(FORBIDDEN_PERSONA_TERMS);
  });
});

describe('COASTER-001: NIAAA Standard Drink Units, Clear Days & Multi-Day Splits', () => {
  it('computes NIAAA 14g / 0.6 fl oz pure ethanol units across beer, wine, spirits, and zero-proof', () => {
    // 1.0u standard pour benchmarks
    expect(calculateStandardUnits(12, 5)).toBe(1.0);
    expect(calculateStandardUnits(5, 12)).toBe(1.0);
    expect(calculateStandardUnits(1.5, 40)).toBe(1.0);

    // Real-world craft beer / restaurant wine / bottle math
    expect(calculateStandardUnits(16, 6.8)).toBe(1.8); // Hazy IPA pint
    expect(calculateStandardUnits(32, 6.8)).toBe(3.6); // 2 hazy IPA pints at trivia
    expect(calculateStandardUnits(16, 8.5)).toBe(2.3); // Double IPA pint
    expect(calculateStandardUnits(mlToOz(750), 12.5)).toBe(5.3); // 750mL wine bottle

    // Formatting and non-alcoholic guardrails
    expect(formatUnits(calculateStandardUnits(16, 6.8))).toBe('1.8u');
    expect(getEntryUnits({ isZeroProof: true, standardUnits: 1.5 })).toBe(0);
    expect(getEntryUnits({ isClearDay: true, alcoholDrinks: 2 })).toBe(0);
    expect(DRINK_PRESETS.log_cocktail.standardUnits).toBe(1.0);
  });

  it('tracks multi-day Clear Days & zero-proof swaps cleanly without hallucinated pre-start credit', () => {
    const entries: CoasterFoodLogEntry[] = [
      { name: 'Pinot Noir (5oz 12%)', date: '2026-11-08', consumedAt: '19:30', standardUnits: 1.0, drinkCategory: 'wine' },
      { name: 'Clear Day', date: '2026-11-09', consumedAt: '20:00', standardUnits: 0, isClearDay: true, drinkCategory: 'clear_day' },
      { name: 'Ginger Hibiscus Fizz', date: '2026-11-10', consumedAt: '18:45', standardUnits: 0, isZeroProof: true, drinkCategory: 'zero_proof' },
      { name: '2 Hazy IPAs', date: '2026-11-12', consumedAt: '20:15', standardUnits: 3.6, drinkCategory: 'ipa' },
      { name: 'Clear Day', date: '2026-11-13', consumedAt: '19:00', standardUnits: 0, isClearDay: true, drinkCategory: 'clear_day' },
    ];

    const summary = computeTrendSummary(entries, '2026-11-13');
    expect(summary.todayUnits).toBe(0);
    expect(summary.sevenDayTotal).toBe(4.6);
    expect(summary.sevenDayAvg).toBe(0.7);
    expect(summary.zeroProofLast30).toBe(1);
    // 11-09 (explicit clear), 11-10 (zero-proof 0u), 11-11 (tracked quiet day), 11-13 (explicit clear)
    expect(summary.clearDaysLast30).toBe(4);

    const series = computeDailyTrendSeries(entries, '2026-11-13', 7);
    expect(series.find((d) => d.date === '2026-11-07')?.clearDay).toBe(false);
    expect(series.find((d) => d.date === '2026-11-13')?.clearDay).toBe(true);
  });

  it('rotates zero-proof swap picks sensibly (~1 in 3 pours) and separates last-night replies', () => {
    expect(shouldSuggestAlternative(3)).toBe(true);
    expect(shouldSuggestAlternative(2)).toBe(false);
    expect(shouldSuggestAlternative(2, true)).toBe(true);
    expect(pickZeroProofAlternative('ipa', 0)).toMatch(/Hop/i);
    expect(resolveEntryConsumedAt({ dayOffset: -1, meal: 'dinner', localTime: '09:00' })).toBe('20:30');
  });
});
