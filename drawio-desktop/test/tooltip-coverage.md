# Trellis button tooltip coverage

This inventory covers Trellis-owned buttons and button-like clickable controls in
`drawio/src/main/webapp/plugins/garden_planner_plugins`. Inherited draw.io controls
are outside this pass. Each group below was manually reviewed in source, including
control creation, handlers, refresh paths, and dynamically generated rows.
Application hover verification remains pending as described below.

## Eligibility and wording

- Give icon-only, ambiguous, state-dependent, disabled, and consequential actions a
  useful native `title`. Describe the action and affected object; include scope or
  consequences when they matter.
- Disabled actions explain the prerequisite or boundary. Refresh the title where
  enabled, selected, expanded, or preview state changes, including reused controls.
- Keep existing useful descriptions and specialized hover content. Do not add a
  native tooltip that competes with an existing explanatory popover.
- Give icon-only controls a concise accessible name separately from explanatory
  tooltip text. Native titles do not generally appear on keyboard focus; essential
  instructions must also be visible in the interface.
- Clear dismissal labels such as Cancel and Close, descriptive menu entries, plain
  tabs, labeled input controls, and noninteractive status text may omit redundant
  tooltips. A dismissal that discards a draft still explains that consequence.
- Use explicit local descriptions and existing `title` support. No automatic
  label-to-tooltip fallback, global API, or dependency was introduced.

## Reviewed control inventory

All rows have completed source review. “Preserved” means existing useful tooltips
or specialized explanatory content were retained.

