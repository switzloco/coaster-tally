/**
 * @fileOverview Server-side orchestration for Sunny · Coaster Morning/Evening check-ins.
 * Coordinates Firestore state, idempotent 1-tap quick-actions, quiet-stretch auto-sunset,
 * natural-language & photo replies, Email (+coaster@), and Discord REST.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService } from './health-service-admin';
import {
  DRINK_PRESETS,
  computeTrendSummary,
  formatUnits,
  getEntryDateKey,
  getEntryUnits,
  isClearDayEntry,
  isZeroProofEntry,
  pickZeroProofAlternative,
  shouldSuggestAlternative,
  type CoasterFoodLogEntry,
  type DrinkCategory,
  type DrinkTrendSummary,
  type OutreachCadence,
  type OutreachPreferences,
  type OutreachWindow,
} from './health-service';
import { inferMealFromTime, type ChatMessage, type FoodLogEntry } from './food-exercise-types';
import {
  addIsoDays,
  normalizeTimezone,
  resolveLocalClock,
  type OutreachActionType,
} from './outreach-auth';
import {
  composeOutreachDispatch,
  evaluateAutoSunset,
  isWindowAllowedForCadence,
  type ComposedOutreachMessage,
} from './outreach-composer';
import {
  sendOutreachEmail,
  sendOutreachReplyConfirmationEmail,
  sendOutreachWelcomeEmail,
} from './outreach-email';
import { sendOutreachDiscordDM } from './outreach-discord';
import {
  extractCleanReplyText,
  parseOutreachMealText,
  type OutreachImageAttachment,
} from '@/ai/flows/outreach-meal-parser';
import { backfillScoreHistory } from './score-history-sync';
import { FOUNDER_EMAILS } from './entitlements';

export const MAX_FREE_OUTREACH_PARSES_PER_DAY = 10;

const LEGACY_PRESET_MEALS: Record<
  'protein_40' | 'protein_45_lunch' | 'eggs_breakfast' | 'dinner_standard',
  {
    name: string;
    portionG: number;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
    plantMassG?: number;
  }
> = {
  protein_40: {
    name: 'Lean Protein Pulse',
    portionG: 350,
    calories: 200,
    proteinG: 40,
    carbsG: 4,
    fatG: 2,
    fiberG: 0,
  },
  protein_45_lunch: {
    name: 'Lunch Bowl',
    portionG: 420,
    calories: 420,
    proteinG: 45,
    carbsG: 28,
    fatG: 12,
    fiberG: 6,
    plantMassG: 200,
  },
  eggs_breakfast: {
    name: 'Eggs Breakfast',
    portionG: 260,
    calories: 260,
    proteinG: 32,
    carbsG: 2,
    fatG: 14,
    fiberG: 0,
  },
  dinner_standard: {
    name: 'Dinner Plate',
    portionG: 480,
    calories: 580,
    proteinG: 50,
    carbsG: 38,
    fatG: 22,
    fiberG: 7,
    plantMassG: 240,
  },
};

function currentWindowForHour(hour: number): OutreachWindow {
  if (hour < 11) return 'morning';
  if (hour < 17) return 'midday';
  return 'night';
}

async function appendOutreachTranscript(
  uid: string,
  localDate: string,
  messages: ChatMessage[],
): Promise<void> {
  try {
    const db = getAdminFirestore();
    await adminHealthService.appendChatMessages(db, uid, localDate, messages);
  } catch (err) {
    console.warn('[OutreachService] Non-fatal chat transcript mirror warning:', err);
  }
}

async function refreshDailyFoodCounters(uid: string, localDate: string): Promise<void> {
  const db = getAdminFirestore();
  const allTodayEntries = (await adminHealthService.queryFoodLog(
    db,
    uid,
    localDate,
    60,
  )) as CoasterFoodLogEntry[];

  const newUnitsTotal =
    Math.round(allTodayEntries.reduce((s, e) => s + getEntryUnits(e), 0) * 10) / 10;
  const newProteinTotal = Math.round(allTodayEntries.reduce((s, e) => s + (e.proteinG || 0), 0));
  const newCarbsTotal = Math.round(allTodayEntries.reduce((s, e) => s + (e.carbsG || 0), 0));
  const newCaloriesTotal = Math.round(allTodayEntries.reduce((s, e) => s + (e.calories || 0), 0));
  const newPlantTotal = Math.round(
    allTodayEntries.reduce((s, e) => s + ((e as FoodLogEntry).plantMassG || 0), 0),
  );

  const currentHealth = await adminHealthService.getHealthSummary(db, uid);
  if (!currentHealth?.lastActiveDate || localDate >= currentHealth.lastActiveDate) {
    await adminHealthService.updateHealthData(db, uid, {
      dailyAlcoholDrinks: newUnitsTotal,
      dailyProteinG: newProteinTotal,
      dailyCarbsG: newCarbsTotal,
      dailyCaloriesIn: newCaloriesTotal,
      dailyPlantG: newPlantTotal,
      lastActiveDate: localDate,
    });
  }

  await backfillScoreHistory(uid, localDate, 7).catch((err) => {
    console.warn('[OutreachService] Score history backfill non-fatal warning:', err);
  });
}

async function writeDirectFoodEntry(
  uid: string,
  entry: Omit<CoasterFoodLogEntry, 'id'> & {
    date: string;
    source: 'usda' | 'user_estimate';
    meal: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  },
): Promise<string> {
  const db = getAdminFirestore();
  const ref = db.collection(`users/${uid}/food_log`);
  const clean = Object.fromEntries(
    Object.entries({ ...entry, timestamp: FieldValue.serverTimestamp() }).filter(
      ([, v]) => v !== undefined,
    ),
  );
  const docRef = await ref.add(clean);
  return docRef.id;
}

/**
 * Persists Coaster outreach settings on `preferences/settings` and mirrors
 * lookup flags onto `users/{uid}` so cron & webhooks need zero composite indexes.
 */
