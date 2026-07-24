import { useState } from "react";
import { motion } from "framer-motion";
import {
  Ruler,
  Lightbulb,
  CircleHelp,
  Microscope,
  ChevronDown,
  ChevronRight,
  Activity,
  Dna,
  Zap,
  FlaskConical,
  Sparkles,
  ShieldAlert,
} from "lucide-react";
import type { ANSReport } from "@shared/schema";
import type {
  DiagnosticSummary,
  DomainScore,
  Severity,
} from "@shared/diagnosticSummary";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";

interface EvidenceStratificationProps {
  report: ANSReport;
  /** Optional merged vendor extraction — its narrative findings are shown as a
   *  SEPARATE evidence class (verbatim, with provenance), never folded into the
   *  deterministic measured/hypothesis tiers. */
  vendorExtraction?: import("@shared/vendorExtraction").VendorReportExtraction;
}

/**
 * EvidenceStratification
 *
 * A high-level "epistemic tiers" panel that visually SEPARATES the report's
 * content by how much we actually know:
 *
 *   1. Measured results   — objective, deterministic findings + assessed domain
 *                           scores read straight from the DiagnosticSummary.
 *   2. Hypotheses         — pattern-level phenotype suggestions ("pattern
 *                           consistent with…"), explicitly NOT diagnoses.
 *   3. Missing data       — domains that were not assessable + pattern checks
 *                           that were blocked for lack of required inputs.
 *   4. Investigational    — research-context discussion (PASC, epigenetics,
 *                           mitochondria, peptides, stem-cell). This tier is
 *                           purely educational: it carries no treatment claims
 *                           and does NOT influence the measurements, confidence,
 *                           or scoring shown elsewhere in the report.
 *
 * This component is presentational only. It reads existing fields and performs
 * NO scoring — the deterministic engine remains the single source of truth.
 */
export function EvidenceStratification({ report, vendorExtraction }: EvidenceStratificationProps) {
  const summary = report.diagnosticSummary;
  const vendorFindings = vendorExtraction?.narrative?.findings ?? [];

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5 space-y-4"
      data-testid="evidence-stratification"
    >
      <header>
        <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium">
          Evidence, Separated by Certainty
        </h3>
        <p className="text-[11px] text-muted-foreground/70 mt-1 leading-snug">
          What was measured, what is only a pattern-level hypothesis, what could
          not be assessed, and — kept strictly apart — investigational research
          context that does not affect this report.
        </p>
      </header>

      {vendorFindings.length > 0 && (
        <VendorReportedTier
          findings={vendorFindings}
          sourceFiles={vendorExtraction?.merged?.sourceFiles}
        />
      )}

      {summary ? (
        <div className="grid grid-cols-1 gap-3">
          <MeasuredTier summary={summary} />
          <HypothesesTier summary={summary} />
          <MissingTier summary={summary} />
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground italic">
          Structured measurement / hypothesis / missing-data breakdown is
          unavailable for this report (no deterministic diagnostic summary was
          attached).
        </p>
      )}

      <InvestigationalTier />
    </motion.section>
  );
}

// ============================================================================
// Shared tier shell
// ============================================================================

const TIER_ACCENTS = {
  measured: {
    ring: "border-emerald-400/30",
    bg: "bg-emerald-500/5",
    icon: "text-emerald-300",
    chip: "border-emerald-400/40 text-emerald-300 bg-emerald-500/10",
  },
  hypotheses: {
    ring: "border-amber-400/30",
    bg: "bg-amber-500/5",
    icon: "text-amber-300",
    chip: "border-amber-400/40 text-amber-300 bg-amber-500/10",
  },
  missing: {
    ring: "border-border/40",
    bg: "bg-muted/10",
    icon: "text-muted-foreground",
    chip: "border-muted-foreground/30 text-muted-foreground bg-muted/20",
  },
  investigational: {
    ring: "border-violet-400/30",
    bg: "bg-violet-500/5",
    icon: "text-violet-300",
    chip: "border-violet-400/40 text-violet-300 bg-violet-500/10",
  },
  vendor: {
    ring: "border-sky-400/30",
    bg: "bg-sky-500/5",
    icon: "text-sky-300",
    chip: "border-sky-400/40 text-sky-300 bg-sky-500/10",
  },
} as const;

