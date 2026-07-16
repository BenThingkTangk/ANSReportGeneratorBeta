/**
 * POST /api/upload-vendor — the text-layer fast path must NOT run OCR.
 *
 * Requirement: "avoid rerunning expensive OCR when text extraction succeeds."
 * A digital (text-layer) vendor PDF should be parsed from its text and the OCR
 * engine must never be invoked — that's what keeps the common case fast and off
 * the main-thread-blocking WASM path entirely.
 *
 * We stub extractPdfText to return a realistic vendor text block and spy on
 * ocrPdf to assert it is never called. No PHI (synthetic text).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const ocrSpy = vi.fn(async () => ({ ocrAvailable: true, pages: [] }));
vi.mock("../ocr.js", () => ({ ocrPdf: ocrSpy }));

// A text layer that clearly looks like a P&S / ANS vendor report.
vi.mock("../pdfText.js", () => ({
  extractPdfText: async () =>
    [
      "P&S 4.0 ANS Test Results",
      "Patient: Sample, Test   Test Date: 1/2/2020",
      "LFa* Modulation   Normal   2.50 bpm2",
      "RFa* Modulation   Normal   4.00 bpm2",
      "LFa/RFa   Normal   0.63",
      "E/I Ratio : 1.30 (Normal: > 1.094)",
      "Valsalva Ratio : 1.50 (Normal: > 1.200)",
      "30:15 Ratio : 1.25 (Normal: > 1.092)",
    ].join("\n"),
}));

function makeReq(body: Buffer) {
  const req = new EventEmitter() as any;
  req.method = "POST";
  req.headers = { "content-type": "multipart/form-data; boundary=B" };
  setImmediate(() => { req.emit("data", body); req.emit("end"); });
  return req;
}

function multipart(fileBytes: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`--B\r\nContent-Disposition: form-data; name="vendorPdf"; filename="digital.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
    fileBytes,
    Buffer.from(`\r\n--B--\r\n`),
  ]);
}

async function invoke(body: Buffer): Promise<{ status: number; json: any }> {
  const handler = (await import("../../upload-vendor.js")).default;
  return await new Promise((resolve, reject) => {
    const res: any = {
      _s: 200,
      status(c: number) { this._s = c; return this; },
      setHeader() { return this; },
      json(p: any) { resolve({ status: this._s, json: p }); return this; },
      end() { resolve({ status: this._s, json: null }); return this; },
    };
    handler(makeReq(body), res).catch(reject);
  });
}

describe("upload-vendor — text layer skips OCR", () => {
  beforeEach(() => ocrSpy.mockClear());

  it("parses the text layer and never invokes OCR", async () => {
    const { status, json } = await invoke(multipart(Buffer.from("%PDF-1.4 digital")));
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.source).toBe("text");
    expect(json.textExtracted).toBe(true);
    expect(json.ocrUsed).toBe(false);
    // The whole point: the expensive OCR path is not entered.
    expect(ocrSpy).not.toHaveBeenCalled();
    expect(json.metricCount).toBeGreaterThan(0);
  });
});
