/* sw.js — KILL-SWITCH service worker.
 *
 * The inventory app used to ship a caching service worker for offline use, but on
 * locked-down networks and installed PWAs it repeatedly served STALE code that
 * never updated, hiding fixes and showing a false "sin conexión". This worker
 * removes itself: it purges every Cache Storage entry and unregisters, after which
 * the app always loads fresh from the network — exactly like a normal/incognito
 * browser tab (which always worked).
 *
 * It has NO fetch handler, so it never intercepts requests (nothing can break the
 * Firestore connection). It does NOT call clients.claim() or reload any window, so
 * it can never cause a reload loop. Any already-stuck client installs this on its
 * next launch (the page still runs a SW update check); one relaunch later, with
 * the registration gone, the app runs fresh code.
 */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) {}
    try { await self.registration.unregister(); } catch (e) {}
  })());
});
