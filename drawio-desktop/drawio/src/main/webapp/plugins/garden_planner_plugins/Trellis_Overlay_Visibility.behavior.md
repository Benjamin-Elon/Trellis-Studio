# Informational overlays during manipulation <!-- NEW -->

Trellis hides informational overlays across one graph while an object is moved, copied by dragging, resized, or rotated. Native drag handles and shape-library drags use the same rule. Library drags activate suppression only while over the graph. <!-- NEW -->

Presses, ordinary clicks, panning, marquee selection, keyboard nudges, and programmatic geometry changes do not activate suppression. Fixed toolbars, sidebars, dialogs, object content, and active movement/resize/rotation feedback remain visible. <!-- NEW -->

## Shared controller <!-- NEW -->

`Trellis_UI_Cleanup.js` installs `graph.__trellisOverlayVisibility`. Overlay owners call `mark(node)` on informational HTML or SVG roots. A graph-specific CSS rule temporarily removes marked roots from rendering and hit-testing without rewriting inline display values or discarding panel DOM. Newly marked roots are immediately covered by an active rule. <!-- NEW -->

Gesture integrations call `begin(source)` and `end(source)` with their handler instance. Sources are idempotent and independent; suppression ends after the last source finishes. `isSuppressed()` lets measurement-dependent positioning wait for restoration. <!-- NEW -->

The graph emits `trellisOverlayVisibilityChanged` with a boolean `suppressed` property. On restoration, CSS is removed and owners synchronously reposition retained panels before the animation frame paints. Owners continue to enforce selection, mode, permission, and manual-dismissal policies. <!-- NEW -->

## Participating overlays and feedback <!-- NEW -->

Bed panels, occupancy rails/selectors, planting panels/detail controls/growth badges, module controls, task controls/assignee badges, irrigation HUDs/annotations, link annotations, object details, allocation badges, permission badges, change-map annotations, Roadmap controls/pricing/dependencies/date annotations, and workspace hover handles participate. <!-- NEW -->

Native selection and preview shapes, bed transformation ghosts, path-snapping guides, dimension/rotation hints, irrigation creation ghosts, active Roadmap date feedback, and fixed dashboard controls remain visible. Mark informational roots individually when their host also contains these elements. <!-- NEW -->

## Lifetime and verification <!-- NEW -->

Commit, reset, Escape, outside release, pointer/touch cancellation, blur, and graph destruction release suppression. Drag-handle cancellation also detaches its document listeners and does not commit a move. Repeated plugin loading retains graph ownership identifiers. <!-- NEW -->

`test/overlay-manipulation-visibility.test.cjs` exercises production mxGraph handlers and source ownership. `test/overlay-manipulation-electron.test.cjs` verifies real CSS precedence over inline styles, pointer hit-testing, retained drafts, native and handle gestures, library entry/exit, and restored panel alignment in Chromium. <!-- NEW -->
