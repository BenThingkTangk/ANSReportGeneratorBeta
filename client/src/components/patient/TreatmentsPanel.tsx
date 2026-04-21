import { motion } from "framer-motion";
import type { TherapyRecommendation } from "@shared/schema";
import { Activity } from "lucide-react";

interface TreatmentsPanelProps {
  recommendations: TherapyRecommendation[];
}

export function TreatmentsPanel({ recommendations }: TreatmentsPanelProps) {
  const treatments = recommendations.filter(r =>
    r.category === "Lifestyle" || r.category === "Exercise" || r.category === "Pharmacological"
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.7 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="treatments-panel"
    >
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-4 h-4" style={{ color: "hsl(140 60% 55%)" }} />
        <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium">
          Treatments &amp; Lifestyle
        </h3>
      </div>

      {treatments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No specific lifestyle interventions flagged.</p>
      ) : (
        <div className="space-y-4">
          {treatments.map((r, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 * i }}
              className="border-l-2 pl-3 space-y-1"
              style={{ borderColor: "hsl(140 60% 50% / 0.5)" }}
            >
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">{r.intervention}</p>
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium text-muted-foreground border border-border/40">
                  {r.category}
                </span>
              </div>
              {r.dose && <p className="text-xs text-muted-foreground">Dose/Frequency: {r.dose}</p>}
              <p className="text-xs text-muted-foreground leading-relaxed">{r.rationale}</p>
              {r.contraindications && r.contraindications.length > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  {r.contraindications.map((c, ci) => (
                    <p key={ci} className="text-xs" style={{ color: "hsl(0 72% 60%)" }}>⚠ {c}</p>
                  ))}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground mt-4 pt-3 border-t border-border/20 italic">
        Discuss with your physician before starting any treatment.
      </p>
    </motion.div>
  );
}
