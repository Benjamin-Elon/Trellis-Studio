# Garden saves and invitation preparation <!-- NEW -->

Performance acceptance is **not met** for the representative shared-garden workload. The original save-pipeline work below bounds verification/parsing reuse and explains slow operations. Protocol 3 now adds [independent activity and private recovery](background-saving-v3.md); its fresh-project measurements are recorded at the end of this document. The required shared-save and invitation p95 qualification remains incomplete. <!-- CHANGE -->

## Earlier save-pipeline baseline <!-- CHANGE -->

- Collaborative requests share a save only when its captured model revision covers the request, its document generation matches, and its explicit-refresh barrier is identical. Newer typing stays modified and receives a separate save through the existing autosave path. Each subscriber completes once. Native local saves retain their existing ordering. <!-- NEW -->
- Invitation preparation attaches to that save boundary, checks document identity after asynchronous steps, validates the saved invitation block, and forwards first-save cancellation. `sharing.prepareInvite(result, { onProgress })` accepts an optional stage observer. Retained Retry/Copy operations validate the invitation again without rotating its code or saving again. <!-- NEW -->
- Delivery reports queued, editing-access wait, garden save, invitation preparation, and email-request stages. After five seconds it shows elapsed time and continues the same operation. Closing prevents subsequent automatic email launch. Complete text remains copyable while the mail handler is pending. <!-- NEW -->
- Journal reads still discover and read current files and recheck membership, retirement, timestamps, fields, causal dependencies, and policy. Reads use at most 32 files per metadata batch and an 8 MiB ordinary data burst; an individual larger record is read alone under the existing 128 MiB limit. Records and diagnostics retain sorted order. <!-- NEW -->
- Signature evidence is reused only for identical bytes, project identity, and signer key. Parsed object indexes are copied with independent DOM documents and parent trees. The estimated cache budget is 16 MiB in the main process plus 48 MiB shared across replay workers. Workers release reservations on completion/error; the parent reclaims leftovers after exit. This budget covers retained cache entries, not total application RSS or active input buffers. <!-- NEW -->
- Only adjacent queued background refreshes coalesce. A mutation fences them; an arrival during an active read can schedule another read. Whole-state replay, current hold semantics, recovery copies, and explicit object refresh remain intact. No persisted cache, checkpoint format, compaction, or migration was introduced. <!-- NEW -->
- Existing timing observers report operation identifiers, phase durations, byte/count observations, cache reuse, and replay counts. They do not receive invitation codes or document XML, and observer failures cannot change save completion. <!-- NEW -->

## Measurements and acceptance gaps <!-- NEW -->

The development host is Windows x64, Intel i3-1115G4, four logical processors, 8 GiB RAM, Electron 38.7.0. Measurements below are observations under varying machine load, including other tests. They are not hardware-independent guarantees or a controlled proof of speedup. The native fixture hosts production graph, desktop save, sharing renderer, journal, and invitation-block components in isolated profiles; it excludes full plugin startup, live Syncthing transport, external mail handlers, and the Users form itself. Invitation samples mutate pending-invitation metadata before production preparation. <!-- NEW -->

Three serial local-garden runs completed 30 samples per operation on a 2,177,078-byte garden. This path has no collaboration journal. <!-- NEW -->

| Operation | Run 1 p95 | Run 2 p95 | Run 3 p95 |
| --- | ---: | ---: | ---: |
| Manual save | 163 ms | 160 ms | 119 ms |
| Autosave execution | 146 ms | 115 ms | 105 ms |
| Three overlapping saves | 433 ms | 375 ms | 589 ms |
| Unchanged save | 143 ms | 121 ms | 128 ms |

The local-only campaign intentionally reports overall `accepted: false`: it cannot qualify shared gardens or invitations. Autosave execution excludes its debounce timer. Raw source manifests, samples, and logs are in `.test-artifacts/save-performance/campaign-1792957499610/`. A later single-sample smoke also completed; it is not p95 evidence. <!-- NEW -->

