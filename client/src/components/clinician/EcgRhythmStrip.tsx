import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { ANSReport } from "@shared/schema";
import { computeEcgScale, ecgSampleToY } from "@shared/ecgScaling";

interface EcgRhythmStripProps {
  report: ANSReport;
}

/**
 * Clinical rhythm strip — renders the first ~10 seconds of the raw ECG
 * waveform on a classic red-grid background so the clinician can eyeball
 * rhythm, ectopy, QRS morphology and ST behaviour. Uses ROBUST centering &
 * scaling (median + percentile spread, outliers clamped) so a single ectopic
 * spike or motion artifact no longer flattens the whole strip. Renders nothing
 * when no raw ECG is present.
 */
export function EcgRhythmStrip({ report }: EcgRhythmStripProps) {
  const ecg = report.patientData?.ecgData ?? [];
  const fs = Math.round(1 / (report.patientData?.samplingInterval || 0.004));
  const ectopicBeats = report.patientData?.ectopicBeats ?? 0;
  const prefersReducedMotion = useReducedMotion();

  const { path, ymin, ymax, durationSec, clampedPct } = useMemo(() => {
    if (!ecg.length) return { path: "", ymin: 0, ymax: 0, durationSec: 0, clampedPct: 0 };
    const samples = Math.min(ecg.length, fs * 10); // first 10 s
    const slice = ecg.slice(0, samples);
    const H = 200;
    const W = 1000;
    // Robust scale: median-centered, percentile half-range, outliers clamped.
    const scale = computeEcgScale(slice);
    const dx = W / Math.max(1, samples - 1);
    let d = "";
    for (let i = 0; i < samples; i++) {
      const x = i * dx;
      const y = ecgSampleToY(slice[i], scale, H, 8);
      d += i === 0 ? `M${x.toFixed(2)} ${y.toFixed(2)}` : ` L${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    return {
      path: d,
      ymin: scale.rawMin,
      ymax: scale.rawMax,
      durationSec: samples / fs,
      clampedPct: scale.clampedFraction * 100,
    };
  }, [ecg, fs]);

  if (!ecg.length || !path) return null;

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
      animate={prefersReducedMotion ? {} : { opacity: 1, y: 0 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.4 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="ecg-rhythm-strip"
    >
      <div className="flex items-baseline justify-between gap-4 mb-3 flex-wrap">
        <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium">
          ECG Rhythm Strip
        </h3>
        <span className="text-[10px] text-muted-foreground/70 tabular-nums">
          First {durationSec.toFixed(1)}s · {fs} Hz · range {ymin.toFixed(0)} → {ymax.toFixed(0)}
        </span>
      </div>
      <div className="rounded-lg overflow-hidden border border-border/30" style={{ background: "#1a0a0a" }}>
        <svg
          viewBox="0 0 1000 200"
          preserveAspectRatio="none"
          width="100%"
          height="160"
          aria-label="ECG rhythm strip"
        >
          <defs>
            <pattern id="ecgFineGrid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(239,68,68,0.18)" strokeWidth="0.5" />
            </pattern>
            <pattern id="ecgCoarseGrid" width="50" height="50" patternUnits="userSpaceOnUse">
              <path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(239,68,68,0.45)" strokeWidth="0.8" />
            </pattern>
          </defs>
          <rect x="0" y="0" width="1000" height="200" fill="url(#ecgFineGrid)" />
          <rect x="0" y="0" width="1000" height="200" fill="url(#ecgCoarseGrid)" />
          <path d={path} fill="none" stroke="hsl(45 100% 75%)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-[10px] text-muted-foreground/70">
          Lead II surrogate · median-centered, robust scale. Full waveform analyzed server-side at {fs} Hz.
        </p>
        {ectopicBeats > 0 ? (
          <span
            className="text-[10px] font-medium text-amber-500"
            data-testid="ecg-ectopy-note"
          >
            ⚠ {ectopicBeats} ectopic {ectopicBeats === 1 ? "beat" : "beats"} noted — may appear as a clamped spike; correlate with the full recording.
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground/60" data-testid="ecg-ectopy-note">
            No ectopic beats noted in the automated read.
          </span>
        )}
        {clampedPct >= 0.5 && (
          <span className="text-[10px] text-muted-foreground/60">
            {clampedPct.toFixed(1)}% of samples clamped for display.
          </span>
        )}
      </div>
    </motion.div>
  );
}
