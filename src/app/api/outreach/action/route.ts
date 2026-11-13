import { NextRequest, NextResponse } from 'next/server';
import { verifyOutreachToken } from '@/lib/outreach-auth';
import { buildLiveUserOutreach, executeOutreachQuickAction } from '@/lib/outreach-service';
import { buildOutreachActionUrl } from '@/lib/outreach-email';
import { escapeHtml, renderLiveCoasterHtml } from '@/lib/outreach-ledger-html';
import { SITE_URL } from '@/lib/site';

/**
 * @fileOverview Stateless 1-tap Coaster action, RFC 8058 One-Click Unsubscribe,
 * and Zero-Login Live Coaster & Trends HTML page.
 *
 * - HEAD: no-op 200 (guards against email link prefetchers mutating state)
 * - POST: RFC 8058 `List-Unsubscribe=One-Click` native unsubscribe
 * - GET:  Executes signed action token (`?token=...` or `?t=...`) or renders Live Coaster
 */

export const dynamic = 'force-dynamic';

function getCoasterSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || SITE_URL).replace(/\/+$/, '');
}

async function renderLiveLedgerPage(uid: string, bannerNotice?: string): Promise<string> {
  const { composed, recentLogs, trend, localDate } = await buildLiveUserOutreach({ uid });
  return renderLiveCoasterHtml({
    uid,
    composed,
    recentLogs,
    trend,
    localDate,
    bannerNotice,
  });
}

function renderConfirmationPage(params: {
  title: string;
  detail: string;
  updatedHeadline?: string;
  updatedBody?: string;
  liveCoasterUrl?: string;
  secondaryActionLabel?: string;
  secondaryActionUrl?: string;
  isError?: boolean;
}): string {
  const accent = params.isError ? '#B94A3B' : '#3F7D58';
  const noteCard = params.updatedHeadline
    ? `<div style="background:#FDF5EB;border-left:4px solid #C26D2D;border-radius:12px;padding:14px 16px;margin:18px 0;text-align:left;">
         <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#9A4E1A;margin-bottom:4px;">Sunny &middot; Coaster Update</div>
         <div style="font-size:16px;font-weight:800;color:#1F1B18;margin-bottom:4px;">${escapeHtml(params.updatedHeadline)}</div>
         ${params.updatedBody ? `<div style="font-size:13px;color:#4A3F35;line-height:1.55;">${escapeHtml(params.updatedBody)}</div>` : ''}
       </div>`
    : '';

  const liveBtn = params.liveCoasterUrl
    ? `<a href="${params.liveCoasterUrl}" class="coaster-btn" style="display:inline-flex;align-items:center;justify-content:center;min-height:44px;margin:0;padding:11px 18px;border-radius:10px;background:#C26D2D;color:#FFFDF9;font-size:14px;line-height:20px;font-weight:700;text-decoration:none;box-sizing:border-box;">Open Live Coaster &amp; Trends</a>`
    : '';

  const secondaryBtn =
    params.secondaryActionLabel && params.secondaryActionUrl
      ? `<a href="${params.secondaryActionUrl}" class="coaster-btn" style="display:inline-flex;align-items:center;justify-content:center;min-height:44px;margin:0;padding:11px 16px;border-radius:10px;border:1px solid #DED2C0;background:#F5EFE6;color:#1F1B18;font-size:14px;line-height:20px;font-weight:700;text-decoration:none;box-sizing:border-box;">${escapeHtml(params.secondaryActionLabel)}</a>`
      : '';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(params.title)} &mdash; Sunny &middot; Coaster</title>
    <style>
      *,*::before,*::after{box-sizing:border-box;}
      html,body{margin:0;padding:0;width:100%;overflow-x:hidden;-webkit-text-size-adjust:100%;}
      .coaster-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;box-sizing:border-box;}
    </style>
  </head>
  <body style="margin:0;padding:16px 12px;background:#FAF6F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1F1B18;box-sizing:border-box;width:100%;">
    <div style="max-width:560px;width:100%;box-sizing:border-box;margin:16px auto;background:#FFFDF9;border:1px solid #E8DFD1;border-radius:18px;padding:24px 20px;text-align:center;box-shadow:0 8px 26px rgba(64,45,25,0.06);">
      <div style="font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:${accent};margin-bottom:8px;">
        Sunny &middot; Coaster
      </div>
      <h1 style="font-size:22px;font-weight:800;margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;">${escapeHtml(params.title)}</h1>
      <p style="font-size:16px;color:#4A3F35;line-height:1.6;margin:0 0 16px;">${escapeHtml(params.detail)}</p>
      ${noteCard}
      <div style="margin-top:20px;display:flex;flex-wrap:wrap;justify-content:center;gap:8px;box-sizing:border-box;">
        ${liveBtn}
        ${secondaryBtn}
        <a href="${getCoasterSiteUrl()}" class="coaster-btn" style="display:inline-flex;align-items:center;justify-content:center;min-height:44px;margin:0;padding:11px 18px;border-radius:10px;background:#1F1B18;color:#FFFDF9;font-size:14px;line-height:20px;font-weight:700;text-decoration:none;box-sizing:border-box;">Open Coaster App</a>
      </div>
    </div>
  </body>
