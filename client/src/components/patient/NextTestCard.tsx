import { motion } from "framer-motion";
import type { ANSReport } from "@shared/schema";
import { Calendar } from "lucide-react";

interface NextTestCardProps {
  followUp: ANSReport["followUp"];
}

export function NextTestCard({ followUp }: NextTestCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.8 }}
      className="rounded-2xl border border-border/30 p-5"
      style={{ background: "hsl(185 85% 42% / 0.06)", borderColor: "hsl(185 85% 42% / 0.25)" }}
      data-testid="next-test-card"
    >
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="w-4 h-4" style={{ color: "hsl(185 85% 55%)" }} />
        <h3 className="text-xs tracking-[0.15em] uppercase font-medium" style={{ color: "hsl(185 85% 55%)" }}>
          Next ANS Test
        </h3>
      </div>

      <p className="text-xl font-bold mb-1" style={{ color: "hsl(185 85% 55%)" }}>
        {followUp.retestInterval}
      </p>
      <p className="text-xs text-muted-foreground leading-relaxed mb-4">{followUp.rationale}</p>

      {followUp.monitorParameters.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Watch for:</p>
          <ul className="space-y-1.5">
            {followUp.monitorParameters.map((param, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <span className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0" style={{ background: "hsl(185 85% 42%)" }} />
                {param}
              </li>
            ))}
          </ul>
        </div>
      )}
    </motion.div>
  );
}
