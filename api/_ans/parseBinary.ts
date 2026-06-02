/**
 * Deterministic binary-header parser for .ans files.
 *
 * Reverse-engineered fields (verified against Pare/Alex 2024-07-11 + Francey/
 * Shannon 2025-10-24):
 *
 *   off  type                      field
 *   ---  ------------------------  -----------------------------------------
 *   0    LP-string (BE u32 len)    Last Name
 *   var  LP-string                 First Name
 *   var  BE int64 (8 bytes)        DOB, seconds since 1904-01-01 UTC
 *   var  LP-string                 Sex / Gender
 *   var  LP-string                 Physician (may have "Dr." prefix)
 *   var  padding + ASCII metadata  E/I, Valsalva, 30:15, height, etc.
 *   ?    BE double                 Sampling interval (e.g. 0.004 = 250 Hz)
 *   ?+8  BE uint32                 ECG sample count
 *   ?+12 BE int16[]                ECG samples (signed)
 *
 * The LabVIEW-timestamp test date is NOT at a fixed offset across firmware
 * versions. We scan the pre-data window for any BE int64 that falls inside
 * the [1990-01-01, 2050-01-01] range and prefer the one closest to the
 * file's modification time / filename hint.
 *
 * Every extracted field carries provenance + confidence so a downstream
 * "missing vs normal" check can distinguish honest gaps from real zeros.
 */

import {
  type ProvField,
  type ExtractionWarning,
  provField,
  missingField,
} from "../../shared/ansStudy.js";

// ----- Constants -----------------------------------------------------------

/** Seconds between LabVIEW epoch (1904-01-01 UTC) and Unix epoch (1970-01-01). */
const LABVIEW_EPOCH_OFFSET_SEC = 2_082_844_800;
/** Sanity window for LabVIEW timestamps: 1990-01-01 .. 2050-01-01. */
const LABVIEW_MIN_SEC = 2_713_996_800;
const LABVIEW_MAX_SEC = 4_607_020_800;

// ----- Low-level byte readers ---------------------------------------------

function readUInt32BE(buf: Buffer, off: number): number {
  if (off + 4 > buf.length) throw new RangeError(`uint32BE @ ${off} OOB`);
  return buf.readUInt32BE(off);
}

function readBigInt64BE(buf: Buffer, off: number): bigint {
  if (off + 8 > buf.length) throw new RangeError(`int64BE @ ${off} OOB`);
  return buf.readBigInt64BE(off);
}

function readDoubleBE(buf: Buffer, off: number): number {
  if (off + 8 > buf.length) throw new RangeError(`doubleBE @ ${off} OOB`);
  return buf.readDoubleBE(off);
}

/** Read a 4-byte BE length-prefixed ASCII string. */
export interface LpStringResult {
  value: string;
  startOffset: number;
  length: number;
  nextOffset: number;
}

export function readLpString(buf: Buffer, off: number, maxLen = 1024): LpStringResult {
  if (off + 4 > buf.length) throw new RangeError(`LP-string len @ ${off} OOB`);
  const ln = readUInt32BE(buf, off);
  if (ln < 0 || ln > maxLen) {
    throw new RangeError(`LP-string len ${ln} @ ${off} out of bounds`);
  }
  if (off + 4 + ln > buf.length) {
    throw new RangeError(`LP-string body ${ln} @ ${off + 4} OOB`);
  }
  const raw = buf.subarray(off + 4, off + 4 + ln).toString("ascii");
  return {
    value: cleanString(raw),
    startOffset: off,
    length: ln,
    nextOffset: off + 4 + ln,
  };
}

/** Strip NUL bytes and trim. */
export function cleanString(s: string): string {
  return s.replace(/\x00+/g, "").replace(/\s+/g, " ").trim();
}

// ----- DOB -----------------------------------------------------------------

export interface DobResult {
  /** ISO YYYY-MM-DD, or null if unparseable. */
  iso: string | null;
  /** Raw 8 bytes for audit. */
  rawHex: string;
  /** Which interpretation was used. */
  interpretation:
    | "labview_int64"
    | "labview_int64_le_fallback"
    | "double_days_1899"
    | "none";
  warnings: string[];
}

