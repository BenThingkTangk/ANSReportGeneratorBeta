/**
 * Regression (production QA on build b39f312): passage retrieval worked and the
 * answer contained `[P1]` markers, but the ATOM panel rendered NO source titles
 * and no "sources used" disclosure — the API returned
 * `grounding.passageCitations` and the frontend dropped them (it stored only
 * `{mode, chunks}`).
 *
 * These tests drive the real AskAtom component through its non-streaming path
 * and assert:
 *   • [P1]/[P2] map, in order, to the returned passage citations;
 *   • the "Full-text RAG" indicator appears ONLY when passages were used;
 *   • report-only mode shows no sources block and keeps its honest disclosure;
 *   • citations stay readable at 390px (wrap, not clip) and are not truncated;
 *   • no raw ids / paths / urls can reach the panel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { normalizePassageCitations } from "../components/AskAtom";

vi.mock("@react-three/fiber", async () => {
  const React = await import("react");
  return {
    Canvas: ({ children }: any) => React.createElement("div", null, children),
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
vi.mock("@/hooks/useAtomVoice", () => ({
  useAtomVoice: () => ({
    speak: vi.fn(), stop: vi.fn(), speaking: false, supported: false,
    listening: false, startListening: vi.fn(), stopListening: vi.fn(), voiceSupported: false,
  }),
}));

/** The server response the component will receive (non-streaming path). */
let RESPONSE: any = null;
vi.mock("@/lib/queryClient", () => ({
  apiRequest: () => Promise.resolve({ json: async () => RESPONSE }),
  getQueryFn: () => () => Promise.reject(new Error("no network in test")),
  queryClient: {},
}));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef(({ children, ...rest }: any, ref: any) => {
      const { initial, animate, exit, transition, whileHover, whileTap, whileInView,
        viewport, variants, layout, layoutId, drag, ...domProps } = rest;
      return React.createElement(tag, { ...domProps, ref }, children);
    });
  const motion = new Proxy({}, { get: (_t, tag: string) => passthrough(tag) });
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

// jsdom lacks scrollIntoView; AskAtom auto-scrolls on new messages.
if (!(Element.prototype as any).scrollIntoView) {
  (Element.prototype as any).scrollIntoView = () => {};
}

const P1 =
  "Colombo P&S 04-09-2026 Clinical Consultation (Transcript) (2026), Stand Test — Brakes and Accelerator — 00:21:04–00:24:39";
const P2 = "Clinical Autonomic Dysfunction (2019), p.212";

const REPORT: any = {
  patientData: { firstName: "John", lastName: "Faux", age: 48, gender: "Male", physician: "Colombo" },
  wellnessScore: 70, wellnessTier: "Moderate", wellnessBreakdown: {},
  spectralAvailable: false, bpAvailable: false,
  autonomicBalance: { parasympathetic: null, sympathetic: null, balance: null, interpretation: "Not assessed" },
  phaseEvents: [],
  ratios: {
    eiRatio: { value: 1.22, normal: "> 1.094", classification: { severity: "Normal", label: "Normal" } },
    valsalvaRatio: { value: 1.49, normal: "> 1.200", classification: { severity: "Normal", label: "Normal" } },
    thirtyFifteenRatio: { value: 1.33, normal: "> 1.092", classification: { severity: "Normal", label: "Normal" } },
  },
  phaseFindings: [], dysfunctionPatterns: {}, therapyRecommendations: [], contraindications: [],
  followUp: { retestInterval: "", rationale: "", monitorParameters: [] },
  bodySystemImpact: [], clinicalFlags: [], overallImpression: "n/a", indications: [],
  samplingRate: 250, respiratoryFrequency: null, rPeakCount: 0,
  generatedAt: new Date(0).toISOString(),
};

const realFetch = global.fetch;
beforeEach(() => {
  // Force the SSE attempt to fail so the component uses the JSON fallback.
  global.fetch = vi.fn(async () => ({
    ok: false, headers: { get: () => "application/json" }, body: null, json: async () => ({}),
  })) as any;
});
afterEach(() => { cleanup(); global.fetch = realFetch; RESPONSE = null; });

async function ask(question = "How does Dr. Colombo explain the stand test using brakes and an accelerator?") {
  const { AskAtom } = await import("../components/AskAtom");
  render(<AskAtom report={REPORT} viewerRole="patient" open onOpenChange={() => {}} />);
  const input = await screen.findByTestId("ask-atom-input");
  fireEvent.change(input, { target: { value: question } });
  fireEvent.click(screen.getByTestId("ask-atom-send"));
}

