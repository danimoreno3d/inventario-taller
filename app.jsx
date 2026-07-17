// app.jsx — main composition: state, search, modal, mode, persistence.

const { useState, useEffect, useMemo, useRef, useCallback } = React;

const STORAGE_KEY = "inventario-armarios-v8";
const COLORS_STORAGE_KEY = "inventario-colors-v1";

// ── Persistence layer ─────────────────────────────────────────
// Uploaded photos are base64 data URLs (large). localStorage caps at ~5MB and
// throws QuotaExceededError once a few photos are stored, silently losing edits.
// IndexedDB has a much larger quota, so we persist the whole inventory there and
// keep localStorage only as a migration source / tiny fallback.
const IDB_NAME = "inventario-db";
const IDB_STORE = "kv";
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const r = tx.objectStore(IDB_STORE).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } catch (e) { return undefined; }
}
async function idbSet(key, value) {
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { return false; }
}

// Clean up old cached inventory keys so users get the freshly populated seed
try {
  localStorage.removeItem("inventario-armarios-v1");
  localStorage.removeItem("inventario-armarios-v2");
  localStorage.removeItem("inventario-armarios-v3");
  localStorage.removeItem("inventario-armarios-v4");
  localStorage.removeItem("inventario-armarios-v5");
  localStorage.removeItem("inventario-armarios-v6");
  localStorage.removeItem("inventario-armarios-v7");
} catch (e) {}

// Ensures every cabinet has the right shelf count and every expected armario exists.
// Cabinet 1 has 2 shelves (special), all others have 5.
function normalizeInventory(inv) {
  const out = {};
  for (let i = 1; i <= 7; i++) {
    const id = `armario-${i}`;
    const src = inv?.[id];
    const expected = i === 1 ? 2 : 5;
    const shelves = Array.isArray(src?.shelves) ? src.shelves.slice(0, expected) : [];
    while (shelves.length < expected) shelves.push([]);
    out[id] = {
      name: src?.name || `Armario A${i}`,
      code: src?.code || `A-0${i}`,
      shelves: shelves.map((sh) => Array.isArray(sh) ? sh : []),
    };
  }
  return out;
}

// ── Export helpers ────────────────────────────────────────────
function downloadFile(filename, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime || "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
}

function inventoryToCSV(inventory) {
  const headers = [
    "Armario", "Balda", "ID", "Producto", "Cantidad", "Ubicación", "Etiqueta",
    "Código", "Estado", "Tipología", "Tipo de uso", "Salidas", "Revisado por", "ImagenURL",
  ];
  const escape = (v) => {
    const s = (v == null ? "" : String(v));
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(",")];
  Object.entries(inventory).forEach(([cabId, cab]) => {
    cab.shelves.forEach((shelf, sIdx) => {
      shelf.forEach((it) => {
        // Emit an http(s) URL directly, or the photo's filename (photoName) so a
        // matching ZIP re-import can pair it back by exact filename.
        const photoOut = (it.photo && /^https?:/.test(it.photo))
          ? it.photo
          : (it.photoName || "");
        lines.push([
          cab.code || cabId,
          `B${sIdx + 1}`,
          it.id || "",
          it.name || "",
          it.qty ?? "",
          it.location || "",
          it.tag || "",
          it.code || "",
          it.estado || "",
          it.tipologia || "",
          it.prestamo || "",
          it.salidas || "",
          it.addedBy || "",
          photoOut,
        ].map(escape).join(","));
      });
    });
  });
  return lines.join("\n");
}

function exportInventory(inventory, format) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  if (format === "csv") {
    const csv = inventoryToCSV(inventory);
    downloadFile(`inventario-${stamp}.csv`, "﻿" + csv, "text/csv;charset=utf-8");
    return;
  }
  // Default: JSON dump (includes data-URL photos)
  const json = JSON.stringify({
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    inventory,
  }, null, 2);
  downloadFile(`inventario-${stamp}.json`, json, "application/json");
}

// ── Excel export: one sheet per cabinet, images embedded in rows ──
let exceljsPromise = null;
function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (exceljsPromise) return exceljsPromise;
  exceljsPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js";
    s.onload = () => resolve(window.ExcelJS);
    s.onerror = () => reject(new Error("No se pudo cargar ExcelJS"));
    document.head.appendChild(s);
  });
  return exceljsPromise;
}

