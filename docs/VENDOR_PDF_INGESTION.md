# Vendor PDF Ingestion (`vendor_reported` provenance)

## Why
A raw `.ans` recording contains the ECG beat-to-beat series but **not** the
vendor's proprietary spectral aggregates (LFa / RFa / sympathovagal balance) or
the per-phase cuff blood pressures. Our pipeline therefore gates those metrics
as *"not assessed"* — honestly, because they cannot be reproduced from the raw
signal. Those numbers exist only in the signed **P&S vendor report PDF**.

This feature lets a clinician optionally attach that PDF so its **verbatim**
values enter the report tagged `vendor_reported` — an interpretable provenance
tier (`mayInterpretClinically(vendor_reported) === true`) — instead of staying
permanently gated.

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
- **No fabrication on scanned PDFs.** Image-only PDFs (no text layer) return
  `textExtracted: false` with an explanatory note. **OCR is the only pending
  external step** for those; the ingestion contract itself is complete and
  unit-tested.

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

## Known limitation
The sample Jill PDFs in this environment are **scanned images** (no text layer),
so they exercise the `textExtracted: false` path. A text-based vendor export
(or an added OCR pre-step) ingests fully via the same contract.
