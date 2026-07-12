import { motion } from "framer-motion";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";
import type { ANSReport } from "@shared/schema";

interface IndicationsPanelProps {
  report: ANSReport;
}

const SEVERITY_STYLES: Record<string, { ring: string; bg: string; icon: string; label: string }> = {
  high:     { ring: "ring-red-500/40",    bg: "bg-red-500/10",    icon: "text-red-400",    label: "High" },
  moderate: { ring: "ring-amber-500/40",  bg: "bg-amber-500/10",  icon: "text-amber-400",  label: "Moderate" },
  low:      { ring: "ring-sky-500/40",    bg: "bg-sky-500/10",    icon: "text-sky-400",    label: "Low" },
};

/**
 * Path B — Colombo P&S indications panel.
 * Surfaces auto-detected CAN/AAN/SE/PE/OD/POTS/VVS/Pre-POTS/baroreceptor/
 * neurogenic & cardiogenic syncope risk / Cheynes-Stokes / orthostatic
 * hypotension findings.
 */
export function IndicationsPanel({ report }: IndicationsPanelProps) {
  const indications = report.indications ?? [];
  if (indications.length === 0) {
    return (
      <section className="ps-glass p-6">
        <h3 className="ps-overline mb-2 ps-underline-cyan">
          Colombo P&amp;S Indications
        </h3>
        <p className="text-sm text-muted-foreground">
          No automated abnormalities among assessed measurements; spectral and BP domains not assessed.
        </p>
      </section>
    );
  }

  // Sort: high → moderate → low
  const order: Record<string, number> = { high: 0, moderate: 1, low: 2 };
  const sorted = [...indications].sort((a, b) => order[a.severity] - order[b.severity]);

  return (
    <section className="ps-glass p-6 space-y-4" data-testid="indications-panel">
      <header className="flex items-baseline justify-between">
        <h3 className="ps-overline ps-underline-cyan">
          Colombo P&amp;S Indications
        </h3>
        <span className="text-xs text-muted-foreground ps-text-mono">
          {sorted.length} finding{sorted.length === 1 ? "" : "s"} detected
        </span>
      </header>

      <div className="grid gap-3 lg:grid-cols-2">
        {sorted.map((ind, i) => {
          const style = SEVERITY_STYLES[ind.severity] ?? SEVERITY_STYLES.low;
          const Icon = ind.severity === "high" ? AlertTriangle : ind.severity === "moderate" ? AlertCircle : Info;
          return (
            <motion.article
              key={ind.code + i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.3 }}
              className={`rounded-lg ring-1 ${style.ring} ${style.bg} p-4 flex gap-3`}
              data-testid={`indication-${ind.code}`}
            >
              <Icon className={`size-5 shrink-0 mt-0.5 ${style.icon}`} aria-hidden />
              <div className="space-y-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h4 className="text-sm font-semibold text-foreground">{ind.name}</h4>
                  <span className={`text-[10px] font-mono uppercase tracking-wider ${style.icon}`}>
                    {style.label}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{ind.description}</p>
              </div>
            </motion.article>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground/70 pt-1">
        Indications are derived directly from Colombo P&amp;S measurement thresholds applied to this patient's six-phase event-mean data. They are clinical findings, not diagnoses.
      </p>
    </section>
  );
}
