/**
 * Single-row provenance display: label · value · confidence chip · icon.
 * Uses CSS variables only — no off-brand colors.
 */
import { CheckCircle2, AlertTriangle, AlertCircle, MinusCircle, Calculator } from "lucide-react";
import type { ProvField as ProvFieldType } from "@shared/ansStudy";
import {
  confidenceBand,
  bandColor,
  bandLabel,
  iconForField,
  provTooltip,
  formatProvValue,
} from "./provHelpers";

interface Props<T> {
  label: string;
  field: ProvFieldType<T>;
  /** Optional formatter (e.g. (v) => `${v} bpm`). */
  format?: (v: T) => string;
  /** Optional inline unit appended to the value, e.g. "bpm". */
  unit?: string;
  /** Tighter row layout for grid views. */
  dense?: boolean;
}

export function ProvFieldRow<T>({ label, field, format, unit, dense }: Props<T>) {
  const band = confidenceBand(field.provenance.confidence);
  const icon = iconForField(field.provenance, field.value);
  const color = bandColor(band);

  const IconEl =
    icon === "check"
      ? CheckCircle2
      : icon === "alert"
        ? AlertCircle
        : icon === "warning"
          ? AlertTriangle
          : icon === "computed"
            ? Calculator
            : MinusCircle;

  const valueText = formatProvValue(field, format);
  const displayValue =
    field.value === null
      ? "Missing"
      : `${valueText}${unit ? ` ${unit}` : ""}`;

  return (
    <div
      title={provTooltip(field, label)}
      className={
        dense
          ? "flex min-w-0 flex-col gap-1 py-1.5"
          : "flex min-w-0 items-center justify-between gap-2 py-1.5"
      }
      data-testid={`provfield-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <span
        className={`min-w-0 text-[11px] tracking-wider uppercase text-muted-foreground ${
          dense ? "whitespace-normal break-words leading-tight" : "truncate"
        }`}
      >
        {label}
      </span>
      <span
        className={`flex min-w-0 items-center gap-2 ${
          dense ? "w-full justify-between" : "shrink-0 justify-end"
        }`}
      >
        <span
          className={`min-w-0 whitespace-nowrap tabular-nums ${
            field.value === null ? "italic text-muted-foreground" : ""
          }`}
          style={{ fontFamily: "var(--ps-font-mono, ui-monospace)", fontSize: dense ? 12 : 13 }}
        >
          {displayValue}
        </span>
        <span
          className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider"
          style={{
            color,
            background: `${color}18`,
            border: `1px solid ${color}44`,
            fontFamily: "var(--ps-font-mono, ui-monospace)",
          }}
        >
          <IconEl className="w-3 h-3" />
          {bandLabel(band)}
        </span>
      </span>
    </div>
  );
}
