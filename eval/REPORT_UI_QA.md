# PR5 — Report UI Accuracy + Transparency QA Checklist

Manual smoke pass before declaring PR5 done. Run on a desktop browser, then
verify on mobile widths (375px and 414px).

## 1. Parse-only flow

- [ ] Upload screen accepts `.ans` and `.txt` files.
- [ ] Drop a real `.ans` file. App enters `parsing` state — shows
      `AnalyzingScreen` with light progress animation (4 stages).
- [ ] After `/api/parse` returns, app advances to `review` state.
- [ ] Review screen header shows the original file name (with overflow ellipsis
      on long names).
- [ ] If `/api/parse` fails (e.g. corrupt file), app returns to `upload` after
      ~2s with an error stage label.

## 2. Action bar

- [ ] **Back** button returns to upload and clears `pendingFile`, `ansStudy`,
      `diagnosticSummary`.
- [ ] **Re-parse** re-POSTs the same file to `/api/parse`. Disabled if
      `pendingFile` is null.
- [ ] **Download JSON** opens a download for `<basename>.parsed.json` whose
      payload contains `ansStudy`, `diagnosticSummary`, `exportedAt`,
      `sourceFile`.
- [ ] **Generate Report** is disabled (visually muted, no glow) when `ansStudy`
      is null. Enabled with brand cyan→green gradient when `ansStudy` present.
- [ ] Clicking Generate Report transitions to `analyzing`, runs the full
      animated pipeline, and lands on the `report` view (`ReportDashboard`).

## 3. Cards render with provenance

For each of the following cards, verify every field row shows:
- label, value (or em-dash if null), confidence chip, lucide icon
- tooltip on icon hover shows full provenance (source page, raw text, etc.)

- [ ] **ConfidenceGauge** — big ring percent matches
      `summary.reportConfidenceScore * 100` (rounded). Parser bar matches
      `study.parserConfidence.overall`. Footer shows sectionsDetected /
      missing / lowConfidence counts.
- [ ] **DemographicsCard** — Last/First name, DOB, Age, Sex, Physician, MRN,
      Study date, Procedure, Height, Weight, BMI.
- [ ] **PhaseCard × 4** — Baseline, Deep breathing, Valsalva, Stand/Tilt. Each
      shows HR, SBP, DBP, MAP, LFa, RFa, SB. "Present" badge when phase data
      exists, "Missing" otherwise.
- [ ] **RatiosCard** — E/I, Valsalva, 30:15.
- [ ] **SympParaCard** — Resting + Standing LFa, RFa, SB + impressionText.

## 4. Missing & Conflicting detection

- [ ] **MissingDataCard** — when a critical field (e.g. all phase HRs missing)
      is absent, an item appears with red dot for `critical`, amber for
      `important`, muted for `info`.
- [ ] When `diagnosticSummary.unsafeOrUnsupportedClaimsBlocked` is non-empty,
      each blocked claim appears in the missing list.
- [ ] **ConflictingDataCard** — synthesize a study where DOB and ageAtStudy
      disagree by >1.5 years. Conflict appears.
- [ ] If SBP < DBP in any phase, conflict appears.
- [ ] If parser emitted `extractionWarnings` with severity="error", they appear.

## 5. Why expanders

- [ ] In ClinicianPortal, the new "Why these conclusions?" panel renders
      between DataQualityPanel and RestingBaselinePanel.
- [ ] Each abnormal finding row shows code, domain, severity and a WhyExpander.
- [ ] Each active phenotype flag (present=true) shows label, id, confidence,
      WhyExpander.
- [ ] Clicking the chevron expands to show: rationale, criteria list (met /
      unmet dots with observed values inline), source field paths with
      resolved values, threshold ref, confidence chip.
- [ ] Re-clicking collapses the panel.

## 6. JSON download integrity

- [ ] Downloaded JSON parses (use `jq .` or paste into a validator).
- [ ] `payload.ansStudy.fileMetadata.studyDate` matches the value shown in
      DemographicsCard.
- [ ] `payload.diagnosticSummary.reportConfidenceScore * 100` matches the
      number on the confidence ring.

## 7. Mobile responsiveness

At 375px width verify:

- [ ] Action bar wraps; buttons remain tappable (≥36px target).
- [ ] All card grids collapse to single column.
- [ ] Confidence ring stays centered, parser bar and footer stack vertically.
- [ ] PhaseCard quad grid collapses to 1 column (no horizontal scroll).
- [ ] Tooltips on provenance icons are reachable via tap (no hover lock).

## 8. Dark-mode contrast

- [ ] Every card uses `bg-card/50` + `border-border/30` — no off-brand
      hex colors visible.
- [ ] Confidence chip text remains legible on dark background for High /
      Medium / Low bands.
- [ ] Generate Report button gradient contrasts with dark background; disabled
      state remains visibly muted but still readable.

## 9. Regression — existing pipeline

- [ ] `npm run test:ans` still passes (57/57).
- [ ] `npm run eval:ci` still green.
- [ ] After Generate Report, ReportDashboard renders unchanged (PR5 is
      additive — no patient/clinician portal regressions).
- [ ] Patient-side AskAtom logo remains the blue Atom logo.

## 10. Performance

- [ ] /api/parse round-trip <2s for a typical 200KB .ans file.
- [ ] Review screen first paint <250ms after parse response.
- [ ] No console errors or warnings.
