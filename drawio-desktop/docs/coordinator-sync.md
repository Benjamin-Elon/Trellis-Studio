# Coordinator synchronization replacement

## Implementation status

This is an in-progress replacement, not a release-ready sharing engine. The first
milestone implements single-coordinator saves and measures their independence from
archived edits. Peer proposal routing, incremental communities, takeover,
community backup, reconciliation, shutdown handoff, and the registration cutover
must follow only after the first performance gate passes.

The final engine will use garden protocol 4 and community protocol 2. Older
sharing engines will not run alongside it. Existing files, history, recovery data,
and old synchronized records must remain available for explicit re-sharing.

## Current-state persistence

`trellis-current-state.js` persists immutable signed decisions under
`.trellis/collaboration-v4/epochs/<epoch>/<sequence>.json`. Each decision retains
the author's signed proposal, the predecessor hash, and the resulting content
hash. A signed device head names the accepted position and checkpoint. Head
publication follows durable decision storage; an interrupted head publication is
recovered from the exact next decision, without enumerating the epoch directory.

The store retains current accepted XML, active collaboration state, and current
object attribution. Its resident metadata does not retain every past edit. Normal
reads verify the small signed head and apply only newly accepted decisions.
Checkpoints cover at most 30 decision records and are also available explicitly
for handoff. Failure to write a required checkpoint blocks further acceptance.

A save acquires its transient holds, validates the transaction, and releases those
holds in one signed decision. Existing waiters and their handoff deadline survive
claim renewal. Repeated initialization cannot reset an accepted head. Pending
proposal snapshots remain indexed through acceptance and local save completion;
successful saves remove only their own staging copy. <!-- CHANGE -->

Remembered views retain per-object ordering only while outstanding refresh
acknowledgements need it. A completed ordering floor replaces lifetime deletion
tombstones, while delayed acknowledgements still cannot resurrect newer deletions
or regress independently updated objects. <!-- CHANGE -->

Restart and lagging-replica recovery verify the checkpoint and apply its bounded
tail. There is no fallback that replays the complete collaboration journal.
Checkpoint-covered archives may be unavailable without preventing normal saves
or checkpoint-based restart. Archives are retained; this does not authorize their
automatic deletion.

The collaboration adapter preserves explicit refresh, remembered views, recovery
copies, dependency-complete transactions, and existing permission/domain checks.
Snapshots returned to callers do not expose mutable resident evidence.

## Narrative history

Narrative history remains separate from live collaboration. Transactional SQLite
aggregates make routine history statistics independent of revision count.
Publication checks revision identities through indexed lookups and does not list
the timeline. Current issuer heads support background maintenance; explicit
archive browsing is separate. Recent renderer history summaries are bounded.

The history panel browses 100 revisions at a time through indexed metadata-only
queries. Newer/Older controls retain access to earlier revisions and prior sharing
generations. Recording updates the recent page only; an older browsed page remains
stable while new work is saved. <!-- CHANGE -->

Reset verification remains bound to the current trusted coordinator key. Pending
history deltas retry their missing dependencies. Earlier shared generations stay
locally readable after re-sharing; publication enforces the active generation.
Legacy SQLite history tables are retained without conversion. <!-- CHANGE -->

History export reuses a verified current/published XML base while its stored
payload and content hashes match. Explicit historical reads continue to validate
their reconstruction dependencies. Destructive shared-history pruning is an
explicit maintenance operation, not part of ordinary save publication.

Leaving Storage details open does not refresh archive disk accounting on saves.
The last explicitly inspected totals stay visible until another inspection.
Qualification leaves that section open and exposes the real disk-accounting API,
so an accidental indirect scan fails the filesystem audit. <!-- CHANGE -->

## Performance qualification

Run from `drawio-desktop`:

```text
node scripts/benchmark-coordinator-saves.cjs
```

The runner freezes its sources, verifies their manifest, and runs three serial
campaigns at 0, 100, 1,000, and 10,000 archived signed content edits. Every workload
has 30 measurements for manual save, autosave execution, overlapping save requests,
unchanged save, unchanged refresh, save plus checkpoint, and invitation preparation. The diagram and
edit shape remain fixed. Autosave debounce is excluded; production native save
functions, the production sharing service, the history plugin, real SQLite recording, and signed history export
are included. Live transport and full application startup are separate acceptance
checks.

Autosave samples wait through the unchanged five-second quiet interval before
calling the native automatic-save readiness hook. Reports retain that scheduling
duration separately, and renderer telemetry must confirm an automatic execution
for every sample. An explicit Save labelled as autosave cannot qualify. <!-- CHANGE -->

Execution timing includes history publication and UI frame completion. Hidden
Electron fixtures use offscreen rendering at 60 Hz, avoiding the two-second frame
delay produced by Chromium's hidden-window throttle. <!-- CHANGE -->

The benchmark asserts that coordinator saving actually ran, so a native local-save
fallback cannot qualify. All seven p95 results must meet five seconds. Read timing
events must show zero historical arbitration replays and zero archived
collaboration records read. The runner also makes checkpoint-covered archives
unavailable and independently audits filesystem calls. The SQLite timeline contains
the same historical content-edit count. Resident memory and validation, durable
acceptance, checkpoint, history, and renderer completion timings are reported. <!-- CHANGE -->

A failed or incomplete workload leaves the gate closed. Partial diagnostics,
single samples, and passing only one history size are not qualification. Reports
and source manifests are retained under `.test-artifacts/coordinator-sync`.

The first frozen qualification (`qualification-1793301210126`) stopped at the third
100-edit workload: overlapping saves measured 5,106.5 ms p95. Nine prior workloads
passed. This run does **not** open the gate. Subsequent atomic-save and harness
changes require a complete new qualification. <!-- CHANGE -->

The following candidate (`qualification-1793324285866`) was stopped during its
first workload to fix the remembered-view tombstone growth found by structural
review. Its partial passing timings do not qualify the gate. <!-- CHANGE -->

`qualification-1793324632718` was also stopped: its autosave-labelled samples used
the explicit save path. The corrected harness requires the automatic branch and
separate scheduling measurements. <!-- CHANGE -->

`qualification-1793325353042` was stopped to close the indirect archive-accounting
path triggered by an open Storage details panel. The next source snapshot includes
both the correction and a regression guard for that condition. <!-- CHANGE -->

## Remaining acceptance boundaries

Future work must preserve the agreed coordinator preference order: admin,
access-scope owner, gardener, then an opted-in community backup. Community backup
follows the trusted community coordinator role without granting human editing
permissions. Automatic takeover permits exceptional divergent branches; it does
not promise global finality during partitions.

Unavailable scopes become read-only while retaining existing work. Graceful Quit
must attempt handoff first, then offer **Quit anyway** or **Keep running in the
background** when handoff cannot complete. Closing editor windows alone retains
existing tray coordination.
