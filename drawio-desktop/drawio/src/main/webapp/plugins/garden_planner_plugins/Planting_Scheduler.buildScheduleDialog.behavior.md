# `buildScheduleDialog()` Behavior Contract

## Purpose

This document freezes the observable behavior of `buildScheduleDialog()` while
the scheduler is split into a dialog entrypoint plus pure scheduling cores. It
describes the current behavior rather than an intended replacement design.

Source under characterization:

- `Garden_Scheduler_Dialog.js`
- `Garden_Scheduler_Shared_Core.js`
- `Garden_Scheduler_Annual_Core.js`
- `Garden_Scheduler_Perennial_Core.js`
- `buildScheduleDialog()` remains owned by the dialog entrypoint.
- `openScheduleDialog()` remains the public `window.USL.scheduler` entrypoint.

The split is intended to preserve dialog behavior. The shared, annual, and
perennial core modules own pure scheduling calculations only; database models,
dialog DOM, task editing, graph writes, and runtime event bridges remain in
`Garden_Scheduler_Dialog.js`.

## Assumptions

- DOM controls are the immediate source of truth for editable values.
- `formState` is a mutable working snapshot and also stores derived values.
- Closure variables hold state that is absent from `formState`.
- Event handlers may overlap because several async flows are launched without
  awaiting completion.
- Existing overlap and stale-write behavior are part of the current behavior
  surface until an explicit concurrency change is approved.
- This phase does not change JavaScript behavior.

## External Inputs

`buildScheduleDialog(ui, cell, plants, cities, onSubmit, options)` receives:

| Input | Current use |
| --- | --- |
| `ui` | Dialog display, graph access, dialog close |
| `cell` | Existing selection, season, and task-template attributes; save target |
| `plants` | Initial plant selector options |
| `cities` | City selector options |
| `onSubmit` | Currently unused |
| `options.selectedPlant` | Preferred initial plant |
| `options.earliestFeasibleSowDate` | Initial sow date and earliest display |
| `options.lastHarvestDate` | Initial season and harvest end |
| `options.startNote` | Initial sow-date guidance |
| `options.initialCityName` | Preferred city |
| `options.hasPersistedSchedule` | Records whether a valid stored start exists |
| `options.initialWindowFeasible` | Initializes explicit annual feasibility state |

The caller computes the initial feasibility dates before opening the dialog. A
stored sow date and stored harvest end can override those initial values.

## Rendered Structure

The dialog uses two tabs.

### Schedule tab

1. Inline error bar
2. Schedule Context
   - Season start year
   - City
3. Crop
   - Plant selector, add action, edit action
   - Variety selector, add action, edit action
   - Variety status
4. Method
   - Planting method category
   - Planting method
5. Sowing Window
   - Derived sowing-season selector
   - Active window date bounds
   - Season end or perennial lifespan end
   - Explain Sowing Range action
6. Timeline
   - Earliest and latest labels
   - Selected-date marker
   - Validity status
7. Planting
   - Sow date or planting date
   - Harvest window days
   - Minimum yield multiplier
8. Harvest
   - First harvest
   - Last harvest
   - Days to first harvest
9. Preview, Save, and Cancel actions

### Tasks tab

1. Current method and template source
2. Add Task action
3. Task-rule list with edit and delete actions
4. Inline task editor
5. Clear override and plant default action
6. Restore built-in tasks action
7. Save tasks as plant default checkbox

### Mode-dependent rendering

For perennial plants:

- "Sow date" becomes "Planting date".
- "Season end date" becomes "Lifespan end".
- Feasibility-window rows are hidden.
- Timeline is hidden.
- Harvest rows are hidden.
- Explain Sowing Range is hidden.
- Lifespan end is editable.

For non-perennial plants:

- Annual labels and sections are shown.
- Season end is disabled.

## State Inventory

### Editable state mirrored between DOM and `formState`

| State | DOM control | `formState` key |
| --- | --- | --- |
| Plant | `plantSel` | `plantId` |
| Variety | `varietySel` | `varietyId` |
| City | `citySel` | `cityName` |
| Method category | `methodCategorySel` | `methodCategoryId` |
| Method | `methodSel` | `methodId` |
| First sow/planting date | `startInput` | `startISO` |
| Season/lifespan end | `seasonEndInput` | `seasonEndISO` |
| Season start year | `seasonYearInput` | `seasonStartYear` |
| Harvest window | `harvestWindowInput` | `harvestWindowDays` |
| Minimum yield | `minYieldMultInput` | `minYieldMultiplier` |

