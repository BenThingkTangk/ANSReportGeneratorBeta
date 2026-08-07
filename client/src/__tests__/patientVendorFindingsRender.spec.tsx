/**
 * Integration (real render path) for BLOCKER B — patient plain-English copy.
 *
 * Deployed QA: the clinician Evidence tier correctly showed 9 vendor findings,
 * but the PATIENT plain-English synopsis STILL said "None of the specific
 * autonomic dysfunction patterns this device's own signals screen for were
 * flagged" and Path Forward said "No specific lifestyle interventions flagged."
 * Root cause in the render path: PatientPortalTwoColumn built a vendor-aware
 * deterministic synopsis, then enrichSynopsis() POSTed to the vendor-BLIND
 * /api/synopsis and setSynopsis() OVERWROTE it.
 *
 * This renders the REAL PatientPortalTwoColumn with the merged vendor extraction
 * (letter + report fixtures) and a report parsed from the real de-identified
 * .ans. apiRequest is mocked to return a vendor-blind "nothing flagged"
 * enrichment — the exact overwrite that regressed the copy — and asserts the
 * patient text still names the vendor findings and never says "nothing flagged".
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeVendorExtractions, type NamedExtraction } from "@shared/mergeVendorExtractions";

vi.mock("@react-three/fiber", async () => {
  const React = await import("react");
  return {
    Canvas: ({ children }: any) => React.createElement("div", { "data-stub": "canvas" }, children),
    useFrame: () => {}, useThree: () => ({ camera: {}, gl: {}, scene: {} }), extend: () => {},
  };
});
vi.mock("@react-three/drei", async () => {
  const React = await import("react");
  return {
    OrbitControls: () => null, Line: () => null,
    Text: ({ children }: any) => React.createElement(React.Fragment, null, children),
    Html: ({ children }: any) => React.createElement(React.Fragment, null, children),
  };
});
// The overwrite culprit: a vendor-BLIND enrichment that says nothing was flagged.
vi.mock("@/lib/queryClient", () => ({
  apiRequest: () =>
    Promise.resolve({
      json: async () => ({
        success: true,
        patientSynopsis:
          "Your results look reassuring. None of the specific autonomic dysfunction patterns this device's own signals screen for were flagged in the measured signals.",
      }),
    }),
  getQueryFn: () => () => Promise.reject(new Error("no network in test")),
  queryClient: {},
}));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef(({ children, ...rest }: any, ref: any) => {
      const { initial, animate, exit, transition, whileHover, whileTap, whileInView,
        viewport, variants, layout, layoutId, drag, ...domProps } = rest;
      return React.createElement(tag, { ...domProps, ref }, children);
    });
  const motion = new Proxy({}, { get: (_t, tag: string) => passthrough(tag) });
  return {
    motion,
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
    useReducedMotion: () => true,
    useMotionValue: (v: any) => ({ get: () => v, set: () => {}, on: () => () => {} }),
    useTransform: () => ({ get: () => 0, set: () => {}, on: () => () => {} }),
    useSpring: (v: any) => v,
    useScroll: () => ({ scrollYProgress: { get: () => 0, on: () => () => {} } }),
  };
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fxDir = path.resolve(__dirname, "../../../api/_ans/__tests__/fixtures");
const FIXTURE = path.join(fxDir, "deidentified_waveform.ans");

async function realUploadReport(): Promise<any> {
  const handler = (await import("../../../api/upload.ts")).default;
  const bytes = readFileSync(FIXTURE);
  const boundary = "----patientVendorBoundary";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="ansFile"; filename="deid.ans"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const req = new EventEmitter() as any;
  req.method = "POST";
  req.headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
  const { json } = await new Promise<any>((resolve, reject) => {
    const res: any = {
      _s: 200,
      status(c: number) { this._s = c; return this; },
      setHeader() { return this; },
      json(p: any) { resolve({ status: this._s, json: p }); return this; },
      end() { resolve({ status: this._s, json: null }); return this; },
    };
    handler(req, res).catch(reject);
    setImmediate(() => { req.emit("data", body); req.emit("end"); });
  });
  return json;
}

function mergedVendorExtraction() {
  const letter = JSON.parse(readFileSync(path.join(fxDir, "pare_letter_endpoint_response.json"), "utf8"));
  const report = JSON.parse(readFileSync(path.join(fxDir, "pare_report_endpoint_response.json"), "utf8"));
  const docs: NamedExtraction[] = [
    { fileName: "letter.pdf", extraction: letter.extraction },
    { fileName: "report.pdf", extraction: report.extraction },
  ];
  return mergeVendorExtractions(docs).merged;
}

describe("PatientPortalTwoColumn — vendor findings survive in the rendered copy", () => {
  let report: any;
  let vendor: any;
  beforeAll(async () => {
    report = (await realUploadReport()).report;
    vendor = mergedVendorExtraction();
    // Sanity: the merge really has the 9 findings + SB (so a failure below is
    // about the render path, not the fixture).
    expect(vendor.narrative.findings.length).toBeGreaterThanOrEqual(9);
    expect(vendor.narrative.printedNumbers.find((n: any) => n.key === "SB")?.value).toBeCloseTo(2.59, 2);
  });
  afterEach(async () => (await import("@testing-library/react")).cleanup());

  it("does NOT say 'nothing flagged' and DOES surface the vendor warning", async () => {
    const { render, screen } = await import("@testing-library/react");
    const { PatientPortalTwoColumn } = await import("../components/PatientPortalTwoColumn");
    const { container } = render(<PatientPortalTwoColumn report={report} vendorExtraction={vendor} />);

    // Let any (mocked) enrichment settle — it must NOT overwrite the copy.
    await new Promise((r) => setTimeout(r, 80));

    const text = container.textContent || "";
    expect(text).not.toMatch(/None of the specific autonomic dysfunction patterns/i);
    // Vendor-reported warning, in plain patient language.
    expect(text).toMatch(/vendor report/i);
    expect(text).toMatch(/heart rate/i);              // baseline→DB HR change
    expect(text).toMatch(/sympathetic|pre-syncope|light-headed/i);
    expect(text).toMatch(/blood-pressure|spectral/i); // honest about .ans limits
    expect(text).toMatch(/clinician|review/i);
    expect(text).toMatch(/attached vendor report was processed|attached report: LFa\/RFa not read/i);
    expect(text).not.toMatch(/Supplying the paired vendor|supply the paired vendor|unlocks? the branch-balance|completes that view/i);

    // Path Forward empty-state uses the vendor-aware copy, not "nothing flagged".
    const treatmentsEmpty = screen.getByTestId("treatments-empty");
    expect(treatmentsEmpty.textContent).toMatch(/No automated intervention recommendation; review vendor findings with clinician/i);
    expect(treatmentsEmpty.textContent).not.toMatch(/No specific lifestyle interventions flagged/i);
  });

  it("does not let vendor-blind enrichment overstate an unscorable study", async () => {
    const { render } = await import("@testing-library/react");
    const { PatientPortalTwoColumn } = await import("../components/PatientPortalTwoColumn");
    const { container } = render(<PatientPortalTwoColumn report={report} />);
    await new Promise((r) => setTimeout(r, 50));
    // This real fixture is not scorable. The mocked AI response is intentionally
    // unsafe, so it must not overwrite the deterministic guarded synopsis even
    // when no vendor document is attached.
    const text = container.textContent || "";
    expect(text).not.toMatch(/None of the specific autonomic dysfunction patterns|reassuring/i);
    expect(text).toMatch(/composite wellness score was not calculated/i);
  });
});
