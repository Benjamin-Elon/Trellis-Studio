# Revision history v2

Trellis records the complete diagram, including all pages, after edits settle for
2.5 seconds. The history service owns the single main-process connection to
`trellis_database/Trellis_history.sqlite`. Diagram files, assets, reference
databases, collaboration journals and recovery copies are separate resources.

Shared canvases record accepted project state even while displayed objects remain
stale. [Explicit refresh](explicit-refresh.md) updates private remembered objects
without an editing undo or shared edit. Folding is personal view state. History
restores remain authorized shared edits with freshness and hold checks; other
windows receive pending changes. <!-- CHANGE -->

## Records and reconstruction

`trellis-history-codec.js` indexes persisted objects through the collaboration
protocol's existing `objects()` function. The history codec includes complete
object wrappers, document/page attributes and explicit page/object ordering.
It does not replay editor commands or execute historical plugin logic.

Every record has format version 2, a document identity, history generation,
revision metadata, a compressed payload, and a SHA-256 content hash. `base_id`
identifies the reconstruction dependency. `parentRevisionId` describes narrative
ancestry and is not used for reconstruction. Native object IDs are scoped by
page ID; the document identity is independent of the selected page.

Full snapshots start each history and are used for named checkpoints and
restores. Ordinary revisions use deltas when smaller than a full snapshot.
A full snapshot is also required after 30 consecutive deltas, or when cumulative
compressed deltas would reach the latest full snapshot's compressed size.
Candidate deltas must reconstruct the exact normalized target and its SHA-256
hash before storage; otherwise the codec uses an independent full snapshot.

Normalization removes serializer-only file attributes (`modified`, `agent`,
`etag`, `host`, `version`), viewport offsets (`dx`, `dy`), attribute-order
differences and insignificant formatting whitespace. It preserves document
content and order, including Trellis metadata on object wrappers.

All reads use the same bounded reconstruction function. Corruption, unsupported
versions, missing dependencies, cross-document references and cycles fail before
the live diagram is replaced. Pending shared dependencies remain visible but
cannot be selected for restore. A restore first durably captures current work,
then loads the whole document, clears native undo, marks the file modified and
emits the existing before/after restore events. Shared restores use the existing
claim/save authorization path. External database records and separate asset
contents are not rolled back.

## Automatic upgrade and physical cleanup

The first valid open-document initialization stores and verifies a v2 baseline
before dropping the legacy `history_events` and `history_snapshots` tables.
This deletes **all** legacy revisions, including named checkpoints and restore
records, across the installation. No archive is kept. Unopened documents remain
untouched and start a fresh history when opened. Existing v2 rows survive
restarts and interrupted migration. Legacy tables recreated by downgraded
software are removed again without deleting v2 rows.

Migration and compaction have persistent completion markers. SQLite is
checkpointed and vacuumed to return unused pages to disk; failures leave valid
history intact and show disk reclamation as pending. Ordinary local retention
batches physical compaction rather than vacuuming the database after each edit.
The scoped renderer bridge exposes fixed history operations, not database SQL.
Queued requests are rechecked against their document context after switches.

## Sharing and retention

The coordinator publishes a signed `.trellis/history-v2/reset.json` containing
the new generation and independently verified full baseline. Only then may
legacy `.trellis/history` exports and their corresponding legacy version
archives be removed. The reset does not modify collaboration genesis, signed
collaboration records, membership, assets or recovery files. Registered unopened
projects receive reset maintenance when the coordinator next processes them.

Upgraded peers ignore the old history channel and reject prior generations.
New-format local revisions recorded while waiting for the shared reset are
retained locally under the adopted generation; they are not published by reset.
The versioned directory contains signed revision records. Publication is tied
to the saved whole-document hash. Shared deltas use a published reconstruction
base, never a private unsaved intermediate. Missing published bases cause a full
snapshot instead. Imports verify approved-device signatures and make dependent
revisions restorable only after their prerequisites arrive.

The logical budget is **500 MiB per document**, including compressed payloads
and stored event metadata. The initial baseline, latest 100 revisions, named
checkpoints and restores are protected. Other categories may be pruned oldest
first. Protected revisions can exceed the soft budget; that is shown explicitly.
Retained dependents are promoted to full anchors before their bases are deleted.

Shared pruning is coordinator-owned. It publishes immutable full anchors for
retained published dependency boundaries, followed by a signed cumulative
pruning manifest, before deleting exported revisions. Private anchors remain
local. Peers honor the newest verified manifest and local tombstones, so delayed
records cannot resurrect retired history. A peer's private retained branches
are anchored locally before a shared base is removed.

## Size display

The button immediately after the user menu displays `Diagram … · History …`.
It opens History and uses shorter visible labels on narrow windows while
retaining complete accessible labels and tooltips.

- **Diagram:** actual bytes in the last saved file. Never-saved files say
  `unsaved`; unavailable measurements are not represented as zero. The tooltip
  identifies unsaved changes.
- **History:** the current document's compressed payload and event metadata
  bytes. The sidebar adds revision count, budget, compaction state, and the
  selected revision's stored bytes and full/delta type.
- **Storage details:** application-wide SQLite/WAL bytes, this project's shared
  timeline files, collaboration journal and recovery-copy bytes. These figures
  are separate measurements, not an exact per-document disk total.

## Validation

Run `node --test test/trellis-history.test.mjs
test/trellis-history-transport.test.mjs test/created-change-map-history.test.cjs`
for codec, SQLite, transport and renderer coverage. The service tests include a
50-garden / 300-bed fixture and 500 small edits, comparing payload bytes against
independently compressed full snapshots. They require exact reconstruction,
at most 30 deltas, and at least 80% payload savings. Capture, reconstruction and
purge timings are printed by the tests. Run `npm test` for the repository plugin
checks, including database, sharing and collaboration regressions.
