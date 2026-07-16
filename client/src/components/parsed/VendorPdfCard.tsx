/**
 * VendorPdfCard — optional paired vendor-report ingestion.
 *
 * The raw .ans recording cannot reproduce the vendor's proprietary spectral
 * aggregates (LFa/RFa/SB) or per-phase cuff BP; those live only in the signed
 * P&S vendor PDF. This card lets a clinician attach that PDF so its verbatim
 * values are read (server-side, tagged `vendor_reported`) and surfaced here.
 *
 * It is intentionally additive and non-blocking: skipping it leaves the report
 * exactly as-is (honest "not assessed" gates). It never fabricates values —
 * the server only returns numbers printed in the vendor's own text.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, CheckCircle2, AlertCircle, Loader2, ScanText, X } from "lucide-react";
import type { VendorReportExtraction } from "@shared/vendorExtraction";

interface VendorMetric {
  key: string;
  label: string;
  value: number;
  unit: string | null;
}

interface VendorResponse {
  success: boolean;
  textExtracted?: boolean;
  ocrUsed?: boolean;
  source?: "text" | "ocr" | "none";
  ocrConfidence?: number;
  pageCount?: number;
  timedOut?: boolean;
  looksLikeVendorReport?: boolean;
  metrics?: VendorMetric[];
  metricCount?: number;
  extraction?: VendorReportExtraction;
  note?: string;
  error?: string;
}

interface Props {
  /** Called with the ingested vendor metrics so the parent can merge them. */
  onIngested?: (metrics: VendorMetric[]) => void;
  /** Called with the full structured extraction (drives the Vendor-Familiar view). */
  onExtraction?: (
    extraction: VendorReportExtraction,
    meta: { source?: "ocr" | "text"; ocrConfidence?: number; fileName: string },
  ) => void;
  /**
   * Notifies the parent whenever extraction is in-flight, so it can BLOCK
   * "Generate Report" until the vendor PDF finishes, is cancelled, or removed.
   * Prevents generating a report from a half-read attachment.
   */
  onBusyChange?: (busy: boolean) => void;
}

/**
 * Client-side hard timeout. The server bounds OCR at ~90s; give the round-trip a
 * little more headroom before the client gives up and offers a retry. Keeps the
 * UI from hanging forever if the network/socket wedges. (The UI stays responsive
 * throughout — this only decides when to stop waiting.)
 */
const CLIENT_TIMEOUT_MS = 105_000;

type Status = "idle" | "reading" | "ocr" | "done" | "error" | "cancelled";

