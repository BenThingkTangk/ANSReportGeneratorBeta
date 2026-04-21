import { motion } from "framer-motion";
import type { DysfunctionPatterns } from "@shared/schema";
import { CheckCircle } from "lucide-react";

interface PatternChipsProps {
  patterns: DysfunctionPatterns;
}

const patternLabels: Record<keyof DysfunctionPatterns, string> = {
  parasympatheticDominance: "Parasympathetic Dominance at Rest",
  parasympatheticExcess: "Parasympathetic Excess on Standing",
  parasympatheticWithdrawal: "Reduced Parasympathetic Response",
  sympatheticExcess: "Sympathetic Overactivation",
  sympatheticWithdrawal: "Sympathetic Under-response",
  maskedSW: "Masked Sympathetic Withdrawal",
  advancedAutonomicDysfunction: "Advanced Autonomic Dysfunction",
  CAN: "Cardiac Autonomic Neuropathy",
  POTS: "Postural Orthostatic Tachycardia (POTS)",
  orthostaticHypotension: "Orthostatic Hypotension",
  vasovagalRisk: "Vasovagal Risk",
  preSyncopeRisk: "Pre-Syncope Risk",
  bradycardia: "Low Resting Heart Rate",
  highFRF: "Breathing Irregularity Noted",
};

export function PatternChips({ patterns }: PatternChipsProps) {
  const active = (Object.keys(patterns) as (keyof DysfunctionPatterns)[]).filter(k => patterns[k]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.5 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="pattern-chips"
    >
      <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium mb-3">
        Patterns Detected
      </h3>
      <div className="flex flex-wrap gap-2">
        {active.length === 0 ? (
          <span
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border"
            style={{ color: "hsl(140 60% 55%)", borderColor: "hsl(140 60% 50% / 0.4)", background: "hsl(140 60% 50% / 0.08)" }}
          >
            <CheckCircle className="w-3 h-3" />
            All Clear
          </span>
        ) : (
          active.map((key, i) => (
            <motion.span
              key={key}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.05 * i }}
              className="px-3 py-1.5 rounded-full text-xs font-medium border"
              style={{
                color: "hsl(35 90% 65%)",
                borderColor: "hsl(35 90% 55% / 0.4)",
                background: "hsl(35 90% 55% / 0.08)",
              }}
            >
              {patternLabels[key]}
            </motion.span>
          ))
        )}
      </div>
    </motion.div>
  );
}
