// Cabinet.jsx — single industrial-style cabinet with two doors that open in 3D.
// Closed: shows cabinet body + closed doors + label plate.
// Hovered (in row): scales up, neighbors move aside (handled by parent flex gap + the
//                    scale on this element which pushes neighbors via grow).
// Open: doors swing out, revealing 5 shelves with items.

function Cabinet({
  id,
  data,
  totalCount,
  isOpen,
  isHoveredAny,
  isThisHovered,
  isScanning,
  highlightedItemId,
  onHover,
  onLeave,
  onClick,
  onItemClick,
  onItemAdd,
  editorMode,
  scaleAmount,
}) {
  // Hover scale: target only the currently-hovered cabinet. Others remain at 1
  // but the row's flex layout pushes them sideways naturally because the
  // hovered one grows.
  const hoverScale = isThisHovered ? 1 + (scaleAmount / 100) : 1;
  const dimOthers  = isHoveredAny && !isThisHovered ? 0.55 : 1;

  // Wheel-zoom state (only active when this cabinet is open)
  // Wheel without modifier = vertical scroll inside the cabinet (default browser behavior)
  // Ctrl/Cmd + Wheel = zoom
  const [zoom, setZoom] = React.useState(1);
  const [origin, setOrigin] = React.useState({ x: 50, y: 50 });
  const [pan, setPan] = React.useState({ x: 0, y: 0 }); // px offset applied as translate
  const wrapRef = React.useRef(null);
  const panState = React.useRef({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0 });

  // Reset zoom when opening/closing
  React.useEffect(() => {
    if (!isOpen) {
      setZoom(1);
      setOrigin({ x: 50, y: 50 });
      setPan({ x: 0, y: 0 });
    }
  }, [isOpen]);

  const onWheel = React.useCallback((e) => {
    if (!isOpen) return;
    // Only intercept when user holds Ctrl/Cmd — otherwise let the cabinet's
    // interior scroll naturally so they can reach off-screen shelves.
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;
    setOrigin({ x: Math.max(0, Math.min(100, px)), y: Math.max(0, Math.min(100, py)) });
    setZoom((z) => {
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const next = Math.max(1, Math.min(3.5, z * factor));
      // When fully zoomed out, also reset pan; otherwise clamp existing pan
      if (next === 1) setPan({ x: 0, y: 0 });
      else setPan((p) => {
        const el = wrapRef.current;
        if (!el) return p;
        const rect = el.getBoundingClientRect();
        const maxX = (rect.width * (next - 1)) / 2;
        const maxY = (rect.height * (next - 1)) / 2;
        return {
          x: Math.max(-maxX, Math.min(maxX, p.x)),
          y: Math.max(-maxY, Math.min(maxY, p.y)),
        };
      });
      return next;
    });
  }, [isOpen]);

  // Middle-mouse pan when zoomed in (button === 1)
  // Pan is clamped so the cabinet edges never separate from the visible area.
  const clampPan = React.useCallback((px, py, z) => {
    const el = wrapRef.current;
    if (!el) return { x: px, y: py };
    const rect = el.getBoundingClientRect();
    // The scaled element extends (z-1)*size beyond its base bounds, distributed
    // around the transform-origin. Maximum allowed translate magnitude in each
    // axis is half of that overflow.
    const maxX = (rect.width  * (z - 1)) / 2;
    const maxY = (rect.height * (z - 1)) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, px)),
      y: Math.max(-maxY, Math.min(maxY, py)),
    };
  }, []);

  const onMouseDown = React.useCallback((e) => {
    if (!isOpen) return;
    if (e.button !== 1) return; // only middle button
    if (zoom <= 1) return; // no panning until zoomed in
    e.preventDefault();
    e.stopPropagation();
    panState.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      baseX: pan.x,
      baseY: pan.y,
    };
    const onMove = (ev) => {
      if (!panState.current.active) return;
      const dx = ev.clientX - panState.current.startX;
      const dy = ev.clientY - panState.current.startY;
      const next = clampPan(panState.current.baseX + dx, panState.current.baseY + dy, zoom);
      setPan(next);
    };
    const onUp = () => {
      panState.current.active = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "grabbing";
  }, [isOpen, zoom, pan]);

  // Attach wheel listener as non-passive so preventDefault works
  React.useEffect(() => {
    if (!isOpen) return;
    const el = wrapRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [isOpen, onWheel]);

  // When fully open, neutralize hover scale and apply the wheel zoom instead.
  const finalScale = isOpen ? zoom : hoverScale;
  const transformOrigin = isOpen ? `${origin.x}% ${origin.y}%` : 'center center';
  const translatePart = isOpen && (pan.x !== 0 || pan.y !== 0) ? ` translate(${pan.x}px, ${pan.y}px)` : '';

  return (
    <div
      ref={wrapRef}
      className={`cab-wrap ${isOpen ? 'is-open' : ''} ${isThisHovered ? 'is-hovered' : ''} ${isScanning ? 'is-scanning' : ''}`}
      onMouseEnter={() => !isOpen && onHover(id)}
      onMouseLeave={() => !isOpen && onLeave()}
      onMouseDown={onMouseDown}
      onAuxClick={(e) => { if (e.button === 1) e.preventDefault(); }}
      onClick={(e) => { if (!isOpen) { e.stopPropagation(); onClick(id); } }}
      style={{
        transform: `scale(${finalScale})${translatePart}`,
        transformOrigin,
        transition: isOpen ? 'transform 0.08s ease-out' : undefined,
        opacity: dimOthers,
        zIndex: isThisHovered || isOpen ? 5 : 1,
        cursor: isOpen && zoom > 1 ? 'grab' : undefined,
      }}
    >
      <div className="cab-body">
        {/* Back panel + interior with shelves — only mounted when opening/open
            so the closed cabinets show only their doors, never the contents. */}
        {isOpen && (
        <div className="cab-interior">
          {/* Brand plate at top inside */}
          <div className="cab-interior-top">
            <div className="cab-plate">
              <span className="cab-plate-code">{data.code}</span>
              <span className="cab-plate-name">{data.name}</span>
            </div>
          </div>

          {/* 5 shelves — rendered top-to-bottom in DOM, but labeled B1=bottom → B5=top */}
          <div className="cab-shelves"><div className="cab-edge-top"></div><div className="cab-edge-bot"></div>
            {[...data.shelves].map((_, i) => i).reverse().map((sIdx) => {
              const shelf = data.shelves[sIdx];
              return (
                <div key={sIdx} className="cab-shelf">
                  <div className="cab-shelf-row">
                    {shelf.map((item) => (
                      <ItemBox
                        key={item.id}
                        item={item}
                        highlighted={highlightedItemId === item.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onItemClick(id, sIdx, item);
                        }}
                      />
                    ))}
                    {editorMode && (
                      <button
                        className="cab-add-item"
                        onClick={(e) => {
                          e.stopPropagation();
                          onItemAdd(id, sIdx);
                        }}
                        title="Añadir objeto"
                      >+</button>
                    )}
                  </div>
                  <div className="cab-shelf-board" />
                  <div className="cab-shelf-label">
                    B{sIdx + 1}{shelf.length > 0 && <span className="cab-shelf-count"> · {shelf.length}</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bottom rail */}
          <div className="cab-bottom-rail" />
        </div>
        )}

        {/* Solid cabinet shell — visible when closed, behind the doors */}
        {!isOpen && <div className="cab-shell" />}

        {/* Doors */}
        <div className={`cab-door cab-door-l ${isOpen ? 'open' : ''}`}>
          <div className="cab-door-inner">
            <div className="cab-door-rivets">
              <span /><span /><span /><span />
            </div>
            <div className="cab-door-handle cab-door-handle-l" />
          </div>
        </div>
        <div className={`cab-door cab-door-r ${isOpen ? 'open' : ''}`}>
          <div className="cab-door-inner">
            <div className="cab-door-rivets">
              <span /><span /><span /><span />
            </div>
            <div className="cab-door-handle cab-door-handle-r" />
          </div>
        </div>

        {/* Floor shadow */}
        <div className="cab-shadow" />
      </div>

      {/* Front label (closed state) */}
      <div className="cab-front-label">
        <div className="cab-front-code">{data.code}</div>
        <div className="cab-front-name">{data.name}</div>
        <div className="cab-front-count">{totalCount} ítems</div>
      </div>
    </div>
  );
}

function ItemBox({ item, highlighted, onClick }) {
  const ref = React.useRef(null);
  // When this item gets highlighted by search, smoothly center it inside the
  // cabinet's scroll container so the user can see the neon flash even if it
  // was on a lower shelf. Runs after a tick so the layout has settled.
  React.useEffect(() => {
    if (!highlighted || !ref.current) return;
    const el = ref.current;
    // Retry several times to wait for the cabinet open animation (~700ms)
    // and any layout reflow before scrolling. Each attempt re-checks if the
    // item is offscreen and re-centers it. Cabinet's overflow:auto means
    // the browser clamps scrollTop, so we never overshoot the cabinet bounds.
    const timeouts = [];
    const tryScroll = () => {
      const parent = el.closest('.cab-interior');
      if (!parent) return;
      const itemRect = el.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      // Only scroll if the item is not already visually centered (within 20px)
      const desiredOffset =
        (itemRect.top - parentRect.top) -
        (parentRect.height / 2 - itemRect.height / 2);
      if (Math.abs(desiredOffset) > 20) {
        parent.scrollTo({
          top: parent.scrollTop + desiredOffset,
          behavior: "smooth"
        });
      }
    };
    // Schedule multiple attempts: immediately, after open animation,
    // and after content settles.
    [50, 300, 800, 1200].forEach(delay => {
      timeouts.push(setTimeout(tryScroll, delay));
    });
    return () => timeouts.forEach(clearTimeout);
  }, [highlighted]);

  return (
    <div
      ref={ref}
      className={`item-box ${highlighted ? 'highlighted' : ''}`}
      onClick={onClick}
      title={`${item.name} · ${item.qty} uds`}
    >
      <div className="item-thumb">
        {item.photo ? (
          <img src={item.photo} alt={item.name} />
        ) : (
          <PhotoPlaceholder label={item.name} />
        )}
        {item.qty > 1 && <span className="item-qty-badge">×{item.qty}</span>}
      </div>
      <div className="item-meta">
        <span className="item-name">{item.name}</span>
      </div>
    </div>
  );
}

// Striped placeholder when a Teams photo isn't attached yet.
function PhotoPlaceholder({ label }) {
  // Compact two-letter glyph from the name.
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <div className="item-placeholder">
      <span>{initials}</span>
    </div>
  );
}

Object.assign(window, { Cabinet, ItemBox, PhotoPlaceholder });
