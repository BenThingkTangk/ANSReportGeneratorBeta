import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { MultiParameterGraphical } from "@shared/schema";
import { decodeSpectrogramValues } from "@shared/vendorVisualization";
import { SeriesProvenanceChip } from "./SeriesProvenanceChip";
import { ColomboExplainer } from "../ColomboExplainer";

/**
 * The stored PhysioPS wavelet spectrogram, drawn from the exact matrix that
 * lives in the uploaded `.ans` file.
 *
 * The vendor stores a `rows x cols` float32 matrix (time x frequency) together
 * with its own time base and frequency axis. We decode it byte-exactly and
 * paint it; no interpolation, smoothing, re-windowing or re-estimation happens
 * on the client. Colour is a display mapping only — the readout under the
 * cursor always reports the stored value.
 */

/** Perceptual ramp inside the product palette: deep slate → teal → gold → warm white. */
const RAMP: Array<[number, [number, number, number]]> = [
  [0.0, [14, 18, 24]],
  [0.25, [15, 62, 74]],
  [0.5, [32, 128, 141]],
  [0.72, [188, 226, 231]],
  [0.88, [255, 197, 83]],
  [1.0, [255, 244, 214]],
];

function rampColor(fraction: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, fraction));
  for (let index = 1; index < RAMP.length; index += 1) {
    const [stop, color] = RAMP[index];
    if (clamped <= stop) {
      const [prevStop, prevColor] = RAMP[index - 1];
      const span = stop - prevStop || 1;
      const t = (clamped - prevStop) / span;
      return [
        Math.round(prevColor[0] + (color[0] - prevColor[0]) * t),
        Math.round(prevColor[1] + (color[1] - prevColor[1]) * t),
        Math.round(prevColor[2] + (color[2] - prevColor[2]) * t),
      ];
    }
  }
  return RAMP[RAMP.length - 1][1];
}

