# Shared permission policy <!-- NEW -->

Users and collaboration replay share `js/trellis-permission-core.js`. The core accepts plain immutable snapshots, an actor ID and an explicit evaluation time. It performs no graph mutation, XML parsing, session lookup, storage access or clock reads. Browser and XML adapters own those responsibilities. <!-- NEW -->

## Interfaces and authority <!-- NEW -->

- `snapshot({store, cells, memberships?, provisionalUsers?})` copies and freezes its inputs. Cells have page-qualified keys, parent keys, attributes and structural facts. Membership is calculated once from active role cards and active teams unless supplied by the trusted accepted-policy adapter. <!-- NEW -->
- `authorize(snapshot, actor, action, key, at)` returns `{allowed, reason}` for an existing Users action. `effectiveCapabilities` exposes the same ownership, preset and inheritance rules. Unknown actions and malformed policy fail closed. <!-- NEW -->
- `authorizePendingCreation(before, after, actor, action, key, at, options)` handles native preflight for objects absent from both prior content and accepted policy. It validates their actual pending creation chain against prior parent authority. Proposed ownership or grants cannot provide that authority; final whole-transaction and publication checks still apply. Graph adapters reconstruct the prior tree, including descendants inserted as one cloned subtree. A standalone graph's first page wrapper preserves logical object identity. <!-- NEW -->
- `validateTransition(before, after, actor, at, options)` validates every actual effect using prior authority. Its optional domain validators handle comments and independently validated reference fields. A proposed grant cannot authorize another effect in its own transaction. <!-- NEW -->
- `authority(snapshot, actor, key, at)` provides coordination priority only. A positive rank does not authorize a content change. <!-- NEW -->

The sharing adapter exposes the existing unsaved native edit list to this reconstruction. A creation can span subsequent commands before its first save completes; guards validate the combined actual proposal against accepted prior policy. Published, undone and rejected edits cease providing pending-creation facts. Revocation still applies immediately, including to unpublished objects. <!-- NEW -->

Shared windows read accepted policy independently of their represented content. Freshness, activity reservations, graph locking and document availability remain operational checks outside the core. Existing Users methods compose these checks without changing their public interfaces. Activity uses the latest verified snapshot without reading XML or awaiting journal replay on its fast path. <!-- NEW -->

Team grants apply through current active membership. Stored `derived` per-user grant copies remain available to existing consumers but never independently grant permissions. Archived teams and inactive roles cannot retain access through stale copies. <!-- NEW -->

## Validation and commands <!-- NEW -->

Native transactions, local publication, journal replay, conflict-resolution submissions and history restores use the shared policy. Validation checks the actual combined changes to ownership, access, content and structure. Internal-change flags do not exempt a transaction. Narrow generated planting presentation, role synchronization and roadmap navigation effects require their corresponding authorized source operation. Generated presentation cannot change endpoints, model types or hidden XML payloads. <!-- NEW -->

Permission-related setters clone XML before writing through the existing model transaction. This preserves genuine prior values for validation and undo. Invitation acceptance captures its proven actor and combines account and generated-role changes in one transaction. The existing authentication and invitation-delivery workflows remain in place. <!-- NEW -->

Invitation listing accepts an optional evaluation time and derives expiry without writing; filtering and projection use the same captured time. Persistent expiry and grant cleanup occur only during an authorized invitation command. Queries cannot cause permission changes or journal records. <!-- NEW -->

The comment validator is shared with Extra Info. Native commands enforce recent command timestamps; durable publication allows older authored timestamps because offline or continuous editing can delay saving. Future timestamps, impersonation, forbidden rewrites and retention violations remain rejected. Reference approval remains a separate mandatory domain validation, including for administrators. <!-- NEW -->

A save containing an unauthorized effect returns `PERMISSION_DENIED`, retains the complete proposal in private recovery and publishes no authorized subset. This check precedes independent conflict-group selection. Existing conflict review, activity coordination and private checkpoint queues remain separate. <!-- NEW -->

This development change updates protocol 3 semantics in place. Existing development journals are disposable, all collaborating builds must be updated, and no history migration or mixed-build compatibility is provided. <!-- NEW -->

## Verification <!-- NEW -->

`trellis-permissions.test.mjs` shares fixtures between browser and main cores and exercises real replay. It covers user categories, ownership, task sources, inactive teams, stale derived grants, bundled changes, model-only attributes, nested XML values, scope boundaries, last-admin protection, comment restrictions on existing and newly created objects, delayed saves, generated children and input immutability. <!-- NEW -->

The native permission fixture uses production Graph and Users code with a signed collaboration store. It verifies native rejection, internal-flag rejection, permitted saves, forged-publication rejection, recovery retention, conflict-resolution rejection and permission revocation while the displayed XML remains stale. Existing real-model tests cover invitation-generated roles and coordinator role creation, archival and restoration. <!-- NEW -->

Run focused checks with `node --test test/trellis-permissions.test.mjs test/trellis-permissions-electron.test.cjs test/trellis-users.test.cjs test/trellis-collaboration.test.mjs`. Activity/background-saving tests separately verify that stalled replay cannot postpone status or private recovery. <!-- NEW -->
