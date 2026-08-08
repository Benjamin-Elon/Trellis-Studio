/**
 * Draw.io Plugin: Task Manager (Kanban Template Style + Auto Placement + Auto Archive + Badges)
 */

// -------------------- Scheduler event contract --------------------
function normalizeTaskReplacementDetail(detail) { // FIX: centralize the scheduler event contract
    const source = detail && typeof detail === 'object' ? detail : {};
    return {
        mode: String(source.mode || 'replace').trim().toLowerCase(),
        targetGroupId: source.targetGroupId,
        tasks: Array.isArray(source.tasks) ? source.tasks : []
    };
}

function applyImmediateTaskReplacement({ targetGroupId, tasks, removeTasks, createTasks }) {
    removeTasks(targetGroupId, { reflow: tasks.length === 0 });
    if (tasks.length) createTasks(tasks, targetGroupId, { reflow: true });
}

// -------------------- Constants and task attributes --------------------
const CARD_NOTE_ATTR = 'card_note'; // NEW: user annotation kept separate from scheduler task notes
const CARD_NOTE_MAX_LENGTH = 40;
const TASK_VIEW_MODE_ATTR = 'task_view_mode';
const TASK_SELECTED_DAY_ATTR = 'task_selected_day';
const TASK_SELECTED_WEEK_START_ATTR = 'task_selected_week_start';
const TASK_WORKFLOW_STATE_ATTR = 'workflow_state';
const TASK_ASSIGNED_DAY_ATTR = 'assigned_day';
const TASK_INCOMPLETE_DAY_ATTR = 'incomplete_day';
const TASK_SCHEDULER_MISSING_ATTR = 'scheduler_missing';
const TASK_SCHEDULER_DATES_LOCKED_ATTR = 'scheduler_dates_locked';
const TASK_MANUAL_STAGED_ATTR = 'manual_staged';
const TASK_SCHEDULE_START_MINUTE_ATTR = 'schedule_start_minute'; // NEW: derived from stacked day-lane order
const TASK_SCHEDULE_DURATION_MINUTES_ATTR = 'schedule_duration_minutes'; // NEW: derived from card height
const TASK_FULL_CARD_HEIGHT_ATTR = 'task_full_card_height'; // NEW: full-view visual card height, separate from week schedule duration
const TASK_SCHEDULE_BREAK_ATTR = 'schedule_break'; // NEW: real stacked card that reserves schedule time
const TASK_SCHEDULE_ORDER_ATTR = 'schedule_order'; // NEW: preserves day stack order across week navigation
const TASK_SCHEDULE_ORDER_DAY_ATTR = 'schedule_order_day'; // NEW: prevents stale order from applying to another date
const TASK_WORK_HOURS_DEFAULTS_ATTR = 'task_work_hours_defaults_json';
const TASK_WORK_HOURS_WEEK_OVERRIDES_ATTR = 'task_work_hours_week_overrides_json';
const TASK_DAY_LANE_WIDTHS_ATTR = 'task_day_lane_widths_json'; // NEW: user-resized per-weekday lane widths
const TASK_NON_DAY_LANE_WIDTHS_ATTR = 'task_non_day_lane_widths_json'; // NEW: user-resized per-lane widths for non-day lanes
const TASK_FULL_LANE_HEIGHT_ATTR = 'task_full_lane_height'; // NEW: user-resized full-mode lane height
const TASK_WEEK_BOARD_HEIGHTS_ATTR = 'task_week_board_heights_json'; // NEW: user-resized week-mode board heights keyed by week start
const TASK_VISIBLE_LANE_KEYS_ATTR = 'task_visible_lane_keys_json'; // NEW: per-board lane visibility, scoped by task view mode
const TASK_ASSIGNEE_ROLE_IDS_ATTR = 'task_assignee_role_ids_json'; // NEW: canonical role-card ids assigned to a task
const TASK_PAGE_ANCHOR_ATTR = 'task_page_anchor_card_id'; // NEW: authoritative persisted page position for non-day lanes
const TASK_VIEW_MODES = ['FULL', 'WEEK']; // CHANGE: Day mode now normalizes to Week
const TASK_WORKFLOW_STATES = ['STAGED', 'TODO', 'DOING', 'DONE'];
const WEEK_DAY_LANE_KEYS = ['WEEK_SUN', 'WEEK_MON', 'WEEK_TUE', 'WEEK_WED', 'WEEK_THU', 'WEEK_FRI', 'WEEK_SAT'];
const GRAPH_OVERLAY_Z = Object.freeze({ ANNOTATION: 10000, CONNECTION: 10010, CONTROL: 10020, CONTROL_TOP: 10030 });
const TRELLIS_DIALOG_Z = 2000000000; // NEW: match Draw.io dialog layer ordering

function applyTaskButtonStyle(button, variant, options) {
    const semanticVariant = variant || 'neutral';
    if (!button) return button;
    if (window.Trellis && window.Trellis.ui && typeof window.Trellis.ui.applyButtonStyle === 'function') {
        window.Trellis.ui.applyButtonStyle(button, semanticVariant, options || {});
    } else if (button.setAttribute) {
        const activeOpen = semanticVariant === 'open' && options && options.active === true; // NEW
        const style = { open: ['#2563eb', activeOpen ? '#1e3a8a' : '#1d4ed8', activeOpen ? '#eff6ff' : '#fff'], add: ['#188038', '#166534', '#fff'], close: ['#b91c1c', '#b91c1c', '#fff'], danger: ['#b91c1c', '#fff', '#b91c1c'], neutral: ['#6b7280', '#111827', '#fff'] }[semanticVariant] || ['#6b7280', '#111827', '#fff']; // NEW
        button.setAttribute('data-trellis-button-variant', semanticVariant);
        button.style.border = '1px solid ' + style[0]; // NEW
        button.style.color = style[1]; // NEW
        button.style.background = style[2]; // NEW
        if (activeOpen) button.style.fontWeight = '700'; // NEW
    }
    return button;
}

const SCHEDULE_PX_PER_HOUR = 80;
const SCHEDULE_MINUTE_SNAP = 15;
const SCHEDULE_MIN_CARD_HEIGHT = 20;
const WEEK_TIME_RULER_WIDTH = 56; // NEW: non-cell gutter used by the week-mode hour guide
const DEFAULT_TASK_CARD_HEIGHT = 80;
const DEFAULT_DAY_LANE_WIDTH = 220;
const MIN_DAY_LANE_WIDTH = 140;
const DEFAULT_WORK_START_MINUTE = 6 * 60;
const DEFAULT_WORK_END_MINUTE = 18 * 60;
const DEFAULT_WEEKDAY_WORK_START_MINUTE = 17 * 60; // NEW: realistic default for after-work garden sessions
const DEFAULT_WEEKDAY_WORK_END_MINUTE = 19 * 60; // NEW: cap weekday default capacity at two hours
const DEFAULT_WEEKEND_WORK_START_MINUTE = 8 * 60; // NEW: weekend garden work starts after early morning setup
const DEFAULT_WEEKEND_WORK_END_MINUTE = 12 * 60; // NEW: weekend default avoids assuming all-day availability
const DEFAULT_WEEK_WORK_HOUR_WINDOWS = Object.freeze([ // NEW: explicit new-board defaults; malformed saved data still uses legacy normalizer fallback
    { startMinute: DEFAULT_WEEKEND_WORK_START_MINUTE, endMinute: DEFAULT_WEEKEND_WORK_END_MINUTE },
    { startMinute: DEFAULT_WEEKDAY_WORK_START_MINUTE, endMinute: DEFAULT_WEEKDAY_WORK_END_MINUTE },
    { startMinute: DEFAULT_WEEKDAY_WORK_START_MINUTE, endMinute: DEFAULT_WEEKDAY_WORK_END_MINUTE },
    { startMinute: DEFAULT_WEEKDAY_WORK_START_MINUTE, endMinute: DEFAULT_WEEKDAY_WORK_END_MINUTE },
    { startMinute: DEFAULT_WEEKDAY_WORK_START_MINUTE, endMinute: DEFAULT_WEEKDAY_WORK_END_MINUTE },
    { startMinute: DEFAULT_WEEKDAY_WORK_START_MINUTE, endMinute: DEFAULT_WEEKDAY_WORK_END_MINUTE },
    { startMinute: DEFAULT_WEEKEND_WORK_START_MINUTE, endMinute: DEFAULT_WEEKEND_WORK_END_MINUTE }
]);

const KANBAN_BOARD_KEY = 'KANBAN_BOARD'; // NEW: shared by runtime guards and pure policy tests
const LEGACY_KANBAN_BOARD_KEY = 'MAIN_KANBAN_BOARD'; // NEW: preserve recognition of older board cells
const KANBAN_LANE_DEFS = [ // NEW: canonical lane types used by template creation and parenting policy
    { key: 'UPCOMING_FUTURE', label: 'UPCOMING (future)' },
    { key: 'UPCOMING_YEAR', label: 'UPCOMING (year)' },
    { key: 'UPCOMING_MONTH', label: 'UPCOMING (month)' },
    { key: 'UPCOMING_WEEK', label: 'UPCOMING (week)' },
    { key: 'TODO_STAGED', label: 'TODO (staged)' },
    { key: 'WEEK_SUN', label: 'Sunday' },
    { key: 'WEEK_MON', label: 'Monday' },
    { key: 'WEEK_TUE', label: 'Tuesday' },
    { key: 'WEEK_WED', label: 'Wednesday' },
    { key: 'WEEK_THU', label: 'Thursday' },
    { key: 'WEEK_FRI', label: 'Friday' },
    { key: 'WEEK_SAT', label: 'Saturday' },
    { key: 'TODO', label: 'TODO' },
    { key: 'DOING', label: 'DOING' },
    { key: 'DONE', label: 'DONE' },
    { key: 'DONE_WEEK', label: 'DONE (week)' },
    { key: 'DONE_MONTH', label: 'DONE (month)' },
    { key: 'DONE_YEAR', label: 'DONE (year)' },
    { key: 'ARCHIVED', label: 'ARCHIVED' }
];
const KANBAN_LANE_KEYS = KANBAN_LANE_DEFS.map(lane => lane.key);
const FULL_VIEW_LANE_KEYS = [
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
];
const WEEK_VIEW_LANE_KEYS = ['TODO_STAGED', ...WEEK_DAY_LANE_KEYS]; // CHANGE: DONE is a card state on day lanes

const EDITABLE_CARD_DATE_LANES = new Set([ // NEW: completed lanes intentionally remain immutable in version one
    'UPCOMING_FUTURE',
    'UPCOMING_YEAR',
    'UPCOMING_MONTH',
    'UPCOMING_WEEK',
    'TODO_STAGED',
    'WEEK_SUN',
    'WEEK_MON',
    'WEEK_TUE',
    'WEEK_WED',
    'WEEK_THU',
    'WEEK_FRI',
    'WEEK_SAT',
    'TODO',
    'DOING'
]);

// -------------------- Pure task policy: calendar, workflow, and visible lanes --------------------
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

function normalizeTaskViewMode(value) {
    const mode = String(value || '').trim().toUpperCase();
    if (mode === 'DAY') return 'WEEK'; // CHANGE: preserve legacy files while removing user-facing Day mode
    return TASK_VIEW_MODES.includes(mode) ? mode : 'FULL';
}

function normalizeWorkflowState(value) {
    const state = String(value || '').trim().toUpperCase();
    return TASK_WORKFLOW_STATES.includes(state) ? state : null;
}

function getTaskWeekStartISO(iso) {
    const parsed = parseTaskCalendarISO(iso);
    if (!parsed) return null;
    const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
    const dayOfWeek = date.getUTCDay();
    return shiftTaskCalendarISO(iso, -dayOfWeek);
}

function getTaskWeekEndISO(weekStartISO) {
    return shiftTaskCalendarISO(weekStartISO, 6);
}

function isTaskDateInWeek(iso, weekStartISO) {
    const date = parseTaskCalendarISO(iso);
    const start = parseTaskCalendarISO(weekStartISO);
    if (!date || !start) return false;
    return date.dayNumber >= start.dayNumber && date.dayNumber <= start.dayNumber + 6;
}

function getWeekLaneKeyForDate(iso, weekStartISO) {
    const date = parseTaskCalendarISO(iso);
    const start = parseTaskCalendarISO(weekStartISO);
    if (!date || !start) return null;
    const offset = date.dayNumber - start.dayNumber;
    return offset >= 0 && offset < WEEK_DAY_LANE_KEYS.length ? WEEK_DAY_LANE_KEYS[offset] : null;
}

function getDateForWeekLaneKey(laneKey, weekStartISO) {
    const index = WEEK_DAY_LANE_KEYS.indexOf(String(laneKey || ''));
    if (index < 0 || !parseTaskCalendarISO(weekStartISO)) return null;
    return shiftTaskCalendarISO(weekStartISO, index);
}

function clampTaskDayToWeek(iso, weekStartISO) {
    const date = parseTaskCalendarISO(iso);
    const start = parseTaskCalendarISO(weekStartISO);
    if (!date || !start) return weekStartISO;
    if (date.dayNumber < start.dayNumber) return weekStartISO;
    if (date.dayNumber > start.dayNumber + 6) return getTaskWeekEndISO(weekStartISO);
    return iso;
}

function clampTaskStartToVisibleWeek(source, weekStartISO) {
    const weekStart = getTaskWeekStartISO(weekStartISO);
    const start = readAttributeValue(source, 'start');
    if (!parseTaskCalendarISO(start) || !parseTaskCalendarISO(weekStart)) return null;
    return clampTaskDayToWeek(start, weekStart);
}

function shiftTaskDayWithinWeek(iso, weekStartISO, delta) {
    const shifted = shiftTaskCalendarISO(iso, delta);
    return isTaskDateInWeek(shifted, weekStartISO) ? shifted : iso;
}

function getTaskViewLaneKeys(mode) {
    const normalized = normalizeTaskViewMode(mode);
    if (normalized === 'WEEK') return WEEK_VIEW_LANE_KEYS.slice();
    return FULL_VIEW_LANE_KEYS.slice();
}

function normalizeTaskVisibleLaneKeyList(keys, allowedKeys) {
    const allowed = Array.isArray(allowedKeys) ? allowedKeys.map(key => String(key || '')) : [];
    const allowedSet = new Set(allowed);
    const out = [];
    (Array.isArray(keys) ? keys : []).forEach(key => {
        const normalized = String(key || '');
        if (allowedSet.has(normalized) && out.indexOf(normalized) < 0) out.push(normalized);
    });
    return out.length ? out : allowed.slice();
}

function normalizeTaskVisibleLaneKeys(value) {
    const parsed = typeof value === 'string' ? parseJsonObject(value) : value;
    const source = parsed && typeof parsed === 'object' ? parsed : {};
    const out = {};
    TASK_VIEW_MODES.forEach(mode => {
        const raw = Array.isArray(source[mode]) ? source[mode] : [];
        out[mode] = normalizeTaskVisibleLaneKeyList(raw, getTaskViewLaneKeys(mode));
    });
    return out;
}

function serializeTaskVisibleLaneKeys(value) {
    const normalized = normalizeTaskVisibleLaneKeys(value);
    return JSON.stringify({ schemaVersion: 1, FULL: normalized.FULL, WEEK: normalized.WEEK });
}

function getTaskVisibleLaneKeysForMode(value, mode) {
    return normalizeTaskVisibleLaneKeys(value)[normalizeTaskViewMode(mode)] || getTaskViewLaneKeys(mode);
}

function deriveWorkflowStateFromLaneKey(laneKey) {
    const key = String(laneKey || '');
    if (key === 'TODO') return 'TODO';
    if (key === 'DOING') return 'DOING';
    if (key === 'DONE' || key === 'DONE_WEEK' || key === 'DONE_MONTH' || key === 'DONE_YEAR' || key === 'ARCHIVED') return 'DONE';
    return 'STAGED';
}

function getEffectiveWorkflowState(source, laneKey) {
    return normalizeWorkflowState(readAttributeValue(source, TASK_WORKFLOW_STATE_ATTR)) || deriveWorkflowStateFromLaneKey(laneKey);
}

function isOpenWorkflowState(state) {
    return state === 'TODO' || state === 'DOING';
}

function isSchedulerDateLocked(source) {
    return String(readAttributeValue(source, TASK_SCHEDULER_DATES_LOCKED_ATTR) || '') === '1';
}

function isManualStagedSource(source) {
    return String(readAttributeValue(source, TASK_MANUAL_STAGED_ATTR) || '') === '1';
}

function isPhysicallyOrManuallyStaged(source, laneKey) {
    return String(laneKey || '') === 'TODO_STAGED' || isManualStagedSource(source);
}

function isUserTouchedSchedulerCard(source) {
    const state = getEffectiveWorkflowState(source, null);
    return !!String(readAttributeValue(source, TASK_ASSIGNED_DAY_ATTR) || '').trim() ||
        state !== 'STAGED' ||
        !!String(readAttributeValue(source, 'completed') || '').trim() ||
        !!String(readAttributeValue(source, TASK_INCOMPLETE_DAY_ATTR) || '').trim() ||
        isManualStagedSource(source) ||
        !!String(readAttributeValue(source, 'date_override') || '').trim() ||
        !!String(readAttributeValue(source, CARD_NOTE_ATTR) || '').trim() ||
        isSchedulerDateLocked(source) ||
        hasTaskAssignees(source);
}

function isUserTouchedSchedulerRecord(record) {
    const source = record && (record.source || record);
    const state = getEffectiveWorkflowState(source, record && record.laneKey);
    return !!String(readAttributeValue(source, TASK_ASSIGNED_DAY_ATTR) || '').trim() ||
        state !== 'STAGED' ||
        !!String(readAttributeValue(source, 'completed') || '').trim() ||
        !!String(readAttributeValue(source, TASK_INCOMPLETE_DAY_ATTR) || '').trim() ||
        isManualStagedSource(source) ||
        !!String(readAttributeValue(source, 'date_override') || '').trim() ||
        !!String(readAttributeValue(source, CARD_NOTE_ATTR) || '').trim() ||
        isSchedulerDateLocked(source) ||
        hasTaskAssignees(source);
}

function buildWorkflowPatch(source, action, context) {
    const ctx = context || {};
    const mode = normalizeTaskViewMode(ctx.mode);
    const selectedDay = parseTaskCalendarISO(ctx.selectedDay) ? ctx.selectedDay : null;
    const selectedWeekStart = parseTaskCalendarISO(ctx.selectedWeekStart) ? ctx.selectedWeekStart : null;
    const today = parseTaskCalendarISO(ctx.today) ? ctx.today : null;
    const currentAssigned = String(readAttributeValue(source, TASK_ASSIGNED_DAY_ATTR) || '').trim();
    const attrs = {};
    let assignDay = null;

    if (action === 'TODO' || action === 'DOING') {
        assignDay = mode === 'WEEK' ? (ctx.dropDay || selectedDay || selectedWeekStart) : today;
        if (!parseTaskCalendarISO(assignDay)) return null;
        attrs[TASK_WORKFLOW_STATE_ATTR] = action;
        attrs[TASK_ASSIGNED_DAY_ATTR] = assignDay;
        attrs[TASK_SCHEDULER_DATES_LOCKED_ATTR] = '1';
        attrs[TASK_INCOMPLETE_DAY_ATTR] = null;
        attrs[TASK_MANUAL_STAGED_ATTR] = null;
        attrs.completed = null;
        return { attributes: attrs };
    }

    if (action === 'DONE') {
        assignDay = currentAssigned || (mode === 'WEEK' ? (ctx.dropDay || selectedDay || selectedWeekStart) : today);
        if (!parseTaskCalendarISO(assignDay)) return null;
        attrs[TASK_WORKFLOW_STATE_ATTR] = 'DONE';
        attrs[TASK_ASSIGNED_DAY_ATTR] = assignDay;
        attrs[TASK_SCHEDULER_DATES_LOCKED_ATTR] = '1';
        attrs[TASK_INCOMPLETE_DAY_ATTR] = null;
        attrs[TASK_MANUAL_STAGED_ATTR] = null;
        attrs.completed = mode === 'WEEK' ? assignDay : today;
        return { attributes: attrs };
    }

    if (action === 'STAGED') {
        attrs[TASK_WORKFLOW_STATE_ATTR] = 'STAGED';
        attrs[TASK_ASSIGNED_DAY_ATTR] = null;
        attrs[TASK_SCHEDULER_DATES_LOCKED_ATTR] = null;
        attrs[TASK_MANUAL_STAGED_ATTR] = ctx.manualStaged ? '1' : null;
        attrs.completed = null;
        return { attributes: attrs };
    }

    return null;
}

function buildIncompletePatch(source, incompleteDay) {
    const parsed = parseTaskCalendarISO(incompleteDay);
    if (!parsed) return null;
    return {
        attributes: {
            [TASK_WORKFLOW_STATE_ATTR]: 'STAGED',
            [TASK_ASSIGNED_DAY_ATTR]: null,
            [TASK_SCHEDULER_DATES_LOCKED_ATTR]: null,
            [TASK_INCOMPLETE_DAY_ATTR]: incompleteDay,
            [TASK_MANUAL_STAGED_ATTR]: '1',
            completed: null
        }
    };
}

function decideTaskViewLaneKey(source, context) {
    const ctx = context || {};
    const mode = normalizeTaskViewMode(ctx.mode);
    const fallbackLaneKey = String(ctx.laneKey || '');
    const state = getEffectiveWorkflowState(source, fallbackLaneKey);
    const assignedDay = String(readAttributeValue(source, TASK_ASSIGNED_DAY_ATTR) || '').trim();
    const completedDay = String(readAttributeValue(source, 'completed') || '').trim();

    if (mode === 'WEEK') {
        const weekStart = ctx.selectedWeekStart;
        if (state === 'STAGED') return 'TODO_STAGED';
        if (state === 'DONE') return getWeekLaneKeyForDate(completedDay || assignedDay, weekStart) || 'DONE_WEEK';
        const weekLane = getWeekLaneKeyForDate(assignedDay, weekStart);
        return weekLane || state;
    }

    if (state === 'TODO' || state === 'DOING') return state;
    if (state === 'DONE') return 'DONE';
    if (isPhysicallyOrManuallyStaged(source, fallbackLaneKey)) return 'TODO_STAGED';
    return ''; // NEW: Full staged cards keep scheduler horizon classification
}

function selectedPeriodStagedSortEnabled(laneKey, context) {
    const mode = normalizeTaskViewMode(context && (context.viewMode || context.mode));
    return String(laneKey || '') === 'TODO_STAGED' && mode === 'WEEK';
}

function selectedPeriodStagedTitle(source) {
    return String(readAttributeValue(source, 'title') || '').trim().toLowerCase();
}

function buildSelectedPeriodStagedSortKey(source, context) {
    const ctx = context || {};
    const mode = normalizeTaskViewMode(ctx.viewMode || ctx.mode);
    const start = parseTaskCalendarISO(readAttributeValue(source, 'start'));
    const title = selectedPeriodStagedTitle(source);
    if (!start) return { missing: true, group: 2, distance: Number.POSITIVE_INFINITY, direction: 1, startDay: Number.POSITIVE_INFINITY, title };

    if (mode === 'WEEK') {
        const weekStartISO = getTaskWeekStartISO(ctx.selectedWeekStart);
        const weekStart = parseTaskCalendarISO(weekStartISO);
        const weekEnd = parseTaskCalendarISO(getTaskWeekEndISO(weekStartISO));
        if (!weekStart || !weekEnd) return { missing: false, group: 1, distance: 0, direction: 0, startDay: start.dayNumber, title };
        const selectedDayISO = parseTaskCalendarISO(ctx.selectedDay) ? clampTaskDayToWeek(ctx.selectedDay, weekStartISO) : weekStartISO;
        const selectedDay = parseTaskCalendarISO(selectedDayISO) || weekStart;
        if (start.dayNumber >= weekStart.dayNumber && start.dayNumber <= weekEnd.dayNumber) {
            return { missing: false, group: 0, distance: Math.abs(start.dayNumber - selectedDay.dayNumber), direction: start.dayNumber <= selectedDay.dayNumber ? 0 : 1, startDay: start.dayNumber, title };
        }
        const beforeWeek = start.dayNumber < weekStart.dayNumber;
        return { missing: false, group: 1, distance: beforeWeek ? weekStart.dayNumber - start.dayNumber : start.dayNumber - weekEnd.dayNumber, direction: beforeWeek ? 0 : 1, startDay: start.dayNumber, title };
    }

    const selectedDay = parseTaskCalendarISO(ctx.selectedDay);
    if (!selectedDay) return { missing: false, group: 1, distance: 0, direction: 0, startDay: start.dayNumber, title };
    return { missing: false, group: 0, distance: Math.abs(start.dayNumber - selectedDay.dayNumber), direction: start.dayNumber <= selectedDay.dayNumber ? 0 : 1, startDay: start.dayNumber, title };
}

function compareSelectedPeriodStagedSortKeys(left, right) {
    return (Number(left.missing) - Number(right.missing)) ||
        (left.group - right.group) ||
        (left.distance - right.distance) ||
        (left.direction - right.direction) ||
        (left.startDay - right.startDay) ||
        left.title.localeCompare(right.title);
}

function compareSelectedPeriodStagedRecords(left, right, context) {
    return compareSelectedPeriodStagedSortKeys(buildSelectedPeriodStagedSortKey(left, context), buildSelectedPeriodStagedSortKey(right, context));
}

function formatTaskWeekdayShort(dayNumber) {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const index = (((Number(dayNumber) + 4) % 7) + 7) % 7;
    return names[index] || '';
}

function formatSelectedPeriodStagedStartText(start, weekStart, weekEnd, today) {
    if (!start || !weekStart || !weekEnd) return '';
    if (start.dayNumber < weekStart.dayNumber) return (weekStart.dayNumber - start.dayNumber) + 'd late';
    if (start.dayNumber > weekEnd.dayNumber) return 'Starts in ' + (start.dayNumber - weekEnd.dayNumber) + 'd';
    if (today && start.dayNumber === today.dayNumber) return 'Start today';
    if (today && start.dayNumber === today.dayNumber + 1) return 'Start tomorrow';
    return 'Start ' + formatTaskWeekdayShort(start.dayNumber);
}

function buildSelectedPeriodStagedStartText(source, context) {
    const ctx = context || {};
    const mode = normalizeTaskViewMode(ctx.viewMode || ctx.mode);
    const start = parseTaskCalendarISO(readAttributeValue(source, 'start'));
    if (!start || mode !== 'WEEK') return '';

    const weekStartISO = getTaskWeekStartISO(ctx.selectedWeekStart);
    const weekStart = parseTaskCalendarISO(weekStartISO);
    const weekEnd = parseTaskCalendarISO(getTaskWeekEndISO(weekStartISO));
    const today = parseTaskCalendarISO(ctx.today);
    return formatSelectedPeriodStagedStartText(start, weekStart, weekEnd, today);
}

function buildSelectedPeriodStagedDueText(source, context) {
    return buildSelectedPeriodStagedStartText(source, context); // CHANGE: compatibility alias for older tests/extensions
}

function buildStagedStartDateAllocationPatch(source, context) {
    const ctx = context || {};
    const weekStart = getTaskWeekStartISO(ctx.selectedWeekStart);
    const assignedDay = clampTaskStartToVisibleWeek(source, weekStart);
    if (!assignedDay) return null;
    return {
        attributes: {
            [TASK_WORKFLOW_STATE_ATTR]: 'TODO',
            [TASK_ASSIGNED_DAY_ATTR]: assignedDay,
            [TASK_SCHEDULER_DATES_LOCKED_ATTR]: '1',
            [TASK_INCOMPLETE_DAY_ATTR]: null,
            [TASK_MANUAL_STAGED_ATTR]: null,
            completed: null
        }
    };
}

// -------------------- Pure task policy: schedule geometry and work hours --------------------
function snapScheduleMinutes(value, fallback) {
    const numeric = Number(value);
    const base = Number.isFinite(numeric) ? numeric : fallback;
    if (!Number.isFinite(base)) return null;
    return Math.max(0, Math.round(base / SCHEDULE_MINUTE_SNAP) * SCHEDULE_MINUTE_SNAP);
}

function scheduleMinutesToPx(minutes) {
    const snapped = snapScheduleMinutes(minutes, SCHEDULE_MINUTE_SNAP);
    return Math.max(SCHEDULE_MIN_CARD_HEIGHT, Math.round((snapped / 60) * SCHEDULE_PX_PER_HOUR));
}

function schedulePxToMinutes(px) {
    const numeric = Number(px);
    const minutes = Number.isFinite(numeric) ? (numeric / SCHEDULE_PX_PER_HOUR) * 60 : SCHEDULE_MINUTE_SNAP;
    return Math.max(SCHEDULE_MINUTE_SNAP, snapScheduleMinutes(minutes, SCHEDULE_MINUTE_SNAP));
}

    function scheduleMinuteOffsetToPx(minutes) {
        const numeric = Number(minutes);
        return Math.max(0, Math.round(((Number.isFinite(numeric) ? numeric : 0) / 60) * SCHEDULE_PX_PER_HOUR));
    }

    function schedulePxDeltaToMinutes(px) {
        const numeric = Number(px);
        if (!Number.isFinite(numeric) || numeric === 0) return 0;
        return Math.round((numeric / SCHEDULE_PX_PER_HOUR) * (60 / SCHEDULE_MINUTE_SNAP)) * SCHEDULE_MINUTE_SNAP;
    }

function getDateScopedScheduleOrder(source, visibleDay) {
    if (!parseTaskCalendarISO(visibleDay)) return null;
    const orderDay = String(readAttributeValue(source, TASK_SCHEDULE_ORDER_DAY_ATTR) || '').trim();
    if (orderDay !== visibleDay) return null;
    const order = Number(readAttributeValue(source, TASK_SCHEDULE_ORDER_ATTR));
    return Number.isFinite(order) && order >= 0 ? order : null;
}

function compareDateScopedScheduleOrderRecords(left, right, visibleDay) {
    const leftOrder = getDateScopedScheduleOrder(left && left.source, visibleDay);
    const rightOrder = getDateScopedScheduleOrder(right && right.source, visibleDay);
    const leftFallback = Number(left && left.fallbackIndex);
    const rightFallback = Number(right && right.fallbackIndex);
    const leftResolved = leftOrder != null ? leftOrder : (Number.isFinite(leftFallback) ? leftFallback : 0);
    const rightResolved = rightOrder != null ? rightOrder : (Number.isFinite(rightFallback) ? rightFallback : 0);
    if (leftResolved !== rightResolved) return leftResolved - rightResolved;
    const fallbackDiff = (Number.isFinite(leftFallback) ? leftFallback : 0) - (Number.isFinite(rightFallback) ? rightFallback : 0);
    if (fallbackDiff) return fallbackDiff;
    return String(left && left.id || '').localeCompare(String(right && right.id || ''));
}

function normalizeWeekDayLaneWidth(value, fallback) {
    const numeric = Number(value);
    const base = Number.isFinite(numeric) ? numeric : fallback;
    return Math.max(MIN_DAY_LANE_WIDTH, Math.round(Number.isFinite(base) ? base : DEFAULT_DAY_LANE_WIDTH));
}

function normalizeWeekDayLaneWidths(value, fallbackWidth) {
    const parsed = typeof value === 'string' ? parseJsonObject(value) : value;
    const source = parsed && typeof parsed === 'object' ? parsed : {};
    const rawWidths = source.widths && typeof source.widths === 'object' ? source.widths : source;
    const fallback = normalizeWeekDayLaneWidth(fallbackWidth, DEFAULT_DAY_LANE_WIDTH);
    const out = {};
    WEEK_DAY_LANE_KEYS.forEach(laneKey => {
        out[laneKey] = normalizeWeekDayLaneWidth(rawWidths[laneKey], fallback);
    });
    return out;
}

function serializeWeekDayLaneWidths(widths) {
    return JSON.stringify({ schemaVersion: 1, widths: normalizeWeekDayLaneWidths(widths, DEFAULT_DAY_LANE_WIDTH) });
}

function normalizeNonDayLaneWidth(value, fallback) {
    return normalizeWeekDayLaneWidth(value, fallback); // NEW: non-day lanes share the board lane width floor
}

function normalizeNonDayLaneWidths(value, fallbackWidth) {
    const parsed = typeof value === 'string' ? parseJsonObject(value) : value;
    const source = parsed && typeof parsed === 'object' ? parsed : {};
    const rawWidths = source.widths && typeof source.widths === 'object' ? source.widths : source;
    const fallback = normalizeNonDayLaneWidth(fallbackWidth, DEFAULT_DAY_LANE_WIDTH);
    const out = {};
    KANBAN_LANE_DEFS.forEach(lane => {
        if (!lane || WEEK_DAY_LANE_KEYS.indexOf(String(lane.key || '')) >= 0) return;
        out[lane.key] = normalizeNonDayLaneWidth(rawWidths[lane.key], fallback);
    });
    return out;
}

function serializeNonDayLaneWidths(widths) {
    return JSON.stringify({ schemaVersion: 1, widths: normalizeNonDayLaneWidths(widths, DEFAULT_DAY_LANE_WIDTH) });
}

function normalizeWeekBoardHeight(value, fallback) {
    const numeric = Number(value);
    const base = Number.isFinite(numeric) ? numeric : fallback;
    return Math.max(SCHEDULE_MIN_CARD_HEIGHT, Math.round(Number.isFinite(base) ? base : SCHEDULE_MIN_CARD_HEIGHT));
}

function normalizeWeekBoardHeights(value) {
    const parsed = typeof value === 'string' ? parseJsonObject(value) : value;
    const source = parsed && typeof parsed === 'object' ? parsed : {};
    const rawWeeks = source.weeks && typeof source.weeks === 'object' ? source.weeks : source;
    const out = {};
    Object.keys(rawWeeks || {}).forEach(weekStart => {
        if (!parseTaskCalendarISO(weekStart)) return;
        out[weekStart] = normalizeWeekBoardHeight(rawWeeks[weekStart], SCHEDULE_MIN_CARD_HEIGHT);
    });
    return out;
}

function serializeWeekBoardHeights(heights) {
    return JSON.stringify({ schemaVersion: 1, weeks: normalizeWeekBoardHeights(heights) });
}

function formatScheduleClockMinute(totalMinutes) {
    const total = Math.max(0, Math.round(Number(totalMinutes) || 0));
    const dayOffset = Math.floor(total / 1440);
    const minuteOfDay = total % 1440;
    const hour24 = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;
    const suffix = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 % 12 || 12;
    return hour12 + ':' + String(minute).padStart(2, '0') + ' ' + suffix + (dayOffset > 0 ? '+' + dayOffset + 'd' : '');
}

function formatScheduleTimeRange(startMinute, durationMinutes) {
    if (startMinute == null || startMinute === '' || durationMinutes == null || durationMinutes === '') return '';
    const start = snapScheduleMinutes(startMinute, null);
    const duration = snapScheduleMinutes(durationMinutes, null);
    if (start == null || duration == null || duration <= 0) return '';
    return formatScheduleClockMinute(start) + '-' + formatScheduleClockMinute(start + duration);
}

function normalizeWorkHourWindow(day) {
    const source = day && typeof day === 'object' ? day : {};
    const closed = source.closed === true || source.closed === '1' || source.mode === 'closed';
    const startMinute = Math.min(1440, snapScheduleMinutes(source.startMinute ?? source.start, DEFAULT_WORK_START_MINUTE));
    const rawEnd = Math.min(1440, snapScheduleMinutes(source.endMinute ?? source.end, DEFAULT_WORK_END_MINUTE));
    const endMinute = rawEnd > startMinute ? rawEnd : Math.min(1440, startMinute + 60);
    return { closed, startMinute, endMinute };
}

function normalizeWeekWorkHours(value, fallback) {
    const source = value && typeof value === 'object' ? value : {};
    const fallbackDays = Array.isArray(fallback) ? fallback : null;
    const rawDays = Array.isArray(source.days) ? source.days : (Array.isArray(value) ? value : []);
    const days = [];
    for (let i = 0; i < WEEK_DAY_LANE_KEYS.length; i += 1) {
        const fallbackDay = fallbackDays && fallbackDays[i] ? fallbackDays[i] : null;
        const rawDay = rawDays[i] && typeof rawDays[i] === 'object' ? rawDays[i] : null;
        days.push(normalizeWorkHourWindow(rawDay && fallbackDay ? Object.assign({}, fallbackDay, rawDay) : (rawDay || fallbackDay || null)));
    }
    return days;
}

function defaultWeekWorkHours() {
    return normalizeWeekWorkHours({ days: DEFAULT_WEEK_WORK_HOUR_WINDOWS }); // CHANGE: new boards use realistic home-gardener availability
}

function parseJsonObject(value) {
    if (!value) return null;
    try {
        const parsed = JSON.parse(String(value));
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
        return null;
    }
}

function serializeWeekWorkHours(days) {
    return JSON.stringify({ schemaVersion: 1, days: normalizeWeekWorkHours(days) });
}

function resolveWeekWorkHours(defaultsValue, overridesValue, weekStartISO) {
    const defaults = normalizeWeekWorkHours(parseJsonObject(defaultsValue));
    const overridesRoot = parseJsonObject(overridesValue) || {};
    const byWeek = overridesRoot.weeks && typeof overridesRoot.weeks === 'object' ? overridesRoot.weeks : overridesRoot;
    const weekOverride = parseTaskCalendarISO(weekStartISO) ? byWeek[weekStartISO] : null;
    return normalizeWeekWorkHours(weekOverride, defaults);
}

function workWindowDurationMinutes(dayWindow) {
    const window = normalizeWorkHourWindow(dayWindow);
    return window.closed ? 0 : Math.max(0, window.endMinute - window.startMinute);
}

function buildWeekTimeScale(days) {
    const sourceDays = Array.isArray(days) ? days : [];
    const week = WEEK_DAY_LANE_KEYS.map((_laneKey, index) => sourceDays[index] ? normalizeWorkHourWindow(sourceDays[index]) : { closed: true, startMinute: DEFAULT_WORK_START_MINUTE, endMinute: DEFAULT_WORK_START_MINUTE });
    const openDays = week.filter(day => day && !day.closed);
    if (!openDays.length) return { active: false, startMinute: null, endMinute: null, durationMinutes: 0, hourMarks: [] };
    const earliest = openDays.reduce((min, day) => Math.min(min, day.startMinute), 1440);
    const latest = openDays.reduce((max, day) => Math.max(max, day.endMinute), 0);
    const startMinute = Math.max(0, Math.floor(earliest / 60) * 60);
    const endMinute = Math.min(1440, Math.ceil(latest / 60) * 60);
    const marks = [];
    for (let minute = startMinute; minute <= endMinute; minute += 60) marks.push(minute);
    return { active: true, startMinute, endMinute, durationMinutes: Math.max(0, endMinute - startMinute), hourMarks: marks };
}

function getWeekTimeScaleOffsetPx(dayWindow, timeScale) {
    const window = normalizeWorkHourWindow(dayWindow);
    if (!timeScale || !timeScale.active || window.closed) return 0;
    return scheduleMinuteOffsetToPx(Math.max(0, window.startMinute - timeScale.startMinute));
}

function defaultScheduleDurationFromHours(value) {
    const hours = Number(value);
    if (!Number.isFinite(hours) || hours <= 0) return 60;
    return Math.max(SCHEDULE_MINUTE_SNAP, snapScheduleMinutes(hours * 60, 60));
}

function isScheduleBreakSource(source) {
    return String(readAttributeValue(source, TASK_SCHEDULE_BREAK_ATTR) || '') === '1';
}

function resolveStackScheduleDuration(record) {
    const source = record && record.source;
    const existingDuration = snapScheduleMinutes(readAttributeValue(source, TASK_SCHEDULE_DURATION_MINUTES_ATTR), null);
    const rawHeight = Number(record && record.height);
    const hasUsableHeight = Number.isFinite(rawHeight) && rawHeight > 0;
    const heightDuration = hasUsableHeight ? schedulePxToMinutes(rawHeight) : null;
    if (existingDuration) return heightDuration || existingDuration;
    if (isScheduleBreakSource(source)) return heightDuration || 30;
    return defaultScheduleDurationFromHours(readAttributeValue(source, 'task_estimated_hours')) || heightDuration || 60;
}

function buildStackSchedulePlan(records, dayWindow) {
    const window = normalizeWorkHourWindow(dayWindow);
    const startMinute = window.startMinute;
    let cursor = startMinute;
    const items = [];
    for (const record of (Array.isArray(records) ? records : [])) {
        const duration = resolveStackScheduleDuration(record);
        const item = {
            id: record && record.id,
            startMinute: cursor,
            durationMinutes: duration,
            endMinute: cursor + duration,
            height: scheduleMinutesToPx(duration),
            overflow: !window.closed && cursor + duration > window.endMinute
        };
        items.push(item);
        cursor += duration;
    }
    return {
        closed: window.closed,
        startMinute,
        endMinute: window.endMinute,
        items,
        overflowMinutes: window.closed ? 0 : Math.max(0, cursor - window.endMinute),
        contentEndMinute: cursor
    };
}

// -------------------- Pure task policy: attribute access and kanban parenting --------------------
function readAttributeValue(source, key) { // CHANGE: supports XML cells and plain objects in reliability tests
    if (source && typeof source.getAttribute === 'function') return source.getAttribute(key);
    return source && Object.prototype.hasOwnProperty.call(source, key) ? source[key] : null;
}

function isKnownKanbanLaneKey(laneKey, laneKeys) { // NEW: policy accepts only canonical lane types
    const keys = Array.isArray(laneKeys) ? laneKeys : KANBAN_LANE_KEYS;
    return keys.includes(String(laneKey || ''));
}

function getKanbanCellType(source, laneKeys) { // NEW: pure classifier for board/lane/card parenting policy
    const boardKey = String(readAttributeValue(source, 'board_key') || '');
    if (boardKey === KANBAN_BOARD_KEY || boardKey === LEGACY_KANBAN_BOARD_KEY) return 'board';
    if (isKnownKanbanLaneKey(readAttributeValue(source, 'lane_key'), laneKeys)) return 'lane';
    if (String(readAttributeValue(source, 'kanban_card') || '') === '1') return 'card';
    return 'other';
}

function isScheduleBreakPolicySource(source) { // NEW: pure policy check keeps break cards out of non-schedule lanes
    return String(readAttributeValue(source, TASK_SCHEDULE_BREAK_ATTR) || '') === '1';
}

function isSameKanbanPolicyCell(left, right) { // NEW: ignore the moved lane itself when checking duplicates
    if (left === right) return true;
    const leftId = left && left.id != null ? String(left.id) : '';
    const rightId = right && right.id != null ? String(right.id) : '';
    return !!leftId && leftId === rightId;
}

function hasDuplicateKanbanLaneSibling(parent, child, siblings, laneKeys) { // NEW: boards may contain one lane per type
    const childLaneKey = String(readAttributeValue(child, 'lane_key') || '');
    if (!childLaneKey || !isKnownKanbanLaneKey(childLaneKey, laneKeys)) return false;
    return (Array.isArray(siblings) ? siblings : []).some(sibling =>
        !isSameKanbanPolicyCell(sibling, child) &&
        getKanbanCellType(sibling, laneKeys) === 'lane' &&
        String(readAttributeValue(sibling, 'lane_key') || '') === childLaneKey
    );
}

function canParentKanbanCell(parent, child, opts) { // NEW: single source of truth for kanban parent-child legality
    const laneKeys = opts && opts.laneKeys;
    const siblings = opts && opts.siblings;
    const parentType = getKanbanCellType(parent, laneKeys);
    const childType = getKanbanCellType(child, laneKeys);

    if (parentType === 'board') {
        return childType === 'lane' && !hasDuplicateKanbanLaneSibling(parent, child, siblings, laneKeys);
    }
    if (parentType === 'lane') {
        if (String(readAttributeValue(parent, 'lane_key') || '') === 'TODO_STAGED' && isScheduleBreakPolicySource(child)) return false;
        return childType === 'card';
    }
    if (childType === 'lane' || childType === 'card') return false;
    return true;
}

// -------------------- Pure task policy: card metadata and scheduler sync --------------------
function normalizeCardNote(value) { // NEW: normalize badge text and truncate by Unicode code point
    const collapsed = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return Array.from(collapsed).slice(0, CARD_NOTE_MAX_LENGTH).join('');
}

function normalizeTaskAssigneeRoleIds(value) { // NEW: tolerate malformed external data without mutating it
    let source = value;
    if (typeof source === 'string') {
        if (!source.trim()) return [];
        try { source = JSON.parse(source); } catch (_) { return []; }
    }
    if (!Array.isArray(source)) return [];
    return Array.from(new Set(source.map(id => String(id == null ? '' : id).trim()).filter(Boolean))).sort();
}

function serializeTaskAssigneeRoleIds(value) { // NEW: one stable persisted representation
    const ids = normalizeTaskAssigneeRoleIds(value);
    return ids.length ? JSON.stringify(ids) : null;
}

function hasTaskAssignees(source) {
    return normalizeTaskAssigneeRoleIds(readAttributeValue(source, TASK_ASSIGNEE_ROLE_IDS_ATTR)).length > 0;
}

function buildCardNotePatch(source, note) { // NEW: empty notes remove only the user annotation attribute
    const currentRaw = String(readAttributeValue(source, CARD_NOTE_ATTR) || '');
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

function getTaskDateRange(source, startKey = 'start', endKey = 'end') {
    const startISO = String(readAttributeValue(source, startKey) || '').trim();
    const endISO = String(readAttributeValue(source, endKey) || '').trim();
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

function buildSchedulerTaskMetadataAttributes(task) {
    const source = task && typeof task === 'object' ? task : {};
    const attrs = {};
    const taskTypeId = String(source.task_type_id || source.taskTypeId || '').trim();
    if (taskTypeId) attrs.task_type_id = taskTypeId;
    const schedulerRuleId = String(source.scheduler_rule_id || source.schedulerRuleId || source.rule_id || '').trim();
    if (schedulerRuleId) attrs.scheduler_rule_id = schedulerRuleId;
    const schedulerAnchorStage = String(source.scheduler_anchor_stage || source.schedulerAnchorStage || source.startAnchorStage || '').trim();
    if (schedulerAnchorStage) attrs.scheduler_anchor_stage = schedulerAnchorStage;
    const schedulerMethodCategoryId = String(source.scheduler_method_category_id || source.schedulerMethodCategoryId || source.methodCategoryId || '').trim();
    if (schedulerMethodCategoryId) attrs.scheduler_method_category_id = schedulerMethodCategoryId;
    const schedulerMethodId = String(source.scheduler_method_id || source.schedulerMethodId || source.methodId || '').trim();
    if (schedulerMethodId) attrs.scheduler_method_id = schedulerMethodId;
    const schedulerTaskKey = String(source.scheduler_task_key || source.schedulerTaskKey || '').trim();
    if (schedulerTaskKey) attrs.scheduler_task_key = schedulerTaskKey;
    const schedulerOccurrenceIndex = source.scheduler_occurrence_index ?? source.schedulerOccurrenceIndex;
    if (schedulerOccurrenceIndex !== undefined && schedulerOccurrenceIndex !== null && schedulerOccurrenceIndex !== '') attrs.scheduler_occurrence_index = String(schedulerOccurrenceIndex);
    return attrs;
}

function getSchedulerTaskKey(source) {
    return String(readAttributeValue(source, 'scheduler_task_key') || '').trim();
}

function buildGeneratedTaskSyncAttributes(task) {
    const source = task && typeof task === 'object' ? task : {};
    const attrs = {
        title: String(source.title || 'Task'),
        notes: source.notes ? String(source.notes) : null,
        method: source.method ? String(source.method) : null,
        plant_name: source.plant_name ? String(source.plant_name) : null,
        variety_name: source.variety_name ? String(source.variety_name) : null,
        date_override: null
    };
    const dates = buildInitialCardDateAttributes(source.startISO, source.endISO);
    if (dates) Object.assign(attrs, dates);
    Object.assign(attrs, buildSchedulerTaskMetadataAttributes(source));
    return attrs;
}

function buildGeneratedTaskSyncAttributesForExisting(existingSource, task) {
    const attrs = buildGeneratedTaskSyncAttributes(task);
    attrs[TASK_SCHEDULER_MISSING_ATTR] = null;
    if (isSchedulerDateLocked(existingSource)) {
        delete attrs.start;
        delete attrs.end;
        delete attrs.base_start;
        delete attrs.base_end;
        delete attrs.date_override;
    }
    return attrs;
}

function generatedTaskAttributesDiffer(existingSource, task) {
    const attrs = buildGeneratedTaskSyncAttributesForExisting(existingSource, task);
    return Object.keys(attrs).some(key => {
        const nextValue = attrs[key] == null ? null : String(attrs[key]);
        const current = readAttributeValue(existingSource, key);
        const currentValue = current == null ? null : String(current);
        return currentValue !== nextValue;
    });
}

function hasDuplicateSchedulerKeys(items, readKey) {
    const seen = new Set();
    for (const item of items || []) {
        const key = readKey(item);
        if (!key) continue;
        if (seen.has(key)) return true;
        seen.add(key);
    }
    return false;
}

function planDifferentialTaskSync(existingRecords, tasks) {
    const existing = Array.isArray(existingRecords) ? existingRecords : [];
    const incoming = Array.isArray(tasks) ? tasks : [];
    const taskKey = task => String(task?.scheduler_task_key || task?.schedulerTaskKey || '').trim();
    const existingKey = record => String(record?.schedulerTaskKey || getSchedulerTaskKey(record?.source || record) || '').trim();
    if (incoming.some(task => !taskKey(task))) return { legacyReplace: true, creates: [], updates: [], removes: [], missing: [], unchanged: [] };
    if (existing.some(record => !existingKey(record))) return { legacyReplace: true, creates: [], updates: [], removes: [], missing: [], unchanged: [] };
    if (hasDuplicateSchedulerKeys(incoming, taskKey) || hasDuplicateSchedulerKeys(existing, existingKey)) return { legacyReplace: true, creates: [], updates: [], removes: [], missing: [], unchanged: [] };
    const existingByKey = new Map(existing.map(record => [existingKey(record), record]));
    const incomingKeys = new Set(incoming.map(taskKey));
    const creates = [];
    const updates = [];
    const unchanged = [];
    const missing = [];
    for (const task of incoming) {
        const key = taskKey(task);
        const record = existingByKey.get(key);
        if (!record) {
            creates.push({ key, task });
            continue;
        }
        const source = record.source || record;
        if (generatedTaskAttributesDiffer(source, task)) updates.push({ key, record, task });
        else unchanged.push({ key, record, task });
    }
    const removes = existing
        .filter(record => !incomingKeys.has(existingKey(record)))
        .filter(record => {
            if (!isUserTouchedSchedulerRecord(record)) return true;
            missing.push({ key: existingKey(record), record });
            return false;
        })
        .map(record => ({ key: existingKey(record), record }));
    return { legacyReplace: false, creates, updates, removes, missing, unchanged };
}

function planTaskAssignmentReplacement(existingRecords, tasks) { // NEW: full regeneration maps assignments only across unambiguous stable occurrence identities
    const existing = Array.isArray(existingRecords) ? existingRecords : [];
    const incoming = Array.isArray(tasks) ? tasks : [];
    const existingKey = record => String(record && (record.schedulerTaskKey || getSchedulerTaskKey(record.source || record)) || '').trim();
    const incomingKey = task => String(task && (task.scheduler_task_key || task.schedulerTaskKey) || '').trim();
    const countKeys = (items, readKey) => {
        const counts = new Map();
        items.forEach(item => { const key = readKey(item); if (key) counts.set(key, (counts.get(key) || 0) + 1); });
        return counts;
    };
    const existingCounts = countKeys(existing, existingKey);
    const incomingCounts = countKeys(incoming, incomingKey);
    const preserved = [];
    const retainMissing = [];
    existing.forEach(record => {
        const source = record && (record.source || record);
        const roleIds = normalizeTaskAssigneeRoleIds(readAttributeValue(source, TASK_ASSIGNEE_ROLE_IDS_ATTR));
        if (!roleIds.length) return;
        const key = existingKey(record);
        if (key && existingCounts.get(key) === 1 && incomingCounts.get(key) === 1) preserved.push({ key, roleIds });
        else retainMissing.push(record); // NEW: unsafe mappings remain explicit instead of silently losing user assignments
    });
    return { preserved, retainMissing };
}

function buildCardDateOverridePatch(source, newStartISO) { // NEW: pure patch builder keeps mutation orchestration small
    const current = getTaskDateRange(source);
    const nextStart = parseTaskCalendarISO(newStartISO);
    if (!current || !nextStart) return null;
    if (current.startISO === String(newStartISO).trim()) return { changed: false };

    const nextEndISO = shiftTaskCalendarISO(String(newStartISO).trim(), current.durationDays);
    if (!nextEndISO) return null;

    // Legacy cards capture their current valid dates as the baseline on first edit.
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

function buildCardDateResetPatch(source) {
    const baseline = getTaskDateRange(source, 'base_start', 'base_end');
    if (!baseline) return null;

    return {
        start: baseline.startISO,
        end: baseline.endISO,
        date_override: null,
        [TASK_MANUAL_STAGED_ATTR]: null
    };
}

// -------------------- Pure task policy: repeat visibility --------------------
function normalizeRepeatIdentityText(value) { // NEW: repeat identity uses stable case-insensitive text fields
    return String(value == null ? '' : value).trim().toLowerCase();
}

function normalizeRepeatLinkedIds(value) { // NEW: link order must not split otherwise identical repeat series
    return Array.from(new Set(String(value == null ? '' : value)
        .split(',')
        .map(id => id.trim())
        .filter(Boolean)))
        .sort();
}

function buildRepeatSeriesKey(source) { // NEW: dates intentionally do not participate in repeat identity
    const linkedIds = normalizeRepeatLinkedIds(readAttributeValue(source, 'linkedTo'));
    if (linkedIds.length === 0) return null; // NEW: unlinked cards cannot form a reliable series

    return JSON.stringify([ // NEW: structured encoding prevents delimiter collisions
        linkedIds,
        normalizeRepeatIdentityText(readAttributeValue(source, 'plant_name')),
        normalizeRepeatIdentityText(readAttributeValue(source, 'method')),
        normalizeRepeatIdentityText(readAttributeValue(source, 'title'))
    ]);
}

function compareRepeatCalendarValues(left, right) { // NEW: valid dates sort before missing or malformed dates
    const leftDate = parseTaskCalendarISO(left);
    const rightDate = parseTaskCalendarISO(right);
    if (leftDate && rightDate) return leftDate.dayNumber - rightDate.dayNumber;
    if (leftDate) return -1;
    if (rightDate) return 1;
    return 0;
}

function compareRepeatOccurrenceRecords(left, right) { // NEW: deterministic representative and badge ordering
    return compareRepeatCalendarValues(left && left.startISO, right && right.startISO) ||
        compareRepeatCalendarValues(left && left.endISO, right && right.endISO) ||
        String(left && left.id || '').localeCompare(String(right && right.id || ''));
}

function isCardVisibilityEligible(source) { // NEW: paging and lane counts share the same derived visibility rule
    return readAttributeValue(source, 'year_hidden') !== '1' &&
        readAttributeValue(source, 'repeat_hidden') !== '1';
}

const TASK_LANE_HEADER_HEIGHT = 40; // NEW: stable two-line title band for every non-day lane
const TASK_LANE_STACK_BORDER = 20; // NEW: matches the canonical Draw.io stack layout inset
const TASK_LANE_PAGER_MARGIN_TOP = 20; // NEW: reserves a 28px pager row without narrowing cards
const TASK_LANE_STACK_SPACING = 20; // NEW: matches LANE_STYLE_BASE stackSpacing
const TASK_LANE_MIN_CARD_HEIGHT = DEFAULT_TASK_CARD_HEIGHT; // CHANGE: full task cards must never be clamped below the standard 80px height
const TASK_LANE_MIN_HEIGHT = 126; // NEW: shared full and week non-day lane minimum

/**
 * Builds deterministic contiguous pages from authored card heights.
 * The returned heights are the only values that may be persisted as clamps.
 */
function buildTaskLanePagePlan(cardHeights, laneHeight) {
    const normalizedLaneHeight = Math.max(TASK_LANE_MIN_HEIGHT, Math.round(Number(laneHeight) || TASK_LANE_MIN_HEIGHT));
    const inputHeights = Array.isArray(cardHeights) ? cardHeights : [];
    const normalizedHeights = inputHeights.map(height => Math.max(TASK_LANE_MIN_CARD_HEIGHT, Math.round(Number(height) || DEFAULT_TASK_CARD_HEIGHT)));
    const unpagedUsableHeight = Math.max(TASK_LANE_MIN_CARD_HEIGHT, normalizedLaneHeight - TASK_LANE_HEADER_HEIGHT - (TASK_LANE_STACK_BORDER * 2));
    const unpagedHeights = normalizedHeights.map(height => Math.min(height, unpagedUsableHeight));
    const stackHeight = heights => heights.reduce((total, height) => total + height, 0) + Math.max(0, heights.length - 1) * TASK_LANE_STACK_SPACING;

    if (stackHeight(unpagedHeights) <= unpagedUsableHeight) {
        return Object.freeze({
            paged: false,
            heights: Object.freeze(unpagedHeights),
            pages: Object.freeze([{ start: 0, end: unpagedHeights.length }]),
            usableHeight: unpagedUsableHeight,
            pagerMarginTop: 0
        });
    }

    const pagedUsableHeight = Math.max(TASK_LANE_MIN_CARD_HEIGHT, unpagedUsableHeight - TASK_LANE_PAGER_MARGIN_TOP);
    const pagedHeights = normalizedHeights.map(height => Math.min(height, pagedUsableHeight));
    const pages = [];
    let pageStart = 0;
    let pageHeight = 0;
    pagedHeights.forEach((height, index) => {
        const nextHeight = pageHeight === 0 ? height : pageHeight + TASK_LANE_STACK_SPACING + height;
        if (pageHeight > 0 && nextHeight > pagedUsableHeight) {
            pages.push(Object.freeze({ start: pageStart, end: index }));
            pageStart = index;
            pageHeight = height;
        } else {
            pageHeight = nextHeight;
        }
    });
    pages.push(Object.freeze({ start: pageStart, end: pagedHeights.length }));

    return Object.freeze({
        paged: true,
        heights: Object.freeze(pagedHeights),
        pages: Object.freeze(pages),
        usableHeight: pagedUsableHeight,
        pagerMarginTop: TASK_LANE_PAGER_MARGIN_TOP
    });
}

function planRepeatSeriesVisibility(records) { // NEW: pure planner keeps board mutation orchestration small
    const input = Array.isArray(records) ? records : [];
    const plannedById = new Map();
    const groupsByKey = new Map();

    input.forEach(record => {
        const id = String(record && record.id || '');
        plannedById.set(id, { // NEW: defaults also clear stale derived repeat state
            id,
            repeating: false,
            repeatHidden: false,
            repeatBadge: ''
        });

        const key = record && record.seriesKey;
        if (!key) return;
        if (!groupsByKey.has(key)) groupsByKey.set(key, []);
        groupsByKey.get(key).push(record);
    });

    groupsByKey.forEach(group => {
        const eligible = group
            .filter(record => !(record && record.yearHidden))
            .slice()
            .sort(compareRepeatOccurrenceRecords);
        if (eligible.length < 2) return; // NEW: one eligible occurrence is not rendered as a repeat series

        const expanded = group.some(record => !!(record && record.expanded));
        const indexById = new Map();
        eligible.forEach((record, index) => indexById.set(String(record.id || ''), index));

        if (expanded) {
            eligible.forEach(record => {
                const id = String(record.id || '');
                plannedById.set(id, {
                    id,
                    repeating: true,
                    repeatHidden: false,
                    repeatBadge: `${indexById.get(id) + 1}/${eligible.length}`
                });
            });
            return;
        }

        const recordsByLane = new Map();
        eligible.forEach(record => {
            const laneKey = String(record.laneKey || '');
            if (!recordsByLane.has(laneKey)) recordsByLane.set(laneKey, []);
            recordsByLane.get(laneKey).push(record);
        });

        recordsByLane.forEach(laneRecords => {
            const orderedLaneRecords = laneRecords.slice().sort(compareRepeatOccurrenceRecords);
            orderedLaneRecords.forEach((record, laneIndex) => {
                const id = String(record.id || '');
                const hiddenInLane = orderedLaneRecords.length - 1;
                plannedById.set(id, {
                    id,
                    repeating: true,
                    repeatHidden: laneIndex > 0,
                    repeatBadge: laneIndex === 0
                        ? `${indexById.get(id) + 1}/${eligible.length}${hiddenInLane > 0 ? ` +${hiddenInLane}` : ''}`
                        : ''
                });
            });
        });
    });

    return input.map(record => plannedById.get(String(record && record.id || '')));
}

function isEditableCardDateLane(laneKey) {
    return EDITABLE_CARD_DATE_LANES.has(String(laneKey || ''));
}

const TASK_REFLOW_SCOPE_NAMES = Object.freeze(['full', 'classification', 'layout', 'lanes', 'badges']); // NEW: public scope names for board reflow callers
const TASK_REFLOW_COMMAND_SCOPES = Object.freeze({ // NEW: pure command-to-scope policy for tests and command routing
    boardNavigation: 'full',
    workflow: 'classification',
    drop: 'classification',
    dateEdit: 'classification',
    editHours: 'layout',
    dayLaneResize: 'layout',
    boardResize: 'layout',
    selection: 'badges',
    selectedPeriodStagedPaging: 'lanes',
    stagedBadgeRefresh: 'badges',
    noteEdit: 'badges'
});

function normalizeTaskReflowScopePlan(scope) { // NEW: folds requested scopes into pass flags while preserving conservative behavior
    const raw = scope == null || scope === ''
        ? ['full']
        : (Array.isArray(scope) ? scope : String(scope).split(/[,\s+]+/));
    const requested = raw.map(item => String(item || '').trim()).filter(Boolean);
    const valid = requested.filter(item => TASK_REFLOW_SCOPE_NAMES.indexOf(item) >= 0);
    const wantsFull = valid.length === 0 || valid.indexOf('full') >= 0;
    const wantsClassification = wantsFull || valid.indexOf('classification') >= 0;
    const wantsLayout = wantsFull || wantsClassification || valid.indexOf('layout') >= 0;
    const wantsLanes = wantsFull || wantsClassification || wantsLayout || valid.indexOf('lanes') >= 0;
    const wantsBadges = wantsFull || wantsClassification || wantsLayout || valid.indexOf('badges') >= 0;
    return Object.freeze({
        requested: wantsFull ? ['full'] : valid.slice(),
        full: wantsFull,
        classification: wantsClassification,
        lanes: wantsLanes,
        layout: wantsLayout,
        badges: wantsBadges
    });
}

function getTaskReflowScopeForCommand(commandName) { // NEW: single pure map for command categories that intentionally narrow reflow work
    return TASK_REFLOW_COMMAND_SCOPES[commandName] || 'full';
}

// -------------------- Pure core seams -------------------- // CHANGE: explicit internal policy boundaries without splitting this plugin file
const TaskPolicyCore = Object.freeze({
    parseTaskCalendarISO,
    shiftTaskCalendarISO,
    normalizeTaskViewMode,
    normalizeWorkflowState,
    getTaskWeekStartISO,
    getTaskWeekEndISO,
    isTaskDateInWeek,
    getWeekLaneKeyForDate,
    getDateForWeekLaneKey,
    clampTaskDayToWeek,
    clampTaskStartToVisibleWeek,
    shiftTaskDayWithinWeek,
    getTaskViewLaneKeys,
    normalizeTaskVisibleLaneKeys,
    serializeTaskVisibleLaneKeys,
    getTaskVisibleLaneKeysForMode,
    deriveWorkflowStateFromLaneKey,
    getEffectiveWorkflowState,
    isManualStagedSource,
    isPhysicallyOrManuallyStaged,
    isUserTouchedSchedulerCard,
    isUserTouchedSchedulerRecord,
    buildWorkflowPatch,
    buildIncompletePatch,
    decideTaskViewLaneKey,
    selectedPeriodStagedSortEnabled,
    buildSelectedPeriodStagedSortKey,
    compareSelectedPeriodStagedRecords,
    buildSelectedPeriodStagedStartText,
    buildSelectedPeriodStagedDueText,
    buildStagedStartDateAllocationPatch,
    normalizeTaskReflowScopePlan,
    getTaskReflowScopeForCommand
});

const SchedulePolicyCore = Object.freeze({
    snapScheduleMinutes,
    scheduleMinutesToPx,
    schedulePxToMinutes,
    scheduleMinuteOffsetToPx,
    schedulePxDeltaToMinutes,
    getDateScopedScheduleOrder,
    compareDateScopedScheduleOrderRecords,
    normalizeWeekDayLaneWidth,
    normalizeWeekDayLaneWidths,
    serializeWeekDayLaneWidths,
    normalizeNonDayLaneWidth,
    normalizeNonDayLaneWidths,
    serializeNonDayLaneWidths,
    normalizeWeekBoardHeight,
    normalizeWeekBoardHeights,
    serializeWeekBoardHeights,
    formatScheduleTimeRange,
    normalizeWorkHourWindow,
    normalizeWeekWorkHours,
    defaultWeekWorkHours,
    serializeWeekWorkHours,
    resolveWeekWorkHours,
    workWindowDurationMinutes,
    buildWeekTimeScale,
    getWeekTimeScaleOffsetPx,
    defaultScheduleDurationFromHours,
    buildStackSchedulePlan
});

const TASK_REFLOW_TEST_COUNTER_KEYS = Object.freeze(['classification', 'layout', 'lanes', 'badges', 'boardLayout', 'schedulePack', 'labelWriteSkip']);

function getTaskReflowTestCounters() { // NEW: test-only runtime instrumentation, never persisted on graph cells
    if (typeof globalThis === 'undefined' || !globalThis.__TRELLIS_TASK_MANAGER_TEST__) return null;
    const existing = globalThis.__TRELLIS_TASK_REFLOW_COUNTERS__;
    if (existing && typeof existing === 'object') return existing;
    const counters = {};
    TASK_REFLOW_TEST_COUNTER_KEYS.forEach(key => { counters[key] = 0; });
    globalThis.__TRELLIS_TASK_REFLOW_COUNTERS__ = counters;
    return counters;
}

function bumpTaskReflowTestCounter(key) {
    const counters = getTaskReflowTestCounters();
    if (!counters || TASK_REFLOW_TEST_COUNTER_KEYS.indexOf(key) < 0) return;
    counters[key] = (Number(counters[key]) || 0) + 1;
}

function snapshotTaskReflowTestCounters() {
    const counters = getTaskReflowTestCounters();
    const out = {};
    TASK_REFLOW_TEST_COUNTER_KEYS.forEach(key => { out[key] = counters ? Number(counters[key]) || 0 : 0; });
    return out;
}

function resetTaskReflowTestCounters() {
    const counters = getTaskReflowTestCounters();
    if (!counters) return snapshotTaskReflowTestCounters();
    TASK_REFLOW_TEST_COUNTER_KEYS.forEach(key => { counters[key] = 0; });
    return snapshotTaskReflowTestCounters();
}

// -------------------- Test hook surface --------------------
if (typeof globalThis !== 'undefined' && globalThis.__TRELLIS_TASK_MANAGER_TEST__) { // FIX: no runtime exposure unless tests opt in
    globalThis.__TRELLIS_TASK_MANAGER_TEST_HOOKS__ = {
        TaskPolicyCore, // CHANGE: grouped core seam exposed only to opt-in tests
        SchedulePolicyCore, // CHANGE: grouped core seam exposed only to opt-in tests
        normalizeTaskReplacementDetail,
        applyImmediateTaskReplacement,
        parseTaskCalendarISO: TaskPolicyCore.parseTaskCalendarISO,
        shiftTaskCalendarISO: TaskPolicyCore.shiftTaskCalendarISO,
        normalizeTaskViewMode: TaskPolicyCore.normalizeTaskViewMode,
        getTaskWeekStartISO: TaskPolicyCore.getTaskWeekStartISO,
        getTaskWeekEndISO: TaskPolicyCore.getTaskWeekEndISO,
        isTaskDateInWeek: TaskPolicyCore.isTaskDateInWeek,
        getWeekLaneKeyForDate: TaskPolicyCore.getWeekLaneKeyForDate,
        getDateForWeekLaneKey: TaskPolicyCore.getDateForWeekLaneKey,
        clampTaskDayToWeek: TaskPolicyCore.clampTaskDayToWeek,
        clampTaskStartToVisibleWeek: TaskPolicyCore.clampTaskStartToVisibleWeek,
        shiftTaskDayWithinWeek: TaskPolicyCore.shiftTaskDayWithinWeek,
        getTaskViewLaneKeys: TaskPolicyCore.getTaskViewLaneKeys,
        normalizeTaskVisibleLaneKeys: TaskPolicyCore.normalizeTaskVisibleLaneKeys,
        serializeTaskVisibleLaneKeys: TaskPolicyCore.serializeTaskVisibleLaneKeys,
        getTaskVisibleLaneKeysForMode: TaskPolicyCore.getTaskVisibleLaneKeysForMode,
        deriveWorkflowStateFromLaneKey: TaskPolicyCore.deriveWorkflowStateFromLaneKey,
        getEffectiveWorkflowState: TaskPolicyCore.getEffectiveWorkflowState,
        isManualStagedSource: TaskPolicyCore.isManualStagedSource,
        isPhysicallyOrManuallyStaged: TaskPolicyCore.isPhysicallyOrManuallyStaged,
        isUserTouchedSchedulerCard: TaskPolicyCore.isUserTouchedSchedulerCard,
        isUserTouchedSchedulerRecord: TaskPolicyCore.isUserTouchedSchedulerRecord,
        buildWorkflowPatch: TaskPolicyCore.buildWorkflowPatch,
        buildStagedStartDateAllocationPatch: TaskPolicyCore.buildStagedStartDateAllocationPatch,
        buildIncompletePatch: TaskPolicyCore.buildIncompletePatch,
        decideTaskViewLaneKey: TaskPolicyCore.decideTaskViewLaneKey,
        selectedPeriodStagedSortEnabled: TaskPolicyCore.selectedPeriodStagedSortEnabled,
        buildSelectedPeriodStagedSortKey: TaskPolicyCore.buildSelectedPeriodStagedSortKey,
        compareSelectedPeriodStagedRecords: TaskPolicyCore.compareSelectedPeriodStagedRecords,
        buildSelectedPeriodStagedStartText: TaskPolicyCore.buildSelectedPeriodStagedStartText,
        buildSelectedPeriodStagedDueText: TaskPolicyCore.buildSelectedPeriodStagedDueText,
        normalizeTaskReflowScopePlan: TaskPolicyCore.normalizeTaskReflowScopePlan,
        getTaskReflowScopeForCommand: TaskPolicyCore.getTaskReflowScopeForCommand,
        snapshotTaskReflowTestCounters,
        resetTaskReflowTestCounters,
        snapScheduleMinutes: SchedulePolicyCore.snapScheduleMinutes,
        scheduleMinutesToPx: SchedulePolicyCore.scheduleMinutesToPx,
        schedulePxToMinutes: SchedulePolicyCore.schedulePxToMinutes,
        scheduleMinuteOffsetToPx: SchedulePolicyCore.scheduleMinuteOffsetToPx,
        getDateScopedScheduleOrder: SchedulePolicyCore.getDateScopedScheduleOrder,
        compareDateScopedScheduleOrderRecords: SchedulePolicyCore.compareDateScopedScheduleOrderRecords,
        normalizeWeekDayLaneWidth: SchedulePolicyCore.normalizeWeekDayLaneWidth,
        normalizeWeekDayLaneWidths: SchedulePolicyCore.normalizeWeekDayLaneWidths,
        serializeWeekDayLaneWidths: SchedulePolicyCore.serializeWeekDayLaneWidths,
        normalizeWeekBoardHeight: SchedulePolicyCore.normalizeWeekBoardHeight,
        normalizeWeekBoardHeights: SchedulePolicyCore.normalizeWeekBoardHeights,
        serializeWeekBoardHeights: SchedulePolicyCore.serializeWeekBoardHeights,
        formatScheduleTimeRange: SchedulePolicyCore.formatScheduleTimeRange,
        normalizeWorkHourWindow: SchedulePolicyCore.normalizeWorkHourWindow,
        normalizeWeekWorkHours: SchedulePolicyCore.normalizeWeekWorkHours,
        defaultWeekWorkHours: SchedulePolicyCore.defaultWeekWorkHours,
        serializeWeekWorkHours: SchedulePolicyCore.serializeWeekWorkHours,
        resolveWeekWorkHours: SchedulePolicyCore.resolveWeekWorkHours,
        workWindowDurationMinutes: SchedulePolicyCore.workWindowDurationMinutes,
        buildWeekTimeScale: SchedulePolicyCore.buildWeekTimeScale,
        getWeekTimeScaleOffsetPx: SchedulePolicyCore.getWeekTimeScaleOffsetPx,
        defaultScheduleDurationFromHours: SchedulePolicyCore.defaultScheduleDurationFromHours,
        buildStackSchedulePlan: SchedulePolicyCore.buildStackSchedulePlan,
        getTaskDateRange,
        buildInitialCardDateAttributes,
        buildSchedulerTaskMetadataAttributes,
        getSchedulerTaskKey,
        buildGeneratedTaskSyncAttributes,
        buildGeneratedTaskSyncAttributesForExisting,
        planDifferentialTaskSync,
        planTaskAssignmentReplacement,
        buildCardDateOverridePatch,
        buildCardDateResetPatch,
        isEditableCardDateLane,
        normalizeCardNote,
        buildCardNotePatch,
        normalizeTaskAssigneeRoleIds,
        serializeTaskAssigneeRoleIds,
        hasTaskAssignees,
        normalizeRepeatIdentityText,
        normalizeRepeatLinkedIds,
        buildRepeatSeriesKey,
        compareRepeatOccurrenceRecords,
        isCardVisibilityEligible,
        buildTaskLanePagePlan,
        planRepeatSeriesVisibility,
        getKanbanCellType,
        canParentKanbanCell
    };
}

// -------------------- Runtime facade -------------------- // CHANGE: one plugin entrypoint with explicit internal seams
function createGardenTaskManagerRuntime({ ui, taskPolicy, schedulePolicy }) {
    return Object.freeze({
        install: function () {
            taskPolicy = taskPolicy || TaskPolicyCore;
            schedulePolicy = schedulePolicy || SchedulePolicyCore;
    const graph = ui.editor.graph;
    const model = graph.getModel();

    // -------------------- Runtime constants and plugin-local attributes --------------------
    const BOARD_KEY = KANBAN_BOARD_KEY;
    const BOARD_ROLE_ATTR = 'board_role';
    const TASK_SEEN_CREATED_ATTR = 'task_seen_created_json';
    const TG_COMPLETED_ATTR = 'tg_completed';


    // -------------------- Template styles --------------------
    const BOARD_STYLE = // CHANGE: task layout owns board-child geometry instead of Draw.io stack fill
        'swimlane;fontStyle=2;horizontal=1;startSize=28;collapsible=1;swimlaneFillColor=#F8FAFC;fontFamily=Permanent Marker;fontSize=16;points=[];verticalAlign=top;resizable=1;strokeWidth=2;disableMultiStroke=1;'; // CHANGE: opaque body remains visible below shorter week lanes
    const LANE_STYLE_BASE =
        'swimlane;strokeWidth=2;fontFamily=Permanent Marker;fontSize=12;html=0;startSize=40;align=center;verticalAlign=middle;whiteSpace=wrap;spacingBottom=5;points=[];childLayout=stackLayout;stackBorder=20;stackSpacing=20;marginTop=0;resizeLast=0;resizeParent=0;horizontalStack=0;collapsible=0;fillStyle=solid;swimlaneFillColor=default;'; // CHANGE: lane visibility is controlled by board toggles, not draw.io collapse handles
    const SCHEDULE_LANE_STYLE_BASE = // NEW: plugin-owned schedule geometry prevents Draw.io stack layout from expanding day lanes
        'swimlane;strokeWidth=2;fontFamily=Permanent Marker;html=0;startSize=1;verticalAlign=bottom;spacingBottom=5;points=[];resizeLast=0;resizeParent=0;horizontalStack=0;collapsible=0;fillStyle=solid;swimlaneFillColor=default;';
    const CARD_STYLE =
        'whiteSpace=wrap;html=1;strokeWidth=2;fillColor=swimlane;fontStyle=1;spacingTop=0;rounded=1;arcSize=9;points=[];fontFamily=Permanent Marker;hachureGap=8;fillWeight=1;';
    const BREAK_CARD_STYLE = CARD_STYLE + 'dashed=1;fillColor=#F3F4F6;strokeColor=#6B7280;';

    // Lane fills
    const LANE_FILL = [
        '#DDD6FE', // UPCOMING (future)
        '#C7D2FE', // UPCOMING (year)
        '#BAE6FD', // UPCOMING (month)
        '#BBF7D0', // UPCOMING (week)
        '#E5E7EB', // TODO (staged)
        '#E0F2FE', // Sunday // CHANGE: schedule lanes share one neutral color
        '#E0F2FE', // Monday
        '#E0F2FE', // Tuesday
        '#E0F2FE', // Wednesday
        '#E0F2FE', // Thursday
        '#E0F2FE', // Friday
        '#E0F2FE', // Saturday
        '#F8CECC', // TODO
        '#FFF2CC', // DOING
        '#D5E8D4', // DONE
        '#D1FAE5', // DONE (week)
        '#A7F3D0', // DONE (month)
        '#6EE7B7', // DONE (year)
        '#F3F4F6'  // ARCHIVED
    ];

    const BOARD_GEOM = { x: 40, y: 40, w: 2200, h: 760 };
    const LANE_W = DEFAULT_DAY_LANE_WIDTH, LANE_H = 680, LANE_GAP = 16;
    const BOARD_LANE_Y = 28, BOARD_BOTTOM_PADDING = 10, FULL_LANE_MIN_H = TASK_LANE_MIN_HEIGHT; // CHANGE: one minimum for every non-day lane
    const WEEK_BOARD_TOP_MARGIN = 20; // NEW: replaces schedule-lane stackBorder so hour origin and resize math match
    const TASK_ACTION_OVERLAY_EXTRA_Y = 3; // CHANGE: nudges selected card/lane action overlays below handles
    const TASK_ACTION_OVERLAY_EXTRA_X = 20; // CHANGE: shifts selected task action overlays 10 px to the right
    const TASK_MODULE_CURSOR_OVERLAY_OFFSET_X = 8; // NEW: match selected team module cursor overlay offset
    const TASK_MODULE_CURSOR_OVERLAY_OFFSET_Y = 8; // NEW: match selected team module cursor overlay offset
    const TASK_BOARD_HEADER_OVERLAY_EXTRA_X = 20; // CHANGE: shifts the board-level task controls 10 px right
    const SCHEDULE_CARD_HORIZONTAL_INSET = 10; // CHANGE: day lanes own card x and width with fixed side gutters
    const WORKFLOW_CARD_FILL = { TODO: '#F8CECC', DOING: '#FFF2CC', DONE: '#D5E8D4' };

    const LINK_ATTR = 'linkedTo';
    const REPEAT_HIDDEN_ATTR = 'repeat_hidden';
    const REPEAT_EXPANDED_ATTR = 'repeat_expanded';
    const REPEAT_BADGE_ATTR = 'repeat_badge';

    const LANES = KANBAN_LANE_DEFS; // CHANGE: template and policy use the same canonical lane list
    const lanePagingStates = new Map(); // NEW: current plans drive DOM rendering without a public API
    let requestLanePagerOverlayRefresh = function () {}; // NEW: installed after the shared overlay host exists
    let taskPagingSelectionGuard = false; // NEW: prevents selection repair and reveal loops
    let activeDashboardTaskContext = null;
    let suppressDashboardSeenSelection = false;
    const transientUnseenHighlightOverlays = new Map();
    let missingTaskModuleWarningShown = false;


    // -------------------- Draw.io adapter factory: values, cells, and model writes --------------------
    function createTaskRuntimeAdapters({ graph }) {
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
            if (!(v && v.getAttribute)) return null;
            const exact = v.getAttribute(k);
            if ((exact === null || exact === undefined) && /[A-Z]/.test(k)) return v.getAttribute(String(k).toLowerCase());
            return exact;
        }

        function createVertex(label, x, y, w, h, style) {
            const v = new mxCell(label || '', new mxGeometry(x, y, w, h), style || '');
            v.setVertex(true);
            v.setConnectable(false);
            return v;
        }

        return Object.freeze({
            ensureXmlValue,
            setAttrNoUndo,
            getAttr,
            createVertex
        });
    }

    const taskRuntimeAdapters = createTaskRuntimeAdapters({ graph });
    const { ensureXmlValue, setAttrNoUndo, getAttr, createVertex } = taskRuntimeAdapters;

    function getTaskAssigneeRoleIds(card) {
        return normalizeTaskAssigneeRoleIds(getAttr(card, TASK_ASSIGNEE_ROLE_IDS_ATTR));
    }

    function getCellStyleText(cell) {
        return String((cell && cell.getStyle && cell.getStyle()) || (cell && cell.style) || '');
    }

    function styleHasFlag(cell, key) {
        return new RegExp('(^|;)' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=1(?=;|$)').test(getCellStyleText(cell));
    }

    function getCellDisplayText(cell) { // NEW: role fields may use strings or XML labels
        if (!cell) return '';
        const value = cell.value;
        const raw = value && value.getAttribute ? (value.getAttribute('label') || '') : (value == null ? '' : String(value));
        const holder = document && document.createElement ? document.createElement('div') : null;
        if (holder) { holder.innerHTML = raw; return String(holder.textContent || '').replace(/\s+/g, ' ').trim(); }
        return String(raw).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function getStyleImageSource(cell) { // NEW: preserve data-uri semicolons without persisting the image on tasks
        const match = getCellStyleText(cell).match(/(?:^|;)image=(.*?)(?=;[A-Za-z_][A-Za-z0-9_]*=|;?$)/);
        return match ? String(match[1] || '').trim() : '';
    }

    function isRoleCard(cell) {
        return !!(cell && model.isVertex(cell) && styleHasFlag(cell, 'role_card'));
    }

    function immediateChildren(cell) {
        const out = [];
        const count = cell ? model.getChildCount(cell) : 0;
        for (let i = 0; i < count; i++) { const child = model.getChildAt(cell, i); if (child) out.push(child); }
        return out;
    }

    function findRoleField(roleCard, tag, legacyIndex) { // NEW: tagged fields are stable; ordered geometry supports existing role cards
        const children = immediateChildren(roleCard);
        const tagged = children.find(child => styleHasFlag(child, tag));
        if (tagged) return tagged;
        const legacyFields = children
            .filter(child => !styleHasFlag(child, 'role_imagerow'))
            .sort((left, right) => {
                const a = model.getGeometry(left) || {}; const b = model.getGeometry(right) || {};
                return (Number(a.y) || 0) - (Number(b.y) || 0) || (Number(a.x) || 0) - (Number(b.x) || 0);
            });
        return legacyFields[legacyIndex] || null;
    }

    function findRoleAvatar(roleCard) {
        const imageRow = immediateChildren(roleCard).find(child => styleHasFlag(child, 'role_imagerow'));
        return imageRow ? immediateChildren(imageRow).find(child => styleHasFlag(child, 'role_avatar')) || null : null;
    }

    function roleFieldText(cell, placeholder, fallback) {
        const text = getCellDisplayText(cell);
        return !text || text.toLowerCase() === placeholder.toLowerCase() ? fallback : text;
    }

    function readRoleProfile(roleCard, board) {
        if (!isRoleCard(roleCard)) return null;
        const id = String(roleCard.id || (roleCard.getId && roleCard.getId()) || '');
        const name = roleFieldText(findRoleField(roleCard, 'role_name', 0), 'Name', 'Unnamed person');
        const roleTitle = roleFieldText(findRoleField(roleCard, 'role_title', 1), 'Role/Title', 'Unspecified role');
        const avatar = findRoleAvatar(roleCard);
        const boardId = board && String(board.id || (board.getId && board.getId()) || '');
        const eligible = !!(boardId && getLinkSet(board).has(id) && getLinkSet(roleCard).has(boardId));
        return { id, cell: roleCard, name, roleTitle, cardTitle: getCellDisplayText(roleCard), imageSource: getStyleImageSource(avatar), eligible };
    }

    function getBoardRoleRoster(board) { // NEW: only direct reciprocal links form the assignable roster
        const profiles = [];
        getLinkSet(board).forEach(id => {
            const profile = readRoleProfile(model.getCell(id), board);
            if (profile && profile.eligible) profiles.push(profile);
        });
        return profiles.sort((left, right) => left.roleTitle.localeCompare(right.roleTitle, undefined, { sensitivity: 'base' })
            || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) || left.id.localeCompare(right.id));
    }

    function resolveCardAssigneeProfiles(card, board) {
        return getTaskAssigneeRoleIds(card).map(id => {
            const profile = readRoleProfile(model.getCell(id), board);
            return profile || { id, cell: null, name: 'Deleted role', roleTitle: 'Unavailable', cardTitle: '', imageSource: '', eligible: false };
        }).sort((left, right) => (left.eligible === right.eligible ? 0 : (left.eligible ? 1 : -1)) // NEW: warnings remain visible in compact stacks
            || left.roleTitle.localeCompare(right.roleTitle, undefined, { sensitivity: 'base' })
            || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) || left.id.localeCompare(right.id));
    }

    function roundedGeometryValue(value) {
        const numberValue = Number(value);
        return Number.isFinite(numberValue) ? Math.round(numberValue) : 0;
    }

    function roundedGeometryWidth(geo) {
        return geo ? roundedGeometryValue(geo.width) : null;
    }

    function roundedGeometryHeight(geo) {
        return geo ? roundedGeometryValue(geo.height) : null;
    }

    function geometryMatchesRounded(left, right) {
        if (!left || !right) return false;
        return roundedGeometryValue(left.x) === roundedGeometryValue(right.x)
            && roundedGeometryValue(left.y) === roundedGeometryValue(right.y)
            && roundedGeometryValue(left.width) === roundedGeometryValue(right.width)
            && roundedGeometryValue(left.height) === roundedGeometryValue(right.height);
    }

    function createTaskTransactionRunner({ model }) { // CHANGE: centralize command transaction boundaries
        function runModelUpdate(opts, fn) {
            const options = typeof opts === 'function' ? {} : (opts || {});
            const body = typeof opts === 'function' ? opts : fn;
            if (typeof body !== 'function') return undefined;
            const insideUpdate = !!options.insideUpdate;
            if (!insideUpdate) model.beginUpdate();
            try {
                return body();
            } finally {
                if (!insideUpdate) model.endUpdate();
            }
        }

        return Object.freeze({ runModelUpdate });
    }

    const taskTransactions = createTaskTransactionRunner({ model });

    // Garden-module helpers
    function isGardenModule(cell) { return getAttr(cell, 'garden_module') === '1'; }
    function isTaskModule(cell) { return getAttr(cell, 'task_module') === '1'; }
    function findGardenModuleAncestor(cell) {
        if (!cell) return null;
        let cur = cell;
        while (cur) {
            if (isGardenModule(cur)) return cur;
            cur = model.getParent(cur);
        }
        return null;
    }

    function taskModulesApi() {
        return graph && graph.__trellisModules;
    }

    function ensureTaskModuleForGarden(gardenModule) {
        const modules = taskModulesApi();
        if (!gardenModule || !isGardenModule(gardenModule) || !modules || typeof modules.ensureGardenTaskModule !== 'function') {
            if (gardenModule && isGardenModule(gardenModule) && !missingTaskModuleWarningShown) {
                missingTaskModuleWarningShown = true;
                try { console.warn('[TaskManager] Cannot create a Kanban board for a garden without the Trellis Modules companion Task Module API.'); } catch (_) { }
            }
            return null;
        }
        return modules.ensureGardenTaskModule(gardenModule);
    }

    function taskModuleForGarden(gardenModule) {
        const modules = taskModulesApi();
        if (!gardenModule || !isGardenModule(gardenModule) || !modules) return null;
        if (typeof modules.findExistingCompanionTask === 'function') return modules.findExistingCompanionTask(gardenModule);
        return null;
    }

    function boardContainerForGarden(gardenModule) {
        return taskModuleForGarden(gardenModule); // CHANGE: normal task paths only use existing companion Task Modules
    }

    // -------------------- Board and lane template commands --------------------
    function ensureBoardTemplateIn(containerVertex, opts) {
        const parent = isGardenModule(containerVertex) ? boardContainerForGarden(containerVertex) : (containerVertex || graph.getDefaultParent());
        if (!parent) return { parent: null, board: null, lanes: {} };
        let { main } = findBoardsIn(parent);
        if (isGardenModule(containerVertex) && !main && !(opts && opts.createMainBoard)) return { parent, board: null, lanes: {} };

        return taskTransactions.runModelUpdate(opts, function () {
            let board = main;
            if (!board) {
                board = createVertex('Kanban', BOARD_GEOM.x, BOARD_GEOM.y, BOARD_GEOM.w, BOARD_GEOM.h, BOARD_STYLE);
                model.add(parent, board, model.getChildCount(parent));
                setAttrNoUndo(board, 'board_key', BOARD_KEY);
                setAttrNoUndo(board, BOARD_ROLE_ATTR, 'main');
                main = board;
            }
            ensureBoardPlanningDefaults(main);
            ensureLanes(main);
            return { parent, board: main, lanes: lanesMap(main) };
        });
    }

    function createSecondaryBoardIn(parent) {
        parent = isGardenModule(parent) ? boardContainerForGarden(parent) : parent;
        if (!parent) return null;
        const board = createVertex('Kanban', BOARD_GEOM.x, BOARD_GEOM.y, BOARD_GEOM.w, BOARD_GEOM.h, BOARD_STYLE);
        model.add(parent, board, model.getChildCount(parent));
        setAttrNoUndo(board, 'board_key', BOARD_KEY);
        setAttrNoUndo(board, BOARD_ROLE_ATTR, 'secondary');
        ensureBoardPlanningDefaults(board);
        ensureLanes(board);
        return board;
    }

    function getBoardWeekWorkHours(board) {
        return schedulePolicy.resolveWeekWorkHours(
            getAttr(board, TASK_WORK_HOURS_DEFAULTS_ATTR),
            getAttr(board, TASK_WORK_HOURS_WEEK_OVERRIDES_ATTR),
            getSelectedWeekStart(board)
        );
    }

    function getBoardWeekDayLaneWidths(board) {
        return schedulePolicy.normalizeWeekDayLaneWidths(getAttr(board, TASK_DAY_LANE_WIDTHS_ATTR), LANE_W);
    }

    function getWeekDayLaneWidth(board, laneKey) {
        if (!isWeekDayLane(laneKey)) return LANE_W;
        return getBoardWeekDayLaneWidths(board)[laneKey] || LANE_W;
    }

    function persistWeekDayLaneWidth(board, laneKey, width) {
        if (!board || !isWeekDayLane(laneKey)) return false;
        const widths = getBoardWeekDayLaneWidths(board);
        const nextWidth = schedulePolicy.normalizeWeekDayLaneWidth(width, LANE_W);
        if (widths[laneKey] === nextWidth) return false;
        widths[laneKey] = nextWidth;
        setAttrNoUndo(board, TASK_DAY_LANE_WIDTHS_ATTR, schedulePolicy.serializeWeekDayLaneWidths(widths), true);
        return true;
    }

    function getBoardNonDayLaneWidths(board) {
        return schedulePolicy.normalizeNonDayLaneWidths(getAttr(board, TASK_NON_DAY_LANE_WIDTHS_ATTR), LANE_W);
    }

    function getNonDayLaneWidth(board, laneKey) {
        if (isWeekDayLane(laneKey)) return LANE_W;
        return getBoardNonDayLaneWidths(board)[laneKey] || LANE_W;
    }

    function getBoardLayoutLaneWidth(board, laneKey) {
        return isWeekDayLane(laneKey) ? getWeekDayLaneWidth(board, laneKey) : getNonDayLaneWidth(board, laneKey);
    }

    function persistNonDayLaneWidth(board, laneKey, width) {
        if (!board || !laneKey || isWeekDayLane(laneKey)) return false;
        const widths = getBoardNonDayLaneWidths(board);
        const nextWidth = schedulePolicy.normalizeNonDayLaneWidth(width, LANE_W);
        if (widths[laneKey] === nextWidth) return false;
        widths[laneKey] = nextWidth;
        setAttrNoUndo(board, TASK_NON_DAY_LANE_WIDTHS_ATTR, schedulePolicy.serializeNonDayLaneWidths(widths), true);
        return true;
    }

    function getBoardWeekWorkHourEditState(board) {
        ensureBoardPlanningDefaults(board);
        const weekStart = getSelectedWeekStart(board);
        const defaults = normalizeWeekWorkHours(parseJsonObject(getAttr(board, TASK_WORK_HOURS_DEFAULTS_ATTR)));
        const overridesRoot = parseJsonObject(getAttr(board, TASK_WORK_HOURS_WEEK_OVERRIDES_ATTR)) || { schemaVersion: 1, weeks: {} };
        const weeks = overridesRoot.weeks && typeof overridesRoot.weeks === 'object' ? overridesRoot.weeks : {};
        const week = normalizeWeekWorkHours(weeks[weekStart], defaults);
        return { weekStart, defaults, weeks, week };
    }

    function countVisibleLaneCards(lane) {
        return snapshotLaneCards(lane).filter(card => !model.isVisible || model.isVisible(card) !== false).length;
    }

    function selectedWeekDayHasVisibleCards(lane) {
        return countVisibleLaneCards(lane) > 0;
    }

    function persistSelectedWeekDayWorkWindow(board, dayIndex, dayWindow) {
        if (!board || dayIndex < 0 || dayIndex >= WEEK_DAY_LANE_KEYS.length) return false;
        const editState = getBoardWeekWorkHourEditState(board);
        if (!parseTaskCalendarISO(editState.weekStart)) return false;
        const nextWindow = normalizeWorkHourWindow(dayWindow);
        const currentWindow = normalizeWorkHourWindow(editState.week[dayIndex]);
        if (JSON.stringify(currentWindow) === JSON.stringify(nextWindow)) return false;
        const nextWeek = editState.week.slice();
        nextWeek[dayIndex] = nextWindow;
        const nextWeeks = Object.assign({}, editState.weeks);
        nextWeeks[editState.weekStart] = { schemaVersion: 1, days: normalizeWeekWorkHours(nextWeek) };
        setAttrNoUndo(board, TASK_WORK_HOURS_DEFAULTS_ATTR, serializeWeekWorkHours(editState.defaults), true);
        setAttrNoUndo(board, TASK_WORK_HOURS_WEEK_OVERRIDES_ATTR, JSON.stringify({ schemaVersion: 1, weeks: nextWeeks }), true);
        return true;
    }

    function persistWeekDayLaneHourResize(board, laneKey, previousGeo, currentGeo) {
        if (!board || !isWeekDayLane(laneKey) || !previousGeo || !currentGeo) return false;
        const dayIndex = getWeekDayIndexForLaneKey(laneKey);
        const editState = getBoardWeekWorkHourEditState(board);
        const currentWindow = normalizeWorkHourWindow(editState.week[dayIndex]);
        if (currentWindow.closed) return false;
        const previousTop = roundedGeometryValue(previousGeo.y);
        const currentTop = roundedGeometryValue(currentGeo.y);
        const previousBottom = roundedGeometryValue(previousGeo.y) + roundedGeometryValue(previousGeo.height);
        const currentBottom = roundedGeometryValue(currentGeo.y) + roundedGeometryValue(currentGeo.height);
        const topDeltaMinutes = schedulePolicy.schedulePxDeltaToMinutes(currentTop - previousTop);
        const bottomDeltaMinutes = schedulePolicy.schedulePxDeltaToMinutes(currentBottom - previousBottom);
        if (!topDeltaMinutes && !bottomDeltaMinutes) return false;
        let nextStart = currentWindow.startMinute;
        let nextEnd = currentWindow.endMinute;
        if (topDeltaMinutes) nextStart += topDeltaMinutes;
        if (bottomDeltaMinutes) nextEnd += bottomDeltaMinutes;
        nextStart = Math.max(0, Math.min(1440 - SCHEDULE_MINUTE_SNAP, snapScheduleMinutes(nextStart, currentWindow.startMinute)));
        nextEnd = Math.max(SCHEDULE_MINUTE_SNAP, Math.min(1440, snapScheduleMinutes(nextEnd, currentWindow.endMinute)));
        if (nextEnd <= nextStart) {
            if (bottomDeltaMinutes && !topDeltaMinutes) nextEnd = Math.min(1440, nextStart + SCHEDULE_MINUTE_SNAP);
            else nextStart = Math.max(0, nextEnd - SCHEDULE_MINUTE_SNAP);
        }
        return persistSelectedWeekDayWorkWindow(board, dayIndex, { closed: false, startMinute: nextStart, endMinute: nextEnd });
    }

    function getBoardWeekBoardHeights(board) {
        return schedulePolicy.normalizeWeekBoardHeights(getAttr(board, TASK_WEEK_BOARD_HEIGHTS_ATTR));
    }

    function getPersistedWeekBoardHeight(board) {
        const weekStart = getSelectedWeekStart(board);
        return getBoardWeekBoardHeights(board)[weekStart] || null;
    }

    function deriveWeekBoardHeightFromBoardGeometry(board) {
        const geo = board && model.getGeometry ? model.getGeometry(board) : (board && board.getGeometry ? board.getGeometry() : null);
        return schedulePolicy.normalizeWeekBoardHeight(geo ? geo.height : BOARD_GEOM.h, BOARD_GEOM.h);
    }

    function persistWeekBoardHeight(board, height) {
        if (!board) return false;
        const weekStart = getSelectedWeekStart(board);
        if (!parseTaskCalendarISO(weekStart)) return false;
        const heights = getBoardWeekBoardHeights(board);
        const nextHeight = schedulePolicy.normalizeWeekBoardHeight(height, BOARD_GEOM.h);
        if (heights[weekStart] === nextHeight) return false;
        heights[weekStart] = nextHeight;
        setAttrNoUndo(board, TASK_WEEK_BOARD_HEIGHTS_ATTR, schedulePolicy.serializeWeekBoardHeights(heights), true);
        return true;
    }

    function normalizeFullLaneHeight(value, fallback) {
        const numeric = Number(value);
        const base = Number.isFinite(numeric) ? numeric : fallback;
        return Math.max(FULL_LANE_MIN_H, Math.round(Number.isFinite(base) ? base : LANE_H));
    }

    function getPersistedFullLaneHeight(board) {
        const raw = getAttr(board, TASK_FULL_LANE_HEIGHT_ATTR);
        return raw == null || raw === '' ? null : normalizeFullLaneHeight(raw, LANE_H);
    }

    function getBoardFullLaneHeight(board) {
        return getPersistedFullLaneHeight(board) || LANE_H;
    }

    function deriveFullLaneHeightFromBoardGeometry(board) {
        const geo = board && model.getGeometry ? model.getGeometry(board) : (board && board.getGeometry ? board.getGeometry() : null);
        return normalizeFullLaneHeight((geo ? geo.height : BOARD_GEOM.h) - BOARD_LANE_Y - BOARD_BOTTOM_PADDING, LANE_H);
    }

    function persistFullLaneHeight(board, height) {
        if (!board) return false;
        const nextHeight = normalizeFullLaneHeight(height, LANE_H);
        if (getPersistedFullLaneHeight(board) === nextHeight) return false;
        setAttrNoUndo(board, TASK_FULL_LANE_HEIGHT_ATTR, String(nextHeight), true);
        return true;
    }

    function getWeekDayIndexForLaneKey(laneKey) {
        return WEEK_DAY_LANE_KEYS.indexOf(String(laneKey || ''));
    }

    function getVisibleDateForWeekLane(board, laneKey) {
        return isWeekDayLane(laneKey) ? getDateForWeekLaneKey(laneKey, getSelectedWeekStart(board)) : null;
    }

    function reconcileScheduleBreakOwnership(board, laneKey, card) {
        if (!board || !card || !isWeekDayLane(laneKey) || !isScheduleBreakCard(card)) return false;
        const visibleDate = getVisibleDateForWeekLane(board, laneKey);
        if (!visibleDate) return false;
        let changed = false;
        const ownerDay = getAttr(card, TASK_ASSIGNED_DAY_ATTR);
        if (!parseTaskCalendarISO(ownerDay)) {
            setAttrNoUndo(card, TASK_ASSIGNED_DAY_ATTR, visibleDate, true);
            changed = true;
        }
        const active = getAttr(card, TASK_ASSIGNED_DAY_ATTR) === visibleDate;
        const curVisible = model.isVisible ? model.isVisible(card) : true;
        if (curVisible !== active && model.setVisible) {
            model.setVisible(card, active);
            changed = true;
        }
        if (!active) {
            changed = setDerivedCardAttribute(card, TASK_SCHEDULE_START_MINUTE_ATTR, null) || changed;
        }
        return changed;
    }

    function isActiveScheduleCardForLane(board, laneKey, card) {
        if (!isScheduleBreakCard(card)) return true;
        return getAttr(card, TASK_ASSIGNED_DAY_ATTR) === getVisibleDateForWeekLane(board, laneKey);
    }

    function markScheduleLaneOrderDirty(lane) {
        if (lane && isWeekDayLane(getAttr(lane, 'lane_key'))) lane.__trellisScheduleOrderDirty = true;
    }

    function isScheduleLaneOrderDirty(lane) {
        return !!(lane && lane.__trellisScheduleOrderDirty);
    }

    function clearScheduleLaneOrderDirty(lane) {
        if (lane) lane.__trellisScheduleOrderDirty = false;
    }

    function getOrderedScheduleLaneCards(board, lane, laneKey) {
        const visibleDay = getVisibleDateForWeekLane(board, laneKey);
        const records = snapshotLaneCards(lane).map((card, index) => ({
            id: card.id,
            cell: card,
            source: card.value,
            fallbackIndex: index
        })).filter(record => isActiveScheduleCardForLane(board, laneKey, record.cell));
        if (!isScheduleLaneOrderDirty(lane)) records.sort((left, right) => compareDateScopedScheduleOrderRecords(left, right, visibleDay));
        return records.map(record => record.cell);
    }

    function getLaneScheduleRecords(board, lane, laneKey) {
        return getOrderedScheduleLaneCards(board, lane, laneKey).map((card, index) => {
            const geo = model.getGeometry(card);
            return {
                id: card.id,
                cell: card,
                source: card.value,
                fallbackIndex: index,
                height: geo ? geo.height : SCHEDULE_MIN_CARD_HEIGHT
            };
        });
    }

    function computeWeekLaneHeight(board, lanes, laneKey) {
        if (!isWeekDayLane(laneKey)) return LANE_H;
        const dayIndex = getWeekDayIndexForLaneKey(laneKey);
        const workHours = getBoardWeekWorkHours(board);
        const dayWindow = workHours[dayIndex];
        if (dayWindow && dayWindow.closed) return SCHEDULE_MIN_CARD_HEIGHT;
        return Math.max(SCHEDULE_MIN_CARD_HEIGHT, schedulePolicy.scheduleMinutesToPx(schedulePolicy.workWindowDurationMinutes(dayWindow)));
    }

    function getCanonicalLaneStyle(laneKey, emphasized, paged) { // CHANGE: retain card stacking while reserving pager height only
        const laneIndex = LANES.findIndex(lane => lane.key === laneKey);
        const fillIndex = laneIndex >= 0 ? laneIndex % LANE_FILL.length : 0;
        const styleBase = isWeekDayLane(laneKey) ? SCHEDULE_LANE_STYLE_BASE : LANE_STYLE_BASE;
        let style = styleBase + 'fillColor=' + LANE_FILL[fillIndex] + ';strokeColor=' + LANE_FILL[fillIndex] + ';';
        if (!isWeekDayLane(laneKey)) style = setStyleKey(style, 'marginTop', paged ? String(TASK_LANE_PAGER_MARGIN_TOP) : '0');
        return setStyleKey(style, 'strokeWidth', emphasized ? '3' : '2');
    }

    function ensureCanonicalBoardStyle(board) { // NEW: recognized task boards are managed components
        if (!board || board.getStyle() === BOARD_STYLE) return false;
        board.setStyle(BOARD_STYLE);
        return true;
    }

    function ensureLaneExpanded(lane) {
        if (!lane || !graph.isCellCollapsed || !graph.isCellCollapsed(lane)) return;
        if (lane.setCollapsed) lane.setCollapsed(false);
        else if (graph.foldCells) graph.foldCells(false, false, [lane]);
    }

    function ensureCanonicalLaneStyles(lanes, selectedWeekLaneKey) { // NEW: migrate legacy resizeParent lane styles on every layout
        Object.keys(lanes || {}).forEach(laneKey => {
            const lane = lanes[laneKey];
            if (!lane) return;
            ensureLaneExpanded(lane); // NEW: unfold legacy collapsed lanes before toggle-driven visibility applies
            const style = getCanonicalLaneStyle(laneKey, laneKey === selectedWeekLaneKey, !!getAttr(lane, TASK_PAGE_ANCHOR_ATTR));
            if (lane.getStyle() !== style) lane.setStyle(style);
        });
    }

    function applyBoardViewLayout(board, lanes) {
        bumpTaskReflowTestCounter('boardLayout');
        ensureCanonicalBoardStyle(board);
        ensureBoardPlanningDefaults(board);
        const mode = getBoardViewMode(board);
        const visibleKeys = taskPolicy.getTaskVisibleLaneKeysForMode(getAttr(board, TASK_VISIBLE_LANE_KEYS_ATTR), mode);
        const visibleSet = new Set(visibleKeys);
        const firstVisibleWeekDayKey = mode === 'WEEK' ? visibleKeys.find(laneKey => isWeekDayLane(laneKey) && lanes[laneKey]) : null;
        const selectedWeekLaneKey = mode === 'WEEK' ? taskPolicy.getWeekLaneKeyForDate(getSelectedDay(board), getSelectedWeekStart(board)) : null;
        ensureCanonicalLaneStyles(lanes, selectedWeekLaneKey);
        const laneHeights = {};
        const laneYOffsets = {};
        let maxLaneHeight = mode === 'WEEK' ? 0 : getBoardFullLaneHeight(board);
        let weekTimeScale = null;
        const y = BOARD_LANE_Y + (mode === 'WEEK' ? WEEK_BOARD_TOP_MARGIN : 0);
        if (mode === 'WEEK') {
            const workHours = getBoardWeekWorkHours(board);
            weekTimeScale = schedulePolicy.buildWeekTimeScale(workHours);
            const weekScaleHeight = weekTimeScale.active ? schedulePolicy.scheduleMinuteOffsetToPx(weekTimeScale.durationMinutes) : SCHEDULE_MIN_CARD_HEIGHT;
            WEEK_DAY_LANE_KEYS.forEach(laneKey => {
                const dayIndex = getWeekDayIndexForLaneKey(laneKey);
                laneYOffsets[laneKey] = schedulePolicy.getWeekTimeScaleOffsetPx(workHours[dayIndex], weekTimeScale);
                laneHeights[laneKey] = computeWeekLaneHeight(board, lanes, laneKey);
                maxLaneHeight = Math.max(maxLaneHeight, laneYOffsets[laneKey] + laneHeights[laneKey]);
            });
            const persistedBoardHeight = getPersistedWeekBoardHeight(board);
            const requestedLaneHeight = persistedBoardHeight == null ? 0 : persistedBoardHeight - y - BOARD_BOTTOM_PADDING;
            laneHeights.TODO_STAGED = Math.max(TASK_LANE_MIN_HEIGHT, weekScaleHeight, maxLaneHeight, requestedLaneHeight); // CHANGE: real header remains usable when all days are closed
            maxLaneHeight = Math.max(maxLaneHeight, laneHeights.TODO_STAGED);
        }
        let x = 10;
        let laidOutLaneCount = 0;

        visibleKeys.forEach(laneKey => {
            const lane = lanes[laneKey];
            if (!lane) return;
            if (mode === 'WEEK' && laneKey === firstVisibleWeekDayKey) x += WEEK_TIME_RULER_WIDTH + LANE_GAP;
            const laneWidth = getBoardLayoutLaneWidth(board, laneKey); // CHANGE: non-day lanes persist widths by lane key; day lanes keep existing behavior
            const geo = lane.getGeometry() ? lane.getGeometry().clone() : new mxGeometry(x, y, LANE_W, LANE_H);
            geo.x = x;
            geo.y = y + (mode === 'WEEK' && isWeekDayLane(laneKey) ? (laneYOffsets[laneKey] || 0) : 0);
            geo.width = laneWidth;
            geo.height = laneHeights[laneKey] || maxLaneHeight;
            if (!geometryMatchesRounded(lane.getGeometry && lane.getGeometry(), geo)) model.setGeometry(lane, geo);
            if (mode === 'WEEK' && isWeekDayLane(laneKey)) {
                const dayIndex = getWeekDayIndexForLaneKey(laneKey);
                const dayWindow = getBoardWeekWorkHours(board)[dayIndex];
                const label = (getAttr(lane, 'status') || lane.value || '') + (dayWindow && dayWindow.closed ? ' (closed)' : '');
                ensureXmlValue(lane).setAttribute('label', label);
            }
            if (model.isVisible && model.isVisible(lane) === false) model.setVisible(lane, true);
            x += laneWidth + LANE_GAP;
            laidOutLaneCount += 1;
        });

        Object.keys(lanes).forEach(laneKey => {
            const lane = lanes[laneKey];
            if (!lane) return;
            if (!visibleSet.has(laneKey) && (!model.isVisible || model.isVisible(lane) !== false)) model.setVisible(lane, false);
        });

        const totalW = laidOutLaneCount ? x - LANE_GAP + 10 : 20;
        const geo = board.getGeometry().clone();
        geo.width = totalW;
        const weekContentHeight = mode === 'WEEK' ? Math.max(SCHEDULE_MIN_CARD_HEIGHT, maxLaneHeight, laneHeights.TODO_STAGED || 0) : maxLaneHeight;
        geo.height = mode === 'WEEK' ? y + weekContentHeight + BOARD_BOTTOM_PADDING : (getPersistedFullLaneHeight(board) ? y + maxLaneHeight + BOARD_BOTTOM_PADDING : BOARD_GEOM.h);
        if (!geometryMatchesRounded(board.getGeometry && board.getGeometry(), geo)) model.setGeometry(board, geo);
        graph.refresh(board);
    }

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
            const style = getCanonicalLaneStyle(lane.key, false);

            let laneCell = existingByKey[lane.key];

            if (!laneCell) {
                laneCell = createVertex(lane.label, x, y, LANE_W, LANE_H, style);
                model.add(board, laneCell, idx); // CHANGE: insert in defined lane order
                setAttrNoUndo(laneCell, 'lane_key', lane.key, true);
                setAttrNoUndo(laneCell, 'status', lane.label, true);
                existingByKey[lane.key] = laneCell;
            } else {
                laneCell.setStyle(style);
                ensureXmlValue(laneCell).setAttribute('label', lane.label);
                setAttrNoUndo(laneCell, 'status', lane.label, true);

                // Keep existing boards visually aligned with the current LANES array.
                const geo = laneCell.getGeometry() ? laneCell.getGeometry().clone() : new mxGeometry(x, y, LANE_W, LANE_H);
                geo.x = x;
                geo.y = y;
                geo.width = LANE_W;
                geo.height = LANE_H;
                model.setGeometry(laneCell, geo);

                // Keep child order aligned with LANES order.
                if (model.getParent(laneCell) === board) {
                    model.add(board, laneCell, idx);
                }
            }

            graph.refresh(laneCell);
            x += LANE_W + LANE_GAP;
        });

        applyBoardViewLayout(board, existingByKey);
    }

    function lanesMap(board) { // FIX: build lane_key -> lane cell lookup for a board
        const out = {};
        if (!board) return out;

        const n = model.getChildCount(board);
        for (let i = 0; i < n; i++) {
            const ch = model.getChildAt(board, i);
            if (!ch || !model.isVertex(ch)) continue;

            const laneKey = getAttr(ch, 'lane_key');
            if (laneKey) out[laneKey] = ch;
        }

        return out;
    }

    function createBoardLayoutService(api) { // CHANGE: explicit runtime seam for board/lane layout commands
        return Object.freeze({
            ensureBoardTemplateIn: api.ensureBoardTemplateIn,
            createSecondaryBoardIn: api.createSecondaryBoardIn,
            ensureLanes: api.ensureLanes,
            lanesMap: api.lanesMap,
            applyBoardViewLayout: api.applyBoardViewLayout,
            getBoardWeekWorkHours: api.getBoardWeekWorkHours,
            getBoardWeekDayLaneWidths: api.getBoardWeekDayLaneWidths,
            getWeekDayLaneWidth: api.getWeekDayLaneWidth,
            persistWeekDayLaneWidth: api.persistWeekDayLaneWidth,
            getVisibleDateForWeekLane: api.getVisibleDateForWeekLane
        });
    }

    const boardLayoutService = createBoardLayoutService({
        ensureBoardTemplateIn,
        createSecondaryBoardIn,
        ensureLanes,
        lanesMap,
        applyBoardViewLayout,
        getBoardWeekWorkHours,
        getBoardWeekDayLaneWidths,
        getWeekDayLaneWidth,
        persistWeekDayLaneWidth,
        getVisibleDateForWeekLane
    });

    // tiler group completed helpers

    // -------------------- Linked group state adapters --------------------
    function isTilerGroupCompleted(group) {
        return getAttr(group, TG_COMPLETED_ATTR) === '1';
    }

    function setTilerGroupCompleted(group, completed) {
        if (!group) return;
        setAttrNoUndo(group, TG_COMPLETED_ATTR, completed ? '1' : null, true);            // NEW (persist, no refresh)
    }

    function setStyleKey(style, key, val) {
        const re = new RegExp("(^|;)" + key + "=[^;]*", "g");
        const cleaned = String(style || "").replace(re, "");
        const suffix = cleaned && !cleaned.endsWith(";") ? ";" : "";
        return cleaned + suffix + key + "=" + val + ";";
    }

    function removeStyleKeyIfValue(style, key, values) {                                  // NEW: staged reset only removes workflow-owned values
        const allowed = new Set((values || []).map(String));
        const parts = String(style || '').split(';').filter(Boolean);
        const kept = parts.filter(part => {
            const idx = part.indexOf('=');
            if (idx < 0) return true;
            return part.slice(0, idx) !== key || !allowed.has(part.slice(idx + 1));
        });
        return kept.join(';') + (kept.length ? ';' : '');
    }

    function applyCompletedStyleToGroup(group, completed) {
        if (!group) return;

        const cur = group.getStyle ? (group.getStyle() || '') : (group.style || '');

        let next = cur;

        if (completed) {
            next = setStyleKey(next, 'fillStyle', 'zigzag-line');
            next = setStyleKey(next, 'fillColor', '#FF3333');
            next = setStyleKey(next, 'strokeWidth', '3');
        } else {
            // remove only what we added
            next = next.replace(/(^|;)fillStyle=zigzag-line(;|$)/g, '$1');
            next = next.replace(/(^|;)fillColor=#FF3333(;|$)/g, '$1');
            next = next.replace(/(^|;)strokeWidth=3(;|$)/g, '$1');
        }

        if (next !== cur) {
            group.setStyle(next);
        }
    }


    // Lane Helpers
    const PROTECTED_WORK_LANES = new Set(['TODO', 'DOING']);

    function isDoneLikeLane(laneKey) {
        return laneKey === 'DONE' || laneKey === 'DONE_WEEK' ||
            laneKey === 'DONE_MONTH' || laneKey === 'DONE_YEAR' ||
            laneKey === 'ARCHIVED';
    }

    function isWeekDayLane(laneKey) {
        return WEEK_DAY_LANE_KEYS.includes(String(laneKey || ''));
    }

    function isUpcomingLane(lk) {
        return lk === 'UPCOMING_FUTURE' ||
            lk === 'UPCOMING_YEAR' ||
            lk === 'UPCOMING_MONTH' ||
            lk === 'UPCOMING_WEEK';
    }

    function isWorkLane(laneKey) {
        return laneKey === 'UPCOMING_FUTURE' ||
            laneKey === 'UPCOMING_YEAR' ||
            laneKey === 'UPCOMING_MONTH' ||
            laneKey === 'UPCOMING_WEEK' ||
            laneKey === 'TODO_STAGED' ||
            isWeekDayLane(laneKey) ||
            laneKey === 'TODO' ||
            laneKey === 'DOING';
    }

    // -------------------- Runtime calendar adapters --------------------
    const MS_DAY = 86400000;

    function parseLocalISO(iso) { // CHANGE: task dates are local calendar days
        const parsed = parseTaskCalendarISO(iso); // CHANGE: share strict validation with manual shifting
        return parsed ? new Date(parsed.year, parsed.month - 1, parsed.day) : null;
    }

    function startOfLocalDay(d) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    function formatLocalISO(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function todayISO() {
        return formatLocalISO(startOfLocalDay(new Date()));
    }

    let kanbanViewReflowDepth = 0;

    function getSelectedWeekStart(board) {
        return getTaskWeekStartISO(getAttr(board, TASK_SELECTED_WEEK_START_ATTR)) || getTaskWeekStartISO(todayISO());
    }

    function getSelectedDay(board) {
        const weekStart = getSelectedWeekStart(board);
        const raw = getAttr(board, TASK_SELECTED_DAY_ATTR);
        return clampTaskDayToWeek(parseTaskCalendarISO(raw) ? raw : weekStart, weekStart);
    }

    function getBoardViewMode(board) {
        return normalizeTaskViewMode(getAttr(board, TASK_VIEW_MODE_ATTR));
    }

    function getBoardVisibleLaneKeys(board, mode) {
        return taskPolicy.getTaskVisibleLaneKeysForMode(getAttr(board, TASK_VISIBLE_LANE_KEYS_ATTR), mode || getBoardViewMode(board));
    }

    function setBoardLaneVisible(board, laneKey, visible) {
        if (!board || !laneKey) return false;
        const mode = getBoardViewMode(board);
        const allowedKeys = taskPolicy.getTaskViewLaneKeys(mode);
        if (allowedKeys.indexOf(laneKey) < 0) return false;
        const state = taskPolicy.normalizeTaskVisibleLaneKeys(getAttr(board, TASK_VISIBLE_LANE_KEYS_ATTR));
        const selected = new Set(state[mode] || allowedKeys);
        if (visible) selected.add(laneKey);
        else {
            if (!selected.has(laneKey)) return false;
            if (selected.size <= 1) return false;
            selected.delete(laneKey);
        }
        state[mode] = allowedKeys.filter(key => selected.has(key));
        runKanbanViewNoUndo(function () {
            model.beginUpdate();
            try {
                setAttrNoUndo(board, TASK_VISIBLE_LANE_KEYS_ATTR, taskPolicy.serializeTaskVisibleLaneKeys(state), true);
                scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('boardNavigation') });
            } finally {
                model.endUpdate();
            }
        });
        scheduleTaskOverlayGestureRefresh();
        return true;
    }

    function getBoardSortContext(board) {
        return {
            board,
            viewMode: getBoardViewMode(board),
            selectedDay: getSelectedDay(board),
            selectedWeekStart: getSelectedWeekStart(board),
            today: todayISO()
        };
    }

    function selectedWeekDayLaneForBoard(board) {
        if (!board) return null;
        const selected = getSelectionCellsList();
        for (const cell of selected) {
            let cur = cell;
            while (cur && cur !== board) {
                if (isWeekDayLane(getAttr(cur, 'lane_key')) && findBoardAncestor(cur) === board) return cur;
                cur = model.getParent(cur);
            }
        }
        return null;
    }

    function weekDayLaneAncestorForCell(cell, board) {
        let cur = cell;
        while (cur && cur !== board) {
            if (isWeekDayLane(getAttr(cur, 'lane_key')) && (!board || findBoardAncestor(cur) === board)) return cur;
            cur = model.getParent(cur);
        }
        return null;
    }

    function getBoardBadgeContext(board) {
        const context = getBoardSortContext(board);
        if (context.viewMode !== 'WEEK') return context;
        const selectedLane = selectedWeekDayLaneForBoard(board);
        if (!selectedLane) return Object.assign(context, { weekBadgeAnchor: 'WEEK' });
        const laneDay = getDateForWeekLaneKey(getAttr(selectedLane, 'lane_key'), context.selectedWeekStart);
        return Object.assign(context, { weekBadgeAnchor: 'DAY', selectedDay: laneDay || context.selectedDay });
    }

    function ensureBoardPlanningDefaults(board) {
        if (!board) return;
        const today = todayISO();
        const weekStart = getTaskWeekStartISO(today);
        if (!getAttr(board, TASK_VIEW_MODE_ATTR)) setAttrNoUndo(board, TASK_VIEW_MODE_ATTR, 'FULL', true);
        if (getAttr(board, TASK_VIEW_MODE_ATTR) === 'DAY') setAttrNoUndo(board, TASK_VIEW_MODE_ATTR, 'WEEK', true);
        if (!parseTaskCalendarISO(getAttr(board, TASK_SELECTED_WEEK_START_ATTR))) setAttrNoUndo(board, TASK_SELECTED_WEEK_START_ATTR, weekStart, true);
        if (!parseTaskCalendarISO(getAttr(board, TASK_SELECTED_DAY_ATTR))) setAttrNoUndo(board, TASK_SELECTED_DAY_ATTR, weekStart, true);
        if (!parseJsonObject(getAttr(board, TASK_WORK_HOURS_DEFAULTS_ATTR))) setAttrNoUndo(board, TASK_WORK_HOURS_DEFAULTS_ATTR, serializeWeekWorkHours(defaultWeekWorkHours()), true);
    }

    function runKanbanViewNoUndo(fn) {
        const undoManager = ui && ui.editor && ui.editor.undoManager;
        const beforeLength = undoManager && Array.isArray(undoManager.history) ? undoManager.history.length : null;
        const beforeIndex = undoManager && typeof undoManager.indexOfNextAdd === 'number' ? undoManager.indexOfNextAdd : null;
        kanbanViewReflowDepth += 1;
        try {
            return fn();
        } finally {
            kanbanViewReflowDepth -= 1;
            if (beforeLength != null && undoManager.history.length > beforeLength) {
                undoManager.history.splice(beforeLength);
                if (beforeIndex != null) undoManager.indexOfNextAdd = Math.min(beforeIndex, undoManager.history.length);
            }
        }
    }

    function isKanbanViewReflowing() {
        return kanbanViewReflowDepth > 0;
    }

    function daysUntil(dateISO) {
        const dt = parseLocalISO(dateISO);
        if (!dt) return null;
        const today = startOfLocalDay(new Date());
        return Math.round((dt - today) / MS_DAY); // CHANGE: local day delta
    }

    function daysSince(dateISO) {
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

    function hasCardDateOverride(card) {
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
        const shouldReflow = !!(opts && opts.reflow);
        const board = shouldReflow ? findBoardAncestor(card) : null;
        if (shouldReflow && !board) return false;

        model.beginUpdate();
        try {
            model.setValue(card, cloneCardValueWithAttributes(card, attributes));
            if (shouldReflow) {
                scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('dateEdit') });
            } else {
                updateBadgeForLane(card, laneKeyOfCard(card), true); // CHANGE: note-only edits refresh badges without board classification
            }
        } finally {
            model.endUpdate();
        }

        if (!shouldReflow) graph.refresh(card);
        return true;
    }

    function applyCardDateOverride(card, newStartISO) {
        if (!canEditCardDates(card)) return false;
        const patch = buildCardDateOverridePatch(card.value, newStartISO);
        if (!patch || patch.changed === false) return false;
        return commitCardPatch(card, patch.attributes, { reflow: true });
    }

    function resetCardDates(card) {
        if (!canEditCardDates(card) || !hasCardDateOverride(card)) return false;
        const patch = buildCardDateResetPatch(card.value);
        return patch ? commitCardPatch(card, patch, { reflow: true }) : false;
    }

    function getCardNote(card) {
        return normalizeCardNote(getAttr(card, CARD_NOTE_ATTR));
    }

    function setCardNote(card, note) {
        if (!card || !isKanbanCard(card)) return false;
        const patch = buildCardNotePatch(card.value, note);
        if (!patch || patch.changed === false) return false;
        return commitCardPatch(card, patch.attributes, { reflow: false });
    }

    function clearCardNote(card) {
        return setCardNote(card, '');
    }

    function fmtSigned(n) {
        if (n == null) return '';
        if (n > 0) return '+' + n;
        return String(n);
    }

    // -------------------- Runtime classification policy --------------------
    function decideUpcomingLaneKey(startISO) {
        const du = daysUntil(startISO);
        if (du == null || du <= 0) return 'TODO_STAGED';
        if (du <= 7) return 'UPCOMING_WEEK';
        if (du <= 30) return 'UPCOMING_MONTH';
        if (du <= 365) return 'UPCOMING_YEAR';
        return 'UPCOMING_FUTURE';
    }

    function classifyDoneLane(ageDays) {
        if (ageDays == null || ageDays < 1) return 'DONE';        // safety default
        if (ageDays <= 7) return 'DONE_WEEK';
        if (ageDays <= 30) return 'DONE_MONTH';
        if (ageDays <= 365) return 'DONE_YEAR';
        return 'ARCHIVED';
    }


    // -------------------- Card presentation helpers --------------------
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
    function renderScheduleTimeBadge(card, laneKey) {
        if (!isWeekDayLane(laneKey)) return '';
        return renderBadge('Time', formatScheduleTimeRange(getAttr(card, TASK_SCHEDULE_START_MINUTE_ATTR), getAttr(card, TASK_SCHEDULE_DURATION_MINUTES_ATTR)));
    }
    function computeBadgesFor(card, laneKey, opts) {
        const startISO = getAttr(card, 'start');
        const endISO = getAttr(card, 'end');
        const compISO = getAttr(card, 'completed');
        if (selectedPeriodStagedSortEnabled(laneKey, opts)) {
            const startText = buildSelectedPeriodStagedStartText(card && card.value, opts);
            return { primaryText: startText || '', html: renderBadge('Start', startText) };
        }
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


    // -------------------- Lane sorting policy --------------------
    function tsFromISO(iso) {
        const d = parseLocalISO(iso);
        return d ? d.getTime() : null;
    }

    function getLaneSortKey(laneKey, card, opts) {
        if (selectedPeriodStagedSortEnabled(laneKey, opts)) return buildSelectedPeriodStagedSortKey(card && card.value, opts);
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
            if (model.isVertex(c) && isRenderableKanbanCard(c)) {
                const key = getLaneSortKey(laneKey, c, opts);
                const title = (getAttr(c, 'title') || '').toLowerCase();
                items.push({ cell: c, key, title });
            }
        }
        if (!items.length) return [];

        // Choose comparator                                                                                
        let cmp;
        if (selectedPeriodStagedSortEnabled(laneKey, opts)) {
            cmp = (a, b) => compareSelectedPeriodStagedSortKeys(a.key, b.key);
        } else if (isDoneLikeLane(laneKey)) {
            // Descending by timestamp (recent first). Nulls already mapped to -INF so they end last.       
            cmp = (a, b) => (b.key - a.key) || a.title.localeCompare(b.title);
        } else {
            // Ascending. Nulls mapped to +INF so they end last.                                            
            cmp = (a, b) => (a.key - b.key) || a.title.localeCompare(b.title);
        }

        const sorted = items.slice().sort(cmp);

        // Reinsert in desired order                                                                        
        const insideUpdate = opts && opts.insideUpdate;
        if (!insideUpdate) model.beginUpdate();
        try {
            for (let i = 0; i < sorted.length; i++) {
                const c = sorted[i].cell;
                model.add(lane, c, i);
            }
        } finally {
            if (!insideUpdate) model.endUpdate();
        }

        // Return sorted card cells for paging                                                   
        return sorted.map(entry => entry.cell);
    }


    // -------------------- Lane paging commands --------------------

    function taskCellId(cell) {
        return String(cell && (cell.id || (cell.getId && cell.getId())) || '');
    }

    function setCellVisibleNoUndo(cell, visible) { // NEW: cached page visibility persists without creating an undo edit
        const next = !!visible;
        const current = !model.isVisible || model.isVisible(cell);
        if (current === next) return false;
        if (cell && typeof cell.setVisible === 'function') cell.setVisible(next);
        else if (cell) cell.visible = next;
        return true;
    }

    function setCellGeometryNoUndo(cell, geometry) { // NEW: paging is view state even when it restacks the visible page
        const current = cell && (cell.getGeometry ? cell.getGeometry() : cell.geometry);
        if (!cell || !geometry || geometryMatchesRounded(current, geometry)) return false;
        if (typeof cell.setGeometry === 'function') cell.setGeometry(geometry);
        else cell.geometry = geometry;
        return true;
    }

    function setLanePageLabelNoUndo(lane, pageIndex, pageCount) {
        const value = ensureXmlValue(lane);
        const baseLabel = String(getAttr(lane, 'status') || '');
        const nextLabel = pageCount > 1 ? `${baseLabel}\nPage ${pageIndex + 1} of ${pageCount}` : baseLabel;
        if ((value.getAttribute('label') || '') === nextLabel) return false;
        value.setAttribute('label', nextLabel);
        return true;
    }

    function findPageIndexForCardIndex(pages, cardIndex) {
        const index = (pages || []).findIndex(page => cardIndex >= page.start && cardIndex < page.end);
        return index >= 0 ? index : 0;
    }

    function applyPersistedHeightClamps(cards, plan) {
        let changed = false;
        (cards || []).forEach((card, index) => {
            const geo = card && (card.getGeometry ? card.getGeometry() : card.geometry);
            const nextHeight = plan.heights[index];
            if (!geo || nextHeight == null || Math.round(Number(geo.height) || 0) === nextHeight) return;
            const nextGeo = geo.clone ? geo.clone() : new mxGeometry(geo.x || 0, geo.y || 0, geo.width || 160, geo.height || nextHeight);
            nextGeo.height = nextHeight;
            changed = setCellGeometryNoUndo(card, nextGeo) || changed;
            persistFullCardHeight(card, nextHeight); // NEW: destructive clamp is intentionally persisted without undo
        });
        return changed;
    }

    function layoutVisibleLanePageNoUndo(lane, cards, plan, page) { // NEW: mirrors mxStackLayout without generating geometry edits
        const laneGeo = lane && (lane.getGeometry ? lane.getGeometry() : lane.geometry);
        if (!laneGeo || !page) return false;
        const x = TASK_LANE_STACK_BORDER;
        const width = Math.max(TASK_LANE_MIN_CARD_HEIGHT, Math.round(Number(laneGeo.width) || LANE_W) - (TASK_LANE_STACK_BORDER * 2));
        let y = TASK_LANE_HEADER_HEIGHT + TASK_LANE_STACK_BORDER + plan.pagerMarginTop;
        let changed = false;
        for (let index = page.start; index < page.end; index++) {
            const card = cards[index];
            const geo = card && (card.getGeometry ? card.getGeometry() : card.geometry);
            if (!geo) continue;
            const nextGeo = geo.clone ? geo.clone() : new mxGeometry(geo.x || 0, geo.y || 0, geo.width || width, geo.height || plan.heights[index]);
            nextGeo.x = x;
            nextGeo.y = y;
            nextGeo.width = width;
            nextGeo.height = plan.heights[index];
            changed = setCellGeometryNoUndo(card, nextGeo) || changed;
            y += nextGeo.height + TASK_LANE_STACK_SPACING;
        }
        return changed;
    }

    function setPagingSelectionCell(cell) {
        if (!cell || !graph.setSelectionCell) return;
        taskPagingSelectionGuard = true;
        try { graph.setSelectionCell(cell); } finally { taskPagingSelectionGuard = false; }
    }

    function applyLanePaging(lane, laneKey, sortedCards, opts) { // CHANGE: task manager owns height planning, visibility, anchor, and selection repair
        if (!lane) return null;
        const options = opts || {};
        const renderableCards = (sortedCards || []).filter(isRenderableKanbanCard);
        const allLaneCards = []; // NEW: rebuild the complete persisted visibility cache, including excluded occurrences
        for (let childIndex = 0; childIndex < model.getChildCount(lane); childIndex++) {
            const child = model.getChildAt(lane, childIndex);
            if (child && model.isVertex(child) && isKanbanCard(child)) allLaneCards.push(child);
        }
        allLaneCards.filter(card => renderableCards.indexOf(card) < 0).forEach(card => setCellVisibleNoUndo(card, false));
        setAttrNoUndo(lane, 'page_index', null, true); // CHANGE: legacy numeric state always resets during migration

        if (isWeekDayLane(laneKey)) { // NEW: time-based schedule lanes are never paged
            setAttrNoUndo(lane, TASK_PAGE_ANCHOR_ATTR, null, true);
            renderableCards.forEach(card => setCellVisibleNoUndo(card, true));
            lanePagingStates.delete(taskCellId(lane));
            requestLanePagerOverlayRefresh();
            return null;
        }

        const laneGeo = lane.getGeometry ? lane.getGeometry() : lane.geometry;
        const plan = buildTaskLanePagePlan(renderableCards.map(card => {
            const geo = card && (card.getGeometry ? card.getGeometry() : card.geometry);
            return geo ? geo.height : DEFAULT_TASK_CARD_HEIGHT;
        }), laneGeo ? laneGeo.height : TASK_LANE_MIN_HEIGHT);
        let changed = applyPersistedHeightClamps(renderableCards, plan);
        let pageIndex = 0;

        if (plan.paged) {
            if (Number.isFinite(Number(options.targetPageIndex))) {
                pageIndex = Math.max(0, Math.min(plan.pages.length - 1, Math.trunc(Number(options.targetPageIndex))));
            } else {
                const anchorId = options.anchorCardId == null ? getAttr(lane, TASK_PAGE_ANCHOR_ATTR) : String(options.anchorCardId);
                const anchorIndex = renderableCards.findIndex(card => taskCellId(card) === String(anchorId || ''));
                pageIndex = anchorIndex >= 0 ? findPageIndexForCardIndex(plan.pages, anchorIndex) : 0; // NEW: missing anchors reset to page one
            }
            const anchorCard = renderableCards[plan.pages[pageIndex].start];
            setAttrNoUndo(lane, TASK_PAGE_ANCHOR_ATTR, taskCellId(anchorCard), true); // NEW: canonical page-first rebasing
        } else {
            setAttrNoUndo(lane, TASK_PAGE_ANCHOR_ATTR, null, true);
        }

        const page = plan.pages[pageIndex] || { start: 0, end: 0 };
        renderableCards.forEach((card, index) => {
            changed = setCellVisibleNoUndo(card, index >= page.start && index < page.end) || changed;
        });
        if (plan.paged) changed = layoutVisibleLanePageNoUndo(lane, renderableCards, plan, page) || changed; // CHANGE: leave authored geometry untouched when no pager is needed
        const nextStyle = setStyleKey(getCellStyleText(lane), 'marginTop', String(plan.pagerMarginTop));
        if (lane.getStyle() !== nextStyle) { lane.setStyle(nextStyle); changed = true; }
        changed = setLanePageLabelNoUndo(lane, pageIndex, plan.pages.length) || changed;

        const state = { lane, laneKey, board: findBoardAncestor(lane), cards: renderableCards, plan, pageIndex };
        lanePagingStates.set(taskCellId(lane), state);
        if (changed) {
            if (graph.view && graph.view.invalidate) graph.view.invalidate(lane, true, true);
            graph.refresh(lane);
        }

        if (options.explicitNavigation) {
            setPagingSelectionCell(lane); // NEW: every real page change falls back to its lane
        }
        requestLanePagerOverlayRefresh();
        return state;
    }

    function navigateLaneToPage(lane, laneKey, targetPageIndex) {
        const current = lanePagingStates.get(taskCellId(lane));
        const currentIndex = current ? current.pageIndex : 0;
        const targetIndex = Math.trunc(Number(targetPageIndex));
        if (!Number.isFinite(targetIndex) || targetIndex === currentIndex) return current;
        return applyLanePaging(lane, laneKey, getLaneCardsInOrder(lane), { targetPageIndex: targetIndex, explicitNavigation: true });
    }

    function changeLanePage(lane, laneKey, delta) {
        if (!lane) return null;
        const current = lanePagingStates.get(taskCellId(lane)) || applyLanePaging(lane, laneKey, getLaneCardsInOrder(lane), { skipSelectionRepair: true });
        return navigateLaneToPage(lane, laneKey, (current ? current.pageIndex : 0) + delta);
    }


    function getLaneCardsInOrder(lane) {
        const out = [];
        if (!lane) return out;
        const n = model.getChildCount(lane);
        for (let i = 0; i < n; i++) {
            const c = model.getChildAt(lane, i);
            if (model.isVertex(c) && isRenderableKanbanCard(c)) {
                out.push(c);
            }
        }
        return out;
    }

    function getScheduleLaneCardsInOrder(board, lane, laneKey) {
        return getOrderedScheduleLaneCards(board, lane, laneKey);
    }


    function resortAndPageLane(lane, laneKey, opts) {
        if (isWeekDayLane(laneKey)) { // NEW: manual stack order is schedule order
            const board = (opts && opts.board) || findBoardAncestor(lane);
            const cards = getScheduleLaneCardsInOrder(board, lane, laneKey);
            applyLanePaging(lane, laneKey, cards);
            applySchedulePlanToDayLane(board, lane, laneKey, { refresh: false });
            return;
        }
        const sortedCards = sortLaneCards(lane, laneKey, opts) || [];
        const pageOptions = {};
        if (opts && opts.resetSelectedPeriodStagedPage && selectedPeriodStagedSortEnabled(laneKey, opts)) pageOptions.anchorCardId = ''; // NEW: selected-period changes start from the newly sorted first page
        applyLanePaging(lane, laneKey, sortedCards, pageOptions);
    }

    function refreshSelectedPeriodStagedBadges(board, opts) {
        if (!board) return false;
        const lane = boardLanes(board).TODO_STAGED;
        if (!lane) return false;
        let changed = false;
        const insideUpdate = opts && opts.insideUpdate;
        if (!insideUpdate) model.beginUpdate();
        try {
            snapshotLaneCards(lane).forEach(card => {
                if (!isRenderableKanbanCard(card)) return;
                changed = updateBadgeForLane(card, 'TODO_STAGED', true) || changed;
            });
        } finally {
            if (!insideUpdate) model.endUpdate();
        }
        if (changed) graph.refresh(lane);
        return changed;
    }

    // -------------------- Card label rendering --------------------
    function refreshCardLabel(card, suppressRefresh) {
        if (getAttr(card, 'kanban_card') !== '1') return;
        const title = mxUtils.htmlEntities(getAttr(card, 'title') || 'Task');
        const parent = model.getParent(card);
        const laneKey = parent ? getAttr(parent, 'lane_key') : null;
        const badgesHtml = getAttr(card, 'badges_html') || '';
        const board = findBoardAncestor(card);
        const viewMode = board ? getBoardViewMode(board) : 'FULL';

        const linkCount = getLinkCount(card);
        const linkBadge = (linkCount > 1) ? renderBadge('Links', linkCount) : '';
        const noteBadge = renderBadge('Note', getCardNote(card));
        const editedDateBadge = hasCardDateOverride(card) ? renderBadge('Dates', 'Edited') : '';
        const repeatBadge = renderBadge('Repeat', getAttr(card, REPEAT_BADGE_ATTR));
        const scheduleTimeBadge = renderScheduleTimeBadge(card, laneKey);
        const stateBadge = viewMode === 'WEEK' && getEffectiveWorkflowState(card.value, laneKey) === 'DOING' ? renderBadge('State', 'DOING') : '';
        const missingBadge = viewMode !== 'FULL' && getAttr(card, TASK_SCHEDULER_MISSING_ATTR) === '1' ? renderBadge('Scheduler', 'Missing') : '';
        const incompleteBadge = viewMode !== 'FULL' ? renderBadge('Incomplete', getAttr(card, TASK_INCOMPLETE_DAY_ATTR)) : '';

        const badgesBlock = (scheduleTimeBadge || badgesHtml || stateBadge || missingBadge || incompleteBadge || repeatBadge || noteBadge || editedDateBadge || linkBadge)
            ? ('<br/>' + scheduleTimeBadge + badgesHtml + stateBadge + missingBadge + incompleteBadge + repeatBadge + noteBadge + editedDateBadge + linkBadge)
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
        const board = findBoardAncestor(card);
        const context = badgeContext || (board ? getBoardBadgeContext(board) : { viewMode: 'FULL' });
        const fields = [
            laneKey || '',
            context.viewMode || '',
            context.selectedDay || '',
            context.selectedWeekStart || '',
            context.weekBadgeAnchor || '',
            context.today || '',
            board ? getBoardViewMode(board) : 'FULL',
            getAttr(card, 'title') || '',
            getAttr(card, 'start') || '',
            getAttr(card, 'end') || '',
            getAttr(card, 'completed') || '',
            getAttr(card, TASK_WORKFLOW_STATE_ATTR) || '',
            getAttr(card, TASK_ASSIGNED_DAY_ATTR) || '',
            getAttr(card, TASK_SCHEDULE_START_MINUTE_ATTR) || '',
            getAttr(card, TASK_SCHEDULE_DURATION_MINUTES_ATTR) || '',
            getAttr(card, TASK_SCHEDULER_MISSING_ATTR) || '',
            getAttr(card, TASK_INCOMPLETE_DAY_ATTR) || '',
            getAttr(card, REPEAT_BADGE_ATTR) || '',
            getAttr(card, REPEAT_HIDDEN_ATTR) || '',
            getAttr(card, 'year_hidden') || '',
            getAttr(card, 'date_override') || '',
            getAttr(card, 'base_start') || '',
            getAttr(card, 'base_end') || '',
            getCardNote(card) || '',
            getAttr(card, LINK_ATTR) || '',
            getLinkCount(card)
        ];
        return fields.map(value => String(value).replace(/[|\\]/g, '\\$&')).join('|');
    }

    function updateBadgeForLane(card, laneKey, suppressRefresh) {
        const oldBadge = getAttr(card, 'badge') || '';
        const oldHtml = getAttr(card, 'badges_html') || '';
        const board = findBoardAncestor(card);
        const badgeContext = board ? getBoardBadgeContext(board) : { viewMode: 'FULL' };
        const signature = buildCardBadgeInputSignature(card, laneKey, badgeContext);
        if (card.__trellisTaskBadgeSignature === signature) { bumpTaskReflowTestCounter('labelWriteSkip'); return false; }

        const badges = computeBadgesFor(card, laneKey, badgeContext);
        const newBadge = badges.primaryText || '';
        const newHtml = badges.html || '';

        if (oldBadge === newBadge && oldHtml === newHtml) {
            card.__trellisTaskBadgeSignature = signature;
            refreshCardLabel(card, suppressRefresh);
            return false;
        }

        setBadge(card, newBadge, true);
        setAttrNoUndo(card, 'badges_html', newHtml, true);
        card.__trellisTaskBadgeSignature = signature;
        refreshCardLabel(card, suppressRefresh);
        return true;
    }




    // Delete old / unlink tasks
    function removeTasksLinkedOnlyTo(targetGroupId, opts) {
        if (!targetGroupId) return [];

        const grp = model.getCell(targetGroupId);
        if (!grp) return [];

        const linkedCells = getLinkedCellsOf(grp) || [];
        if (!linkedCells.length) return [];

        const affectedBoards = new Map();
        const groupLinkSet = getLinkSet(grp);
        const preserveCardIds = opts && opts.preserveCardIds instanceof Set ? opts.preserveCardIds : new Set();
        const insideUpdate = !!(opts && opts.insideUpdate);

        if (!insideUpdate) model.beginUpdate();
        try {
            for (const c of linkedCells) {
                if (!isKanbanCard(c)) continue;

                const linkSet = getLinkSet(c);
                if (!linkSet || !linkSet.has(targetGroupId)) continue;

                const board = findBoardAncestor(c);
                if (board) affectedBoards.set(board.id, board);

                if (preserveCardIds.has(String(c.id || (c.getId && c.getId()) || ''))) {
                    markGeneratedTaskCardMissing(c, affectedBoards); // NEW: retain unsafe or removed assignment occurrences as one scheduler user-touch transaction
                    continue;
                }

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
            if (!insideUpdate) model.endUpdate();
        }

        const boards = Array.from(affectedBoards.values());

        const shouldReflow = !opts || opts.reflow !== false;
        if (shouldReflow) {
            boards.forEach(board => scanAndReflowBoard(board, opts && opts.insideUpdate ? { insideUpdate: true } : undefined));
        }

        return boards;
    }



    // -------------------- Task creation and card commands --------------------
    function createTasks(tasks, targetGroupId, opts) {
        if (!Array.isArray(tasks) || tasks.length === 0) return [];

        const reflow = !opts || opts.reflow !== false;
        const assignmentIdsByTaskKey = opts && opts.assignmentIdsByTaskKey;
        const insideUpdate = !!(opts && opts.insideUpdate);
        const focusCreated = !opts || opts.focusCreated !== false; // NEW: scheduler saves can create cards without stealing graph focus

        let gardenModule = null;
        const grp = model.getCell(targetGroupId);
        if (grp) {
            const gm = findGardenModuleAncestor(grp);
            if (gm) gardenModule = gm;
        }

        const out = [];

        if (!insideUpdate) model.beginUpdate();
        try {
            const { board, lanes } = boardLayoutService.ensureBoardTemplateIn(gardenModule, { insideUpdate: true, createMainBoard: true });
            if (!board) return out;

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
                if (t.variety_name) setAttrNoUndo(card, 'variety_name', t.variety_name);
                const schedulerAttrs = buildSchedulerTaskMetadataAttributes(t);
                Object.keys(schedulerAttrs).forEach(function (key) { setAttrNoUndo(card, key, schedulerAttrs[key]); });
                const schedulerTaskKey = String(schedulerAttrs.scheduler_task_key || '');
                const preservedAssignees = schedulerTaskKey && assignmentIdsByTaskKey && assignmentIdsByTaskKey.get ? assignmentIdsByTaskKey.get(schedulerTaskKey) : null;
                if (preservedAssignees && preservedAssignees.length) setAttrNoUndo(card, TASK_ASSIGNEE_ROLE_IDS_ATTR, serializeTaskAssigneeRoleIds(preservedAssignees), true);

                if (grp) linkBothWays(grp, card);
                updateBadgeForLane(card, getAttr(parentLane, 'lane_key'));

                out.push({ cellId: card.id, title: t.title });
            }

            // Run scan only on the affected board inside the same transaction
            if (board && reflow) {
                scanAndReflowBoard(board, { insideUpdate: true });
            }

        } finally {
            if (!insideUpdate) model.endUpdate();
        }

        if (focusCreated && out.length) { // CHANGE: preserve existing manual-create focus unless callers explicitly suppress it
            const last = out // CHANGE: never select a newly collapsed or paged-out repeat occurrence
                .slice()
                .reverse()
                .map(entry => model.getCell(entry.cellId))
                .find(cell => cell && isRenderableKanbanCard(cell) && (!model.isVisible || model.isVisible(cell)));
            if (last) {
                graph.setSelectionCell(last);
                graph.scrollCellToVisible(last, true);
            }
        }

        return out;
    }


    function createCard(parentLane, { title, notes, startISO, endISO }, suppressRefresh) {
        const card = createVertex('', 0, 0, 160, DEFAULT_TASK_CARD_HEIGHT, CARD_STYLE);
        model.add(parentLane, card, model.getChildCount(parentLane));
        setAttrNoUndo(card, 'kanban_card', '1', /*suppressRefresh*/ !!suppressRefresh);
        setAttrNoUndo(card, 'title', title || 'Task', !!suppressRefresh);
        if (notes) setAttrNoUndo(card, 'notes', notes, !!suppressRefresh);
        const dateAttributes = buildInitialCardDateAttributes(startISO, endISO);
        if (dateAttributes) {
            Object.entries(dateAttributes).forEach(([key, value]) => {
                setAttrNoUndo(card, key, value, !!suppressRefresh);
            });
        } else { // NEW: retain legacy tolerance for incomplete externally supplied tasks
            if (startISO) setAttrNoUndo(card, 'start', startISO, !!suppressRefresh);
            if (endISO) setAttrNoUndo(card, 'end', endISO, !!suppressRefresh);
        }
        const laneStatus = getAttr(parentLane, 'status') || parentLane.value || '';
        setAttrNoUndo(card, 'status', laneStatus, !!suppressRefresh);
        setAttrNoUndo(card, TASK_WORKFLOW_STATE_ATTR, 'STAGED', !!suppressRefresh);
        setAttrNoUndo(card, 'badge', '', !!suppressRefresh);
        setAttrNoUndo(card, 'badges_html', '', !!suppressRefresh);
        refreshCardLabel(card, !!suppressRefresh);
        return card;
    }




    // -------------------- Linking and scheduler sync commands --------------------
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

    function rememberBoardForTaskSync(affectedBoards, card) {
        const board = findBoardAncestor(card);
        if (board) affectedBoards.set(board.id, board);
    }

    function historyCellIds(cells) {
        return (cells || []).map(cell => cell && (cell.id || (cell.getId && cell.getId()))).filter(Boolean).map(String);
    }

    function runTrellisHistoryTransaction(metadata, operation) {
        const history = typeof window !== "undefined" && window.Trellis && window.Trellis.history;
        if (history && typeof history.run === "function" && !isTrellisHistoryRestoring()) {
            return history.run(metadata, operation);
        }
        return operation();
    }

    function isTrellisHistoryRestoring() {
        const history = typeof window !== "undefined" && window.Trellis && window.Trellis.history;
        return !!(history && typeof history.isRestoring === "function" && history.isRestoring());
    }

    function buildDifferentialTaskSyncRecords(targetGroupId) {
        const grp = targetGroupId ? model.getCell(targetGroupId) : null;
        if (!grp) return null;
        const records = getLinkedCellsOf(grp)
            .filter(cell => isKanbanCard(cell))
            .filter(card => getLinkSet(card).has(targetGroupId))
            .map(card => ({ card, source: card.value, schedulerTaskKey: getSchedulerTaskKey(card.value), laneKey: laneKeyOfCard(card) }));
        return { group: grp, records };
    }

    function replaceTasksPreservingAssignments(targetGroupId, tasks, opts) {
        const normalizedTasks = Array.isArray(tasks) ? tasks : [];
        const options = opts || {};
        const operation = function () {
            const source = buildDifferentialTaskSyncRecords(targetGroupId);
            const preservation = planTaskAssignmentReplacement(source && source.records, normalizedTasks);
            const assignmentIdsByTaskKey = new Map(preservation.preserved.map(entry => [entry.key, entry.roleIds]));
            const preserveCardIds = new Set(preservation.retainMissing.map(record => String(record.card && (record.card.id || (record.card.getId && record.card.getId())) || '')));
            removeTasksLinkedOnlyTo(targetGroupId, { reflow: !normalizedTasks.length, preserveCardIds, insideUpdate: !!options.insideUpdate });
            return normalizedTasks.length ? createTasks(normalizedTasks, targetGroupId, { reflow: true, assignmentIdsByTaskKey, insideUpdate: !!options.insideUpdate, focusCreated: options.focusCreated !== false }) : [];
        };
        if (options.insideUpdate) return operation();
        return runTrellisHistoryTransaction({ category: "Tasks", action: "replace", origin: "Garden_Task_Manager", title: "Replace linked tasks", affectedCellIds: [targetGroupId].filter(Boolean) }, operation);
    }

    function applyGeneratedTaskAttributesToCard(card, task, lanes) {
        const attributes = buildGeneratedTaskSyncAttributesForExisting(card.value, task);
        model.setValue(card, cloneCardValueWithAttributes(card, attributes));
        if (!isSchedulerDateLocked(card.value)) putInLane(card, lanes, decideUpcomingLaneKey(task.startISO), true);
        refreshCardLabel(card, true);
    }

    function removeOrUnlinkGeneratedTaskCard(targetGroupId, card, affectedBoards) {
        const grp = targetGroupId ? model.getCell(targetGroupId) : null;
        if (!grp) return;
        rememberBoardForTaskSync(affectedBoards, card);
        const cardLinks = getLinkSet(card);
        const groupLinks = getLinkSet(grp);
        groupLinks.delete(card.id);
        setLinkSet(grp, groupLinks);
        if (cardLinks.size <= 1) {
            model.remove(card);
            return;
        }
        cardLinks.delete(targetGroupId);
        setLinkSet(card, cardLinks);
    }

    function markGeneratedTaskCardMissing(card, affectedBoards) {
        rememberBoardForTaskSync(affectedBoards, card);
        model.setValue(card, cloneCardValueWithAttributes(card, { [TASK_SCHEDULER_MISSING_ATTR]: '1' }));
        refreshCardLabel(card, true);
    }

    function applyDifferentialTaskSync(opts) {
        opts = opts || {};
        const targetGroupId = opts.targetGroupId;
        const tasks = Array.isArray(opts.tasks) ? opts.tasks : []; // CHANGE: the sync command owns its input guard and does not depend on an undefined global normalizer
        const insideUpdate = !!opts.insideUpdate;
        const focusCreated = opts.focusCreated !== false; // NEW: sync callers choose whether generated creations should steal focus
        const syncSource = buildDifferentialTaskSyncRecords(targetGroupId);
        if (!syncSource) return [];
        const plan = planDifferentialTaskSync(syncSource.records, tasks);
        if (plan.legacyReplace) {
            return replaceTasksPreservingAssignments(targetGroupId, tasks, { insideUpdate, focusCreated });
        }
        if (!plan.updates.length && !plan.removes.length && !plan.missing.length) {
            if (plan.creates.length) createTasks(plan.creates.map(item => item.task), targetGroupId, { reflow: true, insideUpdate, focusCreated });
            return plan;
        }

        const affectedBoards = new Map();
        const gardenModule = findGardenModuleAncestor(syncSource.group);
        if (!insideUpdate) model.beginUpdate();
        try {
            const template = boardLayoutService.ensureBoardTemplateIn(gardenModule, { insideUpdate: true, createMainBoard: true });
            if (!template || !template.board) return plan;
            plan.updates.forEach(item => {
                rememberBoardForTaskSync(affectedBoards, item.record.card);
                applyGeneratedTaskAttributesToCard(item.record.card, item.task, template.lanes);
                rememberBoardForTaskSync(affectedBoards, item.record.card);
            });
            plan.removes.forEach(item => {
                removeOrUnlinkGeneratedTaskCard(targetGroupId, item.record.card, affectedBoards);
            });
            plan.missing.forEach(item => {
                markGeneratedTaskCardMissing(item.record.card, affectedBoards);
            });
        } finally {
            if (!insideUpdate) model.endUpdate();
        }

        if (plan.creates.length) createTasks(plan.creates.map(item => item.task), targetGroupId, { reflow: true, insideUpdate, focusCreated });
        affectedBoards.forEach(board => scanAndReflowBoard(board, { skipPurge: true, insideUpdate }));
        return plan;
    }


    // -------------------- Board reflow orchestration --------------------

    function findBoardAncestor(cell) {
        let cur = cell;
        while (cur) {
            const key = getAttr(cur, 'board_key');
            if (key === BOARD_KEY || key === LEGACY_KANBAN_BOARD_KEY) return cur;
            cur = model.getParent(cur);
        }
        return null;
    }

    function markDirtyLane(dirtyLanes, lane) {
        if (!dirtyLanes || !lane) return;
        const laneKey = getAttr(lane, 'lane_key');
        if (!laneKey) return;
        dirtyLanes.set(lane.id, { lane, laneKey });
    }

    function markDirtyCardLane(dirtyLanes, card) {
        if (!card) return;
        markDirtyLane(dirtyLanes, model.getParent(card));
    }

    function snapshotLaneCards(lane) {
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

    function snapshotBoardCardsByLane(lanes) {
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
        const records = [];
        const lanes = boardLanes(board);

        snapshotBoardCardsByLane(lanes).forEach(snapshot => {
            snapshot.cards.forEach(card => {
                records.push({
                    id: card.id,
                    card,
                    laneKey: snapshot.laneKey,
                    seriesKey: buildRepeatSeriesKey(card.value),
                    startISO: getAttr(card, 'start'),
                    endISO: getAttr(card, 'end'),
                    yearHidden: isYearHiddenCard(card),
                    expanded: getAttr(card, REPEAT_EXPANDED_ATTR) === '1'
                });
            });
        });

        return records;
    }

    function setDerivedCardAttribute(card, key, value) { // NEW: derived attributes do not create separate undo steps
        const current = getAttr(card, key);
        const next = value == null || value === '' ? null : String(value);
        if ((current == null ? null : String(current)) === next) return false;
        setAttrNoUndo(card, key, next, true);
        return true;
    }

    function applyScheduleCardVisualStyle(card, laneKey, overflow) {
        if (!card || !isWeekDayLane(laneKey)) return false;
        let nextStyle = card.getStyle ? card.getStyle() : card.style || '';
        const before = nextStyle;
        if (isScheduleBreakCard(card)) {
            nextStyle = setStyleKey(nextStyle, 'fillColor', '#F3F4F6');
            nextStyle = setStyleKey(nextStyle, 'strokeColor', overflow ? '#B91C1C' : '#6B7280');
        } else {
            const state = getEffectiveWorkflowState(card.value, laneKey);
            nextStyle = setStyleKey(nextStyle, 'fillColor', WORKFLOW_CARD_FILL[state] || WORKFLOW_CARD_FILL.TODO);
            nextStyle = setStyleKey(nextStyle, 'strokeColor', overflow ? '#B91C1C' : '#000000');
        }
        if (nextStyle === before) return false;
        card.setStyle(nextStyle);
        return true;
    }

    function applyStagedCardVisualStyle(card, laneKey) { // NEW: moving back to staged clears week workflow colors
        if (!card || String(laneKey || '') !== 'TODO_STAGED' || isScheduleBreakCard(card)) return false;
        let nextStyle = card.getStyle ? card.getStyle() : card.style || '';
        const before = nextStyle;
        nextStyle = setStyleKey(nextStyle, 'fillColor', 'swimlane');
        nextStyle = removeStyleKeyIfValue(nextStyle, 'strokeColor', ['#000000', '#B91C1C']);
        if (nextStyle === before) return false;
        card.setStyle(nextStyle);
        return true;
    }

    function syncScheduleLanePhysicalOrder(lane, records) {
        let changed = false;
        (records || []).forEach((record, index) => {
            if (!record || !record.cell) return;
            if (model.getChildAt(lane, index) === record.cell) return;
            model.add(lane, record.cell, index);
            changed = true;
        });
        return changed;
    }

    function persistScheduleLaneOrder(records, visibleDay) {
        let changed = false;
        (records || []).forEach((record, index) => {
            if (!record || !record.cell) return;
            changed = setDerivedCardAttribute(record.cell, TASK_SCHEDULE_ORDER_ATTR, index) || changed;
            changed = setDerivedCardAttribute(record.cell, TASK_SCHEDULE_ORDER_DAY_ATTR, visibleDay) || changed;
        });
        return changed;
    }

    function applyScheduleCardGeometry(board, lane, card, item, plan) { // CHANGE: use the same canonical lane width as board layout
        const currentGeo = model.getGeometry(card);
        const laneWidth = getWeekDayLaneWidth(board, getAttr(lane, 'lane_key')); // CHANGE: avoid stale pre-layout lane geometry
        const nextWidth = Math.max(SCHEDULE_MIN_CARD_HEIGHT, laneWidth - (SCHEDULE_CARD_HORIZONTAL_INSET * 2));
        const nextGeo = currentGeo && currentGeo.clone ? currentGeo.clone() : new mxGeometry(SCHEDULE_CARD_HORIZONTAL_INSET, 0, nextWidth, SCHEDULE_MIN_CARD_HEIGHT);
        nextGeo.x = SCHEDULE_CARD_HORIZONTAL_INSET;
        nextGeo.width = nextWidth;
        if (item && plan) { // NEW: closed lanes retain vertical geometry while still matching lane width
            nextGeo.y = schedulePolicy.scheduleMinuteOffsetToPx(item.startMinute - plan.startMinute);
            nextGeo.height = item.height;
        }
        if (geometryMatchesRounded(currentGeo, nextGeo)) return false;
        model.setGeometry(card, nextGeo);
        return true;
    }

    function applySchedulePlanToDayLane(board, lane, laneKey, opts) {
        if (!board || !lane || !isWeekDayLane(laneKey)) return false;
        bumpTaskReflowTestCounter('schedulePack');
        const dayIndex = getWeekDayIndexForLaneKey(laneKey);
        const dayWindow = getBoardWeekWorkHours(board)[dayIndex];
        const visibleDay = getVisibleDateForWeekLane(board, laneKey);
        const records = getLaneScheduleRecords(board, lane, laneKey);
        const plan = buildStackSchedulePlan(records, dayWindow);
        let changed = syncScheduleLanePhysicalOrder(lane, records);
        changed = persistScheduleLaneOrder(records, visibleDay) || changed;
        if (plan.closed) {
            records.forEach(record => {
                changed = applyScheduleCardGeometry(board, lane, record.cell, null, null) || changed; // CHANGE: closed day cards still follow lane-owned horizontal geometry
                const startChanged = setDerivedCardAttribute(record.cell, TASK_SCHEDULE_START_MINUTE_ATTR, null);
                const durationChanged = setDerivedCardAttribute(record.cell, TASK_SCHEDULE_DURATION_MINUTES_ATTR, null);
                const scheduleChanged = startChanged || durationChanged;
                if (scheduleChanged) refreshCardLabel(record.cell, true);
                changed = scheduleChanged || changed;
            });
            clearScheduleLaneOrderDirty(lane);
            return changed;
        }
        plan.items.forEach((item, index) => {
            const record = records[index];
            if (!record || !record.cell) return;
            const startChanged = setDerivedCardAttribute(record.cell, TASK_SCHEDULE_START_MINUTE_ATTR, item.startMinute);
            const durationChanged = setDerivedCardAttribute(record.cell, TASK_SCHEDULE_DURATION_MINUTES_ATTR, item.durationMinutes);
            const scheduleChanged = startChanged || durationChanged;
            if (scheduleChanged) refreshCardLabel(record.cell, true);
            changed = scheduleChanged || changed;
            changed = applyScheduleCardGeometry(board, lane, record.cell, item, plan) || changed;
            changed = applyScheduleCardVisualStyle(record.cell, laneKey, item.overflow) || changed;
        });
        clearScheduleLaneOrderDirty(lane);
        if (changed && (!opts || opts.refresh !== false)) graph.refresh(lane);
        return changed;
    }

    function enforceRepeatHiddenVisibility(card) {
        if (!isRepeatHiddenCard(card)) return false;
        const cur = model.isVisible ? model.isVisible(card) : true;
        if (cur === false) return false;
        model.setVisible(card, false);
        graph.refresh(card);
        return true;
    }

    function rebuildRepeatVisibility(board, dirtyLanes) { // NEW: apply one pure visibility plan per board scan
        const records = getBoardRepeatRecords(board);
        const plan = planRepeatSeriesVisibility(records);
        const cardsById = new Map(records.map(record => [String(record.id || ''), record.card]));
        let changed = false;

        plan.forEach(item => {
            if (!item) return;
            const card = cardsById.get(String(item.id || ''));
            if (!card) return;

            const hiddenChanged = setDerivedCardAttribute(
                card,
                REPEAT_HIDDEN_ATTR,
                item.repeatHidden ? '1' : null
            );
            const badgeChanged = setDerivedCardAttribute(card, REPEAT_BADGE_ATTR, item.repeatBadge || null);
            const visibilityChanged = item.repeatHidden ? enforceRepeatHiddenVisibility(card) : false;

            if (badgeChanged) refreshCardLabel(card, true);
            if (hiddenChanged || badgeChanged || visibilityChanged) {
                markDirtyCardLane(dirtyLanes, card);
                changed = true;
            }
        });

        return changed;
    }

    function boardLanes(board) { return lanesMap(board); }

    function normalizeTaskCardHeight(value, fallback) { // NEW: shared guard for persisted full-view heights and restored geometry
        const numeric = Number(value);
        const fallbackNumeric = Number(fallback);
        const base = Number.isFinite(numeric) ? numeric : (Number.isFinite(fallbackNumeric) ? fallbackNumeric : DEFAULT_TASK_CARD_HEIGHT);
        return Math.max(SCHEDULE_MIN_CARD_HEIGHT, Math.round(base));
    }

    function getPersistedFullCardHeight(card) {
        const raw = getAttr(card, TASK_FULL_CARD_HEIGHT_ATTR);
        return raw == null || raw === '' ? null : normalizeTaskCardHeight(raw, DEFAULT_TASK_CARD_HEIGHT);
    }

    function persistFullCardHeight(card, height) {
        if (!card || isScheduleBreakCard(card)) return false;
        const normalized = normalizeTaskCardHeight(height, DEFAULT_TASK_CARD_HEIGHT);
        const next = normalized === DEFAULT_TASK_CARD_HEIGHT ? null : String(normalized);
        const current = getAttr(card, TASK_FULL_CARD_HEIGHT_ATTR);
        if ((current == null ? null : String(current)) === next) return false;
        setAttrNoUndo(card, TASK_FULL_CARD_HEIGHT_ATTR, next, true);
        return true;
    }

    function persistFullCardHeightFromGeometry(card) {
        const geo = card && model.getGeometry ? model.getGeometry(card) : (card && card.getGeometry ? card.getGeometry() : null);
        return geo ? persistFullCardHeight(card, geo.height) : false;
    }

    function setCardGeometryHeight(card, height) {
        const geo = card && model.getGeometry ? model.getGeometry(card) : (card && card.getGeometry ? card.getGeometry() : null);
        if (!geo) return false;
        const nextHeight = normalizeTaskCardHeight(height, DEFAULT_TASK_CARD_HEIGHT);
        if (roundedGeometryValue(geo.height) === nextHeight) return false;
        const nextGeo = geo.clone ? geo.clone() : new mxGeometry(geo.x || 0, geo.y || 0, geo.width || 160, geo.height || nextHeight);
        nextGeo.height = nextHeight;
        model.setGeometry(card, nextGeo);
        return true;
    }

    function getWeekScheduleHeightForCard(card) {
        const duration = schedulePolicy.snapScheduleMinutes(getAttr(card, TASK_SCHEDULE_DURATION_MINUTES_ATTR), null)
            || schedulePolicy.defaultScheduleDurationFromHours(getAttr(card, 'task_estimated_hours'))
            || 60;
        return schedulePolicy.scheduleMinutesToPx(duration);
    }

    function applyCardHeightForLaneTransition(card, sourceLaneKey, targetLaneKey) {
        if (!card || !isKanbanCard(card) || isScheduleBreakCard(card)) return false;
        const hasSourceLane = !!sourceLaneKey;
        const sourceIsWeek = isWeekDayLane(sourceLaneKey);
        const targetIsWeek = isWeekDayLane(targetLaneKey);
        let changed = false;
        if (hasSourceLane && !sourceIsWeek) changed = persistFullCardHeightFromGeometry(card) || changed;
        if (targetIsWeek) {
            return (!sourceIsWeek ? setCardGeometryHeight(card, getWeekScheduleHeightForCard(card)) : false) || changed;
        }
        if (sourceIsWeek) {
            return setCardGeometryHeight(card, getPersistedFullCardHeight(card) || DEFAULT_TASK_CARD_HEIGHT) || changed;
        }
        return changed;
    }

    function putInLane(card, lanes, laneKey, suppressRefresh) {
        const lane = lanes[laneKey];
        if (!lane) return false;
        const sourceParent = model.getParent(card);
        const sourceLaneKey = sourceParent ? getAttr(sourceParent, 'lane_key') : null;
        if (sourceParent === lane) {
            const heightChanged = applyCardHeightForLaneTransition(card, sourceLaneKey, laneKey);
            const styleChanged = applyStagedCardVisualStyle(card, laneKey);
            updateBadgeForLane(card, laneKey, suppressRefresh);
            return heightChanged || styleChanged;
        }
        applyCardHeightForLaneTransition(card, sourceLaneKey, laneKey);
        model.add(lane, card, model.getChildCount(lane));
        const status = getAttr(lane, 'status') || lane.value || '';
        setAttrNoUndo(card, 'status', status, true);
        applyStagedCardVisualStyle(card, laneKey);
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

    function enforceYearHiddenVisibility(card) {
        if (!isYearHiddenCard(card)) return false;
        const cur = model.isVisible ? model.isVisible(card) : true;
        if (cur === false) return false;
        model.setVisible(card, false);
        graph.refresh(card);                                                          // NEW (or graph.refresh(model.getParent(card)) )
        return true;
    }

    function ensureWorkflowState(card, laneKey) {
        const current = normalizeWorkflowState(getAttr(card, TASK_WORKFLOW_STATE_ATTR));
        if (current) return current;
        const derived = deriveWorkflowStateFromLaneKey(laneKey);
        setAttrNoUndo(card, TASK_WORKFLOW_STATE_ATTR, derived, true);
        return derived;
    }

    function clearCompletedForOpenState(card, state) {
        if (!isOpenWorkflowState(state) && state !== 'STAGED') return false;
        if (getAttr(card, 'completed') == null) return false;
        setAttrNoUndo(card, 'completed', null, true);
        return true;
    }

    function classifyFullViewLane(card, state, laneKey) {
        if (state === 'TODO' || state === 'DOING') return state;
        if (state === 'DONE') {
            let comp = getAttr(card, 'completed') || getAttr(card, TASK_ASSIGNED_DAY_ATTR) || getAttr(card, 'end');
            if (!comp) {
                comp = todayISO();
                setAttrNoUndo(card, 'completed', comp, true);
            }
            return classifyDoneLane(daysSince(comp));
        }
        if (isPhysicallyOrManuallyStaged(card.value, laneKey)) return 'TODO_STAGED';
        return decideUpcomingLaneKey(getAttr(card, 'start'));
    }

    function classifyPlanningViewLane(card, state, mode, selectedDay, selectedWeekStart, laneKey) {
        const assignedDay = getAttr(card, TASK_ASSIGNED_DAY_ATTR);
        const completedDay = getAttr(card, 'completed') || assignedDay;
        if (state === 'STAGED') return 'TODO_STAGED';
        if (mode === 'WEEK') {
            if (state === 'DONE') return getWeekLaneKeyForDate(completedDay, selectedWeekStart) || 'DONE_WEEK';
            return getWeekLaneKeyForDate(assignedDay, selectedWeekStart) || state;
        }
        return state; // CHANGE: legacy DAY normalizes before this point
    }

    function classifyCardForBoardView(card, board, laneKey) {
        const state = ensureWorkflowState(card, laneKey);
        const mode = getBoardViewMode(board);
        if (state !== 'DONE') clearCompletedForOpenState(card, state);
        if (mode === 'FULL') return classifyFullViewLane(card, state, laneKey);
        return classifyPlanningViewLane(card, state, mode, getSelectedDay(board), getSelectedWeekStart(board), laneKey);
    }


    // 3) Scan logic: skip auto-move for protected lanes; still refresh badges     
    function normalizeReflowLaneKeySet(opts) { // NEW: optional affected-lane filter for narrow badge/layout scopes
        const laneKeys = opts && opts.laneKeys;
        if (!Array.isArray(laneKeys) || laneKeys.length === 0) return null;
        return new Set(laneKeys.map(key => String(key || '')).filter(Boolean));
    }

    function classifyBoardCards(board, lanes, dirtyLanes) { // NEW: classification and derived repair pass without board geometry/layout work
        bumpTaskReflowTestCounter('classification');
        let boardDirty = false;
        const snapshots = snapshotBoardCardsByLane(lanes); // CHANGE: stable snapshot before mutation

        for (const snap of snapshots) {
            const sourceLaneKey = snap.laneKey;

            for (const c of snap.cards) {
                if (!c || !model.isVertex(c) || !isKanbanCard(c)) continue;

                const beforeParent = model.getParent(c);

                if (isYearHiddenCard(c)) {
                    if (enforceYearHiddenVisibility(c)) {
                        markDirtyLane(dirtyLanes, beforeParent);
                        boardDirty = true;
                    }
                    continue;
                }

                if (isScheduleBreakCard(c)) {
                    if (reconcileScheduleBreakOwnership(board, sourceLaneKey, c)) {
                        boardDirty = true;
                    }
                    markDirtyLane(dirtyLanes, beforeParent);
                    continue;
                }

                const targetLaneKey = classifyCardForBoardView(c, board, sourceLaneKey);
                if (putInLane(c, lanes, targetLaneKey, true)) {
                    markDirtyLane(dirtyLanes, beforeParent);
                    markDirtyCardLane(dirtyLanes, c);
                    boardDirty = true;
                    continue;
                }

                if (updateBadgeForLane(c, targetLaneKey, true)) {
                    markDirtyLane(dirtyLanes, beforeParent);
                    boardDirty = true;
                }
            }
        }

        if (rebuildRepeatVisibility(board, dirtyLanes)) {
            boardDirty = true;
        }

        return boardDirty;
    }

    function refreshBoardBadges(board, lanes, opts) { // NEW: badge-only pass that can be lane-scoped
        bumpTaskReflowTestCounter('badges');
        const laneKeyFilter = normalizeReflowLaneKeySet(opts);
        let changed = false;
        const snapshots = snapshotBoardCardsByLane(lanes);
        snapshots.forEach(snap => {
            if (laneKeyFilter && !laneKeyFilter.has(snap.laneKey)) return;
            snap.cards.forEach(card => {
                if (!card || !model.isVertex(card) || !isRenderableKanbanCard(card)) return;
                changed = updateBadgeForLane(card, snap.laneKey, true) || changed;
            });
        });
        return changed;
    }

    function renderBoardLanes(board, lanes, dirtyLanes, sortContext, opts) { // NEW: lane sorting, schedule packing, paging, and optional board geometry
        bumpTaskReflowTestCounter('lanes');
        const laneKeyFilter = normalizeReflowLaneKeySet(opts);
        const laneRenderOptions = Object.assign({}, opts || {}, sortContext || {}, { insideUpdate: true }); // NEW: preserve selected-period paging flags while keeping current sort context authoritative
        if (!opts || opts.applyLayout !== false) applyBoardViewLayout(board, lanes); // CHANGE: paging must measure the final lane height
        for (const { lane, laneKey } of dirtyLanes.values()) {
            if (laneKeyFilter && !laneKeyFilter.has(laneKey)) continue;
            resortAndPageLane(lane, laneKey, laneRenderOptions);
        }

        // Clean paging for untouched lanes without depending on child iteration order.
        for (const laneDef of LANES) {
            const laneKey = laneDef.key;
            if (laneKeyFilter && !laneKeyFilter.has(laneKey)) continue;
            const lane = lanes[laneKey];
            if (!lane || dirtyLanes.has(lane.id)) continue;

            if (isWeekDayLane(laneKey)) {
                resortAndPageLane(lane, laneKey, laneRenderOptions);
                continue;
            }

            if (selectedPeriodStagedSortEnabled(laneKey, sortContext)) {
                resortAndPageLane(lane, laneKey, laneRenderOptions);
                continue;
            }

            const cards = getLaneCardsInOrder(lane);
            applyLanePaging(lane, laneKey, cards);
        }
        repairSelectionAfterAutomaticPaging(); // NEW: repair once after every lane has its final visibility
    }

    function reflowBoard(board, opts) { // NEW: scoped reflow orchestrator behind scanAndReflowBoard compatibility API
        if (!board) return;

        ensureBoardPlanningDefaults(board);
        const lanes = boardLanes(board);
        const sortContext = getBoardSortContext(board);
        const insideUpdate = opts && opts.insideUpdate;
        const scopePlan = normalizeTaskReflowScopePlan(opts && opts.scope);
        const dirtyLanes = new Map();
        let boardDirty = false;

        if (!insideUpdate) model.beginUpdate();
        try {
            if (scopePlan.classification) boardDirty = classifyBoardCards(board, lanes, dirtyLanes) || boardDirty;
            if (scopePlan.layout) bumpTaskReflowTestCounter('layout');
            if (scopePlan.lanes) renderBoardLanes(board, lanes, dirtyLanes, sortContext, Object.assign({ applyLayout: scopePlan.layout }, opts || {}));
            else if (scopePlan.layout) applyBoardViewLayout(board, lanes);
            if (scopePlan.badges) boardDirty = refreshBoardBadges(board, lanes, opts) || boardDirty;

            if (boardDirty) {
                graph.refresh(board);
            }
        } finally {
            if (!insideUpdate) model.endUpdate();
        }
    }

    function scanAndReflowBoard(board, opts) { // CHANGE: compatibility wrapper for existing command paths
        return reflowBoard(board, opts);
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
                [main, ...secondary].filter(Boolean).forEach(function (board) {
                    scanAndReflowBoard(board, { insideUpdate: true });
                });
            });
        } finally {
            if (!insideUpdate) model.endUpdate();
        }
    }

    function initializeLanePagingFromModel() { // NEW: load-time cache reconstruction avoids trusting stale serialized visibility
        (function walk(cell) {
            if (!cell) return;
            if (isBoardCell(cell)) {
                const lanes = boardLanes(cell);
                Object.keys(lanes).forEach(laneKey => applyLanePaging(lanes[laneKey], laneKey, getLaneCardsInOrder(lanes[laneKey]), { skipSelectionRepair: true }));
                return;
            }
            for (let index = 0; index < model.getChildCount(cell); index++) walk(model.getChildAt(cell, index));
        })(model.getRoot());
        repairSelectionAfterAutomaticPaging();
    }

    // -------------------- Kanban placement and group helpers --------------------
    function isKanbanCard(cell) { return getAttr(cell, 'kanban_card') === '1'; }
    function isScheduleBreakCard(cell) { return getAttr(cell, TASK_SCHEDULE_BREAK_ATTR) === '1'; }
    function isWorkflowActionCard(cell) { return isKanbanCard(cell) && !isScheduleBreakCard(cell); }

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

    function updateGroupRenderState(group, opts) {
        if (!group || !isTilerGroup(group)) return;
        const cards = getLinkedCellsOf(group).filter(isKanbanCard);

        if (cards.length === 0) {
            const edges = graph.getEdges(group, null, true, true, true) || [];
            const insideUpdate = opts && opts.insideUpdate;
            if (!insideUpdate) model.beginUpdate();
            try {
                edges.forEach(e => model.remove(e));
                model.remove(group);
            } finally {
                if (!insideUpdate) model.endUpdate();
            }
            return;
        }

        // Completion is a state, not visibility
        const allDone = allLinkedCardsDone(group) === true;
        const wasDone = isTilerGroupCompleted(group);

        if (allDone === wasDone) return;                                                  // NEW (no change)

        const insideUpdate = opts && opts.insideUpdate;
        if (!insideUpdate) model.beginUpdate();
        try {
            setTilerGroupCompleted(group, allDone);
            applyCompletedStyleToGroup(group, allDone);
        } finally {
            if (!insideUpdate) model.endUpdate();
        }

        graph.refresh(group);
    }


    function updateRenderForGroupsLinkedTo(card) {
        if (!card) return;
        getLinkedCellsOf(card)
            .filter(isTilerGroup)
            .forEach(updateGroupRenderState);
    }

    function isYearHiddenCard(card) {
        return getAttr(card, 'year_hidden') === '1';
    }

    function isRepeatHiddenCard(card) {
        return getAttr(card, REPEAT_HIDDEN_ATTR) === '1';
    }

    function isRenderableKanbanCard(card) {
        return isKanbanCard(card) && isCardVisibilityEligible(card.value);
    }

    function getKanbanChildSiblings(parent) { // NEW: duplicate lane checks need the target board's current children
        const out = [];
        if (!parent) return out;
        const count = model.getChildCount(parent);
        for (let i = 0; i < count; i++) out.push(model.getChildAt(parent, i));
        return out;
    }

    function canPlaceKanbanChild(parent, child) { // NEW: runtime adapter for the pure kanban parenting policy
        return canParentKanbanCell(parent, child, { laneKeys: KANBAN_LANE_KEYS, siblings: getKanbanChildSiblings(parent) });
    }

    function buildLaneDropWorkflowPatch(card, board, laneKey) {
        if (!card || !board) return null;
        if (isScheduleBreakCard(card)) return null;
        const mode = getBoardViewMode(board);
        const weekStart = getSelectedWeekStart(board);
        const selectedDay = getSelectedDay(board);
        const ctx = { mode, selectedDay, selectedWeekStart: weekStart, today: todayISO() };
        if (isWeekDayLane(laneKey)) {
            const dayWindow = getBoardWeekWorkHours(board)[getWeekDayIndexForLaneKey(laneKey)];
            if (dayWindow && dayWindow.closed) return null;
            ctx.dropDay = getDateForWeekLaneKey(laneKey, weekStart);
            return buildWorkflowPatch(card.value, 'TODO', ctx);
        }
        if (laneKey === 'TODO' || laneKey === 'DOING' || laneKey === 'DONE') return buildWorkflowPatch(card.value, laneKey, ctx);
        if (laneKey === 'TODO_STAGED' || isUpcomingLane(laneKey)) return buildWorkflowPatch(card.value, 'STAGED', Object.assign(ctx, { manualStaged: laneKey === 'TODO_STAGED' }));
        if (isDoneLikeLane(laneKey)) return buildWorkflowPatch(card.value, 'DONE', ctx);
        return null;
    }

    function applyCardPatchInsideUpdate(card, attributes) {
        if (!card || !attributes) return false;
        model.setValue(card, cloneCardValueWithAttributes(card, attributes));
        refreshCardLabel(card, true);
        return true;
    }

    function scheduleCardVerticalMidpoint(card) { // NEW: drop insertion uses visual position, never derived time attributes
        const geo = card && model.getGeometry(card);
        const top = geo ? Number(geo.y) : 0;
        const height = geo ? Number(geo.height) : SCHEDULE_MIN_CARD_HEIGHT;
        return (Number.isFinite(top) ? top : 0) + ((Number.isFinite(height) ? height : SCHEDULE_MIN_CARD_HEIGHT) / 2);
    }

    function orderMovedScheduleCards(movedCards) { // NEW: preserve schedule order for a block dragged from one day lane
        const cards = Array.from(new Set((movedCards || []).filter(card => card && isKanbanCard(card))));
        const sourceParents = Array.from(new Set(cards.map(card => model.getParent(card)).filter(Boolean)));
        if (sourceParents.length !== 1 || !isWeekDayLane(getAttr(sourceParents[0], 'lane_key'))) return cards;
        const sourceLane = sourceParents[0];
        const sourceBoard = findBoardAncestor(sourceLane);
        const movedSet = new Set(cards);
        const ordered = getOrderedScheduleLaneCards(sourceBoard, sourceLane, getAttr(sourceLane, 'lane_key')).filter(card => movedSet.has(card));
        cards.forEach(card => { if (ordered.indexOf(card) < 0) ordered.push(card); });
        return ordered;
    }

    function resolveScheduleDropLane(movedCards, target, dy) { // NEW: distinguish user moves from resize and internal geometry updates
        if (target && isWeekDayLane(getAttr(target, 'lane_key'))) return target;
        if (target || !Number.isFinite(Number(dy)) || Number(dy) === 0) return null;
        const sourceParents = Array.from(new Set((movedCards || []).map(card => model.getParent(card)).filter(Boolean)));
        return sourceParents.length === 1 && isWeekDayLane(getAttr(sourceParents[0], 'lane_key')) ? sourceParents[0] : null;
    }

    function createScheduleDropContext(movedCards, target, dy) { // NEW: snapshot stable order before Draw.io mutates parents and geometry
        const targetLane = resolveScheduleDropLane(movedCards, target, dy);
        if (!targetLane) return null;
        const targetBoard = findBoardAncestor(targetLane);
        if (!targetBoard) return null;
        const movedOrder = orderMovedScheduleCards(movedCards);
        const allAlreadyInTarget = movedOrder.length > 0 && movedOrder.every(card => model.getParent(card) === targetLane);
        if (allAlreadyInTarget && Number(dy) === 0) return null;
        const sourceBoards = [];
        movedOrder.forEach(card => {
            const sourceLane = model.getParent(card);
            const sourceBoard = sourceLane && isWeekDayLane(getAttr(sourceLane, 'lane_key')) ? findBoardAncestor(sourceLane) : null;
            if (sourceBoard && sourceBoards.indexOf(sourceBoard) < 0) sourceBoards.push(sourceBoard);
        });
        return {
            targetLane,
            targetBoard,
            targetLaneKey: getAttr(targetLane, 'lane_key'),
            targetOrderBefore: getOrderedScheduleLaneCards(targetBoard, targetLane, getAttr(targetLane, 'lane_key')),
            movedOrder,
            sourceBoards
        };
    }

    function updateMovedBreakOwnership(context) { // NEW: cross-day break moves transfer the date while retaining duration
        if (!context) return;
        const destinationDay = getVisibleDateForWeekLane(context.targetBoard, context.targetLaneKey);
        context.movedOrder.forEach(card => {
            if (model.getParent(card) === context.targetLane && isScheduleBreakCard(card)) setAttrNoUndo(card, TASK_ASSIGNED_DAY_ATTR, destinationDay, true);
        });
    }

    function commitScheduleDropOrder(context) { // NEW: turn free-position drop geometry into one canonical schedule sequence
        if (!context) return false;
        const movedCards = context.movedOrder.filter(card => model.getParent(card) === context.targetLane);
        if (!movedCards.length) return false;
        const movedSet = new Set(movedCards);
        const stationaryCards = context.targetOrderBefore.filter(card => !movedSet.has(card) && model.getParent(card) === context.targetLane);
        const blockTop = movedCards.reduce((value, card) => {
            const geo = model.getGeometry(card);
            const top = geo ? Number(geo.y) : 0;
            return Math.min(value, Number.isFinite(top) ? top : 0);
        }, Infinity);
        const blockBottom = movedCards.reduce((value, card) => {
            const geo = model.getGeometry(card);
            const top = geo ? Number(geo.y) : 0;
            const height = geo ? Number(geo.height) : SCHEDULE_MIN_CARD_HEIGHT;
            return Math.max(value, (Number.isFinite(top) ? top : 0) + (Number.isFinite(height) ? height : SCHEDULE_MIN_CARD_HEIGHT));
        }, -Infinity);
        const blockMidpoint = (blockTop + blockBottom) / 2;
        let insertIndex = stationaryCards.findIndex(card => scheduleCardVerticalMidpoint(card) > blockMidpoint);
        if (insertIndex < 0) insertIndex = stationaryCards.length;
        const nextOrder = stationaryCards.slice(0, insertIndex).concat(movedCards, stationaryCards.slice(insertIndex));
        const changed = syncScheduleLanePhysicalOrder(context.targetLane, nextOrder.map(cell => ({ cell })));
        markScheduleLaneOrderDirty(context.targetLane); // NEW: force the next pack to persist physical order before reading stored order
        return changed;
    }

    function reflowScheduleDropBoards(context) { // NEW: close source gaps and pack the destination exactly once per board
        if (!context) return;
        const orderedBoards = context.sourceBoards.filter(board => board !== context.targetBoard);
        orderedBoards.push(context.targetBoard);
        orderedBoards.forEach(board => scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('drop') }));
    }

    function shouldInspectKanbanPlacement(parent, child) { // NEW: limit safety repairs to kanban structures and locked kanban cells
        const parentType = getKanbanCellType(parent, KANBAN_LANE_KEYS);
        const childType = getKanbanCellType(child, KANBAN_LANE_KEYS);
        return parentType === 'board' || parentType === 'lane' || childType === 'lane' || childType === 'card';
    }

    function isInvalidKanbanPlacement(cell) { // NEW: current parent violates the board/lane/card structure
        const parent = model.getParent(cell);
        return !!parent && shouldInspectKanbanPlacement(parent, cell) && !canPlaceKanbanChild(parent, cell);
    }

    function addBoardForKanbanParent(map, parent) { // NEW: board rescans stay scoped to touched kanban structures
        const board = parent ? findBoardAncestor(parent) : null;
        if (board && board.id) map.set(board.id, board);
    }

    function parentAbsoluteOrigin(parent) { // NEW: geometry conversion for preserving position during ejection
        let x = 0;
        let y = 0;
        let cur = parent;
        while (cur) {
            const geo = model.getGeometry(cur);
            if (geo) { x += Number(geo.x) || 0; y += Number(geo.y) || 0; }
            cur = model.getParent(cur);
        }
        return { x, y };
    }

    function moveCellToParentPreservingPosition(cell, parent) { // NEW: safety repair should not visually teleport malformed cells
        if (!cell || !parent || model.getParent(cell) === parent) return false;
        const geo = model.getGeometry(cell);
        const currentParent = model.getParent(cell);
        const currentOrigin = parentAbsoluteOrigin(currentParent);
        const targetOrigin = parentAbsoluteOrigin(parent);
        const nextGeo = geo && geo.clone ? geo.clone() : null;
        if (nextGeo) {
            nextGeo.x = (Number(geo.x) || 0) + currentOrigin.x - targetOrigin.x;
            nextGeo.y = (Number(geo.y) || 0) + currentOrigin.y - targetOrigin.y;
        }
        model.add(parent, cell, model.getChildCount(parent));
        if (nextGeo) model.setGeometry(cell, nextGeo);
        return true;
    }

    function nearestNonKanbanParent(cell) { // NEW: fallback quarantine for imported malformed children without a valid origin
        let cur = model.getParent(model.getParent(cell));
        while (cur) {
            const type = getKanbanCellType(cur, KANBAN_LANE_KEYS);
            if (type !== 'board' && type !== 'lane') return cur;
            cur = model.getParent(cur);
        }
        return graph.getDefaultParent ? graph.getDefaultParent() : null;
    }

    function safeKanbanRepairParent(cell, previousParent) { // NEW: prefer true drag revert, otherwise eject from the kanban container
        if (previousParent && canPlaceKanbanChild(previousParent, cell)) return previousParent;
        return nearestNonKanbanParent(cell);
    }

    function repairInvalidKanbanPlacements(invalidPlacements, affectedBoards) { // NEW: safety net for malformed/imported structures
        let changed = false;
        (invalidPlacements || []).forEach(entry => {
            const cell = entry && entry.cell;
            if (!cell || !isInvalidKanbanPlacement(cell)) return;
            const currentParent = model.getParent(cell);
            const repairParent = safeKanbanRepairParent(cell, entry.previousParent);
            if (!repairParent || repairParent === currentParent) return;
            addBoardForKanbanParent(affectedBoards, currentParent);
            addBoardForKanbanParent(affectedBoards, repairParent);
            if (moveCellToParentPreservingPosition(cell, repairParent)) changed = true;
        });
        return changed;
    }

    function installKanbanParentingGuards() { // NEW: block invalid drag/drop before draw.io mutates the model
        if (graph.__trellisKanbanParentingGuardsInstalled) return;
        graph.__trellisKanbanParentingGuardsInstalled = true;

        const originalIsValidDropTarget = graph.isValidDropTarget;
        graph.isValidDropTarget = function (target, cells, evt) {
            const dragged = Array.isArray(cells) ? cells : [];
            if (target && dragged.some(cell => !canPlaceKanbanChild(target, cell))) return false;
            return originalIsValidDropTarget ? originalIsValidDropTarget.apply(this, arguments) : true;
        };

        const originalMoveCells = graph.moveCells;
        graph.moveCells = function (cells, dx, dy, clone, target, evt, mapping) {
            const moved = Array.isArray(cells) ? cells : [];
            const movedCards = moved.filter(cell => cell && isKanbanCard(cell));
            const moveCardKey = (card, index) => card && (card.id || (card.getId && card.getId())) || String(index);
            const sourceLaneKeys = new Map(movedCards.map((card, index) => [moveCardKey(card, index), laneKeyOfCard(card)]));
            if (target && moved.some(cell => !canPlaceKanbanChild(target, cell))) return moved;
            const targetLaneKey = target && getAttr(target, 'lane_key');
            const scheduleDropContext = !clone ? createScheduleDropContext(movedCards, target, dy) : null;
            if ((!targetLaneKey && !scheduleDropContext) || clone) return originalMoveCells.apply(this, arguments);
            const targetBoard = scheduleDropContext ? scheduleDropContext.targetBoard : findBoardAncestor(target);
            if (!targetBoard || !movedCards.length) return originalMoveCells.apply(this, arguments);
            let result;
            model.beginUpdate();
            try {
                result = originalMoveCells.apply(this, arguments);
                if (targetLaneKey) {
                    movedCards.forEach((card, index) => {
                        const patch = buildLaneDropWorkflowPatch(card, targetBoard, targetLaneKey);
                        if (patch && patch.attributes) applyCardPatchInsideUpdate(card, patch.attributes);
                        applyCardHeightForLaneTransition(card, sourceLaneKeys.get(moveCardKey(card, index)), targetLaneKey);
                    });
                }
                if (scheduleDropContext) {
                    updateMovedBreakOwnership(scheduleDropContext);
                    commitScheduleDropOrder(scheduleDropContext);
                    reflowScheduleDropBoards(scheduleDropContext);
                } else {
                    scanAndReflowBoard(targetBoard, { insideUpdate: true, scope: getTaskReflowScopeForCommand('drop') });
                }
            } finally {
                model.endUpdate();
            }
            return result;
        };
    }

    installKanbanParentingGuards();




    // -------------------- Auto-status, badges, and DONE autopromotion --------------------
    let pendingRepairCards = new Set();
    let pendingRepairBoards = new Set();
    let pendingInvalidKanbanPlacements = new Map();
    let pendingWeekLaneWidthChanges = new Map();
    let pendingWeekLaneHourChanges = new Map();
    let pendingFullLaneHeightChanges = new Map();
    let pendingWeekBoardHeightChanges = new Map();
    let repairTimer = null;
    const taskOverlayGestureElements = [];
    const taskOverlayGestureRefreshers = new Set();
    let taskOverlayGestureActive = false;
    let taskOverlayGestureRefreshScheduled = false;
    const userResizedWeekDayLaneKeys = new Set(); // NEW: separates deliberate hour edits from automatic swimlane geometry changes

    function cancelPendingKanbanRepairs() {
        if (repairTimer != null && typeof clearTimeout === "function") clearTimeout(repairTimer);
        repairTimer = null;
        pendingRepairCards.clear();
        pendingRepairBoards.clear();
        pendingInvalidKanbanPlacements.clear();
        pendingWeekLaneWidthChanges.clear();
        pendingWeekLaneHourChanges.clear();
        pendingFullLaneHeightChanges.clear();
        pendingWeekBoardHeightChanges.clear();
    }

    function userResizeLaneKey(cell, laneKey) {
        return String((cell && (cell.id || (cell.getId && cell.getId()))) || laneKey || '');
    }

    function markUserResizedWeekDayLanes(cells) {
        (Array.isArray(cells) ? cells : []).forEach(cell => {
            const laneKey = getAttr(cell, 'lane_key');
            if (!isWeekDayLane(laneKey)) return;
            const key = userResizeLaneKey(cell, laneKey);
            if (key) userResizedWeekDayLaneKeys.add(key);
        });
    }

    function isUserResizedWeekDayLane(cell, laneKey) {
        return userResizedWeekDayLaneKeys.has(userResizeLaneKey(cell, laneKey));
    }

    function installWeekDayLaneResizeOriginGuard() {
        if (graph.__trellisWeekDayLaneResizeOriginGuardInstalled) return;
        graph.__trellisWeekDayLaneResizeOriginGuardInstalled = true;
        if (typeof graph.resizeCells !== 'function') return;
        const originalResizeCells = graph.resizeCells;
        graph.resizeCells = function (cells) {
            markUserResizedWeekDayLanes(cells);
            try {
                return originalResizeCells.apply(this, arguments);
            } finally {
                setTimeout(function () { userResizedWeekDayLaneKeys.clear(); }, 0);
            }
        };
    }

    function collectChangedKanbanCards(edit) {
        const out = new Set();
        const boards = new Set();
        const invalidPlacements = new Map();
        const laneWidthChanges = new Map();
        const laneHourChanges = new Map();
        const fullLaneHeightChanges = new Map();
        const weekBoardHeightChanges = new Map();
        if (isKanbanViewReflowing()) return { cards: out, boards, invalidPlacements, laneWidthChanges, laneHourChanges, fullLaneHeightChanges, weekBoardHeightChanges };
        if (!edit || !edit.changes) return { cards: out, boards, invalidPlacements, laneWidthChanges, laneHourChanges, fullLaneHeightChanges, weekBoardHeightChanges };

        for (const ch of edit.changes) {
            let cell = null;
            let previousParent = null;
            let currentParent = null;

            if (ch instanceof mxChildChange) {
                cell = ch.child;

                previousParent = ch.previous;
                currentParent = model.getParent(cell);
                const previousLaneKey = previousParent ? getAttr(previousParent, 'lane_key') : null;
                const currentLaneKey = currentParent ? getAttr(currentParent, 'lane_key') : null;

                if (cell && currentParent && shouldInspectKanbanPlacement(currentParent, cell) && !canPlaceKanbanChild(currentParent, cell)) {
                    invalidPlacements.set(cell.id || String(invalidPlacements.size), { cell, previousParent });
                }

                if (previousParent === currentParent) {
                    if (currentParent && isWeekDayLane(getAttr(currentParent, 'lane_key'))) {
                        markScheduleLaneOrderDirty(currentParent);
                        const board = findBoardAncestor(currentParent);
                        if (board) boards.add(board);
                    }
                    continue; // CHANGE: skip same-lane reorder while retaining cross-board moves to equivalent lanes
                }
            } else if (ch instanceof mxValueChange) {
                cell = ch.cell;
            } else if (ch instanceof mxStyleChange) {
                cell = ch.cell;
            } else if (ch instanceof mxGeometryChange) {
                cell = ch.cell; // CHANGE: schedule card height edits commit duration
                currentParent = model.getParent(cell);
                if (isBoardCell(cell)) {
                    const geo = model.getGeometry(cell);
                    const previousHeight = roundedGeometryHeight(ch.previous);
                    const currentHeight = roundedGeometryHeight(geo);
                    const heightChanged = previousHeight == null || currentHeight == null || previousHeight !== currentHeight;
                    if (heightChanged && getBoardViewMode(cell) === 'FULL') {
                        fullLaneHeightChanges.set(cell.id || String(fullLaneHeightChanges.size), { board: cell, height: deriveFullLaneHeightFromBoardGeometry(cell) });
                        boards.add(cell);
                    }
                    if (heightChanged && getBoardViewMode(cell) === 'WEEK') {
                        weekBoardHeightChanges.set(cell.id || String(weekBoardHeightChanges.size), { board: cell, height: deriveWeekBoardHeightFromBoardGeometry(cell) });
                        boards.add(cell);
                    }
                    continue;
                }
                const changedLaneKey = getAttr(cell, 'lane_key');
                if (changedLaneKey && currentParent && isBoardCell(currentParent) && !isWeekDayLane(changedLaneKey)) {
                    const geo = model.getGeometry(cell);
                    const previousWidth = roundedGeometryWidth(ch.previous);
                    const currentWidth = roundedGeometryWidth(geo);
                    const widthChanged = previousWidth == null || currentWidth == null || previousWidth !== currentWidth;
                    const previousHeight = roundedGeometryHeight(ch.previous);
                    const currentHeight = roundedGeometryHeight(geo);
                    const heightChanged = previousHeight == null || currentHeight == null || previousHeight !== currentHeight;
                    if (widthChanged && (!model.isVisible || model.isVisible(cell) !== false)) {
                        laneWidthChanges.set(cell.id || changedLaneKey, { board: currentParent, laneKey: changedLaneKey, width: currentWidth, nonDay: true });
                    }
                    if (heightChanged && getBoardViewMode(currentParent) === 'FULL' && (!model.isVisible || model.isVisible(cell) !== false)) {
                        fullLaneHeightChanges.set(cell.id || changedLaneKey, { board: currentParent, height: normalizeFullLaneHeight(currentHeight, getBoardFullLaneHeight(currentParent)) });
                    }
                    if (heightChanged || widthChanged) boards.add(currentParent); // CHANGE: week staged height remains board-owned; every non-day width reflows layout
                    continue;
                }
                if (isWeekDayLane(changedLaneKey) && currentParent && isBoardCell(currentParent)) {
                    const geo = model.getGeometry(cell);
                    const previousWidth = roundedGeometryWidth(ch.previous);
                    const currentWidth = roundedGeometryWidth(geo);
                    const widthChanged = previousWidth == null || currentWidth == null || previousWidth !== currentWidth;
                    const previousTop = ch.previous ? roundedGeometryValue(ch.previous.y) : null;
                    const currentTop = geo ? roundedGeometryValue(geo.y) : null;
                    const previousBottom = ch.previous ? roundedGeometryValue(ch.previous.y) + roundedGeometryValue(ch.previous.height) : null;
                    const currentBottom = geo ? roundedGeometryValue(geo.y) + roundedGeometryValue(geo.height) : null;
                    const hoursChanged = previousTop != null && currentTop != null && previousBottom != null && currentBottom != null && (previousTop !== currentTop || previousBottom !== currentBottom);
                    if (widthChanged) {
                        laneWidthChanges.set(cell.id || changedLaneKey, { board: currentParent, laneKey: changedLaneKey, width: geo ? geo.width : null });
                        boards.add(currentParent);
                    }
                    if (hoursChanged && isUserResizedWeekDayLane(cell, changedLaneKey)) {
                        laneHourChanges.set(cell.id || changedLaneKey, { board: currentParent, laneKey: changedLaneKey, previousGeo: ch.previous, currentGeo: geo });
                        boards.add(currentParent);
                    }
                    if (hoursChanged && !isUserResizedWeekDayLane(cell, changedLaneKey)) boards.add(currentParent);
                    continue;
                }
                const laneKey = currentParent ? getAttr(currentParent, 'lane_key') : null;
                if (!isWeekDayLane(laneKey)) {
                    const previousHeight = roundedGeometryHeight(ch.previous);
                    const currentHeight = roundedGeometryHeight(model.getGeometry(cell));
                    const heightChanged = previousHeight == null || currentHeight == null || previousHeight !== currentHeight;
                    const currentBoard = findBoardAncestor(currentParent || cell);
                    if (heightChanged && currentBoard && getBoardViewMode(currentBoard) === 'FULL' && model.isVertex(cell) && isKanbanCard(cell) && !isScheduleBreakCard(cell)) {
                        out.add(cell);
                        boards.add(currentBoard);
                    }
                    continue;
                }
            }

            if (!cell || !model.isVertex(cell) || !isKanbanCard(cell)) continue;

            const previousBoard = previousParent ? findBoardAncestor(previousParent) : null;
            const currentBoard = findBoardAncestor(currentParent || cell);
            if (previousBoard) boards.add(previousBoard);
            if (currentBoard) boards.add(currentBoard);
            if (isYearHiddenCard(cell)) continue; // CHANGE: rescan its board without applying lane-status repair
            out.add(cell);
        }

        return { cards: out, boards, invalidPlacements, laneWidthChanges, laneHourChanges, fullLaneHeightChanges, weekBoardHeightChanges };
    }

    function scheduleKanbanRepair(cards, boards, invalidPlacements, laneWidthChanges, laneHourChanges, fullLaneHeightChanges, weekBoardHeightChanges) {
        if (isTrellisHistoryRestoring()) return;
        const hasCards = cards && cards.size > 0;
        const hasBoards = boards && boards.size > 0;
        const hasInvalidPlacements = invalidPlacements && invalidPlacements.size > 0;
        const hasLaneWidthChanges = laneWidthChanges && laneWidthChanges.size > 0;
        const hasLaneHourChanges = laneHourChanges && laneHourChanges.size > 0;
        const hasFullLaneHeightChanges = fullLaneHeightChanges && fullLaneHeightChanges.size > 0;
        const hasWeekBoardHeightChanges = weekBoardHeightChanges && weekBoardHeightChanges.size > 0;
        if (!hasCards && !hasBoards && !hasInvalidPlacements && !hasLaneWidthChanges && !hasLaneHourChanges && !hasFullLaneHeightChanges && !hasWeekBoardHeightChanges) return;

        if (hasCards) cards.forEach(card => pendingRepairCards.add(card));
        if (hasBoards) boards.forEach(board => pendingRepairBoards.add(board));
        if (hasInvalidPlacements) invalidPlacements.forEach((entry, key) => pendingInvalidKanbanPlacements.set(key, entry));
        if (hasLaneWidthChanges) laneWidthChanges.forEach((entry, key) => pendingWeekLaneWidthChanges.set(key, entry));
        if (hasLaneHourChanges) laneHourChanges.forEach((entry, key) => pendingWeekLaneHourChanges.set(key, entry));
        if (hasFullLaneHeightChanges) fullLaneHeightChanges.forEach((entry, key) => pendingFullLaneHeightChanges.set(key, entry));
        if (hasWeekBoardHeightChanges) weekBoardHeightChanges.forEach((entry, key) => pendingWeekBoardHeightChanges.set(key, entry));

        if (repairTimer != null) return;

        repairTimer = setTimeout(function () {
            repairTimer = null;
            if (isTrellisHistoryRestoring()) { cancelPendingKanbanRepairs(); return; }

            const cardsToRepair = Array.from(pendingRepairCards);
            const boardsToRepair = Array.from(pendingRepairBoards);
            const invalidPlacementsToRepair = Array.from(pendingInvalidKanbanPlacements.values());
            const laneWidthChangesToRepair = Array.from(pendingWeekLaneWidthChanges.values());
            const laneHourChangesToRepair = Array.from(pendingWeekLaneHourChanges.values());
            const fullLaneHeightChangesToRepair = Array.from(pendingFullLaneHeightChanges.values());
            const weekBoardHeightChangesToRepair = Array.from(pendingWeekBoardHeightChanges.values());
            pendingRepairCards.clear();
            pendingRepairBoards.clear();
            pendingInvalidKanbanPlacements.clear();
            pendingWeekLaneWidthChanges.clear();
            pendingWeekLaneHourChanges.clear();
            pendingFullLaneHeightChanges.clear();
            pendingWeekBoardHeightChanges.clear();

            repairChangedCards(cardsToRepair, boardsToRepair, invalidPlacementsToRepair, laneWidthChangesToRepair, laneHourChangesToRepair, fullLaneHeightChangesToRepair, weekBoardHeightChangesToRepair);
        }, 0);
    }

    function repairChangedCards(cards, boards, invalidPlacements, laneWidthChanges, laneHourChanges, fullLaneHeightChanges, weekBoardHeightChanges) {
        if ((!cards || cards.length === 0) && (!boards || boards.length === 0) && (!invalidPlacements || invalidPlacements.length === 0) && (!laneWidthChanges || laneWidthChanges.length === 0) && (!laneHourChanges || laneHourChanges.length === 0) && (!fullLaneHeightChanges || fullLaneHeightChanges.length === 0) && (!weekBoardHeightChanges || weekBoardHeightChanges.length === 0)) return;
        if (isTrellisHistoryRestoring()) return;

        const affectedBoards = new Map();
        const touchedGroups = new Set();
        (boards || []).forEach(board => {
            if (board && board.id) affectedBoards.set(board.id, board);
        });

        model.beginUpdate();
        try {
            repairInvalidKanbanPlacements(invalidPlacements, affectedBoards);

            (laneWidthChanges || []).forEach(entry => {
                if (!entry || !entry.board) return;
                const changed = entry.nonDay ? persistNonDayLaneWidth(entry.board, entry.laneKey, entry.width) : persistWeekDayLaneWidth(entry.board, entry.laneKey, entry.width);
                if (changed) affectedBoards.set(entry.board.id || entry.laneKey, entry.board);
            });

            (laneHourChanges || []).forEach(entry => {
                if (!entry || !entry.board) return;
                if (persistWeekDayLaneHourResize(entry.board, entry.laneKey, entry.previousGeo, entry.currentGeo)) affectedBoards.set(entry.board.id || entry.laneKey, entry.board);
            });

            (fullLaneHeightChanges || []).forEach(entry => {
                if (!entry || !entry.board) return;
                if (persistFullLaneHeight(entry.board, entry.height)) affectedBoards.set(entry.board.id || String(entry.height), entry.board);
            });

            (weekBoardHeightChanges || []).forEach(entry => {
                if (!entry || !entry.board) return;
                if (persistWeekBoardHeight(entry.board, entry.height)) affectedBoards.set(entry.board.id || String(entry.height), entry.board);
            });

            for (const cell of (cards || [])) {
                if (!cell || !model.isVertex(cell) || !isKanbanCard(cell)) continue;
                if (isYearHiddenCard(cell)) continue;

                const parent = model.getParent(cell);
                if (!parent) continue;

                const laneKey = getAttr(parent, 'lane_key');
                if (!laneKey) continue;

                const currentBoard = findBoardAncestor(parent);
                if (currentBoard && currentBoard.id) affectedBoards.set(currentBoard.id, currentBoard);

                const laneStatus = getAttr(parent, 'status') || parent.value || '';
                setAttrNoUndo(cell, 'status', laneStatus, true);
                applyCardHeightForLaneTransition(cell, laneKey, laneKey);
                applyStagedCardVisualStyle(cell, laneKey);
                updateBadgeForLane(cell, laneKey, true);

                getLinkedCellsOf(cell).filter(isTilerGroup).forEach(g => touchedGroups.add(g.id));
            }

            const hasFullLaneHeightRepair = !!(fullLaneHeightChanges && fullLaneHeightChanges.length);
            const hasWeekBoardHeightRepair = !!(weekBoardHeightChanges && weekBoardHeightChanges.length);
            const hasCardRepair = !!((cards && cards.length) || (invalidPlacements && invalidPlacements.length));
            const scope = hasCardRepair ? getTaskReflowScopeForCommand('workflow') : ((hasFullLaneHeightRepair || hasWeekBoardHeightRepair) ? getTaskReflowScopeForCommand('boardResize') : getTaskReflowScopeForCommand('dayLaneResize'));
            affectedBoards.forEach(board => scanAndReflowBoard(board, { insideUpdate: true, scope })); // CHANGE: lane rendering now always measures after requested layout

            touchedGroups.forEach(id => {
                const group = model.getCell(id);
                if (!group) return;
                updateGroupRenderState(group, { insideUpdate: true });
            });

        } finally {
            model.endUpdate();
        }
    }

    installWeekDayLaneResizeOriginGuard();

    model.addListener(mxEvent.CHANGE, function (_sender, evt) {
        const edit = evt.getProperty('edit');
        const changes = collectChangedKanbanCards(edit);
        scheduleKanbanRepair(changes.cards, changes.boards, changes.invalidPlacements, changes.laneWidthChanges, changes.laneHourChanges, changes.fullLaneHeightChanges, changes.weekBoardHeightChanges); // CHANGE: defer mutation out of CHANGE event
    });

    graph.addListener(mxEvent.CELLS_REMOVED || 'cellsRemoved', function (_sender, evt) { // NEW: deleted role identities cannot remain assigned
        const deletedRoleIds = new Set();
        function collectRemoved(cell) {
            if (!cell) return;
            if (isRoleCard(cell)) deletedRoleIds.add(String(cell.id || (cell.getId && cell.getId()) || ''));
            const children = cell.children || []; // NEW: removed subtrees are no longer reachable from the model root
            for (let i = 0; i < children.length; i++) collectRemoved(children[i]);
        }
        (evt.getProperty('cells') || []).forEach(collectRemoved);
        if (!deletedRoleIds.size) return;
        const affected = [];
        (function walk(cell) {
            if (!cell) return;
            if (model.isVertex(cell) && isKanbanCard(cell)) {
                const current = getTaskAssigneeRoleIds(cell);
                const next = current.filter(id => !deletedRoleIds.has(id));
                if (next.length !== current.length) affected.push({ card: cell, ids: next });
            }
            const count = model.getChildCount(cell);
            for (let i = 0; i < count; i++) walk(model.getChildAt(cell, i));
        })(model.getRoot());
        if (!affected.length) return;
        model.beginUpdate(); // NEW: nested in the removal event so deletion and cleanup undo together
        try { affected.forEach(entry => model.setValue(entry.card, cloneCardValueWithAttributes(entry.card, { [TASK_ASSIGNEE_ROLE_IDS_ATTR]: serializeTaskAssigneeRoleIds(entry.ids) }))); }
        finally { model.endUpdate(); }
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



    // -------------------- Board discovery and dialogs --------------------
    graph.getSelectionModel().addListener(mxEvent.CHANGE, function () {
        clearTransientUnseenHighlights();
        const sel = graph.getSelectionCell();
        if (!sel || !model.isVertex(sel)) return;
        const key = getAttr(sel, 'board_key');
        if (key === BOARD_KEY || key === 'MAIN_KANBAN_BOARD') {
            if (!suppressDashboardSeenSelection && activeDashboardTaskContext && String(activeDashboardTaskContext.year || '') && markBoardYearViewed(sel, activeDashboardTaskContext.gardenModule, activeDashboardTaskContext.year)) window.dispatchEvent(new CustomEvent('trellisTaskBoardSeenStateChanged', { detail: { gardenModuleId: cellId(activeDashboardTaskContext.gardenModule), boardId: cellId(sel), year: activeDashboardTaskContext.year } }));
            taskCommands.scanAndReflowBoard(sel, { scope: getTaskReflowScopeForCommand('boardNavigation') });
            return;
        }
        const board = findBoardAncestor(sel);
        if (board && !suppressDashboardSeenSelection && activeDashboardTaskContext && String(activeDashboardTaskContext.year || '') && markBoardYearViewed(board, activeDashboardTaskContext.gardenModule, activeDashboardTaskContext.year)) window.dispatchEvent(new CustomEvent('trellisTaskBoardSeenStateChanged', { detail: { gardenModuleId: cellId(activeDashboardTaskContext.gardenModule), boardId: cellId(board), year: activeDashboardTaskContext.year } }));
        const selectedDayLane = board && weekDayLaneAncestorForCell(sel, board);
        let stagedRefreshCommand = 'selection';
        if (board && selectedDayLane && getBoardViewMode(board) === 'WEEK') {
            const day = getDateForWeekLaneKey(getAttr(selectedDayLane, 'lane_key'), getSelectedWeekStart(board));
            if (day && day !== getSelectedDay(board)) { taskCommands.setBoardPlanningView(board, 'WEEK', { [TASK_SELECTED_DAY_ATTR]: day }); stagedRefreshCommand = 'selectedPeriodStagedPaging'; } // CHANGE: selected-period changes need staged lane paging parity
        }
        taskCommands.scanAndReflowBoard(board, { scope: getTaskReflowScopeForCommand(stagedRefreshCommand), laneKeys: ['TODO_STAGED'], resetSelectedPeriodStagedPage: stagedRefreshCommand === 'selectedPeriodStagedPaging' });
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

    function cellId(cell) {
        return String(cell && (cell.id || (cell.getId && cell.getId())) || '');
    }

    function readJsonAttr(cell, key, fallback) {
        try {
            const parsed = JSON.parse(getAttr(cell, key) || '');
            return parsed && typeof parsed === 'object' ? parsed : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function writeJsonAttr(cell, key, value) {
        setAttrNoUndo(cell, key, JSON.stringify(value || {}), true);
    }

    function boardDisplayName(board) {
        const raw = getAttr(board, 'label') || (typeof (board && board.value) === 'string' ? board.value : '') || 'Kanban';
        const holder = document && document.createElement ? document.createElement('div') : null;
        if (holder) { holder.innerHTML = raw; return String(holder.textContent || '').replace(/\s+/g, ' ').trim() || 'Kanban'; }
        return String(raw || 'Kanban').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || 'Kanban';
    }

    function listBoardsInTaskModule(taskModule) {
        const boards = findBoardsIn(taskModule);
        return (boards.main ? [boards.main] : []).concat(boards.secondary || []);
    }

    function listBoardsForGarden(gardenModule, opts) {
        const taskModule = taskModuleForGarden(gardenModule);
        return taskModule ? listBoardsInTaskModule(taskModule) : [];
    }

    function userStateKeyForTaskCounts(gardenModule) {
        const users = window.Trellis && window.Trellis.users;
        if (!users || typeof users.isEnabled !== 'function' || !users.isEnabled()) return 'shared';
        const current = typeof users.getCurrentUser === 'function' ? users.getCurrentUser() : null;
        if (!current || !current.id) return null;
        if (typeof users.getAccessSummary === 'function') {
            const summary = users.getAccessSummary(gardenModule);
            const direct = summary && Array.isArray(summary.directUserIds) && summary.directUserIds.indexOf(current.id) >= 0;
            const inherited = !!(summary && summary.inheritedAccessGrant);
            const owner = !!(summary && summary.ownerUserId === current.id);
            if (!current.admin && !owner && !direct && !inherited) return null;
        }
        return 'user:' + current.id;
    }

    function taskStartYear(card) {
        const parsed = taskPolicy.parseTaskCalendarISO(getAttr(card, 'start') || getAttr(card, 'assigned_day') || '');
        return parsed ? String(parsed.year) : 'unscheduled';
    }

    function collectBoardCards(board) {
        const out = [];
        function visit(cell) {
            immediateChildren(cell).forEach(child => {
                if (isKanbanCard(child)) out.push(child);
                visit(child);
            });
        }
        if (board) visit(board);
        return out;
    }

    function seenCutoffsForBoard(board, viewerKey) {
        const state = readJsonAttr(board, TASK_SEEN_CREATED_ATTR, {});
        const viewer = state && state[viewerKey] && typeof state[viewerKey] === 'object' ? state[viewerKey] : {};
        return viewer;
    }

    function unseenSummaryForBoard(board, viewerKey) {
        const cutoffs = seenCutoffsForBoard(board, viewerKey);
        const years = new Map();
        let total = 0;
        collectBoardCards(board).forEach(card => {
            const createdAt = Number(getAttr(card, 'createdAt')) || 0;
            if (!createdAt) return;
            const year = taskStartYear(card);
            const cutoff = Number(cutoffs[year]) || 0;
            if (createdAt <= cutoff) return;
            total += 1;
            years.set(year, (years.get(year) || 0) + 1);
        });
        return { total, years };
    }

    function taskBoardUnseenSummaryForGarden(gardenModule) {
        const viewerKey = userStateKeyForTaskCounts(gardenModule);
        if (!viewerKey) return { hidden: true, total: 0, boards: [] };
        const boards = listBoardsForGarden(gardenModule, { ensure: false });
        let total = 0;
        const summaries = boards.map(board => {
            const summary = unseenSummaryForBoard(board, viewerKey);
            total += summary.total;
            const visibleYears = Array.from(summary.years.keys()).filter(year => year !== 'unscheduled').sort();
            return { board, boardId: cellId(board), name: boardDisplayName(board), count: summary.total, years: visibleYears };
        });
        return { hidden: false, total, boards: summaries };
    }

    function clearTransientUnseenHighlights() {
        transientUnseenHighlightOverlays.forEach(overlay => { if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); });
        transientUnseenHighlightOverlays.clear();
    }

    function positionUnseenHighlightOverlay(card, overlay) {
        const host = overlay && overlay.parentNode;
        const bounds = getCellVisualBounds(card, host);
        if (!bounds) return false;
        overlay.style.left = Math.max(0, Math.round(bounds.x - 3)) + 'px';
        overlay.style.top = Math.max(0, Math.round(bounds.y - 3)) + 'px';
        overlay.style.width = Math.max(0, Math.round(bounds.width + 6)) + 'px';
        overlay.style.height = Math.max(0, Math.round(bounds.height + 6)) + 'px';
        return true;
    }

    function addUnseenHighlightOverlay(card) {
        const host = ensureTaskControlOverlayHost();
        if (!host || !document || !document.createElement) return;
        const overlay = document.createElement('div');
        overlay.className = 'trellis-task-unseen-created-highlight';
        overlay.style.cssText = 'position:absolute;box-sizing:border-box;border:4px solid #FACC15;border-radius:6px;pointer-events:none;background:transparent;z-index:' + GRAPH_OVERLAY_Z.ANNOTATION + ';';
        host.appendChild(overlay);
        if (!positionUnseenHighlightOverlay(card, overlay)) { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); return; }
        transientUnseenHighlightOverlays.set(card, overlay);
    }

    function refreshTransientUnseenHighlightPositions() {
        transientUnseenHighlightOverlays.forEach((overlay, card) => {
            if (!positionUnseenHighlightOverlay(card, overlay) && overlay && overlay.parentNode) { overlay.parentNode.removeChild(overlay); transientUnseenHighlightOverlays.delete(card); }
        });
    }

    function highlightUnseenCards(board, viewerKey, year) {
        clearTransientUnseenHighlights();
        if (!board || !viewerKey) return;
        const cutoffs = seenCutoffsForBoard(board, viewerKey);
        const targetYear = String(year || '');
        collectBoardCards(board).forEach(card => {
            const cardYear = taskStartYear(card);
            if (cardYear !== targetYear && cardYear !== 'unscheduled') return;
            const createdAt = Number(getAttr(card, 'createdAt')) || 0;
            if (!createdAt || createdAt <= (Number(cutoffs[cardYear]) || 0)) return;
            addUnseenHighlightOverlay(card);
        });
    }

    function markBoardYearViewed(board, gardenModule, year) {
        const viewerKey = userStateKeyForTaskCounts(gardenModule);
        if (!board || !viewerKey) return false;
        const y = String(year || '').trim();
        if (!y) return false;
        const state = readJsonAttr(board, TASK_SEEN_CREATED_ATTR, {});
        const viewer = state[viewerKey] && typeof state[viewerKey] === 'object' ? state[viewerKey] : {};
        viewer[y] = Date.now();
        viewer.unscheduled = Date.now();
        state[viewerKey] = viewer;
        writeJsonAttr(board, TASK_SEEN_CREATED_ATTR, state);
        return true;
    }

    function fitBoardInViewport(board) {
        if (!board) return;
        if (graph.setSelectionCell) {
            suppressDashboardSeenSelection = true;
            try { graph.setSelectionCell(board); } finally { suppressDashboardSeenSelection = false; }
        }
        const geo = model.getGeometry(board);
        if (geo && typeof graph.fitWindow === 'function') { graph.fitWindow({ x: geo.x, y: geo.y, width: geo.width, height: geo.height }, 24); return; }
        if (geo && typeof graph.scrollRectToVisible === 'function') { graph.scrollRectToVisible({ x: geo.x, y: geo.y, width: geo.width, height: geo.height }); return; }
        if (typeof graph.fit === 'function') graph.fit(48);
        if (graph.scrollCellToVisible) graph.scrollCellToVisible(board, true);
    }

    function openBoardForGarden(gardenModule, boardId, year) {
        const taskModule = taskModuleForGarden(gardenModule);
        const boards = taskModule ? listBoardsInTaskModule(taskModule) : [];
        const board = boards.find(candidate => cellId(candidate) === String(boardId || '')) || boards[0] || null;
        const viewerKey = userStateKeyForTaskCounts(gardenModule);
        fitBoardInViewport(board);
        if (viewerKey) highlightUnseenCards(board, viewerKey, String(year || ''));
        if (board) markBoardYearViewed(board, gardenModule, year);
        try { window.dispatchEvent(new CustomEvent('trellisTaskBoardSeenStateChanged', { detail: { gardenModuleId: cellId(gardenModule), boardId: cellId(board), year } })); } catch (_) { }
        return board;
    }

    function taskUnseenHighlightCountForTests() {
        return transientUnseenHighlightOverlays.size;
    }

    // -------------------- Dialog commands --------------------
    function showEditCardDialogImpl(card) { // CHANGE: notes are editable on every Kanban card
        if (!card || !isKanbanCard(card)) return;

        const datesEditableAtOpen = canEditCardDates(card);
        const currentRange = datesEditableAtOpen ? getTaskDateRange(card.value) : null;
        const currentNote = getCardNote(card);

        const div = document.createElement('div');
        div.style.padding = '12px';
        div.style.boxSizing = 'border-box';
        div.style.fontFamily = 'Arial, sans-serif';

        const heading = document.createElement('div');
        heading.textContent = 'Edit Card';
        heading.style.fontSize = '16px';
        heading.style.fontWeight = 'bold';
        heading.style.marginBottom = '12px';
        div.appendChild(heading);

        function addRow(labelText, input) {
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

        const noteInput = document.createElement('input');
        noteInput.type = 'text';
        noteInput.value = currentNote;
        noteInput.placeholder = 'Short card note';
        addRow('Note:', noteInput);

        const noteFeedback = document.createElement('div');
        noteFeedback.style.margin = '-6px 0 10px 95px';
        noteFeedback.style.fontSize = '12px';
        div.appendChild(noteFeedback);

        let startInput = null;
        let endInput = null;

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

        function updateNoteFeedback() {
            const collapsed = String(noteInput.value || '').replace(/\s+/g, ' ').trim();
            const length = Array.from(collapsed).length;
            noteFeedback.textContent = length + '/' + CARD_NOTE_MAX_LENGTH;
            noteFeedback.style.color = length > CARD_NOTE_MAX_LENGTH ? '#b91c1c' : '#6b7280';
        }

        function updateComputedEnd() {
            if (!startInput || !endInput || !currentRange) return null;
            const nextEnd = shiftTaskCalendarISO(startInput.value, currentRange.durationDays);
            endInput.value = nextEnd || '';
            error.textContent = nextEnd ? '' : 'Enter a valid start date.';
            return nextEnd;
        }

        noteInput.addEventListener('input', updateNoteFeedback);
        updateNoteFeedback();
        if (startInput) startInput.addEventListener('input', updateComputedEnd);

        const buttons = document.createElement('div');
        buttons.style.display = 'flex';
        buttons.style.justifyContent = 'flex-end';
        buttons.style.gap = '8px';

        const cancelButton = mxUtils.button('Cancel', function () {
            ui.hideDialog();
        });
        applyTaskButtonStyle(cancelButton, 'neutral');
        const saveButton = mxUtils.button('Save', async function () {
            const attributes = {};
            const notePatch = buildCardNotePatch(card.value, noteInput.value);
            if (notePatch && notePatch.changed) Object.assign(attributes, notePatch.attributes);

            let dateChanged = false;
            if (startInput && currentRange && startInput.value !== currentRange.startISO) {
                const nextEnd = updateComputedEnd();
                if (!nextEnd) {
                    startInput.focus();
                    return;
                }

                if (!canEditCardDates(card)) { // CHANGE: reject the entire combined save if changed dates are no longer eligible
                    error.textContent = 'This card is no longer eligible for date editing.';
                    return;
                }

                const datePatch = buildCardDateOverridePatch(card.value, startInput.value);
                if (!datePatch || datePatch.changed === false) {
                    error.textContent = 'The card dates could not be updated.';
                    return;
                }

                Object.assign(attributes, datePatch.attributes);
                dateChanged = true;
            }

            if (Object.keys(attributes).length === 0) { // NEW: unchanged combined submission is a no-op
                ui.hideDialog();
                return;
            }

            if (!taskCommands.commitCardPatch(card, attributes, { reflow: dateChanged })) {
                error.textContent = 'The card could not be updated.';
                return;
            }

            ui.hideDialog();
        });

        applyTaskButtonStyle(saveButton, 'add');
        buttons.appendChild(cancelButton);
        buttons.appendChild(saveButton);
        div.appendChild(buttons);

        mxEvent.addListener(div, 'keydown', function (evt) {
            if (evt.key === 'Enter') saveButton.click();
            if (evt.key === 'Escape') ui.hideDialog();
        });

        taskDialogs.showTaskManagerDialog(div, 420, datesEditableAtOpen ? 310 : 230, true, true);
        noteInput.focus();
    }

    function getRepeatSeriesContext(card) { // NEW: resolve menu state from the current board, including year-hidden matches
        const board = findBoardAncestor(card);
        const seriesKey = card ? buildRepeatSeriesKey(card.value) : null;
        if (!board || !seriesKey) return null;

        const matchingRecords = getBoardRepeatRecords(board)
            .filter(record => record.seriesKey === seriesKey);
        const eligibleRecords = matchingRecords.filter(record => !record.yearHidden);
        if (eligibleRecords.length < 2) return null;

        return {
            board,
            cards: matchingRecords.map(record => record.card),
            expanded: matchingRecords.some(record => record.expanded)
        };
    }

    function setRepeatSeriesExpanded(card, expanded) { // NEW: persist one expansion choice across every matching occurrence
        const context = getRepeatSeriesContext(card);
        if (!context) return false;

        model.beginUpdate();
        try {
            context.cards.forEach(seriesCard => {
                const current = getAttr(seriesCard, REPEAT_EXPANDED_ATTR) === '1';
                if (current === expanded) return;
                model.setValue(seriesCard, cloneCardValueWithAttributes(seriesCard, {
                    [REPEAT_EXPANDED_ATTR]: expanded ? '1' : null
                }));
            });
            scanAndReflowBoard(context.board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('workflow') });
        } finally {
            model.endUpdate();
        }

        return true;
    }

    function collectBoardCards(board) {
        const cards = [];
        const lanes = boardLanes(board);
        Object.keys(lanes).forEach(laneKey => {
            snapshotLaneCards(lanes[laneKey]).forEach(card => cards.push({ card, laneKey }));
        });
        return cards;
    }

    function countEndDayCards(board) {
        const selectedDay = getSelectedDay(board);
        return collectBoardCards(board).filter(entry => {
            const state = getEffectiveWorkflowState(entry.card.value, entry.laneKey);
            return isOpenWorkflowState(state) && getAttr(entry.card, TASK_ASSIGNED_DAY_ATTR) === selectedDay;
        }).length;
    }

    function countEndWeekCards(board) {
        const weekStart = getSelectedWeekStart(board);
        return collectBoardCards(board).filter(entry => {
            const state = getEffectiveWorkflowState(entry.card.value, entry.laneKey);
            return isOpenWorkflowState(state) && isTaskDateInWeek(getAttr(entry.card, TASK_ASSIGNED_DAY_ATTR), weekStart);
        }).length;
    }

    function setBoardPlanningView(board, mode, attrs) {
        if (!board) return false;
        runKanbanViewNoUndo(function () {
            model.beginUpdate();
            try {
                if (mode) setAttrNoUndo(board, TASK_VIEW_MODE_ATTR, normalizeTaskViewMode(mode), true);
                Object.entries(attrs || {}).forEach(([key, value]) => setAttrNoUndo(board, key, value, true));
                const weekStart = getSelectedWeekStart(board);
                setAttrNoUndo(board, TASK_SELECTED_DAY_ATTR, clampTaskDayToWeek(getSelectedDay(board), weekStart), true);
                ensureLanes(board);
                scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('boardNavigation') });
            } finally {
                model.endUpdate();
            }
        });
        return true;
    }

    function selectedScheduleLaneForBoard(board) {
        return selectedWeekDayLaneForBoard(board);
    }

    function createBreakCard(parentLane) {
        const board = findBoardAncestor(parentLane);
        const laneKey = getAttr(parentLane, 'lane_key');
        const assignedDay = board ? getVisibleDateForWeekLane(board, laneKey) : null;
        const card = createVertex('', 0, 0, 160, scheduleMinutesToPx(30), BREAK_CARD_STYLE);
        model.add(parentLane, card, model.getChildCount(parentLane));
        setAttrNoUndo(card, 'kanban_card', '1', true);
        setAttrNoUndo(card, TASK_SCHEDULE_BREAK_ATTR, '1', true);
        if (assignedDay) setAttrNoUndo(card, TASK_ASSIGNED_DAY_ATTR, assignedDay, true);
        setAttrNoUndo(card, TASK_SCHEDULE_DURATION_MINUTES_ATTR, '30', true);
        setAttrNoUndo(card, 'title', 'Break', true);
        setAttrNoUndo(card, 'status', getAttr(parentLane, 'status') || parentLane.value || '', true);
        refreshCardLabel(card, true);
        return card;
    }

    function addBreakToSelectedDay(board) {
        const lane = selectedScheduleLaneForBoard(board);
        if (!board || !lane) return false;
        const laneKey = getAttr(lane, 'lane_key');
        const dayWindow = isWeekDayLane(laneKey) ? getBoardWeekWorkHours(board)[getWeekDayIndexForLaneKey(laneKey)] : null;
        if (dayWindow && dayWindow.closed) return false;
        model.beginUpdate();
        try {
            createBreakCard(lane);
            scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('editHours') });
        } finally {
            model.endUpdate();
        }
        return true;
    }

    function saveSelectedWeekDayWorkHours(board, dayIndex, dayWindow) {
        if (!board || dayIndex < 0 || dayIndex >= WEEK_DAY_LANE_KEYS.length) return false;
        return taskTransactions.runModelUpdate({}, function () {
            const changed = persistSelectedWeekDayWorkWindow(board, dayIndex, dayWindow);
            if (changed) scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('editHours') });
            return changed;
        });
    }

    function openSelectedWeekDayFromDefaults(board, laneKey) {
        if (!board || !isWeekDayLane(laneKey)) return false;
        const dayIndex = getWeekDayIndexForLaneKey(laneKey);
        const editState = getBoardWeekWorkHourEditState(board);
        const dayWindow = normalizeWorkHourWindow(editState.week[dayIndex]);
        return saveSelectedWeekDayWorkHours(board, dayIndex, Object.assign({}, dayWindow, { closed: false }));
    }

    function closeSelectedWeekDay(board, lane) {
        if (!board || !lane || selectedWeekDayHasVisibleCards(lane)) return false;
        const laneKey = getAttr(lane, 'lane_key');
        if (!isWeekDayLane(laneKey)) return false;
        const dayIndex = getWeekDayIndexForLaneKey(laneKey);
        const editState = getBoardWeekWorkHourEditState(board);
        const dayWindow = normalizeWorkHourWindow(editState.week[dayIndex]);
        return saveSelectedWeekDayWorkHours(board, dayIndex, Object.assign({}, dayWindow, { closed: true }));
    }

    function elevateTaskManagerDialogImpl() {
        const dlg = ui && ui.dialog;
        if (dlg && dlg.bg && dlg.bg.style) dlg.bg.style.zIndex = String(TRELLIS_DIALOG_Z - 1);
        if (dlg && dlg.container && dlg.container.style) dlg.container.style.zIndex = String(TRELLIS_DIALOG_Z);
    }

    function showTaskManagerDialogImpl(node, width, height, modal, closable) {
        ui.showDialog(node, width, height, modal, closable);
        elevateTaskManagerDialogImpl();
    }

    function formatMinuteTimeInput(minutes) {
        const safe = Math.max(0, Math.min(1440, Number(minutes) || 0));
        const hh = String(Math.floor(safe / 60)).padStart(2, '0');
        const mm = String(safe % 60).padStart(2, '0');
        return `${hh}:${mm}`;
    }

    function parseMinuteTimeInput(value, fallback) {
        const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
        if (!match) return fallback;
        const h = Number(match[1]);
        const m = Number(match[2]);
        if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return fallback;
        return snapScheduleMinutes((h * 60) + m, fallback);
    }

    function showEditHoursDialogImpl(board) {
        if (!board) return;
        const weekStart = getSelectedWeekStart(board);
        const defaults = normalizeWeekWorkHours(parseJsonObject(getAttr(board, TASK_WORK_HOURS_DEFAULTS_ATTR)));
        const overridesRoot = parseJsonObject(getAttr(board, TASK_WORK_HOURS_WEEK_OVERRIDES_ATTR)) || { schemaVersion: 1, weeks: {} };
        const weeks = overridesRoot.weeks && typeof overridesRoot.weeks === 'object' ? overridesRoot.weeks : {};
        const weekOverrides = normalizeWeekWorkHours(weeks[weekStart], defaults);
        const div = document.createElement('div');
        div.className = 'trellis-task-hours-dialog';
        div.style.cssText = 'padding:12px;box-sizing:border-box;font:12px Arial,sans-serif;';
        const title = document.createElement('div');
        title.textContent = 'Edit Hours';
        title.style.cssText = 'font-size:16px;font-weight:bold;margin-bottom:10px;';
        div.appendChild(title);
        const rows = [];
        const rowGridCss = 'display:grid;grid-template-columns:110px 78px minmax(136px,1fr) minmax(136px,1fr);gap:8px;align-items:center;';
        function styleTimeInput(input) {
            input.style.cssText = 'width:100%;min-width:136px;box-sizing:border-box;font:12px Arial,sans-serif;';
        }
        function updateClosedRowState(row, closed, start, end) {
            const isClosed = !!closed.checked;
            start.disabled = isClosed;
            end.disabled = isClosed;
            row.style.opacity = isClosed ? '0.72' : '1';
        }
        function addHeaderRow() {
            const header = document.createElement('div');
            header.style.cssText = rowGridCss + 'font-weight:bold;color:#374151;margin:0 0 5px;border-bottom:1px solid #d1d5db;padding-bottom:4px;';
            ['Day', 'Closed', 'Start', 'End'].forEach(text => {
                const cell = document.createElement('div');
                cell.textContent = text;
                header.appendChild(cell);
            });
            div.appendChild(header);
        }
        function addSection(labelText, sourceDays, kind) {
            const label = document.createElement('div');
            label.textContent = labelText;
            label.style.cssText = 'font-weight:bold;margin:12px 0 6px;';
            div.appendChild(label);
            addHeaderRow();
            sourceDays.forEach((day, index) => {
                const row = document.createElement('div');
                row.style.cssText = rowGridCss + 'margin-bottom:5px;';
                const name = document.createElement('span');
                name.textContent = KANBAN_LANE_DEFS[5 + index].label;
                const closed = document.createElement('input');
                closed.type = 'checkbox';
                closed.checked = !!day.closed;
                const start = document.createElement('input');
                start.type = 'time';
                start.step = String(SCHEDULE_MINUTE_SNAP * 60);
                start.value = formatMinuteTimeInput(day.startMinute);
                styleTimeInput(start);
                const end = document.createElement('input');
                end.type = 'time';
                end.step = String(SCHEDULE_MINUTE_SNAP * 60);
                end.value = formatMinuteTimeInput(day.endMinute);
                styleTimeInput(end);
                closed.addEventListener('change', function () { updateClosedRowState(row, closed, start, end); });
                updateClosedRowState(row, closed, start, end);
                row.appendChild(name);
                row.appendChild(closed);
                row.appendChild(start);
                row.appendChild(end);
                div.appendChild(row);
                rows.push({ kind, index, closed, start, end, fallback: day });
            });
        }
        addSection('Board defaults', defaults, 'default');
        addSection('Selected week', weekOverrides, 'week');
        const buttons = document.createElement('div');
        buttons.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px;';
        const cancel = mxUtils.button('Cancel', function () { ui.hideDialog(); });
        const save = mxUtils.button('Save', function () {
            const nextDefaults = defaults.slice();
            const nextWeek = weekOverrides.slice();
            rows.forEach(row => {
                const startMinute = parseMinuteTimeInput(row.start.value, row.fallback.startMinute);
                const endMinute = parseMinuteTimeInput(row.end.value, row.fallback.endMinute);
                const target = row.kind === 'default' ? nextDefaults : nextWeek;
                target[row.index] = normalizeWorkHourWindow({ closed: row.closed.checked, startMinute, endMinute });
            });
            taskCommands.saveBoardWeekWorkHours(board, weekStart, weeks, nextDefaults, nextWeek);
            ui.hideDialog();
        });
        applyTaskButtonStyle(cancel, 'neutral');
        applyTaskButtonStyle(save, 'add');
        buttons.appendChild(cancel);
        buttons.appendChild(save);
        div.appendChild(buttons);
        taskDialogs.showTaskManagerDialog(div, 660, 600, true, true);
    }

    function showEditDayHoursDialogImpl(board, laneKey) {
        if (!board || !isWeekDayLane(laneKey)) return;
        const dayIndex = getWeekDayIndexForLaneKey(laneKey);
        const editState = getBoardWeekWorkHourEditState(board);
        const day = normalizeWorkHourWindow(editState.week[dayIndex]);
        const div = document.createElement('div');
        div.className = 'trellis-task-day-hours-dialog';
        div.style.cssText = 'padding:12px;box-sizing:border-box;font:12px Arial,sans-serif;';
        const title = document.createElement('div');
        title.textContent = 'Change Hours - ' + KANBAN_LANE_DEFS[5 + dayIndex].label;
        title.style.cssText = 'font-size:16px;font-weight:bold;margin-bottom:10px;';
        div.appendChild(title);
        const row = document.createElement('div');
        row.style.cssText = 'display:grid;grid-template-columns:80px minmax(130px,1fr);gap:8px;align-items:center;margin-bottom:8px;';
        const closedLabel = document.createElement('label');
        closedLabel.textContent = 'Closed';
        const closed = document.createElement('input');
        closed.type = 'checkbox';
        closed.checked = !!day.closed;
        row.appendChild(closedLabel);
        row.appendChild(closed);
        const startLabel = document.createElement('label');
        startLabel.textContent = 'Start';
        const start = document.createElement('input');
        start.type = 'time';
        start.step = String(SCHEDULE_MINUTE_SNAP * 60);
        start.value = formatMinuteTimeInput(day.startMinute);
        const endLabel = document.createElement('label');
        endLabel.textContent = 'End';
        const end = document.createElement('input');
        end.type = 'time';
        end.step = String(SCHEDULE_MINUTE_SNAP * 60);
        end.value = formatMinuteTimeInput(day.endMinute);
        [start, end].forEach(input => { input.style.cssText = 'width:100%;min-width:130px;box-sizing:border-box;font:12px Arial,sans-serif;'; });
        row.appendChild(startLabel);
        row.appendChild(start);
        row.appendChild(endLabel);
        row.appendChild(end);
        function updateClosedState() {
            start.disabled = !!closed.checked;
            end.disabled = !!closed.checked;
            row.style.opacity = closed.checked ? '0.72' : '1';
        }
        closed.addEventListener('change', updateClosedState);
        updateClosedState();
        div.appendChild(row);
        const buttons = document.createElement('div');
        buttons.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px;';
        const cancel = mxUtils.button('Cancel', function () { ui.hideDialog(); });
        const save = mxUtils.button('Save', function () {
            const startMinute = parseMinuteTimeInput(start.value, day.startMinute);
            const endMinute = parseMinuteTimeInput(end.value, day.endMinute);
            taskCommands.saveSelectedWeekDayWorkHours(board, dayIndex, normalizeWorkHourWindow({ closed: closed.checked, startMinute, endMinute }));
            ui.hideDialog();
        });
        applyTaskButtonStyle(cancel, 'neutral');
        applyTaskButtonStyle(save, 'add');
        buttons.appendChild(cancel);
        buttons.appendChild(save);
        div.appendChild(buttons);
        taskDialogs.showTaskManagerDialog(div, 360, 210, true, true);
    }

    function saveBoardWeekWorkHours(board, weekStart, weeks, nextDefaults, nextWeek) {
        if (!board || !parseTaskCalendarISO(weekStart)) return false;
        return taskTransactions.runModelUpdate({}, function () {
            setAttrNoUndo(board, TASK_WORK_HOURS_DEFAULTS_ATTR, serializeWeekWorkHours(nextDefaults), true);
            const nextWeeks = weeks && typeof weeks === 'object' ? weeks : {};
            nextWeeks[weekStart] = { schemaVersion: 1, days: normalizeWeekWorkHours(nextWeek) };
            setAttrNoUndo(board, TASK_WORK_HOURS_WEEK_OVERRIDES_ATTR, JSON.stringify({ schemaVersion: 1, weeks: nextWeeks }), true);
            scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('editHours') });
            return true;
        });
    }

    function endDay(board) {
        const selectedDay = getSelectedDay(board);
        let changed = false;
        model.beginUpdate();
        try {
            collectBoardCards(board).forEach(entry => {
                const state = getEffectiveWorkflowState(entry.card.value, entry.laneKey);
                if (!isOpenWorkflowState(state) || getAttr(entry.card, TASK_ASSIGNED_DAY_ATTR) !== selectedDay) return;
                const patch = buildIncompletePatch(entry.card.value, selectedDay);
                if (patch) changed = applyCardPatchInsideUpdate(entry.card, patch.attributes) || changed;
            });
            if (changed) scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('workflow') });
        } finally {
            model.endUpdate();
        }
        return changed;
    }

    function endWeek(board) {
        const weekStart = getSelectedWeekStart(board);
        let changed = false;
        model.beginUpdate();
        try {
            collectBoardCards(board).forEach(entry => {
                const state = getEffectiveWorkflowState(entry.card.value, entry.laneKey);
                const assignedDay = getAttr(entry.card, TASK_ASSIGNED_DAY_ATTR);
                if (!isOpenWorkflowState(state) || !isTaskDateInWeek(assignedDay, weekStart)) return;
                const patch = buildIncompletePatch(entry.card.value, assignedDay);
                if (patch) changed = applyCardPatchInsideUpdate(entry.card, patch.attributes) || changed;
            });
            if (changed) scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('workflow') });
        } finally {
            model.endUpdate();
        }
        return changed;
    }

    function applyCardWorkflowAction(card, action) {
        return applyCardWorkflowActions([card], action) > 0;
    }

    function buildCardWorkflowContext(board) {
        return {
            mode: getBoardViewMode(board),
            selectedDay: getSelectedDay(board),
            selectedWeekStart: getSelectedWeekStart(board),
            today: todayISO()
        };
    }

    function uniqueKanbanCards(cells) {
        const out = [];
        const seen = new Set();
        for (const cell of (cells || [])) {
            const id = cell && (cell.id || (cell.getId && cell.getId()));
            if (!id || seen.has(id) || !model.isVertex(cell) || !isWorkflowActionCard(cell)) continue;
            seen.add(id);
            out.push(cell);
        }
        return out;
    }

    function selectedKanbanCards() {
        return uniqueKanbanCards(getSelectionCellsList());
    }

    function getAssignmentSelectionContext(cards) {
        const selected = uniqueKanbanCards(cards);
        const raw = getSelectionCellsList();
        if (!selected.length || raw.length !== selected.length || selected.some(isScheduleBreakCard)) return null;
        const board = findBoardAncestor(selected[0]);
        if (!board || getBoardViewMode(board) !== 'WEEK' || selected.some(card => findBoardAncestor(card) !== board)) return null;
        return { board, cards: selected, roster: getBoardRoleRoster(board) };
    }

    function applyTaskAssignmentSets(cards, nextIdsByCard) { // NEW: one undoable transaction for single or bulk assignment
        const context = getAssignmentSelectionContext(cards);
        if (!context || !nextIdsByCard || typeof nextIdsByCard.get !== 'function') return 0;
        const changes = context.cards.map(card => ({ card, serialized: serializeTaskAssigneeRoleIds(nextIdsByCard.get(card)) }))
            .filter(entry => entry.serialized !== serializeTaskAssigneeRoleIds(getTaskAssigneeRoleIds(entry.card)));
        if (!changes.length) return 0; // NEW: a no-op draft creates no undo transaction
        return runTrellisHistoryTransaction({ category: "Assignments", action: "assign", origin: "Garden_Task_Manager", title: "Update task assignments", affectedCellIds: historyCellIds(changes.map(entry => entry.card)) }, function () {
            model.beginUpdate();
            try {
                changes.forEach(entry => model.setValue(entry.card, cloneCardValueWithAttributes(entry.card, { [TASK_ASSIGNEE_ROLE_IDS_ATTR]: entry.serialized })));
            } finally {
                model.endUpdate();
            }
            return changes.length;
        });
    }

    function applyCardWorkflowActions(cards, action) {
        const selected = uniqueKanbanCards(cards);
        const affectedBoards = new Map();
        let changedCount = 0;
        if (!selected.length) return 0;
        model.beginUpdate();
        try {
            selected.forEach(card => {
                const board = findBoardAncestor(card);
                if (!board) return;
                const patch = buildWorkflowPatch(card.value, action, buildCardWorkflowContext(board));
                if (!patch || !patch.attributes) return;
                if (applyCardPatchInsideUpdate(card, patch.attributes)) {
                    changedCount += 1;
                    affectedBoards.set(board.id || board.getId && board.getId() || changedCount, board);
                }
            });
            affectedBoards.forEach(board => scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('workflow') }));
        } finally {
            model.endUpdate();
        }
        return changedCount;
    }

    function selectionIsOnlyStagedWorkflowCards(cards) {
        const raw = getSelectionCellsList();
        if (!cards || !cards.length || raw.length !== cards.length) return false;
        return cards.every(card => laneKeyOfCard(card) === 'TODO_STAGED');
    }

    function selectionIsOnlyWeekDayLaneCards(cards) {
        const raw = getSelectionCellsList();
        if (!cards || !cards.length || raw.length !== cards.length) return false;
        return cards.every(card => isWeekDayLane(laneKeyOfCard(card)));
    }

    function applyStagedStartDateAllocation(cards) {
        const selected = uniqueKanbanCards(cards).filter(card => laneKeyOfCard(card) === 'TODO_STAGED');
        const affectedBoards = new Map();
        let changedCount = 0;
        if (!selected.length) return 0;
        model.beginUpdate();
        try {
            selected.forEach(card => {
                const board = findBoardAncestor(card);
                if (!board) return;
                const patch = buildStagedStartDateAllocationPatch(card.value, buildCardWorkflowContext(board));
                if (!patch || !patch.attributes) return;
                if (applyCardPatchInsideUpdate(card, patch.attributes)) {
                    changedCount += 1;
                    affectedBoards.set(board.id || board.getId && board.getId() || changedCount, board);
                }
            });
            affectedBoards.forEach(board => scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('workflow') }));
        } finally {
            model.endUpdate();
        }
        return changedCount;
    }

    function applyBulkCardEdit(cards, opts) {
        const selected = uniqueKanbanCards(cards);
        const options = opts || {};
        const affectedBoards = new Map();
        const result = { changed: 0, noteChanged: 0, dateChanged: 0, dateSkipped: 0 };
        if (!selected.length || (!options.replaceNote && !options.setStartDate)) return result;
        model.beginUpdate();
        try {
            selected.forEach(card => {
                const attributes = {};
                let dateChangedForCard = false;
                if (options.replaceNote) {
                    const notePatch = buildCardNotePatch(card.value, options.note);
                    if (notePatch && notePatch.changed) {
                        Object.assign(attributes, notePatch.attributes);
                        result.noteChanged += 1;
                    }
                }
                if (options.setStartDate) {
                    if (!canEditCardDates(card)) {
                        result.dateSkipped += 1;
                    } else {
                        const datePatch = buildCardDateOverridePatch(card.value, options.startDate);
                        if (datePatch && datePatch.changed !== false && datePatch.attributes) {
                            Object.assign(attributes, datePatch.attributes);
                            dateChangedForCard = true;
                            result.dateChanged += 1;
                        }
                    }
                }
                if (Object.keys(attributes).length === 0) return;
                if (applyCardPatchInsideUpdate(card, attributes)) {
                    result.changed += 1;
                    if (!dateChangedForCard) updateBadgeForLane(card, laneKeyOfCard(card), true);
                    if (dateChangedForCard) {
                        const board = findBoardAncestor(card);
                        if (board) affectedBoards.set(board.id || board.getId && board.getId() || result.changed, board);
                    }
                }
            });
            affectedBoards.forEach(board => scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('dateEdit') }));
        } finally {
            model.endUpdate();
        }
        return result;
    }

    function resetCardDatesForCards(cards) {
        const selected = uniqueKanbanCards(cards);
        const affectedBoards = new Map();
        let changedCount = 0;
        if (!selected.length) return 0;
        model.beginUpdate();
        try {
            selected.forEach(card => {
                if (!hasCardDateOverride(card)) return;
                const patch = buildCardDateResetPatch(card.value);
                if (!patch) return;
                if (applyCardPatchInsideUpdate(card, patch)) {
                    changedCount += 1;
                    const board = findBoardAncestor(card);
                    if (board) affectedBoards.set(board.id || board.getId && board.getId() || changedCount, board);
                }
            });
            affectedBoards.forEach(board => scanAndReflowBoard(board, { insideUpdate: true, scope: getTaskReflowScopeForCommand('dateEdit') }));
        } finally {
            model.endUpdate();
        }
        return changedCount;
    }

    function createTaskCommandRuntime({ boardLayout, transactions }) { // CHANGE: command seam for UI, events, and menu entrypoints
        function replaceTasks(targetGroupId, tasks, opts) {
            return replaceTasksPreservingAssignments(targetGroupId, tasks, opts);
        }

        function applySchedulerTaskReplacement(detail, opts) {
            const replacement = normalizeTaskReplacementDetail(detail);
            const options = opts || {};
            const focusCreated = options.focusCreated === true; // NEW: scheduler-origin replacements preserve the current viewport by default
            if ((replacement.mode !== 'replace' && replacement.mode !== 'sync') || !replacement.targetGroupId) return null;
            if (replacement.mode === 'sync') return applyDifferentialTaskSync({ targetGroupId: replacement.targetGroupId, tasks: replacement.tasks, insideUpdate: !!options.insideUpdate, focusCreated });
            return replaceTasks(replacement.targetGroupId, replacement.tasks, { insideUpdate: !!options.insideUpdate, focusCreated });
        }

        function ensureBoardTemplateInUpdate(containerVertex) {
            return transactions.runModelUpdate({}, function () {
                return boardLayout.ensureBoardTemplateIn(containerVertex, { insideUpdate: true });
            });
        }

        return Object.freeze({
            runModelUpdate: transactions.runModelUpdate,
            createTasks,
            removeTasksLinkedOnlyTo,
            replaceTasks,
            applySchedulerTaskReplacement,
            applyDifferentialTaskSync,
            commitCardPatch,
            applyCardDateOverride,
            resetCardDates,
            resetCardDatesForCards,
            setCardNote,
            clearCardNote,
            setRepeatSeriesExpanded,
            setBoardPlanningView,
            saveBoardWeekWorkHours,
            saveSelectedWeekDayWorkHours,
            openSelectedWeekDayFromDefaults,
            closeSelectedWeekDay,
            endDay,
            endWeek,
            addBreakToSelectedDay,
            applyCardWorkflowAction,
            applyCardWorkflowActions,
            applyStagedStartDateAllocation,
            applyBulkCardEdit,
            scanAndReflowBoard,
            scanAllBoards,
            ensureBoardTemplateIn: boardLayout.ensureBoardTemplateIn,
            ensureBoardTemplateInUpdate
        });
    }

    const taskCommands = createTaskCommandRuntime({
        graph,
        model,
        adapters: taskRuntimeAdapters,
        boardLayout: boardLayoutService,
        taskPolicy,
        schedulePolicy,
        transactions: taskTransactions
    });

    if (typeof globalThis !== 'undefined' && globalThis.__TRELLIS_TASK_MANAGER_TEST__) {
        globalThis.__TRELLIS_TASK_MANAGER_RUNTIME_TEST_HOOKS__ = Object.freeze({
            createTasks: taskCommands.createTasks,
            replaceTasks: taskCommands.replaceTasks,
            applyDifferentialTaskSync: taskCommands.applyDifferentialTaskSync,
            unseenHighlightCount: taskUnseenHighlightCountForTests
        });
    }

    window.USL = window.USL || {};
    window.USL.tasks = Object.assign({}, window.USL.tasks, {
        applySchedulerTaskReplacement: taskCommands.applySchedulerTaskReplacement
    });

    graph.__trellisTaskManager = Object.assign({}, graph.__trellisTaskManager || {}, {
        ensureMainBoardInTaskModule: function (taskModule) {
            return taskCommands.ensureBoardTemplateInUpdate(taskModule);
        },
        listBoardsForGarden: function (gardenModule) {
            return listBoardsForGarden(gardenModule);
        },
        createSecondaryBoardInTaskModule: function (taskModule) {
            return taskCommands.runModelUpdate({}, function () { return createSecondaryBoardIn(taskModule); });
        },
        openBoardForGarden: function (gardenModule, boardId, year) {
            return openBoardForGarden(gardenModule, boardId, year);
        },
        unseenCreatedSummaryForGarden: function (gardenModule) {
            return taskBoardUnseenSummaryForGarden(gardenModule);
        },
        markBoardYearViewed: function (gardenModule, board, year) {
            return markBoardYearViewed(board, gardenModule, year);
        },
        setActiveDashboardContext: function (gardenModule, year) {
            activeDashboardTaskContext = gardenModule && year ? { gardenModule, year: String(year) } : null;
        },
        clearTransientUnseenHighlights: clearTransientUnseenHighlights
    });

    // -------------------- DOM overlay host and installers --------------------
    function ensureTaskControlOverlayHost() {
        const pane = graph.view && graph.view.overlayPane ? graph.view.overlayPane : null;
        const paneIsSvg = !!(pane && pane.namespaceURI === 'http://www.w3.org/2000/svg');
        const baseHost = pane && !paneIsSvg ? pane : (graph.container || pane || null);
        if (!baseHost) return null;
        const style = window.getComputedStyle ? window.getComputedStyle(baseHost) : null;
        if (style && style.position === 'static') baseHost.style.position = 'relative';
        let host = baseHost;
        if (document && document.createElement && baseHost.namespaceURI !== 'http://www.w3.org/2000/svg') {
            host = graph.__trellisTaskControlLayer && graph.__trellisTaskControlLayer.parentNode === baseHost ? graph.__trellisTaskControlLayer : null;
            if (!host) {
                host = document.createElement('div');
                host.className = 'trellis-task-control-layer';
                host.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:' + GRAPH_OVERLAY_Z.CONTROL + ';';
                baseHost.appendChild(host);
                graph.__trellisTaskControlLayer = host;
            }
        }
        return host;
    }

    function getSelectionCellsList() {
        if (graph.getSelectionCells) return graph.getSelectionCells() || [];
        const cell = graph.getSelectionCell && graph.getSelectionCell();
        return cell ? [cell] : [];
    }

    function isBoardCell(cell) {
        return !!(cell && model.isVertex(cell) && (getAttr(cell, 'board_key') === BOARD_KEY || getAttr(cell, 'board_key') === LEGACY_KANBAN_BOARD_KEY));
    }

    function getStateHostBounds(cell, state, host) {
        if (!state) return null;
        const shapeNode = state.shape && state.shape.node ? state.shape.node : null;
        if (shapeNode && shapeNode.getBoundingClientRect && host && host.getBoundingClientRect) {
            const rect = shapeNode.getBoundingClientRect();
            const hostRect = host.getBoundingClientRect();
            if (rect && hostRect && rect.width > 0 && rect.height > 0) {
                return { x: rect.left - hostRect.left + (host.scrollLeft || 0), y: rect.top - hostRect.top + (host.scrollTop || 0), width: rect.width, height: rect.height, source: 'domRect' };
            }
        }
        return { x: Number(state.x) || 0, y: Number(state.y) || 0, width: Number(state.width) || 0, height: Number(state.height) || 0, source: 'mxCellState' };
    }

    function getCellVisualBounds(cell, host) {
        const state = graph.view && graph.view.getState ? graph.view.getState(cell) : null;
        const stateBounds = getStateHostBounds(cell, state, host);
        if (stateBounds) return stateBounds;
        let cur = cell;
        let x = 0;
        let y = 0;
        let width = 0;
        let height = 0;
        while (cur) {
            const geo = model.getGeometry ? model.getGeometry(cur) : (cur.getGeometry ? cur.getGeometry() : null);
            if (geo) {
                x += Number(geo.x) || 0;
                y += Number(geo.y) || 0;
                if (cur === cell) { width = Number(geo.width) || 0; height = Number(geo.height) || 0; }
            }
            cur = model.getParent ? model.getParent(cur) : null;
        }
        return width > 0 || height > 0 ? { x, y, width, height, source: 'geometry' } : null;
    }

    function getCellStateBounds(cells, host) {
        let bounds = null;
        for (const cell of (cells || [])) {
            const state = graph.view && graph.view.getState ? graph.view.getState(cell) : null;
            const hostBounds = getStateHostBounds(cell, state, host);
            if (!hostBounds) continue;
            const x = Number(hostBounds.x) || 0;
            const y = Number(hostBounds.y) || 0;
            const width = Number(hostBounds.width) || 0;
            const height = Number(hostBounds.height) || 0;
            if (!bounds) {
                bounds = { x, y, right: x + width, bottom: y + height };
            } else {
                bounds.x = Math.min(bounds.x, x);
                bounds.y = Math.min(bounds.y, y);
                bounds.right = Math.max(bounds.right, x + width);
                bounds.bottom = Math.max(bounds.bottom, y + height);
            }
        }
        return bounds ? { x: bounds.x, y: bounds.y, width: bounds.right - bounds.x, height: bounds.bottom - bounds.y } : null;
    }

    function positionDomOverlayFromBounds(element, bounds, below, above, extraY, extraX) {
        if (!element || !bounds || !element.parentNode) return false;
        const left = bounds.x;
        const topBase = bounds.y;
        const yOffset = Number.isFinite(Number(extraY)) ? Number(extraY) : 0;
        const xOffset = Number.isFinite(Number(extraX)) ? Number(extraX) : 0;
        element.style.left = Math.max(0, Math.round(left + xOffset)) + 'px';
        if (below) element.style.top = Math.max(0, Math.round(topBase + bounds.height + 6 + yOffset)) + 'px';
        else if (above) element.style.top = Math.max(0, Math.round(topBase - element.offsetHeight - 6 - yOffset)) + 'px';
        else element.style.top = Math.max(0, Math.round(topBase + yOffset)) + 'px';
        return true;
    }

    function positionDomOverlayFromCellState(element, cell, below, above, extraY, extraX) {
        const state = graph.view && graph.view.getState ? graph.view.getState(cell) : null;
        const hostBounds = getStateHostBounds(cell, state, element && element.parentNode);
        return positionDomOverlayFromBounds(element, hostBounds, below, above, extraY, extraX);
    }

    function positionDomOverlayFromCellStateUnclamped(element, cell, below, above, extraY, extraX) {
        const state = graph.view && graph.view.getState ? graph.view.getState(cell) : null;
        const bounds = getStateHostBounds(cell, state, element && element.parentNode);
        if (!element || !bounds || !element.parentNode) return false;
        const yOffset = Number.isFinite(Number(extraY)) ? Number(extraY) : 0;
        const xOffset = Number.isFinite(Number(extraX)) ? Number(extraX) : 0;
        element.style.left = Math.round((Number(bounds.x) || 0) + xOffset) + 'px'; // NEW: selected task module overlays intentionally do not clamp to the viewport
        if (below) element.style.top = Math.round((Number(bounds.y) || 0) + (Number(bounds.height) || 0) + 6 + yOffset) + 'px';
        else if (above) element.style.top = Math.round((Number(bounds.y) || 0) - element.offsetHeight - 6 - yOffset) + 'px';
        else element.style.top = Math.round((Number(bounds.y) || 0) + yOffset) + 'px';
        return true;
    }

    function taskModuleLabelApi() {
        return graph && graph.__trellisModules ? graph.__trellisModules : {};
    }

    function plainModuleLabelFallback(cell, fallback) {
        const raw = getAttr(cell, 'label') || (typeof (cell && cell.value) === 'string' ? cell.value : '');
        if (document && document.createElement) {
            const holder = document.createElement('div');
            holder.innerHTML = raw;
            const text = String(holder.textContent || '').replace(/\s+/g, ' ').trim();
            if (text) return text;
        }
        const stripped = String(raw || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        return stripped || fallback || 'Task Module';
    }

    function getTaskModuleOverlayLabel(taskModule) {
        const api = taskModuleLabelApi();
        return typeof api.getModuleLabel === 'function' ? api.getModuleLabel(taskModule, 'Task Module') : plainModuleLabelFallback(taskModule, 'Task Module');
    }

    function buildTaskModuleLabelXmlValueForEdit(taskModule) {
        if (!taskModule) return null;
        const value = taskModule.value;
        if (value && value.nodeType === 1) return value.cloneNode(true);
        const doc = mxUtils.createXmlDocument ? mxUtils.createXmlDocument() : document.implementation.createDocument('', '', null);
        const node = doc.createElement('object');
        if (typeof value === 'string' && value) node.setAttribute('label', value);
        return node;
    }

    function writeTaskModuleOverlayLabelUndoable(taskModule, label) {
        const node = buildTaskModuleLabelXmlValueForEdit(taskModule);
        if (!node) return;
        node.setAttribute('label', label);
        model.beginUpdate();
        try {
            model.setValue(taskModule, node);
        } finally {
            model.endUpdate();
        }
        if (graph.refresh) graph.refresh(taskModule);
    }

    function writeTaskModuleOverlayLabel(taskModule, label) {
        const api = taskModuleLabelApi();
        if (typeof api.writeModuleLabel === 'function') return api.writeModuleLabel(taskModule, label);
        const next = String(label == null ? '' : label).trim() || 'Task Module';
        if (plainModuleLabelFallback(taskModule, 'Task Module') !== next) writeTaskModuleOverlayLabelUndoable(taskModule, next);
        return next;
    }

    function registerTaskOverlayGestureElement(element) {
        if (!element || taskOverlayGestureElements.indexOf(element) >= 0) return;
        taskOverlayGestureElements.push(element);
    }

    function unregisterTaskOverlayGestureElement(element) {
        const index = taskOverlayGestureElements.indexOf(element);
        if (index >= 0) taskOverlayGestureElements.splice(index, 1);
    }

    function hideTaskOverlayGestureElements() {
        taskOverlayGestureElements.forEach(element => { if (element && element.style) element.style.display = 'none'; });
    }

    function isTaskOverlayGestureCell(cell) {
        return !!(cell && model.isVertex(cell) && isKanbanCard(cell)); // CHANGE: preserve existing non-card overlay behavior while card drags hide the pager
    }

    function selectedOrTargetHasTaskCell(targetCell) {
        if (isTaskOverlayGestureCell(targetCell)) return true;
        return getSelectionCellsList().some(isTaskOverlayGestureCell);
    }

    function taskOverlayMouseEventCell(me) {
        if (me && typeof me.getCell === 'function') return me.getCell();
        return null;
    }

    function scheduleTaskOverlayGestureRefresh() {
        if (taskOverlayGestureRefreshScheduled) return;
        taskOverlayGestureRefreshScheduled = true;
        setTimeout(function () {
            taskOverlayGestureRefreshScheduled = false;
            Array.from(taskOverlayGestureRefreshers).forEach(refresh => refresh());
        }, 0);
    }

    function beginTaskOverlayGesture() {
        if (taskOverlayGestureActive) return;
        taskOverlayGestureActive = true;
        hideTaskOverlayGestureElements();
    }

    function endTaskOverlayGesture() {
        if (!taskOverlayGestureActive) return;
        taskOverlayGestureActive = false;
        scheduleTaskOverlayGestureRefresh();
    }

    function installTaskOverlayGestureGate() {
        if (graph.__trellisTaskOverlayGestureGateInstalled) return;
        graph.__trellisTaskOverlayGestureGateInstalled = true;
        if (graph.addMouseListener) {
            graph.addMouseListener({
                mouseDown(_sender, me) { if (selectedOrTargetHasTaskCell(taskOverlayMouseEventCell(me))) beginTaskOverlayGesture(); },
                mouseMove() {},
                mouseUp() { endTaskOverlayGesture(); }
            });
        }
        if (graph.addListener) {
            graph.addListener(mxEvent.CELLS_MOVED || 'cellsMoved', endTaskOverlayGesture);
            graph.addListener(mxEvent.CELLS_RESIZED || 'cellsResized', endTaskOverlayGesture);
        }
        if (graph.panningHandler && graph.panningHandler.addListener) {
            graph.panningHandler.addListener(mxEvent.PAN_START || 'panStart', beginTaskOverlayGesture);
            graph.panningHandler.addListener(mxEvent.PAN_END || 'panEnd', endTaskOverlayGesture);
        }
        const mouseUpTarget = window && window.addEventListener ? window : (document && document.addEventListener ? document : null);
        if (mouseUpTarget) mouseUpTarget.addEventListener('mouseup', endTaskOverlayGesture, true);
    }

    function createDeferredTaskOverlayRefresh(refresh) {
        let pending = false;
        if (refresh) taskOverlayGestureRefreshers.add(refresh);
        return function requestRefresh() {
            if (taskOverlayGestureActive) {
                hideTaskOverlayGestureElements();
                return;
            }
            if (pending) return;
            pending = true;
            setTimeout(function () {
                pending = false;
                if (taskOverlayGestureActive) { hideTaskOverlayGestureElements(); return; }
                refresh();
            }, 0);
        };
    }

    function addGraphViewRefreshListener(refresh) {
        if (!refresh) return;
        if (graph.view && graph.view.addListener) {
            graph.view.addListener(mxEvent.SCALE, refresh);
            graph.view.addListener(mxEvent.TRANSLATE, refresh);
            graph.view.addListener(mxEvent.SCALE_AND_TRANSLATE, refresh);
            graph.view.addListener(mxEvent.REPAINT, refresh);
        }
        if (model.addListener) model.addListener(mxEvent.CHANGE, refresh);
        if (graph.container && graph.container.addEventListener) graph.container.addEventListener('scroll', refresh, { passive: true });
    }

    function setPagingSelectionCells(cells) {
        const next = (cells || []).filter(Boolean);
        if (!next.length) return;
        taskPagingSelectionGuard = true;
        try {
            if (next.length > 1 && graph.setSelectionCells) graph.setSelectionCells(next);
            else if (graph.setSelectionCell) graph.setSelectionCell(next[0]);
        } finally { taskPagingSelectionGuard = false; }
    }

    function selectedTaskBoard() {
        const boards = new Set();
        getSelectionCellsList().forEach(cell => {
            const board = isBoardCell(cell) ? cell : findBoardAncestor(cell);
            if (board) boards.add(board);
        });
        return boards.size === 1 ? Array.from(boards)[0] : null;
    }

    function selectedRenderableTaskCards() {
        return getSelectionCellsList().filter(cell => cell && model.isVertex(cell) && isRenderableKanbanCard(cell));
    }

    function isCellModelVisible(cell) {
        return !model.isVisible || model.isVisible(cell) !== false;
    }

    function repairSelectionAfterAutomaticPaging() { // NEW: automatic reflow never moves pages merely to retain selection
        if (taskPagingSelectionGuard) return;
        const selectedCards = selectedRenderableTaskCards();
        if (!selectedCards.some(card => !isCellModelVisible(card))) return;
        const boards = new Set(selectedCards.map(findBoardAncestor).filter(Boolean));
        if (boards.size !== 1) return; // NEW: cross-board selection remains untouched
        const lanes = new Set(selectedCards.map(card => model.getParent(card)).filter(Boolean));
        if (lanes.size > 1) setPagingSelectionCell(Array.from(boards)[0]);
        else if (lanes.size === 1) setPagingSelectionCell(Array.from(lanes)[0]);
    }

    function revealExternallySelectedPage() { // NEW: user selection is authoritative and may reveal one hidden lane page
        if (taskPagingSelectionGuard) return;
        const selectedCards = selectedRenderableTaskCards();
        if (!selectedCards.some(card => !isCellModelVisible(card))) return;
        const boards = new Set(selectedCards.map(findBoardAncestor).filter(Boolean));
        if (boards.size !== 1) return; // NEW: do not rewrite cross-board selection
        const lanes = new Set(selectedCards.map(card => model.getParent(card)).filter(Boolean));
        if (lanes.size !== 1) { setPagingSelectionCell(Array.from(boards)[0]); return; }
        const lane = Array.from(lanes)[0];
        const laneKey = getAttr(lane, 'lane_key');
        const firstSelectedCard = selectedCards[0];
        applyLanePaging(lane, laneKey, getLaneCardsInOrder(lane), { anchorCardId: taskCellId(firstSelectedCard), skipSelectionRepair: true });
        setPagingSelectionCells(selectedCards.filter(isCellModelVisible)); // NEW: hidden siblings outside the revealed page are dropped
    }

    graph.__trellisTaskPagingApi = {
        revealCard(card) {
            if (!card || !isRenderableKanbanCard(card)) return false;
            if (isCellModelVisible(card)) return true;
            const lane = model.getParent(card);
            if (!lane) return false;
            const laneKey = getAttr(lane, 'lane_key');
            applyLanePaging(lane, laneKey, getLaneCardsInOrder(lane), { anchorCardId: taskCellId(card), skipSelectionRepair: true });
            requestLanePagerOverlayRefresh();
            return isCellModelVisible(card);
        }
    };

    function installLanePagerStyles() {
        const styleId = 'trellis-task-lane-pager-styles';
        if (!document || !document.createElement || document.getElementById(styleId)) return;
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = [
            '.trellis-task-lane-pager{position:absolute;display:flex;align-items:center;justify-content:center;gap:6px;pointer-events:auto;z-index:' + GRAPH_OVERLAY_Z.CONTROL_TOP + ';font:12px Arial,sans-serif;white-space:nowrap}',
            '.trellis-task-lane-pager__button{box-sizing:border-box;width:28px;height:28px;min-width:28px;border:1px solid #D1D5DB;border-radius:999px;padding:0;display:inline-flex;align-items:center;justify-content:center;background:#FFF;color:#2563EB;box-shadow:0 1px 2px rgba(0,0,0,.12);cursor:pointer}',
            '.trellis-task-lane-pager__button:hover:not(:disabled){background:#EFF6FF;border-color:#93C5FD}',
            '.trellis-task-lane-pager__button:focus-visible,.trellis-task-lane-pager__select:focus-visible{outline:2px solid #2563EB;outline-offset:2px}',
            '.trellis-task-lane-pager__button:disabled{opacity:.38;cursor:default}',
            '.trellis-task-lane-pager__select{box-sizing:border-box;height:28px;max-width:100px;border:1px solid #D1D5DB;border-radius:4px;padding:0 22px 0 7px;background:#FFF;color:#111;font:12px Arial,sans-serif;cursor:pointer}'
        ].join('');
        (document.head || document.body || document.documentElement).appendChild(style);
    }

    function createLanePagerChevron(direction) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 20 20');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', direction < 0 ? 'M12.5 4.5 7 10l5.5 5.5' : 'M7.5 4.5 13 10l-5.5 5.5');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('stroke-width', '2.25');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(path);
        return svg;
    }

    function stopDomPropagation(evt) { // NEW: native selects must keep their default opening behavior
        if (evt && evt.stopPropagation) evt.stopPropagation();
    }

    function createLanePagerNode(host, lane, laneKey) {
        const element = document.createElement('div');
        element.className = 'trellis-task-lane-pager';
        element.setAttribute('data-lane-id', taskCellId(lane)); // NEW: stable key supports retained-node inspection and diagnostics
        element.setAttribute('data-lane-key', String(laneKey || ''));
        const previous = document.createElement('button');
        previous.type = 'button';
        previous.className = 'trellis-task-lane-pager__button trellis-task-lane-pager__previous';
        applyTaskButtonStyle(previous, 'neutral', { compact: true });
        previous.setAttribute('aria-label', 'Previous page'); // CHANGE: accessible name remains without a browser title tooltip
        previous.appendChild(createLanePagerChevron(-1));
        const selector = document.createElement('select');
        selector.className = 'trellis-task-lane-pager__select';
        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'trellis-task-lane-pager__button trellis-task-lane-pager__next';
        applyTaskButtonStyle(next, 'neutral', { compact: true });
        next.setAttribute('aria-label', 'Next page'); // CHANGE: accessible name remains without a browser title tooltip
        next.appendChild(createLanePagerChevron(1));
        [previous, selector, next].forEach(control => {
            control.addEventListener('mousedown', stopDomPropagation);
            control.addEventListener('mouseup', stopDomPropagation);
        });
        previous.addEventListener('click', function (evt) { consumeDomEvent(evt); changeLanePage(lane, laneKey, -1); });
        next.addEventListener('click', function (evt) { consumeDomEvent(evt); changeLanePage(lane, laneKey, 1); });
        selector.addEventListener('change', function (evt) { stopDomPropagation(evt); navigateLaneToPage(lane, laneKey, Number(selector.value)); });
        element.appendChild(previous);
        element.appendChild(selector);
        element.appendChild(next);
        host.appendChild(element);
        registerTaskOverlayGestureElement(element);
        return { element, previous, selector, next, lane, laneKey, pageCount: 0 };
    }

    function updateLanePagerOptions(node, state) {
        if (node.pageCount !== state.plan.pages.length) {
            node.selector.innerHTML = '';
            state.plan.pages.forEach((_page, index) => {
                const option = document.createElement('option');
                option.value = String(index);
                option.textContent = String(index + 1); // CHANGE: dropdown choices show only page numbers
                node.selector.appendChild(option);
            });
            node.pageCount = state.plan.pages.length;
        }
        node.selector.value = String(state.pageIndex);
        node.selector.setAttribute('aria-label', `${getAttr(state.lane, 'status') || 'Lane'} page, ${state.pageIndex + 1} of ${state.plan.pages.length}`);
        node.previous.disabled = state.pageIndex <= 0;
        node.next.disabled = state.pageIndex >= state.plan.pages.length - 1;
    }

    function positionLanePager(node, state, host) {
        const bounds = getCellVisualBounds(state.lane, host);
        const geo = state.lane && (state.lane.getGeometry ? state.lane.getGeometry() : state.lane.geometry);
        if (!bounds || !geo || bounds.width <= 0 || bounds.height <= 0) return false;
        const effectiveScale = Math.min(bounds.width / Math.max(1, Number(geo.width) || bounds.width), bounds.height / Math.max(1, Number(geo.height) || bounds.height));
        const measured = node.element.getBoundingClientRect ? node.element.getBoundingClientRect() : null;
        const pagerWidth = Math.max(1, Math.round(Number(node.element.offsetWidth) || (measured && measured.width) || 168));
        const pagerHeight = Math.max(1, Math.round(Number(node.element.offsetHeight) || (measured && measured.height) || 28));
        const fitScale = Math.max(0.001, Math.min(1, Math.max(0, (bounds.width - 8) / pagerWidth), Math.max(0, (bounds.height - 4) / pagerHeight))); // CHANGE: low zoom scales the retained controls instead of hiding them
        const scaledWidth = pagerWidth * fitScale;
        const scaledHeight = pagerHeight * fitScale;
        const minLeft = bounds.x + (scaledWidth / 2) + 2;
        const maxLeft = bounds.x + bounds.width - (scaledWidth / 2) - 2;
        const idealLeft = bounds.x + (bounds.width / 2);
        const minTop = bounds.y + 2;
        const maxTop = bounds.y + bounds.height - scaledHeight - 2;
        const idealTop = bounds.y + (TASK_LANE_HEADER_HEIGHT * effectiveScale) + 4;
        node.element.style.left = Math.round(maxLeft >= minLeft ? Math.max(minLeft, Math.min(maxLeft, idealLeft)) : idealLeft) + 'px';
        node.element.style.top = Math.round(maxTop >= minTop ? Math.max(minTop, Math.min(maxTop, idealTop)) : bounds.y + 2) + 'px';
        node.element.style.transformOrigin = 'top center';
        node.element.style.transform = 'translateX(-50%) scale(' + fitScale.toFixed(3) + ')';
        return true;
    }

    function installLanePagerOverlay() {
        if (graph.__trellisTaskLanePagerInstalled || !document || !document.createElement) return;
        graph.__trellisTaskLanePagerInstalled = true;
        installLanePagerStyles();
        const host = ensureTaskControlOverlayHost();
        if (!host) return;
        const nodes = new Map(); // NEW: keyed nodes retain focus and identity across refreshes

        function removeObsoleteNodes() {
            nodes.forEach((node, laneId) => {
                const state = lanePagingStates.get(laneId);
                const modelLane = model.getCell ? model.getCell(laneId) : (state && state.lane);
                if (state && state.plan.paged && modelLane) return;
                unregisterTaskOverlayGestureElement(node.element);
                if (node.element.parentNode) node.element.parentNode.removeChild(node.element);
                nodes.delete(laneId);
                if (!modelLane) lanePagingStates.delete(laneId);
            });
        }

        function refresh() {
            removeObsoleteNodes();
            const board = selectedTaskBoard();
            nodes.forEach(node => { node.element.style.display = 'none'; });
            if (!board || taskOverlayGestureActive) return;
            lanePagingStates.forEach((state, laneId) => {
                if (!state || state.board !== board || !state.plan.paged || isWeekDayLane(state.laneKey)) return;
                if (!isCellModelVisible(state.lane) || (graph.isCellCollapsed && graph.isCellCollapsed(state.lane))) return;
                let node = nodes.get(laneId);
                if (!node) { node = createLanePagerNode(host, state.lane, state.laneKey); nodes.set(laneId, node); }
                updateLanePagerOptions(node, state);
                node.element.style.display = positionLanePager(node, state, host) ? 'flex' : 'none';
            });
        }

        requestLanePagerOverlayRefresh = createDeferredTaskOverlayRefresh(refresh);
        const selectionModel = graph.getSelectionModel && graph.getSelectionModel();
        if (selectionModel && selectionModel.addListener) selectionModel.addListener(mxEvent.CHANGE, function () { revealExternallySelectedPage(); requestLanePagerOverlayRefresh(); });
        addGraphViewRefreshListener(requestLanePagerOverlayRefresh);
        requestLanePagerOverlayRefresh();
    }

    function roleInitials(name) {
        const words = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!words.length || String(name) === 'Deleted role') return '?';
        return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0]).toUpperCase();
    }

    function roleShortDisplayName(name) {
        const trimmed = String(name || '').trim();
        if (!trimmed || trimmed === 'Deleted role') return trimmed || 'Unnamed person';
        const words = trimmed.split(/\s+/).filter(Boolean);
        if (words.length === 1) return words[0];
        return words[0] + ' ' + words[words.length - 1][0].toUpperCase() + '.';
    }

    function roleAvatarColor(id) { // NEW: stable initials color without persisted presentation data
        const palette = ['#2563EB', '#7C3AED', '#DB2777', '#059669', '#D97706', '#4F46E5'];
        let hash = 0;
        for (const ch of String(id || '')) hash = ((hash * 31) + ch.charCodeAt(0)) | 0;
        return palette[Math.abs(hash) % palette.length];
    }

    function consumeDomEvent(evt) {
        if (evt && evt.stopPropagation) evt.stopPropagation();
        if (mxEvent && mxEvent.consume) mxEvent.consume(evt);
    }

    function makeRoleAvatarNode(profile, size, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'trellis-task-assignee-avatar';
        button.setAttribute('aria-label', 'Go to ' + profile.name + ' — ' + profile.roleTitle);
        button.title = profile.name + ' — ' + profile.roleTitle + (profile.eligible ? '' : ' (unavailable)');
        button.style.cssText = 'box-sizing:border-box;width:' + size + 'px;height:' + size + 'px;min-width:' + size + 'px;border-radius:50%;border:' + (profile.eligible ? '1px solid #fff' : '2px solid #D97706') + ';padding:0;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;color:#fff;font:bold ' + Math.max(8, Math.round(size * 0.45)) + 'px Arial,sans-serif;line-height:1;background:' + roleAvatarColor(profile.id) + ';cursor:' + (profile.cell ? 'pointer' : 'default') + ';';
        button.textContent = roleInitials(profile.name);
        if (profile.imageSource) {
            const image = document.createElement('img');
            image.alt = '';
            image.src = profile.imageSource;
            image.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
            image.addEventListener('error', function () { if (image.parentNode) image.parentNode.removeChild(image); });
            button.appendChild(image);
        }
        button.addEventListener('mousedown', consumeDomEvent);
        button.addEventListener('mouseup', consumeDomEvent);
        button.addEventListener('click', function (evt) { consumeDomEvent(evt); if (profile.cell && onClick) onClick(profile); });
        return button;
    }

    function makeRoleAssigneePillNode(profile, onClick) {
        const row = document.createElement('div');
        row.className = 'trellis-task-assignee-pill';
        row.title = profile.name + ' - ' + profile.roleTitle + (profile.eligible ? '' : ' (unavailable)');
        row.style.cssText = 'box-sizing:border-box;width:100%;max-width:126px;height:22px;border:1px solid #D1D5DB;border-radius:11px;padding:2px 7px 2px 2px;background:#fff;color:#111;display:flex;align-items:center;gap:5px;font:11px Arial,sans-serif;line-height:1;overflow:hidden;';
        row.appendChild(makeRoleAvatarNode(profile, 16, onClick));
        const label = document.createElement('span');
        label.className = 'trellis-task-assignee-pill-label';
        label.textContent = roleShortDisplayName(profile.name);
        label.style.cssText = 'display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:' + (profile.cell ? 'pointer' : 'default') + ';';
        label.addEventListener('mousedown', consumeDomEvent);
        label.addEventListener('mouseup', consumeDomEvent);
        label.addEventListener('click', function (evt) { consumeDomEvent(evt); if (profile.cell && onClick) onClick(profile); });
        row.appendChild(label);
        return row;
    }

    function navigateToRoleProfile(profile) {
        const roleCard = profile && profile.cell;
        if (!roleCard || !model.getCell(profile.id)) return;
        model.beginUpdate();
        try {
            let current = roleCard;
            while (current) {
                const parent = model.getParent(current);
                if (parent && model.isVisible && !model.isVisible(parent) && model.setVisible) model.setVisible(parent, true);
                if (parent && graph.isCellCollapsed && graph.isCellCollapsed(parent) && graph.foldCells) graph.foldCells(false, false, [parent]);
                current = parent;
            }
        } finally { model.endUpdate(); }
        if (graph.setSelectionCell) graph.setSelectionCell(roleCard);
        if (graph.scrollCellToVisible) graph.scrollCellToVisible(roleCard, true);
    }

    let assigneeNamesPopover = null;
    function closeAssigneeNamesPopover() {
        if (assigneeNamesPopover && assigneeNamesPopover.parentNode) assigneeNamesPopover.parentNode.removeChild(assigneeNamesPopover);
        assigneeNamesPopover = null;
    }

    function showAssigneeNamesPopover(anchor, profiles) {
        closeAssigneeNamesPopover();
        const host = ensureTaskControlOverlayHost();
        if (!host) return;
        const popover = document.createElement('div');
        popover.className = 'trellis-task-assignee-names-popover';
        popover.setAttribute('role', 'dialog');
        popover.setAttribute('aria-label', 'Assigned people');
        popover.style.cssText = 'position:absolute;min-width:220px;max-width:320px;max-height:260px;overflow:auto;background:#fff;border:1px solid #111;border-radius:4px;padding:5px;box-shadow:0 3px 12px rgba(0,0,0,.22);pointer-events:auto;font:12px Arial,sans-serif;z-index:' + GRAPH_OVERLAY_Z.CONTROL_TOP + ';';
        profiles.forEach(profile => {
            const row = document.createElement('div');
            row.style.cssText = 'width:100%;display:flex;gap:7px;align-items:center;border:0;background:transparent;text-align:left;padding:4px;cursor:' + (profile.cell ? 'pointer' : 'default') + ';';
            row.appendChild(makeRoleAvatarNode(profile, 24, function (target) { closeAssigneeNamesPopover(); navigateToRoleProfile(target); }));
            const text = document.createElement('button');
            text.type = 'button';
            text.disabled = !profile.cell;
            text.textContent = profile.name + ' — ' + profile.roleTitle + (profile.eligible ? '' : ' (unavailable)');
            text.style.cssText = 'flex:1;border:0;background:transparent;padding:0;text-align:left;font:12px Arial,sans-serif;cursor:' + (profile.cell ? 'pointer' : 'default') + ';';
            text.addEventListener('click', function (evt) { consumeDomEvent(evt); if (profile.cell) { closeAssigneeNamesPopover(); navigateToRoleProfile(profile); } });
            row.appendChild(text);
            popover.appendChild(row);
        });
        host.appendChild(popover);
        const hostRect = host.parentNode && host.parentNode.getBoundingClientRect ? host.parentNode.getBoundingClientRect() : { left: 0, top: 0 };
        const anchorRect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 0, bottom: 0 };
        popover.style.left = Math.max(0, Math.round(anchorRect.left - hostRect.left)) + 'px';
        popover.style.top = Math.max(0, Math.round(anchorRect.bottom - hostRect.top + 4)) + 'px';
        assigneeNamesPopover = popover;
    }

    function installWeekAssigneeBadgeLayer() {
        if (graph.__trellisTaskAssigneeBadgesInstalled || !document || !document.createElement) return;
        graph.__trellisTaskAssigneeBadgesInstalled = true;
        const host = ensureTaskControlOverlayHost();
        if (!host) return;
        let expandedAssigneeCardId = ''; // NEW: sticky expanded assignee grid follows the exact rendered card id
        const layer = document.createElement('div');
        layer.className = 'trellis-task-assignee-badge-layer';
        layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:' + GRAPH_OVERLAY_Z.CONTROL + ';';
        host.appendChild(layer);
        registerTaskOverlayGestureElement(layer);

        function collapseExpandedAssigneeCard(requestRefresh) {
            expandedAssigneeCardId = '';
            if (requestRefresh) requestRefresh();
        }

        function appendAssigneeCollapsePill(stack, requestRefresh) {
            const collapse = document.createElement('button');
            collapse.type = 'button';
            collapse.className = 'trellis-task-assignee-collapse';
            collapse.textContent = '-';
            collapse.setAttribute('aria-label', 'Collapse assignees');
            collapse.style.cssText = 'box-sizing:border-box;width:22px;height:18px;border:1px solid #6B7280;border-radius:9px;padding:0;background:#fff;color:#111;font:bold 12px Arial,sans-serif;line-height:16px;cursor:pointer;';
            collapse.addEventListener('mousedown', consumeDomEvent);
            collapse.addEventListener('click', function (evt) { consumeDomEvent(evt); collapseExpandedAssigneeCard(requestRefresh); });
            stack.appendChild(collapse);
        }

        function renderCardBadge(card, board) {
            const profiles = resolveCardAssigneeProfiles(card, board);
            const cardId = String(card && card.id || '');
            if (!profiles.length || !cardId) { if (expandedAssigneeCardId === cardId) expandedAssigneeCardId = ''; return; }
            const state = graph.view && graph.view.getState ? graph.view.getState(card) : null;
            const bounds = getStateHostBounds(card, state, host);
            if (!bounds || bounds.width <= 0 || bounds.height <= 0) { if (expandedAssigneeCardId === cardId) expandedAssigneeCardId = ''; return; }
            const expanded = expandedAssigneeCardId === cardId;
            const stack = document.createElement('div');
            stack.className = expanded ? 'trellis-task-assignee-stack trellis-task-assignee-stack-expanded' : 'trellis-task-assignee-stack';
            stack.title = profiles.map(profile => profile.name + ' — ' + profile.roleTitle + (profile.eligible ? '' : ' (unavailable)')).join('\n');
            stack.style.cssText = expanded ? 'position:absolute;display:flex;flex-direction:column;gap:3px;align-items:flex-end;pointer-events:auto;left:' + Math.round(bounds.x + bounds.width - 4) + 'px;top:' + Math.round(bounds.y + 2) + 'px;transform:translateX(-100%);box-sizing:border-box;padding:3px;background:#fff;border:1px solid #6B7280;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.18);z-index:' + GRAPH_OVERLAY_Z.CONTROL_TOP + ';' : 'position:absolute;display:flex;align-items:center;pointer-events:auto;left:' + Math.round(bounds.x + bounds.width - 4) + 'px;top:' + Math.round(bounds.y + 2) + 'px;transform:translateX(-100%);';
            profiles.slice(0, expanded ? profiles.length : 3).forEach((profile, index) => {
                const avatar = expanded ? makeRoleAssigneePillNode(profile, navigateToRoleProfile) : makeRoleAvatarNode(profile, 16, navigateToRoleProfile);
                if (!expanded && index) avatar.style.marginLeft = '-4px';
                stack.appendChild(avatar);
            });
            if (expanded) appendAssigneeCollapsePill(stack, requestRefresh);
            if (!expanded && profiles.length > 3) {
                const more = document.createElement('button');
                more.type = 'button';
                more.className = 'trellis-task-assignee-overflow';
                more.textContent = '+' + (profiles.length - 3);
                more.setAttribute('aria-label', 'Show all ' + profiles.length + ' assigned people');
                more.style.cssText = 'box-sizing:border-box;height:16px;min-width:20px;margin-left:2px;border:1px solid #6B7280;border-radius:8px;padding:0 3px;background:#fff;color:#111;font:bold 9px Arial,sans-serif;line-height:14px;cursor:pointer;';
                more.addEventListener('mousedown', consumeDomEvent);
                more.addEventListener('click', function (evt) { consumeDomEvent(evt); expandedAssigneeCardId = cardId; requestRefresh(); });
                stack.appendChild(more);
            }
            layer.appendChild(stack);
        }

        function refresh() {
            const expectedExpandedCardId = expandedAssigneeCardId;
            let renderedExpandedCard = false;
            layer.innerHTML = '';
            if (taskOverlayGestureActive) { layer.style.display = 'none'; return; }
            layer.style.display = 'block';
            (function walk(cell) {
                if (!cell) return;
                if (isBoardCell(cell) && getBoardViewMode(cell) === 'WEEK') {
                    collectBoardCards(cell).forEach(entry => {
                        if (!isScheduleBreakCard(entry.card) && getTaskAssigneeRoleIds(entry.card).length) {
                            renderCardBadge(entry.card, cell);
                            renderedExpandedCard = renderedExpandedCard || (!!expectedExpandedCardId && String(entry.card && entry.card.id || '') === expectedExpandedCardId);
                        }
                    });
                    return;
                }
                const count = model.getChildCount(cell);
                for (let i = 0; i < count; i++) walk(model.getChildAt(cell, i));
            })(model.getRoot());
            if (expectedExpandedCardId && !renderedExpandedCard) expandedAssigneeCardId = '';
        }

        const requestRefresh = createDeferredTaskOverlayRefresh(refresh);
        addGraphViewRefreshListener(requestRefresh);
        graph.addListener('linksChanged', requestRefresh);
        window.addEventListener('trellisHistoryAfterRestore', requestRefresh);
        document.addEventListener('keydown', function (evt) { if (expandedAssigneeCardId && (evt.key === 'Escape' || evt.keyCode === 27)) { consumeDomEvent(evt); collapseExpandedAssigneeCard(requestRefresh); } });
        requestRefresh();
    }

    function installBoardHeaderControls() {
        if (graph.__trellisTaskBoardHeaderInstalled || !document || !document.createElement) return;
        graph.__trellisTaskBoardHeaderInstalled = true;
        const host = ensureTaskControlOverlayHost();
        if (!host) return;
        const bar = document.createElement('div');
        bar.className = 'trellis-task-board-header-controls';
        bar.style.cssText = 'position:absolute;display:none;flex-direction:column;gap:4px;align-items:flex-start;background:#fff;border:1px solid #111;padding:4px;font:12px Arial,sans-serif;pointer-events:auto;';
        bar.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL);
        host.appendChild(bar);
        registerTaskOverlayGestureElement(bar);
        const modeLabel = document.createElement('div');
        modeLabel.style.cssText = 'font:12px Arial,sans-serif;font-weight:700;line-height:1.2;color:#111;';
        bar.appendChild(modeLabel);
        const dateInput = document.createElement('input');
        dateInput.type = 'date';
        dateInput.style.cssText = 'font:12px Arial,sans-serif;width:132px;';
        bar.appendChild(dateInput);
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:4px;align-items:center;white-space:nowrap;';
        bar.appendChild(row);
        const columnsPanel = document.createElement('div');
        columnsPanel.className = 'trellis-task-board-column-panel';
        columnsPanel.style.cssText = 'display:none;padding-top:2px;overflow:visible;';
        bar.appendChild(columnsPanel);
        const laneToggleRow = document.createElement('div');
        laneToggleRow.className = 'trellis-task-board-lane-toggles';
        laneToggleRow.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:nowrap;white-space:nowrap;';
        columnsPanel.appendChild(laneToggleRow);
        let columnsExpanded = false;
        let columnsContextKey = null;

        function button(label, fn, variant) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = label;
            btn.style.cssText = 'font:12px Arial,sans-serif;padding:3px 6px;';
            applyTaskButtonStyle(btn, variant || 'neutral', { compact: true });
            mxEvent.addListener(btn, 'mousedown', evt => mxEvent.consume(evt));
            mxEvent.addListener(btn, 'click', function (evt) { mxEvent.consume(evt); fn(); requestRefresh(); });
            row.appendChild(btn);
            return btn;
        }

        function selectedBoard() {
            const cells = getSelectionCellsList();
            for (const cell of cells) {
                if (isBoardCell(cell)) return cell;
                const board = findBoardAncestor(cell);
                if (board) return board;
            }
            return null;
        }

        function selectionCellStillVisibleInBoard(board, cell) {
            if (!board || !cell) return false;
            if (cell === board) return true;
            let cur = cell;
            while (cur && cur !== board) {
                if (model.isVisible && model.isVisible(cur) === false) return false;
                cur = model.getParent(cur);
            }
            return cur === board;
        }

        function restoreBoardSelectionIfNeeded(board) {
            if (!board || !graph.setSelectionCell) return;
            const stillVisible = getSelectionCellsList().some(cell => selectionCellStillVisibleInBoard(board, cell));
            if (!stillVisible) graph.setSelectionCell(board);
        }

        function toggleBoardPlanningView() {
            const b = selectedBoard();
            if (!b) return;
            taskCommands.setBoardPlanningView(b, getBoardViewMode(b) === 'WEEK' ? 'FULL' : 'WEEK');
            restoreBoardSelectionIfNeeded(b);
        }

        function renderLaneVisibilityControls(board, mode) {
            laneToggleRow.innerHTML = '';
            const visibleKeys = getBoardVisibleLaneKeys(board, mode);
            const visibleSet = new Set(visibleKeys);
            const laneDefs = LANES.filter(lane => taskPolicy.getTaskViewLaneKeys(mode).indexOf(lane.key) >= 0);
            laneDefs.forEach(lane => {
                const label = document.createElement('label');
                label.className = 'trellis-task-board-lane-toggle';
                label.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font:11px Arial,sans-serif;line-height:14px;white-space:nowrap;';
                label.setAttribute('data-lane-key', lane.key);
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = visibleSet.has(lane.key);
                input.disabled = input.checked && visibleKeys.length <= 1;
                input.style.cssText = 'margin:0;';
                input.addEventListener('mousedown', stopDomPropagation);
                input.addEventListener('mouseup', stopDomPropagation);
                input.addEventListener('click', stopDomPropagation);
                input.addEventListener('change', function (evt) {
                    stopDomPropagation(evt);
                    const b = selectedBoard();
                    if (!b) return;
                    const changed = setBoardLaneVisible(b, lane.key, input.checked);
                    if (!changed) input.checked = true;
                    restoreBoardSelectionIfNeeded(b);
                    requestRefresh();
                });
                const text = document.createElement('span');
                text.textContent = lane.label;
                label.appendChild(input);
                label.appendChild(text);
                laneToggleRow.appendChild(label);
            });
        }

        const modeToggle = button('Switch to Week view', toggleBoardPlanningView);
        const columnsToggle = button('Hide/Show columns', () => { columnsExpanded = !columnsExpanded; });
        const prev = button('<', () => { const b = selectedBoard(); if (!b) return; const mode = getBoardViewMode(b); if (mode === 'WEEK') taskCommands.setBoardPlanningView(b, null, { [TASK_SELECTED_WEEK_START_ATTR]: shiftTaskCalendarISO(getSelectedWeekStart(b), -7), [TASK_SELECTED_DAY_ATTR]: shiftTaskCalendarISO(getSelectedWeekStart(b), -7) }); });
        const next = button('>', () => { const b = selectedBoard(); if (!b) return; const mode = getBoardViewMode(b); if (mode === 'WEEK') taskCommands.setBoardPlanningView(b, null, { [TASK_SELECTED_WEEK_START_ATTR]: shiftTaskCalendarISO(getSelectedWeekStart(b), 7), [TASK_SELECTED_DAY_ATTR]: shiftTaskCalendarISO(getSelectedWeekStart(b), 7) }); });
        const todayBtn = button('Today', () => { const b = selectedBoard(); if (!b) return; const today = todayISO(); taskCommands.setBoardPlanningView(b, null, { [TASK_SELECTED_WEEK_START_ATTR]: getTaskWeekStartISO(today), [TASK_SELECTED_DAY_ATTR]: today }); });
        const endDayBtn = button('End Day', () => { const b = selectedBoard(); if (b) taskCommands.endDay(b); });
        const endWeekBtn = button('End Week', () => { const b = selectedBoard(); if (b) taskCommands.endWeek(b); });
        const editHoursBtn = button('Edit Hours', () => { const b = selectedBoard(); if (b) taskDialogs.showEditHoursDialog(b); }, 'open');
        const addBreakBtn = button('Add Break', () => { const b = selectedBoard(); if (b) taskCommands.addBreakToSelectedDay(b); }, 'add');
        dateInput.addEventListener('mousedown', evt => evt.stopPropagation());
        dateInput.addEventListener('click', evt => evt.stopPropagation());
        mxEvent.addListener(dateInput, 'change', function (evt) {
            mxEvent.consume(evt);
            const b = selectedBoard();
            if (!b) return;
            const value = String(dateInput.value || '').trim();
            if (!value) { taskCommands.setBoardPlanningView(b, 'FULL'); requestRefresh(); return; }
            const weekStart = getTaskWeekStartISO(value);
            if (!weekStart) return;
            const mode = getBoardViewMode(b);
            taskCommands.setBoardPlanningView(b, 'WEEK', { [TASK_SELECTED_WEEK_START_ATTR]: weekStart, [TASK_SELECTED_DAY_ATTR]: value });
            requestRefresh();
        });

        function refresh() {
            const board = selectedBoard();
            if (!board) { bar.style.display = 'none'; columnsExpanded = false; columnsContextKey = null; return; }
            ensureBoardPlanningDefaults(board);
            const mode = getBoardViewMode(board);
            const nextColumnsContextKey = taskCellId(board) + ':' + mode;
            if (columnsContextKey !== nextColumnsContextKey) { columnsExpanded = false; columnsContextKey = nextColumnsContextKey; }
            bar.style.display = 'flex';
            dateInput.value = mode === 'FULL' ? '' : getSelectedDay(board);
            modeLabel.textContent = mode === 'WEEK' ? 'Mode: Week' : 'Mode: Full';
            modeToggle.textContent = mode === 'WEEK' ? 'Switch to Full view' : 'Switch to Week view';
            modeToggle.setAttribute('aria-pressed', mode === 'WEEK' ? 'true' : 'false');
            columnsToggle.setAttribute('aria-expanded', columnsExpanded ? 'true' : 'false');
            columnsPanel.style.display = columnsExpanded ? 'block' : 'none';
            prev.style.display = mode === 'WEEK' ? '' : 'none';
            next.style.display = mode === 'WEEK' ? '' : 'none';
            todayBtn.textContent = mode === 'WEEK' ? 'This Week' : 'Today';
            todayBtn.style.display = mode === 'WEEK' ? '' : 'none';
            renderLaneVisibilityControls(board, mode);
            endDayBtn.textContent = 'End Day (' + countEndDayCards(board) + ')';
            endWeekBtn.textContent = 'End Week (' + countEndWeekCards(board) + ')';
            const selectedScheduleLane = mode === 'WEEK' ? selectedScheduleLaneForBoard(board) : null;
            const selectedScheduleLaneKey = selectedScheduleLane ? getAttr(selectedScheduleLane, 'lane_key') : null;
            const selectedScheduleDayWindow = selectedScheduleLaneKey ? getBoardWeekWorkHours(board)[getWeekDayIndexForLaneKey(selectedScheduleLaneKey)] : null;
            const hasSelectedScheduleLane = !!selectedScheduleLane;
            const selectedScheduleDayOpen = hasSelectedScheduleLane && !(selectedScheduleDayWindow && selectedScheduleDayWindow.closed);
            endDayBtn.style.display = hasSelectedScheduleLane ? '' : 'none';
            endWeekBtn.style.display = mode === 'WEEK' ? '' : 'none';
            editHoursBtn.style.display = hasSelectedScheduleLane ? '' : 'none';
            addBreakBtn.style.display = selectedScheduleDayOpen ? '' : 'none';
            if (!positionDomOverlayFromCellState(bar, board, false, true, 0, TASK_BOARD_HEADER_OVERLAY_EXTRA_X)) bar.style.display = 'none';
        }

        const requestRefresh = createDeferredTaskOverlayRefresh(refresh);
        graph.getSelectionModel().addListener(mxEvent.CHANGE, requestRefresh);
        addGraphViewRefreshListener(requestRefresh);
        requestRefresh();
    }

    function installWeekTimeScaleOverlay() {
        if (graph.__trellisTaskWeekTimeScaleInstalled || !document || !document.createElement) return;
        graph.__trellisTaskWeekTimeScaleInstalled = true;
        const host = ensureTaskControlOverlayHost();
        if (!host) return;
        const overlay = document.createElement('div');
        overlay.className = 'trellis-task-week-time-scale';
        overlay.style.cssText = 'position:absolute;display:none;pointer-events:none;font:11px Arial,sans-serif;color:#4B5563;z-index:' + GRAPH_OVERLAY_Z.ANNOTATION + ';';
        host.appendChild(overlay);
        let lastActiveBoard = null;

        function selectedBoard() {
            const cells = getSelectionCellsList();
            for (const cell of cells) {
                if (isBoardCell(cell)) return cell;
                const board = findBoardAncestor(cell);
                if (board) return board;
            }
            return null;
        }

        function resolveActiveBoard() {
            const board = selectedBoard();
            if (board) lastActiveBoard = board;
            return lastActiveBoard;
        }

        function isRenderableActiveBoard(board) {
            if (!board || !isBoardCell(board)) return false;
            if (model.getParent && !model.getParent(board)) return false;
            if (model.isVisible && model.isVisible(board) === false) return false;
            if (graph.isCellVisible && graph.isCellVisible(board) === false) return false;
            if (graph.isCellCollapsed && graph.isCellCollapsed(board)) return false; // CHANGE: hide week hours overlay while the task board is collapsed
            return true;
        }

        function clearOverlay() {
            overlay.style.display = 'none';
            overlay.innerHTML = '';
        }

        function addHourMark(fragment, labelWidth, gridLeft, gridWidth, y, minute, isBoundary) {
            const line = document.createElement('div');
            line.className = 'trellis-task-week-time-grid-line';
            line.style.cssText = 'position:absolute;left:' + Math.round(gridLeft) + 'px;top:' + Math.round(y) + 'px;width:' + Math.round(gridWidth) + 'px;border-top:1px solid ' + (isBoundary ? '#CBD5E1' : '#E5E7EB') + ';height:0;';
            fragment.appendChild(line);
            const label = document.createElement('div');
            label.className = 'trellis-task-week-time-label';
            label.textContent = formatScheduleClockMinute(minute);
            label.style.cssText = 'position:absolute;left:0;top:' + Math.max(0, Math.round(y - 7)) + 'px;width:' + Math.round(labelWidth) + 'px;text-align:right;white-space:nowrap;';
            fragment.appendChild(label);
        }

        function refresh() {
            const board = resolveActiveBoard();
            if (!isRenderableActiveBoard(board) || getBoardViewMode(board) !== 'WEEK') { clearOverlay(); return; }
            ensureBoardPlanningDefaults(board);
            const lanes = boardLanes(board);
            const visibleDayKeys = getBoardVisibleLaneKeys(board, 'WEEK').filter(laneKey => isWeekDayLane(laneKey) && lanes[laneKey]);
            const firstLane = visibleDayKeys.length ? lanes[visibleDayKeys[0]] : null;
            const lastLane = visibleDayKeys.length ? lanes[visibleDayKeys[visibleDayKeys.length - 1]] : null;
            if (!firstLane || !lastLane) { clearOverlay(); return; }
            const timeScale = schedulePolicy.buildWeekTimeScale(getBoardWeekWorkHours(board));
            if (!timeScale.active) { clearOverlay(); return; }
            const boardBounds = getCellVisualBounds(board, host);
            const viewScale = graph.view && Number(graph.view.scale) > 0 ? Number(graph.view.scale) : 1;
            const firstGeo = model.getGeometry(firstLane);
            const lastGeo = model.getGeometry(lastLane);
            if (!boardBounds || !firstGeo || !lastGeo) { clearOverlay(); return; }
            const labelWidth = WEEK_TIME_RULER_WIDTH * viewScale;
            const scaledGap = LANE_GAP * viewScale;
            const gridLeft = labelWidth + scaledGap;
            const gridWidth = Math.max(0, ((Number(lastGeo.x) || 0) + (Number(lastGeo.width) || 0) - (Number(firstGeo.x) || 0)) * viewScale);
            const gridHeight = schedulePolicy.scheduleMinuteOffsetToPx(timeScale.durationMinutes) * viewScale;
            const overlayLeft = boardBounds.x + ((Number(firstGeo.x) || 0) * viewScale) - labelWidth - scaledGap;
            const overlayTop = boardBounds.y + ((BOARD_LANE_Y + WEEK_BOARD_TOP_MARGIN) * viewScale);
            overlay.style.left = Math.round(overlayLeft) + 'px';
            overlay.style.top = Math.round(overlayTop) + 'px';
            overlay.style.width = Math.round(labelWidth + scaledGap + gridWidth) + 'px';
            overlay.style.height = Math.round(gridHeight + 16) + 'px';
            overlay.style.display = 'block';
            overlay.innerHTML = '';
            const fragment = document.createDocumentFragment();
            timeScale.hourMarks.forEach((minute, index) => {
                const y = schedulePolicy.scheduleMinuteOffsetToPx(minute - timeScale.startMinute) * viewScale;
                addHourMark(fragment, labelWidth, gridLeft, gridWidth, y, minute, index === 0 || index === timeScale.hourMarks.length - 1);
            });
            overlay.appendChild(fragment);
        }

        const requestRefresh = createDeferredTaskOverlayRefresh(refresh);
        graph.getSelectionModel().addListener(mxEvent.CHANGE, requestRefresh);
        addGraphViewRefreshListener(requestRefresh);
        requestRefresh();
    }

    function showBulkEditCardsDialogImpl(cards) {
        const selected = uniqueKanbanCards(cards);
        if (!selected.length) return;
        if (selected.length === 1) { taskDialogs.showEditCardDialog(selected[0]); return; }
        const dateEditable = selected.filter(canEditCardDates);
        const firstRange = dateEditable.length ? getTaskDateRange(dateEditable[0].value) : null;
        const div = document.createElement('div');
        div.style.padding = '12px';
        div.style.boxSizing = 'border-box';
        div.style.fontFamily = 'Arial, sans-serif';
        const heading = document.createElement('div');
        heading.textContent = 'Edit ' + selected.length + ' Cards';
        heading.style.fontSize = '16px';
        heading.style.fontWeight = 'bold';
        heading.style.marginBottom = '10px';
        div.appendChild(heading);

        function addToggleRow(toggle, labelText, input) {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '8px';
            row.style.marginBottom = '10px';
            const label = document.createElement('label');
            label.style.width = '115px';
            label.style.flex = '0 0 115px';
            label.appendChild(toggle);
            label.appendChild(document.createTextNode(' ' + labelText));
            input.style.flex = '1';
            row.appendChild(label);
            row.appendChild(input);
            div.appendChild(row);
        }

        const noteCheck = document.createElement('input');
        noteCheck.type = 'checkbox';
        const noteInput = document.createElement('input');
        noteInput.type = 'text';
        noteInput.placeholder = 'Replace notes on selected cards';
        addToggleRow(noteCheck, 'Replace notes', noteInput);
        const noteFeedback = document.createElement('div');
        noteFeedback.style.margin = '-6px 0 10px 123px';
        noteFeedback.style.fontSize = '12px';
        div.appendChild(noteFeedback);

        const dateCheck = document.createElement('input');
        dateCheck.type = 'checkbox';
        const startInput = document.createElement('input');
        startInput.type = 'date';
        startInput.disabled = !dateEditable.length;
        startInput.value = firstRange ? firstRange.startISO : '';
        addToggleRow(dateCheck, 'Set start date', startInput);
        dateCheck.disabled = !dateEditable.length;

        const error = document.createElement('div');
        error.style.color = '#b91c1c';
        error.style.minHeight = '18px';
        error.style.fontSize = '12px';
        error.style.marginBottom = '8px';
        div.appendChild(error);

        function updateNoteFeedback() {
            const collapsed = String(noteInput.value || '').replace(/\s+/g, ' ').trim();
            const length = Array.from(collapsed).length;
            noteFeedback.textContent = length + '/' + CARD_NOTE_MAX_LENGTH + ' - replaces existing notes when checked';
            noteFeedback.style.color = length > CARD_NOTE_MAX_LENGTH ? '#b91c1c' : '#6b7280';
        }

        noteInput.addEventListener('input', updateNoteFeedback);
        noteInput.addEventListener('input', function () { noteCheck.checked = true; });
        startInput.addEventListener('input', function () { if (dateEditable.length) dateCheck.checked = true; });
        updateNoteFeedback();

        const buttons = document.createElement('div');
        buttons.style.display = 'flex';
        buttons.style.justifyContent = 'flex-end';
        buttons.style.gap = '8px';
        const cancelButton = mxUtils.button('Cancel', function () { ui.hideDialog(); });
        const saveButton = mxUtils.button('Save', function () {
            const replaceNote = noteCheck.checked;
            const setStartDate = dateCheck.checked;
            if (!replaceNote && !setStartDate) { ui.hideDialog(); return; }
            if (setStartDate && !parseTaskCalendarISO(startInput.value)) {
                error.style.color = '#b91c1c';
                error.textContent = 'Enter a valid start date.';
                startInput.focus();
                return;
            }
            const result = taskCommands.applyBulkCardEdit(selected, { replaceNote, note: noteInput.value, setStartDate, startDate: startInput.value });
            if (setStartDate && result.dateSkipped > 0) {
                error.style.color = '#374151';
                error.textContent = 'Saved. Skipped ' + result.dateSkipped + ' card' + (result.dateSkipped === 1 ? '' : 's') + ' not eligible for date editing.';
                return;
            }
            ui.hideDialog();
        });
        applyTaskButtonStyle(cancelButton, 'neutral');
        applyTaskButtonStyle(saveButton, 'add');
        buttons.appendChild(cancelButton);
        buttons.appendChild(saveButton);
        div.appendChild(buttons);

        mxEvent.addListener(div, 'keydown', function (evt) {
            if (evt.key === 'Enter') saveButton.click();
            if (evt.key === 'Escape') ui.hideDialog();
        });
        taskDialogs.showTaskManagerDialog(div, 460, dateEditable.length ? 260 : 230, true, true);
        noteInput.focus();
    }

    function createTaskDialogRuntime({ ui, document, commands, adapters }) { // CHANGE: dialog seam owns DOM/input flow only
        return Object.freeze({
            showEditCardDialog: showEditCardDialogImpl,
            showEditHoursDialog: showEditHoursDialogImpl,
            showEditDayHoursDialog: showEditDayHoursDialogImpl,
            showBulkEditCardsDialog: showBulkEditCardsDialogImpl,
            showTaskManagerDialog: showTaskManagerDialogImpl,
            elevateTaskManagerDialog: elevateTaskManagerDialogImpl
        });
    }

    const taskDialogs = createTaskDialogRuntime({
        ui,
        document,
        commands: taskCommands,
        adapters: taskRuntimeAdapters
    });

    function showEditCardDialog(card) { return taskDialogs.showEditCardDialog(card); }
    function showEditHoursDialog(board) { return taskDialogs.showEditHoursDialog(board); }
    function showEditDayHoursDialog(board, laneKey) { return taskDialogs.showEditDayHoursDialog(board, laneKey); }
    function showBulkEditCardsDialog(cards) { return taskDialogs.showBulkEditCardsDialog(cards); }
    function showTaskManagerDialog(node, width, height, modal, closable) { return taskDialogs.showTaskManagerDialog(node, width, height, modal, closable); }
    function elevateTaskManagerDialog() { return taskDialogs.elevateTaskManagerDialog(); }

    function installSelectedDayLaneActionOverlay() {
        if (graph.__trellisTaskDayLaneOverlayInstalled || !document || !document.createElement) return;
        graph.__trellisTaskDayLaneOverlayInstalled = true;
        const host = ensureTaskControlOverlayHost();
        if (!host) return;
        const overlay = document.createElement('div');
        overlay.className = 'trellis-task-selected-day-lane-actions';
        overlay.style.cssText = 'position:absolute;display:none;flex-direction:column;align-items:stretch;gap:4px;background:#fff;border:1px solid #111;padding:4px;font:12px Arial,sans-serif;pointer-events:auto;';
        overlay.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL);
        host.appendChild(overlay);
        registerTaskOverlayGestureElement(overlay);
        mxEvent.addListener(overlay, 'mousedown', evt => mxEvent.consume(evt));
        mxEvent.addListener(overlay, 'mouseup', evt => mxEvent.consume(evt));

        function selectedDayLaneContext() {
            const cells = getSelectionCellsList();
            if (cells.length !== 1) return null;
            const lane = cells[0];
            const laneKey = getAttr(lane, 'lane_key');
            if (!lane || !model.isVertex(lane) || !isWeekDayLane(laneKey)) return null;
            const board = findBoardAncestor(lane);
            if (!board || getBoardViewMode(board) !== 'WEEK') return null;
            const dayIndex = getWeekDayIndexForLaneKey(laneKey);
            const dayWindow = getBoardWeekWorkHours(board)[dayIndex];
            return { board, lane, laneKey, dayIndex, dayWindow: normalizeWorkHourWindow(dayWindow) };
        }

        function add(label, fn, variant) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = label;
            btn.style.cssText = 'font:12px Arial,sans-serif;padding:3px 6px;';
            applyTaskButtonStyle(btn, variant || 'neutral', { compact: true });
            mxEvent.addListener(btn, 'click', function (evt) {
                mxEvent.consume(evt);
                const ctx = selectedDayLaneContext();
                if (ctx) fn(ctx);
                requestRefresh();
            });
            overlay.appendChild(btn);
            return btn;
        }

        const changeHoursBtn = add('Change Hours', ctx => taskDialogs.showEditDayHoursDialog(ctx.board, ctx.laneKey), 'open');
        const addBreakBtn = add('Add Break', ctx => taskCommands.addBreakToSelectedDay(ctx.board), 'add');
        const openDayBtn = add('Open Day', ctx => taskCommands.openSelectedWeekDayFromDefaults(ctx.board, ctx.laneKey), 'open');
        const closeDayBtn = add('Close Day', ctx => taskCommands.closeSelectedWeekDay(ctx.board, ctx.lane), 'danger');

        function refresh() {
            const ctx = selectedDayLaneContext();
            if (!ctx) { overlay.style.display = 'none'; return; }
            ensureBoardPlanningDefaults(ctx.board);
            const hasVisibleCards = selectedWeekDayHasVisibleCards(ctx.lane);
            const isClosed = !!ctx.dayWindow.closed;
            changeHoursBtn.style.display = '';
            addBreakBtn.style.display = isClosed ? 'none' : '';
            openDayBtn.style.display = hasVisibleCards || !isClosed ? 'none' : '';
            closeDayBtn.style.display = hasVisibleCards || isClosed ? 'none' : '';
            overlay.style.display = 'flex';
            if (!positionDomOverlayFromCellState(overlay, ctx.lane, true, false, TASK_ACTION_OVERLAY_EXTRA_Y, TASK_ACTION_OVERLAY_EXTRA_X)) overlay.style.display = 'none';
        }

        const requestRefresh = createDeferredTaskOverlayRefresh(refresh);
        graph.getSelectionModel().addListener(mxEvent.CHANGE, requestRefresh);
        addGraphViewRefreshListener(requestRefresh);
        requestRefresh();
    }

    function installSelectedTaskModuleBoardOverlay() {
        if (graph.__trellisSelectedTaskModuleBoardOverlayInstalled || !document || !document.createElement) return;
        graph.__trellisSelectedTaskModuleBoardOverlayInstalled = true;
        const host = ensureTaskControlOverlayHost();
        if (!host) return;
        const overlay = document.createElement('div');
        overlay.className = 'trellis-task-module-board-overlay';
        overlay.style.cssText = 'position:absolute;display:none;flex-direction:column;align-items:stretch;gap:4px;background:#fff;border:1px solid #111;padding:4px;font:12px Arial,sans-serif;pointer-events:auto;';
        overlay.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL);
        host.appendChild(overlay);
        registerTaskOverlayGestureElement(overlay);
        mxEvent.addListener(overlay, 'mousedown', evt => mxEvent.consume(evt));
        mxEvent.addListener(overlay, 'mouseup', evt => mxEvent.consume(evt));
        const labelControls = document.createElement('div');
        labelControls.className = 'trellis-task-module-label-controls';
        labelControls.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:2px 2px 4px;border-bottom:1px solid #e5e7eb;';
        overlay.appendChild(labelControls);
        const addBoardBtn = document.createElement('button');
        addBoardBtn.type = 'button';
        addBoardBtn.textContent = 'Add Kanban Board';
        addBoardBtn.style.cssText = 'font:12px Arial,sans-serif;padding:3px 6px;';
        applyTaskButtonStyle(addBoardBtn, 'add', { compact: true });
        const internalMarginBtn = document.createElement('button'); // NEW
        internalMarginBtn.type = 'button'; // NEW
        internalMarginBtn.textContent = 'Internal Margin'; // NEW
        internalMarginBtn.style.cssText = 'font:12px Arial,sans-serif;padding:3px 6px;'; // NEW
        applyTaskButtonStyle(internalMarginBtn, 'open', { compact: true }); // NEW
        overlay.appendChild(internalMarginBtn); // NEW
        const externalMarginBtn = document.createElement('button'); // NEW
        externalMarginBtn.type = 'button'; // NEW
        externalMarginBtn.textContent = 'External Margin'; // NEW
        externalMarginBtn.style.cssText = 'font:12px Arial,sans-serif;padding:3px 6px;'; // NEW
        applyTaskButtonStyle(externalMarginBtn, 'open', { compact: true }); // NEW
        overlay.appendChild(externalMarginBtn); // NEW
        overlay.appendChild(addBoardBtn);
        let currentTaskModule = null;
        let pendingClickAnchor = null;
        let lastClickAnchor = null;
        let pendingToggleCell = null;
        let manuallyHiddenTaskModule = null;

        function selectedTaskModule() {
            const cells = getSelectionCellsList();
            return cells.length === 1 && isTaskModule(cells[0]) ? cells[0] : null;
        }

        function makeTaskModuleLabelInput(taskModule) {
            const initialLabel = getTaskModuleOverlayLabel(taskModule);
            const input = document.createElement('input');
            input.type = 'text';
            input.value = initialLabel;
            input.setAttribute('aria-label', 'Task label');
            input.style.cssText = 'display:block;box-sizing:border-box;width:100%;min-width:0;margin-bottom:2px;border:1px solid rgba(75,85,99,0.35);border-radius:4px;padding:3px 5px;font:12px Arial,sans-serif;font-weight:600;';
            ['mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'pointerup'].forEach(type => input.addEventListener(type, function (evt) { if (evt && evt.stopPropagation) evt.stopPropagation(); }));
            input.addEventListener('keydown', function (evt) {
                if (evt && evt.stopPropagation) evt.stopPropagation();
                if (evt.key === 'Enter') {
                    input.value = writeTaskModuleOverlayLabel(taskModule, input.value);
                    if (input.blur) input.blur();
                    consumeDomEvent(evt);
                } else if (evt.key === 'Escape') {
                    input.value = initialLabel;
                    consumeDomEvent(evt);
                }
            });
            ['keypress', 'keyup'].forEach(type => input.addEventListener(type, function (evt) { if (evt && evt.stopPropagation) evt.stopPropagation(); }));
            input.addEventListener('blur', function () { input.value = writeTaskModuleOverlayLabel(taskModule, input.value); });
            return input;
        }

        function renderTaskModuleLabelControls(taskModule) {
            labelControls.innerHTML = '';
            labelControls.appendChild(makeTaskModuleLabelInput(taskModule));
        }

        function taskModuleContainsPoint(taskModule, point) {
            if (!taskModule || !point) return false;
            const geo = graph.getCellGeometry ? graph.getCellGeometry(taskModule) : (model.getGeometry ? model.getGeometry(taskModule) : null);
            if (!geo) return true;
            return point.x >= geo.x && point.y >= geo.y && point.x <= geo.x + geo.width && point.y <= geo.y + geo.height;
        }

        function taskMouseEventCell(me, evt) {
            const cell = me && typeof me.getCell === 'function' ? me.getCell() : null;
            if (cell || !evt || !graph.getCellAt || !graph.getPointForEvent) return cell;
            const point = graph.getPointForEvent(evt, false);
            return point ? graph.getCellAt(point.x, point.y) : null;
        }

        function isPlainPrimaryMouseEvent(evt) {
            if (!evt) return false;
            if ((mxEvent.isPopupTrigger && mxEvent.isPopupTrigger(evt)) || evt.button === 2) return false;
            return !mxEvent.isControlDown(evt) && !mxEvent.isMetaDown(evt) && !mxEvent.isShiftDown(evt) && Number(evt.detail || 1) <= 1;
        }

        function taskContainerPointForEvent(evt, fallbackX, fallbackY) {
            const rawX = evt && evt.clientX != null ? evt.clientX : fallbackX;
            const rawY = evt && evt.clientY != null ? evt.clientY : fallbackY;
            if (rawX == null || rawY == null) return null;
            const anchorHost = graph.container || host || (overlay && overlay.parentNode) || null;
            const rect = anchorHost && anchorHost.getBoundingClientRect ? anchorHost.getBoundingClientRect() : { left: 0, top: 0 };
            return {
                x: (Number(rawX) || 0) - (Number(rect.left) || 0) + (anchorHost ? Number(anchorHost.scrollLeft) || 0 : 0),
                y: (Number(rawY) || 0) - (Number(rect.top) || 0) + (anchorHost ? Number(anchorHost.scrollTop) || 0 : 0)
            };
        }

        function mouseAnchorForEvent(me, evt) {
            const graphX = me && typeof me.getGraphX === 'function' ? me.getGraphX() : (evt && evt.graphX != null ? evt.graphX : null);
            const graphY = me && typeof me.getGraphY === 'function' ? me.getGraphY() : (evt && evt.graphY != null ? evt.graphY : null);
            const containerPoint = taskContainerPointForEvent(evt, graphX, graphY);
            if (graphX == null || graphY == null || !containerPoint) return null;
            return { model: { x: Number(graphX) || 0, y: Number(graphY) || 0 }, container: containerPoint, source: 'cursor' };
        }

        function fallbackAnchorForTaskModule(taskModule) {
            const state = graph.view && graph.view.getState ? graph.view.getState(taskModule) : null;
            if (state) return { model: { x: state.x, y: state.y }, container: { x: state.x, y: state.y } };
            const geo = graph.getCellGeometry ? graph.getCellGeometry(taskModule) : (model.getGeometry ? model.getGeometry(taskModule) : null);
            return { model: { x: geo ? geo.x : 0, y: geo ? geo.y : 0 }, container: { x: geo ? geo.x : 0, y: geo ? geo.y : 0 } };
        }

        function overlayAnchorForTaskModule(taskModule) {
            if (pendingClickAnchor && taskModuleContainsPoint(taskModule, pendingClickAnchor.model)) return pendingClickAnchor;
            if (lastClickAnchor && taskModuleContainsPoint(taskModule, lastClickAnchor.model)) return lastClickAnchor;
            return fallbackAnchorForTaskModule(taskModule);
        }

        function positionTaskModuleOverlay(taskModule, anchor) {
            if (anchor && anchor.container) {
                const offsetX = anchor.source === 'cursor' ? TASK_MODULE_CURSOR_OVERLAY_OFFSET_X : TASK_ACTION_OVERLAY_EXTRA_X;
                const offsetY = anchor.source === 'cursor' ? TASK_MODULE_CURSOR_OVERLAY_OFFSET_Y : TASK_ACTION_OVERLAY_EXTRA_Y;
                overlay.style.left = Math.round(anchor.container.x + offsetX) + 'px'; // CHANGE: selected task module overlays intentionally do not clamp to the viewport
                overlay.style.top = Math.round(anchor.container.y + offsetY) + 'px'; // CHANGE: selected task module overlays intentionally do not clamp to the viewport
                return true;
            }
            return positionDomOverlayFromCellStateUnclamped(overlay, taskModule, true, false, TASK_ACTION_OVERLAY_EXTRA_Y, TASK_ACTION_OVERLAY_EXTRA_X);
        }

        function rememberTaskModuleCursorAnchor(taskModule, anchor) {
            if (!anchor || anchor.source !== 'cursor' || !taskModuleContainsPoint(taskModule, anchor.model)) return null;
            lastClickAnchor = { model: { x: anchor.model.x, y: anchor.model.y }, container: { x: anchor.container.x, y: anchor.container.y }, source: 'cursor' };
            return lastClickAnchor;
        }

        function hideOverlay() {
            overlay.style.display = 'none';
        }

        function showOverlay(taskModule, anchor) {
            currentTaskModule = taskModule;
            renderTaskModuleLabelControls(taskModule);
            overlay.style.display = 'flex';
            if (!positionTaskModuleOverlay(taskModule, anchor || fallbackAnchorForTaskModule(taskModule))) hideOverlay();
        }

        mxEvent.addListener(addBoardBtn, 'click', function (evt) {
            mxEvent.consume(evt);
            const taskModule = selectedTaskModule();
            if (!taskModule) return;
            const board = taskCommands.runModelUpdate({}, function () { return createSecondaryBoardIn(taskModule); });
            if (board && graph.setSelectionCell) graph.setSelectionCell(board);
            if (board && graph.scrollCellToVisible) graph.scrollCellToVisible(board, true);
            overlay.style.display = 'none';
        });

        mxEvent.addListener(internalMarginBtn, 'click', function (evt) {
            mxEvent.consume(evt);
            const taskModule = selectedTaskModule();
            const modules = taskModulesApi();
            if (taskModule && modules && typeof modules.promptSetModuleMargin === 'function') modules.promptSetModuleMargin(taskModule); // NEW
            overlay.style.display = 'none'; // NEW
        });

        mxEvent.addListener(externalMarginBtn, 'click', function (evt) {
            mxEvent.consume(evt);
            const taskModule = selectedTaskModule();
            const modules = taskModulesApi();
            if (taskModule && modules && typeof modules.promptSetModuleExternalMargin === 'function') modules.promptSetModuleExternalMargin(taskModule); // NEW
            overlay.style.display = 'none'; // NEW
        });

        function refresh() {
            const taskModule = selectedTaskModule();
            if (!taskModule) { currentTaskModule = null; manuallyHiddenTaskModule = null; hideOverlay(); return; }
            if (manuallyHiddenTaskModule && manuallyHiddenTaskModule !== taskModule) manuallyHiddenTaskModule = null;
            if (manuallyHiddenTaskModule === taskModule) { currentTaskModule = taskModule; hideOverlay(); return; }
            const rememberedAnchor = rememberTaskModuleCursorAnchor(taskModule, pendingClickAnchor);
            showOverlay(taskModule, rememberedAnchor || overlayAnchorForTaskModule(taskModule));
            pendingClickAnchor = null;
        }

        function onMouseDown(_sender, me) {
            const evt = me && me.getEvent ? me.getEvent() : null;
            if (evt && overlay.contains(mxEvent.getSource ? mxEvent.getSource(evt) : evt.target)) return;
            pendingToggleCell = null;
            pendingClickAnchor = null;
            if (!isPlainPrimaryMouseEvent(evt)) return;
            const selected = selectedTaskModule();
            const cell = taskMouseEventCell(me, evt);
            if (!isTaskModule(cell)) return;
            pendingClickAnchor = mouseAnchorForEvent(me, evt);
            if (selected && cell === selected) pendingToggleCell = selected;
        }

        function onMouseUp(_sender, me) {
            const evt = me && me.getEvent ? me.getEvent() : null;
            const selected = selectedTaskModule();
            const toggleCell = pendingToggleCell;
            const anchor = pendingClickAnchor || mouseAnchorForEvent(me, evt);
            pendingToggleCell = null;
            if (!toggleCell || selected !== toggleCell || !isPlainPrimaryMouseEvent(evt)) return;
            lastClickAnchor = rememberTaskModuleCursorAnchor(toggleCell, anchor) || anchor || lastClickAnchor;
            manuallyHiddenTaskModule = overlay.style.display !== 'none' && currentTaskModule === toggleCell ? toggleCell : null;
            if (manuallyHiddenTaskModule) hideOverlay();
            else { pendingClickAnchor = lastClickAnchor; showOverlay(toggleCell, lastClickAnchor); pendingClickAnchor = null; }
        }

        if (graph.addMouseListener) {
            graph.addMouseListener({ mouseDown: onMouseDown, mouseMove() {}, mouseUp: onMouseUp });
        }

        const requestRefresh = createDeferredTaskOverlayRefresh(refresh);
        graph.getSelectionModel().addListener(mxEvent.CHANGE, requestRefresh);
        addGraphViewRefreshListener(requestRefresh);
        requestRefresh();
    }

    function installSelectedCardActionOverlay() {
        if (graph.__trellisTaskCardOverlayInstalled || !document || !document.createElement) return;
        graph.__trellisTaskCardOverlayInstalled = true;
        const host = ensureTaskControlOverlayHost();
        if (!host) return;
        const overlay = document.createElement('div');
        overlay.className = 'trellis-task-selected-card-actions';
        overlay.style.cssText = 'position:absolute;display:none;flex-direction:column;align-items:stretch;gap:4px;background:#fff;border:1px solid #111;padding:4px;font:12px Arial,sans-serif;pointer-events:auto;';
        overlay.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL);
        host.appendChild(overlay);
        registerTaskOverlayGestureElement(overlay);
        mxEvent.addListener(overlay, 'mousedown', evt => mxEvent.consume(evt));
        mxEvent.addListener(overlay, 'mouseup', evt => mxEvent.consume(evt));

        function add(label, fn, variant) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = label;
            btn.style.cssText = 'font:12px Arial,sans-serif;padding:3px 6px;';
            applyTaskButtonStyle(btn, variant || 'neutral', { compact: true });
            mxEvent.addListener(btn, 'click', function (evt) { mxEvent.consume(evt); const cards = selectedKanbanCards(); if (cards.length) fn(cards); requestRefresh(); });
            overlay.appendChild(btn);
            return btn;
        }

        let assignmentPicker = null;
        let assignmentPickerSignature = '';

        function closeAssignmentPicker(restoreActions) {
            if (assignmentPicker && assignmentPicker.parentNode) assignmentPicker.parentNode.removeChild(assignmentPicker);
            assignmentPicker = null;
            assignmentPickerSignature = '';
            if (assignBtn) assignBtn.setAttribute('aria-expanded', 'false');
            if (restoreActions !== false) requestRefresh();
        }

        function positionAssignmentPickerFromBounds(picker, bounds) {
            if (!picker || !bounds) return false;
            picker.style.left = Math.max(0, Math.round(bounds.x + TASK_ACTION_OVERLAY_EXTRA_X)) + 'px';
            picker.style.top = Math.max(0, Math.round(bounds.y + bounds.height + 6 + TASK_ACTION_OVERLAY_EXTRA_Y)) + 'px';
            return true;
        }

        function assignmentContextSignature(context) { // NEW: stale drafts never apply to changed graph state
            if (!context) return '';
            const profileById = new Map(context.roster.map(profile => [profile.id, profile]));
            context.cards.forEach(card => resolveCardAssigneeProfiles(card, context.board).forEach(profile => profileById.set(profile.id, profile)));
            return [
                context.board.id || '',
                Array.from(getLinkSet(context.board)).sort().join(','),
                context.cards.map(card => String(card.id || '') + ':' + serializeTaskAssigneeRoleIds(getTaskAssigneeRoleIds(card))).join('|'),
                Array.from(profileById.values()).sort((a, b) => a.id.localeCompare(b.id)).map(profile => [profile.id, profile.name, profile.roleTitle, profile.cardTitle, profile.imageSource, profile.eligible ? '1' : '0'].join('~')).join('|')
            ].join('||');
        }

        function appendPickerProfileRow(parent, profile, controls) {
            const row = document.createElement('div');
            row.className = 'trellis-task-assignee-picker-row';
            row.setAttribute('data-search-text', (profile.name + ' ' + profile.roleTitle + ' ' + profile.cardTitle).toLowerCase());
            row.style.cssText = 'display:grid;grid-template-columns:28px minmax(120px,1fr) auto;gap:6px;align-items:center;padding:3px 2px;';
            row.appendChild(makeRoleAvatarNode(profile, 24, navigateToRoleProfile));
            const label = document.createElement('div');
            const name = document.createElement('div');
            name.textContent = profile.name;
            name.style.fontWeight = '700';
            const title = document.createElement('div');
            title.textContent = profile.roleTitle;
            title.style.cssText = 'font-size:11px;color:#4B5563;';
            label.appendChild(name); label.appendChild(title); row.appendChild(label);
            const controlHost = document.createElement('div');
            controlHost.style.cssText = 'display:flex;gap:12px;align-items:center;justify-content:flex-end;';
            controls(controlHost);
            row.appendChild(controlHost);
            parent.appendChild(row);
            return row;
        }

        function makeLabeledCheckbox(labelText) {
            const label = document.createElement('label');
            label.style.cssText = 'display:inline-flex;gap:3px;align-items:center;font-size:11px;white-space:nowrap;';
            const input = document.createElement('input');
            input.type = 'checkbox';
            label.appendChild(input);
            const text = document.createElement('span');
            text.textContent = labelText;
            label.appendChild(text);
            return { label, input };
        }

        function openAssignmentPicker(cards) {
            const context = getAssignmentSelectionContext(cards);
            if (!context) return;
            const rosterIds = new Set(context.roster.map(profile => profile.id));
            const profileById = new Map(context.roster.map(profile => [profile.id, profile]));
            context.cards.forEach(card => resolveCardAssigneeProfiles(card, context.board).forEach(profile => profileById.set(profile.id, profile)));
            if (!profileById.size) return;
            closeAssignmentPicker(false);
            const picker = document.createElement('div');
            picker.className = 'trellis-task-assignee-picker';
            picker.setAttribute('role', 'dialog');
            picker.setAttribute('aria-label', 'Assign task cards');
            picker.style.cssText = 'position:absolute;width:340px;max-width:calc(100vw - 16px);max-height:420px;display:flex;flex-direction:column;background:#fff;border:1px solid #111;border-radius:4px;box-shadow:0 4px 16px rgba(0,0,0,.25);padding:6px;pointer-events:auto;font:12px Arial,sans-serif;z-index:' + GRAPH_OVERLAY_Z.CONTROL_TOP + ';';
            picker.addEventListener('mousedown', consumeDomEvent);
            const search = document.createElement('input');
            search.type = 'search';
            search.placeholder = 'Search people or roles';
            search.setAttribute('aria-label', 'Search people or roles');
            search.style.cssText = 'box-sizing:border-box;width:100%;margin-bottom:5px;padding:4px 6px;font:12px Arial,sans-serif;';
            picker.appendChild(search);
            const list = document.createElement('div');
            list.style.cssText = 'overflow:auto;min-height:40px;';
            picker.appendChild(list);
            const drafts = new Map();
            const single = context.cards.length === 1;
            const groups = [];
            const unavailable = Array.from(profileById.values()).filter(profile => !rosterIds.has(profile.id));
            if (unavailable.length) groups.push({ label: 'Unavailable assignments', warning: true, profiles: unavailable });
            const eligibleGroups = new Map();
            context.roster.forEach(profile => {
                const key = profile.roleTitle.replace(/\s+/g, ' ').trim().toLowerCase();
                if (!eligibleGroups.has(key)) eligibleGroups.set(key, { label: profile.roleTitle, profiles: [] });
                const group = eligibleGroups.get(key);
                if (profile.roleTitle.localeCompare(group.label, undefined, { sensitivity: 'base' }) < 0) group.label = profile.roleTitle;
                group.profiles.push(profile);
            });
            Array.from(eligibleGroups.values()).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })).forEach(group => groups.push(group));

            groups.forEach(group => {
                const section = document.createElement('section');
                section.className = 'trellis-task-assignee-picker-group';
                const heading = document.createElement('div');
                heading.textContent = group.label;
                heading.style.cssText = 'margin-top:4px;padding:3px 2px;border-bottom:1px solid #D1D5DB;font-weight:700;color:' + (group.warning ? '#B45309' : '#111') + ';';
                section.appendChild(heading);
                group.profiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id)).forEach(profile => {
                    const assignedCards = context.cards.filter(card => getTaskAssigneeRoleIds(card).indexOf(profile.id) >= 0);
                    if (single) {
                        const draft = { selected: assignedCards.length === 1 };
                        drafts.set(profile.id, draft);
                        appendPickerProfileRow(section, profile, function (controlHost) {
                            const assignment = makeLabeledCheckbox('Assigned');
                            assignment.input.checked = draft.selected;
                            assignment.input.addEventListener('change', function () { draft.selected = assignment.input.checked; });
                            controlHost.appendChild(assignment.label);
                        });
                    } else {
                        const initiallyExisting = assignedCards.length > 0;
                        const initiallyAll = assignedCards.length === context.cards.length;
                        const canAdd = rosterIds.has(profile.id);
                        const draft = { existing: initiallyExisting, all: canAdd && initiallyAll, savedExisting: initiallyExisting, canAdd, originalIds: new Set(assignedCards.map(card => card.id)) };
                        drafts.set(profile.id, draft);
                        appendPickerProfileRow(section, profile, function (controlHost) {
                            const existing = makeLabeledCheckbox('Existing');
                            const all = makeLabeledCheckbox('All cards');
                            function sync() {
                                existing.input.checked = draft.existing;
                                existing.input.disabled = draft.all || !initiallyExisting;
                                all.input.checked = draft.all;
                                all.input.disabled = !draft.canAdd;
                            }
                            existing.input.addEventListener('change', function () { draft.existing = existing.input.checked; });
                            all.input.addEventListener('change', function () {
                                if (all.input.checked) { draft.savedExisting = draft.existing; draft.all = true; draft.existing = true; }
                                else { draft.all = false; draft.existing = draft.savedExisting; }
                                sync();
                            });
                            sync();
                            controlHost.appendChild(existing.label); controlHost.appendChild(all.label);
                        });
                    }
                });
                list.appendChild(section);
            });

            const emptySearch = document.createElement('div');
            emptySearch.textContent = 'No matching people';
            emptySearch.style.cssText = 'display:none;padding:12px;text-align:center;color:#6B7280;';
            list.appendChild(emptySearch);
            search.addEventListener('input', function () {
                const query = search.value.trim().toLowerCase();
                let anyVisible = false;
                Array.from(list.querySelectorAll('.trellis-task-assignee-picker-group')).forEach(section => {
                    let sectionVisible = false;
                    Array.from(section.querySelectorAll('.trellis-task-assignee-picker-row')).forEach(row => {
                        const visible = !query || String(row.getAttribute('data-search-text') || '').indexOf(query) >= 0;
                        row.style.display = visible ? 'grid' : 'none';
                        sectionVisible = sectionVisible || visible;
                    });
                    section.style.display = sectionVisible ? '' : 'none';
                    anyVisible = anyVisible || sectionVisible;
                });
                emptySearch.style.display = anyVisible ? 'none' : 'block';
            });

            const footer = document.createElement('div');
            footer.style.cssText = 'display:flex;justify-content:flex-end;gap:6px;margin-top:6px;padding-top:5px;border-top:1px solid #D1D5DB;';
            const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; applyTaskButtonStyle(cancel, 'neutral', { compact: true });
            const apply = document.createElement('button'); apply.type = 'button'; apply.textContent = 'Apply'; applyTaskButtonStyle(apply, 'neutral', { compact: true });
            cancel.addEventListener('click', function (evt) { consumeDomEvent(evt); closeAssignmentPicker(); });
            apply.addEventListener('click', function (evt) {
                consumeDomEvent(evt);
                const liveContext = getAssignmentSelectionContext(selectedKanbanCards());
                if (!liveContext || assignmentContextSignature(liveContext) !== assignmentPickerSignature) { closeAssignmentPicker(); return; }
                const nextIdsByCard = new Map();
                liveContext.cards.forEach(card => {
                    const next = new Set(getTaskAssigneeRoleIds(card));
                    drafts.forEach((draft, id) => {
                        if (single) { if (draft.selected) next.add(id); else next.delete(id); return; }
                        if (draft.all) next.add(id);
                        else if (draft.originalIds.has(card.id)) { if (draft.existing) next.add(id); else next.delete(id); }
                        else next.delete(id);
                    });
                    nextIdsByCard.set(card, Array.from(next));
                });
                applyTaskAssignmentSets(liveContext.cards, nextIdsByCard);
                closeAssignmentPicker();
            });
            footer.appendChild(cancel); footer.appendChild(apply); picker.appendChild(footer);
            host.appendChild(picker);
            const pickerBounds = getCellStateBounds(context.cards, picker.parentNode);
            if (!positionAssignmentPickerFromBounds(picker, pickerBounds)) { picker.parentNode.removeChild(picker); return; }
            assignmentPicker = picker;
            assignmentPickerSignature = assignmentContextSignature(context);
            assignBtn.setAttribute('aria-expanded', 'true');
            overlay.style.display = 'none';
            search.focus();
        }

        const editBtn = add('Edit', cards => cards.length === 1 ? taskDialogs.showEditCardDialog(cards[0]) : taskDialogs.showBulkEditCardsDialog(cards), 'open');
        const assignBtn = add('Assign to', openAssignmentPicker, 'open');
        assignBtn.setAttribute('aria-haspopup', 'dialog');
        assignBtn.setAttribute('aria-expanded', 'false');
        const todoBtn = add('TODO', cards => taskCommands.applyCardWorkflowActions(cards, 'TODO'));
        const doingBtn = add('DOING', cards => taskCommands.applyCardWorkflowActions(cards, 'DOING'));
        const doneBtn = add('DONE', cards => taskCommands.applyCardWorkflowActions(cards, 'DONE'));
        const allocateBtn = add('Allocate to Start Dates', cards => taskCommands.applyStagedStartDateAllocation(cards), 'add');
        const resetBtn = add('Reset Dates', cards => cards.length === 1 ? taskCommands.resetCardDates(cards[0]) : taskCommands.resetCardDatesForCards(cards), 'danger');
        const clearBtn = add('Clear Note', cards => cards.length === 1 ? taskCommands.clearCardNote(cards[0]) : taskCommands.applyBulkCardEdit(cards, { replaceNote: true, note: '' }), 'danger');

        function refresh() {
            const cards = selectedKanbanCards();
            const assignmentContext = getAssignmentSelectionContext(cards);
            if (assignmentPicker && assignmentContextSignature(assignmentContext) !== assignmentPickerSignature) closeAssignmentPicker(false);
            if (!cards.length) { closeAssignmentPicker(false); overlay.style.display = 'none'; return; }
            const bounds = getCellStateBounds(cards, overlay.parentNode);
            if (!bounds) { closeAssignmentPicker(false); overlay.style.display = 'none'; return; }
            if (assignmentPicker) {
                if (!positionAssignmentPickerFromBounds(assignmentPicker, bounds)) closeAssignmentPicker(false);
                overlay.style.display = 'none';
                return;
            }
            const single = cards.length === 1;
            const card = cards[0];
            const state = single ? getEffectiveWorkflowState(card.value, laneKeyOfCard(card)) : null;
            const showWorkflowButtons = selectionIsOnlyWeekDayLaneCards(cards);
            overlay.style.display = 'flex';
            editBtn.style.display = '';
            assignBtn.style.display = assignmentContext ? '' : 'none';
            if (assignmentContext) {
                const assignedCount = new Set(assignmentContext.cards.flatMap(getTaskAssigneeRoleIds)).size;
                const hasEditableProfiles = assignmentContext.roster.length > 0 || assignedCount > 0;
                assignBtn.disabled = !hasEditableProfiles;
                assignBtn.textContent = hasEditableProfiles ? ('Assign to' + (assignedCount ? ' (' + assignedCount + ')' : '')) : 'Assign to — link role cards to this board';
                assignBtn.title = hasEditableProfiles ? 'Assign linked role cards' : 'Directly link role cards to this board to assign them';
            }
            todoBtn.style.display = showWorkflowButtons && (!single || state !== 'TODO') ? '' : 'none';
            doingBtn.style.display = showWorkflowButtons && (!single || state !== 'DOING') ? '' : 'none';
            doneBtn.style.display = showWorkflowButtons && (!single || state !== 'DONE') ? '' : 'none';
            allocateBtn.style.display = selectionIsOnlyStagedWorkflowCards(cards) ? '' : 'none';
            resetBtn.style.display = single ? (canEditCardDates(card) && hasCardDateOverride(card) ? '' : 'none') : (cards.some(hasCardDateOverride) ? '' : 'none');
            clearBtn.style.display = single ? (getCardNote(card) ? '' : 'none') : (cards.some(getCardNote) ? '' : 'none');
            if (!positionDomOverlayFromBounds(overlay, bounds, true, false, TASK_ACTION_OVERLAY_EXTRA_Y, TASK_ACTION_OVERLAY_EXTRA_X)) overlay.style.display = 'none';
        }

        const requestRefresh = createDeferredTaskOverlayRefresh(refresh);
        graph.getSelectionModel().addListener(mxEvent.CHANGE, requestRefresh);
        addGraphViewRefreshListener(requestRefresh);
        document.addEventListener('mousedown', function (evt) { if (assignmentPicker && !assignmentPicker.contains(evt.target) && evt.target !== assignBtn) closeAssignmentPicker(); }, true);
        document.addEventListener('keydown', function (evt) { if (assignmentPicker && (evt.key === 'Escape' || evt.keyCode === 27)) { consumeDomEvent(evt); closeAssignmentPicker(); } });
        requestRefresh();
    }

    // -------------------- Context menu installer --------------------
    (function addMenuHook() {
        function registerTrellisContextMenuContributor(contributor) {
            function finishRegistration() {
                if (!window.TrellisContextMenu) return;
                window.TrellisContextMenu.install(ui);
                window.TrellisContextMenu.register(contributor);
            }

            if (window.TrellisContextMenu) {
                finishRegistration();
            } else if (typeof mxscript === "function") {
                mxscript("plugins/garden_planner_plugins/Trellis_Context_Menu.js", finishRegistration);
            }
        }

        registerTrellisContextMenuContributor({
            id: "gardenTasks",
            priority: 500,
            addItems: function (menu, cell, evt) {
            const card = cell && model.isVertex(cell) && isKanbanCard(cell) ? cell : null;

            if (card) { // CHANGE: note actions are available in every Kanban lane
                menu.addSeparator();
                menu.addItem('Edit Card...', null, function () {
                    taskDialogs.showEditCardDialog(card);
                });

                if (getCardNote(card)) {
                    menu.addItem('Clear Card Note', null, function () {
                        taskCommands.clearCardNote(card);
                    });
                }

                if (canEditCardDates(card) && hasCardDateOverride(card)) {
                    menu.addItem('Reset Card Dates', null, function () {
                        taskCommands.resetCardDates(card);
                    });
                }

                const repeatContext = getRepeatSeriesContext(card);
                if (repeatContext) {
                    menu.addItem(
                        repeatContext.expanded ? 'Collapse Repeating Tasks' : 'Expand Repeating Tasks',
                        null,
                        function () {
                            taskCommands.setRepeatSeriesExpanded(card, !repeatContext.expanded);
                        }
                    );
                }
            }

            const taskModule = cell && model.isVertex(cell) && isTaskModule(cell) ? cell : null;
            if (!taskModule) return;

            menu.addSeparator();
            menu.addItem('Add Kanban Board', null, function () {
                taskCommands.runModelUpdate({}, function () { createSecondaryBoardIn(taskModule); });
            });
            }
        });
    })();

    // -------------------- Boot sequence --------------------
    installTaskOverlayGestureGate();
    installLanePagerOverlay();
    addGraphViewRefreshListener(refreshTransientUnseenHighlightPositions);
    if (model.addListener) model.addListener(mxEvent.CHANGE, clearTransientUnseenHighlights);
    initializeLanePagingFromModel();
    installWeekAssigneeBadgeLayer();
    installBoardHeaderControls();
    installWeekTimeScaleOverlay();
    installSelectedTaskModuleBoardOverlay();
    installSelectedDayLaneActionOverlay();
    installSelectedCardActionOverlay();

    // -------------------- Event bridge installers --------------------
    function handleTasksCreatedEvent(ev) {
        const detail = ev && ev.detail ? ev.detail : {};
        const replacement = normalizeTaskReplacementDetail(detail);
        const tasks = replacement.tasks;
        const targetGroupId = replacement.targetGroupId;

        if ((replacement.mode !== 'replace' && replacement.mode !== 'sync') || !targetGroupId) return;

        setTimeout(function () {
            runTrellisHistoryTransaction({ category: replacement.mode === 'sync' ? "Garden scheduling" : "Tasks", action: replacement.mode, origin: "Garden_Task_Manager", title: replacement.mode === 'sync' ? "Synchronize generated tasks" : "Replace generated tasks", affectedCellIds: [targetGroupId] }, function () {
                taskCommands.applySchedulerTaskReplacement(replacement);
            });
        }, 0);
    }

    window.addEventListener('tasksCreated', handleTasksCreatedEvent);

    window.addEventListener('trellisHistoryBeforeRestore', function () {
        cancelPendingKanbanRepairs();
    });

    window.addEventListener('trellisHistoryAfterRestore', function () {
        try { taskCommands.scanAllBoards({ insideUpdate: false }); } catch (e) { }
    });

    window.addEventListener("yearFilterChanged", function (ev) {
        try {
            // simplest: rescan boards so paging respects year_hidden
            taskCommands.scanAllBoards({ insideUpdate: false });
        } catch (e) { }
    });

    console.log('[TaskManager] Kanban loaded. Use window.TaskBus.createTasks([...]).');

    // -------------------- Garden-creation task board hook --------------------
    if (!graph.__uslKanbanGardenEventInstalled) {
        graph.__uslKanbanGardenEventInstalled = true;

        graph.addListener("usl:taskModuleReady", function (_sender, evt) {
            const taskModule = evt && typeof evt.getProperty === "function"
                ? evt.getProperty("taskModule")
                : null;
            const createMainBoard = !!(evt && typeof evt.getProperty === "function" && evt.getProperty("createMainBoard"));
            if (!createMainBoard) return;
            if (!taskModule || !model.isVertex(taskModule) || !isTaskModule(taskModule)) return;
            setTimeout(function () { taskCommands.ensureBoardTemplateInUpdate(taskModule); }, 0);
        });
    }

        }
    });
}

Draw.loadPlugin(function (ui) {
    createGardenTaskManagerRuntime({
        ui,
        taskPolicy: TaskPolicyCore,
        schedulePolicy: SchedulePolicyCore
    }).install();
});
