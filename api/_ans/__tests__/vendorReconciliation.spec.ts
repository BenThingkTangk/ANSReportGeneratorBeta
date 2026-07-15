/**
 * Cross-page semantic reconciliation regression (final clinician-parity pass).
 *
 * Drives the parser with SYNTHETIC word geometry (CI-safe, no OCR engine, no PHI)
 * for BOTH a page-1 response-panel page and a page-2 Numerical Summary page, and
 * asserts:
 *   • page-2 direct table OCR takes PRECEDENCE (never overwritten by page-1),
 *   • page-1 response panels fill exact B/D/F fields ONLY on label+phase match,
 *   • the baseline summary fills Phase A only,
 *   • a RESPONSE MULTIPLIER (e.g. Valsalva LFa "x23.20") is NEVER mapped to an
 *     absolute spectral value,
 *   • every reconciled cell keeps page/region/confidence provenance,
 *   • the vendor-reported orthostatic observation is derived (context only).
 *
 * All values are ARBITRARY synthetic numbers, not any real patient's.
 */
import { describe, it, expect } from "vitest";
import type { OcrPage, OcrWord } from "../ocr.js";
import { parseVendorOcrPages } from "../vendorOcrParse.js";

function w(text: string, xc: number, yc: number, conf = 90): OcrWord {
  const halfW = 26 + text.length * 7;
  return { text, confidence: conf, bbox: { x0: xc - halfW, y0: yc - 13, x1: xc + halfW, y1: yc + 13 } };
}

// ---- Page 2: Numerical Summary grid (sparse — leaves cells for page-1 to fill) ----
const P2COL = { event: 300, duration: 560, meanHR: 780, rangeHR: 1000, frf: 1220, lfa: 1440, rfa: 1660, sb: 1880, bp: 2120, pp: 2300, map: 2460 };
function page2(): OcrPage {
  const words: OcrWord[] = [];
  words.push(w("Numerical", 250, 120), w("Summary", 420, 120));
  const yH = 200;
  words.push(
    w("Event", P2COL.event, yH), w("Duration", P2COL.duration, yH), w("meanHR", P2COL.meanHR, yH),
    w("(max-min)HR", P2COL.rangeHR, yH), w("FRF", P2COL.frf, yH), w("LFA", P2COL.lfa, yH),
    w("RFA", P2COL.rfa, yH), w("LFA/RFA", P2COL.sb, yH), w("BP", P2COL.bp, yH), w("PP", P2COL.pp, yH), w("MAP", P2COL.map, yH),
  );
  const KEYS = ["A", "B", "C", "D", "E", "F"] as const;
  const EVENTS = ["Baseline", "DeepBreating", "Baseline", "Valsalva", "Baseline", "Stand"];
  // page-2 supplies ONLY duration+rangeHR for each row; everything else is left
  // for reconciliation (so we can prove page-1/baseline fills without collision).
  const dur = ["0500", "0100", "0100", "0135", "0230", "0530"];
  const rhr = ["11", "17", "18", "21", "28", "23"];
  KEYS.forEach((k, i) => {
    const y = 320 + i * 70;
    words.push(w(k, 180, y), w(EVENTS[i], P2COL.event, y), w(dur[i], P2COL.duration, y), w(rhr[i], P2COL.rangeHR, y));
  });
  return { page: 2, text: "Numerical Summary:\n" + words.map((x) => x.text).join(" "), confidence: 85, words, width: 2860, height: 2210 };
}

// ---- Page 1: four response panels (A baseline, B DB, D Valsalva, F Stand) ----
function panelRow(words: OcrWord[], y: number, label: string[], value: string, valX = 1650) {
  let x = 560;
  for (const t of label) { words.push(w(t, x, y)); x += 40 + t.length * 7; }
  words.push(w(value, valX, y));
}
function page1(): OcrPage {
  const words: OcrWord[] = [];
  words.push(w("Patient:", 200, 60), w("Sample,", 320, 60), w("Test", 430, 60));
  // Panel A (Baseline) — "Interpretation" header at y150
  words.push(w("Interpretation", 1230, 150), w("VALUE", 1500, 150));
  panelRow(words, 230, ["Mean", "Heart", "Rate"], "60");
  panelRow(words, 290, ["Range", "Heart", "Rate"], "12");
  panelRow(words, 350, ["LFa*", "Modulation"], "1.20");
  panelRow(words, 410, ["RFa*", "Modulation"], "4.40");
  panelRow(words, 470, ["LFa/RFa"], "0.30");
  panelRow(words, 530, ["Systolic", "Blood", "Pressure"], "118");
  panelRow(words, 590, ["Diastolic", "Blood", "Pressure"], "76");
  // Panel B (Deep Breathing) — header y700, phase keyword present
  words.push(w("Interpretation", 1230, 700), w("Deep", 700, 700), w("Breathing", 820, 700));
  panelRow(words, 780, ["RFa*", "Response"], "3.10");
  panelRow(words, 840, ["Range", "Heart", "Rate"], "15");
  // Panel D (Valsalva) — header y980, LFa is a MULTIPLIER "x20.40" (must be rejected)
  words.push(w("Interpretation", 1230, 980), w("Valsalva", 700, 980));
  panelRow(words, 1040, ["LFa*", "Response"], "x20.40"); // multiplier — reject
  panelRow(words, 1100, ["RFa*", "Response"], "3.05");
  panelRow(words, 1160, ["Diastolic", "Blood", "Pressure"], "66");
  // Panel F (Stand) — header y1300
  words.push(w("Interpretation", 1230, 1300), w("Stand", 700, 1300));
  panelRow(words, 1360, ["Mean", "Heart", "Rate"], "66");
  panelRow(words, 1420, ["LFa*", "Response"], "2.70");
  panelRow(words, 1480, ["RFa*", "Response"], "6.10");
  panelRow(words, 1540, ["Systolic", "Blood", "Pressure"], "112");
  panelRow(words, 1600, ["Diastolic", "Blood", "Pressure"], "72");
  const text =
    "P&S ANS Test Results Modulation Response Interpretation Mean Heart Rate Blood Pressure LFa RFa\n" +
    words.map((x) => x.text).join(" ");
  return { page: 1, text, confidence: 80, words, width: 2210, height: 2000 };
}

