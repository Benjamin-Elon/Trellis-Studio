/**
 * Draw.io Plugin: Task Manager (Kanban Template Style + Auto Placement + Auto Archive + Badges)
 */

// -------------------- Scheduler event contract -------------------- // NEW
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

// -------------------- Constants and task attributes -------------------- // NEW
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
const TASK_SCHEDULE_START_MINUTE_ATTR = 'schedule_start_minute'; // NEW: derived from stacked day-lane order
const TASK_SCHEDULE_DURATION_MINUTES_ATTR = 'schedule_duration_minutes'; // NEW: derived from card height
const TASK_FULL_CARD_HEIGHT_ATTR = 'task_full_card_height'; // NEW: full-view visual card height, separate from week schedule duration
const TASK_SCHEDULE_BREAK_ATTR = 'schedule_break'; // NEW: real stacked card that reserves schedule time
const TASK_SCHEDULE_ORDER_ATTR = 'schedule_order'; // NEW: preserves day stack order across week navigation
const TASK_SCHEDULE_ORDER_DAY_ATTR = 'schedule_order_day'; // NEW: prevents stale order from applying to another date
const TASK_WORK_HOURS_DEFAULTS_ATTR = 'task_work_hours_defaults_json'; // NEW
const TASK_WORK_HOURS_WEEK_OVERRIDES_ATTR = 'task_work_hours_week_overrides_json'; // NEW
const TASK_DAY_LANE_WIDTHS_ATTR = 'task_day_lane_widths_json'; // NEW: user-resized per-weekday lane widths
const TASK_NON_DAY_LANE_WIDTHS_ATTR = 'task_non_day_lane_widths_json'; // NEW: user-resized per-lane widths for non-day lanes
const TASK_FULL_LANE_HEIGHT_ATTR = 'task_full_lane_height'; // NEW: user-resized full-mode lane height
const TASK_WEEK_BOARD_HEIGHTS_ATTR = 'task_week_board_heights_json'; // NEW: user-resized week-mode board heights keyed by week start
const TASK_ASSIGNEE_ROLE_IDS_ATTR = 'task_assignee_role_ids_json'; // NEW: canonical role-card ids assigned to a task
const TASK_PAGE_ANCHOR_ATTR = 'task_page_anchor_card_id'; // NEW: authoritative persisted page position for non-day lanes
const TASK_VIEW_MODES = ['FULL', 'WEEK']; // CHANGE: Day mode now normalizes to Week
const TASK_WORKFLOW_STATES = ['STAGED', 'TODO', 'DOING', 'DONE']; // NEW
const WEEK_DAY_LANE_KEYS = ['WEEK_SUN', 'WEEK_MON', 'WEEK_TUE', 'WEEK_WED', 'WEEK_THU', 'WEEK_FRI', 'WEEK_SAT']; // NEW
const GRAPH_OVERLAY_Z = Object.freeze({ ANNOTATION: 10000, CONNECTION: 10010, CONTROL: 10020, CONTROL_TOP: 10030 }); // NEW
const TRELLIS_DIALOG_Z = 2000000000; // NEW: match Draw.io dialog layer ordering
const SCHEDULE_PX_PER_HOUR = 80; // NEW
const SCHEDULE_MINUTE_SNAP = 15; // NEW
const SCHEDULE_MIN_CARD_HEIGHT = 20; // NEW
const WEEK_TIME_RULER_WIDTH = 56; // NEW: non-cell gutter used by the week-mode hour guide
const DEFAULT_TASK_CARD_HEIGHT = 80; // NEW
const DEFAULT_DAY_LANE_WIDTH = 220; // NEW
const MIN_DAY_LANE_WIDTH = 140; // NEW
const DEFAULT_WORK_START_MINUTE = 6 * 60; // NEW
const DEFAULT_WORK_END_MINUTE = 18 * 60; // NEW
const DEFAULT_WEEKDAY_WORK_START_MINUTE = 17 * 60; // NEW: realistic default for after-work garden sessions
const DEFAULT_WEEKDAY_WORK_END_MINUTE = 19 * 60; // NEW: cap weekday default capacity at two hours
const DEFAULT_WEEKEND_WORK_START_MINUTE = 8 * 60; // NEW: weekend garden work starts after early morning setup
const DEFAULT_WEEKEND_WORK_END_MINUTE = 12 * 60; // NEW: weekend default avoids assuming all-day availability
const DEFAULT_WEEK_WORK_HOUR_WINDOWS = Object.freeze([ // NEW: explicit new-board defaults; malformed saved data still uses legacy normalizer fallback
    { startMinute: DEFAULT_WEEKEND_WORK_START_MINUTE, endMinute: DEFAULT_WEEKEND_WORK_END_MINUTE }, // NEW
    { startMinute: DEFAULT_WEEKDAY_WORK_START_MINUTE, endMinute: DEFAULT_WEEKDAY_WORK_END_MINUTE }, // NEW
    { startMinute: DEFAULT_WEEKDAY_WORK_START_MINUTE, endMinute: DEFAULT_WEEKDAY_WORK_END_MINUTE }, // NEW
    { startMinute: DEFAULT_WEEKDAY_WORK_START_MINUTE, endMinute: DEFAULT_WEEKDAY_WORK_END_MINUTE }, // NEW
    { startMinute: DEFAULT_WEEKDAY_WORK_START_MINUTE, endMinute: DEFAULT_WEEKDAY_WORK_END_MINUTE }, // NEW
    { startMinute: DEFAULT_WEEKDAY_WORK_START_MINUTE, endMinute: DEFAULT_WEEKDAY_WORK_END_MINUTE }, // NEW
    { startMinute: DEFAULT_WEEKEND_WORK_START_MINUTE, endMinute: DEFAULT_WEEKEND_WORK_END_MINUTE } // NEW
]); // NEW

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
const WEEK_VIEW_LANE_KEYS = ['TODO_STAGED', ...WEEK_DAY_LANE_KEYS]; // CHANGE: DONE is a card state on day lanes

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

// -------------------- Pure task policy: calendar, workflow, and visible lanes -------------------- // NEW
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
    if (mode === 'DAY') return 'WEEK'; // CHANGE: preserve legacy files while removing user-facing Day mode
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

function clampTaskStartToVisibleWeek(source, weekStartISO) { // NEW
    const weekStart = getTaskWeekStartISO(weekStartISO); // NEW
    const start = readAttributeValue(source, 'start'); // NEW
    if (!parseTaskCalendarISO(start) || !parseTaskCalendarISO(weekStart)) return null; // NEW
    return clampTaskDayToWeek(start, weekStart); // NEW
} // NEW

function shiftTaskDayWithinWeek(iso, weekStartISO, delta) { // NEW
    const shifted = shiftTaskCalendarISO(iso, delta); // NEW
    return isTaskDateInWeek(shifted, weekStartISO) ? shifted : iso; // NEW
} // NEW

function getTaskViewLaneKeys(mode) { // NEW
    const normalized = normalizeTaskViewMode(mode); // NEW
    if (normalized === 'WEEK') return WEEK_VIEW_LANE_KEYS.slice(); // NEW
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
        isSchedulerDateLocked(source) || // CHANGE
        hasTaskAssignees(source); // NEW
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
        isSchedulerDateLocked(source) || // CHANGE
        hasTaskAssignees(source); // NEW
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
        assignDay = mode === 'WEEK' ? (ctx.dropDay || selectedDay || selectedWeekStart) : today; // CHANGE
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
        assignDay = currentAssigned || (mode === 'WEEK' ? (ctx.dropDay || selectedDay || selectedWeekStart) : today); // CHANGE
        if (!parseTaskCalendarISO(assignDay)) return null; // NEW
        attrs[TASK_WORKFLOW_STATE_ATTR] = 'DONE'; // NEW
        attrs[TASK_ASSIGNED_DAY_ATTR] = assignDay; // NEW
        attrs[TASK_SCHEDULER_DATES_LOCKED_ATTR] = '1'; // NEW
        attrs[TASK_INCOMPLETE_DAY_ATTR] = null; // NEW
        attrs[TASK_MANUAL_STAGED_ATTR] = null; // NEW
        attrs.completed = mode === 'WEEK' ? assignDay : today; // CHANGE
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
        if (state === 'STAGED') return 'TODO_STAGED'; // CHANGE
        if (state === 'DONE') return getWeekLaneKeyForDate(completedDay || assignedDay, weekStart) || 'DONE_WEEK'; // CHANGE
        const weekLane = getWeekLaneKeyForDate(assignedDay, weekStart); // NEW
        return weekLane || state; // NEW
    } // NEW

    if (state === 'TODO' || state === 'DOING') return state; // NEW
    if (state === 'DONE') return 'DONE'; // NEW
    if (isPhysicallyOrManuallyStaged(source, fallbackLaneKey)) return 'TODO_STAGED'; // NEW
    return ''; // NEW: Full staged cards keep scheduler horizon classification
} // NEW

function selectedPeriodStagedSortEnabled(laneKey, context) { // NEW
    const mode = normalizeTaskViewMode(context && (context.viewMode || context.mode)); // NEW
    return String(laneKey || '') === 'TODO_STAGED' && mode === 'WEEK'; // CHANGE
} // NEW

function selectedPeriodStagedTitle(source) { // NEW
    return String(readAttributeValue(source, 'title') || '').trim().toLowerCase(); // NEW
} // NEW

function buildSelectedPeriodStagedSortKey(source, context) { // NEW
    const ctx = context || {}; // NEW
    const mode = normalizeTaskViewMode(ctx.viewMode || ctx.mode); // NEW
    const start = parseTaskCalendarISO(readAttributeValue(source, 'start')); // NEW
    const title = selectedPeriodStagedTitle(source); // NEW
    if (!start) return { missing: true, group: 2, distance: Number.POSITIVE_INFINITY, direction: 1, startDay: Number.POSITIVE_INFINITY, title }; // NEW

    if (mode === 'WEEK') { // NEW
        const weekStartISO = getTaskWeekStartISO(ctx.selectedWeekStart); // NEW
        const weekStart = parseTaskCalendarISO(weekStartISO); // NEW
        const weekEnd = parseTaskCalendarISO(getTaskWeekEndISO(weekStartISO)); // NEW
        if (!weekStart || !weekEnd) return { missing: false, group: 1, distance: 0, direction: 0, startDay: start.dayNumber, title }; // NEW
        const selectedDayISO = parseTaskCalendarISO(ctx.selectedDay) ? clampTaskDayToWeek(ctx.selectedDay, weekStartISO) : weekStartISO; // NEW
        const selectedDay = parseTaskCalendarISO(selectedDayISO) || weekStart; // NEW
        if (start.dayNumber >= weekStart.dayNumber && start.dayNumber <= weekEnd.dayNumber) { // NEW
            return { missing: false, group: 0, distance: Math.abs(start.dayNumber - selectedDay.dayNumber), direction: start.dayNumber <= selectedDay.dayNumber ? 0 : 1, startDay: start.dayNumber, title }; // NEW
        } // NEW
        const beforeWeek = start.dayNumber < weekStart.dayNumber; // NEW
        return { missing: false, group: 1, distance: beforeWeek ? weekStart.dayNumber - start.dayNumber : start.dayNumber - weekEnd.dayNumber, direction: beforeWeek ? 0 : 1, startDay: start.dayNumber, title }; // NEW
    } // NEW

    const selectedDay = parseTaskCalendarISO(ctx.selectedDay); // NEW
    if (!selectedDay) return { missing: false, group: 1, distance: 0, direction: 0, startDay: start.dayNumber, title }; // NEW
    return { missing: false, group: 0, distance: Math.abs(start.dayNumber - selectedDay.dayNumber), direction: start.dayNumber <= selectedDay.dayNumber ? 0 : 1, startDay: start.dayNumber, title }; // NEW
} // NEW

function compareSelectedPeriodStagedSortKeys(left, right) { // NEW
    return (Number(left.missing) - Number(right.missing)) || // NEW
        (left.group - right.group) || // NEW
        (left.distance - right.distance) || // NEW
        (left.direction - right.direction) || // NEW
        (left.startDay - right.startDay) || // NEW
        left.title.localeCompare(right.title); // NEW
} // NEW

function compareSelectedPeriodStagedRecords(left, right, context) { // NEW
    return compareSelectedPeriodStagedSortKeys(buildSelectedPeriodStagedSortKey(left, context), buildSelectedPeriodStagedSortKey(right, context)); // NEW
} // NEW

function formatTaskWeekdayShort(dayNumber) { // NEW
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; // NEW
    const index = (((Number(dayNumber) + 4) % 7) + 7) % 7; // NEW
    return names[index] || ''; // NEW
} // NEW

function formatSelectedPeriodStagedStartText(start, weekStart, weekEnd, today) { // NEW
    if (!start || !weekStart || !weekEnd) return ''; // NEW
    if (start.dayNumber < weekStart.dayNumber) return (weekStart.dayNumber - start.dayNumber) + 'd late'; // NEW
    if (start.dayNumber > weekEnd.dayNumber) return 'Starts in ' + (start.dayNumber - weekEnd.dayNumber) + 'd'; // NEW
    if (today && start.dayNumber === today.dayNumber) return 'Start today'; // NEW
    if (today && start.dayNumber === today.dayNumber + 1) return 'Start tomorrow'; // NEW
    return 'Start ' + formatTaskWeekdayShort(start.dayNumber); // NEW
} // NEW

function buildSelectedPeriodStagedStartText(source, context) { // NEW
    const ctx = context || {}; // NEW
    const mode = normalizeTaskViewMode(ctx.viewMode || ctx.mode); // NEW
    const start = parseTaskCalendarISO(readAttributeValue(source, 'start')); // NEW
    if (!start || mode !== 'WEEK') return ''; // CHANGE

    const weekStartISO = getTaskWeekStartISO(ctx.selectedWeekStart); // NEW
    const weekStart = parseTaskCalendarISO(weekStartISO); // NEW
    const weekEnd = parseTaskCalendarISO(getTaskWeekEndISO(weekStartISO)); // NEW
    const today = parseTaskCalendarISO(ctx.today); // NEW
    return formatSelectedPeriodStagedStartText(start, weekStart, weekEnd, today); // NEW
} // NEW

function buildSelectedPeriodStagedDueText(source, context) { // NEW
    return buildSelectedPeriodStagedStartText(source, context); // CHANGE: compatibility alias for older tests/extensions
} // NEW

function buildStagedStartDateAllocationPatch(source, context) { // NEW
    const ctx = context || {}; // NEW
    const weekStart = getTaskWeekStartISO(ctx.selectedWeekStart); // NEW
    const assignedDay = clampTaskStartToVisibleWeek(source, weekStart); // NEW
    if (!assignedDay) return null; // NEW
    return { // NEW
        attributes: { // NEW
            [TASK_WORKFLOW_STATE_ATTR]: 'TODO', // NEW
            [TASK_ASSIGNED_DAY_ATTR]: assignedDay, // NEW
            [TASK_SCHEDULER_DATES_LOCKED_ATTR]: '1', // NEW
            [TASK_INCOMPLETE_DAY_ATTR]: null, // NEW
            [TASK_MANUAL_STAGED_ATTR]: null, // NEW
            completed: null // NEW
        } // NEW
    }; // NEW
} // NEW

// -------------------- Pure task policy: schedule geometry and work hours -------------------- // NEW
function snapScheduleMinutes(value, fallback) { // NEW
    const numeric = Number(value); // NEW
    const base = Number.isFinite(numeric) ? numeric : fallback; // NEW
    if (!Number.isFinite(base)) return null; // NEW
    return Math.max(0, Math.round(base / SCHEDULE_MINUTE_SNAP) * SCHEDULE_MINUTE_SNAP); // NEW
} // NEW

function scheduleMinutesToPx(minutes) { // NEW
    const snapped = snapScheduleMinutes(minutes, SCHEDULE_MINUTE_SNAP); // NEW
    return Math.max(SCHEDULE_MIN_CARD_HEIGHT, Math.round((snapped / 60) * SCHEDULE_PX_PER_HOUR)); // NEW
} // NEW

function schedulePxToMinutes(px) { // NEW
    const numeric = Number(px); // NEW
    const minutes = Number.isFinite(numeric) ? (numeric / SCHEDULE_PX_PER_HOUR) * 60 : SCHEDULE_MINUTE_SNAP; // NEW
    return Math.max(SCHEDULE_MINUTE_SNAP, snapScheduleMinutes(minutes, SCHEDULE_MINUTE_SNAP)); // NEW
} // NEW

    function scheduleMinuteOffsetToPx(minutes) { // NEW
        const numeric = Number(minutes); // NEW
        return Math.max(0, Math.round(((Number.isFinite(numeric) ? numeric : 0) / 60) * SCHEDULE_PX_PER_HOUR)); // NEW
    } // NEW

    function schedulePxDeltaToMinutes(px) { // NEW
        const numeric = Number(px); // NEW
        if (!Number.isFinite(numeric) || numeric === 0) return 0; // NEW
        return Math.round((numeric / SCHEDULE_PX_PER_HOUR) * (60 / SCHEDULE_MINUTE_SNAP)) * SCHEDULE_MINUTE_SNAP; // NEW
    } // NEW

function getDateScopedScheduleOrder(source, visibleDay) { // NEW
    if (!parseTaskCalendarISO(visibleDay)) return null; // NEW
    const orderDay = String(readAttributeValue(source, TASK_SCHEDULE_ORDER_DAY_ATTR) || '').trim(); // NEW
    if (orderDay !== visibleDay) return null; // NEW
    const order = Number(readAttributeValue(source, TASK_SCHEDULE_ORDER_ATTR)); // NEW
    return Number.isFinite(order) && order >= 0 ? order : null; // NEW
} // NEW

function compareDateScopedScheduleOrderRecords(left, right, visibleDay) { // NEW
    const leftOrder = getDateScopedScheduleOrder(left && left.source, visibleDay); // NEW
    const rightOrder = getDateScopedScheduleOrder(right && right.source, visibleDay); // NEW
    const leftFallback = Number(left && left.fallbackIndex); // NEW
    const rightFallback = Number(right && right.fallbackIndex); // NEW
    const leftResolved = leftOrder != null ? leftOrder : (Number.isFinite(leftFallback) ? leftFallback : 0); // NEW
    const rightResolved = rightOrder != null ? rightOrder : (Number.isFinite(rightFallback) ? rightFallback : 0); // NEW
    if (leftResolved !== rightResolved) return leftResolved - rightResolved; // NEW
    const fallbackDiff = (Number.isFinite(leftFallback) ? leftFallback : 0) - (Number.isFinite(rightFallback) ? rightFallback : 0); // NEW
    if (fallbackDiff) return fallbackDiff; // NEW
    return String(left && left.id || '').localeCompare(String(right && right.id || '')); // NEW
} // NEW

function normalizeWeekDayLaneWidth(value, fallback) { // NEW
    const numeric = Number(value); // NEW
    const base = Number.isFinite(numeric) ? numeric : fallback; // NEW
    return Math.max(MIN_DAY_LANE_WIDTH, Math.round(Number.isFinite(base) ? base : DEFAULT_DAY_LANE_WIDTH)); // NEW
} // NEW

function normalizeWeekDayLaneWidths(value, fallbackWidth) { // NEW
    const parsed = typeof value === 'string' ? parseJsonObject(value) : value; // NEW
    const source = parsed && typeof parsed === 'object' ? parsed : {}; // NEW
    const rawWidths = source.widths && typeof source.widths === 'object' ? source.widths : source; // NEW
    const fallback = normalizeWeekDayLaneWidth(fallbackWidth, DEFAULT_DAY_LANE_WIDTH); // NEW
    const out = {}; // NEW
    WEEK_DAY_LANE_KEYS.forEach(laneKey => { // NEW
        out[laneKey] = normalizeWeekDayLaneWidth(rawWidths[laneKey], fallback); // NEW
    }); // NEW
    return out; // NEW
} // NEW

function serializeWeekDayLaneWidths(widths) { // NEW
    return JSON.stringify({ schemaVersion: 1, widths: normalizeWeekDayLaneWidths(widths, DEFAULT_DAY_LANE_WIDTH) }); // NEW
} // NEW

function normalizeNonDayLaneWidth(value, fallback) { // NEW
    return normalizeWeekDayLaneWidth(value, fallback); // NEW: non-day lanes share the board lane width floor
} // NEW

function normalizeNonDayLaneWidths(value, fallbackWidth) { // NEW
    const parsed = typeof value === 'string' ? parseJsonObject(value) : value; // NEW
    const source = parsed && typeof parsed === 'object' ? parsed : {}; // NEW
    const rawWidths = source.widths && typeof source.widths === 'object' ? source.widths : source; // NEW
    const fallback = normalizeNonDayLaneWidth(fallbackWidth, DEFAULT_DAY_LANE_WIDTH); // NEW
    const out = {}; // NEW
    KANBAN_LANE_DEFS.forEach(lane => { // NEW
        if (!lane || WEEK_DAY_LANE_KEYS.indexOf(String(lane.key || '')) >= 0) return; // CHANGE
        out[lane.key] = normalizeNonDayLaneWidth(rawWidths[lane.key], fallback); // NEW
    }); // NEW
    return out; // NEW
} // NEW

function serializeNonDayLaneWidths(widths) { // NEW
    return JSON.stringify({ schemaVersion: 1, widths: normalizeNonDayLaneWidths(widths, DEFAULT_DAY_LANE_WIDTH) }); // NEW
} // NEW

function normalizeWeekBoardHeight(value, fallback) { // NEW
    const numeric = Number(value); // NEW
    const base = Number.isFinite(numeric) ? numeric : fallback; // NEW
    return Math.max(SCHEDULE_MIN_CARD_HEIGHT, Math.round(Number.isFinite(base) ? base : SCHEDULE_MIN_CARD_HEIGHT)); // NEW
} // NEW

function normalizeWeekBoardHeights(value) { // NEW
    const parsed = typeof value === 'string' ? parseJsonObject(value) : value; // NEW
    const source = parsed && typeof parsed === 'object' ? parsed : {}; // NEW
    const rawWeeks = source.weeks && typeof source.weeks === 'object' ? source.weeks : source; // NEW
    const out = {}; // NEW
    Object.keys(rawWeeks || {}).forEach(weekStart => { // NEW
        if (!parseTaskCalendarISO(weekStart)) return; // NEW
        out[weekStart] = normalizeWeekBoardHeight(rawWeeks[weekStart], SCHEDULE_MIN_CARD_HEIGHT); // NEW
    }); // NEW
    return out; // NEW
} // NEW

function serializeWeekBoardHeights(heights) { // NEW
    return JSON.stringify({ schemaVersion: 1, weeks: normalizeWeekBoardHeights(heights) }); // NEW
} // NEW

function formatScheduleClockMinute(totalMinutes) { // NEW
    const total = Math.max(0, Math.round(Number(totalMinutes) || 0)); // NEW
    const dayOffset = Math.floor(total / 1440); // NEW
    const minuteOfDay = total % 1440; // NEW
    const hour24 = Math.floor(minuteOfDay / 60); // NEW
    const minute = minuteOfDay % 60; // NEW
    const suffix = hour24 >= 12 ? 'PM' : 'AM'; // NEW
    const hour12 = hour24 % 12 || 12; // NEW
    return hour12 + ':' + String(minute).padStart(2, '0') + ' ' + suffix + (dayOffset > 0 ? '+' + dayOffset + 'd' : ''); // NEW
} // NEW

function formatScheduleTimeRange(startMinute, durationMinutes) { // NEW
    if (startMinute == null || startMinute === '' || durationMinutes == null || durationMinutes === '') return ''; // NEW
    const start = snapScheduleMinutes(startMinute, null); // NEW
    const duration = snapScheduleMinutes(durationMinutes, null); // NEW
    if (start == null || duration == null || duration <= 0) return ''; // NEW
    return formatScheduleClockMinute(start) + '-' + formatScheduleClockMinute(start + duration); // NEW
} // NEW

function normalizeWorkHourWindow(day) { // NEW
    const source = day && typeof day === 'object' ? day : {}; // NEW
    const closed = source.closed === true || source.closed === '1' || source.mode === 'closed'; // NEW
    const startMinute = Math.min(1440, snapScheduleMinutes(source.startMinute ?? source.start, DEFAULT_WORK_START_MINUTE)); // CHANGE
    const rawEnd = Math.min(1440, snapScheduleMinutes(source.endMinute ?? source.end, DEFAULT_WORK_END_MINUTE)); // NEW
    const endMinute = rawEnd > startMinute ? rawEnd : Math.min(1440, startMinute + 60); // NEW
    return { closed, startMinute, endMinute }; // CHANGE
} // NEW

function normalizeWeekWorkHours(value, fallback) { // NEW
    const source = value && typeof value === 'object' ? value : {}; // NEW
    const fallbackDays = Array.isArray(fallback) ? fallback : null; // NEW
    const rawDays = Array.isArray(source.days) ? source.days : (Array.isArray(value) ? value : []); // NEW
    const days = []; // NEW
    for (let i = 0; i < WEEK_DAY_LANE_KEYS.length; i += 1) { // NEW
        const fallbackDay = fallbackDays && fallbackDays[i] ? fallbackDays[i] : null; // NEW
        const rawDay = rawDays[i] && typeof rawDays[i] === 'object' ? rawDays[i] : null; // NEW
        days.push(normalizeWorkHourWindow(rawDay && fallbackDay ? Object.assign({}, fallbackDay, rawDay) : (rawDay || fallbackDay || null))); // CHANGE
    } // NEW
    return days; // NEW
} // NEW

function defaultWeekWorkHours() { // NEW
    return normalizeWeekWorkHours({ days: DEFAULT_WEEK_WORK_HOUR_WINDOWS }); // CHANGE: new boards use realistic home-gardener availability
} // NEW

function parseJsonObject(value) { // NEW
    if (!value) return null; // NEW
    try { // NEW
        const parsed = JSON.parse(String(value)); // NEW
        return parsed && typeof parsed === 'object' ? parsed : null; // NEW
    } catch (_) { // NEW
        return null; // NEW
    } // NEW
} // NEW

function serializeWeekWorkHours(days) { // NEW
    return JSON.stringify({ schemaVersion: 1, days: normalizeWeekWorkHours(days) }); // NEW
} // NEW

function resolveWeekWorkHours(defaultsValue, overridesValue, weekStartISO) { // NEW
    const defaults = normalizeWeekWorkHours(parseJsonObject(defaultsValue)); // NEW
    const overridesRoot = parseJsonObject(overridesValue) || {}; // NEW
    const byWeek = overridesRoot.weeks && typeof overridesRoot.weeks === 'object' ? overridesRoot.weeks : overridesRoot; // NEW
    const weekOverride = parseTaskCalendarISO(weekStartISO) ? byWeek[weekStartISO] : null; // NEW
    return normalizeWeekWorkHours(weekOverride, defaults); // NEW
} // NEW

function workWindowDurationMinutes(dayWindow) { // NEW
    const window = normalizeWorkHourWindow(dayWindow); // NEW
    return window.closed ? 0 : Math.max(0, window.endMinute - window.startMinute); // NEW
} // NEW

function buildWeekTimeScale(days) { // NEW
    const sourceDays = Array.isArray(days) ? days : []; // NEW
    const week = WEEK_DAY_LANE_KEYS.map((_laneKey, index) => sourceDays[index] ? normalizeWorkHourWindow(sourceDays[index]) : { closed: true, startMinute: DEFAULT_WORK_START_MINUTE, endMinute: DEFAULT_WORK_START_MINUTE }); // NEW
    const openDays = week.filter(day => day && !day.closed); // NEW
    if (!openDays.length) return { active: false, startMinute: null, endMinute: null, durationMinutes: 0, hourMarks: [] }; // NEW
    const earliest = openDays.reduce((min, day) => Math.min(min, day.startMinute), 1440); // NEW
    const latest = openDays.reduce((max, day) => Math.max(max, day.endMinute), 0); // NEW
    const startMinute = Math.max(0, Math.floor(earliest / 60) * 60); // NEW
    const endMinute = Math.min(1440, Math.ceil(latest / 60) * 60); // NEW
    const marks = []; // NEW
    for (let minute = startMinute; minute <= endMinute; minute += 60) marks.push(minute); // NEW
    return { active: true, startMinute, endMinute, durationMinutes: Math.max(0, endMinute - startMinute), hourMarks: marks }; // NEW
} // NEW

function getWeekTimeScaleOffsetPx(dayWindow, timeScale) { // NEW
    const window = normalizeWorkHourWindow(dayWindow); // NEW
    if (!timeScale || !timeScale.active || window.closed) return 0; // NEW
    return scheduleMinuteOffsetToPx(Math.max(0, window.startMinute - timeScale.startMinute)); // NEW
} // NEW

function defaultScheduleDurationFromHours(value) { // NEW
    const hours = Number(value); // NEW
    if (!Number.isFinite(hours) || hours <= 0) return 60; // NEW
    return Math.max(SCHEDULE_MINUTE_SNAP, snapScheduleMinutes(hours * 60, 60)); // NEW
} // NEW

function isScheduleBreakSource(source) { // NEW
    return String(readAttributeValue(source, TASK_SCHEDULE_BREAK_ATTR) || '') === '1'; // NEW
} // NEW

function resolveStackScheduleDuration(record) { // NEW
    const source = record && record.source; // NEW
    const existingDuration = snapScheduleMinutes(readAttributeValue(source, TASK_SCHEDULE_DURATION_MINUTES_ATTR), null); // NEW
    const rawHeight = Number(record && record.height); // NEW
    const hasUsableHeight = Number.isFinite(rawHeight) && rawHeight > 0; // NEW
    const heightDuration = hasUsableHeight ? schedulePxToMinutes(rawHeight) : null; // NEW
    if (existingDuration) return heightDuration || existingDuration; // NEW
    if (isScheduleBreakSource(source)) return heightDuration || 30; // NEW
    return defaultScheduleDurationFromHours(readAttributeValue(source, 'task_estimated_hours')) || heightDuration || 60; // NEW
} // NEW

function buildStackSchedulePlan(records, dayWindow) { // NEW
    const window = normalizeWorkHourWindow(dayWindow); // NEW
    const startMinute = window.startMinute; // NEW
    let cursor = startMinute; // NEW
    const items = []; // NEW
    for (const record of (Array.isArray(records) ? records : [])) { // NEW
        const duration = resolveStackScheduleDuration(record); // CHANGE
        const item = { // NEW
            id: record && record.id, // NEW
            startMinute: cursor, // NEW
            durationMinutes: duration, // NEW
            endMinute: cursor + duration, // NEW
            height: scheduleMinutesToPx(duration), // NEW
            overflow: !window.closed && cursor + duration > window.endMinute // NEW
        }; // NEW
        items.push(item); // NEW
        cursor += duration; // NEW
    } // NEW
    return { // NEW
        closed: window.closed, // NEW
        startMinute, // NEW
        endMinute: window.endMinute, // NEW
        items, // NEW
        overflowMinutes: window.closed ? 0 : Math.max(0, cursor - window.endMinute), // NEW
        contentEndMinute: cursor // NEW
    }; // NEW
} // NEW

// -------------------- Pure task policy: attribute access and kanban parenting -------------------- // NEW
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

function isScheduleBreakPolicySource(source) { // NEW: pure policy check keeps break cards out of non-schedule lanes
    return String(readAttributeValue(source, TASK_SCHEDULE_BREAK_ATTR) || '') === '1'; // NEW
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
    if (parentType === 'lane') { // CHANGE
        if (String(readAttributeValue(parent, 'lane_key') || '') === 'TODO_STAGED' && isScheduleBreakPolicySource(child)) return false; // NEW
        return childType === 'card'; // CHANGE
    } // CHANGE
    if (childType === 'lane' || childType === 'card') return false; // NEW
    return true; // NEW
} // NEW

// -------------------- Pure task policy: card metadata and scheduler sync -------------------- // NEW
function normalizeCardNote(value) { // NEW: normalize badge text and truncate by Unicode code point
    const collapsed = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return Array.from(collapsed).slice(0, CARD_NOTE_MAX_LENGTH).join('');
}

function normalizeTaskAssigneeRoleIds(value) { // NEW: tolerate malformed external data without mutating it
    let source = value; // NEW
    if (typeof source === 'string') { // NEW
        if (!source.trim()) return []; // NEW
        try { source = JSON.parse(source); } catch (_) { return []; } // NEW
    } // NEW
    if (!Array.isArray(source)) return []; // NEW
    return Array.from(new Set(source.map(id => String(id == null ? '' : id).trim()).filter(Boolean))).sort(); // NEW
} // NEW

function serializeTaskAssigneeRoleIds(value) { // NEW: one stable persisted representation
    const ids = normalizeTaskAssigneeRoleIds(value); // NEW
    return ids.length ? JSON.stringify(ids) : null; // NEW
} // NEW

function hasTaskAssignees(source) { // NEW
    return normalizeTaskAssigneeRoleIds(readAttributeValue(source, TASK_ASSIGNEE_ROLE_IDS_ATTR)).length > 0; // NEW
} // NEW

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

function planTaskAssignmentReplacement(existingRecords, tasks) { // NEW: full regeneration maps assignments only across unambiguous stable occurrence identities
    const existing = Array.isArray(existingRecords) ? existingRecords : []; // NEW
    const incoming = Array.isArray(tasks) ? tasks : []; // NEW
    const existingKey = record => String(record && (record.schedulerTaskKey || getSchedulerTaskKey(record.source || record)) || '').trim(); // NEW
    const incomingKey = task => String(task && (task.scheduler_task_key || task.schedulerTaskKey) || '').trim(); // NEW
    const countKeys = (items, readKey) => { // NEW
        const counts = new Map(); // NEW
        items.forEach(item => { const key = readKey(item); if (key) counts.set(key, (counts.get(key) || 0) + 1); }); // NEW
        return counts; // NEW
    }; // NEW
    const existingCounts = countKeys(existing, existingKey); // NEW
    const incomingCounts = countKeys(incoming, incomingKey); // NEW
    const preserved = []; // NEW
    const retainMissing = []; // NEW
    existing.forEach(record => { // NEW
        const source = record && (record.source || record); // NEW
        const roleIds = normalizeTaskAssigneeRoleIds(readAttributeValue(source, TASK_ASSIGNEE_ROLE_IDS_ATTR)); // NEW
        if (!roleIds.length) return; // NEW
        const key = existingKey(record); // NEW
        if (key && existingCounts.get(key) === 1 && incomingCounts.get(key) === 1) preserved.push({ key, roleIds }); // NEW
        else retainMissing.push(record); // NEW: unsafe mappings remain explicit instead of silently losing user assignments
    }); // NEW
    return { preserved, retainMissing }; // NEW
} // NEW

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

// -------------------- Pure task policy: repeat visibility -------------------- // NEW
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

const TASK_LANE_HEADER_HEIGHT = 40; // NEW: stable two-line title band for every non-day lane
const TASK_LANE_STACK_BORDER = 20; // NEW: matches the canonical Draw.io stack layout inset
const TASK_LANE_PAGER_MARGIN_TOP = 20; // NEW: reserves a 28px pager row without narrowing cards
const TASK_LANE_STACK_SPACING = 20; // NEW: matches LANE_STYLE_BASE stackSpacing
const TASK_LANE_MIN_CARD_HEIGHT = DEFAULT_TASK_CARD_HEIGHT; // CHANGE: full task cards must never be clamped below the standard 80px height
const TASK_LANE_MIN_HEIGHT = 126; // NEW: shared full and week non-day lane minimum

/**
 * Builds deterministic contiguous pages from authored card heights. // NEW
 * The returned heights are the only values that may be persisted as clamps. // NEW
 */
