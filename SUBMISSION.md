# #BuildHybridAI 2026 — Official Submission Guide
## Project: **Coaster — Mindful Standard Drink Tally & Trend Companion**

- **Live Production App**: `https://coaster--coaster-tally-2026.us-central1.hosted.app`
- **GitHub Repository**: `https://github.com/switzloco/coaster-tally`
- **Firebase Project**: `coaster-tally-2026`
- **Open-Source License**: [`Apache-2.0`](./LICENSE)
- **Primary SDKs**: `firebase@13.3.0` (`firebase/ai`, `firebase/app-check`, `firebase/remote-config`, `firebase/firestore`, `firebase/auth`) + Chrome Built-in AI (`window.LanguageModel` Prompt API & Multimodal Prompt API) + Genkit 1.x

---

## 1. Product Vision & #BuildHybridAI Fit

### Why Coaster
Tracking alcohol mindfully fails when apps feel clinical, judgmental, or dependent on a strong cellular connection inside a restaurant, bar, or travel setting. **Coaster** reimagines mindful drink tracking around a warm, human booth-buddy (**Sunny**) and objective **NIAAA Standard Drink Units** (`1.0u = 14g pure ethanol = 0.6 fl oz pure alcohol`)—with zero guilt, zero point scoring, and equal warmth for Clear Days and Zero-Proof Swaps.

### Why Hybrid AI Is Essential Here
1. **Zero-Connectivity Venue Logging**: Restaurants, basement taprooms, lounges, and flights often have weak or offline connections. Coaster combines **Firestore Offline Persistence** (`persistentLocalCache`) with **On-Device Gemini Nano** (`InferenceMode.PREFER_ON_DEVICE`) and an embedded deterministic beverage reconciler (`src/lib/drink-reconciler.ts`) so natural-language tallies commit instantly with zero cloud round-trip.
2. **Strict Privacy for Sensitive Habits**: Drinking notes and personal reflections are deeply personal. Coaster's **Privacy Vault** runs with `InferenceMode.ONLY_ON_DEVICE`, guaranteeing raw personal notes never leave the browser.
3. **Deep Cloud Synthesis When Online**: Weekly and 30-day multi-entry trend reflections (`InferenceMode.PREFER_IN_CLOUD`) route upward to `gemini-3.8-flash` (configured via **Firebase Remote Config** and protected by **Firebase App Check**) for rich pattern spotting and tailored zero-proof alternatives, while gracefully falling back to on-device Nano if offline.

---

## 2. Hybrid Architecture & Runtime Module Map

| Feature / Requirement | Key File Path | Runtime Symbols / APIs |
| :--- | :--- | :--- |
| **Firebase AI Logic Initialization** | [`src/firebase/ai.ts`](./src/firebase/ai.ts) | `getAI(firebaseApp, { backend: new GoogleAIBackend() })`, `AgentPlatformBackend('global')` |
| **Firebase App Check** | [`src/firebase/app-check.ts`](./src/firebase/app-check.ts) | `self.FIREBASE_APPCHECK_DEBUG_TOKEN`, `initializeAppCheck`, `ReCaptchaEnterpriseProvider` |
| **Firebase Remote Config** | [`src/firebase/remote-config.ts`](./src/firebase/remote-config.ts) | `getRemoteConfig`, `fetchAndActivate`, `getValue`, `sanitizeCloudModelName` (`gemini-3.8-flash` default, retired `gemini-2.0-*` guard) |
| **Offline-First Firestore Cache** | [`src/firebase/sdk.ts`](./src/firebase/sdk.ts) | `initializeFirestore`, `persistentLocalCache`, `persistentMultipleTabManager` |
| **Chrome Origin Trial Tag** | [`src/app/layout.tsx`](./src/app/layout.tsx) | `<meta httpEquiv="origin-trial" ... />` |
| **Hybrid AI Engine (4 Modes + Execution Receipts)** | [`src/lib/hybrid-ai.ts`](./src/lib/hybrid-ai.ts) | `getGenerativeModel`, `InferenceMode.PREFER_ON_DEVICE`, `InferenceMode.ONLY_ON_DEVICE`, `InferenceMode.PREFER_IN_CLOUD`, `Schema.object`, `result.response.inferenceSource`, `window.LanguageModel.availability()`, `LanguageModel.create({ monitor })` |
| **NIAAA Drink Math & Trend Aggregation** | [`src/lib/drink-units.ts`](./src/lib/drink-units.ts) | `calculateStandardUnits`, `DRINK_PRESETS`, `computeDailyTrendSeries`, `computeWeeklyTrendSeries`, `computeDayOfWeekPattern`, `computeTrendSummary` |
| **Offline Beverage & Zero-Proof Reconciler** | [`src/lib/drink-reconciler.ts`](./src/lib/drink-reconciler.ts) | `reconcileDrinkDescription`, `reconcileDrinkItems` (80+ beers, wines, spirits, cocktails, seltzers, NA swaps, clear-day triggers) |
| **Telemetry & Hybrid UI** | [`src/components/local-ai-telemetry-bar.tsx`](./src/components/local-ai-telemetry-bar.tsx)<br>[`src/components/hybrid-ticker-terminal.tsx`](./src/components/hybrid-ticker-terminal.tsx)<br>[`src/components/quarterly-earnings-modal.tsx`](./src/components/quarterly-earnings-modal.tsx)<br>[`src/components/execution-receipt-badge.tsx`](./src/components/execution-receipt-badge.tsx) | Local Nano warmup bar, shorthand & photo parser, 30D Trend Spotter modal, `ON_DEVICE` vs `IN_CLOUD` execution badges |
| **Multimodal & Multi-Channel Ingestion** | [`src/app/api/transcribe/route.ts`](./src/app/api/transcribe/route.ts)<br>[`src/app/incoming-share/page.tsx`](./src/app/incoming-share/page.tsx)<br>[`src/app/api/ingest-share/route.ts`](./src/app/api/ingest-share/route.ts)<br>[`src/lib/outreach-gmail-inbound.ts`](./src/lib/outreach-gmail-inbound.ts)<br>[`src/app/api/outreach/action/route.ts`](./src/app/api/outreach/action/route.ts) | Voice transcription, PWA Web Share Target (`public/manifest.json`), isolated `+coaster@` 2-way Gmail companion, Zero-Login Live Coaster view |
| **Server Coaching & Flows (Genkit + Gemini)** | [`src/ai/genkit.ts`](./src/ai/genkit.ts)<br>[`src/ai/flows/personalized-ai-coaching.ts`](./src/ai/flows/personalized-ai-coaching.ts)<br>[`src/ai/flows/outreach-meal-parser.ts`](./src/ai/flows/outreach-meal-parser.ts)<br>[`src/ai/flows/share-ingestion.ts`](./src/ai/flows/share-ingestion.ts) | Genkit tool-calling flows in Sunny's warm, non-judgmental voice |

