// ============================================================
// SELECTION
// ============================================================
// selectedIds holds placement ids, selectedConnIds connection ids (core.js).
// Groups: placements sharing a `group` id are selected together. (Old
// version stored the group id but never used it -- audit #11.)

function groupMembers(placement) {
  if (!placement.group) return [placement];
  return state.placements.filter(p => p.group === placement.group);
}

function clearSelection() {
  selectedIds.clear();
  selectedConnIds.clear();
  updateSelectionUI();
}

function selectPlacement(placement, opts = {}) {
  if (!opts.add) { selectedIds.clear(); selectedConnIds.clear(); }
  groupMembers(placement).forEach(p => selectedIds.add(p.id));
  updateSelectionUI();
}

// Shift+click: flips the clicked node (and its group) in or out. (Old
// version: Shift only ever added.)
function togglePlacement(placement) {
  const members = groupMembers(placement);
  const allSelected = members.every(p => selectedIds.has(p.id));
  members.forEach(p => allSelected ? selectedIds.delete(p.id) : selectedIds.add(p.id));
  updateSelectionUI();
}

function selectConnection(conn, opts = {}) {
  if (opts.toggle) {
    if (selectedConnIds.has(conn.id)) selectedConnIds.delete(conn.id);
    else selectedConnIds.add(conn.id);
  } else {
    selectedIds.clear(); selectedConnIds.clear();
    selectedConnIds.add(conn.id);
  }
  updateSelectionUI();
}

function selectAll() {
  state.placements.forEach(p => selectedIds.add(p.id));
  state.connections.forEach(c => selectedConnIds.add(c.id));
  updateSelectionUI();
}

// Box select: everything the rect touches (canvas coords).
function selectInRect(r, add) {
  if (!add) { selectedIds.clear(); selectedConnIds.clear(); }
  state.placements.forEach(p => {
    if (p.x + p.w > r.x1 && p.x < r.x2 && p.y + p.h > r.y1 && p.y < r.y2) {
      groupMembers(p).forEach(m => selectedIds.add(m.id));
    }
  });
  state.connections.forEach(c => {
    const ends = getConnectionEnds(c);
    if (ends && polylineIntersectsRect(getRoutePoints(c, ends.from, ends.to), r)) selectedConnIds.add(c.id);
  });
  updateSelectionUI();
}

// Drop ids that no longer exist (after undo/redo/load).
function pruneSelection() {
  [...selectedIds].forEach(id => { if (!getPlacementById(id)) selectedIds.delete(id); });
  [...selectedConnIds].forEach(id => { if (!getConnById(id)) selectedConnIds.delete(id); });
}

// In the order they were selected -- "align to the first one you picked".
// (Old version used document order, whatever that happened to be.)
function getSelectedPlacements() {
  return [...selectedIds].map(getPlacementById).filter(Boolean);
}

function getSelectedConnections() {
  return [...selectedConnIds].map(getConnById).filter(Boolean);
}

function updateSelectionUI() {
  const single = selectedIds.size === 1 && selectedConnIds.size === 0;
  state.placements.forEach(p => {
    const el = getPlacementEl(p.id);
    if (!el) return;
    el.classList.toggle('selected', selectedIds.has(p.id));
    // The label handle only shows when exactly one node is selected.
    el.classList.toggle('only-selected', single && selectedIds.has(p.id));
  });
  state.connections.forEach(renderConnection);
  updatePropsPanel();
  updateStatus();
}

// ============================================================
// RENDER ALL
// ============================================================
// Full redraw from state -- after undo/redo, load, new file.
function renderAll() {
  const ids = new Set(state.placements.map(p => p.id));
  worldEl.querySelectorAll('.diagram-node').forEach(el => { if (!ids.has(el.dataset.id)) el.remove(); });
  state.placements.forEach(renderPlacement);

  const connIds = new Set(state.connections.map(c => c.id));
  connSvg.querySelectorAll('.conn-group').forEach(g => { if (!connIds.has(g.dataset.id)) g.remove(); });
  overlaySvg.querySelectorAll('[id^="conn-ends-"]').forEach(g => g.remove());

  updateEmptyHint();
  updateSelectionUI(); // also renders connections, props panel, status bar
}

// ============================================================
// STATUS BAR
// ============================================================
function updateStatus() {
  document.getElementById('status-nodes').textContent = `Nodes: ${state.placements.length}`;
  document.getElementById('status-conns').textContent = `Connections: ${state.connections.length}`;
  const n = selectedIds.size, c = selectedConnIds.size;
  let text = 'Selected: none';
  if (n && c) text = `Selected: ${n} node${n > 1 ? 's' : ''}, ${c} connection${c > 1 ? 's' : ''}`;
  else if (n) text = `Selected: ${n} node${n > 1 ? 's' : ''}`;
  else if (c) text = `Selected: ${c} connection${c > 1 ? 's' : ''}`;
  document.getElementById('status-selected').textContent = text;

  // Quick color pickers: enabled when something they apply to is selected.
  const fillInput = document.getElementById('status-fill-color');
  const lineInput = document.getElementById('status-line-color');
  const p = getSelectedPlacements()[0];
  const entity = p && entities[p.entityId];
  fillInput.disabled = !entity;
  if (entity && document.activeElement !== fillInput) fillInput.value = colorOr(entity.fill, '#1e3a5f');
  const conn = getSelectedConnections()[0];
  lineInput.disabled = !conn;
  if (conn && document.activeElement !== lineInput) lineInput.value = colorOr(conn.color, '#6b7280');
}

// <input type=color> only accepts #rrggbb.
function colorOr(c, fallback) {
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : fallback;
}
