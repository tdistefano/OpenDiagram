// ============================================================
// PROPERTIES PANEL (right side)
// ============================================================
// Two groups for shapes, matching the data model:
//   Entity    -- what it is: label, description, colors
//   Placement -- where it's drawn: position, size, opacity, font size
// plus a connection section.
//
// Undo: typing/dragging a slider fires 'input' many times. The first one
// opens a change (beginChange) and 'change'/blur closes it, so a whole
// slider drag or a typed word is ONE undo step. The capture-phase listener
// runs before the field's own handler, so the snapshot is taken before the
// first mutation.
const rightPanel = document.getElementById('right-panel');
rightPanel.addEventListener('input', () => beginChange(), true);
rightPanel.addEventListener('change', () => commitChange());
rightPanel.addEventListener('focusout', () => commitChange());

const FILL_SWATCHES = ['#1e3a5f', '#1e4d3a', '#4a1942', '#3d2008', '#4f8ef7', '#22c55e',
  '#7c3aed', '#f59e0b', '#ef4444', '#06b6d4', '#f43f5e', '#334155'];

const $ = (id) => document.getElementById(id);

// Write a value into a field, unless the user is typing in it right now
// (otherwise the caret jumps while they type).
function setField(id, value) {
  const el = $(id);
  if (document.activeElement !== el) el.value = value;
}

function round1(v) { return Math.round(v * 10) / 10; }

// ------------------------------------------------------------
// Show the current selection
// ------------------------------------------------------------
function updatePropsPanel() {
  const placements = getSelectedPlacements();
  const conns = getSelectedConnections();
  $('no-selection').hidden = placements.length > 0 || conns.length > 0;
  $('shape-props').hidden = placements.length === 0;
  // Old version showed only the connection panel when both were selected.
  $('conn-props').hidden = conns.length === 0;

  if (placements.length) {
    const p = placements[0];
    const e = entities[p.entityId];
    const multi = placements.length > 1;
    $('shape-multi-note').hidden = !multi;
    $('shape-multi-note').textContent = `Editing ${placements.length} shapes`;
    $('port-note').hidden = multi || !isPort(p);
    $('port-note').textContent = isPort(p)
      ? `${PORT_LABELS[p.port]} from the parent diagram. Label and colors are shared with it; to remove it, remove the connection there.`
      : '';
    // Label/description per shape only; setting 5 shapes to the same label
    // (old behavior) is almost never what you want.
    $('prop-label-row').hidden = multi;
    $('prop-description-row').hidden = multi;
    setField('prop-label', e.label || '');
    setField('prop-description', e.description || '');
    setField('prop-fill', colorOr(e.fill, '#1e3a5f'));
    setField('prop-stroke', colorOr(e.stroke, '#4f8ef7'));
    setField('prop-stroke-width', e.strokeWidth ?? 1.5);
    setField('prop-text-color', colorOr(e.textColor, '#ffffff'));
    setField('prop-radius', e.radius ?? 4);
    setField('prop-x', Math.round(p.x));
    setField('prop-y', Math.round(p.y));
    setField('prop-w', Math.round(p.w));
    setField('prop-h', Math.round(p.h));
    setField('prop-opacity', Math.round((p.opacity ?? 1) * 100));
    setField('prop-font-size', round1(p.fontSize || 12));
    document.querySelectorAll('#fill-swatches .color-swatch').forEach(s => s.classList.toggle('active', s.dataset.color === e.fill));
  }

  if (conns.length) {
    const c = conns[0];
    const multi = conns.length > 1;
    $('conn-multi-note').hidden = !multi;
    $('conn-multi-note').textContent = `Editing ${conns.length} connections`;
    $('conn-label-row').hidden = multi;
    $('conn-description-row').hidden = multi;
    setField('conn-label-input', c.label || '');
    setField('conn-description-input', c.description || '');
    setField('conn-style', c.style || 'solid');
    setField('conn-arrow', c.arrow || 'arrow');
    setField('conn-color', colorOr(c.color, '#6b7280'));
    setField('conn-routing', c.routing || 'straight');
  }
}

// ------------------------------------------------------------
// Helpers to apply an edit to the selection
// ------------------------------------------------------------
// Each distinct entity once, then re-render its placements.
function editSelectedEntities(fn) {
  const done = new Set();
  getSelectedPlacements().forEach(p => {
    if (done.has(p.entityId) || !entities[p.entityId]) return;
    done.add(p.entityId);
    fn(entities[p.entityId]);
    renderEntityPlacements(p.entityId);
  });
  updateStatus();
}

function editSelectedPlacements(fn) {
  const moved = new Set();
  getSelectedPlacements().forEach(p => {
    fn(p);
    updatePlacementEl(getPlacementEl(p.id), p);
    moved.add(p.entityId);
  });
  refreshConnectionsFor(moved);
}

function editSelectedConnections(fn) {
  getSelectedConnections().forEach(c => { fn(c); renderConnection(c); });
  updateStatus();
}

