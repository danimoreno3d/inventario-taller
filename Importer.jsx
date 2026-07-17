// Importer.jsx — full-screen importer that reads .xlsx / .csv exported from
// the Microsoft Teams (SharePoint) inventory list and maps rows into the
// 7-cabinet × 5-shelf structure using the Ubicación column (e.g. "A4 - P5").
//
// Expected columns (Spanish, as exported from Teams):
//   Imagen, Producto, Código, Estado, Tipología, Préstamo,
//   Ubicación, Stock, Salidas, Añadido por
//
// Column mapping is fuzzy (case-insensitive, accent-insensitive, supports
// alternate names). The user sees a column-mapping table and a preview before
// confirming. On confirm the parent receives a normalized inventory snapshot
// + the chosen merge mode.
//
// SheetJS (xlsx) is loaded dynamically the first time the modal opens.

const XLSX_CDN = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
let xlsxPromise = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxPromise) return xlsxPromise;
  xlsxPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = XLSX_CDN;
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error("No se pudo cargar la librería de Excel"));
    document.head.appendChild(s);
  });
  return xlsxPromise;
}

// ── String helpers ────────────────────────────────────────
const norm = (s) => (s ?? "")
  .toString()
  .toLowerCase()
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .trim();

// Canonical field → list of acceptable header names (normalized)
const FIELD_ALIASES = {
  name:      ["producto", "nombre", "titulo", "título", "name", "item", "descripcion", "description"],
  code:      ["codigo", "code", "ref", "referencia", "sku"],
  ubicacion: ["ubicacion", "location", "ubicación", "loc"],
  qty:       ["stock", "qty", "cantidad", "unidades", "stock actual"],
  photo:     ["imagen", "image", "photo", "foto"],
  estado:    ["estado", "state", "status"],
  tipologia: ["tipologia", "tipología", "type", "tipo"],
  prestamo:  ["prestamo", "préstamo", "loan", "loanable"],
  salidas:   ["salidas", "outputs", "out", "historial"],
  addedBy:   ["añadido por", "anadido por", "added by", "creado por", "owner", "autor", "revisado por", "ultima revision", "última revisión", "ultima revisión", "última revision", "responsable", "asignado a", "modificado por"],
};

function autoMap(headers) {
  const map = {};
  Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => {
    const found = headers.find((h) => aliases.includes(norm(h)));
    if (found) map[field] = found;
  });
  return map;
}

// Parse "A4 - P5" → { a: 4, p: 5 }. Tolerant of spaces/case/dashes.
function parseUbicacion(raw) {
  if (!raw) return null;
  const s = String(raw).toUpperCase().replace(/\s+/g, "");
  const m = s.match(/A(\d+)[-_/.,]?P(\d+)/);
  if (!m) return null;
  const a = parseInt(m[1], 10);
  const p = parseInt(m[2], 10);
  if (!a || !p) return null;
  return { a, p };
}

// Slugify a name for stable IDs
function slug(s) {
  return norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";
}

