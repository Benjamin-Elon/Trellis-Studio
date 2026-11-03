# Garden Quickstart <!-- NEW -->

Quickstart teaches one working example through existing Trellis workflows. Open it from **Help → Quickstart** (Extras is used if the host has no Help menu). A dismissible offer appears when a diagram opens until the current user finishes or selects **Do not show again**. Closing the card only dismisses the current offer. Manual launching remains available after suppression or completion.

## Journeys

Creators configure a garden, add one bed, optionally connect one irrigated bed, save a self-use or sales year plan with positive demand, allocate one planting, and optionally share. User/device sharing and community sharing have independent **Skip for now** choices. Inviting a user or preparing another computer's invitation completes the user/device item; recipient approval can remain pending. Community creation or a submitted admission request completes the community item without waiting for approval.

Invitees join and open a project, then locate its garden, year plan, and plantings. They can acknowledge content that has not been created yet without modifying the diagram. Collaboration, comments, assignments, and editing coordination tutorials are outside this version.

The checklist displays its garden and planning year. Changing them explicitly preserves separate field positions, optional skips, orientation acknowledgements, and successful sharing actions. Existing committed work counts. Native undo/redo can make a practical milestone incomplete again. Draft year plans and planting previews do not count.

## Guidance and recovery

Year Planner uses seven task groups: **Year and crops**, **Growing details**, **Harvest window**, **Demand setup**, **Demand values and dates**, **Review**, and **Save**. Each group highlights related visible controls for the selected crop and one matching demand line. Demand guidance follows the most recently focused matching line, falling back to the first line for the selected crop and self-use/sales route. Manual harvest dates are highlighted only while editable. **Show fields** opens the relevant existing section or Basics tab without changing crop selection or plan values. **Back/Next** freely previews guidance; existing values never cause automatic advancement. Applying crops advances the first group; successfully adding demand through Manage packages advances Demand setup. Cancelling either picker preserves the parent group. A committed plan with positive demand completes the planning milestone; saving a draft does not. <!-- NEW -->

The header button toggles **Collapse / Expand**, exposes its expanded state to assistive technology, and keeps the move handle available. The main Year Planner companion defaults to the viewport's bottom left with a 16px inset unless the user has saved a planner position. Automatic positioning follows card/viewport size changes and avoids all highlighted targets without overwriting the preferred position. Crop and package pickers retain their independent placement rules. Other workflow companions retain the placement described below. <!-- NEW -->

**Read instructions aloud** is available throughout the active guide, initially off and saved per user on this device. It reads the current instruction when enabled and each subsequent step or guidance context once. Routine refreshes and field edits do not repeat it. **Read again** replays the current instruction. Unchecking, collapsing, closing, or changing context stops current speech; expanding reads the current instruction again when enabled. Speech uses browser/system support and its default voice. If support or voices are unavailable, the card explains this and retains written guidance. No speech service or additional dependency is required. <!-- NEW -->

The diagram has a movable, collapsible card. Use the move handle beside **Quickstart**, styled like module drag handles. Drag it or focus it and use arrow keys. Release saves the bounded position for the current user. Escape, window blur, or interruption cancels a drag and restores its starting position. Routine refreshes preserve manual placement; a new guidance target may move the card to avoid covering that control. <!-- NEW --> Within every workflow, including nested pickers, the card remains a 310px-wide draggable companion. It starts 12px to the dialog's right, or to its left when needed. If neither side fits, it floats over the dialog and avoids the highlighted control where possible. Its header stays visible while the guidance scrolls. Manual positions are saved per workflow and local user as offsets from the full dialog frame, so the companion follows dialog movement. Nested pickers have independent positions; closing them restores the parent workflow, and closing dialogs restores the canvas position. Target avoidance and viewport clamping do not overwrite preferred workflow offsets. Width shrinks only to fit the viewport. **Back/Next** advance explanations without writing field values or bypassing native validation. <!-- CHANGE -->

Layout always checks the intended garden selection. Without it, the guide highlights the garden and says **Select [garden name] to show its layout controls**. It does not silently select another garden. Missing settings, hidden or disabled controls, active modes, read-only access, delayed controls, and unavailable features have explicit prerequisite or retry instructions.

The source-to-bed irrigation milestone reads committed connectivity. It is an introductory example, not a certification of a whole irrigation design.

## Integration contract

Floating Quickstart uses the standard Trellis control layer (`10020`), below top controls (`10030`) and editor dialogs (`2000000000`). Workflow companions render directly under `document.body`, escaping transformed and clipped dialog contents. They share their owner's outer stacking layer and follow it in DOM order, remaining above the owner and below newer blocking dialogs. Recognized nested pickers take logical ownership of the same card; returning to the diagram restores the floating control layer. `getCompanion(ownerElement)` returns the active card for its owning workflow or enclosing dialog, allowing existing focus traps to include its controls without admitting the underlying editor. Escape during dragging cancels the gesture before dialog dismissal handlers run. <!-- CHANGE -->

