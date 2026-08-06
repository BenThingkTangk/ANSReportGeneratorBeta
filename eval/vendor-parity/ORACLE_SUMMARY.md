# ANS Vendor Oracle — Coverage and Cross-Case Patterns

**Artifacts**

| File | Contents |
| --- | --- |
| `ans-vendor-oracle.json` | Schema + all 11 cases, every vendor value wrapped with `source_class`, `confidence`, `evidence` |
| `ans-field-provenance-matrix.csv` | 221 field paths × source class, evidence, per-case population, low-confidence flags |
| `ans-vendor-oracle-private-mapping.json` | Private mapping Case 01..11 → vendor name fields, DOB, files (identifiers; not for publication) |
| `ans_oracle_work/` | Working directory: page renders, OCR text, `ans_final_parse.py`, per-case extraction JSONs, build scripts |

**De-identification.** Patient names, DOB and the original (name-bearing) filenames are removed from all three published artifacts; each case is `Case 01`..`Case 11`, files are referenced as `caseNN_<role>.<ext>` plus their SHA-256. The DOB byte field is described structurally with its value redacted. Test dates, times, ages, sex, physician labels and operator note text are **retained deliberately** — they are vendor fields the engine must reproduce. The private mapping (name fields, DOB, original filenames) is isolated in `ans-vendor-oracle-private-mapping.json`.

Corpus: 11 paired studies (`.ans` + PhysioPS "P&S Reports 4.0" 5-page PDF). Case 07 additionally has a 3-page `-Report.pdf` (Diagnostic Implication Summary + Possible Therapy Options) and a legacy 4-page `.doc` clinician letter. No HumanOS code or production system was read, executed or modified.

## Extraction method and its limits

The vendor PDFs have **no text layer** — `pdfplumber`/`pdftotext` return empty strings for all 58 pages. Values were obtained by rendering each page at 200 dpi (`pdftoppm`) and reading pages directly, with `tesseract` OCR of the same renders as an independent cross-check. OCR alone was not trustworthy for this content (e.g. it read `109 mmHg` as `409 mmHg` and dropped whole normal-range columns), so visual reading is authoritative and OCR served only as a discrepancy detector. Three vendor bar-graph labels are partially occluded by the coloured bars themselves; those readings carry `confidence: "low"` with the reading note preserved (`page1_phases.stand.lfa_response.normal_range`, `page1_phases.valsalva.lfa_response.normal_range`, `page2.rfa_analysis.valsalva.text`). Everything else is `confidence: "high"`.

## `.ans` binary structure (reverse-engineered, read-only)

Big-endian LabVIEW serialisation; strings are `u32` length + latin-1; times are LabVIEW absolute time (seconds since 1904-01-01 UTC, `f64` for timestamps and `u32` for DOB). Confirmed identical for all 11 files:

1. name field 1, name field 2, middle field (empty in 11/11)
2. `u32` DOB seconds since 1904 — **decoding validated**: age recomputed from this field matches the printed PDF Age in 11/11 cases
3. gender, physician, ANS-medications (empty in 11/11 → PDF prints "N/A"), empty slot, `u32` age
4. other medications & symptoms (free text)
5. annotation strings: `E/I Ratio = x.xx`, `Valsalva Ratio = x.xx`, `30:15 Ratio = x.xx`, `N possible premature beat(s);`, operator notes with local clock times
6. height string, literal `Procedure`
7. `f64` start, `f64` end, `f64` start (repeat), `f64` dt = 0.004 s, `u32` n, `u16 × n` EKG waveform → **250 Hz in 11/11**
8. `f64` t0, `u32` n_beats, `f32 × n_beats` beat-to-beat interval series (seconds)
9. `f64` t0, `f64` dt = 0.25 s, then two `[u32 n][f32 × n]` arrays → heart-rate and breathing series at **4 Hz in 11/11**
10. `u32 6`, six `f64` marker timestamps, then three 6-byte code arrays (**semantics unresolved**)
11. `f64` t0, `f64` dt = 4.0 s, then **11** `[u32 n][f32 × n]` spectral trend arrays (index 0 is FRF in Hz; two arrays carry LFa/RFa magnitudes; two arrays sum to 100; one is a ratio)
12. `f64` t0, `f64` dt = 4.0 s, `f64` 0.0033, `f64` 0.0066447, `u32` rows, `u32` cols = **150 in 11/11**, `f32 × rows·cols` wavelet spectrogram

