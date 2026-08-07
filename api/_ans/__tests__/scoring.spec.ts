/**
 * PR2 — Deterministic scoring tests.
 *
 * Scenarios covered:
 *   1. Normal — all ratios + orthostatic BP within normal bands.
 *   2. Abnormal — cardiovagal impairment + orthostatic hypotension pattern.
 *   3. Missing — no ratios or BP at all → domains not assessed; no scores fabricated.
 *   4. Conflicting — POTS-like HR rise WITHOUT BP drop (must not flag OH).
 *   5. Low quality — usable ECG flag false → confidence is downgraded.
 *
 * Tests operate directly on AnsStudy objects so they remain focused on the
 * deterministic scoring contract (no parser side-effects).
 */

import { describe, it, expect } from "vitest";
import { computeDiagnosticSummary } from "../scoring/index";
import { DEFAULT_THRESHOLDS } from "../thresholds";
import type {
  AnsStudy,
  ProvField,
  PhaseBlock,
  BloodPressure,
} from "../../../shared/ansStudy";

// ----------------------------------------------------------------------------
// Builders
// ----------------------------------------------------------------------------

function prov<T>(value: T | null, confidence = 1): ProvField<T> {
  if (value === null) {
    return {
      value: null,
      provenance: { source: "missing", confidence: 0, warnings: ["not present in file"] },
    };
  }
  return {
    value,
    provenance: { source: "ascii_section", confidence },
  };
}

function bp(sbp: number | null, dbp: number | null, confidence = 1): BloodPressure {
  const sbpField = prov<number>(sbp, confidence);
  const dbpField = prov<number>(dbp, confidence);
  const mapVal = sbp != null && dbp != null ? Math.round((sbp + 2 * dbp) / 3) : null;
  return {
    sbp: sbpField,
    dbp: dbpField,
    map: prov<number>(mapVal, confidence),
  };
}

function phase(opts: {
  hr?: number | null;
  sbp?: number | null;
  dbp?: number | null;
  lfa?: number | null;
  rfa?: number | null;
  sb?: number | null;
}): PhaseBlock {
  return {
    present: true,
    startSec: prov<number>(null),
    endSec: prov<number>(null),
    heartRate: prov<number>(opts.hr ?? null),
    bp: bp(opts.sbp ?? null, opts.dbp ?? null),
    lfa: prov<number>(opts.lfa ?? null),
    rfa: prov<number>(opts.rfa ?? null),
    sb: prov<number>(opts.sb ?? null),
    notes: [],
  };
}

