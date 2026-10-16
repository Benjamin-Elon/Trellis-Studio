const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const vm = require('node:vm'); // NEW
const test = require('node:test'); // NEW
const { loadPlantTilerMxGraph } = require('./helpers/plant-tiler-mxgraph-harness.cjs'); // NEW
const { loadSchedulerHooks, makePlant, makeCity } = require('./helpers/garden-scheduler-harness.cjs'); // NEW
const plugins = path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins'); // NEW
const coreSource = fs.readFileSync(path.join(plugins, 'Garden_Scheduler_Shared_Core.js'), 'utf8'); // NEW
const sandbox = { window: {} }; vm.runInNewContext(coreSource, sandbox); // NEW
const core = sandbox.window.USL.scheduler.sharedCore; // NEW
const annual = { sow_date: '2026-01-01', germ_date: '2026-01-11', harvest_start: '2026-01-31', harvest_end: '2026-02-10', method_id: 'direct_sow.field' }; // NEW
const estimate = (date, attrs = annual, context = {}) => core.calculatePlantGrowthState(attrs, context, date); // NEW

test('annual stage boundaries reset percentages and harvest end is exclusive', () => { // NEW
    for (const [date, stage, percentage] of [['2025-12-31', 'planned', null], ['2026-01-01', 'seed', 0], ['2026-01-06', 'seed', 50], ['2026-01-11', 'growing', 0], ['2026-01-31', 'harvest', 0], ['2026-02-05', 'harvest', 50], ['2026-02-10', 'complete', null]]) { // NEW
        const state = estimate(date); assert.equal(state.stage, stage); assert.equal(state.percentage, percentage); // NEW
    } // NEW
    assert.equal(estimate('2026-02-05').areaRatio, 1); assert.equal(estimate('2026-02-20').areaRatio, 1); // NEW
}); // NEW

test('GDD drives linear area, pauses in cold periods and normalizes to the saved harvest date', () => { // NEW
    const rates = {}; for (let day = 11; day < 31; day++) rates['2026-01-' + day] = day < 21 ? 0 : 10; // NEW
    assert.equal(estimate('2026-01-21', annual, { dailyRates: rates }).percentage, 0); // NEW
    const halfway = estimate('2026-01-26', annual, { dailyRates: rates }); // NEW
    assert.equal(halfway.percentage, 50); assert.equal(halfway.areaRatio, 0.505); assert.equal(halfway.basis, 'scheduled climate GDD'); // NEW
    assert.ok(Math.abs(Math.sqrt(halfway.areaRatio) - 0.71063352) < 1e-7); // NEW
    assert.equal(estimate('2026-01-31', annual, { dailyRates: rates }).areaRatio, 1); // NEW
}); // NEW

test('missing, incomplete and zero GDD use explicit date fallbacks; missing germination skips seed', () => { // NEW
    for (const dailyRates of [undefined, {}, { 1: 0 }, { '2026-01-11': 10 }]) { // NEW
        const state = estimate('2026-01-21', annual, { dailyRates }); assert.equal(state.percentage, 50); assert.match(state.reason, /using elapsed stage days/); // NEW
    } // NEW
    const state = estimate('2026-01-16', { ...annual, germ_date: '' }); // NEW
    assert.equal(state.stage, 'growing'); assert.equal(state.percentage, 50); assert.match(state.reason, /Germination date unavailable/); // NEW
}); // NEW

test('invalid calendars and date ordering retain target size; zero-length stages are skipped', () => { // NEW
    for (const patch of [{ sow_date: '2026-02-30' }, { germ_date: '2025-12-31' }, { harvest_end: '2026-01-20' }, { harvest_start: '' }]) { // NEW
        const state = estimate('2026-01-21', { ...annual, ...patch }); assert.equal(state.stage, 'unavailable'); assert.equal(state.areaRatio, 1); // NEW
    } // NEW
    assert.equal(estimate('2026-01-01', { ...annual, germ_date: annual.sow_date }).stage, 'growing'); // NEW
    assert.equal(estimate('2026-01-31', { ...annual, harvest_end: annual.harvest_start }).stage, 'complete'); // NEW
}); // NEW

