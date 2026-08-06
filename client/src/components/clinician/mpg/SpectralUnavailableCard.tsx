/**
 * Shared "spectral not established" state.
 *
 * SCOPE (narrowed): this card is now shown ONLY when there is neither a
 * vendor-reported value NOR a HumanOS waveform estimate — i.e. no numbers exist
 * at all. When estimates DO exist the charts are drawn from them and labelled by
 * `SpectralEstimateBanner`; rendering a "not reproducible" card over a payload
 * that carries 80+ trend points was a self-contradiction and has been removed.
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
          <div className="text-[13px] font-semibold text-amber-100 break-words">{title}</div>
          <p className="text-[12.5px] text-amber-50/95 leading-relaxed max-w-2xl">
            No spectral values exist for this view: the vendor's aggregates
            (LFa / RFa / sympathovagal balance) were not supplied, and the
            recording did not carry enough usable beats for HumanOS to compute
            an estimate either. Nothing is substituted or fabricated here.
          </p>
          <p className="text-[12px] text-amber-100/90 leading-relaxed">
            Not assessed. Attach the paired vendor report (the exact printed
            values are read verbatim, via OCR for scanned PDFs) to populate the
            vendor-reported spectral and blood-pressure interpretation.
          </p>
        </div>
      </div>
    </div>
  );
}