function formatClock(sec: number): string {
  const minutes = Math.floor(sec / 60);
  const seconds = Math.floor(sec % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

interface SpectrogramPanelProps {
  mpg: MultiParameterGraphical;
}

export function SpectrogramPanel({ mpg }: SpectrogramPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<{ timeSec: number; freqHz: number; power: number } | null>(
    null,
  );
  const payload = mpg.vendorVisualization?.spectrogram ?? null;
  const provenance = mpg.seriesProvenance?.spectrogram ?? (payload ? payload.source : "unavailable");

  const decoded = useMemo(() => {
    if (!payload || payload.source !== "ans_stored") return null;
    const values = decodeSpectrogramValues(payload);
    if (values.length !== payload.rows * payload.cols) return null;
    // Upper display bound: the 99.5th percentile keeps a single wavelet spike
    // from flattening the whole picture. The stored values are never altered.
    const sorted = Float32Array.from(values).sort();
    const upper = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.995))] || 1;
    return { values, upper };
  }, [payload]);

  const totalSec = payload ? payload.rows * payload.dtSec : 0;
  const maxFreq = payload ? payload.freqStartHz + (payload.cols - 1) * payload.freqStepHz : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !payload || !decoded) return;
    // Environments without a 2D canvas (jsdom, some print pipelines) must fall
    // back to the labelled empty canvas rather than throwing.
    let context: CanvasRenderingContext2D | null = null;
    try {
      context = canvas.getContext("2d");
    } catch {
      context = null;
    }
    if (!context) return;
    canvas.width = payload.rows;
    canvas.height = payload.cols;
    const image = context.createImageData(payload.rows, payload.cols);
    const logUpper = Math.log1p(decoded.upper);
    for (let row = 0; row < payload.rows; row += 1) {
      for (let col = 0; col < payload.cols; col += 1) {
        const value = decoded.values[row * payload.cols + col];
        // Log compression only — HRV wavelet power spans several decades.
        const fraction = logUpper > 0 ? Math.log1p(Math.max(0, value)) / logUpper : 0;
        const [r, g, b] = rampColor(fraction);
        // Canvas y grows downward; draw low frequencies at the bottom.
        const pixel = ((payload.cols - 1 - col) * payload.rows + row) * 4;
        image.data[pixel] = r;
        image.data[pixel + 1] = g;
        image.data[pixel + 2] = b;
        image.data[pixel + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  }, [payload, decoded]);

  if (!payload || provenance !== "ans_stored" || !decoded) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="rounded-2xl bg-card/50 border border-border/30 p-5"
        data-testid="mpg-spectrogram-panel"
        data-provenance={provenance}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium">
            Wavelet Spectrogram
          </h3>
          <SeriesProvenanceChip provenance={provenance} testId="mpg-spectrogram-provenance" />
        </div>
        <p
          className="mt-3 text-[13px] leading-relaxed text-muted-foreground"
          data-testid="mpg-spectrogram-unavailable"
        >
          {provenance === "malformed"
            ? "This file declares a stored wavelet spectrogram, but the stored matrix did not decode. It is withheld rather than drawn from partial data."
            : "This upload does not carry the PhysioPS stored wavelet spectrogram. HumanOS does not synthesise a substitute image, because a re-estimated spectrogram would not be the vendor's."}
          {payload?.reason ? ` (${payload.reason})` : ""}
        </p>
      </motion.div>
    );
  }

  const freqTicks = [0, 0.1, 0.15, 0.25, 0.4, 0.6, 0.8, 1.0].filter((f) => f <= maxFreq + 1e-9);
  const timeTicks: number[] = [];
  for (let t = 0; t <= totalSec; t += 120) timeTicks.push(t);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="mpg-spectrogram-panel"
      data-provenance="ans_stored"
      data-rows={payload.rows}
      data-cols={payload.cols}
      data-stride={payload.strideFactor}
    >
      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
        <div>
          <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium">
            Wavelet Spectrogram — Frequency Domain with Respiration
          </h3>
          <p className="text-[12px] text-muted-foreground mt-1">
            {payload.wavelet} · {payload.cols} frequency bins to {maxFreq.toFixed(2)} Hz ·{" "}
            {payload.dtSec}s update
            {payload.strideFactor > 1
              ? ` · every ${payload.strideFactor}${payload.strideFactor === 2 ? "nd" : "th"} stored time slice shown`
              : ""}
          </p>
        </div>
        <SeriesProvenanceChip provenance="ans_stored" testId="mpg-spectrogram-provenance" />
      </div>

      <div className="flex gap-2">
        <div
          className="flex flex-col justify-between text-[12px] text-muted-foreground tabular-nums py-0.5"
          aria-hidden="true"
        >
          {[...freqTicks].reverse().map((tick) => (
            <span key={tick}>{tick.toFixed(2)}</span>
          ))}
        </div>
        <div className="relative flex-1 min-w-0">
          <canvas
            ref={canvasRef}
            className="w-full rounded-md border border-border/40"
            style={{ height: 240, imageRendering: "auto" }}
            role="img"
            aria-label={`Stored PhysioPS wavelet spectrogram: ${payload.rows} time slices every ${payload.dtSec} seconds by ${payload.cols} frequency bins up to ${maxFreq.toFixed(2)} hertz, read directly from the uploaded file.`}
            data-testid="mpg-spectrogram-canvas"
            onMouseLeave={() => setHover(null)}
            onMouseMove={(event) => {
              const target = event.currentTarget;
              const rect = target.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) return;
              const xFraction = (event.clientX - rect.left) / rect.width;
              const yFraction = (event.clientY - rect.top) / rect.height;
              const row = Math.min(payload.rows - 1, Math.max(0, Math.floor(xFraction * payload.rows)));
              const col = Math.min(
                payload.cols - 1,
                Math.max(0, Math.floor((1 - yFraction) * payload.cols)),
              );
              setHover({
                timeSec: row * payload.dtSec,
                freqHz: payload.freqStartHz + col * payload.freqStepHz,
                power: decoded.values[row * payload.cols + col],
              });
            }}
          />
          {/* Phase boundaries drawn over the stored image. */}
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            {mpg.phases.map((phase) =>
              totalSec > 0 ? (
                <div
                  key={`spectrogram-phase-${phase.name}`}
                  className="absolute top-0 bottom-0 border-l border-dashed border-white/45"
                  style={{ left: `${Math.min(100, (phase.startSec / totalSec) * 100)}%` }}
                >
                  <span className="absolute -top-0.5 left-1 text-[12px] font-bold text-white/90">
                    {phase.name}
                  </span>
                </div>
              ) : null,
            )}
          </div>
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between text-[12px] text-muted-foreground tabular-nums pl-8">
        {timeTicks.map((tick) => (
          <span key={tick}>{formatClock(tick)}</span>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span>Low power</span>
          <span
            className="inline-block h-2.5 w-32 rounded-full"
            style={{
              background:
                "linear-gradient(90deg, rgb(14,18,24), rgb(15,62,74), rgb(32,128,141), rgb(188,226,231), rgb(255,197,83), rgb(255,244,214))",
            }}
            aria-hidden="true"
          />
          <span>High power (log scale)</span>
        </div>
        <div
          className="text-[13px] tabular-nums text-foreground/90"
          data-testid="mpg-spectrogram-readout"
        >
          {hover
            ? `t = ${formatClock(hover.timeSec)} · ${hover.freqHz.toFixed(3)} Hz · ${hover.power.toPrecision(4)}`
            : "Hover the image for the stored value at a time and frequency"}
        </div>
      </div>

      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
        Vertical axis is frequency in hertz, horizontal axis is time from the start of the
        recording, and each cell is the vendor's own stored wavelet power. Colour is a display
        mapping with logarithmic compression; the hover readout always reports the unmodified
        stored number.
      </p>
      <ColomboExplainer chartKey="waveletMethod" />
    </motion.div>
  );
}
