import type { AnsStudy } from "@shared/ansStudy";
import type { DiagnosticSummary } from "@shared/diagnosticSummary";
import { ShieldCheck } from "lucide-react";

interface Props {
  study: AnsStudy;
  summary?: DiagnosticSummary;
}

/**
 * Data Quality & Confidence gauge:
 *   - Big ring shows overall report confidence (combines parser + scoring).
 *   - Below: parser % + per-domain assessability mini-bars.
 *
 * Uses the same emerald/amber/red palette as DataQualityPanel for visual
 * continuity. Renders identically on mobile (single column).
 */
export function ConfidenceGauge({ study, summary }: Props) {
  const reportPct = summary
    ? Math.round((summary.reportConfidenceScore ?? 0) * 100)
    : Math.round((study.parserConfidence.overall ?? 0) * 100);

  const parserPct = Math.round((study.parserConfidence.overall ?? 0) * 100);

  const band =
    reportPct >= 75 ? "high" : reportPct >= 40 ? "medium" : "low";
  const color =
    band === "high"
      ? "var(--color-status-optimal, #10b981)"
      : band === "medium"
        ? "var(--color-status-watch, #f59e0b)"
        : "var(--color-status-risk, #ef4444)";

  const domains = summary
    ? [
        { key: "Cardiovagal", score: summary.cardiovagalScore },
        { key: "Adrenergic", score: summary.adrenergicScore },
        { key: "Sudomotor", score: summary.sudomotorScore },
      ]
    : [];

  return (
    <section
      className="rounded-2xl bg-card/50 border border-border/30 p-4 md:p-5"
      data-testid="card-confidence"
    >
      <header className="flex items-center gap-2 mb-3">
        <ShieldCheck className="w-4 h-4" style={{ color }} />
        <h3 className="text-[11px] tracking-[0.18em] uppercase text-muted-foreground font-medium">
          Data quality &amp; confidence
        </h3>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-5 items-center">
        {/* Ring */}
        <div className="relative w-24 h-24 mx-auto md:mx-0" aria-hidden="true">
          <svg viewBox="0 0 36 36" className="w-24 h-24 -rotate-90">
            <circle
              cx="18"
              cy="18"
              r="15.9155"
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="3"
            />
            <circle
              cx="18"
              cy="18"
              r="15.9155"
              fill="none"
              stroke={color}
              strokeWidth="3"
              strokeDasharray={`${reportPct}, 100`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-semibold tabular-nums" style={{ color }}>
              {reportPct}%
            </span>
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
              report
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <Bar label="Parser confidence" pct={parserPct} />
          {domains.map((d) => {
            const pct = d.score.assessable
              ? Math.round(
                  (d.score.confidence === "High"
                    ? 0.9
                    : d.score.confidence === "Medium"
                      ? 0.6
                      : 0.3) * 100
                )
              : 0;
            return (
              <Bar
                key={d.key}
                label={`${d.key} ${d.score.assessable ? `(${d.score.severity})` : "(not assessed)"}`}
                pct={pct}
                muted={!d.score.assessable}
              />
            );
          })}
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-border/30 flex flex-wrap gap-x-4 gap-y-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>
          Sections detected:{" "}
          <span className="text-foreground tabular-nums">
            {study.parserConfidence.sectionsDetected.length}
          </span>
        </span>
        <span>
          Missing fields:{" "}
          <span className="text-foreground tabular-nums">
            {study.parserConfidence.missingCount}
          </span>
        </span>
        <span>
          Low-conf fields:{" "}
          <span className="text-foreground tabular-nums">
            {study.parserConfidence.lowConfidenceCount}
          </span>
        </span>
        <span>
          Warnings:{" "}
          <span className="text-foreground tabular-nums">
            {study.extractionWarnings.length}
          </span>
        </span>
      </div>
    </section>
  );
}

function Bar({
  label,
  pct,
  muted = false,
}: {
  label: string;
  pct: number;
  muted?: boolean;
}) {
  const color =
    muted
      ? "var(--color-text-muted, #94a3b8)"
      : pct >= 75
        ? "var(--color-status-optimal, #10b981)"
        : pct >= 40
          ? "var(--color-status-watch, #f59e0b)"
          : "var(--color-status-risk, #ef4444)";
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground truncate">{label}</span>
        <span className="tabular-nums" style={{ color }}>
          {pct}%
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-border/30 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}
