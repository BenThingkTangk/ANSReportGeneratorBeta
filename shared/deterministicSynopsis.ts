/**
 * shared/deterministicSynopsis.ts
 *
 * Deterministic, offline synopsis builder. Given an already-computed ANSReport
 * (produced by the deterministic scoring/parsing pipeline), this module returns
 * plain-English patient + clinician summaries WITHOUT any network call or AI.
 *
 * Why this exists (v3 "immediate synopsis" UX):
 *   The AI synopsis (api/synopsis.ts, Perplexity Sonar) is warm but slow and can
 *   be unavailable. This module lets the UI render a correct, safe summary the
 *   instant a report is available, then optionally swap in the AI-enhanced prose
 *   when it arrives. The clinical content is identical either way because both
 *   read the same deterministic numbers.
 *
 * Safety:
 *   - NEVER uses the word "diagnosis"/"diagnose"; frames findings as patterns.
 *   - NEVER fabricates values — only speaks to fields that are present.
 *   - No runtime dependencies; safe to import from client (@shared) and tests.
 *
 * This module does NOT touch deterministic scoring — it only reads its output.
 */

import type { ANSReport, PhaseMetrics } from "./schema";
import type { VendorNarrativeFinding } from "./vendorExtraction";

export interface DeterministicSynopsis {
  patient: string;
  clinician: string;
  /** Stable marker so the UI can label the source of the text. */
  source: "deterministic";
}

/**
 * Vendor-reported findings threaded into the synopsis as a SEPARATE evidence
 * class. These are the vendor's own categorical statements (from the signed
 * report / letter) — they are NOT converted into deterministic engine
 * measurements or scores; they are quoted as vendor-reported.
 */
export interface VendorFindingsInput {
  findings: VendorNarrativeFinding[];
  printedNumbers?: Array<{ key: string; value: number }>;
}

const HUMAN_FINDING: Record<string, { patient: string; clinician: string }> = {
  "baseline.hr_change": { patient: "", clinician: "" },
  "db.hr_change": {
    patient: "an abnormal change in heart rate from baseline to deep breathing",
    clinician: "Abnormal baseline→DB HR change",
  },
  "stand.sympathetic": {
    patient: "a high sympathetic (fight-or-flight) response when standing",
    clinician: "High sympathetic response to stand",
  },
  "stand.presyncope": {
    patient: "a possible risk of pre-syncope (light-headedness on standing)",
    clinician: "Possible pre-syncope risk",
  },
  "baseline.rfa": {
    patient: "a borderline-low resting parasympathetic (rest-and-digest) tone",
    clinician: "Borderline-low resting parasympathetic modulation (RFa)",
  },
  "baseline.sb": {
    patient: "a high-normal sympathovagal balance at rest",
    clinician: "High-normal resting sympathovagal balance (SB)",
  },
};

/** The vendor findings that are clinically notable (not "normal"/"present-ok"). */
function notableVendorFindings(v: VendorFindingsInput | undefined): VendorNarrativeFinding[] {
  if (!v?.findings?.length) return [];
  return v.findings.filter(
    (f) => f.classification === "abnormal" || f.classification === "high" || f.classification === "low" || (f.key === "stand.presyncope"),
  );
}

/** Patient-facing plain-English sentence for the vendor-reported findings. */
export function vendorFindingsPatientSentence(v: VendorFindingsInput | undefined): string | null {
  const notable = notableVendorFindings(v);
  if (notable.length === 0) return null;
  const phrases = notable
    .map((f) => HUMAN_FINDING[f.key]?.patient)
    .filter((s): s is string => !!s);
  if (phrases.length === 0) return null;
  return (
    `Your attached vendor report (reviewed by the clinic) flagged ${humanList(phrases)}. ` +
    "These are document-level findings from the signed vendor report. They may corroborate measurements stored in the .ans or supplement fields absent from it, and should be reviewed with your clinician."
  );
}

