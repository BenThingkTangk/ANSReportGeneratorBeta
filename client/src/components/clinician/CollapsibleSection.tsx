import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";

interface CollapsibleSectionProps {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  testId?: string;
  children: ReactNode;
}

/**
 * Collapsible wrapper used to hide secondary clinical sections (Ewing
 * time-domain ratios, cardio-respiratory coupling, etc.) behind a toggle so
 * the default clinician view stays focused on the primary spectral data.
 */
export function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = false,
  testId,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-2xl bg-card/30 border border-border/30"
      data-testid={testId}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 px-5 py-3 text-left hover:bg-card/40 transition-colors rounded-2xl"
        aria-expanded={open}
        data-testid={testId ? `${testId}-button` : undefined}
      >
        <div className="min-w-0">
          <div className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium truncate">
            {title}
          </div>
          {subtitle && (
            <div className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">
              {subtitle}
            </div>
          )}
        </div>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="text-muted-foreground flex-shrink-0"
          aria-hidden="true"
        >
          <ChevronDown className="w-4 h-4" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            style={{ overflow: "hidden" }}
          >
            <div className="px-1 pb-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
