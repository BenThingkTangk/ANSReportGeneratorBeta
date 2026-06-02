/**
 * Sudomotor scoring stub.
 *
 * The current .ans file format does NOT carry sudomotor / QSART data.
 * This module exists as a contractual placeholder so the DiagnosticSummary
 * shape is stable, and so a future input source (e.g. paired QSART CSV,
 * sudomotor section in a future .ans schema) can plug in without touching
 * downstream consumers.
 *
 * Current behavior: ALWAYS returns `assessable: false`.
 */

import type { AnsStudy } from "../../../shared/ansStudy";
import type { DomainScore } from "../../../shared/diagnosticSummary";
import type { Thresholds } from "../thresholds";

export interface SudomotorResult {
  score: DomainScore;
}

export function scoreSudomotor(
  _study: AnsStudy,
  thresholds: Thresholds,
): SudomotorResult {
  // When a future input wires real sudomotor data, this gate flips on
  // and the rest of the scoring logic can be implemented here.
  if (!thresholds.sudomotor.enabled) {
    return {
      score: {
        domain: "sudomotor",
        value: null,
        severity: "not_assessed",
        rationale:
          "Sudomotor / QSART data is not present in the .ans file format. " +
          "Domain marked not assessed by default.",
        sourceFields: [],
        confidence: "Low",
        assessable: false,
        notAssessedReason:
          "No sudomotor/QSART data in .ans file format.",
      },
    };
  }

  // Defensive: even if thresholds.sudomotor.enabled is somehow flipped on
  // without an input source wired up, we still refuse to fabricate a score.
  return {
    score: {
      domain: "sudomotor",
      value: null,
      severity: "not_assessed",
      rationale:
        "Sudomotor scoring enabled in thresholds but no sudomotor input is wired up yet.",
      sourceFields: [],
      confidence: "Low",
      assessable: false,
      notAssessedReason:
        "Sudomotor input source not implemented.",
    },
  };
}
