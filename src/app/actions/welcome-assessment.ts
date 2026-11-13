'use server';

import { ai, CFO_LITE_MODEL } from '@/ai/genkit';
import { z } from 'genkit';
import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService as healthService } from '@/lib/health-service-admin';
import { formatUnits, getEntryUnits, isClearDayEntry, isZeroProofEntry } from '@/lib/health-service';
import { checkRateLimit } from '@/lib/rate-limit';
import { trackAiUsage } from '@/lib/ai-usage';
import type { SharedMealItem } from '@/lib/food-exercise-types';

const AssessmentSchema = z.object({
  assessment: z
    .string()
    .describe(
      'A warm, playful 2-3 sentence greeting from Sunny (Coaster booth-buddy) that ends with a low-pressure invite to explore Coaster.',
    ),
});

export type WelcomeAssessmentResult =
  | { success: true; assessment: string }
  | { success: false; error: string };

interface MealSummary {
  /** Required: cached on the share document so each shared entry only generates once. */
  shareId?: string;
  title: string;
  createdByName?: string;
  totals: { calories: number; proteinG: number; carbsG: number; fatG: number; fiberG: number };
  items: (Pick<SharedMealItem, 'name' | 'calories' | 'proteinG' | 'carbsG' | 'fatG' | 'alcoholDrinks'> & {
    standardUnits?: number;
    isZeroProof?: boolean;
    isClearDay?: boolean;
  })[];
}

/**
 * Sunny's welcome note on a shared-coaster link (`/m/[shareId]`).
 * Cached on the share document so repeat page views cost zero LLM tokens.
 */
export async function assessSharedMeal(meal: MealSummary): Promise<WelcomeAssessmentResult> {
  try {
    const db = getAdminFirestore();

    if (meal.shareId) {
      const existingShare = await healthService.getSharedMeal(db, meal.shareId);
      if (!existingShare || existingShare.revoked) {
        return { success: false, error: 'Shared coaster not found.' };
      }
      if (existingShare.cfoAssessment) {
        return { success: true, assessment: existingShare.cfoAssessment };
      }
    }

    const limit = await checkRateLimit(`share_welcome_${meal.shareId || 'anon'}`, 'chat');
    if (!limit.ok) {
      return { success: false, error: 'Rate limit reached.' };
    }

    const { items, title, createdByName } = meal;
    const totalUnits =
      Math.round((items || []).reduce((sum, item) => sum + getEntryUnits(item), 0) * 10) / 10;

    const itemList = (items || [])
      .slice(0, 15)
      .map((i) => {
        if (isClearDayEntry(i)) return `${String(i.name).slice(0, 80)} (Clear Day · 0.0u)`;
        if (isZeroProofEntry(i)) return `${String(i.name).slice(0, 80)} (Zero-Proof · 0.0u)`;
        const units = getEntryUnits(i);
        return `${String(i.name).slice(0, 80)} (${formatUnits(units)})`;
      })
      .join(', ');

    const { output } = await ai.generate({
      model: CFO_LITE_MODEL,
      output: { schema: AssessmentSchema },
      use: [
        trackAiUsage({
          uid: 'public:welcome_assessment',
          feature: 'welcome_assessment',
          model: CFO_LITE_MODEL,
        }),
      ],
      prompt: `You are Sunny ("Sunny · Coaster") — a warm, friendly, non-drinking booth-buddy who loves a clean paper coaster, sparkling yuzu, and honest Standard Drink Unit math without any judgment or lectures.
${createdByName ? `${String(createdByName).slice(0, 50)} just shared this coaster` : 'Someone just shared this coaster'} with a friend who has never tried Coaster before.

Shared title: "${String(title).slice(0, 100)}"
Items: ${itemList || 'n/a'}
Total Standard Drink Units: ${formatUnits(totalUnits)} (where 1.0u = 12oz 5% beer / 5oz 12% wine / 1.5oz 40% spirit)

Write a warm, conversational greeting (2-3 sentences, max ~45 words):
- Open with a light, playful note on the drink(s) — you can gently tease pretentious tasting notes, wild craft beer names, or giant martini glasses, OR give a crisp high-five for zero-proof / Clear Day picks.
- NEVER scold, score, moralize, or joke about someone drinking too much or getting drunk.
- End with a genuinely zero-pressure invitation to explore Coaster (e.g., "want to see how easy it is to keep a relaxed tally and spot your 30-day rhythm, or just look around?").

Return only the greeting text.`,
    });

    if (!output?.assessment) return { success: false, error: 'No response from AI.' };

    const assessment = output.assessment.trim();
    if (meal.shareId) {
      await healthService.saveShareAssessment(db, meal.shareId, assessment);
    }

    return { success: true, assessment };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[WelcomeAssessment] error:', msg);
    return { success: false, error: msg || 'Could not generate greeting.' };
  }
}