// Resolve any photo (data URL or path) to { base64, ext } for embedding.
async function photoToBase64(p) {
  if (!p) return null;
  const extOf = (s) => /png/i.test(s) ? "png" : /gif/i.test(s) ? "gif" : "jpeg";
  if (/^data:image\//i.test(p)) {
    return { base64: p.split(",")[1], ext: extOf(p) };
  }
  try {
    const res = await fetch(p);
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    return { base64: String(dataUrl).split(",")[1], ext: extOf(blob.type || p) };
  } catch (e) { return null; }
}

async function exportExcel(inventory, setToast) {
  try {
    setToast && setToast("Generando Excel…");
    const ExcelJS = await loadExcelJS();
    const wb = new ExcelJS.Workbook();
    wb.creator = "Inventario · Taller";
    wb.created = new Date();

    const COLS = [
      { header: "Imagen", key: "img", width: 16 },
      { header: "Balda", key: "balda", width: 8 },
      { header: "Producto", key: "name", width: 34 },
      { header: "Cantidad", key: "qty", width: 10 },
      { header: "Ubicación", key: "loc", width: 16 },
      { header: "Código", key: "code", width: 14 },
      { header: "Estado", key: "estado", width: 12 },
      { header: "Tipología", key: "tipologia", width: 14 },
      { header: "Tipo de uso", key: "prestamo", width: 14 },
      { header: "Salidas", key: "salidas", width: 12 },
      { header: "Revisado por", key: "addedBy", width: 18 },
    ];

    for (const [cabId, cab] of Object.entries(inventory)) {
      // Sheet name: cabinet code + short name (Excel caps at 31 chars, no []*?/\:)
      const safe = `${cab.code} ${cab.name}`.replace(/[\[\]\*\?\/\\:]/g, " ").slice(0, 31);
      const ws = wb.addWorksheet(safe || cabId, { views: [{ state: "frozen", ySplit: 1 }] });
      ws.columns = COLS;
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).alignment = { vertical: "middle" };

      let rowIdx = 2;
      for (const [sIdx, shelf] of cab.shelves.entries()) {
        for (const it of shelf) {
          const row = ws.getRow(rowIdx);
          row.values = {
            balda: `B${sIdx + 1}`,
            name: it.name || "",
            qty: it.qty ?? "",
            loc: it.location || "",
            code: it.code || "",
            estado: it.estado || "",
            tipologia: it.tipologia || "",
            prestamo: it.prestamo || "",
            salidas: it.salidas || "",
            addedBy: it.addedBy || "",
          };
          row.height = 64;
          row.alignment = { vertical: "middle", wrapText: true };

          // Resolve the photo to base64: data URLs directly, or fetch a path.
          const b = await photoToBase64(it.photo);
          if (b) {
            try {
              const imgId = wb.addImage({ base64: b.base64, extension: b.ext });
              ws.addImage(imgId, {
                tl: { col: 0.1, row: rowIdx - 1 + 0.1 },
                ext: { width: 84, height: 84 },
                editAs: "oneCell",
              });
            } catch (e) {}
          }
          rowIdx++;
        }
      }
    }

    const buf = await wb.xlsx.writeBuffer();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    downloadFile(
      `inventario-${stamp}.xlsx`,
      new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
    );
    setToast && setToast("✓ Excel exportado (imágenes incluidas)");
    setTimeout(() => setToast && setToast(null), 4000);
  } catch (err) {
    console.error(err);
    setToast && setToast("❌ Error al exportar Excel: " + (err.message || ""));
    setTimeout(() => setToast && setToast(null), 5000);
  }
}

