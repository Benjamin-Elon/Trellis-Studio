# Equipment and workload planning

Equipment is configured once per garden, then matched to actual task types and plan context. The equipment editor opens on a tool, shows its unfinished planned tasks, and keeps suitability, time rules, maintenance, costs, and notes in disclosures. Task types are edited under **Planning settings**.

## User workflow

Choose a built-in preset or **Custom tool**, set its availability, select task types under **Helps with**, and adjust time assumptions. New additions start on the wishlist; adding a definition never claims ownership. Existing inventory and ownership are preserved.

**People required to operate this tool** groups **Minimum** and **Maximum** side by side. Both accept whole numbers of at least one; raising the minimum raises the maximum when necessary. Maximum describes supported tool operators, so additional people assigned to the task remain allowed.

A selected task offers a **Task type** dropdown and an equipment dropdown with checkboxes. **Suggested tools** are advisory. **Apply tools** saves an explicit set and changes the field to **Selected tools**. **No tools** saves an empty set; **Use suggestions** removes the explicit set without automatically applying recommended savings. An overridden task type offers **Use source task type**.

Recurring tasks ask whether to apply task-type or tool changes to **This occurrence** or **Series**. Series edits change the current planting’s saved rule and unfinished occurrences. They preserve other occurrence overrides and completed tasks, and do not modify shared recipes. Source-rule edits require a unique reciprocal planting link and permission to edit the source and affected tasks.

## Matching and estimates

**Helps with** is the authoritative matching list. Available matching tools with verified requirements rank before conditional tools, followed by total estimated time and stable name/ID ordering. Unavailable tools and unmet requirements appear separately as opportunities. Existing unsuitable or missing selections remain visible. Crop preferences, bed preferences, and capabilities do not participate in active matching or warnings.

Positive useful-scale bounds and minimum crew are checked against known plan facts. Zero bounds are unrestricted. Crew counts use distinct valid task assignees; no assignments remain unknown. Extra assignees do not violate the maximum supported operator count. Skill requirements remain conditions because operator skills are not currently structured in the plan.

New time rules can target only linked task types. Removing a link keeps its time rules saved but inactive; relinking restores their use. Task types describe broad jobs: harvesting tools can help with cutting or transport without claiming that the selected set covers every part of the task.

Explicit task quantities take precedence, including zero. Otherwise the resolver can derive one occurrence, actual plant count, planting area using the tiler’s canonical scale, or one identified bed. Unsupported quantities, such as unrecorded row length or harvest weight per occurrence, remain unknown. **Set job quantity** supplies an optional value and supported unit.

Only saved selected tools affect workload estimates. The best non-stackable rule is combined with explicitly stackable rules using the existing multiplier limits. Each usable selected tool contributes setup and cleanup once, including tools without an efficiency rule. Crew count never divides the estimate. Unmet availability, crew, and scale requirements are explained.

Saving a type, tool set, or quantity recalculates estimated hours where a supported rate and quantity exist. Otherwise the existing hours remain and the overlay explains why they were not recalculated. Planning-only value changes do not trigger board repair, change dates, repack bookings, or resize scheduled durations. Reconciliation preserves occurrence choices and recalculates authored equipment estimates.

## Persistence and API

- `relevantTaskTypes` stores direct **Helps with** links. Equipment definitions with `taskTypeLinksVersion: 1` treat that list as authoritative, including an explicit empty list.
- The internal `normalizePlanningEquipment(record, taskTypes)` compatibility helper converts unmarked definitions in memory by combining existing links, time-rule types, and historical capability matches against the same scoped registry. It does not write the graph. Explicit saves and imports persist the links and marker through the existing reference-acceptance flow.
- Historical crop, bed, and capability data round-trip in saved definitions and import/export. Capability catalog decoding and exported legacy capability helpers remain for existing consumers, but active planning does not call them. `preferenceMatches` remains zero in recommendation results for shape compatibility.
- `task_type_id` is the effective task type. `task_equipment_ids` stores effective tool IDs as a JSON array; readers also accept legacy comma-separated IDs.
- `task_planning_override_json` stores optional `taskTypeId` and `equipmentIds` fields. Missing fields inherit the source rule; `equipmentIds: null` requests suggestions; `equipmentIds: []` explicitly selects no tools. Resetting a type removes its occurrence override.
- Source rules use optional `taskTypeId` and `equipmentIds` fields. Canonical rule IDs remain stable when their type is overridden. Equipment references in reusable recipes use portable catalog dependencies.
- The equipment API exposes read-only `resolvePlanningContext`, `recommendForTask`, `estimatePlanningSelection`, and `listPlanningTasks` methods. `recommendForTask` returns context, ranked available candidates, opportunities, selections, and an estimate with conditions. The public `estimateTaskHours` helper also uses explicit selections.
- The task manager exposes `applyTaskPlanningChange(card, patch, scope)`, where scope is `occurrence` or `series`. Patches accept a task type, tool set, or task quantity. `taskTypeId: null` resets inheritance. Commands validate and prepare detached values before one undoable transaction.

Accepted consumer pins remain authoritative. The equipment editor labels its live matching list as a preview of current editor settings; private reference drafts never write task hours. Task navigation protects unsaved editor changes. Current permissions and the signed replay policy classify the new task fields as task details, without granting source-planting authority.

## Verification

Equipment, task overlays, scheduler reconciliation, permissions, and reference tests cover legacy conversion, explicit empty task links, inactive rules, operator ranges, ranking, missing context, multiple tools, series scope, regeneration, consumer pins, and real mxGraph undo/redo. `garden-equipment-electron.test.cjs` exercises the production editor and task overlay in hidden Chromium, checks keyboard disclosure and checkbox behaviour, focus retention, grouped operator controls and compact layout, and writes screenshots to `.test-artifacts/equipment-planning/`.
