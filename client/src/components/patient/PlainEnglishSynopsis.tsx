import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { ANSReport } from "@shared/schema";

interface PlainEnglishSynopsisProps {
  report: ANSReport;
  synopsis: string | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function PlainEnglishSynopsis({ report: _report, synopsis, loading, error, onRetry }: PlainEnglishSynopsisProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="plain-english-synopsis"
    >
      <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium mb-3">
        Your Report — Plain English
      </h3>

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
