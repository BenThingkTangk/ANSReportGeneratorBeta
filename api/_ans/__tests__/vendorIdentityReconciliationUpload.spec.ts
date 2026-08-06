/**
 * BLOCKER 2 — end-to-end: POST /api/upload must reconcile the paired vendor
 * PDF's identity (sent in x-vendor-metrics) against the parsed .ans BEFORE
 * applying any vendor spectral/BP value. Mismatch → metrics dropped + explicit
 * warning; match → metrics applied and the spectral pathway unlocks.
 *
 * Uses the committed de-identified Pare fixture ("John Faux", study 7/11/2024,
 * DOB shifted to 1/1/1975). We drive the real handler with a real multipart
 * body + header, exactly as the browser does.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import handler from "../../upload.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARE = path.join(__dirname, "fixtures", "pare_deid.ans");

function buildMultipart(fileBytes: Buffer, fileName: string) {
  const boundary = "----humanosVendorReconBoundary";
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="ansFile"; filename="${fileName}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
    "utf-8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8");
  return { body: Buffer.concat([head, fileBytes, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

function invoke(fileBytes: Buffer, fileName: string, vendorHeader?: string): Promise<{ status: number; json: any }> {
  const { body, contentType } = buildMultipart(fileBytes, fileName);
  const req = new EventEmitter() as any;
  req.method = "POST";
  req.headers = { "content-type": contentType };
  if (vendorHeader) req.headers["x-vendor-metrics"] = vendorHeader;

  return new Promise((resolve, reject) => {
    const res: any = {
      _status: 200,
      status(code: number) { this._status = code; return this; },
      setHeader() { return this; },
      json(payload: any) { resolve({ status: this._status, json: payload }); return this; },
      end() { resolve({ status: this._status, json: null }); return this; },
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

const VENDOR_VALUES = { LFa: 1.5, RFa: 2.5, SB: 0.6, SBP: 120, DBP: 78 };

describe("POST /api/upload — vendor identity reconciliation (BLOCKER 2)", () => {
  it("applies vendor metrics when identity matches the .ans", async () => {
    const header = JSON.stringify({
      ...VENDOR_VALUES,
      identity: { patientName: "John Faux", testDate: "7/11/2024", dob: "1/1/1975" },
    });
    const { status, json } = await invoke(readFileSync(PARE), "pare_deid.ans", header);
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    const report = json.report;
    expect(report.spectralAvailable).toBe(true);
    expect(report.bpAvailable).toBe(true);
    expect(report.phaseEvents[0].LFa).toBe(1.5);
    expect(report.vendorReconciliationWarnings).toBeUndefined();
  });

  it("REJECTS vendor metrics when the patient name mismatches", async () => {
    const header = JSON.stringify({
      ...VENDOR_VALUES,
      identity: { patientName: "Jane Doe", testDate: "7/11/2024", dob: "1/1/1975" },
    });
    const { status, json } = await invoke(readFileSync(PARE), "pare_deid.ans", header);
    expect(status).toBe(200);
    const report = json.report;
    // Vendor values NOT applied → spectral/BP stay gated.
    expect(report.spectralAvailable).toBe(false);
    expect(report.bpAvailable).toBe(false);
    // No vendor number may reach any phase; a waveform estimate is allowed but
    // must be tagged computed/estimated, never vendor-reported.
    for (const ph of report.phaseEvents) {
      expect(ph.provenance?.LFa.method).not.toBe("vendor_reported");
      expect(ph.provenance?.LFa.method).not.toBe("derived_from_vendor");
      expect(ph.LFa).not.toBe(VENDOR_VALUES.LFa);
    }
    // Explicit warning surfaced, not silent.
    expect(Array.isArray(report.vendorReconciliationWarnings)).toBe(true);
    expect(report.vendorReconciliationWarnings.join(" ")).toMatch(/patient name/i);
  });

  it("REJECTS vendor metrics when the study date mismatches (stale visit)", async () => {
    const header = JSON.stringify({
      ...VENDOR_VALUES,
      identity: { patientName: "John Faux", testDate: "1/2/2020", dob: "1/1/1975" },
    });
    const { json } = await invoke(readFileSync(PARE), "pare_deid.ans", header);
    expect(json.report.spectralAvailable).toBe(false);
    expect(json.report.vendorReconciliationWarnings.join(" ")).toMatch(/study date/i);
  });

  it("REJECTS vendor metrics when DOB conflicts", async () => {
    const header = JSON.stringify({
      ...VENDOR_VALUES,
      identity: { patientName: "John Faux", testDate: "7/11/2024", dob: "5/5/1990" },
    });
    const { json } = await invoke(readFileSync(PARE), "pare_deid.ans", header);
    expect(json.report.spectralAvailable).toBe(false);
    expect(json.report.vendorReconciliationWarnings.join(" ")).toMatch(/date of birth/i);
  });

  it("REJECTS vendor metrics when identity metadata is absent entirely", async () => {
    // Legacy payload with NO identity → cannot confirm → reject.
    const header = JSON.stringify({ ...VENDOR_VALUES });
    const { json } = await invoke(readFileSync(PARE), "pare_deid.ans", header);
    expect(json.report.spectralAvailable).toBe(false);
    expect(Array.isArray(json.report.vendorReconciliationWarnings)).toBe(true);
  });
});
