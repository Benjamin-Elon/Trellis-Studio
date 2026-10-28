# Garden Quickstart <!-- NEW -->

Quickstart teaches one working example through existing Trellis workflows. Open it from **Help → Quickstart** (Extras is used if the host has no Help menu). A dismissible offer appears when a diagram opens until the current user finishes or selects **Do not show again**. Closing the card only dismisses the current offer. Manual launching remains available after suppression or completion.

## Journeys

Creators configure a garden, add one bed, optionally connect one irrigated bed, save a self-use or sales year plan with positive demand, allocate one planting, and optionally share. User/device sharing and community sharing have independent **Skip for now** choices. Inviting a user or preparing another computer's invitation completes the user/device item; recipient approval can remain pending. Community creation or a submitted admission request completes the community item without waiting for approval.

Invitees join and open a project, then locate its garden, year plan, and plantings. They can acknowledge content that has not been created yet without modifying the diagram. Collaboration, comments, assignments, and editing coordination tutorials are outside this version.

The checklist displays its garden and planning year. Changing them explicitly preserves separate field positions, optional skips, orientation acknowledgements, and successful sharing actions. Existing committed work counts. Native undo/redo can make a practical milestone incomplete again. Draft year plans and planting previews do not count.

## Guidance and recovery

The diagram has a movable, collapsible card. Use the move handle beside **Quickstart**, styled like module drag handles. Drag it or focus it and use arrow keys. Release saves the bounded position for the current user. Escape, window blur, or interruption cancels a drag and restores its starting position. Routine refreshes preserve manual placement; a new guidance target may move the card to avoid covering that control. <!-- NEW --> Within a workflow, the card becomes a compact, docked guide inside that workflow's container and hides its drag handle. <!-- NEW --> **Back/Next** advance explanations without writing field values or bypassing native validation.

Layout always checks the intended garden selection. Without it, the guide highlights the garden and says **Select [garden name] to show its layout controls**. It does not silently select another garden. Missing settings, hidden or disabled controls, active modes, read-only access, delayed controls, and unavailable features have explicit prerequisite or retry instructions.

The source-to-bed irrigation milestone reads committed connectivity. It is an introductory example, not a certification of a whole irrigation design.

## Integration contract

`Garden_Quickstart.js` installs `graph.__trellisQuickstart` and `Trellis.quickstart`. Its small integration API is `show()`, `close()`, `refresh()`, `capture()`, `record(stage, capture)`, and `getState()`. Only successful user/device and community actions use `record`; practical garden milestones are read from the model and the saved Year Planner repository. Captures bind asynchronous results to the current identity, diagram, page, garden, year context generation, and are rejected after a context change.

Workflow controls use `data-trellis-quickstart` semantic identifiers. Workflow containers use `data-quickstart-surface` with garden/year context where relevant. Year Planner fields reuse their existing `data-year-plan-field` and demand-line identifiers. The guide observes active surfaces while open and disconnects when closed. It never stores tutorial metadata in diagram XML or shared libraries.

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

Device-local preferences use `trellis.quickstart.v1:<identity>`. Portable identity IDs persist across diagrams on this device. Legacy diagram users are namespaced by diagram to avoid aliasing unrelated local accounts; signed-out use has a separate preference scope. Corrupt or unavailable storage does not prevent using the guide, and persistence failures are explained in the card.

Focused tests:

```powershell
node --test test/garden-quickstart.test.cjs test/quickstart-drag-electron.test.cjs test/trellis-garden-home.test.cjs test/trellis-startup-defaults.test.cjs
```

The focused Electron check uses native mouse and keyboard input with the real graph and Quickstart plugin, verifying movement, refresh stability, cancellation, docking, position restoration, narrow windows, and unchanged graph contents and selection. It writes `.test-artifacts/quickstart-drag-electron.png`. <!-- NEW -->

Production Electron smoke, using a temporary profile and test-only project:

```powershell
$env:TRELLIS_QUICKSTART_SMOKE = '1'
node scripts/run-production-smoke.cjs
```

The smoke covers actual plugin loading, the selection prerequisite, actual mouse dragging without graph changes, keyboard movement, saved position restoration, a narrow viewport, Projects highlighting and project preselection, draft retention, repeated offers on reopening, suppression, and manual reopening. It writes screenshots and results under `.test-artifacts/garden-home-production/<process-id>`. Surrounding Year Planner, allocation, irrigation, references/settings, dashboard, and sharing regressions cover the reused native workflows.