</html>`;
}

function getActionTokenParam(request: NextRequest): string | null {
  return (
    request.nextUrl.searchParams.get('token') ||
    request.nextUrl.searchParams.get('t')
  );
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

export async function POST(request: NextRequest) {
  const token = getActionTokenParam(request);
  const verified = verifyOutreachToken(token);
  if (!verified) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 });
  }

  const result = await executeOutreachQuickAction({
    uid: verified.uid,
    action: verified.action,
    date: verified.date,
    window: verified.window,
    foodId: verified.foodId,
    cadence: verified.cadence,
    nonce: verified.nonce,
  });

  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: NextRequest) {
  const token = getActionTokenParam(request);
  const verified = verifyOutreachToken(token);

  if (!verified) {
    return new NextResponse(
      renderConfirmationPage({
        title: 'Link Expired or Invalid',
        detail:
          'This Coaster link has expired. Open the Coaster app or reply to your latest Sunny email to get a fresh link.',
        isError: true,
      }),
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  try {
    const isFromLiveCoaster = request.nextUrl.searchParams.get('from') === 'coaster';

    if (verified.action === 'view_ledger') {
      const html = await renderLiveLedgerPage(verified.uid);
      return new NextResponse(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    const result = await executeOutreachQuickAction({
      uid: verified.uid,
      action: verified.action,
      date: verified.date,
      window: verified.window,
      foodId: verified.foodId,
      cadence: verified.cadence,
      nonce: verified.nonce,
    });

    if (
      verified.action === 'undo' ||
      verified.action === 'undo_food' ||
      isFromLiveCoaster
    ) {
      const html = await renderLiveLedgerPage(verified.uid, result.detail);
      return new NextResponse(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    const liveCoasterUrl = buildOutreachActionUrl({
      uid: verified.uid,
      action: 'view_ledger',
    });

    let secondaryActionLabel: string | undefined;
    let secondaryActionUrl: string | undefined;

    if (result.loggedFoodId) {
      secondaryActionLabel = 'Undo Entry';
      secondaryActionUrl = buildOutreachActionUrl({
        uid: verified.uid,
        action: 'undo',
        date: verified.date,
        foodId: result.loggedFoodId,
      });
    } else if (
      verified.action === 'unsubscribe' ||
      verified.action === 'pause' ||
      verified.action === 'pause_7d'
    ) {
      secondaryActionLabel = 'Resume Check-Ins';
      secondaryActionUrl = buildOutreachActionUrl({
        uid: verified.uid,
        action: 'resume',
      });
    }

    return new NextResponse(
      renderConfirmationPage({
        title: result.title,
        detail: result.detail,
        updatedHeadline: result.updatedHeadline,
        updatedBody: result.updatedBody,
        liveCoasterUrl,
        secondaryActionLabel,
        secondaryActionUrl,
      }),
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  } catch (err: unknown) {
    console.error('[OutreachAction] Error executing quick action:', err);
    return new NextResponse(
      renderConfirmationPage({
        title: 'Could Not Update Coaster',
        detail:
          'Something hiccuped while updating your coaster. Please try again in a moment.',
        isError: true,
      }),
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}
