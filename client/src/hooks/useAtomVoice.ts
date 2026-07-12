import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import {
  getSpeechRecognitionCtor,
  sanitizeForSpeech,
  speechSynthesisSupported,
  type SpeechRecognitionLike,
} from "@/lib/speech";

interface UseAtomVoiceOptions {
  /** Fires as speech is transcribed. `isFinal` marks the settled result. */
  onTranscript?: (text: string, isFinal: boolean) => void;
  lang?: string;
}

/**
 * Voice controls for Ask Atom.
 *
 * - Listening: explicit-click browser speech-to-text (Web Speech API). No audio
 *   is captured until the user presses the mic.
 * - Speaking: server-only ElevenLabs TTS (/api/tts). If that route is missing,
 *   unconfigured, or errors, it transparently falls back to the browser's
 *   SpeechSynthesis so the feature keeps working.
 * - The caller passes already-sanitized text plus PHI terms; text is sanitized
 *   again here and only the cleaned string is sent to the server.
 */
export function useAtomVoice({ onTranscript, lang = "en-US" }: UseAtomVoiceOptions = {}) {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  /** true once a server TTS attempt fell back to the browser voice (for UI hinting). */
  const [usedFallback, setUsedFallback] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  // Bumped on every stop/new request so a slow in-flight synthesis can't play after Stop.
  const speakSeqRef = useRef(0);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const supportsListening = getSpeechRecognitionCtor() !== null;
  // TTS always has *a* path: the server voice, or the browser fallback.
  const supportsSpeaking = true;

  // --- Speaking (TTS) -------------------------------------------------------

  const stopSpeaking = useCallback(() => {
    speakSeqRef.current++; // invalidate any in-flight synthesis
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    if (speechSynthesisSupported()) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speakViaBrowser = useCallback((text: string) => {
    if (!speechSynthesisSupported()) {
      setSpeaking(false);
      return;
    }
    setUsedFallback(true);
    const u = new SpeechSynthesisUtterance(text);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }, []);

  const speak = useCallback(
    async (rawText: string, redactTerms: string[] = []) => {
      const text = sanitizeForSpeech(rawText, redactTerms);
      if (!text) return;

      stopSpeaking(); // resets state + bumps the sequence
      const seq = speakSeqRef.current;
      const controller = new AbortController();
      ttsAbortRef.current = controller;
      setUsedFallback(false);
      setSpeaking(true);

      try {
        // Server-only ElevenLabs: send sanitized text ONLY — never the report.
        const res = await apiRequest("POST", "/api/tts", { text }, undefined, controller.signal);
        if (seq !== speakSeqRef.current) return; // stopped or superseded while fetching

        const type = res.headers.get("Content-Type") || "";
        if (!type.includes("audio")) throw new Error("Unexpected TTS response");

        const blob = await res.blob();
        if (seq !== speakSeqRef.current) return;

        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;

        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => stopSpeaking();
        audio.onerror = () => stopSpeaking();
        await audio.play();
      } catch {
        if (seq !== speakSeqRef.current) return; // user stopped — don't fall back
        // Fallback: browser speech synthesis (unconfigured key, offline, etc.).
        speakViaBrowser(text);
      }
    },
    [speakViaBrowser, stopSpeaking],
  );

  // --- Listening (STT) ------------------------------------------------------

  const stopListening = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* no-op */
      }
    }
  }, []);

  const startListening = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    // Tear down any prior session first.
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        /* no-op */
      }
      recognitionRef.current = null;
    }

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => setListening(true);
    rec.onresult = (e) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const txt = result[0]?.transcript ?? "";
        if (result.isFinal) final += txt;
        else interim += txt;
      }
      if (final) onTranscriptRef.current?.(final, true);
      else if (interim) onTranscriptRef.current?.(interim, false);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }, [lang]);

  const toggleListening = useCallback(() => {
    if (listening) stopListening();
    else startListening();
  }, [listening, startListening, stopListening]);

  // Cleanup any in-flight session / audio on unmount.
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          /* no-op */
        }
      }
      stopSpeaking();
    };
  }, [stopSpeaking]);

  return {
    supportsListening,
    supportsSpeaking,
    listening,
    speaking,
    usedFallback,
    startListening,
    stopListening,
    toggleListening,
    speak,
    stopSpeaking,
  };
}
