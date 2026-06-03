import type { AnsStudy } from "@shared/ansStudy";
import type { DiagnosticSummary } from "@shared/diagnosticSummary";
import { FileWarning } from "lucide-react";

interface Props {
  study: AnsStudy;
  summary?: DiagnosticSummary;
}

interface MissingItem {
  field: string;
  label: string;
  reason: string;
  severity: "critical" | "important" | "info";
}

/** Walk the AnsStudy and surface missing CRITICAL pieces with friendly labels. */
function collectMissing(study: AnsStudy, summary?: DiagnosticSummary): MissingItem[] {
  const out: MissingItem[] = [];

  // Demographics — flag missing identity fields as info (rarely blocks scoring).
  if (study.patient.dob.value === null && study.patient.ageAtStudy.value === null) {
    out.push({
      field: "patient.dob",
      label: "Date of birth + age",
      reason: "Age affects age-banded normal thresholds.",
      severity: "important",
    });
  }
  if (study.patient.sex.value === null) {
    out.push({
      field: "patient.sex",
      label: "Sex",
      reason: "Some autonomic thresholds are sex-banded.",
      severity: "info",
    });
  }

  // Required phase + BP pieces — these gate phenotype detection.
  if (!study.baseline.present) {
    out.push({
      field: "baseline",
      label: "Baseline phase",
      reason: "Cannot compute orthostatic change without a baseline.",
      severity: "critical",
    });
  }
  if (!study.standOrTilt.present) {
    out.push({
      field: "standOrTilt",
      label: "Stand / Tilt phase",
      reason: "Required to evaluate orthostatic hypotension and POTS-like patterns.",
      severity: "critical",
    });
  }
  if (study.baseline.present && study.standOrTilt.present) {
    if (
      study.baseline.bp.sbp.value === null ||
      study.standOrTilt.bp.sbp.value === null
    ) {
      out.push({
        field: "phases.standing.bp.systolic",
        label: "Standing blood pressure",
        reason: "Without standing SBP/DBP, adrenergic scoring is skipped.",
        severity: "critical",
      });
    }
  }

  if (study.ratios.eiRatio.value === null) {
    out.push({
      field: "ratios.eiRatio",
      label: "E/I ratio (deep breathing)",
      reason: "Primary cardiovagal marker — missing reduces scoring confidence.",
      severity: "critical",
    });
  }
  if (study.ratios.valsalvaRatio.value === null) {
    out.push({
      field: "ratios.valsalvaRatio",
      label: "Valsalva ratio",
      reason: "Cardiovagal + adrenergic input. Missing leaves a domain only partially assessed.",
      severity: "important",
    });
  }
  if (study.ratios.thirtyFifteenRatio.value === null) {
    out.push({
      field: "ratios.thirtyFifteenRatio",
      label: "30:15 ratio",
      reason: "Postural cardiovagal marker.",
      severity: "important",
    });
  }

  // Pull blocked claims from the scoring layer.
  if (summary) {
    for (const b of summary.unsafeOrUnsupportedClaimsBlocked) {
      out.push({
        field: b.missingFields.join(", "),
        label: `Pattern check skipped: ${b.claim.replace(/_/g, " ")}`,
        reason: b.explanation,
        severity: "important",
      });
    }
  }

  // Dedupe by field.
  const seen = new Set<string>();
  return out.filter((i) => (seen.has(i.field) ? false : (seen.add(i.field), true)));
}

const SEV_COLOR: Record<MissingItem["severity"], string> = {
  critical: "var(--color-status-risk, #ef4444)",
  important: "var(--color-status-watch, #f59e0b)",
  info: "var(--color-text-muted, #94a3b8)",
};

export function MissingDataCard({ study, summary }: Props) {
  const items = collectMissing(study, summary);

  return (
    <section
      className="rounded-2xl bg-card/50 border p-4 md:p-5"
      style={{
        borderColor:
          items.some((i) => i.severity === "critical")
            ? "rgba(239,68,68,0.35)"
            : "var(--border, rgba(255,255,255,0.08))",
      }}
      data-testid="card-missing"
    >
      <header className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <FileWarning
            className="w-4 h-4"
            style={{ color: items.length > 0 ? "var(--color-status-watch, #f59e0b)" : "var(--ps-brand-cyan, #4a9eff)" }}
          />
          <h3 className="text-[11px] tracking-[0.18em] uppercase text-muted-foreground font-medium">
            Missing critical data
          </h3>
        </div>
        <span
          className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-full"
          style={{
            color: items.length > 0 ? "var(--color-status-watch, #f59e0b)" : "var(--color-status-optimal, #10b981)",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          {items.length}
        </span>
      </header>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          Nothing critical missing. All required inputs for the standard
          autonomic scoring were extracted.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li
              key={`${it.field}-${i}`}
              className="flex items-start gap-2 text-[12px] leading-snug"
            >
              <span
                className="mt-1 inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: SEV_COLOR[it.severity] }}
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{it.label}</div>
                <div className="text-muted-foreground">{it.reason}</div>
                <div
                  className="text-[10px] mt-0.5 truncate"
                  style={{
                    fontFamily: "var(--ps-font-mono, ui-monospace)",
                    color: SEV_COLOR[it.severity],
                  }}
                  title={it.field}
                >
                  {it.field}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
