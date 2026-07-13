/**
 * VendorFamiliarReport — a clinician view that preserves the CLINICAL GRAMMAR of
 * the signed Physio PS "P&S 4.0 ANS Test Results" report Dr. Colombo reads from,
 * rendered in the HumanOS design system.
 *
 * It shows the vendor's OWN verbatim numbers (from the paired report, extracted
 * by OCR / text-layer parsing and tagged `vendor_reported`) in the vendor's
 * familiar structure: the resting-baseline spectral block (LFa* / RFa* /
 * LFa/RFa with normal-range bars), the three time-domain Ewing ratios with their
 * one-sided normal thresholds, and the identity banner — same labels, ordering,
 * scales, and legends as the vendor page.
 *
 * SAFETY / HONESTY:
 *   • Every number here is the VENDOR's printed value (vendor_reported); nothing
 *     is computed or inferred. A field the parser could not read is shown as
 *     "not read" with its low confidence — never fabricated.
 *   • Per-field OCR confidence and source page are surfaced on hover so the
 *     clinician can audit provenance.
 *   • We deliberately do NOT reproduce vendor branding (the PhysioPS logo/mark);
 *     we preserve the clinical layout and terminology, which is what makes it
 *     familiar and traceable.
 */
import { motion } from "framer-motion";
import type { VendorReportExtraction, VendorField } from "@shared/vendorExtraction";
import {
  COLOMBO_NORMS,
  EWING_THRESHOLDS,
  classifyEwing,
  classifySpectral,
  type EwingRatioKey,
  type NormBand,
} from "@shared/colomboNorms";

interface Props {
  extraction: VendorReportExtraction;
  /** Source of the extraction, for the provenance chip. */
  source?: "ocr" | "text";
  /** Mean OCR page confidence 0..100 (scanned only). */
  ocrConfidence?: number;
  fileName?: string;
}

const CYAN = "hsl(187 100% 50%)";
const EMBER = "hsl(17 100% 60%)";
const VIOLET = "hsl(252 92% 76%)";
const GREEN = "hsl(140 60% 55%)";
const RED = "hsl(0 72% 62%)";
const AMBER = "hsl(38 92% 55%)";

function confColor(c: number): string {
  if (c >= 0.85) return GREEN;
  if (c >= 0.6) return AMBER;
  return RED;
}

