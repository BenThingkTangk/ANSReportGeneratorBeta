import type { VercelRequest, VercelResponse } from "@vercel/node";
import { extractPdfText } from "./_ans/pdfText.js";
import { parseVendorReportText } from "./_ans/vendorReport.js";

/**
 * POST /api/upload-vendor — optional paired vendor-PDF ingestion.
 *
 * Contract:
 *   multipart/form-data with a single `vendorPdf` file field (the signed P&S
 *   vendor report that pairs with a raw .ans recording).
 *
 * Response (200): {
 *   success: true,
 *   textExtracted: boolean,     // false ⇒ scanned/image PDF, OCR needed
 *   looksLikeVendorReport: boolean,
 *   metrics: VendorMetric[],    // verbatim, each tagged vendor_reported
 *   note: string,
 * }
 *
 * The extracted metrics are returned to the client, which merges them into the
 * report's provenance layer so vendor-reported spectral/BP values become
 * clinically interpretable (mayInterpretClinically === true for
 * vendor_reported) instead of staying gated as "not assessed". Nothing here
 * computes or infers a value — only the vendor's own printed numbers pass
 * through, so provenance integrity is preserved.
 *
 * When the PDF has no text layer we do NOT fabricate anything: we return
 * textExtracted:false with a clear note so the UI can prompt for a
 * text-based report (or a future OCR step) — the only pending external action.
 */

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_PDF_BYTES = 30 * 1024 * 1024;

function parseSinglePdf(rawBody: Buffer, contentType: string): { buffer: Buffer; fileName: string } | null {
  const boundaryMatch = contentType.match(/boundary=(.+)$/);
  if (!boundaryMatch) return null;
  const boundary = "--" + boundaryMatch[1];

  const parts = rawBody
    .toString("binary")
    .split(boundary)
    .filter((p) => p.includes("Content-Disposition"));

  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const headers = part.slice(0, headerEnd);
    if (!/name="(vendorPdf|file|pdf)"/.test(headers)) continue;
    const body = part.slice(headerEnd + 4, part.lastIndexOf("\r\n"));
    const fnMatch = headers.match(/filename="([^"]+)"/);
    const fileName = fnMatch ? fnMatch[1] : "vendor.pdf";
    return { buffer: Buffer.from(body, "binary"), fileName };
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "POST only" });

  try {
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => resolve());
      req.on("error", reject);
    });
    const rawBody = Buffer.concat(chunks);

    if (rawBody.length === 0) {
      return res.status(400).json({ success: false, error: "Empty request body" });
    }
    if (rawBody.length > MAX_PDF_BYTES) {
      return res.status(413).json({ success: false, error: "Vendor PDF exceeds 30 MB limit" });
    }

    const contentType = req.headers["content-type"] ?? "";
    const file = parseSinglePdf(rawBody, contentType);
    if (!file) {
      return res.status(400).json({
        success: false,
        error: "Expected multipart/form-data with a `vendorPdf` file field",
      });
    }

    const text = await extractPdfText(file.buffer);
    if (!text) {
      // No text layer — scanned/image PDF. Honest, not a fabrication.
      return res.status(200).json({
        success: true,
        fileName: file.fileName,
        textExtracted: false,
        looksLikeVendorReport: false,
        metrics: [],
        note:
          "This PDF has no extractable text layer (it appears to be a scanned image). " +
          "Vendor values cannot be read verbatim without OCR, so nothing was ingested. " +
          "Provide a text-based vendor report to import spectral/BP values, or the raw " +
          ".ans report will continue to gate those metrics as 'not assessed'.",
      });
    }

    const parsed = parseVendorReportText(text);

    return res.status(200).json({
      success: true,
      fileName: file.fileName,
      textExtracted: true,
      looksLikeVendorReport: parsed.looksLikeVendorReport,
      metricCount: parsed.metrics.length,
      metrics: parsed.metrics,
      note: parsed.looksLikeVendorReport
        ? `${parsed.metrics.length} vendor-reported metric(s) extracted verbatim and tagged vendor_reported.`
        : "Text extracted, but it does not look like a P&S / ANS vendor report; nothing ingested.",
    });
  } catch (err: any) {
    console.error("Vendor PDF ingest error:", err);
    return res.status(500).json({ success: false, error: err?.message || "Vendor PDF ingest failed" });
  }
}
