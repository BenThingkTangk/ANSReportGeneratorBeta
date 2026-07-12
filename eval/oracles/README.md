# Offline Golden Oracles

These JSON files are **de-identified regression targets used offline only** — by
the eval runner and the vitest suite. They are **never imported by production /
runtime code** (`api/**`, `client/**`, `server/**`). A test enforces this
(`api/_ans/__tests__/noRuntimeOracle.spec.ts`).

## Why they exist

The vendor's per-phase spectral aggregates (LFa, RFa, FRF, LFa/RFa "SB") are
**proprietary [P]** values produced by an undisclosed wavelet algorithm and
printed only in the signed PDF. They are **not** stored as scalars in the `.ans`
binary. Our open pipeline computes these generically from the raw ECG-derived
arrays, but that is an **approximation** of the vendor algorithm, not a
reproduction of it.

## What the oracle is — and is NOT

- ✅ It **documents** the vendor's PDF values so tests can measure and report the
  residual gap between our generic computation and the vendor output.
- ✅ It anchors **parse-parity** checks for the parts that ARE in the `.ans`
  (demographics, age/sex, ectopic-beat note) and the **consensus [C]** norm
  bands / Ewing thresholds.
- ❌ It is **NOT** a runtime substitution table. Nothing may look up a value here
  (or by any name/hash fingerprint) and inject it into a rendered report. That
  was the removed `numericalSummaryOverride` anti-pattern.
- ❌ Tests must **NOT** assert byte-exact reproduction of the `[P]` spectral
  aggregates. They may only assert that our value is tagged `estimated` and
  (optionally) falls within a **documented tolerance**, so a genuine accuracy
  regression is caught without blessing an identity match.

## Residual parity limit (honest statement)

Because the raw `.ans` does not contain the vendor's spectral scalars and the
algorithm is undisclosed, **exact parity with the PDF Numerical Summary is not
achievable from files alone**. Closing it requires either (a) direct ingestion
of the vendor PDF as `vendor_reported` fields, or (b) a validated golden
reference built from the ~50 paired `.ans`+PDF corpus described in
`ans_forensics/data_requirements.md`. Until then these `[P]` values are surfaced
as `computed / estimated`, never as validated vendor truth.