| Plugin / group | Reviewed controls and state paths | Coverage / justified omissions |
| --- | --- | --- |
| Allocate Planner: HUD | Crop chooser, actionable-week arrows, find best bed, rotate, create, exit | Action and target titles; crop, search, preview and structural-failure prerequisites refresh in the HUD. Arrows have separate accessible names. Existing exit/chooser help preserved. |
| Allocate Planner: review | Edit, Create, Create anyway, Cancel | Explain preview editing and creation consequences; ordinary Cancel omitted. |
| Bed Succession Navigator | Previous/next planting arrows, select planting, select bed, occupancy/coverage details | Native arrow descriptions and concise image accessible names; existing bed, occupancy and detail help preserved. Read-only timeline annotations omitted. |
| Garden Beds | Conditions, copy/paste/clear, Save, defaults, Cancel | Explain selected-bed effects, pasted conditions and defaults; preserve existing conditions help. Cancel omitted. |
| Plant Tiler: garden settings | City picker/manage/save, garden Save/OK, spacing OK, Cancel | Explain climate, saved city and spacing effects; plain Cancel omitted. |
| Plant Tiler: canvas overlays | Garden settings, bed/module creation, selection-sensitive actions | Settings description added; existing selection and disabled prerequisite titles preserved. |
| Modules Standalone | Create each module type, team/role controls, permissions, margins, defaults | Explicit module targets and margin/default effects; ordinary Close/Cancel omitted. |
| Garden Dashboard | Garden picker rows, previous/next year, dashboard actions | Picker target descriptions and year-arrow accessible names; existing year and action titles preserved. Summary values omitted. |
| Task Manager: dialogs | Single/bulk card Save, hour Save, assignment Apply/Cancel | Explain affected selected cards, work hours and role assignments; Cancel omitted. |
| Task Manager: board controls | Week arrows, Today/This Week, full/week toggle, columns toggle, End Day/Week, Edit Hours, Add Break | Toggle titles refresh with state. End actions explain unfinished tasks becoming incomplete. Week arrows have accessible names. Labeled visibility checkboxes omitted. |
| Task Manager: lane paging | Retained Previous/Next page controls in full/week modes | Titles are “Previous page” / “Next page” when available and first/last-page explanations when disabled; refresh follows paging and reused lane context. Accessible names remain concise. |
| Task Manager: selection overlays | Day hours/open/close/break, module board/margins, edit/assign, TODO/DOING/DONE, allocate, reset dates, clear notes | Describe selected targets and destructive effects; existing disabled role-link prerequisite preserved. Hidden actions stay hidden. |
| Task Manager: assignees | Avatar expansion/collapse, overflow, role navigation, assignment picker | Collapse/overflow descriptions added; existing role names and assignment help preserved. Plain search/input labels omitted. |
| Scheduler: crop and city pickers | Picker triggers, add/edit plant, add/edit variety, results | Explicit picker/action scope; variety prerequisites refresh after selection changes. Descriptive search results and existing suitability content preserved. |
| Scheduler: plant editor | Plant/variety Save, add/remove growth stage, collapsible sections, companion defaults | Save explains current record mode; symbolic removal has a separate accessible name. Section and relationship prerequisites refresh with state. |
| Scheduler: companion layout | Per-row Revert, layout settings, saved defaults | Revert titles update on edit, revert, apply and saving defaults. Existing specialized preview/status content preserved. |
| Scheduler: schedule and allocation | Explain, Copy Text, Preview, Save/Preview Planting, fixed allocation city/climate controls | Describe clipboard and preview/persist effects; copy success clears old failure help. Disabled allocation actions explain garden-owned climate. Hidden immutable crop actions do not need hover targets. |
| Scheduler: task template | Add/Edit/Delete task, task Save, reset/default restoration, recipe chooser/delete/save | Explicit current-template/saved-recipe scope; chooser title follows open state. Existing recipe validation/help retained. Plain Schedule/Tasks tabs and Cancel omitted. |
| Vertex Linking: canvas controls | Set plant, Cards/Schedule/Spacing modes, previous/next year | Describe planting targets/mode effects; arrow names and first/last-year boundary titles added. Existing linking/selection help preserved. |
| Vertex Linking: spacing editor | Apply, apply set defaults, active rows, preview | Apply explains no changes, invalid spacing and invalid preview; defaults explain saved companion-set scope. Existing detailed preview help preserved. |
| Equipment | Add/duplicate/delete equipment, task types/capabilities, restore defaults, import/export, editor actions | Explain registry/catalog scope and consequences. Existing custom action descriptions retained; icon-only close name kept concise. Cancel/Close omitted where dismissal is clear. |
| Irrigation: BOM and stock | Filters, CSV export, actual quantities, planned/completed actions, clear/select, save and undo | Explain planned/actual stock, selected parts and affected lists; empty/action prerequisites refresh. Labeled filters and data cells omitted. |
| Irrigation: catalog and dialogs | Part creation/catalog actions, source/zone resets, save, cancel | Explicit catalog, source and zone effects; existing validation preserved. Ordinary Cancel omitted. |
| Irrigation: design and canvas HUD | Mode/exit, build analysis, connections, style, disconnect/delete, select upstream/downstream/previous/next | Distinguish disconnection from deletion and describe navigation targets; concise navigation accessible names. Existing port, compatibility and rich warning tooltips preserved. |
| Irrigation: dynamic groups/issues | Expand/collapse groups, issue navigation, catalog/BOM triggers | Titles reflect collapsed state and prerequisites; issues without a canvas target explain why navigation is disabled. |
| Roadmap Manager: boards and settings | Add/open boards, views, columns, timescales, margins, costs and assignments | Action scope and permission/selection prerequisites; existing meaningful settings help preserved. Plain labeled inputs omitted. |
| Roadmap Manager: cards and overlays | Create/edit/move/delete, status/progress +/- controls, costs, permission boundaries | Explicit target/consequences and disabled reasons; separate progress accessible names. Read-only progress/status summaries omitted. |
| Created Change Map | Previous/next matching change, checkpoint, return latest, compare/restore history | Empty/first/last explanations and selected-revision prerequisites refresh with state. Existing history selection descriptions preserved. Clear filter labels and Close omitted. |
| Trellis Database Tools | Restore backup, Cancel during restore | Explain replacement and in-progress prerequisite; existing backup/export help retained. Normal Cancel/Close omitted. |
| Trellis Updates Links | Resource links, release links, Retry, Check for updates | Explain destinations and retry/check actions; preserve busy-state descriptions. Plain Close omitted. |
| Trellis Users | Account/PIN/admin actions, invitations, access grants/removals, team-derived permissions, group disclosure | Explicit account/access effects and team-derived disabled reasons; disclosure title follows state. Existing identity/role help preserved. Ordinary Cancel/Close omitted. |
| Year Planner: session/footer | Save/draft save/save-close, export, reset, discard, templates | Describe committed versus draft actions and discard/reset consequences. Template apply/save/delete help follows selection and name input. |
| Year Planner: crop catalog/picker | Reload, Add crops, available/in-plan rows, +/- controls, bulk changes, Apply | Loading/empty/staged-change prerequisites; symbolic controls have concise names. Crop cards explain selection/details. Existing catalog and history labels preserved. |
| Year Planner: demand/packages/CSA | Add/remove packages/lines/channels/components, transfers, resets, sale value, collapsible strips | Explicit row/channel/package scope and removal/reset effects; disabled prerequisites follow refresh. Disabled sections explain enabling the section and restore earlier titles when enabled. |
| Year Planner: diagnostics/chips | Diagnostics section toggle, help, actionable crop/date/price/demand chips | Explicit navigation target descriptions; existing specialized diagnostic/action popovers preserved without competing native titles. Noninteractive calculated chips and detailed message text omitted. |
| Shared UI Cleanup | Local button factory and shared styling | Existing optional `title` and `ariaLabel` support retained; no global behavior added. |
| Context Menu / Tidy Context Menu | Trellis-owned context-menu contributors and tidy actions | Descriptive menu text provides action names; inherited menu construction is outside scope. No redundant native titles added. |
| Deep Click Through | Workspace move handles for modules and occupied beds | Existing target-specific titles and accessible names refresh with the selected move unit, including irrigation assemblies; preserved. Canvas gesture machinery left unchanged. |
| Garden Scale / Parenting Controls | Scale commands and planting-parenting hooks | No independently rendered Trellis button groups; inherited controls and canvas gesture machinery left unchanged. |
| Scheduler annual/perennial/shared cores; Roadmap core | Scheduling/math/data and menu integration helpers | No independently rendered button groups. Existing core behavior retained. |

