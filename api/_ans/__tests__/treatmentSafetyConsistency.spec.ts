/**
 * Treatment-safety + patient/clinician hypothesis-consistency regression.
 *
 * From the live paired Jill QA (build 902baca):
 *   • the report auto-prescribed "Alpha-Lipoic Acid 600 mg three times daily" from
 *     an uploaded test alone — unsafe individualized dosing without a clinician;
 *   • the patient view labeled "Parasympathetic Excess at Rest" while the
 *     clinician evidence described parasympathetic withdrawal — a contradiction.
 *
 * These tests (generic; synthetic .ans + paired baseline-only vendor metrics,
 * CI-safe, no PHI) assert:
 *   • NO therapy carries a dose/frequency, and no ALA/midodrine/etc. dosage text;
 *   • therapies state a licensed clinician is required;
 *   • the low-SB-with-normal-RFa case yields relative dominance, never PE and
 *     never PW simultaneously;
 *   • the deterministic synopsis makes no unsupported daily-life symptom claims;
 *   • normal cardiovagal Ewing ratios are preserved.
 */
import { describe, it, expect } from "vitest";
import { parseANSFile, generateColomboReport } from "../../upload.js";
import { buildSyntheticAns } from "./buildSyntheticAns.js";
import { buildPatientSynopsis } from "../../../shared/deterministicSynopsis.js";

function jillLikeReport() {
  // Synthetic recording; paired vendor supplies baseline spectral+BP only, with
  // Jill-like magnitudes (arbitrary generic values: low-normal LFa, normal RFa,
  // low SB). No standing data.
  const buf = buildSyntheticAns({
    lastName: "Doe",
    firstName: "Jane",
    dobIso: "1969-07-12",
    sex: "Female",
    physician: "Dr. Example",
    samplingInterval: 0.004,
    sampleCount: 250 * 60 * 16,
  });
  const data = parseANSFile(buf, "Doe-Jane-Mon-Jan-06-2025.ans");
  return generateColomboReport(data, { LFa: 0.91, RFa: 5.13, SB: 0.18, SBP: 92, DBP: 55 } as any);
}

const DOSAGE_RE =
  /\b\d+(\.\d+)?\s*(mg|mcg|g|ml|tbsp|tsp|glasses|oz|units?)\b|\bTID\b|\btwice daily\b|\bthree times daily\b|\bmg\/day\b/i;

describe("Treatment safety — no individualized dosing from an uploaded test alone", () => {
  const report = jillLikeReport();
  const therapies: any[] = report.therapyRecommendations ?? [];

  it("emits at least one clinician-facing item", () => {
    expect(therapies.length).toBeGreaterThan(0);
  });

  it("NO therapy has a dose field", () => {
    const withDose = therapies.filter((t) => t.dose != null && String(t.dose).trim() !== "");
    expect(withDose.map((t) => t.intervention)).toEqual([]);
  });

  it("NO therapy text contains a dosage / frequency", () => {
    const offenders = therapies.filter((t) => DOSAGE_RE.test(JSON.stringify(t)));
    expect(offenders.map((t) => t.intervention)).toEqual([]);
  });

  it("does NOT auto-prescribe ALA / midodrine / nortriptyline etc. as instructions", () => {
    const blob = JSON.stringify(therapies);
    // "alpha-lipoic acid" may appear ONLY as a discussion topic (no dose); the
    // specific 600 mg TID prescription must be gone.
    expect(blob).not.toMatch(/600\s*mg/i);
    expect(blob).not.toMatch(/2\.5\s*mg/i);
    expect(blob).not.toMatch(/\bMidodrine\b(?![^]*licensed clinician)/i);
  });

  it("states that therapies require a licensed clinician", () => {
    const blob = JSON.stringify(therapies).toLowerCase();
    expect(blob).toMatch(/licensed clinician/);
  });
});

describe("Hypothesis consistency — low SB with normal RFa", () => {
  const report = jillLikeReport();
  const codes = (report.indications ?? []).map((i: any) => i.code);

  it("labels relative parasympathetic dominance, not excess", () => {
    expect(codes).toContain("RPD_REST");
    expect(codes).not.toContain("PE_REST");
  });

  it("patterns are neither parasympathetic excess NOR withdrawal", () => {
    expect(report.dysfunctionPatterns?.parasympatheticExcess).toBeFalsy();
    expect(report.dysfunctionPatterns?.parasympatheticWithdrawal).toBeFalsy();
  });

  it("patient synopsis makes no unsupported daily-life symptom claims", () => {
    // upload.ts and shared/schema define structurally-identical but nominally
    // distinct ANSReport types; cast for the shared synopsis builder.
    const syn = buildPatientSynopsis(report as any).toLowerCase();
    for (const banned of [
      "low mood",
      "sluggish digestion",
      "foggy",
      "low energy",
      "depression",
      "migraines",
    ]) {
      expect(syn.includes(banned), `synopsis should not assert "${banned}"`).toBe(false);
    }
  });

  it("preserves the cardiovagal Ewing ratios (present + classified, not suppressed)", () => {
    // Values come from the .ans (not vendor metrics); assert they survive and are
    // classified rather than being suppressed by the classification/therapy fix.
    expect(typeof report.ratios?.eiRatio?.value).toBe("number");
    expect(typeof report.ratios?.valsalvaRatio?.value).toBe("number");
    expect(typeof report.ratios?.thirtyFifteenRatio?.value).toBe("number");
    expect(report.ratios?.eiRatio?.classification?.severity).toBeTruthy();
  });
});

describe("Rendered full-report — banned strings (normal-RFa / low-SB paired case)", () => {
  // The whole report object + the patient synopsis together approximate what both
  // the patient and clinician tabs render. None of the live-QA banned strings may
  // appear anywhere for this normal-RFa + low-SB paired case.
  const report = jillLikeReport();
  const blob = JSON.stringify(report) + " " + buildPatientSynopsis(report as any);

  const BANNED = [
    // (2) hero excess/intensity + symptom framing
    "prolonged 'rest and digest' state",
    "prolonged rest and digest",
    "low exercise tolerance",
    "associated with fatigue",
    // (2)/(1) mislabel
    "Parasympathetic Excess at Rest",
    "Parasympathetic-dominant. Your nervous system",
    // (3) unvalidated slow-HR claim
    "slow resting heart rate",
    // (4) watch items from normal / unread / uncaptured fields
    "Parasympathetic activity (RFa) normalization",
    "should return to 0.09",
    "Symptom improvement (fatigue",
  ];

  for (const s of BANNED) {
    it(`does not contain: "${s}"`, () => {
      expect(blob.includes(s), `banned string present: "${s}"`).toBe(false);
    });
  }

  it("watch items (monitorParameters) contain no normal-RFa, unread-FRF, or symptom lines", () => {
    const mp = (report.followUp?.monitorParameters ?? []).join(" | ");
    expect(mp).not.toMatch(/RFa\)\s*normalization/i);
    expect(mp).not.toMatch(/FRF/i); // FRF was not read for this case
    expect(mp).not.toMatch(/symptom/i);
    expect(mp).not.toMatch(/fatigue|dizziness|headache/i);
  });

  it("hero balance interpretation uses reduced-sympathetic / relative-dominance language", () => {
    const interp = report.autonomicBalance?.interpretation ?? "";
    expect(interp).toMatch(/relative parasympathetic dominance|reduced sympathetic modulation/i);
    // "excess" may appear only to NEGATE it ("not an excess"); never as a claim.
    expect(interp).not.toMatch(/(?<!not an )excess/i);
    expect(interp).not.toMatch(/fatigue|exercise tolerance/i);
  });
});
