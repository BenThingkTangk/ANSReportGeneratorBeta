/**
 * Phenotype pattern detectors.
 *
 * Strict safety rules:
 *   - These return PATTERN suggestions, never disease assertions.
 *     Label phrasing must always begin with "Pattern consistent with…".
 *   - A detector emits a flag ONLY when ALL required input fields are present
 *     AND criteria are met. When required inputs are missing, the detector
 *     instead emits a BlockedClaim into the orchestrator so the UI can show
 *     what was not evaluated.
 *   - Phenotype flags are SEPARATE from severity scoring — severity does not
 *     depend on phenotype matches and vice versa.
 */

import type { AnsStudy, ProvField, FieldProvenance } from "../../../shared/ansStudy";
import type {
  PhenotypeFlag,
  BlockedClaim,
  Confidence,
} from "../../../shared/diagnosticSummary";
import type { Thresholds } from "../thresholds";
import type { CardiovagalResult } from "./cardiovagal";
import type { AdrenergicResult } from "./adrenergic";

function numericToConfidence(c: number): Confidence {
  if (c >= 0.75) return "High";
  if (c >= 0.4) return "Medium";
  return "Low";
}

function minConfidence(values: number[]): Confidence {
  if (values.length === 0) return "Low";
  return numericToConfidence(Math.min(...values));
}

/**
 * Downgrade a phenotype's reported confidence one notch when source provenance
 * is weak (filename/computed/missing) OR when any value used in the criterion
 * is missing/null. Hard-cap at "Low" if any required input is null.
 */
function downgrade(c: Confidence): Confidence {
  if (c === "High") return "Medium";
  if (c === "Medium") return "Low";
  return "Low";
}

function provenanceIsWeak(p: FieldProvenance | undefined): boolean {
  if (!p) return true;
  if (p.source === "missing" || p.source === "filename" || p.source === "computed") return true;
  if ((p.confidence ?? 0) < 0.5) return true;
  return false;
}

/**
 * Strict confidence: caps at "Low" when ANY source field is null (missing),
 * downgrades one notch when ANY provenance is weak.
 */
function strictConfidence(
  base: Confidence,
  fields: Array<ProvField<unknown> | undefined>,
): Confidence {
  // Hard cap: any missing required input → Low
  for (const f of fields) {
    if (!f || f.value === null || f.value === undefined) return "Low";
  }
  // Soft downgrade: any weak provenance → one notch lower
  for (const f of fields) {
    if (provenanceIsWeak(f!.provenance)) return downgrade(base);
  }
  return base;
}

export interface PhenotypeContext {
  study: AnsStudy;
  thresholds: Thresholds;
  cardiovagal: CardiovagalResult;
  adrenergic: AdrenergicResult;
}

export interface PhenotypeOutput {
  flags: PhenotypeFlag[];
  blocked: BlockedClaim[];
}

// ----------------------------------------------------------------------------
// Detectors
// ----------------------------------------------------------------------------

