import { useMemo } from "react";
import { motion } from "framer-motion";
import type { ANSReport } from "@shared/schema";

interface EcgRhythmStripProps {
  report: ANSReport;
}

/**
 * Clinical rhythm strip — renders the first ~10 seconds of the raw ECG
 * waveform on a classic red-grid background (1 mm = 25 px wide / 0.04 s,
 * 1 mV = 10 mm tall) so the clinician can eyeball rhythm, ectopy, QRS
 * morphology and ST behaviour. Renders nothing when no raw ECG is present.
 */
export function EcgRhythmStrip({ report }: EcgRhythmStripProps) {
  const ecg = report.patientData?.ecgData ?? [];
  const fs = Math.round(1 / (report.patientData?.samplingInterval || 0.004));

  const { path, ymin, ymax, durationSec } = useMemo(() => {
    if (!ecg.length) return { path: "", ymin: 0, ymax: 0, durationSec: 0 };
    const samples = Math.min(ecg.length, fs * 10); // first 10 s
    const slice = ecg.slice(0, samples);
    let ymin = Infinity;
    let ymax = -Infinity;
    for (const v of slice) {
      if (v < ymin) ymin = v;
      if (v > ymax) ymax = v;
    }
    const range = Math.max(1, ymax - ymin);
    // SVG normalized to 1000 wide, 200 tall
    const W = 1000;
    const H = 200;
    const dx = W / Math.max(1, samples - 1);
    let d = "";
    for (let i = 0; i < samples; i++) {
      const x = i * dx;
      const y = H - ((slice[i] - ymin) / range) * (H - 16) - 8;
      d += i === 0 ? `M${x.toFixed(2)} ${y.toFixed(2)}` : ` L${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    return { path: d, ymin, ymax, durationSec: samples / fs };
  }, [ecg, fs]);

  if (!ecg.length || !path) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
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
      <p className="text-[10px] text-muted-foreground/70 mt-2">
        Lead II surrogate · Eyeball rhythm, QRS morphology, and ectopy. Full waveform analyzed server-side at {fs} Hz.
      </p>
    </motion.div>
  );
}
