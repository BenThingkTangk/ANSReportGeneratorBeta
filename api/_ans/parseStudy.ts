/**
 * Top-level deterministic .ans parser.
 *
 * Pipeline:
 *   1. parseBinaryHeader()    -> demographics + sampling probe + LabVIEW hits
 *   2. sectionize()           -> AnsRawSection[] of the ASCII pre-data window
 *   3. extractField()         -> scoped regex per section via FIELD_SYNONYMS
 *   4. validators             -> range/DOB/BP/sex sanity, conflict reconcile
 *   5. compute parser confidence + emit AnsStudy
 *
 * Hard rules enforced here (per PR1 brief):
 *   - Never infer demographics from ambiguous text. Missing stays missing.
 *   - `null` value means "not present"; never substitute defaults.
 *   - Every value carries provenance + per-field confidence.
 *   - Raw ASCII head + section text are preserved for debugging.
 */

import {
  type AnsStudy,
  type AnsDemographics,
  type AnsFileMetadata,
  type AnsAnthropometrics,
  type AnsEcgSignal,
  type AnsEcgQuality,
  type AnsRawSection,
  type AnsSectionId,
  type PhaseBlock,
  type BloodPressure,
  type AnsRatios,
  type AnsSympatheticParasympathetic,
  type ProvField,
  type ExtractionWarning,
  type MedicationEntry,
  type SymptomEntry,
  type AnsConclusion,
  type Sex,
  PARSER_VERSION,
  missingField,
  provField,
} from "../../shared/ansStudy.js";

import {
  parseBinaryHeader,
  type BinaryHeaderParse,
  type LabviewTimestampHit,
  readEcgInt16,
} from "./parseBinary.js";
import { asciiView, sectionize, findSection } from "./sectionizer.js";
import {
  FIELD_SYNONYMS,
  buildFieldRegex,
  PATTERN_LABELS,
  SYMPTOM_KEYWORDS,
  type FieldSynonym,
} from "./synonyms.js";
import {
  PLAUSIBLE,
  computeAge,
  reconcileConflict,
  validateBloodPressure,
  validateDob,
  validateRange,
  validateSex,
  withWarning,
} from "./validators.js";

// ===========================================================================
// Generic field extraction over a section
// ===========================================================================

interface ExtractResult {
  raw: string;
  matchedLabel: string;
  offset: number;
  unit?: string;
}

/**
 * Scan one section for the first synonym match. Section text is searched
 * with each label's word-boundary regex (longest-first ordering is the
 * caller's responsibility — labels are listed most-specific-first in
 * FIELD_SYNONYMS).
 */
function extractFromSection(
  section: AnsRawSection,
  syn: FieldSynonym,
): ExtractResult | null {
  for (const label of syn.labels) {
    const re = buildFieldRegex(syn, label);
    const m = re.exec(section.text);
    if (m && m[1]) {
      const raw = m[1].trim();
      return {
        raw,
        matchedLabel: label,
        offset: section.startOffset + m.index,
        unit: m[2]?.trim(),
      };
    }
  }
  return null;
}

/** Same, but scan the whole ASCII view rather than a single section. */
function extractFromText(
  text: string,
  textStartOffset: number,
  syn: FieldSynonym,
): ExtractResult | null {
  for (const label of syn.labels) {
    const re = buildFieldRegex(syn, label);
    const m = re.exec(text);
    if (m && m[1]) {
      return {
        raw: m[1].trim(),
        matchedLabel: label,
        offset: textStartOffset + m.index,
        unit: m[2]?.trim(),
      };
    }
  }
  return null;
}

function toProvNumber(
  res: ExtractResult | null,
  sectionId: AnsSectionId | undefined,
  unitOverride?: string,
): ProvField<number> {
  if (!res) return missingField<number>("synonym not found in section");
  const n = Number(res.raw);
  if (!Number.isFinite(n)) {
    return {
      value: null,
      provenance: {
        source: "ascii_section",
        offset: res.offset,
        sourceText: res.raw,
        matchedLabel: res.matchedLabel,
        sourceSection: sectionId,
        confidence: 0,
        warnings: [`value "${res.raw}" not numeric`],
      },
    };
  }
  return {
    value: n,
    unit: unitOverride ?? res.unit,
    provenance: {
      source: sectionId ? "ascii_section" : "ascii_global_regex",
      offset: res.offset,
      sourceText: res.raw,
      matchedLabel: res.matchedLabel,
      sourceSection: sectionId,
      confidence: 1,
    },
  };
}

function toProvString(
  res: ExtractResult | null,
  sectionId: AnsSectionId | undefined,
): ProvField<string> {
  if (!res) return missingField<string>("synonym not found in section");
  return {
    value: res.raw,
    provenance: {
      source: sectionId ? "ascii_section" : "ascii_global_regex",
      offset: res.offset,
      sourceText: res.raw,
      matchedLabel: res.matchedLabel,
      sourceSection: sectionId,
      confidence: 1,
    },
  };
}

// ===========================================================================
// Date / study-date selection
// ===========================================================================

