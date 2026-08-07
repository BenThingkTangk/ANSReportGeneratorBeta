/**
 * Index-to-metric resolution for the eleven stored 4-second PhysioPS trend
 * arrays.
 *
 * WHY THIS EXISTS
 * ---------------
 * A modern `.ans` file stores eleven unlabeled float32 trend arrays after the
 * blood-pressure marker block. PhysioPS never documents which array is which,
 * and the vendor oracle explicitly records the index-to-metric mapping as
 * unresolved. Hardcoding "index 2 is LFa" would be an unverifiable guess that
 * silently mislabels a clinician chart the day the vendor reorders its arrays.
 *
 * Instead every mapping decision below is re-derived per file from evidence
 * that lives inside that same file:
 *
 *   1. STRUCTURAL INVARIANTS. Exact pointwise algebra between arrays:
 *        - ratio(t)   == numerator(t) / denominator(t)
 *        - total(t)   == a(t) + b(t)
 *        - percent(t) == 100 * a(t) / (a(t) + b(t)), and the two percent
 *          arrays sum to 100.
 *      These hold to float32 precision and identify the two power families
 *      without reference to any index constant.
 *
 *   2. STORED-SUMMARY AGREEMENT. The vendor's own six-phase numerical summary
 *      (already recovered byte-exact in Phase 2) says what LFa, RFa, LFa/RFa
 *      and FRF are for each phase. Whichever family reproduces those stored
 *      values over the corresponding phase windows is the bpm^2 family the
 *      vendor plots as "LFa* Trend / RFa* Trend"; the other family is the
 *      un-normalised power split.
 *
 * Anything that fails its evidence threshold stays `unmapped` with an explicit
 * reason. No patient, filename, hash, or oracle value is consulted at runtime.
 *
 * Boundary that this module does NOT claim: the vendor's printed per-phase
 * summary is not a plain aggregate of these trend arrays (no window/aggregation
 * rule reproduces it exactly across the private corpus), so the agreement score
 * below is used only to discriminate families - never to replace the stored
 * summary values.
 */

import type {
  TrendChannelMapping,
  TrendMappingDiagnostics,
  TrendMappingMethod,
  TrendRole,
} from "../../shared/vendorVisualization.js";
import type { VendorPhaseMetrics, VendorStoredSeries } from "./vendorStored.js";

export type {
  TrendChannelMapping,
  TrendMappingDiagnostics,
  TrendMappingMethod,
  TrendRole,
} from "../../shared/vendorVisualization.js";

export interface TrendMappingResult {
  channels: TrendChannelMapping[];
  /** True when LFa, RFa, the LFa/RFa ratio and FRF were all resolved. */
  clinicalChannelsResolved: boolean;
  warnings: string[];
  diagnostics: TrendMappingDiagnostics;
}

const RELATIVE_TOLERANCE = 1e-3;
const MIN_AGREEMENT = 0.95;
/** Samples dropped at each end of a phase window before aggregating. */
const WINDOW_EDGE_TRIM = 3;
const MAX_FAMILY_SCORE = 0.6;
const MIN_FAMILY_MARGIN = 1.5;
const MAX_FRF_SCORE = 0.2;
/** Minimum rank-correlation separation before a low/respiratory label is applied. */
const MIN_ORIENTATION_MARGIN = 0.15;

function relativeError(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-12);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Fraction of samples where `predicate` holds; 0 when nothing is comparable. */
function agreementFraction(
  length: number,
  predicate: (index: number) => boolean | null,
): number {
  let comparable = 0;
  let agreeing = 0;
  for (let index = 0; index < length; index += 1) {
    const outcome = predicate(index);
    if (outcome === null) continue;
    comparable += 1;
    if (outcome) agreeing += 1;
  }
  return comparable === 0 ? 0 : agreeing / comparable;
}

