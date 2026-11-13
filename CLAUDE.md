# CLAUDE.md

Engineering guidance for working in the **Coaster** repository (`coaster-tally-2026`).

## Commands

```bash
npm run dev          # Start Next.js dev server with Turbopack on port 9002
npm run genkit:dev   # Start Genkit AI development server
npm run genkit:watch # Start Genkit with watch mode
npm run build        # Production Next.js build
npm run typecheck    # TypeScript check (tsc --noEmit)
npm run lint         # ESLint via Next.js
npm run test         # Run Vitest unit suite
```

## Product & Domain Rules

**Coaster** is a mindful standard drink tally & 30-day trend companion built on **Next.js 15**, **Firebase (`firebase@13.3.0`)**, **Chrome Built-in AI (Gemini Nano)**, and **Genkit 1.x**.

- **Standard Drink Math (`src/lib/drink-units.ts`)**:
  - `1.0 Standard Drink Unit (u) = 14g pure ethanol = 0.6 fl oz pure alcohol` (NIAAA definition).
  - `calculateStandardUnits(volumeOz, abvPct) = Math.round(((volumeOz * (abvPct / 100)) / 0.6) * 10) / 10`.
  - No metabolic/calorie/exercise/protein scoring. Focus strictly on Standard Drink Units, Clear Days (`0.0u`), and Zero-Proof Swaps (`0.0u`).
- **Buddy Persona ("Sunny")**:
  - Sunny is a warm, friendly non-drinking booth-buddy (loves sparkling yuzu, Phony Negronis, ginger hibiscus).
  - Never judge, lecture, or joke about the user being a heavy drinker.
  - Light humor may gently tease pretentious tasting notes, craft beer names, or oversize glassware.
  - Occasionally (~1 in 3 alcoholic drink logs, or when requested) suggest one concrete, appealing zero-proof or lower-ABV swap.

## Architecture

### Stack
- **Next.js 15** (App Router, Turbopack), **React 19**, **TypeScript**, **Tailwind CSS** (Linen Coaster `#FAF6F0` / Amber `#C26D2D` / Sage `#3F7D58` palette)
- **Hybrid AI (`firebase/ai` `^13.3.0`)**:
  - `src/firebase/ai.ts`: `getAI(firebaseApp, { backend: new GoogleAIBackend() })` and `AgentPlatformBackend('global')` fallback
  - `src/firebase/app-check.ts`: `initializeAppCheck` with `ReCaptchaEnterpriseProvider` + `FIREBASE_APPCHECK_DEBUG_TOKEN`
  - `src/firebase/remote-config.ts`: `fetchAndActivate` defaults (`gemini-3.8-flash`) + retired `gemini-2.0-*` sanitizer
  - `src/lib/hybrid-ai.ts`: `PREFER_ON_DEVICE`, `ONLY_ON_DEVICE` (Privacy Vault), `PREFER_IN_CLOUD` (30D Trend Reflection)
  - `src/lib/drink-reconciler.ts`: offline local beverage & zero-proof database
- **Server Genkit Flows**:
  - `src/ai/genkit.ts`: Vertex AI + Google AI Genkit setup (`GOOGLE_GENAI_API_KEY`, env-overridable `CFO_MODEL`)
  - `src/ai/flows/personalized-ai-coaching.ts`: Sunny conversational tally + Firestore tools
  - `src/ai/flows/outreach-meal-parser.ts`: plain-English & photo beverage parser for email replies
  - `src/ai/flows/share-ingestion.ts`: OS Share Target (`/incoming-share` -> `/api/ingest-share`) drink parser
  - `src/ai/flows/data-analyst.ts`: 30D trend analysis

### Firestore Structure (Preserved Rules in `firestore.rules`)
```
/users/{userId}
  ├── /preferences/settings   # Cadence ('2x' default), timezone, buddy prefs, outreach opt-in
  ├── /food_log/{entryId}     # Drink pours, zero-proof swaps, and clear-day entries (standardUnits, isClearDay, isZeroProof, drinkCategory)
  ├── /logs/{logId}           # Daily snapshots
  └── /chat_sessions/{chatId} # Sunny chat history & New Journey greeting
/shared_meals/{shareId}       # Public read-only shared snapshots (server-written via Admin SDK)
```

### 2-Way Email Companion (`+coaster@`)
- Sender: `Sunny · Coaster <nicholas.switzer@gmail.com>` with `replyTo: Sunny · Coaster <nicholas.switzer+coaster@gmail.com>`.
- Inbound isolation (`src/lib/outreach-gmail-inbound.ts`): strictly requires `+coaster@` in `To`, `Delivered-To`, or `envelopeTo` so Coaster never ingests emails meant for other apps on the same Gmail account.
- Default cadence: `'2x'` (`9:00 AM` morning check-in + `7:00 PM` evening check-in in user local timezone).
- Zero-login Live Coaster view (`GET /api/outreach/action?action=view_ledger&t=...`) authenticated via HMAC token (`OUTREACH_TOKEN_SECRET || CRON_SECRET || NEXT_PUBLIC_FIREBASE_APP_ID`).

## Environment Variables & Firebase Project

- **Firebase / GCP Project**: `coaster-tally-2026`
- **Live URL**: `https://coaster--coaster-tally-2026.us-central1.hosted.app`
- **App Hosting Secrets (`apphosting.yaml`)**: `GOOGLE_GENAI_API_KEY`, `GMAIL_APP_PASSWORD`, `CRON_SECRET`
- **Never touch**: `studio-4236902803-1eba2` (`cfofitness.app`) or push directly to the legacy `origin` remote.
- Never print or commit secrets (`GOOGLE_GENAI_API_KEY`, `GMAIL_APP_PASSWORD`, `CRON_SECRET`, tokens).

## Pre-Commit Rules

**Always run `npm run build` and `npm run test` before committing.**
- Any file starting with `'use server'` may ONLY export `async function`s (and `export type { ... }` which is erased at runtime — never constants or plain objects).
- Keep guest anonymous auth (`signInAnonymously`) as the primary entry path and guard popup OAuth calls with `shouldUseRedirectSignIn()` (`src/lib/auth-environment.ts`).
- Do not include `"beta"`, `"placeholder"`, or `"coming soon"` copy in user-facing JSX.
