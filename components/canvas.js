// ============================================================
// VIEWPORT: pan + zoom
// ============================================================
// The old version re-positioned every node (and rebuilt its SVG) on every
// pan/zoom frame. Here the whole diagram lives inside #world and a single
// CSS transform moves it, so pan/zoom cost is constant regardless of how
// many shapes exist.
function applyViewport() {
  const { zoom, panX, panY } = viewport;
  worldEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  // Handles, hit areas and outlines multiply by this to stay a fixed size
  // on screen (see nodes.css / canvas.css).
  canvasContainer.style.setProperty('--inv-zoom', 1 / zoom);

  // Keep the dot grid locked to canvas space.
  const grid = SNAP * 3 * zoom;
  canvasContainer.style.backgroundSize = `${grid}px ${grid}px`;
  canvasContainer.style.backgroundPosition = `${panX}px ${panY}px`;

  document.getElementById('zoom-display').textContent = Math.round(zoom * 100) + '%';
}

// Zoom to `newZoom`, keeping the canvas point under screen point (sx, sy)
// fixed on screen.
function zoomAt(sx, sy, newZoom) {
  newZoom = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);
  // Clamp BEFORE adjusting pan. The old version adjusted pan using the
  // unclamped factor, so scrolling past max/min zoom made the view drift.
  const ratio = newZoom / viewport.zoom;
  viewport.panX = sx - (sx - viewport.panX) * ratio;
  viewport.panY = sy - (sy - viewport.panY) * ratio;
  viewport.zoom = newZoom;
  applyViewport();
}

// Toolbar/keyboard zoom anchors on the viewport center. (Old version
// anchored on canvas origin, so the content slid toward the top-left.)
function zoomByFactor(factor) {
  if (isNavigating) return;
  const rect = canvasContainer.getBoundingClientRect();
  zoomAt(rect.width / 2, rect.height / 2, viewport.zoom * factor);
  checkAutoZoomDrill(rect.width / 2, rect.height / 2);
}
function zoomIn() { zoomByFactor(1.2); }
function zoomOut() { zoomByFactor(1 / 1.2); }

function resetView() {
  viewport.zoom = 1;
  viewport.panX = 0;
  viewport.panY = 0;
  applyViewport();
}

// Zoom/pan so every shape fits, with padding. Never zooms in past 200%.
function fitToScreen() {
  if (!state.placements.length) { resetView(); return; }
  const rect = canvasContainer.getBoundingClientRect();
  const minX = Math.min(...state.placements.map(p => p.x));
  const minY = Math.min(...state.placements.map(p => p.y));
  const maxX = Math.max(...state.placements.map(p => p.x + p.w));
  const maxY = Math.max(...state.placements.map(p => p.y + p.h));
  const pad = 60;
  const zoom = clamp(Math.min(
    (rect.width - pad * 2) / Math.max(1, maxX - minX),
    (rect.height - pad * 2) / Math.max(1, maxY - minY),
    2), MIN_ZOOM, MAX_ZOOM);
  viewport.zoom = zoom;
  // Centered (old version pinned the content to the top-left padding).
  viewport.panX = rect.width / 2 - ((minX + maxX) / 2) * zoom;
  viewport.panY = rect.height / 2 - ((minY + maxY) / 2) * zoom;
  applyViewport();
}

canvasContainer.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (isNavigating) return; // the drill animation owns the view
  // Normalize: Firefox can report in lines (deltaMode 1) instead of pixels.
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  // Exponential mapping: a mouse notch (~100px) is ~14% zoom, and small
  // trackpad/pinch deltas give proportionally small, smooth steps.
  const factor = Math.exp(-dy * 0.0015);
  const s = eventToScreen(e);
  zoomAt(s.x, s.y, viewport.zoom * factor);
  // Zoomed far enough into a shape with a sub-diagram (or out of one)?
  checkAutoZoomDrill(s.x, s.y);
}, { passive: false });

