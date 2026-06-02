# ANS Accuracy Lab

A local-first eval and regression framework for the deterministic ANS parser
(`api/_ans/parseStudy.ts`) and scoring engine (`api/_ans/scoring/`). Every
parser or scoring change must keep all gold cases passing before deployment.

## Layout

```
eval/
├── buildFixtures.ts        # generator for synthetic, PHI-free fixtures
├── fixtures/               # source-of-truth gold cases (JSON, base64-embedded .ans)
├── corrections/            # JSONL of clinician corrections (append-only)
├── runs/                   # per-run summaries + history.jsonl
├── regression-gate.json    # CI thresholds (overridable)
├── runner/
│   ├── runEval.ts          # CLI entrypoint (`npm run eval`)
│   └── compareCase.ts      # pure case comparator
└── README.md               # this file
```

## Run locally

```bash
npm run eval                  # run all fixtures, human-readable report
npm run eval -- --filter normal-001-female-45    # single case
npm run eval -- --json        # raw JSON to stdout (for tooling)
npm run eval:ci               # CI mode (used in GitHub Actions)
npm run eval:build-fixtures   # regenerate fixtures from buildFixtures.ts
```

Exit codes:

- `0` — every gate passed
- `1` — at least one gate violated
- `2` — runner exception

Each run writes a full summary to `eval/runs/<runId>.json` and appends a
one-line digest to `eval/runs/history.jsonl`.

## Regression gate

CI fails when any of these are violated (see `eval/regression-gate.json`):

| Metric | Default floor | Why |
| --- | --- | --- |
| `minPassRate` | `1.0` | every gold case must pass |
| `minDemographicsAccuracy` | `0.95` | patient identity is high-stakes |
| `minNumericAccuracy` | `0.90` | ratios and vitals drive scoring |
| `minMissingDetection` | `1.0` | missing data must never be silently filled |
| `minFlagF1` | `0.85` | phenotype detection P/R |
| `maxUnsafeOverclaims` | `0` | HARD ZERO — phenotypes may not assert without data |

`maxUnsafeOverclaims` is the safety invariant. An "unsafe overclaim" is a
phenotype flag emitted as `present=true` while every one of its declared
`sourceFields` is `null` in the parsed study. The engine should be incapable
of producing one; if it ever does, CI blocks the merge.

## Adding a gold case

Three paths, ordered by preference:

### 1. Edit `buildFixtures.ts`

Add a new `FixtureSpec` to the `FIXTURES` array, then run:

```bash
npm run eval:build-fixtures
npm run eval
```

The spec drives a synthetic `.ans` buffer through `buildSyntheticAns()` and
embeds it base64 into a single JSON file under `eval/fixtures/`. Use the
helper `buildAsciiBlock({hr,sbp,dbp}, {hr,sbp,dbp}, {ratios...})` so the
parser's sectionizer sees a clean `Baseline / Standing / Autonomic Ratios`
layout.

### 2. Write the JSON file directly

Create `eval/fixtures/<my-case-id>.json` conforming to the `EvalCase` shape in
`shared/evalTypes.ts`. Base64-encode the `.ans` bytes into `ansBase64`.
Useful when curating an anonymized real export (see PHI policy below).

### 3. Submit via the admin Accuracy Lab UI

Open `/admin/accuracy-lab`, select a fixture, edit the expected JSON, write
notes, tick "Promote to new fixture", and submit. The server appends to
`eval/corrections/corrections.jsonl` (and to the `ans_clinician_corrections`
table when Supabase is configured) and writes a new fixture file under
`eval/fixtures/correction-<timestamp>-<src-id>.json`.

## Schema overview (`shared/evalTypes.ts`)

```ts
EvalCase {
  id, description, scenario, source, ansBase64, fileName,
  expectedFields: {
    lastName?, firstName?, ageAtStudy?, sex?, physician?, dob?,
    samplingRateHz?, baselineHr?, baselineSbp?, baselineDbp?,
    standHr?, standSbp?, standDbp?,
    eiRatio?, valsalvaRatio?, thirtyFifteenRatio?,
    expectedMissing?: string[],          // dotted AnsStudy paths
  },
  expectedScores: {
    cardiovagal?, adrenergic?, sudomotor?: ExpectedDomainScore,
    expectedTotalSeverity?, totalSeverityTolerance?,
    expectedReportConfidence?: "Low" | "Medium" | "High",
  },
  expectedFlags: {
    phenotypes: [{ id, present: true|false|"absent", minConfidence? }],
    expectedBlockedClaims?: string[],
    expectedFindingCodes?: string[],
    forbiddenFindingCodes?: string[],
  },
}
```

Each scalar expectation is `{ value: T | null, tolerance?: number }`:

- `value: null` asserts the field MUST be missing
- numeric values are compared with `±tolerance`
- string values are compared case-insensitive trimmed

`expectedFlags.phenotypes[i].present`:

- `true` → flag must be emitted and present
- `false` → flag must be emitted with present=false
- `"absent"` → flag must not be emitted at all

## PHI policy — non-negotiable

- **Never** commit a fixture containing real patient names, DOBs, MRNs,
  physician names, or any identifier that could re-identify a real person.
- Use the convention `TestPatient One/Two/...` with synthetic DOBs.
- Anonymized real exports go through manual scrub + clinician review before
  being added to `eval/fixtures/`. They get `source: "anonymized_real"`.
- Clinician corrections submitted through the UI are stored on the server
  filesystem and (optionally) Supabase — make sure both surfaces are
  PHI-safe before enabling persistence in shared environments.

## CI

`.github/workflows/ans-eval.yml` runs on every push to `main` and every PR
targeting `main`. The workflow runs `npm run check`, `npm run test:ans`, and
`npm run eval:ci`. Run artifacts are uploaded for 30 days under the
`ans-eval-run-<run-id>` artifact name.

## Admin endpoints

- `GET /api/admin/eval-cases` — list fixtures (super_admin, clinical_admin)
- `GET /api/admin/eval-cases?id=<id>` — fixture + parsed study + summary
- `POST /api/admin/eval-run` — trigger an ad-hoc run (returns `EvalRunSummary`)
- `POST /api/admin/eval-correction` — save a clinician correction; optionally
  promote to fixture
