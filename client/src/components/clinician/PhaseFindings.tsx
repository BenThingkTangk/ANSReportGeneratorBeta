import { motion } from "framer-motion";
import type { PhaseFinding } from "@shared/schema";

interface PhaseFindingsProps {
  phaseFindings: PhaseFinding[];
}

// Group by broad phase category
function groupFindings(findings: PhaseFinding[]): { title: string; items: PhaseFinding[] }[] {
  const groups: { title: string; items: PhaseFinding[] }[] = [
    { title: "Initial Baseline", items: [] },
    { title: "Deep Breathing / Valsalva", items: [] },
    { title: "Stand Response", items: [] },
  ];

  findings.forEach(f => {
    const ph = f.phase.toLowerCase();
    if (ph.includes("baseline-a") || ph.includes("baseline_a") || ph.includes("initial")) {
      groups[0].items.push(f);
    } else if (ph.includes("stand") || ph.includes("stand-f")) {
      groups[2].items.push(f);
    } else {
      groups[1].items.push(f);
    }
  });

  return groups.filter(g => g.items.length > 0);
}

export function PhaseFindings({ phaseFindings }: PhaseFindingsProps) {
  const groups = groupFindings(phaseFindings);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.4 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="phase-findings"
    >
      <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium mb-4">
        Phase Findings
      </h3>

      <div className="space-y-6">
        {groups.map((group, gi) => (
          <div key={gi}>
            <p className="text-[10px] uppercase tracking-widest font-semibold mb-3" style={{ color: "hsl(185 85% 50%)" }}>
              {group.title}
            </p>
            <div className="space-y-4">
              {group.items.map((finding, fi) => (
                <div key={fi} className="space-y-2">
                  {finding.indication && (
                    <p className="text-xs font-semibold text-foreground/80">{finding.indication}</p>
                  )}
                  <ul className="space-y-1.5">
                    {finding.findings.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground leading-relaxed">
                        <span className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0" style={{ background: "hsl(185 85% 42%)" }} />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ))}

        {groups.length === 0 && (
          <p className="text-sm text-muted-foreground">No phase findings recorded.</p>
        )}
      </div>
    </motion.div>
  );
}
