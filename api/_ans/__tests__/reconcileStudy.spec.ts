/**
 * Regression + safety tests for the single-evaluation-engine reconciliation
 * (S2-1 / S2-2). When the parser leaves sympatheticParasympathetic / ratio
 * fields MISSING, reconcileStudyWithReport must backfill them from the computed
 * report so the deterministic scoring engine sees the same numbers shown
 * elsewhere — WITHOUT overwriting values the parser genuinely extracted.
 */

import { describe, it, expect } from "vitest";
import { reconcileStudyWithReport } from "../reconcileStudy";
import { computeDiagnosticSummary } from "../scoring/index";
import type {
  AnsStudy,
  ProvField,
  PhaseBlock,
  BloodPressure,
} from "../../../shared/ansStudy";

function prov<T>(value: T | null, source: any = "ascii_section", confidence = 1): ProvField<T> {
  if (value === null) {
    return { value: null, provenance: { source: "missing", confidence: 0, warnings: ["missing"] } };
  }
  return { value, provenance: { source, confidence } };
}

function bp(sbp: number | null, dbp: number | null): BloodPressure {
  const mapVal = sbp != null && dbp != null ? Math.round((sbp + 2 * dbp) / 3) : null;
  return { sbp: prov<number>(sbp), dbp: prov<number>(dbp), map: prov<number>(mapVal) };
}

function phase(hr: number | null): PhaseBlock {
  return {
    present: true,
    startSec: prov<number>(null),
    endSec: prov<number>(null),
    heartRate: prov<number>(hr),
    bp: bp(null, null),
    lfa: prov<number>(null),
    rfa: prov<number>(null),
    sb: prov<number>(null),
    notes: [],
  };
}

/** Study whose SP fields + ratios are all MISSING (the S2-1 failure state). */
function studyWithMissingSp(): AnsStudy {
  return {
    schemaVersion: "1.0",
    parsedAt: new Date().toISOString(),
    patient: {
      lastName: prov<string>("Shah"),
      firstName: prov<string>("Jill"),
      dob: prov<string>("1969-07-12"),
      ageAtStudy: prov<number>(56),
      sex: prov<"Male" | "Female" | "Other" | "Unknown">("Female"),
      physician: prov<string>("Dr. Colombo"),
      mrn: prov<string>(null),
    },
    fileMetadata: {
      fileName: prov<string>("Shah-Jill.ans"),
      fileSizeBytes: 0,
      studyDate: prov<string>("2025-09-26"),
      studyStartTime: prov<string>(null),
      procedureType: prov<string>(null),
      samplingRateHz: prov<number>(250),
      samplingInterval: prov<number>(0.004),
      dataPointCount: prov<number>(0),
      ecgTruncated: false,
      device: prov<string>(null),
    },
    anthropometrics: {
      heightInches: prov<number>(66),
      weightLbs: prov<number>(124),
      bmi: prov<number>(20.01),
    },
    ecg: {
      preview: [],
      durationSec: 300,
      quality: { snrDb: 25, motionFraction: 0.02, leadOff: false, usable: true, warnings: [] },
    },
    baseline: phase(56),
    deepBreathing: phase(55),
    valsalva: phase(58),
    standOrTilt: phase(64),
    ratios: {
      eiRatio: prov<number>(null),
      valsalvaRatio: prov<number>(null),
      thirtyFifteenRatio: prov<number>(null),
    },
    sympatheticParasympathetic: {
      restingLfa: prov<number>(null),
      restingRfa: prov<number>(null),
      restingSb: prov<number>(null),
      standingLfa: prov<number>(null),
      standingRfa: prov<number>(null),
      standingSb: prov<number>(null),
      impressionText: prov<string>(null),
    },
    medications: prov<any[]>([]),
    symptoms: prov<any[]>([]),
    conclusions: prov<any[]>([]),
    rawSections: [],
    rawAsciiHead: "",
    extractionWarnings: [],
    parserConfidence: { overall: 0.9, byField: {} } as any,
  } as AnsStudy;
}

