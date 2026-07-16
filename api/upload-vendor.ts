import type { VercelRequest, VercelResponse } from "@vercel/node";
import { extractPdfText } from "./_ans/pdfText.js";
import { parseVendorReportText } from "./_ans/vendorReport.js";
import { ocrPdf } from "./_ans/ocr.js";
import {
  parseVendorOcrPages,
  textToPages,
  extractionToBaselineMetrics,
  type VendorReportExtraction,
} from "./_ans/vendorOcrParse.js";
import { vendorReportedProvenance, type MetricKey } from "../shared/metricProvenance.js";

/**
 * POST /api/upload-vendor — optional paired vendor-PDF ingestion.
 *
 * Contract:
 *   multipart/form-data with a single `vendorPdf` file field (the signed P&S
 *   vendor report that pairs with a raw .ans recording).
 *
 * Response (200): {
 *   success: true,
 *   textExtracted: boolean,     // true when a text layer was present
 *   ocrUsed: boolean,           // true when the scanned image was OCR'd
 *   source: "text" | "ocr" | "none",
 *   looksLikeVendorReport: boolean,
 *   metrics: VendorMetric[],    // verbatim, each tagged vendor_reported
 *   extraction: VendorReportExtraction,  // typed fields + per-field provenance
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
 * Pipeline:
 *   1. text-layer extraction (pdf-parse) — fast path for digital PDFs.
 *   2. if no text layer, OCR the scanned pages (pdfjs raster + tesseract) and
 *      run the structured vendor parser. Fields OCR cannot read confidently are
 *      returned ABSENT — never fabricated.
 */

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_PDF_BYTES = 30 * 1024 * 1024;

/**
 * Server-side OCR wall-clock budget. Sits under the function's 120s maxDuration
 * so the request always returns a response (partial-but-honest if the budget is
 * hit) instead of the platform killing it, while leaving comfortable headroom
 * for a normal multi-page scanned report (~45s). Responsiveness is guaranteed by
 * the OCR pipeline yielding between units of work, not by this cap. Whatever the
 * OCR read verbatim before the deadline is returned; unresolved fields stay "not
 * assessed", never guessed.
 */
const OCR_DEADLINE_MS = 90_000;

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

/**
 * Flatten a structured OCR extraction into the same VendorMetric[] shape the
 * text-layer path returns, so the client merges both identically. Only fields
 * the parser actually read (value != null) become metrics; each keeps its
 * vendor_reported provenance and per-field OCR confidence.
 */
