import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  getActiveKnowledgeSources,
  buildKnowledgePromptSection,
  toCitations,
} from "./_knowledgeCache.js";
import {
  buildDeterministicSynopsis,
  hasAutonomicBalance,
} from "../shared/deterministicSynopsis.js";

/**
 * /api/synopsis
 *
 * Generates two Colombo-grounded plain-English synopses (patient + clinician)
 * from an ANSReport payload, powered by Perplexity Sonar.
 *
 * The AI text is OPTIONAL enrichment layered over the deterministic synopsis
 * (shared/deterministicSynopsis.ts, left unchanged). The same zero-fill /
 * missing-domain / blocked-claim provenance guardrail used by /api/ask-atom is
 * applied here so the model is (a) GROUNDED on an authoritative assessability
 * block that overrides the legacy digest, and (b) POST-VALIDATED: any AI
 * synopsis that would overwrite the safe deterministic text with an unsupported
 * severe or "normal" claim about a Not-assessed / zero-filled / blocked part of
 * the study is dropped in favour of the deterministic fallback. Missing data is
 * never rendered as normal, and a zero-filled metric is never escalated to a
 * severe phenotype the deterministic scorer did not assert.
 *
 * POST body: { report: ANSReport }
 * Response:  { success: true, patientSynopsis, clinicianSynopsis, citations, source }
 */

const SONAR_URL = "https://api.perplexity.ai/chat/completions";

async function sonar(system: string, user: string): Promise<string> {
  const apiKey = process.env.PPLX_API_KEY;
  if (!apiKey) throw new Error("PPLX_API_KEY not configured");

  const r = await fetch(SONAR_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.3,
      max_tokens: 700,
    }),
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Sonar error ${r.status}: ${t.slice(0, 300)}`);
  }
  const j = (await r.json()) as any;
  return j?.choices?.[0]?.message?.content?.trim() || "";
}

// ---------------------------------------------------------------------------
// Zero-fill / missing-domain / blocked-claim provenance guardrail
// (mirrors api/ask-atom.ts so both AI surfaces enforce the same rules)
// ---------------------------------------------------------------------------

/** Literal used everywhere a metric could not be measured. */
const NOT_ASSESSED = "Not assessed";

/**
 * Spectral/derived ANS metrics (LFa, RFa, SB, HRV) and HR are only real when
 * finite and strictly positive. The deterministic pipeline ZERO-FILLS missing
 * beat-to-beat data (LFa/RFa/HRV = 0), so 0 / null / NaN mean "not assessed",
 * never a true measurement. Returns the number only when it is a genuine reading.
 */
function assessedNum(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** assessedNum → fixed-precision string, else the Not-assessed literal. */
function fmtAssessed(v: number | null | undefined, digits: number): string {
  const a = assessedNum(v);
  return a === null ? NOT_ASSESSED : a.toFixed(digits);
}

const SEVERITY_LABEL: Record<string, string> = {
  normal: "normal",
  mild: "mild",
  moderate: "moderate",
  severe: "severe",
  not_assessed: NOT_ASSESSED,
};

/** One authoritative line per domain: severity (or Not assessed) + provenance. */
function domainLine(label: string, s: any): string {
  if (!s) return `- ${label}: ${NOT_ASSESSED} — no deterministic score produced.`;
  const assessed = s.assessable !== false && s.severity !== "not_assessed";
  if (!assessed) {
    const reason = s.notAssessedReason ? ` — ${s.notAssessedReason}` : " — required inputs missing.";
    return `- ${label}: ${NOT_ASSESSED}${reason}`;
  }
  const sev = SEVERITY_LABEL[s.severity] ?? String(s.severity);
  const conf = s.confidence ? `; confidence ${s.confidence}` : "";
  const prov = Array.isArray(s.sourceFields) && s.sourceFields.length
    ? `; provenance: ${s.sourceFields.join(", ")}`
    : "; provenance: unspecified";
  return `- ${label}: ${sev}${conf}${prov}`;
}

/**
 * Authoritative, provenance-aware summary derived from the deterministic
 * DiagnosticSummary. This is privileged over the legacy risk level / overall
 * impression so the model never reinterprets zero-filled or blocked metrics as
 * real (or severe) findings, and never reads a missing domain as normal.
 */
function buildAssessabilitySection(report: any): string {
  const ds = report?.diagnosticSummary;
  if (!ds) {
    return `--------------------------------------------------
