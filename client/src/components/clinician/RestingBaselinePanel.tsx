import { motion } from "framer-motion";
import type { ANSReport } from "@shared/schema";

interface RestingBaselinePanelProps {
  report: ANSReport;
}

const NORMS = {
  FRF: { lo: 0.15, hi: 0.40, label: "Hz" },
  LFa: { lo: 0.0, hi: 8.0, label: "bpm²" },
  RFa: { lo: 0.5, hi: 6.0, label: "bpm²" },
  SB:  { lo: 0.4, hi: 3.0, label: "ratio" },
};

type Cls = "low" | "normal" | "high";

function classify(v: number, n: { lo: number; hi: number }): Cls {
  if (v < n.lo) return "low";
  if (v > n.hi) return "high";
  return "normal";
}

function classColor(c: Cls): string {
  if (c === "low") return "hsl(35 90% 60%)";
  if (c === "high") return "hsl(0 72% 60%)";
  return "hsl(140 60% 55%)";
}

function classLabel(c: Cls): string {
  if (c === "low") return "Below norm";
  if (c === "high") return "Above norm";
  return "Within norm";
}

/**
 * Resting baseline panel — surfaces the four key Phase A spectral metrics
 * (LFa, RFa, sympathovagal balance LFa/RFa, FRF) with a clear in/out-of-norm
 * indicator. Sympathovagal balance is added per Colombo's request because it
 * is the single most diagnostic resting parameter. FRF is highlighted with
 * its numeric value whenever it falls outside the 0.15–0.40 Hz band.
 */
export function RestingBaselinePanel({ report }: RestingBaselinePanelProps) {
  const A = report.phaseEvents?.[0];
  if (!A) return null;

  const sb = A.RFa > 0 ? A.LFa / A.RFa : 0;

  const cards: {
    label: string;
    value: number;
    unit: string;
    norm: { lo: number; hi: number };
    explainer?: string;
  }[] = [
    { label: "LFa (Sympathetic)", value: A.LFa, unit: "bpm²", norm: NORMS.LFa, explainer: "Low-frequency wavelet power at rest" },
    { label: "RFa (Parasympathetic)", value: A.RFa, unit: "bpm²", norm: NORMS.RFa, explainer: "Respiratory-frequency wavelet power at rest" },
    { label: "Sympathovagal Balance (LFa/RFa)", value: sb, unit: "", norm: NORMS.SB, explainer: "Resting LFa/RFa balance ratio" },
    { label: "FRF (Fundamental Respiratory Freq.)", value: A.FRF, unit: "Hz", norm: NORMS.FRF, explainer: "Patient's natural respiratory frequency at rest" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="ps-glass p-5"
      data-testid="resting-baseline-panel"
    >
      <div className="flex items-baseline justify-between gap-4 mb-4 flex-wrap">
        <h3 className="ps-overline ps-underline-cyan">
          Resting Baseline (Phase A)
        </h3>
        <span className="text-[10px] text-muted-foreground/70 ps-text-mono">
          Sympathovagal balance & FRF flagged when out of Colombo norm
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => {
          const cls = classify(c.value, c.norm);
          const color = classColor(cls);
          const isOut = cls !== "normal";
          return (
            <div
              key={c.label}
              className="rounded-xl bg-background/40 border p-3"
              style={{
                borderColor: isOut ? `${color.replace(")", " / 0.45)").replace("hsl(", "hsl(")}` : "hsl(var(--border) / 0.4)",
              }}
              data-testid={`baseline-card-${c.label.split(" ")[0].toLowerCase()}`}
            >
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80 truncate">
                {c.label}
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-xl font-semibold tabular-nums ps-text-mono" style={{ color }}>
                  {c.value.toFixed(2)}
                </span>
                {c.unit && <span className="text-[10px] text-muted-foreground/70 ps-text-mono">{c.unit}</span>}
              </div>
              <div className="mt-1 text-[10px]" style={{ color }}>
                {classLabel(cls)} · norm {c.norm.lo}–{c.norm.hi}
              </div>
              {isOut && c.explainer && (
                <div className="mt-1 text-[10px] text-muted-foreground/70 leading-snug">
                  {c.explainer}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
