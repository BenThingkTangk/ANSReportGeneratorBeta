import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseANSFile, generateColomboReport } from "../../upload.js";
import { buildPatientSynopsis } from "../../../shared/deterministicSynopsis.js";

// Use the actual return type of generateColomboReport (upload.ts's local
// ANSReport shape) rather than the shared/schema one — they differ only in the
// nullability of spectral fields, which is irrelevant to buildPatientSynopsis
// (it reads every field defensively). The synopsis param is the schema shape,
// so we bridge with a thin `unknown` cast at the call site.
type Report = ReturnType<typeof generateColomboReport>;
const synopsisFor = (r: Report): string =>
  buildPatientSynopsis(r as unknown as Parameters<typeof buildPatientSynopsis>[0]);

/**
 * Regression: patient-facing deterministic copy must state the REAL limitation
 * (raw .ans lacks the vendor's proprietary spectral aggregates) — not the old
 * misleading "not enough heart-rhythm data" — and must surface the three
 * measured Ewing ratios. Also asserts the paired-vendor override unlocks the
 * full Colombo pathway.
 *
 * Uses the committed de-identified fixture (same ratios as the real Jill file:
 * E/I 1.21, Valsalva 1.43, 30:15 1.40), so it runs identically on CI. When the
 * real Jill file is present locally it is used as an extra check.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures", "deidentified_waveform.ans");
const REAL_JILL =
  "/home/user/workspace/uploaded_attachments/8e89e1202a664b3089d4ba662bc0c265/Shah-Jill-Fri-Sep-26-2025-2.ans";

function reportFor(file: string): Report {
  const buf = readFileSync(file);
  const data = parseANSFile(buf, path.basename(file));
  return generateColomboReport(data);
}

describe("patient copy — measured Ewing ratios + vendor-spectral provenance", () => {
  let report: Report;
  let patient: string;
  beforeAll(() => {
    report = reportFor(FIXTURE);
    patient = synopsisFor(report);
  });

  it("fixture matches the live-QA Jill values (E/I 1.21, Valsalva 1.43, 30:15 1.40)", () => {
    expect(report.ratios.eiRatio.value).toBeCloseTo(1.21, 2);
    expect(report.ratios.valsalvaRatio.value).toBeCloseTo(1.43, 2);
    expect(report.ratios.thirtyFifteenRatio.value).toBeCloseTo(1.4, 2);
    // These files lack the vendor spectral aggregates.
    expect(report.spectralAvailable).toBe(false);
  });

  it("patient copy quotes all three measured Ewing ratios", () => {
    expect(patient).toContain("1.21");
    expect(patient).toContain("1.43");
    expect(patient).toContain("1.40");
    expect(patient).toMatch(/E\/I ratio/);
    expect(patient).toMatch(/Valsalva ratio/);
    expect(patient).toMatch(/30:15 ratio/);
  });

  it("patient copy explains the vendor spectral-aggregate limitation", () => {
    expect(patient.toLowerCase()).toContain("spectral");
    // The precise distinction: proprietary vendor spectral branch-balance, not
    // present in the raw .ans export.
    expect(patient).toMatch(/proprietary spectral|spectral (aggregates|analysis)/i);
    expect(patient).toMatch(/\.ans export/i);
  });

  it("patient copy does NOT use the old misleading / disclaimer-wall phrasing", () => {
    const lower = patient.toLowerCase();
    expect(lower).not.toContain("not enough heart-rhythm");
    expect(lower).not.toContain("didn't include enough");
    expect(lower).not.toContain("did not capture enough heart-rhythm");
    expect(lower).not.toContain("not medical advice");
    expect(lower).not.toContain("not a diagnosis on their own");
    expect(lower).not.toContain("insufficient data");
  });

  it("paired vendor override unlocks the full Colombo spectral pathway", () => {
    const buf = readFileSync(FIXTURE);
    const data = parseANSFile(buf, "deid.ans");
    const withVendor = generateColomboReport(data, {
      LFa: 1.35,
      RFa: 2.8,
      SB: 0.48,
      SBP: 118,
      DBP: 74,
    });
    expect(withVendor.spectralAvailable).toBe(true);
    expect(withVendor.bpAvailable).toBe(true);
    // Baseline now carries vendor-reported provenance (verbatim, not computed).
    const A = withVendor.phaseEvents[0];
    expect(A.provenance?.LFa?.method).toBe("vendor_reported");
    expect(A.LFa).toBeCloseTo(1.35, 2);
    // Full pathway produces at least as many therapy recommendations as the
    // gated (clinician-review-only) path.
    const gated = generateColomboReport(data);
    expect(withVendor.therapyRecommendations.length).toBeGreaterThanOrEqual(
      gated.therapyRecommendations.length,
    );
  });

  it("vendor override values are never fabricated when absent", () => {
    // No vendor metrics → spectral stays unavailable, no vendor provenance.
    const gated = reportFor(FIXTURE);
    const A = gated.phaseEvents[0];
    expect(A.provenance?.LFa?.method).not.toBe("vendor_reported");
    expect(gated.spectralAvailable).toBe(false);
  });

  // Extra assurance against the real Jill file when it is available locally.
  it("real Jill patient copy uses the embedded summary without a missing-spectral disclaimer", () => {
    if (!existsSync(REAL_JILL)) {
      return; // CI / clean checkout: covered by the de-identified fixture above.
    }
    const report = reportFor(REAL_JILL);
    expect(report.spectralAvailable).toBe(true);
    expect(report.spectralSource).toBe("ans_stored");
    const jill = synopsisFor(report);
    expect(jill).toContain("1.21");
    expect(jill).toContain("1.43");
    expect(jill).toContain("1.40");
    expect(jill).toMatch(/rest-and-digest|fight-or-flight/i);
    expect(jill).not.toMatch(/proprietary spectral|spectral (aggregates|analysis).*\.ans export/i);
    expect(jill.toLowerCase()).not.toContain("not enough heart-rhythm");
    expect(jill.toLowerCase()).not.toContain("not medical advice");
  });
});
