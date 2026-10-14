# Identity, Garden library, and field companion verification

Implementation lives in the existing desktop preload/main-process boundaries and Task Manager/Users mechanics, with shared pure identity and field protocols. Desktop Syncthing profiles, managed garden folders, credentials, and catalogs are isolated by identity. The application retains the existing splash licensing/onboarding design and local opening options.

Verified on this Windows host:

- The regression run completed with 686 passing tests, three skips, and no failures. A further 245 relevant checks passed after the task-history changes. <!-- CHANGE -->
- The saved-diagram refresh change passed 132 focused regression checks and the production signed-outbox test. After a first field export, subsequent saved desktop edits automatically refresh the worker package; unsaved drafts stay local and unchanged polls create no extra package. Newly added objects receive persistent identities before publication. <!-- NEW -->
- Real bundled Syncthing daemons paired two isolated desktop profiles, transferred their catalog automatically, and selectively downloaded a garden. The October 13 test also interrupted a 4,195,153-byte signed field package by forcibly stopping its receiving daemon. Its temporary file remained outside the signed inbox; restarting completed the transfer with matching SHA-256 and a valid signature, without creating an acknowledgment. <!-- CHANGE -->
- Production Electron loading exercised the actual main process, preload, index, plugin queue, identity creation, managed creation/opening, linked diagram login, and Local Garden/Garden library chooser cancellation.
- Production field processing applied an incoming operation through the existing task command, kept the planned day, saved completion using the supplied local day, and persisted its acknowledgment. Undo/Redo preserved the command and its immutable receipt. Pixel checks verified whole-garden preview and linked planting-group alignment at 0.7 and 1.4 zoom with nonzero pan. <!-- CHANGE -->
- The companion uses static PNGs from the production Trellis renderer. It shows the whole permitted garden and highlights the planting groups linked to the selected task. It does not reconstruct the garden with a separate layout engine. <!-- NEW -->
- The bundled companion UI passed a separate browser smoke test using a public sample package and a throwaway identity. Group highlights remained aligned within one CSS pixel after zooming and scrolling; unchanged synchronization polls retained the view. This browser harness replaces native transport only. <!-- NEW -->
- The October 13 bundled UI smoke also verified cached work editing while Wi-Fi-only blocks transport, a valid signed outbox record, and retained pending edits after network recovery without an acknowledgment. A rapid settings tap remains selected even if the saved-setting read completes afterward. <!-- NEW -->
- The October 13 native ownership test passed against the compiled Android plugin with two disposable Java child processes. Pause and service shutdown bypass an in-flight startup lock; resuming preserves each identity's saved state and repeated resume does not create another child. This checks native process ownership on the host, not Android network callbacks. <!-- NEW -->
- Shared merge checks cover opposite operation ordering, replay, timestamps/counters, Unicode annotations, denied/deleted objects, and preservation of pending edits across refreshes.
- IndexedDB checks cover rapid operation allocation, reopening after restart, rollback after interrupted writes, and refresh concurrent with local editing.
- Main-process acknowledgment checks reject unsaved/mismatched values, versions, hashes, or paths. Signed updates from removed devices cannot enter the applied command path.
- Android native Java and bundled ARM64 engine compile successfully into a locally installable debug APK. Windows NSIS packaging succeeds with publication disabled.

Physical testing on the attached Moto G Power (Android 11, ARM64) verified device approval, encrypted targeted setup, automatic desktop-to-Android packages, airplane-mode task progress and Unicode annotations, application restart with retained edits, reconnection, automatic desktop application and durable save, and acknowledgment on Android. A fresh annotation round trip confirmed automatic acknowledgment without another manual export or desktop restart. Planned dates were retained and completion used the phone's local calendar day. Only an isolated sample identity and garden were used. <!-- CHANGE -->

The whole-garden/planting-group change passed the production renderer, bundled companion UI, and Moto G Power checks. On the phone, exactly one linked planting group was highlighted; its coordinates remained aligned within 0.01 CSS pixels after zooming and scrolling. After the test desktop resumed, three additional queued phone edits were durably saved and acknowledged automatically, leaving no pending edits. Planned dates remained unchanged, including completion on the following calendar day. <!-- CHANGE -->

