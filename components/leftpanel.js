// ============================================================
// LEFT PANEL
// ============================================================
//   Tools             -- select / connect / text / pan
//   Shape library     -- built from SHAPE_LIBRARY (shapes.js)
//   Custom            -- upload SVGs as your own shapes
//
// Drag payloads use app-specific MIME types instead of the old
// 'text/plain', so dragging a palette item into another app doesn't drop
// the string "rect" there.
const DRAG_SHAPE = 'application/x-opendiagram-shape';

const leftPanel = document.getElementById('left-panel');

// ------------------------------------------------------------
// Tools
// ------------------------------------------------------------
const TOOL_NAMES = { select: 'Select', connect: 'Connect', text: 'Text', pan: 'Pan' };

function setTool(name) {
  currentTool = name;
  // Left panel AND mini toolbar buttons both carry data-tool.
  document.querySelectorAll('[data-tool]').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === name);
  });
  // Cursor comes from CSS (canvas.css) keyed on this class, so the
  // temporary .panning / .pan-ready cursors can still override it.
  Object.keys(TOOL_NAMES).forEach(t => canvasContainer.classList.toggle('tool-' + t, t === name));
  document.getElementById('status-tool').textContent = 'Tool: ' + TOOL_NAMES[name];
}

document.querySelectorAll('[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => setTool(btn.dataset.tool));
});

// ------------------------------------------------------------
// Shape library (built-in)
// ------------------------------------------------------------
function iconSVG(inner) {
  return `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2">${inner}</svg>`;
}

function renderShapeLibrary() {
  const container = document.getElementById('builtin-shapes');
  container.innerHTML = '';
  const categories = [...new Set(SHAPE_LIBRARY.map(s => s.category))];
  categories.forEach(cat => {
    const section = document.createElement('div');
    section.className = 'shape-category';
    section.innerHTML = '<div class="shape-cat-title"></div><div class="shapes-grid"></div>';
    section.querySelector('.shape-cat-title').textContent = cat;
    const grid = section.querySelector('.shapes-grid');
    SHAPE_LIBRARY.filter(s => s.category === cat).forEach(def => {
      grid.appendChild(makeShapeItem(def.type, def.name, iconSVG(def.icon)));
    });
    container.appendChild(section);
  });
}

// One palette tile. `iconHTML` is trusted markup (our own icon strings);
// `name` may come from a user's filename, so it only goes into .title.
function makeShapeItem(type, name, iconHTML) {
  const item = document.createElement('div');
  item.className = 'shape-item';
  item.draggable = true;
  item.dataset.shape = type;
  item.title = name + ' — drag onto the canvas, or click to add';
  item.innerHTML = iconHTML;
  return item;
}

