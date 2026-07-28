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
import { FileText, CheckCircle2, AlertCircle, Loader2, ScanText } from "lucide-react";
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
  looksLikeVendorReport?: boolean;
  metrics?: VendorMetric[];
  metricCount?: number;
  findingCount?: number;
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
  /** True while ≥1 selected PDF is still being read/OCR'd. Lets the parent
   *  disable "Generate Report" until every document has finished so the report
   *  is never generated on a half-merged vendor state. */
  onProcessingChange?: (processing: boolean) => void;
}

/**
 * Does an extraction carry ANY vendor-reported content worth merging?
 *
 * The signed categorical SUMMARY yields tabular identity fields (fieldCount>0),
 * but Dr. Colombo's consultation LETTER is a narrative text-layer PDF with NO
 * grid — its Sympathovagal Balance (SB=2.59) lives ONLY in
 * narrative.printedNumbers. A `fieldCount > 0` gate therefore silently dropped
 * the letter, so the merged state never contained SB. Accept a document when it
 * has ANY tabular field OR any narrative finding OR any prose-printed number.
 */
function extractionHasContent(x: VendorReportExtraction | undefined): boolean {
  if (!x) return false;
  return (
    (x.fieldCount ?? 0) > 0 ||
    (x.narrative?.findings?.length ?? 0) > 0 ||
    (x.narrative?.printedNumbers?.length ?? 0) > 0
  );
}

/** Per-document processing status, shown so the clinician sees each file land. */
interface DocStatus {
  fileName: string;
  state: "processing" | "done" | "empty" | "error";
  source?: "text" | "ocr" | "none";
  metricCount?: number;
  findingCount?: number;
  note?: string;
}

export function VendorPdfCard({ onIngested, onExtraction, onProcessingChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<VendorResponse | null>(null);
  const [docStatuses, setDocStatuses] = useState<DocStatus[]>([]);

  const handleOneFile = useCallback(async (file: File): Promise<{ json: VendorResponse; doc: DocStatus }> => {
    const form = new FormData();
    form.append("vendorPdf", file);
    const res = await fetch("/api/upload-vendor", { method: "POST", body: form });
    const json: VendorResponse = await res.json();
    // Emit per-file extraction + metrics so the parent can cumulatively merge
    // multiple documents (letter + signed report) rather than replace. Emit on
    // ANY vendor content, not just tabular fieldCount — see extractionHasContent.
    let emitted = false;
    if (json.success && extractionHasContent(json.extraction)) {
      onExtraction?.(json.extraction!, {
        source: json.source === "ocr" ? "ocr" : json.source === "text" ? "text" : undefined,
        ocrConfidence: json.ocrConfidence,
        fileName: file.name,
      });
      emitted = true;
    }
    if (json.success && json.metrics && json.metrics.length > 0) {
      onIngested?.(json.metrics);
    }
    const doc: DocStatus = {
      fileName: file.name,
      state: !json.success ? "error" : emitted ? "done" : "empty",
      source: json.source,
      metricCount: json.metricCount ?? json.metrics?.length ?? 0,
      findingCount: json.findingCount ?? json.extraction?.narrative?.findings?.length ?? 0,
      note: json.note ?? json.error,
    };
    return { json, doc };
  }, [onIngested, onExtraction]);

  const handleFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setStatus("loading");
    setResult(null);
    onProcessingChange?.(true);
    // Seed a "processing" row per file so the clinician sees every selected
    // document immediately (not just the last one to complete).
    setDocStatuses(files.map((f) => ({ fileName: f.name, state: "processing" as const })));
    let last: VendorResponse | null = null;
    try {
      // Process sequentially so the parent's cumulative ref-merge is
      // deterministic and no late completion can clobber an earlier one.
      for (const f of files) {
        const { json, doc } = await handleOneFile(f);
        last = json;
        setDocStatuses((prev) => prev.map((d) => (d.fileName === doc.fileName ? doc : d)));
      }
      setResult(last);
      setStatus(last?.success ? "done" : "error");
    } catch (e: any) {
      setResult({ success: false, error: e?.message || "Upload failed" });
      setStatus("error");
      setDocStatuses((prev) => prev.map((d) => (d.state === "processing" ? { ...d, state: "error", note: e?.message } : d)));
    } finally {
      // Only clear the processing gate once EVERY file has settled.
      onProcessingChange?.(false);
    }
  }, [handleOneFile, onProcessingChange]);

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

      {/* Accessible file control: a real <label> wraps the button styling and
          points at a focusable sr-only input (not display:none), so it is
          keyboard-operable, in the a11y tree, and automatable. */}
      <label
        htmlFor="vendor-pdf-input"
        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs uppercase tracking-[0.14em] border border-border/50 hover:bg-card/80 transition-colors cursor-pointer ${status === "loading" ? "opacity-50 pointer-events-none" : ""}`}
        data-testid="vendor-pdf-select"
        tabIndex={0}
        role="button"
        aria-label="Attach paired vendor PDF report(s)"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        {status === "loading" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
        {status === "loading" ? "Reading PDF…" : "Attach vendor PDF(s)"}
      </label>
      <input
        ref={inputRef}
        id="vendor-pdf-input"
        name="vendorPdf"
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="sr-only"
        disabled={status === "loading"}
        data-testid="vendor-pdf-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) void handleFiles(files);
          // Reset so re-selecting the same file(s) re-triggers change.
          e.target.value = "";
        }}
      />

      {/* Per-document status — one row per selected PDF, so a single change
          event with the letter + report shows BOTH landing (not just the last
          one). Each row reflects text/OCR source and what was read. */}
      {docStatuses.length > 0 && (
        <ul className="mt-4 space-y-1.5" data-testid="vendor-pdf-doc-statuses">
          {docStatuses.map((d) => (
            <li
              key={d.fileName}
              className="flex items-start gap-2 text-xs"
              data-testid={`vendor-pdf-doc-${d.state}`}
            >
              {d.state === "processing" && <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-300 shrink-0 mt-0.5" />}
              {d.state === "done" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />}
              {(d.state === "empty" || d.state === "error") && <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />}
              <span className="min-w-0">
                <span className="font-medium text-foreground/90 break-all">{d.fileName}</span>
                {d.state === "processing" && <span className="text-muted-foreground"> — reading…</span>}
                {d.state === "done" && (
                  <span className="text-muted-foreground">
                    {" "}— {d.source === "ocr" ? "OCR" : "text layer"} · {d.metricCount ?? 0} metric(s) · {d.findingCount ?? 0} finding(s)
                  </span>
                )}
                {d.state === "empty" && <span className="text-amber-400/90"> — nothing ingested</span>}
                {d.state === "error" && <span className="text-amber-400/90"> — {d.note || "failed"}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

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
    </div>
  );
}
