import { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, Plus, Square, RotateCcw, CornerUpLeft, User, Stethoscope, Mic, Volume2 } from "lucide-react";
import { AtomLogo } from "./AtomLogo";
import { AtomMarkdown } from "./AtomMarkdown";
import { sanitizePatientTerminology } from "@shared/physiopsTerminology";
import { apiRequest } from "@/lib/queryClient";
import { useAtomVoice } from "@/hooks/useAtomVoice";
import { phiTermsFromReport } from "@/lib/speech";
import {
  isWellnessAssessable,
  isTherapyGateOpen,
  suggestedPrompts,
} from "@/lib/askAtomEvidence";
import type { ANSReport } from "@shared/schema";

interface AskAtomProps {
  report: ANSReport;
  /**
   * Merged extraction from any attached paired vendor PDF(s). Forwarded to
   * /api/ask-atom so questions about the attached vendor report are answered
   * from its verbatim findings (a separate, provenance-labeled evidence class)
   * rather than only the deterministic .ans domain list.
   */
  vendorExtraction?: import("@shared/vendorExtraction").VendorReportExtraction;
  viewerRole: "patient" | "clinician";
  /**
   * Optional controlled open state. When provided, AskAtom becomes controlled
   * and its built-in floating launcher is hidden on mobile — the host renders a
   * non-overlaying trigger (e.g. a header icon) instead. On desktop/tablet the
   * floating launcher is still shown so behavior is unchanged there.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

type ViewerRole = "patient" | "clinician";
type ChatStatus = "streaming" | "done" | "error";

interface AtomDiagnostics {
  ttftMs: number | null;
  sourceCount: number;
  transport: "sse" | "json";
  totalMs?: number;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: string[];
  /**
   * Knowledge-corpus passages actually retrieved for THIS answer, in the order
   * the prompt numbered them — so index 0 is the `[P1]` marker the model may
   * cite inline. Each entry is a display citation built server-side
   * ("Title (Year), section | p.N | chunk N"); never an id, path, or URL.
   * Stored per message because retrieval is per-question: one answer can be
   * passage-grounded while the next is report-only.
   */
  passageCitations?: string[];
  status?: ChatStatus;
  diagnostics?: AtomDiagnostics;
}

const PATIENT_FOLLOWUPS = [
  "What can I do to improve this?",
  "Is this something to worry about?",
  "How does this affect my energy?",
  "What should I ask my doctor?",
  "Will this change over time?",
];

// Diagnosis/therapy-oriented clinician follow-ups. Only offered when the therapy
// gate is OPEN (a supported indication + a real therapy recommendation exist).
const CLINICIAN_FOLLOWUPS = [
  "What's the differential here?",
  "Suggested first-line therapy?",
  "Dosing and titration details?",
  "Relevant contraindications?",
  "Which monitoring parameters apply?",
];

// Safe clinician follow-ups when the therapy gate is CLOSED (e.g. raw-ECG export
// with spectral/BP unavailable and no supported indication). These stay within
// the report's evidence boundary — no diagnosis, therapy, or dosing.
const CLINICIAN_FOLLOWUPS_GATED = [
  "What was measured?",
  "Why are spectral and BP results unavailable?",
  "Explain the Ewing ratios that were measured",
  "What are the limits of this recording?",
];

// Safe patient follow-ups when the therapy gate is CLOSED.
const PATIENT_FOLLOWUPS_GATED = [
  "What was measured?",
  "Why are spectral and BP results unavailable?",
  "What should I ask my clinician?",
];

/** Keep only strings, drop blanks and duplicates. */
function dedupeCitations(arr: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    if (typeof x === "string" && x && !seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException) return e.name === "AbortError";
  return typeof e === "object" && e !== null && (e as { name?: string }).name === "AbortError";
}

/**
 * Strip internal provenance markers that can leak from the grounding prompt into
 * a model answer. The server annotates findings with source-field traces like
 * "; provenance: baseline.heartRate, standOrTilt.bp.sbp" (and inside brackets
 * such as "[cardiovagal/severe, confidence High, provenance: …]"). Those dotted
 * field paths are internal plumbing and must never surface to patients or
 * clinicians. We remove the labelled marker plus its comma-separated dotted-path
 * list, leaving the surrounding prose (and sentence punctuation) intact. We also
 * strip the internal section headers "[DATA ASSESSABILITY & PROVENANCE]" and
 * "[LEGACY FINDINGS]" (case-insensitively, and even when back-to-back), which are
 * grounding-prompt scaffolding rather than clinical content.
 */
