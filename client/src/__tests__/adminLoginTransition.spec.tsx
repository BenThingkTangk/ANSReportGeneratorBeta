/**
 * Admin login → authenticated route rendering (regression).
 *
 * Production bug: after a correct login (login 200, session 200) the admin route
 * body rendered nothing but the build-hash footer; content only appeared after a
 * manual reload. Root cause: `useAuth` was a per-component hook, so the login
 * form's instance authenticated but the destination route's AdminGuard mounted a
 * SEPARATE instance that had to re-probe /api/admin/session — a race that a
 * reload masked. Fix: shared auth state via <AuthProvider>.
 *
 * This test reproduces the FULL flow (not just the handler callback): it renders
 * the real <AuthProvider> + real wouter router with the real login page and an
 * AdminGuard-protected route, submits correct credentials, and asserts the
 * guarded admin content appears WITHOUT any reload. It fails on the old
 * per-hook implementation and passes with the shared provider.
 *
 * Network is mocked; no real backend/credentials.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Router, Route, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { AuthProvider } from "@/hooks/AuthProvider";
import AdminLoginPage from "@/components/AdminGatewayLoginPage";
import { AdminGuard } from "@/components/admin/AdminGuard";

const realFetch = global.fetch;

// Server double. `sessionProbeCount` lets a test make the SECOND probe (the one
// the destination route's guard would fire on the old per-hook implementation)
// hang forever — reproducing the production race. With shared auth state, no
// second probe is needed after login, so guarded content renders immediately;
// with per-component hooks, the destination guard would stay stuck on its
// pending probe and never render (the reported "only build-hash" symptom).
let authed = false;
let sessionProbeCount = 0;
let holdSessionAfterFirst = false;
beforeEach(() => {
  authed = false;
  sessionProbeCount = 0;
  holdSessionAfterFirst = false;
  global.fetch = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    if (u.includes("/api/admin/session")) {
      sessionProbeCount += 1;
      if (holdSessionAfterFirst && sessionProbeCount > 1) {
        // Never resolves — a fresh (per-hook) consumer would hang on this.
        return await new Promise(() => {}) as any;
      }
      return { ok: true, json: async () => ({ success: true, configured: true, authenticated: authed, username: authed ? "admin" : null }) } as any;
    }
    if (u.includes("/api/admin/login")) {
      const body = JSON.parse(init.body);
      const ok = body.username === "admin" && body.password === "right";
      if (ok) authed = true;
      return { ok, json: async () => (ok ? { success: true, authenticated: true } : { success: false, error: "Invalid username or password" }) } as any;
    }
    if (u.includes("/api/admin/logout")) { authed = false; return { ok: true, json: async () => ({ success: true }) } as any; }
    return { ok: true, json: async () => ({}) } as any;
  }) as any;
});
afterEach(() => { cleanup(); global.fetch = realFetch; });

/** Minimal app: /admin/login → form; /admin/knowledge → guarded sentinel. */
function TestApp({ initialPath = "/admin/login" }: { initialPath?: string }) {
  const { hook } = memoryLocation({ path: initialPath });
  return (
    <AuthProvider>
      <Router hook={hook}>
        <Switch>
          <Route path="/admin/login" component={AdminLoginPage} />
          <Route path="/admin/knowledge">
            <AdminGuard>
              <div data-testid="knowledge-loaded">Knowledge Inventory</div>
            </AdminGuard>
          </Route>
        </Switch>
      </Router>
    </AuthProvider>
  );
}

describe("admin login → authenticated route (no reload)", () => {
  it("shows guarded admin content immediately after a correct submit", async () => {
    // Make any SECOND session probe hang. Shared auth state means the
    // destination guard reads the already-authenticated store and never needs a
    // fresh probe → content renders. A per-component hook would fire (and hang
    // on) that second probe → stuck, reproducing the production "no content
    // until reload" bug. This makes the test FAIL on the old implementation.
    holdSessionAfterFirst = true;
    render(<TestApp />);

    // Login form is shown (unauthenticated).
    fireEvent.change(await screen.findByTestId("admin-login-username"), { target: { value: "admin" } });
    fireEvent.change(screen.getByTestId("admin-login-password"), { target: { value: "right" } });
    fireEvent.click(screen.getByTestId("admin-login-submit"));

    // Without any reload, the guarded content must appear — proving shared auth
    // state propagated to the destination route's AdminGuard.
    await waitFor(() => expect(screen.getByTestId("knowledge-loaded")).toBeTruthy());
    // And the AdminGuard's own wrapper is present (children rendered, not the
    // login form or an empty body).
    expect(screen.getByTestId("admin-content")).toBeTruthy();
    expect(screen.queryByTestId("admin-login-form")).toBeNull();
  });

  it("keeps a directly-loaded guarded route gated until the session resolves, then renders it", async () => {
    // Pre-authenticate at the server so the initial probe returns authenticated.
    authed = true;
    render(<TestApp initialPath="/admin/knowledge" />);
    // After the async session probe resolves, content appears (no reload).
    await waitFor(() => expect(screen.getByTestId("knowledge-loaded")).toBeTruthy());
  });

  it("a wrong submit does not navigate and keeps showing the form with an error", async () => {
    render(<TestApp />);
    fireEvent.change(await screen.findByTestId("admin-login-username"), { target: { value: "admin" } });
    fireEvent.change(screen.getByTestId("admin-login-password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByTestId("admin-login-submit"));
    expect((await screen.findByTestId("admin-login-error")).textContent).toMatch(/invalid/i);
    expect(screen.queryByTestId("knowledge-loaded")).toBeNull();
  });
});
