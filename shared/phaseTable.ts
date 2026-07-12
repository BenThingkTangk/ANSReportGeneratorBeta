/**
 * phaseTable — the ONE canonical ordered phase table for all clinician charts
 * and the patient portal. Every component that renders per-phase rows (numerical
 * summary, phase-event table, portal timelines) MUST import CANONICAL_PHASES
 * rather than re-declaring its own array, so labels/order can never drift.
 */

import type { PhaseMetrics } from "./schema.js";

export type PhaseKey = PhaseMetrics["phase"];

export interface CanonicalPhase {
  key: PhaseKey;
  /** Compact label for dense tables. */
  short: string;
  /** Full clinical maneuver name. */
  full: string;
  /** Single-letter chart tick. */
  letter: string;
}

export const CANONICAL_PHASES: readonly CanonicalPhase[] = [
  { key: "Baseline-A", short: "Baseline A", full: "Resting Baseline", letter: "A" },
  { key: "DeepBreathing-B", short: "Deep Breath B", full: "Deep Breathing (paced)", letter: "B" },
  { key: "Baseline-C", short: "Baseline C", full: "Recovery Baseline", letter: "C" },
  { key: "Valsalva-D", short: "Valsalva D", full: "Valsalva Maneuver", letter: "D" },
  { key: "Baseline-E", short: "Baseline E", full: "Recovery Baseline", letter: "E" },
  { key: "Stand-F", short: "Stand F", full: "Standing / Head-up Tilt", letter: "F" },
] as const;

/** Map a phase key to its canonical descriptor (undefined if unknown). */
export function canonicalPhase(key: string): CanonicalPhase | undefined {
  return CANONICAL_PHASES.find((p) => p.key === key);
}
