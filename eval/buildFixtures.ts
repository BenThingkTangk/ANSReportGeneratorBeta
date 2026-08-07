/**
 * Build 10+ synthetic, PHI-free eval fixtures.
 *
 * Run via: `npm run eval:build-fixtures`
 *
 * Each fixture is a single JSON file under `eval/fixtures/<id>.json`
 * conforming to shared/evalTypes.ts:EvalCase. The `.ans` buffer is
 * embedded as base64 — no binary side-cars, no PHI.
 *
 * IMPORTANT — fixture authoring rules:
 *   - Use synthetic patient names only (Test Patient One, Sample A, etc.)
 *   - Never include real DOBs / MRNs / physician names
 *   - Treat the ASCII block as the truth-bearing channel for ratios + BP
 *   - Cover the 5 scoring scenarios + edge cases
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSyntheticAns } from "../api/_ans/__tests__/buildSyntheticAns";
import type { EvalCase, EvalCaseScenario } from "../shared/evalTypes";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");

// ----------------------------------------------------------------------------
// ASCII block helper — emits parser-friendly sectioned text.
//
// The parser's sectionizer treats words like "Resting", "Standing",
// "Baseline", "Stand" as section *headings* — every occurrence cuts a new
// section. So we must emit each heading exactly ONCE and put the labeled
// fields beneath it on their own lines.
// ----------------------------------------------------------------------------

interface PhaseSpec {
  hr?: number | null;
  sbp?: number | null;
  dbp?: number | null;
}

interface RatioSpec {
  eiRatio?: number | null;
  valsalvaRatio?: number | null;
  thirtyFifteenRatio?: number | null;
}

function asciiSection(heading: string, lines: string[]): string {
  return [heading, ...lines, ""].join("\r\n");
}

function phaseLines(p: PhaseSpec): string[] {
  const out: string[] = [];
  if (p.hr != null) out.push(`Heart Rate = ${p.hr} bpm`);
  if (p.sbp != null && p.dbp != null) out.push(`BP = ${p.sbp}/${p.dbp} mmHg`);
  return out;
}

function buildAsciiBlock(
  baseline?: PhaseSpec,
  stand?: PhaseSpec,
  ratios?: RatioSpec,
  tail?: string,
): string {
  const parts: string[] = [];
  if (baseline) parts.push(asciiSection("Baseline", phaseLines(baseline)));
  if (stand) parts.push(asciiSection("Standing", phaseLines(stand)));
  if (ratios) {
    const rl: string[] = [];
    if (ratios.eiRatio != null) rl.push(`E/I Ratio = ${ratios.eiRatio.toFixed(2)}`);
    if (ratios.valsalvaRatio != null) rl.push(`Valsalva Ratio = ${ratios.valsalvaRatio.toFixed(2)}`);
    if (ratios.thirtyFifteenRatio != null) rl.push(`30:15 Ratio = ${ratios.thirtyFifteenRatio.toFixed(2)}`);
    parts.push(asciiSection("Autonomic Ratios", rl));
  }
  if (tail) parts.push(tail);
  return parts.join("\r\n");
}

interface FixtureSpec {
  id: string;
  description: string;
  scenario: EvalCaseScenario;
  clinicianNotes?: string;
  provenance?: string;
  ans: Parameters<typeof buildSyntheticAns>[0];
  fileName: string;
  expectedFields: EvalCase["expectedFields"];
  expectedScores: EvalCase["expectedScores"];
  expectedFlags: EvalCase["expectedFlags"];
}

// ----------------------------------------------------------------------------
// Fixture library
// ----------------------------------------------------------------------------

const FIXTURES: FixtureSpec[] = [
  // 1. NORMAL — middle-aged adult, every ratio + BP present, all in range.
  {
    id: "normal-001-female-45",
    description: "Normal female, age 45 — all ratios and BP within age-banded normal range",
    scenario: "normal",
    clinicianNotes: "Baseline healthy reference. No flags expected.",
    provenance: "synthetic",
    fileName: "normal-001-female-45.ans",
    ans: {
      lastName: "TestPatient",
      firstName: "One",
      dobIso: "1980-01-15",
      sex: "Female",
      physician: "Reviewer",
      studyDateIso: "2025-01-15",
      asciiBlock: buildAsciiBlock(
        { hr: 70, sbp: 120, dbp: 78 },
        { hr: 78, sbp: 118, dbp: 76 },
        { eiRatio: 1.32, valsalvaRatio: 1.60, thirtyFifteenRatio: 1.15 },
      ),
    },
    expectedFields: {
      lastName: { value: "TestPatient" },
      firstName: { value: "One" },
      sex: { value: "Female" },
      ageAtStudy: { value: 45, tolerance: 1 },
      physician: { value: "Reviewer" },
      eiRatio: { value: 1.32, tolerance: 0.02 },
      valsalvaRatio: { value: 1.60, tolerance: 0.02 },
      thirtyFifteenRatio: { value: 1.15, tolerance: 0.02 },
    },
    expectedScores: {
      cardiovagal: { assessable: true, severity: "normal", minConfidence: "Medium" },
      adrenergic: { assessable: true, severity: "normal", minConfidence: "Medium" },
      sudomotor: { assessable: false },
      expectedTotalSeverity: 0,
      totalSeverityTolerance: 0,
    },
    expectedFlags: {
      phenotypes: [
        { id: "orthostatic_hypotension", present: false },
        { id: "pots_like", present: false },
        { id: "cardiovagal_impairment", present: false },
        { id: "adrenergic_impairment", present: false },
      ],
      forbiddenFindingCodes: ["E_I_RATIO_LOW", "E_I_RATIO_SEVERE", "ORTHO_SBP_DROP_SEVERE"],
    },
  },

  // 2. NORMAL — young adult, slightly different age band.
  {
    id: "normal-002-male-28",
    description: "Normal male, age 28 — youth-band ratios",
    scenario: "normal",
    fileName: "normal-002-male-28.ans",
    provenance: "synthetic",
    ans: {
      lastName: "TestPatient",
      firstName: "Two",
      dobIso: "1997-06-10",
      sex: "Male",
      physician: "Reviewer",
      studyDateIso: "2025-06-10",
      asciiBlock: buildAsciiBlock(
        { hr: 62, sbp: 118, dbp: 74 },
        { hr: 72, sbp: 116, dbp: 74 },
        { eiRatio: 1.40, valsalvaRatio: 1.75, thirtyFifteenRatio: 1.20 },
      ),
    },
    expectedFields: {
      sex: { value: "Male" },
      ageAtStudy: { value: 28, tolerance: 1 },
      eiRatio: { value: 1.40, tolerance: 0.02 },
      valsalvaRatio: { value: 1.75, tolerance: 0.02 },
    },
    expectedScores: {
      cardiovagal: { assessable: true, severity: "normal" },
      adrenergic: { assessable: true, severity: "normal" },
      sudomotor: { assessable: false },
    },
    expectedFlags: {
      phenotypes: [
        { id: "orthostatic_hypotension", present: false },
        { id: "pots_like", present: false },
      ],
    },
  },

  // 3. ABNORMAL — PhysioPS-low cardiovagal ratios, no orthostatic hypotension.
  {
    id: "abnormal-001-cardiovagal-severe",
    description: "Low cardiovagal ratios, BP stable on stand",
    scenario: "abnormal",
    clinicianNotes: "All three ratios are Low by the PhysioPS age-specific limits. The vendor report does not publish a separate severe ratio cutoff.",
    fileName: "abnormal-001-cardiovagal-severe.ans",
    provenance: "synthetic",
    ans: {
      lastName: "TestPatient",
      firstName: "Three",
      dobIso: "1965-03-20",
      sex: "Male",
      physician: "Reviewer",
      studyDateIso: "2025-03-20",
      asciiBlock: buildAsciiBlock(
        { hr: 72, sbp: 128, dbp: 80 },
        { hr: 78, sbp: 126, dbp: 79 },
        { eiRatio: 1.03, valsalvaRatio: 1.10, thirtyFifteenRatio: 0.97 },
      ),
    },
    expectedFields: {
      ageAtStudy: { value: 60, tolerance: 1 },
      eiRatio: { value: 1.03, tolerance: 0.02 },
      valsalvaRatio: { value: 1.10, tolerance: 0.02 },
    },
    expectedScores: {
      cardiovagal: { assessable: true, severity: "mild", expectedValue: 1 },
      adrenergic: { assessable: true, severity: "normal" },
      sudomotor: { assessable: false },
    },
    expectedFlags: {
      phenotypes: [
        { id: "cardiovagal_impairment", present: true },
        { id: "orthostatic_hypotension", present: false },
        { id: "possible_can_risk", present: false },
      ],
      expectedFindingCodes: ["E_I_RATIO_LOW", "VALSALVA_RATIO_LOW"],
    },
  },

  // 4. ABNORMAL — orthostatic hypotension, normal cardiovagal.
  {
    id: "abnormal-002-orthostatic-hypotension",
    description: "Orthostatic hypotension on stand, cardiovagal intact",
    scenario: "abnormal",
    fileName: "abnormal-002-orthostatic-hypotension.ans",
    provenance: "synthetic",
    ans: {
      lastName: "TestPatient",
      firstName: "Four",
      dobIso: "1955-09-01",
      sex: "Female",
      physician: "Reviewer",
      studyDateIso: "2025-09-01",
      asciiBlock: buildAsciiBlock(
        { hr: 70, sbp: 132, dbp: 82 },
        { hr: 85, sbp: 105, dbp: 72 },
        { eiRatio: 1.15, valsalvaRatio: 1.40, thirtyFifteenRatio: 1.10 },
      ),
    },
    expectedFields: {
      baselineSbp: { value: 132, tolerance: 1 },
      standSbp: { value: 105, tolerance: 1 },
      eiRatio: { value: 1.15, tolerance: 0.02 },
    },
    expectedScores: {
      cardiovagal: { assessable: true, severity: "normal" },
      adrenergic: { assessable: true, severity: "moderate" },
      sudomotor: { assessable: false },
    },
    expectedFlags: {
      phenotypes: [
        { id: "orthostatic_hypotension", present: true },
        { id: "cardiovagal_impairment", present: false },
        // ΔSBP=27 mmHg → scorer also raises adrenergic_impairment; this is
        // clinically expected for the OH pattern.
        { id: "adrenergic_impairment", present: true },
      ],
      expectedFindingCodes: ["ORTHO_SBP_DROP_MODERATE"],
    },
  },

  // 5. ABNORMAL — combined cardiovagal + adrenergic (CAN-risk pattern).
  {
    id: "abnormal-003-can-risk",
    description: "Multi-domain abnormality: mild cardiovagal + severe adrenergic + OH — CAN risk threshold not met",
    scenario: "abnormal",
    clinicianNotes: "Cardiovagal ratios mild (1.04/1.18/0.99), ΔSBP=30 mmHg severe. Tests that possible_can_risk stays OFF when only one domain is moderate+.",
    fileName: "abnormal-003-can-risk.ans",
    provenance: "synthetic",
    ans: {
      lastName: "TestPatient",
      firstName: "Five",
      dobIso: "1960-12-05",
      sex: "Female",
      physician: "Reviewer",
      studyDateIso: "2025-12-05",
      asciiBlock: buildAsciiBlock(
        { hr: 75, sbp: 135, dbp: 85 },
        { hr: 95, sbp: 105, dbp: 72 },
        { eiRatio: 1.04, valsalvaRatio: 1.18, thirtyFifteenRatio: 0.99 },
      ),
    },
    expectedFields: {
      eiRatio: { value: 1.04, tolerance: 0.02 },
    },
    expectedScores: {
      // Cardiovagal severity reflects the deterministic age-banded scorer
      // — ratios of 1.04/1.18/0.99 land at "mild" under the current bands
      // rather than "severe". Adrenergic comes in as "severe" because
      // ΔSBP=30 mmHg crosses the sbpDropSevere threshold.
      cardiovagal: { assessable: true, severity: "mild" },
      adrenergic: { assessable: true, severity: "severe" },
      sudomotor: { assessable: false },
    },
    expectedFlags: {
      phenotypes: [
        { id: "cardiovagal_impairment", present: true },
        { id: "adrenergic_impairment", present: true },
        // ΔSBP=30 mmHg also raises orthostatic_hypotension — expected.
        { id: "orthostatic_hypotension", present: true },
        // possible_can_risk requires BOTH domains ≥ moderate; cardiovagal
        // lands at "mild" here so the engine correctly withholds the flag.
        { id: "possible_can_risk", present: false },
      ],
    },
  },

  // 6. MISSING — no ratios at all, BP partial.
  {
    id: "missing-001-no-ratios",
    description: "No ratios extractable, BP only on baseline",
    scenario: "missing",
    clinicianNotes: "Cardiovagal must come back not_assessed. Adrenergic must come back not_assessed (no stand BP).",
    fileName: "missing-001-no-ratios.ans",
    provenance: "synthetic",
    ans: {
      lastName: "TestPatient",
      firstName: "Six",
      dobIso: "1975-07-22",
      sex: "Male",
      physician: "Reviewer",
      studyDateIso: "2025-07-22",
      asciiBlock: buildAsciiBlock(
        { hr: 72, sbp: 122, dbp: 78 },
        undefined,
        undefined,
        "(no further data captured)\r\n",
      ),
    },
    expectedFields: {
      baselineSbp: { value: 122, tolerance: 1 },
      expectedMissing: [
        "ratios.eiRatio",
        "ratios.valsalvaRatio",
        "ratios.thirtyFifteenRatio",
        "standOrTilt.bp.sbp",
      ],
    },
    expectedScores: {
      cardiovagal: { assessable: false },
      adrenergic: { assessable: false },
      sudomotor: { assessable: false },
      expectedTotalSeverity: 0,
    },
    expectedFlags: {
      phenotypes: [],
      expectedBlockedClaims: [
        "Orthostatic hypotension pattern",
        "Cardiovagal impairment",
        "Adrenergic impairment",
      ],
    },
  },

  // 7. MISSING — demographics missing, ECG intact.
  {
    id: "missing-002-demographics",
    description: "Empty patient names + missing DOB — extractor must report missing without fabricating",
    scenario: "missing",
    fileName: "missing-002-demographics.ans",
    provenance: "synthetic",
    ans: {
      lastName: "",
      firstName: "",
      dobIso: null,
      sex: "",
      physician: "",
      asciiBlock: buildAsciiBlock(
        { hr: 70, sbp: 120, dbp: 78 },
        undefined,
        { eiRatio: 1.25 },
      ),
    },
    expectedFields: {
      expectedMissing: [
        "patient.lastName",
        "patient.firstName",
        "patient.dob",
      ],
    },
    expectedScores: {
      cardiovagal: { assessable: true },
      adrenergic: { assessable: false },
      sudomotor: { assessable: false },
    },
    expectedFlags: {
      phenotypes: [],
    },
  },

  // 8. CONFLICTING — POTS-like HR rise without BP drop (must NOT flag OH).
  {
    id: "conflicting-001-pots-no-oh",
    description: "POTS-like HR rise without orthostatic hypotension",
    scenario: "conflicting",
    clinicianNotes: "HR +45 bpm on stand but BP holds. Engine must raise pots_like and NOT orthostatic_hypotension.",
    fileName: "conflicting-001-pots-no-oh.ans",
    provenance: "synthetic",
    ans: {
      lastName: "TestPatient",
      firstName: "Eight",
      dobIso: "2000-04-04",
      sex: "Female",
      physician: "Reviewer",
      studyDateIso: "2025-04-04",
      asciiBlock: buildAsciiBlock(
        { hr: 70, sbp: 118, dbp: 76 },
        { hr: 115, sbp: 116, dbp: 78 },
        { eiRatio: 1.30, valsalvaRatio: 1.60, thirtyFifteenRatio: 1.11 },
      ),
    },
    expectedFields: {
      baselineHr: { value: 70, tolerance: 1 },
      standHr: { value: 115, tolerance: 1 },
    },
    expectedScores: {
      cardiovagal: { assessable: true, severity: "normal" },
      adrenergic: { assessable: true, severity: "normal" },
    },
    expectedFlags: {
      phenotypes: [
        { id: "pots_like", present: true },
        { id: "orthostatic_hypotension", present: false },
      ],
    },
  },

  // 9. CONFLICTING — borderline values (exactly at threshold).
  {
    id: "conflicting-002-borderline",
    description: "Borderline values at age-band thresholds",
    scenario: "conflicting",
    fileName: "conflicting-002-borderline.ans",
    provenance: "synthetic",
    ans: {
      lastName: "TestPatient",
      firstName: "Nine",
      dobIso: "1970-11-11",
      sex: "Male",
      physician: "Reviewer",
      studyDateIso: "2025-11-11",
      asciiBlock: buildAsciiBlock(
        { hr: 72, sbp: 130, dbp: 82 },
        { hr: 80, sbp: 120, dbp: 76 },
        // 30:15 is exactly at the calibrated limit. PhysioPS prints a strict
        // greater-than operator, so equality is Low (without an invented
        // severe subdivision).
        { eiRatio: 1.10, valsalvaRatio: 1.35, thirtyFifteenRatio: 1.092 },
      ),
    },
    expectedFields: {
      eiRatio: { value: 1.10, tolerance: 0.02 },
    },
    expectedScores: {
      cardiovagal: { assessable: true },
      adrenergic: { assessable: true, severity: "mild" },
    },
    expectedFlags: {
      phenotypes: [
        { id: "orthostatic_hypotension", present: false },
        { id: "cardiovagal_impairment", present: true },
      ],
    },
  },

  // 10. LOW QUALITY — usable ECG flag stays true (text-only), but ratios consistent with mild dysfunction.
  {
    id: "low-quality-001-mild-dysfunction",
    description: "Mild cardiovagal dysfunction, BP intact",
    scenario: "low_quality",
    clinicianNotes: "Engine should mark Medium or Low confidence on cardiovagal because only one ratio is abnormal.",
    fileName: "low-quality-001-mild-dysfunction.ans",
    provenance: "synthetic",
    ans: {
      lastName: "TestPatient",
      firstName: "Ten",
      dobIso: "1968-08-08",
      sex: "Female",
      physician: "Reviewer",
      studyDateIso: "2025-08-08",
      asciiBlock: buildAsciiBlock(
        { hr: 74, sbp: 124, dbp: 78 },
        { hr: 82, sbp: 122, dbp: 78 },
        { eiRatio: 1.07, valsalvaRatio: 1.45, thirtyFifteenRatio: 1.05 },
      ),
    },
    expectedFields: {
      eiRatio: { value: 1.07, tolerance: 0.02 },
    },
    expectedScores: {
      cardiovagal: { assessable: true, severity: "mild" },
      adrenergic: { assessable: true, severity: "normal" },
    },
    expectedFlags: {
      phenotypes: [
        { id: "cardiovagal_impairment", present: true },
        { id: "possible_can_risk", present: false },
      ],
    },
  },

  // 11. EDGE — truncated ECG / short file (truncateTo).
  {
    id: "edge-001-truncated-ecg",
    description: "Truncated .ans file (ECG region cut short)",
    scenario: "edge_case",
    clinicianNotes: "Parser must still extract demographics + ratios from ASCII; ECG truncation must be flagged.",
    fileName: "edge-001-truncated-ecg.ans",
    provenance: "synthetic",
    ans: {
      lastName: "TestPatient",
      firstName: "Eleven",
      dobIso: "1990-02-02",
      sex: "Male",
      physician: "Reviewer",
      studyDateIso: "2025-02-02",
      asciiBlock: buildAsciiBlock(
        { hr: 68, sbp: 118, dbp: 74 },
        { hr: 78, sbp: 116, dbp: 74 },
        { eiRatio: 1.36, valsalvaRatio: 1.70, thirtyFifteenRatio: 1.18 },
      ),
      sampleCount: 1000,
      truncateTo: 600,   // chop the ECG region
    },
    expectedFields: {
      eiRatio: { value: 1.36, tolerance: 0.02 },
      valsalvaRatio: { value: 1.70, tolerance: 0.02 },
    },
    expectedScores: {
      cardiovagal: { assessable: true, severity: "normal" },
      adrenergic: { assessable: true, severity: "normal" },
    },
    expectedFlags: {
      phenotypes: [
        { id: "orthostatic_hypotension", present: false },
      ],
    },
  },

  // 12. EDGE — implausibly old DOB → extractor must reject and report missing age.
  {
    id: "edge-002-impossible-dob",
    description: "DOB encodes implausible date — extractor must not fabricate ageAtStudy",
    scenario: "edge_case",
    fileName: "edge-002-impossible-dob.ans",
    provenance: "synthetic",
    ans: {
      lastName: "TestPatient",
      firstName: "Twelve",
      dobIso: null,           // all-zero DOB bytes → impossible
      sex: "Other",
      physician: "Reviewer",
      asciiBlock: buildAsciiBlock(
        { hr: 70, sbp: 120, dbp: 76 },
        { hr: 78, sbp: 118, dbp: 76 },
        { eiRatio: 1.28, valsalvaRatio: 1.55, thirtyFifteenRatio: 1.12 },
      ),
    },
    expectedFields: {
      expectedMissing: ["patient.dob", "patient.ageAtStudy"],
      eiRatio: { value: 1.28, tolerance: 0.02 },
    },
    expectedScores: {
      cardiovagal: { assessable: true },
      adrenergic: { assessable: true },
    },
    expectedFlags: {
      phenotypes: [],
    },
  },

  // 13. PEDIATRIC — adolescent (age <18), normal autonomic profile for age band.
  {
    id: "pediatric-001-age-14",
    description: "Pediatric subject, age 14 — youth-band ratios with brisk HR response on stand",
    scenario: "normal",
    clinicianNotes: "Adolescent baseline: HR rise of 20 bpm and elevated E:I are physiologic. No phenotype flags expected.",
    fileName: "pediatric-001-age-14.ans",
    provenance: "synthetic",
    ans: {
      lastName: "TestPatient",
      firstName: "Thirteen",
      dobIso: "2011-04-12",
      sex: "Female",
      physician: "Reviewer",
      studyDateIso: "2025-04-12",
      asciiBlock: buildAsciiBlock(
        { hr: 74, sbp: 108, dbp: 66 },
        { hr: 94, sbp: 106, dbp: 70 },
        { eiRatio: 1.55, valsalvaRatio: 1.95, thirtyFifteenRatio: 1.28 },
      ),
    },
    expectedFields: {
      sex: { value: "Female" },
      ageAtStudy: { value: 14, tolerance: 1 },
      eiRatio: { value: 1.55, tolerance: 0.02 },
      valsalvaRatio: { value: 1.95, tolerance: 0.02 },
    },
    expectedScores: {
      cardiovagal: { assessable: true, severity: "normal" },
      adrenergic: { assessable: true, severity: "normal" },
      sudomotor: { assessable: false },
    },
    expectedFlags: {
      phenotypes: [
        { id: "orthostatic_hypotension", present: false },
        { id: "cardiovagal_impairment", present: false },
      ],
      forbiddenFindingCodes: ["E_I_RATIO_LOW", "E_I_RATIO_SEVERE", "ORTHO_SBP_DROP_SEVERE"],
    },
  },

  // 14. ATHLETE-BRADYCARDIA — endurance athlete with resting HR <50, normal ratios.
  {
    id: "athlete-001-bradycardia",
    description: "Endurance athlete, age 32 — resting bradycardia (HR 44) with preserved vagal tone",
    scenario: "edge_case",
    clinicianNotes: "Low resting HR is a training adaptation. Cardiovagal ratios should be high-normal. No CAN or POTS flags.",
    fileName: "athlete-001-bradycardia.ans",
    provenance: "synthetic",
    ans: {
      lastName: "TestPatient",
      firstName: "Fourteen",
      dobIso: "1993-07-22",
      sex: "Male",
      physician: "Reviewer",
      studyDateIso: "2025-07-22",
      asciiBlock: buildAsciiBlock(
        { hr: 44, sbp: 110, dbp: 68 },
        { hr: 60, sbp: 108, dbp: 70 },
        { eiRatio: 1.65, valsalvaRatio: 2.05, thirtyFifteenRatio: 1.35 },
      ),
    },
    expectedFields: {
      sex: { value: "Male" },
      ageAtStudy: { value: 32, tolerance: 1 },
      eiRatio: { value: 1.65, tolerance: 0.02 },
      valsalvaRatio: { value: 2.05, tolerance: 0.02 },
    },
    expectedScores: {
      cardiovagal: { assessable: true, severity: "normal" },
      adrenergic: { assessable: true, severity: "normal" },
      sudomotor: { assessable: false },
    },
    expectedFlags: {
      phenotypes: [
        { id: "pots_like", present: false },
        { id: "cardiovagal_impairment", present: false },
        { id: "possible_can_risk", present: false },
      ],
      forbiddenFindingCodes: ["E_I_RATIO_LOW", "E_I_RATIO_SEVERE"],
    },
  },

  // 15. MIXED-PHENOTYPE — POTS-like HR rise PLUS low cardiovagal ratios.
  {
    id: "mixed-001-pots-and-cardiovagal",
    description: "Mixed phenotype: POTS-like HR rise without OH and low cardiovagal ratios",
    scenario: "abnormal",
    clinicianNotes: "Tests detector composition: pots_like and cardiovagal_impairment should both flag present=true; possible_can_risk should remain false (adrenergic still normal).",
    fileName: "mixed-001-pots-and-cardiovagal.ans",
    provenance: "synthetic",
    ans: {
      lastName: "TestPatient",
      firstName: "Fifteen",
      dobIso: "1998-11-30",
      sex: "Female",
      physician: "Reviewer",
      studyDateIso: "2025-11-30",
      asciiBlock: buildAsciiBlock(
        { hr: 78, sbp: 118, dbp: 74 },
        { hr: 116, sbp: 116, dbp: 78 },
        { eiRatio: 1.08, valsalvaRatio: 1.18, thirtyFifteenRatio: 1.02 },
      ),
    },
    expectedFields: {
      ageAtStudy: { value: 27, tolerance: 1 },
      eiRatio: { value: 1.08, tolerance: 0.02 },
      valsalvaRatio: { value: 1.18, tolerance: 0.02 },
    },
    expectedScores: {
      cardiovagal: { assessable: true, severity: "mild" },
      adrenergic: { assessable: true, severity: "normal" },
      sudomotor: { assessable: false },
    },
    expectedFlags: {
      phenotypes: [
        { id: "pots_like", present: true },
        { id: "cardiovagal_impairment", present: true },
        { id: "orthostatic_hypotension", present: false },
        { id: "possible_can_risk", present: false },
      ],
    },
  },
];

// ----------------------------------------------------------------------------
// Writer
// ----------------------------------------------------------------------------

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function specToCase(spec: FixtureSpec): EvalCase {
  const buf = buildSyntheticAns(spec.ans);
  return {
    id: spec.id,
    description: spec.description,
    scenario: spec.scenario,
    source: "synthetic",
    clinicianNotes: spec.clinicianNotes,
    provenance: spec.provenance,
    ansBase64: buf.toString("base64"),
    fileName: spec.fileName,
    expectedFields: spec.expectedFields,
    expectedScores: spec.expectedScores,
    expectedFlags: spec.expectedFlags,
    createdAt: new Date().toISOString(),
  };
}

function main() {
  ensureDir(FIXTURES_DIR);
  let written = 0;
  for (const spec of FIXTURES) {
    const c = specToCase(spec);
    const dest = join(FIXTURES_DIR, `${c.id}.json`);
    writeFileSync(dest, JSON.stringify(c, null, 2) + "\n", "utf8");
    written += 1;
    console.log(`✓ ${c.id} (${c.scenario})`);
  }
  console.log(`\nWrote ${written} fixtures → ${FIXTURES_DIR}`);
}

main();
