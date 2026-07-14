/**
 * Patient-tab render regression for the normal-RFa / low-SB case.
 *
 * The DiagnosisExplainer (patient view) must render the source-consistent
 * Relative Parasympathetic Dominance finding — NOT "Parasympathetic Excess" —
 * and must not assert unsupported daily-life symptoms or excess/intensity
 * framing. Complements the server-side rendered-report regression.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef(({ children, ...rest }: any, ref: any) => {
      const {
        initial, animate, exit, transition, whileHover, whileTap,
        whileInView, viewport, variants, layout, layoutId, drag, ...domProps
      } = rest;
      return React.createElement(tag, { ref, ...domProps }, children);
    });
  const motion = new Proxy({}, { get: (_t, key: string) => passthrough(typeof key === "string" ? key : "div") });
  return { motion, AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children), useReducedMotion: () => true };
});

function reportWith(codes: Array<{ code: string; name: string; severity: string; description: string }>): any {
  return { indications: codes };
}

describe("DiagnosisExplainer — Relative Parasympathetic Dominance (patient tab)", () => {
  it("renders RPD_REST and none of the banned excess/symptom strings", async () => {
    const { render, screen, cleanup } = await import("@testing-library/react");
    const { DiagnosisExplainer } = await import("../components/patient/DiagnosisExplainer");
    const report = reportWith([
      {
        code: "RPD_REST",
        name: "Relative Parasympathetic Dominance (reduced sympathetic modulation)",
        severity: "moderate",
        description:
          "Sympathovagal balance 0.18 (< 0.4) at rest: LFa 0.91 bpm² is low/low-normal, RFa 5.13 bpm² is within normal limits. The low ratio reflects reduced sympathetic modulation, not parasympathetic excess.",
      },
    ]);
    const { container } = render(<DiagnosisExplainer report={report} />);
    const text = container.textContent ?? "";

    // Source-consistent finding shown.
    expect(text).toMatch(/Relative Parasympathetic Dominance/i);
    // Banned: excess mislabel + symptom/intensity framing.
    expect(text).not.toMatch(/Parasympathetic Excess at Rest/i);
    expect(text).not.toMatch(/prolonged rest and digest/i);
    expect(text).not.toMatch(/low mood/i);
    expect(text).not.toMatch(/sluggish digestion/i);
    // Reframed section header makes clear these are not the patient's symptoms.
    expect(text).toMatch(/not your reported symptoms/i);
    cleanup();
  });
});
