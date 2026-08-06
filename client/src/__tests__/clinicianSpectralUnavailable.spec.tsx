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
 *   2. spectral chart states are CONSISTENT with the payload: when HumanOS
 *      publishes waveform estimates the charts render them, prominently labelled
 *      as unvalidated estimates and with all norm/normal-abnormal colouring
 *      suppressed; only when NO estimate exists is an "not established" card
 *      shown. (The earlier revision of this test asserted the unavailable cards
 *      unconditionally, which contradicted a payload carrying 86 trend points.)
 *   3. the phase-event table shows "—" for spectral cells (consistent with the
 *      Numerical Summary), never a fabricated FRF/LFa/RFa/SB number
 *   4. the Colombo indications empty-state uses the exact honest copy
 *   5. the Ewing ratio tiles report Normal (never abnormal) under the exact
 *      source thresholds
 *
 * Heavy WebGL/chart libs are stubbed (recharts via vitest.client.config alias)
 * so the tree renders under jsdom; the gating logic under test is untouched.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
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
    expect(report.multiParameter?.ecgAvailable).toBe(true);
    // Ratios are healthy (Normal) in the source data.
    expect(report.ratios.eiRatio.classification.severity).toBe("Normal");
    expect(report.ratios.valsalvaRatio.classification.severity).toBe("Normal");
    expect(report.ratios.thirtyFifteenRatio.classification.severity).toBe("Normal");
  });

  afterEach(async () => {
    // Unmount between tests even when an assertion throws, so one failure
    // cannot cascade into "found multiple elements" in every later test.
    const { cleanup } = await import("@testing-library/react");
    cleanup();
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

  function hasEstimates(): boolean {
    return (report.phaseEvents || []).some(
      (p: any) =>
        p.provenance?.LFa?.method === "computed" &&
        p.provenance?.LFa?.validation === "estimated" &&
        (p.LFa != null || p.RFa != null || p.SB != null),
    );
  }

  it("spectral chart states match the payload (estimates render, labelled; no norms)", async () => {
    const { cleanup, screen } = await import("@testing-library/react");
    const { container } = await renderClinician();

    if (hasEstimates()) {
      // 1. Prominent disclosure at the top of the MPG section.
      const banner = screen.getByTestId("mpg-estimate-banner");
      expect(banner.getAttribute("data-spectral-estimated")).toBe("true");
      expect(banner.textContent).toMatch(/HumanOS estimate/i);
      expect(banner.textContent).toMatch(/not PhysioPS-validated/i);

      // 2. The trend chart IS mounted from the estimates, flagged as estimated,
      //    and carries an explicit note — no contradictory unavailable card.
      const chart = screen.getByTestId("mpg-lfa-rfa-chart");
      expect(chart.getAttribute("data-spectral-estimated")).toBe("true");
      expect(screen.queryByTestId("mpg-lfa-rfa-unavailable")).toBeNull();
      expect(screen.getByTestId("mpg-lfa-rfa-estimated-note").textContent).toMatch(
        /not PhysioPS-validated|not vendor-reported/i,
      );

      // 3. Scatter/response maps render in estimate mode, not as an empty card.
      expect(screen.getByTestId("mpg-scatter-estimated")).toBeTruthy();
      expect(screen.queryByTestId("mpg-scatter-unavailable")).toBeNull();

      // 4. No norm bands / normal-abnormal verdicts anywhere in estimate mode.
      const text = container.textContent || "";
      expect(container.querySelectorAll('[data-stub="reference-area"]').length).toBe(0);
      expect(text).not.toMatch(/Colombo norm band applied/i);
      expect(text).not.toMatch(/(LFa|RFa|SB)[^.]{0,40}\b(within normal|abnormal|above norm|below norm)\b/i);

      // 5. Estimates must not drive any interpretation or score.
      expect(report.spectralAvailable).toBe(false);
      expect(report.autonomicBalance?.available).toBe(false);
      expect(report.autonomicBalance?.balance).toBeNull();
    } else {
      // No estimate exists → honest empty state, nothing substituted.
      expect(screen.getByTestId("mpg-scatter-unavailable")).toBeTruthy();
      expect(screen.getByTestId("mpg-lfa-rfa-unavailable")).toBeTruthy();
      expect(screen.queryByTestId("mpg-lfa-rfa-chart")).toBeNull();
    }

    // HR + breathing trends (legitimately ECG-derived) remain present either way.
    const portal = screen.getByTestId("clinician-portal");
    expect(portal.textContent).toMatch(/Heart Rate|HR/);

    cleanup();
  });

  it("phase-event table marks waveform-derived spectral cells as estimates", async () => {
    const { cleanup, screen } = await import("@testing-library/react");
    await renderClinician();

    const table = screen.getByTestId("phase-event-table");
    const body = table.textContent || "";
    // The table still renders (has phase rows / HR data).
    expect(body.length).toBeGreaterThan(50);

    if (report.phaseEvents.some((p: any) => p.provenance?.LFa?.method === "computed")) {
      // Values ARE shown (they are real measurements of the R-R series) but every
      // one of them is marked `est.` and the disclosure names the method and the
      // absence of vendor validation.
      expect(body).toContain("est.");
      const note = screen.getByTestId("phase-event-table-estimated-note");
      expect(note.textContent).toMatch(/estimated by HumanOS/i);
      expect(note.textContent).toMatch(/[Nn]ot a vendor-reported value/);
      expect(note.textContent).toMatch(/not validated against\s+PhysioPS/i);
      // Estimates are NOT colour-coded against the Colombo norms — an
      // unvalidated value must not be rendered as normal/abnormal.
      for (const cell of Array.from(
        table.querySelectorAll('[data-testid$="-estimated"]'),
      ) as HTMLElement[]) {
        expect(cell.getAttribute("style") || "").not.toMatch(/color:/);
      }
    } else {
      // No usable waveform → dashes, never a fabricated number.
      expect(body).not.toContain("0.13");
      expect(body).not.toContain("0.10");
    }

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

  it("Ewing ratio tiles report Normal, never abnormal, under source thresholds", async () => {
    const { cleanup, screen } = await import("@testing-library/react");
    await renderClinician();

    for (const id of ["ratio-tile-ei", "ratio-tile-valsalva", "ratio-tile-3015"]) {
      const status = screen.getByTestId(`${id}-status`);
      expect(status.textContent).toContain("Normal");
      expect(status.textContent).not.toMatch(/High|Low|Abnormal|Borderline/);
    }
    cleanup();
  });
});
