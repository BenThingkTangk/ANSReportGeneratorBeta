/**
 * MeasuredResultsCards — patient-facing "what we actually measured" block.
 *
 * Supported .ans exports may contain stored PhysioPS analysis values, ECG
 * samples, or both. The cards surface only values actually present in the
 * decoded report.
 * Historically the patient view buried these behind a misleading
 * "not enough heart-rhythm data" message. This block surfaces each ratio with
 * its value, normal range, status, and a plain-language meaning that keeps the
 * scientific substance (named reflex, what it probes) intact.
 *
 * It also states any upload-specific limitation once, without claiming that all
 * .ans files share the same schema.
 */
import { motion } from "framer-motion";
import { Activity, HeartPulse, MoveVertical, Info } from "lucide-react";
import type { ANSReport } from "@shared/schema";
import { ewingRatioReadings, hasVendorSpectral } from "@shared/deterministicSynopsis";

const ICONS: Record<string, typeof Activity> = {
  eiRatio: HeartPulse,
  valsalvaRatio: Activity,
  thirtyFifteenRatio: MoveVertical,
};

function severityStyle(sev: "Abnormal" | "Warning" | "Normal"): { text: string; bg: string; border: string; word: string } {
  switch (sev) {
    case "Normal":
      return { text: "hsl(152 60% 60%)", bg: "hsl(152 60% 42% / 0.08)", border: "hsl(152 60% 42% / 0.30)", word: "Normal" };
    case "Warning":
      return { text: "hsl(38 92% 62%)", bg: "hsl(38 92% 50% / 0.08)", border: "hsl(38 92% 50% / 0.30)", word: "Borderline" };
    default:
      return { text: "hsl(0 80% 68%)", bg: "hsl(0 80% 55% / 0.08)", border: "hsl(0 80% 55% / 0.30)", word: "Abnormal" };
  }
}

export function MeasuredResultsCards({
  report,
  vendorReportAttached = false,
}: {
  report: ANSReport;
  vendorReportAttached?: boolean;
}) {
  const ewing = ewingRatioReadings(report);
  if (ewing.length === 0) return null;

  const spectralAvailable = hasVendorSpectral(report);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15 }}
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="measured-results-cards"
    >
      <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium mb-1">
        Measured cardiovagal reflexes
      </h3>
      <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
        Computed directly from your ECG recording. These check how well your
        heart's calming (vagal) nerve responds — measured results, not estimates.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {ewing.map((e) => {
          const Icon = ICONS[e.key] ?? Activity;
          const s = severityStyle(e.severity);
          return (
            <div
              key={e.key}
              data-testid={`ewing-card-${e.key}`}
              className="rounded-xl border p-4 flex flex-col gap-2"
              style={{ borderColor: s.border, background: s.bg }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-foreground/80">
                  <Icon className="w-3.5 h-3.5" style={{ color: s.text }} />
                  {e.label}
                </span>
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ color: s.text, border: `1px solid ${s.border}` }}
                >
                  {e.classification || s.word}
                </span>
              </div>
              <div className="ps-text-mono text-2xl font-bold leading-none" style={{ color: s.text }}>
                {e.value.toFixed(2)}
              </div>
              <div className="text-[10px] text-muted-foreground">{e.normal}</div>
              <p className="text-xs text-foreground/70 leading-relaxed mt-1">{e.plain}</p>
            </div>
          );
        })}
      </div>

      {!spectralAvailable && (
        <div
          className="flex items-start gap-2 text-xs text-muted-foreground mt-4 pt-3 border-t border-border/20 leading-relaxed"
          data-testid="measured-results-spectral-note"
        >
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "hsl(185 70% 60%)" }} />
          <span>
            The sympathetic-vs-parasympathetic <strong>spectral branch-balance</strong> split
            was not available at a clinically usable provenance tier in this
            upload, so it is shown as “Not assessed.”{" "}
            {vendorReportAttached
              ? "The attached vendor report was processed, but readable LFa/RFa values were not recovered; your clinician can verify them against the signed report."
              : "Some PhysioPS .ans files include stored LFa/RFa/SB values; when this file does not, a matched vendor report may supplement them. No value is guessed."}
          </span>
        </div>
      )}
    </motion.section>
  );
}
