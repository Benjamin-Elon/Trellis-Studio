# Garden Projects library

The splash retains its Create, Open, Support, Change license, contact, and close controls. It displays the identity session's username, independent of the name recorded on the license. Create/Open launch the same Garden Projects dialog with creation/list focus. <!-- CHANGE: removed the standalone creation button from the splash. -->

## Projects and identity controls

`TrellisGardenHome.showProjects(ui, { focus: 'create' | 'open' })` owns authentication, identity settings, the reference-city selector, search, and both project lists. Only the dialog body scrolls. Availability refreshes update the lists without rebuilding identity or creation forms. Ordinary Open routes here; Browse files opens the explicit native file picker.

Both project-creation buttons create an identity-library entry. Starter initialization uses `graph.__trellisModules.createModuleAtPoint` after Users, Tasks, and Roadmap are ready, then saves the project. Shared creation invokes `trellisShareGardenProject`, the existing Dashboard invitation flow. Failed setup offers a retry for the same project rather than creating another entry. Newly created entries carry `starterPending`; opening an interrupted creation finishes its starter. After a successful save, `completeStarter({ path })` verifies the watched registered document and durably clears that flag, so later intentional empty saves are never seeded again. Closing a creation/browser cancels late navigation, and initialization checks its document before applying changes. <!-- CHANGE -->

Private contains standalone local files and identity projects with fewer than two enabled, accepted users with canvas access. Shared requires managed sharing and at least two such users. Pending invitations are excluded. Revoked linked-user access removes the project from the accessible list. These categories never move disk folders.

## Metadata and bridges

The existing `trellisGardenLibrary` bridge retains its API names and `gardens` response for compatibility. It adds:

- `listLocal()` — direct `.drawio` children of the device's configured folder, isolating bad files and excluding conflict copies.
- `completeStarter({ path })` — finish saved starter initialization under the same watched-document authority as import.
- `selectLocalFolder()` — a native folder selection; the main process stores the resulting path.
- `cities()` — valid coordinates from the existing live city catalog, falling back to the bundled database before first initialization.
- `getReferenceCity()` / `setReferenceCity({ cityId })` — signed identity metadata; `null` clears the reference.

The default standalone folder is Documents/Trellis/Local Garden Projects. Files selected with Browse remain where they are and are not automatically imported.

Library results include classification, nullable user/seed counts, average distance, module-city summaries, cache timestamps, and per-project metadata errors. Deduplication uses both registered paths and diagram identities, so a standalone copy does not duplicate its library project. <!-- CHANGE --> Summary changes are signed into the existing catalog; reference-city records live in a separate directory under synchronized identity metadata. Authentication events and on-disk project paths retain their existing formats. Browse can isolate an unverifiable catalog record; mutation reads still require strict verification.

Each located garden module contributes one great-circle distance from the saved reference city. Repeated cities retain their per-module weighting. Bands are [0,25), [25,100), [100,500), and [500,infinity) kilometers, followed by Unknown distance. Signed cached coordinates remain usable when a device lacks a matching city, with last-known labeling. Missing metadata never becomes an invented zero.

Seeds count authorized devices reporting a complete project folder. Remote candidates must be connected and report valid folder sharing, 100% completion, no needed items, and a nonempty global folder. An eligible complete local device also counts. Paused/nonsharing peers do not count; failed or incomplete telemetry reports Unknown. Counts indicate reported data availability, not editor presence or guaranteed delivery.

## Project names and personal filenames <!-- NEW -->

Library projects keep their existing stable `diagramId` when renamed. The shared name lives in document identity metadata as `trellis_project_name`; only an active project administrator may change it. Main-process commands and signed collaboration replay enforce the same restriction, including changes made through ordinary metadata edits. Garden-module names and standalone files remain independent. <!-- NEW -->

Each identity can set an optional personal suffix, synchronized through signed `project-suffixes` metadata keyed by `diagramId`. Project rows and editor titles display `Shared name - My suffix`; an empty suffix removes the separator. Suffixes do not change roles or permissions and never enter shared XML, invitation labels, or public project descriptors. `rename({ diagramId, name })` changes the shared name; `setSuffix({ diagramId, suffix })` changes only the authenticated identity's suffix. Results expose `projectName`, `suffix`, `displayName`, actual `filename`, capabilities, and pending filename errors; the existing `name` field is the composed display name. <!-- NEW -->

