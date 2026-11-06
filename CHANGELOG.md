# Changelog

What changed in each release, for the people who use Vasta. New entries go under **Unreleased**;
`scripts/release.sh` names that section after the version, and the release workflow puts it on the
GitHub release page.

## Unreleased

### Added

- **OpenID Connect (OIDC / SSO) authentication.** Log in with an external identity provider like
  PocketID, Authentik, or Keycloak. Includes Settings › Single Sign-On to view provider status,
  callback URLs, and manage account linking.
- **Whiteboards.** Custom infinite canvas for freehand ink (with Apple Pencil and touch support),
  shapes, connectors (straight, curved, and angled), sticky notes, and live cards for any Vasta
  object or query. Define named **Scenes** to frame specific regions of a board and embed either the
  full board or a specific scene inside any document with `/Whiteboard` or `![[Board]]`.

### Changed

- **Angled connector control points.** Multi-turn angled connectors (U-shaped and S-shaped routes) show a midpoint handle when selected so their corner offsets can be repositioned interactively; single-turn elbows remain clean with only endpoint handles.

## 0.6.1 (2026-11-06)

### Added

- Name the other side of a relation: in a type's settings, a relation's "Name on the other side" is what the objects it links to show, e.g. "Wrote" on a person instead of "Books · Author". Agents see it too.

### Fixed

- Reminders reach the desktop app again after it reconnects (after an update, a restart or a network hiccup). Before, the server could lose track of the new connection and say "no desktop app open".
- Desktop (macOS): reminders show as a banner while Vasta is the app in front, not only in Notification Center.

## 0.6.0 (2026-11-06)

### Added

- **Whiteboards** (first version): a new built-in type whose page is an endless canvas. Put
  objects on it as cards (drag them in, or press @), write text anywhere, and link elements with
  arrows that can have a label. Pan, zoom and pinch with a mouse, a trackpad or a touch screen;
  undo and redo; a full-screen mode. Boards sync and merge across devices, offline too, and cards
  show up in their objects' backlinks. [Whiteboards →](docs/whiteboards.md)
- **Drawing on whiteboards**: shapes, sticky notes, a pen with pressure and a highlighter, an
  eraser, and frames that carry what is inside them. A bar over the selection sets colors and
  shapes, brings things forward or back, duplicates and deletes; moving lines things up with
  their neighbors; copy and paste work across boards. With an Apple Pencil, fingers only move the
  view, a resting hand draws nothing, and two- and three-finger taps undo and redo.
- **Draw on a card, note or frame**: pick the pen in the selection bar and what you draw sticks to
  that element, moving and resizing with it.
- A whiteboard's page fits the board to the screen, so it opens without scrolling.
- **Flowcharts and JSON Canvas on whiteboards**: paste a Mermaid flowchart on a board, or turn a
  Mermaid diagram in a note into a whiteboard, and it becomes shapes and arrows you can move, with
  nodes named like your objects becoming their cards. Export a board as a JSON Canvas (Obsidian's
  `.canvas`) and import one, from the board's menu.