function trimmedWindowMean(
  values: number[],
  startIndex: number,
  endIndex: number,
): number | null {
  const from = Math.max(0, startIndex + WINDOW_EDGE_TRIM);
  const to = Math.min(values.length, endIndex - WINDOW_EDGE_TRIM);
  if (to - from < 2) {
    const fallback = values.slice(Math.max(0, startIndex), Math.min(values.length, endIndex));
    return fallback.length ? mean(fallback) : null;
  }
  return mean(values.slice(from, to));
}

/** Ranks with ties broken by first appearance; adequate for a monotonicity score. */
function ranks(values: number[]): number[] {
  const order = values
    .map((value, index) => [value, index] as const)
    .sort((left, right) => left[0] - right[0]);
  const out = new Array<number>(values.length).fill(0);
  order.forEach(([, index], rank) => {
    out[index] = rank;
  });
  return out;
}

function pearson(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length < 4) return Number.NaN;
  let meanA = 0;
  let meanB = 0;
  for (let index = 0; index < length; index += 1) {
    meanA += a[index];
    meanB += b[index];
  }
  meanA /= length;
  meanB /= length;
  let numerator = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let index = 0; index < length; index += 1) {
    const x = a[index] - meanA;
    const y = b[index] - meanB;
    numerator += x * y;
    varianceA += x * x;
    varianceB += y * y;
  }
  const denominator = Math.sqrt(varianceA * varianceB);
  return denominator === 0 ? Number.NaN : numerator / denominator;
}

/** Rank correlation: scale-free, so vendor-internal units compare cleanly. */
function spearman(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length < 4) return Number.NaN;
  return pearson(ranks(a.slice(0, length)), ranks(b.slice(0, length)));
}

/**
 * Integrate the stored wavelet spectrogram over a frequency band, one value per
 * stored time slice. Used only as a scale-free ORIENTATION witness: it decides
 * which member of a stored power pair is the low-frequency one.
 */
function spectrogramBand(
  spectrogram: VendorStoredSeries["spectrogram"],
  lowHz: number,
  highHz: number,
  maxRows: number,
): number[] {
  const { rows, cols, values, freqStartHz, freqStepHz } = spectrogram;
  if (rows < 1 || cols < 1 || values.length !== rows * cols) return [];
  const usableRows = Math.min(rows, maxRows);
  const out = new Array<number>(usableRows).fill(0);
  for (let row = 0; row < usableRows; row += 1) {
    let sum = 0;
    for (let col = 0; col < cols; col += 1) {
      const frequency = freqStartHz + col * freqStepHz;
      if (frequency >= lowHz && frequency < highHz) sum += values[row * cols + col];
    }
    out[row] = sum;
  }
  return out;
}

interface PhaseWindow {
  startIndex: number;
  endIndex: number;
  lfa: number;
  rfa: number;
  ratio: number;
  frf: number;
}

function phaseWindows(
  phases: VendorPhaseMetrics[],
  t0Abs: number,
  dtSec: number,
  sampleCount: number,
): PhaseWindow[] {
  if (!(dtSec > 0)) return [];
  return phases
    .map((phase) => ({
      startIndex: Math.max(0, Math.ceil((phase.startAbs - t0Abs) / dtSec)),
      endIndex: Math.min(sampleCount, Math.floor((phase.endAbs - t0Abs) / dtSec) + 1),
      lfa: phase.lfa,
      rfa: phase.rfa,
      ratio: phase.ratio,
      frf: phase.frf,
    }))
    .filter((window) => window.endIndex - window.startIndex >= 2);
}

/** Median relative error of one channel against one stored per-phase metric. */
function channelScore(
  values: number[],
  windows: PhaseWindow[],
  pick: (window: PhaseWindow) => number,
): number | null {
  const errors: number[] = [];
  for (const window of windows) {
    const aggregate = trimmedWindowMean(values, window.startIndex, window.endIndex);
    if (aggregate === null || !Number.isFinite(aggregate)) continue;
    errors.push(relativeError(aggregate, pick(window)));
  }
  return median(errors);
}

function unmapped(
  channel: { index: number; offset: number; values: number[] },
  reason: string,
): TrendChannelMapping {
  return {
    index: channel.index,
    role: "unmapped",
    label: null,
    unit: null,
    method: "unresolved",
    evidence: reason,
    offset: channel.offset,
    sampleCount: channel.values.length,
  };
}

