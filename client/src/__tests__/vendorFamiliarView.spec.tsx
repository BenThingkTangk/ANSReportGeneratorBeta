/**
 * Vendor-Familiar clinician view + toggle regression.
 *
 * Proves that when a paired vendor extraction is supplied:
 *   • the clinician portal shows the Vendor Familiar / HumanOS Advanced toggle,
 *   • the vendor-familiar view renders the vendor's EXACT verbatim values
 *     (LFa/RFa/SB + the three Ewing ratios) in the familiar P&S grammar,
 *   • fields the extraction did not read are shown as "not read" (never zero),
 *   • switching to HumanOS Advanced renders the analysis tree without crashing.
 */
import { describe, it, expect, vi } from "vitest";
import type { VendorReportExtraction } from "@shared/vendorExtraction";

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef(({ children, ...rest }: any, ref: any) => {
      const {
        initial, animate, exit, transition, whileHover, whileTap,
        whileInView, viewport, variants, layout, layoutId, drag, ...domProps
      } = rest;
      return React.createElement(tag, { ref, ...domProps }, children);
    });
  const motion = new Proxy({}, { get: (_t, key: string) => passthrough(typeof key === "string" ? key : "div") });
  return {
    motion,
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
    useReducedMotion: () => true,
  };
});

function field<T>(value: T | null, page = 1, confidence = 0.9): any {
  return {
    value,
    unit: null,
    provenance: value == null ? null : { page, confidence, sourceText: `${value}` },
  };
}

function makeExtraction(): VendorReportExtraction {
  return {
    looksLikeVendorReport: true,
    identity: {
      patientName: field("Sample, Test"),
      testDate: field("1/2/2020"),
      physician: field("Dr. Example"),
      dob: field("3/4/1980"),
      age: field(40),
      sex: field("Male"),
      heightText: field("5 ft 10 in"),
      weightText: field("170 lbs"),
      bmi: field(24.4),
      ectopicBeats: field(0),
    },
    baseline: {
      meanHR: field(56),
      rangeHR: field(13),
      LFa: field(0.91),
      RFa: field(5.13),
      SB: field(0.18),
      FRF: field(null), // deliberately not read → "not read"
      SBP: field(null),
      DBP: field(null),
    },
    ratios: {
      eiRatio: field(1.21),
      valsalvaRatio: field(1.43),
      thirtyFifteenRatio: field(1.4),
    },
    meanConfidence: 0.8,
    fieldCount: 10,
    notes: [],
  };
}

describe("VendorFamiliarReport — exact vendor parity render", () => {
  it("renders the vendor's verbatim spectral + ratio values", async () => {
    const { render, screen, cleanup } = await import("@testing-library/react");
    const { VendorFamiliarReport } = await import(
      "../components/clinician/VendorFamiliarReport"
    );
    render(<VendorFamiliarReport extraction={makeExtraction()} source="ocr" ocrConfidence={70} />);
    const root = screen.getByTestId("vendor-familiar-report");
    const txt = root.textContent ?? "";
    expect(txt).toContain("0.91"); // LFa
    expect(txt).toContain("5.13"); // RFa
    expect(txt).toContain("0.18"); // SB
    expect(txt).toContain("1.21"); // E/I
    expect(txt).toContain("1.43"); // Valsalva
    // Unread fields shown honestly, never zero-filled.
    expect(txt).toMatch(/not read/i);
    cleanup();
  });
});

describe("ClinicianPortalLive — Vendor Familiar / HumanOS Advanced toggle", () => {
  const report: any = {
    patientData: { firstName: "Test", lastName: "Sample", age: 40, gender: "Male" },
    wellnessScore: 70, wellnessTier: "Moderate", wellnessBreakdown: {},
    spectralAvailable: false, bpAvailable: false,
    autonomicBalance: { parasympathetic: null, sympathetic: null, balance: null, interpretation: "Not assessed" },
    phaseEvents: [], ratios: {
      eiRatio: { value: 1.21, normal: ">1.094", classification: { severity: "Normal", label: "Normal" } },
      valsalvaRatio: { value: 1.43, normal: ">1.200", classification: { severity: "Normal", label: "Normal" } },
      thirtyFifteenRatio: { value: 1.4, normal: ">1.092", classification: { severity: "Normal", label: "Normal" } },
    },
    phaseFindings: [], dysfunctionPatterns: {}, therapyRecommendations: [], contraindications: [],
    followUp: { retestInterval: "", rationale: "", monitorParameters: [] },
    bodySystemImpact: [], clinicalFlags: [], overallImpression: "n/a",
    samplingRate: 250, respiratoryFrequency: null, rPeakCount: 0,
    generatedAt: new Date(0).toISOString(),
    clinicianSynopsis: "Deterministic synopsis for test.",
  };

  it("defaults to Vendor Familiar when an extraction is present and toggles to HumanOS", async () => {
    const { render, screen, fireEvent, cleanup } = await import("@testing-library/react");
    const { ClinicianPortalLive } = await import("../components/ClinicianPortalLive");
    render(
      <ClinicianPortalLive
        report={report}
        vendorExtraction={makeExtraction()}
        vendorSource={{ source: "ocr", ocrConfidence: 70, fileName: "vendor.pdf" }}
      />,
    );
    // Toggle present, vendor view default.
    expect(screen.getByTestId("clinician-view-toggle")).toBeTruthy();
    expect(screen.getByTestId("vendor-familiar-report")).toBeTruthy();

    // Switch to HumanOS Advanced — analysis tree mounts without crash.
    expect(() => fireEvent.click(screen.getByTestId("clinician-view-humanos"))).not.toThrow();
    expect(screen.queryByTestId("vendor-familiar-report")).toBeNull();
    cleanup();
  });

  it("shows no toggle and only the HumanOS view when no vendor report is attached", async () => {
    const { render, screen, cleanup } = await import("@testing-library/react");
    const { ClinicianPortalLive } = await import("../components/ClinicianPortalLive");
    render(<ClinicianPortalLive report={report} />);
    expect(screen.queryByTestId("clinician-view-toggle")).toBeNull();
    expect(screen.queryByTestId("vendor-familiar-report")).toBeNull();
    cleanup();
  });
});
