/**
 * Endpoint wiring test for POST /api/upload-vendor's OCR path.
 *
 * We mock the OCR engine (ocrPdf) so CI validates the handler's contract —
 * scanned PDF → OCR → structured extraction → VendorMetric[] with
 * vendor_reported provenance — without needing the heavy render/OCR stack or any
 * PHI. A second case proves an image-only PDF with an unavailable OCR engine
 * returns an honest "nothing ingested" (never fabricated) response.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { OcrPage } from "../ocr.js";

// --- Mock the OCR engine used by the endpoint ------------------------------
const ocrState: { pages: OcrPage[]; available: boolean } = { pages: [], available: true };
vi.mock("../ocr.js", () => ({
  ocrPdf: async () =>
    ocrState.available
      ? { ocrAvailable: true, pages: ocrState.pages }
      : { ocrAvailable: false, pages: [], reason: "engine unavailable (test)" },
}));
// Force the OCR branch: pretend there is no text layer.
vi.mock("../pdfText.js", () => ({ extractPdfText: async () => "" }));

function syntheticVendorPage(): OcrPage {
  const text = [
    "P&S 4.0 ANS Test Results",
    "Patient: Sample, Test   Test Date: 1/2/2020   Physician: Dr. Example",
    "Gender: Male   DOB: 3/4/1980   Age: 40",
    "LFa* Modulation   Normal   2.50 bpm2",
    "RFa* Modulation   Normal   4.00 bpm2",
    "LFa/RFa   Normal   0.63",
    "E/I Ratio : 1.30 (Normal: > 1.094)",
    "Valsalva Ratio : 1.50 (Normal: > 1.200)",
    "30:15 Ratio : 1.25 (Normal: > 1.092)",
  ].join("\n");
  return { page: 1, text, confidence: 88, words: [], width: 1700, height: 2200 };
}

function makeReq(body: Buffer) {
  const req = new EventEmitter() as any;
  req.method = "POST";
  req.headers = { "content-type": "multipart/form-data; boundary=B" };
  setImmediate(() => {
    req.emit("data", body);
    req.emit("end");
  });
  return req;
}

function multipart(fileBytes: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--B\r\nContent-Disposition: form-data; name="vendorPdf"; filename="scan.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
    ),
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

describe("POST /api/upload-vendor — OCR path", () => {
  beforeEach(() => {
    ocrState.pages = [syntheticVendorPage()];
    ocrState.available = true;
  });

  it("OCRs a scanned vendor PDF and returns verbatim vendor_reported metrics", async () => {
    const { status, json } = await invoke(multipart(Buffer.from("%PDF-1.4 fake scan")));
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.source).toBe("ocr");
    expect(json.ocrUsed).toBe(true);
    expect(json.looksLikeVendorReport).toBe(true);
    const byKey = Object.fromEntries((json.metrics ?? []).map((m: any) => [m.key, m]));
    expect(byKey.LFa.value).toBeCloseTo(2.5, 5);
    expect(byKey.RFa.value).toBeCloseTo(4.0, 5);
    expect(byKey.SB.value).toBeCloseTo(0.63, 5);
    expect(byKey.eiRatio.value).toBeCloseTo(1.3, 5);
    // provenance is vendor_reported (clinically interpretable)
    expect(byKey.LFa.provenance.method).toBe("vendor_reported");
    // structured extraction is echoed
    expect(json.extraction.baseline.LFa.value).toBeCloseTo(2.5, 5);
  });

  it("returns an honest empty result when the OCR engine is unavailable", async () => {
    ocrState.available = false;
    const { status, json } = await invoke(multipart(Buffer.from("%PDF-1.4 fake scan")));
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.source).toBe("none");
    expect(json.metrics).toEqual([]);
    expect(json.note).toMatch(/OCR engine is unavailable/i);
  });

  it("never fabricates: an OCR page that isn't a vendor report yields nothing", async () => {
    ocrState.pages = [
      { page: 1, text: "Invoice\nTotal 42.00\nThanks", confidence: 90, words: [], width: 10, height: 10 },
    ];
    const { json } = await invoke(multipart(Buffer.from("%PDF-1.4 fake")));
    expect(json.looksLikeVendorReport).toBe(false);
    expect(json.metrics).toEqual([]);
  });
});
