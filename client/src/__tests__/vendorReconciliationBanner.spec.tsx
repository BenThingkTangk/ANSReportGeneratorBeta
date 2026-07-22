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

  it("renders nothing when no vendor metrics were supplied", () => {
    const { container } = render(<VendorReconciliationBanner report={baseReport({})} />);
    expect(container.firstChild).toBeNull();
  });
});
