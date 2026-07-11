# HumanOS ANS Diagnostic — Release v1.0 (.ans accuracy upgrade)

**Release branch:** `feat/ans-report-ui-upgrade`
**Status:** Production candidate
**Scope:** Deterministic .ans extraction, structured scoring, evidence-linked reporting, transparency UI.

This release replaces the previous heuristic, LLM-driven .ans interpretation
with a fully deterministic parser + CASS-style scoring engine, gated by a
field-level confidence layer the user can audit before a report is generated.

No PHI is logged, embedded, or transmitted as part of this release. All
fixtures used in CI are synthetic, labeled `TestPatient`.

---

## What's new

### Deterministic `.ans` parser
- New `parseStudy()` pipeline at `api/_ans/parseStudy.ts`.
- Tri-layer extraction: LabVIEW binary header → ASCII section headers →
  whole-file regex fallback. Each extracted value carries provenance
  (offset, source layer, raw string, matched synonym).
- Synonym dictionary at `api/_ans/synonyms.ts` (open for extension via
  `HOW_TO_ADD_SYNONYM.md`) lets the parser recognize device variants
  without code changes.
- Plausibility validators (`api/_ans/validators.ts`) flag out-of-range
  HR/BP/LFa/RFa/SB instead of silently accepting them.
- Conflict detection: DOB-vs-age mismatch, SBP < DBP, resting SB ≠
  LFa/RFa, study-date normalization.

### Field-level confidence
- Every extracted field carries a `ProvField<T>` with `confidence` (High /
  Medium / Low) and provenance metadata.
- `parserConfidence` aggregate exposes: overall score, sections detected,
  sections missing, missing field count, low-confidence field count.

### Structured `AnsStudy` JSON
- Shared schema in `shared/ansStudy.ts` covering demographics, anthropometry,
  file metadata, all four phase blocks (baseline / deep breathing / Valsalva /
  stand-tilt), ratios, resting + standing sympathetic/parasympathetic
  metrics, and a parsed ECG preview.
- Download from the new Parsed Data Review screen as
  `<basename>.parsed.json`.

### CASS-style domain scoring
- Independent scorers for cardiovagal (`scoreCardiovagal`), adrenergic
  (`scoreAdrenergic`), and sudomotor (`scoreSudomotor`) domains.
- Each `DomainScore` returns `{ value, severity, rationale, sourceFields,
  confidence, assessable, notAssessedReason }`.
- Domains missing required inputs are returned as `assessable: false` with
  a human-readable reason — never defaulted to "normal".

### Missing-data protection
- `unsafeOrUnsupportedClaimsBlocked[]` lists every claim the engine refused
  to make because of missing inputs, with the missing field list and
  explanation.
- Eval regression includes two "missing" fixtures and two "edge_case"
  fixtures that verify the engine never overclaims on partial data.

### Evidence-linked explanations (PR4)
- Every abnormal finding carries `sourceFields` (dotted AnsStudy paths) and a
  `thresholdRef`.
- Every phenotype flag carries `criteria[]` with `met` flag, description,
  and the source field used.

### Parsed Data Review UI (PR5)
- New `/api/parse` endpoint runs the parser without generating a report.
- New review screen between upload and report shows every extracted
  domain with provenance icons, confidence chips, and tooltips containing
  the raw matched string.
- "Why this conclusion?" expanders appear under every abnormal finding and
  active phenotype flag in the clinician portal, showing the rationale,
  criteria status, observed values, and threshold ref.
- Missing Data card, Conflicting Data card, Confidence Gauge.
- Download Parsed JSON, Re-parse, Generate Report buttons. Generate is
  disabled until parsing succeeds.

### Eval / regression framework
- `eval/runner/runEval.ts` runs 12 synthetic .ans fixtures spanning
  normal, abnormal, conflicting, edge-case, low-quality, and
  missing-data scenarios.
- `npm run eval:ci` reports demographics accuracy, numeric accuracy,
  missing-data detection, phenotype precision/recall/F1, and unsafe
  overclaim count.
- New `eval/runner/pr6Smoke.ts` validates the 11 PR6 acceptance
  criteria (patient name, DOB, study date, all four phases, missing data
  protection, confidence panel shape, diagnostic summary correctness)
  against every fixture. Current pass rate: **183/183 checks across 12
  fixtures.**

---

## Quality gates (this release)

| Gate | Result |
| ---- | ------ |
| TypeScript (`tsc --noEmit`) | clean |
| Unit + parser + scoring tests (`npm run test:ans`) | 57 / 57 |
| Eval regression (`npm run eval:ci`) | 12 / 12 cases |
| PR6 acceptance smoke (`pr6Smoke.ts`) | 183 / 183 checks |
| Production build (`npm run build`) | success |

---

## Known limitations

- **Phase timing not extracted.** `startSec` / `endSec` on each phase
  block remain `missingField` pending PR for timeline reconstruction.
- **Device string not extracted** in PR1 parser; left as missingField.
- **Sudomotor scoring is stubbed** beyond the assessable/not-assessed
  gate — substantive QSART rule logic deferred to a future release.
