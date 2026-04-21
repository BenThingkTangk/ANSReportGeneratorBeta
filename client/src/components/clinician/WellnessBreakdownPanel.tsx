import { motion } from "framer-motion";
import type { WellnessBreakdown } from "@shared/schema";

interface WellnessBreakdownPanelProps {
  breakdown: WellnessBreakdown;
  wellnessScore: number;
}

const subScoreLabels = [
  { key: "baselineAutonomic",     label: "Baseline Autonomic" },
  { key: "sympathovagalBalance",  label: "Sympathovagal Balance" },
  { key: "reflexIntegrity",       label: "Reflex Integrity" },
  { key: "orthostaticResponse",   label: "Orthostatic Response" },
  { key: "hrvReserve",            label: "HRV Reserve" },
] as const;

function scoreColor(score: number): string {
  if (score >= 75) return "hsl(140 60% 55%)";
  if (score >= 50) return "hsl(185 85% 50%)";
  if (score >= 30) return "hsl(35 90% 55%)";
  return "hsl(0 72% 55%)";
}

export function WellnessBreakdownPanel({ breakdown, wellnessScore }: WellnessBreakdownPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.65 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="wellness-breakdown-panel"
    >
      <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium mb-4">
        Wellness Score Breakdown
      </h3>

      <div className="space-y-4">
        {subScoreLabels.map(({ key, label }, i) => {
          const sub = breakdown[key];
          return (
            <motion.div
              key={key}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.06 * i }}
              className="space-y-1.5"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{label}</span>
                <div className="flex items-center gap-3 text-muted-foreground text-[10px]">
                  <span>Weight: {(sub.weight * 100).toFixed(0)}%</span>
                  <span>Score: <span className="font-semibold tabular-nums" style={{ color: scoreColor(sub.score) }}>{sub.score.toFixed(1)}</span></span>
                  <span>Contrib: <span className="font-semibold tabular-nums">{sub.contribution.toFixed(1)}</span></span>
                </div>
              </div>
              <div className="w-full h-1.5 rounded-full bg-[hsl(210_12%_15%)] overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, sub.score)}%` }}
                  transition={{ delay: 0.2 + 0.05 * i, duration: 0.8 }}
                  className="h-full rounded-full"
                  style={{ background: scoreColor(sub.score) }}
                />
              </div>
              {sub.notes.length > 0 && (
                <ul className="space-y-0.5 pl-2">
                  {sub.notes.map((n, ni) => (
                    <li key={ni} className="text-[10px] text-muted-foreground">• {n}</li>
                  ))}
                </ul>
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="mt-4 pt-3 border-t border-border/20 grid grid-cols-3 gap-3 text-xs text-center">
        <div>
          <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Age Multiplier</p>
          <p className="font-semibold tabular-nums mt-0.5">{breakdown.ageMultiplier.toFixed(3)}×</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Raw Total</p>
          <p className="font-semibold tabular-nums mt-0.5">{breakdown.rawTotal.toFixed(1)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Final Score</p>
          <p className="font-bold tabular-nums mt-0.5" style={{ color: scoreColor(wellnessScore) }}>{breakdown.final.toFixed(1)}</p>
        </div>
      </div>
    </motion.div>
  );
}
