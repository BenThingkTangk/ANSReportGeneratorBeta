# Architecture Brief — HumanOS ANS Diagnostic App

This is the source-of-truth brief for generating the System Architecture Document.

## Deployment URLs

- Live app: https://humanos-ans-diagnostic.vercel.app
- GitHub: https://github.com/BenThingkTangk/ANSReportGeneratorBeta
- Vercel project ID: prj_dQgeUYPy7AxEiAUlHf61YTN6TW7k

## High-Level Summary

HumanOS ANS Diagnostic is a single-page web application that ingests proprietary binary `.ans` files (autonomic nervous system test recordings from the Ewing / Colombo P&S methodology), parses them, runs a spectral-analysis and pattern-recognition algorithm on the embedded ECG data, and renders a gamified, interactive diagnostic report. It is deployed on Vercel as a static SPA frontend plus two serverless API functions.

## Top-Level Architecture Layers

1. **Client (Browser)** — React SPA, Vite-built, Tailwind + shadcn/ui, hash-based routing.
2. **Edge / CDN** — Vercel's global CDN serves the static bundle; rewrites route `/api/*` to serverless functions and everything else to `index.html`.
3. **API (Serverless)** — Two Node.js functions on Vercel (`api/upload.ts`, `api/health.ts`).
4. **Algorithm Layer** — Self-contained inside `api/upload.ts`: binary parser, signal-processing (R-peak detection, FFT-based spectral analysis), Colombo P&S classification, wellness scoring model.
5. **Shared Schema** — Zod types in `shared/schema.ts` (used by the legacy Express server path for local dev only — Vercel path has types inlined).
6. **Dev-Only Express Server** — `server/index.ts`, `server/routes.ts` used for `npm run dev`. NOT used in production.
7. **Data / Persistence** — None in production. Dev has in-memory `MemStorage`. All processing is stateless and request-scoped.

## Repository Structure

```
humanos-ans/
├── api/                        # Vercel serverless functions (production API)
│   ├── upload.ts               # POST /api/upload — file parse + report generation (SELF-CONTAINED)
│   └── health.ts               # GET /api/health — health check
├── client/                     # React frontend
│   ├── index.html              # HTML entry
│   └── src/
│       ├── main.tsx            # React root, hash-routing bootstrap
│       ├── App.tsx             # Router, QueryClientProvider, Toaster
│       ├── index.css           # Tailwind base, dark medical theme tokens
│       ├── pages/
│       │   ├── dashboard.tsx   # State machine: upload → analyzing → report
│       │   └── not-found.tsx
│       ├── components/
│       │   ├── UploadScreen.tsx        # Drag-drop .ans uploader
│       │   ├── AnalyzingScreen.tsx     # Real-time progress with staged labels + ECG waveform animation
│       │   ├── ReportDashboard.tsx     # Main report layout
│       │   ├── ReportSlides.tsx        # 5-slide clinical report
│       │   ├── WellnessGauge.tsx       # Animated circular wellness gauge
│       │   ├── MetricCards.tsx         # KPI cards (HRV, stress index, etc.)
│       │   ├── AutonomicWave.tsx       # Animated sympathovagal wave
│       │   ├── PatientSidebar.tsx      # Demographics sidebar
│       │   ├── PerplexityAttribution.tsx
│       │   └── ui/             # shadcn/ui primitives (radix wrappers)
│       ├── hooks/              # use-mobile, use-toast
│       └── lib/
│           ├── queryClient.ts  # TanStack Query client + apiRequest helper
│           └── utils.ts        # cn() class merger
├── server/                     # Dev-only Express server (NOT used on Vercel)
│   ├── index.ts                # Express entry
│   ├── routes.ts               # /api/upload + /api/health (Express version)
│   ├── ansParser.ts            # Dev version of parser (Vercel has inlined)
│   ├── ansAlgorithm.ts         # Dev version of algorithm (Vercel has inlined)
│   ├── storage.ts              # IStorage + MemStorage (unused for ANS processing)
│   ├── vite.ts                 # Vite middleware for dev
│   └── static.ts               # Static file serving for local prod builds
├── shared/
│   └── schema.ts               # Zod schemas + inferred TypeScript types
├── script/
│   └── build.ts                # Local build script
├── vercel.json                 # Vercel routing, function config
├── vite.config.ts              # Vite config (root = client/)
├── tailwind.config.ts          # Tailwind v3 config, dark mode = class
├── tsconfig.json               # Strict TS, moduleResolution: bundler
├── drizzle.config.ts           # Unused (scaffolded from template)
└── package.json
```

## Stack (Verbatim from package.json)

### Core Runtime
- React 18.3.1
- TypeScript 5.6.3
- Node.js 20 (Vercel default)

### Build
- Vite 7.3.0
- @vitejs/plugin-react 4.7
- tsx 4.20 (dev runner)
- esbuild 0.25

