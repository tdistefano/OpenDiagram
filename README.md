# Open Diagram
Do you not want to pay for annoying subscriptions just to draw diagrams on your computer?
Do you like drawing borderline schizo diagrams of programs and systems you'll never build?
Well then, use this piece of garbage I threw together in a couple hours with Claude.

No license because I have no clue how they work or care to learn.
I used Claude to make this, so it's just stolen info anyway.
Feel free to add features and fixes.

Gonna try and add MCP support or a model to make the output JSON files.

The following is written by Claude.

A browser-based diagramming tool: flowcharts, UML, architecture and network
diagrams, with nested sub-diagrams you can zoom into.

Plain HTML, CSS and JavaScript. No build step, no dependencies, no server.

## Running it

Open `index.html` in a browser. That's it.

Chromium-based browsers (Chrome, Edge) are recommended: the "save to folder"
feature uses the File System Access API, which other browsers don't have.
Everything else works in any modern browser.

## Features

**Drawing**
- 16 built-in shapes (flowchart, UML, network) plus your own SVGs via **Upload SVG**
- Drag a shape from the left panel onto the canvas, or click it to add it at the center
- Double-click empty canvas (or use the Text tool) to add a text box
- Double-click a shape to edit its label; drag the yellow diamond on a selected shape to move the label

**Connections**
- Drag from one of the dots on a shape's sides to another shape, or use the Connect tool
- Straight, elbow or curved lines; filled, open or no arrow; solid, dashed or thick
- Drag either end of a selected connection to re-point it
- Labels and hover descriptions on connections

**Editing**
- Select, Shift+click, box-select (Shift adds), select all
- Move with grid snapping (hold Alt to move freely), resize (Shift keeps proportions), nudge with arrow keys
- Copy, paste, duplicate (connections between copied shapes come along)
- Align, bring to front / send to back, group / ungroup
- Properties panel for colors, stroke, corner radius, position, size, opacity, font size
- Full undo/redo for every change

**Sub-diagrams**
- Right-click a shape → **Create Sub-Diagram** to give it an inside
- Open it with the badge on the shape's corner, **Enter**, the right-click menu, or by zooming into the shape until it fills the screen
- Leave with the breadcrumb at the top left, **Alt+↑**, or by zooming far out
- Sub-diagrams can be nested

**Input/output ports**
- When a shape has connections, its sub-diagram automatically gets an **Input** node for each thing connecting into it (left) and an **Output** node for each thing it connects to (right)
- Ports stay in sync with the diagram above: add, remove or re-point a connection there and the ports update; rename the neighbor and the port is renamed too
- Ports can be moved and wired to shapes inside. To remove one, remove its connection in the diagram above.

**Files**
- Save / open as JSON (`Ctrl+S` / `Ctrl+O`)
- Optionally pick a save folder once and save straight into it (Chromium only)
- Export the whole diagram as SVG or PNG
- Warns before closing the tab with unsaved changes

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `V` / `C` / `T` / `H` | Select / Connect / Text / Pan tool |
| `Space` (hold) | Pan with any tool (middle mouse also pans) |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Ctrl+C` / `Ctrl+V` / `Ctrl+D` | Copy / paste / duplicate |
| `Ctrl+A` | Select all |
| `Esc` | Deselect, or cancel a drag in progress |
| `Delete` / `Backspace` | Delete selection |
| Arrow keys (`Shift` = 10px) | Nudge selection |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / reset |
| `Shift+F` | Fit diagram to screen |
| `Enter` | Open the selected shape's sub-diagram |
| `Alt+↑` | Go up out of a sub-diagram |
| `Ctrl+S` / `Ctrl+O` | Save / open |

While editing a label: `Enter` saves, `Shift+Enter` adds a new line, `Esc` cancels.

## Project layout

```
index.html              page structure
main.css, topbar.css,   styles, one file per area of the screen
canvas.css, nodes.css,
leftpanel.css, rightpanel.css, statusbar.css
components/
  core.js         shared state, ids, coordinate helpers
  history.js      undo/redo
  diagrams.js     main diagram + sub-diagram tree, navigation, breadcrumb
  ports.js        sub-diagram input/output ports
  shapes.js       shape catalog (SHAPE_LIBRARY) and shape drawing
  nodes.js        creating and drawing shapes, label editing
  connections.js  creating and drawing connections, line routing
  selection.js    selection, box select, status bar, full redraw
  properties.js   right-hand properties panel
  commands.js     delete, copy/paste, align, z-order, group, nudge
  leftpanel.js    tools, shape palette, custom SVG upload
  fileio.js       new/save/open, legacy file migration, SVG/PNG export
  canvas.js       pan/zoom, mouse gestures, context menu, keyboard, startup
