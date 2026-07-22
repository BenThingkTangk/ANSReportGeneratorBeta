/**
 * metricProvenance — single vocabulary for HOW a value was obtained, WHAT its
 * evidence tier is, and WHETHER it has been validated against a vendor / golden
 * reference. This is the replacement for the (removed) fingerprint-keyed
 * numericalSummaryOverride: instead of silently substituting a patient/file's
 * vendor scalar for the computed one, we ALWAYS compute generically from the
 * raw arrays and carry an explicit, auditable provenance so the UI can render
 * "computed (estimated)", "unavailable", or "vendor-reported" honestly.
 *
 * NOTHING in production may swap a computed value for a memorized vendor value
 * keyed on identity/hash. Vendor values may only enter as (a) parser-extracted
 * fields from an ingested report, tagged `vendor_reported`, or (b) offline
 * regression oracles that never touch the runtime render path.
 *
 * Evidence tiers follow the HumanOS ANS evidence base:
 *   [C] consensus-backed   — Task Force / ESC / AAN-AAS-IFCN standardized metric
 *   [X] contested          — e.g. LF power, LF/HF ratio (interpretation disputed)
 *   [P] proprietary        — e.g. RFa / LFa / P&S "sympathovagal balance"
 * See ANS_test_evidence_base_HumanOS.md §12–13 and the citations therein.
 */

export type EvidenceTier = "C" | "X" | "P";

/** How a scalar reached the report. */
export type MetricMethod =
  | "computed" // derived generically from the raw .ans arrays by our pipeline
  | "vendor_reported" // parsed verbatim from an ingested vendor report/PDF
  | "derived_from_vendor" // arithmetic on vendor-reported inputs (e.g. SB = LFa/RFa)
  | "measured" // directly measured device field (e.g. cuff BP entered at test)
  | "unavailable"; // required inputs absent — no value can be produced

/**
 * Whether a computed value has been checked against an independent reference
 * (golden implementation or a paired vendor scalar) within tolerance.
 *   - "validated"     : reproduced a reference within the pre-specified tolerance
 *   - "estimated"     : computed but NOT reproduced against any reference (default
 *                       for our proprietary [P] approximations of RFa/LFa/SB/FRF)
 *   - "not_applicable": e.g. an unavailable metric, or a directly measured field
 */
export type ValidationStatus = "validated" | "estimated" | "not_applicable";

export interface MetricProvenance {
  method: MetricMethod;
  tier: EvidenceTier;
  validation: ValidationStatus;
  /** Short human note, e.g. "Morlet CWT band power; not vendor-validated". */
  note?: string;
  /** Citation URL(s) backing the evidence tier / method. */
  citations?: string[];
}

/** A scalar bundled with its provenance. `value: null` means unavailable. */
export interface ProvenancedMetric {
  value: number | null;
  provenance: MetricProvenance;
}

/** Short tier label used in tooltips/badges. */
export function tierLabel(tier: EvidenceTier): string {
  switch (tier) {
    case "C":
      return "Consensus-backed";
    case "X":
      return "Contested evidence";
    case "P":
      return "Proprietary (not independently validated)";
  }
}

/** One-line caveat text to render beside a value of the given tier. */
export function tierCaveat(tier: EvidenceTier): string {
  switch (tier) {
    case "C":
      return "Standardized metric (ESC/Task Force/AAN-AAS-IFCN).";
    case "X":
      return "Contested interpretation — treat as a spectral quantity, not a direct measure of sympathetic/parasympathetic activity.";
    case "P":
      return "Proprietary output approximated from the raw signal; not independently validated. Do not read as a validated measure of nervous-system activity.";
  }
}

/** Canonical evidence tier for each ANS metric key (evidence base §12). */
export const METRIC_TIERS = {
  meanHR: "C",
  rangeHR: "C",
  HRV_SDNN: "C",
  HRV_RMSSD: "C",
  HF: "C",
  RFa: "P",
  LFa: "P",
  SB: "P", // LFa/RFa "sympathovagal balance"
  FRF: "P", // fundamental respiratory frequency window (proprietary framing)
  LF: "X",
  LFHF: "X",
  eiRatio: "C",
  valsalvaRatio: "C",
  thirtyFifteenRatio: "C",
  SBP: "C",
  DBP: "C",
  MAP: "C",
} as const satisfies Record<string, EvidenceTier>;

export type MetricKey = keyof typeof METRIC_TIERS;

