import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * /api/ask-atom
 *
 * A Colombo-grounded chatbot powered by Perplexity Sonar.
 * Accepts a conversation history + optional current report context, returns
 * a grounded answer with citations.
 *
 * POST body: {
 *   messages: Array<{role: "user"|"assistant"|"system", content: string}>,
 *   report?: ANSReport,
 *   viewerRole?: "patient" | "clinician"
 * }
 * Response:  { success: true, message, citations }
 */

const SONAR_URL = "https://api.perplexity.ai/chat/completions";

const COLOMBO_SYSTEM = `You are Atom, an autonomic-health assistant grounded in the Colombo P&S methodology (Physio PS / ANS Element / DynaCardia Rx).

Core methodology you reference:
- Concurrent, independent LFa (sympathetic, 0.04-0.15 Hz) and RFa (parasympathetic, respiratory-locked) bands computed from heart-rate variability via continuous wavelet transform.
- Fundamental Respiratory Frequency (FRF) derived from EDR respiratory extraction. Normal FRF during Deep Breathing is 0.09-0.15 Hz; a high FRF artifactually lowers parasympathetic measurements.
- Six standard phases: Initial Baseline (A, 5 min), Deep Breathing (B, 1 min), Baseline (C), Valsalva (D), Baseline (E), Stand/Head-up Tilt (F).
- Sympathovagal balance SB = LFa / RFa. Target resting SB ≈ 1.0-2.0 for non-geriatric adults.
- Dysfunction patterns: Parasympathetic Excess (PE), Parasympathetic Withdrawal (PW), Sympathetic Excess (SE), Sympathetic Withdrawal (SW), Advanced Autonomic Dysfunction (AAD, aka DAN), Cardiovascular Autonomic Neuropathy (CAN), POTS, orthostatic hypotension, vasovagal risk, pre-syncope risk.
- Therapy gating (Colombo 4.0 protocol):
  * PE → low-dose Nortriptyline 10-12 mg with dinner (or Amitriptyline); add-on low-dose Carvedilol 3.125 mg BID.
  * AAD / PW → Alpha-Lipoic Acid 600 mg TID — CONTRAINDICATED if baseline SBP < 95 mmHg.
  * SW → Midodrine 2.5 mg TID.
  * POTS / orthostatic / syncope → hydration + salt protocol (6-8 glasses water, 1 tbsp salt in 64 oz water).
  * PE / SE → Low-and-Slow exercise (40 min/day zero-impact cardio, 6+ months).

Rules:
- Be warm and empathetic. Use plain language unless the viewer is a clinician.
- When asked medical questions, respond educationally but always defer to the treating physician for prescriptions or definitive diagnosis.
- You may cite Colombo et al., Physio PS, DynaCardia, and peer-reviewed autonomic literature.
- Keep answers conversational (2-4 short paragraphs unless asked for detail).
- If a current report is provided, reference specific values from it.
- At the end, include a tiny "Powered by Perplexity" attribution tag: "— powered by Perplexity Sonar".`;

function reportDigest(report: any, viewerRole: string): string {
  if (!report) return "(no report attached to this conversation)";
  const pd = report.patientData || {};
  const A = report.phaseEvents?.[0] || {};
  const F = report.phaseEvents?.[5] || {};
  const patterns = Object.entries(report.dysfunctionPatterns || {})
    .filter(([, v]) => v === true).map(([k]) => k).join(", ") || "none";
  const base = `
Current patient report for your reference (${viewerRole} view):
- ${pd.firstName ?? "?"} ${pd.lastName ?? "?"}, age ${pd.age}, ${pd.gender}. Physician: ${pd.physician}.
- Wellness ${report.wellnessScore}/100 (${report.wellnessTier}); Risk: ${report.riskLevel}.
- Baseline: HR ${A.meanHR}, BP ${A.SBP ?? "?"}/${A.DBP ?? "?"}, LFa ${A.LFa}, RFa ${A.RFa}, SB ${A.SB}.
- Stand: HR ${F.meanHR}, BP ${F.SBP ?? "?"}/${F.DBP ?? "?"}, LFa ${F.LFa}, RFa ${F.RFa}, SB ${F.SB}.
- Patterns: ${patterns}.
- Overall: ${report.overallImpression}.
- Contraindications: ${(report.contraindications || []).join("; ") || "none"}.
`;
  return base.trim();
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

    // Back-compat: accept {question, context} shape as a single-turn user message
    if (messages.length === 0 && typeof body?.question === "string" && body.question.trim()) {
      messages = [{ role: "user", content: body.question.trim() }];
    }

    // Normalize: keep only valid user/assistant turns
    messages = messages
      .filter((m: any) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
      .slice(-10);

    // Sonar requires the last message to be role=user. If missing or ends with
    // assistant, reject with a clear 400 rather than forwarding a bad request.
    if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
      return res.status(400).json({
        success: false,
        error: "messages must be a non-empty array ending with a user message (or provide a 'question' field)",
      });
    }

    // Inject system prompt + report digest at the front
    const contextMsg = {
      role: "system",
      content: `${COLOMBO_SYSTEM}\n\n${reportDigest(report, viewerRole)}`,
    };
    const conversation = [contextMsg, ...messages];

    const r = await fetch(SONAR_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: conversation,
        temperature: 0.4,
        max_tokens: 650,
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(500).json({ success: false, error: `Sonar error ${r.status}: ${text.slice(0, 300)}` });
    }
    const j = (await r.json()) as any;
    const message = j?.choices?.[0]?.message?.content?.trim() || "";
    const citations = j?.citations || [];

    return res.status(200).json({ success: true, message, citations });
  } catch (err: any) {
    console.error("Ask Atom error:", err);
    return res.status(500).json({ success: false, error: err?.message || "Failed to query Atom" });
  }
}