// ── Import from URL (public CSV / JSON) ───────────────────────
// IMPORTANT: SharePoint / Teams list URLs are NOT public — this only works with:
//  • Google Sheets published as CSV (File → Share → Publish to web → CSV)
//  • Raw JSON files hosted on a public web server (GitHub raw, Dropbox direct link, etc.)
//  • CSV files served with permissive CORS
async function importFromURL(currentInventory, onResult) {
  const url = prompt(
    "Pega la URL pública del CSV o JSON:\n\n" +
    "✅ Funciona con:\n" +
    "  • Google Sheets publicado como CSV (Archivo → Compartir → Publicar en la web → CSV)\n" +
    "  • Archivos JSON exportados desde esta app\n" +
    "  • CSV en GitHub raw, Dropbox direct link, etc.\n\n" +
    "❌ NO funciona con SharePoint / Teams (requiere autenticación)."
  );
  if (!url || !url.trim()) return;

  try {
    const res = await fetch(url.trim());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const trimmed = text.trim();

    // JSON dump exported from this app
    if (trimmed.startsWith("{")) {
      const parsed = JSON.parse(trimmed);
      if (parsed.inventory && typeof parsed.inventory === "object") {
        onResult(parsed.inventory, { placed: countItems(parsed.inventory), dropped: 0 });
        return;
      }
      throw new Error("JSON sin campo 'inventory'");
    }

    // CSV → parse + map. Reuses Importer's logic by opening the modal pre-filled.
    // For simplicity here, parse and call the same buildInventory logic.
    if (!window.parseCSV || !window.buildInventoryFromCSV) {
      alert("⚠️ Para importar CSV desde URL, abre el importador manual (📥 Importar Teams) y pega la URL allí. Esta opción rápida sólo soporta JSON exportado desde esta app por ahora.");
      return;
    }
    const result = window.buildInventoryFromCSV(text, currentInventory);
    onResult(result.inventory, result.stats);
  } catch (err) {
    alert(
      `❌ No se pudo importar desde la URL.\n\n` +
      `Causa probable: la URL requiere autenticación (SharePoint, Teams, OneDrive privado) ` +
      `o no permite acceso desde el navegador (CORS).\n\n` +
      `Detalles: ${err.message}`
    );
  }
}

function countItems(inventory) {
  let n = 0;
  Object.values(inventory).forEach((cab) => {
    cab.shelves?.forEach((sh) => { n += sh.length; });
  });
  return n;
}

