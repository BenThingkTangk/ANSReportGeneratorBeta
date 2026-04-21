import { motion } from "framer-motion";

export function ColomboReferences() {
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
        Based on Colombo P&S Methodology — DynaCardia / Physio PS / ANS Element.
      </p>
      <ul className="space-y-1.5 text-xs text-muted-foreground">
        <li className="flex items-start gap-2">
          <span className="mt-1 flex-shrink-0">•</span>
          Colombo et al., <em>Clinical Autonomic Research</em> (2004–2019).
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-1 flex-shrink-0">•</span>
          Prendergast P, <em>Clinical Autonomic Research</em>, 2001 (ALA neuroprotection).
        </li>
        <li className="flex items-start gap-2">
          <span className="mt-1 flex-shrink-0">•</span>
          Magidenko, 2007; NutritionalReviews.org, 2007 (ALA BP contraindication).
        </li>
      </ul>
    </motion.div>
  );
}
