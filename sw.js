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
const CACHE_VERSION = "inv-v8";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const IMG_CACHE = `${CACHE_VERSION}-img`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
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
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
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

  // Images → cache-first (runtime), works offline once seen.
  if (sameOrigin && isImage(url)) {
    event.respondWith(
      caches.open(IMG_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        } catch (e) {
          return hit || Response.error();
        }
      })
    );
    return;
  }

  // Same-origin app shell → cache-first, update in background.
  if (sameOrigin) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const network = fetch(req).then((res) => {
          if (res && res.ok) {
            caches.open(SHELL_CACHE).then((c) => c.put(req, res.clone()));
          }
          return res;
        }).catch(() => hit);
        return hit || network;
      })
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
