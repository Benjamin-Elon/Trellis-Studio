# Collaboration history reuse

Membership queries use a serialized, verified collaboration snapshot. They do not
materialize the diagram or rebuild presentation metadata merely to offer project
actions. Confirmation and retirement still check current authorization, preserve
external changes, and cancel pending invitations through the existing lifecycle.

## Validity and memory

Each read continues to enumerate history files, read their contents, verify new
signatures, and validate current signer membership, record fields, causal parents,
and peer clock limits. File timestamps are not treated as proof of unchanged data.
Signature reuse retains a compact verification proof keyed by the SHA-256 digest
of the project identifiers, current signing key, and current file text. It does not
retain another full copy of every journal file. The key is recomputed from bytes
read on every operation; parsed payloads remain caller-owned.

The collaboration store retains one replaceable replay result per project in the
existing bounded main-process cache. The current allocations remain 16 MiB for
main-process evidence and 48 MiB shared by transient replay workers. Estimates are
conservative; oversized results bypass caching, and eviction only adds work.

A result can be reused only when observed bytes and relevant trust state match,
the clock has not moved backward since its last use, and the next time transition
has not been reached. Replay supplies the next hold, handoff reservation, presence,
or device-retirement boundary as internal `nextChangeAt` metadata. This metadata
is not persisted or included in renderer policy responses. Current identity and
invitation authorization checks still execute independently on every operation.

Changed histories are replayed fully in the existing worker. Late concurrent
claims can invalidate previously accepted edits, so this is not incremental replay.
Failed validation cannot return cached success. Cached results are copied before
callers or recovery diagnostics can modify them. Recovery discovery and existing
projection-preservation checks continue even when replay is reused.

## Measurement and validation

Read timing events report `replayCacheHit` and `replayCount` (zero or one), in
addition to existing verification, replay, signature-cache, and queue timings.

Run `node scripts/benchmark-explicit-refresh.mjs` from the desktop project to
compare cold snapshots, five warm snapshots, changed history, background refreshes,
and five private membership queries at the existing diagram sizes. Results are
written to `.test-artifacts/explicit-refresh/benchmark.json`. Warm cacheable reads
should perform zero additional replays before the next transition; membership
queries should perform zero materializations. Timings are development observations,
not machine-independent latency guarantees.

Regression coverage includes exact expiry boundaries, clock rollback, late claims,
deleted predecessors, same-filename content changes, signer trust and retirement,
future-dated records becoming eligible, corrupted genesis, cache isolation and
eviction, oversized entries, caller mutations, and deletion after membership changes.

Cold process starts and changed histories still cost a full replay. All reads still
cost file I/O proportional to journal size. Local validation cannot prove that an
offline device has no unseen records. There are no sharing-format migrations or
persistent checkpoints.
