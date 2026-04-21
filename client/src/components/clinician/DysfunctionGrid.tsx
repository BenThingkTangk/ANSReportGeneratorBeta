import { motion } from "framer-motion";
import type { DysfunctionPatterns } from "@shared/schema";

interface DysfunctionGridProps {
  patterns: DysfunctionPatterns;
}

const patternDefs: { key: keyof DysfunctionPatterns; label: string; definition: string }[] = [
  { key: "parasympatheticDominance",     label: "Parasympathetic Dominance",      definition: "Elevated RFa at rest indicating vagal excess." },
  { key: "parasympatheticExcess",        label: "Parasympathetic Excess",         definition: "RFa rises abnormally on standing — vagal paradox." },
  { key: "parasympatheticWithdrawal",    label: "Parasympathetic Withdrawal",     definition: "RFa falls below normal during DB maneuver." },
  { key: "sympatheticExcess",            label: "Sympathetic Excess",             definition: "LFa elevated at baseline or on challenge." },
  { key: "sympatheticWithdrawal",        label: "Sympathetic Withdrawal",         definition: "LFa fails to rise on standing — sympathetic failure." },
  { key: "maskedSW",                     label: "Masked Sympathetic Withdrawal",  definition: "SW obscured by high RFa; revealed after correction." },
  { key: "advancedAutonomicDysfunction", label: "Advanced Autonomic Dysfunction", definition: "Simultaneous PE + SW indicating severe dysregulation." },
  { key: "CAN",                          label: "Cardiac Autonomic Neuropathy",   definition: "Abnormal E/I ratio indicating cardiac vagal neuropathy." },
  { key: "POTS",                         label: "POTS",                           definition: "HR rise ≥30 bpm on standing without hypotension." },
  { key: "orthostaticHypotension",       label: "Orthostatic Hypotension",        definition: "SBP drop ≥20 mmHg on standing." },
  { key: "vasovagalRisk",                label: "Vasovagal Risk",                 definition: "PE + reflex bradycardia pattern on standing." },
  { key: "preSyncopeRisk",               label: "Pre-Syncope Risk",               definition: "Combined OH + vasovagal triggers." },
  { key: "bradycardia",                  label: "Bradycardia",                    definition: "Resting HR <60 bpm at baseline." },
  { key: "highFRF",                      label: "High FRF",                       definition: "Respiratory frequency >0.4 Hz suggesting irregular breathing." },
];

export function DysfunctionGrid({ patterns }: DysfunctionGridProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.5 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="dysfunction-grid"
    >
      <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium mb-4">
        Dysfunction Pattern Matrix
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {patternDefs.map((p, i) => {
          const detected = patterns[p.key];
          return (
            <motion.div
              key={p.key}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.03 * i }}
              title={p.definition}
              className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 cursor-help"
              style={{
                background: detected
                  ? "hsl(0 72% 51% / 0.07)"
                  : "hsl(140 60% 50% / 0.04)",
                border: detected
                  ? "1px solid hsl(0 72% 51% / 0.2)"
                  : "1px solid hsl(140 60% 50% / 0.15)",
              }}
            >
              <span className="text-xs text-muted-foreground">{p.label}</span>
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                style={{
                  color: detected ? "hsl(0 72% 65%)" : "hsl(140 60% 60%)",
                  background: detected ? "hsl(0 72% 51% / 0.12)" : "hsl(140 60% 50% / 0.1)",
                }}
              >
                {detected ? "Detected" : "Clear"}
              </span>
            </motion.div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground mt-3">Hover any row for clinical definition.</p>
    </motion.div>
  );
}