test('cross-year GDD and rounded active percentages stay bounded', () => { // NEW
    const attrs = { ...annual, sow_date: '2025-12-01', germ_date: '2025-12-11', harvest_start: '2026-01-20' }; // NEW
    const state = estimate('2025-12-31', attrs, { dailyRates: { 12: 10, 1: 10 } }); assert.equal(state.percentage, 50); // NEW
    const earlyHeat = estimate('2026-01-30', annual, { dailyRates: { 1: 0, '2026-01-11': 100 } }); // NEW
    assert.equal(earlyHeat.percentage, 99); assert.equal(earlyHeat.areaRatio, 1); // NEW
}); // NEW

test('purchased transplant age advances growth and never shows a seed stage', () => { // NEW
    const attrs = { ...annual, method_id: 'transplant.purchased', sow_date: '2026-01-11', transplant_date: '2026-01-11', germ_date: '2026-01-15' }; // NEW
    const state = estimate('2026-01-11', attrs, { daysTransplant: 15, daysGerm: 5, dailyRates: { 1: 10 } }); // NEW
    assert.equal(state.stage, 'growing'); assert.equal(state.percentage, 33); assert.match(state.reason, /Nursery age/); // NEW
    assert.equal(estimate('2026-01-11', attrs).percentage, 0); // NEW
    assert.equal(estimate('2026-01-10', attrs, { daysTransplant: 15 }).stage, 'planned'); // NEW
}); // NEW

test('perennial establishment applies the S-curve to area and retains established size', () => { // NEW
    const attrs = { perennial: '1', lifespan_start: '2026-01-01', days_maturity: '100' }; // NEW
    assert.equal(estimate('2025-12-31', attrs).stage, 'planned'); // NEW
    const quarter = estimate('2026-01-26', attrs); assert.equal(quarter.percentage, 25); assert.equal(quarter.areaRatio, 0.01 + 0.99 * 0.15625); // NEW
    assert.equal(estimate('2026-02-20', attrs).areaRatio, 0.505); // NEW
    assert.equal(estimate('2026-04-11', attrs).stage, 'established'); assert.equal(estimate('2027-01-01', attrs).areaRatio, 1); // NEW
    assert.equal(estimate('2026-01-26', { ...attrs, days_maturity: '' }, { daysMaturity: 100 }).percentage, 25); // NEW
    assert.equal(estimate('2026-01-26', { ...attrs, days_maturity: '' }).stage, 'unavailable'); // NEW
}); // NEW

/** Render actual production cells at a deterministic local date, with real SVG and Undo tracking. */ // NEW
function fixture() { // NEW
    const h = loadPlantTilerMxGraph(), NativeDate = h.window.Date; // NEW
    h.window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [2026, 0, 21, 12])); } }; // NEW
    h.window.eval(coreSource); // NEW
    h.value = attrs => { const value = h.window.mxUtils.createXmlDocument().createElement('object'); Object.entries(attrs).forEach(([name, valueText]) => value.setAttribute(name, valueText)); return value; }; // NEW
    h.group = (id, parent = h.moduleCell, attrs = {}) => { // NEW
        const group = h.graph.insertVertex(parent, id, h.value({ ...annual, tiler_group: '1', label: 'Radish', plant_abbr: 'RAD', spacing_cm: '40', veg_diameter_cm: '40', ...attrs }), 200, 200, 200, 130, 'verticalAlign=top;'); // NEW
        h.tiler.retileGroup(h.graph, group); return group; // NEW
    }; // NEW
    h.serialize = () => h.window.mxUtils.getXml(new h.window.mxCodec().encode(h.graph.model)); // NEW
    h.growth = h.graph.__trellisPlantingGroup.growth; // NEW
    h.ellipses = cell => Array.from(h.graph.view.getState(cell).shape.node.querySelectorAll('ellipse')).filter(node => node.getAttribute('visibility') !== 'hidden'); // NEW: exclude mxGraph's transparent stroke hit region.
    return h; // NEW
} // NEW

