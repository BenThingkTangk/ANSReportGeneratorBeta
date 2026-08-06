/**
 * AUTHORIZED PhysioPS OUTPUT PROTOCOL — terminology enforcement tests.
 *
 * Patient-facing output must not surface the HRV-specific parameters
 * ULF, VLF, LF, HF, TSP, sdNN, rmsSD, pNN50, and must explain results in
 * PhysioPS P&S terminology. Clinician views are exempt (vendor parity).
 *
 * These tests pin BOTH directions:
 *   • banned parameters are detected and relabelled, including composites and
 *     vendor spelling variants, and
 *   • legitimate P&S vocabulary (LFa, RFa) and ordinary English are NOT damaged
 *     — a false positive here would corrupt clinically correct copy.
 *
 * Pure unit tests. No clinical value, threshold, or diagnosis is produced here.
 */
import { describe, it, expect } from "vitest";
import {
  BANNED_PATIENT_HRV_TERMS,
  AUTHORIZED_PATIENT_PS_TERMS,
  findBannedHrvTerms,
  isPatientSafeTerminology,
  sanitizePatientTerminology,
  assertPatientSafeTerminology,
  PATIENT_TERMINOLOGY_PROMPT,
  CLINICIAN_TERMINOLOGY_PROMPT,
} from "../../../shared/physiopsTerminology.js";
import { sanitizePatientAnswer } from "../../ask-atom.js";

describe("banned list matches the authorized protocol exactly", () => {
  it("contains the eight specified parameters, in order", () => {
    expect([...BANNED_PATIENT_HRV_TERMS]).toEqual([
      "ULF",
      "VLF",
      "LF",
      "HF",
      "TSP",
      "sdNN",
      "rmsSD",
      "pNN50",
    ]);
  });

  it("offers P&S replacements rather than only prohibitions", () => {
    expect([...AUTHORIZED_PATIENT_PS_TERMS]).toContain("LFa");
    expect([...AUTHORIZED_PATIENT_PS_TERMS]).toContain("RFa");
    expect([...AUTHORIZED_PATIENT_PS_TERMS]).toContain("sympathovagal balance");
  });
});

describe("findBannedHrvTerms", () => {
  it("detects each banned parameter on its own", () => {
    expect(findBannedHrvTerms("Your ULF power was low.")).toEqual(["ULF"]);
    expect(findBannedHrvTerms("VLF band")).toEqual(["VLF"]);
    expect(findBannedHrvTerms("LF power rose")).toEqual(["LF"]);
    expect(findBannedHrvTerms("HF power fell")).toEqual(["HF"]);
    expect(findBannedHrvTerms("TSP 1200")).toEqual(["TSP"]);
    expect(findBannedHrvTerms("SDNN 42 ms")).toEqual(["sdNN"]);
    expect(findBannedHrvTerms("RMSSD 21 ms")).toEqual(["rmsSD"]);
    expect(findBannedHrvTerms("pNN50 was 8%")).toEqual(["pNN50"]);
  });

  it("detects vendor / literature spelling variants", () => {
    expect(findBannedHrvTerms("rms-SD")).toEqual(["rmsSD"]);
    expect(findBannedHrvTerms("sd NN")).toEqual(["sdNN"]);
    expect(findBannedHrvTerms("pNN-50")).toEqual(["pNN50"]);
    expect(findBannedHrvTerms("total spectral power")).toEqual(["TSP"]);
    expect(findBannedHrvTerms("high-frequency power")).toEqual(["HF"]);
    expect(findBannedHrvTerms("ultra low-frequency band")).toEqual(["ULF"]);
  });

  it("detects the LF/HF composite as a single, most-specific occurrence", () => {
    // The composite rule is tried before the bare band tokens and its match is
    // masked out, so one "LF/HF" is attributed once (to LF) rather than being
    // double-counted as LF + HF. What matters is that it is flagged at all.
    expect(findBannedHrvTerms("LF/HF ratio was 3.1")).toEqual(["LF"]);
    expect(findBannedHrvTerms("LF:HF")).toEqual(["LF"]);
    expect(findBannedHrvTerms("LF to HF balance")).toEqual(["LF"]);
    for (const t of ["LF/HF ratio was 3.1", "LF:HF", "LF to HF balance"]) {
      expect(isPatientSafeTerminology(t)).toBe(false);
    }
  });

  it("still reports HF separately when it appears outside the composite", () => {
    expect(findBannedHrvTerms("LF/HF ratio was 3.1 and HF power was low")).toEqual(["LF", "HF"]);
  });

  it("reports every distinct hit, de-duplicated and in protocol order", () => {
    const hits = findBannedHrvTerms("RMSSD 20 ms, SDNN 40 ms, and SDNN again, plus VLF.");
    expect(hits).toEqual(["VLF", "sdNN", "rmsSD"]);
  });

  it("returns [] for null/undefined/empty input", () => {
    expect(findBannedHrvTerms(null)).toEqual([]);
    expect(findBannedHrvTerms(undefined)).toEqual([]);
    expect(findBannedHrvTerms("")).toEqual([]);
  });
});

