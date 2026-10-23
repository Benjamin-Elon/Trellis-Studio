<!-- NEW: integration contract, operational behavior, and release acceptance checklist. -->
# Trellis Managed Canvas Sharing

Object collaboration v2 is the only supported sharing protocol. Signed object changes, editing holds, recovery, and verification commands are documented in [Object collaboration over Syncthing](collaboration-v2.md). Registrations are classified individually: current shares synchronize, recognized old diagrams open locally, and unsupported or unsafe entries are diagnosed without blocking other projects. Legacy folders are removed from the daemon configuration while it is paused; there is no conversion tool. <!-- CHANGE -->

## Close, Quit, and background ownership <!-- NEW -->

Closing the final editor window retains configured canvas sharing and installed, non-revoked identity libraries in the tray. Locked identities continue transferring their configured data without exposing credentials. The tray's Pause All, Resume All, and Restart Sharing actions apply to both transport kinds. If native tray controls cannot be created, Trellis explains the failure once, stops its transports, and exits. Without configured syncing, Windows/Linux exit after the final window closes; macOS retains its normal application behavior. <!-- NEW -->

Explicit Quit and Install Update first check every editor using sender/request-correlated IPC. Approving Discard in one editor does not delete its draft or close that window until all editors approve. Cancel keeps windows, drafts, transports, and refresh jobs running. Document snapshots stay in their renderer and are revalidated before discard; prepared editors temporarily block input, remote reloads, field updates, and delayed draft writes. A missing editor reply offers Cancel (the default) or Close Anyway; Close Anyway retains the recoverable draft. Failed draft removal is reported and returns to the running session. <!-- NEW -->

Committed shutdown rejects new windows and transport work, cancels refresh/poll/retry activity, and requests graceful daemon shutdown using one ten-second deadline. Remaining Trellis-owned children are forcibly terminated, with up to three further seconds to observe actual exit. A successful kill request alone is not recorded as proof of exit. Local database handles, file watches, tray subscriptions, and window-specific IPC listeners are released. Forced termination can interrupt a transfer; saved local changes synchronize on a later launch. OS termination and power loss can bypass orderly cleanup. <!-- NEW -->

The production profile and single-instance policy are unchanged. A second launch while the profile owner is active is rejected normally; lock files are never deleted to evade ownership. Native tests create independent temporary profiles and also reuse one profile immediately after approved exit. Test cleanup targets recorded child handles/PIDs, never executable names or installed user profiles. <!-- NEW -->

Verification commands from `drawio-desktop`: <!-- NEW -->

```text
node --test test/trellis-lifecycle.test.mjs test/trellis-close-renderer.test.cjs test/trellis-lifecycle-electron.test.cjs
npm run test:syncthing
npm run test:home-production
npm test
```

Set `TRELLIS_SYNCTHING_RUNTIME_TEST=1` to run the bundled-daemon and identity-transfer tests. Native Electron lifecycle checks have been exercised on Windows; macOS/Linux policy branches have behavioral coverage, while native validation on those hosts remains outstanding. <!-- NEW -->

## Architecture

`src/main/trellis-syncthing-service.js` owns one isolated Syncthing daemon per Trellis
installation. The private profile, API key, signing key, registry, and recovery
copies live under the existing application's local data directory in
`trellis-sharing/`. Neither the key material nor the live SQLite database enters
a synchronized directory. The control API uses an allocated loopback port; sync
listeners use a separate allocated port, with public discovery and relay fallback.

`trellis-share-protocol.js` defines XML parsing, versioned invite/reply blocks,
permission preservation, canonical signed records, and identity validation.
`trellis-sharing-tray.js` owns tray controls and launch-at-sign-in registration.
`Trellis_Syncthing.js` orchestrates the existing Users, ChangeMap, file watcher,
and desktop file APIs through the narrow preload bridge.

No renderer API permits arbitrary Syncthing REST calls, arbitrary configuration,
or retrieval of credentials. Mutation requests are bound to a window's watched
file and diagram identity. Users/PIN permissions remain soft workflow enforcement;
an approved device still receives the full XML and can tamper with it externally.
The existing generic filesystem bridge and diagram asset relocation also reject
private service-profile paths, including directory aliases. Local recovery
documents are the only user-accessible exception within that profile.
The application file-request filter permits image requests for registered canvas
assets only; other local-file requests retain the existing application/plugin
directory restriction. Scripts and fetch requests cannot use the asset exception.

## Bundling

Run from `drawio-desktop` after installing dependencies:

```text
npm run syncthing:prepare
npm run syncthing:prepare -- win32 arm64
npm run syncthing:prepare -- --all
```

The preparation script pins version 2.1.6 and the checksum-list digest, checks
each archive, and stages the executable and upstream notices in ignored
`vendor/syncthing/<platform>-<arch>/`. No runtime downloads occur.

The existing `afterPack` hook copies only the matching binary into
`resources/syncthing/<platform>-<arch>/`, outside ASAR, and verifies its manifest.
Supported targets without prepared binaries fail the build explicitly. Legacy
32-bit and unsupported runtime targets report sharing unavailable.

On macOS the packaging hook also records a signature-stripped program hash and
registers the helper for release signing. Runtime permits signature-byte changes
only after Apple's signature validation and a matching stripped program hash.
The build must run on macOS for this signing path. Updates ship through Trellis
releases; independent Syncthing upgrades are disabled.

