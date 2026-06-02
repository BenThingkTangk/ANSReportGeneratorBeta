import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, ChevronRight, AlertTriangle, ShieldCheck, FileWarning } from "lucide-react";
import type { DiagnosticSummary } from "@shared/diagnosticSummary";
import type { AnsStudy } from "@shared/ansStudy";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";

interface DataQualityPanelProps {
  summary: DiagnosticSummary;
  /** Optional — when present, surfaces parser warnings + missing sections. */
  ansStudy?: AnsStudy;
}

/**
 * Top-of-clinician-report panel that shows:
 *   - Overall report confidence (ring + badge)
 *   - Per-domain assessability (which domains were scored, which were not)
 *   - Count of abnormal findings
 *   - Phenotype checks that were BLOCKED due to missing data (collapsed)
 *   - Raw parser warnings (collapsed)
 *
 * Renders ABOVE the clinical summary so clinicians see the trust signal
 * before any conclusions. Never bloats the UI — collapsible details only.
 */
export function DataQualityPanel({ summary, ansStudy }: DataQualityPanelProps) {
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [warningsOpen, setWarningsOpen] = useState(false);

  const confidencePct = Math.round((summary.reportConfidenceScore ?? 0) * 100);
  const ringStroke =
    summary.reportConfidence === "High"
      ? "stroke-emerald-400"
      : summary.reportConfidence === "Medium"
        ? "stroke-amber-400"
        : "stroke-red-400";

  const assessedLabels: Record<string, string> = {
    cardiovagal: "Cardiovagal",
    adrenergic: "Adrenergic",
    sudomotor: "Sudomotor",
  };

  const blocked = summary.unsafeOrUnsupportedClaimsBlocked;
  const warnings = ansStudy?.extractionWarnings ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="data-quality-panel"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium">
          Data Quality &amp; Confidence
        </h3>
        <ConfidenceBadge
          confidence={summary.reportConfidence}
          label={`Report ${summary.reportConfidence}`}
          title={`Overall report confidence: ${confidencePct}%`}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-5 items-center">
        {/* Confidence ring */}
        <div className="relative w-24 h-24" aria-hidden="true">
          <svg viewBox="0 0 36 36" className="w-24 h-24 -rotate-90">
            <circle
              cx="18"
              cy="18"
              r="15.9155"
              className="fill-none stroke-border/40"
              strokeWidth="3"
            />
            <circle
              cx="18"
              cy="18"
              r="15.9155"
              className={`fill-none ${ringStroke}`}
              strokeWidth="3"
              strokeDasharray={`${confidencePct}, 100`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-semibold">{confidencePct}%</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              confidence
            </span>
          </div>
        </div>

        {/* Domain assessability + finding counts */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(["cardiovagal", "adrenergic", "sudomotor"] as const).map((d) => {
            const score =
              d === "cardiovagal"
                ? summary.cardiovagalScore
                : d === "adrenergic"
                  ? summary.adrenergicScore
                  : summary.sudomotorScore;
            return (
              <div
                key={d}
                className="rounded-lg border border-border/30 bg-background/40 p-3"
                data-testid={`domain-status-${d}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-medium">{assessedLabels[d]}</span>
                  {score.assessable ? (
                    <ConfidenceBadge confidence={score.confidence} />
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-muted-foreground/30 bg-muted/30 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Not assessed
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  {score.assessable
                    ? `${score.severity} (score ${score.value}/3)`
                    : score.notAssessedReason}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Severity rollup */}
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
        <div className="inline-flex items-center gap-1.5 rounded-md border border-border/30 bg-background/40 px-2.5 py-1">
          <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
          <span>
            Total severity{" "}
            <span className="font-semibold">
              {summary.totalAutonomicSeverityScore}/{summary.maxPossibleScore}
            </span>
          </span>
        </div>
        <div className="inline-flex items-center gap-1.5 rounded-md border border-border/30 bg-background/40 px-2.5 py-1">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
          <span>
            <span className="font-semibold">{summary.abnormalFindings.length}</span>{" "}
            abnormal {summary.abnormalFindings.length === 1 ? "finding" : "findings"}
          </span>
        </div>
        {summary.missingDomains.length > 0 && (
          <div className="inline-flex items-center gap-1.5 rounded-md border border-border/30 bg-background/40 px-2.5 py-1">
            <FileWarning className="h-3.5 w-3.5 text-muted-foreground" />
            <span>
              <span className="font-semibold">{summary.missingDomains.length}</span> domain{summary.missingDomains.length === 1 ? "" : "s"} not assessed
            </span>
          </div>
        )}
      </div>

      {/* Blocked claims (collapsed) */}
      {blocked.length > 0 && (
        <div className="mt-4 rounded-lg border border-border/30 bg-background/30">
          <button
            type="button"
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-muted/20 transition-colors"
            onClick={() => setBlockedOpen(v => !v)}
            data-testid="toggle-blocked-claims"
          >
            <span className="font-medium">
              Pattern checks not evaluated{" "}
              <span className="text-muted-foreground">({blocked.length})</span>
            </span>
            {blockedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {blockedOpen && (
            <ul className="px-3 pb-3 space-y-2 text-[11px] text-muted-foreground">
              {blocked.map((b, i) => (
                <li key={i} className="border-l border-border/40 pl-2.5">
                  <div className="font-medium text-foreground/80">{b.claim}</div>
                  <div>{b.explanation}</div>
                  {b.missingFields.length > 0 && (
                    <div className="mt-1 font-mono text-[10px] opacity-70">
                      Missing: {b.missingFields.join(", ")}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Parser warnings (collapsed) */}
      {warnings.length > 0 && (
        <div className="mt-3 rounded-lg border border-border/30 bg-background/30">
          <button
            type="button"
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-muted/20 transition-colors"
            onClick={() => setWarningsOpen(v => !v)}
            data-testid="toggle-extraction-warnings"
          >
            <span className="font-medium">
              Extraction warnings{" "}
              <span className="text-muted-foreground">({warnings.length})</span>
            </span>
            {warningsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {warningsOpen && (
            <ul className="px-3 pb-3 space-y-1.5 text-[11px] text-muted-foreground">
              {warnings.map((w, i) => (
                <li key={i} className="border-l border-border/40 pl-2.5">
                  <span
                    className={
                      w.severity === "error"
                        ? "text-red-400"
                        : w.severity === "warn"
                          ? "text-amber-400"
                          : "text-muted-foreground"
                    }
                  >
                    [{w.severity}]
                  </span>{" "}
                  <span className="font-mono text-[10px]">{w.code}</span> — {w.message}
                  {w.field && (
                    <span className="ml-1 opacity-60 font-mono text-[10px]">({w.field})</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Disclaimer */}
      <p className="mt-4 text-[10px] leading-snug text-muted-foreground/80 italic">
        {summary.disclaimer}
      </p>
    </motion.div>
  );
}
