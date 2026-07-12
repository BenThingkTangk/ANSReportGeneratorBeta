/**
 * Shared "spectral output not reproducible" state.
 *
 * Rendered in place of any chart that would otherwise depend on the vendor's
 * proprietary spectral aggregates (LFa / RFa / SB and the % changes derived
 * from them) when `report.spectralAvailable === false` — i.e. a raw-ECG .ans
 * export where the signed-PDF wavelet output is not present.
 *
 * The component deliberately renders NO numeric values, NO substitute zeros,
 * and NO estimated bands, so the clinician is never shown a fabricated spectral
 * reading that would contradict the null-safe summary.
 */
export function SpectralUnavailableCard({
  title,
  testId,
  compact = false,
}: {
  title: string;
  testId: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-amber-400/25 bg-amber-400/5 ${compact ? "p-4" : "p-5"}`}
      data-testid={testId}
      data-spectral-unavailable="true"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-amber-300" aria-hidden="true">⚠</div>
        <div className="space-y-1.5 min-w-0">
          <div className="text-[12px] font-semibold text-amber-200">{title}</div>
          <p className="text-[11px] text-amber-200/80 leading-relaxed max-w-2xl">
            Vendor spectral output (LFa / RFa / sympathovagal balance) is not
            reproducible from this recording. This raw ECG export does not
            contain the proprietary wavelet spectral aggregates — they exist only
            in the signed vendor PDF. To protect against misleading readings, no
            estimated or substitute spectral values are plotted here.
          </p>
          <p className="text-[11px] text-amber-200/60 leading-relaxed">
            Not assessed. Refer to the signed vendor report for spectral and
            blood-pressure interpretation.
          </p>
        </div>
      </div>
    </div>
  );
}
