// firebase-sync.js — cloud sync layer (Firestore only) for the inventory.
//
// window.INV_SYNC:
//   .enabled
//   .init(seed, onRemote, onStatus)   set up the live subscription
//   .save(inventory)                  push local changes (debounced, photo-aware)
//
// How it works:
//  • Whole inventory lives in ONE Firestore doc `inventario/state`. Firestore
//    forbids nested arrays, so each cabinet's `shelves` (array-of-arrays) is
//    stored as a map {"0":[...],"1":[...]} and rebuilt on read.
//  • Camera photos are data URLs. To keep the inventory doc tiny AND avoid needing
//    Firebase Storage (which can require billing), each photo is saved as its own
//    doc in the `fotos` collection (well under the 1 MB doc limit after the app's
//    ~1280px compression). The item's photo becomes a small "fs:<id>" reference in
//    the inventory doc, and is resolved back to a data URL for display. Bundled
//    seed photos keep their `images/...` path and are never uploaded.
//  • Photos that can't be written yet are kept in `pending` and restored locally so
//    a cloud echo never wipes a just-taken photo; they retry on the next save.
//  • Our own writes coming back via onSnapshot are ignored (stableStringify compare
//    on the reference form, which is what's actually stored).
//  • No write happens until the first snapshot arrives, so the local seed can never
//    clobber real data already in the cloud.

