/**
 * Draw.io Plugin: Task Manager (Kanban Template Style + Auto Placement + Auto Archive + Badges)
 */
function normalizeTaskReplacementDetail(detail) { // FIX: centralize the scheduler event contract
    const source = detail && typeof detail === 'object' ? detail : {};
    return {
        mode: String(source.mode || 'replace').trim().toLowerCase(),
        targetGroupId: source.targetGroupId,
        tasks: Array.isArray(source.tasks) ? source.tasks : []
    };
}

function applyImmediateTaskReplacement({ targetGroupId, tasks, removeTasks, createTasks }) {
    removeTasks(targetGroupId, { reflow: tasks.length === 0 }); // CHANGE
    if (tasks.length) createTasks(tasks, targetGroupId, { reflow: true });
}

const CARD_NOTE_ATTR = 'card_note'; // NEW: user annotation kept separate from scheduler task notes
const CARD_NOTE_MAX_LENGTH = 40; // NEW
const TASK_VIEW_MODE_ATTR = 'task_view_mode'; // NEW
const TASK_SELECTED_DAY_ATTR = 'task_selected_day'; // NEW
const TASK_SELECTED_WEEK_START_ATTR = 'task_selected_week_start'; // NEW
const TASK_WORKFLOW_STATE_ATTR = 'workflow_state'; // NEW
const TASK_ASSIGNED_DAY_ATTR = 'assigned_day'; // NEW
const TASK_INCOMPLETE_DAY_ATTR = 'incomplete_day'; // NEW
const TASK_SCHEDULER_MISSING_ATTR = 'scheduler_missing'; // NEW
const TASK_SCHEDULER_DATES_LOCKED_ATTR = 'scheduler_dates_locked'; // NEW
const TASK_MANUAL_STAGED_ATTR = 'manual_staged'; // NEW
const TASK_VIEW_MODES = ['FULL', 'WEEK', 'DAY']; // NEW
const TASK_WORKFLOW_STATES = ['STAGED', 'TODO', 'DOING', 'DONE']; // NEW
const WEEK_DAY_LANE_KEYS = ['WEEK_SUN', 'WEEK_MON', 'WEEK_TUE', 'WEEK_WED', 'WEEK_THU', 'WEEK_FRI', 'WEEK_SAT']; // NEW

const KANBAN_BOARD_KEY = 'KANBAN_BOARD'; // NEW: shared by runtime guards and pure policy tests
const LEGACY_KANBAN_BOARD_KEY = 'MAIN_KANBAN_BOARD'; // NEW: preserve recognition of older board cells
const KANBAN_LANE_DEFS = [ // NEW: canonical lane types used by template creation and parenting policy
    { key: 'UPCOMING_FUTURE', label: 'UPCOMING (future)' }, // NEW
    { key: 'UPCOMING_YEAR', label: 'UPCOMING (year)' }, // NEW
    { key: 'UPCOMING_MONTH', label: 'UPCOMING (month)' }, // NEW
    { key: 'UPCOMING_WEEK', label: 'UPCOMING (week)' }, // NEW
    { key: 'TODO_STAGED', label: 'TODO (staged)' }, // NEW
    { key: 'WEEK_SUN', label: 'Sunday' }, // NEW
    { key: 'WEEK_MON', label: 'Monday' }, // NEW
    { key: 'WEEK_TUE', label: 'Tuesday' }, // NEW
    { key: 'WEEK_WED', label: 'Wednesday' }, // NEW
    { key: 'WEEK_THU', label: 'Thursday' }, // NEW
    { key: 'WEEK_FRI', label: 'Friday' }, // NEW
    { key: 'WEEK_SAT', label: 'Saturday' }, // NEW
    { key: 'TODO', label: 'TODO' }, // NEW
    { key: 'DOING', label: 'DOING' }, // NEW
    { key: 'DONE', label: 'DONE' }, // NEW
    { key: 'DONE_WEEK', label: 'DONE (week)' }, // NEW
    { key: 'DONE_MONTH', label: 'DONE (month)' }, // NEW
    { key: 'DONE_YEAR', label: 'DONE (year)' }, // NEW
    { key: 'ARCHIVED', label: 'ARCHIVED' } // NEW
]; // NEW
const KANBAN_LANE_KEYS = KANBAN_LANE_DEFS.map(lane => lane.key); // NEW
const FULL_VIEW_LANE_KEYS = [ // NEW
    'UPCOMING_FUTURE',
    'UPCOMING_YEAR',
    'UPCOMING_MONTH',
    'UPCOMING_WEEK',
    'TODO_STAGED',
    'TODO',
    'DOING',
    'DONE',
    'DONE_WEEK',
    'DONE_MONTH',
    'DONE_YEAR',
    'ARCHIVED'
]; // NEW
const WEEK_VIEW_LANE_KEYS = ['TODO_STAGED', ...WEEK_DAY_LANE_KEYS, 'DONE']; // NEW
const DAY_VIEW_LANE_KEYS = ['TODO_STAGED', 'TODO', 'DOING', 'DONE']; // NEW

const EDITABLE_CARD_DATE_LANES = new Set([ // NEW: completed lanes intentionally remain immutable in version one
    'UPCOMING_FUTURE',
    'UPCOMING_YEAR',
    'UPCOMING_MONTH',
    'UPCOMING_WEEK',
    'TODO_STAGED',
    'WEEK_SUN', // NEW
    'WEEK_MON', // NEW
    'WEEK_TUE', // NEW
    'WEEK_WED', // NEW
    'WEEK_THU', // NEW
    'WEEK_FRI', // NEW
    'WEEK_SAT', // NEW
    'TODO',
    'DOING'
]);

function parseTaskCalendarISO(iso) { // NEW: strict calendar parsing shared by runtime code and tests
    const match = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utcDate = new Date(Date.UTC(year, month - 1, day));

    if (
        utcDate.getUTCFullYear() !== year ||
        utcDate.getUTCMonth() !== month - 1 ||
        utcDate.getUTCDate() !== day
    ) {
        return null;
    }

    return {
        year,
        month,
        day,
        dayNumber: Math.floor(utcDate.getTime() / 86400000)
    };
}

function shiftTaskCalendarISO(iso, dayDelta) { // NEW: UTC calendar arithmetic avoids DST-length assumptions
    const parsed = parseTaskCalendarISO(iso);
    const delta = Number(dayDelta);
    if (!parsed || !Number.isInteger(delta)) return null;

    const shifted = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + delta));
    const year = shifted.getUTCFullYear();
    const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const day = String(shifted.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function normalizeTaskViewMode(value) { // NEW
    const mode = String(value || '').trim().toUpperCase(); // NEW
    return TASK_VIEW_MODES.includes(mode) ? mode : 'FULL'; // NEW
} // NEW

function normalizeWorkflowState(value) { // NEW
    const state = String(value || '').trim().toUpperCase(); // NEW
    return TASK_WORKFLOW_STATES.includes(state) ? state : null; // NEW
} // NEW

function getTaskWeekStartISO(iso) { // NEW
    const parsed = parseTaskCalendarISO(iso); // NEW
    if (!parsed) return null; // NEW
    const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)); // NEW
    const dayOfWeek = date.getUTCDay(); // NEW
    return shiftTaskCalendarISO(iso, -dayOfWeek); // NEW
} // NEW

function getTaskWeekEndISO(weekStartISO) { // NEW
    return shiftTaskCalendarISO(weekStartISO, 6); // NEW
} // NEW

function isTaskDateInWeek(iso, weekStartISO) { // NEW
    const date = parseTaskCalendarISO(iso); // NEW
    const start = parseTaskCalendarISO(weekStartISO); // NEW
    if (!date || !start) return false; // NEW
    return date.dayNumber >= start.dayNumber && date.dayNumber <= start.dayNumber + 6; // NEW
} // NEW

function getWeekLaneKeyForDate(iso, weekStartISO) { // NEW
    const date = parseTaskCalendarISO(iso); // NEW
    const start = parseTaskCalendarISO(weekStartISO); // NEW
    if (!date || !start) return null; // NEW
    const offset = date.dayNumber - start.dayNumber; // NEW
    return offset >= 0 && offset < WEEK_DAY_LANE_KEYS.length ? WEEK_DAY_LANE_KEYS[offset] : null; // NEW
} // NEW

function getDateForWeekLaneKey(laneKey, weekStartISO) { // NEW
    const index = WEEK_DAY_LANE_KEYS.indexOf(String(laneKey || '')); // NEW
    if (index < 0 || !parseTaskCalendarISO(weekStartISO)) return null; // NEW
    return shiftTaskCalendarISO(weekStartISO, index); // NEW
} // NEW

function clampTaskDayToWeek(iso, weekStartISO) { // NEW
    const date = parseTaskCalendarISO(iso); // NEW
    const start = parseTaskCalendarISO(weekStartISO); // NEW
    if (!date || !start) return weekStartISO; // NEW
    if (date.dayNumber < start.dayNumber) return weekStartISO; // NEW
    if (date.dayNumber > start.dayNumber + 6) return getTaskWeekEndISO(weekStartISO); // NEW
    return iso; // NEW
} // NEW

function shiftTaskDayWithinWeek(iso, weekStartISO, delta) { // NEW
    const shifted = shiftTaskCalendarISO(iso, delta); // NEW
    return isTaskDateInWeek(shifted, weekStartISO) ? shifted : iso; // NEW
} // NEW

function getTaskViewLaneKeys(mode) { // NEW
    const normalized = normalizeTaskViewMode(mode); // NEW
    if (normalized === 'WEEK') return WEEK_VIEW_LANE_KEYS.slice(); // NEW
    if (normalized === 'DAY') return DAY_VIEW_LANE_KEYS.slice(); // NEW
    return FULL_VIEW_LANE_KEYS.slice(); // NEW
} // NEW

function deriveWorkflowStateFromLaneKey(laneKey) { // NEW
    const key = String(laneKey || ''); // NEW
    if (key === 'TODO') return 'TODO'; // NEW
    if (key === 'DOING') return 'DOING'; // NEW
    if (key === 'DONE' || key === 'DONE_WEEK' || key === 'DONE_MONTH' || key === 'DONE_YEAR' || key === 'ARCHIVED') return 'DONE'; // NEW
    return 'STAGED'; // NEW
} // NEW

function getEffectiveWorkflowState(source, laneKey) { // NEW
    return normalizeWorkflowState(readAttributeValue(source, TASK_WORKFLOW_STATE_ATTR)) || deriveWorkflowStateFromLaneKey(laneKey); // NEW
} // NEW

function isOpenWorkflowState(state) { // NEW
    return state === 'TODO' || state === 'DOING'; // NEW
} // NEW

function isSchedulerDateLocked(source) { // NEW
    return String(readAttributeValue(source, TASK_SCHEDULER_DATES_LOCKED_ATTR) || '') === '1'; // NEW
} // NEW

function isManualStagedSource(source) { // NEW
    return String(readAttributeValue(source, TASK_MANUAL_STAGED_ATTR) || '') === '1'; // NEW
} // NEW

function isPhysicallyOrManuallyStaged(source, laneKey) { // NEW
    return String(laneKey || '') === 'TODO_STAGED' || isManualStagedSource(source); // NEW
} // NEW

function isUserTouchedSchedulerCard(source) { // NEW
    const state = getEffectiveWorkflowState(source, null); // NEW
    return !!String(readAttributeValue(source, TASK_ASSIGNED_DAY_ATTR) || '').trim() || // NEW
        state !== 'STAGED' || // NEW
        !!String(readAttributeValue(source, 'completed') || '').trim() || // NEW
        !!String(readAttributeValue(source, TASK_INCOMPLETE_DAY_ATTR) || '').trim() || // NEW
        isManualStagedSource(source) || // NEW
        !!String(readAttributeValue(source, 'date_override') || '').trim() || // NEW
        !!String(readAttributeValue(source, CARD_NOTE_ATTR) || '').trim() || // NEW
        isSchedulerDateLocked(source); // NEW
} // NEW

function isUserTouchedSchedulerRecord(record) { // NEW
    const source = record && (record.source || record); // NEW
    const state = getEffectiveWorkflowState(source, record && record.laneKey); // NEW
    return !!String(readAttributeValue(source, TASK_ASSIGNED_DAY_ATTR) || '').trim() || // NEW
        state !== 'STAGED' || // NEW
        !!String(readAttributeValue(source, 'completed') || '').trim() || // NEW
        !!String(readAttributeValue(source, TASK_INCOMPLETE_DAY_ATTR) || '').trim() || // NEW
        isManualStagedSource(source) || // NEW
        !!String(readAttributeValue(source, 'date_override') || '').trim() || // NEW
        !!String(readAttributeValue(source, CARD_NOTE_ATTR) || '').trim() || // NEW
        isSchedulerDateLocked(source); // NEW
} // NEW

function buildWorkflowPatch(source, action, context) { // NEW
    const ctx = context || {}; // NEW
    const mode = normalizeTaskViewMode(ctx.mode); // NEW
    const selectedDay = parseTaskCalendarISO(ctx.selectedDay) ? ctx.selectedDay : null; // NEW
    const selectedWeekStart = parseTaskCalendarISO(ctx.selectedWeekStart) ? ctx.selectedWeekStart : null; // NEW
    const today = parseTaskCalendarISO(ctx.today) ? ctx.today : null; // NEW
    const currentAssigned = String(readAttributeValue(source, TASK_ASSIGNED_DAY_ATTR) || '').trim(); // NEW
    const attrs = {}; // NEW
    let assignDay = null; // NEW

    if (action === 'TODO' || action === 'DOING') { // NEW
        assignDay = mode === 'DAY' ? selectedDay : (mode === 'WEEK' ? (ctx.dropDay || selectedWeekStart) : today); // NEW
        if (!parseTaskCalendarISO(assignDay)) return null; // NEW
        attrs[TASK_WORKFLOW_STATE_ATTR] = action; // NEW
        attrs[TASK_ASSIGNED_DAY_ATTR] = assignDay; // NEW
        attrs[TASK_SCHEDULER_DATES_LOCKED_ATTR] = '1'; // NEW
        attrs[TASK_INCOMPLETE_DAY_ATTR] = null; // NEW
        attrs[TASK_MANUAL_STAGED_ATTR] = null; // NEW
        attrs.completed = null; // NEW
        return { attributes: attrs }; // NEW
    } // NEW

    if (action === 'DONE') { // NEW
        assignDay = currentAssigned || (mode === 'DAY' ? selectedDay : (mode === 'WEEK' ? selectedWeekStart : today)); // NEW
        if (!parseTaskCalendarISO(assignDay)) return null; // NEW
        attrs[TASK_WORKFLOW_STATE_ATTR] = 'DONE'; // NEW
        attrs[TASK_ASSIGNED_DAY_ATTR] = assignDay; // NEW
        attrs[TASK_SCHEDULER_DATES_LOCKED_ATTR] = '1'; // NEW
        attrs[TASK_INCOMPLETE_DAY_ATTR] = null; // NEW
        attrs[TASK_MANUAL_STAGED_ATTR] = null; // NEW
        attrs.completed = mode === 'DAY' ? selectedDay : (mode === 'WEEK' ? assignDay : today); // NEW
        return { attributes: attrs }; // NEW
    } // NEW

    if (action === 'STAGED') { // NEW
        attrs[TASK_WORKFLOW_STATE_ATTR] = 'STAGED'; // NEW
        attrs[TASK_ASSIGNED_DAY_ATTR] = null; // NEW
        attrs[TASK_SCHEDULER_DATES_LOCKED_ATTR] = null; // NEW
        attrs[TASK_MANUAL_STAGED_ATTR] = ctx.manualStaged ? '1' : null; // NEW
        attrs.completed = null; // NEW
        return { attributes: attrs }; // NEW
    } // NEW

    return null; // NEW
} // NEW

function buildIncompletePatch(source, incompleteDay) { // NEW
    const parsed = parseTaskCalendarISO(incompleteDay); // NEW
    if (!parsed) return null; // NEW
    return { // NEW
        attributes: { // NEW
            [TASK_WORKFLOW_STATE_ATTR]: 'STAGED', // NEW
            [TASK_ASSIGNED_DAY_ATTR]: null, // NEW
            [TASK_SCHEDULER_DATES_LOCKED_ATTR]: null, // NEW
            [TASK_INCOMPLETE_DAY_ATTR]: incompleteDay, // NEW
            [TASK_MANUAL_STAGED_ATTR]: '1', // NEW
            completed: null // NEW
        } // NEW
    }; // NEW
} // NEW

function decideTaskViewLaneKey(source, context) { // NEW
    const ctx = context || {}; // NEW
    const mode = normalizeTaskViewMode(ctx.mode); // NEW
    const fallbackLaneKey = String(ctx.laneKey || ''); // NEW
    const state = getEffectiveWorkflowState(source, fallbackLaneKey); // NEW
    const assignedDay = String(readAttributeValue(source, TASK_ASSIGNED_DAY_ATTR) || '').trim(); // NEW
    const completedDay = String(readAttributeValue(source, 'completed') || '').trim(); // NEW

    if (mode === 'WEEK') { // NEW
        const weekStart = ctx.selectedWeekStart; // NEW
        if (state === 'STAGED') return isPhysicallyOrManuallyStaged(source, fallbackLaneKey) ? 'TODO_STAGED' : fallbackLaneKey; // NEW
        if (state === 'DONE') return isTaskDateInWeek(completedDay || assignedDay, weekStart) ? 'DONE' : 'DONE_WEEK'; // NEW
        const weekLane = getWeekLaneKeyForDate(assignedDay, weekStart); // NEW
        return weekLane || state; // NEW
    } // NEW

    if (mode === 'DAY') { // NEW
        const selectedDay = ctx.selectedDay; // NEW
        if (state === 'STAGED') return isPhysicallyOrManuallyStaged(source, fallbackLaneKey) ? 'TODO_STAGED' : fallbackLaneKey; // NEW
        if (state === 'DONE') return (completedDay || assignedDay) === selectedDay ? 'DONE' : 'DONE_WEEK'; // NEW
        return assignedDay === selectedDay ? state : (getWeekLaneKeyForDate(assignedDay, getTaskWeekStartISO(assignedDay)) || state); // NEW
    } // NEW

    if (state === 'TODO' || state === 'DOING') return state; // NEW
    if (state === 'DONE') return 'DONE'; // NEW
    if (isPhysicallyOrManuallyStaged(source, fallbackLaneKey)) return 'TODO_STAGED'; // NEW
    return ''; // NEW: Full staged cards keep scheduler horizon classification
} // NEW

function readAttributeValue(source, key) { // CHANGE: supports XML cells and plain objects in reliability tests
    if (source && typeof source.getAttribute === 'function') return source.getAttribute(key);
    return source && Object.prototype.hasOwnProperty.call(source, key) ? source[key] : null;
}

function isKnownKanbanLaneKey(laneKey, laneKeys) { // NEW: policy accepts only canonical lane types
    const keys = Array.isArray(laneKeys) ? laneKeys : KANBAN_LANE_KEYS; // NEW
    return keys.includes(String(laneKey || '')); // NEW
} // NEW

