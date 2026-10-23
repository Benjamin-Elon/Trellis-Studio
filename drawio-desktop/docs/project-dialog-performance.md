# Project dialog performance <!-- NEW -->

Measurements were taken on the development Windows machine using isolated identity and transport fixtures on October 21, 2026. They are observations, not hardware-independent latency guarantees. The reliable acceptance checks are independent section publication, on-demand snapshot behavior, and the absence of listing writes or collaboration-history replay. <!-- NEW -->

| One-garden listing | Before | After | File reads before / after | Writes before / after |
|---|---:|---:|---:|---:|
| Cold | 119.3 ms | 37.9 ms | 17 / 4 | 4 / 0 |
| Warm | 351.6 ms | 15.3 ms | 17 / 4 | 3 / 0 |
| After 20 renames | 514.2 ms | 40.1 ms | 177 / 24 | 3 / 0 |

Each earlier listing invoked naming reconciliation and scanned the registry twice. The revised listing invokes no naming reconciliation, scans each transport registry once, and shares one verified identity state across catalog, suffix, lifecycle, and reference-city reads. Identity-state verification accounted for 13.6 / 70.0 / 10.7 ms in the baseline and 9.2 / 4.8 / 3.1 ms afterward. Naming accounted for 74.7 / 202.9 / 416.7 ms before and zero during revised listing. <!-- NEW -->

The existing 100-garden/300-identity community fixture reported a 201 ms cached listing average before the change and 138 ms in the first revised run. Both runs include machine-load variation. These measurements predate the on-demand snapshot revision. The service still reuses verified files; explicit discovery calls now read current completed state. Window renderers own display-cache lifetime. Blocked-maintenance tests continue to verify that browsing is independent of serialized writes. <!-- NEW -->

Renderer source timings and DOM rendering are measured independently through the optional `TrellisGardenHomeTiming` observer. Deferred-source tests establish that an unfinished community or request load cannot prevent project rows from appearing; unchanged row nodes remain identical when another source settles. These deterministic checks supplement elapsed timings, which vary with the browser and machine load. <!-- NEW -->

The benchmark is opt-in because preparing its signed edit history is relatively expensive. The regular regression suite asserts work counts and uses controlled clocks at library sizes 0, 1, 10, 11, 50, and 51 to assert zero idle/reopen/status metadata work, avoiding timing-sensitive wall-clock assertions. <!-- NEW -->

## Verification outcome <!-- NEW -->

The broad focused run passed 266 tests with the opt-in benchmark skipped. Subsequent changed-component checks passed 128 tests, and the three presence checks include an additional regression proving that connection observations continue while garden processing is blocked. The isolated Chromium check passed section-header loading while folded, retained rows, stationary headers, focus/menu behavior, and narrow-window overflow. <!-- NEW -->

In the final 14-project Chromium fixture, an initial library response was observed after 9.1 ms and its render took 75.8 ms; unchanged-source renders were typically below 5 ms. An intentionally deferred library response remained pending for 298 ms while other sections completed and the previous project rows stayed available. These source timings include event-loop scheduling and are not disk-only measurements. <!-- NEW -->

The full production project smoke reached identity creation, starter creation, Trash, restore, community creation, and invitation handoff, then timed out while saving the collaborator/city fixture. It therefore does **not** establish a complete end-to-end pass. Chromium requires an execution environment that permits renderer subprocesses; the isolated layout check succeeded outside the filesystem sandbox. No isolated smoke-test Syncthing processes remained after verification. <!-- NEW -->

## On-demand snapshot revision, October 22 <!-- CHANGE -->

Dialog cadence work is now absent. Controlled-clock tests at 0, 1, 10, 11, 50, and 51 gardens assert no additional metadata reads after five minutes, transport/identity status notifications, Projects/Trash navigation, or reopening. Returning to a cached identity also performs no new listing reads. Window closure releases the cache; pending requests publish public data while closed but never update detached DOM. Separate tests cover section-only reloads, timestamps, explicit failure retry, category and Trash transfers, unchanged row nodes, and newer local edits surviving older responses. <!-- CHANGE -->

The final focused runs passed 85 dialog tests, 93 backend tests (two opt-in checks skipped), 99 identity/renderer integration tests, and the separately enabled one-garden benchmark. Chromium layout checks passed folded loading headers, independent Reload controls, static timestamps, menu/focus behavior, retained rows, and narrow-window overflow. The unresolved production-smoke timeout above remains an integration limitation; it was not reclassified as a pass. <!-- CHANGE -->

| Measurement | Current observation | Backend work |
|---|---:|---|
| 14-project initial Chromium display | 181–401 ms across two runs | One library, local, community, request, city-catalog and reference-city read each |
| Shared-section explicit reload | 3.3–5.2 ms | One library read; no standalone scan |
| 31 search-input interactions | 248–334 ms total | Zero metadata reads; still zero after one second idle |
| Cold real-service listing | 38.8 ms | Four file reads, zero writes/history replay, one registry scan |
| Warm real-service listing | 14.5 ms | Four file reads, zero writes/history replay, one registry scan |
| Real-service listing after 20 renames | 41.2 ms | 24 file reads, zero writes/history replay, one registry scan |
| Existing 100-garden/300-identity fixture | 342 ms average cached service listing | Verified completed-state reads; no renderer display snapshot in the service |

These are development observations under varying machine load, including concurrent test work, rather than latency guarantees. Earlier real-service listing observations were 37.9/15.3/40.1 ms after the read-only backend work and 119.3/351.6/514.2 ms before it. The current revision preserves those backend work reductions; its distinct benefit is eliminating repeated dialog metadata requests. Chromium bridges are deterministic fixture data, so their display timings are separate from real disk/service benchmarks. Raw outputs are under `.test-artifacts/dialog-snapshot-{home,backend,integration,benchmark,chromium}.log`; final screenshots are under `.test-artifacts/garden-dialog/56856/`. <!-- CHANGE -->
