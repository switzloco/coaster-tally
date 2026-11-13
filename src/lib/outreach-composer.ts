/**
 * @fileOverview Zero-AI deterministic composer for Sunny · Coaster Morning/Evening
 * check-ins (Email & Discord).
 *
 * Strictly zero judgment, zero scoring, zero lectures. Uses NIAAA Standard Drink
 * Units (`1.0u = 14g ethanol = 0.6 fl oz pure ethanol`) and surface-ready 1-tap buttons.
 */

import {
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
  type OutreachWindow,
} from './health-service';
import { addIsoDays, diffIsoDays, type OutreachActionType } from './outreach-auth';

export const SILENT_DAYS_TO_MORNING_ONLY = 3;
export const SILENT_DAYS_TO_AUTO_PAUSE = 7;

export interface QuickActionButton {
  action: OutreachActionType;
  label: string;
  style: 'primary' | 'secondary';
}

export interface ComposedOutreachMessage {
  window: OutreachWindow;
  localDate: string;
  statusTone: 'good' | 'soon' | 'urgent';
  subject: string;
  headline: string;
  body: string;
  lastFoodLine: string;
  metricsLine: string;
  quickActions: QuickActionButton[];
  autoSunsetBanner?: string;
  // Coaster summary telemetry
  todayUnits: number;
  yesterdayUnits: number;
  sevenDayTotal: number;
  sevenDayAvg: number;
  thirtyDayTotal: number;
  clearDaysLast30: number;
  zeroProofLast30: number;
  swapSuggestion?: string;
  // Backward-compatible optional fields retained for shared Discord adapters
  eatByLabel?: string;
  goodFromYesterday?: boolean;
  safeThroughTomorrowMorning?: boolean;
  runway?: Record<string, unknown>;
  vfPreview?: Record<string, unknown>;
}

export interface LastLoggedSummaryItem {
  id?: string;
  name?: string;
  foodName?: string;
  date?: string;
  consumedAt?: string;
  standardUnits?: number;
  alcoholDrinks?: number;
  drinkCategory?: DrinkCategory;
  isClearDay?: boolean;
  isZeroProof?: boolean;
  calories?: number;
  proteinG?: number;
}

export interface ComposeOutreachInput {
  window: OutreachWindow;
  localDate: string;
  localTime?: string;
  hoursElapsed?: number;
  displayName?: string | null;
  cadence?: OutreachCadence;
  recentLogs?: CoasterFoodLogEntry[];
  todayFoods?: CoasterFoodLogEntry[];
  yesterdayFoods?: CoasterFoodLogEntry[];
  todayFoodsCount?: number;
  lastFoodToday?: LastLoggedSummaryItem | null;
  lastFoodYesterday?: LastLoggedSummaryItem | null;
  lastInboundDate?: string | null;
  lastFoodDate?: string | null;
  // Legacy optional properties retained for backward compat
  health?: Record<string, unknown>;
  prefs?: Record<string, unknown>;
  goals?: Record<string, unknown>;
  yesterdaySummary?: Record<string, unknown>;
  todaySummary?: Record<string, unknown>;
  runway?: Record<string, unknown>;
  vfPreview?: Record<string, unknown>;
  todayProteinG?: number;
  todayPlantG?: number;
}

export function buildLastFoodOnRecordLine(params: {
  localDate: string;
  todayFoodsCount?: number;
  lastFoodToday?: LastLoggedSummaryItem | null;
  lastFoodYesterday?: LastLoggedSummaryItem | null;
}): string {
  const describeItem = (item: LastLoggedSummaryItem): string => {
    const label = item.name || item.foodName || 'Pour';
    const rawTime = item.consumedAt || '';
    const timeShort = /^\d{4}-\d{2}-\d{2}T/.test(rawTime) ? rawTime.slice(11, 16) : rawTime.slice(0, 5);
    const timePart = timeShort ? ` at ${timeShort}` : '';
    if (isClearDayEntry(item)) {
      return `Clear Day (0.0u)${timePart}`;
    }
    if (isZeroProofEntry(item)) {
      return `${label} (0.0u zero-proof)${timePart}`;
    }
    const units = getEntryUnits(item);
    return `${label} (${formatUnits(units)})${timePart}`;
  };

  if (params.lastFoodToday) {
    const countLabel =
      typeof params.todayFoodsCount === 'number' && params.todayFoodsCount > 1
        ? ` (${params.todayFoodsCount} entries today)`
        : '';
    return `Last on your coaster today: ${describeItem(params.lastFoodToday)}${countLabel}.`;
  }
  if (params.lastFoodYesterday) {
    return `Nothing logged yet today · Last on your coaster yesterday: ${describeItem(params.lastFoodYesterday)}.`;
  }
  return 'Nothing on your coaster yet today — tap a pour below or reply whenever you like.';
}