---

## 3. Judge Testing Instructions (Zero-Registration Entry)

Judges can explore **Coaster** immediately with **zero account signup** via 1-click Anonymous Guest entry on the landing screen.

### Path A — Instant Test in Any Browser (Automatic Cloud Fallback)
1. Open `https://coaster--coaster-tally-2026.us-central1.hosted.app` (or run `npm run dev` -> `http://localhost:9002`).
2. Click the primary **Continue as Guest** button (`signInAnonymously`).
3. Inspect the top **Local AI Telemetry Bar**: browsers without Gemini Nano cleanly show Cloud Fallback mode alongside Remote Config & App Check status.
4. Log drinks in **Today** (1-tap presets or custom `oz` + `ABV%` calculator) or **Sunny** (natural shorthand like `"2 hazy IPAs and a sparkling yuzu"` or a bottle/menu photo). Every parsed item displays its NIAAA Standard Drink Units (`u`) and an execution receipt badge (`ON_DEVICE` or `IN_CLOUD`).
5. Open **Trends** to view the Daily + 7-Day Average bar chart, 12-Week + Mon–Sun day-of-week rhythm chart, 90-Day calendar heatmap, and **Sunny's 30D Trend Spotter** (`InferenceMode.PREFER_IN_CLOUD`).
6. Open **Settings -> Privacy Vault** to trigger a strict on-device 30-day audit (`InferenceMode.ONLY_ON_DEVICE`), verifying that cloud transmission is blocked when Gemini Nano is not active.

### Path B — Full On-Device Gemini Nano + Offline DevTools Test (Chrome Desktop v138+)
1. In Chrome Desktop, enable both flags and relaunch Chrome:
   - `chrome://flags/#optimization-guide-on-device-model` -> **Enabled BypassPerfRequirement**
   - `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` -> **Enabled**
2. Open the app, enter as Guest, and click the Nano warmup control in the top telemetry bar (`LanguageModel.create({ monitor })`) until it reads online.
3. Open **Chrome DevTools (`F12`) -> Network -> Offline**:
   - Notice the offline ledger indicator activates cleanly.
   - Enter `"16oz 6.8% hazy IPA and a Phony Negroni"` in the shorthand parser and submit.
   - `firebase/ai` runs locally on Gemini Nano (`InferenceMode.PREFER_ON_DEVICE`), reconciles against `drink-reconciler.ts`, stamps `ON_DEVICE`, and commits to Firestore's IndexedDB `persistentLocalCache` with zero outbound requests.
4. Run the **Privacy Vault** audit (`InferenceMode.ONLY_ON_DEVICE`) while still offline to confirm local-only 30-day insights.
5. Re-enable network throttling (`No throttling`) and open **Sunny's 30D Trend Spotter** (`InferenceMode.PREFER_IN_CLOUD`) to observe intentional upward routing to Cloud Gemini (`gemini-3.8-flash`).

---

## 4. 2m30s Video Walkthrough Script

1. **`[0:00 – 0:25]` A New Journey & Standard Drink Clarity**: Show the warm Linen Coaster landing screen, NIAAA `1.0u` unit cards (`12oz 5% beer`, `5oz 12% wine`, `1.5oz 40% spirit`), and 1-click Guest entry.
2. **`[0:25 – 1:05]` Offline Bar-Booth Tally (`PREFER_ON_DEVICE`)**: Flip Chrome DevTools Network to `Offline`, enter `"2 hazy IPAs at trivia and a sparkling yuzu"`, show `ON_DEVICE` execution receipt + zero network traffic + instant Firestore `persistentLocalCache` commit.
3. **`[1:05 – 1:35]` Privacy Vault (`ONLY_ON_DEVICE`)**: Trigger the private 30-day reflection audit while offline / with Privacy Vault locked, highlighting that raw notes never leave the browser.
4. **`[1:35 – 2:00]` Multimodal Bottle & Menu Photo Parse (`PREFER_ON_DEVICE`)**: Upload a drink/tap-list photo, show normalized `inlineData` parsing into Standard Drink Units and an optional zero-proof swap from Sunny.
5. **`[2:00 – 2:30]` 30D Trend Spotter (`PREFER_IN_CLOUD`) & 2-Way Gmail Companion**: Go back online, open Trends + Sunny's 30D Trend Spotter (`gemini-3.8-flash` via Remote Config & App Check), and show the 2x daily `+coaster@` email & Zero-Login Live Coaster view.
