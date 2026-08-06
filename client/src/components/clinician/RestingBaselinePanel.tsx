import { motion } from "framer-motion";
import type { ANSReport } from "@shared/schema";
import { COLOMBO_NORMS, classifySpectral, type SpectralClass } from "@shared/colomboNorms";
import { ESTIMATE_BADGE, ESTIMATE_TITLE, isEstimatedPhase } from "@/lib/spectralProvenance";

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

/** Short human label + color for a metric-provenance method. */
function provenanceBadge(method: string | undefined): { label: string; color: string } | null {
  switch (method) {
    case "vendor_reported":
      return { label: "Vendor-reported", color: "hsl(160 60% 55%)" };
    case "derived_from_vendor":
      return { label: "Derived from vendor", color: "hsl(190 70% 55%)" };
    case "measured":
      return { label: "Measured", color: "hsl(160 60% 55%)" };
    case "computed":
      return { label: "Computed", color: "hsl(48 90% 60%)" };
    case "unavailable":
      return { label: "Not assessed", color: "hsl(var(--muted-foreground))" };
    default:
      return null;
  }
}

/**
 * Resting baseline panel — surfaces the four key Phase A spectral metrics
 * (LFa, RFa, sympathovagal balance LFa/RFa, FRF) with a clear in/out-of-norm
 * indicator. Sympathovagal balance is added per Colombo's request because it
 * is the single most diagnostic resting parameter. FRF is highlighted with
 * its numeric value whenever it falls outside the Colombo 0.09–0.15 Hz band.
 */
function EstimateNote() {
  return (
    <p
      className="mt-3 text-[10px] leading-relaxed text-violet-200/75"
      data-testid="resting-baseline-estimated-note"
    >
      {ESTIMATE_BADGE}: LFa, RFa and sympathovagal balance above are computed by
      HumanOS from the ECG-derived R-R series (Morlet wavelet band power, bpm²),
      not read from a PhysioPS report. No Colombo norm classification is applied
      to an estimate, and these values do not feed the score, the patterns, the
      therapy list or anything the patient sees.
    </p>
  );
}

export function RestingBaselinePanel({ report }: RestingBaselinePanelProps) {
  const A = report.phaseEvents?.[0];
  if (!A) return null;

  // Waveform-derived (estimated) values ARE shown — they are real measurements
  // of the R-R series — but they are never classified against the Colombo norms
  // and never coloured normal/abnormal. Only vendor-reported values may be.
  const estimated = isEstimatedPhase(A);

  // Spectral aggregates (LFa/RFa/SB/FRF) are null when not reproducible from a
  // raw ECG-only recording. Never coerce null to a number or call toFixed on it
  // — render "Not assessed" and never fabricate a 0 balance.
  const spectralOk = report.spectralAvailable !== false;
  // Show a value when the vendor supplied it OR when HumanOS estimated it.
  const showValue = spectralOk || estimated;
  const sb =
    showValue && typeof A.LFa === "number" && typeof A.RFa === "number" && A.RFa > 0
      ? A.LFa / A.RFa
      : null;

  const prov = A.provenance;
  const cards: {
    label: string;
    value: number | null;
    unit: string;
    norm: { lo: number; hi: number };
    explainer?: string;
    method?: string;
  }[] = [
    { label: "LFa (Sympathetic)", value: showValue ? A.LFa : null, unit: "bpm²", norm: NORMS.LFa, explainer: "Low-frequency wavelet power at rest", method: prov?.LFa?.method },
    { label: "RFa (Parasympathetic)", value: showValue ? A.RFa : null, unit: "bpm²", norm: NORMS.RFa, explainer: "Respiratory-frequency wavelet power at rest", method: prov?.RFa?.method },
    { label: "Sympathovagal Balance (LFa/RFa)", value: sb, unit: "", norm: NORMS.SB, explainer: "Resting LFa/RFa balance ratio", method: prov?.SB?.method },
    { label: "FRF (Fundamental Respiratory Freq.)", value: showValue ? A.FRF : null, unit: "Hz", norm: NORMS.FRF, explainer: "Patient's natural respiratory frequency at rest", method: prov?.FRF?.method },
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
          // NO classification for an estimate: an unvalidated number must not be
          // rendered as normal or abnormal against the vendor's norm bands.
          const cls: Cls | null = hasValue && !estimated ? classify(c.value as number, c.norm) : null;
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
                <span
                  className="text-xl font-semibold tabular-nums ps-text-mono"
                  style={estimated ? undefined : { color }}
                  title={estimated ? ESTIMATE_TITLE : undefined}
                >
                  {hasValue ? (c.value as number).toFixed(2) : "—"}
                </span>
                {hasValue && c.unit && <span className="text-[10px] text-muted-foreground/70 ps-text-mono">{c.unit}</span>}
              </div>
              <div className="mt-1 text-[10px]" style={{ color }}>
                {cls
                  ? `${classLabel(cls)} · norm ${c.norm.lo}–${c.norm.hi}`
                  : hasValue && estimated
                    ? "est. · HumanOS estimate, norm not applied"
                    : "Not assessed"}
              </div>
              {(() => {
                const badge = provenanceBadge(c.method);
                if (!badge) return null;
                return (
                  <div
                    className="mt-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide"
                    style={{ color: badge.color, background: `${badge.color.replace(")", " / 0.12)")}` }}
                    data-testid={`baseline-provenance-${c.label.split(" ")[0].toLowerCase()}`}
                    data-method={c.method}
                  >
                    {badge.label}
                  </div>
                );
              })()}
              {isOut && c.explainer && (
                <div className="mt-1 text-[10px] text-muted-foreground/70 leading-snug">
                  {c.explainer}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {estimated ? <EstimateNote /> : null}
    </motion.div>
  );
}