export function isWindowAllowedForCadence(params: {
  cadence: OutreachCadence;
  window: OutreachWindow;
  localDate: string;
}): boolean {
  if (params.cadence === 'pause') return false;
  if (params.cadence === '2x') {
    return params.window === 'morning' || params.window === 'night';
  }
  if (params.cadence === 'daily' || params.cadence === 'morning_only') {
    return params.window === 'morning';
  }
  if (params.cadence === 'weekly') {
    if (params.window !== 'morning') return false;
    const [y, m, d] = params.localDate.split('-').map((n) => Number(n));
    if (!y || !m || !d) return true;
    const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return dayOfWeek === 0; // Sundays
  }
  // '3x' legacy cadence
  return true;
}

export function evaluateAutoSunset(params: {
  localDate: string;
  cadence?: OutreachCadence;
  currentCadence?: OutreachCadence;
  lastInboundDate?: string | null;
  lastFoodDate?: string | null;
  lastInteractionDate?: string | null;
}): {
  silentDays: number;
  nextCadence?: OutreachCadence;
  shouldAutoPause: boolean;
  decision: 'none' | 'downshift_to_morning' | 'auto_pause';
  banner?: string;
} {
  const cadence = params.cadence ?? params.currentCadence ?? '2x';
  const latestActivity = [
    params.lastInboundDate,
    params.lastFoodDate,
    params.lastInteractionDate,
  ]
    .filter((d): d is string => Boolean(d && /^\d{4}-\d{2}-\d{2}$/.test(d)))
    .sort()
    .pop();

  if (!latestActivity) {
    return { silentDays: 0, shouldAutoPause: false, decision: 'none' };
  }

  const silentDays = Math.max(0, diffIsoDays(latestActivity, params.localDate));

  if (silentDays >= SILENT_DAYS_TO_AUTO_PAUSE && cadence !== 'pause') {
    return {
      silentDays,
      nextCadence: 'pause',
      shouldAutoPause: true,
      decision: 'auto_pause',
      banner:
        'Check-ins will pause after this note since it has been a quiet week — tap Resume anytime you want Sunny back at the booth.',
    };
  }

  if (
    silentDays >= SILENT_DAYS_TO_MORNING_ONLY &&
    (cadence === '2x' || cadence === '3x')
  ) {
    return {
      silentDays,
      nextCadence: 'daily',
      shouldAutoPause: false,
      decision: 'downshift_to_morning',
      banner:
        'Quiet stretch noticed — shifting gently to 1x daily morning check-ins so your inbox stays breezy.',
    };
  }

  return { silentDays, shouldAutoPause: false, decision: 'none' };
}

export function buildOutreachRunwayContext(params: {
  localDate: string;
  recentLogs?: CoasterFoodLogEntry[];
}): {
  trend: DrinkTrendSummary;
  yesterdayUnits: number;
  yesterdayClearDay: boolean;
} {
  const logs = params.recentLogs ?? [];
  const trend = computeTrendSummary(logs, params.localDate);
  const yesterdayIso = addIsoDays(params.localDate, -1);
  const yesterdayLogs = logs.filter(
    (e) => !e.ignored && getEntryDateKey(e) === yesterdayIso,
  );
  const yesterdayUnits = Math.round(
    yesterdayLogs.reduce((acc, e) => acc + getEntryUnits(e), 0) * 10,
  ) / 10;
  const yesterdayClearDay =
    yesterdayUnits === 0 &&
    (yesterdayLogs.some((e) => isClearDayEntry(e) || isZeroProofEntry(e)) ||
      logs.some((e) => !e.ignored && getEntryDateKey(e) <= yesterdayIso && getEntryDateKey(e) !== ''));

  return {
    trend,
    yesterdayUnits,
    yesterdayClearDay,
  };
}

function getFirstName(displayName?: string | null): string {
  const trimmed = (displayName || '').trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0] || '';
}

