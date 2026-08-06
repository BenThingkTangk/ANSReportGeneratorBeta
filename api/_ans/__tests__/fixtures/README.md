# Test fixtures

| File | Origin | De-identification | What it proves |
|---|---|---|---|
| `jill_deid.ans` | Real vendor `.ans` (Shah, Jill — 2025-09-26) | name → `Faux/Jane`, DOB → Jan-1 of birth year; everything else byte-identical | Golden master: E/I 1.21, Valsalva 1.43, 30:15 1.40, ectopy 1, real waveform |
| `pare_deid.ans` | Real vendor `.ans` (Pare, Alex — 2024-07-11) | name → `Faux/John`, DOB → Jan-1 of birth year; everything else byte-identical | Golden master: E/I 1.22, Valsalva 1.49, 30:15 1.33, ectopy 1, real waveform |
| `deidentified_waveform.ans` | Pre-existing de-identified waveform | — | Spectral/BP safety-gating on raw ECG-only files |
| `synthetic_vendor_ocr.json` | Synthetic | n/a | Vendor-OCR parse unit tests |

## How the de-identified `.ans` fixtures were built

```
npm run fixtures:build-deid -- <source.ans> <out.ans> <LAST> <FIRST>
```

See `scripts/build-deid-fixture.mts`. The two leading length-prefixed name
strings are overwritten **in place** with same-length pseudonyms (so every
downstream byte offset — ratios, ectopy note, LabVIEW study timestamp, and the
full int16 ECG waveform — is preserved), and the 8-byte DOB is shifted to Jan-1
of the birth year (HIPAA safe harbor permits retaining birth year; the exact
day/month is removed). This yields a **real-signal oracle**: the deterministic
parser extracts the same clinically-verifiable numbers it extracts from the
source file, but the patient is no longer identifiable.

Consumed by `realFixtureGoldenMaster.spec.ts` (golden master + anti-oracle +
vendor-parity contract). The un-redacted source files are **never** committed.

## What the `.ans` waveform CAN and CANNOT support

**Estimable generically (HumanOS estimates, `computed` + `validation:"estimated"`):**
LFa / RFa / SB / FRF and their rolling trends. `api/_ans/spectral.ts` detects
R-peaks, interpolates R-R to an instantaneous-bpm grid at 4 Hz, high-passes and
detrends it, then integrates Morlet-wavelet band power (Q = 5) over a
sympathetic band (0.04-0.15 Hz) and a respiration-adaptive respiratory band.
No fitted calibration constant is used: the unit conversion is done on the
signal (bpm²), not by scaling the answer.

**NOT supported at any confidence:**

- **Vendor parity.** The vendor's wavelet implementation, windowing, and
  calibration are undisclosed, so a HumanOS estimate is *not* the vendor's LFa /
  RFa / SB and must never be labelled `vendor_reported` or presented as
  PhysioPS-validated. Broadband validation shows the estimator reads roughly
  10-19% high on white-noise band power (Gaussian band-edge leakage).
- **Clinical interpretation.** `mayInterpretClinically()` is false for
  `estimated` values, so estimates cannot drive a composite wellness score, a
  dysfunction pattern, or a narrative finding. `spectralAvailable` stays `false`
  without a paired vendor report.
- **Cuff blood pressure.** Not in the file at all; stays `null` / "Not assessed"
  unless a paired vendor PDF supplies it (`x-vendor-metrics` / OCR path,
  `vendor_reported` provenance).

The tests assert both halves: estimates are present and labelled, and the
clinical surfaces stay closed. See the project-root recovery report for the full
source-data specification a validated derivation would require.