The 2.18 MiB / 1,000-record shared-engine fixture contains 20 historical edits plus claims, releases, and viewing records. The retained pre-edit baseline reached a roughly 49-second cold open and did not complete its first save within 120 seconds. A subsequent diagnostic completed one save in approximately 113 seconds. Three frozen-source diagnostic attempts after bounded I/O still timed out before completing qualifying operation samples; their source snapshot, incomplete results, and slow-operation messages are in `.test-artifacts/save-performance/campaign-1792958105860/`. These were one-sample diagnostics, **not** the required 30-sample shared/invitation qualification. <!-- NEW -->

In those attempts, warmed record reading/verification usually took 0.3–0.5 seconds per read, while replay took approximately 19–28 seconds per pass. A claim and save can each require multiple passes and wait behind another operation. These are measured remaining bottlenecks; a later parsing-only diagnostic also remained slow. The five-second save/preparation target, full shared/invitation sampling, and existing production responsiveness acceptance are therefore unverified or failed. No broader protocol change was made to bypass these limits. <!-- NEW -->

The opt-in 10,000-record test passed on a 2,167,395-byte garden, including checked reuse, store recreation, and comparison with the uncached reducer. This fixture contains **one historical edit**, so it must not be compared directly with the 20-edit native fixture. The later observations were 26.7 seconds cold, 21.4 seconds warm, and 19.3 seconds for a new store instance. The warm read reused all 10,001 signature checks. Store recreation occurs within the same process; it is not a cold process restart. Raw observations and phase breakdowns are in `.test-artifacts/save-performance/stress-10000.json`; the earlier serial-I/O observation is retained beside it. <!-- NEW -->

## Verification <!-- NEW -->

- The combined focused run passed 242 tests. Subsequent cache/protocol/worker checks passed 45 tests, including separate page documents, cache ownership, worker-error cleanup, authorization changes, expiry, deleted/tampered records, and convergence. Final bounded-I/O checks passed three tests, including large-record serialization under the burst budget. Logs: `focused-final.log`, `cache-final.log`, and `io-final.log` under `.test-artifacts/save-performance/`. <!-- NEW -->
- The final sharing/native run passed all eight tests, covering Create Email handoff, invalid input, native copy/focus, and collaborative editing lifecycle. Native explicit-refresh checks passed separately. The share-dialog fixture now supplies the production Quickstart graph context; native failure assertions retain delivery diagnostics. Earlier native focus/time-limit failures remain recorded rather than being relabeled as passes. <!-- NEW -->
- The broad `npm test` run completed with **2,548 passed, 36 failed, eight skipped**. Failures included spacing/geometry fixtures, native printing/focus/lifecycle checks, startup assertions, and share fixtures. Focused sharing reruns passed after correcting the missing fixture context and rerunning native checks in isolation. The broad suite was not rerun to green, and failures outside this change were not silently refactored. The complete original output is `.test-artifacts/save-performance/full-suite.log`. <!-- NEW -->
- Working-tree changes in the surrounding hold, scheduler, reference, and Quickstart work were preserved. Benchmarks freeze their main-process, renderer, and fixture inputs and verify the manifest before and after each run. <!-- NEW -->

## Reproduction <!-- NEW -->

Run from `drawio-desktop`. The full benchmark requests three serial runs with 30 samples per operation; it rejects incomplete, smoke, stress, and partial-mode campaigns as overall performance acceptance. Large workloads can take a long time; the fixture records partial results and enforces its watchdog. <!-- NEW -->

```powershell
node scripts/benchmark-garden-saves.cjs
node scripts/benchmark-garden-saves.cjs --mode=local
node scripts/benchmark-garden-saves.cjs --smoke --mode=private
$env:TRELLIS_SAVE_STRESS_TEST='1'
node --test test/trellis-save-stress.test.mjs
Remove-Item Env:TRELLIS_SAVE_STRESS_TEST
node --test --test-concurrency=1 test/trellis-syncthing-renderer.test.cjs test/trellis-users.test.cjs test/trellis-collaboration.test.mjs test/trellis-collaboration-worker.test.mjs test/trellis-save-cache.test.mjs test/trellis-close-renderer.test.cjs test/trellis-object-views.test.mjs
node --test --test-concurrency=1 test/garden-share-dialog-focus.test.cjs test/garden-invite-delivery-electron.test.cjs test/trellis-collaboration-electron.test.cjs test/trellis-explicit-refresh-electron.test.cjs
npm test
```

