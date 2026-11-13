import type { Metadata } from 'next';
import { BriefingsEnrollView } from '@/components/briefings-enroll-view';
import { SITE_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: '2-Way Email Companion | Coaster',
  description:
    'Gentle Morning & Evening Coaster check-ins by email (+coaster@). Reply in plain English or with a bottle photo, tap quick standard-unit pours, and view your Live Coaster without logging in.',
  openGraph: {
    title: '2-Way Email Companion · Coaster',
    description:
      'Morning & Evening mindful drink check-ins from Sunny. Reply directly by email in plain English or with a photo, pause anytime in 1 tap.',
    url: `${SITE_URL}/briefings`,
    siteName: 'Coaster',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: '2-Way Email Companion · Coaster',
    description:
      'Morning & Evening mindful drink check-ins from Sunny. Reply in plain English or attach a photo.',
  },
};

export default function BriefingsPage() {
  return <BriefingsEnrollView />;
}
