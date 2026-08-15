# HumanOS ANS - Clinical Rule Ledger

**Version** 1.0.0 &nbsp;&nbsp; **Generated** 2026-08-15 &nbsp;&nbsp; **Rules** 67 &nbsp;&nbsp; **Generator** `governance/_build_governance.py`

> Generated artifact. Edit `governance/_build_governance.py` and regenerate; do not hand-edit this file or `clinical-rule-ledger.json`. Validate with `node governance/validate-clinical-governance.mjs`.

## 1. What this document is, and is not

- Prior parity work compared numeric field families between the engine and the paired vendor PDFs. It did not establish clinical accuracy, clinical safety or regulatory fitness, and nothing in these artifacts should be read as claiming that it did.
- The 2026-08-14 walkthrough reviewed one study end to end. The clinical authority stated explicitly at 00:00:43 that the corrections being given were not universal. Rules derived from a single case-specific remark are marked needs_clinician_wording or provisional_needs_source.
- This validator checks structure, completeness and internal coherence of the governance artifacts. It cannot and does not check clinical correctness.
- No open-web research was used to produce these artifacts. Every rule traces to the 2026-08-09 email, the 2026-08-14 recorded walkthrough, or an internal repository artifact.
- The vendor's per-phase spectral scalars are produced by an undisclosed proprietary algorithm and are not stored in the .ans binary. Values the engine computes for those fields are approximations and must never be presented as vendor-validated.

## 2. Sources of record

### `email_2026_08_09`

- **kind**: email
- **from**: J. Colombo, PhD, DNM, DHS (CTO & Senior Medical Director, Physio PS, Inc.)
- **to**: S. O'Leary (PhysioPS); B. O'Leary (Thingk Tangk)
- **sent**: 2026-08-09T14:45:25
- **subject**: Re: HumanOS ANS - Final Clinical Validation and Mission Success
- **artifact**: uploaded_attachments/cd97f881e4bd4c71ab356c7c316a7c3e/image.jpg
- **citation_style**: email item N
- **confidentiality**: Marked CONFIDENTIAL by sender. Internal, source-controlled use only.

### `walkthrough_2026_08_14`

- **kind**: recorded_clinical_walkthrough
- **participants**: jc = J. Colombo (clinical authority); PhysioPS = S. O'Leary (product owner)
- **absent**: B. O'Leary (engineering) did not attend (ref 00:38:18)
- **recorded**: 2026-08-14T15:30:44
- **duration**: 00:38:59
- **artifact_transcript**: uploaded_attachments/c1f94bdf566d4d0c895e3dc3b6d1709f/GMT20260814-153044_Recording.cutfile.20260814201840473.transcript.vtt
- **artifact_recording**: uploaded_attachments/c1f94bdf566d4d0c895e3dc3b6d1709f/GMT20260814-153044_Recording.cutfile.20260814201840473_1366x720.mp4
- **case_under_review**: FIX-C01 (walkthrough identifies the loaded study at 00:06:35-00:06:44)
- **citation_style**: HH:MM:SS timestamp of the transcript cue
- **scope_caveat**: At 00:00:43 the clinical authority states explicitly that the corrections being given are 'not a universal correction' - they apply to other reports but must not be assumed globally true. Any rule derived from a single case-specific remark is marked needs_clinician_wording or provisional_needs_source, never confirmed as a universal production rule.

## 3. Status vocabulary

| Status | Meaning |
| --- | --- |
| `confirmed_email` | Decision stated in writing by the clinical authority in the 2026-08-09 email. Highest-strength internal evidence. |
| `confirmed_in_review` | Decision explicitly stated and agreed during the 2026-08-14 recorded walkthrough, with an unambiguous transcript reference. |
| `rejected` | Content, wording or behavior explicitly rejected for release. The gate requires that it be absent from output. |
| `needs_clinician_wording` | Direction is clear but the exact clinician-approved wording, threshold or classification boundary has not been supplied. Cannot ship as generated text. |
| `provisional_needs_source` | Clinically consequential statement (diagnosis, risk, oncology, treatment, urgency) that requires a documented source plus clinical, legal and regulatory approval before any implementation. Must not be encoded as an active production rule. |
| `product_direction` | Non-clinical product, engineering or operational decision. Governed by product/engineering owners, not by clinical sign-off. |

An ambiguous transcript statement is never promoted to `confirmed_*`. Where the direction is clear but the clinical language is not, the rule is `needs_clinician_wording` and the gate blocks generated text. Where the statement is clinically consequential and unsourced, the rule is `provisional_needs_source` and is blocked in code.

## 4. Data-class vocabulary

| Data class | Definition |
| --- | --- |
| `measured_data` | Values acquired from the device/study and parsed from the .ans binary or read from the vendor PDF. Never authored by the engine. |
| `deterministic_calculation` | Values computed by pinned, versioned, side-effect-free code from measured data. Same input must always produce the same output. |
| `ai_narrative` | Language generated or assembled by the model/RAG layer. Never a clinical conclusion of record. |
| `clinician_approved_conclusion` | A conclusion, phenotype, plan or therapy that only exists once a licensed clinician has explicitly approved it in the product. |
| `patient_visible_content` | Content rendered to a patient. Permitted only if it originates from clinician_approved_conclusion or from raw measured data released with the physician-interpretation disclaimer. |
| `system_behavior` | Non-clinical platform behavior (determinism, provenance isolation, layout, accessibility, dictation). |

The escalation order is one-way: measured data and deterministic calculations may feed AI narrative; only a licensed clinician may convert narrative into a clinician-approved conclusion; only a clinician-approved conclusion (or raw data released under the physician-interpretation disclaimer) may become patient-visible content.

## 5. Priority and ownership

| Priority | Meaning |
| --- | --- |
| `P0` | Stop-ship. Release is blocked while open. |
| `P1` | Required for clinician pilot release. Blocks the clinician-only first release sign-off. |
| `P2` | Required before broader rollout or the patient experience. |
| `P3` | Tracked improvement, not release blocking. |

| Owner key | Person / role |
| --- | --- |
| `clinical_authority` | J. Colombo, PhD, DNM, DHS - clinical authority of record |
| `product_owner` | S. O'Leary - PhysioPS product owner |
| `engineering` | B. O'Leary - Thingk Tangk engineering |
| `qa` | HumanOS QA / governance gate maintainer |
| `legal_regulatory` | UNASSIGNED - legal/regulatory reviewer for Physio PS, Inc. (open staffing gap, see open questions) |

## 6. Counts

**By status**

| Status | Rules |
| --- | ---: |
| `confirmed_email` | 4 |
| `confirmed_in_review` | 26 |
| `needs_clinician_wording` | 10 |
| `product_direction` | 10 |
| `provisional_needs_source` | 6 |
| `rejected` | 11 |

**By priority**

| Priority | Rules |
| --- | ---: |
| `P0` | 29 |
| `P1` | 23 |
| `P2` | 14 |
| `P3` | 1 |

**By data class**

| Data class | Rules |
| --- | ---: |
| `ai_narrative` | 22 |
| `clinician_approved_conclusion` | 6 |
| `deterministic_calculation` | 11 |
| `measured_data` | 2 |
| `patient_visible_content` | 7 |
| `system_behavior` | 19 |

**By approval owner**

| Approval owner | Rules |
| --- | ---: |
| `clinical_authority` | 44 |
| `engineering` | 6 |
| `legal_regulatory` | 7 |
| `product_owner` | 9 |
| `qa` | 1 |

**By domain**

| Domain | Rules |
| --- | ---: |
| `accessibility` | 1 |
| `attribution` | 3 |
| `baseline_estimation` | 2 |
| `baseline_semantics` | 1 |
| `classification` | 4 |
| `clinician_workflow` | 1 |
| `defect_operational` | 1 |
| `determinism` | 2 |
| `disclaimers` | 3 |
| `governance_claims` | 1 |
| `high_risk_claim` | 6 |
| `information_architecture` | 4 |
| `interpretation` | 7 |
| `interpretation_ordering` | 1 |
| `longitudinal` | 2 |
| `process` | 2 |
| `product_scope` | 3 |
| `provenance` | 3 |
| `provenance_ux` | 1 |
| `regulatory` | 1 |
| `release_scope` | 3 |
| `report_composition` | 6 |
| `visual_encoding` | 1 |
| `wording_safety` | 8 |

Open questions requiring the clinical authority or legal/regulatory: **50**.

## 7. Rule index

| ID | Title | Domain | Status | Pri | Owner |
| --- | --- | --- | --- | --- | --- |
| `CLIN-FRF-001` | High-FRF finding must lead the deep-breathing Explain panel | `interpretation_ordering` | `confirmed_in_review` | P1 | `clinical_authority` |
| `CLIN-FRF-002` | High FRF does not invalidate the test | `interpretation` | `confirmed_in_review` | P0 | `clinical_authority` |
| `CLIN-FRF-003` | High FRF mechanism statement: vagus struggling to ventilate | `interpretation` | `needs_clinician_wording` | P1 | `clinical_authority` |
| `CLIN-FRF-004` | High FRF or high deep-breathing response indicates possible pulmonary / upper respiratory disorder | `interpretation` | `confirmed_in_review` | P1 | `clinical_authority` |
| `CLIN-FRF-005` | High FRF requires confirmation that the deep-breathing maneuver was performed correctly | `clinician_workflow` | `confirmed_in_review` | P2 | `clinical_authority` |
| `CLIN-FRF-006` | Spectral-window technical explanation is rejected for clinician-facing copy | `wording_safety` | `rejected` | P1 | `clinical_authority` |
| `CLIN-FRF-007` | 'Artificially reduces' FRF phrasing is rejected | `wording_safety` | `rejected` | P0 | `clinical_authority` |
| `CLIN-FRF-008` | Early lung-cancer indication from high FRF - blocked high-risk claim | `high_risk_claim` | `provisional_needs_source` | P0 | `legal_regulatory` |
| `CLIN-FRF-009` | FRF is clinically required only at deep breathing; baseline FRF is not needed | `report_composition` | `confirmed_in_review` | P2 | `clinical_authority` |
| `CLIN-FRF-010` | Parasympathetic interpretation must be qualified by FRF status | `interpretation` | `needs_clinician_wording` | P1 | `clinical_authority` |
| `CLIN-BASE-001` | Recovery phases are intentionally too short to be true baseline returns | `baseline_semantics` | `confirmed_email` | P0 | `clinical_authority` |
| `CLIN-BASE-002` | Average of valid Baseline C and E may estimate a corrupted Baseline A for LFa, RFa and ratio | `baseline_estimation` | `confirmed_email` | P0 | `clinical_authority` |
| `CLIN-BASE-003` | Baseline substitution is valid only under matched capture conditions and only if the donor phase is itself valid | `baseline_estimation` | `confirmed_in_review` | P0 | `clinical_authority` |
| `CLIN-BASE-004` | Phase-row pruning when baselines are substituted is undecided | `report_composition` | `needs_clinician_wording` | P2 | `clinical_authority` |
| `CLIN-BASE-005` | Phase corruption detection must be deterministic, explicit and auditable | `determinism` | `needs_clinician_wording` | P1 | `clinical_authority` |
| `CLIN-RETEST-001` | Separate physiologic tests are never duplicates - the ANS is always active | `longitudinal` | `confirmed_email` | P0 | `clinical_authority` |
| `CLIN-RETEST-002` | Within-15% change may be considered clinically constant only when symptoms and context are stable | `longitudinal` | `confirmed_email` | P0 | `clinical_authority` |
| `CLIN-DET-001` | The same file processed twice must be byte/value deterministic | `determinism` | `product_direction` | P0 | `engineering` |
| `CLIN-BP-001` | Blood pressure classification defect - elevated BP was summarised as normal | `classification` | `confirmed_in_review` | P0 | `clinical_authority` |
| `CLIN-BP-002` | BP threshold table must be an explicitly cited, versioned source | `classification` | `needs_clinician_wording` | P0 | `clinical_authority` |
| `CLIN-VALS-001` | There is no low parasympathetic response to Valsalva - that pattern is normal | `classification` | `confirmed_in_review` | P0 | `clinical_authority` |
| `CLIN-VALS-002` | Low sympathetic Valsalva response requires an autonomic-dysfunction suggestion plus a sudomotor implication | `interpretation` | `needs_clinician_wording` | P1 | `clinical_authority` |
| `CLIN-STAND-001` | Stand-response classification defect - 'normal sympathetic response to stand' was wrong for the reviewed case | `classification` | `confirmed_in_review` | P0 | `clinical_authority` |
| `CLIN-STAND-002` | Blunted heart-rate response to stand plus non-rising BP - orthostatic interpretation correction | `interpretation` | `needs_clinician_wording` | P1 | `clinical_authority` |
| `CLIN-LANG-001` | 'Parasympathetic withdrawal' is rejected terminology | `wording_safety` | `rejected` | P0 | `clinical_authority` |
| `CLIN-LANG-002` | 'With the available orthostatic blood pressure' is rejected wording | `wording_safety` | `rejected` | P1 | `clinical_authority` |
| `CLIN-LANG-003` | 'No responses across all autonomic challenges suggests advanced autonomic dysfunction' understates severity | `interpretation` | `needs_clinician_wording` | P1 | `clinical_authority` |
| `CLIN-LANG-004` | Physiologic-age framing in the deep-breathing explanation is rejected | `wording_safety` | `rejected` | P2 | `clinical_authority` |
| `CLIN-RATIO-001` | E:I, Valsalva and 30:15 (Ewing) ratios are rejected for display | `report_composition` | `rejected` | P1 | `clinical_authority` |
| `CLIN-RATIO-002` | Cardio-respiratory coupling and time-domain ratios are collapsed behind a disclosure control | `report_composition` | `confirmed_in_review` | P2 | `clinical_authority` |
| `CLIN-TERM-001` | Prefer parasympathetic/sympathetic wording, with a referenced LFa/RFa footnote | `wording_safety` | `confirmed_in_review` | P2 | `clinical_authority` |
| `CLIN-DUP-001` | Duplicated numerical summary / six-event table must be de-duplicated | `report_composition` | `rejected` | P2 | `product_owner` |
| `CLIN-DENS-001` | Table density must be reduced to clinically-used values only | `report_composition` | `needs_clinician_wording` | P2 | `clinical_authority` |
| `GOV-RAG-001` | Retrieval must be restricted to the closed, approved corpus | `provenance` | `confirmed_in_review` | P0 | `engineering` |
| `GOV-RAG-002` | Every retrieved passage must carry exact document and page provenance | `provenance` | `confirmed_in_review` | P0 | `engineering` |
| `GOV-RAG-003` | The assistant must abstain rather than answer clinical questions unsupported by the corpus | `provenance` | `confirmed_in_review` | P0 | `clinical_authority` |
| `GOV-PARITY-001` | Parity evidence must not be represented as proof of clinical accuracy | `governance_claims` | `product_direction` | P0 | `qa` |
| `GOV-NAME-001` | Remove the clinical authority's name from generic analogies and report body | `attribution` | `rejected` | P1 | `clinical_authority` |
| `GOV-NAME-002` | Physician report footer may offer physician-to-physician contact with the clinical authority | `attribution` | `confirmed_in_review` | P2 | `clinical_authority` |
| `GOV-NAME-003` | Patient questions route to the physician of record | `attribution` | `confirmed_in_review` | P0 | `clinical_authority` |
| `GOV-DISC-001` | Physician-interpretation disclaimer on every output | `disclaimers` | `confirmed_in_review` | P0 | `clinical_authority` |
| `GOV-DISC-002` | Reporting-application statement is pending from the product owner | `disclaimers` | `needs_clinician_wording` | P1 | `product_owner` |
| `GOV-DISC-003` | Patient full-data download requires the not-valid-without-physician-interpretation notice | `disclaimers` | `confirmed_in_review` | P1 | `clinical_authority` |
| `GOV-WORD-001` | 'Not vendor validated' caveat wording is rejected as misleading | `wording_safety` | `rejected` | P0 | `clinical_authority` |
| `GOV-SCOPE-001` | Patient self-service upload is rejected for the first release - clinician-only | `release_scope` | `rejected` | P0 | `product_owner` |
| `GOV-SCOPE-002` | The patient experience is a separate surface populated only from clinician-approved content | `release_scope` | `confirmed_in_review` | P0 | `clinical_authority` |
| `GOV-SCOPE-003` | Patient-directed phrasing in the clinician view is rejected | `wording_safety` | `rejected` | P1 | `clinical_authority` |
| `GOV-SCOPE-004` | The plan of care must come from a licensed physician, never from the engine | `release_scope` | `confirmed_in_review` | P0 | `clinical_authority` |
| `GOV-REG-001` | Regulatory posture must be recorded before terminology and claim changes ship | `regulatory` | `product_direction` | P1 | `legal_regulatory` |
| `GOV-RISK-001` | High-risk claim classes are blocked pending documented source and legal/regulatory approval | `high_risk_claim` | `provisional_needs_source` | P0 | `legal_regulatory` |
| `GOV-RISK-002` | Fixed cardiovascular-event risk statements are blocked | `high_risk_claim` | `provisional_needs_source` | P0 | `legal_regulatory` |
| `GOV-RISK-003` | Urgent time-bound directives are blocked | `high_risk_claim` | `provisional_needs_source` | P0 | `legal_regulatory` |
| `GOV-RISK-004` | Named diagnoses may appear as assertions only as clinician-approved conclusions | `high_risk_claim` | `provisional_needs_source` | P0 | `clinical_authority` |
| `GOV-RISK-005` | Therapy, supplement, pharmaceutical, dose and frequency content is clinician-entered only | `high_risk_claim` | `provisional_needs_source` | P0 | `legal_regulatory` |
| `UX-CLIN-001` | Classification states must be encoded in high-contrast distinct hues, not pastel shades | `visual_encoding` | `confirmed_in_review` | P1 | `product_owner` |
| `UX-CLIN-002` | Dense technical sections must be collapsed behind a visible disclosure control | `information_architecture` | `confirmed_in_review` | P1 | `product_owner` |
| `UX-CLIN-003` | Rhythm strip must be fully inspectable with legible ectopic annotation | `information_architecture` | `confirmed_in_review` | P1 | `engineering` |
| `UX-CLIN-004` | Classified graphs lead; the concise numeric table follows the explanations as a summary | `information_architecture` | `confirmed_in_review` | P2 | `clinical_authority` |
| `UX-CLIN-005` | Every displayed number must carry a normal range or classification, or be removed | `information_architecture` | `confirmed_in_review` | P1 | `clinical_authority` |
| `UX-CLIN-006` | Retrieved source citations must be inspectable with document and page | `provenance_ux` | `product_direction` | P2 | `engineering` |
| `UX-A11Y-001` | Clinician surfaces must be legible for reduced colour discrimination and older users | `accessibility` | `product_direction` | P1 | `product_owner` |
| `OPS-VOICE-001` | Voice dictation into Ask ATOM truncates after roughly every second word | `defect_operational` | `confirmed_in_review` | P1 | `engineering` |
| `OPS-EVID-001` | Clinical review sessions require legible evidence capture | `process` | `product_direction` | P2 | `product_owner` |
| `OPS-PLAN-001` | Calendar-year delivery commitment and engineering attendance risk are tracked, not gated | `process` | `product_direction` | P3 | `product_owner` |
| `PROD-PAT-001` | Patient experience is a separate, simple destination added after the clinician release | `product_scope` | `product_direction` | P2 | `product_owner` |
| `PROD-PAT-002` | Clinician approve/decline controls are the only channel that populates patient content | `product_scope` | `product_direction` | P1 | `clinical_authority` |
| `PROD-PAT-003` | Patients may download their full data behind an explicit physician-interpretation gate | `product_scope` | `product_direction` | P2 | `legal_regulatory` |

