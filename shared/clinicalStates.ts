/**
 * shared/clinicalStates.ts
 *
 * TRI-STATE CLINICAL PATTERN CONTRACT + SCORABILITY CONTRACT.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Alex Pare production-parity audit found the single highest-severity defect
 * in the system: `report.dysfunctionPatterns` published `false` for every
 * clinical pattern the same payload elsewhere declared *unassessable*. A
 * downstream consumer reading `sympatheticExcess: false` is affirmatively told
 * the abnormality is ABSENT. For that recording the vendor clinician documented
 * Sympathetic Excess, pre-syncope risk and Advanced Autonomic Dysfunction.
 *
 * The rule this module encodes:
 *
 *     true  = the pattern was assessed and IS present
 *     false = the pattern was assessed and is genuinely ABSENT
 *     null  = NOT ASSESSABLE (required inputs missing / not reproducible)
 *
 * `false` may never be used as a stand-in for "we could not look". Missing
 * proprietary vendor data (LFa / RFa / SB) is `null`, never "normal"/"absent".
 *
 * The scorability contract below encodes the second-highest-severity defect: a
 * composite wellness score that RENORMALIZED its weights over the available
 * components, so the absence of the one domain the vendor flagged as abnormal
 * silently RAISED the score (91 / "Optimal"). Missing data must suppress the
 * score, never inflate it.
 *
 * Pure module: no I/O, no clock, no patient-specific branching.
 */

// ===========================================================================
// Tri-state
// ===========================================================================

/** true = present, false = assessed-and-absent, null = not assessable. */
export type TriState = boolean | null;

/** Canonical order of the clinical pattern keys. */
export const PATTERN_KEYS = [
  "parasympatheticDominance",
  "parasympatheticExcess",
  "parasympatheticWithdrawal",
  "sympatheticExcess",
  "sympatheticWithdrawal",
  "maskedSW",
  "advancedAutonomicDysfunction",
  "CAN",
  "POTS",
  "orthostaticHypotension",
  "vasovagalRisk",
  "preSyncopeRisk",
  "bradycardia",
  "highFRF",
] as const;

export type PatternKey = (typeof PATTERN_KEYS)[number];

/** Tri-state map of every clinical pattern. */
export type PatternStates = Record<PatternKey, TriState>;

/**
 * Resolve a pattern from a predicate plus an explicit assessability flag.
 * This is the ONLY sanctioned way to produce a pattern value: it makes the
 * "could we even look?" decision impossible to forget.
 *
 * @param assessable whether every input the predicate needs was genuinely present
 * @param predicate  the clinical rule, evaluated only when assessable
 */
export function resolvePattern(assessable: boolean, predicate: () => boolean): TriState {
  return assessable ? predicate() : null;
}

/** Pattern keys that are affirmatively PRESENT. */
export function presentPatterns(p: Partial<PatternStates>): PatternKey[] {
  return PATTERN_KEYS.filter((k) => p[k] === true);
}

/** Pattern keys that could NOT be assessed (null). */
export function unassessablePatterns(p: Partial<PatternStates>): PatternKey[] {
  return PATTERN_KEYS.filter((k) => p[k] === null || p[k] === undefined);
}

/** Pattern keys assessed and genuinely absent. */
export function absentPatterns(p: Partial<PatternStates>): PatternKey[] {
  return PATTERN_KEYS.filter((k) => p[k] === false);
}

/**
 * True only when EVERY pattern was assessed and none is present. This is the
 * only condition under which any surface may say "no abnormal patterns".
 * With even one `null` present the claim is unsupported.
 */
export function mayClaimNoAbnormalPatterns(p: Partial<PatternStates>): boolean {
  return PATTERN_KEYS.every((k) => p[k] === false);
}

// ===========================================================================
// Scorability
// ===========================================================================

export type ScorabilityBlockerCode =
  | "ECG_UNUSABLE"
  | "ECG_ARTIFACT_HRV_UNRELIABLE"
  | "ESSENTIAL_DOMAIN_MISSING"
  | "RATIOS_MISSING"
  | "PATTERNS_UNASSESSABLE";

export interface ScorabilityBlocker {
  code: ScorabilityBlockerCode;
  /** Clinician-readable explanation. Never a diagnosis. */
  message: string;
  /** The scoring domain(s) this blocker invalidates. */
  domains: string[];
}

/**
 * Whether a composite wellness score/tier may be published at all.
 *
 * `scorable: false` means the UI MUST render an explicit "Not scorable" state:
 * no number, no tier, no "Optimal", no reassuring headline. Measured
 * observations (demographics, readable ratios, heart rates) may still display,
 * clearly separated from interpretation.
 */
export interface Scorability {
  scorable: boolean;
  blockers: ScorabilityBlocker[];
  /** Nominal composite weight whose inputs were unavailable (0..1). */
  unavailableWeight: number;
  /** Domains that contributed no measured input. */
  missingDomains: string[];
  /**
   * Plain-language banner text for the "not scorable" state. Empty when
   * scorable. Never contains a score, tier, or reassurance.
   */
  notice: string;
}

/** A scorable result with no blockers. */
export function scorableOk(): Scorability {
  return { scorable: true, blockers: [], unavailableWeight: 0, missingDomains: [], notice: "" };
}

/**
 * Build the not-scorable verdict. Any blocker at all suppresses the score:
 * a composite that silently drops its abnormal domain is worse than no number.
 */
export function scorabilityFrom(
  blockers: ScorabilityBlocker[],
  unavailableWeight: number,
  missingDomains: string[],
): Scorability {
  if (blockers.length === 0) {
    return {
      scorable: true,
      blockers: [],
      unavailableWeight,
      missingDomains,
      notice: "",
    };
  }
  const reasons = blockers.map((b) => b.message).join(" ");
  return {
    scorable: false,
    blockers,
    unavailableWeight,
    missingDomains,
    notice:
      "Not scorable — a composite wellness score is withheld because essential inputs are " +
      `missing or unusable. ${reasons} Measured values below are reported as observations only; ` +
      "they are not an assessment of overall autonomic function.",
  };
}
