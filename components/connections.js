// ============================================================
// CONNECTIONS
// ============================================================
// A connection joins two ENTITIES. To draw it, each end is resolved to that
// entity's placement on the current diagram; if either end isn't placed here,
// the connection simply isn't drawn.
//
// Everything is in canvas units inside #world (old version: screen units,
// recomputed on every pan/zoom frame). Lines therefore scale with zoom like
// shapes do; only the click area and handles are kept at a fixed screen
// size via CSS.
//
// Handle (anchor) formats, both still supported:
//   'top' | 'right' | 'bottom' | 'left'  -- middle of that side (older files)
//   { rx, ry }                           -- any point on the border as 0..1
//                                           ratios, so it survives resizing
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

function addConnection(fromId, toId, fromHandle, toHandle) {
  const conn = {
    id: uid(),
    from: fromId, to: toId,
    fromHandle: fromHandle || 'right',
    toHandle: toHandle || 'left',
    label: '',
    description: '',
    style: 'solid',      // 'solid' | 'dashed' | 'thick'
    arrow: defaultArrowStyle,
    routing: defaultEdgeRouting,
    color: '#6b7280',
  };
  state.connections.push(conn);
  renderConnection(conn);
  updateStatus();
  return conn;
}

function removeConnection(id) {
  state.connections = state.connections.filter(c => c.id !== id);
  selectedConnIds.delete(id);
  const g = getConnEl(id);
  if (g) g.remove();
  const ends = document.getElementById('conn-ends-' + id);
  if (ends) ends.remove();
  updateStatus();
}

// ------------------------------------------------------------
// Geometry
// ------------------------------------------------------------
function getHandleRatioPoint(placement, pos) {
  if (pos && typeof pos === 'object') {
    return { x: placement.x + pos.rx * placement.w, y: placement.y + pos.ry * placement.h };
  }
  switch (pos) {
    case 'top': return { x: placement.x + placement.w / 2, y: placement.y };
    case 'bottom': return { x: placement.x + placement.w / 2, y: placement.y + placement.h };
    case 'left': return { x: placement.x, y: placement.y + placement.h / 2 };
    case 'right': return { x: placement.x + placement.w, y: placement.y + placement.h / 2 };
    default: return { x: placement.x + placement.w / 2, y: placement.y + placement.h / 2 };
  }
}

// Snaps a canvas point to the nearest point on a placement's border, as
// {rx, ry} ratios.
function nearestEdgeAnchor(placement, pt) {
  const lx = clamp(pt.x - placement.x, 0, placement.w);
  const ly = clamp(pt.y - placement.y, 0, placement.h);
  const dLeft = lx, dRight = placement.w - lx, dTop = ly, dBottom = placement.h - ly;
  const min = Math.min(dLeft, dRight, dTop, dBottom);
  if (min === dLeft) return { rx: 0, ry: ly / placement.h };
  if (min === dRight) return { rx: 1, ry: ly / placement.h };
  if (min === dTop) return { rx: lx / placement.w, ry: 0 };
  return { rx: lx / placement.w, ry: 1 };
}

// Which side a handle sits on -- decides elbow orientation.
function handleSide(handle) {
  if (!handle) return 'right';
  if (typeof handle === 'string') return handle;
  if (handle.rx <= 0.001) return 'left';
  if (handle.rx >= 0.999) return 'right';
  if (handle.ry <= 0.001) return 'top';
  return 'bottom';
}

// Both endpoints in canvas space, or null if either end isn't on this diagram.
function getConnectionEnds(conn) {
  const fromP = placementForEntity(conn.from);
  const toP = placementForEntity(conn.to);
  if (!fromP || !toP) return null;
  return {
    from: getHandleRatioPoint(fromP, conn.fromHandle || 'right'),
    to: getHandleRatioPoint(toP, conn.toHandle || 'left'),
  };
}