/**
 * Sanitize the server's `grounding.passageCitations` for display.
 *
 * The server builds each entry as a human label ("Title (Year), section | p.N |
 * chunk N"), but this is defence-in-depth for the UI: we drop anything that is
 * not a non-empty string and refuse entries that look like internal plumbing
 * rather than a citation — bare UUIDs, filesystem paths, URLs, or `key: value`
 * id traces. A patient must never see a row id or a storage path in the sources
 * panel. Order is preserved because index i maps to the `[P{i+1}]` marker.
 */
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function normalizePassageCitations(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((c) => (typeof c === "string" ? c.trim() : ""))
    .filter((c) => {
      if (c.length === 0) return false;
      if (UUID_ANYWHERE.test(c)) return false;          // row / source id
      if (/^[a-z]+:\/\//i.test(c)) return false;         // url
      if (/(^|\s)\/[\w.\-/]{2,}/.test(c)) return false;  // absolute path
      if (/\b(source_id|chunk_id|id)\s*[:=]/i.test(c)) return false; // id trace
      return true;
    })
    // Bound what we render so a pathological payload cannot flood the panel.
    .slice(0, 8);
}

function stripProvenanceMarkers(text: string): string {
  return text
    .replace(
      /[ \t]*[;,]?[ \t]*provenance:[ \t]*[\w-]+(?:\.[\w-]+)*(?:[ \t]*,[ \t]*[\w-]+(?:\.[\w-]+)*)*/gi,
      "",
    )
    // Drop internal section labels; the leading [ \t]* lets adjacent labels
    // collapse cleanly without leaving a doubled space behind.
    .replace(
      /[ \t]*\[(?:DATA ASSESSABILITY & PROVENANCE|LEGACY FINDINGS)\]/gi,
      "",
    )
    .replace(/\[[ \t]*\]/g, "") // drop any bracket left empty by the removal
    .replace(/[ \t]+$/gm, ""); // trim trailing horizontal whitespace per line
}

/**
 * LFa/RFa are genuine readings only when finite and strictly positive — the
 * deterministic pipeline zero-fills missing beat-to-beat data, so 0 / null / NaN
 * mean "not assessed", never a real measurement (mirrors the server's assessedNum).
 */
function isAssessedValue(v: number | null | undefined): boolean {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** True only when at least one phase carries a real LFa AND a real RFa reading. */
function lfaRfaAssessed(report: ANSReport): boolean {
  const phases = report.phaseEvents ?? [];
  return phases.some(p => isAssessedValue(p.LFa)) && phases.some(p => isAssessedValue(p.RFa));
}

/** CAN-family indication (codes CAN / CAN_HIGH_SB / CAN_LOW_SB, or a CAN name). */
function isCanIndication(ind: { code?: string; name?: string } | undefined): boolean {
  if (!ind) return false;
  const code = (ind.code ?? "").toUpperCase();
  const name = (ind.name ?? "").toUpperCase();
  return code.startsWith("CAN") || name.includes("CARDIOVASCULAR AUTONOMIC NEUROPATHY") || /\bCAN\b/.test(name);
}

/** Suggest up to 3 follow-ups, role-aware and grounded in the report's evidence. */
function buildFollowUps(mode: ViewerRole, report: ANSReport, asked: string[]): string[] {
  const derived: string[] = [];
  // The therapy gate is the single evidence boundary: diagnosis/therapy/dosing
  // follow-ups are only offered when a supported indication AND a real therapy
  // recommendation exist. When it is closed (e.g. spectral/BP unavailable), we
  // fall back to the "what was measured / what to ask" gated pools and surface
  // no score/tier-derived chips.
  const gateOpen = isTherapyGateOpen(report);
  const wellnessOk = isWellnessAssessable(report);
  const spectralAssessed = lfaRfaAssessed(report);
  const topIndication = report.indications?.[0];
  const top = topIndication?.name;
  if (gateOpen && top && !(isCanIndication(topIndication) && !spectralAssessed)) {
    derived.push(mode === "clinician" ? `Management approach for ${top}?` : `Tell me more about ${top}.`);
  }
  // Only reference the score/tier when it was genuinely assessable.
  if (mode === "patient" && wellnessOk && report.wellnessTier && !(report.wellnessTier === "Critical" && !spectralAssessed)) {
    derived.push(`Why is my score "${report.wellnessTier}"?`);
  }
  const pool = gateOpen
    ? (mode === "clinician" ? CLINICIAN_FOLLOWUPS : PATIENT_FOLLOWUPS)
    : (mode === "clinician" ? CLINICIAN_FOLLOWUPS_GATED : PATIENT_FOLLOWUPS_GATED);
  const seen = new Set(asked.map(a => a.trim().toLowerCase()));
  const out: string[] = [];
  for (const q of [...derived, ...pool]) {
    const key = q.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= 3) break;
  }
  return out;
}

export function AskAtom({ report, vendorExtraction, viewerRole, open: openProp, onOpenChange }: AskAtomProps) {
  const controlled = openProp !== undefined;
  const [openState, setOpenState] = useState(false);
  const open = controlled ? (openProp as boolean) : openState;
  const setOpen = (next: boolean | ((o: boolean) => boolean)) => {
    const value = typeof next === "function" ? (next as (o: boolean) => boolean)(open) : next;
    if (!controlled) setOpenState(value);
    onOpenChange?.(value);
  };
  const [mode, setMode] = useState<ViewerRole>(viewerRole);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [retryable, setRetryable] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  // Dev/test-only diagnostics: transport, time-to-first-token, retrieved source
  // count. Surfaced behind a DEV gate so QA can verify streaming + grounding.
  const [lastDiagnostics, setLastDiagnostics] = useState<AtomDiagnostics | null>(null);
  // Grounding mode from the server: "rag" (retrievable corpus) vs "report_only"
  // (no full-text chunks → answers grounded in the report + labeled external
  // evidence, NOT the private RAG corpus). Disclosed to the user.
  // `passages` is how many full-text passages were actually retrieved for the
  // latest answer — the "Full-text RAG" indicator is gated on that being > 0,
  // not merely on a corpus existing.
  const [grounding, setGrounding] = useState<
    { mode: "rag" | "report_only"; chunks?: number; passages?: number } | null
  >(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const idRef = useRef(0);
  // Text already typed when the mic was pressed, so dictation appends instead of clobbering it.
  const baseInputRef = useRef("");

  // PHI (patient/physician names) stripped client-side before any text is spoken or sent to TTS.
  const redactTerms = useMemo(() => phiTermsFromReport(report), [report]);
  const voice = useAtomVoice({
    onTranscript: (text) => setInput((baseInputRef.current + text).trimStart()),
  });

  const nextId = () => `m${idRef.current++}`;
  // Evidence-aware starter prompts (never diagnosis/dosing unless the therapy
  // gate is open) and the wellness-score gate for the header chip.
  const prompts = useMemo(() => suggestedPrompts(report, mode), [report, mode]);
  const wellnessAssessable = useMemo(() => isWellnessAssessable(report), [report]);

  // Follow the externally-selected role, while still allowing an in-panel override afterwards.
  useEffect(() => {
    setMode(viewerRole);
  }, [viewerRole]);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, streaming]);

  // Cleanup any in-flight request / reveal timer on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (revealTimerRef.current !== null) window.clearInterval(revealTimerRef.current);
    };
  }, []);

  // Clear the "speaking" highlight once playback finishes or is stopped.
  useEffect(() => {
    if (!voice.speaking) setSpeakingId(null);
  }, [voice.speaking]);

  const clearReveal = () => {
    if (revealTimerRef.current !== null) {
      window.clearInterval(revealTimerRef.current);
      revealTimerRef.current = null;
    }
  };

  // Progressive reveal: reveal the response word-by-word so long answers stream in.
  const startReveal = (fullText: string, citations: string[], passageCitations: string[] = []) => {
    const id = nextId();
    setMessages(prev => [...prev, { id, role: "assistant", content: "", status: "streaming", citations, passageCitations } as ChatMessage].slice(-10));
    setStreaming(true);

    const tokens = fullText.split(/(\s+)/);
    const total = tokens.length;
    const chunk = Math.max(2, Math.ceil(total / 120));
    let idx = 0;

    clearReveal();
    revealTimerRef.current = window.setInterval(() => {
      idx += chunk;
      if (idx >= total) {
        clearReveal();
        setStreaming(false);
        setMessages(prev => prev.map(m => (m.id === id ? { ...m, content: fullText, status: "done" } : m)));
      } else {
        const partial = tokens.slice(0, idx).join("");
        setMessages(prev => prev.map(m => (m.id === id ? { ...m, content: partial } : m)));
      }
    }, 22);
  };

  // Attempt TRUE server-sent-events streaming first (real token-by-token from
  // the server, with time-to-first-token diagnostics). Returns false if
  // streaming is unavailable/unsupported so the caller can fall back to JSON.
  const streamQuery = async (base: ChatMessage[], controller: AbortController): Promise<boolean> => {
    if (typeof fetch !== "function" || typeof ReadableStream === "undefined") return false;
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch("/api/ask-atom", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          messages: base.map(m => ({ role: m.role, content: m.content })).slice(-10),
          report,
          vendorExtraction,
          viewerRole: mode,
          stream: true,
        }),
        signal: controller.signal,
      });
    } catch {
      return false; // network/transport failure → let caller fall back
    }
    const ctype = res.headers.get("content-type") ?? "";
    if (!res.ok || !res.body || !ctype.includes("text/event-stream")) {
      // Server returned JSON (e.g. 502 error or a non-streaming deployment).
      return false;
    }

    // Live message we append deltas to.
    const id = nextId();
    setMessages(prev => [...prev, { id, role: "assistant", content: "", status: "streaming", citations: [] } as ChatMessage].slice(-10));
    setLoading(false);
    setStreaming(true);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let ttft: number | null = null;
    let citations: string[] = [];
    let passageCitations: string[] = [];
    let sawError: string | null = null;

    const applyFrame = (frame: string) => {
      const evLine = frame.split("\n").find(l => l.startsWith("event:"));
      const dataLine = frame.split("\n").find(l => l.startsWith("data:"));
      if (!dataLine) return;
      const event = evLine ? evLine.slice(6).trim() : "message";
      let payload: any = {};
      try { payload = JSON.parse(dataLine.slice(5).trim()); } catch { return; }
      if (event === "delta" && payload.text) {
        if (ttft === null) ttft = Date.now() - t0;
        full += payload.text;
        setMessages(prev => prev.map(m => (m.id === id ? { ...m, content: stripProvenanceMarkers(full) } : m)));
      } else if (event === "done") {
        citations = dedupeCitations([...(payload.citations ?? []), ...(payload.webCitations ?? [])]);
        passageCitations = normalizePassageCitations(payload.grounding?.passageCitations);
        if (payload.grounding?.mode) {
          setGrounding({
            mode: payload.grounding.mode,
            chunks: payload.grounding.chunks,
            passages: payload.grounding.passages,
          });
        }
      } else if (event === "error") {
        sawError = payload.error || "stream error";
      }
    };

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const f of frames) applyFrame(f);
      }
    } catch (e) {
      if (isAbortError(e)) { setStreaming(false); return true; }
      // Mid-stream transport drop with partial text: keep what we have but flag.
      if (!full) return false;
      sawError = sawError ?? "stream interrupted";
    }

    setStreaming(false);
    if (sawError && !full) {
      // No content at all → let the caller show the actionable fallback.
      setMessages(prev => prev.filter(m => m.id !== id));
      return false;
    }
    setMessages(prev => prev.map(m => (m.id === id
      ? { ...m, content: stripProvenanceMarkers(full), status: "done", citations, passageCitations,
          diagnostics: { ttftMs: ttft, sourceCount: citations.length, transport: "sse" } }
      : m)));
    setLastDiagnostics({ ttftMs: ttft, sourceCount: citations.length, transport: "sse", totalMs: Date.now() - t0 });
    return true;
  };

  const runQuery = async (base: ChatMessage[]) => {
    setRetryable(false);
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const t0 = Date.now();

    // 1) Try true SSE streaming.
    try {
      const streamed = await streamQuery(base, controller);
      if (streamed) { abortRef.current = null; return; }
    } catch (e) {
      if (isAbortError(e)) { abortRef.current = null; setLoading(false); setRetryable(true); return; }
      // fall through to JSON
    }

    // 2) Fallback: non-streaming JSON (also the path unit tests exercise).
    try {
      const res = await apiRequest(
        "POST",
        "/api/ask-atom",
        {
          messages: base.map(m => ({ role: m.role, content: m.content })).slice(-10),
          report,
          vendorExtraction,
          viewerRole: mode,
        },
        undefined,
        controller.signal,
      );
      const data = await res.json();
      abortRef.current = null;
      if (!data?.success || !data?.message) throw new Error(data?.error || "No response");
      const citations = dedupeCitations([...(data.citations ?? []), ...(data.webCitations ?? [])]);
      const passageCitations = normalizePassageCitations(data.grounding?.passageCitations);
      if (data.grounding?.mode) {
        setGrounding({
          mode: data.grounding.mode,
          chunks: data.grounding.chunks,
          passages: data.grounding.passages,
        });
      }
      setLoading(false);
      setLastDiagnostics({ ttftMs: Date.now() - t0, sourceCount: citations.length, transport: "json", totalMs: Date.now() - t0 });
      startReveal(stripProvenanceMarkers(String(data.message)), citations, passageCitations);
    } catch (e) {
      abortRef.current = null;
      setLoading(false);
      if (isAbortError(e)) {
        setRetryable(true);
        return;
      }
      // Actionable, non-fabricating fallback: no invented clinical content, a
      // clear next step, and the deterministic report remains fully available.
      setMessages(prev =>
        [
          ...prev,
          {
            id: nextId(),
            role: "assistant" as const,
            content:
              "I couldn't reach the assistant just now, so I won't guess. Your report above is complete and accurate on its own — every measured value and finding is shown there. Tap Retry to ask again, or continue reading the report.",
            status: "error" as const,
          },
        ].slice(-10),
      );
      setRetryable(true);
    }
  };

  const sendMessage = (text: string) => {
    const t = text.trim();
    if (!t || loading || streaming) return;
    const next = [...messages, { id: nextId(), role: "user" as const, content: t }].slice(-10);
    setMessages(next);
    setInput("");
    runQuery(next);
  };

  // Cancel: abort the request and/or stop the reveal, keeping any partial text.
  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (revealTimerRef.current !== null) {
      clearReveal();
      setMessages(prev => prev.map(m => (m.status === "streaming" ? { ...m, status: "done" } : m)));
    }
    setStreaming(false);
    setLoading(false);
    setRetryable(true);
  };

  // Retry: drop trailing assistant turn(s) and re-run from the last user message.
  const retry = () => {
    if (loading || streaming) return;
    const msgs = [...messages];
    while (msgs.length > 0 && msgs[msgs.length - 1].role === "assistant") msgs.pop();
    if (msgs.length === 0) return;
    setMessages(msgs);
    runQuery(msgs);
  };

  const stopEverything = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    clearReveal();
    setStreaming(false);
    setLoading(false);
    voice.stopSpeaking();
    voice.stopListening();
  };

  // Explicit-click mic: press to dictate, press again to stop. Appends to any typed text.
  const handleMicClick = () => {
    if (voice.listening) {
      voice.stopListening();
      return;
    }
    baseInputRef.current = input ? input.trimEnd() + " " : "";
    voice.startListening();
  };

  // Explicit-click speaker: read this answer aloud (server voice, browser fallback); click again to stop.
  const handleSpeak = (msg: ChatMessage) => {
    if (speakingId === msg.id && voice.speaking) {
      voice.stopSpeaking();
      return;
    }
    setSpeakingId(msg.id);
    // Read aloud must obey the same output protocol as the rendered text.
    voice.speak(mode === "patient" ? sanitizePatientTerminology(msg.content) : msg.content, redactTerms);
  };

  // Branch back: rewind to an earlier question, restoring its text for editing.
  const branchFrom = (index: number) => {
    stopEverything();
    const question = messages[index]?.content ?? "";
    setMessages(messages.slice(0, index));
    setInput(question);
    setRetryable(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const reset = () => {
    stopEverything();
    setMessages([]);
    setInput("");
    setRetryable(false);
  };

  const busy = loading || streaming;
  const asked = messages.filter(m => m.role === "user").map(m => m.content);
  const last = messages[messages.length - 1];
  const showFollowUps = !!last && last.role === "assistant" && last.status === "done" && !busy && !retryable;
  const followUps = showFollowUps ? buildFollowUps(mode, report, asked) : [];

  return (
    <>
      {/* Floating launcher.
          On mobile the fixed launcher overlaid lower-right report metrics (e.g.
          the parasympathetic "Not assessed" gauge) regardless of bottom padding,
          because it is viewport-fixed and follows the scroll position. When the
          host controls `open` it renders a non-overlaying mobile trigger (header
          icon), so here we hide this fixed launcher below `sm` and keep it only
          for tablet/desktop widths where there is ample right-margin. When
          uncontrolled (standalone usage) the launcher shows at all widths. */}
      <motion.button
        onClick={() => setOpen(o => !o)}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.95 }}
        className={`fixed right-4 sm:right-6 w-12 h-12 sm:w-14 sm:h-14 rounded-full ${
          controlled ? "hidden sm:flex" : "flex"
        } items-center justify-center shadow-xl z-50 group`}
        style={{
          // Safe-area-aware bottom offset for the tablet/desktop floating button.
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)",
          background: "linear-gradient(135deg, hsl(185 85% 35%), hsl(185 85% 48%))",
          boxShadow: "0 0 24px hsl(185 85% 42% / 0.45), 0 4px 16px hsl(0 0% 0% / 0.4)",
        }}
        title="Ask Atom"
        data-testid="ask-atom-button"
        aria-label="Ask Atom"
      >
        <AtomLogo size={26} color="white" />
        {/* Tooltip */}
        <span
          className="absolute bottom-full mb-2 right-0 text-xs font-medium px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
          style={{ background: "hsl(210 18% 12%)", border: "1px solid hsl(210 15% 20%)" }}
        >
          Ask Atom
        </span>
      </motion.button>

      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="ask-atom-panel"
            initial={{ opacity: 0, scale: 0.9, y: 20, transformOrigin: "bottom right" }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", stiffness: 360, damping: 30 }}
            className="fixed right-3 sm:right-6 w-[min(340px,calc(100vw-1.5rem))] sm:w-[380px] rounded-2xl flex flex-col overflow-hidden z-50"
            style={{
              bottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)",
              height: "min(560px, calc(100vh - 140px))",
              background: "hsl(210 20% 8%)",
              border: "1px solid hsl(210 15% 16%)",
              boxShadow: "0 24px 64px hsl(0 0% 0% / 0.6), 0 0 0 1px hsl(185 85% 42% / 0.1)",
            }}
            data-testid="ask-atom-panel"
          >
            {/* Header */}
            <div
              className="flex items-center gap-3 px-4 py-3 border-b flex-shrink-0"
              style={{ borderColor: "hsl(210 15% 16%)", background: "hsl(210 20% 9%)" }}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: "linear-gradient(135deg, hsl(185 85% 35%), hsl(185 85% 48%))" }}
              >
                <AtomLogo size={18} color="white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-tight">Ask Atom</p>
                <p className="text-[10px] text-muted-foreground">Powered by ATOM</p>
              </div>
              <button
                onClick={reset}
                disabled={messages.length === 0 && !retryable}
                className="p-1.5 rounded-lg hover:bg-card/80 transition-colors disabled:opacity-30"
                data-testid="ask-atom-reset"
                aria-label="New chat"
                title="New chat"
              >
                <Plus className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
              <button
                onClick={() => {
                  voice.stopSpeaking();
                  voice.stopListening();
                  setOpen(false);
                }}
                className="p-1.5 rounded-lg hover:bg-card/80 transition-colors"
                data-testid="ask-atom-close"
                aria-label="Close"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>

            {/* Mode toggle + score chip */}
            <div
              className="flex items-center justify-between gap-2 px-3 py-2 border-b flex-shrink-0"
              style={{ borderColor: "hsl(210 15% 14%)", background: "hsl(210 20% 8.5%)" }}
            >
              <div
                className="flex items-center gap-0.5 p-0.5 rounded-lg"
                style={{ background: "hsl(210 18% 12%)", border: "1px solid hsl(210 15% 18%)" }}
                role="group"
                aria-label="Assistant mode"
              >
                {(["patient", "clinician"] as const).map(r => (
                  <button
                    key={r}
                    onClick={() => setMode(r)}
                    className="px-2 py-1 rounded-md text-[10px] font-medium flex items-center gap-1 transition-colors"
                    style={
                      mode === r
                        ? { background: "hsl(185 85% 42%)", color: "white" }
                        : { color: "hsl(210 10% 62%)" }
                    }
                    data-testid={`atom-mode-${r}`}
                    aria-pressed={mode === r}
                  >
                    {r === "patient" ? <User className="w-3 h-3" /> : <Stethoscope className="w-3 h-3" />}
                    {r === "patient" ? "Patient" : "Clinician"}
                  </button>
                ))}
              </div>
              {wellnessAssessable ? (
                <div
                  className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md flex-shrink-0"
                  style={{
                    background: "hsl(185 85% 42% / 0.1)",
                    border: "1px solid hsl(185 85% 42% / 0.2)",
                    color: "hsl(185 85% 65%)",
                  }}
                  title="Wellness score"
                  data-testid="atom-score-chip"
                >
                  <AtomLogo size={11} color="hsl(185 85% 60%)" />
                  <span className="font-semibold">{report.wellnessScore == null ? "Measurements ready" : Math.round(report.wellnessScore)}</span>
                  <span className="opacity-70">{report.wellnessTier}</span>
                </div>
              ) : (
                <div
                  className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md flex-shrink-0"
                  style={{
                    background: "hsl(210 12% 20% / 0.6)",
                    border: "1px solid hsl(210 12% 30% / 0.6)",
                    color: "hsl(210 10% 68%)",
                  }}
                  title="Wellness score depends on spectral/balance data, which was not assessed for this recording."
                  data-testid="atom-score-chip-unavailable"
                >
                  <AtomLogo size={11} color="hsl(210 10% 62%)" />
                  <span className="font-medium">Not assessed</span>
                </div>
              )}
            </div>

            {/* Message area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full gap-4 pt-4">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center"
                    style={{ background: "hsl(185 85% 42% / 0.12)", border: "1px solid hsl(185 85% 42% / 0.2)" }}
                  >
                    <AtomLogo size={28} color="hsl(185 85% 55%)" />
                  </div>
                  <p className="text-xs text-muted-foreground text-center max-w-[240px] leading-relaxed">
                    Ask about{" "}
                    {mode === "patient"
                      ? "your results, symptoms, or what to discuss with your doctor"
                      : "this patient's findings, Colombo methodology, or treatment options"}
                    .
                  </p>
                  <div className="flex flex-col gap-2 w-full">
                    {prompts.map((p, i) => (
                      <button
                        key={i}
                        onClick={() => sendMessage(p)}
                        className="text-left text-xs px-3 py-2.5 rounded-xl transition-colors hover:border-[hsl(185_85%_42%/0.4)]"
                        style={{
                          background: "hsl(210 18% 12%)",
                          border: "1px solid hsl(210 15% 18%)",
                          color: "hsl(210 10% 75%)",
                        }}
                        data-testid={`prompt-chip-${i}`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) =>
                msg.role === "user" ? (
                  <div key={msg.id} className="group flex gap-1.5 justify-end items-start">
                    <button
                      onClick={() => branchFrom(i)}
                      className="mt-1 p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      style={{ color: "hsl(210 10% 55%)" }}
                      title="Edit & branch from here"
                      aria-label="Edit and branch from here"
                      data-testid={`atom-branch-${i}`}
                    >
                      <CornerUpLeft className="w-3 h-3" />
                    </button>
                    <div className="max-w-[80%]">
                      <div
                        className="px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap"
                        style={{ background: "hsl(185 85% 42%)", color: "white", borderRadius: "14px 14px 4px 14px" }}
                      >
                        {msg.content}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div key={msg.id} className="flex gap-2 justify-start">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ background: "hsl(185 85% 42% / 0.15)" }}
                    >
                      <AtomLogo size={14} color="hsl(185 85% 55%)" />
                    </div>
                    <div className="max-w-[85%] space-y-1">
                      <div
                        className="px-3 py-2 rounded-xl text-xs"
                        style={{
                          background: msg.status === "error" ? "hsl(0 50% 16%)" : "hsl(210 18% 13%)",
                          border:
                            msg.status === "error"
                              ? "1px solid hsl(0 55% 32%)"
                              : "1px solid hsl(210 15% 18%)",
                          borderRadius: "4px 14px 14px 14px",
                          color: "hsl(210 12% 82%)",
                        }}
                      >
                        {/* AUTHORIZED PhysioPS OUTPUT PROTOCOL — client-side
                            backstop. /api/ask-atom already gates patient answers,
                            but the renderer refuses to display an HRV-specific
                            parameter (ULF, VLF, LF, HF, TSP, sdNN, rmsSD, pNN50)
                            in patient mode even if an older/cached deployment
                            returns one. Clinician mode is untouched. */}
                        <AtomMarkdown
                          content={mode === "patient" ? sanitizePatientTerminology(msg.content) : msg.content}
                        />
                        {msg.status === "streaming" && (
                          <span
                            className="inline-block w-1.5 h-3 align-middle ml-0.5 animate-pulse"
                            style={{ background: "hsl(185 85% 55%)" }}
                          />
                        )}
                      </div>
                      {msg.status === "done" && msg.content.trim() && (
                        <div className="flex items-center gap-1.5 px-1">
                          <button
                            onClick={() => handleSpeak(msg)}
                            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md transition-colors hover:brightness-125"
                            style={
                              speakingId === msg.id && voice.speaking
                                ? {
                                    background: "hsl(0 55% 42% / 0.15)",
                                    border: "1px solid hsl(0 55% 42% / 0.4)",
                                    color: "hsl(0 70% 72%)",
                                  }
                                : {
                                    background: "hsl(185 85% 42% / 0.1)",
                                    border: "1px solid hsl(185 85% 42% / 0.2)",
                                    color: "hsl(185 85% 65%)",
                                  }
                            }
                            data-testid={`atom-speak-${i}`}
                            aria-label={
                              speakingId === msg.id && voice.speaking ? "Stop reading" : "Read answer aloud"
                            }
                            title={speakingId === msg.id && voice.speaking ? "Stop" : "Read aloud"}
                          >
                            {speakingId === msg.id && voice.speaking ? (
                              <>
                                <Square className="w-2.5 h-2.5" fill="currentColor" /> Stop
                              </>
                            ) : (
                              <>
                                <Volume2 className="w-3 h-3" /> Play
                              </>
                            )}
                          </button>
                          {speakingId === msg.id && voice.speaking && voice.usedFallback && (
                            <span className="text-[9px] text-muted-foreground" data-testid="atom-tts-fallback">
                              browser voice
                            </span>
                          )}
                        </div>
                      )}
                      {/* Knowledge sources used: maps the [P1]/[P2] markers the
                          answer cites to the passage citations the server
                          actually retrieved for THIS answer. Rendered per message
                          because retrieval is per-question. Patient-report and
                          vendor-report evidence are NOT listed here — they are
                          labeled separately in the report panels. */}
                      {msg.status !== "streaming" && (msg.passageCitations?.length ?? 0) > 0 && (
                        <div
                          className="mx-1 mt-1 rounded-lg px-2.5 py-2"
                          style={{
                            background: "hsl(185 85% 42% / 0.06)",
                            border: "1px solid hsl(185 85% 42% / 0.18)",
                          }}
                          data-testid="atom-passage-sources"
                        >
                          <div
                            className="text-[9.5px] uppercase tracking-[0.12em] mb-1"
                            style={{ color: "hsl(185 85% 62%)" }}
                          >
                            Knowledge sources used
                          </div>
                          <ul className="space-y-0.5 m-0 p-0 list-none">
                            {msg.passageCitations!.map((c, pi) => (
                              <li
                                key={pi}
                                // Wrap rather than truncate: on a 390px phone a
                                // citation with a section title + timecode needs
                                // two lines, and clipping it would hide the
                                // locator that makes it verifiable.
                                className="text-[10px] leading-snug flex gap-1.5 break-words"
                                style={{ color: "hsl(210 15% 72%)" }}
                                data-testid={`atom-passage-source-${pi}`}
                              >
                                <span
                                  className="flex-shrink-0 font-medium"
                                  style={{ color: "hsl(185 85% 60%)" }}
                                >
                                  [P{pi + 1}]
                                </span>
                                <span className="min-w-0">{c}</span>
                              </li>
                            ))}
                          </ul>
                          <div
                            className="text-[9px] mt-1.5 leading-snug"
                            style={{ color: "hsl(210 12% 55%)" }}
                          >
                            Explanatory reference material — not your measurements.
                          </div>
                        </div>
                      )}
                      {msg.status !== "streaming" && msg.citations && msg.citations.length > 0 && (
                        <div className="flex flex-wrap gap-1 px-1">
                          {msg.citations.map((c, ci) => (
                            <a
                              key={ci}
                              href={c}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[9px] px-1.5 py-0.5 rounded transition-colors"
                              style={{
                                color: "hsl(185 85% 55%)",
                                background: "hsl(185 85% 42% / 0.1)",
                                border: "1px solid hsl(185 85% 42% / 0.2)",
                              }}
                              title={c}
                            >
                              [{ci + 1}]
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ),
              )}

              {/* Follow-up chips */}
              {followUps.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pl-8 pt-0.5" data-testid="atom-followups">
                  {followUps.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(q)}
                      className="text-[10px] px-2.5 py-1.5 rounded-full transition-colors hover:brightness-125"
                      style={{
                        background: "hsl(185 85% 42% / 0.08)",
                        border: "1px solid hsl(185 85% 42% / 0.25)",
                        color: "hsl(185 85% 70%)",
                      }}
                      data-testid={`atom-followup-${i}`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}

              {/* Retry affordance */}
              {retryable && !busy && (
                <div className="flex justify-center pt-1">
                  <button
                    onClick={retry}
                    className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg transition-colors hover:brightness-125"
                    style={{ background: "hsl(210 18% 13%)", border: "1px solid hsl(210 15% 20%)", color: "hsl(210 10% 75%)" }}
                    data-testid="atom-retry"
                  >
                    <RotateCcw className="w-3 h-3" /> Retry
                  </button>
                </div>
              )}

              {loading && (
                <div className="flex items-center gap-2 justify-start">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: "hsl(185 85% 42% / 0.15)" }}
                  >
                    <AtomLogo size={14} color="hsl(185 85% 55%)" />
                  </div>
                  <div
                    className="flex gap-1 px-3 py-2.5 rounded-xl"
                    style={{ background: "hsl(210 18% 13%)", border: "1px solid hsl(210 15% 18%)" }}
                  >
                    {[0, 1, 2].map(i => (
                      <motion.div
                        key={i}
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: "hsl(185 85% 55%)" }}
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                      />
                    ))}
                  </div>
                </div>
              )}
              {/* Dev/test diagnostics: transport + time-to-first-token + retrieved
                  source count. Hidden in production; used by visual QA. */}
              {import.meta.env?.DEV && lastDiagnostics && (
                <div
                  className="text-[10px] text-muted-foreground/70 text-center pt-1 font-mono"
                  data-testid="atom-diagnostics"
                  data-transport={lastDiagnostics.transport}
                  data-ttft={lastDiagnostics.ttftMs ?? ""}
                  data-sources={lastDiagnostics.sourceCount}
                >
                  {lastDiagnostics.transport.toUpperCase()} · TTFT{" "}
                  {lastDiagnostics.ttftMs != null ? `${lastDiagnostics.ttftMs}ms` : "n/a"} ·{" "}
                  {lastDiagnostics.sourceCount} source{lastDiagnostics.sourceCount === 1 ? "" : "s"}
                  {lastDiagnostics.totalMs != null ? ` · ${lastDiagnostics.totalMs}ms total` : ""}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Grounding disclosure: when the private corpus has no full-text
                chunks, tell the user answers are report-only/external, not RAG. */}
            {/* Full-text RAG indicator — shown ONLY when this answer actually
                used retrieved passages. A corpus that exists but yielded no
                relevant passage stays report-only (the server reports
                mode:"report_only" in that case), so this can never overstate
                grounding. */}
            {grounding?.mode === "rag" && (grounding.passages ?? 0) > 0 && (
              <div
                className="px-3 py-2 text-[10.5px] leading-snug border-t flex items-start gap-1.5 flex-shrink-0"
                style={{
                  borderColor: "hsl(185 85% 42% / 0.25)",
                  background: "hsl(185 85% 42% / 0.06)",
                  color: "hsl(185 85% 72%)",
                }}
                data-testid="atom-grounding-disclosure"
                data-grounding="rag"
              >
                <span aria-hidden="true">◆</span>
                <span>
                  <strong>Full-text RAG</strong> — this answer used{" "}
                  {grounding.passages} retrieved knowledge{" "}
                  {grounding.passages === 1 ? "passage" : "passages"}, listed under the answer.
                  Your report and any attached vendor report are labeled separately.
                </span>
              </div>
            )}

            {grounding?.mode === "report_only" && (
              <div
                className="px-3 py-2 text-[10.5px] leading-snug border-t flex items-start gap-1.5 flex-shrink-0"
                style={{ borderColor: "hsl(38 92% 50% / 0.25)", background: "hsl(38 92% 50% / 0.06)", color: "hsl(38 90% 78%)" }}
                data-testid="atom-grounding-disclosure"
                data-grounding="report_only"
              >
                <span aria-hidden="true">ⓘ</span>
                <span>
                  Answers are grounded in <strong>your report</strong> and clearly-labeled external
                  sources. The private knowledge base has <strong>no full-text chunks indexed</strong>,
                  so this is not retrieval-augmented (RAG) grounding.
                </span>
              </div>
            )}

            {/* Input bar */}
            <div
              className="flex items-center gap-2 px-3 py-3 border-t flex-shrink-0"
              style={{ borderColor: "hsl(210 15% 15%)", background: "hsl(210 20% 8%)" }}
            >
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(input);
                  }
                }}
                placeholder={
                  voice.listening
                    ? "Listening…"
                    : mode === "patient"
                      ? "Ask about your results…"
                      : "Ask about this patient…"
                }
                disabled={busy}
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50 min-w-0 disabled:opacity-60"
                data-testid="ask-atom-input"
                style={{ color: "hsl(200 20% 92%)" }}
              />
              <button
                onClick={handleMicClick}
                disabled={busy || !voice.supportsListening}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:scale-105 disabled:opacity-40 flex-shrink-0"
                style={
                  voice.listening
                    ? { background: "hsl(0 55% 42%)" }
                    : { background: "hsl(210 18% 14%)", border: "1px solid hsl(210 15% 22%)" }
                }
                data-testid="ask-atom-mic"
                aria-pressed={voice.listening}
                aria-label={
                  !voice.supportsListening
                    ? "Voice input not supported"
                    : voice.listening
                      ? "Stop listening"
                      : "Speak your question"
                }
                title={
                  !voice.supportsListening
                    ? "Voice input isn't supported in this browser"
                    : voice.listening
                      ? "Listening… click to stop"
                      : "Speak your question"
                }
              >
                {voice.listening ? (
                  <motion.span
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="flex"
                  >
                    <Mic className="w-3.5 h-3.5 text-white" />
                  </motion.span>
                ) : (
                  <Mic
                    className="w-3.5 h-3.5"
                    style={{ color: voice.supportsListening ? "hsl(185 85% 60%)" : "hsl(210 10% 45%)" }}
                  />
                )}
              </button>
              {busy ? (
                <button
                  onClick={cancel}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:scale-105"
                  style={{ background: "hsl(0 55% 42%)" }}
                  data-testid="ask-atom-stop"
                  aria-label="Stop"
                  title="Stop"
                >
                  <Square className="w-3 h-3 text-white" fill="white" />
                </button>
              ) : (
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim()}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:scale-105 disabled:opacity-40"
                  style={{ background: "hsl(185 85% 42%)" }}
                  data-testid="ask-atom-send"
                  aria-label="Send"
                >
                  <Send className="w-3.5 h-3.5 text-white" />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
