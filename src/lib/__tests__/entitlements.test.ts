import { describe, expect, it } from 'vitest';
import {
  ANONYMOUS_FREE_AI_AUDITS_LIMIT,
  FOUNDER_EMAILS,
  FREE_AI_AUDITS_LIMIT,
  FREE_AI_CALL_LIMIT,
  PRO_MONTHLY_AI_AUDITS_CAP,
  isFounderIdentity,
  resolveClientEntitlement,
} from '../entitlements';

describe('Coaster entitlements & generous hackathon limits', () => {
  it('sets FREE_AI_CALL_LIMIT to 10000 and aligns free/anonymous/monthly caps', () => {
    expect(FREE_AI_CALL_LIMIT).toBe(10000);
    expect(FREE_AI_AUDITS_LIMIT).toBe(10000);
    expect(ANONYMOUS_FREE_AI_AUDITS_LIMIT).toBe(10000);
    expect(PRO_MONTHLY_AI_AUDITS_CAP).toBe(10000);
  });

  it('includes miss.marlo@gmail.com and founder emails in FOUNDER_EMAILS', () => {
    expect(FOUNDER_EMAILS.has('miss.marlo@gmail.com')).toBe(true);
    expect(FOUNDER_EMAILS.has('nicholas.switzer@gmail.com')).toBe(true);
    expect(isFounderIdentity({ email: 'MISS.MARLO@GMAIL.COM' })).toBe(true);
    expect(isFounderIdentity({ email: 'guest@example.com' })).toBe(false);

    const marloStatus = resolveClientEntitlement({ email: 'miss.marlo@gmail.com' }, null);
    expect(marloStatus.allowed).toBe(true);
    expect(marloStatus.canUseAiCoach).toBe(true);
    expect(marloStatus.tier).toBe('founder');
    expect(marloStatus.isExempt).toBe(true);
  });

  it('keeps both signed-in and anonymous free users friction-free well past 100 calls', () => {
    const signedIn = resolveClientEntitlement(
      { email: 'judge@hackathon.dev', isAnonymous: false },
      { aiAuditsUsed: 250 },
    );
    expect(signedIn.allowed).toBe(true);
    expect(signedIn.canUseAiCoach).toBe(true);
    expect(signedIn.remainingFreeAudits).toBe(9750);

    const anon = resolveClientEntitlement(
      { isAnonymous: true },
      { aiAuditsUsed: 50 },
    );
    expect(anon.allowed).toBe(true);
    expect(anon.canUseAiCoach).toBe(true);
    expect(anon.remainingFreeAudits).toBe(9950);
  });
});
