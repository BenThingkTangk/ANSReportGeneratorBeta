/**
 * Cardiovagal (parasympathetic) scoring.
 *
 * Inputs: deep breathing metrics, E:I ratio, Valsalva ratio, 30:15 ratio.
 * Confidence is weighted by ECG signal quality (study.ecg.quality.usable).
 *
 * Rules-first, deterministic. Returns a DomainScore. Never substitutes 0 for
 * missing — if no ratios are present, returns `assessable: false`.
 */

import type { AnsStudy, ProvField } from "../../../shared/ansStudy";
import type {
  DomainScore,
  AbnormalFinding,
  Confidence,
  Severity,
} from "../../../shared/diagnosticSummary";
import { bandForAge, type Thresholds } from "../thresholds.js";

interface RatioEval {
  field: string;          // e.g. "ratios.eiRatio"
  label: string;          // "E:I ratio"
  value: number | null;
  abnormalBelow: number;
  severeBelow: number;
  binaryLow?: boolean;
  fieldConfidence: number; // 0..1 from ProvField provenance
}

function evaluateRatio(r: RatioEval): {
  severity: Severity;
  abnormal: boolean;
  finding: AbnormalFinding | null;
} {
  if (r.value == null) {
    return { severity: "not_assessed", abnormal: false, finding: null };
  }
  if (!r.binaryLow && r.value < r.severeBelow) {
    return {
      severity: "severe",
      abnormal: true,
      finding: {
        code: `${r.label.replace(/[: ]/g, "_").toUpperCase()}_SEVERE`,
        message: `${r.label} ${r.value.toFixed(2)} is severely reduced (< ${r.severeBelow}).`,
        domain: "cardiovagal",
        severity: "severe",
        sourceFields: [r.field],
        thresholdRef: `cardiovagal.${r.field}.severeBelow=${r.severeBelow}`,
        confidence: numericToConfidence(r.fieldConfidence),
      },
    };
  }
  const isLow = r.binaryLow
    ? r.value <= r.abnormalBelow
    : r.value < r.abnormalBelow;
  if (isLow) {
    return {
      severity: "mild",
      abnormal: true,
      finding: {
        code: `${r.label.replace(/[: ]/g, "_").toUpperCase()}_LOW`,
        message: r.binaryLow
          ? `${r.label} ${r.value.toFixed(2)} is Low by the PhysioPS age-specific criterion (normal > ${r.abnormalBelow}).`
          : `${r.label} ${r.value.toFixed(2)} is below age-banded normal (< ${r.abnormalBelow}).`,
        domain: "cardiovagal",
        severity: "mild",
        sourceFields: [r.field],
        thresholdRef: `cardiovagal.${r.field}.abnormalBelow=${r.abnormalBelow}`,
        confidence: numericToConfidence(r.fieldConfidence),
      },
    };
  }
  return { severity: "normal", abnormal: false, finding: null };
}

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

export interface CardiovagalResult {
  score: DomainScore;
  findings: AbnormalFinding[];
}

