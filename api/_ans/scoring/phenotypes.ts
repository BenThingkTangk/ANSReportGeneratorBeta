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

/**
 * COLOMBO-RULE-1.11 — "There is no parasympathetic withdrawal."
 *
 * Per Dr. Colombo's recorded clinical instruction (April 28 2026 Zoom, cue
 * ~01:05:52–01:07:00): a fall in parasympathetic (RFa) activity during Valsalva
 * or on standing is ALWAYS normal physiology — "there is no bottom to how far
 * down they can go … it's always normal as long as it's going down." Therefore
 * a decreasing RFa on standing/Valsalva must NEVER be surfaced as a dysfunction.
 *
 * This detector no longer emits a dysfunction flag for that pattern. When
 * resting and standing RFa are both available it returns an INFORMATIONAL flag
 * (present:false, so it is excluded from every present-filtered summary, the
 * clinician "why" panel, and Ask ATOM) that simply documents the expected
 * physiologic RFa fall. It never asserts pathology. Genuine reduced-vagal /
 * cardiovagal impairment is detected independently by detectCardiovagalImpairment
 * (E:I, Valsalva, 30:15 ratios) — this change does not alter those thresholds.
 */
function detectParasympatheticWithdrawal(ctx: PhenotypeContext): PhenotypeFlag | BlockedClaim {
  const study = ctx.study;
  const restRfa = study.sympatheticParasympathetic.restingRfa.value;
  const standRfa = study.sympatheticParasympathetic.standingRfa.value;
  if (restRfa == null || standRfa == null) {
    // Not a "blocked dysfunction" — there is no dysfunction to block. Still
    // record that the informational physiology note could not be rendered so the
    // Data-Quality panel stays transparent about missing spectral inputs.
    return {
      claim: "Parasympathetic response on standing (informational, not a dysfunction)",
      missingFields: [
        ...(restRfa == null ? ["sympatheticParasympathetic.restingRfa"] : []),
        ...(standRfa == null ? ["sympatheticParasympathetic.standingRfa"] : []),
      ],
      explanation:
        "Expected physiologic RFa change on standing not shown: resting and/or standing RFa missing. Per COLOMBO-RULE-1.11 an RFa fall on standing is normal and is never flagged as a dysfunction.",
    } as BlockedClaim;
  }
  // COLOMBO-RULE-1.11: an RFa fall on standing/Valsalva is normal — never a
  // dysfunction. `present` is unconditionally false; a decrease is documented as
  // expected physiology, and a rise is simply noted.
  const delta = restRfa > 0 ? (restRfa - standRfa) / restRfa : 0;
  const fell = standRfa <= restRfa;
  return {
    id: "parasympathetic_withdrawal",
    label: "Parasympathetic response on standing (expected physiology)",
    present: false,
    criteria: [
      {
        description:
          "Per COLOMBO-RULE-1.11, a fall in RFa on standing/Valsalva is normal physiology — never a dysfunction.",
        met: false,
        sourceField: "sympatheticParasympathetic.restingRfa / standingRfa",
      },
    ],
    rationale: fell
      ? `Standing RFa was ${(delta * 100).toFixed(0)}% below resting (${restRfa.toFixed(2)} → ${standRfa.toFixed(2)}). Per COLOMBO-RULE-1.11 this is expected, normal parasympathetic behavior on standing — not "parasympathetic withdrawal" and not a dysfunction.`
      : `Standing RFa did not fall (${restRfa.toFixed(2)} → ${standRfa.toFixed(2)}). Either way, per COLOMBO-RULE-1.11 an RFa fall on standing is normal and is never flagged as a dysfunction.`,
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

/**
 * COLOMBO-RULE-2.7 — Baroreceptor reflex dysfunction (Valsalva BP rise < 10%).
 *
 * Dr. Colombo's recorded instruction (April 28 2026 Zoom, cue ~01:09:50–01:10:01):
 *   "Valsalva blood pressure, if it does not go up 10%, that's indicating the risk
 *    for baroreceptor reflex dysfunction compared to resting baseline."
 *
 * STRICT SAFETY GATE: this reflex requires a real Valsalva-strain systolic BP and
 * a real baseline systolic BP. The .ans binary does NOT carry beat-to-beat BP, so
 * these values are only trustworthy when they are GENUINELY EXTRACTED from the
 * paired vendor report / PDF OCR or the device's own recorded cuff fields — never
 * computed, estimated, filename-derived, or inferred from ECG. This detector:
 *   - fires ONLY when BOTH baseline.bp.sbp and valsalva.bp.sbp are present AND
 *     from an authoritative BP source at confidence ≥ 0.5;
 *   - otherwise emits a BlockedClaim → the UI shows "not assessed";
 *   - NEVER infers BP from raw ECG (there is no ECG→BP source in the pipeline, so
 *     an ECG-only study can never satisfy the gate), and rejects computed/estimated.
 * It does not change any existing threshold; it only adds this gated flag.
 *
 * Authoritative sources: the genuinely-in-file AnsStudy ExtractionSource values
 * that carry real BP (`ascii_section`, `binary_double`, `binary_labview_i64`),
 * plus the forward-compat vendor/OCR/measured provenance names used when a paired
 * report's BP is wired directly into the study. `computed`, `estimated`,
 * `filename`, and `missing` are always rejected.
 */
const BARO_MIN_CONFIDENCE = 0.5;
const BARO_AUTHORITATIVE_SOURCES = new Set([
  // forward-compat: paired vendor report / OCR / device-measured provenance
  "vendor_reported",
  "ocr",
  "measured",
  // current AnsStudy in-file sources that carry genuinely-extracted BP
  "ascii_section",
  "binary_double",
  "binary_labview_i64",
]);

function bpSourceIsAuthoritative(p: FieldProvenance | undefined): boolean {
  if (!p) return false;
  if (!BARO_AUTHORITATIVE_SOURCES.has(p.source as string)) return false;
  return (p.confidence ?? 0) >= BARO_MIN_CONFIDENCE;
}

function detectBaroreflexDysfunction(ctx: PhenotypeContext): PhenotypeFlag | BlockedClaim {
  const study = ctx.study;
  const baseSbpField = study.baseline?.bp?.sbp;
  const valsalvaSbpField = study.valsalva?.bp?.sbp;
  const baseSbp = baseSbpField?.value ?? null;
  const valsalvaSbp = valsalvaSbpField?.value ?? null;

  // Gate 1: both values must exist AND be from an authoritative BP source
  // (vendor/OCR/measured) at sufficient confidence. Never infer from ECG.
  const baseOk = baseSbp != null && bpSourceIsAuthoritative(baseSbpField?.provenance);
  const valsalvaOk = valsalvaSbp != null && bpSourceIsAuthoritative(valsalvaSbpField?.provenance);
  if (!baseOk || !valsalvaOk) {
    const missingFields: string[] = [];
    if (!baseOk) missingFields.push("baseline.bp.sbp (vendor/OCR, conf ≥ 0.5)");
    if (!valsalvaOk) missingFields.push("valsalva.bp.sbp (vendor/OCR, conf ≥ 0.5)");
    return {
      claim: "Baroreceptor reflex dysfunction (Valsalva BP rise < 10%)",
      missingFields,
      explanation:
        "Baroreflex not assessed: requires vendor-reported/OCR systolic BP for both resting baseline and Valsalva strain at sufficient confidence. The .ans file does not carry beat-to-beat BP, and BP is never inferred from ECG.",
    } as BlockedClaim;
  }

  // COLOMBO-RULE-2.7: risk when Valsalva SBP does not rise ≥ 10% over baseline.
  const risePct = baseSbp! > 0 ? (valsalvaSbp! - baseSbp!) / baseSbp! : 0;
  const present = risePct < 0.10;
  const confidence = strictConfidence(
    minConfidence([
      baseSbpField!.provenance.confidence ?? 0,
      valsalvaSbpField!.provenance.confidence ?? 0,
    ]),
    [baseSbpField, valsalvaSbpField],
  );
  return {
    id: "baroreflex_dysfunction",
    label: "Pattern consistent with baroreceptor reflex dysfunction risk",
    present,
    criteria: [
      {
        description:
          "Valsalva systolic BP rise < 10% vs resting baseline (COLOMBO-RULE-2.7)",
        met: present,
        sourceField: "baseline.bp.sbp / valsalva.bp.sbp",
      },
    ],
    rationale: present
      ? `Valsalva systolic BP rose only ${(risePct * 100).toFixed(0)}% over baseline (${baseSbp!.toFixed(0)} → ${valsalvaSbp!.toFixed(0)} mmHg), below the 10% expected rise — a risk marker for baroreceptor reflex dysfunction. Vendor/OCR-sourced BP.`
      : `Valsalva systolic BP rose ${(risePct * 100).toFixed(0)}% over baseline (${baseSbp!.toFixed(0)} → ${valsalvaSbp!.toFixed(0)} mmHg), meeting the ≥ 10% expected rise.`,
    sourceFields: ["baseline.bp.sbp", "valsalva.bp.sbp"],
    confidence,
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
  detectBaroreflexDysfunction,
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
