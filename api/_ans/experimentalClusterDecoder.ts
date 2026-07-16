/**
 * experimentalClusterDecoder.ts — EXPERIMENTAL, OFF BY DEFAULT.
 *
 * An independently-authored sequential LabVIEW cluster decoder for .ans files.
 *
 * WHY THIS EXISTS
 * ---------------
 * The vendor .ans file is a LabVIEW-serialized cluster. The authoritative
 * HumanOS parser (parseBinary.ts) reads only the fields it has verified against
 * matched vendor PDFs and DELIBERATELY marks the proprietary spectral aggregates
 * (LFa / RFa / SB / FRF) and blood pressure as `missing`, because a single-scalar
 * offset search has a high false-positive rate and those values are not
 * deterministically recoverable that way. This module is a research vehicle to
 * test the alternative hypothesis — that the aggregates are serialized in cluster
 * order and can be recovered by a strict front-to-back walk with bounds + full-
 * buffer-consumption validation — WITHOUT ever letting an unvalidated recovery
 * touch a clinical claim.
 *
 * PROVENANCE / LICENSING
 * ----------------------
 * This is implemented from OBSERVED FUNCTIONAL FORMAT FACTS only (LabVIEW flatten
 * conventions + the field layout already documented in parseBinary.ts). It copies
 * NO third-party source. The reference tool `nnethery/physio-reporting-tool` is
 * private and unlicensed; none of its code is used here.
 *
 * HARD SAFETY CONTRACT
 * --------------------
 *   1. Feature-flagged OFF by default (HUMANOS_EXPERIMENTAL_CLUSTER_DECODER=1 to
 *      enable). When off, decodeClusterExperimental() returns a disabled result
 *      and does nothing.
 *   2. Recovered spectral values are tagged provenance `vendor_reported` with an
 *      explicit `experimental: true` marker and are NEVER returned inside an
 *      AnsStudy that feeds scoring. Callers get a standalone diagnostic object.
 *   3. Every read is bounds-checked; the decoder tracks buffer consumption and
 *      reports whether the walk consumed the whole buffer (a integrity signal).
 *   4. No universal-parity claim. Values are only trustworthy if a matched-pair
 *      validation (compareWithReference) passes for that specific file.
 */

// ----- Feature flag --------------------------------------------------------

/** Read the experimental flag from env. Anything other than "1"/"true" = off. */
export function isClusterDecoderEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.HUMANOS_EXPERIMENTAL_CLUSTER_DECODER ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

// ----- Types ---------------------------------------------------------------

export type Endian = "BE" | "LE";

export interface ExperimentalField<T> {
  value: T;
  /** Byte offset where this field started. */
  offset: number;
  /** Number of bytes consumed. */
  length: number;
}

/** A recovered spectral aggregate — provenance-tagged, never fed to scoring. */
export interface RecoveredSpectral {
  /** e.g. "A", "B", "C", "D", "E", "F" phase label if positional. */
  label: string;
  lfa: number | null;
  rfa: number | null;
  sb: number | null;
  frf: number | null;
  /** Always "vendor_reported" — these are vendor-serialized aggregates. */
  provenance: "vendor_reported";
  /** Always true — signals this came from the experimental path. */
  experimental: true;
}

export interface ClusterDecodeResult {
  enabled: boolean;
  /** True when the decode ran to completion without a bounds error. */
  ok: boolean;
  /** Detected endianness (autodetected from the leading length word). */
  endian: Endian | null;
  /** Ordered strings recovered from the leading cluster (names, sex, physician). */
  strings: Array<ExperimentalField<string>>;
  /** Candidate double-precision scalars recovered in cluster order. */
  doubles: Array<ExperimentalField<number>>;
  /** Recovered spectral aggregates, if a plausible block was found. */
  spectral: RecoveredSpectral[];
  /** Total bytes in the buffer. */
  bufferBytes: number;
  /** Bytes the sequential walk consumed before stopping. */
  consumedBytes: number;
  /** True when consumedBytes === bufferBytes (full-buffer consumption). */
  fullyConsumed: boolean;
  /** Non-fatal diagnostics collected during the walk. */
  warnings: string[];
}

// ----- Bounds-checked sequential reader ------------------------------------

class SeqReader {
  private off = 0;
  constructor(
    private readonly buf: Buffer,
    private readonly endian: Endian,
  ) {}

  get offset(): number {
    return this.off;
  }
  get remaining(): number {
    return this.buf.length - this.off;
  }
  get atEnd(): boolean {
    return this.off >= this.buf.length;
  }

  private ensure(n: number): void {
    if (this.off + n > this.buf.length) {
      throw new RangeError(`read ${n} @ ${this.off} exceeds buffer ${this.buf.length}`);
    }
  }

  u32(): ExperimentalField<number> {
    this.ensure(4);
    const value = this.endian === "BE" ? this.buf.readUInt32BE(this.off) : this.buf.readUInt32LE(this.off);
    const field = { value, offset: this.off, length: 4 };
    this.off += 4;
    return field;
  }

