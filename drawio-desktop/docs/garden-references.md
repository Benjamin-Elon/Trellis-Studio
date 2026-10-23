# Garden references — phase 1

New garden modules embed their reusable definitions in the diagram. Garden Settings offers **Local defaults** and garden templates from the current diagram (including other pages) and readable, locally available Garden Library diagrams. A template creates an empty garden through the existing module factory, retaining fresh ownership and linked module identities. It copies definitions, units, dimensions, paths, city settings, and circle limits. Equipment becomes wishlist inventory; irrigation stock becomes unknown with zero quantity. People, tasks, plantings, collaboration history, and pending proposals are omitted.

The local SQLite database supplies creation defaults only. Restoring or editing that source does not replace an existing portable garden's accepted definitions. Existing diagrams are intentionally left on their original workflow; phase 1 does not migrate them. The database seeder remains phase 2.

## Editing and review

Plant, variety, stage, city, recipe, equipment, task type, capability, and irrigation definition editors save private **unsent drafts**. Operational inventory changes still use the existing garden attributes. Open **Extras → Garden references…** to inspect or export accepted JSON, import a portable JSON snapshot as a draft, choose receiving gardens, add a rationale, and explicitly send a proposal. Imports preserve portable identities; matching names or numeric IDs never imply identity.

Unsent work is stored in IndexedDB under the diagram, page, garden, and active user identity. It is not a reusable source catalog or an accepted-data mirror. Draft writes finish before the existing desktop close handshake completes. A storage failure is reported, and JSON export remains available. A failed or partly completed send retains its draft and stable delivery IDs for retry.

Proposals and item decisions appear in **Messages** and in Garden references. An editor, including an administrator, may propose. Only the receiving garden's current owner may accept or decline; administrator rank does not override that rule. Owners can select items, explicitly map foreign identities, choose values for overlapping fields, and preview again before accepting. Required dependencies must already exist or be included. Arrays are merged as complete values. Already decided items and stale previews are rejected.

Definitions can be retired or restored through proposals. Retirement hides future picker choices while retaining immutable revisions for existing consumers. Inventory state needed by retired, pinned equipment remains separate from reusable definitions and is omitted from templates.

## Existing plantings

Plantings, saved planner crops, irrigation parts and pipes retain a manifest pin. Scheduling and nutrition use captured garden contexts rather than the currently selected garden. Accepted SQL views are read-only; definition writes use separate in-memory draft views. Missing pins, relationships, schemas, or explicit varieties fail instead of reading the local database.

An owner may optionally select unstarted plantings during an acceptance preview. Every selection must have a future planned start in the garden's timezone and no DOING/DONE task, actual work, completion, or actual harvest/yield evidence. Missing dates or timezone information exclude it. The guard is checked against both the original and proposed city definitions and again at commit.

The existing scheduler and task compiler prepare the selected schedules, yields and tasks. Acceptance, pins, layouts, and task reconciliation run in one graph transaction; failure rolls the transaction back. Occupied planting rectangles remain fixed. Unselected plantings and their linked tasks retain their saved versions. Preview details show the selected changes and generated tasks before acceptance.

## Implementation boundaries

- `js/trellis-reference-core.js` owns portable UUID identities, immutable revisions/manifests, local SQL bindings, dependency encoding, proposals, identity mapping, three-way merging, and transition validation. Layout strings and climate override keys encode their embedded relationships too.
- `Garden_References.js` orchestrates templates, captured contexts, private drafts, Messages, review, and atomic graph updates. `js/trellis-reference-drafts.js` supplies only private unsent storage.
- `src/main/trellis-reference-database.js` reads a creation source and materializes bounded in-memory SQL views. It preserves declarative primary/unique keys and the existing normalized city identity. It never writes a database file or executes schema SQL from a document.
- `src/main/trellis-reference-policy.js` validates owner decisions during signed collaboration replay, independently of general editing ranks. Library delivery uses the existing signed object journal and recovery mechanism.

## Limits and failure modes

Immutable history increases diagram size. Snapshots are compacted when creating a new template-based garden; existing consumer history is retained. There is no automatic pruning or schema migration.

Pins preserve input definitions. They do not freeze a future application's scheduler implementation; saved schedule outputs remain stored on the planting. Recalculation uses the installed scheduler and can refuse a previously feasible date when proposed definitions make it infeasible.

A library recipient must be readable, locally available, and enabled for signed collaboration. Unavailable recipients are not downloaded automatically. Concurrent signed transactions can still be rejected by the existing collaboration protocol; its recovery artifact remains the recovery path. A successful delivery receipt means the typed proposal was submitted, not accepted by its owner.

An open dialog keeps its captured version. Reopen it to see newly accepted definitions. Changing the active user or diagram invalidates its context. A review also becomes stale when the garden, selected planting, or linked tasks change.

Acceptance is append-only. Native undo cannot erase accepted shared history; propose a new change or restoration to reverse an accepted definition.

## Verification

Reference core, real SQLite projections, signed authority and library delivery:

```powershell
node --test test/trellis-references.test.mjs test/trellis-garden-library.test.mjs
```

Real mxGraph creation and settings, private drafts, captured schedulers, selected planting rollback, production catalogs, and cross-page delivery:

```powershell
node --test test/trellis-references-ui.test.mjs
```

Existing scheduler, year planner, allocation, equipment, irrigation, Users, collaboration, and desktop close tests provide the surrounding regression coverage.
