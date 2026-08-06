/**
 * Synthetic .ans buffer builder for unit tests.
 *
 * Mirrors the verified binary layout:
 *   LP-string lastName
 *   LP-string firstName
 *   int64 BE DOB (seconds since 1904-01-01 UTC)
 *   LP-string sex
 *   LP-string physician
 *   <ascii text block>
 *   double BE samplingInterval
 *   uint32 BE sampleCount
 *   int16 BE ECG samples
 */

const LABVIEW_EPOCH_OFFSET_SEC = 2_082_844_800;

export interface SyntheticAnsOptions {
  lastName?: string | null;          // null -> 0-length LP-string
  firstName?: string | null;
  /** ISO YYYY-MM-DD; null -> 8 zero bytes (undecodable DOB). */
  dobIso?: string | null;
  sex?: string | null;
  physician?: string | null;
  /** Free-form ASCII metadata block inserted between physician and sampling probe. */
  asciiBlock?: string;
  /** Optional explicit ascii padding bytes before sampling. */
  asciiPaddingBytes?: number;
  /** Whether to embed a study-date LabVIEW timestamp inside the asciiBlock region. */
  studyDateIso?: string | null;
  /** Exact PhysioPS BE-double test-start timestamp, including fractional seconds. */
  studyTimestampUtcIso?: string | null;
  /** sec/sample, default 0.004 (250 Hz). 0 -> omit sampling block entirely. */
  samplingInterval?: number;
  /** Number of synthesized ECG samples. */
  sampleCount?: number;
  /** Truncate the final buffer to this many bytes (simulate corrupt files). */
  truncateTo?: number;
  /**
   * Explicit int16 ECG samples. When supplied these replace the default
   * sinusoid and `sampleCount` is taken from the array length. Used by the
   * spectral-engine tests to inject a waveform with a KNOWN R-R modulation
   * spectrum. Values are clamped to the int16 range.
   */
  ecgSamples?: number[] | Float64Array;
}

function writeLpString(s: string | null | undefined): Buffer {
  const text = s ?? "";
  const body = Buffer.from(text, "ascii");
  const out = Buffer.alloc(4 + body.length);
  out.writeUInt32BE(body.length, 0);
  body.copy(out, 4);
  return out;
}

function isoToLabviewBuf(iso: string): Buffer {
  const t = new Date(iso + "T00:00:00Z").getTime() / 1000 + LABVIEW_EPOCH_OFFSET_SEC;
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(Math.trunc(t)), 0);
  return buf;
}

function isoToLabviewDoubleBuf(iso: string): Buffer {
  const seconds = new Date(iso).getTime() / 1000 + LABVIEW_EPOCH_OFFSET_SEC;
  const buf = Buffer.alloc(8);
  buf.writeDoubleBE(seconds, 0);
  return buf;
}

export function buildSyntheticAns(opts: SyntheticAnsOptions = {}): Buffer {
  const {
    lastName = "Doe",
    firstName = "Jane",
    dobIso = "1985-04-12",
    sex = "Female",
    physician = "Smith",
    asciiBlock = "E/I Ratio = 1.45\r\nValsalva Ratio = 1.55\r\n30:15 Ratio = 1.20\r\n5 ft 6 in\r\n",
    studyDateIso = "2024-08-15",
    studyTimestampUtcIso = null,
    samplingInterval = 0.004,
    truncateTo,
    ecgSamples,
  } = opts;
  const sampleCount = ecgSamples ? ecgSamples.length : (opts.sampleCount ?? 1000);

  const chunks: Buffer[] = [];
  chunks.push(writeLpString(lastName));
  chunks.push(writeLpString(firstName));
  // DOB
  if (dobIso === null) {
    chunks.push(Buffer.alloc(8)); // all zeros -> undecodable
  } else {
    chunks.push(isoToLabviewBuf(dobIso));
  }
  chunks.push(writeLpString(sex));
  chunks.push(writeLpString(physician));

  // ASCII block + optional study-date timestamp embedded inside the padding.
  // We pad the block with a few NUL bytes so the LabVIEW scanner can find
  // an 8-byte aligned int64 anywhere in the window.
  chunks.push(Buffer.from("\0\0\0\0", "binary"));
  if (studyDateIso) {
    chunks.push(isoToLabviewBuf(studyDateIso));
  }
  if (studyTimestampUtcIso) {
    chunks.push(isoToLabviewDoubleBuf(studyTimestampUtcIso));
    chunks.push(
      isoToLabviewDoubleBuf(
        new Date(new Date(studyTimestampUtcIso).getTime() + 938_000).toISOString(),
      ),
    );
  }
  chunks.push(Buffer.from("\0\0\0\0", "binary"));
  chunks.push(Buffer.from(asciiBlock, "ascii"));
  // A bit more zero-padding so the sampling probe sits at a known offset.
  chunks.push(Buffer.alloc(opts.asciiPaddingBytes ?? 8));

  // Sampling probe (optional)
  if (samplingInterval > 0) {
    const probe = Buffer.alloc(12);
    probe.writeDoubleBE(samplingInterval, 0);
    probe.writeUInt32BE(sampleCount, 8);
    chunks.push(probe);

    // ECG samples — simple sinusoid centered around 0 with amplitude 500.
    const samples = Buffer.alloc(sampleCount * 2);
    for (let i = 0; i < sampleCount; i++) {
      const raw = ecgSamples ? ecgSamples[i] : 500 * Math.sin((i / 50) * Math.PI * 2);
      const v = Math.max(-32768, Math.min(32767, Math.round(raw)));
      samples.writeInt16BE(v, i * 2);
    }
    chunks.push(samples);
  }

  let result = Buffer.concat(chunks);
  if (truncateTo !== undefined && truncateTo < result.length) {
    result = result.subarray(0, truncateTo);
  }
  return result;
}
