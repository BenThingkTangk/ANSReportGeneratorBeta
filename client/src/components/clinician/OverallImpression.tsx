import { motion } from "framer-motion";
import { Stethoscope } from "lucide-react";

interface OverallImpressionProps {
  impression: string;
}

export function OverallImpression({ impression }: OverallImpressionProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.45 }}
      className="rounded-2xl border p-5"
      style={{
        borderColor: "hsl(185 85% 42% / 0.35)",
        background: "hsl(185 85% 42% / 0.05)",
        boxShadow: "0 0 20px hsl(185 85% 42% / 0.08)",
      }}
      data-testid="overall-impression"
    >
      <div className="flex items-start gap-3">
        <Stethoscope className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "hsl(185 85% 50%)" }} />
        <div>
          <h3 className="text-xs tracking-[0.15em] uppercase font-medium mb-2" style={{ color: "hsl(185 85% 50%)" }}>
            Overall Clinical Impression
          </h3>
          <p className="text-sm leading-6 text-foreground/90">{impression}</p>
        </div>
      </div>
    </motion.div>
  );
}