// The route as a polyline. Curves are sampled, so hit-testing and label
// placement can treat every routing style the same way.
function getRoutePoints(conn, from, to) {
  if (conn.routing === 'curve') {
    const cx = (from.x + to.x) / 2;
    const p1 = { x: cx, y: from.y }, p2 = { x: cx, y: to.y };
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, u = 1 - t;
      pts.push({
        x: u*u*u*from.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*to.x,
        y: u*u*u*from.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*to.y,
      });
    }
    return pts;
  }
  if (conn.routing === 'elbow') {
    const fromH = ['left', 'right'].includes(handleSide(conn.fromHandle));
    const toH = ['left', 'right'].includes(handleSide(conn.toHandle));
    if (fromH && toH) {
      const mx = (from.x + to.x) / 2;
      return [from, { x: mx, y: from.y }, { x: mx, y: to.y }, to];
    }
    if (!fromH && !toH) {
      const my = (from.y + to.y) / 2;
      return [from, { x: from.x, y: my }, { x: to.x, y: my }, to];
    }
    if (fromH) return [from, { x: to.x, y: from.y }, to];
    return [from, { x: from.x, y: to.y }, to];
  }
  return [from, to];
}

function routePathD(conn, from, to, points) {
  if (conn.routing === 'curve') {
    const cx = (from.x + to.x) / 2;
    return `M${from.x},${from.y} C${cx},${from.y} ${cx},${to.y} ${to.x},${to.y}`;
  }
  return 'M' + points.map(p => `${p.x},${p.y}`).join(' L');
}

// Point at fraction t of the polyline's length. The label sits at t=0.5.
// (Old version used the midpoint of the two endpoints, which for an elbow
// route often isn't on the line at all.)
function pointAlongPolyline(points, t) {
  const segLens = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i].x - points[i-1].x, points[i].y - points[i-1].y);
    segLens.push(l); total += l;
  }
  let target = total * t;
  for (let i = 1; i < points.length; i++) {
    if (target <= segLens[i-1] || i === points.length - 1) {
      const f = segLens[i-1] ? target / segLens[i-1] : 0;
      return {
        x: points[i-1].x + (points[i].x - points[i-1].x) * f,
        y: points[i-1].y + (points[i].y - points[i-1].y) * f,
      };
    }
    target -= segLens[i-1];
  }
  return points[0];
}

// Does any segment of the polyline touch the rect? Used by box select.
// (Old version tested the endpoints' bounding box, so a diagonal line got
// selected by boxes that didn't touch it -- audit #15.)
function polylineIntersectsRect(points, r) {
  const inside = p => p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2;
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const segsCross = (p1, p2, p3, p4) => {
    const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  };
  const corners = [
    { x: r.x1, y: r.y1 }, { x: r.x2, y: r.y1 }, { x: r.x2, y: r.y2 }, { x: r.x1, y: r.y2 },
  ];
  for (let i = 0; i < points.length; i++) {
    if (inside(points[i])) return true;
    if (i === 0) continue;
    for (let k = 0; k < 4; k++) {
      if (segsCross(points[i-1], points[i], corners[k], corners[(k + 1) % 4])) return true;
    }
  }
  return false;
}

// ------------------------------------------------------------
// Arrowhead markers
// ------------------------------------------------------------
// One marker per (kind, color), created on demand. The old version had
// three fixed gray/blue markers, so a red line still got a gray arrowhead.
const MARKER_DEFS = {
  arrow: { w: 8, h: 8, refX: 7, refY: 3, body: c => `<path d="M0,0 L0,6 L8,3 z" fill="${c}"/>` },
  open:  { w: 10, h: 10, refX: 9, refY: 4, body: c => `<path d="M0,0 L10,4 L0,8" fill="none" stroke="${c}" stroke-width="1.5"/>` },
};

function markerId(kind, color) { return `m-${kind}-${color.replace('#', '')}`; }

// Markup string; also used by the SVG/PNG export.
function markerMarkup(kind, color) {
  const d = MARKER_DEFS[kind];
  return `<marker id="${markerId(kind, color)}" markerWidth="${d.w}" markerHeight="${d.h}" refX="${d.refX}" refY="${d.refY}" orient="auto">${d.body(color)}</marker>`;
}

function ensureMarker(kind, color) {
  const id = markerId(kind, color);
  if (!document.getElementById(id)) {
    connSvg.querySelector('defs').insertAdjacentHTML('beforeend', markerMarkup(kind, color));
  }
  return `url(#${id})`;
}

