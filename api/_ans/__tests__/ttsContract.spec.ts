import { describe, it, expect, beforeEach, afterEach } from "vitest";
import ttsHandler from "../../tts.js";

/**
 * TTS endpoint contract: PHI safety + graceful browser-fallback signalling.
 * We drive the real handler with a minimal mock req/res — no network. The
 * ElevenLabs call itself only fires when a key is configured; these cases
 * exercise the guards that run BEFORE any outbound call.
 */
function mockRes() {
  const res: any = {
    _status: 200,
    _json: undefined as any,
    _sent: undefined as any,
    status(c: number) { this._status = c; return this; },
    json(p: any) { this._json = p; return this; },
    send(p: any) { this._sent = p; return this; },
    setHeader() { return this; },
    end() { return this; },
  };
  return res;
}
function mockReq(method: string, body: any): any {
  return { method, body, headers: {} };
}

describe("TTS endpoint contract", () => {
  const prevKey = process.env.ELEVENLABS_API_KEY;
  beforeEach(() => { delete process.env.ELEVENLABS_API_KEY; });
  afterEach(() => { if (prevKey === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = prevKey; });

  it("returns 501 (→ browser fallback) when no server key is configured", async () => {
    const res = mockRes();
    await ttsHandler(mockReq("POST", { text: "hello" }), res);
    expect(res._status).toBe(501);
    expect(res._json.success).toBe(false);
  });

  it("hard-rejects a report / PHI payload before any synthesis (key present)", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key";
    const res = mockRes();
    await ttsHandler(mockReq("POST", { text: "hi", report: { patientData: {} } }), res);
    expect(res._status).toBe(400);
    expect(res._json.error).toMatch(/PHI|report/i);
  });

  it("rejects empty text (key present) rather than calling out", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key";
    const res = mockRes();
    await ttsHandler(mockReq("POST", { text: "   " }), res);
    expect(res._status).toBe(400);
  });

  it("rejects non-POST methods", async () => {
    const res = mockRes();
    await ttsHandler(mockReq("GET", {}), res);
    expect(res._status).toBe(405);
  });
});