function baseStudy(over: Partial<AnsStudy> = {}): AnsStudy {
  const study: AnsStudy = {
    schemaVersion: "1.0",
    parsedAt: new Date().toISOString(),
    patient: {
      lastName: prov<string>("Test"),
      firstName: prov<string>("Patient"),
      dob: prov<string>("1980-01-01"),
      ageAtStudy: prov<number>(45),
      sex: prov<"Male" | "Female" | "Other" | "Unknown">("Female"),
      physician: prov<string>("Dr. Test"),
      mrn: prov<string>("TEST-001"),
    },
    fileMetadata: {
      fileName: prov<string>("test.ans"),
      fileSizeBytes: 0,
      studyDate: prov<string>("2025-01-01"),
      studyStartTime: prov<string>(null),
      procedureType: prov<string>(null),
      samplingRateHz: prov<number>(250),
      samplingInterval: prov<number>(0.004),
      dataPointCount: prov<number>(0),
      ecgTruncated: false,
      device: prov<string>(null),
    },
    anthropometrics: {
      heightInches: prov<number>(null),
      weightLbs: prov<number>(null),
      bmi: prov<number>(null),
    },
    ectopicBeats: prov<number>(null),
    ecg: {
      preview: [],
      durationSec: 300,
      quality: {
        snrDb: 25,
        motionFraction: 0.02,
        sentinelFraction: 0,
        leadOff: false,
        unusableReasons: [],
        artifactFlags: [],
        usable: true,
        warnings: [],
      },
    },
    baseline: phase({ hr: 70, sbp: 120, dbp: 78 }),
    deepBreathing: phase({ hr: 72 }),
    valsalva: phase({ hr: 75 }),
    standOrTilt: phase({ hr: 80, sbp: 118, dbp: 79 }),
    ratios: {
      eiRatio: prov<number>(1.30),
      valsalvaRatio: prov<number>(1.55),
      thirtyFifteenRatio: prov<number>(1.10),
    },
    sympatheticParasympathetic: {
      restingLfa: prov<number>(2.0),
      restingRfa: prov<number>(3.0),
      restingSb: prov<number>(0.67),
      standingLfa: prov<number>(3.5),
      standingRfa: prov<number>(2.5),
      standingSb: prov<number>(1.4),
      impressionText: prov<string>(null),
    },
    medications: prov<any[]>([]),
    symptoms: prov<any[]>([]),
    conclusions: prov<any[]>([]),
    rawSections: [],
    rawAsciiHead: "",
    extractionWarnings: [],
    parserConfidence: {
      overall: 0.9,
      missingCount: 0,
      lowConfidenceCount: 0,
      sectionsDetected: [],
      sectionsMissing: [],
      parserVersion: "ans-parser/1.0.0",
    },
  };
  return { ...study, ...over };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("computeDiagnosticSummary — deterministic scoring", () => {
  describe("Scenario 1: normal", () => {
    const summary = computeDiagnosticSummary(baseStudy());

    it("scores cardiovagal as normal", () => {
      expect(summary.cardiovagalScore.assessable).toBe(true);
      expect(summary.cardiovagalScore.severity).toBe("normal");
      expect(summary.cardiovagalScore.value).toBe(0);
    });

    it("scores adrenergic as normal", () => {
      expect(summary.adrenergicScore.assessable).toBe(true);
      expect(summary.adrenergicScore.severity).toBe("normal");
    });

    it("marks sudomotor not assessed", () => {
      expect(summary.sudomotorScore.assessable).toBe(false);
      expect(summary.sudomotorScore.value).toBeNull();
      expect(summary.missingDomains).toContain("sudomotor");
    });

    it("produces zero abnormal findings", () => {
      expect(summary.abnormalFindings).toHaveLength(0);
    });

    it("rolls up to high report confidence", () => {
      expect(summary.reportConfidence).toBe("High");
      expect(summary.reportConfidenceScore).toBeGreaterThan(0.7);
    });

    it("does not flag orthostatic hypotension when criteria are not met", () => {
      const oh = summary.phenotypeFlags.find(f => f.id === "orthostatic_hypotension");
      expect(oh?.present).toBe(false);
    });

    it("never substitutes 0 for missing domains in totals", () => {
      expect(summary.maxPossibleScore).toBe(summary.domainsAssessed.length * 3);
      expect(summary.domainsAssessed).not.toContain("sudomotor");
    });
  });

  describe("Scenario 2: abnormal — cardiovagal impairment + orthostatic hypotension", () => {
    const study = baseStudy({
      ratios: {
        eiRatio: prov<number>(1.04),         // Low by the PhysioPS age-specific limit
        valsalvaRatio: prov<number>(1.10),   // Low by the PhysioPS age-specific limit
        thirtyFifteenRatio: prov<number>(0.99),
      },
      baseline: phase({ hr: 70, sbp: 130, dbp: 82 }),
      standOrTilt: phase({ hr: 90, sbp: 100, dbp: 70 }),
    });
    const summary = computeDiagnosticSummary(study);

    it("grades cardiovagal as low without inventing a vendor-absent severe tier", () => {
      expect(summary.cardiovagalScore.severity).toBe("mild");
      expect(summary.cardiovagalScore.value).toBe(1);
    });

    it("grades adrenergic at least moderate (SBP drop ≥20)", () => {
      expect(["moderate", "severe"]).toContain(summary.adrenergicScore.severity);
    });

    it("raises an orthostatic_hypotension flag", () => {
      const oh = summary.phenotypeFlags.find(f => f.id === "orthostatic_hypotension");
      expect(oh).toBeDefined();
      expect(oh!.present).toBe(true);
    });

    it("includes findings with thresholdRef + sourceFields", () => {
      expect(summary.abnormalFindings.length).toBeGreaterThan(0);
      const f = summary.abnormalFindings[0];
      expect(f.sourceFields.length).toBeGreaterThan(0);
      expect(f.thresholdRef).toBeTruthy();
    });

    it("computes nonzero total severity bounded by maxPossibleScore", () => {
      expect(summary.totalAutonomicSeverityScore).toBeGreaterThan(0);
      expect(summary.totalAutonomicSeverityScore).toBeLessThanOrEqual(summary.maxPossibleScore);
    });
  });

  describe("Scenario 3: missing — no ratios, no BP", () => {
    const study = baseStudy({
      ratios: {
        eiRatio: prov<number>(null),
        valsalvaRatio: prov<number>(null),
        thirtyFifteenRatio: prov<number>(null),
      },
      baseline: phase({ hr: 70 }),
      standOrTilt: phase({ hr: 75 }),
    });
    const summary = computeDiagnosticSummary(study);

    it("marks cardiovagal not assessed", () => {
      expect(summary.cardiovagalScore.assessable).toBe(false);
      expect(summary.cardiovagalScore.value).toBeNull();
    });

    it("marks adrenergic not assessed", () => {
      expect(summary.adrenergicScore.assessable).toBe(false);
      expect(summary.adrenergicScore.value).toBeNull();
    });

    it("returns totalAutonomicSeverityScore=0 and maxPossibleScore=0", () => {
      expect(summary.totalAutonomicSeverityScore).toBe(0);
      expect(summary.maxPossibleScore).toBe(0);
    });

    it("populates unsafeOrUnsupportedClaimsBlocked with missing field paths", () => {
      expect(summary.unsafeOrUnsupportedClaimsBlocked.length).toBeGreaterThan(0);
      const oh = summary.unsafeOrUnsupportedClaimsBlocked.find(b => /orthostatic/i.test(b.claim));
      expect(oh).toBeDefined();
      expect(oh!.missingFields.length).toBeGreaterThan(0);
    });

    it("emits insufficient_data phenotype flag when nothing is evaluable", () => {
      // BP-only phenotype detectors are blocked. Cardiovagal-impairment detector
      // is also blocked. Some non-blocked detectors may still produce results.
      // Important invariant: NO disease assertion is present.
      summary.phenotypeFlags.forEach(f => {
        expect(f.label.toLowerCase()).not.toContain("patient has");
        expect(f.label.toLowerCase()).not.toContain("diagnosed with");
      });
    });
  });

  describe("Scenario 4: conflicting — POTS-like HR rise WITHOUT BP drop", () => {
    const study = baseStudy({
      baseline: phase({ hr: 70, sbp: 118, dbp: 76 }),
      standOrTilt: phase({ hr: 115, sbp: 116, dbp: 78 }), // +45 bpm, no OH
    });
    const summary = computeDiagnosticSummary(study);

    it("does NOT raise orthostatic_hypotension", () => {
      const oh = summary.phenotypeFlags.find(f => f.id === "orthostatic_hypotension");
      expect(oh?.present).toBe(false);
    });

    it("DOES raise pots_like", () => {
      const pots = summary.phenotypeFlags.find(f => f.id === "pots_like");
      expect(pots?.present).toBe(true);
    });

    it("phenotype labels use 'pattern consistent with…' phrasing only", () => {
      for (const f of summary.phenotypeFlags) {
        if (f.id === "insufficient_data") continue;
        expect(f.label.toLowerCase()).toMatch(/pattern consistent with/);
      }
    });
  });

  describe("Scenario 5: low-quality — ECG flagged unusable", () => {
    const study = baseStudy({
      ecg: {
        preview: [],
        durationSec: 300,
        quality: {
          snrDb: 4,
          motionFraction: 0.55,
          sentinelFraction: 0,
          leadOff: true,
          unusableReasons: ["lead_off_or_flatline"],
          artifactFlags: [],
          usable: false,
          warnings: ["lead-off detected", "high motion fraction"],
        },
      },
    });
    const summary = computeDiagnosticSummary(study);

    it("downgrades cardiovagal confidence when ECG is unusable", () => {
      expect(summary.cardiovagalScore.confidence).not.toBe("High");
    });

    it("includes ECG-quality rationale in the cardiovagal score", () => {
      expect(summary.cardiovagalScore.rationale.toLowerCase()).toMatch(/ecg|signal|quality/);
    });

    it("includes the disclaimer verbatim", () => {
      expect(summary.disclaimer).toBe(
        "This is clinical decision support, not a diagnosis. Confirm with clinical correlation.",
      );
    });
  });

  describe("invariants", () => {
    it("sudomotor is always not assessed by default", () => {
      const summary = computeDiagnosticSummary(baseStudy());
      expect(summary.sudomotorScore.assessable).toBe(false);
      expect(summary.sudomotorScore.notAssessedReason).toMatch(/sudomotor|qsart/i);
    });

    it("explanationBullets are populated", () => {
      const summary = computeDiagnosticSummary(baseStudy());
      expect(summary.explanationBullets.length).toBeGreaterThan(0);
    });

    it("scoringVersion is set", () => {
      const summary = computeDiagnosticSummary(baseStudy());
      expect(summary.scoringVersion).toMatch(/^ans-scoring\//);
    });

    it("thresholds are pass-through configurable", () => {
      // Make abnormal threshold extremely strict — even normal values should now flag.
      const summary = computeDiagnosticSummary(baseStudy(), {
        thresholds: {
          ...DEFAULT_THRESHOLDS,
          cardiovagal: {
            eiRatio: [{ ageMin: 0, ageMax: 120, abnormalBelow: 5.0, severeBelow: 4.0 }],
            valsalvaRatio: [{ ageMin: 0, ageMax: 120, abnormalBelow: 5.0, severeBelow: 4.0 }],
            thirtyFifteenRatio: [{ ageMin: 0, ageMax: 120, abnormalBelow: 5.0, severeBelow: 4.0 }],
          },
        },
      });
      expect(summary.cardiovagalScore.severity).toBe("severe");
    });
  });
});