// ============================================================
// POINTER INTERACTIONS
// ============================================================
// The old version tracked each gesture with its own global flags
// (isDragging, isResizing, isConnecting, isReconnecting, isBoxSelecting,
// isDraggingLabel, isPanning + their data). Here there is ONE `drag`
// object describing the gesture in progress:
//
//   { start: {x, y},        pointer position on pointerdown (client px)
//     started: false,       becomes true once it moves > DRAG_THRESHOLD
//     onStart(), move(e), end(e), cancel() }
//
// pointerdown builds it, pointermove/up drive it, Esc cancels it.
const DRAG_THRESHOLD = 3;
let drag = null;
let spaceHeld = false;

canvasContainer.addEventListener('pointerdown', (e) => {
  hideCtxMenu();
  if (drag || isNavigating) return;
  const t = e.target;
  if (t.closest('#mini-toolbar') || t.closest('#breadcrumb-bar') || t.closest('.node-label-editor')) return;

  // Panning: middle mouse, Space + drag, or the Pan tool.
  if (e.button === 1 || (e.button === 0 && (spaceHeld || currentTool === 'pan'))) {
    e.preventDefault();
    startPan(e);
    return;
  }
  if (e.button !== 0) return;

  // Close any open edit first so it becomes its own undo step.
  flushPendingEdits();

  const nodeEl = t.closest('.diagram-node');
  const placement = nodeEl && getPlacementById(nodeEl.dataset.id);
  const connEl = t.closest('.conn-group');
  const canEdit = currentTool === 'select' || currentTool === 'connect';

  if (placement && t.closest('.node-drill-badge')) {
    openSubDiagram(placement);
  } else if (t.classList.contains('conn-endpoint-handle')) {
    startReconnect(e, getConnById(t.dataset.connId), t.dataset.end);
  } else if (placement && t.classList.contains('resize-handle')) {
    startResize(e, placement);
  } else if (placement && t.classList.contains('label-handle')) {
    startLabelDrag(e, placement);
  } else if (placement && canEdit && t.classList.contains('conn-handle')) {
    startConnect(e, placement, t.dataset.pos);
  } else if (placement && currentTool === 'connect') {
    startConnect(e, placement, nearestEdgeAnchor(placement, eventToCanvas(e)));
  } else if (placement && currentTool === 'select') {
    startMove(e, placement);
  } else if (connEl && currentTool === 'select') {
    selectConnection(getConnById(connEl.dataset.id), { toggle: e.shiftKey });
  } else if (!placement && !connEl && currentTool === 'select') {
    startBoxSelect(e);
  }
});

canvasContainer.addEventListener('pointermove', (e) => {
  const pt = eventToCanvas(e);
  document.getElementById('status-pos').textContent = `${Math.round(pt.x)}, ${Math.round(pt.y)}`;
  if (!drag) return;
  if (!drag.started) {
    if (Math.hypot(e.clientX - drag.start.x, e.clientY - drag.start.y) < DRAG_THRESHOLD) return;
    drag.started = true;
    // Capture only once it's really a drag. Capturing on pointerdown
    // would retarget the following click/dblclick to the container, which
    // breaks double-click-to-edit.
    canvasContainer.setPointerCapture(e.pointerId);
    if (drag.onStart) drag.onStart(e);
  }
  drag.move(e);
});

function endDrag(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (canvasContainer.hasPointerCapture(e.pointerId)) canvasContainer.releasePointerCapture(e.pointerId);
  if (d.end) d.end(e);
}
canvasContainer.addEventListener('pointerup', endDrag);
canvasContainer.addEventListener('pointercancel', (e) => cancelDrag(e));

function cancelDrag(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (e && e.pointerId !== undefined && canvasContainer.hasPointerCapture(e.pointerId)) canvasContainer.releasePointerCapture(e.pointerId);
  if (d.cancel) d.cancel();
}

// Middle-click autoscroll can only be cancelled from mousedown.
canvasContainer.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });

// ------------------------------------------------------------
// Gestures
// ------------------------------------------------------------
function startPan(e) {
  const origin = { panX: viewport.panX, panY: viewport.panY };
  canvasContainer.classList.add('panning');
  drag = {
    start: { x: e.clientX, y: e.clientY },
    started: false,
    move(ev) {
      viewport.panX = origin.panX + (ev.clientX - this.start.x);
      viewport.panY = origin.panY + (ev.clientY - this.start.y);
      applyViewport();
    },
    end() { canvasContainer.classList.remove('panning'); },
    cancel() { canvasContainer.classList.remove('panning'); },
  };
}

