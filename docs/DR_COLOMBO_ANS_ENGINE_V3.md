# The Dr. Colombo ANS Engine — v3

_HumanOS × PhysioPS Autonomic Nervous System (ANS) reporting engine._
_Audience: clinicians, engineers, and reviewers. Last updated for the `feat/ans-report-ui-upgrade` (v3) branch._

> **This tool is clinical decision support, not a diagnostic device.**
> It never outputs a "diagnosis." Every interpretation is framed as a *pattern
> consistent with* a state, is tied to the specific measured inputs that produced
> it, and must be confirmed by a clinician against the full clinical picture.
> Verbatim envelope used across the app:
> `"This is clinical decision support, not a diagnosis. Confirm with clinical correlation."`
> (`shared/diagnosticSummary.ts` → `DIAGNOSTIC_DISCLAIMER`).

---

## 1. What the engine does, end to end

```
 .ans file (upload)
      │  POST /api/upload  (Vercel fn)  ·  multer memory storage, 50 MB cap
      ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ 1. PARSE  (deterministic)                                    │
 │    api/_ans/parseBinary.ts · parseStudy.ts · sectionizer.ts  │
 │    validators.ts · synonyms.ts · legacyAdapter.ts            │
 │    → normalized `AnsStudy` (shared/ansStudy.ts)              │
 │      incl. study.parserConfidence { overall, … }            │
 └─────────────────────────────────────────────────────────────┘
      ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ 2. SCORE  (deterministic, rules-first)                       │
 │    api/_ans/scoring/{cardiovagal,adrenergic,sudomotor,       │
 │      phenotypes,index}.ts  +  api/_ans/thresholds.ts         │
 │    → `DiagnosticSummary` (shared/diagnosticSummary.ts)       │
 │      domain scores · phenotype flags · blocked claims ·      │
 │      reportConfidence · explanationBullets · disclaimer      │
 └─────────────────────────────────────────────────────────────┘
      ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ 3. EXPLAIN + CITE  (deterministic + optional evidence)       │
 │    api/explanations.ts · api/_evidenceRetrieval.ts           │
 │    shared/evidenceTypes.ts                                   │
 │    → `ExplainedReport` — each bullet tagged                  │
 │      evidence-backed | rule-based | blocked                  │
 └─────────────────────────────────────────────────────────────┘
      ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ 4. NARRATE  (AI — Perplexity Sonar, EXPLAINS ONLY)           │
 │    api/synopsis.ts (patient + clinician synopses)            │
 │    api/ask-atom.ts (grounded chat)                           │
 │    RAG: api/_knowledgeCache.ts + Supabase Knowledge Library  │
 │    → warm/precise prose that references, but never changes,  │
 │      the deterministic numbers above                         │
 └─────────────────────────────────────────────────────────────┘
      ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ 5. RENDER                                                    │
 │    client/src — patient portal + clinician report,           │
 │    confidence badges, data-quality panel, charts,            │
 │    accessible body map, voice (Web Speech + /api/tts)        │
 └─────────────────────────────────────────────────────────────┘
```

The single most important architectural rule is stated in code at the top of the
scorer and the shared type module:

> _"The AI narrative layer is allowed to EXPLAIN this output but never override it."_
> — `api/_ans/scoring/index.ts`, `shared/diagnosticSummary.ts`

Everything below elaborates on that boundary.

---

## 2. The deterministic core (steps 1–3)

The core is **pure, rules-first, and reproducible**: the same `.ans` file always
produces the same `DiagnosticSummary`, independent of any network call, API key,
or model. No AI runs in steps 1–3.

### 2.1 Parser → `AnsStudy`

- **Binary decode** (`api/_ans/parseBinary.ts`) reads the PhysioPS `.ans` container.
- **Sectionizer** (`api/_ans/sectionizer.ts`) splits the payload into labeled
  sections; **synonyms** (`api/_ans/synonyms.ts`) map the many header spellings
  PhysioPS exports have used over the years onto canonical field names
  (see `api/_ans/HOW_TO_ADD_SYNONYM.md`).
