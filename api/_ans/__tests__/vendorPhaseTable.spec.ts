/**
 * Defect C regression — per-phase A–F Numerical Summary extraction.
 *
 * The vendor's page-2 "Numerical Summary" prints a full A–F grid (Duration,
 * meanHR, rangeHR, FRF, LFa, RFa, LFa/RFa, BP, PP, MAP). The app previously
 * ingested only the baseline + ratios. These tests drive the geometry-based
 * phase-table parser with SYNTHETIC word geometry (CI-safe, no OCR engine, no
 * PHI) laid out like the real grid, and assert:
 *   • every phase row and cell is read at its correct (row, column),
 *   • per-cell provenance (page + region + confidence) is attached,
 *   • cells the "scan" could not resolve are ABSENT (null) — never fabricated,
 *   • decimal-column digit-loss (e.g. "389" for 3.89) is rejected, not accepted.
 *
 * Values here are ARBITRARY synthetic numbers (not any real patient's), so the
 * noRuntimeOracle guard stays satisfied.
 */
import { describe, it, expect } from "vitest";
import type { OcrPage, OcrWord } from "../ocr.js";
import { parseVendorOcrPages } from "../vendorOcrParse.js";

let wid = 0;
function w(text: string, xc: number, yc: number, conf = 90): OcrWord {
  const halfW = 30 + text.length * 8;
  return {
    text,
    confidence: conf,
    bbox: { x0: xc - halfW, y0: yc - 14, x1: xc + halfW, y1: yc + 14 },
  };
}

// Column x-centers (arbitrary but grid-like).
const COL = {
  event: 300, duration: 560, meanHR: 780, rangeHR: 1000, frf: 1220,
  lfa: 1440, rfa: 1660, sb: 1880, bp: 2120, pp: 2300, map: 2460,
};

/** A synthetic vendor page-2 grid. `cells[key]` supplies each row's tokens. */
function buildPage(): OcrPage {
  const words: OcrWord[] = [];
  const yHeader = 200;
  words.push(w("Numerical", 250, 120), w("Summary", 420, 120));
  // Header row
  words.push(
    w("Event", COL.event, yHeader), w("Duration", COL.duration, yHeader),
    w("meanHR", COL.meanHR, yHeader), w("(max-min)HR", COL.rangeHR, yHeader),
    w("FRF", COL.frf, yHeader), w("LFA", COL.lfa, yHeader), w("RFA", COL.rfa, yHeader),
    w("LFA/RFA", COL.sb, yHeader), w("BP", COL.bp, yHeader), w("PP", COL.pp, yHeader),
    w("MAP", COL.map, yHeader),
  );
  // Six data rows, uniform pitch of 70px starting at y=320.
  const pitch = 70;
  const y0 = 320;
  const KEYS = ["A", "B", "C", "D", "E", "F"] as const;
  const EVENTS = ["Baseline", "DeepBreating", "Baseline", "Valsalva", "Baseline", "Stand"];
  // Arbitrary synthetic values per row (NOT any real patient).
  const rowVals: Array<Record<string, string>> = [
    { duration: "0500", meanHR: "60", rangeHR: "12", frf: "0.14", lfa: "1.20", rfa: "4.40", sb: "0.27", bp: "110/70", pp: "40", map: "83" },
    { duration: "0100", meanHR: "61", rangeHR: "15", frf: "0.19", lfa: "8.10", rfa: "3.10", sb: "2.61" }, // B: no BP
    { duration: "0100", meanHR: "62", rangeHR: "13", frf: "0.16", lfa: "2.30", rfa: "3.90", sb: "0.59", bp: "112/68", pp: "44", map: "82" },
    { duration: "0135", meanHR: "63", rangeHR: "18", frf: "0.15", lfa: "20.40", rfa: "3.00", sb: "6.80", bp: "115/66", pp: "49", map: "82" },
    { duration: "0230", meanHR: "64", rangeHR: "22", frf: "0.14", lfa: "1.10", rfa: "4.00", sb: "0.28", bp: "113/64", pp: "49", map: "80" },
    { duration: "0530", meanHR: "66", rangeHR: "24", frf: "0.16", lfa: "2.70", rfa: "6.10", sb: "0.44", bp: "118/72", pp: "46", map: "87" },
  ];
  KEYS.forEach((k, i) => {
    const y = y0 + i * pitch;
    words.push(w(k, 180, y)); // phase letter, left of Duration
    words.push(w(EVENTS[i], COL.event, y));
    const v = rowVals[i];
    if (v.duration) words.push(w(v.duration, COL.duration, y));
    if (v.meanHR) words.push(w(v.meanHR, COL.meanHR, y));
    if (v.rangeHR) words.push(w(v.rangeHR, COL.rangeHR, y));
    if (v.frf) words.push(w(v.frf, COL.frf, y));
    if (v.lfa) words.push(w(v.lfa, COL.lfa, y));
    if (v.rfa) words.push(w(v.rfa, COL.rfa, y));
    if (v.sb) words.push(w(v.sb, COL.sb, y));
    if (v.bp) words.push(w(v.bp, COL.bp, y));
    if (v.pp) words.push(w(v.pp, COL.pp, y));
    if (v.map) words.push(w(v.map, COL.map, y));
  });
  const text = "Multi-Parameter Graphical\nNumerical Summary:\n" + words.map((x) => x.text).join(" ");
  return { page: 2, text, confidence: 85, words, width: 2860, height: 2210 };
}

