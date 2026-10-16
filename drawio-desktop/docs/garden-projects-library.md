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

## Verification

Behavioral coverage is in the garden-home, garden-library, project-summary, startup-defaults, identity, splash, module, and sharing suites. The production helper accepts `TRELLIS_GARDEN_PROJECTS_TEST=1` through `scripts/run-production-smoke.cjs`; it creates an isolated profile and verifies authentication, four starter modules, invitation handoff, classification, distance grouping, keyboard focus, narrow-window layout, and painted screenshots. The identity-login Electron test separately verifies restart persistence and safe logout using the relocated controls.
