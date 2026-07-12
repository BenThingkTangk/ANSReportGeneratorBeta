/**
 * Governed evaluation-corpus + release-readiness tests.
 *  - Only consented AND de-identified records may enter evaluation.
 *  - Leakage control: minimum distinct partitions enforced.
 *  - Acceptance criteria block release on out-of-tolerance metrics; proprietary
 *    [P] metrics with no reference standard are report-only (never a gate).
 *  - No online self-training: the guarantee constant is false.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateReadiness,
  ONLINE_SELF_TRAINING_ENABLED,
  type CorpusRecord,
  type AcceptanceCriterion,
} from "../../../shared/evaluationCorpus";

function rec(over: Partial<CorpusRecord> = {}): CorpusRecord {
  return {
    recordId: "r1",
    partitionKey: "siteA",
    consent: { consented: true, basis: "IRB-2025", recordedAt: "2025-01-01", deidentified: true },
    demographics: { ageYears: 50, sex: "Female" },
    acquisition: { signal: "ECG", samplingHz: 250, lengthClass: "ST_5MIN", cleanSegmentSec: 300, editedFraction: 0.01 },
    conditions: { beatToBeatBP: false, qsartOrTST: false, breathing: "paced" },
    metrics: [
      { key: "eiRatio", computed: 1.2, reference: 1.21, tier: "C", validation: "validated", proprietary: false },
      { key: "RFa", computed: 5.0, reference: null, tier: "P", validation: "estimated", proprietary: true },
    ],
    referenceLabel: { value: "Normal", provenance: "physician CARTs" },
    pipelineVersion: "test",
    ...over,
  };
}

const criteria: AcceptanceCriterion[] = [
  { key: "eiRatio", maxRelError: 0.05 },
  { key: "RFa", maxRelError: 0.05, reportOnly: true },
];

describe("no online self-training", () => {
  it("declares self-training disabled", () => {
    expect(ONLINE_SELF_TRAINING_ENABLED).toBe(false);
  });
});

describe("consent + de-identification gating", () => {
  it("rejects non-consented and non-de-identified records", () => {
    const records = [
      rec({ recordId: "ok", partitionKey: "A" }),
      rec({ recordId: "noConsent", partitionKey: "B", consent: { consented: false, basis: "", recordedAt: "", deidentified: true } }),
      rec({ recordId: "hasPHI", partitionKey: "C", consent: { consented: true, basis: "x", recordedAt: "2025", deidentified: false } }),
    ];
    const r = evaluateReadiness(records, criteria, { minRecords: 1, minPartitions: 1 });
    expect(r.rejected).toContain("noConsent");
    expect(r.rejected).toContain("hasPHI");
    expect(r.consentedDeidentified).toBe(1);
  });
});

describe("leakage control", () => {
  it("blocks release when too few partitions", () => {
    const records = [rec({ recordId: "a", partitionKey: "same" }), rec({ recordId: "b", partitionKey: "same" })];
    const r = evaluateReadiness(records, criteria, { minRecords: 1, minPartitions: 2 });
    expect(r.ready).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/partition/i);
  });
});

describe("acceptance criteria", () => {
  it("passes consensus metric within tolerance and treats [P] as report-only", () => {
    const records = [rec({ recordId: "a", partitionKey: "A" }), rec({ recordId: "b", partitionKey: "B" })];
    const r = evaluateReadiness(records, criteria, { minRecords: 1, minPartitions: 2 });
    const ei = r.criteria.find((c) => c.key === "eiRatio")!;
    const rfa = r.criteria.find((c) => c.key === "RFa")!;
    expect(ei.passed).toBe(true);
    expect(rfa.reportOnly).toBe(true);
    expect(rfa.passed).toBe(true); // report-only never blocks
    expect(r.ready).toBe(true);
  });

  it("blocks release when a consensus metric exceeds tolerance", () => {
    const bad = rec({
      recordId: "bad",
      partitionKey: "A",
      metrics: [{ key: "eiRatio", computed: 2.0, reference: 1.21, tier: "C", validation: "estimated", proprietary: false }],
    });
    const r = evaluateReadiness([bad, rec({ recordId: "b", partitionKey: "B" })], criteria, { minRecords: 1, minPartitions: 2 });
    expect(r.ready).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/eiRatio/);
  });
});
