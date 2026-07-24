/**
 * Mobile (390x844) layout regression — the live-QA defects:
 *   - header touch controls must be >=44px (were 32-36px)
 *   - the brand must not truncate to "P…" (full short label on phones)
 *   - the nervous-system balance "Not assessed" state must be a SINGLE
 *     consolidated label, not three overlapping strings
 *
 * jsdom has no layout engine, so we assert the invariants structurally (classes
 * / single-node presence) rather than pixel geometry; the pixel checks are done
 * by qa/visual-acceptance against a real browser.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeToggle } from "../components/ThemeToggle";
import { ViewToggle } from "../components/ViewToggle";
import { AutonomicBalanceGauge } from "../components/AutonomicBalanceGaugeFixed";

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = (tag: string) =>
    React.forwardRef(({ children, ...rest }: any, ref: any) => {
      const { initial, animate, exit, transition, whileHover, whileTap, whileInView,
        viewport, variants, layout, layoutId, drag, ...dom } = rest;
      return React.createElement(tag, { ref, ...dom }, children);
    });
  return {
    motion: new Proxy({}, { get: (_t, k: string) => passthrough(typeof k === "string" ? k : "div") }),
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
    useReducedMotion: () => true,
  };
});

describe("header touch targets are >=44px", () => {
  it("ThemeToggle uses min-w-11/min-h-11 (44px)", () => {
    render(<ThemeToggle />);
    const btn = screen.getByTestId("theme-toggle");
    expect(btn.className).toMatch(/min-w-11/);
    expect(btn.className).toMatch(/min-h-11/);
    expect(btn.className).not.toMatch(/\bw-9\b|\bh-9\b/);
  });
  it("ViewToggle buttons use min-h-11 (44px)", () => {
    render(<ViewToggle role="patient" onChange={() => {}} />);
    const patient = screen.getByTestId("toggle-patient");
    expect(patient.className).toMatch(/min-h-11/);
    expect(patient.className).not.toMatch(/py-1\.5/);
  });
});

describe("autonomic balance gauge — not-assessed shows ONE consolidated label", () => {
  it("renders a single not-assessed node, not three overlapping % slots", () => {
    render(
      <AutonomicBalanceGauge
        sympathetic={null}
        parasympathetic={null}
        hrvRmssdMs={135.8}
        hrvSdnnMs={88.3}
        lfHfRatio={null}
        available={false}
        balanceLabel={"Not assessed"}
      />,
    );
    // Exactly one consolidated not-assessed overlay…
    expect(screen.getByTestId("abg-not-assessed")).toBeTruthy();
    // …and NOT the three separate symp/parasym % slots that used to collide.
    expect(screen.queryByTestId("abg-symp")).toBeNull();
    expect(screen.queryByTestId("abg-parasym")).toBeNull();
    expect(screen.getByTestId("abg-not-assessed").textContent).toMatch(/Not assessed/);
  });

  it("renders the three-way split only when the balance IS assessed", () => {
    render(
      <AutonomicBalanceGauge
        sympathetic={40}
        parasympathetic={60}
        hrvRmssdMs={45}
        hrvSdnnMs={50}
        lfHfRatio={1.2}
        available={true}
        balanceLabel={"Balanced"}
      />,
    );
    expect(screen.queryByTestId("abg-not-assessed")).toBeNull();
    expect(screen.getByTestId("abg-symp")).toBeTruthy();
    expect(screen.getByTestId("abg-parasym")).toBeTruthy();
  });
});