function extractionToVendorMetrics(x: VendorReportExtraction) {
  const rows: Array<{ key: MetricKey; label: string; value: number | null; unit: string | null; conf: number }> = [
    { key: "LFa", label: "LFa (sympathetic)", value: x.baseline.LFa.value, unit: x.baseline.LFa.unit ?? null, conf: x.baseline.LFa.provenance?.confidence ?? 0 },
    { key: "RFa", label: "RFa (parasympathetic)", value: x.baseline.RFa.value, unit: x.baseline.RFa.unit ?? null, conf: x.baseline.RFa.provenance?.confidence ?? 0 },
    { key: "SB", label: "Sympathovagal balance (LFa/RFa)", value: x.baseline.SB.value, unit: null, conf: x.baseline.SB.provenance?.confidence ?? 0 },
    { key: "SBP", label: "Systolic BP", value: x.baseline.SBP.value, unit: "mmHg", conf: x.baseline.SBP.provenance?.confidence ?? 0 },
    { key: "DBP", label: "Diastolic BP", value: x.baseline.DBP.value, unit: "mmHg", conf: x.baseline.DBP.provenance?.confidence ?? 0 },
    { key: "eiRatio", label: "E/I ratio", value: x.ratios.eiRatio.value, unit: null, conf: x.ratios.eiRatio.provenance?.confidence ?? 0 },
    { key: "valsalvaRatio", label: "Valsalva ratio", value: x.ratios.valsalvaRatio.value, unit: null, conf: x.ratios.valsalvaRatio.provenance?.confidence ?? 0 },
    { key: "thirtyFifteenRatio", label: "30:15 ratio", value: x.ratios.thirtyFifteenRatio.value, unit: null, conf: x.ratios.thirtyFifteenRatio.provenance?.confidence ?? 0 },
  ];
  return rows
    .filter((r) => r.value != null)
    .map((r) => ({
      key: r.key,
      label: r.label,
      value: r.value as number,
      unit: r.unit,
      confidence: r.conf,
      provenance: vendorReportedProvenance(r.key),
    }));
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

    // Decide the fast path by EXTRACTION SUCCESS, not by a length/keyword guess:
    // run the structured parser on the text layer and take the text path only if
    // it actually yields vendor fields. A scanned PDF with a few stray glyphs
    // parses to 0 fields and correctly falls through to OCR.
    const textExtraction = text ? parseVendorOcrPages(textToPages(text)) : null;
    const textHasFields = !!textExtraction && textExtraction.fieldCount > 0;

    // --- Path 1: text-layer PDF (fast, exact) --------------------------------
    if (textHasFields) {
      const parsed = parseVendorReportText(text);
      const extraction = textExtraction!;
      return res.status(200).json({
        success: true,
        fileName: file.fileName,
        textExtracted: true,
        ocrUsed: false,
        source: "text",
        looksLikeVendorReport: parsed.looksLikeVendorReport,
        metricCount: parsed.metrics.length,
        metrics: parsed.metrics,
        extraction,
        note: parsed.looksLikeVendorReport
          ? `${parsed.metrics.length} vendor-reported metric(s) extracted verbatim (text layer) and tagged vendor_reported.`
          : "Text extracted, but it does not look like a P&S / ANS vendor report; nothing ingested.",
      });
    }

    // --- Path 2: scanned / image-only PDF → OCR ------------------------------
    // The signed Physio PS reports are flat rasters. Rasterize + OCR the pages
    // and lift the vendor's own printed numbers verbatim. Fields OCR cannot read
    // confidently stay ABSENT — never fabricated.
    //
    // OCR is CPU-bound; bound it with a wall-clock deadline and a cancel signal
    // wired to the client aborting the request (fetch AbortController → socket
    // close). Either way we return whatever was read verbatim so far and never
    // guess the rest. The deadline sits under the function's maxDuration (120s).
    const ac = new AbortController();
    const onClose = () => ac.abort();
    req.on("close", onClose);
    const ocr = await ocrPdf(file.buffer, { deadlineMs: OCR_DEADLINE_MS, signal: ac.signal }).finally(() => {
      req.off?.("close", onClose);
    });
    if (!ocr.ocrAvailable) {
      return res.status(200).json({
        success: true,
        fileName: file.fileName,
        textExtracted: false,
        ocrUsed: false,
        source: "none",
        looksLikeVendorReport: false,
        metrics: [],
        note:
          "This PDF has no text layer and the OCR engine is unavailable in this " +
          `deployment (${ocr.reason ?? "unknown"}). Nothing was ingested; the raw ` +
          ".ans report keeps its honest 'not assessed' gates for vendor spectral/BP values.",
      });
    }

    // Client cancelled mid-OCR: the socket is gone, so don't bother serializing
    // a body — just stop. (Nothing was committed; the attachment is discarded.)
    if (ocr.truncated === "cancelled") {
      return res.end();
    }

    const extraction = parseVendorOcrPages(ocr.pages);
    const metrics = extractionToVendorMetrics(extraction);
    const avgPageConf =
      ocr.pages.reduce((s, p) => s + (p.confidence ?? 0), 0) / Math.max(1, ocr.pages.length);

    const timedOut = ocr.truncated === "deadline";
    const timeoutNote = timedOut
      ? " OCR stopped at the time budget; fields not yet read stay unavailable (not guessed) — " +
        "retry or use a text-layer PDF for the remaining values."
      : "";

    return res.status(200).json({
      success: true,
      fileName: file.fileName,
      textExtracted: false,
      ocrUsed: true,
      source: "ocr",
      timedOut,
      pageCount: ocr.pages.length,
      ocrConfidence: Math.round(avgPageConf),
      looksLikeVendorReport: extraction.looksLikeVendorReport,
      metricCount: metrics.length,
      metrics,
      extraction,
      note: extraction.looksLikeVendorReport
        ? `OCR read ${metrics.length} vendor-reported metric(s) verbatim from the scanned report ` +
          `(mean field confidence ${(extraction.meanConfidence * 100).toFixed(0)}%). ` +
          `Fields the scan could not resolve confidently are shown as unavailable, not guessed.` +
          timeoutNote
        : "OCR ran but the pages do not look like a P&S / ANS vendor report; nothing ingested." + timeoutNote,
    });
  } catch (err: any) {
    console.error("Vendor PDF ingest error:", err);
    return res.status(500).json({ success: false, error: err?.message || "Vendor PDF ingest failed" });
  }
}