/** Citations backing the tier of common metrics (subset; extend as needed). */
export const METRIC_CITATIONS: Partial<Record<MetricKey, string[]>> = {
  RFa: [
    "https://pmc.ncbi.nlm.nih.gov/articles/PMC3094491/", // Goldstein 2011
    "https://www.aetna.com/cpb/medical/data/400_499/0485.html", // payer non-validation
  ],
  LFa: ["https://pmc.ncbi.nlm.nih.gov/articles/PMC3094491/"],
  SB: [
    "https://pmc.ncbi.nlm.nih.gov/articles/PMC3094491/",
    "https://www.aetna.com/cpb/medical/data/400_499/0485.html",
  ],
  FRF: ["https://pmc.ncbi.nlm.nih.gov/articles/PMC3094491/"],
  LF: [
    "https://pmc.ncbi.nlm.nih.gov/articles/PMC3576706/", // Billman 2013
    "https://pmc.ncbi.nlm.nih.gov/articles/PMC3094491/",
  ],
  LFHF: ["https://pmc.ncbi.nlm.nih.gov/articles/PMC3576706/"],
  HRV_RMSSD: ["https://pmc.ncbi.nlm.nih.gov/articles/PMC5624990/"], // Shaffer 2017
  HRV_SDNN: ["https://pmc.ncbi.nlm.nih.gov/articles/PMC5624990/"],
  eiRatio: ["https://pmc.ncbi.nlm.nih.gov/articles/PMC3196175/"], // Novak 2011
  valsalvaRatio: ["https://pmc.ncbi.nlm.nih.gov/articles/PMC3196175/"],
  thirtyFifteenRatio: ["https://neurotrials.ai/wiki/neuromuscular/edx-autonomic-testing/"],
};

/**
 * Build provenance for a value we COMPUTED generically from the raw arrays.
 * Proprietary ([P]) and contested ([X]) computed metrics default to
 * `estimated` (never silently "validated"), because our open pipeline only
 * approximates the vendor's undisclosed algorithm.
 */
export function computedProvenance(
  key: MetricKey,
  opts: { validated?: boolean; note?: string } = {},
): MetricProvenance {
  const tier = METRIC_TIERS[key];
  const validation: ValidationStatus = opts.validated ? "validated" : "estimated";
  const defaultNote =
    tier === "P"
      ? "Approximated from the raw ECG-derived series; proprietary vendor algorithm is undisclosed and this value is not vendor-validated."
      : tier === "X"
        ? "Computed spectral quantity; physiological interpretation is contested."
        : "Computed from the raw ECG-derived series.";
  return {
    method: "computed",
    tier,
    validation,
    note: opts.note ?? defaultNote,
    citations: METRIC_CITATIONS[key],
  };
}

/** Build provenance for a metric whose required inputs are absent. */
export function unavailableProvenance(
  key: MetricKey,
  note = "Required inputs were not present in the uploaded file.",
): MetricProvenance {
  return {
    method: "unavailable",
    tier: METRIC_TIERS[key],
    validation: "not_applicable",
    note,
    citations: METRIC_CITATIONS[key],
  };
}

/** Build provenance for a value parsed verbatim from an ingested vendor report. */
export function vendorReportedProvenance(
  key: MetricKey,
  note = "Value parsed verbatim from the ingested vendor report; not recomputed.",
): MetricProvenance {
  return {
    method: "vendor_reported",
    tier: METRIC_TIERS[key],
    validation: "not_applicable",
    note,
    citations: METRIC_CITATIONS[key],
  };
}

/**
 * Build provenance for a value we DERIVED arithmetically from vendor-reported
 * inputs (e.g. SB = vendor LFa / vendor RFa when the vendor printed LFa and RFa
 * but not the ratio). Honestly distinct from `vendor_reported` (which means
 * "printed by the vendor verbatim"): the inputs are vendor-reported but this
 * scalar was computed here. Still clinically interpretable because it is exact
 * arithmetic on trusted vendor values.
 */
export function derivedFromVendorProvenance(
  key: MetricKey,
  note = "Derived here from vendor-reported inputs (not printed by the vendor verbatim).",
): MetricProvenance {
  return {
    method: "derived_from_vendor",
    tier: METRIC_TIERS[key],
    validation: "not_applicable",
    note,
    citations: METRIC_CITATIONS[key],
  };
}

/** True when a value may be shown with a normal/abnormal classification. */
export function mayClassify(p: MetricProvenance): boolean {
  return p.method !== "unavailable";
}

/**
 * True when a value may DRIVE a clinical interpretation / diagnostic finding /
 * treatment recommendation (as opposed to merely being displayed with a
 * caveat). Proprietary ([P]) and contested ([X]) values that were only
 * *estimated* by our open pipeline (never reproduced against the vendor or a
 * golden reference) are NOT clinically actionable: an estimated LFa/RFa/SB that
 * collapses toward 0 must never trigger "parasympathetic/sympathetic",
 * "autonomic neuropathy", or a treatment/supplement recommendation. Only
 * consensus-backed computed metrics, vendor-reported values, or values we
 * validated against a reference may gate clinical logic.
 */
export function mayInterpretClinically(p: MetricProvenance): boolean {
  if (p.method === "unavailable") return false;
  if (p.method === "vendor_reported" || p.method === "derived_from_vendor" || p.method === "measured") return true;
  // method === "computed": consensus metrics OK; proprietary/contested only if
  // explicitly validated against a reference.
  if (p.tier === "C") return true;
  return p.validation === "validated";
}