`syncStateFromControls()` copies all listed controls into `formState`.

`syncControlsFromState()` has selective `start`, `end`, and `harvest` writes. It
does not fully synchronize every editable control.

### Derived schedule state in `formState`

| Key | Writer |
| --- | --- |
| `sowingSeasons` | `recomputeAnchors()` |
| `activeSowingSeasonId` | `recomputeAnchors()` and the window selector |
| `firstHarvestISO` | Anchor reset, perennial flow, schedule recomputation |
| `lastHarvestISO` | Anchor calculation, perennial flow, schedule recomputation |
| `lastScheduleEndISO` | Perennial flow or schedule recomputation |
| `lastHarvestSource` | Initialized as `auto`; perennial recomputation sets `user` |

### Closure-owned domain state

| State | Responsibility |
| --- | --- |
| `plantsLocal` | Current plant option records |
| `selPlant` | Selected base plant |
| `effectivePlant` | Base plant merged with selected variety overrides |
| `mode` | Current perennial flag |
| `currentVarieties` | Varieties loaded for the selected base plant |
| `currentAllowedMethodCategories` | Allowed categories for the selected plant |
| `currentMethods` | Methods loaded for the selected category |

### Closure-owned interaction state

| State | Responsibility |
| --- | --- |
| `hasPersistedSchedule` | Identifies a valid graph-loaded start until an automatic replacement |
| `userEditedStartThisSession` | Identifies an explicit start edit in the open dialog |
| `taskTemplate` | Current normalized task template |
| `taskRules` | Editable task rules |
| `taskTemplateSource` | Cell, plant, method, none, or unknown |
| `taskDirty` | Indicates an edited task-rule override |
| `taskTemplateResetRequested` | Requests removal of the cell override on save |
| `plantDefaultTaskDeleteRequested` | Requests deletion of the plant default |

## Initialization Sequence

The current order is significant:

1. Copy the supplied plant list.
2. Build the Schedule tab sections and plant selector.
3. Resolve the initial plant.
4. Load method categories and methods for the base plant.
5. Build date, season, harvest, and task controls.
6. Create `formState`.
7. Load varieties and validate the stored variety.
8. Resolve `effectivePlant`.
9. Reload method categories and methods using current preferences/defaults.
10. Build and append schedule rows.
11. Register event handlers.
12. Build Preview, Save, and Cancel actions.
13. Run `recomputeAll('cityChanged')`.
14. Apply mode rendering, date bounds, and timeline rendering.
15. Resolve the initial task template.
16. Build the Tasks tab.
17. Render the initial task list.
18. Show the dialog.

The initial schedule recomputation occurs before the Tasks tab DOM and
`refreshTaskTemplateFromSelection()` dependencies are fully initialized.

## Update Policies

`recomputeAll(reason)` currently defines the schedule policy:

| Reason | Anchor call | Start overwrite | End overwrite | Schedule recompute |
| --- | --- | --- | --- | --- |
| `plantChanged` | `recomputeAnchors(true, true)` | Yes | Yes | Yes |
| `varietyChanged` | `recomputeAnchors(true, true)` | Yes | Yes | Yes |
| `yearChanged` | `recomputeAnchors(true, true)` | Yes | Yes | Yes |
| `cityChanged` | `recomputeAnchors(false, false)` | Only when sow is clean | No | Yes |
| `methodChanged` | `recomputeAnchors(false, false)` | Only when sow is clean | No | Yes |
| `startChanged` | `recomputeAnchors(false, false)` | No after dirty flag | No | Yes |
| `hwChanged` | `recomputeAnchors(false, false)` | Only when sow is clean | No | Yes |

After a recognized non-perennial reason, `recomputeAll()` renders start, end,
harvest, bounds, note, and timeline.

For perennials, `recomputeAll()`:

1. Computes lifespan end from the planting date and lifespan years.
2. Writes the end into the DOM and `formState`.
3. Clears first harvest.
4. Keeps harvest values null and uses lifespan end only as the schedule end.
5. Updates harvest display, bounds, and timeline.
6. Returns before the reason switch.

## Event Flow Matrix

The order below is the current call order.

### Plant selection change