// Shared by the canvas and export so they draw lines identically.
function connVisual(conn, isSelected) {
  const color = isSelected ? '#4f8ef7' : safeColor(conn.color, '#6b7280');
  return {
    color,
    width: conn.style === 'thick' ? 3 : (isSelected ? 2.5 : 2),
    dash: conn.style === 'dashed' ? '6 4' : null,
    marker: conn.arrow === 'none' ? null : (conn.arrow === 'open' ? 'open' : 'arrow'),
  };
}

// ------------------------------------------------------------
// Render
// ------------------------------------------------------------
function renderConnection(conn) {
  let g = getConnEl(conn.id);
  if (!g) {
    g = svgEl('g', { id: 'conn-' + conn.id, class: 'conn-group' });
    g.dataset.id = conn.id;
    connSvg.appendChild(g);
  }
  updateConnectionEl(g, conn);
}

function updateConnectionEl(g, conn) {
  const oldEnds = document.getElementById('conn-ends-' + conn.id);
  if (oldEnds) oldEnds.remove();
  g.innerHTML = '';

  const ends = getConnectionEnds(conn);
  if (!ends) return;
  const { from, to } = ends;
  const points = getRoutePoints(conn, from, to);
  const d = routePathD(conn, from, to, points);
  const isSelected = selectedConnIds.has(conn.id);
  const v = connVisual(conn, isSelected);
  g.classList.toggle('selected', isSelected);

  if (conn.description) {
    const title = svgEl('title');
    title.textContent = conn.description;
    g.appendChild(title);
  }

  // Wide invisible stroke = easier to click. Width is set in CSS so it
  // stays ~12 screen px at any zoom.
  g.appendChild(svgEl('path', { d, class: 'conn-hit' }));

  if (isSelected) {
    g.appendChild(svgEl('path', { d, class: 'conn-glow' }));
  }

  const path = svgEl('path', { d, class: 'conn-path', stroke: v.color, 'stroke-width': v.width, fill: 'none' });
  if (v.dash) path.setAttribute('stroke-dasharray', v.dash);
  if (v.marker) path.setAttribute('marker-end', ensureMarker(v.marker, v.color));
  g.appendChild(path);

  if (conn.label) {
    const mid = pointAlongPolyline(points, 0.5);
    const text = svgEl('text', { x: mid.x, y: mid.y, class: 'conn-label', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    text.textContent = conn.label;
    g.appendChild(text);
    // Background sized to the real text (old version guessed 7px/char).
    const bb = text.getBBox();
    const w = bb.width || conn.label.length * 6.5, h = bb.height || 14;
    g.insertBefore(svgEl('rect', { x: mid.x - w / 2 - 4, y: mid.y - h / 2 - 1, width: w + 8, height: h + 2, rx: 3, class: 'conn-label-bg' }), text);
  }

  // Endpoint handles (drag to re-point an end) for selected connections.
  // They go in the overlay SVG, above nodes; in the old version they sat
  // under the node they touch and were half unclickable.
  if (isSelected) {
    const endsG = svgEl('g', { id: 'conn-ends-' + conn.id });
    [['from', from], ['to', to]].forEach(([end, pt]) => {
      const c = svgEl('circle', { cx: pt.x, cy: pt.y, class: 'conn-endpoint-handle' });
      c.dataset.connId = conn.id;
      c.dataset.end = end;
      endsG.appendChild(c);
    });
    overlaySvg.appendChild(endsG);
  }
}

// Re-render every connection touching any of these entity ids -- after a
// move/resize so lines stay attached.
function refreshConnectionsFor(entityIds) {
  state.connections.forEach(c => {
    if (entityIds.has(c.from) || entityIds.has(c.to)) renderConnection(c);
  });
}

// Re-point one end of a connection at another placement. Self-loops are
// ignored, same as old.
function reconnectEndpoint(conn, end, targetPlacement, dropPt) {
  const otherEntityId = end === 'from' ? conn.to : conn.from;
  if (targetPlacement.entityId === otherEntityId) return;
  recordChange(() => {
    const handle = nearestEdgeAnchor(targetPlacement, dropPt);
    if (end === 'from') { conn.from = targetPlacement.entityId; conn.fromHandle = handle; }
    else { conn.to = targetPlacement.entityId; conn.toHandle = handle; }
    renderConnection(conn);
  });
}
