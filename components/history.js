// ============================================================
// UNDO / REDO
// ============================================================
// Snapshot-based, like the old version, but the snapshot is taken BEFORE a
// change and only kept if something actually changed.
//
// Old version (audit #2): drag/resize called saveUndo() on mouseup, i.e.
// after the move, so the first Undo restored the same state. Every plain
// click also pushed a snapshot and wiped the redo stack. Most edits (props
// panel, labels, nudges, z-order) never recorded anything (audit #3).
//
// Two ways to record a change:
//   recordChange(fn)            -- one-shot: snapshot, run fn, commit.
//   beginChange() ... commitChange()
//                               -- spans time: a drag, typing in a field,
//                                  holding an arrow key. Everything between
//                                  the two becomes ONE undo step.
// A beginChange() while one is already open does nothing, so nested calls
// merge into the outer change (e.g. "create text box" + "type its label").
const UNDO_LIMIT = 100;
const undoStack = [];
const redoStack = [];
let pendingSnapshot = null;
let isDirty = false; // unsaved changes since the last save/load/new

// The snapshot covers EVERY diagram plus which one you're in, so creating or
// deleting a sub-diagram is undoable, and undo takes you back to the diagram
// where the change was made. (Old version: current lens only, and switching
// lens wiped the history -- audit #4.)
//
// Custom shape library is NOT in the snapshot: uploads can be large data
// URIs, and copying them 100 times would bloat memory. Same as old.
function snapshot() {
  syncCurrentDiagram();
  return JSON.stringify({ entities, diagrams, currentDiagramId });
}

function beginChange() {
  if (pendingSnapshot === null) pendingSnapshot = snapshot();
}

function commitChange() {
  if (pendingSnapshot === null) return;
  // Sub-diagram inputs/outputs follow their parent's connections. Done
  // here so a parent change and the port updates it causes are one undo
  // step (ports.js).
  syncAllPorts();
  const before = pendingSnapshot;
  pendingSnapshot = null;
  if (before === snapshot()) return; // nothing changed: no undo step
  undoStack.push(before);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  markDirty();
}

// Throw away an in-progress change and put everything back (Esc mid-drag).
function cancelChange() {
  if (pendingSnapshot === null) return;
  const before = pendingSnapshot;
  pendingSnapshot = null;
  restoreSnapshot(before);
}

function recordChange(fn) {
  const owns = pendingSnapshot === null;
  if (owns) beginChange();
  try { return fn(); }
  finally { if (owns) commitChange(); }
}

// Finish anything half-done (an open label editor, a focused props field)
// so it lands as its own undo step before the next action starts.
function flushPendingEdits() {
  const el = document.activeElement;
  if (isTypingTarget(el) && el !== document.getElementById('filename-input')) el.blur();
  commitChange();
}

function restoreSnapshot(json) {
  const s = JSON.parse(json);
  // `entities` is a const object other files hold; replace contents in place.
  Object.keys(entities).forEach(k => delete entities[k]);
  Object.assign(entities, s.entities);
  diagrams = s.diagrams;
  const diagramChanged = s.currentDiagramId !== currentDiagramId;
  const keepSelection = diagramChanged ? null : { ids: [...selectedIds], conns: [...selectedConnIds] };
  if (diagramChanged) diagramViews.set(currentDiagramId, { ...viewport });
  currentDiagramId = null; // the old diagram objects are gone; don't sync into them
  loadDiagram(s.currentDiagramId);
  if (diagramChanged) showDefaultView(currentDiagramId);
  else {
    keepSelection.ids.forEach(id => selectedIds.add(id));
    keepSelection.conns.forEach(id => selectedConnIds.add(id));
    pruneSelection();
    updateSelectionUI();
  }
}

function undo() {
  if (isNavigating) return;
  flushPendingEdits();
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restoreSnapshot(undoStack.pop());
  markDirty();
}

function redo() {
  if (isNavigating) return;
  flushPendingEdits();
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restoreSnapshot(redoStack.pop());
  markDirty();
}

function resetHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  pendingSnapshot = null;
  updateUndoButtons();
}

function markDirty() { isDirty = true; updateUndoButtons(); updateDocTitle(); }
function markClean() { isDirty = false; updateDocTitle(); }

function updateUndoButtons() {
  document.getElementById('undo-btn').disabled = !undoStack.length;
  document.getElementById('redo-btn').disabled = !redoStack.length;
}

function updateDocTitle() {
  const name = document.getElementById('filename-input').value || 'Untitled';
  document.title = (isDirty ? '• ' : '') + name + ' — Open Diagram';
}
