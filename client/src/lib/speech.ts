// Web Speech API helpers + PHI-safe speech sanitization for Ask Atom.
//
// The browser SpeechRecognition API (explicit-click voice input) is not part of
// the standard TS DOM lib and is vendor-prefixed in Chromium, so we declare a
// minimal structural type here and resolve the constructor at runtime.

import type { ANSReport } from "@shared/schema";

export interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
export interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
  length: number;
}
export interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}
export interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}
export interface SpeechRecognitionErrorEventLike {
  error: string;
}
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** Resolve the (possibly vendor-prefixed) SpeechRecognition constructor, or null if unsupported. */
export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** True when the browser can synthesize speech locally (fallback path for TTS). */
export function speechSynthesisSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip markdown and redact known PHI terms so nothing identifying is spoken
 * aloud or sent to the server TTS route. `terms` are patient/physician names
 * pulled from the report on the client — they are removed here and therefore
 * never transmitted off the device.
 */
export function sanitizeForSpeech(input: string, terms: string[] = []): string {
  let t = input;

  // Drop the tiny model attribution line if present.
  t = t.replace(/—\s*powered by[^\n]*/gi, " ");

  // De-markdown so symbols aren't read aloud.
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1"); // [label](url) -> label
  t = t.replace(/`{1,3}([^`]*)`{1,3}/g, "$1"); // code spans
  t = t.replace(/[*_#>]/g, " "); // emphasis / headings / quotes
  t = t.replace(/^\s*[-•]\s+/gm, " "); // list bullets

  // Redact caller-supplied identifiers (patient / physician names, etc.).
  for (const term of terms) {
    const trimmed = (term ?? "").trim();
    if (trimmed.length < 2) continue;
    t = t.replace(new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, "gi"), " ");
  }

  return t.replace(/\s{2,}/g, " ").trim();
}

/** Distinct PHI-ish terms to scrub before speaking, derived from the patient record. */
export function phiTermsFromReport(report: ANSReport | undefined): string[] {
  const pd = report?.patientData;
  if (!pd) return [];
  const terms = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && v.trim().length >= 2) terms.add(v.trim());
  };
  add(pd.firstName);
  add(pd.lastName);
  if (pd.firstName && pd.lastName) add(`${pd.firstName} ${pd.lastName}`);
  add(pd.physician);
  return [...terms];
}
