/**
 * Regression (production QA, merge commit dc9ca56): the patient ATOM question
 * "What did the attached vendor reports find?" answered that only cardiovagal
 * was assessed and omitted the vendor categorical findings.
 *
 * Half of the root cause was on the CLIENT: AskAtom never forwarded the merged
 * vendor extraction to /api/ask-atom, so the server could not ground the answer
 * in the attached documents no matter what the prompt said. This asserts the
 * request body actually carries `vendorExtraction` (both the SSE and the
 * non-streaming fallback paths), and that ReportDashboard passes it down.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { mergeVendorExtractions, type NamedExtraction } from "@shared/mergeVendorExtractions";

vi.mock("@react-three/fiber", async () => {
  const React = await import("react");
  return {
    Canvas: ({ children }: any) => React.createElement("div", null, children),
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
vi.mock("@/hooks/useAtomVoice", () => ({
  useAtomVoice: () => ({
    speak: vi.fn(), stop: vi.fn(), speaking: false, supported: false,
    listening: false, startListening: vi.fn(), stopListening: vi.fn(), voiceSupported: false,
  }),
}));
// Non-streaming fallback path: capture what the component POSTs.
const apiRequestCalls: any[] = [];
vi.mock("@/lib/queryClient", () => ({
  apiRequest: (_method: string, _url: string, body: any) => {
    apiRequestCalls.push(body);
    return Promise.resolve({ json: async () => ({ success: true, message: "ok" }) });
  },
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
const fx = (n: string) => JSON.parse(readFileSync(path.join(fxDir, n), "utf8"));

const LETTER_FILE = "Pare-Alex-Thu-Jul-11-2024.pdf";
const REPORT_FILE = "Pare-Alex-Thu-Jul-11-2024-Report.pdf";

function mergedVendor() {
  const docs: NamedExtraction[] = [
    { fileName: LETTER_FILE, extraction: fx("pare_letter_endpoint_response.json").extraction },
    { fileName: REPORT_FILE, extraction: fx("pare_report_endpoint_response.json").extraction },
  ];
  return mergeVendorExtractions(docs).merged;
}

const REPORT: any = {
  patientData: { firstName: "John", lastName: "Faux", age: 48, gender: "Male", physician: "Colombo" },
  wellnessScore: 70, wellnessTier: "Moderate", wellnessBreakdown: {},
  spectralAvailable: false, bpAvailable: false,
  autonomicBalance: { parasympathetic: null, sympathetic: null, balance: null, interpretation: "Not assessed" },
  phaseEvents: [],
  ratios: {
    eiRatio: { value: 1.22, normal: "> 1.094", classification: { severity: "Normal", label: "Normal" } },
    valsalvaRatio: { value: 1.49, normal: "> 1.200", classification: { severity: "Normal", label: "Normal" } },
    thirtyFifteenRatio: { value: 1.33, normal: "> 1.092", classification: { severity: "Normal", label: "Normal" } },
  },
  phaseFindings: [], dysfunctionPatterns: {}, therapyRecommendations: [], contraindications: [],
  followUp: { retestInterval: "", rationale: "", monitorParameters: [] },
  bodySystemImpact: [], clinicalFlags: [], overallImpression: "n/a", indications: [],
  samplingRate: 250, respiratoryFrequency: null, rPeakCount: 0,
  generatedAt: new Date(0).toISOString(),
};

// jsdom does not implement scrollIntoView; AskAtom auto-scrolls on new messages.
if (!(Element.prototype as any).scrollIntoView) {
  (Element.prototype as any).scrollIntoView = () => {};
}

const realFetch = global.fetch;
beforeEach(() => {
  apiRequestCalls.length = 0;
  // Force the SSE attempt to fail over to the JSON fallback, and capture the
  // streaming body too.
  (global as any).__sseBodies = [];
  global.fetch = vi.fn(async (_url: any, init?: any) => {
    (global as any).__sseBodies.push(JSON.parse(init.body));
    return { ok: false, headers: { get: () => "application/json" }, body: null, json: async () => ({}) } as any;
  }) as any;
});
afterEach(() => { cleanup(); global.fetch = realFetch; });

async function askQuestion(vendorExtraction: any) {
  const { AskAtom } = await import("../components/AskAtom");
  render(
    <AskAtom report={REPORT} vendorExtraction={vendorExtraction} viewerRole="patient" open onOpenChange={() => {}} />,
  );
  const input = await screen.findByTestId("ask-atom-input");
  fireEvent.change(input, { target: { value: "What did the attached vendor reports find?" } });
  fireEvent.click(screen.getByTestId("ask-atom-send"));
  await waitFor(() => {
    expect(apiRequestCalls.length + (global as any).__sseBodies.length).toBeGreaterThan(0);
  }, { timeout: 4000 });
}

describe("AskAtom — forwards the attached vendor extraction to /api/ask-atom", () => {
  it("includes vendorExtraction with the merged findings + SB 2.59 in the request body", async () => {
    const vendor = mergedVendor();
    await askQuestion(vendor);

    const bodies = [...(global as any).__sseBodies, ...apiRequestCalls];
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body.vendorExtraction, "request body must carry vendorExtraction").toBeTruthy();
      const findings = body.vendorExtraction.narrative?.findings ?? [];
      expect(findings.length).toBeGreaterThanOrEqual(9);
      const keys = findings.map((f: any) => f.key);
      expect(keys).toContain("stand.presyncope");
      expect(keys).toContain("db.hr_change");
      expect(keys).toContain("stand.sympathetic");
      const sb = (body.vendorExtraction.narrative?.printedNumbers ?? []).find((n: any) => n.key === "SB");
      expect(sb?.value).toBeCloseTo(2.59, 2);
      // Provenance survives the round trip.
      expect(body.vendorExtraction.merged?.sourceFiles).toContain(LETTER_FILE);
      expect(body.vendorExtraction.merged?.sourceFiles).toContain(REPORT_FILE);
    }
  });

  it("sends vendorExtraction undefined for an .ans-only upload (unchanged path)", async () => {
    await askQuestion(undefined);
    const bodies = [...(global as any).__sseBodies, ...apiRequestCalls];
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(body.vendorExtraction).toBeUndefined();
  });
});

describe("ReportDashboard — passes vendorExtraction down to AskAtom", () => {
  it("threads the merged extraction into the chat request", async () => {
    const { ReportDashboard } = await import("../components/ReportDashboard");
    const vendor = mergedVendor();
    render(<ReportDashboard report={REPORT} vendorExtraction={vendor} onReset={() => {}} />);
    // Open the drawer via the mobile trigger, then ask.
    fireEvent.click(screen.getByTestId("ask-atom-button-mobile"));
    const input = await screen.findByTestId("ask-atom-input");
    fireEvent.change(input, { target: { value: "What did the attached vendor reports find?" } });
    fireEvent.click(screen.getByTestId("ask-atom-send"));
    await waitFor(() => {
      const bodies = [...(global as any).__sseBodies, ...apiRequestCalls];
      expect(bodies.length).toBeGreaterThan(0);
      expect(bodies[0].vendorExtraction?.narrative?.findings?.length ?? 0).toBeGreaterThanOrEqual(9);
    }, { timeout: 4000 });
  });
});