// Click selects; drag moves the whole selection. The grabbed shape snaps
// to the grid and the rest keep their offsets from it. (Old version snapped
// every shape separately, so their spacing shifted.) Alt = no snapping.
function startMove(e, placement) {
  const wasSelected = selectedIds.has(placement.id);
  if (e.shiftKey) togglePlacement(placement);
  else if (!wasSelected) selectPlacement(placement);
  if (!selectedIds.has(placement.id)) return; // shift-click just deselected it

  const startPt = eventToCanvas(e);
  const moving = getSelectedPlacements();
  const origins = new Map(moving.map(p => [p.id, { x: p.x, y: p.y }]));
  const entityIds = new Set(moving.map(p => p.entityId));
  const anchor = origins.get(placement.id);

  drag = {
    start: { x: e.clientX, y: e.clientY },
    started: false,
    onStart: () => beginChange(),
    move(ev) {
      const pt = eventToCanvas(ev);
      let dx = pt.x - startPt.x, dy = pt.y - startPt.y;
      if (!ev.altKey) {
        dx = snap(anchor.x + dx) - anchor.x;
        dy = snap(anchor.y + dy) - anchor.y;
      }
      moving.forEach(p => {
        const o = origins.get(p.id);
        p.x = o.x + dx; p.y = o.y + dy;
        updatePlacementEl(getPlacementEl(p.id), p);
      });
      refreshConnectionsFor(entityIds);
      updatePropsPanel();
    },
    end() {
      if (this.started) { commitChange(); return; }
      // Plain click on an already-selected shape in a multi-selection:
      // narrow to just that one (its group).
      if (wasSelected && !e.shiftKey && selectedIds.size > 1) selectPlacement(placement);
    },
    cancel: () => cancelChange(),
  };
}

// Bottom-right handle. Shift keeps the aspect ratio; snaps unless Alt.
function startResize(e, placement) {
  if (!selectedIds.has(placement.id)) selectPlacement(placement);
  const origin = { w: placement.w, h: placement.h };
  drag = {
    start: { x: e.clientX, y: e.clientY },
    started: false,
    onStart: () => beginChange(),
    move(ev) {
      let w = origin.w + (ev.clientX - this.start.x) / viewport.zoom;
      let h = origin.h + (ev.clientY - this.start.y) / viewport.zoom;
      if (!ev.altKey) { w = snap(placement.x + w) - placement.x; h = snap(placement.y + h) - placement.y; }
      if (ev.shiftKey) {
        const s = Math.max(w / origin.w, h / origin.h);
        w = origin.w * s; h = origin.h * s;
      }
      placement.w = Math.max(MIN_NODE_SIZE, w);
      placement.h = Math.max(MIN_NODE_SIZE, h);
      updatePlacementEl(getPlacementEl(placement.id), placement);
      refreshConnectionsFor(new Set([placement.entityId]));
      updatePropsPanel();
    },
    end() { if (this.started) commitChange(); },
    cancel: () => cancelChange(),
  };
}

// Moves the label inside its shape. Old version: any drag starting on the
// label text moved the label instead of the shape, and the label covers
// most of a shape, so shapes were hard to move. Now there's a dedicated
// handle, shown when exactly one shape is selected.
function startLabelDrag(e, placement) {
  const startPt = eventToCanvas(e);
  const origin = { x: placement.labelOffsetX || 0, y: placement.labelOffsetY || 0 };
  drag = {
    start: { x: e.clientX, y: e.clientY },
    started: false,
    onStart: () => beginChange(),
    move(ev) {
      const pt = eventToCanvas(ev);
      placement.labelOffsetX = origin.x + (pt.x - startPt.x);
      placement.labelOffsetY = origin.y + (pt.y - startPt.y);
      updatePlacementEl(getPlacementEl(placement.id), placement);
    },
    end() { if (this.started) commitChange(); },
    cancel: () => cancelChange(),
  };
}

