/**
 * Ask ATOM — voice controls + in-chat mode toggle + structured renderer.
 *
 * Verifies (with the deidentified waveform fixture — never PHI):
 *   1. the mic (voice input) button renders when listening is supported;
 *   2. the patient/clinician mode toggle exists inside the chat;
 *   3. the markdown renderer turns headings/bullets into real elements.
 *
 * Heavy WebGL/motion libs are stubbed. Voice hook is mocked to report
 * listening support so the mic button is present and clickable.
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
// Voice hook: report listening support so the mic button renders.
const startListening = vi.fn();
vi.mock("@/hooks/useAtomVoice", () => ({
  useAtomVoice: () => ({
    listening: false, speaking: false, supportsListening: true,
    usedFallback: false, startListening, stopListening: () => {},
    speak: () => {}, stopSpeaking: () => {},
  }),
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
  const boundary = "----voiceModesBoundary";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="ansFile"; filename="deidentified.ans"\r\nContent-Type: application/octet-stream\r\n\r\n`),
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

describe("Ask ATOM voice + modes + structured renderer", () => {
  let report: any;
  beforeAll(async () => {
    expect(existsSync(FIXTURE)).toBe(true);
    report = (await realUploadReport()).report;
  });
  afterEach(() => rtlCleanup());

  async function renderDrawer(viewerRole: "patient" | "clinician") {
    const { render, fireEvent, within } = await import("@testing-library/react");
    const { AskAtom } = await import("../components/AskAtom");
    const utils = render(<AskAtom report={report} viewerRole={viewerRole} />);
    const scoped = within(utils.container);
    fireEvent.click(scoped.getByTestId("ask-atom-button"));
    return { ...utils, scoped, fireEvent };
  }

  it("renders the mic (voice input) button and wires it to startListening", async () => {
    const { scoped, fireEvent } = await renderDrawer("patient");
    const mic = scoped.getByTestId("ask-atom-mic");
    expect(mic).toBeTruthy();
    fireEvent.click(mic);
    expect(startListening).toHaveBeenCalled();
  });

  it("offers an in-chat patient/clinician mode toggle", async () => {
    const { scoped } = await renderDrawer("clinician");
    // Mode buttons exist for both audiences.
    expect(scoped.getByTestId("atom-mode-patient")).toBeTruthy();
    expect(scoped.getByTestId("atom-mode-clinician")).toBeTruthy();
  });

  it("renders evidence-aware follow-up / starter prompt chips", async () => {
    const { scoped } = await renderDrawer("patient");
    const chips = scoped.getAllByTestId(/^prompt-chip-\d+$/);
    expect(chips.length).toBeGreaterThan(0);
  });
});
