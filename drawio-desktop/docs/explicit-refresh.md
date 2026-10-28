# Change notifications and explicit refresh <!-- NEW -->

Shared canvases receive and verify signed records in the background. Accepted
records rebuild the local `.drawio` projection without replacing open canvas
objects. Current-window edits and generated local updates remain immediate.
Other sessions, including another window belonging to the same user, appear as
pending differences. Permissions, holds, release requests and rejection notices
remain current independently of displayed content. <!-- NEW -->

## State and save boundaries <!-- NEW -->

The journal remains authoritative. `trellis-object-views.js` keeps each window's
represented objects separately from the accepted project. The renderer retains
its saved object base and unsaved edits. Autosave submits only that difference;
its response does not apply accepted objects to the canvas. Saving displayed
`A2/B0` after a peer's `B1` produces shared `A2/B1`, while this window continues
displaying `A2/B0`. <!-- NEW -->

Private checkpoints live in the transport profile's `object-views` directory,
outside synchronized folders. Stable diagram identity and profile-local user
identity select complete remembered object XML and page structure. Writes share
the main-process collaboration queue. Save/refresh merges only affected objects.
Private per-object acknowledgement stamps prevent an older outstanding receipt
from regressing a newer remembered object; they are not shared revision counters.
Other open windows keep their represented versions. Reopening reconstructs
remembered objects and derives pending differences against accepted state. <!-- NEW -->

First use initializes from the available verified document. Corrupt checkpoints,
or missing checkpoints with an initialization marker, block editing and offer
**Extras → Recover Remembered View → Open latest accepted objects**. Removing the
entire private profile also removes evidence of initialization and is
indistinguishable from a new device. Private checkpoints have no browsable
timeline. <!-- NEW -->

## Review and refresh <!-- NEW -->

The canvas Changes control lists additions, hidden objects, other pages and
structural changes. Visible cells receive badges; existing module clusters receive
distinct pending-object counts. Reviews open on hover/focus and pin on click, with
authors, object navigation and collapsible before/after fields. Stationary badges
retain DOM and keyboard focus. Overlays use the existing manipulation-suppression
controller. Exact content reversals clear pending differences. <!-- NEW -->

Groups reuse signed transaction boundaries, planting locks and existing parent,
edge and link dependencies. Page/model changes require a visibly broader
project-structure group. Stale groups cannot be edited; unaffected objects remain
editable. Active forms and unsaved work block their groups. Refresh All skips
blocked groups without splitting them. Refresh neither claims objects nor
publishes edits. Established-holder arbitration is unchanged. <!-- NEW -->

The scoped collaboration bridge adds private view operations: <!-- NEW -->

| Operation | Result |
| --- | --- |
| `open-view` | Remembered XML and pending summaries |
| `changes` | Summaries without object payloads |
| `review` | Groups, changed fields and validation token |
| `prepare-refresh` | Revalidated groups, expected bases, narrow payloads and a window-bound receipt |
| `ack-refresh` | Durable remembered-object update and remaining summaries |
| `reset-view` | Explicit recovery to accepted objects |
| `history-state` | Accepted shared XML for history |

Changed reviews or dependencies require another click. Refresh uses native
non-undoable page/cell patches and explicit inverse patches on application or
checkpoint failure. Affected targets freeze until completion. Unrelated edits,
selection, viewport and personal folds remain. Notifications clear after durable
acknowledgement. Autosaves queued during application wait for acknowledgement or
rollback, so incoming patches cannot become local proposals. Typing elsewhere
remains dirty and saves afterward. Document switches invalidate late replies.
Interrupted refreshes reopen the previous remembered objects. Receipts expire
after 60 seconds and cannot cross windows. <!-- NEW -->

Native Synchronize and force Reload enter the same review rather than merging the
projection. Same-user permission revalidation does not reset the view. An actual
user switch preserves unsaved diagram work in Recovery copies before loading the
next user's remembered objects; queued saves cannot submit as that next user.
Durable acknowledgements support retry after a lost bridge reply. Native tests
also inject a failure after a patch has partially applied and check restoration
of its actual preimages. <!-- NEW -->