export async function saveUserOutreachSettings(params: {
  uid: string;
  outreach: Partial<OutreachPreferences> & { enabled: boolean };
  displayName?: string;
  weightKg?: number;
  proteinGoal?: number;
}): Promise<OutreachPreferences> {
  const db = getAdminFirestore();
  const existingPrefs = await adminHealthService.getUserPreferences(db, params.uid);
  const prev = existingPrefs?.outreach;

  const timezone = normalizeTimezone(params.outreach.timezone ?? prev?.timezone);
  const clock = resolveLocalClock(new Date(), timezone);
  const cleanEmail = (params.outreach.email ?? prev?.email ?? '').trim().toLowerCase() || undefined;
  const cleanDiscordId =
    (params.outreach.discordUserId ?? prev?.discordUserId ?? '').trim() || undefined;

  const merged: OutreachPreferences = adminHealthService.deepClean({
    enabled: params.outreach.enabled,
    channel:
      params.outreach.channel ??
      prev?.channel ??
      (cleanDiscordId && !cleanEmail ? 'discord' : 'email'),
    cadence: params.outreach.cadence ?? prev?.cadence ?? '2x',
    email: cleanEmail,
    discordUserId: cleanDiscordId,
    discordChannelId:
      cleanDiscordId === prev?.discordUserId
        ? (params.outreach.discordChannelId ?? prev?.discordChannelId)
        : params.outreach.discordChannelId,
    timezone,
    morningHour: params.outreach.morningHour ?? prev?.morningHour ?? 9,
    middayHour: params.outreach.middayHour ?? prev?.middayHour ?? 13,
    nightHour: params.outreach.nightHour ?? prev?.nightHour ?? 19,
    pausedUntilDate: params.outreach.pausedUntilDate,
    lastInteractionDate:
      params.outreach.lastInteractionDate ?? prev?.lastInteractionDate ?? clock.localDate,
    lastDispatchedKey: params.outreach.lastDispatchedKey ?? prev?.lastDispatchedKey,
    dailyParseDate: prev?.dailyParseDate,
    dailyParseCount: prev?.dailyParseCount,
  });

  const prefUpdates: Record<string, unknown> = { outreach: merged };
  const existingProfile = (existingPrefs as unknown as Record<string, unknown> | undefined)
    ?.profile as Record<string, unknown> | undefined;
  if (params.displayName?.trim()) {
    prefUpdates.profile = {
      ...existingProfile,
      displayName: params.displayName.trim(),
    };
  }
  if (params.proteinGoal && params.proteinGoal >= 50) {
    prefUpdates.targets = {
      ...(existingPrefs?.targets ?? { fatPointsGoal: 3000 }),
      proteinGoal: Math.round(params.proteinGoal),
    };
  }
  if (params.weightKg && params.weightKg >= 30) {
    prefUpdates.profile = {
      ...((prefUpdates.profile as Record<string, unknown> | undefined) ?? existingProfile),
      weightKg: Math.round(params.weightKg * 10) / 10,
    };
  }

  await db.doc(`users/${params.uid}/preferences/settings`).set(prefUpdates, { merge: true });

  await adminHealthService.updateHealthData(db, params.uid, {
    outreachEnabled: merged.enabled,
    ...(cleanEmail ? { outreachEmail: cleanEmail } : {}),
    ...(cleanDiscordId ? { outreachDiscordUserId: cleanDiscordId } : {}),
    ...(params.displayName?.trim() ? { displayName: params.displayName.trim() } : {}),
  });

  return merged;
}

export type StoredCoasterFoodLogEntry = FoodLogEntry &
  Omit<CoasterFoodLogEntry, keyof FoodLogEntry>;

/**
 * Loads live Coaster drink history (30 days) and composes a Morning/Evening check-in.
 */
export async function buildLiveUserOutreach(params: {
  uid: string;
  window?: OutreachWindow;
  now?: Date;
  autoSunsetNotice?: 'downshifted_to_morning' | null;
}): Promise<{
  composed: ComposedOutreachMessage;
  outreach: OutreachPreferences | undefined;
  localTime: string;
  localDate: string;
  todayFoods: StoredCoasterFoodLogEntry[];
  yesterdayFoods: StoredCoasterFoodLogEntry[];
  recentLogs: StoredCoasterFoodLogEntry[];
  trend: DrinkTrendSummary;
  displayName?: string;
  proteinGoal: number;
}> {
  const db = getAdminFirestore();
  const [health, prefs] = await Promise.all([
    adminHealthService.getHealthSummary(db, params.uid),
    adminHealthService.getUserPreferences(db, params.uid),
  ]);

  const outreach = prefs?.outreach;
  const clock = resolveLocalClock(params.now ?? new Date(), outreach?.timezone);
  const yesterdayIso = addIsoDays(clock.localDate, -1);
  const start30Iso = addIsoDays(clock.localDate, -29);

  const [rangeLogsRaw, todayFallback, yesterdayFallback] = await Promise.all([
    adminHealthService.queryLogRangeAll(db, params.uid, 'food_log', start30Iso, clock.localDate),
    adminHealthService.queryFoodLog(db, params.uid, clock.localDate, 50),
    adminHealthService.queryFoodLog(db, params.uid, yesterdayIso, 50),
  ]);

  // Merge range logs with single-day queries in case an entry uses consumedAt date fallback
  const mergedById = new Map<string, StoredCoasterFoodLogEntry>();
  const addLogs = (items: StoredCoasterFoodLogEntry[]) => {
    for (const item of items) {
      if (item.ignored) continue;
      const key = item.id || `${item.consumedAt}_${item.foodName || item.name}`;
      mergedById.set(key, item);
    }
  };
  addLogs(rangeLogsRaw as unknown as StoredCoasterFoodLogEntry[]);
  addLogs(todayFallback as unknown as StoredCoasterFoodLogEntry[]);
  addLogs(yesterdayFallback as unknown as StoredCoasterFoodLogEntry[]);

  const recentLogs = Array.from(mergedById.values()).sort((a, b) =>
    `${getEntryDateKey(a)}T${a.consumedAt || '00:00'}`.localeCompare(
      `${getEntryDateKey(b)}T${b.consumedAt || '00:00'}`,
    ),
  );
  const todayFoods = recentLogs.filter((e) => getEntryDateKey(e) === clock.localDate);
  const yesterdayFoods = recentLogs.filter((e) => getEntryDateKey(e) === yesterdayIso);

  const displayName =
    ((prefs as unknown as { profile?: { displayName?: string } })?.profile?.displayName ||
      (health as unknown as { displayName?: string })?.displayName ||
      '')
      .trim() || undefined;

  const lastFoodToday = todayFoods.length > 0 ? todayFoods[todayFoods.length - 1] : null;
  const lastFoodYesterday =
    yesterdayFoods.length > 0 ? yesterdayFoods[yesterdayFoods.length - 1] : null;
  const latestLogDate =
    recentLogs.length > 0 ? getEntryDateKey(recentLogs[recentLogs.length - 1]) || undefined : undefined;

  const resolvedWindow = params.window ?? currentWindowForHour(clock.hour);
  const trend = computeTrendSummary(recentLogs, clock.localDate);

  const composed = composeOutreachDispatch({
    window: resolvedWindow,
    localDate: clock.localDate,
    localTime: clock.localTime,
    displayName,
    cadence: outreach?.cadence ?? '2x',
    recentLogs,
    todayFoodsCount: todayFoods.length,
    lastFoodToday,
    lastFoodYesterday,
    lastInboundDate: outreach?.lastInteractionDate,
    lastFoodDate: latestLogDate,
  });

  return {
    composed,
    outreach,
    localTime: clock.localTime,
    localDate: clock.localDate,
    todayFoods,
    yesterdayFoods,
    recentLogs,
    trend,
    displayName,
    proteinGoal: prefs?.targets?.proteinGoal ?? 150,
  };
}

