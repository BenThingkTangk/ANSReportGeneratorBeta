/**
 * Multi-document vendor reconciliation (BLOCKER A).
 *
 * Real-world case: Dr. Colombo's consultation LETTER prints the numeric
 * Sympathovagal Balance (SB = 2.59) in prose but no per-phase grid, while the
 * signed Diagnostic Implication SUMMARY (image-only, OCR) prints the 9
 * categorical findings but NO numeric spectral. Uploading the second document
 * used to REPLACE the first, so the two evidence sets could never coexist.
 *
 * This test builds each document's VendorReportExtraction exactly the way
 * api/upload-vendor.ts does (text-layer prose vs OCR summary), merges them with
 * the shared reconciliation module, and asserts that the merged extraction:
 *   • reconciles identity (same de-identified patient) and is NOT rejected,
 *   • carries SB = 2.59 from the letter AND all 9 categorical findings from the
 *     summary in ONE extraction,
 *   • tags every finding with its originating filename (provenance),
 *   • surfaces no spurious conflicts,
 *   • merges in BOTH upload orders.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseVendorOcrPages } from "../vendorOcrParse.js";
import { parseVendorReportText } from "../vendorReport.js";
import { extractVendorNarrative } from "../vendorNarrative.js";
import {
  mergeVendorExtractions,
  type NamedExtraction,
} from "../../../shared/mergeVendorExtractions.js";
import type { VendorReportExtraction } from "../../../shared/vendorExtraction.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => path.join(__dirname, "fixtures", n);

// De-identified copy of Dr. Colombo's LETTER prose (numeric SB lives here).
const LETTER_TEXT = `
RE: John Faux, dob 1/1/1975
Test Date: 7/11/2024
At rest John demonstrates normal HR & BP, low Parasympathetic activity indicating Advanced
Autonomic Dysfunction (AAD), normal Sympathetic activity, and high-normal Sympathovagal
Balance (SB = 2.59), indicating high-morbidity risk. His breathing responses are normal. Upon
standing, he demonstrates Sympathetic Excess (SE), indicating a (pre-clinical) Syncope risk.
His Standing BP was not recorded.
`;

/** Build the letter extraction the way upload-vendor's text path does. */
function buildLetterExtraction(): VendorReportExtraction {
  const textExtraction = parseVendorOcrPages([{ page: 1, text: LETTER_TEXT }] as any);
  const narrative = extractVendorNarrative(LETTER_TEXT);
  const extraction: VendorReportExtraction = {
    ...textExtraction,
    narrative: { findings: narrative.findings, printedNumbers: narrative.printedNumbers },
  };
  // Mirror backfillIdentityFromNarrative — fill null identity from prose.
  const src = narrative.identity;
  const id = extraction.identity as any;
  if (src) {
    if ((!id.patientName || id.patientName.value == null) && src.patientName) {
      id.patientName = { value: src.patientName, provenance: { page: 1, confidence: 0.9, sourceText: "RE:" } };
    }
    if ((!id.dob || id.dob.value == null) && src.dob) {
      id.dob = { value: src.dob, provenance: { page: 1, confidence: 0.9, sourceText: "dob" } };
    }
    if ((!id.testDate || id.testDate.value == null) && src.testDate) {
      id.testDate = { value: src.testDate, provenance: { page: 1, confidence: 0.9, sourceText: "Test Date" } };
    }
  }
  return extraction;
}

/** Build the summary extraction from the real de-identified OCR capture. */
function buildSummaryExtraction(): VendorReportExtraction {
  const pages = JSON.parse(readFileSync(fixture("pare_vendor_ocr_deid.json"), "utf8"));
  const ocrText = pages.map((p: any) => p.text).join("\n");
  const narrative = extractVendorNarrative(ocrText);
  const extraction: VendorReportExtraction = {
    ...parseVendorOcrPages(pages),
    narrative: { findings: narrative.findings, printedNumbers: narrative.printedNumbers },
  };
  return extraction;
}

const letter: NamedExtraction = { fileName: "colombo-letter.pdf", extraction: buildLetterExtraction() };
const summary: NamedExtraction = { fileName: "diagnostic-summary.pdf", extraction: buildSummaryExtraction() };

// The 9 categorical finding keys the signed summary reports.
const EXPECTED_FINDING_KEYS = [
  "baseline.hr",
  "baseline.bp",
  "baseline.lfa",
  "baseline.rfa",
  "baseline.sb",
  "db.responses",
  "db.hr_change",
  "stand.sympathetic",
  "stand.presyncope",
];

describe("vendor multi-document merge — letter (SB=2.59) + categorical summary", () => {
  it("the summary alone carries all 9 categorical findings but no numeric SB", () => {
    const keys = summary.extraction.narrative!.findings.map((f) => f.key).sort();
    for (const k of EXPECTED_FINDING_KEYS) expect(keys).toContain(k);
    expect(summary.extraction.narrative!.findings.length).toBeGreaterThanOrEqual(9);
    const sbNum = summary.extraction.narrative!.printedNumbers.find((n) => n.key === "SB");
    expect(sbNum).toBeUndefined();
  });

  it("the letter alone carries SB=2.59 in prose", () => {
    const sb = letter.extraction.narrative!.printedNumbers.find((n) => n.key === "SB");
    expect(sb?.value).toBeCloseTo(2.59, 2);
  });

  for (const order of [
    { name: "letter → summary", docs: [letter, summary] },
    { name: "summary → letter", docs: [summary, letter] },
  ]) {
    describe(`upload order: ${order.name}`, () => {
      const { merged, rejected, conflicts } = mergeVendorExtractions(order.docs);

      it("reconciles identity — neither document is rejected", () => {
        expect(rejected).toHaveLength(0);
        expect(merged.merged?.sourceFiles).toContain("colombo-letter.pdf");
        expect(merged.merged?.sourceFiles).toContain("diagnostic-summary.pdf");
      });

      it("SB = 2.59 and all 9 categorical findings COEXIST in one extraction", () => {
        const sb = merged.narrative!.printedNumbers.find((n) => n.key === "SB");
        expect(sb?.value).toBeCloseTo(2.59, 2);
        const keys = merged.narrative!.findings.map((f) => f.key);
        for (const k of EXPECTED_FINDING_KEYS) expect(keys).toContain(k);
        expect(merged.narrative!.findings.length).toBeGreaterThanOrEqual(9);
      });

      it("tags each merged finding with an originating filename (provenance)", () => {
        for (const f of merged.narrative!.findings) {
          expect(f.sourceFile).toBeTruthy();
        }
      });

      it("surfaces no spurious field conflicts", () => {
        expect(conflicts).toHaveLength(0);
      });
    });
  }

  it("REFUSES to merge a different patient (identity guard, never silent overwrite)", () => {
    const otherPatient: NamedExtraction = {
      fileName: "someone-else.pdf",
      extraction: {
        ...buildLetterExtraction(),
        identity: {
          ...(buildLetterExtraction().identity as any),
          patientName: { value: "Zzz Different", provenance: { page: 1, confidence: 0.9, sourceText: "RE:" } },
        },
      } as VendorReportExtraction,
    };
    const { merged, rejected } = mergeVendorExtractions([summary, otherPatient]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].fileName).toBe("someone-else.pdf");
    // Merged keeps ONLY the first document's findings — the stranger is excluded.
    expect(merged.merged?.sourceFiles).not.toContain("someone-else.pdf");
  });
});
