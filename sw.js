// Service worker: makes the app installable and keeps the app shell for a flaky connection.
// Network first, so a deploy is never hidden behind a stale cache; the cache is only the fallback.
// Spotify, Last.fm, the font and icon CDNs and /api/ are never cached (they are cross-origin or live data).
const CACHE = "stm-shell-v2";
const SHELL = ["./", "index.html", "css/style.css", "favicon.ico", "changelog.html",
  "js/config.js", "js/spotify.js", "js/lastfm.js", "js/ui.js", "js/player.js", "js/connect.js", "js/radio.js", "js/app.js",
  "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => {
  // one file that cannot be fetched (a protected preview redirects to a login) must not fail the whole install
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  // every page load (including the one that returns from Spotify with ?code=) is stored as the one shell page
  const key = req.mode === "navigate" ? "index.html" : req;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok && !url.search.includes("code=")) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
      return res;
    }).catch(() => caches.match(key).then(hit => hit || Response.error()))
  );
});