window.INV_SYNC = (function () {
  const cfg = window.FIREBASE_CONFIG;
  const OFF = { enabled: false, init() {}, save() {} };

  if (!cfg || typeof firebase === "undefined") {
    console.info("[sync] Firebase off — modo local (IndexedDB).");
    return OFF;
  }

  let db;
  try {
    firebase.initializeApp(cfg);
    db = firebase.firestore();
    db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
  } catch (e) {
    console.warn("[sync] init failed:", e);
    return OFF;
  }

  const DOC = db.collection("inventario").doc("state");
  const FOTOS = db.collection("fotos");
  const photoCache = new Map(); // photoId -> dataURL (avoids re-reads / re-writes)
  const pending = new Map();    // itemId -> dataURL not yet stored in the cloud

  let onRemoteCb = null, onStatusCb = null, seedInv = null;
  let firstSnap = false, lastRemoteJSON = null, saveTimer = null;

  const isData = (p) => typeof p === "string" && p.startsWith("data:");
  const isRef = (p) => typeof p === "string" && p.startsWith("fs:");
  const status = (s) => { try { onStatusCb && onStatusCb(s); } catch (e) {} };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const SV = () => firebase.firestore.FieldValue.serverTimestamp();
  function h(s) { let n = 0; for (let i = 0; i < s.length; i += 997) n = (n * 31 + s.charCodeAt(i)) | 0; return Math.abs(n ^ s.length); }

  // Deterministic JSON (sorted keys) so the echo-compare never trips on key order.
  function stable(v) {
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    if (v && typeof v === "object") {
      return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
    }
    return JSON.stringify(v === undefined ? null : v);
  }
  function cleanItem(it) {
    const out = {};
    for (const k of Object.keys(it || {})) if (k[0] !== "_") out[k] = it[k];
    return out;
  }

  // inventory -> Firestore `cabinets` map. Photos are refs/paths only; any leftover
  // data URL (a failed upload) is stripped so the doc never bloats past 1 MB.
  function invToDoc(inv) {
    const cabinets = {};
    for (const [cabId, cab] of Object.entries(inv || {})) {
      const shelves = {};
      (cab.shelves || []).forEach((sh, i) => {
        shelves[String(i)] = (sh || []).map((it) => {
          const c = cleanItem(it);
          if (isData(c.photo)) c.photo = "";
          return c;
        });
      });
      cabinets[cabId] = { name: cab.name || "", code: cab.code || "", shelves };
    }
    return cabinets;
  }

  // Firestore `cabinets` map -> inventory (photos left as stored: fs: ref / path).
  function docToInv(cabinets) {
    const inv = {};
    for (const [cabId, cab] of Object.entries(cabinets || {})) {
      const sm = cab.shelves || {};
      const idxs = Object.keys(sm).map(Number).sort((a, b) => a - b);
      inv[cabId] = {
        name: cab.name || "", code: cab.code || "",
        shelves: idxs.map((i) => (sm[String(i)] || []).slice()),
      };
    }
    return inv;
  }

  // Replace "fs:<id>" refs with their data URL (cached) so <img> can render them,
  // and restore any local pending photo the cloud doesn't have yet.
  async function resolvePhotos(inv) {
    const jobs = [];
    for (const cab of Object.values(inv)) {
      for (const shelf of cab.shelves || []) {
        for (const it of shelf) {
          if (isRef(it.photo)) {
            const id = it.photo.slice(3);
            if (photoCache.has(id)) {
              it.photo = photoCache.get(id);
            } else {
              jobs.push(FOTOS.doc(id).get().then((s) => {
                const data = s.exists ? (s.data().data || "") : "";
                if (data) photoCache.set(id, data);
                it.photo = data;
              }).catch(() => { it.photo = ""; }));
            }
          }
          if ((!it.photo || isRef(it.photo)) && pending.has(it.id)) it.photo = pending.get(it.id);
        }
      }
    }
    if (jobs.length) await Promise.all(jobs);
    return inv;
  }

  // Store data-URL photos as `fotos/<id>` docs; item.photo becomes "fs:<id>".
  async function uploadPhotos(inv) {
    const jobs = [];
    for (const cab of Object.values(inv)) {
      for (const shelf of cab.shelves || []) {
        for (const it of shelf) {
          if (!isData(it.photo)) continue;
          const id = it.id || ("p" + h(it.photo));
          if (photoCache.get(id) === it.photo) { it.photo = "fs:" + id; continue; } // unchanged
          const dataUrl = it.photo;
          jobs.push(
            FOTOS.doc(id).set({ data: dataUrl, updatedAt: SV() })
              .then(() => { photoCache.set(id, dataUrl); pending.delete(it.id); it.photo = "fs:" + id; })
              .catch((e) => { console.warn("[sync] foto write failed:", e && (e.code || e.message)); pending.set(it.id, dataUrl); })
          );
        }
      }
    }
    if (jobs.length) { status("Guardando foto(s)…"); await Promise.all(jobs); }
    return inv;
  }

  return {
    enabled: true,

    init(seed, onRemote, onStatus) {
      onRemoteCb = onRemote;
      onStatusCb = onStatus || null;
      seedInv = seed;
      status("Conectando…");
      // Diagnostic only (does NOT affect the connection): if no LIVE server
      // response arrives within a few seconds, the network is almost certainly
      // blocking Firestore — say so clearly instead of a vague "sin conexión".
      let serverSeen = false;
      const reachTimer = setTimeout(() => {
        if (!serverSeen) status("Sin conexión (servidor no alcanzable)");
      }, 9000);
      DOC.onSnapshot(async (snap) => {
        if (snap.exists && snap.data() && snap.data().cabinets) {
          const cloud = docToInv(snap.data().cabinets);
          lastRemoteJSON = stable(cloud); // reference form = what's actually stored
          firstSnap = true;
          if (!snap.metadata.fromCache) { serverSeen = true; clearTimeout(reachTimer); }
          status(snap.metadata.fromCache ? "Sin conexión (caché)" : "Sincronizado ✓");
          const resolved = await resolvePhotos(clone(cloud));
          onRemoteCb && onRemoteCb(resolved);
        } else if (!firstSnap) {
          firstSnap = true;
          serverSeen = true; clearTimeout(reachTimer);
          status("Creando base de datos…");
          DOC.set({ cabinets: invToDoc(seedInv), updatedAt: SV() })
            .then(() => status("Sincronizado ✓"))
            .catch((e) => { console.warn("[sync] seed error", e); status("Error al crear BD"); });
        }
      }, (err) => { clearTimeout(reachTimer); console.warn("[sync] snapshot error", err); status("Sin conexión: " + ((err && err.code) || "error")); });
    },

    save(inv) {
      if (!firstSnap) return; // wait until we know the cloud state
      clearTimeout(saveTimer);
      const c = clone(inv);
      saveTimer = setTimeout(async () => {
        try {
          await uploadPhotos(c);
          const cabinets = invToDoc(c);
          if (stable(docToInv(cabinets)) === lastRemoteJSON) return; // nothing new
          status("Guardando…");
          await DOC.set({ cabinets, updatedAt: SV() });
          status("Sincronizado ✓");
        } catch (e) {
          console.warn("[sync] save error", e);
          status("Error al guardar");
        }
      }, 900);
    },
  };
})();