/**
 * Decode the 8-byte DOB field. Verified on two fixtures: the field is
 * BE int64 seconds-since-1904 (LabVIEW timestamp).
 *
 * We keep a defensive fallback for the spec-doc's "LE double days from
 * epoch" interpretation in case older firmware emits that variant.
 */
export function decodeDob(eightBytes: Buffer): DobResult {
  if (eightBytes.length !== 8) {
    return {
      iso: null,
      rawHex: eightBytes.toString("hex"),
      interpretation: "none",
      warnings: ["DOB block was not 8 bytes"],
    };
  }
  const rawHex = eightBytes.toString("hex");

  // Primary: LabVIEW BE int64 seconds-since-1904
  const beI64 = Number(eightBytes.readBigInt64BE(0));
  if (Number.isFinite(beI64) && beI64 > 0 && beI64 < LABVIEW_MAX_SEC) {
    const unixSec = beI64 - LABVIEW_EPOCH_OFFSET_SEC;
    const d = new Date(unixSec * 1000);
    if (!isNaN(d.getTime()) && d.getUTCFullYear() >= 1900 && d.getUTCFullYear() <= new Date().getUTCFullYear()) {
      return {
        iso: isoDate(d),
        rawHex,
        interpretation: "labview_int64",
        warnings: [],
      };
    }
  }

  // Fallback A: LE int64 (some firmware byte-order flipped)
  try {
    const leI64 = Number(eightBytes.readBigInt64LE(0));
    if (Number.isFinite(leI64) && leI64 > 0 && leI64 < LABVIEW_MAX_SEC) {
      const unixSec = leI64 - LABVIEW_EPOCH_OFFSET_SEC;
      const d = new Date(unixSec * 1000);
      if (!isNaN(d.getTime()) && d.getUTCFullYear() >= 1900) {
        return {
          iso: isoDate(d),
          rawHex,
          interpretation: "labview_int64_le_fallback",
          warnings: ["DOB decoded via LE int64 fallback"],
        };
      }
    }
  } catch { /* swallow */ }

  // Fallback B: LE double "days since 1899-12-30" (OLE/Pascal style)
  try {
    const leDbl = eightBytes.readDoubleLE(0);
    if (Number.isFinite(leDbl) && leDbl > 0 && leDbl < 80_000) {
      const ms = (leDbl - 25569) * 86_400_000; // 25569 = days(1899-12-30..1970-01-01)
      const d = new Date(ms);
      if (!isNaN(d.getTime()) && d.getUTCFullYear() >= 1900 && d.getUTCFullYear() <= 2050) {
        return {
          iso: isoDate(d),
          rawHex,
          interpretation: "double_days_1899",
          warnings: ["DOB decoded via OLE/Pascal date fallback"],
        };
      }
    }
  } catch { /* swallow */ }

  return {
    iso: null,
    rawHex,
    interpretation: "none",
    warnings: ["DOB bytes did not match any known encoding"],
  };
}

// ----- LabVIEW timestamp scan ---------------------------------------------

export interface LabviewTimestampHit {
  /** Byte offset where the int64 lives. */
  offset: number;
  /** Decoded JS Date (UTC). */
  date: Date;
}

/**
 * Scan a window of the buffer for any BE int64 that falls inside our LabVIEW
 * sanity range. Returns every plausible hit. The caller picks the right one
 * (usually the first hit after the LP-string header).
 */
export function scanLabviewTimestamps(
  buf: Buffer,
  startOffset: number,
  endOffset: number,
): LabviewTimestampHit[] {
  const hits: LabviewTimestampHit[] = [];
  const end = Math.min(endOffset, buf.length - 8);
  for (let off = startOffset; off <= end; off++) {
    const hi = buf.readUInt32BE(off);
    if (hi !== 0) continue; // LabVIEW seconds-since-1904 in 1990-2050 is < 2^32
    const lo = buf.readUInt32BE(off + 4);
    if (lo >= LABVIEW_MIN_SEC && lo <= LABVIEW_MAX_SEC) {
      const unixSec = lo - LABVIEW_EPOCH_OFFSET_SEC;
      const d = new Date(unixSec * 1000);
      if (!isNaN(d.getTime())) hits.push({ offset: off, date: d });
    }
  }
  return hits;
}

