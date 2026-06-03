/**
 * Provenance + confidence rendering helpers.
 *
 * Mirrors the design system: emerald = high, amber = medium, red = low.
 * Stays on the dark clinical theme — never introduces off-brand colors.
 */
import type { ProvField, FieldProvenance } from "@shared/ansStudy";

export type ConfBand = "high" | "medium" | "low" | "missing";

export function confidenceBand(c: number): ConfBand {
  if (c >= 0.75) return "high";
  if (c >= 0.4) return "medium";
  if (c > 0) return "low";
  return "missing";
}

export function bandColor(b: ConfBand): string {
  switch (b) {
    case "high":
      return "var(--color-status-optimal, #10b981)";
    case "medium":
      return "var(--color-status-watch, #f59e0b)";
    case "low":
      return "var(--color-status-risk, #ef4444)";
    case "missing":
      return "var(--color-text-muted, #94a3b8)";
  }
}

export function bandLabel(b: ConfBand): string {
  switch (b) {
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
    case "missing":
      return "Missing";
  }
}

/** Lucide-style icon name to render alongside the value. */
export type ProvIcon =
  | "check"        // high confidence, no warnings
  | "alert"        // medium / has warnings
  | "warning"      // low or has error
  | "missing"      // null value
  | "computed";    // derived

export function iconForField(p: FieldProvenance, value: unknown): ProvIcon {
  if (value === null || value === undefined || p.source === "missing")
    return "missing";
  if (p.source === "computed") return "computed";
  if (p.confidence < 0.4 || (p.warnings && p.warnings.length))
    return p.confidence < 0.75 ? "alert" : "warning";
  return "check";
}

/** Returns a short, human-readable provenance tooltip. */
export function provTooltip<T>(field: ProvField<T>, label?: string): string {
  const lines: string[] = [];
  if (label) lines.push(label);
  lines.push(
    `Source: ${field.provenance.source.replace(/_/g, " ")}`,
    `Confidence: ${Math.round(field.provenance.confidence * 100)}%`
  );
  if (field.provenance.matchedLabel)
    lines.push(`Matched: "${field.provenance.matchedLabel}"`);
  if (field.provenance.sourceSection)
    lines.push(`Section: ${field.provenance.sourceSection}`);
  if (field.provenance.warnings?.length)
    lines.push(`⚠ ${field.provenance.warnings.join("; ")}`);
  return lines.join("\n");
}

/** Format a numeric or string value for display, with sensible fallbacks. */
export function formatProvValue<T>(
  field: ProvField<T>,
  fmt?: (v: T) => string
): string {
  if (field.value === null || field.value === undefined) return "—";
  if (fmt) return fmt(field.value);
  if (typeof field.value === "number") {
    const n = field.value;
    if (Math.abs(n) >= 100) return n.toFixed(0);
    if (Math.abs(n) >= 10) return n.toFixed(1);
    return n.toFixed(2);
  }
  return String(field.value);
}