The October 12 APK's initial preview fits the actual map viewport without horizontal cropping. Its fit, pan/zoom alignment, and view retention through an unchanged native synchronization poll passed on the phone after installation. Existing identity/package data and all six operation acknowledgments survived the APK update. <!-- CHANGE -->

The October 13 APK moves Wi-Fi-only enforcement into the native service, keeps cached records and local outbox writes available while blocked, and invalidates in-flight startup when the service shuts down. The native policy test, companion UI smoke, twelve field/offline-store regressions, and Android debug build pass. This APK has not been installed on the phone yet: ADB listed no devices during this continuation. The previous physically tested APK is retained with a `-2026-10-12.apk` suffix. <!-- NEW -->

Physical Android Wi-Fi-only behavior, sustained background suspension, interrupted large transfers on Android, and pairing across two physical desktop computers remain extended acceptance checks. Pairing and interrupted-transfer recovery passed using isolated profiles on this Windows host. Follow `android-companion/README.md` for the physical checks. <!-- CHANGE -->

Current local test builds (publication disabled): <!-- NEW -->

- Windows x64: `dist/identity-field-test/Trellis Studio-2.7.0-windows-installer.exe`; SHA-256 `1F2AEBFE95E53F584CF6D0722865367355F9EB84BC70154C5B1E2B4D7C2F13D4`. <!-- CHANGE -->
- Android ARM64 debug (October 13): `dist/identity-field-test/Trellis-Field-0.1.0-android-arm64-debug.apk`; SHA-256 `ABECDFCE979FECD7734514366DE10223F84CF3362290CFFA3CBFEDD212FF584D`. <!-- CHANGE -->
- APK field UI, offline store, shared field protocol, and bundled ARM64 engine match their source files by SHA-256. The Windows installer remains the previously built desktop artifact. <!-- CHANGE -->

Reproduce the production smoke with `npm run test:home-production`. Reproduce the bundled companion preview check with `node node_modules/electron/cli.js test/helpers/field-garden-preview-electron.cjs <public-field-work-package.json>`; the sample package must contain a task linked to an unrotated planting-group region. Run `npm run test:native-engines` from `android-companion` after building Android. The helpers never read installed identities. Local test artifacts include the production loading output, preview pixels, companion DOM measurements, native ownership results, APK source checks, and the sample diagram's saved operation outcomes. <!-- CHANGE -->

Reproduce real pairing and interrupted-transfer recovery by setting `TRELLIS_SYNCTHING_RUNTIME_TEST=1`, then running `node --test test/trellis-identity-runtime.test.mjs`. It uses disposable profiles and owned bundled daemons, throttles their loopback traffic, and recognizes both Windows and Unix temporary-file names. It does not connect to installed identities or the phone. <!-- NEW -->

Scope and failure behavior:

- Reachable approved peers are required for downloads. The catalog cannot restore a garden after every file copy is lost.
- Ordinary diagram files retain filesystem privacy. Portable login protects identity credentials and application sessions.
- Password changes and revocations propagate eventually; offline devices retain previously downloaded information and may unlock with locally known credentials.
- Equal field timestamps use device identity and a persistent operation counter. Incorrect clocks can choose an unintended winner. Concurrent desktop file conflicts remain reviewable Syncthing conflict copies.
- Shared canvas enrollment retains its coordinator/admin approval boundary. Pairing an identity does not grant access by matching names or emails.
- Android currently targets ARM64/API 26+, with viewing and assigned task progress/annotation editing. It excludes garden editing, task creation/reassignment/rescheduling, photos, and identity administration.
- Production smoke also logs pre-existing roadmap dependency and MathJax CSP errors. The destroyed-window close exception is repaired through captured window IDs and coordinated production cleanup; all smoke exit paths now request bounded normal Quit. <!-- CHANGE -->

The repository contained unrelated planting/bed edits before this implementation; those were preserved. JSON build configurations cannot contain end-of-line comments, so their necessary changes exclude Android build tools and local smoke artifacts from desktop packaging. Other changed source uses change comments.