function getKanbanCellType(source, laneKeys) { // NEW: pure classifier for board/lane/card parenting policy
    const boardKey = String(readAttributeValue(source, 'board_key') || ''); // NEW
    if (boardKey === KANBAN_BOARD_KEY || boardKey === LEGACY_KANBAN_BOARD_KEY) return 'board'; // NEW
    if (isKnownKanbanLaneKey(readAttributeValue(source, 'lane_key'), laneKeys)) return 'lane'; // NEW
    if (String(readAttributeValue(source, 'kanban_card') || '') === '1') return 'card'; // NEW
    return 'other'; // NEW
} // NEW

function isSameKanbanPolicyCell(left, right) { // NEW: ignore the moved lane itself when checking duplicates
    if (left === right) return true; // NEW
    const leftId = left && left.id != null ? String(left.id) : ''; // NEW
    const rightId = right && right.id != null ? String(right.id) : ''; // NEW
    return !!leftId && leftId === rightId; // NEW
} // NEW

function hasDuplicateKanbanLaneSibling(parent, child, siblings, laneKeys) { // NEW: boards may contain one lane per type
    const childLaneKey = String(readAttributeValue(child, 'lane_key') || ''); // NEW
    if (!childLaneKey || !isKnownKanbanLaneKey(childLaneKey, laneKeys)) return false; // NEW
    return (Array.isArray(siblings) ? siblings : []).some(sibling => // NEW
        !isSameKanbanPolicyCell(sibling, child) && // NEW
        getKanbanCellType(sibling, laneKeys) === 'lane' && // NEW
        String(readAttributeValue(sibling, 'lane_key') || '') === childLaneKey // NEW
    ); // NEW
} // NEW

function canParentKanbanCell(parent, child, opts) { // NEW: single source of truth for kanban parent-child legality
    const laneKeys = opts && opts.laneKeys; // NEW
    const siblings = opts && opts.siblings; // NEW
    const parentType = getKanbanCellType(parent, laneKeys); // NEW
    const childType = getKanbanCellType(child, laneKeys); // NEW

    if (parentType === 'board') { // NEW
        return childType === 'lane' && !hasDuplicateKanbanLaneSibling(parent, child, siblings, laneKeys); // NEW
    } // NEW
    if (parentType === 'lane') return childType === 'card'; // NEW
    if (childType === 'lane' || childType === 'card') return false; // NEW
    return true; // NEW
} // NEW

function normalizeCardNote(value) { // NEW: normalize badge text and truncate by Unicode code point
    const collapsed = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return Array.from(collapsed).slice(0, CARD_NOTE_MAX_LENGTH).join('');
}

function buildCardNotePatch(source, note) { // NEW: empty notes remove only the user annotation attribute
    const currentRaw = String(readAttributeValue(source, CARD_NOTE_ATTR) || ''); // CHANGE
    const normalized = normalizeCardNote(note);
    if (currentRaw === normalized) return { changed: false, normalized }; // CHANGE: saving also cleans legacy raw values

    return {
        changed: true,
        normalized,
        attributes: {
            [CARD_NOTE_ATTR]: normalized || null
        }
    };
}

function getTaskDateRange(source, startKey = 'start', endKey = 'end') { // NEW
    const startISO = String(readAttributeValue(source, startKey) || '').trim(); // CHANGE
    const endISO = String(readAttributeValue(source, endKey) || '').trim(); // CHANGE
    const start = parseTaskCalendarISO(startISO);
    const end = parseTaskCalendarISO(endISO);
    if (!start || !end || end.dayNumber < start.dayNumber) return null;

    return {
        startISO,
        endISO,
        durationDays: end.dayNumber - start.dayNumber
    };
}

function buildInitialCardDateAttributes(startISO, endISO) { // NEW: scheduler output becomes the reset baseline
    const range = getTaskDateRange({ start: startISO, end: endISO });
    if (!range) return null;

    return {
        base_start: range.startISO,
        base_end: range.endISO,
        start: range.startISO,
        end: range.endISO
    };
}

function buildSchedulerTaskMetadataAttributes(task) { // NEW
    const source = task && typeof task === 'object' ? task : {}; // NEW
    const attrs = {}; // NEW
    const taskTypeId = String(source.task_type_id || source.taskTypeId || '').trim(); // NEW
    if (taskTypeId) attrs.task_type_id = taskTypeId; // NEW
    const schedulerRuleId = String(source.scheduler_rule_id || source.schedulerRuleId || source.rule_id || '').trim(); // ADDED
    if (schedulerRuleId) attrs.scheduler_rule_id = schedulerRuleId; // ADDED
    const schedulerAnchorStage = String(source.scheduler_anchor_stage || source.schedulerAnchorStage || source.startAnchorStage || '').trim(); // ADDED
    if (schedulerAnchorStage) attrs.scheduler_anchor_stage = schedulerAnchorStage; // ADDED
    const schedulerMethodCategoryId = String(source.scheduler_method_category_id || source.schedulerMethodCategoryId || source.methodCategoryId || '').trim(); // ADDED
    if (schedulerMethodCategoryId) attrs.scheduler_method_category_id = schedulerMethodCategoryId; // ADDED
    const schedulerMethodId = String(source.scheduler_method_id || source.schedulerMethodId || source.methodId || '').trim(); // ADDED
    if (schedulerMethodId) attrs.scheduler_method_id = schedulerMethodId; // ADDED
    const schedulerTaskKey = String(source.scheduler_task_key || source.schedulerTaskKey || '').trim(); // ADDED
    if (schedulerTaskKey) attrs.scheduler_task_key = schedulerTaskKey; // ADDED
    const schedulerOccurrenceIndex = source.scheduler_occurrence_index ?? source.schedulerOccurrenceIndex; // ADDED
    if (schedulerOccurrenceIndex !== undefined && schedulerOccurrenceIndex !== null && schedulerOccurrenceIndex !== '') attrs.scheduler_occurrence_index = String(schedulerOccurrenceIndex); // ADDED
    return attrs; // NEW
} // NEW

function getSchedulerTaskKey(source) { // ADDED
    return String(readAttributeValue(source, 'scheduler_task_key') || '').trim(); // ADDED
} // ADDED

function buildGeneratedTaskSyncAttributes(task) { // ADDED
    const source = task && typeof task === 'object' ? task : {}; // ADDED
    const attrs = { // ADDED
        title: String(source.title || 'Task'), // ADDED
        notes: source.notes ? String(source.notes) : null, // ADDED
        method: source.method ? String(source.method) : null, // ADDED
        plant_name: source.plant_name ? String(source.plant_name) : null, // ADDED
        variety_name: source.variety_name ? String(source.variety_name) : null, // ADDED
        date_override: null // ADDED
    }; // ADDED
    const dates = buildInitialCardDateAttributes(source.startISO, source.endISO); // ADDED
    if (dates) Object.assign(attrs, dates); // ADDED
    Object.assign(attrs, buildSchedulerTaskMetadataAttributes(source)); // ADDED
    return attrs; // ADDED
} // ADDED

function buildGeneratedTaskSyncAttributesForExisting(existingSource, task) { // NEW
    const attrs = buildGeneratedTaskSyncAttributes(task); // NEW
    attrs[TASK_SCHEDULER_MISSING_ATTR] = null; // NEW
    if (isSchedulerDateLocked(existingSource)) { // NEW
        delete attrs.start; // NEW
        delete attrs.end; // NEW
        delete attrs.base_start; // NEW
        delete attrs.base_end; // NEW
        delete attrs.date_override; // NEW
    } // NEW
    return attrs; // NEW
} // NEW

function generatedTaskAttributesDiffer(existingSource, task) { // ADDED
    const attrs = buildGeneratedTaskSyncAttributesForExisting(existingSource, task); // CHANGE
    return Object.keys(attrs).some(key => { // ADDED
        const nextValue = attrs[key] == null ? null : String(attrs[key]); // ADDED
        const current = readAttributeValue(existingSource, key); // ADDED
        const currentValue = current == null ? null : String(current); // ADDED
        return currentValue !== nextValue; // ADDED
    }); // ADDED
} // ADDED

function hasDuplicateSchedulerKeys(items, readKey) { // ADDED
    const seen = new Set(); // ADDED
    for (const item of items || []) { // ADDED
        const key = readKey(item); // ADDED
        if (!key) continue; // ADDED
        if (seen.has(key)) return true; // ADDED
        seen.add(key); // ADDED
    } // ADDED
    return false; // ADDED
} // ADDED

function planDifferentialTaskSync(existingRecords, tasks) { // ADDED
    const existing = Array.isArray(existingRecords) ? existingRecords : []; // ADDED
    const incoming = Array.isArray(tasks) ? tasks : []; // ADDED
    const taskKey = task => String(task?.scheduler_task_key || task?.schedulerTaskKey || '').trim(); // ADDED
    const existingKey = record => String(record?.schedulerTaskKey || getSchedulerTaskKey(record?.source || record) || '').trim(); // ADDED
    if (incoming.some(task => !taskKey(task))) return { legacyReplace: true, creates: [], updates: [], removes: [], missing: [], unchanged: [] }; // CHANGE
    if (existing.some(record => !existingKey(record))) return { legacyReplace: true, creates: [], updates: [], removes: [], missing: [], unchanged: [] }; // CHANGE
    if (hasDuplicateSchedulerKeys(incoming, taskKey) || hasDuplicateSchedulerKeys(existing, existingKey)) return { legacyReplace: true, creates: [], updates: [], removes: [], missing: [], unchanged: [] }; // CHANGE
    const existingByKey = new Map(existing.map(record => [existingKey(record), record])); // ADDED
    const incomingKeys = new Set(incoming.map(taskKey)); // ADDED
    const creates = []; // ADDED
    const updates = []; // ADDED
    const unchanged = []; // ADDED
    const missing = []; // NEW
    for (const task of incoming) { // ADDED
        const key = taskKey(task); // ADDED
        const record = existingByKey.get(key); // ADDED
        if (!record) { // ADDED
            creates.push({ key, task }); // ADDED
            continue; // ADDED
        } // ADDED
        const source = record.source || record; // ADDED
        if (generatedTaskAttributesDiffer(source, task)) updates.push({ key, record, task }); // ADDED
        else unchanged.push({ key, record, task }); // ADDED
    } // ADDED
    const removes = existing // ADDED
        .filter(record => !incomingKeys.has(existingKey(record))) // ADDED
        .filter(record => { // NEW
            if (!isUserTouchedSchedulerRecord(record)) return true; // CHANGE
            missing.push({ key: existingKey(record), record }); // NEW
            return false; // NEW
        }) // NEW
        .map(record => ({ key: existingKey(record), record })); // ADDED
    return { legacyReplace: false, creates, updates, removes, missing, unchanged }; // CHANGE
} // ADDED

function buildCardDateOverridePatch(source, newStartISO) { // NEW: pure patch builder keeps mutation orchestration small
    const current = getTaskDateRange(source);
    const nextStart = parseTaskCalendarISO(newStartISO);
    if (!current || !nextStart) return null;
    if (current.startISO === String(newStartISO).trim()) return { changed: false };

    const nextEndISO = shiftTaskCalendarISO(String(newStartISO).trim(), current.durationDays);
    if (!nextEndISO) return null;

    // Legacy cards capture their current valid dates as the baseline on first edit. // NEW
    const storedBaseline = getTaskDateRange(source, 'base_start', 'base_end');
    const baseline = storedBaseline || current;

    return {
        changed: true,
        attributes: {
            base_start: baseline.startISO,
            base_end: baseline.endISO,
            start: String(newStartISO).trim(),
            end: nextEndISO,
            date_override: '1'
        }
    };
}

function buildCardDateResetPatch(source) { // NEW
    const baseline = getTaskDateRange(source, 'base_start', 'base_end');
    if (!baseline) return null;

    return {
        start: baseline.startISO,
        end: baseline.endISO,
        date_override: null,
        [TASK_MANUAL_STAGED_ATTR]: null // NEW
    };
}

function normalizeRepeatIdentityText(value) { // NEW: repeat identity uses stable case-insensitive text fields
    return String(value == null ? '' : value).trim().toLowerCase(); // NEW
} // NEW

function normalizeRepeatLinkedIds(value) { // NEW: link order must not split otherwise identical repeat series
    return Array.from(new Set(String(value == null ? '' : value) // NEW
        .split(',') // NEW
        .map(id => id.trim()) // NEW
        .filter(Boolean))) // NEW
        .sort(); // NEW
} // NEW

function buildRepeatSeriesKey(source) { // NEW: dates intentionally do not participate in repeat identity
    const linkedIds = normalizeRepeatLinkedIds(readAttributeValue(source, 'linkedTo')); // NEW
    if (linkedIds.length === 0) return null; // NEW: unlinked cards cannot form a reliable series

    return JSON.stringify([ // NEW: structured encoding prevents delimiter collisions
        linkedIds, // NEW
        normalizeRepeatIdentityText(readAttributeValue(source, 'plant_name')), // NEW
        normalizeRepeatIdentityText(readAttributeValue(source, 'method')), // NEW
        normalizeRepeatIdentityText(readAttributeValue(source, 'title')) // NEW
    ]); // NEW
} // NEW

function compareRepeatCalendarValues(left, right) { // NEW: valid dates sort before missing or malformed dates
    const leftDate = parseTaskCalendarISO(left); // NEW
    const rightDate = parseTaskCalendarISO(right); // NEW
    if (leftDate && rightDate) return leftDate.dayNumber - rightDate.dayNumber; // NEW
    if (leftDate) return -1; // NEW
    if (rightDate) return 1; // NEW
    return 0; // NEW
} // NEW

function compareRepeatOccurrenceRecords(left, right) { // NEW: deterministic representative and badge ordering
    return compareRepeatCalendarValues(left && left.startISO, right && right.startISO) || // NEW
        compareRepeatCalendarValues(left && left.endISO, right && right.endISO) || // NEW
        String(left && left.id || '').localeCompare(String(right && right.id || '')); // NEW
} // NEW

function isCardVisibilityEligible(source) { // NEW: paging and lane counts share the same derived visibility rule
    return readAttributeValue(source, 'year_hidden') !== '1' && // NEW
        readAttributeValue(source, 'repeat_hidden') !== '1'; // NEW
} // NEW

function planRepeatSeriesVisibility(records) { // NEW: pure planner keeps board mutation orchestration small
    const input = Array.isArray(records) ? records : []; // NEW
    const plannedById = new Map(); // NEW
    const groupsByKey = new Map(); // NEW

    input.forEach(record => { // NEW
        const id = String(record && record.id || ''); // NEW
        plannedById.set(id, { // NEW: defaults also clear stale derived repeat state
            id, // NEW
            repeating: false, // NEW
            repeatHidden: false, // NEW
            repeatBadge: '' // NEW
        }); // NEW

        const key = record && record.seriesKey; // NEW
        if (!key) return; // NEW
        if (!groupsByKey.has(key)) groupsByKey.set(key, []); // NEW
        groupsByKey.get(key).push(record); // NEW
    }); // NEW

    groupsByKey.forEach(group => { // NEW
        const eligible = group // NEW
            .filter(record => !(record && record.yearHidden)) // NEW
            .slice() // NEW
            .sort(compareRepeatOccurrenceRecords); // NEW
        if (eligible.length < 2) return; // NEW: one eligible occurrence is not rendered as a repeat series

        const expanded = group.some(record => !!(record && record.expanded)); // NEW
        const indexById = new Map(); // NEW
        eligible.forEach((record, index) => indexById.set(String(record.id || ''), index)); // NEW

        if (expanded) { // NEW
            eligible.forEach(record => { // NEW
                const id = String(record.id || ''); // NEW
                plannedById.set(id, { // NEW
                    id, // NEW
                    repeating: true, // NEW
                    repeatHidden: false, // NEW
                    repeatBadge: `${indexById.get(id) + 1}/${eligible.length}` // NEW
                }); // NEW
            }); // NEW
            return; // NEW
        } // NEW

        const recordsByLane = new Map(); // NEW
        eligible.forEach(record => { // NEW
            const laneKey = String(record.laneKey || ''); // NEW
            if (!recordsByLane.has(laneKey)) recordsByLane.set(laneKey, []); // NEW
            recordsByLane.get(laneKey).push(record); // NEW
        }); // NEW

        recordsByLane.forEach(laneRecords => { // NEW
            const orderedLaneRecords = laneRecords.slice().sort(compareRepeatOccurrenceRecords); // NEW
            orderedLaneRecords.forEach((record, laneIndex) => { // NEW
                const id = String(record.id || ''); // NEW
                const hiddenInLane = orderedLaneRecords.length - 1; // NEW
                plannedById.set(id, { // NEW
                    id, // NEW
                    repeating: true, // NEW
                    repeatHidden: laneIndex > 0, // NEW
                    repeatBadge: laneIndex === 0 // NEW
                        ? `${indexById.get(id) + 1}/${eligible.length}${hiddenInLane > 0 ? ` +${hiddenInLane}` : ''}` // NEW
                        : '' // NEW
                }); // NEW
            }); // NEW
        }); // NEW
    }); // NEW

    return input.map(record => plannedById.get(String(record && record.id || ''))); // NEW
} // NEW

function isEditableCardDateLane(laneKey) { // NEW
    return EDITABLE_CARD_DATE_LANES.has(String(laneKey || ''));
}

if (typeof globalThis !== 'undefined' && globalThis.__TRELLIS_TASK_MANAGER_TEST__) { // FIX: no runtime exposure unless tests opt in
    globalThis.__TRELLIS_TASK_MANAGER_TEST_HOOKS__ = {
        normalizeTaskReplacementDetail,
        applyImmediateTaskReplacement,
        parseTaskCalendarISO, // NEW
        shiftTaskCalendarISO, // NEW
        normalizeTaskViewMode, // NEW
        getTaskWeekStartISO, // NEW
        getTaskWeekEndISO, // NEW
        isTaskDateInWeek, // NEW
        getWeekLaneKeyForDate, // NEW
        getDateForWeekLaneKey, // NEW
        clampTaskDayToWeek, // NEW
        shiftTaskDayWithinWeek, // NEW
        getTaskViewLaneKeys, // NEW
        deriveWorkflowStateFromLaneKey, // NEW
        getEffectiveWorkflowState, // NEW
        isManualStagedSource, // NEW
        isPhysicallyOrManuallyStaged, // NEW
        isUserTouchedSchedulerCard, // NEW
        isUserTouchedSchedulerRecord, // NEW
        buildWorkflowPatch, // NEW
        buildIncompletePatch, // NEW
        decideTaskViewLaneKey, // NEW
        getTaskDateRange, // NEW
        buildInitialCardDateAttributes, // NEW
        buildSchedulerTaskMetadataAttributes, // NEW
        getSchedulerTaskKey, // ADDED
        buildGeneratedTaskSyncAttributes, // ADDED
        buildGeneratedTaskSyncAttributesForExisting, // NEW
        planDifferentialTaskSync, // ADDED
        buildCardDateOverridePatch, // NEW
        buildCardDateResetPatch, // NEW
        isEditableCardDateLane, // NEW
        normalizeCardNote, // NEW
        buildCardNotePatch, // NEW
        normalizeRepeatIdentityText, // NEW
        normalizeRepeatLinkedIds, // NEW
        buildRepeatSeriesKey, // NEW
        compareRepeatOccurrenceRecords, // NEW
        isCardVisibilityEligible, // NEW
        planRepeatSeriesVisibility, // CHANGE
        getKanbanCellType, // NEW
        canParentKanbanCell // NEW
    };
}

