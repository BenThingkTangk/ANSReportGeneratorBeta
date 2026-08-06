/**
 * shared/physiopsTerminology.ts
 *
 * AUTHORIZED PhysioPS OUTPUT PROTOCOL — terminology enforcement.
 *
 * Dr. Colombo's output rule for HumanOS: patient-facing output is expressed in
 * PhysioPS P&S terminology and must NOT surface generic HRV-specific spectral or
 * time-domain parameters:
 *
 *     ULF, VLF, LF, HF, TSP, sdNN, rmsSD, pNN50
 *
 * Rationale (and the reason this is a code-level gate rather than only a prompt
 * instruction): those parameters are instrument-internal. HumanOS explains a
 * patient's result with the P&S measures the PhysioPS method is actually built
 * on — LFa (sympathetic activity), RFa (parasympathetic activity), sympathovagal
 * balance (LFa/RFa), and the challenge-response findings — so a patient is never
 * handed a number that has no validated patient-level meaning.
 *
 * SCOPE (deliberately asymmetric):
 *   • PATIENT-FACING output (patient narrative, ATOM patient mode, patient
 *     portal copy) — the banned parameters must NOT appear. Enforced here.
 *   • CLINICIAN views — MAY display instrument-derived metrics where they are
 *     required for exact vendor parity. Not filtered; `PATIENT_MODE` only.
 *
 * WHAT THIS MODULE DOES NOT DO
 *   • It does not change any clinical calculation, threshold, score, or the .ans
 *     parser. It never invents a diagnosis, a reference range, or a value. It is
 *     a presentation-layer redaction/relabelling gate only.
 *   • It never deletes a measured value from the clinician record.
 *
 * Pure: no DB, no network, no clock.
 */

/**
 * The authoritative banned list, exactly as specified in the output protocol.
 * Canonical spellings kept verbatim; matching is case-insensitive and tolerant
 * of the common vendor/literature variants (SDNN, RMSSD, pNN-50, LF/HF, …).
 */
export const BANNED_PATIENT_HRV_TERMS = [
  "ULF",
  "VLF",
  "LF",
  "HF",
  "TSP",
  "sdNN",
  "rmsSD",
  "pNN50",
] as const;

export type BannedHrvTerm = (typeof BANNED_PATIENT_HRV_TERMS)[number];

/**
 * PhysioPS P&S vocabulary that IS authorized for patient-facing narrative. Used
 * by tests and by the prompt block so the model is told what to say instead of
 * merely what to avoid.
 */
export const AUTHORIZED_PATIENT_PS_TERMS = [
  "LFa",
  "RFa",
  "sympathetic activity",
  "parasympathetic activity",
  "sympathovagal balance",
  "resting balance",
  "challenge response",
] as const;

/**
 * Ordered detection rules. Order matters: composite forms (LF/HF, LF power) are
 * tested before the bare two-letter tokens so a single occurrence is attributed
 * to the most specific rule.
 *
 * Every pattern is anchored with explicit boundaries so legitimate PhysioPS
 * vocabulary is NEVER matched:
 *   • `LFa` / `RFa` must survive → the LF/HF rules require the token to NOT be
 *     followed by `a`.
 *   • Ordinary English words containing the letters (e.g. "half", "self") must
 *     survive → word boundaries plus a negative lookahead/lookbehind on letters.
 */
interface TermRule {
  term: BannedHrvTerm;
  /** Global, case-insensitive matcher. */
  pattern: RegExp;
  /** Patient-safe replacement in P&S terms (may be a phrase, or "" to drop). */
  replacement: string;
}

