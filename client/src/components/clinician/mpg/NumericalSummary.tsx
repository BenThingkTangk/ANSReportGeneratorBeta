import { motion } from "framer-motion";
import type { ANSReport, PhaseMetrics } from "@shared/schema";
import { ColomboExplainer } from "../ColomboExplainer";

/**
 * Numerical Summary table — mirrors the bottom table on page 2 of the
 * PhysioPS Multi-Parameter Graphical report. Compact, phase-by-phase audit
 * trail of every number the graphical charts are derived from.
 */

const PHASES: { key: PhaseMetrics["phase"]; short: string; clock?: string }[] = [
  { key: "Baseline-A",      short: "Baseline A" },
  { key: "DeepBreathing-B", short: "Deep Breath B" },
  { key: "Baseline-C",      short: "Baseline C" },
  { key: "Valsalva-D",      short: "Valsalva D" },
  { key: "Baseline-E",      short: "Baseline E" },
  { key: "Stand-F",         short: "Stand F" },
];

const NORMS = {
  FRF: { lo: 0.09, hi: 0.40 },
  LFa: { lo: 0.0,  hi: 8.0  },
  RFa: { lo: 0.5,  hi: 6.0  },
  SB:  { lo: 0.4,  hi: 3.0  },
};

function cellColor(val: number | undefined, norm: { lo: number; hi: number }): string {
  if (val === undefined || val === null || !Number.isFinite(val)) return "inherit";
  if (val < norm.lo) return "hsl(35 90% 60%)";
  if (val > norm.hi) return "hsl(0 72% 62%)";
  return "hsl(140 60% 55%)";
}

function fmt(v: number | undefined, digits = 2): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

interface NumericalSummaryProps {
  report: ANSReport;
}

export function NumericalSummary({ report }: NumericalSummaryProps) {
  const phaseMap = new Map<string, PhaseMetrics>();
  report.phaseEvents.forEach((p) => phaseMap.set(p.phase, p));

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="mpg-numerical-summary"
    >
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium">
            Numerical Summary
          </h3>
          <p className="text-[11px] text-muted-foreground/70 mt-1">
            Audit trail — every number the graphical charts are derived from
          </p>
        </div>
        <div className="text-[10px] text-muted-foreground/70 tabular-nums text-right">
          <div>HR {Math.round(report.autonomicBalance.balance) || "—"} · RR cnt {report.rPeakCount}</div>
          <div>SR {report.samplingRate} Hz · FRF {report.respiratoryFrequency.toFixed(2)} Hz</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border-collapse min-w-[640px]">
          <thead>
            <tr className="border-b border-border/40">
              {["Phase", "Duration", "HR mean ± range", "FRF (Hz)", "LFa", "RFa", "LFa/RFa", "BP"].map((h) => (
                <th
                  key={h}
                  className="text-left py-2 pr-4 text-[9px] uppercase tracking-wider text-muted-foreground font-medium whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PHASES.map((pl, i) => {
              const m = phaseMap.get(pl.key);
              return (
                <tr
                  key={pl.key}
                  className={`border-b border-border/20 ${i % 2 === 0 ? "bg-card/20" : ""}`}
                  data-testid={`num-row-${pl.key}`}
                >
                  <td className="py-2.5 pr-4 font-medium whitespace-nowrap">{pl.short}</td>
                  <td className="py-2.5 pr-4 tabular-nums text-muted-foreground">{m?.duration ?? "—"}</td>
                  <td className="py-2.5 pr-4 tabular-nums">
                    {m ? `${Math.round(m.meanHR)} ± ${Math.round(m.rangeHR)}` : "—"}
                  </td>
                  <td className="py-2.5 pr-4 tabular-nums" style={{ color: cellColor(m?.FRF, NORMS.FRF) }}>
                    {fmt(m?.FRF, 3)}
                  </td>
                  <td className="py-2.5 pr-4 tabular-nums" style={{ color: cellColor(m?.LFa, NORMS.LFa) }}>
                    {fmt(m?.LFa)}
                  </td>
                  <td className="py-2.5 pr-4 tabular-nums" style={{ color: cellColor(m?.RFa, NORMS.RFa) }}>
                    {fmt(m?.RFa)}
                  </td>
                  <td className="py-2.5 pr-4 tabular-nums" style={{ color: cellColor(m?.SB, NORMS.SB) }}>
                    {fmt(m?.SB)}
                  </td>
                  <td className="py-2.5 pr-4 tabular-nums text-muted-foreground">
                    {m?.SBP && m?.DBP ? `${Math.round(m.SBP)}/${Math.round(m.DBP)}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Ratios sub-row */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MiniRatio label="E/I" value={report.ratios.eiRatio.value} normal={report.ratios.eiRatio.normal} />
        <MiniRatio label="Valsalva" value={report.ratios.valsalvaRatio.value} normal={report.ratios.valsalvaRatio.normal} />
        <MiniRatio label="30:15" value={report.ratios.thirtyFifteenRatio.value} normal={report.ratios.thirtyFifteenRatio.normal} />
      </div>

      <div className="mt-3 pt-3 border-t border-border/20 text-[10px] text-muted-foreground leading-relaxed">
        <span className="font-medium text-foreground/60">Legend:</span>{" "}
        <span style={{ color: "hsl(140 60% 55%)" }}>■ In band</span>
        <span className="mx-2">·</span>
        <span style={{ color: "hsl(35 90% 60%)" }}>■ Below norm</span>
        <span className="mx-2">·</span>
        <span style={{ color: "hsl(0 72% 62%)" }}>■ Above norm</span>
      </div>

      <ColomboExplainer chartKey="numericalSummary" />
    </motion.div>
  );
}

function MiniRatio({ label, value, normal }: { label: string; value: number; normal: string }) {
  return (
    <div className="rounded-xl bg-background/40 border border-border/20 px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="flex items-baseline justify-between gap-2 mt-0.5">
        <span className="text-lg font-semibold tabular-nums">{value.toFixed(2)}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">{normal}</span>
      </div>
    </div>
  );
}
