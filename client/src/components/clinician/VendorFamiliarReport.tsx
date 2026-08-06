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
import type { VendorReportExtraction, VendorField, VendorPhaseTable, VendorPhaseRow, VendorOrthostaticObservation, VendorNarrativeFinding } from "@shared/vendorExtraction";
import { crossCheckTestDate } from "@shared/vendorExtraction";
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
  /**
   * Authoritative test date from the paired .ans recording (LabVIEW timestamp /
   * filename). When supplied it is PREFERRED for the header and cross-checked
   * against the OCR-read date; a conflict is surfaced, never silently resolved.
   */
  trustedTestDate?: string | null;
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

export function VendorFamiliarReport({ extraction, source, ocrConfidence, fileName, trustedTestDate }: Props) {
  const { identity, baseline, ratios } = extraction;

  // Test-date cross-check: prefer the .ans recording date for the header, keep
  // the raw OCR value for audit, and surface a conflict rather than silently
  // overwriting (defect B: OCR read 8/26 vs the true 9/26).
  const dateCheck = crossCheckTestDate(identity.testDate.value, trustedTestDate);

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
            {/* PLAIN COUNT. "18 fields · 0% mean conf" reads like a poor match;
                the truth in that case is "0 of 18 numeric fields read". */}
            <span className="px-2 py-0.5 rounded-full border border-border/40" data-testid="vendor-field-count">
              {extraction.fieldCount} of {extraction.attemptedFieldCount ?? extraction.fieldCount} numeric fields read
            </span>
            {extraction.fieldCount === 0 && (
              <span
                className="px-2 py-0.5 rounded-full border"
                style={{ borderColor: "hsl(38 92% 50% / 0.4)", color: "hsl(38 92% 70%)" }}
                data-testid="vendor-unreadable-chip"
              >
                numeric content unreadable
              </span>
            )}
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
        <div data-testid="vendor-test-date">
          <span className="text-muted-foreground/70">Test Date: </span>
          <span className="text-foreground/90">{dateCheck.display ?? "—"}</span>
          {dateCheck.conflict && (
            <span
              className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide align-middle"
              style={{ background: "hsl(38 92% 55% / 0.16)", color: AMBER }}
              title={dateCheck.note ?? ""}
              data-testid="vendor-test-date-conflict"
            >
              scan read {dateCheck.ocr}
            </span>
          )}
        </div>
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

      {/* Narrative findings (Diagnostic Implication Summary / Colombo letter) —
          categorical vendor findings + any number the vendor printed in prose
          (e.g. SB = 2.59). Present on narrative-style PDFs with no numeric grid. */}
      {extraction.narrative &&
        (extraction.narrative.findings.length > 0 || extraction.narrative.printedNumbers.length > 0) && (
          <VendorNarrativeSection narrative={extraction.narrative} />
        )}

      {/* Per-phase A–F Numerical Summary (page 2) — vendor's own table grammar */}
      {extraction.phases && extraction.phases.rows.length > 0 && (
        <>
          <PhaseSummaryTable table={extraction.phases} />
          <PhaseTrendCharts table={extraction.phases} />
        </>
      )}

      {/* Vendor-reported orthostatic observation (context only, NOT .ans scoring) */}
      {extraction.orthostatic && <OrthostaticObservationCard obs={extraction.orthostatic} />}

      {/* Vendor legend / footnote grammar */}
      <p className="text-[10px] text-muted-foreground/70 leading-relaxed px-1">
        * RFa is a measure of parasympathetic activity and LFa a measure of sympathetic activity
        (Colombo J, Arora RR, DePace NL, Vinik AI. <em>Clinical Autonomic Dysfunction: Measurement,
        Indications, Therapies, and Outcomes.</em> Springer, 2014). Normal ranges per Colombo P&amp;S 4.0.
      </p>
    </motion.div>
  );
}

