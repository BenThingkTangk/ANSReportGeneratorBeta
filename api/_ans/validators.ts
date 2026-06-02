/**
 * Validation rules for AnsStudy fields.
 *
 * These are pure functions that take a (possibly null-valued) ProvField,
 * return either the field untouched or a copy with extra warnings + a
 * downgraded confidence score. Failures are NEVER silently "fixed" — we
 * preserve the original value and surface a warning so the UI can flag it.
 */

import {
  type ProvField,
  type ExtractionWarning,
  type Sex,
} from "../../shared/ansStudy.js";

/** Inclusive plausible range. */
export interface Range {
  min: number;
  max: number;
}

export const PLAUSIBLE = {
  HR_BPM: { min: 25, max: 220 } as Range,
  SBP_MMHG: { min: 60, max: 230 } as Range,
  DBP_MMHG: { min: 30, max: 150 } as Range,
  MAP_MMHG: { min: 40, max: 180 } as Range,
  AGE_YEARS: { min: 1, max: 120 } as Range,
  WEIGHT_LBS: { min: 50, max: 700 } as Range,
  HEIGHT_INCHES: { min: 36, max: 96 } as Range,
  BMI: { min: 10, max: 80 } as Range,
  RATIO: { min: 0.1, max: 5.0 } as Range,
  LFA_BPM2: { min: 0, max: 5000 } as Range,
  RFA_BPM2: { min: 0, max: 5000 } as Range,
  SB: { min: 0, max: 50 } as Range,
};

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

export function withWarning<T>(
  field: ProvField<T>,
  warning: string,
  confidencePenalty = 0.3,
): ProvField<T> {
  return {
    ...field,
    provenance: {
      ...field.provenance,
      confidence: Math.max(0, field.provenance.confidence - confidencePenalty),
      warnings: [...(field.provenance.warnings ?? []), warning],
    },
  };
}

function inRange(v: number, r: Range): boolean {
  return v >= r.min && v <= r.max;
}

// ---------------------------------------------------------------------------
// Numeric range validator
// ---------------------------------------------------------------------------

export function validateRange(
  field: ProvField<number>,
  range: Range,
  fieldLabel: string,
  warnings: ExtractionWarning[],
  fieldPath: string,
): ProvField<number> {
  if (field.value === null) return field;
  if (!inRange(field.value, range)) {
    warnings.push({
      code: "RANGE_OUT_OF_BOUNDS",
      message: `${fieldLabel} ${field.value} is outside plausible range [${range.min}, ${range.max}]`,
      severity: "warn",
      field: fieldPath,
    });
    return withWarning(field, `value ${field.value} outside plausible range`, 0.5);
  }
  return field;
}

// ---------------------------------------------------------------------------
// DOB / age cross-validation
// ---------------------------------------------------------------------------

export interface DobValidationContext {
  studyDateIso: string | null;
}

export function validateDob(
  dob: ProvField<string>,
  ctx: DobValidationContext,
  warnings: ExtractionWarning[],
): ProvField<string> {
  if (dob.value === null) return dob;

  const d = new Date(dob.value);
  if (isNaN(d.getTime())) {
    warnings.push({
      code: "DOB_IMPOSSIBLE",
      message: `DOB ${dob.value} is not a real date`,
      severity: "error",
      field: "patient.dob",
    });
    return withWarning(dob, "DOB is not a real calendar date", 0.6);
  }

  const year = d.getUTCFullYear();
  const now = new Date();
  if (year < 1900 || d > now) {
    warnings.push({
      code: "DOB_IMPOSSIBLE",
      message: `DOB ${dob.value} is before 1900 or in the future`,
      severity: "error",
      field: "patient.dob",
    });
    return withWarning(dob, "DOB outside plausible window", 0.6);
  }

  if (ctx.studyDateIso) {
    const study = new Date(ctx.studyDateIso);
    if (!isNaN(study.getTime()) && d > study) {
      warnings.push({
        code: "DOB_AFTER_STUDY",
        message: `DOB ${dob.value} is after study date ${ctx.studyDateIso}`,
        severity: "error",
        field: "patient.dob",
      });
      return withWarning(dob, "DOB is after study date", 0.6);
    }
  }

  return dob;
}

export function computeAge(
  dobIso: string | null,
  studyDateIso: string | null,
): number | null {
  if (!dobIso || !studyDateIso) return null;
  const dob = new Date(dobIso);
  const study = new Date(studyDateIso);
  if (isNaN(dob.getTime()) || isNaN(study.getTime())) return null;
  let age = study.getUTCFullYear() - dob.getUTCFullYear();
  const m = study.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && study.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

// ---------------------------------------------------------------------------
// Blood pressure pair validation
// ---------------------------------------------------------------------------

export function validateBloodPressure(
  sbp: ProvField<number>,
  dbp: ProvField<number>,
  warnings: ExtractionWarning[],
  sectionLabel: string,
): { sbp: ProvField<number>; dbp: ProvField<number> } {
  const fieldBase = `phase.${sectionLabel}.bp`;
  const sbpV = validateRange(sbp, PLAUSIBLE.SBP_MMHG, "SBP", warnings, `${fieldBase}.sbp`);
  const dbpV = validateRange(dbp, PLAUSIBLE.DBP_MMHG, "DBP", warnings, `${fieldBase}.dbp`);
  if (sbpV.value !== null && dbpV.value !== null && dbpV.value >= sbpV.value) {
    warnings.push({
      code: "BP_DIASTOLIC_GE_SYSTOLIC",
      message: `${sectionLabel}: DBP (${dbpV.value}) >= SBP (${sbpV.value})`,
      severity: "warn",
      field: fieldBase,
    });
    return {
      sbp: withWarning(sbpV, "SBP <= DBP — pair implausible", 0.5),
      dbp: withWarning(dbpV, "DBP >= SBP — pair implausible", 0.5),
    };
  }
  return { sbp: sbpV, dbp: dbpV };
}

// ---------------------------------------------------------------------------
// Sex validator
// ---------------------------------------------------------------------------

export function validateSex(
  sex: ProvField<Sex>,
  warnings: ExtractionWarning[],
): ProvField<Sex> {
  if (sex.value === null) return sex;
  if (sex.value === "Unknown") {
    warnings.push({
      code: "SEX_UNKNOWN",
      message: "Sex could not be normalized to Male/Female/Other",
      severity: "info",
      field: "patient.sex",
    });
    return withWarning(sex, "sex normalized to Unknown", 0.4);
  }
  return sex;
}

// ---------------------------------------------------------------------------
// Duplicate / conflicting value detection
// ---------------------------------------------------------------------------

/**
 * If the same canonical field appears in two sections with different values,
 * keep the higher-confidence one and emit a warning on the loser. Returns
 * the kept field.
 */
export function reconcileConflict<T>(
  primary: ProvField<T>,
  alternates: ProvField<T>[],
  fieldPath: string,
  warnings: ExtractionWarning[],
): ProvField<T> {
  if (primary.value === null) return primary;
  for (const alt of alternates) {
    if (alt.value === null) continue;
    if (alt.value !== primary.value) {
      warnings.push({
        code: "FIELD_CONFLICT",
        message: `Conflicting values for ${fieldPath}: kept ${JSON.stringify(
          primary.value,
        )} (conf ${primary.provenance.confidence}), discarded ${JSON.stringify(
          alt.value,
        )} (conf ${alt.provenance.confidence})`,
        severity: "warn",
        field: fieldPath,
      });
    }
  }
  return primary;
}
