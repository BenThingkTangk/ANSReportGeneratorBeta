import { describe, expect, it, vi } from "vitest";

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
  const motion = new Proxy({}, {
    get: (_target, key: string) => passthrough(typeof key === "string" ? key : "div"),
  });
  return {
    motion,
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
    useReducedMotion: () => true,
  };
});

describe("patient language for an unscorable study", () => {
  it("does not turn an empty indication list into an overall normality claim", async () => {
    const { render, cleanup } = await import("@testing-library/react");
    const { DiagnosisExplainer } = await import("../components/patient/DiagnosisExplainer");
    const { container } = render(
      <DiagnosisExplainer
        report={{
          indications: [],
          wellnessScore: null,
          wellnessBreakdown: { scorability: { scorable: false } },
        } as any}
      />,
    );

    const text = container.textContent ?? "";
    expect(text).toMatch(/No additional deterministic pattern was established/i);
    expect(text).toMatch(/Not assessed/i);
    expect(text).not.toMatch(/Measured signals are within normal ranges/i);
    cleanup();
  });

  it("labels a non-adverse body-system value as observation-only when unscorable", async () => {
    const { render, cleanup } = await import("@testing-library/react");
    const { BodyHeatmap } = await import("../components/patient/BodyHeatmap");
    const { container } = render(
      <BodyHeatmap
        scorable={false}
        bodySystemImpact={[
          {
            system: "cardiovascular",
            impact: 0,
            assessed: true,
            findings: [],
          },
        ] as any}
      />,
    );

    const text = container.textContent ?? "";
    expect(text).toMatch(/Observation only/i);
    expect(text).not.toMatch(/No signal detected/i);
    cleanup();
  });

  it("does not imply that an unscorable study cleared lifestyle interventions", async () => {
    const { render, cleanup } = await import("@testing-library/react");
    const { TreatmentsPanel } = await import("../components/patient/TreatmentsPanel");
    const { container } = render(
      <TreatmentsPanel recommendations={[]} notScorable />,
    );

    const text = container.textContent ?? "";
    expect(text).toMatch(/No automated intervention recommendation/i);
    expect(text).toMatch(/incomplete study/i);
    expect(text).toMatch(/clinician/i);
    expect(text).not.toMatch(/No specific lifestyle interventions flagged/i);
    cleanup();
  });
});
