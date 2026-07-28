/**
 * Vendor-reported findings as a separate evidence class in the summaries
 * (BLOCKER B).
 *
 * When a signed vendor report is attached whose categorical findings flag
 * abnormalities, the patient plain-English synopsis and the clinician synopsis
 * must NOT say "nothing was flagged" — that contradicts the attached report.
 * The vendor findings are threaded as a SEPARATE, clearly-labelled evidence
 * class (vendor-reported, with provenance), and are NEVER converted into the
 * deterministic engine's measured/hypothesis results.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseVendorOcrPages } from "../vendorOcrParse.js";
import { extractVendorNarrative } from "../vendorNarrative.js";
import {
  buildPatientSynopsis,
  buildClinicianSynopsis,
  vendorFindingsPatientSentence,
  vendorFindingsClinicianBlock,
  type VendorFindingsInput,
} from "../../../shared/deterministicSynopsis.js";
import type { ANSReport } from "../../../shared/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => path.join(__dirname, "fixtures", n);

// The vendor findings the signed summary reports (real de-identified OCR).
function summaryVendorFindings(): VendorFindingsInput {
  const pages = JSON.parse(readFileSync(fixture("pare_vendor_ocr_deid.json"), "utf8"));
  const narrative = extractVendorNarrative(pages.map((p: any) => p.text).join("\n"));
  return { findings: narrative.findings, printedNumbers: narrative.printedNumbers };
}

/**
 * A deterministic report with a CLEAN cardiovagal screen and NO vendor spectral
 * (the exact situation that used to print "nothing flagged"): normal Ewing
 * ratios, autonomic balance unavailable, no dysfunction patterns.
 */
function cleanReport(): Partial<ANSReport> {
  return {
    dysfunctionPatterns: {} as any,
    autonomicBalance: { available: false, sympathetic: 0, parasympathetic: 0 } as any,
    spectralAvailable: false,
    ratios: {
      eiRatio: { value: 1.25, normal: "≥1.2", classification: { label: "Normal", severity: "normal" } },
      valsalvaRatio: { value: 1.6, normal: "≥1.4", classification: { label: "Normal", severity: "normal" } },
      thirtyFifteenRatio: { value: 1.1, normal: "≥1.0", classification: { label: "Normal", severity: "normal" } },
    } as any,
    phaseEvents: [
      { phase: "Baseline-A", meanHR: 70 } as any,
      { phase: "Stand-F", meanHR: 82 } as any,
    ],
  };
}

describe("vendor findings threaded into summaries (BLOCKER B)", () => {
  const vendor = summaryVendorFindings();

  it("the vendor findings include the notable abnormalities the summary reports", () => {
    const keys = vendor.findings.map((f) => f.key);
    expect(keys).toContain("db.hr_change");
    expect(keys).toContain("stand.sympathetic");
    expect(keys).toContain("stand.presyncope");
  });

  describe("patient plain-English synopsis", () => {
    it("does NOT say nothing was flagged when the vendor report has findings", () => {
      const withVendor = buildPatientSynopsis(cleanReport(), vendor);
      expect(withVendor).not.toMatch(/None of the specific autonomic dysfunction patterns/i);
    });

    it("plainly states the vendor-flagged abnormalities and that they need clinical review", () => {
      const withVendor = buildPatientSynopsis(cleanReport(), vendor);
      expect(withVendor).toMatch(/vendor report/i);
      expect(withVendor).toMatch(/heart rate/i); // baseline→DB HR change, in plain words
      expect(withVendor).toMatch(/sympathetic|pre-syncope|light-headed/i);
      expect(withVendor).toMatch(/reviewed with your clinician|review/i);
      // Honest about the raw recording's limits.
      expect(withVendor).toMatch(/blood-pressure|spectral/i);
    });

    it("STILL says nothing flagged when there is genuinely no vendor report", () => {
      const noVendor = buildPatientSynopsis(cleanReport(), undefined);
      expect(noVendor).toMatch(/None of the specific autonomic dysfunction patterns/i);
    });
  });

  describe("clinician synopsis", () => {
    it("appends a verbatim vendor-reported block, never 'nothing flagged'", () => {
      const withVendor = buildClinicianSynopsis(cleanReport(), vendor);
      expect(withVendor).toMatch(/Vendor-reported findings/i);
      expect(withVendor).toMatch(/High sympathetic response to stand/i);
      expect(withVendor).toMatch(/NOT deterministic engine measurements/i);
    });
  });

  describe("standalone helpers", () => {
    it("vendorFindingsPatientSentence is null when no notable findings", () => {
      expect(vendorFindingsPatientSentence({ findings: [] })).toBeNull();
    });
    it("vendorFindingsClinicianBlock carries per-finding provenance when present", () => {
      const tagged: VendorFindingsInput = {
        findings: vendor.findings.map((f) => ({ ...f, sourceFile: "summary.pdf" })),
        printedNumbers: [{ key: "SB", value: 2.59 }],
      };
      const block = vendorFindingsClinicianBlock(tagged)!;
      expect(block).toMatch(/\[summary\.pdf\]/);
      expect(block).toMatch(/SB = 2\.59 \(vendor-printed\)/);
    });
  });
});
