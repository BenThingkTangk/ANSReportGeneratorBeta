import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ANSReport, WellnessDriver, SubScore } from "@shared/schema";

interface WellnessBreakdownProps {
  report: ANSReport;
}

const severityStyle: Record<WellnessDriver["severity"], { color: string; bg: string; dot: string }> = {
  positive: { color: "hsl(140 65% 58%)", bg: "hsl(140 60% 50% / 0.12)", dot: "hsl(140 65% 55%)" },
  neutral:  { color: "hsl(210 15% 70%)", bg: "hsl(210 15% 50% / 0.10)", dot: "hsl(210 15% 60%)" },
  mild:     { color: "hsl(48 90% 60%)",  bg: "hsl(48 90% 55% / 0.10)",  dot: "hsl(48 90% 55%)" },
  moderate: { color: "hsl(25 90% 60%)",  bg: "hsl(25 90% 55% / 0.12)",  dot: "hsl(25 90% 55%)" },
  severe:   { color: "hsl(0 75% 62%)",   bg: "hsl(0 75% 55% / 0.14)",   dot: "hsl(0 75% 55%)" },
};

function DriverRow({ driver, showPoints = true }: { driver: WellnessDriver; showPoints?: boolean }) {
  const s = severityStyle[driver.severity];
  const sign = driver.points > 0 ? "+" : "";
  const arrow = driver.points > 0 ? "↑" : driver.points < 0 ? "↓" : "•";
  return (
    <div
      className="flex items-start justify-between gap-3 py-2 px-3 rounded-lg"
      style={{ background: s.bg }}
    >
      <div className="flex items-start gap-2 min-w-0 flex-1">
        <span
          className="text-xs mt-0.5 font-bold shrink-0"
          style={{ color: s.color }}
          aria-hidden
        >
          {arrow}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground truncate">{driver.label}</div>
          <div className="text-xs text-muted-foreground">{driver.value}</div>
        </div>
      </div>
      {showPoints && (
        <div
          className="text-sm font-semibold tabular-nums shrink-0"
          style={{ color: s.color }}
        >
          {sign}{driver.points.toFixed(1)}
        </div>
      )}
    </div>
  );
}