```

Scripts are plain `<script>` tags (not ES modules) so the page works when
opened straight from disk. They share globals, and the load order in
`index.html` matters only for code that runs at startup; `canvas.js` loads
last and starts the app.

## How it works

**Data model.** Each shape is two records:
- an **entity**: what the thing is (label, type, colors, description)
- a **placement**: where it's drawn in a particular diagram (position, size, font size, z-order)

Connections link entities, not placements. The main diagram and each
sub-diagram are separate **diagrams**, each with its own placements and
connections. A sub-diagram's input/output ports are placements of the
*neighbor's* entity, which is why renaming the neighbor renames the port.

**Rendering.** Everything in the diagram lives inside one `#world` element.
Panning and zooming change a single CSS transform on it, so they cost the
same no matter how many shapes there are. Handles and click targets use
`calc(… * var(--inv-zoom))` to stay a constant size on screen.

**Undo.** Snapshot-based. A snapshot of the whole document is taken
*before* each change and kept only if something actually changed. Multi-step
edits (a drag, typing in a field, holding an arrow key) become one step.
Port syncing runs inside the same step, so undo never leaves stale ports.

## File format

Saved files are JSON:

```json
{
  "entities": { "s1": { "id": "s1", "type": "rect", "label": "...", "fill": "#1e3a5f", ... } },
  "diagrams": [
    { "id": "diagram-1", "name": "Main", "parentDiagramId": null, "parentShapeId": null,
      "placements": [ { "id": "s2", "entityId": "s1", "x": 0, "y": 0, "w": 140, "h": 80, "subDiagramId": "diagram-2", ... } ],
      "connections": [ { "id": "s5", "from": "s1", "to": "s3", "routing": "elbow", ... } ] },
    { "id": "diagram-2", "name": "...", "parentDiagramId": "diagram-1", "parentShapeId": "s2",
      "placements": [ { "id": "s7", "entityId": "s3", "port": "out", ... } ],
      "connections": [] }
  ],
  "currentDiagramId": "diagram-1",
  "diagramIdCounter": 3,
  "customShapes": [ { "id": "s9", "name": "router", "dataUri": "data:image/svg+xml,...", "aspect": 1.2 } ],
  "nextId": 10
}
```

- The diagram with no `parentDiagramId` is the main diagram; the rest are sub-diagrams.
- A shape with a sub-diagram points at it with `subDiagramId`; the sub-diagram points back with `parentDiagramId` + `parentShapeId`.
- Placements with `port` (`"in"`, `"out"` or `"both"`) are a sub-diagram's input/output ports.

Files from the old version open too. The old version called diagrams
"lenses" (`lenses`, `currentLensId`, `parentLensId`, `parentPlacementId`,
`linkedLensId`), and those names are still read. Files saved now use the
new names, so they won't open in the old version. Two exceptions when
loading old files:
- the old `pages` format isn't supported
- files with several top-level lenses (tabs) open only the one that was active, and the others are not kept

## Known limitations

- Exported SVG/PNG use the system sans-serif font if DM Sans isn't installed.
- Uploading or removing a custom shape can't be undone.
- Choosing a save folder only works in Chromium-based browsers.
