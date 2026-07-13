/**
 * api/_ans/vendorOcrParse.ts — structured extraction from OCR'd vendor pages.
 *
 * Turns the OcrPage[] produced by ocr.ts (rasterize + tesseract) into a typed
 * `VendorReportExtraction`: patient/study identity, the resting-baseline
 * spectral + BP block, FRF, and the three Ewing time-domain ratios — each field
 * carrying a per-field OCR confidence and page/region (pixel bbox) provenance so
 * the UI and the parity report can show exactly where each number came from.
 *
 * SAFETY (identical contract to the text-layer path in vendorReport.ts):
 *   • Only the vendor's own printed numbers are lifted — nothing is computed,
 *     inferred, or interpolated. A field the OCR did not confidently read is
 *     ABSENT (null), never zero-filled.
 *   • Every mapped metric is tagged vendorReportedProvenance() downstream.
 *   • This is a pure function of OcrPage[] → extraction, unit-testable with
 *     synthetic pages (no PDF/engine needed).
 *
 * The vendor label vocabulary is fixed across P&S 4.0 reports, so extraction is
 * anchored on those labels (never on a patient identity or file hash — see the
 * noRuntimeOracle guard). This module is used for BOTH scanned PDFs (via OCR)
 * and, opportunistically, text-layer PDFs (the whole text becomes one "page").
 */

import type { OcrPage, OcrWord } from "./ocr.js";
import type {
  VendorFieldProvenance as FieldProvenance,
  VendorField,
  VendorIdentity,
  VendorBaseline,
  VendorRatios,
  VendorReportExtraction,
} from "../../shared/vendorExtraction.js";

export type {
  VendorField,
  VendorIdentity,
  VendorBaseline,
  VendorRatios,
  VendorReportExtraction,
} from "../../shared/vendorExtraction.js";

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

const NUM = String.raw`(-?\d+(?:[.,]\d+)?)`;

function toNumber(raw: string): number | null {
  if (raw == null) return null;
  const n = parseFloat(String(raw).replace(/,/g, "."));
  return Number.isFinite(n) ? n : null;
}

/** Join all pages into one newline-preserved text blob (page-order). */
function joinText(pages: OcrPage[]): string {
  return pages.map((p) => p.text ?? "").join("\n");
}

/**
 * Isolate the RESTING baseline block. The vendor's "ANS Test Results" page
 * prints Systolic/Diastolic BP, Mean/Range HR, and the FRF annotation once PER
 * PHASE (Initial Baseline → Deep Breathing → Valsalva → Stand). To read the
 * resting values specifically we cut the joined text at the first Deep-Breathing
 * marker — the resting block is physically first. If no marker is found we return
 * the whole text (a single-value report still matches).
 */
function restingSlice(text: string): string {
  const markers = [
    /Deep\s*Breathing/i,
    /DB\s*AND\s*VALSALVA/i,
    /Interpretation\s*\*\*\*/i, // the DB block's interpretation header
  ];
  let cut = text.length;
  for (const re of markers) {
    const m = re.exec(text);
    if (m && m.index > 40 && m.index < cut) cut = m.index;
  }
  return text.slice(0, cut);
}

/**
 * Find the OCR word whose text contains `valueStr` (loosely), to attach a pixel
 * region + word confidence to an extracted value. Returns null for text-layer
 * pages (no word geometry) — the caller then falls back to page-level.
 */
function locateValue(
  pages: OcrPage[],
  valueStr: string,
): { page: number; word: OcrWord } | null {
  const norm = (s: string) => s.replace(/[^0-9.]/g, "");
  const target = norm(valueStr);
  if (!target) return null;
  // Single pass: return the first EXACT match immediately; otherwise remember
  // the first loose (contains-the-digits) match as a fallback.
  let loose: { page: number; word: OcrWord } | null = null;
  for (const p of pages) {
    for (const w of p.words ?? []) {
      const nw = norm(w.text);
      if (nw === target) return { page: p.page, word: w };
      if (!loose && target.length >= 3 && nw.includes(target)) loose = { page: p.page, word: w };
    }
  }
  return loose;
}

