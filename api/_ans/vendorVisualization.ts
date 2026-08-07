/**
 * Phase 3: build the clinician-facing visualization payload from the stored
 * PhysioPS series.
 *
 * Everything here is read from the `.ans` bytes. Nothing is modelled, smoothed,
 * interpolated or reconstructed:
 *
 *   - the 4 Hz heart-rate and breathing series are stored arrays,
 *   - the eleven 4-second trend arrays are stored arrays (index-to-metric
 *     mapping is re-derived per file, see `vendorTrendMapping.ts`),
 *   - the wavelet spectrogram is a stored `rows x cols` float32 matrix and is
 *     transported byte-exact as big-endian base64.
 *
 * Provenance is explicit for every block: `ans_stored`, `unavailable`
 * (structure absent) or `malformed` (structure present but unreadable). A block
 * that cannot be read is never replaced by an estimate here — the caller decides
 * whether to fall back to a clearly-labelled HumanOS estimate.
 */

import type {
  StoredSpectrogram,
  VendorPhaseMetrics,
  VendorStoredSeries,
} from "./vendorStored.js";
import { resolveTrendMapping, type TrendChannelMapping } from "./vendorTrendMapping.js";

export type VisualizationProvenance =
  | "ans_stored"
  | "humanos_estimated"
  | "unavailable"
  | "malformed";

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
    diagnostics: ReturnType<typeof resolveTrendMapping>["diagnostics"];
  };
  spectrogram: StoredSpectrogramPayload | null;
}

/** Roles that a clinician chart plots directly. */
const PLOTTED_ROLES = new Set([
  "lfa_bpm2",
  "rfa_bpm2",
  "lfa_rfa_ratio",
  "frf_hz",
  "lf_percent",
  "rf_percent",
]);

/** Hard transport ceilings. Exceeding one strides the series, never truncates it. */
const MAX_TRANSPORT_SAMPLES = 4_000;
/** 4 Hz series are long; 1.5 K samples keeps sub-second detail at a fifth of the bytes. */
const MAX_FAST_SERIES_SAMPLES = 1_500;
const MAX_SPECTROGRAM_VALUES = 120_000;

function strideSeries(
  values: number[],
  dtSec: number,
  unit: string | null,
  maxSamples = MAX_TRANSPORT_SAMPLES,
): StoredSeriesPayload {
  const strideFactor = Math.max(1, Math.ceil(values.length / maxSamples));
  const t: number[] = [];
  const v: number[] = [];
  for (let index = 0; index < values.length; index += strideFactor) {
    t.push(Math.round(index * dtSec * 1000) / 1000);
    v.push(values[index]);
  }
  return { t, v, strideFactor, storedSampleCount: values.length, unit };
}

function encodeSpectrogram(
  spectrogram: StoredSpectrogram,
  wavelet: string,
): StoredSpectrogramPayload {
  const { rows, cols, values } = spectrogram;
  if (values.length !== rows * cols) {
    return {
      source: "malformed",
      reason: `Stored spectrogram declared ${rows}x${cols} but carried ${values.length} values.`,
      wavelet,
      rows,
      cols,
      t0Sec: 0,
      dtSec: spectrogram.dtSec,
      freqStartHz: spectrogram.freqStartHz,
      freqStepHz: spectrogram.freqStepHz,
      encoding: "base64_f32be",
      values: "",
      strideFactor: 1,
      transportedRows: 0,
      byteLength: 0,
    };
  }
  const strideFactor = Math.max(1, Math.ceil((rows * cols) / MAX_SPECTROGRAM_VALUES));
  const transportedRows = Math.ceil(rows / strideFactor);
  const buffer = Buffer.alloc(transportedRows * cols * 4);
  let write = 0;
  for (let row = 0; row < rows; row += strideFactor) {
    for (let col = 0; col < cols; col += 1) {
      buffer.writeFloatBE(values[row * cols + col], write);
      write += 4;
    }
  }
  return {
    source: "ans_stored",
    wavelet,
    rows: transportedRows,
    cols,
    t0Sec: 0,
    dtSec: spectrogram.dtSec * strideFactor,
    freqStartHz: spectrogram.freqStartHz,
    freqStepHz: spectrogram.freqStepHz,
    encoding: "base64_f32be",
    values: buffer.toString("base64"),
    strideFactor,
    transportedRows,
    byteLength: buffer.byteLength,
  };
}

/** Explicit, non-misleading payload for files with no stored visualization data. */
export function unavailableVisualization(reason: string): VendorVisualization {
  return {
    source: "unavailable",
    reason,
    t0Abs: 0,
    heartRate: null,
    breathing: null,
    trend: {
      dtSec: 0,
      sampleCount: 0,
      channels: [],
      clinicalChannelsResolved: false,
      warnings: [],
      diagnostics: {
        ratioTriples: [],
        percentPairs: [],
        sumTriples: [],
        bpm2FamilyScore: null,
        alternateFamilyScore: null,
        frfScore: null,
        rawOrientationMargin: null,
        bpm2BandAgreement: null,
      },
    },
    spectrogram: null,
  };
}

export function buildVendorVisualization(
  series: VendorStoredSeries,
  phases: VendorPhaseMetrics[],
  waveletName: string,
): VendorVisualization {
  const mapping = resolveTrendMapping(series, phases);
  const dtSec = series.trends.dtSec;
  const sampleCount = series.trends.channels.length
    ? Math.max(...series.trends.channels.map((channel) => channel.values.length))
    : 0;

  const channels: StoredTrendChannelPayload[] = mapping.channels.map((channel) => {
    const stored = series.trends.channels.find((item) => item.index === channel.index);
    if (!stored || !PLOTTED_ROLES.has(channel.role)) return { ...channel };
    return { ...channel, series: strideSeries(stored.values, dtSec, channel.unit) };
  });

  const spectrogram =
    series.spectrogram.rows > 0 && series.spectrogram.cols > 0
      ? encodeSpectrogram(series.spectrogram, waveletName)
      : null;

  return {
    source: "ans_stored",
    t0Abs: series.trends.t0Abs,
    heartRate: series.heartRate.values.length
      ? strideSeries(
          series.heartRate.values,
          series.heartRate.dtSec,
          "bpm",
          MAX_FAST_SERIES_SAMPLES,
        )
      : null,
    breathing: series.breathing.values.length
      ? strideSeries(
          series.breathing.values,
          series.breathing.dtSec,
          "sensor units",
          MAX_FAST_SERIES_SAMPLES,
        )
      : null,
    trend: {
      dtSec,
      sampleCount,
      channels,
      clinicalChannelsResolved: mapping.clinicalChannelsResolved,
      warnings: mapping.warnings,
      diagnostics: mapping.diagnostics,
    },
    spectrogram,
  };
}

/** Convenience accessor used by the report builder and by tests. */
export function trendSeriesForRole(
  visualization: VendorVisualization,
  role: TrendChannelMapping["role"],
): StoredSeriesPayload | null {
  const channel = visualization.trend.channels.find((item) => item.role === role);
  return channel?.series ?? null;
}
