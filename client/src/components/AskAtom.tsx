import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send } from "lucide-react";
import { AtomLogo } from "./AtomLogo";
import { apiRequest } from "@/lib/queryClient";
import type { ANSReport, AtomMessage } from "@shared/schema";

interface AskAtomProps {
  report: ANSReport;
  viewerRole: "patient" | "clinician";
}

const PATIENT_PROMPTS = [
  "What does my score mean for daily life?",
  "Why is my blood pressure low?",
  "What should I ask my doctor?",
];

const CLINICIAN_PROMPTS = [
  "Explain the Colombo interpretation",
  "Differential diagnoses?",
  "Dosing guidance for PE",
];

export function AskAtom({ report, viewerRole }: AskAtomProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AtomMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const prompts = viewerRole === "clinician" ? CLINICIAN_PROMPTS : PATIENT_PROMPTS;

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: AtomMessage = { role: "user", content: text.trim() };
    const next = [...messages, userMsg].slice(-10);
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const res = await apiRequest("POST", "/api/ask-atom", {
        messages: next,
        report,
        viewerRole,
      });
      const data = await res.json();
      if (data.success && data.message) {
        const assistantMsg: AtomMessage = {
          role: "assistant",
          content: data.message,
          citations: data.citations ?? [],
        };
        setMessages(prev => [...prev, assistantMsg].slice(-10));
      } else {
        throw new Error(data.error || "No response");
      }
    } catch {
      const errMsg: AtomMessage = {
        role: "assistant",
        content: "I'm having trouble connecting right now. Please try again in a moment.",
      };
      setMessages(prev => [...prev, errMsg].slice(-10));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating button */}
      <motion.button
        onClick={() => setOpen(o => !o)}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.95 }}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full flex items-center justify-center shadow-xl z-50 group"
        style={{
          background: "linear-gradient(135deg, hsl(185 85% 35%), hsl(185 85% 48%))",
          boxShadow: "0 0 24px hsl(185 85% 42% / 0.45), 0 4px 16px hsl(0 0% 0% / 0.4)",
        }}
        title="Ask Atom"
        data-testid="ask-atom-button"
        aria-label="Ask Atom"
      >
        <AtomLogo size={26} color="white" />
        {/* Tooltip */}
        <span className="absolute bottom-full mb-2 right-0 text-xs font-medium px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
          style={{ background: "hsl(210 18% 12%)", border: "1px solid hsl(210 15% 20%)" }}>
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
            className="fixed bottom-24 right-6 w-[340px] sm:w-[380px] rounded-2xl flex flex-col overflow-hidden z-50"
            style={{
              height: "min(560px, calc(100vh - 120px))",
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
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-card/80 transition-colors"
                data-testid="ask-atom-close"
                aria-label="Close"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
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
                    Ask about {viewerRole === "patient" ? "your results, symptoms, or what to discuss with your doctor" : "this patient's findings, Colombo methodology, or treatment options"}.
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

              {messages.map((msg, i) => (
                <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "assistant" && (
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{ background: "hsl(185 85% 42% / 0.15)" }}
                    >
                      <AtomLogo size={14} color="hsl(185 85% 55%)" />
                    </div>
                  )}
                  <div className={`max-w-[80%] ${msg.role === "user" ? "" : "space-y-1"}`}>
                    <div
                      className="px-3 py-2 rounded-xl text-xs leading-relaxed"
                      style={
                        msg.role === "user"
                          ? { background: "hsl(185 85% 42%)", color: "white", borderRadius: "14px 14px 4px 14px" }
                          : { background: "hsl(210 18% 13%)", border: "1px solid hsl(210 15% 18%)", borderRadius: "4px 14px 14px 14px" }
                      }
                    >
                      {msg.content}
                    </div>
                    {msg.citations && msg.citations.length > 0 && (
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
                          >
                            [{ci + 1}]
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex items-center gap-2 justify-start">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: "hsl(185 85% 42% / 0.15)" }}>
                    <AtomLogo size={14} color="hsl(185 85% 55%)" />
                  </div>
                  <div className="flex gap-1 px-3 py-2.5 rounded-xl"
                    style={{ background: "hsl(210 18% 13%)", border: "1px solid hsl(210 15% 18%)" }}>
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
              <div ref={messagesEndRef} />
            </div>

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
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                placeholder={viewerRole === "patient" ? "Ask about your results…" : "Ask about this patient…"}
                disabled={loading}
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50 min-w-0"
                data-testid="ask-atom-input"
                style={{ color: "hsl(200 20% 92%)" }}
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={loading || !input.trim()}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:scale-105 disabled:opacity-40"
                style={{ background: "hsl(185 85% 42%)" }}
                data-testid="ask-atom-send"
                aria-label="Send"
              >
                <Send className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
