# Object attribution and automated changes <!-- NEW -->

Object attribution is available on selection or hover in local and shared diagrams. **View → Show object attribution** is enabled by default and remembered on this computer for each diagram user. The toggle changes only attribution overlays; collaboration activity, pending saves, failures and conflicts remain visible. Preference storage failures still allow the toggle to work for the current window. <!-- NEW -->

The two lines read **Created by [name] [time ago]** and **Last edited by [name] [time ago]**. They use Change Map's `createdAt`, `createdByUserId`, `lastEditedAt` and `lastEditedByUserId`. Creation values provide the initial last-edit fallback. Missing historical facts stay unknown; opening a file does not backfill them with the current user or time. Names resolve through existing Users records, and exact local timestamps are included in accessible descriptions. Visible relative ages refresh without changing the document. Generated planting tiles and LOD summaries use their logical planting group's badge. <!-- NEW -->

## Operation context <!-- NEW -->

`TrellisEditContext.install(ui)` installs one context per graph and captures provenance on each native model change before execution. `scope(kind, operation)` is synchronous: asynchronous preparation must enter a new scope at its eventual mutation boundary. Nested scopes restore their caller even after exceptions. Provenance is private renderer state, never synchronization authority or a new wire format. <!-- NEW -->

| Kind | Activity hold | Attribution updates |
| --- | --- | --- |
| `manual` | Existing manual-edit policy | Actual content changes |
| `generated-content` | None | Creation and actual content changes |
| `derived-presentation` | None | None |
| `attribution` | None | None |

Unclassified operations retain existing manual behavior. Classification follows the operation, so manually editing a generated object still uses normal holds. Native transactions may mix all four kinds: only their manual targets acquire activity reservations. Every content change still participates in pending-save tracking, recovery and normal commit validation. Existing signed commit claims, permission checks, dependency validation and conflict review remain authoritative. <!-- NEW -->

The integration covers generated task creation, replacement and synchronization; planting proposals, related plantings and circle grouping; automatic planting tiling and summaries; board reflow and task-label rendering; role summaries, section layouts and generated garden companions; irrigation path generation, assembly layouts and report summaries. Stable task occurrence identities retain creator facts across full replacement. New sibling plantings receive new creation attribution. Unchanged task synchronization or replacement does not advance attribution. <!-- NEW -->

Change Map and Users ignore presentation changes, metadata-only changes and unchanged writes. Content attribution no longer depends on selection or an input timer. Timestamp and actor changes belong to the original undoable edit, so Undo, Redo and rejected-edit rollback restore the recorded facts. Remote application, local view changes and history restoration do not restamp attribution. Change Map's last-editor user filter falls back to the creator only when the last-editor field is absent. <!-- NEW -->

## Deferred automation <!-- NEW -->

`run(kind, options, operation)` preflights one complete dependency group before invoking its synchronous operation. `options.cells()` resolves current source/target cells; their subtrees and ancestors participate in hold checks. `options.retry` must recalculate against current state. `automationCellsForSource(id)` exposes the Task Manager's read-only source/task/board dependency closure so scheduling and allocation can check it before changing their source. A board is treated conservatively as a group because task generation can reflow its other cards. <!-- NEW -->

Groups blocked by another editor or an unrelated local draft remain unapplied. Independent groups can proceed. The initiating synchronous manual action may maintain its own held source; this exemption comes from actual manual mutations, never selection. A scheduler explicitly identifies its own source before applying the first mutation. Its other related editors remain protected. <!-- NEW -->

An in-canvas notice identifies deferred work and offers **Retry**. Task retries recompile the current saved planting using its pinned scheduler references, recheck the source and linked tasks after asynchronous preparation, then enter normal preflight again. Layout retries read current geometry and attributes. Planting/allocation creation and schedule retries reopen the corresponding current preview/editor for review rather than replay a stale reviewed rectangle or schedule. Retry controls are private to the current document, page and author; they do not run automatically or survive a restart. <!-- NEW -->

A hold can appear after preflight, or a disconnected peer can make a conflicting change. Save-time validation and the existing recovery/conflict workflow handle those races. Where independence cannot be proved, the complete affected group is deferred. Activity status never authorizes a write. <!-- NEW -->

## Verification <!-- NEW -->

`trellis-object-attribution.test.cjs` exercises the production Users and Change Map plugins against the native mxGraph model: unselected/manual/generated edits, no-ops, maintenance, actor changes, undo/redo, rejected edits, remote application, local holds, dependency deferral, explicit retry, preferences and logical-parent badges. The renderer collaboration tests verify that automated edits still save without activity claims and mixed transactions claim only manual targets. Task Manager tests cover creator preservation across replacement. The isolated Electron check verifies selection, hover, overlay geometry and toggling without XML or selection changes; its screenshot is written under `.test-artifacts/object-attribution/`. <!-- NEW -->
