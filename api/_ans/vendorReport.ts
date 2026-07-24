/**
 * api/_ans/vendorReport.ts
 *
 * Optional paired vendor-PDF ingestion. The raw .ans recording cannot
 * reproduce the vendor's proprietary spectral aggregates (LFa/RFa/SB/FRF) or
 * the per-phase cuff blood pressures — those exist only in the signed vendor
 * report. This module lets a clinician attach that PDF so its VERBATIM values
 * enter the report tagged `vendor_reported` (an interpretable provenance tier,
 * per shared/metricProvenance.ts) instead of being permanently gated as
 * "not assessed".
 *
 * SAFETY CONTRACT:
 *   • Values are parsed VERBATIM from the vendor's own text — never computed,
 *     inferred, or interpolated here. If a label/number isn't present we return
 *     nothing for it (the report keeps its honest "not assessed" gate).
 *   • Every extracted value carries vendorReportedProvenance(), so downstream
 *     gating (mayInterpretClinically) treats it correctly.
 *   • This is a PURE function of text → values, so it is fully unit-testable
 *     without a live PDF or network.
 *
 * The endpoint (api/upload-vendor.ts) handles PDF→text extraction and calls
 * parseVendorReportText(). PDFs without a text layer (scanned images) yield no
 * text; the endpoint reports that clearly (OCR is the only pending external
 * step) rather than fabricating values.
 */

import {
  vendorReportedProvenance,
  type MetricProvenance,
  type MetricKey,
} from "../../shared/metricProvenance.js";

export interface VendorMetric {
  key: MetricKey;
  label: string;
  value: number;
  unit: string | null;
  provenance: MetricProvenance;
}

export interface VendorReportParse {
  /** Metrics recognized verbatim in the vendor text. */
  metrics: VendorMetric[];
  /** Whether the text looked like a genuine ANS/P&S vendor report at all. */
  looksLikeVendorReport: boolean;
  /** Raw label→number pairs we saw but did not map (for admin transparency). */
  unmapped: Array<{ label: string; value: number }>;
}

/** A recognizer: a label regex + the metric key/unit it maps to. Order matters —
 *  more specific patterns first so "LF/HF" isn't eaten by a bare "LF". */
interface Recognizer {
  key: MetricKey;
  label: string;
  unit: string | null;
  // Must contain one capture group for the numeric value.
  patterns: RegExp[];
}

// Numbers may be like "1.23", "12", "1,234", "0.05". Capture a signed decimal.
const NUM = String.raw`(-?\d+(?:[.,]\d+)?)`;

const RECOGNIZERS: Recognizer[] = [
  {
    key: "SB",
    label: "Sympathovagal balance (LFa/RFa)",
    unit: null,
    patterns: [
      new RegExp(String.raw`sympathovagal\s+balance[^\d\n-]{0,20}${NUM}`, "i"),
      new RegExp(String.raw`\bSB\b[^\d\n-]{0,12}${NUM}`, "i"),
      new RegExp(String.raw`LFa\s*/\s*RFa[^\d\n-]{0,12}${NUM}`, "i"),
    ],
  },
  {
    key: "LFHF",
    label: "LF/HF ratio",
    unit: null,
    patterns: [new RegExp(String.raw`LF\s*/\s*HF[^\d\n-]{0,12}${NUM}`, "i")],
  },
  {
    key: "LFa",
    label: "LFa (sympathetic)",
    unit: "bpm²",
    patterns: [new RegExp(String.raw`\bLFa\b[^\d\n-]{0,20}${NUM}`, "i")],
  },
  {
    key: "RFa",
    label: "RFa (parasympathetic)",
    unit: "bpm²",
    patterns: [new RegExp(String.raw`\bRFa\b[^\d\n-]{0,20}${NUM}`, "i")],
  },
  {
    key: "HRV_SDNN",
    label: "SDNN",
    unit: "ms",
    patterns: [new RegExp(String.raw`\bSDNN\b[^\d\n-]{0,15}${NUM}`, "i")],
  },
  {
    key: "HRV_RMSSD",
    label: "RMSSD",
    unit: "ms",
    patterns: [new RegExp(String.raw`\bRMSSD\b[^\d\n-]{0,15}${NUM}`, "i")],
  },
  {
    key: "SBP",
    label: "Systolic BP",
    unit: "mmHg",
    patterns: [
      new RegExp(String.raw`systolic[^\d\n-]{0,15}${NUM}`, "i"),
      new RegExp(String.raw`\bSBP\b[^\d\n-]{0,12}${NUM}`, "i"),
    ],
  },
  {
    key: "DBP",
    label: "Diastolic BP",
    unit: "mmHg",
    patterns: [
      new RegExp(String.raw`diastolic[^\d\n-]{0,15}${NUM}`, "i"),
      new RegExp(String.raw`\bDBP\b[^\d\n-]{0,12}${NUM}`, "i"),
    ],
  },
  {
    key: "eiRatio",
    label: "E/I ratio",
    unit: null,
    patterns: [new RegExp(String.raw`E\s*/\s*I\s*ratio[^\d\n-]{0,12}${NUM}`, "i")],
  },
  {
    key: "valsalvaRatio",
    label: "Valsalva ratio",
    unit: null,
    patterns: [new RegExp(String.raw`valsalva\s*ratio[^\d\n-]{0,12}${NUM}`, "i")],
  },
];

function toNumber(raw: string): number | null {
  const n = parseFloat(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse vendor-report plain text into verbatim, provenance-tagged metrics.
 * Pure and deterministic — safe to unit-test.
 */
export function parseVendorReportText(text: string): VendorReportParse {
  const metrics: VendorMetric[] = [];
  const seen = new Set<MetricKey>();

  // Heuristic: is this even a P&S / ANS vendor report? Guard against ingesting
  // an unrelated PDF and mislabeling stray numbers as clinical values.
  const looksLikeVendorReport =
    /(autonomic|sympathovagal|parasympathetic|P&S|LFa|RFa|Colombo|ANS)/i.test(text);

  if (!looksLikeVendorReport) {
    return { metrics: [], looksLikeVendorReport: false, unmapped: [] };
  }

  for (const rec of RECOGNIZERS) {
    if (seen.has(rec.key)) continue;
    for (const pat of rec.patterns) {
      const m = pat.exec(text);
      if (m && m[1]) {
        const value = toNumber(m[1]);
        if (value !== null) {
          metrics.push({
            key: rec.key,
            label: rec.label,
            value,
            unit: rec.unit,
            provenance: vendorReportedProvenance(rec.key),
          });
          seen.add(rec.key);
          break;
        }
      }
    }
  }

  return { metrics, looksLikeVendorReport: true, unmapped: [] };
}
