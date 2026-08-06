/**
 * Estimate-vs-vendor comparison reporter.
 *
 * PURPOSE: make the disagreement between HumanOS waveform estimates and a
 * vendor-printed spectral grid EXPLICIT and quantitative. This module exists so
 * that no surface can imply parity: whenever a paired vendor grid is available,
 * the honest output is a per-phase error table, not a claim of agreement.
 *
 * It is deliberately a pure reporting function:
 *   - it does NOT feed back into the engine,
 *   - it produces NO correction factor, offset, gain or calibration constant,
 *   - it never mutates a report,
 *   - it is generic over any phase grid and never keys on a patient, filename,
 *     study date or demographic.
 *
 * Fitting an engine constant to a comparison like this is exactly the defect
 * that the removed `SCALE = 0.0018` multiplier represented. Do not do it.
 */

export interface VendorPhaseRow {
  duration?: string;
  meanHR?: number | null;
  rangeHR?: number | null;
  FRF?: number | null;
  LFa?: number | null;
  RFa?: number | null;
  /** LFa/RFa as printed by the vendor. */
  ratio?: number | null;
}

export interface EstimatePhaseRow {
  phase: string;
  meanHR?: number | null;
  rangeHR?: number | null;
  FRF?: number | null;
  LFa?: number | null;
  RFa?: number | null;
  SB?: number | null;
}

export interface MetricComparison {
  metric: "meanHR" | "rangeHR" | "FRF" | "LFa" | "RFa" | "SB";
  vendor: number | null;
  estimate: number | null;
  /** estimate - vendor. null when either side is missing. */
  absoluteError: number | null;
  /** (estimate - vendor) / |vendor|, as a fraction. null when vendor is 0/missing. */
  relativeError: number | null;
  /** True when both sides exist and sit on the same side of the vendor value's unity/1.0 reference (SB only). */
  directionAgrees: boolean | null;
}

export interface PhaseComparison {
  phase: string;
  metrics: MetricComparison[];
}

export interface ComparisonSummary {
  phases: PhaseComparison[];
  /** Median absolute relative error per metric, over phases where both sides exist. */
  medianRelativeError: Partial<Record<MetricComparison["metric"], number>>;
  /** Count of phases compared per metric. */
  comparedCount: Partial<Record<MetricComparison["metric"], number>>;
  /**
   * Mandatory disclosure printed with every comparison. States that this is a
   * measurement of disagreement and not a validation.
   */
  disclosure: string;
}

export const COMPARISON_DISCLOSURE =
  "Estimate-vs-vendor comparison. HumanOS values are computed from the ECG-derived R-R series " +
  "(Morlet wavelet band power, bpm²); vendor values are printed by PhysioPS using an undisclosed " +
  "wavelet algorithm, window length, normalisation and artifact policy. The errors below are a " +
  "measurement of DISAGREEMENT, not a validation and not a calibration: no engine constant is " +
  "derived from them, and parity is NOT claimed at any error level.";

function relErr(estimate: number, vendor: number): number | null {
  return vendor === 0 ? null : (estimate - vendor) / Math.abs(vendor);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const METRICS: MetricComparison["metric"][] = ["meanHR", "rangeHR", "FRF", "LFa", "RFa", "SB"];

/**
 * Compare per-phase HumanOS estimates against a vendor grid.
 *
 * @param estimates per-phase engine output (phase name must match the grid key)
 * @param vendorGrid vendor rows keyed by the same phase names
 */
export function compareSpectralToVendor(
  estimates: EstimatePhaseRow[],
  vendorGrid: Record<string, VendorPhaseRow>,
): ComparisonSummary {
  const phases: PhaseComparison[] = [];

  for (const est of estimates) {
    const v = vendorGrid[est.phase];
    if (!v) continue;
    const metrics: MetricComparison[] = METRICS.map((metric) => {
      const vendorValue =
        metric === "SB" ? (v.ratio ?? null) : ((v[metric as keyof VendorPhaseRow] as number | undefined) ?? null);
      const estimateValue = (est[metric as keyof EstimatePhaseRow] as number | null | undefined) ?? null;
      const both =
        typeof vendorValue === "number" &&
        Number.isFinite(vendorValue) &&
        typeof estimateValue === "number" &&
        Number.isFinite(estimateValue);
      return {
        metric,
        vendor: typeof vendorValue === "number" ? vendorValue : null,
        estimate: typeof estimateValue === "number" ? estimateValue : null,
        absoluteError: both ? (estimateValue as number) - (vendorValue as number) : null,
        relativeError: both ? relErr(estimateValue as number, vendorValue as number) : null,
        // For sympathovagal balance the clinically meaningful question is which
        // limb dominates, i.e. which side of 1.0 the value falls on.
        directionAgrees:
          both && metric === "SB"
            ? (estimateValue as number) >= 1 === ((vendorValue as number) >= 1)
            : null,
      };
    });
    phases.push({ phase: est.phase, metrics });
  }

  const medianRelativeError: ComparisonSummary["medianRelativeError"] = {};
  const comparedCount: ComparisonSummary["comparedCount"] = {};
  for (const metric of METRICS) {
    const errs = phases
      .flatMap((p) => p.metrics.filter((m) => m.metric === metric))
      .map((m) => m.relativeError)
      .filter((e): e is number => e != null)
      .map(Math.abs);
    comparedCount[metric] = errs.length;
    if (errs.length > 0) medianRelativeError[metric] = median(errs);
  }

  return { phases, medianRelativeError, comparedCount, disclosure: COMPARISON_DISCLOSURE };
}

/** Human-readable error table. Always prefixed with the disclosure. */
export function formatComparison(summary: ComparisonSummary): string {
  const lines: string[] = [COMPARISON_DISCLOSURE, ""];
  lines.push(
    ["phase", "metric", "vendor", "estimate", "abs err", "rel err"].join("\t"),
  );
  for (const p of summary.phases) {
    for (const m of p.metrics) {
      lines.push(
        [
          p.phase,
          m.metric,
          m.vendor ?? "—",
          m.estimate ?? "—",
          m.absoluteError != null ? m.absoluteError.toFixed(3) : "—",
          m.relativeError != null ? `${(m.relativeError * 100).toFixed(1)}%` : "—",
        ].join("\t"),
      );
    }
  }
  lines.push("");
  for (const metric of Object.keys(summary.medianRelativeError) as MetricComparison["metric"][]) {
    lines.push(
      `median |relative error| ${metric}: ` +
        `${(summary.medianRelativeError[metric]! * 100).toFixed(1)}% ` +
        `(n=${summary.comparedCount[metric]})`,
    );
  }
  lines.push("");
  lines.push("NOT PARITY. No calibration constant is derived from this table.");
  return lines.join("\n");
}
