import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  getActiveKnowledgeSources,
  getKnowledgeCorpusStatus,
  buildKnowledgePromptSection,
  toCitations,
} from "./_knowledgeCache.js";
import { rankKnowledgeSources } from "./_knowledgeRetrieval.js";

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

/**
 * Bounded in-memory response cache. Repeated identical questions about the
 * same report (same viewer role + conversation prefix) return instantly
 * without re-billing/re-latency of a Sonar call. Keyed on a hash of the full
 * grounded request so a different report or a different conversation never
 * collides. TTL-bounded and LRU-evicted; process-local (safe for serverless —
 * a cold start simply starts empty).
 *
 * PHI note: keys are non-reversible FNV-1a hashes and values are the model's
 * already-de-identified answer text; no raw report is stored.
 */
const CACHE_TTL_MS = 10 * 60_000; // 10 minutes
const CACHE_MAX = 200;
type CachedAnswer = { message: string; webCitations: any[]; expires: number };
const answerCache = new Map<string, CachedAnswer>();

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

/**
 * Remove literature citation markers from patient-facing prose. Strips inline
 * bracket refs like "[1]", "[2, 3]", "[1-15]" and a trailing "Sources:"/
 * "References:" list. Patient answers are grounded in the patient's own report,
 * not external literature, so these must never appear.
 */
export function stripCitationMarkers(text: string): string {
  return text
    // inline [1], [2,3], [1-15], [1][2]
    .replace(/\s?\[\d+(?:\s*[-,]\s*\d+)*\]/g, "")
    // a trailing Sources/References/Citations block to end of string
    .replace(/\n+\s*(?:sources|references|citations)\s*:[\s\S]*$/i, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function cacheGet(key: string): CachedAnswer | null {
  const hit = answerCache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    answerCache.delete(key);
    return null;
  }
  // Refresh recency for LRU.
  answerCache.delete(key);
  answerCache.set(key, hit);
  return hit;
}

function cacheSet(key: string, value: Omit<CachedAnswer, "expires">): void {
  if (answerCache.size >= CACHE_MAX) {
    const oldest = answerCache.keys().next().value;
    if (oldest !== undefined) answerCache.delete(oldest);
  }
  answerCache.set(key, { ...value, expires: Date.now() + CACHE_TTL_MS });
}

/**
 * Stream a Sonar completion to the client as Server-Sent Events.
 *
 * Events:
 *   event: delta   data: {"text": "<token chunk>"}
 *   event: done    data: {"message": "<full text>", "webCitations": [...], "citations": [...]}
 *   event: error   data: {"error": "<message>"}
 *
 * The full answer is assembled server-side and written to the response cache on
 * completion, so a subsequent non-streaming request replays instantly. The
 * deterministic grounding/gating is unchanged — only the transport differs.
 */
async function streamSonar(opts: {
  apiKey: string;
  conversation: Array<{ role: string; content: string }>;
  knowledgeCitations: unknown[];
  grounding?: unknown;
  patientMode?: boolean;
  cacheKey: string;
  res: VercelResponse;
}): Promise<void> {
  const { apiKey, conversation, knowledgeCitations, grounding, patientMode, cacheKey, res } = opts;
  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Call upstream FIRST, before committing SSE headers/200. If it fails at the
  // start, we can still return an honest non-200 JSON error (the reviewer's
  // point: an upstream failure must not masquerade as a 200 SSE success).
  let r: Response;
  try {
    r = await fetch(SONAR_URL, {
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
        stream: true,
      }),
    });
  } catch (err: any) {
    res.status(502).json({ success: false, error: err?.message || "Upstream request failed" });
    return;
  }

  if (!r.ok || !r.body) {
    const text = r.ok ? "no response body" : await r.text();
    // Headers not yet committed → surface a real error status, not a 200 stream.
    res.status(502).json({
      success: false,
      error: `Sonar error ${r.status}: ${text.slice(0, 300)}`,
    });
    return;
  }

  // Upstream is good: NOW commit the SSE response (implicitly 200) and stream.
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  try {
    let full = "";
    let emitted = ""; // for patient mode: how much sanitized text we've sent
    let webCitations: unknown[] = [];
    let buffer = "";
    const decoder = new TextDecoder();
    // Node 20 fetch bodies are async-iterable.
    for await (const chunk of r.body as any) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true });
      // SSE frames from Perplexity are separated by double newlines.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          const delta = j?.choices?.[0]?.delta?.content ?? "";
          if (delta) {
            full += delta;
            if (patientMode) {
              // Emit only the sanitized suffix so bracket citations never reach
              // the patient client, even mid-stream. (A trailing '[' is held
              // back until the next chunk resolves whether it's a citation.)
              const safeFull = stripCitationMarkers(full);
              const pendingBracket = /\[[\d\s,–-]*$/.test(safeFull);
              const upTo = pendingBracket ? safeFull.replace(/\[[\d\s,–-]*$/, "") : safeFull;
              if (upTo.length > emitted.length) {
                send("delta", { text: upTo.slice(emitted.length) });
                emitted = upTo;
              }
            } else {
              send("delta", { text: delta });
            }
          }
          const cites = j?.citations || j?.search_results?.map((s: any) => s?.url).filter(Boolean);
          if (Array.isArray(cites) && cites.length) webCitations = cites;
        } catch {
          /* ignore non-JSON keep-alive frames */
        }
      }
    }

    const rawMessage = full.trim();
    // Patient mode: strip citation markers + suppress the web-citation list.
    const message = patientMode ? stripCitationMarkers(rawMessage) : rawMessage;
    const outWebCitations = patientMode ? [] : webCitations;
    if (message) cacheSet(cacheKey, { message, webCitations: outWebCitations });
    // Mid-stream truncation with no content is an explicit error event, not a
    // silent empty success — the client must distinguish this from a real answer.
    if (!message) {
      send("error", { error: "Upstream stream ended before any content was received." });
      res.end();
      return;
    }
    // In patient mode emit any remaining sanitized tail so the final rendered
    // text equals `message` even if the client concatenated deltas.
    if (patientMode && message.length > emitted.length) {
      send("delta", { text: message.slice(emitted.length) });
    }
    send("done", { message, webCitations: outWebCitations, citations: knowledgeCitations, grounding });
    res.end();
    return;
  } catch (err: any) {
    // Headers already sent → we cannot change the status now; emit an explicit
    // error event (never a done event) so the client treats it as a failure.
    send("error", { error: err?.message || "stream failed mid-response" });
    res.end();
    return;
  }
}