## 8. Rules

### `CLIN-FRF-001` - High-FRF finding must lead the deep-breathing Explain panel

| Field | Value |
| --- | --- |
| Domain | `interpretation_ordering` |
| Status | `confirmed_in_review` |
| Priority | `P1` |
| Confidence | `high` |
| Data class | `ai_narrative` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-FRF-002`, `CLIN-FRF-003`, `CLIN-FRF-010` |

**Source evidence**

- walkthrough `00:00:57-00:01:20` - "this explanation, I clicked on explained here. This explanation should start with ... the fact that the FRF is high. Or, our multi-parameter graph report says FRF is out of range. So, we need to explain what that means."

**Trigger**

- Clinician opens the Explain panel for a study whose deep-breathing FRF is classified out of range (high).
- input fields: `deepBreathing.frf`, `deepBreathing.frfClassification`, `explainPanel.render`

**Deterministic preconditions**

- deepBreathing.frf is present and non-null (not 'unavailable').
- deepBreathing.frfClassification == 'high' (deterministic classifier output, not narrative).

**Required output behavior**

- The first rendered paragraph of the Explain panel states that FRF is high / out of range.
- The second statement explains what a high FRF means clinically (see CLIN-FRF-003).
- The non-invalidation statement (CLIN-FRF-002) appears before any downstream parasympathetic interpretation.

**Prohibited wording / behavior**

- Opening the panel with age framing, analogies, or generic autonomic prose while FRF is out of range.
- Burying the FRF finding below the parasympathetic conclusion.

**Acceptance criteria**

- **Given** a study with deepBreathing.frfClassification == 'high' **when** the clinician opens the deep-breathing Explain panel **then** the first sentence contains the high/out-of-range FRF statement and precedes every parasympathetic interpretation sentence in DOM order.

**Open questions**

- Is the required ordering universal for all high-FRF studies, or only when deep-breathing RFa is also abnormal? (00:00:43 scope caveat)

### `CLIN-FRF-002` - High FRF does not invalidate the test

| Field | Value |
| --- | --- |
| Domain | `interpretation` |
| Status | `confirmed_in_review` |
| Priority | `P0` |
| Confidence | `high` |
| Data class | `ai_narrative` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | none |

**Source evidence**

- walkthrough `00:03:32-00:03:39` - "You gotta explain that, okay, the FRF is high, but that doesn't invalidate the test. First thing the doctor needs to know."

**Trigger**

- Any report where FRF is out of range.
- input fields: `deepBreathing.frfClassification`, `study.validityFlags`

**Deterministic preconditions**

- deepBreathing.frfClassification in ('high','out_of_range')

**Required output behavior**

- Report states explicitly that a high FRF does not invalidate the study.
- Study-level validity flags remain 'valid' on the basis of FRF alone.

**Prohibited wording / behavior**

- Any wording implying the test is invalid, unusable, void, or must be repeated because FRF is high.
- Suppressing the deep-breathing results because FRF is high.

**Acceptance criteria**

- **Given** a high-FRF study **when** the clinician report is generated **then** the rendered text contains an explicit non-invalidation statement and contains none of the prohibited invalidity phrases.
- **Given** a high-FRF study **when** study validity is computed **then** validity is not downgraded by the FRF classification alone.

### `CLIN-FRF-003` - High FRF mechanism statement: vagus struggling to ventilate

| Field | Value |
| --- | --- |
| Domain | `interpretation` |
| Status | `needs_clinician_wording` |
| Priority | `P1` |
| Confidence | `medium` |
| Data class | `ai_narrative` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-FRF-001`, `CLIN-FRF-006` |

**Source evidence**

- walkthrough `00:01:42-00:01:53` - "what it does mean, FRF is high, is usually the vagus nerve is struggling to ventilate. That's why the frequency is high."
- walkthrough `00:03:39-00:03:46` - "Second thing a doctor needs to know is, okay, it's high because the vagus is struggling to ventilate. Which means you have some sort of pulmonary or upper respiratory problem."

**Trigger**

- High-FRF explanation body.
- input fields: `deepBreathing.frfClassification`

**Deterministic preconditions**

- deepBreathing.frfClassification == 'high'

**Required output behavior**

- Mechanism sentence uses the clinician's hedged construction ('usually', 'often') rather than an absolute causal claim.
- Exact production sentence must be supplied verbatim by the clinical authority before release.

**Prohibited wording / behavior**

- Absolute causal phrasing ('is caused by', 'proves', 'confirms').
- The amplitude-modulation / carrier-wave / spectral-window explanation in clinician-facing copy (see CLIN-FRF-006).

**Acceptance criteria**

- **Given** no verbatim clinician-approved mechanism sentence exists in the wording registry **when** the generator attempts to emit a high-FRF mechanism sentence **then** the build fails the wording-safety gate and the panel renders the approved placeholder instead of model-authored prose.

**Open questions**

- Supply the verbatim mechanism sentence, including the intended hedge ('usually' vs 'often' vs 'may reflect').

### `CLIN-FRF-004` - High FRF or high deep-breathing response indicates possible pulmonary / upper respiratory disorder

| Field | Value |
| --- | --- |
| Domain | `interpretation` |
| Status | `confirmed_in_review` |
| Priority | `P1` |
| Confidence | `high` |
| Data class | `ai_narrative` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-FRF-007`, `GOV-RISK-001` |

**Source evidence**

- walkthrough `00:03:17-00:03:28` - "either the FRF being high, or the deep breathing results being high. Indicates possible pulmonary or upper respiratory disorder."
- walkthrough `00:25:35-00:25:52` - "just say, hi FRF. May be associated with upper respiratory pulmonary disorder ... Yes, we can keep anxiety, though. Consider treating the patient and retest it. Yep, good."

**Trigger**

- High FRF or high deep-breathing response.
- input fields: `deepBreathing.frfClassification`, `deepBreathing.rfaClassification`

**Deterministic preconditions**

- deepBreathing.frfClassification == 'high' OR deepBreathing.responseClassification == 'high'

**Required output behavior**

- Emit a possibility-framed association with upper respiratory / pulmonary disorder.
- Anxiety may be retained as an alternative association.
- Emit 'consider treating and retesting' as a clinician-directed suggestion.

**Prohibited wording / behavior**

- Naming a specific pulmonary diagnosis (asthma, COPD, bronchitis) as a finding.
- Any oncology claim (see CLIN-FRF-008 / GOV-RISK-001).

**Acceptance criteria**

- **Given** a study with high deep-breathing FRF **when** the findings section is generated **then** it contains a possibility-framed upper-respiratory/pulmonary association, optionally anxiety, and a consider-treat-and-retest suggestion, and contains no named respiratory diagnosis.

**Open questions**

- Are asthma/COPD/bronchitis/wheezing permitted as illustrative examples in the clinician view, or must they stay out of rendered copy entirely? (mentioned only conversationally at 00:02:58)

### `CLIN-FRF-005` - High FRF requires confirmation that the deep-breathing maneuver was performed correctly

| Field | Value |
| --- | --- |
| Domain | `clinician_workflow` |
| Status | `confirmed_in_review` |
| Priority | `P2` |
| Confidence | `medium` |
| Data class | `clinician_approved_conclusion` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-FRF-001` |

**Source evidence**

- walkthrough `00:01:53-00:02:00` - "You gotta confirm with the doctor that they did 6 breaths, and they did 6 slow breaths properly."
- walkthrough `00:02:26-00:02:34` - "The low-frequency carrier, according to the breathing chart that I just saw up above, says she did it right."

**Trigger**

- High FRF study.
- input fields: `deepBreathing.frfClassification`, `breathingChart`

**Deterministic preconditions**

- deepBreathing.frfClassification == 'high'

**Required output behavior**

- Prompt the clinician to confirm six slow breaths were performed correctly, with the breathing chart adjacent to the prompt.
- Record the clinician's confirmation as an explicit, attributable field.

**Prohibited wording / behavior**

- Asserting maneuver adequacy automatically from the breathing chart without clinician confirmation.

**Acceptance criteria**

- **Given** a high-FRF study **when** the clinician opens the deep-breathing section **then** a maneuver-confirmation control is present, defaults to unconfirmed, and the report records the clinician's response.

**Open questions**

- Should an unconfirmed maneuver suppress or only caveat the high-FRF interpretation?

### `CLIN-FRF-006` - Spectral-window technical explanation is rejected for clinician-facing copy

| Field | Value |
| --- | --- |
| Domain | `wording_safety` |
| Status | `rejected` |
| Priority | `P1` |
| Confidence | `high` |
| Data class | `ai_narrative` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-FRF-003`, `UX-CLIN-002` |

**Source evidence**

- walkthrough `00:01:20-00:01:41` - "we don't need to explain it technically ... The fundamental respiratory frequency being too high means you're looking at the wrong area of the spectrum. I don't expect to say that, I've never said that, except in my book once."
- walkthrough `00:02:00-00:02:26` - "now I'm talking to you, technically, not what I would say to a doctor ... you have a jagged sine wave ... amplitude modulated waveform"

**Trigger**

- Any clinician-facing narrative.
- input fields: `explainPanel.text`

**Deterministic preconditions**

- Rendered clinician narrative text is being assembled.

**Required output behavior**

- Rendered copy stays at the clinical-meaning level.
- Signal-processing rationale, if retained at all, is confined to a collapsed methodology appendix and is not part of the finding.

**Prohibited wording / behavior**

- 'wrong area of the spectrum'
- 'amplitude modulated'
- 'carrier'
- 'jagged sine wave'
- 'raggedy sine wave'
- Driving/fuel/bucking-car analogies in rendered copy.

**Acceptance criteria**

- **Given** the wording-safety denylist containing the spectral-window phrases **when** any clinician-facing narrative is generated for the full fixture cohort **then** zero denylisted phrases appear in rendered clinician copy.

### `CLIN-FRF-007` - 'Artificially reduces' FRF phrasing is rejected

| Field | Value |
| --- | --- |
| Domain | `wording_safety` |
| Status | `rejected` |
| Priority | `P0` |
| Confidence | `high` |
| Data class | `ai_narrative` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-FRF-004`, `CLIN-FRF-002` |

**Source evidence**

- walkthrough `00:25:30-00:25:42` - "Fundamental respiratory frequency high, artificially reduces. Maybe an associate, okay. I'd take out of the artificially reduces part, and just say, hi FRF."

**Trigger**

- FRF findings line.
- input fields: `findings.frfLine`

**Deterministic preconditions**

- The FRF findings line is being generated.

**Required output behavior**

- Replacement line: high FRF may be associated with upper respiratory / pulmonary disorder (or anxiety), consider treating and retesting.

**Prohibited wording / behavior**

- 'artificially reduces'
- Any claim that high FRF suppresses, deflates or invalidates the measured parasympathetic value.

**Acceptance criteria**

- **Given** a high-FRF study **when** the findings section is generated **then** the string 'artificially reduces' is absent and the approved association line is present.

### `CLIN-FRF-008` - Early lung-cancer indication from high FRF - blocked high-risk claim

| Field | Value |
| --- | --- |
| Domain | `high_risk_claim` |
| Status | `provisional_needs_source` |
| Priority | `P0` |
| Confidence | `low` |
| Data class | `ai_narrative` |
| Approval owner | `legal_regulatory` (UNASSIGNED - legal/regulatory reviewer for Physio PS, Inc. (open staffing gap, see open questions)) |
| Dependencies | `GOV-RISK-001` |

**Source evidence**

- walkthrough `00:02:58-00:03:17` - "They may be wheezing, they may have, you know, sinus problems, or bronchitis, or asthma, or COPD. We've even found early lung cancer indications. From FRF being high."
  - note: Conversational aside describing past clinical experience. Not a validated screening claim and not offered as report copy.

**Trigger**

- Any attempt to associate FRF with oncologic findings.
- input fields: `deepBreathing.frf`

**Deterministic preconditions**

- N/A - no production precondition exists; this content is blocked.

**Required output behavior**

- Blocked. The engine must never emit oncology detection, screening or suspicion language from any ANS metric.
- If clinically desired later, it requires a documented published source, clinical sign-off, and legal/regulatory review recorded in this ledger.

**Prohibited wording / behavior**

- 'cancer'
- 'lung cancer'
- 'malignancy'
- 'tumor'
- 'oncologic'
- 'screening for cancer'

**Acceptance criteria**

- **Given** the full fixture cohort **when** clinician and patient outputs are generated **then** zero oncology terms appear anywhere in rendered output or RAG answers.
- **Given** an adversarial chat turn asking whether the study indicates cancer **when** the assistant answers **then** it refuses, states the test does not assess oncologic risk, and routes to the physician of record.

**Open questions**

- Is there a citable published source for the FRF/early-lung-findings observation? Until supplied, this stays permanently blocked.

### `CLIN-FRF-009` - FRF is clinically required only at deep breathing; baseline FRF is not needed

| Field | Value |
| --- | --- |
| Domain | `report_composition` |
| Status | `confirmed_in_review` |
| Priority | `P2` |
| Confidence | `high` |
| Data class | `deterministic_calculation` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `UX-CLIN-005`, `CLIN-DENS-001` |

**Source evidence**

- walkthrough `00:12:43-00:13:20` - "at deep breathing, all I'm really worried about is the RFA, and the FRF. And the only FRF I care about in this entire column is Deep breathing ... except for FRF at baseline, you need all the rest of this information. A deep breathing. The heart rate, FRF, RFA, And blood pressure is important."

**Trigger**

- Numerical summary composition.
- input fields: `numericalSummary.rows`

**Deterministic preconditions**

- The numerical summary table is being composed for the clinician view.

**Required output behavior**

- Deep breathing row retains heart rate, FRF, RFa and blood pressure.
- Baseline-phase FRF cells are removed from the default clinician view (available in the collapsed technical appendix).

**Prohibited wording / behavior**

- Rendering baseline FRF as a headline clinical value.

**Acceptance criteria**

- **Given** a parsed study **when** the default clinician numerical summary renders **then** no baseline-phase FRF cell is present in the default view and the deep-breathing row retains HR, FRF, RFa and BP.

**Open questions**

- Confirm whether baseline FRF should be hidden or shown greyed with a 'not clinically used' marker.

### `CLIN-FRF-010` - Parasympathetic interpretation must be qualified by FRF status

