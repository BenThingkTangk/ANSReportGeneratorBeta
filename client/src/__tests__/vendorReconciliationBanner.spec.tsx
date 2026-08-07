/**
 * Vendor reconciliation banner — "Vendor report matched" vs mismatch, and the
 * baseline provenance badges. Pure component render under jsdom (no network).
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ANSReport } from "@shared/schema";
import { VendorReconciliationBanner } from "../components/VendorReconciliationBanner";

function baseReport(over: Partial<ANSReport>): ANSReport {
  return { patientData: {}, phaseEvents: [], ...(over as any) } as ANSReport;
}

describe("VendorReconciliationBanner", () => {
  it("shows a matched confirmation with name + date", () => {
    render(
      <VendorReconciliationBanner
        report={baseReport({
          vendorReconciliation: {
            status: "matched",
            matchedName: "John Faux",
            matchedDate: "7/11/2024",
            checks: { name: true, testDate: true, dob: true },
          },
        })}
      />,
    );
    const banner = screen.getByTestId("vendor-matched-banner");
    expect(banner).toBeTruthy();
    expect(banner.getAttribute("data-vendor-status")).toBe("matched");
    expect(banner.textContent).toMatch(/Vendor report matched/i);
    expect(banner.textContent).toMatch(/John Faux/);
    expect(banner.textContent).toMatch(/7\/11\/2024/);
  });

  it("shows a mismatch warning and the reason", () => {
    render(
      <VendorReconciliationBanner
        report={baseReport({
          vendorReconciliation: {
            status: "mismatch",
            reason: "Vendor report identity does not match the uploaded .ans: patient name.",
            checks: { name: false, testDate: true, dob: null },
          },
          vendorReconciliationWarnings: ["patient name mismatch"],
        })}
      />,
    );
    const banner = screen.getByTestId("vendor-mismatch-banner");
    expect(banner.getAttribute("data-vendor-status")).toBe("mismatch");
    expect(banner.textContent).toMatch(/not applied|did not match/i);
    expect(banner.textContent).toMatch(/patient name/i);
  });

  // CONTRACT CHANGE: "no vendor PDF" is now an EXPLICIT state. Rendering
  // nothing made it indistinguishable from "a vendor PDF was attached but its
  // numeric content could not be read" — two situations a clinician must be able
  // to tell apart.
  it("states explicitly that no vendor PDF was attached", () => {
    const { container } = render(<VendorReconciliationBanner report={baseReport({})} />);
    expect(container.querySelector('[data-vendor-status="no_vendor_pdf"]')).not.toBeNull();
    expect(container.textContent).toContain("No vendor PDF attached");
  });

  it("describes waveform estimates without claiming they are unavailable", () => {
    const { container } = render(
      <VendorReconciliationBanner
        report={baseReport({
          spectralAvailable: false,
          spectralSource: "humanos_estimated",
          phaseEvents: [
            {
              phase: "Baseline-A",
              LFa: 3.8,
              RFa: 8.57,
              SB: 0.44,
              provenance: {
                LFa: { method: "computed", validation: "estimated" },
              },
            } as any,
          ],
        })}
      />,
    );
    expect(container.textContent).toContain("HumanOS waveform estimates");
    expect(container.textContent).toContain("not PhysioPS-validated");
    expect(container.textContent).not.toMatch(/not reproducible/i);
  });

  it("keeps stored PhysioPS measurements available without requiring a PDF", () => {
    const { container } = render(
      <VendorReconciliationBanner
        report={baseReport({
          spectralAvailable: true,
          spectralSource: "ans_stored",
          phaseEvents: [
            {
              phase: "Baseline-A",
              LFa: 1.2,
              RFa: 0.8,
              SB: 1.5,
              provenance: {
                LFa: { method: "ans_stored", validation: "not_applicable" },
                RFa: { method: "ans_stored", validation: "not_applicable" },
              },
            } as any,
          ],
        })}
      />,
    );
    expect(container.textContent).toContain("Stored PhysioPS measurements");
    expect(container.textContent).toContain("clinically available");
    expect(container.textContent).not.toMatch(/values.*unavailable/i);
  });

  it("renders the server's explicit no-vendor state as no vendor, not a mismatch", () => {
    const { container } = render(
      <VendorReconciliationBanner
        report={baseReport({
          vendorReconciliation: {
            status: "no_vendor_pdf",
            reason: "No vendor PDF was supplied with this upload.",
          },
        })}
      />,
    );
    expect(container.querySelector('[data-vendor-status="no_vendor_pdf"]')).not.toBeNull();
    expect(container.querySelector('[data-vendor-status="mismatch"]')).toBeNull();
    expect(container.textContent).toContain("No vendor PDF attached");
    expect(container.textContent).not.toMatch(/identity did not match/i);
  });

  it("distinguishes attached-but-unreadable from no vendor PDF, with a plain count", () => {
    const { container } = render(
      <VendorReconciliationBanner
        report={baseReport({
          vendorReconciliation: {
            status: "unreadable_numerics",
            numericFields: { read: 0, total: 18 },
          },
        })}
      />,
    );
    expect(container.querySelector('[data-vendor-status="unreadable_numerics"]')).not.toBeNull();
    // Plain count, NOT "18 fields, 0% mean confidence".
    expect(container.textContent).toContain("0 of 18 numeric fields read");
    expect(container.textContent).not.toContain("mean conf");
    expect(container.textContent).not.toContain("0%");
  });

  it("shows a vendor 3-vs-6-month retest conflict instead of choosing one", () => {
    const { container } = render(
      <VendorReconciliationBanner
        report={baseReport({
          vendorReconciliation: {
            status: "conflicting_recommendations",
            conflicts: [
              {
                field: "followUp.retestInterval",
                values: [
                  { value: "6 months", source: "P&S report (page 3)" },
                  { value: "3 months", source: "Clinician letter" },
                ],
                message:
                  "The vendor documents recommend different retest intervals (6 months per P&S report (page 3); 3 months per Clinician letter).",
              },
            ],
          },
        })}
      />,
    );
    expect(container.querySelector('[data-vendor-status="conflicting_recommendations"]')).not.toBeNull();
    expect(container.textContent).toContain("6 months");
    expect(container.textContent).toContain("3 months");
    expect(container.textContent).toContain("Clinician letter");
  });
});