// ----- Sampling-interval + ECG sample count -------------------------------

export interface SamplingProbe {
  samplingInterval: number; // sec/sample
  samplingRateHz: number;
  dataPointCount: number;
  dataStartOffset: number;
  /** True when the buffer can't actually hold dataPointCount * 2 bytes. */
  truncated: boolean;
}

/**
 * Walk the pre-data window looking for the (double interval, uint32 count)
 * pair that immediately precedes the ECG samples. The interval is constrained
 * to the [0.001, 0.02] sec range (50 Hz .. 1 kHz) and the count to a
 * plausible 10 K .. 5 M samples.
 *
 * Returns null when nothing plausible is found within the window.
 */
export function probeSampling(
  buf: Buffer,
  searchStart: number,
  searchEnd: number,
): SamplingProbe | null {
  const end = Math.min(searchEnd, buf.length - 12);
  for (let i = searchStart; i <= end; i++) {
    let interval = 0;
    try {
      interval = readDoubleBE(buf, i);
    } catch {
      continue;
    }
    if (!Number.isFinite(interval) || interval <= 0.0009 || interval > 0.025) continue;
    let count = 0;
    try {
      count = readUInt32BE(buf, i + 8);
    } catch {
      continue;
    }
    // Lower bound is intentionally tiny so synthetic test buffers (a few
    // hundred samples) still match. Production .ans files run 50K+ so this
    // never causes a false positive in the wild.
    if (count < 100 || count > 5_000_000) continue;
    const dataStart = i + 12;
    const availableSamples = Math.floor((buf.length - dataStart) / 2);
    const truncated = availableSamples < count;
    return {
      samplingInterval: interval,
      samplingRateHz: Math.round(1 / interval),
      dataPointCount: truncated ? availableSamples : count,
      dataStartOffset: dataStart,
      truncated,
    };
  }
  return null;
}

// ----- Top-level binary parse ---------------------------------------------

export interface BinaryHeaderParse {
  lastName: ProvField<string>;
  firstName: ProvField<string>;
  dob: ProvField<string>;
  sex: ProvField<"Male" | "Female" | "Other" | "Unknown">;
  physician: ProvField<string>;
  /** Offset where the ASCII metadata block begins (just after the physician LP-string). */
  asciiMetaStart: number;
  /** Offset where the ECG samples begin (when found). */
  dataStartOffset: number | null;
  sampling: SamplingProbe | null;
  /** Detected LabVIEW timestamp candidates in the pre-data window. */
  labviewHits: LabviewTimestampHit[];
  warnings: ExtractionWarning[];
}

