import { ImageResponse } from 'next/og';
import { getAdminFirestore } from '@/firebase/admin';
import { healthService } from '@/lib/health-service';
import { FoodLogEntry } from '@/lib/food-exercise-types';
import { formatUnits, getEntryUnits, isClearDayEntry } from '@/lib/drink-units';

export const runtime = 'nodejs';
export const alt = 'Coaster shared pour card';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OgImage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;

  let title = 'Shared Coaster Card';
  let creator = '';
  let totalUnits = 0;
  let pourNames: string[] = [];

  try {
    const db = getAdminFirestore();
    const share = await healthService.getSharedMeal(db, shareId);
    if (share && !share.revoked) {
      title = share.title || title;
      creator = share.createdByName || '';
      const items = share.items ?? [];
      totalUnits =
        Math.round(
          items.reduce((sum, item) => {
            const asEntry = {
              ...item,
              id: 'og',
              timestamp: new Date(),
              date: '2026-01-01',
            } as FoodLogEntry;
            return sum + (isClearDayEntry(asEntry) ? 0 : getEntryUnits(asEntry));
          }, 0) * 10
        ) / 10;
      pourNames = items
        .map((i) => i.name)
        .filter(Boolean)
        .slice(0, 4);
    }
  } catch {
    // render clean fallback card
  }

  const isZero = totalUnits === 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: '#FAF6F0',
          padding: '56px 64px',
          color: '#1F1B18',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: '#C26D2D',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FAF6F0',
                fontSize: 22,
                fontWeight: 900,
              }}
            >
              C
            </div>
            <span style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.02em' }}>
              Coaster
            </span>
          </div>
          {creator && (
            <span style={{ fontSize: 22, fontWeight: 600, color: '#6E6359' }}>
              Shared by {creator}
            </span>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            backgroundColor: '#FFFDF9',
            border: '2px solid #E8DFD1',
            borderRadius: 32,
            padding: '42px 48px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: '68%' }}>
            <span
              style={{
                fontSize: 18,
                fontWeight: 800,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: '#C26D2D',
              }}
            >
              Standard Drink Units
            </span>
            <span style={{ fontSize: 48, fontWeight: 900, lineHeight: 1.1 }}>
              {title}
            </span>
            <span style={{ fontSize: 24, color: '#6E6359', lineHeight: 1.35 }}>
              {pourNames.length > 0 ? pourNames.join('  •  ') : 'Coaster Pour Ledger'}
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              backgroundColor: isZero ? '#EAF3ED' : '#FBF0E4',
              borderRadius: 24,
              padding: '24px 32px',
            }}
          >
            <span
              style={{
                fontSize: 72,
                fontWeight: 900,
                color: isZero ? '#3F7D58' : '#C26D2D',
                lineHeight: 1,
              }}
            >
              {formatUnits(totalUnits)}
            </span>
            <span style={{ fontSize: 20, fontWeight: 700, color: '#6E6359', marginTop: 8 }}>
              {isZero ? 'Zero-Proof / Clear' : 'NIAAA 14g Std'}
            </span>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 20,
            color: '#6E6359',
            fontWeight: 600,
          }}
        >
          <span>Mindful drinks &amp; clear days — zero judgment</span>
          <span>1.0u = 0.6 fl oz pure alcohol</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