- **Whiteboards in notes, live cards, linking arrows**: embed a whiteboard in a note, whole or
  one of its frames; show a card as one line or with its contents (a query's live results, a
  page's text); turn an arrow between two cards into a relation, so it shows in backlinks and
  queries. The board menu lists its frames to jump to.
- **Scenes on whiteboards**: a menu at the board's top left goes to each frame, with ‹ › to step
  through them like slides; an embedded scene fades out what lies outside its frame. Letting an
  arrow go over empty space offers a new note, text, shape or object at its end, and cards
  showing their contents scroll with the wheel.
- **Arrow styles and mentions on whiteboards**: arrows can curve or turn at right angles, have
  heads at either end or none, and be dashed; an arrow between two cards can mention one object
  in the other's text. Resizing lines edges up with neighbors, and cards showing their contents
  scroll by touch.
- **Agents edit whiteboards**: `get_board` and `edit_board` over MCP, and `vasta board` in the
  terminal, read a board and add, move, change and connect its elements, flowcharts and canvases
  included.
- Tag objects and set their icon and color from MCP and the CLI: `tags` (with `tagsMode` add,
  remove or replace), `icon` (an emoji or `ph:<name>`) and `color` on `create_object` and
  `update_object`; `--tag`, `--remove-tag`, `--set-tags`, `--icon` and `--color` on `vasta new`
  and `vasta set`. Missing tags are created, nested ones by path (`recipe/breakfast`).
- **Edit in tables.** Click a property's cell in a table view, or in a query shown as a table (also
  one embedded in a page), to change it right there: pick from a select, a person or a related
  object, set a date, type a text, number or link, and a checkbox toggles with one click. With the
  keyboard, Tab moves between cells, Enter or Space opens one, Enter saves what you typed and
  Escape puts it back. Formulas and long text stay read-only; the title still opens the object.
  Thanks to @bokehsec (#50).
- **Export a space** (Settings › Space › Export…, or `pnpm vasta space export` on the server):
  a ZIP with a Markdown file per object (properties in front matter, links between objects as
  links between files, so Obsidian and other apps read it), whiteboards as JSON Canvas, the files
  objects use, and everything as JSON with nothing left out. [Export →](docs/export.md)

### Changed

- **A new logo**: a soft tile with a V cut from its top, Vasta's own mark instead of a planet icon.
  It is the app icon (installed web app, desktop app, browser extension), the favicon (light and
  dark tabs), and the logo on the login screen and in the README. The files, colours and usage
  are in `design/logo/`.

### Fixed

- **Files are only served to the spaces that use them.** A picture, PDF, cover or link preview
  opens for members of a space whose objects use it; before, anyone logged in who knew a file's
  name could fetch it (#2).
- **No blur over the top of the app on iOS and iPadOS 27** when it is installed on the home screen
  (#45). The fix works around a system effect and may need another look after iOS updates.

## 0.5.1 (2026-11-04)

### Fixed

- **Vasta at a plain-http address** (e.g. `http://192.168.1.10:3000` on your network) can add
  properties, select options, views and the other things that get a new id again; browsers only
  offer `crypto.randomUUID` over HTTPS or localhost. Thanks to @natedwhite for finding the cause
  (#43).
- **Mentions with Markdown characters in their title**, such as an underscore, no longer gain
  backslashes each time an agent rewrites the page. Thanks to @bokehsec (#46).

## 0.5.0 (2026-11-03)

### Added

- Set, inspect or remove object covers by URL and pin or unpin objects from MCP and the CLI.
- Choose editor block spacing in Appearance settings, with a roomier default.
- Independently opt into logging desktop quick captures in the daily note or showing them in the inbox.

### Fixed

- Opening a calendar day or reading it through MCP and the CLI no longer creates an empty daily note.
- Markdown object links open their targets from headings and table cells, and imported task lists
  can be checked as soon as the editor opens.
- Instagram Reel weblinks use short titles and skip automatic readable-text extraction.
- The Tags tree displays custom tag icons.

### Changed

- **Sticky note creation on whiteboard.** Dragging with the sticky note tool now interactively sizes and creates a sticky note matching the dragged bounding box, with a live dashed preview while dragging (clicking still creates a default-sized note).
- **The toggle's arrow** is bigger and sits centered on the title's line; the lines inside line up
  with the title.

### Fixed

- **Whiteboard connectors.** Arrow connectors now terminate cleanly at the outer boundary of snapped objects, the midpoint control handle on curved connectors renders on top of the stroke, and elbow (angle) connectors no longer display an unnecessary middle handle when selected.

## 0.4.1 (2026-10-27)

### Added

- **Quick capture asks a template's questions.** With Settings › Desktop app › "Ask a template’s
  questions in quick capture" (off by default), a `/Type …` line whose template asks something
  shows those questions before it saves, in the dialog and in the desktop app's floating panel
  (after updating the desktop app). Questions the line already answers (`body:yes`) are not asked.
- **Tab nests lines in toggles, as in Capacities.** Tab on a line puts it inside the toggle above
  it, or turns the line above into a toggle holding it; Shift+Tab takes it back out (a toggle left
  empty is a plain line again). Lists keep their own Tab.