const ROLE_LABELS: Record<Exclude<TrendRole, "unmapped">, { label: string; unit: string | null }> = {
  frf_hz: { label: "Fundamental respiratory frequency", unit: "Hz" },
  lfa_bpm2: { label: "LFa (sympathetic) trend", unit: "bpm^2" },
  rfa_bpm2: { label: "RFa (parasympathetic) trend", unit: "bpm^2" },
  lfa_rfa_ratio: { label: "LFa/RFa trend", unit: "ratio" },
  // PhysioPS vocabulary only: LFa / RFa, never the HRV band tokens.
  lfa_area_raw: { label: "LFa-band area (vendor internal units)", unit: null },
  rfa_area_raw: { label: "RFa-band area (vendor internal units)", unit: null },
  combined_area_raw: { label: "Combined LFa+RFa area (vendor internal units)", unit: null },
  lfa_share_percent: { label: "LFa share of combined area", unit: "%" },
  rfa_share_percent: { label: "RFa share of combined area", unit: "%" },
  lfa_rfa_area_ratio: { label: "LFa/RFa area ratio (vendor internal units)", unit: "ratio" },
};

/**
 * Resolve stored trend indices to vendor metrics using only in-file evidence.
 */
export function resolveTrendMapping(
  series: VendorStoredSeries,
  phases: VendorPhaseMetrics[],
): TrendMappingResult {
  const channels = series.trends.channels;
  const warnings: string[] = [];
  const assigned = new Map<number, TrendChannelMapping>();
  const diagnostics: TrendMappingResult["diagnostics"] = {
    ratioTriples: [],
    percentPairs: [],
    sumTriples: [],
    bpm2FamilyScore: null,
    alternateFamilyScore: null,
    frfScore: null,
    rawOrientationMargin: null,
    bpm2BandAgreement: null,
  };

  const usableLength = channels.length
    ? Math.min(...channels.map((channel) => channel.values.length))
    : 0;
  if (channels.length < 3 || usableLength < 8) {
    return {
      channels: channels.map((channel) =>
        unmapped(channel, "Too few stored trend samples to verify any mapping invariant."),
      ),
      clinicalChannelsResolved: false,
      warnings: ["Stored trend arrays were too short to resolve any mapping."],
      diagnostics,
    };
  }

  // ---- 1. structural invariants -------------------------------------------
  for (let i = 0; i < channels.length; i += 1) {
    for (let j = 0; j < channels.length; j += 1) {
      if (i === j) continue;
      const a = channels[i].values;
      const b = channels[j].values;
      for (let k = 0; k < channels.length; k += 1) {
        if (k === i || k === j) continue;
        const r = channels[k].values;
        const agreement = agreementFraction(usableLength, (index) => {
          if (b[index] === 0 || r[index] === 0) return null;
          return relativeError(a[index] / b[index], r[index]) <= RELATIVE_TOLERANCE;
        });
        if (agreement >= MIN_AGREEMENT) {
          diagnostics.ratioTriples.push({ numerator: i, denominator: j, ratio: k, agreement });
        }
      }
    }
  }
  for (let i = 0; i < channels.length; i += 1) {
    for (let j = i + 1; j < channels.length; j += 1) {
      const a = channels[i].values;
      const b = channels[j].values;
      const agreement = agreementFraction(usableLength, (index) =>
        relativeError(a[index] + b[index], 100) <= RELATIVE_TOLERANCE,
      );
      if (agreement >= MIN_AGREEMENT) {
        diagnostics.percentPairs.push({ a: i, b: j, agreement });
      }
      for (let k = 0; k < channels.length; k += 1) {
        if (k === i || k === j) continue;
        const total = channels[k].values;
        const sumAgreement = agreementFraction(usableLength, (index) => {
          if (total[index] === 0) return null;
          return relativeError(a[index] + b[index], total[index]) <= RELATIVE_TOLERANCE;
        });
        if (sumAgreement >= MIN_AGREEMENT) {
          diagnostics.sumTriples.push({ a: i, b: j, total: k, agreement: sumAgreement });
        }
      }
    }
  }

  // ---- 2. stored-summary agreement discriminates the two power families ----
  const windows = phaseWindows(phases, series.trends.t0Abs, series.trends.dtSec, usableLength);
  const percentMembers = new Set<number>();
  for (const pair of diagnostics.percentPairs) {
    percentMembers.add(pair.a);
    percentMembers.add(pair.b);
  }

  interface FamilyCandidate {
    numerator: number;
    denominator: number;
    ratio: number;
    agreement: number;
    score: number;
    swapped: boolean;
    isPercentFamily: boolean;
  }

  const candidates: FamilyCandidate[] = diagnostics.ratioTriples.map((triple) => {
    const numerator = channels[triple.numerator].values;
    const denominator = channels[triple.denominator].values;
    const direct = [
      channelScore(numerator, windows, (window) => window.lfa),
      channelScore(denominator, windows, (window) => window.rfa),
    ];
    const swapped = [
      channelScore(numerator, windows, (window) => window.rfa),
      channelScore(denominator, windows, (window) => window.lfa),
    ];
    const directScore = direct.every((value) => value !== null)
      ? (direct[0]! + direct[1]!) / 2
      : Number.POSITIVE_INFINITY;
    const swappedScore = swapped.every((value) => value !== null)
      ? (swapped[0]! + swapped[1]!) / 2
      : Number.POSITIVE_INFINITY;
    return {
      numerator: triple.numerator,
      denominator: triple.denominator,
      ratio: triple.ratio,
      agreement: triple.agreement,
      score: Math.min(directScore, swappedScore),
      swapped: swappedScore < directScore,
      // A percent array is a derived share, never a power series: any triple that
      // uses one is a restatement of the percent identity, not a power family.
      isPercentFamily:
        percentMembers.has(triple.numerator) ||
        percentMembers.has(triple.denominator) ||
        percentMembers.has(triple.ratio),
    };
  });
  const powerCandidates = candidates
    .filter((candidate) => !candidate.isPercentFamily)
    .sort((left, right) => left.score - right.score);

  const best = powerCandidates[0];
  /**
   * The second family is pinned by an ADDITIVE identity rather than by score:
   * only the true un-normalised power pair has a stored total (a + b) and a
   * stored percent split. That removes the numerator/denominator ambiguity a
   * quotient identity alone leaves behind.
   */
  const alternate = powerCandidates.find((candidate) => {
    if (!best) return false;
    const disjoint =
      candidate.numerator !== best.numerator &&
      candidate.denominator !== best.denominator &&
      candidate.numerator !== best.denominator &&
      candidate.denominator !== best.numerator;
    if (!disjoint) return false;
    return diagnostics.sumTriples.some(
      (sum) =>
        (sum.a === candidate.numerator && sum.b === candidate.denominator) ||
        (sum.a === candidate.denominator && sum.b === candidate.numerator),
    );
  });
  diagnostics.bpm2FamilyScore = best && Number.isFinite(best.score) ? best.score : null;
  diagnostics.alternateFamilyScore =
    alternate && Number.isFinite(alternate.score) ? alternate.score : null;

  const marginOk =
    !alternate ||
    !Number.isFinite(alternate.score) ||
    alternate.score >= (best?.score ?? Infinity) * MIN_FAMILY_MARGIN;

  const assign = (
    index: number,
    role: Exclude<TrendRole, "unmapped">,
    method: TrendMappingMethod,
    evidence: string,
  ): void => {
    const channel = channels[index];
    if (!channel || assigned.has(index)) return;
    assigned.set(index, {
      index,
      role,
      label: ROLE_LABELS[role].label,
      unit: ROLE_LABELS[role].unit,
      method,
      evidence,
      offset: channel.offset,
      sampleCount: channel.values.length,
    });
  };

  if (windows.length === 0) {
    warnings.push(
      "No stored phase window covered enough trend samples; the bpm^2 family could not be discriminated.",
    );
  } else if (!best || !Number.isFinite(best.score) || best.score > MAX_FAMILY_SCORE) {
    warnings.push(
      "No trend family reproduced the stored per-phase LFa/RFa values closely enough to be labelled.",
    );
  } else if (!marginOk) {
    warnings.push(
      "Two trend families matched the stored LFa/RFa values with no clear margin; both stay unmapped.",
    );
  } else {
    const lfaIndex = best.swapped ? best.denominator : best.numerator;
    const rfaIndex = best.swapped ? best.numerator : best.denominator;
    const evidence =
      `Stored LFa/RFa summary agreement ${best.score.toFixed(3)} median relative error` +
      (alternate && Number.isFinite(alternate.score)
        ? ` vs ${alternate.score.toFixed(3)} for the alternate power family`
        : "") +
      `; ratio identity holds for ${(best.agreement * 100).toFixed(1)}% of samples.`;
    const corroborationLf = spectrogramBand(series.spectrogram, 0.04, 0.15, usableLength);
    const corroborationRf = spectrogramBand(series.spectrogram, 0.15, 0.5, usableLength);
    if (corroborationLf.length >= 8 && corroborationRf.length >= 8) {
      const lfaRho = spearman(channels[lfaIndex].values, corroborationLf);
      const rfaRho = spearman(channels[rfaIndex].values, corroborationRf);
      diagnostics.bpm2BandAgreement = {
        lfa: Number.isFinite(lfaRho) ? lfaRho : null,
        rfa: Number.isFinite(rfaRho) ? rfaRho : null,
      };
    }
    assign(lfaIndex, "lfa_bpm2", "stored_summary_agreement", evidence);
    assign(rfaIndex, "rfa_bpm2", "stored_summary_agreement", evidence);
    assign(
      best.ratio,
      "lfa_rfa_ratio",
      "structural_invariant",
      "Stored array equals the pointwise quotient of the two resolved bpm^2 arrays.",
    );

    // ---- 3. the remaining, un-normalised power family -----------------------
    if (alternate && Number.isFinite(alternate.score)) {
      /**
       * Orientation witness: integrate the stored wavelet spectrogram over the
       * low-frequency and respiratory bands and see which member of the raw
       * pair tracks which band. This is scale-free (rank correlation) and needs
       * no assumption about the vendor's internal units. When no spectrogram is
       * stored, the pair is left unmapped rather than guessed.
       */
      const lfBand = spectrogramBand(series.spectrogram, 0.04, 0.15, usableLength);
      const rfBand = spectrogramBand(series.spectrogram, 0.15, 0.5, usableLength);
      const orientationAvailable = lfBand.length >= 8 && rfBand.length >= 8;
      const numeratorValues = channels[alternate.numerator].values;
      const denominatorValues = channels[alternate.denominator].values;
      const numeratorIsLfScore = orientationAvailable
        ? spearman(numeratorValues, lfBand) + spearman(denominatorValues, rfBand)
        : Number.NaN;
      const denominatorIsLfScore = orientationAvailable
        ? spearman(denominatorValues, lfBand) + spearman(numeratorValues, rfBand)
        : Number.NaN;
      const orientationMargin = Math.abs(numeratorIsLfScore - denominatorIsLfScore);
      const orientationResolved =
        Number.isFinite(numeratorIsLfScore) &&
        Number.isFinite(denominatorIsLfScore) &&
        orientationMargin >= MIN_ORIENTATION_MARGIN;
      diagnostics.rawOrientationMargin = Number.isFinite(orientationMargin)
        ? orientationMargin
        : null;
      if (!orientationResolved) {
        warnings.push(
          "The second stored area pair could not be oriented against the stored spectrogram bands; " +
            "those arrays and their share split stay unlabelled.",
        );
      }
      const numeratorIsLf = numeratorIsLfScore >= denominatorIsLfScore;
      const lfRaw = numeratorIsLf ? alternate.numerator : alternate.denominator;
      const rfRaw = numeratorIsLf ? alternate.denominator : alternate.numerator;
      const rawEvidence =
        "Second stored area family identified by the same exact ratio identity; LFa/RFa orientation " +
        `fixed by rank correlation against the stored wavelet-spectrogram bands (margin ${orientationMargin.toFixed(2)}).`;
      if (orientationResolved) {
        assign(lfRaw, "lfa_area_raw", "structural_invariant", rawEvidence);
        assign(rfRaw, "rfa_area_raw", "structural_invariant", rawEvidence);
      }
      assign(
        alternate.ratio,
        "lfa_rfa_area_ratio",
        "structural_invariant",
        "Stored array equals the pointwise quotient of the vendor-internal area pair.",
      );

      const totalTriple = diagnostics.sumTriples.find(
        (candidate) =>
          (candidate.a === lfRaw && candidate.b === rfRaw) ||
          (candidate.a === rfRaw && candidate.b === lfRaw),
      );
      if (totalTriple) {
        assign(
          totalTriple.total,
          "combined_area_raw",
          "structural_invariant",
          "Stored array equals the pointwise sum of the two vendor-internal LFa and RFa area arrays.",
        );
      }

      const percentEvidence =
        "Stored array equals 100 x (member / combined) of the resolved vendor-internal area pair, " +
        "and the two share arrays sum to 100 at every stored sample.";
      const percentOf = (candidate: number, source: number): boolean =>
        agreementFraction(usableLength, (index) => {
          const total = channels[lfRaw].values[index] + channels[rfRaw].values[index];
          if (total === 0 || channels[candidate].values[index] === 0) return null;
          return (
            relativeError(
              (100 * channels[source].values[index]) / total,
              channels[candidate].values[index],
            ) <= RELATIVE_TOLERANCE
          );
        }) >= MIN_AGREEMENT;
      if (orientationResolved) {
        for (const member of percentMembers) {
          if (percentOf(member, lfRaw)) assign(member, "lfa_share_percent", "structural_invariant", percentEvidence);
          else if (percentOf(member, rfRaw)) assign(member, "rfa_share_percent", "structural_invariant", percentEvidence);
        }
      }
    } else {
      warnings.push("Only one spectral power family was identifiable in this file.");
    }
  }

  // ---- 4. FRF --------------------------------------------------------------
  if (windows.length > 0) {
    let bestFrf: { index: number; score: number } | null = null;
    let runnerUp: number | null = null;
    for (const channel of channels) {
      if (assigned.has(channel.index)) continue;
      const inBand = channel.values.every((value) => value > 0 && value < 1);
      if (!inBand) continue;
      const score = channelScore(channel.values, windows, (window) => window.frf);
      if (score === null || !Number.isFinite(score)) continue;
      if (!bestFrf || score < bestFrf.score) {
        runnerUp = bestFrf ? bestFrf.score : runnerUp;
        bestFrf = { index: channel.index, score };
      } else if (runnerUp === null || score < runnerUp) {
        runnerUp = score;
      }
    }
    diagnostics.frfScore = bestFrf ? bestFrf.score : null;
    if (bestFrf && bestFrf.score <= MAX_FRF_SCORE) {
      assign(
        bestFrf.index,
        "frf_hz",
        "stored_summary_agreement",
        `Only sub-1 Hz stored array reproducing the stored per-phase FRF (median relative error ` +
          `${bestFrf.score.toFixed(3)}${runnerUp !== null ? `, next best ${runnerUp.toFixed(3)}` : ""}).`,
      );
    } else {
      warnings.push("No stored array reproduced the vendor FRF closely enough to be labelled.");
    }
  }

  const resolved = channels.map(
    (channel) =>
      assigned.get(channel.index) ??
      unmapped(
        channel,
        "No structural invariant or stored-summary agreement identified this array; it is carried " +
          "through unlabelled rather than guessed.",
      ),
  );
  const roles = new Set(resolved.map((channel) => channel.role));
  const clinicalChannelsResolved =
    roles.has("lfa_bpm2") && roles.has("rfa_bpm2") && roles.has("lfa_rfa_ratio") && roles.has("frf_hz");

  return { channels: resolved, clinicalChannelsResolved, warnings, diagnostics };
}
