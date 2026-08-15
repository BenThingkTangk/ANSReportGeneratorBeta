# `governance/` — HumanOS ANS clinical governance gate

Source-controlled governance artifacts for the HumanOS ANS clinician reporting
application. Nothing in this directory changes production clinical logic; it
records decisions, binds them to tests, and gates releases structurally.

| File | Role |
| --- | --- |
| `CLINICAL_RULE_LEDGER.md` | Human-readable rule ledger (generated) |
| `clinical-rule-ledger.json` | Machine-readable rule ledger (generated) |
| `CLINICAL_REGRESSION_SPEC.md` | Human-readable regression specification (generated) |
| `clinical-regression-spec.json` | Machine-readable regression specification (generated) |
| `validate-clinical-governance.mjs` | Deterministic structural validator for the two JSON artifacts |
| `_build_governance.py` | Authoritative generator for all four artifacts |
| `_parts/` | Assembly fragments and the first-pass draft, retained for provenance only. Not imported at build time. |

## Regenerate and validate

```bash
python3 governance/_build_governance.py          # regenerate the four artifacts
node governance/validate-clinical-governance.mjs # structural gate (exit 0 = pass)
node governance/validate-clinical-governance.mjs --json   # machine-readable result
```

The generator performs its own build-time assertions (unknown enum values,
unresolved dependencies, rules with no regression test, missing layers) and
fails loudly instead of emitting an incomplete artifact.

## What the validator does and does not do

It checks schema shape, field completeness, enum validity, ID format and
uniqueness, dependency resolution, rule-to-test traceability, layer coverage,
stop-ship and sign-off completeness, count-block agreement, markdown/JSON drift
and PHI identifier containment.

It does **not** check clinical correctness, clinical safety or regulatory
fitness. A passing run means the governance artifacts are structurally complete
and internally coherent — nothing more. Clinical correctness is established only
by the named clinical authority signing the rule dispositions.

## PHI handling

Ledger artifacts and both Markdown documents contain anonymized fixture IDs
only. Vendor filenames that carry patient names exist in exactly one place:
the `phi_restricted_fixture_manifest` block of `clinical-regression-spec.json`,
which is explicitly labelled PHI-restricted and non-public. The validator fails
the build if an identifier appears anywhere else, using
`../ans-vendor-oracle-private-mapping.json` (override with
`GOVERNANCE_IDENTIFIER_MAP`) as the identifier list.

## Related existing artifacts

- `docs/ANS_GOVERNANCE_AND_PARITY.md` — provenance/safety-gate architecture and
  the honest statement of residual vendor parity limits.
- `eval/oracles/jill_shah_deidentified.json` — offline de-identified golden
  oracle (`do_not_load_at_runtime`).
- `eval/regression-gate.json` — existing numeric evaluation thresholds.
