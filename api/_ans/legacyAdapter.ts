/**
 * Adapter: AnsStudy -> legacy ParsedANSData shape consumed by the inlined
 * Colombo scoring algorithm in api/upload.ts.
 *
 * Why this exists:
 *   - PR1 introduces a normalized, provenance-rich AnsStudy.
 *   - The existing scoring layer expects the old ParsedANSData object.
 *   - Per the PR1 brief we MUST NOT change scoring yet — so we translate.
 *
 * Hard rules preserved:
 *   - MISSING stays MISSING. Numeric fields that have no safe zero (weight, BMI,
 *     the Ewing ratios) are emitted as `null`, NEVER as 0: a weight of 0 lb is
 *     not a measurement and a ratio of 0.00 would be scored as profoundly
 *     abnormal. Only genuinely additive counters (ectopic beats) use 0.
 *   - No demographic inference. If AnsStudy says `dob` is null, dobString is
 *     "" and age is 0 (legacy already treats 0 as "unknown" in display code).
 */

import type { AnsStudy } from "../../shared/ansStudy.js";
import { parseBinaryHeader } from "./parseBinary.js";
import {
  parseVendorStoredAnalysis,
  type VendorPhaseMetrics,
} from "./vendorStored.js";

/** Mirror of ParsedANSData defined inline in api/upload.ts. */
export interface LegacyEcgQuality {
  snrDb: number | null;
  motionFraction: number | null;
  leadOff: boolean;
  usable: boolean;
  warnings: string[];
}

export interface LegacyParsedANSData {
  lastName: string;
  firstName: string;
  gender: string;
  physician: string;
  height: string;
  age: number;
  /** UNKNOWN IS null, never 0. */
  weight: number | null;
  bmi: number | null;
  dobString: string;
  testDate: string;
  /** UNKNOWN IS null, never 0 (0.00 would classify as severely abnormal). */
  eiRatio: number | null;
  valsalvaRatio: number | null;
  thirtyFifteenRatio: number | null;
  ectopicBeats: number;
  testNotes: string;
  procedureType: string;
  samplingInterval: number;
  dataPointCount: number;
  ecgData: number[];
  anesMedications?: string;
  otherMedicationsSymptoms?: string;
  baselineSystolicBP?: number;
  baselineDiastolicBP?: number;
  /** Exact six-phase PhysioPS analysis summary embedded in supported .ans files. */
  vendorStoredPhases?: VendorPhaseMetrics[];
  ecgQuality?: LegacyEcgQuality;
  /**
   * Seconds past midnight of the earliest real time-of-day stamp found in the
   * file, or `null` when the file carries none. See `deriveStudyClockStartSec`.
   */
  studyClockStartSec?: number | null;
}

/**
 * Recording-start wall clock, derived ONLY from a real parsed time-of-day.
 *
 * WHY THIS IS STRICT: the previous implementation ran a loose
 * `/(\d{1,2}):(\d{2})/` over the ASCII head, which matched the literal "30:15"
 * inside the **30:15 Ratio** label and produced impossible wall clocks such as
 * "30:20:36" on every coupling window. A clock is emitted only when:
 *
 *   1. the match is an unambiguous time-of-day (has an AM/PM suffix, or a
 *      seconds component together with an explicit time label), and
 *   2. the resulting hour/minute/second are individually in range, and
 *   3. the total is < 24 h.
 *
 * We take the EARLIEST qualifying stamp as the recording-start reference. When
 * nothing qualifies we return `null` and every consumer falls back to RELATIVE
 * time — never to a fabricated default clock.
 */
export function deriveStudyClockStartSec(asciiHead: string | null | undefined): number | null {
  const text = asciiHead ?? "";
  const candidates: number[] = [];

  const push = (h: number, m: number, s: number): void => {
    if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return;
    if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) return;
    const total = h * 3600 + m * 60 + s;
    if (total >= 24 * 3600) return;
    candidates.push(total);
  };

  // 1) Unambiguous 12-hour clock with meridiem, e.g. "10:17:37 AM".
  const ampm = /\b(\d{1,2}):([0-5]\d)(?::([0-5]\d))?\s*([AaPp])\.?[Mm]\.?\b/g;
  for (const m of text.matchAll(ampm)) {
    let h = parseInt(m[1], 10);
    if (h < 1 || h > 12) continue; // "30:15 PM" is not a time
    const isPm = m[4].toLowerCase() === "p";
    if (h === 12) h = 0;
    if (isPm) h += 12;
    push(h, parseInt(m[2], 10), parseInt(m[3] ?? "0", 10));
  }

  // 2) Explicitly labelled 24-hour clock, e.g. "Test Time: 13:08:00".
  const labelled = /\b(?:test|study|start|recording|acquisition)\s*(?:time|started|start)?\s*[:=]\s*([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/gi;
  for (const m of text.matchAll(labelled)) {
    push(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3] ?? "0", 10));
  }

  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

/** Convert ISO YYYY-MM-DD to legacy M/D/YYYY format. */
function isoToUsDate(iso: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
}

function val<T>(v: T | null, fallback: T): T {
  return v === null ? fallback : v;
}