test('garden checkbox controls dashed outlines regardless of selection while preserving solid growth circles and model state', () => { // CHANGE
    const h = fixture(); // NEW
    try { // NEW
        const group = h.group('first'), sibling = h.group('sibling'), otherGarden = h.graph.insertVertex(null, 'other-garden', h.value({ garden_module: '1' }), 600, 0, 1000, 1000), other = h.group('second', otherGarden); // CHANGE
        const tile = h.graph.getChildVertices(group).find(cell => cell.getAttribute('plant_tiler') === '1'), siblingTile = h.graph.getChildVertices(sibling)[0], otherTile = h.graph.getChildVertices(other)[0]; // CHANGE
        h.graph.clearSelection(); h.growth.refresh(); h.undoManager.clear(); const before = h.serialize(); // NEW
        const state = h.graph.view.getState(tile), ellipse = h.ellipses(tile)[0]; // NEW
        assert.ok(Math.abs(Number(ellipse.getAttribute('rx')) * 2 / state.width - Math.sqrt(0.505)) < 0.002); // NEW
        assert.equal(Number(ellipse.getAttribute('cx')), state.x + state.width / 2); // NEW
        assert.equal(h.window.document.querySelector('[data-trellis-growth-badge="first"]').textContent, '50%'); // NEW
        assert.equal(h.ellipses(tile).length, 1); // CHANGE: unchecked and unselected has only the current-growth circle.
        h.graph.setSelectionCell(group); h.growth.refresh(); assert.equal(h.ellipses(tile).length, 1); // CHANGE
        h.graph.setSelectionCell(tile); h.growth.refresh(); assert.equal(h.ellipses(tile).length, 1); assert.equal(h.ellipses(otherTile).length, 1); // CHANGE
        assert.match(h.window.document.querySelector('[data-trellis-growth-details="first"]').textContent, /Growing · 50%/); // NEW
        h.graph.setSelectionCells([tile, other]); h.growth.refresh(); assert.equal(h.ellipses(tile).length, 1); assert.equal(h.ellipses(otherTile).length, 1); // CHANGE
        h.growth.setShowHarvestSize(h.moduleCell, true); h.growth.refresh(); // CHANGE: checked applies to every group in this garden even with a mixed selection.
        assert.equal(h.ellipses(tile).length, 2); assert.equal(h.ellipses(otherTile).length, 1); // NEW
        assert.equal(h.ellipses(siblingTile).length, 2); // CHANGE
        const blue = h.ellipses(tile).find(node => node.getAttribute('stroke') === '#2563eb'), black = h.ellipses(tile).find(node => node.getAttribute('stroke') === '#111827'); // CHANGE
        assert.ok(blue.getAttribute('stroke-dasharray')); assert.equal(black.getAttribute('stroke-dasharray'), null); // CHANGE
        const blackDiameter = Number(black.getAttribute('rx')) * 2, dashPattern = blue.getAttribute('stroke-dasharray'); // CHANGE
        h.growth.setShowHarvestSize(h.moduleCell, false); h.growth.refresh(); // CHANGE
        assert.equal(h.ellipses(tile).length, 1); assert.equal(h.ellipses(siblingTile).length, 1); // CHANGE
        assert.equal(Number(h.ellipses(tile)[0].getAttribute('rx')) * 2, blackDiameter); // CHANGE: unchecking preserves current growth size.
        h.growth.setShowHarvestSize(h.moduleCell, true); h.graph.clearSelection(); h.growth.refresh(); // CHANGE
        assert.equal(h.growth.getShowHarvestSize(otherGarden), false); // NEW
        h.graph.view.setScale(0.5); h.graph.view.setTranslate(10, 20); h.growth.refresh(); // NEW
        assert.equal(h.ellipses(tile).find(node => node.getAttribute('stroke') === '#2563eb').getAttribute('stroke-dasharray'), dashPattern); // CHANGE: screen-size dashes remain stable through zoom.
        assert.equal(h.ellipses(tile).find(node => node.getAttribute('stroke') === '#111827').getAttribute('stroke-dasharray'), null); // CHANGE
        assert.equal(h.serialize(), before); assert.equal(h.undoManager.history.length, 0); // NEW
        h.graph.removeCells([group]); h.growth.refresh(); assert.equal(h.window.document.querySelector('[data-trellis-growth-badge="first"]'), null); // NEW
    } finally { h.close(); } // NEW
}); // NEW

