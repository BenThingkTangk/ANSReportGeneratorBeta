/**
 * Pare vendor OCR oracle + reconciliation contract.
 *
 * Two DISTINCT de-identified sources for Alex Pare → "John Faux":
 *   1. pare_vendor_ocr_deid.json — a REAL OCR capture of the P&S 4.0 Diagnostic
 *      Implication Summary PDF (image-only), patient name redacted in text +
 *      per-word tokens, DOB shifted to birth-year Jan-1. Genuine oracle for the
 *      OCR/parse contract.
 *   2. pare_deid.ans — the real de-identified .ans (see realFixtureGoldenMaster).
 *
 * This locks the accurate-provenance behavior the old app violated (it
 * fabricated LFa/RFa/SB phase numbers and ALA/hydration therapy from the .ans
 * alone): the .ans yields Ewing ratios + identity only; the vendor SUMMARY
 * supplies identity + anthropometrics + qualitative findings but NO numeric
 * spectral grid; and the numeric SB=2.59 lives only in the Colombo LETTER,
 * whose treatment prose must NEVER become an automatic engine recommendation.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseVendorOcrPages } from "../vendorOcrParse.js";
import { parseANSFile, generateColomboReport } from "../../upload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => path.join(__dirname, "fixtures", n);

const oracle = JSON.parse(readFileSync(fixture("pare_vendor_oracle.json"), "utf8"));

describe("Pare vendor SUMMARY OCR — de-identified real capture", () => {
  const pages = JSON.parse(readFileSync(fixture("pare_vendor_ocr_deid.json"), "utf8"));
  const x = parseVendorOcrPages(pages) as any;

  it("extracts identity + anthropometrics verbatim from the real OCR", () => {
    expect(x.identity.patientName.value).toMatch(/Faux/);
    expect(x.identity.patientName.value).not.toMatch(/Pare|Alex/i);
    expect(x.identity.testDate.value).toBe("7/11/2024");
    expect(x.identity.sex.value).toBe("Male");
    expect(x.identity.age.value).toBe(48);
    // The two values the old app got wrong (it showed BMI 19.3): the vendor
    // summary prints weight 200 lbs and BMI 25.68.
    expect(x.identity.weightText.value).toMatch(/200/);
    expect(x.identity.bmi.value).toBeCloseTo(25.68, 2);
    expect(x.identity.ectopicBeats.value).toBe(1);
  });

  it("carries NO numeric per-phase spectral grid (summary is narrative-only)", () => {
    // The Pare summary is a Diagnostic Implication Summary — unlike the Jill
    // numerical report it has no A–F LFa/RFa/SB table. The parser must NOT
    // invent one; baseline spectral stay null.
    expect(x.baseline.LFa.value).toBeNull();
    expect(x.baseline.RFa.value).toBeNull();
    expect(x.baseline.SB.value).toBeNull();
    expect((x.phases?.rows ?? []).length).toBe(0);
  });

  it("the committed OCR fixture contains no residual PHI", () => {
    const blob = JSON.stringify(pages);
    expect(blob).not.toMatch(/\bPare\b/i);
    expect(blob).not.toMatch(/\bAlex\b/i);
  });
});

describe("Pare .ans-alone — accurate provenance (no fabricated spectral/therapy)", () => {
  const data = parseANSFile(readFileSync(fixture("pare_deid.ans")), "pare_deid.ans");
  const report = generateColomboReport(data);

  it("yields the embedded Ewing ratios + ectopy, gates spectral/BP", () => {
    expect(data.eiRatio).toBeCloseTo(oracle.engineContract.fromAnsAlone.eiRatio, 2);
    expect(data.valsalvaRatio).toBeCloseTo(oracle.engineContract.fromAnsAlone.valsalvaRatio, 2);
    expect(data.thirtyFifteenRatio).toBeCloseTo(oracle.engineContract.fromAnsAlone.thirtyFifteenRatio, 2);
    expect(data.ectopicBeats).toBe(1);
    expect(report.spectralAvailable).toBe(false);
    expect(report.bpAvailable).toBe(false);
  });

  it("never emits the Colombo letter's treatment prose as a recommendation", () => {
    const blob = [
      ...report.therapyRecommendations.map((t: any) => `${t.title ?? ""} ${t.detail ?? ""} ${JSON.stringify(t)}`),
      ...report.contraindications,
      report.overallImpression,
    ].join("  ").toLowerCase();
    for (const banned of ["ala", "alpha-lipoic", "hydration", "salt", "nortriptyline", "midodrine", "compression garment"]) {
      expect(blob).not.toContain(banned);
    }
  });

  it("emits only a safe clinician-review item — never a fabricated therapy", () => {
    // Spectral-driven therapies are gated. The only recommendation is the honest
    // "insufficient data — clinician review required" placeholder, which
    // explicitly prescribes nothing.
    for (const t of report.therapyRecommendations as any[]) {
      expect(`${t.category} ${t.intervention}`).toMatch(/clinician review|insufficient data/i);
      expect(t.priority).not.toBe("urgent");
    }
    // And it must not name any pharmacology / supplement.
    const blob = JSON.stringify(report.therapyRecommendations).toLowerCase();
    for (const banned of ["ala", "alpha-lipoic", "nortriptyline", "midodrine", "salt", "hydration"]) {
      expect(blob).not.toContain(banned);
    }
  });
});

describe("Pare oracle — report vs letter distinction is preserved", () => {
  it("documents SB=2.59 only in the letter, not the summary grid", () => {
    expect(oracle.colomboLetter.sb).toBeCloseTo(2.59, 2);
    expect(oracle.reportSummary.hasNumericSpectralGrid).toBe(false);
  });

  it("documents divergent retest intervals (summary 6mo vs letter 3mo)", () => {
    expect(oracle.reportSummary.retestMonths).toBe(6);
    expect(oracle.colomboLetter.retestMonths).toBe(3);
  });

  it("summary reports NO therapy; letter prose is advisory only", () => {
    expect(oracle.reportSummary.therapyRecommendation).toBe("none");
    expect(Array.isArray(oracle.colomboLetter.treatmentProse)).toBe(true);
    expect(oracle.engineContract.mustNever).toContain(
      "treat the Colombo letter's treatment prose as an engine recommendation",
    );
  });
});

// Optional end-to-end when the real (un-redacted) PDFs are present locally.
// These lock the LIVE-QA parity fix (both PDFs previously reported 0 clinical
// metrics). They skip in CI where the PHI files are absent.
const REAL_DIR = "/home/user/workspace/uploaded_attachments/7dcba36d6d4f4aa4a00f54155cbfffd0";
const REAL_SUMMARY = `${REAL_DIR}/Pare-Alex-Thu-Jul-11-2024-Report.pdf`;
const REAL_LETTER = `${REAL_DIR}/Pare-Alex-Thu-Jul-11-2024.pdf`;
(existsSync(REAL_SUMMARY) ? describe : describe.skip)(
  "Pare real PDFs (local only) — full extraction parity",
  () => {
    it("summary OCR: weight 200 / BMI 25.68 / ectopy 1 + narrative findings", async () => {
      const { ocrPdf } = await import("../ocr.js");
      const { extractVendorNarrative } = await import("../vendorNarrative.js");
      const ocr = await ocrPdf(readFileSync(REAL_SUMMARY));
      const x = parseVendorOcrPages(ocr.pages) as any;
      expect(x.identity.weightText.value).toMatch(/200/);
      expect(x.identity.bmi.value).toBeCloseTo(25.68, 2);
      expect(x.identity.ectopicBeats.value).toBe(1);
      // Narrative findings must be extracted (the 0-metrics defect).
      const narr = extractVendorNarrative(ocr.pages.map((p: any) => p.text).join("\n"));
      const keys = narr.findings.map((f) => f.key);
      expect(keys).toEqual(expect.arrayContaining([
        "baseline.lfa", "baseline.rfa", "baseline.sb", "stand.sympathetic",
      ]));
      expect(narr.findings.find((f) => f.key === "baseline.rfa")?.classification).toBe("borderline-low");
      // Summary carries NO printed spectral numbers → none fabricated.
      expect(narr.printedNumbers.find((n) => n.key === "LFa")).toBeUndefined();
    }, 240_000);

    it("letter text-layer: prints SB = 2.59 (and no fabricated LFa/RFa numbers)", async () => {
      const { extractPdfText } = await import("../pdfText.js");
      const { extractVendorNarrative } = await import("../vendorNarrative.js");
      const text = await extractPdfText(readFileSync(REAL_LETTER));
      const narr = extractVendorNarrative(text);
      const sb = narr.printedNumbers.find((n) => n.key === "SB");
      expect(sb?.value).toBeCloseTo(2.59, 2);
      expect(narr.printedNumbers.some((n) => n.key === "LFa" || n.key === "RFa")).toBe(false);
    }, 60_000);
  },
);
