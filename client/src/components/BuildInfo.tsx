import { useEffect, useState } from "react";

/**
 * Tiny build-info badge in the footer. Shows the exact commit + build time
 * of the bundle the user has loaded. Useful for verifying the browser isn't
 * serving a stale cached build after a deploy.
 *
 * Click to expand and fetch live /api/health for server-side commit too,
 * so you can confirm client+server are in sync.
 */
export function BuildInfo() {
  const [expanded, setExpanded] = useState(false);
  const [serverInfo, setServerInfo] = useState<null | {
    commitShortSha: string | null;
    buildTime: string | null;
    region: string | null;
    node: string;
    env: string;
  }>(null);
  const [loading, setLoading] = useState(false);

  const clientSha = typeof __BUILD_COMMIT_SHORT__ !== "undefined" ? __BUILD_COMMIT_SHORT__ : "dev";
  const clientTime = typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : "dev";

  useEffect(() => {
    if (!expanded || serverInfo || loading) return;
    setLoading(true);
    fetch("/api/health", { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        setServerInfo({
          commitShortSha: d?.deploy?.commitShortSha ?? null,
          buildTime: d?.deploy?.buildTime ?? null,
          region: d?.deploy?.region ?? null,
          node: d?.runtime?.node ?? "?",
          env: d?.deploy?.env ?? "?",
        });
      })
      .catch(() => setServerInfo({ commitShortSha: null, buildTime: null, region: null, node: "?", env: "error" }))
      .finally(() => setLoading(false));
  }, [expanded, serverInfo, loading]);

  const inSync =
    serverInfo?.commitShortSha && clientSha !== "dev"
      ? serverInfo.commitShortSha === clientSha
      : null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 8,
        right: 8,
        zIndex: 50,
        fontFamily: "var(--ps-font-mono, ui-monospace, SFMono-Regular, monospace)",
        fontSize: 10,
        color: "var(--color-text-muted, #64748b)",
        background: "rgba(0,0,0,0.35)",
        border: "1px solid var(--border, rgba(255,255,255,0.08))",
        borderRadius: 6,
        padding: "4px 8px",
        backdropFilter: "blur(6px)",
        cursor: "pointer",
        userSelect: "none",
        maxWidth: 320,
      }}
      onClick={() => setExpanded(e => !e)}
      title="Click for full build/deploy info"
    >
      build {clientSha}
      {expanded && (
        <div style={{ marginTop: 6, lineHeight: 1.4 }}>
          <div>client: {clientSha} @ {clientTime.slice(0, 19)}</div>
          {loading && <div>fetching /api/health…</div>}
          {serverInfo && (
            <>
              <div>
                server: {serverInfo.commitShortSha ?? "—"} · {serverInfo.env} · {serverInfo.region ?? "?"} · node {serverInfo.node}
              </div>
              {inSync === false && (
                <div style={{ color: "var(--color-status-risk, #ef4444)", marginTop: 4 }}>
                  ⚠ client/server commit mismatch — hard-reload (Cmd+Shift+R)
                </div>
              )}
              {inSync === true && (
                <div style={{ color: "var(--color-status-optimal, #22c55e)", marginTop: 4 }}>
                  ✓ client/server in sync
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
