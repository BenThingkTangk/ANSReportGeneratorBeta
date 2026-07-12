import { motion, useReducedMotion } from "framer-motion";
import { RefreshCw, Sparkles } from "lucide-react";

interface ClinicianSynopsisProps {
  synopsis: string | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** True while the best-effort AI enrichment is in flight. The deterministic
   *  synopsis stays fully visible; only a small non-blocking badge appears. */
  enhancing?: boolean;
}

export function ClinicianSynopsis({ synopsis, loading, error, onRetry, enhancing }: ClinicianSynopsisProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="clinician-synopsis"
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium">
          Clinical Interpretation — Atom Summary
        </h3>
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
        <div className="space-y-2.5">
          <p className="text-xs text-muted-foreground italic mb-3">Generating clinical synopsis…</p>
          {[100, 92, 96, 85, 70].map((w, i) => (
            <div
              key={i}
              className="h-2.5 rounded-full animate-pulse"
              style={{ width: `${w}%`, background: "hsl(210 12% 20%)", animationDelay: `${i * 120}ms` }}
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
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
          <p className="text-sm leading-6 text-foreground/85 whitespace-pre-wrap">{synopsis}</p>
          <p className="text-[10px] text-muted-foreground mt-3 pt-3 border-t border-border/20">
            — Powered by ATOM
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}
