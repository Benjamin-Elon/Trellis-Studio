// Pure roadmap policy and geometry; no DOM, Draw, persistence, or input mutation. // NEW
(function (root) { // NEW
    'use strict'; // NEW
 // NEW
    const DAY_MS = 86400000; // NEW
    const OFFSETS = [-365, -30, -7, 0, 7, 14, 30, 365, 730]; // NEW
    const KEYS = ['pastYear', 'pastMonth', 'pastWeek', 'thisWeek', 'nextWeek', 'nextMonth', 'nextYear', 'future']; // NEW
    const LABELS = ['Past Year', 'Past Month', 'Past Week', 'This Week', 'Next Week', 'Next Month', 'Next Year', 'Future']; // NEW
    const TICK_STEPS = [30, 7, 1, 1, 1, 7, 30, 30]; // NEW
    const STATUSES = ['Planned', 'Doing', 'Blocked', 'Done']; // NEW
    const PADDING = 12; // NEW
    const BOARD_HEADER = 64; // NEW
    const PROCESS_HEADER = 28; // NEW
    const OBJECT_HEIGHT = 26; // NEW
    const GAP = 8; // NEW
 // NEW
    /** Parse exactly YYYY-MM-DD in the proleptic Gregorian calendar, including year 0000. */ // NEW
    function parseDay(iso) { // NEW
        if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null; // NEW
        const year = Number(iso.slice(0, 4)); // NEW
        const month = Number(iso.slice(5, 7)); // NEW
        const day = Number(iso.slice(8, 10)); // NEW
        const date = new Date(0); // NEW
        date.setUTCFullYear(year, month - 1, day); // NEW
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null; // NEW
        return date.getTime() / DAY_MS; // NEW
    } // NEW
 // NEW
    /** Format an integer epoch day; reject dates outside the four-digit year contract. */ // NEW
    function formatDay(day) { // NEW
        if (!Number.isInteger(day)) throw new RangeError('day must be an integer epoch day'); // NEW
        const date = new Date(day * DAY_MS); // NEW
        const year = date.getUTCFullYear(); // NEW
        if (!Number.isFinite(year) || year < 0 || year > 9999) throw new RangeError('day must be in years 0000 through 9999'); // NEW
        return date.toISOString().slice(0, 10); // NEW
    } // NEW
 // NEW
    /** Encode the supplied Date's LOCAL calendar date as a UTC epoch day; only this API reads the clock. */ // NEW
    function todayDay(date = new Date()) { // NEW
        if (!date || typeof date.getTime !== 'function' || !Number.isFinite(date.getTime())) throw new TypeError('date must be a valid Date'); // NEW
        const localMidnight = new Date(0); // NEW
        localMidnight.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate()); // NEW
        return localMidnight.getTime() / DAY_MS; // NEW
    } // NEW
 // NEW
    /** Preserve positive finite settings; invalid settings use their independent defaults. */ // NEW
    function normalizePerspective(record) { // NEW
        const value = record && typeof record === 'object' ? record : {}; // NEW
        const scales = Array.isArray(value.scales) ? value.scales : []; // NEW
        return { // NEW
            scales: Array.from({ length: 8 }, (_, index) => Number.isFinite(scales[index]) && scales[index] > 0 ? scales[index] : 4), // NEW
            multiplier: Number.isFinite(value.multiplier) && value.multiplier > 0 ? value.multiplier : 1, // NEW
            leftHidden: Number.isFinite(value.leftHidden) ? Math.max(0, Math.min(3, Math.trunc(value.leftHidden))) : 0, // NEW
            rightHidden: Number.isFinite(value.rightHidden) ? Math.max(0, Math.min(4, Math.trunc(value.rightHidden))) : 0 // NEW
        }; // NEW
    } // NEW
 // NEW
    /** Return fresh settings for both perspectives; inception selects an externally supplied anchor. */ // NEW
    function normalizeView(record) { // NEW
        const value = record && typeof record === 'object' ? record : {}; // NEW
        return { // NEW
            perspective: value.perspective === 'inception' ? 'inception' : 'today', // NEW
            today: normalizePerspective(value.today), // NEW
            inception: normalizePerspective(value.inception) // NEW
        }; // NEW
    } // NEW
 // NEW
    /** Date-bearing inputs accept strict ISO dates or safe integer epoch days, never timestamps. */ // NEW
    function requireDay(value, name) { // NEW
        const day = typeof value === 'string' ? parseDay(value) : value; // NEW
        if (!Number.isSafeInteger(day)) throw new TypeError(name + ' must be an ISO date or integer epoch day'); // NEW
        return day; // NEW
    } // NEW
 // NEW
    /** // NEW
     * Build eight half-open columns. view accepts either a perspective's settings or normalizeView's result. // NEW
     * Effective scale is pixels/day times multiplier; only outer boundaries expand for inclusive min/max. // NEW
     * Tick strides are fixed per timeframe in days, independent of scale, multiplier, and trimming. // NEW
     * Hidden columns have zero width and retain dates/scale; start/end describe the contiguous visible domain. // NEW
     */ // NEW
    function buildTimeline({ anchor, minDay, maxDay, view } = {}) { // NEW
        anchor = requireDay(anchor, 'anchor'); // NEW
        const min = minDay == null ? anchor - 365 : requireDay(minDay, 'minDay'); // NEW
        const max = maxDay == null ? anchor + 729 : requireDay(maxDay, 'maxDay'); // NEW
        if (minDay != null && maxDay != null && min > max) throw new RangeError('minDay must not exceed maxDay'); // NEW
        const fullView = view && ('today' in Object(view) || 'inception' in Object(view) || 'perspective' in Object(view)) ? normalizeView(view) : null; // NEW
        const settings = fullView ? fullView[fullView.perspective] : normalizePerspective(view); // NEW
        const boundaries = OFFSETS.map(offset => anchor + offset); // NEW
        boundaries[0] = Math.min(boundaries[0], min); // NEW
        boundaries[8] = Math.max(boundaries[8], max + 1); // NEW
        if (!boundaries.every(Number.isSafeInteger)) throw new RangeError('timeline boundaries exceed safe integer days'); // NEW
        let width = 0; // NEW
        const columns = KEYS.map((key, index) => { // NEW
            const scale = settings.scales[index] * settings.multiplier; // NEW
            const visible = index >= settings.leftHidden && index < 8 - settings.rightHidden; // NEW
            const columnWidth = visible ? (boundaries[index + 1] - boundaries[index]) * scale : 0; // NEW
            if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(1 / scale) || !Number.isFinite(columnWidth) || (visible && columnWidth <= 0)) { // NEW
                throw new RangeError('timeline scale produces unrepresentable coordinates'); // NEW
            } // NEW
            const column = { key, label: LABELS[index], start: boundaries[index], end: boundaries[index + 1], x: width, width: columnWidth, scale, visible, tickStep: TICK_STEPS[index] }; // NEW
            width += columnWidth; // NEW
            return column; // NEW
        }); // NEW
        if (!Number.isFinite(width)) throw new RangeError('timeline width exceeds finite coordinates'); // NEW
        const active = columns.filter(column => column.visible); // NEW
        return { columns, width, start: active[0].start, end: active[active.length - 1].end, anchor }; // NEW
    } // NEW
 // NEW
    /** Convert a finite (possibly fractional) epoch day, extrapolating with the nearest visible scale. */ // NEW
    function dayToX(timeline, day) { // NEW
        if (!Number.isFinite(day)) throw new TypeError('day must be finite'); // NEW
        const active = timeline.columns.filter(column => column.visible); // NEW
        if (!active.length) throw new RangeError('timeline must contain a visible column'); // NEW
        const column = active.find(candidate => day < candidate.end) || active[active.length - 1]; // NEW
        return column.x + (day - column.start) * column.scale; // NEW
    } // NEW
 // NEW
    /** Inverse of dayToX, returning a fractional epoch day without rounding or clamping. */ // NEW
    function xToDay(timeline, x) { // NEW
        if (!Number.isFinite(x)) throw new TypeError('x must be finite'); // NEW
        const active = timeline.columns.filter(column => column.visible); // NEW
        if (!active.length) throw new RangeError('timeline must contain a visible column'); // NEW
        const column = active.find(candidate => x < candidate.x + candidate.width) || active[active.length - 1]; // NEW
        return column.start + (x - column.x) / column.scale; // NEW
    } // NEW
 // NEW
    /** Validate collection identity without mutating records; strings and finite numbers are distinct IDs. */ // NEW
    function validateIds(items, name) { // NEW
        if (!Array.isArray(items)) throw new TypeError(name + ' must be an array'); // NEW
        const ids = new Set(); // NEW
        for (const item of items) { // NEW
            if (!item || !((typeof item.id === 'string' && item.id.length > 0) || Number.isFinite(item.id))) throw new TypeError(name + ' requires string or finite numeric IDs'); // NEW
            if (ids.has(item.id)) throw new RangeError(name + ' contains duplicate ID: ' + item.id); // NEW
            ids.add(item.id); // NEW
        } // NEW
    } // NEW
 // NEW
    /** Validate inclusive dates once at the policy boundary. */ // NEW
    function intervalOf(item) { // NEW
        const start = requireDay(item.start, 'start'); // NEW
        const end = requireDay(item.end, 'end'); // NEW
        if (start > end) throw new RangeError('start must not exceed end'); // NEW
        if (!Number.isSafeInteger(end + 1) || !Number.isSafeInteger(end - start + 1)) throw new RangeError('interval exceeds safe integer days'); // NEW
        return { start, end }; // NEW
    } // NEW
 // NEW
    /** Start then ID order, independent of input order and host locale (numeric IDs sort numerically). */ // NEW
    function compareIntervals(a, b) { // NEW
        if (a.start !== b.start) return a.start - b.start; // NEW
        if (typeof a.item.id === 'number' && typeof b.item.id === 'number') return a.item.id - b.item.id; // NEW
        const aKey = typeof a.item.id + ':' + a.item.id; // NEW
        const bKey = typeof b.item.id + ':' + b.item.id; // NEW
        return aKey < bKey ? -1 : aKey > bKey ? 1 : 0; // NEW
    } // NEW
 // NEW
    /** // NEW
     * First available row packing of inclusive intervals; sharing an endpoint is an overlap. // NEW
     * Options are vertical gap (default 8) and minRowHeight (default 26), both finite and nonnegative. // NEW
     * rows retain original items; placement y uses FINAL row heights, with no trailing gap. // NEW
     * O(n log n + n*r), intentionally simple for hundreds of objects; worst case is O(n^2). // NEW
     */ // NEW
    function packIntervals(items, { gap = GAP, minRowHeight = OBJECT_HEIGHT, preferRows = false } = {}) { // NEW
        validateIds(items, 'items'); // NEW
        if (!Number.isFinite(gap) || gap < 0 || !Number.isFinite(minRowHeight) || minRowHeight < 0) throw new RangeError('gap and minRowHeight must be finite and nonnegative'); // NEW
        const sorted = items.map(item => { // NEW
            const height = item.height == null ? minRowHeight : item.height; // NEW
            if (!Number.isFinite(height) || height < 0) throw new RangeError('item height must be finite and nonnegative'); // NEW
            return { item, ...intervalOf(item), height }; // NEW
        }).sort(compareIntervals); // NEW
        // Find minimum capacity independently of the optional row preference. // NEW
        const capacityEnds = []; // NEW
        if (preferRows) sorted.forEach(entry => { let index = capacityEnds.findIndex(end => end < entry.start); if (index < 0) index = capacityEnds.length; capacityEnds[index] = entry.end; }); // NEW
        const rows = capacityEnds.map(() => ({ items: [], height: minRowHeight })); // CHANGE
        const rowEnds = capacityEnds.map(() => -Infinity); // CHANGE
        for (const entry of sorted) { // NEW
            let rowIndex = rowEnds.findIndex(end => end < entry.start); // NEW
            if (preferRows && Number.isInteger(entry.item.preferredRow) && entry.item.preferredRow >= 0) { // NEW
                const preferred = Math.min(rows.length - 1, entry.item.preferredRow); // NEW
                rowIndex = rowEnds.map((end, index) => ({ end, index })).filter(row => row.end < entry.start).sort((a, b) => Math.abs(a.index - preferred) - Math.abs(b.index - preferred) || a.index - b.index)[0].index; // NEW
            } // NEW
            if (rowIndex < 0) { // NEW
                rowIndex = rows.length; // NEW
                rows.push({ items: [], height: minRowHeight }); // NEW
            } // NEW
            rowEnds[rowIndex] = entry.end; // NEW
            rows[rowIndex].items.push(entry.item); // NEW
            rows[rowIndex].height = Math.max(rows[rowIndex].height, entry.height); // NEW
        } // NEW
        const placements = new Map(); // NEW
        let height = 0; // NEW
        rows.forEach((row, index) => { // NEW
            if (index > 0) height += gap; // NEW
            for (const item of row.items) placements.set(item.id, { row: index, y: height }); // NEW
            height += row.height; // NEW
        }); // NEW
        return { rows, placements, height }; // NEW
    } // NEW
 // NEW
    /** Missing status means Planned; unknown status is a data error rather than silent progress loss. */ // NEW
    function requireStatus(status = 'Planned') { // NEW
        if (!STATUSES.includes(status)) throw new RangeError('Unknown roadmap status: ' + status); // NEW
        return status; // NEW
    } // NEW
 // NEW
    /** Normalize stored progress to [0,100]; missing or nonnumeric progress is zero. */ // NEW
    function storedProgress(progress) { // NEW
        return Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0; // NEW
    } // NEW
 // NEW
    /** Inclusive-duration-weighted progress, unrounded; Planned contributes 0, Done 100. Empty means 0. */ // NEW
    function progressSummary(objects) { // NEW
        if (!Array.isArray(objects)) throw new TypeError('objects must be an array'); // NEW
        let duration = 0; // NEW
        let weightedProgress = 0; // NEW
        let blockedCount = 0; // NEW
        for (const object of objects) { // NEW
            const interval = intervalOf(object); // NEW
            const weight = interval.end - interval.start + 1; // NEW
            const status = requireStatus(object.status); // NEW
            const percent = status === 'Planned' ? 0 : status === 'Done' ? 100 : storedProgress(object.progress); // NEW
            duration += weight; // NEW
            weightedProgress += percent * weight; // NEW
            if (status === 'Blocked') blockedCount += 1; // NEW
        } // NEW
        return { percent: duration ? weightedProgress / duration : 0, blockedCount }; // NEW
    } // NEW
 // NEW
    /** Planned preserves stored progress. Entering/leaving Done stores 100. Done -> Blocked is forbidden. */ // NEW
    function transitionStatus({ status, progress }, next) { // NEW
        status = requireStatus(status); // NEW
        next = requireStatus(next); // NEW
        if (status === 'Done' && next === 'Blocked') throw new RangeError('Cannot transition Done directly to Blocked'); // NEW
        return { status: next, progress: status === 'Done' || next === 'Done' ? 100 : storedProgress(progress) }; // NEW
    } // NEW
 // NEW
    /** // NEW
     * Return {processes: Map, objects: Map, width, height}; both maps hold {x,y,width,height}. // NEW
     * Processes and objects use first-available interval packing; parent bounds expand to contain objects. // NEW
     * Process x/y are board-relative, object x/y process-relative, with inclusive end mapped at end+1. // NEW
     * Process body has 12px vertical padding; objects are 26px tall, separated by 8px rows. // NEW
     * Board header is 64px, padding 12px, process header 28px, process gap 8px. // NEW
     * Horizontal dates are never clamped: the renderer clips extrapolated geometry after trimming. // NEW
     * Object IDs must be unique across the board; process IDs use a separate namespace. // NEW
     */ // NEW
    function layoutRoadmap({ processes, timeline }) { // NEW
        validateIds(processes, 'processes'); // NEW
        const objectList = []; // NEW
        for (const process of processes) { // NEW
            if (process.objects != null && !Array.isArray(process.objects)) throw new TypeError('process.objects must be an array'); // NEW
            for (const object of process.objects || []) objectList.push(object); // NEW
        } // NEW
        validateIds(objectList, 'objects'); // NEW
        const processGeometries = new Map(); // NEW
        const objectGeometries = new Map(); // NEW
        const processIntervals = processes.map(process => { // NEW
            let { start, end } = intervalOf(process); // NEW
            const objects = process.objects || []; // NEW
            for (const object of objects) { // NEW
                const interval = intervalOf(object); // NEW
                start = Math.min(start, interval.start); // NEW
                end = Math.max(end, interval.end); // NEW
            } // NEW
            const packed = packIntervals(objects.map(object => ({ ...object, height: OBJECT_HEIGHT }))); // NEW
            const x = dayToX(timeline, start); // NEW
            const height = PROCESS_HEADER + 2 * PADDING + packed.height; // NEW
            processGeometries.set(process.id, { x: PADDING + x, y: 0, width: dayToX(timeline, end + 1) - x, height }); // NEW
            for (const object of objects) { // NEW
                const interval = intervalOf(object); // NEW
                const objectX = dayToX(timeline, interval.start); // NEW
                objectGeometries.set(object.id, { // NEW
                    x: objectX - x, y: PROCESS_HEADER + PADDING + packed.placements.get(object.id).y, // NEW
                    width: dayToX(timeline, interval.end + 1) - objectX, height: OBJECT_HEIGHT // NEW
                }); // NEW
            } // NEW
            return { id: process.id, start, end, height, preferredRow: process.preferredRow }; // NEW
        }); // NEW
        const packedProcesses = packIntervals(processIntervals, { gap: GAP, minRowHeight: PROCESS_HEADER + 2 * PADDING, preferRows: true }); // NEW
        for (const [id, placement] of packedProcesses.placements) { // NEW
            processGeometries.get(id).y = BOARD_HEADER + PADDING + placement.y; // NEW
        } // NEW
        return { processes: processGeometries, objects: objectGeometries, width: timeline.width + 2 * PADDING, height: BOARD_HEADER + 2 * PADDING + packedProcesses.height }; // NEW
    } // NEW
 // NEW
    /** Immutable peer-layout planner; Modules supplies its existing directional push policy. */ // NEW
    function planCollisions(items, { seedIds = [], protectedIds = [], previous = new Map(), pushDelta } = {}) { // NEW
        const result = new Map(items.map(item => [item.id, { ...item }])), affected = new Set(seedIds), fixed = new Set(protectedIds); // NEW
        const list = Array.from(result.values()), intersects = (a, b, gap) => b.x < a.x + a.width + gap - 0.001 && b.x + b.width > a.x - gap + 0.001 && b.y < a.y + a.height + gap - 0.001 && b.y + b.height > a.y - gap + 0.001; // NEW
        function shortest(a, b, gap) { return [{ dx: a.x - gap - b.x - b.width, dy: 0 }, { dx: a.x + a.width + gap - b.x, dy: 0 }, { dx: 0, dy: a.y - gap - b.y - b.height }, { dx: 0, dy: a.y + a.height + gap - b.y }].sort((a, b) => Math.abs(a.dx) + Math.abs(a.dy) - Math.abs(b.dx) - Math.abs(b.dy))[0]; } // NEW
        // Match neighboring modules: nearby peers follow inward-moving edges after shrink. // NEW
        seedIds.forEach(key => { const next = result.get(key), old = previous.get(key); if (!next || !old) return; list.forEach(peer => { // NEW
            if (peer === next || fixed.has(peer.id)) return; const gap = Math.max(next.margin || 0, peer.margin || 0), threshold = gap * 3; let dx = 0, dy = 0; // NEW
            if (next.x > old.x && peer.x + peer.width <= old.x && old.x - peer.x - peer.width <= threshold) dx = next.x - gap - peer.x - peer.width; // NEW
            if (next.x + next.width < old.x + old.width && peer.x >= old.x + old.width && peer.x - old.x - old.width <= threshold) dx = next.x + next.width + gap - peer.x; // NEW
            if (next.y > old.y && peer.y + peer.height <= old.y && old.y - peer.y - peer.height <= threshold) dy = next.y - gap - peer.y - peer.height; // NEW
            if (next.y + next.height < old.y + old.height && peer.y >= old.y + old.height && peer.y - old.y - old.height <= threshold) dy = next.y + next.height + gap - peer.y; // NEW
            if (dx || dy) { peer.x += dx; peer.y += dy; affected.add(peer.id); } // NEW
        }); }); // NEW
        for (let pass = 0; pass <= list.length * 2; pass++) { // NEW
            let moved = false; // NEW
            for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { // NEW
                let a = list[i], b = list[j]; if (!affected.has(a.id) && !affected.has(b.id)) continue; // NEW
                const gap = Math.max(a.margin || 0, b.margin || 0); if (!intersects(a, b, gap)) continue; // NEW
                if (fixed.has(a.id) && fixed.has(b.id)) throw new Error('The selected boards overlap. Move them separately.'); // NEW
                if (fixed.has(b.id) || !affected.has(a.id) && affected.has(b.id)) [a, b] = [b, a]; // NEW
                const delta = pushDelta ? pushDelta(a, b, gap) : shortest(a, b, gap); // NEW
                if (!delta || !Number.isFinite(delta.dx) || !Number.isFinite(delta.dy)) throw new Error('Cannot resolve neighboring layout.'); // NEW
                b.x += delta.dx; b.y += delta.dy; affected.add(b.id); moved = true; // NEW
            } // NEW
            if (!moved) return result; // NEW
        } // NEW
        throw new Error('Cannot resolve neighboring layout without a collision.'); // NEW
    } // NEW

    const api = Object.freeze({ parseDay, formatDay, todayDay, normalizeView, buildTimeline, dayToX, xToDay, planCollisions, packIntervals, progressSummary, transitionStatus, layoutRoadmap }); // NEW
    root.TrellisRoadmapCore = api; // NEW
    if (typeof module !== 'undefined' && module && typeof module.exports !== 'undefined') module.exports = api; // NEW
})(globalThis); // NEW
