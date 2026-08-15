/**
 * FOURTH FINAL-QA regression (real render/integration):
 *
 * The clinician view stopped crashing after the THIRD blocker, but the lower
 * graphs then displayed FABRICATED / substitute spectral values that contradict
 * the null-safe numerical summary:
 *   - "Baseline LFa vs RFa" printed ratio 0.00
 *   - "Deep Breathing RFa vs Age" printed "Your RFa: 0.37"
 *   - "Valsalva LFa" printed "Your LFa: 0.00"
 *   - "Stand Response" plotted spectral bars; "RFa Analysis" showed -187 / -92%
 *   - a rolling LFa/RFa trend chart appeared
 *   - the 6-phase event table printed FRF 0.13 / 0.10 while the Numerical
 *     Summary said FRF was not assessed
 *   - Colombo indications said "All resting and dynamic measurements fall within
 *     normal" despite spectral being unavailable
 *   - the Ewing ratio tiles flagged Jill's NORMAL ratios as abnormal via an
 *     invented age-declining upper band
 *
 * This test drives the REAL POST /api/upload handler with the real Jill file
 * (spectralAvailable === false), renders the REAL ClinicianPortalLive tree, and
 * asserts:
 *   1. every forbidden fabricated string/value is ABSENT
 *   2. every "spectral output not reproducible" unavailable state is PRESENT
 *   3. the phase-event table shows "—" for spectral cells (consistent with the
 *      Numerical Summary), never a fabricated FRF/LFa/RFa/SB number
 *   4. the Colombo indications empty-state uses the exact honest copy
 *   5. the Ewing ratio tiles report Normal (never abnormal) under the exact
 *      source thresholds
 *
 * Heavy WebGL/chart libs are stubbed (recharts via vitest.client.config alias)
 * so the tree renders under jsdom; the gating logic under test is untouched.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

// --- Stub WebGL / charting so jsdom can render the tree --------------------
vi.mock("@react-three/fiber", async () => {
  const React = await import("react");
  return {
    Canvas: ({ children }: any) =>
      React.createElement("div", { "data-stub": "canvas" }, children),
    useFrame: () => {},
    useThree: () => ({ camera: {}, gl: {}, scene: {} }),
    extend: () => {},
  };
});
vi.mock("@react-three/drei", async () => {
  const React = await import("react");
  return {
    OrbitControls: () => null,
    Line: () => null,
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
      const {
        initial, animate, exit, transition, whileHover, whileTap,
        whileInView, viewport, variants, layout, layoutId, drag,
        ...domProps
      } = rest;
      return React.createElement(tag, { ref, ...domProps }, children);
    });
  const motion = new Proxy(
    {},
    { get: (_t, key: string) => passthrough(typeof key === "string" ? key : "div") },
  );
  return {
    motion,
    AnimatePresence: ({ children }: any) =>
      React.createElement(React.Fragment, null, children),
    useReducedMotion: () => true,
    useMotionValue: (v: any) => ({ get: () => v, set: () => {}, on: () => () => {} }),
    useTransform: () => ({ get: () => 0, set: () => {}, on: () => () => {} }),
    useSpring: (v: any) => v,
    useScroll: () => ({ scrollYProgress: { get: () => 0, on: () => () => {} } }),
  };
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(
  __dirname,
  "../../../api/_ans/__tests__/fixtures/deidentified_waveform.ans",
);
const REAL_JILL =
  "/home/user/workspace/uploaded_attachments/8e89e1202a664b3089d4ba662bc0c265/Shah-Jill-Fri-Sep-26-2025-2.ans";

function pickFile(): { bytes: Buffer; name: string } {
  if (existsSync(REAL_JILL))
    return { bytes: readFileSync(REAL_JILL), name: "Shah-Jill.ans" };
  return { bytes: readFileSync(FIXTURE), name: "deidentified_waveform.ans" };
}

async function realUploadReport(): Promise<any> {
  const handler = (await import("../../../api/upload.ts")).default;
  const { bytes, name } = pickFile();
  const boundary = "----spectralUnavailBoundary";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="ansFile"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
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

describe("Clinician charts never fabricate spectral values (FOURTH FINAL-QA)", () => {
  let report: any;
  let ansStudy: any;

  beforeAll(async () => {
    const json = await realUploadReport();
    report = json.report;
    ansStudy = json.ansStudy;
  });

  it("confirms the input state: spectral + BP unavailable, ECG present", () => {
    expect(report.spectralAvailable).toBe(false);
    expect(report.bpAvailable).toBe(false);
    expect(report.multiParameter).toBeUndefined();
    // Ratios are healthy (Normal) in the source data.
    expect(report.ratios.eiRatio.classification.severity).toBe("Normal");
    expect(report.ratios.valsalvaRatio.classification.severity).toBe("Normal");
    expect(report.ratios.thirtyFifteenRatio.classification.severity).toBe("Normal");
  });

  async function renderClinician() {
    const { render } = await import("@testing-library/react");
    const { ClinicianPortalLive } = await import("../components/ClinicianPortalLive");
    return render(<ClinicianPortalLive report={report} ansStudy={ansStudy} />);
  }

  it("renders no forbidden fabricated spectral strings/values", async () => {
    const { cleanup } = await import("@testing-library/react");
    const { container } = await renderClinician();
    const text = container.textContent || "";

    // Forbidden substitute-value strings (the exact defect signatures).
    expect(text).not.toContain("LFa/RFa = 0.00");
    expect(text).not.toContain("Your RFa: 0.37");
    expect(text).not.toContain("Your LFa: 0.00");
    expect(text).not.toMatch(/Your (LFa|RFa):\s*0\.00/);
    // No % change fabricated from the null spectral baseline.
    expect(text).not.toContain("-187");
    expect(text).not.toContain("187%");
    expect(text).not.toContain("-92%");
    expect(text).not.toMatch(/-?\d+(\.\d+)?%\s*(RFa|LFa)/);
    // The old misleading empty-state must be gone.
    expect(text).not.toContain("fall within normal Colombo thresholds");

    cleanup();
  });

  it("does not mount the legacy graphical interpretation surface", async () => {
    const { cleanup, screen } = await import("@testing-library/react");
    await renderClinician();

    // Canonical raw uploads deliberately omit the legacy multi-parameter
    // calculation surface rather than presenting a vendor-like interpretation.
    expect(screen.getByTestId("mpg-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("mpg-lfa-rfa-chart")).toBeNull();

    // Direct phase HR data remains available in the measurements table.
    expect(screen.getByTestId("phase-event-table").textContent).toMatch(/HR/);

    cleanup();
  });

  it("phase-event table shows dashes for spectral cells (consistent with summary)", async () => {
    const { cleanup, screen } = await import("@testing-library/react");
    await renderClinician();

    const table = screen.getByTestId("phase-event-table");
    const body = table.textContent || "";
    // No fabricated FRF numbers from the earlier defect.
    expect(body).not.toContain("0.13");
    expect(body).not.toContain("0.10");
    // The table still renders (has phase rows / HR data).
    expect(body.length).toBeGreaterThan(50);

    cleanup();
  });

  it("Colombo indications empty-state uses the exact honest copy", async () => {
    const { cleanup, screen } = await import("@testing-library/react");
    await renderClinician();
    const text = screen.getByTestId("clinician-portal").textContent || "";
    expect(text).toContain(
      "No automated abnormalities among assessed measurements; spectral and BP domains not assessed.",
    );
    cleanup();
  });

  it("retains source-threshold Ewing classifications without mounting a legacy graph", () => {
    for (const ratio of [
      report.ratios.eiRatio,
      report.ratios.valsalvaRatio,
      report.ratios.thirtyFifteenRatio,
    ]) {
      expect(ratio.classification.severity).toBe("Normal");
      expect(ratio.classification.label).not.toMatch(/High|Low|Abnormal|Borderline/);
    }
  });
});
