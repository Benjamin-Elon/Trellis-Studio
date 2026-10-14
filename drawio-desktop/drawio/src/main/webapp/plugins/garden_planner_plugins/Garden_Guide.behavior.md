# Task Guide

Select one task card and choose **Guide**. Instructions save to that occurrence after a
500 ms typing pause, or immediately on blur, Close, or entering recipe saving.
Multiline text and composition input are preserved. Opening the Guide does not write
to the diagram. Normal diagram saving remains responsible for persistence to disk.

Each typing burst is one undoable model edit. A failed save retains the entered text
and vetoes closing; Retry saves it again. Discard unsaved text and close is available
after a failure or task deletion. Undo/redo cancels pending autosave and reloads the
current model. Reset removes the local override and restores inherited instructions.

## Storage contract

- Version-2 recipe rules optionally contain `instructions` and
  `instructionProvenance: {status, sourceUrls, sourceNote}`. Status is `draft`,
  `customized`, or `reviewed`. Scheduling fields and rule IDs are independent.
- Generated task cards receive `task_instructions` and
  `task_instruction_provenance_json` as inherited guidance.
- `task_instruction_override` stores local text. An absent attribute means inheritance;
  an empty attribute means the user deliberately cleared the instructions.
- Scheduler synchronization refreshes inherited fields and preserves local overrides
  using `scheduler_task_key`, independently for each repeated occurrence. Unsafe
  replacement mappings retain edited cards rather than discarding their instructions.
- Scheduler notes (`notes`) and the short user note (`card_note`) remain separate.

Legacy tasks can read guidance from their linked template or compatible database
default. Scheduler notes are fallback text; plant attributes are labeled general
reference information. The Guide does not infer a crop's current growth stage.

## Recipe reuse

Recipe saving is explicit. New copies preserve the linked planting's complete template
and change only the selected rule's instructions. Updating an existing recipe changes
only that rule's instructions and provenance in a compatible recipe the user owns.
Both use existing recipe validation and one undoable garden-library edit. Existing
task cards and the planting's own saved template are not rewritten.

Multiple linked plantings require a choice. Missing or ambiguous rules disable recipe
saving. Manual tasks still support local instructions. Writes recheck task permissions,
recipe ownership, and target existence. Text is rendered safely and source links accept
only HTTP/HTTPS URLs.

## Seeder

New template generation drafts crop/method instructions using existing plant attributes
and supplied sources. Provider responses contain instruction fields only; deterministic
rule IDs, dates, durations, and repetition remain authoritative. Variety templates inherit
crop/method drafts; input `instructions_by_rule` supports explicit variety overrides.
Failures are reported in generation provenance without removing valid task schedules.

Seeder option **13 — Fill missing task instructions** creates a normal run for
Review/Validate and Apply. `TaskInstructionPatches.json` identifies the existing template,
rule, and a hash of the non-instruction template fields. Apply rechecks that identity,
the unchanged schedule, and absence of instructions. It updates only instruction fields
and `updated_at`; it never inserts, deletes, or replaces recipes. Explicit empty text and
authored instructions are preserved, and applying the same run twice is harmless.

Compass, shade analysis, crop light profiles, and automatic placement are outside this
delivery.
