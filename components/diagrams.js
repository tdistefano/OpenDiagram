// ============================================================
// DIAGRAMS + SUB-DIAGRAMS
// ============================================================
// Each diagram (the main one or a sub-diagram) has its own placements and
// connections over the shared `entities`. (The old version called these
// "lenses".) Diagrams form a tree with exactly one root:
//   root (main diagram)  parentDiagramId: null
//   sub-diagram          parentDiagramId: <diagram>, parentShapeId: <the shape
//                        in the parent diagram you open it from>
// A placement points down at its sub-diagram with `subDiagramId`.
//
// `state.placements/connections` hold the diagram being viewed. They are the
// same arrays as that diagram's (no copies); syncCurrentDiagram() re-links them
// after code that replaces the arrays (e.g. filter()).
//
// Differences from the old version:
//   - A new sub-diagram starts with one input/output "port" per connection
//     of its shape, kept in step with the parent (ports.js). The old
//     version's locked auto-copies are stripped from old files on load and
//     replaced by ports.
//   - Creating, removing and deleting sub-diagrams are undoable, and undo
//     takes you back to the diagram where the change happened (audit #4).
//   - Each diagram remembers its view for the session.

function findDiagram(id) { return diagrams.find(l => l.id === id); }
function currentDiagram() { return findDiagram(currentDiagramId); }
function newDiagramId() { return 'diagram-' + (diagramIdCounter++); }

function syncCurrentDiagram() {
  const l = currentDiagram();
  if (!l) return;
  l.placements = state.placements;
  l.connections = state.connections;
}

// Root first, current last.
function diagramChain(id = currentDiagramId) {
  const chain = [];
  for (let l = findDiagram(id); l; l = l.parentDiagramId ? findDiagram(l.parentDiagramId) : null) chain.unshift(l);
  return chain;
}

function isDescendantOrSelf(diagramId, ancestorId) {
  return diagramChain(diagramId).some(l => l.id === ancestorId);
}

function removeDiagramAndDescendants(id) {
  diagrams.filter(l => l.parentDiagramId === id).forEach(c => removeDiagramAndDescendants(c.id));
  diagrams = diagrams.filter(l => l.id !== id);
}

// Delete entities that no placement in any diagram uses any more (after a
// shape or a whole sub-diagram is removed). Undo restores them, since
// entities are part of every snapshot.
function pruneEntities() {
  syncCurrentDiagram();
  const used = new Set();
  diagrams.forEach(l => l.placements.forEach(p => used.add(p.entityId)));
  Object.keys(entities).forEach(id => { if (!used.has(id)) delete entities[id]; });
}

function hasSubDiagram(placement) {
  return !!(placement && placement.subDiagramId && findDiagram(placement.subDiagramId));
}

// The shape a sub-diagram belongs to (in its parent diagram).
function ownerPlacement(diagram) {
  const parent = diagram && diagram.parentDiagramId && findDiagram(diagram.parentDiagramId);
  return parent ? parent.placements.find(p => p.id === diagram.parentShapeId) : null;
}

// A sub-diagram is named after its shape, so renaming the shape renames
// the breadcrumb too (old version froze the name at creation). The root is
// named after the file.
function diagramDisplayName(diagram) {
  if (!diagram.parentDiagramId) return document.getElementById('filename-input').value || 'Diagram';
  const owner = ownerPlacement(diagram);
  const entity = owner && entities[owner.entityId];
  return entity ? (entity.label || 'Untitled') : diagram.name;
}

// ------------------------------------------------------------
// Switching diagram
// ------------------------------------------------------------
const diagramViews = new Map(); // diagramId -> {zoom, panX, panY}, this session only
let diagramEntryZoom = 1;       // zoom right after entering; see auto drill-out

function loadDiagram(id) {
  syncCurrentDiagram();
  const l = findDiagram(id);
  if (!l) return;
  currentDiagramId = id;
  state.placements = l.placements;
  state.connections = l.connections;
  selectedIds.clear(); selectedConnIds.clear();
  renderAll();
  renderBreadcrumb();
}

// Show the remembered view, or fit the content, or (blank diagram) put the
// origin in the middle of the screen.
function showDefaultView(id) {
  const saved = diagramViews.get(id);
  if (saved) { Object.assign(viewport, saved); applyViewport(); }
  else if (state.placements.length) fitToScreen();
  else {
    const rect = canvasContainer.getBoundingClientRect();
    Object.assign(viewport, { zoom: 1, panX: rect.width / 2, panY: rect.height / 2 });
    applyViewport();
  }
  diagramEntryZoom = viewport.zoom;
}

