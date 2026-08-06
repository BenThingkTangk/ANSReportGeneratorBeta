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
      {/* Header layout: on narrow viewports the chart title used to be cut off
         with an ellipsis. It now wraps onto as many lines as it needs and the
         Explain/Hide control stacks to the right (or under, on the smallest
         screens) with a 44px-tall tap target. No `truncate` anywhere. */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex flex-col sm:flex-row sm:items-center sm:justify-between items-start gap-x-3 gap-y-1 px-4 py-2.5 min-h-11 text-left hover:bg-card/50 transition-colors"
        aria-expanded={open}
      >
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 min-w-0">
          <span className="text-[10px] uppercase tracking-[0.2em] font-semibold text-emerald-300 shrink-0">
            Dr. Colombo
          </span>
          <span
            className="text-[13px] leading-snug text-foreground/85 break-words"
            data-testid={`colombo-explainer-title-${chartKey}`}
          >
            {titleOverride ?? exp.title}
          </span>
        </div>
        <span className="text-[12px] font-medium text-muted-foreground underline decoration-dotted underline-offset-2 shrink-0 self-start sm:self-auto">
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
            <div className="px-4 pb-4 pt-1 space-y-3 text-[13px] leading-relaxed">
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
        className={`text-[11px] uppercase tracking-[0.18em] font-semibold mb-1 ${
          accent ? "text-emerald-300" : "text-muted-foreground"
        }`}
      >
        {label}
      </div>
      <div className={accent ? "text-foreground italic" : "text-foreground/90"}>
        {body}
      </div>
    </div>
  );
}
