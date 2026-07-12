/**
 * Evidence-availability gates for the Ask ATOM drawer.
 *
 * Ask ATOM must never surface a finding the underlying report cannot support.
 * On a raw-ECG .ans upload the proprietary spectral aggregates (LFa/RFa/SB) and
 * continuous blood pressure are not reproducible, so:
 *   - the composite wellness score/tier are computed over zero-filled spectral
 *     inputs and are therefore NOT trustworthy — the drawer must show
 *     "Not assessed", never a number or a stress label; and
 *   - diagnosis / dosing / treatment prompts must be suppressed, because there
 *     is no supported finding or open therapy gate to justify them.
 *
 * These helpers read scoring output only — they never alter a score.
 */
import type { ANSReport } from "@shared/schema";
import { hasAutonomicBalance } from "@shared/deterministicSynopsis";

export type ViewerRole = "patient" | "clinician";

/**
 * True only when the sympathovagal balance domain was genuinely captured, so the
 * wellness score/tier are meaningful. Mirrors the patient portal's gate:
 * spectralAvailable must not be explicitly false AND the balance split must be
 * non-zero. When false, callers show "Not assessed" with no score/tier.
 */
export function isWellnessAssessable(report: ANSReport): boolean {
  return report.spectralAvailable !== false && hasAutonomicBalance(report);
}

/** A therapy recommendation that is a real intervention, not the gated placeholder. */
function isRealTherapy(t: { intervention?: string } | undefined): boolean {
  if (!t) return false;
  const s = (t.intervention ?? "").toLowerCase();
  if (!s) return false;
  // Deterministic pipeline emits these when the therapy gate is CLOSED.
  if (s.includes("insufficient data")) return false;
  if (s.includes("no specific therapy")) return false;
  return true;
}

/**
 * The therapy gate is OPEN only when the report carries at least one supported
 * indication AND at least one real (non-placeholder) therapy recommendation.
 * Diagnosis / dosing / treatment prompts are permitted only when this is true.
 */
export function isTherapyGateOpen(report: ANSReport): boolean {
  const hasIndication = (report.indications?.length ?? 0) > 0;
  const hasTherapy = (report.therapyRecommendations ?? []).some(isRealTherapy);
  return hasIndication && hasTherapy;
}

/** Number of Ewing ratios classified Normal (used for safe patient-mode prompts). */
function normalEwingCount(report: ANSReport): number {
  const r = report.ratios;
  if (!r) return 0;
  return [r.eiRatio, r.valsalvaRatio, r.thirtyFifteenRatio].filter(
    (x) => x?.classification?.severity === "Normal",
  ).length;
}

/**
 * Evidence-aware suggested prompts for the empty state.
 *
 * When the therapy gate is closed / wellness is not assessable, we ONLY offer
 * prompts that ask about what was actually measured, why domains are
 * unavailable, and what to raise with a clinician — never diagnosis/dosing.
 * Depth still differs by role (clinician gets methodology framing), but both
 * roles share the same evidence boundary.
 */
export function suggestedPrompts(report: ANSReport, mode: ViewerRole): string[] {
  const gateOpen = isTherapyGateOpen(report);

  if (!gateOpen) {
    const normalRatios = normalEwingCount(report);
    const ratioPrompt =
      normalRatios >= 3
        ? "Explain the three normal Ewing ratios"
        : normalRatios > 0
          ? "Explain the Ewing ratios that were measured"
          : "What was measured?";
    if (mode === "clinician") {
      return [
        "What was measured?",
        ratioPrompt,
        "Why are spectral and BP results unavailable?",
      ];
    }
    return [
      "What was measured?",
      ratioPrompt,
      "What should I ask my clinician?",
    ];
  }

  // Therapy gate open → a supported finding exists; richer prompts allowed.
  const top = report.indications?.[0]?.name;
  if (mode === "clinician") {
    return [
      "Explain the Colombo interpretation",
      top ? `Management approach for ${top}?` : "Differential considerations?",
      "Relevant contraindications and monitoring?",
    ];
  }
  return [
    "What does my score mean for daily life?",
    top ? `Tell me more about ${top}.` : "What should I ask my doctor?",
    "What should I ask my doctor?",
  ];
}