1. Resolve the selected base plant from `plantsLocal`.
2. Set `selPlant`, plant label, `mode`, and `formState.plantId`.
3. Load varieties, select the base plant, and clear `varietyId`.
4. Resolve `effectivePlant`.
5. Load allowed method categories.
6. Load methods for the selected category.
7. Copy selected method values into `formState`.
8. Reset harvest window to the effective plant default.
9. Synchronize controls into `formState`.
10. Apply perennial or non-perennial mode mutation.
11. Run `recomputeAll('plantChanged')`.
12. Refresh the task template.

### Variety selection change

1. Update variety button state.
2. Synchronize controls into `formState`.
3. Resolve `effectivePlant`.
4. Reload allowed method categories.
5. Reload methods.
6. Reset harvest window to the effective plant default.
7. Run `recomputeAll('varietyChanged')`.
8. Refresh the task template.

### Method category change

1. Synchronize controls into `formState`.
2. Reload methods for the category.
3. Synchronize controls again.
4. Run `recomputeAll('methodChanged')`.
5. Refresh the task template.
6. Render the Tasks header.

### Method change

1. Synchronize controls into `formState`.
2. Run `recomputeAll('methodChanged')`.
3. Refresh the task template.
4. Render the Tasks header.

### City change

1. Launch an async wrapper.
2. Run `recomputeAll('cityChanged')`.

The event listener itself does not return the wrapper promise.

### Season year input

1. Launch `recomputeAll('yearChanged')`.

The returned promise is not awaited by the handler.

### First sow/planting date input

1. Set `userEditedStartThisSession`.
2. Synchronize controls into `formState`.
3. For perennials, recompute lifespan end and update the note.
4. For non-perennials, launch `recomputeAll('startChanged')`.

The non-perennial recomputation promise is not awaited by the handler.

### Season/lifespan end input

1. Synchronize controls into `formState`.

### Harvest window input

1. Synchronize controls into `formState`.
2. Run `recomputeAll('hwChanged')`.
3. Refresh the task template.

### Minimum yield input

1. Synchronize controls into `formState`.
2. Recompute the schedule-derived harvest dates.

### Plant add

1. Open the plant editor in add mode.
2. Reload plant options.
3. Select the saved plant.
4. Dispatch a synthetic plant `change` event.

The synthetic event's async listener is not awaited by `dispatchEvent()`.

### Plant edit

1. Synchronize controls into `formState`.
2. Open the plant editor.
3. Call `afterPlantOrVarietySaved()`.
4. Reload plants and select the preferred plant.
5. Dispatch a synthetic plant `change` event.
6. Continue independently by synchronizing state.
7. Reload and select the preferred variety.
8. Resolve the effective plant.
9. Reload method categories and methods.
10. Run `recomputeAll('plantChanged')`.
11. Refresh the task template.

Steps 5 and 6 begin overlapping update chains.

### Variety add/edit

1. Synchronize controls into `formState`.
2. Open the plant editor in variety mode.
3. Reload variety options and select the saved variety.
4. Synchronize controls.
5. Resolve the effective plant.
6. Reload method categories and methods.
7. Run `recomputeAll('varietyChanged')`.
8. Refresh the task template.

### Task template refresh

1. Synchronize controls into `formState`.
2. Render the Tasks header.
3. Stop when the cell has an override or `taskDirty` is true.
4. Resolve the template for current plant and method.
5. Replace template source and task rules.
6. Clear the task editor.
7. Render the task list and header.

### Preview

1. Synchronize controls into `formState`.
2. Build `ScheduleInputs`.
3. Compute schedule rows.
4. Show an inline error when no rows exist.
5. Otherwise render the preview table.

### Save

1. Synchronize controls into `formState`.
2. Build `ScheduleInputs`.
3. Normalize current task rules into a version 2 template.
4. Compute and validate the schedule before mutation.
5. Derive cell task-template persistence intent.
6. Apply the graph mutation in an mxGraph model transaction.
7. Persist or delete the plant task default after graph mutation.
8. Roll back the graph edit when later database persistence fails.
9. Emit tasks for the saved plan.
10. Close the dialog.

### Cancel

1. Close the dialog.

No graph or task-template persistence occurs.

## Schedule Computation Side Effects

`recomputeAnchors()`:

- Loads effective plant and city data.
- Computes the climate feasibility window.
- Writes feasibility and auto-harvest values into `formState`.
- May overwrite start and season end according to policy flags.
- Writes feasibility, date, harvest, note, and bounds DOM.
- Catches errors and writes the inline error bar.

