/**
 * WhyExpander
 *
 * Collapsible "Why this conclusion?" panel rendered under a finding,
 * phenotype, or domain score in the report. Shows:
 *   - The deterministic rule trace (rationale + criteria)
 *   - The exact AnsStudy fields consumed (with values)
 *   - The confidence level
 *   - Threshold reference if available
 *
 * Pure presentational — the parent passes structured props.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, BookOpen } from "lucide-react";

export interface WhyCriterion {
  description: string;
  met: boolean;
  sourceField?: string;
  observedValue?: string | number | null;
}

export interface WhyExpanderProps {
  rationale: string;
  confidence: "High" | "Medium" | "Low";
  sourceFields: { path: string; value?: string | number | null }[];
  criteria?: WhyCriterion[];
  thresholdRef?: string;
  /** Optional list of citations from the evidence layer. */
  citations?: { title: string; authors?: string | null; year?: number | null; url?: string | null }[];
  /** Hide by default. */
  defaultOpen?: boolean;
}

export function WhyExpander({
  rationale,
  confidence,
  sourceFields,
  criteria,
  thresholdRef,
  citations,
  defaultOpen = false,
}: WhyExpanderProps) {
  const [open, setOpen] = useState(defaultOpen);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="mt-2 rounded-lg border border-border/30 bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground hover:bg-card/40 transition-colors rounded-lg"
        data-testid="why-toggle"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <BookOpen className="w-3 h-3" />
          Why this conclusion?
        </span>
        <Chevron className="w-3 h-3" />
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 space-y-3 text-[12px] leading-relaxed">
          {/* Rationale */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Deterministic rule
            </div>
            <p>{rationale}</p>
          </div>

          {/* Criteria */}
          {criteria && criteria.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Criteria
              </div>
              <ul className="space-y-1">
                {criteria.map((c, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className="mt-1 inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{
                        background: c.met
                          ? "var(--color-status-optimal, #10b981)"
                          : "var(--color-text-muted, #94a3b8)",
                      }}
                      aria-hidden="true"
                    />
                    <span className="flex-1">
                      <span className={c.met ? "" : "text-muted-foreground"}>
                        {c.description}
                      </span>
                      {c.sourceField && (
                        <span
                          className="ml-1 text-[10px] text-muted-foreground"
                          style={{ fontFamily: "var(--ps-font-mono, ui-monospace)" }}
                        >
                          [{c.sourceField}
                          {c.observedValue !== undefined && c.observedValue !== null
                            ? ` = ${c.observedValue}`
                            : ""}
                          ]
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Inputs */}
          {sourceFields.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Inputs used
              </div>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-0.5">
                {sourceFields.map((f, i) => (
                  <li
                    key={`${f.path}-${i}`}
                    className="text-[11px]"
                    style={{ fontFamily: "var(--ps-font-mono, ui-monospace)" }}
                  >
                    <span className="text-muted-foreground">{f.path}</span>
                    {f.value !== undefined && f.value !== null && (
                      <span className="ml-1">= {String(f.value)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Threshold */}
          {thresholdRef && (
            <div className="text-[11px]">
              <span className="text-muted-foreground">Threshold reference: </span>
              <span style={{ fontFamily: "var(--ps-font-mono, ui-monospace)" }}>
                {thresholdRef}
              </span>
            </div>
          )}

          {/* Confidence */}
          <div className="text-[11px]">
            <span className="text-muted-foreground">Confidence: </span>
            <span
              className="inline-block px-1.5 py-0.5 rounded-full text-[10px] uppercase tracking-wider"
              style={{
                background:
                  confidence === "High"
                    ? "rgba(16,185,129,0.12)"
                    : confidence === "Medium"
                      ? "rgba(245,158,11,0.12)"
                      : "rgba(239,68,68,0.12)",
                color:
                  confidence === "High"
                    ? "var(--color-status-optimal, #10b981)"
                    : confidence === "Medium"
                      ? "var(--color-status-watch, #f59e0b)"
                      : "var(--color-status-risk, #ef4444)",
                border: "1px solid currentColor",
              }}
            >
              {confidence}
            </span>
          </div>

          {/* Optional evidence citations */}
          {citations && citations.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Cited sources
              </div>
              <ul className="space-y-1">
                {citations.map((c, i) => (
                  <li key={i} className="text-[11px]">
                    {c.url ? (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:no-underline"
                        style={{ color: "var(--ps-brand-cyan, #4a9eff)" }}
                      >
                        {c.title}
                      </a>
                    ) : (
                      <span>{c.title}</span>
                    )}
                    <span className="text-muted-foreground">
                      {c.authors ? ` — ${c.authors}` : ""}
                      {c.year ? ` (${c.year})` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
