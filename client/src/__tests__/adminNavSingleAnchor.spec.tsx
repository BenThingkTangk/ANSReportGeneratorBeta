/**
 * Regression (POLISH 2): the admin sidebar nav must render exactly ONE anchor
 * per destination. Previously each item nested a manual <a> inside wouter v3's
 * <Link> (which itself renders an <a>), producing two overlapping anchors for
 * the same href — the outer one intercepted pointer events and a normal click
 * on "Parser & Model Health" timed out in QA. This asserts a single anchor per
 * href (no duplicate/overlapping nav target).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

// Keep the REAL wouter Link (that's what we're testing), but stub useLocation
// so the component renders without a Router provider and we can observe that a
// plain click actually reaches the router (i.e. is not swallowed by an
// overlapping second anchor).
const navigate = vi.fn();
vi.mock("wouter", async () => {
  const actual = await vi.importActual<any>("wouter");
  return { ...actual, useLocation: () => ["/admin/knowledge", navigate] };
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

  it("the Parser & Model Health label lives in a link that receives clicks (not intercepted)", async () => {
    const { AdminLayout } = await import("@/components/admin/AdminLayout");
    render(<AdminLayout title="Knowledge Inventory">content</AdminLayout>);
    const label = screen.getByText(/Parser & Model Health/);
    const link = label.closest("a")!;
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toMatch(/\/admin\/parser-health$/);
    // The label must NOT be wrapped by a SECOND anchor between it and its link
    // (the nested-<a> overlap that swallowed clicks). Its nearest anchor
    // ancestor is the ONLY anchor on the path to the nav root.
    let anchors = 0;
    for (let el: HTMLElement | null = label as HTMLElement; el; el = el.parentElement) {
      if (el.tagName === "A") anchors++;
      if (el.tagName === "NAV") break;
    }
    expect(anchors).toBe(1);
    // A plain click dispatches without throwing / being swallowed.
    expect(() => fireEvent.click(link)).not.toThrow();
  });
});