/** Color + label for a categorical vendor finding classification. */
function findingStyle(c: VendorNarrativeFinding["classification"]): { color: string; text: string } {
  switch (c) {
    case "normal": return { color: "hsl(140 60% 55%)", text: "Normal" };
    case "high-normal": return { color: "hsl(140 55% 60%)", text: "High-normal" };
    case "borderline-low": return { color: "hsl(38 92% 60%)", text: "Borderline low" };
    case "borderline-high": return { color: "hsl(38 92% 60%)", text: "Borderline high" };
    case "low": return { color: "hsl(17 100% 62%)", text: "Low" };
    case "high": return { color: "hsl(0 72% 62%)", text: "High" };
    case "abnormal": return { color: "hsl(0 72% 62%)", text: "Abnormal" };
    case "present": return { color: "hsl(0 72% 62%)", text: "Present" };
    default: return { color: "hsl(var(--muted-foreground))", text: c };
  }
}

const PHASE_TITLE: Record<VendorNarrativeFinding["phase"], string> = {
  baseline: "Initial Baseline",
  deep_breathing_valsalva: "Deep Breathing & Valsalva",
  stand: "Stand Responses",
  overall: "Overall",
};

/**
 * Narrative vendor findings — the Diagnostic Implication Summary / Colombo
 * letter state findings in prose (no numeric grid). Renders the vendor's OWN
 * categorical findings verbatim, grouped by phase, plus any number the vendor
 * printed in prose (e.g. SB = 2.59). Everything is vendor_reported; nothing is
 * computed. This is what fills the view for narrative-only vendor PDFs.
 */