export function VendorPdfCard({ onIngested, onExtraction, onBusyChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<VendorResponse | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const busy = status === "reading" || status === "ocr";
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  const clearTimers = useCallback(() => {
    if (stageTimerRef.current) { clearTimeout(stageTimerRef.current); stageTimerRef.current = null; }
    if (timeoutTimerRef.current) { clearTimeout(timeoutTimerRef.current); timeoutTimerRef.current = null; }
  }, []);

  // Abort any in-flight request if the component unmounts.
  useEffect(() => () => { abortRef.current?.abort(); clearTimers(); }, [clearTimers]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    clearTimers();
    setStatus("cancelled");
    setResult(null);
    setFileName(null);
  }, [clearTimers]);

  const remove = useCallback(() => {
    setStatus("idle");
    setResult(null);
    setFileName(null);
    onIngested?.([]);
  }, [onIngested]);

  const handleFile = useCallback(async (file: File) => {
    // Fresh controller per attempt.
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    clearTimers();
    setResult(null);
    setFileName(file.name);
    setStatus("reading");
    // After a short delay still "reading", switch the label to OCR so the user
    // sees progress rather than a frozen "Reading PDF…". (The server decides the
    // real path; this is purely a progressive UI hint.)
    stageTimerRef.current = setTimeout(() => {
      setStatus((s) => (s === "reading" ? "ocr" : s));
    }, 2_500);
    // Client-side hard timeout → abort + retry affordance.
    timeoutTimerRef.current = setTimeout(() => ac.abort("timeout"), CLIENT_TIMEOUT_MS);

    try {
      const form = new FormData();
      form.append("vendorPdf", file);
      const res = await fetch("/api/upload-vendor", { method: "POST", body: form, signal: ac.signal });
      const json: VendorResponse = await res.json();
      clearTimers();
      if (abortRef.current !== ac) return; // superseded/cancelled
      setResult(json);
      if (json.success && json.extraction && json.extraction.fieldCount > 0) {
        onExtraction?.(json.extraction, {
          source: json.source === "ocr" ? "ocr" : json.source === "text" ? "text" : undefined,
          ocrConfidence: json.ocrConfidence,
          fileName: file.name,
        });
      }
      if (json.success && json.metrics && json.metrics.length > 0) {
        onIngested?.(json.metrics);
        setStatus("done");
      } else {
        // Success:true with 0 metrics (e.g. OCR could not resolve anything) is
        // not an error — it's an honest "nothing to ingest" outcome.
        setStatus(json.success ? "done" : "error");
      }
    } catch (e: any) {
      clearTimers();
      if (ac.signal.aborted) {
        // User cancel or client timeout — not an error state to keep values from.
        if (abortRef.current === ac || abortRef.current === null) {
          setStatus("cancelled");
          setResult(e === "timeout" || ac.signal.reason === "timeout"
            ? { success: false, error: "Timed out reading the PDF. Please retry or attach a text-based report." }
            : null);
          setFileName(null);
        }
        return;
      }
      setResult({ success: false, error: e?.message || "Upload failed" });
      setStatus("error");
    }
  }, [onIngested, onExtraction, clearTimers]);

  return (
    <div
      className="rounded-2xl bg-card/50 border border-border/30 p-5"
      data-testid="vendor-pdf-card"
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        <h3 className="text-xs tracking-[0.15em] uppercase text-muted-foreground font-medium">
          Optional — attach vendor report (PDF)
        </h3>
        <span className="text-[10px] text-muted-foreground/70">vendor_reported</span>
      </div>
      <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
        The raw <span className="ps-text-mono">.ans</span> file's spectral (LFa/RFa) and
        blood-pressure values are the vendor's proprietary wavelet output. Attach the signed
        P&amp;S report to import those <span className="font-medium text-foreground/80">verbatim</span> —
        they'll be labelled vendor-reported and unlock the Vendor-Familiar view. Scanned
        (image-only) reports are read with on-device <span className="inline-flex items-center gap-1"><ScanText className="w-3 h-3" />OCR</span>;
        values the scan can't resolve stay "not assessed" rather than being guessed.
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="touch-target flex items-center gap-2 px-3 py-2 rounded-lg text-xs uppercase tracking-[0.14em] border border-border/50 hover:bg-card/80 disabled:opacity-50 transition-colors"
          data-testid="vendor-pdf-select"
          aria-busy={busy}
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
          {status === "reading" ? "Reading PDF…"
            : status === "ocr" ? "Scanning (OCR)…"
            : "Attach vendor PDF"}
        </button>
        {busy && (
          <button
            type="button"
            onClick={cancel}
            className="touch-target flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs uppercase tracking-[0.14em] border border-border/50 hover:bg-card/80 transition-colors"
            data-testid="vendor-pdf-cancel"
            aria-label="Cancel PDF extraction"
          >
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
        )}
        {!busy && status === "done" && fileName && (
          <button
            type="button"
            onClick={remove}
            className="touch-target flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs uppercase tracking-[0.14em] border border-border/50 hover:bg-card/80 transition-colors"
            data-testid="vendor-pdf-remove"
            aria-label="Remove attached vendor PDF"
          >
            <X className="w-3.5 h-3.5" /> Remove
          </button>
        )}
      </div>
      {busy && (
        <p className="mt-2 text-[11px] text-muted-foreground" data-testid="vendor-pdf-progress" role="status" aria-live="polite">
          {status === "reading"
            ? `Reading ${fileName ?? "PDF"} — extracting the text layer…`
            : `Scanning ${fileName ?? "PDF"} with on-device OCR — this can take a moment. You can cancel and generate the report without it.`}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        data-testid="vendor-pdf-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          // Allow re-selecting the same file after a cancel/remove.
          e.target.value = "";
        }}
      />

      {result && status === "done" && result.metrics && result.metrics.length > 0 && (
        <div className="mt-4" data-testid="vendor-pdf-metrics">
          <div className="flex items-center gap-2 text-xs text-emerald-400 mb-2 flex-wrap">
            <CheckCircle2 className="w-4 h-4" />
            {result.metrics.length} vendor-reported metric(s) imported
            {result.source === "ocr" && (
              <span className="inline-flex items-center gap-1 text-[10px] text-cyan-300/90 px-1.5 py-0.5 rounded-full border border-cyan-500/30">
                <ScanText className="w-3 h-3" /> OCR{typeof result.ocrConfidence === "number" ? ` · scan ${result.ocrConfidence}%` : ""}
              </span>
            )}
            {result.source === "text" && (
              <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded-full border border-border/40">text layer</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {result.metrics.map((m) => (
              <div key={m.key} className="text-xs rounded-lg border border-border/30 px-3 py-2">
                <div className="text-muted-foreground">{m.label}</div>
                <div className="font-medium text-foreground/90">
                  {m.value}{m.unit ? ` ${m.unit}` : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result && (status === "done" || status === "error") && (!result.metrics || result.metrics.length === 0) && (
        <div className="mt-4 flex items-start gap-2 text-xs text-amber-400/90" data-testid="vendor-pdf-note">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{result.note || result.error || "Nothing was ingested."}</span>
        </div>
      )}

      {status === "cancelled" && (
        <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground" data-testid="vendor-pdf-cancelled">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {result?.error
              ? result.error
              : "Extraction cancelled — no vendor values were imported. You can attach again or generate the report without the vendor PDF."}
          </span>
        </div>
      )}
    </div>
  );
}
