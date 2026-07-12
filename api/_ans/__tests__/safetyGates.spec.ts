/**
 * Safety-gate tests (deterministic scorer contract):
 *   G1. No adrenergic GRADE without beat-to-beat BP — the .ans has only cuff
 *       deltas, so an assessable adrenergic domain must be flagged screenOnly
 *       with a beat-to-beat methodLimitation and must never claim adrenergic
 *       failure. With no BP at all the domain is not_assessed.
 *   G2. No sudomotor assessment without QSART/TST — always not_assessed.
 *   G3. No DEFINITIVE CAN / POTS / dysautonomia — phenotype flags are framed as
 *       "pattern consistent with" (suggestions), never disease assertions, and
 *       missing inputs route to unsafeOrUnsupportedClaimsBlocked, not a claim.
 *
 * These operate directly on AnsStudy objects (generic guarantees, not fixtures).
 */

import { describe, it, expect } from "vitest";
import { computeDiagnosticSummary } from "../scoring/index";
import type {
  AnsStudy,
  ProvField,
  PhaseBlock,
  BloodPressure,
} from "../../../shared/ansStudy";

function prov<T>(value: T | null, confidence = 1): ProvField<T> {
  return value === null
    ? { value: null, provenance: { source: "missing", confidence: 0, warnings: ["not present"] } }
    : { value, provenance: { source: "ascii_section", confidence } };
}

function bp(sbp: number | null, dbp: number | null): BloodPressure {
  const map = sbp != null && dbp != null ? Math.round((sbp + 2 * dbp) / 3) : null;
  return { sbp: prov(sbp), dbp: prov(dbp), map: prov(map) };
}

function phase(o: { hr?: number | null; sbp?: number | null; dbp?: number | null }): PhaseBlock {
  return {
    present: true,
    startSec: prov<number>(null),
    endSec: prov<number>(null),
    heartRate: prov<number>(o.hr ?? null),
    bp: bp(o.sbp ?? null, o.dbp ?? null),
    lfa: prov<number>(null),
    rfa: prov<number>(null),
    sb: prov<number>(null),
    notes: [],
  };
}

function study(over: Partial<AnsStudy> = {}): AnsStudy {
  const s: AnsStudy = {
    schemaVersion: "1.0",
    parsedAt: new Date().toISOString(),
    patient: {
      lastName: prov<string>("Test"), firstName: prov<string>("Patient"),
      dob: prov<string>("1980-01-01"), ageAtStudy: prov<number>(45),
      sex: prov<"Male" | "Female" | "Other" | "Unknown">("Female"),
      physician: prov<string>("Dr. Test"), mrn: prov<string>("T-1"),
    },
    fileMetadata: {
      fileName: prov<string>("t.ans"), fileSizeBytes: 0, studyDate: prov<string>("2025-01-01"),
      studyStartTime: prov<string>(null), procedureType: prov<string>(null),
      samplingRateHz: prov<number>(250), samplingInterval: prov<number>(0.004),
      dataPointCount: prov<number>(0), ecgTruncated: false, device: prov<string>(null),
    },
    anthropometrics: { heightInches: prov<number>(null), weightLbs: prov<number>(null), bmi: prov<number>(null) },
    ecg: { preview: [], durationSec: 300, quality: { snrDb: 25, motionFraction: 0.02, leadOff: false, usable: true, warnings: [] } },
    baseline: phase({ hr: 70, sbp: 120, dbp: 78 }),
    deepBreathing: phase({ hr: 72 }),
    valsalva: phase({ hr: 75 }),
    standOrTilt: phase({ hr: 80, sbp: 118, dbp: 79 }),
    ratios: { eiRatio: prov<number>(1.30), valsalvaRatio: prov<number>(1.55), thirtyFifteenRatio: prov<number>(1.10) },
    sympatheticParasympathetic: {
      restingLfa: prov<number>(2.0), restingRfa: prov<number>(3.0), restingSb: prov<number>(0.67),
      standingLfa: prov<number>(3.5), standingRfa: prov<number>(2.5), standingSb: prov<number>(1.4),
      impressionText: prov<string>(null),
    },
    medications: prov<any[]>([]), symptoms: prov<any[]>([]), conclusions: prov<any[]>([]),
    rawSections: [], rawAsciiHead: "", extractionWarnings: [],
    parserConfidence: { overall: 0.9, missingCount: 0, lowConfidenceCount: 0, sectionsDetected: [], sectionsMissing: [], parserVersion: "1.0.0" } as any,
  };
  return { ...s, ...over };
}

