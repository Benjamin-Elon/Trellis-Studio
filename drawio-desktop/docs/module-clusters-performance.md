# Module cluster performance validation <!-- NEW -->

## Status <!-- NEW -->

The rendering and expansion policies pass their native Electron correctness checks. The 5,000-garden isolated renderer benchmark misses every responsiveness target. These limits must not be presented as proof that 5,000 gardens are responsive. Full production acceptance remains unverified. <!-- NEW -->

## Fixture and environment <!-- NEW -->

Measured on this computer: Windows, Intel Core i3-1115G4 at 3.00 GHz, four logical CPUs, approximately 7.74 GiB physical RAM, Electron 38.7.0, software rendering. The isolated renderer loads the production Graph class with CSS transforms and the Modules, Dashboard, and Vertex Linking plugins. It uses a private loopback origin and an offscreen window to avoid hidden-window animation throttling. <!-- NEW -->

Each garden has five beds, twenty planting groups with existing collapsed-detail summary attributes, twenty task cards, three cloned native role cards with their fields, and Garden/Team/Task/Roadmap companion modules. In the isolated harness the task board and roadmap are lightweight placeholders; the production helper clones their real templates. The isolated 5,000-garden fixture contains 540,002 model cells and 167,966,535 XML characters before interactions. It assigns five cities and separates workspace coordinates to avoid measuring intentionally overlapping layouts. <!-- NEW -->

Opening includes XML parse/decode, installing the decoded root, and two animation frames; fixture generation is excluded. Saving measures full native XML encoding and serialization, excluding disk I/O. Selection, content edits, and expanding all four companion modules include two animation frames. Pan/zoom measures alternating translation and zoom with one animation frame per iteration. Results include background callbacks scheduled by those interactions. <!-- NEW -->

## Isolated renderer results <!-- NEW -->

The initial changed-code run used 25 interaction samples. The prior-version comparison used five samples and a CPU profiler. They are separate runs with different instrumentation and sample counts, so timings are directional observations, not a controlled statistical speedup claim. <!-- NEW -->

| Metric | Target | Previous plugins, five profiled samples | Changed plugins, 25 samples | <!-- NEW -->
| --- | ---: | ---: | ---: | <!-- NEW -->
| Selection p95 | ≤100 ms | 2,372 ms | 1,152 ms | <!-- NEW -->
| Content edit p95 | ≤100 ms | 7,429 ms | 403 ms | <!-- NEW -->
| Cluster switching p95 | ≤300 ms | 8,907 ms | 1,414 ms | <!-- NEW -->
| Pan/zoom | ≥30 fps | 0.11 fps | 1.93 fps | <!-- NEW -->
| Opening | ≤10 s | 58.83 s | 60.62 s | <!-- NEW -->
| XML save | ≤5 s | 52.13 s | 29.19 s | <!-- NEW -->
| Renderer states at end | Record | 20,522 | 2,702 | <!-- NEW -->
| JavaScript heap at end | Record | 648.6 MiB | 509.2 MiB | <!-- NEW -->

A subsequent changed-code profile with five samples recorded 47.57 s opening, 22.90 s saving, 4,492 ms selection p95, 9,088 ms edit p95, 3,552 ms switching p95, and 2.57 fps. It ended with 2,774 states, 505.8 MiB JavaScript heap, and a renderer working set of approximately 2.67 GiB. Five-sample p95 values are effectively maxima; profiling, cold work, garbage collection, and host memory pressure can cause large spikes. This run also misses all targets. <!-- NEW -->

The 25-sample run ended with 623 rendered clusters, and the short profile ended with 641. Both are valid unions of two overlapping 500-cluster neighborhoods; overlap is deliberately not backfilled. Complete serialized documents retain every garden. <!-- NEW -->

## Measured work addressed <!-- NEW -->

The production plugin profile identified a Roadmap display-projection walk performed before its cache check on geometry reads. The cache now returns before walking the diagram, and display projection sources use the shared rendered module index and expanded roadmaps. A regression test checks that repeated geometry reads do not walk the document root. <!-- NEW -->

