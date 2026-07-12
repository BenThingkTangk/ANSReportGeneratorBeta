/**
 * Registers the PWA service worker (public/sw.js) after the window loads.
 *
 * Guarded so it is a no-op in dev (where Vite serves modules that must not be
 * cached) and in browsers without service-worker support. The worker itself
 * only caches the static shell — never API/PHI traffic (see public/sw.js).
 */
export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  // Only register for the built app served over http(s); skip the Vite dev
  // server so module reloads are never intercepted.
  if (import.meta.env && import.meta.env.DEV) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      // Non-fatal: the app works fine without the offline shell.
      console.warn("[pwa] service worker registration failed:", err);
    });
  });
}
