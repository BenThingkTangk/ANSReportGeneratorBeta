import { motion } from "framer-motion";
import type { ANSReport, PhaseMetrics } from "@shared/schema";
import { ColomboExplainer } from "../ColomboExplainer";
import { COLOMBO_NORMS } from "@shared/colomboNorms";
import { CANONICAL_PHASES } from "@shared/phaseTable";
import { tierCaveat } from "@shared/metricProvenance";

/**
 * Numerical Summary table — mirrors the bottom table on page 2 of the
 * PhysioPS Multi-Parameter Graphical report. Compact, phase-by-phase audit
 * trail of every number the graphical charts are derived from.
 *
 * IMPORTANT: FRF/LFa/RFa/LFa-RFa are proprietary [P] aggregates our pipeline
 * COMPUTES generically (tagged `estimated`); they are never vendor-substituted.
 * The table renders them as estimates and shows "unavailable" for phases where
 * the raw signal was insufficient — never a fabricated value.
 */

// Single canonical phase table (shared/phaseTable) — no local re-declaration.
const PHASES = CANONICAL_PHASES;

// Norm bands — single source of truth (shared/colomboNorms).
const NORMS = {
  FRF: { lo: COLOMBO_NORMS.FRF.lo, hi: COLOMBO_NORMS.FRF.hi },
  LFa: { lo: COLOMBO_NORMS.LFa.lo, hi: COLOMBO_NORMS.LFa.hi },
  RFa: { lo: COLOMBO_NORMS.RFa.lo, hi: COLOMBO_NORMS.RFa.hi },
  SB: { lo: COLOMBO_NORMS.SB.lo, hi: COLOMBO_NORMS.SB.hi },
};

function cellColor(val: number | undefined, norm: { lo: number; hi: number }): string {
  if (val === undefined || val === null || !Number.isFinite(val)) return "inherit";
  if (val < norm.lo) return "hsl(17 100% 60%)";
  if (val > norm.hi) return "hsl(0 72% 62%)";
  return "hsl(140 60% 55%)";
}

function fmt(v: number | undefined, digits = 2): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

/** True if this phase's spectral aggregates could not be computed. */
function spectralUnavailable(m: PhaseMetrics | undefined): boolean {
  return m?.provenance?.LFa?.method === "unavailable";
}

/**
 * Render a proprietary [P] spectral cell honestly:
 *  - "unavailable" when inputs were insufficient (never a fabricated 0)
 *  - otherwise the estimated value, tinted vs the norm band
 */
function SpectralCell({
  m,
  value,
  norm,
  digits = 2,
}: {
  m: PhaseMetrics | undefined;
  value: number | undefined;
  norm: { lo: number; hi: number };
  digits?: number;
}) {
  if (spectralUnavailable(m)) {
    return (
      <td className="py-2.5 pr-4 tabular-nums text-muted-foreground/60 italic" title="Insufficient signal in this phase to compute this proprietary estimate.">
        unavailable
      </td>
    );
  }
  return (
    <td className="py-2.5 pr-4 tabular-nums" style={{ color: cellColor(value, norm) }}>
      {fmt(value, digits)}
    </td>
  );
}

interface NumericalSummaryProps {
  report: ANSReport;
}

