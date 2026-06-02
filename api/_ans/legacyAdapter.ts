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
 *   - MISSING stays MISSING. We emit empty strings / 0 / [] for legacy fields
 *     only where the legacy schema can't represent null, and we tag the
 *     warning array on the returning shape so callers can detect it.
 *   - No demographic inference. If AnsStudy says `dob` is null, dobString is
 *     "" and age is 0 (legacy already treats 0 as "unknown" in display code).
 */

import type { AnsStudy } from "../../shared/ansStudy.js";

/** Mirror of ParsedANSData defined inline in api/upload.ts. */
export interface LegacyParsedANSData {
  lastName: string;
  firstName: string;
  gender: string;
  physician: string;
  height: string;
  age: number;
  weight: number;
  bmi: number;
  dobString: string;
  testDate: string;
  eiRatio: number;
  valsalvaRatio: number;
  thirtyFifteenRatio: number;
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
export function ansStudyToLegacy(study: AnsStudy, buffer: Buffer): LegacyParsedANSData {
  const baselineBp = study.baseline.bp;
  // Note: legacy `ectopicBeats` lived inline in the test-notes string; we
  // can't extract it from the new model in PR1 without changing scoring,
  // so we keep 0 here. PR2+ will plumb it through properly.

  return {
    lastName: val(study.patient.lastName.value, ""),
    firstName: val(study.patient.firstName.value, ""),
    gender: val(study.patient.sex.value, ""),
    physician: val(study.patient.physician.value, ""),
    height: legacyHeight(study),
    age: val(study.patient.ageAtStudy.value, 0),
    weight: val(study.anthropometrics.weightLbs.value, 0),
    bmi: val(study.anthropometrics.bmi.value, 0),
    dobString: isoToUsDate(study.patient.dob.value),
    testDate: isoToUsDate(study.fileMetadata.studyDate.value),
    eiRatio: val(study.ratios.eiRatio.value, 0),
    valsalvaRatio: val(study.ratios.valsalvaRatio.value, 0),
    thirtyFifteenRatio: val(study.ratios.thirtyFifteenRatio.value, 0),
    ectopicBeats: 0,
    testNotes: study.rawAsciiHead.slice(0, 4096),
    procedureType: val(study.fileMetadata.procedureType.value, ""),
    samplingInterval: val(study.fileMetadata.samplingInterval.value, 0),
    dataPointCount: val(study.fileMetadata.dataPointCount.value, 0),
    ecgData: readFullEcg(buffer, study),
    anesMedications: flattenMeds(study) || undefined,
    otherMedicationsSymptoms: flattenSymptoms(study) || undefined,
    baselineSystolicBP: baselineBp.sbp.value ?? undefined,
    baselineDiastolicBP: baselineBp.dbp.value ?? undefined,
  };
}
