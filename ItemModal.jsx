// ItemModal.jsx — modal that appears when an item is clicked.
// Read mode: large photo + name + qty + location.
// Edit mode: editable fields + photo upload (simulating Teams list update).

// Slugify a material name into a safe filename base (matches Importer's slug).
function slug(s) {
  return (s || "").toString().toLowerCase().normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "material";
}

// Downscale + recompress a captured/selected photo so images stay small in
// storage (phone cameras produce multi-MB files) and upload fast to Firebase.
// Returns a JPEG data URL. Falls back to the raw file on any failure.
function compressImage(file, maxDim = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(reader.result); // fall back to raw data URL
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        try {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch (e) {
          resolve(reader.result);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function pillClass(value) {
  const v = (value || "").toLowerCase();
  if (/(ok|en lab|en el lab|si|sí|disponible)/.test(v)) return "modal-pill-ok";
  if (/(falta|averiad|no|alerta|warn|out|agotado)/.test(v)) return "modal-pill-warn";
  if (/(prestado|asignaturas|interno|para el lab|prestamo|préstamo)/.test(v)) return "modal-pill-info";
  return "modal-pill-info";
}

// Custom dropdown that positions itself relative to the trigger button.
// Avoids native <select> popup issues caused by ancestor backdrop-filter / transform.
function CustomSelect({ value, options, onChange, placeholder = "— sin definir —", className = "" }) {
  const [open, setOpen] = React.useState(false);
  const [coords, setCoords] = React.useState({ left: 0, top: 0, width: 0 });
  const btnRef = React.useRef(null);
  const menuRef = React.useRef(null);

  const updatePosition = React.useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // If menu would overflow bottom, flip it above the trigger.
    const menuH = menuRef.current?.offsetHeight || 200;
    const flip = rect.bottom + menuH + 8 > window.innerHeight;
    setCoords({
      left: rect.left,
      top: flip ? rect.top - menuH - 4 : rect.bottom + 4,
      width: rect.width,
    });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    updatePosition();
    const onScroll = () => updatePosition();
    const onClickOutside = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, updatePosition]);

  const display = value || placeholder;
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`modal-input modal-custom-select-btn ${className}`}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        <span className={value ? "" : "modal-custom-select-placeholder"}>{display}</span>
        <span className="modal-custom-select-caret">▾</span>
      </button>
      {open && ReactDOM.createPortal(
        <div
          ref={menuRef}
          className="modal-custom-select-menu"
          style={{ left: coords.left, top: coords.top, width: coords.width }}
        >
          <button
            type="button"
            className={`modal-custom-select-option ${!value ? "is-selected" : ""}`}
            onClick={() => { onChange(""); setOpen(false); }}
          >
            {placeholder}
          </button>
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`modal-custom-select-option ${value === opt ? "is-selected" : ""}`}
              onClick={() => { onChange(opt); setOpen(false); }}
            >
              {opt}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

function ItemModal({ item, cabinetId, shelfIdx, editorMode, onClose, onSave, onDelete }) {
  const [draft, setDraft] = React.useState(item);
  const [isEditing, setIsEditing] = React.useState(false);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const fileRef = React.useRef(null);
  const camRef = React.useRef(null);

  React.useEffect(() => {
    setDraft(item);
    setIsEditing(false);
  }, [item]);

  if (!item) return null;

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the user re-pick the same file / re-shoot
    if (!file) return;
    setPhotoBusy(true);
    try {
      const dataUrl = await compressImage(file);
      // Compression always emits JPEG → the stored filename is <slug>.jpg, kept
      // in sync with the material's name so exports pair back by filename.
      setDraft((d) => ({
        ...d,
        photo: dataUrl,
        photoName: slug(d.name || "material") + ".jpg",
      }));
    } catch (err) {
      alert("No se pudo procesar la foto: " + (err?.message || err));
    } finally {
      setPhotoBusy(false);
    }
  };

  const save = () => {
    onSave(cabinetId, shelfIdx, draft);
    setIsEditing(false);
  };

  const showEditing = editorMode && isEditing;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Cerrar">✕</button>

        <div className="modal-photo">
          {draft.photo ? (
            <img src={draft.photo} alt={draft.name} />
          ) : (
            <div className="modal-photo-placeholder">
              <div className="placeholder-stripes" />
              <div className="placeholder-label">SIN FOTO</div>
              <div className="placeholder-sub">Añade desde la lista de Teams</div>
            </div>
          )}
          {showEditing && (
            <div className="modal-photo-actions">
              <button
                className="modal-photo-upload"
                onClick={() => camRef.current?.click()}
                disabled={photoBusy}
              >
                {photoBusy ? "Procesando…" : "📷 Hacer foto"}
              </button>
              <button
                className="modal-photo-upload secondary"
                onClick={() => fileRef.current?.click()}
                disabled={photoBusy}
              >
                {draft.photo ? "🖼 Cambiar" : "🖼 Galería"}
              </button>
              {/* capture="environment" opens the rear camera directly on phones */}
              <input
                ref={camRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: "none" }}
                onChange={handlePhoto}
              />
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handlePhoto}
              />
            </div>
          )}
        </div>

        <div className="modal-body">
          <div className="modal-tag">{draft.tag}</div>

          {showEditing ? (
            <input
              className="modal-input modal-name-input"
              value={draft.name}
              onChange={(e) => {
                const name = e.target.value;
                // Keep the photo's filename in sync with the material name
                const next = { ...draft, name };
                if (draft.photo && draft.photoName) {
                  const ext = (draft.photoName.match(/\.[^.]+$/) || [".jpg"])[0];
                  next.photoName = slug(name || "material") + ext;
                }
                setDraft(next);
              }}
            />
          ) : (
            <h2 className="modal-name">{draft.name}</h2>
          )}

          <div className="modal-grid">
            <div className="modal-field">
              <span className="modal-field-label">Cantidad</span>
              {showEditing ? (
                <input
                  type="number"
                  className="modal-input"
                  value={draft.qty}
                  onChange={(e) => setDraft({ ...draft, qty: Number(e.target.value) || 0 })}
                />
              ) : (
                <span className="modal-field-value modal-qty">{draft.qty}</span>
              )}
            </div>
            <div className="modal-field">
              <span className="modal-field-label">Ubicación</span>
              {showEditing ? (
                <input
                  className="modal-input"
                  value={draft.location}
                  onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                />
              ) : (
                <span className="modal-field-value">{draft.location}</span>
              )}
            </div>
            <div className="modal-field">
              <span className="modal-field-label">Etiqueta</span>
              {showEditing ? (
                <input
                  className="modal-input"
                  value={draft.tag}
                  onChange={(e) => setDraft({ ...draft, tag: e.target.value })}
                />
              ) : (
                <span className="modal-field-value">{draft.tag}</span>
              )}
            </div>
            {showEditing && (
              <div className="modal-field">
                <span className="modal-field-label">ID</span>
                <span className="modal-field-value modal-id">{draft.id}</span>
              </div>
            )}
            {(draft.code || showEditing) && (
              <div className="modal-field">
                <span className="modal-field-label">Código</span>
                {showEditing ? (
                  <input className="modal-input" value={draft.code || ""}
                    onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
                ) : (
                  <span className="modal-field-value">{draft.code}</span>
                )}
              </div>
            )}
            {(draft.estado || showEditing) && (
              <div className="modal-field">
                <span className="modal-field-label">Estado</span>
                {showEditing ? (
                  <CustomSelect
                    value={draft.estado || ""}
                    options={["OK", "Falta", "Prestado", "Averíado"]}
                    onChange={(v) => setDraft({ ...draft, estado: v })}
                  />
                ) : (
                  <span className={`modal-pill ${pillClass(draft.estado)}`}>{draft.estado}</span>
                )}
              </div>
            )}
            {(draft.tipologia || showEditing) && (
              <div className="modal-field">
                <span className="modal-field-label">Tipología</span>
                {showEditing ? (
                  <CustomSelect
                    value={draft.tipologia || ""}
                    options={["Máquina", "Herramienta", "Fungible", "Accesorio", "Componente"]}
                    onChange={(v) => setDraft({ ...draft, tipologia: v })}
                  />
                ) : (
                  <span className="modal-pill modal-pill-info">{draft.tipologia}</span>
                )}
              </div>
            )}
            {(draft.prestamo || showEditing) && (
              <div className="modal-field">
                <span className="modal-field-label">Tipo de uso</span>
                {showEditing ? (
                  <CustomSelect
                    value={draft.prestamo || ""}
                    options={["En el lab", "Asignaturas", "Interno"]}
                    onChange={(v) => setDraft({ ...draft, prestamo: v })}
                  />
                ) : (
                  <span className={`modal-pill ${pillClass(draft.prestamo)}`}>{draft.prestamo}</span>
                )}
              </div>
            )}
            {(draft.salidas || showEditing) && (
              <div className="modal-field">
                <span className="modal-field-label">Salidas</span>
                {showEditing ? (
                  <input className="modal-input" value={draft.salidas || ""}
                    onChange={(e) => setDraft({ ...draft, salidas: e.target.value })} />
                ) : (
                  <span className="modal-field-value">{draft.salidas}</span>
                )}
              </div>
            )}
            {showEditing && (
              <div className="modal-field">
                <span className="modal-field-label">Añadido por</span>
                <input className="modal-input" value={draft.addedBy || ""}
                  onChange={(e) => setDraft({ ...draft, addedBy: e.target.value })} />
              </div>
            )}
          </div>

          <div className="modal-source">
            <div className="modal-source-dot" />
            <span>Sincronizado desde lista <b>Inventario · Teams</b></span>
          </div>

          {editorMode && (
            <div className="modal-actions">
              {isEditing ? (
                <>
                  <button className="btn btn-primary" onClick={save}>Guardar cambios</button>
                  <button className="btn btn-ghost" onClick={() => { setDraft(item); setIsEditing(false); }}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <button className="btn btn-primary" onClick={() => setIsEditing(true)}>
                    Editar
                  </button>
                  <button className="btn btn-danger" onClick={() => onDelete(cabinetId, shelfIdx, item.id)}>
                    Eliminar
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ItemModal, CustomSelect });