function detectOrthostaticHypotension(ctx: PhenotypeContext): PhenotypeFlag | BlockedClaim {
  const { sbpDelta, dbpDelta } = ctx.adrenergic.orthostatic;
  const study = ctx.study;
  const requiredFields = [
    "baseline.bp.sbp",
    "baseline.bp.dbp",
    "standOrTilt.bp.sbp",
    "standOrTilt.bp.dbp",
  ];
  const missing: string[] = [];
  if (study.baseline.bp.sbp.value == null) missing.push("baseline.bp.sbp");
  if (study.standOrTilt.bp.sbp.value == null) missing.push("standOrTilt.bp.sbp");
  if (study.baseline.bp.dbp.value == null) missing.push("baseline.bp.dbp");
  if (study.standOrTilt.bp.dbp.value == null) missing.push("standOrTilt.bp.dbp");
  if (missing.length > 0) {
    return {
      claim: "Orthostatic hypotension pattern",
      missingFields: missing,
      explanation:
        "Orthostatic hypotension cannot be evaluated: baseline and/or standing BP were not captured.",
    } as BlockedClaim;
  }

  const sbpMet = (sbpDelta ?? 0) >= ctx.thresholds.adrenergic.sbpDropModerate;
  const dbpMet = (dbpDelta ?? 0) >= ctx.thresholds.adrenergic.dbpDropModerate;
  const present = sbpMet || dbpMet;

  return {
    id: "orthostatic_hypotension",
    label: "Pattern consistent with orthostatic hypotension",
    present,
    criteria: [
      {
        description: `SBP drop ≥ ${ctx.thresholds.adrenergic.sbpDropModerate} mmHg`,
        met: sbpMet,
        sourceField: "baseline.bp.sbp / standOrTilt.bp.sbp",
      },
      {
        description: `DBP drop ≥ ${ctx.thresholds.adrenergic.dbpDropModerate} mmHg`,
        met: dbpMet,
        sourceField: "baseline.bp.dbp / standOrTilt.bp.dbp",
      },
    ],
    rationale: present
      ? `Standing BP fell by ΔSBP=${sbpDelta?.toFixed(0)} / ΔDBP=${dbpDelta?.toFixed(0)} mmHg, meeting consensus criteria.`
      : `Standing BP changes (ΔSBP=${sbpDelta?.toFixed(0)} / ΔDBP=${dbpDelta?.toFixed(0)} mmHg) do not meet consensus thresholds.`,
    sourceFields: requiredFields,
    confidence: strictConfidence(
      minConfidence([
        study.baseline.bp.sbp.provenance.confidence ?? 0,
        study.standOrTilt.bp.sbp.provenance.confidence ?? 0,
        study.baseline.bp.dbp.provenance.confidence ?? 0,
        study.standOrTilt.bp.dbp.provenance.confidence ?? 0,
      ]),
      [
        study.baseline.bp.sbp,
        study.standOrTilt.bp.sbp,
        study.baseline.bp.dbp,
        study.standOrTilt.bp.dbp,
      ],
    ),
  };
}

function detectPotsLike(ctx: PhenotypeContext): PhenotypeFlag | BlockedClaim {
  const { hrDelta, sbpDelta } = ctx.adrenergic.orthostatic;
  const study = ctx.study;
  const missing: string[] = [];
  if (study.baseline.heartRate.value == null) missing.push("baseline.heartRate");
  if (study.standOrTilt.heartRate.value == null) missing.push("standOrTilt.heartRate");
  if (missing.length > 0) {
    return {
      claim: "POTS-like pattern",
      missingFields: missing,
      explanation:
        "POTS-like pattern not evaluated: baseline and/or standing heart rate was not captured.",
    } as BlockedClaim;
  }

  // POTS criterion: sustained HR rise ≥30 bpm WITHOUT meeting orthostatic-hypotension criterion.
  const hrMet = (hrDelta ?? 0) >= ctx.thresholds.adrenergic.potsHrIncrease;
  const noOh = (sbpDelta ?? 0) < ctx.thresholds.adrenergic.sbpDropModerate;
  const present = hrMet && noOh;

  return {
    id: "pots_like",
    label: "Pattern consistent with POTS-like response",
    present,
    criteria: [
      {
        description: `HR increase on standing ≥ ${ctx.thresholds.adrenergic.potsHrIncrease} bpm`,
        met: hrMet,
        sourceField: "baseline.heartRate / standOrTilt.heartRate",
      },
      {
        description: `No orthostatic hypotension (ΔSBP < ${ctx.thresholds.adrenergic.sbpDropModerate})`,
        met: noOh,
        sourceField: "baseline.bp.sbp / standOrTilt.bp.sbp",
      },
    ],
    rationale: present
      ? `Sustained HR rise of ${hrDelta?.toFixed(0)} bpm on standing without significant BP drop.`
      : `ΔHR=${hrDelta?.toFixed(0)} bpm; criteria for POTS-like response not met.`,
    sourceFields: [
      "baseline.heartRate",
      "standOrTilt.heartRate",
      "baseline.bp.sbp",
      "standOrTilt.bp.sbp",
    ],
    confidence: strictConfidence(
      minConfidence([
        study.baseline.heartRate.provenance.confidence ?? 0,
        study.standOrTilt.heartRate.provenance.confidence ?? 0,
      ]),
      [
        study.baseline.heartRate,
        study.standOrTilt.heartRate,
        study.baseline.bp.sbp,
        study.standOrTilt.bp.sbp,
      ],
    ),
  };
}

