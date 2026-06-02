/**
 * Adrenergic (sympathetic) scoring.
 *
 * Primary inputs from current .ans format:
 *   - Baseline BP (study.baseline.bp.{sbp,dbp})
 *   - Standing or tilt BP (study.standOrTilt.bp.{sbp,dbp})
 *   - Baseline + standing HR (for POTS-like rise context)
 *
 * Not currently extractable from .ans (handled as "not present"):
 *   - Valsalva phase II late / phase IV overshoot magnitudes
 *   - Pressure recovery time (PRT)
 *
 * When orthostatic BP data is missing, the domain comes back assessable:false.
 */

import type { AnsStudy } from "../../../shared/ansStudy";
import type {
  DomainScore,
  AbnormalFinding,
  Confidence,
  Severity,
} from "../../../shared/diagnosticSummary";
import type { Thresholds } from "../thresholds";

function numericToConfidence(c: number): Confidence {
  if (c >= 0.75) return "High";
  if (c >= 0.4) return "Medium";
  return "Low";
}

function severityToValue(s: Severity): number {
  switch (s) {
    case "normal": return 0;
    case "mild": return 1;
    case "moderate": return 2;
    case "severe": return 3;
    default: return 0;
  }
}

export interface AdrenergicResult {
  score: DomainScore;
  findings: AbnormalFinding[];
  /** Side data so phenotype detector can re-use computed deltas. */
  orthostatic: {
    sbpDelta: number | null;   // baseline - standing (positive = drop)
    dbpDelta: number | null;
    hrDelta: number | null;    // standing - baseline (positive = rise)
  };
}

