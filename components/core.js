// ============================================================
// CORE: shared state + coordinate helpers
// ============================================================
// Two coordinate spaces exist everywhere in this app:
//   screen space  -- pixels relative to #canvas-container's top-left
//   canvas space  -- the diagram's own coordinates (placement.x/y/w/h)
// They are related by the viewport:  screen = canvas * zoom + pan
// Everything stored in the document is canvas space. Only the viewport
// transform (applyViewport in canvas.js) knows about screen space.

const MIN_ZOOM = 0.1;
// High ceiling on purpose: auto drill-in (sub-diagrams, not rebuilt yet)
// triggers when a shape is zoomed until it fills the viewport, which can
// take 15x+ on a wide monitor.
const MAX_ZOOM = 20;

// Shapes snap to this grid while dragging (hold Alt to move freely). The
// dot grid drawn behind the canvas is 3x this, so dots land on snap points.
const SNAP = 8;
const MIN_NODE_SIZE = 20;

const viewport = {
  zoom: 1,
  panX: 0,
  panY: 0,
};

// ------------------------------------------------------------
// Document
// ------------------------------------------------------------
// entities    -- the "things" (label, type, colors). Global, keyed by id.
// placements  -- where an entity is drawn on the current diagram
//                (x, y, w, h, fontSize...). Points at an entity by entityId.
// connections -- edges between ENTITIES (not placements). Drawn wherever
//                both ends are placed.
// diagrams    -- the main diagram and every sub-diagram (diagrams.js).
//                `state` holds the placements/connections of the one
//                being viewed.
const entities = {};
const state = {
  placements: [],
  connections: [],
  // User-uploaded SVGs: { id, name, dataUri, aspect }. An entity uses one
  // via type 'custom:<id>'.
  customShapes: [],
};
let diagrams = [{ id: 'diagram-1', name: 'Main', placements: state.placements, connections: state.connections, parentDiagramId: null, parentShapeId: null }];
let currentDiagramId = 'diagram-1';
let diagramIdCounter = 2; // only goes up, like nextId

// ONE id counter for the whole document. The old version kept this per
// lens and restarted it at 1 on every new lens, while entities are global,
// so a new lens's first shape reused id "s1" and overwrote lens 1's entity
// (audit #1). It only ever goes up: undo doesn't rewind it, so an id is
// never handed out twice.
let nextId = 1;
function uid() { return 's' + (nextId++); }

// ------------------------------------------------------------
// UI state (not saved, not part of undo)
// ------------------------------------------------------------
let currentTool = 'select';           // 'select' | 'connect' | 'text' | 'pan'
const selectedIds = new Set();        // placement ids, in the order selected
const selectedConnIds = new Set();    // connection ids
let defaultEdgeRouting = 'elbow';     // for new connections (mini toolbar)
let defaultArrowStyle = 'arrow';

// ------------------------------------------------------------
// Lookups
// ------------------------------------------------------------
function getPlacementById(id) { return state.placements.find(p => p.id === id); }
function getPlacementEl(id) { return document.getElementById('node-' + id); }
function getConnById(id) { return state.connections.find(c => c.id === id); }
function getConnEl(id) { return document.getElementById('conn-' + id); }
// Connections store entity ids; this finds where that entity is drawn on
// the current diagram.
function placementForEntity(entityId) { return state.placements.find(p => p.entityId === entityId); }

// ------------------------------------------------------------
// DOM
// ------------------------------------------------------------
const canvasContainer = document.getElementById('canvas-container');
const canvasEl = document.getElementById('canvas');
const worldEl = document.getElementById('world');
const connSvg = document.getElementById('connections-svg');
const overlaySvg = document.getElementById('overlay-svg');
const emptyHint = document.getElementById('empty-hint');

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function snap(v) { return Math.round(v / SNAP) * SNAP; }

// Mouse event -> screen space (relative to the canvas container).
function eventToScreen(e) {
  const rect = canvasContainer.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function screenToCanvas(sx, sy) {
  return {
    x: (sx - viewport.panX) / viewport.zoom,
    y: (sy - viewport.panY) / viewport.zoom,
  };
}

function canvasToScreen(cx, cy) {
  return {
    x: cx * viewport.zoom + viewport.panX,
    y: cy * viewport.zoom + viewport.panY,
  };
}

// Mouse event -> canvas space. (Old version: getCanvasPoint.)
function eventToCanvas(e) {
  const s = eventToScreen(e);
  return screenToCanvas(s.x, s.y);
}

// True when the user is typing somewhere, so global shortcuts stay out of
// the way.
function isTypingTarget(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

// For text that goes into SVG/XML markup we build as a string (export).
function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Colors come from color pickers, but also from loaded files. Anything that
// isn't a plain hex color (or 'transparent'/'none') falls back, so a crafted
// file can't inject markup through a color attribute.
function safeColor(c, fallback) {
  return typeof c === 'string' && (/^#[0-9a-f]{3,8}$/i.test(c) || c === 'transparent' || c === 'none') ? c : fallback;
}
