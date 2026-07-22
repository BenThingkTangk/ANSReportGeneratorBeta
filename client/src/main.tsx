import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerServiceWorker } from "./lib/registerSW";

/**
 * Admin auth is now a username/password session cookie set by /api/admin/login
 * (see hooks/useAuth.ts). There is no Supabase magic-link / OAuth redirect to
 * intercept here anymore, so the app mounts directly and hash routing takes over.
 */
if (!window.location.hash) {
  window.location.hash = "#/";
}
createRoot(document.getElementById("root")!).render(<App />);
registerServiceWorker();
