# Editor commits, persistence, and reusable defaults

Form Save/Apply commits valid changes to this window's diagram. Managed-project
saving still uses the existing 20-second quiet queue, signed proposals and exact
receipts. Project Save bypasses the quiet delay. Accepted peer content still needs
explicit Refresh. Permission, activity, recovery and sync capability policies are
unchanged. <!-- CHANGE -->

## Shared graph owner

`TrellisEditContext.install(ui)` supplies the existing provenance/preflight API
and three command entry points. The native graph and permission validator remain
the source of mutation and authorization semantics. <!-- CHANGE -->

| Entry point | Contract |
| --- | --- |
| `commit({id, editor?, cells, capture?, isCurrent?, prepare})` | Coalesce submissions for the same editor/id; capture draft and source versions; await read preparation; revalidate document, page, actor, sources and draft; apply the prepared command. |
| `apply({cells, manualSources?, includeAncestors?, exactCells?, metadata?, editor?, recoveryEditor?, finalize?}, operation)` | Own a synchronous native graph action and required rendering. Nested commands join the owner. Return the domain value or throw. |
| `saveDefaults({id, tasks, isCurrent?, notify?, title?, onOutcome?})` | Attempt captured default-storage tasks independently of the graph action. Return successful task names, failures and a retry function that runs only failed tasks. Optional observers update their original view after attempts and retries. |

Prepared graph commands provide `apply`, optional `finalize`, dependency `cells`,
and optionally `assertCurrent`. `capture` must return JSON-safe draft values.
Preparation does not change graph content or write reusable defaults. The graph
callbacks must be synchronous; asynchronous definition access finishes first.
Scheduler companion layout uses preloaded definitions and computes its final
layout synchronously against the resulting planting. <!-- CHANGE -->

`commit` reports `applied`, `unchanged` (no native content effect), `blocked`,
`stale` or `rejected`, with operation identity and successful dependency targets.
These are local outcomes, not durable-save receipts. `apply` preserves synchronous
domain interfaces. `registerEditor().commit()` coalesces button/navigation calls;
an editor returning `{draftRetained: true}` keeps newer fields dirty and prevents
navigation from closing them. <!-- CHANGE -->

The owner collects actual native edits, including generated tasks and synchronous
finalization effects. Application, permission or rendering failure reverses them
and restores selection and prior Undo/Redo history. Nested automation cannot
silently return a deferred result: a blocker rejects the complete operation and
leaves its draft available for a fresh manual submission. Native canvas gestures
retain their existing transaction hooks. <!-- CHANGE -->

## Capture and recovery boundaries

Managed saves and graph recovery checkpoints call `whenSettled()` and
`assertCapturable()` before serializing. They cannot capture provisional graph
state while application or compensation is underway. Already-captured saves
continue with their original snapshots; existing revision and claim-generation
checks protect subsequent typing and resumed editors. <!-- CHANGE -->

If compensation fails, further graph commits, project-save captures and regular
graph checkpoints are blocked until a new document is opened/recovered. Affected
editors freeze for review/copying. Managed sharing retains a separate private
recovery copy of the quarantined graph and editor fields; it does not replace the
last normal checkpoint or publish that graph as accepted content. Preservation
failure stays visible and has its existing retry control. <!-- CHANGE -->

## Defaults and editor adapters

Scheduler checkboxes still select reusable defaults. Planting and tasks apply
first; recipe, task, layout and climate default writes run afterward. A default
failure does not roll back or recreate the planting. Scheduler, allocation,
spacing and Year Planner use the shared **Retry defaults** notice, which remains
available after editor close or handoff. Captured payloads remain bound to their original document,
page and actor, and a superseding operation invalidates an older retry. A newer
operation waits for an already-started write of the same defaults before writing,
so the newer choices win even when storage is slow. Completed
default records are removed from the coordinator's pending map. <!-- CHANGE -->

Reference-backed definition writes continue producing private proposals awaiting
reference review; scheduling reads accepted pinned definitions. Legacy SQLite
default operations retain their existing per-operation database transactions.
No transaction is claimed across graph state and either storage path. Existing
schema initialization remains a legacy database responsibility. <!-- CHANGE -->

Scheduler and allocation creation, task commands, spacing, garden and bed
settings, graph inventories, equipment, Year Planner and object details/comments
use the shared native owner at their graph-write boundaries. Detached inventory
services and private reference drafting retain their storage-specific validation
and persistence. Late detached seed/equipment replies update the submitted base
without marking newer editor entries clean. <!-- CHANGE -->

## Verification

`test/trellis-editor-commits.test.cjs` exercises the bundled native mxGraph model:
nested rollback, rendering failure, Undo/Redo, capture waiters, stale sources and
drafts, permission rejection, blocked generation, failed compensation, independent
defaults, retry identity and asynchronous-callback rejection. Existing scheduler,
editor-lifecycle, domain, permission, reference and sync suites cover integration.
Native Electron editing and protocol-5 saving regressions remain required; <!-- CHANGE -->
these tests do not qualify or enable currently gated sync capabilities.
<!-- CHANGE -->

Working-tree verification completed for this change: 660 domain tests passed;
252 editor integration tests passed; the later focused editor run passed 217
tests. The final transaction/scheduler/native-lifecycle batch passed 50 tests.
These batches overlap and must not be added together. Current permission,
reference, sync-contract and persistence boundaries passed 255 tests with four
skips. Native managed-saving regressions passed for protocols 4 and 5.
JavaScript syntax checks and `git diff --check` passed. <!-- CHANGE -->

The wider boundary run also exercised the unchanged
`test/trellis-syncthing.test.mjs` suite: 29 tests failed on legacy protocol and
gated peer-feature expectations. Its test source, main sync service and shared
sync contract have no changes in this implementation. These failures remain
separate from the passing current-protocol boundary tests; no capability gate was
opened to make legacy expectations pass. <!-- CHANGE -->