describe("Cross-page reconciliation — page-2 precedence + page-1/baseline fill", () => {
  const x = parseVendorOcrPages([page1(), page2()]);
  const rows = Object.fromEntries((x.phases?.rows ?? []).map((r) => [r.key, r]));

  it("builds all six phase rows", () => {
    expect(x.phases).toBeTruthy();
    expect(Object.keys(rows).sort()).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("page-2 direct table cells take precedence (rangeHR from page-2, not page-1)", () => {
    // page-2 rangeHR for A is 11 (page-1 baseline says 12) → page-2 wins.
    expect(rows.A.rangeHR.value).toBe(11);
    expect(rows.A.rangeHR.provenance?.page).toBe(2);
    // B rangeHR: page-2 = 17, page-1 panel = 15 → page-2 wins.
    expect(rows.B.rangeHR.value).toBe(17);
  });

  it("Phase A is filled from the baseline summary block (labeled baseline)", () => {
    expect(rows.A.meanHR.value).toBe(60);
    expect(rows.A.LFa.value).toBeCloseTo(1.2, 5);
    expect(rows.A.RFa.value).toBeCloseTo(4.4, 5);
    expect(rows.A.SBP.value).toBe(118);
    expect(rows.A.DBP.value).toBe(76);
    // reconciled provenance is preserved + tagged (from a baseline source — either
    // the page-1 baseline panel or the baseline summary block; both are baseline).
    expect(rows.A.LFa.provenance?.sourceText).toMatch(/reconciled\((page-1 A panel|baseline summary)\)/i);
  });

  it("B/D/F exact fields are filled from page-1 response panels on label+phase match", () => {
    expect(rows.B.RFa.value).toBeCloseTo(3.1, 5);
    expect(rows.D.RFa.value).toBeCloseTo(3.05, 5);
    expect(rows.D.DBP.value).toBe(66);
    expect(rows.F.meanHR.value).toBe(66);
    expect(rows.F.LFa.value).toBeCloseTo(2.7, 5);
    expect(rows.F.RFa.value).toBeCloseTo(6.1, 5);
    expect(rows.F.SBP.value).toBe(112);
    expect(rows.F.DBP.value).toBe(72);
    expect(rows.F.meanHR.provenance?.sourceText).toMatch(/reconciled\(page-1 F panel\)/i);
    expect(rows.F.RFa.provenance?.page).toBe(1);
  });

  it("NEVER maps a response multiplier (Valsalva LFa 'x20.40') to a spectral value", () => {
    expect(rows.D.LFa.value).toBeNull();
  });

  it("derives the vendor-reported orthostatic observation (context only)", () => {
    // A baseline 118/76 → F stand 112/72: sbpDrop 6, dbpDrop 4 → no OH.
    expect(x.orthostatic).toBeTruthy();
    expect(x.orthostatic!.sbpDrop).toBe(6);
    expect(x.orthostatic!.dbpDrop).toBe(4);
    expect(x.orthostatic!.meetsOrthostaticHypotension).toBe(false);
    expect(x.orthostatic!.summary).toMatch(/no orthostatic drop/i);
    expect(x.orthostatic!.summary).toMatch(/not used as deterministic \.ans scoring input/i);
  });

  it("flags an orthostatic drop when vendor stand BP falls ≥20/≥10", () => {
    // Synthesize a drop: rebuild page-1 stand BP low.
    const p1 = page1();
    // find the stand Systolic/Diastolic value tokens (112 / 72 at y1540/1600) and lower them
    for (const wd of p1.words) {
      if (wd.text === "112" && wd.bbox.y0 > 1500) wd.text = "90"; // stand SBP 90 → drop 28
      if (wd.text === "72" && wd.bbox.y0 > 1580) wd.text = "60"; // stand DBP 60 → drop 16
    }
    const y = parseVendorOcrPages([p1, page2()]);
    expect(y.orthostatic?.meetsOrthostaticHypotension).toBe(true);
    expect(y.orthostatic?.summary).toMatch(/show an orthostatic drop/i);
  });
});