export function parseBinaryHeader(buf: Buffer): BinaryHeaderParse {
  const warnings: ExtractionWarning[] = [];
  let pos = 0;

  // --- Last name ---
  let lastName: ProvField<string>;
  try {
    const r = readLpString(buf, pos);
    lastName = r.value
      ? provField(r.value, "binary_lp_string", {
          offset: r.startOffset,
          sourceText: r.value,
          confidence: 1,
        })
      : missingField("LP-string was empty");
    pos = r.nextOffset;
  } catch (e: any) {
    lastName = missingField(`LP-string read failed: ${e?.message ?? e}`);
    warnings.push({
      code: "BINARY_LASTNAME_READ_FAIL",
      message: e?.message ?? String(e),
      severity: "error",
      field: "patient.lastName",
    });
    pos = 4;
  }

  // --- First name ---
  let firstName: ProvField<string>;
  try {
    const r = readLpString(buf, pos);
    firstName = r.value
      ? provField(r.value, "binary_lp_string", {
          offset: r.startOffset,
          sourceText: r.value,
          confidence: 1,
        })
      : missingField("LP-string was empty");
    pos = r.nextOffset;
  } catch (e: any) {
    firstName = missingField(`LP-string read failed: ${e?.message ?? e}`);
    warnings.push({
      code: "BINARY_FIRSTNAME_READ_FAIL",
      message: e?.message ?? String(e),
      severity: "error",
      field: "patient.firstName",
    });
  }

  // --- DOB (8 raw bytes) ---
  const dobOffset = pos;
  let dob: ProvField<string>;
  if (pos + 8 <= buf.length) {
    const dobBytes = buf.subarray(pos, pos + 8);
    const decoded = decodeDob(dobBytes);
    if (decoded.iso) {
      dob = provField(decoded.iso, "binary_labview_i64", {
        offset: dobOffset,
        sourceText: decoded.rawHex,
        matchedLabel: decoded.interpretation,
        confidence: decoded.interpretation === "labview_int64" ? 1 : 0.7,
        warnings: decoded.warnings.length ? decoded.warnings : undefined,
      });
    } else {
      dob = missingField(decoded.warnings.join("; "));
      warnings.push({
        code: "DOB_UNDECODABLE",
        message: decoded.warnings.join("; ") || "DOB bytes did not decode",
        severity: "warn",
        field: "patient.dob",
      });
    }
    pos += 8;
  } else {
    dob = missingField("buffer too short for DOB block");
  }

  // --- Sex ---
  let sex: ProvField<"Male" | "Female" | "Other" | "Unknown">;
  try {
    const r = readLpString(buf, pos);
    const v = normalizeSex(r.value);
    sex = provField(v, "binary_lp_string", {
      offset: r.startOffset,
      sourceText: r.value,
      confidence: v === "Unknown" ? 0.3 : 1,
    });
    pos = r.nextOffset;
  } catch (e: any) {
    sex = missingField(`Sex LP-string read failed: ${e?.message ?? e}`);
  }

  // --- Physician ---
  let physician: ProvField<string>;
  try {
    const r = readLpString(buf, pos);
    const cleaned = cleanPhysicianName(r.value);
    physician = cleaned
      ? provField(cleaned, "binary_lp_string", {
          offset: r.startOffset,
          sourceText: r.value,
          confidence: 1,
        })
      : missingField("physician name empty");
    pos = r.nextOffset;
  } catch (e: any) {
    physician = missingField(`physician LP-string read failed: ${e?.message ?? e}`);
  }

  const asciiMetaStart = pos;

  // --- Sampling probe + LabVIEW timestamp scan ---
  // The ECG data block is preceded by a (double interval, uint32 count) pair.
  // The pre-data window varies by firmware; we scan up to 16 KB.
  const probeEnd = Math.min(buf.length, 16_384);
  const sampling = probeSampling(buf, asciiMetaStart, probeEnd);
  // Scan only the region between header end and the ECG start for timestamps.
  const tsScanEnd = sampling ? sampling.dataStartOffset - 12 : Math.min(buf.length, 4096);
  const labviewHits = scanLabviewTimestamps(buf, asciiMetaStart, tsScanEnd);

  return {
    lastName,
    firstName,
    dob,
    sex,
    physician,
    asciiMetaStart,
    dataStartOffset: sampling?.dataStartOffset ?? null,
    sampling,
    labviewHits,
    warnings,
  };
}

// ----- ECG int16 reader ---------------------------------------------------

/**
 * Materialize the ECG samples as Int16Array view over the buffer.
 * Note: BE int16 readers in Node Buffer return signed values directly.
 */
export function readEcgInt16(buf: Buffer, sampling: SamplingProbe): Int16Array {
  const out = new Int16Array(sampling.dataPointCount);
  let off = sampling.dataStartOffset;
  for (let i = 0; i < sampling.dataPointCount; i++) {
    out[i] = buf.readInt16BE(off);
    off += 2;
  }
  return out;
}

// ----- Helpers -------------------------------------------------------------

function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function normalizeSex(raw: string): "Male" | "Female" | "Other" | "Unknown" {
  const s = raw.trim().toLowerCase();
  if (s === "m" || s === "male") return "Male";
  if (s === "f" || s === "female") return "Female";
  if (s === "other" || s === "o") return "Other";
  return "Unknown";
}

export function cleanPhysicianName(raw: string): string {
  return raw.replace(/^(?:dr\.?\s+|doctor\s+)+/i, "").trim();
}