/** A single value cell with vendor label + provenance tooltip. */
function ValueCell({
  label,
  sub,
  field,
  digits = 2,
  interpretation,
}: {
  label: string;
  sub?: string;
  field: VendorField<number>;
  digits?: number;
  interpretation?: string;
}) {
  const read = field.value != null && field.provenance != null;
  const conf = field.provenance?.confidence ?? 0;
  return (
    <div
      className="flex items-baseline justify-between gap-3 py-2 border-b border-border/20 last:border-0"
      data-testid={`vendor-cell-${label.replace(/\W+/g, "-").toLowerCase()}`}
      title={
        read
          ? `Vendor-reported · page ${field.provenance!.page} · OCR confidence ${(conf * 100).toFixed(0)}%\nsource: "${field.provenance!.sourceText}"`
          : "Not read from the vendor report"
      }
    >
      <div className="min-w-0">
        <div className="text-sm text-foreground/90 font-medium">{label}</div>
        {sub && <div className="text-[10px] text-muted-foreground/70">{sub}</div>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {interpretation && read && (
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{interpretation}</span>
        )}
        {read ? (
          <span className="tabular-nums text-base font-semibold" style={{ color: "hsl(var(--foreground))" }}>
            {field.value!.toFixed(digits)}
            {field.unit ? <span className="text-[10px] text-muted-foreground ml-1">{field.unit}</span> : null}
          </span>
        ) : (
          <span className="text-xs italic text-muted-foreground/60">not read</span>
        )}
        {read && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: confColor(conf) }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}

/** Horizontal normal-range bar mirroring the vendor's "NORMAL RANGE" bars. */
function NormBar({
  value,
  lo,
  hi,
  color,
}: {
  value: number | null;
  lo: number;
  hi: number;
  color: string;
}) {
  if (value == null) return null;
  // Plot on a domain padded a little beyond [lo,hi] and the value.
  const min = Math.min(lo, value) * 0.8;
  const max = Math.max(hi, value) * 1.15;
  const span = max - min || 1;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - min) / span) * 100));
  return (
    <div className="relative h-2 rounded-full bg-card/60 mt-1" aria-hidden>
      {/* normal band (gray) */}
      <div
        className="absolute top-0 h-full rounded-full"
        style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%`, background: "hsl(210 12% 30% / 0.55)" }}
      />
      {/* value marker */}
      <div
        className="absolute top-1/2 -translate-y-1/2 w-1.5 h-3.5 rounded-sm"
        style={{ left: `calc(${pct(value)}% - 3px)`, background: color }}
      />
    </div>
  );
}

/** A resting spectral row: labelled value cell + its normal-range bar. */
function SpectralRow({
  label,
  sub,
  field,
  band,
  color,
  interpretation,
}: {
  label: string;
  sub: string;
  field: VendorField<number>;
  band: NormBand;
  color: string;
  interpretation: string;
}) {
  return (
    <div>
      <ValueCell label={label} sub={sub} field={field} interpretation={interpretation} />
      <NormBar value={field.value} lo={band.lo} hi={band.hi} color={color} />
    </div>
  );
}

export function VendorFamiliarReport({ extraction, source, ocrConfidence, fileName }: Props) {
  const { identity, baseline, ratios } = extraction;

  // Low/Normal/High label for a spectral value against its Colombo band ("" when
  // the value wasn't read). Collapses the class→label chain used per row.
  const spectralLabel = (v: number | null, band: NormBand): string => {
    if (v == null) return "";
    const c = classifySpectral(v, band);
    return c === "low" ? "Low" : c === "high" ? "High" : "Normal";
  };

  const ewingRow = (key: EwingRatioKey, field: VendorField<number>) => {
    const t = EWING_THRESHOLDS[key];
    const cls = field.value != null ? classifyEwing(field.value, t) : null;
    return { t, cls, field };
  };
  const ei = ewingRow("eiRatio", ratios.eiRatio);
  const vals = ewingRow("valsalvaRatio", ratios.valsalvaRatio);
  const tf = ewingRow("thirtyFifteenRatio", ratios.thirtyFifteenRatio);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-4"
      data-testid="vendor-familiar-report"
    >
      {/* Provenance banner */}
      <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/5 px-4 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs uppercase tracking-[0.15em] text-cyan-300/90 font-medium">
            Vendor-Reported — Physio PS ANS Test Results (verbatim)
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            {source && (
              <span className="px-2 py-0.5 rounded-full border border-border/40">
                {source === "ocr" ? "read via OCR" : "text layer"}
              </span>
            )}
            {source === "ocr" && typeof ocrConfidence === "number" && (
              <span className="px-2 py-0.5 rounded-full border border-border/40">scan quality {ocrConfidence}%</span>
            )}
            <span className="px-2 py-0.5 rounded-full border border-border/40">
              {extraction.fieldCount} fields · {(extraction.meanConfidence * 100).toFixed(0)}% mean conf
            </span>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground/80 mt-2 leading-relaxed">
          These are the vendor's own printed values from the paired signed report
          {fileName ? ` (${fileName})` : ""}, shown in the familiar P&amp;S structure. Every
          number is <span className="text-foreground/80">vendor-reported</span>, not recomputed;
          hover any value for its source page and confidence. Fields the scan could not resolve are
          marked <span className="italic">not read</span> — never guessed.
        </p>
      </div>

      {/* Identity banner (clinical grammar of the vendor header) */}
      <div className="rounded-2xl border border-border/30 bg-card/40 px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5 text-xs">
        <Meta label="Patient" v={identity.patientName.value} />
        <Meta label="Test Date" v={identity.testDate.value} />
        <Meta label="Physician" v={identity.physician.value} />
        <Meta label="Gender" v={identity.sex.value} />
        <Meta label="DOB" v={identity.dob.value} />
        <Meta label="Age" v={identity.age.value != null ? String(identity.age.value) : null} />
        <Meta label="Height" v={identity.heightText.value} />
        <Meta label="BMI" v={identity.bmi.value != null ? String(identity.bmi.value) : null} />
      </div>

      {/* Initial Baseline (Resting) — the vendor's resting spectral block */}
      <section className="rounded-2xl border border-border/30 bg-card/40 p-4">
        <h3 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium mb-3">
          Initial Baseline (Resting) — ANS Test Results
        </h3>
        <div className="space-y-1">
          <ValueCell label="Mean Heart Rate" field={baseline.meanHR} digits={0} />
          <ValueCell label="Range Heart Rate" sub="RangeHR; Max − Min" field={baseline.rangeHR} digits={0} />
          <SpectralRow label="LFa* Modulation" sub={`Sympathetic · normal ${COLOMBO_NORMS.LFa.lo}–${COLOMBO_NORMS.LFa.hi} bpm²`} field={baseline.LFa} band={COLOMBO_NORMS.LFa} color={EMBER} interpretation={spectralLabel(baseline.LFa.value, COLOMBO_NORMS.LFa)} />
          <SpectralRow label="RFa* Modulation" sub={`Parasympathetic · normal ${COLOMBO_NORMS.RFa.lo}–${COLOMBO_NORMS.RFa.hi} bpm²`} field={baseline.RFa} band={COLOMBO_NORMS.RFa} color={CYAN} interpretation={spectralLabel(baseline.RFa.value, COLOMBO_NORMS.RFa)} />
          <SpectralRow label="LFa / RFa" sub={`Sympathovagal balance · normal ${COLOMBO_NORMS.SB.lo}–${COLOMBO_NORMS.SB.hi}`} field={baseline.SB} band={COLOMBO_NORMS.SB} color={VIOLET} interpretation={spectralLabel(baseline.SB.value, COLOMBO_NORMS.SB)} />
          <ValueCell label="Systolic Blood Pressure" field={baseline.SBP} digits={0} />
          <ValueCell label="Diastolic Blood Pressure" field={baseline.DBP} digits={0} />
          <ValueCell
            label="FRF"
            sub={`Fundamental Respiratory Frequency · normal ${COLOMBO_NORMS.FRF.lo}–${COLOMBO_NORMS.FRF.hi} Hz`}
            field={baseline.FRF}
          />
        </div>
      </section>

      {/* Time-Domain Ratios — vendor's Ewing block with one-sided thresholds */}
      <section className="rounded-2xl border border-border/30 bg-card/40 p-4">
        <h3 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium mb-3">
          Time Domain Ratios
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { name: "E/I Ratio", row: ei },
            { name: "Valsalva Ratio", row: vals },
            { name: "30:15 Ratio", row: tf },
          ].map(({ name, row }) => {
            const read = row.field.value != null;
            const normal = row.cls?.severity === "Normal";
            return (
              <div
                key={name}
                className="rounded-xl border border-border/30 px-3 py-3"
                data-testid={`vendor-ratio-${name.replace(/\W+/g, "-").toLowerCase()}`}
                title={
                  read
                    ? `Vendor-reported · page ${row.field.provenance?.page} · confidence ${((row.field.provenance?.confidence ?? 0) * 100).toFixed(0)}%`
                    : "Not read"
                }
              >
                <div className="text-[11px] text-muted-foreground">{name}</div>
                {read ? (
                  <>
                    <div className="text-2xl font-semibold tabular-nums" style={{ color: normal ? GREEN : RED }}>
                      {row.field.value!.toFixed(2)}
                    </div>
                    <div className="text-[10px] text-muted-foreground/80">
                      Normal &gt; {row.t.normalAbove}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide mt-0.5" style={{ color: normal ? GREEN : RED }}>
                      {row.cls?.severity ?? ""}
                    </div>
                  </>
                ) : (
                  <div className="text-sm italic text-muted-foreground/60 mt-1">not read</div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Vendor legend / footnote grammar */}
      <p className="text-[10px] text-muted-foreground/70 leading-relaxed px-1">
        * RFa is a measure of parasympathetic activity and LFa a measure of sympathetic activity
        (Colombo J, Arora RR, DePace NL, Vinik AI. <em>Clinical Autonomic Dysfunction: Measurement,
        Indications, Therapies, and Outcomes.</em> Springer, 2014). Normal ranges per Colombo P&amp;S 4.0.
      </p>
    </motion.div>
  );
}

function Meta({ label, v }: { label: string; v: string | null }) {
  return (
    <div>
      <span className="text-muted-foreground/70">{label}: </span>
      <span className="text-foreground/90">{v ?? "—"}</span>
    </div>
  );
}
