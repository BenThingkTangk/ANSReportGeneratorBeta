/**
 * Deterministic ANS scoring orchestrator.
 *
 * Consumes a normalized AnsStudy and produces a DiagnosticSummary. The AI
 * narrative layer is allowed to EXPLAIN this output but never override it.
 *
 * Pipeline:
 *   1. Score each domain (cardiovagal, adrenergic, sudomotor) deterministically.
 *   2. Run phenotype detectors against the scored context.
 *   3. Aggregate parser confidence + per-domain confidence into a single
 *      reportConfidence band.
 *   4. Build explanation bullets and the disclaimer envelope.
 */

import type { AnsStudy } from "../../../shared/ansStudy";
import type {
  DiagnosticSummary,
  Confidence,
  AbnormalFinding,
} from "../../../shared/diagnosticSummary";
import {
  SCORING_VERSION,
  DIAGNOSTIC_DISCLAIMER,
} from "../../../shared/diagnosticSummary.js";
import { DEFAULT_THRESHOLDS, type Thresholds } from "../thresholds.js";
import { scoreCardiovagal } from "./cardiovagal.js";
import { scoreAdrenergic } from "./adrenergic.js";
import { scoreSudomotor } from "./sudomotor.js";
import { detectPhenotypes } from "./phenotypes.js";

function confidenceRank(c: Confidence): number {
  return c === "High" ? 2 : c === "Medium" ? 1 : 0;
}

function rankToConfidence(r: number): Confidence {
  if (r >= 2) return "High";
  if (r >= 1) return "Medium";
  return "Low";
}

function numericToConfidence(c: number): Confidence {
  if (c >= 0.75) return "High";
  if (c >= 0.4) return "Medium";
  return "Low";
}

export interface ScoringOptions {
  thresholds?: Thresholds;
}

/**
 * Main entry point. Always returns a DiagnosticSummary — never throws on
 * partial/missing data. Missing domains are flagged, never defaulted to 0.
 */
export function computeDiagnosticSummary(
  study: AnsStudy,
  options: ScoringOptions = {},
): DiagnosticSummary {
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;

  // ---- Per-domain scoring --------------------------------------------------
  const cardiovagal = scoreCardiovagal(study, thresholds);
  const adrenergic = scoreAdrenergic(study, thresholds);
  const sudomotor = scoreSudomotor(study, thresholds);

  const allDomains = [cardiovagal.score, adrenergic.score, sudomotor.score];
  const domainsAssessed = allDomains
    .filter(d => d.assessable)
    .map(d => d.domain);
  const missingDomains = allDomains
    .filter(d => !d.assessable)
    .map(d => d.domain);

  // ---- Severity totals -----------------------------------------------------
  // Sum across ASSESSED domains only. Missing domains are NOT defaulted to 0.
  const assessedScores = allDomains.filter(d => d.assessable && d.value != null);
  const totalAutonomicSeverityScore = assessedScores
    .reduce((acc, d) => acc + (d.value ?? 0), 0);
  const maxPossibleScore = assessedScores.length * 3;

  // ---- Phenotype detection -------------------------------------------------
  const phenotypeOutput = detectPhenotypes({
    study,
    thresholds,
    cardiovagal,
    adrenergic,
  });

  // ---- Abnormal findings collation ----------------------------------------
  const abnormalFindings: AbnormalFinding[] = [
    ...cardiovagal.findings,
    ...adrenergic.findings,
  ];

  // ---- Report confidence rollup -------------------------------------------
  // Combine parser overall confidence with per-domain confidence (assessed only).
  const parserConf = study.parserConfidence.overall ?? 0;
  const domainConfRanks = allDomains
    .filter(d => d.assessable)
    .map(d => confidenceRank(d.confidence));
  const meanDomainConfRank = domainConfRanks.length
    ? domainConfRanks.reduce((a, b) => a + b, 0) / domainConfRanks.length
    : 0;
  const meanDomainConfFraction = meanDomainConfRank / 2; // 0..1

  // Weighted: 40% parser, 60% domain confidence (domain wins because that's
  // what the clinician acts on). If nothing assessable, fall back to parser.
  const reportConfidenceScore = domainConfRanks.length
    ? 0.4 * parserConf + 0.6 * meanDomainConfFraction
    : parserConf;

  // Floor by parser quality: if parser confidence is Low, the report cannot
  // be High no matter how clean an individual ratio looks.
  const parserBand = numericToConfidence(parserConf);
  const domainBand = rankToConfidence(Math.round(meanDomainConfRank));
  const cappedConfidence: Confidence = rankToConfidence(
    Math.min(confidenceRank(parserBand), confidenceRank(domainBand)),
  );

  // ---- Explanation bullets -------------------------------------------------
  const explanationBullets: string[] = [];
  if (cardiovagal.score.assessable) {
    explanationBullets.push(
      `Cardiovagal: ${cardiovagal.score.severity} (score ${cardiovagal.score.value}/3, ${cardiovagal.score.confidence} confidence).`,
    );
  } else {
    explanationBullets.push(
      `Cardiovagal: not assessed — ${cardiovagal.score.notAssessedReason}`,
    );
  }
  if (adrenergic.score.assessable) {
    explanationBullets.push(
      `Adrenergic: ${adrenergic.score.severity} (score ${adrenergic.score.value}/3, ${adrenergic.score.confidence} confidence).`,
    );
  } else {
    explanationBullets.push(
      `Adrenergic: not assessed — ${adrenergic.score.notAssessedReason}`,
    );
  }
  explanationBullets.push(
    `Sudomotor: not assessed — ${sudomotor.score.notAssessedReason}`,
  );
  explanationBullets.push(
    `Total autonomic severity: ${totalAutonomicSeverityScore}/${maxPossibleScore} (assessed domains only).`,
  );
  const presentFlags = phenotypeOutput.flags.filter(f => f.present);
  if (presentFlags.length > 0) {
    explanationBullets.push(
      `Pattern flags raised: ${presentFlags.map(f => f.label).join("; ")}.`,
    );
  } else {
    explanationBullets.push(
      "No abnormal phenotype patterns met thresholds with the data available.",
    );
  }
  if (phenotypeOutput.blocked.length > 0) {
    explanationBullets.push(
      `${phenotypeOutput.blocked.length} pattern check(s) skipped due to missing inputs (see Data Quality panel).`,
    );
  }

  return {
    schemaVersion: "1.0",
    computedAt: new Date().toISOString(),
    scoringVersion: SCORING_VERSION,

    cardiovagalScore: cardiovagal.score,
    adrenergicScore: adrenergic.score,
    sudomotorScore: sudomotor.score,

    totalAutonomicSeverityScore,
    maxPossibleScore,

    domainsAssessed,
    missingDomains,

    abnormalFindings,
    phenotypeFlags: phenotypeOutput.flags,

    reportConfidence: cappedConfidence,
    reportConfidenceScore,

    unsafeOrUnsupportedClaimsBlocked: phenotypeOutput.blocked,
    explanationBullets,

    disclaimer: DIAGNOSTIC_DISCLAIMER,
  };
}

// Re-export for convenience
export { DEFAULT_THRESHOLDS } from "../thresholds.js";
export type { Thresholds } from "../thresholds.js";
