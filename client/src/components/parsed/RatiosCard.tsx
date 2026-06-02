import type { AnsStudy } from "@shared/ansStudy";
import { Sigma } from "lucide-react";
import { ProvFieldRow } from "./ProvField";

interface Props {
  study: AnsStudy;
}

export function RatiosCard({ study }: Props) {
  return (
    <section
      className="rounded-2xl bg-card/50 border border-border/30 p-4 md:p-5"
      data-testid="card-ratios"
    >
      <header className="flex items-center gap-2 mb-3">
        <Sigma className="w-4 h-4" style={{ color: "var(--ps-brand-cyan, #4a9eff)" }} />
        <h3 className="text-[11px] tracking-[0.18em] uppercase text-muted-foreground font-medium">
          Autonomic ratios
        </h3>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
        <ProvFieldRow label="E/I ratio" field={study.ratios.eiRatio} />
        <ProvFieldRow label="Valsalva ratio" field={study.ratios.valsalvaRatio} />
        <ProvFieldRow label="30:15 ratio" field={study.ratios.thirtyFifteenRatio} />
      </div>
    </section>
  );
}