Per-case scale (Case 01…11): EKG samples 229,455–241,455; detected beats 819–1,507; spectrogram rows 230–243; test duration ~938.2 s in 9 cases and ~968.2 s in 2 cases (Cases 02 and 06 — the two studies whose printed phase table also has a lengthened phase, C = 01:30 and E = 02:30 respectively).

## Which vendor fields are where

| Source class | Field paths | Examples |
| --- | --- | --- |
| `ans_direct` (byte-exact in binary) | 15 | sex, physician, age, height, ANS-medications, other meds & symptoms, ectopic-beat annotation, E/I + Valsalva + 30:15 ratio values, operator note lines, test date/time |
| `ans_derivable` (signal present, value not stored) | 6 | Numerical-Summary `meanHR`, `rangeHR`, `FRF`, `LFA`, `RFA`, `LFA/RFA` |
| `pdf_only` (report layer) | 175 | every interpretation label, every age/baseline-adjusted normal range, expected-response text, BP/PP/MAP cells, phase durations, scatter/pattern labels, RFa-analysis percent panels, coupling windows, chart axes, ratio thresholds and Normal/Low classifications, weight, BMI |
| `report_pdf_only` | 11 | Diagnostic Implication Summary (short + detailed) and Possible Therapy Options — Case 07 only |
| `legacy_doc_only` | 14 | narrative assessment, pattern flags (PE/SW/SE/SFD/OI/syncope risk), 12 recommendations, footnote — Case 07 only |

Verified negatives: **weight and BMI are not present in the `.ans` file** (searched as `u16`/`u32`/`f32`/`f64` across the header region); BMI is reproducible from the PDF as `703 × lb / in²` (matches printed BMI within 0.05 in 11/11). Cuff **blood pressure values were not located as an aligned numeric block** in the binary — candidate byte matches fell inside waveform data, so BP/PP/MAP are classified `pdf_only` pending vendor confirmation.

## Cross-source validation (449 checks, 0 failures)

400 pass, 0 fail, 49 informational mismatches. Passing families:

- E/I, Valsalva and 30:15 ratio: `.ans` annotation string == PDF p.2 == PDF p.5 in 11/11.
- Gender, physician, height, ectopic count: `.ans` == PDF in 11/11.
- Age recomputed from the `.ans` DOB field == printed Age in 11/11.
- BMI recomputed from printed height/weight == printed BMI in 11/11.
- Page-1 phase values == the corresponding Numerical-Summary row (meanHR, rangeHR, LFa, RFa, LFa/RFa, phase BP) — 12 value pairs plus 4 BP pairs per case, all consistent.

Informational mismatches — **vendor behaviour to reproduce, not errors to fix**:

- **MAP is not `(SYS + 2·DIA)/3`** in 48 of 66 rows (e.g. Case 01 row E: vendor 109 vs textbook 95.7; Case 06 row F: vendor 71 vs 82.3). The vendor MAP formula is unknown; it must not be reimplemented from assumption. Recorded in `unresolved`.
- **PP is not always `SYS − DIA`**: Case 03 row F prints PP 74 while the printed BP is 138/63 (=75). Verified at 400 dpi. Suggests PP is computed from unrounded BP before the BP display is rounded.
- Case 03 row E has **blank BP / PP / MAP cells** — stored as `null` with an explicit reason, never 0.

## Cross-case patterns

**Phase schedule** is highly stereotyped: A Baseline 05:00 (11/11), B Deep Breathing 01:00 (11/11), C Baseline 01:00 (10/11; 01:30 in Case 02), D Valsalva 01:35 (11/11), E Baseline 02:00 (10/11; 02:30 in Case 06), F Stand 05:00 (11/11).

**Interpretation vocabulary** observed across 236 labelled page-1 metrics: `Normal` (118), `Low` (28), `DIA Change: Normal` (19), `SYS Change: Borderline` (18), `DIA Change: Borderline` (11), `Borderline Low` (9), `High` (8), `SYS Change: Normal` (7), `SYS Change: Borderline Low` (5), `High (Stage 1 Hypertension)` (4), `Borderline` (3), `SYS Change: Abnormal` (2), `Low Normal` (2), `DIA Change: Abnormal` (2), and one each of `Critically Low`, `High Normal`, `Borderline High`, `SYS Change: Borderline High`, `DIA Change: Low`, `Low (Possible Bradycardia)`. Any engine must emit these exact strings, including the `SYS Change:` / `DIA Change:` prefixed forms.