The release workflow prepares all six distributions and runs an isolated native
transport smoke test before packaging. Windows ARM64 installers are built on the
Windows runner; that runner tests its own x64 service, not ARM64 execution.

## First Share And Join

1. Enable Users and log in. Select eligible module, board, or garden-bed scopes.
2. Share confirms that editing grants do not limit what recipients download.
   Save pending edits; then move the XML into an isolated folder under
   `Documents/Trellis/Shared Canvases/<share-id>/`.
3. Explicit local images and file links are copied to hashed `assets/` filenames.
   XML receives relative references, while rendering resolves them locally.
   Missing files or directory references block setup with the affected paths.
   Destination contents and the unchanged source are verified before deletion.
4. The existing Users invitation and prepared email gain a versioned invite block.
   It contains identities/codes, not local paths or service credentials.
5. The recipient chooses **Extras > Join Shared Canvas** (also available from the
   login gate), pastes the block, and returns the prepared device-approval reply.
6. An admin pastes that reply in **Canvas Sync**. After approval and synchronization,
   the recipient opens the arrived file and uses **Accept Invite** for name/PIN.
   Opening a pending/missing file is blocked rather than creating a blank canvas.

Admins can issue separate one-time device-setup invitations for existing users
with an email and effective access. This never creates a second account or resets
its PIN. Ordinary invitation resends invalidate device replies carrying the old
token fingerprint. New Users invitations still expire after 14 days.

## Membership

Each canvas has a fixed coordinator device and pinned Ed25519 public key.
Immutable device-signed admin requests and coordinator-signed acknowledgements
are transported in `.trellis/`. The coordinator publishes monotonically versioned
membership manifests. Requests require the expected version, an approved signing
device, a currently active admin, and a still-valid invitation/effective access.

Peers configure a full per-canvas mesh of approved devices. Native introducer and
automatic-folder-accept flags remain off. Existing peer sync continues while the
coordinator is offline; membership requests wait. Reconnection does not elect a
new coordinator. Explicit admin recovery creates a new share/folder ID and requires
collaborators to join again. Failed recovery restores the original registration.

The coordinator reevaluates saved ownership, inherited grants, open scopes, account
disablement, and invitation expiry/revocation. Partial grant removal does not revoke
a device that still has access. Devices without effective access are removed from
folder configurations. Removal cannot erase downloaded content. A disconnected
removed device may retain stale local membership until it receives a new signed
manifest, even though updated peers no longer share with it.

## Object Changes, Recovery, And History <!-- CHANGE -->

Each share synchronizes its signed initial snapshot, immutable collaboration records,
referenced assets, membership, and published history. The mutable local `.drawio`
projection is excluded. Ordinary edits contain changed object XML; page/model
structure changes can contain a complete diagram snapshot. <!-- CHANGE -->

Incoming records are verified and replayed locally. Native page patches preserve
unrelated unsaved work and revalidate the current user. Locally saved proposals can
later lose concurrent arbitration; their exact submitted XML remains in private
recovery copies. External or interrupted projection changes are preserved before
rebuilding. Recovery does not pause unrelated membership processing. <!-- CHANGE -->

Successful saves publish their stable ChangeMap checkpoint as immutable revision
and snapshot JSON with a unique ID, checksum, actor, and parent. Intermediate work
that was never saved remains local. No pre-sharing history is backfilled. Import
is idempotent into local SQLite, tolerates missing/out-of-order parents, keeps
divergent revision IDs, validates exports, and never republishes imported records.
The live SQLite database, drafts, and unrelated neighboring files are excluded
by a folder allowlist. Received versions use local Syncthing simple versioning.

## Background Behavior And Presence

The first successful Share/Join enables launch-at-sign-in when supported, returning
an explicit warning otherwise. Background startup creates no canvas or diagram
login session. Closing the last window keeps the tray and daemon alive; explicit
Quit shuts down the child. If no usable Linux tray is detected, an application
window remains accessible instead of an invisible background process.
After the first successful startup registration, later Shares/Joins respect a
user's decision to turn launch-at-sign-in off.

The dashboard and tray show distinct active remote users with connected approved
devices. Multiple devices for one person count once; pending users and the local
actor are excluded. Counts reflect this installation's observed connections,
including tray-only peers. Unavailable services show unknown counts, never stale
online claims.

## Verification

```text
npm run test:syncthing
```

Real process tests are opt-in and use disposable profiles without modifying the
user's Syncthing installations or startup settings:

```powershell
$env:TRELLIS_SYNCTHING_RUNTIME_TEST='1'
node --test test/trellis-syncthing-runtime.test.mjs
```

Automated Windows verification covers native daemon startup/shutdown and actual
three-device transfer after coordinator shutdown, plus service and renderer edge
cases. Release acceptance still requires native ARM64, macOS signing/notarization,
Linux desktop tray/startup, packaged Windows close-to-tray/Quit, and internet/relay
testing on separate machines. Disk-full and cross-volume failures need injected
or manual acceptance checks; failures must never be presented as successful sync.
Packaging tests cover resource placement for all six targets, vendor exclusion,
integrity failures, tray dispatch, and persistent AppImage startup commands without
altering local login settings. Service tests cover bounded crash retries and Quit
while startup requests are still pending.

Git controls, automatic coordinator takeover, mobile clients, and historical backfill
remain intentionally deferred. Planned coordinator transfer is supported by the
authenticated project-departure flow described in garden-projects-library.md. <!-- CHANGE --> Object co-editing
is available through the v2 protocol described above. <!-- CHANGE -->
