import { motion } from "framer-motion";
import type { TherapyRecommendation } from "@shared/schema";
import { Pill } from "lucide-react";

interface SupplementsPanelProps {
  recommendations: TherapyRecommendation[];
}

export function SupplementsPanel({ recommendations }: SupplementsPanelProps) {
  const supplements = recommendations.filter(r =>
    r.category === "Neuroprotective" || r.category === "Therapeutic Target"
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.6 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="supplements-panel"
    >
      <div className="flex items-center gap-2 mb-4">
        <Pill className="w-4 h-4" style={{ color: "hsl(185 85% 42%)" }} />
        <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium">
          Supplements to Consider
        </h3>
      </div>

      {supplements.length === 0 ? (
        <p className="text-sm text-muted-foreground">Your physician will advise on supplementation.</p>
      ) : (
        <div className="space-y-4">
          {supplements.map((r, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 * i }}
              className="border-l-2 pl-3 space-y-1"
              style={{ borderColor: "hsl(185 85% 42% / 0.5)" }}
            >
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">{r.intervention}</p>
                {r.priority === "primary" && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                    style={{ background: "hsl(185 85% 42% / 0.15)", color: "hsl(185 85% 55%)" }}>
                    Primary
                  </span>
                )}
              </div>
              {r.dose && <p className="text-xs text-muted-foreground">Dose: {r.dose}</p>}
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
    </motion.div>
  );
}
