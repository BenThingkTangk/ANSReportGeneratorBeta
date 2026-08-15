/** Canonical, intentionally small vocabulary for displayed report provenance. */
export type ReportProvenance =
  | "Measured from .ans"
  | "Derived from raw ECG"
  | "Imported from paired vendor PDF"
  | "Generic research threshold"
  | "AI draft explanation"
  | "Clinician-approved conclusion"
  | "Not assessed";

const STYLE: Record<ReportProvenance, string> = {
  "Measured from .ans": "border-emerald-500/35 text-emerald-300",
  "Derived from raw ECG": "border-sky-500/35 text-sky-300",
  "Imported from paired vendor PDF": "border-violet-500/35 text-violet-300",
  "Generic research threshold": "border-slate-500/35 text-slate-300",
  "AI draft explanation": "border-amber-500/35 text-amber-300",
  "Clinician-approved conclusion": "border-teal-500/35 text-teal-300",
  "Not assessed": "border-zinc-500/35 text-zinc-300",
};

export function ProvenanceChip({
  value,
  className = "",
}: {
  value: ReportProvenance;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] leading-none whitespace-nowrap ${STYLE[value]} ${className}`}
      data-testid={`provenance-${value.toLowerCase().replace(/[^a-z]+/g, "-").replace(/(^-|-$)/g, "")}`}
    >
      {value}
    </span>
  );
}