// ------------------------------------------------------------
// Create / remove
// ------------------------------------------------------------
function createSubDiagram(placement) {
  // Not on a port: it's the neighbour's entity, and its sub-diagram
  // belongs in the diagram where the neighbour really lives.
  if (!placement || hasSubDiagram(placement) || isPort(placement)) return;
  flushPendingEdits();
  recordChange(() => {
    syncCurrentDiagram();
    const id = newDiagramId();
    diagrams.push({
      id, name: (entities[placement.entityId] || {}).label || 'Sub-Diagram',
      placements: [], connections: [],
      parentDiagramId: currentDiagramId, parentShapeId: placement.id,
    });
    placement.subDiagramId = id;
    syncPorts(findDiagram(id)); // inputs/outputs from the shape's connections
    updatePlacementEl(getPlacementEl(placement.id), placement);
  });
  openSubDiagram(placement);
}

function removeSubDiagram(placement) {
  if (!hasSubDiagram(placement)) return;
  const diagram = findDiagram(placement.subDiagramId);
  const nested = diagrams.filter(l => l.id !== diagram.id && isDescendantOrSelf(l.id, diagram.id)).length;
  const what = diagram.placements.length || nested
    ? `It has ${diagram.placements.length} shape(s)${nested ? ` and ${nested} nested sub-diagram(s)` : ''}, which will be deleted.`
    : 'It is empty.';
  if (!confirm(`Remove this sub-diagram? ${what}\n\nYou can undo this.`)) return;
  recordChange(() => {
    removeDiagramAndDescendants(diagram.id);
    pruneEntities();
    placement.subDiagramId = null;
    updatePlacementEl(getPlacementEl(placement.id), placement);
  });
}

// Breadcrumb ×: delete the sub-diagram you're in and go up to its parent.
// Undo brings it back and returns you inside it.
function deleteCurrentSubDiagram() {
  const diagram = currentDiagram();
  if (!diagram || !diagram.parentDiagramId) return;
  if (!confirm(`Delete the sub-diagram "${diagramDisplayName(diagram)}" and everything inside it?\n\nYou can undo this.`)) return;
  flushPendingEdits();
  recordChange(() => {
    syncCurrentDiagram();
    const owner = ownerPlacement(diagram);
    if (owner) owner.subDiagramId = null;
    const parentId = diagram.parentDiagramId;
    removeDiagramAndDescendants(diagram.id);
    currentDiagramId = null; // the diagram we were in no longer exists
    loadDiagram(parentId);
    pruneEntities();
  });
  showDefaultView(currentDiagramId);
}

// ------------------------------------------------------------
// Navigation with the zoom transition
// ------------------------------------------------------------
let isNavigating = false;
let lastNavAt = 0;

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// Animates the view to `target`. requestAnimationFrame pauses in background
// tabs, so a timer also finishes the tween; otherwise a navigation started
// just before switching tabs would sit half-done with input blocked.
function tweenView(target, duration) {
  return new Promise(resolve => {
    const from = { ...viewport };
    const t0 = performance.now();
    let done = false;
    function apply(p) {
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // ease in-out
      viewport.zoom = from.zoom + (target.zoom - from.zoom) * e;
      viewport.panX = from.panX + (target.panX - from.panX) * e;
      viewport.panY = from.panY + (target.panY - from.panY) * e;
      applyViewport();
    }
    function finish() {
      if (done) return;
      done = true;
      apply(1);
      resolve();
    }
    function step() {
      if (done) return;
      const p = Math.min(1, (performance.now() - t0) / duration);
      if (p >= 1) { finish(); return; }
      apply(p);
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
    setTimeout(finish, duration + 50);
  });
}

// Zoom at which a placement (plus padding) fills the viewport.
function placementFitZoom(p) {
  const rect = canvasContainer.getBoundingClientRect();
  const pad = 50;
  return Math.min(rect.width / (p.w + pad * 2), rect.height / (p.h + pad * 2));
}

// View with placement p centered at the given zoom.
function viewCenteredOn(p, zoom) {
  const rect = canvasContainer.getBoundingClientRect();
  return {
    zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM),
    panX: rect.width / 2 - (p.x + p.w / 2) * zoom,
    panY: rect.height / 2 - (p.y + p.h / 2) * zoom,
  };
}

async function fade(out) {
  worldEl.classList.toggle('diagram-fade', out);
  await wait(out ? 160 : 30);
}