**Pattern/scatter labels** (44 panels): `Normal` (18), `Low` (7), `LFa withdraw` (4), `RFa dominance` (3), `Borderline / Low` (3), `depleted autonomic control` (2), `FRF is out of range` (2), `LFa dominance` (2), `LFa Borderline` (1), `RFa Borderline + LFa withdraw` (1), `RFa excitation + High LFa` (1). RFa-analysis panel labels: `Normal` (18), plus `Excess` (2), `Borderline` (1), `Border` (1) — note `Border` and `Borderline` both occur, so the label set is not normalised by the vendor.

**FRF gating**: the page-1 Deep-Breathing block gains an inline `FRF = x.xx [OUT OF NORMAL RANGE (0.09 - 0.15)]` header plus the footnote *"Fundamental Respiratory Frequency (FRF) was out of range during Deep Breathing (DB). High FRF can artifically lower the parasympathetic response."* (vendor spelling "artifically") only when the DB-phase FRF exceeds 0.15 — Cases 01 (0.25) and 06 (0.21). The other nine cases have DB FRF 0.10–0.12 and no annotation. The scatter panel B label switches to `FRF is out of range` in exactly the same two cases.

**Multiplier notation**: several age/baseline-adjusted responses are printed as multiples of baseline with an `x` prefix on both the value and the range (e.g. `x1.29` with range `x8.45 – x29.94`). Present in the DB RFa response for Cases 01, 03, 09, 10 and in the Valsalva LFa response for Cases 01, 03, 07 — the same metric is printed as an absolute `bpm²` value in the other cases. The oracle records this as `value_prefix`, and any engine must reproduce the switch.

**Ectopic beats**: 0 in 6 cases, 1/3/4/13/14 in the rest. When the count is 0, the vendor **omits** the annotation string from the `.ans` and the p.2/p.3 note line entirely, while p.1 still prints `No. of Ectopic Beats: 0`. Absence of the string is therefore a vendor encoding convention, not missing data — but it is recorded as such in the evidence, not silently coerced.

**Diastolic normal range** is printed one-sided (`< 80`); the oracle stores `[null, 80]`, where `null` is "no lower bound printed", not zero.

**Free-text fidelity**: vendor free text is preserved verbatim including defects — Case 07 `Lo05ng Covid` (for "Long Covid", identical in `.ans`, main PDF and report PDF) and Case 09 `Xanax as needed, half dose everyday ususally`. Operator note lines keep their embedded local clock times (Case 07: `11:27:50 AM getting pressure in thr base of his skull`; Case 09: three `talking` notes).

**Demographics spread** (useful for age-normative logic): ages 17, 18, 24, 26, 30, 39, 40, 47, 63, 79, 80; 8 female / 3 male; physicians `Baute` (4), `Dr. Colombo` (3), `snapper` (2), `Riley` (1), `Gold` (1). Page-5 age-axis windows are a 19-year band centred near the patient age (e.g. age 40 → 30–49, age 80 → 70–89), and the Valsalva/30:15 normative thresholds vary with age (Valsalva `> 1.150` at age 80 vs `> 1.650` at age 17), so age-indexed normative tables are required.

## Known gaps (recorded in `unresolved` in the JSON)

1. **Phase windowing is not reproducible from the binary alone.** The 6-entry marker block holds six `f64` timestamps, but the inter-marker intervals do not match the printed durations (Case 07: 121.2 / 67.7 / 41.0 / 158.5 / 178.4 s vs printed 05:00 / 01:00 / 01:00 / 01:35 / 02:00 / 05:00). Until the phase boundaries are resolved, `ans_derivable` metrics cannot be recomputed byte-faithfully.
2. **Trend-array index → metric mapping** for the 11 four-second arrays is inferred from value ranges only, not vendor-documented.
3. The three 6-byte code arrays in the marker block are undecoded (quasi-ASCII, vary per case).
4. Vendor MAP formula and the PP rounding rule are unknown (see mismatches above).
5. BP entry storage inside `.ans` not located.

## How to use this oracle

Compare an engine's output field-by-field against `cases.<Case NN>.<path>.value`. Treat `source_class` as the test tier: `ans_direct` fields must match byte-exactly from the binary; `ans_derivable` fields are numeric-tolerance comparisons once phase windowing is resolved; `pdf_only` fields test the report layer's classification and reference-range logic; `report_pdf_only` / `legacy_doc_only` fields only apply to the narrative report path (Case 07). Fields with `confidence: "low"` should not be used as hard assertions — re-read the vendor page first. `null` values are assertions that the vendor printed nothing; an engine emitting `0` there is wrong.
