/**
 * Ask ATOM — spoken-answer lifecycle + global mute + voice-input controls.
 *
 * Fixes the second production acceptance gap: Ask Atom now has a microphone
 * plus a spoken reply. This exercises the client wiring (server TTS itself is
 * covered in api tests):
 *   - a VOICE-originated question has its finished answer auto-spoken;
 *   - a typed question is NOT auto-spoken;
 *   - the header mute toggle stops speech and suppresses auto-speak;
 *   - an unsupported-recognition browser degrades to a disabled mic (type-only);
 *   - dictated transcript populates the composer and can be submitted;
 *   - the Patient/Clinician role is preserved across a spoken turn.
 *
 * Uses the de-identified waveform fixture — never PHI. Heavy WebGL/motion libs
 * are stubbed; the voice hook is mocked so we can drive it deterministically.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { cleanup as rtlCleanup, act } from "@testing-library/react";
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

// apiRequest resolves with a short, successful answer so the reveal completes
// and any auto-speak can fire.
vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(async () => ({
    json: async () => ({ success: true, message: "Your autonomic balance looks stable overall.", citations: [] }),
  })),
  getQueryFn: () => () => Promise.resolve(null),
  queryClient: {},
}));

// Controllable voice hook. `voiceState` is mutated per-test before render;
// `voiceRef.onTranscript` captures the callback AskAtom registers.
const speak = vi.fn();
const stopSpeaking = vi.fn();
const startListening = vi.fn();
const stopListening = vi.fn();
const voiceState = {
  supportsListening: true, supportsSpeaking: true,
  listening: false, speaking: false, usedFallback: false,
};
const voiceRef: { onTranscript?: (t: string, isFinal: boolean) => void } = {};
vi.mock("@/hooks/useAtomVoice", () => ({
  useAtomVoice: (opts: any) => {
    voiceRef.onTranscript = opts?.onTranscript;
    return {
      supportsListening: voiceState.supportsListening,
      supportsSpeaking: voiceState.supportsSpeaking,
      listening: voiceState.listening,
      speaking: voiceState.speaking,
      usedFallback: voiceState.usedFallback,
      startListening, stopListening, toggleListening: () => {}, speak, stopSpeaking,
    };
  },
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
  };
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, "../../../api/_ans/__tests__/fixtures/deidentified_waveform.ans");

async function realUploadReport(): Promise<any> {
  const handler = (await import("../../../api/upload.ts")).default;
  const bytes = readFileSync(FIXTURE);
  const boundary = "----voiceSpeakBoundary";
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

describe("Ask ATOM — spoken answers + mute + voice input", () => {
  let report: any;
  beforeAll(async () => {
    // jsdom has no layout engine → provide a no-op scrollIntoView so the
    // auto-scroll effect doesn't throw when messages are appended.
    (window.HTMLElement.prototype as any).scrollIntoView = () => {};
    expect(existsSync(FIXTURE)).toBe(true);
    report = (await realUploadReport()).report;
  });

  beforeEach(() => {
    speak.mockClear(); stopSpeaking.mockClear();
    startListening.mockClear(); stopListening.mockClear();
    voiceState.supportsListening = true;
    voiceState.listening = false;
    voiceState.speaking = false;
    voiceRef.onTranscript = undefined;
  });
  afterEach(() => rtlCleanup());

  async function openPanel(viewerRole: "patient" | "clinician" = "patient") {
    const { render, fireEvent, within } = await import("@testing-library/react");
    const { AskAtom } = await import("../components/AskAtom");
    const utils = render(<AskAtom report={report} viewerRole={viewerRole} />);
    const scoped = within(utils.container);
    fireEvent.click(scoped.getByTestId("ask-atom-button"));
    return { ...utils, scoped, fireEvent };
  }

  it("auto-speaks the answer to a VOICE-originated question", async () => {
    const { scoped, fireEvent } = await openPanel("patient");
    // Simulate a dictated transcript, then submit it.
    act(() => voiceRef.onTranscript?.("what does my score mean", true));
    fireEvent.click(scoped.getByTestId("ask-atom-send"));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => expect(speak).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(speak.mock.calls[0][0]).toMatch(/autonomic balance/i);
  });

  it("does NOT auto-speak a typed question", async () => {
    const { scoped, fireEvent } = await openPanel("patient");
    fireEvent.change(scoped.getByTestId("ask-atom-input"), { target: { value: "typed question" } });
    fireEvent.click(scoped.getByTestId("ask-atom-send"));
    const { waitFor } = await import("@testing-library/react");
    // Wait until the answer has finished revealing (Play button appears).
    await waitFor(() => expect(scoped.getByTestId("atom-speak-1")).toBeTruthy(), { timeout: 3000 });
    expect(speak).not.toHaveBeenCalled();
  });

  it("mute toggle stops any speech and suppresses auto-speak", async () => {
    const { scoped, fireEvent } = await openPanel("patient");
    const mute = scoped.getByTestId("atom-mute-toggle");
    expect(mute.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(mute);
    expect(scoped.getByTestId("atom-mute-toggle").getAttribute("aria-pressed")).toBe("true");
    expect(stopSpeaking).toHaveBeenCalled();

    // A voice-originated question while muted must NOT be spoken.
    act(() => voiceRef.onTranscript?.("read this to me", true));
    fireEvent.click(scoped.getByTestId("ask-atom-send"));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => expect(scoped.getByTestId("atom-speak-1")).toBeTruthy(), { timeout: 3000 });
    expect(speak).not.toHaveBeenCalled();
  });

  it("degrades gracefully to a disabled mic when recognition is unsupported", async () => {
    voiceState.supportsListening = false;
    const { scoped } = await openPanel("patient");
    const mic = scoped.getByTestId("ask-atom-mic") as HTMLButtonElement;
    expect(mic.disabled).toBe(true);
    expect(mic.getAttribute("aria-label")).toMatch(/not supported/i);
    // Typing still works.
    expect(scoped.getByTestId("ask-atom-input")).toBeTruthy();
  });

  it("reflects the listening state and lets the mic stop it", async () => {
    voiceState.listening = true;
    const { scoped, fireEvent } = await openPanel("patient");
    const mic = scoped.getByTestId("ask-atom-mic");
    expect(mic.getAttribute("aria-pressed")).toBe("true");
    expect((scoped.getByTestId("ask-atom-input") as HTMLInputElement).placeholder).toMatch(/listening/i);
    fireEvent.click(mic); // listening → stop
    expect(stopListening).toHaveBeenCalled();
  });

  it("submits a dictated transcript as the user's question", async () => {
    const { scoped, fireEvent } = await openPanel("patient");
    act(() => voiceRef.onTranscript?.("how is my heart rate", true));
    expect((scoped.getByTestId("ask-atom-input") as HTMLInputElement).value).toMatch(/how is my heart rate/i);
    fireEvent.click(scoped.getByTestId("ask-atom-send"));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => expect(scoped.getByText("how is my heart rate")).toBeTruthy(), { timeout: 3000 });
  });

  it("preserves the Clinician role across a spoken turn", async () => {
    const { scoped, fireEvent } = await openPanel("clinician");
    expect(scoped.getByTestId("atom-mode-clinician").getAttribute("aria-pressed")).toBe("true");
    act(() => voiceRef.onTranscript?.("summarise the findings", true));
    fireEvent.click(scoped.getByTestId("ask-atom-send"));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => expect(speak).toHaveBeenCalled(), { timeout: 3000 });
    expect(scoped.getByTestId("atom-mode-clinician").getAttribute("aria-pressed")).toBe("true");
  });
});
