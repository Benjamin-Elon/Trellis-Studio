# Trellis Android field companion

This is a locally bundled Capacitor app with its own native Syncthing process. No separately installed synchronization app, Trellis account server, or remote web application is required. The current physical-device build supports ARM64 Android 8 (API 26) and later. x86 emulator and 32-bit ARM packages are not included.

Build from this directory with `npm ci`, then `npm run build:android`. Set `ANDROID_HOME` and `JAVA_HOME` if Android Studio is not in the default Windows locations. The build downloads and checks Go 1.26.2 and Syncthing 2.1.6, keeps tools under `.tool-cache`, compiles the engine into `jniLibs/arm64-v8a/libsyncthing.so`, copies the shared desktop protocols, and runs Gradle. The resulting debug APK is `android/app/build/outputs/apk/debug/app-debug.apk`.

The Android network interface dependency requires the linker setting documented by [anet](https://github.com/wlynxg/anet). This engine uses Syncthing's `noassets` build because application content and administration are provided locally by Trellis. The original [Syncthing source](https://github.com/syncthing/syncthing/tree/v2.1.6), license, and bundled dependency notices remain available for review. Store publication is deferred.

Run `npm test` for transactional offline-store tests. Run the desktop `trellis-field-protocol.test.mjs` and `trellis-field-service.test.mjs` for shared ordering, validation, permissions, and durable acknowledgments.

After an Android debug build, run `npm run test:native-engines` to check its compiled native engine ownership methods using disposable Java children. It verifies two isolated identities, immediate pause and shutdown while startup holds its lock, preserved state on resume, and duplicate-resume prevention. This host test requires the Android SDK and Java runtime; it does not exercise Android network callbacks or a physical phone. <!-- NEW -->

Wi-Fi-only enforcement belongs to the native foreground service and continues when the web view is suspended or logged out. Cached packages remain readable and unlocked edits can be signed into the local outbox while transport waits for Wi-Fi. Returning to Wi-Fi resumes engines owned by the running service; reopening the app recovers after Android ends the service. Saved edits remain pending until desktop sends a durable acknowledgment. <!-- NEW -->

## Physical-device acceptance

1. Enable USB debugging on an ARM64 phone and connect it. Confirm `adb devices` lists it as authorized.
2. Install the debug APK with `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` and launch Trellis Field.
3. On desktop, create or unlock an identity and create or import a managed garden. Link the diagram user only through successful diagram login or invitation acceptance. Assign tasks to that user's role cards.
4. On Android, enter the identity password and export a new device request. Transfer the request file to desktop. In Home → Identity settings, approve that request and save the returned targeted setup package.
5. Import the setup package on the requesting phone with the identity password. Repeated imports must not create a second identity or replace a different device.
6. Open the managed garden on an authorized desktop and use File → Export field work once. Canceling the optional manual file save still publishes the automatic package. Confirm Android receives My work and its permitted garden previews automatically. Later saved desktop edits refresh the package automatically; unsaved drafts remain local. <!-- CHANGE -->
7. Turn airplane mode on. Set one task to DONE and change another annotation. Confirm edits are saved locally. Restart the app, log in offline, and confirm both edits remain.
8. Turn airplane mode off. Keep the desktop diagram open, saved, writable, and free of unresolved conflicts. Confirm desktop applies the operations through task commands and saves the acknowledgment records. Confirm Android reports the actual applied/rejected/superseded results automatically.
9. Confirm DONE uses the phone's local completion day and retains desktop planned dates. Repeat with changed task permissions and a deleted/recreated task. Old identities must not update a replacement object.
10. Select a task and choose Show planting groups. Confirm the whole permitted garden matches the desktop diagram and only the linked planting groups are highlighted. Pan and zoom, inspect beds and plants, and check exported details. Tasks with missing or inaccessible planting groups remain listed with Location unavailable. <!-- CHANGE -->
11. Repeat with Wi-Fi only enabled, application restart during transfer, duplicate package delivery, and logout. Native transfers can continue after logout for already signed outbox records; identity administration and new task editing stay locked.

Android can suspend background work or time out a foreground data-sync service. Resume on application startup without promising continuous background synchronization. File transfer alone is never desktop acknowledgment. <!-- CHANGE -->

The October 12 Moto G Power physical test verified approval/setup, automatic package arrival, airplane-mode edits, restart with retained edits, reconnect, desktop command application/save, and automatic Android acknowledgment. The whole-garden PNG and planting-group highlight change passed production desktop pixel checks, the bundled UI smoke, and the physical phone's pan/zoom checks. Three further queued edits were acknowledged after desktop restart, with planned dates retained. The October 13 build adds native Wi-Fi-only enforcement and startup/shutdown fixes; that build still needs installation and network/background checks on the phone. See `../test/identity-field-implementation-status.md` for the test record and current build checksums. <!-- CHANGE -->

The temporary Stay awake while charging setting was restored after physical testing. Airplane mode was disabled and Wi-Fi restored after the offline test. Temporary ADB forwarding was removed. <!-- CHANGE -->
