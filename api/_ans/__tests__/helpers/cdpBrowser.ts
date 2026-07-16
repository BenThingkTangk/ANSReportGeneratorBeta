/**
 * Minimal Chrome DevTools Protocol driver for browser-LEVEL layout assertions.
 *
 * Why this exists: jsdom (the client vitest env) has NO layout engine, so a
 * "does the element carry class X" test is FALSE ASSURANCE for touch-target
 * sizing — it cannot see that the computed min-width/height stayed `auto` and
 * the measured hit box is still 32×32. Real Playwright at 390×844 caught that.
 *
 * This helper launches the Chromium that Playwright caches under
 * ~/.cache/ms-playwright (no @playwright/test dependency needed), emulates a
 * coarse-pointer touch viewport, loads an HTML string, and returns real
 * getBoundingClientRect() measurements — the exact thing that failed.
 *
 * It degrades gracefully: findChromium() returns null when no browser is
 * present (e.g. CI), so callers can `it.skipIf(!chrome)` and never break the
 * pipeline while still running locally and in any browser-provisioned env.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import WebSocket from "ws";

/** Locate a usable Chromium binary from the Playwright cache, or null. */
export function findChromium(): string | null {
  const root = join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(root)) return null;
  const candidates: string[] = [];
  for (const dir of readdirSync(root)) {
    if (dir.startsWith("chromium-")) {
      candidates.push(join(root, dir, "chrome-linux64", "chrome"));
      candidates.push(join(root, dir, "chrome-linux", "chrome"));
    }
  }
  return candidates.find((p) => existsSync(p)) ?? null;
}

export interface Viewport {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  mobile?: boolean;
  touch?: boolean;
}

export class CdpBrowser {
  private proc!: ChildProcess;
  private ws!: WebSocket;
  private id = 0;
  private pending = new Map<number, (v: any) => void>();
  private sessionId = "";

  constructor(private readonly chromePath: string) {}

  async launch(): Promise<void> {
    this.proc = spawn(
      this.chromePath,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--remote-debugging-port=0",
        `--user-data-dir=/tmp/cdp-a11y-${process.pid}-${this.id}`,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    const wsUrl = await new Promise<string>((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("Chromium did not expose a DevTools endpoint")), 15_000);
      this.proc.stderr!.on("data", (d: Buffer) => {
        const m = String(d).match(/ws:\/\/[^\s]+/);
        if (m) { clearTimeout(to); resolve(m[0]); }
      });
      this.proc.on("exit", () => { clearTimeout(to); reject(new Error("Chromium exited before ready")); });
    });
    this.ws = new WebSocket(wsUrl);
    await new Promise<void>((r) => this.ws.on("open", () => r()));
    this.ws.on("message", (raw: Buffer) => {
      const m = JSON.parse(String(raw));
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)!(m.result); this.pending.delete(m.id); }
    });
    const { targetId } = await this.root("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.root("Target.attachToTarget", { targetId, flatten: true });
    this.sessionId = sessionId;
    await this.session("Page.enable");
    await this.session("Runtime.enable");
  }

  private root(method: string, params: any = {}): Promise<any> {
    const i = ++this.id;
    return new Promise((res) => { this.pending.set(i, res); this.ws.send(JSON.stringify({ id: i, method, params })); });
  }
  private session(method: string, params: any = {}): Promise<any> {
    const i = ++this.id;
    return new Promise((res) => { this.pending.set(i, res); this.ws.send(JSON.stringify({ id: i, sessionId: this.sessionId, method, params })); });
  }

  async emulate(v: Viewport): Promise<void> {
    await this.session("Emulation.setDeviceMetricsOverride", {
      width: v.width, height: v.height,
      deviceScaleFactor: v.deviceScaleFactor ?? 3,
      mobile: v.mobile ?? true,
    });
    if (v.touch ?? true) {
      await this.session("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    }
  }

  async setContent(html: string): Promise<void> {
    await this.session("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(html) });
    // Allow layout to settle.
    await new Promise((r) => setTimeout(r, 350));
  }

  /** Evaluate JS in the page and return its (JSON-serializable) value. */
  async evaluate<T = any>(expression: string): Promise<T> {
    const { result, exceptionDetails } = await this.session("Runtime.evaluate", {
      returnByValue: true,
      expression,
    });
    if (exceptionDetails) throw new Error(`page eval failed: ${exceptionDetails.text}`);
    return result.value as T;
  }

  async close(): Promise<void> {
    try { this.ws?.close(); } catch { /* ignore */ }
    try { this.proc?.kill("SIGKILL"); } catch { /* ignore */ }
  }
}
