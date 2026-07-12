/**
 * evaluationCorpus — governed, consented, de-identified evaluation-corpus and
 * release-readiness architecture for the HumanOS ANS pipeline.
 *
 * DESIGN INTENT (see ANS_test_evidence_base_HumanOS.md §9–§13):
 *   - This is an OFFLINE governance/validation layer. It is NOT a training loop.
 *   - There is NO online self-training: the runtime NEVER learns from, adapts to,
 *     or ingests user uploads. Any model/threshold change happens only through a
 *     manual, versioned release governed by a Predetermined Change Control Plan
 *     (PCCP): Description of Modifications, Modification Protocol, Impact
 *     Assessment (FDA final PCCP guidance, Dec 2024 / Aug 2025).
 *   - Every corpus record is de-identified (age/sex + numeric fields only; no
 *     names, DOB, physician, MRN) and requires an explicit consent basis.
 *   - Records pair the raw signal, computed values, metric status tags, and a
 *     physician reference label with provenance — enabling reproducible,
 *     leakage-controlled evaluation with pre-specified acceptance criteria.
 *
 * Citations:
 *   FDA GMLP (10 principles): https://www.fda.gov/media/153486/download
 *   FDA PCCP final guidance:  https://www.fda.gov/media/166704/download
 *   Corpus design:            ANS_test_evidence_base_HumanOS.md §11.3, §13
 */

import type { EvidenceTier, ValidationStatus } from "./metricProvenance.js";

/** Recording-length class — non-interchangeable per Shaffer & Ginsberg 2017. */
export type RecordingLengthClass = "UST" | "ST_5MIN" | "H24";

/** Consent basis under which a record may be used for evaluation. */
export interface ConsentRecord {
  /** True only if a valid, documented consent basis exists. */
  consented: boolean;
  /** e.g. "IRB-2025-014", "broad-research-consent", "waiver-deidentified". */
  basis: string;
  /** ISO date the consent/waiver was recorded. */
  recordedAt: string;
  /** Confirms all direct identifiers were removed before storage. */
  deidentified: boolean;
}

/** Test-condition validity flags required to interpret each domain. */
export interface TestConditionFlags {
  /** Continuous beat-to-beat BP present? Required for a full adrenergic grade. */
  beatToBeatBP: boolean;
  /** QSART/TST present? Required for any sudomotor assessment. */
  qsartOrTST: boolean;
  /** Paced vs spontaneous breathing (mandatory for HRV interpretability). */
  breathing: "paced" | "spontaneous" | "unknown";
  pacedRateBrpm?: number;
  tiltDurationSec?: number;
}

/** One computed metric with its evidence tier and validation state. */
export interface CorpusMetric {
  key: string;
  computed: number | null;
  /** Physician/vendor reference value, if a reference standard exists. */
  reference: number | null;
  tier: EvidenceTier;
  validation: ValidationStatus;
  /** True for RFa/LFa/SB and other proprietary metrics (Goldstein 2011). */
  proprietary: boolean;
}

/** A single de-identified, consented evaluation-corpus record. */
export interface CorpusRecord {
  recordId: string;
  /** Site/patient partition key used to PREVENT train/test leakage (GMLP #4). */
  partitionKey: string;
  consent: ConsentRecord;
  demographics: { ageYears: number | null; sex: "Male" | "Female" | "Other" | "Unknown" };
  acquisition: {
    signal: "ECG" | "PPG";
    samplingHz: number;
    lengthClass: RecordingLengthClass;
    cleanSegmentSec: number;
    editedFraction: number;
  };
  conditions: TestConditionFlags;
  metrics: CorpusMetric[];
  /** Physician-interpreted reference label (CASS/CARTs) + provenance. */
  referenceLabel: { value: string | null; provenance: string } | null;
  /** Pipeline version that produced `computed` values (auditability). */
  pipelineVersion: string;
}

/** Pre-specified numeric acceptance criteria for a release gate (per metric). */
export interface AcceptanceCriterion {
  key: string;
  /** Max allowed relative error vs reference before the release is blocked. */
  maxRelError: number;
  /** Metrics with no reference standard (proprietary [P]) are report-only. */
  reportOnly?: boolean;
}

export interface ReadinessReport {
  ready: boolean;
  totalRecords: number;
  consentedDeidentified: number;
  /** Records rejected because consent/de-identification was missing. */
  rejected: string[];
  /** Partition keys represented (leakage-control visibility). */
  partitions: string[];
  /** Per-criterion pass/fail against acceptance criteria. */
  criteria: Array<{ key: string; passed: boolean; worstRelError: number | null; reportOnly: boolean }>;
  /** Human-readable blockers preventing release. */
  blockers: string[];
}

/**
 * Evaluate release readiness OFFLINE. Pure function — no I/O, no network, no
 * mutation of inputs, and (critically) no model update. A record may enter
 * evaluation ONLY if it is consented AND de-identified; anything else is
 * rejected, never silently used.
 */
export function evaluateReadiness(
  records: CorpusRecord[],
  criteria: AcceptanceCriterion[],
  opts: { minRecords?: number; minPartitions?: number } = {},
): ReadinessReport {
  const minRecords = opts.minRecords ?? 30; // GMLP #3 "adequate size"; corpus ≈30–50
  const minPartitions = opts.minPartitions ?? 2; // leakage control (GMLP #4)

  const rejected: string[] = [];
  const eligible = records.filter((r) => {
    const ok = r.consent?.consented && r.consent?.deidentified;
    if (!ok) rejected.push(r.recordId);
    return ok;
  });

  const partitions = [...new Set(eligible.map((r) => r.partitionKey))];

  const criteriaResults = criteria.map((c) => {
    const errs: number[] = [];
    for (const rec of eligible) {
      const m = rec.metrics.find((x) => x.key === c.key);
      if (!m || m.computed == null || m.reference == null || m.reference === 0) continue;
      errs.push(Math.abs(m.computed - m.reference) / Math.abs(m.reference));
    }
    const worst = errs.length ? Math.max(...errs) : null;
    const passed = c.reportOnly ? true : worst == null ? false : worst <= c.maxRelError;
    return { key: c.key, passed, worstRelError: worst, reportOnly: !!c.reportOnly };
  });

  const blockers: string[] = [];
  if (eligible.length < minRecords)
    blockers.push(`Only ${eligible.length} consented/de-identified records (< ${minRecords} minimum).`);
  if (partitions.length < minPartitions)
    blockers.push(`Only ${partitions.length} partitions (< ${minPartitions}; leakage risk).`);
  for (const cr of criteriaResults) {
    if (!cr.passed && !cr.reportOnly)
      blockers.push(
        `Metric ${cr.key} failed acceptance (worst rel. error ${cr.worstRelError ?? "n/a"}).`,
      );
  }

  return {
    ready: blockers.length === 0,
    totalRecords: records.length,
    consentedDeidentified: eligible.length,
    rejected,
    partitions,
    criteria: criteriaResults,
    blockers,
  };
}

/**
 * Guardrail marker: the runtime performs NO online self-training. This constant
 * exists so a test can assert the property is declared and referenced, and so
 * reviewers can grep for the guarantee.
 */
export const ONLINE_SELF_TRAINING_ENABLED = false as const;