export function NumericalSummary({ report }: NumericalSummaryProps) {
  const phaseMap = new Map<string, PhaseMetrics>();
  report.phaseEvents.forEach((p) => phaseMap.set(p.phase, p));

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="mpg-numerical-summary"
    >
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium">
            Numerical Summary
          </h3>
          <p className="text-[11px] text-muted-foreground/70 mt-1">
            Audit trail — every number the graphical charts are derived from
          </p>
        </div>
        <div className="text-[10px] text-muted-foreground/70 tabular-nums text-right">
          <div>HR {report.autonomicBalance.balance != null ? (Math.round(report.autonomicBalance.balance) || "—") : "—"} · RR cnt {report.rPeakCount}</div>
          <div>SR {report.samplingRate} Hz · FRF {report.respiratoryFrequency != null ? `${report.respiratoryFrequency.toFixed(2)} Hz` : "not assessed"}</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border-collapse min-w-[640px]">
          <thead>
            <tr className="border-b border-border/40">
              {["Phase", "Duration", "HR mean ± range", "FRF (Hz)", "LFa", "RFa", "LFa/RFa", "BP"].map((h) => (
                <th
                  key={h}
                  className="text-left py-2 pr-4 text-[9px] uppercase tracking-wider text-muted-foreground font-medium whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PHASES.map((pl, i) => {
              const m = phaseMap.get(pl.key);
              return (
                <tr
                  key={pl.key}
                  className={`border-b border-border/20 ${i % 2 === 0 ? "bg-card/20" : ""}`}
                  data-testid={`num-row-${pl.key}`}
                >
                  <td className="py-2.5 pr-4 font-medium whitespace-nowrap">{pl.short}</td>
                  <td className="py-2.5 pr-4 tabular-nums text-muted-foreground">{m?.duration ?? "—"}</td>
                  <td className="py-2.5 pr-4 tabular-nums">
                    {m && Number.isFinite(m.meanHR)
                      ? `${Math.round(m.meanHR)} ± ${Number.isFinite(m.rangeHR) ? Math.round(m.rangeHR) : "—"}`
                      : "—"}
                  </td>
                  <SpectralCell m={m} value={m?.FRF} norm={NORMS.FRF} digits={3} />
                  <SpectralCell m={m} value={m?.LFa} norm={NORMS.LFa} />
                  <SpectralCell m={m} value={m?.RFa} norm={NORMS.RFa} />
                  <SpectralCell m={m} value={m?.SB} norm={NORMS.SB} />
                  <td className="py-2.5 pr-4 tabular-nums text-muted-foreground">
                    {m?.SBP && m?.DBP ? `${Math.round(m.SBP)}/${Math.round(m.DBP)}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Ratios sub-row */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MiniRatio label="E/I" value={report.ratios.eiRatio.value} normal={report.ratios.eiRatio.normal} />
        <MiniRatio label="Valsalva" value={report.ratios.valsalvaRatio.value} normal={report.ratios.valsalvaRatio.normal} />
        <MiniRatio label="30:15" value={report.ratios.thirtyFifteenRatio.value} normal={report.ratios.thirtyFifteenRatio.normal} />
      </div>

      <div className="mt-3 pt-3 border-t border-border/20 text-[10px] text-muted-foreground leading-relaxed">
        <span className="font-medium text-foreground/60">Legend:</span>{" "}
        <span style={{ color: "hsl(140 60% 55%)" }}>■ In band</span>
        <span className="mx-2">·</span>
        <span style={{ color: "hsl(17 100% 60%)" }}>■ Below norm</span>
        <span className="mx-2">·</span>
        <span style={{ color: "hsl(0 72% 62%)" }}>■ Above norm</span>
      </div>

      {/* Evidence-tier caveat: FRF/LFa/RFa/LFa-RFa are proprietary [P]. */}
      <div
        className="mt-2 text-[10px] text-amber-500/80 leading-relaxed"
        data-testid="num-provenance-caveat"
      >
        <span className="font-medium">FRF, LFa, RFa, LFa/RFa [P]:</span>{" "}
        computed estimates, not vendor-validated. {tierCaveat("P")} Phases with
        insufficient signal are shown as <em>unavailable</em> rather than a
        substituted value.
      </div>

      <ColomboExplainer chartKey="numericalSummary" />
    </motion.div>
  );
}

function MiniRatio({ label, value, normal }: { label: string; value: number; normal: string }) {
  return (
    <div className="rounded-xl bg-background/40 border border-border/20 px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="flex items-baseline justify-between gap-2 mt-0.5">
        <span className="text-lg font-semibold tabular-nums">{value.toFixed(2)}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">{normal}</span>
      </div>
    </div>
  );
}