function buildTaskLanePagePlan(cardHeights, laneHeight) { // NEW
    const normalizedLaneHeight = Math.max(TASK_LANE_MIN_HEIGHT, Math.round(Number(laneHeight) || TASK_LANE_MIN_HEIGHT)); // NEW
    const inputHeights = Array.isArray(cardHeights) ? cardHeights : []; // NEW
    const normalizedHeights = inputHeights.map(height => Math.max(TASK_LANE_MIN_CARD_HEIGHT, Math.round(Number(height) || DEFAULT_TASK_CARD_HEIGHT))); // NEW
    const unpagedUsableHeight = Math.max(TASK_LANE_MIN_CARD_HEIGHT, normalizedLaneHeight - TASK_LANE_HEADER_HEIGHT - (TASK_LANE_STACK_BORDER * 2)); // NEW
    const unpagedHeights = normalizedHeights.map(height => Math.min(height, unpagedUsableHeight)); // NEW
    const stackHeight = heights => heights.reduce((total, height) => total + height, 0) + Math.max(0, heights.length - 1) * TASK_LANE_STACK_SPACING; // NEW

    if (stackHeight(unpagedHeights) <= unpagedUsableHeight) { // NEW
        return Object.freeze({ // NEW
            paged: false, // NEW
            heights: Object.freeze(unpagedHeights), // NEW
            pages: Object.freeze([{ start: 0, end: unpagedHeights.length }]), // NEW
            usableHeight: unpagedUsableHeight, // NEW
            pagerMarginTop: 0 // NEW
        }); // NEW
    } // NEW

    const pagedUsableHeight = Math.max(TASK_LANE_MIN_CARD_HEIGHT, unpagedUsableHeight - TASK_LANE_PAGER_MARGIN_TOP); // NEW
    const pagedHeights = normalizedHeights.map(height => Math.min(height, pagedUsableHeight)); // NEW
    const pages = []; // NEW
    let pageStart = 0; // NEW
    let pageHeight = 0; // NEW
    pagedHeights.forEach((height, index) => { // NEW
        const nextHeight = pageHeight === 0 ? height : pageHeight + TASK_LANE_STACK_SPACING + height; // NEW
        if (pageHeight > 0 && nextHeight > pagedUsableHeight) { // NEW
            pages.push(Object.freeze({ start: pageStart, end: index })); // NEW
            pageStart = index; // NEW
            pageHeight = height; // NEW
        } else { // NEW
            pageHeight = nextHeight; // NEW
        } // NEW
    }); // NEW
    pages.push(Object.freeze({ start: pageStart, end: pagedHeights.length })); // NEW

    return Object.freeze({ // NEW
        paged: true, // NEW
        heights: Object.freeze(pagedHeights), // NEW
        pages: Object.freeze(pages), // NEW
        usableHeight: pagedUsableHeight, // NEW
        pagerMarginTop: TASK_LANE_PAGER_MARGIN_TOP // NEW
    }); // NEW
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

const TASK_REFLOW_SCOPE_NAMES = Object.freeze(['full', 'classification', 'layout', 'lanes', 'badges']); // NEW: public scope names for board reflow callers
const TASK_REFLOW_COMMAND_SCOPES = Object.freeze({ // NEW: pure command-to-scope policy for tests and command routing
    boardNavigation: 'full', // NEW
    workflow: 'classification', // NEW
    drop: 'classification', // NEW
    dateEdit: 'classification', // NEW
    editHours: 'layout', // NEW
    dayLaneResize: 'layout', // NEW
    boardResize: 'layout', // NEW
    selection: 'badges', // NEW
    selectedPeriodStagedPaging: 'lanes', // NEW
    stagedBadgeRefresh: 'badges', // NEW
    noteEdit: 'badges' // NEW
}); // NEW

function normalizeTaskReflowScopePlan(scope) { // NEW: folds requested scopes into pass flags while preserving conservative behavior
    const raw = scope == null || scope === '' // NEW
        ? ['full'] // NEW
        : (Array.isArray(scope) ? scope : String(scope).split(/[,\s+]+/)); // NEW
    const requested = raw.map(item => String(item || '').trim()).filter(Boolean); // NEW
    const valid = requested.filter(item => TASK_REFLOW_SCOPE_NAMES.indexOf(item) >= 0); // NEW
    const wantsFull = valid.length === 0 || valid.indexOf('full') >= 0; // NEW
    const wantsClassification = wantsFull || valid.indexOf('classification') >= 0; // NEW
    const wantsLayout = wantsFull || wantsClassification || valid.indexOf('layout') >= 0; // NEW
    const wantsLanes = wantsFull || wantsClassification || wantsLayout || valid.indexOf('lanes') >= 0; // NEW
    const wantsBadges = wantsFull || wantsClassification || wantsLayout || valid.indexOf('badges') >= 0; // NEW
    return Object.freeze({ // NEW
        requested: wantsFull ? ['full'] : valid.slice(), // NEW
        full: wantsFull, // NEW
        classification: wantsClassification, // NEW
        lanes: wantsLanes, // NEW
        layout: wantsLayout, // NEW
        badges: wantsBadges // NEW
    }); // NEW
} // NEW

function getTaskReflowScopeForCommand(commandName) { // NEW: single pure map for command categories that intentionally narrow reflow work
    return TASK_REFLOW_COMMAND_SCOPES[commandName] || 'full'; // NEW
} // NEW

// -------------------- Pure core seams -------------------- // CHANGE: explicit internal policy boundaries without splitting this plugin file
const TaskPolicyCore = Object.freeze({ // CHANGE
    parseTaskCalendarISO, // CHANGE
    shiftTaskCalendarISO, // CHANGE
    normalizeTaskViewMode, // CHANGE
    normalizeWorkflowState, // CHANGE
    getTaskWeekStartISO, // CHANGE
    getTaskWeekEndISO, // CHANGE
    isTaskDateInWeek, // CHANGE
    getWeekLaneKeyForDate, // CHANGE
    getDateForWeekLaneKey, // CHANGE
    clampTaskDayToWeek, // CHANGE
    clampTaskStartToVisibleWeek, // CHANGE
    shiftTaskDayWithinWeek, // CHANGE
    getTaskViewLaneKeys, // CHANGE
    deriveWorkflowStateFromLaneKey, // CHANGE
    getEffectiveWorkflowState, // CHANGE
    isManualStagedSource, // CHANGE
    isPhysicallyOrManuallyStaged, // CHANGE
    isUserTouchedSchedulerCard, // CHANGE
    isUserTouchedSchedulerRecord, // CHANGE
    buildWorkflowPatch, // CHANGE
    buildIncompletePatch, // CHANGE
    decideTaskViewLaneKey, // CHANGE
    selectedPeriodStagedSortEnabled, // CHANGE
    buildSelectedPeriodStagedSortKey, // CHANGE
    compareSelectedPeriodStagedRecords, // CHANGE
    buildSelectedPeriodStagedStartText, // CHANGE
    buildSelectedPeriodStagedDueText, // CHANGE
    buildStagedStartDateAllocationPatch, // CHANGE
    normalizeTaskReflowScopePlan, // NEW
    getTaskReflowScopeForCommand // NEW
}); // CHANGE

const SchedulePolicyCore = Object.freeze({ // CHANGE
    snapScheduleMinutes, // CHANGE
    scheduleMinutesToPx, // CHANGE
    schedulePxToMinutes, // CHANGE
    scheduleMinuteOffsetToPx, // NEW
    schedulePxDeltaToMinutes, // NEW
    getDateScopedScheduleOrder, // CHANGE
    compareDateScopedScheduleOrderRecords, // CHANGE
    normalizeWeekDayLaneWidth, // CHANGE
    normalizeWeekDayLaneWidths, // CHANGE
    serializeWeekDayLaneWidths, // CHANGE
    normalizeNonDayLaneWidth, // NEW
    normalizeNonDayLaneWidths, // NEW
    serializeNonDayLaneWidths, // NEW
    normalizeWeekBoardHeight, // NEW
    normalizeWeekBoardHeights, // NEW
    serializeWeekBoardHeights, // NEW
    formatScheduleTimeRange, // CHANGE
    normalizeWorkHourWindow, // CHANGE
    normalizeWeekWorkHours, // CHANGE
    defaultWeekWorkHours, // CHANGE
    serializeWeekWorkHours, // CHANGE
    resolveWeekWorkHours, // CHANGE
    workWindowDurationMinutes, // CHANGE
    buildWeekTimeScale, // NEW
    getWeekTimeScaleOffsetPx, // NEW
    defaultScheduleDurationFromHours, // CHANGE
    buildStackSchedulePlan // CHANGE
}); // CHANGE

const TASK_REFLOW_TEST_COUNTER_KEYS = Object.freeze(['classification', 'layout', 'lanes', 'badges', 'boardLayout', 'schedulePack', 'labelWriteSkip']); // NEW

function getTaskReflowTestCounters() { // NEW: test-only runtime instrumentation, never persisted on graph cells
    if (typeof globalThis === 'undefined' || !globalThis.__TRELLIS_TASK_MANAGER_TEST__) return null; // NEW
    const existing = globalThis.__TRELLIS_TASK_REFLOW_COUNTERS__; // NEW
    if (existing && typeof existing === 'object') return existing; // NEW
    const counters = {}; // NEW
    TASK_REFLOW_TEST_COUNTER_KEYS.forEach(key => { counters[key] = 0; }); // NEW
    globalThis.__TRELLIS_TASK_REFLOW_COUNTERS__ = counters; // NEW
    return counters; // NEW
} // NEW

function bumpTaskReflowTestCounter(key) { // NEW
    const counters = getTaskReflowTestCounters(); // NEW
    if (!counters || TASK_REFLOW_TEST_COUNTER_KEYS.indexOf(key) < 0) return; // NEW
    counters[key] = (Number(counters[key]) || 0) + 1; // NEW
} // NEW

function snapshotTaskReflowTestCounters() { // NEW
    const counters = getTaskReflowTestCounters(); // NEW
    const out = {}; // NEW
    TASK_REFLOW_TEST_COUNTER_KEYS.forEach(key => { out[key] = counters ? Number(counters[key]) || 0 : 0; }); // NEW
    return out; // NEW
} // NEW

function resetTaskReflowTestCounters() { // NEW
    const counters = getTaskReflowTestCounters(); // NEW
    if (!counters) return snapshotTaskReflowTestCounters(); // NEW
    TASK_REFLOW_TEST_COUNTER_KEYS.forEach(key => { counters[key] = 0; }); // NEW
    return snapshotTaskReflowTestCounters(); // NEW
} // NEW

// -------------------- Test hook surface -------------------- // NEW
if (typeof globalThis !== 'undefined' && globalThis.__TRELLIS_TASK_MANAGER_TEST__) { // FIX: no runtime exposure unless tests opt in
    globalThis.__TRELLIS_TASK_MANAGER_TEST_HOOKS__ = {
        TaskPolicyCore, // CHANGE: grouped core seam exposed only to opt-in tests
        SchedulePolicyCore, // CHANGE: grouped core seam exposed only to opt-in tests
        normalizeTaskReplacementDetail,
        applyImmediateTaskReplacement,
        parseTaskCalendarISO: TaskPolicyCore.parseTaskCalendarISO, // CHANGE
        shiftTaskCalendarISO: TaskPolicyCore.shiftTaskCalendarISO, // CHANGE
        normalizeTaskViewMode: TaskPolicyCore.normalizeTaskViewMode, // CHANGE
        getTaskWeekStartISO: TaskPolicyCore.getTaskWeekStartISO, // CHANGE
        getTaskWeekEndISO: TaskPolicyCore.getTaskWeekEndISO, // CHANGE
        isTaskDateInWeek: TaskPolicyCore.isTaskDateInWeek, // CHANGE
        getWeekLaneKeyForDate: TaskPolicyCore.getWeekLaneKeyForDate, // CHANGE
        getDateForWeekLaneKey: TaskPolicyCore.getDateForWeekLaneKey, // CHANGE
        clampTaskDayToWeek: TaskPolicyCore.clampTaskDayToWeek, // CHANGE
        clampTaskStartToVisibleWeek: TaskPolicyCore.clampTaskStartToVisibleWeek, // CHANGE
        shiftTaskDayWithinWeek: TaskPolicyCore.shiftTaskDayWithinWeek, // CHANGE
        getTaskViewLaneKeys: TaskPolicyCore.getTaskViewLaneKeys, // CHANGE
        deriveWorkflowStateFromLaneKey: TaskPolicyCore.deriveWorkflowStateFromLaneKey, // CHANGE
        getEffectiveWorkflowState: TaskPolicyCore.getEffectiveWorkflowState, // CHANGE
        isManualStagedSource: TaskPolicyCore.isManualStagedSource, // CHANGE
        isPhysicallyOrManuallyStaged: TaskPolicyCore.isPhysicallyOrManuallyStaged, // CHANGE
        isUserTouchedSchedulerCard: TaskPolicyCore.isUserTouchedSchedulerCard, // CHANGE
        isUserTouchedSchedulerRecord: TaskPolicyCore.isUserTouchedSchedulerRecord, // CHANGE
        buildWorkflowPatch: TaskPolicyCore.buildWorkflowPatch, // CHANGE
        buildStagedStartDateAllocationPatch: TaskPolicyCore.buildStagedStartDateAllocationPatch, // CHANGE
        buildIncompletePatch: TaskPolicyCore.buildIncompletePatch, // CHANGE
        decideTaskViewLaneKey: TaskPolicyCore.decideTaskViewLaneKey, // CHANGE
        selectedPeriodStagedSortEnabled: TaskPolicyCore.selectedPeriodStagedSortEnabled, // CHANGE
        buildSelectedPeriodStagedSortKey: TaskPolicyCore.buildSelectedPeriodStagedSortKey, // CHANGE
        compareSelectedPeriodStagedRecords: TaskPolicyCore.compareSelectedPeriodStagedRecords, // CHANGE
        buildSelectedPeriodStagedStartText: TaskPolicyCore.buildSelectedPeriodStagedStartText, // CHANGE
        buildSelectedPeriodStagedDueText: TaskPolicyCore.buildSelectedPeriodStagedDueText, // CHANGE
        normalizeTaskReflowScopePlan: TaskPolicyCore.normalizeTaskReflowScopePlan, // NEW
        getTaskReflowScopeForCommand: TaskPolicyCore.getTaskReflowScopeForCommand, // NEW
        snapshotTaskReflowTestCounters, // NEW
        resetTaskReflowTestCounters, // NEW
        snapScheduleMinutes: SchedulePolicyCore.snapScheduleMinutes, // CHANGE
        scheduleMinutesToPx: SchedulePolicyCore.scheduleMinutesToPx, // CHANGE
        schedulePxToMinutes: SchedulePolicyCore.schedulePxToMinutes, // CHANGE
        scheduleMinuteOffsetToPx: SchedulePolicyCore.scheduleMinuteOffsetToPx, // NEW
        getDateScopedScheduleOrder: SchedulePolicyCore.getDateScopedScheduleOrder, // CHANGE
        compareDateScopedScheduleOrderRecords: SchedulePolicyCore.compareDateScopedScheduleOrderRecords, // CHANGE
        normalizeWeekDayLaneWidth: SchedulePolicyCore.normalizeWeekDayLaneWidth, // CHANGE
        normalizeWeekDayLaneWidths: SchedulePolicyCore.normalizeWeekDayLaneWidths, // CHANGE
        serializeWeekDayLaneWidths: SchedulePolicyCore.serializeWeekDayLaneWidths, // CHANGE
        normalizeWeekBoardHeight: SchedulePolicyCore.normalizeWeekBoardHeight, // NEW
        normalizeWeekBoardHeights: SchedulePolicyCore.normalizeWeekBoardHeights, // NEW
        serializeWeekBoardHeights: SchedulePolicyCore.serializeWeekBoardHeights, // NEW
        formatScheduleTimeRange: SchedulePolicyCore.formatScheduleTimeRange, // CHANGE
        normalizeWorkHourWindow: SchedulePolicyCore.normalizeWorkHourWindow, // CHANGE
        normalizeWeekWorkHours: SchedulePolicyCore.normalizeWeekWorkHours, // CHANGE
        defaultWeekWorkHours: SchedulePolicyCore.defaultWeekWorkHours, // CHANGE
        serializeWeekWorkHours: SchedulePolicyCore.serializeWeekWorkHours, // CHANGE
        resolveWeekWorkHours: SchedulePolicyCore.resolveWeekWorkHours, // CHANGE
        workWindowDurationMinutes: SchedulePolicyCore.workWindowDurationMinutes, // CHANGE
        buildWeekTimeScale: SchedulePolicyCore.buildWeekTimeScale, // NEW
        getWeekTimeScaleOffsetPx: SchedulePolicyCore.getWeekTimeScaleOffsetPx, // NEW
        defaultScheduleDurationFromHours: SchedulePolicyCore.defaultScheduleDurationFromHours, // CHANGE
        buildStackSchedulePlan: SchedulePolicyCore.buildStackSchedulePlan, // CHANGE
        getTaskDateRange, // NEW
        buildInitialCardDateAttributes, // NEW
        buildSchedulerTaskMetadataAttributes, // NEW
        getSchedulerTaskKey, // ADDED
        buildGeneratedTaskSyncAttributes, // ADDED
        buildGeneratedTaskSyncAttributesForExisting, // NEW
        planDifferentialTaskSync, // ADDED
        planTaskAssignmentReplacement, // NEW
        buildCardDateOverridePatch, // NEW
        buildCardDateResetPatch, // NEW
        isEditableCardDateLane, // NEW
        normalizeCardNote, // NEW
        buildCardNotePatch, // NEW
        normalizeTaskAssigneeRoleIds, // NEW
        serializeTaskAssigneeRoleIds, // NEW
        hasTaskAssignees, // NEW
        normalizeRepeatIdentityText, // NEW
        normalizeRepeatLinkedIds, // NEW
        buildRepeatSeriesKey, // NEW
        compareRepeatOccurrenceRecords, // NEW
        isCardVisibilityEligible, // NEW
        buildTaskLanePagePlan, // NEW
        planRepeatSeriesVisibility, // CHANGE
        getKanbanCellType, // NEW
        canParentKanbanCell // NEW
    };
}

// -------------------- Runtime facade -------------------- // CHANGE: one plugin entrypoint with explicit internal seams
function createGardenTaskManagerRuntime({ ui, taskPolicy, schedulePolicy }) { // CHANGE
    return Object.freeze({ // CHANGE
        install: function () { // CHANGE
            taskPolicy = taskPolicy || TaskPolicyCore; // CHANGE
            schedulePolicy = schedulePolicy || SchedulePolicyCore; // CHANGE
    const graph = ui.editor.graph;
    const model = graph.getModel();

    // -------------------- Runtime constants and plugin-local attributes -------------------- // NEW
    const BOARD_KEY = KANBAN_BOARD_KEY; // CHANGE
    const BOARD_ROLE_ATTR = 'board_role';
    const TG_COMPLETED_ATTR = 'tg_completed';                                            // NEW


    // -------------------- Template styles --------------------
    const BOARD_STYLE = // CHANGE: task layout owns board-child geometry instead of Draw.io stack fill
        'swimlane;fontStyle=2;horizontal=1;startSize=28;collapsible=1;swimlaneFillColor=#F8FAFC;fontFamily=Permanent Marker;fontSize=16;points=[];verticalAlign=top;resizable=1;strokeWidth=2;disableMultiStroke=1;'; // CHANGE: opaque body remains visible below shorter week lanes
    const LANE_STYLE_BASE =
        'swimlane;strokeWidth=2;fontFamily=Permanent Marker;fontSize=12;html=0;startSize=40;align=center;verticalAlign=middle;whiteSpace=wrap;spacingBottom=5;points=[];childLayout=stackLayout;stackBorder=20;stackSpacing=20;marginTop=0;resizeLast=0;resizeParent=0;horizontalStack=0;collapsible=1;fillStyle=solid;swimlaneFillColor=default;'; // CHANGE: real title band plus pager-safe vertical margin
    const SCHEDULE_LANE_STYLE_BASE = // NEW: plugin-owned schedule geometry prevents Draw.io stack layout from expanding day lanes
        'swimlane;strokeWidth=2;fontFamily=Permanent Marker;html=0;startSize=1;verticalAlign=bottom;spacingBottom=5;points=[];resizeLast=0;resizeParent=0;horizontalStack=0;collapsible=0;fillStyle=solid;swimlaneFillColor=default;'; // CHANGE
    const CARD_STYLE =
        'whiteSpace=wrap;html=1;strokeWidth=2;fillColor=swimlane;fontStyle=1;spacingTop=0;rounded=1;arcSize=9;points=[];fontFamily=Permanent Marker;hachureGap=8;fillWeight=1;';
    const BREAK_CARD_STYLE = CARD_STYLE + 'dashed=1;fillColor=#F3F4F6;strokeColor=#6B7280;'; // NEW

    // Lane fills
    const LANE_FILL = [
        '#DDD6FE', // UPCOMING (future) // NEW
        '#C7D2FE', // UPCOMING (year)
        '#BAE6FD', // UPCOMING (month)
        '#BBF7D0', // UPCOMING (week)
        '#E5E7EB', // TODO (staged)
        '#E0F2FE', // Sunday // CHANGE: schedule lanes share one neutral color
        '#E0F2FE', // Monday // CHANGE
        '#E0F2FE', // Tuesday // CHANGE
        '#E0F2FE', // Wednesday // CHANGE
        '#E0F2FE', // Thursday // CHANGE
        '#E0F2FE', // Friday // CHANGE
        '#E0F2FE', // Saturday // CHANGE
        '#F8CECC', // TODO
        '#FFF2CC', // DOING
        '#D5E8D4', // DONE
        '#D1FAE5', // DONE (week)
        '#A7F3D0', // DONE (month)
        '#6EE7B7', // DONE (year)
        '#F3F4F6'  // ARCHIVED
    ];

    const BOARD_GEOM = { x: 40, y: 40, w: 2200, h: 760 };
    const LANE_W = DEFAULT_DAY_LANE_WIDTH, LANE_H = 680, LANE_GAP = 16; // CHANGE
    const BOARD_LANE_Y = 28, BOARD_BOTTOM_PADDING = 10, FULL_LANE_MIN_H = TASK_LANE_MIN_HEIGHT; // CHANGE: one minimum for every non-day lane
    const WEEK_BOARD_TOP_MARGIN = 20; // NEW: replaces schedule-lane stackBorder so hour origin and resize math match
    const TASK_ACTION_OVERLAY_EXTRA_Y = 3; // CHANGE: nudges selected card/lane action overlays below handles
    const SCHEDULE_CARD_HORIZONTAL_INSET = 10; // CHANGE: day lanes own card x and width with fixed side gutters
    const WORKFLOW_CARD_FILL = { TODO: '#F8CECC', DOING: '#FFF2CC', DONE: '#D5E8D4' }; // NEW

    const LINK_ATTR = 'linkedTo';
    const REPEAT_HIDDEN_ATTR = 'repeat_hidden'; // NEW
    const REPEAT_EXPANDED_ATTR = 'repeat_expanded'; // NEW
    const REPEAT_BADGE_ATTR = 'repeat_badge'; // NEW

    const LANES = KANBAN_LANE_DEFS; // CHANGE: template and policy use the same canonical lane list
    const lanePagingStates = new Map(); // NEW: current plans drive DOM rendering without a public API
    let requestLanePagerOverlayRefresh = function () {}; // NEW: installed after the shared overlay host exists
    let taskPagingSelectionGuard = false; // NEW: prevents selection repair and reveal loops


    // -------------------- Draw.io adapter factory: values, cells, and model writes -------------------- // CHANGE
    function createTaskRuntimeAdapters({ graph }) { // CHANGE
        function ensureXmlValue(cell) { // CHANGE
            if (!cell.value || typeof cell.value === 'string') {
                const doc = mxUtils.createXmlDocument();
                const obj = doc.createElement('object');
                obj.setAttribute('label', cell.value || '');
                cell.value = obj;
            }
            return cell.value;
        }

        function setAttrNoUndo(cell, key, val, suppressRefresh) { // CHANGE
            ensureXmlValue(cell);
            const v = cell.value;
            if (!v || !v.setAttribute) return;

            if (val == null) v.removeAttribute(key);
            else v.setAttribute(key, String(val));

            if (!suppressRefresh) {
                graph.refresh(cell);
            }
        }

        function getAttr(cell, k) { // CHANGE
            const v = cell && cell.value;
            return (v && v.getAttribute) ? v.getAttribute(k) : null;
        }

        function createVertex(label, x, y, w, h, style) { // CHANGE
            const v = new mxCell(label || '', new mxGeometry(x, y, w, h), style || '');
            v.setVertex(true);
            v.setConnectable(false);
            return v;
        }

        return Object.freeze({ // CHANGE
            ensureXmlValue, // CHANGE
            setAttrNoUndo, // CHANGE
            getAttr, // CHANGE
            createVertex // CHANGE
        }); // CHANGE
    }

    const taskRuntimeAdapters = createTaskRuntimeAdapters({ graph }); // CHANGE
    const { ensureXmlValue, setAttrNoUndo, getAttr, createVertex } = taskRuntimeAdapters; // CHANGE

    function getTaskAssigneeRoleIds(card) { // NEW
        return normalizeTaskAssigneeRoleIds(getAttr(card, TASK_ASSIGNEE_ROLE_IDS_ATTR)); // NEW
    } // NEW

    function getCellStyleText(cell) { // NEW
        return String((cell && cell.getStyle && cell.getStyle()) || (cell && cell.style) || ''); // NEW
    } // NEW

    function styleHasFlag(cell, key) { // NEW
        return new RegExp('(^|;)' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=1(?=;|$)').test(getCellStyleText(cell)); // NEW
    } // NEW

    function getCellDisplayText(cell) { // NEW: role fields may use strings or XML labels
        if (!cell) return ''; // NEW
        const value = cell.value; // NEW
        const raw = value && value.getAttribute ? (value.getAttribute('label') || '') : (value == null ? '' : String(value)); // NEW
        const holder = document && document.createElement ? document.createElement('div') : null; // NEW
        if (holder) { holder.innerHTML = raw; return String(holder.textContent || '').replace(/\s+/g, ' ').trim(); } // NEW
        return String(raw).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); // NEW
    } // NEW

    function getStyleImageSource(cell) { // NEW: preserve data-uri semicolons without persisting the image on tasks
        const match = getCellStyleText(cell).match(/(?:^|;)image=(.*?)(?=;[A-Za-z_][A-Za-z0-9_]*=|;?$)/); // NEW
        return match ? String(match[1] || '').trim() : ''; // NEW
    } // NEW

    function isRoleCard(cell) { // NEW
        return !!(cell && model.isVertex(cell) && styleHasFlag(cell, 'role_card')); // NEW
    } // NEW

    function immediateChildren(cell) { // NEW
        const out = []; // NEW
        const count = cell ? model.getChildCount(cell) : 0; // NEW
        for (let i = 0; i < count; i++) { const child = model.getChildAt(cell, i); if (child) out.push(child); } // NEW
        return out; // NEW
    } // NEW

    function findRoleField(roleCard, tag, legacyIndex) { // NEW: tagged fields are stable; ordered geometry supports existing role cards
        const children = immediateChildren(roleCard); // NEW
        const tagged = children.find(child => styleHasFlag(child, tag)); // NEW
        if (tagged) return tagged; // NEW
        const legacyFields = children // NEW
            .filter(child => !styleHasFlag(child, 'role_imagerow')) // NEW
            .sort((left, right) => { // NEW
                const a = model.getGeometry(left) || {}; const b = model.getGeometry(right) || {}; // NEW
                return (Number(a.y) || 0) - (Number(b.y) || 0) || (Number(a.x) || 0) - (Number(b.x) || 0); // NEW
            }); // NEW
        return legacyFields[legacyIndex] || null; // NEW
    } // NEW

    function findRoleAvatar(roleCard) { // NEW
        const imageRow = immediateChildren(roleCard).find(child => styleHasFlag(child, 'role_imagerow')); // NEW
        return imageRow ? immediateChildren(imageRow).find(child => styleHasFlag(child, 'role_avatar')) || null : null; // NEW
    } // NEW

    function roleFieldText(cell, placeholder, fallback) { // NEW
        const text = getCellDisplayText(cell); // NEW
        return !text || text.toLowerCase() === placeholder.toLowerCase() ? fallback : text; // NEW
    } // NEW

    function readRoleProfile(roleCard, board) { // NEW
        if (!isRoleCard(roleCard)) return null; // NEW
        const id = String(roleCard.id || (roleCard.getId && roleCard.getId()) || ''); // NEW
        const name = roleFieldText(findRoleField(roleCard, 'role_name', 0), 'Name', 'Unnamed person'); // NEW
        const roleTitle = roleFieldText(findRoleField(roleCard, 'role_title', 1), 'Role/Title', 'Unspecified role'); // NEW
        const avatar = findRoleAvatar(roleCard); // NEW
        const boardId = board && String(board.id || (board.getId && board.getId()) || ''); // NEW
        const eligible = !!(boardId && getLinkSet(board).has(id) && getLinkSet(roleCard).has(boardId)); // NEW
        return { id, cell: roleCard, name, roleTitle, cardTitle: getCellDisplayText(roleCard), imageSource: getStyleImageSource(avatar), eligible }; // NEW
    } // NEW

    function getBoardRoleRoster(board) { // NEW: only direct reciprocal links form the assignable roster
        const profiles = []; // NEW
        getLinkSet(board).forEach(id => { // NEW
            const profile = readRoleProfile(model.getCell(id), board); // NEW
            if (profile && profile.eligible) profiles.push(profile); // NEW
        }); // NEW
        return profiles.sort((left, right) => left.roleTitle.localeCompare(right.roleTitle, undefined, { sensitivity: 'base' }) // NEW
            || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) || left.id.localeCompare(right.id)); // NEW
    } // NEW

    function resolveCardAssigneeProfiles(card, board) { // NEW
        return getTaskAssigneeRoleIds(card).map(id => { // NEW
            const profile = readRoleProfile(model.getCell(id), board); // NEW
            return profile || { id, cell: null, name: 'Deleted role', roleTitle: 'Unavailable', cardTitle: '', imageSource: '', eligible: false }; // NEW
        }).sort((left, right) => (left.eligible === right.eligible ? 0 : (left.eligible ? 1 : -1)) // NEW: warnings remain visible in compact stacks
            || left.roleTitle.localeCompare(right.roleTitle, undefined, { sensitivity: 'base' }) // NEW
            || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) || left.id.localeCompare(right.id)); // NEW
    } // NEW

    function roundedGeometryValue(value) { // NEW
        const numberValue = Number(value); // NEW
        return Number.isFinite(numberValue) ? Math.round(numberValue) : 0; // NEW
    } // NEW

    function roundedGeometryWidth(geo) { // NEW
        return geo ? roundedGeometryValue(geo.width) : null; // NEW
    } // NEW

    function roundedGeometryHeight(geo) { // NEW
        return geo ? roundedGeometryValue(geo.height) : null; // NEW
    } // NEW

    function geometryMatchesRounded(left, right) { // NEW
        if (!left || !right) return false; // NEW
        return roundedGeometryValue(left.x) === roundedGeometryValue(right.x) // NEW
            && roundedGeometryValue(left.y) === roundedGeometryValue(right.y) // NEW
            && roundedGeometryValue(left.width) === roundedGeometryValue(right.width) // NEW
            && roundedGeometryValue(left.height) === roundedGeometryValue(right.height); // NEW
    } // NEW

    function createTaskTransactionRunner({ model }) { // CHANGE: centralize command transaction boundaries
        function runModelUpdate(opts, fn) { // CHANGE
            const options = typeof opts === 'function' ? {} : (opts || {}); // CHANGE
            const body = typeof opts === 'function' ? opts : fn; // CHANGE
            if (typeof body !== 'function') return undefined; // CHANGE
            const insideUpdate = !!options.insideUpdate; // CHANGE
            if (!insideUpdate) model.beginUpdate(); // CHANGE
            try { // CHANGE
                return body(); // CHANGE
            } finally { // CHANGE
                if (!insideUpdate) model.endUpdate(); // CHANGE
            } // CHANGE
        } // CHANGE

        return Object.freeze({ runModelUpdate }); // CHANGE
    }

    const taskTransactions = createTaskTransactionRunner({ model }); // CHANGE

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

    // -------------------- Board and lane template commands -------------------- // NEW
    function ensureBoardTemplateIn(containerVertex, opts) {                                  // CHANGE
        const parent = containerVertex || graph.getDefaultParent();
        let { main } = findBoardsIn(parent);

        return taskTransactions.runModelUpdate(opts, function () {                           // CHANGE
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
        });                                                                                   // CHANGE
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

    function getBoardWeekWorkHours(board) { // NEW
        return schedulePolicy.resolveWeekWorkHours( // CHANGE
            getAttr(board, TASK_WORK_HOURS_DEFAULTS_ATTR), // NEW
            getAttr(board, TASK_WORK_HOURS_WEEK_OVERRIDES_ATTR), // NEW
            getSelectedWeekStart(board) // NEW
        ); // NEW
    } // NEW

    function getBoardWeekDayLaneWidths(board) { // NEW
        return schedulePolicy.normalizeWeekDayLaneWidths(getAttr(board, TASK_DAY_LANE_WIDTHS_ATTR), LANE_W); // CHANGE
    } // NEW

    function getWeekDayLaneWidth(board, laneKey) { // NEW
        if (!isWeekDayLane(laneKey)) return LANE_W; // NEW
        return getBoardWeekDayLaneWidths(board)[laneKey] || LANE_W; // NEW
    } // NEW

    function persistWeekDayLaneWidth(board, laneKey, width) { // NEW
        if (!board || !isWeekDayLane(laneKey)) return false; // NEW
        const widths = getBoardWeekDayLaneWidths(board); // NEW
        const nextWidth = schedulePolicy.normalizeWeekDayLaneWidth(width, LANE_W); // CHANGE
        if (widths[laneKey] === nextWidth) return false; // NEW
        widths[laneKey] = nextWidth; // NEW
        setAttrNoUndo(board, TASK_DAY_LANE_WIDTHS_ATTR, schedulePolicy.serializeWeekDayLaneWidths(widths), true); // CHANGE
        return true; // NEW
    } // NEW

    function getBoardNonDayLaneWidths(board) { // NEW
        return schedulePolicy.normalizeNonDayLaneWidths(getAttr(board, TASK_NON_DAY_LANE_WIDTHS_ATTR), LANE_W); // NEW
    } // NEW

    function getNonDayLaneWidth(board, laneKey) { // NEW
        if (isWeekDayLane(laneKey)) return LANE_W; // NEW
        return getBoardNonDayLaneWidths(board)[laneKey] || LANE_W; // NEW
    } // NEW

    function getBoardLayoutLaneWidth(board, laneKey) { // NEW
        return isWeekDayLane(laneKey) ? getWeekDayLaneWidth(board, laneKey) : getNonDayLaneWidth(board, laneKey); // NEW
    } // NEW

    function persistNonDayLaneWidth(board, laneKey, width) { // NEW
        if (!board || !laneKey || isWeekDayLane(laneKey)) return false; // NEW
        const widths = getBoardNonDayLaneWidths(board); // NEW
        const nextWidth = schedulePolicy.normalizeNonDayLaneWidth(width, LANE_W); // NEW
        if (widths[laneKey] === nextWidth) return false; // NEW
        widths[laneKey] = nextWidth; // NEW
        setAttrNoUndo(board, TASK_NON_DAY_LANE_WIDTHS_ATTR, schedulePolicy.serializeNonDayLaneWidths(widths), true); // NEW
        return true; // NEW
    } // NEW

    function getBoardWeekWorkHourEditState(board) { // NEW
        ensureBoardPlanningDefaults(board); // NEW
        const weekStart = getSelectedWeekStart(board); // NEW
        const defaults = normalizeWeekWorkHours(parseJsonObject(getAttr(board, TASK_WORK_HOURS_DEFAULTS_ATTR))); // NEW
        const overridesRoot = parseJsonObject(getAttr(board, TASK_WORK_HOURS_WEEK_OVERRIDES_ATTR)) || { schemaVersion: 1, weeks: {} }; // NEW
        const weeks = overridesRoot.weeks && typeof overridesRoot.weeks === 'object' ? overridesRoot.weeks : {}; // NEW
        const week = normalizeWeekWorkHours(weeks[weekStart], defaults); // NEW
        return { weekStart, defaults, weeks, week }; // NEW
    } // NEW

    function countVisibleLaneCards(lane) { // NEW
        return snapshotLaneCards(lane).filter(card => !model.isVisible || model.isVisible(card) !== false).length; // NEW
    } // NEW

    function selectedWeekDayHasVisibleCards(lane) { // NEW
        return countVisibleLaneCards(lane) > 0; // NEW
    } // NEW

    function persistSelectedWeekDayWorkWindow(board, dayIndex, dayWindow) { // NEW
        if (!board || dayIndex < 0 || dayIndex >= WEEK_DAY_LANE_KEYS.length) return false; // NEW
        const editState = getBoardWeekWorkHourEditState(board); // NEW
        if (!parseTaskCalendarISO(editState.weekStart)) return false; // NEW
        const nextWindow = normalizeWorkHourWindow(dayWindow); // NEW
        const currentWindow = normalizeWorkHourWindow(editState.week[dayIndex]); // NEW
        if (JSON.stringify(currentWindow) === JSON.stringify(nextWindow)) return false; // NEW
        const nextWeek = editState.week.slice(); // NEW
        nextWeek[dayIndex] = nextWindow; // NEW
        const nextWeeks = Object.assign({}, editState.weeks); // NEW
        nextWeeks[editState.weekStart] = { schemaVersion: 1, days: normalizeWeekWorkHours(nextWeek) }; // NEW
        setAttrNoUndo(board, TASK_WORK_HOURS_DEFAULTS_ATTR, serializeWeekWorkHours(editState.defaults), true); // NEW
        setAttrNoUndo(board, TASK_WORK_HOURS_WEEK_OVERRIDES_ATTR, JSON.stringify({ schemaVersion: 1, weeks: nextWeeks }), true); // NEW
        return true; // NEW
    } // NEW

    function persistWeekDayLaneHourResize(board, laneKey, previousGeo, currentGeo) { // NEW
        if (!board || !isWeekDayLane(laneKey) || !previousGeo || !currentGeo) return false; // NEW
        const dayIndex = getWeekDayIndexForLaneKey(laneKey); // NEW
        const editState = getBoardWeekWorkHourEditState(board); // NEW
        const currentWindow = normalizeWorkHourWindow(editState.week[dayIndex]); // NEW
        if (currentWindow.closed) return false; // NEW
        const previousTop = roundedGeometryValue(previousGeo.y); // NEW
        const currentTop = roundedGeometryValue(currentGeo.y); // NEW
        const previousBottom = roundedGeometryValue(previousGeo.y) + roundedGeometryValue(previousGeo.height); // NEW
        const currentBottom = roundedGeometryValue(currentGeo.y) + roundedGeometryValue(currentGeo.height); // NEW
        const topDeltaMinutes = schedulePolicy.schedulePxDeltaToMinutes(currentTop - previousTop); // NEW
        const bottomDeltaMinutes = schedulePolicy.schedulePxDeltaToMinutes(currentBottom - previousBottom); // NEW
        if (!topDeltaMinutes && !bottomDeltaMinutes) return false; // NEW
        let nextStart = currentWindow.startMinute; // NEW
        let nextEnd = currentWindow.endMinute; // NEW
        if (topDeltaMinutes) nextStart += topDeltaMinutes; // NEW
        if (bottomDeltaMinutes) nextEnd += bottomDeltaMinutes; // NEW
        nextStart = Math.max(0, Math.min(1440 - SCHEDULE_MINUTE_SNAP, snapScheduleMinutes(nextStart, currentWindow.startMinute))); // NEW
        nextEnd = Math.max(SCHEDULE_MINUTE_SNAP, Math.min(1440, snapScheduleMinutes(nextEnd, currentWindow.endMinute))); // NEW
        if (nextEnd <= nextStart) { // NEW
            if (bottomDeltaMinutes && !topDeltaMinutes) nextEnd = Math.min(1440, nextStart + SCHEDULE_MINUTE_SNAP); // NEW
            else nextStart = Math.max(0, nextEnd - SCHEDULE_MINUTE_SNAP); // NEW
        } // NEW
        return persistSelectedWeekDayWorkWindow(board, dayIndex, { closed: false, startMinute: nextStart, endMinute: nextEnd }); // NEW
    } // NEW

    function getBoardWeekBoardHeights(board) { // NEW
        return schedulePolicy.normalizeWeekBoardHeights(getAttr(board, TASK_WEEK_BOARD_HEIGHTS_ATTR)); // NEW
    } // NEW

    function getPersistedWeekBoardHeight(board) { // NEW
        const weekStart = getSelectedWeekStart(board); // NEW
        return getBoardWeekBoardHeights(board)[weekStart] || null; // NEW
    } // NEW

    function deriveWeekBoardHeightFromBoardGeometry(board) { // NEW
        const geo = board && model.getGeometry ? model.getGeometry(board) : (board && board.getGeometry ? board.getGeometry() : null); // NEW
        return schedulePolicy.normalizeWeekBoardHeight(geo ? geo.height : BOARD_GEOM.h, BOARD_GEOM.h); // NEW
    } // NEW

    function persistWeekBoardHeight(board, height) { // NEW
        if (!board) return false; // NEW
        const weekStart = getSelectedWeekStart(board); // NEW
        if (!parseTaskCalendarISO(weekStart)) return false; // NEW
        const heights = getBoardWeekBoardHeights(board); // NEW
        const nextHeight = schedulePolicy.normalizeWeekBoardHeight(height, BOARD_GEOM.h); // NEW
        if (heights[weekStart] === nextHeight) return false; // NEW
        heights[weekStart] = nextHeight; // NEW
        setAttrNoUndo(board, TASK_WEEK_BOARD_HEIGHTS_ATTR, schedulePolicy.serializeWeekBoardHeights(heights), true); // NEW
        return true; // NEW
    } // NEW

    function normalizeFullLaneHeight(value, fallback) { // NEW
        const numeric = Number(value); // NEW
        const base = Number.isFinite(numeric) ? numeric : fallback; // NEW
        return Math.max(FULL_LANE_MIN_H, Math.round(Number.isFinite(base) ? base : LANE_H)); // NEW
    } // NEW

    function getPersistedFullLaneHeight(board) { // NEW
        const raw = getAttr(board, TASK_FULL_LANE_HEIGHT_ATTR); // NEW
        return raw == null || raw === '' ? null : normalizeFullLaneHeight(raw, LANE_H); // NEW
    } // NEW

    function getBoardFullLaneHeight(board) { // NEW
        return getPersistedFullLaneHeight(board) || LANE_H; // NEW
    } // NEW

    function deriveFullLaneHeightFromBoardGeometry(board) { // NEW
        const geo = board && model.getGeometry ? model.getGeometry(board) : (board && board.getGeometry ? board.getGeometry() : null); // NEW
        return normalizeFullLaneHeight((geo ? geo.height : BOARD_GEOM.h) - BOARD_LANE_Y - BOARD_BOTTOM_PADDING, LANE_H); // NEW
    } // NEW

    function persistFullLaneHeight(board, height) { // NEW
        if (!board) return false; // NEW
        const nextHeight = normalizeFullLaneHeight(height, LANE_H); // NEW
        if (getPersistedFullLaneHeight(board) === nextHeight) return false; // NEW
        setAttrNoUndo(board, TASK_FULL_LANE_HEIGHT_ATTR, String(nextHeight), true); // NEW
        return true; // NEW
    } // NEW

    function getWeekDayIndexForLaneKey(laneKey) { // NEW
        return WEEK_DAY_LANE_KEYS.indexOf(String(laneKey || '')); // NEW
    } // NEW

    function getVisibleDateForWeekLane(board, laneKey) { // NEW
        return isWeekDayLane(laneKey) ? getDateForWeekLaneKey(laneKey, getSelectedWeekStart(board)) : null; // NEW
    } // NEW

    function reconcileScheduleBreakOwnership(board, laneKey, card) { // NEW
        if (!board || !card || !isWeekDayLane(laneKey) || !isScheduleBreakCard(card)) return false; // NEW
        const visibleDate = getVisibleDateForWeekLane(board, laneKey); // NEW
        if (!visibleDate) return false; // NEW
        let changed = false; // NEW
        const ownerDay = getAttr(card, TASK_ASSIGNED_DAY_ATTR); // NEW
        if (!parseTaskCalendarISO(ownerDay)) { // NEW
            setAttrNoUndo(card, TASK_ASSIGNED_DAY_ATTR, visibleDate, true); // NEW
            changed = true; // NEW
        } // NEW
        const active = getAttr(card, TASK_ASSIGNED_DAY_ATTR) === visibleDate; // NEW
        const curVisible = model.isVisible ? model.isVisible(card) : true; // NEW
        if (curVisible !== active && model.setVisible) { // NEW
            model.setVisible(card, active); // NEW
            changed = true; // NEW
        } // NEW
        if (!active) { // NEW
            changed = setDerivedCardAttribute(card, TASK_SCHEDULE_START_MINUTE_ATTR, null) || changed; // NEW
        } // NEW
        return changed; // NEW
    } // NEW

    function isActiveScheduleCardForLane(board, laneKey, card) { // NEW
        if (!isScheduleBreakCard(card)) return true; // NEW
        return getAttr(card, TASK_ASSIGNED_DAY_ATTR) === getVisibleDateForWeekLane(board, laneKey); // NEW
    } // NEW

    function markScheduleLaneOrderDirty(lane) { // NEW
        if (lane && isWeekDayLane(getAttr(lane, 'lane_key'))) lane.__trellisScheduleOrderDirty = true; // NEW
    } // NEW

    function isScheduleLaneOrderDirty(lane) { // NEW
        return !!(lane && lane.__trellisScheduleOrderDirty); // NEW
    } // NEW

    function clearScheduleLaneOrderDirty(lane) { // NEW
        if (lane) lane.__trellisScheduleOrderDirty = false; // NEW
    } // NEW

    function getOrderedScheduleLaneCards(board, lane, laneKey) { // NEW
        const visibleDay = getVisibleDateForWeekLane(board, laneKey); // NEW
        const records = snapshotLaneCards(lane).map((card, index) => ({ // NEW
            id: card.id, // NEW
            cell: card, // NEW
            source: card.value, // NEW
            fallbackIndex: index // NEW
        })).filter(record => isActiveScheduleCardForLane(board, laneKey, record.cell)); // NEW
        if (!isScheduleLaneOrderDirty(lane)) records.sort((left, right) => compareDateScopedScheduleOrderRecords(left, right, visibleDay)); // NEW
        return records.map(record => record.cell); // NEW
    } // NEW

    function getLaneScheduleRecords(board, lane, laneKey) { // CHANGE
        return getOrderedScheduleLaneCards(board, lane, laneKey).map((card, index) => { // CHANGE
            const geo = model.getGeometry(card); // NEW
            return { // NEW
                id: card.id, // NEW
                cell: card, // NEW
                source: card.value, // NEW
                fallbackIndex: index, // NEW
                height: geo ? geo.height : SCHEDULE_MIN_CARD_HEIGHT // NEW
            }; // NEW
        }); // NEW
    } // NEW

    function computeWeekLaneHeight(board, lanes, laneKey) { // NEW
        if (!isWeekDayLane(laneKey)) return LANE_H; // NEW
        const dayIndex = getWeekDayIndexForLaneKey(laneKey); // NEW
        const workHours = getBoardWeekWorkHours(board); // NEW
        const dayWindow = workHours[dayIndex]; // NEW
        if (dayWindow && dayWindow.closed) return SCHEDULE_MIN_CARD_HEIGHT; // CHANGE
        return Math.max(SCHEDULE_MIN_CARD_HEIGHT, schedulePolicy.scheduleMinutesToPx(schedulePolicy.workWindowDurationMinutes(dayWindow))); // CHANGE
    } // NEW

    function getCanonicalLaneStyle(laneKey, emphasized, paged) { // CHANGE: retain card stacking while reserving pager height only
        const laneIndex = LANES.findIndex(lane => lane.key === laneKey); // NEW
        const fillIndex = laneIndex >= 0 ? laneIndex % LANE_FILL.length : 0; // NEW
        const styleBase = isWeekDayLane(laneKey) ? SCHEDULE_LANE_STYLE_BASE : LANE_STYLE_BASE; // NEW
        let style = styleBase + 'fillColor=' + LANE_FILL[fillIndex] + ';strokeColor=' + LANE_FILL[fillIndex] + ';'; // CHANGE
        if (!isWeekDayLane(laneKey)) style = setStyleKey(style, 'marginTop', paged ? String(TASK_LANE_PAGER_MARGIN_TOP) : '0'); // NEW
        return setStyleKey(style, 'strokeWidth', emphasized ? '3' : '2'); // NEW
    } // NEW

    function ensureCanonicalBoardStyle(board) { // NEW: recognized task boards are managed components
        if (!board || board.getStyle() === BOARD_STYLE) return false; // NEW
        board.setStyle(BOARD_STYLE); // NEW
        return true; // NEW
    } // NEW

    function ensureCanonicalLaneStyles(lanes, selectedWeekLaneKey) { // NEW: migrate legacy resizeParent lane styles on every layout
        Object.keys(lanes || {}).forEach(laneKey => { // NEW
            const lane = lanes[laneKey]; // NEW
            if (!lane) return; // NEW
            const style = getCanonicalLaneStyle(laneKey, laneKey === selectedWeekLaneKey, !!getAttr(lane, TASK_PAGE_ANCHOR_ATTR)); // CHANGE
            if (lane.getStyle() !== style) lane.setStyle(style); // NEW
        }); // NEW
    } // NEW

    function applyBoardViewLayout(board, lanes) { // NEW
        bumpTaskReflowTestCounter('boardLayout'); // NEW
        ensureCanonicalBoardStyle(board); // NEW
        ensureBoardPlanningDefaults(board); // NEW
        const mode = getBoardViewMode(board); // NEW
        const visibleKeys = taskPolicy.getTaskViewLaneKeys(mode); // CHANGE
        const visibleSet = new Set(visibleKeys); // NEW
        const selectedWeekLaneKey = mode === 'WEEK' ? taskPolicy.getWeekLaneKeyForDate(getSelectedDay(board), getSelectedWeekStart(board)) : null; // CHANGE
        ensureCanonicalLaneStyles(lanes, selectedWeekLaneKey); // NEW
        const laneHeights = {}; // NEW
        const laneYOffsets = {}; // NEW
        let maxLaneHeight = mode === 'WEEK' ? 0 : getBoardFullLaneHeight(board); // CHANGE
        let weekTimeScale = null; // NEW
        const y = BOARD_LANE_Y + (mode === 'WEEK' ? WEEK_BOARD_TOP_MARGIN : 0); // CHANGE
        if (mode === 'WEEK') { // NEW
            const workHours = getBoardWeekWorkHours(board); // NEW
            weekTimeScale = schedulePolicy.buildWeekTimeScale(workHours); // NEW
            const weekScaleHeight = weekTimeScale.active ? schedulePolicy.scheduleMinuteOffsetToPx(weekTimeScale.durationMinutes) : SCHEDULE_MIN_CARD_HEIGHT; // NEW
            WEEK_DAY_LANE_KEYS.forEach(laneKey => { // NEW
                const dayIndex = getWeekDayIndexForLaneKey(laneKey); // NEW
                laneYOffsets[laneKey] = schedulePolicy.getWeekTimeScaleOffsetPx(workHours[dayIndex], weekTimeScale); // NEW
                laneHeights[laneKey] = computeWeekLaneHeight(board, lanes, laneKey); // NEW
                maxLaneHeight = Math.max(maxLaneHeight, laneYOffsets[laneKey] + laneHeights[laneKey]); // CHANGE
            }); // NEW
            const persistedBoardHeight = getPersistedWeekBoardHeight(board); // NEW
            const requestedLaneHeight = persistedBoardHeight == null ? 0 : persistedBoardHeight - y - BOARD_BOTTOM_PADDING; // CHANGE
            laneHeights.TODO_STAGED = Math.max(TASK_LANE_MIN_HEIGHT, weekScaleHeight, maxLaneHeight, requestedLaneHeight); // CHANGE: real header remains usable when all days are closed
            maxLaneHeight = Math.max(maxLaneHeight, laneHeights.TODO_STAGED); // NEW
        } // NEW
        let x = 10; // NEW

        visibleKeys.forEach(laneKey => { // NEW
            const lane = lanes[laneKey]; // NEW
            if (!lane) return; // NEW
            if (mode === 'WEEK' && laneKey === WEEK_DAY_LANE_KEYS[0]) x += WEEK_TIME_RULER_WIDTH + LANE_GAP; // NEW
            const laneWidth = getBoardLayoutLaneWidth(board, laneKey); // CHANGE: non-day lanes persist widths by lane key; day lanes keep existing behavior
            const geo = lane.getGeometry() ? lane.getGeometry().clone() : new mxGeometry(x, y, LANE_W, LANE_H); // NEW
            geo.x = x; // NEW
            geo.y = y + (mode === 'WEEK' && isWeekDayLane(laneKey) ? (laneYOffsets[laneKey] || 0) : 0); // CHANGE
            geo.width = laneWidth; // CHANGE
            geo.height = laneHeights[laneKey] || maxLaneHeight; // CHANGE
            if (!geometryMatchesRounded(lane.getGeometry && lane.getGeometry(), geo)) model.setGeometry(lane, geo); // CHANGE
            if (mode === 'WEEK' && isWeekDayLane(laneKey)) { // NEW
                const dayIndex = getWeekDayIndexForLaneKey(laneKey); // NEW
                const dayWindow = getBoardWeekWorkHours(board)[dayIndex]; // NEW
                const label = (getAttr(lane, 'status') || lane.value || '') + (dayWindow && dayWindow.closed ? ' (closed)' : ''); // NEW
                ensureXmlValue(lane).setAttribute('label', label); // NEW
            } // NEW
            if (model.isVisible && model.isVisible(lane) === false) model.setVisible(lane, true); // NEW
            x += laneWidth + LANE_GAP; // CHANGE
        }); // NEW

        Object.keys(lanes).forEach(laneKey => { // NEW
            const lane = lanes[laneKey]; // NEW
            if (!lane) return; // NEW
            if (!visibleSet.has(laneKey) && (!model.isVisible || model.isVisible(lane) !== false)) model.setVisible(lane, false); // NEW
        }); // NEW

        const totalW = Math.max(BOARD_GEOM.w, x - LANE_GAP + 10); // CHANGE
        const geo = board.getGeometry().clone(); // NEW
        geo.width = totalW; // CHANGE
        const weekContentHeight = mode === 'WEEK' ? Math.max(SCHEDULE_MIN_CARD_HEIGHT, maxLaneHeight, laneHeights.TODO_STAGED || 0) : maxLaneHeight; // NEW
        geo.height = mode === 'WEEK' ? y + weekContentHeight + BOARD_BOTTOM_PADDING : (getPersistedFullLaneHeight(board) ? y + maxLaneHeight + BOARD_BOTTOM_PADDING : BOARD_GEOM.h); // CHANGE
        if (!geometryMatchesRounded(board.getGeometry && board.getGeometry(), geo)) model.setGeometry(board, geo); // CHANGE
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

        LANES.forEach((lane, idx) => { // CHANGE
            const style = getCanonicalLaneStyle(lane.key, false); // CHANGE

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

    function createBoardLayoutService(api) { // CHANGE: explicit runtime seam for board/lane layout commands
        return Object.freeze({ // CHANGE
            ensureBoardTemplateIn: api.ensureBoardTemplateIn, // CHANGE
            createSecondaryBoardIn: api.createSecondaryBoardIn, // CHANGE
            ensureLanes: api.ensureLanes, // CHANGE
            lanesMap: api.lanesMap, // CHANGE
            applyBoardViewLayout: api.applyBoardViewLayout, // CHANGE
            getBoardWeekWorkHours: api.getBoardWeekWorkHours, // CHANGE
            getBoardWeekDayLaneWidths: api.getBoardWeekDayLaneWidths, // CHANGE
            getWeekDayLaneWidth: api.getWeekDayLaneWidth, // CHANGE
            persistWeekDayLaneWidth: api.persistWeekDayLaneWidth, // CHANGE
            getVisibleDateForWeekLane: api.getVisibleDateForWeekLane // CHANGE
        }); // CHANGE
    }

    const boardLayoutService = createBoardLayoutService({ // CHANGE
        ensureBoardTemplateIn, // CHANGE
        createSecondaryBoardIn, // CHANGE
        ensureLanes, // CHANGE
        lanesMap, // CHANGE
        applyBoardViewLayout, // CHANGE
        getBoardWeekWorkHours, // CHANGE
        getBoardWeekDayLaneWidths, // CHANGE
        getWeekDayLaneWidth, // CHANGE
        persistWeekDayLaneWidth, // CHANGE
        getVisibleDateForWeekLane // CHANGE
    }); // CHANGE

    // tiler group completed helpers

    // -------------------- Linked group state adapters -------------------- // NEW
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

    function removeStyleKeyIfValue(style, key, values) {                                  // NEW: staged reset only removes workflow-owned values
        const allowed = new Set((values || []).map(String));                              // NEW
        const parts = String(style || '').split(';').filter(Boolean);                      // NEW
        const kept = parts.filter(part => {                                                // NEW
            const idx = part.indexOf('=');                                                 // NEW
            if (idx < 0) return true;                                                      // NEW
            return part.slice(0, idx) !== key || !allowed.has(part.slice(idx + 1));         // NEW
        });                                                                                 // NEW
        return kept.join(';') + (kept.length ? ';' : '');                                  // NEW
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

    // -------------------- Runtime calendar adapters -------------------- // CHANGE
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

    function getBoardSortContext(board) { // NEW
        return { // NEW
            board, // NEW
            viewMode: getBoardViewMode(board), // NEW
            selectedDay: getSelectedDay(board), // NEW
            selectedWeekStart: getSelectedWeekStart(board), // NEW
            today: todayISO() // NEW
        }; // NEW
    } // NEW

    function selectedWeekDayLaneForBoard(board) { // NEW
        if (!board) return null; // NEW
        const selected = getSelectionCellsList(); // NEW
        for (const cell of selected) { // NEW
            let cur = cell; // NEW
            while (cur && cur !== board) { // NEW
                if (isWeekDayLane(getAttr(cur, 'lane_key')) && findBoardAncestor(cur) === board) return cur; // NEW
                cur = model.getParent(cur); // NEW
            } // NEW
        } // NEW
        return null; // NEW
    } // NEW

    function weekDayLaneAncestorForCell(cell, board) { // NEW
        let cur = cell; // NEW
        while (cur && cur !== board) { // NEW
            if (isWeekDayLane(getAttr(cur, 'lane_key')) && (!board || findBoardAncestor(cur) === board)) return cur; // NEW
            cur = model.getParent(cur); // NEW
        } // NEW
        return null; // NEW
    } // NEW

    function getBoardBadgeContext(board) { // NEW
        const context = getBoardSortContext(board); // NEW
        if (context.viewMode !== 'WEEK') return context; // NEW
        const selectedLane = selectedWeekDayLaneForBoard(board); // NEW
        if (!selectedLane) return Object.assign(context, { weekBadgeAnchor: 'WEEK' }); // NEW
        const laneDay = getDateForWeekLaneKey(getAttr(selectedLane, 'lane_key'), context.selectedWeekStart); // NEW
        return Object.assign(context, { weekBadgeAnchor: 'DAY', selectedDay: laneDay || context.selectedDay }); // NEW
    } // NEW

    function ensureBoardPlanningDefaults(board) { // NEW
        if (!board) return; // NEW
        const today = todayISO(); // NEW
        const weekStart = getTaskWeekStartISO(today); // NEW
        if (!getAttr(board, TASK_VIEW_MODE_ATTR)) setAttrNoUndo(board, TASK_VIEW_MODE_ATTR, 'FULL', true); // NEW
        if (getAttr(board, TASK_VIEW_MODE_ATTR) === 'DAY') setAttrNoUndo(board, TASK_VIEW_MODE_ATTR, 'WEEK', true); // NEW
        if (!parseTaskCalendarISO(getAttr(board, TASK_SELECTED_WEEK_START_ATTR))) setAttrNoUndo(board, TASK_SELECTED_WEEK_START_ATTR, weekStart, true); // NEW
        if (!parseTaskCalendarISO(getAttr(board, TASK_SELECTED_DAY_ATTR))) setAttrNoUndo(board, TASK_SELECTED_DAY_ATTR, weekStart, true); // NEW
        if (!parseJsonObject(getAttr(board, TASK_WORK_HOURS_DEFAULTS_ATTR))) setAttrNoUndo(board, TASK_WORK_HOURS_DEFAULTS_ATTR, serializeWeekWorkHours(defaultWeekWorkHours()), true); // NEW
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
                scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('dateEdit') }); // CHANGE
            } else {
                updateBadgeForLane(card, laneKeyOfCard(card), true); // CHANGE: note-only edits refresh badges without board classification
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

    // -------------------- Runtime classification policy -------------------- // CHANGE
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


    // -------------------- Card presentation helpers -------------------- // CHANGE
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
    function renderScheduleTimeBadge(card, laneKey) { // NEW
        if (!isWeekDayLane(laneKey)) return ''; // CHANGE
        return renderBadge('Time', formatScheduleTimeRange(getAttr(card, TASK_SCHEDULE_START_MINUTE_ATTR), getAttr(card, TASK_SCHEDULE_DURATION_MINUTES_ATTR))); // NEW
    } // NEW
    function computeBadgesFor(card, laneKey, opts) { // CHANGE
        const startISO = getAttr(card, 'start');
        const endISO = getAttr(card, 'end');
        const compISO = getAttr(card, 'completed');
        if (selectedPeriodStagedSortEnabled(laneKey, opts)) { // CHANGE
            const startText = buildSelectedPeriodStagedStartText(card && card.value, opts); // CHANGE
            return { primaryText: startText || '', html: renderBadge('Start', startText) }; // CHANGE
        } // NEW
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


    // -------------------- Lane sorting policy -------------------- // CHANGE
    function tsFromISO(iso) {
        const d = parseLocalISO(iso);
        return d ? d.getTime() : null;
    }

    function getLaneSortKey(laneKey, card, opts) { // CHANGE
        if (selectedPeriodStagedSortEnabled(laneKey, opts)) return buildSelectedPeriodStagedSortKey(card && card.value, opts); // NEW
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
                const key = getLaneSortKey(laneKey, c, opts); // CHANGE
                const title = (getAttr(c, 'title') || '').toLowerCase();
                items.push({ cell: c, key, title });
            }
        }
        if (!items.length) return [];

        // Choose comparator                                                                                
        let cmp;
        if (selectedPeriodStagedSortEnabled(laneKey, opts)) { // NEW
            cmp = (a, b) => compareSelectedPeriodStagedSortKeys(a.key, b.key); // NEW
        } else if (isDoneLikeLane(laneKey)) { // CHANGE
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


    // -------------------- Lane paging commands -------------------- // CHANGE

    function taskCellId(cell) { // NEW
        return String(cell && (cell.id || (cell.getId && cell.getId())) || ''); // NEW
    } // NEW

    function setCellVisibleNoUndo(cell, visible) { // NEW: cached page visibility persists without creating an undo edit
        const next = !!visible; // NEW
        const current = !model.isVisible || model.isVisible(cell); // NEW
        if (current === next) return false; // NEW
        if (cell && typeof cell.setVisible === 'function') cell.setVisible(next); // NEW
        else if (cell) cell.visible = next; // NEW
        return true; // NEW
    } // NEW

    function setCellGeometryNoUndo(cell, geometry) { // NEW: paging is view state even when it restacks the visible page
        const current = cell && (cell.getGeometry ? cell.getGeometry() : cell.geometry); // NEW
        if (!cell || !geometry || geometryMatchesRounded(current, geometry)) return false; // NEW
        if (typeof cell.setGeometry === 'function') cell.setGeometry(geometry); // NEW
        else cell.geometry = geometry; // NEW
        return true; // NEW
    } // NEW

    function setLanePageLabelNoUndo(lane, pageIndex, pageCount) { // NEW
        const value = ensureXmlValue(lane); // NEW
        const baseLabel = String(getAttr(lane, 'status') || ''); // NEW
        const nextLabel = pageCount > 1 ? `${baseLabel}\nPage ${pageIndex + 1} of ${pageCount}` : baseLabel; // NEW
        if ((value.getAttribute('label') || '') === nextLabel) return false; // NEW
        value.setAttribute('label', nextLabel); // NEW
        return true; // NEW
    } // NEW

    function findPageIndexForCardIndex(pages, cardIndex) { // NEW
        const index = (pages || []).findIndex(page => cardIndex >= page.start && cardIndex < page.end); // NEW
        return index >= 0 ? index : 0; // NEW
    } // NEW

    function applyPersistedHeightClamps(cards, plan) { // NEW
        let changed = false; // NEW
        (cards || []).forEach((card, index) => { // NEW
            const geo = card && (card.getGeometry ? card.getGeometry() : card.geometry); // NEW
            const nextHeight = plan.heights[index]; // NEW
            if (!geo || nextHeight == null || Math.round(Number(geo.height) || 0) === nextHeight) return; // NEW
            const nextGeo = geo.clone ? geo.clone() : new mxGeometry(geo.x || 0, geo.y || 0, geo.width || 160, geo.height || nextHeight); // NEW
            nextGeo.height = nextHeight; // NEW
            changed = setCellGeometryNoUndo(card, nextGeo) || changed; // NEW
            persistFullCardHeight(card, nextHeight); // NEW: destructive clamp is intentionally persisted without undo
        }); // NEW
        return changed; // NEW
    } // NEW

    function layoutVisibleLanePageNoUndo(lane, cards, plan, page) { // NEW: mirrors mxStackLayout without generating geometry edits
        const laneGeo = lane && (lane.getGeometry ? lane.getGeometry() : lane.geometry); // NEW
        if (!laneGeo || !page) return false; // NEW
        const x = TASK_LANE_STACK_BORDER; // NEW
        const width = Math.max(TASK_LANE_MIN_CARD_HEIGHT, Math.round(Number(laneGeo.width) || LANE_W) - (TASK_LANE_STACK_BORDER * 2)); // NEW
        let y = TASK_LANE_HEADER_HEIGHT + TASK_LANE_STACK_BORDER + plan.pagerMarginTop; // NEW
        let changed = false; // NEW
        for (let index = page.start; index < page.end; index++) { // NEW
            const card = cards[index]; // NEW
            const geo = card && (card.getGeometry ? card.getGeometry() : card.geometry); // NEW
            if (!geo) continue; // NEW
            const nextGeo = geo.clone ? geo.clone() : new mxGeometry(geo.x || 0, geo.y || 0, geo.width || width, geo.height || plan.heights[index]); // NEW
            nextGeo.x = x; // NEW
            nextGeo.y = y; // NEW
            nextGeo.width = width; // NEW
            nextGeo.height = plan.heights[index]; // NEW
            changed = setCellGeometryNoUndo(card, nextGeo) || changed; // NEW
            y += nextGeo.height + TASK_LANE_STACK_SPACING; // NEW
        } // NEW
        return changed; // NEW
    } // NEW

    function setPagingSelectionCell(cell) { // NEW
        if (!cell || !graph.setSelectionCell) return; // NEW
        taskPagingSelectionGuard = true; // NEW
        try { graph.setSelectionCell(cell); } finally { taskPagingSelectionGuard = false; } // NEW
    } // NEW

    function applyLanePaging(lane, laneKey, sortedCards, opts) { // CHANGE: task manager owns height planning, visibility, anchor, and selection repair
        if (!lane) return null; // NEW
        const options = opts || {}; // NEW
        const renderableCards = (sortedCards || []).filter(isRenderableKanbanCard); // CHANGE
        const allLaneCards = []; // NEW: rebuild the complete persisted visibility cache, including excluded occurrences
        for (let childIndex = 0; childIndex < model.getChildCount(lane); childIndex++) { // NEW
            const child = model.getChildAt(lane, childIndex); // NEW
            if (child && model.isVertex(child) && isKanbanCard(child)) allLaneCards.push(child); // NEW
        } // NEW
        allLaneCards.filter(card => renderableCards.indexOf(card) < 0).forEach(card => setCellVisibleNoUndo(card, false)); // NEW
        setAttrNoUndo(lane, 'page_index', null, true); // CHANGE: legacy numeric state always resets during migration

        if (isWeekDayLane(laneKey)) { // NEW: time-based schedule lanes are never paged
            setAttrNoUndo(lane, TASK_PAGE_ANCHOR_ATTR, null, true); // NEW
            renderableCards.forEach(card => setCellVisibleNoUndo(card, true)); // CHANGE
            lanePagingStates.delete(taskCellId(lane)); // NEW
            requestLanePagerOverlayRefresh(); // NEW
            return null; // NEW
        } // NEW

        const laneGeo = lane.getGeometry ? lane.getGeometry() : lane.geometry; // NEW
        const plan = buildTaskLanePagePlan(renderableCards.map(card => { // NEW
            const geo = card && (card.getGeometry ? card.getGeometry() : card.geometry); // NEW
            return geo ? geo.height : DEFAULT_TASK_CARD_HEIGHT; // NEW
        }), laneGeo ? laneGeo.height : TASK_LANE_MIN_HEIGHT); // NEW
        let changed = applyPersistedHeightClamps(renderableCards, plan); // NEW
        let pageIndex = 0; // NEW

        if (plan.paged) { // NEW
            if (Number.isFinite(Number(options.targetPageIndex))) { // NEW
                pageIndex = Math.max(0, Math.min(plan.pages.length - 1, Math.trunc(Number(options.targetPageIndex)))); // NEW
            } else { // NEW
                const anchorId = options.anchorCardId == null ? getAttr(lane, TASK_PAGE_ANCHOR_ATTR) : String(options.anchorCardId); // NEW
                const anchorIndex = renderableCards.findIndex(card => taskCellId(card) === String(anchorId || '')); // NEW
                pageIndex = anchorIndex >= 0 ? findPageIndexForCardIndex(plan.pages, anchorIndex) : 0; // NEW: missing anchors reset to page one
            } // NEW
            const anchorCard = renderableCards[plan.pages[pageIndex].start]; // NEW
            setAttrNoUndo(lane, TASK_PAGE_ANCHOR_ATTR, taskCellId(anchorCard), true); // NEW: canonical page-first rebasing
        } else { // NEW
            setAttrNoUndo(lane, TASK_PAGE_ANCHOR_ATTR, null, true); // NEW
        } // NEW

        const page = plan.pages[pageIndex] || { start: 0, end: 0 }; // NEW
        renderableCards.forEach((card, index) => { // NEW
            changed = setCellVisibleNoUndo(card, index >= page.start && index < page.end) || changed; // NEW
        }); // NEW
        if (plan.paged) changed = layoutVisibleLanePageNoUndo(lane, renderableCards, plan, page) || changed; // CHANGE: leave authored geometry untouched when no pager is needed
        const nextStyle = setStyleKey(getCellStyleText(lane), 'marginTop', String(plan.pagerMarginTop)); // NEW
        if (lane.getStyle() !== nextStyle) { lane.setStyle(nextStyle); changed = true; } // NEW
        changed = setLanePageLabelNoUndo(lane, pageIndex, plan.pages.length) || changed; // NEW

        const state = { lane, laneKey, board: findBoardAncestor(lane), cards: renderableCards, plan, pageIndex }; // NEW
        lanePagingStates.set(taskCellId(lane), state); // NEW
        if (changed) { // NEW
            if (graph.view && graph.view.invalidate) graph.view.invalidate(lane, true, true); // NEW
            graph.refresh(lane); // CHANGE
        } // NEW

        if (options.explicitNavigation) { // NEW
            setPagingSelectionCell(lane); // NEW: every real page change falls back to its lane
        } // NEW
        requestLanePagerOverlayRefresh(); // NEW
        return state; // NEW
    } // CHANGE

    function navigateLaneToPage(lane, laneKey, targetPageIndex) { // NEW
        const current = lanePagingStates.get(taskCellId(lane)); // NEW
        const currentIndex = current ? current.pageIndex : 0; // NEW
        const targetIndex = Math.trunc(Number(targetPageIndex)); // NEW
        if (!Number.isFinite(targetIndex) || targetIndex === currentIndex) return current; // NEW
        return applyLanePaging(lane, laneKey, getLaneCardsInOrder(lane), { targetPageIndex: targetIndex, explicitNavigation: true }); // NEW
    } // NEW

    function changeLanePage(lane, laneKey, delta) { // CHANGE
        if (!lane) return null; // CHANGE
        const current = lanePagingStates.get(taskCellId(lane)) || applyLanePaging(lane, laneKey, getLaneCardsInOrder(lane), { skipSelectionRepair: true }); // NEW
        return navigateLaneToPage(lane, laneKey, (current ? current.pageIndex : 0) + delta); // CHANGE
    } // CHANGE


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

    function getScheduleLaneCardsInOrder(board, lane, laneKey) { // NEW
        return getOrderedScheduleLaneCards(board, lane, laneKey); // CHANGE
    } // NEW


    function resortAndPageLane(lane, laneKey, opts) {
        if (isWeekDayLane(laneKey)) { // NEW: manual stack order is schedule order
            const board = (opts && opts.board) || findBoardAncestor(lane); // NEW
            const cards = getScheduleLaneCardsInOrder(board, lane, laneKey); // CHANGE
            applyLanePaging(lane, laneKey, cards); // NEW
            applySchedulePlanToDayLane(board, lane, laneKey, { refresh: false }); // CHANGE
            return; // NEW
        } // NEW
        const sortedCards = sortLaneCards(lane, laneKey, opts) || [];
        const pageOptions = {}; // NEW
        if (opts && opts.resetSelectedPeriodStagedPage && selectedPeriodStagedSortEnabled(laneKey, opts)) pageOptions.anchorCardId = ''; // NEW: selected-period changes start from the newly sorted first page
        applyLanePaging(lane, laneKey, sortedCards, pageOptions); // CHANGE
    }

    function refreshSelectedPeriodStagedBadges(board, opts) { // NEW
        if (!board) return false; // NEW
        const lane = boardLanes(board).TODO_STAGED; // NEW
        if (!lane) return false; // NEW
        let changed = false; // NEW
        const insideUpdate = opts && opts.insideUpdate; // NEW
        if (!insideUpdate) model.beginUpdate(); // NEW
        try { // NEW
            snapshotLaneCards(lane).forEach(card => { // NEW
                if (!isRenderableKanbanCard(card)) return; // NEW
                changed = updateBadgeForLane(card, 'TODO_STAGED', true) || changed; // NEW
            }); // NEW
        } finally { // NEW
            if (!insideUpdate) model.endUpdate(); // NEW
        } // NEW
        if (changed) graph.refresh(lane); // NEW
        return changed; // NEW
    } // NEW

    // -------------------- Card label rendering -------------------- // CHANGE
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
        const scheduleTimeBadge = renderScheduleTimeBadge(card, laneKey); // NEW
        const stateBadge = viewMode === 'WEEK' && getEffectiveWorkflowState(card.value, laneKey) === 'DOING' ? renderBadge('State', 'DOING') : ''; // NEW
        const missingBadge = viewMode !== 'FULL' && getAttr(card, TASK_SCHEDULER_MISSING_ATTR) === '1' ? renderBadge('Scheduler', 'Missing') : ''; // NEW
        const incompleteBadge = viewMode !== 'FULL' ? renderBadge('Incomplete', getAttr(card, TASK_INCOMPLETE_DAY_ATTR)) : ''; // NEW

        const badgesBlock = (scheduleTimeBadge || badgesHtml || stateBadge || missingBadge || incompleteBadge || repeatBadge || noteBadge || editedDateBadge || linkBadge) // CHANGE
            ? ('<br/>' + scheduleTimeBadge + badgesHtml + stateBadge + missingBadge + incompleteBadge + repeatBadge + noteBadge + editedDateBadge + linkBadge) // CHANGE
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

    function buildCardBadgeInputSignature(card, laneKey, badgeContext) { // NEW: runtime-only signature of every field that can affect card label badges
        const board = findBoardAncestor(card); // NEW
        const context = badgeContext || (board ? getBoardBadgeContext(board) : { viewMode: 'FULL' }); // NEW
        const fields = [ // NEW
            laneKey || '', // NEW
            context.viewMode || '', // NEW
            context.selectedDay || '', // NEW
            context.selectedWeekStart || '', // NEW
            context.weekBadgeAnchor || '', // NEW
            context.today || '', // NEW
            board ? getBoardViewMode(board) : 'FULL', // NEW
            getAttr(card, 'title') || '', // NEW
            getAttr(card, 'start') || '', // NEW
            getAttr(card, 'end') || '', // NEW
            getAttr(card, 'completed') || '', // NEW
            getAttr(card, TASK_WORKFLOW_STATE_ATTR) || '', // NEW
            getAttr(card, TASK_ASSIGNED_DAY_ATTR) || '', // NEW
            getAttr(card, TASK_SCHEDULE_START_MINUTE_ATTR) || '', // NEW
            getAttr(card, TASK_SCHEDULE_DURATION_MINUTES_ATTR) || '', // NEW
            getAttr(card, TASK_SCHEDULER_MISSING_ATTR) || '', // NEW
            getAttr(card, TASK_INCOMPLETE_DAY_ATTR) || '', // NEW
            getAttr(card, REPEAT_BADGE_ATTR) || '', // NEW
            getAttr(card, REPEAT_HIDDEN_ATTR) || '', // NEW
            getAttr(card, 'year_hidden') || '', // NEW
            getAttr(card, 'date_override') || '', // NEW
            getAttr(card, 'base_start') || '', // NEW
            getAttr(card, 'base_end') || '', // NEW
            getCardNote(card) || '', // NEW
            getAttr(card, LINK_ATTR) || '', // NEW
            getLinkCount(card) // NEW
        ]; // NEW
        return fields.map(value => String(value).replace(/[|\\]/g, '\\$&')).join('|'); // NEW
    } // NEW

    function updateBadgeForLane(card, laneKey, suppressRefresh) {
        const oldBadge = getAttr(card, 'badge') || '';
        const oldHtml = getAttr(card, 'badges_html') || '';
        const board = findBoardAncestor(card); // NEW
        const badgeContext = board ? getBoardBadgeContext(board) : { viewMode: 'FULL' }; // CHANGE
        const signature = buildCardBadgeInputSignature(card, laneKey, badgeContext); // NEW
        if (card.__trellisTaskBadgeSignature === signature) { bumpTaskReflowTestCounter('labelWriteSkip'); return false; } // CHANGE

        const badges = computeBadgesFor(card, laneKey, badgeContext); // CHANGE
        const newBadge = badges.primaryText || '';
        const newHtml = badges.html || '';

        if (oldBadge === newBadge && oldHtml === newHtml) {
            card.__trellisTaskBadgeSignature = signature; // NEW
            refreshCardLabel(card, suppressRefresh);
            return false;
        }

        setBadge(card, newBadge, true);
        setAttrNoUndo(card, 'badges_html', newHtml, true);
        card.__trellisTaskBadgeSignature = signature; // NEW
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
        const preserveCardIds = opts && opts.preserveCardIds instanceof Set ? opts.preserveCardIds : new Set(); // NEW

        model.beginUpdate();
        try {
            for (const c of linkedCells) {
                if (!isKanbanCard(c)) continue;

                const linkSet = getLinkSet(c);
                if (!linkSet || !linkSet.has(targetGroupId)) continue;

                const board = findBoardAncestor(c); // NEW
                if (board) affectedBoards.set(board.id, board); // NEW

                if (preserveCardIds.has(String(c.id || (c.getId && c.getId()) || ''))) { // NEW
                    markGeneratedTaskCardMissing(c, affectedBoards); // NEW: retain unsafe or removed assignment occurrences as one scheduler user-touch transaction
                    continue; // NEW
                } // NEW

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



    // -------------------- Task creation and card commands -------------------- // CHANGE
    function createTasks(tasks, targetGroupId, opts) {
        if (!Array.isArray(tasks) || tasks.length === 0) return [];

        const reflow = !opts || opts.reflow !== false;
        const assignmentIdsByTaskKey = opts && opts.assignmentIdsByTaskKey; // NEW

        let gardenModule = null;
        const grp = model.getCell(targetGroupId);
        if (grp) {
            const gm = findGardenModuleAncestor(grp);
            if (gm) gardenModule = gm;
        }

        const out = [];

        model.beginUpdate();
        try {
            const { board, lanes } = boardLayoutService.ensureBoardTemplateIn(gardenModule, { insideUpdate: true });   // CHANGE

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
                const schedulerTaskKey = String(schedulerAttrs.scheduler_task_key || ''); // NEW
                const preservedAssignees = schedulerTaskKey && assignmentIdsByTaskKey && assignmentIdsByTaskKey.get ? assignmentIdsByTaskKey.get(schedulerTaskKey) : null; // NEW
                if (preservedAssignees && preservedAssignees.length) setAttrNoUndo(card, TASK_ASSIGNEE_ROLE_IDS_ATTR, serializeTaskAssigneeRoleIds(preservedAssignees), true); // NEW

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
        const card = createVertex('', 0, 0, 160, DEFAULT_TASK_CARD_HEIGHT, CARD_STYLE); // CHANGE
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




    // -------------------- Linking and scheduler sync commands -------------------- // CHANGE
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

    function historyCellIds(cells) { // NEW
        return (cells || []).map(cell => cell && (cell.id || (cell.getId && cell.getId()))).filter(Boolean).map(String); // NEW
    } // NEW

    function runTrellisHistoryTransaction(metadata, operation) { // NEW
        const history = typeof window !== "undefined" && window.Trellis && window.Trellis.history; // NEW
        if (history && typeof history.run === "function" && !isTrellisHistoryRestoring()) { // NEW
            return history.run(metadata, operation); // NEW
        } // NEW
        return operation(); // NEW
    } // NEW

    function isTrellisHistoryRestoring() { // NEW
        const history = typeof window !== "undefined" && window.Trellis && window.Trellis.history; // NEW
        return !!(history && typeof history.isRestoring === "function" && history.isRestoring()); // NEW
    } // NEW

    function buildDifferentialTaskSyncRecords(targetGroupId) { // ADDED
        const grp = targetGroupId ? model.getCell(targetGroupId) : null; // ADDED
        if (!grp) return null; // ADDED
        const records = getLinkedCellsOf(grp) // ADDED
            .filter(cell => isKanbanCard(cell)) // ADDED
            .filter(card => getLinkSet(card).has(targetGroupId)) // ADDED
            .map(card => ({ card, source: card.value, schedulerTaskKey: getSchedulerTaskKey(card.value), laneKey: laneKeyOfCard(card) })); // CHANGE
        return { group: grp, records }; // ADDED
    } // ADDED

    function replaceTasksPreservingAssignments(targetGroupId, tasks) { // NEW
        const normalizedTasks = Array.isArray(tasks) ? tasks : []; // NEW
        return runTrellisHistoryTransaction({ category: "Tasks", action: "replace", origin: "Garden_Task_Manager", title: "Replace linked tasks", affectedCellIds: [targetGroupId].filter(Boolean) }, function () { // NEW
            const source = buildDifferentialTaskSyncRecords(targetGroupId); // NEW
            const preservation = planTaskAssignmentReplacement(source && source.records, normalizedTasks); // NEW
            const assignmentIdsByTaskKey = new Map(preservation.preserved.map(entry => [entry.key, entry.roleIds])); // NEW
            const preserveCardIds = new Set(preservation.retainMissing.map(record => String(record.card && (record.card.id || (record.card.getId && record.card.getId())) || ''))); // NEW
            removeTasksLinkedOnlyTo(targetGroupId, { reflow: !normalizedTasks.length, preserveCardIds }); // CHANGE
            if (normalizedTasks.length) createTasks(normalizedTasks, targetGroupId, { reflow: true, assignmentIdsByTaskKey }); // NEW
        }); // NEW
    } // NEW

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
        const tasks = Array.isArray(opts.tasks) ? opts.tasks : []; // CHANGE: the sync command owns its input guard and does not depend on an undefined global normalizer
        const syncSource = buildDifferentialTaskSyncRecords(targetGroupId); // ADDED
        if (!syncSource) return []; // ADDED
        const plan = planDifferentialTaskSync(syncSource.records, tasks); // ADDED
        if (plan.legacyReplace) { // ADDED
            return replaceTasksPreservingAssignments(targetGroupId, tasks); // CHANGE
        } // ADDED
        if (!plan.updates.length && !plan.removes.length && !plan.missing.length) { // CHANGE
            if (plan.creates.length) createTasks(plan.creates.map(item => item.task), targetGroupId, { reflow: true }); // ADDED
            return plan; // ADDED
        } // ADDED

        const affectedBoards = new Map(); // ADDED
        const gardenModule = findGardenModuleAncestor(syncSource.group); // ADDED
        model.beginUpdate(); // ADDED
        try { // ADDED
            const template = boardLayoutService.ensureBoardTemplateIn(gardenModule, { insideUpdate: true }); // CHANGE
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


    // -------------------- Board reflow orchestration -------------------- // CHANGE

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

    function applyScheduleCardVisualStyle(card, laneKey, overflow) { // NEW
        if (!card || !isWeekDayLane(laneKey)) return false; // NEW
        let nextStyle = card.getStyle ? card.getStyle() : card.style || ''; // NEW
        const before = nextStyle; // NEW
        if (isScheduleBreakCard(card)) { // NEW
            nextStyle = setStyleKey(nextStyle, 'fillColor', '#F3F4F6'); // NEW
            nextStyle = setStyleKey(nextStyle, 'strokeColor', overflow ? '#B91C1C' : '#6B7280'); // NEW
        } else { // NEW
            const state = getEffectiveWorkflowState(card.value, laneKey); // NEW
            nextStyle = setStyleKey(nextStyle, 'fillColor', WORKFLOW_CARD_FILL[state] || WORKFLOW_CARD_FILL.TODO); // NEW
            nextStyle = setStyleKey(nextStyle, 'strokeColor', overflow ? '#B91C1C' : '#000000'); // NEW
        } // NEW
        if (nextStyle === before) return false; // NEW
        card.setStyle(nextStyle); // NEW
        return true; // NEW
    } // NEW

    function applyStagedCardVisualStyle(card, laneKey) { // NEW: moving back to staged clears week workflow colors
        if (!card || String(laneKey || '') !== 'TODO_STAGED' || isScheduleBreakCard(card)) return false; // NEW
        let nextStyle = card.getStyle ? card.getStyle() : card.style || ''; // NEW
        const before = nextStyle; // NEW
        nextStyle = setStyleKey(nextStyle, 'fillColor', 'swimlane'); // NEW
        nextStyle = removeStyleKeyIfValue(nextStyle, 'strokeColor', ['#000000', '#B91C1C']); // NEW
        if (nextStyle === before) return false; // NEW
        card.setStyle(nextStyle); // NEW
        return true; // NEW
    } // NEW

    function syncScheduleLanePhysicalOrder(lane, records) { // NEW
        let changed = false; // NEW
        (records || []).forEach((record, index) => { // NEW
            if (!record || !record.cell) return; // NEW
            if (model.getChildAt(lane, index) === record.cell) return; // NEW
            model.add(lane, record.cell, index); // NEW
            changed = true; // NEW
        }); // NEW
        return changed; // NEW
    } // NEW

    function persistScheduleLaneOrder(records, visibleDay) { // NEW
        let changed = false; // NEW
        (records || []).forEach((record, index) => { // NEW
            if (!record || !record.cell) return; // NEW
            changed = setDerivedCardAttribute(record.cell, TASK_SCHEDULE_ORDER_ATTR, index) || changed; // NEW
            changed = setDerivedCardAttribute(record.cell, TASK_SCHEDULE_ORDER_DAY_ATTR, visibleDay) || changed; // NEW
        }); // NEW
        return changed; // NEW
    } // NEW

    function applyScheduleCardGeometry(board, lane, card, item, plan) { // CHANGE: use the same canonical lane width as board layout
        const currentGeo = model.getGeometry(card); // NEW
        const laneWidth = getWeekDayLaneWidth(board, getAttr(lane, 'lane_key')); // CHANGE: avoid stale pre-layout lane geometry
        const nextWidth = Math.max(SCHEDULE_MIN_CARD_HEIGHT, laneWidth - (SCHEDULE_CARD_HORIZONTAL_INSET * 2)); // CHANGE
        const nextGeo = currentGeo && currentGeo.clone ? currentGeo.clone() : new mxGeometry(SCHEDULE_CARD_HORIZONTAL_INSET, 0, nextWidth, SCHEDULE_MIN_CARD_HEIGHT); // CHANGE
        nextGeo.x = SCHEDULE_CARD_HORIZONTAL_INSET; // CHANGE
        nextGeo.width = nextWidth; // CHANGE
        if (item && plan) { // NEW: closed lanes retain vertical geometry while still matching lane width
            nextGeo.y = schedulePolicy.scheduleMinuteOffsetToPx(item.startMinute - plan.startMinute); // CHANGE
            nextGeo.height = item.height; // CHANGE
        } // NEW
        if (geometryMatchesRounded(currentGeo, nextGeo)) return false; // NEW
        model.setGeometry(card, nextGeo); // NEW
        return true; // NEW
    } // NEW

    function applySchedulePlanToDayLane(board, lane, laneKey, opts) { // NEW
        if (!board || !lane || !isWeekDayLane(laneKey)) return false; // NEW
        bumpTaskReflowTestCounter('schedulePack'); // NEW
        const dayIndex = getWeekDayIndexForLaneKey(laneKey); // NEW
        const dayWindow = getBoardWeekWorkHours(board)[dayIndex]; // NEW
        const visibleDay = getVisibleDateForWeekLane(board, laneKey); // NEW
        const records = getLaneScheduleRecords(board, lane, laneKey); // CHANGE
        const plan = buildStackSchedulePlan(records, dayWindow); // NEW
        let changed = syncScheduleLanePhysicalOrder(lane, records); // NEW
        changed = persistScheduleLaneOrder(records, visibleDay) || changed; // NEW
        if (plan.closed) { // NEW
            records.forEach(record => { // NEW
                changed = applyScheduleCardGeometry(board, lane, record.cell, null, null) || changed; // CHANGE: closed day cards still follow lane-owned horizontal geometry
                const startChanged = setDerivedCardAttribute(record.cell, TASK_SCHEDULE_START_MINUTE_ATTR, null); // NEW
                const durationChanged = setDerivedCardAttribute(record.cell, TASK_SCHEDULE_DURATION_MINUTES_ATTR, null); // NEW
                const scheduleChanged = startChanged || durationChanged; // CHANGE
                if (scheduleChanged) refreshCardLabel(record.cell, true); // NEW
                changed = scheduleChanged || changed; // NEW
            }); // NEW
            clearScheduleLaneOrderDirty(lane); // NEW
            return changed; // NEW
        } // NEW
        plan.items.forEach((item, index) => { // NEW
            const record = records[index]; // NEW
            if (!record || !record.cell) return; // NEW
            const startChanged = setDerivedCardAttribute(record.cell, TASK_SCHEDULE_START_MINUTE_ATTR, item.startMinute); // NEW
            const durationChanged = setDerivedCardAttribute(record.cell, TASK_SCHEDULE_DURATION_MINUTES_ATTR, item.durationMinutes); // NEW
            const scheduleChanged = startChanged || durationChanged; // CHANGE
            if (scheduleChanged) refreshCardLabel(record.cell, true); // NEW
            changed = scheduleChanged || changed; // NEW
            changed = applyScheduleCardGeometry(board, lane, record.cell, item, plan) || changed; // CHANGE
            changed = applyScheduleCardVisualStyle(record.cell, laneKey, item.overflow) || changed; // CHANGE
        }); // NEW
        clearScheduleLaneOrderDirty(lane); // NEW
        if (changed && (!opts || opts.refresh !== false)) graph.refresh(lane); // NEW
        return changed; // NEW
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

    function normalizeTaskCardHeight(value, fallback) { // NEW: shared guard for persisted full-view heights and restored geometry
        const numeric = Number(value); // NEW
        const fallbackNumeric = Number(fallback); // NEW
        const base = Number.isFinite(numeric) ? numeric : (Number.isFinite(fallbackNumeric) ? fallbackNumeric : DEFAULT_TASK_CARD_HEIGHT); // NEW
        return Math.max(SCHEDULE_MIN_CARD_HEIGHT, Math.round(base)); // NEW
    } // NEW

    function getPersistedFullCardHeight(card) { // NEW
        const raw = getAttr(card, TASK_FULL_CARD_HEIGHT_ATTR); // NEW
        return raw == null || raw === '' ? null : normalizeTaskCardHeight(raw, DEFAULT_TASK_CARD_HEIGHT); // NEW
    } // NEW

    function persistFullCardHeight(card, height) { // NEW
        if (!card || isScheduleBreakCard(card)) return false; // NEW
        const normalized = normalizeTaskCardHeight(height, DEFAULT_TASK_CARD_HEIGHT); // NEW
        const next = normalized === DEFAULT_TASK_CARD_HEIGHT ? null : String(normalized); // NEW
        const current = getAttr(card, TASK_FULL_CARD_HEIGHT_ATTR); // NEW
        if ((current == null ? null : String(current)) === next) return false; // NEW
        setAttrNoUndo(card, TASK_FULL_CARD_HEIGHT_ATTR, next, true); // NEW
        return true; // NEW
    } // NEW

    function persistFullCardHeightFromGeometry(card) { // NEW
        const geo = card && model.getGeometry ? model.getGeometry(card) : (card && card.getGeometry ? card.getGeometry() : null); // NEW
        return geo ? persistFullCardHeight(card, geo.height) : false; // NEW
    } // NEW

    function setCardGeometryHeight(card, height) { // NEW
        const geo = card && model.getGeometry ? model.getGeometry(card) : (card && card.getGeometry ? card.getGeometry() : null); // NEW
        if (!geo) return false; // NEW
        const nextHeight = normalizeTaskCardHeight(height, DEFAULT_TASK_CARD_HEIGHT); // NEW
        if (roundedGeometryValue(geo.height) === nextHeight) return false; // NEW
        const nextGeo = geo.clone ? geo.clone() : new mxGeometry(geo.x || 0, geo.y || 0, geo.width || 160, geo.height || nextHeight); // NEW
        nextGeo.height = nextHeight; // NEW
        model.setGeometry(card, nextGeo); // NEW
        return true; // NEW
    } // NEW

    function getWeekScheduleHeightForCard(card) { // NEW
        const duration = schedulePolicy.snapScheduleMinutes(getAttr(card, TASK_SCHEDULE_DURATION_MINUTES_ATTR), null) // NEW
            || schedulePolicy.defaultScheduleDurationFromHours(getAttr(card, 'task_estimated_hours')) // NEW
            || 60; // NEW
        return schedulePolicy.scheduleMinutesToPx(duration); // NEW
    } // NEW

    function applyCardHeightForLaneTransition(card, sourceLaneKey, targetLaneKey) { // NEW
        if (!card || !isKanbanCard(card) || isScheduleBreakCard(card)) return false; // NEW
        const hasSourceLane = !!sourceLaneKey; // NEW
        const sourceIsWeek = isWeekDayLane(sourceLaneKey); // NEW
        const targetIsWeek = isWeekDayLane(targetLaneKey); // NEW
        let changed = false; // NEW
        if (hasSourceLane && !sourceIsWeek) changed = persistFullCardHeightFromGeometry(card) || changed; // NEW
        if (targetIsWeek) { // NEW
            return (!sourceIsWeek ? setCardGeometryHeight(card, getWeekScheduleHeightForCard(card)) : false) || changed; // NEW
        } // NEW
        if (sourceIsWeek) { // NEW
            return setCardGeometryHeight(card, getPersistedFullCardHeight(card) || DEFAULT_TASK_CARD_HEIGHT) || changed; // NEW
        } // NEW
        return changed; // NEW
    } // NEW

    function putInLane(card, lanes, laneKey, suppressRefresh) {
        const lane = lanes[laneKey];
        if (!lane) return false;
        const sourceParent = model.getParent(card); // NEW
        const sourceLaneKey = sourceParent ? getAttr(sourceParent, 'lane_key') : null; // NEW
        if (sourceParent === lane) {
            const heightChanged = applyCardHeightForLaneTransition(card, sourceLaneKey, laneKey); // NEW
            const styleChanged = applyStagedCardVisualStyle(card, laneKey); // NEW
            updateBadgeForLane(card, laneKey, suppressRefresh);
            return heightChanged || styleChanged; // CHANGE
        }
        applyCardHeightForLaneTransition(card, sourceLaneKey, laneKey); // NEW
        model.add(lane, card, model.getChildCount(lane));
        const status = getAttr(lane, 'status') || lane.value || '';
        setAttrNoUndo(card, 'status', status, true);
        applyStagedCardVisualStyle(card, laneKey); // NEW
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
        if (state === 'STAGED') return 'TODO_STAGED'; // CHANGE
        if (mode === 'WEEK') { // NEW
            if (state === 'DONE') return getWeekLaneKeyForDate(completedDay, selectedWeekStart) || 'DONE_WEEK'; // CHANGE
            return getWeekLaneKeyForDate(assignedDay, selectedWeekStart) || state; // NEW
        } // NEW
        return state; // CHANGE: legacy DAY normalizes before this point
    } // NEW

    function classifyCardForBoardView(card, board, laneKey) { // NEW
        const state = ensureWorkflowState(card, laneKey); // NEW
        const mode = getBoardViewMode(board); // NEW
        if (state !== 'DONE') clearCompletedForOpenState(card, state); // NEW
        if (mode === 'FULL') return classifyFullViewLane(card, state, laneKey); // NEW
        return classifyPlanningViewLane(card, state, mode, getSelectedDay(board), getSelectedWeekStart(board), laneKey); // NEW
    } // NEW


    // 3) Scan logic: skip auto-move for protected lanes; still refresh badges     
    function normalizeReflowLaneKeySet(opts) { // NEW: optional affected-lane filter for narrow badge/layout scopes
        const laneKeys = opts && opts.laneKeys; // NEW
        if (!Array.isArray(laneKeys) || laneKeys.length === 0) return null; // NEW
        return new Set(laneKeys.map(key => String(key || '')).filter(Boolean)); // NEW
    } // NEW

    function classifyBoardCards(board, lanes, dirtyLanes) { // NEW: classification and derived repair pass without board geometry/layout work
        bumpTaskReflowTestCounter('classification'); // NEW
        let boardDirty = false; // NEW
        const snapshots = snapshotBoardCardsByLane(lanes); // CHANGE: stable snapshot before mutation

        for (const snap of snapshots) { // NEW
            const sourceLaneKey = snap.laneKey; // NEW

            for (const c of snap.cards) { // NEW
                if (!c || !model.isVertex(c) || !isKanbanCard(c)) continue; // NEW

                const beforeParent = model.getParent(c); // NEW

                if (isYearHiddenCard(c)) { // NEW
                    if (enforceYearHiddenVisibility(c)) { // NEW
                        markDirtyLane(dirtyLanes, beforeParent); // NEW
                        boardDirty = true; // NEW
                    } // NEW
                    continue; // NEW
                } // NEW

                if (isScheduleBreakCard(c)) { // NEW
                    if (reconcileScheduleBreakOwnership(board, sourceLaneKey, c)) { // NEW
                        boardDirty = true; // NEW
                    } // NEW
                    markDirtyLane(dirtyLanes, beforeParent); // NEW
                    continue; // NEW
                } // NEW

                const targetLaneKey = classifyCardForBoardView(c, board, sourceLaneKey); // NEW
                if (putInLane(c, lanes, targetLaneKey, true)) { // CHANGE
                    markDirtyLane(dirtyLanes, beforeParent); // CHANGE
                    markDirtyCardLane(dirtyLanes, c); // NEW
                    boardDirty = true; // NEW
                    continue; // NEW
                } // NEW

                if (updateBadgeForLane(c, targetLaneKey, true)) { // CHANGE
                    markDirtyLane(dirtyLanes, beforeParent); // NEW
                    boardDirty = true; // NEW
                } // NEW
            } // NEW
        } // NEW

        if (rebuildRepeatVisibility(board, dirtyLanes)) { // NEW
            boardDirty = true; // NEW
        } // NEW

        return boardDirty; // NEW
    } // NEW

    function refreshBoardBadges(board, lanes, opts) { // NEW: badge-only pass that can be lane-scoped
        bumpTaskReflowTestCounter('badges'); // NEW
        const laneKeyFilter = normalizeReflowLaneKeySet(opts); // NEW
        let changed = false; // NEW
        const snapshots = snapshotBoardCardsByLane(lanes); // NEW
        snapshots.forEach(snap => { // NEW
            if (laneKeyFilter && !laneKeyFilter.has(snap.laneKey)) return; // NEW
            snap.cards.forEach(card => { // NEW
                if (!card || !model.isVertex(card) || !isRenderableKanbanCard(card)) return; // NEW
                changed = updateBadgeForLane(card, snap.laneKey, true) || changed; // NEW
            }); // NEW
        }); // NEW
        return changed; // NEW
    } // NEW

    function renderBoardLanes(board, lanes, dirtyLanes, sortContext, opts) { // NEW: lane sorting, schedule packing, paging, and optional board geometry
        bumpTaskReflowTestCounter('lanes'); // NEW
        const laneKeyFilter = normalizeReflowLaneKeySet(opts); // NEW
        const laneRenderOptions = Object.assign({}, opts || {}, sortContext || {}, { insideUpdate: true }); // NEW: preserve selected-period paging flags while keeping current sort context authoritative
        if (!opts || opts.applyLayout !== false) applyBoardViewLayout(board, lanes); // CHANGE: paging must measure the final lane height
        for (const { lane, laneKey } of dirtyLanes.values()) { // CHANGE
            if (laneKeyFilter && !laneKeyFilter.has(laneKey)) continue; // NEW
            resortAndPageLane(lane, laneKey, laneRenderOptions); // CHANGE
        } // CHANGE

        // Clean paging for untouched lanes without depending on child iteration order. // CHANGE
        for (const laneDef of LANES) { // CHANGE
            const laneKey = laneDef.key; // CHANGE
            if (laneKeyFilter && !laneKeyFilter.has(laneKey)) continue; // NEW
            const lane = lanes[laneKey]; // CHANGE
            if (!lane || dirtyLanes.has(lane.id)) continue; // CHANGE

            if (isWeekDayLane(laneKey)) { // NEW
                resortAndPageLane(lane, laneKey, laneRenderOptions); // CHANGE
                continue; // NEW
            } // NEW

            if (selectedPeriodStagedSortEnabled(laneKey, sortContext)) { // NEW
                resortAndPageLane(lane, laneKey, laneRenderOptions); // CHANGE
                continue; // NEW
            } // NEW

            const cards = getLaneCardsInOrder(lane); // CHANGE
            applyLanePaging(lane, laneKey, cards); // CHANGE
        } // CHANGE
        repairSelectionAfterAutomaticPaging(); // NEW: repair once after every lane has its final visibility
    } // NEW

    function reflowBoard(board, opts) { // NEW: scoped reflow orchestrator behind scanAndReflowBoard compatibility API
        if (!board) return;

        ensureBoardPlanningDefaults(board); // NEW
        const lanes = boardLanes(board);
        const sortContext = getBoardSortContext(board); // NEW
        const insideUpdate = opts && opts.insideUpdate;
        const scopePlan = normalizeTaskReflowScopePlan(opts && opts.scope); // NEW
        const dirtyLanes = new Map(); // CHANGE
        let boardDirty = false;

        if (!insideUpdate) model.beginUpdate();
        try {
            if (scopePlan.classification) boardDirty = classifyBoardCards(board, lanes, dirtyLanes) || boardDirty; // NEW
            if (scopePlan.layout) bumpTaskReflowTestCounter('layout'); // NEW
            if (scopePlan.lanes) renderBoardLanes(board, lanes, dirtyLanes, sortContext, Object.assign({ applyLayout: scopePlan.layout }, opts || {})); // NEW
            else if (scopePlan.layout) applyBoardViewLayout(board, lanes); // NEW
            if (scopePlan.badges) boardDirty = refreshBoardBadges(board, lanes, opts) || boardDirty; // NEW

            if (boardDirty) {
                graph.refresh(board);
            }
        } finally {
            if (!insideUpdate) model.endUpdate();
        }
    }

    function scanAndReflowBoard(board, opts) { // CHANGE: compatibility wrapper for existing command paths
        return reflowBoard(board, opts); // NEW
    } // CHANGE

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

    function initializeLanePagingFromModel() { // NEW: load-time cache reconstruction avoids trusting stale serialized visibility
        (function walk(cell) { // NEW
            if (!cell) return; // NEW
            if (isBoardCell(cell)) { // NEW
                const lanes = boardLanes(cell); // NEW
                Object.keys(lanes).forEach(laneKey => applyLanePaging(lanes[laneKey], laneKey, getLaneCardsInOrder(lanes[laneKey]), { skipSelectionRepair: true })); // NEW
                return; // NEW
            } // NEW
            for (let index = 0; index < model.getChildCount(cell); index++) walk(model.getChildAt(cell, index)); // NEW
        })(model.getRoot()); // NEW
        repairSelectionAfterAutomaticPaging(); // NEW
    } // NEW

    // -------------------- Kanban placement and group helpers -------------------- // CHANGE
    function isKanbanCard(cell) { return getAttr(cell, 'kanban_card') === '1'; }
    function isScheduleBreakCard(cell) { return getAttr(cell, TASK_SCHEDULE_BREAK_ATTR) === '1'; } // NEW
    function isWorkflowActionCard(cell) { return isKanbanCard(cell) && !isScheduleBreakCard(cell); } // NEW

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
        if (isScheduleBreakCard(card)) return null; // NEW
        const mode = getBoardViewMode(board); // NEW
        const weekStart = getSelectedWeekStart(board); // NEW
        const selectedDay = getSelectedDay(board); // NEW
        const ctx = { mode, selectedDay, selectedWeekStart: weekStart, today: todayISO() }; // NEW
        if (isWeekDayLane(laneKey)) { // NEW
            const dayWindow = getBoardWeekWorkHours(board)[getWeekDayIndexForLaneKey(laneKey)]; // NEW
            if (dayWindow && dayWindow.closed) return null; // NEW
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

    function scheduleCardVerticalMidpoint(card) { // NEW: drop insertion uses visual position, never derived time attributes
        const geo = card && model.getGeometry(card); // NEW
        const top = geo ? Number(geo.y) : 0; // NEW
        const height = geo ? Number(geo.height) : SCHEDULE_MIN_CARD_HEIGHT; // NEW
        return (Number.isFinite(top) ? top : 0) + ((Number.isFinite(height) ? height : SCHEDULE_MIN_CARD_HEIGHT) / 2); // NEW
    } // NEW

    function orderMovedScheduleCards(movedCards) { // NEW: preserve schedule order for a block dragged from one day lane
        const cards = Array.from(new Set((movedCards || []).filter(card => card && isKanbanCard(card)))); // NEW
        const sourceParents = Array.from(new Set(cards.map(card => model.getParent(card)).filter(Boolean))); // NEW
        if (sourceParents.length !== 1 || !isWeekDayLane(getAttr(sourceParents[0], 'lane_key'))) return cards; // NEW
        const sourceLane = sourceParents[0]; // NEW
        const sourceBoard = findBoardAncestor(sourceLane); // NEW
        const movedSet = new Set(cards); // NEW
        const ordered = getOrderedScheduleLaneCards(sourceBoard, sourceLane, getAttr(sourceLane, 'lane_key')).filter(card => movedSet.has(card)); // NEW
        cards.forEach(card => { if (ordered.indexOf(card) < 0) ordered.push(card); }); // NEW
        return ordered; // NEW
    } // NEW

    function resolveScheduleDropLane(movedCards, target, dy) { // NEW: distinguish user moves from resize and internal geometry updates
        if (target && isWeekDayLane(getAttr(target, 'lane_key'))) return target; // NEW
        if (target || !Number.isFinite(Number(dy)) || Number(dy) === 0) return null; // NEW
        const sourceParents = Array.from(new Set((movedCards || []).map(card => model.getParent(card)).filter(Boolean))); // NEW
        return sourceParents.length === 1 && isWeekDayLane(getAttr(sourceParents[0], 'lane_key')) ? sourceParents[0] : null; // NEW
    } // NEW

    function createScheduleDropContext(movedCards, target, dy) { // NEW: snapshot stable order before Draw.io mutates parents and geometry
        const targetLane = resolveScheduleDropLane(movedCards, target, dy); // NEW
        if (!targetLane) return null; // NEW
        const targetBoard = findBoardAncestor(targetLane); // NEW
        if (!targetBoard) return null; // NEW
        const movedOrder = orderMovedScheduleCards(movedCards); // NEW
        const allAlreadyInTarget = movedOrder.length > 0 && movedOrder.every(card => model.getParent(card) === targetLane); // NEW
        if (allAlreadyInTarget && Number(dy) === 0) return null; // NEW
        const sourceBoards = []; // NEW
        movedOrder.forEach(card => { // NEW
            const sourceLane = model.getParent(card); // NEW
            const sourceBoard = sourceLane && isWeekDayLane(getAttr(sourceLane, 'lane_key')) ? findBoardAncestor(sourceLane) : null; // NEW
            if (sourceBoard && sourceBoards.indexOf(sourceBoard) < 0) sourceBoards.push(sourceBoard); // NEW
        }); // NEW
        return { // NEW
            targetLane, // NEW
            targetBoard, // NEW
            targetLaneKey: getAttr(targetLane, 'lane_key'), // NEW
            targetOrderBefore: getOrderedScheduleLaneCards(targetBoard, targetLane, getAttr(targetLane, 'lane_key')), // NEW
            movedOrder, // NEW
            sourceBoards // NEW
        }; // NEW
    } // NEW

    function updateMovedBreakOwnership(context) { // NEW: cross-day break moves transfer the date while retaining duration
        if (!context) return; // NEW
        const destinationDay = getVisibleDateForWeekLane(context.targetBoard, context.targetLaneKey); // NEW
        context.movedOrder.forEach(card => { // NEW
            if (model.getParent(card) === context.targetLane && isScheduleBreakCard(card)) setAttrNoUndo(card, TASK_ASSIGNED_DAY_ATTR, destinationDay, true); // NEW
        }); // NEW
    } // NEW

    function commitScheduleDropOrder(context) { // NEW: turn free-position drop geometry into one canonical schedule sequence
        if (!context) return false; // NEW
        const movedCards = context.movedOrder.filter(card => model.getParent(card) === context.targetLane); // NEW
        if (!movedCards.length) return false; // NEW
        const movedSet = new Set(movedCards); // NEW
        const stationaryCards = context.targetOrderBefore.filter(card => !movedSet.has(card) && model.getParent(card) === context.targetLane); // NEW
        const blockTop = movedCards.reduce((value, card) => { // NEW
            const geo = model.getGeometry(card); // NEW
            const top = geo ? Number(geo.y) : 0; // NEW
            return Math.min(value, Number.isFinite(top) ? top : 0); // NEW
        }, Infinity); // NEW
        const blockBottom = movedCards.reduce((value, card) => { // NEW
            const geo = model.getGeometry(card); // NEW
            const top = geo ? Number(geo.y) : 0; // NEW
            const height = geo ? Number(geo.height) : SCHEDULE_MIN_CARD_HEIGHT; // NEW
            return Math.max(value, (Number.isFinite(top) ? top : 0) + (Number.isFinite(height) ? height : SCHEDULE_MIN_CARD_HEIGHT)); // NEW
        }, -Infinity); // NEW
        const blockMidpoint = (blockTop + blockBottom) / 2; // NEW
        let insertIndex = stationaryCards.findIndex(card => scheduleCardVerticalMidpoint(card) > blockMidpoint); // NEW
        if (insertIndex < 0) insertIndex = stationaryCards.length; // NEW
        const nextOrder = stationaryCards.slice(0, insertIndex).concat(movedCards, stationaryCards.slice(insertIndex)); // NEW
        const changed = syncScheduleLanePhysicalOrder(context.targetLane, nextOrder.map(cell => ({ cell }))); // NEW
        markScheduleLaneOrderDirty(context.targetLane); // NEW: force the next pack to persist physical order before reading stored order
        return changed; // NEW
    } // NEW

    function reflowScheduleDropBoards(context) { // NEW: close source gaps and pack the destination exactly once per board
        if (!context) return; // NEW
        const orderedBoards = context.sourceBoards.filter(board => board !== context.targetBoard); // NEW
        orderedBoards.push(context.targetBoard); // NEW
        orderedBoards.forEach(board => scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('drop') })); // NEW
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
            const movedCards = moved.filter(cell => cell && isKanbanCard(cell)); // NEW
            const moveCardKey = (card, index) => card && (card.id || (card.getId && card.getId())) || String(index); // NEW
            const sourceLaneKeys = new Map(movedCards.map((card, index) => [moveCardKey(card, index), laneKeyOfCard(card)])); // NEW
            if (target && moved.some(cell => !canPlaceKanbanChild(target, cell))) return moved; // NEW
            const targetLaneKey = target && getAttr(target, 'lane_key'); // NEW
            const scheduleDropContext = !clone ? createScheduleDropContext(movedCards, target, dy) : null; // NEW
            if ((!targetLaneKey && !scheduleDropContext) || clone) return originalMoveCells.apply(this, arguments); // CHANGE
            const targetBoard = scheduleDropContext ? scheduleDropContext.targetBoard : findBoardAncestor(target); // CHANGE
            if (!targetBoard || !movedCards.length) return originalMoveCells.apply(this, arguments); // NEW
            let result; // NEW
            model.beginUpdate(); // NEW
            try { // NEW
                result = originalMoveCells.apply(this, arguments); // NEW
                if (targetLaneKey) { // NEW
                    movedCards.forEach((card, index) => { // CHANGE
                        const patch = buildLaneDropWorkflowPatch(card, targetBoard, targetLaneKey); // NEW
                        if (patch && patch.attributes) applyCardPatchInsideUpdate(card, patch.attributes); // NEW
                        applyCardHeightForLaneTransition(card, sourceLaneKeys.get(moveCardKey(card, index)), targetLaneKey); // CHANGE
                    }); // NEW
                } // NEW
                if (scheduleDropContext) { // NEW
                    updateMovedBreakOwnership(scheduleDropContext); // NEW
                    commitScheduleDropOrder(scheduleDropContext); // NEW
                    reflowScheduleDropBoards(scheduleDropContext); // NEW
                } else { // NEW
                    scanAndReflowBoard(targetBoard, { insideUpdate: true, scope: getTaskReflowScopeForCommand('drop') }); // CHANGE
                } // NEW
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
    let pendingWeekLaneWidthChanges = new Map(); // NEW
    let pendingWeekLaneHourChanges = new Map(); // NEW
    let pendingFullLaneHeightChanges = new Map(); // NEW
    let pendingWeekBoardHeightChanges = new Map(); // NEW
    let repairTimer = null; // NEW
    const taskOverlayGestureElements = []; // NEW
    const taskOverlayGestureRefreshers = new Set(); // NEW
    let taskOverlayGestureActive = false; // NEW
    let taskOverlayGestureRefreshScheduled = false; // NEW
    const userResizedWeekDayLaneKeys = new Set(); // NEW: separates deliberate hour edits from automatic swimlane geometry changes

    function cancelPendingKanbanRepairs() { // NEW
        if (repairTimer != null && typeof clearTimeout === "function") clearTimeout(repairTimer); // NEW
        repairTimer = null; // NEW
        pendingRepairCards.clear(); // NEW
        pendingRepairBoards.clear(); // NEW
        pendingInvalidKanbanPlacements.clear(); // NEW
        pendingWeekLaneWidthChanges.clear(); // NEW
        pendingWeekLaneHourChanges.clear(); // NEW
        pendingFullLaneHeightChanges.clear(); // NEW
        pendingWeekBoardHeightChanges.clear(); // NEW
    } // NEW

    function userResizeLaneKey(cell, laneKey) { // NEW
        return String((cell && (cell.id || (cell.getId && cell.getId()))) || laneKey || ''); // NEW
    } // NEW

    function markUserResizedWeekDayLanes(cells) { // NEW
        (Array.isArray(cells) ? cells : []).forEach(cell => { // NEW
            const laneKey = getAttr(cell, 'lane_key'); // NEW
            if (!isWeekDayLane(laneKey)) return; // NEW
            const key = userResizeLaneKey(cell, laneKey); // NEW
            if (key) userResizedWeekDayLaneKeys.add(key); // NEW
        }); // NEW
    } // NEW

    function isUserResizedWeekDayLane(cell, laneKey) { // NEW
        return userResizedWeekDayLaneKeys.has(userResizeLaneKey(cell, laneKey)); // NEW
    } // NEW

    function installWeekDayLaneResizeOriginGuard() { // NEW
        if (graph.__trellisWeekDayLaneResizeOriginGuardInstalled) return; // NEW
        graph.__trellisWeekDayLaneResizeOriginGuardInstalled = true; // NEW
        if (typeof graph.resizeCells !== 'function') return; // NEW
        const originalResizeCells = graph.resizeCells; // NEW
        graph.resizeCells = function (cells) { // NEW
            markUserResizedWeekDayLanes(cells); // NEW
            try { // NEW
                return originalResizeCells.apply(this, arguments); // NEW
            } finally { // NEW
                setTimeout(function () { userResizedWeekDayLaneKeys.clear(); }, 0); // NEW
            } // NEW
        }; // NEW
    } // NEW

    function collectChangedKanbanCards(edit) {
        const out = new Set();
        const boards = new Set(); // NEW
        const invalidPlacements = new Map(); // NEW
        const laneWidthChanges = new Map(); // NEW
        const laneHourChanges = new Map(); // NEW
        const fullLaneHeightChanges = new Map(); // NEW
        const weekBoardHeightChanges = new Map(); // NEW
        if (isKanbanViewReflowing()) return { cards: out, boards, invalidPlacements, laneWidthChanges, laneHourChanges, fullLaneHeightChanges, weekBoardHeightChanges }; // CHANGE
        if (!edit || !edit.changes) return { cards: out, boards, invalidPlacements, laneWidthChanges, laneHourChanges, fullLaneHeightChanges, weekBoardHeightChanges }; // CHANGE

        for (const ch of edit.changes) {
            let cell = null;
            let previousParent = null; // NEW
            let currentParent = null; // NEW

            if (ch instanceof mxChildChange) {
                cell = ch.child;

                previousParent = ch.previous; // CHANGE
                currentParent = model.getParent(cell); // CHANGE
                const previousLaneKey = previousParent ? getAttr(previousParent, 'lane_key') : null; // NEW
                const currentLaneKey = currentParent ? getAttr(currentParent, 'lane_key') : null; // NEW

                if (cell && currentParent && shouldInspectKanbanPlacement(currentParent, cell) && !canPlaceKanbanChild(currentParent, cell)) { // NEW
                    invalidPlacements.set(cell.id || String(invalidPlacements.size), { cell, previousParent }); // NEW
                } // NEW

                if (previousParent === currentParent) { // CHANGE
                    if (currentParent && isWeekDayLane(getAttr(currentParent, 'lane_key'))) { // NEW
                        markScheduleLaneOrderDirty(currentParent); // NEW
                        const board = findBoardAncestor(currentParent); // NEW
                        if (board) boards.add(board); // NEW
                    } // NEW
                    continue; // CHANGE: skip same-lane reorder while retaining cross-board moves to equivalent lanes
                }
            } else if (ch instanceof mxValueChange) {
                cell = ch.cell;
            } else if (ch instanceof mxStyleChange) {
                cell = ch.cell;
            } else if (ch instanceof mxGeometryChange) {
                cell = ch.cell; // CHANGE: schedule card height edits commit duration
                currentParent = model.getParent(cell); // NEW
                if (isBoardCell(cell)) { // NEW
                    const geo = model.getGeometry(cell); // NEW
                    const previousHeight = roundedGeometryHeight(ch.previous); // NEW
                    const currentHeight = roundedGeometryHeight(geo); // NEW
                    const heightChanged = previousHeight == null || currentHeight == null || previousHeight !== currentHeight; // NEW
                    if (heightChanged && getBoardViewMode(cell) === 'FULL') { // NEW
                        fullLaneHeightChanges.set(cell.id || String(fullLaneHeightChanges.size), { board: cell, height: deriveFullLaneHeightFromBoardGeometry(cell) }); // NEW
                        boards.add(cell); // NEW
                    } // NEW
                    if (heightChanged && getBoardViewMode(cell) === 'WEEK') { // CHANGE
                        weekBoardHeightChanges.set(cell.id || String(weekBoardHeightChanges.size), { board: cell, height: deriveWeekBoardHeightFromBoardGeometry(cell) }); // NEW
                        boards.add(cell); // NEW
                    } // NEW
                    continue; // NEW
                } // NEW
                const changedLaneKey = getAttr(cell, 'lane_key'); // NEW
                if (changedLaneKey && currentParent && isBoardCell(currentParent) && !isWeekDayLane(changedLaneKey)) { // NEW
                    const geo = model.getGeometry(cell); // NEW
                    const previousWidth = roundedGeometryWidth(ch.previous); // NEW
                    const currentWidth = roundedGeometryWidth(geo); // NEW
                    const widthChanged = previousWidth == null || currentWidth == null || previousWidth !== currentWidth; // NEW
                    const previousHeight = roundedGeometryHeight(ch.previous); // NEW
                    const currentHeight = roundedGeometryHeight(geo); // NEW
                    const heightChanged = previousHeight == null || currentHeight == null || previousHeight !== currentHeight; // NEW
                    if (widthChanged && (!model.isVisible || model.isVisible(cell) !== false)) { // NEW
                        laneWidthChanges.set(cell.id || changedLaneKey, { board: currentParent, laneKey: changedLaneKey, width: currentWidth, nonDay: true }); // NEW
                    } // NEW
                    if (heightChanged && getBoardViewMode(currentParent) === 'FULL' && (!model.isVisible || model.isVisible(cell) !== false)) { // NEW
                        fullLaneHeightChanges.set(cell.id || changedLaneKey, { board: currentParent, height: normalizeFullLaneHeight(currentHeight, getBoardFullLaneHeight(currentParent)) }); // NEW
                    } // NEW
                    if (heightChanged || widthChanged) boards.add(currentParent); // CHANGE: week staged height remains board-owned; every non-day width reflows layout
                    continue; // NEW
                } // NEW
                if (isWeekDayLane(changedLaneKey) && currentParent && isBoardCell(currentParent)) { // NEW
                    const geo = model.getGeometry(cell); // NEW
                    const previousWidth = roundedGeometryWidth(ch.previous); // NEW
                    const currentWidth = roundedGeometryWidth(geo); // NEW
                    const widthChanged = previousWidth == null || currentWidth == null || previousWidth !== currentWidth; // NEW
                    const previousTop = ch.previous ? roundedGeometryValue(ch.previous.y) : null; // NEW
                    const currentTop = geo ? roundedGeometryValue(geo.y) : null; // NEW
                    const previousBottom = ch.previous ? roundedGeometryValue(ch.previous.y) + roundedGeometryValue(ch.previous.height) : null; // NEW
                    const currentBottom = geo ? roundedGeometryValue(geo.y) + roundedGeometryValue(geo.height) : null; // NEW
                    const hoursChanged = previousTop != null && currentTop != null && previousBottom != null && currentBottom != null && (previousTop !== currentTop || previousBottom !== currentBottom); // NEW
                    if (widthChanged) { // NEW
                        laneWidthChanges.set(cell.id || changedLaneKey, { board: currentParent, laneKey: changedLaneKey, width: geo ? geo.width : null }); // NEW
                        boards.add(currentParent); // NEW
                    } // NEW
                    if (hoursChanged && isUserResizedWeekDayLane(cell, changedLaneKey)) { // CHANGE
                        laneHourChanges.set(cell.id || changedLaneKey, { board: currentParent, laneKey: changedLaneKey, previousGeo: ch.previous, currentGeo: geo }); // NEW
                        boards.add(currentParent); // NEW
                    } // NEW
                    if (hoursChanged && !isUserResizedWeekDayLane(cell, changedLaneKey)) boards.add(currentParent); // NEW
                    continue; // NEW
                } // NEW
                const laneKey = currentParent ? getAttr(currentParent, 'lane_key') : null; // NEW
                if (!isWeekDayLane(laneKey)) { // CHANGE
                    const previousHeight = roundedGeometryHeight(ch.previous); // NEW
                    const currentHeight = roundedGeometryHeight(model.getGeometry(cell)); // NEW
                    const heightChanged = previousHeight == null || currentHeight == null || previousHeight !== currentHeight; // NEW
                    const currentBoard = findBoardAncestor(currentParent || cell); // NEW
                    if (heightChanged && currentBoard && getBoardViewMode(currentBoard) === 'FULL' && model.isVertex(cell) && isKanbanCard(cell) && !isScheduleBreakCard(cell)) { // NEW
                        out.add(cell); // NEW
                        boards.add(currentBoard); // NEW
                    } // NEW
                    continue; // CHANGE
                } // NEW
            }

            if (!cell || !model.isVertex(cell) || !isKanbanCard(cell)) continue;

            const previousBoard = previousParent ? findBoardAncestor(previousParent) : null; // NEW
            const currentBoard = findBoardAncestor(currentParent || cell); // NEW
            if (previousBoard) boards.add(previousBoard); // NEW
            if (currentBoard) boards.add(currentBoard); // NEW
            if (isYearHiddenCard(cell)) continue; // CHANGE: rescan its board without applying lane-status repair
            out.add(cell); // CHANGE
        }

        return { cards: out, boards, invalidPlacements, laneWidthChanges, laneHourChanges, fullLaneHeightChanges, weekBoardHeightChanges }; // CHANGE
    }

    function scheduleKanbanRepair(cards, boards, invalidPlacements, laneWidthChanges, laneHourChanges, fullLaneHeightChanges, weekBoardHeightChanges) { // CHANGE
        if (isTrellisHistoryRestoring()) return; // NEW
        const hasCards = cards && cards.size > 0; // NEW
        const hasBoards = boards && boards.size > 0; // NEW
        const hasInvalidPlacements = invalidPlacements && invalidPlacements.size > 0; // NEW
        const hasLaneWidthChanges = laneWidthChanges && laneWidthChanges.size > 0; // NEW
        const hasLaneHourChanges = laneHourChanges && laneHourChanges.size > 0; // NEW
        const hasFullLaneHeightChanges = fullLaneHeightChanges && fullLaneHeightChanges.size > 0; // NEW
        const hasWeekBoardHeightChanges = weekBoardHeightChanges && weekBoardHeightChanges.size > 0; // NEW
        if (!hasCards && !hasBoards && !hasInvalidPlacements && !hasLaneWidthChanges && !hasLaneHourChanges && !hasFullLaneHeightChanges && !hasWeekBoardHeightChanges) return; // CHANGE

        if (hasCards) cards.forEach(card => pendingRepairCards.add(card)); // CHANGE
        if (hasBoards) boards.forEach(board => pendingRepairBoards.add(board)); // NEW
        if (hasInvalidPlacements) invalidPlacements.forEach((entry, key) => pendingInvalidKanbanPlacements.set(key, entry)); // NEW
        if (hasLaneWidthChanges) laneWidthChanges.forEach((entry, key) => pendingWeekLaneWidthChanges.set(key, entry)); // NEW
        if (hasLaneHourChanges) laneHourChanges.forEach((entry, key) => pendingWeekLaneHourChanges.set(key, entry)); // NEW
        if (hasFullLaneHeightChanges) fullLaneHeightChanges.forEach((entry, key) => pendingFullLaneHeightChanges.set(key, entry)); // NEW
        if (hasWeekBoardHeightChanges) weekBoardHeightChanges.forEach((entry, key) => pendingWeekBoardHeightChanges.set(key, entry)); // NEW

        if (repairTimer != null) return;

        repairTimer = setTimeout(function () {
            repairTimer = null;
            if (isTrellisHistoryRestoring()) { cancelPendingKanbanRepairs(); return; } // NEW

            const cardsToRepair = Array.from(pendingRepairCards);
            const boardsToRepair = Array.from(pendingRepairBoards); // NEW
            const invalidPlacementsToRepair = Array.from(pendingInvalidKanbanPlacements.values()); // NEW
            const laneWidthChangesToRepair = Array.from(pendingWeekLaneWidthChanges.values()); // NEW
            const laneHourChangesToRepair = Array.from(pendingWeekLaneHourChanges.values()); // NEW
            const fullLaneHeightChangesToRepair = Array.from(pendingFullLaneHeightChanges.values()); // NEW
            const weekBoardHeightChangesToRepair = Array.from(pendingWeekBoardHeightChanges.values()); // NEW
            pendingRepairCards.clear();
            pendingRepairBoards.clear(); // NEW
            pendingInvalidKanbanPlacements.clear(); // NEW
            pendingWeekLaneWidthChanges.clear(); // NEW
            pendingWeekLaneHourChanges.clear(); // NEW
            pendingFullLaneHeightChanges.clear(); // NEW
            pendingWeekBoardHeightChanges.clear(); // NEW

            repairChangedCards(cardsToRepair, boardsToRepair, invalidPlacementsToRepair, laneWidthChangesToRepair, laneHourChangesToRepair, fullLaneHeightChangesToRepair, weekBoardHeightChangesToRepair); // CHANGE
        }, 0);
    }

    function repairChangedCards(cards, boards, invalidPlacements, laneWidthChanges, laneHourChanges, fullLaneHeightChanges, weekBoardHeightChanges) { // CHANGE
        if ((!cards || cards.length === 0) && (!boards || boards.length === 0) && (!invalidPlacements || invalidPlacements.length === 0) && (!laneWidthChanges || laneWidthChanges.length === 0) && (!laneHourChanges || laneHourChanges.length === 0) && (!fullLaneHeightChanges || fullLaneHeightChanges.length === 0) && (!weekBoardHeightChanges || weekBoardHeightChanges.length === 0)) return; // CHANGE
        if (isTrellisHistoryRestoring()) return; // NEW

        const affectedBoards = new Map(); // NEW
        const touchedGroups = new Set();
        (boards || []).forEach(board => { // NEW
            if (board && board.id) affectedBoards.set(board.id, board); // NEW
        }); // NEW

        model.beginUpdate();
        try {
            repairInvalidKanbanPlacements(invalidPlacements, affectedBoards); // NEW

            (laneWidthChanges || []).forEach(entry => { // NEW
                if (!entry || !entry.board) return; // NEW
                const changed = entry.nonDay ? persistNonDayLaneWidth(entry.board, entry.laneKey, entry.width) : persistWeekDayLaneWidth(entry.board, entry.laneKey, entry.width); // CHANGE
                if (changed) affectedBoards.set(entry.board.id || entry.laneKey, entry.board); // CHANGE
            }); // NEW

            (laneHourChanges || []).forEach(entry => { // NEW
                if (!entry || !entry.board) return; // NEW
                if (persistWeekDayLaneHourResize(entry.board, entry.laneKey, entry.previousGeo, entry.currentGeo)) affectedBoards.set(entry.board.id || entry.laneKey, entry.board); // NEW
            }); // NEW

            (fullLaneHeightChanges || []).forEach(entry => { // NEW
                if (!entry || !entry.board) return; // NEW
                if (persistFullLaneHeight(entry.board, entry.height)) affectedBoards.set(entry.board.id || String(entry.height), entry.board); // NEW
            }); // NEW

            (weekBoardHeightChanges || []).forEach(entry => { // NEW
                if (!entry || !entry.board) return; // NEW
                if (persistWeekBoardHeight(entry.board, entry.height)) affectedBoards.set(entry.board.id || String(entry.height), entry.board); // NEW
            }); // NEW

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
                applyCardHeightForLaneTransition(cell, laneKey, laneKey); // NEW
                applyStagedCardVisualStyle(cell, laneKey); // NEW
                updateBadgeForLane(cell, laneKey, true); // CHANGE

                getLinkedCellsOf(cell).filter(isTilerGroup).forEach(g => touchedGroups.add(g.id)); // NEW
            }

            const hasFullLaneHeightRepair = !!(fullLaneHeightChanges && fullLaneHeightChanges.length); // NEW
            const hasWeekBoardHeightRepair = !!(weekBoardHeightChanges && weekBoardHeightChanges.length); // NEW
            const hasCardRepair = !!((cards && cards.length) || (invalidPlacements && invalidPlacements.length)); // NEW
            const scope = hasCardRepair ? getTaskReflowScopeForCommand('workflow') : ((hasFullLaneHeightRepair || hasWeekBoardHeightRepair) ? getTaskReflowScopeForCommand('boardResize') : getTaskReflowScopeForCommand('dayLaneResize')); // CHANGE
            affectedBoards.forEach(board => scanAndReflowBoard(board, { insideUpdate: true, scope })); // CHANGE: lane rendering now always measures after requested layout

            touchedGroups.forEach(id => {
                const group = model.getCell(id);
                if (!group) return;
                updateGroupRenderState(group, { insideUpdate: true }); // CHANGE
            });

        } finally {
            model.endUpdate();
        }
    }

    installWeekDayLaneResizeOriginGuard(); // NEW

    model.addListener(mxEvent.CHANGE, function (_sender, evt) {
        const edit = evt.getProperty('edit');
        const changes = collectChangedKanbanCards(edit); // CHANGE
        scheduleKanbanRepair(changes.cards, changes.boards, changes.invalidPlacements, changes.laneWidthChanges, changes.laneHourChanges, changes.fullLaneHeightChanges, changes.weekBoardHeightChanges); // CHANGE: defer mutation out of CHANGE event
    });

    graph.addListener(mxEvent.CELLS_REMOVED || 'cellsRemoved', function (_sender, evt) { // NEW: deleted role identities cannot remain assigned
        const deletedRoleIds = new Set(); // NEW
        function collectRemoved(cell) { // NEW
            if (!cell) return; // NEW
            if (isRoleCard(cell)) deletedRoleIds.add(String(cell.id || (cell.getId && cell.getId()) || '')); // NEW
            const children = cell.children || []; // NEW: removed subtrees are no longer reachable from the model root
            for (let i = 0; i < children.length; i++) collectRemoved(children[i]); // NEW
        } // NEW
        (evt.getProperty('cells') || []).forEach(collectRemoved); // NEW
        if (!deletedRoleIds.size) return; // NEW
        const affected = []; // NEW
        (function walk(cell) { // NEW
            if (!cell) return; // NEW
            if (model.isVertex(cell) && isKanbanCard(cell)) { // NEW
                const current = getTaskAssigneeRoleIds(cell); // NEW
                const next = current.filter(id => !deletedRoleIds.has(id)); // NEW
                if (next.length !== current.length) affected.push({ card: cell, ids: next }); // NEW
            } // NEW
            const count = model.getChildCount(cell); // NEW
            for (let i = 0; i < count; i++) walk(model.getChildAt(cell, i)); // NEW
        })(model.getRoot()); // NEW
        if (!affected.length) return; // NEW
        model.beginUpdate(); // NEW: nested in the removal event so deletion and cleanup undo together
        try { affected.forEach(entry => model.setValue(entry.card, cloneCardValueWithAttributes(entry.card, { [TASK_ASSIGNEE_ROLE_IDS_ATTR]: serializeTaskAssigneeRoleIds(entry.ids) }))); } // NEW
        finally { model.endUpdate(); } // NEW
    }); // NEW


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



    // -------------------- Board discovery and dialogs -------------------- // CHANGE
    graph.getSelectionModel().addListener(mxEvent.CHANGE, function () {
        const sel = graph.getSelectionCell();
        if (!sel || !model.isVertex(sel)) return;
        const key = getAttr(sel, 'board_key');
        if (key === BOARD_KEY || key === 'MAIN_KANBAN_BOARD') {
            taskCommands.scanAndReflowBoard(sel, { scope: getTaskReflowScopeForCommand('boardNavigation') }); // CHANGE
            return; // NEW
        }
        const board = findBoardAncestor(sel); // NEW
        const selectedDayLane = board && weekDayLaneAncestorForCell(sel, board); // NEW
        let stagedRefreshCommand = 'selection'; // NEW
        if (board && selectedDayLane && getBoardViewMode(board) === 'WEEK') { // NEW
            const day = getDateForWeekLaneKey(getAttr(selectedDayLane, 'lane_key'), getSelectedWeekStart(board)); // NEW
            if (day && day !== getSelectedDay(board)) { taskCommands.setBoardPlanningView(board, 'WEEK', { [TASK_SELECTED_DAY_ATTR]: day }); stagedRefreshCommand = 'selectedPeriodStagedPaging'; } // CHANGE: selected-period changes need staged lane paging parity
        } // NEW
        taskCommands.scanAndReflowBoard(board, { scope: getTaskReflowScopeForCommand(stagedRefreshCommand), laneKeys: ['TODO_STAGED'], resetSelectedPeriodStagedPage: stagedRefreshCommand === 'selectedPeriodStagedPaging' }); // CHANGE
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

    // -------------------- Dialog commands -------------------- // NEW
    function showEditCardDialogImpl(card) { // CHANGE: notes are editable on every Kanban card
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

            if (!taskCommands.commitCardPatch(card, attributes, { reflow: dateChanged })) { // CHANGE
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

        taskDialogs.showTaskManagerDialog(div, 420, datesEditableAtOpen ? 310 : 230, true, true); // CHANGE
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
            scanAndReflowBoard(context.board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('workflow') }); // CHANGE
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
                scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('boardNavigation') }); // CHANGE
            } finally { // NEW
                model.endUpdate(); // NEW
            } // NEW
        }); // NEW
        return true; // NEW
    } // NEW

    function selectedScheduleLaneForBoard(board) { // NEW
        return selectedWeekDayLaneForBoard(board); // NEW
    } // NEW

    function createBreakCard(parentLane) { // NEW
        const board = findBoardAncestor(parentLane); // NEW
        const laneKey = getAttr(parentLane, 'lane_key'); // NEW
        const assignedDay = board ? getVisibleDateForWeekLane(board, laneKey) : null; // NEW
        const card = createVertex('', 0, 0, 160, scheduleMinutesToPx(30), BREAK_CARD_STYLE); // NEW
        model.add(parentLane, card, model.getChildCount(parentLane)); // NEW
        setAttrNoUndo(card, 'kanban_card', '1', true); // NEW
        setAttrNoUndo(card, TASK_SCHEDULE_BREAK_ATTR, '1', true); // NEW
        if (assignedDay) setAttrNoUndo(card, TASK_ASSIGNED_DAY_ATTR, assignedDay, true); // NEW
        setAttrNoUndo(card, TASK_SCHEDULE_DURATION_MINUTES_ATTR, '30', true); // NEW
        setAttrNoUndo(card, 'title', 'Break', true); // NEW
        setAttrNoUndo(card, 'status', getAttr(parentLane, 'status') || parentLane.value || '', true); // NEW
        refreshCardLabel(card, true); // NEW
        return card; // NEW
    } // NEW

    function addBreakToSelectedDay(board) { // NEW
        const lane = selectedScheduleLaneForBoard(board); // NEW
        if (!board || !lane) return false; // NEW
        const laneKey = getAttr(lane, 'lane_key'); // NEW
        const dayWindow = isWeekDayLane(laneKey) ? getBoardWeekWorkHours(board)[getWeekDayIndexForLaneKey(laneKey)] : null; // NEW
        if (dayWindow && dayWindow.closed) return false; // NEW
        model.beginUpdate(); // NEW
        try { // NEW
            createBreakCard(lane); // NEW
            scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('editHours') }); // CHANGE
        } finally { // NEW
            model.endUpdate(); // NEW
        } // NEW
        return true; // NEW
    } // NEW

    function saveSelectedWeekDayWorkHours(board, dayIndex, dayWindow) { // NEW
        if (!board || dayIndex < 0 || dayIndex >= WEEK_DAY_LANE_KEYS.length) return false; // NEW
        return taskTransactions.runModelUpdate({}, function () { // NEW
            const changed = persistSelectedWeekDayWorkWindow(board, dayIndex, dayWindow); // NEW
            if (changed) scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('editHours') }); // NEW
            return changed; // NEW
        }); // NEW
    } // NEW

    function openSelectedWeekDayFromDefaults(board, laneKey) { // NEW
        if (!board || !isWeekDayLane(laneKey)) return false; // NEW
        const dayIndex = getWeekDayIndexForLaneKey(laneKey); // NEW
        const editState = getBoardWeekWorkHourEditState(board); // NEW
        const dayWindow = normalizeWorkHourWindow(editState.week[dayIndex]); // NEW
        return saveSelectedWeekDayWorkHours(board, dayIndex, Object.assign({}, dayWindow, { closed: false })); // CHANGE
    } // NEW

    function closeSelectedWeekDay(board, lane) { // NEW
        if (!board || !lane || selectedWeekDayHasVisibleCards(lane)) return false; // NEW
        const laneKey = getAttr(lane, 'lane_key'); // NEW
        if (!isWeekDayLane(laneKey)) return false; // NEW
        const dayIndex = getWeekDayIndexForLaneKey(laneKey); // NEW
        const editState = getBoardWeekWorkHourEditState(board); // NEW
        const dayWindow = normalizeWorkHourWindow(editState.week[dayIndex]); // NEW
        return saveSelectedWeekDayWorkHours(board, dayIndex, Object.assign({}, dayWindow, { closed: true })); // CHANGE
    } // NEW

    function elevateTaskManagerDialogImpl() { // CHANGE
        const dlg = ui && ui.dialog; // NEW
        if (dlg && dlg.bg && dlg.bg.style) dlg.bg.style.zIndex = String(TRELLIS_DIALOG_Z - 1); // NEW
        if (dlg && dlg.container && dlg.container.style) dlg.container.style.zIndex = String(TRELLIS_DIALOG_Z); // NEW
    } // NEW

    function showTaskManagerDialogImpl(node, width, height, modal, closable) { // CHANGE
        ui.showDialog(node, width, height, modal, closable); // NEW
        elevateTaskManagerDialogImpl(); // CHANGE
    } // NEW

    function formatMinuteTimeInput(minutes) { // NEW
        const safe = Math.max(0, Math.min(1440, Number(minutes) || 0)); // NEW
        const hh = String(Math.floor(safe / 60)).padStart(2, '0'); // NEW
        const mm = String(safe % 60).padStart(2, '0'); // NEW
        return `${hh}:${mm}`; // NEW
    } // NEW

    function parseMinuteTimeInput(value, fallback) { // NEW
        const match = String(value || '').match(/^(\d{2}):(\d{2})$/); // NEW
        if (!match) return fallback; // NEW
        const h = Number(match[1]); // NEW
        const m = Number(match[2]); // NEW
        if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return fallback; // NEW
        return snapScheduleMinutes((h * 60) + m, fallback); // NEW
    } // NEW

    function showEditHoursDialogImpl(board) { // CHANGE
        if (!board) return; // NEW
        const weekStart = getSelectedWeekStart(board); // NEW
        const defaults = normalizeWeekWorkHours(parseJsonObject(getAttr(board, TASK_WORK_HOURS_DEFAULTS_ATTR))); // NEW
        const overridesRoot = parseJsonObject(getAttr(board, TASK_WORK_HOURS_WEEK_OVERRIDES_ATTR)) || { schemaVersion: 1, weeks: {} }; // NEW
        const weeks = overridesRoot.weeks && typeof overridesRoot.weeks === 'object' ? overridesRoot.weeks : {}; // NEW
        const weekOverrides = normalizeWeekWorkHours(weeks[weekStart], defaults); // NEW
        const div = document.createElement('div'); // NEW
        div.className = 'trellis-task-hours-dialog'; // NEW
        div.style.cssText = 'padding:12px;box-sizing:border-box;font:12px Arial,sans-serif;'; // NEW
        const title = document.createElement('div'); // NEW
        title.textContent = 'Edit Hours'; // NEW
        title.style.cssText = 'font-size:16px;font-weight:bold;margin-bottom:10px;'; // NEW
        div.appendChild(title); // NEW
        const rows = []; // NEW
        const rowGridCss = 'display:grid;grid-template-columns:110px 78px minmax(136px,1fr) minmax(136px,1fr);gap:8px;align-items:center;'; // NEW
        function styleTimeInput(input) { // NEW
            input.style.cssText = 'width:100%;min-width:136px;box-sizing:border-box;font:12px Arial,sans-serif;'; // NEW
        } // NEW
        function updateClosedRowState(row, closed, start, end) { // NEW
            const isClosed = !!closed.checked; // NEW
            start.disabled = isClosed; // NEW
            end.disabled = isClosed; // NEW
            row.style.opacity = isClosed ? '0.72' : '1'; // NEW
        } // NEW
        function addHeaderRow() { // NEW
            const header = document.createElement('div'); // NEW
            header.style.cssText = rowGridCss + 'font-weight:bold;color:#374151;margin:0 0 5px;border-bottom:1px solid #d1d5db;padding-bottom:4px;'; // NEW
            ['Day', 'Closed', 'Start', 'End'].forEach(text => { // NEW
                const cell = document.createElement('div'); // NEW
                cell.textContent = text; // NEW
                header.appendChild(cell); // NEW
            }); // NEW
            div.appendChild(header); // NEW
        } // NEW
        function addSection(labelText, sourceDays, kind) { // NEW
            const label = document.createElement('div'); // NEW
            label.textContent = labelText; // NEW
            label.style.cssText = 'font-weight:bold;margin:12px 0 6px;'; // CHANGE
            div.appendChild(label); // NEW
            addHeaderRow(); // NEW
            sourceDays.forEach((day, index) => { // NEW
                const row = document.createElement('div'); // NEW
                row.style.cssText = rowGridCss + 'margin-bottom:5px;'; // CHANGE
                const name = document.createElement('span'); // NEW
                name.textContent = KANBAN_LANE_DEFS[5 + index].label; // NEW
                const closed = document.createElement('input'); // NEW
                closed.type = 'checkbox'; // NEW
                closed.checked = !!day.closed; // NEW
                const start = document.createElement('input'); // NEW
                start.type = 'time'; // NEW
                start.step = String(SCHEDULE_MINUTE_SNAP * 60); // NEW
                start.value = formatMinuteTimeInput(day.startMinute); // NEW
                styleTimeInput(start); // NEW
                const end = document.createElement('input'); // NEW
                end.type = 'time'; // NEW
                end.step = String(SCHEDULE_MINUTE_SNAP * 60); // NEW
                end.value = formatMinuteTimeInput(day.endMinute); // NEW
                styleTimeInput(end); // NEW
                closed.addEventListener('change', function () { updateClosedRowState(row, closed, start, end); }); // NEW
                updateClosedRowState(row, closed, start, end); // NEW
                row.appendChild(name); // NEW
                row.appendChild(closed); // NEW
                row.appendChild(start); // NEW
                row.appendChild(end); // NEW
                div.appendChild(row); // NEW
                rows.push({ kind, index, closed, start, end, fallback: day }); // NEW
            }); // NEW
        } // NEW
        addSection('Board defaults', defaults, 'default'); // NEW
        addSection('Selected week', weekOverrides, 'week'); // NEW
        const buttons = document.createElement('div'); // NEW
        buttons.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px;'; // NEW
        const cancel = mxUtils.button('Cancel', function () { ui.hideDialog(); }); // NEW
        const save = mxUtils.button('Save', function () { // NEW
            const nextDefaults = defaults.slice(); // NEW
            const nextWeek = weekOverrides.slice(); // NEW
            rows.forEach(row => { // NEW
                const startMinute = parseMinuteTimeInput(row.start.value, row.fallback.startMinute); // NEW
                const endMinute = parseMinuteTimeInput(row.end.value, row.fallback.endMinute); // NEW
                const target = row.kind === 'default' ? nextDefaults : nextWeek; // NEW
                target[row.index] = normalizeWorkHourWindow({ closed: row.closed.checked, startMinute, endMinute }); // NEW
            }); // NEW
            taskCommands.saveBoardWeekWorkHours(board, weekStart, weeks, nextDefaults, nextWeek); // CHANGE
            ui.hideDialog(); // NEW
        }); // NEW
        buttons.appendChild(cancel); // NEW
        buttons.appendChild(save); // NEW
        div.appendChild(buttons); // NEW
        taskDialogs.showTaskManagerDialog(div, 660, 600, true, true); // CHANGE
    } // NEW

    function showEditDayHoursDialogImpl(board, laneKey) { // NEW
        if (!board || !isWeekDayLane(laneKey)) return; // NEW
        const dayIndex = getWeekDayIndexForLaneKey(laneKey); // NEW
        const editState = getBoardWeekWorkHourEditState(board); // NEW
        const day = normalizeWorkHourWindow(editState.week[dayIndex]); // NEW
        const div = document.createElement('div'); // NEW
        div.className = 'trellis-task-day-hours-dialog'; // NEW
        div.style.cssText = 'padding:12px;box-sizing:border-box;font:12px Arial,sans-serif;'; // NEW
        const title = document.createElement('div'); // NEW
        title.textContent = 'Change Hours - ' + KANBAN_LANE_DEFS[5 + dayIndex].label; // NEW
        title.style.cssText = 'font-size:16px;font-weight:bold;margin-bottom:10px;'; // NEW
        div.appendChild(title); // NEW
        const row = document.createElement('div'); // NEW
        row.style.cssText = 'display:grid;grid-template-columns:80px minmax(130px,1fr);gap:8px;align-items:center;margin-bottom:8px;'; // NEW
        const closedLabel = document.createElement('label'); // NEW
        closedLabel.textContent = 'Closed'; // NEW
        const closed = document.createElement('input'); // NEW
        closed.type = 'checkbox'; // NEW
        closed.checked = !!day.closed; // NEW
        row.appendChild(closedLabel); // NEW
        row.appendChild(closed); // NEW
        const startLabel = document.createElement('label'); // NEW
        startLabel.textContent = 'Start'; // NEW
        const start = document.createElement('input'); // NEW
        start.type = 'time'; // NEW
        start.step = String(SCHEDULE_MINUTE_SNAP * 60); // NEW
        start.value = formatMinuteTimeInput(day.startMinute); // NEW
        const endLabel = document.createElement('label'); // NEW
        endLabel.textContent = 'End'; // NEW
        const end = document.createElement('input'); // NEW
        end.type = 'time'; // NEW
        end.step = String(SCHEDULE_MINUTE_SNAP * 60); // NEW
        end.value = formatMinuteTimeInput(day.endMinute); // NEW
        [start, end].forEach(input => { input.style.cssText = 'width:100%;min-width:130px;box-sizing:border-box;font:12px Arial,sans-serif;'; }); // NEW
        row.appendChild(startLabel); // NEW
        row.appendChild(start); // NEW
        row.appendChild(endLabel); // NEW
        row.appendChild(end); // NEW
        function updateClosedState() { // NEW
            start.disabled = !!closed.checked; // NEW
            end.disabled = !!closed.checked; // NEW
            row.style.opacity = closed.checked ? '0.72' : '1'; // NEW
        } // NEW
        closed.addEventListener('change', updateClosedState); // NEW
        updateClosedState(); // NEW
        div.appendChild(row); // NEW
        const buttons = document.createElement('div'); // NEW
        buttons.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px;'; // NEW
        const cancel = mxUtils.button('Cancel', function () { ui.hideDialog(); }); // NEW
        const save = mxUtils.button('Save', function () { // NEW
            const startMinute = parseMinuteTimeInput(start.value, day.startMinute); // NEW
            const endMinute = parseMinuteTimeInput(end.value, day.endMinute); // NEW
            taskCommands.saveSelectedWeekDayWorkHours(board, dayIndex, normalizeWorkHourWindow({ closed: closed.checked, startMinute, endMinute })); // NEW
            ui.hideDialog(); // NEW
        }); // NEW
        buttons.appendChild(cancel); // NEW
        buttons.appendChild(save); // NEW
        div.appendChild(buttons); // NEW
        taskDialogs.showTaskManagerDialog(div, 360, 210, true, true); // NEW
    } // NEW

    function saveBoardWeekWorkHours(board, weekStart, weeks, nextDefaults, nextWeek) { // CHANGE
        if (!board || !parseTaskCalendarISO(weekStart)) return false; // CHANGE
        return taskTransactions.runModelUpdate({}, function () { // CHANGE
            setAttrNoUndo(board, TASK_WORK_HOURS_DEFAULTS_ATTR, serializeWeekWorkHours(nextDefaults), true); // CHANGE
            const nextWeeks = weeks && typeof weeks === 'object' ? weeks : {}; // CHANGE
            nextWeeks[weekStart] = { schemaVersion: 1, days: normalizeWeekWorkHours(nextWeek) }; // CHANGE
            setAttrNoUndo(board, TASK_WORK_HOURS_WEEK_OVERRIDES_ATTR, JSON.stringify({ schemaVersion: 1, weeks: nextWeeks }), true); // CHANGE
            scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('editHours') }); // CHANGE
            return true; // CHANGE
        }); // CHANGE
    } // CHANGE

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
            if (changed) scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('workflow') }); // CHANGE
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
            if (changed) scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('workflow') }); // CHANGE
        } finally { // NEW
            model.endUpdate(); // NEW
        } // NEW
        return changed; // NEW
    } // NEW

    function applyCardWorkflowAction(card, action) { // NEW
        return applyCardWorkflowActions([card], action) > 0; // CHANGE
    } // NEW

    function buildCardWorkflowContext(board) { // NEW
        return { // NEW
            mode: getBoardViewMode(board), // NEW
            selectedDay: getSelectedDay(board), // NEW
            selectedWeekStart: getSelectedWeekStart(board), // NEW
            today: todayISO() // NEW
        }; // NEW
    } // NEW

    function uniqueKanbanCards(cells) { // NEW
        const out = []; // NEW
        const seen = new Set(); // NEW
        for (const cell of (cells || [])) { // NEW
            const id = cell && (cell.id || (cell.getId && cell.getId())); // NEW
            if (!id || seen.has(id) || !model.isVertex(cell) || !isWorkflowActionCard(cell)) continue; // CHANGE
            seen.add(id); // NEW
            out.push(cell); // NEW
        } // NEW
        return out; // NEW
    } // NEW

    function selectedKanbanCards() { // NEW
        return uniqueKanbanCards(getSelectionCellsList()); // NEW
    } // NEW

    function getAssignmentSelectionContext(cards) { // NEW
        const selected = uniqueKanbanCards(cards); // NEW
        const raw = getSelectionCellsList(); // NEW
        if (!selected.length || raw.length !== selected.length || selected.some(isScheduleBreakCard)) return null; // NEW
        const board = findBoardAncestor(selected[0]); // NEW
        if (!board || getBoardViewMode(board) !== 'WEEK' || selected.some(card => findBoardAncestor(card) !== board)) return null; // NEW
        return { board, cards: selected, roster: getBoardRoleRoster(board) }; // NEW
    } // NEW

    function applyTaskAssignmentSets(cards, nextIdsByCard) { // NEW: one undoable transaction for single or bulk assignment
        const context = getAssignmentSelectionContext(cards); // NEW
        if (!context || !nextIdsByCard || typeof nextIdsByCard.get !== 'function') return 0; // NEW
        const changes = context.cards.map(card => ({ card, serialized: serializeTaskAssigneeRoleIds(nextIdsByCard.get(card)) })) // NEW
            .filter(entry => entry.serialized !== serializeTaskAssigneeRoleIds(getTaskAssigneeRoleIds(entry.card))); // NEW
        if (!changes.length) return 0; // NEW: a no-op draft creates no undo transaction
        return runTrellisHistoryTransaction({ category: "Assignments", action: "assign", origin: "Garden_Task_Manager", title: "Update task assignments", affectedCellIds: historyCellIds(changes.map(entry => entry.card)) }, function () { // NEW
            model.beginUpdate(); // NEW
            try { // NEW
                changes.forEach(entry => model.setValue(entry.card, cloneCardValueWithAttributes(entry.card, { [TASK_ASSIGNEE_ROLE_IDS_ATTR]: entry.serialized }))); // NEW
            } finally { // NEW
                model.endUpdate(); // NEW
            } // NEW
            return changes.length; // NEW
        }); // NEW
    } // NEW

    function applyCardWorkflowActions(cards, action) { // NEW
        const selected = uniqueKanbanCards(cards); // NEW
        const affectedBoards = new Map(); // NEW
        let changedCount = 0; // NEW
        if (!selected.length) return 0; // NEW
        model.beginUpdate(); // NEW
        try { // NEW
            selected.forEach(card => { // NEW
                const board = findBoardAncestor(card); // NEW
                if (!board) return; // NEW
                const patch = buildWorkflowPatch(card.value, action, buildCardWorkflowContext(board)); // NEW
                if (!patch || !patch.attributes) return; // NEW
                if (applyCardPatchInsideUpdate(card, patch.attributes)) { // NEW
                    changedCount += 1; // NEW
                    affectedBoards.set(board.id || board.getId && board.getId() || changedCount, board); // NEW
                } // NEW
            }); // NEW
            affectedBoards.forEach(board => scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('workflow') })); // CHANGE
        } finally { // NEW
            model.endUpdate(); // NEW
        } // NEW
        return changedCount; // NEW
    } // NEW

    function selectionIsOnlyStagedWorkflowCards(cards) { // NEW
        const raw = getSelectionCellsList(); // NEW
        if (!cards || !cards.length || raw.length !== cards.length) return false; // NEW
        return cards.every(card => laneKeyOfCard(card) === 'TODO_STAGED'); // NEW
    } // NEW

    function selectionIsOnlyWeekDayLaneCards(cards) { // NEW
        const raw = getSelectionCellsList(); // NEW
        if (!cards || !cards.length || raw.length !== cards.length) return false; // NEW
        return cards.every(card => isWeekDayLane(laneKeyOfCard(card))); // NEW
    } // NEW

    function applyStagedStartDateAllocation(cards) { // NEW
        const selected = uniqueKanbanCards(cards).filter(card => laneKeyOfCard(card) === 'TODO_STAGED'); // NEW
        const affectedBoards = new Map(); // NEW
        let changedCount = 0; // NEW
        if (!selected.length) return 0; // NEW
        model.beginUpdate(); // NEW
        try { // NEW
            selected.forEach(card => { // NEW
                const board = findBoardAncestor(card); // NEW
                if (!board) return; // NEW
                const patch = buildStagedStartDateAllocationPatch(card.value, buildCardWorkflowContext(board)); // NEW
                if (!patch || !patch.attributes) return; // NEW
                if (applyCardPatchInsideUpdate(card, patch.attributes)) { // NEW
                    changedCount += 1; // NEW
                    affectedBoards.set(board.id || board.getId && board.getId() || changedCount, board); // NEW
                } // NEW
            }); // NEW
            affectedBoards.forEach(board => scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('workflow') })); // CHANGE
        } finally { // NEW
            model.endUpdate(); // NEW
        } // NEW
        return changedCount; // NEW
    } // NEW

    function applyBulkCardEdit(cards, opts) { // NEW
        const selected = uniqueKanbanCards(cards); // NEW
        const options = opts || {}; // NEW
        const affectedBoards = new Map(); // NEW
        const result = { changed: 0, noteChanged: 0, dateChanged: 0, dateSkipped: 0 }; // NEW
        if (!selected.length || (!options.replaceNote && !options.setStartDate)) return result; // NEW
        model.beginUpdate(); // NEW
        try { // NEW
            selected.forEach(card => { // NEW
                const attributes = {}; // NEW
                let dateChangedForCard = false; // NEW
                if (options.replaceNote) { // NEW
                    const notePatch = buildCardNotePatch(card.value, options.note); // NEW
                    if (notePatch && notePatch.changed) { // NEW
                        Object.assign(attributes, notePatch.attributes); // NEW
                        result.noteChanged += 1; // NEW
                    } // NEW
                } // NEW
                if (options.setStartDate) { // NEW
                    if (!canEditCardDates(card)) { // NEW
                        result.dateSkipped += 1; // NEW
                    } else { // NEW
                        const datePatch = buildCardDateOverridePatch(card.value, options.startDate); // NEW
                        if (datePatch && datePatch.changed !== false && datePatch.attributes) { // NEW
                            Object.assign(attributes, datePatch.attributes); // NEW
                            dateChangedForCard = true; // NEW
                            result.dateChanged += 1; // NEW
                        } // NEW
                    } // NEW
                } // NEW
                if (Object.keys(attributes).length === 0) return; // NEW
                if (applyCardPatchInsideUpdate(card, attributes)) { // NEW
                    result.changed += 1; // NEW
                    if (!dateChangedForCard) updateBadgeForLane(card, laneKeyOfCard(card), true); // NEW
                    if (dateChangedForCard) { // NEW
                        const board = findBoardAncestor(card); // NEW
                        if (board) affectedBoards.set(board.id || board.getId && board.getId() || result.changed, board); // NEW
                    } // NEW
                } // NEW
            }); // NEW
            affectedBoards.forEach(board => scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('dateEdit') })); // CHANGE
        } finally { // NEW
            model.endUpdate(); // NEW
        } // NEW
        return result; // NEW
    } // NEW

    function resetCardDatesForCards(cards) { // NEW
        const selected = uniqueKanbanCards(cards); // NEW
        const affectedBoards = new Map(); // NEW
        let changedCount = 0; // NEW
        if (!selected.length) return 0; // NEW
        model.beginUpdate(); // NEW
        try { // NEW
            selected.forEach(card => { // NEW
                if (!hasCardDateOverride(card)) return; // NEW
                const patch = buildCardDateResetPatch(card.value); // NEW
                if (!patch) return; // NEW
                if (applyCardPatchInsideUpdate(card, patch)) { // NEW
                    changedCount += 1; // NEW
                    const board = findBoardAncestor(card); // NEW
                    if (board) affectedBoards.set(board.id || board.getId && board.getId() || changedCount, board); // NEW
                } // NEW
            }); // NEW
            affectedBoards.forEach(board => scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('dateEdit') })); // CHANGE
        } finally { // NEW
            model.endUpdate(); // NEW
        } // NEW
        return changedCount; // NEW
    } // NEW

    function createTaskCommandRuntime({ boardLayout, transactions }) { // CHANGE: command seam for UI, events, and menu entrypoints
        function replaceTasks(targetGroupId, tasks) { // CHANGE
            return replaceTasksPreservingAssignments(targetGroupId, tasks); // CHANGE
        } // CHANGE

        function ensureBoardTemplateInUpdate(containerVertex) { // CHANGE
            return transactions.runModelUpdate({}, function () { // CHANGE
                return boardLayout.ensureBoardTemplateIn(containerVertex, { insideUpdate: true }); // CHANGE
            }); // CHANGE
        } // CHANGE

        return Object.freeze({ // CHANGE
            runModelUpdate: transactions.runModelUpdate, // CHANGE
            createTasks, // CHANGE
            removeTasksLinkedOnlyTo, // CHANGE
            replaceTasks, // CHANGE
            applyDifferentialTaskSync, // CHANGE
            commitCardPatch, // CHANGE
            applyCardDateOverride, // CHANGE
            resetCardDates, // CHANGE
            resetCardDatesForCards, // CHANGE
            setCardNote, // CHANGE
            clearCardNote, // CHANGE
            setRepeatSeriesExpanded, // CHANGE
            setBoardPlanningView, // CHANGE
            saveBoardWeekWorkHours, // CHANGE
            saveSelectedWeekDayWorkHours, // NEW
            openSelectedWeekDayFromDefaults, // NEW
            closeSelectedWeekDay, // NEW
            endDay, // CHANGE
            endWeek, // CHANGE
            addBreakToSelectedDay, // CHANGE
            applyCardWorkflowAction, // CHANGE
            applyCardWorkflowActions, // CHANGE
            applyStagedStartDateAllocation, // CHANGE
            applyBulkCardEdit, // CHANGE
            scanAndReflowBoard, // CHANGE
            scanAllBoards, // CHANGE
            ensureBoardTemplateIn: boardLayout.ensureBoardTemplateIn, // CHANGE
            ensureBoardTemplateInUpdate // CHANGE
        }); // CHANGE
    }

    const taskCommands = createTaskCommandRuntime({ // CHANGE
        graph, // CHANGE
        model, // CHANGE
        adapters: taskRuntimeAdapters, // CHANGE
        boardLayout: boardLayoutService, // CHANGE
        taskPolicy, // CHANGE
        schedulePolicy, // CHANGE
        transactions: taskTransactions // CHANGE
    }); // CHANGE

    // -------------------- DOM overlay host and installers -------------------- // NEW
    function ensureTaskControlOverlayHost() { // NEW
        const pane = graph.view && graph.view.overlayPane ? graph.view.overlayPane : null; // NEW
        const paneIsSvg = !!(pane && pane.namespaceURI === 'http://www.w3.org/2000/svg'); // NEW
        const baseHost = pane && !paneIsSvg ? pane : (graph.container || pane || null); // CHANGE
        if (!baseHost) return null; // CHANGE
        const style = window.getComputedStyle ? window.getComputedStyle(baseHost) : null; // CHANGE
        if (style && style.position === 'static') baseHost.style.position = 'relative'; // CHANGE
        let host = baseHost; // NEW
        if (document && document.createElement && baseHost.namespaceURI !== 'http://www.w3.org/2000/svg') { // NEW
            host = graph.__trellisTaskControlLayer && graph.__trellisTaskControlLayer.parentNode === baseHost ? graph.__trellisTaskControlLayer : null; // NEW
            if (!host) { // NEW
                host = document.createElement('div'); // NEW
                host.className = 'trellis-task-control-layer'; // NEW
                host.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:' + GRAPH_OVERLAY_Z.CONTROL + ';'; // NEW
                baseHost.appendChild(host); // NEW
                graph.__trellisTaskControlLayer = host; // NEW
            } // NEW
        } // NEW
        return host; // CHANGE
    } // NEW

    function getSelectionCellsList() { // NEW
        if (graph.getSelectionCells) return graph.getSelectionCells() || []; // NEW
        const cell = graph.getSelectionCell && graph.getSelectionCell(); // NEW
        return cell ? [cell] : []; // NEW
    } // NEW

    function isBoardCell(cell) { // NEW
        return !!(cell && model.isVertex(cell) && (getAttr(cell, 'board_key') === BOARD_KEY || getAttr(cell, 'board_key') === LEGACY_KANBAN_BOARD_KEY)); // NEW
    } // NEW

    function getStateHostBounds(cell, state, host) { // NEW
        if (!state) return null; // NEW
        const shapeNode = state.shape && state.shape.node ? state.shape.node : null; // NEW
        if (shapeNode && shapeNode.getBoundingClientRect && host && host.getBoundingClientRect) { // NEW
            const rect = shapeNode.getBoundingClientRect(); // NEW
            const hostRect = host.getBoundingClientRect(); // NEW
            if (rect && hostRect && rect.width > 0 && rect.height > 0) { // NEW
                return { x: rect.left - hostRect.left + (host.scrollLeft || 0), y: rect.top - hostRect.top + (host.scrollTop || 0), width: rect.width, height: rect.height, source: 'domRect' }; // NEW
            } // NEW
        } // NEW
        return { x: Number(state.x) || 0, y: Number(state.y) || 0, width: Number(state.width) || 0, height: Number(state.height) || 0, source: 'mxCellState' }; // NEW
    } // NEW

    function getCellVisualBounds(cell, host) { // NEW
        const state = graph.view && graph.view.getState ? graph.view.getState(cell) : null; // NEW
        const stateBounds = getStateHostBounds(cell, state, host); // NEW
        if (stateBounds) return stateBounds; // NEW
        let cur = cell; // NEW
        let x = 0; // NEW
        let y = 0; // NEW
        let width = 0; // NEW
        let height = 0; // NEW
        while (cur) { // NEW
            const geo = model.getGeometry ? model.getGeometry(cur) : (cur.getGeometry ? cur.getGeometry() : null); // NEW
            if (geo) { // NEW
                x += Number(geo.x) || 0; // NEW
                y += Number(geo.y) || 0; // NEW
                if (cur === cell) { width = Number(geo.width) || 0; height = Number(geo.height) || 0; } // NEW
            } // NEW
            cur = model.getParent ? model.getParent(cur) : null; // NEW
        } // NEW
        return width > 0 || height > 0 ? { x, y, width, height, source: 'geometry' } : null; // NEW
    } // NEW

    function getCellStateBounds(cells, host) { // CHANGE
        let bounds = null; // NEW
        for (const cell of (cells || [])) { // NEW
            const state = graph.view && graph.view.getState ? graph.view.getState(cell) : null; // NEW
            const hostBounds = getStateHostBounds(cell, state, host); // NEW
            if (!hostBounds) continue; // CHANGE
            const x = Number(hostBounds.x) || 0; // CHANGE
            const y = Number(hostBounds.y) || 0; // CHANGE
            const width = Number(hostBounds.width) || 0; // CHANGE
            const height = Number(hostBounds.height) || 0; // CHANGE
            if (!bounds) { // NEW
                bounds = { x, y, right: x + width, bottom: y + height }; // NEW
            } else { // NEW
                bounds.x = Math.min(bounds.x, x); // NEW
                bounds.y = Math.min(bounds.y, y); // NEW
                bounds.right = Math.max(bounds.right, x + width); // NEW
                bounds.bottom = Math.max(bounds.bottom, y + height); // NEW
            } // NEW
        } // NEW
        return bounds ? { x: bounds.x, y: bounds.y, width: bounds.right - bounds.x, height: bounds.bottom - bounds.y } : null; // CHANGE
    } // NEW

    function positionDomOverlayFromBounds(element, bounds, below, above, extraY) { // CHANGE
        if (!element || !bounds || !element.parentNode) return false; // CHANGE
        const left = bounds.x; // CHANGE
        const topBase = bounds.y; // CHANGE
        const yOffset = Number.isFinite(Number(extraY)) ? Number(extraY) : 0; // NEW
        element.style.left = Math.max(0, Math.round(left)) + 'px'; // NEW
        if (below) element.style.top = Math.max(0, Math.round(topBase + bounds.height + 6 + yOffset)) + 'px'; // CHANGE
        else if (above) element.style.top = Math.max(0, Math.round(topBase - element.offsetHeight - 6 - yOffset)) + 'px'; // CHANGE
        else element.style.top = Math.max(0, Math.round(topBase + yOffset)) + 'px'; // CHANGE
        return true; // NEW
    } // NEW

    function positionDomOverlayFromCellState(element, cell, below, above, extraY) { // CHANGE
        const state = graph.view && graph.view.getState ? graph.view.getState(cell) : null; // NEW
        const hostBounds = getStateHostBounds(cell, state, element && element.parentNode); // NEW
        return positionDomOverlayFromBounds(element, hostBounds, below, above, extraY); // CHANGE
    } // NEW

    function registerTaskOverlayGestureElement(element) { // NEW
        if (!element || taskOverlayGestureElements.indexOf(element) >= 0) return; // NEW
        taskOverlayGestureElements.push(element); // NEW
    } // NEW

    function unregisterTaskOverlayGestureElement(element) { // NEW
        const index = taskOverlayGestureElements.indexOf(element); // NEW
        if (index >= 0) taskOverlayGestureElements.splice(index, 1); // NEW
    } // NEW

    function hideTaskOverlayGestureElements() { // NEW
        taskOverlayGestureElements.forEach(element => { if (element && element.style) element.style.display = 'none'; }); // NEW
    } // NEW

    function isTaskOverlayGestureCell(cell) { // NEW
        return !!(cell && model.isVertex(cell) && isKanbanCard(cell)); // CHANGE: preserve existing non-card overlay behavior while card drags hide the pager
    } // NEW

    function selectedOrTargetHasTaskCell(targetCell) { // CHANGE
        if (isTaskOverlayGestureCell(targetCell)) return true; // CHANGE
        return getSelectionCellsList().some(isTaskOverlayGestureCell); // CHANGE
    } // NEW

    function taskOverlayMouseEventCell(me) { // NEW
        if (me && typeof me.getCell === 'function') return me.getCell(); // NEW
        return null; // NEW
    } // NEW

    function scheduleTaskOverlayGestureRefresh() { // NEW
        if (taskOverlayGestureRefreshScheduled) return; // NEW
        taskOverlayGestureRefreshScheduled = true; // NEW
        setTimeout(function () { // NEW
            taskOverlayGestureRefreshScheduled = false; // NEW
            Array.from(taskOverlayGestureRefreshers).forEach(refresh => refresh()); // NEW
        }, 0); // NEW
    } // NEW

    function beginTaskOverlayGesture() { // NEW
        if (taskOverlayGestureActive) return; // NEW
        taskOverlayGestureActive = true; // NEW
        hideTaskOverlayGestureElements(); // NEW
    } // NEW

    function endTaskOverlayGesture() { // NEW
        if (!taskOverlayGestureActive) return; // NEW
        taskOverlayGestureActive = false; // NEW
        scheduleTaskOverlayGestureRefresh(); // NEW
    } // NEW

    function installTaskOverlayGestureGate() { // NEW
        if (graph.__trellisTaskOverlayGestureGateInstalled) return; // NEW
        graph.__trellisTaskOverlayGestureGateInstalled = true; // NEW
        if (graph.addMouseListener) { // NEW
            graph.addMouseListener({ // NEW
                mouseDown(_sender, me) { if (selectedOrTargetHasTaskCell(taskOverlayMouseEventCell(me))) beginTaskOverlayGesture(); }, // CHANGE
                mouseMove() {}, // NEW
                mouseUp() { endTaskOverlayGesture(); } // NEW
            }); // NEW
        } // NEW
        if (graph.addListener) { // NEW
            graph.addListener(mxEvent.CELLS_MOVED || 'cellsMoved', endTaskOverlayGesture); // NEW
            graph.addListener(mxEvent.CELLS_RESIZED || 'cellsResized', endTaskOverlayGesture); // NEW
        } // NEW
        if (graph.panningHandler && graph.panningHandler.addListener) { // NEW
            graph.panningHandler.addListener(mxEvent.PAN_START || 'panStart', beginTaskOverlayGesture); // NEW
            graph.panningHandler.addListener(mxEvent.PAN_END || 'panEnd', endTaskOverlayGesture); // NEW
        } // NEW
        const mouseUpTarget = window && window.addEventListener ? window : (document && document.addEventListener ? document : null); // NEW
        if (mouseUpTarget) mouseUpTarget.addEventListener('mouseup', endTaskOverlayGesture, true); // NEW
    } // NEW

    function createDeferredTaskOverlayRefresh(refresh) { // CHANGE
        let pending = false; // NEW
        if (refresh) taskOverlayGestureRefreshers.add(refresh); // NEW
        return function requestRefresh() { // CHANGE
            if (taskOverlayGestureActive) { // NEW
                hideTaskOverlayGestureElements(); // NEW
                return; // NEW
            } // NEW
            if (pending) return; // CHANGE
            pending = true; // NEW
            setTimeout(function () { // NEW
                pending = false; // NEW
                if (taskOverlayGestureActive) { hideTaskOverlayGestureElements(); return; } // NEW
                refresh(); // NEW
            }, 0); // NEW
        }; // NEW
    } // NEW

    function addGraphViewRefreshListener(refresh) { // NEW
        if (!refresh) return; // NEW
        if (graph.view && graph.view.addListener) { // NEW
            graph.view.addListener(mxEvent.SCALE, refresh); // CHANGE
            graph.view.addListener(mxEvent.TRANSLATE, refresh); // CHANGE
            graph.view.addListener(mxEvent.SCALE_AND_TRANSLATE, refresh); // CHANGE
            graph.view.addListener(mxEvent.REPAINT, refresh); // CHANGE
        } // NEW
        if (model.addListener) model.addListener(mxEvent.CHANGE, refresh); // CHANGE
        if (graph.container && graph.container.addEventListener) graph.container.addEventListener('scroll', refresh, { passive: true }); // CHANGE
    } // NEW

    function setPagingSelectionCells(cells) { // NEW
        const next = (cells || []).filter(Boolean); // NEW
        if (!next.length) return; // NEW
        taskPagingSelectionGuard = true; // NEW
        try { // NEW
            if (next.length > 1 && graph.setSelectionCells) graph.setSelectionCells(next); // NEW
            else if (graph.setSelectionCell) graph.setSelectionCell(next[0]); // NEW
        } finally { taskPagingSelectionGuard = false; } // NEW
    } // NEW

    function selectedTaskBoard() { // NEW
        const boards = new Set(); // NEW
        getSelectionCellsList().forEach(cell => { // NEW
            const board = isBoardCell(cell) ? cell : findBoardAncestor(cell); // NEW
            if (board) boards.add(board); // NEW
        }); // NEW
        return boards.size === 1 ? Array.from(boards)[0] : null; // NEW
    } // NEW

    function selectedRenderableTaskCards() { // NEW
        return getSelectionCellsList().filter(cell => cell && model.isVertex(cell) && isRenderableKanbanCard(cell)); // NEW
    } // NEW

    function isCellModelVisible(cell) { // NEW
        return !model.isVisible || model.isVisible(cell) !== false; // NEW
    } // NEW

    function repairSelectionAfterAutomaticPaging() { // NEW: automatic reflow never moves pages merely to retain selection
        if (taskPagingSelectionGuard) return; // NEW
        const selectedCards = selectedRenderableTaskCards(); // NEW
        if (!selectedCards.some(card => !isCellModelVisible(card))) return; // NEW
        const boards = new Set(selectedCards.map(findBoardAncestor).filter(Boolean)); // NEW
        if (boards.size !== 1) return; // NEW: cross-board selection remains untouched
        const lanes = new Set(selectedCards.map(card => model.getParent(card)).filter(Boolean)); // NEW
        if (lanes.size > 1) setPagingSelectionCell(Array.from(boards)[0]); // NEW
        else if (lanes.size === 1) setPagingSelectionCell(Array.from(lanes)[0]); // NEW
    } // NEW

    function revealExternallySelectedPage() { // NEW: user selection is authoritative and may reveal one hidden lane page
        if (taskPagingSelectionGuard) return; // NEW
        const selectedCards = selectedRenderableTaskCards(); // NEW
        if (!selectedCards.some(card => !isCellModelVisible(card))) return; // NEW
        const boards = new Set(selectedCards.map(findBoardAncestor).filter(Boolean)); // NEW
        if (boards.size !== 1) return; // NEW: do not rewrite cross-board selection
        const lanes = new Set(selectedCards.map(card => model.getParent(card)).filter(Boolean)); // NEW
        if (lanes.size !== 1) { setPagingSelectionCell(Array.from(boards)[0]); return; } // NEW
        const lane = Array.from(lanes)[0]; // NEW
        const laneKey = getAttr(lane, 'lane_key'); // NEW
        const firstSelectedCard = selectedCards[0]; // NEW
        applyLanePaging(lane, laneKey, getLaneCardsInOrder(lane), { anchorCardId: taskCellId(firstSelectedCard), skipSelectionRepair: true }); // NEW
        setPagingSelectionCells(selectedCards.filter(isCellModelVisible)); // NEW: hidden siblings outside the revealed page are dropped
    } // NEW

    graph.__trellisTaskPagingApi = { // NEW
        revealCard(card) { // NEW
            if (!card || !isRenderableKanbanCard(card)) return false; // NEW
            if (isCellModelVisible(card)) return true; // NEW
            const lane = model.getParent(card); // NEW
            if (!lane) return false; // NEW
            const laneKey = getAttr(lane, 'lane_key'); // NEW
            applyLanePaging(lane, laneKey, getLaneCardsInOrder(lane), { anchorCardId: taskCellId(card), skipSelectionRepair: true }); // NEW
            requestLanePagerOverlayRefresh(); // NEW
            return isCellModelVisible(card); // NEW
        } // NEW
    }; // NEW

    function installLanePagerStyles() { // NEW
        const styleId = 'trellis-task-lane-pager-styles'; // NEW
        if (!document || !document.createElement || document.getElementById(styleId)) return; // NEW
        const style = document.createElement('style'); // NEW
        style.id = styleId; // NEW
        style.textContent = [ // NEW
            '.trellis-task-lane-pager{position:absolute;display:flex;align-items:center;justify-content:center;gap:6px;pointer-events:auto;z-index:' + GRAPH_OVERLAY_Z.CONTROL_TOP + ';font:12px Arial,sans-serif;white-space:nowrap}', // NEW
            '.trellis-task-lane-pager__button{box-sizing:border-box;width:28px;height:28px;min-width:28px;border:1px solid #D1D5DB;border-radius:999px;padding:0;display:inline-flex;align-items:center;justify-content:center;background:#FFF;color:#2563EB;box-shadow:0 1px 2px rgba(0,0,0,.12);cursor:pointer}', // NEW
            '.trellis-task-lane-pager__button:hover:not(:disabled){background:#EFF6FF;border-color:#93C5FD}', // NEW
            '.trellis-task-lane-pager__button:focus-visible,.trellis-task-lane-pager__select:focus-visible{outline:2px solid #2563EB;outline-offset:2px}', // NEW
            '.trellis-task-lane-pager__button:disabled{opacity:.38;cursor:default}', // NEW
            '.trellis-task-lane-pager__select{box-sizing:border-box;height:28px;max-width:100px;border:1px solid #D1D5DB;border-radius:4px;padding:0 22px 0 7px;background:#FFF;color:#111;font:12px Arial,sans-serif;cursor:pointer}' // NEW
        ].join(''); // NEW
        (document.head || document.body || document.documentElement).appendChild(style); // NEW
    } // NEW

    function createLanePagerChevron(direction) { // NEW
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); // NEW
        svg.setAttribute('viewBox', '0 0 20 20'); // NEW
        svg.setAttribute('width', '16'); // NEW
        svg.setAttribute('height', '16'); // NEW
        svg.setAttribute('aria-hidden', 'true'); // NEW
        svg.setAttribute('focusable', 'false'); // NEW
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); // NEW
        path.setAttribute('d', direction < 0 ? 'M12.5 4.5 7 10l5.5 5.5' : 'M7.5 4.5 13 10l-5.5 5.5'); // NEW
        path.setAttribute('fill', 'none'); // NEW
        path.setAttribute('stroke', 'currentColor'); // NEW
        path.setAttribute('stroke-width', '2.25'); // NEW
        path.setAttribute('stroke-linecap', 'round'); // NEW
        path.setAttribute('stroke-linejoin', 'round'); // NEW
        svg.appendChild(path); // NEW
        return svg; // NEW
    } // NEW

    function stopDomPropagation(evt) { // NEW: native selects must keep their default opening behavior
        if (evt && evt.stopPropagation) evt.stopPropagation(); // NEW
    } // NEW

    function createLanePagerNode(host, lane, laneKey) { // NEW
        const element = document.createElement('div'); // NEW
        element.className = 'trellis-task-lane-pager'; // NEW
        element.setAttribute('data-lane-id', taskCellId(lane)); // NEW: stable key supports retained-node inspection and diagnostics
        element.setAttribute('data-lane-key', String(laneKey || '')); // NEW
        const previous = document.createElement('button'); // NEW
        previous.type = 'button'; // NEW
        previous.className = 'trellis-task-lane-pager__button trellis-task-lane-pager__previous'; // NEW
        previous.title = 'Previous page'; // NEW
        previous.setAttribute('aria-label', 'Previous page'); // NEW
        previous.appendChild(createLanePagerChevron(-1)); // NEW
        const selector = document.createElement('select'); // NEW
        selector.className = 'trellis-task-lane-pager__select'; // NEW
        const next = document.createElement('button'); // NEW
        next.type = 'button'; // NEW
        next.className = 'trellis-task-lane-pager__button trellis-task-lane-pager__next'; // NEW
        next.title = 'Next page'; // NEW
        next.setAttribute('aria-label', 'Next page'); // NEW
        next.appendChild(createLanePagerChevron(1)); // NEW
        [previous, selector, next].forEach(control => { // NEW
            control.addEventListener('mousedown', stopDomPropagation); // NEW
            control.addEventListener('mouseup', stopDomPropagation); // NEW
        }); // NEW
        previous.addEventListener('click', function (evt) { consumeDomEvent(evt); changeLanePage(lane, laneKey, -1); }); // NEW
        next.addEventListener('click', function (evt) { consumeDomEvent(evt); changeLanePage(lane, laneKey, 1); }); // NEW
        selector.addEventListener('change', function (evt) { stopDomPropagation(evt); navigateLaneToPage(lane, laneKey, Number(selector.value)); }); // NEW
        element.appendChild(previous); // NEW
        element.appendChild(selector); // NEW
        element.appendChild(next); // NEW
        host.appendChild(element); // NEW
        registerTaskOverlayGestureElement(element); // NEW
        return { element, previous, selector, next, lane, laneKey, pageCount: 0 }; // NEW
    } // NEW

    function updateLanePagerOptions(node, state) { // NEW
        if (node.pageCount !== state.plan.pages.length) { // NEW
            node.selector.innerHTML = ''; // NEW
            state.plan.pages.forEach((_page, index) => { // NEW
                const option = document.createElement('option'); // NEW
                option.value = String(index); // NEW
                option.textContent = String(index + 1); // CHANGE: dropdown choices show only page numbers
                node.selector.appendChild(option); // NEW
            }); // NEW
            node.pageCount = state.plan.pages.length; // NEW
        } // NEW
        node.selector.value = String(state.pageIndex); // NEW
        node.selector.setAttribute('aria-label', `${getAttr(state.lane, 'status') || 'Lane'} page, ${state.pageIndex + 1} of ${state.plan.pages.length}`); // NEW
        node.previous.disabled = state.pageIndex <= 0; // NEW
        node.next.disabled = state.pageIndex >= state.plan.pages.length - 1; // NEW
    } // NEW

    function positionLanePager(node, state, host) { // NEW
        const bounds = getCellVisualBounds(state.lane, host); // NEW
        const geo = state.lane && (state.lane.getGeometry ? state.lane.getGeometry() : state.lane.geometry); // NEW
        if (!bounds || !geo || bounds.width <= 0 || bounds.height <= 0) return false; // NEW
        const effectiveScale = Math.min(bounds.width / Math.max(1, Number(geo.width) || bounds.width), bounds.height / Math.max(1, Number(geo.height) || bounds.height)); // NEW
        const measured = node.element.getBoundingClientRect ? node.element.getBoundingClientRect() : null; // NEW
        const pagerWidth = Math.max(1, Math.round(Number(node.element.offsetWidth) || (measured && measured.width) || 168)); // NEW
        const pagerHeight = Math.max(1, Math.round(Number(node.element.offsetHeight) || (measured && measured.height) || 28)); // NEW
        const fitScale = Math.max(0.001, Math.min(1, Math.max(0, (bounds.width - 8) / pagerWidth), Math.max(0, (bounds.height - 4) / pagerHeight))); // CHANGE: low zoom scales the retained controls instead of hiding them
        const scaledWidth = pagerWidth * fitScale; // NEW
        const scaledHeight = pagerHeight * fitScale; // NEW
        const minLeft = bounds.x + (scaledWidth / 2) + 2; // NEW
        const maxLeft = bounds.x + bounds.width - (scaledWidth / 2) - 2; // NEW
        const idealLeft = bounds.x + (bounds.width / 2); // NEW
        const minTop = bounds.y + 2; // NEW
        const maxTop = bounds.y + bounds.height - scaledHeight - 2; // NEW
        const idealTop = bounds.y + (TASK_LANE_HEADER_HEIGHT * effectiveScale) + 4; // NEW
        node.element.style.left = Math.round(maxLeft >= minLeft ? Math.max(minLeft, Math.min(maxLeft, idealLeft)) : idealLeft) + 'px'; // CHANGE
        node.element.style.top = Math.round(maxTop >= minTop ? Math.max(minTop, Math.min(maxTop, idealTop)) : bounds.y + 2) + 'px'; // CHANGE
        node.element.style.transformOrigin = 'top center'; // NEW
        node.element.style.transform = 'translateX(-50%) scale(' + fitScale.toFixed(3) + ')'; // CHANGE
        return true; // NEW
    } // NEW

    function installLanePagerOverlay() { // NEW
        if (graph.__trellisTaskLanePagerInstalled || !document || !document.createElement) return; // NEW
        graph.__trellisTaskLanePagerInstalled = true; // NEW
        installLanePagerStyles(); // NEW
        const host = ensureTaskControlOverlayHost(); // NEW
        if (!host) return; // NEW
        const nodes = new Map(); // NEW: keyed nodes retain focus and identity across refreshes

        function removeObsoleteNodes() { // NEW
            nodes.forEach((node, laneId) => { // NEW
                const state = lanePagingStates.get(laneId); // NEW
                const modelLane = model.getCell ? model.getCell(laneId) : (state && state.lane); // NEW
                if (state && state.plan.paged && modelLane) return; // NEW
                unregisterTaskOverlayGestureElement(node.element); // NEW
                if (node.element.parentNode) node.element.parentNode.removeChild(node.element); // NEW
                nodes.delete(laneId); // NEW
                if (!modelLane) lanePagingStates.delete(laneId); // NEW
            }); // NEW
        } // NEW

        function refresh() { // NEW
            removeObsoleteNodes(); // NEW
            const board = selectedTaskBoard(); // NEW
            nodes.forEach(node => { node.element.style.display = 'none'; }); // NEW
            if (!board || taskOverlayGestureActive) return; // NEW
            lanePagingStates.forEach((state, laneId) => { // NEW
                if (!state || state.board !== board || !state.plan.paged || isWeekDayLane(state.laneKey)) return; // NEW
                if (!isCellModelVisible(state.lane) || (graph.isCellCollapsed && graph.isCellCollapsed(state.lane))) return; // NEW
                let node = nodes.get(laneId); // NEW
                if (!node) { node = createLanePagerNode(host, state.lane, state.laneKey); nodes.set(laneId, node); } // NEW
                updateLanePagerOptions(node, state); // NEW
                node.element.style.display = positionLanePager(node, state, host) ? 'flex' : 'none'; // NEW
            }); // NEW
        } // NEW

        requestLanePagerOverlayRefresh = createDeferredTaskOverlayRefresh(refresh); // CHANGE
        const selectionModel = graph.getSelectionModel && graph.getSelectionModel(); // NEW
        if (selectionModel && selectionModel.addListener) selectionModel.addListener(mxEvent.CHANGE, function () { revealExternallySelectedPage(); requestLanePagerOverlayRefresh(); }); // NEW
        addGraphViewRefreshListener(requestLanePagerOverlayRefresh); // NEW
        requestLanePagerOverlayRefresh(); // NEW
    } // NEW

    function roleInitials(name) { // NEW
        const words = String(name || '').trim().split(/\s+/).filter(Boolean); // NEW
        if (!words.length || String(name) === 'Deleted role') return '?'; // NEW
        return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0]).toUpperCase(); // NEW
    } // NEW

    function roleShortDisplayName(name) { // NEW
        const trimmed = String(name || '').trim(); // NEW
        if (!trimmed || trimmed === 'Deleted role') return trimmed || 'Unnamed person'; // NEW
        const words = trimmed.split(/\s+/).filter(Boolean); // NEW
        if (words.length === 1) return words[0]; // NEW
        return words[0] + ' ' + words[words.length - 1][0].toUpperCase() + '.'; // NEW
    } // NEW

    function roleAvatarColor(id) { // NEW: stable initials color without persisted presentation data
        const palette = ['#2563EB', '#7C3AED', '#DB2777', '#059669', '#D97706', '#4F46E5']; // NEW
        let hash = 0; // NEW
        for (const ch of String(id || '')) hash = ((hash * 31) + ch.charCodeAt(0)) | 0; // NEW
        return palette[Math.abs(hash) % palette.length]; // NEW
    } // NEW

    function consumeDomEvent(evt) { // NEW
        if (evt && evt.stopPropagation) evt.stopPropagation(); // NEW
        if (mxEvent && mxEvent.consume) mxEvent.consume(evt); // NEW
    } // NEW

    function makeRoleAvatarNode(profile, size, onClick) { // NEW
        const button = document.createElement('button'); // NEW
        button.type = 'button'; // NEW
        button.className = 'trellis-task-assignee-avatar'; // NEW
        button.setAttribute('aria-label', 'Go to ' + profile.name + ' — ' + profile.roleTitle); // NEW
        button.title = profile.name + ' — ' + profile.roleTitle + (profile.eligible ? '' : ' (unavailable)'); // NEW
        button.style.cssText = 'box-sizing:border-box;width:' + size + 'px;height:' + size + 'px;min-width:' + size + 'px;border-radius:50%;border:' + (profile.eligible ? '1px solid #fff' : '2px solid #D97706') + ';padding:0;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;color:#fff;font:bold ' + Math.max(8, Math.round(size * 0.45)) + 'px Arial,sans-serif;line-height:1;background:' + roleAvatarColor(profile.id) + ';cursor:' + (profile.cell ? 'pointer' : 'default') + ';'; // NEW
        button.textContent = roleInitials(profile.name); // NEW
        if (profile.imageSource) { // NEW
            const image = document.createElement('img'); // NEW
            image.alt = ''; // NEW
            image.src = profile.imageSource; // NEW
            image.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;'; // NEW
            image.addEventListener('error', function () { if (image.parentNode) image.parentNode.removeChild(image); }); // NEW
            button.appendChild(image); // NEW
        } // NEW
        button.addEventListener('mousedown', consumeDomEvent); // NEW
        button.addEventListener('mouseup', consumeDomEvent); // NEW
        button.addEventListener('click', function (evt) { consumeDomEvent(evt); if (profile.cell && onClick) onClick(profile); }); // NEW
        return button; // NEW
    } // NEW

    function makeRoleAssigneePillNode(profile, onClick) { // NEW
        const row = document.createElement('div'); // NEW
        row.className = 'trellis-task-assignee-pill'; // NEW
        row.title = profile.name + ' - ' + profile.roleTitle + (profile.eligible ? '' : ' (unavailable)'); // NEW
        row.style.cssText = 'box-sizing:border-box;width:100%;max-width:126px;height:22px;border:1px solid #D1D5DB;border-radius:11px;padding:2px 7px 2px 2px;background:#fff;color:#111;display:flex;align-items:center;gap:5px;font:11px Arial,sans-serif;line-height:1;overflow:hidden;'; // NEW
        row.appendChild(makeRoleAvatarNode(profile, 16, onClick)); // NEW
        const label = document.createElement('span'); // NEW
        label.className = 'trellis-task-assignee-pill-label'; // NEW
        label.textContent = roleShortDisplayName(profile.name); // NEW
        label.style.cssText = 'display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:' + (profile.cell ? 'pointer' : 'default') + ';'; // NEW
        label.addEventListener('mousedown', consumeDomEvent); // NEW
        label.addEventListener('mouseup', consumeDomEvent); // NEW
        label.addEventListener('click', function (evt) { consumeDomEvent(evt); if (profile.cell && onClick) onClick(profile); }); // NEW
        row.appendChild(label); // NEW
        return row; // NEW
    } // NEW

    function navigateToRoleProfile(profile) { // NEW
        const roleCard = profile && profile.cell; // NEW
        if (!roleCard || !model.getCell(profile.id)) return; // NEW
        model.beginUpdate(); // NEW
        try { // NEW
            let current = roleCard; // NEW
            while (current) { // NEW
                const parent = model.getParent(current); // NEW
                if (parent && model.isVisible && !model.isVisible(parent) && model.setVisible) model.setVisible(parent, true); // NEW
                if (parent && graph.isCellCollapsed && graph.isCellCollapsed(parent) && graph.foldCells) graph.foldCells(false, false, [parent]); // NEW
                current = parent; // NEW
            } // NEW
        } finally { model.endUpdate(); } // NEW
        if (graph.setSelectionCell) graph.setSelectionCell(roleCard); // NEW
        if (graph.scrollCellToVisible) graph.scrollCellToVisible(roleCard, true); // NEW
    } // NEW

    let assigneeNamesPopover = null; // NEW
    function closeAssigneeNamesPopover() { // NEW
        if (assigneeNamesPopover && assigneeNamesPopover.parentNode) assigneeNamesPopover.parentNode.removeChild(assigneeNamesPopover); // NEW
        assigneeNamesPopover = null; // NEW
    } // NEW

    function showAssigneeNamesPopover(anchor, profiles) { // NEW
        closeAssigneeNamesPopover(); // NEW
        const host = ensureTaskControlOverlayHost(); // NEW
        if (!host) return; // NEW
        const popover = document.createElement('div'); // NEW
        popover.className = 'trellis-task-assignee-names-popover'; // NEW
        popover.setAttribute('role', 'dialog'); // NEW
        popover.setAttribute('aria-label', 'Assigned people'); // NEW
        popover.style.cssText = 'position:absolute;min-width:220px;max-width:320px;max-height:260px;overflow:auto;background:#fff;border:1px solid #111;border-radius:4px;padding:5px;box-shadow:0 3px 12px rgba(0,0,0,.22);pointer-events:auto;font:12px Arial,sans-serif;z-index:' + GRAPH_OVERLAY_Z.CONTROL_TOP + ';'; // NEW
        profiles.forEach(profile => { // NEW
            const row = document.createElement('div'); // NEW
            row.style.cssText = 'width:100%;display:flex;gap:7px;align-items:center;border:0;background:transparent;text-align:left;padding:4px;cursor:' + (profile.cell ? 'pointer' : 'default') + ';'; // NEW
            row.appendChild(makeRoleAvatarNode(profile, 24, function (target) { closeAssigneeNamesPopover(); navigateToRoleProfile(target); })); // CHANGE
            const text = document.createElement('button'); // NEW
            text.type = 'button'; // NEW
            text.disabled = !profile.cell; // NEW
            text.textContent = profile.name + ' — ' + profile.roleTitle + (profile.eligible ? '' : ' (unavailable)'); // NEW
            text.style.cssText = 'flex:1;border:0;background:transparent;padding:0;text-align:left;font:12px Arial,sans-serif;cursor:' + (profile.cell ? 'pointer' : 'default') + ';'; // NEW
            text.addEventListener('click', function (evt) { consumeDomEvent(evt); if (profile.cell) { closeAssigneeNamesPopover(); navigateToRoleProfile(profile); } }); // NEW
            row.appendChild(text); // NEW
            popover.appendChild(row); // NEW
        }); // NEW
        host.appendChild(popover); // NEW
        const hostRect = host.parentNode && host.parentNode.getBoundingClientRect ? host.parentNode.getBoundingClientRect() : { left: 0, top: 0 }; // NEW
        const anchorRect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 0, bottom: 0 }; // NEW
        popover.style.left = Math.max(0, Math.round(anchorRect.left - hostRect.left)) + 'px'; // NEW
        popover.style.top = Math.max(0, Math.round(anchorRect.bottom - hostRect.top + 4)) + 'px'; // NEW
        assigneeNamesPopover = popover; // NEW
    } // NEW

    function installWeekAssigneeBadgeLayer() { // NEW
        if (graph.__trellisTaskAssigneeBadgesInstalled || !document || !document.createElement) return; // NEW
        graph.__trellisTaskAssigneeBadgesInstalled = true; // NEW
        const host = ensureTaskControlOverlayHost(); // NEW
        if (!host) return; // NEW
        let expandedAssigneeCardId = ''; // NEW: sticky expanded assignee grid follows the exact rendered card id
        const layer = document.createElement('div'); // NEW
        layer.className = 'trellis-task-assignee-badge-layer'; // NEW
        layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:' + GRAPH_OVERLAY_Z.CONTROL + ';'; // NEW
        host.appendChild(layer); // NEW
        registerTaskOverlayGestureElement(layer); // NEW

        function collapseExpandedAssigneeCard(requestRefresh) { // NEW
            expandedAssigneeCardId = ''; // NEW
            if (requestRefresh) requestRefresh(); // NEW
        } // NEW

        function appendAssigneeCollapsePill(stack, requestRefresh) { // NEW
            const collapse = document.createElement('button'); // NEW
            collapse.type = 'button'; // NEW
            collapse.className = 'trellis-task-assignee-collapse'; // NEW
            collapse.textContent = '-'; // CHANGE
            collapse.setAttribute('aria-label', 'Collapse assignees'); // NEW
            collapse.style.cssText = 'box-sizing:border-box;width:22px;height:18px;border:1px solid #6B7280;border-radius:9px;padding:0;background:#fff;color:#111;font:bold 12px Arial,sans-serif;line-height:16px;cursor:pointer;'; // CHANGE
            collapse.addEventListener('mousedown', consumeDomEvent); // NEW
            collapse.addEventListener('click', function (evt) { consumeDomEvent(evt); collapseExpandedAssigneeCard(requestRefresh); }); // NEW
            stack.appendChild(collapse); // NEW
        } // NEW

        function renderCardBadge(card, board) { // NEW
            const profiles = resolveCardAssigneeProfiles(card, board); // NEW
            const cardId = String(card && card.id || ''); // NEW
            if (!profiles.length || !cardId) { if (expandedAssigneeCardId === cardId) expandedAssigneeCardId = ''; return; } // CHANGE
            const state = graph.view && graph.view.getState ? graph.view.getState(card) : null; // NEW
            const bounds = getStateHostBounds(card, state, host); // NEW
            if (!bounds || bounds.width <= 0 || bounds.height <= 0) { if (expandedAssigneeCardId === cardId) expandedAssigneeCardId = ''; return; } // CHANGE
            const expanded = expandedAssigneeCardId === cardId; // NEW
            const stack = document.createElement('div'); // NEW
            stack.className = expanded ? 'trellis-task-assignee-stack trellis-task-assignee-stack-expanded' : 'trellis-task-assignee-stack'; // CHANGE
            stack.title = profiles.map(profile => profile.name + ' — ' + profile.roleTitle + (profile.eligible ? '' : ' (unavailable)')).join('\n'); // NEW
            stack.style.cssText = expanded ? 'position:absolute;display:flex;flex-direction:column;gap:3px;align-items:flex-end;pointer-events:auto;left:' + Math.round(bounds.x + bounds.width - 4) + 'px;top:' + Math.round(bounds.y + 2) + 'px;transform:translateX(-100%);box-sizing:border-box;padding:3px;background:#fff;border:1px solid #6B7280;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.18);z-index:' + GRAPH_OVERLAY_Z.CONTROL_TOP + ';' : 'position:absolute;display:flex;align-items:center;pointer-events:auto;left:' + Math.round(bounds.x + bounds.width - 4) + 'px;top:' + Math.round(bounds.y + 2) + 'px;transform:translateX(-100%);'; // CHANGE
            profiles.slice(0, expanded ? profiles.length : 3).forEach((profile, index) => { // CHANGE
                const avatar = expanded ? makeRoleAssigneePillNode(profile, navigateToRoleProfile) : makeRoleAvatarNode(profile, 16, navigateToRoleProfile); // CHANGE
                if (!expanded && index) avatar.style.marginLeft = '-4px'; // CHANGE
                stack.appendChild(avatar); // NEW
            }); // NEW
            if (expanded) appendAssigneeCollapsePill(stack, requestRefresh); // NEW
            if (!expanded && profiles.length > 3) { // CHANGE
                const more = document.createElement('button'); // NEW
                more.type = 'button'; // NEW
                more.className = 'trellis-task-assignee-overflow'; // NEW
                more.textContent = '+' + (profiles.length - 3); // NEW
                more.setAttribute('aria-label', 'Show all ' + profiles.length + ' assigned people'); // NEW
                more.style.cssText = 'box-sizing:border-box;height:16px;min-width:20px;margin-left:2px;border:1px solid #6B7280;border-radius:8px;padding:0 3px;background:#fff;color:#111;font:bold 9px Arial,sans-serif;line-height:14px;cursor:pointer;'; // NEW
                more.addEventListener('mousedown', consumeDomEvent); // NEW
                more.addEventListener('click', function (evt) { consumeDomEvent(evt); expandedAssigneeCardId = cardId; requestRefresh(); }); // CHANGE
                stack.appendChild(more); // NEW
            } // NEW
            layer.appendChild(stack); // NEW
        } // NEW

        function refresh() { // NEW
            const expectedExpandedCardId = expandedAssigneeCardId; // NEW
            let renderedExpandedCard = false; // NEW
            layer.innerHTML = ''; // NEW
            if (taskOverlayGestureActive) { layer.style.display = 'none'; return; } // NEW
            layer.style.display = 'block'; // NEW
            (function walk(cell) { // NEW
                if (!cell) return; // NEW
                if (isBoardCell(cell) && getBoardViewMode(cell) === 'WEEK') { // NEW
                    collectBoardCards(cell).forEach(entry => { // CHANGE
                        if (!isScheduleBreakCard(entry.card) && getTaskAssigneeRoleIds(entry.card).length) { // NEW
                            renderCardBadge(entry.card, cell); // NEW
                            renderedExpandedCard = renderedExpandedCard || (!!expectedExpandedCardId && String(entry.card && entry.card.id || '') === expectedExpandedCardId); // NEW
                        } // NEW
                    }); // CHANGE
                    return; // NEW
                } // NEW
                const count = model.getChildCount(cell); // NEW
                for (let i = 0; i < count; i++) walk(model.getChildAt(cell, i)); // NEW
            })(model.getRoot()); // NEW
            if (expectedExpandedCardId && !renderedExpandedCard) expandedAssigneeCardId = ''; // NEW
        } // NEW

        const requestRefresh = createDeferredTaskOverlayRefresh(refresh); // NEW
        addGraphViewRefreshListener(requestRefresh); // NEW
        graph.addListener('linksChanged', requestRefresh); // NEW
        window.addEventListener('trellisHistoryAfterRestore', requestRefresh); // NEW
        document.addEventListener('keydown', function (evt) { if (expandedAssigneeCardId && (evt.key === 'Escape' || evt.keyCode === 27)) { consumeDomEvent(evt); collapseExpandedAssigneeCard(requestRefresh); } }); // CHANGE
        requestRefresh(); // NEW
    } // NEW

    function installBoardHeaderControls() { // NEW
        if (graph.__trellisTaskBoardHeaderInstalled || !document || !document.createElement) return; // NEW
        graph.__trellisTaskBoardHeaderInstalled = true; // NEW
        const host = ensureTaskControlOverlayHost(); // NEW
        if (!host) return; // CHANGE
        const bar = document.createElement('div'); // NEW
        bar.className = 'trellis-task-board-header-controls'; // NEW
        bar.style.cssText = 'position:absolute;display:none;flex-direction:column;gap:4px;align-items:flex-start;background:#fff;border:1px solid #111;padding:4px;font:12px Arial,sans-serif;pointer-events:auto;'; // CHANGE
        bar.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL); // NEW
        host.appendChild(bar); // CHANGE
        registerTaskOverlayGestureElement(bar); // NEW
        const modeLabel = document.createElement('div'); // NEW
        modeLabel.style.cssText = 'font:12px Arial,sans-serif;font-weight:700;line-height:1.2;color:#111;'; // NEW
        bar.appendChild(modeLabel); // NEW
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
            mxEvent.addListener(btn, 'click', function (evt) { mxEvent.consume(evt); fn(); requestRefresh(); }); // CHANGE
            row.appendChild(btn); // NEW
            return btn; // NEW
        } // NEW

        function selectedBoard() { // NEW
            const cells = getSelectionCellsList(); // NEW
            for (const cell of cells) { // NEW
                if (isBoardCell(cell)) return cell; // CHANGE
                const board = findBoardAncestor(cell); // NEW
                if (board) return board; // CHANGE
            } // NEW
            return null; // NEW
        } // NEW

        function selectionCellStillVisibleInBoard(board, cell) { // NEW
            if (!board || !cell) return false; // NEW
            if (cell === board) return true; // NEW
            let cur = cell; // NEW
            while (cur && cur !== board) { // NEW
                if (model.isVisible && model.isVisible(cur) === false) return false; // NEW
                cur = model.getParent(cur); // NEW
            } // NEW
            return cur === board; // NEW
        } // NEW

        function restoreBoardSelectionIfNeeded(board) { // NEW
            if (!board || !graph.setSelectionCell) return; // NEW
            const stillVisible = getSelectionCellsList().some(cell => selectionCellStillVisibleInBoard(board, cell)); // NEW
            if (!stillVisible) graph.setSelectionCell(board); // NEW
        } // NEW

        function toggleBoardPlanningView() { // NEW
            const b = selectedBoard(); // NEW
            if (!b) return; // NEW
            taskCommands.setBoardPlanningView(b, getBoardViewMode(b) === 'WEEK' ? 'FULL' : 'WEEK'); // CHANGE
            restoreBoardSelectionIfNeeded(b); // NEW
        } // NEW

        const modeToggle = button('Switch to Week view', toggleBoardPlanningView); // CHANGE
        const prev = button('<', () => { const b = selectedBoard(); if (!b) return; const mode = getBoardViewMode(b); if (mode === 'WEEK') taskCommands.setBoardPlanningView(b, null, { [TASK_SELECTED_WEEK_START_ATTR]: shiftTaskCalendarISO(getSelectedWeekStart(b), -7), [TASK_SELECTED_DAY_ATTR]: shiftTaskCalendarISO(getSelectedWeekStart(b), -7) }); }); // CHANGE
        const next = button('>', () => { const b = selectedBoard(); if (!b) return; const mode = getBoardViewMode(b); if (mode === 'WEEK') taskCommands.setBoardPlanningView(b, null, { [TASK_SELECTED_WEEK_START_ATTR]: shiftTaskCalendarISO(getSelectedWeekStart(b), 7), [TASK_SELECTED_DAY_ATTR]: shiftTaskCalendarISO(getSelectedWeekStart(b), 7) }); }); // CHANGE
        const todayBtn = button('Today', () => { const b = selectedBoard(); if (!b) return; const today = todayISO(); taskCommands.setBoardPlanningView(b, null, { [TASK_SELECTED_WEEK_START_ATTR]: getTaskWeekStartISO(today), [TASK_SELECTED_DAY_ATTR]: today }); }); // CHANGE
        const endDayBtn = button('End Day', () => { const b = selectedBoard(); if (b) taskCommands.endDay(b); }); // CHANGE
        const endWeekBtn = button('End Week', () => { const b = selectedBoard(); if (b) taskCommands.endWeek(b); }); // CHANGE
        const editHoursBtn = button('Edit Hours', () => { const b = selectedBoard(); if (b) taskDialogs.showEditHoursDialog(b); }); // CHANGE
        const addBreakBtn = button('Add Break', () => { const b = selectedBoard(); if (b) taskCommands.addBreakToSelectedDay(b); }); // CHANGE
        dateInput.addEventListener('mousedown', evt => evt.stopPropagation()); // NEW
        dateInput.addEventListener('click', evt => evt.stopPropagation()); // NEW
        mxEvent.addListener(dateInput, 'change', function (evt) { // NEW
            mxEvent.consume(evt); // NEW
            const b = selectedBoard(); // NEW
            if (!b) return; // NEW
            const value = String(dateInput.value || '').trim(); // NEW
            if (!value) { taskCommands.setBoardPlanningView(b, 'FULL'); requestRefresh(); return; } // CHANGE
            const weekStart = getTaskWeekStartISO(value); // NEW
            if (!weekStart) return; // NEW
            const mode = getBoardViewMode(b); // NEW
            taskCommands.setBoardPlanningView(b, 'WEEK', { [TASK_SELECTED_WEEK_START_ATTR]: weekStart, [TASK_SELECTED_DAY_ATTR]: value }); // CHANGE
            requestRefresh(); // CHANGE
        }); // NEW

        function refresh() { // NEW
            const board = selectedBoard(); // NEW
            if (!board) { bar.style.display = 'none'; return; } // CHANGE
            ensureBoardPlanningDefaults(board); // NEW
            const mode = getBoardViewMode(board); // NEW
            bar.style.display = 'flex'; // NEW
            dateInput.value = mode === 'FULL' ? '' : getSelectedDay(board); // NEW
            modeLabel.textContent = mode === 'WEEK' ? 'Mode: Week' : 'Mode: Full'; // NEW
            modeToggle.textContent = mode === 'WEEK' ? 'Switch to Full view' : 'Switch to Week view'; // CHANGE
            modeToggle.setAttribute('aria-pressed', mode === 'WEEK' ? 'true' : 'false'); // CHANGE
            prev.style.display = mode === 'WEEK' ? '' : 'none'; // CHANGE
            next.style.display = mode === 'WEEK' ? '' : 'none'; // CHANGE
            todayBtn.textContent = mode === 'WEEK' ? 'This Week' : 'Today'; // NEW
            todayBtn.style.display = mode === 'WEEK' ? '' : 'none'; // NEW
            endDayBtn.textContent = 'End Day (' + countEndDayCards(board) + ')'; // NEW
            endWeekBtn.textContent = 'End Week (' + countEndWeekCards(board) + ')'; // NEW
            const selectedScheduleLane = mode === 'WEEK' ? selectedScheduleLaneForBoard(board) : null; // NEW
            const selectedScheduleLaneKey = selectedScheduleLane ? getAttr(selectedScheduleLane, 'lane_key') : null; // NEW
            const selectedScheduleDayWindow = selectedScheduleLaneKey ? getBoardWeekWorkHours(board)[getWeekDayIndexForLaneKey(selectedScheduleLaneKey)] : null; // NEW
            const hasSelectedScheduleLane = !!selectedScheduleLane; // CHANGE
            const selectedScheduleDayOpen = hasSelectedScheduleLane && !(selectedScheduleDayWindow && selectedScheduleDayWindow.closed); // NEW
            endDayBtn.style.display = hasSelectedScheduleLane ? '' : 'none'; // CHANGE
            endWeekBtn.style.display = mode === 'WEEK' ? '' : 'none'; // NEW
            editHoursBtn.style.display = hasSelectedScheduleLane ? '' : 'none'; // NEW
            addBreakBtn.style.display = selectedScheduleDayOpen ? '' : 'none'; // CHANGE
            if (!positionDomOverlayFromCellState(bar, board, false, true)) bar.style.display = 'none'; // CHANGE
        } // NEW

        const requestRefresh = createDeferredTaskOverlayRefresh(refresh); // CHANGE
        graph.getSelectionModel().addListener(mxEvent.CHANGE, requestRefresh); // CHANGE
        addGraphViewRefreshListener(requestRefresh); // CHANGE
        requestRefresh(); // CHANGE
    } // NEW

    function installWeekTimeScaleOverlay() { // NEW
        if (graph.__trellisTaskWeekTimeScaleInstalled || !document || !document.createElement) return; // NEW
        graph.__trellisTaskWeekTimeScaleInstalled = true; // NEW
        const host = ensureTaskControlOverlayHost(); // NEW
        if (!host) return; // NEW
        const overlay = document.createElement('div'); // NEW
        overlay.className = 'trellis-task-week-time-scale'; // NEW
        overlay.style.cssText = 'position:absolute;display:none;pointer-events:none;font:11px Arial,sans-serif;color:#4B5563;z-index:' + GRAPH_OVERLAY_Z.ANNOTATION + ';'; // NEW
        host.appendChild(overlay); // NEW

        function selectedBoard() { // NEW
            const cells = getSelectionCellsList(); // NEW
            for (const cell of cells) { // NEW
                if (isBoardCell(cell)) return cell; // NEW
                const board = findBoardAncestor(cell); // NEW
                if (board) return board; // NEW
            } // NEW
            return null; // NEW
        } // NEW

        function clearOverlay() { // NEW
            overlay.style.display = 'none'; // NEW
            overlay.innerHTML = ''; // NEW
        } // NEW

        function addHourMark(fragment, labelWidth, gridLeft, gridWidth, y, minute, isBoundary) { // NEW
            const line = document.createElement('div'); // NEW
            line.className = 'trellis-task-week-time-grid-line'; // NEW
            line.style.cssText = 'position:absolute;left:' + Math.round(gridLeft) + 'px;top:' + Math.round(y) + 'px;width:' + Math.round(gridWidth) + 'px;border-top:1px solid ' + (isBoundary ? '#CBD5E1' : '#E5E7EB') + ';height:0;'; // NEW
            fragment.appendChild(line); // NEW
            const label = document.createElement('div'); // NEW
            label.className = 'trellis-task-week-time-label'; // NEW
            label.textContent = formatScheduleClockMinute(minute); // NEW
            label.style.cssText = 'position:absolute;left:0;top:' + Math.max(0, Math.round(y - 7)) + 'px;width:' + Math.round(labelWidth) + 'px;text-align:right;white-space:nowrap;'; // NEW
            fragment.appendChild(label); // NEW
        } // NEW

        function refresh() { // NEW
            const board = selectedBoard(); // NEW
            if (!board || getBoardViewMode(board) !== 'WEEK') { clearOverlay(); return; } // NEW
            ensureBoardPlanningDefaults(board); // NEW
            const lanes = boardLanes(board); // NEW
            const firstLane = lanes[WEEK_DAY_LANE_KEYS[0]]; // NEW
            const lastLane = lanes[WEEK_DAY_LANE_KEYS[WEEK_DAY_LANE_KEYS.length - 1]]; // NEW
            if (!firstLane || !lastLane) { clearOverlay(); return; } // NEW
            const timeScale = schedulePolicy.buildWeekTimeScale(getBoardWeekWorkHours(board)); // NEW
            if (!timeScale.active) { clearOverlay(); return; } // NEW
            const boardBounds = getCellVisualBounds(board, host); // NEW
            const viewScale = graph.view && Number(graph.view.scale) > 0 ? Number(graph.view.scale) : 1; // NEW
            const firstGeo = model.getGeometry(firstLane); // NEW
            const lastGeo = model.getGeometry(lastLane); // NEW
            if (!boardBounds || !firstGeo || !lastGeo) { clearOverlay(); return; } // NEW
            const labelWidth = WEEK_TIME_RULER_WIDTH * viewScale; // CHANGE
            const scaledGap = LANE_GAP * viewScale; // NEW
            const gridLeft = labelWidth + scaledGap; // CHANGE
            const gridWidth = Math.max(0, ((Number(lastGeo.x) || 0) + (Number(lastGeo.width) || 0) - (Number(firstGeo.x) || 0)) * viewScale); // CHANGE
            const gridHeight = schedulePolicy.scheduleMinuteOffsetToPx(timeScale.durationMinutes) * viewScale; // CHANGE
            const overlayLeft = boardBounds.x + ((Number(firstGeo.x) || 0) * viewScale) - labelWidth - scaledGap; // CHANGE
            const overlayTop = boardBounds.y + ((BOARD_LANE_Y + WEEK_BOARD_TOP_MARGIN) * viewScale); // CHANGE
            overlay.style.left = Math.round(overlayLeft) + 'px'; // NEW
            overlay.style.top = Math.round(overlayTop) + 'px'; // NEW
            overlay.style.width = Math.round(labelWidth + scaledGap + gridWidth) + 'px'; // CHANGE
            overlay.style.height = Math.round(gridHeight + 16) + 'px'; // NEW
            overlay.style.display = 'block'; // NEW
            overlay.innerHTML = ''; // NEW
            const fragment = document.createDocumentFragment(); // NEW
            timeScale.hourMarks.forEach((minute, index) => { // NEW
                const y = schedulePolicy.scheduleMinuteOffsetToPx(minute - timeScale.startMinute) * viewScale; // CHANGE
                addHourMark(fragment, labelWidth, gridLeft, gridWidth, y, minute, index === 0 || index === timeScale.hourMarks.length - 1); // NEW
            }); // NEW
            overlay.appendChild(fragment); // NEW
        } // NEW

        const requestRefresh = createDeferredTaskOverlayRefresh(refresh); // NEW
        graph.getSelectionModel().addListener(mxEvent.CHANGE, requestRefresh); // NEW
        addGraphViewRefreshListener(requestRefresh); // NEW
        requestRefresh(); // NEW
    } // NEW

    function showBulkEditCardsDialogImpl(cards) { // CHANGE
        const selected = uniqueKanbanCards(cards); // NEW
        if (!selected.length) return; // NEW
        if (selected.length === 1) { taskDialogs.showEditCardDialog(selected[0]); return; } // CHANGE
        const dateEditable = selected.filter(canEditCardDates); // NEW
        const firstRange = dateEditable.length ? getTaskDateRange(dateEditable[0].value) : null; // NEW
        const div = document.createElement('div'); // NEW
        div.style.padding = '12px'; // NEW
        div.style.boxSizing = 'border-box'; // NEW
        div.style.fontFamily = 'Arial, sans-serif'; // NEW
        const heading = document.createElement('div'); // NEW
        heading.textContent = 'Edit ' + selected.length + ' Cards'; // NEW
        heading.style.fontSize = '16px'; // NEW
        heading.style.fontWeight = 'bold'; // NEW
        heading.style.marginBottom = '10px'; // NEW
        div.appendChild(heading); // NEW

        function addToggleRow(toggle, labelText, input) { // NEW
            const row = document.createElement('div'); // NEW
            row.style.display = 'flex'; // NEW
            row.style.alignItems = 'center'; // NEW
            row.style.gap = '8px'; // NEW
            row.style.marginBottom = '10px'; // NEW
            const label = document.createElement('label'); // NEW
            label.style.width = '115px'; // NEW
            label.style.flex = '0 0 115px'; // NEW
            label.appendChild(toggle); // NEW
            label.appendChild(document.createTextNode(' ' + labelText)); // NEW
            input.style.flex = '1'; // NEW
            row.appendChild(label); // NEW
            row.appendChild(input); // NEW
            div.appendChild(row); // NEW
        } // NEW

        const noteCheck = document.createElement('input'); // NEW
        noteCheck.type = 'checkbox'; // NEW
        const noteInput = document.createElement('input'); // NEW
        noteInput.type = 'text'; // NEW
        noteInput.placeholder = 'Replace notes on selected cards'; // NEW
        addToggleRow(noteCheck, 'Replace notes', noteInput); // NEW
        const noteFeedback = document.createElement('div'); // NEW
        noteFeedback.style.margin = '-6px 0 10px 123px'; // NEW
        noteFeedback.style.fontSize = '12px'; // NEW
        div.appendChild(noteFeedback); // NEW

        const dateCheck = document.createElement('input'); // NEW
        dateCheck.type = 'checkbox'; // NEW
        const startInput = document.createElement('input'); // NEW
        startInput.type = 'date'; // NEW
        startInput.disabled = !dateEditable.length; // NEW
        startInput.value = firstRange ? firstRange.startISO : ''; // NEW
        addToggleRow(dateCheck, 'Set start date', startInput); // NEW
        dateCheck.disabled = !dateEditable.length; // NEW

        const error = document.createElement('div'); // NEW
        error.style.color = '#b91c1c'; // NEW
        error.style.minHeight = '18px'; // NEW
        error.style.fontSize = '12px'; // NEW
        error.style.marginBottom = '8px'; // NEW
        div.appendChild(error); // NEW

        function updateNoteFeedback() { // NEW
            const collapsed = String(noteInput.value || '').replace(/\s+/g, ' ').trim(); // NEW
            const length = Array.from(collapsed).length; // NEW
            noteFeedback.textContent = length + '/' + CARD_NOTE_MAX_LENGTH + ' - replaces existing notes when checked'; // NEW
            noteFeedback.style.color = length > CARD_NOTE_MAX_LENGTH ? '#b91c1c' : '#6b7280'; // NEW
        } // NEW

        noteInput.addEventListener('input', updateNoteFeedback); // NEW
        noteInput.addEventListener('input', function () { noteCheck.checked = true; }); // NEW
        startInput.addEventListener('input', function () { if (dateEditable.length) dateCheck.checked = true; }); // NEW
        updateNoteFeedback(); // NEW

        const buttons = document.createElement('div'); // NEW
        buttons.style.display = 'flex'; // NEW
        buttons.style.justifyContent = 'flex-end'; // NEW
        buttons.style.gap = '8px'; // NEW
        const cancelButton = mxUtils.button('Cancel', function () { ui.hideDialog(); }); // NEW
        const saveButton = mxUtils.button('Save', function () { // NEW
            const replaceNote = noteCheck.checked; // NEW
            const setStartDate = dateCheck.checked; // NEW
            if (!replaceNote && !setStartDate) { ui.hideDialog(); return; } // NEW
            if (setStartDate && !parseTaskCalendarISO(startInput.value)) { // NEW
                error.style.color = '#b91c1c'; // NEW
                error.textContent = 'Enter a valid start date.'; // NEW
                startInput.focus(); // NEW
                return; // NEW
            } // NEW
            const result = taskCommands.applyBulkCardEdit(selected, { replaceNote, note: noteInput.value, setStartDate, startDate: startInput.value }); // CHANGE
            if (setStartDate && result.dateSkipped > 0) { // NEW
                error.style.color = '#374151'; // NEW
                error.textContent = 'Saved. Skipped ' + result.dateSkipped + ' card' + (result.dateSkipped === 1 ? '' : 's') + ' not eligible for date editing.'; // NEW
                return; // NEW
            } // NEW
            ui.hideDialog(); // NEW
        }); // NEW
        buttons.appendChild(cancelButton); // NEW
        buttons.appendChild(saveButton); // NEW
        div.appendChild(buttons); // NEW

        mxEvent.addListener(div, 'keydown', function (evt) { // NEW
            if (evt.key === 'Enter') saveButton.click(); // NEW
            if (evt.key === 'Escape') ui.hideDialog(); // NEW
        }); // NEW
        taskDialogs.showTaskManagerDialog(div, 460, dateEditable.length ? 260 : 230, true, true); // CHANGE
        noteInput.focus(); // NEW
    } // NEW

    function createTaskDialogRuntime({ ui, document, commands, adapters }) { // CHANGE: dialog seam owns DOM/input flow only
        return Object.freeze({ // CHANGE
            showEditCardDialog: showEditCardDialogImpl, // CHANGE
            showEditHoursDialog: showEditHoursDialogImpl, // CHANGE
            showEditDayHoursDialog: showEditDayHoursDialogImpl, // NEW
            showBulkEditCardsDialog: showBulkEditCardsDialogImpl, // CHANGE
            showTaskManagerDialog: showTaskManagerDialogImpl, // CHANGE
            elevateTaskManagerDialog: elevateTaskManagerDialogImpl // CHANGE
        }); // CHANGE
    }

    const taskDialogs = createTaskDialogRuntime({ // CHANGE
        ui, // CHANGE
        document, // CHANGE
        commands: taskCommands, // CHANGE
        adapters: taskRuntimeAdapters // CHANGE
    }); // CHANGE

    function showEditCardDialog(card) { return taskDialogs.showEditCardDialog(card); } // CHANGE
    function showEditHoursDialog(board) { return taskDialogs.showEditHoursDialog(board); } // CHANGE
    function showEditDayHoursDialog(board, laneKey) { return taskDialogs.showEditDayHoursDialog(board, laneKey); } // NEW
    function showBulkEditCardsDialog(cards) { return taskDialogs.showBulkEditCardsDialog(cards); } // CHANGE
    function showTaskManagerDialog(node, width, height, modal, closable) { return taskDialogs.showTaskManagerDialog(node, width, height, modal, closable); } // CHANGE
    function elevateTaskManagerDialog() { return taskDialogs.elevateTaskManagerDialog(); } // CHANGE

    function installSelectedDayLaneActionOverlay() { // NEW
        if (graph.__trellisTaskDayLaneOverlayInstalled || !document || !document.createElement) return; // NEW
        graph.__trellisTaskDayLaneOverlayInstalled = true; // NEW
        const host = ensureTaskControlOverlayHost(); // NEW
        if (!host) return; // NEW
        const overlay = document.createElement('div'); // NEW
        overlay.className = 'trellis-task-selected-day-lane-actions'; // NEW
        overlay.style.cssText = 'position:absolute;display:none;flex-direction:column;align-items:stretch;gap:4px;background:#fff;border:1px solid #111;padding:4px;font:12px Arial,sans-serif;pointer-events:auto;'; // CHANGE
        overlay.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL); // NEW
        host.appendChild(overlay); // NEW
        registerTaskOverlayGestureElement(overlay); // NEW
        mxEvent.addListener(overlay, 'mousedown', evt => mxEvent.consume(evt)); // NEW
        mxEvent.addListener(overlay, 'mouseup', evt => mxEvent.consume(evt)); // NEW

        function selectedDayLaneContext() { // NEW
            const cells = getSelectionCellsList(); // NEW
            if (cells.length !== 1) return null; // NEW
            const lane = cells[0]; // NEW
            const laneKey = getAttr(lane, 'lane_key'); // NEW
            if (!lane || !model.isVertex(lane) || !isWeekDayLane(laneKey)) return null; // NEW
            const board = findBoardAncestor(lane); // NEW
            if (!board || getBoardViewMode(board) !== 'WEEK') return null; // NEW
            const dayIndex = getWeekDayIndexForLaneKey(laneKey); // NEW
            const dayWindow = getBoardWeekWorkHours(board)[dayIndex]; // NEW
            return { board, lane, laneKey, dayIndex, dayWindow: normalizeWorkHourWindow(dayWindow) }; // NEW
        } // NEW

        function add(label, fn) { // NEW
            const btn = document.createElement('button'); // NEW
            btn.type = 'button'; // NEW
            btn.textContent = label; // NEW
            btn.style.cssText = 'font:12px Arial,sans-serif;padding:3px 6px;'; // NEW
            mxEvent.addListener(btn, 'click', function (evt) { // NEW
                mxEvent.consume(evt); // NEW
                const ctx = selectedDayLaneContext(); // NEW
                if (ctx) fn(ctx); // NEW
                requestRefresh(); // NEW
            }); // NEW
            overlay.appendChild(btn); // NEW
            return btn; // NEW
        } // NEW

        const changeHoursBtn = add('Change Hours', ctx => taskDialogs.showEditDayHoursDialog(ctx.board, ctx.laneKey)); // NEW
        const addBreakBtn = add('Add Break', ctx => taskCommands.addBreakToSelectedDay(ctx.board)); // NEW
        const openDayBtn = add('Open Day', ctx => taskCommands.openSelectedWeekDayFromDefaults(ctx.board, ctx.laneKey)); // NEW
        const closeDayBtn = add('Close Day', ctx => taskCommands.closeSelectedWeekDay(ctx.board, ctx.lane)); // NEW

        function refresh() { // NEW
            const ctx = selectedDayLaneContext(); // NEW
            if (!ctx) { overlay.style.display = 'none'; return; } // NEW
            ensureBoardPlanningDefaults(ctx.board); // NEW
            const hasVisibleCards = selectedWeekDayHasVisibleCards(ctx.lane); // NEW
            const isClosed = !!ctx.dayWindow.closed; // NEW
            changeHoursBtn.style.display = ''; // NEW
            addBreakBtn.style.display = isClosed ? 'none' : ''; // NEW
            openDayBtn.style.display = hasVisibleCards || !isClosed ? 'none' : ''; // NEW
            closeDayBtn.style.display = hasVisibleCards || isClosed ? 'none' : ''; // NEW
            overlay.style.display = 'flex'; // NEW
            if (!positionDomOverlayFromCellState(overlay, ctx.lane, true, false, TASK_ACTION_OVERLAY_EXTRA_Y)) overlay.style.display = 'none'; // CHANGE
        } // NEW

        const requestRefresh = createDeferredTaskOverlayRefresh(refresh); // NEW
        graph.getSelectionModel().addListener(mxEvent.CHANGE, requestRefresh); // NEW
        addGraphViewRefreshListener(requestRefresh); // NEW
        requestRefresh(); // NEW
    } // NEW

    function installSelectedCardActionOverlay() { // NEW
        if (graph.__trellisTaskCardOverlayInstalled || !document || !document.createElement) return; // NEW
        graph.__trellisTaskCardOverlayInstalled = true; // NEW
        const host = ensureTaskControlOverlayHost(); // NEW
        if (!host) return; // CHANGE
        const overlay = document.createElement('div'); // NEW
        overlay.className = 'trellis-task-selected-card-actions'; // NEW
        overlay.style.cssText = 'position:absolute;display:none;flex-direction:column;align-items:stretch;gap:4px;background:#fff;border:1px solid #111;padding:4px;font:12px Arial,sans-serif;pointer-events:auto;'; // CHANGE
        overlay.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL); // NEW
        host.appendChild(overlay); // CHANGE
        registerTaskOverlayGestureElement(overlay); // NEW
        mxEvent.addListener(overlay, 'mousedown', evt => mxEvent.consume(evt)); // NEW
        mxEvent.addListener(overlay, 'mouseup', evt => mxEvent.consume(evt)); // NEW

        function add(label, fn) { // NEW
            const btn = document.createElement('button'); // NEW
            btn.type = 'button'; // NEW
            btn.textContent = label; // NEW
            btn.style.cssText = 'font:12px Arial,sans-serif;padding:3px 6px;'; // NEW
            mxEvent.addListener(btn, 'click', function (evt) { mxEvent.consume(evt); const cards = selectedKanbanCards(); if (cards.length) fn(cards); requestRefresh(); }); // CHANGE
            overlay.appendChild(btn); // NEW
            return btn; // NEW
        } // NEW

        let assignmentPicker = null; // NEW
        let assignmentPickerSignature = ''; // NEW

        function closeAssignmentPicker(restoreActions) { // CHANGE
            if (assignmentPicker && assignmentPicker.parentNode) assignmentPicker.parentNode.removeChild(assignmentPicker); // NEW
            assignmentPicker = null; // NEW
            assignmentPickerSignature = ''; // NEW
            if (assignBtn) assignBtn.setAttribute('aria-expanded', 'false'); // NEW
            if (restoreActions !== false) requestRefresh(); // NEW
        } // NEW

        function positionAssignmentPickerFromBounds(picker, bounds) { // NEW
            if (!picker || !bounds) return false; // NEW
            picker.style.left = Math.max(0, Math.round(bounds.x)) + 'px'; // NEW
            picker.style.top = Math.max(0, Math.round(bounds.y + bounds.height + 6 + TASK_ACTION_OVERLAY_EXTRA_Y)) + 'px'; // NEW
            return true; // NEW
        } // NEW

        function assignmentContextSignature(context) { // NEW: stale drafts never apply to changed graph state
            if (!context) return ''; // NEW
            const profileById = new Map(context.roster.map(profile => [profile.id, profile])); // NEW
            context.cards.forEach(card => resolveCardAssigneeProfiles(card, context.board).forEach(profile => profileById.set(profile.id, profile))); // NEW
            return [ // NEW
                context.board.id || '', // NEW
                Array.from(getLinkSet(context.board)).sort().join(','), // NEW
                context.cards.map(card => String(card.id || '') + ':' + serializeTaskAssigneeRoleIds(getTaskAssigneeRoleIds(card))).join('|'), // NEW
                Array.from(profileById.values()).sort((a, b) => a.id.localeCompare(b.id)).map(profile => [profile.id, profile.name, profile.roleTitle, profile.cardTitle, profile.imageSource, profile.eligible ? '1' : '0'].join('~')).join('|') // NEW
            ].join('||'); // NEW
        } // NEW

        function appendPickerProfileRow(parent, profile, controls) { // NEW
            const row = document.createElement('div'); // NEW
            row.className = 'trellis-task-assignee-picker-row'; // NEW
            row.setAttribute('data-search-text', (profile.name + ' ' + profile.roleTitle + ' ' + profile.cardTitle).toLowerCase()); // NEW
            row.style.cssText = 'display:grid;grid-template-columns:28px minmax(120px,1fr) auto;gap:6px;align-items:center;padding:3px 2px;'; // NEW
            row.appendChild(makeRoleAvatarNode(profile, 24, navigateToRoleProfile)); // NEW
            const label = document.createElement('div'); // NEW
            const name = document.createElement('div'); // NEW
            name.textContent = profile.name; // NEW
            name.style.fontWeight = '700'; // NEW
            const title = document.createElement('div'); // NEW
            title.textContent = profile.roleTitle; // NEW
            title.style.cssText = 'font-size:11px;color:#4B5563;'; // NEW
            label.appendChild(name); label.appendChild(title); row.appendChild(label); // NEW
            const controlHost = document.createElement('div'); // NEW
            controlHost.style.cssText = 'display:flex;gap:12px;align-items:center;justify-content:flex-end;'; // NEW
            controls(controlHost); // NEW
            row.appendChild(controlHost); // NEW
            parent.appendChild(row); // NEW
            return row; // NEW
        } // NEW

        function makeLabeledCheckbox(labelText) { // NEW
            const label = document.createElement('label'); // NEW
            label.style.cssText = 'display:inline-flex;gap:3px;align-items:center;font-size:11px;white-space:nowrap;'; // NEW
            const input = document.createElement('input'); // NEW
            input.type = 'checkbox'; // NEW
            label.appendChild(input); // NEW
            const text = document.createElement('span'); // NEW
            text.textContent = labelText; // NEW
            label.appendChild(text); // NEW
            return { label, input }; // NEW
        } // NEW

        function openAssignmentPicker(cards) { // NEW
            const context = getAssignmentSelectionContext(cards); // NEW
            if (!context) return; // NEW
            const rosterIds = new Set(context.roster.map(profile => profile.id)); // NEW
            const profileById = new Map(context.roster.map(profile => [profile.id, profile])); // NEW
            context.cards.forEach(card => resolveCardAssigneeProfiles(card, context.board).forEach(profile => profileById.set(profile.id, profile))); // NEW
            if (!profileById.size) return; // NEW
            closeAssignmentPicker(false); // CHANGE
            const picker = document.createElement('div'); // NEW
            picker.className = 'trellis-task-assignee-picker'; // NEW
            picker.setAttribute('role', 'dialog'); // NEW
            picker.setAttribute('aria-label', 'Assign task cards'); // NEW
            picker.style.cssText = 'position:absolute;width:340px;max-width:calc(100vw - 16px);max-height:420px;display:flex;flex-direction:column;background:#fff;border:1px solid #111;border-radius:4px;box-shadow:0 4px 16px rgba(0,0,0,.25);padding:6px;pointer-events:auto;font:12px Arial,sans-serif;z-index:' + GRAPH_OVERLAY_Z.CONTROL_TOP + ';'; // NEW
            picker.addEventListener('mousedown', consumeDomEvent); // NEW
            const search = document.createElement('input'); // NEW
            search.type = 'search'; // NEW
            search.placeholder = 'Search people or roles'; // NEW
            search.setAttribute('aria-label', 'Search people or roles'); // NEW
            search.style.cssText = 'box-sizing:border-box;width:100%;margin-bottom:5px;padding:4px 6px;font:12px Arial,sans-serif;'; // NEW
            picker.appendChild(search); // NEW
            const list = document.createElement('div'); // NEW
            list.style.cssText = 'overflow:auto;min-height:40px;'; // NEW
            picker.appendChild(list); // NEW
            const drafts = new Map(); // NEW
            const single = context.cards.length === 1; // NEW
            const groups = []; // NEW
            const unavailable = Array.from(profileById.values()).filter(profile => !rosterIds.has(profile.id)); // NEW
            if (unavailable.length) groups.push({ label: 'Unavailable assignments', warning: true, profiles: unavailable }); // NEW
            const eligibleGroups = new Map(); // NEW
            context.roster.forEach(profile => { // NEW
                const key = profile.roleTitle.replace(/\s+/g, ' ').trim().toLowerCase(); // NEW
                if (!eligibleGroups.has(key)) eligibleGroups.set(key, { label: profile.roleTitle, profiles: [] }); // NEW
                const group = eligibleGroups.get(key); // NEW
                if (profile.roleTitle.localeCompare(group.label, undefined, { sensitivity: 'base' }) < 0) group.label = profile.roleTitle; // NEW
                group.profiles.push(profile); // NEW
            }); // NEW
            Array.from(eligibleGroups.values()).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })).forEach(group => groups.push(group)); // NEW

            groups.forEach(group => { // NEW
                const section = document.createElement('section'); // NEW
                section.className = 'trellis-task-assignee-picker-group'; // NEW
                const heading = document.createElement('div'); // NEW
                heading.textContent = group.label; // NEW
                heading.style.cssText = 'margin-top:4px;padding:3px 2px;border-bottom:1px solid #D1D5DB;font-weight:700;color:' + (group.warning ? '#B45309' : '#111') + ';'; // NEW
                section.appendChild(heading); // NEW
                group.profiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id)).forEach(profile => { // NEW
                    const assignedCards = context.cards.filter(card => getTaskAssigneeRoleIds(card).indexOf(profile.id) >= 0); // NEW
                    if (single) { // NEW
                        const draft = { selected: assignedCards.length === 1 }; // NEW
                        drafts.set(profile.id, draft); // NEW
                        appendPickerProfileRow(section, profile, function (controlHost) { // NEW
                            const assignment = makeLabeledCheckbox('Assigned'); // NEW
                            assignment.input.checked = draft.selected; // NEW
                            assignment.input.addEventListener('change', function () { draft.selected = assignment.input.checked; }); // NEW
                            controlHost.appendChild(assignment.label); // NEW
                        }); // NEW
                    } else { // NEW
                        const initiallyExisting = assignedCards.length > 0; // NEW
                        const initiallyAll = assignedCards.length === context.cards.length; // NEW
                        const canAdd = rosterIds.has(profile.id); // NEW
                        const draft = { existing: initiallyExisting, all: canAdd && initiallyAll, savedExisting: initiallyExisting, canAdd, originalIds: new Set(assignedCards.map(card => card.id)) }; // CHANGE
                        drafts.set(profile.id, draft); // NEW
                        appendPickerProfileRow(section, profile, function (controlHost) { // NEW
                            const existing = makeLabeledCheckbox('Existing'); // NEW
                            const all = makeLabeledCheckbox('All cards'); // NEW
                            function sync() { // NEW
                                existing.input.checked = draft.existing; // NEW
                                existing.input.disabled = draft.all || !initiallyExisting; // NEW
                                all.input.checked = draft.all; // NEW
                                all.input.disabled = !draft.canAdd; // NEW
                            } // NEW
                            existing.input.addEventListener('change', function () { draft.existing = existing.input.checked; }); // NEW
                            all.input.addEventListener('change', function () { // NEW
                                if (all.input.checked) { draft.savedExisting = draft.existing; draft.all = true; draft.existing = true; } // NEW
                                else { draft.all = false; draft.existing = draft.savedExisting; } // NEW
                                sync(); // NEW
                            }); // NEW
                            sync(); // NEW
                            controlHost.appendChild(existing.label); controlHost.appendChild(all.label); // NEW
                        }); // NEW
                    } // NEW
                }); // NEW
                list.appendChild(section); // NEW
            }); // NEW

            const emptySearch = document.createElement('div'); // NEW
            emptySearch.textContent = 'No matching people'; // NEW
            emptySearch.style.cssText = 'display:none;padding:12px;text-align:center;color:#6B7280;'; // NEW
            list.appendChild(emptySearch); // NEW
            search.addEventListener('input', function () { // NEW
                const query = search.value.trim().toLowerCase(); // NEW
                let anyVisible = false; // NEW
                Array.from(list.querySelectorAll('.trellis-task-assignee-picker-group')).forEach(section => { // NEW
                    let sectionVisible = false; // NEW
                    Array.from(section.querySelectorAll('.trellis-task-assignee-picker-row')).forEach(row => { // NEW
                        const visible = !query || String(row.getAttribute('data-search-text') || '').indexOf(query) >= 0; // NEW
                        row.style.display = visible ? 'grid' : 'none'; // NEW
                        sectionVisible = sectionVisible || visible; // NEW
                    }); // NEW
                    section.style.display = sectionVisible ? '' : 'none'; // NEW
                    anyVisible = anyVisible || sectionVisible; // NEW
                }); // NEW
                emptySearch.style.display = anyVisible ? 'none' : 'block'; // NEW
            }); // NEW

            const footer = document.createElement('div'); // NEW
            footer.style.cssText = 'display:flex;justify-content:flex-end;gap:6px;margin-top:6px;padding-top:5px;border-top:1px solid #D1D5DB;'; // NEW
            const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; // NEW
            const apply = document.createElement('button'); apply.type = 'button'; apply.textContent = 'Apply'; // NEW
            cancel.addEventListener('click', function (evt) { consumeDomEvent(evt); closeAssignmentPicker(); }); // NEW
            apply.addEventListener('click', function (evt) { // NEW
                consumeDomEvent(evt); // NEW
                const liveContext = getAssignmentSelectionContext(selectedKanbanCards()); // NEW
                if (!liveContext || assignmentContextSignature(liveContext) !== assignmentPickerSignature) { closeAssignmentPicker(); return; } // NEW
                const nextIdsByCard = new Map(); // NEW
                liveContext.cards.forEach(card => { // NEW
                    const next = new Set(getTaskAssigneeRoleIds(card)); // NEW
                    drafts.forEach((draft, id) => { // NEW
                        if (single) { if (draft.selected) next.add(id); else next.delete(id); return; } // NEW
                        if (draft.all) next.add(id); // NEW
                        else if (draft.originalIds.has(card.id)) { if (draft.existing) next.add(id); else next.delete(id); } // NEW
                        else next.delete(id); // NEW
                    }); // NEW
                    nextIdsByCard.set(card, Array.from(next)); // NEW
                }); // NEW
                applyTaskAssignmentSets(liveContext.cards, nextIdsByCard); // NEW
                closeAssignmentPicker(); // CHANGE
            }); // NEW
            footer.appendChild(cancel); footer.appendChild(apply); picker.appendChild(footer); // NEW
            host.appendChild(picker); // NEW
            const pickerBounds = getCellStateBounds(context.cards, picker.parentNode); // NEW
            if (!positionAssignmentPickerFromBounds(picker, pickerBounds)) { picker.parentNode.removeChild(picker); return; } // CHANGE
            assignmentPicker = picker; // NEW
            assignmentPickerSignature = assignmentContextSignature(context); // NEW
            assignBtn.setAttribute('aria-expanded', 'true'); // NEW
            overlay.style.display = 'none'; // NEW
            search.focus(); // NEW
        } // NEW

        const editBtn = add('Edit', cards => cards.length === 1 ? taskDialogs.showEditCardDialog(cards[0]) : taskDialogs.showBulkEditCardsDialog(cards)); // CHANGE
        const assignBtn = add('Assign to', openAssignmentPicker); // NEW
        assignBtn.setAttribute('aria-haspopup', 'dialog'); // NEW
        assignBtn.setAttribute('aria-expanded', 'false'); // NEW
        const todoBtn = add('TODO', cards => taskCommands.applyCardWorkflowActions(cards, 'TODO')); // CHANGE
        const doingBtn = add('DOING', cards => taskCommands.applyCardWorkflowActions(cards, 'DOING')); // CHANGE
        const doneBtn = add('DONE', cards => taskCommands.applyCardWorkflowActions(cards, 'DONE')); // CHANGE
        const allocateBtn = add('Allocate to Start Dates', cards => taskCommands.applyStagedStartDateAllocation(cards)); // CHANGE
        const resetBtn = add('Reset Dates', cards => cards.length === 1 ? taskCommands.resetCardDates(cards[0]) : taskCommands.resetCardDatesForCards(cards)); // CHANGE
        const clearBtn = add('Clear Note', cards => cards.length === 1 ? taskCommands.clearCardNote(cards[0]) : taskCommands.applyBulkCardEdit(cards, { replaceNote: true, note: '' })); // CHANGE

        function refresh() { // NEW
            const cards = selectedKanbanCards(); // NEW
            const assignmentContext = getAssignmentSelectionContext(cards); // NEW
            if (assignmentPicker && assignmentContextSignature(assignmentContext) !== assignmentPickerSignature) closeAssignmentPicker(false); // CHANGE
            if (!cards.length) { closeAssignmentPicker(false); overlay.style.display = 'none'; return; } // CHANGE
            const bounds = getCellStateBounds(cards, overlay.parentNode); // CHANGE
            if (!bounds) { closeAssignmentPicker(false); overlay.style.display = 'none'; return; } // CHANGE
            if (assignmentPicker) { // NEW
                if (!positionAssignmentPickerFromBounds(assignmentPicker, bounds)) closeAssignmentPicker(false); // NEW
                overlay.style.display = 'none'; // NEW
                return; // NEW
            } // NEW
            const single = cards.length === 1; // NEW
            const card = cards[0]; // NEW
            const state = single ? getEffectiveWorkflowState(card.value, laneKeyOfCard(card)) : null; // CHANGE
            const showWorkflowButtons = selectionIsOnlyWeekDayLaneCards(cards); // NEW
            overlay.style.display = 'flex'; // NEW
            editBtn.style.display = ''; // NEW
            assignBtn.style.display = assignmentContext ? '' : 'none'; // NEW
            if (assignmentContext) { // NEW
                const assignedCount = new Set(assignmentContext.cards.flatMap(getTaskAssigneeRoleIds)).size; // NEW
                const hasEditableProfiles = assignmentContext.roster.length > 0 || assignedCount > 0; // NEW
                assignBtn.disabled = !hasEditableProfiles; // NEW
                assignBtn.textContent = hasEditableProfiles ? ('Assign to' + (assignedCount ? ' (' + assignedCount + ')' : '')) : 'Assign to — link role cards to this board'; // NEW
                assignBtn.title = hasEditableProfiles ? 'Assign linked role cards' : 'Directly link role cards to this board to assign them'; // NEW
            } // NEW
            todoBtn.style.display = showWorkflowButtons && (!single || state !== 'TODO') ? '' : 'none'; // CHANGE
            doingBtn.style.display = showWorkflowButtons && (!single || state !== 'DOING') ? '' : 'none'; // CHANGE
            doneBtn.style.display = showWorkflowButtons && (!single || state !== 'DONE') ? '' : 'none'; // CHANGE
            allocateBtn.style.display = selectionIsOnlyStagedWorkflowCards(cards) ? '' : 'none'; // NEW
            resetBtn.style.display = single ? (canEditCardDates(card) && hasCardDateOverride(card) ? '' : 'none') : (cards.some(hasCardDateOverride) ? '' : 'none'); // CHANGE
            clearBtn.style.display = single ? (getCardNote(card) ? '' : 'none') : (cards.some(getCardNote) ? '' : 'none'); // CHANGE
            if (!positionDomOverlayFromBounds(overlay, bounds, true, false, TASK_ACTION_OVERLAY_EXTRA_Y)) overlay.style.display = 'none'; // CHANGE
        } // NEW

        const requestRefresh = createDeferredTaskOverlayRefresh(refresh); // CHANGE
        graph.getSelectionModel().addListener(mxEvent.CHANGE, requestRefresh); // CHANGE
        addGraphViewRefreshListener(requestRefresh); // CHANGE
        document.addEventListener('mousedown', function (evt) { if (assignmentPicker && !assignmentPicker.contains(evt.target) && evt.target !== assignBtn) closeAssignmentPicker(); }, true); // NEW
        document.addEventListener('keydown', function (evt) { if (assignmentPicker && (evt.key === 'Escape' || evt.keyCode === 27)) { consumeDomEvent(evt); closeAssignmentPicker(); } }); // NEW
        requestRefresh(); // CHANGE
    } // NEW

    // -------------------- Context menu installer -------------------- // CHANGE
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
                    taskDialogs.showEditCardDialog(card); // CHANGE
                }); // CHANGE

                if (getCardNote(card)) { // NEW
                    menu.addItem('Clear Card Note', null, function () { // NEW
                        taskCommands.clearCardNote(card); // CHANGE
                    }); // NEW
                } // NEW

                if (canEditCardDates(card) && hasCardDateOverride(card)) { // CHANGE
                    menu.addItem('Reset Card Dates', null, function () { // NEW
                        taskCommands.resetCardDates(card); // CHANGE
                    }); // NEW
                } // NEW

                const repeatContext = getRepeatSeriesContext(card); // NEW
                if (repeatContext) { // NEW
                    menu.addItem( // NEW
                        repeatContext.expanded ? 'Collapse Repeating Tasks' : 'Expand Repeating Tasks', // NEW
                        null, // NEW
                        function () { // NEW
                            taskCommands.setRepeatSeriesExpanded(card, !repeatContext.expanded); // CHANGE
                        } // NEW
                    ); // NEW
                } // NEW
            } // NEW

            const gm = cell && model.isVertex(cell) && isGardenModule(cell) ? cell : null;           // CHANGE
            if (!gm) return;                                                                         // CHANGE

            menu.addSeparator();                                                                     // CHANGE
            menu.addItem('Add Kanban Board', null, function () {
                taskCommands.ensureBoardTemplateInUpdate(gm); // CHANGE
            });
            } // CHANGE
        }); // CHANGE
    })();

    // -------------------- Boot sequence -------------------- // NEW
    installTaskOverlayGestureGate(); // NEW
    installLanePagerOverlay(); // NEW
    initializeLanePagingFromModel(); // NEW
    installWeekAssigneeBadgeLayer(); // NEW
    installBoardHeaderControls(); // NEW
    installWeekTimeScaleOverlay(); // NEW
    installSelectedDayLaneActionOverlay(); // NEW
    installSelectedCardActionOverlay(); // NEW

    // -------------------- Event bridge installers -------------------- // CHANGE
    function handleTasksCreatedEvent(ev) {
        const detail = ev && ev.detail ? ev.detail : {};
        const replacement = normalizeTaskReplacementDetail(detail);
        const tasks = replacement.tasks;
        const targetGroupId = replacement.targetGroupId;

        if ((replacement.mode !== 'replace' && replacement.mode !== 'sync') || !targetGroupId) return; // CHANGED

        setTimeout(function () {
            runTrellisHistoryTransaction({ category: replacement.mode === 'sync' ? "Garden scheduling" : "Tasks", action: replacement.mode, origin: "Garden_Task_Manager", title: replacement.mode === 'sync' ? "Synchronize generated tasks" : "Replace generated tasks", affectedCellIds: [targetGroupId] }, function () { // NEW
                if (replacement.mode === 'sync') { // ADDED
                    taskCommands.applyDifferentialTaskSync({ targetGroupId, tasks }); // CHANGE
                    return; // ADDED
                } // ADDED
                taskCommands.replaceTasks(targetGroupId, tasks); // CHANGE
            }); // NEW
        }, 0);
    }

    window.addEventListener('tasksCreated', handleTasksCreatedEvent);

    window.addEventListener('trellisHistoryBeforeRestore', function () { // NEW
        cancelPendingKanbanRepairs(); // NEW
    }); // NEW

    window.addEventListener('trellisHistoryAfterRestore', function () { // NEW
        try { taskCommands.scanAllBoards({ insideUpdate: false }); } catch (e) { } // NEW
    }); // NEW

    window.addEventListener("yearFilterChanged", function (ev) {                         // NEW
        try {                                                                           // NEW
            // simplest: rescan boards so paging respects year_hidden                   // NEW
            taskCommands.scanAllBoards({ insideUpdate: false });                        // CHANGE
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
                taskCommands.ensureBoardTemplateInUpdate(moduleCell);                        // CHANGE
                graph.refresh(moduleCell);
                graph.fireEvent(new mxEventObject("usl:requestApplyModuleMargins", "cell", moduleCell));// NEW
                // NEW
            }, 0);                                                                           // NEW
        });                                                                                  // NEW
    }                                                                                        // NEW

        } // CHANGE
    }); // CHANGE
} // CHANGE

Draw.loadPlugin(function (ui) { // CHANGE
    createGardenTaskManagerRuntime({ // CHANGE
        ui, // CHANGE
        taskPolicy: TaskPolicyCore, // CHANGE
        schedulePolicy: SchedulePolicyCore // CHANGE
    }).install(); // CHANGE
}); // CHANGE
