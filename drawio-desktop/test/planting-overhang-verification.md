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
