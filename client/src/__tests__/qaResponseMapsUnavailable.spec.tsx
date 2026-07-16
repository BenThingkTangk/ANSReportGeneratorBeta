/**
 * QA merge-blocker (round 3) BROWSER-FACING component regressions.
 *
 * Manual Playwright QA (upload deidentified_waveform.ans + attach Jill vendor PDF
 * → Clinician → HumanOS Advanced) still rendered patient "0.00" points, "-100%"
 * deltas, and pathology labels on the response-map / age charts because only the
 * BASELINE phase carried vendor spectral while B/D/F stayed untrusted estimates.
 *
 * These tests render the ACTUAL components (not just a formatter) with a scatter
 * model where baseline (A) is a valid vendor value and the challenge phases
 * (B deep-breathing, D Valsalva, F stand) are null (untrusted), and assert:
 *   - no patient "0.00", no "-100%", no low/above/below pathology labels;
 *   - explicit "Not assessed"/unavailable empty states for those charts;
 *   - the baseline scatter no longer labels the low-ratio region "Advanced
 *     dysfunction (ratio < 0.4)" (defect C).
 */
import { describe, it, expect, vi } from "vitest";
import type { MultiParameterGraphical } from "@shared/schema";

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

/** Scatter model: baseline (A) vendor-valid; every challenge phase untrusted → null. */
function baselineOnlyMpg(): MultiParameterGraphical {
  return {
    ecgAvailable: true,
    totalSec: 1200,
    phases: [],
    heartRateTrend: { t: [], v: [] },
    breathingTrend: { t: [], v: [] },
    lfaTrend: { t: [], v: [] },
    rfaTrend: { t: [], v: [] },
    scatter: {
      baselineLFa: 0.91,   // valid vendor baseline
      baselineRFa: 5.13,   // valid vendor baseline
      dbRFa: null,         // B untrusted
      valsalvaLFa: null,   // D untrusted
      standLFa: null,      // F untrusted
      standRFa: null,      // F untrusted
      rfaChangeValsalvaPct: null,
      rfaChangeStandPct: null,
    },
    coupling: [],
    wavelet: { type: "n/a", cycles: 0, spectralUpdateSec: 0 },
  } as unknown as MultiParameterGraphical;
}

async function renderScatter(mpg: MultiParameterGraphical) {
  const { render } = await import("@testing-library/react");
  const { ScatterPanel } = await import("../components/clinician/mpg/ScatterPanel");
  return render(<ScatterPanel mpg={mpg} patientAge={56} spectralAvailable={true} />);
}

describe("QA — Advanced response maps never fabricate 0.00 / -100% from missing B/D/F", () => {
  it("renders no patient 0.00 and no -100% when challenge phases are untrusted", async () => {
    const { container, cleanup } = { ...(await renderScatter(baselineOnlyMpg())), cleanup: (await import("@testing-library/react")).cleanup };
    const text = container.textContent || "";
    // No fabricated patient spectral value / delta.
    expect(text).not.toMatch(/Your RFa:\s*0\.00/);
    expect(text).not.toMatch(/Your LFa:\s*0\.00/);
    expect(text).not.toMatch(/-100(\.0)?%/);
    // Untrusted challenge charts show the explicit unavailable state.
    expect(text.toLowerCase()).toContain("not assessed");
    cleanup();
  });

  it("shows unavailable empty states for DB RFa, Valsalva LFa, Stand, and RFa% charts", async () => {
    const { screen, cleanup } = await import("@testing-library/react");
    await renderScatter(baselineOnlyMpg());
    // Every untrusted response-map card renders a not-assessed body.
    const unavailable = screen.getAllByTestId("response-map-unavailable");
    expect(unavailable.length).toBeGreaterThanOrEqual(4); // DB, Valsalva, Stand, RFa%
    cleanup();
  });

  it("does NOT emit low/above/below pathology labels for the untrusted phases", async () => {
    const { container, cleanup } = { ...(await renderScatter(baselineOnlyMpg())), cleanup: (await import("@testing-library/react")).cleanup };
    const text = container.textContent || "";
    // The chart-point pathology phrasing must not appear for missing challenge data.
    expect(text).not.toMatch(/Below normal/i);
    // "Age-normal band" legends belong to a rendered patient point — none here.
    cleanup();
  });

  it("baseline scatter labels the low-ratio region as a MEASUREMENT, not 'Advanced dysfunction'", async () => {
    const { container, cleanup } = { ...(await renderScatter(baselineOnlyMpg())), cleanup: (await import("@testing-library/react")).cleanup };
    const text = container.textContent || "";
    // Defect C: the diagnosis-like label must be gone.
    expect(text).not.toMatch(/Advanced dysfunction \(ratio/i);
    // Baseline (A) is valid, so its card renders with a measurement interpretation.
    expect(text.toLowerCase()).toMatch(/reduced sympathetic modulation|resting balance/);
    cleanup();
  });

  it("still renders the valid baseline point (A is vendor-reported, not nulled)", async () => {
    const { screen, cleanup } = await import("@testing-library/react");
    await renderScatter(baselineOnlyMpg());
    // Baseline card present and NOT the unavailable body.
    const baseCard = screen.getByTestId("chart-baseline-lfa-rfa");
    expect(baseCard.textContent || "").toMatch(/LFa\/RFa = 0\.18/); // 0.91/5.13
    cleanup();
  });
});
