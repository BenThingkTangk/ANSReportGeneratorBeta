/**
 * QA merge-blocker client regressions (manual Playwright QA of commit 904d70c).
 *
 * Covers the render/print-layer contract that unit tests can assert without a
 * real print engine:
 *   #1 NumericalSummary + PhaseEventTable render null spectral/HR as em dash "—"
 *      / "unavailable", never a fabricated 0 / 0.00.
 *   #5 BuildInfo suppresses itself when build metadata is unknown ("dev"), so an
 *      export never shows a "build unknown"/"build dev" footer.
 *   #5 The print stylesheet hides interactive chrome (buttons, [role=button],
 *      .no-print) and keeps charts/tables from clipping.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef(({ children, ...rest }: any, ref: any) => {
      const { initial, animate, exit, transition, whileHover, whileTap, whileInView, viewport, variants, layout, layoutId, drag, ...dom } = rest;
      return React.createElement(tag, { ref, ...dom }, children);
    });
  const motion = new Proxy({}, { get: (_t, k: string) => passthrough(typeof k === "string" ? k : "div") });
  return { motion, AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children), useReducedMotion: () => true };
});

// Build a minimal phaseEvents array with NULL spectral + null HR (the raw-ECG /
// insufficient-beat state) to prove the tables never coerce to 0.
function phase(key: string, opts: Partial<any> = {}): any {
  return {
    phase: key, label: key, duration: "01:00", durationSec: 60,
    meanHR: null, rangeHR: null, FRF: null, LFa: null, RFa: null, SB: null,
    HRV_SDNN: null, HRV_RMSSD: null,
    provenance: { LFa: { method: "unavailable" }, RFa: { method: "unavailable" }, SB: { method: "unavailable" }, FRF: { method: "unavailable" } },
    ...opts,
  };
}

const baseReport: any = {
  phaseEvents: [
    phase("Baseline-A"), phase("DeepBreathing-B"), phase("Baseline-C"),
    phase("Valsalva-D"), phase("Baseline-E"), phase("Stand-F"),
  ],
  ratios: {
    eiRatio: { value: 1.21, normal: "≥1.09" },
    valsalvaRatio: { value: 1.43, normal: "≥1.2" },
    thirtyFifteenRatio: { value: 1.4, normal: "≥1.09" },
  },
  autonomicBalance: { balance: null },
  rPeakCount: 0,
  samplingRate: 250,
  respiratoryFrequency: null,
};

describe("QA #1 — tables render missing spectral/HR as em dash, never 0.00", () => {
  it("NumericalSummary shows 'unavailable' for spectral and '—' for null HR", async () => {
    const { render, cleanup } = await import("@testing-library/react");
    const { NumericalSummary } = await import("../components/clinician/mpg/NumericalSummary");
    const { container } = render(<NumericalSummary report={baseReport} />);
    const text = container.textContent || "";
    expect(text).toContain("unavailable");
    // No fabricated zero spectral cells.
    expect(text).not.toMatch(/0\.00/);
    // HR mean±range cell must be an em dash, not "0 ± 0".
    expect(text).not.toMatch(/0 ± 0/);
    cleanup();
  });

  it("PhaseEventTable shows '—' for null spectral and null HR", async () => {
    const { render, cleanup } = await import("@testing-library/react");
    const { PhaseEventTable } = await import("../components/clinician/PhaseEventTable");
    const { container } = render(<PhaseEventTable phaseEvents={baseReport.phaseEvents} />);
    const text = container.textContent || "";
    expect(text).toContain("—");
    expect(text).not.toMatch(/0\.00/);
    expect(text).not.toMatch(/0 ± 0/);
    cleanup();
  });
});

describe("QA #5 — BuildInfo suppressed when build metadata unknown", () => {
  it("renders nothing when the client build sha is 'dev'/unknown", async () => {
    // __BUILD_COMMIT_SHORT__ is undefined in the test env → clientSha = "dev".
    const { render, cleanup } = await import("@testing-library/react");
    const { BuildInfo } = await import("../components/BuildInfo");
    const { container } = render(<BuildInfo />);
    expect(container.textContent || "").toBe("");
    expect(container.querySelector("*")).toBeNull();
    cleanup();
  });
});

describe("QA #5 — print stylesheet hides interactive chrome + prevents clipping", () => {
  let css: string;
  beforeAll(() => {
    css = readFileSync(path.resolve(__dirname, "../index.css"), "utf8");
  });

  it("has an @media print block", () => {
    expect(css).toMatch(/@media\s+print\s*\{/);
  });

  it("hides .no-print and interactive buttons in print", () => {
    const printBlock = css.slice(css.indexOf("@media print"));
    expect(printBlock).toMatch(/\.no-print\s*\{\s*display:\s*none/);
    expect(printBlock).toMatch(/button:not\(\.print-keep\)/);
    expect(printBlock).toMatch(/\[role="button"\]:not\(\.print-keep\)/);
  });

  it("prevents charts/tables from clipping across page breaks", () => {
    const printBlock = css.slice(css.indexOf("@media print"));
    expect(printBlock).toMatch(/break-inside:\s*avoid/);
    expect(printBlock).toMatch(/recharts-responsive-container/);
    expect(printBlock).toMatch(/overflow:\s*visible/);
  });
});