- **Sampling probe fallback** can miss very old .ans files that pack the
  `(interval, count)` doubles outside the heuristic window. The parser
  emits a `SAMPLING_PROBE_FAIL` warning rather than silently failing.
- **Bundle size:** the client JS bundle is ~2.1 MB unsplit (~580 KB
  gzipped). Code-splitting deferred to a follow-up release; functionality
  is unaffected.
- **No live-clinical validation** has been performed. All accuracy
  metrics in this release are against synthetic fixtures.

---

## Next recommended clinical validation steps

1. **Blind extraction comparison.** Run the parser against a curated set
   of ~50 anonymized real-world .ans files alongside the prior
   LLM-driven path. Reviewer rates each per-field extraction as
   correct / partial / wrong. Target: ≥95% correct on demographics,
   ≥90% on phase metrics.
2. **Independent clinician scoring.** Have two ANS-trained clinicians
   independently score the same anonymized batch. Compute κ between
   each clinician and the engine. Target: κ ≥ 0.7 for
   normal/abnormal classification.
3. **Confidence calibration.** Bin findings by reported confidence and
   verify empirical accuracy matches the band: High ≥90%, Medium
   ≥70%, Low ≥40%.
4. **Edge-case audit.** Pediatric, athlete-bradycardia, and pacemaker
   cases (each presents elevated risk of misclassification). Add
   targeted fixtures to the eval suite.
5. **Drift monitoring.** Daily run of `npm run eval:ci` in CI; alert on
   any regression below the current 1.000 F1.
6. **PHI handling review.** Privacy/security review of upload paths
   prior to onboarding any covered entity. Current build does not
   persist uploaded files — confirm in the production environment.

---

## Migration notes

- Frontend: legacy `/api/upload` response shape is unchanged; new
  `/api/parse` is additive. Clients calling `/api/upload` directly are
  not affected.
- Backend: no database schema changes in this release.
- Operational: no new secrets or environment variables required.

---

## Post-release hotfix + hardening (2026-06-03)

A production cold-start crash was observed on `/api/parse` returning
HTTP 500 with `x-vercel-error: FUNCTION_INVOCATION_FAILED` and no
userland log surface. Root cause: under `"type":"module"` ESM on
Vercel's Node 24 runtime, relative *runtime* imports must include an
explicit `.js` extension. Several files in the scoring chain
(`api/_ans/scoring/index.ts`, `api/_ans/scoring/cardiovagal.ts`) were
missing those extensions on runtime imports. Local tests passed because
`tsx`/`vitest` perform their own resolution; only Vercel's bundler/runtime
was strict.

### Fix

- Added explicit `.js` extensions on all runtime imports in the parser
  and scoring chain.
- Inlined `setCorsHeaders` in `/api/parse` and added per-stage error
  reporting so future handler-time failures surface as JSON with the
  failing stage tag (`parseMultipart` → `parseStudy` → `computeDiagnosticSummary`)
  instead of an opaque 500.

### Hardening (prevents this entire class of bug)

- **ESM import auditor** — `scripts/audit-esm-imports.mjs` walks
  `api/`, `shared/`, `server/` and flags every relative runtime import
  that is missing an explicit `.js` extension. Type-only imports are
  excluded. Supports `--fix` for in-place rewrite.
- **`prebuild:vercel` hook** — runs `npm run audit:esm && tsc --noEmit`
  on every Vercel build. A missing `.js` will now fail the deploy
  before reaching production.
- **`api/**` is now part of the main `tsconfig.json`** — previously
  excluded, which masked 3 pre-existing TS errors. All resolved:
  `api/_evidenceRetrieval.ts` (MapIterator), `api/admin/knowledge/upload.ts`
  (pdf-parse default export), `api/upload.ts` (Indication[] vs string[]).
- **TypeScript `target` raised to `ES2022`** (was defaulting to ES3),
  matching the Vercel Node 20+/24 runtime.
- **Cold-start smoke script** — `scripts/coldstart-smoke.mjs <baseUrl>`
  probes every `/api/*` endpoint with `OPTIONS` and fails on any 5xx.
  Available as `npm run smoke:coldstart <baseUrl>`. Current production
  passes 19/19.
- **Aggregate `ci` script** — `npm run ci` runs the audit, typecheck,
  57/57 unit tests, and 12/12 eval gate in sequence.

### Verification

- `npm run audit:esm` — clean across api/, shared/, server/
- `npm run check` (full `tsc --noEmit` including `api/**`) — 0 errors
- `npm run test:ans` — 57/57 pass
- `npm run eval:ci` — 12/12 fixtures, F1 1.000
- `npx tsx eval/runner/pr6Smoke.ts` — 183/183 acceptance checks pass
- `npm run smoke:coldstart https://humanos-ans-diagnostic.vercel.app` —
  19/19 endpoints load without 5xx
- Live end-to-end .ans upload (~633 KB) on production — HTTP 200, full
  `ansStudy` + `diagnosticSummary` payload returned

---

## v2 Hardening — cache-bust, observability, AI accuracy uplift

