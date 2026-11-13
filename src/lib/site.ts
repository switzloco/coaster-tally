/**
 * @fileOverview Canonical base URL for Coaster.
 *
 * Share links, 1-tap email links, and OpenGraph/social metadata are built against this.
 * Override via NEXT_PUBLIC_SITE_URL (no trailing slash).
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://coaster--coaster-tally-2026.us-central1.hosted.app'
).replace(/\/+$/, '');

/** Absolute, branded URL for a shared drink or clear-day snapshot. */
export function shareUrl(shareId: string): string {
  return `${SITE_URL}/m/${shareId}`;
}
