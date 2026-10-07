// ============================================================
// SHAPE CATALOG
// ============================================================
// Single source of truth for the built-in shapes: the palette is generated
// from this list, and the drop handler reads default sizes from it. (Old
// version: 16 hand-written palette items in index.html, with special-case
// sizes hard-coded separately in the drop handler.)
//
//   type  -- stored on the entity, drives getShapeSVG()
//   name  -- palette tooltip and the new entity's default label
//   w, h  -- default size at 100% zoom
//   icon  -- inner markup of a 32x32 palette icon (stroked with currentColor)
const SHAPE_LIBRARY = [
  // Flowchart
  { category: 'Flowchart', type: 'rect', name: 'Rectangle', w: 140, h: 80,
    icon: '<rect x="4" y="8" width="24" height="16" rx="2"/>' },
  { category: 'Flowchart', type: 'diamond', name: 'Decision', w: 140, h: 80,
    icon: '<polygon points="16,4 28,16 16,28 4,16"/>' },
  { category: 'Flowchart', type: 'circle', name: 'Circle', w: 140, h: 80,
    icon: '<circle cx="16" cy="16" r="11"/>' },
  { category: 'Flowchart', type: 'rounded', name: 'Rounded', w: 140, h: 80,
    icon: '<rect x="4" y="8" width="24" height="16" rx="8"/>' },
  { category: 'Flowchart', type: 'parallelogram', name: 'Input/Output', w: 140, h: 80,
    icon: '<polygon points="8,24 4,8 24,8 28,24"/>' },
  { category: 'Flowchart', type: 'cylinder', name: 'Database', w: 100, h: 100,
    icon: '<ellipse cx="16" cy="8" rx="10" ry="4"/><line x1="6" y1="8" x2="6" y2="24"/><line x1="26" y1="8" x2="26" y2="24"/><ellipse cx="16" cy="24" rx="10" ry="4"/>' },
  { category: 'Flowchart', type: 'hexagon', name: 'Hexagon', w: 140, h: 80,
    icon: '<polygon points="16,3 28,9.5 28,22.5 16,29 4,22.5 4,9.5"/>' },
  { category: 'Flowchart', type: 'triangle', name: 'Triangle', w: 140, h: 80,
    icon: '<polygon points="16,4 28,28 4,28"/>' },
  // UML
  { category: 'UML', type: 'uml-class', name: 'Class', w: 140, h: 80,
    icon: '<rect x="4" y="4" width="24" height="24" rx="1"/><line x1="4" y1="11" x2="28" y2="11"/><line x1="4" y1="18" x2="28" y2="18"/>' },
  { category: 'UML', type: 'uml-actor', name: 'Actor', w: 80, h: 120,
    icon: '<circle cx="16" cy="7" r="4"/><line x1="16" y1="11" x2="16" y2="22"/><line x1="8" y1="16" x2="24" y2="16"/><line x1="16" y1="22" x2="10" y2="28"/><line x1="16" y1="22" x2="22" y2="28"/>' },
  { category: 'UML', type: 'note', name: 'Note', w: 140, h: 80,
    icon: '<polygon points="4,4 24,4 28,8 28,28 4,28"/><polyline points="24,4 24,8 28,8"/>' },
  { category: 'UML', type: 'cloud', name: 'Cloud', w: 140, h: 80,
    icon: '<path d="M8 24a6 6 0 0 1-1-11.9A8 8 0 1 1 22 20H8z"/>' },
  // Network
  { category: 'Network', type: 'server', name: 'Server', w: 140, h: 80,
    icon: '<rect x="4" y="4" width="24" height="8" rx="2"/><rect x="4" y="14" width="24" height="8" rx="2"/><circle cx="24" cy="8" r="1.5" fill="currentColor"/><circle cx="24" cy="18" r="1.5" fill="currentColor"/>' },
  { category: 'Network', type: 'mobile', name: 'Mobile', w: 140, h: 80,
    icon: '<rect x="9" y="2" width="14" height="28" rx="3"/><line x1="13" y1="26" x2="19" y2="26"/>' },
  { category: 'Network', type: 'document', name: 'Document', w: 140, h: 80,
    icon: '<path d="M6 2h14l6 6v22H6V2z"/><polyline points="20,2 20,8 26,8"/><line x1="10" y1="14" x2="22" y2="14"/><line x1="10" y1="18" x2="22" y2="18"/><line x1="10" y1="22" x2="16" y2="22"/>' },
  { category: 'Network', type: 'star', name: 'Star', w: 140, h: 80,
    icon: '<polygon points="16,2 19.6,11.8 30,12.4 22,19.1 24.7,29.5 16,24 7.3,29.5 10,19.1 2,12.4 12.4,11.8"/>' },
];

