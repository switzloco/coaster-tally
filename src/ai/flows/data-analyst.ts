import { ai, CFO_LITE_MODEL } from '@/ai/genkit';
import { z } from 'genkit';
import { getAdminFirestore } from '@/firebase/admin';
import { adminHealthService as healthService } from '@/lib/health-service-admin';
import { trackAiUsage } from '@/lib/ai-usage';

const calculateStatsTool = ai.defineTool(
  {
    name: 'calculate_statistics',
    description: 'Calculates mean, median, variance, standard deviation, min, max, and sum for an array of numbers. Use this to ensure accurate math when analyzing data.',
    inputSchema: z.object({
      numbers: z.array(z.number()),
    }),
    outputSchema: z.object({
      mean: z.number(),
      variance: z.number(),
      stdDev: z.number(),
      min: z.number(),
      max: z.number(),
      sum: z.number(),
      count: z.number(),
    })
  },
  async (input) => {
    const nums = input.numbers;
    if (nums.length === 0) return { mean: 0, variance: 0, stdDev: 0, min: 0, max: 0, sum: 0, count: 0 };
    const sum = nums.reduce((a, b) => a + b, 0);
    const mean = sum / nums.length;
    const variance = nums.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / nums.length;
    return {
      mean,
      variance,
      stdDev: Math.sqrt(variance),
      min: Math.min(...nums),
      max: Math.max(...nums),
      sum,
      count: nums.length,
    };
  }
);

const fetchHistoricalDataTool = ai.defineTool(
  {
    name: 'fetch_historical_data',
    description: 'Fetches the user\'s drink/pour ledger (`food`), activity, or legacy logs over a specified number of days (up to 180) so you can inspect NIAAA Standard Drink Units, clear days, zero-proof swaps, categories, and day-of-week patterns.',
    inputSchema: z.object({
      userId: z.string(),
      localDate: z.string().describe('The current local date YYYY-MM-DD from the client, used as the anchor for "today"'),
      type: z.enum(['food', 'exercise', 'fasting']),
      daysBack: z.number().describe('Number of days to look back. e.g. 7 for a week, 30 for a month, 90 for a quarter. Max 180.'),
    }),
    outputSchema: z.any(),
  },
  async (input) => {
    const firestore = getAdminFirestore();
    const daysBack = Math.min(input.daysBack, 180);
    const [year, month, day] = input.localDate.split('-').map(Number);
    const startDate = new Date(year, month - 1, day - (daysBack - 1));
    const startDateStr = startDate.toLocaleDateString('en-CA');

    if (input.type === 'exercise') {
      // Paginate the full range so a 180-day analysis isn't silently truncated.
      return await healthService.queryLogRangeAll(
        firestore, input.userId, 'exercise_log', startDateStr, input.localDate,
      );
    }

    if (input.type === 'food') {
      return await healthService.queryLogRangeAll(
        firestore, input.userId, 'food_log', startDateStr, input.localDate,
      );
    }

    if (input.type === 'fasting') {
      return await healthService.queryFastLogRange(
        firestore,
        input.userId,
        startDateStr,
        input.localDate,
        200
      );
    }
  }
);

export const dataAnalystFlow = ai.defineFlow(
  {
    name: 'dataAnalystFlow',
    inputSchema: z.object({
      userId: z.string(),
      localDate: z.string(),
      query: z.string(),
    }),
    outputSchema: z.string(),
  },
  async (input) => {
    let result;
    const generateConfig = {
      system: `You are Coaster's Trend & Data Analyst helper, supporting Sunny · Coaster.
Your job is to answer analytical questions about the user's beverage tally, NIAAA Standard Drink Units (\`standardUnits\` or \`alcoholDrinks\`, where 1.0u = 14g / 0.6 fl oz pure ethanol), Clear Days (\`isClearDay\`), zero-proof swaps (\`isZeroProof\`), drink categories (\`beer\`, \`ipa\`, \`wine\`, \`cocktail\`, \`spirit\`, \`seltzer\`), day-of-week rhythms (e.g. Friday vs weekday), and multi-month trends.

RULES:
1. ALWAYS use the \`fetch_historical_data\` tool with \`type: "food"\` to retrieve their actual \`food_log\` pour history (do not guess numbers). Note that ignored entries are already filtered out, while entries with \`isClearDay: true\` or \`isZeroProof: true\` count as 0.0 standard units.
2. When summing per day or comparing days without an entry: count days with \`isClearDay: true\`, explicit \`0.0u\`, or zero-unit days between their first tracked log and yesterday clearly and accurately.
3. Use \`calculate_statistics\` to compute exact totals, daily means, variance, standard deviation, min, and max — never do multi-day stats in your head.
4. Keep your tone warm, observant, and completely non-judgmental — never scold, lecture, score morally, or make drunk jokes.`,
      prompt: input.query,
      tools: [fetchHistoricalDataTool, calculateStatsTool],
      config: {
        temperature: 0.2,
        maxTurns: 5,
      }
    };

    try {
      result = await ai.generate({
        ...generateConfig,
        use: [trackAiUsage({ uid: input.userId, feature: 'data_analyst' })],
      });
    } catch (err: any) {
      const msg = String(err?.message ?? err ?? '').toLowerCase();
      const status = err?.status || err?.statusCode;
      if (status === 429 || msg.includes('429') || msg.includes('resource_exhausted') || msg.includes('quota')) {
        throw err;
      }
      console.warn(`[DataAnalystFlow] Primary model failed, trying fallback model (${CFO_LITE_MODEL}):`, err?.message ?? String(err));
      result = await ai.generate({
        model: CFO_LITE_MODEL,
        ...generateConfig,
        use: [trackAiUsage({ uid: input.userId, feature: 'data_analyst', model: CFO_LITE_MODEL })],
      });
    }

    return result.text;
  }
);
