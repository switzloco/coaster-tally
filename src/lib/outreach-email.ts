/**
 * @fileOverview Gmail SMTP (primary, free personal inbox with +coaster@ plus-addressing)
 * + Resend HTTP fallback email transport & HTML template renderer for
 * Sunny · Coaster briefings and "A New Journey" welcome emails.
 */

import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import type { OutreachCadence } from './health-service';
import { formatUnits } from './health-service';
import { signOutreachToken, type OutreachActionType } from './outreach-auth';
import type { ComposedOutreachMessage } from './outreach-composer';
import { SITE_URL } from './site';

export interface GmailOutreachConfig {
  user: string;
  appPassword: string;
  plusReplyTo: string;
}

function getCoasterSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || SITE_URL).replace(/\/+$/, '');
}

/**
 * Resolves Gmail SMTP + Coaster-isolated plus-addressing from env.
 * Uses `${localPart}+coaster@${domain}` so Coaster never crosses streams
 * with any legacy inbox tags.
 */
export function resolveGmailOutreachConfig(): GmailOutreachConfig | null {
  const appPassword = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (appPassword.length < 12) return null;
  const user = (process.env.GMAIL_USER || 'nicholas.switzer@gmail.com').trim().toLowerCase();
  const [localPart, domain = 'gmail.com'] = user.split('@');
  const cleanLocal = localPart.replace(/\+.*$/, '');
  const plusReplyTo = `${cleanLocal}+coaster@${domain}`;
  return { user, appPassword, plusReplyTo };
}

export async function deliverRawOutreachEmail(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
}): Promise<{ success: boolean; provider?: 'gmail' | 'resend'; error?: string }> {
  const gmail = resolveGmailOutreachConfig();

  if (gmail) {
    try {
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          user: gmail.user,
          pass: gmail.appPassword,
        },
      });

      await transporter.sendMail({
        from: process.env.OUTREACH_FROM_EMAIL || `Sunny · Coaster <${gmail.user}>`,
        replyTo: process.env.OUTREACH_REPLY_TO_EMAIL || `Sunny · Coaster <${gmail.plusReplyTo}>`,
        to: params.to,
        subject: params.subject,
        html: params.html,
        ...(params.text ? { text: params.text } : {}),
        ...(params.headers ? { headers: params.headers } : {}),
      });

      return { success: true, provider: 'gmail' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[OutreachEmail] Gmail SMTP send error:', err);
      return { success: false, provider: 'gmail', error: message };
    }
  }

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.OUTREACH_FROM_EMAIL || 'Sunny · Coaster <sunny@coaster.app>';
    const replyTo = process.env.OUTREACH_REPLY_TO_EMAIL || undefined;

    try {
      const { error } = await resend.emails.send({
        from,
        to: params.to,
        ...(replyTo ? { replyTo } : {}),
        subject: params.subject,
        html: params.html,
        ...(params.text ? { text: params.text } : {}),
        ...(params.headers ? { headers: params.headers } : {}),
      });

      if (error) {
        console.error('[OutreachEmail] Resend error:', error);
        return { success: false, provider: 'resend', error: error.message || String(error) };
      }
      return { success: true, provider: 'resend' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[OutreachEmail] Unexpected Resend error:', err);
      return { success: false, provider: 'resend', error: message };
    }
  }

  console.warn('[OutreachEmail] Neither GMAIL_APP_PASSWORD nor RESEND_API_KEY configured — skipping live send.');
  return { success: false, error: 'Neither GMAIL_APP_PASSWORD nor RESEND_API_KEY configured' };
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildOutreachActionUrl(params: {
  uid: string;
  action: OutreachActionType;
  date?: string;
  window?: 'morning' | 'midday' | 'night';
  foodId?: string;
  cadence?: OutreachCadence;
  nonce?: string;
}): string {
  const token = signOutreachToken(params);
  return `${getCoasterSiteUrl()}/api/outreach/action?token=${encodeURIComponent(token)}`;
}

