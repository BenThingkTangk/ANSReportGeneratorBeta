/**
 * FIFTH FINAL-QA (mobile layout) + SIXTH follow-up (mobile launcher overlap):
 *
 * A production screenshot at 390x844 showed the FIXED Ask ATOM launcher
 * (bbox 326,780,48,48) still overlaying the lower-right parasympathetic
 * "Not assessed" metric while scrolled to the nervous-system card. Safe-area
 * bottom padding cannot prevent this because a viewport-fixed launcher follows
 * the scroll position, not the document flow.
 *
 * Fix: on mobile the launcher is NON-overlaying — it lives in the sticky top bar
 * (a header icon) instead of floating over content. The fixed floating launcher
 * is retained for tablet/desktop (`sm`+). We assert the structural contract that
 * guarantees no overlay at mobile widths:
 *   1. when AskAtom is controlled (dashboard usage) its fixed launcher is
 *      `hidden` below `sm` (so nothing floats over content on mobile);
 *   2. the dashboard renders a header trigger (`ask-atom-button-mobile`) that is
 *      `sm:hidden` and lives inside the sticky top bar (never over content);
 *   3. clicking the header trigger opens the reachable drawer.
 * The standalone launcher still uses a safe-area-aware bottom offset for the
 * tablet/desktop float. A real pixel screenshot at 390x844 is captured in QA.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup as rtlCleanup } from "@testing-library/react";

vi.mock("@react-three/fiber", async () => {
  const React = await import("react");
  return {
    Canvas: ({ children }: any) => React.createElement("div", null, children),
    useFrame: () => {}, useThree: () => ({}), extend: () => {},
  };
});
vi.mock("@react-three/drei", () => ({
  OrbitControls: () => null, Line: () => null, Text: () => null, Html: () => null,
}));
vi.mock("@/lib/queryClient", () => ({
  apiRequest: () => Promise.reject(new Error("no network")),
  getQueryFn: () => () => Promise.reject(new Error("no network")),
  queryClient: {},
}));
vi.mock("@/hooks/useAtomVoice", () => ({
  useAtomVoice: () => ({
    listening: false, speaking: false, supportsListening: false, usedFallback: false,
    startListening: () => {}, stopListening: () => {}, speak: () => {}, stopSpeaking: () => {},
  }),
}));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef(({ children, ...rest }: any, ref: any) => {
      const { initial, animate, exit, transition, whileHover, whileTap,
        whileInView, viewport, variants, layout, layoutId, drag, ...dom } = rest;
      return React.createElement(tag, { ref, ...dom }, children);
    });
  return {
    motion: new Proxy({}, { get: (_t, k: string) => passthrough(String(k)) }),
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
    useReducedMotion: () => true,
  };
});

const minimalReport: any = {
  wellnessScore: 61,
  wellnessTier: "Stressed",
  spectralAvailable: false,
  bpAvailable: false,
  autonomicBalance: { sympathetic: 0, parasympathetic: 0, available: false },
  indications: [],
  therapyRecommendations: [{ intervention: "Insufficient data — clinician review required" }],
  ratios: {
    eiRatio: { value: 1.21, normal: "> 1.094", classification: { severity: "Normal" } },
    valsalvaRatio: { value: 1.43, normal: "> 1.200", classification: { severity: "Normal" } },
    thirtyFifteenRatio: { value: 1.4, normal: "> 1.092", classification: { severity: "Normal" } },
  },
  phaseEvents: [{ LFa: null, RFa: null }],
  patientData: { firstName: "T", lastName: "P", age: 40 },
  generatedAt: new Date().toISOString(),
};

// --- real upload (for the dashboard integration test) ----------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(
  __dirname,
  "../../../api/_ans/__tests__/fixtures/deidentified_waveform.ans",
);
const REAL_JILL =
  "/home/user/workspace/uploaded_attachments/8e89e1202a664b3089d4ba662bc0c265/Shah-Jill-Fri-Sep-26-2025-2.ans";
function pickFile(): { bytes: Buffer; name: string } {
  if (existsSync(REAL_JILL)) return { bytes: readFileSync(REAL_JILL), name: "Shah-Jill.ans" };
  return { bytes: readFileSync(FIXTURE), name: "deidentified_waveform.ans" };
}
async function realUploadReport(): Promise<any> {
  const handler = (await import("../../../api/upload.ts")).default;
  const { bytes, name } = pickFile();
  const boundary = "----mobileLayoutBoundary";
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

describe("Ask ATOM mobile layout contract (FIFTH/SIXTH FINAL-QA)", () => {
  afterEach(() => rtlCleanup());

  it("standalone floating button uses a safe-area-aware bottom offset, not static bottom-6", async () => {
    const { render, within } = await import("@testing-library/react");
    const { AskAtom } = await import("../components/AskAtom");
    const { container } = render(<AskAtom report={minimalReport} viewerRole="patient" />);
    const btn = within(container).getByTestId("ask-atom-button");

    // Inline safe-area-aware bottom, no legacy Tailwind static offset.
    expect(btn.getAttribute("style") || "").toMatch(/safe-area-inset-bottom/);
    expect(btn.className).not.toMatch(/\bbottom-6\b/);
    // Uncontrolled: launcher is visible at all widths (no forced mobile hide).
    expect(btn.className).not.toMatch(/\bhidden\b/);
  });

  it("controlled floating launcher is hidden below sm so nothing floats over mobile content", async () => {
    const { render, within } = await import("@testing-library/react");
    const { AskAtom } = await import("../components/AskAtom");
    const { container } = render(
      <AskAtom report={minimalReport} viewerRole="patient" open={false} onOpenChange={() => {}} />,
    );
    const btn = within(container).getByTestId("ask-atom-button");
    // Fixed launcher only appears from `sm` up when controlled by a host.
    expect(btn.className).toMatch(/\bhidden\b/);
    expect(btn.className).toMatch(/\bsm:flex\b/);
  });

  describe("dashboard mobile launcher lives in the sticky top bar (never over content)", () => {
    let report: any;
    beforeAll(async () => {
      report = (await realUploadReport()).report;
    });

    it("renders a sm:hidden header trigger and opens the reachable drawer", async () => {
      const { render, within, fireEvent } = await import("@testing-library/react");
      const { ReportDashboard } = await import("../components/ReportDashboard");
      const { container } = render(
        <ReportDashboard report={report} onReset={() => {}} />,
      );
      const scoped = within(container);

      // Mobile header trigger exists and is a mobile-only control.
      const mobileTrigger = scoped.getByTestId("ask-atom-button-mobile");
      expect(mobileTrigger.className).toMatch(/\bsm:hidden\b/);

      // The trigger sits inside the sticky top bar, not over report content.
      const stickyBar = container.querySelector(".sticky.top-0");
      expect(stickyBar).toBeTruthy();
      expect(stickyBar!.contains(mobileTrigger)).toBe(true);

      // Drawer is closed initially, reachable on click.
      expect(scoped.queryByTestId("ask-atom-panel")).toBeNull();
      fireEvent.click(mobileTrigger);
      expect(scoped.getByTestId("ask-atom-panel")).toBeTruthy();

      // The dashboard's fixed launcher is hidden below sm (no mobile float).
      const fixedBtn = scoped.getByTestId("ask-atom-button");
      expect(fixedBtn.className).toMatch(/\bhidden\b/);
      expect(fixedBtn.className).toMatch(/\bsm:flex\b/);
    });
  });
});