### Frontend
- **Routing:** wouter 3.3.5 with `useHashLocation` (hash routing — critical for iframe/static deploys)
- **Data fetching:** @tanstack/react-query 5.60
- **Styling:** Tailwind CSS 3.4.17, tailwindcss-animate, tw-animate-css
- **Component primitives:** shadcn/ui (Radix UI under the hood — 25+ @radix-ui packages)
- **Forms:** react-hook-form 7.55 + @hookform/resolvers + Zod
- **Animation:** framer-motion 11.13
- **Icons:** lucide-react 0.453, react-icons 5.4
- **Charts (available, used in gauges/waves):** recharts 2.15
- **Validation:** zod 3.24, drizzle-zod 0.7

### Backend (prod = Vercel serverless)
- @vercel/node 5.6 (types)
- Serverless function runtime: Node 20.x, 256 MB memory, 30s max duration

### Backend (dev only)
- Express 5.0.1
- multer 2.1.1 (multipart handling for dev)
- ws 8.18
- drizzle-orm 0.39 + pg 8.16 (scaffolded, unused)

## Production Request Flow

```
┌─────────────────┐     HTTPS       ┌──────────────────┐
│  User's browser │ ──────────────> │  Vercel Edge/CDN │
│  (React SPA)    │ <────────────── │  (humanos-ans-   │
└─────────────────┘                 │   diagnostic.    │
        │                           │   vercel.app)    │
        │ user drops .ans file      └──────────────────┘
        │                                    │
        │ POST /api/upload (multipart)       │ routes /api/* via vercel.json rewrites
        │ ──────────────────────────────────>│
        │                                    ▼
        │                           ┌──────────────────┐
        │                           │  Serverless Fn   │
        │                           │  api/upload.ts   │
        │                           │  (Node 20, 256MB)│
        │                           │                  │
        │                           │  1. parseMultipart()
        │                           │  2. parseANSFile(buffer)
        │                           │  3. performSpectralAnalysis() ×4 phases
        │                           │  4. classifyParameter() for each metric
        │                           │  5. generateANSReport() — full clinical report
        │                           │  6. Wellness score (5-factor weighted model)
        │                           └──────────────────┘
        │ <────────── JSON ────────────────── │
        │  { success, patientData, report }   │
        ▼
┌─────────────────┐
│ AnalyzingScreen │ animates progress 0→100%, staged labels
│       ↓         │
│ ReportDashboard │ renders 5-slide clinical report + interactive gauges
└─────────────────┘
```

## Key API Contract

### POST /api/upload
- **Content-Type:** multipart/form-data
- **Field:** `ansFile` (or any field — custom parser grabs the first file part)
- **Max file size:** Practically ~4.5 MB (Vercel serverless body limit). Dev Express allows 50 MB via multer.
- **Response 200:**
  ```ts
  {
    success: true,
    patientData: ANSPatientData,   // parsed demographics + ECG samples
    report: ANSReport              // full clinical report
  }
  ```
- **Response 400/500:** `{ success: false, error: string }`

### GET /api/health
- Returns `{ status: "ok", version: "1.0.0" }`

## The ANS Binary File Format (input)

Big-endian binary format. Structure:

| Offset | Type | Field |
|---|---|---|
| 0 | LP-string (uint32 length + ASCII) | Last name |
| → | LP-string | First name |
| → | 8 bytes | DOB (raw, unreliable — age extracted from later byte) |
| → | LP-string | Gender |
| → | LP-string | Physician |
| → | scan window | Age (single byte flanked by zeros) |
| ~336 | double BE | Sampling interval (0.004 s = 250 Hz) |
| +8 | uint32 BE | Data point count (~232,680 samples) |
| +12 | uint16 BE[] | ECG samples |
| (inline ASCII) | regex-extracted | E/I ratio, Valsalva ratio, 30:15 ratio, ectopic beats, height, test notes |

Sample patient (test file): Pare, Alex, Male, Age 48, 6ft 2in, BMI 25.68, Dr. Colombo, E/I 1.22, Valsalva 1.49, 30:15 1.33, 232,680 samples, 15.5 min recording.

## Algorithm Pipeline (inside api/upload.ts)

1. **parseANSFile(buffer)** — read LP-strings, scan for double-precision sampling interval, extract ECG sample array, regex-extract clinical ratios from inline ASCII.
2. **segmentPhases(ecg, duration)** — partition ECG into 4 phases: baseline (0–33%), deep breathing (33–40%), Valsalva (40–45%), table stand (45–100%).
3. **performSpectralAnalysis(phase, samplingRate)** for each phase:
   - R-peak detection via 75th-percentile adaptive threshold + local maxima + 200ms refractory.
   - Compute RR intervals → mean HR + SDNN (HRV in ms).
   - Discrete Fourier Transform on detrended RR series.
   - Integrate power in LF band (0.04–0.15 Hz) and HF band (0.15–0.4 Hz).
   - Output: RFa (parasympathetic = HF power), LFa (sympathetic = LF power), SB = LFa/RFa, meanHR, hrv.