function SubScoreCard({ label, sub, tone }: { label: string; sub: SubScore; tone: "pos" | "neg" | "neu" }) {
  const [open, setOpen] = useState(false);
  const toneColor = tone === "pos" ? "hsl(140 65% 55%)" : tone === "neg" ? "hsl(25 90% 55%)" : "hsl(185 85% 50%)";
  const drivers = sub.drivers ?? [];
  return (
    <div className="rounded-xl border border-border/30 bg-card/30 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-card/60 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: toneColor }} />
          <div className="text-left min-w-0">
            <div className="text-sm font-medium text-foreground truncate">{label}</div>
            <div className="text-xs text-muted-foreground">
              {sub.score == null
                ? "Not assessed on this recording — this domain contributed nothing to the composite and its weight was not given to any other domain."
                : `${sub.score.toFixed(1)}/100 · weight ${(sub.weight * 100).toFixed(0)}% · contributes ${sub.contribution.toFixed(1)} pts`}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-20 h-1.5 rounded-full bg-border/40 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, Math.max(0, sub.score ?? 0))}%`, background: toneColor }}
            />
          </div>
          <svg
            className="w-4 h-4 text-muted-foreground transition-transform"
            style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && drivers.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-border/20"
          >
            <div className="p-3 space-y-1.5">
              {drivers.map((d, i) => (
                <DriverRow key={i} driver={d} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function WellnessBreakdown({ report }: WellnessBreakdownProps) {
  const [open, setOpen] = useState(false);
  const bd = report.wellnessBreakdown;

  // Defensive: if v1 report (no drivers), degrade gracefully
  const hasV2 = !!bd?.topNegativeDrivers && !!bd?.topPositiveDrivers;

  const topNeg = hasV2 ? bd.topNegativeDrivers! : [];
  const topPos = hasV2 ? bd.topPositiveDrivers! : [];
  const headline = bd?.headline;
  const patternItems = bd?.patternPenalty?.items ?? [];

  return (
    <div className="rounded-2xl border border-border/30 bg-card/20 backdrop-blur-sm overflow-hidden">
      {/* Headline strip (always visible) */}
      {headline && (
        <div className="px-5 py-3 border-b border-border/20 bg-gradient-to-r from-card/40 to-card/10">
          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 mt-0.5 text-primary shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <p className="text-sm text-foreground/90 leading-relaxed">{headline}</p>
          </div>
        </div>
      )}

      {/* Top drivers quick view */}
      {(topNeg.length > 0 || topPos.length > 0) && (
        <div className="px-5 py-4 grid md:grid-cols-2 gap-4">
          {topNeg.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold tracking-wider text-muted-foreground mb-2">
                PULLING YOUR SCORE DOWN
              </h4>
              <div className="space-y-1.5">
                {topNeg.map((d, i) => <DriverRow key={i} driver={d} />)}
              </div>
            </div>
          )}
          {topPos.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold tracking-wider text-muted-foreground mb-2">
                LIFTING YOUR SCORE UP
              </h4>
              <div className="space-y-1.5">
                {topPos.map((d, i) => <DriverRow key={i} driver={d} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Expand toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-3 border-t border-border/20 flex items-center justify-between hover:bg-card/30 transition-colors text-sm"
        data-testid="wellness-breakdown-toggle"
      >
        <span className="font-medium text-foreground/80">
          {open ? "Hide full breakdown" : "See full wellness math"}
        </span>
        <svg
          className="w-4 h-4 text-muted-foreground transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Full breakdown */}
      <AnimatePresence initial={false}>
        {open && bd && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden border-t border-border/20"
          >
            <div className="p-5 space-y-4">
              <div>
                <h4 className="text-[11px] font-semibold tracking-wider text-muted-foreground mb-3">
                  FIVE-FACTOR COMPOSITE (click a row for details)
                </h4>
                <div className="space-y-2">
                  <SubScoreCard label="Baseline autonomic tone" sub={bd.baselineAutonomic} tone={(bd.baselineAutonomic.score ?? 0) >= 70 ? "pos" : "neg"} />
                  <SubScoreCard label="Sympathovagal balance" sub={bd.sympathovagalBalance} tone={(bd.sympathovagalBalance.score ?? 0) >= 70 ? "pos" : "neg"} />
                  <SubScoreCard label="Reflex integrity (Ewing battery)" sub={bd.reflexIntegrity} tone={(bd.reflexIntegrity.score ?? 0) >= 70 ? "pos" : "neg"} />
                  <SubScoreCard label="Orthostatic response" sub={bd.orthostaticResponse} tone={(bd.orthostaticResponse.score ?? 0) >= 70 ? "pos" : "neg"} />
                  <SubScoreCard label="Heart-rhythm variability reserve" sub={bd.hrvReserve} tone={(bd.hrvReserve.score ?? 0) >= 70 ? "pos" : "neg"} />
                </div>
              </div>

              {patternItems.length > 0 && (
                <div>
                  <h4 className="text-[11px] font-semibold tracking-wider text-muted-foreground mb-2">
                    DYSFUNCTION PATTERN PENALTIES (−{bd.patternPenalty?.total.toFixed(1)} pts total)
                  </h4>
                  <div className="space-y-1.5">
                    {patternItems.map((p, i) => <DriverRow key={i} driver={p} />)}
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-border/20 text-xs text-muted-foreground space-y-1 font-mono">
                <div className="flex justify-between"><span>Sub-score composite:</span><span className="tabular-nums">{bd.rawTotal == null ? "Not scorable" : `${bd.rawTotal.toFixed(1)}/100`}</span></div>
                <div className="flex justify-between"><span>Age adjustment (×{bd.ageMultiplier.toFixed(2)}):</span><span className="tabular-nums">{bd.ageAdjusted == null ? "Not scorable" : bd.ageAdjusted.toFixed(1)}</span></div>
                {bd.patternPenalty && (
                  <div className="flex justify-between"><span>Pattern penalties:</span><span className="tabular-nums">−{bd.patternPenalty.total.toFixed(1)}</span></div>
                )}
                <div className="flex justify-between pt-1 border-t border-border/20 text-foreground font-semibold">
                  <span>Final wellness score:</span><span className="tabular-nums">{bd.final == null ? "Not scorable" : bd.final.toFixed(1)}</span>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground/80 italic leading-relaxed pt-2">
                Scoring uses the age-specific reference table documented in the app (see Methodology
                &amp; References) together with the Colombo P&amp;S normal bands, the cardiovagal reflex
                battery, the orthostatic response and heart-rhythm-variability reserve. Domains that
                could not be assessed contribute nothing and their weight is NOT redistributed, so
                missing data can never raise this score. Patterns that were affirmatively detected are
                penalized with diminishing returns to avoid double-counting overlapping findings.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