/**
 * Build a VendorField for a numeric value matched by `re` in the joined text.
 * `unit` is decorative. `groupIdx` selects the capture group holding the number.
 */
function numField(
  pages: OcrPage[],
  text: string,
  res: RegExp | RegExp[],
  unit: string | null = null,
  defaultPage = 1,
  opts: { sanity?: (v: number) => boolean; rejectMatch?: (fullMatch: string) => boolean } = {},
): VendorField<number> {
  // Try each recognizer in priority order; a value must pass the optional sanity
  // predicate (rejects OCR digit-loss like RFa "5.13" → "513"), and the match
  // may be rejected by context (e.g. an "[OUT OF NORMAL RANGE]" annotation that
  // marks a non-resting FRF value).
  const patterns = Array.isArray(res) ? res : [res];
  for (const re of patterns) {
    const m = re.exec(text);
    if (!m || m[1] == null) continue;
    if (opts.rejectMatch && opts.rejectMatch(m[0])) continue;
    const raw = m[1];
    const value = toNumber(raw);
    if (value == null) continue;
    if (opts.sanity && !opts.sanity(value)) continue;
    const loc = locateValue(pages, raw);
    const provenance: FieldProvenance = loc
      ? {
          page: loc.page,
          region: loc.word.bbox,
          confidence: clamp01((loc.word.confidence ?? 0) / 100),
          sourceText: m[0].trim().slice(0, 80),
        }
      : {
          page: defaultPage,
          confidence: pageConfidence(pages, defaultPage),
          sourceText: m[0].trim().slice(0, 80),
        };
    return { value, unit, provenance };
  }
  return { value: null, unit, provenance: null };
}

function strField(
  pages: OcrPage[],
  text: string,
  re: RegExp,
  defaultPage = 1,
): VendorField<string> {
  const m = re.exec(text);
  if (!m) return { value: null, provenance: null };
  const value = (m[1] ?? "").trim();
  if (!value) return { value: null, provenance: null };
  return {
    value,
    provenance: {
      page: defaultPage,
      confidence: pageConfidence(pages, defaultPage),
      sourceText: m[0].trim().slice(0, 80),
    },
  };
}

/**
 * Blood-pressure field scoped by PAGE GEOMETRY to the resting block. The vendor
 * stacks the four phase blocks vertically (Initial Baseline is topmost), so the
 * resting Systolic/Diastolic value must sit on roughly the same horizontal band
 * (±yTol px) as the FIRST occurrence of its label, in the value column. This
 * prevents a lower phase's BP (which shares the identical label text) from being
 * captured when the resting token itself was dropped by OCR — in that case we
 * correctly return ABSENT rather than a wrong number.
 *
 * Falls back to null when there is no word geometry (text-layer PDFs): resting
 * BP on a real text-layer vendor export is read by the ratios/identity path and
 * the paired .ans, so we never fabricate here.
 */
