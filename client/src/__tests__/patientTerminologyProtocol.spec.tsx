/**
 * AUTHORIZED PhysioPS OUTPUT PROTOCOL — client rendering.
 *
 * Patient-facing views must not surface the HRV-specific parameters ULF, VLF,
 * LF, HF, TSP, sdNN, rmsSD, pNN50; clinician views MAY show instrument-derived
 * metrics for exact vendor parity.
 *
 * The gauge is the one patient surface that used to print "HRV · RMSSD",
 * "SDNN" and "LF / HF" directly. These tests pin both halves of the asymmetry
 * and confirm no measured value is altered — only what is shown to whom.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AutonomicBalanceGauge } from "../components/AutonomicBalanceGaugeFixed";
import {
  BANNED_PATIENT_HRV_TERMS,
  findBannedHrvTerms,
} from "@shared/physiopsTerminology";

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

const MEASURED = {
  sympathetic: 40,
  parasympathetic: 60,
  hrvRmssdMs: 45.2,
  hrvSdnnMs: 60.1,
  lfHfRatio: 1.2,
  available: true,
  balanceLabel: "Balanced",
};

describe("patient view (default audience)", () => {
  it("omits the HRV-specific rmsSD and sdNN readouts entirely", () => {
    render(<AutonomicBalanceGauge {...MEASURED} />);
    expect(screen.queryByTestId("abg-rmssd")).toBeNull();
    expect(screen.queryByTestId("abg-sdnn")).toBeNull();
  });

  it("labels the balance readout in P&S terms, not as LF / HF", () => {
    render(<AutonomicBalanceGauge {...MEASURED} />);
    const balance = screen.getByTestId("abg-lfhf");
    expect(balance).toBeTruthy();
    expect(document.body.textContent ?? "").toContain("SB · LFa/RFa");
    expect(document.body.textContent ?? "").not.toContain("LF / HF");
  });

  it("still shows the authorized P&S percentages (nothing clinical is removed)", () => {
    render(<AutonomicBalanceGauge {...MEASURED} />);
    expect(screen.getByTestId("abg-symp").textContent).toContain("40");
    expect(screen.getByTestId("abg-parasym").textContent).toContain("60");
    // The sympathovagal balance VALUE is unchanged — only its label is P&S.
    expect(screen.getByTestId("abg-lfhf").textContent).toContain("1.2");
  });

  it("renders no banned HRV parameter anywhere in the patient DOM", () => {
    render(<AutonomicBalanceGauge {...MEASURED} />);
    const text = document.body.textContent ?? "";
    expect(findBannedHrvTerms(text)).toEqual([]);
    for (const term of ["RMSSD", "SDNN", "pNN50", "TSP", "ULF", "VLF"]) {
      expect(text).not.toContain(term);
    }
  });

  it("is fail-safe: an explicit audience=\"patient\" behaves identically to the default", () => {
    const { unmount } = render(<AutonomicBalanceGauge {...MEASURED} audience="patient" />);
    expect(screen.queryByTestId("abg-sdnn")).toBeNull();
    unmount();
  });

  it("keeps the consolidated not-assessed state when spectral data is missing", () => {
    render(
      <AutonomicBalanceGauge
        {...MEASURED}
        sympathetic={null}
        parasympathetic={null}
        lfHfRatio={null}
        available={false}
        balanceLabel="Not assessed"
      />,
    );
    expect(screen.getByTestId("abg-not-assessed")).toBeTruthy();
    expect(screen.queryByTestId("abg-rmssd")).toBeNull();
  });
});

describe("clinician view (vendor parity)", () => {
  it("shows the instrument-derived rmsSD and sdNN readouts exactly as measured", () => {
    render(<AutonomicBalanceGauge {...MEASURED} audience="clinician" />);
    expect(screen.getByTestId("abg-rmssd").textContent).toContain("45.2");
    expect(screen.getByTestId("abg-sdnn").textContent).toContain("60.1");
    expect(document.body.textContent ?? "").toContain("LF / HF");
  });

  it("does not alter the values the patient view also shows", () => {
    render(<AutonomicBalanceGauge {...MEASURED} audience="clinician" />);
    expect(screen.getByTestId("abg-symp").textContent).toContain("40");
    expect(screen.getByTestId("abg-lfhf").textContent).toContain("1.2");
  });
});

describe("shared ban list is the single source of truth for both layers", () => {
  it("the client imports the same protocol list the server enforces", () => {
    expect([...BANNED_PATIENT_HRV_TERMS]).toEqual([
      "ULF", "VLF", "LF", "HF", "TSP", "sdNN", "rmsSD", "pNN50",
    ]);
  });
});
