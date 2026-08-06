import { afterEach, describe, expect, it } from "vitest";
import { summarizeCorpusCounts } from "../../_knowledgeCache.js";

const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

afterEach(() => {
  if (originalUrl == null) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
});

describe("knowledge corpus status", () => {
  it("reports a healthy non-empty corpus only after both counts succeed", () => {
    const status = summarizeCorpusCounts(
      { count: 11, error: null },
      { count: 768, error: null },
    );
    expect(status).toEqual({
      activeSources: 11,
      totalChunks: 768,
      ragFunctional: true,
      databaseReachable: true,
      failureKind: null,
    });
  });

  it("does not misreport an invalid credential as an empty corpus", () => {
    process.env.SUPABASE_URL = "https://ztwmpskhslmctjbopaiv.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "configured-but-invalid";
    const unauthorized = {
      message: "Invalid API key",
      status: 401,
    };
    const status = summarizeCorpusCounts(
      { count: null, error: unauthorized },
      { count: null, error: unauthorized },
    );
    expect(status.ragFunctional).toBe(false);
    expect(status.databaseReachable).toBe(false);
    expect(status.failureKind).toBe("unauthorized");
    expect(status.activeSources).toBe(0);
    expect(status.totalChunks).toBe(0);
  });
});