test('small markers stay visible, collapsed groups do not expand, hidden badges disappear and disposal cleans up', () => { // NEW
    const h = fixture(); // NEW
    try { // NEW
        const group = h.group('young', h.moduleCell, { germ_date: '2026-01-25' }); h.graph.view.setScale(0.25); h.growth.refresh(); // NEW
        const tile = h.graph.getChildVertices(group).find(cell => cell.getAttribute('plant_tiler') === '1'); // NEW
        assert.equal(Number(h.ellipses(tile)[0].getAttribute('rx')) * 2, 4); // NEW
        assert.equal(h.graph.view.getState(tile).text.node.style.visibility, 'hidden'); // NEW
        h.tiler.setPlantingGroupDetail(group, false); const count = h.graph.getChildVertices(group).length; h.growth.refresh(); // NEW
        assert.equal(h.graph.getChildVertices(group).length, count); assert.ok(h.window.document.querySelector('[data-trellis-growth-badge="young"]')); // NEW
        h.graph.model.setVisible(group, false); h.growth.refresh(); assert.equal(h.window.document.querySelector('[data-trellis-growth-badge="young"]').style.display, 'none'); // NEW
        h.growth.dispose(); assert.equal(h.window.document.querySelectorAll('[data-trellis-growth-badge]').length, 0); // NEW
    } finally { h.close(); } // NEW
}); // NEW

