/**
 * Regression tests for ectopic-beat carry-through (S2-5).
 *
 * NOTE: this file previously also tested a fingerprint-keyed Numerical Summary
 * override. That mechanism was REMOVED (it violated generic accuracy by
 * substituting a memorized vendor scalar for a per-file identity match), so its
 * tests were deleted along with the production code. The de-identified vendor
 * scalars now live only in the offline regression oracle (see
 * numericalSummaryParity.spec.ts), which asserts our GENERIC computation is
 * flagged `estimated` and stays within a documented tolerance — never that the
 * pipeline reproduces the vendor value exactly.
 */

import { describe, it, expect } from "vitest";
import { ansStudyToLegacy } from "../legacyAdapter";
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
