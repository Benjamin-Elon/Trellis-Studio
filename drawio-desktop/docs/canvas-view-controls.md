# Canvas view controls

The checkboxes immediately after draw.io's zoom control are personal view settings stored on this device. They do not edit the diagram, add undo/history entries, or synchronize to collaborators.

- **Show harvest size** shows dashed blue harvest-size outlines for the active garden. Each user remembers a separate choice for each diagram, page, and garden. The tooltip names the active garden. This works from Garden, Tasks, Team, and Roadmap whenever a garden is resolved. Solid black current-growth circles retain their existing behavior.
- **Show links** shows selection-link connector lines and labels throughout the editor, including across pages and diagrams. Unchecking it also removes the connectors' navigation hit targets. Linked-object highlights and roadmap dependency arrows remain visible.

New users start with harvest size unchecked and links checked. Signing out uses a separate anonymous preference bucket. Corrupt or unavailable local storage uses the defaults and retains changes in session memory. Harvest preferences for a diagram without a stable identity remain session-only.

The dashboard owns the checkbox group and active-garden resolution. The growth controller keeps its existing `getShowHarvestSize(garden)` / `setShowHarvestSize(garden, enabled)` interface. The linking controller exposes `getShowLinks()` / `setShowLinks(enabled)` through `graph.__trellisPlantingLinking` and applies visibility at its connector renderer, retaining link records while hidden.

Local storage uses versioned `trellis.harvestSize.v1:` keys with JSON-encoded user, diagram, page, and garden identities, and `trellis.showLinks.v1:` keys with a JSON-encoded user identity. Identity reads never create diagram metadata. Toolbar cleanup preserves the group; text formatting temporarily replaces it and restores the same DOM controls. When space is tight, the checkbox group can scroll horizontally while zoom and the right-hand header actions retain their space.

Verification lives in `test/canvas-view-controls.test.cjs`, `test/trellis-ui-cleanup.test.cjs`, and the Chromium layout checks in `test/helpers/plant-growth-electron.cjs`. Chromium screenshots are written to `test-results/plant-growth-verified.png` and `test-results/canvas-view-controls-narrow.png`.
