/**
 * Regression (POLISH 2): the admin sidebar nav must render exactly ONE anchor
 * per destination. Previously each item nested a manual <a> inside wouter v3's
 * <Link> (which itself renders an <a>), producing two overlapping anchors for
 * the same href — the outer one intercepted pointer events and a normal click
 * on "Parser & Model Health" timed out in QA. This asserts a single anchor per
 * href (no duplicate/overlapping nav target).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Keep the REAL wouter Link (that's what we're testing), but stub useLocation
// so the component renders without a Router provider.
vi.mock("wouter", async () => {
  const actual = await vi.importActual<any>("wouter");
  return { ...actual, useLocation: () => ["/admin/knowledge", vi.fn()] };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ email: "admin@example.com", role: "super_admin", signOut: vi.fn() }),
}));

afterEach(() => cleanup());

describe("AdminLayout sidebar nav — single anchor per destination", () => {
  it("renders exactly one <a href='#/admin/parser-health'> (no overlapping duplicate)", async () => {
    const { AdminLayout } = await import("@/components/admin/AdminLayout");
    render(<AdminLayout title="Knowledge Inventory">content</AdminLayout>);

    // wouter hash routing renders href="#/admin/parser-health".
    const parserLinks = Array.from(
      document.querySelectorAll('a[href="#/admin/parser-health"], a[href="/admin/parser-health"]'),
    );
    expect(parserLinks).toHaveLength(1);
    expect((parserLinks[0].textContent ?? "")).toMatch(/Parser & Model Health/);
  });

  it("renders no nested <a> inside another <a> anywhere in the nav", async () => {
    const { AdminLayout } = await import("@/components/admin/AdminLayout");
    render(<AdminLayout title="Knowledge Inventory">content</AdminLayout>);
    const nestedAnchors = document.querySelectorAll("a a");
    expect(nestedAnchors).toHaveLength(0);
  });
});