// Dashed preview line in the overlay SVG, used by connect + reconnect.
function makeTempLine(from) {
  const line = svgEl('line', { x1: from.x, y1: from.y, x2: from.x, y2: from.y, class: 'temp-conn-line' });
  overlaySvg.appendChild(line);
  return line;
}

// The node under the pointer, ignoring the dragged preview.
function nodeAtPoint(ev) {
  for (const el of document.elementsFromPoint(ev.clientX, ev.clientY)) {
    const nodeEl = el.closest && el.closest('.diagram-node');
    if (nodeEl) return getPlacementById(nodeEl.dataset.id);
  }
  return null;
}

function setDropTarget(placement) {
  worldEl.querySelectorAll('.diagram-node.drop-target').forEach(el => el.classList.remove('drop-target'));
  if (placement) getPlacementEl(placement.id).classList.add('drop-target');
}

// Drag from a side handle (or anywhere on a shape with the Connect tool)
// to another shape. Drop on a side handle to use that exact side,
// otherwise the nearest point on the border is used.
function startConnect(e, placement, fromHandle) {
  const from = getHandleRatioPoint(placement, fromHandle);
  let line = null;
  drag = {
    start: { x: e.clientX, y: e.clientY },
    started: false,
    onStart() { line = makeTempLine(from); },
    move(ev) {
      const pt = eventToCanvas(ev);
      line.setAttribute('x2', pt.x); line.setAttribute('y2', pt.y);
      const target = nodeAtPoint(ev);
      setDropTarget(target && target.entityId !== placement.entityId ? target : null);
    },
    end(ev) {
      setDropTarget(null);
      if (line) line.remove();
      if (!this.started) return;
      const target = nodeAtPoint(ev);
      if (!target || target.entityId === placement.entityId) return;
      const handleEl = document.elementsFromPoint(ev.clientX, ev.clientY).find(el => el.classList && el.classList.contains('conn-handle'));
      const toHandle = handleEl ? handleEl.dataset.pos : nearestEdgeAnchor(target, eventToCanvas(ev));
      recordChange(() => {
        const conn = addConnection(placement.entityId, target.entityId, fromHandle, toHandle);
        selectConnection(conn);
      });
    },
    cancel() { setDropTarget(null); if (line) line.remove(); },
  };
}

// Drag a selected connection's endpoint onto another shape.
function startReconnect(e, conn, end) {
  if (!conn) return;
  const ends = getConnectionEnds(conn);
  const fixed = end === 'from' ? ends.to : ends.from;
  const g = getConnEl(conn.id);
  let line = null;
  drag = {
    start: { x: e.clientX, y: e.clientY },
    started: false,
    onStart() { line = makeTempLine(fixed); if (g) g.style.opacity = '0.25'; },
    move(ev) {
      const pt = eventToCanvas(ev);
      line.setAttribute('x2', pt.x); line.setAttribute('y2', pt.y);
      setDropTarget(nodeAtPoint(ev));
    },
    end(ev) {
      this.cancel();
      if (!this.started) return;
      const target = nodeAtPoint(ev);
      if (target) reconnectEndpoint(conn, end, target, eventToCanvas(ev));
    },
    cancel() { setDropTarget(null); if (line) line.remove(); if (g) g.style.opacity = ''; },
  };
}

// Drag on empty canvas. Shift adds to the selection (old version always
// cleared it first -- audit #16). A plain click clears the selection.
function startBoxSelect(e) {
  const box = document.getElementById('select-box');
  const startScreen = eventToScreen(e);
  const startPt = eventToCanvas(e);
  drag = {
    start: { x: e.clientX, y: e.clientY },
    started: false,
    onStart() { box.style.display = 'block'; },
    move(ev) {
      const s = eventToScreen(ev);
      box.style.left = Math.min(s.x, startScreen.x) + 'px';
      box.style.top = Math.min(s.y, startScreen.y) + 'px';
      box.style.width = Math.abs(s.x - startScreen.x) + 'px';
      box.style.height = Math.abs(s.y - startScreen.y) + 'px';
    },
    end(ev) {
      box.style.display = 'none';
      if (!this.started) { if (!ev.shiftKey) clearSelection(); return; }
      const pt = eventToCanvas(ev);
      selectInRect({
        x1: Math.min(pt.x, startPt.x), y1: Math.min(pt.y, startPt.y),
        x2: Math.max(pt.x, startPt.x), y2: Math.max(pt.y, startPt.y),
      }, ev.shiftKey);
    },
    cancel() { box.style.display = 'none'; },
  };
}

