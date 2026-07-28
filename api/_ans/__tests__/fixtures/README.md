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

## What is NOT derivable from the `.ans` alone

The proprietary spectral aggregates (LFa/RFa/SB), the sympathovagal balance,
and cuff blood pressure are **not** reproducible from the raw waveform — the
vendor's wavelet algorithm and calibration are undisclosed. The tests assert
these stay `null` / "Not assessed" unless a paired vendor PDF supplies them
(`x-vendor-metrics` / OCR path, `vendor_reported` provenance). See the
project-root recovery report for the full source-data specification required to
derive them generically.
