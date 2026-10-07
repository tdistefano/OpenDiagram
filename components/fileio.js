// ============================================================
// FILE I/O: new, save, open, export
// ============================================================
// Save format:
//   { entities, diagrams: [{ id, name, placements, connections,
//     parentDiagramId, parentShapeId }], currentDiagramId, diagramIdCounter,
//     customShapes, nextId }
// Placements that have a sub-diagram point at it with `subDiagramId`.
//
// Files from the old version used "lens" names for the same things
// (lenses, currentLensId, lensIdCounter, parentLensId, parentPlacementId,
// linkedLensId). They still load: see migrateLegacyDiagram.
//
// A document is ONE main diagram plus its sub-diagrams. `diagrams` holds
// all of them; the root is the one with no parentDiagramId.

function getFilename() { return document.getElementById('filename-input').value.trim() || 'diagram'; }

// ------------------------------------------------------------
// New
// ------------------------------------------------------------
// Resets everything, including custom shapes and the filename. (Old
// version kept both -- audit #13 -- and asked "are you sure" whenever the
// canvas had shapes, even right after saving.)
function newFile() {
  if (isDirty && !confirm('Create a new diagram? Unsaved changes will be lost.')) return;
  flushPendingEdits();
  Object.keys(entities).forEach(k => delete entities[k]);
  state.customShapes = [];
  diagrams = [{ id: newDiagramId(), name: 'Main', placements: [], connections: [], parentDiagramId: null, parentShapeId: null }];
  currentDiagramId = null;
  diagramViews.clear();
  document.getElementById('filename-input').value = 'Untitled Diagram';
  renderCustomShapeLibrary();
  loadDiagram(diagrams[0].id);
  resetHistory();
  showDefaultView(currentDiagramId);
  markClean();
}

// ------------------------------------------------------------
// Save folder (File System Access API, Chromium only)
// ------------------------------------------------------------
// The chosen folder handle is kept in IndexedDB so it survives reloads;
// the browser still asks for permission again in a new session.
let saveDirHandle = null;

function idbRequest(mode, fn) {
  return new Promise((resolve) => {
    const req = indexedDB.open('flow-diagram-fs', 1); // old name: keeps old saved folders
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const tx = req.result.transaction('handles', mode);
      const r = fn(tx.objectStore('handles'));
      tx.oncomplete = () => resolve(r && r.result !== undefined ? r.result : null);
      tx.onerror = () => resolve(null);
    };
  });
}
const idbGet = (key) => idbRequest('readonly', s => s.get(key));
const idbSet = (key, value) => idbRequest('readwrite', s => s.put(value, key));

