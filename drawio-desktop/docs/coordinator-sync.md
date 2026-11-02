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

The shared browser/main contract is `js/trellis-sync-contract.js`: garden 4,
community 2, namespaces, and production capabilities. Peer proposal delivery,
communities, takeover, backup and temporary handoff remain unavailable until
milestone-one qualification succeeds. Old community journals are retained but
never processed by ordinary protocol 4 polling. <!-- CHANGE -->

Authorized coordinators are trusted checkpoint attestors, including future owner,
gardener and opted-in community backup coordinators. Checkpoint loading verifies
the externally pinned signer, authorized epoch, covered position, current object
versions, attribution, holds, membership and structural consistency. It does not
independently reconstruct checkpoint-covered authorizations. A compromised
coordinator can therefore attest invalid state; signatures establish integrity
and provenance, not coordinator honesty. <!-- CHANGE -->

Current-state persistence serializes public core operations. Signed exact-ID
receipts bind the immutable proposal payload to its accepted position. Interrupted
decision/receipt/head publication repairs the exact next decision before returning
an acceptance. Repeating an ID with the same request returns the original result;
different content is rejected. The production save adapter and renderer preserve
logical submission IDs across retries; a later edit cannot cause an old accepted
request to be reapplied. Receipt lookups never enumerate the accepted archive.
<!-- CHANGE -->

Each device also persists a private signed accepted-position high-water mark.
Restart rejects an older or divergent signed head without replacing the local
projection. All public store/core state operations are serialized; diagnostic
snapshots are copied. Legacy permanent coordinator departure is disabled until
the replacement handoff/epoch controller can establish a usable successor.
<!-- CHANGE -->

Administrative, device-approval and invitation checks read through the serialized
accepted-state owner. An edited or missing local projection cannot grant authority
or replace accepted policy. Retained membership-request processing is inactive
while peer proposals are unavailable; ordinary polling does not scan that journal.
Production boundary tests cover forged projection permissions, missing projections
and inactive request polling. <!-- CHANGE -->

Immutable publication flushes a unique temporary file and atomically links it to
the final name without replacement. An interrupted temporary write cannot occupy
an accepted record ID. Identical records are idempotent and conflicts are retained.
The sharing filesystem must support hard links; publication fails without changing
an existing record when that operation is unavailable. Ordinary local-file editing
is unaffected. Tests inject partial writes, publication failures and competing
writers, and verify production receipt recovery accepts the save only once.
<!-- CHANGE -->

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
campaigns for both protocols 4 and 5 at 0 and 10,000 archived signed content edits (12 workloads). Every workload <!-- CHANGE -->
has 30 measurements for manual save, autosave execution, overlapping save requests,
unchanged save, unchanged refresh, save plus checkpoint, and invitation preparation. The diagram and
edit shape remain fixed. Autosave debounce is excluded; production native save
functions, the production sharing service, the history plugin, real SQLite recording, and signed history export
are included. Live transport and full application startup are separate acceptance
checks.

The default coordinator run uses split autosave timing: sample 0 waits at least 20 real seconds; the other 29 advance only the background controller's injected quiet clock by 20 seconds after each edit. Execution, publication, rendering, heartbeats, and recovery timers remain real. Every sample must reset and expire the countdown and execute the production automatic branch. The versioned records distinguish actual wall waits from injected advances and require zero advances during execution. These preparations are excluded from the five-second execution p95. <!-- CHANGE -->

Use `--autosave-timing=real` for 30 real waits per workload. Standalone native fixtures default to real timing. The fixture explicitly invokes the automatic-save path after preparation; it does not certify that the native editor timer initiates the save. Strict legacy all-real evidence remains supported. <!-- NEW -->

Run `node scripts/benchmark-coordinator-saves.cjs --pilot` for four serial workloads: protocols 4/5 at 0/10,000 edits, one repetition, 30 samples for each of the seven operations. A passing pilot exits zero but records `pilot: true`, `accepted: false`, and no qualified runs. Pilots cannot qualify or supply resume evidence. Full runs require three repetitions; `--resume <summary.json>` requires matching sources and timing policy and independently revalidates reused raw samples. Pilot/resume combinations are rejected. <!-- NEW -->

Split timing projects a reduction from 120 to 4 minutes of mandatory waiting for a full matrix, or 80 seconds for the four-workload pilot. Setup and execution add time. Accelerated samples exercise fewer real heartbeat/recovery cycles; focused cadence and quiet-period regressions remain required. No all-real comparison or performance-equivalence claim is implied by the pilot. <!-- NEW -->

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

The independent verifier checks raw samples, automatic execution and UI completion
counts, archive audits, all twelve campaign/history-size combinations, and exact
frozen/current runtime source inventories and hashes. Run
`npm run test:coordinator-qualification -- <qualification-directory>/summary.json`
before advancing implementation. Summary flags alone cannot open the gate. Machine
suspension invalidates a controlled workload. <!-- CHANGE -->