export function scoreAdrenergic(
  study: AnsStudy,
  thresholds: Thresholds,
): AdrenergicResult {
  const baseSbp = study.baseline.bp.sbp.value;
  const baseDbp = study.baseline.bp.dbp.value;
  const standSbp = study.standOrTilt.bp.sbp.value;
  const standDbp = study.standOrTilt.bp.dbp.value;
  const baseHr = study.baseline.heartRate.value;
  const standHr = study.standOrTilt.heartRate.value;

  const sbpDelta = baseSbp != null && standSbp != null ? baseSbp - standSbp : null;
  const dbpDelta = baseDbp != null && standDbp != null ? baseDbp - standDbp : null;
  const hrDelta  = baseHr  != null && standHr  != null ? standHr - baseHr  : null;

  // If both BP arms are unavailable, we can't assess adrenergic.
  if (sbpDelta == null && dbpDelta == null) {
    return {
      score: {
        domain: "adrenergic",
        value: null,
        severity: "not_assessed",
        rationale:
          "No baseline→stand blood pressure data available; adrenergic response cannot be quantified.",
        sourceFields: [
          "baseline.bp.sbp",
          "baseline.bp.dbp",
          "standOrTilt.bp.sbp",
          "standOrTilt.bp.dbp",
        ],
        confidence: "Low",
        assessable: false,
        notAssessedReason: "Missing orthostatic BP data.",
      },
      findings: [],
      orthostatic: { sbpDelta, dbpDelta, hrDelta },
    };
  }

  const findings: AbnormalFinding[] = [];
  let severity: Severity = "normal";

  const th = thresholds.adrenergic;

  // SBP drop (orthostatic hypotension axis).
  if (sbpDelta != null) {
    if (sbpDelta >= th.sbpDropSevere) {
      severity = "severe";
      findings.push({
        code: "ORTHO_SBP_DROP_SEVERE",
        message: `Systolic BP fell ${sbpDelta.toFixed(0)} mmHg on standing (≥ ${th.sbpDropSevere}).`,
        domain: "adrenergic",
        severity: "severe",
        sourceFields: ["baseline.bp.sbp", "standOrTilt.bp.sbp"],
        thresholdRef: `adrenergic.sbpDropSevere=${th.sbpDropSevere}`,
        confidence: numericToConfidence(
          Math.min(
            study.baseline.bp.sbp.provenance.confidence ?? 0,
            study.standOrTilt.bp.sbp.provenance.confidence ?? 0,
          ),
        ),
      });
    } else if (sbpDelta >= th.sbpDropModerate) {
      if (severityToValue(severity) < 2) severity = "moderate";
      findings.push({
        code: "ORTHO_SBP_DROP_MODERATE",
        message: `Systolic BP fell ${sbpDelta.toFixed(0)} mmHg on standing (≥ ${th.sbpDropModerate}); meets orthostatic-hypotension criterion.`,
        domain: "adrenergic",
        severity: "moderate",
        sourceFields: ["baseline.bp.sbp", "standOrTilt.bp.sbp"],
        thresholdRef: `adrenergic.sbpDropModerate=${th.sbpDropModerate}`,
        confidence: numericToConfidence(
          Math.min(
            study.baseline.bp.sbp.provenance.confidence ?? 0,
            study.standOrTilt.bp.sbp.provenance.confidence ?? 0,
          ),
        ),
      });
    } else if (sbpDelta >= th.sbpDropMild) {
      if (severityToValue(severity) < 1) severity = "mild";
      findings.push({
        code: "ORTHO_SBP_DROP_MILD",
        message: `Systolic BP fell ${sbpDelta.toFixed(0)} mmHg on standing (≥ ${th.sbpDropMild}); sub-clinical drop.`,
        domain: "adrenergic",
        severity: "mild",
        sourceFields: ["baseline.bp.sbp", "standOrTilt.bp.sbp"],
        thresholdRef: `adrenergic.sbpDropMild=${th.sbpDropMild}`,
        confidence: numericToConfidence(
          Math.min(
            study.baseline.bp.sbp.provenance.confidence ?? 0,
            study.standOrTilt.bp.sbp.provenance.confidence ?? 0,
          ),
        ),
      });
    }
  }

  // DBP drop.
  if (dbpDelta != null) {
    if (dbpDelta >= th.dbpDropModerate) {
      if (severityToValue(severity) < 2) severity = "moderate";
      findings.push({
        code: "ORTHO_DBP_DROP_MODERATE",
        message: `Diastolic BP fell ${dbpDelta.toFixed(0)} mmHg on standing (≥ ${th.dbpDropModerate}); meets orthostatic-hypotension criterion.`,
        domain: "adrenergic",
        severity: "moderate",
        sourceFields: ["baseline.bp.dbp", "standOrTilt.bp.dbp"],
        thresholdRef: `adrenergic.dbpDropModerate=${th.dbpDropModerate}`,
        confidence: numericToConfidence(
          Math.min(
            study.baseline.bp.dbp.provenance.confidence ?? 0,
            study.standOrTilt.bp.dbp.provenance.confidence ?? 0,
          ),
        ),
      });
    } else if (dbpDelta >= th.dbpDropMild) {
      if (severityToValue(severity) < 1) severity = "mild";
      findings.push({
        code: "ORTHO_DBP_DROP_MILD",
        message: `Diastolic BP fell ${dbpDelta.toFixed(0)} mmHg on standing (≥ ${th.dbpDropMild}).`,
        domain: "adrenergic",
        severity: "mild",
        sourceFields: ["baseline.bp.dbp", "standOrTilt.bp.dbp"],
        thresholdRef: `adrenergic.dbpDropMild=${th.dbpDropMild}`,
        confidence: numericToConfidence(
          Math.min(
            study.baseline.bp.dbp.provenance.confidence ?? 0,
            study.standOrTilt.bp.dbp.provenance.confidence ?? 0,
          ),
        ),
      });
    }
  }

  // Confidence aggregation: mean of contributing field confidences.
  const fieldConfs: number[] = [];
  if (sbpDelta != null) {
    fieldConfs.push(
      study.baseline.bp.sbp.provenance.confidence ?? 0,
      study.standOrTilt.bp.sbp.provenance.confidence ?? 0,
    );
  }
  if (dbpDelta != null) {
    fieldConfs.push(
      study.baseline.bp.dbp.provenance.confidence ?? 0,
      study.standOrTilt.bp.dbp.provenance.confidence ?? 0,
    );
  }
  const meanConf = fieldConfs.length
    ? fieldConfs.reduce((a, b) => a + b, 0) / fieldConfs.length
    : 0;
  const confidence = numericToConfidence(meanConf);

  const rationaleParts: string[] = [];
  rationaleParts.push(
    sbpDelta != null
      ? `ΔSBP = ${sbpDelta.toFixed(0)} mmHg (baseline → stand).`
      : "ΔSBP not computable (BP missing).",
  );
  rationaleParts.push(
    dbpDelta != null
      ? `ΔDBP = ${dbpDelta.toFixed(0)} mmHg.`
      : "ΔDBP not computable.",
  );
  if (hrDelta != null) {
    rationaleParts.push(`ΔHR = ${hrDelta.toFixed(0)} bpm on standing.`);
  }
  rationaleParts.push(
    "Valsalva BP phase data + pressure recovery time not present in .ans format; adrenergic score relies on orthostatic deltas only.",
  );

  return {
    score: {
      domain: "adrenergic",
      value: severityToValue(severity),
      severity,
      rationale: rationaleParts.join(" "),
      sourceFields: [
        "baseline.bp.sbp",
        "baseline.bp.dbp",
        "standOrTilt.bp.sbp",
        "standOrTilt.bp.dbp",
      ],
      confidence,
      assessable: true,
    },
    findings,
    orthostatic: { sbpDelta, dbpDelta, hrDelta },
  };
}
