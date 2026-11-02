# Startup repair validation — 2026-11-01 <!-- NEW -->

The final five sequential native launches passed with normal graphics and visible windows. The remembered-login fixture contains a 2,099,406-byte garden, eight accepted changes after its initial large checkpoint, and 18 registrations. The source manifest was unchanged throughout the run. Each launch restored the original oversized tail before starting, verified the selected garden after shell readiness, and published a checkpoint at accepted sequence 9. <!-- NEW -->

| Launch | Home, background and login | Tray | Cold garden check | Largest main heartbeat gap | Largest renderer heartbeat gap | <!-- NEW -->
| --- | ---: | ---: | ---: | ---: | ---: | <!-- NEW -->
| 1 | 2.097 s | 0.951 s | 3.956 s | 409 ms | 110 ms | <!-- NEW -->
| 2 | 2.650 s | 1.119 s | 4.149 s | 141 ms | 112 ms | <!-- NEW -->
| 3 | 2.177 s | 1.004 s | 6.184 s | 222 ms | 111 ms | <!-- NEW -->
| 4 | 3.336 s | 1.314 s | 7.498 s | 149 ms | 113 ms | <!-- NEW -->
| 5 | 2.926 s | 1.412 s | 4.178 s | 116 ms | 114 ms | <!-- NEW -->

The five-second shell bound and one-second heartbeat bound passed on every launch. Checkpoints covered the complete accepted tail after every reconstruction. Evidence, screenshots, and source hashes are in `.test-artifacts/responsive-startup/1793577896024/`. These measurements establish this fixture's behavior on this machine, rather than a timing guarantee under arbitrary host load. <!-- NEW -->

An earlier source-verified run overlapped the end of native validation: one launch took 5.952 seconds and correctly failed acceptance, while its four other launches passed. It had no one-second reconstruction stalls. That failed run remains in `.test-artifacts/responsive-startup/1793577742379/`; it was not discarded or counted as passing. <!-- NEW -->

A disposable copy of the affected 1,983,243-byte real garden reconstructed in **11.575 seconds**, compared with the earlier **57–74 second** baseline. It contained nine accepted records totaling 7,822,087 tail bytes. After checkpointing at sequence 9, a new store opened it in **0.906 seconds**; a warm read took **0.163 seconds**. The copy's writes were restricted to its temporary directory. Evidence is in `.test-artifacts/splash-freeze/cold-replay-1793561452633/results.json`. <!-- NEW -->

Focused validation passed: <!-- NEW -->

- 89 storage, permission, worker, reference, tray, palette, and native opening-adapter tests in `.test-artifacts/splash-freeze/final-focused.txt`. <!-- NEW -->
- 176 splash, Home, and startup-default tests in `.test-artifacts/splash-freeze/splash-final.txt`. <!-- NEW -->
- Four selected startup orchestration tests in `.test-artifacts/splash-freeze/startup-orchestration-final.txt`. <!-- NEW -->
- 39 naming, retirement/restoration, and reference compatibility tests in `.test-artifacts/splash-freeze/compatibility-final.txt`. <!-- NEW -->
- Four native first-open and file-opening tests in `.test-artifacts/splash-freeze/native-open-final-2.txt`. <!-- NEW -->

Coverage includes parse-count scaling with 81 holds, policy changes, worker timeout/crash/cancellation, queued request fencing, membership and head advancement during verification, project-local references, soft checkpoint boundaries/failure/retry, hard checkpoint limits, unavailable covered archives, cancellation during checkpoint publication, changed callers/documents, tray eligibility, palette preferences/search, and adopting a renamed projection before native opening. <!-- NEW -->

The repository-wide `npm test` run completed with **3,049 passing, 88 failing, and 10 skipped** tests. Its report is `test-results/latest.md`; the full console output is `.test-artifacts/splash-freeze/required-checks.txt`. Failures include legacy journal/protocol expectations, qualification-gated peer/community operations, fixture/setup failures, and native initialization failures. Two newly added race tests initially intercepted the wrong I/O method; those were corrected and pass in focused reruns. Native Browse and first-open also pass in their final focused rerun. This repair does not claim a green repository-wide suite. <!-- NEW -->

One intermediate first-open run reported a shared-history hash warning under concurrent native validation; isolated and final focused native reruns passed. That broader history behavior is not certified as repaired here. The malformed plugin-URL issue and protocol qualification gates remain outside this change. <!-- NEW -->

The user's running Trellis session was not restarted. Automated native runs used temporary profiles; their sign-in registration calls were isolated from operating-system startup settings. No history, registrations, recovery copies, or drafts were cleaned up. <!-- NEW -->
