/**
 * api/_ans/embeddings.ts
 *
 * SERVER-ONLY embedding generation for the knowledge RAG pipeline.
 *
 * Provider: Perplexity Embeddings API (`POST https://api.perplexity.ai/v1/embeddings`)
 * — the same account/credential the app already uses for Ask ATOM
 * (`PPLX_API_KEY`), so no new provider or secret is introduced. The key is read
 * from the environment inside this module and is NEVER returned to a caller,
 * logged, or shipped to the client; only vectors and counts leave here.
 *
 * Model choice: `pplx-embed-v1-0.6b` → 1024 dimensions. Rationale:
 *   • 1024 dims keeps the pgvector column small enough for an HNSW/IVFFlat index
 *     (pgvector indexes cap at 2000 dims, so the 2560-dim 4b model could not be
 *     indexed without Matryoshka truncation);
 *   • cheapest tier ($0.004/1M tokens) for a corpus of curated passages;
 *   • same family for documents and queries, so vectors are comparable.
 * Override with EMBEDDING_MODEL / EMBEDDING_DIMENSIONS only if the DB column and
 * every stored vector are migrated together — mixing dimensions breaks search.
 *
 * IMPORTANT (documented provider behaviour): Perplexity returns each embedding as
 * a BASE64-ENCODED signed int8 buffer (`encoding_format: "base64_int8"`), not a
 * float array, and the vectors are UNNORMALISED. We decode base64 → Int8Array →
 * number[] and L2-normalise before storage so cosine similarity (pgvector `<=>`)
 * is well behaved and comparable across rows.
 *
 * This module NEVER touches .ans parsing or any clinical calculation. It only
 * turns knowledge text into vectors.
 */

const EMBEDDINGS_URL = "https://api.perplexity.ai/v1/embeddings";

/** Default model + dimensionality. Keep in sync with the DB vector(N) column. */
export const DEFAULT_EMBEDDING_MODEL = "pplx-embed-v1-0.6b";
export const DEFAULT_EMBEDDING_DIMENSIONS = 1024;

/** Provider hard limits (documented): ≤512 inputs and ≤120k tokens per request. */
const MAX_INPUTS_PER_REQUEST = 96; // conservative: also bounds per-request tokens
const MAX_CHARS_PER_INPUT = 24_000; // ~8k tokens, well under the 32k ctx limit

export interface EmbeddingConfig {
  model: string;
  dimensions: number;
}

export function embeddingConfig(): EmbeddingConfig {
  const model = (process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL).trim();
  const raw = parseInt(process.env.EMBEDDING_DIMENSIONS ?? "", 10);
  const dimensions = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_EMBEDDING_DIMENSIONS;
  return { model, dimensions };
}

/** True when an embedding provider credential is configured server-side. */
export function isEmbeddingConfigured(): boolean {
  return Boolean((process.env.PPLX_API_KEY || "").trim());
}

export class EmbeddingUnavailableError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "EmbeddingUnavailableError";
  }
}

/** Decode a base64 signed-int8 payload into a plain number[]. */
export function decodeBase64Int8(b64: string): number[] {
  const buf = Buffer.from(b64, "base64");
  const out = new Array<number>(buf.length);
  for (let i = 0; i < buf.length; i++) {
    // Buffer bytes are unsigned; reinterpret as signed int8.
    const v = buf[i];
    out[i] = v > 127 ? v - 256 : v;
  }
  return out;
}

/**
 * L2-normalise so cosine distance is stable. Perplexity embeddings are
 * explicitly unnormalised; a zero vector is returned unchanged (never NaN).
 */
export function l2Normalize(vec: number[]): number[] {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum);
  if (!Number.isFinite(norm) || norm === 0) return vec.slice();
  return vec.map((v) => v / norm);
}

/** Coerce a provider embedding entry (base64 string OR float array) to number[]. */
function toVector(entry: unknown): number[] | null {
  if (typeof entry === "string") {
    const v = decodeBase64Int8(entry);
    return v.length ? l2Normalize(v) : null;
  }
  if (Array.isArray(entry) && entry.every((n) => typeof n === "number")) {
    return entry.length ? l2Normalize(entry as number[]) : null;
  }
  return null;
}

function normalizeInput(text: string): string {
  // Collapse whitespace and bound length; blank strings are rejected by the API.
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > MAX_CHARS_PER_INPUT ? t.slice(0, MAX_CHARS_PER_INPUT) : t;
}

/**
 * Embed a batch of texts. Returns one vector per input, in the SAME order.
 * A blank input yields `null` in that slot (never a fabricated vector).
 *
 * Throws EmbeddingUnavailableError when the provider is unconfigured or the call
 * fails — callers are expected to degrade to lexical retrieval rather than block.
 */
export async function embedTexts(
  texts: string[],
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<Array<number[] | null>> {
  if (texts.length === 0) return [];
  const apiKey = (process.env.PPLX_API_KEY || "").trim();
  if (!apiKey) {
    throw new EmbeddingUnavailableError(
      "Embedding provider is not configured (PPLX_API_KEY missing).",
    );
  }
  const { model, dimensions } = embeddingConfig();
  const doFetch = opts.fetchImpl ?? fetch;

  const results: Array<number[] | null> = new Array(texts.length).fill(null);

  // Only non-blank inputs are sent; blanks stay null.
  const indexed = texts
    .map((t, i) => ({ i, text: normalizeInput(t) }))
    .filter((e) => e.text.length > 0);

  for (let start = 0; start < indexed.length; start += MAX_INPUTS_PER_REQUEST) {
    const batch = indexed.slice(start, start + MAX_INPUTS_PER_REQUEST);
    let res: Response;
    try {
      res = await doFetch(EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: batch.map((b) => b.text),
          encoding_format: "base64_int8",
          dimensions,
        }),
        signal: opts.signal,
      });
    } catch (e: any) {
      throw new EmbeddingUnavailableError(
        `Embedding request failed: ${e?.message ?? String(e)}`,
      );
    }
    if (!res.ok) {
      // Never echo the response body verbatim — it can contain request context.
      throw new EmbeddingUnavailableError(
        `Embedding provider returned HTTP ${res.status}`,
        res.status,
      );
    }
    let json: any;
    try {
      json = await res.json();
    } catch {
      throw new EmbeddingUnavailableError("Embedding provider returned invalid JSON");
    }
    const data = Array.isArray(json?.data) ? json.data : [];
    for (const row of data) {
      const idx = typeof row?.index === "number" ? row.index : -1;
      const target = batch[idx];
      if (!target) continue;
      const vec = toVector(row?.embedding);
      if (!vec) continue;
      if (vec.length !== dimensions) {
        throw new EmbeddingUnavailableError(
          `Embedding dimension mismatch: got ${vec.length}, expected ${dimensions}. ` +
            "The DB vector column and EMBEDDING_DIMENSIONS must agree.",
        );
      }
      results[target.i] = vec;
    }
  }
  return results;
}

/** Embed a single query string; returns null when the text is blank. */
export async function embedQuery(
  text: string,
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<number[] | null> {
  const [v] = await embedTexts([text], opts);
  return v ?? null;
}

/** Format a vector as a pgvector literal, e.g. "[0.1,0.2]". */
export function toPgVectorLiteral(vec: number[]): string {
  return `[${vec.map((v) => (Number.isFinite(v) ? v : 0)).join(",")}]`;
}