## Verification record

- No tooltip tests were added. Existing Task Manager pager expectations now accept
  the agreed native titles. Existing succession-arrow checks locate arrows by
  their accessible image names rather than tooltip wording.
- The full existing top-level JavaScript suite ran 1,585 tests: 1,583 passed; the
  two failures were the old succession-arrow selectors. After correcting those
  selectors, the Task Manager and succession suites passed all 151 tests.
- Scheduler suites were rerun after the final Revert state correction: all 325
  tests passed. Every failure from the full suite is resolved by the focused reruns.
- Source review covered dynamic row creation, expanded/collapsed states, disabled
  reasons and controls reused after selection changes. Existing suites cover the
  affected click handlers, selection refresh, keyboard interactions and canvas
  gestures. Source edits add descriptions/names and retain handlers and layout.
- Native application verification is **pending**, not passed. Two launch
  attempts (including hardware acceleration disabled) failed before an app window
  opened: Electron reported repeated GPU-process exits `-1073741515` and “GPU
  process isn't usable.” A final attempt with the GPU running in-process opened
  the application, but the computer-use tool denied access with “Computer Use was
  not approved to use electron.” Permission to finish UI inspection was requested.
  The QA launcher uses a temporary app-data directory.

## Application checklist still required

For **every group in the inventory**, open the relevant toolbar/dialog/panel and
exercise its dynamically created rows and controls. Use disposable diagrams and
records for consequential actions.

- Hover enabled controls until their native tooltip appears; check wording and
  target against the action. Inspect icon-only accessible names separately.
- Exercise each disabled prerequisite/boundary, then enable it and hover again.
  If disabled buttons swallow hover, use an existing surrounding hover target
  without changing disabled behavior.
- Toggle views, sections, groups and modes; reopen popups; select different cells,
  roles, crops, boards and revisions to verify reused controls do not retain old
  state or target descriptions.
- Check both Task Manager arrows on first, middle and last pages in full and week
  modes, and after board/lane/period changes.
- Verify companion Revert after an edit, revert, apply and saved defaults; verify
  Year Planner disabled sections, draft/committed footer and template selection.
- Confirm clicks, Tab/Enter/Space/Escape behavior, layout and canvas drag/selection
  gestures. Confirm specialized popovers still display without duplicate native
  explanations. Do not rely on hover for essential instructions.

<!-- CHANGE: explicit tooltip eligibility, reviewed inventory and honest verification status. -->
