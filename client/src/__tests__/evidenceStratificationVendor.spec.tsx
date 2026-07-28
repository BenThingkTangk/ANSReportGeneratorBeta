/**
 * Regression (BLOCKER B): the clinician Evidence-Stratification panel renders a
 * SEPARATE "Vendor-reported findings" tier when a signed vendor report is
 * attached, so it can never present "Hypotheses 0 / no pattern-level hypotheses"
 * as if nothing was flagged while the attached report has findings. The vendor
 * tier is verbatim + provenance and is kept apart from the deterministic
 * measured/hypothesis tiers.
 */
import { describe, it, expect, vi } from "vitest";
import type { VendorReportExtraction } from "@shared/vendorExtraction";

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef(({ children, ...rest }: any, ref: any) => {
      const { initial, animate, exit, transition, whileHover, whileTap, whileInView,
        viewport, variants, layout, layoutId, drag, ...domProps } = rest;
      return React.createElement(tag, { ...domProps, ref }, children);
    });
  return {
    motion: new Proxy({}, { get: (_t, tag: string) => passthrough(tag) }),
    AnimatePresence: ({ children }: any) => children,
  };
});

function vendorExtraction(): VendorReportExtraction {
  return {
    looksLikeVendorReport: true,
    identity: {} as any,
    baseline: {} as any,
    ratios: {} as any,
    meanConfidence: 0.8,
    fieldCount: 3,
    notes: [],
    narrative: {
      findings: [
        { key: "db.hr_change", phase: "deep_breathing_valsalva", label: "Abnormal changes in HR (baseline to DB)", classification: "abnormal", sourceText: "", sourceFile: "summary.pdf" },
        { key: "stand.sympathetic", phase: "stand", label: "High sympathetic response to stand", classification: "high", sourceText: "", sourceFile: "summary.pdf" },
        { key: "stand.presyncope", phase: "stand", label: "Possible pre-syncope risk", classification: "present", sourceText: "", sourceFile: "summary.pdf" },
      ],
      printedNumbers: [{ key: "SB", value: 2.59 }],
    },
    merged: { sourceFiles: ["colombo-letter.pdf", "summary.pdf"], conflicts: [] },
  } as any;
}

// Deterministic report with NO abnormal findings / hypotheses (the clean-screen
// case that used to render "Hypotheses 0" with no vendor evidence in view).
const cleanReport: any = {
  diagnosticSummary: {
    abnormalFindings: [],
    phenotypeHypotheses: [],
    cardiovagalScore: { domain: "cardiovagal", assessable: true, severity: "normal", value: 0, confidence: "High" },
    adrenergicScore: { domain: "adrenergic", assessable: false, severity: "not_assessed", value: null, confidence: "Low" },
    sudomotorScore: { domain: "sudomotor", assessable: false, severity: "not_assessed", value: null, confidence: "Low" },
  },
};

describe("EvidenceStratification — vendor-reported findings tier", () => {
  it("renders a separate vendor tier with the flagged findings + provenance", async () => {
    const { render, screen, cleanup } = await import("@testing-library/react");
    const { EvidenceStratification } = await import("../components/EvidenceStratification");
    render(<EvidenceStratification report={cleanReport} vendorExtraction={vendorExtraction()} />);

    const tier = screen.getByTestId("tier-vendor-reported");
    const txt = tier.textContent ?? "";
    expect(txt).toMatch(/Vendor-reported findings/i);
    expect(txt).toMatch(/High sympathetic response to stand/i);
    expect(txt).toMatch(/Abnormal changes in HR/i);
    expect(txt).toMatch(/pre-syncope/i);
    // Provenance filename is shown.
    expect(txt).toMatch(/summary\.pdf/);
    // The note about clinical review of vendor categories.
    expect(screen.getByTestId("vendor-reported-note").textContent ?? "").toMatch(/reviewed clinically|review/i);
    cleanup();
  });

  it("omits the vendor tier entirely when no vendor extraction is attached", async () => {
    const { render, screen, cleanup } = await import("@testing-library/react");
    const { EvidenceStratification } = await import("../components/EvidenceStratification");
    render(<EvidenceStratification report={cleanReport} />);
    expect(screen.queryByTestId("tier-vendor-reported")).toBeNull();
    cleanup();
  });
});
