import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  parseVendorOcrPages,
  textToPages,
  extractionToBaselineMetrics,
} from "../vendorOcrParse.js";
import type { OcrPage } from "../ocr.js";

const FIXTURE = path.resolve(
  __dirname,
  "fixtures/synthetic_vendor_ocr.json",
);

/**
 * Deidentified synthetic fixture (fictional "Testpatient, Sample") produced by
 * rasterizing a synthetic P&S-style page and running the real OCR engine, then
 * saving the OcrPage[]. Contains NO PHI and lets the parser be tested without
 * the OCR/render stack. See scripts that built /tmp/synthetic_vendor.png.
 */
function loadFixture(): OcrPage[] {
  return JSON.parse(readFileSync(FIXTURE, "utf8")) as OcrPage[];
}

describe("vendorOcrParse — structured extraction from OCR pages", () => {
  it("recognizes a P&S/ANS report and extracts the resting spectral block verbatim", () => {
    const x = parseVendorOcrPages(loadFixture());
    expect(x.looksLikeVendorReport).toBe(true);
    // Verbatim vendor values from the synthetic page.
    expect(x.baseline.LFa.value).toBeCloseTo(3.5, 5);
    expect(x.baseline.RFa.value).toBeCloseTo(4.2, 5);
    expect(x.baseline.SB.value).toBeCloseTo(0.83, 5);
    expect(x.baseline.meanHR.value).toBe(72);
    expect(x.baseline.rangeHR.value).toBe(20);
  });

  it("extracts the three Ewing time-domain ratios verbatim", () => {
    const x = parseVendorOcrPages(loadFixture());
    expect(x.ratios.eiRatio.value).toBeCloseTo(1.35, 5);
    expect(x.ratios.valsalvaRatio.value).toBeCloseTo(1.55, 5);
    expect(x.ratios.thirtyFifteenRatio.value).toBeCloseTo(1.28, 5);
  });

  it("extracts patient/study identity", () => {
    const x = parseVendorOcrPages(loadFixture());
    expect(x.identity.testDate.value).toBe("1/2/2020");
    expect(x.identity.age.value).toBe(40);
    expect(x.identity.sex.value?.toLowerCase()).toBe("male");
    expect(x.identity.physician.value).toMatch(/Example/);
  });

  it("attaches per-field provenance (page + confidence + source text)", () => {
    const x = parseVendorOcrPages(loadFixture());
    const p = x.baseline.LFa.provenance;
    expect(p).not.toBeNull();
    expect(p!.page).toBe(1);
    expect(p!.confidence).toBeGreaterThan(0);
    expect(p!.confidence).toBeLessThanOrEqual(1);
    expect(typeof p!.sourceText).toBe("string");
  });

  it("flattens to baseline vendor metrics for the paired-report override", () => {
    const x = parseVendorOcrPages(loadFixture());
    const m = extractionToBaselineMetrics(x);
    expect(m.LFa).toBeCloseTo(3.5, 5);
    expect(m.RFa).toBeCloseTo(4.2, 5);
    expect(m.SB).toBeCloseTo(0.83, 5);
  });

  it("never fabricates: an unrelated document yields nothing", () => {
    const pages = textToPages(
      "Grocery receipt\nMilk 3.50\nBread 2.10\nTotal 5.60\nThank you",
    );
    const x = parseVendorOcrPages(pages);
    expect(x.looksLikeVendorReport).toBe(false);
    expect(x.fieldCount).toBe(0);
    expect(x.baseline.LFa.value).toBeNull();
    expect(x.baseline.SB.value).toBeNull();
    expect(x.ratios.eiRatio.value).toBeNull();
  });

  it("returns ABSENT (not zero) for fields that are not present", () => {
    // A vendor-looking text with only ratios, no spectral block.
    const pages = textToPages(
      "P&S ANS Test Results\nE/I Ratio : 1.10 (Normal: > 1.094)\nValsalva Ratio : 1.30",
    );
    const x = parseVendorOcrPages(pages);
    expect(x.looksLikeVendorReport).toBe(true);
    expect(x.baseline.LFa.value).toBeNull();
    expect(x.baseline.RFa.value).toBeNull();
    expect(x.baseline.LFa.provenance).toBeNull();
    // present ones still read
    expect(x.ratios.eiRatio.value).toBeCloseTo(1.1, 5);
  });

  it("rejects an out-of-range FRF annotation as resting FRF (that is the DB value)", () => {
    const pages = textToPages(
      "P&S ANS Test Results\nFRF = 0.20 [OUT OF NORMAL RANGE (0.09 - 0.15)]",
    );
    const x = parseVendorOcrPages(pages);
    // 0.20 is the deep-breathing out-of-range value, never resting FRF.
    expect(x.baseline.FRF.value).toBeNull();
  });

  it("text-layer wrapping: whole PDF text as one page still parses", () => {
    const pages = textToPages(
      "P&S 4.0 ANS Test Results Patient: X Test Date: 5/6/2021\n" +
        "LFa* Modulation 2.10 RFa* Modulation 6.00 LFa/RFa 0.35",
    );
    const x = parseVendorOcrPages(pages);
    expect(x.baseline.LFa.value).toBeCloseTo(2.1, 5);
    expect(x.baseline.RFa.value).toBeCloseTo(6.0, 5);
    expect(x.baseline.SB.value).toBeCloseTo(0.35, 5);
  });
});

/**
 * Real-Jill OCR parity — runs ONLY when the (gitignored, PHI) OCR cache exists
 * locally. This proves the parser reproduces the vendor's exact printed spectral
 * + ratio values from the actual scanned report. It never runs on CI (no PHI in
 * the repo) and never hardcodes Jill values into production code.
 */
const JILL_OCR = process.env.JILL_OCR_JSON ?? "/tmp/ocr_jill5.json";
describe.skipIf(!existsSync(JILL_OCR))("vendorOcrParse — real Jill scanned-report parity", () => {
  it("reproduces the vendor's exact resting spectral + Ewing ratios", () => {
    const ocr = JSON.parse(readFileSync(JILL_OCR, "utf8"));
    const x = parseVendorOcrPages(ocr.pages);
    expect(x.baseline.LFa.value).toBeCloseTo(0.91, 2);
    expect(x.baseline.RFa.value).toBeCloseTo(5.13, 2);
    expect(x.baseline.SB.value).toBeCloseTo(0.18, 2);
    expect(x.baseline.meanHR.value).toBe(56);
    expect(x.ratios.eiRatio.value).toBeCloseTo(1.21, 2);
    expect(x.ratios.valsalvaRatio.value).toBeCloseTo(1.43, 2);
    expect(x.ratios.thirtyFifteenRatio.value).toBeCloseTo(1.4, 2);
  });
});
