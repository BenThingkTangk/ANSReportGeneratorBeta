/**
 * WhyConclusionsPanel
 *
 * Renders a list of every abnormal finding + active phenotype flag from the
 * DiagnosticSummary, each followed by a collapsible "Why this conclusion?"
 * panel powered by the shared WhyExpander.
 *
 * Reads observed values from the AnsStudy using the dotted sourceField paths
 * so the user can see the exact numbers behind each rule.
 */
import type { AnsStudy } from "@shared/ansStudy";
import type {
  DiagnosticSummary,
  AbnormalFinding,
  PhenotypeFlag,
} from "@shared/diagnosticSummary";
import { AlertTriangle, BookOpen } from "lucide-react";

import { WhyExpander, type WhyCriterion } from "@/components/parsed/WhyExpander";

interface Props {
  summary: DiagnosticSummary;
  ansStudy?: AnsStudy;
}

/** Resolve a dotted path on the AnsStudy. Returns the leaf .value when the
 *  resolved node is a ProvField, otherwise the node itself. */
function resolvePath(study: AnsStudy | undefined, path: string): string | number | null {
  if (!study) return null;
  const parts = path.split(".");
  let node: any = study;
  for (const p of parts) {
    if (node == null) return null;
    node = node[p];
  }
  if (node && typeof node === "object" && "value" in node) {
    const v = (node as any).value;
    return v === undefined ? null : v;
  }
  if (typeof node === "string" || typeof node === "number") return node;
  return null;
}

function findingToProps(
  f: AbnormalFinding,
  study?: AnsStudy,
): React.ComponentProps<typeof WhyExpander> {
  return {
    rationale: f.message,
    confidence: f.confidence,
    thresholdRef: f.thresholdRef,
    sourceFields: f.sourceFields.map((path) => ({
      path,
      value: resolvePath(study, path),
    })),
  };
}

function phenotypeToProps(
  p: PhenotypeFlag,
  study?: AnsStudy,
): React.ComponentProps<typeof WhyExpander> {
  const criteria: WhyCriterion[] = p.criteria.map((c) => ({
    description: c.description,
    met: c.met,
    sourceField: c.sourceField,
    observedValue: c.sourceField ? resolvePath(study, c.sourceField) : null,
  }));
  return {
    rationale: p.rationale,
    confidence: p.confidence,
    criteria,
    sourceFields: p.sourceFields.map((path) => ({
      path,
      value: resolvePath(study, path),
    })),
  };
}

export function WhyConclusionsPanel({ summary, ansStudy }: Props) {
  const findings = summary.abnormalFindings ?? [];
  const activePhenotypes = (summary.phenotypeFlags ?? []).filter((p) => p.present);

  if (findings.length === 0 && activePhenotypes.length === 0) {
    return null;
  }

  return (
    <section
      className="rounded-2xl bg-card/50 border border-border/30 p-4 md:p-5"
      data-testid="panel-why-conclusions"
    >
      <header className="flex items-center gap-2 mb-4">
        <BookOpen
          className="w-4 h-4"
          style={{ color: "var(--ps-brand-cyan, #4a9eff)" }}
        />
        <h3 className="text-[11px] tracking-[0.18em] uppercase text-muted-foreground font-medium">
          Why these conclusions?
        </h3>
      </header>

      {findings.length > 0 && (
        <div className="mb-4">
          <div className="text-[10px] tracking-[0.18em] uppercase text-muted-foreground/70 mb-2">
            Abnormal findings · {findings.length}
          </div>
          <div className="space-y-2">
            {findings.map((f) => (
              <div
                key={f.code}
                className="rounded-xl border border-border/30 p-3"
                data-testid={`why-finding-${f.code}`}
              >
                <div className="flex items-start gap-2 mb-2">
                  <AlertTriangle
                    className="w-4 h-4 mt-0.5 shrink-0"
                    style={{ color: "var(--color-status-watch, #f59e0b)" }}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{f.message}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {f.code} · {f.domain} · {f.severity}
                    </div>
                  </div>
                </div>
                <WhyExpander {...findingToProps(f, ansStudy)} />
              </div>
            ))}
          </div>
        </div>
      )}

      {activePhenotypes.length > 0 && (
        <div>
          <div className="text-[10px] tracking-[0.18em] uppercase text-muted-foreground/70 mb-2">
            Phenotype patterns · {activePhenotypes.length}
          </div>
          <div className="space-y-2">
            {activePhenotypes.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-border/30 p-3"
                data-testid={`why-phenotype-${p.id}`}
              >
                <div className="text-sm font-medium mb-1">{p.label}</div>
                <div className="text-[11px] text-muted-foreground mb-2">
                  {p.id} · confidence: {p.confidence}
                </div>
                <WhyExpander {...phenotypeToProps(p, ansStudy)} />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