Role summaries now update affected role ancestors and inserted role subtrees instead of scanning every model cell on ordinary changes. Planting growth rendering uses current rendered states when the cluster controller is active. Dashboard lookup and sorting reuse indexed garden labels and cities. Cluster ordering indexes siblings once during structural rebuilds rather than searching a large sibling list for each module. <!-- NEW -->

The latest small production profile confirms that the former Roadmap walk is no longer a leading sampled cost. It exposes full-document XML capture in the collaboration change listener, plus collaboration badges and dimension overlays. The initial-claim branch now leaves snapshot capture to its existing queued claim operation, removing a redundant synchronous serialization without changing pending-claim recovery or save behavior. A renderer test checks this capture boundary. Dimension overlays avoid rewriting identical text before measuring their widths. These two follow-up changes are covered by relevant tests but are not included in the 5,000-garden timings above. <!-- NEW -->

The subsequent isolated CPU profile still records substantial native XML codec work and garbage collection: approximately 20.4 sampled CPU seconds in garbage collection, 11.6 in codec lookup, 10.8 in object encoding, and 9.2 in XML parsing across fixture creation, load, interaction, and save. These are whole-run samples, not per-interaction timings. View validation, text bounding boxes, and Dashboard sorting remain visible. The rendering cap does not address the complete persistence cost. <!-- NEW -->

## Correctness coverage and remaining gaps <!-- NEW -->

Native tests cover linked chains and cycles, companion relationships, missing destinations, ignored content links, nested modules, whole-member eviction, direct native folding, batch expansion, recency, undo/redo, mixed cities, geographic labels, empty No city results, city persistence, direct native page-root changes, excluded-destination navigation, filtered visual export requests, and complete normal saves. A 1,200-garden case verifies 1,000-cluster limits, overlapping neighborhoods, distant anchors, a 240-garden city, unchanged membership during pan/zoom, and a single connected cluster containing all 1,200 gardens. <!-- NEW -->

Existing module, folding, Dashboard, growth, link-overlay, Roadmap manager/core, native header-drag, growth Electron, and collaboration renderer checks pass. Full production profiling was attempted in an isolated desktop profile. An earlier run encountered `prepareReferenceRecalculation is not defined` in concurrent reference-feature work; that run is not acceptance evidence. A later 50-garden production attempt loaded and completed the first interaction but did not finish the interaction loop during several minutes of observation and was interrupted. Its retained CPU checkpoint is diagnostic evidence, not a completed benchmark. The production helper rejects uncaught plugin-startup errors before measuring. <!-- NEW -->

The full production 5,000-garden scenario matrix, real disk-save target, and visual image/PDF/print output inspection remain acceptance gaps. The 1,200-garden scenario checks establish policy correctness, not the missing production performance evidence. A whole connected component can still exceed a fixed rendering workload, document contents remain resident, and panning beyond fixed neighborhoods can reveal blank areas. <!-- NEW -->

## Reproduction <!-- NEW -->

Run `node --test test/module-clusters-electron.test.cjs` from `drawio-desktop`. For a dense benchmark, clear `ELECTRON_RUN_AS_NODE` and run `node_modules/.bin/electron.cmd test/helpers/module-clusters-electron.cjs --benchmark`; add `--baseline --profile` for the five-sample previous-plugin profile, or `--profile` for changed-code profiling. Raw JSON and CPU profiles are placed in `.test-artifacts/module-clusters`. The helper records CPU, Electron version, memory, state counts, and cluster-index counters alongside current benchmark output. <!-- NEW -->

For the full desktop plugin set, run `node_modules/.bin/electron.cmd test/helpers/module-clusters-production-electron.cjs` with `ELECTRON_RUN_AS_NODE` cleared. `TRELLIS_CLUSTER_COUNT` defaults to 5,000 and can reduce fixture size for diagnosis. It creates a private identity and garden, blocks external network requests, records periodic CPU profiles, and attempts a native disk save. Its renderer launch can require execution outside the filesystem sandbox. <!-- NEW -->