const TERM_RULES: TermRule[] = [
  // ── Composite / ratio forms first ──────────────────────────────────────────
  {
    term: "LF",
    pattern: /\bLF(?![a-z])\s*(?:\/|:|\s+to\s+|\s+over\s+|-)\s*HF(?![a-z])(?:\s*(?:ratio|balance))?/gi,
    replacement: "sympathovagal balance (LFa/RFa)",
  },
  {
    term: "TSP",
    pattern: /\b(?:TSP|total\s+spectral\s+power|total\s+power)\b/gi,
    replacement: "overall autonomic activity",
  },
  {
    term: "ULF",
    pattern: /\bULF\b(?:\s*(?:power|band|area))?|\bultra[-\s]?low[-\s]frequency\b(?:\s*(?:power|band|area))?/gi,
    replacement: "very slow autonomic rhythms",
  },
  {
    term: "VLF",
    pattern: /\bVLF\b(?:\s*(?:power|band|area))?|\bvery[-\s]?low[-\s]frequency\b(?:\s*(?:power|band|area))?/gi,
    replacement: "slow autonomic rhythms",
  },
  // ── Time-domain indices ───────────────────────────────────────────────────
  { term: "pNN50", pattern: /\bpNN[-\s]?50\b/gi, replacement: "beat-to-beat variability" },
  { term: "rmsSD", pattern: /\b(?:rms[-\s]?SD|RMSSD)\b/gi, replacement: "parasympathetic activity (RFa)" },
  { term: "sdNN", pattern: /\b(?:sd[-\s]?NN|SDNN)\b/gi, replacement: "overall heart-rhythm variability" },
  // ── Bare band tokens last ─────────────────────────────────────────────────
  {
    term: "HF",
    pattern: /\bHF(?![a-z])(?:\s*(?:power|band|area|component))?|\bhigh[-\s]?frequency\s+(?:power|band|area|component)\b/gi,
    replacement: "parasympathetic activity (RFa)",
  },
  {
    term: "LF",
    pattern: /\bLF(?![a-z])(?:\s*(?:power|band|area|component))?|\blow[-\s]?frequency\s+(?:power|band|area|component)\b/gi,
    replacement: "sympathetic activity (LFa)",
  },
];

/**
 * Units that only make sense for the banned spectral parameters. No trailing
 * `\b` — the superscript `²` is not a word character, so a trailing boundary
 * would fail on the common "1200 ms²" form.
 */
const SPECTRAL_UNIT_RE = /\bms(?:\^2|²|\s*squared\b)|\bmsec(?:\^2|²)/gi;

/** Non-word sentinel used to mask an already-attributed match (see below). */
const MASK = "\u0000";

/**
 * List every banned HRV term present in a candidate patient-facing string.
 * Returns canonical protocol spellings, de-duplicated, in protocol order.
 */
export function findBannedHrvTerms(text: string | null | undefined): BannedHrvTerm[] {
  if (!text) return [];
  const hits = new Set<BannedHrvTerm>();
  // Rules are applied IN ORDER and each match is masked out, exactly as
  // `sanitizePatientTerminology` does. Without masking, "ultra low-frequency
  // band" would be attributed to both ULF (correct) and LF (spurious, because
  // the substring "low-frequency band" also matches the bare LF rule).
  // Masking with a non-word sentinel cannot create a new match.
  let remaining = text;
  for (const rule of TERM_RULES) {
    // Fresh regex per call: /g/ lastIndex must not leak between invocations.
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    if (re.test(remaining)) {
      hits.add(rule.term);
      remaining = remaining.replace(new RegExp(rule.pattern.source, rule.pattern.flags), MASK);
    }
  }
  return BANNED_PATIENT_HRV_TERMS.filter((t) => hits.has(t));
}

/** True when a string is safe to show to a patient under the output protocol. */
export function isPatientSafeTerminology(text: string | null | undefined): boolean {
  // Fresh regex: a shared /g/ literal would carry lastIndex across calls.
  const unitRe = new RegExp(SPECTRAL_UNIT_RE.source, SPECTRAL_UNIT_RE.flags);
  return findBannedHrvTerms(text).length === 0 && !unitRe.test(text ?? "");
}

/**
 * Redact/relabel banned HRV parameters into PhysioPS P&S language.
 *
 * Behaviour is intentionally conservative:
 *   • Replaces the PARAMETER NAME with its P&S equivalent wording.
 *   • Strips a numeric value + spectral unit that was attached to a banned
 *     parameter (e.g. "SDNN 42 ms" → "overall heart-rhythm variability"), because
 *     carrying the number without its name would still expose the parameter.
 *   • Never fabricates a substitute number, range, or interpretation.
 */