`Garden_Quickstart.js` installs `graph.__trellisQuickstart` and `Trellis.quickstart`. Its small integration API is `show()`, `close()`, `refresh()`, `capture()`, `record(stage, capture)`, `getCompanion(ownerElement)`, and `getState()`. Only successful user/device and community actions use `record`; practical garden milestones are read from the model and the saved Year Planner repository. Captures bind asynchronous results to the current identity, diagram, page, garden, year context generation, and are rejected after a context change. <!-- CHANGE -->

Workflow controls use `data-trellis-quickstart` semantic identifiers. Workflow containers use `data-quickstart-surface` with garden/year context where relevant. Year Planner fields reuse their existing `data-year-plan-field` and demand-line identifiers. The guide observes active surfaces while open and disconnects when closed. It never stores tutorial metadata in diagram XML or shared libraries.

Year Planner exposes `data-quickstart-session`, `data-quickstart-crop`, and the current `data-quickstart-year` on its workflow card. Its internal `__trellisQuickstartView` provides `getDemandLines(route)` and `showFields(group, route, lineId)` for context and view-only revealing. Quickstart's optional `recordPlanAction(action, capture)` method accepts `crops-applied`, `demand-added`, and `plan-committed` notifications only from the matching planner session and unchanged captured guidance context. Capture before opening a picker or beginning an asynchronous explicit save; notify after the native action has succeeded. Draft persistence and mere button clicks must not notify. Completion remains derived from committed plan state. <!-- NEW -->

Projects accepts an optional named highlight request:

```js
TrellisGardenHome.showProjects(ui, {
    highlight: 'community-sharing',
    diagramId: currentDiagramId,
    communityPath: 'existing' // Or 'create'; omit to offer the choice.
});
```

Requests reuse an already-open Projects dialog. A targeted descriptor read refreshes the current project's eligibility without broad background refreshes. Both community forms preselect that project. If its descriptor is still unavailable, the form retains a disabled placeholder and prevents submitting a different newly created garden. Existing field drafts and focus survive highlight changes. Highlight intent clears on closure and account changes. A guide-triggered community handoff first uses the existing managed-sharing preparation, retaining its native confirmations.

## Persistence and verification

`positions.planGroup` stores a stable planning group identifier within the existing per-garden/year progress bindings. Legacy numeric `positions.plan` values migrate on first use, accounting for inserted sales-channel steps. `readAloud` is a device-local, identity-scoped preference. Recently focused demand-line IDs live only in the active guide session. <!-- NEW -->

Device-local preferences use `trellis.quickstart.v1:<identity>`. `position` retains canvas coordinates; `workflowPositions` stores `{x,y}` offsets keyed by semantic workflow name, with `dialog` shared by untagged dialogs. Invalid offsets fall back to automatic placement. Portable identity IDs persist across diagrams on this device. Legacy diagram users are namespaced by diagram to avoid aliasing unrelated local accounts; signed-out use has a separate preference scope. Corrupt or unavailable storage does not prevent using the guide, and persistence failures are explained in the card. <!-- CHANGE -->

Focused tests:

```powershell
node --test test/garden-quickstart.test.cjs test/quickstart-drag-electron.test.cjs test/trellis-garden-home.test.cjs test/trellis-startup-defaults.test.cjs
```

Also run `node --test test/year-planner.test.cjs test/year-planner-dom.test.cjs test/year-planner-holds.test.cjs` for native action notifications, view-only field revealing, and existing commit/draft behavior. The native Quickstart check records actual system speech availability and completion/error status in `.test-artifacts/quickstart-speech-electron.json`; controlled DOM speech tests cover replay, cancellation, refresh deduplication, and failure recovery independently of installed voices. <!-- NEW -->

The focused Electron check uses native mouse and keyboard input with the real graph and Quickstart plugin, verifying movement, refresh stability, cancellation, dialog-relative movement, nested-picker ownership, Escape priority, persistent header access, position restoration, narrow windows, and unchanged graph contents and selection. It writes `.test-artifacts/quickstart-drag-electron.png`. <!-- NEW -->

Production Electron smoke, using a temporary profile and test-only project:

```powershell
$env:TRELLIS_QUICKSTART_SMOKE = '1'
node scripts/run-production-smoke.cjs
```

The smoke covers actual plugin loading, the selection prerequisite, actual mouse dragging without graph changes, keyboard movement, saved position restoration, a narrow viewport, actual Garden Settings, Year Planner and nested crop-picker companions, Projects highlighting and project preselection, draft retention, repeated offers on reopening, suppression, and manual reopening. It writes screenshots and results under `.test-artifacts/garden-home-production/<process-id>`. Surrounding Year Planner, allocation, irrigation, references/settings, dashboard, and sharing regressions cover the reused native workflows. <!-- CHANGE -->
