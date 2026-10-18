const fs = require('node:fs'); // CHANGE
const path = require('node:path'); // CHANGE
const assert = require('node:assert/strict'); // CHANGE
const { loadPlantTilerMxGraph } = require('./plant-tiler-mxgraph-harness.cjs'); // CHANGE
const { loadSchedulerHooks, makeCity, makePlant } = require('./garden-scheduler-harness.cjs'); // CHANGE

/** Real navigator, graph, and scheduler dialogs sharing controllable reference-data queries. */ // CHANGE
function createSchedulerOverlapFixture(t, options = {}) { // CHANGE
    const h = loadPlantTilerMxGraph(); // CHANGE
    const state = { relationships: [{ relation_id: 12, source_plant_id: 1, companion_plant_id: 2, rating: 1 }], writes: [], lookups: [], lookup: null, taskCalls: 0 }; // CHANGE
    const methods = [ // CHANGE
        { method_id: 'direct_sow.field', method_category_id: 'direct_sow', method_name: 'Field direct sow', tasks_required_json: '{}' }, // CHANGE
        { method_id: 'transplant.indoor', method_category_id: 'transplant', method_name: 'Indoor transplant', tasks_required_json: '{}' } // CHANGE
    ]; // CHANGE
    let plants, city, dialog, onClose; // CHANGE
    const dbBridge = { // CHANGE
        resolvePath: async () => ({ dbPath: 'overlap-fixture' }), open: async () => ({ dbId: 'overlap-fixture' }), close: async () => ({}), // CHANGE
        exec: async (_id, sql, params = []) => { state.writes.push({ sql, params }); return {}; }, // CHANGE
        query: async (_id, sql, params = []) => { // CHANGE
            let rows = []; // CHANGE
            if (/FROM\s+Plants\b/i.test(sql)) rows = /WHERE plant_id =/i.test(sql) ? plants.filter(plant => Number(plant.plant_id) === Number(params[0])) : plants; // CHANGE
            else if (/FROM\s+Cities\b/i.test(sql)) rows = [city]; // CHANGE
            else if (/FROM\s+PlantAllowedMethodCategories\b/i.test(sql)) rows = methods.map(method => ({ plant_id: params[0] || 1, method_category_id: method.method_category_id, method_category_name: method.method_category_id })); // CHANGE
            else if (/FROM\s+PlantingMethods\b/i.test(sql)) rows = params.length ? methods.filter(method => params.includes(method.method_category_id) || params.includes(method.method_id)) : methods; // CHANGE
            else if (/FROM Companions c/i.test(sql)) { // CHANGE
                state.lookups.push(Number(params[0])); // CHANGE
                rows = state.lookup ? await state.lookup(Number(params[0])) : state.relationships.filter(row => [Number(row.source_plant_id), Number(row.companion_plant_id)].includes(Number(params[0]))); // CHANGE
            } // CHANGE
            return { rows }; // CHANGE
        } // CHANGE
    }; // CHANGE
    const api = loadSchedulerHooks({ graph: h.graph, dbBridge, globals: { mxCellAttributeChange: h.window.mxCellAttributeChange, mxGeometry: h.window.mxGeometry } }); // CHANGE
    plants = [[1, 'Radish'], [2, 'Basil'], [3, 'Lettuce'], [4, 'Fennel'], [5, 'Carrot']].map(([plant_id, plant_name]) => makePlant(api, { plant_id, plant_name, spacing_cm: 30, days_maturity: 24, default_planting_method: methods[0].method_id, default_planting_method_category: methods[0].method_category_id })); // CHANGE
    city = Object.assign(makeCity(api), { city_id: 1, city_name: 'Test City' }); // CHANGE
    h.moduleCell.setAttribute('city_id', '1'); h.moduleCell.setAttribute('city_name', city.city_name); // CHANGE
    const bed = h.bed(300, 300); // CHANGE
    function planting(id, attrs = {}, x = 210, y = 210) { // CHANGE
        const node = h.window.mxUtils.createXmlDocument().createElement('object'); // CHANGE
        Object.entries({ tiler_group: '1', plant_id: '2', plant_name: 'Basil', sow_date: '2026-10-01', harvest_end: '2027-03-01', season_start_year: '2026', ...attrs }).forEach(([key, value]) => node.setAttribute(key, value)); // CHANGE
        return h.graph.insertVertex(h.moduleCell, id, node, x, y, 80, 100); // CHANGE
    } // CHANGE
    const crop = planting('radish', { plant_id: '1', plant_name: 'Radish', method_id: methods[0].method_id, method_category_id: methods[0].method_category_id, sow_date: '2026-10-17', harvest_end: '2026-11-20', ...options.cropAttrs }); // CHANGE
    const basil = planting('basil', { derived_mode: 'companion', derived_source_group_id: 'radish', companion_rating: '-1' }); // CHANGE: a deliberately stale snapshot must not override current positive data.
    h.window.eval(fs.readFileSync(path.join(__dirname, '../../drawio/src/main/webapp/plugins/garden_planner_plugins/Bed_Succession_Navigator.js'), 'utf8')); // CHANGE
    api.__testWindow.USL.tiler = h.tiler; // CHANGE
    api.__testWindow.USL.tasks = { applySchedulerTaskReplacement() { state.taskCalls++; } }; // CHANGE
    h.ui.showDialog = (node, _width, _height, _modal, _closable, close) => { dialog = node; onClose = close; api.__testWindow.document.body.appendChild(node); }; // CHANGE
    h.ui.hideDialog = () => { dialog?.remove(); onClose?.(); }; // CHANGE
    h.undoManager.clear(); // CHANGE
    const scheduler = api.__testWindow.USL.scheduler; // CHANGE
    const close = () => { h.ui.hideDialog(); h.close(); api.__testWindow.document.defaultView.close(); }; // CHANGE
    if (t) t.after(close); // CHANGE
    const snapshot = () => h.window.mxUtils.getXml(new h.window.mxCodec().encode(h.graph.getModel())); // CHANGE
    const button = label => Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === label); // CHANGE
    function dispatch(element, eventName) { element.dispatchEvent(new api.__testWindow.document.defaultView.Event(eventName, { bubbles: true })); } // CHANGE
    async function openAllocation() { // CHANGE
        const bedOccupancy = h.tiler.listPlantingFootprints(h.moduleCell, { includeUndatedOccupancy: true }).filter(item => item.groupId !== crop.id); // CHANGE
        const draft = { allocationYear: 2026, moduleCell: h.moduleCell, bed, city, crop: { plantId: '1', varietyId: '', label: 'Radish', method: methods[0].method_id }, plantResolution: { ok: true, plant: plants[0], plantId: '1', varietyId: null }, actionStartISO: '2026-10-17', targetDemandStartISO: '2026-11-10', targetDemandEndISO: '2026-11-20', bedOccupancy }; // CHANGE
        draft.lifecycle = await api.proposeLifecycle({ plant: plants[0], city, primaryDateISO: draft.actionStartISO, methodId: methods[0].method_id, methodCategoryId: methods[0].method_category_id, seasonStartYear: 2026, harvestWindowDays: 10 }); // CHANGE
        const pending = scheduler.openAllocationScheduleDialog(h.ui, draft, { previewOnly: true }); // CHANGE
        await waitFor(() => dialog?.isConnected); // CHANGE
        return { pending, draft }; // CHANGE
    } // CHANGE
    return { ...h, api, scheduler, state, bed, crop, basil, plants, city, planting, snapshot, button, dispatch, close, openAllocation, getDialog: () => dialog, open: () => scheduler.openScheduleDialog(h.ui, crop) }; // CHANGE
} // CHANGE

/** Wait for observable completion instead of relying on fixed UI delays. */ // CHANGE
async function waitFor(predicate) { // CHANGE
    const deadline = Date.now() + 15000; // CHANGE
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10)); // CHANGE
    assert.ok(predicate(), 'scheduler action should settle'); // CHANGE
} // CHANGE

module.exports = { createSchedulerOverlapFixture, waitFor }; // CHANGE