// Try to extract a photo URL/dataURL from the row's Imagen column or photoMap.
function extractPhoto(row, map, photoMap) {
  const raw = map.photo ? String(row[map.photo] ?? "").trim() : "";
  // 1. Direct URL in CSV (preferred)
  if (raw && /^https?:\/\//i.test(raw)) {
    return raw.split(/[,\s]/)[0];
  }
  // 2. Data URL pasted directly
  if (raw && /^data:image\//i.test(raw)) return raw;

  const byFile = photoMap && photoMap.__byFile;
  // 3. EXACT filename match: the CSV "Imagen" column stores the literal attachment
  //    filename (e.g. Reserved_ImageAttachment_..._[aryzon VR][1]_[2].jpg). If the
  //    ZIP contains that same file, this is a bulletproof 1:1 match.
  if (raw && byFile) {
    const fileKey = norm(raw.replace(/\.[^.]+$/, ""));
    if (byFile[fileKey]) return byFile[fileKey];
  }
  // 4. Fallback: match by product name against the cleaned photo keys (zip)
  if (photoMap && map.name) {
    const nameKey = norm(row[map.name] || "");
    if (!nameKey) return null;
    if (photoMap[nameKey]) return photoMap[nameKey];
    const keys = Object.keys(photoMap).filter((k) => k !== "__byFile");
    // 1) exact or prefix match (handles trailing words / variant numbers)
    let hit = keys.find(k =>
      k === nameKey || k.startsWith(nameKey + " ") || nameKey.startsWith(k + " ")
    );
    // 2) strong token overlap: at least 60% of the product's words (min 2) must
    //    appear in the photo name. Avoids the loose contains() that mixed images
    //    (a spray photo shares 0 words with "aryzon vr 1") while still matching
    //    photos whose filename differs only slightly from the product name.
    if (!hit) {
      const pt = nameKey.split(" ").filter((w) => w.length > 1);
      const need = Math.max(2, Math.ceil(pt.length * 0.6));
      let best = null, bs = 0;
      for (const k of keys) {
        const kt = k.split(" ");
        let sc = 0;
        for (const w of pt) if (kt.includes(w)) sc++;
        if (sc > bs && sc >= need) { bs = sc; best = k; }
      }
      hit = best;
    }
    if (hit) return photoMap[hit];
  }
  return null;
}

// Safe accessor: returns "" when the column key is undefined or the cell is null.
const cell = (row, key) => {
  if (!key) return "";
  const v = row[key];
  if (v == null) return "";
  let s = String(v).trim();
  // SharePoint multi-choice columns export as JSON arrays: ["En el lab"] → En el lab
  if (s.startsWith("[")) s = s.replace(/^\["?/, "").replace(/"?\]$/, "").replace(/","/g, ", ");
  return s;
};

// Convert one parsed row → normalized item (or null if it can't be placed).
function rowToItem(row, map, photoMap) {
  const name = cell(row, map.name).trim();
  if (!name) return null;
  const ubicRaw = cell(row, map.ubicacion);
  const ubic = parseUbicacion(ubicRaw);
  const qtyRaw = cell(row, map.qty);
  const qty = parseInt(qtyRaw, 10) || 1;

  const item = {
    id: slug(name) + "-" + Math.random().toString(36).slice(2, 6),
    name,
    qty,
    location: ubic ? `A-0${ubic.a} / B${ubic.p}` : ubicRaw,
    photo: extractPhoto(row, map, photoMap),
    tag: cell(row, map.tipologia).toLowerCase(),
    code: cell(row, map.code),
    estado: cell(row, map.estado),
    tipologia: cell(row, map.tipologia),
    prestamo: cell(row, map.prestamo),
    salidas: cell(row, map.salidas),
    addedBy: cell(row, map.addedBy),
  };
  return { item, ubic };
}

// Group items into the {armario-N: {shelves: [[],[],[],[],[]]}} shape.
// `groupDuplicates`: agrupa cuando el nombre EXACTO normalizado coincide.
// `smartGroup`: agrupa además variantes que comparten "raíz" (mismo nombre tras
//   eliminar sufijos numéricos típicos: "Resistencia 220Ω", "Resistencia 1kΩ"
//   → 1 caja "Resistencia (3 variantes)" con qty total).
function buildInventory(rowItems, currentInventory, mode, groupDuplicates, smartGroup = false) {
  const next = {};
  for (let i = 1; i <= 7; i++) {
    const id = `armario-${i}`;
    if (mode === "merge" && currentInventory[id]) {
      const existingShelves = (currentInventory[id].shelves || []).slice(0, 5).map((sh) => Array.isArray(sh) ? [...sh] : []);
      while (existingShelves.length < 5) existingShelves.push([]);
      next[id] = {
        ...currentInventory[id],
        shelves: existingShelves,
      };
    } else {
      next[id] = {
        name: currentInventory[id]?.name || `Armario A${i}`,
        code: currentInventory[id]?.code || `A-0${i}`,
        shelves: [[], [], [], [], []],
      };
    }
  }

  let placed = 0, dropped = 0, merged = 0;

  // Smart-grouping helper: strips trailing numbers, units, sizes, ranges so
  // "Resistencia 220Ω", "Resistencia 1kΩ", "Cable 2m", "Cable 5m" all share a root.
  const stripVariants = (s) => norm(s)
    .replace(/\b\d+([.,]\d+)?\s*(k|kohm|kω|ω|ohm|ohms|mhz|hz|khz|mm|cm|m|mb|gb|kb|w|v|a|ma|mah|ml|l|kg|g|n|pcs|uds|u|x|piezas?)\b/gi, "")
    .replace(/[#nº]\s*\d+/gi, "")           // #1, nº 12
    .replace(/\b\d+(\s*[×x]\s*\d+)?\b/g, "")// stray numbers and dimensions like 16x2
    .replace(/[-_/]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  rowItems.forEach(({ item, ubic }) => {
    if (!ubic) { dropped++; return; }
    const armarioId = `armario-${ubic.a}`;
    const shelfIdx = ubic.p - 1;
    if (!next[armarioId] || shelfIdx < 0 || shelfIdx > 4) { dropped++; return; }
    const shelf = next[armarioId].shelves[shelfIdx];

    if (smartGroup) {
      const root = stripVariants(item.name);
      // Match an existing slot whose stripped root equals ours
      const existing = shelf.find((it) => stripVariants(it.name) === root);
      if (existing) {
        existing.qty = (existing.qty || 0) + (item.qty || 1);
        existing.variants = (existing.variants || [existing.name]);
        if (!existing.variants.includes(item.name)) existing.variants.push(item.name);
        // Re-label the box with the variant count
        const baseName = root.charAt(0).toUpperCase() + root.slice(1) || existing.name;
        existing.name = `${baseName} · ${existing.variants.length} variantes`;
        if (!existing.photo && item.photo) existing.photo = item.photo;
        merged++;
        return;
      }
    }

    if (groupDuplicates) {
      const existing = shelf.find(it => norm(it.name) === norm(item.name));
      if (existing) {
        existing.qty = (existing.qty || 0) + (item.qty || 1);
        if (!existing.photo && item.photo) existing.photo = item.photo;
        merged++;
        return;
      }
    }
    shelf.push(item);
    placed++;
  });
  return { inventory: next, placed, dropped, merged };
}

// JSZip dynamic loader
const JSZIP_CDN = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
let jszipPromise = null;
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (jszipPromise) return jszipPromise;
  jszipPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = JSZIP_CDN;
    s.onload = () => resolve(window.JSZip);
    s.onerror = () => reject(new Error("No se pudo cargar JSZip"));
    document.head.appendChild(s);
  });
  return jszipPromise;
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// Parse a ZIP of images into { map (name→dataUrl), byFile (exact filename→dataUrl) }.
// Shared by the full importer and the photos-only flow.
async function zipToPhotoMaps(file, onProgress) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter(f => !f.dir && /\.(jpe?g|png|gif|webp|avif)$/i.test(f.name));
  const map = {};
  const byFile = {};
  let i = 0;
  for (const entry of entries) {
    i++;
    onProgress && onProgress(i, entries.length);
    const blob = await entry.async("blob");
    const dataUrl = await blobToDataURL(blob);
    const filename = entry.name.split("/").pop();
    byFile[norm(filename.replace(/\.[^.]+$/, ""))] = dataUrl;
    let base = filename.replace(/\.[^.]+$/, "");
    const spMatch = base.match(/Reserved_ImageAttachment.*?\[([^\]]+)\]\[\d+\]_\[\d+\]$/);
    if (spMatch) base = spMatch[1];
    base = base.replace(/^\d+_/, "").replace(/-[0-9a-f]{8}$/i, "");
    const key = norm(base);
    if (key && !map[key]) map[key] = dataUrl;
  }
  map.__byFile = byFile;
  return { map, byFile, count: entries.length };
}