- **`parseStudy.ts`** assembles a normalized `AnsStudy` (`shared/ansStudy.ts`),
  including the six-phase event means (Baseline-A, Deep-Breathing-B, Baseline-C,
  Valsalva-D, Baseline-E, Stand-F) and the time-domain ratios (E/I, Valsalva,
  30:15), plus HRV time-domain values (RMSSD, SDNN) where present.
- **`validators.ts`** performs range / sanity checks and produces
  `study.parserConfidence` — an `overall` 0..1 quality signal (driven by ECG SNR,
  motion fraction, missing sections, impossible values, etc.).
- **`legacyAdapter.ts`** bridges older report shapes so historical files still parse.

**Key safety property:** the parser never fabricates values. A field that is not
present in the file stays absent; it is not defaulted. That absence propagates all
the way to "not assessed" in the UI rather than silently reading as "normal."

### 2.2 Scoring → `DiagnosticSummary`

`api/_ans/scoring/index.ts` exposes the single entry point:

```ts
computeDiagnosticSummary(study: AnsStudy, options?: { thresholds?: Thresholds })
  : DiagnosticSummary   // never throws on partial/missing data
```

Pipeline:

1. **Per-domain scoring** — three independent deterministic scorers:
   - `cardiovagal.ts` — E/I, Valsalva, 30:15 ratios vs **age-banded** thresholds.
   - `adrenergic.ts` — orthostatic SBP/DBP drop and POTS-like HR rise
     (baseline → stand).
   - `sudomotor.ts` — **stubbed**: the current `.ans` format carries no sudomotor
     (QSART) data, so this domain returns `assessable: false` with a reason. The
     scaffolding exists so a future QSART-capable input plugs in without a rewrite.
   Each returns a `DomainScore` with a 0..3 severity value (`0 normal … 3 severe`),
   a `severity` label, a `rationale`, the `sourceFields` it used, a per-domain
   `Confidence`, and `assessable`.

2. **Severity totals** — `totalAutonomicSeverityScore` sums **assessed domains
   only**; `maxPossibleScore = (#assessed) × 3`. Missing domains are **never**
   counted as 0 (that would understate abnormality).

3. **Phenotype detection** (`phenotypes.ts`, via `detectPhenotypes`) evaluates
   pattern flags against the scored context:
   `orthostatic_hypotension`, `pots_like`, `cardiovagal_impairment`,
   `adrenergic_impairment`, `parasympathetic_withdrawal`, `sympathetic_excess`,
   `possible_can_risk`, `insufficient_data`. Every flag records the **exact
   criteria** it evaluated (met / not met) and whether required inputs were
   present. Flags that could not be evaluated become **blocked claims**.

4. **Explanation bullets + disclaimer envelope** are assembled deterministically
   and returned on the summary.

The full output shape is `shared/diagnosticSummary.ts` → `DiagnosticSummary`.

### 2.3 Confidence model (deterministic)

Confidence is a first-class, computed field — not a vibe. From
`api/_ans/scoring/index.ts`:

- **Bands:** numeric → `High ≥ 0.75`, `Medium ≥ 0.4`, else `Low`
  (`numericToConfidence`). Categorical rank: `High=2, Medium=1, Low=0`.
- **Blend:** when at least one domain is assessable,
  `reportConfidenceScore = 0.4 × parserConfidence + 0.6 × meanDomainConfidence`.
  Domain confidence is weighted higher "because that's what the clinician acts on."
  If nothing is assessable, it falls back to parser confidence alone.
- **Cap (the important part):** the displayed band is
  `min(parserBand, domainBand)`. **A clean-looking ratio can never lift a report to
  "High" if the parser quality was "Low."** Garbage-in is surfaced, not hidden.

`reportConfidence` (band) and `reportConfidenceScore` (0..1) are both on the
summary. The UI renders them via `ConfidenceBadge` and the patient "Data quality:
low/medium/high" line (`client/src/components/patient/PatientPortal.tsx`).

### 2.4 Thresholds are parameters, not medical truth

