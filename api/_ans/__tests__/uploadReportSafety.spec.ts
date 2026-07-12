/**
 * SECOND FINAL-QA regression: drives the EXACT runtime endpoint the "Generate
 * Report" button uses (`POST /api/upload` -> generateColomboReport) with a real
 * multipart body, and asserts the high-severity SAFETY contract for raw
 * ECG-only .ans files where the proprietary spectral aggregates (LFa/RFa/SB)
 * and continuous BP are NOT reproducible.
 *
 * The previous defect: missing LFa/RFa/SB were coerced to Sympathetic 0% /
 * Parasympathetic 100%, a "Stressed" balance while also asserting "Balanced
 * sympathovagal tone", unsupported findings ("Parasympathetic Excess at Rest",
 * "Advanced Autonomic Neuropathy"), a treatment plan (ALA 600 mg TID +
 * hydration/salt), unsupported plain-English claims, and a numeric body-impact
 * of -35. All of those MUST be gone when spectral/BP are unavailable.
 *
 * This test invokes the handler's own multipart parser + parseANSFile +
 * generateColomboReport (not a fixture shortcut), so it protects the real
 * browser -> API integration path end to end.
 *
 * Data source priority:
 *   1. The attached Jill file, if present on disk (full end-to-end proof — this
 *      file reproduces the exact original bug).
 *   2. A de-identified, structurally faithful waveform fixture committed to the
 *      repo (deterministic, PHI-free) — always runs in CI.
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

/** Build a multipart/form-data body with a single `ansFile` part. */
function buildMultipart(fileBytes: Buffer, fileName: string) {
  const boundary = "----humanosUploadBoundary1234567890";
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="ansFile"; filename="${fileName}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
    "utf-8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8");
  const body = Buffer.concat([head, fileBytes, tail]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Minimal Vercel-style req/res doubles that stream the multipart body. */
function invokeHandler(fileBytes: Buffer, fileName: string): Promise<{
  status: number;
  json: any;
}> {
  const { body, contentType } = buildMultipart(fileBytes, fileName);
  const req = new EventEmitter() as any;
  req.method = "POST";
  req.headers = { "content-type": contentType };

  return new Promise((resolve, reject) => {
    const res: any = {
      _status: 200,
      status(code: number) {
        this._status = code;
        return this;
      },
      setHeader() {
        return this;
      },
      json(payload: any) {
        resolve({ status: this._status, json: payload });
        return this;
      },
      end() {
        resolve({ status: this._status, json: null });
        return this;
      },
    };

    handler(req, res).catch(reject);

    setImmediate(() => {
      const mid = Math.floor(body.length / 2);
      req.emit("data", body.subarray(0, mid));
      req.emit("data", body.subarray(mid));
      req.emit("end");
    });
  });
}

function pickDataFile(): { bytes: Buffer; name: string; isReal: boolean } {
  if (existsSync(REAL_JILL)) {
    return {
      bytes: readFileSync(REAL_JILL),
      name: "Shah-Jill-Fri-Sep-26-2025-2.ans",
      isReal: true,
    };
  }
  return {
    bytes: readFileSync(FIXTURE),
    name: "deidentified_waveform.ans",
    isReal: false,
  };
}

/** Recursively flatten every string in the report into one blob for scanning. */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (value == null) return out;
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
  } else if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStrings(v, out);
    }
  }
  return out;
}