function pickRecentAlcoholicCategory(logs: CoasterFoodLogEntry[]): {
  count: number;
  lastCategory?: DrinkCategory;
} {
  const alcoholic = logs.filter(
    (e) => !e.ignored && !isClearDayEntry(e) && !isZeroProofEntry(e) && getEntryUnits(e) > 0,
  );
  const latest = alcoholic[alcoholic.length - 1];
  return {
    count: alcoholic.length,
    lastCategory: latest?.drinkCategory,
  };
}

export function composeOutreachDispatch(input: ComposeOutreachInput): ComposedOutreachMessage {
  const firstName = getFirstName(input.displayName);
  const logs =
    input.recentLogs ??
    [...(input.yesterdayFoods ?? []), ...(input.todayFoods ?? [])];
  const { trend, yesterdayUnits, yesterdayClearDay } = buildOutreachRunwayContext({
    localDate: input.localDate,
    recentLogs: logs,
  });

  const lastTodayFallback =
    input.lastFoodToday ??
    (input.todayFoods && input.todayFoods.length > 0
      ? input.todayFoods[input.todayFoods.length - 1]
      : null);
  const lastYesterdayFallback =
    input.lastFoodYesterday ??
    (input.yesterdayFoods && input.yesterdayFoods.length > 0
      ? input.yesterdayFoods[input.yesterdayFoods.length - 1]
      : null);

  const lastFoodLine = buildLastFoodOnRecordLine({
    localDate: input.localDate,
    todayFoodsCount: input.todayFoodsCount ?? trend.todayEntriesCount,
    lastFoodToday: lastTodayFallback,
    lastFoodYesterday: lastYesterdayFallback,
  });

  const sunset = evaluateAutoSunset({
    localDate: input.localDate,
    cadence: input.cadence ?? '2x',
    lastInboundDate: input.lastInboundDate,
    lastFoodDate: input.lastFoodDate,
  });

  const metricsLine = [
    `Today ${formatUnits(trend.todayUnits)}`,
    `7d avg ${formatUnits(trend.sevenDayAvg)}/day`,
    `30d ${formatUnits(trend.thirtyDayTotal)} (${trend.clearDaysLast30} clear days)`,
  ].join(' · ');

  const alcoholicStats = pickRecentAlcoholicCategory(logs);
  const swapSuggestion = shouldSuggestAlternative(alcoholicStats.count)
    ? pickZeroProofAlternative(alcoholicStats.lastCategory, alcoholicStats.count + logs.length)
    : undefined;

  const greetingName = firstName ? `, ${firstName}` : '';

  if (input.window === 'morning') {
    const yesterdaySummaryText = yesterdayClearDay
      ? 'Yesterday finished as a Clear Day (0.0u).'
      : yesterdayUnits > 0
        ? `Yesterday wrapped at ${formatUnits(yesterdayUnits)}.`
        : 'Fresh coaster slate ready for today.';

    const bodyLines = [
      `Good morning${greetingName}! ${yesterdaySummaryText}`,
      `Your 7-day rolling pace sits at ${formatUnits(trend.sevenDayAvg)}/day, with ${trend.clearDaysLast30} clear days in the past 30 days.`,
      swapSuggestion
        ? `Zero-proof booth idea if you feel like mixing it up today: ${swapSuggestion}.`
        : 'Reply in plain English with anything from last night, snap a receipt, or tap Clear Day 0.0u below.',
    ];

    return {
      window: 'morning',
      localDate: input.localDate,
      statusTone: 'good',
      subject: `Sunny · Coaster Morning — ${yesterdayClearDay ? 'Clear Day yesterday' : yesterdayUnits > 0 ? `${formatUnits(yesterdayUnits)} yesterday` : 'Morning check-in'}`,
      headline: `Morning booth check-in${greetingName}`,
      body: bodyLines.join(' '),
      lastFoodLine,
      metricsLine,
      quickActions: [
        { action: 'log_clear_day', label: 'Clear Day 0.0u', style: 'primary' },
        { action: 'log_beer', label: '+1.0u Beer', style: 'secondary' },
        { action: 'log_wine', label: '+1.0u Wine', style: 'secondary' },
        { action: 'log_cocktail', label: '+1.0u Cocktail/Shot', style: 'secondary' },
        { action: 'log_zero_proof', label: '0.0u Zero-Proof', style: 'secondary' },
      ],
      ...(sunset.banner ? { autoSunsetBanner: sunset.banner } : {}),
      todayUnits: trend.todayUnits,
      yesterdayUnits,
      sevenDayTotal: trend.sevenDayTotal,
      sevenDayAvg: trend.sevenDayAvg,
      thirtyDayTotal: trend.thirtyDayTotal,
      clearDaysLast30: trend.clearDaysLast30,
      zeroProofLast30: trend.zeroProofLast30,
      ...(swapSuggestion ? { swapSuggestion } : {}),
    };
  }

  if (input.window === 'midday') {
    const bodyLines = [
      `Afternoon check-in${greetingName} — your coaster is sitting at ${formatUnits(trend.todayUnits)} so far today.`,
      `7-day rolling average is ${formatUnits(trend.sevenDayAvg)}/day (${trend.clearDaysLast7} clear days this week).`,
      swapSuggestion
        ? `Refreshing patio pick: ${swapSuggestion}.`
        : 'If you grabbed a lunch pint or crisp NA refresher, reply with a quick note or tap below.',
    ];

    return {
      window: 'midday',
      localDate: input.localDate,
      statusTone: 'good',
      subject: `Sunny · Coaster Afternoon — ${formatUnits(trend.todayUnits)} today`,
      headline: `Afternoon booth check-in${greetingName}`,
      body: bodyLines.join(' '),
      lastFoodLine,
      metricsLine,
      quickActions: [
        { action: 'log_zero_proof', label: '0.0u Zero-Proof', style: 'primary' },
        { action: 'log_beer', label: '+1.0u Beer', style: 'secondary' },
        { action: 'log_wine', label: '+1.0u Wine', style: 'secondary' },
        { action: 'log_clear_day', label: 'Clear Day 0.0u', style: 'secondary' },
      ],
      ...(sunset.banner ? { autoSunsetBanner: sunset.banner } : {}),
      todayUnits: trend.todayUnits,
      yesterdayUnits,
      sevenDayTotal: trend.sevenDayTotal,
      sevenDayAvg: trend.sevenDayAvg,
      thirtyDayTotal: trend.thirtyDayTotal,
      clearDaysLast30: trend.clearDaysLast30,
      zeroProofLast30: trend.zeroProofLast30,
      ...(swapSuggestion ? { swapSuggestion } : {}),
    };
  }

  // Night / Evening window (default 7:00 PM)
  const eveningLead =
    trend.todayUnits > 0
      ? `You have ${formatUnits(trend.todayUnits)} on today's coaster so far.`
      : 'Nothing poured on today\'s coaster yet.';
  const bodyLines = [
    `Evening check-in${greetingName}! ${eveningLead}`,
    `Across the past 7 days you're averaging ${formatUnits(trend.sevenDayAvg)}/day, with ${trend.clearDaysLast30} clear days over the last 30 days.`,
    swapSuggestion
      ? `In case you want something cold with zero buzz later tonight: ${swapSuggestion}.`
      : 'Reply with whatever you are sipping (or snap the tap list, wine bottle, or receipt), or hit a 1-tap button below.',
  ];

  return {
    window: 'night',
    localDate: input.localDate,
    statusTone: trend.todayUnits >= 4 ? 'soon' : 'good',
    subject: `Sunny · Coaster Evening — ${trend.todayUnits > 0 ? `${formatUnits(trend.todayUnits)} today` : 'Evening check-in'}`,
    headline: `Evening booth check-in${greetingName}`,
    body: bodyLines.join(' '),
    lastFoodLine,
    metricsLine,
    quickActions: [
      { action: 'log_beer', label: '+1.0u Beer', style: 'primary' },
      { action: 'log_wine', label: '+1.0u Wine', style: 'secondary' },
      { action: 'log_cocktail', label: '+1.0u Cocktail/Shot', style: 'secondary' },
      { action: 'log_zero_proof', label: '0.0u Zero-Proof', style: 'secondary' },
      { action: 'log_clear_day', label: 'Clear Day 0.0u', style: 'secondary' },
    ],
    ...(sunset.banner ? { autoSunsetBanner: sunset.banner } : {}),
    todayUnits: trend.todayUnits,
    yesterdayUnits,
    sevenDayTotal: trend.sevenDayTotal,
    sevenDayAvg: trend.sevenDayAvg,
    thirtyDayTotal: trend.thirtyDayTotal,
    clearDaysLast30: trend.clearDaysLast30,
    zeroProofLast30: trend.zeroProofLast30,
    ...(swapSuggestion ? { swapSuggestion } : {}),
  };
}
