import type { ANSReport } from "@shared/schema";

/**
 * Vendor-PDF identity reconciliation status banner.
 *
 * Shows a clear "Vendor report matched" confirmation after the server verified
 * that the paired vendor PDF's identity (patient name + study date, DOB when
 * present) matches the uploaded .ans — the trust signal a clinician needs
 * before believing the vendor-reported spectral/BP values. On a mismatch it
 * shows why the vendor values were withheld. Renders nothing when no vendor
 * metrics were supplied.
 */
export function VendorReconciliationBanner({ report }: { report: ANSReport }) {
  const recon = report.vendorReconciliation;
  const warnings = report.vendorReconciliationWarnings ?? [];
  if (!recon && warnings.length === 0) return null;

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
            {recon.matchedDate ? ` (test ${recon.matchedDate})` : ""}. Vendor-reported spectral and blood-pressure values are shown with a vendor-reported provenance badge.
          </p>
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
