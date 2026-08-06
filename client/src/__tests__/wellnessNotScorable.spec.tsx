/**
 * PATIENT-FACING "NOT SCORABLE" STATE — regression test.
 *
 * The Alex Pare audit's single most consequential finding was a patient-facing
 * "91 / Optimal — Strong autonomic function across all tests, no abnormal
 * patterns detected" produced from a recording whose ECG had failed the
 * usability gate and whose sympathovagal domain was unassessable (the vendor
 * clinician documented Advanced Autonomic Dysfunction on the same strip).
 *
 * The gauge must therefore render an explicit NOT SCORABLE state — no number, no
 * tier pill, no reassuring subtitle — whenever `wellnessScore` is null or
 * `wellnessBreakdown.scorability.scorable` is false.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ANSReport } from "@shared/schema";
import { WellnessMeter } from "../components/patient/WellnessMeter";

function notScorableReport(): ANSReport {
  return {
    patientData: {},
    phaseEvents: [],
    wellnessScore: null,
    wellnessTier: null,
    wellnessBreakdown: {
      baselineAutonomic: { score: null, weight: 0, contribution: 0, notes: [] },
      sympathovagalBalance: { score: null, weight: 0, contribution: 0, notes: [] },
      reflexIntegrity: { score: 88, weight: 0.23, contribution: 20.2, notes: [] },
      orthostaticResponse: { score: null, weight: 0, contribution: 0, notes: [] },
      hrvReserve: { score: null, weight: 0, contribution: 0, notes: [] },
      ageMultiplier: 1.03,
      rawTotal: null,
      ageAdjusted: null,
      final: null,
      scorability: {
        scorable: false,
        unavailableWeight: 0.77,
        missingDomains: ["Sympathovagal balance"],
        blockers: [
          {
            code: "ECG_UNUSABLE",
            message: "The ECG recording did not pass the signal-usability gate.",
            domains: ["all"],
          },
        ],
        notice:
          "Not scorable — a composite wellness score is withheld because essential inputs are missing or unusable.",
      },
    },
  } as unknown as ANSReport;
}

function scorableReport(): ANSReport {
  return {
    patientData: {},
    phaseEvents: [],
    wellnessScore: 82,
    wellnessTier: "Resilient",
    wellnessBreakdown: {
      baselineAutonomic: { score: 80, weight: 0.22, contribution: 17.6, notes: [] },
      sympathovagalBalance: { score: 78, weight: 0.2, contribution: 15.6, notes: [] },
      reflexIntegrity: { score: 88, weight: 0.23, contribution: 20.2, notes: [] },
      orthostaticResponse: { score: 85, weight: 0.2, contribution: 17, notes: [] },
      hrvReserve: { score: 76, weight: 0.15, contribution: 11.4, notes: [] },
      ageMultiplier: 1.03,
      rawTotal: 81.8,
      ageAdjusted: 84.3,
      final: 82,
      scorability: {
        scorable: true,
        unavailableWeight: 0,
        missingDomains: [],
        blockers: [],
        notice: "",
      },
    },
  } as unknown as ANSReport;
}

describe("WellnessMeter — not-scorable state", () => {
  it("renders an explicit Not scorable card with no number and no tier", () => {
    const { container } = render(<WellnessMeter report={notScorableReport()} />);
    expect(screen.getByTestId("wellness-not-scorable")).toBeTruthy();
    expect(screen.getByTestId("wellness-not-scorable-title").textContent).toBe("Not scorable");
    // The old gauge (and therefore any number/tier pill) must not be rendered.
    expect(container.querySelector('[data-testid="wellness-meter"]')).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\bOptimal\b/);
    expect(text).not.toMatch(/no abnormal patterns/i);
    expect(text).not.toMatch(/peak capacity/i);
    expect(text).not.toMatch(/out of 100/);
    expect(text).not.toMatch(/\b91\b/);
  });

  it("explains the blockers and separates observation from interpretation", () => {
    const { container } = render(<WellnessMeter report={notScorableReport()} />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/signal-usability gate/i);
    expect(text).toMatch(/observations/i);
    expect(text).toMatch(/not an assessment of/i);
  });

  it("still renders the normal gauge when the study IS scorable", () => {
    render(<WellnessMeter report={scorableReport()} />);
    expect(screen.getByTestId("wellness-meter")).toBeTruthy();
    expect(screen.queryByTestId("wellness-not-scorable")).toBeNull();
  });
});