DATA ASSESSABILITY & PROVENANCE (AUTHORITATIVE)
--------------------------------------------------
No deterministic assessability summary is available for this upload.
Treat every LFa/RFa/HRV/SB value that is missing, zero, or shown as "${NOT_ASSESSED}" in the digest above as ${NOT_ASSESSED}. Do not infer severity, phenotype, or thresholds (CAN/AAN/OD/POTS/VVS) from placeholder zeros, and do not describe a ${NOT_ASSESSED} study as normal, healthy, or reassuring.`;
  }

  const assessed = (ds.domainsAssessed ?? []).join(", ") || "none";
  const missing: string[] = ds.missingDomains ?? [];
  const missingStr = missing.length
    ? missing.map((d: string) => `${d} (${NOT_ASSESSED})`).join(", ")
    : "none";
  const confPct = typeof ds.reportConfidenceScore === "number"
    ? ` (${Math.round(ds.reportConfidenceScore * 100)}%)`
    : "";

  const findings = (ds.abnormalFindings ?? []).length
    ? ds.abnormalFindings
        .map((f: any) => {
          const prov = Array.isArray(f.sourceFields) && f.sourceFields.length
            ? `, provenance: ${f.sourceFields.join(", ")}`
            : "";
          return `- ${f.message} [${f.domain}/${f.severity}, confidence ${f.confidence}${prov}]`;
        })
        .join("\n")
    : "- None from assessed domains.";

  const phenos = (ds.phenotypeFlags ?? []).filter((p: any) => p?.present);
  const phenoStr = phenos.length
    ? phenos.map((p: any) => `- ${p.label} (${p.confidence})`).join("\n")
    : "- None asserted by the deterministic scorer.";

  const blocked = ds.unsafeOrUnsupportedClaimsBlocked ?? [];
  const blockedStr = blocked.length
    ? blocked
        .map((b: any) => {
          const fields = Array.isArray(b.missingFields) && b.missingFields.length
            ? b.missingFields.join(", ")
            : "required inputs";
          const why = b.explanation ? ` ${b.explanation}` : "";
          return `- ${b.claim}: ${NOT_ASSESSED} — missing ${fields}.${why}`.trimEnd();
        })
        .join("\n")
    : "- None.";

  return `--------------------------------------------------
DATA ASSESSABILITY & PROVENANCE (AUTHORITATIVE — this OVERRIDES the legacy digest above)
--------------------------------------------------
Report confidence: ${ds.reportConfidence ?? "Unknown"}${confPct}
Total autonomic severity: ${ds.totalAutonomicSeverityScore}/${ds.maxPossibleScore} (sum of ASSESSED domains only)
Domains assessed: ${assessed}
Domains NOT assessed (report these strictly as ${NOT_ASSESSED}): ${missingStr}

Deterministic domain scores (severity + provenance):
${domainLine("Cardiovagal", ds.cardiovagalScore)}
${domainLine("Adrenergic", ds.adrenergicScore)}
${domainLine("Sudomotor", ds.sudomotorScore)}

Deterministic abnormal findings (assessed domains only):
${findings}

Patterns consistent with (suggestions, never diagnoses):
${phenoStr}