Deployed: 2026-06-03 · Commit: `3f8319e` · Production: https://humanos-ans-diagnostic.vercel.app

### Browser-side cache-bust + observability

- **`vercel.json` headers** — `index.html` and `/` served with
  `cache-control: public, max-age=0, must-revalidate`; all hashed assets in
  `/assets/*` served with `max-age=31536000, immutable`. Eliminates the
  "old shell loads new chunks" stale-bundle class of bug.
- **`/api/health` enriched** with `deploy.{commitSha, commitShortSha,
  commitMessage, branch, env, region, buildTime, deploymentUrl}`,
  `runtime.{node, platform, arch, now}`, plus permissive CORS so the UI
  can probe it from any origin.
- **Build-info badge** — vite injects `__BUILD_COMMIT__`,
  `__BUILD_COMMIT_SHORT__`, `__BUILD_TIME__` globals (declared in
  `client/src/vite-env.d.ts`). New `<BuildInfo />` component renders a
  bottom-right badge; click expands and fetches `/api/health` to compare
  client vs server commit, showing a red warning if they disagree.

### Resilient upload client

- New `client/src/lib/resilientUpload.ts` exporting `resilientUpload<T>()`.
  AbortController with 60 s default timeout (90 s for `/api/upload`'s
  longer pipeline), retry-once on 5xx or network failures, captures
  `x-vercel-id` from every response, emits structured telemetry via
  `console.info("[upload]", ...)`.
- Dashboard wires both `parseFile` (`/api/parse`) and `generateReport`
  (`/api/upload`) through `resilientUpload`. User-visible error toasts now
  carry the exact diagnostic context:
  `"<error> (stage: <stage>) (after <N> attempts) [req:<vercelId>]"`
  so any failure can be traced to a single Vercel request.

### AI accuracy uplift

- **`api/_ans/synonyms.ts` — +25 clinical aliases**:
  - HR: Mean / Resting Heart Rate, Pulse Rate, "beats/min" unit, "HR avg"
  - BP: Systolic/Diastolic Blood Pressure (long form), Systolic/Diastolic
    Pressure, SYS / DIA short codes
  - New `RR_INTERVAL` field — R-R, RR, Mean RR, Mean R-R, Mean NN, NN
    Interval, RRI (ms / msec)
  - Tilt section now also matches "Tilt-Up", "Upright Tilt", "VRT", "PRT",
    "Vertical Recovery Test"
  - New `SUDOMOTOR` field — QSART, Quantitative Sudomotor Axon Reflex
    Test, Sweat / Sudomotor Response, Sudomotor Function, ESC,
    Electrochemical Skin Conductance
  - New `ORTHOSTATIC_INTOLERANCE` field — Postural Tachycardia,
    Orthostatic Intolerance, OI / OI Score
  - Ectopic beats: + PACs, Premature Ventricular / Atrial Contractions
  - Symptoms: + gastroparesis / PEM / loss of consciousness / panic
    attack / lethargy / pounding heart / mental cloudiness / GI
    dysmotility / thermoregulatory / bladder dysfunction
  - Patterns: + neurocardiogenic, neurally mediated syncope, nOH,
    cardiovagal impairment, sudomotor dysfunction / SFN, adrenergic
    failure
- **`api/_ans/scoring/phenotypes.ts` — strict confidence gate**: new
  `strictConfidence(base, fields)` helper applied across all six phenotype
  detectors. **Hard-cap at Low** when any required input is `null`;
  **soft downgrade one notch** when any provenance is weak
  (`source ∈ {missing, filename, computed}` or `confidence < 0.5`).
  Eliminates the "High confidence claim with zero evidence" class of bug
  reported in v1.
- **3 new eval fixtures** (12 → 15 total):
  - `pediatric-001-age-14` — adolescent baseline (HR rise of 20 bpm and
    elevated E:I are physiologic, no phenotype flags)
  - `athlete-001-bradycardia` — endurance athlete with resting HR 44
    bpm, preserved vagal tone, no false-positive POTS or CAN
  - `mixed-001-pots-and-cardiovagal` — POTS-like HR rise + severe
    cardiovagal impairment without OH; locks `possible_can_risk` OFF
    when only one domain is impaired

### Verification

- `npm run audit:esm` — clean across `api/`, `shared/`, `server/`
- `npx tsc --noEmit` — 0 errors
- `npm run test:ans` — 57/57 pass
- `npm run eval:ci` — 15/15 fixtures, F1 1.000, 0 unsafe overclaims
- `npx tsx eval/runner/pr6Smoke.ts` — **232/232** acceptance checks
  (was 183 in v1)
- `node scripts/coldstart-smoke.mjs https://humanos-ans-diagnostic.vercel.app`
  — 19/19 endpoints load without 5xx
- Live `.ans` upload on production — HTTP 200, full payload in 171 ms,
  `x-vercel-id: pdx1::iad1::gwh55-…`
- `/api/health` confirms deployed `commitShortSha = 3f8319e`, region
  `iad1`, node `v24.14.1`
