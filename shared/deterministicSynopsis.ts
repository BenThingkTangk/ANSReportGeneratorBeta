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

export interface DeterministicSynopsis {
  patient: string;
  clinician: string;
  /** Stable marker so the UI can label the source of the text. */
  source: "deterministic";
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

export function buildPatientSynopsis(report: Partial<ANSReport>): string {
  const name = firstName(report);
  const tier = report.wellnessTier;
  const ab = report.autonomicBalance;
  const baseline =
    findPhase(report, "Baseline-A") ?? findPhase(report, "Baseline-C");
  const stand = findPhase(report, "Stand-F");
  const patterns = activePatterns(report).patient;
  const balanceAssessed = hasAutonomicBalance(report);

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
    const rawPara = ab!.parasympathetic;
    const rawSymp = ab!.sympathetic;
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
    sentences.push(
      `${name}, this test did not capture enough heart-rhythm signal to measure your sympathetic/parasympathetic balance, so that part of your result is shown as "Not assessed — insufficient data" rather than a score.`,
    );
  }

  // 2. What was seen (patterns). Only claim a clean, "reassuring" screen when the
  // balance was actually assessed — absence of data is not absence of a pattern.
  if (patterns.length > 0) {
    sentences.push(
      `The test picked up ${humanList(patterns)}. These are patterns in how your body regulates itself — not a diagnosis on their own.`,
    );
  } else if (balanceAssessed) {
    sentences.push(
      "The test did not flag any of the specific autonomic patterns it screens for, which is reassuring.",
    );
  }

  // 3. Everyday meaning — tie to symptoms people feel.
  const meaning: string[] = [];
  if (report.dysfunctionPatterns?.parasympatheticExcess)
    meaning.push("low energy or a foggy, sluggish feeling");
  if (
    report.dysfunctionPatterns?.sympatheticWithdrawal ||
    report.dysfunctionPatterns?.orthostaticHypotension ||
    report.dysfunctionPatterns?.POTS
  )
    meaning.push("dizziness or a racing heart when you stand up");
  if (report.dysfunctionPatterns?.sympatheticExcess)
    meaning.push("feeling wired, tense, or having trouble winding down at night");
  if (meaning.length > 0) {
    sentences.push(
      `In day-to-day life this can show up as ${humanList(meaning)}. If that sounds familiar, it is worth mentioning to your doctor.`,
    );
  }

  // 4. Standing response numbers (only if present).
  if (baseline && stand && num(baseline.meanHR) !== null && num(stand.meanHR) !== null) {
    const rise = Math.round(stand.meanHR - baseline.meanHR);
    if (rise >= 5) {
      sentences.push(
        `When you stood up, your heart rate rose by about ${rise} beats per minute — your body's way of keeping blood flowing to your brain.`,
      );
    }
  }

  // 5. Next step — always defer to clinician.
  sentences.push(
    "This summary explains what your data shows; it is not medical advice. Please review it with your physician, who can put it in the context of your full health picture.",
  );

  return sentences.join(" ");
}

// ---------------------------------------------------------------------------
// Clinician synopsis (precise, phase metrics + Colombo patterns)
// ---------------------------------------------------------------------------

export function buildClinicianSynopsis(report: Partial<ANSReport>): string {
  const baseline =
    findPhase(report, "Baseline-A") ?? findPhase(report, "Baseline-C");
  const stand = findPhase(report, "Stand-F");
  const patterns = activePatterns(report).clinician;
  const balanceAssessed = hasAutonomicBalance(report);
  const parts: string[] = [];

  // 0. Data-sufficiency gate. When the upload lacked usable beat-to-beat data the
  // pipeline emits LFa/RFa/HRV = 0; surface that explicitly so zeroed spectral
  // metrics are never read as real findings.
  if (!balanceAssessed) {
    parts.push(
      "Autonomic balance not assessed — recording lacked sufficient beat-to-beat data (LFa/RFa/HRV unavailable); spectral metrics reported as insufficient data.",
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
      pos(baseline.LFa) !== null ? `LFa ${fmt(baseline.LFa, 2)}` : null,
      pos(baseline.RFa) !== null ? `RFa ${fmt(baseline.RFa, 2)}` : null,
      pos(baseline.SB) !== null ? `SB ${fmt(baseline.SB, 2)}` : null,
    ].filter(Boolean);
    if (bits.length > 0)
      parts.push(`Resting baseline: ${bits.join(", ")}.`);
  }

  // 2. Orthostatic (Stand-F) response.
  if (stand) {
    const bits: string[] = [];
    if (baseline && pos(baseline.meanHR) !== null && pos(stand.meanHR) !== null) {
      const d = Math.round(stand.meanHR - baseline.meanHR);
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
    if (pos(stand.SB) !== null) bits.push(`stand SB ${fmt(stand.SB, 2)}`);
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
  if (report.followUp?.retestInterval)
    nextSteps.push(`re-test in ${report.followUp.retestInterval}`);
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

  parts.push(
    "This is clinical decision support, not a diagnosis. Confirm with clinical correlation.",
  );

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
