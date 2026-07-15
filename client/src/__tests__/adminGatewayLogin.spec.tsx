/**
 * Admin sign-in UI — username + password ONLY.
 *
 * Verifies the production acceptance failure is fixed: the console no longer
 * shows the old Supabase magic-link "admin email" step. Instead the gateway
 * login renders a username + password form that POSTs /api/admin/gateway,
 * surfaces a generic error on failure, and enters the console on success.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/admin/login", navigate],
}));

function stubFetch(impl: (url: string, init: any) => Promise<any>) {
  vi.stubGlobal("fetch", vi.fn((url: any, init: any) => impl(String(url), init ?? {})));
}

async function renderLogin() {
  const { default: AdminGatewayLoginPage } = await import("../components/AdminGatewayLoginPage");
  return render(<AdminGatewayLoginPage />);
}

describe("AdminGatewayLoginPage — credential sign-in", () => {
  beforeEach(() => navigate.mockClear());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders username + password fields and NO magic-link/email step", async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ configured: true, authenticated: false }) }));
    const { getByTestId, findByTestId, container, queryByText } = await renderLogin();

    await findByTestId("gw-username");
    expect(getByTestId("gw-username").getAttribute("type")).toBe("text");
    expect(getByTestId("gw-password").getAttribute("type")).toBe("password");
    expect(getByTestId("admin-login-submit").textContent).toMatch(/sign in/i);

    // The retired magic-link flow must be gone: no email field, no "magic link".
    expect(container.querySelector('input[type="email"]')).toBeNull();
    expect(queryByText(/magic link/i)).toBeNull();
    expect(queryByText(/admin email/i)).toBeNull();
  });

  it("shows a generic error on invalid credentials (no enumeration)", async () => {
    stubFetch(async (_url, init) => {
      if (init.method === "POST") {
        return { ok: false, status: 401, json: async () => ({ error: "Invalid username or password" }) };
      }
      return { ok: true, json: async () => ({ configured: true, authenticated: false }) };
    });
    const { getByTestId, findByTestId } = await renderLogin();
    await findByTestId("gw-username");

    fireEvent.change(getByTestId("gw-username"), { target: { value: "admin" } });
    fireEvent.change(getByTestId("gw-password"), { target: { value: "wrong-pass" } });
    fireEvent.click(getByTestId("admin-login-submit"));

    const err = await findByTestId("admin-login-error");
    expect(err.textContent).toMatch(/invalid username or password/i);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("enters the console on a successful sign-in", async () => {
    stubFetch(async (_url, init) => {
      if (init.method === "POST") return { ok: true, json: async () => ({ success: true }) };
      return { ok: true, json: async () => ({ configured: true, authenticated: false }) };
    });
    const { getByTestId, findByTestId } = await renderLogin();
    await findByTestId("gw-username");

    fireEvent.change(getByTestId("gw-username"), { target: { value: "admin" } });
    fireEvent.change(getByTestId("gw-password"), { target: { value: "correct-pass" } });
    fireEvent.click(getByTestId("admin-login-submit"));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/admin/knowledge"));
  });

  it("surfaces a clear diagnostic when the server gateway is not configured", async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ configured: false, authenticated: false }) }));
    const { findByTestId } = await renderLogin();
    expect(await findByTestId("gateway-not-configured")).toBeTruthy();
  });
});
