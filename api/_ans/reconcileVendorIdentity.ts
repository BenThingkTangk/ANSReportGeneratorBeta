/**
 * api/_ans/reconcileVendorIdentity.ts
 *
 * SAFETY-CRITICAL: before any vendor-PDF metric (LFa/RFa/SB/BP) is spliced onto
 * a patient's report, the vendor PDF's identity MUST match the parsed .ans.
 * Otherwise Patient B's signed PDF uploaded alongside Patient A's .ans would
 * render B's sympathovagal balance / BP / therapy pathway as A's report, under
 * a "vendor-reported" trust badge.
 *
 * This module performs a normalized match on patient name + study date (and DOB
 * when the vendor supplies it). It is deliberately STRICT: a mismatch, or a
 * vendor payload that omits the identity entirely, returns `ok: false` so the
 * caller drops the metrics and surfaces a warning — it NEVER silently overrides.
 *
 * Matching is normalization-based, not fuzzy: we do not want to accept a
 * near-miss on a different patient. Name comparison is order-insensitive
 * (Last,First vs First Last) and case/whitespace/punctuation-insensitive; date
 * comparison is calendar-day based across the common M/D/YYYY and YYYY-MM-DD
 * encodings.
 */

/** Minimal identity the vendor payload may carry (all optional strings). */
export interface VendorIdentityInput {
  patientName?: string | null;
  testDate?: string | null;
  dob?: string | null;
}

/** The parsed .ans identity we reconcile against. */
export interface StudyIdentity {
  firstName?: string | null;
  lastName?: string | null;
  /** Legacy US M/D/YYYY string (ansStudyToLegacy `testDate`). */
  testDate?: string | null;
  /** Legacy US M/D/YYYY string (ansStudyToLegacy `dobString`). */
  dob?: string | null;
}

export interface ReconcileResult {
  ok: boolean;
  /** Per-field match detail for logging / UI (null = not comparable). */
  checks: {
    name: boolean | null;
    testDate: boolean | null;
    dob: boolean | null;
  };
  /** Human-readable reason when ok=false. */
  reason?: string;
}

/** Lowercase, strip punctuation, collapse whitespace, sort tokens so name order
 *  and "Last, First" vs "First Last" compare equal. */
function normNameKey(s: string): string {
  const tokens = s
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    // Drop common honorifics/titles so "Dr." etc. never skew the comparison.
    .filter((t) => !["dr", "mr", "mrs", "ms", "mx"].includes(t));
  return tokens.sort().join(" ");
}

/** Parse a date string (M/D/YYYY, MM/DD/YYYY, or YYYY-MM-DD) to a calendar key
 *  YYYY-M-D, or null if unparseable. Two-digit years are windowed to 1930–2029. */
function normDateKey(s: string): string | null {
  const t = s.trim();
  let y: number, mo: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const us = /^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})$/.exec(t);
  if (iso) {
    y = +iso[1]; mo = +iso[2]; d = +iso[3];
  } else if (us) {
    mo = +us[1]; d = +us[2]; y = +us[3];
    if (y < 100) y += y >= 30 ? 1900 : 2000;
  } else {
    return null;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${mo}-${d}`;
}

/**
 * Reconcile vendor identity against the parsed study identity.
 *
 * Rules:
 *   - Name and study date are REQUIRED to match. If either is missing on the
 *     vendor side or the study side, or they disagree, ok=false.
 *   - DOB is checked only when BOTH sides supply it; a DOB disagreement is a
 *     hard fail. A missing DOB on either side is not (many .ans lack a clean
 *     DOB, and de-identified files shift it).
 */
export function reconcileVendorIdentity(
  vendor: VendorIdentityInput | null | undefined,
  study: StudyIdentity,
): ReconcileResult {
  const checks: ReconcileResult["checks"] = { name: null, testDate: null, dob: null };

  if (!vendor) {
    return {
      ok: false,
      checks,
      reason:
        "Vendor metrics arrived without any identifying metadata (patient name / study date); cannot confirm they belong to this study.",
    };
  }

  // --- Name (required) ---
  const studyName = [study.firstName, study.lastName].filter(Boolean).join(" ").trim();
  const vendorName = (vendor.patientName ?? "").trim();
  if (!studyName || !vendorName) {
    checks.name = false;
    return {
      ok: false,
      checks,
      reason: "Patient name missing on the vendor report or the .ans study; cannot reconcile identity.",
    };
  }
  checks.name = normNameKey(studyName) === normNameKey(vendorName);

  // --- Study date (required) ---
  const studyDateKey = study.testDate ? normDateKey(study.testDate) : null;
  const vendorDateKey = vendor.testDate ? normDateKey(vendor.testDate) : null;
  if (!studyDateKey || !vendorDateKey) {
    checks.testDate = false;
    return {
      ok: false,
      checks,
      reason: "Study date missing or unparseable on the vendor report or the .ans study; cannot reconcile identity.",
    };
  }
  checks.testDate = studyDateKey === vendorDateKey;

  // --- DOB (checked only when both present) ---
  const studyDob = study.dob ? normDateKey(study.dob) : null;
  const vendorDob = vendor.dob ? normDateKey(vendor.dob) : null;
  if (studyDob && vendorDob) {
    checks.dob = studyDob === vendorDob;
  }

  const nameOk = checks.name === true;
  const dateOk = checks.testDate === true;
  const dobOk = checks.dob !== false; // null (not compared) is acceptable

  if (nameOk && dateOk && dobOk) {
    return { ok: true, checks };
  }

  const failed: string[] = [];
  if (!nameOk) failed.push(`patient name ("${vendorName}" vs "${studyName}")`);
  if (!dateOk) failed.push(`study date (${vendor.testDate} vs ${study.testDate})`);
  if (checks.dob === false) failed.push(`date of birth (${vendor.dob} vs ${study.dob})`);
  return {
    ok: false,
    checks,
    reason: `Vendor report identity does not match the uploaded .ans: ${failed.join("; ")}. Vendor values were NOT applied.`,
  };
}
