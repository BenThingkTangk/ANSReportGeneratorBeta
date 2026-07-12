import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  getActiveKnowledgeSources,
  buildKnowledgePromptSection,
  toCitations,
} from "./_knowledgeCache.js";

/**
 * /api/ask-atom — Colombo P&S grounded chat (Path B)
 *
 * Powered by Perplexity Sonar Pro. Builds the system prompt server-side
 * from the patient's report (event-mean table + detected indications).
 *
 * POST body: {
 *   messages: Array<{role:"user"|"assistant", content:string}>,
 *   report?: ANSReport,
 *   viewerRole?: "patient" | "clinician"
 * }
 * Response: { success: true, message, citations }
 */

const SONAR_URL = "https://api.perplexity.ai/chat/completions";

export const SYSTEM_PROMPT = `You are Atom, a Colombo-grounded autonomic-health assistant powered by Perplexity Sonar.
Your reasoning follows the Colombo P&S methodology (Physio PS / ANS Element / DynaCardia Rx) and the published treatment protocol below.

Terminology:
- LFa = Low-Frequency Area (sympathetic activity), measured in bpm²
- RFa = Respiratory-Frequency Area (parasympathetic activity), measured in bpm²
- LFa/RFa = sympathovagal balance ratio (SB)
- FRF = Fundamental Respiratory Frequency

Language rules (strictly enforced):
- Never use "diagnose" or "diagnosis" — this tool is not a diagnostic device.
- Never say "the patient has [condition]" — frame findings as "consistent with" or "evidence of."
- Replace "treat with X" with "consider treating with X."
- Never use "NaCl" — use "salt" or "sodium" instead.
- Never use "unitless" — use "ratio" instead.
- Qualify with softening language ("may suggest," "consistent with," "consider").

Data assessability & provenance rules (HIGHEST PRIORITY — these override every other instruction here, the treatment protocol above, and any legacy finding below):
- LFa, RFa, HRV, SB (LFa/RFa), and HR come from a pipeline that ZERO-FILLS missing beat-to-beat data. Any such value that is missing, blank, zero, non-positive, or shown as "Not assessed" is NOT a measurement — it means the metric was never captured.
- Always describe those values, and any domain listed under "Domains NOT assessed", as "Not assessed" (you may add "— insufficient data"). NEVER describe them as absent, zero, none, flat, suppressed, low, undetectable, severe, critical, abnormal, or normal.
- Never assign a severity, phenotype, or threshold classification (e.g., CAN, AAN / Advanced Autonomic Neuropathy, OD, POTS, VVS) to a Not assessed value or a Not assessed domain. A zero or missing LFa/RFa/HRV must NEVER be read as crossing a "low", "< 0.1", or "< 0.5" severity threshold.
- Do not compute, quote, or infer ratios (e.g., SB = LFa/RFa), trends, or standing-vs-resting changes from Not assessed values.
- The "DATA ASSESSABILITY & PROVENANCE" block is authoritative. When it conflicts with the Event Mean Data table, "Detected Colombo Indications", "Overall Clinical Impression", or any other legacy finding, follow the assessability block and treat the conflicting legacy item as unconfirmed / Not assessed. Privilege missingDomains, blocked claims, and provenance over legacy findings every time.
- Blocked claims (listed as blocked for insufficient data) are explicitly NOT findings. Report each as "not assessed because required inputs were missing" — never as present or absent.
- If the metrics needed to answer a question are Not assessed, say so plainly and recommend an adequate repeat recording instead of interpreting placeholder values.

When analyzing a patient's ANS state, structure your response in three sections (only on the first message or when the user asks for an interpretation; skip for follow-up clarifications):
1. **What is happening** — describe the current ANS state (e.g., parasympathetic excess, sympathetic withdrawal, mixed dysfunction).
2. **Why it matters** — clinical significance, symptoms, risks.
3. **What to do** — pharmaceutical and lifestyle recommendations following the protocol below.

Use these as the primary treatment reference:

1. Treating Parasympathetic Excess (PE)
PE is characterized by an "over-protective" nervous system, analogous to driving with the brakes on.
Pharmaceutical option (default): low-dose anticholinergic Nortriptyline 10 mg, once daily, 12 hours before desired wake time.
- If patient is underweight: 10 mg Amitriptyline (may cause more weight gain).
- If Nortriptyline/Amitriptyline are not tolerated or pose a job risk: 20 mg Duloxetine.
Lifestyle option: Low-and-Slow Exercise.
- Up to 40 minutes daily at ~2 mph walking pace.
- Start supine and progress to recumbent bike/walking; stop if "bulling through."
Secondary: Aqua Therapy (reduced joint stress, temperature regulation).

2. Treating Sympathetic Withdrawal (SW) / Orthostatic Dysfunction
SW causes poor blood flow when upright; the 'O' in POTS; associated with Restless Legs.
Pharmaceutical: Midodrine starting 1.25 mg, titrate to 2.5 mg TID over 11+ weeks.
- Functions: directly stimulates sympathetic nerves to improve vasoconstriction.
- Caution: itchy scalp/goosebumps indicate it's working; do not lie flat within 2 hours of dose.
Supplement-based alternative:
- r-Alpha-Lipoic Acid (ALA): 600 mg TID — antioxidant, nerve healing.
- Hydration with electrolytes: 64–96 oz water daily + ~1/3 tsp salt every 2 hours (or potassium from bananas if BP high).
- Compression: 20–30 mmHg lower-extremity garments.

3. Co-Occurring Conditions and Symptoms
Tachycardia (pre-POTS/POTS): CoQ10 200 mg QD; consider Propranolol 10 mg up to TID temporarily, weaning as Midodrine corrects underlying issue.
Small Fiber Disorder (SFD): Methylfolate 7.5 mg QD, titrate up to 15 mg.
Mast Cell Activation Syndrome (MCAS): Zyrtec 10 mg + Pepcid 20 mg QD (doses may double).
Pain (severe): Low-Dose Naltrexone (LDN) 2 mg QD, titrate to 8 mg. Alternative: Turmeric/Curcumin or Omega-3.
Persistent GI / IBS-D: Bentyl 20 mg QD (anticholinergic specific to GI).
Endothelial Dysfunction: Beet Root Extract 500–1000 mg QD (nitric oxide booster).
Hydration support: if Fludrocortisone lowered potassium, consider Desmopressin.
Depression/Anxiety: usually improves with P&S therapy via better brain blood flow; do not interfere with existing psychiatric meds; supplement with B-Complex.

4. Orthostatic Dysfunction (OD) / POTS
OD = LFa decreases rest → standing.
Risk by SB: 0.4–3.0 normal; outside = high.
POTS = OD + standing HR rise > 30 bpm or > 120 bpm. Primary: Midodrine. CoQ10 200 mg/day for tachycardia.

5. Vasovagal Syncope (VVS)
Standing LFa > 5× resting LFa AND standing RFa > resting RFa.
Treat underlying PE and SW components. Avoid triggers (prolonged standing, dehydration, heat). Salt/fluid load.

6. Advanced Autonomic Neuropathy (AAN)
Resting LFa 0.1–0.5 bpm² OR resting RFa < 0.5 bpm² (LFa < 0.1 → CAN severity instead).
r-Alpha-Lipoic Acid 600 mg TID, B-Complex, aggressive co-occurring management.

7. Long-Term Foundational Support
Connective tissue: collagen/gelatin/bone broth (1 cup/day) for "leaks."
Immune: Vitamin D 5000 IU/day (overactive immune from leaky connective tissue).

ALA contraindication: If baseline SBP < 95 mmHg, ALA is contraindicated due to vasodilatory risk.

Output formatting:
- Format responses in Markdown.
- Reference the patient's specific values when abnormal.
- Never fully regurgitate the data table.
- 2–4 short paragraphs unless the user asks for detail.
- End with a tiny attribution: "— powered by Perplexity Sonar"`;

