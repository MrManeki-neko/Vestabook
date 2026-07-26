// Minimal service worker: precache the app shell, network-first for navigation and
// same-origin static assets (falling back to cache when offline), and NEVER touch
// anything under /api/ — those requests must always hit the network live.
const CACHE_NAME = "vestabook-v1";
const PRECACHE_URLS = [
  "/",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept API calls — always live, never cached.
  if (url.pathname.startsWith("/api/")) return;

  // Only handle same-origin GET requests.
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;

  const isNavigation = event.request.mode === "navigate";
  if (!isNavigation && !PRECACHE_URLS.includes(url.pathname)) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/")))
  );
});