function TierShell({
  accent,
  icon: Icon,
  title,
  subtitle,
  count,
  testId,
  children,
}: {
  accent: keyof typeof TIER_ACCENTS;
  icon: typeof Ruler;
  title: string;
  subtitle: string;
  count?: number;
  testId: string;
  children: React.ReactNode;
}) {
  const a = TIER_ACCENTS[accent];
  return (
    <div
      className={`rounded-xl border ${a.ring} ${a.bg} p-4`}
      data-testid={testId}
    >
      <div className="flex items-start gap-2.5 mb-3">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${a.icon}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-semibold text-foreground">{title}</h4>
            {typeof count === "number" && (
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${a.chip}`}
              >
                {count}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground/80 mt-0.5 leading-snug">
            {subtitle}
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}

// ============================================================================
// Vendor-reported findings — a SEPARATE evidence class
// ============================================================================

// Classifications the vendor prints that indicate an abnormal / notable result
// (as opposed to an explicit "normal"). Used only for the summary count colour.
const VENDOR_NOTABLE = new Set([
  "borderline-low", "borderline-high", "low", "high", "high-normal", "abnormal", "present",
]);

const VENDOR_CLASS_TEXT: Record<string, string> = {
  normal: "text-emerald-300",
  "borderline-low": "text-amber-300",
  "borderline-high": "text-amber-300",
  "high-normal": "text-amber-300",
  low: "text-orange-300",
  high: "text-orange-300",
  abnormal: "text-red-300",
  present: "text-orange-300",
};

function VendorReportedTier({
  findings,
  sourceFiles,
}: {
  findings: import("@shared/vendorExtraction").VendorNarrativeFinding[];
  sourceFiles?: string[];
}) {
  const notable = findings.filter((f) => VENDOR_NOTABLE.has(f.classification));
  return (
    <TierShell
      accent="vendor"
      icon={ShieldAlert}
      title="Vendor-reported findings"
      subtitle="Read verbatim from the attached signed vendor report. These are the vendor's own categorical conclusions — shown with provenance and kept strictly separate from HumanOS's deterministic measurements. They are NOT converted into engine scores and must be reviewed clinically."
      count={findings.length}
      testId="tier-vendor-reported"
    >
      <ul className="space-y-1.5">
        {findings.map((f) => (
          <li
            key={f.key}
            className="flex items-start justify-between gap-2 rounded-lg border border-sky-400/20 bg-background/30 px-3 py-2"
            data-testid={`vendor-finding-${f.key}`}
          >
            <div className="min-w-0">
              <div className="text-xs text-foreground">{f.label}</div>
              <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                {f.phase}
                {f.sourceFile ? ` · ${f.sourceFile}` : ""}
              </div>
            </div>
            <span
              className={`text-[10px] uppercase tracking-wide shrink-0 ${VENDOR_CLASS_TEXT[f.classification] ?? "text-muted-foreground"}`}
            >
              {f.classification}
            </span>
          </li>
        ))}
      </ul>
      {notable.length > 0 && (
        <p className="text-[11px] text-sky-200/80 mt-3 leading-snug" data-testid="vendor-reported-note">
          The signed vendor report flagged {notable.length} notable finding
          {notable.length === 1 ? "" : "s"}. Because the raw .ans export does not
          contain the vendor's proprietary blood-pressure and spectral values,
          these categories cannot be independently reproduced by HumanOS and must
          be reviewed clinically.
        </p>
      )}
      {sourceFiles && sourceFiles.length > 0 && (
        <p className="text-[10px] text-muted-foreground/70 mt-2 font-mono">
          Source: {sourceFiles.join(", ")}
        </p>
      )}
    </TierShell>
  );
}

// ============================================================================
// Tier 1 — Measured results
// ============================================================================

const SEVERITY_TEXT: Record<Severity, string> = {
  normal: "text-emerald-300",
  mild: "text-amber-300",
  moderate: "text-orange-300",
  severe: "text-red-300",
  not_assessed: "text-muted-foreground",
};

function MeasuredTier({ summary }: { summary: DiagnosticSummary }) {
  const findings = summary.abnormalFindings ?? [];
  const assessedDomains = (
    [
      summary.cardiovagalScore,
      summary.adrenergicScore,
      summary.sudomotorScore,
    ] as DomainScore[]
  ).filter((d) => d.assessable);

  const count = findings.length + assessedDomains.length;

  return (
    <TierShell
      accent="measured"
      icon={Ruler}
      title="Measured results"
      subtitle="Objective, deterministic values computed from this study's signal data and fixed thresholds."
      count={count}
      testId="tier-measured"
    >
      {assessedDomains.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
          {assessedDomains.map((d) => (
            <div
              key={d.domain}
              className="rounded-lg border border-border/30 bg-background/40 p-2.5"
              data-testid={`measured-domain-${d.domain}`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-medium capitalize">{d.domain}</span>
                <ConfidenceBadge confidence={d.confidence} />
              </div>
              <p className={`text-[11px] leading-snug ${SEVERITY_TEXT[d.severity]}`}>
                {d.severity}
                {d.value != null && (
                  <span className="text-muted-foreground"> · score {d.value}/3</span>
                )}
              </p>
            </div>
          ))}
        </div>
      )}

      {findings.length > 0 ? (
        <ul className="space-y-1.5">
          {findings.map((f) => (
            <li
              key={f.code}
              className="flex items-start justify-between gap-2 rounded-lg border border-border/20 bg-background/30 px-3 py-2"
              data-testid={`measured-finding-${f.code}`}
            >
              <div className="min-w-0">
                <div className="text-xs text-foreground">{f.message}</div>
                <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                  {f.code} · {f.domain}
                  {f.thresholdRef ? ` · ${f.thresholdRef}` : ""}
                </div>
              </div>
              <span
                className={`text-[10px] uppercase tracking-wide shrink-0 ${SEVERITY_TEXT[f.severity]}`}
              >
                {f.severity}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        assessedDomains.length === 0 && (
          <p className="text-[11px] text-muted-foreground italic">
            No abnormal measured findings recorded.
          </p>
        )
      )}
    </TierShell>
  );
}

// ============================================================================
// Tier 2 — Hypotheses (pattern-level phenotype suggestions)
// ============================================================================

function HypothesesTier({ summary }: { summary: DiagnosticSummary }) {
  const active = (summary.phenotypeFlags ?? []).filter((p) => p.present);

  return (
    <TierShell
      accent="hypotheses"
      icon={Lightbulb}
      title="Hypotheses"
      subtitle="Pattern-level suggestions consistent with the data — these are not diagnoses and require clinical correlation."
      count={active.length}
      testId="tier-hypotheses"
    >
      {active.length > 0 ? (
        <ul className="space-y-1.5">
          {active.map((p) => (
            <li
              key={p.id}
              className="flex items-start justify-between gap-2 rounded-lg border border-border/20 bg-background/30 px-3 py-2"
              data-testid={`hypothesis-${p.id}`}
            >
              <div className="min-w-0">
                <div className="text-xs text-foreground">{p.label}</div>
                <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                  {p.id}
                </div>
              </div>
              <ConfidenceBadge confidence={p.confidence} className="shrink-0" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-muted-foreground italic">
          No pattern-level hypotheses met their criteria for this study.
        </p>
      )}
    </TierShell>
  );
}

// ============================================================================
// Tier 3 — Missing data
// ============================================================================

const DOMAIN_LABELS: Record<string, string> = {
  cardiovagal: "Cardiovagal",
  adrenergic: "Adrenergic",
  sudomotor: "Sudomotor",
};

function MissingTier({ summary }: { summary: DiagnosticSummary }) {
  const missingDomains = summary.missingDomains ?? [];
  const blocked = summary.unsafeOrUnsupportedClaimsBlocked ?? [];

  const domainReason = (d: string): string | undefined => {
    const score =
      d === "cardiovagal"
        ? summary.cardiovagalScore
        : d === "adrenergic"
          ? summary.adrenergicScore
          : summary.sudomotorScore;
    return score?.notAssessedReason;
  };

  const count = missingDomains.length + blocked.length;

  return (
    <TierShell
      accent="missing"
      icon={CircleHelp}
      title="Missing data"
      subtitle="What could not be evaluated. Missing inputs are never treated as normal."
      count={count}
      testId="tier-missing"
    >
      {count === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">
          All expected domains were assessable — no gaps recorded.
        </p>
      ) : (
        <div className="space-y-3">
          {missingDomains.length > 0 && (
            <div>
              <div className="text-[10px] tracking-[0.16em] uppercase text-muted-foreground/70 mb-1.5">
                Domains not assessed · {missingDomains.length}
              </div>
              <ul className="space-y-1.5">
                {missingDomains.map((d) => (
                  <li
                    key={d}
                    className="rounded-lg border border-border/20 bg-background/30 px-3 py-2"
                    data-testid={`missing-domain-${d}`}
                  >
                    <div className="text-xs text-foreground">
                      {DOMAIN_LABELS[d] ?? d}
                    </div>
                    {domainReason(d) && (
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {domainReason(d)}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {blocked.length > 0 && (
            <div>
              <div className="text-[10px] tracking-[0.16em] uppercase text-muted-foreground/70 mb-1.5">
                Pattern checks blocked · {blocked.length}
              </div>
              <ul className="space-y-1.5">
                {blocked.map((b, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-border/20 bg-background/30 px-3 py-2"
                    data-testid={`missing-blocked-${i}`}
                  >
                    <div className="text-xs text-foreground">{b.claim}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {b.explanation}
                    </div>
                    {b.missingFields.length > 0 && (
                      <div className="text-[10px] font-mono text-muted-foreground/70 mt-1">
                        Missing: {b.missingFields.join(", ")}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </TierShell>
  );
}

// ============================================================================
// Tier 4 — Investigational discussion (research context only)
// ============================================================================

interface InvestigationalTopic {
  id: string;
  title: string;
  icon: typeof Ruler;
  /** Neutral, mechanistic research framing. NO treatment language. */
  body: string;
  /** What is explicitly NOT established. */
  caveat: string;
}

const INVESTIGATIONAL_TOPICS: InvestigationalTopic[] = [
  {
    id: "pasc",
    title: "PASC / Long COVID",
    icon: Activity,
    body:
      "Autonomic dysfunction — including POTS-like orthostatic patterns and reduced heart-rate variability — has been reported in some post-acute sequelae of SARS-CoV-2 (PASC) cohorts. Whether the autonomic metrics in this report track PASC symptom burden is an open research question.",
    caveat:
      "ANS testing is not diagnostic of PASC, and no causal relationship is established.",
  },
  {
    id: "epigenetics",
    title: "Epigenetics",
    icon: Dna,
    body:
      "Research is exploring whether epigenetic changes (for example, DNA methylation of stress- and inflammation-related genes) correlate with autonomic regulation and stress adaptation over time.",
    caveat:
      "No epigenetic marker is a validated correlate of the measurements in this report.",
  },
  {
    id: "mitochondria",
    title: "Mitochondria / Bioenergetics",
    icon: Zap,
    body:
      "Mitochondrial function and cellular energy metabolism are being studied in relation to autonomic tone and fatigue phenotypes.",
    caveat:
      "This report does not measure mitochondrial function; any link is hypothesis-level only.",
  },
  {
    id: "peptides",
    title: "Signaling peptides",
    icon: FlaskConical,
    body:
      "Endogenous signaling peptides (such as natriuretic peptides and neuropeptides) are an active area of autonomic-physiology research into how the nervous and cardiovascular systems communicate.",
    caveat:
      "This is mechanistic research context only — no peptide product or therapy is described, endorsed, or implied.",
  },
  {
    id: "stem-cell",
    title: "Regenerative / stem-cell research",
    icon: Sparkles,
    body:
      "Regenerative and stem-cell approaches to neural and autonomic tissue are an area of early scientific investigation.",
    caveat:
      "For autonomic dysfunction these remain unproven in humans; nothing here is a treatment or a recommendation to seek such interventions.",
  },
];

function InvestigationalTier() {
  const [open, setOpen] = useState(false);
  const a = TIER_ACCENTS.investigational;

  return (
    <div
      className={`rounded-xl border ${a.ring} ${a.bg}`}
      data-testid="tier-investigational"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-start gap-2.5 p-4 text-left"
        data-testid="tier-investigational-button"
      >
        <Microscope className={`w-4 h-4 mt-0.5 shrink-0 ${a.icon}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-semibold text-foreground">
              Investigational discussion
            </h4>
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${a.chip}`}
            >
              Research context
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground/80 mt-0.5 leading-snug">
            Experimental research directions kept separate from the assessment
            above. Not diagnostic, not treatment advice, and not part of scoring.
          </p>
        </div>
        <span className="text-muted-foreground shrink-0 mt-0.5" aria-hidden>
          {open ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {/* Prominent boundary disclaimer — always visible when expanded. */}
          <div
            className="flex items-start gap-2 rounded-lg border border-violet-400/30 bg-violet-500/10 px-3 py-2.5"
            data-testid="investigational-disclaimer"
          >
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-violet-300" aria-hidden />
            <p className="text-[11px] text-muted-foreground leading-snug">
              The topics below are hypotheses under active investigation — not
              established mechanisms, not part of this patient&apos;s assessment,
              and not medical or treatment advice. None of this content
              influences the measured results, confidence, or scoring shown
              above.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {INVESTIGATIONAL_TOPICS.map((t) => {
              const Icon = t.icon;
              return (
                <div
                  key={t.id}
                  className="rounded-lg border border-border/20 bg-background/30 p-3"
                  data-testid={`investigational-${t.id}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="w-3.5 h-3.5 shrink-0 text-violet-300" aria-hidden />
                    <h5 className="text-xs font-semibold text-foreground">
                      {t.title}
                    </h5>
                    <span className="inline-flex items-center rounded-full border border-violet-400/40 bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-violet-300">
                      Investigational
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {t.body}
                  </p>
                  <p className="text-[11px] text-muted-foreground/70 leading-relaxed mt-1 italic">
                    {t.caveat}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
