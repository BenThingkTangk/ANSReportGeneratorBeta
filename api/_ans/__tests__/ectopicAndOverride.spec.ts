/**
 * Regression tests for ectopic-beat carry-through (S2-5) and the Numerical
 * Summary ground-truth override mechanism (S1-4 / S2-6).
 */

import { describe, it, expect } from "vitest";
import { ansStudyToLegacy } from "../legacyAdapter";
import {
  lookupNumericalSummaryOverride,
  applyPhaseOverride,
} from "../numericalSummaryOverride";
import type { AnsStudy } from "../../../shared/ansStudy";

function prov<T>(value: T | null): any {
  return value === null
    ? { value: null, provenance: { source: "missing", confidence: 0 } }
    : { value, provenance: { source: "ascii_section", confidence: 1 } };
}

/** Minimal AnsStudy stub sufficient for ansStudyToLegacy(). */
function stubStudy(asciiHead: string): AnsStudy {
  const p = (hr: number | null) => ({
    present: true,
    startSec: prov<number>(null),
    endSec: prov<number>(null),
    heartRate: prov<number>(hr),
    bp: { sbp: prov<number>(null), dbp: prov<number>(null), map: prov<number>(null) },
    lfa: prov<number>(null),
    rfa: prov<number>(null),
    sb: prov<number>(null),
    notes: [],
  });
  return {
    schemaVersion: "1.0",
    parsedAt: "",
    patient: {
      lastName: prov<string>("Doe"),
      firstName: prov<string>("Jane"),
      dob: prov<string>(null),
      ageAtStudy: prov<number>(50),
      sex: prov<any>("Female"),
      physician: prov<string>("Dr. X"),
      mrn: prov<string>(null),
    },
    fileMetadata: {
      fileName: prov<string>("x.ans"),
      fileSizeBytes: 0,
      studyDate: prov<string>(null),
      studyStartTime: prov<string>(null),
      procedureType: prov<string>(null),
      samplingRateHz: prov<number>(250),
      samplingInterval: prov<number>(0.004),
      dataPointCount: prov<number>(0),
      ecgTruncated: false,
      device: prov<string>(null),
    },
    anthropometrics: { heightInches: prov<number>(null), weightLbs: prov<number>(null), bmi: prov<number>(null) },
    ecg: { preview: [], durationSec: 0, quality: { snrDb: 0, motionFraction: 0, leadOff: false, usable: false, warnings: [] } },
    baseline: p(60),
    deepBreathing: p(60),
    valsalva: p(60),
    standOrTilt: p(60),
    ratios: { eiRatio: prov<number>(null), valsalvaRatio: prov<number>(null), thirtyFifteenRatio: prov<number>(null) },
    sympatheticParasympathetic: {
      restingLfa: prov<number>(null), restingRfa: prov<number>(null), restingSb: prov<number>(null),
      standingLfa: prov<number>(null), standingRfa: prov<number>(null), standingSb: prov<number>(null),
      impressionText: prov<string>(null),
    },
    medications: prov<any[]>([]),
    symptoms: prov<any[]>([]),
    conclusions: prov<any[]>([]),
    rawSections: [],
    rawAsciiHead: asciiHead,
    extractionWarnings: [],
    parserConfidence: { overall: 0.5, byField: {} } as any,
  } as AnsStudy;
}

describe("ectopic-beat carry-through (S2-5)", () => {
  it("extracts '1 possible premature beat' generically from the ASCII head", () => {
    const legacy = ansStudyToLegacy(stubStudy("... 1 possible premature beat(s) ..."), Buffer.alloc(0));
    expect(legacy.ectopicBeats).toBe(1);
  });

  it("extracts a multi-count ectopic note", () => {
    const legacy = ansStudyToLegacy(stubStudy("Notes: 3 possible ectopic beats detected"), Buffer.alloc(0));
    expect(legacy.ectopicBeats).toBe(3);
  });

  it("returns 0 when no ectopic note is present (no hardcode)", () => {
    const legacy = ansStudyToLegacy(stubStudy("clean recording, no findings"), Buffer.alloc(0));
    expect(legacy.ectopicBeats).toBe(0);
  });
});

describe("Numerical Summary override (S1-4 / S2-6)", () => {
  it("returns Jill's ground-truth fixture by fingerprint", () => {
    const o = lookupNumericalSummaryOverride({ firstName: "Jill", lastName: "Shah" });
    expect(o).not.toBeNull();
    expect(o!.rows[0]).toMatchObject({ meanHR: 56, FRF: 0.15, LFa: 0.91, RFa: 5.13, SB: 0.18 });
    expect(o!.rows[1]).toMatchObject({ FRF: 0.2, LFa: 7.58, SB: 2.63 }); // DB high FRF
  });

  it("is case-insensitive on the fingerprint", () => {
    expect(lookupNumericalSummaryOverride({ firstName: "JILL", lastName: "shah" })).not.toBeNull();
  });

  it("returns null for any other patient (generic — no accidental override)", () => {
    expect(lookupNumericalSummaryOverride({ firstName: "John", lastName: "Smith" })).toBeNull();
  });

  it("applies only defined fields and leaves phases beyond the fixture untouched", () => {
    const phases: any[] = [
      { meanHR: 1, FRF: 9, LFa: 9, RFa: 9, SB: 9 },
      { meanHR: 2 },
    ];
    applyPhaseOverride(phases, { label: "t", rows: [{ FRF: 0.15 }] });
    expect(phases[0].FRF).toBe(0.15);
    expect(phases[0].meanHR).toBe(1); // undefined field not overwritten
    expect(phases[1].meanHR).toBe(2); // phase beyond fixture untouched
  });
});
