# Object collaboration over Syncthing <!-- NEW -->

Version 2 keeps the existing peer transport, approved-device keys, assets, and saved history. It does not require a hosted editing service or the coordinator to arbitrate edits. The coordinator still signs membership and approves computers. <!-- NEW -->

## Data and saving <!-- NEW -->

The `trellis-v2-<share-id>` folder contains `.trellis/collaboration-v2/genesis.json`, signed immutable records in `records/`, and hashed assets. Genesis is a complete signed diagram snapshot. Editing transfers object changes, not competing copies of the complete diagram. Each computer rebuilds its complete local `.drawio` projection; that mutable file is excluded from Syncthing. <!-- NEW -->

Transactions contain a device signature, project and session identities, a logical clock, causal predecessors, base object hashes, affected objects, claim references, and changed XML cells. Page identity is part of every cell key. Page/model structure changes use a project-wide transaction. Generated planting contents share their planting's logical lock. Reparenting, deletion, geometry, and edge changes acquire dependent objects together. <!-- NEW -->

The main process serializes journal operations. It validates device signatures, membership, saved Users policy, object bases, and dependencies before replay. Active team membership follows Users role cards and reciprocal links; archived teams do not contribute access. Missing predecessors remain pending rather than overwriting content. Invalid records are diagnosed and excluded. Equal-authority claims use logical clocks and code-point ordering of stable identifiers, independent of the computer's locale. Local timestamps provide advisory activity deadlines; peers more than five minutes ahead receive a clock diagnostic. Rejected policy proposals cannot grant authority to subsequent claims: replay repeats until the accepted policy settles, and reports an unresolved dependency cycle while retaining proposals if it cannot. <!-- NEW -->

Autosave is mandatory for v2 shared canvases and continues without connected peers. “Saved locally” means the proposal is flushed to disk; it does not promise global finality. Before publishing a local edit record, its exact full proposal is archived under the private recovery directory. Rejected edits and archives interrupted before publication survive restart and remain available through Recovery copies, together with the verified full setup/migration backup. External/interrupted local-file changes are preserved before rebuilding a projection. A failed write does not report save success or clear the modified draft. <!-- NEW -->

## Viewing, editing, and handoff <!-- NEW -->

Selection reports viewing without acquiring a hold. Model edits and actual typing in a bound edit form request an optimistic hold. Form input renews activity without publishing unapplied values. The scheduler binds its actual target explicitly; spacing rows use their existing cell IDs. Background/viewing heartbeats do not renew editing activity. <!-- NEW -->

All required objects are acquired together or the entire action is rejected. Established holders cannot be displaced by ordinary claims. A release request gives every authority level at most five minutes to finish; additional requests and activity cannot extend that deadline. Five minutes without editing also releases an abandoned hold. Leaving an object or closing its edit form preserves pending edits and releases its holds. <!-- NEW -->

Waiting requests are ordered admin, relevant owner, content manager, then other authorized editor, with deterministic request order for ties. The next requester receives a thirty-second opportunity to begin. The previous editor cannot immediately reacquire through selection or delayed events. Once this window expires, ordinary acquisition resumes. Concurrent claims use authority and consistent causal ordering; losing proposals and stale generations are rejected and recovered. <!-- NEW -->

Badges and the overview distinguish reported viewing/editing, requested release, and working locally. Badges open on hover/focus and pin on click. Hidden, removed, offscreen, and other-page objects remain discoverable through the overview list. The dialog uses the shared Trellis semantic buttons and protects typing from graph shortcuts. <!-- NEW -->

## Migration and compatibility <!-- NEW -->

Legacy shares continue synchronizing their diagram file until a logged-in admin chooses Enable object locking. Upgrade requires existing file conflicts to be resolved, preserves a verified recovery copy, pauses the old local share, and creates an isolated v2 share. Existing collaborators must upgrade Trellis and join the replacement invitation. Old clients cannot publish their legacy file into the v2 folder. Their previously downloaded copies are retained. Identity-library entries follow the verified local replacement while retaining their worker and display name. <!-- NEW -->

Normal sharing still grants a complete diagram and assets to approved computers. Editing grants restrict workflow, not visibility. The existing diagram-local Users/PIN system remains soft permission enforcement. <!-- NEW -->

Authorized local Users actions participate in the journal even though Users marks them internal to its own transaction guard. Synchronous roster and generated-role changes acquire their required objects together. For invitation acceptance, an approved device signs an attestation that the existing Users workflow validated the account setup; replay independently verifies the pending invitation, unchanged existing accounts, and non-admin new account before accepting its generated profile/role work. This retains Users' existing trust in approved computers rather than introducing another login or permission system. <!-- NEW -->

## Verification and operational limits <!-- NEW -->

```powershell
node --test test/trellis-collaboration.test.mjs test/trellis-collaboration-electron.test.cjs test/trellis-syncthing-renderer.test.cjs test/trellis-syncthing.test.mjs
$env:TRELLIS_SYNCTHING_RUNTIME_TEST='1'
node --test --test-name-pattern='v2 peers' test/trellis-syncthing-runtime.test.mjs
# Run the native UI fixture with ELECTRON_RUN_AS_NODE unset.
node_modules/electron/dist/electron.exe test/helpers/trellis-collaboration-electron.cjs
npm test
```

Native UI captures are generated in `.test-artifacts/collaboration/`. Tests use independent temporary profiles and never reuse the installed user's daemon or documents. <!-- NEW -->

Optimistic holds are advisory during delay/disconnection, so simultaneous editing can briefly occur and locally saved proposals can later lose arbitration. Syncthing activity updates may take seconds or longer. A grace countdown is not a globally synchronized clock. Dependent-object grouping is deliberately conservative. The journal retains history and private proposals; pruning/compaction is not part of this protocol version, so large, long-lived projects require storage and replay-cost monitoring. <!-- NEW -->