describe("Defect C — geometry-based A–F phase-table extraction", () => {
  const x = parseVendorOcrPages([buildPage()]);

  it("reads all six phase rows A–F", () => {
    expect(x.phases).toBeTruthy();
    expect(x.phases!.rows.map((r) => r.key)).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("assigns canonical event labels", () => {
    const byKey = Object.fromEntries(x.phases!.rows.map((r) => [r.key, r.label]));
    expect(byKey.A).toBe("Baseline");
    expect(byKey.B).toBe("Deep Breathing");
    expect(byKey.D).toBe("Valsalva");
    expect(byKey.F).toBe("Stand");
  });

  it("extracts each cell at its correct (row, column) with provenance", () => {
    const rows = Object.fromEntries(x.phases!.rows.map((r) => [r.key, r]));
    // Baseline A
    expect(rows.A.meanHR.value).toBe(60);
    expect(rows.A.rangeHR.value).toBe(12);
    expect(rows.A.FRF.value).toBeCloseTo(0.14, 5);
    expect(rows.A.LFa.value).toBeCloseTo(1.2, 5);
    expect(rows.A.RFa.value).toBeCloseTo(4.4, 5);
    expect(rows.A.SB.value).toBeCloseTo(0.27, 5);
    expect(rows.A.SBP.value).toBe(110);
    expect(rows.A.DBP.value).toBe(70);
    expect(rows.A.PP.value).toBe(40);
    expect(rows.A.MAP.value).toBe(83);
    expect(rows.A.duration.value).toBe("05:00");
    // Provenance is attached per cell.
    expect(rows.A.LFa.provenance?.page).toBe(2);
    expect(rows.A.LFa.provenance?.region).toBeTruthy();
    // Valsalva D
    expect(rows.D.LFa.value).toBeCloseTo(20.4, 5);
    expect(rows.D.SBP.value).toBe(115);
    expect(rows.D.DBP.value).toBe(66);
    expect(rows.D.duration.value).toBe("01:35");
    // Stand F
    expect(rows.F.RFa.value).toBeCloseTo(6.1, 5);
    expect(rows.F.SBP.value).toBe(118);
  });

  it("marks genuinely absent cells as not-read (null), never fabricated", () => {
    const B = x.phases!.rows.find((r) => r.key === "B")!;
    // B has no BP/PP/MAP in the source grid.
    expect(B.SBP.value).toBeNull();
    expect(B.DBP.value).toBeNull();
    expect(B.PP.value).toBeNull();
    expect(B.MAP.value).toBeNull();
  });

  it("rejects decimal-column digit-loss rather than fabricating an integer", () => {
    // Rebuild with FRF/RFa tokens that LOST their decimal point ("389" for 3.89).
    const page = buildPage();
    // Corrupt E's RFa token (was "4.00") into "400" (a digit-merge) at RFa col.
    for (const word of page.words) {
      if (word.text === "4.00") word.text = "400";
    }
    const y = parseVendorOcrPages([page]);
    const E = y.phases!.rows.find((r) => r.key === "E")!;
    // "400" has no decimal point → rejected → not read (null), not 400.
    expect(E.RFa.value).toBeNull();
  });

  it("returns no phase table when the page has no word geometry (text layer)", () => {
    const y = parseVendorOcrPages([
      { page: 2, text: "Numerical Summary: Event Duration meanHR", confidence: 100, words: [], width: 0, height: 0 },
    ]);
    expect(y.phases).toBeUndefined();
  });
});
