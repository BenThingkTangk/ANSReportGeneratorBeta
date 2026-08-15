/**
 * Default upload boundary: no legacy clinical interpreter may escape a raw .ans
 * response. This uses only the committed de-identified waveform fixture.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import handler, { LEGACY_CLINICAL_INTERPRETATION_ENABLED } from "../../upload.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, "fixtures", "deidentified_waveform.ans");
const pareFixture = path.join(here, "fixtures", "pare_deid.ans");

function upload(vendorHeader?: Record<string, unknown>, file = fixture): Promise<any> {
  const boundary = "----canonicalClinicalPipeline";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="ansFile"; filename="deidentified_waveform.ans"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    readFileSync(file),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const req = new EventEmitter() as any;
  req.method = "POST";
  req.headers = {
    "content-type": `multipart/form-data; boundary=${boundary}`,
    ...(vendorHeader ? { "x-vendor-metrics": JSON.stringify(vendorHeader) } : {}),
  };
  return new Promise((resolve, reject) => {
    const res: any = {
      code: 200,
      status(code: number) { this.code = code; return this; },
      setHeader() { return this; },
      json(payload: any) { resolve({ status: this.code, payload }); return this; },
      end() { resolve({ status: this.code }); return this; },
    };
    handler(req, res).catch(reject);
    setImmediate(() => { req.emit("data", body); req.emit("end"); });
  });
}

describe("canonical clinical pipeline default", () => {
  it("is opt-in for the legacy interpreter", () => {
    expect(LEGACY_CLINICAL_INTERPRETATION_ENABLED).toBe(false);
  });

  it("returns measured data and the canonical summary, never legacy clinical outputs, for a raw .ans", async () => {
    const result: any = await upload();
    expect(result.status).toBe(200);
    const report = result.payload.report;

    expect(report.clinicalPipeline).toMatchObject({
      mode: "canonical",
      clinicianReviewRequired: true,
    });
    expect(report.diagnosticSummary).toBeTruthy();
    expect(result.payload.diagnosticSummary).toEqual(report.diagnosticSummary);
    expect(report.diagnosticSummary.disclaimer).toMatch(/clinical decision support/i);
    expect(report.clinicalPipeline.missingOrNotAssessedDomains.length).toBeGreaterThan(0);
    // The raw .ans scorer must block CAN risk because its adrenergic pathway is
    // at most a cuff-BP screen, never a beat-to-beat BP/baroreflex assessment.
    expect(report.diagnosticSummary.phenotypeFlags.some((f: any) => f.id === "possible_can_risk")).toBe(false);
    expect(report.diagnosticSummary.unsafeOrUnsupportedClaimsBlocked).toEqual(
      expect.arrayContaining([expect.objectContaining({
        claim: expect.stringMatching(/CAN\) risk/i),
      })]),
    );

    expect(report.wellnessScore).toBeNull();
    expect(report.wellnessTier).toBe("Not assessed");
    expect(report.therapyRecommendations).toEqual([]);
    expect(report.phaseFindings).toEqual([]);
    expect(report.indications).toEqual([]);
    expect(Object.values(report.dysfunctionPatterns)).toEqual(
      Array(Object.keys(report.dysfunctionPatterns).length).fill(false),
    );
    expect(report.overallImpression).toMatch(/non-diagnostic.*clinician review required/i);

    const conclusionText = JSON.stringify({
      phaseFindings: report.phaseFindings,
      indications: report.indications,
      overall: report.overallImpression,
    });
    expect(conclusionText).not.toMatch(/alpha-?lipoic|baroreflex|cardiovascular autonomic neuropathy|vasovagal|presyncope|sympathetic excess|parasympathetic excess/i);
  });

  it("accepts paired vendor values only after identity match and preserves their provenance and precedence", async () => {
    const result: any = await upload({
      LFa: 1.5, RFa: 2.5, SB: 0.6, SBP: 120, DBP: 78,
      identity: { patientName: "John Faux", testDate: "7/11/2024", dob: "1/1/1975" },
    }, pareFixture);
    expect(result.status).toBe(200);
    const report = result.payload.report;
    expect(report.clinicalPipeline.mode).toBe("canonical");
    expect(report.vendorReconciliation.status).toBe("matched");
    expect(report.phaseEvents[0].provenance.LFa.method).toBe("vendor_reported");
    expect(report.phaseEvents[0].provenance.RFa.method).toBe("vendor_reported");
    expect(report.phaseEvents[0].provenance.SB.method).toBe("vendor_reported");
    expect(report.metricSources["baseline.LFa"]).toMatchObject({
      vendorReported: 1.5,
      displayed: 1.5,
      displayedProvenance: "Imported from paired vendor PDF",
      precedence: "paired_vendor_pdf",
    });
    expect(report.metricSources["baseline.SBP"]).toMatchObject({
      vendorReported: 120,
      displayed: 120,
      displayedProvenance: "Imported from paired vendor PDF",
      precedence: "paired_vendor_pdf",
    });
  });
});
