/**
 * Resilient upload helper for /api/parse and /api/upload.
 *
 * Features:
 *   - AbortController-based timeout (default 60s)
 *   - One automatic retry on network failure or 5xx
 *   - Captures `x-vercel-id` for support / debugging
 *   - Structured telemetry logged to console (and pluggable handler)
 *   - Surfaces server `{error, stage}` JSON without throwing on non-2xx,
 *     so callers can render the actual failure reason
 */

export interface UploadAttempt {
  endpoint: string;
  attempt: number;
  durationMs: number;
  status: number;
  ok: boolean;
  vercelId: string | null;
  error?: string;
  stage?: string;
}

export interface UploadResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  stage?: string;
  vercelId: string | null;
  attempts: UploadAttempt[];
  totalMs: number;
}

export interface UploadOptions {
  /** Field name for the file. Default: "ansFile" */
  fieldName?: string;
  /** Hard timeout per attempt in ms. Default: 60000 */
  timeoutMs?: number;
  /** Retry once on 5xx or network error. Default: true */
  retry?: boolean;
  /** Optional telemetry sink. Default: console.info */
  onTelemetry?: (event: UploadAttempt) => void;
  /** Optional progress sink — fired on upload progress when available */
  onProgress?: (pct: number) => void;
  /** Extra request headers (e.g. x-vendor-metrics for paired vendor-PDF values). */
  headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT = 60_000;

async function singleAttempt<T>(
  endpoint: string,
  file: File,
  attempt: number,
  opts: Required<Pick<UploadOptions, "fieldName" | "timeoutMs" | "onTelemetry">> & { headers?: Record<string, string> },
): Promise<{ result: UploadResult<T>; canRetry: boolean }> {
  const startedAt = performance.now();
  const fd = new FormData();
  fd.append(opts.fieldName, file);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  let status = 0;
  let vercelId: string | null = null;
  let data: T | null = null;
  let error: string | undefined;
  let stage: string | undefined;
  let canRetry = false;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      body: fd,
      signal: controller.signal,
      credentials: "same-origin",
      headers: opts.headers,
    });
    status = res.status;
    vercelId = res.headers.get("x-vercel-id");
    const body = await res.json().catch(() => null);
    data = body as T;
    if (!res.ok) {
      error = (body as { error?: string } | null)?.error ?? `HTTP ${status}`;
      stage = (body as { stage?: string } | null)?.stage;
      canRetry = status >= 500 && status < 600;
    }
  } catch (err) {
    const e = err as Error;
    const aborted = e?.name === "AbortError";
    error = aborted ? `request timed out after ${opts.timeoutMs}ms` : (e?.message || "network error");
    canRetry = true; // network/timeout — try once more
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Math.round(performance.now() - startedAt);
  const ok = status >= 200 && status < 300 && !error;
  const event: UploadAttempt = {
    endpoint,
    attempt,
    durationMs,
    status,
    ok,
    vercelId,
    error,
    stage,
  };
  opts.onTelemetry(event);

  return {
    result: {
      ok,
      status,
      data,
      error,
      stage,
      vercelId,
      attempts: [event],
      totalMs: durationMs,
    },
    canRetry,
  };
}

export async function resilientUpload<T = unknown>(
  endpoint: string,
  file: File,
  options: UploadOptions = {},
): Promise<UploadResult<T>> {
  const opts = {
    fieldName: options.fieldName ?? "ansFile",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT,
    onTelemetry:
      options.onTelemetry ??
      ((evt) => {
        // eslint-disable-next-line no-console
        console.info("[upload]", JSON.stringify(evt));
      }),
    headers: options.headers,
  };

  const start = performance.now();
  const first = await singleAttempt<T>(endpoint, file, 1, opts);
  if (first.result.ok || !first.canRetry || options.retry === false) {
    first.result.totalMs = Math.round(performance.now() - start);
    return first.result;
  }

  // Retry once
  const second = await singleAttempt<T>(endpoint, file, 2, opts);
  const totalMs = Math.round(performance.now() - start);
  return {
    ok: second.result.ok,
    status: second.result.status,
    data: second.result.data,
    error: second.result.error,
    stage: second.result.stage,
    vercelId: second.result.vercelId,
    attempts: [...first.result.attempts, ...second.result.attempts],
    totalMs,
  };
}