describe("G1 — adrenergic requires beat-to-beat BP for a full grade", () => {
  it("with cuff BP present: assessable but screenOnly + beat-to-beat limitation", () => {
    const summary = computeDiagnosticSummary(study());
    const a = summary.adrenergicScore;
    expect(a.assessable).toBe(true);
    expect(a.screenOnly).toBe(true);
    expect(a.methodLimitation ?? "").toMatch(/beat-to-beat/i);
    // The limitation must explicitly forbid a definitive adrenergic-failure claim.
    expect((a.methodLimitation ?? "").toLowerCase()).toContain("do not report definitive adrenergic failure");
    // A normal-BP study must not be graded as an abnormal adrenergic domain.
    expect(a.severity).toBe("normal");
  });

  it("with NO BP anywhere: adrenergic is not_assessed (no fabricated grade)", () => {
    const summary = computeDiagnosticSummary(
      study({ baseline: phase({ hr: 70 }), standOrTilt: phase({ hr: 80 }) }),
    );
    const a = summary.adrenergicScore;
    expect(a.assessable).toBe(false);
    expect(a.severity).toBe("not_assessed");
    expect(a.value).toBeNull();
    expect(summary.missingDomains).toContain("adrenergic");
  });
});

describe("G2 — sudomotor requires QSART/TST (never assessed from .ans)", () => {
  it("is always not_assessed with a QSART/TST reason", () => {
    const summary = computeDiagnosticSummary(study());
    const su = summary.sudomotorScore;
    expect(su.assessable).toBe(false);
    expect(su.value).toBeNull();
    expect(summary.missingDomains).toContain("sudomotor");
    expect((su.notAssessedReason ?? "").toLowerCase()).toMatch(/qsart|sudomotor/);
  });
});

describe("G3 — no definitive CAN / POTS / dysautonomia", () => {
  it("phenotype flags are framed as 'pattern consistent with', never a diagnosis", () => {
    // POTS-like HR rise without OH.
    const summary = computeDiagnosticSummary(
      study({
        baseline: phase({ hr: 70, sbp: 120, dbp: 78 }),
        standOrTilt: phase({ hr: 110, sbp: 122, dbp: 82 }),
      }),
    );
    for (const f of summary.phenotypeFlags) {
      // No label may assert a definitive disease.
      expect(f.label.toLowerCase()).not.toMatch(/\bhas\b|diagnosed|definite|confirmed/);
      if (f.present) {
        expect(f.label.toLowerCase()).toMatch(/pattern consistent with|risk|like/);
      }
    }
  });

  it("missing inputs for a phenotype route to blocked claims, not assertions", () => {
    const summary = computeDiagnosticSummary(
      study({
        baseline: phase({ hr: null }),
        standOrTilt: phase({ hr: null }),
        ratios: { eiRatio: prov<number>(null), valsalvaRatio: prov<number>(null), thirtyFifteenRatio: prov<number>(null) },
      }),
    );
    // With no HR and no ratios, POTS-like / cardiovagal cannot be present.
    const present = summary.phenotypeFlags.filter((f) => f.present).map((f) => f.label);
    expect(present).not.toContain("Pattern consistent with POTS-like response");
    // And nothing may assert CAN staging.
    const anyCan = summary.phenotypeFlags.some(
      (f) => f.present && /\bCAN\b|cardiovascular autonomic neuropathy/i.test(f.label),
    );
    expect(anyCan).toBe(false);
  });
});
