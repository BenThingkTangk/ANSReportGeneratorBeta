/**
 * Vendor narrative extractor — categorical findings + prose-printed numbers.
 *
 * Uses de-identified prose snippets that mirror the two real Pare documents
 * (Diagnostic Implication Summary and the Colombo letter). Asserts we extract
 * ONLY printed content: categorical findings verbatim, and a number ONLY when
 * the vendor actually printed one (SB = 2.59). Never guesses; generalizes
 * beyond one patient (no name/date keying).
 */
import { describe, it, expect } from "vitest";
import { extractVendorNarrative } from "../vendorNarrative.js";

// De-identified copy of the OCR'd Diagnostic Implication Summary (page 2 prose).
const SUMMARY = `
Patient: Faux, John  Test Date: 7/11/2024  Physician: Colombo
Gender: Male  DOB: 1/1/1975  Age: 48  Height: 6 ft 2 in  Weight: 200 lbs  BMI: 25.68
No. of Ectopic Beats: 1
INITIAL BASELINE: At rest, Patient presents with:
- Normal HR and Normal BP
- Normal sympathetic modulation (LFa)
- Borderline low parasympathetic modulation (RFa)
- High Normal sympathovagal balance (SB = LFa/RFa) suggesting a properly balanced combination
DEEP BREATHING (DB) AND VALSALVA RESPONSES:
- All ANS responses within normal ranges (includes borderline conditions)
- Abnormal changes in HR (from baseline to DB)
STAND RESPONSES: On standing, Patient presents with:
- High sympathetic response to stand suggesting a possible risk of pre-syncope
`;

// De-identified copy of the Colombo letter prose (the numeric SB lives here).
const LETTER = `
RE: John Faux, dob 1/1/1975
At rest John demonstrates normal HR & BP, low Parasympathetic activity indicating Advanced
Autonomic Dysfunction (AAD), normal Sympathetic activity, and high-normal Sympathovagal
Balance (SB = 2.59), indicating high-morbidity risk. His breathing responses are normal. Upon
standing, he demonstrates Sympathetic Excess (SE), indicating a (pre-clinical) Syncope risk.
His Standing BP was not recorded.
`;

describe("extractVendorNarrative — Diagnostic Implication Summary (categorical)", () => {
  const x = extractVendorNarrative(SUMMARY);
  const by = (k: string) => x.findings.find((f) => f.key === k);

  it("looks like a vendor narrative", () => {
    expect(x.looksLikeVendorNarrative).toBe(true);
  });
  it("classifies baseline modulation verbatim", () => {
    expect(by("baseline.lfa")?.classification).toBe("normal");
    expect(by("baseline.rfa")?.classification).toBe("borderline-low");
    expect(by("baseline.sb")?.classification).toBe("high-normal");
  });
  it("captures HR/BP normal + DB HR abnormal + stand high sympathetic + pre-syncope", () => {
    expect(by("baseline.hr")?.classification).toBe("normal");
    expect(by("baseline.bp")?.classification).toBe("normal");
    expect(by("db.hr_change")?.classification).toBe("abnormal");
    expect(by("stand.sympathetic")?.classification).toBe("high");
    expect(by("stand.presyncope")).toBeTruthy();
  });
  it("prints NO fabricated numbers (summary carries no numeric spectral grid)", () => {
    // Crucially, "sympathetic modulation (LFa)" must NOT yield an LFa number.
    expect(x.printedNumbers.find((n) => n.key === "LFa")).toBeUndefined();
    expect(x.printedNumbers.find((n) => n.key === "RFa")).toBeUndefined();
  });
});

describe("extractVendorNarrative — Colombo letter (prose number)", () => {
  const x = extractVendorNarrative(LETTER);
  it("extracts the printed SB = 2.59 verbatim", () => {
    const sb = x.printedNumbers.find((n) => n.key === "SB");
    expect(sb?.value).toBeCloseTo(2.59, 2);
    expect(sb?.sourceText).toMatch(/2\.59/);
  });
  it("does not invent LFa/RFa numbers from surrounding prose", () => {
    expect(x.printedNumbers.some((n) => n.key === "LFa" || n.key === "RFa")).toBe(false);
  });
});

describe("extractVendorNarrative — safety / generalization", () => {
  it("returns nothing for unrelated text (no false vendor detection)", () => {
    const x = extractVendorNarrative("This is an unrelated invoice. Total: 200 dollars.");
    expect(x.looksLikeVendorNarrative).toBe(false);
    expect(x.findings).toEqual([]);
    expect(x.printedNumbers).toEqual([]);
  });
  it("is not keyed to any patient (same findings with a different name)", () => {
    const other = LETTER.replace(/John Faux/g, "Mary Roe").replace(/John /g, "Mary ");
    const a = extractVendorNarrative(LETTER);
    const b = extractVendorNarrative(other);
    expect(b.printedNumbers).toEqual(a.printedNumbers);
    expect(b.findings.map((f) => f.key).sort()).toEqual(a.findings.map((f) => f.key).sort());
  });
});