/** Try `MM/DD/YYYY` / `M-D-YY` / `YYYY-MM-DD`. Returns ISO YYYY-MM-DD or null. */
function normalizeDateToIso(raw: string): string | null {
  const s = raw.trim();
  // YYYY-MM-DD
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return iso(Number(y), Number(m), Number(d));
  }
  // MM/DD/YYYY or M-D-YY
  const slashMatch = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(s);
  if (slashMatch) {
    let [, m, d, y] = slashMatch;
    let yr = Number(y);
    if (yr < 100) yr += yr < 50 ? 2000 : 1900;
    return iso(yr, Number(m), Number(d));
  }
  // Date.parse fallback
  const t = Date.parse(s);
  if (!isNaN(t)) {
    const d = new Date(t);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return null;
}

function iso(y: number, m: number, d: number): string | null {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (y < 1900 || y > 2100) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse a study date out of the filename. We accept patterns like:
 *   "Pare-Alex-Thu-Jul-11-2024.ans"  -> 2024-07-11
 *   "Francey-Shannon-Fri-Oct-24-2025.ans" -> 2025-10-24
 *   "2024-07-11_alex_pare.ans"       -> 2024-07-11
 */
export function studyDateFromFilename(fileName: string): string | null {
  // Pattern A: <Day>-<Mon>-<DD>-<YYYY>
  const namedMatch = /-(Mon|Tue|Wed|Thu|Fri|Sat|Sun)-([A-Za-z]{3})-(\d{1,2})-(\d{4})/i.exec(
    fileName,
  );
  if (namedMatch) {
    const mon = MONTH_NAMES[namedMatch[2].toLowerCase()];
    const day = Number(namedMatch[3]);
    const year = Number(namedMatch[4]);
    return iso(year, mon, day);
  }
  // Pattern B: YYYY-MM-DD
  const isoMatch = /(\d{4})-(\d{2})-(\d{2})/.exec(fileName);
  if (isoMatch) return iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  return null;
}

/**
 * Pick the best LabVIEW timestamp hit as the study date. Strategy:
 *   - If the filename gives a hint, prefer the hit whose date is closest
 *     (within ±2 days) to that hint.
 *   - Otherwise prefer the most recent hit (newest date wins).
 */
function pickStudyDate(
  hits: LabviewTimestampHit[],
  filenameIso: string | null,
): { iso: string; offset: number; confidence: number; matched: string } | null {
  if (hits.length === 0) return null;
  if (filenameIso) {
    const target = new Date(filenameIso).getTime();
    let best = hits[0];
    let bestDelta = Math.abs(best.date.getTime() - target);
    for (const h of hits) {
      const delta = Math.abs(h.date.getTime() - target);
      if (delta < bestDelta) {
        best = h;
        bestDelta = delta;
      }
    }
    if (bestDelta < 1000 * 60 * 60 * 48) {
      return {
        iso: isoFromDate(best.date),
        offset: best.offset,
        confidence: 1,
        matched: "labview_i64_matched_filename",
      };
    }
  }
  // Fall back to most recent hit
  const newest = hits.reduce((a, b) => (b.date > a.date ? b : a));
  return {
    iso: isoFromDate(newest.date),
    offset: newest.offset,
    confidence: 0.7,
    matched: "labview_i64_newest",
  };
}

function isoFromDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ===========================================================================
// Phase block builder
// ===========================================================================

function emptyBloodPressure(): BloodPressure {
  return {
    sbp: missingField<number>("BP not present in this section"),
    dbp: missingField<number>("BP not present in this section"),
    map: missingField<number>("MAP not present in this section"),
  };
}

function emptyPhase(): PhaseBlock {
  return {
    present: false,
    startSec: missingField<number>("phase not present"),
    endSec: missingField<number>("phase not present"),
    heartRate: missingField<number>("phase not present"),
    bp: emptyBloodPressure(),
    lfa: missingField<number>("phase not present"),
    rfa: missingField<number>("phase not present"),
    sb: missingField<number>("phase not present"),
    notes: [],
  };
}

/** Try BP_COMBINED ("120/80") in a section; returns { sbp, dbp } or null. */
function extractCombinedBp(
  section: AnsRawSection,
): { sbp: ProvField<number>; dbp: ProvField<number> } | null {
  const res = extractFromSection(section, FIELD_SYNONYMS.BP_COMBINED);
  if (!res) return null;
  const m = /^(\d{2,3})\s*\/\s*(\d{2,3})$/.exec(res.raw);
  if (!m) return null;
  const sbp = Number(m[1]);
  const dbp = Number(m[2]);
  const prov = (val: number): ProvField<number> => ({
    value: val,
    unit: "mmHg",
    provenance: {
      source: "ascii_section",
      offset: res.offset,
      sourceText: res.raw,
      matchedLabel: res.matchedLabel,
      sourceSection: section.id,
      confidence: 0.95,
    },
  });
  return { sbp: prov(sbp), dbp: prov(dbp) };
}

function buildPhase(
  sections: AnsRawSection[],
  sectionId: AnsSectionId,
  warnings: ExtractionWarning[],
  sectionLabelForWarnings: string,
): PhaseBlock {
  const section = findSection(sections, sectionId);
  if (!section) return emptyPhase();

  // Heart rate
  let heartRate = toProvNumber(
    extractFromSection(section, FIELD_SYNONYMS.HEART_RATE),
    sectionId,
    "bpm",
  );
  heartRate = validateRange(
    heartRate,
    PLAUSIBLE.HR_BPM,
    `${sectionLabelForWarnings} HR`,
    warnings,
    `phase.${sectionLabelForWarnings}.heartRate`,
  );

  // Blood pressure: try discrete SBP/DBP first, fall back to combined "120/80"
  let sbp = toProvNumber(
    extractFromSection(section, FIELD_SYNONYMS.SBP),
    sectionId,
    "mmHg",
  );
  let dbp = toProvNumber(
    extractFromSection(section, FIELD_SYNONYMS.DBP),
    sectionId,
    "mmHg",
  );
  if (sbp.value === null && dbp.value === null) {
    const combined = extractCombinedBp(section);
    if (combined) {
      sbp = combined.sbp;
      dbp = combined.dbp;
    }
  }
  const map = toProvNumber(
    extractFromSection(section, FIELD_SYNONYMS.MAP),
    sectionId,
    "mmHg",
  );
  const bp = validateBloodPressure(sbp, dbp, warnings, sectionLabelForWarnings);

  // Spectral
  const lfa = validateRange(
    toProvNumber(extractFromSection(section, FIELD_SYNONYMS.LFA), sectionId, "bpm²"),
    PLAUSIBLE.LFA_BPM2,
    `${sectionLabelForWarnings} LFa`,
    warnings,
    `phase.${sectionLabelForWarnings}.lfa`,
  );
  const rfa = validateRange(
    toProvNumber(extractFromSection(section, FIELD_SYNONYMS.RFA), sectionId, "bpm²"),
    PLAUSIBLE.RFA_BPM2,
    `${sectionLabelForWarnings} RFa`,
    warnings,
    `phase.${sectionLabelForWarnings}.rfa`,
  );
  const sb = validateRange(
    toProvNumber(extractFromSection(section, FIELD_SYNONYMS.SB), sectionId),
    PLAUSIBLE.SB,
    `${sectionLabelForWarnings} SB`,
    warnings,
    `phase.${sectionLabelForWarnings}.sb`,
  );

  // Phase notes — keep the raw section text trimmed to <= 4 KB
  const notes = section.text
    .split(/[\r\n;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6 && s.length <= 240)
    .slice(0, 32);

  return {
    present: true,
    startSec: missingField<number>("phase timing not extracted in PR1"),
    endSec: missingField<number>("phase timing not extracted in PR1"),
    heartRate,
    bp: { sbp: bp.sbp, dbp: bp.dbp, map },
    lfa,
    rfa,
    sb,
    notes,
  };
}

// ===========================================================================
// Demographics + study metadata
// ===========================================================================

function buildDemographics(
  bin: BinaryHeaderParse,
  sections: AnsRawSection[],
  asciiHead: string,
  asciiHeadStart: number,
  studyDateIso: string | null,
  warnings: ExtractionWarning[],
): AnsDemographics {
  // Names from binary
  const lastName = bin.lastName;
  const firstName = bin.firstName;

  // DOB: binary takes precedence; if binary missing, try demographics section.
  let dob = bin.dob;
  if (dob.value === null) {
    const demoSec = findSection(sections, "demographics");
    const res = demoSec
      ? extractFromSection(demoSec, FIELD_SYNONYMS.DOB)
      : extractFromText(asciiHead, asciiHeadStart, FIELD_SYNONYMS.DOB);
    if (res) {
      const isoStr = normalizeDateToIso(res.raw);
      if (isoStr) {
        dob = {
          value: isoStr,
          provenance: {
            source: demoSec ? "ascii_section" : "ascii_global_regex",
            offset: res.offset,
            sourceText: res.raw,
            matchedLabel: res.matchedLabel,
            sourceSection: demoSec?.id,
            confidence: 0.8,
            warnings: ["DOB extracted from ASCII (binary i64 missing)"],
          },
        };
      }
    }
  }
  dob = validateDob(dob, { studyDateIso }, warnings);

  // Age — computed from DOB + studyDate when both known
  const ageNumber = computeAge(dob.value, studyDateIso);
  let ageAtStudy: ProvField<number> =
    ageNumber !== null
      ? {
          value: ageNumber,
          unit: "yrs",
          provenance: {
            source: "computed",
            confidence: dob.provenance.confidence,
          },
        }
      : missingField<number>("age unavailable: missing DOB or study date");
  ageAtStudy = validateRange(
    ageAtStudy,
    PLAUSIBLE.AGE_YEARS,
    "Age",
    warnings,
    "patient.ageAtStudy",
  );

  // If demographics section has an explicit AGE label, reconcile.
  const demoSec = findSection(sections, "demographics");
  const ageRes = demoSec
    ? extractFromSection(demoSec, FIELD_SYNONYMS.AGE)
    : extractFromText(asciiHead, asciiHeadStart, FIELD_SYNONYMS.AGE);
  if (ageRes) {
    const alt = toProvNumber(ageRes, demoSec?.id, "yrs");
    if (ageAtStudy.value === null && alt.value !== null) {
      ageAtStudy = alt;
    } else if (ageAtStudy.value !== null && alt.value !== null) {
      ageAtStudy = reconcileConflict(ageAtStudy, [alt], "patient.ageAtStudy", warnings);
    }
    // Re-validate so any age sourced from ASCII (instead of dob+studyDate) is
    // range-checked too.
    ageAtStudy = validateRange(
      ageAtStudy,
      PLAUSIBLE.AGE_YEARS,
      "Age",
      warnings,
      "patient.ageAtStudy",
    );
  }

  // Sex: binary first, then synonym fallback.
  let sex: ProvField<Sex> = bin.sex;
  if (sex.value === null || sex.value === "Unknown") {
    const res = demoSec
      ? extractFromSection(demoSec, FIELD_SYNONYMS.SEX)
      : extractFromText(asciiHead, asciiHeadStart, FIELD_SYNONYMS.SEX);
    if (res) {
      const norm = res.raw.trim().toLowerCase();
      const v: Sex =
        norm === "m" || norm === "male"
          ? "Male"
          : norm === "f" || norm === "female"
          ? "Female"
          : norm === "other"
          ? "Other"
          : "Unknown";
      if (v !== "Unknown") {
        sex = {
          value: v,
          provenance: {
            source: demoSec ? "ascii_section" : "ascii_global_regex",
            offset: res.offset,
            sourceText: res.raw,
            matchedLabel: res.matchedLabel,
            sourceSection: demoSec?.id,
            confidence: 0.9,
          },
        };
      }
    }
  }
  sex = validateSex(sex, warnings);

  // Physician — binary first, then synonym fallback.
  let physician = bin.physician;
  if (physician.value === null) {
    const res = demoSec
      ? extractFromSection(demoSec, FIELD_SYNONYMS.PHYSICIAN)
      : extractFromText(asciiHead, asciiHeadStart, FIELD_SYNONYMS.PHYSICIAN);
    if (res) {
      physician = toProvString(res, demoSec?.id);
    }
  }

  // MRN — never in binary header; ASCII only.
  const mrnRes = demoSec
    ? extractFromSection(demoSec, FIELD_SYNONYMS.MRN)
    : extractFromText(asciiHead, asciiHeadStart, FIELD_SYNONYMS.MRN);
  const mrn = toProvString(mrnRes, demoSec?.id);

  return {
    lastName,
    firstName,
    dob,
    ageAtStudy,
    sex,
    physician,
    mrn,
  };
}

function buildFileMetadata(
  bin: BinaryHeaderParse,
  sections: AnsRawSection[],
  asciiHead: string,
  asciiHeadStart: number,
  fileName: string,
  fileSizeBytes: number,
  warnings: ExtractionWarning[],
): { meta: AnsFileMetadata; studyDateIso: string | null } {
  // Study date selection
  const filenameIso = studyDateFromFilename(fileName);
  const lvHit = pickStudyDate(bin.labviewHits, filenameIso);

  let studyDate: ProvField<string>;
  if (lvHit) {
    studyDate = {
      value: lvHit.iso,
      provenance: {
        source: "binary_labview_i64",
        offset: lvHit.offset,
        matchedLabel: lvHit.matched,
        confidence: lvHit.confidence,
      },
    };
  } else if (filenameIso) {
    studyDate = {
      value: filenameIso,
      provenance: {
        source: "filename",
        matchedLabel: "filename_date",
        confidence: 0.6,
        warnings: ["study date taken from filename — no binary timestamp"],
      },
    };
  } else {
    // Last-ditch: ASCII section
    const metaSec = findSection(sections, "study_metadata");
    const res = metaSec
      ? extractFromSection(metaSec, FIELD_SYNONYMS.STUDY_DATE)
      : extractFromText(asciiHead, asciiHeadStart, FIELD_SYNONYMS.STUDY_DATE);
    if (res) {
      const isoStr = normalizeDateToIso(res.raw);
      studyDate = isoStr
        ? {
            value: isoStr,
            provenance: {
              source: metaSec ? "ascii_section" : "ascii_global_regex",
              offset: res.offset,
              sourceText: res.raw,
              matchedLabel: res.matchedLabel,
              sourceSection: metaSec?.id,
              confidence: 0.7,
            },
          }
        : missingField<string>("study date could not be normalized");
    } else {
      studyDate = missingField<string>("no study date available");
      warnings.push({
        code: "STUDY_DATE_MISSING",
        message: "No LabVIEW timestamp, filename, or ASCII date found",
        severity: "warn",
        field: "fileMetadata.studyDate",
      });
    }
  }

  // Study start time (ASCII only)
  const metaSec = findSection(sections, "study_metadata");
  const startRes = metaSec
    ? extractFromSection(metaSec, FIELD_SYNONYMS.STUDY_START_TIME)
    : extractFromText(asciiHead, asciiHeadStart, FIELD_SYNONYMS.STUDY_START_TIME);
  const studyStartTime = toProvString(startRes, metaSec?.id);

  // Procedure type
  const procRes = metaSec
    ? extractFromSection(metaSec, FIELD_SYNONYMS.PROCEDURE)
    : extractFromText(asciiHead, asciiHeadStart, FIELD_SYNONYMS.PROCEDURE);
  const procedureType = toProvString(procRes, metaSec?.id);

  // Sampling
  let samplingRateHz: ProvField<number>;
  let samplingInterval: ProvField<number>;
  let dataPointCount: ProvField<number>;
  let ecgTruncated = false;
  if (bin.sampling) {
    samplingRateHz = provField(bin.sampling.samplingRateHz, "binary_double", {
      offset: bin.sampling.dataStartOffset - 12,
      unit: "Hz",
      confidence: 1,
    });
    samplingInterval = provField(bin.sampling.samplingInterval, "binary_double", {
      offset: bin.sampling.dataStartOffset - 12,
      unit: "s",
      confidence: 1,
    });
    dataPointCount = provField(bin.sampling.dataPointCount, "binary_double", {
      offset: bin.sampling.dataStartOffset - 4,
      confidence: 1,
    });
    ecgTruncated = bin.sampling.truncated;
    if (ecgTruncated) {
      warnings.push({
        code: "ECG_TRUNCATED",
        message: "Buffer ends before declared dataPointCount",
        severity: "warn",
        field: "fileMetadata.dataPointCount",
      });
    }
  } else {
    samplingRateHz = missingField<number>("sampling probe did not find a plausible pair");
    samplingInterval = missingField<number>("sampling probe did not find a plausible pair");
    dataPointCount = missingField<number>("sampling probe did not find a plausible pair");
    warnings.push({
      code: "SAMPLING_PROBE_FAIL",
      message: "Could not locate the (double interval, uint32 count) pair",
      severity: "error",
      field: "fileMetadata.samplingRateHz",
    });
  }

  return {
    meta: {
      fileName: provField(fileName, "filename", { confidence: 1 }),
      fileSizeBytes,
      studyDate,
      studyStartTime,
      procedureType,
      samplingRateHz,
      samplingInterval,
      dataPointCount,
      ecgTruncated,
      device: missingField<string>("device string not extracted in PR1"),
    },
    studyDateIso: studyDate.value,
  };
}

// ===========================================================================
// Anthropometrics
// ===========================================================================

function buildAnthropometrics(
  sections: AnsRawSection[],
  asciiHead: string,
  asciiHeadStart: number,
  warnings: ExtractionWarning[],
): AnsAnthropometrics {
  const demoSec = findSection(sections, "demographics");

  const heightRes = demoSec
    ? extractFromSection(demoSec, FIELD_SYNONYMS.HEIGHT)
    : extractFromText(asciiHead, asciiHeadStart, FIELD_SYNONYMS.HEIGHT);
  let heightInches: ProvField<number>;
  if (!heightRes) {
    // Fallback: many older .ans files store height as a bare "5 ft 2 in"
    // token without a "Height:" label. Match the unambiguous ft/in pattern
    // and lower confidence to 0.6 to reflect the lack of a real label.
    const bare = /\b(\d)\s*ft\s*(\d{1,2})\s*in\b/i.exec(asciiHead);
    if (bare) {
      const inches = Number(bare[1]) * 12 + Number(bare[2]);
      heightInches = {
        value: inches,
        unit: "in",
        provenance: {
          source: "ascii_global_regex",
          offset: asciiHeadStart + (bare.index ?? 0),
          sourceText: bare[0],
          matchedLabel: "bare_ft_in",
          confidence: 0.6,
          warnings: ["height extracted without a \"Height:\" label"],
        },
      };
    } else {
      heightInches = missingField<number>("height not present");
    }
  } else {
    const raw = heightRes.raw.trim();
    // Parse "5 ft 11 in", "71 in", "180 cm"
    const ftIn = /^(\d+)\s*ft\s*(\d+)\s*in$/i.exec(raw);
    const inOnly = /^(\d+(?:\.\d+)?)\s*in$/i.exec(raw);
    const cmOnly = /^(\d+(?:\.\d+)?)\s*cm$/i.exec(raw);
    let inches: number | null = null;
    if (ftIn) inches = Number(ftIn[1]) * 12 + Number(ftIn[2]);
    else if (inOnly) inches = Number(inOnly[1]);
    else if (cmOnly) inches = Number(cmOnly[1]) / 2.54;
    heightInches = inches !== null
      ? {
          value: Math.round(inches * 10) / 10,
          unit: "in",
          provenance: {
            source: demoSec ? "ascii_section" : "ascii_global_regex",
            offset: heightRes.offset,
            sourceText: raw,
            matchedLabel: heightRes.matchedLabel,
            sourceSection: demoSec?.id,
            confidence: 0.9,
          },
        }
      : missingField<number>(`height "${raw}" not parseable`);
  }
  heightInches = validateRange(
    heightInches,
    PLAUSIBLE.HEIGHT_INCHES,
    "Height",
    warnings,
    "anthropometrics.heightInches",
  );

  const weightRes = demoSec
    ? extractFromSection(demoSec, FIELD_SYNONYMS.WEIGHT)
    : extractFromText(asciiHead, asciiHeadStart, FIELD_SYNONYMS.WEIGHT);
  let weightLbs = toProvNumber(weightRes, demoSec?.id, "lbs");
  if (weightLbs.value !== null && weightRes?.unit?.match(/kg/i)) {
    weightLbs = {
      ...weightLbs,
      value: Math.round(weightLbs.value * 2.20462 * 10) / 10,
      unit: "lbs",
    };
  }
  weightLbs = validateRange(
    weightLbs,
    PLAUSIBLE.WEIGHT_LBS,
    "Weight",
    warnings,
    "anthropometrics.weightLbs",
  );

  const bmiRes = demoSec
    ? extractFromSection(demoSec, FIELD_SYNONYMS.BMI)
    : extractFromText(asciiHead, asciiHeadStart, FIELD_SYNONYMS.BMI);
  let bmi = toProvNumber(bmiRes, demoSec?.id);
  if (bmi.value === null && heightInches.value !== null && weightLbs.value !== null) {
    const computed =
      (weightLbs.value * 703) / (heightInches.value * heightInches.value);
    bmi = {
      value: Math.round(computed * 10) / 10,
      unit: "kg/m²",
      provenance: {
        source: "computed",
        confidence: Math.min(
          heightInches.provenance.confidence,
          weightLbs.provenance.confidence,
        ),
        warnings: ["BMI computed from height + weight"],
      },
    };
  }
  bmi = validateRange(bmi, PLAUSIBLE.BMI, "BMI", warnings, "anthropometrics.bmi");

  return { heightInches, weightLbs, bmi };
}

// ===========================================================================
// Ratios + sympathetic/parasympathetic summary
// ===========================================================================

function buildRatios(
  sections: AnsRawSection[],
  asciiHead: string,
  asciiHeadStart: number,
  warnings: ExtractionWarning[],
): AnsRatios {
  const ratioSec = findSection(sections, "ratios");
  const summarySec = findSection(sections, "summary");
  const candidates = [ratioSec, summarySec].filter(Boolean) as AnsRawSection[];

  function pickRatio(syn: FieldSynonym, label: string): ProvField<number> {
    for (const sec of candidates) {
      const r = extractFromSection(sec, syn);
      if (r) return toProvNumber(r, sec.id);
    }
    const fallback = extractFromText(asciiHead, asciiHeadStart, syn);
    const field = toProvNumber(fallback, undefined);
    return validateRange(field, PLAUSIBLE.RATIO, label, warnings, `ratios.${label}`);
  }

  const eiRatio = validateRange(
    pickRatio(FIELD_SYNONYMS.EI_RATIO, "eiRatio"),
    PLAUSIBLE.RATIO,
    "E/I Ratio",
    warnings,
    "ratios.eiRatio",
  );
  const valsalvaRatio = validateRange(
    pickRatio(FIELD_SYNONYMS.VALSALVA_RATIO, "valsalvaRatio"),
    PLAUSIBLE.RATIO,
    "Valsalva Ratio",
    warnings,
    "ratios.valsalvaRatio",
  );
  const thirtyFifteenRatio = validateRange(
    pickRatio(FIELD_SYNONYMS.THIRTY_FIFTEEN_RATIO, "thirtyFifteenRatio"),
    PLAUSIBLE.RATIO,
    "30:15 Ratio",
    warnings,
    "ratios.thirtyFifteenRatio",
  );
  return { eiRatio, valsalvaRatio, thirtyFifteenRatio };
}

function buildSympPara(
  baseline: PhaseBlock,
  stand: PhaseBlock,
  sections: AnsRawSection[],
): AnsSympatheticParasympathetic {
  const summarySec = findSection(sections, "summary");
  const impression = summarySec
    ? {
        value: summarySec.text.trim().slice(0, 2000),
        provenance: {
          source: "ascii_section" as const,
          offset: summarySec.startOffset,
          sourceSection: summarySec.id,
          confidence: 0.9,
        },
      }
    : missingField<string>("no summary/clinical-impression section");
  return {
    restingLfa: baseline.lfa,
    restingRfa: baseline.rfa,
    restingSb: baseline.sb,
    standingLfa: stand.lfa,
    standingRfa: stand.rfa,
    standingSb: stand.sb,
    impressionText: impression,
  };
}

// ===========================================================================
// Medications + symptoms + conclusions
// ===========================================================================

function parseMedicationLine(raw: string): MedicationEntry {
  const m = /^(.+?)\s+(\d+(?:\.\d+)?)\s*(mg|mcg|g|units?|iu|ml)\b(?:\s+(.+))?$/i.exec(raw);
  if (m) {
    return {
      raw,
      name: m[1].trim(),
      dose: m[2],
      unit: m[3].toLowerCase(),
      frequency: m[4]?.trim() ?? null,
    };
  }
  return { raw, name: raw.trim() || null, dose: null, unit: null, frequency: null };
}

function buildMedications(sections: AnsRawSection[]): ProvField<MedicationEntry[]> {
  const sec = findSection(sections, "medications");
  if (!sec) return missingField<MedicationEntry[]>("no medications section");
  const lines = sec.text
    .split(/[\r\n;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && s.length <= 200);
  if (lines.length === 0) return missingField<MedicationEntry[]>("medications section empty");
  return {
    value: lines.map(parseMedicationLine),
    provenance: {
      source: "ascii_section",
      offset: sec.startOffset,
      sourceSection: "medications",
      confidence: 0.85,
    },
  };
}

function normalizeSymptom(raw: string): SymptomEntry {
  for (const [key, patterns] of Object.entries(SYMPTOM_KEYWORDS)) {
    if (patterns.some((p) => p.test(raw))) return { raw, key };
  }
  return { raw, key: null };
}

function buildSymptoms(sections: AnsRawSection[]): ProvField<SymptomEntry[]> {
  const sec = findSection(sections, "symptoms");
  if (!sec) return missingField<SymptomEntry[]>("no symptoms section");
  const lines = sec.text
    .split(/[\r\n;,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && s.length <= 200);
  if (lines.length === 0) return missingField<SymptomEntry[]>("symptoms section empty");
  return {
    value: lines.map(normalizeSymptom),
    provenance: {
      source: "ascii_section",
      offset: sec.startOffset,
      sourceSection: "symptoms",
      confidence: 0.85,
    },
  };
}

function buildConclusions(sections: AnsRawSection[]): ProvField<AnsConclusion[]> {
  const sec = findSection(sections, "conclusions") ?? findSection(sections, "summary");
  if (!sec) return missingField<AnsConclusion[]>("no conclusions section");
  const lines = sec.text
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6 && s.length <= 400);
  if (lines.length === 0) return missingField<AnsConclusion[]>("conclusions section empty");
  const entries: AnsConclusion[] = lines.map((raw) => {
    let pattern: string | undefined;
    for (const [code, patterns] of Object.entries(PATTERN_LABELS)) {
      if (patterns.some((p) => p.test(raw))) {
        pattern = code;
        break;
      }
    }
    return { raw, pattern };
  });
  return {
    value: entries,
    provenance: {
      source: "ascii_section",
      offset: sec.startOffset,
      sourceSection: sec.id,
      confidence: 0.85,
    },
  };
}

// ===========================================================================
// ECG signal preview + crude quality gate
// ===========================================================================

function buildEcgSignal(
  buf: Buffer,
  bin: BinaryHeaderParse,
  warnings: ExtractionWarning[],
): AnsEcgSignal {
  const quality: AnsEcgQuality = {
    snrDb: null,
    motionFraction: null,
    leadOff: false,
    usable: false,
    warnings: [],
  };
  if (!bin.sampling) {
    quality.leadOff = true;
    quality.warnings.push("no ECG block located");
    return { preview: [], durationSec: null, quality };
  }
  // Materialize a bounded preview (up to 4 KB samples = ~16 sec @ 250 Hz)
  const previewLen = Math.min(4096, bin.sampling.dataPointCount);
  const preview: number[] = new Array(previewLen);
  let pos = bin.sampling.dataStartOffset;
  let saturated = 0;
  let flat = 0;
  let last = 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < previewLen; i++) {
    if (pos + 2 > buf.length) break;
    const v = buf.readInt16BE(pos);
    pos += 2;
    preview[i] = v;
    if (v >= 32_000 || v <= -32_000) saturated++;
    if (i > 0 && v === last) flat++;
    last = v;
    sum += v;
    sumSq += v * v;
  }
  const motionFraction = (saturated + flat) / previewLen;
  const mean = sum / previewLen;
  const variance = Math.max(0, sumSq / previewLen - mean * mean);
  const std = Math.sqrt(variance);
  const snrDb = std > 0 ? 20 * Math.log10(std / 10) : null;
  const leadOff = motionFraction > 0.5 || std < 2;
  const usable = !leadOff && motionFraction < 0.25 && (snrDb ?? -Infinity) > 6;
  quality.snrDb = snrDb;
  quality.motionFraction = Math.round(motionFraction * 1000) / 1000;
  quality.leadOff = leadOff;
  quality.usable = usable;
  if (leadOff) {
    quality.warnings.push("ECG appears lead-off or flatlined");
    warnings.push({
      code: "ECG_LEAD_OFF",
      message: "ECG preview suggests lead-off / flatline",
      severity: "warn",
      field: "ecg.quality",
    });
  } else if (!usable) {
    quality.warnings.push("ECG signal-to-noise too low for clinical scoring");
  }
  const durationSec = bin.sampling.dataPointCount * bin.sampling.samplingInterval;
  return { preview, durationSec, quality };
}

// ===========================================================================
// Confidence aggregation
// ===========================================================================

function countMissingAndLowConfidence(study: Partial<AnsStudy>): {
  missing: number;
  lowConf: number;
  total: number;
} {
  let missing = 0;
  let lowConf = 0;
  let total = 0;
  const visit = (val: unknown): void => {
    if (val === null || val === undefined) return;
    if (typeof val !== "object") return;
    // ProvField shape: { value, provenance: { confidence } }
    const candidate = val as { value?: unknown; provenance?: { confidence?: number } };
    if ("value" in candidate && "provenance" in candidate && candidate.provenance && typeof candidate.provenance.confidence === "number") {
      total++;
      if (candidate.value === null) missing++;
      else if (candidate.provenance.confidence < 0.5) lowConf++;
      return; // don't descend further into a ProvField
    }
    if (Array.isArray(val)) {
      for (const x of val) visit(x);
      return;
    }
    for (const k of Object.keys(val as Record<string, unknown>)) {
      visit((val as Record<string, unknown>)[k]);
    }
  };
  visit(study);
  return { missing, lowConf, total };
}

// ===========================================================================
// Public entry point
// ===========================================================================

export interface ParseStudyOptions {
  /** Bytes of the .ans file. */
  buffer: Buffer;
  /** Original filename, used for fallback date parsing. */
  fileName: string;
}

export function parseStudy({ buffer, fileName }: ParseStudyOptions): AnsStudy {
  const warnings: ExtractionWarning[] = [];

  // 1) Binary header + sampling probe
  const bin = parseBinaryHeader(buffer);
  warnings.push(...bin.warnings);

  // 2) ASCII window: from after the physician string to (just before ECG data) or
  //    16 KB, whichever is smaller. Keeps regex work bounded.
  const asciiHeadStart = bin.asciiMetaStart;
  const asciiHeadEnd = Math.min(
    buffer.length,
    bin.sampling ? Math.max(bin.sampling.dataStartOffset - 12, asciiHeadStart + 1) : 16_384,
  );
  const sections = sectionize(buffer, asciiHeadStart, asciiHeadEnd);
  const asciiHead = asciiView(buffer, asciiHeadStart, Math.min(asciiHeadEnd, asciiHeadStart + 16_384));

  // 3) File metadata first so we have a study date for age computation
  const { meta, studyDateIso } = buildFileMetadata(
    bin,
    sections,
    asciiHead,
    asciiHeadStart,
    fileName,
    buffer.length,
    warnings,
  );

  // 4) Patient demographics (depends on studyDateIso for age)
  const patient = buildDemographics(
    bin,
    sections,
    asciiHead,
    asciiHeadStart,
    studyDateIso,
    warnings,
  );

  // 5) Anthropometrics
  const anthropometrics = buildAnthropometrics(sections, asciiHead, asciiHeadStart, warnings);

  // 6) ECG preview + quality gate
  const ecg = buildEcgSignal(buffer, bin, warnings);

  // 7) Phase blocks
  const baseline = buildPhase(sections, "baseline", warnings, "baseline");
  const deepBreathing = buildPhase(sections, "deep_breathing", warnings, "deepBreathing");
  const valsalva = buildPhase(sections, "valsalva", warnings, "valsalva");
  // standOrTilt: pick whichever section was found
  const hasStand = !!findSection(sections, "stand");
  const standOrTilt = hasStand
    ? buildPhase(sections, "stand", warnings, "stand")
    : buildPhase(sections, "tilt", warnings, "tilt");

  // 8) Ratios + sympathetic/parasympathetic summary
  const ratios = buildRatios(sections, asciiHead, asciiHeadStart, warnings);
  const sympatheticParasympathetic = buildSympPara(baseline, standOrTilt, sections);

  // 9) Free-text-ish sections
  const medications = buildMedications(sections);
  const symptoms = buildSymptoms(sections);
  const conclusions = buildConclusions(sections);

  // 10) Confidence aggregation
  const study: AnsStudy = {
    schemaVersion: "1.0",
    parsedAt: new Date().toISOString(),
    patient,
    fileMetadata: meta,
    anthropometrics,
    ecg,
    baseline,
    deepBreathing,
    valsalva,
    standOrTilt,
    ratios,
    sympatheticParasympathetic,
    medications,
    symptoms,
    conclusions,
    rawSections: sections,
    rawAsciiHead: asciiHead.slice(0, 16_384),
    extractionWarnings: warnings,
    parserConfidence: {
      overall: 0,
      missingCount: 0,
      lowConfidenceCount: 0,
      sectionsDetected: [],
      sectionsMissing: [],
      parserVersion: PARSER_VERSION,
    },
  };

  // Detected vs expected sections
  const detected = Array.from(
    new Set(sections.map((s) => s.id).filter((id) => id !== "unknown")),
  ) as AnsSectionId[];
  const expected: AnsSectionId[] = [
    "demographics",
    "baseline",
    "deep_breathing",
    "valsalva",
    "stand",
    "summary",
  ];
  const missingSections = expected.filter((s) => !detected.includes(s));

  const { missing, lowConf, total } = countMissingAndLowConfidence(study);
  const overall =
    total === 0
      ? 0
      : Math.max(0, Math.min(1, 1 - (missing * 0.5 + lowConf * 0.25) / total));

  study.parserConfidence = {
    overall: Math.round(overall * 1000) / 1000,
    missingCount: missing,
    lowConfidenceCount: lowConf,
    sectionsDetected: detected,
    sectionsMissing: missingSections,
    parserVersion: PARSER_VERSION,
  };

  return study;
}

// Re-export for callers that want the raw int16 stream (e.g. signal processing).
export { readEcgInt16 };