export function sanitizePatientTerminology(text: string | null | undefined): string {
  if (!text) return "";
  let out = text;

  for (const rule of TERM_RULES) {
    const re = new RegExp(
      // parameter form, optionally followed by "= 42 ms" / ": 42 ms^2" / " 42 ms"
      `(?:${rule.pattern.source})(?:\\s*(?:=|:|of|was|is)?\\s*-?\\d+(?:\\.\\d+)?\\s*(?:ms\\^?2|ms²|ms|msec|bpm\\^?2|bpm²)?)?`,
      rule.pattern.flags,
    );
    out = out.replace(re, rule.replacement);
  }

  // Any orphaned spectral unit left over is instrument-internal too.
  out = out.replace(SPECTRAL_UNIT_RE, "");

  // Tidy the whitespace/punctuation the substitutions can leave behind, without
  // touching line structure (markdown tables and lists must survive).
  out = out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:!?)])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]+$/gm, "");

  return out;
}

/**
 * Assert-style guard for build/test-time and for report generators: throws when
 * patient-facing copy would leak a banned parameter. Use `sanitize…` at runtime
 * on model output (which we do not control) and this in code paths we DO control.
 */
export function assertPatientSafeTerminology(text: string, context = "patient-facing output"): void {
  const hits = findBannedHrvTerms(text);
  if (hits.length > 0) {
    throw new Error(
      `PhysioPS output protocol violation in ${context}: HRV-specific parameter(s) ` +
        `${hits.join(", ")} must not appear in patient-facing output. Explain the result in ` +
        `P&S terms (LFa, RFa, sympathovagal balance) instead.`,
    );
  }
}

/**
 * Prompt block injected for PATIENT mode. States the rule positively (what to
 * say) as well as negatively (what never to emit); the runtime sanitizer is the
 * backstop, not the only control.
 */
export const PATIENT_TERMINOLOGY_PROMPT = [
  "--------------------------------------------------",
  "AUTHORIZED PhysioPS OUTPUT PROTOCOL — PATIENT VIEW (NON-NEGOTIABLE)",
  "--------------------------------------------------",
  "You are writing for the patient. HumanOS patient output uses PhysioPS P&S terminology only.",
  "",
  "NEVER write, quote, tabulate, abbreviate, or spell out these HRV-specific parameters, and never",
  "report a number attached to one of them:",
  "  ULF, VLF, LF, HF, TSP, sdNN (SDNN), rmsSD (RMSSD), pNN50",
  "That includes their expansions (ultra-low-frequency, very-low-frequency, low-frequency power,",
  "high-frequency power, total spectral power), the LF/HF ratio, and spectral units such as ms^2.",
  "",
  "INSTEAD, explain the patient's result using the PhysioPS P&S measures:",
  "  • LFa — sympathetic (\"fight-or-flight\") activity",
  "  • RFa — parasympathetic (\"rest-and-digest\") activity",
  "  • sympathovagal balance (LFa/RFa) — how the two branches sit relative to each other",
  "  • the challenge responses actually performed (deep breathing, Valsalva, standing) and what",
  "    the patient's own measured values were",
  "This is a TERMINOLOGY and PRESENTATION rule. It does not change any measurement, score,",
  "severity, or assessability decision — report those exactly as the deterministic blocks state,",
  "and never invent a diagnosis, reference range, or treatment recommendation.",
  "--------------------------------------------------",
].join("\n");

/**
 * Prompt block for CLINICIAN mode: instrument-derived metrics are permitted for
 * exact vendor parity, but the patient-facing narrative section still is not.
 */
export const CLINICIAN_TERMINOLOGY_PROMPT = [
  "--------------------------------------------------",
  "OUTPUT PROTOCOL — CLINICIAN VIEW",
  "--------------------------------------------------",
  "Instrument-derived metrics may be shown here when they are needed for exact parity with the",
  "vendor report, and must then be reproduced verbatim from the report — never recomputed,",
  "re-scaled, or estimated. Lead with the PhysioPS P&S measures (LFa, RFa, sympathovagal balance)",
  "and label any instrument-internal HRV parameter as vendor-reported.",
  "Anything you write for the patient to read (a patient summary, hand-out, or patient-mode answer)",
  "must still omit ULF, VLF, LF, HF, TSP, sdNN, rmsSD and pNN50 entirely.",
  "--------------------------------------------------",
].join("\n");
