/**
 * QA merge-blocker regressions (manual Playwright QA of commit 904d70c).
 *
 * Drives the REAL `POST /api/upload` runtime handler and asserts the
 * clinical-safety contract that manual QA found violated:
 *
 *   1. Missing spectral (LFa/RFa/SB) never surfaces as a fabricated 0/0.00 in the
 *      report model that the screen + print/export read from.
 *   2. No phase-specific "low parasympathetic/sympathetic response" or standing
 *      insufficiency is generated from missing/zero-substituted spectral values.
 *   3. Narrative internal consistency: the overall impression must NOT assert
 *      "advanced autonomic dysfunction" when the deterministic pattern detector
 *      did not set advancedAutonomicDysfunction (which is what makes the clinician
 *      synopsis say "No Colombo dysfunction pattern met detection criteria").
 *   4. Parasympathetic withdrawal is never emitted as a dysfunction (Colombo 1.11).
 *
 * Data source priority: the paired detailed Jill vendor report/.ans when present
 * on disk (reproduces the spectral-available contradiction path), else the
 * committed de-identified waveform fixture (PHI-free, always in CI). Vendor
 * spectral values used for the paired path come from the de-identified oracle,
 * never a memorized patient scalar substituted into the pipeline.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import handler from "../../upload.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures", "deidentified_waveform.ans");
const REAL_JILL =
  "/home/user/workspace/uploaded_attachments/8e89e1202a664b3089d4ba662bc0c265/Shah-Jill-Fri-Sep-26-2025-2.ans";

function invokeHandler(fileBytes: Buffer, fileName: string, vendorMetrics?: Record<string, number>): Promise<any> {
  const boundary = "----qaBlockerBoundary";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="ansFile"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, fileBytes, tail]);
  const req = new EventEmitter() as any;
  req.method = "POST";
  req.headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
  if (vendorMetrics) req.headers["x-vendor-metrics"] = JSON.stringify(vendorMetrics);
  return new Promise((resolve, reject) => {
    const res: any = {
      _s: 200,
      status(c: number) { this._s = c; return this; },
      setHeader() { return this; },
      json(p: any) { resolve(p); return this; },
      end() { resolve(null); return this; },
    };
    handler(req, res).catch(reject);
    setImmediate(() => { req.emit("data", body); req.emit("end"); });
  });
}

function collectStrings(v: unknown, out: string[] = []): string[] {
  if (v == null) return out;
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, out);
  else if (typeof v === "object") for (const x of Object.values(v)) collectStrings(x, out);
  return out;
}

const hasReal = existsSync(REAL_JILL);
const fixtureBytes = existsSync(FIXTURE) ? readFileSync(FIXTURE) : null;

describe("QA merge-blockers — raw-ECG .ans (spectral unavailable)", () => {
  let report: any;

  it("loads the de-identified fixture report", async () => {
    expect(fixtureBytes).not.toBeNull();
    const json = await invokeHandler(fixtureBytes!, "deidentified_waveform.ans");
    report = json.report;
    expect(report).toBeTruthy();
    expect(report.spectralAvailable).toBe(false);
  });

  it("#1 missing spectral is null in the report model — never a fabricated 0/0.00", () => {
    for (const p of report.phaseEvents) {
      // LFa/RFa/SB must be null (rendered as em dash), never a numeric 0.
      expect(p.LFa === null || p.LFa === undefined).toBe(true);
      expect(p.RFa === null || p.RFa === undefined).toBe(true);
      expect(p.SB === null || p.SB === undefined).toBe(true);
      // Provenance must mark them unavailable so the UI shows "unavailable"/"—".
      expect(p.provenance?.LFa?.method).toBe("unavailable");
    }
  });

  it("#2 no phase-specific low para/sympathetic response from missing values", () => {
    const blob = collectStrings(report.phaseFindings).join(" ").toLowerCase();
    // The only acceptable mention is the explicit "not assessed" gate.
    expect(blob).not.toMatch(/low parasympathetic response/);
    expect(blob).not.toMatch(/low sympathetic response/);
    expect(blob).toMatch(/not assessed|not reproducible/);
  });

  it("#3 overall impression does NOT assert advanced autonomic dysfunction", () => {
    expect(report.dysfunctionPatterns.advancedAutonomicDysfunction).toBe(false);
    expect(report.overallImpression.toLowerCase()).not.toContain("advanced autonomic dysfunction");
  });

  it("#4 no parasympathetic-withdrawal dysfunction is asserted", () => {
    expect(report.dysfunctionPatterns.parasympatheticWithdrawal).toBe(false);
    const codes = (report.indications ?? []).map((i: any) => i.code);
    expect(codes).not.toContain("PARA_WITHDRAWAL");
  });

  it("#1b whole-report scan finds no '0.00' spectral substitution string", () => {
    // A raw-ECG report must not print LFa/RFa/SB as 0.00 anywhere.
    const blob = collectStrings(report).join(" ");
    // Guard specifically against the fabricated-zero spectral phrasings.
    expect(blob).not.toMatch(/LFa\s*0\.00|RFa\s*0\.00|SB\s*0\.00/i);
  });
});

describe("QA merge-blockers — narrative consistency on the spectral-available path", () => {
  // Vendor baseline spectral from the de-identified Jill oracle (NOT memorized
  // into the pipeline — supplied via the same x-vendor-metrics path the UI uses).
  const VENDOR = { LFa: 0.91, RFa: 5.13, SB: 0.18, SBP: 92, DBP: 55 };

  it.runIf(hasReal)(
    "advanced-autonomic-dysfunction wording only appears when the AAD pattern is set",
    async () => {
      const json = await invokeHandler(readFileSync(REAL_JILL), "jill.ans", VENDOR);
      const report = json.report;
      expect(report.spectralAvailable).toBe(true);
      const impression = report.overallImpression.toLowerCase();
      if (!report.dysfunctionPatterns.advancedAutonomicDysfunction) {
        // The contradiction QA saw: AAD wording while no Colombo pattern met.
        expect(impression).not.toContain("suggest advanced autonomic dysfunction");
      }
      // Parasympathetic withdrawal remains normal physiology, never a dysfunction.
      expect(report.dysfunctionPatterns.parasympatheticWithdrawal).toBe(false);
    },
  );

  it("fixture-only fallback still holds the consistency invariant", async () => {
    if (hasReal) return; // covered by the real-file case above
    const json = await invokeHandler(fixtureBytes!, "deidentified_waveform.ans");
    const report = json.report;
    if (!report.dysfunctionPatterns.advancedAutonomicDysfunction) {
      expect(report.overallImpression.toLowerCase()).not.toContain("advanced autonomic dysfunction");
    }
  });
});
