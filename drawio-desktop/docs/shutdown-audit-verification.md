# Trellis shutdown audit verification <!-- NEW -->

The reported `Object has been destroyed` exception is repaired: closed-window cleanup uses the renderer ID captured at creation, releases every window context, and never reads the destroyed window's `webContents` getter. Window IPC replies and deferred load/logout callbacks are bounded and owned by their sender. Hidden-window queries also use their requesting window instead of requiring native focus. <!-- NEW -->

Quit now checks every document before removing drafts or stopping services. Cancel preserves the active session. Approved snapshots remain local to the renderer and are checked again before discard; input, remote reload, field processing, and delayed draft writes are held while closing. Draft deletion must finish successfully, including confirming that a filesystem safety guard did not retain the file. <!-- NEW -->

Configured legacy shares and installed, non-revoked identities determine background eligibility. Locked identities continue syncing. Tray controls cover both transport kinds, retired folders do not block Resume All, and missing or partially created tray controls lead to the agreed explanation and Quit. Native macOS behavior without configured syncing is preserved. <!-- NEW -->

Transport stops share one operation and the application's ten-second graceful deadline, then allow up to three seconds to observe forced termination. Late startup/configuration/poll callbacks cannot restore readiness. A lost shutdown HTTP response still allows the daemon to finish gracefully. Failed termination is recorded and prevents installer launch; installer failure falls back to ordinary approved Quit. Watchers, databases, refresh jobs, tray subscriptions, and window-specific listeners are released. <!-- NEW -->

## Completed checks <!-- NEW -->

- Focused lifecycle, renderer, watcher, sharing, packaging, identity, library, and field tests: **108 passed**, no failures. Report: `test-results/shutdown-focused/latest.md`. <!-- NEW -->
- Native Windows lifecycle: **3 passed**, covering window close, explicit/timer Quit, immediate profile reuse, second-instance rejection, and overlapping isolated profiles. <!-- NEW -->
- Real bundled Syncthing: **3 passed** in a sequential run, covering identity generation/API startup/stop, paired identity catalog/download transfer, and a three-device mesh. <!-- NEW -->
- Production smoke: loading, identity creation, garden opening, field application and durable acknowledgments, Undo/Redo, preview pixels, and shutdown passed. Cleanup reported **zero surviving owned children**. <!-- NEW -->
- Production smoke failure and timeout were deliberately injected after sample transport creation. Both returned the expected failure code and confirmed **zero surviving owned children**, using normal production Quit and approved sample-draft cleanup. <!-- NEW -->
- JavaScript syntax checks and scoped `git diff --check` passed. Unrelated working-tree edits were preserved. <!-- NEW -->

## Verification limits <!-- NEW -->

The full regression run is **not green**. Its report lists bed-transform and planting-preview failures; the companion-layout and irrigation files also exceeded the verification run's 180-second file limit. See `test-results/shutdown-audit/latest.md` and its JSON file details. These results are separate from the passing shutdown checks; this audit does not claim that all garden-layout behavior is validated. <!-- NEW -->

The execution sandbox prevented Chromium renderer launch in an initial smoke attempt. Native verification was therefore run on the Windows host with temporary profiles. macOS/Linux policy branches have behavioral coverage; native verification on those platforms remains outstanding. No installed identities or production profiles were used in these tests, and no lock files were deleted to bypass ownership. <!-- NEW -->

The production smoke still reports the existing roadmap dependency and external MathJax CSP warnings. Those loading issues were preserved. Abrupt OS termination and power loss can bypass graceful cleanup; forced daemon termination can interrupt a transfer, with saved local changes available for a later synchronization. <!-- NEW -->

## Running the changes <!-- NEW -->

Quit the currently running Trellis instance completely using its tray's **Quit Trellis OS** action, then run `npm start` from `drawio-desktop`. Closing the editor with X can intentionally leave the old main process running in the tray, so a second launch alone does not reload this repair. <!-- NEW -->

Use `npm run test:home-production` for the parent-bounded production smoke. The existing direct physical Android helper retains its thirty-minute session behavior; cleanup targets only recorded test-owned processes and verified temporary directories. Package JSON cannot carry end-of-line comments; other changed source and documentation use change markers. <!-- NEW -->