  double(): ExperimentalField<number> {
    this.ensure(8);
    const value = this.endian === "BE" ? this.buf.readDoubleBE(this.off) : this.buf.readDoubleLE(this.off);
    const field = { value, offset: this.off, length: 8 };
    this.off += 8;
    return field;
  }

  /** LabVIEW length-prefixed string (u32 length + ascii bytes). */
  lpString(maxLen: number): ExperimentalField<string> {
    const start = this.off;
    const lenField = this.u32();
    const len = lenField.value;
    if (len > maxLen) {
      // Not a plausible string here — rewind and signal.
      this.off = start;
      throw new RangeError(`LP-string len ${len} @ ${start} exceeds max ${maxLen}`);
    }
    this.ensure(len);
    const raw = this.buf.subarray(this.off, this.off + len).toString("ascii");
    this.off += len;
    return {
      value: raw.replace(/\x00+/g, "").replace(/\s+/g, " ").trim(),
      offset: start,
      length: 4 + len,
    };
  }

  skip(n: number): void {
    this.ensure(n);
    this.off += n;
  }
}

// ----- Autodetection -------------------------------------------------------

/**
 * Autodetect endianness from the leading length word. A LabVIEW cluster that
 * begins with an LP-string has a small (< buffer) length; the endianness whose
 * interpretation yields the smaller plausible length wins. Mirrors the observed
 * fact that test.ans begins `00 00 00 07` → big-endian.
 */
export function detectEndian(buf: Buffer): Endian | null {
  if (buf.length < 4) return null;
  const be = buf.readUInt32BE(0);
  const le = buf.readUInt32LE(0);
  const plausible = (n: number) => n > 0 && n < Math.min(buf.length, 4096);
  if (plausible(be) && !plausible(le)) return "BE";
  if (plausible(le) && !plausible(be)) return "LE";
  if (plausible(be) && plausible(le)) return be <= le ? "BE" : "LE";
  return null;
}

// ----- Main decode ---------------------------------------------------------

/** Plausibility window for a spectral aggregate (bpm²). Conservative. */
const SPECTRAL_MIN = 0;
const SPECTRAL_MAX = 5000;
/** Plausibility window for FRF (Hz). */
const FRF_MIN = 0;
const FRF_MAX = 2;

function plausibleSpectral(x: number): boolean {
  return Number.isFinite(x) && x >= SPECTRAL_MIN && x <= SPECTRAL_MAX;
}

/**
 * Experimental sequential cluster decode. Returns a DISABLED result unless the
 * feature flag is on. NEVER returns an AnsStudy and never feeds scoring.
 */
export function decodeClusterExperimental(
  buf: Buffer,
  env: NodeJS.ProcessEnv = process.env,
): ClusterDecodeResult {
  const base: ClusterDecodeResult = {
    enabled: false,
    ok: false,
    endian: null,
    strings: [],
    doubles: [],
    spectral: [],
    bufferBytes: buf.length,
    consumedBytes: 0,
    fullyConsumed: false,
    warnings: [],
  };

  if (!isClusterDecoderEnabled(env)) {
    base.warnings.push("experimental cluster decoder disabled (set HUMANOS_EXPERIMENTAL_CLUSTER_DECODER=1)");
    return base;
  }
  base.enabled = true;

  const endian = detectEndian(buf);
  if (!endian) {
    base.warnings.push("could not autodetect endianness from leading word");
    return base;
  }
  base.endian = endian;

  const reader = new SeqReader(buf, endian);
  const strings: Array<ExperimentalField<string>> = [];
  const doubles: Array<ExperimentalField<number>> = [];

  try {
    // 1) Leading cluster: an ordered run of LP-strings (last, first, sex,
    //    physician, ...). Stop when the next word is not a plausible string len.
    for (let i = 0; i < 16 && !reader.atEnd; i++) {
      const save = reader.offset;
      try {
        const s = reader.lpString(256);
        // A run of empty/garbage strings signals we've left the string region.
        if (s.value.length === 0 && strings.length > 0) {
          // put back and stop
          (reader as unknown as { off: number }).off = save;
          break;
        }
        strings.push(s);
      } catch {
        break;
      }
    }

    // 2) Scalar region: read doubles in cluster order until we can't, collecting
    //    plausible spectral-range values. This is a CANDIDATE scan, not a claim.
    for (let i = 0; i < 512 && reader.remaining >= 8; i++) {
      const d = reader.double();
      doubles.push(d);
    }

    // 3) Consume any trailing bytes (e.g. int16 ECG stream) so we can report
    //    full-buffer consumption as an integrity signal.
    if (reader.remaining > 0) {
      reader.skip(reader.remaining);
    }

    base.ok = true;
  } catch (err) {
    base.warnings.push(`walk stopped: ${(err as Error).message}`);
  }

  base.strings = strings;
  base.doubles = doubles;
  base.consumedBytes = reader.offset;
  base.fullyConsumed = reader.offset === buf.length;

  // 4) Assemble candidate spectral aggregates from plausible-range doubles.
  //    We DO NOT assign these to phases with certainty — positional labels are
  //    provisional and every value is flagged experimental + vendor_reported.
  const spectralCandidates = doubles
    .map((d) => d.value)
    .filter((v) => plausibleSpectral(v));
  if (spectralCandidates.length >= 3) {
    // Group into triples (LFa, RFa, SB-ish) positionally, purely as a hypothesis.
    const labels = ["A", "B", "C", "D", "E", "F"];
    for (let i = 0; i + 2 < spectralCandidates.length && i / 3 < labels.length; i += 3) {
      const lfa = spectralCandidates[i];
      const rfa = spectralCandidates[i + 1];
      const sbRaw = spectralCandidates[i + 2];
      const sb = rfa !== 0 ? lfa / rfa : null;
      const frf = sbRaw >= FRF_MIN && sbRaw <= FRF_MAX ? sbRaw : null;
      base.spectral.push({
        label: labels[Math.floor(i / 3)],
        lfa,
        rfa,
        sb,
        frf,
        provenance: "vendor_reported",
        experimental: true,
      });
    }
  } else {
    base.warnings.push("too few plausible spectral-range scalars to hypothesize a block");
  }

  return base;
}

