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
