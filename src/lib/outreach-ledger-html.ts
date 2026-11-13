import crypto from 'crypto';
import {
  computeDailyTrendSeries,
  formatUnits,
  getEntryDateKey,
  getEntryUnits,
  isClearDayEntry,
  isZeroProofEntry,
  type CoasterFoodLogEntry,
  type DrinkTrendSummary,
} from '@/lib/health-service';
import type { ComposedOutreachMessage } from '@/lib/outreach-composer';
import { buildOutreachActionUrl } from '@/lib/outreach-email';
import { SITE_URL } from '@/lib/site';

function getCoasterSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || SITE_URL).replace(/\/+$/, '');
}

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatShortWeekday(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map((n) => Number(n));
  if (!y || !m || !d) return isoDate.slice(5);
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/**
 * Renders the mobile-first Zero-Login Live Coaster & Trends HTML page.
 * Shared between `GET /api/outreach/action?action=view_ledger` and preview generation.
 */
export function renderLiveCoasterHtml(params: {
  uid: string;
  composed: ComposedOutreachMessage;
  recentLogs: CoasterFoodLogEntry[];
  trend: DrinkTrendSummary;
  localDate: string;
  bannerNotice?: string;
}): string {
  const { uid, composed, recentLogs, trend, localDate, bannerNotice } = params;

  const series7 = computeDailyTrendSeries(recentLogs, localDate, 7);
  const maxUnits = Math.max(2, ...series7.map((d) => d.units));

  const barChartHtml = series7
    .map((pt) => {
      const pct = pt.units > 0 ? Math.max(10, Math.round((pt.units / maxUnits) * 100)) : 8;
      const barColor = pt.clearDay
        ? '#3F7D58'
        : pt.units > 0
          ? pt.date === localDate
            ? '#C26D2D'
            : '#D99B66'
          : '#E8DFD1';
      const valLabel = pt.clearDay ? 'Clear' : pt.units > 0 ? `${pt.units.toFixed(1)}u` : '0u';
      const isToday = pt.date === localDate;
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0;">
        <div style="font-size:10px;font-weight:700;color:${pt.clearDay ? '#2E6445' : '#4A3F35'};white-space:nowrap;">${valLabel}</div>
        <div style="width:100%;max-width:34px;height:86px;background:#F3ECE2;border-radius:8px;display:flex;align-items:flex-end;overflow:hidden;border:1px solid ${isToday ? '#C26D2D' : '#E8DFD1'};">
          <div style="width:100%;height:${pct}%;background:${barColor};border-radius:6px 6px 0 0;"></div>
        </div>
        <div style="font-size:11px;font-weight:${isToday ? '800' : '600'};color:${isToday ? '#9A4E1A' : '#6E6359'};">${formatShortWeekday(pt.date)}</div>
      </div>`;
    })
    .join('');

  const quickButtonsSpec: Array<{
    action: 'log_beer' | 'log_wine' | 'log_cocktail' | 'log_zero_proof' | 'log_clear_day';
    label: string;
    primary?: boolean;
  }> = [
    { action: 'log_beer', label: '+1.0u Beer', primary: true },
    { action: 'log_wine', label: '+1.0u Wine' },
    { action: 'log_cocktail', label: '+1.0u Cocktail/Shot' },
    { action: 'log_zero_proof', label: '0.0u Zero-Proof Swap' },
    { action: 'log_clear_day', label: 'Clear Day 0.0u' },
  ];

  const clickNonce = crypto.randomBytes(4).toString('hex');
  const quickButtonsHtml = `<div class="coaster-actions" style="display:flex;flex-wrap:wrap;gap:8px;box-sizing:border-box;">${quickButtonsSpec
    .map((btn) => {
      const url = `${buildOutreachActionUrl({
        uid,
        action: btn.action,
        date: localDate,
        nonce: clickNonce,
      })}&from=coaster`;
      const isPrimary = btn.primary;
      const isClear = btn.action === 'log_clear_day';
      const bg = isPrimary ? '#C26D2D' : isClear ? '#F2F7F4' : '#F3ECE2';
      const fg = isPrimary ? '#FFFDF9' : isClear ? '#2E6445' : '#1F1B18';
      const border = isPrimary ? '#C26D2D' : isClear ? '#B7D4C3' : '#DED2C0';
      return `<a href="${url}" class="coaster-btn" style="display:inline-flex;align-items:center;justify-content:center;min-height:44px;margin:0;padding:11px 15px;border-radius:10px;background:${bg};color:${fg};border:1px solid ${border};font-size:14px;line-height:20px;font-weight:700;text-decoration:none;box-sizing:border-box;">${escapeHtml(btn.label)}</a>`;
    })
    .join('')}</div>`;

  const recentPours = [...recentLogs].slice(-10).reverse();
  const renderPourRows = (pours: CoasterFoodLogEntry[]) => {
    if (pours.length === 0) {
      return `<div style="padding:14px;border-radius:12px;background:#FAF6F0;border:1px solid #E8DFD1;color:#6E6359;font-size:16px;line-height:1.5;box-sizing:border-box;">No pours logged yet &mdash; tap a button above or reply to Sunny anytime.</div>`;
    }
    return pours
      .map((entry) => {
        const label = entry.name || entry.foodName || 'Pour';
        const dateIso = getEntryDateKey(entry) || localDate;
        const timeStr = entry.consumedAt
          ? /^\d{4}-\d{2}-\d{2}T/.test(entry.consumedAt)
            ? entry.consumedAt.slice(11, 16)
            : entry.consumedAt.slice(0, 5)
          : '';
        const units = getEntryUnits(entry);
        const badgeText = isClearDayEntry(entry)
          ? 'Clear Day · 0.0u'
          : isZeroProofEntry(entry)
            ? 'Zero-Proof · 0.0u'
            : formatUnits(units);
        const badgeBg = isClearDayEntry(entry) || isZeroProofEntry(entry) ? '#F2F7F4' : '#FDF5EB';
        const badgeFg = isClearDayEntry(entry) || isZeroProofEntry(entry) ? '#2E6445' : '#9A4E1A';
        const undoUrl = entry.id
          ? `${buildOutreachActionUrl({
              uid,
              action: 'undo',
              date: dateIso,
              foodId: entry.id,
            })}&from=coaster`
          : null;

        return `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:12px 14px;border:1px solid #E8DFD1;border-radius:12px;margin-bottom:8px;background:#FFFDF9;box-sizing:border-box;">
          <div style="min-width:0;flex:1 1 180px;">
            <div style="font-size:16px;font-weight:700;color:#1F1B18;overflow-wrap:anywhere;">${escapeHtml(label)}</div>
            <div style="font-size:13px;color:#6E6359;margin-top:3px;">
              ${escapeHtml(dateIso)}${timeStr ? ` &middot; ${escapeHtml(timeStr)}` : ''}
              &nbsp;&middot;&nbsp;
              <span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${badgeBg};color:${badgeFg};font-weight:700;">${escapeHtml(badgeText)}</span>
            </div>
          </div>
          ${
            undoUrl
              ? `<a href="${undoUrl}" class="coaster-btn" style="flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 14px;border-radius:8px;border:1px solid #E5CFC8;background:#FDF4F2;color:#A13E2D;font-size:13px;font-weight:700;text-decoration:none;box-sizing:border-box;">Remove</a>`
              : ''
          }
        </div>`;
      })
      .join('');
  };

  const bannerHtml = bannerNotice
    ? `<div style="background:#F2F7F4;border:1px solid #B7D4C3;color:#2E6445;padding:12px 14px;border-radius:12px;font-size:14px;font-weight:700;margin-bottom:16px;box-sizing:border-box;">${escapeHtml(bannerNotice)}</div>`
    : '';

  const swapHtml = composed.swapSuggestion
    ? `<div style="margin-top:10px;padding:11px 12px;border-radius:10px;background:#FFFDF9;border:1px solid #E9C89B;font-size:14px;line-height:1.5;color:#4A3F35;box-sizing:border-box;">
         <strong style="color:#9A4E1A;">Sunny's Zero-Proof Pick:</strong> ${escapeHtml(composed.swapSuggestion)}
       </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Live Coaster &amp; Trends &mdash; Sunny &middot; Coaster</title>
    <style>
      *,*::before,*::after{box-sizing:border-box;}
      html,body{margin:0;padding:0;width:100%;overflow-x:hidden;-webkit-text-size-adjust:100%;}
      .coaster-kpis{display:flex;flex-wrap:wrap;gap:10px;}
      .coaster-kpi{flex:1 1 130px;min-width:0;}
      .coaster-actions{display:flex;flex-wrap:wrap;gap:8px;}
      .coaster-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;box-sizing:border-box;}
      @media (max-width:440px){
        .coaster-body{padding:12px 8px !important;}
        .coaster-card{padding:16px 14px !important;border-radius:16px !important;}
        .coaster-kpi{flex:1 1 100%;}
      }
    </style>
  </head>
  <body class="coaster-body" style="margin:0;padding:16px 10px;background:#FAF6F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1F1B18;box-sizing:border-box;width:100%;">
    <div class="coaster-card" style="max-width:560px;width:100%;box-sizing:border-box;margin:6px auto;background:#FFFDF9;border:1px solid #E8DFD1;border-radius:20px;padding:20px 18px;box-shadow:0 8px 28px rgba(64,45,25,0.06);">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
        <div style="min-width:0;">
          <div style="font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#9A4E1A;">
            Sunny &middot; Coaster &mdash; Zero-Login Ledger
          </div>
          <h1 style="margin:4px 0 0;font-size:22px;font-weight:800;font-family:Georgia,'Times New Roman',serif;color:#1F1B18;">Live Coaster &amp; Trends</h1>
        </div>
        <div style="font-size:13px;font-weight:700;color:#6E6359;">${escapeHtml(localDate)}</div>
      </div>

      ${bannerHtml}

      <div class="coaster-kpis" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px;box-sizing:border-box;">
        <div class="coaster-kpi" style="flex:1 1 130px;min-width:0;border:1px solid #E8DFD1;border-radius:14px;padding:12px;background:#FAF6F0;box-sizing:border-box;">
          <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:#6E6359;">Today's Units</div>
          <div style="font-size:22px;font-weight:800;color:#9A4E1A;margin-top:4px;">${formatUnits(trend.todayUnits)}</div>
          <div style="font-size:12px;color:#6E6359;margin-top:2px;">1.0u = 0.6 fl oz ethanol</div>
        </div>
        <div class="coaster-kpi" style="flex:1 1 130px;min-width:0;border:1px solid #E8DFD1;border-radius:14px;padding:12px;background:#FAF6F0;box-sizing:border-box;">
          <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:#6E6359;">7-Day Average</div>
          <div style="font-size:22px;font-weight:800;color:#1F1B18;margin-top:4px;">${formatUnits(trend.sevenDayAvg)}<span style="font-size:12px;font-weight:600;color:#6E6359;">/day</span></div>
          <div style="font-size:12px;color:#6E6359;margin-top:2px;">${formatUnits(trend.sevenDayTotal)} total (7d)</div>
        </div>
        <div class="coaster-kpi" style="flex:1 1 130px;min-width:0;border:1px solid #E8DFD1;border-radius:14px;padding:12px;background:#F2F7F4;box-sizing:border-box;">
          <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:#2E6445;">30-Day Totals</div>
          <div style="font-size:22px;font-weight:800;color:#2E6445;margin-top:4px;">${trend.clearDaysLast30} <span style="font-size:12px;font-weight:700;">clear</span></div>
          <div style="font-size:12px;color:#4A5D52;margin-top:2px;">${formatUnits(trend.thirtyDayTotal)} across 30d</div>
        </div>
      </div>

      <div style="border:1px solid #E8DFD1;border-radius:14px;padding:14px 14px;background:#FAF6F0;margin-bottom:18px;box-sizing:border-box;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
          <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:#4A3F35;">7-Day Rolling Rhythm</div>
          <div style="font-size:12px;color:#6E6359;">Avg ${formatUnits(trend.sevenDayAvg)}/day</div>
        </div>
        <div style="display:flex;align-items:flex-end;gap:6px;">
          ${barChartHtml}
        </div>
      </div>

      <div style="background:#FDF5EB;border:1px solid #E9C89B;border-radius:14px;padding:14px 16px;margin-bottom:18px;box-sizing:border-box;">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.07em;color:#9A4E1A;margin-bottom:4px;">Sunny's Note</div>
        <div style="font-size:16px;font-weight:800;color:#1F1B18;margin-bottom:4px;">${escapeHtml(composed.headline)}</div>
        <div style="font-size:16px;color:#4A3F35;line-height:1.55;">${escapeHtml(composed.body)}</div>
        ${swapHtml}
      </div>

      <div style="margin-bottom:20px;">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.07em;color:#6E6359;margin-bottom:8px;">1-Tap Quick Log</div>
        ${quickButtonsHtml}
      </div>

      <h2 style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.07em;color:#4A3F35;margin:16px 0 8px;">
        Recent Pours &amp; Check-Ins (${recentPours.length})
      </h2>
      ${renderPourRows(recentPours)}

      <div style="margin-top:20px;padding-top:14px;border-top:1px solid #E8DFD1;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;font-size:13px;color:#6E6359;gap:10px;box-sizing:border-box;">
        <span>Reply to your Sunny · Coaster email anytime with text or a pic</span>
        <a href="${getCoasterSiteUrl()}" class="coaster-btn" style="min-height:44px;padding:8px 14px;border-radius:8px;background:#F3ECE2;border:1px solid #DED2C0;color:#9A4E1A;font-weight:800;text-decoration:none;box-sizing:border-box;">Open Full App &rarr;</a>
      </div>
    </div>
  </body>
</html>`;
}