Draw.loadPlugin(function (ui) {
    const graph = ui.editor.graph;
    const model = graph.getModel();

    const BOARD_KEY = KANBAN_BOARD_KEY; // CHANGE
    const BOARD_ROLE_ATTR = 'board_role';
    const TG_COMPLETED_ATTR = 'tg_completed';                                            // NEW


    // -------------------- Template styles --------------------
    const BOARD_STYLE =
        'swimlane;fontStyle=2;childLayout=stackLayout;horizontal=1;startSize=28;horizontalStack=1;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=1;marginBottom=0;swimlaneFillColor=none;fontFamily=Permanent Marker;fontSize=16;points=[];verticalAlign=top;stackBorder=0;resizable=1;strokeWidth=2;disableMultiStroke=1;';
    const LANE_STYLE_BASE =
        'swimlane;strokeWidth=2;fontFamily=Permanent Marker;html=0;startSize=1;verticalAlign=bottom;spacingBottom=5;points=[];childLayout=stackLayout;stackBorder=20;stackSpacing=20;resizeLast=0;resizeParent=1;horizontalStack=0;collapsible=1;fillStyle=solid;swimlaneFillColor=default;';
    const CARD_STYLE =
        'whiteSpace=wrap;html=1;strokeWidth=2;fillColor=swimlane;fontStyle=1;spacingTop=0;rounded=1;arcSize=9;points=[];fontFamily=Permanent Marker;hachureGap=8;fillWeight=1;';

    // Lane fills
    const LANE_FILL = [
        '#DDD6FE', // UPCOMING (future) // NEW
        '#C7D2FE', // UPCOMING (year)
        '#BAE6FD', // UPCOMING (month)
        '#BBF7D0', // UPCOMING (week)
        '#E5E7EB', // TODO (staged)
        '#FDE68A', // Sunday // NEW
        '#FBCFE8', // Monday // NEW
        '#BFDBFE', // Tuesday // NEW
        '#C4B5FD', // Wednesday // NEW
        '#A7F3D0', // Thursday // NEW
        '#FED7AA', // Friday // NEW
        '#FECACA', // Saturday // NEW
        '#F8CECC', // TODO
        '#FFF2CC', // DOING
        '#D5E8D4', // DONE
        '#D1FAE5', // DONE (week)
        '#A7F3D0', // DONE (month)
        '#6EE7B7', // DONE (year)
        '#F3F4F6'  // ARCHIVED
    ];

    const BOARD_GEOM = { x: 40, y: 40, w: 2200, h: 760 };
    const LANE_W = 220, LANE_H = 680, LANE_GAP = 16;

    const LINK_ATTR = 'linkedTo';
    const REPEAT_HIDDEN_ATTR = 'repeat_hidden'; // NEW
    const REPEAT_EXPANDED_ATTR = 'repeat_expanded'; // NEW
    const REPEAT_BADGE_ATTR = 'repeat_badge'; // NEW

    const LANES = KANBAN_LANE_DEFS; // CHANGE: template and policy use the same canonical lane list

    // -------------------- Paging icons --------------------                                       
    const ICON_PAGE_UP = 'data:image/svg+xml;utf8,' +
        encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14">' +
            '<polygon points="7,3 3,9 11,9" stroke="#000" fill="none" stroke-width="1.4"/>' +
            '</svg>'
        );

    const ICON_PAGE_DOWN = 'data:image/svg+xml;utf8,' +
        encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14">' +
            '<polygon points="3,5 11,5 7,11" stroke="#000" fill="none" stroke-width="1.4"/>' +
            '</svg>'
        );


    // -------------------- Helpers --------------------
    function ensureXmlValue(cell) {
        if (!cell.value || typeof cell.value === 'string') {
            const doc = mxUtils.createXmlDocument();
            const obj = doc.createElement('object');
            obj.setAttribute('label', cell.value || '');
            cell.value = obj;
        }
        return cell.value;
    }
    function setAttrNoUndo(cell, key, val, suppressRefresh) {
        ensureXmlValue(cell);
        const v = cell.value;
        if (!v || !v.setAttribute) return;

        if (val == null) v.removeAttribute(key);
        else v.setAttribute(key, String(val));

        if (!suppressRefresh) {
            graph.refresh(cell);
        }
    }

    function getAttr(cell, k) {
        const v = cell && cell.value;
        return (v && v.getAttribute) ? v.getAttribute(k) : null;
    }
    function createVertex(label, x, y, w, h, style) {
        const v = new mxCell(label || '', new mxGeometry(x, y, w, h), style || '');
        v.setVertex(true);
        v.setConnectable(false);
        return v;
    }

    // Garden-module helpers
    function isGardenModule(cell) { return getAttr(cell, 'garden_module') === '1'; }
    function findGardenModuleAncestor(cell) {
        if (!cell) return null;
        let cur = cell;
        while (cur) {
            if (isGardenModule(cur)) return cur;
            cur = model.getParent(cur);
        }
        return null;
    }

    function ensureBoardTemplateIn(containerVertex, opts) {                                  // CHANGE
        const parent = containerVertex || graph.getDefaultParent();
        let { main } = findBoardsIn(parent);

        const insideUpdate = !!(opts && opts.insideUpdate);                                  // NEW
        if (!insideUpdate) model.beginUpdate();                                              // NEW
        try {                                                                                // CHANGE
            let board = main;
            if (!board) {
                board = createVertex('Kanban', BOARD_GEOM.x, BOARD_GEOM.y, BOARD_GEOM.w, BOARD_GEOM.h, BOARD_STYLE);
                model.add(parent, board, model.getChildCount(parent));
                setAttrNoUndo(board, 'board_key', BOARD_KEY);
                setAttrNoUndo(board, BOARD_ROLE_ATTR, 'main');
                main = board;
            }
            ensureBoardPlanningDefaults(main); // NEW
            ensureLanes(main);
            return { parent, board: main, lanes: lanesMap(main) };
        } finally {                                                                          // CHANGE
            if (!insideUpdate) model.endUpdate();                                            // NEW
        }                                                                                     // CHANGE
    }

    function createSecondaryBoardIn(parent) {
        const board = createVertex('Kanban', BOARD_GEOM.x, BOARD_GEOM.y, BOARD_GEOM.w, BOARD_GEOM.h, BOARD_STYLE);
        model.add(parent, board, model.getChildCount(parent));
        setAttrNoUndo(board, 'board_key', BOARD_KEY);
        setAttrNoUndo(board, BOARD_ROLE_ATTR, 'secondary');
        ensureBoardPlanningDefaults(board); // NEW
        ensureLanes(board);
        return board;
    }

    function applyBoardViewLayout(board, lanes) { // NEW
        ensureBoardPlanningDefaults(board); // NEW
        const mode = getBoardViewMode(board); // NEW
        const visibleKeys = getTaskViewLaneKeys(mode); // NEW
        const visibleSet = new Set(visibleKeys); // NEW
        const selectedWeekLaneKey = mode === 'WEEK' ? getWeekLaneKeyForDate(getSelectedDay(board), getSelectedWeekStart(board)) : null; // NEW
        let x = 10; // NEW
        const y = 28; // NEW

        visibleKeys.forEach(laneKey => { // NEW
            const lane = lanes[laneKey]; // NEW
            if (!lane) return; // NEW
            const geo = lane.getGeometry() ? lane.getGeometry().clone() : new mxGeometry(x, y, LANE_W, LANE_H); // NEW
            geo.x = x; // NEW
            geo.y = y; // NEW
            geo.width = LANE_W; // NEW
            geo.height = LANE_H; // NEW
            model.setGeometry(lane, geo); // NEW
            if (laneKey === selectedWeekLaneKey) lane.setStyle(setStyleKey(lane.getStyle(), 'strokeWidth', '3')); // NEW
            if (model.isVisible && model.isVisible(lane) === false) model.setVisible(lane, true); // NEW
            x += LANE_W + LANE_GAP; // NEW
        }); // NEW

        Object.keys(lanes).forEach(laneKey => { // NEW
            const lane = lanes[laneKey]; // NEW
            if (!lane) return; // NEW
            if (!visibleSet.has(laneKey) && (!model.isVisible || model.isVisible(lane) !== false)) model.setVisible(lane, false); // NEW
        }); // NEW

        const totalW = 10 + (visibleKeys.length * LANE_W) + (Math.max(0, visibleKeys.length - 1) * LANE_GAP) + 10; // NEW
        const geo = board.getGeometry().clone(); // NEW
        geo.width = Math.max(totalW, BOARD_GEOM.w); // NEW
        geo.height = BOARD_GEOM.h; // NEW
        model.setGeometry(board, geo); // NEW
        graph.refresh(board); // NEW
    } // NEW

    function ensureLanes(board) {
        const existingByKey = {};
        const count = model.getChildCount(board);

        for (let i = 0; i < count; i++) {
            const ch = model.getChildAt(board, i);
            if (!model.isVertex(ch)) continue;

            const k = getAttr(ch, 'lane_key');
            if (k) existingByKey[k] = ch;
        }

        let x = 10;
        const y = 28;

        LANES.forEach((lane, idx) => {
            const fill = LANE_FILL[idx % LANE_FILL.length];
            const style = LANE_STYLE_BASE + 'fillColor=' + fill + ';strokeColor=' + fill + ';';

            let laneCell = existingByKey[lane.key];

            if (!laneCell) {
                laneCell = createVertex(lane.label, x, y, LANE_W, LANE_H, style);
                model.add(board, laneCell, idx); // CHANGE: insert in defined lane order
                setAttrNoUndo(laneCell, 'lane_key', lane.key, true); // CHANGE
                setAttrNoUndo(laneCell, 'status', lane.label, true); // CHANGE
                existingByKey[lane.key] = laneCell; // NEW
            } else {
                laneCell.setStyle(style);
                ensureXmlValue(laneCell).setAttribute('label', lane.label);
                setAttrNoUndo(laneCell, 'status', lane.label, true);

                // Keep existing boards visually aligned with the current LANES array. // NEW
                const geo = laneCell.getGeometry() ? laneCell.getGeometry().clone() : new mxGeometry(x, y, LANE_W, LANE_H);
                geo.x = x;       // NEW
                geo.y = y;       // NEW
                geo.width = LANE_W;   // NEW
                geo.height = LANE_H;  // NEW
                model.setGeometry(laneCell, geo); // NEW

                // Keep child order aligned with LANES order. // NEW
                if (model.getParent(laneCell) === board) {
                    model.add(board, laneCell, idx); // NEW
                }
            }

            graph.refresh(laneCell); // NEW
            x += LANE_W + LANE_GAP;
        });

        applyBoardViewLayout(board, existingByKey); // CHANGE
    }

    function lanesMap(board) { // FIX: build lane_key -> lane cell lookup for a board
        const out = {}; // FIX
        if (!board) return out; // FIX

        const n = model.getChildCount(board); // FIX
        for (let i = 0; i < n; i++) { // FIX
            const ch = model.getChildAt(board, i); // FIX
            if (!ch || !model.isVertex(ch)) continue; // FIX

            const laneKey = getAttr(ch, 'lane_key'); // FIX
            if (laneKey) out[laneKey] = ch; // FIX
        }

        return out; // FIX
    }

    // tiler group completed helpers

    function isTilerGroupCompleted(group) {                                              // NEW
        return getAttr(group, TG_COMPLETED_ATTR) === '1';                                // NEW
    }                                                                                    // NEW

    function setTilerGroupCompleted(group, completed) {                                   // NEW
        if (!group) return;                                                               // NEW
        setAttrNoUndo(group, TG_COMPLETED_ATTR, completed ? '1' : null, true);            // NEW (persist, no refresh)
    }                                                                                    // NEW

    function setStyleKey(style, key, val) {                                               // NEW
        const re = new RegExp("(^|;)" + key + "=[^;]*", "g");                             // NEW
        const cleaned = String(style || "").replace(re, "");                              // NEW
        const suffix = cleaned && !cleaned.endsWith(";") ? ";" : "";                      // NEW
        return cleaned + suffix + key + "=" + val + ";";                                  // NEW
    }                                                                                    // NEW

    function applyCompletedStyleToGroup(group, completed) {                     // CHANGE
        if (!group) return;                                                      // CHANGE

        const cur = group.getStyle ? (group.getStyle() || '') : (group.style || '');

        let next = cur;

        if (completed) {
            next = setStyleKey(next, 'fillStyle', 'zigzag-line');                // NEW
            next = setStyleKey(next, 'fillColor', '#FF3333');                    // NEW
            next = setStyleKey(next, 'strokeWidth', '3');                        // NEW
        } else {
            // remove only what we added                                          // NEW
            next = next.replace(/(^|;)fillStyle=zigzag-line(;|$)/g, '$1');       // NEW
            next = next.replace(/(^|;)fillColor=#FF3333(;|$)/g, '$1');            // NEW
            next = next.replace(/(^|;)strokeWidth=3(;|$)/g, '$1');               // NEW
        }

        if (next !== cur) {
            group.setStyle(next);                                                // CHANGE
        }
    }                                                                                    // NEW


    // Lane Helpers
    const PROTECTED_WORK_LANES = new Set(['TODO', 'DOING']);

    function isDoneLikeLane(laneKey) {
        return laneKey === 'DONE' || laneKey === 'DONE_WEEK' ||
            laneKey === 'DONE_MONTH' || laneKey === 'DONE_YEAR' ||
            laneKey === 'ARCHIVED';
    }

    function isWeekDayLane(laneKey) { // NEW
        return WEEK_DAY_LANE_KEYS.includes(String(laneKey || '')); // NEW
    } // NEW

    function isUpcomingLane(lk) {
        return lk === 'UPCOMING_FUTURE' || // NEW
            lk === 'UPCOMING_YEAR' ||
            lk === 'UPCOMING_MONTH' ||
            lk === 'UPCOMING_WEEK';
    }

    function isWorkLane(laneKey) {
        return laneKey === 'UPCOMING_FUTURE' || // NEW
            laneKey === 'UPCOMING_YEAR' ||
            laneKey === 'UPCOMING_MONTH' ||
            laneKey === 'UPCOMING_WEEK' ||
            laneKey === 'TODO_STAGED' ||
            isWeekDayLane(laneKey) || // NEW
            laneKey === 'TODO' ||
            laneKey === 'DOING';
    }

    // -------------------- Time helpers --------------------
    const MS_DAY = 86400000;

    function parseLocalISO(iso) { // CHANGE: task dates are local calendar days
        const parsed = parseTaskCalendarISO(iso); // CHANGE: share strict validation with manual shifting
        return parsed ? new Date(parsed.year, parsed.month - 1, parsed.day) : null; // CHANGE
    }

    function startOfLocalDay(d) { // CHANGE
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    function formatLocalISO(d) { // CHANGE
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function todayISO() {
        return formatLocalISO(startOfLocalDay(new Date())); // CHANGE
    }

    let kanbanViewReflowDepth = 0; // NEW

    function getSelectedWeekStart(board) { // NEW
        return getTaskWeekStartISO(getAttr(board, TASK_SELECTED_WEEK_START_ATTR)) || getTaskWeekStartISO(todayISO()); // NEW
    } // NEW

    function getSelectedDay(board) { // NEW
        const weekStart = getSelectedWeekStart(board); // NEW
        const raw = getAttr(board, TASK_SELECTED_DAY_ATTR); // NEW
        return clampTaskDayToWeek(parseTaskCalendarISO(raw) ? raw : weekStart, weekStart); // NEW
    } // NEW

    function getBoardViewMode(board) { // NEW
        return normalizeTaskViewMode(getAttr(board, TASK_VIEW_MODE_ATTR)); // NEW
    } // NEW

    function ensureBoardPlanningDefaults(board) { // NEW
        if (!board) return; // NEW
        const today = todayISO(); // NEW
        const weekStart = getTaskWeekStartISO(today); // NEW
        if (!getAttr(board, TASK_VIEW_MODE_ATTR)) setAttrNoUndo(board, TASK_VIEW_MODE_ATTR, 'FULL', true); // NEW
        if (!parseTaskCalendarISO(getAttr(board, TASK_SELECTED_WEEK_START_ATTR))) setAttrNoUndo(board, TASK_SELECTED_WEEK_START_ATTR, weekStart, true); // NEW
        if (!parseTaskCalendarISO(getAttr(board, TASK_SELECTED_DAY_ATTR))) setAttrNoUndo(board, TASK_SELECTED_DAY_ATTR, weekStart, true); // NEW
    } // NEW

    function runKanbanViewNoUndo(fn) { // NEW
        const undoManager = ui && ui.editor && ui.editor.undoManager; // NEW
        const beforeLength = undoManager && Array.isArray(undoManager.history) ? undoManager.history.length : null; // NEW
        const beforeIndex = undoManager && typeof undoManager.indexOfNextAdd === 'number' ? undoManager.indexOfNextAdd : null; // NEW
        kanbanViewReflowDepth += 1; // NEW
        try { // NEW
            return fn(); // NEW
        } finally { // NEW
            kanbanViewReflowDepth -= 1; // NEW
            if (beforeLength != null && undoManager.history.length > beforeLength) { // NEW
                undoManager.history.splice(beforeLength); // NEW
                if (beforeIndex != null) undoManager.indexOfNextAdd = Math.min(beforeIndex, undoManager.history.length); // NEW
            } // NEW
        } // NEW
    } // NEW

    function isKanbanViewReflowing() { // NEW
        return kanbanViewReflowDepth > 0; // NEW
    } // NEW

    function daysUntil(dateISO) { // CHANGE
        const dt = parseLocalISO(dateISO);
        if (!dt) return null;
        const today = startOfLocalDay(new Date());
        return Math.round((dt - today) / MS_DAY); // CHANGE: local day delta
    }

    function daysSince(dateISO) { // CHANGE
        const dt = parseLocalISO(dateISO);
        if (!dt) return null;
        const today = startOfLocalDay(new Date());
        return Math.round((today - dt) / MS_DAY); // CHANGE: local day delta
    }

    function daysBetween(aISO, bISO) { // CHANGE: returns a - b in local calendar days
        const a = parseLocalISO(aISO);
        const b = parseLocalISO(bISO);
        if (!a || !b) return null;
        return Math.round((a - b) / MS_DAY);
    }

    function hasCardDateOverride(card) { // NEW
        return getAttr(card, 'date_override') === '1';
    }

    function canEditCardDates(card) { // NEW: version one excludes every completed or archived lane
        if (!card || !isKanbanCard(card)) return false;
        if (!findBoardAncestor(card)) return false;
        if (!isEditableCardDateLane(laneKeyOfCard(card))) return false;
        return getTaskDateRange(card.value) != null;
    }

    function cloneCardValueWithAttributes(card, attributes) { // NEW: prepare one undoable value replacement
        const current = card && card.value;
        let clone = null;

        if (current && typeof current.cloneNode === 'function') {
            clone = current.cloneNode(true);
        } else {
            const doc = mxUtils.createXmlDocument();
            clone = doc.createElement('object');
            clone.setAttribute('label', typeof current === 'string' ? current : '');
        }

        Object.entries(attributes || {}).forEach(([key, value]) => {
            if (value == null) clone.removeAttribute(key);
            else clone.setAttribute(key, String(value));
        });

        return clone;
    }

    function commitCardPatch(card, attributes, opts) { // CHANGE: note and date edits share one undoable value replacement
        if (!card || !isKanbanCard(card)) return false;
        const shouldReflow = !!(opts && opts.reflow); // NEW
        const board = shouldReflow ? findBoardAncestor(card) : null; // NEW
        if (shouldReflow && !board) return false;

        model.beginUpdate();
        try {
            model.setValue(card, cloneCardValueWithAttributes(card, attributes)); // NEW
            if (shouldReflow) {
                scanAndReflowBoard(board, { insideUpdate: true }); // CHANGE
            } else {
                refreshCardLabel(card, true); // NEW: note-only edits do not need board classification
            }
        } finally {
            model.endUpdate();
        }

        if (!shouldReflow) graph.refresh(card); // NEW
        return true;
    }

    function applyCardDateOverride(card, newStartISO) { // NEW
        if (!canEditCardDates(card)) return false;
        const patch = buildCardDateOverridePatch(card.value, newStartISO);
        if (!patch || patch.changed === false) return false;
        return commitCardPatch(card, patch.attributes, { reflow: true }); // CHANGE
    }

    function resetCardDates(card) { // NEW
        if (!canEditCardDates(card) || !hasCardDateOverride(card)) return false;
        const patch = buildCardDateResetPatch(card.value);
        return patch ? commitCardPatch(card, patch, { reflow: true }) : false; // CHANGE
    }

    function getCardNote(card) { // NEW
        return normalizeCardNote(getAttr(card, CARD_NOTE_ATTR));
    }

    function setCardNote(card, note) { // NEW
        if (!card || !isKanbanCard(card)) return false;
        const patch = buildCardNotePatch(card.value, note);
        if (!patch || patch.changed === false) return false;
        return commitCardPatch(card, patch.attributes, { reflow: false });
    }

    function clearCardNote(card) { // NEW
        return setCardNote(card, '');
    }

    function fmtSigned(n) {
        if (n == null) return '';
        if (n > 0) return '+' + n;
        return String(n);
    }

    // -------------------- Classification --------------------
    function decideUpcomingLaneKey(startISO) {
        const du = daysUntil(startISO);
        if (du == null || du <= 0) return 'TODO_STAGED';
        if (du <= 7) return 'UPCOMING_WEEK';
        if (du <= 30) return 'UPCOMING_MONTH';
        if (du <= 365) return 'UPCOMING_YEAR';
        return 'UPCOMING_FUTURE'; // CHANGE
    }

    function classifyDoneLane(ageDays) {
        if (ageDays == null || ageDays < 1) return 'DONE';        // safety default
        if (ageDays <= 7) return 'DONE_WEEK';
        if (ageDays <= 30) return 'DONE_MONTH';
        if (ageDays <= 365) return 'DONE_YEAR';
        return 'ARCHIVED';
    }


    // -------------------- Badge helpers --------------------                                           
    function computeDaysToStart(startISO) {
        const n = daysUntil(startISO);
        return (n == null) ? null : n;
    }
    function computeDaysLeft(endISO) {
        const n = daysUntil(endISO);
        return (n == null) ? null : n;
    }
    function computeCompletedDelta(endISO, compISO) {
        if (!endISO) return null;
        const comp = compISO || todayISO();
        const delta = daysBetween(endISO, comp);  // end - completed
        if (delta == null) return null;
        if (delta === 0) return { text: 'On Time', numeric: 0 };
        if (delta > 0) return { text: delta + ' Days Early', numeric: delta };
        return { text: Math.abs(delta) + ' Days Late', numeric: delta };
    }
    function renderBadge(label, text) {
        if (text == null || text === '') return '';
        return '<span style="display:inline-block;margin:2px 4px 0 0;border:1px solid #000;padding:0 6px;border-radius:10px;font-size:11px;line-height:16px;vertical-align:middle;"><b>' +
            mxUtils.htmlEntities(label) + ':</b> ' + mxUtils.htmlEntities(String(text)) + '</span>';
    }
    function computeBadgesFor(card, laneKey) {
        const startISO = getAttr(card, 'start');
        const endISO = getAttr(card, 'end');
        const compISO = getAttr(card, 'completed');
        if (isUpcomingLane(laneKey)) {
            const dts = computeDaysToStart(startISO);
            return { primaryText: (dts == null ? '' : String(dts)), html: renderBadge('Days to Start', dts) };
        }
        if (isWorkLane(laneKey)) {
            const dl = computeDaysLeft(endISO);
            return { primaryText: (dl == null ? '' : String(dl)), html: renderBadge('Days Left', dl) };
        }
        // DONE-like lanes                                                                                
        const delta = computeCompletedDelta(endISO, compISO);
        const text = delta ? delta.text : '';
        const primary = delta ? (delta.numeric === 0 ? '0' : fmtSigned(delta.numeric)) : '';
        return { primaryText: primary, html: renderBadge('Completed Time', text) };
    }

    function getLinkCount(cell) {
        return getLinkSet(cell).size;
    }


    // -------------------- Sorting helpers --------------------                                             
    function tsFromISO(iso) {
        const d = parseLocalISO(iso);
        return d ? d.getTime() : null;
    }

    function getLaneSortKey(laneKey, card) {
        if (isUpcomingLane(laneKey)) {
            const dts = computeDaysToStart(getAttr(card, 'start'));
            return (dts == null) ? Number.POSITIVE_INFINITY : dts;
        }
        if (PROTECTED_WORK_LANES.has(laneKey)) {
            const dl = computeDaysLeft(getAttr(card, 'end'));
            return (dl == null) ? Number.POSITIVE_INFINITY : dl;
        }
        if (isDoneLikeLane(laneKey)) {
            const compISO = getAttr(card, 'completed') || getAttr(card, 'end');
            const t = tsFromISO(compISO);
            // Most recent first -> larger timestamp first                                                  
            return (t == null) ? Number.NEGATIVE_INFINITY : t;
        }
        return Number.POSITIVE_INFINITY;
    }

    function sortLaneCards(lane, laneKey, opts) {
        // Collect cards                                                                                    
        const items = [];
        const n = model.getChildCount(lane);
        for (let i = 0; i < n; i++) {
            const c = model.getChildAt(lane, i);
            if (model.isVertex(c) && isRenderableKanbanCard(c)) {                             // CHANGE
                const key = getLaneSortKey(laneKey, c);
                const title = (getAttr(c, 'title') || '').toLowerCase();
                items.push({ cell: c, key, title });
            }
        }
        if (!items.length) return [];

        // Choose comparator                                                                                
        let cmp;
        if (isDoneLikeLane(laneKey)) {
            // Descending by timestamp (recent first). Nulls already mapped to -INF so they end last.       
            cmp = (a, b) => (b.key - a.key) || a.title.localeCompare(b.title);
        } else {
            // Ascending. Nulls mapped to +INF so they end last.                                            
            cmp = (a, b) => (a.key - b.key) || a.title.localeCompare(b.title);
        }

        const sorted = items.slice().sort(cmp);

        // Reinsert in desired order                                                                        
        const insideUpdate = opts && opts.insideUpdate; // NEW
        if (!insideUpdate) model.beginUpdate(); // CHANGE
        try {
            for (let i = 0; i < sorted.length; i++) {
                const c = sorted[i].cell;
                model.add(lane, c, i);
            }
        } finally {
            if (!insideUpdate) model.endUpdate(); // CHANGE
        }

        // Return sorted card cells for paging                                                   
        return sorted.map(entry => entry.cell);
    }


    // -------------------- Paging helpers --------------------                                   

    function measureAverageCardHeight(lane) {
        let total = 0;
        let count = 0;
        const n = model.getChildCount(lane);
        for (let i = 0; i < n; i++) {
            const c = model.getChildAt(lane, i);
            if (!model.isVertex(c)) continue;
            if (!isRenderableKanbanCard(c)) continue;                                         // CHANGE
            const geo = c.getGeometry();
            if (!geo) continue;
            total += geo.height;
            count++;
        }
        return count > 0 ? (total / count) : 80;  // fallback to 80px if no cards                
    }

    function computeLanePageSize(lane) {
        const geo = lane.getGeometry();
        if (!geo) return 10;

        // Style-derived constants: startSize=1, stackBorder=20, spacingBottom=5                 
        const headerHeight = 1;
        const topPadding = 20;
        const bottomPadding = 5;
        const reserved = headerHeight + topPadding + bottomPadding;  // 26px                     

        const laneHeight = geo.height;
        const availableHeight = Math.max(0, laneHeight - reserved);

        const avgCardHeight = measureAverageCardHeight(lane);
        const STACK_SPACING = 20;  // from LANE_STYLE_BASE                                       
        const unitHeight = avgCardHeight + STACK_SPACING;

        if (unitHeight <= 0 || availableHeight <= 0) return 1;
        const pageSize = Math.floor(availableHeight / unitHeight);
        return Math.max(1, pageSize);
    }

    function getLanePageIndex(lane) {
        const raw = getAttr(lane, 'page_index');
        if (raw == null || raw === '') return 0;
        const n = parseInt(raw, 10);
        return Number.isNaN(n) ? 0 : n;
    }

    function setLanePageIndex(lane, idx) {
        setAttrNoUndo(lane, 'page_index', String(idx));
    }

    function clampLanePageIndex(pageIndex, totalCards, pageSize) {
        if (totalCards <= 0) return 0;
        const maxPageIndex = Math.max(0, Math.ceil(totalCards / pageSize) - 1);
        if (pageIndex < 0) return 0;
        if (pageIndex > maxPageIndex) return maxPageIndex;
        return pageIndex;
    }

    function countRenderable(cards) {                                                  // NEW
        let n = 0;                                                                     // NEW
        for (const c of (cards || [])) if (isRenderableKanbanCard(c)) n++;             // CHANGE
        return n;                                                                       // NEW
    }

    function applyLanePaging(lane, laneKey, sortedCards) {
        const total = sortedCards ? sortedCards.length : 0;
        const renderableTotal = countRenderable(sortedCards);                          // NEW

        let anyVisibilityChanged = false;
        let labelChanged = false;

        if (renderableTotal === 0) {
            setLanePageIndex(lane, 0);
            const baseLabel = getAttr(lane, 'status') || lane.value || '';
            const v = ensureXmlValue(lane);
            const oldLabel = v.getAttribute('label') || '';
            const newLabel = String(baseLabel);
            if (oldLabel !== newLabel) {
                v.setAttribute('label', newLabel);
                labelChanged = true;
            }
            if (labelChanged) {
                graph.refresh(lane);
            }
            return;
        }

        const pageSize = computeLanePageSize(lane);
        let pageIndex = getLanePageIndex(lane);
        pageIndex = clampLanePageIndex(pageIndex, renderableTotal, pageSize);
        setLanePageIndex(lane, pageIndex);

        const start = pageIndex * pageSize;
        const end = Math.min(start + pageSize, renderableTotal);
        let pageIdx = 0;                                                                   // NEW

        for (let i = 0; i < total; i++) {
            const card = sortedCards[i];

            if (!isRenderableKanbanCard(card)) continue;                                   // CHANGE: derived hidden cards never consume page slots

            const visible = (pageIdx >= start && pageIdx < end);                           // CHANGE
            pageIdx++;

            const curVisible = model.isVisible ? model.isVisible(card) : true;
            if (curVisible !== visible) {
                model.setVisible(card, visible);
                anyVisibilityChanged = true;
            }
        }

        const maxPageIndex = Math.max(0, Math.ceil(renderableTotal / pageSize) - 1);
        const baseLabel = getAttr(lane, 'status') || lane.value || '';
        const pageInfo = (maxPageIndex > 0)
            ? ` (Page ${pageIndex + 1} / ${maxPageIndex + 1})`
            : '';
        const v = ensureXmlValue(lane);
        const oldLabel = v.getAttribute('label') || '';
        const newLabel = String(baseLabel) + pageInfo;
        if (oldLabel !== newLabel) {
            v.setAttribute('label', newLabel);
            labelChanged = true;
        }

        if (anyVisibilityChanged || labelChanged) {
            graph.refresh(lane);
        }
    }

    function changeLanePage(lane, laneKey, delta) {
        if (!lane) return;
        const current = getLanePageIndex(lane);
        setLanePageIndex(lane, current + delta);

        const cards = getLaneCardsInOrder(lane);
        applyLanePaging(lane, laneKey, cards);
        ensureLanePagingControls(lane, laneKey, countRenderable(cards)); // CHANGE
    }


    function getLaneCardsInOrder(lane) {
        const out = [];
        if (!lane) return out;
        const n = model.getChildCount(lane);
        for (let i = 0; i < n; i++) {
            const c = model.getChildAt(lane, i);
            if (model.isVertex(c) && isRenderableKanbanCard(c)) {                             // CHANGE
                out.push(c);
            }
        }
        return out;
    }


    function resortAndPageLane(lane, laneKey, opts) {
        const sortedCards = sortLaneCards(lane, laneKey, opts) || [];
        applyLanePaging(lane, laneKey, sortedCards);
        ensureLanePagingControls(lane, laneKey, countRenderable(sortedCards)); // CHANGE
    }


    // Paging controls (overlays) for each lane                                                  
    function ensureLanePagingControls(lane, laneKey, renderableTotal) { // CHANGE
        if (!lane || renderableTotal == null) return;

        const pageSize = computeLanePageSize(lane);
        if (renderableTotal <= pageSize) { // CHANGE
            graph.removeCellOverlays(lane);
            setLanePageIndex(lane, 0);
            return;
        }

        let pageIndex = getLanePageIndex(lane);
        const maxPageIndex = Math.max(0, Math.ceil(renderableTotal / pageSize) - 1); // CHANGE
        pageIndex = clampLanePageIndex(pageIndex, renderableTotal, pageSize); // CHANGE
        setLanePageIndex(lane, pageIndex);

        graph.removeCellOverlays(lane);

        if (pageIndex > 0) {
            const upImage = new mxImage(ICON_PAGE_UP, 14, 14);
            const upOverlay = new mxCellOverlay(upImage, 'Page Up');
            upOverlay.align = mxConstants.ALIGN_RIGHT;
            upOverlay.verticalAlign = mxConstants.ALIGN_TOP;
            upOverlay.offset = new mxPoint(-4, 4);
            upOverlay.cursor = 'pointer';
            upOverlay.addListener(mxEvent.CLICK, function (_sender, evt) {
                changeLanePage(lane, laneKey, -1);
                if (evt && evt.consume) evt.consume();
            });
            graph.addCellOverlay(lane, upOverlay);
        }

        if (pageIndex < maxPageIndex) {
            const downImage = new mxImage(ICON_PAGE_DOWN, 14, 14);
            const downOverlay = new mxCellOverlay(downImage, 'Page Down');
            downOverlay.align = mxConstants.ALIGN_RIGHT;
            downOverlay.verticalAlign = mxConstants.ALIGN_BOTTOM;
            downOverlay.offset = new mxPoint(-4, -4);
            downOverlay.cursor = 'pointer';
            downOverlay.addListener(mxEvent.CLICK, function (_sender, evt) {
                changeLanePage(lane, laneKey, +1);
                if (evt && evt.consume) evt.consume();
            });
            graph.addCellOverlay(lane, downOverlay);
        }
    }


    // -------------------- Badge + label --------------------
    function refreshCardLabel(card, suppressRefresh) {
        if (getAttr(card, 'kanban_card') !== '1') return;
        const title = mxUtils.htmlEntities(getAttr(card, 'title') || 'Task');
        const parent = model.getParent(card);
        const laneKey = parent ? getAttr(parent, 'lane_key') : null;
        const badgesHtml = getAttr(card, 'badges_html') || '';
        const board = findBoardAncestor(card); // NEW
        const viewMode = board ? getBoardViewMode(board) : 'FULL'; // NEW

        const linkCount = getLinkCount(card);
        const linkBadge = (linkCount > 1) ? renderBadge('Links', linkCount) : '';
        const noteBadge = renderBadge('Note', getCardNote(card)); // NEW
        const editedDateBadge = hasCardDateOverride(card) ? renderBadge('Dates', 'Edited') : ''; // NEW
        const repeatBadge = renderBadge('Repeat', getAttr(card, REPEAT_BADGE_ATTR)); // NEW
        const stateBadge = viewMode === 'WEEK' && getEffectiveWorkflowState(card.value, laneKey) === 'DOING' ? renderBadge('State', 'DOING') : ''; // NEW
        const missingBadge = viewMode !== 'FULL' && getAttr(card, TASK_SCHEDULER_MISSING_ATTR) === '1' ? renderBadge('Scheduler', 'Missing') : ''; // NEW
        const incompleteBadge = viewMode !== 'FULL' ? renderBadge('Incomplete', getAttr(card, TASK_INCOMPLETE_DAY_ATTR)) : ''; // NEW

        const badgesBlock = (badgesHtml || stateBadge || missingBadge || incompleteBadge || repeatBadge || noteBadge || editedDateBadge || linkBadge) // CHANGE
            ? ('<br/>' + badgesHtml + stateBadge + missingBadge + incompleteBadge + repeatBadge + noteBadge + editedDateBadge + linkBadge) // CHANGE
            : '';

        const html = title + badgesBlock;

        ensureXmlValue(card).setAttribute('label', html);
        if (!suppressRefresh) {
            graph.refresh(card);
        }
    }




    function setBadge(card, text, suppressRefresh) {
        setAttrNoUndo(card, 'badge', text || '', suppressRefresh);
        // no refresh here; refreshCardLabel builds full badges block
    }

    function updateBadgeForLane(card, laneKey, suppressRefresh) {
        const oldBadge = getAttr(card, 'badge') || '';
        const oldHtml = getAttr(card, 'badges_html') || '';

        const badges = computeBadgesFor(card, laneKey);
        const newBadge = badges.primaryText || '';
        const newHtml = badges.html || '';

        if (oldBadge === newBadge && oldHtml === newHtml) {
            // Badges unchanged, but links may have changed, so always rebuild label //
            refreshCardLabel(card, suppressRefresh);
            return false;
        }

        setBadge(card, newBadge, true);
        setAttrNoUndo(card, 'badges_html', newHtml, true);
        refreshCardLabel(card, suppressRefresh);
        return true;
    }




    // Delete old / unlink tasks
    function removeTasksLinkedOnlyTo(targetGroupId, opts) { // CHANGE
        if (!targetGroupId) return []; // CHANGE

        const grp = model.getCell(targetGroupId);
        if (!grp) return []; // CHANGE

        const linkedCells = getLinkedCellsOf(grp) || [];
        if (!linkedCells.length) return []; // CHANGE

        const affectedBoards = new Map(); // NEW
        const groupLinkSet = getLinkSet(grp);

        model.beginUpdate();
        try {
            for (const c of linkedCells) {
                if (!isKanbanCard(c)) continue;

                const linkSet = getLinkSet(c);
                if (!linkSet || !linkSet.has(targetGroupId)) continue;

                const board = findBoardAncestor(c); // NEW
                if (board) affectedBoards.set(board.id, board); // NEW

                if (linkSet.size === 1) {
                    groupLinkSet.delete(c.id);
                    model.remove(c);
                } else {
                    linkSet.delete(targetGroupId);
                    setLinkSet(c, linkSet);

                    groupLinkSet.delete(c.id);
                }
            }

            setLinkSet(grp, groupLinkSet);

        } finally {
            model.endUpdate();
        }

        const boards = Array.from(affectedBoards.values()); // NEW

        const shouldReflow = !opts || opts.reflow !== false; // NEW
        if (shouldReflow) { // NEW
            boards.forEach(board => scanAndReflowBoard(board)); // NEW
        } // NEW

        return boards; // NEW
    }



    // -------------------- Task creation --------------------
    function createTasks(tasks, targetGroupId, opts) {
        if (!Array.isArray(tasks) || tasks.length === 0) return [];

        const reflow = !opts || opts.reflow !== false;

        let gardenModule = null;
        const grp = model.getCell(targetGroupId);
        if (grp) {
            const gm = findGardenModuleAncestor(grp);
            if (gm) gardenModule = gm;
        }

        const out = [];

        model.beginUpdate();
        try {
            const { board, lanes } = ensureBoardTemplateIn(gardenModule, { insideUpdate: true });   // CHANGE

            for (const t of tasks) {
                const laneKey = decideUpcomingLaneKey(t.startISO);
                const parentLane = lanes[laneKey] || lanes['TODO_STAGED'];

                const card = createCard(parentLane, {
                    title: t.title,
                    notes: t.notes,
                    startISO: t.startISO,
                    endISO: t.endISO
                }, /*suppressRefresh*/ true);

                if (t.method) setAttrNoUndo(card, 'method', t.method);
                if (t.plant_name) setAttrNoUndo(card, 'plant_name', t.plant_name);
                if (t.variety_name) setAttrNoUndo(card, 'variety_name', t.variety_name); // ADDED
                const schedulerAttrs = buildSchedulerTaskMetadataAttributes(t); // NEW
                Object.keys(schedulerAttrs).forEach(function (key) { setAttrNoUndo(card, key, schedulerAttrs[key]); }); // NEW

                if (grp) linkBothWays(grp, card);
                updateBadgeForLane(card, getAttr(parentLane, 'lane_key'));

                out.push({ cellId: card.id, title: t.title });
            }

            // Run scan only on the affected board inside the same transaction
            if (board && reflow) {
                scanAndReflowBoard(board, { insideUpdate: true });
            }

        } finally {
            model.endUpdate();
        }

        if (out.length) {
            const last = out // CHANGE: never select a newly collapsed or paged-out repeat occurrence
                .slice() // NEW
                .reverse() // NEW
                .map(entry => model.getCell(entry.cellId)) // NEW
                .find(cell => cell && isRenderableKanbanCard(cell) && (!model.isVisible || model.isVisible(cell))); // NEW
            if (last) {
                graph.setSelectionCell(last);
                graph.scrollCellToVisible(last, true);
            }
        }

        return out;
    }


    function createCard(parentLane, { title, notes, startISO, endISO }, suppressRefresh) {
        const card = createVertex('', 0, 0, 160, 80, CARD_STYLE);
        model.add(parentLane, card, model.getChildCount(parentLane));
        setAttrNoUndo(card, 'kanban_card', '1', /*suppressRefresh*/ !!suppressRefresh);
        setAttrNoUndo(card, 'title', title || 'Task', !!suppressRefresh);
        if (notes) setAttrNoUndo(card, 'notes', notes, !!suppressRefresh);
        const dateAttributes = buildInitialCardDateAttributes(startISO, endISO); // NEW
        if (dateAttributes) { // NEW
            Object.entries(dateAttributes).forEach(([key, value]) => { // NEW
                setAttrNoUndo(card, key, value, !!suppressRefresh); // NEW
            }); // NEW
        } else { // NEW: retain legacy tolerance for incomplete externally supplied tasks
            if (startISO) setAttrNoUndo(card, 'start', startISO, !!suppressRefresh); // CHANGE
            if (endISO) setAttrNoUndo(card, 'end', endISO, !!suppressRefresh); // CHANGE
        }
        const laneStatus = getAttr(parentLane, 'status') || parentLane.value || '';
        setAttrNoUndo(card, 'status', laneStatus, !!suppressRefresh);
        setAttrNoUndo(card, TASK_WORKFLOW_STATE_ATTR, 'STAGED', !!suppressRefresh); // NEW
        setAttrNoUndo(card, 'badge', '', !!suppressRefresh);
        setAttrNoUndo(card, 'badges_html', '', !!suppressRefresh);
        refreshCardLabel(card, !!suppressRefresh);
        return card;
    }




    // -------------------- Linking --------------------
    function getLinkSet(cell) {
        const raw = getAttr(cell, LINK_ATTR);
        if (!raw) return new Set();
        return new Set(String(raw).split(',').map(s => s.trim()).filter(Boolean));
    }
    function setLinkSet(cell, set) {
        setAttrNoUndo(cell, LINK_ATTR, Array.from(set).join(','));
        if (getAttr(cell, 'kanban_card') === '1') refreshCardLabel(cell);                  // refresh only for cards
    }
    function linkBothWays(a, b) {
        if (!a || !b || a === b) return false;
        const sa = getLinkSet(a), sb = getLinkSet(b);
        let changed = false;
        if (!sa.has(b.id)) { sa.add(b.id); setLinkSet(a, sa); changed = true; } // route via setLinkSet (refresh)
        if (!sb.has(a.id)) { sb.add(a.id); setLinkSet(b, sb); changed = true; } // route via setLinkSet (refresh)
        return changed;
    }
    function getLinkedCellsOf(cell) {
        const out = [];
        getLinkSet(cell).forEach(id => {
            const c = model.getCell(id);
            if (c && model.isVertex(c)) out.push(c);
        });
        return out;
    }

    function rememberBoardForTaskSync(affectedBoards, card) { // ADDED
        const board = findBoardAncestor(card); // ADDED
        if (board) affectedBoards.set(board.id, board); // ADDED
    } // ADDED

    function buildDifferentialTaskSyncRecords(targetGroupId) { // ADDED
        const grp = targetGroupId ? model.getCell(targetGroupId) : null; // ADDED
        if (!grp) return null; // ADDED
        const records = getLinkedCellsOf(grp) // ADDED
            .filter(cell => isKanbanCard(cell)) // ADDED
            .filter(card => getLinkSet(card).has(targetGroupId)) // ADDED
            .map(card => ({ card, source: card.value, schedulerTaskKey: getSchedulerTaskKey(card.value), laneKey: laneKeyOfCard(card) })); // CHANGE
        return { group: grp, records }; // ADDED
    } // ADDED

    function applyGeneratedTaskAttributesToCard(card, task, lanes) { // ADDED
        const attributes = buildGeneratedTaskSyncAttributesForExisting(card.value, task); // CHANGE
        model.setValue(card, cloneCardValueWithAttributes(card, attributes)); // ADDED
        if (!isSchedulerDateLocked(card.value)) putInLane(card, lanes, decideUpcomingLaneKey(task.startISO), true); // CHANGE
        refreshCardLabel(card, true); // ADDED
    } // ADDED

    function removeOrUnlinkGeneratedTaskCard(targetGroupId, card, affectedBoards) { // ADDED
        const grp = targetGroupId ? model.getCell(targetGroupId) : null; // ADDED
        if (!grp) return; // ADDED
        rememberBoardForTaskSync(affectedBoards, card); // ADDED
        const cardLinks = getLinkSet(card); // ADDED
        const groupLinks = getLinkSet(grp); // ADDED
        groupLinks.delete(card.id); // ADDED
        setLinkSet(grp, groupLinks); // ADDED
        if (cardLinks.size <= 1) { // ADDED
            model.remove(card); // ADDED
            return; // ADDED
        } // ADDED
        cardLinks.delete(targetGroupId); // ADDED
        setLinkSet(card, cardLinks); // ADDED
    } // ADDED

    function markGeneratedTaskCardMissing(card, affectedBoards) { // NEW
        rememberBoardForTaskSync(affectedBoards, card); // NEW
        model.setValue(card, cloneCardValueWithAttributes(card, { [TASK_SCHEDULER_MISSING_ATTR]: '1' })); // NEW
        refreshCardLabel(card, true); // NEW
    } // NEW

    function applyDifferentialTaskSync(opts) { // ADDED
        opts = opts || {}; // ADDED
        const targetGroupId = opts.targetGroupId; // ADDED
        const tasks = normalizeTaskList(opts.tasks); // ADDED
        const syncSource = buildDifferentialTaskSyncRecords(targetGroupId); // ADDED
        if (!syncSource) return []; // ADDED
        const plan = planDifferentialTaskSync(syncSource.records, tasks); // ADDED
        if (plan.legacyReplace) { // ADDED
            return applyImmediateTaskReplacement({ // ADDED
                targetGroupId: targetGroupId, // ADDED
                tasks: tasks, // ADDED
                removeTasks: removeTasksLinkedOnlyTo, // ADDED
                createTasks: createTasks // ADDED
            }); // ADDED
        } // ADDED
        if (!plan.updates.length && !plan.removes.length && !plan.missing.length) { // CHANGE
            if (plan.creates.length) createTasks(plan.creates.map(item => item.task), targetGroupId, { reflow: true }); // ADDED
            return plan; // ADDED
        } // ADDED

        const affectedBoards = new Map(); // ADDED
        const gardenModule = findGardenModuleAncestor(syncSource.group); // ADDED
        model.beginUpdate(); // ADDED
        try { // ADDED
            const template = ensureBoardTemplateIn(gardenModule, { insideUpdate: true }); // ADDED
            plan.updates.forEach(item => { // ADDED
                rememberBoardForTaskSync(affectedBoards, item.record.card); // ADDED
                applyGeneratedTaskAttributesToCard(item.record.card, item.task, template.lanes); // ADDED
                rememberBoardForTaskSync(affectedBoards, item.record.card); // ADDED
            }); // ADDED
            plan.removes.forEach(item => { // ADDED
                removeOrUnlinkGeneratedTaskCard(targetGroupId, item.record.card, affectedBoards); // ADDED
            }); // ADDED
            plan.missing.forEach(item => { // NEW
                markGeneratedTaskCardMissing(item.record.card, affectedBoards); // NEW
            }); // NEW
        } finally { // ADDED
            model.endUpdate(); // ADDED
        } // ADDED

        if (plan.creates.length) createTasks(plan.creates.map(item => item.task), targetGroupId, { reflow: true }); // ADDED
        affectedBoards.forEach(board => scanAndReflowBoard(board, { skipPurge: true })); // ADDED
        return plan; // ADDED
    } // ADDED


    // -------------------- Reflow logic --------------------

    function findBoardAncestor(cell) { // NEW
        let cur = cell; // NEW
        while (cur) { // NEW
            const key = getAttr(cur, 'board_key'); // NEW
            if (key === BOARD_KEY || key === LEGACY_KANBAN_BOARD_KEY) return cur; // CHANGE
            cur = model.getParent(cur); // NEW
        } // NEW
        return null; // NEW
    } // NEW

    function markDirtyLane(dirtyLanes, lane) { // NEW
        if (!dirtyLanes || !lane) return;
        const laneKey = getAttr(lane, 'lane_key');
        if (!laneKey) return;
        dirtyLanes.set(lane.id, { lane, laneKey });
    }

    function markDirtyCardLane(dirtyLanes, card) { // NEW
        if (!card) return;
        markDirtyLane(dirtyLanes, model.getParent(card));
    }

    function snapshotLaneCards(lane) { // NEW
        const out = [];
        if (!lane) return out;

        const n = model.getChildCount(lane);
        for (let i = 0; i < n; i++) {
            const c = model.getChildAt(lane, i);
            if (model.isVertex(c) && isKanbanCard(c)) {
                out.push(c);
            }
        }

        return out;
    }

    function snapshotBoardCardsByLane(lanes) { // NEW
        const snapshots = [];

        for (const laneDef of LANES) {
            const laneKey = laneDef.key;
            const lane = lanes[laneKey];
            if (!lane) continue;

            snapshots.push({
                lane,
                laneKey,
                cards: snapshotLaneCards(lane)
            });
        }

        return snapshots;
    }

    function getBoardRepeatRecords(board) { // NEW: collect current lanes only after all automatic moves finish
        const records = []; // NEW
        const lanes = boardLanes(board); // NEW

        snapshotBoardCardsByLane(lanes).forEach(snapshot => { // NEW
            snapshot.cards.forEach(card => { // NEW
                records.push({ // NEW
                    id: card.id, // NEW
                    card, // NEW
                    laneKey: snapshot.laneKey, // NEW
                    seriesKey: buildRepeatSeriesKey(card.value), // NEW
                    startISO: getAttr(card, 'start'), // NEW
                    endISO: getAttr(card, 'end'), // NEW
                    yearHidden: isYearHiddenCard(card), // NEW
                    expanded: getAttr(card, REPEAT_EXPANDED_ATTR) === '1' // NEW
                }); // NEW
            }); // NEW
        }); // NEW

        return records; // NEW
    } // NEW

    function setDerivedCardAttribute(card, key, value) { // NEW: derived attributes do not create separate undo steps
        const current = getAttr(card, key); // NEW
        const next = value == null || value === '' ? null : String(value); // NEW
        if ((current == null ? null : String(current)) === next) return false; // NEW
        setAttrNoUndo(card, key, next, true); // NEW
        return true; // NEW
    } // NEW

    function enforceRepeatHiddenVisibility(card) { // NEW
        if (!isRepeatHiddenCard(card)) return false; // NEW
        const cur = model.isVisible ? model.isVisible(card) : true; // NEW
        if (cur === false) return false; // NEW
        model.setVisible(card, false); // NEW
        graph.refresh(card); // NEW
        return true; // NEW
    } // NEW

    function rebuildRepeatVisibility(board, dirtyLanes) { // NEW: apply one pure visibility plan per board scan
        const records = getBoardRepeatRecords(board); // NEW
        const plan = planRepeatSeriesVisibility(records); // NEW
        const cardsById = new Map(records.map(record => [String(record.id || ''), record.card])); // NEW
        let changed = false; // NEW

        plan.forEach(item => { // NEW
            if (!item) return; // NEW
            const card = cardsById.get(String(item.id || '')); // NEW
            if (!card) return; // NEW

            const hiddenChanged = setDerivedCardAttribute( // NEW
                card, // NEW
                REPEAT_HIDDEN_ATTR, // NEW
                item.repeatHidden ? '1' : null // NEW
            ); // NEW
            const badgeChanged = setDerivedCardAttribute(card, REPEAT_BADGE_ATTR, item.repeatBadge || null); // NEW
            const visibilityChanged = item.repeatHidden ? enforceRepeatHiddenVisibility(card) : false; // NEW

            if (badgeChanged) refreshCardLabel(card, true); // NEW
            if (hiddenChanged || badgeChanged || visibilityChanged) { // NEW
                markDirtyCardLane(dirtyLanes, card); // NEW
                changed = true; // NEW
            } // NEW
        }); // NEW

        return changed; // NEW
    } // NEW

    function boardLanes(board) { return lanesMap(board); }

    function putInLane(card, lanes, laneKey, suppressRefresh) {
        const lane = lanes[laneKey];
        if (!lane) return false;
        if (model.getParent(card) === lane) {
            updateBadgeForLane(card, laneKey, suppressRefresh);
            return false;
        }
        model.add(lane, card, model.getChildCount(lane));
        const status = getAttr(lane, 'status') || lane.value || '';
        setAttrNoUndo(card, 'status', status, true);
        updateBadgeForLane(card, laneKey, suppressRefresh);
        return true;
    }


    // 2) Guard reclassifyUpcoming so it never moves cards out of protected lanes  
    function reclassifyUpcoming(card, lanes) {
        const parent = model.getParent(card);
        const curKey = parent ? getAttr(parent, 'lane_key') : null;
        if (curKey && PROTECTED_WORK_LANES.has(curKey)) {
            updateBadgeForLane(card, curKey, true);
            return false;
        }
        const startISO = getAttr(card, 'start');
        const laneKey = decideUpcomingLaneKey(startISO);
        return putInLane(card, lanes, laneKey, true);
    }

    function reclassifyDone(card, lanes) {
        let comp = getAttr(card, 'completed') || getAttr(card, 'end');
        if (!comp) {
            comp = todayISO();
            setAttrNoUndo(card, 'completed', comp, true);
        }
        const age = daysSince(comp);
        const target = classifyDoneLane(age);
        return putInLane(card, lanes, target, true);
    }

    function enforceYearHiddenVisibility(card) {                                       // NEW
        if (!isYearHiddenCard(card)) return false;                                     // NEW
        const cur = model.isVisible ? model.isVisible(card) : true;                    // NEW
        if (cur === false) return false;                                               // NEW
        model.setVisible(card, false);                                                 // NEW
        graph.refresh(card);                                                          // NEW (or graph.refresh(model.getParent(card)) )
        return true;                                                                   // NEW
    }                                                                                  // NEW

    function ensureWorkflowState(card, laneKey) { // NEW
        const current = normalizeWorkflowState(getAttr(card, TASK_WORKFLOW_STATE_ATTR)); // NEW
        if (current) return current; // NEW
        const derived = deriveWorkflowStateFromLaneKey(laneKey); // NEW
        setAttrNoUndo(card, TASK_WORKFLOW_STATE_ATTR, derived, true); // NEW
        return derived; // NEW
    } // NEW

    function clearCompletedForOpenState(card, state) { // NEW
        if (!isOpenWorkflowState(state) && state !== 'STAGED') return false; // NEW
        if (getAttr(card, 'completed') == null) return false; // NEW
        setAttrNoUndo(card, 'completed', null, true); // NEW
        return true; // NEW
    } // NEW

    function classifyFullViewLane(card, state, laneKey) { // NEW
        if (state === 'TODO' || state === 'DOING') return state; // NEW
        if (state === 'DONE') { // NEW
            let comp = getAttr(card, 'completed') || getAttr(card, TASK_ASSIGNED_DAY_ATTR) || getAttr(card, 'end'); // NEW
            if (!comp) { // NEW
                comp = todayISO(); // NEW
                setAttrNoUndo(card, 'completed', comp, true); // NEW
            } // NEW
            return classifyDoneLane(daysSince(comp)); // NEW
        } // NEW
        if (isPhysicallyOrManuallyStaged(card.value, laneKey)) return 'TODO_STAGED'; // NEW
        return decideUpcomingLaneKey(getAttr(card, 'start')); // NEW
    } // NEW

    function classifyPlanningViewLane(card, state, mode, selectedDay, selectedWeekStart, laneKey) { // NEW
        const assignedDay = getAttr(card, TASK_ASSIGNED_DAY_ATTR); // NEW
        const completedDay = getAttr(card, 'completed') || assignedDay; // NEW
        if (state === 'STAGED') return isPhysicallyOrManuallyStaged(card.value, laneKey) ? 'TODO_STAGED' : (isUpcomingLane(laneKey) ? laneKey : decideUpcomingLaneKey(getAttr(card, 'start'))); // NEW
        if (mode === 'WEEK') { // NEW
            if (state === 'DONE') return isTaskDateInWeek(completedDay, selectedWeekStart) ? 'DONE' : 'DONE_WEEK'; // NEW
            return getWeekLaneKeyForDate(assignedDay, selectedWeekStart) || state; // NEW
        } // NEW
        if (state === 'DONE') return completedDay === selectedDay ? 'DONE' : 'DONE_WEEK'; // NEW
        if (assignedDay === selectedDay) return state; // NEW
        return getWeekLaneKeyForDate(assignedDay, getTaskWeekStartISO(assignedDay)) || state; // NEW
    } // NEW

    function classifyCardForBoardView(card, board, laneKey) { // NEW
        const state = ensureWorkflowState(card, laneKey); // NEW
        const mode = getBoardViewMode(board); // NEW
        if (state !== 'DONE') clearCompletedForOpenState(card, state); // NEW
        if (mode === 'FULL') return classifyFullViewLane(card, state, laneKey); // NEW
        return classifyPlanningViewLane(card, state, mode, getSelectedDay(board), getSelectedWeekStart(board), laneKey); // NEW
    } // NEW


    // 3) Scan logic: skip auto-move for protected lanes; still refresh badges     
    function scanAndReflowBoard(board, opts) {
        if (!board) return;

        ensureBoardPlanningDefaults(board); // NEW
        const lanes = boardLanes(board);
        const insideUpdate = opts && opts.insideUpdate;
        const dirtyLanes = new Map(); // CHANGE
        let boardDirty = false;

        const snapshots = snapshotBoardCardsByLane(lanes); // CHANGE: stable snapshot before mutation

        if (!insideUpdate) model.beginUpdate();
        try {
            for (const snap of snapshots) {
                const sourceLane = snap.lane;
                const sourceLaneKey = snap.laneKey;

                for (const c of snap.cards) {
                    if (!c || !model.isVertex(c) || !isKanbanCard(c)) continue;

                    const beforeParent = model.getParent(c); // NEW

                    if (isYearHiddenCard(c)) {
                        if (enforceYearHiddenVisibility(c)) {
                            markDirtyLane(dirtyLanes, beforeParent); // CHANGE
                            boardDirty = true;
                        }
                        continue;
                    }

                    const targetLaneKey = classifyCardForBoardView(c, board, sourceLaneKey); // NEW
                    if (putInLane(c, lanes, targetLaneKey, true)) { // CHANGE
                        markDirtyLane(dirtyLanes, beforeParent); // CHANGE
                        markDirtyCardLane(dirtyLanes, c); // NEW
                        boardDirty = true;
                        continue; // NEW
                    } // NEW

                    if (updateBadgeForLane(c, targetLaneKey, true)) { // CHANGE
                        markDirtyLane(dirtyLanes, beforeParent); // NEW
                        boardDirty = true; // NEW
                    }
                }
            }

            if (rebuildRepeatVisibility(board, dirtyLanes)) { // NEW
                boardDirty = true; // NEW
            } // NEW

            // Sort/page only after all movements are complete. // CHANGE
            for (const { lane, laneKey } of dirtyLanes.values()) {
                resortAndPageLane(lane, laneKey, { insideUpdate: true }); // CHANGE
            }

            // Clean paging for untouched lanes without depending on child iteration order. // CHANGE
            for (const laneDef of LANES) {
                const laneKey = laneDef.key;
                const lane = lanes[laneKey];
                if (!lane || dirtyLanes.has(lane.id)) continue;

                const cards = getLaneCardsInOrder(lane);
                applyLanePaging(lane, laneKey, cards);
                ensureLanePagingControls(lane, laneKey, countRenderable(cards)); // CHANGE
            }

            if (boardDirty) {
                graph.refresh(board);
            }
        } finally {
            if (!insideUpdate) model.endUpdate();
        }
    }

    function scanAllBoards(opts) {
        const insideUpdate = opts && opts.insideUpdate;

        const containers = [];
        (function walk(p) {
            const n = model.getChildCount(p);
            for (let i = 0; i < n; i++) {
                const ch = model.getChildAt(p, i);
                if (!ch) continue;
                if (model.isVertex(ch) && isGardenModule(ch)) containers.push(ch);
                walk(ch);
            }
        })(model.getRoot());

        const targets = containers.length ? containers : [graph.getDefaultParent()];

        if (!insideUpdate) model.beginUpdate();
        try {
            targets.forEach(parent => {
                const { main, secondary } = findBoardsIn(parent);
                [main, ...secondary].filter(Boolean).forEach(function (board) { // CHANGE
                    scanAndReflowBoard(board, { insideUpdate: true }); // CHANGE
                });
            });
        } finally {
            if (!insideUpdate) model.endUpdate();
        }
    }

    // -------------------- Kanban / Group helpers --------------------
    function isKanbanCard(cell) { return getAttr(cell, 'kanban_card') === '1'; }

    function isTilerGroup(cell) {
        return !isKanbanCard(cell) && (
            getAttr(cell, 'tiler_group') === '1'
        );
    }

    function laneKeyOfCard(card) {
        const p = model.getParent(card);
        return p ? getAttr(p, 'lane_key') : null;
    }

    function allLinkedCardsDone(group) {
        const cards = getLinkedCellsOf(group).filter(isKanbanCard);
        if (cards.length === 0) return null;  // indicates "no linked cards"
        return cards.every(c => {
            const lk = laneKeyOfCard(c);
            return lk && isDoneLikeLane(lk);
        });
    }

    function updateGroupRenderState(group, opts) {                                             // CHANGE
        if (!group || !isTilerGroup(group)) return;                                       // CHANGE
        const cards = getLinkedCellsOf(group).filter(isKanbanCard);                       // CHANGE

        if (cards.length === 0) {
            const edges = graph.getEdges(group, null, true, true, true) || [];
            const insideUpdate = opts && opts.insideUpdate; // NEW
            if (!insideUpdate) model.beginUpdate(); // CHANGE
            try {
                edges.forEach(e => model.remove(e));
                model.remove(group);
            } finally {
                if (!insideUpdate) model.endUpdate(); // CHANGE
            }
            return;
        }

        // Completion is a state, not visibility                                           // NEW
        const allDone = allLinkedCardsDone(group) === true;                               // CHANGE
        const wasDone = isTilerGroupCompleted(group);                                     // NEW

        if (allDone === wasDone) return;                                                  // NEW (no change)

        const insideUpdate = opts && opts.insideUpdate; // NEW
        if (!insideUpdate) model.beginUpdate(); // CHANGE
        try {
            setTilerGroupCompleted(group, allDone);
            applyCompletedStyleToGroup(group, allDone);
        } finally {
            if (!insideUpdate) model.endUpdate(); // CHANGE
        }

        graph.refresh(group);                                                             // CHANGE
    }                                                                                    // CHANGE


    function updateRenderForGroupsLinkedTo(card) {
        if (!card) return;
        getLinkedCellsOf(card)
            .filter(isTilerGroup)
            .forEach(updateGroupRenderState);
    }

    function isYearHiddenCard(card) {                                                 // NEW
        return getAttr(card, 'year_hidden') === '1';                                  // NEW
    }                                                                                 // NEW

    function isRepeatHiddenCard(card) {                                               // NEW
        return getAttr(card, REPEAT_HIDDEN_ATTR) === '1';                             // NEW
    }                                                                                 // NEW

    function isRenderableKanbanCard(card) {                                           // NEW
        return isKanbanCard(card) && isCardVisibilityEligible(card.value);            // CHANGE
    }                                                                                 // NEW

    function getKanbanChildSiblings(parent) { // NEW: duplicate lane checks need the target board's current children
        const out = []; // NEW
        if (!parent) return out; // NEW
        const count = model.getChildCount(parent); // NEW
        for (let i = 0; i < count; i++) out.push(model.getChildAt(parent, i)); // NEW
        return out; // NEW
    } // NEW

    function canPlaceKanbanChild(parent, child) { // NEW: runtime adapter for the pure kanban parenting policy
        return canParentKanbanCell(parent, child, { laneKeys: KANBAN_LANE_KEYS, siblings: getKanbanChildSiblings(parent) }); // NEW
    } // NEW

    function buildLaneDropWorkflowPatch(card, board, laneKey) { // NEW
        if (!card || !board) return null; // NEW
        const mode = getBoardViewMode(board); // NEW
        const weekStart = getSelectedWeekStart(board); // NEW
        const selectedDay = getSelectedDay(board); // NEW
        const ctx = { mode, selectedDay, selectedWeekStart: weekStart, today: todayISO() }; // NEW
        if (isWeekDayLane(laneKey)) { // NEW
            ctx.dropDay = getDateForWeekLaneKey(laneKey, weekStart); // NEW
            return buildWorkflowPatch(card.value, 'TODO', ctx); // NEW
        } // NEW
        if (laneKey === 'TODO' || laneKey === 'DOING' || laneKey === 'DONE') return buildWorkflowPatch(card.value, laneKey, ctx); // NEW
        if (laneKey === 'TODO_STAGED' || isUpcomingLane(laneKey)) return buildWorkflowPatch(card.value, 'STAGED', Object.assign(ctx, { manualStaged: laneKey === 'TODO_STAGED' })); // NEW
        if (isDoneLikeLane(laneKey)) return buildWorkflowPatch(card.value, 'DONE', ctx); // NEW
        return null; // NEW
    } // NEW

    function applyCardPatchInsideUpdate(card, attributes) { // NEW
        if (!card || !attributes) return false; // NEW
        model.setValue(card, cloneCardValueWithAttributes(card, attributes)); // NEW
        refreshCardLabel(card, true); // NEW
        return true; // NEW
    } // NEW

    function shouldInspectKanbanPlacement(parent, child) { // NEW: limit safety repairs to kanban structures and locked kanban cells
        const parentType = getKanbanCellType(parent, KANBAN_LANE_KEYS); // NEW
        const childType = getKanbanCellType(child, KANBAN_LANE_KEYS); // NEW
        return parentType === 'board' || parentType === 'lane' || childType === 'lane' || childType === 'card'; // NEW
    } // NEW

    function isInvalidKanbanPlacement(cell) { // NEW: current parent violates the board/lane/card structure
        const parent = model.getParent(cell); // NEW
        return !!parent && shouldInspectKanbanPlacement(parent, cell) && !canPlaceKanbanChild(parent, cell); // NEW
    } // NEW

    function addBoardForKanbanParent(map, parent) { // NEW: board rescans stay scoped to touched kanban structures
        const board = parent ? findBoardAncestor(parent) : null; // NEW
        if (board && board.id) map.set(board.id, board); // NEW
    } // NEW

    function parentAbsoluteOrigin(parent) { // NEW: geometry conversion for preserving position during ejection
        let x = 0; // NEW
        let y = 0; // NEW
        let cur = parent; // NEW
        while (cur) { // NEW
            const geo = model.getGeometry(cur); // NEW
            if (geo) { x += Number(geo.x) || 0; y += Number(geo.y) || 0; } // NEW
            cur = model.getParent(cur); // NEW
        } // NEW
        return { x, y }; // NEW
    } // NEW

    function moveCellToParentPreservingPosition(cell, parent) { // NEW: safety repair should not visually teleport malformed cells
        if (!cell || !parent || model.getParent(cell) === parent) return false; // NEW
        const geo = model.getGeometry(cell); // NEW
        const currentParent = model.getParent(cell); // NEW
        const currentOrigin = parentAbsoluteOrigin(currentParent); // NEW
        const targetOrigin = parentAbsoluteOrigin(parent); // NEW
        const nextGeo = geo && geo.clone ? geo.clone() : null; // NEW
        if (nextGeo) { // NEW
            nextGeo.x = (Number(geo.x) || 0) + currentOrigin.x - targetOrigin.x; // NEW
            nextGeo.y = (Number(geo.y) || 0) + currentOrigin.y - targetOrigin.y; // NEW
        } // NEW
        model.add(parent, cell, model.getChildCount(parent)); // NEW
        if (nextGeo) model.setGeometry(cell, nextGeo); // NEW
        return true; // NEW
    } // NEW

    function nearestNonKanbanParent(cell) { // NEW: fallback quarantine for imported malformed children without a valid origin
        let cur = model.getParent(model.getParent(cell)); // NEW
        while (cur) { // NEW
            const type = getKanbanCellType(cur, KANBAN_LANE_KEYS); // NEW
            if (type !== 'board' && type !== 'lane') return cur; // NEW
            cur = model.getParent(cur); // NEW
        } // NEW
        return graph.getDefaultParent ? graph.getDefaultParent() : null; // NEW
    } // NEW

    function safeKanbanRepairParent(cell, previousParent) { // NEW: prefer true drag revert, otherwise eject from the kanban container
        if (previousParent && canPlaceKanbanChild(previousParent, cell)) return previousParent; // NEW
        return nearestNonKanbanParent(cell); // NEW
    } // NEW

    function repairInvalidKanbanPlacements(invalidPlacements, affectedBoards) { // NEW: safety net for malformed/imported structures
        let changed = false; // NEW
        (invalidPlacements || []).forEach(entry => { // NEW
            const cell = entry && entry.cell; // NEW
            if (!cell || !isInvalidKanbanPlacement(cell)) return; // NEW
            const currentParent = model.getParent(cell); // NEW
            const repairParent = safeKanbanRepairParent(cell, entry.previousParent); // NEW
            if (!repairParent || repairParent === currentParent) return; // NEW
            addBoardForKanbanParent(affectedBoards, currentParent); // NEW
            addBoardForKanbanParent(affectedBoards, repairParent); // NEW
            if (moveCellToParentPreservingPosition(cell, repairParent)) changed = true; // NEW
        }); // NEW
        return changed; // NEW
    } // NEW

    function installKanbanParentingGuards() { // NEW: block invalid drag/drop before draw.io mutates the model
        if (graph.__trellisKanbanParentingGuardsInstalled) return; // NEW
        graph.__trellisKanbanParentingGuardsInstalled = true; // NEW

        const originalIsValidDropTarget = graph.isValidDropTarget; // NEW
        graph.isValidDropTarget = function (target, cells, evt) { // NEW
            const dragged = Array.isArray(cells) ? cells : []; // NEW
            if (target && dragged.some(cell => !canPlaceKanbanChild(target, cell))) return false; // NEW
            return originalIsValidDropTarget ? originalIsValidDropTarget.apply(this, arguments) : true; // NEW
        }; // NEW

        const originalMoveCells = graph.moveCells; // NEW
        graph.moveCells = function (cells, dx, dy, clone, target, evt, mapping) { // NEW
            const moved = Array.isArray(cells) ? cells : []; // NEW
            if (target && moved.some(cell => !canPlaceKanbanChild(target, cell))) return moved; // NEW
            const targetLaneKey = target && getAttr(target, 'lane_key'); // NEW
            if (!targetLaneKey || clone) return originalMoveCells.apply(this, arguments); // NEW
            const targetBoard = findBoardAncestor(target); // NEW
            if (!targetBoard || !moved.some(cell => cell && isKanbanCard(cell))) return originalMoveCells.apply(this, arguments); // NEW
            let result; // NEW
            model.beginUpdate(); // NEW
            try { // NEW
                result = originalMoveCells.apply(this, arguments); // NEW
                moved.filter(cell => cell && isKanbanCard(cell)).forEach(card => { // NEW
                    const patch = buildLaneDropWorkflowPatch(card, targetBoard, targetLaneKey); // NEW
                    if (patch && patch.attributes) applyCardPatchInsideUpdate(card, patch.attributes); // NEW
                }); // NEW
                scanAndReflowBoard(targetBoard, { insideUpdate: true }); // NEW
            } finally { // NEW
                model.endUpdate(); // NEW
            } // NEW
            return result; // NEW
        }; // NEW
    } // NEW

    installKanbanParentingGuards(); // NEW




    // -------------------- Auto-status, badges, and DONE autopromotion --------------------
    let pendingRepairCards = new Set(); // NEW
    let pendingRepairBoards = new Set(); // NEW
    let pendingInvalidKanbanPlacements = new Map(); // NEW
    let repairTimer = null; // NEW

    function collectChangedKanbanCards(edit) {
        const out = new Set();
        const boards = new Set(); // NEW
        const invalidPlacements = new Map(); // NEW
        if (isKanbanViewReflowing()) return { cards: out, boards, invalidPlacements }; // NEW
        if (!edit || !edit.changes) return { cards: out, boards, invalidPlacements }; // CHANGE

        for (const ch of edit.changes) {
            let cell = null;
            let previousParent = null; // NEW
            let currentParent = null; // NEW

            if (ch instanceof mxChildChange) {
                cell = ch.child;

                previousParent = ch.previous; // CHANGE
                currentParent = model.getParent(cell); // CHANGE

                if (cell && currentParent && shouldInspectKanbanPlacement(currentParent, cell) && !canPlaceKanbanChild(currentParent, cell)) { // NEW
                    invalidPlacements.set(cell.id || String(invalidPlacements.size), { cell, previousParent }); // NEW
                } // NEW

                if (previousParent === currentParent) { // CHANGE
                    continue; // CHANGE: skip same-lane reorder while retaining cross-board moves to equivalent lanes
                }
            } else if (ch instanceof mxValueChange) {
                cell = ch.cell;
            } else if (ch instanceof mxStyleChange) {
                cell = ch.cell;
            } else if (ch instanceof mxGeometryChange) {
                continue; // CHANGE: geometry drag changes should not trigger board repair
            }

            if (!cell || !model.isVertex(cell) || !isKanbanCard(cell)) continue;

            const previousBoard = previousParent ? findBoardAncestor(previousParent) : null; // NEW
            const currentBoard = findBoardAncestor(currentParent || cell); // NEW
            if (previousBoard) boards.add(previousBoard); // NEW
            if (currentBoard) boards.add(currentBoard); // NEW
            if (isYearHiddenCard(cell)) continue; // CHANGE: rescan its board without applying lane-status repair
            out.add(cell); // CHANGE
        }

        return { cards: out, boards, invalidPlacements }; // CHANGE
    }

    function scheduleKanbanRepair(cards, boards, invalidPlacements) { // CHANGE
        const hasCards = cards && cards.size > 0; // NEW
        const hasBoards = boards && boards.size > 0; // NEW
        const hasInvalidPlacements = invalidPlacements && invalidPlacements.size > 0; // NEW
        if (!hasCards && !hasBoards && !hasInvalidPlacements) return; // CHANGE

        if (hasCards) cards.forEach(card => pendingRepairCards.add(card)); // CHANGE
        if (hasBoards) boards.forEach(board => pendingRepairBoards.add(board)); // NEW
        if (hasInvalidPlacements) invalidPlacements.forEach((entry, key) => pendingInvalidKanbanPlacements.set(key, entry)); // NEW

        if (repairTimer != null) return;

        repairTimer = setTimeout(function () {
            repairTimer = null;

            const cardsToRepair = Array.from(pendingRepairCards);
            const boardsToRepair = Array.from(pendingRepairBoards); // NEW
            const invalidPlacementsToRepair = Array.from(pendingInvalidKanbanPlacements.values()); // NEW
            pendingRepairCards.clear();
            pendingRepairBoards.clear(); // NEW
            pendingInvalidKanbanPlacements.clear(); // NEW

            repairChangedCards(cardsToRepair, boardsToRepair, invalidPlacementsToRepair); // CHANGE
        }, 0);
    }

    function repairChangedCards(cards, boards, invalidPlacements) { // CHANGE
        if ((!cards || cards.length === 0) && (!boards || boards.length === 0) && (!invalidPlacements || invalidPlacements.length === 0)) return; // CHANGE

        const affectedBoards = new Map(); // NEW
        const touchedGroups = new Set();
        (boards || []).forEach(board => { // NEW
            if (board && board.id) affectedBoards.set(board.id, board); // NEW
        }); // NEW

        model.beginUpdate();
        try {
            repairInvalidKanbanPlacements(invalidPlacements, affectedBoards); // NEW

            for (const cell of (cards || [])) { // CHANGE
                if (!cell || !model.isVertex(cell) || !isKanbanCard(cell)) continue;
                if (isYearHiddenCard(cell)) continue;

                const parent = model.getParent(cell);
                if (!parent) continue;

                const laneKey = getAttr(parent, 'lane_key');
                if (!laneKey) continue;

                const currentBoard = findBoardAncestor(parent); // NEW
                if (currentBoard && currentBoard.id) affectedBoards.set(currentBoard.id, currentBoard); // NEW

                const laneStatus = getAttr(parent, 'status') || parent.value || '';
                setAttrNoUndo(cell, 'status', laneStatus, true); // CHANGE
                updateBadgeForLane(cell, laneKey, true); // CHANGE

                getLinkedCellsOf(cell).filter(isTilerGroup).forEach(g => touchedGroups.add(g.id)); // NEW
            }

            affectedBoards.forEach(board => scanAndReflowBoard(board, { insideUpdate: true })); // NEW

            touchedGroups.forEach(id => {
                const group = model.getCell(id);
                if (!group) return;
                updateGroupRenderState(group, { insideUpdate: true }); // CHANGE
            });

        } finally {
            model.endUpdate();
        }
    }

    model.addListener(mxEvent.CHANGE, function (_sender, evt) {
        const edit = evt.getProperty('edit');
        const changes = collectChangedKanbanCards(edit); // CHANGE
        scheduleKanbanRepair(changes.cards, changes.boards, changes.invalidPlacements); // CHANGE: defer mutation out of CHANGE event
    });


    graph.addListener('linksChanged', function (_sender, evt) {
        const deletedIdArr = evt.getProperty('deletedIds') || [];
        const impactedIdArr = evt.getProperty('impactedIds') || [];
        if ((!deletedIdArr || deletedIdArr.length === 0) && impactedIdArr.length === 0) {
            console.warn('[Kanban] linksChanged: no deletedIds/impactedIds payload');
            return;
        }

        const deletedIds = new Set(deletedIdArr);
        const impactedIds = new Set(impactedIdArr);

        const toDelete = [];
        const deletedCards = [];
        const debug = [];
        let cardsSeen = 0, cardsLinkedToDeleted = 0, cardsWithSurvivors = 0, cardsNoLinks = 0;
        let removedCount = 0;

        function forEachCandidate(fn) {
            if (impactedIds.size > 0) {
                impactedIds.forEach(id => {
                    const c = model.getCell(id);
                    if (c && model.isVertex(c) && isKanbanCard(c)) fn(c);
                });
            } else {
                (function walk(p) {
                    const n = model.getChildCount(p);
                    for (let i = 0; i < n; i++) {
                        const ch = model.getChildAt(p, i);
                        if (!ch) continue;
                        if (model.isVertex(ch) && isKanbanCard(ch)) fn(ch);
                        walk(ch);
                    }
                })(model.getRoot());
            }
        }

        model.beginUpdate();
        try {
            // --- clean groups regardless of card deletion outcome -------------------------
            (function cleanGroupsAndReevaluate() {
                if (!deletedIds || deletedIds.size === 0) return;
                const touchedGroups = new Set();
                (function walk(p) {
                    const n = model.getChildCount(p);
                    for (let i = 0; i < n; i++) {
                        const ch = model.getChildAt(p, i);
                        if (!ch) continue;
                        if (model.isVertex(ch) && isTilerGroup(ch)) {
                            const links = getLinkSet(ch);
                            let changed = false;
                            deletedIds.forEach(id => {
                                if (links.has(id)) { links.delete(id); changed = true; }
                            });
                            if (changed) {
                                setLinkSet(ch, links);                                   // keeps undo; no label refresh for non-cards
                                touchedGroups.add(ch.id);
                            }
                        }
                        walk(ch);
                    }
                })(model.getRoot());

                touchedGroups.forEach(id => {
                    const g = model.getCell(id);
                    if (g) updateGroupRenderState(g);                                    // hide or delete now
                });
            })();
            // ------------------------------------------------------------------------------

            // Decide per candidate
            forEachCandidate(function (card) {
                cardsSeen++;

                // Current link set for this card
                const linkSet = getLinkSet(card);
                const beforeSize = linkSet.size;

                if (beforeSize === 0) {
                    // Already has no links -> delete according to rule
                    cardsNoLinks++;
                    toDelete.push(card);
                    debug.push(`[Orphan] card ${card.id} (${getAttr(card, 'title') || 'Untitled'}) had no links pre-cleanup → delete`);
                    return;
                }

                // Remove any references to deletedIds
                let removedAny = false;
                deletedIds.forEach(function (id) {
                    if (linkSet.has(id)) {
                        linkSet.delete(id);
                        removedAny = true;
                    }
                });

                const afterSize = linkSet.size;

                if (!removedAny && afterSize > 0) {
                    // Card not affected: still has non-deleted links
                    debug.push(`[Skip] card ${card.id} still linked to ${afterSize} survivors; no change`);
                    return;
                }

                if (afterSize === 0) {
                    // All links were to deleted ids -> orphan -> delete
                    cardsLinkedToDeleted++;
                    cardsNoLinks++;
                    setLinkSet(card, linkSet);
                    toDelete.push(card);
                    debug.push(`[Delete] card ${card.id} all links pointed to deletedIds; now orphaned → delete`);
                } else {
                    // Still has surviving links: keep, but persist pruned set
                    cardsLinkedToDeleted++;
                    cardsWithSurvivors++;
                    setLinkSet(card, linkSet);
                    debug.push(`[Keep] card ${card.id} pruned to ${afterSize} surviving links`);
                }
            });

            // Apply deletions inside same update
            if (toDelete.length > 0) {
                for (const c of toDelete) {
                    deletedCards.push({ id: c.id, title: getAttr(c, 'title') || 'Untitled' });
                    const edges = graph.getEdges(c, null, true, true, true) || [];
                    edges.forEach(e => model.remove(e));
                    model.remove(c);
                    removedCount++;
                }
            }

        } finally {
            model.endUpdate();
        }

        if (removedCount === 0) {
            console.log(`[Kanban] Orphan cleanup summary: deletedIds=${deletedIdArr.length}, cardsSeen=${cardsSeen}, linkedToDeleted=${cardsLinkedToDeleted}, survivors=${cardsWithSurvivors}, noLinks=${cardsNoLinks}, removed=0`);
            console.log('[Kanban] No cards removed. Detailed traces:\n' + debug.join('\n'));
        } else {
            console.log(`[Kanban] Orphan cleanup summary: deletedIds=${deletedIdArr.length}, cardsSeen=${cardsSeen}, linkedToDeleted=${cardsLinkedToDeleted}, survivors=${cardsWithSurvivors}, noLinks=${cardsNoLinks}, removed=${removedCount}`);
            console.log('[Kanban] Deleted cards:');
            deletedCards.forEach(c => console.log(`  - ${c.id}: ${c.title}`));
        }
    });



    // -------------------- Board selection scan --------------------
    graph.getSelectionModel().addListener(mxEvent.CHANGE, function () {
        const sel = graph.getSelectionCell();
        if (!sel || !model.isVertex(sel)) return;
        const key = getAttr(sel, 'board_key');
        if (key === BOARD_KEY || key === 'MAIN_KANBAN_BOARD') {
            scanAndReflowBoard(sel);
        }
    });

    function findBoardsIn(parent) {
        const out = { main: null, secondary: [] };
        if (!parent) return out;
        const n = model.getChildCount(parent);
        for (let i = 0; i < n; i++) {
            const c = model.getChildAt(parent, i);
            if (!model.isVertex(c)) continue;
            const key = getAttr(c, 'board_key');
            if (key !== BOARD_KEY && key !== 'MAIN_KANBAN_BOARD') continue;
            const role = getAttr(c, BOARD_ROLE_ATTR);
            const isMain = role === 'main' || key === 'MAIN_KANBAN_BOARD';
            if (isMain && !out.main) out.main = c;
            else out.secondary.push(c);
        }
        return out;
    }

    function showEditCardDialog(card) { // CHANGE: notes are editable on every Kanban card
        if (!card || !isKanbanCard(card)) return;

        const datesEditableAtOpen = canEditCardDates(card); // NEW
        const currentRange = datesEditableAtOpen ? getTaskDateRange(card.value) : null; // CHANGE
        const currentNote = getCardNote(card); // NEW

        const div = document.createElement('div');
        div.style.padding = '12px';
        div.style.boxSizing = 'border-box';
        div.style.fontFamily = 'Arial, sans-serif';

        const heading = document.createElement('div');
        heading.textContent = 'Edit Card'; // CHANGE
        heading.style.fontSize = '16px';
        heading.style.fontWeight = 'bold';
        heading.style.marginBottom = '12px';
        div.appendChild(heading);

        function addRow(labelText, input) { // NEW
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '10px';
            row.style.marginBottom = '10px';

            const label = document.createElement('label');
            label.textContent = labelText;
            label.style.width = '85px';
            label.style.flex = '0 0 85px';
            input.style.flex = '1';

            row.appendChild(label);
            row.appendChild(input);
            div.appendChild(row);
        }

        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.readOnly = true;
        titleInput.value = getAttr(card, 'title') || 'Task';
        addRow('Title:', titleInput);

        const noteInput = document.createElement('input'); // NEW
        noteInput.type = 'text'; // NEW
        noteInput.value = currentNote; // NEW
        noteInput.placeholder = 'Short card note'; // NEW
        addRow('Note:', noteInput); // NEW

        const noteFeedback = document.createElement('div'); // NEW
        noteFeedback.style.margin = '-6px 0 10px 95px'; // NEW
        noteFeedback.style.fontSize = '12px'; // NEW
        div.appendChild(noteFeedback); // NEW

        let startInput = null; // CHANGE
        let endInput = null; // CHANGE

        if (datesEditableAtOpen && currentRange) { // CHANGE: completed cards receive a note-only dialog
            startInput = document.createElement('input');
            startInput.type = 'date';
            startInput.required = true;
            startInput.value = currentRange.startISO;
            addRow('Start date:', startInput);

            endInput = document.createElement('input');
            endInput.type = 'date';
            endInput.readOnly = true;
            endInput.value = currentRange.endISO;
            addRow('End date:', endInput);
        }

        const error = document.createElement('div');
        error.style.color = '#b91c1c';
        error.style.minHeight = '18px';
        error.style.fontSize = '12px';
        error.style.marginBottom = '8px';
        div.appendChild(error);

        function updateNoteFeedback() { // NEW
            const collapsed = String(noteInput.value || '').replace(/\s+/g, ' ').trim(); // NEW
            const length = Array.from(collapsed).length; // NEW
            noteFeedback.textContent = length + '/' + CARD_NOTE_MAX_LENGTH; // NEW
            noteFeedback.style.color = length > CARD_NOTE_MAX_LENGTH ? '#b91c1c' : '#6b7280'; // NEW
        }

        function updateComputedEnd() { // CHANGE
            if (!startInput || !endInput || !currentRange) return null; // NEW
            const nextEnd = shiftTaskCalendarISO(startInput.value, currentRange.durationDays);
            endInput.value = nextEnd || '';
            error.textContent = nextEnd ? '' : 'Enter a valid start date.';
            return nextEnd;
        }

        noteInput.addEventListener('input', updateNoteFeedback); // NEW
        updateNoteFeedback(); // NEW
        if (startInput) startInput.addEventListener('input', updateComputedEnd); // CHANGE

        const buttons = document.createElement('div');
        buttons.style.display = 'flex';
        buttons.style.justifyContent = 'flex-end';
        buttons.style.gap = '8px';

        const cancelButton = mxUtils.button('Cancel', function () {
            ui.hideDialog();
        });
        const saveButton = mxUtils.button('Save', async function () { // CHANGED
            const attributes = {}; // NEW
            const notePatch = buildCardNotePatch(card.value, noteInput.value); // NEW
            if (notePatch && notePatch.changed) Object.assign(attributes, notePatch.attributes); // NEW

            let dateChanged = false; // NEW
            if (startInput && currentRange && startInput.value !== currentRange.startISO) { // CHANGE
                const nextEnd = updateComputedEnd();
                if (!nextEnd) {
                    startInput.focus();
                    return;
                }

                if (!canEditCardDates(card)) { // CHANGE: reject the entire combined save if changed dates are no longer eligible
                    error.textContent = 'This card is no longer eligible for date editing.';
                    return;
                }

                const datePatch = buildCardDateOverridePatch(card.value, startInput.value); // NEW
                if (!datePatch || datePatch.changed === false) {
                    error.textContent = 'The card dates could not be updated.';
                    return;
                }

                Object.assign(attributes, datePatch.attributes); // NEW
                dateChanged = true; // NEW
            }

            if (Object.keys(attributes).length === 0) { // NEW: unchanged combined submission is a no-op
                ui.hideDialog();
                return;
            }

            if (!commitCardPatch(card, attributes, { reflow: dateChanged })) { // NEW
                error.textContent = 'The card could not be updated.';
                return;
            }

            ui.hideDialog();
        });

        buttons.appendChild(cancelButton);
        buttons.appendChild(saveButton);
        div.appendChild(buttons);

        mxEvent.addListener(div, 'keydown', function (evt) {
            if (evt.key === 'Enter') saveButton.click();
            if (evt.key === 'Escape') ui.hideDialog();
        });

        ui.showDialog(div, 420, datesEditableAtOpen ? 310 : 230, true, true); // CHANGE
        noteInput.focus(); // CHANGE
    }

    function getRepeatSeriesContext(card) { // NEW: resolve menu state from the current board, including year-hidden matches
        const board = findBoardAncestor(card); // NEW
        const seriesKey = card ? buildRepeatSeriesKey(card.value) : null; // NEW
        if (!board || !seriesKey) return null; // NEW

        const matchingRecords = getBoardRepeatRecords(board) // NEW
            .filter(record => record.seriesKey === seriesKey); // NEW
        const eligibleRecords = matchingRecords.filter(record => !record.yearHidden); // NEW
        if (eligibleRecords.length < 2) return null; // NEW

        return { // NEW
            board, // NEW
            cards: matchingRecords.map(record => record.card), // NEW
            expanded: matchingRecords.some(record => record.expanded) // NEW
        }; // NEW
    } // NEW

    function setRepeatSeriesExpanded(card, expanded) { // NEW: persist one expansion choice across every matching occurrence
        const context = getRepeatSeriesContext(card); // NEW
        if (!context) return false; // NEW

        model.beginUpdate(); // NEW
        try { // NEW
            context.cards.forEach(seriesCard => { // NEW
                const current = getAttr(seriesCard, REPEAT_EXPANDED_ATTR) === '1'; // NEW
                if (current === expanded) return; // NEW
                model.setValue(seriesCard, cloneCardValueWithAttributes(seriesCard, { // NEW
                    [REPEAT_EXPANDED_ATTR]: expanded ? '1' : null // NEW
                })); // NEW
            }); // NEW
            scanAndReflowBoard(context.board, { insideUpdate: true }); // NEW
        } finally { // NEW
            model.endUpdate(); // NEW
        } // NEW

        return true; // NEW
    } // NEW

    function collectBoardCards(board) { // NEW
        const cards = []; // NEW
        const lanes = boardLanes(board); // NEW
        Object.keys(lanes).forEach(laneKey => { // NEW
            snapshotLaneCards(lanes[laneKey]).forEach(card => cards.push({ card, laneKey })); // NEW
        }); // NEW
        return cards; // NEW
    } // NEW

    function countEndDayCards(board) { // NEW
        const selectedDay = getSelectedDay(board); // NEW
        return collectBoardCards(board).filter(entry => { // NEW
            const state = getEffectiveWorkflowState(entry.card.value, entry.laneKey); // NEW
            return isOpenWorkflowState(state) && getAttr(entry.card, TASK_ASSIGNED_DAY_ATTR) === selectedDay; // NEW
        }).length; // NEW
    } // NEW

    function countEndWeekCards(board) { // NEW
        const weekStart = getSelectedWeekStart(board); // NEW
        return collectBoardCards(board).filter(entry => { // NEW
            const state = getEffectiveWorkflowState(entry.card.value, entry.laneKey); // NEW
            return isOpenWorkflowState(state) && isTaskDateInWeek(getAttr(entry.card, TASK_ASSIGNED_DAY_ATTR), weekStart); // NEW
        }).length; // NEW
    } // NEW

    function setBoardPlanningView(board, mode, attrs) { // NEW
        if (!board) return false; // NEW
        runKanbanViewNoUndo(function () { // NEW
            model.beginUpdate(); // NEW
            try { // NEW
                if (mode) setAttrNoUndo(board, TASK_VIEW_MODE_ATTR, normalizeTaskViewMode(mode), true); // NEW
                Object.entries(attrs || {}).forEach(([key, value]) => setAttrNoUndo(board, key, value, true)); // NEW
                const weekStart = getSelectedWeekStart(board); // NEW
                setAttrNoUndo(board, TASK_SELECTED_DAY_ATTR, clampTaskDayToWeek(getSelectedDay(board), weekStart), true); // NEW
                ensureLanes(board); // NEW
                scanAndReflowBoard(board, { insideUpdate: true }); // NEW
            } finally { // NEW
                model.endUpdate(); // NEW
            } // NEW
        }); // NEW
        return true; // NEW
    } // NEW

    function endDay(board) { // NEW
        const selectedDay = getSelectedDay(board); // NEW
        let changed = false; // NEW
        model.beginUpdate(); // NEW
        try { // NEW
            collectBoardCards(board).forEach(entry => { // NEW
                const state = getEffectiveWorkflowState(entry.card.value, entry.laneKey); // NEW
                if (!isOpenWorkflowState(state) || getAttr(entry.card, TASK_ASSIGNED_DAY_ATTR) !== selectedDay) return; // NEW
                const patch = buildIncompletePatch(entry.card.value, selectedDay); // NEW
                if (patch) changed = applyCardPatchInsideUpdate(entry.card, patch.attributes) || changed; // NEW
            }); // NEW
            if (changed) scanAndReflowBoard(board, { insideUpdate: true }); // NEW
        } finally { // NEW
            model.endUpdate(); // NEW
        } // NEW
        return changed; // NEW
    } // NEW

    function endWeek(board) { // NEW
        const weekStart = getSelectedWeekStart(board); // NEW
        let changed = false; // NEW
        model.beginUpdate(); // NEW
        try { // NEW
            collectBoardCards(board).forEach(entry => { // NEW
                const state = getEffectiveWorkflowState(entry.card.value, entry.laneKey); // NEW
                const assignedDay = getAttr(entry.card, TASK_ASSIGNED_DAY_ATTR); // NEW
                if (!isOpenWorkflowState(state) || !isTaskDateInWeek(assignedDay, weekStart)) return; // NEW
                const patch = buildIncompletePatch(entry.card.value, assignedDay); // NEW
                if (patch) changed = applyCardPatchInsideUpdate(entry.card, patch.attributes) || changed; // NEW
            }); // NEW
            if (changed) scanAndReflowBoard(board, { insideUpdate: true }); // NEW
        } finally { // NEW
            model.endUpdate(); // NEW
        } // NEW
        return changed; // NEW
    } // NEW

    function applyCardWorkflowAction(card, action) { // NEW
        const board = findBoardAncestor(card); // NEW
        if (!board) return false; // NEW
        const patch = buildWorkflowPatch(card.value, action, { // NEW
            mode: getBoardViewMode(board), // NEW
            selectedDay: getSelectedDay(board), // NEW
            selectedWeekStart: getSelectedWeekStart(board), // NEW
            today: todayISO() // NEW
        }); // NEW
        if (!patch || !patch.attributes) return false; // NEW
        model.beginUpdate(); // NEW
        try { // NEW
            applyCardPatchInsideUpdate(card, patch.attributes); // NEW
            scanAndReflowBoard(board, { insideUpdate: true }); // NEW
        } finally { // NEW
            model.endUpdate(); // NEW
        } // NEW
        return true; // NEW
    } // NEW

    function ensureTaskControlOverlayHost() { // NEW
        const host = graph.container || null; // NEW
        if (!host) return null; // NEW
        const style = window.getComputedStyle ? window.getComputedStyle(host) : null; // NEW
        if (style && style.position === 'static') host.style.position = 'relative'; // NEW
        return host; // NEW
    } // NEW

    function getSelectionCellsList() { // NEW
        if (graph.getSelectionCells) return graph.getSelectionCells() || []; // NEW
        const cell = graph.getSelectionCell && graph.getSelectionCell(); // NEW
        return cell ? [cell] : []; // NEW
    } // NEW

    function isBoardCell(cell) { // NEW
        return !!(cell && model.isVertex(cell) && (getAttr(cell, 'board_key') === BOARD_KEY || getAttr(cell, 'board_key') === LEGACY_KANBAN_BOARD_KEY)); // NEW
    } // NEW

    function positionDomOverlayFromCellState(element, cell, below, above) { // NEW
        const state = graph.view && graph.view.getState ? graph.view.getState(cell) : null; // NEW
        if (!element || !state || !element.parentNode) return false; // NEW
        const host = element.parentNode; // NEW
        const scrollLeft = host.scrollLeft || 0; // NEW
        const scrollTop = host.scrollTop || 0; // NEW
        const left = state.x + scrollLeft; // NEW
        const topBase = state.y + scrollTop; // NEW
        element.style.left = Math.max(0, Math.round(left)) + 'px'; // NEW
        if (below) element.style.top = Math.max(0, Math.round(topBase + state.height + 6)) + 'px'; // NEW
        else if (above) element.style.top = Math.max(0, Math.round(topBase - element.offsetHeight - 6)) + 'px'; // NEW
        else element.style.top = Math.max(0, Math.round(topBase)) + 'px'; // NEW
        return true; // NEW
    } // NEW

    function addGraphViewRefreshListener(refresh) { // NEW
        if (!refresh) return; // NEW
        if (graph.view && graph.view.addListener) { // NEW
            graph.view.addListener(mxEvent.SCALE, refresh); // NEW
            graph.view.addListener(mxEvent.TRANSLATE, refresh); // NEW
            graph.view.addListener(mxEvent.SCALE_AND_TRANSLATE, refresh); // NEW
            graph.view.addListener(mxEvent.REPAINT, refresh); // NEW
        } // NEW
        if (model.addListener) model.addListener(mxEvent.CHANGE, refresh); // NEW
        if (graph.container && graph.container.addEventListener) graph.container.addEventListener('scroll', refresh, { passive: true }); // NEW
    } // NEW

    function installBoardHeaderControls() { // NEW
        if (graph.__trellisTaskBoardHeaderInstalled || !document || !document.createElement) return; // NEW
        graph.__trellisTaskBoardHeaderInstalled = true; // NEW
        const host = ensureTaskControlOverlayHost(); // NEW
        if (!host) return; // NEW
        const bar = document.createElement('div'); // NEW
        bar.className = 'trellis-task-board-header-controls'; // NEW
        bar.style.cssText = 'position:absolute;z-index:1005;display:none;flex-direction:column;gap:4px;align-items:flex-start;background:#fff;border:1px solid #111;padding:4px;font:12px Arial,sans-serif;pointer-events:auto;'; // NEW
        host.appendChild(bar); // NEW
        const dateInput = document.createElement('input'); // NEW
        dateInput.type = 'date'; // NEW
        dateInput.style.cssText = 'font:12px Arial,sans-serif;width:132px;'; // NEW
        bar.appendChild(dateInput); // NEW
        const row = document.createElement('div'); // NEW
        row.style.cssText = 'display:flex;gap:4px;align-items:center;'; // NEW
        bar.appendChild(row); // NEW

        function button(label, fn) { // NEW
            const btn = document.createElement('button'); // NEW
            btn.type = 'button'; // NEW
            btn.textContent = label; // NEW
            btn.style.cssText = 'font:12px Arial,sans-serif;padding:3px 6px;'; // NEW
            mxEvent.addListener(btn, 'mousedown', evt => mxEvent.consume(evt)); // NEW
            mxEvent.addListener(btn, 'click', function (evt) { mxEvent.consume(evt); fn(); refresh(); }); // NEW
            row.appendChild(btn); // NEW
            return btn; // NEW
        } // NEW

        function selectedBoard() { // NEW
            const cells = getSelectionCellsList(); // NEW
            for (const cell of cells) { // NEW
                if (isBoardCell(cell)) return cell; // NEW
                const board = findBoardAncestor(cell); // NEW
                if (board) return board; // NEW
            } // NEW
            return null; // NEW
        } // NEW

        const modeFull = button('Full', () => { const b = selectedBoard(); if (b) setBoardPlanningView(b, 'FULL'); }); // NEW
        const modeWeek = button('Week', () => { const b = selectedBoard(); if (b) setBoardPlanningView(b, 'WEEK'); }); // NEW
        const modeDay = button('Day', () => { const b = selectedBoard(); if (b) setBoardPlanningView(b, 'DAY', { [TASK_SELECTED_DAY_ATTR]: getSelectedWeekStart(b) }); }); // NEW
        const prev = button('<', () => { const b = selectedBoard(); if (!b) return; const mode = getBoardViewMode(b); if (mode === 'WEEK') setBoardPlanningView(b, null, { [TASK_SELECTED_WEEK_START_ATTR]: shiftTaskCalendarISO(getSelectedWeekStart(b), -7), [TASK_SELECTED_DAY_ATTR]: shiftTaskCalendarISO(getSelectedWeekStart(b), -7) }); else if (mode === 'DAY') setBoardPlanningView(b, null, { [TASK_SELECTED_DAY_ATTR]: shiftTaskDayWithinWeek(getSelectedDay(b), getSelectedWeekStart(b), -1) }); }); // NEW
        const next = button('>', () => { const b = selectedBoard(); if (!b) return; const mode = getBoardViewMode(b); if (mode === 'WEEK') setBoardPlanningView(b, null, { [TASK_SELECTED_WEEK_START_ATTR]: shiftTaskCalendarISO(getSelectedWeekStart(b), 7), [TASK_SELECTED_DAY_ATTR]: shiftTaskCalendarISO(getSelectedWeekStart(b), 7) }); else if (mode === 'DAY') setBoardPlanningView(b, null, { [TASK_SELECTED_DAY_ATTR]: shiftTaskDayWithinWeek(getSelectedDay(b), getSelectedWeekStart(b), 1) }); }); // NEW
        const todayBtn = button('Today', () => { const b = selectedBoard(); if (!b) return; const today = todayISO(); setBoardPlanningView(b, null, { [TASK_SELECTED_WEEK_START_ATTR]: getTaskWeekStartISO(today), [TASK_SELECTED_DAY_ATTR]: today }); }); // NEW
        const endDayBtn = button('End Day', () => { const b = selectedBoard(); if (b) endDay(b); }); // NEW
        const endWeekBtn = button('End Week', () => { const b = selectedBoard(); if (b) endWeek(b); }); // NEW
        dateInput.addEventListener('mousedown', evt => evt.stopPropagation()); // NEW
        dateInput.addEventListener('click', evt => evt.stopPropagation()); // NEW
        mxEvent.addListener(dateInput, 'change', function (evt) { // NEW
            mxEvent.consume(evt); // NEW
            const b = selectedBoard(); // NEW
            if (!b) return; // NEW
            const value = String(dateInput.value || '').trim(); // NEW
            if (!value) { setBoardPlanningView(b, 'FULL'); refresh(); return; } // NEW
            const weekStart = getTaskWeekStartISO(value); // NEW
            if (!weekStart) return; // NEW
            const mode = getBoardViewMode(b); // NEW
            setBoardPlanningView(b, mode === 'FULL' ? 'DAY' : mode, { [TASK_SELECTED_WEEK_START_ATTR]: weekStart, [TASK_SELECTED_DAY_ATTR]: value }); // NEW
            refresh(); // NEW
        }); // NEW

        function refresh() { // NEW
            const board = selectedBoard(); // NEW
            if (!board) { bar.style.display = 'none'; return; } // NEW
            ensureBoardPlanningDefaults(board); // NEW
            const mode = getBoardViewMode(board); // NEW
            bar.style.display = 'flex'; // NEW
            dateInput.value = mode === 'FULL' ? '' : getSelectedDay(board); // NEW
            modeFull.disabled = mode === 'FULL'; // NEW
            modeWeek.disabled = mode === 'WEEK'; // NEW
            modeDay.disabled = mode === 'DAY'; // NEW
            const selectedDay = getSelectedDay(board); // NEW
            prev.disabled = mode === 'FULL' || (mode === 'DAY' && selectedDay === getSelectedWeekStart(board)); // NEW
            next.disabled = mode === 'FULL' || (mode === 'DAY' && selectedDay === getTaskWeekEndISO(getSelectedWeekStart(board))); // NEW
            todayBtn.textContent = mode === 'WEEK' ? 'This Week' : 'Today'; // NEW
            endDayBtn.textContent = 'End Day (' + countEndDayCards(board) + ')'; // NEW
            endWeekBtn.textContent = 'End Week (' + countEndWeekCards(board) + ')'; // NEW
            endDayBtn.style.display = mode === 'DAY' ? '' : 'none'; // NEW
            endWeekBtn.style.display = mode === 'WEEK' ? '' : 'none'; // NEW
            positionDomOverlayFromCellState(bar, board, false, true); // NEW
        } // NEW

        graph.getSelectionModel().addListener(mxEvent.CHANGE, refresh); // NEW
        addGraphViewRefreshListener(refresh); // NEW
        refresh(); // NEW
    } // NEW

    function installSelectedCardActionOverlay() { // NEW
        if (graph.__trellisTaskCardOverlayInstalled || !document || !document.createElement) return; // NEW
        graph.__trellisTaskCardOverlayInstalled = true; // NEW
        const host = ensureTaskControlOverlayHost(); // NEW
        if (!host) return; // NEW
        const overlay = document.createElement('div'); // NEW
        overlay.className = 'trellis-task-selected-card-actions'; // NEW
        overlay.style.cssText = 'position:absolute;z-index:1006;display:none;gap:4px;background:#fff;border:1px solid #111;padding:4px;font:12px Arial,sans-serif;pointer-events:auto;'; // NEW
        host.appendChild(overlay); // NEW
        mxEvent.addListener(overlay, 'mousedown', evt => mxEvent.consume(evt)); // NEW
        mxEvent.addListener(overlay, 'mouseup', evt => mxEvent.consume(evt)); // NEW

        function add(label, fn) { // NEW
            const btn = document.createElement('button'); // NEW
            btn.type = 'button'; // NEW
            btn.textContent = label; // NEW
            btn.style.cssText = 'font:12px Arial,sans-serif;padding:3px 6px;'; // NEW
            mxEvent.addListener(btn, 'click', function (evt) { mxEvent.consume(evt); const card = selectedCard(); if (card) fn(card); refresh(); }); // NEW
            overlay.appendChild(btn); // NEW
            return btn; // NEW
        } // NEW

        function selectedCard() { // NEW
            const cells = getSelectionCellsList(); // NEW
            for (const cell of cells) { // NEW
                if (cell && model.isVertex(cell) && isKanbanCard(cell)) return cell; // NEW
            } // NEW
            return null; // NEW
        } // NEW

        const editBtn = add('Edit', showEditCardDialog); // NEW
        const todoBtn = add('TODO', card => applyCardWorkflowAction(card, 'TODO')); // NEW
        const doingBtn = add('DOING', card => applyCardWorkflowAction(card, 'DOING')); // NEW
        const doneBtn = add('DONE', card => applyCardWorkflowAction(card, 'DONE')); // NEW
        const resetBtn = add('Reset Dates', resetCardDates); // NEW
        const clearBtn = add('Clear Note', clearCardNote); // NEW

        function refresh() { // NEW
            const card = selectedCard(); // NEW
            if (!card) { overlay.style.display = 'none'; return; } // NEW
            const state = getEffectiveWorkflowState(card.value, laneKeyOfCard(card)); // NEW
            overlay.style.display = 'flex'; // NEW
            editBtn.style.display = ''; // NEW
            todoBtn.style.display = state !== 'TODO' && state !== 'DONE' ? '' : 'none'; // NEW
            doingBtn.style.display = state !== 'DOING' && state !== 'DONE' ? '' : 'none'; // NEW
            doneBtn.style.display = state !== 'DONE' ? '' : 'none'; // NEW
            resetBtn.style.display = canEditCardDates(card) && hasCardDateOverride(card) ? '' : 'none'; // NEW
            clearBtn.style.display = getCardNote(card) ? '' : 'none'; // NEW
            positionDomOverlayFromCellState(overlay, card, true, false); // NEW
        } // NEW

        graph.getSelectionModel().addListener(mxEvent.CHANGE, refresh); // NEW
        addGraphViewRefreshListener(refresh); // NEW
        refresh(); // NEW
    } // NEW

    // -------------------- Menu hook --------------------
    (function addMenuHook() {
        function registerTrellisContextMenuContributor(contributor) { // NEW
            function finishRegistration() { // NEW
                if (!window.TrellisContextMenu) return; // NEW
                window.TrellisContextMenu.install(ui); // NEW
                window.TrellisContextMenu.register(contributor); // NEW
            } // NEW

            if (window.TrellisContextMenu) { // NEW
                finishRegistration(); // NEW
            } else if (typeof mxscript === "function") { // NEW
                mxscript("plugins/garden_planner_plugins/Trellis_Context_Menu.js", finishRegistration); // NEW
            } // NEW
        } // NEW

        registerTrellisContextMenuContributor({ // CHANGE
            id: "gardenTasks", // NEW
            priority: 500, // NEW
            addItems: function (menu, cell, evt) { // CHANGE
            const card = cell && model.isVertex(cell) && isKanbanCard(cell) ? cell : null; // NEW

            if (card) { // CHANGE: note actions are available in every Kanban lane
                menu.addSeparator(); // NEW
                menu.addItem('Edit Card...', null, function () { // CHANGE
                    showEditCardDialog(card); // CHANGE
                }); // CHANGE

                if (getCardNote(card)) { // NEW
                    menu.addItem('Clear Card Note', null, function () { // NEW
                        clearCardNote(card); // NEW
                    }); // NEW
                } // NEW

                if (canEditCardDates(card) && hasCardDateOverride(card)) { // CHANGE
                    menu.addItem('Reset Card Dates', null, function () { // NEW
                        resetCardDates(card); // NEW
                    }); // NEW
                } // NEW

                const repeatContext = getRepeatSeriesContext(card); // NEW
                if (repeatContext) { // NEW
                    menu.addItem( // NEW
                        repeatContext.expanded ? 'Collapse Repeating Tasks' : 'Expand Repeating Tasks', // NEW
                        null, // NEW
                        function () { // NEW
                            setRepeatSeriesExpanded(card, !repeatContext.expanded); // NEW
                        } // NEW
                    ); // NEW
                } // NEW
            } // NEW

            const gm = cell && model.isVertex(cell) && isGardenModule(cell) ? cell : null;           // CHANGE
            if (!gm) return;                                                                         // CHANGE

            menu.addSeparator();                                                                     // CHANGE
            menu.addItem('Add Kanban Board', null, function () {
                model.beginUpdate();
                try {
                    ensureBoardTemplateIn(gm, { insideUpdate: true });
                } finally {
                    model.endUpdate();
                }
            });
            } // CHANGE
        }); // CHANGE
    })();

    installBoardHeaderControls(); // NEW
    installSelectedCardActionOverlay(); // NEW

    // -------------------- Event bridge from scheduler --------------------
    function handleTasksCreatedEvent(ev) {
        const detail = ev && ev.detail ? ev.detail : {};
        const replacement = normalizeTaskReplacementDetail(detail);
        const tasks = replacement.tasks;
        const targetGroupId = replacement.targetGroupId;

        if ((replacement.mode !== 'replace' && replacement.mode !== 'sync') || !targetGroupId) return; // CHANGED

        setTimeout(function () {
            if (replacement.mode === 'sync') { // ADDED
                applyDifferentialTaskSync({ targetGroupId, tasks }); // ADDED
                return; // ADDED
            } // ADDED
            applyImmediateTaskReplacement({
                targetGroupId,
                tasks,
                removeTasks: removeTasksLinkedOnlyTo,
                createTasks
            });
        }, 0);
    }

    window.addEventListener('tasksCreated', handleTasksCreatedEvent);

    window.addEventListener("yearFilterChanged", function (ev) {                         // NEW
        try {                                                                           // NEW
            // simplest: rescan boards so paging respects year_hidden                   // NEW
            scanAllBoards({ insideUpdate: false });                                     // NEW
        } catch (e) { }                                                                 // NEW
    });

    console.log('[TaskManager] Kanban loaded. Use window.TaskBus.createTasks([...]).');

    // -------------------- Auto-create board on garden settings event --------------------  // NEW
    if (!graph.__uslKanbanGardenEventInstalled) {                                            // NEW
        graph.__uslKanbanGardenEventInstalled = true;                                        // NEW

        graph.addListener("usl:gardenModuleNeedsSettings", function (_sender, evt) {         // NEW
            const moduleCell = evt && typeof evt.getProperty === "function"                  // NEW
                ? evt.getProperty("cell")                                                    // NEW
                : null;                                                                      // NEW

            if (!moduleCell || !model.isVertex(moduleCell)) return;                          // NEW
            if (!isGardenModule(moduleCell)) return;                                         // NEW

            const boards = findBoardsIn(moduleCell);                                         // NEW
            if (boards && boards.main) return;                                               // NEW (already has a board)

            // Defer to avoid running inside someone else's model.beginUpdate()               // NEW
            setTimeout(function () {                                                         // NEW
                const again = findBoardsIn(moduleCell);                                      // NEW
                if (again && again.main) return;                                             // NEW
                model.beginUpdate();                                                         // NEW
                try {                                                                        // NEW
                    ensureBoardTemplateIn(moduleCell, { insideUpdate: true });                               // CHANGE
                } finally {                                                                  // NEW
                    model.endUpdate();                                                       // NEW
                }                                                                            // NEW
                graph.refresh(moduleCell);
                graph.fireEvent(new mxEventObject("usl:requestApplyModuleMargins", "cell", moduleCell));// NEW
                // NEW
            }, 0);                                                                           // NEW
        });                                                                                  // NEW
    }                                                                                        // NEW

});
