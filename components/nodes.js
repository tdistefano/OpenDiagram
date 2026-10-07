// ============================================================
// ENTITY + PLACEMENT CREATION
// ============================================================
// A new shape is always two records: an Entity (what it is) and a
// Placement (where it's drawn on this diagram). These functions only build
// data; callers decide when it becomes an undo step.
function createEntityAndPlacement(type, x, y, w, h, label) {
  // Text boxes and uploaded SVGs draw their own look, so they get no
  // fill/outline of their own.
  const bare = type === 'text' || isCustomType(type);
  const entity = {
    id: uid(),
    type,
    label: label !== undefined ? label : getShapeInfo(type).name,
    description: '',
    fill: bare ? 'transparent' : '#1e3a5f',
    stroke: bare ? 'none' : '#4f8ef7',
    strokeWidth: bare ? 0 : 1.5,
    textColor: '#ffffff',
    radius: 4,
  };
  entities[entity.id] = entity;
  return createPlacement(entity.id, x, y, w, h);
}

function createPlacement(entityId, x, y, w, h) {
  return {
    id: uid(),
    entityId,
    x: Math.round(x),
    y: Math.round(y),
    w,
    h,
    opacity: 1,
    fontSize: 12,
    labelOffsetX: 0,
    labelOffsetY: 0,
    // On top of everything. (Old: placements.length, which collides with
    // existing values after deletes or reordering.)
    zIndex: state.placements.reduce((m, p) => Math.max(m, p.zIndex || 0), -1) + 1,
    subDiagramId: null,
  };
}

function addPlacement(placement) {
  state.placements.push(placement);
  renderPlacement(placement);
  updateEmptyHint();
  updateStatus();
}

// Removes the placement, any connection drawn to it on this diagram, and its
// sub-diagram (same as old; undo brings it all back). Entities nothing
// draws any more are deleted too (pruneEntities). The old version kept
// every entity forever (audit #20).
function removePlacement(id) {
  const p = getPlacementById(id);
  if (!p) return;
  if (p.subDiagramId) removeDiagramAndDescendants(p.subDiagramId);
  state.connections
    .filter(c => c.from === p.entityId || c.to === p.entityId)
    .forEach(c => removeConnection(c.id));
  state.placements = state.placements.filter(q => q.id !== id);
  selectedIds.delete(id);
  const el = getPlacementEl(id);
  if (el) el.remove();
  pruneEntities();
  updateEmptyHint();
  updateStatus();
}

function updateEmptyHint() {
  emptyHint.style.display = state.placements.length ? 'none' : 'flex';
}

// ============================================================
// RENDER
// ============================================================
// Nodes live inside #world, so they're laid out in plain canvas units.
// No zoom or pan math here: the #world transform handles that. Handles are
// counter-scaled in CSS (var(--inv-zoom)) so they stay the same size on
// screen at any zoom.
function renderPlacement(placement) {
  let el = getPlacementEl(placement.id);
  if (!el) {
    el = document.createElement('div');
    el.id = 'node-' + placement.id;
    el.dataset.id = placement.id;
    el.className = 'diagram-node';
    el.innerHTML = `
      <div class="node-shape"></div>
      <div class="node-label"><span class="node-label-text"></span><span class="label-handle" title="Drag to move the label"></span></div>
      <div class="conn-handle" data-pos="top"></div>
      <div class="conn-handle" data-pos="right"></div>
      <div class="conn-handle" data-pos="bottom"></div>
      <div class="conn-handle" data-pos="left"></div>
      <div class="resize-handle" title="Drag to resize (Shift keeps proportions)"></div>
      <div class="port-tag"></div>
      <div class="node-drill-badge" title="Open sub-diagram (or zoom into the shape)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg></div>
    `;
    // Before the overlay SVG, so endpoint handles / the temp connection
    // line always draw on top of nodes.
    worldEl.insertBefore(el, overlaySvg);
  }
  updatePlacementEl(el, placement);
}