export function scoreCardiovagal(
  study: AnsStudy,
  thresholds: Thresholds,
): CardiovagalResult {
  const age = study.patient.ageAtStudy.value;
  const eiBand = bandForAge(thresholds.cardiovagal.eiRatio, age);
  const valBand = bandForAge(thresholds.cardiovagal.valsalvaRatio, age);
  const ttfBand = bandForAge(thresholds.cardiovagal.thirtyFifteenRatio, age);

  const ratios: RatioEval[] = [
    {
      field: "ratios.eiRatio",
      label: "E:I ratio",
      value: study.ratios.eiRatio.value,
      abnormalBelow: eiBand.abnormalBelow,
      severeBelow: eiBand.severeBelow,
      binaryLow: eiBand.binaryLow,
      fieldConfidence: study.ratios.eiRatio.provenance.confidence ?? 0,
    },
    {
      field: "ratios.valsalvaRatio",
      label: "Valsalva ratio",
      value: study.ratios.valsalvaRatio.value,
      abnormalBelow: valBand.abnormalBelow,
      severeBelow: valBand.severeBelow,
      binaryLow: valBand.binaryLow,
      fieldConfidence: study.ratios.valsalvaRatio.provenance.confidence ?? 0,
    },
    {
      field: "ratios.thirtyFifteenRatio",
      label: "30:15 ratio",
      value: study.ratios.thirtyFifteenRatio.value,
      abnormalBelow: ttfBand.abnormalBelow,
      severeBelow: ttfBand.severeBelow,
      binaryLow: ttfBand.binaryLow,
      fieldConfidence: study.ratios.thirtyFifteenRatio.provenance.confidence ?? 0,
    },
  ];

  const assessed = ratios.filter(r => r.value != null);

  // Domain not assessable if zero ratios present.
  if (assessed.length === 0) {
    return {
      score: {
        domain: "cardiovagal",
        value: null,
        severity: "not_assessed",
        rationale:
          "No deep breathing, Valsalva, or 30:15 ratios were extractable from the .ans file.",
        sourceFields: [
          "ratios.eiRatio",
          "ratios.valsalvaRatio",
          "ratios.thirtyFifteenRatio",
        ],
        confidence: "Low",
        assessable: false,
        notAssessedReason: "No cardiovagal ratios present.",
      },
      findings: [],
    };
  }

  const evals = ratios.map(r => ({ r, ...evaluateRatio(r) }));
  const findings = evals.map(e => e.finding).filter((f): f is AbnormalFinding => !!f);

  // Worst severity drives the domain bucket; numeric value is max across assessed ratios.
  const numericValues = evals
    .filter(e => e.r.value != null)
    .map(e => severityToValue(e.severity));
  const maxVal = Math.max(0, ...numericValues);
  const severity: Severity =
    maxVal >= 3 ? "severe" :
    maxVal === 2 ? "moderate" :
    maxVal === 1 ? "mild" : "normal";

  // ECG signal quality gate — downgrade confidence if signal is bad.
  const ecg = study.ecg.quality;
  const ecgUsable = ecg.usable;
  const snrOk = ecg.snrDb == null || ecg.snrDb >= thresholds.ecgQuality.minSnrDb;
  const motionOk = ecg.motionFraction == null
    || ecg.motionFraction <= thresholds.ecgQuality.maxMotionFraction;

  // Aggregate confidence: mean of per-field confidences, downgraded if ECG bad.
  const meanFieldConf =
    assessed.reduce((acc, r) => acc + (r.fieldConfidence ?? 0), 0) / assessed.length;
  let confScore = meanFieldConf;
  if (!ecgUsable) confScore *= 0.5;
  else if (!snrOk || !motionOk) confScore *= 0.75;
  const confidence = numericToConfidence(confScore);

  const rationaleParts: string[] = [];
  for (const e of evals) {
    if (e.r.value == null) {
      rationaleParts.push(`${e.r.label}: not present.`);
    } else {
      rationaleParts.push(
        e.r.binaryLow
          ? `${e.r.label}=${e.r.value.toFixed(2)} → ${e.severity} ` +
            `(PhysioPS age-specific normal >${e.r.abnormalBelow}; otherwise Low).`
          : `${e.r.label}=${e.r.value.toFixed(2)} → ${e.severity} ` +
            `(age-band <${e.r.abnormalBelow} abnormal, <${e.r.severeBelow} severe).`,
      );
    }
  }
  if (!ecgUsable) {
    rationaleParts.push("ECG signal flagged unusable — confidence reduced.");
  } else if (!snrOk || !motionOk) {
    rationaleParts.push("ECG quality below targets — confidence downgraded.");
  }

  return {
    score: {
      domain: "cardiovagal",
      value: maxVal,
      severity,
      rationale: rationaleParts.join(" "),
      sourceFields: assessed.map(r => r.field).concat(["ecg.quality"]),
      confidence,
      assessable: true,
    },
    findings,
  };
}