export const SYSTEM_PROMPT = `You are Atom, a Colombo-grounded autonomic-health assistant powered by Perplexity Sonar.
Your reasoning follows the Colombo P&S methodology (Physio PS / ANS Element / DynaCardia Rx) and the published treatment protocol below.

Terminology:
- LFa = Low-Frequency Area (sympathetic activity), measured in bpm²
- RFa = Respiratory-Frequency Area (parasympathetic activity), measured in bpm²
- LFa/RFa = sympathovagal balance ratio (SB)
- FRF = Fundamental Respiratory Frequency

Language rules (clinical framing — qualify substance, never dilute it):
- This is clinical decision support, not a diagnostic device: prefer "consistent with" / "evidence of" over "diagnosed with", and "consider [therapy]" over "start [therapy]".
- Frame findings as "consistent with" or "evidence of" a condition rather than "the patient has [condition]".
- Use the standard clinical and scientific vocabulary of the Colombo methodology (e.g. sympathovagal balance, LFa/RFa in bpm², sodium/salt loading, Ewing ratios). Do not strip precise terminology to sound softer — a qualified finding stated precisely is safer and more useful than a vague one.

Data assessability & provenance rules (HIGHEST PRIORITY — these override every other instruction here, the treatment protocol above, and any legacy finding below):
- LFa, RFa, HRV, SB (LFa/RFa), and HR come from a pipeline that ZERO-FILLS missing beat-to-beat data. Any such value that is missing, blank, zero, non-positive, or shown as "Not assessed" is NOT a measurement — it means the metric was never captured.
- Always describe those values, and any domain listed under "Domains NOT assessed", as "Not assessed" (you may add "— insufficient data"). NEVER describe them as absent, zero, none, flat, suppressed, low, undetectable, severe, critical, abnormal, or normal.
- Never assign a severity, phenotype, or threshold classification (e.g., CAN, AAN / Advanced Autonomic Neuropathy, OD, POTS, VVS) to a Not assessed value or a Not assessed domain. A zero or missing LFa/RFa/HRV must NEVER be read as crossing a "low", "< 0.1", or "< 0.5" severity threshold.
- Do not compute, quote, or infer ratios (e.g., SB = LFa/RFa), trends, or standing-vs-resting changes from Not assessed values.
- The "DATA ASSESSABILITY & PROVENANCE" block is authoritative. When it conflicts with the Event Mean Data table, "Detected Colombo Indications", "Overall Clinical Impression", or any other legacy finding, follow the assessability block and treat the conflicting legacy item as unconfirmed / Not assessed. Privilege missingDomains, blocked claims, and provenance over legacy findings every time.
- Blocked claims (listed as blocked for insufficient data) are explicitly NOT findings. Report each as "not assessed because required inputs were missing" — never as present or absent.
- If the metrics needed to answer a question are Not assessed, say so plainly and recommend an adequate repeat recording instead of interpreting placeholder values.

Evidence-grounding rules (HIGHEST PRIORITY — apply whenever a "KNOWLEDGE LIBRARY STATUS — METADATA ONLY" block is present):
- The private knowledge corpus then has ZERO retrieved full-text passages. You must NOT cite the reference titles with bracketed numbers, and you must NOT state any quantitative diagnostic performance (sensitivity, specificity, PPV/NPV, AUC), prognosis, near-term risk/"lower risk", morbidity/mortality figures, or treatment-efficacy claims as if sourced from that corpus.
- Ground answers in (a) the PATIENT REPORT facts below, and (b) clearly-labeled general physiology stated as such. Any external claim MUST be labeled "External (web)" and carry a real, resolvable URL; if you cannot provide a URL, do not make the claim.
- Prefer "I can't cite specific studies here because the knowledge base has no indexed full-text; based on your report …" over an unsupported cited statistic. Being explicit about the limitation is required, not optional.

Audience mode (the PATIENT CONTEXT block states the viewer role — "clinician view" or "patient view"). Mode tone is STRICTLY isolated — never let clinician phrasing leak into a patient answer:

- PATIENT VIEW (address the patient directly as "you"/"your", by the first name in the context):
  • LEAD with THIS patient's actual measured values from the PATIENT CONTEXT (e.g. "Your E/I ratio was 1.22"), then explain in plain language what that means for them. Do NOT open with generic textbook thresholds or a definition.
  • Speak to the patient, never about them: use "you"/"your". NEVER write "the patient", "your patient's", "this patient", "map your patient's ratios", or any phrasing addressed to a clinician.
  • Do NOT diagnose OR exclude conditions. Never say a result "argues against"/"rules out"/"is consistent with" cardiovascular autonomic neuropathy (CAN/AAN), POTS, or any named disease. Say what was measured and that interpretation is for their clinician.
  • Do NOT give prognosis, risk levels, sensitivity/specificity, or survival/morbidity statements.
  • Plain terms only: "rest-and-digest" (parasympathetic), "fight-or-flight" (sympathetic), "calming reflex" (cardiovagal). You may still name a ratio and its number, but explain it.
  • State the limitations plainly: the sympathetic/parasympathetic spectral split (LFa/RFa/SB) and blood pressure were NOT captured in this recording, so you cannot speak to them.
  • Do NOT include bracketed reference markers ([1], [2], …) or a citations/sources list. Patient answers are grounded in the patient's own report, not literature.

- CLINICIAN VIEW: be scientifically deep. Use the full Colombo methodology — specific phase responses, LFa/RFa/SB values and bpm² units, Ewing battery ratios and thresholds, phenotype classifications (PE, SE, SW, OD, POTS, VVS, AAN, CAN) with defining criteria, and the graded treatment protocol with doses/titration WHEN the underlying metrics are assessed. Additionally you MUST clearly separate three grounding tiers:
  • MEASURED (report): facts from this patient's report/PATIENT CONTEXT — label them as measured.
  • EXTERNAL (web): any general-literature claim must be labeled "External (web)" and carry a real, resolvable URL; without a URL, do not make the claim.
  • PRIVATE CORPUS: state that the private knowledge base has no indexed full-text chunks, so nothing here is RAG-grounded.

- In BOTH modes the assessability/provenance rules below are absolute: only speak to what was actually measured.

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
  const firstName = (pd.firstName ?? "").trim() || name;

  // Explicit measured Ewing (cardiovagal) ratios — THIS patient's actual values
  // with their normal reference. These are ECG-derived and always present, so
  // answers about the ratios must lead with these numbers rather than generic
  // textbook thresholds.
  const ratios = report.ratios ?? {};
  const ratioLine = (label: string, r: any): string | null => {
    if (!r || typeof r.value !== "number") return null;
    const cls = r.classification?.label ?? r.classification?.severity ?? "";
    return `- ${label}: ${r.value} (normal ${r.normal ?? "?"})${cls ? ` — ${cls}` : ""}`;
  };
  const ratioLines = [
    ratioLine("E/I ratio (deep-breathing)", ratios.eiRatio),
    ratioLine("Valsalva ratio", ratios.valsalvaRatio),
    ratioLine("30:15 ratio (standing)", ratios.thirtyFifteenRatio),
  ].filter(Boolean);
  const ratiosBlock = ratioLines.length
    ? `Measured cardiovagal (Ewing) ratios for ${firstName} — ECG-derived, actually measured:\n${ratioLines.join("\n")}`
    : "Measured cardiovagal (Ewing) ratios: none available.";

  return `--------------------------------------------------