`recomputeLastHarvestFromSchedule()`:

- Rebuilds schedule inputs from current state.
- Computes a single planting schedule.
- Writes first harvest, last schedule end, and last harvest.
- Writes harvest DOM.
- Logs and suppresses computation errors.

## Save Mutation Surface

The graph save path can mutate:

- `task_template_json`
- `season_start_year`
- `gdd_to_maturity`
- `days_maturity`
- `variety_id`
- `variety_name`
- `start_cooling_threshold_c`
- `label`
- `plant_id`
- `plant_name`
- `plant_abbr`
- `city_name`
- `method_category_id`
- `method_id`
- `tbase_c`
- `sow_date`
- `germ_date`
- `transplant_date`
- `maturity_date`
- `harvest_start`
- `harvest_end`
- `lifespan_start`
- `lifespan_end`
- `plant_yield`
- `yield_unit`
- plant-spacing attributes written by `applyPlantSpacingToGroup()`

Additional save effects:

- Retiles and refreshes the group.
- May save or delete a plant-and-method task-template database row.
- Dispatches the `tasksCreated` window event.
- Snapshots every attribute in the schedule patch and restores the snapshot when
  graph mutation, task-default persistence, or task emission fails.
- Retiles only after persistence and task emission succeed.

## Known Concurrency Surface

There is currently no request token, cancellation, queue, or stale-result check.
The following operations can overlap:

- Rapid plant, variety, city, method, year, date, and harvest-window changes.
- Synthetic plant change plus the remaining `afterPlantOrVarietySaved()` flow.
- Schedule recomputation plus task-template resolution.
- Multiple task-template resolutions from rapid method changes.

Potential stale commits include:

- `effectivePlant`
- variety options
- method category and method options
- feasibility dates
- harvest dates
- task template source and rules
- rendered headers and timelines

These are documented current risks. Phase 1 does not intentionally preserve a
specific stale-write result because completion order depends on asynchronous
latency.

## Refactor Invariants

Unless a behavior change is separately approved:

1. Preserve the event-specific start/end overwrite policies.
2. Preserve perennial label, visibility, date, and disabled-state behavior.
3. Preserve plant and variety default selection behavior.
4. Preserve method preference and fallback ordering.
5. Preserve persisted-start and session-edit intent as separate state.
6. Preserve cell-template precedence over plant and method task templates.
7. Preserve dirty task rules across selection refreshes.
8. Preserve preview validation and error messages.
9. Preserve validation-before-graph-mutation behavior.
10. Preserve graph rollback when plant task-default persistence fails.
11. Preserve the saved attribute set and `tasksCreated` event.
12. Preserve no-mutation Cancel behavior.

## Phase 2 Implementation

Phase 2 partitions state without changing event orchestration:

- `dialogState.selection`
- `dialogState.scheduleInputs`
- `dialogState.scheduleDerived`
- `dialogState.taskEditor`
- `dialogState.async`

The existing flat `formState` contract remains as a compatibility facade over
the first three partitions. Existing scheduler helpers therefore retain their
input shape while state ownership becomes explicit.

DOM synchronization is divided into:

- `syncSelectionStateFromDom()`
- `syncScheduleInputStateFromDom()`
- `syncStateFromDom()`
- `renderScheduleInputDates()`
- `renderFeasibilityWindow()`
- `renderHarvestResults()`
- `renderModeSections()`
- `renderStartDateBounds()`
- `renderDaysToFirstHarvest()`
- `renderStartNote()`
- `renderTimeline()`
- `syncDomFromState()`

`dialogState.async.updateVersion` is reserved for the next orchestration phase.
It is intentionally unused in Phase 2 so async behavior remains unchanged.

## Phase 3 Implementation

Phase 3 introduces `runUpdateFlow(reason, options)` as the single owner of
selection-driven and schedule-driven update chains.

The orchestrated reasons are:

- `plantChanged`
- `varietyChanged`
- `methodCategoryChanged`
- `methodChanged`
- `cityChanged`
- `yearChanged`
- `startChanged`
- `seasonEndChanged`
- `hwChanged`
- `minYieldChanged`

Plant and variety add/edit actions invoke the orchestrator directly. The
schedule dialog no longer uses synthetic plant `change` events to start async
work.

The existing `recomputeAll(reason)` policy remains in place beneath the
orchestrator. Step-object conversion belongs to Phase 4.

