import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";

interface ContraindictionsPanelProps {
  contraindications: string[];
}

export function ContraindicationsPanel({ contraindications }: ContraindictionsPanelProps) {
  if (contraindications.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.6 }}
      className="rounded-2xl p-5"
      style={{
        background: "hsl(0 72% 51% / 0.06)",
        border: "1px solid hsl(0 72% 51% / 0.35)",
        boxShadow: "0 0 20px hsl(0 72% 51% / 0.08)",
      }}
      data-testid="contraindications-panel"
    >
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(0 72% 60%)" }} />
        <h3 className="text-xs tracking-[0.15em] uppercase font-medium" style={{ color: "hsl(0 72% 60%)" }}>
          Contraindications
        </h3>
      </div>
      <ul className="space-y-2">
        {contraindications.map((c, i) => (
          <li key={i} className="flex items-start gap-2 text-sm" style={{ color: "hsl(0 72% 70%)" }}>
            <span className="w-1 h-1 rounded-full mt-2 flex-shrink-0" style={{ background: "hsl(0 72% 60%)" }} />
            {c}
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