describe("POST /api/upload — spectral/BP unavailable safety contract (SECOND FINAL-QA)", () => {
  it("returns a successful report with spectral + BP explicitly unavailable", async () => {
    const { bytes, name } = pickDataFile();
    const { status, json } = await invokeHandler(bytes, name);

    expect(status).toBe(200);
    expect(json.success).toBe(true);
    const report = json.report;
    expect(report).toBeTruthy();

    // Raw ECG-only .ans -> proprietary spectral aggregates are NOT reproducible.
    expect(report.spectralAvailable).toBe(false);
    // No continuous BP in the binary -> BP unavailable.
    expect(report.bpAvailable).toBe(false);
  });

  it("never coerces missing spectral into 0% / 100% or a numeric balance", async () => {
    const { bytes, name } = pickDataFile();
    const { json } = await invokeHandler(bytes, name);
    const ab = json.report.autonomicBalance;

    // Balance must be explicitly not-assessed with NULL values — never 0/100.
    expect(ab.available).toBe(false);
    expect(ab.parasympathetic).toBeNull();
    expect(ab.sympathetic).toBeNull();
    expect(ab.balance).toBeNull();
  });

  it("emits no spectral-derived dysfunction findings/indications", async () => {
    const { bytes, name } = pickDataFile();
    const { json } = await invokeHandler(bytes, name);
    const report = json.report;

    const patterns = report.dysfunctionPatterns ?? {};
    // Every spectral- / BP-derived pattern must be false when unavailable.
    // (bradycardia + POTS are HR-derived and are asserted separately.)
    for (const key of [
      "parasympatheticDominance",
      "parasympatheticExcess",
      "parasympatheticWithdrawal",
      "sympatheticExcess",
      "sympatheticWithdrawal",
      "maskedSW",
      "advancedAutonomicDysfunction",
      "CAN",
      "orthostaticHypotension",
      "vasovagalRisk",
      "preSyncopeRisk",
      "highFRF",
    ]) {
      expect(patterns[key], `pattern ${key}`).toBeFalsy();
    }

    // Indication codes for spectral-derived conditions must not appear.
    const indicationCodes = (report.indications ?? []).map((i: any) => i.code);
    expect(indicationCodes).not.toContain("PE_REST");
    expect(indicationCodes).not.toContain("AAN");
  });

  it("recommends clinician review instead of ALA / salt / pharmacology", async () => {
    const { bytes, name } = pickDataFile();
    const { json } = await invokeHandler(bytes, name);
    const therapies: any[] = json.report.therapyRecommendations ?? [];

    // No therapy may NAME or DOSE a forbidden treatment in its actionable
    // fields (intervention/dose/category). The safe-fallback card is allowed to
    // MENTION ALA in its rationale/disclaimer only to say it cannot be given.
    const actionable = therapies
      .map((t) =>
        [t.category, t.intervention, t.dose, ...(t.contraindications ?? [])]
          .filter(Boolean)
          .join(" \u2029 "),
      )
      .join(" \u2029 ");

    expect(actionable).not.toMatch(/Alpha-?Lipoic Acid/i);
    expect(actionable).not.toMatch(/\bALA\b/);
    expect(actionable).not.toMatch(/600\s*mg/i);
    expect(actionable).not.toMatch(/hydration\s*\+?\s*salt/i);
    expect(actionable).not.toMatch(/Nortriptyline|Amitriptyline|Midodrine|Droxidopa|Carvedilol/i);

    // Also assert no dosing appears anywhere (a recommendation always carries a
    // dose) — the disclaimer is prose without "mg TID" style dosing.
    const wholeBlob = collectStrings(therapies).join(" \u2029 ");
    expect(wholeBlob).not.toMatch(/\d+\s*mg\s*(?:TID|BID|QD|daily|once|twice)/i);

    // The explicit safe fallback must be present.
    expect(wholeBlob).toMatch(/insufficient data/i);
    expect(wholeBlob).toMatch(/clinician review/i);
  });

  it("body-system impact is qualitative — no unexplained negative score", async () => {
    const { bytes, name } = pickDataFile();
    const { json } = await invokeHandler(bytes, name);
    const impacts = json.report.bodySystemImpact ?? [];

    // Spectral-derived domains must be marked not-assessed with a 0 (neutral)
    // impact — never a negative number like -35.
    const spectralDomains = ["nervous", "digestive", "endocrine", "respiratory"];
    for (const sys of spectralDomains) {
      const d = impacts.find((x: any) => x.system === sys);
      expect(d, `${sys} present`).toBeTruthy();
      expect(d.assessed, `${sys} assessed`).toBe(false);
      expect(d.impact, `${sys} impact neutral`).toBe(0);
      expect(d.label, `${sys} label`).toMatch(/not assessed/i);
    }
    // No assessed domain may carry the specific -35 (or any large negative)
    // fabricated score that the bug produced.
    for (const d of impacts) {
      expect(d.impact, `${d.system} not fabricated -35`).not.toBe(-35);
    }
  });

  it("contains none of the exact forbidden claim strings anywhere in the report", async () => {
    const { bytes, name } = pickDataFile();
    const { json } = await invokeHandler(bytes, name);
    const blob = collectStrings(json.report).join(" \u2029 ");

    const forbidden = [
      "Parasympathetic Excess at Rest",
      "Advanced Autonomic Neuropathy",
      "Balanced sympathovagal tone",
      "Sympathetic 0%",
      "Parasympathetic 100%",
    ];
    for (const s of forbidden) {
      expect(blob.includes(s), `forbidden string present: "${s}"`).toBe(false);
    }
  });

  it("overall impression states not-assessed / clinician-review, not a diagnosis", async () => {
    const { bytes, name } = pickDataFile();
    const { json } = await invokeHandler(bytes, name);
    const overall: string = json.report.overallImpression ?? "";

    expect(overall).toMatch(/not assessed|clinician review/i);
    // FRF is a proprietary spectral measure — must be null when unavailable.
    expect(json.report.respiratoryFrequency).toBeNull();
  });

  it("still reports the supported ECG-derived observations (HR + Ewing ratios)", async () => {
    const { bytes, name } = pickDataFile();
    const { json } = await invokeHandler(bytes, name);
    const report = json.report;

    // HR-derived phase metrics remain present and physiologic.
    expect(Array.isArray(report.phaseEvents)).toBe(true);
    expect(report.phaseEvents.length).toBeGreaterThan(0);
    for (const p of report.phaseEvents) {
      expect(p.meanHR).toBeGreaterThan(30);
      expect(p.meanHR).toBeLessThan(220);
      // Spectral fields must be nulled on the report-facing phases.
      expect(p.LFa).toBeNull();
      expect(p.RFa).toBeNull();
      expect(p.SB).toBeNull();
    }

    // Ewing ratios stay classified (supported observation).
    expect(report.ratios.eiRatio.value).toBeGreaterThan(0);
    expect(report.ratios.valsalvaRatio.value).toBeGreaterThan(0);
    expect(report.ratios.thirtyFifteenRatio.value).toBeGreaterThan(0);
  });
});
