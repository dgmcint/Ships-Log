// Ship's Log service worker: lets the browser version open with no connection.
//
// The app's own files are fetched from the network when it's available (so a
// new release shows up on the next open) and served from the cache when it
// isn't. Fonts from Google are kept once fetched.

const CACHE = "shipslog-shell-v1";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "skins.css",
  "app.js",
  "web.js",
  "help.js",
  "voice.js",
  "vendor/fflate.js",
  "manifest.webmanifest",
  "logo.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "fonts/EdgeOfTheGalaxy-Italic.otf",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url)))).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Fonts: use what we have, fetch once if we don't.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => new Response("", { status: 503 })))
    );
    return;
  }

  if (url.origin !== location.origin) return;

  // The app's own files: network first, cache as the fallback.
  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : undefined)))
  );
});