describe("AskAtom — Knowledge sources used block (RAG mode)", () => {
  beforeEach(() => {
    RESPONSE = {
      success: true,
      message:
        "Dr. Colombo compares the stand test to easing off the brakes and pressing the accelerator [P1]. Your own measured ratios stay Not assessed for spectral values [P2].",
      citations: [],
      webCitations: [],
      grounding: { mode: "rag", chunks: 16, passages: 2, passageCitations: [P1, P2] },
    };
  });

  it("renders the sources block mapping [P1]/[P2] to their citations in order", async () => {
    await ask();
    const block = await screen.findByTestId("atom-passage-sources", {}, { timeout: 5000 });
    expect(block.textContent).toMatch(/Knowledge sources used/i);

    const first = screen.getByTestId("atom-passage-source-0").textContent ?? "";
    const second = screen.getByTestId("atom-passage-source-1").textContent ?? "";
    expect(first).toContain("[P1]");
    expect(first).toContain(P1);
    expect(second).toContain("[P2]");
    expect(second).toContain(P2);
  });

  it("shows title, year, section AND time range for a transcript passage", async () => {
    await ask();
    await screen.findByTestId("atom-passage-sources", {}, { timeout: 5000 });
    const first = screen.getByTestId("atom-passage-source-0").textContent ?? "";
    expect(first).toMatch(/Colombo P&S 04-09-2026 Clinical Consultation \(Transcript\)/);
    expect(first).toMatch(/\(2026\)/);                       // year
    expect(first).toMatch(/Stand Test — Brakes and Accelerator/); // section
    expect(first).toMatch(/00:21:04–00:24:39/);              // time range
  });

  it("shows a page locator when the passage has one", async () => {
    await ask();
    await screen.findByTestId("atom-passage-sources", {}, { timeout: 5000 });
    const second = screen.getByTestId("atom-passage-source-1").textContent ?? "";
    expect(second).toMatch(/Clinical Autonomic Dysfunction \(2019\), p\.212/);
  });

  it("shows the Full-text RAG indicator with the passage count", async () => {
    await ask();
    const d = await screen.findByTestId("atom-grounding-disclosure", {}, { timeout: 5000 });
    expect(d.getAttribute("data-grounding")).toBe("rag");
    expect(d.textContent).toMatch(/Full-text RAG/);
    expect(d.textContent).toMatch(/2 retrieved knowledge passages/);
  });

  it("labels the passages as reference material, distinct from the patient's own data", async () => {
    await ask();
    const block = await screen.findByTestId("atom-passage-sources", {}, { timeout: 5000 });
    expect(block.textContent).toMatch(/not your measurements/i);
    const d = screen.getByTestId("atom-grounding-disclosure");
    expect(d.textContent).toMatch(/report and any attached vendor report are labeled separately/i);
  });
});

describe("AskAtom — report-only mode keeps its honesty, shows no sources block", () => {
  beforeEach(() => {
    RESPONSE = {
      success: true,
      message: "Based on your report, your measured cardiovagal ratios are normal.",
      citations: [],
      webCitations: [],
      grounding: {
        mode: "report_only",
        chunks: 0,
        note: "No knowledge passage was relevant to this question; the answer is grounded in the report.",
      },
    };
  });

  it("renders NO Knowledge sources used block", async () => {
    await ask("What is my E/I ratio?");
    await screen.findByTestId("atom-grounding-disclosure", {}, { timeout: 5000 });
    expect(screen.queryByTestId("atom-passage-sources")).toBeNull();
    expect(screen.queryByTestId("atom-passage-source-0")).toBeNull();
  });

  it("shows the report-only disclosure, never the Full-text RAG claim", async () => {
    await ask("What is my E/I ratio?");
    const d = await screen.findByTestId("atom-grounding-disclosure", {}, { timeout: 5000 });
    expect(d.getAttribute("data-grounding")).toBe("report_only");
    expect(d.textContent).toMatch(/not retrieval-augmented \(RAG\) grounding/i);
    expect(d.textContent).not.toMatch(/Full-text RAG/);
  });

  it("also stays report-only when a corpus exists but yielded no relevant passage", async () => {
    RESPONSE = {
      ...RESPONSE,
      grounding: { mode: "report_only", chunks: 16, note: "No knowledge passage was relevant." },
    };
    await ask("explain sudomotor axon reflex testing");
    const d = await screen.findByTestId("atom-grounding-disclosure", {}, { timeout: 5000 });
    expect(d.getAttribute("data-grounding")).toBe("report_only");
    expect(screen.queryByTestId("atom-passage-sources")).toBeNull();
  });

  it("shows no RAG indicator when mode is rag but zero passages were used", async () => {
    RESPONSE = { ...RESPONSE, grounding: { mode: "rag", chunks: 16, passages: 0, passageCitations: [] } };
    await ask("something unrelated");
    // Wait for the answer to finish revealing, then assert neither UI appears.
    await waitFor(
      () => expect(document.body.textContent).toMatch(/measured cardiovagal ratios are normal/),
      { timeout: 5000 },
    );
    expect(screen.queryByTestId("atom-passage-sources")).toBeNull();
    expect(screen.queryByTestId("atom-grounding-disclosure")).toBeNull();
  });
});