// Number fields: ignore empty / half-typed values instead of writing NaN
// into the document. (Old version: clearing the X field set x = NaN and the
// shape vanished -- audit #23.)
function numberFrom(id) {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) ? v : null;
}

// ------------------------------------------------------------
// Entity fields
// ------------------------------------------------------------
$('prop-label').addEventListener('input', (e) => editSelectedEntities(en => { en.label = e.target.value; }));
$('prop-description').addEventListener('input', (e) => editSelectedEntities(en => { en.description = e.target.value; }));

function setFillColorValue(color) {
  editSelectedEntities(en => { en.fill = color; });
  updatePropsPanel();
}
$('prop-fill').addEventListener('input', (e) => setFillColorValue(e.target.value));
$('prop-stroke').addEventListener('input', (e) => editSelectedEntities(en => { en.stroke = e.target.value; }));
$('prop-stroke-width').addEventListener('input', (e) => editSelectedEntities(en => { en.strokeWidth = parseFloat(e.target.value); }));
$('prop-text-color').addEventListener('input', (e) => editSelectedEntities(en => { en.textColor = e.target.value; }));
$('prop-radius').addEventListener('input', (e) => editSelectedEntities(en => { en.radius = parseInt(e.target.value, 10); }));

FILL_SWATCHES.forEach(color => {
  const s = document.createElement('div');
  s.className = 'color-swatch';
  s.style.background = color;
  s.dataset.color = color;
  s.title = color;
  s.addEventListener('click', () => recordChange(() => setFillColorValue(color)));
  $('fill-swatches').appendChild(s);
});

// ------------------------------------------------------------
// Placement fields
// ------------------------------------------------------------
// Position with several shapes selected moves them all by the same amount.
// (Old version set every selected shape to the same x/y, stacking them on
// top of each other -- audit #22.)
function updateSelectedPos() {
  const first = getSelectedPlacements()[0];
  if (!first) return;
  const x = numberFrom('prop-x'), y = numberFrom('prop-y');
  const dx = x === null ? 0 : x - first.x;
  const dy = y === null ? 0 : y - first.y;
  editSelectedPlacements(p => { p.x += dx; p.y += dy; });
}
$('prop-x').addEventListener('input', updateSelectedPos);
$('prop-y').addEventListener('input', updateSelectedPos);

function updateSelectedSize() {
  const w = numberFrom('prop-w'), h = numberFrom('prop-h');
  editSelectedPlacements(p => {
    if (w !== null) p.w = Math.max(MIN_NODE_SIZE, w);
    if (h !== null) p.h = Math.max(MIN_NODE_SIZE, h);
  });
}
$('prop-w').addEventListener('input', updateSelectedSize);
$('prop-h').addEventListener('input', updateSelectedSize);

$('prop-opacity').addEventListener('input', (e) => editSelectedPlacements(p => { p.opacity = parseInt(e.target.value, 10) / 100; }));
$('prop-font-size').addEventListener('input', () => {
  const v = numberFrom('prop-font-size');
  if (v !== null && v > 0) editSelectedPlacements(p => { p.fontSize = clamp(v, 4, 400); });
});
$('prop-label-reset').addEventListener('click', () => recordChange(() =>
  editSelectedPlacements(p => { p.labelOffsetX = 0; p.labelOffsetY = 0; })));

document.querySelectorAll('[data-align]').forEach(b => b.addEventListener('click', () => alignNodes(b.dataset.align)));
document.querySelectorAll('[data-arrange]').forEach(b => b.addEventListener('click', () => arrange(b.dataset.arrange)));

// ------------------------------------------------------------
// Connection fields
// ------------------------------------------------------------
$('conn-label-input').addEventListener('input', (e) => editSelectedConnections(c => { c.label = e.target.value; }));
$('conn-description-input').addEventListener('input', (e) => editSelectedConnections(c => { c.description = e.target.value; }));
// <select> fires 'input' then 'change': the capture listener opens the
// change and 'change' commits it, so each pick is one undo step.
$('conn-style').addEventListener('input', (e) => editSelectedConnections(c => { c.style = e.target.value; }));
$('conn-arrow').addEventListener('input', (e) => editSelectedConnections(c => { c.arrow = e.target.value; }));
$('conn-routing').addEventListener('input', (e) => editSelectedConnections(c => { c.routing = e.target.value; }));

function updateConnColor(color) {
  editSelectedConnections(c => { c.color = color; });
  updatePropsPanel();
}
$('conn-color').addEventListener('input', (e) => updateConnColor(e.target.value));

// ------------------------------------------------------------
// Status bar quick colors (outside the panel, so they manage undo
// themselves the same way)
// ------------------------------------------------------------
['status-fill-color', 'status-line-color'].forEach(id => {
  $(id).addEventListener('input', () => beginChange(), true);
  $(id).addEventListener('change', () => commitChange());
});
$('status-fill-color').addEventListener('input', (e) => setFillColorValue(e.target.value));
$('status-line-color').addEventListener('input', (e) => updateConnColor(e.target.value));
