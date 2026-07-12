import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * /api/tts — server-only ElevenLabs text-to-speech for Ask Atom.
 *
 * SECURITY / PHI:
 * - The ElevenLabs API key lives ONLY in process.env.ELEVENLABS_API_KEY and is
 *   never shipped to the browser. All synthesis happens server-side here.
 * - This route accepts ONLY a short block of already-generated answer text.
 *   It explicitly refuses any body carrying the raw ANS study or ANSReport, so
 *   the patient record can never be forwarded to a third-party voice vendor.
 * - As defense-in-depth we run a PHI redaction pass over the text before it
 *   leaves our server (dates, emails, phone/MRN-like digit runs). The client
 *   additionally strips patient/physician names before sending.
 *
 * POST body: { text: string }
 * Success:   200 audio/mpeg (binary)
 * Failure:   JSON { success: false, error }  → client falls back to browser TTS
 */

// Fixed Atom voice. Not a secret, but pinned server-side so the client cannot override it.
const VOICE_ID = "gs0tAILXbY5DNrJrsM6F";
const ELEVENLABS_URL = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;
const MODEL_ID = "eleven_turbo_v2_5";
const MAX_CHARS = 5000;

/** Strip markdown + redact generic PHI so nothing identifying is spoken or sent to ElevenLabs. */
function redactForSpeech(input: string): string {
  let t = input;

  // Drop the tiny model attribution line if present.
  t = t.replace(/—\s*powered by[^\n]*/gi, " ");

  // De-markdown so symbols aren't read aloud.
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1"); // [label](url) -> label
  t = t.replace(/`{1,3}([^`]*)`{1,3}/g, "$1"); // code spans
  t = t.replace(/[*_#>]/g, " "); // emphasis / headings / quotes
  t = t.replace(/^\s*[-•]\s+/gm, " "); // list bullets

  // Generic PHI patterns (backstop; names are removed client-side).
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, " "); // emails
  t = t.replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, " "); // 01/02/1990
  t = t.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " "); // ISO date
  t = t.replace(/\b\d{7,}\b/g, " "); // MRN / phone-ish long digit runs

  return t.replace(/\s{2,}/g, " ").trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success: false, error: "POST only" });

  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      // 501 → client treats the feature as unconfigured and uses the browser fallback.
      return res.status(501).json({ success: false, error: "ELEVENLABS_API_KEY not configured" });
    }

    const body: any = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // Hard stop: this route must never receive the raw report / ANS study / patient record.
    if (body && (body.report || body.ansStudy || body.patientData)) {
      return res
        .status(400)
        .json({ success: false, error: "TTS route does not accept report or PHI payloads" });
    }

    const rawText = typeof body?.text === "string" ? body.text : "";
    const text = redactForSpeech(rawText).slice(0, MAX_CHARS);
    if (!text) return res.status(400).json({ success: false, error: "No text to speak" });

    const r = await fetch(ELEVENLABS_URL, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      return res
        .status(502)
        .json({ success: false, error: `ElevenLabs error ${r.status}: ${detail.slice(0, 200)}` });
    }

    const audio = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(audio);
  } catch (err: any) {
    console.error("TTS error:", err);
    return res.status(500).json({ success: false, error: err?.message || "Failed to synthesize speech" });
  }
}
