import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import ttsHandler from "../../tts.js";

/**
 * TTS voice selection + upstream-failure behavior.
 *
 * Complements ttsContract.spec.ts (the pre-flight guards). Here we stub the
 * outbound fetch so we can prove, without a network:
 *   - the server sends the ENV-configured ELEVENLABS_VOICE_ID to ElevenLabs
 *     (the client can never pick the voice);
 *   - the xi-api-key is attached server-side and never echoed to the caller;
 *   - a successful synthesis is returned as audio/mpeg with no-store caching;
 *   - an ElevenLabs error surfaces as a safe 502 (→ client browser fallback).
 */
function mockRes() {
  const res: any = {
    _status: 200,
    _json: undefined as any,
    _sent: undefined as any,
    _headers: {} as Record<string, string>,
    status(c: number) { this._status = c; return this; },
    json(p: any) { this._json = p; return this; },
    send(p: any) { this._sent = p; return this; },
    setHeader(k: string, v: any) { this._headers[String(k)] = String(v); return this; },
    end() { return this; },
  };
  return res;
}
function mockReq(body: any, ip: string): any {
  return { method: "POST", body, headers: { "x-forwarded-for": ip } };
}

describe("TTS — env voice id + upstream failure", () => {
  const prevKey = process.env.ELEVENLABS_API_KEY;
  const prevVoice = process.env.ELEVENLABS_VOICE_ID;

  beforeEach(() => {
    process.env.ELEVENLABS_API_KEY = "server-only-key";
    process.env.ELEVENLABS_VOICE_ID = "env-voice-777";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (prevKey === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = prevKey;
    if (prevVoice === undefined) delete process.env.ELEVENLABS_VOICE_ID; else process.env.ELEVENLABS_VOICE_ID = prevVoice;
  });

  it("synthesizes via the env voice id and returns audio/mpeg (key never leaked)", async () => {
    let seenUrl = "";
    let seenHeaders: any = {};
    const fetchMock = vi.fn(async (url: any, init: any) => {
      seenUrl = String(url);
      seenHeaders = init?.headers ?? {};
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer } as any;
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = mockRes();
    await ttsHandler(mockReq({ text: "Your results look stable." }, "198.51.100.1"), res);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(seenUrl).toContain("/env-voice-777");
    // The secret key is sent to ElevenLabs but must not appear in our response.
    expect(seenHeaders["xi-api-key"]).toBe("server-only-key");
    expect(res._status).toBe(200);
    expect(res._headers["Content-Type"]).toBe("audio/mpeg");
    expect(res._headers["Cache-Control"]).toBe("no-store");
    const serialized = JSON.stringify(res._json ?? "") + JSON.stringify(res._headers);
    expect(serialized).not.toContain("server-only-key");
  });

  it("returns 502 when ElevenLabs responds with an error (→ browser fallback)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "upstream boom",
    }) as any);
    vi.stubGlobal("fetch", fetchMock);

    const res = mockRes();
    await ttsHandler(mockReq({ text: "Hello there." }, "198.51.100.2"), res);
    expect(res._status).toBe(502);
    expect(res._json.success).toBe(false);
  });
});