function updatePlacementEl(el, placement) {
  const entity = entities[placement.entityId];
  if (!el || !entity) return;
  el.style.left = placement.x + 'px';
  el.style.top = placement.y + 'px';
  el.style.width = placement.w + 'px';
  el.style.height = placement.h + 'px';
  el.style.zIndex = placement.zIndex || 0;
  el.style.opacity = placement.opacity ?? 1;
  el.title = entity.description || '';
  el.dataset.type = entity.type;
  el.classList.toggle('selected', selectedIds.has(placement.id));
  el.classList.toggle('has-subdiagram', hasSubDiagram(placement));
  el.dataset.port = placement.port || '';
  el.querySelector('.port-tag').textContent = placement.port ? PORT_LABELS[placement.port] : '';

  // The SVG is sized in canvas units: no zoom here, #world scales it.
  const shapeEl = el.querySelector('.node-shape');
  shapeEl.innerHTML = `<svg width="${placement.w}" height="${placement.h}" viewBox="0 0 ${placement.w} ${placement.h}">`
    + getShapeSVG(entity.type, placement.w, placement.h,
        safeColor(entity.fill, '#1e3a5f'), safeColor(entity.stroke, '#4f8ef7'),
        Number(entity.strokeWidth) || 0, Number(entity.radius) || 0)
    + '</svg>';

  const labelEl = el.querySelector('.node-label');
  // textContent, never innerHTML: labels are user-typed.
  labelEl.querySelector('.node-label-text').textContent = entity.label;
  labelEl.style.fontSize = (placement.fontSize || 12) + 'px';
  labelEl.style.color = entity.textColor || '#ffffff';
  labelEl.style.transform = labelTransform(placement);
}

function labelTransform(placement) {
  return `translate(-50%, -50%) translate(${placement.labelOffsetX || 0}px, ${placement.labelOffsetY || 0}px)`;
}

// Re-render every placement of an entity on this diagram (after an entity
// field like label or fill changes).
function renderEntityPlacements(entityId) {
  state.placements.filter(p => p.entityId === entityId).forEach(p => updatePlacementEl(getPlacementEl(p.id), p));
  renderBreadcrumb(); // sub-diagrams are named after their shape
}

// ============================================================
// LABEL EDITING
// ============================================================
// Enter = commit, Shift+Enter = newline, Esc = cancel, click away = commit.
// (Old version: Esc also committed, so there was no way to back out.)
// The whole edit is one undo step.
//
// `opts.isNew`: the text box was just created. Committing it empty (or
// cancelling) removes it. The old version left an invisible, empty box
// behind that you couldn't find again.
function startEditLabel(placement, opts = {}) {
  const entity = entities[placement.entityId];
  const el = getPlacementEl(placement.id);
  if (!entity || !el || el.querySelector('.node-label-editor')) return;

  beginChange(); // merges with the creation when opts.isNew
  const labelEl = el.querySelector('.node-label');
  labelEl.style.display = 'none';

  const ta = document.createElement('textarea');
  ta.className = 'node-label-editor';
  ta.value = entity.label;
  ta.rows = 2;
  // Canvas units, same as the label; the #world transform scales it.
  ta.style.fontSize = (placement.fontSize || 12) + 'px';
  ta.style.color = entity.textColor || '#ffffff';
  ta.style.transform = labelTransform(placement);
  el.appendChild(ta);
  ta.focus();
  ta.select();

  let cancelled = false;
  let finished = false;

  function finish() {
    if (finished) return; // blur fires again when the textarea is removed
    finished = true;
    const value = ta.value;
    ta.remove();
    labelEl.style.display = '';

    const empty = value.trim() === '';
    if (opts.isNew && (cancelled || (empty && entity.type === 'text'))) {
      removePlacement(placement.id); // also deletes the now-unused entity
    } else if (!cancelled) {
      entity.label = value;
      renderEntityPlacements(entity.id);
      updatePropsPanel();
    }
    commitChange(); // no-op if nothing changed (cancelled edit)
  }

  ta.addEventListener('blur', finish);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cancelled = true; ta.blur(); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); }
  });
}

// ============================================================
// CREATE AT A POINT
// ============================================================
// Every "add something to the canvas" path ends here: palette drop,
// palette click, text tool, double-click. Each is
// one undo step, and the new shape becomes the selection (same as old).
//
// Default sizes are what look right at 100% zoom. Dividing by zoom keeps
// that same on-screen size when you add something while zoomed in or out.
const DEFAULT_FONT_SIZE = 12;

// Brand-new entity of `type`, centered on canvas point `pt`.
function createShapeAt(type, pt) {
  return recordChange(() => {
    const z = viewport.zoom;
    const info = getShapeInfo(type);
    const w = info.w / z, h = info.h / z;
    const p = createEntityAndPlacement(type, pt.x - w / 2, pt.y - h / 2, w, h);
    p.fontSize = DEFAULT_FONT_SIZE / z;
    addPlacement(p);
    selectPlacement(p);
    return p;
  });
}

// Creation + typing the label = one undo step: beginChange() here stays
// open until the label editor commits it.
function createTextBoxAt(pt) {
  flushPendingEdits();
  beginChange();
  const p = createShapeAt('text', pt);
  startEditLabel(p, { isNew: true });
  return p;
}
