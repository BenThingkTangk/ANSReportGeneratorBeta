import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * /api/synopsis
 *
 * Generates two Colombo-grounded plain-English synopses (patient + clinician)
 * from an ANSReport payload, powered by Perplexity Sonar.
 *
 * POST body: { report: ANSReport }
 * Response:  { success: true, patientSynopsis, clinicianSynopsis }
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

  return [
    `Patient: ${pd.firstName ?? "?"} ${pd.lastName ?? "?"}, age ${pd.age}, ${pd.gender}`,
    `Physician: ${pd.physician}`,
    // Wellness score intentionally omitted from clinician synopsis per Dr. Colombo —
    // clinical view focuses on phase metrics and Colombo-defined patterns.
    `Risk level: ${report.riskLevel}`,
    `Baseline HR ${A.meanHR} bpm, BP ${A.SBP ?? "?"}/${A.DBP ?? "?"} mmHg, LFa ${A.LFa}, RFa ${A.RFa}, SB ${A.SB}`,
    `Stand HR ${F.meanHR} bpm, BP ${F.SBP ?? "?"}/${F.DBP ?? "?"} mmHg, LFa ${F.LFa}, RFa ${F.RFa}, SB ${F.SB}`,
    `Ewing ratios: E/I ${ratios?.eiRatio?.value}, Valsalva ${ratios?.valsalvaRatio?.value}, 30:15 ${ratios?.thirtyFifteenRatio?.value}`,
    `Dysfunction patterns: ${patterns}`,
    `Overall: ${report.overallImpression}`,
    `Therapies considered: ${ther}`,
    `Contraindications: ${contra}`,
    `Clinical flags: ${(report.clinicalFlags || []).join("; ")}`,
  ].join("\n");
}

const SYSTEM_PATIENT = `You are Atom, an empathetic autonomic-health coach trained on the Colombo P&S methodology (Physio PS, DynaCardia). You translate complex autonomic nervous system reports into warm, clear language a grandmother would understand. You NEVER give medical advice — you explain findings and tell the patient to discuss them with their physician. Keep it to 4-6 short paragraphs. Avoid jargon; when you must use a term (like "parasympathetic"), explain it in one plain sentence.`;

const SYSTEM_CLINICIAN = `You are Atom, a clinical summarization assistant for the Colombo P&S autonomic methodology. Write for a physician reviewing an ANS Element / Physio PS report. Be precise, cite the specific phase metrics (Baseline-A, DB-B, Valsalva-D, Stand-F), and articulate the Colombo dysfunction pattern(s) detected (PE, PW, SE, SW, AAD, CAN, POTS, orthostatic, vasovagal, pre-syncope). Mention contraindications (e.g. ALA gated by SBP < 95 mmHg). End with a 2-3 item next-step recommendation block. Keep the total length 250-400 words. No markdown headings — just paragraph text.`;

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

    // Run in parallel
    const [patientSynopsis, clinicianSynopsis] = await Promise.all([
      sonar(
        SYSTEM_PATIENT,
        `Please write a warm, plain-English summary of this autonomic report for the patient. Explain what it means for their day-to-day life (energy, sleep, dizziness, stress) and what they should talk to their doctor about.\n\nReport:\n${digest}`,
      ),
      sonar(
        SYSTEM_CLINICIAN,
        `Write the clinician synopsis for this report using Colombo methodology terminology. Be specific about phase metrics, patterns, and therapy gating.\n\nReport:\n${digest}`,
      ),
    ]);

    return res.status(200).json({
      success: true,
      patientSynopsis,
      clinicianSynopsis,
    });
  } catch (err: any) {
    console.error("Synopsis error:", err);
    return res.status(500).json({
      success: false,
      error: err?.message || "Failed to generate synopsis",
    });
  }
}