// ============================================================
// DOUBLE-CLICK / TEXT TOOL
// ============================================================
//   on a shape      -> edit its label
//   on a connection -> select it and jump to its label field (old version
//                      used a prompt() dialog)
//   on empty canvas -> new text box (Select tool only)
canvasContainer.addEventListener('dblclick', (e) => {
  if (spaceHeld || currentTool === 'pan') return;
  const nodeEl = e.target.closest('.diagram-node');
  if (nodeEl) {
    if (e.target.closest('.node-label-editor')) return; // word-select inside editor
    const p = getPlacementById(nodeEl.dataset.id);
    if (p) startEditLabel(p);
    return;
  }
  const connEl = e.target.closest('.conn-group');
  if (connEl) {
    selectConnection(getConnById(connEl.dataset.id));
    const input = document.getElementById('conn-label-input');
    input.focus(); input.select();
    return;
  }
  if (currentTool === 'select' && e.target.closest('#canvas')) createTextBoxAt(eventToCanvas(e));
});

// Text tool: a single click on empty canvas adds a text box, then switches
// back to Select (same as old). 'click' rather than pointerdown: pointerdown
// is followed by a focus change that would instantly close the new editor.
canvasEl.addEventListener('click', (e) => {
  if (currentTool !== 'text' || e.button !== 0 || spaceHeld) return;
  if (e.target.closest('.diagram-node') || e.target.closest('.conn-group')) return;
  setTool('select');
  createTextBoxAt(eventToCanvas(e));
});

// ============================================================
// CONTEXT MENU
// ============================================================
const ctxMenu = document.getElementById('ctx-menu');

canvasContainer.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (e.target.closest('#mini-toolbar')) return;
  flushPendingEdits();
  // Right-clicking something unselected selects it first, so the menu acts
  // on what you clicked.
  const nodeEl = e.target.closest('.diagram-node');
  const connEl = e.target.closest('.conn-group');
  if (nodeEl && !selectedIds.has(nodeEl.dataset.id)) selectPlacement(getPlacementById(nodeEl.dataset.id));
  else if (connEl && !selectedConnIds.has(connEl.dataset.id)) selectConnection(getConnById(connEl.dataset.id));
  showCtxMenu(e.clientX, e.clientY);
});

function showCtxMenu(x, y) {
  const nodes = selectedIds.size, any = nodes + selectedConnIds.size;
  const enable = (action, on) => ctxMenu.querySelector(`[data-action="${action}"]`).classList.toggle('disabled', !on);
  enable('copy', nodes > 0);
  enable('duplicate', nodes > 0);
  enable('paste', !!clipboard);
  enable('front', nodes > 0);
  enable('back', nodes > 0);
  enable('group', nodes > 1);
  enable('ungroup', getSelectedPlacements().some(p => p.group));
  enable('delete', any > 0);
  // Sub-diagram items act on a single selected shape.
  const single = nodes === 1 && selectedConnIds.size === 0 ? getSelectedPlacements()[0] : null;
  const linked = hasSubDiagram(single);
  ctxMenu.querySelector('[data-action="sub-create"]').hidden = !single || linked || isPort(single);
  ctxMenu.querySelector('[data-action="sub-open"]').hidden = !linked;
  ctxMenu.querySelector('[data-action="sub-remove"]').hidden = !linked;
  ctxMenu.querySelector('.ctx-sub-sep').hidden = !single;
  ctxMenu.style.display = 'block';
  // Keep the menu on screen (old version could open off the edge).
  const r = ctxMenu.getBoundingClientRect();
  ctxMenu.style.left = Math.min(x, window.innerWidth - r.width - 4) + 'px';
  ctxMenu.style.top = Math.min(y, window.innerHeight - r.height - 4) + 'px';
}

