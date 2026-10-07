// ============================================================
// SUB-DIAGRAM PORTS (inputs / outputs)
// ============================================================
// When a shape has connections in its diagram, its sub-diagram gets one
// "port" node per connected neighbour:
//   neighbour -> shape   input   (left column)
//   shape -> neighbour   output  (right column)
//   both directions      in/out  (left column)
//
// A port is a placement of the NEIGHBOUR'S OWN ENTITY, flagged with
// `port: 'in' | 'out' | 'both'`. So renaming or recolouring the neighbour
// in the parent changes the port too, with no extra code.
//
// Ports are kept in step with the parent by syncAllPorts(), which runs:
//   - inside every commitChange() (history.js), so a parent change and the
//     port updates it causes are ONE undo step, and the saved file is never
//     out of date
//   - after loading a file
//
// Differences from the old version (syncSubDiagram):
//   - Old: deleted and regenerated locked copies at fixed positions on
//     every visit, plus a hidden copy of the owner with auto-drawn
//     "Input"/"Output" lines. New: ports are created once and then only
//     updated; you can move them and wire them to shapes inside, and that
//     survives. No hidden owner, no auto lines.
//   - Old: a neighbour connected both ways showed only as an input. New:
//     'both'.
//   - Ports can't be deleted inside the sub-diagram (they'd come straight
//     back); remove the connection in the parent instead.

const PORT_COLUMN_GAP = 120; // between the ports and the shapes inside
const PORT_ROW_GAP = 30;

// entityId -> 'in' | 'out' | 'both' for the shape that owns `diagram`, or
// null if the owner can't be found.
function wantedPorts(diagram) {
  const parent = findDiagram(diagram.parentDiagramId);
  const owner = ownerPlacement(diagram);
  if (!parent || !owner) return null;
  const E = owner.entityId;
  const placedInParent = new Set(parent.placements.map(p => p.entityId));
  const want = new Map();
  const add = (id, dir) => {
    if (id === E || !entities[id] || !placedInParent.has(id)) return;
    const prev = want.get(id);
    want.set(id, prev && prev !== dir ? 'both' : dir);
  };
  parent.connections.forEach(c => {
    if (c.to === E) add(c.from, 'in');
    if (c.from === E) add(c.to, 'out');
  });
  return want;
}

function isOutputColumn(dir) { return dir === 'out'; }

// Where a new port goes: under the existing ports of its column; or, for
// the first port of a column, beside whatever is already inside.
function portSlot(diagram, dir, w, h) {
  const column = diagram.placements.filter(p => p.port && isOutputColumn(p.port) === isOutputColumn(dir));
  const inner = diagram.placements.filter(p => !p.port);
  let x;
  if (column.length) x = column[0].x;
  else if (inner.length) {
    x = isOutputColumn(dir)
      ? Math.max(...inner.map(p => p.x + p.w)) + PORT_COLUMN_GAP
      : Math.min(...inner.map(p => p.x)) - PORT_COLUMN_GAP - w;
  } else {
    x = isOutputColumn(dir) ? 160 : -160 - w;
  }
  const y = column.length ? Math.max(...column.map(p => p.y + p.h)) + PORT_ROW_GAP : -h / 2;
  return { x: Math.round(x), y: Math.round(y) };
}

// Bring one sub-diagram's ports in line with its parent. Returns true if
// anything changed.
function syncPorts(diagram) {
  const want = wantedPorts(diagram);
  if (!want) return false;
  let changed = false;

  // Ports whose connection is gone, along with lines drawn to them inside.
  const stale = new Set(diagram.placements.filter(p => p.port && !want.has(p.entityId)).map(p => p.entityId));
  if (stale.size) {
    diagram.placements = diagram.placements.filter(p => !(p.port && stale.has(p.entityId)));
    diagram.connections = diagram.connections.filter(c => !stale.has(c.from) && !stale.has(c.to));
    changed = true;
  }

  const parent = findDiagram(diagram.parentDiagramId);
  want.forEach((dir, entityId) => {
    const existing = diagram.placements.find(p => p.entityId === entityId);
    if (existing) {
      // Also adopts a plain placement of the neighbour (possible in old
      // files) as its port.
      if (existing.port !== dir) { existing.port = dir; changed = true; }
      return;
    }
    // Same size as the neighbour in the parent, so it's recognisable.
    const src = parent.placements.find(p => p.entityId === entityId);
    const w = src ? src.w : 140, h = src ? src.h : 80;
    const pos = portSlot(diagram, dir, w, h);
    diagram.placements.push({
      id: uid(), entityId, x: pos.x, y: pos.y, w, h,
      opacity: 1, fontSize: src ? src.fontSize : 12,
      labelOffsetX: 0, labelOffsetY: 0,
      zIndex: diagram.placements.reduce((m, p) => Math.max(m, p.zIndex || 0), -1) + 1,
      subDiagramId: null,
      port: dir,
    });
    changed = true;
  });
  return changed;
}

// Every sub-diagram, parents before children (a port added to a
// sub-diagram can itself be a neighbour inside a nested one).
function syncAllPorts() {
  syncCurrentDiagram();
  const ordered = diagrams.filter(l => l.parentDiagramId)
    .sort((a, b) => diagramChain(a.id).length - diagramChain(b.id).length);
  let currentChanged = false, anyChanged = false;
  ordered.forEach(l => {
    if (syncPorts(l)) {
      anyChanged = true;
      if (l.id === currentDiagramId) currentChanged = true;
    }
  });
  if (anyChanged) pruneEntities();
  if (currentChanged) {
    const l = currentDiagram();
    state.placements = l.placements;
    state.connections = l.connections;
    pruneSelection();
    renderAll();
  }
}

function isPort(placement) { return !!(placement && placement.port); }

const PORT_LABELS = { in: 'Input', out: 'Output', both: 'In / Out' };