describe("mobile readability at 390px", () => {
  beforeEach(() => {
    RESPONSE = {
      success: true,
      message: "Answer [P1].",
      citations: [], webCitations: [],
      grounding: { mode: "rag", chunks: 16, passages: 1, passageCitations: [P1] },
    };
  });

  it("wraps long citations instead of clipping them (full text present, no truncate)", async () => {
    await ask();
    await screen.findByTestId("atom-passage-sources", {}, { timeout: 5000 });
    const li = screen.getByTestId("atom-passage-source-0");
    // The whole citation — section title AND timecode — must be in the DOM.
    expect(li.textContent).toContain("Stand Test — Brakes and Accelerator — 00:21:04–00:24:39");
    const cls = li.className;
    expect(cls).toMatch(/break-words/);
    expect(cls).not.toMatch(/\btruncate\b/);
    expect(cls).not.toMatch(/whitespace-nowrap/);
    expect(cls).toMatch(/leading-snug/);
  });

  it("uses a list so citations stack vertically on a narrow viewport", async () => {
    await ask();
    await screen.findByTestId("atom-passage-sources", {}, { timeout: 5000 });
    const li = screen.getByTestId("atom-passage-source-0");
    expect(li.tagName).toBe("LI");
    expect(li.closest("ul")).toBeTruthy();
  });
});

describe("no raw ids, paths, or urls reach the panel", () => {
  it("normalizePassageCitations drops ids/paths/urls and keeps real citations", () => {
    const out = normalizePassageCitations([
      P1,
      "b90cf06b-3141-4ba2-86cc-a165565faed5",                      // bare uuid
      "Some Source (2020), chunk 3 [source_id: b90cf06b-3141-4ba2-86cc-a165565faed5]",
      "https://example.com/file.pdf",                              // url
      "/var/task/api/_ans/knowledgePassages.js",                    // path
      "chunk_id=abc123",                                            // id trace
      "   ",                                                        // blank
      42 as any,                                                    // non-string
      P2,
    ]);
    expect(out).toEqual([P1, P2]);
  });

  it("returns [] for a missing / malformed payload", () => {
    expect(normalizePassageCitations(undefined)).toEqual([]);
    expect(normalizePassageCitations(null)).toEqual([]);
    expect(normalizePassageCitations("nope" as any)).toEqual([]);
    expect(normalizePassageCitations({} as any)).toEqual([]);
  });

  it("bounds how many citations are rendered", () => {
    const many = Array.from({ length: 30 }, (_, i) => `Source ${i} (2020), chunk ${i}`);
    expect(normalizePassageCitations(many)).toHaveLength(8);
  });

  it("the rendered block contains no uuid, absolute path, or url", async () => {
    RESPONSE = {
      success: true,
      message: "Answer [P1].",
      citations: [], webCitations: [],
      grounding: {
        mode: "rag", chunks: 16, passages: 1,
        // Server should never send these, but the UI must not render them.
        passageCitations: [P1, "b90cf06b-3141-4ba2-86cc-a165565faed5", "/var/task/x.js"],
      },
    };
    await ask();
    const block = await screen.findByTestId("atom-passage-sources", {}, { timeout: 5000 });
    const txt = block.textContent ?? "";
    expect(txt).toContain("Stand Test");
    expect(txt).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(txt).not.toMatch(/\/var\/task/);
    expect(txt).not.toMatch(/https?:\/\//);
    // Only the one legitimate citation survived.
    expect(screen.queryByTestId("atom-passage-source-1")).toBeNull();
  });
});
