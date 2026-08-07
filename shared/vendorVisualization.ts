/**
 * Transport types for the stored PhysioPS visualization payload (Phase 3).
 *
 * These describe data that was read out of the `.ans` binary, not modelled:
 * the 4 Hz heart-rate/breathing series, the eleven 4-second spectral trend
 * arrays and the wavelet spectrogram. Every block carries its own provenance so
 * a clinician surface can always tell stored data from a HumanOS estimate, an
 * absent structure, and a structurally broken one.
 *
 * No runtime dependencies: safe to import from both the API and the client.
 */

export type VisualizationProvenance =
  | "ans_stored"
  | "humanos_estimated"
  | "unavailable"
  | "malformed";

export type TrendRole =
  | "frf_hz"
  | "lfa_bpm2"
  | "rfa_bpm2"
  | "lfa_rfa_ratio"
  | "lfa_area_raw"
  | "rfa_area_raw"
  | "combined_area_raw"
  | "lfa_share_percent"
  | "rfa_share_percent"
  | "lfa_rfa_area_ratio"
  | "unmapped";

export type TrendMappingMethod =
  | "structural_invariant"
  | "stored_summary_agreement"
  | "unresolved";

export interface TrendChannelMapping {
  /** Stored array index, 0-based, in file order. */
  index: number;
  role: TrendRole;
  /** Display label for a clinician chart. Null when unmapped. */
  label: string | null;
  unit: string | null;
  method: TrendMappingMethod;
  /** Human-readable justification, always populated. */
  evidence: string;
  /** Byte offset of the stored array (audit trail). */
  offset: number;
  sampleCount: number;
}

export interface TrendMappingDiagnostics {
  ratioTriples: Array<{
    numerator: number;
    denominator: number;
    ratio: number;
    agreement: number;
  }>;
  percentPairs: Array<{ a: number; b: number; agreement: number }>;
  sumTriples: Array<{ a: number; b: number; total: number; agreement: number }>;
  /** Median relative error of the chosen bpm^2 family against the stored summary. */
  bpm2FamilyScore: number | null;
  /** Same score for the rejected family; used to prove the decision margin. */
  alternateFamilyScore: number | null;
  frfScore: number | null;
  /** Rank-correlation margin used to orient the raw power pair. */
  rawOrientationMargin: number | null;
  /** Corroboration of the bpm^2 channels against the stored spectrogram bands. */
  bpm2BandAgreement: { lfa: number | null; rfa: number | null } | null;
}

export interface StoredSeriesPayload {
  /** Seconds from the start of the recording. */
  t: number[];
  v: number[];
  /** 1 when every stored sample is transported; n when every nth sample is. */
  strideFactor: number;
  storedSampleCount: number;
  unit: string | null;
}

export interface StoredTrendChannelPayload extends TrendChannelMapping {
  /** Present only for channels a clinician surface plots. */
  series?: StoredSeriesPayload;
}

export interface StoredSpectrogramPayload {
  source: VisualizationProvenance;
  reason?: string;
  /** Wavelet family recorded by the vendor in the same file. */
  wavelet: string;
  rows: number;
  cols: number;
  /** Seconds from the start of the recording for row 0. */
  t0Sec: number;
  dtSec: number;
  freqStartHz: number;
  freqStepHz: number;
  /** Row-major time x frequency, big-endian float32, base64. Byte-exact. */
  encoding: "base64_f32be";
  values: string;
  /** >1 when time rows were strided down for transport. */
  strideFactor: number;
  /** Rows actually transported after striding. */
  transportedRows: number;
  byteLength: number;
}

export interface VendorVisualization {
  source: VisualizationProvenance;
  reason?: string;
  /** Absolute LabVIEW seconds for sample 0 of every stored series. */
  t0Abs: number;
  heartRate: StoredSeriesPayload | null;
  breathing: StoredSeriesPayload | null;
  trend: {
    dtSec: number;
    sampleCount: number;
    channels: StoredTrendChannelPayload[];
    /** True when LFa, RFa, LFa/RFa and FRF were all resolved from in-file evidence. */
    clinicalChannelsResolved: boolean;
    warnings: string[];
    diagnostics: TrendMappingDiagnostics;
  };
  spectrogram: StoredSpectrogramPayload | null;
}

/** Provenance of every series a clinician trend surface can plot. */
export interface MpgSeriesProvenance {
  heartRate: VisualizationProvenance;
  breathing: VisualizationProvenance;
  lfaRfa: VisualizationProvenance;
  spectrogram: VisualizationProvenance;
}

/** Decode a `base64_f32be` spectrogram payload into a Float32Array. */
export function decodeSpectrogramValues(
  payload: Pick<StoredSpectrogramPayload, "values" | "encoding" | "rows" | "cols">,
): Float32Array {
  if (payload.encoding !== "base64_f32be" || !payload.values) return new Float32Array(0);
  const binary =
    typeof atob === "function"
      ? atob(payload.values)
      : Buffer.from(payload.values, "base64").toString("binary");
  const length = binary.length;
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) bytes[index] = binary.charCodeAt(index);
  const view = new DataView(bytes.buffer);
  const count = Math.floor(length / 4);
  const out = new Float32Array(count);
  for (let index = 0; index < count; index += 1) out[index] = view.getFloat32(index * 4, false);
  return out;
}