// ------------------------------------------------------------
// Custom SVG shapes
// ------------------------------------------------------------
function renderCustomShapeLibrary() {
  const grid = document.getElementById('custom-shapes-grid');
  grid.innerHTML = '';
  state.customShapes.forEach(shape => {
    // Built with DOM APIs, not innerHTML: the name is the uploaded
    // filename. (Old version put it straight into innerHTML -- audit #14.)
    const img = document.createElement('img');
    img.src = shape.dataUri;
    img.alt = shape.name;
    const item = makeShapeItem('custom:' + shape.id, shape.name, '');
    item.classList.add('custom-shape');
    item.appendChild(img);

    const remove = document.createElement('span');
    remove.className = 'custom-shape-remove';
    remove.title = 'Remove from library';
    remove.textContent = '×';
    remove.addEventListener('click', (e) => {
      e.stopPropagation(); // don't also trigger click-to-add
      removeCustomShape(shape);
    });
    item.appendChild(remove);
    grid.appendChild(item);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// Width / height from the SVG's viewBox, falling back to width/height
// attributes, then 1 (square).
function getSvgAspectRatio(svgText) {
  try {
    const svgEl = new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement;
    const viewBox = svgEl.getAttribute('viewBox');
    if (viewBox) {
      const parts = viewBox.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) return parts[2] / parts[3];
    }
    const w = parseFloat(svgEl.getAttribute('width'));
    const h = parseFloat(svgEl.getAttribute('height'));
    if (w > 0 && h > 0) return w / h;
  } catch {}
  return 1;
}

async function handleCustomSvgUpload(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = ''; // so picking the same file again still fires 'change'
  const skipped = [];
  for (const file of files) {
    if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') { skipped.push(file.name); continue; }
    try {
      const svgText = await readFileAsText(file);
      state.customShapes.push({
        id: uid(),
        name: file.name.replace(/\.svg$/i, ''),
        // URL-encoded rather than base64: no deprecated unescape() needed
        // (old version: btoa(unescape(encodeURIComponent(...)))).
        // Shown via <img>/<image>, where scripts inside an SVG never run.
        dataUri: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText),
        aspect: getSvgAspectRatio(svgText),
      });
    } catch {
      skipped.push(file.name);
    }
  }
  renderCustomShapeLibrary();
  // Old version skipped non-SVG files silently.
  if (skipped.length) alert('Skipped (not a readable SVG):\n' + skipped.join('\n'));
}

// Shapes already on the canvas reference the library entry by id, so
// removing it turns them into dashed placeholders. The old version's
// prompt said placed copies "stay on the canvas", which was only true until
// the next re-render or save (audit #19). Here the prompt says what will
// actually happen, and affected nodes update immediately.
function removeCustomShape(shape) {
  const type = 'custom:' + shape.id;
  const inUse = Object.values(entities).filter(en => en.type === type).length;
  const msg = inUse
    ? `Remove "${shape.name}" from the library?\n\n${inUse} shape(s) on the canvas use it and will become empty placeholders.`
    : `Remove "${shape.name}" from the library?`;
  if (!confirm(msg)) return;
  state.customShapes = state.customShapes.filter(c => c.id !== shape.id);
  renderCustomShapeLibrary();
  state.placements.forEach(p => {
    if (entities[p.entityId] && entities[p.entityId].type === type) renderPlacement(p);
  });
}

document.getElementById('svg-upload-input').addEventListener('change', handleCustomSvgUpload);

// ------------------------------------------------------------
// Drag + click to add
// ------------------------------------------------------------
// Delegated on the whole panel, so tiles added later (custom shapes) work
// without binding each one.
leftPanel.addEventListener('dragstart', (e) => {
  const shapeItem = e.target.closest('.shape-item');
  if (!shapeItem) return;
  e.dataTransfer.setData(DRAG_SHAPE, shapeItem.dataset.shape);
  e.dataTransfer.effectAllowed = 'copy';
});

// New: clicking a tile adds it at the center of the view. The old version
// only supported dragging.
leftPanel.addEventListener('click', (e) => {
  const shapeItem = e.target.closest('.shape-item');
  if (!shapeItem) return;
  const rect = canvasContainer.getBoundingClientRect();
  createShapeAt(shapeItem.dataset.shape, screenToCanvas(rect.width / 2, rect.height / 2));
});

canvasContainer.addEventListener('dragover', (e) => {
  const types = e.dataTransfer.types;
  if (!types.includes(DRAG_SHAPE)) return;
  e.preventDefault(); // marks the canvas as a valid drop target
  e.dataTransfer.dropEffect = 'copy';
});

canvasContainer.addEventListener('drop', (e) => {
  const type = e.dataTransfer.getData(DRAG_SHAPE);
  if (!type) return;
  e.preventDefault();
  createShapeAt(type, eventToCanvas(e));
});

// Safety net from the old version: if anything (a palette item, a file
// from the desktop) is dropped somewhere that isn't a drop target, the
// browser's default is to navigate to it, which wipes the whole diagram.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------
renderShapeLibrary();
renderCustomShapeLibrary();
setTool('select');
