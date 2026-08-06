# HumanOS ANS Phase 1 Vendor-Parity Baseline

This measures the canonical HumanOS `.ans` parser against the deidentified 11-case PhysioPS vendor oracle. It is software validation, not a diagnosis.

## Executive result

- Oracle schema: `1.0.0`
- Private source files matched by SHA-256: **11/11**
- Comparisons: **462**
- Pass: **220**
- Mismatch: **165**
- Not implemented: **77**
- Unavailable: **0**
- Raw parity ratio: **47.62%**

Core integrity, demographics, sampling metadata, Ewing ratios, height, and the no-invented-weight/BMI policy are measured separately from unresolved vendor spectral behavior. The remaining gaps are explicit instead of being hidden behind generic usability gates.

## Case matrix

| Case | Comparisons | Pass | Mismatch | Not implemented | Unavailable |
|---|---:|---:|---:|---:|---:|
| Case 01 | 42 | 20 | 15 | 7 | 0 |
| Case 02 | 42 | 20 | 15 | 7 | 0 |
| Case 03 | 42 | 21 | 14 | 7 | 0 |
| Case 04 | 42 | 20 | 15 | 7 | 0 |
| Case 05 | 42 | 18 | 17 | 7 | 0 |
| Case 06 | 42 | 20 | 15 | 7 | 0 |
| Case 07 | 42 | 21 | 14 | 7 | 0 |
| Case 08 | 42 | 18 | 17 | 7 | 0 |
| Case 09 | 42 | 21 | 14 | 7 | 0 |
| Case 10 | 42 | 21 | 14 | 7 | 0 |
| Case 11 | 42 | 20 | 15 | 7 | 0 |

## Open discrepancies