/**
 * Dispatches a single Morning/Evening/Midday Coaster check-in with atomic lock & auto-sunset.
 */
export async function dispatchOutreachForUser(params: {
  uid: string;
  window: OutreachWindow;
  now?: Date;
  force?: boolean;
  isWelcome?: boolean;
  recipientFirstName?: string;
}): Promise<{
  status: 'sent' | 'skipped' | 'auto_paused' | 'failed';
  reason?: string;
  composed?: ComposedOutreachMessage;
}> {
  const db = getAdminFirestore();
  const prefs = await adminHealthService.getUserPreferences(db, params.uid);
  const outreach = prefs?.outreach;

  if (!outreach || (!outreach.enabled && !params.force)) {
    return { status: 'skipped', reason: 'outreach_disabled' };
  }

  const clock = resolveLocalClock(params.now ?? new Date(), outreach.timezone);
  const dispatchKey = `${clock.localDate}:${params.window}`;
  const settingsRef = db.doc(`users/${params.uid}/preferences/settings`);
  const lockRef = db.doc(
    `users/${params.uid}/outreach_actions/dispatch_${clock.localDate}_${params.window}`,
  );
  const previousDispatchedKey = outreach.lastDispatchedKey ?? null;

  let effectiveCadence: OutreachCadence = outreach.cadence ?? '2x';
  let autoSunsetNotice: 'downshifted_to_morning' | null = null;

  if (!params.force) {
    if (outreach.pausedUntilDate && outreach.pausedUntilDate >= clock.localDate) {
      return { status: 'skipped', reason: 'paused' };
    }
    if (outreach.lastDispatchedKey === dispatchKey) {
      return { status: 'skipped', reason: 'already_dispatched' };
    }

    const sunset = evaluateAutoSunset({
      localDate: clock.localDate,
      lastInteractionDate: outreach.lastInteractionDate,
      currentCadence: effectiveCadence,
    });

    if (sunset.decision === 'auto_pause') {
      const claimedPause = await db.runTransaction(async (tx) => {
        const snap = await tx.get(settingsRef);
        const live = snap.data()?.outreach;
        if (!live?.enabled) return false;
        tx.set(
          settingsRef,
          {
            outreach: {
              ...live,
              enabled: false,
              cadence: 'pause',
              autoPausedAt: new Date().toISOString(),
            },
          },
          { merge: true },
        );
        return true;
      });
      if (!claimedPause) {
        return { status: 'skipped', reason: 'outreach_disabled' };
      }
      await adminHealthService.updateHealthData(db, params.uid, { outreachEnabled: false });

      if (outreach.email && (outreach.channel === 'email' || outreach.channel === 'both')) {
        await sendOutreachReplyConfirmationEmail({
          to: outreach.email,
          uid: params.uid,
          subject: 'Sunny · Coaster — Check-ins gently paused',
          headline: 'Check-ins paused while you are away',
          detail:
            'Since it has been a quiet week, Sunny paused scheduled emails to keep your inbox clear. Open your Live Coaster link or Coaster settings anytime to jump back in.',
        });
      }
      return { status: 'auto_paused', reason: 'quiet_week' };
    }

    if (sunset.decision === 'downshift_to_morning') {
      effectiveCadence = 'daily';
      autoSunsetNotice = 'downshifted_to_morning';
    }

    if (
      !isWindowAllowedForCadence({
        cadence: effectiveCadence,
        window: params.window,
        localDate: clock.localDate,
      })
    ) {
      if (autoSunsetNotice === 'downshifted_to_morning') {
        await settingsRef.set(
          {
            outreach: {
              ...outreach,
              cadence: 'daily',
              autoDownshiftedAt: new Date().toISOString(),
            },
          },
          { merge: true },
        );
      }
      return { status: 'skipped', reason: `${effectiveCadence}_cadence` };
    }

    const claimResult = await db.runTransaction(async (tx) => {
      const [lockSnap, freshSettingsSnap] = await Promise.all([
        tx.get(lockRef),
        tx.get(settingsRef),
      ]);
      const liveOutreach = freshSettingsSnap.data()?.outreach ?? outreach;
      if (!liveOutreach?.enabled) return 'outreach_disabled' as const;
      if (liveOutreach.pausedUntilDate && liveOutreach.pausedUntilDate >= clock.localDate) {
        return 'paused' as const;
      }
      if (liveOutreach.lastDispatchedKey === dispatchKey) {
        return 'already_dispatched' as const;
      }

      const lockData = lockSnap.data();
      const nowMs = Date.now();
      if (lockData?.status === 'sent') {
        return 'already_dispatched' as const;
      }
      if (
        lockData?.status === 'sending' &&
        nowMs - Number(lockData.claimedAtMs || 0) < 10 * 60 * 1000
      ) {
        return 'already_dispatched' as const;
      }

      tx.set(lockRef, {
        type: 'scheduled_dispatch',
        dispatchKey,
        status: 'sending',
        claimedAtMs: nowMs,
      });
      tx.set(
        settingsRef,
        {
          outreach: adminHealthService.deepClean({
            ...liveOutreach,
            cadence: effectiveCadence,
            ...(autoSunsetNotice === 'downshifted_to_morning'
              ? { autoDownshiftedAt: new Date().toISOString() }
              : {}),
            lastDispatchedKey: dispatchKey,
          }),
        },
        { merge: true },
      );
      return 'claimed' as const;
    });

    if (claimResult !== 'claimed') {
      return { status: 'skipped', reason: claimResult };
    }
  }

  const { composed, displayName } = await buildLiveUserOutreach({
    uid: params.uid,
    window: params.window,
    now: params.now,
    autoSunsetNotice,
  });

  const resolvedFirstName =
    params.recipientFirstName?.trim() ||
    (displayName ? displayName.split(/\s+/)[0] : undefined);

  let anySent = false;
  const errors: string[] = [];
  let cachedDiscordChannelId = outreach.discordChannelId;

  if ((outreach.channel === 'email' || outreach.channel === 'both') && outreach.email) {
    const emailRes = params.isWelcome
      ? await sendOutreachWelcomeEmail({
          to: outreach.email,
          uid: params.uid,
          cadence: effectiveCadence,
          timezone: outreach.timezone || 'America/Los_Angeles',
          morningHour: outreach.morningHour,
          middayHour: outreach.middayHour,
          nightHour: outreach.nightHour,
          composed,
          recipientFirstName: resolvedFirstName,
        })
      : await sendOutreachEmail({
          to: outreach.email,
          uid: params.uid,
          cadence: effectiveCadence,
          composed,
        });
    if (emailRes.success) anySent = true;
    else if (emailRes.error) errors.push(`email:${emailRes.error}`);
  }

  if (
    (outreach.channel === 'discord' || outreach.channel === 'both') &&
    (outreach.discordUserId || outreach.discordChannelId)
  ) {
    const discordRes = await sendOutreachDiscordDM({
      uid: params.uid,
      discordUserId: outreach.discordUserId,
      discordChannelId: outreach.discordChannelId,
      cadence: effectiveCadence,
      composed,
    });
    if (discordRes.success) {
      anySent = true;
      if (discordRes.resolvedChannelId) {
        cachedDiscordChannelId = discordRes.resolvedChannelId;
      }
    } else if (discordRes.error) {
      errors.push(`discord:${discordRes.error}`);
    }
  }

  if (!anySent) {
    if (!params.force) {
      await Promise.all([
        lockRef.delete().catch(() => undefined),
        settingsRef
          .set(
            {
              outreach: adminHealthService.deepClean({
                ...outreach,
                cadence: effectiveCadence,
                lastDispatchedKey: previousDispatchedKey ?? FieldValue.delete(),
              }),
            },
            { merge: true },
          )
          .catch(() => undefined),
      ]);
    }
    return {
      status: 'failed',
      reason: errors.join('; ') || 'No configured delivery channel succeeded',
      composed,
    };
  }

  await Promise.all([
    !params.force
      ? lockRef.set({ status: 'sent', sentAtMs: Date.now() }, { merge: true })
      : Promise.resolve(),
    settingsRef.set(
      {
        outreach: adminHealthService.deepClean({
          ...outreach,
          cadence: effectiveCadence,
          discordChannelId: cachedDiscordChannelId,
          lastDispatchedKey: dispatchKey,
        }),
      },
      { merge: true },
    ),
  ]);

  const windowTitle = params.isWelcome
    ? 'A New Journey'
    : params.window === 'morning'
      ? 'Morning Check-In'
      : params.window === 'midday'
        ? 'Afternoon Check-In'
        : 'Evening Check-In';
  const channelBadge =
    outreach.channel === 'both'
      ? 'Email + Discord'
      : outreach.channel === 'discord'
        ? 'Discord'
        : 'Email';

  await appendOutreachTranscript(params.uid, clock.localDate, [
    {
      role: 'model',
      content: `**[${windowTitle} · ${channelBadge}]** **${composed.headline}**\n\n${composed.body}`,
      ts: Date.now(),
    },
  ]);

  return { status: 'sent', composed };
}

