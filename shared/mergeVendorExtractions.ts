/**
 * api/_ans/mergeVendorExtractions.ts
 *
 * Cumulative reconciliation of MULTIPLE paired vendor documents for the same
 * study (e.g. Dr. Colombo's SB=2.59 letter + the signed categorical Diagnostic
 * Implication Summary). Combines their evidence into ONE VendorReportExtraction:
 *
 *   • Identity must reconcile (patient name + study date, DOB when both present)
 *     before a document's evidence is merged — mismatches are rejected, never
 *     silently overwritten (delegates to reconcileVendorIdentity).
 *   • Scalar fields: an ABSENT field is filled from a later document; a PRESENT
 *     field is kept and, if a later document disagrees, a CONFLICT is surfaced
 *     (never overwritten).
 *   • Narrative findings + prose-printed numbers are UNIONed (deduped by key),
 *     so the letter's SB=2.59 and the report's 9 categorical findings coexist.
 *   • Every merged field/finding is tagged with its originating filename.
 *
 * Pure and deterministic — unit-testable without a live PDF.
 */
import type {
  VendorReportExtraction,
  VendorField,
  VendorNarrativeFinding,
  VendorMergeConflict,
} from "./vendorExtraction.js";

/** Normalize a name for order/case/punctuation-insensitive comparison. */
function normName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !["dr", "mr", "mrs", "ms", "mx"].includes(t))
    .sort()
    .join(" ");
}

