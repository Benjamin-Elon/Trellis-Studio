# Edge attachments and U routes

Trellis enrolls newly drawn, imported, pasted, duplicated and tool-generated edges
using the persisted edge style `trellisPreserveAttachment=1`. Loading a document
does not enroll its older edges. Reparenting, removing and restoring the same cell,
and undo/redo do not count as new creation.

The installer lives in `Trellis_UI_Cleanup.js` and wraps only the current graph,
view and gesture handlers. It does not change shared mxGraph prototypes or require
a rebuilt application bundle.

## Attachment rules

- Existing fixed constraints, including port references and offsets, take priority.
- Missing constraints are inferred from the first completed route using
  `getOutlineConstraint`, then saved through `setConnectionConstraint`.
- Finalization runs at `BEFORE_UNDO`, before the creation edit is published, so
  inferred anchors and enrollment belong to that same undo transaction.
- Dangling endpoints remain free until connected. Hidden child endpoints wait
  until visible; the collapsed ancestor is never substituted as the saved anchor.
- Explicit reconnection can replace an anchor, including reconnection to the same
  shape. Normal movement and resizing preserve the stored constraint.
- Self-loops retain their initial rendered bends because adding fixed constraints
  disables mxGraph's automatic loop style.

## Sides chosen while dragging <!-- NEW -->

Ordinary hover-arrow dragging fixes the source at that side's center without <!-- NEW -->
requiring Ctrl+Shift. Dragging from an explicit point or outline preserves its <!-- NEW -->
exact coordinates. An explicitly chosen arrival point also records its side; <!-- NEW -->
dropping on a target's body keeps the existing first-route inference. <!-- NEW -->

The gesture writes native `sourcePortConstraint` and `targetPortConstraint` <!-- NEW -->
styles into its preview cell before routing. Native insertion persists them <!-- NEW -->
alongside the fixed connection constraints in the creation undo transaction. <!-- NEW -->
No additional persistent side fields or document-format changes are needed. <!-- NEW -->
Endpoint reconnection replaces only that endpoint's side, and a body reconnection <!-- NEW -->
clears its previous gesture-selected direction. Native reset discards the preview <!-- NEW -->
and its side styles, including canceled gestures. <!-- NEW -->

For orthogonal edges, the renderer resolves side intent through the attachment's <!-- NEW -->
rotation, direction and flipping transforms. It uses the nearest screen-facing <!-- NEW -->
cardinal direction and gives declared shape/port restrictions priority. When <!-- NEW -->
waypoint routing ignores direction constraints, the renderer inserts outward <!-- NEW -->
clearance bends instead of moving the attachment or tracing the shape's boundary. <!-- NEW -->
These render-time corrections do not write the model or create undo edits. <!-- NEW -->

## U routing

An orthogonal U consists of two parallel legs pointing outward in the same
direction and one crossbar. Detection ignores duplicate and collinear rendered
points and tolerates the router's screen-coordinate rounding at fractional zoom.
The same detection recognizes the U's core beyond terminal clearance bends, so <!-- NEW -->
later movement retains the crossbar after a chosen side adds extra segments. <!-- NEW -->

Before movement or resizing, the installer snapshots participating U routes
connected to the affected vertices, including descendants and ports. The new
fixed endpoints determine the adjoining legs. Independent moves retain the
crossbar's position; common movement translates it once. If a terminal crosses
the crossbar, the bar extends outward using the native jetty clearance. This
preserves attachment direction but does not provide obstacle avoidance.

Movement and resize previews use the same coordinate calculation as committed
edits. Preview routing changes rendered states only. Committed waypoint changes
join the native movement/resize transaction. Explicit bend dragging still controls
the route. Other route shapes keep native routing, with terminal clearance <!-- CHANGE -->
enforced when a participating orthogonal edge has an explicitly chosen side. <!-- NEW -->

## Verification

Run from `drawio-desktop`:

```powershell
node --test test/edge-attachment.test.cjs test/edge-attachment-electron.test.cjs test/trellis-ui-cleanup.test.cjs test/cell-label-editing.test.cjs
node --test test/garden-irrigation-planner.test.cjs
```

The model/renderer suite exercises the shipped application runtime. It covers <!-- CHANGE -->
all four gesture directions, off-center points, explicit arrival/body drops, <!-- NEW -->
reconnection, cancellation, transforms, ports and save/reopen behavior. <!-- NEW -->
The isolated Electron suite uses native mouse input and Chromium's input dispatch <!-- CHANGE -->
in a hidden window. It compares U-movement and hover-arrow connection previews <!-- CHANGE -->
against committed geometry, verifies undo/redo and SVG clearance bends, and <!-- CHANGE -->
writes screenshots under <!-- CHANGE -->
`.test-artifacts/edge-attachment/<process-id>/` without opening the user's files
or using their installed application profile.
