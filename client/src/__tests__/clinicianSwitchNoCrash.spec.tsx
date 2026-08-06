/**
 * THIRD FINAL-QA regression (real render/integration):
 *
 * Reproduces the exact production defect where switching Patient -> Clinician
 * blanked the entire app with:
 *   TypeError: Cannot read properties of null (reading 'toFixed')
 *   in RestingBaselinePanel (spectral LFa/RFa/SB/FRF null on raw ECG uploads).
 *
 * Flow proven here:
 *   1. Drive the REAL POST /api/upload handler with the real Jill file (or the
 *      committed structural fixture) -> obtain the actual report object with
 *      spectralAvailable === false and null spectral fields (the crash input).
 *   2. Render the real ReportDashboard (Patient view) into jsdom.
 *   3. Click the "Clinician" toggle (the exact user action that blanked the app).
 *   4. Assert: NO error thrown, the clinician tree mounted, the app is NOT blank,
 *      and null spectral values render as "Not assessed" (never toFixed on null).
 *   5. Assert the ErrorBoundary fallback did NOT trigger (the crash is truly gone,
 *      not merely contained).
 *
 * Heavy WebGL/chart libs are stubbed so the tree renders under jsdom; the
 * clinician null-safety logic under test is untouched by these stubs.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withoutStoredSummary } from "../../../api/_ans/__tests__/helpers/storedSummary.ts";

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
// Silence network + animation loops that would otherwise keep jsdom busy.
vi.mock("@/lib/queryClient", () => ({
  apiRequest: () => Promise.reject(new Error("no network in test")),
  getQueryFn: () => () => Promise.reject(new Error("no network in test")),
  queryClient: {},
}));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef(({ children, ...rest }: any, ref: any) => {
      // Drop motion-only props that jsdom warns on.
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
// recharts is redirected to a lightweight stub via vitest.client.config.ts
// alias (its real transitive d3 graph stalls vite transform under jsdom).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(
  __dirname,
  "../../../api/_ans/__tests__/fixtures/deidentified_waveform.ans",
);
const REAL_JILL =
  "/home/user/workspace/uploaded_attachments/8e89e1202a664b3089d4ba662bc0c265/Shah-Jill-Fri-Sep-26-2025-2.ans";

function pickFile(): { bytes: Buffer; name: string } {
  if (existsSync(REAL_JILL))
    return { bytes: withoutStoredSummary(readFileSync(REAL_JILL)), name: "Shah-Jill.ans" };
  return {
    bytes: withoutStoredSummary(readFileSync(FIXTURE)),
    name: "deidentified_waveform.ans",
  };
}

async function realUploadReport(): Promise<any> {
  const handler = (await import("../../../api/upload.ts")).default;
  const { bytes, name } = pickFile();
  const boundary = "----clientRenderBoundary";
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

describe("Patient -> Clinician switch does not blank the app (THIRD FINAL-QA)", () => {
  let report: any;
  let ansStudy: any;
  let pageError: Error | null = null;

  beforeAll(async () => {
    const json = await realUploadReport();
    report = json.report;
    ansStudy = json.ansStudy;
    // Fail loudly on any uncaught render error (the "blank screen" signature).
    if (typeof window !== "undefined") {
      window.addEventListener("error", (e) => {
        pageError = (e as ErrorEvent).error ?? new Error((e as ErrorEvent).message);
      });
    }
  });

  it("confirms the crash-input: spectral clinically unavailable, BP absent", () => {
    // The crash input is the UNAVAILABLE CLINICAL GATE, not a null number:
    // waveform-derived LFa/RFa/SB are now published as HumanOS estimates, so the
    // render path must survive "values present but not clinically usable" too.
    expect(report.spectralAvailable).toBe(false);
    expect(report.bpAvailable).toBe(false);
    for (const key of ["LFa", "RFa", "SB"] as const) {
      const prov = report.phaseEvents[0].provenance?.[key];
      expect(["computed", "unavailable"]).toContain(prov?.method);
      if (report.phaseEvents[0][key] !== null) {
        expect(prov?.validation).toBe("estimated");
      }
    }
  });

  it("renders ReportDashboard, clicks Clinician, and never blanks", async () => {
    const { render, screen, fireEvent, cleanup } = await import(
      "@testing-library/react"
    );
    const { ReportDashboard } = await import("../components/ReportDashboard");

    let container: HTMLElement;
    expect(() => {
      const r = render(
        <ReportDashboard report={report} ansStudy={ansStudy} onReset={() => {}} />,
      );
      container = r.container;
    }).not.toThrow();

    // Click the Clinician toggle — the exact action that blanked the app.
    const clinicianBtn = screen.getByTestId("toggle-clinician");
    expect(() => fireEvent.click(clinicianBtn)).not.toThrow();

    // The clinician tree must have mounted (resting-baseline is the crash site).
    expect(
      await screen.findByTestId("resting-baseline-panel"),
    ).toBeTruthy();

    // App is NOT blank: substantial DOM present.
    expect(container!.textContent!.length).toBeGreaterThan(200);

    // No uncaught page error fired.
    expect(pageError).toBeNull();

    // The ErrorBoundary fallback must NOT have triggered — the crash is gone,
    // not merely contained.
    expect(screen.queryByTestId("error-boundary-fallback")).toBeNull();

    // Spectral cells are either a labelled HumanOS estimate (when the waveform
    // supported one) or "Not assessed" — never a coerced number, never NaN.
    const baseline = screen.getByTestId("resting-baseline-panel");
    const estimated =
      report.phaseEvents?.[0]?.provenance?.LFa?.method === "computed" &&
      report.phaseEvents?.[0]?.provenance?.LFa?.validation === "estimated";
    if (estimated) {
      expect(screen.getByTestId("resting-baseline-estimated-note")).toBeTruthy();
      expect(baseline.textContent).toMatch(/est\./);
      // An estimate must never be presented as normal/abnormal.
      expect(baseline.textContent).not.toMatch(/\b(Normal|Abnormal|Borderline)\b/);
    } else {
      expect(baseline.textContent).toMatch(/Not assessed/);
    }
    expect(baseline.textContent).not.toMatch(/NaN/);

    cleanup();
  });

  it("renders the clinician tree standalone without throwing (defense in depth)", async () => {
    const { render, cleanup } = await import("@testing-library/react");
    const { ClinicianPortalLive } = await import(
      "../components/ClinicianPortalLive"
    );
    expect(() =>
      render(<ClinicianPortalLive report={report} ansStudy={ansStudy} />),
    ).not.toThrow();
    cleanup();
  });
});
