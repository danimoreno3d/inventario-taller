/* sw.js — service worker for Inventario · Taller PWA.
 *
 * Strategy:
 *  - App shell (html, jsx, css, vendored React/Babel, icons, manifest) is
 *    pre-cached at install so the app boots with zero network.
 *  - Images (images/*) are runtime cache-first: cached the first time each is
 *    viewed, then served offline forever. Avoids a huge 300-file install.
 *  - Cross-origin libs (ExcelJS/XLSX/JSZip CDNs, Google Fonts) and Firebase are
 *    network-first with cache fallback — online features degrade gracefully.
 *  - Navigations fall back to the cached index.html when offline.
 *
 * Bump CACHE_VERSION whenever the app-shell files change to force an update.
 */
const CACHE_VERSION = "inv-v16";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const IMG_CACHE = `${CACHE_VERSION}-img`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./ver.html",
  "./styles.css",
  "./app-custom.css",
  "./manifest-ver.webmanifest",
  "./tweaks-panel.jsx",
  "./data.jsx",
  "./Cabinet.jsx",
  "./ItemModal.jsx",
  "./ThemeEditor.jsx",
  "./Importer.jsx",
  "./app.jsx",
  "./manifest.webmanifest",
  "./vendor/react.production.min.js",
  "./vendor/react-dom.production.min.js",
  "./vendor/babel.min.js",
  "./vendor/firebase-app-compat.js",
  "./vendor/firebase-firestore-compat.js",
  "./vendor/firebase-storage-compat.js",
  "./firebase-config.js",
  "./firebase-sync.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-192.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/icon-ver-192.png",
  "./icons/icon-ver-512.png",
  "./icons/maskable-ver-192.png",
  "./icons/maskable-ver-512.png",
  "./icons/apple-touch-icon-ver.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // { cache: "reload" } forces a fresh network fetch, bypassing the HTTP
      // cache, so a new service worker never re-caches stale app code.
      cache.addAll(APP_SHELL.map((u) => new Request(u, { cache: "reload" })))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Allow the page to trigger an immediate update.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function isImage(url) {
  return url.pathname.includes("/images/") ||
    /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never intercept Firebase/Google API traffic (Firestore live channels, auth,
  // Storage on googleapis). Caching these would break realtime sync.
  if (/\.googleapis\.com$/.test(url.hostname) || /\.firebaseio\.com$/.test(url.hostname)) return;

  const sameOrigin = url.origin === self.location.origin;

  // Navigations → try network, fall back to cached index.html (offline shell).
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Big, static assets (vendored React/Babel/Firebase + images) → cache-first
  // (fast + offline). These never change without a filename/version change.
  if (sameOrigin && (url.pathname.includes("/vendor/") || isImage(url))) {
    event.respondWith(
      caches.match(req).then(async (hit) => {
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res && res.ok) {
            const cache = await caches.open(isImage(url) ? IMG_CACHE : SHELL_CACHE);
            cache.put(req, res.clone());
          }
          return res;
        } catch (e) { return hit || Response.error(); }
      })
    );
    return;
  }

  // App code (html/js/jsx/css/manifest) → NETWORK-FIRST: always fetch the latest
  // when online so a deploy takes effect on the next load without reinstalling;
  // the cache is only the offline fallback. This is what makes updates reliable.
  if (sameOrigin) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) caches.open(SHELL_CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Cross-origin (CDN libs, fonts, Firebase Storage images) → network-first,
  // cache fallback. Never block the app if these fail.
  event.respondWith(
    fetch(req).then((res) => {
      // Only cache successful, cacheable responses (skip opaque errors).
      if (res && (res.ok || res.type === "opaque")) {
        caches.open(RUNTIME_CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
