import type { ANSReport } from "@shared/schema";
import { spectralMode } from "@/lib/spectralProvenance";

/**
 * Vendor-PDF reconciliation banner.
 *
 * The audit found this surface collapsed four very different situations into
 * "matched" vs "mismatch", and reported a total read failure as
 * "18 fields · 0% mean conf" — which reads like a poor-quality match rather than
 * "nothing numeric could be read at all". The four states are now distinct:
 *
 *   no_vendor_pdf              — no vendor PDF was attached.
 *   matched                    — attached, identity verified, numbers read.
 *   unreadable_numerics        — attached and identity-verified, but NO numeric
 *                                field could be read (e.g. image-only report).
 *   conflicting_recommendations— attached and readable, but two vendor documents
 *                                disagree (e.g. 3- vs 6-month retest). Both are
 *                                shown; the report does not choose.
 *   mismatch / malformed       — attached but not usable for this study.
 */
export function VendorReconciliationBanner({ report }: { report: ANSReport }) {
  const recon = report.vendorReconciliation;
  const warnings = report.vendorReconciliationWarnings ?? [];
  const mode = spectralMode(report);

  // No vendor PDF at all — state this explicitly rather than rendering nothing,
  // so a clinician can tell "no vendor document" apart from "one was attached
  // but unreadable".
  if ((!recon && warnings.length === 0) || recon?.status === "no_vendor_pdf") {
    return (
      <div
        className="flex items-start gap-2.5 rounded-xl border px-4 py-2.5"
        style={{ background: "hsl(var(--muted) / 0.25)", borderColor: "hsl(var(--border))" }}
        data-testid="vendor-none-banner"
        data-vendor-status="no_vendor_pdf"
      >
        <span className="mt-0.5 text-muted-foreground" aria-hidden="true">○</span>
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-foreground/80">No vendor PDF attached</div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {mode === "estimated"
              ? "Nothing was compared against a signed vendor report. HumanOS waveform estimates of LFa, RFa and SB are available below for visual trend review and are labeled as estimates. They are not PhysioPS-validated, are not interpreted against Colombo norms, and do not affect scoring. Cuff blood pressure remains not assessed."
              : "Nothing was compared against a signed vendor report. Vendor-equivalent LFa, RFa and SB values and cuff blood pressure are unavailable, so those clinical domains remain not assessed."}
          </p>
        </div>
      </div>
    );
  }

  const numericLine =
    recon?.numericFields != null
      ? // PLAIN COUNT. Never "N fields, X% mean confidence".
        `${recon.numericFields.read} of ${recon.numericFields.total} numeric fields read`
      : null;

  const conflicts = recon?.conflicts ?? [];

  if (recon?.status === "matched") {
    return (
      <div
        className="flex items-start gap-2.5 rounded-xl border px-4 py-2.5"
        style={{ background: "hsl(160 60% 45% / 0.08)", borderColor: "hsl(160 60% 45% / 0.3)" }}
        data-testid="vendor-matched-banner"
        data-vendor-status="matched"
      >
        <span className="mt-0.5 text-emerald-300" aria-hidden="true">✓</span>
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-emerald-200">Vendor report matched</div>
          <p className="text-[11px] text-emerald-200/80 leading-relaxed">
            The attached vendor PDF was verified against this study
            {recon.matchedName ? ` for ${recon.matchedName}` : ""}
            {recon.matchedDate ? ` (test ${recon.matchedDate})` : ""}. Vendor-reported spectral and
            blood-pressure values are shown with a vendor-reported provenance badge.
            {numericLine ? ` ${numericLine}.` : ""}
          </p>
        </div>
      </div>
    );
  }

  if (recon?.status === "unreadable_numerics") {
    return (
      <div
        className="flex items-start gap-2.5 rounded-xl border px-4 py-2.5"
        style={{ background: "hsl(38 92% 50% / 0.08)", borderColor: "hsl(38 92% 50% / 0.3)" }}
        data-testid="vendor-unreadable-banner"
        data-vendor-status="unreadable_numerics"
      >
        <span className="mt-0.5 text-amber-300" aria-hidden="true">⚠</span>
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-amber-200">
            Vendor PDF attached — numeric content could not be read
          </div>
          <p className="text-[11px] text-amber-200/80 leading-relaxed">
            {numericLine ?? "0 numeric fields read"}. The document is present and its identity
            reconciled, but no printed value could be extracted (an image-only report yields no
            numeric table). Nothing numeric from the vendor was used, and nothing was guessed.
            {recon.reason ? ` ${recon.reason}` : ""}
          </p>
        </div>
      </div>
    );
  }

  if (recon?.status === "conflicting_recommendations" || conflicts.length > 0) {
    return (
      <div
        className="flex items-start gap-2.5 rounded-xl border px-4 py-2.5"
        style={{ background: "hsl(38 92% 50% / 0.08)", borderColor: "hsl(38 92% 50% / 0.3)" }}
        data-testid="vendor-conflict-banner"
        data-vendor-status="conflicting_recommendations"
      >
        <span className="mt-0.5 text-amber-300" aria-hidden="true">⚠</span>
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-amber-200">
            Vendor documents disagree — not resolved here
          </div>
          {conflicts.map((c) => (
            <div key={c.field} className="mt-1">
              <p className="text-[11px] text-amber-200/80 leading-relaxed">{c.message}</p>
              <ul className="mt-1 space-y-0.5">
                {c.values.map((v, i) => (
                  <li key={i} className="text-[11px] text-amber-100/90 tabular-nums">
                    {v.value} — {v.source}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {numericLine ? (
            <p className="text-[11px] text-amber-200/70 mt-1">{numericLine}.</p>
          ) : null}
        </div>
      </div>
    );
  }

  // mismatch / malformed → explain the withholding.
  return (
    <div
      className="flex items-start gap-2.5 rounded-xl border px-4 py-2.5"
      style={{ background: "hsl(38 92% 50% / 0.08)", borderColor: "hsl(38 92% 50% / 0.3)" }}
      data-testid="vendor-mismatch-banner"
      data-vendor-status={recon?.status ?? "mismatch"}
    >
      <span className="mt-0.5 text-amber-300" aria-hidden="true">⚠</span>
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-amber-200">
          Vendor report not applied — identity did not match
        </div>
        <p className="text-[11px] text-amber-200/80 leading-relaxed">
          {recon?.reason ??
            warnings[0] ??
            "The paired vendor PDF could not be confirmed to belong to this study, so its values were not used. The report below reflects the uploaded .ans only."}
        </p>
      </div>
    </div>
  );
}
