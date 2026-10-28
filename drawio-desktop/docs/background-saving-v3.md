# Background saving and activity in protocol 3 <!-- NEW -->

New Garden Projects and duplicates use protocol 3. Invitations, registrations, the signed genesis, and the `trellis-v3-` folder boundary reject older collaboration clients. Version 2 projects are not converted: their available local diagrams, assets, and private recovery files remain available, with sharing disabled. <!-- NEW -->

## Three independent responsibilities <!-- NEW -->

Project autosave starts after five seconds without a committed edit. Each edit restarts that timer; continuous editing has no forced-save deadline. An active save completes its captured revision while compatible later requests combine into one pending capture. Explicit Save and editing handoff flush pending content. Completed saves cannot mark later edits saved. <!-- NEW -->

Private recovery checkpoints run every ten seconds while work is dirty, including continuous editing and registered planting/year-planner editor entries. They use the author's session-specific `drafts-v3` files outside synchronized storage, atomic replacement, and a queue independent of content replay. Failed replacement preserves the previous valid checkpoint. Closing preparation checkpoints the current draft; an explicit discard removes its checkpoint. Sharing → Recovery copies → Private recovery drafts finds retained author drafts after restart. Unapplied editor entries remain inspectable/copyable recovery data. <!-- NEW -->

Activity uses bounded, signed, replaceable snapshots under `.trellis/activity-v3`. Each device/window session writes only its own snapshot. Viewing, editing and pending-change metadata contain no document XML or editor values. Five-second heartbeats and filesystem notifications operate independently of content replay, history and projection writes. Monotonic receipt time expires reservations after thirty seconds; duplicate or reordered snapshots do not renew them. Previously stored remote status is unconfirmed until a fresh sequence is received. <!-- NEW -->

Activity reservations coordinate connected editors. Durable commits still acquire signed editing claims and validate signatures, current permissions, object bases, dependency groups, invitation transitions, protected fields and references through the existing reducer. Those commit claims are released after the edit record; their history does not make disconnected activity reservations permanent. Status cannot authorize content, declare global finality, or retroactively revoke a completed commit. <!-- NEW -->

## Badge meanings <!-- NEW -->

| Badge | Meaning |
| --- | --- |
| Viewing / editing | Reported activity and a currently observed reservation |
| Changed · pending project save | Committed author edits still await project-save completion |
| Changes available | Accepted content has arrived, passed verification, and differs from the displayed view |
| Save failed / conflict | Retained work needs retry or explicit review |
| Offline · status unconfirmed | Last reported state; expired reservations do not block others |

Pending changes and accepted incoming changes can coexist. An announcement alone never enables Refresh. Undo back to the captured saved state clears the pending indicator. Syncthing delivery remains best effort; queue separation does not promise instant delivery during network failure. <!-- NEW -->

## Conflict review <!-- NEW -->

Reconnection compares the author's saved base, draft and accepted objects. Independent object/dependency groups can save while conflicting groups remain private. Review local changes provides Keep accepted version, Apply my version, Apply non-conflicting edits and Resolve later. Partial application is disabled without eligible complete groups. Fields within the same object are never merged automatically. <!-- NEW -->

The review token binds the base, draft, accepted state and selected grouping. A changed draft or accepted base requires another review. Applying a local version still uses normal editing-access and commit-permission validation. Dismissed/rebased drafts retain a recovery copy. Reviewing a group updates only its represented objects; unrelated incoming content remains pending explicit refresh. <!-- NEW -->

## Validation and limits <!-- NEW -->

Tests cover controlled-clock sixty-second replay stalls, ten-second checkpoints, thirty-second lease expiry, signed status validation, author isolation, failed checkpoint replacement, revision coalescing, dependency-closed partial application and all four resolution choices. Native Electron and Syncthing tests distinguish local processing time from network delivery. <!-- NEW -->

The native content-stall fixture also completed sixty real seconds with six recovery attempts and sub-23 ms p95 badge feedback. Real Syncthing status delivery and signed resolution races are exercised separately. See [measurements and outstanding repository failures](garden-save-performance.md#protocol-3-fresh-project-and-independent-status-verification). Save execution still takes several seconds on the fresh-project diagnostic; queue separation does not remove replay and persistence costs. <!-- NEW -->

Removing forced autosaves allows continuous editing to postpone refreshable project content indefinitely. A crash can lose roughly the last checkpoint interval under normal storage conditions; disk failure can extend that interval and is reported. Expiring reservations favors continued work during partitions, so conflicts remain possible. Full-document capture/replay costs still require measurement; separating queues alone does not establish a save-time or responsiveness guarantee. <!-- NEW -->