describe("no false positives on authorized PhysioPS vocabulary", () => {
  const safe = [
    "Your LFa (sympathetic activity) was 1.2 bpm² at rest.",
    "RFa reflects parasympathetic activity and rose during deep breathing.",
    "LFa/RFa is the sympathovagal balance the PhysioPS method reports.",
    "Sympathetic activity was elevated relative to parasympathetic activity.",
    "Half of the challenge responses were normal; the self-report agreed.",
    "The stand challenge showed an appropriate LFa increase.",
    "HRa was not part of this assessment.",
  ];

  for (const text of safe) {
    it(`leaves authorized copy untouched: "${text.slice(0, 42)}…"`, () => {
      expect(findBannedHrvTerms(text)).toEqual([]);
      expect(isPatientSafeTerminology(text)).toBe(true);
      expect(sanitizePatientTerminology(text)).toBe(text);
    });
  }
});

describe("sanitizePatientTerminology", () => {
  it("relabels the LF/HF ratio as sympathovagal balance in P&S terms", () => {
    const out = sanitizePatientTerminology("Your LF/HF ratio was 3.1, which is high.");
    expect(out).toContain("sympathovagal balance (LFa/RFa)");
    expect(findBannedHrvTerms(out)).toEqual([]);
  });

  it("strips the number and unit attached to a banned parameter", () => {
    const out = sanitizePatientTerminology("SDNN 42 ms and RMSSD 21 ms were measured.");
    expect(out).not.toMatch(/42|21/);
    expect(findBannedHrvTerms(out)).toEqual([]);
  });

  it("removes orphaned spectral units (ms^2 / ms²)", () => {
    expect(isPatientSafeTerminology("power of 1200 ms^2")).toBe(false);
    const out = sanitizePatientTerminology("power of 1200 ms²");
    expect(out).not.toContain("ms²");
  });

  it("never fabricates a value, range, or diagnosis", () => {
    const out = sanitizePatientTerminology("Your SDNN was 42 ms.");
    // No new numbers, no normal range, no condition name introduced.
    expect(out.match(/\d/)).toBeNull();
    expect(out).not.toMatch(/normal range|reference range|diagnos/i);
  });

  it("is idempotent — sanitizing twice changes nothing further", () => {
    const once = sanitizePatientTerminology("LF/HF was 3.1 with SDNN 42 ms and pNN50 8%.");
    expect(sanitizePatientTerminology(once)).toBe(once);
    expect(findBannedHrvTerms(once)).toEqual([]);
  });

  it("preserves markdown line structure (tables and lists survive)", () => {
    const md = [
      "| Phase | RMSSD |",
      "| --- | --- |",
      "| Baseline | 21 ms |",
      "",
      "- LFa rose on stand",
    ].join("\n");
    const out = sanitizePatientTerminology(md);
    expect(out.split("\n").length).toBe(md.split("\n").length);
    expect(out).toContain("- LFa rose on stand");
    expect(findBannedHrvTerms(out)).toEqual([]);
  });

  it("returns '' for empty input", () => {
    expect(sanitizePatientTerminology(null)).toBe("");
    expect(sanitizePatientTerminology(undefined)).toBe("");
  });
});

describe("assertPatientSafeTerminology", () => {
  it("throws, naming the offending parameters and the P&S alternative", () => {
    expect(() => assertPatientSafeTerminology("Your SDNN was low.", "patient synopsis")).toThrow(
      /patient synopsis/,
    );
    expect(() => assertPatientSafeTerminology("Your SDNN was low.")).toThrow(/sdNN/);
    expect(() => assertPatientSafeTerminology("Your SDNN was low.")).toThrow(/LFa/);
  });

  it("passes silently for P&S copy", () => {
    expect(() =>
      assertPatientSafeTerminology("Your sympathovagal balance (LFa/RFa) was elevated at rest."),
    ).not.toThrow();
  });
});

describe("prompt blocks", () => {
  it("the patient prompt bans every parameter by name and prescribes P&S wording", () => {
    for (const term of BANNED_PATIENT_HRV_TERMS) {
      expect(PATIENT_TERMINOLOGY_PROMPT).toContain(term);
    }
    expect(PATIENT_TERMINOLOGY_PROMPT).toMatch(/LFa/);
    expect(PATIENT_TERMINOLOGY_PROMPT).toMatch(/RFa/);
  });

  it("the clinician prompt permits instrument metrics for vendor parity", () => {
    expect(CLINICIAN_TERMINOLOGY_PROMPT).toMatch(/parity|clinician/i);
  });
});

describe("ask-atom patient answer gate", () => {
  it("sanitizes terminology and strips internal citation markers together", () => {
    const out = sanitizePatientAnswer("Your LF/HF was 3.1 with SDNN 42 ms.");
    expect(findBannedHrvTerms(out)).toEqual([]);
    expect(out).toContain("sympathovagal balance");
  });

  it("is safe on empty input", () => {
    expect(sanitizePatientAnswer("")).toBe("");
  });
});
