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
import { normalizeUsDate } from "../../shared/vendorExtraction.js";
import type {
  VendorFieldProvenance as FieldProvenance,
  VendorField,
  VendorIdentity,
  VendorBaseline,
  VendorRatios,
  VendorReportExtraction,
  VendorPhaseRow,
  VendorPhaseTable,
  VendorOrthostaticObservation,
} from "../../shared/vendorExtraction.js";

export type {
  VendorField,
  VendorIdentity,
  VendorBaseline,
  VendorRatios,
  VendorReportExtraction,
  VendorPhaseRow,
  VendorPhaseTable,
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

/**
 * Date field: match a date substring and NORMALIZE it to canonical M/D/YYYY so
 * OCR spacing/2-digit-year noise (e.g. "8/ 26/25") doesn't leak into the UI.
 * The verbatim OCR text is preserved in provenance.sourceText for audit; only a
 * value that normalizes is accepted (else absent — never a fabricated date).
 */
function dateField(
  pages: OcrPage[],
  text: string,
  re: RegExp,
  defaultPage = 1,
): VendorField<string> {
  const m = re.exec(text);
  if (!m || m[1] == null) return { value: null, provenance: null };
  const normalized = normalizeUsDate(m[1]);
  if (!normalized) return { value: null, provenance: null };
  return {
    value: normalized,
    provenance: {
      page: defaultPage,
      confidence: pageConfidence(pages, defaultPage),
      sourceText: m[0].trim().slice(0, 80),
    },
  };
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
// Page-2 "Numerical Summary" A–F phase table (geometry-based)
// --------------------------------------------------------------------------

/** Column keys of the vendor's Numerical Summary, in print order. */
type PhaseCol =
  | "duration" | "meanHR" | "rangeHR" | "FRF" | "LFa" | "RFa" | "SB" | "BP" | "PP" | "MAP";

/** Header label recognizers (loose — OCR mangles punctuation/asterisks). */
const PHASE_COL_HEADERS: Array<{ col: PhaseCol; re: RegExp }> = [
  { col: "duration", re: /^Duration$/i },
  { col: "meanHR", re: /mean\s*HR/i },
  { col: "rangeHR", re: /max.?min|\(max/i },
  { col: "FRF", re: /^FRF/i },
  { col: "LFa", re: /^LFA\*?~?$|^LFA$/i },
  { col: "RFa", re: /^RFA\*?~?$|^RFA$/i },
  { col: "SB", re: /LFA\s*\/\s*RFA/i },
  { col: "BP", re: /^BP$/i },
  { col: "PP", re: /^PP$/i },
  { col: "MAP", re: /^MAP$/i },
];

/** Per-column physiological sanity ranges (reject OCR digit-loss / merges). */
const PHASE_COL_SANITY: Record<Exclude<PhaseCol, "duration" | "BP">, (v: number) => boolean> = {
  meanHR: (v) => v >= 25 && v <= 220,
  rangeHR: (v) => v >= 0 && v <= 200,
  FRF: (v) => v >= 0 && v <= 2,
  LFa: (v) => v >= 0 && v <= 500,
  RFa: (v) => v >= 0 && v <= 500,
  SB: (v) => v >= 0 && v <= 100,
  PP: (v) => v >= 5 && v <= 150,
  MAP: (v) => v >= 30 && v <= 200,
};

/**
 * Columns the vendor ALWAYS prints with a decimal point (FRF 0.15, LFa 0.91,
 * RFa 5.13, LFa/RFa 0.18). Requiring a decimal in the OCR token rejects the
 * common flat-raster digit-loss failure ("3.89" → "389") — we emit ABSENT rather
 * than a fabricated integer. Integer columns (HR/rangeHR/PP/MAP) are exempt.
 */
const PHASE_DECIMAL_COLS = new Set<PhaseCol>(["FRF", "LFa", "RFa", "SB"]);

/**
 * Minimum OCR word confidence (0..100) to accept a table cell. The Numerical
 * Summary grid is dense and low-confidence tokens are usually mis-read; a floor
 * keeps only cells we can stand behind, leaving the rest honestly "not read".
 */
const PHASE_CELL_MIN_CONF = 55;

const cx = (w: OcrWord) => (w.bbox.x0 + w.bbox.x1) / 2;
const cy = (w: OcrWord) => (w.bbox.y0 + w.bbox.y1) / 2;

function mkField<T>(value: T | null, w: OcrWord | null, page: number, note: string): VendorField<number | string> {
  if (value == null || !w) return { value: null, provenance: null } as VendorField<any>;
  return {
    value: value as any,
    provenance: {
      page,
      region: w.bbox,
      confidence: clamp01((w.confidence ?? 0) / 100),
      sourceText: note,
    },
  } as VendorField<any>;
}

const emptyRow = (key: VendorPhaseRow["key"], label: string): VendorPhaseRow => ({
  key,
  label,
  duration: { value: null, provenance: null },
  meanHR: { value: null, provenance: null },
  rangeHR: { value: null, provenance: null },
  FRF: { value: null, provenance: null },
  LFa: { value: null, provenance: null },
  RFa: { value: null, provenance: null },
  SB: { value: null, provenance: null },
  SBP: { value: null, provenance: null },
  DBP: { value: null, provenance: null },
  PP: { value: null, provenance: null },
  MAP: { value: null, provenance: null },
});

const PHASE_KEYS: VendorPhaseRow["key"][] = ["A", "B", "C", "D", "E", "F"];
const PHASE_CANON: Record<string, string> = {
  A: "Baseline", B: "Deep Breathing", C: "Baseline", D: "Valsalva", E: "Baseline", F: "Stand",
};

export interface PhaseGrid {
  /** Detected column x-centers (page px). */
  colX: Partial<Record<PhaseCol, number>>;
  /** Row centers with canonical A–F keys (page px). */
  rowYs: Array<{ L: VendorPhaseRow["key"]; y: number }>;
  /** Uniform row pitch (page px). */
  pitch: number;
  /** Column tolerance (page px), resolution-scaled. */
  colTol: number;
}

/**
 * Reconstruct the page-2 "Numerical Summary" grid geometry from OCR word boxes:
 * the header row gives each column's x-center; the A–F phase-label/event anchors
 * give a uniform 6-row layout. Shared by the table parser and the cell-crop
 * refiner in ocr.ts. Returns null when the grid can't be located.
 */
export function computePhaseGrid(page: OcrPage): PhaseGrid | null {
  const words = page.words ?? [];
  const anchor = words.find((w) => /Numerical/i.test(w.text));
  if (!anchor) return null;
  const yTop = anchor.bbox.y1;

  // Header row: the band just below the anchor with the column labels.
  const headerBand = words.filter((w) => w.bbox.y0 > yTop && w.bbox.y0 < yTop + 130);
  const colX: Partial<Record<PhaseCol, number>> = {};
  for (const { col, re } of PHASE_COL_HEADERS) {
    const cand = headerBand
      .filter((w) => re.test(w.text.replace(/[^A-Za-z/()*~-]/g, "")))
      .sort((a, b) => a.bbox.y0 - b.bbox.y0)[0];
    if (cand) colX[col] = cx(cand);
  }
  if (Object.keys(colX).length < 4) return null;

  const headerBottom = Math.max(yTop + 130, ...headerBand.map((w) => w.bbox.y1));
  const labelRightX = (colX.duration ?? Infinity) - 30;
  const EVENT_KEY: Array<{ re: RegExp; key: VendorPhaseRow["key"] }> = [
    { re: /deep\s*brea|despbrea|deepbrea/i, key: "B" },
    { re: /valsalva|vasava|vakava|vesava/i, key: "D" },
    { re: /stand|sand|fosens/i, key: "F" },
  ];
  type Anchor = { key: VendorPhaseRow["key"] | null; y: number };
  const anchors: Anchor[] = [];
  for (const w of words) {
    if (w.bbox.y0 <= headerBottom || w.bbox.y0 > headerBottom + 900) continue;
    if (cx(w) >= labelRightX) continue;
    const t = w.text.trim();
    let key: VendorPhaseRow["key"] | null = null;
    const letter = t.match(/^([A-F])[-_.|]?$/);
    if (letter) key = letter[1] as VendorPhaseRow["key"];
    else {
      const ev = EVENT_KEY.find((e) => e.re.test(t));
      if (ev) key = ev.key;
      else if (!/baseline|baseine|bessie/i.test(t)) continue;
    }
    anchors.push({ key, y: cy(w) });
  }
  if (anchors.length === 0) return null;
  anchors.sort((a, b) => a.y - b.y);

  const keyIdx = (k: VendorPhaseRow["key"]) => PHASE_KEYS.indexOf(k);
  const keyed = anchors.filter((a) => a.key) as Array<{ key: VendorPhaseRow["key"]; y: number }>;
  let pitch = 0, pitchN = 0;
  for (let i = 0; i < keyed.length; i++) {
    for (let j = i + 1; j < keyed.length; j++) {
      const di = keyIdx(keyed[j].key) - keyIdx(keyed[i].key);
      if (di > 0) { pitch += (keyed[j].y - keyed[i].y) / di; pitchN++; }
    }
  }
  if (pitchN === 0) {
    const gaps: number[] = [];
    for (let i = 1; i < anchors.length; i++) {
      const g = anchors[i].y - anchors[i - 1].y;
      if (g > 30 && g < 200) gaps.push(g);
    }
    if (gaps.length) { pitch = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)]; pitchN = 1; }
  }
  if (pitchN === 0 || pitch <= 0) return null;
  pitch = pitch / pitchN;

  let aY = 0, aN = 0;
  for (const a of keyed) { aY += a.y - keyIdx(a.key) * pitch; aN++; }
  if (aN === 0) { aY = anchors[0].y; aN = 1; }
  aY = aY / aN;

  const rowYs = PHASE_KEYS.map((L, i) => ({ L, y: aY + i * pitch })).filter(
    (r) => r.y > headerBottom - pitch && r.y < headerBottom + 900,
  );
  const colTol = Math.round(95 * (page.width / 2860));
  return { colX, rowYs, pitch, colTol };
}

/**
 * Parse the page-2 "Numerical Summary" A–F table using WORD GEOMETRY.
 *
 * Flat-raster OCR scrambles this dense grid when read as text, so we reconstruct
 * it spatially: find the header row to learn each column's x-center, find the A–F
 * phase-label rows to learn each row's y-band, then assign every numeric/BP token
 * to the (row, column) whose bands it falls in — accepting a value only if it
 * passes that column's sanity range. Cells with no confident token stay ABSENT
 * (null) — never guessed. Requires word geometry; text-layer pages (no geometry)
 * return no table.
 */
function parsePhaseTable(pages: OcrPage[]): VendorPhaseTable {
  const empty: VendorPhaseTable = { rows: [], cellCount: 0 };
  // Choose the summary page with word geometry. When ocr.ts appended a high-DPI
  // re-render of the summary page (same page number, larger width), prefer the
  // highest-resolution copy — the dense grid resolves best there.
  const page = pages
    .filter((p) => (p.words?.length ?? 0) > 0 && /Numerical\s*Summary/i.test(p.text ?? ""))
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
  if (!page) return empty;
  const words = page.words;

  const grid = computePhaseGrid(page);
  if (!grid) return empty;
  const { colX, rowYs, pitch, colTol } = grid;
  const halfPitch = pitch / 2;
  const rowBand = (i: number): [number, number] => {
    const y = rowYs[i].y;
    // Tight bands (±0.6·halfPitch) so a token from an adjacent, closely-spaced
    // row is NOT pulled into this one. Rows the vendor prints are ~1 line apart;
    // a generous band cross-contaminates E/F values. Narrow → some cells stay
    // "not read" (honest) rather than mis-assigned (wrong).
    return [y - halfPitch * 0.6, y + halfPitch * 0.6];
  };

  const rows: VendorPhaseRow[] = [];
  let cellCount = 0;

  for (let i = 0; i < rowYs.length; i++) {
    const { L } = rowYs[i];
    const [y0, y1] = rowBand(i);
    const row = emptyRow(L, PHASE_CANON[L] ?? "");
    // candidate tokens for this row band, excluding the label column
    const inRow = words.filter(
      (w) => cy(w) >= y0 && cy(w) <= y1 && cx(w) > (colX.duration ?? 0) - 60,
    );

    const assignNum = (col: Exclude<PhaseCol, "duration" | "BP">) => {
      const center = colX[col];
      if (center == null) return;
      const needsDecimal = PHASE_DECIMAL_COLS.has(col);
      const cands = inRow
        .filter((w) => Math.abs(cx(w) - center) <= colTol)
        .filter((w) => (w.confidence ?? 0) >= PHASE_CELL_MIN_CONF)
        // Decimal columns must contain a decimal point in the raw token, else the
        // token is an OCR digit-merge — reject rather than fabricate.
        .filter((w) => !needsDecimal || /\d[.,]\d/.test(w.text))
        .map((w) => ({ w, v: toNumber(w.text.replace(/[^0-9.,]/g, "")) }))
        .filter((c) => c.v != null && PHASE_COL_SANITY[col](c.v as number))
        .sort((a, b) => Math.abs(cx(a.w) - center) - Math.abs(cx(b.w) - center));
      if (cands.length) {
        (row as any)[col] = mkField(cands[0].v, cands[0].w, page.page, `${L} ${col}: ${cands[0].w.text}`);
        cellCount++;
      }
    };
    for (const c of ["meanHR", "rangeHR", "FRF", "LFa", "RFa", "SB", "PP", "MAP"] as const) assignNum(c);

    // Duration near the duration column. Accept ONLY tokens with unambiguous
    // mm:ss evidence:
    //   • an explicit separator ("2:30", "02.30"), or
    //   • a 4-digit run ("0230" → 02:30, "0100" → 01:00).
    // A 3-digit run ("023") is AMBIGUOUS — it could be 0:23 or a digit-dropped
    // 02:30 — so we do NOT guess (this is the E "023"→"00:23" live defect); it
    // stays not-read. Seconds must be 00–59.
    if (colX.duration != null) {
      const durCands = inRow
        .filter((w) => Math.abs(cx(w) - colX.duration!) <= colTol)
        .sort((a, b) => Math.abs(cx(a) - colX.duration!) - Math.abs(cx(b) - colX.duration!));
      for (const chosen of durCands) {
        const t = chosen.text.trim();
        let mm: string | null = null, ss: string | null = null;
        const sep = t.match(/^(\d{1,2})[:.](\d{2})$/);
        if (sep) {
          mm = sep[1]; ss = sep[2];
        } else {
          const digits = t.replace(/\D/g, "");
          if (digits.length === 4) { mm = digits.slice(0, 2); ss = digits.slice(2); }
          // 3-digit and shorter: insufficient evidence → skip (not-read).
        }
        if (mm != null && ss != null && parseInt(ss, 10) < 60) {
          row.duration = mkField(`${mm.padStart(2, "0")}:${ss}`, chosen, page.page, `${L} duration: ${t}`) as VendorField<string>;
          cellCount++;
          break;
        }
      }
    }

    // BP: "NN/NN" token near the BP column → split into SBP/DBP.
    if (colX.BP != null) {
      const bpTol = colTol + Math.round(40 * (page.width / 2860));
      const bpTok = inRow
        .filter((w) => Math.abs(cx(w) - colX.BP!) <= bpTol && /\d{2,3}\s*\/\s*\d{2,3}|\d{4,6}/.test(w.text))
        .sort((a, b) => Math.abs(cx(a) - colX.BP!) - Math.abs(cx(b) - colX.BP!))[0];
      if (bpTok) {
        const t = bpTok.text.replace(/\s/g, "");
        let sbp: number | null = null, dbp: number | null = null;
        const slash = t.match(/(\d{2,3})\/(\d{2,3})/);
        if (slash) {
          sbp = toNumber(slash[1]); dbp = toNumber(slash[2]);
        } else {
          // OCR merged "92/55" → "9255" or "95750" (95/50 w/ stray). Only split a
          // clean 4-digit token 2+2; anything else stays absent (never guessed).
          const d = t.replace(/\D/g, "");
          if (d.length === 4) { sbp = toNumber(d.slice(0, 2)); dbp = toNumber(d.slice(2)); }
        }
        if (sbp != null && dbp != null && sbp >= 60 && sbp <= 260 && dbp >= 30 && dbp <= 160) {
          row.SBP = mkField(sbp, bpTok, page.page, `${L} SBP: ${bpTok.text}`) as VendorField<number>;
          row.DBP = mkField(dbp, bpTok, page.page, `${L} DBP: ${bpTok.text}`) as VendorField<number>;
          cellCount += 2;
        }
      }
    }

    rows.push(row);
  }

  return { rows, cellCount };
}

// --------------------------------------------------------------------------
// Page-1 response panels → exact per-phase fields (cross-page reconciliation)
// --------------------------------------------------------------------------

/**
 * The signed vendor page-1 stacks four LABELED panels — Initial Baseline (A),
 * Deep Breathing (B), Valsalva (D), Stand (F) — each an "Interpretation / VALUE"
 * block whose rows are explicitly labeled ("Mean Heart Rate", "Range Heart Rate",
 * "LFa* Modulation"/"LFa* Response", "RFa* …", "Systolic/Diastolic Blood
 * Pressure"). We read a field into a phase ONLY when BOTH the row label and the
 * panel (phase) are identifiable from the OCR — never by position alone.
 *
 * CRITICAL SAFETY: the B/D/F panels print SYMPATHETIC/PARASYMPATHETIC RESPONSES,
 * some as MULTIPLIERS ("LFa* Response … x23.20" / "%23.20", "<600% increase").
 * A multiplier is NOT an absolute spectral value, so any token carrying x / % /
 * "increase"/"decrease" context is rejected. Only clean absolute numbers with the
 * expected magnitude are mapped. Requires word geometry (page-1 raster).
 */
type Page1Phase = "A" | "B" | "D" | "F";
type Page1Field = "meanHR" | "rangeHR" | "LFa" | "RFa" | "SB" | "SBP" | "DBP";

interface Page1Cell {
  phase: Page1Phase;
  field: Page1Field;
  value: number;
  word: OcrWord;
  page: number;
  sourceText: string;
}

function parsePage1Panels(pages: OcrPage[]): Page1Cell[] {
  // page 1 = the response-panel page. Prefer a page with word geometry that has
  // the response-panel vocabulary and is NOT the numerical-summary page.
  const page = pages
    .filter(
      (p) =>
        (p.words?.length ?? 0) > 0 &&
        !/Numerical\s*Summary/i.test(p.text ?? "") &&
        /(Modulation|Response|Interpretation)/i.test(p.text ?? "") &&
        /(Mean Heart Rate|Blood Pressure|LFa|RFa)/i.test(p.text ?? ""),
    )
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
  if (!page) return [];
  const words = page.words;

  // --- Panel (phase) bands: each panel starts at an "Interpretation" header. --
  // The vendor prints Interpretation headers in phase order top→bottom. The FIRST
  // panel is Initial Baseline (A); the next three are B, D, F.
  const interpHeaders = words
    .filter((w) => /Interpretation/i.test(w.text))
    .sort((a, b) => a.bbox.y0 - b.bbox.y0);
  // Deduplicate headers within ~40px (OCR sometimes double-detects).
  const headerYs: number[] = [];
  for (const h of interpHeaders) {
    const y = cy(h);
    if (!headerYs.some((yy) => Math.abs(yy - y) < 60)) headerYs.push(y);
  }
  if (headerYs.length < 2) return []; // need at least baseline + one response panel
  headerYs.sort((a, b) => a - b);

  // Map panels to phases by ORDER. The vendor's fixed page-1 sequence is
  // A(Baseline) → B(Deep Breathing) → D(Valsalva) → F(Stand). We also require a
  // corroborating phase keyword within the panel band before trusting B/D/F.
  const PANEL_PHASES: Page1Phase[] = ["A", "B", "D", "F"];
  const panels: Array<{ phase: Page1Phase; top: number; bottom: number }> = [];
  for (let i = 0; i < headerYs.length && i < PANEL_PHASES.length; i++) {
    const top = headerYs[i];
    const bottom = i + 1 < headerYs.length ? headerYs[i + 1] : top + 700;
    panels.push({ phase: PANEL_PHASES[i], top, bottom });
  }

  // Phase-keyword guards: a B/D/F panel is only accepted when the panel band (or
  // the left-margin near it) shows the matching phase word. Baseline (A) is the
  // first panel by construction. This prevents mis-labeling when a header is
  // missed. The left-margin phase names OCR poorly, so we check the WHOLE band.
  const bandText = (top: number, bottom: number) =>
    words.filter((w) => cy(w) >= top - 30 && cy(w) <= bottom).map((w) => w.text).join(" ");
  const PHASE_KW: Record<Page1Phase, RegExp | null> = {
    A: null,
    B: /deep\s*brea|breathing|\bDB\b|Age and Baseline/i, // DB panel prints RFa* Response + "Age and Baseline"
    D: /valsalva|<\s*600%|Increase from Baseline/i,
    F: /\bstand\b|10%\s*but|beats increase/i,
  };

  // Row-label recognizers. Each is anchored on a LEADING token (OCR splits multi-
  // word labels), then the full phrase is confirmed from tokens on the same line.
  // Modulation = baseline; Response = challenge panels — both accepted (the panel
  // band already fixes the phase).
  const ROW_LABELS: Array<{ field: Page1Field; lead: RegExp; phrase: RegExp }> = [
    { field: "meanHR", lead: /^Mean$/i, phrase: /Mean\s+Heart\s+Rate/i },
    { field: "rangeHR", lead: /^Range$/i, phrase: /Range\s+Heart\s+Rate/i },
    { field: "LFa", lead: /^LFa\*?$/i, phrase: /LFa\*?\s*(Modulation|Response)/i },
    { field: "RFa", lead: /^RFa\*?$/i, phrase: /RFa\*?\s*(Modulation|Response)/i },
    { field: "SB", lead: /^LFa\s*\/\s*RFa$/i, phrase: /LFa\s*\/\s*RFa/i },
    { field: "SBP", lead: /^Systolic$/i, phrase: /Systolic\s+Blood\s+Pressure/i },
    { field: "DBP", lead: /^Diastolic$/i, phrase: /Diastolic\s+Blood\s+Pressure/i },
  ];

  // Per-field sanity: absolute-value ranges (reject multipliers/percentages which
  // are far outside these once the x/%/context guard is applied too).
  const SANITY: Record<Page1Field, (v: number) => boolean> = {
    meanHR: (v) => v >= 25 && v <= 220,
    rangeHR: (v) => v >= 0 && v <= 200,
    LFa: (v) => v >= 0 && v <= 500,
    RFa: (v) => v >= 0 && v <= 500,
    SB: (v) => v >= 0 && v <= 100,
    SBP: (v) => v >= 40 && v <= 260,
    DBP: (v) => v >= 20 && v <= 160,
  };
  const DECIMAL_FIELDS = new Set<Page1Field>(["LFa", "RFa", "SB"]);

  const out: Page1Cell[] = [];
  const valueColMinX = 0.55 * (page.width || 1); // values sit in the right value column

  for (const panel of panels) {
    const kw = PHASE_KW[panel.phase];
    if (kw && !kw.test(bandText(panel.top, panel.bottom))) continue; // phase not corroborated

    for (const { field, lead, phrase } of ROW_LABELS) {
      // Find a leading label token in the panel band, then confirm the full phrase
      // from tokens on the same horizontal line (OCR splits "RFa* Response" etc.).
      const leadCand = words
        .filter((w) => cy(w) >= panel.top && cy(w) <= panel.bottom && lead.test(w.text.trim()))
        .sort((a, b) => a.bbox.y0 - b.bbox.y0);
      let labelWord: OcrWord | undefined;
      for (const cand of leadCand) {
        const lineText = words
          .filter((w) => Math.abs(cy(w) - cy(cand)) <= 22 && cx(w) >= cx(cand) - 5)
          .sort((a, b) => cx(a) - cx(b))
          .map((w) => w.text)
          .join(" ");
        if (phrase.test(lineText)) { labelWord = cand; break; }
      }
      if (!labelWord) continue;
      const bandY = cy(labelWord);

      // Candidate value tokens: same horizontal band, in the value column, right
      // of the label. A MULTIPLIER (e.g. Valsalva LFa "x23.20" / "%23.20") is a
      // response ratio, NOT an absolute spectral value — reject a token that
      // itself carries an x/× / % marker, or whose IMMEDIATELY-ADJACENT left token
      // is such a marker. We do NOT reject on a distant "Expected: <600%"
      // annotation elsewhere in the row (that would drop valid values like the DB
      // RFa* Response 2.88).
      const rowWords = words.filter((w) => Math.abs(cy(w) - bandY) <= 26);
      const hasMultiplierMark = (w: OcrWord): boolean => {
        if (/[x×%]/.test(w.text)) return true;
        // adjacent-left token within ~1 char-width carrying a marker
        const left = rowWords
          .filter((o) => o !== w && cx(o) < cx(w) && Math.abs(cy(o) - cy(w)) <= 20)
          .sort((a, b) => cx(b) - cx(a))[0];
        return !!left && /[x×%]$/.test(left.text) && cx(w) - left.bbox.x1 < (w.bbox.x1 - w.bbox.x0);
      };

      const cands = rowWords
        .filter((w) => cx(w) > Math.max(labelWord.bbox.x1, valueColMinX))
        .filter((w) => !hasMultiplierMark(w)) // drop multiplier/percentage tokens
        .map((w) => ({ w, raw: w.text.replace(/[^0-9.,]/g, "") }))
        .filter((c) => c.raw.length > 0)
        .filter((c) => !DECIMAL_FIELDS.has(field) || /\d[.,]\d/.test(c.w.text)) // decimals need a point
        .map((c) => ({ w: c.w, v: toNumber(c.raw) }))
        .filter((c) => c.v != null && SANITY[field](c.v as number))
        .sort((a, b) => cx(a.w) - cx(b.w));

      if (cands.length === 0) continue;
      const chosen = cands[0];
      out.push({
        phase: panel.phase,
        field,
        value: chosen.v as number,
        word: chosen.w,
        page: page.page,
        sourceText: `${labelWord.text} … ${chosen.w.text}`.slice(0, 80),
      });
    }
  }
  return out;
}

/**
 * Cross-page semantic reconciliation: fill phase-table cells the page-2 direct
 * table OCR could not resolve, using (in priority order) the page-1 response
 * panels and the baseline summary block. PAGE-2 DIRECT OCR TAKES PRECEDENCE — we
 * never overwrite a cell page-2 already read. Every reconciled cell keeps its own
 * page/region/confidence provenance and is tagged in sourceText as reconciled.
 * Nothing is inferred or guessed; a field is filled only where its label (and, for
 * B/D/F, its phase) was matched.
 */
function reconcilePhases(
  table: VendorPhaseTable,
  baseline: VendorBaseline,
  page1: Page1Cell[],
): { table: VendorPhaseTable; reconciled: number } {
  if (table.rows.length === 0) return { table, reconciled: 0 };
  const byKey = new Map(table.rows.map((r) => [r.key, r]));
  let reconciled = 0;

  const setIfEmpty = (
    row: VendorPhaseRow | undefined,
    field: Exclude<Page1Field, never>,
    value: number,
    prov: FieldProvenance,
  ) => {
    if (!row) return;
    const cur = (row as any)[field] as VendorField<number> | undefined;
    if (cur && cur.value != null) return; // page-2 (or earlier source) precedence
    (row as any)[field] = { value, unit: cur?.unit ?? null, provenance: prov };
    reconciled++;
  };

  // (2) Page-1 response panels → exact B/D/F (and A) fields.
  for (const c of page1) {
    const row = byKey.get(c.phase);
    setIfEmpty(row, c.field, c.value, {
      page: c.page,
      region: c.word.bbox,
      confidence: clamp01((c.word.confidence ?? 0) / 100),
      sourceText: `reconciled(page-1 ${c.phase} panel): ${c.sourceText}`,
    });
  }

  // (1) Baseline summary block → Phase A only (it is the semantic baseline).
  const A = byKey.get("A");
  if (A) {
    const map: Array<[Page1Field, VendorField<number>]> = [
      ["meanHR", baseline.meanHR],
      ["rangeHR", baseline.rangeHR],
      ["LFa", baseline.LFa],
      ["RFa", baseline.RFa],
      ["SB", baseline.SB],
      ["SBP", baseline.SBP],
      ["DBP", baseline.DBP],
    ];
    for (const [field, f] of map) {
      if (f.value != null && f.provenance != null) {
        setIfEmpty(A, field, f.value, {
          page: f.provenance.page,
          region: f.provenance.region,
          confidence: f.provenance.confidence,
          sourceText: `reconciled(baseline summary): ${f.provenance.sourceText}`,
        });
      }
    }
  }

  const cellCount = table.rows.reduce((n, r) => {
    for (const k of ["duration", "meanHR", "rangeHR", "FRF", "LFa", "RFa", "SB", "SBP", "DBP", "PP", "MAP"] as const) {
      if ((r as any)[k]?.value != null) n++;
    }
    return n;
  }, 0);
  return { table: { rows: table.rows, cellCount }, reconciled };
}

/**
 * Build the vendor-reported orthostatic (baseline→stand) BP observation from the
 * reconciled phase table: Phase A baseline BP vs Phase F stand BP, using only
 * vendor-printed values. Returns undefined unless BOTH arms are present. This is
 * an OBSERVATION for clinician context — explicitly NOT a deterministic .ans
 * scoring input.
 */
function buildOrthostaticObservation(
  table: VendorPhaseTable,
): VendorOrthostaticObservation | undefined {
  const A = table.rows.find((r) => r.key === "A");
  const F = table.rows.find((r) => r.key === "F");
  if (!A || !F) return undefined;
  const bSBP = A.SBP, bDBP = A.DBP, sSBP = F.SBP, sDBP = F.DBP;
  if (bSBP.value == null || bDBP.value == null || sSBP.value == null || sDBP.value == null) {
    return undefined;
  }
  const sbpDrop = bSBP.value - sSBP.value;
  const dbpDrop = bDBP.value - sDBP.value;
  const meets = sbpDrop >= 20 || dbpDrop >= 10;
  const summary = meets
    ? `Vendor-reported baseline and stand BP show an orthostatic drop in this pair ` +
      `(baseline ${bSBP.value}/${bDBP.value} → stand ${sSBP.value}/${sDBP.value} mmHg; ` +
      `Δ ${sbpDrop}/${dbpDrop}). Vendor observation only — not used as deterministic .ans scoring input.`
    : `Vendor-reported baseline and stand BP show no orthostatic drop in this pair ` +
      `(baseline ${bSBP.value}/${bDBP.value} → stand ${sSBP.value}/${sDBP.value} mmHg; ` +
      `Δ ${sbpDrop}/${dbpDrop}, below the ≥20/≥10 mmHg criterion). Vendor observation only — ` +
      `not used as deterministic .ans scoring input.`;
  return {
    baselineSBP: bSBP, baselineDBP: bDBP, standSBP: sSBP, standDBP: sDBP,
    sbpDrop, dbpDrop, meetsOrthostaticHypotension: meets, summary,
  };
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
    testDate: dateField(pages, text, /Test Date:\s*([0-9]{1,2}\s*\/\s*[0-9]{1,2}\s*\/\s*[0-9]{2,4})/i),
    physician: strField(pages, text, /Physician:\s*(Dr\.?\s*[A-Za-z][A-Za-z .'-]{1,40}?)(?:\n|Gender|Height|$)/i),
    dob: dateField(pages, text, /DOB:\s*([0-9]{1,2}\s*\/\s*[0-9]{1,2}\s*\/\s*[0-9]{2,4})/i),
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

  // Per-phase A–F numerical summary (page 2, geometry-based). Absent cells stay
  // null. Only included when at least one cell was read.
  let phaseTable = parsePhaseTable(pages);

  // Cross-page semantic reconciliation: fill cells page-2 could not resolve from
  // the page-1 response panels (exact label+phase match) and the baseline summary
  // (Phase A only). Page-2 direct OCR always takes precedence; every reconciled
  // cell keeps page/region/confidence provenance. Nothing is inferred/guessed.
  if (phaseTable.rows.length > 0) {
    const page1 = parsePage1Panels(pages);
    const rec = reconcilePhases(phaseTable, baseline, page1);
    phaseTable = rec.table;
    if (rec.reconciled > 0) {
      notes.push(
        `Cross-page reconciliation: ${rec.reconciled} phase cell(s) filled from page-1 panels / baseline summary (page-2 table takes precedence).`,
      );
    }
  }

  const phases = phaseTable.cellCount > 0 ? phaseTable : undefined;
  if (phases) {
    notes.push(`Per-phase numerical summary: ${phases.cellCount} cell(s) read across ${phases.rows.length} phase row(s).`);
  }

  // Vendor-reported orthostatic (baseline→stand) BP observation — context only,
  // NOT a deterministic .ans scoring input. Requires BOTH the Phase A baseline BP
  // and Phase F stand BP from vendor-printed values. Resolves the clinician
  // "missing orthostatic BP data" contradiction honestly with explicit provenance.
  const orthostatic = phases ? buildOrthostaticObservation(phases) : undefined;
  if (orthostatic) {
    notes.push(`Vendor-reported orthostatic observation available (baseline vs stand BP; context only, not .ans scoring).`);
  }

  return { looksLikeVendorReport, identity, baseline, ratios, phases, orthostatic, meanConfidence, fieldCount, notes };
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
