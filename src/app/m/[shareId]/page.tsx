import type { Metadata } from 'next';
import Link from 'next/link';
import { getAdminFirestore } from '@/firebase/admin';
import { healthService } from '@/lib/health-service';
import { FoodLogEntry, SharedMeal, SharedMealItem } from '@/lib/food-exercise-types';
import { formatUnits, getEntryUnits, isClearDayEntry } from '@/lib/drink-units';
import { ShareView, type ShareDTO } from './share-view';

export const dynamic = 'force-dynamic';

function computeShareUnits(items: SharedMealItem[]): number {
  let total = 0;
  for (const item of items) {
    const asEntry = {
      ...item,
      id: 'share-item',
      timestamp: new Date(),
      date: '2026-01-01',
    } as FoodLogEntry;
    if (!isClearDayEntry(asEntry)) {
      total += getEntryUnits(asEntry);
    }
  }
  return Math.round(total * 10) / 10;
}

function toDTO(share: SharedMeal): ShareDTO {
  const totalUnits = computeShareUnits(share.items ?? []);
  return {
    id: share.id,
    title: share.title || 'Shared Coaster Card',
    createdByName: share.createdByName,
    items: share.items ?? [],
    totals: {
      calories: share.totals?.calories ?? 0,
      proteinG: share.totals?.proteinG ?? 0,
      carbsG: share.totals?.carbsG ?? 0,
      fatG: share.totals?.fatG ?? 0,
      fiberG: share.totals?.fiberG ?? 0,
      standardUnits: totalUnits,
    },
    totalUnits,
    logCount: share.logCount ?? 0,
    viewCount: share.viewCount ?? 0,
    cfoAssessment: share.cfoAssessment,
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareId: string }>;
}): Promise<Metadata> {
  const { shareId } = await params;
  try {
    const db = getAdminFirestore();
    const share = await healthService.getSharedMeal(db, shareId);
    if (!share || share.revoked) {
      return {
        title: 'Coaster Card Unavailable',
        description: 'This shared pour link is no longer active.',
      };
    }

    const dto = toDTO(share);
    const title = dto.createdByName
      ? `${dto.createdByName}'s Coaster: ${dto.title}`
      : `${dto.title} — Coaster`;
    const description = `${formatUnits(dto.totalUnits)} across ${dto.items.length} ${
      dto.items.length === 1 ? 'pour' : 'pours'
    } on Coaster.`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: 'website',
      },
    };
  } catch {
    return {
      title: 'Shared Pour Card — Coaster',
    };
  }
}

export default async function SharedMealPage({
  params,
}: {
  params: Promise<{ shareId: string }>;
}) {
  const { shareId } = await params;
  const db = getAdminFirestore();
  const share = await healthService.getSharedMeal(db, shareId);

  if (!share || share.revoked) {
    return (
      <main className="min-h-screen bg-[#FAF6F0] text-[#1F1B18] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-3xl bg-[#FFFDF9] border border-[#E8DFD1] p-8 text-center space-y-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-widest text-[#C26D2D]">
            Coaster
          </p>
          <h1 className="text-2xl font-black tracking-tight">Card Unavailable</h1>
          <p className="text-sm text-[#6E6359]">
            This shared round may have expired or been revoked by its owner.
          </p>
          <Link
            href="/"
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-full bg-[#1F1B18] text-[#FAF6F0] text-xs font-bold hover:bg-[#352F2A]"
          >
            Open Coaster
          </Link>
        </div>
      </main>
    );
  }

  void healthService.incrementShareViewCount(getAdminFirestore(), shareId);

  return <ShareView share={toDTO(share)} />;
}
