# Roadmap implementation evidence

This map identifies implementation and executable evidence, rather than relying on roadmap completion labels. Paths below are relative to `drawio-desktop`.

| Design branch | Implementation | Executable evidence |
| --- | --- | --- |
| Actual startup registries, public lists, dependency completion, retry | `drawio/src/main/webapp/js/diagramly/App.js`, `js/app.min.js`, `js/integrate.min.js` | `trellis-startup-defaults.test.cjs` executes each actual assignment and simulates delayed/failed script callbacks, including the reserved Manager path |
| Calendar dates, inclusive durations, boundaries, inverse mapping, outer ranges, trimming, perspectives, ticks | `plugins/garden_planner_plugins/Garden_Roadmap_Core.js` | `roadmap-core.test.cjs`: leap centuries, local DST dates, every trim combination, boundary mapping and scale policies |
| Deterministic packing and duration-weighted progress | Core layout, packing and progress policies | Core tests cover variable row heights, stable identities, transitions, blocked counts, and 50 processes/500 objects |
| Module lifecycle and usable Main | `Modules_Standalone.js`; Manager `createBoard`, Main/secondary APIs | Manager tests cover Garden/standalone paths, missing Manager, Main removal/recreation, names, task companion rollback |
| Personal projection and storage isolation | Manager preferences, `getLayout`, display geometry hooks | Manager tests compare saved XML and undo history, switch actual Users identities, deny storage, and isolate boards |
| Native gestures, containment and free project placement | Manager native graph/vertex adapters, semantic move/resize commands, shared Modules collision delta | Production Graph tests cover native outlines, Escape, horizontal resize handles, process shifts, reparenting, modifier copies, peer displacement and atomic permission rollback | <!-- CHANGE -->
| Native interaction and Task UI | Manager hit testing and controls; shared `__trellisTaskUi`; `Deep_Click_Through.js` workspace handles | Native mouse dispatch, short-bar handlers, workspace-handle document events, name editing, shared button styling and anchored bulk assignment picker | <!-- CHANGE -->
| Today rollover | Manager `checkToday` and resume listeners | Manager test advances the window calendar while a gesture is active and verifies deferred projection with unchanged XML |
| Task creation, memberships and provenance | Manager validated task command and separate dialog; Task Manager `createRoadmapTaskInBoard` | Manager tests cover dates, failures, membership accept/decline/denial, companion creation, multiple links and source-assignment independence |
| Conditional deletion and permissions | Manager selection-wide deletion; Users narrowly scoped navigation/membership exceptions; Task Manager orphan cleanup | Manager tests cover keep/delete behavior, source-name retention, reciprocal undo/redo, actual Users task-access denial, and rejection of unrelated edits smuggled into cleanup |
| Copy hierarchy and assignments | Manager clone pairing and insertion finalization | Manager tests insert copies through graph APIs, verify Main role, reciprocal roster, cleared task links, default preferences and undo/redo |
| Export projection with canonical embedded XML | `Garden_Roadmap_Core.js`, `export3.html`, `js/export.js`; Manager export variables | Isolated native graph renderer test checks actual timeframe shape and ISO labels, projected geometry and preserved canonical XML; real image/PDF application paths still require desktop verification | <!-- CHANGE -->

Run focused evidence with:

```sh
node --test test/roadmap-core.test.cjs test/roadmap-manager.test.cjs test/trellis-startup-defaults.test.cjs
```

The manager harness loads production mxGraph, Draw.io `Graph.js`, sanitizer and plugins, with desktop dialog services stubbed. CSS color resolution and SVG text measurements use DOM-test adapters. It is not equivalent to a complete Electron application test. The local visual fixture is `test/fixtures/roadmap-preview.html`.

On 2026-09-06, automated desktop verification was blocked: Windows automation denied Google Chrome access, and the in-app browser rejected the local-file URL. No bypass was attempted. Real application startup, overlay appearance, and image/PDF output remain release verification requirements.

Validation results from this repair:

- Roadmap Core: 17 passing tests; Roadmap Manager: 27 passing tests, including real dialog cancellation, repeated trim clicks, and isolated unopened-page export decoding.
- Startup, database registration, and Updates registration: 22 passing tests. Both entire runtime bundles parse; the startup tests also execute their actual registries and dependency loaders. A malformed entity-decoder regex already present in committed `integrate.min.js` was repaired to match its adjacent encoder's escaped sentinels.
- The affected Users/Modules/Task/dashboard/linking/overlay run passed 294 of 295 tests initially; its quote-format assertion was resolved by preserving the original registry formatting and the corresponding Updates suite passed on rerun.
- The bounded full run reported 1,107 passing, four failing, and one cancelled test. One registration-format failure was subsequently repaired and retested. The remaining failures match the earlier baseline: scheduler multi-companion preview and two plant-tiler source assertions. Irrigation exceeded the 180-second file timeout; an isolated rerun was stopped after prolonged CPU-bound execution. Its harness loads only the unchanged irrigation plugin. The full suite is therefore not reported as green.
- `git diff --check` passed.

## Native interaction refactor verification (2026-09-06) <!-- NEW -->

- Minimum-row process packing supports saved row preferences with deterministic nearest-row conflicts and variable row heights. Core collision planning reuses Modules' directional push policy, bounds cascades, and plans before applying saved geometry. <!-- NEW -->
- Transfer commands validate the complete selection, defer missing-role decisions, revalidate stale dialogs, preserve cross-project dates, and repair task navigation atomically. Tests cover link/cancel/decline, native copies, actual Users denial, and undo. <!-- NEW -->
- Personal collision projection derives fresh offsets from canonical positions, includes neighboring modules in export records, and never mutates XML or undo history. No document-load companion creation or position migration was added. <!-- NEW -->
- The 50-process/500-object test enters the production graph handler directly and verifies frozen-layout reuse across 20 preview updates and cancellation with unchanged XML. Smaller tests separately exercise native mouse dispatch. This is automated integration evidence, not a desktop frame-rate measurement. <!-- NEW -->
- Final Roadmap Core, Manager and startup verification passed all 78 tests (20 Core, 46 Manager, 12 startup cases). The affected Task/Modules/Users/dashboard/linking/overlay/deep-selection/startup run passed all 369 tests. <!-- NEW -->
- The bounded full plugin run reported 1,128 passing, eight failing and one cancelled test. One failure was the initial large-board test fixture; its corrected native-handler test passes. The remaining failures are the earlier scheduler preview and two plant-tiler assertions, plus four Year Planner assertions in separately modified code (ordered strips, Plan Check summary, schema normalization, and dashboard checks). Irrigation again exceeded 180 seconds. No Year Planner or irrigation code was changed for this refactor. The full suite is not green. <!-- NEW -->
- Both runtime bundles parse as browser scripts. Node's ES-module syntax mode rejects a preexisting duplicate function declaration in the integration bundle, so browser-script parsing is the appropriate bundle check. <!-- NEW -->

Real desktop interaction and application image/PDF output remain unverified release gates. The earlier automation denials still apply; renderer and Graph tests do not substitute for those checks. <!-- NEW -->
