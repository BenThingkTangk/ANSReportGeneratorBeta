import { motion } from "framer-motion";
import type { ANSReport } from "@shared/schema";
import { COLOMBO_NORMS, classifySpectral, type SpectralClass } from "@shared/colomboNorms";

interface RestingBaselinePanelProps {
  report: ANSReport;
}

// Norm bands come from the single source of truth (shared/colomboNorms). Do NOT
// hardcode band edges here — they must match every other report surface.
const NORMS = {
  FRF: { ...COLOMBO_NORMS.FRF, label: "Hz" },
  LFa: { ...COLOMBO_NORMS.LFa, label: "bpm²" },
  RFa: { ...COLOMBO_NORMS.RFa, label: "bpm²" },
  SB: { ...COLOMBO_NORMS.SB, label: "ratio" },
};

type Cls = SpectralClass;

function classify(v: number, n: { lo: number; hi: number }): Cls {
  return classifySpectral(v, n);
}

function classColor(c: Cls): string {
  if (c === "low") return "hsl(17 100% 60%)";
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
 * its numeric value whenever it falls outside the Colombo 0.09–0.15 Hz band.
 */
export function RestingBaselinePanel({ report }: RestingBaselinePanelProps) {
  const A = report.phaseEvents?.[0];
  if (!A) return null;

  // Spectral aggregates (LFa/RFa/SB/FRF) are null when not reproducible from a
  // raw ECG-only recording. Never coerce null to a number or call toFixed on it
  // — render "Not assessed" and never fabricate a 0 balance.
  const spectralOk = report.spectralAvailable !== false;
  const sb =
    spectralOk && typeof A.LFa === "number" && typeof A.RFa === "number" && A.RFa > 0
      ? A.LFa / A.RFa
      : null;

  const cards: {
    label: string;
    value: number | null;
    unit: string;
    norm: { lo: number; hi: number };
    explainer?: string;
  }[] = [
    { label: "LFa (Sympathetic)", value: spectralOk ? A.LFa : null, unit: "bpm²", norm: NORMS.LFa, explainer: "Low-frequency wavelet power at rest" },
    { label: "RFa (Parasympathetic)", value: spectralOk ? A.RFa : null, unit: "bpm²", norm: NORMS.RFa, explainer: "Respiratory-frequency wavelet power at rest" },
    { label: "Sympathovagal Balance (LFa/RFa)", value: sb, unit: "", norm: NORMS.SB, explainer: "Resting LFa/RFa balance ratio" },
    { label: "FRF (Fundamental Respiratory Freq.)", value: spectralOk ? A.FRF : null, unit: "Hz", norm: NORMS.FRF, explainer: "Patient's natural respiratory frequency at rest" },
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
          const hasValue = typeof c.value === "number" && Number.isFinite(c.value);
          const cls: Cls | null = hasValue ? classify(c.value as number, c.norm) : null;
          const color = cls ? classColor(cls) : "hsl(var(--muted-foreground))";
          const isOut = cls !== null && cls !== "normal";
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
                  {hasValue ? (c.value as number).toFixed(2) : "—"}
                </span>
                {hasValue && c.unit && <span className="text-[10px] text-muted-foreground/70 ps-text-mono">{c.unit}</span>}
              </div>
              <div className="mt-1 text-[10px]" style={{ color }}>
                {cls ? `${classLabel(cls)} · norm ${c.norm.lo}–${c.norm.hi}` : "Not assessed"}
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