### Async update protection

Each `runUpdateFlow()` call increments `dialogState.async.updateVersion` and
receives an `isCurrent()` guard. Async loaders fetch into local variables and
check the guard before committing:

- effective plant
- variety options
- method-category options
- method options
- feasibility results
- schedule-derived harvest results
- task-template results

The Tasks-tab refresh snapshots the current version. It does not increment the
version, so opening the tab does not cancel an active schedule update.

Race behavior therefore changes intentionally: stale async results are ignored
instead of overwriting a more recent user selection.

## Phase 4 Implementation

Phase 4 replaces reason branches with explicit named steps.

`UPDATE_FLOWS` maps each reason to an ordered sequence:

| Reason | Steps after `readDomState` |
| --- | --- |
| `plantChanged` | Prepare plant selection, compute replacing anchors, refresh tasks |
| `varietyChanged` | Prepare variety selection, compute replacing anchors, refresh tasks |
| `methodCategoryChanged` | Reload methods, compute preserving anchors, refresh tasks, render task header |
| `methodChanged` | Compute preserving anchors, refresh tasks, render task header |
| `cityChanged` | Compute preserving anchors |
| `yearChanged` | Compute replacing anchors |
| `startChanged` | Prepare start date, compute preserving anchors |
| `seasonEndChanged` | No additional step |
| `hwChanged` | Compute preserving anchors, refresh tasks |
| `minYieldChanged` | Compute harvest only |

The named step vocabulary is:

- `readDomState`
- `preparePlantSelection`
- `prepareVarietySelection`
- `reloadMethodsForCategory`
- `prepareStartDate`
- `computeReplacingAnchors`
- `computePreservingAnchors`
- `computeHarvestOnly`
- `refreshTaskTemplate`
- `renderTaskHeader`

`executeUpdateSteps()` runs the flow sequentially and stops when a step fails,
becomes stale, or explicitly completes the flow. Perennial start-date handling
uses explicit early completion.

The former `recomputeAll(reason)` switch has been removed.
`recomputeScheduleWithAnchorPolicy()` now receives the start/end overwrite
policy directly.

## Phase 5 Implementation

Phase 5 groups the established steps and private helpers behind five
closure-local controllers:

### `plantVarietyController`

Owns:

- Plant-selection preparation
- Variety-selection preparation
- Effective plant resolution
- Variety loading and button state
- Annual/perennial mode application and rendering

### `methodController`

Owns:

- Allowed method-category loading
- Method loading for a category
- Method-category selection preparation

### `anchorWindowController`

Owns:

- Start-date preparation
- Feasibility-anchor recomputation
- Feasibility-window, date-bound, and start-note rendering

### `harvestTimelineController`

Owns:

- Full schedule recomputation
- Harvest-only recomputation
- Harvest-result, days-to-harvest, and timeline rendering

### `taskTemplateController`

Owns:

- Task-template refresh for the current selection
- Task header rendering
- Task-rule list rendering

The controllers remain inside `buildScheduleDialog()` so they can use the
existing closure state without introducing broad dependency objects. Low-level
functions remain private implementation details. Initialization and update-step
handlers consume controller methods.

This phase does not split controllers into separate files. A file-level split
would require explicit interfaces for DOM references, model services, state,
and rendering, increasing the behavioral surface during this refactor.

## Phase 6 Implementation

Phase 6 applies version and lifecycle guards at the centralized async
boundaries.

### Update-flow protection

Every `runUpdateFlow()` invocation owns an update version. A step may commit
state or DOM changes only while:

- Its update version is still current.
- The schedule dialog is active.
- The mounted dialog root remains connected.

A newer update invalidates every older update flow.

### Named operation protection

Independent async actions use per-operation versions:

- Plant editor
- Variety editor
- Feasibility explanation
- Preview
- Save
- Restore built-in tasks
- Task editor
- Task-rule save
- Reset tasks
- Tasks-tab loading

Starting another operation with the same name invalidates the previous
continuation. Selection-dependent operations also capture the current update
version, so a plant, variety, method, city, year, or schedule change invalidates
their pending result.

### Dialog lifecycle

Save and Cancel close the dialog through `closeScheduleDialog()`, which
invalidates all pending work before calling `ui.hideDialog()`.

A `MutationObserver` also detects removal performed outside those controls.
This covers replacement by another draw.io dialog and other host-driven closes.
The observer is disconnected when the dialog becomes inactive.

