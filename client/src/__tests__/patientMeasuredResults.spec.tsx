/**
 * Regression: the patient report renders the three MEASURED Ewing ratio cards
 * (E/I, Valsalva, 30:15) and the concise vendor-spectral provenance note — and
 * does NOT show the old misleading "not enough heart-rhythm" / disclaimer-wall
 * copy. Drives the real /api/upload with the committed de-identified fixture
 * (same ratios as the live-QA Jill file), never PHI.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { cleanup as rtlCleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
vi.mock("@/lib/queryClient", () => ({
  apiRequest: () => Promise.reject(new Error("no network in test")),
  getQueryFn: () => () => Promise.reject(new Error("no network in test")),
  queryClient: {},
}));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef(({ children, ...rest }: any, ref: any) => {
      const { initial, animate, exit, transition, whileHover, whileTap, whileInView,
        viewport, variants, layout, layoutId, drag, ...domProps } = rest;
      return React.createElement(tag, { ref, ...domProps }, children);
    });
  const motion = new Proxy({}, { get: (_t, key: string) => passthrough(typeof key === "string" ? key : "div") });
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
const FIXTURE = path.resolve(__dirname, "../../../api/_ans/__tests__/fixtures/deidentified_waveform.ans");

async function realUploadReport(): Promise<any> {
  const handler = (await import("../../../api/upload.ts")).default;
  const bytes = readFileSync(FIXTURE);
  const boundary = "----measuredResultsBoundary";
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

describe("Patient report — measured Ewing ratio cards + honest provenance", () => {
  let report: any;
  beforeAll(async () => {
    report = (await realUploadReport()).report;
  });
  afterEach(() => rtlCleanup());

  it("renders all three measured Ewing ratio cards with their values", async () => {
    const { render, within } = await import("@testing-library/react");
    const { MeasuredResultsCards } = await import("../components/patient/MeasuredResultsCards");
    const { container } = render(<MeasuredResultsCards report={report} />);
    const scoped = within(container);

    expect(scoped.getByTestId("ewing-card-eiRatio")).toBeTruthy();
    expect(scoped.getByTestId("ewing-card-valsalvaRatio")).toBeTruthy();
    expect(scoped.getByTestId("ewing-card-thirtyFifteenRatio")).toBeTruthy();

    const text = container.textContent || "";
    expect(text).toContain("1.21");
    expect(text).toContain("1.43");
    expect(text).toContain("1.40");
  });

  it("shows the vendor-spectral provenance note and NOT the misleading copy", async () => {
    const { render } = await import("@testing-library/react");
    const { MeasuredResultsCards } = await import("../components/patient/MeasuredResultsCards");
    const { container } = render(<MeasuredResultsCards report={report} />);
    const text = (container.textContent || "").toLowerCase();

    expect(text).toContain("spectral");
    expect(text).toContain(".ans export");
    expect(text).not.toContain("not enough heart-rhythm");
    expect(text).not.toContain("not medical advice");
  });

  it("distinguishes an attached vendor report whose spectral values were not recovered", async () => {
    const { render } = await import("@testing-library/react");
    const { MeasuredResultsCards } = await import("../components/patient/MeasuredResultsCards");
    const { container } = render(
      <MeasuredResultsCards report={report} vendorReportAttached />,
    );
    const text = container.textContent || "";

    expect(text).toMatch(/attached vendor report was processed/i);
    expect(text).toMatch(/readable LFa\/RFa values were not recovered/i);
    expect(text).not.toMatch(/Supplying the paired vendor|unlocks? the full branch-balance/i);
  });
});