/**
 * Executes a 1-tap Email, Live Coaster, or Discord quick action and returns updated status.
 */
export async function executeOutreachQuickAction(params: {
  uid: string;
  action: OutreachActionType;
  date?: string;
  window?: OutreachWindow;
  foodId?: string;
  cadence?: OutreachCadence;
  nonce?: string;
}): Promise<{
  title: string;
  detail: string;
  updatedHeadline?: string;
  updatedBody?: string;
  loggedFoodId?: string;
  loggedUnits?: number;
  swapSuggestion?: string;
}> {
  const db = getAdminFirestore();
  const prefs = await adminHealthService.getUserPreferences(db, params.uid);
  const outreach = prefs?.outreach;
  const clock = resolveLocalClock(new Date(), outreach?.timezone);
  const targetDate = params.date || clock.localDate;

  // 1. Control actions (unsubscribe, pause, resume, set_cadence)
  if (params.action === 'unsubscribe') {
    await db.doc(`users/${params.uid}/preferences/settings`).set(
      {
        outreach: {
          ...(outreach ?? {
            timezone: clock.timezone,
            morningHour: 9,
            middayHour: 13,
            nightHour: 19,
            channel: 'email',
            cadence: '2x',
          }),
          enabled: false,
          cadence: 'pause',
        },
      },
      { merge: true },
    );
    await adminHealthService.updateHealthData(db, params.uid, { outreachEnabled: false });
    return {
      title: 'Check-Ins Unsubscribed',
      detail: 'Your scheduled Sunny · Coaster emails are turned off. Come back whenever you like.',
    };
  }

  if (params.action === 'pause' || params.action === 'pause_7d') {
    const resumeDate = addIsoDays(clock.localDate, 7);
    await db.doc(`users/${params.uid}/preferences/settings`).set(
      {
        outreach: {
          ...(outreach ?? {}),
          enabled: true,
          pausedUntilDate: resumeDate,
          lastInteractionDate: clock.localDate,
        },
      },
      { merge: true },
    );
    return {
      title: 'Check-Ins Paused for 7 Days',
      detail: `Sunny snoozed your check-ins through ${resumeDate} and will pick back up gently after that.`,
    };
  }

  if (params.action === 'resume' || params.action === 'resume_3x') {
    const restoredCadence: OutreachCadence =
      params.action === 'resume_3x'
        ? '3x'
        : outreach?.cadence && outreach.cadence !== 'pause'
          ? outreach.cadence
          : '2x';
    await db.doc(`users/${params.uid}/preferences/settings`).set(
      {
        outreach: {
          ...(outreach ?? {}),
          enabled: true,
          cadence: restoredCadence,
          pausedUntilDate: FieldValue.delete(),
          autoDownshiftedAt: FieldValue.delete(),
          autoPausedAt: FieldValue.delete(),
          lastInteractionDate: clock.localDate,
        },
      },
      { merge: true },
    );
    await adminHealthService.updateHealthData(db, params.uid, { outreachEnabled: true });
    const { composed } = await buildLiveUserOutreach({ uid: params.uid });
    return {
      title: 'Coaster Check-Ins Resumed',
      detail: `Sunny is back on your ${restoredCadence} check-in rhythm.`,
      updatedHeadline: composed.headline,
      updatedBody: composed.body,
    };
  }

  if (params.action === 'set_cadence' || params.action === 'morning_only') {
    const nextCadence: OutreachCadence =
      params.action === 'morning_only' ? 'daily' : params.cadence ?? '2x';
    const nextEnabled = nextCadence !== 'pause';
    await db.doc(`users/${params.uid}/preferences/settings`).set(
      {
        outreach: {
          ...(outreach ?? {}),
          enabled: nextEnabled,
          cadence: nextCadence,
          pausedUntilDate: FieldValue.delete(),
          lastInteractionDate: clock.localDate,
        },
      },
      { merge: true },
    );
    await adminHealthService.updateHealthData(db, params.uid, { outreachEnabled: nextEnabled });
    const cadenceLabel =
      nextCadence === '2x'
        ? 'Morning & Evening (2x/day)'
        : nextCadence === 'daily' || nextCadence === 'morning_only'
          ? 'Daily Morning (1x/day)'
          : nextCadence === 'weekly'
            ? 'Weekly Sunday Recap'
            : 'Paused';
    return {
      title: `Schedule Updated: ${cadenceLabel}`,
      detail: `Your Coaster check-in cadence is now ${cadenceLabel}.`,
    };
  }

  // 2. Undo / confirm pending
  if (params.action === 'undo' || params.action === 'undo_food') {
    let targetFoodId = params.foodId;
    if (!targetFoodId) {
      const todayLogs = await adminHealthService.queryFoodLog(db, params.uid, targetDate, 30);
      const latest = todayLogs[todayLogs.length - 1];
      targetFoodId = latest?.id;
    }

    if (targetFoodId) {
      await db
        .doc(`users/${params.uid}/food_log/${targetFoodId}`)
        .set({ ignored: true }, { merge: true });
      await refreshDailyFoodCounters(params.uid, targetDate);
    }

    const { composed } = await buildLiveUserOutreach({ uid: params.uid });
    const nowTs = Date.now();
    await appendOutreachTranscript(params.uid, targetDate, [
      { role: 'user', content: 'Undo coaster entry (1-tap)', ts: nowTs },
      {
        role: 'model',
        content: `Removed that pour from your coaster.\n\n**${composed.headline}** — ${composed.body}`,
        ts: nowTs + 1,
      },
    ]);
    return {
      title: targetFoodId ? 'Removed Entry' : 'Nothing Left to Undo',
      detail: targetFoodId
        ? `Updated your coaster · Today ${formatUnits(composed.todayUnits)} · 7d avg ${formatUnits(composed.sevenDayAvg)}/day.`
        : 'Your coaster had no recent entry to remove.',
      updatedHeadline: composed.headline,
      updatedBody: composed.body,
    };
  }

  if (params.action === 'confirm_pending' && params.foodId) {
    await db
      .doc(`users/${params.uid}/food_log/${params.foodId}`)
      .set({ pendingConfirmation: false }, { merge: true });
    const { composed } = await buildLiveUserOutreach({ uid: params.uid });
    return {
      title: 'Entry Confirmed',
      detail: `Confirmed on your coaster · Today ${formatUnits(composed.todayUnits)}.`,
      updatedHeadline: composed.headline,
      updatedBody: composed.body,
      loggedFoodId: params.foodId,
    };
  }

  // Record user engagement so auto-sunset stays fresh
  await db.doc(`users/${params.uid}/preferences/settings`).set(
    {
      outreach: {
        ...(outreach ?? {}),
        lastInteractionDate: clock.localDate,
        autoDownshiftedAt: FieldValue.delete(),
      },
    },
    { merge: true },
  );

  // 3. Coaster 1-tap drink presets (nonce allows intentional repeat pours on Live Coaster!)
  const safeNonce = params.nonce ? `_${params.nonce}` : '';
  const actionKey = `${targetDate}_${params.window ?? 'tap'}_${params.action}${safeNonce}`.replace(
    /[^a-zA-Z0-9_-]/g,
    '_',
  );
  const receiptRef = db.doc(`users/${params.uid}/outreach_actions/${actionKey}`);
  const existingReceipt = await receiptRef.get();

  let loggedFoodId: string | undefined;
  let loggedSummary = 'Updated your Coaster check-in.';
  let newlyLoggedLabel: string | undefined;
  let loggedUnits: number | undefined;
  let swapSuggestion: string | undefined;

  if (existingReceipt.exists) {
    const data = existingReceipt.data() as
      | { foodId?: string; summary?: string; units?: number; swapSuggestion?: string }
      | undefined;
    loggedFoodId = data?.foodId;
    loggedUnits = data?.units;
    swapSuggestion = data?.swapSuggestion;
    loggedSummary = data?.summary || 'Already recorded on your coaster.';
  } else if (params.action in DRINK_PRESETS) {
    const preset = DRINK_PRESETS[params.action];
    const start30Iso = addIsoDays(targetDate, -29);
    const recent30 = (await adminHealthService.queryLogRangeAll(
      db,
      params.uid,
      'food_log',
      start30Iso,
      targetDate,
    )) as unknown as CoasterFoodLogEntry[];

    const alcoholicCountBefore = recent30.filter(
      (e) => !e.ignored && !isClearDayEntry(e) && !isZeroProofEntry(e) && getEntryUnits(e) > 0,
    ).length;

    if (
      !preset.isZeroProof &&
      !preset.isClearDay &&
      shouldSuggestAlternative(alcoholicCountBefore + 1)
    ) {
      swapSuggestion = pickZeroProofAlternative(preset.category, alcoholicCountBefore + 1);
    }

    const entryPayload = {
      foodName: preset.shortLabel,
      name: preset.shortLabel,
      portionG: Math.round((preset.volumeOz || 0) * 29.57),
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      fiberG: 0,
      alcoholDrinks: preset.standardUnits,
      standardUnits: preset.standardUnits,
      drinkCategory: preset.category,
      volumeOz: preset.volumeOz,
      abvPct: preset.abvPct,
      isZeroProof: preset.isZeroProof,
      isClearDay: Boolean(preset.isClearDay),
      ...(swapSuggestion ? { alternativeSuggested: swapSuggestion } : {}),
      source: 'user_estimate' as const,
      meal: inferMealFromTime(clock.localTime),
      consumedAt: clock.localTime,
      date: targetDate,
    };

    // Use direct write when nonce is supplied so a 2nd "+1.0u Beer" tap never squashes Pour #1
    loggedFoodId = params.nonce
      ? await writeDirectFoodEntry(params.uid, entryPayload)
      : await adminHealthService.logFood(db, params.uid, entryPayload as unknown as Omit<FoodLogEntry, 'timestamp'>);

    loggedUnits = preset.standardUnits;
    newlyLoggedLabel = preset.shortLabel;
    loggedSummary = preset.isClearDay
      ? 'Logged Clear Day (0.0u).'
      : preset.isZeroProof
        ? `Logged ${preset.shortLabel} (0.0u zero-proof swap).`
        : `Logged ${preset.shortLabel} (${formatUnits(preset.standardUnits)}).`;

    await receiptRef.set({
      foodId: loggedFoodId,
      units: preset.standardUnits,
      ...(swapSuggestion ? { swapSuggestion } : {}),
      summary: loggedSummary,
      createdAt: FieldValue.serverTimestamp(),
    });
    await refreshDailyFoodCounters(params.uid, targetDate);
  } else if (params.action === 'still_fasting' || params.action === 'kitchen_closed') {
    // Legacy compatibility -> treat cleanly as Clear Day check-in
    loggedSummary = 'Confirmed 0.0u Clear Day check-in.';
  } else if (params.action in LEGACY_PRESET_MEALS) {
    const preset = LEGACY_PRESET_MEALS[params.action as keyof typeof LEGACY_PRESET_MEALS];
    loggedFoodId = await adminHealthService.logFood(db, params.uid, {
      ...preset,
      source: 'user_estimate',
      meal: inferMealFromTime(clock.localTime),
      consumedAt: `${targetDate}T${clock.localTime}:00`,
      date: targetDate,
    });
    newlyLoggedLabel = preset.name;
    loggedSummary = `Recorded ${preset.name}.`;
  }

  const { composed } = await buildLiveUserOutreach({ uid: params.uid });

  if (newlyLoggedLabel) {
    const nowTs = Date.now();
    await appendOutreachTranscript(params.uid, targetDate, [
      {
        role: 'user',
        content: `Logged ${newlyLoggedLabel} (1-tap Coaster)`,
        ts: nowTs,
      },
      {
        role: 'model',
        content: `${loggedSummary}${swapSuggestion ? ` Zero-proof idea if you want a cold swap next: ${swapSuggestion}.` : ''}\n\n**${composed.headline}** — ${composed.body}`,
        ts: nowTs + 1,
      },
    ]);
  }

  return {
    title: newlyLoggedLabel ? `Tallied: ${newlyLoggedLabel}` : 'Coaster Updated',
    detail: `${loggedSummary} Today ${formatUnits(composed.todayUnits)} · 7d avg ${formatUnits(composed.sevenDayAvg)}/day.${swapSuggestion ? ` Booth pick: ${swapSuggestion}` : ''}`,
    updatedHeadline: composed.headline,
    updatedBody: composed.body,
    loggedFoodId,
    loggedUnits,
    ...(swapSuggestion ? { swapSuggestion } : {}),
  };
}