function lineScopedBp(
  pages: OcrPage[],
  _text: string,
  labelRe: RegExp,
  unit: string,
  sanity: (v: number) => boolean,
): VendorField<number> {
  const yTol = 45;
  for (const p of pages) {
    const words = p.words ?? [];
    if (words.length === 0) continue;
    // topmost label word (resting block is highest on the page)
    const labels = words
      .filter((w) => labelRe.test(w.text) || labelRe.test(`${w.text} Blood Pressure`))
      .sort((a, b) => a.bbox.y0 - b.bbox.y0);
    // Rebuild the multi-word label match: find a word starting the phrase.
    const labelWord = words
      .filter((w) => /Systolic|Diastolic/i.test(w.text) && labelRe.test(w.text))
      .sort((a, b) => a.bbox.y0 - b.bbox.y0)[0] ?? labels[0];
    if (!labelWord) continue;
    const bandY = (labelWord.bbox.y0 + labelWord.bbox.y1) / 2;
    // value column: to the right of the label, same band, "NN" then optionally mmHg
    const candidates = words
      .filter((w) => {
        const cy = (w.bbox.y0 + w.bbox.y1) / 2;
        return (
          Math.abs(cy - bandY) <= yTol &&
          w.bbox.x0 > labelWord.bbox.x1 &&
          /^\d{2,3}$/.test(w.text.replace(/\D/g, ""))
        );
      })
      .sort((a, b) => a.bbox.x0 - b.bbox.x0);
    for (const c of candidates) {
      const value = toNumber(c.text.replace(/\D/g, ""));
      if (value != null && sanity(value)) {
        return {
          value,
          unit,
          provenance: {
            page: p.page,
            region: c.bbox,
            confidence: clamp01((c.confidence ?? 0) / 100),
            sourceText: `${labelWord.text} … ${c.text}`,
          },
        };
      }
    }
    // label found but no resting value in-band → honestly absent
    return { value: null, unit, provenance: null };
  }
  return { value: null, unit, provenance: null };
}