/** Clinician-facing verbatim vendor-reported findings block, with provenance. */
export function vendorFindingsClinicianBlock(v: VendorFindingsInput | undefined): string | null {
  if (!v?.findings?.length && !v?.printedNumbers?.length) return null;
  const lines: string[] = ["Vendor-reported findings (from the signed vendor report/letter — vendor-reported, NOT deterministic engine measurements):"];
  for (const f of v?.findings ?? []) {
    const label = HUMAN_FINDING[f.key]?.clinician ?? f.label;
    lines.push(`- ${label}: ${f.classification}${f.sourceFile ? ` [${f.sourceFile}]` : ""}`);
  }
  for (const n of v?.printedNumbers ?? []) {
    lines.push(`- ${n.key} = ${n.value} (vendor-printed)`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Small helpers (defensive: reports may be partial in tests / edge cases)
// ---------------------------------------------------------------------------

function num(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function fmt(n: number | null, digits = 1): string {
  if (n === null) return "—";
  const s = n.toFixed(digits);
  return digits > 0 ? s.replace(/\.0+$/, "") : s;
}

/**
 * A strictly-positive finite reading, else null. The deterministic pipeline
 * emits 0 for LFa/RFa/HRV (and derived SB) when a recording lacks usable
 * beat-to-beat data, so a zero here means "no signal captured" — not a real
 * value — and must not be quoted as a measurement.
 */
function pos(n: unknown): number | null {
  const v = num(n);
  return v !== null && v > 0 ? v : null;
}

function findPhase(
  report: Partial<ANSReport>,
  phase: PhaseMetrics["phase"],
): PhaseMetrics | undefined {
  const events = Array.isArray(report.phaseEvents) ? report.phaseEvents : [];
  return events.find((e) => e?.phase === phase);
}

/**
 * The three Ewing cardiovagal ratios, read verbatim from the deterministic
 * report. These are ECG/time-domain measures — always computed from the raw
 * recording — so they are MEASURED results, independent of whether the
 * vendor's proprietary spectral aggregates (LFa/RFa/SB) were present in the
 * .ans export. Returns only ratios that carry a real positive value.
 */
export interface EwingRatioReading {
  key: "eiRatio" | "valsalvaRatio" | "thirtyFifteenRatio";
  /** Short scientific label, e.g. "E/I ratio". */
  label: string;
  /** One-line plain-language meaning. */
  plain: string;
  value: number;
  normal: string;
  classification: string; // e.g. "Normal"
  severity: "Abnormal" | "Warning" | "Normal";
}

export function ewingRatioReadings(
  report: Partial<ANSReport>,
): EwingRatioReading[] {
  const r = report.ratios;
  if (!r) return [];
  const defs: Array<{
    key: EwingRatioReading["key"];
    label: string;
    plain: string;
    obj:
      | { value: number | null; normal: string; classification: { label: string; severity: string } | null }
      | undefined;
  }> = [
    {
      key: "eiRatio",
      label: "E/I ratio",
      plain:
        "how much your heart rate speeds up and slows down with deep breathing — a direct readout of your calming (vagal) nerve.",
      obj: r.eiRatio,
    },
    {
      key: "valsalvaRatio",
      label: "Valsalva ratio",
      plain:
        "how your heart rate recovers after a strain-and-release (bearing-down) maneuver — another check of the same vagal reflex.",
      obj: r.valsalvaRatio,
    },
    {
      key: "thirtyFifteenRatio",
      label: "30:15 ratio",
      plain:
        "the heart-rate rhythm change in the first seconds of standing — your reflex response to a change in posture.",
      obj: r.thirtyFifteenRatio,
    },
  ];
  const out: EwingRatioReading[] = [];
  for (const d of defs) {
    const v = pos(d.obj?.value);
    if (v === null || !d.obj) continue;
    out.push({
      key: d.key,
      label: d.label,
      plain: d.plain,
      value: v,
      normal: d.obj.normal,
      classification: d.obj.classification?.label ?? "",
      severity: (d.obj.classification?.severity as EwingRatioReading["severity"]) ?? "Normal",
    });
  }
  return out;
}

/**
 * Whether the vendor's proprietary spectral branch-balance aggregates
 * (LFa/RFa and their sympathovagal-balance ratio SB) are available. They live
 * either as exact values stored in supported PhysioPS .ans files or as
 * identity-matched values from a signed vendor report.
 */
export function hasVendorSpectral(report: Partial<ANSReport>): boolean {
  // Explicit flag wins when present; otherwise fall back to the balance check.
  if (typeof report.spectralAvailable === "boolean") return report.spectralAvailable;
  return hasAutonomicBalance(report);
}

function firstName(report: Partial<ANSReport>): string {
  return report.patientData?.firstName?.trim() || "This patient";
}

/** Human list: ["a","b","c"] → "a, b and c". */
function humanList(items: string[]): string {
  const clean = items.filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
}

/**
 * Turn the boolean dysfunctionPatterns map into human phrases.
 * Returns two views: patient-friendly and clinician-precise.
 */
function activePatterns(report: Partial<ANSReport>): {
  patient: string[];
  clinician: string[];
} {
  const p = report.dysfunctionPatterns;
  const patient: string[] = [];
  const clinician: string[] = [];
  if (!p) return { patient, clinician };

  const push = (patientPhrase: string, clinicianPhrase: string) => {
    patient.push(patientPhrase);
    clinician.push(clinicianPhrase);
  };

  if (p.parasympatheticExcess)
    push("an over-active rest-and-digest response", "parasympathetic excess (PE)");
  if (p.parasympatheticWithdrawal)
    push("a reduced rest-and-digest reserve", "parasympathetic withdrawal (PW)");
  if (p.sympatheticExcess)
    push("a heightened fight-or-flight response", "sympathetic excess (SE)");
  if (p.sympatheticWithdrawal || p.maskedSW)
    push("a weakened fight-or-flight response on standing", "sympathetic withdrawal (SW)");
  if (p.POTS)
    push("a large heart-rate rise when standing", "a pattern consistent with POTS");
  if (p.orthostaticHypotension)
    push("a blood-pressure drop when standing", "a pattern consistent with orthostatic hypotension");
  if (p.vasovagalRisk)
    push("a tendency toward fainting spells", "vasovagal-susceptible reflex pattern");
  if (p.CAN)
    push("signs of advanced nerve involvement", "a pattern consistent with cardiovascular autonomic neuropathy (CAN)");
  if (p.advancedAutonomicDysfunction)
    push("broad autonomic strain", "advanced autonomic dysfunction (AAD)");
  if (p.bradycardia) push("a slow resting heart rate", "resting bradycardia");

  return { patient, clinician };
}

/**
 * Whether the report carries a usable sympathetic/parasympathetic balance.
 *
 * When an .ans upload lacks enough beat-to-beat data, the deterministic
 * pipeline emits LFa/RFa/HRV = 0, so autonomicBalance.sympathetic +
 * .parasympathetic collapses to 0. In that case the balance is NOT assessed
 * and callers must surface "Not assessed / insufficient data" instead of a
 * fabricated 0% split or a "Balanced"/"Critical" tier.
 *
 * This reads scoring output only — it never alters a score.
 */
export function hasAutonomicBalance(report: Partial<ANSReport>): boolean {
  const ab = report.autonomicBalance;
  const symp = num(ab?.sympathetic);
  const para = num(ab?.parasympathetic);
  return symp !== null && para !== null && symp + para > 0;
}

// ---------------------------------------------------------------------------
// Patient synopsis (warm, plain English)
// ---------------------------------------------------------------------------

export function buildPatientSynopsis(report: Partial<ANSReport>, vendor?: VendorFindingsInput): string {
  const name = firstName(report);
  const tier = report.wellnessTier;
  const ab = report.autonomicBalance;
  const baseline =
    findPhase(report, "Baseline-A") ?? findPhase(report, "Baseline-C");
  const stand = findPhase(report, "Stand-F");
  const patterns = activePatterns(report).patient;
  const balanceAssessed = hasAutonomicBalance(report);
  const vendorNotable = notableVendorFindings(vendor);
  const compositeScorable =
    report.wellnessScore != null &&
    report.wellnessBreakdown?.scorability?.scorable !== false;
  const ecgUsable = report.ecgQuality?.usable !== false;
  const patternStates = Object.values(report.dysfunctionPatterns ?? {});
  const patternScreenComplete =
    patternStates.length > 0 && patternStates.every((value) => value === false);

  const sentences: string[] = [];

  // 1. Headline — balance + tier. Only when the recording actually carried a
  // sympathetic/parasympathetic signal. If LFa/RFa/HRV were missing the pipeline
  // reports a 0/0 split (and a score-derived tier such as "Balanced"/"Critical");
  // quoting either would be fabricated, so we say plainly that it was not assessed.
  if (balanceAssessed) {
    // autonomicBalance.parasympathetic/.sympathetic carry RAW spectral power
    // (RFa / LFa in bpm²), NOT percentages. Presenting the rounded raw values as
    // "%" produced the garbled "about 5% vs 1%" copy (S2-4). Normalize to a
    // share-of-total the same way the hero Venn does so both agree.
    // Guaranteed non-null here (hasAutonomicBalance gate above), but coalesce
    // for the type-checker — null spectral must never reach this branch.
    const rawPara = ab!.parasympathetic ?? 0;
    const rawSymp = ab!.sympathetic ?? 0;
    const total = rawPara + rawSymp || 1;
    const para = Math.round((rawPara / total) * 100);
    const symp = Math.max(0, Math.min(100, 100 - para));
    const lead =
      para > symp + 10
        ? "your calming, rest-and-digest system is currently the louder voice"
        : symp > para + 10
          ? "your alerting, fight-or-flight system is currently the louder voice"
          : "your two nervous-system branches are working in fairly even balance";
    sentences.push(
      `${name}, your autonomic test shows that ${lead} (about ${para}% rest-and-digest versus ${symp}% fight-or-flight)${
        tier ? `, which places your overall balance in the "${tier}" range` : ""
      }.`,
    );
  } else {
    const vendorAttached = vendor !== undefined;
    sentences.push(
      ecgUsable
        ? vendorAttached
          ? `${name}, this upload contains measured ECG results and cardiovagal (Ewing) reflex ratios, shown below. The attached vendor report was processed, but readable LFa/RFa spectral values were not recovered, so sympathetic-vs-parasympathetic branch balance remains "Not assessed." Your clinician can verify those values against the signed report.`
          : `${name}, this upload contains measured ECG results and cardiovagal reflex ratios, shown below. This specific file did not provide clinically usable LFa/RFa/SB spectral branch-balance values, so that domain remains "Not assessed." Some PhysioPS .ans files store those values directly; a matched vendor report can supplement them when absent.`
        : `${name}, an overall wellness score is not available because the ECG signal-quality check did not pass and this recording did not provide all required usable inputs. Measurements that remain traceable to the file are shown below as observations; absent spectral or other domains remain "Not assessed" and no value is guessed.`,
    );
  }

  // 1b. Measured cardiovagal (Ewing) ratios — these are always computed from the
  // raw ECG, so they are real measured results even when the vendor spectral
  // branch-balance is unavailable. Surface them plainly with their status.
  const ewing = ewingRatioReadings(report);
  if (ewing.length > 0) {
    const allNormal = ewing.every((e) => e.severity === "Normal");
    const parts = ewing.map((e) => `${e.label} ${fmt(e.value, 2)} (${e.classification.toLowerCase()}; ref ${e.normal})`);
    sentences.push(
      `Measured cardiovagal reflexes: ${humanList(parts)}.${
        allNormal && ecgUsable
          ? " All three are within the normal range — your heart's calming (vagal) reflexes are responding as expected."
          : allNormal
            ? " The file's ratio values fall within their listed reference ranges, but the ECG signal-quality check did not pass, so they must not be used to imply a normal overall autonomic result."
            : ""
      }`,
    );
  }

  // 2. What was seen (patterns). Only claim a clean, "reassuring" screen when the
  // balance was actually assessed — absence of data is not absence of a pattern.
  if (patterns.length > 0) {
    sentences.push(
      `The test picked up ${humanList(patterns)} — patterns in how your body regulates itself.`,
    );
  } else if (
    compositeScorable &&
    ecgUsable &&
    patternScreenComplete &&
    vendorNotable.length === 0
  ) {
    // A negative screen is only safe when the composite was scorable, ECG
    // quality passed, and every pattern state was explicitly assessed false.
    // Unknown/null states must never be summarized as "nothing flagged."
    sentences.push(
      "None of the specific autonomic dysfunction patterns this device's own signals screen for were flagged in the measured signals.",
    );
  }

  // Vendor-reported findings (separate evidence class). Never converted to
  // engine scores — quoted as vendor-reported so the summary can't contradict an
  // attached signed report.
  const vendorSentence = vendorFindingsPatientSentence(vendor);
  if (vendorSentence) sentences.push(vendorSentence);

  // 3. What to do with the findings — WITHOUT asserting symptoms the test did
  // not capture. Prior versions stated specific daily-life symptoms ("low
  // energy", "foggy, sluggish feeling", "dizziness…") tied to a pattern; those
  // are unsupported unless the patient actually reported them, so we no longer
  // assert them. Instead we invite the patient to share their own symptoms.
  const flaggedAny =
    !!report.dysfunctionPatterns &&
    Object.values(report.dysfunctionPatterns).some((v) => v === true);
  if (flaggedAny) {
    sentences.push(
      "These are measurement patterns, not a diagnosis, and this test did not record how you feel day to day. If you have symptoms, share them with your clinician so the findings can be interpreted in your context.",
    );
  }

  // 4. Standing response numbers (only if present).
  if (baseline && stand && num(baseline.meanHR) !== null && num(stand.meanHR) !== null) {
    const rise = Math.round((stand.meanHR as number) - (baseline.meanHR as number));
    if (rise >= 5) {
      sentences.push(
        `When you stood up, your heart rate rose by about ${rise} beats per minute — your body's way of keeping blood flowing to your brain.`,
      );
    }
  }

  // 5. Next step — concise, single close (no repeated disclaimer wall).
  sentences.push(
    "Review these results with your physician to set your next steps.",
  );

  return sentences.join(" ");
}

// ---------------------------------------------------------------------------
// Clinician synopsis (precise, phase metrics + Colombo patterns)
// ---------------------------------------------------------------------------

export function buildClinicianSynopsis(report: Partial<ANSReport>, vendor?: VendorFindingsInput): string {
  const baseline =
    findPhase(report, "Baseline-A") ?? findPhase(report, "Baseline-C");
  const stand = findPhase(report, "Stand-F");
  const patterns = activePatterns(report).clinician;
  const balanceAssessed = hasAutonomicBalance(report);
  const spectralEstimated =
    report.spectralSource === "humanos_estimated" &&
    (report.phaseEvents ?? []).some(
      (phase) =>
        phase.provenance?.LFa?.method === "computed" &&
        phase.provenance?.LFa?.validation === "estimated" &&
        [phase.LFa, phase.RFa, phase.SB, phase.FRF].some(
          (value) => typeof value === "number" && Number.isFinite(value),
        ),
    );
  const parts: string[] = [];

  // 0. Data-sufficiency gate. When the upload lacked usable beat-to-beat data the
  // pipeline emits LFa/RFa/HRV = 0; surface that explicitly so zeroed spectral
  // metrics are never read as real findings.
  if (!balanceAssessed) {
    const vendorAttached = vendor !== undefined;
    parts.push(
      vendorAttached
        ? "Sympathovagal branch-balance not assessed — the attached vendor report was processed, but readable LFa/RFa/SB values were not recovered. Verify against the signed vendor report. ECG/time-domain metrics and Ewing ratios below are measured."
        : spectralEstimated
          ? "Vendor-equivalent sympathovagal branch balance is not assessed. HumanOS waveform estimates of LFa, RFa and SB are displayed for visual trend review, explicitly labeled as estimates, and are not PhysioPS-validated or interpreted against Colombo norms. ECG/time-domain metrics and Ewing ratios below are measured."
          : "Vendor-equivalent sympathovagal branch balance is not assessed because no usable vendor spectral values were supplied. ECG/time-domain metrics and Ewing ratios below are measured.",
    );
  }

  // 1. Baseline autonomic state. Spectral/derived values (LFa/RFa/SB) and HR are
  // only quoted when strictly positive; a pipeline zero means "no signal".
  if (baseline) {
    const bits = [
      pos(baseline.meanHR) !== null ? `HR ${fmt(baseline.meanHR, 0)} bpm` : null,
      num(baseline.SBP) !== null && num(baseline.DBP) !== null
        ? `BP ${fmt(num(baseline.SBP), 0)}/${fmt(num(baseline.DBP), 0)} mmHg`
        : null,
      pos(baseline.LFa) !== null
        ? `LFa ${fmt(baseline.LFa, 2)}${spectralEstimated ? " (HumanOS est.)" : ""}`
        : null,
      pos(baseline.RFa) !== null
        ? `RFa ${fmt(baseline.RFa, 2)}${spectralEstimated ? " (HumanOS est.)" : ""}`
        : null,
      pos(baseline.SB) !== null
        ? `SB ${fmt(baseline.SB, 2)}${spectralEstimated ? " (HumanOS est.)" : ""}`
        : null,
    ].filter(Boolean);
    if (bits.length > 0)
      parts.push(`Resting baseline: ${bits.join(", ")}.`);
  }

  // 2. Orthostatic (Stand-F) response.
  if (stand) {
    const bits: string[] = [];
    if (baseline && pos(baseline.meanHR) !== null && pos(stand.meanHR) !== null) {
      const d = Math.round((stand.meanHR as number) - (baseline.meanHR as number));
      bits.push(`ΔHR ${d >= 0 ? "+" : ""}${d} bpm on standing`);
    }
    if (
      baseline &&
      num(baseline.SBP) !== null &&
      num(stand.SBP) !== null
    ) {
      const d = Math.round(stand.SBP! - baseline.SBP!);
      bits.push(`ΔSBP ${d >= 0 ? "+" : ""}${d} mmHg`);
    }
    if (pos(stand.SB) !== null) {
      bits.push(`stand SB ${fmt(stand.SB, 2)}${spectralEstimated ? " (HumanOS est.)" : ""}`);
    }
    if (bits.length > 0) parts.push(`Orthostatic (Stand-F): ${bits.join(", ")}.`);
  }

  // 3. Ewing ratios.
  const r = report.ratios;
  if (r) {
    const rbits = [
      pos(r.eiRatio?.value) !== null ? `E/I ${fmt(r.eiRatio!.value, 2)}` : null,
      pos(r.valsalvaRatio?.value) !== null
        ? `Valsalva ${fmt(r.valsalvaRatio!.value, 2)}`
        : null,
      pos(r.thirtyFifteenRatio?.value) !== null
        ? `30:15 ${fmt(r.thirtyFifteenRatio!.value, 2)}`
        : null,
    ].filter(Boolean);
    if (rbits.length > 0) parts.push(`Time-domain ratios: ${rbits.join(", ")}.`);
  }

  // 4. Detected Colombo patterns. Only assert a clean screen when the autonomic
  // signal was actually assessed — missing data is not a negative result.
  if (patterns.length > 0) {
    parts.push(`Detected patterns: ${humanList(patterns)}.`);
  } else if (balanceAssessed) {
    parts.push("No Colombo dysfunction pattern met detection criteria.");
  }

  // 5. Contraindications / gating.
  const contra = Array.isArray(report.contraindications)
    ? report.contraindications.filter(Boolean)
    : [];
  if (contra.length > 0) {
    parts.push(`Contraindications flagged: ${humanList(contra)}.`);
  }

  // 6. Overall impression (already deterministic, echo if present).
  if (report.overallImpression) {
    parts.push(report.overallImpression.trim());
  }

  // 7. Next steps.
  const nextSteps: string[] = [];
  if (report.followUp?.retestInterval) {
    nextSteps.push(
      report.followUp.retestInterval.toLowerCase() === "clinician-directed"
        ? "discuss retest timing with the treating clinician"
        : `re-test in ${report.followUp.retestInterval}`,
    );
  }
  if (Array.isArray(report.therapyRecommendations)) {
    const primary = report.therapyRecommendations.find(
      (t) => t?.priority === "primary",
    );
    if (primary?.intervention)
      nextSteps.push(`consider ${primary.intervention.toLowerCase()}`);
  }
  if (nextSteps.length > 0) {
    parts.push(`Suggested next steps: ${humanList(nextSteps)}.`);
  }

  // Vendor-reported findings — a distinct evidence class appended verbatim with
  // provenance. Never merged into the deterministic measured/hypothesis text so
  // the two tiers stay separable, but present so the clinician summary can never
  // read "nothing flagged" when the attached signed report has findings.
  const vendorBlock = vendorFindingsClinicianBlock(vendor);
  if (vendorBlock) parts.push(vendorBlock);

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Combined entry point
// ---------------------------------------------------------------------------

export function buildDeterministicSynopsis(
  report: Partial<ANSReport>,
): DeterministicSynopsis {
  return {
    patient: buildPatientSynopsis(report),
    clinician: buildClinicianSynopsis(report),
    source: "deterministic",
  };
}
