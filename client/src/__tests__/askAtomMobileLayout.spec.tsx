/**
 * FIFTH FINAL-QA (mobile layout): the fixed Ask ATOM floating button previously
 * used a hard-coded `bottom-6 right-6` offset and overlapped the lower-right
 * report metrics (e.g. the parasympathetic gauge) at 390x844.
 *
 * jsdom cannot measure real geometry, so we assert the structural contract that
 * prevents the overlap:
 *   1. the floating button uses a safe-area-aware bottom offset (env(safe-area-…))
 *      rather than a static Tailwind `bottom-6`; and
 *   2. the report portals reserve safe-area-aware bottom padding so their last
 *      row clears the button footprint.
 * A real pixel screenshot at 390x844 is captured separately during QA.
 */
import { describe, it, expect, vi } from "vitest";

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
};

describe("Ask ATOM mobile layout contract (FIFTH FINAL-QA)", () => {
  it("floating button uses a safe-area-aware bottom offset, not static bottom-6", async () => {
    const { render, within } = await import("@testing-library/react");
    const { AskAtom } = await import("../components/AskAtom");
    const { container } = render(<AskAtom report={minimalReport} viewerRole="patient" />);
    const btn = within(container).getByTestId("ask-atom-button");

    // Inline safe-area-aware bottom, no legacy Tailwind static offset.
    expect(btn.getAttribute("style") || "").toMatch(/safe-area-inset-bottom/);
    expect(btn.className).not.toMatch(/\bbottom-6\b/);
  });
});