| Case | Category | Metric | Status | Expected | Actual |
|---|---|---|---|---|---|
| Case 01 | study_metadata | test_time_local | mismatch | 11:53:13 AM | null |
| Case 01 | ectopy | canonical_study_ectopic_count | not_implemented | 13 | null |
| Case 01 | phase_A_baseline | lfa_bpm2 | mismatch | 0.76 | 17.28 |
| Case 01 | phase_A_baseline | rfa_bpm2 | mismatch | 0.07 | 26.97 |
| Case 01 | phase_A_baseline | lfa_rfa_ratio | mismatch | 11.23 | 0.64 |
| Case 01 | phase_B_deep_breathing | mean_hr_bpm | mismatch | 59 | 61 |
| Case 01 | phase_B_deep_breathing | lfa_bpm2 | mismatch | 0.55 | 1.88 |
| Case 01 | phase_B_deep_breathing | rfa_bpm2 | mismatch | 0.09 | 4.24 |
| Case 01 | phase_B_deep_breathing | lfa_rfa_ratio | mismatch | 5.86 | 0.44 |
| Case 01 | phase_D_valsalva | lfa_bpm2 | mismatch | 0.04 | 12.83 |
| Case 01 | phase_D_valsalva | rfa_bpm2 | mismatch | 0.01 | 7.45 |
| Case 01 | phase_D_valsalva | lfa_rfa_ratio | mismatch | 5.85 | 1.72 |
| Case 01 | phase_F_stand | lfa_bpm2 | mismatch | 0.42 | 9.91 |
| Case 01 | phase_F_stand | rfa_bpm2 | mismatch | 0.06 | 15.17 |
| Case 01 | phase_F_stand | lfa_rfa_ratio | mismatch | 7.26 | 0.65 |
| Case 01 | quality_invariant | usable_has_no_unusable_reasons | mismatch | true | false |
| Case 01 | residual_vendor_parity | vendor_phase_C | not_implemented | vendor parity | null |
| Case 01 | residual_vendor_parity | vendor_phase_E | not_implemented | vendor parity | null |
| Case 01 | residual_vendor_parity | vendor_frf | not_implemented | vendor parity | null |
| Case 01 | residual_vendor_parity | vendor_bp_pp_map | not_implemented | vendor parity | null |
| Case 01 | residual_vendor_parity | vendor_trend_array_mapping | not_implemented | vendor parity | null |
| Case 01 | residual_vendor_parity | vendor_wavelet_spectrogram | not_implemented | vendor parity | null |
| Case 02 | study_metadata | test_time_local | mismatch | 05:36:49 PM | null |
| Case 02 | ectopy | canonical_study_ectopic_count | not_implemented | 0 | null |
| Case 02 | phase_A_baseline | lfa_bpm2 | mismatch | 4.23 | 8.79 |
| Case 02 | phase_A_baseline | rfa_bpm2 | mismatch | 1.93 | 2.76 |
| Case 02 | phase_A_baseline | lfa_rfa_ratio | mismatch | 2.2 | 3.18 |
| Case 02 | phase_B_deep_breathing | mean_hr_bpm | mismatch | 77 | 75 |
| Case 02 | phase_B_deep_breathing | lfa_bpm2 | mismatch | 1.97 | null |
| Case 02 | phase_B_deep_breathing | rfa_bpm2 | mismatch | 89.34 | 85.9 |
| Case 02 | phase_B_deep_breathing | lfa_rfa_ratio | mismatch | 0.02 | null |
| Case 02 | phase_D_valsalva | mean_hr_bpm | mismatch | 76 | 79 |
| Case 02 | phase_D_valsalva | lfa_bpm2 | mismatch | 78.94 | 21.54 |
| Case 02 | phase_D_valsalva | rfa_bpm2 | mismatch | 20.65 | 11.62 |
| Case 02 | phase_D_valsalva | lfa_rfa_ratio | mismatch | 3.82 | 1.85 |
| Case 02 | phase_F_stand | lfa_bpm2 | mismatch | 4.19 | 15.26 |
| Case 02 | phase_F_stand | rfa_bpm2 | mismatch | 1.72 | 8.19 |
| Case 02 | phase_F_stand | lfa_rfa_ratio | mismatch | 2.43 | 1.86 |
| Case 02 | residual_vendor_parity | vendor_phase_C | not_implemented | vendor parity | null |
| Case 02 | residual_vendor_parity | vendor_phase_E | not_implemented | vendor parity | null |
| Case 02 | residual_vendor_parity | vendor_frf | not_implemented | vendor parity | null |
| Case 02 | residual_vendor_parity | vendor_bp_pp_map | not_implemented | vendor parity | null |
| Case 02 | residual_vendor_parity | vendor_trend_array_mapping | not_implemented | vendor parity | null |
| Case 02 | residual_vendor_parity | vendor_wavelet_spectrogram | not_implemented | vendor parity | null |
| Case 03 | study_metadata | test_time_local | mismatch | 02:25:25 PM | null |
| Case 03 | ectopy | canonical_study_ectopic_count | not_implemented | 14 | null |
| Case 03 | phase_A_baseline | lfa_bpm2 | mismatch | 0.77 | 4.82 |
| Case 03 | phase_A_baseline | rfa_bpm2 | mismatch | 0.25 | 11.71 |
| Case 03 | phase_A_baseline | lfa_rfa_ratio | mismatch | 3.08 | 0.41 |
| Case 03 | phase_B_deep_breathing | mean_hr_bpm | mismatch | 73 | 78 |
| Case 03 | phase_B_deep_breathing | lfa_bpm2 | mismatch | 0.17 | null |
| Case 03 | phase_B_deep_breathing | rfa_bpm2 | mismatch | 0.63 | 4.3 |
| Case 03 | phase_B_deep_breathing | lfa_rfa_ratio | mismatch | 0.27 | null |
| Case 03 | phase_D_valsalva | lfa_bpm2 | mismatch | 1.62 | 14 |
| Case 03 | phase_D_valsalva | rfa_bpm2 | mismatch | 0.33 | 23.08 |
| Case 03 | phase_D_valsalva | lfa_rfa_ratio | mismatch | 4.88 | 0.61 |
| Case 03 | phase_F_stand | lfa_bpm2 | mismatch | 0.33 | 5.97 |
| Case 03 | phase_F_stand | rfa_bpm2 | mismatch | 0.26 | 10.36 |
| Case 03 | phase_F_stand | lfa_rfa_ratio | mismatch | 1.27 | 0.58 |
| Case 03 | residual_vendor_parity | vendor_phase_C | not_implemented | vendor parity | null |
| Case 03 | residual_vendor_parity | vendor_phase_E | not_implemented | vendor parity | null |
| Case 03 | residual_vendor_parity | vendor_frf | not_implemented | vendor parity | null |
| Case 03 | residual_vendor_parity | vendor_bp_pp_map | not_implemented | vendor parity | null |
| Case 03 | residual_vendor_parity | vendor_trend_array_mapping | not_implemented | vendor parity | null |
| Case 03 | residual_vendor_parity | vendor_wavelet_spectrogram | not_implemented | vendor parity | null |
| Case 04 | study_metadata | test_time_local | mismatch | 01:49:13 PM | null |
| Case 04 | ectopy | canonical_study_ectopic_count | not_implemented | 0 | null |
| Case 04 | phase_A_baseline | lfa_bpm2 | mismatch | 3.29 | 4.92 |
| Case 04 | phase_A_baseline | rfa_bpm2 | mismatch | 9.92 | 10.71 |
| Case 04 | phase_A_baseline | lfa_rfa_ratio | mismatch | 0.33 | 0.46 |
| Case 04 | phase_B_deep_breathing | lfa_bpm2 | mismatch | 1.88 | null |
| Case 04 | phase_B_deep_breathing | rfa_bpm2 | mismatch | 126.9 | 57.81 |
| Case 04 | phase_B_deep_breathing | lfa_rfa_ratio | mismatch | 0.01 | null |
| Case 04 | phase_D_valsalva | mean_hr_bpm | mismatch | 90 | 88 |
| Case 04 | phase_D_valsalva | lfa_bpm2 | mismatch | 120.28 | 84.13 |
| Case 04 | phase_D_valsalva | rfa_bpm2 | mismatch | 15.16 | 14.77 |
| Case 04 | phase_D_valsalva | lfa_rfa_ratio | mismatch | 7.93 | 5.7 |
| Case 04 | phase_F_stand | lfa_bpm2 | mismatch | 7.73 | 17.86 |
| Case 04 | phase_F_stand | rfa_bpm2 | mismatch | 1.53 | 9.76 |
| Case 04 | phase_F_stand | lfa_rfa_ratio | mismatch | 5.05 | 1.83 |
| Case 04 | quality_invariant | usable_has_no_unusable_reasons | mismatch | true | false |
| Case 04 | residual_vendor_parity | vendor_phase_C | not_implemented | vendor parity | null |
| Case 04 | residual_vendor_parity | vendor_phase_E | not_implemented | vendor parity | null |
| Case 04 | residual_vendor_parity | vendor_frf | not_implemented | vendor parity | null |
| Case 04 | residual_vendor_parity | vendor_bp_pp_map | not_implemented | vendor parity | null |
| Case 04 | residual_vendor_parity | vendor_trend_array_mapping | not_implemented | vendor parity | null |
| Case 04 | residual_vendor_parity | vendor_wavelet_spectrogram | not_implemented | vendor parity | null |
| Case 05 | study_metadata | test_time_local | mismatch | 01:18:10 PM | null |
| Case 05 | ectopy | canonical_study_ectopic_count | not_implemented | 3 | null |
| Case 05 | phase_A_baseline | mean_hr_bpm | mismatch | 75 | 73 |
| Case 05 | phase_A_baseline | lfa_bpm2 | mismatch | 6.27 | 19.49 |
| Case 05 | phase_A_baseline | rfa_bpm2 | mismatch | 8.59 | 25.57 |
| Case 05 | phase_A_baseline | lfa_rfa_ratio | mismatch | 0.73 | 0.76 |
| Case 05 | phase_B_deep_breathing | mean_hr_bpm | mismatch | 79 | 76 |
| Case 05 | phase_B_deep_breathing | lfa_bpm2 | mismatch | 1.13 | null |
| Case 05 | phase_B_deep_breathing | rfa_bpm2 | mismatch | 168.99 | 90.49 |
| Case 05 | phase_B_deep_breathing | lfa_rfa_ratio | mismatch | 0.01 | null |
| Case 05 | phase_D_valsalva | lfa_bpm2 | mismatch | 65.39 | 26.93 |
| Case 05 | phase_D_valsalva | rfa_bpm2 | mismatch | 31.13 | 30.63 |
| Case 05 | phase_D_valsalva | lfa_rfa_ratio | mismatch | 2.1 | 0.88 |
| Case 05 | phase_F_stand | mean_hr_bpm | mismatch | 88 | 86 |
| Case 05 | phase_F_stand | lfa_bpm2 | mismatch | 7.77 | 12.47 |
| Case 05 | phase_F_stand | rfa_bpm2 | mismatch | 3.18 | 9.23 |
| Case 05 | phase_F_stand | lfa_rfa_ratio | mismatch | 2.44 | 1.35 |
| Case 05 | quality_invariant | usable_has_no_unusable_reasons | mismatch | true | false |
| Case 05 | residual_vendor_parity | vendor_phase_C | not_implemented | vendor parity | null |
| Case 05 | residual_vendor_parity | vendor_phase_E | not_implemented | vendor parity | null |
| Case 05 | residual_vendor_parity | vendor_frf | not_implemented | vendor parity | null |
| Case 05 | residual_vendor_parity | vendor_bp_pp_map | not_implemented | vendor parity | null |
| Case 05 | residual_vendor_parity | vendor_trend_array_mapping | not_implemented | vendor parity | null |
| Case 05 | residual_vendor_parity | vendor_wavelet_spectrogram | not_implemented | vendor parity | null |
| Case 06 | study_metadata | test_time_local | mismatch | 08:27:37 AM | null |
| Case 06 | ectopy | canonical_study_ectopic_count | not_implemented | 0 | null |
| Case 06 | phase_A_baseline | lfa_bpm2 | mismatch | 5.21 | 15.51 |
| Case 06 | phase_A_baseline | rfa_bpm2 | mismatch | 1.01 | 17.92 |
| Case 06 | phase_A_baseline | lfa_rfa_ratio | mismatch | 5.16 | 0.87 |
| Case 06 | phase_B_deep_breathing | lfa_bpm2 | mismatch | 5.24 | 0.23 |
| Case 06 | phase_B_deep_breathing | rfa_bpm2 | mismatch | 6.75 | 12.16 |
| Case 06 | phase_B_deep_breathing | lfa_rfa_ratio | mismatch | 0.78 | 0.02 |
| Case 06 | phase_D_valsalva | mean_hr_bpm | mismatch | 89 | 87 |
| Case 06 | phase_D_valsalva | lfa_bpm2 | mismatch | 44.18 | 38.99 |
| Case 06 | phase_D_valsalva | rfa_bpm2 | mismatch | 5.29 | 8.82 |
| Case 06 | phase_D_valsalva | lfa_rfa_ratio | mismatch | 8.35 | 4.42 |
| Case 06 | phase_F_stand | mean_hr_bpm | mismatch | 110 | 108 |
| Case 06 | phase_F_stand | lfa_bpm2 | mismatch | 3.47 | 4.73 |
| Case 06 | phase_F_stand | rfa_bpm2 | mismatch | 0.36 | 3.11 |
| Case 06 | phase_F_stand | lfa_rfa_ratio | mismatch | 9.74 | 1.52 |
| Case 06 | residual_vendor_parity | vendor_phase_C | not_implemented | vendor parity | null |
| Case 06 | residual_vendor_parity | vendor_phase_E | not_implemented | vendor parity | null |
| Case 06 | residual_vendor_parity | vendor_frf | not_implemented | vendor parity | null |
| Case 06 | residual_vendor_parity | vendor_bp_pp_map | not_implemented | vendor parity | null |
| Case 06 | residual_vendor_parity | vendor_trend_array_mapping | not_implemented | vendor parity | null |
| Case 06 | residual_vendor_parity | vendor_wavelet_spectrogram | not_implemented | vendor parity | null |
| Case 07 | study_metadata | test_time_local | mismatch | 11:25:22 AM | null |
| Case 07 | ectopy | canonical_study_ectopic_count | not_implemented | 1 | null |
| Case 07 | phase_A_baseline | lfa_bpm2 | mismatch | 0.66 | 1.59 |
| Case 07 | phase_A_baseline | rfa_bpm2 | mismatch | 2.24 | 1.85 |
| Case 07 | phase_A_baseline | lfa_rfa_ratio | mismatch | 0.3 | 0.86 |
| Case 07 | phase_B_deep_breathing | lfa_bpm2 | mismatch | 0.44 | null |
| Case 07 | phase_B_deep_breathing | rfa_bpm2 | mismatch | 12.95 | 8.96 |
| Case 07 | phase_B_deep_breathing | lfa_rfa_ratio | mismatch | 0.03 | null |
| Case 07 | phase_D_valsalva | mean_hr_bpm | mismatch | 57 | 54 |
| Case 07 | phase_D_valsalva | lfa_bpm2 | mismatch | 6.97 | 3.67 |
| Case 07 | phase_D_valsalva | rfa_bpm2 | mismatch | 1.57 | 2.07 |
| Case 07 | phase_D_valsalva | lfa_rfa_ratio | mismatch | 4.43 | 1.77 |
| Case 07 | phase_F_stand | lfa_bpm2 | mismatch | 2.59 | 4.33 |
| Case 07 | phase_F_stand | rfa_bpm2 | mismatch | 1.46 | 1.72 |
| Case 07 | phase_F_stand | lfa_rfa_ratio | mismatch | 1.78 | 2.52 |
| Case 07 | residual_vendor_parity | vendor_phase_C | not_implemented | vendor parity | null |
| Case 07 | residual_vendor_parity | vendor_phase_E | not_implemented | vendor parity | null |
| Case 07 | residual_vendor_parity | vendor_frf | not_implemented | vendor parity | null |
| Case 07 | residual_vendor_parity | vendor_bp_pp_map | not_implemented | vendor parity | null |
| Case 07 | residual_vendor_parity | vendor_trend_array_mapping | not_implemented | vendor parity | null |
| Case 07 | residual_vendor_parity | vendor_wavelet_spectrogram | not_implemented | vendor parity | null |
| Case 08 | study_metadata | test_date | mismatch | 2025-02-25 | 2025-02-26 |
| Case 08 | study_metadata | test_time_local | mismatch | 09:36:37 PM | null |
| Case 08 | ectopy | canonical_study_ectopic_count | not_implemented | 4 | null |
| Case 08 | phase_A_baseline | lfa_bpm2 | mismatch | 2.99 | 4.22 |
| Case 08 | phase_A_baseline | rfa_bpm2 | mismatch | 5.8 | 4.58 |
| Case 08 | phase_A_baseline | lfa_rfa_ratio | mismatch | 0.52 | 0.92 |
| Case 08 | phase_B_deep_breathing | mean_hr_bpm | mismatch | 71 | 64 |
| Case 08 | phase_B_deep_breathing | lfa_bpm2 | mismatch | 2.81 | null |
| Case 08 | phase_B_deep_breathing | rfa_bpm2 | mismatch | 58.75 | 35.54 |
| Case 08 | phase_B_deep_breathing | lfa_rfa_ratio | mismatch | 0.05 | null |
| Case 08 | phase_D_valsalva | mean_hr_bpm | mismatch | 74 | 71 |
| Case 08 | phase_D_valsalva | lfa_bpm2 | mismatch | 30.36 | 14.65 |
| Case 08 | phase_D_valsalva | rfa_bpm2 | mismatch | 9.89 | 18.11 |
| Case 08 | phase_D_valsalva | lfa_rfa_ratio | mismatch | 3.07 | 0.81 |
| Case 08 | phase_F_stand | lfa_bpm2 | mismatch | 8.26 | 13.85 |
| Case 08 | phase_F_stand | rfa_bpm2 | mismatch | 1.83 | 13.01 |
| Case 08 | phase_F_stand | lfa_rfa_ratio | mismatch | 4.52 | 1.06 |
| Case 08 | quality_invariant | usable_has_no_unusable_reasons | mismatch | true | false |
| Case 08 | residual_vendor_parity | vendor_phase_C | not_implemented | vendor parity | null |
| Case 08 | residual_vendor_parity | vendor_phase_E | not_implemented | vendor parity | null |
| Case 08 | residual_vendor_parity | vendor_frf | not_implemented | vendor parity | null |
| Case 08 | residual_vendor_parity | vendor_bp_pp_map | not_implemented | vendor parity | null |
| Case 08 | residual_vendor_parity | vendor_trend_array_mapping | not_implemented | vendor parity | null |
| Case 08 | residual_vendor_parity | vendor_wavelet_spectrogram | not_implemented | vendor parity | null |
| Case 09 | study_metadata | test_time_local | mismatch | 01:10:21 PM | null |
| Case 09 | ectopy | canonical_study_ectopic_count | not_implemented | 0 | null |
| Case 09 | phase_A_baseline | lfa_bpm2 | mismatch | 2.28 | 4.36 |
| Case 09 | phase_A_baseline | rfa_bpm2 | mismatch | 0.74 | 1.44 |
| Case 09 | phase_A_baseline | lfa_rfa_ratio | mismatch | 3.07 | 3.03 |
| Case 09 | phase_B_deep_breathing | lfa_bpm2 | mismatch | 1.3 | null |
| Case 09 | phase_B_deep_breathing | rfa_bpm2 | mismatch | 1.9 | 2.63 |
| Case 09 | phase_B_deep_breathing | lfa_rfa_ratio | mismatch | 0.68 | null |
| Case 09 | phase_D_valsalva | lfa_bpm2 | mismatch | 13.98 | 2.87 |
| Case 09 | phase_D_valsalva | rfa_bpm2 | mismatch | 0.5 | 0.26 |
| Case 09 | phase_D_valsalva | lfa_rfa_ratio | mismatch | 27.93 | 11.04 |
| Case 09 | phase_F_stand | lfa_bpm2 | mismatch | 0.95 | 14.69 |
| Case 09 | phase_F_stand | rfa_bpm2 | mismatch | 0.22 | 16.28 |
| Case 09 | phase_F_stand | lfa_rfa_ratio | mismatch | 4.25 | 0.9 |
| Case 09 | quality_invariant | usable_has_no_unusable_reasons | mismatch | true | false |
| Case 09 | residual_vendor_parity | vendor_phase_C | not_implemented | vendor parity | null |
| Case 09 | residual_vendor_parity | vendor_phase_E | not_implemented | vendor parity | null |
| Case 09 | residual_vendor_parity | vendor_frf | not_implemented | vendor parity | null |
| Case 09 | residual_vendor_parity | vendor_bp_pp_map | not_implemented | vendor parity | null |
| Case 09 | residual_vendor_parity | vendor_trend_array_mapping | not_implemented | vendor parity | null |
| Case 09 | residual_vendor_parity | vendor_wavelet_spectrogram | not_implemented | vendor parity | null |
| Case 10 | study_metadata | test_time_local | mismatch | 02:17:10 PM | null |
| Case 10 | ectopy | canonical_study_ectopic_count | not_implemented | 0 | null |
| Case 10 | phase_A_baseline | lfa_bpm2 | mismatch | 1 | 1.99 |
| Case 10 | phase_A_baseline | rfa_bpm2 | mismatch | 0.54 | 3.06 |
| Case 10 | phase_A_baseline | lfa_rfa_ratio | mismatch | 1.85 | 0.65 |
| Case 10 | phase_B_deep_breathing | lfa_bpm2 | mismatch | 1.27 | null |
| Case 10 | phase_B_deep_breathing | rfa_bpm2 | mismatch | 15.12 | 5.72 |
| Case 10 | phase_B_deep_breathing | lfa_rfa_ratio | mismatch | 0.08 | null |
| Case 10 | phase_D_valsalva | mean_hr_bpm | mismatch | 84 | 81 |
| Case 10 | phase_D_valsalva | lfa_bpm2 | mismatch | 10.88 | 5.55 |
| Case 10 | phase_D_valsalva | rfa_bpm2 | mismatch | 1.57 | 2.68 |
| Case 10 | phase_D_valsalva | lfa_rfa_ratio | mismatch | 6.93 | 2.07 |
| Case 10 | phase_F_stand | lfa_bpm2 | mismatch | 0.87 | 1.8 |
| Case 10 | phase_F_stand | rfa_bpm2 | mismatch | 0.49 | 1.81 |
| Case 10 | phase_F_stand | lfa_rfa_ratio | mismatch | 1.78 | 0.99 |
| Case 10 | residual_vendor_parity | vendor_phase_C | not_implemented | vendor parity | null |
| Case 10 | residual_vendor_parity | vendor_phase_E | not_implemented | vendor parity | null |
| Case 10 | residual_vendor_parity | vendor_frf | not_implemented | vendor parity | null |
| Case 10 | residual_vendor_parity | vendor_bp_pp_map | not_implemented | vendor parity | null |
| Case 10 | residual_vendor_parity | vendor_trend_array_mapping | not_implemented | vendor parity | null |
| Case 10 | residual_vendor_parity | vendor_wavelet_spectrogram | not_implemented | vendor parity | null |
| Case 11 | study_metadata | test_time_local | mismatch | 10:30:30 AM | null |
| Case 11 | ectopy | canonical_study_ectopic_count | not_implemented | 0 | null |
| Case 11 | phase_A_baseline | lfa_bpm2 | mismatch | 2.3 | 13.02 |
| Case 11 | phase_A_baseline | rfa_bpm2 | mismatch | 18.68 | 9.86 |
| Case 11 | phase_A_baseline | lfa_rfa_ratio | mismatch | 0.12 | 1.32 |
| Case 11 | phase_B_deep_breathing | mean_hr_bpm | mismatch | 80 | 77 |
| Case 11 | phase_B_deep_breathing | lfa_bpm2 | mismatch | 0.99 | 20.97 |
| Case 11 | phase_B_deep_breathing | rfa_bpm2 | mismatch | 53.2 | 7.35 |
| Case 11 | phase_B_deep_breathing | lfa_rfa_ratio | mismatch | 0.02 | 2.85 |
| Case 11 | phase_D_valsalva | lfa_bpm2 | mismatch | 29.29 | 20.49 |
| Case 11 | phase_D_valsalva | rfa_bpm2 | mismatch | 16 | 6.88 |
| Case 11 | phase_D_valsalva | lfa_rfa_ratio | mismatch | 1.83 | 2.98 |
| Case 11 | phase_F_stand | lfa_bpm2 | mismatch | 11.81 | 23.8 |
| Case 11 | phase_F_stand | rfa_bpm2 | mismatch | 21.57 | 9.19 |
| Case 11 | phase_F_stand | lfa_rfa_ratio | mismatch | 0.55 | 2.59 |
| Case 11 | quality_invariant | usable_has_no_unusable_reasons | mismatch | true | false |
| Case 11 | residual_vendor_parity | vendor_phase_C | not_implemented | vendor parity | null |
| Case 11 | residual_vendor_parity | vendor_phase_E | not_implemented | vendor parity | null |
| Case 11 | residual_vendor_parity | vendor_frf | not_implemented | vendor parity | null |
| Case 11 | residual_vendor_parity | vendor_bp_pp_map | not_implemented | vendor parity | null |
| Case 11 | residual_vendor_parity | vendor_trend_array_mapping | not_implemented | vendor parity | null |
| Case 11 | residual_vendor_parity | vendor_wavelet_spectrogram | not_implemented | vendor parity | null |

## Phase 1 disposition

- The deidentified oracle is checksum-protected.
- Source matching is hash-based; local filenames and paths are excluded from output.
- The diagnostic command records current truth without blocking development.
- The strict command is expected to fail until Phase 2 closes the measured gaps.
- No production deployment is part of Phase 1.
