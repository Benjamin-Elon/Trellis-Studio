# Planting overhang and rotated frames

The planting group owns its frame. Its `cellsAdded` guard suppresses mxGraph
parent expansion and child constraints only for planting-group parents, while
retaining insertion events and undo transactions. Generated circles, individual
tiles, and collapsed summaries use the same guard. Negative child coordinates
can be legitimate after rotation.

Trimming captures child positions in logical, unrotated coordinates before
changing the frame. Children are transformed around the final frame center,
including when trimming changes the center without a logical shift. Repeating
tiling with identical inputs must preserve the frame, plant positions, and count.

Allowed overhang is `circle diameter × percentage / 100` per bed edge, with no
length rounding. Valid percentages are finite decimals from 0 through 50.
Proposals, previews, and fitting share the planting owner's calculation. Saved
bed-filled plantings resize only their persisted fitted axes; offsets, disabled
slots, and logical manual positions remain part of the preview and commit.
Companion drafts retain the existing shared planting area.

Ordinary proposals and successful Spacing placement edits center the enabled
circle footprint on both local axes. Fitted axes use the bed center; other axes
use the assigned planting section. Bounds include circle radii and manual
positions, excluding headers, summaries, and disabled slots. Manual and generated
circles receive the same centering translation. User offsets are applied afterward
and are never canceled by recentering the surviving circles.

Centered plantings persist `layout_alignment="centered"` and independent
`layout_base_offset_x_cm` / `layout_base_offset_y_cm` shifts. Proposal, draft,
and preview interfaces carry `layoutAlignment`, `layoutBaseOffsetXCm`, and
`layoutBaseOffsetYCm`; displayed offsets represent only user displacement. Legacy
groups keep their existing placement until edited. Repeated tiling consumes the
saved baseline; fitting and resizing resolve a fresh baseline from logical manual
snapshots normalized against the previous baseline and user offsets. Centered
frames retain their accepted available area instead of trimming it on each fit.
An oversized manual footprint is invalid; no spacing or area expansion is hidden
inside centering. Companion patterns retain their established shared-area rules.

New plantings resolve the crop's nullable `Plants.allowed_overhang_pct` default,
falling back to 30. Existing plantings resolve their XML
`allowed_overhang_pct`, also falling back to 30; a later crop-default change does
not alter legacy plantings. Crop defaults apply across varieties and stages.

Both Spacing hosts use the shared percentage editor. Explicit edits synchronize
active draft rows for the same crop. Previewing and canceling perform no writes.
Successful Apply/Create saves planting XML and explicitly edited crop defaults,
independently of the spacing-default checkbox. Restore plant defaults reads the
current crop default. An obsolete Allocate preview must be refreshed before it
can create a planting.

Crop defaults are outside diagram history. A failed crop write keeps the saved
planting and offers a database-only retry. Writes are serialized per crop; newer
percentage commits invalidate older retry actions. Undo/Redo restores diagram
geometry, circles, counts, and percentages while crop defaults remain saved.

Regression coverage is in `plant-tiler-mxgraph-fitting.test.cjs`,
`fitted-planting-geometry.test.cjs`, and `companion-layout-preview.test.cjs`.
`planting-preview-electron.test.cjs` verifies rendered previews and percentage
controls in both editor layouts. Existing allocation, fitting, scheduler,
companion, and lifecycle tests run through `npm run test:plugins`.

This change prevents new overflow. Opening a saved diagram does not repair or
rewrite existing overflowing groups.

Bed rotation carries generated and manual circle centers with their planting <!-- CHANGE -->
groups while setting circle orientation to zero, keeping labels upright. Pure <!-- CHANGE -->
movement preserves existing circle orientation. Both changes share the original <!-- CHANGE -->
diagram transaction: Undo restores previous positions and label angles, and Redo <!-- CHANGE -->
restores the committed layout. Opening a diagram does not normalize old angles. <!-- CHANGE -->

Live bed movement and rotation previews omit plant-circle shapes and labels, <!-- CHANGE -->
temporarily hiding their original rendered nodes. Circles remain in the model <!-- CHANGE -->
snapshots used by the eventual commit. Completion, cancellation, and handler <!-- CHANGE -->
cleanup restore each node's exact prior visibility. Frames, headers, summaries, <!-- CHANGE -->
irrigation, and other bed contents keep their established preview behavior. <!-- CHANGE -->


Spacing previews retain each planting group's rotation and the bed outline's <!-- CHANGE -->
rotation. Frames rotate around their centers; circles use the tiler's already <!-- CHANGE -->
rotated coordinates, so the preview container must not rotate them again. <!-- CHANGE -->

While regular spacing or allocation has an uncommitted preview, the first Undo <!-- CHANGE -->
or Redo discards all active previews and drafts without advancing diagram history. <!-- CHANGE -->
Pending calculations, invalid drafts and temporarily hidden previews count too. <!-- CHANGE -->
The next history command operates normally; Redo does not restore discarded <!-- CHANGE -->
previews. Both commands remain available for dismissal with empty history stacks. <!-- CHANGE -->
Native label-text history retains its normal editing behavior. <!-- CHANGE -->

Dismissal restores real shapes and handles, removes retained renderer inputs, <!-- CHANGE -->
invalidates pending callbacks, and reloads regular spacing from committed values. <!-- CHANGE -->
Allocation stays open and retains valid crop/week choices, but requires a deliberate <!-- CHANGE -->
bed click, bed badge or Find best bed before proposing another planting. Clicking <!-- CHANGE -->
the already-selected bed works. Background reloads cannot recreate the proposal; <!-- CHANGE -->
Create and rotation stay disabled until another valid proposal exists. Committed <!-- CHANGE -->
crop defaults and existing Apply/Create persistence behavior remain unchanged. <!-- CHANGE -->
