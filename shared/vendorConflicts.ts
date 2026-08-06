/**
 * shared/vendorConflicts.ts
 *
 * DISAGREEMENTS BETWEEN VENDOR DOCUMENTS — surfaced, never silently resolved.
 *
 * WHY: the Alex Pare audit found that the vendor's P&S report page 3 says
 * "Re-test in 6 months to follow up" while the vendor clinician's letter says
 * "Retest in three (3) months". HumanOS adopted 6 months verbatim and never told
 * the clinician the two vendor documents disagreed. Picking a winner between two
 * vendor recommendations is a clinical decision this tool must not make.
 *
 * This module only READS vendor text. It never invents a recommendation, never
 * averages the two, and never chooses. When it finds more than one distinct
 * value it returns a conflict for the UI to display side by side.
 *
 * Pure: no I/O, no clock.
 */

export interface VendorDocumentText {
  /** Human-readable source label, e.g. "P&S report (page 3)" or "Clinician letter". */
  source: string;
  /** Extracted text for that document. May be OCR output. */
  text: string;
}

export interface VendorConflict {
  field: string;
  values: Array<{ value: string; source: string }>;
  message: string;
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/**
 * Every retest interval a vendor document recommends, in months, de-duplicated.
 *
 * Handles the digit form ("re-test in 6 months"), the spelled form ("Retest in
 * three (3) months") and the week form. OCR garbling that leaves the number
 * unreadable (e.g. "Re-test in & months") yields NO value — we do not guess.
 */
export function extractRetestMonths(text: string | null | undefined): number[] {
  const t = (text ?? "").toLowerCase();
  const found = new Set<number>();
  // "re-test in <n> month(s)" / "retest in three (3) months" / "in 12 weeks"
  const re =
    /\b(?:re-?test|follow[-\s]?up|recheck)\b[^.]{0,60}?\b(?:in|after|at)\s+(?:([a-z]+)\s*(?:\(\s*(\d{1,2})\s*\))?|(\d{1,2}))\s*(month|week)s?\b/g;
  for (const m of t.matchAll(re)) {
    const word = m[1];
    const paren = m[2];
    const digits = m[3];
    let n: number | null = null;
    if (digits) n = parseInt(digits, 10);
    else if (paren) n = parseInt(paren, 10);
    else if (word && WORD_NUMBERS[word] !== undefined) n = WORD_NUMBERS[word];
    if (n == null || !Number.isFinite(n) || n <= 0) continue; // unreadable → no guess
    const months = m[4] === "week" ? Math.round((n / 4.345) * 10) / 10 : n;
    found.add(months);
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * Compare retest recommendations across vendor documents.
 *
 * Returns a conflict ONLY when two or more documents state different intervals.
 * The conflict lists every value with the document it came from and does not
 * indicate a preferred one.
 */
export function detectVendorConflicts(docs: VendorDocumentText[]): VendorConflict[] {
  const conflicts: VendorConflict[] = [];
  const perDoc: Array<{ source: string; months: number }> = [];
  for (const d of docs) {
    for (const m of extractRetestMonths(d.text)) perDoc.push({ source: d.source, months: m });
  }
  const distinct = [...new Set(perDoc.map((x) => x.months))];
  if (distinct.length > 1) {
    conflicts.push({
      field: "followUp.retestInterval",
      values: perDoc.map((x) => ({ value: `${x.months} months`, source: x.source })),
      message:
        "The vendor documents recommend different retest intervals (" +
        perDoc.map((x) => `${x.months} months per ${x.source}`).join("; ") +
        "). Both are shown because choosing between two vendor recommendations is a " +
        "clinical decision this report does not make.",
    });
  }
  return conflicts;
}
