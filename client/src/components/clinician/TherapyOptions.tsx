import { motion } from "framer-motion";
import type { TherapyRecommendation } from "@shared/schema";

interface TherapyOptionsProps {
  recommendations: TherapyRecommendation[];
}

const priorityOrder: TherapyRecommendation["priority"][] = ["primary", "secondary", "optional"];
const priorityStyles = {
  primary:   { color: "hsl(185 85% 55%)", bg: "hsl(185 85% 42% / 0.1)", border: "hsl(185 85% 42% / 0.3)", label: "Primary" },
  secondary: { color: "hsl(35 90% 60%)",  bg: "hsl(35 90% 55% / 0.08)", border: "hsl(35 90% 55% / 0.25)", label: "Secondary" },
  optional:  { color: "hsl(210 10% 55%)", bg: "hsl(210 12% 15%)",       border: "hsl(210 15% 20%)",        label: "Optional" },
};

export function TherapyOptions({ recommendations }: TherapyOptionsProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.55 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="therapy-options"
    >
      <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium mb-4">
        Therapy Options
      </h3>

      <div className="space-y-6">
        {priorityOrder.map(priority => {
          const items = recommendations.filter(r => r.priority === priority);
          if (items.length === 0) return null;
          const style = priorityStyles[priority];
          return (
            <div key={priority}>
              <p className="text-[10px] uppercase tracking-widest font-semibold mb-3" style={{ color: style.color }}>
                {style.label}
              </p>
              <div className="space-y-3">
                {items.map((r, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.06 * i }}
                    className="rounded-xl p-3.5 border"
                    style={{ background: style.bg, borderColor: style.border }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-sm font-semibold">{r.intervention}</p>
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">{r.category}</span>
                    </div>
                    {r.dose && (
                      <p className="text-xs text-muted-foreground mb-1">
                        <span className="font-medium">Dose:</span> {r.dose}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground leading-relaxed">{r.rationale}</p>
                    {r.contraindications && r.contraindications.length > 0 && (
                      <div className="mt-2 space-y-0.5">
                        {r.contraindications.map((c, ci) => (
                          <p key={ci} className="text-xs" style={{ color: "hsl(0 72% 60%)" }}>⚠ {c}</p>
                        ))}
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