function renderActionButtonsHtml(
  uid: string,
  composed: ComposedOutreachMessage,
): string {
  return composed.quickActions
    .map((btn) => {
      const url = buildOutreachActionUrl({
        uid,
        action: btn.action,
        date: composed.localDate,
        window: composed.window,
      });
      const isPrimary = btn.style === 'primary';
      const bg = isPrimary ? '#C26D2D' : '#F3ECE2';
      const fg = isPrimary ? '#FFFDF9' : '#1F1B18';
      const border = isPrimary ? '#C26D2D' : '#DED2C0';
      return `<a href="${url}" style="display:inline-block;margin:4px 6px 4px 0;padding:10px 15px;border-radius:10px;background:${bg};color:${fg};border:1px solid ${border};font-size:13px;font-weight:700;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${escapeHtml(btn.label)}</a>`;
    })
    .join('');
}

function formatHourLabel(h: number): string {
  const clean = ((Math.round(h) % 24) + 24) % 24;
  if (clean === 0) return '12:00 AM';
  if (clean === 12) return '12:00 PM';
  return clean < 12 ? `${clean}:00 AM` : `${clean - 12}:00 PM`;
}

function describeCadenceSchedule(params: {
  cadence: OutreachCadence;
  timezone: string;
  morningHour?: number;
  middayHour?: number;
  nightHour?: number;
}): string {
  const mLabel = formatHourLabel(params.morningHour ?? 9);
  const dLabel = formatHourLabel(params.middayHour ?? 13);
  const nLabel = formatHourLabel(params.nightHour ?? 19);

  switch (params.cadence) {
    case '2x':
      return `${mLabel} & ${nLabel} (${params.timezone})`;
    case 'daily':
    case 'morning_only':
      return `${mLabel} daily (${params.timezone})`;
    case 'weekly':
      return `Sundays around ${nLabel} (${params.timezone})`;
    case '3x':
      return `${mLabel}, ${dLabel}, and ${nLabel} (${params.timezone})`;
    case 'pause':
      return `Paused (${params.timezone})`;
  }
}