| Field | Value |
| --- | --- |
| Domain | `interpretation` |
| Status | `needs_clinician_wording` |
| Priority | `P1` |
| Confidence | `low` |
| Data class | `ai_narrative` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-FRF-002`, `CLIN-FRF-003` |

**Source evidence**

- walkthrough `00:25:56-00:26:14` - "Given that, I ... Ignore the rest of this. If the FRF is Normal, then we can look at low parasympathetic"
  - note: Statement is truncated and ambiguous. The direction (FRF status gates parasympathetic reading) is clear; the exact gating behavior is not.

**Trigger**

- Parasympathetic interpretation generation.
- input fields: `deepBreathing.frfClassification`, `parasympatheticInterpretation`

**Deterministic preconditions**

- A parasympathetic classification is about to be narrated.

**Required output behavior**

- When FRF is normal, the low-parasympathetic reading is narrated normally.
- When FRF is high, the low-parasympathetic reading must carry an explicit qualifier pending clinician wording.

**Prohibited wording / behavior**

- Silently deleting or silently asserting the parasympathetic conclusion when FRF is high.
- Treating the truncated transcript line as approval for suppressing findings.

**Acceptance criteria**

- **Given** a high-FRF study with low parasympathetic activity **when** the interpretation is generated **then** the parasympathetic line carries the FRF qualifier and the qualifier text comes from the approved wording registry, otherwise the gate fails.

**Open questions**

- When FRF is high, is the low-parasympathetic finding (a) reported with a caveat, (b) reported but not scored, or (c) withheld pending retest?

### `CLIN-BASE-001` - Recovery phases are intentionally too short to be true baseline returns

| Field | Value |
| --- | --- |
| Domain | `baseline_semantics` |
| Status | `confirmed_email` |
| Priority | `P0` |
| Confidence | `high` |
| Data class | `ai_narrative` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-BASE-002` |

**Source evidence**

- email `email item 1` - "Recovery phases are purposely too short to be true returns to baseline, but do have utility as their averages help to provide an estimate of an initial baseline if it is corrupted by ectopy."

**Trigger**

- Any narrative or scoring that treats a recovery phase as a return to baseline.
- input fields: `phases.baselineC`, `phases.baselineE`, `recoveryInterpretation`

**Deterministic preconditions**

- A recovery/post-challenge baseline phase (C or E) is being interpreted.

**Required output behavior**

- Recovery phases are described as short recovery windows by design, not as returns to baseline.
- Their documented utility is estimating a corrupted initial baseline (see CLIN-BASE-002).

**Prohibited wording / behavior**

- 'failed to return to baseline'
- 'incomplete recovery to baseline'
- 'did not recover to baseline'
- Scoring or flagging a patient as abnormal because a recovery phase did not reach the initial baseline value.

**Acceptance criteria**

- **Given** the full fixture cohort **when** clinician narratives are generated **then** no output contains failure-to-return-to-baseline language for phases C or E, and no abnormality flag is derived from recovery-vs-baseline deltas.

### `CLIN-BASE-002` - Average of valid Baseline C and E may estimate a corrupted Baseline A for LFa, RFa and ratio

| Field | Value |
| --- | --- |
| Domain | `baseline_estimation` |
| Status | `confirmed_email` |
| Priority | `P0` |
| Confidence | `high` |
| Data class | `deterministic_calculation` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-BASE-001`, `CLIN-BASE-003`, `CLIN-BASE-005` |

**Source evidence**

- email `email item 1` - "their averages help to provide an estimate of an initial baseline if it is corrupted by ectopy."
- walkthrough `00:13:29-00:13:59` - "if baseline A is corrupted because of artifact ectopy, but baseline C and E are not corrupted, a good estimate of what A would have been is an average of C and E. As far as LFA, RFA is concerned, and ratio."
- walkthrough `00:14:22-00:14:35` - "at the average of C and E ... It's sometimes a decent replacement for A if A is corrupted by ectopy. Artifact or arrhythmia."

**Trigger**

- Baseline A is flagged corrupted while C and E are valid.
- input fields: `phases.baselineA.corruptionFlag`, `phases.baselineC.valid`, `phases.baselineE.valid`, `lfa`, `rfa`, `lfaRfaRatio`

**Deterministic preconditions**

- phases.baselineA.corruptionFlag == true with a recorded cause in ('ectopy','artifact','arrhythmia').
- phases.baselineC.valid == true AND phases.baselineE.valid == true.
- Estimation applies only to LFa, RFa and the LFa/RFa ratio.
- Estimator is the arithmetic mean of the C and E values of the same metric, computed deterministically.

**Required output behavior**

- Emit estimated Baseline A LFa/RFa/ratio as mean(C, E) with method = 'estimated_from_recovery_mean'.
- Label the estimated cells visibly as estimates and record provenance (source phases, cause of corruption).
- Preserve the original corrupted Baseline A values in the audit trail.

**Prohibited wording / behavior**

- Applying the estimator to heart rate, blood pressure, FRF or any time-domain ratio.
- Applying the estimator when C or E is itself corrupted.
- Presenting the estimate as a measured value or without the estimate label.
- Silently overwriting Baseline A.

**Acceptance criteria**

- **Given** a study with Baseline A corrupted by ectopy and valid Baselines C and E **when** the engine composes the numerical summary **then** Baseline A LFa, RFa and LFa/RFa equal mean(C,E) to the pinned rounding rule, are marked 'estimated', carry provenance, and heart rate / BP / FRF for Baseline A remain unsubstituted.
- **Given** a study with Baseline A corrupted and Baseline E also corrupted **when** the engine composes the numerical summary **then** no substitution occurs and Baseline A LFa/RFa/ratio render as unavailable with the corruption reason.

**Open questions**

- What deterministic threshold defines 'corrupted by ectopy' for a phase (ectopic beats per phase, percent of beats, or clinician flag)?
- Should the estimate be suppressed when C and E differ from each other by more than a stated tolerance?

### `CLIN-BASE-003` - Baseline substitution is valid only under matched capture conditions and only if the donor phase is itself valid

| Field | Value |
| --- | --- |
| Domain | `baseline_estimation` |
| Status | `confirmed_in_review` |
| Priority | `P0` |
| Confidence | `high` |
| Data class | `deterministic_calculation` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-BASE-002` |

**Source evidence**

- walkthrough `00:16:10-00:16:18` - "Baseline replacement made from ... Should only be used if it was captured under the same condition as it itself was valid."

**Trigger**

- Any baseline substitution.
- input fields: `substitution.request`

**Deterministic preconditions**

- A substitution is being considered for a baseline metric.

**Required output behavior**

- Substitution requires same-study, same-session, same-position capture conditions and a valid donor phase.
- Condition-match and donor-validity checks are evaluated and recorded before substitution.

**Prohibited wording / behavior**

- Cross-study or cross-session substitution.
- Substitution from a phase captured in a different posture or maneuver state.

**Acceptance criteria**

- **Given** a substitution candidate from a different session or posture **when** the substitution rule is evaluated **then** substitution is refused and the reason is recorded in the audit trail.

**Open questions**

- Enumerate the exact capture conditions that must match (posture, time since challenge, medication state).

### `CLIN-BASE-004` - Phase-row pruning when baselines are substituted is undecided

| Field | Value |
| --- | --- |
| Domain | `report_composition` |
| Status | `needs_clinician_wording` |
| Priority | `P2` |
| Confidence | `low` |
| Data class | `system_behavior` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-BASE-002` |

**Source evidence**

- walkthrough `00:13:55-00:14:16` - "So, we can do that automatically and eliminate B, C, and E, rather. But then, you know, you're gonna have A, B, D, and F, Which might be confusing to the doctor."
  - note: Speaker corrects himself mid-sentence and explicitly flags the result as potentially confusing. No decision was reached.

**Trigger**

- Row set selection after substitution.
- input fields: `numericalSummary.rows`, `substitution.applied`

**Deterministic preconditions**

- A baseline substitution has been applied.

**Required output behavior**

- Until decided, keep all six phase rows and mark the estimated cells. Do not remove phases automatically.

**Prohibited wording / behavior**

- Automatically eliminating phase rows C and E from the clinician view.

**Acceptance criteria**

- **Given** a study where Baseline A was estimated from C and E **when** the clinician numerical summary renders **then** all six phase rows are present and only the estimated cells are annotated.

**Open questions**

- After substitution, should rows C and E be hidden, kept, or collapsed?

### `CLIN-BASE-005` - Phase corruption detection must be deterministic, explicit and auditable

| Field | Value |
| --- | --- |
| Domain | `determinism` |
| Status | `needs_clinician_wording` |
| Priority | `P1` |
| Confidence | `medium` |
| Data class | `deterministic_calculation` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-BASE-002`, `CLIN-DET-001` |

**Source evidence**

- walkthrough `00:14:25-00:14:33` - "It's sometimes a decent replacement for A if A is corrupted by ectopy. Artifact or arrhythmia."
  - note: Establishes the causes; does not establish a numeric threshold.
- walkthrough `00:23:17-00:23:25` - "it says so many ... 13 atopic beats, noted."

**Trigger**

- Per-phase validity computation.
- input fields: `phase.ectopicBeats`, `phase.artifactFraction`, `phase.rhythmFlags`

**Deterministic preconditions**

- Per-phase beat and artifact series are available from the .ans parse.

**Required output behavior**

- Per-phase corruption is computed from pinned, versioned thresholds and emitted as a structured flag with cause and evidence counts.
- Corruption flags are visible in the audit trail and identical across repeated runs of the same file.

**Prohibited wording / behavior**

- Model-authored or heuristic-narrative corruption judgements.
- Hidden thresholds not recorded in the versioned configuration.

**Acceptance criteria**

- **Given** the same .ans file **when** corruption flags are computed twice **then** flags, causes and evidence counts are byte-identical.
- **Given** no clinician-approved threshold in the configuration **when** the governance validator runs **then** the rule is reported as blocking-open and no substitution path is enabled in production.

**Open questions**

- Provide the ectopy/artifact threshold per phase that makes a baseline unusable.

### `CLIN-RETEST-001` - Separate physiologic tests are never duplicates - the ANS is always active

| Field | Value |
| --- | --- |
| Domain | `longitudinal` |
| Status | `confirmed_email` |
| Priority | `P0` |
| Confidence | `high` |
| Data class | `ai_narrative` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-RETEST-002`, `CLIN-DET-001` |

**Source evidence**

- email `email item 2` - "The ANS is always active. There is no possibility of duplication from test to test, even within the same hour."

**Trigger**

- Two or more studies for the same patient.
- input fields: `study.acquisitionId`, `study.timestamp`, `priorStudies`

**Deterministic preconditions**

- Two distinct acquisitions exist (distinct acquisition timestamps / distinct raw signal), even within the same hour.

**Required output behavior**

- Each acquisition is treated as an independent physiologic observation and retained.
- Comparison language describes change between observations, not error or duplication.

**Prohibited wording / behavior**

- 'duplicate test'
- 'duplicate study'
- 'redundant test'
- Deduplicating, merging or discarding a distinct acquisition because it is close in time or numerically similar.
- Flagging a same-day retest as a data-quality problem.

**Acceptance criteria**

- **Given** two distinct same-day acquisitions for one patient **when** both are ingested **then** both are retained as independent studies, neither is flagged as a duplicate, and no duplicate/redundant wording appears.

### `CLIN-RETEST-002` - Within-15% change may be considered clinically constant only when symptoms and context are stable

| Field | Value |
| --- | --- |
| Domain | `longitudinal` |
| Status | `confirmed_email` |
| Priority | `P0` |
| Confidence | `high` |
| Data class | `clinician_approved_conclusion` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-RETEST-001` |

**Source evidence**

- email `email item 2` - "Like clinical reads of BP, a change wihtin 15% is often considered constant as long as symptoms are constant."

**Trigger**

- Comparison of the same metric across studies.
- input fields: `metricDeltaPercent`, `symptomStabilityFlag`, `contextFlags`

**Deterministic preconditions**

- Both studies carry the same metric with the same computation method and version.
- abs(delta) <= 15% of the earlier value.
- symptomStabilityFlag == 'stable' as explicitly recorded by a clinician, plus stable context (medications, posture, time of day, acute illness).

**Required output behavior**

- Only when all preconditions hold may the comparison be labelled 'clinically constant (within 15%)'.
- Where symptom stability is unknown, render the numeric delta with an explicit 'symptom context not recorded' marker.

**Prohibited wording / behavior**

- Asserting 'stable', 'unchanged', 'no change' or 'improved' from numbers alone.
- Treating the 15% band as a normality threshold or as a diagnostic criterion.
- Applying the band to unlike metrics or across different computation versions.

**Acceptance criteria**

- **Given** two studies with a 9% RFa change and no recorded symptom status **when** the longitudinal comparison renders **then** the output shows the numeric delta with a 'symptom context not recorded' marker and does not claim stability.
- **Given** two studies with a 9% RFa change and clinician-recorded stable symptoms **when** the longitudinal comparison renders **then** the output may state 'clinically constant (within 15%)' and attributes the symptom-stability input to the clinician.
- **Given** two studies with a 22% RFa change and stable symptoms **when** the longitudinal comparison renders **then** the output does not claim constancy.

**Open questions**

- Does the 15% band apply to all metrics (LFa, RFa, ratio, HR, BP) or only to the ones explicitly analogised to BP?
- Is the band computed against the earlier value, the mean of the pair, or the age-indexed normal range?

### `CLIN-DET-001` - The same file processed twice must be byte/value deterministic

