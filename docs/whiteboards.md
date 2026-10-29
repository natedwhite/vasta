# Whiteboards

Whiteboards are infinite, vector-based visual canvases built on Vasta's typed object model. Unlike generic drawing canvases, a Vasta whiteboard treats other objects (Tasks, People, Books, Pages, Queries) as first-class interactive cards alongside freehand ink, 2D shapes, sticky notes, and connectors.

Source of truth:
- [`packages/web/src/components/whiteboard/types.ts`](../packages/web/src/components/whiteboard/types.ts) (canvas element types)
- [`packages/web/src/components/whiteboard/WhiteboardCanvas.vue`](../packages/web/src/components/whiteboard/WhiteboardCanvas.vue) (rendering engine and interaction)
- [`packages/web/src/components/whiteboard/usePencilGestures.ts`](../packages/web/src/components/whiteboard/usePencilGestures.ts) (stylus and multi-touch gestures)
- [`packages/web/src/components/whiteboard/yjsSync.ts`](../packages/web/src/components/whiteboard/yjsSync.ts) (collaborative and offline Yjs sync)

---

## What Makes it Vasta's

1. **Objects on the Board**: Pressing `@` or the `+` toolbar button opens the object picker. Dragging or picking any object places a live card on the board. The card dynamically tracks the object's title, color, icon, and selected properties, and can be opened directly into its full page.
2. **Arrows that Mean Something**: Connectors anchored between two object cards index bidirectional connections in the whiteboard's rich text (`content.body`), allowing the relational graph and backlinks drawer to show relationships between connected items.
3. **Live Queries**: Dropping a saved query object onto the canvas renders its live results list directly within the card, updating as objects change anywhere across the space.
4. **Scenes & Document Embedding**: A whiteboard can define multiple named "Scenes" (custom rectangular frames with aspect ratios such as 16:9, 4:3, or 1:1). When embedding a whiteboard inside a document note via `ObjectEmbedView`, the user can select which Scene frame to display.
5. **A Board is an Object**: Whiteboards belong to the built-in system type `whiteboard`. They support tags, properties, backlinks, and export.

---

## Canvas Architecture

### Zero-Bloat Vector Engine
The canvas is implemented natively in Vue 3 and SVG without external canvas dependencies (such as `tldraw` or `excalidraw`).
- **Rendering**: All elements (ink strokes, shapes, connectors, sticky notes, object cards) share a unified Z-ordered SVG/HTML layer inside a GPU-accelerated coordinate viewport (`translate(pan.x, pan.y) scale(zoom)`).
- **Background Grid**: An SVG vector `<pattern id="wb-dot-grid">` bound directly to the viewport matrix ensures the dot grid never drifts, rubber-bands, or flickers during zoom.

### Collaborative & Offline Sync (`yjsSync.ts`)
Whiteboard data synchronizes through Vasta's existing replica and Yjs protocol:
- Each whiteboard shares the object's `Y.Doc`.
- Elements live in `Y.Map('wb_elements')` with discrete keys (`stroke:<id>`, `shape:<id>`, `sticky:<id>`, `card:<id>`).
- Metadata lives in `Y.Map('wb_meta')` (`scenes`, `defaultSceneId`, `pan`, `zoom`).
- Concurrent edits across devices (e.g. Device A moves a card while Device B draws a stroke) merge automatically without conflict.

---

## Gestures, Stylus & Tablet Support

- **Apple Pencil / Stylus**:
  - Pressure-sensitive strokes with customizable widths and styles (ballpoint pen, pencil, and highlighter).
  - Rapid retap handling: pointer events use `setPointerCapture` and native stylus touch swallowing to prevent browser double-tap word selection or dropped letters.
- **Palm Rejection**:
  - Continuous palm rejection suppresses touch input when the stylus is on screen or within 400ms of lifting off.
  - Large-contact palm rejection ignores palm heel rests while preserving intentional two-finger finger gestures.
- **Multi-Touch Gestures**:
  - **Two-finger tap**: Undo.
  - **Three-finger tap**: Redo.
  - **Two-finger pinch / spread**: Mathematically locked world-anchor zoom that tracks the exact point beneath fingertips without drift.
  - **Single finger pan**: Enabled when in Pencil Only mode or using the selection tool.
- **Trackpad Pinch-Zoom**:
  - WebKit gesture events (`gesturestart`, `gesturechange`, `gestureend`) and `wheel` (`ctrlKey`) are intercepted strictly over the canvas, preventing Safari from zooming the entire webpage while zooming smoothly to the cursor position.