Local `.drawio` filenames follow the composed name. The naming dialog previews conversion of unsupported filesystem characters. Display text is retained; portable filenames replace invalid/control characters, trim trailing dots/spaces, protect Windows reserved names, and truncate at Unicode boundaries. Shared names allow 120 characters and personal suffixes allow 80. <!-- NEW -->

New library projects use v2 local projections. Older projects require the existing administrator-led collaboration upgrade and new invitations through its existing recovery flow; adoption reuses the administrator's current library name without a second naming prompt. Legacy machine-wide projections remain neutral while the identity's own copy downloads through existing device approval. Ordinary renames preserve both document and sharing identities; only the existing upgrade changes the sharing identity. <!-- CHANGE -->

Renames are serialized with projection saves, journaled outside synchronized project data, and never overwrite a destination file. Every open editor follows the new path without reopening or replacing its unsaved model. Draft paths and recent files follow the move. Filename collisions, busy editors, and filesystem errors preserve the original and report a pending update for retry. Externally renamed files are recognized by document identity; their filenames never become shared names or personal suffixes. Administrators can rename downloaded v2 projects offline using existing collaboration conflict handling. <!-- NEW -->

## Verification

Behavioral coverage is in the project-naming, garden-home, garden-library, project-summary, startup-defaults, identity, Users, splash, module, and sharing suites. The production helper accepts `TRELLIS_GARDEN_PROJECTS_TEST=1` through `scripts/run-production-smoke.cjs`; it creates an isolated profile and verifies authentication, four starter modules, invitation handoff, classification, distance grouping, administrator renames, personal filenames, suffix privacy, saving an edit retained during a rename, keyboard focus, narrow-window layout, and painted screenshots. The identity-login Electron test separately verifies restart persistence and safe logout using the relocated controls. <!-- CHANGE -->

## Delete, Leave, and Trash <!-- NEW -->

Project rows use **Downloaded**, **Not downloaded**, or **Local file**, with aligned Open and accessible actions controls. Device-download removal and offline pinning are omitted from this dialog. The Private/Shared headings describe membership, not deletion authority. <!-- NEW -->

**Delete project** is available to the sole active, identity-linked administrator. It removes the active row and moves managed files to Trellis Trash on each paired device as it reconnects. A signed, sole-user catalog snapshot permits moving an unavailable entry to Trash without downloading it. Each device revalidates the actual roster before moving or purging bytes; changed membership preserves files and reports a conflict in Trash. Pending invitations are revoked when the holding device applies deletion. Restore never reactivates invitations. <!-- NEW -->

**Leave project** requires another connected, accessible member with a compatible client. The last administrator chooses a connected successor. A departing coordinator also hands coordination to that successor or a connected existing administrator. All remaining approved devices must have advertised handover support at least once. Unavailable telemetry never counts as a connection. The row remains marked Leaving until signed readiness, applied-membership, receipt-delivery, and finalization records complete. Other members retain the project and historical attribution. Rejoining requires a fresh invitation and approval. <!-- NEW -->

Lifecycle records live in the identity metadata directory `project-lifecycle`, separately from catalog and authentication events. Records name causal predecessors; concurrent deletion wins over restoration, and purge markers remain terminal. Startup fences retired folders before starting synchronization. Background refresh applies lifecycle records before processing old download requests. Renderer bridges add `actions`, `trash`, `restore`, `purge`, `leave`, and `listTrash`; existing active-list and catalog formats remain compatible. Older clients must be updated to honor these records. <!-- NEW -->

Managed folders move outside synchronization into the transport profile’s `project-trash`. Local move journals retain fingerprints and resume interrupted operations. Cross-volume copies must verify before removing their sources. Restore and purge failures remain visible and retryable in Trash. Trash retains data indefinitely until explicit permanent deletion; exported and disconnected copies cannot be guaranteed erased. <!-- NEW -->

Standalone files use device-local Trash under the application profile, including while signed out. Only the selected ordinary `.drawio` file moves; neighboring files and assets stay in place. Restoration uses the original directory and an editable filename, rejecting collisions without overwriting either file. <!-- NEW -->

Open editors prepare retirement through sender-correlated IPC. Unsaved remote drafts are flushed to `project-draft-recovery` in the application profile before the editor closes. An unanswered preparation or an intervening edit blocks filesystem removal. Local confirmations offer Save, Discard, or Cancel when needed. <!-- NEW -->

Coordinator transitions are membership records signed by the previously pinned coordinator. Offline peers replay the chain in version order, while the original v2 genesis key remains pinned independently. The departing peer remains a transport recipient only through receipt delivery; its editing authority is already retired. There is no automatic coordinator takeover. <!-- NEW -->
