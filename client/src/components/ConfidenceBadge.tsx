import type { Confidence } from "@shared/diagnosticSummary";

interface ConfidenceBadgeProps {
  confidence: Confidence;
  /** Optional short label override (defaults to "High" / "Medium" / "Low"). */
  label?: string;
  /** Optional tooltip text (rationale). */
  title?: string;
  className?: string;
}

/**
 * Compact confidence chip rendered inline next to a numeric finding.
 *
 *   High   → green
 *   Medium → amber
 *   Low    → red
 *
 * Use this everywhere the clinician sees a deterministic conclusion so the
 * confidence ladder is consistent across the report.
 */
export function ConfidenceBadge({
  confidence,
  label,
  title,
  className = "",
}: ConfidenceBadgeProps) {
  const palette = {
    High: {
      bg: "bg-emerald-500/15",
      border: "border-emerald-400/40",
      text: "text-emerald-300",
      dot: "bg-emerald-400",
    },
    Medium: {
      bg: "bg-amber-500/15",
      border: "border-amber-400/40",
      text: "text-amber-300",
      dot: "bg-amber-400",
    },
    Low: {
      bg: "bg-red-500/15",
      border: "border-red-400/40",
      text: "text-red-300",
      dot: "bg-red-400",
    },
  }[confidence];

  return (
    <span
      title={title}
      className={
        `inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 ` +
        `text-[10px] font-medium tracking-wide uppercase ` +
        `${palette.bg} ${palette.border} ${palette.text} ${className}`
      }
      data-testid={`confidence-badge-${confidence.toLowerCase()}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${palette.dot}`} />
      {label ?? confidence}
    </span>
  );
}