/** Computed report carrying Jill's ground-truth phase spectral values. */
function jillReport() {
  return {
    phaseEvents: [
      { phase: "Baseline-A", LFa: 0.91, RFa: 5.13, SB: 0.18 },
      { phase: "DeepBreathing-B", LFa: 7.58, RFa: 2.88, SB: 2.63 },
      { phase: "Baseline-C", LFa: 2.06, RFa: 3.71, SB: 0.55 },
      { phase: "Valsalva-D", LFa: 21.11, RFa: 2.93, SB: 7.2 },
      { phase: "Baseline-E", LFa: 1.02, RFa: 3.89, SB: 0.26 },
      { phase: "Stand-F", LFa: 2.62, RFa: 6.55, SB: 0.4 },
    ],
    ratios: {
      eiRatio: { value: 1.21 },
      valsalvaRatio: { value: 1.43 },
      thirtyFifteenRatio: { value: 1.4 },
    },
  };
}

describe("reconcileStudyWithReport — S2-1 backfill", () => {
  it("backfills missing resting SP fields from the report Baseline-A", () => {
    const out = reconcileStudyWithReport(studyWithMissingSp(), jillReport());
    expect(out.sympatheticParasympathetic.restingLfa.value).toBeCloseTo(0.91, 3);
    expect(out.sympatheticParasympathetic.restingRfa.value).toBeCloseTo(5.13, 3);
    expect(out.sympatheticParasympathetic.restingSb.value).toBeCloseTo(0.18, 3);
  });

  it("backfills missing standing SP fields from the report Stand-F", () => {
    const out = reconcileStudyWithReport(studyWithMissingSp(), jillReport());
    expect(out.sympatheticParasympathetic.standingLfa.value).toBeCloseTo(2.62, 3);
    expect(out.sympatheticParasympathetic.standingRfa.value).toBeCloseTo(6.55, 3);
  });

  it("backfills missing Ewing ratios from the report", () => {
    const out = reconcileStudyWithReport(studyWithMissingSp(), jillReport());
    expect(out.ratios.eiRatio.value).toBeCloseTo(1.21, 3);
    expect(out.ratios.valsalvaRatio.value).toBeCloseTo(1.43, 3);
    expect(out.ratios.thirtyFifteenRatio.value).toBeCloseTo(1.4, 3);
  });

  it("tags backfilled fields with 'computed' provenance (auditable)", () => {
    const out = reconcileStudyWithReport(studyWithMissingSp(), jillReport());
    expect(out.sympatheticParasympathetic.restingRfa.provenance.source).toBe("computed");
  });

  it("does NOT overwrite a value the parser actually extracted (safety)", () => {
    const study = studyWithMissingSp();
    study.sympatheticParasympathetic.restingRfa = prov<number>(9.99, "ascii_section");
    const out = reconcileStudyWithReport(study, jillReport());
    expect(out.sympatheticParasympathetic.restingRfa.value).toBeCloseTo(9.99, 3);
    expect(out.sympatheticParasympathetic.restingRfa.provenance.source).toBe("ascii_section");
  });

  it("does not mutate the input study", () => {
    const study = studyWithMissingSp();
    reconcileStudyWithReport(study, jillReport());
    expect(study.sympatheticParasympathetic.restingRfa.value).toBeNull();
  });
});

describe("engine consistency — S2-2", () => {
  it("scoring engine can evaluate parasympathetic-withdrawal AFTER reconciliation (was blocked before)", () => {
    const before = computeDiagnosticSummary(studyWithMissingSp());
    const blockedBefore = before.unsafeOrUnsupportedClaimsBlocked.some(
      b => /parasympathetic withdrawal/i.test(b.claim),
    );
    expect(blockedBefore).toBe(true);

    const reconciled = reconcileStudyWithReport(studyWithMissingSp(), jillReport());
    const after = computeDiagnosticSummary(reconciled);
    const stillBlocked = after.unsafeOrUnsupportedClaimsBlocked.some(
      b => /parasympathetic withdrawal/i.test(b.claim),
    );
    expect(stillBlocked).toBe(false);
  });
});
