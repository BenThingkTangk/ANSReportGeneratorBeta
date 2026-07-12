# HumanOS ANS — Governance, Provenance & Residual Parity

This document records the accuracy/governance architecture introduced when the
runtime fingerprint-keyed `numericalSummaryOverride` was removed, and states the
residual parity limits honestly.

## 1. What was removed and why

The previous build carried `api/_ans/numericalSummaryOverride.ts`: a table of a
specific patient's PDF "Numerical Summary" values, looked up at runtime by a
study fingerprint (name) and overlaid onto the computed phase metrics. That
**violated generic accuracy** — it passed a memorized, identity-matched vendor
scalar off as a generic computation. It has been **deleted entirely** from
production, along with the tests that blessed it. A guard test
(`api/_ans/__tests__/noRuntimeOracle.spec.ts`) fails the build if it — or any
name/hash-keyed vendor substitution — is reintroduced.

## 2. Generic computation + explicit provenance

Every spectral aggregate (FRF, LFa, RFa, LFa/RFa "SB") is now **computed
generically from the raw ECG-derived arrays** in `analyzePhase` and tagged with
`shared/metricProvenance.ts`:

- `method`: `computed` | `vendor_reported` | `measured` | `unavailable`
- `tier`: `C` (consensus) | `X` (contested) | `P` (proprietary)
- `validation`: `validated` | `estimated` | `not_applicable`

Because our open pipeline only **approximates** the vendor's undisclosed wavelet
algorithm, FRF/LFa/RFa/SB are emitted as `computed / estimated / [P]` and the UI
renders them with a "not vendor-validated" caveat. Phases with insufficient
signal are emitted as `unavailable` and the UI shows **"unavailable"** — never a
fabricated `0`. Nothing is ever substituted by identity/hash.

## 3. Metric evidence-tier caveats ([C]/[X]/[P])

Per `ANS_test_evidence_base_HumanOS.md` §12: SDNN/RMSSD/pNN50/HF/Valsalva/E:I/
30:15 are `[C]`; LF power and LF/HF are `[X]` (never "sympathetic tone"); RFa,
LFa and LFa/RFa "sympathovagal balance" are `[P]` (not independently validated).
The Numerical Summary surfaces the `[P]` caveat inline (`tierCaveat`).

## 4. Safety gates (deterministic, tested)

- **No full adrenergic grade without beat-to-beat BP.** Cuff orthostatic deltas
  yield only an **orthostatic-hypotension screen** (`screenOnly: true` +
  `methodLimitation`); no definitive adrenergic-failure claim. With no BP at all
  the domain is `not_assessed`.
- **No sudomotor assessment without QSART/TST.** Always `not_assessed`.
- **No definitive CAN / POTS / dysautonomia.** Phenotypes are "pattern
  consistent with" suggestions; missing inputs route to
  `unsafeOrUnsupportedClaimsBlocked`, never to an assertion.

Covered by `safetyGates.spec.ts` and surfaced to Ask ATOM via `domainLine`.

## 5. Ask ATOM deterministic grounding

The chat context is built **only** from the report (`buildPatientContext`), so a
hostile user turn cannot unlock blocked data — the same report yields a
byte-identical, deterministic grounding block. Zero-filled spectral values are
rendered as "Not assessed", never as measurements. Covered by
`askAtomGrounding.spec.ts` (including adversarial cases).

## 6. Governed, consented, de-identified evaluation corpus (no online learning)

`shared/evaluationCorpus.ts` defines an **offline** governance layer:

- Records are **de-identified** (age/sex + numeric fields only) and require an
  explicit **consent basis**; non-consented / non-de-identified records are
  rejected, never used.
- **Leakage control** via site/patient partitions (GMLP #4).
- **Pre-specified acceptance criteria** block release on out-of-tolerance `[C]`
  metrics; `[P]` metrics with no reference standard are report-only.
- **No online self-training**: `ONLINE_SELF_TRAINING_ENABLED = false`. Any model
  or threshold change is a manual, versioned release under an FDA-style PCCP
  (Description of Modifications, Modification Protocol, Impact Assessment).

Citations: FDA GMLP (https://www.fda.gov/media/153486/download); FDA PCCP final
guidance (https://www.fda.gov/media/166704/download); corpus design in
`ANS_test_evidence_base_HumanOS.md` §11.3, §13.

## 7. Offline golden oracle

`eval/oracles/jill_shah_deidentified.json` is a **de-identified, offline-only**
regression target (`do_not_load_at_runtime: true`). It is read only by
`numericalSummaryParity.spec.ts`, which asserts the reproducible `[C]` parts
(Ewing thresholds, FRF band, ectopic count, demographics) and **documents** the
`[P]` vendor spectral values without asserting byte-exact reproduction.

## 8. Residual parity limit (honest statement)

The raw `.ans` binary does **not** store the vendor's per-phase spectral scalars
(LFa/RFa/FRF/SB) or the continuous-BP MAP; the vendor derives them via an
**undisclosed proprietary wavelet algorithm** printed only in the signed PDF.
Therefore:

- **Exact byte-parity with the PDF Numerical Summary is not achievable from the
  `.ans` file alone.** Our generic computation is a physiologically-motivated
  approximation (Morlet CWT band power over interpolated RR with Colombo-style
  dynamic bands, empirical SCALE≈0.0018) and will not match the PDF to the
  displayed precision on arbitrary files.
- Continuous-BP **MAP** is the mean of the BP waveform and is **not derivable**
  from the displayed cuff SBP/DBP; it is shown only when present.
- The path to closing the gap is **direct ingestion of the vendor PDF** as
  `vendor_reported` fields, and/or a **validated golden reference** built from
  the ≈50 paired `.ans`+PDF corpus (`ans_forensics/data_requirements.md`) under
  the governance in §6 — not runtime memorization.

Until then, `[P]` aggregates are surfaced as `computed / estimated`, never as
validated vendor truth.
