# Changelog

What changed in each release, for the people who use Vasta. New entries go under **Unreleased**;
`scripts/release.sh` names that section after the version, and the release workflow puts it on the
GitHub release page.

## Unreleased

### Added

- **OpenID Connect (OIDC / SSO) authentication.** Log in with an external identity provider like
  PocketID, Authentik, or Keycloak. Includes Settings › Single Sign-On to view provider status,
  callback URLs, and manage account linking.
- **Whiteboards.** Create an infinite canvas for freehand ink (with Apple Pencil and touch support),
  shapes, connectors (straight, curved, and angled), sticky notes, and live cards for any Vasta
  object or query. Define named **Scenes** to frame specific regions of a board and embed either the
  full board or a specific scene inside any document with `/Whiteboard` or `![[Board]]`.

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
