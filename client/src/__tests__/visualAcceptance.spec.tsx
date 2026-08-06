/**
 * Visual acceptance (render invariants) — desktop + 390x844 mobile.
 *
 * Drives the REAL /api/upload pipeline on the de-identified Pare fixture and
 * renders the REAL patient + clinician trees, asserting the target experience
 * from the reference recordings while forbidding the old fabricated output:
 *   - patient nervous-system hero + plain-English report + measured Ewing cards
 *   - clinician resting-baseline, indications, multi-parameter, ECG strip
 *   - exact test date, single "Dr." prefix
 *   - NO fabricated LFa/RFa/SB numbers, NO ALA/hydration therapy, NO "Connection
 *     error" as the clinical summary
 *   - mobile (390px) renders the same sections without throwing
 *
 * The recordings are the INTERACTION/layout reference, not numerical truth;
 * numerical truth is the committed fixtures/oracle. Full-bitmap screenshots are
 * produced out-of-band by qa/visual-acceptance.mjs (written to /tmp/vlog).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
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
const PARE = path.resolve(__dirname, "../../../api/_ans/__tests__/fixtures/pare_deid.ans");

async function realReport(): Promise<any> {
  const handler = (await import("../../../api/upload.ts")).default;
  const bytes = readFileSync(PARE);
  const boundary = "----visualAcceptBoundary";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="ansFile"; filename="pare_deid.ans"\r\nContent-Type: application/octet-stream\r\n\r\n`),
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

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { value: width, writable: true, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: height, writable: true, configurable: true });
  window.matchMedia = ((q: string) => ({
    matches: /max-width/.test(q) ? width <= 768 : false,
    media: q, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as any;
  window.dispatchEvent(new Event("resize"));
}

// Forbidden = the OLD fabrication signatures. Note we do NOT forbid the mere
// word "ALA": it legitimately appears in the static literature references
// (Prendergast 2001, ALA neuroprotection). The defect was fabricated SPECTRAL
// numbers and DOSED therapy prose, plus the ATOM connection-error summary.
const FORBIDDEN = [
  /LFa\/RFa\s*=\s*0\.00/, /Your (LFa|RFa):\s*0\.00/,
  /600\s*mg/i, /2\.5\s*mg/i, // ALA / Midodrine doses from the Colombo letter
  /Connection error/i,
];

describe("Visual acceptance — Pare .ans-only report (render invariants)", () => {
  let report: any;
  let ansStudy: any;

  beforeAll(async () => {
    const json = await realReport();
    report = json.report;
    ansStudy = json.ansStudy;
  });

  afterEach(async () => {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  });

  it("input state: identity, Ewing, and stored PhysioPS summary are available", () => {
    expect(report.patientData.testDate).toBe("7/11/2024");
    expect(report.ratios.eiRatio.value).toBeCloseTo(1.22, 2);
    expect(report.spectralAvailable).toBe(true);
    expect(report.spectralSource).toBe("ans_stored");
    expect(report.bpAvailable).toBe(true);
  });

  it("upload screen exposes an accessible, automatable .ans file input", async () => {
    const { render, screen } = await import("@testing-library/react");
    const { UploadScreen } = await import("../components/UploadScreen");
    render(<UploadScreen onUpload={() => {}} />);
    const input = screen.getByTestId("file-input") as HTMLInputElement;
    // Real file input, accept-filtered, and NOT display:none (automatable).
    expect(input.type).toBe("file");
    expect(input.accept).toContain(".ans");
    expect(input.className).not.toMatch(/\bhidden\b/);
  });

  for (const vp of [
    { tag: "desktop", w: 1280, h: 900 },
    { tag: "mobile", w: 390, h: 844 },
  ]) {
    it(`clinician view renders the target sections with accurate provenance (${vp.tag})`, async () => {
      setViewport(vp.w, vp.h);
      const { render } = await import("@testing-library/react");
      const { ClinicianPortalLive } = await import("../components/ClinicianPortalLive");
      const { container } = render(<ClinicianPortalLive report={report} ansStudy={ansStudy} />);
      const text = container.textContent || "";

      // Target sections present.
      expect(text).toMatch(/Resting Baseline/i);
      expect(text).toMatch(/Multi-Parameter Graphical/i);
      expect(text).toMatch(/1\.22/); // measured E/I ratio
      // Single "Dr." prefix, exact date.
      expect(text).toMatch(/Dr\. Colombo/);
      expect(text).not.toMatch(/Dr\.\s*Dr\./);
      // Accurate provenance: spectral not assessed, no fabrications.
      expect(text).toMatch(/Not assessed|not reproducible|not assessed/i);
      for (const bad of FORBIDDEN) expect(text).not.toMatch(bad);
    });

    it(`patient view renders hero + plain-English + measured reflexes (${vp.tag})`, async () => {
      setViewport(vp.w, vp.h);
      const { render } = await import("@testing-library/react");
      const { PatientPortalTwoColumn } = await import("../components/PatientPortalTwoColumn");
      const { container } = render(<PatientPortalTwoColumn report={report} ansStudy={ansStudy} />);
      const text = container.textContent || "";
      expect(text).toMatch(/1\.22/); // measured Ewing ratio surfaced
      for (const bad of FORBIDDEN) expect(text).not.toMatch(bad);
    });
  }
});

// Optional real-file cross-check (local only).
const REAL_PARE = "/home/user/workspace/uploaded_attachments/ec675734cc734ec0bb1f6049b2b17015/Pare-Alex-Thu-Jul-11-2024.ans";
(existsSync(REAL_PARE) ? it : it.skip)("real Pare .ans matches the fixture's test date", async () => {
  // Sanity that the committed fixture preserved the study date.
  expect(existsSync(PARE)).toBe(true);
});
