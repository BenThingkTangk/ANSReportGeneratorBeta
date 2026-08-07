import type { VisualizationProvenance } from "@shared/vendorVisualization";

/**
 * One-line, non-negotiable statement of where a plotted series came from.
 *
 * Four states, never collapsed into three: a series read out of the uploaded
 * `.ans` file, a HumanOS estimate, a structure that is simply absent, and a
 * structure that was present but unreadable. The last two must never look the
 * same as an empty measurement.
 */
const COPY: Record<
  VisualizationProvenance,
  { label: string; title: string; className: string }
> = {
  ans_stored: {
    label: "Stored in .ans",
    title:
      "Read verbatim from the PhysioPS analysis block inside the uploaded .ans file. " +
      "Not recomputed, not resampled, not interpolated.",
    className: "border-emerald-400/40 bg-emerald-400/10 text-emerald-100",
  },
  humanos_estimated: {
    label: "HumanOS estimate",
    title:
      "Computed by HumanOS from this recording's waveform. Not a vendor value and not " +
      "validated against PhysioPS output.",
    className: "border-violet-400/40 bg-violet-400/10 text-violet-100",
  },
  unavailable: {
    label: "Not in this file",
    title: "The uploaded file does not carry this stored series. Nothing is plotted.",
    className: "border-border/50 bg-card/60 text-muted-foreground",
  },
  malformed: {
    label: "Stored but unreadable",
    title:
      "The file declares this stored series but its contents did not decode. It is withheld " +
      "rather than partially drawn.",
    className: "border-amber-400/40 bg-amber-400/10 text-amber-100",
  },
};

export function SeriesProvenanceChip({
  provenance,
  testId,
}: {
  provenance: VisualizationProvenance;
  testId?: string;
}) {
  const copy = COPY[provenance];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] font-medium leading-tight ${copy.className}`}
      title={copy.title}
      data-testid={testId}
      data-provenance={provenance}
    >
      {copy.label}
    </span>
  );
}