export function renderOutreachEmailHtml(params: {
  uid: string;
  cadence: OutreachCadence;
  composed: ComposedOutreachMessage;
}): { html: string; text: string; unsubscribeUrl: string } {
  const { uid, cadence, composed } = params;

  const tonePalette = {
    good: { bg: '#F2F7F4', border: '#3F7D58', pill: '#3F7D58' },
    soon: { bg: '#FDF5EB', border: '#C26D2D', pill: '#C26D2D' },
    urgent: { bg: '#FDF5EB', border: '#C26D2D', pill: '#9A4E1A' },
  } as const;
  const palette = tonePalette[composed.statusTone] ?? tonePalette.good;

  const unsubscribeUrl = buildOutreachActionUrl({ uid, action: 'unsubscribe' });
  const pauseUrl = buildOutreachActionUrl({ uid, action: 'pause', date: composed.localDate });
  const viewLedgerUrl = buildOutreachActionUrl({ uid, action: 'view_ledger' });
  const isSingleDaily = cadence === 'daily' || cadence === 'morning_only';
  const toggleCadenceUrl = buildOutreachActionUrl({
    uid,
    action: 'set_cadence',
    cadence: isSingleDaily ? '2x' : 'daily',
  });
  const toggleCadenceLabel = isSingleDaily
    ? 'Switch to 2x/day (Morning + Evening)'
    : 'Switch to 1x Daily (Morning only)';

  const actionButtonsHtml = renderActionButtonsHtml(uid, composed);

  const swapBlockHtml = composed.swapSuggestion
    ? `
      <div style="margin:14px 0 0;padding:12px 14px;border-radius:12px;background:#F6EFE5;border:1px solid #E8DFD1;font-size:13px;line-height:1.5;color:#4A3F35;">
        <strong style="color:#9A4E1A;">Sunny's Zero-Proof Booth Pick:</strong> ${escapeHtml(composed.swapSuggestion)}
      </div>`
    : '';

  const sunsetHtml = composed.autoSunsetBanner
    ? `<div style="margin:12px 0 0;padding:10px 14px;border-radius:10px;background:#FDF5EB;border:1px solid #E9C89B;font-size:12px;color:#7C4618;">${escapeHtml(composed.autoSunsetBanner)}</div>`
    : '';

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(composed.subject)}</title>
  </head>
  <body style="margin:0;padding:20px 12px;background:#FAF6F0;color:#1F1B18;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#FFFDF9;border:1px solid #E8DFD1;border-radius:18px;overflow:hidden;box-shadow:0 6px 24px rgba(64,45,25,0.06);">
      <div style="padding:18px 22px;background:#F5EFE6;border-bottom:1px solid #E8DFD1;">
        <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#9A4E1A;">Sunny · Coaster &middot; ${escapeHtml(composed.localDate)}</div>
        <h1 style="margin:6px 0 0;font-size:20px;line-height:1.3;color:#1F1B18;">${escapeHtml(composed.headline)}</h1>
      </div>

      <div style="padding:20px 22px;">
        <div style="padding:14px 16px;border-radius:12px;background:${palette.bg};border:1px solid ${palette.border};font-size:15px;line-height:1.6;color:#1F1B18;">
          ${escapeHtml(composed.body)}
        </div>

        <div style="margin:14px 0 0;padding:11px 14px;border-radius:10px;background:#FAF6F0;border:1px solid #E8DFD1;font-size:13px;color:#4A3F35;">
          <strong style="color:#1F1B18;">Coaster tally:</strong> ${escapeHtml(composed.metricsLine)}
        </div>

        <p style="margin:12px 0 0;font-size:13px;color:#6E6359;">
          ${escapeHtml(composed.lastFoodLine)}
        </p>

        ${swapBlockHtml}

        <div style="margin:18px 0 0;">
          <div style="font-size:11px;font-weight:800;letter-spacing:0.07em;text-transform:uppercase;color:#6E6359;margin-bottom:8px;">1-Tap Pour Check-In</div>
          <div>${actionButtonsHtml}</div>
        </div>

        <div style="margin:16px 0 0;">
          <a href="${viewLedgerUrl}" style="display:inline-block;padding:11px 18px;border-radius:10px;background:#1F1B18;color:#FFFDF9;font-size:13px;font-weight:700;text-decoration:none;">Open Live Coaster &amp; Trends &rarr;</a>
        </div>

        ${sunsetHtml}

        <p style="margin:18px 0 0;font-size:13px;line-height:1.55;color:#6E6359;">
          Or simply <strong style="color:#1F1B18;">reply to this email</strong> in plain English (<em>&ldquo;2 hazy IPAs at trivia&rdquo;</em>, <em>&ldquo;5oz pinot&rdquo;</em>, <em>&ldquo;Clear day&rdquo;</em>) or attach a photo of a bar receipt, tap list, bottle, or can.
        </p>
      </div>

      <div style="padding:14px 22px;background:#FAF6F0;border-top:1px solid #E8DFD1;font-size:12px;color:#6E6359;line-height:1.7;">
        <a href="${viewLedgerUrl}" style="color:#9A4E1A;font-weight:700;text-decoration:underline;">Live Coaster &amp; Trends</a>
        &nbsp;&middot;&nbsp;
        <a href="${toggleCadenceUrl}" style="color:#6E6359;text-decoration:underline;">${escapeHtml(toggleCadenceLabel)}</a>
        &nbsp;&middot;&nbsp;
        <a href="${pauseUrl}" style="color:#6E6359;text-decoration:underline;">Pause Check-ins</a>
        &nbsp;&middot;&nbsp;
        <a href="${unsubscribeUrl}" style="color:#6E6359;text-decoration:underline;">Unsubscribe</a>
      </div>
    </div>
  </body>
</html>`;

  const textLines = [
    `Sunny · Coaster (${composed.localDate})`,
    composed.headline,
    '',
    composed.body,
    '',
    `Tally: ${composed.metricsLine}`,
    composed.lastFoodLine,
    ...(composed.swapSuggestion ? ['', `Sunny's Zero-Proof Pick: ${composed.swapSuggestion}`] : []),
    '',
    '1-Tap Check-In Links:',
    ...composed.quickActions.map(
      (btn) =>
        `- ${btn.label}: ${buildOutreachActionUrl({
          uid,
          action: btn.action,
          date: composed.localDate,
          window: composed.window,
        })}`,
    ),
    '',
    `Open Live Coaster & Trends: ${viewLedgerUrl}`,
    `Reply directly in plain English or attach a photo of your drink, tap list, or receipt.`,
    '',
    `Pause check-ins: ${pauseUrl}`,
    `Unsubscribe: ${unsubscribeUrl}`,
  ];

  return { html, text: textLines.join('\n'), unsubscribeUrl };
}

