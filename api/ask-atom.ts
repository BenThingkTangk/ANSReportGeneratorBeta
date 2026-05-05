import type { VercelRequest, VercelResponse } from "@vercel/node";

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

const SYSTEM_PROMPT = `You are Atom, a Colombo-grounded autonomic-health assistant powered by Perplexity Sonar.
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

interface PhaseRow {
  phase: string; meanHR?: number; LFa?: number; RFa?: number; SB?: number; SBP?: number; DBP?: number;
}

function buildEventMeanTable(phaseEvents: PhaseRow[] | undefined): string {
  if (!phaseEvents || phaseEvents.length === 0) return "(no per-phase data)";
  const rows = ["Event | LFa | RFa | SB | mHR | BP", "--- | --- | --- | --- | --- | ---"];
  for (const p of phaseEvents) {
    const lfa = p.LFa != null ? p.LFa.toFixed(2) : "—";
    const rfa = p.RFa != null ? p.RFa.toFixed(2) : "—";
    const sb  = p.SB  != null ? p.SB.toFixed(2)  : "—";
    const hr  = p.meanHR != null ? p.meanHR.toFixed(0) : "—";
    const bp  = (p.SBP != null && p.DBP != null) ? `${p.SBP}/${p.DBP}` : "—";
    rows.push(`${p.phase} | ${lfa} | ${rfa} | ${sb} | ${hr} | ${bp}`);
  }
  return rows.join("\n");
}

function buildPatientContext(report: any, viewerRole: string): string {
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
  const overall = report.overallImpression || "(none)";
  const contraindList = (report.contraindications ?? []).join("; ") || "None flagged.";

  return `--------------------------------------------------
PATIENT CONTEXT (${viewerRole} view)
--------------------------------------------------
Patient: ${name} | Age: ${age} | Sex: ${sex} | BMI: ${bmi}
Physician: ${physician}
Medications: ${meds}
Reported Symptoms: ${symptoms}

Event Mean Data:
${meanTable}

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

    const systemContent = `${SYSTEM_PROMPT}\n\n${buildPatientContext(report, viewerRole)}`;
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
    const citations = j?.citations || j?.search_results?.map((s: any) => s?.url).filter(Boolean) || [];

    return res.status(200).json({ success: true, message, citations });
  } catch (err: any) {
    console.error("Ask Atom error:", err);
    return res.status(500).json({ success: false, error: err?.message || "Failed to query Atom" });
  }
}