## Repair requirement evidence

| Guarantee | Owning boundary | Current evidence/status |
| --- | --- | --- |
| Consistent garden 4/community 2 wire contract | Shared sync contract, library, invitation parser, renderer | Production library/join regression tests; old invitations rejected. |
| One accepted state owner and immutable public replies | Current-state core and collaboration store | Concurrent operations, mutable replies, and remembered-view tests pass. |
| Projection edits cannot grant administrative or invitation authority | Sharing service accepted-state reads | Forged admin/invitation metadata is rejected; valid accepted authority works with a missing projection. |
| A partial write cannot occupy an immutable accepted-record ID | Production immutable publication | Partial temporary writes, failed publication, competing writers and exact-once production receipt recovery pass. |
| Retry cannot apply an accepted edit twice | Exact-ID durable receipts and save intent IDs | Restart, payload collision, later-content retry, receipt/head/position interruption tests pass. |
| Trusted checkpoints cannot authorize their own signer or roll state back | Pinned coordinator/epoch verification and private accepted position | Malformed snapshots, wrong epoch, corrupt bytes, and restart rollback tests pass. |
| Current object metadata does not grow with lifetime deletions | Current attribution/object versions and remembered views | Delete-only acceptance and delayed refresh acknowledgement tests pass. |
| Domain permissions survive engine replacement | Current transaction validator | Permission and reference tests now exercise incremental acceptance; invitation activity expires without requiring a content change. |
| Old community replay cannot enter routine v4 processing | Community capability and transport refresh guards | Inactive listing/refresh tests reject transport or journal access. |
| Ordinary save cost is independent of historical content edits | Production save/history/UI qualification | Gate remains closed pending a complete passing frozen campaign. |
| Peer saving, incremental communities, archive browsing | Milestone two | Not implemented; production capability remains unavailable. |
| Selection, backup, takeover, reconciliation and temporary handoff | Milestone three | Not implemented; legacy coordinator departure is disabled. |
| Reviewed explicit re-sharing, final replay removal, release acceptance | Milestone four | Incomplete; local files, history, recovery and old records remain retained. |

The focused repair run currently reports 234 passed tests, one existing skip and
zero failures in `milestone-one-regressions-final.log`, including three publication
regressions. Three additional production service regressions pass in
`authority-boundary-regressions.log`.
Electron smoke samples
exercise 0 and 10,000 archived content edits; they are diagnostics, not performance
qualification. No milestone-two or milestone-three implementation is authorized by
partial timings. <!-- CHANGE -->

Unaccepted saves retain their original signed proposal under private
`pending-proposals/<share>/<proposal>.json`; the draft index retains its proposal
ID. Acceptance records carry a separate coordinator `acceptedAt` value for
time-sensitive validation while retaining the original signed author timestamp
for attribution. Pending intent is removed only after acceptance and local
projection/view completion. Interrupted preparation, decision, receipt, head and
private-position persistence are covered by restart tests. A reopened window may
resume the same immutable request under its original signed session; changing the
authenticated user or request contents still fails. <!-- CHANGE -->

`qualification-1793393535317` passed its first complete workload (0 archived content
edits) and began the 100-edit workload. It was stopped because other workspace work
changed runtime files after the source snapshot. Its partial results do not open
the gate. The runner now compares both the frozen manifest and current runtime
inventory/hashes between workloads, stopping as soon as source drift invalidates
the candidate. A fresh campaign is required once runtime edits are stable.
<!-- CHANGE -->

`qualification-1793394615789` was stopped during its first workload at the user's
request to leave concurrent runtime work running and qualify after it finishes.
Its 30 manual-save samples measured 5,612.2 ms p95, exceeding the target; the
remaining operations and campaigns are incomplete. Recorded collaboration reads
reported zero replays and historical records read, but the slow saves still need
diagnosis against stable sources. Concurrent work is not an established cause.
Qualification is deferred until that work finishes; no later milestone is opened.
<!-- CHANGE -->

Runtime sources subsequently remained unchanged for over six hours, allowing a
fresh campaign, `qualification-1793418483826`. Manual saves measured 2,314.8 ms p95
and autosaves 1,658.4 ms p95, but review found the projection-authority and immutable
publication gaps described above. The campaign was stopped to repair them. Its
partial timings do not qualify the changed sources; a complete fresh campaign is
still required. <!-- CHANGE -->

`qualification-1793419108001` includes both repairs. Its 0- and 100-edit workloads
passed completely. All operations at 1,000 edits also met the timing and archive
requirements, but another task changed `src/main/electron.js` during that workload.
The source guard correctly rejected the candidate and stopped before 10,000 edits.
The three workloads' highest operation p95 was 2,912.3 ms; none of this partial
campaign opens the gate. Per the user's instruction, leave other work running and
defer another campaign until those runtime edits finish. <!-- CHANGE -->

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
