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
import { useCallback, useRef, useState } from "react";
import { FileText, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

interface VendorMetric {
  key: string;
  label: string;
  value: number;
  unit: string | null;
}

interface VendorResponse {
  success: boolean;
  textExtracted?: boolean;
  looksLikeVendorReport?: boolean;
  metrics?: VendorMetric[];
  metricCount?: number;
  note?: string;
  error?: string;
}

interface Props {
  /** Called with the ingested vendor metrics so the parent can merge them. */
  onIngested?: (metrics: VendorMetric[]) => void;
}

export function VendorPdfCard({ onIngested }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<VendorResponse | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setStatus("loading");
    setResult(null);
    try {
      const form = new FormData();
      form.append("vendorPdf", file);
      const res = await fetch("/api/upload-vendor", { method: "POST", body: form });
      const json: VendorResponse = await res.json();
      setResult(json);
      if (json.success && json.metrics && json.metrics.length > 0) {
        onIngested?.(json.metrics);
        setStatus("done");
      } else {
        // Success:true with 0 metrics (e.g. scanned PDF) is not an error — it's
        // an honest "nothing to ingest" outcome.
        setStatus(json.success ? "done" : "error");
      }
    } catch (e: any) {
      setResult({ success: false, error: e?.message || "Upload failed" });
      setStatus("error");
    }
  }, [onIngested]);

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
        The raw <span className="ps-text-mono">.ans</span> file can't reproduce the vendor's spectral
        (LFa/RFa) or blood-pressure values. Attach the signed P&amp;S report to import those
        <span className="font-medium text-foreground/80"> verbatim</span> — they'll be labelled as
        vendor-reported. Skipping this keeps those metrics gated as "not assessed".
      </p>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={status === "loading"}
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs uppercase tracking-[0.14em] border border-border/50 hover:bg-card/80 disabled:opacity-50 transition-colors"
        data-testid="vendor-pdf-select"
      >
        {status === "loading" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
        {status === "loading" ? "Reading PDF…" : "Attach vendor PDF"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        data-testid="vendor-pdf-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />

      {result && status === "done" && result.metrics && result.metrics.length > 0 && (
        <div className="mt-4" data-testid="vendor-pdf-metrics">
          <div className="flex items-center gap-2 text-xs text-emerald-400 mb-2">
            <CheckCircle2 className="w-4 h-4" />
            {result.metrics.length} vendor-reported metric(s) imported
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
    </div>
  );
}