export async function sendOutreachEmail(params: {
  to: string;
  uid: string;
  cadence: OutreachCadence;
  composed: ComposedOutreachMessage;
}): Promise<{ success: boolean; provider?: 'gmail' | 'resend'; error?: string }> {
  const { html, text, unsubscribeUrl } = renderOutreachEmailHtml(params);

  return deliverRawOutreachEmail({
    to: params.to,
    subject: params.composed.subject,
    html,
    text,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}

/**
 * Sends a warm Sunny · Coaster confirmation email directly in the same Gmail thread
 * after parsing the user's inbound reply text or photo.
 */
export async function sendOutreachReplyConfirmationEmail(params: {
  to: string;
  uid: string;
  subject: string;
  headline: string;
  detail: string;
  agentReply?: string;
  lastFoodLine?: string;
  inReplyToMessageId?: string;
  loggedFoodId?: string;
  localDate?: string;
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
  };
  updatedHeadline?: string;
  updatedBody?: string;
  metricsLine?: string;
  statusTone?: 'good' | 'soon' | 'urgent';
}): Promise<{ success: boolean }> {
  const unsubscribeUrl = buildOutreachActionUrl({ uid: params.uid, action: 'unsubscribe' });
  const pauseUrl = buildOutreachActionUrl({
    uid: params.uid,
    action: 'pause',
    date: params.localDate,
  });
  const viewLedgerUrl = buildOutreachActionUrl({ uid: params.uid, action: 'view_ledger' });

  const undoUrl =
    params.loggedFoodId && params.localDate
      ? buildOutreachActionUrl({
          uid: params.uid,
          action: 'undo',
          date: params.localDate,
          foodId: params.loggedFoodId,
        })
      : undefined;

  const cleanSubject = params.subject.toLowerCase().startsWith('re:')
    ? params.subject
    : `Re: ${params.subject}`;

  const loggedBadge = params.isClearDay
    ? 'Clear Day · 0.0u'
    : params.isZeroProof
      ? 'Zero-Proof · 0.0u'
      : typeof params.loggedUnits === 'number'
        ? `${formatUnits(params.loggedUnits)} logged`
        : undefined;

  const tallyLine =
    params.metricsLine ||
    (typeof params.todayUnits === 'number' || typeof params.sevenDayAvg === 'number'
      ? `Today ${formatUnits(params.todayUnits ?? 0)} · 7d avg ${formatUnits(params.sevenDayAvg ?? 0)}/day`
      : undefined);

  const swapHtml = params.alternativeSuggested
    ? `<div style="margin:12px 0 0;padding:11px 14px;border-radius:10px;background:#F6EFE5;border:1px solid #E8DFD1;font-size:13px;color:#4A3F35;">
         <strong style="color:#9A4E1A;">Zero-Proof Idea:</strong> ${escapeHtml(params.alternativeSuggested)}
       </div>`
    : '';

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:20px 12px;background:#FAF6F0;color:#1F1B18;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:540px;margin:0 auto;background:#FFFDF9;border:1px solid #E8DFD1;border-radius:16px;padding:20px 22px;">
      <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#3F7D58;">Sunny · Coaster Update</div>
      <h2 style="margin:6px 0 0;font-size:19px;color:#1F1B18;">${escapeHtml(params.headline)}</h2>
      ${loggedBadge ? `<div style="display:inline-block;margin:10px 0 0;padding:4px 10px;border-radius:999px;background:#FDF5EB;border:1px solid #E9C89B;font-size:12px;font-weight:700;color:#9A4E1A;">${escapeHtml(loggedBadge)}</div>` : ''}
      ${params.agentReply ? `<p style="margin:12px 0 0;font-size:15px;line-height:1.55;color:#1F1B18;">${escapeHtml(params.agentReply)}</p>` : ''}
      <p style="margin:10px 0 0;font-size:13px;line-height:1.55;color:#4A3F35;">${escapeHtml(params.detail)}</p>
      ${tallyLine ? `<div style="margin:12px 0 0;padding:10px 13px;border-radius:10px;background:#FAF6F0;border:1px solid #E8DFD1;font-size:13px;color:#1F1B18;"><strong>Running Tally:</strong> ${escapeHtml(tallyLine)}</div>` : ''}
      ${params.lastFoodLine ? `<p style="margin:10px 0 0;font-size:12px;color:#6E6359;">${escapeHtml(params.lastFoodLine)}</p>` : ''}
      ${swapHtml}
      <div style="margin:16px 0 0;">
        <a href="${viewLedgerUrl}" style="display:inline-block;margin:4px 8px 4px 0;padding:9px 15px;border-radius:10px;background:#1F1B18;color:#FFFDF9;font-size:13px;font-weight:700;text-decoration:none;">Open Live Coaster &amp; Trends &rarr;</a>
        ${undoUrl ? `<a href="${undoUrl}" style="display:inline-block;margin:4px 0;padding:9px 14px;border-radius:10px;background:#F3ECE2;border:1px solid #DED2C0;color:#1F1B18;font-size:13px;font-weight:700;text-decoration:none;">Undo Last Entry</a>` : ''}
      </div>
      <div style="margin:18px 0 0;padding-top:12px;border-top:1px solid #E8DFD1;font-size:12px;color:#6E6359;">
        <a href="${pauseUrl}" style="color:#6E6359;">Pause check-ins</a> &middot; <a href="${unsubscribeUrl}" style="color:#6E6359;">Unsubscribe</a>
      </div>
    </div>
  </body>
</html>`;

  const text = [
    `Sunny · Coaster Update: ${params.headline}`,
    ...(loggedBadge ? [loggedBadge] : []),
    ...(params.agentReply ? ['', params.agentReply] : []),
    '',
    params.detail,
    ...(tallyLine ? [`Running Tally: ${tallyLine}`] : []),
    ...(params.lastFoodLine ? [params.lastFoodLine] : []),
    ...(params.alternativeSuggested ? [`Zero-Proof Idea: ${params.alternativeSuggested}`] : []),
    '',
    `Open Live Coaster & Trends: ${viewLedgerUrl}`,
    ...(undoUrl ? [`Undo last entry: ${undoUrl}`] : []),
    `Pause: ${pauseUrl} | Unsubscribe: ${unsubscribeUrl}`,
  ].join('\n');

  const res = await deliverRawOutreachEmail({
    to: params.to,
    subject: cleanSubject,
    html,
    text,
    ...(params.inReplyToMessageId
      ? {
          headers: {
            'In-Reply-To': params.inReplyToMessageId,
            References: params.inReplyToMessageId,
          },
        }
      : {}),
  });

  return { success: res.success };
}

/**
 * Literary "A New Journey" welcome email introducing Sunny, NIAAA Standard Drink
 * Units, plain-English & photo replies, 1-tap drink buttons, and Zero-Login Live Coaster.
 */
export function renderOutreachWelcomeEmailHtml(params: {
  uid: string;
  cadence: OutreachCadence;
  timezone: string;
  morningHour?: number;
  middayHour?: number;
  nightHour?: number;
  composed: ComposedOutreachMessage;
  recipientFirstName?: string;
}): { subject: string; html: string; text: string; unsubscribeUrl: string } {
  const { uid, cadence, timezone, composed, recipientFirstName } = params;
  const cleanFirstName = (recipientFirstName || '').trim();
  const displayGreeting = cleanFirstName ? cleanFirstName : 'Friend';

  const scheduleSummary = describeCadenceSchedule({
    cadence,
    timezone,
    morningHour: params.morningHour,
    middayHour: params.middayHour,
    nightHour: params.nightHour,
  });

  const unsubscribeUrl = buildOutreachActionUrl({ uid, action: 'unsubscribe' });
  const pauseUrl = buildOutreachActionUrl({ uid, action: 'pause', date: composed.localDate });
  const viewLedgerUrl = buildOutreachActionUrl({ uid, action: 'view_ledger' });
  const isSingleDaily = cadence === 'daily' || cadence === 'morning_only';
  const toggleCadenceUrl = buildOutreachActionUrl({
    uid,
    action: 'set_cadence',
    cadence: isSingleDaily ? '2x' : 'daily',
  });
  const toggleCadenceLabel = isSingleDaily
    ? 'Switch to 2x/day (Morning + Evening)'
    : 'Switch to 1x Daily (Morning only)';

  const actionButtonsHtml = renderActionButtonsHtml(uid, composed);

  const subject = cleanFirstName
    ? `A New Journey, ${cleanFirstName} — Pull up a seat with Sunny · Coaster`
    : 'A New Journey — Pull up a seat with Sunny · Coaster';

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:22px 12px;background:#FAF6F0;color:#1F1B18;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:580px;margin:0 auto;background:#FFFDF9;border:1px solid #E8DFD1;border-radius:20px;overflow:hidden;box-shadow:0 8px 30px rgba(64,45,25,0.07);">
      <div style="padding:26px 24px;background:#F5EFE6;border-bottom:1px solid #E8DFD1;">
        <div style="font-size:11px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#9A4E1A;">Sunny &middot; Coaster</div>
        <h1 style="margin:8px 0 6px;font-size:24px;line-height:1.25;color:#1F1B18;font-family:Georgia,'Times New Roman',serif;">A New Journey, ${escapeHtml(displayGreeting)}</h1>
        <p style="margin:0;font-size:14px;line-height:1.5;color:#6E6359;">Fresh coasters, honest numbers, and zero pressure at the corner booth.</p>
      </div>

      <div style="padding:22px 24px;">
        <p style="margin:0 0 14px;font-size:15px;line-height:1.68;color:#1F1B18;">
          Every fresh notebook starts before the first ink hits the page. Sometimes the nicest thing you can do for yourself is replace guesswork and side-eye with a warm lamp, a clean paper coaster, and a little daylight curiosity about what a week actually holds.
        </p>

        <p style="margin:0 0 16px;font-size:15px;line-height:1.68;color:#1F1B18;">
          I&rsquo;m <strong>Sunny</strong> &mdash; your non-drinking booth-buddy here at Coaster (usually nursing a sparkling yuzu or a St. Agrestis Phony Negroni). I don&rsquo;t hand out gold stars, grades, or lectures. I just keep steady, friendly tally alongside you so your trends tell a clear story.
        </p>

        <div style="margin:16px 0;padding:16px 18px;border-radius:14px;background:#FDF5EB;border:1px solid #E9C89B;">
          <div style="font-size:12px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#9A4E1A;">How Standard Drink Units Work</div>
          <p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:#1F1B18;">
            Because not all pours are built equal, Coaster measures in <strong>NIAAA Standard Drink Units</strong> (1.0u = 14g / 0.6 fl oz pure ethanol):
          </p>
          <ul style="margin:8px 0 0;padding-left:18px;font-size:13px;line-height:1.65;color:#4A3F35;">
            <li><strong>1.0u</strong> = 12oz 5% beer &middot; 5oz 12% wine &middot; 1.5oz 40% spirit</li>
            <li>A big <strong>16oz 6.8% hazy IPA</strong> tallboy automatically counts as <strong>1.8u</strong></li>
            <li><strong>Zero-proof drinks &amp; Clear Days</strong> log cleanly at <strong>0.0u</strong></li>
          </ul>
        </div>

        <div style="margin:16px 0;padding:16px 18px;border-radius:14px;background:#F2F7F4;border:1px solid #C8DED0;">
          <div style="font-size:12px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:#2E6445;">How To Use This Thread</div>
          <p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:#1F1B18;">
            <strong>Just hit reply</strong> whenever you feel like it &mdash; no login needed:
          </p>
          <ul style="margin:8px 0 0;padding-left:18px;font-size:13px;line-height:1.65;color:#2D3F34;">
            <li>Type plain English: <em>&ldquo;2 hazy IPAs at trivia&rdquo;</em>, <em>&ldquo;Glass of pinot noir&rdquo;</em>, or <em>&ldquo;Clear day&rdquo;</em></li>
            <li>Attach a quick photo of a can, wine bottle, bar receipt, or tap list</li>
            <li>Or use the 1-tap pour buttons below anytime</li>
          </ul>
          <p style="margin:10px 0 0;font-size:12px;color:#4A5D52;">
            Check-in cadence: <strong>${escapeHtml(scheduleSummary)}</strong>
          </p>
        </div>

        <div style="margin:20px 0 0;">
          <div style="font-size:11px;font-weight:800;letter-spacing:0.07em;text-transform:uppercase;color:#6E6359;margin-bottom:8px;">1-Tap Quick Tally</div>
          <div>${actionButtonsHtml}</div>
        </div>

        <div style="margin:18px 0 0;">
          <a href="${viewLedgerUrl}" style="display:inline-block;padding:12px 20px;border-radius:12px;background:#1F1B18;color:#FFFDF9;font-size:14px;font-weight:700;text-decoration:none;">Open Live Coaster &amp; Trends &rarr;</a>
        </div>
      </div>

      <div style="padding:14px 24px;background:#FAF6F0;border-top:1px solid #E8DFD1;font-size:12px;color:#6E6359;line-height:1.7;">
        <a href="${viewLedgerUrl}" style="color:#9A4E1A;font-weight:700;text-decoration:underline;">Open Live Coaster &amp; Trends</a>
        &nbsp;&middot;&nbsp;
        <a href="${toggleCadenceUrl}" style="color:#6E6359;text-decoration:underline;">${escapeHtml(toggleCadenceLabel)}</a>
        &nbsp;&middot;&nbsp;
        <a href="${pauseUrl}" style="color:#6E6359;text-decoration:underline;">Pause Check-ins</a>
        &nbsp;&middot;&nbsp;
        <a href="${unsubscribeUrl}" style="color:#6E6359;text-decoration:underline;">Unsubscribe</a>
      </div>
    </div>
  </body>
</html>`;

  const text = [
    `A New Journey, ${displayGreeting}`,
    `Pull up a seat with Sunny · Coaster`,
    '',
    'Every fresh notebook starts before the first ink hits the page. I am Sunny, your non-drinking booth-buddy here at Coaster (usually nursing a sparkling yuzu or a Phony Negroni). Zero gold stars, zero grades, zero lectures — just honest numbers and relaxed trendlines.',
    '',
    'HOW STANDARD DRINK UNITS WORK:',
    '- 1.0u = 12oz 5% beer / 5oz 12% wine / 1.5oz 40% spirit',
    '- A 16oz 6.8% hazy IPA counts as 1.8u',
    '- Zero-proof swaps and Clear Days log cleanly at 0.0u',
    '',
    'HOW TO REPLY:',
    'Reply directly in plain English ("2 hazy IPAs at trivia", "Glass of pinot noir", "Clear day") or attach a photo of a bar receipt, tap list, bottle, or can.',
    `Schedule: ${scheduleSummary}`,
    '',
    '1-Tap Quick Tally:',
    ...composed.quickActions.map(
      (btn) =>
        `- ${btn.label}: ${buildOutreachActionUrl({
          uid,
          action: btn.action,
          date: composed.localDate,
          window: composed.window,
        })}`,
    ),
    '',
    `Open Live Coaster & Trends: ${viewLedgerUrl}`,
    `Pause check-ins: ${pauseUrl}`,
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join('\n');

  return { subject, html, text, unsubscribeUrl };
}

export async function sendOutreachWelcomeEmail(params: {
  to: string;
  uid: string;
  cadence: OutreachCadence;
  timezone: string;
  morningHour?: number;
  middayHour?: number;
  nightHour?: number;
  composed: ComposedOutreachMessage;
  recipientFirstName?: string;
}): Promise<{ success: boolean; provider?: 'gmail' | 'resend'; error?: string }> {
  const { subject, html, text, unsubscribeUrl } = renderOutreachWelcomeEmailHtml(params);

  return deliverRawOutreachEmail({
    to: params.to,
    subject,
    html,
    text,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
}
