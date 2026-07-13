/**
 * Shared "vendor spectral not established" state.
 *
 * Rendered in place of any chart that would otherwise depend on the vendor's
 * proprietary spectral aggregates (LFa / RFa / SB and the % changes derived
 * from them) when `report.spectralAvailable === false` — i.e. a raw-ECG .ans
 * upload with no paired vendor report ingested.
 *
 * ACCURACY NOTE: the vendor's per-phase spectral scalars DO physically occur in
 * the .ans binary as IEEE floats (see scripts/audit-ans-spectral.mts), but there
 * is no stable-offset table / constant-stride record / array header to extract
 * them generically, and our open Morlet-CWT recomputation only *approximates*
 * the undisclosed wavelet algorithm — so those computed values are `estimated`,
 * not vendor-equivalent, and are gated OFF clinically. The reliable route to the
 * vendor's exact numbers is attaching the paired report (OCR or text layer).
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
            The vendor's spectral aggregates (LFa / RFa / sympathovagal balance)
            have not been established for this upload. They are produced by an
            undisclosed wavelet algorithm; our open recomputation only
            approximates it, so no estimated or substitute spectral values are
            plotted here — that would risk a misleading reading.
          </p>
          <p className="text-[11px] text-amber-200/60 leading-relaxed">
            Not assessed. Attach the paired vendor report (the exact printed
            values are read verbatim, via OCR for scanned PDFs) to populate the
            vendor-reported spectral and blood-pressure interpretation.
          </p>
        </div>
      </div>
    </div>
  );
}
