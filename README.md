# Coaster (`coaster-tally-2026`)

**Mindful Standard Drink Tally & 30-Day Trend Companion powered by Hybrid AI.**

- **Live App**: `https://coaster--coaster-tally-2026.us-central1.hosted.app`
- **Repository**: `https://github.com/switzloco/coaster-tally`
- **License**: [`Apache-2.0`](./LICENSE)

**Coaster** turns casual drink counting into a calm, warm, zero-judgment ritual. Instead of willpower quizzes, streak shaming, or arbitrary point scores, Coaster counts pours in **NIAAA Standard Drink Units** (`1.0u = 14g pure ethanol = 0.6 fl oz pure alcohol`) alongside **Clear Days** and **Zero-Proof Swaps**—with **Sunny**, your friendly non-drinking booth-buddy who loves sparkling yuzu and Phony Negronis.

---

## Core Experience

- **NIAAA Standard Drink Units**:
  - `12 oz` at `5% ABV` beer / hard seltzer = **`1.0u`**
  - `5 oz` at `12% ABV` table wine = **`1.0u`**
  - `1.5 oz` at `40% ABV` distilled spirit = **`1.0u`**
  - General formula: `round(((volumeOz * (abvPct / 100)) / 0.6) * 10) / 10`
- **Every Input Path Works Seamlessly**:
  - **1-Tap Drink Presets & Custom Calculator**: Light beer (`0.8u`), Lager (`1.0u`), Craft IPA (`1.9u`), Wine (`1.0u`), Bold Wine (`1.5u`), Spirit (`1.0u`), Cocktail (`2.0u`), Zero-Proof Swap (`0.0u`), and Clear Day (`0.0u`).
  - **Natural-Language Shorthand & Photo Label/Receipt Scanner**: Log `"2 hazy IPAs and a sparkling yuzu"` or snap a tap list/can/menu photo offline or online.
  - **Voice Logging (`/api/transcribe`)**: Dictate pours, volumes, and ABV on the go.
  - **OS Share Target (`/incoming-share` -> `/api/ingest-share`)**: Share drink links, text, or photos directly from your phone's share sheet.
  - **2-Way Gmail Companion (`+coaster@`)**: Morning & evening check-ins (`2x` daily at `9:00 AM` and `7:00 PM` local time) with 1-tap quick-log buttons, plain-English or photo replies, and a zero-login **Live Coaster & Trends** web view.
- **30-Day & 90-Day Trends**:
  - Daily bars + 7-day rolling average
  - 12-week trend + Mon–Sun day-of-week rhythm
  - 90-day Coaster calendar heatmap
  - **Sunny's 30D Trend Spotter**: Structured insights, drink-mix breakdown, and concrete zero-proof / lower-ABV swap ideas.

---

## Hybrid AI Architecture (`#BuildHybridAI 2026`)

Built for Google's **#BuildHybridAI 2026** hackathon, Coaster runs a single unified `firebase/ai` (`^13.3.0`) Hybrid Web SDK surface across **On-Device Gemini Nano** (Chrome Built-in `window.LanguageModel` Prompt API & Multimodal Prompt API) and **Cloud Gemini** (`gemini-3.8-flash` configured via Firebase Remote Config):

