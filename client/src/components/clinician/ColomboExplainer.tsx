import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { getExplanation } from "@/lib/colomboAnalogies";

interface ColomboExplainerProps {
  chartKey: string;
  /** Optional override if the caller wants a custom title */
  titleOverride?: string;
}

/**
 * Under-chart explainer card showing Dr. Colombo's three-part interpretation.
 * Collapsed by default to keep the graphical section scannable; expand for prose.
 */
export function ColomboExplainer({ chartKey, titleOverride }: ColomboExplainerProps) {
  const [open, setOpen] = useState(false);
  const exp = getExplanation(chartKey);
  if (!exp) return null;

  return (
    <div className="mt-3 rounded-xl border border-border/30 bg-card/30 overflow-hidden" data-testid={`colombo-explainer-${chartKey}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-card/50 transition-colors"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-[9px] uppercase tracking-[0.2em] font-semibold text-emerald-400/80 shrink-0">
            Dr. Colombo
          </span>
          <span className="text-xs text-muted-foreground truncate">
            {titleOverride ?? exp.title}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground/70 shrink-0">
          {open ? "Hide" : "Explain"}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 space-y-3 text-[12px] leading-relaxed">
              <ExplainerRow label="What this shows" body={exp.whatThisShows} />
              <ExplainerRow label="What it means" body={exp.whatItMeans} />
              <ExplainerRow
                label="Dr. Colombo's analogy"
                body={exp.analogy}
                accent
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ExplainerRow({ label, body, accent = false }: { label: string; body: string; accent?: boolean }) {
  return (
    <div>
      <div
        className={`text-[9px] uppercase tracking-[0.18em] font-semibold mb-1 ${
          accent ? "text-emerald-400/80" : "text-muted-foreground/70"
        }`}
      >
        {label}
      </div>
      <div className={accent ? "text-foreground/90 italic" : "text-foreground/80"}>
        {body}
      </div>
    </div>
  );
}
