/**
 * /admin/knowledge/upload — Drag-drop PDF upload
 */
import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { AdminGuard } from "@/components/admin/AdminGuard";
import { useAuth } from "@/hooks/useAuth";

const MAX_SIZE_MB = 25;

export default function KnowledgeUploadPage() {
  const { session } = useAuth();
  const [, navigate] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ source_id: string; chunkCount: number } | null>(null);

  const handleFile = useCallback((f: File) => {
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`File exceeds ${MAX_SIZE_MB} MB limit`);
      return;
    }
    setFile(f);
    setError(null);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  }, [title]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }

  async function handleUpload() {
    if (!file || !title.trim() || !session?.access_token) return;
    setUploading(true);
    setProgress(10);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", title);

      setProgress(30);

      const res = await fetch("/api/admin/knowledge/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      });

      setProgress(80);
      const json = await res.json();
      setProgress(100);

      if (!json.success) throw new Error(json.error);
      setResult({ source_id: json.source_id, chunkCount: json.chunkCount });
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  if (result) {
    return (
      <AdminGuard>
        <AdminLayout title="Upload Complete">
          <div
            className="ps-glass p-8 max-w-sm text-center"
            style={{ borderRadius: 16 }}
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)" }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M20 6L9 17L4 12" stroke="var(--color-status-optimal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h2 className="ps-text-display" style={{ color: "var(--color-text-primary)", fontSize: 18, marginBottom: 8 }}>
              Upload Successful
            </h2>
            <p style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 4 }}>
              {result.chunkCount} chunk{result.chunkCount !== 1 ? "s" : ""} created for RAG indexing.
            </p>
            <p className="ps-text-mono" style={{ fontSize: 10, color: "var(--color-text-muted)", marginBottom: 20 }}>
              {result.source_id}
            </p>
            <button
              className="ps-cta"
              style={{ width: "100%", justifyContent: "center" }}
              onClick={() => navigate(`/admin/knowledge/${result.source_id}`)}
            >
              View Source →
            </button>
          </div>
        </AdminLayout>
      </AdminGuard>
    );
  }

  return (
    <AdminGuard>
      <AdminLayout title="Upload Knowledge File">
        <div style={{ maxWidth: 540 }}>
          <p style={{ color: "var(--color-text-secondary)", fontSize: 13, marginBottom: 24 }}>
            Upload a PDF or text file to create a new knowledge source. Files up to {MAX_SIZE_MB} MB.
            Text will be extracted and chunked for future RAG retrieval.
          </p>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? "var(--color-brand-cyan)" : "rgba(0,229,255,0.2)"}`,
              borderRadius: 14,
              padding: "48px 24px",
              textAlign: "center",
              cursor: "pointer",
              background: dragOver ? "rgba(0,229,255,0.04)" : "transparent",
              transition: "all 160ms",
              marginBottom: 20,
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              style={{ margin: "0 auto 12px", display: "block" }}
            >
              <path
                d="M21 15V19C21 20.1 20.1 21 19 21H5C3.9 21 3 20.1 3 19V15"
                stroke="var(--color-brand-cyan)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <path
                d="M17 8L12 3L7 8"
                stroke="var(--color-brand-cyan)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M12 3V15"
                stroke="var(--color-brand-cyan)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            {file ? (
              <div>
                <p style={{ color: "var(--color-text-primary)", fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
                  {file.name}
                </p>
                <p style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            ) : (
              <div>
                <p style={{ color: "var(--color-text-secondary)", fontSize: 14 }}>
                  Drag & drop a PDF or text file here
                </p>
                <p style={{ color: "var(--color-text-muted)", fontSize: 12, marginTop: 4 }}>
                  or click to browse
                </p>
              </div>
            )}
          </div>

          {/* Title field */}
          <div style={{ marginBottom: 20 }}>
            <label
              style={{
                display: "block",
                fontSize: 10,
                color: "var(--color-text-muted)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                fontFamily: "var(--ps-font-mono)",
                marginBottom: 6,
              }}
            >
              Source Title *
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title for this knowledge source"
              style={{
                width: "100%",
                background: "rgba(10,17,29,0.8)",
                border: "1px solid rgba(0,229,255,0.18)",
                borderRadius: 8,
                padding: "10px 14px",
                color: "var(--color-text-primary)",
                fontSize: 13,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {error && (
            <div
              style={{
                padding: "10px 16px",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.2)",
                borderRadius: 8,
                color: "var(--color-status-critical)",
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              {error}
            </div>
          )}

          {/* Progress */}
          {uploading && (
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  height: 4,
                  background: "rgba(255,255,255,0.08)",
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${progress}%`,
                    background: "var(--color-brand-cyan)",
                    borderRadius: 2,
                    transition: "width 200ms",
                  }}
                />
              </div>
              <p style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 6 }}>
                {progress < 80 ? "Uploading…" : "Processing…"}
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              className="ps-cta"
              onClick={handleUpload}
              disabled={!file || !title.trim() || uploading}
              style={{
                opacity: !file || !title.trim() || uploading ? 0.5 : 1,
                cursor: !file || !title.trim() || uploading ? "not-allowed" : "pointer",
              }}
            >
              {uploading ? "Uploading…" : "Upload & Process"}
            </button>
            <a
              href="/admin/knowledge"
              style={{
                padding: "12px 20px",
                borderRadius: 4,
                border: "1px solid rgba(100,116,139,0.3)",
                color: "var(--color-text-muted)",
                fontSize: 14,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              Cancel
            </a>
          </div>
        </div>
      </AdminLayout>
    </AdminGuard>
  );
}