4. **classifyParameter(value, ranges)** — age-stratified normative ranges (young/middle/senior) produce 5-level classification: Low / Borderline Low / Normal / Borderline High / High.
5. **Dysfunction pattern recognition** — booleans: parasympatheticExcess, parasympatheticWithdrawal, sympatheticExcess, sympatheticWithdrawal, advancedAutonomicDysfunction, POTS (HR Δ ≥ 30), orthostaticDysfunction, syncopeRisk.
6. **Wellness score — 5-factor continuous model**, each sub-score 0–100:
   - Baseline Autonomic Tone (25%) — bandScore of RFa + LFa + HR at rest.
   - Sympathovagal Balance (15%) — baseline SB + stand SB + expected rise on stand.
   - Reflex Integrity (25%) — threshold scoring of E/I, Valsalva, 30:15 + DB RFa gain.
   - Orthostatic Response (20%) — HR Δ on stand + stand LFa/RFa band scores + LFa gain.
   - HRV Reserve (15%) — average SDNN across all 4 phases vs age-expected (young 55 / middle 45 / senior 35 ms) + phase SDNN spread.
   - Weighted sum → age multiplier (1.00 / 1.03 / 1.07) → ectopic beat penalty → floor 15, ceil 100.
7. **Therapy recommendations** — rule-based: Hydration, Low-and-Slow Exercise, Alpha-Lipoic Acid, Nortriptyline — gated by dysfunction flags.
8. **Follow-up interval** — 3 or 6 months based on severity.

## Frontend State Machine (dashboard.tsx)

```
┌─────────┐   file dropped    ┌──────────────┐   report arrives   ┌────────┐
│ upload  │ ─────────────────>│  analyzing   │ ─────────────────> │ report │
└─────────┘                   └──────────────┘                    └────────┘
    ^                                │                                │
    │                                │ error                          │ reset
    └────────────────────────────────┴────────────────────────────────┘
```

- **upload:** Drag/drop zone. On drop → transitions to analyzing.
- **analyzing:** Runs a 16-stage scripted progress animation (~4–5 seconds) while the real POST runs in parallel. When both complete → transitions to report. Stages labeled from "Reading .ans binary..." through "Assembling diagnostic report...".
- **report:** Renders ReportDashboard with WellnessGauge, MetricCards, AutonomicWave, PatientSidebar, and the 5-slide ReportSlides component.

## Build & Deploy

- **Local dev:** `npm run dev` → tsx runs `server/index.ts`, which spins up Express on port 5000 with Vite middleware for HMR. Single port for frontend + backend.
- **Vercel build:** `npm run build:vercel` → `vite build --outDir ../build_output`. Frontend static assets emitted to `/build_output`.
- **Vercel functions:** `api/*.ts` auto-detected as serverless functions, bundled with nft (Node File Tracing).
- **Routing (vercel.json):**
  - `/api/(.*)` → serverless function
  - `/(.*)` → `/index.html` (SPA fallback)

## Security & Operational Notes

- No authentication, no user accounts. Anyone with the URL can upload.
- All processing stateless and request-scoped — no database, no session, no disk persistence.
- Serverless function has 30-second timeout, 256 MB memory.
- File size capped by Vercel's request body limit (~4.5 MB).
- CORS set to `*` on /api/upload.
- HIPAA: **Not HIPAA compliant.** App is a beta/demo. No PHI storage, but data transits over TLS only; no BAA with Vercel configured.

## Known Design Decisions

1. **Self-contained `api/upload.ts`** — parser, algorithm, and types are inlined into the one serverless file (~830 lines) to sidestep Vercel's Node File Tracing failing across `api/` → `server/` → `shared/` directory imports. This was the fix that made the deployed upload endpoint actually work.
2. **Hash routing** (`useHashLocation`) — required because the app is served as a static SPA and may be embedded in iframes.
3. **Dark medical theme** — Tailwind `darkMode: "class"` with a custom teal/cyan accent (#20808D family) on near-black surfaces.
4. **Progress animation is cosmetic** — the 16-stage progress bar is scripted, not tied to actual algorithm progress. Designed for "super cool realtime genUI" feel per user request.

## Document Requirements

Produce a formal System Architecture Document (.docx) covering:

1. Title page (HumanOS ANS — System Architecture, date 2026-04-21, author "Computer", for "Ben O'Leary, ThingkTangk")
2. Table of Contents
3. Executive Summary (1 paragraph)
4. System Overview (purpose, users, scope)
5. Architecture Layers (numbered: Client, Edge/CDN, API, Algorithm, Shared Schema, Dev Express, Data)
6. Component Breakdown (frontend components table, backend function table)
7. Technology Stack (table by category)
8. Request Flow (step-by-step for file upload)
9. API Contract (both endpoints documented)
10. Data Model (ANSPatientData + ANSReport shape)
11. ANS File Format spec
12. Algorithm Pipeline (8 stages documented clearly)
13. Wellness Score Model (the 5-factor breakdown with weights)
14. Frontend State Machine
15. Build & Deployment
16. Security & Compliance Notes
17. Known Design Decisions & Trade-offs
18. File Tree Appendix

Use clean typography (Calibri or Arial), single teal accent (#20808D) used sparingly for headings only, and tables for all structured content. No decorative elements.
