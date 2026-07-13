# Vendor PDF Ingestion (`vendor_reported` provenance)

## Why
A raw `.ans` recording contains the ECG beat-to-beat series. The vendor's
spectral aggregates (LFa / RFa / sympathovagal balance / FRF) and per-phase cuff
blood pressures **do physically occur in the `.ans` binary as IEEE floats** (see
`scripts/audit-ans-spectral.mts` and `HUMANOS_CLINICIAN_VENDOR_PARITY_REPORT.md`
§1) — the earlier claim that they are "not present" was wrong — but there is **no
stable-offset table / constant-stride record / array header** to extract them
generically, and our open Morlet-CWT recomputation only *approximates* the
undisclosed vendor wavelet. So our pipeline computes them as `estimated` (tier
[P]) and gates them OFF clinically, rendering *"not assessed"* rather than a
misleading estimate. The vendor's **exact** numbers come from the signed **P&S
report PDF**.

This feature lets a clinician attach that PDF so its **verbatim** values enter
the report tagged `vendor_reported` — an interpretable provenance tier
(`mayInterpretClinically(vendor_reported) === true`) — and drive the clinician
**Vendor-Familiar** view. Scanned/image-only PDFs are read with on-device OCR
(`api/_ans/ocr.ts` → `vendorOcrParse.ts`); text-layer PDFs use the fast path.

## Contract

### Endpoint
`POST /api/upload-vendor` — `multipart/form-data`, single file field `vendorPdf`.

**Response 200:**
```jsonc
{
  "success": true,
  "fileName": "report.pdf",
  "textExtracted": true,          // false ⇒ scanned/image PDF (no text layer)
  "looksLikeVendorReport": true,  // guards against ingesting an unrelated PDF
  "metricCount": 9,
  "metrics": [
    { "key": "LFa", "label": "LFa (sympathetic)", "value": 1.35, "unit": "bpm²",
      "provenance": { "method": "vendor_reported", "tier": "P", ... } }
    // …
  ],
  "note": "9 vendor-reported metric(s) extracted verbatim and tagged vendor_reported."
}
```

### Safety guarantees
- **Verbatim only.** `parseVendorReportText()` (in `api/_ans/vendorReport.ts`) is
  a pure function that only lifts numbers printed in the vendor's own text. It
  never computes, infers, or interpolates. A metric the vendor didn't print is
  **absent**, never zero-filled.
- **Provenance integrity.** Every extracted value carries
  `vendorReportedProvenance(key)`, so downstream clinical gating treats it as a
  vendor-reported measurement — distinct from our computed/estimated values.
- **Report-type guard.** If the text doesn't look like a P&S/ANS report
  (`looksLikeVendorReport === false`), nothing is ingested.
- **No fabrication on scanned PDFs.** Image-only PDFs (no text layer) are now
  read with OCR (`source: "ocr"`); values the scan cannot resolve confidently are
  returned **absent**, never zero-filled. If the OCR engine is unavailable the
  endpoint says so honestly (`source: "none"`) and ingests nothing.

## Recognized metrics
`LFa, RFa, SB (LFa/RFa), LF/HF, SDNN, RMSSD, SBP, DBP, E/I ratio, Valsalva ratio`
(see `RECOGNIZERS` in `api/_ans/vendorReport.ts`; extend there).

## Where it surfaces
The parse-review screen (`ParsedDataReview`) shows an **"Attach vendor report
(PDF)"** card (`VendorPdfCard`). Attaching is optional; skipping it leaves the
report's honest gates intact. Imported metrics are displayed with their units
and exposed to the report pipeline.

## Tests
- `api/_ans/__tests__/vendorReport.spec.ts` — 7 unit tests covering verbatim
  extraction, provenance tagging, the unrelated-PDF guard, no-fabrication, and
  LF/HF-vs-LF disambiguation.
- Verified end-to-end against a synthetic text-layer PDF: extraction → parse →
  9 `vendor_reported` metrics.

## OCR path (scanned PDFs)
`api/_ans/ocr.ts` rasterizes pages with pdfjs-dist + @napi-rs/canvas and OCRs
them with tesseract.js (all pure-JS / prebuilt — Vercel-safe).
`api/_ans/vendorOcrParse.ts` extracts a typed `VendorReportExtraction` (identity,
resting spectral+BP, Ewing ratios) with per-field page/region/confidence
provenance. The sample Jill scans parse to **exact** vendor parity on
LFa/RFa/SB + the three ratios (see the parity report and `qa/vendor-parity.mjs`).

## Known limitation
The vendor's dense per-phase numerical-summary grid (phases B–F spectral columns)
OCRs unreliably and is not surfaced as parity values; the resting block + ratios
parse exactly. Full per-phase spectral parity would require the vendor's own
export or a higher-fidelity scan.