async function verifyDirPermission(handle, requestIfNeeded) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (requestIfNeeded && (await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

async function restoreSaveDir() {
  if (!('showDirectoryPicker' in window)) return;
  try {
    const handle = await idbGet('saveDir');
    if (handle) { saveDirHandle = handle; updateSaveFolderLabel(); }
  } catch {}
}

async function chooseSaveFolder() {
  if (!('showDirectoryPicker' in window)) {
    alert("This browser doesn't support choosing a save folder. Files will download normally instead.");
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    if (!(await verifyDirPermission(handle, true))) return;
    saveDirHandle = handle;
    await idbSet('saveDir', handle);
    updateSaveFolderLabel();
  } catch (err) {
    if (err.name !== 'AbortError') alert('Could not use that folder: ' + err.message);
  }
}

function updateSaveFolderLabel() {
  const btn = document.getElementById('choose-folder-btn');
  btn.setAttribute('data-tip', saveDirHandle ? `Saving to: ${saveDirHandle.name}` : 'Choose save folder');
}

// ------------------------------------------------------------
// Save
// ------------------------------------------------------------
function serializeDocument() {
  syncCurrentDiagram();
  diagrams.forEach(l => { if (l.parentDiagramId) l.name = diagramDisplayName(l); });
  return JSON.stringify({
    entities,
    diagrams,
    currentDiagramId,
    diagramIdCounter,
    customShapes: state.customShapes,
    nextId,
  }, null, 2);
}

async function saveFile() {
  flushPendingEdits();
  const data = serializeDocument();
  const name = getFilename() + '.json';

  if (saveDirHandle) {
    try {
      if (await verifyDirPermission(saveDirHandle, true)) {
        const fileHandle = await saveDirHandle.getFileHandle(name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(data);
        await writable.close();
        markClean();
        flashStatus(`Saved to ${saveDirHandle.name}/${name}`);
        return;
      }
    } catch (err) {
      console.error('Folder save failed, falling back to download:', err);
    }
  }
  downloadBlob(new Blob([data], { type: 'application/json' }), name);
  markClean();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Old version never released these.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function flashStatus(msg) {
  const el = document.getElementById('status-message');
  el.textContent = msg;
  clearTimeout(flashStatus.t);
  flashStatus.t = setTimeout(() => { el.textContent = ''; }, 3000);
}

// ------------------------------------------------------------
// Open
// ------------------------------------------------------------
function loadFileDialog() { document.getElementById('file-input').click(); }

document.getElementById('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (isDirty && !confirm('Open another diagram? Unsaved changes will be lost.')) return;
  let text;
  try { text = await file.text(); } catch (err) { alert('Could not read the file: ' + err.message); return; }
  let data;
  try { data = JSON.parse(text); } catch (err) { alert(`"${file.name}" is not valid JSON:\n${err.message}`); return; }
  try {
    loadDocument(data, text, file.name.replace(/\.json$/i, ''));
  } catch (err) {
    // Old version: catch { alert('Invalid file format') } -- which also hid
    // bugs in the loader itself (audit #12).
    console.error(err);
    alert(`Couldn't open "${file.name}":\n${err.message}`);
  }
});

function loadDocument(data, rawText, name) {
  if (!data || typeof data !== 'object') throw new Error('The file does not contain a diagram.');
  flushPendingEdits();

  // Never hand out an id that already exists in the file: scan every "sN"
  // string in it. (Covers files written by the old version's per-lens
  // counter too.)
  const maxId = Math.max(0, ...[...rawText.matchAll(/"s(\d+)"/g)].map(m => Number(m[1])));
  nextId = Math.max(nextId, maxId + 1);

  Object.keys(entities).forEach(k => delete entities[k]);
  if (data.entities && typeof data.entities === 'object') Object.assign(entities, data.entities);

  // `lenses` / `currentLensId` / `lensIdCounter`: old-version names.
  const savedDiagrams = data.diagrams ?? data.lenses;
  const savedCurrentId = data.currentDiagramId ?? data.currentLensId;
  const savedIdCounter = data.diagramIdCounter ?? data.lensIdCounter ?? 0;
  if (!savedDiagrams && data.pages) {
    throw new Error('This file uses the old "pages" format, which is no longer supported.');
  }
  let loaded;
  if (Array.isArray(savedDiagrams) && savedDiagrams.length) {
    loaded = savedDiagrams.map(migrateLegacyDiagram);
  } else {
    // Oldest format: a single flat diagram with a `nodes` array.
    loaded = [migrateLegacyDiagram({ id: 'diagram-1', name, nodes: data.nodes || [], connections: data.connections || [] })];
  }

  // Drop placements whose entity is missing instead of keeping invisible
  // ghosts around.
  let dropped = 0;
  loaded.forEach(l => {
    const kept = l.placements.filter(p => entities[p.entityId]);
    dropped += l.placements.length - kept.length;
    l.placements = kept;
  });

  // Open the diagram that was open when saved.
  const diagram = loaded.find(l => l.id === savedCurrentId) || loaded.find(l => !l.parentDiagramId) || loaded[0];

  // Old-version files can hold several top-level lenses (tabs). Only one
  // main diagram is supported: keep the one containing the open diagram,
  // with its sub-diagrams, and drop the rest.
  const byId = new Map(loaded.map(l => [l.id, l]));
  const rootOf = (l) => { while (l.parentDiagramId && byId.has(l.parentDiagramId)) l = byId.get(l.parentDiagramId); return l; };
  const root = rootOf(diagram);
  const droppedRoots = loaded.filter(l => !l.parentDiagramId && l !== root);
  diagrams = loaded.filter(l => rootOf(l) === root);
  root.parentDiagramId = null;

  const maxDiagramNum = Math.max(1, ...diagrams.map(l => parseInt(String(l.id).split('-')[1], 10) || 0));
  diagramIdCounter = Math.max(diagramIdCounter, maxDiagramNum + 1, savedIdCounter);
  currentDiagramId = null; // nothing to sync back into
  diagramViews.clear();
  state.customShapes = (data.customShapes || []).filter(s =>
    s && typeof s.dataUri === 'string' && s.dataUri.startsWith('data:image/'));

  document.getElementById('filename-input').value = name;
  renderCustomShapeLibrary();
  loadDiagram(diagram.id);
  syncAllPorts();  // ports for old files (whose locked copies were dropped)
  pruneEntities(); // entities only the dropped lenses used
  resetHistory();
  markClean();
  fitToScreen();
  diagramEntryZoom = viewport.zoom;

  const notes = [];
  if (droppedRoots.length) notes.push(`This file has ${droppedRoots.length + 1} top-level lenses (tabs). Only "${root.name}" (and its sub-diagrams) was opened; ${droppedRoots.map(l => `"${l.name}"`).join(', ')} ${droppedRoots.length > 1 ? 'were' : 'was'} left out and will not be in the file if you save over it.`);
  if (dropped) notes.push(`${dropped} shape(s) referred to missing data and were skipped.`);
  if (notes.length) alert(notes.join('\n\n'));
}

// ------------------------------------------------------------
// Migrations from older save formats (ported from old fileio.js)
// ------------------------------------------------------------
// The oldest files stored each node as one object (label, colors AND
// position). Split each into an Entity + Placement.
function migrateLegacyNode(n) {
  const entity = {
    id: uid(),
    type: n.type || 'rect',
    label: n.label ?? '',
    description: n.description ?? '',
    fill: n.fill ?? '#1e3a5f',
    stroke: n.stroke ?? '#4f8ef7',
    strokeWidth: n.strokeWidth ?? 1.5,
    textColor: n.textColor ?? '#ffffff',
    radius: n.radius ?? 4,
  };
  entities[entity.id] = entity;
  return {
    id: uid(),
    entityId: entity.id,
    x: n.x ?? 0, y: n.y ?? 0, w: n.w ?? 140, h: n.h ?? 80,
    opacity: n.opacity ?? 1,
    fontSize: n.fontSize ?? 12,
    labelOffsetX: n.labelOffsetX ?? 0,
    labelOffsetY: n.labelOffsetY ?? 0,
    zIndex: n.zIndex ?? 0,
    subDiagramId: n.linkedLensId ?? null,
    ...(n.group ? { group: n.group } : {}),
  };
}

// Handles current diagrams, old-version lenses (renamed fields), and the
// oldest `nodes` arrays, where node ids are remapped so connections point at
// the new entity ids.
function migrateLegacyDiagram(l) {
  const base = {
    id: l.id, name: l.name || 'Diagram',
    parentDiagramId: l.parentDiagramId ?? l.parentLensId ?? null,
    parentShapeId: l.parentShapeId ?? l.parentPlacementId ?? null,
  };
  if (Array.isArray(l.placements)) {
    // Sub-diagrams saved by the old version contain locked/hidden copies it
    // regenerated on every visit (syncSubDiagram). They're dropped here and
    // replaced by ports (syncAllPorts after load); anything the user added
    // there themselves is kept.
    return {
      ...base,
      placements: l.placements
        .filter(p => !p.locked && !p.hidden)
        .map(({ linkedLensId, ...p }) => ({ ...p, subDiagramId: p.subDiagramId ?? linkedLensId ?? null })),
      connections: (l.connections || []).filter(c => !c.locked),
    };
  }
  const idToPlacement = new Map();
  const placements = (l.nodes || []).map(n => {
    const p = migrateLegacyNode(n);
    idToPlacement.set(n.id, p);
    return p;
  });
  const connections = (l.connections || []).map(c => ({
    ...c,
    from: idToPlacement.get(c.from)?.entityId ?? c.from,
    to: idToPlacement.get(c.to)?.entityId ?? c.to,
  }));
  return { ...base, placements, connections };
}

// ============================================================
// EXPORT (SVG + PNG)
// ============================================================
// Built from the data model, not by copying the DOM. Old version
// (audits #5, #6):
//   - PNG glued two <svg> documents into one file, which isn't valid XML,
//     so the image never loaded and nothing downloaded.
//   - labels went into the markup unescaped (a "<" broke the file)
//   - only the visible part of the canvas was exported, at screen zoom
//   - label offsets were ignored, and editor-only parts (hit areas,
//     handles) were included.
// Now: the whole diagram at 1:1, labels escaped and wrapped like on screen.
const EXPORT_PAD = 40;
const EXPORT_BG = '#13131a';
const LABEL_FONT = '"DM Sans", sans-serif';

const measureCtx = document.createElement('canvas').getContext('2d');

// Word-wrap like the on-screen label (90% of the shape's width).
function wrapLabel(text, fontSize, maxWidth) {
  measureCtx.font = `${fontSize}px ${LABEL_FONT}`;
  const lines = [];
  String(text).split('\n').forEach(para => {
    let line = '';
    para.split(/(\s+)/).forEach(word => {
      const test = line + word;
      if (line.trim() && measureCtx.measureText(test).width > maxWidth) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else {
        line = test;
      }
    });
    lines.push(line);
  });
  return lines;
}

function exportBounds() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  state.placements.forEach(p => { add(p.x, p.y); add(p.x + p.w, p.y + p.h); });
  state.connections.forEach(c => {
    const ends = getConnectionEnds(c);
    if (ends) getRoutePoints(c, ends.from, ends.to).forEach(pt => add(pt.x, pt.y));
  });
  return { x: minX - EXPORT_PAD, y: minY - EXPORT_PAD, w: maxX - minX + EXPORT_PAD * 2, h: maxY - minY + EXPORT_PAD * 2 };
}

function exportNodeMarkup(p) {
  const e = entities[p.entityId];
  if (!e) return '';
  let s = `<g transform="translate(${p.x},${p.y})" opacity="${p.opacity ?? 1}">`;
  if (e.description) s += `<title>${escapeXml(e.description)}</title>`;
  s += getShapeSVG(e.type, p.w, p.h, safeColor(e.fill, '#1e3a5f'), safeColor(e.stroke, '#4f8ef7'),
    Number(e.strokeWidth) || 0, Number(e.radius) || 0);
  if (e.label) {
    const fs = p.fontSize || 12;
    const lh = fs * 1.3;
    const lines = wrapLabel(e.label, fs, p.w * 0.9);
    const cx = p.w / 2 + (p.labelOffsetX || 0);
    const top = p.h / 2 + (p.labelOffsetY || 0) - (lines.length * lh) / 2 + lh / 2;
    s += `<text text-anchor="middle" dominant-baseline="central" font-family='${LABEL_FONT}' font-size="${fs}" fill="${safeColor(e.textColor, '#ffffff')}">`;
    lines.forEach((line, i) => { s += `<tspan x="${cx}" y="${top + i * lh}">${escapeXml(line)}</tspan>`; });
    s += '</text>';
  }
  return s + '</g>';
}

function exportConnectionMarkup(c, markers) {
  const ends = getConnectionEnds(c);
  if (!ends) return '';
  const points = getRoutePoints(c, ends.from, ends.to);
  const v = connVisual(c, false);
  let s = '<g>';
  if (c.description) s += `<title>${escapeXml(c.description)}</title>`;
  s += `<path d="${routePathD(c, ends.from, ends.to, points)}" fill="none" stroke="${v.color}" stroke-width="${v.width}"`;
  if (v.dash) s += ` stroke-dasharray="${v.dash}"`;
  if (v.marker) { markers.add(v.marker + '|' + v.color); s += ` marker-end="url(#${markerId(v.marker, v.color)})"`; }
  s += '/>';
  if (c.label) {
    const mid = pointAlongPolyline(points, 0.5);
    measureCtx.font = `11px ${LABEL_FONT}`;
    const w = measureCtx.measureText(c.label).width;
    s += `<rect x="${mid.x - w / 2 - 4}" y="${mid.y - 8}" width="${w + 8}" height="16" rx="3" fill="#1a1a1e"/>`;
    s += `<text x="${mid.x}" y="${mid.y}" text-anchor="middle" dominant-baseline="central" font-family='${LABEL_FONT}' font-size="11" fill="#e8e8f0">${escapeXml(c.label)}</text>`;
  }
  return s + '</g>';
}

function buildExportSVG() {
  if (!state.placements.length) return null;
  const b = exportBounds();
  const markers = new Set();
  const byZ = [...state.placements].sort((a, z) => (a.zIndex || 0) - (z.zIndex || 0));
  // Same layering as the canvas: negative z-index behind the lines.
  const behind = byZ.filter(p => (p.zIndex || 0) < 0).map(exportNodeMarkup).join('');
  const lines = state.connections.map(c => exportConnectionMarkup(c, markers)).join('');
  const front = byZ.filter(p => (p.zIndex || 0) >= 0).map(exportNodeMarkup).join('');
  const defs = [...markers].map(k => { const [kind, color] = k.split('|'); return markerMarkup(kind, color); }).join('');
  return {
    width: b.w, height: b.h,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${b.w}" height="${b.h}" viewBox="${b.x} ${b.y} ${b.w} ${b.h}">`
      + `<defs>${defs}</defs>`
      + `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${EXPORT_BG}"/>`
      + behind + lines + front + '</svg>',
  };
}

function exportSVGFile() {
  flushPendingEdits();
  const out = buildExportSVG();
  if (!out) { alert('Nothing to export'); return; }
  downloadBlob(new Blob([out.svg], { type: 'image/svg+xml' }), getFilename() + '.svg');
}

function exportPNG() {
  flushPendingEdits();
  const out = buildExportSVG();
  if (!out) { alert('Nothing to export'); return; }
  // 2x for sharpness, but stay under browsers' canvas size limits.
  const scale = Math.min(2, 16000 / Math.max(out.width, out.height));
  const url = URL.createObjectURL(new Blob([out.svg], { type: 'image/svg+xml' }));
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = Math.ceil(out.width * scale);
    c.height = Math.ceil(out.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    c.toBlob(blob => {
      if (blob) downloadBlob(blob, getFilename() + '.png');
      else alert('PNG export failed (the image may be too large).');
    }, 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); alert('PNG export failed: the diagram could not be rendered.'); };
  img.src = url;
}

// ------------------------------------------------------------
// Unsaved-changes guard (new)
// ------------------------------------------------------------
window.addEventListener('beforeunload', (e) => {
  if (!isDirty) return;
  e.preventDefault();
  e.returnValue = '';
});
