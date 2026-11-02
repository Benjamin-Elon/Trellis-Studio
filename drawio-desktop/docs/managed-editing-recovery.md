# Managed garden editing and loss recovery

Managed gardens save after 20 seconds without a graph edit or relevant text entry.
Private text entry resets the quiet timer without marking the graph dirty or
starting a graph save. Manual Save bypasses the timer. Heartbeats remain on a
five-second cadence and private recovery checkpoints remain on a ten-second
cadence. Ordinary local draw.io files keep their existing scheduling.
<!-- CHANGE: document the managed editing lifecycle and its internal contracts. -->

An edit ends on successful object-level Save/Apply, explicit discard, label completion,
or leaving a details editor and its formatting toolbar. Merely opening a clean panel
or selecting its object does not pin an editing hold. Starting another object edit or
switching an editable section with uncommitted changes asks **Commit changes**,
**Discard changes**, or **Stay here**. Commit reuses the domain Save/Apply command
without closing the panel. Validation failure leaves its section and entries intact.
Discard restores the latest committed baseline; earlier commits remain undoable.
<!-- CHANGE: make editor intent independent of selection and persistence. -->

A successful object commit applies to the diagram and uses the same 20-second quiet
queue. The panel may remain open for viewing, but no longer counts as an active draft.
The local editing hold remains available for persistence and is released after a save
covering those changes succeeds, even when that object remains selected. Another local
edit can use the pending hold; other sessions continue to respect it. Project Save,
Ctrl+S, and explicit Save & release bypass the quiet delay. Clean cancellation releases
without a diagram save. <!-- CHANGE -->

Release checks the document generation, actor, original claim, live editor ownership,
and whether the captured content is still current. An older save or delayed close
cannot release a resumed edit or a replacement claim. Failed saves retain pending
changes and protection for retry. Hold-only release failure is reported separately
from a content-save failure. Selection and ancestor membership do not keep completed
editing sessions alive. <!-- CHANGE -->

Automation distinguishes active local editors from local holds retained only for
persistence. Its `active` field is always boolean; pending persistence does not block
another edit in the same session, while active unrelated drafts and other sessions
remain protected. A blocked scheduler Save retains its entries and names the blocker
as plain text. Resolve the conflict and click Save again; the scheduler recalculates
against current state and does not queue a separate Retry action. Nested planting
creation reports the same blocker rather than an invalid-target error. The shared
edit context's optional synchronous `onBlocked(holds)` callback runs before queuing;
throwing reports the captured blocker without mutation or deferral. Other callers
retain their existing deferred return and Retry behavior. <!-- CHANGE -->

## Ownership observations

Object badges, their pinned activity dialogs, and the Sharing overview describe pending
changes, viewing, and editing ownership independently. Pending-only activity without
a reported hold does not block editing. A disconnected session's last reported save
state remains explicitly unconfirmed. “Working locally” describes connectivity;
it does not establish whether an object has an editing hold. <!-- CHANGE -->

Explicit session closure and window cleanup retire pending activity notices without
declaring unfinished work saved or deleting private recovery data. Historical signed
closed-session notices are excluded when read; missed heartbeats alone do not retire
pending work or ownership. No activity-format migration is required. <!-- CHANGE -->

Activity dialogs offer Save now or Retry save for this window's committed changes,
Review changes for its conflicts, and the existing release/request actions for holds.
Save actions persist all committed pending changes in this window. Another session
belonging to the current author links to private recovery drafts on this computer;
a draft stored on another computer may only be available there. Another author's
private draft remains accessible only to that author. Refresh status reads activity
without renewing ownership or refreshing diagram content. Live updates preserve
focused controls, and action errors remain visible for retry. <!-- CHANGE -->

The activity service assigns every IPC snapshot a process-wide increasing
`observationRevision`. Status notifications sample current activity instead of
reusing the transport's cached ownership projection. Action replies and activity
events carry the same ordering metadata, session identity, and originating actor.
These fields are observations made by this process, not signed peer records or
durable commit claims; the sharing protocol version is unchanged.

