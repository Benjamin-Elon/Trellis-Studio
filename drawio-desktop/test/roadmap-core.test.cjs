// Pure-core contract tests: no Draw, DOM, model fixtures, or application bootstrap. // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const vm = require('node:vm'); // NEW
const Module = require('node:module'); // NEW
const { spawnSync } = require('node:child_process'); // NEW
const { performance } = require('node:perf_hooks'); // NEW
const test = require('node:test'); // NEW
 // NEW
const PLUGIN_PATH = path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins/Garden_Roadmap_Core.js'); // NEW
const SOURCE = fs.readFileSync(PLUGIN_PATH, 'utf8'); // NEW
// The application package is ESM; compile this standalone script explicitly as CommonJS. // NEW
const coreModule = new Module(PLUGIN_PATH, module); // NEW
coreModule._compile(SOURCE, PLUGIN_PATH); // NEW
const core = coreModule.exports; // NEW
const ANCHOR = core.parseDay('2024-03-10'); // NEW
 // NEW
/** Relative tolerance accommodates floating point conversions across different scales. */ // NEW
function near(actual, expected, tolerance = 1e-8) { // NEW
    assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`); // NEW
} // NEW
 // NEW
/** Freeze nested records to catch accidental writes to shared runtime data. */ // NEW
function freezeDeep(value) { // NEW
    Object.freeze(value); // NEW
    for (const child of Object.values(value)) { // NEW
        if (child && typeof child === 'object') freezeDeep(child); // NEW
    } // NEW
    return value; // NEW
} // NEW
 // NEW
test('exports the same frozen API globally and through CommonJS without Draw', () => { // NEW
    assert.equal(globalThis.TrellisRoadmapCore, core); // NEW
    assert.ok(Object.isFrozen(core)); // NEW
    const browser = {}; // NEW
    vm.runInNewContext(SOURCE, browser, { filename: PLUGIN_PATH }); // NEW
    assert.deepEqual(Object.keys(browser.TrellisRoadmapCore), Object.keys(core)); // NEW
    assert.equal(browser.TrellisRoadmapCore.parseDay('1970-01-01'), 0); // NEW
    const commonjs = { module: { exports: {} } }; // NEW
    vm.runInNewContext(SOURCE, commonjs); // NEW
    assert.equal(commonjs.module.exports, commonjs.TrellisRoadmapCore); // NEW
}); // NEW
 // NEW
test('strict ISO parsing rejects normalized, ambiguous, and non-calendar dates', () => { // NEW
    for (const value of [null, undefined, 0, {}, new Date(), '', '2024-2-01', '24-02-01', '2024-02-1', '2024-02-30', '2023-02-29', '1900-02-29', '2100-02-29', '2024-00-01', '2024-13-01', '2024-01-00', '2024-01-32', '2024-04-31', '2024-01-01Z', '2024-01-01T00:00:00Z', ' 2024-01-01', '2024-01-01\n', '+010000-01-01']) { // NEW
        assert.equal(core.parseDay(value), null, String(value)); // NEW
    } // NEW
}); // NEW
 // NEW
test('UTC day round trips include leap centuries, pre-epoch dates, and years below 100', () => { // NEW
    for (const iso of ['0000-01-01', '0000-02-29', '0001-01-01', '0099-12-31', '0100-03-01', '1900-03-01', '1969-12-31', '1970-01-01', '2000-02-29', '2024-02-29', '9999-12-31']) { // NEW
        assert.ok(Number.isInteger(core.parseDay(iso))); // NEW
        assert.equal(core.formatDay(core.parseDay(iso)), iso); // NEW
    } // NEW
    assert.equal(core.parseDay('1970-01-01'), 0); // NEW
    assert.equal(core.parseDay('1969-12-31'), -1); // NEW
    assert.equal(core.parseDay('2000-03-01') - core.parseDay('2000-02-28'), 2); // NEW
    assert.equal(core.parseDay('1900-03-01') - core.parseDay('1900-02-28'), 1); // NEW
    for (const day of [NaN, Infinity, 0.5, '0', null, core.parseDay('0000-01-01') - 1, core.parseDay('9999-12-31') + 1]) { // NEW
        assert.throws(() => core.formatDay(day), RangeError); // NEW
    } // NEW
}); // NEW
 // NEW
test('local today follows timezone calendar dates across DST and UTC date boundaries', () => { // NEW
    const instants = ['2024-03-10T07:30:00Z', '2024-03-10T10:30:00Z', '2024-11-03T08:30:00Z', '2024-11-03T09:30:00Z', '2024-11-04T08:30:00Z']; // NEW
    const script = `const fs = require('node:fs'); const vm = require('node:vm'); // NEW
        vm.runInThisContext(fs.readFileSync(process.argv[1], 'utf8')); // NEW
        const c = globalThis.TrellisRoadmapCore; // NEW
        process.stdout.write(JSON.stringify(JSON.parse(process.argv[2]).map(s => [c.formatDay(c.todayDay(new Date(s))), c.parseDay('2024-02-29')])));`; // NEW
    const expectations = { // NEW
        UTC: ['2024-03-10', '2024-03-10', '2024-11-03', '2024-11-03', '2024-11-04'], // NEW
        'America/Los_Angeles': ['2024-03-09', '2024-03-10', '2024-11-03', '2024-11-03', '2024-11-04'], // NEW
        'Pacific/Kiritimati': ['2024-03-10', '2024-03-11', '2024-11-03', '2024-11-03', '2024-11-04'] // NEW
    }; // NEW
    for (const [timezone, expected] of Object.entries(expectations)) { // NEW
        const child = spawnSync(process.execPath, ['-e', script, PLUGIN_PATH, JSON.stringify(instants)], { env: { ...process.env, TZ: timezone }, encoding: 'utf8', timeout: 10000 }); // NEW
        assert.equal(child.status, 0, child.stderr || String(child.error)); // NEW
        const values = JSON.parse(child.stdout); // NEW
        assert.deepEqual(values.map(value => value[0]), expected, timezone); // NEW
        assert.ok(values.every(value => value[1] === core.parseDay('2024-02-29'))); // NEW
    } // NEW
    const before = core.todayDay(new Date()); // NEW
    const today = core.todayDay(); // NEW
    const after = core.todayDay(new Date()); // NEW
    assert.ok(today === before || today === after); // NEW
    assert.throws(() => core.todayDay(new Date(NaN)), TypeError); // NEW
    assert.throws(() => core.todayDay('2024-01-01'), TypeError); // NEW
}); // NEW
 // NEW
test('view normalization independently defaults and clamps each perspective without mutation', () => { // NEW
    const defaults = { scales: Array(8).fill(4), multiplier: 1, leftHidden: 0, rightHidden: 0 }; // NEW
    for (const value of [undefined, null, false, 'bad', []]) { // NEW
        assert.deepEqual(core.normalizeView(value), { perspective: 'today', today: defaults, inception: defaults }); // NEW
    } // NEW
    const input = freezeDeep({ perspective: 'inception', today: { scales: [1, 0, -1, Infinity, NaN, '2', 0.5, 8, 9], multiplier: 2, leftHidden: 99, rightHidden: -1 }, inception: { scales: [9], multiplier: 0, leftHidden: 2.9, rightHidden: 99 } }); // NEW
    const view = core.normalizeView(input); // NEW
    assert.deepEqual(view.today, { scales: [1, 4, 4, 4, 4, 4, 0.5, 8], multiplier: 2, leftHidden: 3, rightHidden: 0 }); // NEW
    assert.deepEqual(view.inception, { scales: [9, 4, 4, 4, 4, 4, 4, 4], multiplier: 1, leftHidden: 2, rightHidden: 4 }); // NEW
    view.today.scales[0] = 100; // NEW
    assert.equal(view.inception.scales[0], 9); // NEW
    assert.equal(input.today.scales[0], 1); // NEW
    assert.equal(core.normalizeView({ perspective: 'unknown' }).perspective, 'today'); // NEW
}); // NEW
 // NEW
test('timeline uses exact half-open boundaries, stable labels, and pixels per day', () => { // NEW
    const timeline = core.buildTimeline({ anchor: ANCHOR }); // NEW
    assert.deepEqual(timeline.columns.map(column => column.start - ANCHOR), [-365, -30, -7, 0, 7, 14, 30, 365]); // NEW
    assert.deepEqual(timeline.columns.map(column => column.end - ANCHOR), [-30, -7, 0, 7, 14, 30, 365, 730]); // NEW
    assert.deepEqual(timeline.columns.map(column => column.label), ['Past Year', 'Past Month', 'Past Week', 'This Week', 'Next Week', 'Next Month', 'Next Year', 'Future']); // NEW
    assert.deepEqual(timeline.columns.map(column => column.key), ['pastYear', 'pastMonth', 'pastWeek', 'thisWeek', 'nextWeek', 'nextMonth', 'nextYear', 'future']); // NEW
    assert.deepEqual(timeline.columns.map(column => column.tickStep), [30, 7, 1, 1, 1, 7, 30, 30]); // NEW
    assert.equal(timeline.anchor, ANCHOR); // NEW
    assert.equal(timeline.width, 1095 * 4); // NEW
    assert.equal(core.dayToX(timeline, ANCHOR), 365 * 4); // NEW
    for (const column of timeline.columns) { // NEW
        assert.equal(column.scale, 4); // NEW
        assert.equal(column.visible, true); // NEW
        assert.equal(column.width, (column.end - column.start) * 4); // NEW
        assert.equal(core.dayToX(timeline, column.start), column.x); // NEW
        assert.equal(core.dayToX(timeline, column.end), column.x + column.width); // NEW
    } // NEW
}); // NEW
 // NEW
test('outer ranges expand inclusively without moving inner boundaries or shrinking defaults', () => { // NEW
    const base = core.buildTimeline({ anchor: ANCHOR, minDay: ANCHOR, maxDay: ANCHOR }); // NEW
    const expanded = core.buildTimeline({ anchor: core.formatDay(ANCHOR), minDay: ANCHOR - 1000, maxDay: ANCHOR + 1500 }); // NEW
    assert.equal(expanded.start, ANCHOR - 1000); // NEW
    assert.equal(expanded.end, ANCHOR + 1501); // NEW
    assert.deepEqual(expanded.columns.slice(1, 7), base.columns.slice(1, 7).map(column => ({ ...column, x: column.x + 635 * 4 }))); // NEW
    assert.equal(core.buildTimeline({ anchor: ANCHOR, maxDay: ANCHOR + 730 }).end, ANCHOR + 731); // NEW
    assert.throws(() => core.buildTimeline({ anchor: '2024-02-30' }), TypeError); // NEW
    assert.throws(() => core.buildTimeline({ anchor: ANCHOR, minDay: 2, maxDay: 1 }), RangeError); // NEW
    assert.throws(() => core.buildTimeline({ anchor: Number.MAX_SAFE_INTEGER }), RangeError); // NEW
    assert.throws(() => core.buildTimeline({ anchor: ANCHOR, view: { multiplier: Number.MAX_VALUE } }), RangeError); // NEW
    assert.throws(() => core.buildTimeline({ anchor: ANCHOR, view: { multiplier: Number.MIN_VALUE } }), RangeError); // NEW
}); // NEW
 // NEW
test('all trim combinations preserve This Week, contiguous x, inverse conversion, and extrapolation', () => { // NEW
    for (let leftHidden = 0; leftHidden <= 3; leftHidden++) { // NEW
        for (let rightHidden = 0; rightHidden <= 4; rightHidden++) { // NEW
            const timeline = core.buildTimeline({ anchor: ANCHOR, minDay: ANCHOR - 900, maxDay: ANCHOR + 1200, view: { scales: [0.25, 0.5, 2, 7, 3, 1.5, 0.2, 0.1], multiplier: 1.3, leftHidden, rightHidden } }); // NEW
            const active = timeline.columns.filter(column => column.visible); // NEW
            assert.deepEqual(timeline.columns.map(column => column.tickStep), [30, 7, 1, 1, 1, 7, 30, 30]); // NEW
            assert.equal(active.length, 8 - leftHidden - rightHidden); // NEW
            assert.ok(timeline.columns[3].visible); // NEW
            assert.equal(active[0].x, 0); // NEW
            assert.equal(timeline.start, active[0].start); // NEW
            assert.equal(timeline.end, active.at(-1).end); // NEW
            assert.ok(timeline.columns.filter(column => !column.visible).every(column => column.width === 0)); // NEW
            let cursor = 0; // NEW
            for (const column of active) { // NEW
                near(column.x, cursor); // NEW
                for (const day of [column.start, column.start + 0.125, (column.start + column.end) / 2, column.end - 0.001, column.end]) { // NEW
                    near(core.xToDay(timeline, core.dayToX(timeline, day)), day, 1e-12); // NEW
                } // NEW
                cursor += column.width; // NEW
            } // NEW
            near(cursor, timeline.width); // NEW
            near(core.dayToX(timeline, timeline.start - 10), -10 * active[0].scale); // NEW
            near(core.dayToX(timeline, timeline.end + 10), timeline.width + 10 * active.at(-1).scale); // NEW
            for (const x of [-10000, -0.5, 0, timeline.width / 3, timeline.width, timeline.width + 10000]) { // NEW
                near(core.dayToX(timeline, core.xToDay(timeline, x)), x); // NEW
            } // NEW
        } // NEW
    } // NEW
}); // NEW
 // NEW
test('full view selects inception settings while the caller controls anchor', () => { // NEW
    const view = freezeDeep({ perspective: 'inception', today: { multiplier: 10 }, inception: { scales: Array(8).fill(2), multiplier: 3, leftHidden: 3, rightHidden: 4 } }); // NEW
    const timeline = core.buildTimeline({ anchor: ANCHOR, view }); // NEW
    assert.equal(timeline.start, ANCHOR); // NEW
    assert.equal(timeline.end, ANCHOR + 7); // NEW
    assert.equal(timeline.width, 42); // NEW
    assert.equal(timeline.columns[3].scale, 6); // NEW
    assert.throws(() => core.dayToX(timeline, NaN), TypeError); // NEW
    assert.throws(() => core.xToDay(timeline, Infinity), TypeError); // NEW
    assert.throws(() => core.dayToX({ columns: [] }, 0), RangeError); // NEW
}); // NEW
 // NEW
test('packing is deterministic, inclusive, first-available, and uses final row heights', () => { // NEW
    const items = freezeDeep([{ id: 'd', start: 3, end: 4, height: 60 }, { id: 'b', start: 1, end: 2, height: 40 }, { id: 'c', start: 2, end: 2 }, { id: 'a', start: 1, end: 1, height: 10 }]); // NEW
    const packed = core.packIntervals(items); // NEW
    assert.deepEqual(packed.rows.map(row => row.items.map(item => item.id)), [['a', 'c', 'd'], ['b']]); // NEW
    assert.deepEqual(packed.rows.map(row => row.height), [60, 40]); // NEW
    assert.deepEqual(packed.placements.get('a'), { row: 0, y: 0 }); // NEW
    assert.deepEqual(packed.placements.get('b'), { row: 1, y: 68 }); // NEW
    assert.equal(packed.height, 108); // NEW
    assert.deepEqual(core.packIntervals([...items].reverse()), packed); // NEW
    assert.equal(packed.rows[0].items[0], items[3]); // NEW
    assert.deepEqual(core.packIntervals([]), { rows: [], placements: new Map(), height: 0 }); // NEW
    assert.deepEqual(core.packIntervals([{ id: 2, start: 0, end: 0 }, { id: 1, start: 0, end: 0 }], { gap: 3, minRowHeight: 10 }).placements.get(2), { row: 1, y: 13 }); // NEW
    assert.equal(core.packIntervals([{ id: 'a', start: '2024-02-29', end: '2024-02-29' }, { id: 'b', start: '2024-03-01', end: '2024-03-01' }]).rows.length, 1); // NEW
    assert.equal(core.packIntervals([{ id: 'a', start: 0, end: 0, height: 0 }], { minRowHeight: 0, gap: 0 }).height, 0); // NEW
}); // NEW
 // NEW
test('packing rejects duplicate identities, malformed dates, and invalid dimensions', () => { // NEW
    assert.throws(() => core.packIntervals([{ id: 'a', start: 0, end: 0 }, { id: 'a', start: 2, end: 3 }]), /duplicate ID/); // NEW
    for (const item of [{ id: '' }, { id: {} }, { id: NaN }, { id: 'a', start: 1, end: 0 }, { id: 'a', start: 0.5, end: 1 }, { id: 'a', start: 0, end: 1, height: -1 }, { id: 'a', start: 0, end: Number.MAX_SAFE_INTEGER }, { id: 'a', start: 'bad', end: '2024-01-01' }]) { // NEW
        assert.throws(() => core.packIntervals([item])); // NEW
    } // NEW
    assert.throws(() => core.packIntervals([], { gap: -1 }), RangeError); // NEW
    assert.throws(() => core.packIntervals([], { minRowHeight: Infinity }), RangeError); // NEW
    assert.equal(core.packIntervals([{ id: 1, start: 0, end: 0 }, { id: '1', start: 0, end: 0 }]).placements.size, 2); // NEW
}); // NEW
 // NEW
test('progress weights inclusive durations and status policy without rewriting stored values', () => { // NEW
    const objects = freezeDeep([ // NEW
        { start: 0, end: 0, status: 'Planned', progress: 90 }, // NEW
        { start: 0, end: 1, status: 'Doing', progress: 40 }, // NEW
        { start: 0, end: 2, status: 'Blocked', progress: 20 }, // NEW
        { start: 0, end: 3, status: 'Done', progress: 0 } // NEW
    ]); // NEW
    assert.deepEqual(core.progressSummary(objects), { percent: 54, blockedCount: 1 }); // NEW
    assert.deepEqual(core.progressSummary([]), { percent: 0, blockedCount: 0 }); // NEW
    assert.deepEqual(core.progressSummary([{ start: '2024-02-28', end: '2024-03-01', status: 'Done' }, { start: '2024-03-02', end: '2024-03-02', status: 'Planned' }]), { percent: 75, blockedCount: 0 }); // NEW
    assert.equal(core.progressSummary([{ start: 0, end: 0, status: 'Doing', progress: 200 }]).percent, 100); // NEW
    assert.equal(core.progressSummary([{ start: 0, end: 0, status: 'Blocked', progress: NaN }]).percent, 0); // NEW
    assert.throws(() => core.progressSummary([{ start: 0, end: 0, status: 'doing' }]), /Unknown/); // NEW
    assert.throws(() => core.progressSummary([{ start: 2, end: 1, status: 'Done' }]), RangeError); // NEW
}); // NEW
 // NEW
test('every title-case transition preserves stored progress except Done and forbids Done to Blocked', () => { // NEW
    for (const status of ['Planned', 'Doing', 'Blocked', 'Done']) { // NEW
        for (const next of ['Planned', 'Doing', 'Blocked', 'Done']) { // NEW
            const input = freezeDeep({ status, progress: status === 'Done' ? 100 : 43.5 }); // NEW
            if (status === 'Done' && next === 'Blocked') { // NEW
                assert.throws(() => core.transitionStatus(input, next), /Done.*Blocked/); // NEW
            } else { // NEW
                assert.deepEqual(core.transitionStatus(input, next), { status: next, progress: status === 'Done' || next === 'Done' ? 100 : 43.5 }); // NEW
            } // NEW
        } // NEW
    } // NEW
    const planned = core.transitionStatus({ status: 'Doing', progress: 67 }, 'Planned'); // NEW
    assert.equal(core.progressSummary([{ ...planned, start: 0, end: 0 }]).percent, 0); // NEW
    assert.deepEqual(core.transitionStatus(planned, 'Doing'), { status: 'Doing', progress: 67 }); // NEW
    assert.deepEqual(core.transitionStatus({ status: 'Doing', progress: -5 }, 'Blocked'), { status: 'Blocked', progress: 0 }); // NEW
    assert.deepEqual(core.transitionStatus({ status: 'Done', progress: 12 }, 'Doing'), { status: 'Doing', progress: 100 }); // NEW
    assert.throws(() => core.transitionStatus({ status: 'Doing', progress: 12 }, 'done'), /Unknown/); // NEW
}); // NEW
 // NEW
test('layout uses board/process coordinate spaces, inclusive widths, and fixed dimensions', () => { // NEW
    const timeline = freezeDeep(core.buildTimeline({ anchor: ANCHOR, view: { leftHidden: 3, rightHidden: 4 } })); // NEW
    const processes = freezeDeep([{ id: 'p', start: ANCHOR, end: ANCHOR + 2, objects: [{ id: 'a', start: ANCHOR, end: ANCHOR, height: 900 }, { id: 'b', start: ANCHOR, end: ANCHOR + 1 }, { id: 'c', start: ANCHOR + 1, end: ANCHOR + 2 }] }, { id: 'empty', start: ANCHOR + 3, end: ANCHOR + 3, objects: [] }]); // NEW
    const layout = core.layoutRoadmap({ processes, timeline }); // NEW
    assert.deepEqual(layout.processes.get('p'), { x: 12, y: 76, width: 12, height: 112 }); // NEW
    assert.deepEqual(layout.objects.get('a'), { x: 0, y: 40, width: 4, height: 26 }); // NEW
    assert.deepEqual(layout.objects.get('b'), { x: 0, y: 74, width: 8, height: 26 }); // NEW
    assert.deepEqual(layout.objects.get('c'), { x: 4, y: 40, width: 8, height: 26 }); // NEW
    assert.deepEqual(layout.processes.get('empty'), { x: 24, y: 76, width: 4, height: 52 }); // NEW
    assert.equal(layout.width, 52); // NEW
    assert.equal(layout.height, 200); // NEW
    assert.deepEqual(core.layoutRoadmap({ processes: [], timeline }), { processes: new Map(), objects: new Map(), width: 52, height: 88 }); // NEW
}); // NEW
 // NEW
test('process packing is independent of input order and uses final heights of reused rows', () => { // NEW
    const timeline = core.buildTimeline({ anchor: 0 }); // NEW
    const processes = freezeDeep([ // NEW
        { id: 'd', start: 3, end: 3 }, // NEW
        { id: 'b', start: 0, end: 1, objects: [{ id: 'b1', start: 0, end: 1 }] }, // NEW
        { id: 'c', start: 1, end: 2, objects: [1, 2, 3].map(id => ({ id, start: 1, end: 2 })) }, // NEW
        { id: 'a', start: 0, end: 0 } // NEW
    ]); // NEW
    const layout = core.layoutRoadmap({ processes, timeline }); // NEW
    assert.equal(layout.processes.get('a').y, 76); // NEW
    assert.equal(layout.processes.get('c').y, 76); // NEW
    assert.equal(layout.processes.get('d').y, 76); // NEW
    assert.equal(layout.processes.get('c').height, 146); // NEW
    assert.equal(layout.processes.get('b').y, 230); // NEW
    assert.equal(layout.height, 320); // NEW
    assert.deepEqual(core.layoutRoadmap({ processes: [...processes].reverse(), timeline }), layout); // NEW
}); // NEW
 // NEW
test('layout expands parents to contain objects and preserves extrapolated trimmed dates', () => { // NEW
    const timeline = core.buildTimeline({ anchor: 0, view: { scales: [1, 2, 3, 4, 5, 6, 7, 8], leftHidden: 3, rightHidden: 4 } }); // NEW
    const layout = core.layoutRoadmap({ timeline, processes: [{ id: 'p', start: 1, end: 2, objects: [{ id: 'a', start: -2, end: 10 }] }] }); // NEW
    assert.deepEqual(layout.processes.get('p'), { x: 4, y: 76, width: 52, height: 78 }); // NEW
    assert.deepEqual(layout.objects.get('a'), { x: 0, y: 40, width: 52, height: 26 }); // NEW
    assert.equal(layout.width, 52); // NEW
    assert.throws(() => core.layoutRoadmap({ timeline, processes: [{ id: 'p', start: 0, end: 1, objects: {} }] }), /array/); // NEW
    assert.throws(() => core.layoutRoadmap({ timeline, processes: [{ id: 'p', start: 0, end: 1, objects: [{ id: 'a', start: 0, end: 0 }] }, { id: 'q', start: 0, end: 1, objects: [{ id: 'a', start: 0, end: 0 }] }] }), /duplicate ID/); // NEW
}); // NEW
 // NEW
test('50 processes / 500 objects and worst-case 500 overlapping intervals stay practical', () => { // NEW
    const timeline = core.buildTimeline({ anchor: ANCHOR, view: { scales: [0.5, 1, 2, 4, 6, 2, 1, 0.5] } }); // NEW
    const processes = Array.from({ length: 50 }, (_, p) => ({ id: `p${p}`, start: ANCHOR - 20 + p, end: ANCHOR + 30 + p, objects: Array.from({ length: 10 }, (_, i) => ({ id: `p${p}o${i}`, start: ANCHOR + p + i, end: ANCHOR + p + i + 3, status: i % 2 ? 'Doing' : 'Blocked', progress: 50 })) })); // NEW
    freezeDeep(processes); // NEW
    const started = performance.now(); // NEW
    const layout = core.layoutRoadmap({ processes, timeline }); // NEW
    const packed = core.packIntervals(Array.from({ length: 500 }, (_, id) => ({ id, start: 0, end: 1 }))); // NEW
    const elapsed = performance.now() - started; // NEW
    assert.equal(layout.processes.size, 50); // NEW
    assert.equal(layout.objects.size, 500); // NEW
    assert.equal(packed.rows.length, 500); // NEW
    assert.equal(packed.height, 500 * 26 + 499 * 8); // NEW
    assert.deepEqual(core.progressSummary(processes.flatMap(process => process.objects)), { percent: 50, blockedCount: 250 }); // NEW
    let previousBottom = 64; // NEW
    for (const process of processes) { // NEW
        const parent = layout.processes.get(process.id); // NEW
        assert.ok(parent.y >= previousBottom + 8); // NEW
        previousBottom = parent.y + parent.height; // NEW
        for (const object of process.objects) { // NEW
            const geometry = layout.objects.get(object.id); // NEW
            near(parent.x + geometry.x, 12 + core.dayToX(timeline, object.start)); // NEW
            near(geometry.width, core.dayToX(timeline, object.end + 1) - core.dayToX(timeline, object.start)); // NEW
            assert.ok(geometry.y >= 40 && geometry.y + geometry.height <= parent.height - 12); // NEW
        } // NEW
        for (let i = 0; i < process.objects.length; i++) { // NEW
            for (const other of process.objects.slice(i + 1)) { // NEW
                const object = process.objects[i]; // NEW
                if (object.start <= other.end && other.start <= object.end) { // NEW
                    assert.ok(Math.abs(layout.objects.get(object.id).y - layout.objects.get(other.id).y) >= 34); // NEW
                } // NEW
            } // NEW
        } // NEW
    } // NEW
    assert.equal(layout.height, previousBottom + 12); // NEW
    assert.ok(elapsed < 5000, `50/500 layout and worst-case packing took ${elapsed.toFixed(1)}ms`); // NEW
}); // NEW

/** Preferences change interval coloring without increasing its minimum row count. */ // NEW
test('preferred process rows remain compact, deterministic, and account for final heights', () => { // NEW
    const items = [{ id: 'a', start: 0, end: 10, height: 30, preferredRow: 1 }, { id: 'b', start: 0, end: 5, height: 70, preferredRow: 0 }, { id: 'c', start: 6, end: 9, height: 50, preferredRow: 99 }]; // NEW
    const result = core.packIntervals(items, { preferRows: true }); assert.equal(result.rows.length, 2); assert.equal(result.placements.get('a').row, 1); assert.equal(result.placements.get('b').row, 0); assert.equal(result.placements.get('c').row, 0); assert.equal(result.placements.get('a').y, 78); // NEW
    assert.deepEqual(core.packIntervals(items.slice().reverse(), { preferRows: true }), result); // NEW
}); // NEW

test('collision planning cascades without mutating inputs and rejects conflicting protected peers', () => { // NEW
    const items = [{ id: 'a', x: 0, y: 0, width: 100, height: 100, margin: 10 }, { id: 'b', x: 90, y: 0, width: 100, height: 100, margin: 10 }, { id: 'c', x: 195, y: 0, width: 100, height: 100, margin: 10 }], before = JSON.stringify(items); // NEW
    const result = core.planCollisions(items, { seedIds: ['a'], protectedIds: ['a'] }); assert.equal(result.get('b').x, 110); assert.equal(result.get('c').x, 220); assert.equal(JSON.stringify(items), before); // NEW
    assert.throws(() => core.planCollisions(items, { seedIds: ['a'], protectedIds: ['a', 'b'] }), /overlap/); // NEW
}); // NEW

test('collision shrink follows the neighboring-module proximity rule', () => { // NEW
    const items = [{ id: 'a', x: 0, y: 0, width: 80, height: 100, margin: 10 }, { id: 'b', x: 110, y: 0, width: 100, height: 100, margin: 10 }]; // NEW
    const result = core.planCollisions(items, { seedIds: ['a'], previous: new Map([['a', { x: 0, y: 0, width: 100, height: 100 }]]) }); assert.equal(result.get('b').x, 90); // NEW
}); // NEW
