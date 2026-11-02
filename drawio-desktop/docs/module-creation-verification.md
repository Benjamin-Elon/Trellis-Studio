# Module creation and save-delay verification — 2026-10-31 <!-- CHANGE -->

Implemented independent accepted-policy revisions, pending-creation evidence
retention, creation-only placement, complete rejected-creation rollback, and
native Undo insertion filtering. Regular, team, task, roadmap and garden factories
use the same creation transaction and retain normal permission enforcement.
Existing modules remain fixed during creation. <!-- CHANGE -->

The save-delay investigation found two bypasses: automatic hold release invoked
the manual save path, and draw.io displayed Saving at edit time before the timer
ran. Automatic release now shares the twenty-second quiet queue; manual Save and
explicit handoff still bypass it. Releasing after a wait rechecks the document,
actor, original claim, current selection and pinned editors. Unapplied text against
a clean graph does not create a graph save. Native rejected edits use `ignoreEdit`
and cannot enter Undo history. <!-- CHANGE -->

Validation was performed from this checkout in isolated test profiles. Logs and
native screenshots are under `.test-artifacts/module-creation-fix/`.
<!-- CHANGE -->

| Run | Result | Evidence |
| --- | --- | --- |
| Users, permissions, renderer, accepted state, modules, roadmap, background saving, holds, activity, attribution, details and planner holds | 569 passed | `final-regressions.log` |
| Updated Users and creation rejection contract | 134 passed | `rejection-native-contract.log` |
| Updated automatic-release, clean private draft, renderer and frozen-hold checks | 83 passed | `automatic-release-verified.log` |
| Final module creation, module placement and roadmap checks, including single-message rejection | 237 passed | `rejection-ui-final.log` |
| Existing native cluster rendering, module header movement and permission/signed-save checks | 3 passed | `native-compatibility-final.log` |
| Native permission guard after rejected-edit bookkeeping change | 1 passed | `native-permissions-final.log` |
| Final complete desktop creation, delay, rollback and save/reopen check | 1 passed | `native-ui-final.log`, `native-creation.json` |

Runs overlap; their counts must not be summed as distinct tests. The full
repository suite was not rerun for this change. The native creation test exercises
the complete application, a private admin project, every module type, repeated
creation, unchanged existing root geometry, signed saves, rollback, Undo validity,
the actual twenty-second save pause, and save/reopen with creator permissions.
Raw native results are in `native-creation.json`. <!-- CHANGE -->

Controlled timing additionally verifies postponement by typing and immediate
manual flushing. The full-app wall-clock run observed no early capture and the
status Changes waiting to save; capture began **20.135 seconds** after the
edit in the final run. This measures scheduling, not a save-speed or input-latency improvement.
Checkpoint and heartbeat regressions pass independently. <!-- CHANGE -->

## Remaining investigation <!-- CHANGE -->

The screenshot's exact `Cannot read properties of undefined (reading 'length')`
exception has not reproduced, including production startup/factory runs and native
permission rejection. No originating stack was captured and no global exception
suppression was added. The requested exception-trace completion gate therefore
remains open; this report does not claim that specific exception is fixed.
<!-- CHANGE -->

No diagram migration or reapplication of retained drafts is required. Source
changes take effect when this checkout's desktop application is restarted; an
already running renderer retains its loaded plugin functions. Unrelated workspace
changes were preserved. <!-- CHANGE -->
