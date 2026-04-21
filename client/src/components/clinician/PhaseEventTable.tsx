import { motion } from "framer-motion";
import type { PhaseMetrics } from "@shared/schema";

interface PhaseEventTableProps {
  phaseEvents: PhaseMetrics[];
}

const PHASE_LABELS = [
  { phase: "Baseline-A",      short: "Baseline A" },
  { phase: "DeepBreathing-B", short: "DB B" },
  { phase: "Baseline-C",      short: "Baseline C" },
  { phase: "Valsalva-D",      short: "Valsalva D" },
  { phase: "Baseline-E",      short: "Baseline E" },
  { phase: "Stand-F",         short: "Stand F" },
];

// Colombo norms for color-coding
const NORMS = {
  FRF:  { lo: 0.15, hi: 0.40 },
  LFa:  { lo: 0.0,  hi: 8.0  },
  RFa:  { lo: 0.5,  hi: 6.0  },
  SB:   { lo: 0.4,  hi: 3.0  },
};

function cellColor(val: number, norm: { lo: number; hi: number }): string {
  if (val < norm.lo) return "hsl(35 90% 60%)";
  if (val > norm.hi) return "hsl(0 72% 60%)";
  return "inherit";
}

function fmt(v: number | undefined, digits = 2): string {
  if (v === undefined || v === null) return "—";
  return v.toFixed(digits);
}

export function PhaseEventTable({ phaseEvents }: PhaseEventTableProps) {
  // Build a lookup map phase → metrics
  const phaseMap = new Map<string, PhaseMetrics>();
  phaseEvents.forEach(p => phaseMap.set(p.phase, p));

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5 overflow-x-auto"
      data-testid="phase-event-table"
    >
      <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium mb-4">
        6-Phase Event Data
      </h3>
      <table className="w-full text-xs border-collapse min-w-[600px]">
        <thead>
          <tr className="border-b border-border/30">
            {["Phase", "Duration", "HR (mean ± range)", "FRF", "LFa", "RFa", "SB", "BP"].map(h => (
              <th key={h} className="text-left py-2 pr-4 text-[10px] uppercase tracking-wider text-muted-foreground font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PHASE_LABELS.map((pl, i) => {
            const m = phaseMap.get(pl.phase);
            return (
              <tr key={pl.phase} className={`border-b border-border/20 ${i % 2 === 0 ? "bg-card/20" : ""}`}>
                <td className="py-2.5 pr-4 font-medium whitespace-nowrap">{pl.short}</td>
                <td className="py-2.5 pr-4 tabular-nums text-muted-foreground">{m?.duration ?? "—"}</td>
                <td className="py-2.5 pr-4 tabular-nums">
                  {m ? `${Math.round(m.meanHR)} ± ${Math.round(m.rangeHR)}` : "—"}
                </td>
                <td className="py-2.5 pr-4 tabular-nums" style={{ color: m ? cellColor(m.FRF, NORMS.FRF) : "inherit" }}>
                  {fmt(m?.FRF)}
                </td>
                <td className="py-2.5 pr-4 tabular-nums" style={{ color: m ? cellColor(m.LFa, NORMS.LFa) : "inherit" }}>
                  {fmt(m?.LFa)}
                </td>
                <td className="py-2.5 pr-4 tabular-nums" style={{ color: m ? cellColor(m.RFa, NORMS.RFa) : "inherit" }}>
                  {fmt(m?.RFa)}
                </td>
                <td className="py-2.5 pr-4 tabular-nums" style={{ color: m ? cellColor(m.SB, NORMS.SB) : "inherit" }}>
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

      {/* Legend */}
      <div className="mt-3 pt-3 border-t border-border/20">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground/60">Legend: </span>
          LFa = Sympathetic Activity (bpm²) · RFa = Parasympathetic Activity (bpm²) · FRF = Fundamental Respiratory Frequency (Hz) · SB = Sympathovagal Balance (LFa/RFa)
        </p>
        <p className="text-[10px] mt-1">
          <span style={{ color: "hsl(35 90% 60%)" }}>■ Below norm</span>
          <span className="mx-2 text-muted-foreground">·</span>
          <span style={{ color: "hsl(0 72% 60%)" }}>■ Above norm</span>
        </p>
      </div>
    </motion.div>
  );
}