function detectCardiovagalImpairment(ctx: PhenotypeContext): PhenotypeFlag | BlockedClaim {
  if (!ctx.cardiovagal.score.assessable) {
    return {
      claim: "Cardiovagal impairment",
      missingFields: ctx.cardiovagal.score.sourceFields,
      explanation:
        "Cardiovagal impairment not evaluated: no E:I, Valsalva, or 30:15 ratios present.",
    } as BlockedClaim;
  }
  const sev = ctx.cardiovagal.score.severity;
  const present = sev === "mild" || sev === "moderate" || sev === "severe";
  return {
    id: "cardiovagal_impairment",
    label: "Pattern consistent with cardiovagal impairment",
    present,
    criteria: [
      {
        description: "≥1 cardiovagal ratio below age-banded normal",
        met: present,
        sourceField: "ratios.*",
      },
    ],
    rationale: present
      ? `Cardiovagal domain graded ${sev}.`
      : "All assessed cardiovagal ratios within age-banded normal range.",
    sourceFields: ctx.cardiovagal.score.sourceFields,
    confidence: strictConfidence(ctx.cardiovagal.score.confidence, ([
      ctx.study.ratios?.eiRatio,
      ctx.study.ratios?.valsalvaRatio,
      ctx.study.ratios?.thirtyFifteenRatio,
    ].filter(Boolean) as Array<ProvField<unknown>>)),
  };
}

function detectAdrenergicImpairment(ctx: PhenotypeContext): PhenotypeFlag | BlockedClaim {
  if (!ctx.adrenergic.score.assessable) {
    return {
      claim: "Adrenergic impairment",
      missingFields: ctx.adrenergic.score.sourceFields,
      explanation:
        "Adrenergic impairment not evaluated: orthostatic BP data missing.",
    } as BlockedClaim;
  }
  const sev = ctx.adrenergic.score.severity;
  const present = sev === "moderate" || sev === "severe";
  return {
    id: "adrenergic_impairment",
    label: "Pattern consistent with adrenergic impairment",
    present,
    criteria: [
      {
        description: "Orthostatic BP changes meet impairment thresholds",
        met: present,
        sourceField: "baseline.bp / standOrTilt.bp",
      },
    ],
    rationale: present
      ? `Adrenergic domain graded ${sev}.`
      : "Adrenergic domain not graded as impaired.",
    sourceFields: ctx.adrenergic.score.sourceFields,
    confidence: strictConfidence(ctx.adrenergic.score.confidence, [
      ctx.study.baseline.bp.sbp,
      ctx.study.standOrTilt.bp.sbp,
      ctx.study.baseline.bp.dbp,
      ctx.study.standOrTilt.bp.dbp,
    ]),
  };
}