## Protocol 3 fresh-project and independent-status verification <!-- NEW -->

The final fresh private-project diagnostic starts with zero historical records and a 2,177,207-byte diagram. Each entry below is one sample under varying host load, not a p95 estimate or a controlled speedup claim. Autosave execution excludes its five-second quiet period. The final fixture mirrors production by merging independent activity into content replies. <!-- NEW -->

| Operation | Retained version 2 baseline | Protocol 3 final diagnostic |
| --- | ---: | ---: |
| Explicit Save | 4,858 ms | 7,897 ms |
| Autosave execution | 11,463 ms | 7,292 ms |
| Three overlapping save requests | 8,568 ms | 5,564 ms |
| Unchanged save | 715 ms | 742 ms |
| Invitation preparation | 15,586 ms | 5,117 ms |

Raw results are `.test-artifacts/save-performance/fresh-before-v3.json` and `fresh-after-v3-verified.json`. The latter supersedes intermediate diagnostics. Across its five operations, fourteen read passes spent 17.35 seconds in replay (5.72 seconds maximum per pass) and 1.22 seconds verifying (0.60 seconds maximum). Queue wait totaled 12.95 seconds, with a 3.66-second maximum. XML capture totaled 167 ms (104 ms maximum); observed atomic writes totaled 3.37 seconds (1.07 seconds maximum); native completion totaled 567 ms. Phases overlap or contain other phases and must not be added as elapsed time. History completion has its own renderer timing event; this component fixture omits the full history plugin, so history latency remains unqualified. <!-- NEW -->

The real-time native stall fixture held content replay for **62.78 seconds** while committing thirty further edits. Six ten-second private checkpoint attempts occurred. The older save completed without clearing the newer dirty revision. Local pending-badge rendering was 0.3 ms p95 and next-frame feedback 15.8 ms p95; received activity rendering was 0.7 ms p95 and next-frame feedback 16.3 ms p95. These observations satisfy the fixture's 100 ms target during the stall, not a guarantee under arbitrary synchronous CPU work. Raw results: `.test-artifacts/save-performance/status-v3-native-stall-final.json`; screenshot: `status-v3-badges.png`. <!-- NEW -->

Real Syncthing peers exchanged authenticated editing and pending-change status without content polling while the coordinator was offline, then converged on independent accepted edits. Status delivery, including fresh-heartbeat confirmation, took 9.65 seconds in that run. Network delivery is separate from local rendering. Log: `.test-artifacts/status-v3-real-status-syncthing.log`. <!-- NEW -->

The broader focused run passed **352 tests**, with one opt-in test skipped (`status-v3-complete-focused.log`). Subsequent scheduling, close/logout, recovery, and renderer checks also pass. The full repository run recorded **2,689 passed, five failed, ten skipped** (`status-v3-full-suite.log`). Four failures in native loader/export/printing checks persisted on isolated reruns (`status-v3-native-reruns.log`); their cause remains unresolved. The directory performance test also failed against retained pre-change sources (`status-v3-directory-baseline.log`), confirming a pre-existing performance failure. No repository-wide green or complete shared-save performance qualification is claimed. <!-- NEW -->

Run the targeted native diagnostics from `drawio-desktop`; the badge-only run deliberately does not qualify overall save performance. <!-- NEW -->

```powershell
node_modules/.bin/electron.cmd test/helpers/garden-save-performance-electron.cjs --fresh --smoke --mode=private
node_modules/.bin/electron.cmd test/helpers/garden-save-performance-electron.cjs --fresh --badges --stall-content --mode=private
$env:TRELLIS_SYNCTHING_RUNTIME_TEST='1'
node --test --test-name-pattern='peers exchange object records' test/trellis-syncthing-runtime.test.mjs
Remove-Item Env:TRELLIS_SYNCTHING_RUNTIME_TEST
```
