/**
 * Accessibility regression — touch-target sizing + accessible names.
 *
 * Playwright at 390×844 flagged (a) `ask-atom-input` with no accessible name,
 * and (b) several controls below the WCAG 2.5.5 / iOS-HIG 44×44 CSS-px minimum.
 *
 * Small icon buttons stay visually compact, so under a coarse pointer the
 * `.touch-target` utility grows the element's OWN min box to ≥44px (see
 * `client/src/index.css`). jsdom has NO layout engine, so this suite deliberately
 * asserts only the two things jsdom CAN see:
 *   1. every enumerated control carries the `touch-target` class, and
 *   2. every enumerated control exposes a non-empty accessible name
 *      (aria-label or text content) — the input's missing label was the headline
 *      finding.
 * It also checks that the shipped CSS grows the element's own min-width/height
 * (NOT an ::after overlay) under `(pointer: coarse)` — a pseudo-element never
 * enlarges the measured border box, which was the real bug.
 *
 * IMPORTANT: class presence is NOT proof of a 44px hit box (that was the
 * false-assurance regression). The REAL rendered box is measured in a headless
 * browser at 390×844 with a coarse pointer by
 * `api/_ans/__tests__/touchTargetsBrowser.spec.ts` — that is the authoritative
 * layout test; this one only guards the class+name contract.
 *
 * Uses the de-identified waveform fixture — never PHI. Heavy WebGL/motion libs
 * are stubbed; the voice hook is mocked so the composer renders deterministically.
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
  apiRequest: vi.fn(async () => ({
    json: async () => ({ success: true, message: "Your autonomic balance looks stable overall.", citations: [] }),
  })),
  getQueryFn: () => () => Promise.resolve(null),
  queryClient: {},
}));
const voiceState = {
  supportsListening: true, supportsSpeaking: true,
  listening: false, speaking: false, usedFallback: false,
};
vi.mock("@/hooks/useAtomVoice", () => ({
  useAtomVoice: () => ({
    ...voiceState,
    startListening: () => {}, stopListening: () => {}, toggleListening: () => {},
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
  };
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, "../../../api/_ans/__tests__/fixtures/deidentified_waveform.ans");

async function realUploadReport(): Promise<any> {
  const handler = (await import("../../../api/upload.ts")).default;
  const bytes = readFileSync(FIXTURE);
  const boundary = "----a11yBoundary";
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

/** Accessible name via aria-label or trimmed text content (jsdom-friendly). */
function accessibleName(el: Element): string {
  const label = el.getAttribute("aria-label");
  if (label && label.trim()) return label.trim();
  return (el.textContent || "").trim();
}

describe("a11y — touch targets + accessible names (390×844)", () => {
  let report: any;
  beforeAll(async () => {
    (window.HTMLElement.prototype as any).scrollIntoView = () => {};
    expect(existsSync(FIXTURE)).toBe(true);
    report = (await realUploadReport()).report;
  });
  afterEach(() => rtlCleanup());

  it("the .touch-target CSS grows the element's OWN min box ≥44px under coarse pointer", () => {
    const css = readFileSync(path.resolve(__dirname, "../index.css"), "utf8");
    // Must gate on a coarse pointer (no desktop bloat) and pin the ELEMENT's own
    // min-width/min-height to ≥44px — NOT an ::after overlay, which never enlarges
    // the measured border box (the real bug). The authoritative rendered-box
    // check lives in api/_ans/__tests__/touchTargetsBrowser.spec.ts.
    const coarse = css.match(/@media\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\.touch-target\s*\{[\s\S]*?\}/);
    expect(coarse, "no @media (pointer: coarse) .touch-target rule").toBeTruthy();
    const block = coarse![0];
    expect(block).toMatch(/min-width:\s*44px/);
    expect(block).toMatch(/min-height:\s*44px/);
    // Guard against the discredited overlay approach silently returning.
    expect(css).not.toMatch(/\.touch-target::after\s*\{[\s\S]*?width:\s*max\(100%,\s*44px\)/);
  });

  it("ask-atom-input has an accessible name (was the reported gap)", async () => {
    const { render, fireEvent, within } = await import("@testing-library/react");
    const { AskAtom } = await import("../components/AskAtom");
    const utils = render(<AskAtom report={report} viewerRole="patient" />);
    const scoped = within(utils.container);
    fireEvent.click(scoped.getByTestId("ask-atom-button"));
    const input = scoped.getByTestId("ask-atom-input");
    expect(accessibleName(input).length).toBeGreaterThan(0);
    expect(input.getAttribute("aria-label")).toMatch(/ask about/i);
  });

  it("Ask ATOM drawer + composer controls are touch-sized and named", async () => {
    const { render, fireEvent, within } = await import("@testing-library/react");
    const { AskAtom } = await import("../components/AskAtom");
    const utils = render(<AskAtom report={report} viewerRole="patient" />);
    const scoped = within(utils.container);
    fireEvent.click(scoped.getByTestId("ask-atom-button"));

    // Drawer header + mode toggle + composer controls that were sub-44px.
    const ids = [
      "atom-mute-toggle", "ask-atom-reset", "ask-atom-close",
      "atom-mode-patient", "atom-mode-clinician",
      "ask-atom-mic", "ask-atom-send",
    ];
    for (const id of ids) {
      const el = scoped.getByTestId(id);
      expect(el.className, `${id} missing touch-target`).toContain("touch-target");
      expect(accessibleName(el).length, `${id} has no accessible name`).toBeGreaterThan(0);
    }
  });

  it("top-bar report controls are touch-sized and named", async () => {
    const { render, within } = await import("@testing-library/react");
    const { ReportDashboard } = await import("../components/ReportDashboard");
    const utils = render(<ReportDashboard report={report} onReset={() => {}} />);
    const scoped = within(utils.container);
    for (const id of ["button-back", "button-export-report", "theme-toggle", "toggle-patient", "toggle-clinician"]) {
      const el = scoped.getByTestId(id);
      expect(el.className, `${id} missing touch-target`).toContain("touch-target");
      expect(accessibleName(el).length, `${id} has no accessible name`).toBeGreaterThan(0);
    }
  });

  it("body-map system rows meet the 44px minimum and are named", async () => {
    const { render, within } = await import("@testing-library/react");
    const { ReportDashboard } = await import("../components/ReportDashboard");
    const utils = render(<ReportDashboard report={report} onReset={() => {}} />);
    const scoped = within(utils.container);
    const rows = scoped.queryAllByTestId(/^body-row-/);
    // Patient view renders the body map; if present, every row is min-h-44 + named.
    for (const row of rows) {
      expect(row.className).toContain("min-h-[44px]");
      expect(accessibleName(row).length).toBeGreaterThan(0);
    }
  });
});