### Save isolation

Save now:

- Rejects duplicate clicks while a save is running.
- Captures plant, method, task-template, and override intent in a snapshot.
- Uses the snapshot inside deferred persistence callbacks.
- Stops before graph mutation if its selection or dialog lifecycle becomes
  stale.

Once graph mutation begins, the existing graph transaction and database
rollback behavior remains responsible for atomicity.

### Intentional race behavior

Stale results are ignored instead of overwriting newer state. This applies to
editor returns, schedule updates, previews, explanations, task-template loads,
and task-rule validation.

The underlying model operations are not physically canceled. They may finish
in the background, but their stale results cannot update the dialog.

## Phase 7 Implementation

Phase 7 extracts save and apply responsibilities from the Save button callback.

### Dialog orchestration

`runSaveFlow()` remains inside `buildScheduleDialog()` and owns only
dialog-specific behavior:

- Reject duplicate saves.
- Start the guarded `save` operation.
- Disable and restore the Save button.
- Synchronize DOM values into state.
- Build the schedule context.
- Present errors while the dialog operation remains current.
- Close the dialog after a successful application.

### Save snapshot

`createScheduleSaveSnapshot()` captures the persistence inputs before graph
mutation:

- Plant ID
- Method ID
- Save-default intent
- Delete-default intent
- Normalized task template
- Cell-level task-template override value

Later persistence reads only this snapshot. It does not read mutable dialog
state.

### Default persistence

`persistScheduleTaskDefault()` owns the plant-default decision:

- Save the normalized template when Save as default is selected.
- Delete the plant default when reset requested deletion.
- Perform neither operation for an unchanged override.

The method requirement for saving a plant default remains unchanged.

### Schedule application

`applyScheduleSave()`:

1. Computes and validates the complete schedule.
2. Rechecks the Phase 6 operation token before graph mutation.
3. Calls `applyScheduleToGraph()` with the computed result and snapshot.
4. Supplies default persistence through `afterGraphUpdate`.

Database persistence therefore still occurs after graph mutation succeeds.
`applyScheduleToGraph()` retains responsibility for rolling back the graph edit
when the deferred database operation fails.

### Boundaries and residual risk

Detailed graph mutation, cell attribute writes, and task emission remain in
`applyScheduleToGraph()`. Splitting that transaction during this phase would
increase rollback risk and expand the behavioral surface.

Once graph mutation starts, cancellation remains intentionally disabled. The
transaction completes or follows its existing rollback path.

## Architecture Consolidation

This section supersedes the transitional Phase 2 through Phase 7 ownership
descriptions where they conflict with the final implementation.

### Canonical state

`dialogState` is the sole dialog-state owner:

- `selection` owns plant, variety, city, method category, and method IDs.
- `scheduleInputs` owns editable schedule constraints and dirty intent.
- `scheduleDerived` owns computed feasibility and harvest values.
- `taskEditor` is passed exclusively to the task subsystem.
- `async` owns update versions and save locking.

The flat `formState` compatibility facade has been removed.
`buildScheduleContextFromState()` receives `selection` and `scheduleInputs`
explicitly.

### Control planes

Every mutation-producing dialog event enters one of four paths:

- Schedule and selection events call `runUpdateFlow(reason)`.
- Task actions enter the task subsystem's private `runTaskFlow(reason)`.
- Save calls `createScheduleSaveCoordinator().coordinate()`.
- Cancel and successful save call `closeScheduleDialog()`.

Tab switching, focus restoration, and task-editor field visibility remain
view-only interactions.

### Subsystems

`createPlantVarietySubsystem()` owns:

- Plant and variety lists
- Selected and effective plant references
- Plant/variety editor return handling
- Plant and variety reconciliation
- Mode derivation
- Plant/variety selector rendering

Method reconciliation remains an injected callback because methods are a
downstream dependency of the selected effective plant.

`createTaskSubsystem()` owns:

- Task-template initialization and selection refresh
- Task state and dirty/reset/delete intent
- Header and list rendering
- Inline editor construction and validation
- Add, edit, delete, reset, and restore command flows
- Task contribution to the schedule-save snapshot

Its public surface is `root`, `refreshFromSelection()`, `render()`, and
`getSaveSnapshot()`.

### Prepare, compute, and render

Update flows use explicit responsibilities:

