import type { ANSReport } from "@shared/schema";
import { ESTIMATE_BADGE, estimateConfidenceLabel } from "@/lib/spectralProvenance";

/**
 * Prominent disclosure shown above (and inside) every chart that plots
 * waveform-derived spectral estimates.
 *
 * Replaces the previous "spectral output not reproducible" card for the case
 * where estimates DO exist: telling a clinician the values are unavailable
 * while the payload carries 80+ trend points is a contradiction. The values are
 * shown, and the fact that they are HumanOS estimates rather than PhysioPS
 * output is stated at the top of the section, in every chart's row label, and
 * on every affected cell.
 */
export function SpectralEstimateBanner({
  report,
  testId = "mpg-estimate-banner",
  compact = false,
}: {
  report: ANSReport;
  testId?: string;
  compact?: boolean;
}) {
  const conf = estimateConfidenceLabel(report);
  const warnings = report.spectralEstimation?.warnings ?? [];

  return (
    <div
      className={`rounded-xl border border-violet-400/30 bg-violet-400/5 ${compact ? "p-3" : "p-4"}`}
      data-testid={testId}
      data-spectral-estimated="true"
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 shrink-0 rounded-md border border-violet-400/40 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-violet-200"
          aria-hidden="true"
        >
          est.
        </span>
        <div className="min-w-0 space-y-1.5">
          <div className="text-[12px] font-semibold text-violet-100">{ESTIMATE_BADGE}</div>
          <p className="text-[11px] leading-relaxed text-violet-100/80 max-w-3xl">
            LFa, RFa and sympathovagal balance on the charts below are computed by
            HumanOS from the ECG-derived R-R series (Morlet wavelet band power in
            bpm²), not read from a PhysioPS report. They are genuine measurements
            of this recording, but the vendor's wavelet algorithm is undisclosed,
            so these numbers are <span className="font-semibold">not validated
            against PhysioPS output</span> and are deliberately shown without
            Colombo norm shading or normal/abnormal colour-coding. They do not
            feed the wellness score, the dysfunction patterns, the therapy list
            or anything the patient sees.
          </p>
          {conf ? (
            <p className="text-[10px] text-violet-100/60 tabular-nums" data-testid="mpg-estimate-confidence">
              {conf} · attach the paired signed report to obtain vendor-reported values.
            </p>
          ) : null}
          {warnings.length > 0 && !compact ? (
            <ul className="mt-1 space-y-0.5" data-testid="mpg-estimate-warnings">
              {warnings.slice(0, 4).map((w) => (
                <li key={w} className="text-[10px] leading-relaxed text-violet-100/60">
                  · {w}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}