const CUSTOM_SHAPE_WIDTH = 120;

function isCustomType(type) { return typeof type === 'string' && type.startsWith('custom:'); }
function getCustomShape(type) { return state.customShapes.find(c => c.id === type.slice(7)); }

// Name + default size for any type, built-in or custom.
function getShapeInfo(type) {
  if (type === 'text') return { name: 'Text', w: 140, h: 40 };
  if (isCustomType(type)) {
    const shape = getCustomShape(type);
    return {
      name: shape ? shape.name : 'Custom',
      w: CUSTOM_SHAPE_WIDTH,
      h: shape && shape.aspect ? Math.round(CUSTOM_SHAPE_WIDTH / shape.aspect) : 80,
    };
  }
  const def = SHAPE_LIBRARY.find(s => s.type === type);
  return def ? { name: def.name, w: def.w, h: def.h } : { name: 'Shape', w: 140, h: 80 };
}

// ============================================================
// SHAPE SVG
// ============================================================
// Returns the inner SVG markup for a shape drawn in a w x h box. Ported
// as-is from old_version/shapes.js. All values are numbers or colors that
// came from color pickers, so nothing user-typed ends up in this markup.
function getShapeSVG(type, w, h, fill, stroke, strokeWidth, radius) {
  const sw = strokeWidth || 1.5;
  const r = radius !== undefined ? radius : 4;
  const f = fill || '#1e3a5f';
  const s = stroke || '#4f8ef7';
  if (isCustomType(type)) {
    const shape = getCustomShape(type);
    // Library entry was removed: keep a dashed placeholder so the node is
    // still visible and selectable.
    if (!shape) return `<rect x="0" y="0" width="${w}" height="${h}" fill="transparent" stroke="${s}" stroke-width="1" stroke-dasharray="4 3"/>`;
    return `<image href="${shape.dataUri}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  switch (type) {
    case 'rect':
      return `<rect x="${sw/2}" y="${sw/2}" width="${w-sw}" height="${h-sw}" rx="${r}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`;
    case 'rounded':
      return `<rect x="${sw/2}" y="${sw/2}" width="${w-sw}" height="${h-sw}" rx="${Math.min(r+10,h/2)}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`;
    case 'circle':
      return `<ellipse cx="${w/2}" cy="${h/2}" rx="${w/2-sw/2}" ry="${h/2-sw/2}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`;
    case 'diamond': {
      const mx = w/2, my = h/2;
      return `<polygon points="${mx},${sw} ${w-sw},${my} ${mx},${h-sw} ${sw},${my}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`;
    }
    case 'parallelogram': {
      const offset = w*0.15;
      return `<polygon points="${offset},${sw} ${w-sw},${sw} ${w-offset-sw},${h-sw} ${sw},${h-sw}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`;
    }
    case 'cylinder': {
      const ry2 = h*0.12;
      return `<g>
        <rect x="${sw/2}" y="${ry2}" width="${w-sw}" height="${h-ry2*2}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>
        <ellipse cx="${w/2}" cy="${ry2}" rx="${w/2-sw/2}" ry="${ry2}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>
        <ellipse cx="${w/2}" cy="${h-ry2}" rx="${w/2-sw/2}" ry="${ry2}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>
      </g>`;
    }
    case 'hexagon': {
      const hx = w/4, hy = h/2;
      return `<polygon points="${hx},${sw} ${w-hx},${sw} ${w-sw},${hy} ${w-hx},${h-sw} ${hx},${h-sw} ${sw},${hy}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`;
    }
    case 'triangle':
      return `<polygon points="${w/2},${sw} ${w-sw},${h-sw} ${sw},${h-sw}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`;
    case 'uml-class':
      return `<g>
        <rect x="${sw/2}" y="${sw/2}" width="${w-sw}" height="${h-sw}" rx="${r}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>
        <line x1="${sw}" y1="${Math.round(h*0.28)}" x2="${w-sw}" y2="${Math.round(h*0.28)}" stroke="${s}" stroke-width="${sw*0.7}"/>
        <line x1="${sw}" y1="${Math.round(h*0.55)}" x2="${w-sw}" y2="${Math.round(h*0.55)}" stroke="${s}" stroke-width="${sw*0.7}"/>
      </g>`;
    case 'uml-actor': {
      const cx2 = w/2, cy2 = h*0.18, cr = Math.min(w,h)*0.14;
      const bodyY = cy2+cr, legY = h*0.68;
      return `<g fill="none" stroke="${s}" stroke-width="${sw}">
        <circle cx="${cx2}" cy="${cy2}" r="${cr}" fill="${f}"/>
        <line x1="${cx2}" y1="${bodyY}" x2="${cx2}" y2="${legY}"/>
        <line x1="${w*0.25}" y1="${h*0.45}" x2="${w*0.75}" y2="${h*0.45}"/>
        <line x1="${cx2}" y1="${legY}" x2="${w*0.2}" y2="${h-sw}"/>
        <line x1="${cx2}" y1="${legY}" x2="${w*0.8}" y2="${h-sw}"/>
      </g>`;
    }
    case 'note': {
      const fold = Math.min(w,h)*0.18;
      return `<g>
        <polygon points="${sw},${sw} ${w-fold},${sw} ${w-sw},${fold} ${w-sw},${h-sw} ${sw},${h-sw}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>
        <polyline points="${w-fold},${sw} ${w-fold},${fold} ${w-sw},${fold}" fill="none" stroke="${s}" stroke-width="${sw}"/>
      </g>`;
    }
    case 'cloud':
      return `<path d="M${w*0.2},${h*0.8} C${w*0.05},${h*0.8} ${w*0.05},${h*0.55} ${w*0.2},${h*0.52} C${w*0.15},${h*0.35} ${w*0.32},${h*0.2} ${w*0.45},${h*0.28} C${w*0.48},${h*0.12} ${w*0.68},${h*0.12} ${w*0.7},${h*0.28} C${w*0.85},${h*0.18} ${w*0.98},${h*0.38} ${w*0.88},${h*0.52} C${w},${h*0.55} ${w},${h*0.8} ${w*0.8},${h*0.82} Z" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`;
    case 'server':
      return `<g>
        <rect x="${sw/2}" y="${sw/2}" width="${w-sw}" height="${h*0.42-sw}" rx="${r}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>
        <rect x="${sw/2}" y="${h*0.52}" width="${w-sw}" height="${h*0.45}" rx="${r}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>
        <circle cx="${w*0.8}" cy="${h*0.22}" r="${Math.min(w,h)*0.06}" fill="${s}"/>
        <circle cx="${w*0.8}" cy="${h*0.74}" r="${Math.min(w,h)*0.06}" fill="${s}"/>
      </g>`;
    case 'mobile':
      return `<g>
        <rect x="${w*0.2}" y="${sw/2}" width="${w*0.6}" height="${h-sw}" rx="${Math.min(w,h)*0.08}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>
        <line x1="${w*0.38}" y1="${h*0.9}" x2="${w*0.62}" y2="${h*0.9}" stroke="${s}" stroke-width="${sw}"/>
      </g>`;
    case 'document':
      return `<g>
        <path d="M${sw},${sw} H${w*0.7} L${w-sw},${h*0.2} V${h-sw} H${sw} Z" fill="${f}" stroke="${s}" stroke-width="${sw}"/>
        <polyline points="${w*0.7},${sw} ${w*0.7},${h*0.2} ${w-sw},${h*0.2}" fill="none" stroke="${s}" stroke-width="${sw}"/>
        <line x1="${w*0.2}" y1="${h*0.45}" x2="${w*0.8}" y2="${h*0.45}" stroke="${s}" stroke-width="${sw*0.7}"/>
        <line x1="${w*0.2}" y1="${h*0.6}" x2="${w*0.8}" y2="${h*0.6}" stroke="${s}" stroke-width="${sw*0.7}"/>
        <line x1="${w*0.2}" y1="${h*0.75}" x2="${w*0.55}" y2="${h*0.75}" stroke="${s}" stroke-width="${sw*0.7}"/>
      </g>`;
    case 'star': {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const angle = (i * Math.PI / 5) - Math.PI/2;
        const r2 = i % 2 === 0 ? Math.min(w,h)/2 - sw : Math.min(w,h)/4;
        pts.push(`${w/2 + r2*Math.cos(angle)},${h/2 + r2*Math.sin(angle)}`);
      }
      return `<polygon points="${pts.join(' ')}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`;
    }
    case 'text':
      return '';
    default:
      return `<rect x="${sw/2}" y="${sw/2}" width="${w-sw}" height="${h-sw}" rx="${r}" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`;
  }
}
