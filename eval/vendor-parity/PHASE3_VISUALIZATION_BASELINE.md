# HumanOS ANS Phase 3 Visualization-Parity Baseline

This measures the canonical HumanOS `.ans` parser and clinician visualization payload against the deidentified 11-case PhysioPS vendor oracle. It is software validation, not a diagnosis.

## Executive result

- Oracle schema: `1.0.0`
- Private source files matched by SHA-256: **11/11**
- Comparisons: **1716**
- Pass: **1716**
- Mismatch: **0**
- Not implemented: **0**
- Unavailable: **0**
- Raw parity ratio: **100%**

The two visualization items that Phases 1 and 2 recorded as `not_implemented` are now real scored checks. There are no placeholder rows left in the harness.

## Comparisons by category

| Category | Comparisons | Pass |
|---|---:|---:|
| anthropometrics | 33 | 33 |
| confidence_invariant | 11 | 11 |
| demographics | 33 | 33 |
| ectopy | 22 | 22 |
| file_integrity | 22 | 22 |
| phase_A_baseline | 44 | 44 |
| phase_B_deep_breathing | 44 | 44 |
| phase_D_valsalva | 44 | 44 |
| phase_F_stand | 44 | 44 |
| quality_invariant | 11 | 11 |
| ratios | 33 | 33 |
| sampling | 33 | 33 |
| stored_series_4hz | 55 | 55 |
| stored_series_rr | 22 | 22 |
| stored_vendor_summary_phase_A | 110 | 110 |
| stored_vendor_summary_phase_B | 110 | 110 |
| stored_vendor_summary_phase_C | 110 | 110 |
| stored_vendor_summary_phase_D | 110 | 110 |
| stored_vendor_summary_phase_E | 110 | 110 |
| stored_vendor_summary_phase_F | 110 | 110 |
| study_metadata | 22 | 22 |
| vendor_trend_array_mapping | 77 | 77 |
| vendor_trend_arrays | 385 | 385 |
| vendor_wavelet_spectrogram | 121 | 121 |

## Case matrix

| Case | Comparisons | Pass | Mismatch | Not implemented | Unavailable |
|---|---:|---:|---:|---:|---:|
| Case 01 | 156 | 156 | 0 | 0 | 0 |
| Case 02 | 156 | 156 | 0 | 0 | 0 |
| Case 03 | 156 | 156 | 0 | 0 | 0 |
| Case 04 | 156 | 156 | 0 | 0 | 0 |
| Case 05 | 156 | 156 | 0 | 0 | 0 |
| Case 06 | 156 | 156 | 0 | 0 | 0 |
| Case 07 | 156 | 156 | 0 | 0 | 0 |
| Case 08 | 156 | 156 | 0 | 0 | 0 |
| Case 09 | 156 | 156 | 0 | 0 | 0 |
| Case 10 | 156 | 156 | 0 | 0 | 0 |
| Case 11 | 156 | 156 | 0 | 0 | 0 |

## What the visualization checks actually verify

**Stored series (`stored_series_4hz`, `stored_series_rr`)** — the byte offset of every stored array descriptor and the exact sample count, minimum, maximum and mean of the 4 Hz heart-rate array, the 4 Hz breathing array and the beat-to-beat interval series.

**Trend arrays (`vendor_trend_arrays`)** — for all eleven stored 4-second arrays: descriptor offset, sample count, minimum, maximum, mean and the first four stored values, plus the stored 4-second time base and the array count.

**Index-to-metric mapping (`vendor_trend_array_mapping`)** — the resolved FRF index, the resolved LFa/RFa index pair, the resolved percentage-share index pair and the vendor-internal ratio index, each compared against the oracle's own recorded semantics; whether all four clinical channels resolved; that no channel carries a label without a recorded method and evidence; and the pointwise LFa/RFa ratio identity agreement.

**Wavelet spectrogram (`vendor_wavelet_spectrogram`)** — the stored row and column counts, the stored 4-second time base, both stored frequency-axis parameters, the total float32 byte count, finiteness of every stored cell, the block offset, a byte-exact hex comparison of the reconstructed block header (four doubles, the row/column counts and the first two stored cells) against the oracle's raw preview, and an exact base64 transport round-trip.

## Boundaries this baseline does NOT claim

- The vendor's printed per-phase numerical summary is **not** a plain aggregate of these trend arrays. A search over aggregation rules (mean, median, geometric mean, trimmed mean, min, max) crossed with leading/trailing window trims found no rule that reproduces the printed LFa, RFa or FRF values exactly; the best rule leaves a 1-7% median relative error. HumanOS therefore continues to publish the stored six-phase summary recovered in Phase 2 for those numbers, and uses the trend arrays only for the trend charts. The trend aggregate agreement is used solely as a discriminator between the two stored power families, never as a substitute value.
- Stored trend array index 5 is carried through as `unmapped`. No structural identity and no stored-summary agreement identifies it, so it is not labelled and not plotted.
- The wavelet cycle count (Q) printed by the vendor report is not stored in the binary. The clinician footer says so rather than printing a number.
- The three 6-byte marker code arrays remain undecoded, as in Phase 1.

## Reproduction

```bash
ANS_VENDOR_SOURCE_ROOT=/path/to/private/ans/files npm run parity:vendor:strict
```

The strict gate exits zero for this baseline. Production was not deployed or modified.