function detectParasympatheticWithdrawal(ctx: PhenotypeContext): PhenotypeFlag | BlockedClaim {
  const study = ctx.study;
  const restRfa = study.sympatheticParasympathetic.restingRfa.value;
  const standRfa = study.sympatheticParasympathetic.standingRfa.value;
  if (restRfa == null || standRfa == null) {
    return {
      claim: "Parasympathetic withdrawal",
      missingFields: [
        ...(restRfa == null ? ["sympatheticParasympathetic.restingRfa"] : []),
        ...(standRfa == null ? ["sympatheticParasympathetic.standingRfa"] : []),
      ],
      explanation:
        "Parasympathetic withdrawal not evaluated: resting and/or standing RFa missing.",
    } as BlockedClaim;
  }
  // Withdrawal pattern: standing RFa noticeably lower than baseline (>20% drop).
  const drop = restRfa > 0 ? (restRfa - standRfa) / restRfa : 0;
  const present = drop >= 0.20;
  return {
    id: "parasympathetic_withdrawal",
    label: "Pattern consistent with parasympathetic withdrawal",
    present,
    criteria: [
      {
        description: "Standing RFa decreased ≥ 20% from resting",
        met: present,
        sourceField: "sympatheticParasympathetic.restingRfa / standingRfa",
      },
    ],
    rationale: present
      ? `Standing RFa fell ${(drop * 100).toFixed(0)}% from resting (${restRfa.toFixed(2)} → ${standRfa.toFixed(2)}).`
      : `RFa change on standing (${(drop * 100).toFixed(0)}%) does not meet withdrawal threshold.`,
    sourceFields: [
      "sympatheticParasympathetic.restingRfa",
      "sympatheticParasympathetic.standingRfa",
    ],
    confidence: strictConfidence(
      minConfidence([
        study.sympatheticParasympathetic.restingRfa.provenance.confidence ?? 0,
        study.sympatheticParasympathetic.standingRfa.provenance.confidence ?? 0,
      ]),
      [
        study.sympatheticParasympathetic.restingRfa,
        study.sympatheticParasympathetic.standingRfa,
      ],
    ),
  };
}

function detectSympatheticExcess(ctx: PhenotypeContext): PhenotypeFlag | BlockedClaim {
  const study = ctx.study;
  const restLfa = study.sympatheticParasympathetic.restingLfa.value;
  const restSb = study.sympatheticParasympathetic.restingSb.value;
  if (restLfa == null && restSb == null) {
    return {
      claim: "Sympathetic excess",
      missingFields: [
        "sympatheticParasympathetic.restingLfa",
        "sympatheticParasympathetic.restingSb",
      ],
      explanation:
        "Sympathetic excess not evaluated: neither resting LFa nor SB extracted.",
    } as BlockedClaim;
  }
  // Heuristic threshold: SB > 2.5 OR LFa elevated >> RFa.
  const sbMet = restSb != null && restSb > 2.5;
  const present = sbMet;
  return {
    id: "sympathetic_excess",
    label: "Pattern consistent with resting sympathetic excess",
    present,
    criteria: [
      {
        description: "Resting sympathovagal balance > 2.5",
        met: sbMet,
        sourceField: "sympatheticParasympathetic.restingSb",
      },
    ],
    rationale: present
      ? `Resting SB = ${restSb?.toFixed(2)} exceeds 2.5.`
      : restSb != null
        ? `Resting SB = ${restSb.toFixed(2)} ≤ 2.5.`
        : "Resting SB not extracted; LFa alone is insufficient to flag excess.",
    sourceFields: [
      "sympatheticParasympathetic.restingLfa",
      "sympatheticParasympathetic.restingSb",
    ],
    confidence: strictConfidence(
      numericToConfidence(
        study.sympatheticParasympathetic.restingSb.provenance.confidence ?? 0,
      ),
      [study.sympatheticParasympathetic.restingSb],
    ),
  };
}