function VendorNarrativeSection({ narrative }: { narrative: NonNullable<VendorReportExtraction["narrative"]> }) {
  const byPhase = new Map<VendorNarrativeFinding["phase"], VendorNarrativeFinding[]>();
  for (const f of narrative.findings) {
    const arr = byPhase.get(f.phase) ?? [];
    arr.push(f);
    byPhase.set(f.phase, arr);
  }
  const order: VendorNarrativeFinding["phase"][] = ["baseline", "deep_breathing_valsalva", "stand", "overall"];
  return (
    <section className="ps-glass p-4" data-testid="vendor-narrative-findings">
      <h4 className="ps-overline ps-underline-cyan mb-1">Vendor-reported findings</h4>
      <p className="text-[10px] text-muted-foreground/70 mb-3">
        Categorical findings printed in the signed report/letter (vendor-reported, verbatim).
        Values the vendor did not print numerically are shown as the vendor's own wording — never converted to a number.
      </p>
      {narrative.printedNumbers.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2" data-testid="vendor-printed-numbers">
          {narrative.printedNumbers.map((n) => (
            <span key={n.key} className="inline-flex items-baseline gap-1 rounded px-2 py-1 text-xs"
              style={{ background: "hsl(244 84% 68% / 0.12)", color: "hsl(244 84% 78%)" }}
              title={n.sourceText}>
              <span className="font-medium">{n.key}</span>
              <span className="tabular-nums">{n.value}</span>
              <span className="text-[9px] uppercase opacity-70">vendor-printed</span>
            </span>
          ))}
        </div>
      )}
      <div className="space-y-3">
        {order.filter((p) => byPhase.has(p)).map((p) => (
          <div key={p}>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground/80 mb-1">{PHASE_TITLE[p]}</div>
            <ul className="space-y-1">
              {byPhase.get(p)!.map((f) => {
                const s = findingStyle(f.classification);
                return (
                  <li key={f.key} className="flex items-start justify-between gap-3 text-xs" data-testid={`vendor-finding-${f.key}`}>
                    <span className="text-muted-foreground">{f.label}</span>
                    <span className="font-medium whitespace-nowrap" style={{ color: s.color }} title={f.sourceText}>{s.text}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Per-phase A–F Numerical Summary table (page 2). Renders the vendor's own grid:
 * one row per phase, one column per measure. Every cell shows the vendor-reported
 * value with a provenance tooltip, or an em dash for cells the scan could not
 * resolve (never a guessed number). Mirrors the vendor's column order/labels.
 */
function PhaseSummaryTable({ table }: { table: VendorPhaseTable }) {
  const cols: Array<{ key: keyof VendorPhaseRow; label: string; digits?: number }> = [
    { key: "duration", label: "Duration" },
    { key: "meanHR", label: "meanHR", digits: 0 },
    { key: "rangeHR", label: "(max−min)HR", digits: 0 },
    { key: "FRF", label: "FRF", digits: 2 },
    { key: "LFa", label: "LFa*", digits: 2 },
    { key: "RFa", label: "RFa*", digits: 2 },
    { key: "SB", label: "LFa/RFa", digits: 2 },
    { key: "SBP", label: "SBP", digits: 0 },
    { key: "DBP", label: "DBP", digits: 0 },
    { key: "PP", label: "PP", digits: 0 },
    { key: "MAP", label: "MAP", digits: 0 },
  ];
  const cell = (row: VendorPhaseRow, key: keyof VendorPhaseRow, digits?: number) => {
    const f = row[key] as VendorField<number | string>;
    const read = f && f.value != null && f.provenance != null;
    if (!read) {
      return (
        <td key={String(key)} className="px-2 py-1.5 text-center text-muted-foreground/50 italic" data-testid={`phase-${row.key}-${String(key)}-unread`}>
          —
        </td>
      );
    }
    const conf = f.provenance!.confidence;
    const display =
      typeof f.value === "number" && digits != null ? (f.value as number).toFixed(digits) : String(f.value);
    return (
      <td
        key={String(key)}
        className="px-2 py-1.5 text-center tabular-nums"
        data-testid={`phase-${row.key}-${String(key)}`}
        title={`Vendor-reported · page ${f.provenance!.page} · confidence ${(conf * 100).toFixed(0)}%\nsource: "${f.provenance!.sourceText}"`}
      >
        <span>{display}</span>
        <span className="inline-block ml-1 w-1 h-1 rounded-full align-middle" style={{ background: confColor(conf) }} aria-hidden />
      </td>
    );
  };
  return (
    <section className="rounded-2xl border border-border/30 bg-card/40 p-4" data-testid="vendor-phase-table">
      <h3 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium mb-1">
        Numerical Summary — per phase (A–F)
      </h3>
      <p className="text-[10px] text-muted-foreground/70 mb-3">
        Vendor-reported values from the page-2 summary grid. Cells the scan could not resolve
        are shown as <span className="italic">—</span> (not read), never guessed.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="text-muted-foreground/80 border-b border-border/30">
              <th className="px-2 py-1.5 text-left font-medium">Phase</th>
              <th className="px-2 py-1.5 text-left font-medium">Event</th>
              {cols.map((c) => (
                <th key={String(c.key)} className="px-2 py-1.5 text-center font-medium">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.key} className="border-b border-border/15 last:border-0" data-testid={`phase-row-${row.key}`}>
                <td className="px-2 py-1.5 font-semibold text-foreground/90">{row.key}</td>
                <td className="px-2 py-1.5 text-foreground/80">{row.label || "—"}</td>
                {cols.map((c) => cell(row, c.key, c.digits))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Per-phase LFa* / RFa* trend charts across A–F, mirroring the vendor's page-2
 * "LFA* Trend / RFA* Trend" panels. Plots ONLY the cells that were read (each
 * marker carries a provenance tooltip); phases whose value is not-read leave a
 * gap in the polyline — never an interpolated/fabricated point. Pure SVG (no
 * chart dependency), log-safe linear scale over the read values.
 */
function PhaseTrendCharts({ table }: { table: VendorPhaseTable }) {
  const series: Array<{ key: "LFa" | "RFa"; label: string; color: string }> = [
    { key: "LFa", label: "LFa* (sympathetic)", color: EMBER },
    { key: "RFa", label: "RFa* (parasympathetic)", color: CYAN },
  ];
  // Domain across ALL read LFa/RFa values so both series share a scale.
  const allVals: number[] = [];
  for (const r of table.rows) {
    for (const k of ["LFa", "RFa"] as const) {
      const v = (r[k] as VendorField<number>).value;
      if (v != null) allVals.push(v);
    }
  }
  if (allVals.length === 0) return null;
  const vmax = Math.max(...allVals, 1);
  const W = 460, H = 130, padL = 34, padR = 10, padT = 12, padB = 22;
  const n = table.rows.length;
  const xAt = (i: number) => padL + (n <= 1 ? 0 : (i * (W - padL - padR)) / (n - 1));
  const yAt = (v: number) => padT + (1 - v / vmax) * (H - padT - padB);

  const polyline = (key: "LFa" | "RFa") => {
    // Build segments over consecutive READ points; gaps break the line.
    const pts = table.rows.map((r, i) => {
      const v = (r[key] as VendorField<number>).value;
      return v == null ? null : { x: xAt(i), y: yAt(v), v, i, row: r };
    });
    const segments: string[] = [];
    let run: Array<{ x: number; y: number }> = [];
    for (const p of pts) {
      if (p) run.push({ x: p.x, y: p.y });
      else { if (run.length > 1) segments.push(run.map((q) => `${q.x},${q.y}`).join(" ")); run = []; }
    }
    if (run.length > 1) segments.push(run.map((q) => `${q.x},${q.y}`).join(" "));
    return { pts, segments };
  };

  return (
    <section className="rounded-2xl border border-border/30 bg-card/40 p-4" data-testid="vendor-phase-charts">
      <h3 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium mb-1">
        Per-phase spectral trend (A–F)
      </h3>
      <p className="text-[10px] text-muted-foreground/70 mb-3">
        LFa* / RFa* across the vendor's phases, plotted only from read values; not-read phases
        leave a gap (never interpolated).
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {series.map(({ key, label, color }) => {
          const { pts, segments } = polyline(key);
          const readCount = pts.filter(Boolean).length;
          return (
            <div key={key} data-testid={`phase-chart-${key}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-block w-3 h-1.5 rounded" style={{ background: color }} aria-hidden />
                <span className="text-[11px] text-foreground/80">{label}</span>
                <span className="text-[10px] text-muted-foreground/60 ml-auto">{readCount}/{n} read</span>
              </div>
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${label} per-phase trend`}>
                {/* y-axis max tick */}
                <text x={4} y={yAt(vmax) + 4} fontSize={9} fill="hsl(var(--muted-foreground))">{vmax.toFixed(1)}</text>
                <text x={4} y={yAt(0)} fontSize={9} fill="hsl(var(--muted-foreground))">0</text>
                {/* phase x labels */}
                {table.rows.map((r, i) => (
                  <text key={r.key} x={xAt(i)} y={H - 6} fontSize={9} textAnchor="middle" fill="hsl(var(--muted-foreground))">{r.key}</text>
                ))}
                {/* line segments (gaps for not-read) */}
                {segments.map((s, si) => (
                  <polyline key={si} points={s} fill="none" stroke={color} strokeWidth={1.5} />
                ))}
                {/* markers for read points */}
                {pts.map((p, i) =>
                  p ? (
                    <circle key={i} cx={p.x} cy={p.y} r={3} fill={color} data-testid={`phase-chart-${key}-pt-${p.row.key}`}>
                      <title>{`${p.row.key} ${p.row.label}: ${key} ${p.v.toFixed(2)}`}</title>
                    </circle>
                  ) : null,
                )}
              </svg>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Vendor-reported orthostatic (baseline→stand) BP observation. Rendered with
 * explicit vendor provenance and a clear statement that it is a vendor
 * observation, NOT a deterministic .ans scoring input — resolving the clinician
 * "missing orthostatic BP data" contradiction without conflating the two sources.
 */
function OrthostaticObservationCard({ obs }: { obs: VendorOrthostaticObservation }) {
  const drop = obs.meetsOrthostaticHypotension;
  return (
    <section
      className="rounded-2xl border border-border/30 bg-card/40 p-4"
      data-testid="vendor-orthostatic-observation"
    >
      <h3 className="text-xs uppercase tracking-[0.15em] text-muted-foreground font-medium mb-1">
        Orthostatic BP — vendor-reported observation
      </h3>
      <div className="flex items-baseline gap-3 flex-wrap">
        <span
          className="text-sm font-semibold"
          style={{ color: drop ? RED : GREEN }}
          data-testid="vendor-orthostatic-verdict"
        >
          {drop ? "Orthostatic drop present (vendor values)" : "No orthostatic drop (vendor values)"}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          baseline {obs.baselineSBP.value}/{obs.baselineDBP.value} → stand {obs.standSBP.value}/
          {obs.standDBP.value} mmHg · Δ {obs.sbpDrop}/{obs.dbpDrop}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground/80 mt-2 leading-relaxed">
        {obs.summary}
      </p>
      <p className="text-[10px] text-amber-300/80 mt-1.5">
        This is a <span className="font-medium">vendor-reported paired-PDF observation</span>, shown
        for clinician context. It is <span className="font-medium">not</span> a deterministic .ans
        scoring input — the .ans recording carries no standing blood pressure, so the HumanOS
        adrenergic/orthostatic domain remains gated as “not assessed” from the .ans alone.
      </p>
    </section>
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