- `prepare*` functions read or reconcile input state.
- `compute*` functions update derived state.
- `renderSelectionMode()` updates selectors, labels, mode, and defaults.
- `renderWindowState()` updates dates, bounds, feasibility values, and notes.
- `renderHarvestTimeline()` updates harvest results and timeline status.
- The task subsystem's `render()` updates its header, list, and requested
  editor cleanup.

Async plant, variety, and method loaders commit state only. Their selector DOM
updates occur in `renderSelectionMode()`.

### Async guards

`createAsyncGuardRegistry()` supplies every asynchronous flow with the same
guard interface:

```text
guard.isCurrent()
```

The registry supports update-version guards, named operation scopes, and
global invalidation on close. Async continuations check their guard after
awaited work and before committing state or DOM.

### Save coordination

`createScheduleSaveCoordinator()` owns:

- Duplicate-save locking
- DOM-to-state synchronization
- Schedule-context construction and validation
- Task snapshot collection
- Graph application
- Deferred task-default persistence
- Error presentation
- Successful dialog close

The Save button delegates directly to `coordinate()`.

Graph mutation still precedes task-default persistence. A persistence failure
uses the explicit attribute snapshot restoration path. Once graph mutation
begins, the operation completes or compensates rather than being canceled.

## Reliability Contracts

### Auto-window results

`computeAutoStartEndWindowForward()` returns:

- `feasible: true` with concrete feasibility and harvest dates.
- `feasible: false` with every derived date set to `null`.
- `harvestEndSemantics: "exclusive"` in both cases.

The dialog renders `No feasible window.` for an infeasible annual window. It
does not place scan-start or scan-end fallback dates into editable schedule
state. A persisted or session-edited start remains visible for correction, but
Preview and Save reject the infeasible schedule.

### Harvest end

Annual `harvestEnd` is an exclusive boundary. A seven-day window beginning
May 1 ends May 8, representing `[May 1, May 8)`. A zero-day window has equal
start and end dates.

### Lifecycle result shapes

Schedule computation returns a discriminated result:

- `kind: "annual"` includes maturity and harvest stages.
- `kind: "perennial"` includes `lifespanStartISO` and `lifespanEndISO`.

Perennial timelines retain only the planting date. Germination, transplant,
maturity, and harvest values are null. Perennial persistence writes
`sow_date`, `lifespan_start`, and `lifespan_end` while clearing annual stage
attributes. Annual persistence clears stale lifespan attributes.

### Compact lifecycle timeline

The Schedule tab Timeline section renders annual and biennial schedules only.
Perennial schedules keep the Timeline section hidden because the perennial core
does not compute germination, transplant, maturity, or harvest milestones.

The compact timeline uses the full lifecycle scan range for the selected season
year and crop lifecycle. It shows all feasible sowing seasons as background
bands, a subtle Today marker when today falls inside the range, and visible
milestones for sowing, transplant when applicable, first harvest, and harvest
end. Germination and maturity remain available in the exact-date details text
and marker tooltips so crowded compact layouts do not drop stage dates.

Milestone labels are stacked into a bounded number of rows. This keeps the
right-column Timeline section stable for short crops and dense milestone dates,
but close dates can still be visually compressed on the season-scale track. The
details text is the exact-date fallback.

Clicking the sow milestone focuses the existing sow date field. Non-sow
milestones with a task rule whose start anchor matches the milestone show a
small task dot. Clicking one refreshes the Tasks tab and opens the first
matching rule in the same deterministic display order used by the task list.
Generated task occurrences are not edited directly from the timeline.
Task-dot state is recomputed after the task preview refresh so generated
occurrence dates influence the same deterministic display order. // ADDED

### Identifier normalization

`normId()` trims and lowercases method-category and method identifiers. DB
rows, lookup inputs, defaults, selector values, task-template keys, graph
attributes, and schedule inputs use the normalized form. Case-insensitive SQL
lookups prefer an already-lowercase row when invalid case-only duplicates
exist.

### Graph compensation

Save builds one explicit attribute patch and snapshots the prior presence and
value of every patched attribute. Failures during graph mutation, deferred DB
persistence, or task emission restore that snapshot in a new graph-model
transaction. Attributes that were originally absent are removed rather than
restored as empty strings.

Retiling occurs only after required persistence and task emission succeed.
Compensation cannot undo a committed DB write or side effects already performed
by external task-event listeners.
