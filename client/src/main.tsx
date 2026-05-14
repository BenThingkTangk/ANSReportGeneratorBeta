import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import getSupabase from "./lib/supabase";

/**
 * Bootstrap auth callback handling BEFORE React mounts.
 *
 * Supabase magic-link / OAuth redirects land here as one of:
 *   • PKCE flow:     /?code=XXX          (query param)
 *   • Implicit flow: /#access_token=...  (top-level hash, no route)
 *   • Error:         /?error=...         or  /#error=...
 *
 * Our app uses hash routing for everything else (#/admin/...), so we need
 * to exchange/parse the token here, then rewrite the URL to the desired
 * hash route and let Wouter take over.
 */
async function handleAuthCallback(): Promise<void> {
  const search = window.location.search;
  const hash = window.location.hash;

  const hasPkceCode = /[?&]code=/.test(search);
  // Implicit hash starts with #access_token= or #error= — NOT #/route
  const hasImplicitToken =
    hash.startsWith("#access_token=") ||
    hash.startsWith("#error=") ||
    hash.includes("&access_token=");

  if (!hasPkceCode && !hasImplicitToken) return;

  try {
    const supabase = getSupabase();

    if (hasPkceCode) {
      // PKCE: exchange the code for a session
      const params = new URLSearchParams(search);
      const code = params.get("code");
      if (code) {
        await supabase.auth.exchangeCodeForSession(code);
      }
    } else {
      // Implicit: detectSessionInUrl will have already parsed it on getSupabase()
      // Calling getSession() forces hydration before we strip the hash.
      await supabase.auth.getSession();
    }
  } catch (e) {
    console.error("auth callback error:", e);
  }

  // Clean URL and route to admin landing page
  const cleanUrl =
    window.location.origin +
    window.location.pathname +
    "#/admin/knowledge";
  window.history.replaceState(null, "", cleanUrl);
  // Ensure the hash change fires for Wouter
  window.location.hash = "#/admin/knowledge";
}

handleAuthCallback().finally(() => {
  if (!window.location.hash) {
    window.location.hash = "#/";
  }
  createRoot(document.getElementById("root")!).render(<App />);
});