Claims BLOCKED for insufficient data — report each as "${NOT_ASSESSED}", never as present or absent:
${blockedStr}`;
}

function summarizeReportForPrompt(report: any): string {
  const pd = report.patientData || {};
  const A = report.phaseEvents?.[0] || {};
  const F = report.phaseEvents?.[5] || {};
  const patterns = Object.entries(report.dysfunctionPatterns || {})
    .filter(([, v]) => v === true)
    .map(([k]) => k)
    .join(", ") || "none";
  const ratios = report.ratios || {};
  const ther = (report.therapyRecommendations || [])
    .map((t: any) => `${t.priority}: ${t.intervention}`)
    .join("; ");
  const contra = (report.contraindications || []).join("; ") || "none";

  // BP is only real when both limbs are genuine readings; a zero-filled cell
  // (assessedNum === null) is surfaced as Not assessed rather than "?/? mmHg".
  const bp = (p: any) => {
    const sbp = assessedNum(p.SBP);
    const dbp = assessedNum(p.DBP);
    return sbp !== null && dbp !== null ? `${sbp}/${dbp} mmHg` : NOT_ASSESSED;
  };

  return [
    `Patient: ${pd.firstName ?? "?"} ${pd.lastName ?? "?"}, age ${pd.age}, ${pd.gender}`,
    `Physician: ${pd.physician}`,
    // Wellness score intentionally omitted from clinician synopsis per Dr. Colombo —
    // clinical view focuses on phase metrics and Colombo-defined patterns.
    `Risk level (legacy — defer to the assessability block below): ${report.riskLevel}`,
    // Spectral/derived metrics are rendered through assessedNum so a pipeline
    // zero (missing beat-to-beat data) reads as "Not assessed", never as 0.
    `Baseline HR ${fmtAssessed(A.meanHR, 0)} bpm, BP ${bp(A)}, LFa ${fmtAssessed(A.LFa, 2)}, RFa ${fmtAssessed(A.RFa, 2)}, SB ${fmtAssessed(A.SB, 2)}`,
    `Stand HR ${fmtAssessed(F.meanHR, 0)} bpm, BP ${bp(F)}, LFa ${fmtAssessed(F.LFa, 2)}, RFa ${fmtAssessed(F.RFa, 2)}, SB ${fmtAssessed(F.SB, 2)}`,
    `Ewing ratios: E/I ${fmtAssessed(ratios?.eiRatio?.value, 2)}, Valsalva ${fmtAssessed(ratios?.valsalvaRatio?.value, 2)}, 30:15 ${fmtAssessed(ratios?.thirtyFifteenRatio?.value, 2)}`,
    `Dysfunction patterns: ${patterns}`,
    `Overall (legacy): ${report.overallImpression}`,
    `Therapies considered: ${ther}`,
    `Contraindications: ${contra}`,
    `Clinical flags: ${(report.clinicalFlags || []).join("; ")}`,
    "",
    buildAssessabilitySection(report),
  ].join("\n");
}

const SYSTEM_PATIENT = `You are Atom, an empathetic autonomic-health coach trained on the Colombo P&S methodology (Physio PS, DynaCardia). You translate complex autonomic nervous system reports into warm, clear language a grandmother would understand. You NEVER give medical advice — you explain findings and tell the patient to discuss them with their physician. Keep it to 4-6 short paragraphs. Avoid jargon; when you must use a term (like "parasympathetic"), explain it in one plain sentence.`;

const SYSTEM_CLINICIAN = `You are Atom, a clinical summarization assistant for the Colombo P&S autonomic methodology. Write for a physician reviewing an ANS Element / Physio PS report. Be precise, cite the specific phase metrics (Baseline-A, DB-B, Valsalva-D, Stand-F), and articulate the Colombo dysfunction pattern(s) detected (PE, PW, SE, SW, AAD, CAN, POTS, orthostatic, vasovagal, pre-syncope). Mention contraindications (e.g. ALA gated by SBP < 95 mmHg). End with a 2-3 item next-step recommendation block. Keep the total length 250-400 words. No markdown headings — just paragraph text.`;

/**
 * Highest-priority assessability rules appended to BOTH synopsis prompts. These
 * are the prompt-level half of the guardrail; the post-hoc validator below is
 * the hard guarantee that a violation can never overwrite the deterministic text.
 */
const ASSESSABILITY_RULES = `Data assessability & provenance rules (HIGHEST PRIORITY — these override the report digest and every other instruction here):
- LFa, RFa, HRV, SB (LFa/RFa) and HR come from a pipeline that ZERO-FILLS missing beat-to-beat data. Any such value that is missing, blank, zero, non-positive, or shown as "${NOT_ASSESSED}" is NOT a measurement — the metric was never captured.
- Describe those values, and any domain listed under "Domains NOT assessed", strictly as "${NOT_ASSESSED}" (you may add "— insufficient data"). NEVER call them absent, zero, none, flat, low, undetectable, severe, critical, abnormal, or normal. Never call the overall study normal, healthy, reassuring, or unremarkable on the strength of missing data — missing data is not a normal result.
- Never assign a severity, phenotype, or threshold classification (CAN, AAN, OD, POTS, VVS, neuropathy) to a ${NOT_ASSESSED} value or domain. A zero or missing LFa/RFa/HRV must NEVER be read as crossing a "low", "< 0.1", or "< 0.5" severity threshold.
- Do not compute or infer ratios (e.g. SB = LFa/RFa), trends, or standing-vs-resting changes from ${NOT_ASSESSED} values.
- The "DATA ASSESSABILITY & PROVENANCE" block is authoritative. When it conflicts with the risk level, overall impression, or any other legacy digest line, follow the assessability block and treat the conflicting legacy item as unconfirmed / ${NOT_ASSESSED}.
- Blocked claims (listed as blocked for insufficient data) are explicitly NOT findings. Report each as "not assessed because required inputs were missing" — never as present or absent.`;

// ---------------------------------------------------------------------------
// Post-hoc provenance validation of the optional AI enrichment
// ---------------------------------------------------------------------------

interface ProvenanceGuard {
  /** Something in the study was NOT assessed → an overall "normal" claim is unsupported. */
  normalcyBlocked: boolean;
  /** Severe territory was never established deterministically → escalation is unsupported. */
  severityBlocked: boolean;
}

/**
 * Reads ONLY the deterministic layer (diagnosticSummary + autonomicBalance) to
 * decide which claims the AI enrichment is allowed to make. If beat-to-beat
 * data was missing (balance zero-filled), a domain is missing, or a claim was
 * blocked, the study is not fully assessable — so "normal" is off-limits, and
 * "severe" is off-limits unless the scorer itself asserted a severe finding.
 */
function buildProvenanceGuard(report: any): ProvenanceGuard {
  const ds = report?.diagnosticSummary;
  const balanceMissing = !hasAutonomicBalance(report);
  const missingDomains: string[] = ds?.missingDomains ?? [];
  const blocked: unknown[] = ds?.unsafeOrUnsupportedClaimsBlocked ?? [];
  const unassessed =
    balanceMissing || missingDomains.length > 0 || blocked.length > 0;

  const dp = report?.dysfunctionPatterns ?? {};
  const domainSevere = ds
    ? [ds.cardiovagalScore, ds.adrenergicScore, ds.sudomotorScore].some(
        (s: any) => s?.assessable !== false && s?.severity === "severe",
      ) || (ds.abnormalFindings ?? []).some((f: any) => f?.severity === "severe")
    : false;
  const deterministicSevere =
    domainSevere || dp.CAN === true || dp.advancedAutonomicDysfunction === true;

  return {
    normalcyBlocked: unassessed,
    severityBlocked: unassessed && !deterministicSevere,
  };
}

const NORMALCY_RE =
  /\b(normal|unremarkable|reassuring|healthy|no (?:significant )?abnormalit(?:y|ies)|within normal limits|all clear|everything (?:looks|is) (?:fine|normal|good|healthy))\b/i;
const SEVERE_RE =
  /\b(severe|critical|life-threatening|autonomic neuropathy|neuropathy)\b/i;

/**
 * True when the AI text would overwrite the safe deterministic synopsis with a
 * claim the provenance/assessability layer does NOT support: calling a study
 * with unassessed data "normal", or escalating a zero-filled / blocked metric
 * to a severe phenotype the deterministic scorer never asserted. Empty text is
 * treated as a violation so it can never replace the deterministic fallback.
 */
function violatesProvenance(text: string, guard: ProvenanceGuard): boolean {
  if (!text) return true;
  if (guard.normalcyBlocked && NORMALCY_RE.test(text)) return true;
  if (guard.severityBlocked && SEVERE_RE.test(text)) return true;
  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "POST only" });

  try {
    const body: any = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const report = body?.report;
    if (!report) return res.status(400).json({ success: false, error: "Missing report" });

    const digest = summarizeReportForPrompt(report);

    // Safe baseline: deterministic synopsis (offline, provenance-aware). The AI
    // may only UPGRADE this prose — never overwrite it with an unsupported claim.
    const deterministic = buildDeterministicSynopsis(report);
    const guard = buildProvenanceGuard(report);

    // Fetch active knowledge sources for grounding (60-second cache)
    const knowledgeSources = await getActiveKnowledgeSources();
    const knowledgeSection = buildKnowledgePromptSection(knowledgeSources);
    const citations = toCitations(knowledgeSources);

    const patientSystem = [SYSTEM_PATIENT, ASSESSABILITY_RULES, knowledgeSection]
      .filter(Boolean)
      .join("\n\n");
    const clinicianSystem = [SYSTEM_CLINICIAN, ASSESSABILITY_RULES, knowledgeSection]
      .filter(Boolean)
      .join("\n\n");

    // Optional AI enrichment. Any failure (missing key, Sonar error, timeout)
    // falls through to the deterministic fallback so this endpoint always
    // returns safe, provenance-consistent text instead of a 500.
    let aiPatient = "";
    let aiClinician = "";
    try {
      [aiPatient, aiClinician] = await Promise.all([
        sonar(
          patientSystem,
          `Please write a warm, plain-English summary of this autonomic report for the patient. Explain what it means for their day-to-day life (energy, sleep, dizziness, stress) and what they should talk to their doctor about.\n\nReport:\n${digest}`,
        ),
        sonar(
          clinicianSystem,
          `Write the clinician synopsis for this report using Colombo methodology terminology. Be specific about phase metrics, patterns, and therapy gating.\n\nReport:\n${digest}`,
        ),
      ]);
    } catch (aiErr) {
      console.warn(
        "Synopsis AI enrichment unavailable; using deterministic fallback:",
        aiErr,
      );
    }

    // Hard guarantee: reject any enrichment that makes an unsupported
    // severe/normal claim about unassessed data, keeping the deterministic text.
    const patientOk = !violatesProvenance(aiPatient, guard);
    const clinicianOk = !violatesProvenance(aiClinician, guard);

    return res.status(200).json({
      success: true,
      patientSynopsis: patientOk ? aiPatient : deterministic.patient,
      clinicianSynopsis: clinicianOk ? aiClinician : deterministic.clinician,
      citations,
      source: {
        patient: patientOk ? "ai" : "deterministic",
        clinician: clinicianOk ? "ai" : "deterministic",
      },
    });
  } catch (err: any) {
    console.error("Synopsis error:", err);
    return res.status(500).json({
      success: false,
      error: err?.message || "Failed to generate synopsis",
    });
  }
}
