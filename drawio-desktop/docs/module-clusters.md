# Module clusters and city rendering <!-- NEW -->

Trellis keeps at most two clusters expanded on a page. A cluster contains modules connected by module-level `linkedTo` IDs or Garden companion IDs, in either direction. Nested modules share their outer module's cluster. Content links and missing destinations do not connect clusters. A standalone module is one cluster. <!-- NEW -->

Modules keep independent folding controls. Any expanded member, including a nested module, occupies the cluster's slot. Opening another cluster folds every expanded member of the least recently used cluster using native folding. Folding and its generated geometry are personal view state outside editing undo. Selection, explicit expansion, and starting an edit update recency. Batch expansion keeps the first two distinct requested clusters. Startup keeps the focused cluster and the first other expanded cluster in document order. <!-- CHANGE -->

The garden picker remains available while a garden is selected. Its city dropdown offers All cities, stored city identities with geographic labels, and No city. Duplicate display labels include their city IDs. City choice and the last garden per city are local to the diagram, page, and user. Search includes eligible gardens outside the rendered subset; the picker creates at most 100 result rows at once. <!-- NEW -->

A city includes a whole cluster when any member garden belongs to that city. Clusters without gardens qualify for No city. The picker itself lists only matching gardens. Changing cities folds excluded clusters and focuses a remembered matching garden, otherwise the first garden alphabetically, otherwise a standalone group in document order. Empty city results clear selection. Following a destination outside the selected city switches cities before selecting or scrolling. <!-- NEW -->

## Neighborhood policy <!-- NEW -->

- Two expanded clusters: union of the nearest 500 qualifying clusters around each anchor. <!-- NEW -->
- One expanded cluster: its nearest 1,000 qualifying clusters. <!-- NEW -->
- No expanded clusters: the nearest 1,000 around the last selected module, using startup focus as fallback. <!-- NEW -->

Anchors are the last interacted members of the expanded clusters. Distance uses module origins in document coordinates and each candidate cluster's nearest member. Anchors are always included; document order breaks ties. Overlaps are deduplicated without filling unused places. Pan and zoom leave membership unchanged. <!-- NEW -->

The shared controller is `graph.__trellisModules.clusters`. It indexes module membership, garden labels and cities, and owns city eligibility, destination reveal, expansion policy, and rendered membership. It scans cells when the page root changes, rebuilds connectivity after structural or module-link changes, and updates module metadata directly for ordinary edits. Renderer hooks belong to that graph instance; excluded subtrees are skipped, obsolete states are removed, and connector overlays require both endpoints to be rendered. <!-- NEW -->

## Persistence and exports <!-- NEW -->

Rendering exclusion does not remove model cells or rewrite their visibility, links, or contents. Saves retain the entire page using authored geometry. Folding preferences are private to the user/device, including local-only diagrams; refresh and restore reapply them. Deliberate geometry edits still persist. See [explicit refresh](explicit-refresh.md). Current-view image/PDF exports use a filtered model snapshot, and printing uses the current view. An image with embedded XML contains that subset; save the diagram normally to retain all contents. <!-- CHANGE -->

## Limits and verification <!-- NEW -->

Whole clusters have no module-count limit. A connected group can therefore render far more work than 1,000 small clusters. All document contents remain in memory, and XML parsing, decoding, and saving still scale with total contents. Fixed neighborhoods can leave blank areas when panning away from the anchors. The cluster cap alone does not establish a responsiveness guarantee. <!-- NEW -->

`test/module-clusters-electron.test.cjs` exercises native graph models, view states, folding, undo/redo, city filtering, navigation, root changes, exports, and 1,200-garden neighborhood policy. `test/helpers/module-clusters-electron.cjs --benchmark` runs a 5,000-garden fixture; `--baseline` loads the previous plugin versions from Git HEAD and `--profile` records a CPU profile with five interaction samples. Results are written under `.test-artifacts/module-clusters`. The production helper loads the full desktop plugin set in a private profile. See [the measured performance report](module-clusters-performance.md) for results and outstanding acceptance gaps. <!-- NEW -->