/** Literal used everywhere a metric could not be measured. */
export const NOT_ASSESSED = "Not assessed";

/**
 * Spectral/derived ANS metrics (LFa, RFa, SB, HRV) and HR/BP are only real when
 * finite and strictly positive. The deterministic pipeline ZERO-FILLS missing
 * beat-to-beat data (LFa/RFa/HRV = 0), so 0 / null / NaN mean "not assessed",
 * never a true measurement. Returns the number only when it is a genuine reading.
 */
export function assessedNum(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

interface PhaseRow {
  phase: string; meanHR?: number; LFa?: number; RFa?: number; SB?: number;
  HRV_RMSSD?: number; HRV_SDNN?: number; SBP?: number; DBP?: number;
}

export function buildEventMeanTable(phaseEvents: PhaseRow[] | undefined): string {
  if (!phaseEvents || phaseEvents.length === 0) {
    return `(no per-phase data — treat every spectral metric as ${NOT_ASSESSED})`;
  }
  const cell = (v: number | null | undefined, digits: number): string => {
    const a = assessedNum(v);
    return a === null ? NOT_ASSESSED : a.toFixed(digits);
  };
  const rows = [
    "Event | LFa | RFa | SB | HRV(RMSSD) | mHR | BP",
    "--- | --- | --- | --- | --- | --- | ---",
  ];
  for (const p of phaseEvents) {
    const sbp = assessedNum(p.SBP);
    const dbp = assessedNum(p.DBP);
    const bp = sbp !== null && dbp !== null ? `${sbp}/${dbp}` : NOT_ASSESSED;
    rows.push(
      `${p.phase} | ${cell(p.LFa, 2)} | ${cell(p.RFa, 2)} | ${cell(p.SB, 2)} | ${cell(p.HRV_RMSSD, 1)} | ${cell(p.meanHR, 0)} | ${bp}`,
    );
  }
  return rows.join("\n");
}

const SEVERITY_LABEL: Record<string, string> = {
  normal: "normal",
  mild: "mild",
  moderate: "moderate",
  severe: "severe",
  not_assessed: NOT_ASSESSED,
};

/** One authoritative line per domain: severity (or Not assessed) + provenance. */
export function domainLine(label: string, s: any): string {
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
  // Surface an assessable-but-limited domain (e.g. adrenergic scored from cuff
  // deltas without beat-to-beat BP) so the model never presents it as a full
  // grade or claims definitive adrenergic failure.
  const limit = s.screenOnly
    ? ` [SCREEN ONLY — ${s.methodLimitation ?? "partial assessment; do not report as a definitive grade"}]`
    : "";
  return `- ${label}: ${sev}${conf}${prov}${limit}`;
}

/**
 * Authoritative, provenance-aware summary derived from the deterministic
 * DiagnosticSummary. This is privileged over the legacy indications / overall
 * impression so the model never reinterprets zero-filled or blocked metrics as
 * real (or severe) findings.
 */
export function buildAssessabilitySection(report: any): string {
  const ds = report?.diagnosticSummary;
  if (!ds) {
    return `--------------------------------------------------
DATA ASSESSABILITY & PROVENANCE (AUTHORITATIVE)
--------------------------------------------------
No deterministic assessability summary is available for this upload.
Treat every LFa/RFa/HRV/SB value that is missing, zero, or shown as "${NOT_ASSESSED}" in the table above as ${NOT_ASSESSED}. Do not infer severity, phenotype, or thresholds (CAN/AAN/OD/POTS/VVS) from placeholder zeros.`;
  }

  const assessed = (ds.domainsAssessed ?? []).join(", ") || "none";
  const missing: string[] = ds.missingDomains ?? [];
  const missingStr = missing.length
    ? missing.map((d) => `${d} (${NOT_ASSESSED})`).join(", ")
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
DATA ASSESSABILITY & PROVENANCE (AUTHORITATIVE — this OVERRIDES the legacy findings below)
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

export function buildPatientContext(report: any, viewerRole: string): string {
  if (!report) return "(no report attached)";
  const pd = report.patientData || {};
  const name = `${pd.firstName ?? ""} ${pd.lastName ?? ""}`.trim() || "Unknown";
  const age = pd.age ?? "?";
  const sex = pd.gender ?? "?";
  const bmi = pd.bmi ?? "?";
  const physician = pd.physician ?? "?";
  const meds = (pd.medications ?? []).join(", ") || "None reported";
  const symptoms = (pd.symptoms ?? []).join(", ") || "None reported";

  const indList = (report.indications ?? []).length > 0
    ? report.indications.map((i: any) => `- **${i.name}** (${i.severity}): ${i.description}`).join("\n")
    : "None detected by automated rules.";

  const meanTable = buildEventMeanTable(report.phaseEvents);
  const assessability = buildAssessabilitySection(report);
  const overall = report.overallImpression || "(none)";
  const contraindList = (report.contraindications ?? []).join("; ") || "None flagged.";

  return `--------------------------------------------------
PATIENT CONTEXT (${viewerRole} view)
--------------------------------------------------
Patient: ${name} | Age: ${age} | Sex: ${sex} | BMI: ${bmi}
Physician: ${physician}
Medications: ${meds}
Reported Symptoms: ${symptoms}

Event Mean Data (a cell reading "${NOT_ASSESSED}", or any 0 / blank spectral value, means the metric was NOT captured — never treat it as a real measurement):
${meanTable}

${assessability}

--------------------------------------------------
LEGACY FINDINGS (SECONDARY — defer to the assessability block above whenever they disagree; never use these to assert anything about a ${NOT_ASSESSED} domain or value)
--------------------------------------------------
Detected Colombo Indications:
${indList}

Contraindications: ${contraindList}

Overall Clinical Impression: ${overall}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "POST only" });

  try {
    const apiKey = process.env.PPLX_API_KEY;
    if (!apiKey) return res.status(500).json({ success: false, error: "PPLX_API_KEY not configured" });

    const body: any = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    let messages = Array.isArray(body?.messages) ? body.messages : [];
    const viewerRole = body?.viewerRole === "clinician" ? "clinician" : "patient";
    const report = body?.report;

    // Back-compat: accept {question, context} shape
    if (messages.length === 0 && typeof body?.question === "string" && body.question.trim()) {
      messages = [{ role: "user", content: body.question.trim() }];
    }

    messages = messages
      .filter((m: any) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
      .slice(-20);

    if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
      return res.status(400).json({
        success: false,
        error: "messages must be a non-empty array ending with a user message",
      });
    }

    // Inject active knowledge sources into system prompt
    const knowledgeSources = await getActiveKnowledgeSources();
    const knowledgeSection = buildKnowledgePromptSection(knowledgeSources);
    const knowledgeCitations = toCitations(knowledgeSources);

    const systemContent = [
      SYSTEM_PROMPT,
      knowledgeSection,
      buildPatientContext(report, viewerRole),
    ]
      .filter(Boolean)
      .join("\n\n");
    const conversation = [{ role: "system", content: systemContent }, ...messages];

    const r = await fetch(SONAR_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: conversation,
        temperature: 0.3,
        max_tokens: 1200,
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(500).json({ success: false, error: `Sonar error ${r.status}: ${text.slice(0, 300)}` });
    }
    const j = (await r.json()) as any;
    const message = j?.choices?.[0]?.message?.content?.trim() || "";
    // Perplexity web citations renamed to webCitations to disambiguate from internal knowledge citations
    const webCitations = j?.citations || j?.search_results?.map((s: any) => s?.url).filter(Boolean) || [];

    return res.status(200).json({
      success: true,
      message,
      webCitations,
      citations: knowledgeCitations,
    });
  } catch (err: any) {
    console.error("Ask Atom error:", err);
    return res.status(500).json({ success: false, error: err?.message || "Failed to query Atom" });
  }
}
