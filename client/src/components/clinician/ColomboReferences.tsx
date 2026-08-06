import { motion } from "framer-motion";
import { METRIC_CITATIONS, METRIC_TIERS, type MetricKey } from "@shared/metricProvenance";
import { AGE_RATIO_REFERENCE } from "@shared/colomboNorms";

/**
 * Methodology & References.
 *
 * WHAT CHANGED AND WHY: this panel used to print a fixed bibliography
 * ("Colombo et al., Clinical Autonomic Research (2004–2019)", "Prendergast P,
 * 2001", "Magidenko, 2007; NutritionalReviews.org, 2007") that is not traceable
 * to anything in this codebase — no URL, no DOI, and no corresponding entry in
 * the app's own citation registry. A clinical decision-support surface must not
 * display a bibliography it cannot resolve.
 *
 * Everything rendered here is now derived from artifacts that actually exist in
 * this repository:
 *   • `shared/metricProvenance.ts METRIC_CITATIONS` — the app's own per-metric
 *     citation registry, with real resolvable URLs.
 *   • `shared/colomboNorms.ts AGE_RATIO_REFERENCE` — the single authoritative
 *     age-specific ratio reference table and its documented `source` string.
 *
 * Nothing is added by hand. If the registry is empty, we say so rather than
 * inventing entries.
 */
export function ColomboReferences() {
  // De-duplicate URLs while remembering which metrics each one backs.
  const byUrl = new Map<string, MetricKey[]>();
  for (const [key, urls] of Object.entries(METRIC_CITATIONS) as Array<[MetricKey, string[]]>) {
    for (const u of urls ?? []) {
      const list = byUrl.get(u) ?? [];
      list.push(key);
      byUrl.set(u, list);
    }
  }
  const entries = [...byUrl.entries()];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.8 }}
      className="rounded-2xl bg-card/30 border border-border/20 p-5"
      data-testid="colombo-references"
    >
      <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium mb-3">
        Methodology &amp; References
      </h3>

      <p className="text-xs text-muted-foreground leading-relaxed mb-3">
        Reference ranges for the three cardiovagal ratios come from one
        authoritative age-specific table used by every surface in this report. The proprietary
        P&amp;S aggregates (LFa / RFa / sympathovagal balance) are vendor outputs and are not
        independently validated — they are only ever displayed when a signed vendor report supplies
        them.
      </p>

      <h4 className="text-[11px] font-semibold text-foreground/80 mb-1.5">
        Age-specific ratio reference table
      </h4>
      <ul className="space-y-1.5 text-xs text-muted-foreground mb-3" data-testid="ratio-reference-sources">
        {(Object.keys(AGE_RATIO_REFERENCE) as Array<keyof typeof AGE_RATIO_REFERENCE>).map((k) => (
          <li key={k} className="flex items-start gap-2">
            <span className="mt-1 flex-shrink-0">•</span>
            <span>
              <span className="text-foreground/80">{AGE_RATIO_REFERENCE[k].label}</span>{" "}
              — {AGE_RATIO_REFERENCE[k].source}
            </span>
          </li>
        ))}
      </ul>

      <h4 className="text-[11px] font-semibold text-foreground/80 mb-1.5">
        Metric evidence registry (resolvable sources)
      </h4>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="no-references">
          No verified methodology references are registered in this deployment.
        </p>
      ) : (
        <ul className="space-y-1.5 text-xs text-muted-foreground">
          {entries.map(([url, keys]) => (
            <li key={url} className="flex items-start gap-2">
              <span className="mt-1 flex-shrink-0">•</span>
              <span className="min-w-0">
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline break-all hover:text-foreground"
                >
                  {url}
                </a>
                <span className="block text-[10px] text-muted-foreground/70">
                  backs: {keys.map((k) => `${k} [${METRIC_TIERS[k]}]`).join(", ")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[10px] text-muted-foreground/70 mt-3 leading-relaxed">
        Evidence tiers: [C] consensus-backed · [X] contested interpretation · [P] proprietary, not
        independently validated. This is clinical decision support, not a diagnosis.
      </p>
    </motion.div>
  );
}
