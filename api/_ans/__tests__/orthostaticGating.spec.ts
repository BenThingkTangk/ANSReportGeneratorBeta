/**
 * Defect A regression — orthostatic / adrenergic gating.
 *
 * The live UI showed the patient view claiming "a weakened fight-or-flight
 * response on standing", "a blood-pressure drop when standing", "a tendency
 * toward fainting spells" and "Orthostatic Dysfunction (High Risk)" with
 * midodrine suggestions — while the clinician evidence correctly said adrenergic
 * was NOT assessed and standing BP was missing. Root cause: standing/orthostatic
 * findings were driven by the Stand phase's COMPUTED (estimated) spectral and a
 * broken orthostatic-hypotension formula (compared baseline to a default 120,
 * never used standing BP), even in the paired path where only the BASELINE is
 * vendor-reported and no standing cuff BP exists.
 *
 * These tests prove that with (a) a raw .ans alone and (b) a paired
 * baseline-only OCR result, NO orthostatic/adrenergic/syncope finding, patient
 * symptom claim, or orthostatic treatment is emitted — while a genuine baseline
 * finding (low sympathovagal balance) is still allowed. They are CI-safe:
 * synthetic .ans, no PHI, no external fixture.
 */
import { describe, it, expect } from "vitest";
import { parseANSFile, generateColomboReport } from "../../upload.js";
import { buildSyntheticAns } from "./buildSyntheticAns.js";
import { buildPatientSynopsis } from "../../../shared/deterministicSynopsis.js";

const BANNED_PATIENT_PHRASES = [
  "weakened fight-or-flight response on standing",
  "blood-pressure drop when standing",
  "fainting spells",
];

const ORTHO_INDICATION_CODES =
  /^(OD_HIGH|OD_NORMAL|POTS|PRE_POTS|VVS|NEUROGENIC_SYNCOPE|CARDIOGENIC_SYNCOPE|ORTHOSTATIC_HYPOTENSION)$/;

function makeReport(vendor?: { LFa: number; RFa: number; SB: number; SBP: number; DBP: number }) {
  // Synthetic recording with enough beats to analyze; no standing cuff BP is
  // ever supplied (mirrors the real paired path where the .ans + baseline OCR
  // carry resting BP only).
  const buf = buildSyntheticAns({
    lastName: "Doe",
    firstName: "Jane",
    dobIso: "1969-07-12",
    sex: "Female",
    physician: "Dr. Example",
    samplingInterval: 0.004,
    sampleCount: 250 * 60 * 16, // ~16 min across the 6 phases
  });
  const data = parseANSFile(buf, "Doe-Jane-Mon-Jan-06-2025.ans");
  return generateColomboReport(data, vendor as any);
}

function orthoIndications(report: any): string[] {
  return (report.indications ?? []).map((i: any) => i.code).filter((c: string) => ORTHO_INDICATION_CODES.test(c));
}

function bannedPhrasesIn(report: any): string[] {
  const syn = buildPatientSynopsis(report);
  return BANNED_PATIENT_PHRASES.filter((p) => syn.includes(p));
}

function therapyNames(report: any): string[] {
  return (report.therapyRecommendations ?? []).map((t: any) => String(t.intervention || ""));
}

describe("Defect A — orthostatic/adrenergic gating (raw .ans alone)", () => {
  const report = makeReport();

  it("emits no orthostatic/syncope indication without standing data", () => {
    expect(orthoIndications(report)).toEqual([]);
  });

  it("emits no unsupported standing/orthostatic patient claims", () => {
    expect(bannedPhrasesIn(report)).toEqual([]);
  });

  it("does not set the orthostaticHypotension pattern without standing BP", () => {
    expect(report.dysfunctionPatterns?.orthostaticHypotension).toBeFalsy();
  });

  it("does not recommend midodrine or salt/hydration orthostatic therapy", () => {
    const names = therapyNames(report);
    expect(names.some((n) => /midodrine/i.test(n))).toBe(false);
    expect(names.some((n) => /salt|hydration/i.test(n))).toBe(false);
  });
});

describe("Defect A — paired baseline-only OCR (no standing phase)", () => {
  // Vendor supplies BASELINE spectral + resting BP only (the real Jill live
  // shape). Standing phase remains computed/estimated with no cuff BP.
  const report = makeReport({ LFa: 0.91, RFa: 5.13, SB: 0.18, SBP: 92, DBP: 55 });

  it("still emits no orthostatic/adrenergic/syncope finding", () => {
    expect(orthoIndications(report)).toEqual([]);
  });

  it("still emits no unsupported standing/orthostatic patient claims", () => {
    expect(bannedPhrasesIn(report)).toEqual([]);
  });

  it("sympatheticWithdrawal / maskedSW / vasovagalRisk patterns are not set from estimated standing spectral", () => {
    const p = report.dysfunctionPatterns ?? {};
    expect(p.sympatheticWithdrawal).toBeFalsy();
    expect(p.maskedSW).toBeFalsy();
    expect(p.vasovagalRisk).toBeFalsy();
    expect(p.orthostaticHypotension).toBeFalsy();
  });

  it("does not recommend midodrine (SW therapy) from unsupported standing data", () => {
    expect(therapyNames(report).some((n) => /midodrine/i.test(n))).toBe(false);
  });

  it("still allows a legitimate baseline finding (low sympathovagal balance) from real vendor data", () => {
    // Vendor SB 0.18 (<0.4) is a genuine resting parasympathetic-dominance
    // signal — gating must not over-suppress supported baseline findings.
    const names = therapyNames(report).join(" | ");
    expect(names).toMatch(/sympathovagal balance|Restore/i);
  });
});