Lost/rejected holds cancel affected dialogs and explicitly discard unapplied
entries, including private comment drafts. Submitted proposals retain existing
recovery copies. Intentional release does not produce a hold-loss notice. A rename
follows the originating window's freshness and remembered-object boundary; other
windows receive it as pending. <!-- NEW -->

## Folding and history <!-- NEW -->

`trellis-local-view.js` stores preferences in device-local browser storage per
document, page, user and cell, including local-only diagrams. Native folding can
swap alternate bounds, resize parent stacks and move siblings. The adapter retains
authored geometry, strips fold-generated edits before dirty/undo/history listeners
run and exposes authored geometry during document encoding. Deliberate geometry
edits still persist, including undo/redo. Refresh/restore replace authored bases
and reapply personal folding. The two-expanded-clusters policy stays in force.
Existing signed object hashes and journal records remain unchanged. <!-- NEW -->

Shared history captures accepted state through `history-state`, including unseen
objects. Mixed displayed views are never published as shared snapshots. Restores
remain explicit authorized edits subject to freshness and holds; other windows
receive their results as pending changes. <!-- NEW -->

## Validation and measurements <!-- NEW -->

```powershell
node --test test/trellis-object-views.test.mjs test/trellis-collaboration.test.mjs test/trellis-local-view.test.cjs test/trellis-syncthing-renderer.test.cjs test/trellis-explicit-refresh-electron.test.cjs test/created-change-map-history.test.cjs
node scripts/benchmark-explicit-refresh.mjs
# ELECTRON_RUN_AS_NODE must be unset; all profiles/documents are disposable.
node_modules/electron/dist/electron.exe test/helpers/explicit-refresh-electron.cjs --benchmark
```

Artifacts in `.test-artifacts/explicit-refresh` include the review capture,
small native timings, signed-journal benchmark and optional 2,000-object Chromium
benchmark with bursts of 100 and 1,000 changes. Timings separate peer saves,
verification/replay, projection writes, summaries, preparation, native patches
and acknowledgement. Memory and work counts are recorded separately.
`notificationMs` measures summary derivation after a verified read;
`notificationPollMs` includes that read. Neither establishes an end-to-end
speedup against the legacy path. Decode-free notification discovery also has a
renderer regression test. <!-- NEW -->

`window.__trellisLiveUpdatesForBenchmark = true` enables the internal legacy
comparison before plugin load. It is not a saved preference. Explicit refresh is
normal behavior. Hosts can provide `onCollaborationTiming`; the renderer accepts
`window.TrellisSyncTiming`. <!-- NEW -->

Observed Windows development run on a 2,000-object native canvas (single samples,
October 24, 2026): <!-- NEW -->

| Changed objects | Native application | Full explicit refresh | Renderer resident memory |
| --- | ---: | ---: | ---: |
| 100 | 0.93 s | 16.00 s | 235 MiB |
| 1,000 | 1.61 s | 26.76 s | 282 MiB |

Full refresh includes queueing, fresh journal validation, preparation, native
application and durable acknowledgement. These observed waits are a material
limitation. The native report's notification time is the wait after the peer save;
automatic polling can already have discovered those changes. Use the separate
main-process poll timings to examine discovery work rather than interpreting that
wait as isolated processing cost. Summaries for 100/1,000 changed objects were
about 14/138 kB versus a roughly 319 kB XML document in the signed-journal run.
Reduced payloads and decode-free discovery do not demonstrate lower total latency.
<!-- NEW -->

Journal replay, projection saving and private checkpoint serialization still
scale with document size. Reviews and dependency groups can become large; genuine
structural changes may require the whole project. The provisional 80% target is
not a release requirement or demonstrated result. Packaged desktop, separate-device
relay workloads, screen-reader review, platform storage failures and long-lived
journals still require release acceptance. <!-- NEW -->
