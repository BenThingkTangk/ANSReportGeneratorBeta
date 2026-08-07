import type { ANSReport, PhaseMetrics } from "@shared/schema";

/**
 * Single source of truth for how the clinician surfaces treat spectral numbers.
 *
 * FOUR MODES — they are NOT interchangeable:
 *
 *  - "stored"      LFa/RFa/SB were read verbatim from the PhysioPS analysis
 *                  summary embedded in the uploaded .ans. Clinically usable;
 *                  no paired PDF is required to display or interpret them.
 *  - "vendor"      LFa/RFa/SB came from the paired signed PhysioPS report at a
 *                  clinically-usable provenance tier. Norm colour-coding, normal
 *                  /abnormal judgements and clinical interpretation are allowed.
 *  - "estimated"   LFa/RFa/SB were computed by HumanOS from the ECG-derived R-R
 *                  series (Morlet wavelet band power, bpm²). These are REAL
 *                  measurements of the recording and must be charted — hiding
 *                  them behind a "not reproducible" card contradicts a payload
 *                  that carries them — but they are NOT vendor values and have
 *                  NOT been validated against PhysioPS output. So: plotted,
 *                  prominently labelled, and never colour-coded against the
 *                  Colombo norm bands, never used for a normal/abnormal call,
 *                  never fed to the wellness score, dysfunction patterns,
 *                  therapy lines or any patient-facing interpretation (that
 *                  gating happens server-side, where `spectralAvailable` stays
 *                  false for an estimate).
 *  - "unavailable" No usable waveform and no vendor value: show the honest
 *                  unavailable state with no numbers at all.
 */
export type SpectralMode = "stored" | "vendor" | "estimated" | "unavailable";

/** Wording used everywhere an estimate is shown. Kept identical across surfaces. */
export const ESTIMATE_BADGE = "HumanOS estimate — not PhysioPS-validated";

export const ESTIMATE_TITLE =
  "Estimated by HumanOS from the ECG-derived R-R series (Morlet wavelet band power, bpm²). " +
  "NOT a vendor-reported value, not validated against PhysioPS output, not colour-coded against " +
  "the Colombo norms, and not used for scoring, diagnosis or patient-facing interpretation.";

/**
 * Neutral series colours used when values are estimates (no norm semantics).
 *
 * Kept deliberately outside the clinical red/green/amber vocabulary so an
 * estimate can never read as a normal/abnormal call. Lightness was raised for
 * legibility on the dark clinician surface (mobile QA: the dotted RFa trace ran
 * along the zero line and was washing out against the dashed gridlines, so both
 * hue lightness and stroke weight were raised); the two traces are additionally
 * separated by stroke pattern (see `chartTheme.ESTIMATE_*_DASH`) so hue is
 * never the only differentiator.
 */
export const ESTIMATE_SERIES_COLOR = "hsl(var(--foreground) / 0.72)";
export const ESTIMATE_LFA_COLOR = "hsl(258 55% 78%)";
export const ESTIMATE_RFA_COLOR = "hsl(193 70% 76%)";

/** True when this phase's spectral values were computed by HumanOS, not supplied. */
export function isEstimatedPhase(m: PhaseMetrics | undefined | null): boolean {
  return (
    m?.provenance?.LFa?.method === "computed" &&
    m?.provenance?.LFa?.validation === "estimated"
  );
}

/** True when this phase's spectral values could not be produced at all. */
export function isUnavailablePhase(m: PhaseMetrics | undefined | null): boolean {
  return m?.provenance?.LFa?.method === "unavailable";
}

function hasAnyEstimatedNumber(report: ANSReport): boolean {
  return (report.phaseEvents ?? []).some(
    (p) =>
      isEstimatedPhase(p) &&
      [p.LFa, p.RFa, p.SB, p.FRF].some((v) => typeof v === "number" && Number.isFinite(v)),
  );
}

function hasAnyTrendPoint(report: ANSReport): boolean {
  const mpg = report.multiParameter;
  return (mpg?.lfaTrend?.v?.length ?? 0) > 0 || (mpg?.rfaTrend?.v?.length ?? 0) > 0;
}

/**
 * Decide the mode for a report. Source and per-phase provenance distinguish
 * stored .ans values from paired-PDF values. An estimate is recognised from
 * provenance + a real number, so an empty payload is never labelled estimated.
 */
export function spectralMode(report: ANSReport): SpectralMode {
  if (
    report.spectralSource === "ans_stored" ||
    (report.phaseEvents ?? []).some(
      (phase) =>
        phase.provenance?.LFa?.method === "ans_stored" ||
        phase.provenance?.RFa?.method === "ans_stored",
    )
  ) {
    return "stored";
  }
  if (report.spectralSource === "vendor_reported") return "vendor";
  // Backward-compatible payloads may predate spectralSource.
  if (report.spectralAvailable === true) return "vendor";
  if (
    report.spectralSource === "humanos_estimated" &&
    (hasAnyEstimatedNumber(report) || hasAnyTrendPoint(report))
  ) {
    return "estimated";
  }
  if (hasAnyEstimatedNumber(report) || hasAnyTrendPoint(report)) {
    // Provenance present but source field absent (older payloads): fall back to
    // per-phase provenance rather than hiding real numbers.
    return (report.phaseEvents ?? []).some(isEstimatedPhase) ? "estimated" : "unavailable";
  }
  return "unavailable";
}

/** Estimation confidence as a percentage string, when the server published one. */
export function estimateConfidenceLabel(report: ANSReport): string | null {
  const c = report.spectralEstimation?.confidence;
  return typeof c === "number" && Number.isFinite(c)
    ? `${Math.round(c * 100)}% method confidence`
    : null;
}