PATIENT CONTEXT (${viewerRole} view)
--------------------------------------------------
Patient: ${name} | First name (address the patient by this in patient view): ${firstName} | Age: ${age} | Sex: ${sex} | BMI: ${bmi}
Physician: ${physician}
Medications: ${meds}
Reported Symptoms: ${symptoms}

${ratiosBlock}

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

    // Inject active knowledge sources into the system prompt, RANKED BY
    // RELEVANCE to the latest user question and capped at the 6 most relevant,
    // versus the previous "first 12 in year order for every question". This is a
    // deliberate focus/breadth trade: the set is smaller (faster, less noise)
    // and question-specific. When the question has no searchable terms the
    // ranker falls back to the first 6 in the original order. (To keep the old
    // breadth exactly while still ranking, raise the cap below to 12.)
    const [allKnowledgeSources, corpus] = await Promise.all([
      getActiveKnowledgeSources(),
      getKnowledgeCorpusStatus(),
    ]);
    const latestUserQuery =
      [...messages].reverse().find((m: any) => m.role === "user")?.content ?? "";
    const knowledgeSources = rankKnowledgeSources(
      allKnowledgeSources,
      latestUserQuery,
      6,
    );
    // When there is no retrievable corpus (0 chunks), the source rows are
    // metadata only — the prompt section reframes them as background reading and
    // forbids bracketed citations / diagnostic-performance / prognosis claims.
    const knowledgeSection = buildKnowledgePromptSection(knowledgeSources, corpus.ragFunctional);
    // Citations we return to the client: real RAG citations only when the corpus
    // is functional; otherwise none (report-only/external grounding).
    const knowledgeCitations = corpus.ragFunctional ? toCitations(knowledgeSources) : [];
    const grounding = corpus.ragFunctional
      ? { mode: "rag" as const, chunks: corpus.totalChunks, activeSources: corpus.activeSources }
      : { mode: "report_only" as const, chunks: 0, activeSources: corpus.activeSources,
          note: "Private knowledge corpus has no full-text chunks; answer is grounded in the report and clearly-labeled external evidence, not RAG." };

    const systemContent = [
      SYSTEM_PROMPT,
      knowledgeSection,
      buildPatientContext(report, viewerRole),
    ]
      .filter(Boolean)
      .join("\n\n");
    const conversation = [{ role: "system", content: systemContent }, ...messages];

    // Response cache: identical grounded conversation → instant replay. The key
    // folds in the full system context (report + role + knowledge) and the
    // message history, so any change busts the entry.
    const cacheKey = fnv1a(JSON.stringify(conversation));
    const cached = cacheGet(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        message: cached.message,
        webCitations: cached.webCitations,
        citations: knowledgeCitations,
        grounding,
        cached: true,
      });
    }

    // --- Opt-in true server streaming (SSE) ------------------------------------
    // Enabled when the client sends { stream: true } (or Accept: text/event-stream).
    // Emits token deltas as they arrive so time-to-first-token drops from
    // "whole completion" to the first chunk. The default path (below) stays a
    // single JSON response, so existing clients are unaffected. Grounding,
    // gating and citations are identical — only the transport differs. Streamed
    // responses are still written to the response cache on completion.
    const wantsStream =
      body?.stream === true ||
      String(req.headers["accept"] || "").includes("text/event-stream");
    if (wantsStream) {
      return await streamSonar({
        apiKey,
        conversation,
        knowledgeCitations,
        grounding,
        patientMode: viewerRole === "patient",
        cacheKey,
        res,
      });
    }

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
    const rawMessage = j?.choices?.[0]?.message?.content?.trim() || "";
    // Perplexity web citations renamed to webCitations to disambiguate from internal knowledge citations
    const rawWebCitations = j?.citations || j?.search_results?.map((s: any) => s?.url).filter(Boolean) || [];
    // Patient mode must never expose literature citations: strip bracket markers
    // from the prose and drop the web-citation list. Clinician mode keeps them.
    const message = viewerRole === "patient" ? stripCitationMarkers(rawMessage) : rawMessage;
    const webCitations = viewerRole === "patient" ? [] : rawWebCitations;

    // Only cache non-empty answers so a transient blank never sticks.
    if (message) cacheSet(cacheKey, { message, webCitations });

    return res.status(200).json({
      success: true,
      message,
      webCitations,
      citations: knowledgeCitations,
      grounding,
      cached: false,
    });
  } catch (err: any) {
    console.error("Ask Atom error:", err);
    return res.status(500).json({ success: false, error: err?.message || "Failed to query Atom" });
  }
}
