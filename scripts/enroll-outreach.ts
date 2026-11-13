/**
 * Enrolls one or more email addresses into Sunny · Coaster Morning/Evening (2x/day)
 * check-ins, grants Founding Friend full access, seeds Sunny's "A New Journey"
 * greeting in chat_sessions, and delivers the personalized welcome email.
 *
 * Usage:
 *   npx tsx scripts/enroll-outreach.ts miss.marlo@gmail.com
 *   npx tsx scripts/enroll-outreach.ts miss.marlo@gmail.com --name=Marlo --tz=America/Los_Angeles
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import path from 'path';
import type { OutreachWindow } from '../src/lib/health-service';

const HONORIFIC_PREFIXES = new Set(['miss', 'mr', 'mrs', 'ms', 'mx', 'dr', 'sir', 'lady']);

/**
 * Derives a clean capitalized first name from an email local part
 * (e.g., "miss.marlo@gmail.com" -> "Marlo", "nicholas.switzer@gmail.com" -> "Nicholas").
 */
export function deriveFirstNameFromEmail(rawEmail: string): string {
  const local = (rawEmail || '').trim().split('@')[0]?.replace(/\+.*$/, '') ?? '';
  const tokens = local
    .split(/[._-]+/)
    .map((t) => t.replace(/[^a-zA-Z]/g, '').trim())
    .filter(Boolean);
  const chosen = tokens.find((t) => !HONORIFIC_PREFIXES.has(t.toLowerCase())) ?? tokens[0] ?? 'Friend';
  return chosen.charAt(0).toUpperCase() + chosen.slice(1).toLowerCase();
}

function windowForHour(hour: number): OutreachWindow {
  if (hour < 11) return 'morning';
  if (hour < 17) return 'midday';
  return 'night';
}