// Given a photoMap, resolve the best photo for an inventory item that ALREADY
// exists (used by photos-only import). Tries exact filename (item.photoName or
// the current photo's filename), then the product-name match.
function photoForItem(item, map) {
  const byFile = map.__byFile || {};
  const tryFile = (s) => {
    if (!s) return null;
    const k = norm(String(s).split("/").pop().replace(/\.[^.]+$/, ""));
    return byFile[k] || null;
  };
  // exact filename from stored photoName or existing photo path
  let hit = tryFile(item.photoName) || tryFile(item.photo);
  if (hit) return hit;
  // by product name
  const nameKey = norm(item.name || "");
  if (!nameKey) return null;
  if (map[nameKey]) return map[nameKey];
  const keys = Object.keys(map).filter(k => k !== "__byFile");
  let k = keys.find(k => k === nameKey || k.startsWith(nameKey + " ") || nameKey.startsWith(k + " "));
  if (!k) {
    const pt = nameKey.split(" ").filter(w => w.length > 1);
    const need = Math.max(2, Math.ceil(pt.length * 0.6));
    let best = null, bs = 0;
    for (const kk of keys) {
      const kt = kk.split(" ");
      let sc = 0;
      for (const w of pt) if (kt.includes(w)) sc++;
      if (sc > bs && sc >= need) { bs = sc; best = kk; }
    }
    k = best;
  }
  return k ? map[k] : null;
}

