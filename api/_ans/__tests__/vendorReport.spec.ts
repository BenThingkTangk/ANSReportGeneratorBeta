import { describe, it, expect } from "vitest";
import { parseVendorReportText } from "../vendorReport.js";
import { mayInterpretClinically } from "../../../shared/metricProvenance.js";

/**
 * Vendor-PDF text parser: verbatim extraction + correct provenance tagging.
 * These tests exercise the pure text→metrics core with no PDF/network.
 */
describe("parseVendorReportText", () => {
  const SAMPLE = `
    PhysioPS Autonomic Nervous System Report (P&S Monitoring)
    Patient: [redacted]
    Resting analysis:
      LFa (sympathetic): 1.35 bpm²
      RFa (parasympathetic): 2.80 bpm²
      Sympathovagal balance (LFa/RFa): 0.48
      SDNN: 42 ms
      RMSSD: 38 ms
    Blood pressure (baseline): Systolic 118 mmHg / Diastolic 74 mmHg
    Ewing battery:
      E/I ratio: 1.21
      Valsalva ratio: 1.43
  `;

  it("recognizes a genuine vendor report", () => {
    const r = parseVendorReportText(SAMPLE);
    expect(r.looksLikeVendorReport).toBe(true);
    expect(r.metrics.length).toBeGreaterThanOrEqual(6);
  });

  it("extracts spectral aggregates verbatim (LFa/RFa/SB)", () => {
    const r = parseVendorReportText(SAMPLE);
    const byKey = Object.fromEntries(r.metrics.map((m) => [m.key, m]));
    expect(byKey.LFa.value).toBe(1.35);
    expect(byKey.RFa.value).toBe(2.8);
    expect(byKey.SB.value).toBe(0.48);
  });

  it("extracts BP and HRV verbatim", () => {
    const r = parseVendorReportText(SAMPLE);
    const byKey = Object.fromEntries(r.metrics.map((m) => [m.key, m]));
    expect(byKey.SBP.value).toBe(118);
    expect(byKey.DBP.value).toBe(74);
    expect(byKey.HRV_SDNN.value).toBe(42);
    expect(byKey.HRV_RMSSD.value).toBe(38);
  });

  it("tags every metric with vendor_reported provenance that is clinically interpretable", () => {
    const r = parseVendorReportText(SAMPLE);
    for (const m of r.metrics) {
      expect(m.provenance.method).toBe("vendor_reported");
      // vendor_reported values MAY drive clinical interpretation (that is the
      // whole point of ingesting the signed report).
      expect(mayInterpretClinically(m.provenance)).toBe(true);
    }
  });

  it("does NOT ingest values from an unrelated PDF (guard against mislabeling)", () => {
    const r = parseVendorReportText("Invoice #4821 Total 118.00 Tax 9.44 Due 2025");
    expect(r.looksLikeVendorReport).toBe(false);
    expect(r.metrics).toHaveLength(0);
  });

  it("returns nothing for a metric the vendor did not print (no fabrication)", () => {
    const r = parseVendorReportText("Autonomic report: SDNN: 50 ms. LFa: 1.0 bpm².");
    const keys = r.metrics.map((m) => m.key);
    expect(keys).toContain("HRV_SDNN");
    expect(keys).toContain("LFa");
    // Nothing about Valsalva/BP was present → must be absent, not zero-filled.
    expect(keys).not.toContain("valsalvaRatio");
    expect(keys).not.toContain("SBP");
  });

  it("handles LF/HF distinctly from a bare LF token", () => {
    const r = parseVendorReportText("ANS spectral: LF/HF: 1.9");
    const byKey = Object.fromEntries(r.metrics.map((m) => [m.key, m]));
    expect(byKey.LFHF?.value).toBe(1.9);
  });
});
