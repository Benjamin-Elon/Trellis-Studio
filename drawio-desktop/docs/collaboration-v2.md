# Object collaboration over Syncthing <!-- NEW -->

Current new projects use [protocol 3 background saving and independent activity](background-saving-v3.md). Version 2 collaboration is no longer supported; the description below records the previous implementation. Existing local diagrams and recovery data are retained without migration. <!-- CHANGE -->

Version 2 keeps the existing peer transport, approved-device keys, assets, and saved history. It does not require a hosted editing service or the coordinator to arbitrate edits. The coordinator still signs membership and approves computers. <!-- NEW -->

## Data and saving <!-- NEW -->

The `trellis-v2-<share-id>` folder contains `.trellis/collaboration-v2/genesis.json`, signed immutable records in `records/`, and hashed assets. Genesis is a complete signed diagram snapshot. Editing transfers object changes, not competing copies of the complete diagram. Each computer rebuilds its complete local `.drawio` projection; that mutable file is excluded from Syncthing. <!-- NEW -->

Transactions contain a device signature, project and session identities, a logical clock, causal predecessors, base object hashes, affected objects, claim references, and changed XML cells. Page identity is part of every cell key. Page/model structure changes use a project-wide transaction. Generated planting contents share their planting's logical lock. Reparenting, deletion, geometry, and edge changes acquire dependent objects together. <!-- NEW -->

The main process serializes journal operations. It validates device signatures, membership, saved Users policy, object bases, and dependencies before replay. Active team membership follows Users role cards and reciprocal links; archived teams do not contribute access. Missing predecessors remain pending rather than overwriting content. Invalid records are diagnosed and excluded. Equal-authority claims use logical clocks and code-point ordering of stable identifiers, independent of the computer's locale. Local timestamps provide advisory activity deadlines; peers more than five minutes ahead receive a clock diagnostic. Rejected policy proposals cannot grant authority to subsequent claims: replay repeats until the accepted policy settles, and reports an unresolved dependency cycle while retaining proposals if it cannot. <!-- NEW -->

Autosave is mandatory for v2 shared canvases and continues without connected peers. “Saved locally” means the proposal is flushed to disk; it does not promise global finality. Before publishing a local edit record, its exact full proposal is archived under the private recovery directory. Rejected edits and archives interrupted before publication survive restart and remain available through Recovery copies, together with the verified full setup backup. External/interrupted local-file changes are preserved before rebuilding a projection. A failed write does not report save success or clear the modified draft. <!-- NEW -->

## Viewing, editing, and handoff <!-- NEW -->

Open canvases use [change notifications and explicit refresh](explicit-refresh.md).
Replay and the local projection remain current; displayed objects advance through
current-window edits or explicit refresh. Private remembered objects survive
reopening. Shared history captures accepted state, including unseen changes. <!-- CHANGE -->

Selection reports viewing without acquiring a hold. Model edits and actual typing in a bound edit form request an optimistic hold. Form input renews activity without publishing unapplied values. The scheduler binds its actual target explicitly; spacing rows use their existing cell IDs. Background/viewing heartbeats do not renew editing activity. <!-- NEW -->

All required objects are acquired together or the entire action is rejected. Established holders cannot be displaced by ordinary claims. New signed claims use `holdPolicy: "request"` and remain held until normal release, access loss, session cleanup, or a requested deadline. A release request gives every authority level at most five minutes to finish; additional requests and activity cannot extend that deadline. Historical unmarked claims retain their original idle expiry so replay cannot resurrect abandoned holds or change accepted history. Presence expiry and clock-skew checks remain independent. Older builds are not supported for collaboration with request-driven claims. <!-- CHANGE -->

The year planner acquires the garden cell's hold on its first edit, covering every year stored on that garden. Viewing does not acquire a hold; selection and year changes do not release the active planner's hold. Planting scheduler and spacing editors use the existing planting-group targets. Closed windows/users release their captured session generations; reopening clears abandoned sessions belonging to this computer while preserving other active windows and remote sessions. <!-- NEW -->

A release request opens a persistent non-modal countdown above active editors, without stealing typing focus. Its module-style move handle supports dragging, keyboard movement, cancellation and viewport clamping. One popup lists the window's requested claims and requesters. Countdown values use the recorded deadline, so delayed delivery can leave less than five minutes. **Save & release** invokes the affected editor's existing Save/Apply operation, waits for the diagram save, and then releases the hold. Failed saves leave the timer running and show the error. <!-- NEW -->

When a hold ends, the renderer preserves the diagram proposal before reverting affected unsaved native actions and their dependencies to the saved local baseline. Independent local work remains, and unreviewed peer content is not applied. Save retries the remaining local draft; accepted in-flight saves settle before background rollback. Failed recovery or rollback leaves the draft modified and reports an error. Discarded undo entries and delayed editor callbacks cannot reintroduce the proposal. <!-- NEW -->

`Trellis.sharing.registerEditor({kind, targets, capture, save, discard})` registers planting or year-planner editors and returns `acquire`, `touch`, `active` and `dispose`. Only these domain editors add unapplied state to private versioned `.drawio.editors.json` recovery companions. The collaboration actions `recover-holds` and `recovery-data` respectively recover/rebuild a local draft and read an indexed companion. Recovery copies expose editor data as inert text with JSON export; opening a copy never publishes it. Individual-field merging and new reconciliation workflows are deferred. <!-- NEW -->

Waiting requests are ordered admin, relevant owner, content manager, then other authorized editor, with deterministic request order for ties. The next requester receives a thirty-second opportunity to begin. The previous editor cannot immediately reacquire through selection or delayed events. Once this window expires, ordinary acquisition resumes. Concurrent claims use authority and consistent causal ordering; losing proposals and stale generations are rejected and recovered. <!-- NEW -->

Badges and the overview distinguish reported viewing/editing, requested release, and working locally. Badges open on hover/focus and pin on click. Hidden, removed, offscreen, and other-page objects remain discoverable through the overview list. The dialog uses the shared Trellis semantic buttons and protects typing from graph shortcuts. <!-- NEW -->

## Protocol compatibility <!-- CHANGE -->

New projects use protocol 3 with [independent activity and background saving](background-saving-v3.md). Version 1 and 2 collaboration is unsupported. Recognized old registrations, including entries without a protocol version, are hidden from Garden Projects while existing files remain accessible through ordinary file opening. Old folders are excluded from transport before current synchronization is enabled. Old invitations and replies remain unsupported; there is no conversion or re-sharing workflow. Diagram XML, assets, Users/PIN settings, history, recovery copies, registration records and signed catalog records remain intact. <!-- CHANGE -->

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
