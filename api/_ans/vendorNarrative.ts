/**
 * api/_ans/vendorNarrative.ts
 *
 * Extractor for the NARRATIVE style of Physio P&S vendor documents — the
 * "Diagnostic Implication Summary" report and the Colombo consultation letter.
 * Unlike the numerical-summary page (a tabular A–F grid parsed by
 * vendorOcrParse), these documents state findings in prose, e.g.:
 *   "Normal HR and Normal BP"
 *   "Normal sympathetic modulation (LFa)"
 *   "Borderline low parasympathetic modulation (RFa)"
 *   "High Normal sympathovagal balance (SB = LFa/RFa)"
 *   "High sympathetic response to stand suggesting a possible risk of pre-syncope"
 *   "Sympathovagal Balance (SB = 2.59)"
 *
 * CONTRACT: we extract ONLY what is printed. Qualitative findings are captured
 * as vendor-reported CATEGORICAL findings (never converted to invented numbers);
 * a numeric value is captured only when the vendor actually printed one (e.g.
 * SB = 2.59). Nothing is guessed or inferred. Pure text→findings; unit-testable.
 *
 * Generalizes beyond any single patient: matching is label/keyword based, never
 * keyed on a patient name, date, or file hash.
 */

export type FindingClass =
  | "normal"
  | "borderline-low"
  | "borderline-high"
  | "low"
  | "high"
  | "high-normal"
  | "abnormal"
  | "present";

export interface VendorFinding {
  /** Stable key for the finding, e.g. "baseline.lfa", "stand.sympathetic". */
  key: string;
  /** Phase bucket for grouping in the UI. */
  phase: "baseline" | "deep_breathing_valsalva" | "stand" | "overall";
  /** Human-readable label, verbatim-ish from the vendor. */
  label: string;
  /** Categorical classification the vendor stated. */
  classification: FindingClass;
  /** The exact printed sentence/snippet this came from (provenance). */
  sourceText: string;
}

export interface VendorNarrativeExtraction {
  findings: VendorFinding[];
  /** Numeric values the vendor PRINTED in prose (e.g. SB = 2.59). */
  printedNumbers: Array<{ key: "SB" | "LFa" | "RFa"; value: number; sourceText: string }>;
  /** True if the text reads like a P&S / ANS vendor narrative. */
  looksLikeVendorNarrative: boolean;
}

const NUM = String.raw`(-?\d+(?:\.\d+)?)`;

/** Collapse OCR whitespace/newlines so multiline sentences match. */
function normalize(text: string): string {
  return text.replace(/\r/g, " ").replace(/\n+/g, " ").replace(/\s{2,}/g, " ");
}

/** Classify a modulation phrase like "Borderline low", "High Normal", "Normal". */
function classifyPhrase(phrase: string): FindingClass | null {
  const p = phrase.toLowerCase().trim();
  if (/high[\s-]*normal/.test(p)) return "high-normal";
  if (/borderline\s+low/.test(p)) return "borderline-low";
  if (/borderline\s+high/.test(p)) return "borderline-high";
  if (/\bnormal\b/.test(p)) return "normal";
  if (/\blow\b/.test(p)) return "low";
  if (/\bhigh\b/.test(p)) return "high";
  if (/\babnormal\b/.test(p)) return "abnormal";
  return null;
}

/**
 * Extract categorical findings + any printed numbers from vendor narrative text.
 * Works on OCR'd summary text and on the letter prose.
 */
export function extractVendorNarrative(rawText: string): VendorNarrativeExtraction {
  const text = normalize(rawText);
  const findings: VendorFinding[] = [];
  const printedNumbers: VendorNarrativeExtraction["printedNumbers"] = [];

  const looksLikeVendorNarrative =
    /(autonomic|sympathovagal|parasympathetic|sympathetic modulation|LFa|RFa|P&S|Colombo|ANS)/i.test(text);
  if (!looksLikeVendorNarrative) {
    return { findings: [], printedNumbers: [], looksLikeVendorNarrative: false };
  }

  const push = (
    key: string,
    phase: VendorFinding["phase"],
    label: string,
    m: RegExpExecArray | null,
    classPhraseGroup = 1,
  ) => {
    if (!m) return;
    const cls = classifyPhrase(m[classPhraseGroup] ?? "");
    if (!cls) return;
    findings.push({ key, phase, label, classification: cls, sourceText: m[0].trim().slice(0, 160) });
  };

  // --- Baseline modulation (LFa / RFa) ---
  push("baseline.lfa", "baseline", "Resting sympathetic modulation (LFa)",
    new RegExp(String.raw`([\w\s-]{0,18})\s+sympathetic modulation\s*\(?\s*LFa`, "i").exec(text));
  push("baseline.rfa", "baseline", "Resting parasympathetic modulation (RFa)",
    new RegExp(String.raw`([\w\s-]{0,18})\s+parasympathetic modulation\s*\(?\s*RFa`, "i").exec(text));

  // --- Sympathovagal balance (categorical + optional printed number) ---
  const sbCat = new RegExp(String.raw`([\w\s-]{0,14})\s+sympathovagal\s+balance`, "i").exec(text);
  push("baseline.sb", "baseline", "Resting sympathovagal balance (SB)", sbCat);
  const sbNum = new RegExp(String.raw`sympathovagal\s+balance[^\d-]{0,20}${NUM}`, "i").exec(text)
    || new RegExp(String.raw`\bSB\s*=\s*${NUM}`, "i").exec(text);
  if (sbNum) {
    const v = parseFloat(sbNum[1]);
    if (Number.isFinite(v)) printedNumbers.push({ key: "SB", value: v, sourceText: sbNum[0].trim() });
  }

  // --- Baseline HR & BP (categorical only — vendor states "Normal HR and Normal BP") ---
  const hrbp = /Normal HR and Normal BP/i.exec(text);
  if (hrbp) {
    findings.push({ key: "baseline.hr", phase: "baseline", label: "Resting heart rate", classification: "normal", sourceText: hrbp[0] });
    findings.push({ key: "baseline.bp", phase: "baseline", label: "Resting blood pressure", classification: "normal", sourceText: hrbp[0] });
  }

  // --- Deep breathing / Valsalva ---
  if (/All ANS responses within normal ranges/i.test(text)) {
    findings.push({ key: "db.responses", phase: "deep_breathing_valsalva", label: "DB/Valsalva ANS responses", classification: "normal", sourceText: "All ANS responses within normal ranges" });
  }
  const dbHr = /Abnormal changes in HR\s*\(from baseline to DB\)/i.exec(text);
  if (dbHr) {
    findings.push({ key: "db.hr_change", phase: "deep_breathing_valsalva", label: "HR change (baseline→DB)", classification: "abnormal", sourceText: dbHr[0] });
  }

  // --- Stand: high sympathetic response / pre-syncope ---
  const standSymp = /High sympathetic response to stand/i.exec(text);
  if (standSymp) {
    findings.push({ key: "stand.sympathetic", phase: "stand", label: "Sympathetic response to stand", classification: "high", sourceText: standSymp[0] });
  }
  if (/pre-?syncope/i.test(text)) {
    const ps = /[^.]*pre-?syncope[^.]*\./i.exec(text);
    findings.push({ key: "stand.presyncope", phase: "stand", label: "Pre-syncope risk", classification: "present", sourceText: (ps?.[0] ?? "possible risk of pre-syncope").trim().slice(0, 160) });
  }

  return { findings, printedNumbers, looksLikeVendorNarrative };
}
