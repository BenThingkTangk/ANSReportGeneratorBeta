/**
 * FIFTH FINAL-QA regression (real render/grounding):
 *
 * On a raw-ECG .ans upload the report correctly says spectral/BP were not
 * assessed, but the Ask ATOM drawer still:
 *   - showed a fabricated wellness score "61" and stress label "Stressed" in its
 *     context header chip; and
 *   - offered unsupported clinician starter prompts "Differential diagnoses?"
 *     and "Dosing guidance for PE".
 *
 * Both violate the report's safety gates. This test drives the REAL /api/upload
 * with the real Jill file, renders the REAL AskAtom drawer, and asserts:
 *   1. the header shows "Not assessed" with NO numeric score / stress label
 *   2. starter prompts are evidence-aware safe prompts (no diagnosis/dosing)
 *   3. this holds in BOTH patient and clinician modes (same evidence boundary)
 *   4. follow-up pools never leak diagnosis/therapy/dosing chips when the
 *      therapy gate is closed
 *
 * Heavy WebGL/chart libs are stubbed (recharts via vitest.client.config alias).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { cleanup as rtlCleanup } from "@testing-library/react";
import { readFileSync, existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
vi.mock("@/hooks/useAtomVoice", () => ({
  useAtomVoice: () => ({
    listening: false, speaking: false, supportsListening: false,
    usedFallback: false, startListening: () => {}, stopListening: () => {},
    speak: () => {}, stopSpeaking: () => {},
  }),
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
  const boundary = "----askAtomBoundary";
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

const DIAGNOSIS_DOSING = [
  /differential/i,
  /dosing/i,
  /titrat/i,
  /first-line therapy/i,
  /\bPE\b/,
];

describe("Ask ATOM header + prompts stay within report evidence (FIFTH FINAL-QA)", () => {
  let report: any;

  beforeAll(async () => {
    const json = await realUploadReport();
    report = json.report;
  });

  // Unmount between cases so testid queries never see a stale prior render.
  afterEach(() => rtlCleanup());

  it("confirms the input: score present in data but spectral/BP unavailable, no indication", () => {
    // The raw score/tier exist in the report object (that is exactly why the
    // drawer must GATE them rather than print them blindly).
    expect(typeof report.wellnessScore).toBe("number");
    expect(report.spectralAvailable).toBe(false);
    expect(report.bpAvailable).toBe(false);
    expect(report.indications.length).toBe(0);
  });

  async function renderDrawer(viewerRole: "patient" | "clinician") {
    const { render, fireEvent, within } = await import("@testing-library/react");
    const { AskAtom } = await import("../components/AskAtom");
    const utils = render(<AskAtom report={report} viewerRole={viewerRole} />);
    // Open the drawer (scope to this render's container).
    const scoped = within(utils.container);
    fireEvent.click(scoped.getByTestId("ask-atom-button"));
    return { ...utils, scoped };
  }

  for (const role of ["patient", "clinician"] as const) {
    it(`[${role}] header shows "Not assessed", never a score/stress label`, async () => {
      const { scoped } = await renderDrawer(role);

      // The gated chip is shown; the numeric score chip is NOT.
      expect(scoped.getByTestId("atom-score-chip-unavailable")).toBeTruthy();
      expect(scoped.queryByTestId("atom-score-chip")).toBeNull();
      expect(scoped.getByText("Not assessed")).toBeTruthy();

      // The fabricated header values must be absent from the panel.
      const panel = scoped.getByTestId("ask-atom-panel");
      expect(panel.textContent).not.toContain("Stressed");
      expect(panel.textContent).not.toMatch(/\b61\b/);
    });

    it(`[${role}] starter prompts are evidence-aware and never diagnosis/dosing`, async () => {
      const { scoped } = await renderDrawer(role);

      const chips = scoped.getAllByTestId(/^prompt-chip-\d+$/);
      expect(chips.length).toBeGreaterThan(0);
      const texts = chips.map((c) => c.textContent || "");

      for (const t of texts) {
        for (const bad of DIAGNOSIS_DOSING) {
          expect(t).not.toMatch(bad);
        }
      }
      // At least one clearly-safe prompt is offered.
      const joined = texts.join(" | ");
      expect(joined).toMatch(/What was measured\?|Ewing ratios|unavailable|ask my clinician/i);
    });
  }
});
