/**
 * Defect B regression — OCR test-date normalization + cross-check.
 *
 * The live Vendor-Familiar view showed Test Date 8/26/2025 while the source PDF
 * clearly prints 9/26/2025 (an OCR digit error). The fix: normalize the OCR date,
 * and cross-check it against the authoritative .ans date — preferring the .ans
 * date for display, preserving the raw OCR value, and surfacing (never silently
 * resolving) a conflict.
 */
import { describe, it, expect } from "vitest";
import { normalizeUsDate, crossCheckTestDate } from "../../../shared/vendorExtraction.js";
import { parseVendorOcrPages, textToPages } from "../vendorOcrParse.js";

describe("normalizeUsDate", () => {
  it("canonicalizes spacing and separators", () => {
    expect(normalizeUsDate("9/26/2025")).toBe("9/26/2025");
    expect(normalizeUsDate(" 8 / 26 / 2025 ")).toBe("8/26/2025");
    expect(normalizeUsDate("08-26-2025")).toBe("8/26/2025");
  });
  it("expands two-digit years to 2000s", () => {
    expect(normalizeUsDate("9/26/25")).toBe("9/26/2025");
  });
  it("rejects impossible / non-dates", () => {
    expect(normalizeUsDate("13/40/2025")).toBeNull();
    expect(normalizeUsDate("not a date")).toBeNull();
    expect(normalizeUsDate(null)).toBeNull();
  });
});

describe("crossCheckTestDate", () => {
  it("prefers the trusted .ans date, preserves OCR, flags the conflict", () => {
    const cc = crossCheckTestDate("8/26/2025", "9/26/2025");
    expect(cc.display).toBe("9/26/2025");
    expect(cc.ocr).toBe("8/26/2025");
    expect(cc.trusted).toBe("9/26/2025");
    expect(cc.conflict).toBe(true);
    expect(cc.source).toBe("trusted");
    expect(cc.note).toMatch(/8\/26\/2025.*conflicts.*9\/26\/2025/i);
  });
  it("no conflict when they agree", () => {
    const cc = crossCheckTestDate("9/26/2025", "9/26/2025");
    expect(cc.conflict).toBe(false);
    expect(cc.display).toBe("9/26/2025");
    expect(cc.note).toBeNull();
  });
  it("falls back to OCR when no trusted date is available", () => {
    const cc = crossCheckTestDate("9/26/2025", null);
    expect(cc.display).toBe("9/26/2025");
    expect(cc.source).toBe("ocr");
    expect(cc.conflict).toBe(false);
  });
  it("never silently overwrites — raw OCR is always retained", () => {
    const cc = crossCheckTestDate("8/26/2025", "9/26/2025");
    expect(cc.ocr).toBe("8/26/2025"); // preserved for audit even when not displayed
  });
});

describe("parseVendorOcrPages — test date normalization", () => {
  it("normalizes an OCR'd test date with stray spacing", () => {
    const text = [
      "P&S 4.0 ANS Test Results",
      "Patient: Sample, Test   Test Date: 8 / 26 / 2025   Physician: Dr. Example",
      "LFa* Modulation Normal 2.50",
    ].join("\n");
    const x = parseVendorOcrPages(textToPages(text));
    expect(x.identity.testDate.value).toBe("8/26/2025");
    // The verbatim source text is preserved in provenance for audit.
    expect(x.identity.testDate.provenance?.sourceText).toMatch(/Test Date/i);
  });
});
