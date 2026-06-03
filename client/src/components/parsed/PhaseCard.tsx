import type { PhaseBlock } from "@shared/ansStudy";
import { Activity, Wind, Gauge, ArrowUp } from "lucide-react";
import { ProvFieldRow } from "./ProvField";

interface Props {
  title: string;
  phaseId: "baseline" | "deepBreathing" | "valsalva" | "standOrTilt";
  phase: PhaseBlock;
}

const ICON_MAP = {
  baseline: Activity,
  deepBreathing: Wind,
  valsalva: Gauge,
  standOrTilt: ArrowUp,
} as const;

export function PhaseCard({ title, phaseId, phase }: Props) {
  const Icon = ICON_MAP[phaseId];

  return (
    <section
      className="rounded-2xl bg-card/50 border border-border/30 p-4 md:p-5"
      data-testid={`card-phase-${phaseId}`}
    >
      <header className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="w-4 h-4" style={{ color: "var(--ps-brand-cyan, #4a9eff)" }} />
          <h3 className="text-[11px] tracking-[0.18em] uppercase text-muted-foreground font-medium truncate">
            {title}
          </h3>
        </div>
        <span
          className="px-1.5 py-0.5 rounded-full text-[9px] uppercase tracking-wider"
          style={{
            color: phase.present ? "var(--color-status-optimal, #10b981)" : "var(--color-text-muted, #94a3b8)",
            background: phase.present ? "rgba(16,185,129,0.12)" : "rgba(148,163,184,0.12)",
            border: `1px solid ${phase.present ? "rgba(16,185,129,0.3)" : "rgba(148,163,184,0.3)"}`,
            fontFamily: "var(--ps-font-mono, ui-monospace)",
          }}
        >
          {phase.present ? "Present" : "Missing"}
        </span>
      </header>

      {!phase.present ? (
        <p className="text-xs text-muted-foreground italic py-2">
          This phase was not found in the uploaded file. Cardiac autonomic
          checks that depend on it will be skipped.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
          <ProvFieldRow label="HR" field={phase.heartRate} unit="bpm" />
          <ProvFieldRow label="SBP" field={phase.bp.sbp} unit="mmHg" />
          <ProvFieldRow label="DBP" field={phase.bp.dbp} unit="mmHg" />
          <ProvFieldRow label="MAP" field={phase.bp.map} unit="mmHg" />
          <ProvFieldRow label="LFa (sympathetic)" field={phase.lfa} />
          <ProvFieldRow label="RFa (parasympathetic)" field={phase.rfa} />
          <ProvFieldRow label="SB (LFa/RFa)" field={phase.sb} />
        </div>
      )}

      {phase.notes.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border/30">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            File notes
          </div>
          <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc pl-4">
            {phase.notes.slice(0, 4).map((n, i) => (
              <li key={i} className="truncate" title={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