/**
 * Processes an inbound plain-English or photo reply from Email or Discord using
 * Sunny's Coaster parser (`CFO_LITE_MODEL` with automatic fallback).
 */
export async function processOutreachFreeTextMeal(params: {
  uid: string;
  rawText: string;
  photoDataUris?: OutreachImageAttachment[];
  now?: Date;
}): Promise<{
  status: 'logged' | 'replied' | 'stopped' | 'cap_reached' | 'unrecognized';
  headline: string;
  detail: string;
  agentReply?: string;
  lastFoodLine?: string;
  loggedFoodId?: string;
  loggedMealName?: string;
  loggedUnits?: number;
  todayUnits?: number;
  sevenDayAvg?: number;
  alternativeSuggested?: string;
  isClearDay?: boolean;
  isZeroProof?: boolean;
  loggedMacros?: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    portionG: number;
  };
  updatedHeadline?: string;
  updatedBody?: string;
  metricsLine?: string;
  statusTone?: 'good' | 'soon' | 'urgent';
  localDate?: string;
}> {
  const db = getAdminFirestore();
  const [health, prefs] = await Promise.all([
    adminHealthService.getHealthSummary(db, params.uid),
    adminHealthService.getUserPreferences(db, params.uid),
  ]);

  const outreach = prefs?.outreach;
  const clock = resolveLocalClock(params.now ?? new Date(), outreach?.timezone);

  const isFoundingFriend = Boolean(
    (prefs as unknown as { foundingFriend?: boolean })?.foundingFriend,
  );
  const isExempt =
    isFoundingFriend ||
    health?.entitlementTier === 'founder' ||
    health?.entitlementTier === 'vip' ||
    health?.entitlementTier === 'pro' ||
    (outreach?.email ? FOUNDER_EMAILS.has(outreach.email.toLowerCase()) : false);

  const usedToday =
    outreach?.dailyParseDate === clock.localDate ? (outreach?.dailyParseCount ?? 0) : 0;

  if (!isExempt && usedToday >= MAX_FREE_OUTREACH_PARSES_PER_DAY) {
    return {
      status: 'cap_reached',
      headline: `Daily Free-Text Quick-Log Limit Reached (${MAX_FREE_OUTREACH_PARSES_PER_DAY}/day)`,
      detail:
        'You can still use any 1-tap drink button in your check-in email or Live Coaster link anytime.',
    };
  }

  const yesterdayIso = addIsoDays(clock.localDate, -1);
  const start30Iso = addIsoDays(clock.localDate, -29);
  const [todayFoodsBeforeParse, yesterdayFoodsBeforeParse, recent30] = await Promise.all([
    adminHealthService.queryFoodLog(db, params.uid, clock.localDate, 50),
    adminHealthService.queryFoodLog(db, params.uid, yesterdayIso, 50),
    adminHealthService.queryLogRangeAll(db, params.uid, 'food_log', start30Iso, clock.localDate),
  ]);

  const alcoholicLogCount = (recent30 as unknown as CoasterFoodLogEntry[]).filter(
    (e) => !e.ignored && !isClearDayEntry(e) && !isZeroProofEntry(e) && getEntryUnits(e) > 0,
  ).length;

  const clientDisplayName =
    ((prefs as unknown as { profile?: { title?: string; displayName?: string } })?.profile?.title ||
      (prefs as unknown as { profile?: { displayName?: string } })?.profile?.displayName ||
      (health as unknown as { displayName?: string })?.displayName ||
      undefined);

  const mapContext = (f: CoasterFoodLogEntry) => ({
    id: f.id,
    name: f.foodName || (f as FoodLogEntry).name || '',
    standardUnits: getEntryUnits(f),
    alcoholDrinks: getEntryUnits(f),
    drinkCategory: f.drinkCategory,
    isClearDay: isClearDayEntry(f),
    isZeroProof: isZeroProofEntry(f),
    consumedAt: f.consumedAt,
  });

  const parsed = await parseOutreachMealText({
    uid: params.uid,
    rawText: params.rawText,
    localTime: clock.localTime,
    photoDataUris: params.photoDataUris,
    todayFoods: (todayFoodsBeforeParse as CoasterFoodLogEntry[]).map(mapContext),
    yesterdayFoods: (yesterdayFoodsBeforeParse as CoasterFoodLogEntry[]).map(mapContext),
    clientDisplayName,
    alcoholicLogCount,
  });

  if (parsed.isStopCommand) {
    await executeOutreachQuickAction({ uid: params.uid, action: 'unsubscribe' });
    return {
      status: 'stopped',
      headline: 'Check-Ins Paused',
      detail: 'Sunny unsubscribed you from scheduled check-in emails. Say hi anytime to resume.',
      agentReply: parsed.agentReply,
    };
  }

  if (parsed.removeFoodId) {
    const matchedYesterday = yesterdayFoodsBeforeParse.some((f) => f.id === parsed.removeFoodId);
    const undoRes = await executeOutreachQuickAction({
      uid: params.uid,
      action: 'undo',
      foodId: parsed.removeFoodId,
      date: matchedYesterday ? yesterdayIso : clock.localDate,
    });
    return {
      status: 'replied',
      headline: undoRes.updatedHeadline || undoRes.title,
      detail: parsed.agentReply || undoRes.detail,
      agentReply: parsed.agentReply || undoRes.detail,
      updatedHeadline: undoRes.updatedHeadline,
      updatedBody: undoRes.updatedBody,
      localDate: clock.localDate,
    };
  }

  if (
    parsed.scheduleMorningHour !== undefined ||
    parsed.scheduleMiddayHour !== undefined ||
    parsed.scheduleNightHour !== undefined ||
    parsed.scheduleCadence !== undefined ||
    parsed.scheduleTimezone !== undefined
  ) {
    await saveUserOutreachSettings({
      uid: params.uid,
      outreach: {
        ...(outreach ?? {}),
        enabled: parsed.scheduleCadence !== 'pause',
        ...(parsed.scheduleMorningHour !== undefined
          ? { morningHour: parsed.scheduleMorningHour }
          : {}),
        ...(parsed.scheduleMiddayHour !== undefined
          ? { middayHour: parsed.scheduleMiddayHour }
          : {}),
        ...(parsed.scheduleNightHour !== undefined ? { nightHour: parsed.scheduleNightHour } : {}),
        ...(parsed.scheduleCadence !== undefined ? { cadence: parsed.scheduleCadence } : {}),
        ...(parsed.scheduleTimezone ? { timezone: parsed.scheduleTimezone } : {}),
      },
    });
  }

  const entriesToLog =
    parsed.entries && parsed.entries.length > 0
      ? parsed.entries.filter((e) => e && e.name?.trim())
      : parsed.isFoodLog && parsed.name?.trim()
        ? [
            {
              name: parsed.name.trim(),
              drinkCategory: parsed.drinkCategory,
              volumeOz: parsed.volumeOz,
              abvPct: parsed.abvPct,
              standardUnits: parsed.standardUnits,
              isZeroProof: parsed.isZeroProof,
              isClearDay: parsed.isClearDay,
              alternativeSuggested: parsed.alternativeSuggested,
              portionG: parsed.portionG ?? 0,
              calories: parsed.calories ?? 0,
              proteinG: parsed.proteinG ?? 0,
              carbsG: parsed.carbsG ?? 0,
              fatG: parsed.fatG ?? 0,
              fiberG: parsed.fiberG,
              plantMassG: parsed.plantMassG,
              alcoholDrinks: parsed.alcoholDrinks,
              dayOffset: parsed.dayOffset ?? 0,
              consumedAt: parsed.consumedAt || clock.localTime,
              meal: parsed.meal,
              source: parsed.source,
            },
          ]
        : [];

  if (!parsed.isFoodLog || entriesToLog.length === 0) {
    const { composed } = await buildLiveUserOutreach({ uid: params.uid });
    const replyLine =
      parsed.agentReply ||
      'Tell me what you poured in plain English — or snap a tap list, can, or receipt — and Sunny will put it on your coaster.';
    return {
      status: parsed.agentReply ? 'replied' : 'unrecognized',
      headline: composed.headline,
      detail: replyLine,
      agentReply: replyLine,
      lastFoodLine: composed.lastFoodLine,
      todayUnits: composed.todayUnits,
      sevenDayAvg: composed.sevenDayAvg,
      updatedHeadline: composed.headline,
      updatedBody: composed.body,
      metricsLine: composed.metricsLine,
      statusTone: composed.statusTone,
      localDate: clock.localDate,
    };
  }

  const isAddingAnother = /\b(another|second|third|one more|another round|refill)\b/i.test(
    params.rawText,
  );
  const loggedIds: string[] = [];
  const loggedDateSet = new Set<string>();
  const entryLabels: string[] = [];

  for (const item of entriesToLog) {
    const isYesterday = Boolean(item.dayOffset && item.dayOffset < 0);
    const targetDate = isYesterday ? yesterdayIso : clock.localDate;
    const resolvedTime = item.consumedAt || (isYesterday ? '20:30' : clock.localTime);
    const units =
      item.isClearDay || item.isZeroProof
        ? 0
        : Math.max(0, Math.round((item.standardUnits ?? item.alcoholDrinks ?? 0) * 10) / 10);

    const entryRecord = {
      foodName: item.name,
      name: item.name,
      portionG: Math.max(0, Math.round(item.portionG || (item.volumeOz ? item.volumeOz * 29.57 : 0))),
      calories: Math.max(0, Math.round(item.calories || 0)),
      proteinG: Math.max(0, Math.round(item.proteinG || 0)),
      carbsG: Math.max(0, Math.round(item.carbsG || 0)),
      fatG: Math.max(0, Math.round(item.fatG || 0)),
      fiberG: Math.max(0, Math.round(item.fiberG || 0)),
      alcoholDrinks: units,
      standardUnits: units,
      drinkCategory: (item.drinkCategory ??
        (item.isClearDay ? 'clear_day' : item.isZeroProof ? 'zero_proof' : 'other')) as DrinkCategory,
      volumeOz: item.volumeOz,
      abvPct: item.abvPct,
      isZeroProof: Boolean(item.isZeroProof),
      isClearDay: Boolean(item.isClearDay),
      ...(parsed.alternativeSuggested ? { alternativeSuggested: parsed.alternativeSuggested } : {}),
      source: (item.source ?? parsed.source ?? 'user_estimate') as 'usda' | 'user_estimate',
      meal: (item.meal ?? inferMealFromTime(resolvedTime)) as
        | 'breakfast'
        | 'lunch'
        | 'dinner'
        | 'snack',
      consumedAt: resolvedTime,
      date: targetDate,
    };

    const id = isAddingAnother
      ? await writeDirectFoodEntry(params.uid, entryRecord)
      : await adminHealthService.logFood(db, params.uid, entryRecord as unknown as Omit<FoodLogEntry, 'timestamp'>);
    loggedIds.push(id);
    loggedDateSet.add(targetDate);
    entryLabels.push(isYesterday ? `${item.name} (Yesterday)` : item.name);
  }

  const primaryFoodId = loggedIds[loggedIds.length - 1];
  const combinedLabel = entryLabels.join(' · ');

  await db.doc(`users/${params.uid}/preferences/settings`).set(
    {
      outreach: {
        ...(outreach ?? {}),
        lastInteractionDate: clock.localDate,
        dailyParseDate: clock.localDate,
        dailyParseCount: usedToday + 1,
      },
    },
    { merge: true },
  );

  if (loggedDateSet.has(yesterdayIso) && !loggedDateSet.has(clock.localDate)) {
    await refreshDailyFoodCounters(params.uid, yesterdayIso);
  }
  await refreshDailyFoodCounters(params.uid, clock.localDate);
  const { composed } = await buildLiveUserOutreach({ uid: params.uid });

  const totalLoggedUnits =
    Math.round(
      entriesToLog.reduce(
        (s, e) => s + (e.isClearDay || e.isZeroProof ? 0 : e.standardUnits ?? e.alcoholDrinks ?? 0),
        0,
      ) * 10,
    ) / 10;

  const roundedMacros = {
    portionG: Math.max(0, Math.round(entriesToLog.reduce((s, e) => s + (e.portionG || 0), 0))),
    calories: Math.max(0, Math.round(entriesToLog.reduce((s, e) => s + (e.calories || 0), 0))),
    proteinG: Math.max(0, Math.round(entriesToLog.reduce((s, e) => s + (e.proteinG || 0), 0))),
    carbsG: Math.max(0, Math.round(entriesToLog.reduce((s, e) => s + (e.carbsG || 0), 0))),
    fatG: Math.max(0, Math.round(entriesToLog.reduce((s, e) => s + (e.fatG || 0), 0))),
  };

  const hasAttachedPhotos = (params.photoDataUris?.length ?? 0) > 0;
  const cleanUserMessage =
    extractCleanReplyText(params.rawText) ||
    (hasAttachedPhotos ? `[Attached drink/menu photo: ${combinedLabel}]` : params.rawText.trim());
  const nowTs = Date.now();
  const unitBadge = parsed.isClearDay
    ? 'Clear Day · 0.0u'
    : parsed.isZeroProof
      ? 'Zero-Proof · 0.0u'
      : formatUnits(totalLoggedUnits);

  await appendOutreachTranscript(params.uid, clock.localDate, [
    {
      role: 'user',
      content: cleanUserMessage,
      ...(hasAttachedPhotos ? { hasImages: true } : {}),
      ts: nowTs,
    },
    {
      role: 'model',
      content: `**Logged ${combinedLabel}** (${unitBadge}).${parsed.agentReply ? ` ${parsed.agentReply}` : ''}${parsed.alternativeSuggested ? `\n\n_Zero-proof pick: ${parsed.alternativeSuggested}_` : ''}`,
      ts: nowTs + 1,
    },
  ]);

  return {
    status: 'logged',
    headline: `Tallied: ${combinedLabel} (${unitBadge})`,
    detail: `Today ${formatUnits(composed.todayUnits)} · 7d avg ${formatUnits(composed.sevenDayAvg)}/day · ${composed.clearDaysLast30} clear days in 30d.`,
    agentReply: parsed.agentReply,
    lastFoodLine: composed.lastFoodLine,
    loggedFoodId: primaryFoodId,
    loggedMealName: combinedLabel,
    loggedUnits: totalLoggedUnits,
    todayUnits: composed.todayUnits,
    sevenDayAvg: composed.sevenDayAvg,
    alternativeSuggested: parsed.alternativeSuggested,
    isClearDay: Boolean(parsed.isClearDay),
    isZeroProof: Boolean(parsed.isZeroProof),
    loggedMacros: roundedMacros,
    updatedHeadline: composed.headline,
    updatedBody: composed.body,
    metricsLine: composed.metricsLine,
    statusTone: composed.statusTone,
    localDate:
      loggedDateSet.size === 1 && loggedDateSet.has(yesterdayIso)
        ? yesterdayIso
        : clock.localDate,
  };
}