`api/_ans/thresholds.ts` opens with an explicit warning: these tables are
**configurable clinical thresholds, NOT immutable medical facts.** They:

- are **age-banded** (E/I, Valsalva, 30:15 all decline with age), seeded from
  commonly cited autonomic literature (Ewing et al.; Low et al.);
- use the consensus orthostatic-hypotension criterion (SBP drop ≥ 20 / DBP ≥ 10 mmHg)
  and the POTS HR criterion (sustained ≥ 30 bpm rise on standing);
- include ECG-quality gates (`minSnrDb`, `maxMotionFraction`) that downgrade
  confidence rather than silently accepting noisy input;
- are **overridable** — pass a `Thresholds` object into `computeDiagnosticSummary`
  to recalibrate per lab/population without touching engine code.

`bandForAge()` resolves the applicable band and falls back to the widest band when
age is missing, so scoring degrades gracefully instead of throwing.

### 2.5 Safety invariants (enforced in code, not by convention)

From `shared/diagnosticSummary.ts` and the scorer:

- **Missing inputs ≠ normal.** Unmeasurable domains → `assessable:false` +
  `missingDomains`, never a zero score.
- **Patterns, not diagnoses.** Phenotype labels are phrased *"pattern consistent
  with X,"* never *"patient has X."*
- **Transparency of omission.** Anything the engine *wanted* to assert but
  couldn't (missing field) is recorded in `unsafeOrUnsupportedClaimsBlocked`
  (`BlockedClaim` with the exact missing field paths) and shown in the Data
  Quality panel — the report says what it did **not** say, and why.
- **Severity is separate from phenotype suggestions.**
- **`SCORING_VERSION = "ans-scoring/1.0.0"`** stamps every summary; bump it when
  rules change so eval baselines and audit trails stay meaningful.

---

## 3. The AI ⇄ deterministic boundary (step 4)

### 3.1 The rule

AI is a **narration/translation layer only**. It receives the already-computed
deterministic numbers and turns them into prose. It **cannot**:

- change a score, a severity, a phenotype flag, or a confidence band;
- invent a value the parser didn't produce;
- upgrade "not assessed" into a finding.

Because steps 1–3 run server-side and deterministically **before** any model is
called, the clinical content of a report is identical whether or not the AI layer
is enabled or reachable. If the AI is down, the deterministic report (scores,
flags, confidence, data-quality, charts) still renders; only the warm prose is
degraded/absent.

### 3.2 Where AI is used

| Endpoint | Purpose | Model |
| --- | --- | --- |
| `api/synopsis.ts` | Patient + clinician plain-English synopses (run **in parallel** via `Promise.all`) | Perplexity `sonar` |
| `api/ask-atom.ts` | "Ask Atom" grounded chat (patient/clinician modes) | Perplexity `sonar-pro` |
| `api/explanations.ts` | Composes deterministic bullets with evidence links | deterministic; evidence from Supabase |

**Provider policy: Perplexity Sonar only.** Both AI endpoints call
`https://api.perplexity.ai/chat/completions` with `PPLX_API_KEY` from the
environment, `temperature: 0.3`, bounded `max_tokens`. No other model provider is
used anywhere in the engine.

### 3.3 Prompt guardrails (language safety)

The system prompts (`api/ask-atom.ts`, `api/synopsis.ts`) hard-enforce Colombo
language rules, e.g.:

- never use "diagnose"/"diagnosis"; frame as "consistent with" / "evidence of";
- never "the patient has X"; "consider treating with X" instead of "treat with X";
- use "salt/sodium" not "NaCl"; "ratio" not "unitless";
- soften with "may suggest," "consistent with," "consider";
- output Markdown, reference the patient's abnormal values, never regurgitate the
  full data table, end with a short attribution.

The clinician synopsis intentionally **omits the wellness score** (per Dr. Colombo,
the clinical view focuses on phase metrics and Colombo-defined patterns).

### 3.4 Terminology the model is taught