function pageConfidence(pages: OcrPage[], page: number): number {
  const p = pages.find((pp) => pp.page === page);
  if (!p) return pages.length ? clamp01((pages[0].confidence ?? 0) / 100) : 0;
  // text-layer sentinel pages set confidence to 100 explicitly.
  return clamp01((p.confidence ?? 0) / 100);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// --------------------------------------------------------------------------
// main
// --------------------------------------------------------------------------

/**
 * Parse structured vendor fields from OCR'd pages. `pages` may also be a single
 * synthetic page wrapping text-layer output (words:[], confidence:100).
 */
export function parseVendorOcrPages(pages: OcrPage[]): VendorReportExtraction {
  const text = joinText(pages);
  const notes: string[] = [];

  const looksLikeVendorReport =
    /(autonomic|sympathovagal|parasympathetic|P&S|LFa|RFa|Colombo|ANS\s+Test|Multi-?Parameter)/i.test(
      text,
    );

  // ---- Identity (top banner, present on every page) ----
  const identity: VendorIdentity = {
    patientName: strField(pages, text, /Patient:\s*([A-Za-z][A-Za-z ,.'-]{1,40}?)\s+Test Date/i),
    testDate: strField(pages, text, /Test Date:\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})/i),
    physician: strField(pages, text, /Physician:\s*(Dr\.?\s*[A-Za-z][A-Za-z .'-]{1,40}?)(?:\n|Gender|Height|$)/i),
    dob: strField(pages, text, /DOB:\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2,4})/i),
    age: numField(pages, text, new RegExp(String.raw`Age:\s*${NUM}`, "i")),
    sex: strField(pages, text, /Gender:\s*(Male|Female)/i),
    heightText: strField(pages, text, /Height:\s*([0-9]{1,2}\s*ft\s*[0-9]{1,2}\s*in)/i),
    weightText: strField(pages, text, new RegExp(String.raw`Weight:\s*(${NUM}\s*l?bs)`, "i")),
    bmi: numField(pages, text, new RegExp(String.raw`BMI:\s*${NUM}`, "i")),
    ectopicBeats: numField(pages, text, new RegExp(String.raw`Ectopic Beats:\s*${NUM}`, "i")),
  };

  // ---- Resting baseline block ----
  // Vendor labels: "Mean Heart Rate ... 56 bpm", "LFa* Modulation ... 0.91",
  // "RFa* Modulation ... 5.13", "LFa/RFa ... 0.18", "Systolic Blood Pressure ... 92",
  // "Diastolic Blood Pressure ... 55", "FRF = 0.20".
  // The vendor prints the resting spectral values in THREE places: the "ANS
  // Test Results" resting block ("LFa* Modulation 0.91"), the Baseline scatter
  // label "(0.91 , 5.13)", and the Cardio-Respiratory Coupling caption
  // "RFA = 5.13 / LFA/RFA = 0.18". We try each in priority order and apply a
  // physiological sanity range so an OCR digit-drop (e.g. "5.13"→"513") is
  // rejected rather than accepted. This is redundancy the vendor itself printed
  // — not inference.
  // Scope BP / HR / FRF to the resting block so we don't capture a later phase's
  // repeated label. Spectral modulation labels are unique to resting already.
  const resting = restingSlice(text);
  const baseline: VendorBaseline = {
    meanHR: numField(pages, resting, [
      new RegExp(String.raw`Mean Heart Rate[^\d]{0,40}?${NUM}\s*bpm`, "i"),
      // OCR often prints the value line ABOVE the label: "56 bpm ... Mean Heart Rate".
      new RegExp(String.raw`${NUM}\s*bpm[^\n]{0,40}\n?[^\n]{0,20}Mean Heart Rate`, "i"),
      new RegExp(String.raw`Mean Heart Rate\s+(?:Low|Normal|High)[^\d]{0,30}?${NUM}`, "i"),
    ], "bpm", 1, { sanity: (v) => v >= 25 && v <= 220 }),
    rangeHR: numField(pages, resting, new RegExp(String.raw`Range Heart Rate[^\d]{0,60}?${NUM}\s*bpm`, "i"), "bpm", 1, { sanity: (v) => v >= 0 && v <= 200 }),
    // "Modulation" anchors the resting block; scatter label "(LFa , RFa)" and the
    // coupling "LFA/RFA" caption are cross-check fallbacks.
    LFa: numField(pages, text, [
      new RegExp(String.raw`LFa\*?\s*Modulation[^\d-]{0,40}?${NUM}`, "i"),
      new RegExp(String.raw`\(\s*${NUM}\s*[°'"*]?\s*,\s*-?\d`, "i"), // scatter "(0.91 , 5.13)"
    ], "bpm²", 1, { sanity: (v) => v >= 0 && v <= 500 }),
    RFa: numField(pages, text, [
      new RegExp(String.raw`RFa\*?\s*Modulation[^\d-]{0,40}?${NUM}`, "i"),
      new RegExp(String.raw`\bRFA?\s*=\s*${NUM}`, "i"), // coupling "RFA = 5.13"
      new RegExp(String.raw`\(\s*-?\d+(?:[.,]\d+)?\s*[°'"*]?\s*,\s*${NUM}`, "i"), // scatter 2nd coord
    ], "bpm²", 1, { sanity: (v) => v >= 0 && v <= 500 }),
    SB: numField(pages, text, [
      new RegExp(String.raw`LFa\s*/\s*RFa[^\d-]{0,20}?${NUM}`, "i"),
      new RegExp(String.raw`LFA?\s*/\s*RFA?\s*=\s*${NUM}`, "i"), // coupling "LFA/RFA = 0.18"
    ], null, 1, { sanity: (v) => v >= 0 && v <= 100 }),
    // FRF: the salient "FRF = 0.20 [OUT OF NORMAL RANGE]" is the DEEP-BREATHING
    // value, NOT resting — so we reject any match whose trailing context flags
    // out-of-range. The regex captures a few following chars so rejectMatch can
    // inspect the annotation. Only a clean resting "FRF = X" in-range is accepted.
    FRF: numField(
      pages,
      resting,
      new RegExp(String.raw`FRF\s*=\s*${NUM}(\s*\[?\s*OUT[^\]]*\]?)?`, "i"),
      "Hz",
      1,
      { sanity: (v) => v >= 0 && v <= 2, rejectMatch: (full) => /OUT OF NORMAL|\[OUT/i.test(full) },
    ),
    // BP is scoped to a SINGLE OCR LINE containing both the label and "NN mmHg".
    // On heavily-scrambled scans the resting BP token is often detached from its
    // label; requiring same-line adjacency means we emit ABSENT rather than a
    // wrong value borrowed from another phase's row (the paired .ans supplies
    // resting BP reliably regardless).
    SBP: lineScopedBp(pages, resting, /Systolic\s+Blood\s+Pressure/i, "mmHg", (v) => v >= 40 && v <= 260),
    DBP: lineScopedBp(pages, resting, /Diastolic\s+Blood\s+Pressure/i, "mmHg", (v) => v >= 20 && v <= 160),
  };

  // ---- Time-domain (Ewing) ratios ----
  // Header block on the Multi-Parameter Graphical + Time Domain pages:
  //   "E/I Ratio : 1.21 (Normal: > 1.094)" etc. OCR sometimes renders "Ell"/"EnRatio".
  const ratios: VendorRatios = {
    eiRatio: numField(pages, text, new RegExp(String.raw`E[/nl]{0,2}I?\s*Ratio\s*:?\s*${NUM}`, "i"), null, 2),
    valsalvaRatio: numField(pages, text, new RegExp(String.raw`Valsalva\s*Ratio\s*:?\s*${NUM}`, "i"), null, 2),
    thirtyFifteenRatio: numField(pages, text, new RegExp(String.raw`30\s*:?\s*15\s*Ratio\s*:?\s*${NUM}`, "i"), null, 2),
  };

  // Aggregate confidence / counts across the numeric+string fields we read.
  const allFields: Array<VendorField<any>> = [
    identity.age, identity.bmi, identity.ectopicBeats,
    identity.patientName, identity.testDate, identity.physician, identity.dob, identity.sex,
    baseline.meanHR, baseline.rangeHR, baseline.LFa, baseline.RFa, baseline.SB,
    baseline.FRF, baseline.SBP, baseline.DBP,
    ratios.eiRatio, ratios.valsalvaRatio, ratios.thirtyFifteenRatio,
  ];
  const present = allFields.filter((f) => f.value != null && f.provenance != null);
  const fieldCount = present.length;
  const meanConfidence =
    present.length > 0
      ? present.reduce((s, f) => s + (f.provenance!.confidence ?? 0), 0) / present.length
      : 0;

  if (looksLikeVendorReport && fieldCount === 0) {
    notes.push("Report recognized but no fields could be read confidently (low OCR quality).");
  }

  return { looksLikeVendorReport, identity, baseline, ratios, meanConfidence, fieldCount, notes };
}

/**
 * Wrap plain text-layer output as a single synthetic OcrPage so the same
 * structured parser can run on text PDFs (confidence 100, no word geometry).
 */
export function textToPages(text: string): OcrPage[] {
  return [{ page: 1, text, confidence: 100, words: [], width: 0, height: 0 }];
}

/**
 * Flatten an extraction to the legacy `VendorReportedMetrics`-style scalar map
 * that api/upload.ts consumes for the paired-report spectral override. Only the
 * baseline spectral + BP fields drive that override; ratios travel separately.
 */
export function extractionToBaselineMetrics(x: VendorReportExtraction): {
  LFa?: number;
  RFa?: number;
  SB?: number;
  SBP?: number;
  DBP?: number;
} {
  const out: { LFa?: number; RFa?: number; SB?: number; SBP?: number; DBP?: number } = {};
  if (x.baseline.LFa.value != null) out.LFa = x.baseline.LFa.value;
  if (x.baseline.RFa.value != null) out.RFa = x.baseline.RFa.value;
  if (x.baseline.SB.value != null) out.SB = x.baseline.SB.value;
  if (x.baseline.SBP.value != null) out.SBP = x.baseline.SBP.value;
  if (x.baseline.DBP.value != null) out.DBP = x.baseline.DBP.value;
  return out;
}