The renderer adopts activity through one function. It rejects older observations
and observations for another actor or session. Suspected hold loss is confirmed
with `activityAction({ kind: 'snapshot', expectedUserId, shareId })`; this read does
not renew a lease. A failed confirmation reports unconfirmed status and does not
authorize rollback. Duplicate checks share their pending claim-specific operation.
Intentional releases suppress loss only for the claims actually being released.

Snapshot `losses` distinguish changed access, requested handoff expiry, and
concurrent-editor priority. Missed heartbeats never end ownership. A verified access revocation stages the
original author's private fields before permission revalidation can sign them out.
Graph reconciliation still waits for confirmation and any accepted in-flight save.
The displayed handoff countdown uses its request deadline. Presence becomes
disconnected or unconfirmed after thirty seconds without fresh progression;
ownership has no deadline until another authorized editing session requests release.
<!-- CHANGE: presence freshness no longer determines editing ownership. -->

Signed activity snapshots retain a distinct claim generation for each acquisition.
Unrequested holds expose `expiresAt: null`; requested holds expose the five-minute
deadline measured from the request's original timestamp. Duplicate requests and
heartbeats cannot extend it. Stored ownership and requests remain effective after
activity-service restart even while presence is unconfirmed. Another window of the
same user may request release; the holding session cannot request its own release.
Release publications carry the observed `claimIds`; the service ignores an old
generation's release if a replacement acquisition now owns that target.
<!-- CHANGE: request-driven ownership uses the existing activity channel and protocol. -->

An explicit requester exit records cancellation timestamps in its signed snapshot.
Cancellation before that request's deadline withdraws it; cancellation at or after
the deadline retains terminal expiry evidence. Other requesters keep their original
deadlines. A missed heartbeat never cancels a request. Expired editors must release
their old generation before acquiring a fresh one, and delayed heartbeats cannot
restore it. Activity-service shutdown flushes pending window-exit publications.
<!-- CHANGE: retain request outcomes independently of presence and window lifetime. -->

Network partitions can permit overlapping local work until release information
arrives. Delayed delivery may leave less than five minutes of visible warning,
and cross-device clock differences affect deadlines. Existing content validation
and private recovery handle rejected work. All collaborating devices are assumed
to run the updated build; no migration or compatibility gate is introduced.
<!-- CHANGE: document the limits of advisory ownership. -->

## Editor contract

`Trellis.sharing.registerEditor(config)` accepts the existing domain capture/save/
discard callbacks plus:

- `element`: the editor element, or a function returning an element created later.
- `freeze(reason)`: invalidate pending domain work and block programmatic writes
  without closing the original editor or clearing its fields.

The returned handle exposes `frozen()`, `active()`, `acquire()`, `touch()`, and
`dispose()`, plus these lifecycle operations: <!-- CHANGE -->

- `checkpoint()` captures a clean baseline after initial rendering or a successful section transition.
- `dirty()` reports domain changes; `isDirty()` on the registration can supply an existing domain check.
- `commit({ closeAfter: false })` acquires access, calls the domain `save` callback, and completes only on success.
- `complete()` ends active editing, captures the committed baseline, and queues safe release through persistence.
- `transition(operation)` resolves the section's draft before invoking navigation. The window-wide `transitionEditor(operation)` also resolves a different editor.
- `restore(baseline)` on the registration restores a discarded draft without undoing earlier commits.

`registerObjectForm(config)` adapts known object-bound forms to the same baseline and
completion contract. Its capture excludes credentials, hidden fields, and file inputs.
New code supplies domain `capture`/`restore` callbacks where controls alone cannot
represent a draft. Frozen editors keep the previous recovery rules. <!-- CHANGE -->

A frozen generation stays available for capture and copying, but
cannot acquire, hand off, save, or release a newer editing generation on close.
Its capture is a JSON snapshot taken before freezing; later rendering cannot
change that recovery data.