`LFa` = Low-Frequency Area (sympathetic, bpm²) · `RFa` = Respiratory-Frequency
Area (parasympathetic, bpm²) · `LFa/RFa` = sympathovagal balance (SB) ·
`FRF` = Fundamental Respiratory Frequency. Phases: Baseline-A, DB-B, Baseline-C,
Valsalva-D, Baseline-E, Stand-F.

---

## 4. RAG — the Knowledge Library grounding layer

AI answers are grounded in an **admin-curated** Knowledge Library so the model
cites real, approved sources instead of free-associating.

- **Store:** Supabase (`ans_knowledge_sources`, `ans_knowledge_chunks`), managed
  by the admin subsystem (`api/admin/knowledge*`, migrations under
  `supabase/migrations/`). See `IMPLEMENTATION_NOTES.md` and `ADMIN_SETUP.md`.
- **Activation is gated:** a source is only injected into prompts when it is
  `approved` **and** its `active_in_ai_analysis` toggle is ON. Draft/pending
  sources never reach the model.
- **Cache:** `api/_knowledgeCache.ts` holds active sources for **60 s** and
  exposes `getActiveKnowledgeSources()`, `buildKnowledgePromptSection()`, and
  `toCitations()`. Both AI endpoints inject the knowledge section into the system
  prompt and return `citations` (internal, curated sources) separately from
  `webCitations` (Perplexity's own web results) so the two are never conflated.
- **Retrieval helper:** `api/_evidenceRetrieval.ts` links deterministic rules to
  sources for the evidence layer (below).
- **Audit:** every admin mutation is written to `audit_log`
  (`api/admin/audit.ts`), surfaced in the admin Audit UI
  (`client/src/pages/admin/audit.tsx`).

---

## 5. Evidence layer — "measured" vs "hypothesis"

`shared/evidenceTypes.ts` gives every explanation bullet an honest provenance tag
so readers can tell a **measured, sourced** statement from an **unsourced rule**
from a **blocked** (can't-say) statement:

| `EvidenceMode` | Meaning | UI treatment |
| --- | --- | --- |
| `evidence-backed` | ≥ 1 approved Knowledge source is linked to the firing rule | Show citation(s); this is the "measured + sourced" tier |
| `rule-based` | The deterministic rule fired but no source is linked yet | Labeled: _"Rule-based interpretation — no peer-reviewed source has been linked to this finding yet."_ (`RULE_BASED_LABEL`) |
| `blocked` | A required input was missing | Records what was **not** said + which fields were missing |

Each `ExplanationItem` carries: clinician `text`, patient-facing `patientText`,
the `rule` trace (`RuleRef`), the `sourceFields` it used, per-bullet `confidence`,
its `mode`, and any linked `evidence[]`. `ExplainedReport` records whether the
evidence toggle was on at generation time and carries both a clinical and a warmer
patient disclaimer (`PATIENT_DISCLAIMER`).

### 5.1 Biopsychosocial context, PASC, and investigational topics

The evidence layer is where broader context is added **without** making treatment
claims:

- **Biopsychosocial framing & PASC (Long COVID / post-viral dysautonomia)** are
  presented as *context and possible associations* — e.g., autonomic findings that
  *overlap with* or are *reported in* PASC cohorts — never as a diagnosis of PASC
  and never as a treatment recommendation. These attach to findings via
  `evidence-backed` sources when an admin has linked peer-reviewed literature.
- **Clearly investigational topics** — epigenetics, mitochondrial function,
  peptides, and stem-cell research — are surfaced **only** as
  clearly-labeled "investigational / research" reading, gated behind approved
  Knowledge Library sources, and must carry no dosing, no protocol, and no
  therapeutic claim. If no approved source is linked, the topic is not shown.
  This keeps speculative science visible for interested clinicians while the
  deterministic report and any actionable guidance remain bounded to the measured
  Colombo methodology.

---

## 6. Voice & Text-to-Speech (v3)

- **Input (client):** the Web Speech API (`SpeechRecognition`) is used for
  dictation and only ever starts on an **explicit user mic click** — there is no
  ambient/always-on listening. See `client/src/hooks/useVoice.ts`.
- **Output (server):** `api/tts.ts` proxies **ElevenLabs** text-to-speech.
  - Credentials are **environment-only**: `ELEVENLABS_API_KEY` (never in client
    code, never logged).
  - Default voice id `gs0tAILXbY5DNrJrsM6F`, overridable via
    `ELEVENLABS_VOICE_ID`.
  - **PHI / raw-ANS redaction:** before any text is sent to ElevenLabs it passes
    through a redaction step that strips emails, phone/ID numbers, long digit
    runs, and raw ANS metric read-outs (LFa/RFa/SB/SDNN/RMSSD/E:I/Valsalva/30:15
    + numeric values and tables). The endpoint speaks *interpretation prose*, not
    raw measurements or identifiers.
  - **No PHI/secrets in logs** — the endpoint logs only a generic error string and
    status code, never the request text or the key.

---

## 7. Security & admin access

- **All secrets are environment variables** (`.env.example` is the source of
  truth): `PPLX_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `ELEVENLABS_API_KEY`,
  `ELEVENLABS_VOICE_ID`, and the admin-gateway variables below. The service-role
  key is **server-only** and must never appear in a `VITE_` variable.
- **Existing admin auth:** Supabase magic-link + role allow-list
  (`super_admin` / `clinical_admin` / `reviewer` / `viewer`), enforced by RLS and
  the client `AdminGuard`. See `IMPLEMENTATION_NOTES.md` / `ADMIN_SETUP.md`.
- **v3 env-configured admin gateway:** an additional username + **password-hash**
  gate for the admin surface, configured entirely via environment:
  - `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` (scrypt/argon-style hash — **never a
    plaintext password, never hardcoded**), `ADMIN_SESSION_SECRET`.
  - Verification uses a constant-time comparison (`crypto.timingSafeEqual`) and a
    signed, short-lived session cookie. If the env vars are unset the gate is
    closed (fails safe).
- **Never log PHI or secrets** anywhere in the pipeline. Free-text fields that
  could carry PHI (e.g. change-request `related_report_id`) are documented as
  "no PHI" and should be enforced by clinic workflow.

---

## 8. Known limitations

- **Sudomotor is not assessed** — the `.ans` format carries no QSART data. The
  domain is scaffolded but always returns "not assessed."
- **ECG waveform may be absent.** Some `.ans` exports contain only per-phase
  numerical summaries. When raw ECG is missing, the trend/coupling charts show an
  explicit "raw ECG not present" notice and only the scatter / ratio-vs-age /
  numerical panels populate (`MultiParameterGraphical.tsx`).
- **Thresholds are population defaults.** They should be validated against each
  lab's own reference cohort; they are not universal truth.
- **AI can be wrong or unavailable.** Mitigations: the deterministic report never
  depends on it; prompts are grounded in curated sources; language rules and
  disclaimers are enforced; citations are surfaced. Treat prose as explanation,
  not as an independent source of findings.
- **Not a diagnostic device.** No output should be used as a diagnosis or as a
  substitute for clinical judgment.

---

## 9. Accuracy roadmap

The engine ships with an **evaluation harness** so accuracy is measured, not
assumed:

- **Fixtures** (`eval/fixtures/`): normal, abnormal (cardiovagal-severe,
  orthostatic-hypotension, CAN-risk), missing-data, conflicting, low-quality,
  edge (truncated ECG, impossible DOB), pediatric, athlete, and mixed cases —
  each a synthetic `.ans`-shaped study with expected outputs.
- **Runner** (`eval/runner/runEval.ts`, `npm run eval` / `eval:ci`) scores the
  engine against fixtures; **`eval/regression-gate.json`** encodes the pass/fail
  gate so regressions block CI. Historical runs are kept under `eval/runs/`.
- **CI** (`npm run ci`) chains: ESM import audit → `tsc --noEmit` →
  `vitest run` (unit specs under `api/_ans/__tests__/`) → `eval:ci`.

Planned accuracy work, in priority order:

1. **Threshold calibration** against real, de-identified reference cohorts;
   per-lab override profiles.
2. **Broaden domain coverage** — wire the sudomotor domain when a QSART-capable
   input becomes available; add HRV frequency-domain detail.
3. **Grow evidence coverage** — link every `rule-based` bullet to an approved
   Knowledge source so more of the report reaches the `evidence-backed` tier;
   track coverage % as a metric.
4. **Expand the fixture suite** and add golden-file regression tests for the
   AI-narration boundary (assert the prose never contradicts the numbers).
5. **Clinician-in-the-loop review** via the admin Accuracy Lab / change-request
   workflow, feeding corrections back into fixtures and thresholds.
6. **Confidence calibration** — validate that the `reportConfidenceScore`
   correlates with observed correctness and adjust the blend/cap if not.

---

## 10. Deploy & test quick reference

**Deploy target: Vercel only.** `vercel.json` sets `buildCommand:
"npm run build:vercel"`, `outputDirectory: build_output`, and registers every
`api/**/*.ts` as a serverless function (256 MB, 30 s). SPA rewrites route
non-`/api` paths to `index.html`.

Required environment variables (set in Vercel → Project → Settings → Environment
Variables, for Production **and** Preview; see `.env.example`):

```
PPLX_API_KEY                 # Perplexity Sonar (AI)
SUPABASE_URL                 # server
SUPABASE_SERVICE_ROLE_KEY    # server-only, bypasses RLS
VITE_SUPABASE_URL            # client
VITE_SUPABASE_ANON_KEY       # client (RLS-scoped)
ELEVENLABS_API_KEY           # server-only (TTS)
ELEVENLABS_VOICE_ID          # optional; default gs0tAILXbY5DNrJrsM6F
ADMIN_USERNAME               # env-configured admin gateway
ADMIN_PASSWORD_HASH          # scrypt hash — NEVER a plaintext password
ADMIN_SESSION_SECRET         # signs the admin session cookie
```

Local verification (matches CI):

```
npm run audit:esm        # ESM import hygiene
npm run check            # tsc (type check, noEmit)
npm run test:ans         # vitest unit specs
npm run eval             # deterministic accuracy eval vs fixtures
npm run smoke:coldstart  # cold-start smoke
npm run build            # production build
```

---

## 11. File map (engine-relevant)

```
api/
  upload.ts, parse.ts          parse entry points (Vercel)
  synopsis.ts                  AI: patient + clinician synopses (sonar)
  ask-atom.ts                  AI: grounded chat (sonar-pro)
  explanations.ts              deterministic explanations + evidence
  tts.ts                       ElevenLabs TTS proxy (PHI-redacted)   [v3]
  _knowledgeCache.ts           60 s RAG cache + prompt builder
  _evidenceRetrieval.ts        rule → source linking
  _supabase.ts                 server Supabase client
  admin/*                      knowledge, change-requests, audit, eval, settings
  _ans/
    parseBinary.ts, parseStudy.ts, sectionizer.ts, validators.ts,
    synonyms.ts, legacyAdapter.ts, thresholds.ts
    scoring/{cardiovagal,adrenergic,sudomotor,phenotypes,index}.ts
    __tests__/*.spec.ts        vitest unit tests
shared/
  ansStudy.ts                  normalized AnsStudy type
  diagnosticSummary.ts         DiagnosticSummary + invariants + disclaimer
  evidenceTypes.ts             evidence/measured-vs-hypothesis types
  schema.ts, indications.ts, evalTypes.ts
client/src/
  components/patient/*          patient portal (gauge, body, synopsis, heatmap)
  components/clinician/*        clinician report (MPG charts, findings, refs)
  components/AskAtom.tsx        Ask Atom chat UI
  hooks/useVoice.ts            voice input + TTS playback                [v3]
  pages/admin/*                RAG / audit / accuracy admin UI
eval/                          fixtures + runner + regression gate
```

_© PhysioPS × HumanOS. Clinical decision support only — not a diagnostic device._
