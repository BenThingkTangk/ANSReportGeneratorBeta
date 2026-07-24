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
import { extractVendorNarrative } from "./_ans/vendorNarrative.js";

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
 * Fill null identity fields on the tabular extraction from identity parsed out
 * of vendor PROSE (e.g. the letter's "RE: Alex Pare, dob 9/17/1975"). Only fills
 * ABSENT fields — never overwrites a value the grid parser already read — so a
 * narrative-only document can still be identity-reconciled during a merge.
 */
function backfillIdentityFromNarrative(
  extraction: VendorReportExtraction,
  narr: { identity?: { patientName: string | null; dob: string | null; testDate: string | null } } | null,
): void {
  const src = narr?.identity;
  if (!src) return;
  const id = extraction.identity;
  const fill = (field: { value: string | null; provenance: any }, value: string | null) => {
    if (field.value == null && value) {
      field.value = value;
      field.provenance = { page: 1, confidence: 0.9, sourceText: value };
    }
  };
  fill(id.patientName, src.patientName);
  fill(id.dob, src.dob);
  fill(id.testDate, src.testDate);
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

    // Decide the fast path by EXTRACTION SUCCESS across ALL text extractors —
    // the tabular grid parser (parseVendorOcrPages), the prose metric parser
    // (parseVendorReportText, e.g. "SB = 2.59"), AND the narrative findings
    // extractor (categorical findings like "Borderline low RFa"). A narrative
    // letter/summary has no grid, so the previous grid-only gate wrongly fell
    // through to OCR and lost the letter's SB and the summary's findings.
    const textExtraction = text ? parseVendorOcrPages(textToPages(text)) : null;
    const textMetrics = text ? parseVendorReportText(text) : null;
    const textNarrative = text ? extractVendorNarrative(text) : null;
    const textHasContent =
      (!!textExtraction && textExtraction.fieldCount > 0) ||
      (!!textMetrics && textMetrics.metrics.length > 0) ||
      (!!textNarrative && (textNarrative.findings.length > 0 || textNarrative.printedNumbers.length > 0));

    // --- Path 1: text-layer PDF (fast, exact) --------------------------------
    if (textHasContent) {
      const parsed = textMetrics!;
      const extraction: VendorReportExtraction = {
        ...textExtraction!,
        narrative: textNarrative
          ? { findings: textNarrative.findings, printedNumbers: textNarrative.printedNumbers }
          : undefined,
      };
      // Narrative-only docs (e.g. the letter) carry identity in prose — backfill
      // so they can be identity-reconciled when merged with the tabular report.
      backfillIdentityFromNarrative(extraction, textNarrative);
      const findingCount = textNarrative?.findings.length ?? 0;
      return res.status(200).json({
        success: true,
        fileName: file.fileName,
        textExtracted: true,
        ocrUsed: false,
        source: "text",
        looksLikeVendorReport: parsed.looksLikeVendorReport || !!textNarrative?.looksLikeVendorNarrative,
        metricCount: parsed.metrics.length,
        findingCount,
        metrics: parsed.metrics,
        extraction,
        note:
          `${parsed.metrics.length} printed metric(s) + ${findingCount} categorical finding(s) ` +
          `extracted verbatim (text layer) and tagged vendor_reported.`,
      });
    }

    // --- Path 2: scanned / image-only PDF → OCR ------------------------------
    // The signed Physio PS reports are flat rasters. Rasterize + OCR the pages
    // and lift the vendor's own printed numbers verbatim. Fields OCR cannot read
    // confidently stay ABSENT — never fabricated.
    const ocr = await ocrPdf(file.buffer);
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

    const ocrText = ocr.pages.map((p) => p.text).join("\n");
    const ocrNarrative = extractVendorNarrative(ocrText);
    const extraction: VendorReportExtraction = {
      ...parseVendorOcrPages(ocr.pages),
      narrative: ocrNarrative.findings.length > 0 || ocrNarrative.printedNumbers.length > 0
        ? { findings: ocrNarrative.findings, printedNumbers: ocrNarrative.printedNumbers }
        : undefined,
    };
    backfillIdentityFromNarrative(extraction, ocrNarrative);
    // Numeric grid metrics (rare on narrative summaries) PLUS any prose numbers.
    const gridMetrics = extractionToVendorMetrics(extraction);
    const proseMetrics = parseVendorReportText(ocrText).metrics.filter(
      (m) => !gridMetrics.some((g) => g.key === m.key),
    );
    const metrics = [...gridMetrics, ...proseMetrics];
    const findingCount = ocrNarrative.findings.length;
    const avgPageConf =
      ocr.pages.reduce((s, p) => s + (p.confidence ?? 0), 0) / Math.max(1, ocr.pages.length);

    return res.status(200).json({
      success: true,
      fileName: file.fileName,
      textExtracted: false,
      ocrUsed: true,
      source: "ocr",
      pageCount: ocr.pages.length,
      ocrConfidence: Math.round(avgPageConf),
      looksLikeVendorReport: extraction.looksLikeVendorReport || ocrNarrative.looksLikeVendorNarrative,
      metricCount: metrics.length,
      findingCount,
      metrics,
      extraction,
      note: (extraction.looksLikeVendorReport || ocrNarrative.looksLikeVendorNarrative)
        ? `OCR read ${metrics.length} printed metric(s) + ${findingCount} categorical finding(s) verbatim ` +
          `(mean field confidence ${(extraction.meanConfidence * 100).toFixed(0)}%). ` +
          `Values the scan could not resolve confidently are shown as unavailable, not guessed.`
        : "OCR ran but the pages do not look like a P&S / ANS vendor report; nothing ingested.",
    });
  } catch (err: any) {
    console.error("Vendor PDF ingest error:", err);
    return res.status(500).json({ success: false, error: err?.message || "Vendor PDF ingest failed" });
  }
}