| Capability | `InferenceMode` | How Hybrid / On-Device Wins |
| :--- | :--- | :--- |
| **Top-Bar Local AI Telemetry & Warmup** | `LanguageModel.availability()` + `create({ monitor })` | 1-click warmup downloads/initializes Gemini Nano weights with live progress telemetry and surface readiness. |
| **Instant Beverage Shorthand Tally** | `InferenceMode.PREFER_ON_DEVICE` | Sub-second offline parsing (`"2 hazy IPAs at trivia"`) at `$0.00` cloud cost using `Schema.object(...)` passed to both `onDeviceParams.promptOptions.responseConstraint` and `inCloudParams.generationConfig.responseSchema`, reconciled against an embedded offline beverage database (`src/lib/drink-reconciler.ts`). |
| **Multimodal Bottle / Menu / Receipt Parser** | `InferenceMode.PREFER_ON_DEVICE` | Normalizes bottle labels, bar receipts, or drink photos client-side into `image/jpeg` / `image/png` `inlineData` and executes locally via Chrome's Multimodal Prompt API when enabled, with automatic Cloud Gemini fallback. |
| **Privacy Vault On-Device Audit** | `InferenceMode.ONLY_ON_DEVICE` | Strict zero-cloud guarantee for private 30-day drink & clear-day reflections; raw personal notes never leave the browser. |
| **30D Trend Reflection (Trend Spotter)** | `InferenceMode.PREFER_IN_CLOUD` | Upward cloud routing (`gemini-3.8-flash` from Firebase Remote Config) for multi-week trend synthesis and personalized zero-proof swap ideas, falling back to Gemini Nano when offline. |
| **Execution Receipt Badges** | `result.response.inferenceSource` | Surfaces whether each parse/reflection ran `ON_DEVICE` (Gemini Nano) or `IN_CLOUD` (Gemini Cloud) alongside latency. |

See [**`SUBMISSION.md`**](./SUBMISSION.md) for the complete **#BuildHybridAI 2026** submission breakdown, module pointers, and judge walkthrough.

---

## Tech Stack

- **Framework**: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS (warm Linen Coaster & Amber Lounge theme)
- **Hybrid AI**: `firebase/ai` (`^13.3.0`, `GoogleAIBackend`, `AgentPlatformBackend`, `InferenceMode`, `Schema.object`, `result.response.inferenceSource`) + Chrome Built-in AI (`window.LanguageModel`)
- **Firebase Platform**:
  - Offline-first Cloud Firestore (`initializeFirestore` with `persistentLocalCache` + `persistentMultipleTabManager`)
  - Firebase Auth (1-click Anonymous guest entry, Email/Password, Google Sign-In with WKWebView-safe redirect guard)
  - Firebase Remote Config (`gemini-3.8-flash` + retired `gemini-2.0-*` sanitizer)
  - Firebase App Check (`ReCaptchaEnterpriseProvider` + debug token support)
  - Firebase App Hosting (`apphosting.yaml`)
- **Server AI & Email**: Genkit 1.x + Gemini, Nodemailer + ImapFlow (`+coaster@` Gmail isolation), Cloud Scheduler cron dispatch

---

## Quick Start

```bash
cp .env.example .env.local   # Populate GOOGLE_GENAI_API_KEY and optional App Check / email keys
npm install
npm run dev                  # Launches http://localhost:9002
```

### Verification Commands

```bash
npm run typecheck            # TypeScript check (tsc --noEmit)
npm run lint                 # Next.js ESLint check
npm run test                 # Vitest unit test suite
npm run build                # Production Next.js build
```

### Enabling Chrome On-Device Gemini Nano (Optional — Cloud Fallback Works Everywhere)

1. Open **Chrome Desktop (v138+)** on macOS, Windows, or Linux (22 GB+ free disk, 4 GB+ VRAM or 16 GB+ RAM).
2. Enable `chrome://flags/#optimization-guide-on-device-model` -> **Enabled BypassPerfRequirement**.
3. Enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` -> **Enabled**.
4. Relaunch Chrome, open `http://localhost:9002` (or `https://coaster--coaster-tally-2026.us-central1.hosted.app`), enter as a guest, and warm the local Nano engine from the top telemetry bar.

---

## Documentation

- [**`SUBMISSION.md`**](./SUBMISSION.md) — `#BuildHybridAI 2026` submission overview, architecture map, judge verification steps, and 2m30s walkthrough script
- [**`CLAUDE.md`**](./CLAUDE.md) — Engineering conventions, Firestore schema, and pre-commit rules
- [**`.env.example`**](./.env.example) — Documented environment variables (zero committed secrets)

## License

Licensed under the [**Apache License, Version 2.0**](./LICENSE).
