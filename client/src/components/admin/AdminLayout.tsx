/**
 * AdminLayout — cinematic deep-navy side nav + content area.
 * Nav: Knowledge Inventory, Knowledge Library, App Change Requests, Audit Log.
 * Role badge in sidebar footer.
 */
import React from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  superAdminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    label: "Knowledge Inventory",
    href: "/admin/knowledge",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M4 6H20M4 10H20M4 14H14M4 18H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    label: "Add Source",
    href: "/admin/knowledge/new",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    label: "Upload PDF",
    href: "/admin/knowledge/upload",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M21 15V19C21 20.1 20.1 21 19 21H5C3.9 21 3 20.1 3 19V15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M17 8L12 3L7 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M12 3V15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    label: "Change Requests",
    href: "/admin/change-requests",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M9 5H7C5.9 5 5 5.9 5 7V19C5 20.1 5.9 21 7 21H17C18.1 21 19 20.1 19 19V7C19 5.9 18.1 5 17 5H15" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M9 5C9 3.9 9.9 3 11 3H13C14.1 3 15 3.9 15 5V7H9V5Z" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M9 12H15M9 16H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    label: "Submit Request",
    href: "/admin/change-requests/new",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    label: "Audit Log",
    href: "/admin/audit",
    superAdminOnly: true,
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M9 12L11 14L15 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M21 12C21 16.97 16.97 21 12 21C7.03 21 3 16.97 3 12C3 7.03 7.03 3 12 3C16.97 3 21 7.03 21 12Z" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
  },
  {
    label: "Accuracy Lab",
    href: "/admin/accuracy-lab",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M4 19H20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M7 16L10 10L13 14L17 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
];

const ROLE_COLORS: Record<string, string> = {
  super_admin: "var(--color-brand-violet)",
  clinical_admin: "var(--color-brand-cyan)",
  reviewer: "var(--color-status-watch)",
  viewer: "var(--color-text-muted)",
};

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  clinical_admin: "Clinical Admin",
  reviewer: "Reviewer",
  viewer: "Viewer",
};

interface AdminLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export function AdminLayout({ children, title }: AdminLayoutProps) {
  const { email, role, signOut } = useAuth();
  const [location] = useLocation();

  const roleColor = role ? (ROLE_COLORS[role] ?? "var(--color-text-muted)") : "var(--color-text-muted)";
  const roleLabel = role ? (ROLE_LABELS[role] ?? role) : "Unknown";
  const isSuperAdmin = role === "super_admin";

  return (
    <div
      className="flex min-h-screen"
      style={{
        background: "var(--color-bg-void)",
        backgroundImage: "var(--gradient-hero-orbit)",
        backgroundAttachment: "fixed",
      }}
    >
      {/* Sidebar */}
      <aside
        style={{
          width: 240,
          minHeight: "100vh",
          background: "linear-gradient(180deg, rgba(10,17,29,0.98), rgba(6,10,16,0.98))",
          borderRight: "1px solid rgba(210,235,255,0.08)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
        }}
      >
        {/* Logo */}
        <div style={{ padding: "24px 20px 16px" }}>
          <div className="ps-overline mb-1" style={{ fontSize: 9 }}>
            PhysioPS × HumanOS
          </div>
          <div
            className="ps-text-display"
            style={{
              color: "var(--color-brand-cyan)",
              fontSize: 15,
              lineHeight: 1.2,
            }}
          >
            Admin Console
          </div>
        </div>

        <div
          style={{
            height: 1,
            background: "rgba(210,235,255,0.07)",
            margin: "0 20px 12px",
          }}
        />

        {/* Nav items */}
        <nav style={{ padding: "0 12px", flex: 1 }}>
          {NAV_ITEMS.filter((item) => !item.superAdminOnly || isSuperAdmin).map((item) => {
            const isActive = location === item.href || location.startsWith(item.href + "/");
            return (
              <Link key={item.href} href={item.href}>
                <a
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 12px",
                    borderRadius: 8,
                    marginBottom: 2,
                    textDecoration: "none",
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 400,
                    color: isActive
                      ? "var(--color-brand-cyan)"
                      : "var(--color-text-secondary)",
                    background: isActive ? "rgba(0,229,255,0.08)" : "transparent",
                    border: isActive
                      ? "1px solid rgba(0,229,255,0.18)"
                      : "1px solid transparent",
                    transition: "all 160ms ease",
                  }}
                >
                  <span
                    style={{
                      color: isActive ? "var(--color-brand-cyan)" : "var(--color-text-muted)",
                      flexShrink: 0,
                    }}
                  >
                    {item.icon}
                  </span>
                  {item.label}
                </a>
              </Link>
            );
          })}
        </nav>

        {/* Footer — role badge + sign out */}
        <div
          style={{
            padding: "16px 20px",
            borderTop: "1px solid rgba(210,235,255,0.07)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: roleColor,
                boxShadow: `0 0 8px ${roleColor}`,
                flexShrink: 0,
              }}
            />
            <span
              className="ps-text-mono"
              style={{ fontSize: 10, color: roleColor, letterSpacing: "0.08em" }}
            >
              {roleLabel}
            </span>
          </div>
          {email && (
            <p
              className="ps-text-mono truncate"
              style={{
                fontSize: 10,
                color: "var(--color-text-muted)",
                marginBottom: 10,
              }}
              title={email}
            >
              {email}
            </p>
          )}
          <button
            onClick={() => signOut()}
            style={{
              fontSize: 11,
              color: "var(--color-text-muted)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              textDecoration: "underline",
            }}
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, padding: "32px 36px", overflowY: "auto" }}>
        {title && (
          <div style={{ marginBottom: 28 }}>
            <div className="ps-overline mb-1">Admin Console</div>
            <h1
              className="ps-text-display"
              style={{ color: "var(--color-text-primary)", fontSize: 24 }}
            >
              {title}
            </h1>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
