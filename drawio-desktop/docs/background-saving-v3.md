# Background saving and activity in protocol 3 <!-- NEW -->

New Garden Projects and duplicates use protocol 3. Invitations, registrations, the signed genesis, and the `trellis-v3-` folder boundary reject older collaboration clients. Version 2 projects are not converted: their available local diagrams, assets, and private recovery files remain available, with sharing disabled. <!-- NEW -->

## Three independent responsibilities <!-- NEW -->

Project autosave starts after twenty seconds without a committed edit or relevant editor input. Each edit or input restarts that timer; continuous editing has no forced-save deadline. Automatic hold release after label completion, selection changes or editor disposal uses the same quiet queue and keeps its hold until saving succeeds. Explicit Save and requested handoff flush pending content. An active save completes its captured revision while compatible later requests combine into one pending capture. Completed saves cannot mark later edits saved. The native status reports waiting changes during the pause and Saving only when capture is submitted. <!-- CHANGE -->

The waiting status includes seconds remaining in the editing pause, rounded upward from the save controller's clock. Edits and relevant typing refresh it immediately; the existing five-second activity heartbeat refreshes it locally without extra timers or network requests. At expiry it shows the current queue/access stage, and active composition reports waiting for editing to finish. An active capture keeps its saving progress while newer edits wait. Countdown updates preserve unrelated notices, errors and conflict controls, and stop after saving, undo to the saved baseline, or a document/author change. The countdown describes when the editing pause ends, not when persistence will finish. <!-- NEW -->

Private recovery checkpoints run every ten seconds while work is dirty, including continuous editing and registered planting/year-planner editor entries. They use the author's session-specific `drafts-v3` files outside synchronized storage, atomic replacement, and a queue independent of content replay. Failed replacement preserves the previous valid checkpoint. Closing preparation checkpoints the current draft; an explicit discard removes its checkpoint. Sharing → Recovery copies → Private recovery drafts finds retained author drafts after restart. Unapplied editor entries remain inspectable/copyable recovery data. <!-- NEW -->

Activity uses bounded, signed, replaceable snapshots under the current protocol's activity directory. Each device/window session writes only its own snapshot. Viewing, editing and pending-change metadata contain no document XML or editor values. Five-second heartbeats and filesystem notifications operate independently of content replay, history and projection writes. Monotonic receipt time marks presence stale after thirty seconds; duplicate or reordered snapshots do not refresh it. Previously stored remote presence is unconfirmed until a fresh sequence is received. Signed ownership remains effective while presence is stale and across activity-service restart. Only another authorized session's release request starts a five-minute ownership deadline; explicit release, session cleanup, access removal and concurrent arbitration remain independent ways to end ownership. See [managed editing and loss recovery](managed-editing-recovery.md) for claim generations and request cancellation. <!-- CHANGE -->

Activity reservations coordinate editors even when their presence is disconnected or unconfirmed. Durable commits still acquire signed editing claims and validate signatures, current permissions, object bases, dependency groups, invitation transitions, protected fields and references through the existing reducer. Those commit claims are released after the edit record and remain distinct from request-driven activity ownership. Status cannot authorize content, declare global finality, or retroactively revoke a completed commit. <!-- CHANGE -->

## Badge meanings <!-- NEW -->

| Badge | Meaning |
| --- | --- |
| Viewing / editing | Reported activity and a currently observed reservation |
| Changed · pending project save | Committed author edits still await project-save completion |
| Changes available | Accepted content has arrived, passed verification, and differs from the displayed view |
| Save failed / conflict | Retained work needs retry or explicit review |
| Offline · status unconfirmed | Last reported state; expired reservations do not block others |

Pending changes and accepted incoming changes can coexist. An announcement alone never enables Refresh. Undo back to the captured saved state clears the pending indicator. Syncthing delivery remains best effort; queue separation does not promise instant delivery during network failure. <!-- NEW -->

Planting groups own their descendants' collaboration status: selecting circles reports one group view, and user edits, deletion, or typing in a child-bound editor acquire the group's editing hold. One group badge aggregates reported activity and save failures; received child claims retain their original identities for release requests. Selecting another child or saving while the planting remains selected retains the hold. Leaving the planting uses the existing save-and-release lifecycle, including preservation on save failure and explicit requested handoff. Automatic layout, attribution, and personal display changes do not initiate activity holds. Other independent objects retain their badges. <!-- CHANGE -->

Plant circles remain draggable inside their owning planting, with their full circles constrained to its boundary in the planting's rotated coordinate system. Native movement and nudging cannot reparent them; drag-copy keeps the source group. Multiple selected circles share one constrained translation. A rejected or zero-distance move produces no edit or activity hold, and dragging never resizes a circle or expands its group. These movement rules do not repair existing malformed geometry or change regeneration, imports, or cut/paste behavior. <!-- CHANGE -->

During native live dragging, moving circles keep their current growth size and harvest outline while their preview offset survives growth repainting and view refreshes. Unrelated circles and growth calculations continue updating. Native release commits through the same containment and hold rules, then the latest appearance is applied; cancellation restores the original position without creating an edit. Escape, pointer cancellation, window blur, page/file replacement, and external geometry or parent changes terminate the preview. Preview coordinates and frozen artwork are transient renderer state and are never saved. <!-- CHANGE -->

## Conflict review <!-- NEW -->

Reconnection compares the author's saved base, draft and accepted objects. Independent object/dependency groups can save while conflicting groups remain private. Review local changes provides Keep accepted version, Apply my version, Apply non-conflicting edits and Resolve later. Partial application is disabled without eligible complete groups. Fields within the same object are never merged automatically. <!-- NEW -->

The review token binds the base, draft, accepted state and selected grouping. A changed draft or accepted base requires another review. Applying a local version still uses normal editing-access and commit-permission validation. Dismissed/rebased drafts retain a recovery copy. Reviewing a group updates only its represented objects; unrelated incoming content remains pending explicit refresh. <!-- NEW -->

## Validation and limits <!-- NEW -->

Tests cover controlled-clock sixty-second replay stalls, ten-second checkpoints, thirty-second presence expiry without ownership loss, request-driven handoff, signed status validation, author isolation, failed checkpoint replacement, revision coalescing, dependency-closed partial application and all four resolution choices. Native Electron and Syncthing tests distinguish local processing time from network delivery. <!-- CHANGE -->

The native content-stall fixture also completed sixty real seconds with six recovery attempts and sub-23 ms p95 badge feedback. Real Syncthing status delivery and signed resolution races are exercised separately. See [measurements and outstanding repository failures](garden-save-performance.md#protocol-3-fresh-project-and-independent-status-verification). Save execution still takes several seconds on the fresh-project diagnostic; queue separation does not remove replay and persistence costs. <!-- NEW -->

Removing forced autosaves allows continuous editing to postpone refreshable project content indefinitely. A crash can lose roughly the last checkpoint interval under normal storage conditions; disk failure can extend that interval and is reported. Expiring reservations favors continued work during partitions, so conflicts remain possible. Full-document capture/replay costs still require measurement; separating queues alone does not establish a save-time or responsiveness guarantee. <!-- NEW -->
