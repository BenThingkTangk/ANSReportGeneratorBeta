import { motion, useReducedMotion } from "framer-motion";
import { RefreshCw, Sparkles } from "lucide-react";
import type { ANSReport } from "@shared/schema";
import { ProvenanceChip } from "../ProvenanceChip";

interface PlainEnglishSynopsisProps {
  report: ANSReport;
  synopsis: string | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** True while best-effort AI enrichment runs; the plain-English synopsis is
   *  already visible, so this only shows a small non-blocking badge. */
  enhancing?: boolean;
}

export function PlainEnglishSynopsis({ report: _report, synopsis, loading, error, onRetry, enhancing }: PlainEnglishSynopsisProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="plain-english-synopsis"
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium">
          Your Report — Plain English
        </h3>
        <ProvenanceChip value={_report.clinicalPipeline?.mode === "canonical" ? "Not assessed" : "Clinician-approved conclusion"} />
        {enhancing && (
          <motion.span
            data-testid="synopsis-enhancing"
            className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-cyan-500/30 text-cyan-300/90 whitespace-nowrap"
            animate={reduce ? { opacity: 1 } : { opacity: [0.55, 1, 0.55] }}
            transition={reduce ? { duration: 0 } : { duration: 1.6, repeat: Infinity }}
          >
            <Sparkles className="w-3 h-3" /> Enhancing with AI…
          </motion.span>
        )}
      </div>

      {loading && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground italic mb-3">Atom is reading your report…</p>
          {[100, 90, 95, 80].map((w, i) => (
            <div
              key={i}
              className="h-3 rounded-full animate-pulse"
              style={{ width: `${w}%`, background: "hsl(210 12% 20%)", animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
      )}

      {error && !loading && (
        <div className="flex items-center gap-3">
          <p className="text-sm text-destructive flex-1">{error}</p>
          <button
            onClick={onRetry}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/40 hover:bg-card transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}

      {synopsis && !loading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
        >
          <p className="text-sm font-medium leading-7 text-foreground/90" style={{ fontFamily: "var(--font-sans)" }}>
            {synopsis}
          </p>
          <p className="text-[10px] text-muted-foreground mt-4 pt-3 border-t border-border/20">
            — Powered by ATOM
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}