// Restore from a previously-exported JSON dump via file picker
function importJSONFile(onResult) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const inv = parsed.inventory || parsed; // accept either {inventory:...} or raw inventory map
      if (!inv || typeof inv !== "object") throw new Error("Estructura JSON inválida");
      // Sanity check: should have at least one armario-N key
      const hasCabinets = Object.keys(inv).some((k) => /^armario-\d+$/.test(k));
      if (!hasCabinets) throw new Error("No se encontraron armarios en el JSON");
      onResult(inv, { placed: countItems(inv), dropped: 0 });
    } catch (err) {
      alert(`❌ No se pudo leer el JSON.\n\n${err.message}`);
    }
  };
  input.click();
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "mode": "view",
  "hoverScale": 8,
  "showShelfLabels": true,
  "ambientLight": true,
  "showCounters": true
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // ── Exponer la altura real de la barra superior como --topbar-h ──
  // En móvil el armario abierto es un overlay fijo que debe empezar JUSTO debajo
  // de la barra de búsqueda (sin taparla ni dejar hueco). La barra cambia de alto
  // según el ancho (el buscador y los botones se reajustan), así que la medimos y
  // la actualizamos si cambia. El CSS usa var(--topbar-h) para colocar el overlay.
  useEffect(() => {
    const tb = document.querySelector(".topbar");
    if (!tb) return;
    const setH = () =>
      document.documentElement.style.setProperty("--topbar-h", tb.offsetHeight + "px");
    setH();
    // Re-medir al cargar la fuente web (el texto puede cambiar el alto de la barra).
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(setH);
    let ro;
    if ("ResizeObserver" in window) { ro = new ResizeObserver(setH); ro.observe(tb); }
    window.addEventListener("resize", setH);
    return () => { window.removeEventListener("resize", setH); if (ro) ro.disconnect(); };
  }, []);

  // ── Colors (theme) — persisted to localStorage ──────────
  const [colors, setColorsState] = useState(() => {
    try {
      const stored = localStorage.getItem(COLORS_STORAGE_KEY);
      if (stored) return { ...window.COLOR_DEFAULTS, ...JSON.parse(stored) };
    } catch (e) {}
    return window.COLOR_DEFAULTS;
  });
  const setColors = (next) => {
    setColorsState(next);
    try { localStorage.setItem(COLORS_STORAGE_KEY, JSON.stringify(next)); } catch (e) {}
  };
  // Apply CSS vars + automatic contrast correction
  useEffect(() => {
    const root = document.documentElement;
    const resolved = {};
    window.COLOR_GROUPS.forEach(g => g.items.forEach(it => {
      const val = colors[it.key] || window.COLOR_DEFAULTS[it.key];
      if (val) resolved[it.key] = val;
    }));

    // ── Contrast helpers (WCAG relative luminance) ──
    const toRgb = (h) => {
      h = String(h || "").replace("#", "").trim();
      if (h.length === 3) h = h.split("").map(c => c + c).join("");
      if (h.length !== 6) return null;
      return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    };
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const lum = (rgb) => rgb ? 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]) : 0;
    const ratio = (a, b) => {
      const la = lum(toRgb(a)), lb = lum(toRgb(b));
      const hi = Math.max(la, lb), lo = Math.min(la, lb);
      return (hi + 0.05) / (lo + 0.05);
    };
    // Mix a color toward white/black by t (0..1)
    const mix = (hex, target, t) => {
      const a = toRgb(hex), b = toRgb(target);
      if (!a || !b) return hex;
      const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
      return "#" + c.map(v => v.toString(16).padStart(2, "0")).join("");
    };
    // Force `fg` to reach `min` contrast on `bg`; darken or lighten depending on bg lightness.
    const ensure = (fg, bg, min) => {
      if (!toRgb(fg) || !toRgb(bg)) return fg;
      if (ratio(fg, bg) >= min) return fg;
      const bgLum = lum(toRgb(bg));
      const target = bgLum > 0.4 ? "#000000" : "#ffffff"; // dark text on light bg, light on dark
      let best = fg;
      for (let t = 0.1; t <= 1.0001; t += 0.1) {
        best = mix(fg, target, t);
        if (ratio(best, bg) >= min) break;
      }
      return best;
    };

    // The main surface text sits on is the item card (--item-1). Fall back to
    // the app background for the global text. Enforce readable minimums.
    const cardBg = resolved.item1 || "#1c1e21";
    resolved.txt1 = ensure(resolved.txt1 || "#e8e6e1", cardBg, 5.5); // titles/names
    resolved.txt2 = ensure(resolved.txt2 || "#a8a59c", cardBg, 4.0); // secondary
    resolved.txt3 = ensure(resolved.txt3 || "#6a6862", cardBg, 3.2); // faint

    window.COLOR_GROUPS.forEach(g => g.items.forEach(it => {
      if (resolved[it.key]) root.style.setProperty(it.varName, resolved[it.key]);
    }));
    // Derived: readable text ON the accent color (buttons use white today)
    const accent = resolved.rust || "#c2622b";
    root.style.setProperty("--on-accent", lum(toRgb(accent)) > 0.45 ? "#141414" : "#ffffff");
  }, [colors]);

  const [themeOpen, setThemeOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importToast, setImportToast] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);

  // Inventory state — hydrated from localStorage if present.
  // Always normalized to ensure 7 cabinets, each with exactly 5 shelves.
  const [inventory, setInventory] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return normalizeInventory(JSON.parse(stored));
    } catch (e) {}
    return normalizeInventory(window.SEED_INVENTORY);
  });

  // Hydrate on mount. If cloud sync is configured (Firebase), subscribe to the
  // shared Firestore inventory — edits made on any device flow in here. Otherwise
  // fall back to the local IndexedDB copy (offline-only mode).
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (window.INV_SYNC && window.INV_SYNC.enabled) {
      window.INV_SYNC.init(
        normalizeInventory(window.SEED_INVENTORY),
        (remote) => setInventory(normalizeInventory(remote)),
        setSyncStatus
      );
      hydratedRef.current = true;
      return;
    }
    let cancelled = false;
    idbGet(STORAGE_KEY).then((saved) => {
      if (cancelled) return;
      if (saved && typeof saved === "object") {
        setInventory(normalizeInventory(saved));
      }
      hydratedRef.current = true;
    });
    return () => { cancelled = true; };
  }, []);

  // Persist every change to IndexedDB (large quota → photos survive).
  // Skip the very first render until hydration has run so we don't overwrite
  // saved data with the seed.
  useEffect(() => {
    if (!hydratedRef.current) return;
    idbSet(STORAGE_KEY, inventory);
    // Best-effort mirror to localStorage for a fast synchronous first paint;
    // ignore quota errors (photos may exceed it — IndexedDB is the source of truth).
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(inventory)); } catch (e) {}
    // Push to the cloud (debounced + photo upload handled inside the sync layer).
    if (window.INV_SYNC && window.INV_SYNC.enabled) window.INV_SYNC.save(inventory);
  }, [inventory]);

  const [openCabinet, setOpenCabinet] = useState(null);
  const [hoveredCabinet, setHoveredCabinet] = useState(null);
  const [modalItem, setModalItem] = useState(null);
  const [search, setSearch] = useState("");
  const [highlightedItemId, setHighlightedItemId] = useState(null);
  const [scanningCabinetId, setScanningCabinetId] = useState(null);

  // Read-only variant: ver.html sets window.VIEW_ONLY (or append ?ver to the URL).
  // In this mode the Editor is never available — the app can only be browsed.
  const VIEW_ONLY = typeof window !== "undefined" &&
    (window.VIEW_ONLY === true || new URLSearchParams(window.location.search).has("ver"));
  const editorMode = !VIEW_ONLY && t.mode === "editor";

  // Build a flat list of all items once, indexed for fuzzy search
  const flatIndex = useMemo(() => {
    const list = [];
    Object.entries(inventory).forEach(([cabId, cab]) => {
      cab.shelves.forEach((shelf, sIdx) => {
        shelf.forEach((item) => {
          list.push({ cabId, cabName: cab.name, sIdx, item });
        });
      });
    });
    return list;
  }, [inventory]);

  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase().trim();
    const tokens = q.split(/\s+/).filter(Boolean);
    // Score each item: exact substring > all tokens match > any token match
    const scored = flatIndex.map((entry) => {
      const haystack = (
        entry.item.name + " " +
        (entry.item.tag || "") + " " +
        entry.item.location + " " +
        (entry.item.code || "") + " " +
        (entry.item.tipologia || "")
      ).toLowerCase();
      let score = 0;
      if (haystack.includes(q)) score = 100;
      else if (tokens.every((t) => haystack.includes(t))) score = 50;
      else if (tokens.some((t) => haystack.includes(t))) score = 10;
      return { ...entry, score };
    }).filter((e) => e.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 12);
  }, [search, flatIndex]);

  const counts = useMemo(() => {
    const c = {};
    Object.entries(inventory).forEach(([cabId, cab]) => {
      c[cabId] = cab.shelves.reduce(
        (sum, shelf) => sum + shelf.reduce((s, it) => s + (it.qty || 0), 0),
        0
      );
    });
    return c;
  }, [inventory]);

  const handleCabinetClick = useCallback((id) => {
    setOpenCabinet(id);
    setHoveredCabinet(null);
  }, []);

  const closeCabinet = () => {
    setOpenCabinet(null);
    setHighlightedItemId(null);
  };

  const handleItemClick = (cabinetId, shelfIdx, item) => {
    setModalItem({ cabinetId, shelfIdx, item });
  };

  const handleItemSave = (cabinetId, shelfIdx, updated) => {
    setInventory((prev) => {
      const next = { ...prev };
      next[cabinetId] = { ...next[cabinetId] };
      next[cabinetId].shelves = next[cabinetId].shelves.map((shelf, i) => {
        if (i !== shelfIdx) return shelf;
        return shelf.map((it) => (it.id === updated.id ? updated : it));
      });
      return next;
    });
    setModalItem({ cabinetId, shelfIdx, item: updated });
  };

  const handleItemDelete = (cabinetId, shelfIdx, itemId) => {
    setInventory((prev) => {
      const next = { ...prev };
      next[cabinetId] = { ...next[cabinetId] };
      next[cabinetId].shelves = next[cabinetId].shelves.map((shelf, i) => {
        if (i !== shelfIdx) return shelf;
        return shelf.filter((it) => it.id !== itemId);
      });
      return next;
    });
    setModalItem(null);
  };

  const handleItemAdd = (cabinetId, shelfIdx) => {
    const newItem = {
      id: "new-" + Date.now(),
      name: "Objeto nuevo",
      qty: 1,
      location: `${inventory[cabinetId].code} / B${shelfIdx + 1}`,
      photo: null,
      tag: "nuevo",
    };
    setInventory((prev) => {
      const next = { ...prev };
      next[cabinetId] = { ...next[cabinetId] };
      next[cabinetId].shelves = next[cabinetId].shelves.map((shelf, i) =>
        i === shelfIdx ? [...shelf, newItem] : shelf
      );
      return next;
    });
    setModalItem({ cabinetId, shelfIdx, item: newItem });
  };

  // Animated navigation to a search result:
  // 1. Briefly flash the cabinet card to telegraph "opening this one"
  // 2. Open the cabinet (door animation runs ~600ms)
  // 3. After doors finish opening, pulse a neon rectangle around the item
  //    for ~2s so the user can spot it without zooming.
  const goToSearchResult = (r) => {
    setSearch("");
    // Pre-highlight the cabinet (closed-state pulse)
    setScanningCabinetId(r.cabId);
    setTimeout(() => {
      setScanningCabinetId(null);
      setOpenCabinet(r.cabId);
      // Wait for door animation to finish, then flag the item.
      // The CSS animation handles the 3s duration + final fade-out itself,
      // so we just need to clear the flag a bit after to remove the class.
      setTimeout(() => {
        setHighlightedItemId(r.item.id);
        setTimeout(() => setHighlightedItemId(null), 3100);
      }, 700);
    }, 450);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (importOpen) setImportOpen(false);
        else if (themeOpen) setThemeOpen(false);
        else if (modalItem) setModalItem(null);
        else if (openCabinet) closeCabinet();
        else if (search) setSearch("");
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        document.querySelector(".search input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalItem, openCabinet, search, themeOpen, importOpen]);

  // ── Hardware/browser Back button (Android gesture, etc.) ──────────
  // When a layer is open (open cabinet, item modal, theme, importer), Back should
  // close the topmost layer — the same as "Volver al taller" — instead of leaving
  // the app. We trap the history: arm one entry while a layer is open, and on Back
  // close the topmost layer (re-arming while other layers remain open).
  const overlayOpen = !!(modalItem || openCabinet || themeOpen || importOpen);
  const overlayStateRef = useRef({});
  overlayStateRef.current = { modalItem, openCabinet, themeOpen, importOpen };
  useEffect(() => {
    if (!overlayOpen) return;
    history.pushState({ invTrap: true }, "");
    let closedByBack = false;
    const onPop = () => {
      const s = overlayStateRef.current;
      const openCount =
        (s.importOpen ? 1 : 0) + (s.themeOpen ? 1 : 0) +
        (s.modalItem ? 1 : 0) + (s.openCabinet ? 1 : 0);
      if (s.importOpen) setImportOpen(false);
      else if (s.themeOpen) setThemeOpen(false);
      else if (s.modalItem) setModalItem(null);
      else if (s.openCabinet) closeCabinet();
      if (openCount > 1) history.pushState({ invTrap: true }, ""); // more layers remain
      else closedByBack = true;
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Closed via UI/Escape (not Back) → remove the trap so it doesn't linger.
      if (!closedByBack && history.state && history.state.invTrap) history.back();
    };
  }, [overlayOpen]);

  const cabinetIds = Object.keys(inventory);

  return (
    <div className="app">
      {t.ambientLight && <div className="wall-light" />}
      <div className="floor" />

      <div className="topbar">
        <div className="brand">
          <div className="brand-mark" />
          <div className="brand-text">
            <span className="brand-name">Inventario · Taller</span>
            <span className="brand-sub">7 ARMARIOS · {Object.values(counts).reduce((a,b)=>a+b,0)} ÍTEMS</span>
          </div>
          {syncStatus && (
            <span className={`sync-badge ${/✓/.test(syncStatus) ? 'ok' : /rror|conexión|conexion/.test(syncStatus) ? 'err' : 'busy'}`}
                  title="Estado de sincronización con la nube">
              {syncStatus}
            </span>
          )}
        </div>

        <div className="topbar-tools">
          <div className="search">
            <svg className="search-icon" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input
              placeholder="Buscar resistencia, arduino, destornillador..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="search-shortcut">⌘K</span>
            {searchResults.length > 0 && (
              <div className="search-results">
                {searchResults.map((r) => (
                  <div key={r.cabId + r.item.id} className="search-result"
                       onClick={() => goToSearchResult(r)}>
                    <span className="search-result-name">{r.item.name}</span>
                    <span className="search-result-loc">{r.item.location}</span>
                    <span className="search-result-qty">×{r.item.qty}</span>
                  </div>
                ))}
              </div>
            )}
            {search.trim() && searchResults.length === 0 && (
              <div className="search-results">
                <div className="search-result" style={{cursor:"default", color:"var(--txt-3)"}}>
                  Sin resultados para "{search}"
                </div>
              </div>
            )}
          </div>

          {editorMode && (
            <>
              <button
                className="topbar-import-btn"
                onClick={() => setImportOpen(true)}
                title="Importar desde Excel/CSV de Teams"
              >
                📥 Importar Teams
              </button>
              <button
                className="topbar-export-btn"
                onClick={() => exportExcel(inventory, setImportToast)}
                title="Exportar a Excel: una hoja por armario, con imágenes en cada fila"
              >
                📤 Exportar
              </button>
              <button
                className="topbar-theme-btn"
                onClick={() => setThemeOpen(true)}
                title="Editar colores del tema"
              >
                🎨 Colores
              </button>
              <button
                className="topbar-empty-btn"
                onClick={() => {
                  if (confirm("⚠️ ¿VACIAR completamente todos los armarios?\n\nEsta acción no se puede deshacer.")) {
                    const empty = {};
                    for (let i = 1; i <= 7; i++) {
                      empty[`armario-${i}`] = {
                        name: inventory[`armario-${i}`]?.name || `Armario A${i}`,
                        code: inventory[`armario-${i}`]?.code || `A-0${i}`,
                        shelves: [[], [], [], [], []],
                      };
                    }
                    setInventory(empty);
                  }
                }}
                title="Eliminar todo el inventario"
              >
                🗑 Vaciar
              </button>
            </>
          )}

          {VIEW_ONLY ? (
            <span className="view-only-badge" title="Modo solo lectura — no se puede editar">
              👁 Solo ver
            </span>
          ) : (
            <div className="mode-toggle">
              <button
                className={t.mode === "view" ? "active" : ""}
                onClick={() => setTweak("mode", "view")}
              >
                Visualizar
              </button>
              <button
                className={t.mode === "editor" ? "active editor" : ""}
                onClick={() => setTweak("mode", "editor")}
              >
                Editor
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="stage" onClick={(e) => {
        // Close open cabinet when clicking the stage background (not a cabinet)
        if (openCabinet && e.target === e.currentTarget) closeCabinet();
      }}>
        {!openCabinet && (
          <div className="stage-hint">
            Pasa el ratón por un armario · Click para abrir
          </div>
        )}

        {openCabinet && (
          <button className="back-bar" onClick={closeCabinet}>
            <span>←</span> Volver al taller
          </button>
        )}

        <div className={`cabinet-row ${openCabinet ? 'has-open' : ''}`}
             onClick={(e) => {
               // Close if click landed on the row itself (whitespace), not a cabinet child
               if (openCabinet && e.target === e.currentTarget) closeCabinet();
             }}>
          {cabinetIds.map((id) => {
            const shouldHide = openCabinet && openCabinet !== id;
            if (shouldHide) return null;
            return (
              <Cabinet
                key={id}
                id={id}
                data={inventory[id]}
                totalCount={counts[id]}
                isOpen={openCabinet === id}
                isHoveredAny={!!hoveredCabinet}
                isThisHovered={hoveredCabinet === id}
                isScanning={scanningCabinetId === id}
                highlightedItemId={highlightedItemId}
                onHover={setHoveredCabinet}
                onLeave={() => setHoveredCabinet(null)}
                onClick={handleCabinetClick}
                onItemClick={handleItemClick}
                onItemAdd={handleItemAdd}
                editorMode={editorMode}
                scaleAmount={t.hoverScale}
              />
            );
          })}
        </div>
      </div>

      {modalItem && (
        <ItemModal
          item={modalItem.item}
          cabinetId={modalItem.cabinetId}
          shelfIdx={modalItem.shelfIdx}
          editorMode={editorMode}
          onClose={() => setModalItem(null)}
          onSave={handleItemSave}
          onDelete={handleItemDelete}
        />
      )}

      <ThemeEditor
        open={themeOpen}
        onClose={() => setThemeOpen(false)}
        colors={colors}
        setColors={setColors}
      />

      <Importer
        open={importOpen}
        onClose={() => setImportOpen(false)}
        currentInventory={inventory}
        onConfirm={(nextInv, stats) => {
          setInventory(normalizeInventory(nextInv));
          setImportOpen(false);
          setImportToast(`✓ ${stats.placed} objetos importados${stats.dropped ? ` · ${stats.dropped} sin ubicación` : ''}`);
          setTimeout(() => setImportToast(null), 4000);
        }}
      />

      {importToast && <div className="import-toast">{importToast}</div>}

      <TweaksPanel title="Tweaks">
        <TweakSection label="Modo" />
        <TweakRadio
          label="Modo de uso"
          value={t.mode}
          options={[
            { value: "view",   label: "Visualizar" },
            { value: "editor", label: "Editor" },
          ]}
          onChange={(v) => setTweak("mode", v)}
        />

        <TweakSection label="Interacción" />
        <TweakSlider
          label="Escala al pasar ratón"
          value={t.hoverScale}
          min={0} max={20} step={1} unit="%"
          onChange={(v) => setTweak("hoverScale", v)}
        />

        <TweakSection label="Estética" />
        <TweakToggle
          label="Luz ambiental"
          value={t.ambientLight}
          onChange={(v) => setTweak("ambientLight", v)}
        />
        <TweakToggle
          label="Mostrar contadores"
          value={t.showCounters}
          onChange={(v) => setTweak("showCounters", v)}
        />

        {editorMode && (
          <>
            <TweakSection label="Importar" />
            <TweakButton
              label="📥 Importar desde Teams (Excel/CSV)"
              onClick={() => setImportOpen(true)}
            />
            <TweakButton
              label="🔗 Importar desde URL pública"
              secondary
              onClick={() => importFromURL(inventory, (next, stats) => {
                setInventory(normalizeInventory(next));
                setImportToast(`✓ ${stats.placed} objetos importados desde URL${stats.dropped ? ` · ${stats.dropped} sin ubicación` : ''}`);
                setTimeout(() => setImportToast(null), 4000);
              })}
            />
            <TweakButton
              label="📂 Restaurar desde JSON exportado"
              secondary
              onClick={() => importJSONFile((next, stats) => {
                setInventory(normalizeInventory(next));
                setImportToast(`✓ ${stats.placed} objetos restaurados desde JSON`);
                setTimeout(() => setImportToast(null), 4000);
              })}
            />
            <TweakSection label="Exportar" />
            <TweakButton
              label="📤 Exportar JSON (con imágenes)"
              onClick={() => exportInventory(inventory, "json")}
            />
            <TweakButton
              label="📊 Exportar CSV (sin imágenes)"
              secondary
              onClick={() => exportInventory(inventory, "csv")}
            />
            <TweakButton
              label="📗 Exportar Excel (hojas por armario + fotos)"
              onClick={() => exportExcel(inventory, setImportToast)}
            />
            <TweakSection label="Colores" />
            <TweakButton
              label="🎨 Abrir editor de colores"
              onClick={() => setThemeOpen(true)}
            />
          </>
        )}

        <TweakSection label="Datos" />
        <TweakButton
          label="Restaurar inventario"
          secondary
          onClick={() => {
            if (confirm("¿Restaurar inventario inicial? Se perderán los cambios.")) {
              localStorage.removeItem(STORAGE_KEY);
              setInventory(window.SEED_INVENTORY);
            }
          }}
        />
        <TweakButton
          label="🗑 Vaciar todo el inventario"
          secondary
          onClick={() => {
            if (confirm("⚠️ ¿VACIAR completamente todos los armarios?\n\nEsta acción no se puede deshacer. Todos los objetos serán eliminados.")) {
              const empty = {};
              for (let i = 1; i <= 7; i++) {
                empty[`armario-${i}`] = {
                  name: inventory[`armario-${i}`]?.name || `Armario A${i}`,
                  code: inventory[`armario-${i}`]?.code || `A-0${i}`,
                  shelves: [[], [], [], [], []],
                };
              }
              setInventory(empty);
            }
          }}
        />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
