#!/usr/bin/env python3
"""Deterministic builder for the HumanOS ANS clinical governance artifacts.

Single source of truth for:
  - governance/clinical-rule-ledger.json      (machine readable ledger)
  - governance/CLINICAL_RULE_LEDGER.md        (human readable ledger)
  - governance/clinical-regression-spec.json  (machine readable regression spec)
  - governance/CLINICAL_REGRESSION_SPEC.md    (human readable regression spec)

This script writes governance metadata only. It does not touch production
clinical logic and performs no network access.

Run:  python3 governance/_build_governance.py
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))

LEDGER_VERSION = "1.0.0"
GENERATED = "2026-08-15"

SOURCES = {
    "email_2026_08_09": {
        "id": "email_2026_08_09",
        "kind": "email",
        "from": "J. Colombo, PhD, DNM, DHS (CTO & Senior Medical Director, Physio PS, Inc.)",
        "to": ["S. O'Leary (PhysioPS)", "B. O'Leary (Thingk Tangk)"],
        "sent": "2026-08-09T14:45:25",
        "subject": "Re: HumanOS ANS - Final Clinical Validation and Mission Success",
        "artifact": "uploaded_attachments/cd97f881e4bd4c71ab356c7c316a7c3e/image.jpg",
        "citation_style": "email item N",
        "confidentiality": "Marked CONFIDENTIAL by sender. Internal, source-controlled use only.",
    },
    "walkthrough_2026_08_14": {
        "id": "walkthrough_2026_08_14",
        "kind": "recorded_clinical_walkthrough",
        "participants": [
            "jc = J. Colombo (clinical authority)",
            "PhysioPS = S. O'Leary (product owner)",
        ],
        "absent": "B. O'Leary (engineering) did not attend (ref 00:38:18)",
        "recorded": "2026-08-14T15:30:44",
        "duration": "00:38:59",
        "artifact_transcript": (
            "uploaded_attachments/c1f94bdf566d4d0c895e3dc3b6d1709f/"
            "GMT20260814-153044_Recording.cutfile.20260814201840473.transcript.vtt"
        ),
        "artifact_recording": (
            "uploaded_attachments/c1f94bdf566d4d0c895e3dc3b6d1709f/"
            "GMT20260814-153044_Recording.cutfile.20260814201840473_1366x720.mp4"
        ),
        "case_under_review": "FIX-C01 (walkthrough identifies the loaded study at 00:06:35-00:06:44)",
        "citation_style": "HH:MM:SS timestamp of the transcript cue",
        "scope_caveat": (
            "At 00:00:43 the clinical authority states explicitly that the corrections "
            "being given are 'not a universal correction' - they apply to other reports "
            "but must not be assumed globally true. Any rule derived from a single "
            "case-specific remark is marked needs_clinician_wording or "
            "provisional_needs_source, never confirmed as a universal production rule."
        ),
    },
}

STATUS_DEFS = {
    "confirmed_email": "Decision stated in writing by the clinical authority in the 2026-08-09 email. Highest-strength internal evidence.",
    "confirmed_in_review": "Decision explicitly stated and agreed during the 2026-08-14 recorded walkthrough, with an unambiguous transcript reference.",
    "rejected": "Content, wording or behavior explicitly rejected for release. The gate requires that it be absent from output.",
    "needs_clinician_wording": "Direction is clear but the exact clinician-approved wording, threshold or classification boundary has not been supplied. Cannot ship as generated text.",
    "provisional_needs_source": "Clinically consequential statement (diagnosis, risk, oncology, treatment, urgency) that requires a documented source plus clinical, legal and regulatory approval before any implementation. Must not be encoded as an active production rule.",
    "product_direction": "Non-clinical product, engineering or operational decision. Governed by product/engineering owners, not by clinical sign-off.",
}

DATA_CLASS_DEFS = {
    "measured_data": "Values acquired from the device/study and parsed from the .ans binary or read from the vendor PDF. Never authored by the engine.",
    "deterministic_calculation": "Values computed by pinned, versioned, side-effect-free code from measured data. Same input must always produce the same output.",
    "ai_narrative": "Language generated or assembled by the model/RAG layer. Never a clinical conclusion of record.",
    "clinician_approved_conclusion": "A conclusion, phenotype, plan or therapy that only exists once a licensed clinician has explicitly approved it in the product.",
    "patient_visible_content": "Content rendered to a patient. Permitted only if it originates from clinician_approved_conclusion or from raw measured data released with the physician-interpretation disclaimer.",
    "system_behavior": "Non-clinical platform behavior (determinism, provenance isolation, layout, accessibility, dictation).",
}

PRIORITY_DEFS = {
    "P0": "Stop-ship. Release is blocked while open.",
    "P1": "Required for clinician pilot release. Blocks the clinician-only first release sign-off.",
    "P2": "Required before broader rollout or the patient experience.",
    "P3": "Tracked improvement, not release blocking.",
}

OWNERS = {
    "clinical_authority": "J. Colombo, PhD, DNM, DHS - clinical authority of record",
    "product_owner": "S. O'Leary - PhysioPS product owner",
    "engineering": "B. O'Leary - Thingk Tangk engineering",
    "qa": "HumanOS QA / governance gate maintainer",
    "legal_regulatory": "UNASSIGNED - legal/regulatory reviewer for Physio PS, Inc. (open staffing gap, see open questions)",
}


def rule(**kw):
    return kw


def ev(src, ref, quote, note=None):
    d = {"source": src, "ref": ref, "quote": quote}
    if note:
        d["note"] = note
    return d


def gwt(g, w, t):
    return {"given": g, "when": w, "then": t}


RULES = [
    # ---------------- FRF domain ----------------
    rule(
        id="CLIN-FRF-001",
        title="High-FRF finding must lead the deep-breathing Explain panel",
        domain="interpretation_ordering",
        status="confirmed_in_review",
        priority="P1",
        confidence="high",
        data_class="ai_narrative",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:00:57-00:01:20",
               "this explanation, I clicked on explained here. This explanation should start with ... the fact that the FRF is high. Or, our multi-parameter graph report says FRF is out of range. So, we need to explain what that means."),
        ],
        trigger={
            "inputs": ["deepBreathing.frf", "deepBreathing.frfClassification", "explainPanel.render"],
            "description": "Clinician opens the Explain panel for a study whose deep-breathing FRF is classified out of range (high).",
        },
        preconditions=[
            "deepBreathing.frf is present and non-null (not 'unavailable').",
            "deepBreathing.frfClassification == 'high' (deterministic classifier output, not narrative).",
        ],
        required_behavior=[
            "The first rendered paragraph of the Explain panel states that FRF is high / out of range.",
            "The second statement explains what a high FRF means clinically (see CLIN-FRF-003).",
            "The non-invalidation statement (CLIN-FRF-002) appears before any downstream parasympathetic interpretation.",
        ],
        prohibited=[
            "Opening the panel with age framing, analogies, or generic autonomic prose while FRF is out of range.",
            "Burying the FRF finding below the parasympathetic conclusion.",
        ],
        dependencies=["CLIN-FRF-002", "CLIN-FRF-003", "CLIN-FRF-010"],
        acceptance_criteria=[
            gwt("a study with deepBreathing.frfClassification == 'high'",
                "the clinician opens the deep-breathing Explain panel",
                "the first sentence contains the high/out-of-range FRF statement and precedes every parasympathetic interpretation sentence in DOM order"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "Is the required ordering universal for all high-FRF studies, or only when deep-breathing RFa is also abnormal? (00:00:43 scope caveat)",
        ],
    ),
    rule(
        id="CLIN-FRF-002",
        title="High FRF does not invalidate the test",
        domain="interpretation",
        status="confirmed_in_review",
        priority="P0",
        confidence="high",
        data_class="ai_narrative",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:03:32-00:03:39",
               "You gotta explain that, okay, the FRF is high, but that doesn't invalidate the test. First thing the doctor needs to know."),
        ],
        trigger={
            "inputs": ["deepBreathing.frfClassification", "study.validityFlags"],
            "description": "Any report where FRF is out of range.",
        },
        preconditions=["deepBreathing.frfClassification in ('high','out_of_range')"],
        required_behavior=[
            "Report states explicitly that a high FRF does not invalidate the study.",
            "Study-level validity flags remain 'valid' on the basis of FRF alone.",
        ],
        prohibited=[
            "Any wording implying the test is invalid, unusable, void, or must be repeated because FRF is high.",
            "Suppressing the deep-breathing results because FRF is high.",
        ],
        dependencies=[],
        acceptance_criteria=[
            gwt("a high-FRF study", "the clinician report is generated",
                "the rendered text contains an explicit non-invalidation statement and contains none of the prohibited invalidity phrases"),
            gwt("a high-FRF study", "study validity is computed",
                "validity is not downgraded by the FRF classification alone"),
        ],
        approval_owner="clinical_authority",
        open_questions=[],
    ),
    rule(
        id="CLIN-FRF-003",
        title="High FRF mechanism statement: vagus struggling to ventilate",
        domain="interpretation",
        status="needs_clinician_wording",
        priority="P1",
        confidence="medium",
        data_class="ai_narrative",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:01:42-00:01:53",
               "what it does mean, FRF is high, is usually the vagus nerve is struggling to ventilate. That's why the frequency is high."),
            ev("walkthrough_2026_08_14", "00:03:39-00:03:46",
               "Second thing a doctor needs to know is, okay, it's high because the vagus is struggling to ventilate. Which means you have some sort of pulmonary or upper respiratory problem."),
        ],
        trigger={"inputs": ["deepBreathing.frfClassification"], "description": "High-FRF explanation body."},
        preconditions=["deepBreathing.frfClassification == 'high'"],
        required_behavior=[
            "Mechanism sentence uses the clinician's hedged construction ('usually', 'often') rather than an absolute causal claim.",
            "Exact production sentence must be supplied verbatim by the clinical authority before release.",
        ],
        prohibited=[
            "Absolute causal phrasing ('is caused by', 'proves', 'confirms').",
            "The amplitude-modulation / carrier-wave / spectral-window explanation in clinician-facing copy (see CLIN-FRF-006).",
        ],
        dependencies=["CLIN-FRF-001", "CLIN-FRF-006"],
        acceptance_criteria=[
            gwt("no verbatim clinician-approved mechanism sentence exists in the wording registry",
                "the generator attempts to emit a high-FRF mechanism sentence",
                "the build fails the wording-safety gate and the panel renders the approved placeholder instead of model-authored prose"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "Supply the verbatim mechanism sentence, including the intended hedge ('usually' vs 'often' vs 'may reflect').",
        ],
    ),
    rule(
        id="CLIN-FRF-004",
        title="High FRF or high deep-breathing response indicates possible pulmonary / upper respiratory disorder",
        domain="interpretation",
        status="confirmed_in_review",
        priority="P1",
        confidence="high",
        data_class="ai_narrative",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:03:17-00:03:28",
               "either the FRF being high, or the deep breathing results being high. Indicates possible pulmonary or upper respiratory disorder."),
            ev("walkthrough_2026_08_14", "00:25:35-00:25:52",
               "just say, hi FRF. May be associated with upper respiratory pulmonary disorder ... Yes, we can keep anxiety, though. Consider treating the patient and retest it. Yep, good."),
        ],
        trigger={
            "inputs": ["deepBreathing.frfClassification", "deepBreathing.rfaClassification"],
            "description": "High FRF or high deep-breathing response.",
        },
        preconditions=[
            "deepBreathing.frfClassification == 'high' OR deepBreathing.responseClassification == 'high'",
        ],
        required_behavior=[
            "Emit a possibility-framed association with upper respiratory / pulmonary disorder.",
            "Anxiety may be retained as an alternative association.",
            "Emit 'consider treating and retesting' as a clinician-directed suggestion.",
        ],
        prohibited=[
            "Naming a specific pulmonary diagnosis (asthma, COPD, bronchitis) as a finding.",
            "Any oncology claim (see CLIN-FRF-008 / GOV-RISK-001).",
        ],
        dependencies=["CLIN-FRF-007", "GOV-RISK-001"],
        acceptance_criteria=[
            gwt("a study with high deep-breathing FRF",
                "the findings section is generated",
                "it contains a possibility-framed upper-respiratory/pulmonary association, optionally anxiety, and a consider-treat-and-retest suggestion, and contains no named respiratory diagnosis"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "Are asthma/COPD/bronchitis/wheezing permitted as illustrative examples in the clinician view, or must they stay out of rendered copy entirely? (mentioned only conversationally at 00:02:58)",
        ],
    ),
    rule(
        id="CLIN-FRF-005",
        title="High FRF requires confirmation that the deep-breathing maneuver was performed correctly",
        domain="clinician_workflow",
        status="confirmed_in_review",
        priority="P2",
        confidence="medium",
        data_class="clinician_approved_conclusion",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:01:53-00:02:00",
               "You gotta confirm with the doctor that they did 6 breaths, and they did 6 slow breaths properly."),
            ev("walkthrough_2026_08_14", "00:02:26-00:02:34",
               "The low-frequency carrier, according to the breathing chart that I just saw up above, says she did it right."),
        ],
        trigger={"inputs": ["deepBreathing.frfClassification", "breathingChart"], "description": "High FRF study."},
        preconditions=["deepBreathing.frfClassification == 'high'"],
        required_behavior=[
            "Prompt the clinician to confirm six slow breaths were performed correctly, with the breathing chart adjacent to the prompt.",
            "Record the clinician's confirmation as an explicit, attributable field.",
        ],
        prohibited=[
            "Asserting maneuver adequacy automatically from the breathing chart without clinician confirmation.",
        ],
        dependencies=["CLIN-FRF-001"],
        acceptance_criteria=[
            gwt("a high-FRF study", "the clinician opens the deep-breathing section",
                "a maneuver-confirmation control is present, defaults to unconfirmed, and the report records the clinician's response"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "Should an unconfirmed maneuver suppress or only caveat the high-FRF interpretation?",
        ],
    ),
    rule(
        id="CLIN-FRF-006",
        title="Spectral-window technical explanation is rejected for clinician-facing copy",
        domain="wording_safety",
        status="rejected",
        priority="P1",
        confidence="high",
        data_class="ai_narrative",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:01:20-00:01:41",
               "we don't need to explain it technically ... The fundamental respiratory frequency being too high means you're looking at the wrong area of the spectrum. I don't expect to say that, I've never said that, except in my book once."),
            ev("walkthrough_2026_08_14", "00:02:00-00:02:26",
               "now I'm talking to you, technically, not what I would say to a doctor ... you have a jagged sine wave ... amplitude modulated waveform"),
        ],
        trigger={"inputs": ["explainPanel.text"], "description": "Any clinician-facing narrative."},
        preconditions=["Rendered clinician narrative text is being assembled."],
        required_behavior=[
            "Rendered copy stays at the clinical-meaning level.",
            "Signal-processing rationale, if retained at all, is confined to a collapsed methodology appendix and is not part of the finding.",
        ],
        prohibited=[
            "'wrong area of the spectrum'", "'amplitude modulated'", "'carrier'",
            "'jagged sine wave'", "'raggedy sine wave'",
            "Driving/fuel/bucking-car analogies in rendered copy.",
        ],
        dependencies=["CLIN-FRF-003", "UX-CLIN-002"],
        acceptance_criteria=[
            gwt("the wording-safety denylist containing the spectral-window phrases",
                "any clinician-facing narrative is generated for the full fixture cohort",
                "zero denylisted phrases appear in rendered clinician copy"),
        ],
        approval_owner="clinical_authority",
        open_questions=[],
    ),
    rule(
        id="CLIN-FRF-007",
        title="'Artificially reduces' FRF phrasing is rejected",
        domain="wording_safety",
        status="rejected",
        priority="P0",
        confidence="high",
        data_class="ai_narrative",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:25:30-00:25:42",
               "Fundamental respiratory frequency high, artificially reduces. Maybe an associate, okay. I'd take out of the artificially reduces part, and just say, hi FRF."),
        ],
        trigger={"inputs": ["findings.frfLine"], "description": "FRF findings line."},
        preconditions=["The FRF findings line is being generated."],
        required_behavior=[
            "Replacement line: high FRF may be associated with upper respiratory / pulmonary disorder (or anxiety), consider treating and retesting.",
        ],
        prohibited=[
            "'artificially reduces'",
            "Any claim that high FRF suppresses, deflates or invalidates the measured parasympathetic value.",
        ],
        dependencies=["CLIN-FRF-004", "CLIN-FRF-002"],
        acceptance_criteria=[
            gwt("a high-FRF study", "the findings section is generated",
                "the string 'artificially reduces' is absent and the approved association line is present"),
        ],
        approval_owner="clinical_authority",
        open_questions=[],
    ),
    rule(
        id="CLIN-FRF-008",
        title="Early lung-cancer indication from high FRF - blocked high-risk claim",
        domain="high_risk_claim",
        status="provisional_needs_source",
        priority="P0",
        confidence="low",
        data_class="ai_narrative",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:02:58-00:03:17",
               "They may be wheezing, they may have, you know, sinus problems, or bronchitis, or asthma, or COPD. We've even found early lung cancer indications. From FRF being high.",
               "Conversational aside describing past clinical experience. Not a validated screening claim and not offered as report copy."),
        ],
        trigger={"inputs": ["deepBreathing.frf"], "description": "Any attempt to associate FRF with oncologic findings."},
        preconditions=["N/A - no production precondition exists; this content is blocked."],
        required_behavior=[
            "Blocked. The engine must never emit oncology detection, screening or suspicion language from any ANS metric.",
            "If clinically desired later, it requires a documented published source, clinical sign-off, and legal/regulatory review recorded in this ledger.",
        ],
        prohibited=[
            "'cancer'", "'lung cancer'", "'malignancy'", "'tumor'", "'oncologic'", "'screening for cancer'",
        ],
        dependencies=["GOV-RISK-001"],
        acceptance_criteria=[
            gwt("the full fixture cohort", "clinician and patient outputs are generated",
                "zero oncology terms appear anywhere in rendered output or RAG answers"),
            gwt("an adversarial chat turn asking whether the study indicates cancer",
                "the assistant answers",
                "it refuses, states the test does not assess oncologic risk, and routes to the physician of record"),
        ],
        approval_owner="legal_regulatory",
        open_questions=[
            "Is there a citable published source for the FRF/early-lung-findings observation? Until supplied, this stays permanently blocked.",
        ],
    ),
    rule(
        id="CLIN-FRF-009",
        title="FRF is clinically required only at deep breathing; baseline FRF is not needed",
        domain="report_composition",
        status="confirmed_in_review",
        priority="P2",
        confidence="high",
        data_class="deterministic_calculation",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:12:43-00:13:20",
               "at deep breathing, all I'm really worried about is the RFA, and the FRF. And the only FRF I care about in this entire column is Deep breathing ... except for FRF at baseline, you need all the rest of this information. A deep breathing. The heart rate, FRF, RFA, And blood pressure is important."),
        ],
        trigger={"inputs": ["numericalSummary.rows"], "description": "Numerical summary composition."},
        preconditions=["The numerical summary table is being composed for the clinician view."],
        required_behavior=[
            "Deep breathing row retains heart rate, FRF, RFa and blood pressure.",
            "Baseline-phase FRF cells are removed from the default clinician view (available in the collapsed technical appendix).",
        ],
        prohibited=["Rendering baseline FRF as a headline clinical value."],
        dependencies=["UX-CLIN-005", "CLIN-DENS-001"],
        acceptance_criteria=[
            gwt("a parsed study", "the default clinician numerical summary renders",
                "no baseline-phase FRF cell is present in the default view and the deep-breathing row retains HR, FRF, RFa and BP"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "Confirm whether baseline FRF should be hidden or shown greyed with a 'not clinically used' marker.",
        ],
    ),
    rule(
        id="CLIN-FRF-010",
        title="Parasympathetic interpretation must be qualified by FRF status",
        domain="interpretation",
        status="needs_clinician_wording",
        priority="P1",
        confidence="low",
        data_class="ai_narrative",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:25:56-00:26:14",
               "Given that, I ... Ignore the rest of this. If the FRF is Normal, then we can look at low parasympathetic",
               "Statement is truncated and ambiguous. The direction (FRF status gates parasympathetic reading) is clear; the exact gating behavior is not."),
        ],
        trigger={"inputs": ["deepBreathing.frfClassification", "parasympatheticInterpretation"], "description": "Parasympathetic interpretation generation."},
        preconditions=["A parasympathetic classification is about to be narrated."],
        required_behavior=[
            "When FRF is normal, the low-parasympathetic reading is narrated normally.",
            "When FRF is high, the low-parasympathetic reading must carry an explicit qualifier pending clinician wording.",
        ],
        prohibited=[
            "Silently deleting or silently asserting the parasympathetic conclusion when FRF is high.",
            "Treating the truncated transcript line as approval for suppressing findings.",
        ],
        dependencies=["CLIN-FRF-002", "CLIN-FRF-003"],
        acceptance_criteria=[
            gwt("a high-FRF study with low parasympathetic activity",
                "the interpretation is generated",
                "the parasympathetic line carries the FRF qualifier and the qualifier text comes from the approved wording registry, otherwise the gate fails"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "When FRF is high, is the low-parasympathetic finding (a) reported with a caveat, (b) reported but not scored, or (c) withheld pending retest?",
        ],
    ),

    # ---------------- Baseline / recovery ----------------
    rule(
        id="CLIN-BASE-001",
        title="Recovery phases are intentionally too short to be true baseline returns",
        domain="baseline_semantics",
        status="confirmed_email",
        priority="P0",
        confidence="high",
        data_class="ai_narrative",
        source_evidence=[
            ev("email_2026_08_09", "email item 1",
               "Recovery phases are purposely too short to be true returns to baseline, but do have utility as their averages help to provide an estimate of an initial baseline if it is corrupted by ectopy."),
        ],
        trigger={"inputs": ["phases.baselineC", "phases.baselineE", "recoveryInterpretation"], "description": "Any narrative or scoring that treats a recovery phase as a return to baseline."},
        preconditions=["A recovery/post-challenge baseline phase (C or E) is being interpreted."],
        required_behavior=[
            "Recovery phases are described as short recovery windows by design, not as returns to baseline.",
            "Their documented utility is estimating a corrupted initial baseline (see CLIN-BASE-002).",
        ],
        prohibited=[
            "'failed to return to baseline'", "'incomplete recovery to baseline'",
            "'did not recover to baseline'",
            "Scoring or flagging a patient as abnormal because a recovery phase did not reach the initial baseline value.",
        ],
        dependencies=["CLIN-BASE-002"],
        acceptance_criteria=[
            gwt("the full fixture cohort", "clinician narratives are generated",
                "no output contains failure-to-return-to-baseline language for phases C or E, and no abnormality flag is derived from recovery-vs-baseline deltas"),
        ],
        approval_owner="clinical_authority",
        open_questions=[],
    ),
    rule(
        id="CLIN-BASE-002",
        title="Average of valid Baseline C and E may estimate a corrupted Baseline A for LFa, RFa and ratio",
        domain="baseline_estimation",
        status="confirmed_email",
        priority="P0",
        confidence="high",
        data_class="deterministic_calculation",
        source_evidence=[
            ev("email_2026_08_09", "email item 1",
               "their averages help to provide an estimate of an initial baseline if it is corrupted by ectopy."),
            ev("walkthrough_2026_08_14", "00:13:29-00:13:59",
               "if baseline A is corrupted because of artifact ectopy, but baseline C and E are not corrupted, a good estimate of what A would have been is an average of C and E. As far as LFA, RFA is concerned, and ratio."),
            ev("walkthrough_2026_08_14", "00:14:22-00:14:35",
               "at the average of C and E ... It's sometimes a decent replacement for A if A is corrupted by ectopy. Artifact or arrhythmia."),
        ],
        trigger={
            "inputs": ["phases.baselineA.corruptionFlag", "phases.baselineC.valid", "phases.baselineE.valid", "lfa", "rfa", "lfaRfaRatio"],
            "description": "Baseline A is flagged corrupted while C and E are valid.",
        },
        preconditions=[
            "phases.baselineA.corruptionFlag == true with a recorded cause in ('ectopy','artifact','arrhythmia').",
            "phases.baselineC.valid == true AND phases.baselineE.valid == true.",
            "Estimation applies only to LFa, RFa and the LFa/RFa ratio.",
            "Estimator is the arithmetic mean of the C and E values of the same metric, computed deterministically.",
        ],
        required_behavior=[
            "Emit estimated Baseline A LFa/RFa/ratio as mean(C, E) with method = 'estimated_from_recovery_mean'.",
            "Label the estimated cells visibly as estimates and record provenance (source phases, cause of corruption).",
            "Preserve the original corrupted Baseline A values in the audit trail.",
        ],
        prohibited=[
            "Applying the estimator to heart rate, blood pressure, FRF or any time-domain ratio.",
            "Applying the estimator when C or E is itself corrupted.",
            "Presenting the estimate as a measured value or without the estimate label.",
            "Silently overwriting Baseline A.",
        ],
        dependencies=["CLIN-BASE-001", "CLIN-BASE-003", "CLIN-BASE-005"],
        acceptance_criteria=[
            gwt("a study with Baseline A corrupted by ectopy and valid Baselines C and E",
                "the engine composes the numerical summary",
                "Baseline A LFa, RFa and LFa/RFa equal mean(C,E) to the pinned rounding rule, are marked 'estimated', carry provenance, and heart rate / BP / FRF for Baseline A remain unsubstituted"),
            gwt("a study with Baseline A corrupted and Baseline E also corrupted",
                "the engine composes the numerical summary",
                "no substitution occurs and Baseline A LFa/RFa/ratio render as unavailable with the corruption reason"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "What deterministic threshold defines 'corrupted by ectopy' for a phase (ectopic beats per phase, percent of beats, or clinician flag)?",
            "Should the estimate be suppressed when C and E differ from each other by more than a stated tolerance?",
        ],
    ),
    rule(
        id="CLIN-BASE-003",
        title="Baseline substitution is valid only under matched capture conditions and only if the donor phase is itself valid",
        domain="baseline_estimation",
        status="confirmed_in_review",
        priority="P0",
        confidence="high",
        data_class="deterministic_calculation",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:16:10-00:16:18",
               "Baseline replacement made from ... Should only be used if it was captured under the same condition as it itself was valid."),
        ],
        trigger={"inputs": ["substitution.request"], "description": "Any baseline substitution."},
        preconditions=["A substitution is being considered for a baseline metric."],
        required_behavior=[
            "Substitution requires same-study, same-session, same-position capture conditions and a valid donor phase.",
            "Condition-match and donor-validity checks are evaluated and recorded before substitution.",
        ],
        prohibited=[
            "Cross-study or cross-session substitution.",
            "Substitution from a phase captured in a different posture or maneuver state.",
        ],
        dependencies=["CLIN-BASE-002"],
        acceptance_criteria=[
            gwt("a substitution candidate from a different session or posture",
                "the substitution rule is evaluated",
                "substitution is refused and the reason is recorded in the audit trail"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "Enumerate the exact capture conditions that must match (posture, time since challenge, medication state).",
        ],
    ),
    rule(
        id="CLIN-BASE-004",
        title="Phase-row pruning when baselines are substituted is undecided",
        domain="report_composition",
        status="needs_clinician_wording",
        priority="P2",
        confidence="low",
        data_class="system_behavior",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:13:55-00:14:16",
               "So, we can do that automatically and eliminate B, C, and E, rather. But then, you know, you're gonna have A, B, D, and F, Which might be confusing to the doctor.",
               "Speaker corrects himself mid-sentence and explicitly flags the result as potentially confusing. No decision was reached."),
        ],
        trigger={"inputs": ["numericalSummary.rows", "substitution.applied"], "description": "Row set selection after substitution."},
        preconditions=["A baseline substitution has been applied."],
        required_behavior=[
            "Until decided, keep all six phase rows and mark the estimated cells. Do not remove phases automatically.",
        ],
        prohibited=["Automatically eliminating phase rows C and E from the clinician view."],
        dependencies=["CLIN-BASE-002"],
        acceptance_criteria=[
            gwt("a study where Baseline A was estimated from C and E",
                "the clinician numerical summary renders",
                "all six phase rows are present and only the estimated cells are annotated"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "After substitution, should rows C and E be hidden, kept, or collapsed?",
        ],
    ),
    rule(
        id="CLIN-BASE-005",
        title="Phase corruption detection must be deterministic, explicit and auditable",
        domain="determinism",
        status="needs_clinician_wording",
        priority="P1",
        confidence="medium",
        data_class="deterministic_calculation",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:14:25-00:14:33",
               "It's sometimes a decent replacement for A if A is corrupted by ectopy. Artifact or arrhythmia.",
               "Establishes the causes; does not establish a numeric threshold."),
            ev("walkthrough_2026_08_14", "00:23:17-00:23:25",
               "it says so many ... 13 atopic beats, noted."),
        ],
        trigger={"inputs": ["phase.ectopicBeats", "phase.artifactFraction", "phase.rhythmFlags"], "description": "Per-phase validity computation."},
        preconditions=["Per-phase beat and artifact series are available from the .ans parse."],
        required_behavior=[
            "Per-phase corruption is computed from pinned, versioned thresholds and emitted as a structured flag with cause and evidence counts.",
            "Corruption flags are visible in the audit trail and identical across repeated runs of the same file.",
        ],
        prohibited=[
            "Model-authored or heuristic-narrative corruption judgements.",
            "Hidden thresholds not recorded in the versioned configuration.",
        ],
        dependencies=["CLIN-BASE-002", "CLIN-DET-001"],
        acceptance_criteria=[
            gwt("the same .ans file", "corruption flags are computed twice",
                "flags, causes and evidence counts are byte-identical"),
            gwt("no clinician-approved threshold in the configuration",
                "the governance validator runs",
                "the rule is reported as blocking-open and no substitution path is enabled in production"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "Provide the ectopy/artifact threshold per phase that makes a baseline unusable.",
        ],
    ),

    # ---------------- Retest / longitudinal ----------------
    rule(
        id="CLIN-RETEST-001",
        title="Separate physiologic tests are never duplicates - the ANS is always active",
        domain="longitudinal",
        status="confirmed_email",
        priority="P0",
        confidence="high",
        data_class="ai_narrative",
        source_evidence=[
            ev("email_2026_08_09", "email item 2",
               "The ANS is always active. There is no possibility of duplication from test to test, even within the same hour."),
        ],
        trigger={"inputs": ["study.acquisitionId", "study.timestamp", "priorStudies"], "description": "Two or more studies for the same patient."},
        preconditions=["Two distinct acquisitions exist (distinct acquisition timestamps / distinct raw signal), even within the same hour."],
        required_behavior=[
            "Each acquisition is treated as an independent physiologic observation and retained.",
            "Comparison language describes change between observations, not error or duplication.",
        ],
        prohibited=[
            "'duplicate test'", "'duplicate study'", "'redundant test'",
            "Deduplicating, merging or discarding a distinct acquisition because it is close in time or numerically similar.",
            "Flagging a same-day retest as a data-quality problem.",
        ],
        dependencies=["CLIN-RETEST-002", "CLIN-DET-001"],
        acceptance_criteria=[
            gwt("two distinct same-day acquisitions for one patient",
                "both are ingested",
                "both are retained as independent studies, neither is flagged as a duplicate, and no duplicate/redundant wording appears"),
        ],
        approval_owner="clinical_authority",
        open_questions=[],
    ),
    rule(
        id="CLIN-RETEST-002",
        title="Within-15% change may be considered clinically constant only when symptoms and context are stable",
        domain="longitudinal",
        status="confirmed_email",
        priority="P0",
        confidence="high",
        data_class="clinician_approved_conclusion",
        source_evidence=[
            ev("email_2026_08_09", "email item 2",
               "Like clinical reads of BP, a change wihtin 15% is often considered constant as long as symptoms are constant."),
        ],
        trigger={"inputs": ["metricDeltaPercent", "symptomStabilityFlag", "contextFlags"], "description": "Comparison of the same metric across studies."},
        preconditions=[
            "Both studies carry the same metric with the same computation method and version.",
            "abs(delta) <= 15% of the earlier value.",
            "symptomStabilityFlag == 'stable' as explicitly recorded by a clinician, plus stable context (medications, posture, time of day, acute illness).",
        ],
        required_behavior=[
            "Only when all preconditions hold may the comparison be labelled 'clinically constant (within 15%)'.",
            "Where symptom stability is unknown, render the numeric delta with an explicit 'symptom context not recorded' marker.",
        ],
        prohibited=[
            "Asserting 'stable', 'unchanged', 'no change' or 'improved' from numbers alone.",
            "Treating the 15% band as a normality threshold or as a diagnostic criterion.",
            "Applying the band to unlike metrics or across different computation versions.",
        ],
        dependencies=["CLIN-RETEST-001"],
        acceptance_criteria=[
            gwt("two studies with a 9% RFa change and no recorded symptom status",
                "the longitudinal comparison renders",
                "the output shows the numeric delta with a 'symptom context not recorded' marker and does not claim stability"),
            gwt("two studies with a 9% RFa change and clinician-recorded stable symptoms",
                "the longitudinal comparison renders",
                "the output may state 'clinically constant (within 15%)' and attributes the symptom-stability input to the clinician"),
            gwt("two studies with a 22% RFa change and stable symptoms",
                "the longitudinal comparison renders",
                "the output does not claim constancy"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "Does the 15% band apply to all metrics (LFa, RFa, ratio, HR, BP) or only to the ones explicitly analogised to BP?",
            "Is the band computed against the earlier value, the mean of the pair, or the age-indexed normal range?",
        ],
    ),
    rule(
        id="CLIN-DET-001",
        title="The same file processed twice must be byte/value deterministic",
        domain="determinism",
        status="product_direction",
        priority="P0",
        confidence="high",
        data_class="system_behavior",
        source_evidence=[
            ev("email_2026_08_09", "email item 2",
               "There is no possibility of duplication from test to test",
               "Engineering corollary: clinical non-duplication concerns distinct acquisitions. It must not be confused with computational reproducibility, which is mandatory."),
            ev("walkthrough_2026_08_14", "00:00:43-00:00:52",
               "what I'm about to say is not a universal correction",
               "Reinforces that reproducibility of the pipeline, not variability, is the baseline expectation for governance review."),
        ],
        trigger={"inputs": ["upload.fileBytes"], "description": "Same .ans (or same paired .ans + PDF) submitted twice."},
        preconditions=["Two submissions have identical SHA-256 of all input bytes and identical engine version."],
        required_behavior=[
            "All parsed measurements, deterministic calculations, classifications, flags and provenance records are identical.",
            "Any nondeterministic field (timestamps, request ids, model narrative) is excluded from the compared surface and explicitly enumerated.",
        ],
        prohibited=[
            "Timing-, locale-, ordering-, or random-seed-dependent clinical values.",
            "Model-generated text in any field used for classification or scoring.",
        ],
        dependencies=["CLIN-RETEST-001", "CLIN-BASE-005"],
        acceptance_criteria=[
            gwt("the duplicate cohort pairs FIX-DUP-A and FIX-DUP-B (byte-identical files submitted twice)",
                "each is processed through the production path",
                "the canonical clinical value surface hashes identically for both runs"),
        ],
        approval_owner="engineering",
        open_questions=[],
    ),

    # ---------------- Classification defects ----------------
    rule(
        id="CLIN-BP-001",
        title="Blood pressure classification defect - elevated BP was summarised as normal",
        domain="classification",
        status="confirmed_in_review",
        priority="P0",
        confidence="high",
        data_class="deterministic_calculation",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:25:00-00:25:28",
               "heart rate is normal. Blood pressure is not normal, it's elevated ... So that's mostly right ... Correct. That's the most - that's the part that's Makes it not all right."),
        ],
        trigger={"inputs": ["bp.systolic", "bp.diastolic", "impression.summary"], "description": "Overall impression composition when cuff BP is available."},
        preconditions=["Cuff systolic/diastolic values are present for the resting phase."],
        required_behavior=[
            "BP classification is computed by a deterministic, versioned classifier from a cited threshold table.",
            "Any non-normal BP class propagates into the overall impression rather than being averaged away.",
        ],
        prohibited=[
            "Describing elevated BP as normal or within normal limits.",
            "An overall impression of 'normal' while any component class is abnormal.",
        ],
        dependencies=["CLIN-BP-002"],
        acceptance_criteria=[
            gwt("FIX-C01 with elevated resting cuff BP",
                "the clinician impression is generated",
                "the BP class is 'elevated' (not normal) and the overall impression explicitly names the abnormal BP component"),
            gwt("the full fixture cohort", "BP classes are computed",
                "every BP class matches the pinned threshold table for the parsed systolic/diastolic pair"),
        ],
        approval_owner="clinical_authority",
        open_questions=[],
    ),
    rule(
        id="CLIN-BP-002",
        title="BP threshold table must be an explicitly cited, versioned source",
        domain="classification",
        status="needs_clinician_wording",
        priority="P0",
        confidence="medium",
        data_class="deterministic_calculation",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:25:02-00:25:06",
               "Blood pressure is not normal, it's elevated.",
               "Establishes the expected class for the reviewed case but not the threshold source."),
        ],
        trigger={"inputs": ["bpThresholdTable.version"], "description": "BP classification configuration."},
        preconditions=["A BP classification is requested."],
        required_behavior=[
            "The threshold table is stored in versioned configuration with a named clinical source and an approval record.",
            "The rendered classification exposes the table version on demand.",
        ],
        prohibited=["Hard-coded or undocumented BP cut points.", "Model-inferred BP categories."],
        dependencies=["CLIN-BP-001"],
        acceptance_criteria=[
            gwt("no approved BP threshold source recorded in configuration",
                "the governance validator runs",
                "the rule is reported blocking-open"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "Which BP threshold standard governs the classification, and are the phase-specific (orthostatic) cut points the same as the resting ones?",
        ],
    ),
    rule(
        id="CLIN-VALS-001",
        title="There is no low parasympathetic response to Valsalva - that pattern is normal",
        domain="classification",
        status="confirmed_in_review",
        priority="P0",
        confidence="high",
        data_class="deterministic_calculation",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:26:34-00:26:59",
               "the parasympathetic response to Valsalva. There is no low parasympathetic response to Valsalva. This would be normal ... Parasympathetic response to Valsalva is normal. I don't call it low. There is no low."),
        ],
        trigger={"inputs": ["valsalva.rfaResponse", "valsalva.parasympatheticClass"], "description": "Valsalva parasympathetic classification."},
        preconditions=["The Valsalva phase has a computed parasympathetic (RFa) response."],
        required_behavior=[
            "The Valsalva parasympathetic class domain excludes 'low'. A decrease in parasympathetic activity during Valsalva is classified normal.",
            "Existing outputs that classified Valsalva parasympathetic activity as low must be corrected.",
        ],
        prohibited=[
            "'low parasympathetic response to Valsalva'",
            "Any abnormality flag, score contribution or finding derived from a low Valsalva parasympathetic class.",
        ],
        dependencies=["CLIN-LANG-001"],
        acceptance_criteria=[
            gwt("the full fixture cohort", "Valsalva classifications are computed",
                "no study receives a 'low' Valsalva parasympathetic class and no output contains the prohibited phrase"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "Is there any Valsalva parasympathetic pattern that should be flagged abnormal (for example no change at all), and what is its label?",
        ],
    ),
    rule(
        id="CLIN-VALS-002",
        title="Low sympathetic Valsalva response requires an autonomic-dysfunction suggestion plus a sudomotor implication",
        domain="interpretation",
        status="needs_clinician_wording",
        priority="P1",
        confidence="medium",
        data_class="ai_narrative",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:26:03-00:26:34",
               "Low sympathetic Falsalva, these two should have Suggesting possible autonomic dysfunction. And these two should also have some indication of pseudomotor implications.",
               "'pseudomotor' is an ASR artifact for 'sudomotor'. Wording and the strength of the sudomotor implication need clinician confirmation, and it conflicts with the existing no-QSART/TST safety gate."),
        ],
        trigger={"inputs": ["valsalva.sympatheticClass", "stand.sympatheticClass"], "description": "Low sympathetic response on Valsalva and/or stand."},
        preconditions=["valsalva.sympatheticClass == 'low'"],
        required_behavior=[
            "Emit a possibility-framed autonomic dysfunction suggestion.",
            "Emit a sudomotor implication only as a possibility and only with clinician-approved wording that respects the no-QSART/TST limitation.",
        ],
        prohibited=[
            "Asserting sudomotor dysfunction as a finding without QSART/TST.",
            "Using the ASR artifact 'pseudomotor' in any output.",
        ],
        dependencies=["CLIN-VALS-001", "GOV-RISK-004"],
        acceptance_criteria=[
            gwt("a study with low sympathetic Valsalva response and no QSART/TST input",
                "the interpretation renders",
                "it contains a possibility-framed autonomic-dysfunction suggestion, any sudomotor language is possibility-framed with the method limitation stated, and the string 'pseudomotor' is absent"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "Confirm the sudomotor sentence verbatim and confirm it is compatible with the existing rule that sudomotor status is not assessed without QSART/TST.",
        ],
    ),
    rule(
        id="CLIN-STAND-001",
        title="Stand-response classification defect - 'normal sympathetic response to stand' was wrong for the reviewed case",
        domain="classification",
        status="confirmed_in_review",
        priority="P0",
        confidence="high",
        data_class="deterministic_calculation",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:28:12-00:28:36",
               "Stand response. Normal sympathetic response to stand. Nope. That's wrong. Higher peak sympathetic response to stand compared to ... Well, so will. That's true.",
               "Case-specific correction on FIX-C01; the comparative construction (stand peak vs Valsalva) is the accepted form."),
        ],
        trigger={"inputs": ["stand.lfaPeak", "valsalva.lfaPeak", "stand.sympatheticClass"], "description": "Stand-phase sympathetic classification."},
        preconditions=["Both stand and Valsalva sympathetic (LFa) peaks are available."],
        required_behavior=[
            "The stand sympathetic statement is comparative: peak stand sympathetic response relative to the Valsalva peak.",
            "The comparison is computed deterministically from the two peaks, not asserted narratively.",
        ],
        prohibited=[
            "Declaring a normal sympathetic response to stand when the stand peak exceeds the Valsalva peak.",
            "A stand classification that does not reference the comparator it was computed against.",
        ],
        dependencies=["CLIN-STAND-002", "CLIN-LANG-002"],
        acceptance_criteria=[
            gwt("FIX-C01 where the stand sympathetic peak exceeds the Valsalva peak",
                "the stand response section renders",
                "it states the higher peak stand response relative to Valsalva and does not state a normal sympathetic response to stand"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "Provide the numeric rule (ratio or delta) that separates 'higher peak', 'comparable' and 'blunted' stand responses.",
        ],
    ),
    rule(
        id="CLIN-STAND-002",
        title="Blunted heart-rate response to stand plus non-rising BP - orthostatic interpretation correction",
        domain="interpretation",
        status="needs_clinician_wording",
        priority="P1",
        confidence="medium",
        data_class="ai_narrative",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:28:36-00:29:04",
               "Blunted heart rate responses to him ... Okay, so the blunted heart rate response indicates Neurogenic syncope. And his blood pressure is Not going up, so we have orthostatic intolerance."),
        ],
        trigger={"inputs": ["stand.hrResponse", "stand.bpDelta", "bp.method"], "description": "Blunted HR response on stand with available cuff BP."},
        preconditions=[
            "stand.hrResponse is classified blunted by the deterministic classifier.",
            "Orthostatic BP delta is available from cuff measurements (no beat-to-beat BP).",
        ],
        required_behavior=[
            "Report the blunted HR response and the non-rising BP as separate, explicitly-sourced observations.",
            "Any neurogenic-syncope or orthostatic-intolerance language is possibility-framed and states the cuff-only method limitation.",
        ],
        prohibited=[
            "Asserting neurogenic syncope as a diagnosis.",
            "A definitive adrenergic-failure grade from cuff BP alone.",
            "The phrase flagged in CLIN-LANG-002.",
        ],
        dependencies=["CLIN-STAND-001", "CLIN-LANG-002", "GOV-RISK-004"],
        acceptance_criteria=[
            gwt("a study with blunted stand HR response and cuff-only BP that does not rise",
                "the stand interpretation renders",
                "both observations appear, any syncope/intolerance language is possibility-framed, the cuff-only limitation is stated, and no adrenergic grade is asserted"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "Confirm the approved strength of the neurogenic-syncope statement given cuff-only BP.",
            "Define 'blood pressure not going up' numerically for the stand phase.",
        ],
    ),
    rule(
        id="CLIN-LANG-001",
        title="'Parasympathetic withdrawal' is rejected terminology",
        domain="wording_safety",
        status="rejected",
        priority="P0",
        confidence="high",
        data_class="ai_narrative",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:26:59-00:27:11",
               "Parasympathetic withdrawal was used elsewhere in one of these two reports, again, and that should be That should be eliminated."),
            ev("walkthrough_2026_08_14", "00:27:22-00:28:06",
               "this is a resting term. So, withdrawn from what? ... Parasympathetics, there is no limit to how far down it can go. It's all as long as it goes down, it's normal. So there is no parasympathetic withdrawal, and the only place that it might be indicated is low sympathovagal balance, which really is just low Parasympathetic activity, which tends to indicate advanced autonomic dysfunction or cardiovascular autonomic neuropathy. So I'd rather use all those terms instead of parasympathetic withdrawal."),
        ],
        trigger={"inputs": ["narrative.text"], "description": "Any generated clinical narrative."},
        preconditions=["Clinical narrative is being produced for either audience."],
        required_behavior=[
            "Use 'low parasympathetic activity', 'low sympathovagal balance', 'advanced autonomic dysfunction' or 'cardiovascular autonomic neuropathy' as appropriate.",
        ],
        prohibited=["'parasympathetic withdrawal'", "'vagal withdrawal'"],
        dependencies=["CLIN-VALS-001", "CLIN-TERM-001"],
        acceptance_criteria=[
            gwt("the full fixture cohort and the RAG assistant",
                "all narratives and answers are generated",
                "the phrases 'parasympathetic withdrawal' and 'vagal withdrawal' appear zero times"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "Confirm whether 'sympathetic withdrawal' remains acceptable when defined against baseline (00:27:27).",
        ],
    ),
    rule(
        id="CLIN-LANG-002",
        title="'With the available orthostatic blood pressure' is rejected wording",
        domain="wording_safety",
        status="rejected",
        priority="P1",
        confidence="high",
        data_class="ai_narrative",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:29:04-00:29:14",
               "I'm not sure what it means with the available orthostatic blood pressure. Available is confusing."),
        ],
        trigger={"inputs": ["stand.interpretationText"], "description": "Orthostatic interpretation copy."},
        preconditions=["Orthostatic interpretation copy is being generated."],
        required_behavior=[
            "State the BP method plainly (for example 'based on cuff blood pressure at each phase') using approved wording.",
        ],
        prohibited=["'with the available orthostatic blood pressure'", "Method hedges built on the word 'available'."],
        dependencies=["CLIN-STAND-002"],
        acceptance_criteria=[
            gwt("the full fixture cohort", "orthostatic copy is generated",
                "the rejected phrase appears zero times and the method is stated in plain approved wording"),
        ],
        approval_owner="clinical_authority",
        open_questions=["Supply the replacement method sentence verbatim."],
    ),
    rule(
        id="CLIN-LANG-003",
        title="'No responses across all autonomic challenges suggests advanced autonomic dysfunction' understates severity",
        domain="interpretation",
        status="needs_clinician_wording",
        priority="P1",
        confidence="low",
        data_class="ai_narrative",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:29:14-00:29:17",
               "And no responses across all autonomic challenges suggest."),
            ev("walkthrough_2026_08_14", "00:29:17-00:29:35",
               "Advanced autonomic dysfunction. Well, it's worse than that, actually.",
               "The clinical authority states the existing wording is too weak but does not supply the stronger wording. Do not guess."),
        ],
        trigger={"inputs": ["allChallenges.responseClasses"], "description": "Absent responses across all autonomic challenges."},
        preconditions=["All challenge phases show absent/flat responses."],
        required_behavior=[
            "Render the approved severity statement once supplied; until then render the existing conservative statement and surface the pending-wording marker to the governance gate.",
        ],
        prohibited=[
            "Model-authored escalation of severity language.",
            "Inventing a stronger diagnostic term to satisfy the 'worse than that' remark.",
        ],
        dependencies=["CLIN-LANG-001", "GOV-RISK-004"],
        acceptance_criteria=[
            gwt("a fixture with absent responses across all challenges and no approved severity sentence",
                "the interpretation renders",
                "the conservative statement is used, no escalated term is invented, and the governance report lists the rule as pending clinician wording"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "What is the approved statement when every autonomic challenge shows no response?",
        ],
    ),
    rule(
        id="CLIN-LANG-004",
        title="Physiologic-age framing in the deep-breathing explanation is rejected",
        domain="wording_safety",
        status="rejected",
        priority="P2",
        confidence="high",
        data_class="ai_narrative",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:08:28-00:08:46",
               "This is more of a recommendation than an analogy. or deep breathing, I wouldn't put physiologic age issue in here."),
            ev("walkthrough_2026_08_14", "00:04:50-00:05:05",
               "that comes from when we were talking about physiologic age versus chronologic age, and deep breathing as well ... by the way, I never liked that, anyhow"),
            ev("walkthrough_2026_08_14", "00:05:05-00:05:28",
               "it's just getting so confusing for people, because you have chronological age, you have biological age, you have physiological age, you have metabolic age"),
        ],
        trigger={"inputs": ["deepBreathing.explainPanel"], "description": "Deep-breathing explanation copy."},
        preconditions=["The deep-breathing explanation is being generated."],
        required_behavior=[
            "State FRF status (high, low, normal) and the deep-breathing response, and stop there. The same restraint applies to Valsalva.",
            "The age-indexed normal band may remain as a chart reference without the physiologic-age narrative.",
        ],
        prohibited=[
            "'physiologic age line'", "'physiological age'",
            "Age-persona narratives such as 'a 45-year-old with the deep-breathing RFa of a 65-year-old'.",
        ],
        dependencies=["GOV-NAME-001"],
        acceptance_criteria=[
            gwt("the full fixture cohort", "deep-breathing and Valsalva explanations render",
                "no physiologic-age phrasing or age-persona narrative appears, and the FRF/response statement is present"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "May the age-indexed normal band keep the label 'declining normal band' without the age-line narrative?",
        ],
    ),
    rule(
        id="CLIN-RATIO-001",
        title="E:I, Valsalva and 30:15 (Ewing) ratios are rejected for display",
        domain="report_composition",
        status="rejected",
        priority="P1",
        confidence="high",
        data_class="measured_data",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:21:55-00:22:03", "we don't need the EI valve and 3015 ratios."),
            ev("walkthrough_2026_08_14", "00:24:27-00:24:31", "Again, Ewing ratios, I wouldn't even have it. I'd take this out altogether."),
            ev("walkthrough_2026_08_14", "00:28:06-00:28:12", "And again, we're gonna get rid of EI, Valsaw, and 3015 ratios."),
        ],
        trigger={"inputs": ["ratios.ei", "ratios.valsalva", "ratios.thirtyFifteen"], "description": "Ratio display in clinician and patient views."},
        preconditions=["A report view is being composed."],
        required_behavior=[
            "The three Ewing ratios are removed from clinician and patient views.",
            "They remain parsed and retained internally for vendor-parity regression only, in the non-rendered audit surface.",
        ],
        prohibited=[
            "Rendering E:I, Valsalva or 30:15 ratio values or their Normal/Low labels in any user-visible view.",
            "Deleting them from the parser (parity coverage must not regress).",
        ],
        dependencies=["CLIN-RATIO-002", "GOV-PARITY-001"],
        acceptance_criteria=[
            gwt("the full fixture cohort", "clinician and patient views render",
                "no E:I, Valsalva or 30:15 ratio value or label is visible in either view"),
            gwt("the full fixture cohort", "the parser runs",
                "the three ratio values are still extracted and still match the paired vendor PDFs in the parity harness"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "Should the ratios remain in an exported clinician PDF or be removed there as well?",
        ],
    ),
    rule(
        id="CLIN-RATIO-002",
        title="Cardio-respiratory coupling and time-domain ratios are collapsed behind a disclosure control",
        domain="report_composition",
        status="confirmed_in_review",
        priority="P2",
        confidence="high",
        data_class="deterministic_calculation",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:11:32-00:12:06",
               "Cardio-respiratory coupling, time domain ratios ... I don't see a down arrow for the time domain ratios ... If the doctor wants to see it, you can pull it up, and I would do the same thing with time domain ratios."),
            ev("walkthrough_2026_08_14", "00:12:11-00:12:19",
               "if a doctor does want to see it, they can click it. They don't. Right. The information's there if they want it, basically."),
        ],
        trigger={"inputs": ["section.cardioRespiratoryCoupling", "section.timeDomainRatios"], "description": "Technical section rendering."},
        preconditions=["The clinician report is composed."],
        required_behavior=[
            "Both sections default collapsed with a visible disclosure affordance and expand on demand.",
            "Collapsed state never removes the underlying data from the audit surface.",
        ],
        prohibited=["Technical sections expanded by default.", "Sections with no visible disclosure control."],
        dependencies=["UX-CLIN-002"],
        acceptance_criteria=[
            gwt("a rendered clinician report",
                "the report first paints",
                "cardio-respiratory coupling and time-domain ratios are collapsed, each shows a disclosure control, and each expands on activation"),
        ],
        approval_owner="clinical_authority",
        open_questions=[],
    ),
    rule(
        id="CLIN-TERM-001",
        title="Prefer parasympathetic/sympathetic wording, with a referenced LFa/RFa footnote",
        domain="wording_safety",
        status="confirmed_in_review",
        priority="P2",
        confidence="medium",
        data_class="ai_narrative",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:09:07-00:09:24",
               "Can we actually just For this app, just use parasympathetic and sympathetic, or even beta. Yes."),
            ev("walkthrough_2026_08_14", "00:09:44-00:10:17",
               "I would put a Reference at the bottom ... the LFA is sympathetic and RFA is parasympathetic, according to the first textbook we published ... If anybody were to challenge it, we have the reference that proves that LFA and RFA are sympathetic and parasympathetic, respectively."),
            ev("walkthrough_2026_08_14", "00:10:24-00:10:31",
               "Other people are FDA cleared to do it, we are not yet.",
               "Regulatory caveat attached to the terminology decision."),
        ],
        trigger={"inputs": ["narrative.terminology"], "description": "Metric naming in all views."},
        preconditions=["Metric labels or narrative are being rendered."],
        required_behavior=[
            "Primary labels use parasympathetic/sympathetic wording; LFa/RFa remain as secondary technical labels.",
            "A footnote states the LFa = sympathetic and RFa = parasympathetic equivalence with the published textbook reference and page.",
        ],
        prohibited=[
            "Terminology substitution without the reference footnote.",
            "Calling LF power 'sympathetic tone'.",
        ],
        dependencies=["GOV-REG-001", "GOV-RAG-002"],
        acceptance_criteria=[
            gwt("a rendered clinician report",
                "metric labels are inspected",
                "parasympathetic/sympathetic labels are primary and the referenced equivalence footnote with citation and page is present"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "Provide the exact textbook citation and page for the footnote, and confirm whether an asterisk is required at each occurrence (00:10:39) or once per report.",
        ],
    ),
    rule(
        id="CLIN-DUP-001",
        title="Duplicated numerical summary / six-event table must be de-duplicated",
        domain="report_composition",
        status="rejected",
        priority="P2",
        confidence="high",
        data_class="system_behavior",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:24:04-00:24:27",
               "Didn't we have this table in already someplace? Yeah, up above, right? Same thing? ... There it is again ... Numerical Summary, and now we're calling it 6-event Data. We need one of the two."),
        ],
        trigger={"inputs": ["report.sections"], "description": "Report section assembly."},
        preconditions=["The clinician report is assembled."],
        required_behavior=["Exactly one phase-metric table exists, with one canonical name."],
        prohibited=["Rendering the same phase table twice under different names."],
        dependencies=["CLIN-DENS-001"],
        acceptance_criteria=[
            gwt("a rendered clinician report", "phase-metric tables are counted",
                "exactly one table containing the six phase rows is present"),
        ],
        approval_owner="product_owner",
        open_questions=["Which name is canonical: 'Numerical Summary' or 'ANS Test Results'?"],
    ),
    rule(
        id="CLIN-DENS-001",
        title="Table density must be reduced to clinically-used values only",
        domain="report_composition",
        status="needs_clinician_wording",
        priority="P2",
        confidence="medium",
        data_class="deterministic_calculation",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:12:30-00:12:43",
               "I purposely have it all filled out so there's no blank spaces. And that may be the problem with putting a table, but again, this is a lot more information than they need."),
            ev("walkthrough_2026_08_14", "00:18:50-00:19:07",
               "this is a concise way of providing all this data. The question is, is it Too dense? Is there too much? Because we can Eliminate some of the numbers?"),
            ev("walkthrough_2026_08_14", "00:20:29-00:20:45",
               "if you keep these numbers here and only bar graph a few of them, the doctor's gonna say, well, all right, is this 5.55 LFA at deep breathing, normal or abnormal? If it's not necessarily necessary, why do you have it there?"),
        ],
        trigger={"inputs": ["numericalSummary.cells"], "description": "Cell-level inclusion decisions."},
        preconditions=["The clinician table is being composed."],
        required_behavior=[
            "Every retained cell has either a normal range or a classification; cells with neither are removed or moved to the technical appendix.",
            "The final cell inclusion list must be signed off by the clinical authority.",
        ],
        prohibited=["Filling cells purely to avoid blank space."],
        dependencies=["CLIN-FRF-009", "UX-CLIN-005"],
        acceptance_criteria=[
            gwt("the default clinician table",
                "every rendered numeric cell is inspected",
                "each has an adjacent normal range or classification"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "Provide the exact keep/drop list per phase per metric (which of HR, HR range, FRF, LFa, RFa, LFa/RFa, BP survive in each of the six phases).",
        ],
    ),

    # ---------------- Governance: RAG / provenance ----------------
    rule(
        id="GOV-RAG-001",
        title="Retrieval must be restricted to the closed, approved corpus",
        domain="provenance",
        status="confirmed_in_review",
        priority="P0",
        confidence="high",
        data_class="system_behavior",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:17:02-00:17:29",
               "What are these? Sources CNSSI and IST ... Yeah, so it's pulling from not my sources."),
            ev("walkthrough_2026_08_14", "00:17:47-00:18:01",
               "Their other reference material must be pulling it from the internet, which I didn't think we were doing. It should only be coming from Your everything that we load up there."),
            ev("walkthrough_2026_08_14", "00:18:25-00:18:44",
               "Ben, make a note that we're trying to keep this closed environment only based on the information that Colombo has out there ... Oh that other reference material gets in there, it must be the perplexity engine that goes out and grabs that stuff, I'm guessing."),
        ],
        trigger={"inputs": ["rag.retrievalRequest"], "description": "Any retrieval or assistant answer."},
        preconditions=["An assistant answer or explanation is being grounded."],
        required_behavior=[
            "Retrieval is limited to the allowlisted, approved corpus with an enumerated document manifest.",
            "Open-web or general-index retrieval is disabled in every code path that can reach the clinical assistant.",
            "Any answer whose support falls outside the corpus abstains and says so.",
        ],
        prohibited=[
            "Citing sources outside the approved corpus (the observed CNSSI / NIST-style entries are a defect).",
            "Silent fallback to general web or model-memory sources when retrieval returns nothing.",
        ],
        dependencies=["GOV-RAG-002", "GOV-RAG-003"],
        acceptance_criteria=[
            gwt("the approved corpus manifest",
                "a set of in-domain and out-of-domain questions is asked of the assistant",
                "every returned citation resolves to a manifest document id and out-of-domain questions produce an explicit abstention"),
            gwt("a network-egress assertion in the test harness",
                "the assistant answers any question",
                "no outbound request to a non-allowlisted host occurs"),
        ],
        approval_owner="engineering",
        open_questions=[
            "Provide the final approved corpus manifest (documents, editions, page ranges) authorised for release.",
        ],
    ),
    rule(
        id="GOV-RAG-002",
        title="Every retrieved passage must carry exact document and page provenance",
        domain="provenance",
        status="confirmed_in_review",
        priority="P0",
        confidence="high",
        data_class="system_behavior",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:17:59-00:18:04", "These four are all out of my first book."),
            ev("walkthrough_2026_08_14", "00:18:08-00:18:19", "There's no clicking. ... But it gives the page numbers."),
            ev("walkthrough_2026_08_14", "00:16:40-00:16:58",
               "if you look all the way down, it should show you the reference material that it's pulling it from, right?"),
        ],
        trigger={"inputs": ["rag.citations"], "description": "Citation rendering."},
        preconditions=["An answer cites the corpus."],
        required_behavior=[
            "Each citation records document id, title, edition and page or chunk locator, and is displayed to the clinician.",
            "Provenance is stored with the answer for audit.",
        ],
        prohibited=["Bare source names without page/locator.", "Citations that cannot be traced to a manifest entry."],
        dependencies=["GOV-RAG-001", "UX-CLIN-006"],
        acceptance_criteria=[
            gwt("an assistant answer citing the corpus",
                "the citation block is inspected",
                "every citation shows document title and page/locator and every locator resolves in the manifest"),
        ],
        approval_owner="engineering",
        open_questions=[],
    ),
    rule(
        id="GOV-RAG-003",
        title="The assistant must abstain rather than answer clinical questions unsupported by the corpus",
        domain="provenance",
        status="confirmed_in_review",
        priority="P0",
        confidence="medium",
        data_class="ai_narrative",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:14:37-00:15:05",
               "Click that. Now, ask the question that you just answered, basically. Does baseline C and baseline E equal A? ... If A is corrupt."),
            ev("walkthrough_2026_08_14", "00:16:01-00:16:10",
               "Looks like it's grabbing it from your reference material, but ..."),
            ev("walkthrough_2026_08_14", "00:16:34-00:16:40",
               "Not sure how much the second part is available is Worth it, but ...",
               "The reviewed answer was only partly acceptable, so corpus-grounded abstention behavior must be explicit."),
        ],
        trigger={"inputs": ["rag.retrievalScore", "assistant.answer"], "description": "Assistant answering a clinical question."},
        preconditions=["Retrieval returns no passage above the configured support threshold."],
        required_behavior=[
            "Answer states that the approved corpus does not cover the question and routes to the clinical authority or physician of record.",
        ],
        prohibited=["Answering clinical questions from model memory.", "Blending unsupported claims into a corpus-cited answer."],
        dependencies=["GOV-RAG-001", "GOV-RAG-002"],
        acceptance_criteria=[
            gwt("a clinical question with no supporting corpus passage",
                "the assistant answers",
                "the answer abstains, names the gap, and offers no clinical claim"),
        ],
        approval_owner="clinical_authority",
        open_questions=["Set the minimum retrieval support threshold and who approves changes to it."],
    ),
    rule(
        id="GOV-PARITY-001",
        title="Parity evidence must not be represented as proof of clinical accuracy",
        domain="governance_claims",
        status="product_direction",
        priority="P0",
        confidence="high",
        data_class="system_behavior",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:00:02-00:00:13",
               "We should finish up this walkthrough, because obviously there's I was hoping it was going to be in much better shape than this",
               "Prior numeric parity work did not prevent the clinical defects found in this review."),
            ev("walkthrough_2026_08_14", "00:37:31-00:37:36", "Unfortunately, there's still a lot of work to do."),
        ],
        trigger={"inputs": ["governance.reports"], "description": "Any internal or external statement about validation status."},
        preconditions=["A validation claim is being written."],
        required_behavior=[
            "Numeric parity claims are scoped to the fields, cohort and method actually tested.",
            "Interpretation, wording, classification and workflow correctness are stated as separately gated and currently open.",
        ],
        prohibited=[
            "'clinically validated'", "'fully validated'", "'proved clinical accuracy'", "'clinician approved' without a signed record.",
        ],
        dependencies=[],
        acceptance_criteria=[
            gwt("every governance artifact in this directory",
                "the wording gate scans them",
                "no unqualified clinical-validation claim appears and every parity number carries its cohort and scope"),
        ],
        approval_owner="qa",
        open_questions=[],
    ),

    # ---------------- Governance: naming, disclaimers, scope ----------------
    rule(
        id="GOV-NAME-001",
        title="Remove the clinical authority's name from generic analogies and report body",
        domain="attribution",
        status="rejected",
        priority="P1",
        confidence="high",
        data_class="ai_narrative",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:03:54-00:04:01", "Do you mind having Dr. Colombo's analogy in there? Is that something you want people to see? I've been thinking about that."),
            ev("walkthrough_2026_08_14", "00:04:14-00:04:29", "I'm just thinking from a liability ... as well as a, you know, doctors are going to want to constantly be calling me and asking questions."),
            ev("walkthrough_2026_08_14", "00:05:42-00:06:03", "Can we just call it analogy without using your name? Exactly ... even when it says, Dr. Colombo, deep breathing, just say Deep breathing RFA versus age ... I'm a little adverse to putting your name on there, because I think it opens us up for Some liability issues"),
        ],
        trigger={"inputs": ["report.sectionHeadings", "narrative.attribution"], "description": "Any attributed heading or analogy block."},
        preconditions=["A report heading or narrative block is being rendered."],
        required_behavior=[
            "Attributed headings become neutral labels, e.g. 'Analogy', 'Deep breathing RFa vs age', 'Numerical Summary'.",
        ],
        prohibited=[
            "'Dr. Colombo's Analogy'", "'DR. COLOMBO' as a section prefix", "Personal attribution of analogies anywhere in the report body.",
        ],
        dependencies=["GOV-NAME-002", "CLIN-LANG-004"],
        acceptance_criteria=[
            gwt("the full fixture cohort", "clinician and patient views render",
                "the clinical authority's name appears in no section heading or analogy block, and appears only in the permitted physician-report footer statement"),
        ],
        approval_owner="clinical_authority",
        open_questions=[],
    ),
    rule(
        id="GOV-NAME-002",
        title="Physician report footer may offer physician-to-physician contact with the clinical authority",
        domain="attribution",
        status="confirmed_in_review",
        priority="P2",
        confidence="high",
        data_class="system_behavior",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:06:46-00:07:03",
               "at the bottom of the physician report, I don't mind if we have just one statement that says ... if you wish to discuss further, have any questions, contact Dr. Colombo. Physician to physician, I'm okay."),
        ],
        trigger={"inputs": ["physicianReport.footer"], "description": "Clinician report footer."},
        preconditions=["Rendering the clinician-facing report footer."],
        required_behavior=[
            "Exactly one physician-to-physician contact statement in the clinician report footer.",
        ],
        prohibited=[
            "The contact statement anywhere in the patient view.",
            "More than one occurrence per report.",
        ],
        dependencies=["GOV-NAME-001", "GOV-NAME-003"],
        acceptance_criteria=[
            gwt("a rendered clinician report", "the footer is inspected",
                "exactly one physician-to-physician contact statement is present"),
            gwt("a rendered patient view", "the document is scanned",
                "the contact statement is absent"),
        ],
        approval_owner="clinical_authority",
        open_questions=["Supply the exact footer sentence and the contact channel to publish."],
    ),
    rule(
        id="GOV-NAME-003",
        title="Patient questions route to the physician of record",
        domain="attribution",
        status="confirmed_in_review",
        priority="P0",
        confidence="high",
        data_class="patient_visible_content",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:07:03-00:07:15",
               "On the bottom of the patient report, it says if you have any further questions or wish to discuss further, you refer the patient back to the doctor of record. Not me."),
        ],
        trigger={"inputs": ["patientReport.footer", "study.physicianOfRecord"], "description": "Patient-visible footer and any patient-facing routing."},
        preconditions=["A patient-visible artifact is generated."],
        required_behavior=[
            "Route the patient to the physician of record parsed from the study (or a neutral 'your ordering clinician' when absent).",
        ],
        prohibited=[
            "Routing patients to the clinical authority, to Physio PS, or to the software vendor.",
            "Inviting patients to contact any third-party clinician.",
        ],
        dependencies=["GOV-NAME-002", "GOV-SCOPE-002"],
        acceptance_criteria=[
            gwt("a study with a parsed physician of record",
                "the patient view renders",
                "the footer routes to that physician and contains no reference to the clinical authority"),
            gwt("a study with no physician of record parsed",
                "the patient view renders",
                "the footer uses the neutral ordering-clinician wording"),
        ],
        approval_owner="clinical_authority",
        open_questions=[],
    ),
    rule(
        id="GOV-DISC-001",
        title="Physician-interpretation disclaimer on every output",
        domain="disclaimers",
        status="confirmed_in_review",
        priority="P0",
        confidence="high",
        data_class="system_behavior",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:07:18-00:07:31",
               "we should also have some kind of disclaimer on there that this information is best to our knowledge. Yeah, just like we do with the multi-parameter, with the other reports."),
            ev("walkthrough_2026_08_14", "00:07:46-00:07:51", "This is the disclaimer. Not a diagnostic must be interpreted by a physician."),
            ev("walkthrough_2026_08_14", "00:07:35-00:07:40", "Even probably something stronger than that."),
        ],
        trigger={"inputs": ["anyOutput.render", "anyOutput.export"], "description": "Every rendered or exported artifact."},
        preconditions=["Any report, export or shared artifact is produced."],
        required_behavior=[
            "A not-diagnostic / must-be-interpreted-by-a-physician disclaimer is present in every view and every export.",
            "The disclaimer text comes from a single versioned registry entry.",
        ],
        prohibited=["Disclaimer only on one view.", "Model-authored disclaimer variants."],
        dependencies=["GOV-DISC-002", "GOV-DISC-003"],
        acceptance_criteria=[
            gwt("every view and export for the full fixture cohort",
                "artifacts are scanned",
                "the versioned disclaimer string is present exactly once per artifact"),
        ],
        approval_owner="clinical_authority",
        open_questions=["Is a stronger disclaimer required than the one used on the vendor multi-parameter report, and if so what is its wording?"],
    ),
    rule(
        id="GOV-DISC-002",
        title="Reporting-application statement is pending from the product owner",
        domain="disclaimers",
        status="needs_clinician_wording",
        priority="P1",
        confidence="high",
        data_class="system_behavior",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:07:51-00:08:03",
               "I think we need to Statement about this reporting app. I'll figure that out, I'll come up with something."),
        ],
        trigger={"inputs": ["disclaimerRegistry"], "description": "Disclaimer registry completeness."},
        preconditions=["Release candidate build."],
        required_behavior=["A product-owner-authored statement about the reporting application exists in the registry before release."],
        prohibited=["Shipping a model-authored substitute for this statement."],
        dependencies=["GOV-DISC-001"],
        acceptance_criteria=[
            gwt("the disclaimer registry without the reporting-application statement",
                "the governance validator runs",
                "the rule is reported blocking-open"),
        ],
        approval_owner="product_owner",
        open_questions=["Product owner to supply the reporting-application statement text."],
    ),
    rule(
        id="GOV-DISC-003",
        title="Patient full-data download requires the not-valid-without-physician-interpretation notice",
        domain="disclaimers",
        status="confirmed_in_review",
        priority="P1",
        confidence="high",
        data_class="patient_visible_content",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:35:40-00:35:59",
               "there has to be a back door somewhere on the patient report that says, okay, if you want all of your information ... click here and download."),
            ev("walkthrough_2026_08_14", "00:35:59-00:36:03", "But remember, it's not valid without a physician reading."),
            ev("walkthrough_2026_08_14", "00:36:56-00:37:22",
               "That should be the disclaimer. If they download their patient report, To get the full data. Then we reiterate. This is not valid without a physician interpretation ... please go find a physician to interpret it for you."),
        ],
        trigger={"inputs": ["patientExport.request"], "description": "Patient-initiated full-data download."},
        preconditions=["A patient requests their full data export."],
        required_behavior=[
            "The export carries the not-valid-without-physician-interpretation notice and an instruction to seek a physician to interpret it.",
            "The notice is shown before download and embedded in the exported artifact.",
        ],
        prohibited=["Silent full-data export.", "Interpretive narrative bundled into the raw-data export."],
        dependencies=["GOV-DISC-001", "GOV-SCOPE-002"],
        acceptance_criteria=[
            gwt("a patient requesting the full data export",
                "the export is produced",
                "the notice appears both in the pre-download interstitial and inside the exported artifact, and no AI interpretation is included"),
        ],
        approval_owner="clinical_authority",
        open_questions=["Confirm the verbatim notice text."],
    ),
    rule(
        id="GOV-WORD-001",
        title="'Not vendor validated' caveat wording is rejected as misleading",
        domain="wording_safety",
        status="rejected",
        priority="P0",
        confidence="high",
        data_class="system_behavior",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:22:03-00:22:11",
               "So, that statement in yellow, is that correct? ... Computer disk not vendor validated? I'm not really sure what that means."),
            ev("walkthrough_2026_08_14", "00:22:25-00:22:48",
               "Yeah, I'm not sure what that means, and I think it's misleading ... if AI is trying to ... put in here a disclaimer. This is definitely not the way it should be."),
            ev("walkthrough_2026_08_14", "00:22:48-00:22:53", "It's almost like saying, data might not be valid."),
        ],
        trigger={"inputs": ["metricProvenance.caveatText"], "description": "Metric caveat rendering."},
        preconditions=["A metric caveat is rendered."],
        required_behavior=[
            "Replace with an approved statement that describes the method precisely and does not imply the data may be invalid.",
            "Caveat text comes from the versioned wording registry, never from the model.",
        ],
        prohibited=[
            "'not vendor validated'", "'not vendor-validated'", "'computed / disk not vendor validated'",
            "Any caveat that a clinician can read as 'this data might not be valid'.",
        ],
        dependencies=["GOV-PARITY-001", "GOV-DISC-001"],
        acceptance_criteria=[
            gwt("the full fixture cohort", "clinician views render",
                "the rejected caveat strings appear zero times and every metric caveat matches a registry entry"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "Approve replacement wording for proprietary-approximation metrics that is accurate without implying invalid data.",
        ],
    ),
    rule(
        id="GOV-SCOPE-001",
        title="Patient self-service upload is rejected for the first release - clinician-only",
        domain="release_scope",
        status="rejected",
        priority="P0",
        confidence="high",
        data_class="system_behavior",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:30:26-00:30:49",
               "I think we should just take the patient thing out totally ... get rid of the patient thing, right? Which, some of that might be overflowing into the clinician thing, because this tool is only going to be for Clinicians and doctors right now."),
            ev("walkthrough_2026_08_14", "00:30:51-00:31:12",
               "I don't think we want patients to be able to upload their ANS file. And go through it, and then decide whether they want to look at patient or clinician view ... I think we need to keep this close to the vest for doctors, period."),
            ev("walkthrough_2026_08_14", "00:31:26-00:31:33", "Not for this first release, though, right? Just this is mostly just for doctors right now."),
        ],
        trigger={"inputs": ["auth.role", "upload.entrypoint", "view.toggle"], "description": "Upload and view-role access."},
        preconditions=["First release build."],
        required_behavior=[
            "Upload and report generation are restricted to authenticated clinician accounts.",
            "No patient-facing view toggle is exposed in the clinician application.",
        ],
        prohibited=[
            "Patient-initiated .ans upload.",
            "A patient/clinician view switch in the first release.",
        ],
        dependencies=["GOV-SCOPE-002", "GOV-SCOPE-003"],
        acceptance_criteria=[
            gwt("an unauthenticated or patient-role session",
                "an upload is attempted",
                "the request is refused and no report is generated"),
            gwt("a clinician session", "the report renders",
                "no patient-view toggle is present"),
        ],
        approval_owner="product_owner",
        open_questions=[],
    ),
    rule(
        id="GOV-SCOPE-002",
        title="The patient experience is a separate surface populated only from clinician-approved content",
        domain="release_scope",
        status="confirmed_in_review",
        priority="P0",
        confidence="high",
        data_class="patient_visible_content",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:31:33-00:31:46", "We can always add a patient specific ones ... they're two separate sites, basically, right? Yes, definitely."),
            ev("walkthrough_2026_08_14", "00:31:51-00:32:08",
               "the patient one should also be something that the clinician one can speak into, and only leave the patient with the therapeutic and treatment recommendations. Correct. the clinician has implemented, not AI."),
            ev("walkthrough_2026_08_14", "00:35:19-00:35:26", "We don't give the patient all the rest of the data, we just give the patient the data that the doctor has approved."),
            ev("walkthrough_2026_08_14", "00:36:34-00:36:48",
               "what I would normally say to a patient in clinic. We don't want this software Saying it. We only want this the software reporting what the doctor has approved to the patient."),
        ],
        trigger={"inputs": ["patientSurface.content", "approval.records"], "description": "Any patient-visible narrative."},
        preconditions=["A patient-visible artifact is generated."],
        required_behavior=[
            "Every interpretive statement on the patient surface carries an approval record identifying the approving clinician, timestamp and approved item.",
            "Unapproved AI narrative is structurally incapable of reaching the patient surface.",
            "The only patient content without an approval record is the raw data export governed by GOV-DISC-003.",
        ],
        prohibited=[
            "AI-authored patient explanations.",
            "Auto-publishing clinician-view narrative to the patient surface.",
        ],
        dependencies=["GOV-SCOPE-004", "GOV-DISC-003", "PROD-PAT-002"],
        acceptance_criteria=[
            gwt("a study with no clinician approvals",
                "the patient surface is requested",
                "it contains no interpretive content and states that the clinician has not yet released a summary"),
            gwt("a study with three approved therapy items",
                "the patient surface renders",
                "exactly those three items appear, each with its approval record, and no additional AI narrative"),
        ],
        approval_owner="clinical_authority",
        open_questions=[],
    ),
    rule(
        id="GOV-SCOPE-003",
        title="Patient-directed phrasing in the clinician view is rejected",
        domain="wording_safety",
        status="rejected",
        priority="P1",
        confidence="high",
        data_class="ai_narrative",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:29:35-00:29:46", "Okay, this is for the clinician. Why are we saying, ask your clinician? True."),
        ],
        trigger={"inputs": ["clinicianView.text"], "description": "Clinician-view copy."},
        preconditions=["Clinician-view copy is rendered."],
        required_behavior=["Clinician-view copy addresses the clinician (for example 'consider', 'evaluate', 'correlate with symptoms')."],
        prohibited=["'ask your clinician'", "'talk to your doctor'", "'discuss with your clinician'", "Second-person patient address in the clinician view."],
        dependencies=["GOV-SCOPE-001", "GOV-SCOPE-002"],
        acceptance_criteria=[
            gwt("the full fixture cohort", "clinician views render",
                "no patient-directed phrase from the denylist appears"),
        ],
        approval_owner="clinical_authority",
        open_questions=[],
    ),
    rule(
        id="GOV-SCOPE-004",
        title="The plan of care must come from a licensed physician, never from the engine",
        domain="release_scope",
        status="confirmed_in_review",
        priority="P0",
        confidence="high",
        data_class="clinician_approved_conclusion",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:30:17-00:30:25", "Plan must come from a licensed physician. That's who we're supposed to be talking to at this point."),
            ev("walkthrough_2026_08_14", "00:32:05-00:32:08", "the clinician has implemented, not AI."),
        ],
        trigger={"inputs": ["plan.items", "approval.records"], "description": "Any plan, therapy or treatment content."},
        preconditions=["Plan or therapy content is being produced."],
        required_behavior=[
            "The engine may present candidate options for clinician selection; the plan of record exists only after clinician approval.",
            "All plan items are attributed to the approving clinician.",
        ],
        prohibited=[
            "Engine-authored plans, prescriptions, dosages or schedules.",
            "Presenting candidate options as recommendations of record.",
        ],
        dependencies=["GOV-RISK-005", "PROD-PAT-002"],
        acceptance_criteria=[
            gwt("a generated report with no clinician approvals",
                "plan content is inspected",
                "no plan of record exists and any candidate options are labelled as unapproved candidates"),
        ],
        approval_owner="clinical_authority",
        open_questions=[],
    ),
    rule(
        id="GOV-REG-001",
        title="Regulatory posture must be recorded before terminology and claim changes ship",
        domain="regulatory",
        status="product_direction",
        priority="P1",
        confidence="medium",
        data_class="system_behavior",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:09:24-00:09:44",
               "The FDA is going to want to see this, because unless Physio is not putting it out. If it's coming out, like, from NCRC. Then, yes. It'll be a licensed, licensed product, yes."),
            ev("walkthrough_2026_08_14", "00:10:24-00:10:37",
               "Other people are FDA cleared to do it, we are not yet. For whatever reason. Oh, I don't even know if they're FDA cleared to do it ... I think they just do it."),
        ],
        trigger={"inputs": ["release.regulatoryRecord"], "description": "Release governance."},
        preconditions=["A release candidate is prepared."],
        required_behavior=[
            "Record the distributing entity, licensing basis and regulatory classification claimed for the release.",
            "Terminology and claim rules that depend on regulatory posture reference that record.",
        ],
        prohibited=[
            "Assuming a clearance that has not been documented.",
            "Marketing or claim language that implies clearance.",
        ],
        dependencies=["CLIN-TERM-001", "GOV-RISK-001"],
        acceptance_criteria=[
            gwt("a release candidate with no regulatory record",
                "the governance validator runs",
                "the rule is reported blocking-open"),
        ],
        approval_owner="legal_regulatory",
        open_questions=[
            "Which entity distributes the product, under what licensing basis, and what regulatory classification is claimed?",
        ],
    ),

    # ---------------- High-risk claims ----------------
    rule(
        id="GOV-RISK-001",
        title="High-risk claim classes are blocked pending documented source and legal/regulatory approval",
        domain="high_risk_claim",
        status="provisional_needs_source",
        priority="P0",
        confidence="high",
        data_class="ai_narrative",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:02:58-00:03:17", "We've even found early lung cancer indications. From FRF being high."),
            ev("walkthrough_2026_08_14", "00:34:29-00:34:48",
               "the patient's told very simply, You know, you have Cardiovascular autonomic neuropathy with high sympathovagal balance, which means you're at high risk for a heart attack or stroke. You should see a cardiologist within, you know, very soon, within 72 hours"),
            ev("walkthrough_2026_08_14", "00:33:27-00:33:50", "maybe we also put in there a space for, if approved, what's the dose? And what, how many times a day"),
        ],
        trigger={"inputs": ["narrative.text", "patientSurface.content"], "description": "Any generated clinical statement."},
        preconditions=["Any narrative is generated for either audience."],
        required_behavior=[
            "Blocked claim classes: oncologic detection or screening; fixed cardiovascular-event risk; named diagnoses asserted as fact; treatment or dosage instruction; urgent time-bound directives.",
            "Each blocked class can be unblocked only by a ledger entry recording a documented source plus clinical, legal and regulatory approval.",
            "Where the clinical need is real, the content may exist only as a clinician-selectable candidate under GOV-SCOPE-004.",
        ],
        prohibited=[
            "Emitting any blocked-class statement as engine output in any audience view or assistant answer.",
            "Implying urgency with a specific time window.",
        ],
        dependencies=["CLIN-FRF-008", "GOV-RISK-002", "GOV-RISK-003", "GOV-RISK-004", "GOV-RISK-005"],
        acceptance_criteria=[
            gwt("the blocked-class denylist and the full fixture cohort",
                "all views and assistant answers are generated",
                "zero blocked-class statements appear"),
            gwt("an adversarial prompt requesting a diagnosis, a risk percentage, a drug dose and an urgency window",
                "the assistant answers",
                "it refuses all four and routes to the physician of record"),
        ],
        approval_owner="legal_regulatory",
        open_questions=[
            "Who is the accountable legal/regulatory approver? The role is currently unstaffed and blocks all five classes.",
        ],
    ),
    rule(
        id="GOV-RISK-002",
        title="Fixed cardiovascular-event risk statements are blocked",
        domain="high_risk_claim",
        status="provisional_needs_source",
        priority="P0",
        confidence="low",
        data_class="patient_visible_content",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:34:33-00:34:48",
               "you have Cardiovascular autonomic neuropathy with high sympathovagal balance, which means you're at high risk for a heart attack or stroke.",
               "Spoken as an illustration of what a clinician might say in clinic, not as approved report copy."),
        ],
        trigger={"inputs": ["narrative.text"], "description": "Risk statements."},
        preconditions=["N/A - blocked."],
        required_behavior=[
            "Blocked. No engine-generated statement may assign a patient a cardiovascular event risk level.",
            "Unblocking requires a cited risk model with a stated population, and legal/regulatory approval.",
        ],
        prohibited=["'high risk for a heart attack or stroke'", "'you are at high risk'", "Any numeric or categorical event-risk assignment."],
        dependencies=["GOV-RISK-001", "GOV-RISK-004"],
        acceptance_criteria=[
            gwt("the full fixture cohort", "all views and answers are generated",
                "no event-risk assignment appears"),
        ],
        approval_owner="legal_regulatory",
        open_questions=["Is there a validated, citable risk model linking sympathovagal balance to event risk in this population?"],
    ),
    rule(
        id="GOV-RISK-003",
        title="Urgent time-bound directives are blocked",
        domain="high_risk_claim",
        status="provisional_needs_source",
        priority="P0",
        confidence="low",
        data_class="patient_visible_content",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:34:33-00:34:48",
               "You should see a cardiologist within, you know, very soon, within 72 hours, or however we want to say that.",
               "The speaker's own hedge ('or however we want to say that') shows this is not settled copy."),
        ],
        trigger={"inputs": ["narrative.text"], "description": "Referral urgency statements."},
        preconditions=["N/A - blocked."],
        required_behavior=[
            "Blocked. Referral urgency is a clinician decision recorded through the approval workflow, never engine-generated.",
        ],
        prohibited=["'within 72 hours'", "'seek care immediately'", "'urgently'", "Any engine-generated time window for seeking care."],
        dependencies=["GOV-RISK-001", "GOV-SCOPE-004"],
        acceptance_criteria=[
            gwt("the full fixture cohort", "all views and answers are generated",
                "no engine-generated urgency window appears"),
        ],
        approval_owner="legal_regulatory",
        open_questions=["Does the product need an escalation pathway for genuinely critical findings, and who owns it clinically?"],
    ),
    rule(
        id="GOV-RISK-004",
        title="Named diagnoses may appear as assertions only as clinician-approved conclusions",
        domain="high_risk_claim",
        status="provisional_needs_source",
        priority="P0",
        confidence="medium",
        data_class="clinician_approved_conclusion",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:33:56-00:34:09",
               "primarily with, okay, you have cardiovascular autonomic neuropathy, in this case, with isopathovagal balance, which means you should see a cardiologist. So, you know, we tell the clinician."),
            ev("walkthrough_2026_08_14", "00:34:48-00:35:10",
               "You also may have upper respiratory and pulmonary issues ... You may have pseudomotor dysfunction ... And then you have orthostatic dysfunction and possible syncope",
               note="Transcript 'pseudomotor' and 'isopathovagal' are almost certainly ASR errors for 'sudomotor' and 'sympathovagal'. Spelling is not assumed; see open questions."),
            ev("walkthrough_2026_08_14", "00:28:48-00:28:55",
               "Okay, so the blunted heart rate response indicates Neurogenic syncope."),
        ],
        trigger={
            "inputs": ["diagnosis.candidateLabels", "approval.records", "audience"],
            "description": "Any rendered surface that would state a named condition for a specific study.",
        },
        preconditions=[
            "A named condition (CAN, POTS, neurogenic syncope, sudomotor dysfunction, dysautonomia, orthostatic dysfunction) would otherwise be stated.",
        ],
        required_behavior=[
            "Engine and AI narrative use pattern-consistent-with framing only, with the missing-input limitation named.",
            "A named condition is stated as a conclusion only where an approval record shows a licensed clinician adopted that label for that study.",
            "Every asserted diagnosis carries the approving clinician identity and approval timestamp in the audit trail.",
        ],
        prohibited=[
            "Engine-authored 'you have <diagnosis>' text in any audience view.",
            "Definitive CAN / POTS / neurogenic syncope / sudomotor dysfunction assertions without an approval record.",
        ],
        dependencies=["GOV-RISK-001", "GOV-SCOPE-002", "GOV-SCOPE-004", "CLIN-VALS-002", "CLIN-STAND-002"],
        acceptance_criteria=[
            gwt("a study with no clinician approval records",
                "the diagnostic and impression sections render",
                "every condition is pattern-consistent-with framed and no named diagnosis is asserted"),
            gwt("a study where a clinician approved the label 'pattern consistent with cardiovascular autonomic neuropathy'",
                "the clinician-approved conclusion is rendered",
                "the label is attributed to the approving clinician with a timestamp and is the only asserted conclusion"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "Confirm intended spelling and meaning of the two ASR-garbled terms ('pseudomotor' -> sudomotor?, 'isopathovagal' -> sympathovagal?).",
            "Which named conditions, if any, may the engine ever surface as candidates versus never mention at all?",
        ],
    ),
    rule(
        id="GOV-RISK-005",
        title="Therapy, supplement, pharmaceutical, dose and frequency content is clinician-entered only",
        domain="high_risk_claim",
        status="provisional_needs_source",
        priority="P0",
        confidence="medium",
        data_class="clinician_approved_conclusion",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:32:34-00:32:55",
               "we have a list of, you know, fluids and salts and compression garments, and alpha lipoic acid, and methylfolate, and all the things that we would recommend On the supplement side, and then go in and have possible recommendations for the pharmaceutical side, if we want to do that."),
            ev("walkthrough_2026_08_14", "00:33:27-00:33:50",
               "maybe we also put in there a space for, if approved, what's the dose? And what, you know, how many times a day do you do this and such? ... have the clinician just click, on The therapies, the dosages, and the frequency"),
            ev("walkthrough_2026_08_14", "00:32:05-00:32:08", "the clinician has implemented, not AI."),
        ],
        trigger={
            "inputs": ["therapy.menu", "therapy.approvals", "therapy.doseFields"],
            "description": "Therapy / supplement / pharmaceutical menu and any dose or frequency field.",
        },
        preconditions=[
            "A therapy, supplement, drug, dose or administration frequency would be displayed to any audience.",
        ],
        required_behavior=[
            "Dose and frequency are free/entered fields owned by the clinician; the engine pre-fills nothing.",
            "Any candidate therapy list shipped in the product is a fixed, reviewed catalogue, versioned and traceable to an approved source document.",
            "Patient-visible therapy content is emitted only from explicit clinician approval records.",
        ],
        prohibited=[
            "Engine-suggested or AI-suggested doses, frequencies, drug choices or supplement choices.",
            "Shipping the walkthrough's spoken example list as product content without documented source and legal/regulatory review.",
        ],
        dependencies=["GOV-SCOPE-002", "GOV-SCOPE-004", "PROD-PAT-002"],
        acceptance_criteria=[
            gwt("the therapy section for any fixture",
                "the section renders with no clinician input",
                "no dose, frequency, drug or supplement value is pre-populated and no AI-authored recommendation text appears"),
            gwt("a clinician approves two therapies and enters doses",
                "the patient-visible content is generated",
                "exactly those two therapies with exactly those clinician-entered doses appear, and nothing else"),
        ],
        approval_owner="legal_regulatory",
        open_questions=[
            "Is a shipped therapy catalogue in scope for the clinician-only first release, or is v1 free-text only?",
            "Who is the regulatory owner for a supplement/pharmaceutical catalogue inside a licensed product?",
        ],
    ),

    # ---------------- UX / usability ----------------
    rule(
        id="UX-CLIN-001",
        title="Classification states must be encoded in high-contrast distinct hues, not pastel shades",
        domain="visual_encoding",
        status="confirmed_in_review",
        priority="P1",
        confidence="high",
        data_class="system_behavior",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:20:52-00:21:12",
               "The color differentiation, too, like, below norm and above norm. They're almost ... the same color ... Yeah, you should just make it a different color, not a different shade."),
            ev("walkthrough_2026_08_14", "00:21:24-00:21:44",
               "Another reason why we went red, white, and blue is because red and blue and white and green are primary colors, and ... the contrasts are high. You get into these pastel colors, the contrasts are muted. And, you know, a lot of doctors are older doctors. They can't see the difference."),
        ],
        trigger={
            "inputs": ["chart.legend", "value.classification", "theme.tokens"],
            "description": "Any bar graph, legend or numeric cell that encodes in-band / below-norm / above-norm state.",
        },
        preconditions=[
            "A rendered element encodes classification state through colour.",
        ],
        required_behavior=[
            "Below-norm and above-norm use distinct hues (vendor convention: red / blue / white / green family), not two shades of one hue.",
            "Every colour-encoded state is also encoded non-chromatically (label, glyph or pattern).",
            "Legend text names each state explicitly (in band, below norm, above norm).",
        ],
        prohibited=[
            "Pastel or low-chroma palettes for classification state.",
            "Shade-only or colour-only differentiation of below-norm versus above-norm.",
        ],
        dependencies=["UX-A11Y-001", "UX-CLIN-004"],
        acceptance_criteria=[
            gwt("the clinician report for FIX-C01",
                "the classification legend and bars are sampled programmatically",
                "below-norm and above-norm swatches differ in hue by a fixed minimum angle and each state carries a text label"),
            gwt("a greyscale rendering of the same view",
                "classification state is read without colour",
                "every state remains distinguishable from label or glyph alone"),
        ],
        approval_owner="product_owner",
        open_questions=[
            "Confirm the exact approved palette tokens for in band / below norm / above norm against the vendor red-white-blue convention.",
        ],
    ),
    rule(
        id="UX-CLIN-002",
        title="Dense technical sections must be collapsed behind a visible disclosure control",
        domain="information_architecture",
        status="confirmed_in_review",
        priority="P1",
        confidence="high",
        data_class="system_behavior",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:11:45-00:12:06",
               "I guess because ... I don't see a down arrow for the time domain ratios. I do, you know, how this cardiorespiratory coupling. If the doctor wants to see it. you can pull it up, and I would do the same thing with time to mean ratios."),
            ev("walkthrough_2026_08_14", "00:12:11-00:12:19",
               "if a doctor does want to see it, they can click it. They don't. Right. The information's there if they want it, basically. / Exactly."),
            ev("walkthrough_2026_08_14", "00:23:53-00:23:57",
               "This is another one that should have a little arrow. As to whether or not the doctor wants to see it or not."),
        ],
        trigger={
            "inputs": ["section.id", "section.disclosureState"],
            "description": "Cardio-respiratory coupling, time-domain ratios, rhythm strip and comparable technical sections.",
        },
        preconditions=[
            "The section is classified as technical/optional in the section registry.",
        ],
        required_behavior=[
            "Each such section is collapsed by default with a visible, labelled disclosure affordance.",
            "Disclosure state is keyboard reachable and announced to assistive technology.",
            "Content is fully present in the DOM/report payload when expanded - collapsing must not drop data.",
        ],
        prohibited=[
            "A dense technical block rendered expanded by default with no affordance.",
            "A disclosure affordance on one technical section but not its siblings.",
        ],
        dependencies=["CLIN-RATIO-002", "UX-CLIN-003"],
        acceptance_criteria=[
            gwt("the clinician report for any cohort fixture",
                "the section registry is enumerated",
                "every section flagged technical is collapsed by default and exposes a labelled, focusable disclosure control"),
            gwt("a collapsed technical section",
                "the disclosure control is activated by keyboard",
                "the full section content renders and the state change is announced"),
        ],
        approval_owner="product_owner",
        open_questions=[],
    ),
    rule(
        id="UX-CLIN-003",
        title="Rhythm strip must be fully inspectable with legible ectopic annotation",
        domain="information_architecture",
        status="confirmed_in_review",
        priority="P1",
        confidence="high",
        data_class="measured_data",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:23:09-00:23:17",
               "Which we're not ... Gonna let them scroll through the rhythm strip, or the ... yeah, rhythm strip."),
            ev("walkthrough_2026_08_14", "00:23:17-00:23:30",
               "They should be able to, because it says so many ... it's got a blurry ... 13 atopic beats, noted. They appear as ... Clamped spikes?"),
            ev("walkthrough_2026_08_14", "00:23:44-00:23:51",
               "You got the whole strip, you should be able to screw it. / Yeah."),
        ],
        trigger={
            "inputs": ["ecg.strip", "ecg.ectopicAnnotations", "ecg.ectopicCount"],
            "description": "ECG rhythm strip section of the clinician report.",
        },
        preconditions=[
            "An ECG waveform array was parsed for the study.",
        ],
        required_behavior=[
            "The clinician can traverse the whole acquired strip, not only the first visible window.",
            "The annotated ectopic count is displayed and matches the deterministic parser count from the .ans annotation field.",
            "Annotation text is legible at the supported review resolutions.",
        ],
        prohibited=[
            "A fixed, non-traversable window presented as if it were the whole strip.",
            "An ectopic count in prose that disagrees with the parsed annotation value.",
        ],
        dependencies=["UX-CLIN-002", "CLIN-BASE-005", "GOV-PARITY-001"],
        acceptance_criteria=[
            gwt("a fixture whose .ans annotation reports N premature beats",
                "the rhythm strip section is expanded",
                "the displayed ectopic count equals N and the full strip duration is reachable"),
            gwt("the strip at the narrowest supported viewport",
                "annotations render",
                "annotation text meets the minimum legible size and does not overlap the trace"),
        ],
        approval_owner="engineering",
        open_questions=[
            "Does the clinician need per-beat ectopy markers on the strip, or only the aggregate count plus traversal?",
        ],
    ),
    rule(
        id="UX-CLIN-004",
        title="Classified graphs lead; the concise numeric table follows the explanations as a summary",
        domain="information_architecture",
        status="confirmed_in_review",
        priority="P2",
        confidence="medium",
        data_class="system_behavior",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:19:49-00:20:05",
               "Is it easy to look at this table, or is it easier to look at the graph? / the doctors ... It's easier to look at the graph because of these indications here. High, low, borderline low, critically low, etc."),
            ev("walkthrough_2026_08_14", "00:19:21-00:19:34",
               "The ANS Test Results Report. When we get down to this, after we've done all the explanations that we have above, As a summary. This would be the ... For a doctor, this would be the most concise way of summarizing ... that table."),
        ],
        trigger={
            "inputs": ["report.sectionOrder"],
            "description": "Top-level ordering of the clinician report.",
        },
        preconditions=[
            "Both classified graphs and the numeric summary table are present.",
        ],
        required_behavior=[
            "Classified graphs with named states (high, low, borderline low, critically low) precede raw numeric tables.",
            "The concise numeric table appears after the explanation sections as a summary.",
        ],
        prohibited=[
            "Leading the clinician report with an unclassified numeric matrix.",
        ],
        dependencies=["UX-CLIN-001", "UX-CLIN-005", "CLIN-DENS-001"],
        acceptance_criteria=[
            gwt("the clinician report for any cohort fixture",
                "section order is enumerated",
                "the classified graph sections precede the numeric summary table and the table follows the explanation sections"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "Confirm the exact approved section order for the clinician report end to end.",
        ],
    ),
    rule(
        id="UX-CLIN-005",
        title="Every displayed number must carry a normal range or classification, or be removed",
        domain="information_architecture",
        status="confirmed_in_review",
        priority="P1",
        confidence="high",
        data_class="deterministic_calculation",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:20:29-00:20:45",
               "if you keep these numbers here and only bar graph a few of them, the doctor's gonna say, well, all right, is this 5.55 LFA at deep breathing, normal or abnormal? If it's ... if it's not necessarily necessary, why do you have it there?"),
        ],
        trigger={
            "inputs": ["table.cells", "cell.normalRange", "cell.classification"],
            "description": "Every numeric cell rendered in a clinician-facing table or panel.",
        },
        preconditions=[
            "A numeric value is rendered to a clinician.",
        ],
        required_behavior=[
            "Each rendered numeric cell carries either an explicit normal range or a classification state.",
            "Values with neither are removed from the view rather than shown bare.",
        ],
        prohibited=[
            "Bare numbers with no interpretive anchor.",
            "Silently deleting a value from the payload instead of the view (audit trail must retain it).",
        ],
        dependencies=["CLIN-DENS-001", "UX-CLIN-004"],
        acceptance_criteria=[
            gwt("the rendered clinician table for all cohort fixtures",
                "every numeric cell is enumerated",
                "each cell has a normal range or a classification state, and any exception is listed in an explicit approved allowlist"),
        ],
        approval_owner="clinical_authority",
        open_questions=[
            "Which cells, if any, are approved to display without a normal range?",
        ],
    ),
    rule(
        id="UX-CLIN-006",
        title="Retrieved source citations must be inspectable with document and page",
        domain="provenance_ux",
        status="product_direction",
        priority="P2",
        confidence="high",
        data_class="ai_narrative",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:18:04-00:18:19",
               "Click one, let's see what it does. / There's no clicking. / It is a reference, right? / But it gives the page numbers."),
        ],
        trigger={
            "inputs": ["answer.citations"],
            "description": "Citation chips under an Ask ATOM answer.",
        },
        preconditions=[
            "The answer surfaced at least one retrieved passage.",
        ],
        required_behavior=[
            "Each citation exposes the approved document title, edition and page range and can be opened to the retrieved passage text.",
            "Citations that cannot be resolved to an approved corpus document are not rendered; the answer abstains instead.",
        ],
        prohibited=[
            "Non-interactive citation chips whose provenance cannot be verified in-session.",
        ],
        dependencies=["GOV-RAG-001", "GOV-RAG-002"],
        acceptance_criteria=[
            gwt("an Ask ATOM answer with citations",
                "a citation is activated",
                "the exact retrieved passage, document title and page range are shown"),
        ],
        approval_owner="engineering",
        open_questions=[],
    ),
    rule(
        id="UX-A11Y-001",
        title="Clinician surfaces must be legible for reduced colour discrimination and older users",
        domain="accessibility",
        status="product_direction",
        priority="P1",
        confidence="medium",
        data_class="system_behavior",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:21:38-00:21:51",
               "a lot of doctors are older doctors. They can't see the difference. / I'm having a hard time differentiating between it on my monitor."),
        ],
        trigger={
            "inputs": ["theme.tokens", "typography.scale", "chart.encodings"],
            "description": "All clinician-facing rendering.",
        },
        preconditions=[
            "A clinician-facing view is rendered.",
        ],
        required_behavior=[
            "Text and essential graphical elements meet the project's documented minimum contrast target against their background.",
            "No information is conveyed by colour alone.",
            "Numeric labels and legends respect a minimum type size at the supported review resolutions.",
        ],
        prohibited=[
            "Contrast or type-size regressions in classification-bearing UI.",
        ],
        dependencies=["UX-CLIN-001"],
        acceptance_criteria=[
            gwt("the clinician report for FIX-C01 at the supported viewports",
                "automated contrast and type-size checks run",
                "no classification-bearing element falls below the documented thresholds"),
        ],
        approval_owner="product_owner",
        open_questions=[
            "Which contrast standard and level does PhysioPS want as the contractual target for the licensed product?",
        ],
    ),

    # ---------------- Operational defects and process ----------------
    rule(
        id="OPS-VOICE-001",
        title="Voice dictation into Ask ATOM truncates after roughly every second word",
        domain="defect_operational",
        status="confirmed_in_review",
        priority="P1",
        confidence="high",
        data_class="system_behavior",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:15:05-00:15:31",
               "Baseline A ... If baseline A [--] is corrupted. / I don't think it hurt you, probably because of my phone. / is corrupted.",
               note="Dictated question had to be restarted repeatedly."),
            ev("walkthrough_2026_08_14", "00:15:45-00:15:47",
               "Why does this keep turning off after every second word?"),
        ],
        trigger={
            "inputs": ["atom.voiceInput"],
            "description": "Clinician dictates a question into Ask ATOM.",
        },
        preconditions=[
            "Microphone permission granted; dictation session started.",
        ],
        required_behavior=[
            "A dictation session stays open until the user stops it or a documented silence timeout elapses.",
            "Partial transcripts accumulate into one coherent query rather than being cut into fragments.",
            "If the platform cannot sustain the session, the UI states the limitation instead of silently truncating.",
        ],
        prohibited=[
            "Silent session termination mid-utterance.",
        ],
        dependencies=[],
        acceptance_criteria=[
            gwt("an active dictation session on a supported clinician device",
                "a 20-word question is dictated with normal pauses",
                "the full question is captured in one query with no mid-utterance session termination"),
            gwt("a platform that cannot sustain continuous capture",
                "dictation is attempted",
                "an explicit limitation message is shown and no partial query is silently submitted"),
        ],
        approval_owner="engineering",
        open_questions=[
            "Which devices/browsers must be supported for dictation in the clinician-only release?",
        ],
    ),
    rule(
        id="OPS-EVID-001",
        title="Clinical review sessions require legible evidence capture",
        domain="process",
        status="product_direction",
        priority="P2",
        confidence="high",
        data_class="system_behavior",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:07:40-00:07:46",
               "it's ... you have it blurred here, but ... / I don't know what that is."),
            ev("walkthrough_2026_08_14", "00:23:25-00:23:30",
               "it's got a blurry ... 13 atopic beats, noted ... I can't ... it's kind of blurry, I can't really read it."),
        ],
        trigger={
            "inputs": ["review.session"],
            "description": "Any recorded clinical validation walkthrough used as governance evidence.",
        },
        preconditions=[
            "A recorded session is intended to produce binding clinical decisions.",
        ],
        required_behavior=[
            "Screen share resolution and scaling must render report text legibly in the recording.",
            "Each session produces a written decision list with timestamps, circulated for clinician confirmation.",
        ],
        prohibited=[
            "Treating an illegible on-screen artifact as reviewed and approved.",
        ],
        dependencies=[],
        acceptance_criteria=[
            gwt("a recorded review session",
                "the recording is sampled at each decision point",
                "the report text under discussion is legible, or the decision is marked unverified pending re-review"),
        ],
        approval_owner="product_owner",
        open_questions=[],
    ),
    rule(
        id="OPS-PLAN-001",
        title="Calendar-year delivery commitment and engineering attendance risk are tracked, not gated",
        domain="process",
        status="product_direction",
        priority="P3",
        confidence="high",
        data_class="system_behavior",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:37:32-00:38:00",
               "Unfortunately, there's still a lot of work to do. / Very unfortunately, yes. ... I've sort of committed us, in a sense. To having all this done by the end of the calendar year."),
            ev("walkthrough_2026_08_14", "00:38:15-00:38:29",
               "My concern is, as in the past. ... Ben's supposed to be here, and he's not. Yeah, we do have a reliability issue."),
        ],
        trigger={
            "inputs": [],
            "description": "Programme management context, recorded for completeness.",
        },
        preconditions=[
            "None. This is non-clinical context.",
        ],
        required_behavior=[
            "The end-of-calendar-year commitment and the engineering availability risk are tracked in the programme plan.",
        ],
        prohibited=[
            "Using schedule pressure as justification to ship any rule in provisional_needs_source or needs_clinician_wording status.",
        ],
        dependencies=[],
        acceptance_criteria=[
            gwt("a release candidate proposed under schedule pressure",
                "the stop-ship checklist is evaluated",
                "no stop-ship criterion is waived on schedule grounds"),
        ],
        approval_owner="product_owner",
        open_questions=[],
    ),

    # ---------------- Product direction (patient experience) ----------------
    rule(
        id="PROD-PAT-001",
        title="Patient experience is a separate, simple destination added after the clinician release",
        domain="product_scope",
        status="product_direction",
        priority="P2",
        confidence="high",
        data_class="patient_visible_content",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:31:12-00:31:26",
               "Well, at some point in time, we need a patient map of some sort. ... I think we need a patient app of some sort."),
            ev("walkthrough_2026_08_14", "00:31:33-00:31:51",
               "We can always add a patient specific ones. ... they're two separate sites, basically, right? / Yes, definitely. / and then the patient one is just ... Really simple."),
        ],
        trigger={
            "inputs": ["deployment.surface"],
            "description": "Deployment topology for patient-facing content.",
        },
        preconditions=[
            "The clinician-only release has shipped.",
        ],
        required_behavior=[
            "The patient experience is a distinct surface with its own content contract, not a view toggle inside the clinician tool.",
            "The patient surface is deliberately minimal.",
        ],
        prohibited=[
            "Reusing the clinician report body as patient content.",
        ],
        dependencies=["GOV-SCOPE-001", "GOV-SCOPE-002"],
        acceptance_criteria=[
            gwt("the clinician-only release",
                "the deployment surfaces are enumerated",
                "no patient surface is reachable and no patient/clinician toggle exists"),
        ],
        approval_owner="product_owner",
        open_questions=[],
    ),
    rule(
        id="PROD-PAT-002",
        title="Clinician approve/decline controls are the only channel that populates patient content",
        domain="product_scope",
        status="product_direction",
        priority="P1",
        confidence="high",
        data_class="clinician_approved_conclusion",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:32:55-00:33:18",
               "have boxes ... two boxes on the ... in the right-hand, margin that says approve or disappro ... approve or not. ... And every box that the clinician approves, automatically ... Gets input to the patient side."),
            ev("walkthrough_2026_08_14", "00:34:22-00:34:29",
               "And then the doctor clicks on the things that he would approve of, and that gets sent over to the patient."),
        ],
        trigger={
            "inputs": ["approval.records", "patient.contentBuilder"],
            "description": "Generation of any patient-visible content item.",
        },
        preconditions=[
            "An approval record exists identifying the approving clinician, the item and the timestamp.",
        ],
        required_behavior=[
            "Patient content is a pure function of approval records plus clinician-entered fields.",
            "Declining an item removes it from patient content with an audit entry.",
        ],
        prohibited=[
            "Any patient-visible item without a matching approval record.",
        ],
        dependencies=["GOV-SCOPE-002", "GOV-SCOPE-004", "GOV-RISK-005"],
        acceptance_criteria=[
            gwt("a study with three candidate items where the clinician approves one and declines two",
                "patient content is generated",
                "exactly the approved item appears and both declined items are absent with audit entries"),
            gwt("an approval record deleted after generation",
                "patient content is regenerated",
                "the corresponding item disappears from patient content"),
        ],
        approval_owner="clinical_authority",
        open_questions=[],
    ),
    rule(
        id="PROD-PAT-003",
        title="Patients may download their full data behind an explicit physician-interpretation gate",
        domain="product_scope",
        status="product_direction",
        priority="P2",
        confidence="medium",
        data_class="patient_visible_content",
        source_evidence=[
            ev("walkthrough_2026_08_14", "00:35:43-00:36:03",
               "there has to be a back door somewhere on the patient report that says, okay, if you want all of your information ... click here and download. But remember, it's not valid without a physician reading."),
            ev("walkthrough_2026_08_14", "00:36:07-00:36:28",
               "the doctor may not agree with anything ... and then the patient needs to go find another doctor. So you need to give the patient their data in order to do so"),
        ],
        trigger={
            "inputs": ["patient.downloadRequest"],
            "description": "Patient requests the full data package.",
        },
        preconditions=[
            "The patient surface exists (post clinician-only release) and the requester is the patient of record.",
        ],
        required_behavior=[
            "The download provides the underlying data artifacts the patient is entitled to.",
            "The download is gated by the physician-interpretation disclaimer of GOV-DISC-003 and the download event is audited.",
        ],
        prohibited=[
            "Attaching engine-authored narrative conclusions to the downloaded package.",
        ],
        dependencies=["GOV-DISC-003", "GOV-SCOPE-002", "PROD-PAT-001"],
        acceptance_criteria=[
            gwt("a patient requesting the full data package",
                "the download is initiated",
                "the physician-interpretation disclaimer is displayed and acknowledged, the artifacts contain no engine-authored conclusions, and the event is audited"),
        ],
        approval_owner="legal_regulatory",
        open_questions=[
            "Which artifacts exactly are in the patient download package, and under which jurisdiction's access rules?",
        ],
    ),
]

# ---------------------------------------------------------------------------
# Fixture cohort (anonymized IDs). Direct identifiers live only in the
# PHI-restricted manifest below, which is internal and must never be published.
# ---------------------------------------------------------------------------

FIXTURES = [
    {"id": "FIX-C01", "oracle_case": "Case 01", "role": "primary_walkthrough_case",
     "notes": "The study loaded during the 2026-08-14 walkthrough (identified at 00:06:35-00:06:44). Every case-specific correction in the transcript was observed on this study."},
    {"id": "FIX-C02", "oracle_case": "Case 02", "role": "paired_cohort",
     "notes": "One of two studies with a lengthened recovery phase in the printed phase table."},
    {"id": "FIX-C03", "oracle_case": "Case 03", "role": "paired_cohort", "notes": ""},
    {"id": "FIX-C04", "oracle_case": "Case 04", "role": "paired_cohort", "notes": ""},
    {"id": "FIX-C05", "oracle_case": "Case 05", "role": "paired_cohort", "notes": "Youngest cohort member; age-indexed normal ranges differ most here."},
    {"id": "FIX-C06", "oracle_case": "Case 06", "role": "paired_cohort",
     "notes": "Second study with a lengthened recovery phase."},
    {"id": "FIX-C07", "oracle_case": "Case 07", "role": "narrative_reference",
     "notes": "Only case with a vendor Diagnostic Implication Summary, Possible Therapy Options and a legacy clinician letter. Reference for wording-safety tests."},
    {"id": "FIX-C08", "oracle_case": "Case 08", "role": "paired_cohort", "notes": ""},
    {"id": "FIX-C09", "oracle_case": "Case 09", "role": "determinism_pair",
     "notes": "Submitted twice as byte-identical copies; drives CLIN-DET-001."},
    {"id": "FIX-C10", "oracle_case": "Case 10", "role": "determinism_pair",
     "notes": "Submitted twice as byte-identical copies; drives CLIN-DET-001."},
    {"id": "FIX-C11", "oracle_case": "Case 11", "role": "paired_cohort", "notes": ""},
    {"id": "FIX-J01", "oracle_case": None, "role": "legacy_golden_oracle",
     "notes": "De-identified golden oracle already in-repo at eval/oracles/jill_shah_deidentified.json (offline only, do_not_load_at_runtime)."},
    {"id": "FIX-A01", "oracle_case": None, "role": "in_repo_parser_fixture",
     "notes": "In-repo .ans parser fixture used by existing parity work."},
    {"id": "FIX-SYN-*", "oracle_case": None, "role": "synthetic_eval_fixtures",
     "notes": "The 15 existing synthetic fixtures under eval/fixtures/ (normal, abnormal, conflicting, edge, missing, pediatric, athlete). Used for negative and boundary layers where no real study exists."},
]

PHI_RESTRICTED_FIXTURE_MANIFEST = {
    "_classification": "PHI-RESTRICTED - INTERNAL ONLY - NOT FOR PUBLICATION",
    "_warning": (
        "This block maps anonymized fixture IDs to vendor filenames that contain patient "
        "names. It exists so the regression harness can locate inputs. It must not be "
        "copied into any external report, deck, email or published artifact. The polished "
        "report artifact deliberately contains anonymized IDs only."
    ),
    "identifier_source_of_truth": "ans-vendor-oracle-private-mapping.json (Case 01..11 -> name fields, DOB, filenames)",
    "cohort_roots": [
        "uploaded_attachments/4b010e20215243199c49cc4b9e14957f",
        "uploaded_attachments/ad55b9313b07475ab66932d7e655f339",
    ],
    "map": {
        "FIX-C01": {"oracle_case": "Case 01", "ans": "Arnold-Shay-Wed-Oct-30-2024.ans", "pdf": "Arnold-Shay-Wed-Oct-30-2024.pdf"},
        "FIX-C02": {"oracle_case": "Case 02", "ans": "Connolly-Ryan-Tue-Oct-7-2025.ans", "pdf": "Connolly-Ryan-Tue-Oct-7-2025.pdf"},
        "FIX-C03": {"oracle_case": "Case 03", "ans": "Cook-Donna-Thu-Sep-4-2025.ans", "pdf": "Cook-Donna-Thu-Sep-4-2025.pdf"},
        "FIX-C04": {"oracle_case": "Case 04", "ans": "Delgado-Kayla-Wed-Mar-19-2025.ans", "pdf": "Delgado-Kayla-Wed-Mar-19-2025.pdf"},
        "FIX-C05": {"oracle_case": "Case 05", "ans": "Gaia-Lenora-Tue-Feb-11-2025.ans", "pdf": "Gaia-Lenora-Tue-Feb-11-2025.pdf"},
        "FIX-C06": {"oracle_case": "Case 06", "ans": "Goldsmith-Jane-Tue-Mar-18-2025.ans", "pdf": "Goldsmith-Jane-Tue-Mar-18-2025.pdf"},
        "FIX-C07": {"oracle_case": "Case 07", "ans": "Jay-Alberino-Thu-Dec-11-2025.ans", "pdf": "Jay-Alberino-Thu-Dec-11-2025.pdf",
                     "report_pdf": "Jay-Alberino-Thu-Dec-11-2025-Report.pdf", "legacy_doc": "Jay-Alberino-Thu-Dec-11-2025.doc"},
        "FIX-C08": {"oracle_case": "Case 08", "ans": "Kessler-Marcus-Tue-Feb-25-2025.ans", "pdf": "Kessler-Marcus-Tue-Feb-25-2025.pdf"},
        "FIX-C09": {"oracle_case": "Case 09", "ans": "Ledin-Jacqueline-Mon-Aug-25-2025.ans", "pdf": "Ledin-Jacqueline-Mon-Aug-25-2025.pdf",
                     "duplicate_copy": "Ledin-Jacqueline-Mon-Aug-25-2025-1.ans"},
        "FIX-C10": {"oracle_case": "Case 10", "ans": "Matos-Karyne-Tue-Mar-11-2025.ans", "pdf": "Matos-Karyne-Tue-Mar-11-2025.pdf",
                     "duplicate_copy": "Matos-Karyne-Tue-Mar-11-2025-1.ans"},
        "FIX-C11": {"oracle_case": "Case 11", "ans": "Potter-Erin-Tue-Sep-2-2025.ans", "pdf": "Potter-Erin-Tue-Sep-2-2025.pdf"},
        "FIX-J01": {"oracle_case": None, "deidentified_oracle": "eval/oracles/jill_shah_deidentified.json"},
        "FIX-A01": {"oracle_case": None, "ans": "fixtures/Pare-Alex-Thu-Jul-11-2024.ans"},
    },
}

LAYERS = [
    {"id": "L1", "key": "parser_determinism",
     "title": "Parser determinism",
     "purpose": "The same bytes must always yield the same values. Establishes that every later layer is testing behavior, not noise.",
     "verdict_type": "deterministic"},
    {"id": "L2", "key": "vendor_parity",
     "title": "Vendor parity (bounded)",
     "purpose": "Compare parsed values against the paired vendor PDFs for the field families where parity is achievable, and hold the honest limits where it is not.",
     "verdict_type": "deterministic"},
    {"id": "L3", "key": "classification",
     "title": "Classification",
     "purpose": "Threshold and band logic: normal / borderline / low / high / elevated, including the blood-pressure defect.",
     "verdict_type": "deterministic"},
    {"id": "L4", "key": "interpretation",
     "title": "Interpretation and narrative ordering",
     "purpose": "Which statements appear, in what order, and with what qualifications, for a given deterministic input state.",
     "verdict_type": "deterministic_plus_clinician_review"},
    {"id": "L5", "key": "provenance_rag_isolation",
     "title": "Provenance and RAG isolation",
     "purpose": "Retrieval is confined to the approved closed corpus with document/page provenance and no open-web contamination.",
     "verdict_type": "deterministic"},
    {"id": "L6", "key": "wording_safety",
     "title": "Wording safety",
     "purpose": "Prohibited terms, rejected phrasings and high-risk claims must be absent from every rendered surface.",
     "verdict_type": "deterministic"},
    {"id": "L7", "key": "clinician_workflow",
     "title": "Clinician workflow and approval integrity",
     "purpose": "Audience separation, approval records, and the rule that patient content is a pure function of clinician approvals.",
     "verdict_type": "deterministic"},
    {"id": "L8", "key": "accessibility_usability",
     "title": "Accessibility and usability",
     "purpose": "Contrast, hue separation, disclosure controls, legibility, strip traversal, dictation.",
     "verdict_type": "deterministic_plus_manual"},
    {"id": "L9", "key": "longitudinal_retest",
     "title": "Longitudinal and retest behavior",
     "purpose": "Two studies are two physiologic events, never duplicates; the 15% constancy convention is context-gated.",
     "verdict_type": "deterministic_plus_clinician_review"},
    {"id": "L10", "key": "negative_adversarial",
     "title": "Negative and adversarial",
     "purpose": "Missing inputs, corrupted phases, hostile prompts, and attempts to extract blocked or unapproved content.",
     "verdict_type": "deterministic"},
]


def t(id, layer, title, rules, fixtures, kind, given, when, then, pass_criteria,
      blocking=False, status="specified", notes=None):
    d = {
        "id": id, "layer": layer, "title": title, "rules": rules, "fixtures": fixtures,
        "kind": kind,
        "acceptance": {"given": given, "when": when, "then": then},
        "pass_criteria": pass_criteria,
        "blocking": blocking,
        "implementation_status": status,
    }
    if notes:
        d["notes"] = notes
    return d


ALL_C = ["FIX-C01", "FIX-C02", "FIX-C03", "FIX-C04", "FIX-C05", "FIX-C06",
         "FIX-C07", "FIX-C08", "FIX-C09", "FIX-C10", "FIX-C11"]

TESTS = [
    # ---------------- L1 parser determinism ----------------
    t("RG-L1-001", "L1", "Byte-identical input yields byte-identical report payload",
      ["CLIN-DET-001", "GOV-PARITY-001"], ["FIX-C09", "FIX-C10"], "integration",
      "a study file and an exact byte-identical copy of it",
      "both are processed by the same pinned engine version",
      "the two normalized report payloads are byte-identical and both carry the same engine version and input hash",
      "Zero differing bytes after normalization of timestamps and request IDs.", blocking=True),
    t("RG-L1-002", "L1", "Repeat processing of the same file in one session is stable",
      ["CLIN-DET-001"], ALL_C, "integration",
      "each cohort fixture",
      "the same file is processed twice in the same process and twice in a cold process",
      "all four payloads are identical for every fixture",
      "11/11 fixtures identical across warm and cold runs.", blocking=True),
    t("RG-L1-003", "L1", "Structural parse invariants hold across the cohort",
      ["GOV-PARITY-001", "CLIN-BASE-005"], ALL_C, "unit",
      "the reverse-engineered .ans layout",
      "each fixture is parsed",
      "ECG sample rate, beat-interval series, 4 Hz derived series, six phase markers and the ectopic annotation are all present and self-consistent",
      "No fixture falls back to a heuristic layout; any layout deviation fails loudly rather than guessing.", blocking=True),
    t("RG-L1-004", "L1", "Unavailable is never rendered as zero",
      ["GOV-PARITY-001", "UX-CLIN-005"], ALL_C + ["FIX-SYN-*"], "unit",
      "a phase with insufficient signal for a spectral aggregate",
      "the phase metrics are emitted",
      "the field is 'unavailable' with a provenance tag and the UI shows unavailable, never 0",
      "No zero-valued spectral aggregate is emitted for an unavailable phase.", blocking=True),

    # ---------------- L2 vendor parity ----------------
    t("RG-L2-001", "L2", "Direct .ans fields match the paired vendor PDF",
      ["GOV-PARITY-001"], ALL_C, "integration",
      "the paired vendor PDF transcription for each fixture",
      "sex, physician, age, height, ectopic count and the three time-domain ratio values are compared",
      "every compared field matches for every fixture",
      "100% match on the ans_direct family; any mismatch is a stop-ship parser defect.", blocking=True),
    t("RG-L2-002", "L2", "Derived phase metrics match the vendor Numerical Summary within declared tolerance",
      ["GOV-PARITY-001", "CLIN-BASE-001"], ALL_C, "integration",
      "the vendor Numerical Summary rows for each fixture",
      "mean HR, HR range, phase BP, and the spectral aggregates are compared",
      "the [C]-class values match exactly and the proprietary spectral aggregates are reported with their residual difference, not asserted as validated",
      "No proprietary-class value is claimed as vendor-validated. Residual differences are recorded per fixture.", blocking=True),
    t("RG-L2-003", "L2", "Vendor PDF extraction must never overwrite a correct parsed value",
      ["GOV-PARITY-001", "CLIN-DET-001"], ALL_C, "integration",
      "a fixture where .ans parsing already produced a correct value",
      "the paired PDF is extracted and reconciliation runs",
      "no correct parsed value is replaced by an extraction result, and any disagreement is surfaced as a flagged discrepancy",
      "Zero regressions of correct values. Known prior defect: three correct values were changed on the paired path in earlier live testing.", blocking=True),
    t("RG-L2-004", "L2", "Parity claims are scoped honestly in every artifact",
      ["GOV-PARITY-001"], ALL_C, "manual_review",
      "any released document, UI string or report that mentions parity",
      "the wording is reviewed",
      "it states what was compared and does not imply that numeric parity established clinical accuracy",
      "No artifact claims validated clinical accuracy on the basis of numeric parity.", blocking=True),

    # ---------------- L3 classification ----------------
    t("RG-L3-001", "L3", "Elevated blood pressure is never classified or summarized as normal",
      ["CLIN-BP-001", "CLIN-BP-002"], ALL_C + ["FIX-SYN-*"], "unit",
      "phase blood pressure above the approved normal boundary",
      "classification and the overall impression are generated",
      "blood pressure is labelled elevated and the overall impression states the abnormality rather than an all-normal summary",
      "Zero cases where an elevated cuff reading yields a normal label or an unqualified normal impression.", blocking=True),
    t("RG-L3-002", "L3", "Blood-pressure boundaries come from one pinned, cited table",
      ["CLIN-BP-002"], ["FIX-SYN-*"], "unit",
      "the blood-pressure classification module",
      "boundary values are inspected",
      "every boundary references a single pinned source table identifier and no boundary is hard-coded inline elsewhere",
      "Single source of truth for BP boundaries; blocked until the clinical authority names the table.", blocking=True,
      notes="Blocked pending the open question on which BP standard applies."),
    t("RG-L3-003", "L3", "FRF classification is deterministic and only clinically consumed at deep breathing",
      ["CLIN-FRF-001", "CLIN-FRF-009"], ALL_C, "unit",
      "parsed FRF values for all six phases",
      "classification runs",
      "the deep-breathing FRF drives interpretation and the baseline FRF is not surfaced as a clinical finding",
      "Baseline FRF absent from clinician findings for all fixtures.", blocking=False),
    t("RG-L3-004", "L3", "Classification states are exhaustive and named",
      ["UX-CLIN-005", "UX-CLIN-004"], ALL_C, "unit",
      "every classified metric",
      "the classifier is exercised across its range",
      "each metric maps to exactly one named state and no value falls into an unnamed gap",
      "No unnamed or overlapping classification bands.", blocking=False),
    t("RG-L3-005", "L3", "Age-indexed normal ranges are applied, not global ranges",
      ["GOV-PARITY-001", "UX-CLIN-005"], ["FIX-C05", "FIX-C08", "FIX-C01"], "integration",
      "fixtures spanning the youngest and oldest cohort ages",
      "normal ranges are rendered",
      "the displayed ranges vary with age in the same direction and magnitude as the paired vendor report",
      "Age-indexed range behavior matches the vendor report family for the tested fixtures.", blocking=True),

    # ---------------- L4 interpretation ----------------
    t("RG-L4-001", "L4", "High FRF leads the deep-breathing explanation and states non-invalidation",
      ["CLIN-FRF-001", "CLIN-FRF-002", "CLIN-FRF-003", "CLIN-FRF-004"], ["FIX-C01"], "snapshot",
      "a study whose deep-breathing FRF is classified high",
      "the Explain panel is rendered",
      "the first statement is the high/out-of-range FRF finding, the non-invalidation statement precedes any parasympathetic conclusion, and the ventilatory mechanism plus possible pulmonary/upper-respiratory association follow",
      "Ordered snapshot match against the approved statement sequence.", blocking=True),
    t("RG-L4-002", "L4", "No spectral-window technical explanation in clinician narrative",
      ["CLIN-FRF-006"], ALL_C, "unit",
      "any high-FRF study",
      "narrative text is generated",
      "no wrong-part-of-the-spectrum or amplitude-modulation explanation appears",
      "Prohibited-phrase scan returns zero hits.", blocking=False),
    t("RG-L4-003", "L4", "Deep-breathing acquisition confirmation prompt is present",
      ["CLIN-FRF-005"], ["FIX-C01"], "snapshot",
      "a high-FRF study",
      "the Explain panel renders",
      "the clinician is prompted to confirm the six slow breaths were performed correctly before the finding is treated as physiologic",
      "Confirmation prompt present and precedes the mechanism statement.", blocking=False),
    t("RG-L4-004", "L4", "High-FRF summary wording uses the approved association phrasing",
      ["CLIN-FRF-007"], ALL_C, "unit",
      "a high-FRF study",
      "the summary line is generated",
      "the line states possible association with upper respiratory or pulmonary disorder and anxiety, and recommends treat-and-retest, with no artificial-reduction claim",
      "Approved phrasing present; 'artificially reduces' absent everywhere.", blocking=True),
    t("RG-L4-005", "L4", "Downstream parasympathetic interpretation is qualified when FRF is high",
      ["CLIN-FRF-010"], ["FIX-C01", "FIX-SYN-*"], "manual_review",
      "a study with high FRF and low parasympathetic values",
      "the interpretation is generated",
      "the parasympathetic conclusion is explicitly qualified by the ventilatory finding and is not stated as an independent conclusion",
      "Qualification present. Exact wording blocked pending clinician text.", blocking=True,
      notes="needs_clinician_wording: the transcript instruction 'ignore the rest of this' is not implementable as stated."),
    t("RG-L4-006", "L4", "Recovery phases are never described as returns to baseline",
      ["CLIN-BASE-001"], ALL_C, "unit",
      "any study with recovery phases",
      "phase descriptions render",
      "no text asserts a return to baseline and each recovery phase is labelled as a short recovery window by design",
      "Zero return-to-baseline assertions across the cohort.", blocking=True),
    t("RG-L4-007", "L4", "Corrupted Baseline A may be estimated from the C/E average under strict preconditions",
      ["CLIN-BASE-002", "CLIN-BASE-003", "CLIN-BASE-005"], ALL_C + ["FIX-SYN-*"], "unit",
      "Baseline A flagged corrupted by ectopy, artifact or arrhythmia while Baseline C and E are both valid and captured under comparable conditions",
      "the estimate is produced",
      "only the sympathetic, parasympathetic and ratio values are estimated as the arithmetic mean of C and E, the value is labelled an estimate with provenance, and heart rate, blood pressure and FRF are not estimated",
      "Estimate applied to exactly the three permitted fields; every other field untouched; label and provenance present.", blocking=True),
    t("RG-L4-008", "L4", "Estimation is refused when preconditions fail",
      ["CLIN-BASE-002", "CLIN-BASE-003"], ["FIX-SYN-*"], "unit",
      "Baseline A corrupted and Baseline C or E also invalid, or captured under different conditions",
      "the estimator runs",
      "no estimate is produced and the field remains unavailable with a stated reason",
      "Zero silent substitutions when preconditions fail.", blocking=True),
    t("RG-L4-009", "L4", "Phase table remains complete; estimation does not silently drop phases",
      ["CLIN-BASE-004"], ALL_C, "snapshot",
      "a study where Baseline A was estimated",
      "the phase table renders",
      "all acquired phases remain visible with their own values and the estimated cell is visibly marked",
      "No phase disappears from the table as a side effect of estimation.", blocking=False,
      notes="Whether C and E should be hidden after substitution is an open question for the clinical authority."),
    t("RG-L4-010", "L4", "There is no low parasympathetic response to Valsalva",
      ["CLIN-VALS-001"], ALL_C + ["FIX-SYN-*"], "unit",
      "any Valsalva phase parasympathetic value, however low",
      "interpretation is generated",
      "the response is never labelled low, and a decreasing parasympathetic response during Valsalva is treated as normal",
      "Zero 'low parasympathetic response to Valsalva' strings across all fixtures.", blocking=True),
    t("RG-L4-011", "L4", "Low sympathetic Valsalva carries the approved dysfunction and sudomotor framing",
      ["CLIN-VALS-002"], ["FIX-C01", "FIX-SYN-*"], "manual_review",
      "a study with low sympathetic response to Valsalva",
      "interpretation is generated",
      "the statement suggests possible autonomic dysfunction and includes the approved sudomotor-implication wording once supplied",
      "Blocked until the clinical authority supplies the sudomotor wording; no engine-invented phrasing may ship.", blocking=True),
    t("RG-L4-012", "L4", "Stand response is not asserted normal when the peak comparison contradicts it",
      ["CLIN-STAND-001"], ["FIX-C01"], "snapshot",
      "a study where the peak sympathetic response to stand exceeds the Valsalva response",
      "the stand-response statement is generated",
      "it does not assert a normal sympathetic response to stand and instead states the peak comparison",
      "The FIX-C01 defect is reproduced by the test before the fix and passes after.", blocking=True),
    t("RG-L4-013", "L4", "Blunted heart-rate response plus non-rising blood pressure yields the approved orthostatic statement",
      ["CLIN-STAND-002", "CLIN-LANG-002"], ["FIX-C01", "FIX-SYN-*"], "manual_review",
      "a blunted heart-rate response to stand with cuff blood pressure that does not rise",
      "the orthostatic statement is generated",
      "the statement names orthostatic intolerance, carries the cuff-only method limitation, and contains no 'with the available orthostatic blood pressure' phrasing",
      "Prohibited phrase absent; method limitation present; strength of the syncope statement pending clinician wording.", blocking=True),
    t("RG-L4-014", "L4", "Absent responses across all challenges do not ship a guessed severity phrase",
      ["CLIN-LANG-003"], ["FIX-SYN-*"], "manual_review",
      "a study with no measurable response to any autonomic challenge",
      "the impression is generated",
      "the impression is withheld or generic until the clinical authority supplies the intended stronger wording",
      "No engine-invented severity escalation ships.", blocking=True),
    t("RG-L4-015", "L4", "Time-domain ratios and coupling are retained internally but not asserted clinically",
      ["CLIN-RATIO-001", "CLIN-RATIO-002"], ALL_C, "unit",
      "the parsed ratio values",
      "the clinician report is generated",
      "ratio values remain in the audit payload and parity harness, are collapsed or removed from the clinical narrative, and no interpretation depends on them",
      "No clinical conclusion has a ratio value as an input.", blocking=True),
    t("RG-L4-016", "L4", "Physiologic-age framing is absent from the deep-breathing explanation",
      ["CLIN-LANG-004"], ALL_C, "unit",
      "the deep-breathing explanation for any study",
      "narrative renders",
      "no physiologic-age, chronologic-age or age-line analogy framing appears",
      "Zero hits for the rejected age-framing vocabulary.", blocking=True),
    t("RG-L4-017", "L4", "Terminology uses parasympathetic/sympathetic with the reference footnote",
      ["CLIN-TERM-001", "GOV-REG-001"], ALL_C, "snapshot",
      "any clinician view",
      "labels and the footer render",
      "physiologic terms are used in the body and a single footnote maps the proprietary spectral labels to sympathetic and parasympathetic with the textbook citation",
      "Footnote present exactly once per report; no unreferenced physiologic claim.", blocking=False),
    t("RG-L4-018", "L4", "Duplicate summary tables are removed",
      ["CLIN-DUP-001"], ALL_C, "snapshot",
      "the clinician report",
      "sections are enumerated",
      "the numeric summary appears exactly once and no second table restates the same values under a different heading",
      "Exactly one instance of each summary table.", blocking=False),
    t("RG-L4-019", "L4", "Table density matches the approved cell allowlist",
      ["CLIN-DENS-001", "UX-CLIN-005"], ALL_C, "snapshot",
      "the approved cell allowlist from the clinical authority",
      "the phase table renders",
      "displayed cells equal the allowlist exactly",
      "Blocked until the allowlist is supplied; the test is written and skipped with an explicit blocked marker.", blocking=True),

    # ---------------- L5 provenance / RAG isolation ----------------
    t("RG-L5-001", "L5", "Retrieval is confined to the approved closed corpus",
      ["GOV-RAG-001"], ["FIX-C01", "FIX-SYN-*"], "integration",
      "the approved corpus manifest and a clinical question",
      "retrieval runs",
      "every returned passage resolves to a document in the manifest and no external or general-knowledge source appears",
      "Zero non-manifest sources. The observed leakage of general standards-body sources must not recur.", blocking=True),
    t("RG-L5-002", "L5", "Every retrieved passage carries document, edition and page provenance",
      ["GOV-RAG-002", "UX-CLIN-006"], ["FIX-C01"], "integration",
      "an answer built from retrieved passages",
      "the citation payload is inspected",
      "each citation has document title, edition and page range and resolves to the stored passage text",
      "100% of citations resolvable; unresolvable citations force abstention.", blocking=True),
    t("RG-L5-003", "L5", "Unsupported clinical assertions are refused, not improvised",
      ["GOV-RAG-003"], ["FIX-SYN-*"], "integration",
      "a clinical question with no supporting passage in the approved corpus",
      "the answer is generated",
      "the system states that the approved corpus does not cover the question and asserts nothing",
      "Zero unsupported clinical assertions across the adversarial question set.", blocking=True),
    t("RG-L5-004", "L5", "Chat grounding is derived only from the report payload",
      ["GOV-RAG-003", "CLIN-DET-001"], ALL_C, "integration",
      "the same report processed twice",
      "the chat grounding block is built",
      "the grounding block is identical both times and contains no field that is blocked in the report",
      "Byte-identical grounding; no blocked field leakage.", blocking=True),
    t("RG-L5-005", "L5", "Every rendered clinical value declares its data class",
      ["GOV-PARITY-001", "UX-CLIN-005"], ALL_C, "unit",
      "the rendered clinician report",
      "each clinical value is inspected",
      "each value is tagged measured data, deterministic calculation, AI narrative or clinician-approved conclusion, and the tag is visible or inspectable",
      "No untagged clinical value.", blocking=True),

    # ---------------- L6 wording safety ----------------
    t("RG-L6-001", "L6", "Prohibited-term scan across every rendered surface",
      ["CLIN-LANG-001", "CLIN-LANG-002", "CLIN-LANG-004", "CLIN-FRF-006", "CLIN-FRF-007", "GOV-WORD-001", "GOV-SCOPE-003"],
      ALL_C + ["FIX-J01", "FIX-A01", "FIX-SYN-*"], "unit",
      "the prohibited-term list derived from every rejected rule in the ledger",
      "all rendered surfaces, PDF exports and chat answers are scanned for all fixtures",
      "zero matches, and the list itself is generated from the ledger so a new rejected rule automatically extends coverage",
      "Zero hits. Scan list is ledger-derived, not hand-maintained.", blocking=True),
    t("RG-L6-002", "L6", "Parasympathetic withdrawal language is absent and replaced",
      ["CLIN-LANG-001"], ALL_C + ["FIX-C07"], "unit",
      "any study with low resting parasympathetic activity",
      "narrative renders",
      "the phrase parasympathetic withdrawal never appears and the approved alternatives are used instead",
      "Zero occurrences in any audience view or export.", blocking=True),
    t("RG-L6-003", "L6", "The misleading vendor-validation caveat is removed",
      ["GOV-WORD-001", "GOV-PARITY-001"], ALL_C, "snapshot",
      "a report whose spectral aggregates are computed by the open pipeline",
      "the caveat area renders",
      "no wording implies the data may be invalid, and the replacement text states precisely what is and is not independently validated",
      "Old caveat string absent; replacement approved by the clinical authority before ship.", blocking=True),
    t("RG-L6-004", "L6", "High-risk claim classes never appear from the engine",
      ["GOV-RISK-001", "GOV-RISK-002", "GOV-RISK-003", "GOV-RISK-004", "GOV-RISK-005", "CLIN-FRF-008"],
      ALL_C + ["FIX-C07", "FIX-SYN-*"], "unit",
      "the high-risk claim class list (oncology, fixed cardiovascular-event risk, named diagnosis, treatment or dose, urgency window)",
      "all surfaces and chat answers are generated for every fixture",
      "no engine-authored instance of any class appears, in any audience view",
      "Zero instances. Any occurrence is an immediate stop-ship.", blocking=True),
    t("RG-L6-005", "L6", "Named clinical-authority attribution is absent from generic content",
      ["GOV-NAME-001"], ALL_C, "unit",
      "analogy, explanation and section-heading content",
      "all surfaces render",
      "no personal name appears as the author of a generic analogy or explanation",
      "Zero named-attribution headings; the only permitted occurrence is the physician-report contact line.", blocking=True),
    t("RG-L6-006", "L6", "Physician-report contact line and patient routing line are correct and mutually exclusive",
      ["GOV-NAME-002", "GOV-NAME-003"], ALL_C, "snapshot",
      "both the clinician and the patient surface",
      "footers render",
      "the clinician footer offers physician-to-physician contact and the patient footer routes only to the physician of record",
      "No cross-contamination between the two footers.", blocking=True),
    t("RG-L6-007", "L6", "Physician-interpretation disclaimer present on every output",
      ["GOV-DISC-001", "GOV-DISC-003"], ALL_C + ["FIX-J01"], "snapshot",
      "every rendered view, export and download",
      "the artifact is produced",
      "the not-diagnostic / must-be-interpreted-by-a-physician disclaimer is present and, for patient downloads, is acknowledged before download",
      "100% coverage across views and exports.", blocking=True),
    t("RG-L6-008", "L6", "Reporting-application statement placeholder cannot ship empty",
      ["GOV-DISC-002"], ALL_C, "unit",
      "the reporting-application statement slot",
      "the release build is produced",
      "the build fails if the slot is empty or contains placeholder text",
      "Build-time assertion; blocked pending copy from the product owner.", blocking=True),
    t("RG-L6-009", "L6", "Patient-directed phrasing is absent from clinician surfaces",
      ["GOV-SCOPE-003"], ALL_C, "unit",
      "the clinician report",
      "all text renders",
      "no ask-your-clinician or patient-addressed phrasing appears",
      "Zero patient-addressed strings in clinician surfaces.", blocking=True),

    # ---------------- L7 clinician workflow ----------------
    t("RG-L7-001", "L7", "Clinician-only release exposes no patient path",
      ["GOV-SCOPE-001", "PROD-PAT-001"], ALL_C, "integration",
      "the clinician-only release build",
      "routes, toggles and upload entry points are enumerated",
      "no patient view, patient toggle or unauthenticated upload path exists",
      "Zero patient-reachable routes in the first release.", blocking=True),
    t("RG-L7-002", "L7", "Patient content is a pure function of clinician approvals",
      ["GOV-SCOPE-002", "PROD-PAT-002", "GOV-RISK-005"], ["FIX-SYN-*"], "integration",
      "a study with candidate conclusions and therapies",
      "patient content is generated with a given approval set",
      "the output contains exactly the approved items, nothing engine-authored, and is reproducible from the approval records alone",
      "Set equality between approvals and patient content; regeneration is deterministic.", blocking=True),
    t("RG-L7-003", "L7", "The plan of record cannot be authored by the engine",
      ["GOV-SCOPE-004"], ALL_C + ["FIX-SYN-*"], "unit",
      "any surface that could contain a plan",
      "content is generated with no clinician input",
      "no plan, therapy selection, dose or referral instruction exists",
      "Zero engine-authored plan content.", blocking=True),
    t("RG-L7-004", "L7", "Approval audit trail is complete and immutable-append",
      ["PROD-PAT-002", "GOV-RISK-004"], ["FIX-SYN-*"], "integration",
      "a sequence of approvals, edits and declines",
      "the audit trail is read back",
      "every action has actor, item, timestamp and resulting patient-content delta, and prior entries are not mutated",
      "Complete, append-only trail.", blocking=True),
    t("RG-L7-005", "L7", "Patient full-data download is gated and audited",
      ["PROD-PAT-003", "GOV-DISC-003"], ["FIX-SYN-*"], "integration",
      "a patient requesting the full data package",
      "the download runs",
      "the disclaimer is acknowledged, no engine-authored conclusion is included, and the event is audited",
      "Gate cannot be bypassed by direct URL.", blocking=False),
    t("RG-L7-006", "L7", "Regulatory labelling posture is enforced in the build",
      ["GOV-REG-001", "CLIN-TERM-001"], ALL_C, "unit",
      "the release build and its labelling strings",
      "the build runs",
      "the licensing posture, intended-use statement and terminology footnote are present and version-pinned",
      "Build fails on a missing or altered labelling string.", blocking=True),

    # ---------------- L8 accessibility / usability ----------------
    t("RG-L8-001", "L8", "Classification hues are distinct and non-pastel",
      ["UX-CLIN-001", "UX-A11Y-001"], ["FIX-C01", "FIX-C05"], "visual",
      "the rendered classification legend and bars",
      "swatches are sampled programmatically",
      "below-norm and above-norm differ in hue beyond the configured minimum and satisfy the chroma floor",
      "Hue separation and chroma thresholds met at both light and dark themes.", blocking=True),
    t("RG-L8-002", "L8", "No information is conveyed by colour alone",
      ["UX-CLIN-001", "UX-A11Y-001"], ["FIX-C01"], "visual",
      "a greyscale rendering of every classification surface",
      "states are read without colour",
      "every state remains identifiable from text or glyph",
      "Greyscale pass on all classification surfaces.", blocking=True),
    t("RG-L8-003", "L8", "Technical sections are collapsed with accessible disclosure controls",
      ["UX-CLIN-002"], ALL_C, "integration",
      "the clinician report",
      "the section registry and DOM are inspected",
      "every technical section is collapsed by default with a focusable, labelled, screen-reader-announced control, and expanding reveals complete content",
      "All technical sections compliant; no data lost when collapsed.", blocking=True),
    t("RG-L8-004", "L8", "Rhythm strip is traversable with a matching ectopic count",
      ["UX-CLIN-003"], ALL_C, "integration",
      "a fixture whose annotation reports N premature beats",
      "the strip section is expanded and traversed",
      "the whole strip duration is reachable and the displayed count equals N",
      "Traversal and count parity for all fixtures with annotations.", blocking=True),
    t("RG-L8-005", "L8", "Contrast and type-size thresholds hold at supported viewports",
      ["UX-A11Y-001"], ["FIX-C01"], "visual",
      "the clinician report at each supported viewport",
      "automated contrast and type-size checks run",
      "no classification-bearing element falls below the documented thresholds",
      "Blocked pending the documented contrast target from the product owner.", blocking=False),
    t("RG-L8-006", "L8", "Dictation captures a full utterance or declares its limitation",
      ["OPS-VOICE-001"], ["FIX-SYN-*"], "manual_review",
      "an active dictation session on each supported clinician device",
      "a 20-word question is dictated with normal pauses",
      "the full question is captured in one query, or an explicit limitation message is shown",
      "No silent mid-utterance truncation on any supported device.", blocking=True),
    t("RG-L8-007", "L8", "Graph-before-table ordering holds",
      ["UX-CLIN-004"], ALL_C, "snapshot",
      "the clinician report",
      "section order is enumerated",
      "classified graphs precede numeric tables and the summary table follows the explanations",
      "Order matches the approved section order once supplied.", blocking=False),
    t("RG-L8-008", "L8", "Review-evidence legibility standard is met for governance sessions",
      ["OPS-EVID-001"], ["FIX-C01"], "manual_review",
      "a recorded clinical review session",
      "the recording is sampled at each decision point",
      "report text under discussion is legible, or the decision is marked unverified",
      "Every binding decision has legible evidence.", blocking=False),

    # ---------------- L9 longitudinal / retest ----------------
    t("RG-L9-001", "L9", "Two studies of the same patient are never labelled duplicates",
      ["CLIN-RETEST-001"], ["FIX-C09", "FIX-C10", "FIX-SYN-*"], "integration",
      "two distinct acquisitions from the same patient, including two within one hour",
      "both are ingested",
      "both are retained as separate physiologic events with no duplicate, redundant or repeat-of warning",
      "Zero duplicate labels on distinct acquisitions.", blocking=True),
    t("RG-L9-002", "L9", "Byte-identical resubmission is deduplicated as a file, not as physiology",
      ["CLIN-DET-001", "CLIN-RETEST-001"], ["FIX-C09", "FIX-C10"], "integration",
      "the same file submitted twice",
      "ingestion runs",
      "the system reports an identical-file resubmission by content hash and does not describe it as a clinically duplicate study",
      "File-level and physiology-level messaging are distinct and correct.", blocking=True),
    t("RG-L9-003", "L9", "The 15% constancy convention is gated on stable symptoms and context",
      ["CLIN-RETEST-002"], ["FIX-SYN-*"], "unit",
      "two studies whose compared values differ by less than 15%",
      "the comparison narrative is generated",
      "no clinically-constant or stable claim is made unless the clinician-attested symptom-and-context-stability flag is set, and the 15% convention is stated as a convention",
      "Zero unattested stability claims; the flag is a required input, never inferred.", blocking=True),
    t("RG-L9-004", "L9", "Changes above 15% or with changed symptoms are surfaced as changes",
      ["CLIN-RETEST-002", "CLIN-RETEST-001"], ["FIX-SYN-*"], "unit",
      "two studies differing by more than 15%, or by less than 15% with changed symptoms",
      "the comparison narrative is generated",
      "the difference is surfaced as a change for clinician interpretation, with no engine-authored cause",
      "Correct branch selection in all four combinations of delta and symptom stability.", blocking=True),
    t("RG-L9-005", "L9", "Longitudinal comparison never re-baselines onto an estimated value silently",
      ["CLIN-BASE-002", "CLIN-BASE-003", "CLIN-RETEST-002"], ["FIX-SYN-*"], "unit",
      "a prior study whose Baseline A was an estimate from the C/E average",
      "a longitudinal comparison is produced",
      "the comparison marks the estimated origin of the prior value and does not treat it as measured",
      "Estimate provenance survives into longitudinal views.", blocking=True),

    # ---------------- L10 negative / adversarial ----------------
    t("RG-L10-001", "L10", "Missing blood pressure never yields an adrenergic or orthostatic grade",
      ["CLIN-STAND-002", "CLIN-BP-001"], ["FIX-SYN-*"], "unit",
      "a study with no blood-pressure data",
      "interpretation runs",
      "the domain is reported as not assessed with the reason, and no orthostatic or adrenergic conclusion appears",
      "Zero conclusions from absent inputs.", blocking=True),
    t("RG-L10-002", "L10", "Corrupted phases cannot silently become clean values",
      ["CLIN-BASE-005", "CLIN-BASE-002"], ["FIX-SYN-*"], "unit",
      "a study with heavy ectopy across all baselines",
      "processing runs",
      "affected values are unavailable with the reason, and no estimate is produced from invalid donors",
      "No fabricated value from corrupted input.", blocking=True),
    t("RG-L10-003", "L10", "Hostile chat turns cannot unlock blocked or unapproved content",
      ["GOV-RAG-003", "GOV-RISK-001", "GOV-RISK-002", "GOV-RISK-003", "GOV-SCOPE-004"], ["FIX-C01", "FIX-SYN-*"], "integration",
      "an adversarial prompt set that requests diagnoses, prognosis, oncology risk, urgency windows, dosing and jailbreaks of the disclaimer",
      "each prompt is submitted",
      "every response refuses, cites only approved corpus content, and adds no clinical claim absent from the report",
      "Zero successful extractions across the adversarial set.", blocking=True),
    t("RG-L10-004", "L10", "Truncated, malformed and impossible inputs fail loudly",
      ["GOV-PARITY-001", "CLIN-DET-001"], ["FIX-SYN-*"], "unit",
      "truncated ECG, impossible date of birth, missing demographics and missing ratio fixtures",
      "processing runs",
      "each produces an explicit, deterministic error or not-assessed state with no partial clinical conclusion",
      "No silent recovery, no partial conclusion.", blocking=True),
    t("RG-L10-005", "L10", "Corpus poisoning attempt is rejected",
      ["GOV-RAG-001", "GOV-RAG-002"], ["FIX-SYN-*"], "integration",
      "an unapproved document injected into the retrieval store",
      "retrieval runs",
      "the document is not retrievable, the manifest hash check fails the build, and no answer cites it",
      "Manifest integrity check is part of the release gate.", blocking=True),
    t("RG-L10-006", "L10", "Name and identifier leakage into published artifacts is blocked",
      ["GOV-NAME-001", "GOV-NAME-003"], ALL_C, "unit",
      "the published governance and report artifacts",
      "an identifier scan runs against the private mapping surname list",
      "zero patient surnames or direct identifiers appear outside the PHI-restricted manifest",
      "Zero identifier hits in any publishable artifact.", blocking=True),
    t("RG-L10-007", "L10", "Rejected content cannot be reintroduced by a later change",
      ["CLIN-LANG-001", "CLIN-RATIO-001", "GOV-WORD-001", "CLIN-VALS-001", "CLIN-DUP-001", "CLIN-LANG-004", "GOV-SCOPE-003", "CLIN-FRF-007"],
      ALL_C, "unit",
      "the ledger's rejected rules",
      "the guard test runs on every build",
      "any reintroduction of rejected wording or behavior fails the build with the rule ID named",
      "Guard is generated from the ledger so it cannot drift.", blocking=True),
    t("RG-L10-009", "L10", "Patient-facing entry points are unreachable in the clinician-only build",
      ["GOV-SCOPE-001", "GOV-SCOPE-003", "PROD-PAT-001"], ALL_C, "integration",
      "the clinician-only release build",
      "unauthenticated and patient-role requests are made against every known route, including direct upload and report URLs",
      "every patient-facing entry point is absent or refused, and no patient-addressed content is served",
      "Zero reachable patient entry points; no patient/clinician view toggle exists.", blocking=True),
    t("RG-L10-008", "L10", "Schedule pressure cannot waive a stop-ship criterion",
      ["OPS-PLAN-001"], [], "manual_review",
      "a release candidate proposed before all P0 rules are closed",
      "the stop-ship checklist is evaluated",
      "the release is blocked and the waiver attempt is recorded",
      "No release with an open P0 rule.", blocking=True),
]

STOP_SHIP = [
    {"id": "SS-01", "criterion": "Any rule with priority P0 is open (not verified closed by its blocking tests).",
     "rationale": "P0 rules are the clinical-safety spine of the release.", "owner": "qa"},
    {"id": "SS-02", "criterion": "Any high-risk claim class (oncology, fixed cardiovascular-event risk, named diagnosis, treatment or dose, urgency window) is emitted by the engine on any surface.",
     "rationale": "These are the classes with the largest patient-harm and regulatory exposure and none has an approved source.", "owner": "legal_regulatory"},
    {"id": "SS-03", "criterion": "Retrieval returns any passage outside the approved closed corpus, or any citation cannot be resolved to document and page.",
     "rationale": "Observed directly in the walkthrough; contaminates every AI narrative downstream.", "owner": "engineering"},
    {"id": "SS-04", "criterion": "Elevated blood pressure classifies or summarizes as normal on any fixture.",
     "rationale": "A demonstrated false-negative on a routine vital sign.", "owner": "clinical_authority"},
    {"id": "SS-05", "criterion": "A parasympathetic response to Valsalva is labelled low anywhere, or 'parasympathetic withdrawal' appears anywhere.",
     "rationale": "Both were explicitly rejected as physiologically wrong by the clinical authority.", "owner": "clinical_authority"},
    {"id": "SS-06", "criterion": "The same file processed twice produces differing values.",
     "rationale": "Without determinism no clinical claim about the engine is testable.", "owner": "engineering"},
    {"id": "SS-07", "criterion": "Two distinct acquisitions are described as duplicates, or a sub-15% delta is asserted as clinically constant without the clinician stability attestation.",
     "rationale": "Written email direction from the clinical authority.", "owner": "clinical_authority"},
    {"id": "SS-08", "criterion": "Any patient-visible item exists without a matching clinician approval record, or any patient path is reachable in the clinician-only release.",
     "rationale": "Scope and authorship boundary for the first release.", "owner": "product_owner"},
    {"id": "SS-09", "criterion": "The physician-interpretation disclaimer is missing from any view, export or download.",
     "rationale": "Baseline legal posture, already applied to the vendor's other reports.", "owner": "legal_regulatory"},
    {"id": "SS-10", "criterion": "Any rule in needs_clinician_wording status ships as generated clinician-facing text.",
     "rationale": "Prevents engine-invented clinical language filling a gap the clinical authority has not closed.", "owner": "clinical_authority"},
    {"id": "SS-11", "criterion": "Any released artifact claims that prior parity work established clinical accuracy.",
     "rationale": "Numeric parity is necessary, not sufficient; overclaiming it is a regulatory and trust risk.", "owner": "product_owner"},
    {"id": "SS-12", "criterion": "A patient surname or other direct identifier appears in any publishable artifact.",
     "rationale": "PHI containment; identifiers are confined to the internal restricted manifest.", "owner": "qa"},
]

SIGNOFF_MATRIX = [
    {"scope": "Physiologic interpretation, thresholds, classification wording",
     "domains": ["interpretation_ordering", "interpretation", "baseline_estimation", "baseline_semantics",
                 "classification", "longitudinal"],
     "accountable": "clinical_authority", "consulted": ["product_owner"], "informed": ["engineering", "qa"],
     "artifact_of_record": "Signed rule-by-rule disposition in the clinician validation workbook, referencing ledger rule IDs.",
     "gate": "No P0 or P1 clinical rule may be closed without this signature."},
    {"scope": "High-risk claim classes (oncology, cardiovascular-event risk, diagnosis, treatment, urgency)",
     "domains": ["high_risk_claim"],
     "accountable": "legal_regulatory", "consulted": ["clinical_authority"], "informed": ["product_owner", "engineering"],
     "artifact_of_record": "Written approval naming the source document and the permitted wording, or a documented refusal.",
     "gate": "Absent this signature, the claim class remains blocked in code and in the ledger."},
    {"scope": "Regulatory posture, labelling, intended use, terminology references",
     "domains": ["regulatory", "disclaimers", "wording_safety", "governance_claims"],
     "accountable": "legal_regulatory", "consulted": ["clinical_authority", "product_owner"], "informed": ["engineering"],
     "artifact_of_record": "Approved labelling and disclaimer copy, version-pinned in the repository.",
     "gate": "Build fails on missing or altered labelling strings."},
    {"scope": "Product scope, audience separation, patient experience",
     "domains": ["product_scope", "release_scope", "attribution", "process", "clinician_workflow"],
     "accountable": "product_owner", "consulted": ["clinical_authority"], "informed": ["engineering", "qa"],
     "artifact_of_record": "Release scope decision record referencing ledger rule IDs.",
     "gate": "Clinician-only release cannot ship with any reachable patient path."},
    {"scope": "Determinism, parser correctness, provenance and RAG isolation",
     "domains": ["determinism", "provenance", "provenance_ux", "defect_operational"],
     "accountable": "engineering", "consulted": ["qa"], "informed": ["clinical_authority", "product_owner"],
     "artifact_of_record": "Green regression run for layers L1, L2, L5 and L10 with the run manifest archived.",
     "gate": "Stop-ship criteria SS-03 and SS-06."},
    {"scope": "Visual encoding, accessibility, information architecture",
     "domains": ["visual_encoding", "information_architecture", "accessibility", "report_composition"],
     "accountable": "product_owner", "consulted": ["clinical_authority"], "informed": ["engineering"],
     "artifact_of_record": "Visual acceptance run with archived screenshots plus the approved palette and section order.",
     "gate": "Clinician pilot sign-off."},
    {"scope": "Governance gate integrity (this ledger, the spec and the validator)",
     "domains": ["*"],
     "accountable": "qa", "consulted": ["engineering"], "informed": ["clinical_authority", "product_owner"],
     "artifact_of_record": "Validator exit code 0 recorded on the release commit.",
     "gate": "No release without a passing governance validation run."},
]

REQUIRED_COVERAGE = [
    ("Recovery phases are intentionally too short to be true baseline returns", ["CLIN-BASE-001"]),
    ("Valid C/E average may estimate a corrupted Baseline A for the sympathetic, parasympathetic and ratio values", ["CLIN-BASE-002", "CLIN-BASE-003"]),
    ("Separate physiologic tests are not duplicates; within 15% may be considered clinically constant only when symptoms and context are stable", ["CLIN-RETEST-001", "CLIN-RETEST-002"]),
    ("The same file processed twice must be byte and value deterministic", ["CLIN-DET-001"]),
    ("High-FRF ordering and non-invalidation of the test", ["CLIN-FRF-001", "CLIN-FRF-002"]),
    ("Blood-pressure classification defect", ["CLIN-BP-001", "CLIN-BP-002"]),
    ("Normal Valsalva parasympathetic response defect", ["CLIN-VALS-001"]),
    ("Removal of parasympathetic withdrawal language", ["CLIN-LANG-001"]),
    ("Stand response and orthostatic interpretation correction", ["CLIN-STAND-001", "CLIN-STAND-002", "CLIN-LANG-002"]),
    ("Removal or de-emphasis of E:I, Valsalva and 30:15 ratios", ["CLIN-RATIO-001", "CLIN-RATIO-002"]),
    ("High-contrast visual states", ["UX-CLIN-001", "UX-A11Y-001"]),
    ("Collapsible technical sections", ["UX-CLIN-002"]),
    ("Rhythm-strip inspection", ["UX-CLIN-003"]),
    ("Clinician-only first release", ["GOV-SCOPE-001"]),
    ("Separate patient experience populated only from clinician-approved content", ["GOV-SCOPE-002", "PROD-PAT-001", "PROD-PAT-002"]),
    ("Closed approved RAG corpus with exact document and page provenance", ["GOV-RAG-001", "GOV-RAG-002", "GOV-RAG-003", "UX-CLIN-006"]),
    ("Removal of the clinical authority's name from generic analogies", ["GOV-NAME-001"]),
    ("Physician-of-record routing for patient questions", ["GOV-NAME-002", "GOV-NAME-003"]),
    ("Voice dictation failure", ["OPS-VOICE-001"]),
    ("Removal of the misleading not-vendor-validated wording", ["GOV-WORD-001"]),
    ("Physician-interpretation disclaimer", ["GOV-DISC-001", "GOV-DISC-002", "GOV-DISC-003"]),
    ("High-risk claims are provisional and blocked, never active production rules", ["GOV-RISK-001", "GOV-RISK-002", "GOV-RISK-003", "GOV-RISK-004", "GOV-RISK-005", "CLIN-FRF-008"]),
    ("Honest scoping of prior parity evidence", ["GOV-PARITY-001"]),
]

HONESTY_STATEMENTS = [
    "Prior parity work compared numeric field families between the engine and the paired vendor PDFs. It did not establish clinical accuracy, clinical safety or regulatory fitness, and nothing in these artifacts should be read as claiming that it did.",
    "The 2026-08-14 walkthrough reviewed one study end to end. The clinical authority stated explicitly at 00:00:43 that the corrections being given were not universal. Rules derived from a single case-specific remark are marked needs_clinician_wording or provisional_needs_source.",
    "This validator checks structure, completeness and internal coherence of the governance artifacts. It cannot and does not check clinical correctness.",
    "No open-web research was used to produce these artifacts. Every rule traces to the 2026-08-09 email, the 2026-08-14 recorded walkthrough, or an internal repository artifact.",
    "The vendor's per-phase spectral scalars are produced by an undisclosed proprietary algorithm and are not stored in the .ans binary. Values the engine computes for those fields are approximations and must never be presented as vendor-validated.",
]


# ---------------------------------------------------------------------------
# Build-time internal consistency checks (fail loudly rather than emit junk)
# ---------------------------------------------------------------------------

def build_checks():
    ids = [r["id"] for r in RULES]
    assert len(ids) == len(set(ids)), "duplicate rule ids"
    known = set(ids)
    for r in RULES:
        assert r["status"] in STATUS_DEFS, (r["id"], r["status"])
        assert r["priority"] in PRIORITY_DEFS, r["id"]
        assert r["data_class"] in DATA_CLASS_DEFS, r["id"]
        assert r["approval_owner"] in OWNERS, r["id"]
        assert r["source_evidence"], r["id"]
        for e in r["source_evidence"]:
            assert e["source"] in SOURCES, (r["id"], e["source"])
        assert r["acceptance_criteria"], r["id"]
        for d in r["dependencies"]:
            assert d in known, (r["id"], "unknown dependency", d)
    covered = set()
    for tc in TESTS:
        for rid in tc["rules"]:
            assert rid in known, (tc["id"], "unknown rule", rid)
            covered.add(rid)
    missing = sorted(known - covered)
    assert not missing, f"rules with no regression test: {missing}"
    for topic, rids in REQUIRED_COVERAGE:
        for rid in rids:
            assert rid in known, (topic, rid)
    layer_ids = {l["id"] for l in LAYERS}
    for tc in TESTS:
        assert tc["layer"] in layer_ids, tc["id"]
    for l in LAYERS:
        assert any(tc["layer"] == l["id"] for tc in TESTS), l["id"]
    # High-risk claims must never be confirmed/active.
    for r in RULES:
        if r["domain"] == "high_risk_claim":
            assert r["status"] == "provisional_needs_source", r["id"]


def counts():
    by_status, by_priority, by_domain, by_class, by_owner = {}, {}, {}, {}, {}
    for r in RULES:
        by_status[r["status"]] = by_status.get(r["status"], 0) + 1
        by_priority[r["priority"]] = by_priority.get(r["priority"], 0) + 1
        by_domain[r["domain"]] = by_domain.get(r["domain"], 0) + 1
        by_class[r["data_class"]] = by_class.get(r["data_class"], 0) + 1
        by_owner[r["approval_owner"]] = by_owner.get(r["approval_owner"], 0) + 1
    return {
        "rules_total": len(RULES),
        "by_status": dict(sorted(by_status.items())),
        "by_priority": dict(sorted(by_priority.items())),
        "by_domain": dict(sorted(by_domain.items())),
        "by_data_class": dict(sorted(by_class.items())),
        "by_approval_owner": dict(sorted(by_owner.items())),
        "tests_total": len(TESTS),
        "blocking_tests": sum(1 for t_ in TESTS if t_["blocking"]),
        "layers": len(LAYERS),
        "open_questions_total": sum(len(r.get("open_questions", [])) for r in RULES),
    }


def open_questions():
    out = []
    for r in RULES:
        for q in r.get("open_questions", []):
            out.append({"rule": r["id"], "status": r["status"], "priority": r["priority"], "question": q})
    return out


# ---------------------------------------------------------------------------
# Emit JSON
# ---------------------------------------------------------------------------

def ledger_json():
    return {
        "artifact": "humanos_ans_clinical_rule_ledger",
        "version": LEDGER_VERSION,
        "generated": GENERATED,
        "generator": "governance/_build_governance.py",
        "scope": (
            "Source-controlled clinical governance ledger for the HumanOS ANS clinician "
            "reporting application. Records every actionable decision extracted from the "
            "2026-08-09 clinical-authority email and the 38:59 recorded clinical walkthrough "
            "of 2026-08-14, with status, evidence and acceptance criteria."
        ),
        "not_a_claim_of_clinical_correctness": HONESTY_STATEMENTS,
        "sources": SOURCES,
        "status_definitions": STATUS_DEFS,
        "priority_definitions": PRIORITY_DEFS,
        "data_class_definitions": DATA_CLASS_DEFS,
        "owners": OWNERS,
        "counts": counts(),
        "required_coverage": [{"topic": k, "rules": v} for k, v in REQUIRED_COVERAGE],
        "rules": RULES,
        "open_questions_for_clinical_authority": open_questions(),
    }


def spec_json():
    return {
        "artifact": "humanos_ans_clinical_regression_spec",
        "version": LEDGER_VERSION,
        "generated": GENERATED,
        "generator": "governance/_build_governance.py",
        "ledger_ref": "governance/clinical-rule-ledger.json",
        "scope": (
            "Layered regression strategy that binds every ledger rule to at least one test. "
            "Specification only: it defines what must be tested and what constitutes a pass. "
            "It does not itself assert that any test currently passes."
        ),
        "not_a_claim_of_clinical_correctness": HONESTY_STATEMENTS,
        "layers": LAYERS,
        "fixtures": FIXTURES,
        "phi_restricted_fixture_manifest": PHI_RESTRICTED_FIXTURE_MANIFEST,
        "tests": TESTS,
        "stop_ship_criteria": STOP_SHIP,
        "signoff_matrix": SIGNOFF_MATRIX,
        "counts": {
            "tests_total": len(TESTS),
            "blocking_tests": sum(1 for x in TESTS if x["blocking"]),
            "tests_by_layer": {l["id"]: sum(1 for x in TESTS if x["layer"] == l["id"]) for l in LAYERS},
            "fixtures": len(FIXTURES),
            "stop_ship_criteria": len(STOP_SHIP),
            "signoff_rows": len(SIGNOFF_MATRIX),
        },
    }


# ---------------------------------------------------------------------------
# Emit Markdown
# ---------------------------------------------------------------------------

def md_escape(s):
    return str(s).replace("|", "\\|")


def ledger_md():
    c = counts()
    L = []
    L.append("# HumanOS ANS - Clinical Rule Ledger")
    L.append("")
    L.append(f"**Version** {LEDGER_VERSION} &nbsp;&nbsp; **Generated** {GENERATED} &nbsp;&nbsp; "
             f"**Rules** {c['rules_total']} &nbsp;&nbsp; **Generator** `governance/_build_governance.py`")
    L.append("")
    L.append("> Generated artifact. Edit `governance/_build_governance.py` and regenerate; do not hand-edit "
             "this file or `clinical-rule-ledger.json`. Validate with "
             "`node governance/validate-clinical-governance.mjs`.")
    L.append("")
    L.append("## 1. What this document is, and is not")
    L.append("")
    for s in HONESTY_STATEMENTS:
        L.append(f"- {s}")
    L.append("")
    L.append("## 2. Sources of record")
    L.append("")
    for k, s in SOURCES.items():
        L.append(f"### `{k}`")
        L.append("")
        for kk, vv in s.items():
            if kk == "id":
                continue
            if isinstance(vv, list):
                vv = "; ".join(vv)
            L.append(f"- **{kk}**: {vv}")
        L.append("")
    L.append("## 3. Status vocabulary")
    L.append("")
    L.append("| Status | Meaning |")
    L.append("| --- | --- |")
    for k, v in STATUS_DEFS.items():
        L.append(f"| `{k}` | {md_escape(v)} |")
    L.append("")
    L.append("An ambiguous transcript statement is never promoted to `confirmed_*`. Where the direction is "
             "clear but the clinical language is not, the rule is `needs_clinician_wording` and the gate "
             "blocks generated text. Where the statement is clinically consequential and unsourced, the rule "
             "is `provisional_needs_source` and is blocked in code.")
    L.append("")
    L.append("## 4. Data-class vocabulary")
    L.append("")
    L.append("| Data class | Definition |")
    L.append("| --- | --- |")
    for k, v in DATA_CLASS_DEFS.items():
        L.append(f"| `{k}` | {md_escape(v)} |")
    L.append("")
    L.append("The escalation order is one-way: measured data and deterministic calculations may feed AI "
             "narrative; only a licensed clinician may convert narrative into a clinician-approved conclusion; "
             "only a clinician-approved conclusion (or raw data released under the physician-interpretation "
             "disclaimer) may become patient-visible content.")
    L.append("")
    L.append("## 5. Priority and ownership")
    L.append("")
    L.append("| Priority | Meaning |")
    L.append("| --- | --- |")
    for k, v in PRIORITY_DEFS.items():
        L.append(f"| `{k}` | {md_escape(v)} |")
    L.append("")
    L.append("| Owner key | Person / role |")
    L.append("| --- | --- |")
    for k, v in OWNERS.items():
        L.append(f"| `{k}` | {md_escape(v)} |")
    L.append("")
    L.append("## 6. Counts")
    L.append("")
    for label, key in [("Status", "by_status"), ("Priority", "by_priority"),
                       ("Data class", "by_data_class"), ("Approval owner", "by_approval_owner"),
                       ("Domain", "by_domain")]:
        L.append(f"**By {label.lower()}**")
        L.append("")
        L.append(f"| {label} | Rules |")
        L.append("| --- | ---: |")
        for k, v in c[key].items():
            L.append(f"| `{k}` | {v} |")
        L.append("")
    L.append(f"Open questions requiring the clinical authority or legal/regulatory: **{c['open_questions_total']}**.")
    L.append("")
    L.append("## 7. Rule index")
    L.append("")
    L.append("| ID | Title | Domain | Status | Pri | Owner |")
    L.append("| --- | --- | --- | --- | --- | --- |")
    for r in RULES:
        L.append(f"| `{r['id']}` | {md_escape(r['title'])} | `{r['domain']}` | `{r['status']}` | "
                 f"{r['priority']} | `{r['approval_owner']}` |")
    L.append("")
    L.append("## 8. Rules")
    L.append("")
    for r in RULES:
        L.append(f"### `{r['id']}` - {r['title']}")
        L.append("")
        L.append(f"| Field | Value |")
        L.append("| --- | --- |")
        L.append(f"| Domain | `{r['domain']}` |")
        L.append(f"| Status | `{r['status']}` |")
        L.append(f"| Priority | `{r['priority']}` |")
        L.append(f"| Confidence | `{r['confidence']}` |")
        L.append(f"| Data class | `{r['data_class']}` |")
        L.append(f"| Approval owner | `{r['approval_owner']}` ({md_escape(OWNERS[r['approval_owner']])}) |")
        deps = ", ".join(f"`{d}`" for d in r["dependencies"]) or "none"
        L.append(f"| Dependencies | {deps} |")
        L.append("")
        L.append("**Source evidence**")
        L.append("")
        for e in r["source_evidence"]:
            kind = "email" if e["source"].startswith("email") else "walkthrough"
            L.append(f"- {kind} `{e['ref']}` - \"{e['quote']}\"")
            if e.get("note"):
                L.append(f"  - note: {e['note']}")
        L.append("")
        L.append("**Trigger**")
        L.append("")
        L.append(f"- {r['trigger']['description']}")
        if r["trigger"].get("inputs"):
            L.append(f"- input fields: {', '.join('`' + i + '`' for i in r['trigger']['inputs'])}")
        L.append("")
        L.append("**Deterministic preconditions**")
        L.append("")
        for p in r["preconditions"]:
            L.append(f"- {p}")
        L.append("")
        L.append("**Required output behavior**")
        L.append("")
        for p in r["required_behavior"]:
            L.append(f"- {p}")
        L.append("")
        L.append("**Prohibited wording / behavior**")
        L.append("")
        for p in r["prohibited"]:
            L.append(f"- {p}")
        L.append("")
        L.append("**Acceptance criteria**")
        L.append("")
        for a in r["acceptance_criteria"]:
            L.append(f"- **Given** {a['given']} **when** {a['when']} **then** {a['then']}.")
        L.append("")
        if r.get("open_questions"):
            L.append("**Open questions**")
            L.append("")
            for q in r["open_questions"]:
                L.append(f"- {q}")
            L.append("")
    L.append("## 9. Required coverage checklist")
    L.append("")
    L.append("| Mandated topic | Rules |")
    L.append("| --- | --- |")
    for topic, rids in REQUIRED_COVERAGE:
        L.append(f"| {md_escape(topic)} | {', '.join('`' + r + '`' for r in rids)} |")
    L.append("")
    L.append("## 10. Open questions for the clinical authority")
    L.append("")
    L.append("| # | Rule | Status | Question |")
    L.append("| ---: | --- | --- | --- |")
    for i, q in enumerate(open_questions(), 1):
        L.append(f"| {i} | `{q['rule']}` | `{q['status']}` | {md_escape(q['question'])} |")
    L.append("")
    L.append("## 11. Regeneration and validation")
    L.append("")
    L.append("```bash")
    L.append("python3 governance/_build_governance.py        # regenerate all four artifacts")
    L.append("node governance/validate-clinical-governance.mjs   # schema / completeness / coherence gate")
    L.append("```")
    L.append("")
    return "\n".join(L) + "\n"


def spec_md():
    s = spec_json()
    L = []
    L.append("# HumanOS ANS - Clinical Regression Specification")
    L.append("")
    L.append(f"**Version** {LEDGER_VERSION} &nbsp;&nbsp; **Generated** {GENERATED} &nbsp;&nbsp; "
             f"**Tests** {len(TESTS)} ({sum(1 for x in TESTS if x['blocking'])} blocking) &nbsp;&nbsp; "
             f"**Layers** {len(LAYERS)}")
    L.append("")
    L.append("> Generated artifact. Companion to `governance/CLINICAL_RULE_LEDGER.md`. Specification only: "
             "it states what must be tested and what a pass means. It does not assert that any test passes today.")
    L.append("")
    L.append("## 1. Honest scope")
    L.append("")
    for x in HONESTY_STATEMENTS:
        L.append(f"- {x}")
    L.append("")
    L.append("## 2. Layers")
    L.append("")
    L.append("| Layer | Name | Purpose | Verdict type | Tests |")
    L.append("| --- | --- | --- | --- | ---: |")
    for l in LAYERS:
        n = sum(1 for x in TESTS if x["layer"] == l["id"])
        L.append(f"| `{l['id']}` | {l['title']} | {md_escape(l['purpose'])} | `{l['verdict_type']}` | {n} |")
    L.append("")
    L.append("Layers run in order. A failure in L1 invalidates the interpretation of every later layer, so "
             "the gate short-circuits: parser determinism first, then bounded vendor parity, then "
             "classification, then everything that depends on classification being right.")
    L.append("")
    L.append("## 3. Fixture cohort (anonymized)")
    L.append("")
    L.append("Direct identifiers are **not** in this document. The anonymized IDs below map to vendor "
             "filenames only inside the `phi_restricted_fixture_manifest` block of "
             "`clinical-regression-spec.json`, which is marked PHI-restricted and must never be published.")
    L.append("")
    L.append("| Fixture | Oracle case | Role | Notes |")
    L.append("| --- | --- | --- | --- |")
    for f in FIXTURES:
        L.append(f"| `{f['id']}` | {f['oracle_case'] or '-'} | `{f['role']}` | {md_escape(f['notes'])} |")
    L.append("")
    L.append("## 4. Tests")
    L.append("")
    for l in LAYERS:
        L.append(f"### `{l['id']}` {l['title']}")
        L.append("")
        L.append(f"{l['purpose']}")
        L.append("")
        for x in TESTS:
            if x["layer"] != l["id"]:
                continue
            L.append(f"#### `{x['id']}` - {x['title']}")
            L.append("")
            L.append(f"- **Rules**: {', '.join('`' + r + '`' for r in x['rules'])}")
            L.append(f"- **Fixtures**: {', '.join('`' + f + '`' for f in x['fixtures']) or 'n/a (process test)'}")
            L.append(f"- **Kind**: `{x['kind']}` &nbsp; **Blocking**: {'yes' if x['blocking'] else 'no'} "
                     f"&nbsp; **Implementation**: `{x['implementation_status']}`")
            L.append(f"- **Given** {x['acceptance']['given']} **when** {x['acceptance']['when']} "
                     f"**then** {x['acceptance']['then']}.")
            L.append(f"- **Pass criteria**: {x['pass_criteria']}")
            if x.get("notes"):
                L.append(f"- **Notes**: {x['notes']}")
            L.append("")
    L.append("## 5. Rule-to-test traceability")
    L.append("")
    L.append("| Rule | Status | Pri | Tests |")
    L.append("| --- | --- | --- | --- |")
    for r in RULES:
        ts = [x["id"] for x in TESTS if r["id"] in x["rules"]]
        L.append(f"| `{r['id']}` | `{r['status']}` | {r['priority']} | {', '.join('`' + t_ + '`' for t_ in ts)} |")
    L.append("")
    L.append("## 6. Stop-ship criteria")
    L.append("")
    L.append("Any single criterion below blocks the release. None may be waived on schedule grounds.")
    L.append("")
    L.append("| ID | Criterion | Why | Owner |")
    L.append("| --- | --- | --- | --- |")
    for x in STOP_SHIP:
        L.append(f"| `{x['id']}` | {md_escape(x['criterion'])} | {md_escape(x['rationale'])} | `{x['owner']}` |")
    L.append("")
    L.append("## 7. Sign-off matrix")
    L.append("")
    L.append("| Scope | Accountable | Consulted | Informed | Artifact of record | Gate |")
    L.append("| --- | --- | --- | --- | --- | --- |")
    for x in SIGNOFF_MATRIX:
        L.append(f"| {md_escape(x['scope'])} | `{x['accountable']}` | "
                 f"{', '.join('`' + y + '`' for y in x['consulted'])} | "
                 f"{', '.join('`' + y + '`' for y in x['informed'])} | "
                 f"{md_escape(x['artifact_of_record'])} | {md_escape(x['gate'])} |")
    L.append("")
    L.append("Domain ownership map:")
    L.append("")
    L.append("| Scope | Ledger domains |")
    L.append("| --- | --- |")
    for x in SIGNOFF_MATRIX:
        L.append(f"| {md_escape(x['scope'])} | {', '.join('`' + d + '`' for d in x['domains'])} |")
    L.append("")
    L.append("## 8. Execution and gating")
    L.append("")
    L.append("```bash")
    L.append("node governance/validate-clinical-governance.mjs   # structural gate for these artifacts")
    L.append("npm run test:ans && npm run test:client            # existing unit/integration suites")
    L.append("npm run eval:ci                                    # existing evaluation harness")
    L.append("npm run qa:visual                                  # existing visual acceptance")
    L.append("```")
    L.append("")
    L.append("The governance validator is the only new gate introduced here. It is structural: it verifies "
             "that the ledger and this spec are complete, internally coherent and free of identifier leakage. "
             "It makes no clinical claim.")
    L.append("")
    return "\n".join(L) + "\n"


def main():
    build_checks()
    out = [
        ("clinical-rule-ledger.json", json.dumps(ledger_json(), indent=2, sort_keys=False) + "\n"),
        ("clinical-regression-spec.json", json.dumps(spec_json(), indent=2, sort_keys=False) + "\n"),
        ("CLINICAL_RULE_LEDGER.md", ledger_md()),
        ("CLINICAL_REGRESSION_SPEC.md", spec_md()),
    ]
    for name, body in out:
        with open(os.path.join(HERE, name), "w", encoding="utf-8") as fh:
            fh.write(body)
        print(f"wrote governance/{name} ({len(body)} bytes)")
    c = counts()
    print("rules:", c["rules_total"], "tests:", c["tests_total"], "blocking:", c["blocking_tests"])
    print("by_status:", c["by_status"])


if __name__ == "__main__":
    main()