/** Parse M/D/YYYY or YYYY-MM-DD to a calendar key, or null. */
function dateKey(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  let y: number, mo: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const us = /^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})$/.exec(t);
  if (iso) { y = +iso[1]; mo = +iso[2]; d = +iso[3]; }
  else if (us) { mo = +us[1]; d = +us[2]; y = +us[3]; if (y < 100) y += y >= 30 ? 1900 : 2000; }
  else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${mo}-${d}`;
}

interface VendorId { patientName: string | null; testDate: string | null; dob: string | null; }

/**
 * VENDOR-to-VENDOR identity reconciliation for merging two documents of the same
 * study. Requires the patient NAME to match, NO conflicting date/DOB, and at
 * least one corroborating field (same test date OR same DOB). This is
 * intentionally looser than the .ans↔vendor splice guard (a consultation letter
 * often prints DOB but not "Test Date"), but still refuses to merge a different
 * patient or a document whose printed dates conflict.
 */
function reconcileVendorPair(a: VendorId, b: VendorId): { ok: boolean; reason?: string } {
  const an = normName(a.patientName), bn = normName(b.patientName);
  if (!an || !bn) return { ok: false, reason: "patient name missing on one vendor document" };
  if (an !== bn) return { ok: false, reason: `patient name mismatch ("${a.patientName}" vs "${b.patientName}")` };

  const ad = dateKey(a.testDate), bd = dateKey(b.testDate);
  const adob = dateKey(a.dob), bdob = dateKey(b.dob);
  if (ad && bd && ad !== bd) return { ok: false, reason: `study date mismatch (${a.testDate} vs ${b.testDate})` };
  if (adob && bdob && adob !== bdob) return { ok: false, reason: `DOB mismatch (${a.dob} vs ${b.dob})` };

  const testCorroborates = !!(ad && bd && ad === bd);
  const dobCorroborates = !!(adob && bdob && adob === bdob);
  if (!testCorroborates && !dobCorroborates) {
    return { ok: false, reason: "name matches but no corroborating study date or DOB across the documents" };
  }
  return { ok: true };
}

/** A vendor extraction paired with the filename it came from. */
export interface NamedExtraction {
  fileName: string;
  extraction: VendorReportExtraction;
}

export interface MergeResult {
  /** The merged extraction (identity from the first accepted document). */
  merged: VendorReportExtraction;
  /** Files whose identity did NOT reconcile and were therefore excluded. */
  rejected: Array<{ fileName: string; reason: string }>;
  /** Field-level conflicts surfaced during the merge. */
  conflicts: VendorMergeConflict[];
}

function tagField<T>(f: VendorField<T> | undefined, sourceFile: string): VendorField<T> | undefined {
  if (!f || f.value == null) return f;
  return {
    ...f,
    provenance: f.provenance ? { ...f.provenance, sourceFile: f.provenance.sourceFile ?? sourceFile } : null,
  };
}

/**
 * Are two field values EQUIVALENT for conflict purposes? Most fields compare
 * by string, but identity name/date fields must be compared semantically so
 * cosmetic differences ("John Faux" vs "Faux. John", "7/11/2024" vs
 * "2024-07-11") are NOT surfaced as spurious conflicts — reconciliation already
 * treats those as the same patient/study.
 */
function valuesEquivalent(fieldName: string, a: unknown, b: unknown): boolean {
  if (String(a) === String(b)) return true;
  if (fieldName === "identity.patientName") {
    return normName(String(a)) === normName(String(b));
  }
  if (fieldName === "identity.testDate" || fieldName === "identity.dob") {
    const ka = dateKey(String(a)), kb = dateKey(String(b));
    return ka != null && kb != null && ka === kb;
  }
  return false;
}

/** Merge scalar field `b` into `a`: fill-if-absent, conflict-if-different. */
function mergeField<T>(
  a: VendorField<T> | undefined,
  b: VendorField<T> | undefined,
  fieldName: string,
  sourceFile: string,
  conflicts: VendorMergeConflict[],
): VendorField<T> | undefined {
  const bTagged = tagField(b, sourceFile);
  if (!a || a.value == null) return bTagged ?? a;
  if (!bTagged || bTagged.value == null) return a;
  if (valuesEquivalent(fieldName, a.value, bTagged.value)) return a; // same → keep
  // Different values → surface a conflict, keep the FIRST (do not overwrite).
  conflicts.push({
    field: fieldName,
    values: [
      { value: String(a.value), sourceFile: a.provenance?.sourceFile },
      { value: String(bTagged.value), sourceFile },
    ],
  });
  return a;
}

/** Merge every scalar in a nested field-group object. */
function mergeGroup<G extends Record<string, any>>(
  a: G,
  b: G,
  groupName: string,
  sourceFile: string,
  conflicts: VendorMergeConflict[],
): G {
  const out: any = { ...a };
  for (const key of Object.keys(b)) {
    const av = a?.[key];
    const bv = b[key];
    // Only merge VendorField-shaped members ({ value, provenance }).
    if (bv && typeof bv === "object" && "value" in bv) {
      out[key] = mergeField(av, bv, `${groupName}.${key}`, sourceFile, conflicts);
    } else if (av === undefined) {
      out[key] = bv;
    }
  }
  return out as G;
}

/**
 * Merge a list of named vendor extractions into one. The FIRST accepted
 * document seeds identity; subsequent documents must reconcile against it.
 */
export function mergeVendorExtractions(docs: NamedExtraction[]): MergeResult {
  const conflicts: VendorMergeConflict[] = [];
  const rejected: MergeResult["rejected"] = [];
  const accepted: NamedExtraction[] = [];

  // Seed with the first document that looks like a vendor report.
  const [first, ...rest] = docs;
  if (!first) {
    throw new Error("mergeVendorExtractions requires at least one document");
  }
  // Deep clone the seed and tag its provenance with the source filename.
  let merged: VendorReportExtraction = JSON.parse(JSON.stringify(first.extraction));
  tagAllProvenance(merged, first.fileName);
  accepted.push(first);
  const sourceFiles = [first.fileName];

  for (const doc of rest) {
    // Reconcile against the RUNNING merged identity (union of accepted docs), so
    // a seed that printed only DOB can still corroborate a doc that printed only
    // the test date once names match.
    const runningId: VendorId = {
      patientName: merged.identity?.patientName?.value ?? null,
      testDate: merged.identity?.testDate?.value ?? null,
      dob: merged.identity?.dob?.value ?? null,
    };
    const id = doc.extraction.identity;
    const docId: VendorId = {
      patientName: id?.patientName?.value ?? null,
      testDate: id?.testDate?.value ?? null,
      dob: id?.dob?.value ?? null,
    };
    const recon = reconcileVendorPair(runningId, docId);
    if (!recon.ok) {
      rejected.push({ fileName: doc.fileName, reason: recon.reason ?? "identity did not reconcile" });
      continue;
    }
    accepted.push(doc);
    sourceFiles.push(doc.fileName);

    // Merge scalar groups (fill-if-absent, conflict-if-different).
    merged.identity = mergeGroup(merged.identity, doc.extraction.identity, "identity", doc.fileName, conflicts);
    merged.baseline = mergeGroup(merged.baseline, doc.extraction.baseline, "baseline", doc.fileName, conflicts);
    merged.ratios = mergeGroup(merged.ratios, doc.extraction.ratios, "ratios", doc.fileName, conflicts);

    // Prefer a phase table if this document has one and the merged one doesn't.
    if ((!merged.phases || merged.phases.rows.length === 0) && doc.extraction.phases?.rows.length) {
      merged.phases = doc.extraction.phases;
    }
    if (!merged.orthostatic && doc.extraction.orthostatic) merged.orthostatic = doc.extraction.orthostatic;

    // Union narrative findings (dedupe by key; conflict if same key differs).
    mergeNarrative(merged, doc.extraction, doc.fileName, conflicts);

    merged.looksLikeVendorReport = merged.looksLikeVendorReport || doc.extraction.looksLikeVendorReport;
    merged.notes = [...(merged.notes ?? []), ...(doc.extraction.notes ?? [])];
  }

  // Recompute counts across the merged set.
  merged.fieldCount = countFields(merged);
  merged.merged = { sourceFiles, conflicts };

  return { merged, rejected, conflicts };
}

function mergeNarrative(
  merged: VendorReportExtraction,
  doc: VendorReportExtraction,
  sourceFile: string,
  conflicts: VendorMergeConflict[],
): void {
  const mn = merged.narrative ?? { findings: [], printedNumbers: [] };
  const dn = doc.narrative;
  if (!dn) {
    merged.narrative = mn;
    return;
  }
  const byKey = new Map<string, VendorNarrativeFinding>(mn.findings.map((f) => [f.key, f]));
  for (const f of dn.findings) {
    const existing = byKey.get(f.key);
    const tagged: VendorNarrativeFinding = { ...f, sourceFile: f.sourceFile ?? sourceFile };
    if (!existing) {
      byKey.set(f.key, tagged);
    } else if (existing.classification !== f.classification) {
      conflicts.push({
        field: `finding.${f.key}`,
        values: [
          { value: existing.classification, sourceFile: existing.sourceFile },
          { value: f.classification, sourceFile },
        ],
      });
    }
  }
  const numByKey = new Map(mn.printedNumbers.map((n) => [n.key, n]));
  for (const n of dn.printedNumbers) {
    const ex = numByKey.get(n.key);
    if (!ex) numByKey.set(n.key, n);
    else if (ex.value !== n.value) {
      conflicts.push({
        field: `printedNumber.${n.key}`,
        values: [{ value: String(ex.value) }, { value: String(n.value), sourceFile }],
      });
    }
  }
  merged.narrative = {
    findings: [...byKey.values()],
    printedNumbers: [...numByKey.values()],
  };
}

/** Tag every VendorField provenance + narrative finding with the source file. */
function tagAllProvenance(x: VendorReportExtraction, sourceFile: string): void {
  const groups: Array<Record<string, any> | undefined> = [x.identity, x.baseline, x.ratios];
  for (const g of groups) {
    if (!g) continue;
    for (const k of Object.keys(g)) {
      const f = g[k];
      if (f && typeof f === "object" && "value" in f && f.provenance) {
        f.provenance.sourceFile = f.provenance.sourceFile ?? sourceFile;
      }
    }
  }
  if (x.narrative) {
    x.narrative.findings = x.narrative.findings.map((f) => ({ ...f, sourceFile: f.sourceFile ?? sourceFile }));
  }
}

function countFields(x: VendorReportExtraction): number {
  let n = 0;
  for (const g of [x.identity, x.baseline, x.ratios] as Array<Record<string, any>>) {
    if (!g) continue;
    for (const k of Object.keys(g)) {
      const f = g[k];
      if (f && typeof f === "object" && "value" in f && f.value != null) n++;
    }
  }
  // fieldCount is paired with attemptedFieldCount in the clinician badge. Keep
  // both at the same grain: the structured scalar fields the extractor actually
  // attempted. Narrative findings and prose-printed numbers are separate evidence
  // collections and must not inflate this count above its denominator.
  return n;
}