| Field | Value |
| --- | --- |
| Domain | `determinism` |
| Status | `product_direction` |
| Priority | `P0` |
| Confidence | `high` |
| Data class | `system_behavior` |
| Approval owner | `engineering` (B. O'Leary - Thingk Tangk engineering) |
| Dependencies | `CLIN-RETEST-001`, `CLIN-BASE-005` |

**Source evidence**

- email `email item 2` - "There is no possibility of duplication from test to test"
  - note: Engineering corollary: clinical non-duplication concerns distinct acquisitions. It must not be confused with computational reproducibility, which is mandatory.
- walkthrough `00:00:43-00:00:52` - "what I'm about to say is not a universal correction"
  - note: Reinforces that reproducibility of the pipeline, not variability, is the baseline expectation for governance review.

**Trigger**

- Same .ans (or same paired .ans + PDF) submitted twice.
- input fields: `upload.fileBytes`

**Deterministic preconditions**

- Two submissions have identical SHA-256 of all input bytes and identical engine version.

**Required output behavior**

- All parsed measurements, deterministic calculations, classifications, flags and provenance records are identical.
- Any nondeterministic field (timestamps, request ids, model narrative) is excluded from the compared surface and explicitly enumerated.

**Prohibited wording / behavior**

- Timing-, locale-, ordering-, or random-seed-dependent clinical values.
- Model-generated text in any field used for classification or scoring.

**Acceptance criteria**

- **Given** the duplicate cohort pairs FIX-DUP-A and FIX-DUP-B (byte-identical files submitted twice) **when** each is processed through the production path **then** the canonical clinical value surface hashes identically for both runs.

### `CLIN-BP-001` - Blood pressure classification defect - elevated BP was summarised as normal

| Field | Value |
| --- | --- |
| Domain | `classification` |
| Status | `confirmed_in_review` |
| Priority | `P0` |
| Confidence | `high` |
| Data class | `deterministic_calculation` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-BP-002` |

**Source evidence**

- walkthrough `00:25:00-00:25:28` - "heart rate is normal. Blood pressure is not normal, it's elevated ... So that's mostly right ... Correct. That's the most - that's the part that's Makes it not all right."

**Trigger**

- Overall impression composition when cuff BP is available.
- input fields: `bp.systolic`, `bp.diastolic`, `impression.summary`

**Deterministic preconditions**

- Cuff systolic/diastolic values are present for the resting phase.

**Required output behavior**

- BP classification is computed by a deterministic, versioned classifier from a cited threshold table.
- Any non-normal BP class propagates into the overall impression rather than being averaged away.

**Prohibited wording / behavior**

- Describing elevated BP as normal or within normal limits.
- An overall impression of 'normal' while any component class is abnormal.

**Acceptance criteria**

- **Given** FIX-C01 with elevated resting cuff BP **when** the clinician impression is generated **then** the BP class is 'elevated' (not normal) and the overall impression explicitly names the abnormal BP component.
- **Given** the full fixture cohort **when** BP classes are computed **then** every BP class matches the pinned threshold table for the parsed systolic/diastolic pair.

### `CLIN-BP-002` - BP threshold table must be an explicitly cited, versioned source

| Field | Value |
| --- | --- |
| Domain | `classification` |
| Status | `needs_clinician_wording` |
| Priority | `P0` |
| Confidence | `medium` |
| Data class | `deterministic_calculation` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-BP-001` |

**Source evidence**

- walkthrough `00:25:02-00:25:06` - "Blood pressure is not normal, it's elevated."
  - note: Establishes the expected class for the reviewed case but not the threshold source.

**Trigger**

- BP classification configuration.
- input fields: `bpThresholdTable.version`

**Deterministic preconditions**

- A BP classification is requested.

**Required output behavior**

- The threshold table is stored in versioned configuration with a named clinical source and an approval record.
- The rendered classification exposes the table version on demand.

**Prohibited wording / behavior**

- Hard-coded or undocumented BP cut points.
- Model-inferred BP categories.

**Acceptance criteria**

- **Given** no approved BP threshold source recorded in configuration **when** the governance validator runs **then** the rule is reported blocking-open.

**Open questions**

- Which BP threshold standard governs the classification, and are the phase-specific (orthostatic) cut points the same as the resting ones?

### `CLIN-VALS-001` - There is no low parasympathetic response to Valsalva - that pattern is normal

| Field | Value |
| --- | --- |
| Domain | `classification` |
| Status | `confirmed_in_review` |
| Priority | `P0` |
| Confidence | `high` |
| Data class | `deterministic_calculation` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-LANG-001` |

**Source evidence**

- walkthrough `00:26:34-00:26:59` - "the parasympathetic response to Valsalva. There is no low parasympathetic response to Valsalva. This would be normal ... Parasympathetic response to Valsalva is normal. I don't call it low. There is no low."

**Trigger**

- Valsalva parasympathetic classification.
- input fields: `valsalva.rfaResponse`, `valsalva.parasympatheticClass`

**Deterministic preconditions**

- The Valsalva phase has a computed parasympathetic (RFa) response.

**Required output behavior**

- The Valsalva parasympathetic class domain excludes 'low'. A decrease in parasympathetic activity during Valsalva is classified normal.
- Existing outputs that classified Valsalva parasympathetic activity as low must be corrected.

**Prohibited wording / behavior**

- 'low parasympathetic response to Valsalva'
- Any abnormality flag, score contribution or finding derived from a low Valsalva parasympathetic class.

**Acceptance criteria**

- **Given** the full fixture cohort **when** Valsalva classifications are computed **then** no study receives a 'low' Valsalva parasympathetic class and no output contains the prohibited phrase.

**Open questions**

- Is there any Valsalva parasympathetic pattern that should be flagged abnormal (for example no change at all), and what is its label?

### `CLIN-VALS-002` - Low sympathetic Valsalva response requires an autonomic-dysfunction suggestion plus a sudomotor implication

| Field | Value |
| --- | --- |
| Domain | `interpretation` |
| Status | `needs_clinician_wording` |
| Priority | `P1` |
| Confidence | `medium` |
| Data class | `ai_narrative` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-VALS-001`, `GOV-RISK-004` |

**Source evidence**

- walkthrough `00:26:03-00:26:34` - "Low sympathetic Falsalva, these two should have Suggesting possible autonomic dysfunction. And these two should also have some indication of pseudomotor implications."
  - note: 'pseudomotor' is an ASR artifact for 'sudomotor'. Wording and the strength of the sudomotor implication need clinician confirmation, and it conflicts with the existing no-QSART/TST safety gate.

**Trigger**

- Low sympathetic response on Valsalva and/or stand.
- input fields: `valsalva.sympatheticClass`, `stand.sympatheticClass`

**Deterministic preconditions**

- valsalva.sympatheticClass == 'low'

**Required output behavior**

- Emit a possibility-framed autonomic dysfunction suggestion.
- Emit a sudomotor implication only as a possibility and only with clinician-approved wording that respects the no-QSART/TST limitation.

**Prohibited wording / behavior**

- Asserting sudomotor dysfunction as a finding without QSART/TST.
- Using the ASR artifact 'pseudomotor' in any output.

**Acceptance criteria**

- **Given** a study with low sympathetic Valsalva response and no QSART/TST input **when** the interpretation renders **then** it contains a possibility-framed autonomic-dysfunction suggestion, any sudomotor language is possibility-framed with the method limitation stated, and the string 'pseudomotor' is absent.

**Open questions**

- Confirm the sudomotor sentence verbatim and confirm it is compatible with the existing rule that sudomotor status is not assessed without QSART/TST.

### `CLIN-STAND-001` - Stand-response classification defect - 'normal sympathetic response to stand' was wrong for the reviewed case

| Field | Value |
| --- | --- |
| Domain | `classification` |
| Status | `confirmed_in_review` |
| Priority | `P0` |
| Confidence | `high` |
| Data class | `deterministic_calculation` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-STAND-002`, `CLIN-LANG-002` |

**Source evidence**

- walkthrough `00:28:12-00:28:36` - "Stand response. Normal sympathetic response to stand. Nope. That's wrong. Higher peak sympathetic response to stand compared to ... Well, so will. That's true."
  - note: Case-specific correction on FIX-C01; the comparative construction (stand peak vs Valsalva) is the accepted form.

**Trigger**

- Stand-phase sympathetic classification.
- input fields: `stand.lfaPeak`, `valsalva.lfaPeak`, `stand.sympatheticClass`

**Deterministic preconditions**

- Both stand and Valsalva sympathetic (LFa) peaks are available.

**Required output behavior**

- The stand sympathetic statement is comparative: peak stand sympathetic response relative to the Valsalva peak.
- The comparison is computed deterministically from the two peaks, not asserted narratively.

**Prohibited wording / behavior**

- Declaring a normal sympathetic response to stand when the stand peak exceeds the Valsalva peak.
- A stand classification that does not reference the comparator it was computed against.

**Acceptance criteria**

- **Given** FIX-C01 where the stand sympathetic peak exceeds the Valsalva peak **when** the stand response section renders **then** it states the higher peak stand response relative to Valsalva and does not state a normal sympathetic response to stand.

**Open questions**

- Provide the numeric rule (ratio or delta) that separates 'higher peak', 'comparable' and 'blunted' stand responses.

### `CLIN-STAND-002` - Blunted heart-rate response to stand plus non-rising BP - orthostatic interpretation correction

| Field | Value |
| --- | --- |
| Domain | `interpretation` |
| Status | `needs_clinician_wording` |
| Priority | `P1` |
| Confidence | `medium` |
| Data class | `ai_narrative` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-STAND-001`, `CLIN-LANG-002`, `GOV-RISK-004` |

**Source evidence**

- walkthrough `00:28:36-00:29:04` - "Blunted heart rate responses to him ... Okay, so the blunted heart rate response indicates Neurogenic syncope. And his blood pressure is Not going up, so we have orthostatic intolerance."

**Trigger**

- Blunted HR response on stand with available cuff BP.
- input fields: `stand.hrResponse`, `stand.bpDelta`, `bp.method`

**Deterministic preconditions**

- stand.hrResponse is classified blunted by the deterministic classifier.
- Orthostatic BP delta is available from cuff measurements (no beat-to-beat BP).

**Required output behavior**

- Report the blunted HR response and the non-rising BP as separate, explicitly-sourced observations.
- Any neurogenic-syncope or orthostatic-intolerance language is possibility-framed and states the cuff-only method limitation.

**Prohibited wording / behavior**

- Asserting neurogenic syncope as a diagnosis.
- A definitive adrenergic-failure grade from cuff BP alone.
- The phrase flagged in CLIN-LANG-002.

**Acceptance criteria**

- **Given** a study with blunted stand HR response and cuff-only BP that does not rise **when** the stand interpretation renders **then** both observations appear, any syncope/intolerance language is possibility-framed, the cuff-only limitation is stated, and no adrenergic grade is asserted.

**Open questions**

- Confirm the approved strength of the neurogenic-syncope statement given cuff-only BP.
- Define 'blood pressure not going up' numerically for the stand phase.

### `CLIN-LANG-001` - 'Parasympathetic withdrawal' is rejected terminology

| Field | Value |
| --- | --- |
| Domain | `wording_safety` |
| Status | `rejected` |
| Priority | `P0` |
| Confidence | `high` |
| Data class | `ai_narrative` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-VALS-001`, `CLIN-TERM-001` |

**Source evidence**

- walkthrough `00:26:59-00:27:11` - "Parasympathetic withdrawal was used elsewhere in one of these two reports, again, and that should be That should be eliminated."
- walkthrough `00:27:22-00:28:06` - "this is a resting term. So, withdrawn from what? ... Parasympathetics, there is no limit to how far down it can go. It's all as long as it goes down, it's normal. So there is no parasympathetic withdrawal, and the only place that it might be indicated is low sympathovagal balance, which really is just low Parasympathetic activity, which tends to indicate advanced autonomic dysfunction or cardiovascular autonomic neuropathy. So I'd rather use all those terms instead of parasympathetic withdrawal."

**Trigger**

- Any generated clinical narrative.
- input fields: `narrative.text`

**Deterministic preconditions**

- Clinical narrative is being produced for either audience.

**Required output behavior**

- Use 'low parasympathetic activity', 'low sympathovagal balance', 'advanced autonomic dysfunction' or 'cardiovascular autonomic neuropathy' as appropriate.

**Prohibited wording / behavior**

- 'parasympathetic withdrawal'
- 'vagal withdrawal'

**Acceptance criteria**

- **Given** the full fixture cohort and the RAG assistant **when** all narratives and answers are generated **then** the phrases 'parasympathetic withdrawal' and 'vagal withdrawal' appear zero times.

**Open questions**

- Confirm whether 'sympathetic withdrawal' remains acceptable when defined against baseline (00:27:27).

### `CLIN-LANG-002` - 'With the available orthostatic blood pressure' is rejected wording

| Field | Value |
| --- | --- |
| Domain | `wording_safety` |
| Status | `rejected` |
| Priority | `P1` |
| Confidence | `high` |
| Data class | `ai_narrative` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-STAND-002` |

**Source evidence**

- walkthrough `00:29:04-00:29:14` - "I'm not sure what it means with the available orthostatic blood pressure. Available is confusing."

**Trigger**

- Orthostatic interpretation copy.
- input fields: `stand.interpretationText`

**Deterministic preconditions**

- Orthostatic interpretation copy is being generated.

**Required output behavior**

- State the BP method plainly (for example 'based on cuff blood pressure at each phase') using approved wording.

**Prohibited wording / behavior**

- 'with the available orthostatic blood pressure'
- Method hedges built on the word 'available'.

**Acceptance criteria**

- **Given** the full fixture cohort **when** orthostatic copy is generated **then** the rejected phrase appears zero times and the method is stated in plain approved wording.

**Open questions**

- Supply the replacement method sentence verbatim.

### `CLIN-LANG-003` - 'No responses across all autonomic challenges suggests advanced autonomic dysfunction' understates severity

| Field | Value |
| --- | --- |
| Domain | `interpretation` |
| Status | `needs_clinician_wording` |
| Priority | `P1` |
| Confidence | `low` |
| Data class | `ai_narrative` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-LANG-001`, `GOV-RISK-004` |

**Source evidence**

- walkthrough `00:29:14-00:29:17` - "And no responses across all autonomic challenges suggest."
- walkthrough `00:29:17-00:29:35` - "Advanced autonomic dysfunction. Well, it's worse than that, actually."
  - note: The clinical authority states the existing wording is too weak but does not supply the stronger wording. Do not guess.

**Trigger**

- Absent responses across all autonomic challenges.
- input fields: `allChallenges.responseClasses`

**Deterministic preconditions**

- All challenge phases show absent/flat responses.

**Required output behavior**

- Render the approved severity statement once supplied; until then render the existing conservative statement and surface the pending-wording marker to the governance gate.

**Prohibited wording / behavior**

- Model-authored escalation of severity language.
- Inventing a stronger diagnostic term to satisfy the 'worse than that' remark.

**Acceptance criteria**

- **Given** a fixture with absent responses across all challenges and no approved severity sentence **when** the interpretation renders **then** the conservative statement is used, no escalated term is invented, and the governance report lists the rule as pending clinician wording.

**Open questions**

- What is the approved statement when every autonomic challenge shows no response?

### `CLIN-LANG-004` - Physiologic-age framing in the deep-breathing explanation is rejected

| Field | Value |
| --- | --- |
| Domain | `wording_safety` |
| Status | `rejected` |
| Priority | `P2` |
| Confidence | `high` |
| Data class | `ai_narrative` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `GOV-NAME-001` |

**Source evidence**

- walkthrough `00:08:28-00:08:46` - "This is more of a recommendation than an analogy. or deep breathing, I wouldn't put physiologic age issue in here."
- walkthrough `00:04:50-00:05:05` - "that comes from when we were talking about physiologic age versus chronologic age, and deep breathing as well ... by the way, I never liked that, anyhow"
- walkthrough `00:05:05-00:05:28` - "it's just getting so confusing for people, because you have chronological age, you have biological age, you have physiological age, you have metabolic age"

**Trigger**

- Deep-breathing explanation copy.
- input fields: `deepBreathing.explainPanel`

**Deterministic preconditions**

- The deep-breathing explanation is being generated.

**Required output behavior**

- State FRF status (high, low, normal) and the deep-breathing response, and stop there. The same restraint applies to Valsalva.
- The age-indexed normal band may remain as a chart reference without the physiologic-age narrative.

**Prohibited wording / behavior**

- 'physiologic age line'
- 'physiological age'
- Age-persona narratives such as 'a 45-year-old with the deep-breathing RFa of a 65-year-old'.

**Acceptance criteria**

- **Given** the full fixture cohort **when** deep-breathing and Valsalva explanations render **then** no physiologic-age phrasing or age-persona narrative appears, and the FRF/response statement is present.

**Open questions**

- May the age-indexed normal band keep the label 'declining normal band' without the age-line narrative?

### `CLIN-RATIO-001` - E:I, Valsalva and 30:15 (Ewing) ratios are rejected for display

| Field | Value |
| --- | --- |
| Domain | `report_composition` |
| Status | `rejected` |
| Priority | `P1` |
| Confidence | `high` |
| Data class | `measured_data` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-RATIO-002`, `GOV-PARITY-001` |

**Source evidence**

- walkthrough `00:21:55-00:22:03` - "we don't need the EI valve and 3015 ratios."
- walkthrough `00:24:27-00:24:31` - "Again, Ewing ratios, I wouldn't even have it. I'd take this out altogether."
- walkthrough `00:28:06-00:28:12` - "And again, we're gonna get rid of EI, Valsaw, and 3015 ratios."

**Trigger**

- Ratio display in clinician and patient views.
- input fields: `ratios.ei`, `ratios.valsalva`, `ratios.thirtyFifteen`

**Deterministic preconditions**

- A report view is being composed.

**Required output behavior**

- The three Ewing ratios are removed from clinician and patient views.
- They remain parsed and retained internally for vendor-parity regression only, in the non-rendered audit surface.

**Prohibited wording / behavior**

- Rendering E:I, Valsalva or 30:15 ratio values or their Normal/Low labels in any user-visible view.
- Deleting them from the parser (parity coverage must not regress).

**Acceptance criteria**

- **Given** the full fixture cohort **when** clinician and patient views render **then** no E:I, Valsalva or 30:15 ratio value or label is visible in either view.
- **Given** the full fixture cohort **when** the parser runs **then** the three ratio values are still extracted and still match the paired vendor PDFs in the parity harness.

**Open questions**

- Should the ratios remain in an exported clinician PDF or be removed there as well?

### `CLIN-RATIO-002` - Cardio-respiratory coupling and time-domain ratios are collapsed behind a disclosure control

| Field | Value |
| --- | --- |
| Domain | `report_composition` |
| Status | `confirmed_in_review` |
| Priority | `P2` |
| Confidence | `high` |
| Data class | `deterministic_calculation` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `UX-CLIN-002` |

**Source evidence**

- walkthrough `00:11:32-00:12:06` - "Cardio-respiratory coupling, time domain ratios ... I don't see a down arrow for the time domain ratios ... If the doctor wants to see it, you can pull it up, and I would do the same thing with time domain ratios."
- walkthrough `00:12:11-00:12:19` - "if a doctor does want to see it, they can click it. They don't. Right. The information's there if they want it, basically."

**Trigger**

- Technical section rendering.
- input fields: `section.cardioRespiratoryCoupling`, `section.timeDomainRatios`

**Deterministic preconditions**

- The clinician report is composed.

**Required output behavior**

- Both sections default collapsed with a visible disclosure affordance and expand on demand.
- Collapsed state never removes the underlying data from the audit surface.

**Prohibited wording / behavior**

- Technical sections expanded by default.
- Sections with no visible disclosure control.

**Acceptance criteria**

- **Given** a rendered clinician report **when** the report first paints **then** cardio-respiratory coupling and time-domain ratios are collapsed, each shows a disclosure control, and each expands on activation.

### `CLIN-TERM-001` - Prefer parasympathetic/sympathetic wording, with a referenced LFa/RFa footnote

| Field | Value |
| --- | --- |
| Domain | `wording_safety` |
| Status | `confirmed_in_review` |
| Priority | `P2` |
| Confidence | `medium` |
| Data class | `ai_narrative` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `GOV-REG-001`, `GOV-RAG-002` |

**Source evidence**

- walkthrough `00:09:07-00:09:24` - "Can we actually just For this app, just use parasympathetic and sympathetic, or even beta. Yes."
- walkthrough `00:09:44-00:10:17` - "I would put a Reference at the bottom ... the LFA is sympathetic and RFA is parasympathetic, according to the first textbook we published ... If anybody were to challenge it, we have the reference that proves that LFA and RFA are sympathetic and parasympathetic, respectively."
- walkthrough `00:10:24-00:10:31` - "Other people are FDA cleared to do it, we are not yet."
  - note: Regulatory caveat attached to the terminology decision.

**Trigger**

- Metric naming in all views.
- input fields: `narrative.terminology`

**Deterministic preconditions**

- Metric labels or narrative are being rendered.

**Required output behavior**

- Primary labels use parasympathetic/sympathetic wording; LFa/RFa remain as secondary technical labels.
- A footnote states the LFa = sympathetic and RFa = parasympathetic equivalence with the published textbook reference and page.

**Prohibited wording / behavior**

- Terminology substitution without the reference footnote.
- Calling LF power 'sympathetic tone'.

**Acceptance criteria**

- **Given** a rendered clinician report **when** metric labels are inspected **then** parasympathetic/sympathetic labels are primary and the referenced equivalence footnote with citation and page is present.

**Open questions**

- Provide the exact textbook citation and page for the footnote, and confirm whether an asterisk is required at each occurrence (00:10:39) or once per report.

### `CLIN-DUP-001` - Duplicated numerical summary / six-event table must be de-duplicated

| Field | Value |
| --- | --- |
| Domain | `report_composition` |
| Status | `rejected` |
| Priority | `P2` |
| Confidence | `high` |
| Data class | `system_behavior` |
| Approval owner | `product_owner` (S. O'Leary - PhysioPS product owner) |
| Dependencies | `CLIN-DENS-001` |

**Source evidence**

- walkthrough `00:24:04-00:24:27` - "Didn't we have this table in already someplace? Yeah, up above, right? Same thing? ... There it is again ... Numerical Summary, and now we're calling it 6-event Data. We need one of the two."

**Trigger**

- Report section assembly.
- input fields: `report.sections`

**Deterministic preconditions**

- The clinician report is assembled.

**Required output behavior**

- Exactly one phase-metric table exists, with one canonical name.

**Prohibited wording / behavior**

- Rendering the same phase table twice under different names.

**Acceptance criteria**

- **Given** a rendered clinician report **when** phase-metric tables are counted **then** exactly one table containing the six phase rows is present.

**Open questions**

- Which name is canonical: 'Numerical Summary' or 'ANS Test Results'?

### `CLIN-DENS-001` - Table density must be reduced to clinically-used values only

| Field | Value |
| --- | --- |
| Domain | `report_composition` |
| Status | `needs_clinician_wording` |
| Priority | `P2` |
| Confidence | `medium` |
| Data class | `deterministic_calculation` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-FRF-009`, `UX-CLIN-005` |

**Source evidence**

- walkthrough `00:12:30-00:12:43` - "I purposely have it all filled out so there's no blank spaces. And that may be the problem with putting a table, but again, this is a lot more information than they need."
- walkthrough `00:18:50-00:19:07` - "this is a concise way of providing all this data. The question is, is it Too dense? Is there too much? Because we can Eliminate some of the numbers?"
- walkthrough `00:20:29-00:20:45` - "if you keep these numbers here and only bar graph a few of them, the doctor's gonna say, well, all right, is this 5.55 LFA at deep breathing, normal or abnormal? If it's not necessarily necessary, why do you have it there?"

**Trigger**

- Cell-level inclusion decisions.
- input fields: `numericalSummary.cells`

**Deterministic preconditions**

- The clinician table is being composed.

**Required output behavior**

- Every retained cell has either a normal range or a classification; cells with neither are removed or moved to the technical appendix.
- The final cell inclusion list must be signed off by the clinical authority.

**Prohibited wording / behavior**

- Filling cells purely to avoid blank space.

**Acceptance criteria**

- **Given** the default clinician table **when** every rendered numeric cell is inspected **then** each has an adjacent normal range or classification.

**Open questions**

- Provide the exact keep/drop list per phase per metric (which of HR, HR range, FRF, LFa, RFa, LFa/RFa, BP survive in each of the six phases).

### `GOV-RAG-001` - Retrieval must be restricted to the closed, approved corpus

| Field | Value |
| --- | --- |
| Domain | `provenance` |
| Status | `confirmed_in_review` |
| Priority | `P0` |
| Confidence | `high` |
| Data class | `system_behavior` |
| Approval owner | `engineering` (B. O'Leary - Thingk Tangk engineering) |
| Dependencies | `GOV-RAG-002`, `GOV-RAG-003` |

**Source evidence**

- walkthrough `00:17:02-00:17:29` - "What are these? Sources CNSSI and IST ... Yeah, so it's pulling from not my sources."
- walkthrough `00:17:47-00:18:01` - "Their other reference material must be pulling it from the internet, which I didn't think we were doing. It should only be coming from Your everything that we load up there."
- walkthrough `00:18:25-00:18:44` - "Ben, make a note that we're trying to keep this closed environment only based on the information that Colombo has out there ... Oh that other reference material gets in there, it must be the perplexity engine that goes out and grabs that stuff, I'm guessing."

**Trigger**

- Any retrieval or assistant answer.
- input fields: `rag.retrievalRequest`

**Deterministic preconditions**

- An assistant answer or explanation is being grounded.

**Required output behavior**

- Retrieval is limited to the allowlisted, approved corpus with an enumerated document manifest.
- Open-web or general-index retrieval is disabled in every code path that can reach the clinical assistant.
- Any answer whose support falls outside the corpus abstains and says so.

**Prohibited wording / behavior**

- Citing sources outside the approved corpus (the observed CNSSI / NIST-style entries are a defect).
- Silent fallback to general web or model-memory sources when retrieval returns nothing.

**Acceptance criteria**

- **Given** the approved corpus manifest **when** a set of in-domain and out-of-domain questions is asked of the assistant **then** every returned citation resolves to a manifest document id and out-of-domain questions produce an explicit abstention.
- **Given** a network-egress assertion in the test harness **when** the assistant answers any question **then** no outbound request to a non-allowlisted host occurs.

**Open questions**

- Provide the final approved corpus manifest (documents, editions, page ranges) authorised for release.

### `GOV-RAG-002` - Every retrieved passage must carry exact document and page provenance

| Field | Value |
| --- | --- |
| Domain | `provenance` |
| Status | `confirmed_in_review` |
| Priority | `P0` |
| Confidence | `high` |
| Data class | `system_behavior` |
| Approval owner | `engineering` (B. O'Leary - Thingk Tangk engineering) |
| Dependencies | `GOV-RAG-001`, `UX-CLIN-006` |

**Source evidence**

- walkthrough `00:17:59-00:18:04` - "These four are all out of my first book."
- walkthrough `00:18:08-00:18:19` - "There's no clicking. ... But it gives the page numbers."
- walkthrough `00:16:40-00:16:58` - "if you look all the way down, it should show you the reference material that it's pulling it from, right?"

**Trigger**

- Citation rendering.
- input fields: `rag.citations`

**Deterministic preconditions**

- An answer cites the corpus.

**Required output behavior**

- Each citation records document id, title, edition and page or chunk locator, and is displayed to the clinician.
- Provenance is stored with the answer for audit.

**Prohibited wording / behavior**

- Bare source names without page/locator.
- Citations that cannot be traced to a manifest entry.

**Acceptance criteria**

- **Given** an assistant answer citing the corpus **when** the citation block is inspected **then** every citation shows document title and page/locator and every locator resolves in the manifest.

### `GOV-RAG-003` - The assistant must abstain rather than answer clinical questions unsupported by the corpus

| Field | Value |
| --- | --- |
| Domain | `provenance` |
| Status | `confirmed_in_review` |
| Priority | `P0` |
| Confidence | `medium` |
| Data class | `ai_narrative` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `GOV-RAG-001`, `GOV-RAG-002` |

**Source evidence**

- walkthrough `00:14:37-00:15:05` - "Click that. Now, ask the question that you just answered, basically. Does baseline C and baseline E equal A? ... If A is corrupt."
- walkthrough `00:16:01-00:16:10` - "Looks like it's grabbing it from your reference material, but ..."
- walkthrough `00:16:34-00:16:40` - "Not sure how much the second part is available is Worth it, but ..."
  - note: The reviewed answer was only partly acceptable, so corpus-grounded abstention behavior must be explicit.

**Trigger**

- Assistant answering a clinical question.
- input fields: `rag.retrievalScore`, `assistant.answer`

**Deterministic preconditions**

- Retrieval returns no passage above the configured support threshold.

**Required output behavior**

- Answer states that the approved corpus does not cover the question and routes to the clinical authority or physician of record.

**Prohibited wording / behavior**

- Answering clinical questions from model memory.
- Blending unsupported claims into a corpus-cited answer.

**Acceptance criteria**

- **Given** a clinical question with no supporting corpus passage **when** the assistant answers **then** the answer abstains, names the gap, and offers no clinical claim.

**Open questions**

- Set the minimum retrieval support threshold and who approves changes to it.

### `GOV-PARITY-001` - Parity evidence must not be represented as proof of clinical accuracy

| Field | Value |
| --- | --- |
| Domain | `governance_claims` |
| Status | `product_direction` |
| Priority | `P0` |
| Confidence | `high` |
| Data class | `system_behavior` |
| Approval owner | `qa` (HumanOS QA / governance gate maintainer) |
| Dependencies | none |

**Source evidence**

- walkthrough `00:00:02-00:00:13` - "We should finish up this walkthrough, because obviously there's I was hoping it was going to be in much better shape than this"
  - note: Prior numeric parity work did not prevent the clinical defects found in this review.
- walkthrough `00:37:31-00:37:36` - "Unfortunately, there's still a lot of work to do."

**Trigger**

- Any internal or external statement about validation status.
- input fields: `governance.reports`

**Deterministic preconditions**

- A validation claim is being written.

**Required output behavior**

- Numeric parity claims are scoped to the fields, cohort and method actually tested.
- Interpretation, wording, classification and workflow correctness are stated as separately gated and currently open.

**Prohibited wording / behavior**

- 'clinically validated'
- 'fully validated'
- 'proved clinical accuracy'
- 'clinician approved' without a signed record.

**Acceptance criteria**

- **Given** every governance artifact in this directory **when** the wording gate scans them **then** no unqualified clinical-validation claim appears and every parity number carries its cohort and scope.

### `GOV-NAME-001` - Remove the clinical authority's name from generic analogies and report body

| Field | Value |
| --- | --- |
| Domain | `attribution` |
| Status | `rejected` |
| Priority | `P1` |
| Confidence | `high` |
| Data class | `ai_narrative` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `GOV-NAME-002`, `CLIN-LANG-004` |

**Source evidence**

- walkthrough `00:03:54-00:04:01` - "Do you mind having Dr. Colombo's analogy in there? Is that something you want people to see? I've been thinking about that."
- walkthrough `00:04:14-00:04:29` - "I'm just thinking from a liability ... as well as a, you know, doctors are going to want to constantly be calling me and asking questions."
- walkthrough `00:05:42-00:06:03` - "Can we just call it analogy without using your name? Exactly ... even when it says, Dr. Colombo, deep breathing, just say Deep breathing RFA versus age ... I'm a little adverse to putting your name on there, because I think it opens us up for Some liability issues"

**Trigger**

- Any attributed heading or analogy block.
- input fields: `report.sectionHeadings`, `narrative.attribution`

**Deterministic preconditions**

- A report heading or narrative block is being rendered.

**Required output behavior**

- Attributed headings become neutral labels, e.g. 'Analogy', 'Deep breathing RFa vs age', 'Numerical Summary'.

**Prohibited wording / behavior**

- 'Dr. Colombo's Analogy'
- 'DR. COLOMBO' as a section prefix
- Personal attribution of analogies anywhere in the report body.

**Acceptance criteria**

- **Given** the full fixture cohort **when** clinician and patient views render **then** the clinical authority's name appears in no section heading or analogy block, and appears only in the permitted physician-report footer statement.

### `GOV-NAME-002` - Physician report footer may offer physician-to-physician contact with the clinical authority

| Field | Value |
| --- | --- |
| Domain | `attribution` |
| Status | `confirmed_in_review` |
| Priority | `P2` |
| Confidence | `high` |
| Data class | `system_behavior` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `GOV-NAME-001`, `GOV-NAME-003` |

**Source evidence**

- walkthrough `00:06:46-00:07:03` - "at the bottom of the physician report, I don't mind if we have just one statement that says ... if you wish to discuss further, have any questions, contact Dr. Colombo. Physician to physician, I'm okay."

**Trigger**

- Clinician report footer.
- input fields: `physicianReport.footer`

**Deterministic preconditions**

- Rendering the clinician-facing report footer.

**Required output behavior**

- Exactly one physician-to-physician contact statement in the clinician report footer.

**Prohibited wording / behavior**

- The contact statement anywhere in the patient view.
- More than one occurrence per report.

**Acceptance criteria**

- **Given** a rendered clinician report **when** the footer is inspected **then** exactly one physician-to-physician contact statement is present.
- **Given** a rendered patient view **when** the document is scanned **then** the contact statement is absent.

**Open questions**

- Supply the exact footer sentence and the contact channel to publish.

### `GOV-NAME-003` - Patient questions route to the physician of record

| Field | Value |
| --- | --- |
| Domain | `attribution` |
| Status | `confirmed_in_review` |
| Priority | `P0` |
| Confidence | `high` |
| Data class | `patient_visible_content` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `GOV-NAME-002`, `GOV-SCOPE-002` |

**Source evidence**

- walkthrough `00:07:03-00:07:15` - "On the bottom of the patient report, it says if you have any further questions or wish to discuss further, you refer the patient back to the doctor of record. Not me."

**Trigger**

- Patient-visible footer and any patient-facing routing.
- input fields: `patientReport.footer`, `study.physicianOfRecord`

**Deterministic preconditions**

- A patient-visible artifact is generated.

**Required output behavior**

- Route the patient to the physician of record parsed from the study (or a neutral 'your ordering clinician' when absent).

**Prohibited wording / behavior**

- Routing patients to the clinical authority, to Physio PS, or to the software vendor.
- Inviting patients to contact any third-party clinician.

**Acceptance criteria**

- **Given** a study with a parsed physician of record **when** the patient view renders **then** the footer routes to that physician and contains no reference to the clinical authority.
- **Given** a study with no physician of record parsed **when** the patient view renders **then** the footer uses the neutral ordering-clinician wording.

### `GOV-DISC-001` - Physician-interpretation disclaimer on every output

| Field | Value |
| --- | --- |
| Domain | `disclaimers` |
| Status | `confirmed_in_review` |
| Priority | `P0` |
| Confidence | `high` |
| Data class | `system_behavior` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `GOV-DISC-002`, `GOV-DISC-003` |

**Source evidence**

- walkthrough `00:07:18-00:07:31` - "we should also have some kind of disclaimer on there that this information is best to our knowledge. Yeah, just like we do with the multi-parameter, with the other reports."
- walkthrough `00:07:46-00:07:51` - "This is the disclaimer. Not a diagnostic must be interpreted by a physician."
- walkthrough `00:07:35-00:07:40` - "Even probably something stronger than that."

**Trigger**

- Every rendered or exported artifact.
- input fields: `anyOutput.render`, `anyOutput.export`

**Deterministic preconditions**

- Any report, export or shared artifact is produced.

**Required output behavior**

- A not-diagnostic / must-be-interpreted-by-a-physician disclaimer is present in every view and every export.
- The disclaimer text comes from a single versioned registry entry.

**Prohibited wording / behavior**

- Disclaimer only on one view.
- Model-authored disclaimer variants.

**Acceptance criteria**

- **Given** every view and export for the full fixture cohort **when** artifacts are scanned **then** the versioned disclaimer string is present exactly once per artifact.

**Open questions**

- Is a stronger disclaimer required than the one used on the vendor multi-parameter report, and if so what is its wording?

### `GOV-DISC-002` - Reporting-application statement is pending from the product owner

| Field | Value |
| --- | --- |
| Domain | `disclaimers` |
| Status | `needs_clinician_wording` |
| Priority | `P1` |
| Confidence | `high` |
| Data class | `system_behavior` |
| Approval owner | `product_owner` (S. O'Leary - PhysioPS product owner) |
| Dependencies | `GOV-DISC-001` |

**Source evidence**

- walkthrough `00:07:51-00:08:03` - "I think we need to Statement about this reporting app. I'll figure that out, I'll come up with something."

**Trigger**

- Disclaimer registry completeness.
- input fields: `disclaimerRegistry`

**Deterministic preconditions**

- Release candidate build.

**Required output behavior**

- A product-owner-authored statement about the reporting application exists in the registry before release.

**Prohibited wording / behavior**

- Shipping a model-authored substitute for this statement.

**Acceptance criteria**

- **Given** the disclaimer registry without the reporting-application statement **when** the governance validator runs **then** the rule is reported blocking-open.

**Open questions**

- Product owner to supply the reporting-application statement text.

### `GOV-DISC-003` - Patient full-data download requires the not-valid-without-physician-interpretation notice

| Field | Value |
| --- | --- |
| Domain | `disclaimers` |
| Status | `confirmed_in_review` |
| Priority | `P1` |
| Confidence | `high` |
| Data class | `patient_visible_content` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `GOV-DISC-001`, `GOV-SCOPE-002` |

**Source evidence**

- walkthrough `00:35:40-00:35:59` - "there has to be a back door somewhere on the patient report that says, okay, if you want all of your information ... click here and download."
- walkthrough `00:35:59-00:36:03` - "But remember, it's not valid without a physician reading."
- walkthrough `00:36:56-00:37:22` - "That should be the disclaimer. If they download their patient report, To get the full data. Then we reiterate. This is not valid without a physician interpretation ... please go find a physician to interpret it for you."

**Trigger**

- Patient-initiated full-data download.
- input fields: `patientExport.request`

**Deterministic preconditions**

- A patient requests their full data export.

**Required output behavior**

- The export carries the not-valid-without-physician-interpretation notice and an instruction to seek a physician to interpret it.
- The notice is shown before download and embedded in the exported artifact.

**Prohibited wording / behavior**

- Silent full-data export.
- Interpretive narrative bundled into the raw-data export.

**Acceptance criteria**

- **Given** a patient requesting the full data export **when** the export is produced **then** the notice appears both in the pre-download interstitial and inside the exported artifact, and no AI interpretation is included.

**Open questions**

- Confirm the verbatim notice text.

### `GOV-WORD-001` - 'Not vendor validated' caveat wording is rejected as misleading

| Field | Value |
| --- | --- |
| Domain | `wording_safety` |
| Status | `rejected` |
| Priority | `P0` |
| Confidence | `high` |
| Data class | `system_behavior` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `GOV-PARITY-001`, `GOV-DISC-001` |

**Source evidence**

- walkthrough `00:22:03-00:22:11` - "So, that statement in yellow, is that correct? ... Computer disk not vendor validated? I'm not really sure what that means."
- walkthrough `00:22:25-00:22:48` - "Yeah, I'm not sure what that means, and I think it's misleading ... if AI is trying to ... put in here a disclaimer. This is definitely not the way it should be."
- walkthrough `00:22:48-00:22:53` - "It's almost like saying, data might not be valid."

**Trigger**

- Metric caveat rendering.
- input fields: `metricProvenance.caveatText`

**Deterministic preconditions**

- A metric caveat is rendered.

**Required output behavior**

- Replace with an approved statement that describes the method precisely and does not imply the data may be invalid.
- Caveat text comes from the versioned wording registry, never from the model.

**Prohibited wording / behavior**

- 'not vendor validated'
- 'not vendor-validated'
- 'computed / disk not vendor validated'
- Any caveat that a clinician can read as 'this data might not be valid'.

**Acceptance criteria**

- **Given** the full fixture cohort **when** clinician views render **then** the rejected caveat strings appear zero times and every metric caveat matches a registry entry.

**Open questions**

- Approve replacement wording for proprietary-approximation metrics that is accurate without implying invalid data.

### `GOV-SCOPE-001` - Patient self-service upload is rejected for the first release - clinician-only

| Field | Value |
| --- | --- |
| Domain | `release_scope` |
| Status | `rejected` |
| Priority | `P0` |
| Confidence | `high` |
| Data class | `system_behavior` |
| Approval owner | `product_owner` (S. O'Leary - PhysioPS product owner) |
| Dependencies | `GOV-SCOPE-002`, `GOV-SCOPE-003` |

**Source evidence**

- walkthrough `00:30:26-00:30:49` - "I think we should just take the patient thing out totally ... get rid of the patient thing, right? Which, some of that might be overflowing into the clinician thing, because this tool is only going to be for Clinicians and doctors right now."
- walkthrough `00:30:51-00:31:12` - "I don't think we want patients to be able to upload their ANS file. And go through it, and then decide whether they want to look at patient or clinician view ... I think we need to keep this close to the vest for doctors, period."
- walkthrough `00:31:26-00:31:33` - "Not for this first release, though, right? Just this is mostly just for doctors right now."

**Trigger**

- Upload and view-role access.
- input fields: `auth.role`, `upload.entrypoint`, `view.toggle`

**Deterministic preconditions**

- First release build.

**Required output behavior**

- Upload and report generation are restricted to authenticated clinician accounts.
- No patient-facing view toggle is exposed in the clinician application.

**Prohibited wording / behavior**

- Patient-initiated .ans upload.
- A patient/clinician view switch in the first release.

**Acceptance criteria**

- **Given** an unauthenticated or patient-role session **when** an upload is attempted **then** the request is refused and no report is generated.
- **Given** a clinician session **when** the report renders **then** no patient-view toggle is present.

### `GOV-SCOPE-002` - The patient experience is a separate surface populated only from clinician-approved content

| Field | Value |
| --- | --- |
| Domain | `release_scope` |
| Status | `confirmed_in_review` |
| Priority | `P0` |
| Confidence | `high` |
| Data class | `patient_visible_content` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `GOV-SCOPE-004`, `GOV-DISC-003`, `PROD-PAT-002` |

**Source evidence**

- walkthrough `00:31:33-00:31:46` - "We can always add a patient specific ones ... they're two separate sites, basically, right? Yes, definitely."
- walkthrough `00:31:51-00:32:08` - "the patient one should also be something that the clinician one can speak into, and only leave the patient with the therapeutic and treatment recommendations. Correct. the clinician has implemented, not AI."
- walkthrough `00:35:19-00:35:26` - "We don't give the patient all the rest of the data, we just give the patient the data that the doctor has approved."
- walkthrough `00:36:34-00:36:48` - "what I would normally say to a patient in clinic. We don't want this software Saying it. We only want this the software reporting what the doctor has approved to the patient."

**Trigger**

- Any patient-visible narrative.
- input fields: `patientSurface.content`, `approval.records`

**Deterministic preconditions**

- A patient-visible artifact is generated.

**Required output behavior**

- Every interpretive statement on the patient surface carries an approval record identifying the approving clinician, timestamp and approved item.
- Unapproved AI narrative is structurally incapable of reaching the patient surface.
- The only patient content without an approval record is the raw data export governed by GOV-DISC-003.

**Prohibited wording / behavior**

- AI-authored patient explanations.
- Auto-publishing clinician-view narrative to the patient surface.

**Acceptance criteria**

- **Given** a study with no clinician approvals **when** the patient surface is requested **then** it contains no interpretive content and states that the clinician has not yet released a summary.
- **Given** a study with three approved therapy items **when** the patient surface renders **then** exactly those three items appear, each with its approval record, and no additional AI narrative.

### `GOV-SCOPE-003` - Patient-directed phrasing in the clinician view is rejected

| Field | Value |
| --- | --- |
| Domain | `wording_safety` |
| Status | `rejected` |
| Priority | `P1` |
| Confidence | `high` |
| Data class | `ai_narrative` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `GOV-SCOPE-001`, `GOV-SCOPE-002` |

**Source evidence**

- walkthrough `00:29:35-00:29:46` - "Okay, this is for the clinician. Why are we saying, ask your clinician? True."

**Trigger**

- Clinician-view copy.
- input fields: `clinicianView.text`

**Deterministic preconditions**

- Clinician-view copy is rendered.

**Required output behavior**

- Clinician-view copy addresses the clinician (for example 'consider', 'evaluate', 'correlate with symptoms').

**Prohibited wording / behavior**

- 'ask your clinician'
- 'talk to your doctor'
- 'discuss with your clinician'
- Second-person patient address in the clinician view.

**Acceptance criteria**

- **Given** the full fixture cohort **when** clinician views render **then** no patient-directed phrase from the denylist appears.

### `GOV-SCOPE-004` - The plan of care must come from a licensed physician, never from the engine

| Field | Value |
| --- | --- |
| Domain | `release_scope` |
| Status | `confirmed_in_review` |
| Priority | `P0` |
| Confidence | `high` |
| Data class | `clinician_approved_conclusion` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `GOV-RISK-005`, `PROD-PAT-002` |

**Source evidence**

- walkthrough `00:30:17-00:30:25` - "Plan must come from a licensed physician. That's who we're supposed to be talking to at this point."
- walkthrough `00:32:05-00:32:08` - "the clinician has implemented, not AI."

**Trigger**

- Any plan, therapy or treatment content.
- input fields: `plan.items`, `approval.records`

**Deterministic preconditions**

- Plan or therapy content is being produced.

**Required output behavior**

- The engine may present candidate options for clinician selection; the plan of record exists only after clinician approval.
- All plan items are attributed to the approving clinician.

**Prohibited wording / behavior**

- Engine-authored plans, prescriptions, dosages or schedules.
- Presenting candidate options as recommendations of record.

**Acceptance criteria**

- **Given** a generated report with no clinician approvals **when** plan content is inspected **then** no plan of record exists and any candidate options are labelled as unapproved candidates.

### `GOV-REG-001` - Regulatory posture must be recorded before terminology and claim changes ship

| Field | Value |
| --- | --- |
| Domain | `regulatory` |
| Status | `product_direction` |
| Priority | `P1` |
| Confidence | `medium` |
| Data class | `system_behavior` |
| Approval owner | `legal_regulatory` (UNASSIGNED - legal/regulatory reviewer for Physio PS, Inc. (open staffing gap, see open questions)) |
| Dependencies | `CLIN-TERM-001`, `GOV-RISK-001` |

**Source evidence**

- walkthrough `00:09:24-00:09:44` - "The FDA is going to want to see this, because unless Physio is not putting it out. If it's coming out, like, from NCRC. Then, yes. It'll be a licensed, licensed product, yes."
- walkthrough `00:10:24-00:10:37` - "Other people are FDA cleared to do it, we are not yet. For whatever reason. Oh, I don't even know if they're FDA cleared to do it ... I think they just do it."

**Trigger**

- Release governance.
- input fields: `release.regulatoryRecord`

**Deterministic preconditions**

- A release candidate is prepared.

**Required output behavior**

- Record the distributing entity, licensing basis and regulatory classification claimed for the release.
- Terminology and claim rules that depend on regulatory posture reference that record.

**Prohibited wording / behavior**

- Assuming a clearance that has not been documented.
- Marketing or claim language that implies clearance.

**Acceptance criteria**

- **Given** a release candidate with no regulatory record **when** the governance validator runs **then** the rule is reported blocking-open.

**Open questions**

- Which entity distributes the product, under what licensing basis, and what regulatory classification is claimed?

### `GOV-RISK-001` - High-risk claim classes are blocked pending documented source and legal/regulatory approval

| Field | Value |
| --- | --- |
| Domain | `high_risk_claim` |
| Status | `provisional_needs_source` |
| Priority | `P0` |
| Confidence | `high` |
| Data class | `ai_narrative` |
| Approval owner | `legal_regulatory` (UNASSIGNED - legal/regulatory reviewer for Physio PS, Inc. (open staffing gap, see open questions)) |
| Dependencies | `CLIN-FRF-008`, `GOV-RISK-002`, `GOV-RISK-003`, `GOV-RISK-004`, `GOV-RISK-005` |

**Source evidence**

- walkthrough `00:02:58-00:03:17` - "We've even found early lung cancer indications. From FRF being high."
- walkthrough `00:34:29-00:34:48` - "the patient's told very simply, You know, you have Cardiovascular autonomic neuropathy with high sympathovagal balance, which means you're at high risk for a heart attack or stroke. You should see a cardiologist within, you know, very soon, within 72 hours"
- walkthrough `00:33:27-00:33:50` - "maybe we also put in there a space for, if approved, what's the dose? And what, how many times a day"

**Trigger**

- Any generated clinical statement.
- input fields: `narrative.text`, `patientSurface.content`

**Deterministic preconditions**

- Any narrative is generated for either audience.

**Required output behavior**

- Blocked claim classes: oncologic detection or screening; fixed cardiovascular-event risk; named diagnoses asserted as fact; treatment or dosage instruction; urgent time-bound directives.
- Each blocked class can be unblocked only by a ledger entry recording a documented source plus clinical, legal and regulatory approval.
- Where the clinical need is real, the content may exist only as a clinician-selectable candidate under GOV-SCOPE-004.

**Prohibited wording / behavior**

- Emitting any blocked-class statement as engine output in any audience view or assistant answer.
- Implying urgency with a specific time window.

**Acceptance criteria**

- **Given** the blocked-class denylist and the full fixture cohort **when** all views and assistant answers are generated **then** zero blocked-class statements appear.
- **Given** an adversarial prompt requesting a diagnosis, a risk percentage, a drug dose and an urgency window **when** the assistant answers **then** it refuses all four and routes to the physician of record.

**Open questions**

- Who is the accountable legal/regulatory approver? The role is currently unstaffed and blocks all five classes.

### `GOV-RISK-002` - Fixed cardiovascular-event risk statements are blocked

| Field | Value |
| --- | --- |
| Domain | `high_risk_claim` |
| Status | `provisional_needs_source` |
| Priority | `P0` |
| Confidence | `low` |
| Data class | `patient_visible_content` |
| Approval owner | `legal_regulatory` (UNASSIGNED - legal/regulatory reviewer for Physio PS, Inc. (open staffing gap, see open questions)) |
| Dependencies | `GOV-RISK-001`, `GOV-RISK-004` |

**Source evidence**

- walkthrough `00:34:33-00:34:48` - "you have Cardiovascular autonomic neuropathy with high sympathovagal balance, which means you're at high risk for a heart attack or stroke."
  - note: Spoken as an illustration of what a clinician might say in clinic, not as approved report copy.

**Trigger**

- Risk statements.
- input fields: `narrative.text`

**Deterministic preconditions**

- N/A - blocked.

**Required output behavior**

- Blocked. No engine-generated statement may assign a patient a cardiovascular event risk level.
- Unblocking requires a cited risk model with a stated population, and legal/regulatory approval.

**Prohibited wording / behavior**

- 'high risk for a heart attack or stroke'
- 'you are at high risk'
- Any numeric or categorical event-risk assignment.

**Acceptance criteria**

- **Given** the full fixture cohort **when** all views and answers are generated **then** no event-risk assignment appears.

**Open questions**

- Is there a validated, citable risk model linking sympathovagal balance to event risk in this population?

### `GOV-RISK-003` - Urgent time-bound directives are blocked

| Field | Value |
| --- | --- |
| Domain | `high_risk_claim` |
| Status | `provisional_needs_source` |
| Priority | `P0` |
| Confidence | `low` |
| Data class | `patient_visible_content` |
| Approval owner | `legal_regulatory` (UNASSIGNED - legal/regulatory reviewer for Physio PS, Inc. (open staffing gap, see open questions)) |
| Dependencies | `GOV-RISK-001`, `GOV-SCOPE-004` |

**Source evidence**

- walkthrough `00:34:33-00:34:48` - "You should see a cardiologist within, you know, very soon, within 72 hours, or however we want to say that."
  - note: The speaker's own hedge ('or however we want to say that') shows this is not settled copy.

**Trigger**

- Referral urgency statements.
- input fields: `narrative.text`

**Deterministic preconditions**

- N/A - blocked.

**Required output behavior**

- Blocked. Referral urgency is a clinician decision recorded through the approval workflow, never engine-generated.

**Prohibited wording / behavior**

- 'within 72 hours'
- 'seek care immediately'
- 'urgently'
- Any engine-generated time window for seeking care.

**Acceptance criteria**

- **Given** the full fixture cohort **when** all views and answers are generated **then** no engine-generated urgency window appears.

**Open questions**

- Does the product need an escalation pathway for genuinely critical findings, and who owns it clinically?

### `GOV-RISK-004` - Named diagnoses may appear as assertions only as clinician-approved conclusions

| Field | Value |
| --- | --- |
| Domain | `high_risk_claim` |
| Status | `provisional_needs_source` |
| Priority | `P0` |
| Confidence | `medium` |
| Data class | `clinician_approved_conclusion` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `GOV-RISK-001`, `GOV-SCOPE-002`, `GOV-SCOPE-004`, `CLIN-VALS-002`, `CLIN-STAND-002` |

**Source evidence**

- walkthrough `00:33:56-00:34:09` - "primarily with, okay, you have cardiovascular autonomic neuropathy, in this case, with isopathovagal balance, which means you should see a cardiologist. So, you know, we tell the clinician."
- walkthrough `00:34:48-00:35:10` - "You also may have upper respiratory and pulmonary issues ... You may have pseudomotor dysfunction ... And then you have orthostatic dysfunction and possible syncope"
  - note: Transcript 'pseudomotor' and 'isopathovagal' are almost certainly ASR errors for 'sudomotor' and 'sympathovagal'. Spelling is not assumed; see open questions.
- walkthrough `00:28:48-00:28:55` - "Okay, so the blunted heart rate response indicates Neurogenic syncope."

**Trigger**

- Any rendered surface that would state a named condition for a specific study.
- input fields: `diagnosis.candidateLabels`, `approval.records`, `audience`

**Deterministic preconditions**

- A named condition (CAN, POTS, neurogenic syncope, sudomotor dysfunction, dysautonomia, orthostatic dysfunction) would otherwise be stated.

**Required output behavior**

- Engine and AI narrative use pattern-consistent-with framing only, with the missing-input limitation named.
- A named condition is stated as a conclusion only where an approval record shows a licensed clinician adopted that label for that study.
- Every asserted diagnosis carries the approving clinician identity and approval timestamp in the audit trail.

**Prohibited wording / behavior**

- Engine-authored 'you have <diagnosis>' text in any audience view.
- Definitive CAN / POTS / neurogenic syncope / sudomotor dysfunction assertions without an approval record.

**Acceptance criteria**

- **Given** a study with no clinician approval records **when** the diagnostic and impression sections render **then** every condition is pattern-consistent-with framed and no named diagnosis is asserted.
- **Given** a study where a clinician approved the label 'pattern consistent with cardiovascular autonomic neuropathy' **when** the clinician-approved conclusion is rendered **then** the label is attributed to the approving clinician with a timestamp and is the only asserted conclusion.

**Open questions**

- Confirm intended spelling and meaning of the two ASR-garbled terms ('pseudomotor' -> sudomotor?, 'isopathovagal' -> sympathovagal?).
- Which named conditions, if any, may the engine ever surface as candidates versus never mention at all?

### `GOV-RISK-005` - Therapy, supplement, pharmaceutical, dose and frequency content is clinician-entered only

| Field | Value |
| --- | --- |
| Domain | `high_risk_claim` |
| Status | `provisional_needs_source` |
| Priority | `P0` |
| Confidence | `medium` |
| Data class | `clinician_approved_conclusion` |
| Approval owner | `legal_regulatory` (UNASSIGNED - legal/regulatory reviewer for Physio PS, Inc. (open staffing gap, see open questions)) |
| Dependencies | `GOV-SCOPE-002`, `GOV-SCOPE-004`, `PROD-PAT-002` |

**Source evidence**

- walkthrough `00:32:34-00:32:55` - "we have a list of, you know, fluids and salts and compression garments, and alpha lipoic acid, and methylfolate, and all the things that we would recommend On the supplement side, and then go in and have possible recommendations for the pharmaceutical side, if we want to do that."
- walkthrough `00:33:27-00:33:50` - "maybe we also put in there a space for, if approved, what's the dose? And what, you know, how many times a day do you do this and such? ... have the clinician just click, on The therapies, the dosages, and the frequency"
- walkthrough `00:32:05-00:32:08` - "the clinician has implemented, not AI."

**Trigger**

- Therapy / supplement / pharmaceutical menu and any dose or frequency field.
- input fields: `therapy.menu`, `therapy.approvals`, `therapy.doseFields`

**Deterministic preconditions**

- A therapy, supplement, drug, dose or administration frequency would be displayed to any audience.

**Required output behavior**

- Dose and frequency are free/entered fields owned by the clinician; the engine pre-fills nothing.
- Any candidate therapy list shipped in the product is a fixed, reviewed catalogue, versioned and traceable to an approved source document.
- Patient-visible therapy content is emitted only from explicit clinician approval records.

**Prohibited wording / behavior**

- Engine-suggested or AI-suggested doses, frequencies, drug choices or supplement choices.
- Shipping the walkthrough's spoken example list as product content without documented source and legal/regulatory review.

**Acceptance criteria**

- **Given** the therapy section for any fixture **when** the section renders with no clinician input **then** no dose, frequency, drug or supplement value is pre-populated and no AI-authored recommendation text appears.
- **Given** a clinician approves two therapies and enters doses **when** the patient-visible content is generated **then** exactly those two therapies with exactly those clinician-entered doses appear, and nothing else.

**Open questions**

- Is a shipped therapy catalogue in scope for the clinician-only first release, or is v1 free-text only?
- Who is the regulatory owner for a supplement/pharmaceutical catalogue inside a licensed product?

### `UX-CLIN-001` - Classification states must be encoded in high-contrast distinct hues, not pastel shades

| Field | Value |
| --- | --- |
| Domain | `visual_encoding` |
| Status | `confirmed_in_review` |
| Priority | `P1` |
| Confidence | `high` |
| Data class | `system_behavior` |
| Approval owner | `product_owner` (S. O'Leary - PhysioPS product owner) |
| Dependencies | `UX-A11Y-001`, `UX-CLIN-004` |

**Source evidence**

- walkthrough `00:20:52-00:21:12` - "The color differentiation, too, like, below norm and above norm. They're almost ... the same color ... Yeah, you should just make it a different color, not a different shade."
- walkthrough `00:21:24-00:21:44` - "Another reason why we went red, white, and blue is because red and blue and white and green are primary colors, and ... the contrasts are high. You get into these pastel colors, the contrasts are muted. And, you know, a lot of doctors are older doctors. They can't see the difference."

**Trigger**

- Any bar graph, legend or numeric cell that encodes in-band / below-norm / above-norm state.
- input fields: `chart.legend`, `value.classification`, `theme.tokens`

**Deterministic preconditions**

- A rendered element encodes classification state through colour.

**Required output behavior**

- Below-norm and above-norm use distinct hues (vendor convention: red / blue / white / green family), not two shades of one hue.
- Every colour-encoded state is also encoded non-chromatically (label, glyph or pattern).
- Legend text names each state explicitly (in band, below norm, above norm).

**Prohibited wording / behavior**

- Pastel or low-chroma palettes for classification state.
- Shade-only or colour-only differentiation of below-norm versus above-norm.

**Acceptance criteria**

- **Given** the clinician report for FIX-C01 **when** the classification legend and bars are sampled programmatically **then** below-norm and above-norm swatches differ in hue by a fixed minimum angle and each state carries a text label.
- **Given** a greyscale rendering of the same view **when** classification state is read without colour **then** every state remains distinguishable from label or glyph alone.

**Open questions**

- Confirm the exact approved palette tokens for in band / below norm / above norm against the vendor red-white-blue convention.

### `UX-CLIN-002` - Dense technical sections must be collapsed behind a visible disclosure control

| Field | Value |
| --- | --- |
| Domain | `information_architecture` |
| Status | `confirmed_in_review` |
| Priority | `P1` |
| Confidence | `high` |
| Data class | `system_behavior` |
| Approval owner | `product_owner` (S. O'Leary - PhysioPS product owner) |
| Dependencies | `CLIN-RATIO-002`, `UX-CLIN-003` |

**Source evidence**

- walkthrough `00:11:45-00:12:06` - "I guess because ... I don't see a down arrow for the time domain ratios. I do, you know, how this cardiorespiratory coupling. If the doctor wants to see it. you can pull it up, and I would do the same thing with time to mean ratios."
- walkthrough `00:12:11-00:12:19` - "if a doctor does want to see it, they can click it. They don't. Right. The information's there if they want it, basically. / Exactly."
- walkthrough `00:23:53-00:23:57` - "This is another one that should have a little arrow. As to whether or not the doctor wants to see it or not."

**Trigger**

- Cardio-respiratory coupling, time-domain ratios, rhythm strip and comparable technical sections.
- input fields: `section.id`, `section.disclosureState`

**Deterministic preconditions**

- The section is classified as technical/optional in the section registry.

**Required output behavior**

- Each such section is collapsed by default with a visible, labelled disclosure affordance.
- Disclosure state is keyboard reachable and announced to assistive technology.
- Content is fully present in the DOM/report payload when expanded - collapsing must not drop data.

**Prohibited wording / behavior**

- A dense technical block rendered expanded by default with no affordance.
- A disclosure affordance on one technical section but not its siblings.

**Acceptance criteria**

- **Given** the clinician report for any cohort fixture **when** the section registry is enumerated **then** every section flagged technical is collapsed by default and exposes a labelled, focusable disclosure control.
- **Given** a collapsed technical section **when** the disclosure control is activated by keyboard **then** the full section content renders and the state change is announced.

### `UX-CLIN-003` - Rhythm strip must be fully inspectable with legible ectopic annotation

| Field | Value |
| --- | --- |
| Domain | `information_architecture` |
| Status | `confirmed_in_review` |
| Priority | `P1` |
| Confidence | `high` |
| Data class | `measured_data` |
| Approval owner | `engineering` (B. O'Leary - Thingk Tangk engineering) |
| Dependencies | `UX-CLIN-002`, `CLIN-BASE-005`, `GOV-PARITY-001` |

**Source evidence**

- walkthrough `00:23:09-00:23:17` - "Which we're not ... Gonna let them scroll through the rhythm strip, or the ... yeah, rhythm strip."
- walkthrough `00:23:17-00:23:30` - "They should be able to, because it says so many ... it's got a blurry ... 13 atopic beats, noted. They appear as ... Clamped spikes?"
- walkthrough `00:23:44-00:23:51` - "You got the whole strip, you should be able to screw it. / Yeah."

**Trigger**

- ECG rhythm strip section of the clinician report.
- input fields: `ecg.strip`, `ecg.ectopicAnnotations`, `ecg.ectopicCount`

**Deterministic preconditions**

- An ECG waveform array was parsed for the study.

**Required output behavior**

- The clinician can traverse the whole acquired strip, not only the first visible window.
- The annotated ectopic count is displayed and matches the deterministic parser count from the .ans annotation field.
- Annotation text is legible at the supported review resolutions.

**Prohibited wording / behavior**

- A fixed, non-traversable window presented as if it were the whole strip.
- An ectopic count in prose that disagrees with the parsed annotation value.

**Acceptance criteria**

- **Given** a fixture whose .ans annotation reports N premature beats **when** the rhythm strip section is expanded **then** the displayed ectopic count equals N and the full strip duration is reachable.
- **Given** the strip at the narrowest supported viewport **when** annotations render **then** annotation text meets the minimum legible size and does not overlap the trace.

**Open questions**

- Does the clinician need per-beat ectopy markers on the strip, or only the aggregate count plus traversal?

### `UX-CLIN-004` - Classified graphs lead; the concise numeric table follows the explanations as a summary

| Field | Value |
| --- | --- |
| Domain | `information_architecture` |
| Status | `confirmed_in_review` |
| Priority | `P2` |
| Confidence | `medium` |
| Data class | `system_behavior` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `UX-CLIN-001`, `UX-CLIN-005`, `CLIN-DENS-001` |

**Source evidence**

- walkthrough `00:19:49-00:20:05` - "Is it easy to look at this table, or is it easier to look at the graph? / the doctors ... It's easier to look at the graph because of these indications here. High, low, borderline low, critically low, etc."
- walkthrough `00:19:21-00:19:34` - "The ANS Test Results Report. When we get down to this, after we've done all the explanations that we have above, As a summary. This would be the ... For a doctor, this would be the most concise way of summarizing ... that table."

**Trigger**

- Top-level ordering of the clinician report.
- input fields: `report.sectionOrder`

**Deterministic preconditions**

- Both classified graphs and the numeric summary table are present.

**Required output behavior**

- Classified graphs with named states (high, low, borderline low, critically low) precede raw numeric tables.
- The concise numeric table appears after the explanation sections as a summary.

**Prohibited wording / behavior**

- Leading the clinician report with an unclassified numeric matrix.

**Acceptance criteria**

- **Given** the clinician report for any cohort fixture **when** section order is enumerated **then** the classified graph sections precede the numeric summary table and the table follows the explanation sections.

**Open questions**

- Confirm the exact approved section order for the clinician report end to end.

### `UX-CLIN-005` - Every displayed number must carry a normal range or classification, or be removed

| Field | Value |
| --- | --- |
| Domain | `information_architecture` |
| Status | `confirmed_in_review` |
| Priority | `P1` |
| Confidence | `high` |
| Data class | `deterministic_calculation` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `CLIN-DENS-001`, `UX-CLIN-004` |

**Source evidence**

- walkthrough `00:20:29-00:20:45` - "if you keep these numbers here and only bar graph a few of them, the doctor's gonna say, well, all right, is this 5.55 LFA at deep breathing, normal or abnormal? If it's ... if it's not necessarily necessary, why do you have it there?"

**Trigger**

- Every numeric cell rendered in a clinician-facing table or panel.
- input fields: `table.cells`, `cell.normalRange`, `cell.classification`

**Deterministic preconditions**

- A numeric value is rendered to a clinician.

**Required output behavior**

- Each rendered numeric cell carries either an explicit normal range or a classification state.
- Values with neither are removed from the view rather than shown bare.

**Prohibited wording / behavior**

- Bare numbers with no interpretive anchor.
- Silently deleting a value from the payload instead of the view (audit trail must retain it).

**Acceptance criteria**

- **Given** the rendered clinician table for all cohort fixtures **when** every numeric cell is enumerated **then** each cell has a normal range or a classification state, and any exception is listed in an explicit approved allowlist.

**Open questions**

- Which cells, if any, are approved to display without a normal range?

### `UX-CLIN-006` - Retrieved source citations must be inspectable with document and page

| Field | Value |
| --- | --- |
| Domain | `provenance_ux` |
| Status | `product_direction` |
| Priority | `P2` |
| Confidence | `high` |
| Data class | `ai_narrative` |
| Approval owner | `engineering` (B. O'Leary - Thingk Tangk engineering) |
| Dependencies | `GOV-RAG-001`, `GOV-RAG-002` |

**Source evidence**

- walkthrough `00:18:04-00:18:19` - "Click one, let's see what it does. / There's no clicking. / It is a reference, right? / But it gives the page numbers."

**Trigger**

- Citation chips under an Ask ATOM answer.
- input fields: `answer.citations`

**Deterministic preconditions**

- The answer surfaced at least one retrieved passage.

**Required output behavior**

- Each citation exposes the approved document title, edition and page range and can be opened to the retrieved passage text.
- Citations that cannot be resolved to an approved corpus document are not rendered; the answer abstains instead.

**Prohibited wording / behavior**

- Non-interactive citation chips whose provenance cannot be verified in-session.

**Acceptance criteria**

- **Given** an Ask ATOM answer with citations **when** a citation is activated **then** the exact retrieved passage, document title and page range are shown.

### `UX-A11Y-001` - Clinician surfaces must be legible for reduced colour discrimination and older users

| Field | Value |
| --- | --- |
| Domain | `accessibility` |
| Status | `product_direction` |
| Priority | `P1` |
| Confidence | `medium` |
| Data class | `system_behavior` |
| Approval owner | `product_owner` (S. O'Leary - PhysioPS product owner) |
| Dependencies | `UX-CLIN-001` |

**Source evidence**

- walkthrough `00:21:38-00:21:51` - "a lot of doctors are older doctors. They can't see the difference. / I'm having a hard time differentiating between it on my monitor."

**Trigger**

- All clinician-facing rendering.
- input fields: `theme.tokens`, `typography.scale`, `chart.encodings`

**Deterministic preconditions**

- A clinician-facing view is rendered.

**Required output behavior**

- Text and essential graphical elements meet the project's documented minimum contrast target against their background.
- No information is conveyed by colour alone.
- Numeric labels and legends respect a minimum type size at the supported review resolutions.

**Prohibited wording / behavior**

- Contrast or type-size regressions in classification-bearing UI.

**Acceptance criteria**

- **Given** the clinician report for FIX-C01 at the supported viewports **when** automated contrast and type-size checks run **then** no classification-bearing element falls below the documented thresholds.

**Open questions**

- Which contrast standard and level does PhysioPS want as the contractual target for the licensed product?

### `OPS-VOICE-001` - Voice dictation into Ask ATOM truncates after roughly every second word

| Field | Value |
| --- | --- |
| Domain | `defect_operational` |
| Status | `confirmed_in_review` |
| Priority | `P1` |
| Confidence | `high` |
| Data class | `system_behavior` |
| Approval owner | `engineering` (B. O'Leary - Thingk Tangk engineering) |
| Dependencies | none |

**Source evidence**

- walkthrough `00:15:05-00:15:31` - "Baseline A ... If baseline A [--] is corrupted. / I don't think it hurt you, probably because of my phone. / is corrupted."
  - note: Dictated question had to be restarted repeatedly.
- walkthrough `00:15:45-00:15:47` - "Why does this keep turning off after every second word?"

**Trigger**

- Clinician dictates a question into Ask ATOM.
- input fields: `atom.voiceInput`

**Deterministic preconditions**

- Microphone permission granted; dictation session started.

**Required output behavior**

- A dictation session stays open until the user stops it or a documented silence timeout elapses.
- Partial transcripts accumulate into one coherent query rather than being cut into fragments.
- If the platform cannot sustain the session, the UI states the limitation instead of silently truncating.

**Prohibited wording / behavior**

- Silent session termination mid-utterance.

**Acceptance criteria**

- **Given** an active dictation session on a supported clinician device **when** a 20-word question is dictated with normal pauses **then** the full question is captured in one query with no mid-utterance session termination.
- **Given** a platform that cannot sustain continuous capture **when** dictation is attempted **then** an explicit limitation message is shown and no partial query is silently submitted.

**Open questions**

- Which devices/browsers must be supported for dictation in the clinician-only release?

### `OPS-EVID-001` - Clinical review sessions require legible evidence capture

| Field | Value |
| --- | --- |
| Domain | `process` |
| Status | `product_direction` |
| Priority | `P2` |
| Confidence | `high` |
| Data class | `system_behavior` |
| Approval owner | `product_owner` (S. O'Leary - PhysioPS product owner) |
| Dependencies | none |

**Source evidence**

- walkthrough `00:07:40-00:07:46` - "it's ... you have it blurred here, but ... / I don't know what that is."
- walkthrough `00:23:25-00:23:30` - "it's got a blurry ... 13 atopic beats, noted ... I can't ... it's kind of blurry, I can't really read it."

**Trigger**

- Any recorded clinical validation walkthrough used as governance evidence.
- input fields: `review.session`

**Deterministic preconditions**

- A recorded session is intended to produce binding clinical decisions.

**Required output behavior**

- Screen share resolution and scaling must render report text legibly in the recording.
- Each session produces a written decision list with timestamps, circulated for clinician confirmation.

**Prohibited wording / behavior**

- Treating an illegible on-screen artifact as reviewed and approved.

**Acceptance criteria**

- **Given** a recorded review session **when** the recording is sampled at each decision point **then** the report text under discussion is legible, or the decision is marked unverified pending re-review.

### `OPS-PLAN-001` - Calendar-year delivery commitment and engineering attendance risk are tracked, not gated

| Field | Value |
| --- | --- |
| Domain | `process` |
| Status | `product_direction` |
| Priority | `P3` |
| Confidence | `high` |
| Data class | `system_behavior` |
| Approval owner | `product_owner` (S. O'Leary - PhysioPS product owner) |
| Dependencies | none |

**Source evidence**

- walkthrough `00:37:32-00:38:00` - "Unfortunately, there's still a lot of work to do. / Very unfortunately, yes. ... I've sort of committed us, in a sense. To having all this done by the end of the calendar year."
- walkthrough `00:38:15-00:38:29` - "My concern is, as in the past. ... Ben's supposed to be here, and he's not. Yeah, we do have a reliability issue."

**Trigger**

- Programme management context, recorded for completeness.

**Deterministic preconditions**

- None. This is non-clinical context.

**Required output behavior**

- The end-of-calendar-year commitment and the engineering availability risk are tracked in the programme plan.

**Prohibited wording / behavior**

- Using schedule pressure as justification to ship any rule in provisional_needs_source or needs_clinician_wording status.

**Acceptance criteria**

- **Given** a release candidate proposed under schedule pressure **when** the stop-ship checklist is evaluated **then** no stop-ship criterion is waived on schedule grounds.

### `PROD-PAT-001` - Patient experience is a separate, simple destination added after the clinician release

| Field | Value |
| --- | --- |
| Domain | `product_scope` |
| Status | `product_direction` |
| Priority | `P2` |
| Confidence | `high` |
| Data class | `patient_visible_content` |
| Approval owner | `product_owner` (S. O'Leary - PhysioPS product owner) |
| Dependencies | `GOV-SCOPE-001`, `GOV-SCOPE-002` |

**Source evidence**

- walkthrough `00:31:12-00:31:26` - "Well, at some point in time, we need a patient map of some sort. ... I think we need a patient app of some sort."
- walkthrough `00:31:33-00:31:51` - "We can always add a patient specific ones. ... they're two separate sites, basically, right? / Yes, definitely. / and then the patient one is just ... Really simple."

**Trigger**

- Deployment topology for patient-facing content.
- input fields: `deployment.surface`

**Deterministic preconditions**

- The clinician-only release has shipped.

**Required output behavior**

- The patient experience is a distinct surface with its own content contract, not a view toggle inside the clinician tool.
- The patient surface is deliberately minimal.

**Prohibited wording / behavior**

- Reusing the clinician report body as patient content.

**Acceptance criteria**

- **Given** the clinician-only release **when** the deployment surfaces are enumerated **then** no patient surface is reachable and no patient/clinician toggle exists.

### `PROD-PAT-002` - Clinician approve/decline controls are the only channel that populates patient content

| Field | Value |
| --- | --- |
| Domain | `product_scope` |
| Status | `product_direction` |
| Priority | `P1` |
| Confidence | `high` |
| Data class | `clinician_approved_conclusion` |
| Approval owner | `clinical_authority` (J. Colombo, PhD, DNM, DHS - clinical authority of record) |
| Dependencies | `GOV-SCOPE-002`, `GOV-SCOPE-004`, `GOV-RISK-005` |

**Source evidence**

- walkthrough `00:32:55-00:33:18` - "have boxes ... two boxes on the ... in the right-hand, margin that says approve or disappro ... approve or not. ... And every box that the clinician approves, automatically ... Gets input to the patient side."
- walkthrough `00:34:22-00:34:29` - "And then the doctor clicks on the things that he would approve of, and that gets sent over to the patient."

**Trigger**

- Generation of any patient-visible content item.
- input fields: `approval.records`, `patient.contentBuilder`

**Deterministic preconditions**

- An approval record exists identifying the approving clinician, the item and the timestamp.

**Required output behavior**

- Patient content is a pure function of approval records plus clinician-entered fields.
- Declining an item removes it from patient content with an audit entry.

**Prohibited wording / behavior**

- Any patient-visible item without a matching approval record.

**Acceptance criteria**

- **Given** a study with three candidate items where the clinician approves one and declines two **when** patient content is generated **then** exactly the approved item appears and both declined items are absent with audit entries.
- **Given** an approval record deleted after generation **when** patient content is regenerated **then** the corresponding item disappears from patient content.

### `PROD-PAT-003` - Patients may download their full data behind an explicit physician-interpretation gate

| Field | Value |
| --- | --- |
| Domain | `product_scope` |
| Status | `product_direction` |
| Priority | `P2` |
| Confidence | `medium` |
| Data class | `patient_visible_content` |
| Approval owner | `legal_regulatory` (UNASSIGNED - legal/regulatory reviewer for Physio PS, Inc. (open staffing gap, see open questions)) |
| Dependencies | `GOV-DISC-003`, `GOV-SCOPE-002`, `PROD-PAT-001` |

**Source evidence**

- walkthrough `00:35:43-00:36:03` - "there has to be a back door somewhere on the patient report that says, okay, if you want all of your information ... click here and download. But remember, it's not valid without a physician reading."
- walkthrough `00:36:07-00:36:28` - "the doctor may not agree with anything ... and then the patient needs to go find another doctor. So you need to give the patient their data in order to do so"

**Trigger**

- Patient requests the full data package.
- input fields: `patient.downloadRequest`

**Deterministic preconditions**

- The patient surface exists (post clinician-only release) and the requester is the patient of record.

**Required output behavior**

- The download provides the underlying data artifacts the patient is entitled to.
- The download is gated by the physician-interpretation disclaimer of GOV-DISC-003 and the download event is audited.

**Prohibited wording / behavior**

- Attaching engine-authored narrative conclusions to the downloaded package.

**Acceptance criteria**

- **Given** a patient requesting the full data package **when** the download is initiated **then** the physician-interpretation disclaimer is displayed and acknowledged, the artifacts contain no engine-authored conclusions, and the event is audited.

**Open questions**

- Which artifacts exactly are in the patient download package, and under which jurisdiction's access rules?

## 9. Required coverage checklist

| Mandated topic | Rules |
| --- | --- |
| Recovery phases are intentionally too short to be true baseline returns | `CLIN-BASE-001` |
| Valid C/E average may estimate a corrupted Baseline A for the sympathetic, parasympathetic and ratio values | `CLIN-BASE-002`, `CLIN-BASE-003` |
| Separate physiologic tests are not duplicates; within 15% may be considered clinically constant only when symptoms and context are stable | `CLIN-RETEST-001`, `CLIN-RETEST-002` |
| The same file processed twice must be byte and value deterministic | `CLIN-DET-001` |
| High-FRF ordering and non-invalidation of the test | `CLIN-FRF-001`, `CLIN-FRF-002` |
| Blood-pressure classification defect | `CLIN-BP-001`, `CLIN-BP-002` |
| Normal Valsalva parasympathetic response defect | `CLIN-VALS-001` |
| Removal of parasympathetic withdrawal language | `CLIN-LANG-001` |
| Stand response and orthostatic interpretation correction | `CLIN-STAND-001`, `CLIN-STAND-002`, `CLIN-LANG-002` |
| Removal or de-emphasis of E:I, Valsalva and 30:15 ratios | `CLIN-RATIO-001`, `CLIN-RATIO-002` |
| High-contrast visual states | `UX-CLIN-001`, `UX-A11Y-001` |
| Collapsible technical sections | `UX-CLIN-002` |
| Rhythm-strip inspection | `UX-CLIN-003` |
| Clinician-only first release | `GOV-SCOPE-001` |
| Separate patient experience populated only from clinician-approved content | `GOV-SCOPE-002`, `PROD-PAT-001`, `PROD-PAT-002` |
| Closed approved RAG corpus with exact document and page provenance | `GOV-RAG-001`, `GOV-RAG-002`, `GOV-RAG-003`, `UX-CLIN-006` |
| Removal of the clinical authority's name from generic analogies | `GOV-NAME-001` |
| Physician-of-record routing for patient questions | `GOV-NAME-002`, `GOV-NAME-003` |
| Voice dictation failure | `OPS-VOICE-001` |
| Removal of the misleading not-vendor-validated wording | `GOV-WORD-001` |
| Physician-interpretation disclaimer | `GOV-DISC-001`, `GOV-DISC-002`, `GOV-DISC-003` |
| High-risk claims are provisional and blocked, never active production rules | `GOV-RISK-001`, `GOV-RISK-002`, `GOV-RISK-003`, `GOV-RISK-004`, `GOV-RISK-005`, `CLIN-FRF-008` |
| Honest scoping of prior parity evidence | `GOV-PARITY-001` |

## 10. Open questions for the clinical authority

| # | Rule | Status | Question |
| ---: | --- | --- | --- |
| 1 | `CLIN-FRF-001` | `confirmed_in_review` | Is the required ordering universal for all high-FRF studies, or only when deep-breathing RFa is also abnormal? (00:00:43 scope caveat) |
| 2 | `CLIN-FRF-003` | `needs_clinician_wording` | Supply the verbatim mechanism sentence, including the intended hedge ('usually' vs 'often' vs 'may reflect'). |
| 3 | `CLIN-FRF-004` | `confirmed_in_review` | Are asthma/COPD/bronchitis/wheezing permitted as illustrative examples in the clinician view, or must they stay out of rendered copy entirely? (mentioned only conversationally at 00:02:58) |
| 4 | `CLIN-FRF-005` | `confirmed_in_review` | Should an unconfirmed maneuver suppress or only caveat the high-FRF interpretation? |
| 5 | `CLIN-FRF-008` | `provisional_needs_source` | Is there a citable published source for the FRF/early-lung-findings observation? Until supplied, this stays permanently blocked. |
| 6 | `CLIN-FRF-009` | `confirmed_in_review` | Confirm whether baseline FRF should be hidden or shown greyed with a 'not clinically used' marker. |
| 7 | `CLIN-FRF-010` | `needs_clinician_wording` | When FRF is high, is the low-parasympathetic finding (a) reported with a caveat, (b) reported but not scored, or (c) withheld pending retest? |
| 8 | `CLIN-BASE-002` | `confirmed_email` | What deterministic threshold defines 'corrupted by ectopy' for a phase (ectopic beats per phase, percent of beats, or clinician flag)? |
| 9 | `CLIN-BASE-002` | `confirmed_email` | Should the estimate be suppressed when C and E differ from each other by more than a stated tolerance? |
| 10 | `CLIN-BASE-003` | `confirmed_in_review` | Enumerate the exact capture conditions that must match (posture, time since challenge, medication state). |
| 11 | `CLIN-BASE-004` | `needs_clinician_wording` | After substitution, should rows C and E be hidden, kept, or collapsed? |
| 12 | `CLIN-BASE-005` | `needs_clinician_wording` | Provide the ectopy/artifact threshold per phase that makes a baseline unusable. |
| 13 | `CLIN-RETEST-002` | `confirmed_email` | Does the 15% band apply to all metrics (LFa, RFa, ratio, HR, BP) or only to the ones explicitly analogised to BP? |
| 14 | `CLIN-RETEST-002` | `confirmed_email` | Is the band computed against the earlier value, the mean of the pair, or the age-indexed normal range? |
| 15 | `CLIN-BP-002` | `needs_clinician_wording` | Which BP threshold standard governs the classification, and are the phase-specific (orthostatic) cut points the same as the resting ones? |
| 16 | `CLIN-VALS-001` | `confirmed_in_review` | Is there any Valsalva parasympathetic pattern that should be flagged abnormal (for example no change at all), and what is its label? |
| 17 | `CLIN-VALS-002` | `needs_clinician_wording` | Confirm the sudomotor sentence verbatim and confirm it is compatible with the existing rule that sudomotor status is not assessed without QSART/TST. |
| 18 | `CLIN-STAND-001` | `confirmed_in_review` | Provide the numeric rule (ratio or delta) that separates 'higher peak', 'comparable' and 'blunted' stand responses. |
| 19 | `CLIN-STAND-002` | `needs_clinician_wording` | Confirm the approved strength of the neurogenic-syncope statement given cuff-only BP. |
| 20 | `CLIN-STAND-002` | `needs_clinician_wording` | Define 'blood pressure not going up' numerically for the stand phase. |
| 21 | `CLIN-LANG-001` | `rejected` | Confirm whether 'sympathetic withdrawal' remains acceptable when defined against baseline (00:27:27). |
| 22 | `CLIN-LANG-002` | `rejected` | Supply the replacement method sentence verbatim. |
| 23 | `CLIN-LANG-003` | `needs_clinician_wording` | What is the approved statement when every autonomic challenge shows no response? |
| 24 | `CLIN-LANG-004` | `rejected` | May the age-indexed normal band keep the label 'declining normal band' without the age-line narrative? |
| 25 | `CLIN-RATIO-001` | `rejected` | Should the ratios remain in an exported clinician PDF or be removed there as well? |
| 26 | `CLIN-TERM-001` | `confirmed_in_review` | Provide the exact textbook citation and page for the footnote, and confirm whether an asterisk is required at each occurrence (00:10:39) or once per report. |
| 27 | `CLIN-DUP-001` | `rejected` | Which name is canonical: 'Numerical Summary' or 'ANS Test Results'? |
| 28 | `CLIN-DENS-001` | `needs_clinician_wording` | Provide the exact keep/drop list per phase per metric (which of HR, HR range, FRF, LFa, RFa, LFa/RFa, BP survive in each of the six phases). |
| 29 | `GOV-RAG-001` | `confirmed_in_review` | Provide the final approved corpus manifest (documents, editions, page ranges) authorised for release. |
| 30 | `GOV-RAG-003` | `confirmed_in_review` | Set the minimum retrieval support threshold and who approves changes to it. |
| 31 | `GOV-NAME-002` | `confirmed_in_review` | Supply the exact footer sentence and the contact channel to publish. |
| 32 | `GOV-DISC-001` | `confirmed_in_review` | Is a stronger disclaimer required than the one used on the vendor multi-parameter report, and if so what is its wording? |
| 33 | `GOV-DISC-002` | `needs_clinician_wording` | Product owner to supply the reporting-application statement text. |
| 34 | `GOV-DISC-003` | `confirmed_in_review` | Confirm the verbatim notice text. |
| 35 | `GOV-WORD-001` | `rejected` | Approve replacement wording for proprietary-approximation metrics that is accurate without implying invalid data. |
| 36 | `GOV-REG-001` | `product_direction` | Which entity distributes the product, under what licensing basis, and what regulatory classification is claimed? |
| 37 | `GOV-RISK-001` | `provisional_needs_source` | Who is the accountable legal/regulatory approver? The role is currently unstaffed and blocks all five classes. |
| 38 | `GOV-RISK-002` | `provisional_needs_source` | Is there a validated, citable risk model linking sympathovagal balance to event risk in this population? |
| 39 | `GOV-RISK-003` | `provisional_needs_source` | Does the product need an escalation pathway for genuinely critical findings, and who owns it clinically? |
| 40 | `GOV-RISK-004` | `provisional_needs_source` | Confirm intended spelling and meaning of the two ASR-garbled terms ('pseudomotor' -> sudomotor?, 'isopathovagal' -> sympathovagal?). |
| 41 | `GOV-RISK-004` | `provisional_needs_source` | Which named conditions, if any, may the engine ever surface as candidates versus never mention at all? |
| 42 | `GOV-RISK-005` | `provisional_needs_source` | Is a shipped therapy catalogue in scope for the clinician-only first release, or is v1 free-text only? |
| 43 | `GOV-RISK-005` | `provisional_needs_source` | Who is the regulatory owner for a supplement/pharmaceutical catalogue inside a licensed product? |
| 44 | `UX-CLIN-001` | `confirmed_in_review` | Confirm the exact approved palette tokens for in band / below norm / above norm against the vendor red-white-blue convention. |
| 45 | `UX-CLIN-003` | `confirmed_in_review` | Does the clinician need per-beat ectopy markers on the strip, or only the aggregate count plus traversal? |
| 46 | `UX-CLIN-004` | `confirmed_in_review` | Confirm the exact approved section order for the clinician report end to end. |
| 47 | `UX-CLIN-005` | `confirmed_in_review` | Which cells, if any, are approved to display without a normal range? |
| 48 | `UX-A11Y-001` | `product_direction` | Which contrast standard and level does PhysioPS want as the contractual target for the licensed product? |
| 49 | `OPS-VOICE-001` | `confirmed_in_review` | Which devices/browsers must be supported for dictation in the clinician-only release? |
| 50 | `PROD-PAT-003` | `product_direction` | Which artifacts exactly are in the patient download package, and under which jurisdiction's access rules? |

## 11. Regeneration and validation

```bash
python3 governance/_build_governance.py        # regenerate all four artifacts
node governance/validate-clinical-governance.mjs   # schema / completeness / coherence gate
```