export async function enrollEmail(
  rawEmail: string,
  options?: { firstName?: string; timezone?: string; dryRun?: boolean },
) {
  // Dynamic imports execute AFTER dotenv.config() so NEXT_PUBLIC_SITE_URL & secrets are loaded
  const [
    { getAdminAuth, getAdminFirestore },
    { adminHealthService },
    { buildLiveUserOutreach, dispatchOutreachForUser, saveUserOutreachSettings },
    { resolveLocalClock },
  ] = await Promise.all([
    import('../src/firebase/admin'),
    import('../src/lib/health-service-admin'),
    import('../src/lib/outreach-service'),
    import('../src/lib/outreach-auth'),
  ]);

  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`Invalid email: ${rawEmail}`);
  }

  const firstName = options?.firstName?.trim() || deriveFirstNameFromEmail(email);
  const timezone = options?.timezone?.trim() || 'America/Los_Angeles';

  const db = getAdminFirestore();
  const auth = getAdminAuth();

  let uid: string | null = null;
  let source = '';

  const authUser = await auth.getUserByEmail(email).catch(() => null);
  if (authUser?.uid) {
    uid = authUser.uid;
    source = 'existing_firebase_auth';
  } else {
    const snap = await db.collection('users').where('outreachEmail', '==', email).limit(1).get();
    if (!snap.empty) {
      uid = snap.docs[0].id;
      source = 'existing_outreach_doc';
    } else {
      const created = await auth.createUser({
        email,
        displayName: firstName,
        emailVerified: true,
      });
      uid = created.uid;
      source = 'created_firebase_auth';
    }
  }

  await adminHealthService.getHealthSummary(db, uid);

  // Grant Founding Friend full access cleanly
  await Promise.all([
    db.doc(`users/${uid}/preferences/settings`).set(
      {
        foundingFriend: true,
        profile: { displayName: firstName },
      },
      { merge: true },
    ),
    adminHealthService.updateHealthData(db, uid, {
      displayName: firstName,
      entitlementTier: 'vip',
    }),
  ]);

  const saved = await saveUserOutreachSettings({
    uid,
    displayName: firstName,
    outreach: {
      enabled: true,
      channel: 'email',
      cadence: '2x',
      email,
      timezone,
      morningHour: 9,
      nightHour: 19,
    },
  });

  const clock = resolveLocalClock(new Date(), saved.timezone);
  const currentWin = windowForHour(clock.hour);

  // Seed Sunny's "A New Journey" greeting in today's chat session if empty
  const existingSession = await adminHealthService.getChatSession(db, uid, clock.localDate);
  if (!existingSession || !existingSession.messages?.length) {
    await adminHealthService.appendChatMessages(db, uid, clock.localDate, [
      {
        role: 'model',
        content: `**A New Journey, ${firstName}** — pull up a seat at the booth!\n\nI'm **Sunny**, your non-drinking booth-buddy at Coaster (sparkling yuzu fan, zero judgment, zero lectures). Whenever you want, drop what you're sipping in plain English, snap a tap list or bottle label, or tap **Clear Day** — I'll handle the NIAAA Standard Drink Units (\`1.0u\` = 12oz 5% beer / 5oz 12% wine / 1.5oz 40% spirit) and keep your trends crystal clear.`,
        ts: Date.now(),
      },
    ]);
  }

  const { composed } = await buildLiveUserOutreach({ uid, window: currentWin });

  let liveEmailSent = false;
  let sendNote = options?.dryRun
    ? 'Dry run — skipped live email dispatch'
    : 'GMAIL_APP_PASSWORD / RESEND_API_KEY not in local shell env';

  if (!options?.dryRun && (process.env.GMAIL_APP_PASSWORD || process.env.RESEND_API_KEY)) {
    const dispatched = await dispatchOutreachForUser({
      uid,
      window: currentWin,
      force: true,
      isWelcome: true,
      recipientFirstName: firstName,
    });
    liveEmailSent = dispatched.status === 'sent';
    sendNote =
      dispatched.status === 'sent'
        ? 'Sent live "A New Journey" welcome email!'
        : dispatched.reason || 'Failed';
  }

  return {
    email,
    firstName,
    uid,
    source,
    timezone: saved.timezone,
    cadence: saved.cadence,
    schedule: `${saved.morningHour ?? 9}:00 & ${saved.nightHour ?? 19}:00`,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'default',
    previewHeadline: composed.headline,
    previewMetrics: composed.metricsLine,
    liveEmailSent,
    sendNote,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const emails: string[] = [];
  let nameOverride: string | undefined;
  let tzOverride: string | undefined;
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith('--name=')) {
      nameOverride = arg.slice(7);
    } else if (arg.startsWith('--tz=')) {
      tzOverride = arg.slice(5);
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else {
      emails.push(arg);
    }
  }

  if (emails.length === 0) {
    console.error(
      'Usage: npx tsx scripts/enroll-outreach.ts <email1> [email2 ...] [--name=FirstName] [--tz=America/Los_Angeles] [--dry-run]',
    );
    process.exit(1);
  }

  for (const email of emails) {
    const res = await enrollEmail(email, {
      firstName: emails.length === 1 ? nameOverride : undefined,
      timezone: tzOverride,
      dryRun,
    });
    console.log('\n------------------------------------------------------------');
    console.log(`Enrolled:   ${res.firstName} <${res.email}>`);
    console.log(`UID:        ${res.uid} (${res.source}) [Founding Friend / VIP]`);
    console.log(`Schedule:   ${res.cadence} (${res.schedule} ${res.timezone})`);
    console.log(`Site URL:   ${res.siteUrl}`);
    console.log(`Preview:    ${res.previewHeadline}`);
    console.log(`Metrics:    ${res.previewMetrics}`);
    console.log(`Delivery:   ${res.sendNote}`);
  }
  console.log('------------------------------------------------------------\n');
}

const invokedPath = process.argv[1] ? path.basename(process.argv[1]) : '';
if (invokedPath.startsWith('enroll-outreach')) {
  main().catch((err) => {
    console.error('Enrollment failed:', err);
    process.exit(1);
  });
}