function Importer({ open, onClose, currentInventory, onConfirm, mergeMode = "merge" }) {
  const [stage, setStage] = React.useState("idle"); // idle | parsing | preview | error
  const [error, setError] = React.useState(null);
  const [headers, setHeaders] = React.useState([]);
  const [rows, setRows] = React.useState([]);
  const [colMap, setColMap] = React.useState({});
  const [mode, setMode] = React.useState(mergeMode);
  const [filename, setFilename] = React.useState("");
  const [groupDuplicates, setGroupDuplicates] = React.useState(true);
  const [smartGroup, setSmartGroup] = React.useState(false);
  const [photoMap, setPhotoMap] = React.useState({}); // { normalizedName: dataUrl }
  const [photoStatus, setPhotoStatus] = React.useState(null);
  const fileInputRef = React.useRef(null);
  const photoInputRef = React.useRef(null);
  const photosOnlyInputRef = React.useRef(null);
  const [photosOnlyStatus, setPhotosOnlyStatus] = React.useState(null);

  React.useEffect(() => {
    if (!open) {
      setStage("idle"); setError(null); setHeaders([]); setRows([]); setColMap({}); setFilename("");
    }
  }, [open]);

  // Live preview built from current colMap + rows.
  // MUST be declared before any conditional return — hook order matters.
  const preview = React.useMemo(() => {
    if (stage !== "preview" || !colMap.name || !colMap.ubicacion) return null;
    const items = rows.map((r) => rowToItem(r, colMap, photoMap)).filter(Boolean);
    const built = buildInventory(items, currentInventory, mode, groupDuplicates, smartGroup);
    return { items, ...built };
  }, [stage, colMap, rows, mode, currentInventory, photoMap, groupDuplicates, smartGroup]);

  if (!open) return null;

  const handleFile = async (file) => {
    if (!file) return;
    setFilename(file.name);
    setStage("parsing");
    setError(null);

    // Reject .iqy (Web Query) — common Teams "Open in Excel" output
    if (/\.iqy$/i.test(file.name)) {
      setStage("error");
      setError(
        "⚠️ Has subido un archivo .iqy (Consulta Web), no un Excel real. Este archivo solo contiene la URL de tu lista de Teams — no los datos. \n\nQué hacer:\n1) En Teams, abre tu lista \n2) Pulsa los 3 puntos (…) arriba → Exportar a CSV \n3) O bien: abre el .iqy con Excel, espera a que cargue los datos, y luego Archivo → Guardar como → Excel (.xlsx) \n4) Sube ese archivo aquí"
      );
      return;
    }

    try {
      const isCSV = /\.csv$/i.test(file.name);
      let parsedRows = [];
      if (isCSV) {
        const text = await file.text();
        parsedRows = parseCSV(text);
      } else {
        const XLSX = await loadXLSX();
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        parsedRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      }
      if (!parsedRows.length) {
        setStage("error"); setError("El archivo está vacío o no se pudo leer."); return;
      }
      const hdrs = Object.keys(parsedRows[0]);
      // Detect 1-column "WEB" garbage (Power Query placeholder)
      if (hdrs.length === 1 && /^web$/i.test(hdrs[0])) {
        setStage("error");
        setError("Este archivo solo contiene una columna 'WEB' — es una consulta web vacía, no datos. Asegúrate de exportar la lista directamente desde Teams (3 puntos → Exportar a CSV).");
        return;
      }
      setHeaders(hdrs);
      setRows(parsedRows);
      setColMap(autoMap(hdrs));
      setStage("preview");
    } catch (e) {
      console.error(e);
      setStage("error"); setError(e.message || "Error al leer el archivo");
    }
  };

  // ── Photo ZIP loader ────────────────────────────────────
  const handlePhotoZip = async (file) => {
    if (!file) return;
    setPhotoStatus("Cargando librería...");
    try {
      const { map, count } = await zipToPhotoMaps(file, (i, n) => setPhotoStatus(`Procesando foto ${i}/${n}…`));
      setPhotoMap(map);
      setPhotoStatus(`✓ ${count} fotos cargadas`);
    } catch (e) {
      console.error(e);
      setPhotoStatus("❌ Error: " + (e.message || "no se pudo leer el zip"));
    }
  };

  // Photos-only import: apply a ZIP onto the CURRENT inventory (no Excel needed).
  const handlePhotosOnly = async (file) => {
    if (!file) return;
    setPhotosOnlyStatus("Leyendo zip…");
    try {
      const { map, count } = await zipToPhotoMaps(file, (i, n) => setPhotosOnlyStatus(`Procesando foto ${i}/${n}…`));
      let matched = 0;
      const next = {};
      Object.entries(currentInventory).forEach(([cabId, cab]) => {
        next[cabId] = {
          ...cab,
          shelves: cab.shelves.map((shelf) => shelf.map((it) => {
            const p = photoForItem(it, map);
            if (p) { matched++; return { ...it, photo: p }; }
            return it;
          })),
        };
      });
      setPhotosOnlyStatus(`✓ ${matched} fotos asignadas de ${count}`);
      onConfirm(next, { placed: matched, dropped: 0, mode: "merge", photosOnly: true });
    } catch (e) {
      console.error(e);
      setPhotosOnlyStatus("❌ Error: " + (e.message || "no se pudo leer el zip"));
    }
  };

  const onDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const onPickFile = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const canConfirm = preview && preview.placed > 0;

  const confirm = () => {
    if (!preview) return;
    onConfirm(preview.inventory, { placed: preview.placed, dropped: preview.dropped, mode });
  };

  return (
    <div className="theme-editor-backdrop" onClick={onClose}>
      <div className="importer" onClick={(e) => e.stopPropagation()}>
        <div className="theme-editor-header">
          <div>
            <div className="theme-editor-title">Importar inventario desde Teams</div>
            <div className="theme-editor-sub">
              Exporta tu lista de Teams a Excel o CSV y arrástrala aquí.
            </div>
          </div>
          <button className="theme-editor-close" onClick={onClose}>✕</button>
        </div>

        <div className="importer-body">
          {stage === "idle" && (
            <>
              <div className="importer-split">
                <div className="importer-drop"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="importer-drop-icon">📥</div>
                  <div className="importer-drop-title">Importar Excel / CSV</div>
                  <div className="importer-drop-sub">Arrastra el archivo o haz click. Repobla todo el inventario.</div>
                  <div className="importer-drop-formats">.xlsx · .csv</div>
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv"
                    style={{ display: "none" }} onChange={onPickFile} />
                </div>

                <div className="importer-drop importer-drop-photos"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files?.[0]; if (f) handlePhotosOnly(f); }}
                  onClick={() => photosOnlyInputRef.current?.click()}
                >
                  <div className="importer-drop-icon">🖼</div>
                  <div className="importer-drop-title">Solo fotos (ZIP)</div>
                  <div className="importer-drop-sub">
                    Añade o actualiza imágenes del inventario <strong>actual</strong>, sin reimportar el Excel.
                  </div>
                  <div className="importer-drop-formats">.zip</div>
                  {photosOnlyStatus && <div className="importer-photos-status">{photosOnlyStatus}</div>}
                  <input ref={photosOnlyInputRef} type="file" accept=".zip"
                    style={{ display: "none" }}
                    onChange={(e) => e.target.files?.[0] && handlePhotosOnly(e.target.files[0])} />
                </div>
              </div>
              <details className="importer-howto">
                <summary>📖 Cómo exportar correctamente desde Teams</summary>
                <ol>
                  <li>Abre tu lista en Teams</li>
                  <li>Pulsa los <strong>3 puntos (⋯)</strong> arriba a la derecha → <strong>Exportar</strong> → <strong>Exportar a CSV</strong> (no uses "Exportar a Excel" porque genera un archivo .iqy de consulta web)</li>
                  <li>Arrastra el .csv aquí</li>
                </ol>
                <p><strong>Para que las fotos se carguen automáticamente</strong>, tienes dos opciones:</p>
                <ul>
                  <li><strong>Opción A — Columna URL en SharePoint</strong>: cambia el tipo de columna "Imagen" a "Hipervínculo" y pega URLs públicas (Imgur, OneDrive con link público...) en cada fila. Al exportar el CSV, el importador detectará las URLs.</li>
                  <li><strong>Opción B — Carpeta ZIP</strong>: descarga las fotos a tu PC, renombra cada una con el nombre exacto del producto (ej. <code>Oculus Quest 2.jpg</code>), comprime la carpeta en .zip y súbela en el paso "Fotos" después de cargar el CSV.</li>
                </ul>
              </details>
            </>
          )}

          {stage === "parsing" && (
            <div className="importer-loading">Leyendo "{filename}"…</div>
          )}

          {stage === "error" && (
            <div className="importer-error">
              <div className="importer-error-title">Error al importar</div>
              <div className="importer-error-msg">{error}</div>
              <button className="btn btn-ghost" onClick={() => setStage("idle")}>Volver a intentarlo</button>
            </div>
          )}

          {stage === "preview" && (
            <div className="importer-preview">
              <div className="importer-section importer-photos">
                <div className="importer-section-head">
                  <h3>🖼 Fotos (opcional)</h3>
                  {photoStatus && <span className="importer-stats">{photoStatus}</span>}
                </div>
                <p className="importer-help">
                  Sube un <strong>.zip</strong> con las fotos nombradas como cada producto (ej. <code>Oculus Quest 2.jpg</code>). El sistema las empareja automáticamente.  Si la columna Imagen del CSV ya tiene URLs públicas, se usarán esas en su lugar.
                </p>
                <button className="btn btn-ghost" onClick={() => photoInputRef.current?.click()}>
                  📁 Seleccionar zip de fotos
                </button>
                <input ref={photoInputRef} type="file" accept=".zip" style={{display:'none'}}
                  onChange={(e) => e.target.files?.[0] && handlePhotoZip(e.target.files[0])} />
                {Object.keys(photoMap).length > 0 && (
                  <button className="btn btn-ghost" style={{marginLeft:8}}
                    onClick={() => { setPhotoMap({}); setPhotoStatus(null); }}>
                    Quitar fotos
                  </button>
                )}
              </div>

              <div className="importer-section">
                <div className="importer-section-head">
                  <h3>1 · Mapeo de columnas</h3>
                  <span className="importer-file">{filename} · {rows.length} filas</span>
                </div>
                <div className="importer-mapping">
                  {[
                    ["name", "Nombre del producto", true],
                    ["ubicacion", "Ubicación (A#-P#)", true],
                    ["qty", "Stock", false],
                    ["code", "Código", false],
                    ["estado", "Estado", false],
                    ["tipologia", "Tipología", false],
                    ["prestamo", "Préstamo", false],
                    ["salidas", "Salidas", false],
                    ["addedBy", "Añadido por", false],
                    ["photo", "Imagen", false],
                  ].map(([field, label, required]) => (
                    <div key={field} className="map-row">
                      <span className="map-row-label">
                        {label}{required && <span className="map-required">*</span>}
                      </span>
                      <CustomSelect
                        value={colMap[field] || ""}
                        options={headers}
                        onChange={(v) => setColMap({ ...colMap, [field]: v || undefined })}
                        placeholder="— Sin mapear —"
                        className="map-row-select-btn"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="importer-section">
                <div className="importer-section-head">
                  <h3>2 · Vista previa</h3>
                  {preview && (
                    <span className="importer-stats">
                      <strong className="ok">{preview.placed}</strong> colocados ·{" "}
                      <strong className="warn">{preview.dropped}</strong> sin ubicación válida
                      {groupDuplicates && preview.merged > 0 && <> · <strong>{preview.merged}</strong> duplicados agrupados</>}
                    </span>
                  )}
                </div>
                <label className="importer-checkbox">
                  <input type="checkbox" checked={groupDuplicates}
                    onChange={(e) => setGroupDuplicates(e.target.checked)} />
                  Agrupar duplicados (mismo nombre + misma balda → 1 caja con × N)
                </label>
                <label className="importer-checkbox">
                  <input type="checkbox" checked={smartGroup}
                    onChange={(e) => setSmartGroup(e.target.checked)} />
                  Agrupación inteligente (combinar variantes: "Resistencia 220Ω" + "Resistencia 1kΩ" → 1 caja con N variantes)
                </label>

                {!colMap.name || !colMap.ubicacion ? (
                  <div className="importer-warning">
                    Mapea al menos <em>Nombre</em> y <em>Ubicación</em> para previsualizar.
                  </div>
                ) : (
                  <div className="importer-cabinet-grid">
                    {[1,2,3,4,5,6,7].map((n) => {
                      const cab = preview?.inventory[`armario-${n}`];
                      const total = cab?.shelves.reduce((s, sh) => s + sh.length, 0) || 0;
                      return (
                        <div key={n} className="importer-cab-mini">
                          <div className="importer-cab-mini-head">
                            <span className="importer-cab-mini-code">A0{n}</span>
                            <span className="importer-cab-mini-count">{total}</span>
                          </div>
                          {cab?.shelves.map((sh, i) => (
                            <div key={i} className="importer-cab-mini-shelf">
                              <span className="shelf-num">P{i+1}</span>
                              <span className="shelf-bar">
                                <span className="shelf-fill" style={{ width: Math.min(100, sh.length * 8) + '%' }} />
                              </span>
                              <span className="shelf-count">{sh.length}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}

                {preview?.dropped > 0 && (
                  <details className="importer-dropped">
                    <summary>Ver {preview.dropped} filas sin ubicación válida</summary>
                    <div className="importer-dropped-list">
                      {rows.filter((r) => {
                        const result = rowToItem(r, colMap, photoMap);
                        return !result || !result.ubic;
                      }).slice(0, 30).map((r, i) => (
                        <div key={i} className="dropped-row">
                          <span className="dropped-name">{r[colMap.name] || "(sin nombre)"}</span>
                          <span className="dropped-loc">"{r[colMap.ubicacion] || "(vacío)"}"</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>

              <div className="importer-section">
                <h3>3 · Modo de importación</h3>
                <div className="importer-mode">
                  <label className={`mode-card ${mode === "merge" ? "active" : ""}`}>
                    <input type="radio" name="mode" value="merge"
                      checked={mode === "merge"} onChange={() => setMode("merge")} />
                    <div className="mode-card-title">Fusionar</div>
                    <div className="mode-card-sub">Mantener lo actual y añadir lo nuevo</div>
                  </label>
                  <label className={`mode-card ${mode === "replace" ? "active" : ""}`}>
                    <input type="radio" name="mode" value="replace"
                      checked={mode === "replace"} onChange={() => setMode("replace")} />
                    <div className="mode-card-title">Reemplazar</div>
                    <div className="mode-card-sub">Sustituir todo el inventario</div>
                  </label>
                </div>
              </div>

              <div className="importer-actions">
                <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
                <button className="btn btn-ghost" onClick={() => fileInputRef.current?.click()}>
                  Otro archivo
                </button>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv"
                  style={{ display: "none" }} onChange={onPickFile} />
                <button className="btn btn-primary" disabled={!canConfirm} onClick={confirm}>
                  Importar {preview?.placed || 0} objetos
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Minimal CSV parser (handles quoted fields, commas, BOM, ; vs , delimiters)
function parseCSV(text) {
  // Strip UTF-8 BOM that Excel/Teams loves to prepend
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  // Auto-detect delimiter from header line: comma vs semicolon vs tab
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let inQ = false;
  for (let i = 0; i < firstLine.length; i++) {
    const c = firstLine[i];
    if (c === '"') inQ = !inQ;
    else if (!inQ && c in counts) counts[c]++;
  }
  const delim = (counts[";"] > counts[","] && counts[";"] > counts["\t"]) ? ";"
              : (counts["\t"] > counts[","]) ? "\t"
              : ",";

  const lines = [];
  let row = [], cur = "", inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inQuote) {
      if (c === '"' && n === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuote = false; }
      else cur += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === delim) { row.push(cur); cur = ""; }
      else if (c === "\r") {}
      else if (c === "\n") { row.push(cur); lines.push(row); row = []; cur = ""; }
      else cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); lines.push(row); }
  if (!lines.length) return [];
  const headers = lines[0].map((h) => h.trim());
  return lines.slice(1).filter((r) => r.some((v) => v && v.trim().length))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

// Helper used by importFromURL in app.jsx — parses CSV text and applies the
// same auto-mapping + buildInventory pipeline so the URL importer matches the
// drag-drop importer.
function buildInventoryFromCSV(csvText, currentInventory) {
  const rows = parseCSV(csvText);
  if (!rows.length) throw new Error("CSV vacío o ilegible");
  const headers = Object.keys(rows[0]);
  const map = autoMap(headers);
  if (!map.name || !map.ubicacion) {
    throw new Error("No se encontraron columnas obligatorias (Producto y Ubicación). Cabeceras detectadas: " + headers.join(", "));
  }
  const items = rows.map((r) => rowToItem(r, map, {})).filter(Boolean);
  const built = buildInventory(items, currentInventory, "merge", true);
  return { inventory: built.inventory, stats: { placed: built.placed, dropped: built.dropped, merged: built.merged } };
}

Object.assign(window, { Importer, parseCSV, buildInventoryFromCSV });
