// ============================================================
// COMMANDS
// ============================================================
// Editing actions triggered from several places (keyboard, context menu,
// properties panel, mini toolbar). Each one is a single undo step.

// ------------------------------------------------------------
// Delete
// ------------------------------------------------------------
// Removes selected nodes AND selected connections together. (Old version:
// if any connection was selected it deleted only the connections and
// silently ignored the selected nodes -- audit #24.)
//
// Ports (sub-diagram inputs/outputs) are skipped: they mirror the parent's
// connections and would come straight back.
function deleteSelected() {
  if (!selectedIds.size && !selectedConnIds.size) return;
  const ports = getSelectedPlacements().filter(isPort);
  recordChange(() => {
    [...selectedConnIds].forEach(removeConnection);
    [...selectedIds].forEach(id => { if (!isPort(getPlacementById(id))) removePlacement(id); });
  });
  clearSelection();
  if (ports.length) flashStatus('Inputs/outputs come from the parent diagram: remove the connection there to remove them.');
}

// ------------------------------------------------------------
// Copy / paste / duplicate
// ------------------------------------------------------------
// Pasting makes NEW, independent entities (a similar-but-separate thing),
// same as old. New: connections between copied shapes come along too, and
// groups inside the copy stay grouped (as a new group, not joined to the
// original's).
let clipboard = null;  // { entities, placements, connections }
let pasteCount = 0;    // each paste lands a bit further away

function copySelection() {
  const placements = getSelectedPlacements();
  if (!placements.length) return null;
  const entityIds = new Set(placements.map(p => p.entityId));
  return JSON.parse(JSON.stringify({
    entities: [...entityIds].map(id => entities[id]),
    placements,
    connections: state.connections.filter(c => entityIds.has(c.from) && entityIds.has(c.to)),
  }));
}

function ctxCopy() {
  const data = copySelection();
  if (!data) return;
  clipboard = data;
  pasteCount = 0;
}

function pasteData(data, offset) {
  recordChange(() => {
    const entityMap = {}, groupMap = {};
    data.entities.forEach(en => {
      const copy = { ...en, id: uid() };
      entities[copy.id] = copy;
      entityMap[en.id] = copy.id;
    });
    selectedIds.clear(); selectedConnIds.clear();
    data.placements.forEach(p => {
      const copy = {
        ...p, id: uid(), entityId: entityMap[p.entityId],
        x: p.x + offset, y: p.y + offset,
        subDiagramId: null,  // sub-diagram links don't copy
      };
      delete copy.port;      // a pasted port is just a normal shape
      if (p.group) copy.group = groupMap[p.group] || (groupMap[p.group] = uid());
      addPlacement(copy);
      selectedIds.add(copy.id);
    });
    data.connections.forEach(c => {
      const copy = { ...c, id: uid(), from: entityMap[c.from], to: entityMap[c.to] };
      state.connections.push(copy);
      selectedConnIds.add(copy.id);
    });
  });
  updateSelectionUI();
}

// Old version always pasted at +20 from the original, so pasting twice put
// both copies in the same spot.
function ctxPaste() {
  if (!clipboard) return;
  pasteCount++;
  pasteData(clipboard, 20 * pasteCount);
}

// Duplicate doesn't overwrite what you copied earlier (old version did).
function ctxDuplicate() {
  const data = copySelection();
  if (data) pasteData(data, 20);
}

// ------------------------------------------------------------
// Align (to the first selected shape)
// ------------------------------------------------------------
function alignNodes(dir) {
  const ps = getSelectedPlacements();
  if (ps.length < 2) return;
  const ref = ps[0];
  recordChange(() => editSelectedPlacements(p => {
    switch (dir) {
      case 'left': p.x = ref.x; break;
      case 'right': p.x = ref.x + ref.w - p.w; break;
      case 'center': p.x = ref.x + ref.w / 2 - p.w / 2; break;
      case 'top': p.y = ref.y; break;
      case 'bottom': p.y = ref.y + ref.h - p.h; break;
      case 'middle': p.y = ref.y + ref.h / 2 - p.h / 2; break;
    }
  }));
  updatePropsPanel();
}

// ------------------------------------------------------------
// Z-order
// ------------------------------------------------------------
// Negative zIndex puts a shape behind the connection lines (the SVG has no
// z-index of its own); 0 and up draw in front of them. Each group is
// renumbered compactly so values don't drift after many reorders.
function normalizeZIndices() {
  const neg = state.placements.filter(p => (p.zIndex || 0) < 0).sort((a, b) => a.zIndex - b.zIndex);
  const pos = state.placements.filter(p => (p.zIndex || 0) >= 0).sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  neg.forEach((p, i) => { p.zIndex = i - neg.length; });
  pos.forEach((p, i) => { p.zIndex = i; });
}

function arrange(how) {
  const ps = getSelectedPlacements();
  if (!ps.length) return;
  recordChange(() => {
    const all = state.placements.map(p => p.zIndex || 0);
    const max = Math.max(...all), min = Math.min(0, ...all);
    ps.forEach(p => {
      if (how === 'forward') p.zIndex = (p.zIndex || 0) + 1;
      if (how === 'backward') p.zIndex = (p.zIndex || 0) - 1;
      if (how === 'front') p.zIndex = max + 1;
      if (how === 'back') p.zIndex = min - 1;
    });
    normalizeZIndices();
    state.placements.forEach(p => updatePlacementEl(getPlacementEl(p.id), p));
  });
}

// ------------------------------------------------------------
// Group / ungroup
// ------------------------------------------------------------
function groupSelected() {
  const ps = getSelectedPlacements();
  if (ps.length < 2) return;
  recordChange(() => {
    const gid = uid();
    ps.forEach(p => { p.group = gid; });
  });
}

function ungroupSelected() {
  recordChange(() => getSelectedPlacements().forEach(p => { delete p.group; }));
}

// ------------------------------------------------------------
// Arrow-key nudge
// ------------------------------------------------------------
// Holding an arrow key = one undo step: the change opens on the first
// keydown and closes on keyup (canvas.js). Old version recorded nothing.
function nudgeSelected(dx, dy) {
  if (!selectedIds.size) return;
  beginChange();
  editSelectedPlacements(p => { p.x += dx; p.y += dy; });
  updatePropsPanel();
}
