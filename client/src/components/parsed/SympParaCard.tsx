import type { AnsStudy } from "@shared/ansStudy";
import { ArrowLeftRight } from "lucide-react";
import { ProvFieldRow } from "./ProvField";

interface Props {
  study: AnsStudy;
}

export function SympParaCard({ study }: Props) {
  const sp = study.sympatheticParasympathetic;

  return (
    <section
      className="rounded-2xl bg-card/50 border border-border/30 p-4 md:p-5"
      data-testid="card-symp-para"
    >
      <header className="flex items-center gap-2 mb-3">
        <ArrowLeftRight
          className="w-4 h-4"
          style={{ color: "var(--ps-brand-cyan, #4a9eff)" }}
        />
        <h3 className="text-[11px] tracking-[0.18em] uppercase text-muted-foreground font-medium">
          Sympathetic / Parasympathetic
        </h3>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
        <ProvFieldRow label="Resting LFa" field={sp.restingLfa} />
        <ProvFieldRow label="Resting RFa" field={sp.restingRfa} />
        <ProvFieldRow label="Resting SB" field={sp.restingSb} />
        <ProvFieldRow label="Standing LFa" field={sp.standingLfa} />
        <ProvFieldRow label="Standing RFa" field={sp.standingRfa} />
        <ProvFieldRow label="Standing SB" field={sp.standingSb} />
      </div>

      {sp.impressionText.value && (
        <div className="mt-3 pt-3 border-t border-border/30">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            File impression
          </div>
          <p className="text-[11px] text-muted-foreground italic leading-relaxed">
            {String(sp.impressionText.value).slice(0, 240)}
            {String(sp.impressionText.value).length > 240 ? "…" : ""}
          </p>
        </div>
      )}
    </section>
  );
}
