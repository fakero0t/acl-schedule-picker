// Service worker: keeps the app shell (pages, css, js, fonts, schedule) and viewed
// map tiles on the phone so the app opens with bad or no signal. Live data
// (/api/results, /api/events, /api/me, writes) always goes to the network; the
// pages keep their own last-good copy of it (see offline.js).
const SHELL = "acl-shell-v1";
const TILES = "acl-tiles-v1";
const MAX_TILES = 400;

const PRECACHE = [
  "/", "/results", "/weekend",
  "/styles.css", "/offline.js", "/grid.js", "/app.js", "/results.js", "/weekend.js",
  "/vendor/leaflet/leaflet.js", "/vendor/leaflet/leaflet.css",
  "/fonts/anton-latin.woff2", "/fonts/archivo-latin.woff2",
  "/manifest.webmanifest", "/icons/icon-192.png", "/icons/apple-touch-icon.png", "/icons/favicon-32.png",
  "/api/schedule",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== TILES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Serve the saved copy instantly, refresh it in the background for next time.
async function staleWhileRevalidate(req, e) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req, { ignoreSearch: req.mode === "navigate" });
  const update = fetch(req)
    .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
    .catch(() => null);
  if (hit) { e.waitUntil(update); return hit; }
  return (await update) || new Response("Offline", { status: 503, statusText: "Offline" });
}

// Map tiles rarely change: use the saved one if we have it, else fetch and keep it.
async function tileCacheFirst(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    const keys = await cache.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await cache.delete(k);
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "tile.openstreetmap.org") return e.respondWith(tileCacheFirst(req));
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") && url.pathname !== "/api/schedule") return;
  e.respondWith(staleWhileRevalidate(req, e));
});
