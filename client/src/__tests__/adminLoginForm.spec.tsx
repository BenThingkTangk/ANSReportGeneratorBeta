/**
 * Admin login form — rendering + interaction smoke (jsdom).
 *
 * Verifies the username/password form the admin console now uses (no magic-link
 * UI): required fields + labels, password reveal toggle, error state on a
 * rejected login, and a successful login calling POST /api/admin/login. Network
 * is mocked; no real credentials or backend.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

// wouter's useLocation → stable no-op navigate so the component can render
// standalone without a Router provider.
const navigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/admin/login", navigate],
}));

import AdminLoginPage from "@/components/AdminGatewayLoginPage";

const realFetch = global.fetch;

beforeEach(() => {
  navigate.mockReset();
  // Default: session probe (GET) says unauthenticated so the form shows.
  global.fetch = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    if (u.includes("/api/admin/session")) {
      return { ok: true, json: async () => ({ success: true, configured: true, authenticated: false, username: null }) } as any;
    }
    if (u.includes("/api/admin/login")) {
      const body = JSON.parse(init.body);
      const ok = body.username === "admin" && body.password === "right";
      return {
        ok,
        json: async () => (ok ? { success: true, authenticated: true } : { success: false, error: "Invalid username or password" }),
      } as any;
    }
    return { ok: true, json: async () => ({}) } as any;
  }) as any;
});
afterEach(() => { cleanup(); global.fetch = realFetch; });

describe("AdminLoginPage — username/password form", () => {
  it("renders username + password fields, a submit button, and no magic-link UI", async () => {
    render(<AdminLoginPage />);
    expect(await screen.findByTestId("admin-login-username")).toBeTruthy();
    expect(screen.getByTestId("admin-login-password")).toBeTruthy();
    expect(screen.getByTestId("admin-login-submit")).toBeTruthy();
    expect(screen.getByTestId("admin-login-password-toggle")).toBeTruthy();
    // Accessible labels present (exact, so the "Show password" toggle's
    // aria-label doesn't collide with the Password field label).
    expect(screen.getByLabelText("Username")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    // No magic-link / email affordances remain.
    expect(screen.queryByText(/magic link/i)).toBeNull();
    expect(screen.queryByText(/check your email/i)).toBeNull();
    expect(screen.queryByText(/email address/i)).toBeNull();
  });

  it("toggles password visibility with the reveal button", async () => {
    render(<AdminLoginPage />);
    const pw = (await screen.findByTestId("admin-login-password")) as HTMLInputElement;
    expect(pw.type).toBe("password");
    fireEvent.click(screen.getByTestId("admin-login-password-toggle"));
    expect(pw.type).toBe("text");
    fireEvent.click(screen.getByTestId("admin-login-password-toggle"));
    expect(pw.type).toBe("password");
  });

  it("shows an error when the server rejects the credentials", async () => {
    render(<AdminLoginPage />);
    fireEvent.change(await screen.findByTestId("admin-login-username"), { target: { value: "admin" } });
    fireEvent.change(screen.getByTestId("admin-login-password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByTestId("admin-login-submit"));
    const err = await screen.findByTestId("admin-login-error");
    expect(err.textContent).toMatch(/invalid username or password/i);
    expect(navigate).not.toHaveBeenCalledWith("/admin/knowledge");
  });

  it("submits correct credentials to /api/admin/login and navigates in", async () => {
    render(<AdminLoginPage />);
    fireEvent.change(await screen.findByTestId("admin-login-username"), { target: { value: "admin" } });
    fireEvent.change(screen.getByTestId("admin-login-password"), { target: { value: "right" } });
    fireEvent.click(screen.getByTestId("admin-login-submit"));
    await waitFor(() =>
      expect((global.fetch as any).mock.calls.some((c: any[]) => String(c[0]).includes("/api/admin/login"))).toBe(true),
    );
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/admin/knowledge"));
  });
});
