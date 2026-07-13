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

  const anchor = words.find((w) => /Numerical/i.test(w.text));
  if (!anchor) return empty;
  const yTop = anchor.bbox.y1;

  // --- Header row: the band just below the anchor with the column labels. -----
  const headerBand = words.filter((w) => w.bbox.y0 > yTop && w.bbox.y0 < yTop + 130);
  const colX: Partial<Record<PhaseCol, number>> = {};
  for (const { col, re } of PHASE_COL_HEADERS) {
    // Prefer a header token matching the column label; take the closest to yTop.
    const cand = headerBand
      .filter((w) => re.test(w.text.replace(/[^A-Za-z/()*~-]/g, "")))
      .sort((a, b) => a.bbox.y0 - b.bbox.y0)[0];
    if (cand) colX[col] = cx(cand);
  }
  // Need at least the spectral columns + BP to be worth building a table.
  const haveCols = Object.keys(colX).length;
  if (haveCols < 4) return empty;

  // --- Row bands: anchor each A–F row on its phase LETTER or its EVENT LABEL. --
  // OCR frequently mangles the isolated A–F letters and drops row A (merged into
  // the header). So we collect row anchors from BOTH the letter column and the
  // recognizable event-label words, dedupe by y, then assign canonical A–F keys
  // by vertical order. The vendor always prints exactly six rows in the fixed
  // sequence A(Baseline) B(Deep Breathing) C(Baseline) D(Valsalva) E(Baseline)
  // F(Stand); we label by position, not by trusting the mangled letter.
  const headerBottom = Math.max(yTop + 130, ...headerBand.map((w) => w.bbox.y1));
  const labelRightX = (colX.duration ?? Infinity) - 30;
  const KEYS: VendorPhaseRow["key"][] = ["A", "B", "C", "D", "E", "F"];
  const CANON: Record<string, string> = {
    A: "Baseline", B: "Deep Breathing", C: "Baseline", D: "Valsalva", E: "Baseline", F: "Stand",
  };
  // Event-label recognizers keyed to the phase they identify (used to anchor the
  // uniform 6-row grid even when the isolated A–F letters OCR poorly).
  const EVENT_KEY: Array<{ re: RegExp; key: VendorPhaseRow["key"] }> = [
    { re: /deep\s*brea|despbrea|deepbrea/i, key: "B" },
    { re: /valsalva|vasava|vakava|vesava/i, key: "D" },
    { re: /stand|sand|fosens/i, key: "F" },
  ];
  // Collect anchor observations: (keyGuess|null, y). Letters give a key directly;
  // event labels map via EVENT_KEY. A/C/E "Baseline" labels are ambiguous, so we
  // only use them as generic row markers (key null).
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
      else if (!/baseline|baseine|bessie/i.test(t)) continue; // not a row anchor
    }
    anchors.push({ key, y: cy(w) });
  }
  if (anchors.length === 0) return empty;
  anchors.sort((a, b) => a.y - b.y);

  // Estimate a uniform row pitch from keyed anchors that are N rows apart.
  const keyIdx = (k: VendorPhaseRow["key"]) => KEYS.indexOf(k);
  const keyed = anchors.filter((a) => a.key) as Array<{ key: VendorPhaseRow["key"]; y: number }>;
  let pitch = 0, pitchN = 0;
  for (let i = 0; i < keyed.length; i++) {
    for (let j = i + 1; j < keyed.length; j++) {
      const di = keyIdx(keyed[j].key) - keyIdx(keyed[i].key);
      if (di > 0) { pitch += (keyed[j].y - keyed[i].y) / di; pitchN++; }
    }
  }
  // Fall back to consecutive generic-anchor spacing if no keyed pair exists.
  if (pitchN === 0) {
    const gaps: number[] = [];
    for (let i = 1; i < anchors.length; i++) {
      const g = anchors[i].y - anchors[i - 1].y;
      if (g > 30 && g < 200) gaps.push(g);
    }
    if (gaps.length) { pitch = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)]; pitchN = 1; }
  }
  if (pitchN === 0 || pitch <= 0) return empty;
  pitch = pitch / pitchN;

  // Anchor the grid's row-A y from the best-keyed anchor, then lay out 6 rows at
  // the uniform pitch. Row A center = anchor.y - keyIdx*pitch (averaged).
  let aY = 0, aN = 0;
  for (const a of keyed) { aY += a.y - keyIdx(a.key) * pitch; aN++; }
  if (aN === 0) { aY = anchors[0].y; aN = 1; } // generic: first anchor ≈ row A
  aY = aY / aN;

  const rowYs = KEYS.map((L, i) => ({ L, y: aY + i * pitch }))
    // Keep only rows that fall within the observed table span (guards over-reach).
    .filter((r) => r.y > headerBottom - pitch && r.y < headerBottom + 900);
  const halfPitch = pitch / 2;
  const rowBand = (i: number): [number, number] => {
    const y = rowYs[i].y;
    // Tight bands (±0.6·halfPitch) so a token from an adjacent, closely-spaced
    // row is NOT pulled into this one. Rows the vendor prints are ~1 line apart;
    // a generous band cross-contaminates E/F values. Narrow → some cells stay
    // "not read" (honest) rather than mis-assigned (wrong).
    return [y - halfPitch * 0.6, y + halfPitch * 0.6];
  };

  // Column tolerance scales with render resolution (page width). The grid is
  // ~2860px wide at the 260-DPI base; tolerances were tuned there (~95px) and
  // scale linearly for the high-DPI summary re-render (~6600px → ~220px).
  const colTol = Math.round(95 * (page.width / 2860));
  const rows: VendorPhaseRow[] = [];
  let cellCount = 0;

  for (let i = 0; i < rowYs.length; i++) {
    const { L } = rowYs[i];
    const [y0, y1] = rowBand(i);
    const row = emptyRow(L, CANON[L] ?? "");
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

    // Duration: mm:ss near the duration column (OCR often drops ":" → "0100").
    if (colX.duration != null) {
      const chosen = inRow
        .filter((w) => Math.abs(cx(w) - colX.duration!) <= colTol)
        .filter((w) => /^\d{1,2}[:.]?\d{2}$|^\d{3,4}$/.test(w.text.trim()))
        .sort((a, b) => Math.abs(cx(a) - colX.duration!) - Math.abs(cx(b) - colX.duration!))[0];
      if (chosen) {
        const digits = chosen.text.replace(/\D/g, "");
        if (digits.length === 3 || digits.length === 4) {
          const mm = digits.slice(0, digits.length - 2);
          const ss = digits.slice(-2);
          if (parseInt(ss, 10) < 60) {
            row.duration = mkField(`${mm.padStart(2, "0")}:${ss}`, chosen, page.page, `${L} duration: ${chosen.text}`) as VendorField<string>;
            cellCount++;
          }
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
  const phaseTable = parsePhaseTable(pages);
  const phases = phaseTable.cellCount > 0 ? phaseTable : undefined;
  if (phases) {
    notes.push(`Per-phase numerical summary: ${phases.cellCount} cell(s) read across ${phases.rows.length} phase row(s).`);
  }

  return { looksLikeVendorReport, identity, baseline, ratios, phases, meanConfidence, fieldCount, notes };
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