test('export canvas retains target diameter and native labels while the live DOM shows growth', () => { // NEW
    const h = fixture(); // NEW
    try { // NEW
        const group = h.group('export'); h.graph.setSelectionCell(group); h.growth.setShowHarvestSize(h.moduleCell, true); h.growth.refresh(); // CHANGE: exercise export exclusion while dashed outlines are visible.
        const tile = h.graph.getChildVertices(group).find(cell => cell.getAttribute('plant_tiler') === '1'), state = h.graph.view.getState(tile); // NEW
        const svg = h.window.document.createElementNS('http://www.w3.org/2000/svg', 'svg'), canvas = new h.window.mxSvgCanvas2D(svg); // NEW
        state.shape.paint(canvas); const ellipse = svg.querySelector('ellipse[stroke="#111827"]'); // NEW
        assert.ok(h.ellipses(tile).find(node => node.getAttribute('stroke') === '#2563eb').getAttribute('stroke-dasharray')); // CHANGE
        assert.equal(svg.querySelector('ellipse[stroke="#2563eb"]'), null); // NEW
        assert.equal(ellipse.getAttribute('stroke-dasharray'), null); // CHANGE
        assert.ok(Math.abs(Number(ellipse.getAttribute('rx')) * 2 - state.width) < 0.001); // NEW
        assert.equal(state.text.scale, state.view.scale); assert.match(state.text.node.style.transform, /^scale\(/); // NEW
        assert.equal(state.text.value, 'RAD'); // NEW
    } finally { h.close(); } // NEW
}); // NEW

for (const html of [0, 1]) test(`bed previews defer asynchronous growth rendering and resume ${html ? 'HTML' : 'SVG'} labels after cancellation`, async () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        const bed = h.bed(400, 300), group = h.group('preview', h.moduleCell, { bed_auto_fit: '0' }); // CHANGE
        const otherGarden = h.graph.insertVertex(null, 'other-garden', h.value({ garden_module: '1' }), 900, 0, 1000, 1000); // CHANGE
        const other = h.group('outside', otherGarden), tile = h.graph.getChildVertices(group)[0], otherTile = h.graph.getChildVertices(other)[0]; // CHANGE
        h.graph.setCellStyles('html', String(html), [tile]); h.graph.refresh(); // CHANGE
        const state = h.graph.view.getState(tile), nodes = [state.shape.node, state.text.node], visibility = nodes.map(node => node.style.visibility); // CHANGE
        const radius = cell => Number(h.ellipses(cell).find(node => node.getAttribute('stroke') === '#111827').getAttribute('rx')); // CHANGE
        const originalRadius = radius(tile), otherRadius = radius(otherTile), requests = new Map(); // CHANGE
        h.window.USL.scheduler.resolvePlantGrowthContext = cell => new Promise(resolve => requests.set(cell, resolve)); // CHANGE
        h.undoManager.clear(); const before = h.serialize(); // CHANGE
        h.growth.scheduleRefresh(); // CHANGE: exercise a refresh queued before any originals are suppressed.
        const preview = h.graph.__trellisBedTransforms.createPreview([bed], [group]); preview.update(() => ({ delta: 37 })); // CHANGE
        h.growth.refresh(); await Promise.resolve(); await Promise.resolve(); // CHANGE: begin climate requests while visual updates are suspended.
        const dailyRates = {}; for (let day = 11; day <= 30; day++) dailyRates['2026-01-' + day] = day < 21 ? 10 : 0; // CHANGE
        requests.get(group)({ dailyRates }); requests.get(other)({ dailyRates }); // CHANGE: all stage heat arrives before today, advancing both estimates to full size.
        await new Promise(resolve => h.window.requestAnimationFrame(() => h.window.requestAnimationFrame(resolve))); // CHANGE
        h.growth.refresh(); h.growth.refresh(); // CHANGE: repeated late refreshes must preserve suppression and avoid caching hidden labels.
        assert.equal(h.growth.estimate(group).areaRatio, 1); assert.equal(radius(tile), originalRadius); assert.ok(radius(otherTile) > otherRadius); // CHANGE
        nodes.forEach(node => assert.equal(node.style.visibility, 'hidden')); // CHANGE
        assert.equal(h.window.document.querySelectorAll('[data-trellis-bed-preview-cell="' + tile.id + '"]').length, 0); // CHANGE
        assert.equal(h.serialize(), before); assert.equal(h.undoManager.history.length, 0); // CHANGE
        preview.clear(); preview.clear(); assert.deepEqual(nodes.map(node => node.style.visibility), visibility); // CHANGE: cancellation restores exact originals synchronously.
        assert.equal(radius(tile), originalRadius); // CHANGE: catch-up waits until the next frame rather than repainting during cleanup.
        await new Promise(resolve => h.window.requestAnimationFrame(resolve)); // CHANGE
        assert.ok(radius(tile) > originalRadius); assert.equal(state.text.node.style.visibility, visibility[1]); // CHANGE: resumed rendering did not retain preview-only hidden styles.
        assert.equal(h.graph.__trellisBedTransforms.isPreviewing(tile), false); // CHANGE
        state.text.node.style.visibility = 'hidden'; preview.clear(); assert.equal(state.text.node.style.visibility, 'hidden'); // CHANGE: late repeated cleanup cannot overwrite newer rendering state.
        assert.equal(h.serialize(), before); assert.equal(h.undoManager.history.length, 0); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('obsolete asynchronous climate results cannot overwrite changed groups', async () => { // NEW
    const h = fixture(); // NEW
    try { // NEW
        const requests = []; h.window.USL.scheduler.resolvePlantGrowthContext = () => new Promise(resolve => requests.push(resolve)); // NEW
        const group = h.group('async'); h.growth.refresh(); await Promise.resolve(); await Promise.resolve(); // NEW
        const next = group.value.cloneNode(true); next.setAttribute('harvest_start', '2026-02-10'); h.graph.model.setValue(group, next); h.growth.refresh(); await Promise.resolve(); await Promise.resolve(); // NEW
        requests[0]({ dailyRates: { 1: 10, 2: 10 } }); await new Promise(resolve => setTimeout(resolve, 0)); // NEW
        assert.equal(h.growth.estimate(group).percentage, 33); // NEW
        requests.at(-1)({ dailyRates: { 1: 10, 2: 10 } }); await new Promise(resolve => setTimeout(resolve, 0)); // NEW
        assert.equal(h.growth.estimate(group).percentage, 33); assert.equal(h.growth.estimate(group).basis, 'scheduled climate GDD'); // NEW
    } finally { h.close(); } // NEW
}); // NEW

test('perennial schedule persistence retains maturity days without adding harvest anchors', () => { // NEW
    const hooks = loadSchedulerHooks(), plant = makePlant(hooks, { annual: 0, perennial: 1, days_maturity: 365 }); // NEW
    const patch = hooks.buildScheduleAttributePatch({ plant, city: makeCity(hooks), seasonStartYear: 2026 }, { kind: 'perennial', schedule: [new Date('2026-01-01T00:00:00Z')], timelines: [{}], lifespanStartISO: '2026-01-01', lifespanEndISO: '2036-01-01' }); // NEW
    assert.equal(patch.days_maturity, '365'); assert.equal(patch.harvest_start, ''); assert.equal(patch.harvest_end, ''); // NEW
}); // NEW

test('growth context uses effective variety defaults and shared climate without database writes or repeated climate queries', async () => { // NEW
    const plantRow = { plant_id: 1, plant_name: 'Test', annual: 1, days_maturity: 100, days_transplant: 20, days_germ: 5, tbase_c: 5, tmin_c: 0, topt_low_c: 15, topt_high_c: 25, tmax_c: 40 }; // NEW
    const cityRow = { city_id: 2, city_name: 'Test City' }; for (let month = 1; month <= 12; month++) { cityRow['avg_monthly_high_c' + month] = 22; cityRow['avg_monthly_low_c' + month] = 18; } // NEW
    const queries = [], opens = []; // NEW
    const dbBridge = { resolvePath: async () => ({ dbPath: 'growth' }), open: async (_path, options) => { opens.push(options); return { dbId: 'growth' }; }, close: async () => {}, exec: async () => { throw new Error('Visual reads must not write'); }, query: async (_id, sql) => { // NEW
        queries.push(sql); const rows = /FROM Plants\b/.test(sql) ? [plantRow] : /FROM PlantVarieties\b/.test(sql) ? [{ variety_id: 3, plant_id: 1, overrides_json: JSON.stringify({ days_maturity: 120, days_transplant: 30 }) }] : /FROM Cities\b/.test(sql) ? [cityRow] : []; return { rows }; // NEW
    } }; // NEW
    const model = { getParent: cell => cell.parent || null, getGeometry: () => null }, hooks = loadSchedulerHooks({ dbBridge, graph: { getModel: () => model } }); // NEW
    const value = attrs => { const node = hooks.__testWindow.document.createElement('object'); Object.entries(attrs).forEach(([key, item]) => node.setAttribute(key, item)); return node; }; // NEW
    const module = { value: value({ garden_module: '1', city_id: '2' }), getAttribute(name) { return this.value.getAttribute(name); } }; // NEW
    const cell = { parent: module, value: value({ ...annual, plant_id: '1', variety_id: '3', city_id: '2', tbase_c: '5' }), getAttribute(name) { return this.value.getAttribute(name); } }; // NEW
    const resolver = hooks.__testWindow.USL.scheduler.resolvePlantGrowthContext; // NEW
    const first = await resolver(cell, '2026-01-21'), queryCount = queries.length; const second = await resolver(cell, '2026-01-21'); // NEW
    assert.equal(first.daysTransplant, 30); assert.equal(first.daysMaturity, 120); assert.ok(first.dailyRates['2026-01-21'] > 0); // NEW
    assert.equal(queries.length, queryCount); assert.equal(first.dailyRates['2026-01-21'], second.dailyRates['2026-01-21']); // NEW
    assert.ok(opens.every(options => options.readOnly === true)); // NEW
    const legacy = { ...cell, value: value({ perennial: '1', plant_id: '1', variety_id: '3', lifespan_start: '2026-01-01' }) }; // NEW
    assert.equal((await resolver(legacy, '2026-01-21')).daysMaturity, 120); // NEW
}); // NEW