/**
 * Materialize the ECG int16 stream from the parsed study + raw buffer.
 * The scoring algorithm needs the full sample array.
 */
function readFullEcg(buffer: Buffer, study: AnsStudy): number[] {
  const offset = study.fileMetadata.dataPointCount.provenance.offset;
  const count = study.fileMetadata.dataPointCount.value;
  if (!count || offset === undefined) return [];
  // dataPointCount provenance.offset points at the count uint32; samples start +4 bytes.
  const dataStart = offset + 4;
  const available = Math.floor((buffer.length - dataStart) / 2);
  const n = Math.min(count, available);
  if (n <= 0) return [];
  const out = new Array<number>(n);
  let pos = dataStart;
  for (let i = 0; i < n; i++) {
    out[i] = buffer.readInt16BE(pos);
    pos += 2;
  }
  return out;
}

/** Best-effort flatten of medications list to the legacy single-string format. */
function flattenMeds(study: AnsStudy): string {
  const meds = study.medications.value;
  if (!meds || meds.length === 0) return "";
  return meds.map((m) => m.raw).join("; ");
}

/** Best-effort flatten of symptoms list to the legacy single-string format. */
function flattenSymptoms(study: AnsStudy): string {
  const sx = study.symptoms.value;
  if (!sx || sx.length === 0) return "";
  return sx.map((s) => s.raw).join("; ");
}

/** Height field: legacy expects "5 ft 11 in" style string. */
function legacyHeight(study: AnsStudy): string {
  const h = study.anthropometrics.heightInches.value;
  if (h === null) return "";
  const ft = Math.floor(h / 12);
  const inches = Math.round(h - ft * 12);
  return `${ft} ft ${inches} in`;
}

/**
 * Public conversion entrypoint.
 *
 * @param study  fully parsed AnsStudy (output of parseStudy)
 * @param buffer original .ans bytes (needed to materialize the full ECG)
 */
/**
 * Ectopic / premature-beat count. Physio PS reports write this as a free-text
 * note (e.g. "1 possible premature beat" / "3 possible ectopic beats"). It is
 * Compatibility fallback for pre-1.1 AnsStudy objects. New parser output
 * carries this as a canonical, provenance-bearing scalar.
 */
function extractEctopicBeats(study: AnsStudy): number {
  const text = study.rawAsciiHead ?? "";
  const m = text.match(/(\d+)\s*possible\s+(?:premature\s+beat|ectop(?:ic)?)/i);
  if (m) {
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function ansStudyToLegacy(study: AnsStudy, buffer: Buffer): LegacyParsedANSData {
  const baselineBp = study.baseline.bp;
  let vendorStoredPhases: VendorPhaseMetrics[] | undefined;
  try {
    const binary = parseBinaryHeader(buffer);
    if (binary.sampling) {
      vendorStoredPhases = parseVendorStoredAnalysis(buffer, binary.sampling).phases;
    }
  } catch {
    // Older, truncated, and unknown-schema files continue through the explicit
    // waveform-derived fallback. Missing stays missing.
  }

  return {
    lastName: val(study.patient.lastName.value, ""),
    firstName: val(study.patient.firstName.value, ""),
    gender: val(study.patient.sex.value, ""),
    physician: val(study.patient.physician.value, ""),
    height: legacyHeight(study),
    age: val(study.patient.ageAtStudy.value, 0),
    // Unknown weight/BMI stay null. `0` here is what produced the audit's
    // "patientData.weight = 0" defect (0 lb is not "unknown").
    weight: study.anthropometrics.weightLbs.value,
    bmi: study.anthropometrics.bmi.value,
    dobString: isoToUsDate(study.patient.dob.value),
    testDate: isoToUsDate(study.fileMetadata.studyDate.value),
    // Unknown ratios stay null: 0.00 would be scored as profoundly abnormal.
    eiRatio: study.ratios.eiRatio.value,
    valsalvaRatio: study.ratios.valsalvaRatio.value,
    thirtyFifteenRatio: study.ratios.thirtyFifteenRatio.value,
    ectopicBeats: study.ectopicBeats?.value ?? extractEctopicBeats(study),
    testNotes: study.rawAsciiHead.slice(0, 4096),
    procedureType: val(study.fileMetadata.procedureType.value, ""),
    samplingInterval: val(study.fileMetadata.samplingInterval.value, 0),
    dataPointCount: val(study.fileMetadata.dataPointCount.value, 0),
    ecgData: readFullEcg(buffer, study),
    anesMedications: flattenMeds(study) || undefined,
    otherMedicationsSymptoms: flattenSymptoms(study) || undefined,
    baselineSystolicBP: baselineBp.sbp.value ?? undefined,
    baselineDiastolicBP: baselineBp.dbp.value ?? undefined,
    vendorStoredPhases,
    ecgQuality: {
      snrDb: study.ecg.quality.snrDb,
      motionFraction: study.ecg.quality.motionFraction,
      leadOff: study.ecg.quality.leadOff,
      usable: study.ecg.quality.usable,
      warnings: [...study.ecg.quality.warnings],
    },
    studyClockStartSec: deriveStudyClockStartSec(study.rawAsciiHead),
  };
}
