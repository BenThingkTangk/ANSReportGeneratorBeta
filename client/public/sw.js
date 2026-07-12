/*
 * HumanOS ANS — service worker.
 *
 * SAFETY CONTRACT (this app processes PHI):
 *   • ONLY the static app shell (HTML/JS/CSS/icons/fonts) is ever cached.
 *   • Anything under /api/ is NEVER cached and NEVER intercepted — patient
 *     data (reports, uploads, Ask ATOM answers, TTS audio) must never touch
 *     the Cache Storage. Those requests always go straight to the network.
 *   • Non-GET requests are never touched.
 *   • Cross-origin requests (fonts CDN, ElevenLabs, Perplexity) pass through.
 *
 * The result is an installable PWA with an offline shell: if the user is
 * offline the app boots to the upload screen; any action needing the network
 * fails loudly (handled by the app's existing resilientUpload error states)
 * rather than serving stale clinical data.
 */
const VERSION = "humanos-ans-shell-v1";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./assets/pulse-node/app-icons/app-icon-192.png",
  "./assets/pulse-node/app-icons/app-icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // addAll is atomic; individual optional assets shouldn't fail install.
      .then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never intercept API traffic or cross-origin requests (PHI + third parties).
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: network-first, fall back to cached shell when offline so the
  // SPA can still boot. We never serve a stale API-derived document.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("./index.html").then((r) => r || caches.match("./"))),
    );
    return;
  }

  // Static assets: cache-first with background refresh (stale-while-revalidate).
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