The shared frozen surface makes fields read-only, prevents mutation events and
Save shortcuts, and preserves selection, copying, scrolling, Close, and explicitly
marked safe section navigation. Domain guards remain necessary: disabled controls
alone cannot prevent an asynchronous callback or a close handler from submitting.
Adapters cover year planning, scheduling, planting spacing, equipment and seed inventories,
task cards and board hours, task planning, details, comments, labels, garden settings,
and bed conditions. Native labels retain their original text
node after the graph editor cancels submission. Frozen spacing overlays leave the
model-driven rebuild registry while staying mounted for review.

Frozen editors relinquish their advisory activity targets so subsequent heartbeats
cannot reclaim them. They never resume automatically. Close the frozen editor and
open a fresh editor against current data to re-enter retained work. Context changes
hide the previous author's frozen UI.

## Private retention and failure handling

`recoveryAction({ kind: 'retain', expectedUserId, shareId, lossId, reason, revision,
baseXml, xml, editorDrafts })` preserves a loss draft independently of content-save
queues. The main process binds the author and session to its watched-document
context. Preservation after access loss grants no access to another author's data.

Loss records live alongside checkpoints under the private profile's
`drafts-v3/<shareId>` directory, using distinct `<hash>.retained.json` filenames.
Their identity binds author, session, and loss ID. An identical retry is idempotent;
reusing that identity for different content fails. Checkpoint replacement and
checkpoint discard never replace or delete retained losses. Existing checkpoint
files remain readable without migration.

Structured captures include only the affected editor's domain data or object-bound
fields. Credential and unrelated dialog fields are excluded. Retained drafts appear
in Sharing → Recovery copies → Private recovery drafts for inspection and export;
they have no automatic recovery/apply action.

The alert distinguishes preservation in progress, successful private preservation,
and failure. If preservation fails, the original editor stays frozen and graph
rollback is deferred. Retry reuses the original loss identity and captured content.
Unpersisted copies remain author-scoped in memory across context switches; their
author can retry or export from Recovery when returning to the garden. They are
not durable until the write succeeds and cannot survive a process crash.

Private capture starts before waiting for an in-flight save. Reconciliation takes
a fresh graph capture after that save settles, so accepted actions leave the
rollback set. Only rejected targets are reconciled; unrelated edits remain usable.

## Validation

Regression coverage includes long idle periods, disconnected ownership, restart,
request cancellation and terminal expiry, distinct acquisition generations,
reordered status and claim replies, heartbeat races,
failed confirmation, intentional release, accepted saves, author teardown, private
retention retries, restart/author isolation, frozen close-time behavior, and the
20-second quiet boundary. The native hold-countdown fixture also exercises trusted
Chromium input, search exclusions, copying, disabled Apply, Save shortcuts, and
preserved alert rendering.
<!-- CHANGE: cover request-driven expiry alongside existing loss recovery. -->

Use the existing garden-save-performance fixture for a roughly 2 MiB document.
Its scheduling wait is reported separately from save execution. The `--badges`
diagnostic measures activity and input/paint latency without requiring a content
acceptance. A longer quiet period reduces interruptions; it does not remove the
cost of document capture, private checkpoints, or persistence after a save starts.

## Planting transaction rejection

Bed-first planting creation and generated tasks share one native transaction. A
permission rejection reports its recorded reason and preserves the scheduler entries;
a subsequent attempt recomputes creation against the live model. Native rollback
compensates generated tasks and board layout as well as the planting, removes the
failed Undo entry, and releases claims on IDs created and removed by that attempt. Task initialization
includes native lane reordering, checked through prior parent authority. It does not
confer task-movement permissions on existing objects. Reconstructing the before-state
must not restore newly inserted descendants while reversing an ancestor reorder.
<!-- CHANGE -->

Scheduler preflight checks the planting, linked tasks, affected main/linked boards,
and parent geometry explicitly. Pending local persistence alone is not an unfinished
editor conflict. Genuine conflicts identify the object and session rather than
suggesting another user must exist. <!-- CHANGE -->