// Into a shape's sub-diagram: zoom into the shape, fade, swap, fade in.
async function openSubDiagram(placement) {
  if (isNavigating || drag || !hasSubDiagram(placement)) return;
  flushPendingEdits();
  isNavigating = true;
  try {
    diagramViews.set(currentDiagramId, { ...viewport });
    await tweenView(viewCenteredOn(placement, placementFitZoom(placement)), 320);
    await fade(true);
    loadDiagram(placement.subDiagramId);
    showDefaultView(currentDiagramId);
    await fade(false);
  } finally {
    isNavigating = false;
    lastNavAt = Date.now();
  }
}

// Up to an ancestor diagram: fade, swap, then zoom out of the shape you came
// from so it ends up in the middle of the screen with its surroundings.
async function navigateUpTo(diagramId) {
  if (isNavigating || drag || diagramId === currentDiagramId || !findDiagram(diagramId)) return;
  flushPendingEdits();
  // The shape in the target diagram that leads down to where we are.
  let child = currentDiagram();
  while (child && child.parentDiagramId !== diagramId) child = findDiagram(child.parentDiagramId);
  isNavigating = true;
  try {
    diagramViews.set(currentDiagramId, { ...viewport });
    await tweenView({ ...viewport, zoom: viewport.zoom * 0.82 }, 160);
    await fade(true);
    loadDiagram(diagramId);
    const owner = child && getPlacementById(child.parentShapeId);
    if (owner) {
      const fit = placementFitZoom(owner);
      Object.assign(viewport, viewCenteredOn(owner, fit));
      applyViewport();
      await fade(false);
      // Stop well below the auto drill-in zoom so the next scroll doesn't
      // pop you straight back in.
      await tweenView(viewCenteredOn(owner, Math.min(fit * 0.5, diagramViews.get(diagramId)?.zoom ?? Infinity)), 320);
      diagramEntryZoom = viewport.zoom;
    } else {
      showDefaultView(diagramId);
      await fade(false);
    }
  } finally {
    isNavigating = false;
    lastNavAt = Date.now();
  }
}

function navigateUp() {
  const l = currentDiagram();
  if (l && l.parentDiagramId) navigateUpTo(l.parentDiagramId);
}

// ------------------------------------------------------------
// Semantic zoom (same idea as old): zoom into a shape that has a
// sub-diagram until it fills the screen and you're inside it; zoom far out
// inside a sub-diagram and you're back in the parent.
// ------------------------------------------------------------
const AUTO_DRILL_IN_RATIO = 0.85;  // of the shape's fill-the-screen zoom
const AUTO_DRILL_OUT_ZOOM = 0.22;

// sx, sy: the zoom's focus point (cursor for wheel, center for buttons).
function checkAutoZoomDrill(sx, sy) {
  if (isNavigating || drag || Date.now() - lastNavAt < 400) return;
  const diagram = currentDiagram();
  // Relative to the zoom you entered at, so a sub-diagram whose content
  // only fits at 0.3x doesn't pop you out on the first scroll. (Old: a
  // fixed 0.22.)
  if (diagram.parentDiagramId && viewport.zoom <= Math.min(AUTO_DRILL_OUT_ZOOM, diagramEntryZoom * 0.5)) {
    navigateUp();
    return;
  }
  for (const p of state.placements) {
    if (!hasSubDiagram(p) || viewport.zoom < placementFitZoom(p) * AUTO_DRILL_IN_RATIO) continue;
    const s = canvasToScreen(p.x, p.y);
    if (sx < s.x || sx > s.x + p.w * viewport.zoom || sy < s.y || sy > s.y + p.h * viewport.zoom) continue;
    openSubDiagram(p);
    return;
  }
}

// ------------------------------------------------------------
// Breadcrumb
// ------------------------------------------------------------
function renderBreadcrumb() {
  const bar = document.getElementById('breadcrumb-bar');
  const chain = diagramChain();
  bar.innerHTML = '';
  bar.hidden = chain.length <= 1;
  if (bar.hidden) return;
  chain.forEach((diagram, i) => {
    const last = i === chain.length - 1;
    const crumb = document.createElement('span');
    crumb.className = 'crumb' + (last ? ' crumb-current' : '');
    crumb.textContent = diagramDisplayName(diagram);
    if (!last) crumb.addEventListener('click', () => navigateUpTo(diagram.id));
    bar.appendChild(crumb);
    if (!last) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '›';
      bar.appendChild(sep);
    }
  });
  const del = document.createElement('span');
  del.className = 'crumb-delete';
  del.title = 'Delete this sub-diagram';
  del.textContent = '×';
  del.addEventListener('click', deleteCurrentSubDiagram);
  bar.appendChild(del);
}
