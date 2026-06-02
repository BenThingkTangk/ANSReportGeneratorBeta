import type { AnsStudy } from "@shared/ansStudy";
import { GitMerge } from "lucide-react";

interface Conflict {
  label: string;
  detail: string;
  severity: "warn" | "error";
}

/**
 * Walks the AnsStudy looking for internal contradictions worth surfacing.
 * Examples:
 *   - DOB age ≠ extracted age (off by more than 1 year)
 *   - Resting HR vs Baseline HR mismatch
 *   - SBP < DBP
 *   - Resting LFa / RFa contradict the SB ratio
 *   - parser flagged extractionWarnings with severity="error"
 */
function collectConflicts(study: AnsStudy): Conflict[] {
  const out: Conflict[] = [];

  // DOB-derived age vs extracted age
  const dob = study.patient.dob.value;
  const ageAt = study.patient.ageAtStudy.value;
  if (dob && ageAt !== null) {
    const studyDateStr = study.fileMetadata.studyDate.value;
    if (studyDateStr) {
      const d = new Date(dob);
      const s = new Date(studyDateStr);
      if (!isNaN(d.getTime()) && !isNaN(s.getTime())) {
        const diff = s.getTime() - d.getTime();
        const yearsFromDob = diff / (365.25 * 24 * 60 * 60 * 1000);
        if (Math.abs(yearsFromDob - ageAt) > 1.5) {
          out.push({
            label: "Age mismatch",
            detail: `DOB suggests ${yearsFromDob.toFixed(1)} yr but file reports ${ageAt}.`,
            severity: "warn",
          });
        }
      }
    }
  }

  // SBP < DBP (impossible)
  for (const [name, phase] of [
    ["Baseline", study.baseline],
    ["Standing", study.standOrTilt],
    ["Valsalva", study.valsalva],
    ["Deep breathing", study.deepBreathing],
  ] as const) {
    const s = phase.bp.sbp.value;
    const d = phase.bp.dbp.value;
    if (s !== null && d !== null && s < d) {
      out.push({
        label: `${name} BP swapped?`,
        detail: `SBP ${s} mmHg < DBP ${d} mmHg — physiologically impossible.`,
        severity: "error",
      });
    }
  }

  // Resting SB vs computed LFa/RFa
  const rLfa = study.sympatheticParasympathetic.restingLfa.value;
  const rRfa = study.sympatheticParasympathetic.restingRfa.value;
  const rSb = study.sympatheticParasympathetic.restingSb.value;
  if (rLfa !== null && rRfa !== null && rRfa > 0 && rSb !== null) {
    const computed = rLfa / rRfa;
    if (Math.abs(computed - rSb) / Math.max(rSb, 0.01) > 0.5) {
      out.push({
        label: "Resting SB does not match LFa/RFa",
        detail: `LFa/RFa would compute ${computed.toFixed(2)} but file reports SB=${rSb.toFixed(2)}.`,
        severity: "warn",
      });
    }
  }

  // Parser-flagged errors
  for (const w of study.extractionWarnings) {
    if (w.severity === "error") {
      out.push({
        label: w.code,
        detail: w.message,
        severity: "error",
      });
    }
  }

  return out;
}

export function ConflictingDataCard({ study }: { study: AnsStudy }) {
  const conflicts = collectConflicts(study);

  return (
    <section
      className="rounded-2xl bg-card/50 border p-4 md:p-5"
      style={{
        borderColor: conflicts.some((c) => c.severity === "error")
          ? "rgba(239,68,68,0.35)"
          : "var(--border, rgba(255,255,255,0.08))",
      }}
      data-testid="card-conflicts"
    >
      <header className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <GitMerge
            className="w-4 h-4"
            style={{
              color:
                conflicts.length > 0
                  ? "var(--color-status-risk, #ef4444)"
                  : "var(--ps-brand-cyan, #4a9eff)",
            }}
          />
          <h3 className="text-[11px] tracking-[0.18em] uppercase text-muted-foreground font-medium">
            Conflicting data
          </h3>
        </div>
        <span
          className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-full"
          style={{
            color:
              conflicts.length > 0
                ? "var(--color-status-risk, #ef4444)"
                : "var(--color-status-optimal, #10b981)",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          {conflicts.length}
        </span>
      </header>

      {conflicts.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No internal contradictions detected between the extracted fields.
        </p>
      ) : (
        <ul className="space-y-2">
          {conflicts.map((c, i) => (
            <li key={i} className="flex items-start gap-2 text-[12px] leading-snug">
              <span
                className="mt-1 inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{
                  background:
                    c.severity === "error"
                      ? "var(--color-status-risk, #ef4444)"
                      : "var(--color-status-watch, #f59e0b)",
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{c.label}</div>
                <div className="text-muted-foreground">{c.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