function hideCtxMenu() { ctxMenu.style.display = 'none'; }

const CTX_ACTIONS = {
  copy: ctxCopy, paste: ctxPaste, duplicate: ctxDuplicate,
  front: () => arrange('front'), back: () => arrange('back'),
  group: groupSelected, ungroup: ungroupSelected, delete: deleteSelected,
  'sub-create': () => createSubDiagram(getSelectedPlacements()[0]),
  'sub-open': () => openSubDiagram(getSelectedPlacements()[0]),
  'sub-remove': () => removeSubDiagram(getSelectedPlacements()[0]),
};
ctxMenu.addEventListener('click', (e) => {
  const item = e.target.closest('.ctx-item');
  if (!item || item.classList.contains('disabled')) return;
  hideCtxMenu();
  CTX_ACTIONS[item.dataset.action]();
});
document.addEventListener('pointerdown', (e) => { if (!ctxMenu.contains(e.target)) hideCtxMenu(); });
window.addEventListener('blur', hideCtxMenu);

// ============================================================
// KEYBOARD
// ============================================================
const ARROWS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

document.addEventListener('keydown', (e) => {
  if (isTypingTarget(e.target)) return;
  const mod = e.ctrlKey || e.metaKey;
  // e.key is 'Z' with Caps Lock or Shift held (audit #18).
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (key === 'Escape') {
    if (drag) { cancelDrag(); return; }
    hideCtxMenu();
    clearSelection();
    return;
  }
  if (drag || isNavigating) return; // no editing shortcuts mid-gesture

  if (key === ' ') {
    e.preventDefault(); // no page scroll / button activation
    if (!spaceHeld) { spaceHeld = true; canvasContainer.classList.add('pan-ready'); }
    return;
  }

  if (mod) {
    const handled = {
      z: () => (e.shiftKey ? redo() : undo()),
      y: redo,
      c: ctxCopy,
      v: ctxPaste,
      d: ctxDuplicate,
      a: selectAll,
      s: saveFile,
      o: loadFileDialog,
      '=': zoomIn, '+': zoomIn, '-': zoomOut, '0': resetView,
    }[key];
    if (handled) { e.preventDefault(); handled(); }
    return;
  }
  // Alt+Up: out of a sub-diagram. Enter: into the selected shape's.
  if (e.altKey && key === 'ArrowUp') { e.preventDefault(); navigateUp(); return; }
  if (e.altKey) return;
  if (key === 'Enter' && selectedIds.size === 1) {
    const p = getSelectedPlacements()[0];
    if (hasSubDiagram(p)) { e.preventDefault(); openSubDiagram(p); return; }
  }

  if (key === 'Delete' || key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
  if (ARROWS[key]) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    nudgeSelected(ARROWS[key][0] * step, ARROWS[key][1] * step);
    return;
  }
  if (key === 'f' && e.shiftKey) { fitToScreen(); return; }
  const tool = { v: 'select', c: 'connect', t: 'text', h: 'pan' }[key];
  if (tool) setTool(tool);
});

document.addEventListener('keyup', (e) => {
  if (e.key === ' ') {
    spaceHeld = false;
    canvasContainer.classList.remove('pan-ready');
  }
  if (ARROWS[e.key]) commitChange(); // end of a held-arrow nudge
});

// Releasing Space while the window is unfocused never fires keyup, which
// would leave pan mode stuck on.
window.addEventListener('blur', () => {
  spaceHeld = false;
  canvasContainer.classList.remove('pan-ready');
});

// ============================================================
// TOOLBAR WIRING
// ============================================================
document.getElementById('default-edge-routing').addEventListener('change', (e) => { defaultEdgeRouting = e.target.value; });
document.getElementById('default-arrow-style').addEventListener('change', (e) => { defaultArrowStyle = e.target.value; });
document.getElementById('filename-input').addEventListener('input', () => { updateDocTitle(); renderBreadcrumb(); });

// ============================================================
// INIT
// ============================================================
applyViewport();
loadDiagram(currentDiagramId);
showDefaultView(currentDiagramId);
updateUndoButtons();
updateDocTitle();
restoreSaveDir();