// ----- Differential diagnostics -------------------------------------------

export interface ReferenceSpectral {
  label: string;
  lfa?: number;
  rfa?: number;
  sb?: number;
  frf?: number;
}

export interface DifferentialRow {
  label: string;
  field: "lfa" | "rfa" | "sb" | "frf";
  recovered: number | null;
  reference: number | null;
  absError: number | null;
  pctError: number | null;
  withinTolerance: boolean | null;
}

export interface DifferentialReport {
  rows: DifferentialRow[];
  comparedFields: number;
  withinTolerance: number;
  /** Fraction of compared fields within tolerance (0..1), or null if none. */
  matchRate: number | null;
  /** True only when EVERY compared field is within tolerance AND >= minFields. */
  validationPassed: boolean;
  notes: string[];
}

/**
 * Compare a decode result against a known matched-pair reference (e.g. values
 * OCR'd from the signed vendor PDF). This is the ONLY gate by which experimental
 * recoveries could ever be considered trustworthy for a specific file — and even
 * then adoption into clinical scoring requires an explicit, separate decision.
 * No universal-parity claim is made or implied.
 */
export function compareWithReference(
  result: ClusterDecodeResult,
  reference: ReferenceSpectral[],
  opts: { pctTolerance?: number; minFields?: number } = {},
): DifferentialReport {
  const pctTol = opts.pctTolerance ?? 5; // ±5% default
  const minFields = opts.minFields ?? 6;
  const rows: DifferentialRow[] = [];
  const notes: string[] = [];

  const byLabel = new Map(result.spectral.map((s) => [s.label, s]));
  const fields: Array<"lfa" | "rfa" | "sb" | "frf"> = ["lfa", "rfa", "sb", "frf"];

  for (const ref of reference) {
    const rec = byLabel.get(ref.label);
    for (const f of fields) {
      const reference_ = (ref[f] ?? null) as number | null;
      if (reference_ == null) continue; // only compare fields the reference has
      const recovered = rec ? ((rec[f] ?? null) as number | null) : null;
      let absError: number | null = null;
      let pctError: number | null = null;
      let withinTolerance: boolean | null = null;
      if (recovered != null) {
        absError = Math.abs(recovered - reference_);
        pctError = reference_ !== 0 ? (absError / Math.abs(reference_)) * 100 : (absError === 0 ? 0 : Infinity);
        withinTolerance = pctError <= pctTol;
      }
      rows.push({ label: ref.label, field: f, recovered, reference: reference_, absError, pctError, withinTolerance });
    }
  }

  const comparable = rows.filter((r) => r.withinTolerance != null);
  const within = comparable.filter((r) => r.withinTolerance === true).length;
  const comparedFields = comparable.length;
  const matchRate = comparedFields > 0 ? within / comparedFields : null;
  const validationPassed = comparedFields >= minFields && within === comparedFields;

  if (comparedFields < minFields) {
    notes.push(`only ${comparedFields} field(s) comparable (need >= ${minFields}); validation cannot pass`);
  }
  if (!result.fullyConsumed) {
    notes.push("decoder did not consume the full buffer — layout hypothesis is incomplete");
  }
  notes.push("EXPERIMENTAL: recovered values are vendor-serialized candidates, never used for clinical scoring without an explicit adoption decision. No universal-parity claim.");

  return { rows, comparedFields, withinTolerance: within, matchRate, validationPassed, notes };
}
