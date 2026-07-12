# HumanOS ANS — Recovery & Verification Report

**Branch:** `recovery/humanos-ans-world-class`
**PR:** [#4](https://github.com/BenThingkTangk/ANSReportGeneratorBeta/pull/4) → base `main` (OPEN; not approved — subagents may not approve PRs)
**Base lineage:** `feat/ans-report-ui-upgrade` @ `6f5f7d1` (tip of the six FINAL-QA safety fixes)
**Head:** `b7f23ec`
**Date:** 2026-07-12
**Environment:** Full existing repo at `/home/user/workspace/humanos-ans` (the managed clone was sparse). Root-owned artifact dirs were repaired with `chown` so the stock toolchain runs unmodified.
**Production deploy:** NOT performed (per instruction).

> This file is the post-implementation report copied from recovery commit
> `b28ecaa` (it supersedes the earlier pre-repair "HARD BLOCK" draft that
> previously occupied this path).

---

## 1. Summary

This is the world-class recovery pass. Beyond preserving and verifying the two
in-progress clinical edits, every original product requirement was **audited
against current runtime behavior** and every genuine gap was implemented,
tested, and committed to PR #4. The bulk of the product (conversational Ask
ATOM, voice, instant deterministic report, admin console with RLS, anatomy
visualization, responsive layout) already existed on the base lineage and was
verified working; the deltas below fill the remaining gaps and harden the
whole.

**Recovery commits on this branch (`6f5f7d1..b7f23ec`) — seven total:**

| Commit | What |
|--------|------|
| `ab506b5` | Honest ECG-derived Ewing (E/I, Valsalva) findings; audience-aware Ask ATOM framing |
| `2a3a034` | PWA shell; Ask ATOM server-side response cache; visible AI-enhance state; admin retrieval-test + parser-health; chunk browsing |
| `c2917d5` | Paired vendor-PDF ingestion (`vendor_reported`); PWA + vendor docs |
| `c174abe` | SDNN / LF-HF label clip fix; admin-gateway tests; extended E2E harness |
| `2067d62` | TTS contract tests; Ask ATOM mic/mode tests; PWA cache headers |
| `b28ecaa` | Verification report (truthful acceptance matrix) |
| `b7f23ec` | **CI fix:** defer PHI-fixture reads to `beforeAll` so the parser suite skips cleanly on CI (see §9) |

---

## 2. Requirement-by-requirement acceptance matrix

Legend: ✅ done & verified · 🟡 done, external activation pending (key/OCR) · ⬜ n/a

| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| 1 | Ask ATOM structured renderer (headings/bullets/key-findings) | ✅ pre-existing | `AtomMarkdown.tsx` renders headings/lists/quotes; verified in client tests |
| 1 | Evidence-conditioned clickable follow-ups | ✅ pre-existing | `buildFollowUps()` + `askAtomEvidence.ts`; gated by therapy/wellness assessability |
| 1 | Conversation branching / history / new-topic | ✅ pre-existing | `branchFrom()` / `reset()` in `AskAtom.tsx` |
| 1 | Fast streaming/caching | ✅ **added caching** | client progressive reveal (pre-existing) + **new bounded TTL/LRU server cache** in `api/ask-atom.ts` keyed on the full grounded conversation |
| 1 | Explicit patient vs clinician chat modes | ✅ pre-existing | in-chat `atom-mode-{patient,clinician}` toggle + role-aware server prompt; test `askAtomVoiceAndModes` |
| 2 | Mic transcription/input | ✅ pre-existing | `useAtomVoice` + `speech.ts` (SpeechRecognition); mic button test added |
| 2 | Server-side ElevenLabs voice `gs0tAILXbY5DNrJrsM6F`, no client secret | 🟡 code complete | `api/tts.ts` pins the voice id server-side; key read from `ELEVENLABS_API_KEY`. Returns **501 → browser fallback** when unconfigured. External step: set the key. |
| 2 | Browser TTS fallback + visible state | ✅ pre-existing | `useAtomVoice` browser `speechSynthesis` fallback; speaking/listening UI state; TTS contract test added |
| 3 | Deterministic report renders immediately; AI progressive/non-blocking | ✅ pre-existing + **enhanced** | both portals build the synopsis synchronously; **new visible "Enhancing with AI…" badge** (`synopsis-enhancing`) shows during best-effort enrichment without blocking |
| 4 | Env username/password admin gateway (not magic-link-only) | ✅ verified | `api/admin-gateway.ts` + `_adminGateway.ts` (scrypt hash, HMAC session, rate-limit); **new `adminGateway.spec.ts`** proves verify/sign/tamper/expiry |
| 4 | Admin views: Supabase/RAG sources/chunks/upload/**retrieval-test**/evals/change-requests/audit/**parser-model-health** | ✅ | sources/upload/evals/change-requests/audit pre-existing; **new retrieval-test** (`api/admin/retrieval-test.ts` + page) and **new parser-health** (`api/admin/parser-health.ts` + page); **chunk browsing** added to knowledge detail |
| 4 | Preserve RLS/roles | ✅ | every new admin endpoint calls `requireRole(...)`; request-scoped Supabase client keeps RLS; no policy changed |
| 5 | Desktop side-by-side nervous-system / core metrics | ✅ pre-existing | `grid lg:grid-cols-2` in `PatientPortalTwoColumn`; confirmed in desktop screenshot |
| 5 | Fix SDNN / LF-HF label clipping | ✅ **fixed** | `AutonomicBalanceGaugeFixed.tsx`: fixed-width, centered, `whitespace-nowrap` label boxes; before/after screenshots |
| 5 | Meaningful body-impact visualization | ✅ pre-existing | `BodyHeatmap` interactive SVG + per-system meters |
| 5 | Purposeful motion + reduced-motion | ✅ pre-existing + maintained | `useReducedMotion()` throughout; new enhance badge honors it |
| 6 | Responsive 390×844 mobile, no launcher overlap | ✅ pre-existing | mobile E2E 390×844 passes; sticky launcher; safe-area insets |
| 6 | PWA manifest / installability / offline shell | ✅ **added** | `manifest.webmanifest` (standalone, 3 icons), PHI-safe `sw.js` (shell-only, never `/api`), `registerSW.ts`, index.html link + meta, `viewport-fit=cover` |
| 6 | Downloadable packaging instructions/artifact | ✅ **added** | `docs/PWA_AND_PACKAGING.md` (install + PWABuilder/Capacitor packaging) |
| 7 | Vendor PDF ingestion as `vendor_reported` (or clear upload contract) | 🟡 **implemented** | `api/upload-vendor.ts` + pure `vendorReport.ts` parser (7 tests) + `VendorPdfCard`; end-to-end verified on a text-layer PDF (9 metrics). Sample Jill PDFs are scanned images → honest `textExtracted:false`; **OCR is the only pending external step** |
| 8 | Robust null/error/loading; all functionality preserved | ✅ | `ErrorBoundary` around portals; dashboard try/catch + resilient upload; new features additive; full suite green |
| 9 | Verify Jill + other fixtures, patient/clinician, admin, Ask ATOM, voice, PWA, desktop/mobile | ✅ | see §3 |
| 10 | Rewrite this report truthfully | ✅ | this document |

---

## 3. Verification results

Root-owned artifact dirs (`dist/`, `eval/runs/`, `node_modules/.vite`,
`typescript/tsbuildinfo`, `.git`) were `chown`ed back to the user so the stock
scripts run unmodified.

| Stage | Command | Result |
|-------|---------|--------|
| ESM import audit | `npm run audit:esm` | ✅ all relative runtime imports explicit `.js` |
| Type check | `tsc --noEmit --incremental false` | ✅ 0 errors |
| Server/ANS tests | `vitest run` | ✅ **157 passed** (18 files) — was 141; +7 vendor, +5 admin-gateway, +4 TTS |
| Client tests | `vitest run --config vitest.client.config.ts` | ✅ **29 passed** (6 files) — +3 voice/modes |
| Accuracy-lab eval | `eval:ci` | ✅ **15/15**, gate **PASSED**, **0 unsafe overclaims**, Flag F1 = 1.000 |
| Production build | `script/build.ts` (→ `/tmp/dist`) | ✅ client **3367 modules** + server bundle; `node --check` clean; `manifest.webmanifest` + `sw.js` emitted at web root |
| Coldstart / handler load | module-import shim | ✅ every new handler loads |
| End-to-end (Playwright) | `qa/e2e-verify.mjs` | ✅ **21/21** on both **Jill** and **Pare** fixtures, desktop 1280×900 + mobile 390×844, **0 uncaught page errors** |

### E2E coverage (21 checks × 2 fixtures)
App loads · upload→parse-review · generate→report · clinician non-empty ·
**patient non-empty (no blank crash)** · clinician↔patient round-trip stable ·
honest not-assessed gating · SDNN+LF/HF labels render · **PWA manifest
standalone+icons** · **service worker served** · **vendor endpoint contract** ·
**admin gateway status**.

### Known non-defects
- `POST /api/synopsis 400` / TTS 501 in the harness — no LLM/ElevenLabs key
  configured; the app renders fully via the deterministic path and browser-voice
  fallback. Not a regression.
- Pre-existing SVG `<circle cy>` chart console **warning** — non-fatal, unrelated
  to changed files; 0 *uncaught* page errors.

---

## 4. Screenshots (safe, deidentified layout captures)

Captured to `/tmp` for layout inspection. **No PHI screenshots are committed**;
`qa/jill-fidelity/*` remains untracked and excluded from every commit. The
captures below are session-local under `/tmp` by design — they must never enter
git. Re-generate anytime with the preview + `qa/shoot.mjs` steps in §6.

Latest final-build captures (`qa/shoot.mjs`, viewports 1280×900 and 390×844):

| Path | View |
|------|------|
| `/tmp/vlog2/shot-desktop-review.png` | Desktop — parse-review |
| `/tmp/vlog2/shot-desktop-patient.png` | Desktop — patient (side-by-side nervous-system ‖ metrics; LF/HF label now inside the gauge) |
| `/tmp/vlog2/shot-desktop-clinician.png` | Desktop — clinician (evidence-by-certainty) |
| `/tmp/vlog2/shot-mobile-review.png` | Mobile 390×844 — parse-review |
| `/tmp/vlog2/shot-mobile-patient.png` | Mobile 390×844 — patient (stacked) |
| `/tmp/vlog2/shot-mobile-clinician.png` | Mobile 390×844 — clinician |

Reference set from the E2E run (`qa/e2e-verify.mjs`, `E2E_OUT=/tmp/vlog`):

| Path | View |
|------|------|
| `/tmp/vlog/e2e-desktop-clinician.png` | Desktop clinician (E2E) |
| `/tmp/vlog/e2e-mobile-clinician.png` | Mobile clinician (E2E) |
| `/tmp/vlog/shot-desktop-patient.png` | Pre-fix desktop patient (shows the LF/HF clipping that `c174abe` fixed) |

---

## 5. Safety & provenance integrity

- Dr. Colombo methodology and the treatment framework are preserved for grounded
  metrics; the Ask ATOM prompt qualifies without diluting substance (no timid
  disclaimer walls).
- Every gate that protected against fabricated spectral/BP values remains. New
  vendor-reported values enter **only verbatim** from an ingested report and are
  tagged `vendor_reported` (interpretable) — never computed or inferred.
- The service worker never caches `/api` or cross-origin traffic, so no
  patient-derived response is persisted client-side.

---

## 6. Preview / start instructions

All commands run from `/home/user/workspace/humanos-ans`.

### A. Production preview (built client + real Vercel `api/*` handlers)
This is the faithful path used for verification (the legacy Express server does
not expose `/api/parse`).

```bash
# 1) Build the client + server bundle (dist/ is now user-owned)
npm run build

# 2) Serve the built client AND mount the real api/*.ts handlers
E2E_PORT=8090 E2E_DIST="$PWD/dist/public" npx tsx qa/e2e-server.mjs
#   → open http://127.0.0.1:8090   (avoid port 5060: Chrome blocks it as unsafe)
```

Optional env for full AI/voice/admin activation (see §7):
`PPLX_API_KEY`, `ELEVENLABS_API_KEY`, `ADMIN_GATEWAY_USERNAME`,
`ADMIN_GATEWAY_PASSWORD_HASH`, `ADMIN_SESSION_SECRET`.

### B. Dev server (Vite HMR)
```bash
npm run dev          # NODE_ENV=development tsx server/index.ts (default PORT 5000)
```

### C. Re-run the automated E2E + screenshots
```bash
# with the preview host from step A running on 8090:
NODE_PATH=/home/user/node_modules \
  E2E_BASE=http://127.0.0.1:8090 E2E_OUT=/tmp/vlog \
  E2E_ANS="$PWD/fixtures/Pare-Alex-Thu-Jul-11-2024.ans" \
  node qa/e2e-verify.mjs           # 21/21 checks

NODE_PATH=/home/user/node_modules \
  E2E_BASE=http://127.0.0.1:8090 E2E_OUT=/tmp/vlog2 \
  E2E_ANS="$PWD/fixtures/Pare-Alex-Thu-Jul-11-2024.ans" \
  node qa/shoot.mjs                # writes shot-*.png to /tmp/vlog2
```

### D. Test / eval gates
```bash
npm run audit:esm
npx tsc --noEmit --incremental false
npm run test:ans        # 157 server tests
npm run test:client     # 29 client tests
npm run eval:ci         # 15/15, gate PASSED, 0 unsafe overclaims
```

### E. Installable PWA
After building and serving (step A), open the app in Chrome/Edge → install icon
in the address bar (or iOS Safari → Share → Add to Home Screen). See
`docs/PWA_AND_PACKAGING.md` for store-wrapper packaging (PWABuilder/Capacitor).

---

## 7. External activations still pending (interfaces complete & tested)

| Item | What's done | Pending external step |
|------|-------------|-----------------------|
| ElevenLabs voice | Endpoint pins voice `gs0tAILXbY5DNrJrsM6F`, 501-fallback, PHI guards, tests | set `ELEVENLABS_API_KEY` |
| Ask ATOM / synopsis LLM | Grounded prompt, cache, grounding tests | set `PPLX_API_KEY` |
| Admin gateway | scrypt/HMAC verified in tests | set `ADMIN_GATEWAY_USERNAME` / `ADMIN_GATEWAY_PASSWORD_HASH` / `ADMIN_SESSION_SECRET` |
| Vendor PDF (scanned) | Full ingestion contract + parser verified on text PDFs | OCR pre-step for image-only PDFs |
| Admin live data | RLS-safe endpoints/pages built | Supabase project env for live rows |

---

## 8. Push / PR

All seven recovery commits (head `b7f23ec`) are pushed to
`recovery/humanos-ans-world-class` and attached to **PR #4** (OPEN, base
`main`). PHI screenshots are intentionally excluded from every commit. No
production deploy was performed.

---

## 9. CI failure → root cause → fix → green re-run

**Symptom.** After the initial push, the GitHub check **"Parser + scoring
regression"** failed (run
[29192385727](https://github.com/BenThingkTangk/ANSReportGeneratorBeta/actions/runs/29192385727/job/86649178327))
at the `npm run test:ans` step:

```
FAIL api/_ans/__tests__/parseStudy.spec.ts [ ... ]
Error: ENOENT: no such file or directory, open
  '/home/runner/work/.../fixtures/Pare-Alex-Thu-Jul-11-2024.ans'
 ❯ api/_ans/__tests__/parseStudy.spec.ts:39:15
Test Files  1 failed | 17 passed (18)
```

Local runs were green because the two real-patient `.ans` fixtures exist in
this environment; they are **`.gitignore`'d for PHI compliance**, so they are
absent on a clean CI checkout. CI is the source of truth.

**Root cause.** `parseStudy.spec.ts` called `readFileSync(FIXTURE_PARE)` /
`readFileSync(FIXTURE_FRANCEY)` **in the body of a `describe()` block**. Vitest
executes a describe callback during *collection* even when it is
`describe.skip`, so the top-level read threw `ENOENT` before the skip could take
effect. The `existsSync`-gated `describe.skip` was therefore ineffective.

**Fix (no assertion weakened, no test skipped that shouldn't be).** Moved the
fixture read + `parseStudy()` into `beforeAll()` in both real-binary suites.
`beforeAll` runs only when the suite actually executes, so `describe.skip` now
truly no-ops on a clean checkout. Commit `b7f23ec`, one file changed.

- With fixtures **present** (local): `parseStudy.spec.ts` runs **all 21 tests**
  (0 skipped) — assertions fully intact.
- With fixtures **absent** (CI): the 11 real-binary tests **skip**, the 10
  synthetic/confidence tests still run — no collection error.

**Reproduction & verification.** Hid the fixtures (mirroring CI) → reproduced
the exact `ENOENT`. Applied the fix → `10 passed | 11 skipped`, no error.
Restored fixtures → `21 passed`. Full CI-equivalent gates locally: `npm run
check` (tsc 0), `npm run test:ans` (157/157 present · 146+11-skip absent),
`eval:ci` (15/15, gate PASSED, 0 unsafe overclaims).

**Green re-run.** Workflow run
[29192726694](https://github.com/BenThingkTangk/ANSReportGeneratorBeta/actions/runs/29192726694)
completed **success**. All required PR #4 checks green:

| Check | Result |
|-------|--------|
| Parser + scoring regression | ✅ pass |
| Vercel Preview Comments | ✅ pass |
| Vercel – ans-report-generator-beta | ✅ pass |
| Vercel – humanos-ans-diagnostic | ✅ pass |

PR #4 remains OPEN (not merged, not deployed).