function detectPossibleCanRisk(ctx: PhenotypeContext): PhenotypeFlag | BlockedClaim {
  // Cardiovascular autonomic neuropathy risk: combined cardiovagal + adrenergic impairment.
  // A cuff-only orthostatic screen cannot establish the adrenergic/baroreflex
  // component required for any CAN-risk phenotype. This is a hard safety gate:
  // even an abnormal screen must be reported as not assessed for CAN risk.
  if (ctx.adrenergic.score.screenOnly) {
    return {
      claim: "Possible cardiovascular autonomic neuropathy (CAN) risk",
      missingFields: [
        "adrenergic.beatToBeatBP.valsalvaLatePhaseII",
        "adrenergic.beatToBeatBP.valsalvaPhaseIV",
        "adrenergic.pressureRecoveryTime",
      ],
      explanation:
        "CAN risk not evaluated: the available adrenergic result is an orthostatic cuff-BP screen only. A full beat-to-beat BP/baroreflex assessment (including Valsalva late phase II, phase IV, and pressure recovery) is required.",
    } as BlockedClaim;
  }
  if (!ctx.cardiovagal.score.assessable || !ctx.adrenergic.score.assessable) {
    const missing: string[] = [];
    if (!ctx.cardiovagal.score.assessable) missing.push(...ctx.cardiovagal.score.sourceFields);
    if (!ctx.adrenergic.score.assessable) missing.push(...ctx.adrenergic.score.sourceFields);
    return {
      claim: "Possible cardiovascular autonomic neuropathy (CAN) risk",
      missingFields: missing,
      explanation:
        "CAN risk pattern requires BOTH cardiovagal and adrenergic assessment; one or both domains were not assessable.",
    } as BlockedClaim;
  }
  const cvSev = ctx.cardiovagal.score.severity;
  const adSev = ctx.adrenergic.score.severity;
  const cvImpaired = cvSev === "moderate" || cvSev === "severe";
  const adImpaired = adSev === "moderate" || adSev === "severe";
  const present = cvImpaired && adImpaired;
  return {
    id: "possible_can_risk",
    label: "Pattern consistent with possible cardiovascular autonomic neuropathy (CAN) risk",
    present,
    criteria: [
      { description: "Cardiovagal moderate/severe", met: cvImpaired },
      { description: "Adrenergic moderate/severe", met: adImpaired },
    ],
    rationale: present
      ? "Both cardiovagal and adrenergic domains show moderate-to-severe impairment, consistent with CAN-risk profile."
      : "Combined cardiovagal + adrenergic impairment threshold not met for CAN-risk pattern.",
    sourceFields: [
      ...ctx.cardiovagal.score.sourceFields,
      ...ctx.adrenergic.score.sourceFields,
    ],
    confidence: ([ctx.cardiovagal.score.confidence, ctx.adrenergic.score.confidence] as Confidence[])
      .reduce<Confidence>((acc, c) => {
        const rank = (x: Confidence) => x === "High" ? 2 : x === "Medium" ? 1 : 0;
        return rank(c) < rank(acc) ? c : acc;
      }, "High"),
  };
}

// ----------------------------------------------------------------------------
// Orchestrator
// ----------------------------------------------------------------------------

const DETECTORS = [
  detectOrthostaticHypotension,
  detectPotsLike,
  detectCardiovagalImpairment,
  detectAdrenergicImpairment,
  detectParasympatheticWithdrawal,
  detectSympatheticExcess,
  detectPossibleCanRisk,
];

function isBlockedClaim(x: PhenotypeFlag | BlockedClaim): x is BlockedClaim {
  return (x as BlockedClaim).claim !== undefined && (x as BlockedClaim).missingFields !== undefined;
}

export function detectPhenotypes(ctx: PhenotypeContext): PhenotypeOutput {
  const flags: PhenotypeFlag[] = [];
  const blocked: BlockedClaim[] = [];

  for (const d of DETECTORS) {
    const out = d(ctx);
    if (isBlockedClaim(out)) {
      blocked.push(out);
    } else {
      flags.push(out);
    }
  }

  // If nothing could be evaluated at all, emit an explicit "insufficient_data" flag.
  if (flags.length === 0) {
    flags.push({
      id: "insufficient_data",
      label: "Insufficient data to evaluate autonomic phenotypes",
      present: true,
      criteria: [],
      rationale:
        "All phenotype detectors were blocked by missing input fields. See unsafeOrUnsupportedClaimsBlocked for details.",
      sourceFields: [],
      confidence: "Low",
    });
  }

  return { flags, blocked };
}
