const assert = require('node:assert/strict'); // CHANGE
const fs = require('node:fs'); // CHANGE
const path = require('node:path'); // CHANGE
const test = require('node:test'); // CHANGE
const { loadPlantTilerMxGraph } = require('./helpers/plant-tiler-mxgraph-harness.cjs'); // CHANGE

/** Production layout services and DOM controls share the actual mxGraph undo model. */ // CHANGE
function setup({ saved = null, legacy = null, diameters = [20, 20], rotation = 0 } = {}) { // CHANGE
    const h = loadPlantTilerMxGraph(), { window, graph } = h; // CHANGE
    const plugins = path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins'); // CHANGE
    const plants = diameters.map((d, i) => ({ plant_id: i + 1, plant_name: i ? 'Basil' : 'Tomato', spacing_x_cm: 30, spacing_y_cm: 30, veg_diameter_cm: d, yield_per_plant_kg: 1 })); // CHANGE
    const writes = []; // CHANGE
    window.dbBridge = { resolvePath: async () => ({ dbPath: 'companion-tests' }), open: async () => ({ dbId: 'companion-tests' }), close: async () => {}, // CHANGE
        exec: async (id, sql) => { writes.push(sql); return {}; }, // CHANGE
        query: async (id, sql, params) => ({ rows: sql.includes('FROM Plants') ? plants.filter(p => !params?.length || String(p.plant_id) === String(params[0])) // CHANGE
            : sql.includes('FROM Companions c') ? [{ relation_id: 1, source_plant_id: 1, companion_plant_id: 2, rating: 2, ...(legacy || {}) }] // CHANGE
            : sql.includes('FROM CompanionSetLayoutDefaults') && saved ? [{ crop_set_key: params[0], layout_json: JSON.stringify(saved) }] : [] }) }; // CHANGE
    window.__TRELLIS_PLANTING_SCHEDULER_TEST__ = true; // CHANGE
    let dialog = null, onClose = null; // CHANGE
    const ui = { editor: { graph, undoManager: h.undoManager }, actions: { get: () => null }, // CHANGE
        showDialog(node, w, height, modal, closable, close) { dialog = node; onClose = close; window.document.body.appendChild(node); }, // CHANGE
        hideDialog() { dialog?.remove(); dialog = null; const close = onClose; onClose = null; close?.(); } }; // CHANGE
    window.Draw = { loadPlugin: callback => callback(ui) }; // CHANGE
    for (const name of ['Garden_Scheduler_Shared_Core.js', 'Garden_Scheduler_Annual_Core.js', 'Garden_Scheduler_Perennial_Core.js', 'Garden_Scheduler_Dialog.js', 'Vertex_Linking_Standalone.js']) window.eval(fs.readFileSync(path.join(plugins, name), 'utf8')); // CHANGE
    const bed = h.bed(240, 350, rotation); // CHANGE
    const proposal = h.tiler.proposePlantingGeometry({ bedCell: bed, plantCount: 30, spacingXCm: 30, spacingYCm: 30, vegDiameterCm: diameters[0], fillCompleteRows: true }); // CHANGE
    const source = h.tiler.createPlantingFromProposal({ moduleCell: h.moduleCell, proposal, attributes: { plant_id: '1', plant_name: 'Tomato', plant_abbr: 'TOM', plant_yield: '1', sow_date: '2027-04-01', harvest_start: '2027-06-01', harvest_end: '2027-07-01' } }); // CHANGE
    const row = { cellId: 'new-companion', proposed: true, enabled: true, label: 'Basil', plantId: '2', plant: plants[1], varietyId: null, // CHANGE
        spacingXCm: 30, spacingYCm: 30, offsetXCm: 0, offsetYCm: 0, vegDiameterCm: diameters[1], // CHANGE
        attributes: { label: 'Basil group', plant_name: 'Basil', plant_abbr: 'BAS', plant_yield: '1' } }; // CHANGE
    h.undoManager.clear(); // CHANGE
    return Object.assign(h, { source, row, bed, plants, plugins, tools: window.USL.scheduler.layoutTools, writes, ui, getDialog: () => dialog }); // CHANGE
} // CHANGE

/** Start allocation with real graph, geometry, editor, navigator, and default services; stub only demand and lifecycle data. */ // CHANGE
async function allocationSetup({ noFit = false } = {}) { // CHANGE
    const h = setup(); // CHANGE
    if (noFit) Object.assign(h.plants[1], { spacing_x_cm: 1000, spacing_y_cm: 1000 }); // CHANGE
    try { h.state = (await startAllocate(h)).state; await allocationWait(() => noFit ? !!h.state.targetFailure : h.state.draft && !h.state.spacingPending); return h; } // CHANGE
    catch (error) { h.window.USL.allocate?.close(); h.close(); throw error; } // CHANGE
} // CHANGE

test('percentage controls synchronize active same-crop drafts, reject invalid input, and retain canceled edits without writes', async () => { // CHANGE
    const h = setup(); // CHANGE
    try { // CHANGE
        const context = await h.tools.buildSpacingLayoutRows(h.graph, h.source), source = context.rows.find(row => row.cellId === h.source.id); // CHANGE
        const rows = [source, { ...source, cellId: 'same-crop', selected: false }, { ...source, cellId: 'inactive', enabled: false }]; // CHANGE
        const body = h.window.document.createElement('div'); let draft, valid; // CHANGE
        h.graph.__trellisPlantingSpacingEditor.render(body, { selectedId: source.cellId, rows }, { live: true, fitToDemand: true, onChange: (value, preview, ok) => { draft = value; valid = ok; } }); // CHANGE
        const fields = body.querySelectorAll('input[aria-label$="Allowed overhang (%)"]'); // CHANGE
        assert.equal(fields.length, 3); assert.equal(fields[0].value, '30'); // CHANGE
        const before = h.source.value.outerHTML, history = h.undoManager.history.length, writes = h.writes.length; // CHANGE
        for (const value of ['12.5', '0', '50']) { // CHANGE
            fields[0].value = value; fields[0].dispatchEvent(new h.window.Event('input')); // CHANGE
            assert.equal(valid, true); assert.equal(fields[1].value, value); assert.equal(fields[2].value, '30'); // CHANGE
            assert.equal(draft[0].overhangEdited, true); assert.equal(draft[1].overhangEdited, true); // CHANGE
        } // CHANGE
        for (const value of ['', '-1', '51', 'invalid']) { // CHANGE
            fields[0].value = value; fields[0].dispatchEvent(new h.window.Event('input')); assert.equal(valid, false); // CHANGE
        } // CHANGE
        assert.equal(h.source.value.outerHTML, before); assert.equal(h.undoManager.history.length, history); assert.equal(h.writes.length, writes); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('an open Spacing editor restores the latest committed crop percentage without changing its planting', async () => { // CHANGE
    const h = setup(); // CHANGE
    try { // CHANGE
        const context = await h.tools.buildSpacingLayoutRows(h.graph, h.source), row = context.rows.find(item => item.cellId === h.source.id); // CHANGE
        const body = h.window.document.createElement('div'); let draft; // CHANGE
        h.graph.__trellisPlantingSpacingEditor.render(body, { selectedId: row.cellId, rows: [row] }, { live: true, fitToDemand: true, onChange: rows => { draft = rows; } }); // CHANGE
        const before = h.source.value.outerHTML; // CHANGE
        await h.tools.saveOverhangDefaultsForRows([{ ...row, allowedOverhangPct: 12.5, overhangEdited: true }], h.graph); // CHANGE
        body.querySelector('[aria-label="Restore plant defaults"]').click(); // CHANGE
        assert.equal(Number(draft[0].allowedOverhangPct), 12.5); assert.equal(h.source.value.outerHTML, before); // CHANGE
        assert.equal(h.undoManager.history.length, 0); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('saved percentage edits use the exact fitted preview, persist crop defaults, and undo only the diagram', async () => { // CHANGE
    const h = setup({ rotation: 45 }); // CHANGE
    try { // CHANGE
        const context = await h.tools.buildSpacingLayoutRows(h.graph, h.source), row = context.rows.find(row => row.cellId === h.source.id); // CHANGE
        const before = JSON.stringify(h.source.geometry), initialPct = h.source.getAttribute('allowed_overhang_pct'); // CHANGE
        const draft = { ...row, allowedOverhangPct: 12.5, overhangEdited: true }; // CHANGE
        const preview = h.tools.buildSpacingPreviewModel(h.graph, [draft]).rows[0].groupPreview; // CHANGE
        assert.notEqual(JSON.stringify(preview.rect), JSON.stringify(row.rect)); // CHANGE
        const result = await h.tools.applySpacingDraft(h.graph, [draft]); // CHANGE
        assert.equal(result.overhangDefaults.failedCropIds.length, 0); assert.equal(h.source.getAttribute('allowed_overhang_pct'), '12.5'); // CHANGE
        assert.ok(h.writes.some(sql => /UPDATE Plants SET allowed_overhang_pct/.test(sql))); // CHANGE
        assert.equal(Number(h.source.getAttribute('plant_count_actual')), preview.actual); // CHANGE
        for (const circle of preview.circles) { // CHANGE
            const tile = h.graph.getChildVertices(h.source).find(cell => Number(cell.getAttribute('tile_r')) === circle.row && Number(cell.getAttribute('tile_c')) === circle.col); // CHANGE
            assert.ok(Math.abs(h.source.geometry.x + tile.geometry.x + tile.geometry.width / 2 - circle.x) < 1e-6); // CHANGE
            assert.ok(Math.abs(h.source.geometry.y + tile.geometry.y + tile.geometry.height / 2 - circle.y) < 1e-6); // CHANGE
        } // CHANGE
        const writes = h.writes.length; h.undoManager.undo(); // CHANGE
        assert.equal(JSON.stringify(h.source.geometry), before); assert.equal(h.source.getAttribute('allowed_overhang_pct'), initialPct); assert.equal(h.writes.length, writes); // CHANGE
        h.undoManager.redo(); assert.equal(h.source.getAttribute('allowed_overhang_pct'), '12.5'); // CHANGE
        const legacy = row.plant; legacy.allowed_overhang_pct = 50; h.source.value.removeAttribute('allowed_overhang_pct'); // CHANGE
        const legacyRows = await h.tools.buildSpacingLayoutRows(h.graph, h.source); // CHANGE
        assert.equal(legacyRows.rows.find(item => item.cellId === h.source.id).allowedOverhangPct, 30); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('crop default failures preserve the planting, retry only the database, and invalidate stale retries', async () => { // CHANGE
    const h = setup(); // CHANGE
    try { // CHANGE
        const context = await h.tools.buildSpacingLayoutRows(h.graph, h.source), row = context.rows.find(row => row.cellId === h.source.id); // CHANGE
        const exec = h.window.dbBridge.exec; let fail = true, updates = 0; // CHANGE
        h.window.dbBridge.exec = async (...args) => { if (/UPDATE Plants SET allowed_overhang_pct/.test(args[1])) { updates++; if (fail) throw new Error('test database locked'); } return exec(...args); }; // CHANGE
        const result = await h.tools.applySpacingDraft(h.graph, [{ ...row, allowedOverhangPct: 20, overhangEdited: true }]); // CHANGE
        assert.equal(result.overhangDefaults.failedCropIds.length, 1); assert.equal(h.source.getAttribute('allowed_overhang_pct'), '20'); // CHANGE
        const geometry = JSON.stringify(h.source.geometry), history = h.undoManager.history.length; // CHANGE
        let notice = h.window.document.querySelector('.trellis-overhang-default-notice'); assert.match(notice.textContent, /Planting saved.*test database locked/); // CHANGE
        fail = false; notice.querySelector('button').click(); await allocationWait(() => !h.window.document.querySelector('.trellis-overhang-default-notice')); // CHANGE
        assert.equal(updates, 2); assert.equal(JSON.stringify(h.source.geometry), geometry); assert.equal(h.undoManager.history.length, history); // CHANGE
        fail = true; await h.tools.saveOverhangDefaultsForRows([{ ...row, allowedOverhangPct: 10, overhangEdited: true }], h.graph); // CHANGE
        notice = h.window.document.querySelector('.trellis-overhang-default-notice'); const staleButton = notice.querySelector('button'); // CHANGE
        fail = false; await h.tools.saveOverhangDefaultsForRows([{ ...row, allowedOverhangPct: 25, overhangEdited: true }], h.graph); // CHANGE
        const count = updates; staleButton.click(); await Promise.resolve(); assert.equal(updates, count); assert.equal(notice.isConnected, false); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('Allocate overhang edits remain drafts until Create and persist even without Save as default', async () => { // CHANGE
    const h = await allocationSetup(); // CHANGE
    try { // CHANGE
        h.window.document.querySelector('[data-allocation-view="spacing"]').click(); await allocationWait(() => h.state.draft && !h.state.spacingPending); // CHANGE
        const field = h.state.spacingBody.querySelector('input[aria-label$="Allowed overhang (%)"]'); // CHANGE
        const writes = h.writes.length; field.value = '12.5'; field.dispatchEvent(new h.window.Event('input')); // CHANGE
        await allocationWait(() => h.state.draft && !h.state.spacingPending); // CHANGE
        const draft = h.state.draft; assert.equal(draft.geometry.allowedOverhangPct, 12.5); assert.equal(h.writes.length, writes); // CHANGE
        assert.equal(h.state.spacingBody.querySelector('input[type=checkbox]').checked, false); // CHANGE
        h.state.hudRefs.create.click(); await allocationWait(() => !h.state.committing && !h.state.draft); // CHANGE
        const group = Object.values(h.graph.getModel().cells).find(cell => cell.getAttribute?.('allocation_source') === 'year_plan'); // CHANGE
        assert.equal(group.getAttribute('allowed_overhang_pct'), '12.5'); assert.equal(Number(group.getAttribute('plant_count_actual')), draft.plantCount); // CHANGE
        assert.ok(h.writes.some(sql => /UPDATE Plants SET allowed_overhang_pct/.test(sql))); // CHANGE
    } finally { h.window.USL.allocate.close(); h.close(); } // CHANGE
}); // CHANGE

test('percentage fitting preserves manual logical positions and explicit disabled slots', async () => { // CHANGE
    const h = setup({ rotation: -30 }); // CHANGE
    try { // CHANGE
        const tile = h.graph.getChildVertices(h.source).find(cell => cell.getAttribute('plant_tiler') === '1'); // CHANGE
        const angle = -30 * Math.PI / 180; // CHANGE
        function logicalCenter() { // CHANGE
            const center = { x: h.source.geometry.width / 2, y: h.source.geometry.height / 2 }; // CHANGE
            const dx = tile.geometry.x + tile.geometry.width / 2 - center.x, dy = tile.geometry.y + tile.geometry.height / 2 - center.y; // CHANGE
            return { x: center.x + dx * Math.cos(angle) + dy * Math.sin(angle), y: center.y - dx * Math.sin(angle) + dy * Math.cos(angle) }; // CHANGE
        } // CHANGE
        tile.value.setAttribute('dirty', '1'); const geometry = tile.geometry.clone(); geometry.x += 1; h.graph.getModel().setGeometry(tile, geometry); // CHANGE
        h.source.value.setAttribute('disabled_plants', '[[1,1]]'); // CHANGE
        const before = logicalCenter(), context = await h.tools.buildSpacingLayoutRows(h.graph, h.source), row = context.rows.find(item => item.cellId === h.source.id); // CHANGE
        await h.tools.applySpacingDraft(h.graph, [{ ...row, allowedOverhangPct: 50 }]); // CHANGE
        const after = logicalCenter(); assert.ok(Math.abs(after.x - before.x) < 1e-6); assert.ok(Math.abs(after.y - before.y) < 1e-6); // CHANGE
        assert.equal(tile.getAttribute('dirty'), '1'); assert.match(h.source.getAttribute('disabled_plants'), /1,1/); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('crop overhang schema adds a nullable column once without rewriting legacy records', async () => { // CHANGE
    const h = setup(); // CHANGE
    try { // CHANGE
        const query = h.window.dbBridge.query; // CHANGE
        h.window.dbBridge.query = async (id, sql, params) => { // CHANGE
            if (sql.includes('sqlite_master') && params?.[0] === 'Plants') return { rows: [{ name: 'Plants' }] }; // CHANGE
            if (sql.includes('PRAGMA table_info(Plants)')) return { rows: [{ name: 'spacing_x_cm' }, { name: 'spacing_y_cm' }] }; // CHANGE
            return query(id, sql, params); // CHANGE
        }; // CHANGE
        await h.tools.buildSpacingLayoutRows(h.graph, h.source); await h.tools.buildSpacingLayoutRows(h.graph, h.source); // CHANGE
        const additions = h.writes.filter(sql => /ALTER TABLE Plants ADD COLUMN allowed_overhang_pct/.test(sql)); // CHANGE
        assert.equal(additions.length, 1); assert.match(additions[0], /allowed_overhang_pct REAL;/); assert.equal(h.writes.some(sql => /UPDATE Plants/.test(sql)), false); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('a changed crop default cannot create an obsolete Allocate preview', async () => { // CHANGE
    const h = await allocationSetup(); // CHANGE
    try { // CHANGE
        assert.equal(h.state.draft.geometry.allowedOverhangPct, 30); h.plants[1].allowed_overhang_pct = 10; // CHANGE: simulate a database default change with no browser event.
        h.state.hudRefs.create.click(); // CHANGE
        await allocationWait(() => /Crop overhang default changed/.test(h.state.noticeMessage)); assert.equal(h.state.draft, null); // CHANGE
        assert.equal(Object.values(h.graph.getModel().cells).some(cell => cell.getAttribute?.('allocation_source') === 'year_plan'), false); // CHANGE
        assert.equal(h.undoManager.history.length, 0); // CHANGE
    } finally { h.window.USL.allocate.close(); h.close(); } // CHANGE
}); // CHANGE

test('companion percentage changes save their crop default without enlarging the existing shared area', async () => { // CHANGE
    const h = setup({ rotation: 45 }); // CHANGE
    try { // CHANGE
        const context = await h.tools.prepareCompanionPair(h.graph, h.source, h.row); // CHANGE
        const row = { ...context.rows[0], allowedOverhangPct: 50, overhangEdited: true }; // CHANGE
        const before = ['x', 'y', 'width', 'height'].map(key => h.source.geometry[key]), preview = h.tools.buildSpacingPreviewModel(h.graph, [row]).rows[0].groupPreview; // CHANGE
        await h.tools.applySpacingDraft(h.graph, [row]); // CHANGE
        assert.deepEqual(['x', 'y', 'width', 'height'].map(key => h.source.geometry[key]), before); assert.equal(h.source.getAttribute('allowed_overhang_pct'), '50'); // CHANGE
        assert.equal(Number(h.source.getAttribute('plant_count_actual')), preview.actual); assert.ok(h.writes.some(sql => /UPDATE Plants SET allowed_overhang_pct/.test(sql))); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

/** Await asynchronous production reconciliation without depending on a fixed scheduling delay. */ // CHANGE
async function allocationWait(predicate) { // CHANGE
    const end = Date.now() + 5000; // CHANGE
    while (!predicate()) { if (Date.now() > end) throw new Error('Allocation did not settle'); await new Promise(resolve => setTimeout(resolve, 10)); } // CHANGE
} // CHANGE

test('an initially unfit crop is selectable and smaller spacing recovers its demand-based allocation', async () => { // CHANGE
    const h = await allocationSetup({ noFit: true }); // CHANGE
    try { // CHANGE
        const { document, Event } = h.window, state = h.state; // CHANGE
        assert.equal(state.draft, null); assert.equal(state.opportunityModel.unresolved[0].spacingAdjustable, true); // CHANGE
        assert.equal(state.hudRefs.cropSelect.querySelector('option[value="basil"]').disabled, false); // CHANGE
        document.querySelector('[data-allocation-view="spacing"]').click(); // CHANGE
        await allocationWait(() => !state.spacingPending); // CHANGE
        const fields = state.spacingBody.querySelectorAll('input[type="number"]'); // CHANGE
        fields[0].value = '30'; fields[1].value = '30'; fields[0].dispatchEvent(new Event('input')); // CHANGE
        await allocationWait(() => state.draft && !state.spacingPending); // CHANGE
        assert.equal(state.draft.ok, true); assert.ok(state.draft.plantCount >= 8); assert.equal(state.hudRefs.create.disabled, false); // CHANGE
        assert.equal(state.draft.targetDemandStartISO, '2027-04-12'); assert.equal(h.undoManager.history.length, 0); // CHANGE
    } finally { h.window.USL.allocate.close(); h.close(); } // CHANGE
}); // CHANGE

test('required-default setup preserves reviewed lifecycle and tasks through a no-fit return and spacing recovery', async () => { // CHANGE
    const h = await allocationSetup({ noFit: true }); // CHANGE
    try { // CHANGE
        const state = h.state; let saved = false; // CHANGE
        h.window.document.querySelector('[data-allocation-view="spacing"]').click(); await allocationWait(() => !state.spacingPending); // CHANGE
        h.window.USL.scheduler.resolveAllocationDefaultStatus = async () => ({ complete: saved, missing: saved ? [] : ['tasks'] }); state.defaultsLookup = null; h.window.dispatchEvent(new h.window.Event('resize')); // CHANGE
        await allocationWait(() => !state.defaultsLookup.pending); // CHANGE
        const tasks = [{ title: 'Configured sow', startISO: '2027-04-05' }]; // CHANGE
        h.window.USL.scheduler.openAllocationScheduleDialog = async (ui, draft, options) => { // CHANGE
            assert.equal(options.isCurrent(), true); saved = true; // CHANGE
            return { action: 'preview', draft: { ...draft, taskPreview: tasks, lifecycle: { ...draft.lifecycle, taskPreview: tasks, attributePatch: { ...draft.lifecycle.attributePatch, harvest_end: '2027-05-20' } } } }; // CHANGE
        }; // CHANGE
        state.hudRefs.defaultsBox.querySelector('[data-allocation-missing-default="tasks"]').click(); await allocationWait(() => !state.reviewing); // CHANGE
        assert.equal(state.draft, null); assert.equal(state.defaultsLookup.status.complete, true); assert.equal(state.hudRefs.create.disabled, true); // CHANGE
        const fields = state.spacingBody.querySelectorAll('input[type=number]'); fields[0].value = '30'; fields[1].value = '30'; fields[0].dispatchEvent(new h.window.Event('input')); // CHANGE
        await allocationWait(() => state.draft && !state.spacingPending); // CHANGE
        assert.equal(state.draft.harvestEnd, '2027-05-20'); assert.equal(state.draft.taskPreview, tasks); assert.equal(h.undoManager.history.length, 0); // CHANGE
    } finally { h.window.USL.allocate.close(); h.close(); } // CHANGE
}); // CHANGE

test('ordinary edits survive beds, sow weeks, rotation and schedule review, and reset with another crop', async () => { // CHANGE
    const h = setup(); // CHANGE
    try { // CHANGE
        const { document, Event } = h.window; let fields; // CHANGE
        const bed = h.graph.insertVertex(h.moduleCell, 'second-bed', h.bed.value.cloneNode(true), 600, 200, 300, 400); // CHANGE
        const opened = (await startAllocate(h)).state; // CHANGE
        document.querySelector('[data-allocation-view="spacing"]').click(); await allocationWait(() => opened.draft && !opened.spacingPending); // CHANGE
        fields = opened.spacingBody.querySelectorAll('input[type="number"]'); fields[0].value = '18'; fields[2].value = '-5'; fields[0].dispatchEvent(new Event('input')); // CHANGE
        await allocationWait(() => opened.draft && !opened.spacingPending); // CHANGE
        h.graph.setSelectionCell(bed); await allocationWait(() => opened.draft?.bed === bed && !opened.spacingPending); // CHANGE
        assert.equal(Number(opened.draft.geometry.spacingXCm), 18); assert.equal(Number(opened.draft.geometry.layoutOffsetXCm), -5); // CHANGE
        opened.actionSchedule.actions.push({ ...opened.actionSchedule.actions[0], key: 'second-week', actionWeekIndex: 1 }); // CHANGE
        opened.opportunityModel.actionableWeekIndices = [0, 1]; opened.hudRefs.next.click(); // CHANGE: navigate through the same action used by the week buttons.
        await allocationWait(() => opened.weekIndex === 1 && opened.draft && !opened.spacingPending); // CHANGE
        assert.equal(opened.selectedCropId, 'basil'); assert.equal(Number(opened.draft.geometry.spacingXCm), 18); // CHANGE
        opened.hudRefs.rotate.click(); assert.equal(Number(opened.draft.geometry.spacingXCm), 18); assert.equal(Number(opened.draft.geometry.layoutOffsetXCm), -5); // CHANGE
        h.window.USL.scheduler.openAllocationScheduleDialog = async (ui, draft, options) => { // CHANGE
            const next = await options.revalidateDraft({ ...draft, lifecycle: { ...draft.lifecycle, attributePatch: { ...draft.lifecycle.attributePatch, harvest_end: '2027-05-20' } } }); // CHANGE
            return { action: 'preview', draft: next }; // CHANGE
        }; // CHANGE
        opened.draft.warnings = ['Review this changed schedule']; // CHANGE: lifecycle Edit remains available in the warning confirmation.
        opened.hudRefs.create.click(); await allocationWait(() => !!h.getDialog()); dialogButton(h, 'Edit').click(); await allocationWait(() => !opened.reviewing); // CHANGE
        assert.equal(opened.draft.harvestEnd, '2027-05-20'); assert.equal(Number(opened.draft.geometry.spacingXCm), 18); assert.equal(Number(opened.draft.geometry.layoutOffsetXCm), -5); // CHANGE
        fields = opened.spacingBody.querySelectorAll('input[type="number"]'); fields[1].value = '24'; fields[1].dispatchEvent(new Event('input')); // CHANGE
        await allocationWait(() => opened.draft && !opened.spacingPending); assert.equal(opened.draft.harvestEnd, '2027-05-20'); // CHANGE: changing spacing cannot revert reviewed dates.
        opened.hudRefs.cropSelect.value = 'tomato'; opened.hudRefs.cropSelect.dispatchEvent(new Event('change')); // CHANGE
        assert.equal(opened.spacingOverrides, null); assert.equal(opened.allocationView, 'occupancy'); assert.equal(opened.spacingSaveDefaults, false); // CHANGE
    } finally { h.window.USL.allocate.close(); h.close(); } // CHANGE
}); // CHANGE

test('inline ordinary spacing updates live, retains focus and raw input, recovers no fit, and creates the reviewed geometry', async () => { // CHANGE
    const h = await allocationSetup(); // CHANGE
    try { // CHANGE
        const { document, Event } = h.window, state = h.state; // CHANGE
        const navigator = h.graph.__trellisBedSuccessionNavigator, showPreview = navigator.showAllocationPreview, published = []; // CHANGE
        navigator.showAllocationPreview = input => { published.push(input); return showPreview(input); }; // CHANGE: observe the actual host contract during the first editor calculation.
        document.querySelector('[data-allocation-view="spacing"]').click(); // CHANGE
        assert.equal(state.spacingPending, true); assert.equal(published.at(-1).geometry, null); assert.match(published.at(-1).message, /Updating spacing preview/); // CHANGE: initial editor mounting must not republish the previous geometry while pending.
        await allocationWait(() => state.draft && !state.spacingPending); // CHANGE
        const body = state.spacingBody, fields = body.querySelectorAll('input[type="number"]'), field = fields[0]; // CHANGE
        assert.equal(fields.length, 5); assert.equal(body.querySelector('input[type="checkbox"]').checked, false); // CHANGE: overhang joins spacing and offsets.
        const initialGeometry = JSON.stringify(state.draft.geometry.geometry); // CHANGE
        field.focus(); field.value = '60'; field.dispatchEvent(new Event('input', { bubbles: true })); // CHANGE
        assert.equal(state.hudRefs.create.disabled, true); // CHANGE
        await allocationWait(() => state.draft && !state.spacingPending); // CHANGE
        assert.equal(document.activeElement, field); assert.notEqual(JSON.stringify(state.draft.geometry.geometry), initialGeometry); // CHANGE
        assert.equal(Number(state.draft.geometry.spacingXCm), 60); assert.equal(h.undoManager.history.length, 0); // CHANGE
        fields[2].value = '100000'; fields[2].dispatchEvent(new Event('input', { bubbles: true })); // CHANGE
        await allocationWait(() => !state.spacingPending); // CHANGE
        assert.equal(state.draft, null); assert.equal(state.hudRefs.create.disabled, true); assert.equal(state.spacingBody, body); // CHANGE
        fields[2].value = '0'; fields[2].dispatchEvent(new Event('input', { bubbles: true })); // CHANGE
        await allocationWait(() => state.draft && !state.spacingPending); // CHANGE
        field.value = ''; field.dispatchEvent(new Event('input', { bubbles: true })); // CHANGE
        assert.equal(state.spacingValid, false); assert.equal(state.hudRefs.create.disabled, true); // CHANGE
        document.querySelector('[data-allocation-view="occupancy"]').click(); document.querySelector('[data-allocation-view="spacing"]').click(); // CHANGE
        assert.equal(state.spacingBody, body); assert.equal(field.value, ''); // CHANGE
        field.value = '25'; field.dispatchEvent(new Event('input', { bubbles: true })); // CHANGE
        field.value = '15'; field.dispatchEvent(new Event('input', { bubbles: true })); // CHANGE
        await allocationWait(() => state.draft && !state.spacingPending); // CHANGE
        assert.equal(Number(state.draft.geometry.spacingXCm), 15); assert.equal(h.writes.length, 0); // CHANGE
        const draft = state.draft; state.hudRefs.create.click(); // CHANGE: a clean task-bearing preview creates directly.
        await allocationWait(() => !state.reviewing); // CHANGE
        assert.equal(h.getDialog(), null); // CHANGE
        const created = h.graph.getModel().cells; // CHANGE
        const group = Object.values(created).find(cell => cell.getAttribute?.('allocation_source') === 'year_plan'); // CHANGE
        assert.ok(group); assert.equal(Number(group.getAttribute('spacing_x_cm')), 15); assert.equal(Number(group.getAttribute('plant_count')), draft.plantCount); // CHANGE
        assert.equal(h.writes.length, 0); assert.equal(h.undoManager.history.length, 1); // CHANGE
        h.undoManager.undo(); assert.equal(h.graph.getModel().getCell(group.id), undefined); // CHANGE
    } finally { h.window.USL.allocate.close(); h.close(); } // CHANGE
}); // CHANGE

test('inline companion controls preview both crops without mutation and commit them in one undo step', async () => { // CHANGE
    const h = await allocationSetup(); // CHANGE
    try { // CHANGE
        const { document, Event } = h.window, state = h.state, before = h.source.getAttribute('plant_count'); // CHANGE
        state.hudRefs.companion.click(); // CHANGE
        await allocationWait(() => state.draft?.companionLayout && !state.spacingPending && !state.reviewing); // CHANGE
        assert.equal(h.getDialog(), null); assert.equal(state.allocationView, 'spacing'); // CHANGE
        const body = state.spacingBody; assert.equal(body.querySelectorAll('input[type="number"]').length, 10); // CHANGE
        body.querySelector('[data-spacing-pattern="aligned"]').click(); // CHANGE
        await allocationWait(() => state.draft?.companionLayout && !state.spacingPending); // CHANGE
        assert.equal(h.source.getAttribute('plant_count'), before); assert.equal(h.undoManager.history.length, 0); assert.equal(h.writes.some(sql => /^\s*(?:INSERT|UPDATE|DELETE)\b/.test(sql)), false); // CHANGE
        const save = body.querySelector('input[type="checkbox"]'); assert.equal(save.checked, false); // CHANGE
        save.checked = true; save.dispatchEvent(new Event('change', { bubbles: true })); // CHANGE
        await allocationWait(() => state.draft?.companionLayout.saveDefaults && !state.spacingPending); // CHANGE
        const draft = state.draft; state.hudRefs.create.click(); await allocationWait(() => !!h.getDialog()); // CHANGE
        Array.from(h.getDialog().querySelectorAll('button')).find(button => /^Create/.test(button.textContent)).click(); // CHANGE
        await allocationWait(() => !state.reviewing); // CHANGE
        const group = Object.values(h.graph.getModel().cells).find(cell => cell.getAttribute?.('allocation_source') === 'year_plan'); // CHANGE
        assert.ok(group); assert.equal(Number(group.getAttribute('plant_count')), draft.plantCount); // CHANGE
        assert.equal(Number(h.source.getAttribute('plant_count')), draft.companionLayout.plantingCountOverrides[h.source.id]); // CHANGE
        assert.equal(h.undoManager.history.length, 1); assert.ok(h.writes.some(sql => /CompanionSetLayoutDefaults/.test(sql))); // CHANGE
        h.undoManager.undo(); assert.equal(h.source.getAttribute('plant_count'), before); assert.equal(h.graph.getModel().getCell(group.id), undefined); // CHANGE
    } finally { h.window.USL.allocate.close(); h.close(); } // CHANGE
}); // CHANGE

test('ordinary spacing defaults require opt-in and successful creation; a default failure preserves the planting', async () => { // CHANGE
    const h = await allocationSetup(); // CHANGE
    try { // CHANGE
        const { document, Event } = h.window, state = h.state; let saves = 0; // CHANGE
        h.tools.saveSpacingDefaultsForRows = async rows => { saves++; assert.equal(Number(rows[0].spacingXCm), 30); throw new Error('Default storage unavailable'); }; // CHANGE
        document.querySelector('[data-allocation-view="spacing"]').click(); await allocationWait(() => state.draft && !state.spacingPending); // CHANGE
        const save = state.spacingBody.querySelector('input[type="checkbox"]'); assert.equal(save.checked, false); // CHANGE
        save.checked = true; save.dispatchEvent(new Event('change')); await allocationWait(() => state.draft && !state.spacingPending); // CHANGE
        assert.equal(saves, 0); assert.equal(state.draft.spacingSaveDefaults, true); assert.equal(h.tools, h.window.USL.scheduler.layoutTools); // CHANGE
        const selectionBeforeCreate = h.graph.getSelectionCell(); const applyTasks = h.window.USL.tasks.applySchedulerTaskReplacement; h.window.USL.tasks.applySchedulerTaskReplacement = () => { throw new Error('Task failure'); }; // CHANGE
        state.hudRefs.create.click(); await allocationWait(() => !state.reviewing); // CHANGE: direct creation retains the same rollback path.
        assert.equal(saves, 0); assert.equal(h.undoManager.history.length, 0); assert.equal(state.draft.spacingSaveDefaults, true, state.noticeMessage); // CHANGE
        h.window.USL.tasks.applySchedulerTaskReplacement = applyTasks; // CHANGE
        await new Promise(resolve => h.window.requestAnimationFrame(resolve)); assert.equal(h.graph.getSelectionCell()?.id, selectionBeforeCreate?.id); assert.ok(state.draft); // CHANGE: rollback restores the original canvas target for retry.
        state.hudRefs.create.click(); await allocationWait(() => !state.reviewing); // CHANGE
        assert.equal(saves, 1, state.noticeMessage); assert.match(state.noticeMessage, /Planting created, but its spacing default could not be saved: Default storage unavailable/); // CHANGE
        assert.equal(h.undoManager.history.length, 1); assert.equal(h.tiler.listPlantingFootprints(h.moduleCell).filter(item => item.plantId === '2').length, 1); // CHANGE
    } finally { h.window.USL.allocate.close(); h.close(); } // CHANGE
}); // CHANGE

test('a known companion with unchanged source capacity creates directly and remains one undoable transaction', async () => { // CHANGE
    const h = await allocationSetup(); // CHANGE
    try { // CHANGE
        const state = h.state, before = Number(h.source.getAttribute('plant_count')); state.hudRefs.companion.click(); // CHANGE
        await allocationWait(() => state.draft?.companionLayout && !state.spacingPending && !state.reviewing); // CHANGE
        const fields = state.spacingBody.querySelectorAll('input[type=number]'); // CHANGE
        ['30', '30', '0', '0', '30', '30', '15', '15'].forEach((value, index) => { fields[index].value = value; }); fields[0].dispatchEvent(new h.window.Event('input')); // CHANGE
        await allocationWait(() => state.draft?.companionLayout && !state.spacingPending); // CHANGE
        assert.equal(state.draft.companionLayout.plantingCountOverrides[h.source.id], before); assert.equal(state.draft.status, 'compatible'); // CHANGE
        state.hudRefs.create.click(); await allocationWait(() => !state.reviewing); // CHANGE
        assert.equal(h.getDialog(), null); assert.equal(h.undoManager.history.length, 1); // CHANGE
        assert.equal(h.tiler.listPlantingFootprints(h.moduleCell).filter(item => item.plantId === '2').length, 1); // CHANGE
        h.undoManager.undo(); assert.equal(Number(h.source.getAttribute('plant_count')), before); assert.equal(h.tiler.listPlantingFootprints(h.moduleCell).filter(item => item.plantId === '2').length, 0); // CHANGE
    } finally { h.window.USL.allocate.close(); h.close(); } // CHANGE
}); // CHANGE

for (const pattern of ['aligned', 'staggered']) for (const rotation of [0, 37]) test(`${pattern} companion rows preserve tangency, counts, and one-step undo at ${rotation} degrees`, async () => { // CHANGE
    const h = setup({ rotation }); // CHANGE
    try { // CHANGE
        const context = await h.tools.prepareCompanionPair(h.graph, h.source, h.row); // CHANGE
        const rows = h.tools.generateCompanionPairLayout(h.graph, context.rows, pattern); // CHANGE
        const preview = h.tools.buildSpacingPreviewModel(h.graph, rows); // CHANGE
        assert.equal(preview.status, 'ok'); // CHANGE
        const [a, b] = preview.rows.map(row => row.groupPreview); // CHANGE
        let closest = Infinity; // CHANGE
        for (const p of a.circles) for (const q of b.circles) closest = Math.min(closest, Math.hypot(p.x - q.x, p.y - q.y) - p.r - q.r); // CHANGE
        assert.ok(Math.abs(closest) < 1e-6, `circle clearance ${closest}`); // CHANGE
        assert.equal(h.undoManager.history.length, 0); // CHANGE
        const beforeCount = h.source.getAttribute('plant_count'), beforeGeometry = JSON.stringify(h.source.geometry); // CHANGE
        const model = h.graph.getModel(); model.beginUpdate(); let group; // CHANGE
        try { // CHANGE
            h.tools.applyLayoutRowsToGraph(h.graph, [rows[0]]); // CHANGE
            group = h.tiler.createPlantingFromProposal({ moduleCell: h.moduleCell, insideUpdate: true, attributes: { plant_id: '2', plant_name: 'Basil', plant_abbr: 'BAS', plant_yield: '1', sow_date: '2027-04-15', harvest_end: '2027-08-01' }, // CHANGE
                proposal: { ok: true, sharedFootprint: true, geometry: rows[1].modelRect, rotation: rows[1].rotationDeg, plantCount: b.actual, // CHANGE
                    spacingXCm: rows[1].spacingXCm, spacingYCm: rows[1].spacingYCm, vegDiameterCm: rows[1].vegDiameterCm, // CHANGE
                    layoutOffsetXCm: rows[1].offsetXCm, layoutOffsetYCm: rows[1].offsetYCm, disabledSlots: b.disabledSlots } }); // CHANGE
        } finally { model.endUpdate(); } // CHANGE
        assert.equal(Number(h.source.getAttribute('plant_count')), a.actual); assert.equal(Number(group.getAttribute('plant_count')), b.actual); // CHANGE
        assert.equal(Number(group.getAttribute('planting_expected_yield_kg')), b.actual); // CHANGE
        assert.equal(h.undoManager.history.length, 1); // CHANGE
        h.undoManager.undo(); assert.equal(model.getCell(group.id), undefined); assert.equal(h.source.getAttribute('plant_count'), beforeCount); assert.equal(JSON.stringify(h.source.geometry), beforeGeometry); // CHANGE
        h.undoManager.redo(); assert.equal(model.getCell(group.id), group); assert.equal(Number(h.source.getAttribute('plant_count')), a.actual); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('unequal circles touch and impossible staggering is rejected', async () => { // CHANGE
    const h = setup({ diameters: [40, 10] }); // CHANGE
    try { // CHANGE
        const context = await h.tools.prepareCompanionPair(h.graph, h.source, h.row); // CHANGE
        assert.ok(Math.abs(context.rows[0].spacingYCm - 50) < 1e-6); // CHANGE
        assert.throws(() => h.tools.generateCompanionPairLayout(h.graph, context.rows, 'staggered'), /cannot fit/); // CHANGE
        const [a, b] = h.tools.buildSpacingPreviewModel(h.graph, context.rows).rows.map(row => row.groupPreview); // CHANGE
        let closest = Infinity; for (const p of a.circles) for (const q of b.circles) closest = Math.min(closest, Math.hypot(p.x-q.x, p.y-q.y)-p.r-q.r); // CHANGE
        assert.ok(Math.abs(closest) < 1e-6); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('shared spacing editor previews an unsaved row and toggles without graph or default writes', async () => { // CHANGE
    const h = setup(); // CHANGE
    try { // CHANGE
        const context = await h.tools.prepareCompanionPair(h.graph, h.source, h.row); // CHANGE
        const body = h.window.document.createElement('div'); h.window.document.body.appendChild(body); // CHANGE
        let preview, applied = false; const writes = h.writes.length; // CHANGE
        const sourceNode = h.graph.view.getState(h.source).shape.node, sourceOpacity = sourceNode.style.opacity; // CHANGE
        h.graph.__trellisPlantingGroup.preview.render('allocate:test', { className: 'trellis-allocate-ghost', rows: [{ rect: { x: 0, y: 0, width: 20, height: 20 }, circles: [] }] }); // CHANGE
        h.graph.__trellisPlantingSpacingEditor.render(body, context, { proposed: true, applyLabel: 'Review companion', onChange: (rows, value) => { preview = value; }, onApply: () => { applied = true; } }); // CHANGE
        assert.equal(preview.status, 'ok'); // CHANGE
        body.querySelector('[data-spacing-pattern="staggered"]').click(); // CHANGE
        assert.equal(preview.status, 'ok'); assert.ok(body.textContent.includes('Staggered')); // CHANGE
        assert.equal(h.window.document.querySelectorAll('.manual-link-spacing-preview .manual-link-spacing-preview-group-frame').length, 2); // CHANGE: an unsaved companion still renders using the saved source's display anchor.
        assert.equal(h.window.document.querySelectorAll('.manual-link-spacing-preview .manual-link-spacing-preview-plant').length, preview.rows.reduce((count, row) => count + row.groupPreview.circles.length, 0)); // CHANGE: projection retains both saved and proposed planting circles.
        assert.equal(sourceNode.style.opacity, '0'); // CHANGE: spacing still replaces the saved group visually.
        const patternSource = body.querySelector('.manual-link-spacing-pattern-source'), offset = body.querySelectorAll('.manual-link-spacing-row')[1].querySelectorAll('input')[2]; // CHANGE
        const generatedOffset = offset.value; offset.value = String(Number(generatedOffset) + 1); offset.dispatchEvent(new h.window.Event('input')); // CHANGE
        assert.equal(patternSource.textContent, 'Custom'); offset.value = generatedOffset; offset.dispatchEvent(new h.window.Event('input')); // CHANGE
        assert.equal(patternSource.textContent, 'Staggered'); // CHANGE
        assert.equal(h.undoManager.history.length, 0); assert.equal(h.writes.length, writes); // CHANGE
        assert.equal(h.graph.getModel().getCell('new-companion'), undefined); // CHANGE
        const review = Array.from(body.querySelectorAll('button')).find(button => button.textContent === 'Review companion'); review.click(); // CHANGE
        assert.equal(applied, true); h.graph.__trellisPlantingSpacingEditor.clear(); // CHANGE
        assert.equal(sourceNode.style.opacity, sourceOpacity); // CHANGE
        assert.ok(h.window.document.querySelector('.trellis-allocate-ghost')); // CHANGE: editor cleanup cannot remove the Allocate owner.
        assert.equal(h.undoManager.history.length, 0); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('Allocate displays a fractional Y offset as zero without moving plants and commits its exact preview', async () => { // CHANGE
    const h = setup(); // CHANGE
    try { // CHANGE
        const bedGeometry = h.bed.getGeometry().clone(); bedGeometry.width = 500; bedGeometry.height = 125; h.graph.getModel().setGeometry(h.bed, bedGeometry); // CHANGE: force a fractional automatic Y centering offset that rounds to zero.
        h.graph.getModel().execute(new h.window.mxCellAttributeChange(h.source, 'sow_date', '2026-04-01')); h.graph.getModel().execute(new h.window.mxCellAttributeChange(h.source, 'harvest_end', '2026-07-01')); // CHANGE: this fixture's new allocation has no occupied lifecycle overlap.
        const { state } = await startAllocate(h); await allocationWait(() => state.draft && !state.spacingPending); // CHANGE
        const original = state.draft.geometry; assert.ok(original.layoutOffsetYCm > 0 && original.layoutOffsetYCm < 0.5); // CHANGE
        h.window.document.querySelector('[data-allocation-view="spacing"]').click(); await allocationWait(() => state.draft && !state.spacingPending); // CHANGE
        const fields = state.spacingBody.querySelectorAll('input[type=number]'); assert.equal(fields[3].value, '0'); // CHANGE
        fields[3].focus(); fields[3].blur(); fields[3].dispatchEvent(new h.window.Event('change')); // CHANGE
        const save = state.spacingBody.querySelector('input[type=checkbox]'); save.checked = true; save.dispatchEvent(new h.window.Event('change')); // CHANGE
        await allocationWait(() => state.draft && !state.spacingPending); // CHANGE
        h.window.document.querySelector('[data-allocation-view="occupancy"]').click(); h.window.document.querySelector('[data-allocation-view="spacing"]').click(); // CHANGE
        const accepted = state.draft.geometry; assert.equal(accepted.layoutOffsetYCm, original.layoutOffsetYCm); assert.equal(accepted.plantCount, original.plantCount); // CHANGE
        for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(accepted.geometry[key] - original.geometry[key]) < 1e-6, key); // CHANGE
        accepted.slots.forEach((slot, index) => { assert.ok(Math.abs(slot.x - original.slots[index].x) < 1e-6); assert.ok(Math.abs(slot.y - original.slots[index].y) < 1e-6); }); // CHANGE
        const previewCount = state.draft.plantCount; state.hudRefs.create.click(); await allocationWait(() => !state.reviewing); // CHANGE
        const group = Object.values(h.graph.getModel().cells).find(cell => cell.getAttribute?.('allocation_source') === 'year_plan'); assert.ok(group, state.noticeMessage); // CHANGE
        assert.equal(Number(group.getAttribute('layout_offset_y_cm')), original.layoutOffsetYCm); assert.equal(Number(group.getAttribute('plant_count')), previewCount); // CHANGE
        const rendered = h.tiler.buildDraftTilerGroupPreview(h.graph, group); assert.equal(rendered.actual, previewCount); // CHANGE
        assert.equal(h.undoManager.history.length, 1); h.undoManager.undo(); assert.equal(h.graph.getModel().getCell(group.id), undefined); // CHANGE
    } finally { h.window.USL.allocate?.close(); h.close(); } // CHANGE
}); // CHANGE

test('rounded offset displays retain exact drafts through focus, blur, unrelated edits and remounts', () => { // CHANGE
    const h = setup(); // CHANGE
    try { // CHANGE
        const body = h.window.document.createElement('div'); h.window.document.body.appendChild(body); // CHANGE
        const context = { selectedId: 'proposal', rows: [{ ...h.row, cellId: 'proposal', offsetXCm: 1 / 3, offsetYCm: -1 / 3 }] }; // CHANGE
        let draft; const options = { live: true, proposed: true, fitToDemand: true, onChange: rows => { draft = rows; } }; // CHANGE
        const render = rows => h.graph.__trellisPlantingSpacingEditor.render(body, { ...context, rows }, options); // CHANGE
        render(context.rows); // CHANGE
        let fields = body.querySelectorAll('input[type=number]'); // CHANGE
        assert.equal(fields[2].value, '0'); assert.equal(fields[3].value, '0'); assert.equal(fields[0].value, '30'); // CHANGE
        assert.match(fields[2].title, /Exact offset: 0\.3333333333333333 cm/); // CHANGE
        assert.equal(body.querySelector('[aria-label="Restore plant defaults"]').style.visibility, 'hidden'); // CHANGE
        for (const field of [fields[2], fields[3]]) { field.focus(); assert.equal(field.value, '0'); field.blur(); field.dispatchEvent(new h.window.Event('change')); } // CHANGE
        const save = body.querySelector('input[type=checkbox]'); save.checked = true; save.dispatchEvent(new h.window.Event('change')); // CHANGE
        fields[0].value = '31'; fields[0].dispatchEvent(new h.window.Event('input')); // CHANGE
        assert.equal(Number(draft[0].offsetXCm), 1 / 3); assert.equal(Number(draft[0].offsetYCm), -1 / 3); // CHANGE
        render(draft); fields = body.querySelectorAll('input[type=number]'); // CHANGE
        assert.equal(fields[2].value, '0'); assert.equal(fields[3].value, '0'); // CHANGE
        assert.equal(Number(draft[0].offsetXCm), 1 / 3); assert.equal(Number(draft[0].offsetYCm), -1 / 3); // CHANGE
        assert.equal(h.undoManager.history.length, 0); assert.equal(h.writes.length, 0); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('explicit zero, decimal and stepper edits replace only the edited offset and invalid input stays invalid', () => { // CHANGE
    const h = setup(); // CHANGE
    try { // CHANGE
        const body = h.window.document.createElement('div'); h.window.document.body.appendChild(body); // CHANGE
        let draft, valid; // CHANGE
        h.graph.__trellisPlantingSpacingEditor.render(body, { selectedId: h.row.cellId, rows: [{ ...h.row, offsetXCm: 1 / 3, offsetYCm: -1 / 3 }] }, // CHANGE
            { live: true, proposed: true, fitToDemand: true, onChange: (rows, preview, ok) => { draft = rows; valid = ok; } }); // CHANGE
        const fields = body.querySelectorAll('input[type=number]'), x = fields[2], y = fields[3]; // CHANGE
        x.value = '0'; x.dispatchEvent(new h.window.Event('input')); // CHANGE: the displayed text is unchanged, but this explicit edit removes the fractional offset.
        assert.equal(Number(draft[0].offsetXCm), 0); assert.equal(Number(draft[0].offsetYCm), -1 / 3); // CHANGE
        x.focus(); x.value = '0.3333333333333333'; x.dispatchEvent(new h.window.Event('input')); // CHANGE
        assert.equal(x.value, '0.3333333333333333'); assert.equal(valid, true); // CHANGE
        x.blur(); assert.equal(x.value, '0'); x.dispatchEvent(new h.window.Event('change')); // CHANGE: a duplicate change after formatting cannot overwrite the exact typed decimal.
        assert.equal(Number(draft[0].offsetXCm), 1 / 3); // CHANGE
        x.stepUp(); x.dispatchEvent(new h.window.Event('input')); // CHANGE
        assert.equal(x.value, '1'); assert.equal(Number(draft[0].offsetXCm), 1); assert.equal(Number(draft[0].offsetYCm), -1 / 3); // CHANGE
        y.value = '-1.6'; y.dispatchEvent(new h.window.Event('input')); y.dispatchEvent(new h.window.Event('blur')); // CHANGE
        assert.equal(y.value, '-2'); assert.equal(Number(draft[0].offsetYCm), -1.6); // CHANGE
        for (const value of ['', 'invalid']) { // CHANGE: number inputs sanitize invalid text to blank; neither may be treated as zero.
            y.value = value; y.dispatchEvent(new h.window.Event('input')); y.dispatchEvent(new h.window.Event('blur')); // CHANGE
            assert.equal(y.value, ''); assert.equal(draft[0].offsetYCm, ''); assert.equal(valid, false); // CHANGE
        } // CHANGE
        y.value = '-0.2'; y.dispatchEvent(new h.window.Event('input')); y.dispatchEvent(new h.window.Event('blur')); // CHANGE
        assert.equal(y.value, '0'); assert.equal(Number(draft[0].offsetYCm), -0.2); assert.equal(valid, true); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('saved-group apply and undo preserve untouched fractional offsets behind rounded displays', async () => { // CHANGE
    const h = setup(); // CHANGE
    try { // CHANGE
        for (const [key, value] of [['layout_offset_x_cm', String(1 / 3)], ['layout_offset_y_cm', String(-1 / 3)]]) h.graph.getModel().execute(new h.window.mxCellAttributeChange(h.source, key, value)); // CHANGE
        const before = h.source.value.outerHTML, geometry = JSON.stringify(h.source.geometry); h.undoManager.clear(); // CHANGE
        const context = await h.tools.buildSpacingLayoutRows(h.graph, h.source), body = h.window.document.createElement('div'); h.window.document.body.appendChild(body); // CHANGE
        h.graph.__trellisPlantingSpacingEditor.render(body, context, {}); // CHANGE
        const fields = body.querySelectorAll('input[type=number]'), apply = Array.from(body.querySelectorAll('button')).find(button => button.textContent === 'Apply'); // CHANGE
        assert.equal(fields[2].value, '0'); assert.equal(fields[3].value, '0'); assert.equal(apply.disabled, true); // CHANGE
        fields[0].value = '31'; fields[0].dispatchEvent(new h.window.Event('input')); assert.equal(apply.disabled, false); apply.click(); // CHANGE
        await allocationWait(() => h.undoManager.history.length > 0); // CHANGE
        assert.equal(Number(h.source.getAttribute('layout_offset_x_cm')), 1 / 3); assert.equal(Number(h.source.getAttribute('layout_offset_y_cm')), -1 / 3); // CHANGE
        assert.equal(Number(h.source.getAttribute('spacing_x_cm')), 31); assert.equal(h.undoManager.history.length, 1); // CHANGE
        h.undoManager.undo(); assert.equal(h.source.value.outerHTML, before); assert.equal(JSON.stringify(h.source.geometry), geometry); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('generated patterns, revert and saved defaults retain fractional offsets while displaying rounded values', async () => { // CHANGE
    const h = setup({ diameters: [20, 25] }); // CHANGE
    try { // CHANGE
        const context = await h.tools.prepareCompanionPair(h.graph, h.source, h.row), body = h.window.document.createElement('div'); h.window.document.body.appendChild(body); // CHANGE
        context.hasSetDefault = true; context.setDefault = { rows: context.rows.map((row, index) => ({ ...row, identityKey: 'p:' + row.plantId, offsetXCm: index ? -1 / 3 : 1 / 3, offsetYCm: index ? 1 / 3 : -1 / 3 })) }; // CHANGE
        let draft, preview; // CHANGE
        h.graph.__trellisPlantingSpacingEditor.render(body, context, { proposed: true, onChange: (rows, value) => { draft = rows; preview = value; } }); // CHANGE
        for (const pattern of ['aligned', 'staggered']) { // CHANGE
            const generated = h.tools.generateCompanionPairLayout(h.graph, draft, pattern); body.querySelector('[data-spacing-pattern="' + pattern + '"]').click(); // CHANGE
            const fields = body.querySelectorAll('input[type=number]'); // CHANGE
            draft.forEach((row, index) => { // CHANGE
                assert.equal(Number(row.offsetXCm), generated[index].offsetXCm); assert.equal(Number(row.offsetYCm), generated[index].offsetYCm); // CHANGE
                assert.equal(fields[index * 5 + 2].value, String(Math.round(row.offsetXCm) || 0)); assert.equal(fields[index * 5 + 3].value, String(Math.round(row.offsetYCm) || 0)); // CHANGE
            }); // CHANGE
            assert.equal(preview.status, 'ok'); assert.equal(body.querySelector('.manual-link-spacing-pattern-source').textContent, pattern === 'aligned' ? 'Aligned' : 'Staggered'); // CHANGE
            const x = fields[2]; x.dispatchEvent(new h.window.Event('blur')); x.dispatchEvent(new h.window.Event('change')); // CHANGE
            assert.equal(body.querySelector('.manual-link-spacing-pattern-source').textContent, pattern === 'aligned' ? 'Aligned' : 'Staggered'); // CHANGE
        } // CHANGE
        Array.from(body.querySelectorAll('button')).find(button => button.textContent === 'Apply set default').click(); // CHANGE
        assert.equal(Number(draft[0].offsetXCm), 1 / 3); assert.equal(Number(draft[0].offsetYCm), -1 / 3); // CHANGE
        const fields = body.querySelectorAll('input[type=number]'); assert.equal(fields[2].value, '0'); assert.equal(fields[3].value, '0'); // CHANGE
        body.querySelector('[aria-label="Restore plant defaults"]').click(); // CHANGE
        const original = context.rows[0].plantDefaultLayout || context.rows[0]; // CHANGE
        assert.equal(Number(draft[0].offsetXCm), Number(original.offsetXCm)); assert.equal(Number(draft[0].offsetYCm), Number(original.offsetYCm)); // CHANGE
        assert.equal(fields[2].value, String(Math.round(original.offsetXCm) || 0)); assert.equal(fields[3].value, String(Math.round(original.offsetYCm) || 0)); // CHANGE
        assert.equal(h.undoManager.history.length, 0); assert.equal(h.writes.some(sql => /^\s*(?:INSERT|UPDATE|DELETE)\b/.test(sql)), false); // CHANGE: default-table initialization may issue DDL during companion lookup.
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('saved companion layouts take precedence and invalid saved offsets never expand the footprint', async () => { // CHANGE
    const saved = { rows: [{ identityKey: 'p:1', spacingXCm: 25, spacingYCm: 50, offsetXCm: 0, offsetYCm: 0 }, { identityKey: 'p:2', spacingXCm: 25, spacingYCm: 50, offsetXCm: 0, offsetYCm: 20 }] }; // CHANGE
    const h = setup({ saved }); // CHANGE
    try { // CHANGE
        const context = await h.tools.prepareCompanionPair(h.graph, h.source, h.row); // CHANGE
        assert.equal(context.layoutSource, 'Saved layout'); assert.equal(context.rows[1].offsetYCm, 20); assert.equal(context.rows[0].spacingXCm, 25); // CHANGE
        const before = JSON.stringify(h.source.geometry); context.rows[1].offsetXCm = 10000; // CHANGE
        const preview = h.tools.buildSpacingPreviewModel(h.graph, context.rows); // CHANGE
        assert.equal(preview.status, 'invalid'); assert.match(preview.warning, /footprint|No plants/); // CHANGE
        assert.equal(JSON.stringify(h.source.geometry), before); assert.equal(h.undoManager.history.length, 0); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('spacing Apply reverses all changes if retile fails, without publishing an undo edit', async () => { // CHANGE
    const h = setup(); // CHANGE
    try { // CHANGE
        const context = await h.tools.prepareCompanionPair(h.graph, h.source, h.row); // CHANGE
        const before = h.source.value.cloneNode(true).outerHTML, geometry = JSON.stringify(h.source.geometry); // CHANGE
        const original = h.tiler.retileGroup; h.tiler.retileGroup = () => { throw new Error('injected retile failure'); }; // CHANGE
        assert.throws(() => h.tools.applyLayoutRowsToGraph(h.graph, [context.rows[0]]), /injected retile failure/); // CHANGE
        h.tiler.retileGroup = original; // CHANGE
        assert.equal(h.source.value.outerHTML, before); assert.equal(JSON.stringify(h.source.geometry), geometry); assert.equal(h.undoManager.history.length, 0); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

/** Keep climate scheduling deterministic while exercising the production Allocate controller and editor. */ // CHANGE
async function startAllocate(h, relationKind = 'companion', extraTargets = 0, lifecycleAttributes = {}) { // CHANGE
    const { window } = h, scheduler = window.USL.scheduler; // CHANGE
    const crop = { id: 'basil', cropId: 'basil', plantId: '2', plant: 'Basil', label: 'Basil', method: 'direct_sow.field', kgPerPlant: 1 }; // CHANGE
    const plan = { year: 2027, crops: [crop, { id: 'tomato', plantId: '1', label: 'Tomato', kgPerPlant: 1 }] }; // CHANGE
    const coverage = { plan, totals: { targetKg: 8, shortKg: 8 }, cropSummaries: [{ cropId: 'basil', targetKg: 8, shortKg: 8 }], // CHANGE
        weekStarts: [{ iso: '2027-04-05' }, { iso: '2027-04-12' }], // CHANGE
        weekSummaries: [{ weekIndex: 0, start: '2027-04-05', targetKg: 0, shortKg: 0, cropShortages: [] }, { weekIndex: 1, start: '2027-04-12', targetKg: 8, shortKg: 8, cropShortages: [{ cropId: 'basil', shortKg: 8 }] }] }; // CHANGE
    scheduler.resolveCityForModule = async () => ({ ok: true, city: {} }); // CHANGE
    scheduler.resolvePlantForPlanCrop = async ({ plantId }) => ({ ok: true, plant: h.plants[Number(plantId)-1] }); // CHANGE
    scheduler.listGrowthStagesForPlanCrop = undefined; scheduler.resolveGrowthStageForPlanCrop = undefined; // CHANGE
    scheduler.resolveAllocationDefaultStatus = async () => ({ complete: true }); // CHANGE
    scheduler.proposeLifecycleForDemandWindow = async () => ({ ok: true, status: 'compatible', startISO: '2027-04-05', primaryDateISO: '2027-04-05', // CHANGE
        attributePatch: { sow_date: '2027-04-05', harvest_start: '2027-04-12', harvest_end: '2027-05-12', ...lifecycleAttributes }, taskPreview: [{ title: 'Sow basil', startISO: '2027-04-05', endISO: '2027-04-05' }], warnings: [] }); // CHANGE
    scheduler.listAllocationOverlapRelationships = async () => [{ companionPlantId: '1', conflictKind: relationKind }]; // CHANGE
    const snapshots = []; // CHANGE
    const weekly = (basil, tomato) => ({ perCrop: new Map([['basil', { target: [0, 8], usableSupply: [0, basil], short: [0, Math.max(0, 8-basil)] }], ['tomato', { target: [0, 30], usableSupply: [0, tomato], short: [0, Math.max(0, 30-tomato)] }]]) }); // CHANGE
    window.USL.planningCore = { loadPlanForYear: () => plan, computeYearCoverage: () => coverage, recommendPlantCount: () => ({ plantCount: 8, reachableShortKg: 8 }), // CHANGE
        simulateCandidatePlanting(input) { snapshots.push(input); return { demandServedKg: 8, base: { ...coverage, weekly: weekly(0, Number(h.source.getAttribute('plant_count'))) }, // CHANGE
            coverage: { ...coverage, weekly: weekly(input.candidate.plantCount, input.plantingCountOverrides?.[h.source.id] ?? Number(h.source.getAttribute('plant_count'))) } }; } }; // CHANGE
    for (let i = 0; i < extraTargets; i++) h.tiler.createPlantingFromProposal({ moduleCell: h.moduleCell, attributes: { plant_id: '1', plant_name: 'Tomato', sow_date: '2027-04-01', harvest_end: '2027-07-01' }, // CHANGE
        proposal: { ok: true, geometry: { ...h.source.geometry }, plantCount: 4, spacingXCm: 30, spacingYCm: 30, vegDiameterCm: 20 } }); // CHANGE
    let taskCalls = 0; // CHANGE
    window.USL.tasks = { applySchedulerTaskReplacement({ targetGroupId }) { taskCalls++; h.graph.insertVertex(h.moduleCell, null, 'Sow basil', 0, 0, 10, 10); } }; // CHANGE
    window.eval(fs.readFileSync(path.join(h.plugins, 'Bed_Succession_Navigator.js'), 'utf8')); // CHANGE: inline allocation controls use the production panel host.
    window.eval(fs.readFileSync(path.join(h.plugins, 'Allocate_Planner.js'), 'utf8')); // CHANGE
    h.graph.setSelectionCell(h.bed); // CHANGE
    const state = await window.USL.allocate.open(h.moduleCell, 2027); // CHANGE
    await until(() => state.scheduleProgress.phase === 'complete'); // CHANGE
    state.hudRefs.cropSelect.value = 'basil'; state.hudRefs.cropSelect.dispatchEvent(new window.Event('change')); // CHANGE
    await until(() => state.bedResults.get(h.bed.id)?.bedRelationships); // CHANGE
    h.undoManager.clear(); // CHANGE
    return { state, snapshots, tasks: () => taskCalls }; // CHANGE
} // CHANGE
async function until(condition) { // CHANGE
    for (let i = 0; i < 200; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 10)); } // CHANGE
    throw new Error('Condition timed out'); // CHANGE
} // CHANGE
function dialogButton(h, text) { return Array.from(h.getDialog().querySelectorAll('button')).find(button => button.textContent === text); } // CHANGE

test('Allocate companion preview cancels cleanly, then commits both groups and tasks in one undoable edit', async () => { // CHANGE
    const h = setup(); // CHANGE
    try { // CHANGE
        const { state, snapshots, tasks } = await startAllocate(h); // CHANGE
        assert.match(h.graph.container.querySelector('[data-bed-id]').textContent, /Companion: 1/); // CHANGE
        state.hudRefs.companion.click(); await until(() => state.draft?.companionLayout && !state.spacingPending && !state.reviewing); // CHANGE: inline editing replaces the companion dialog.
        const beforeCount = h.source.getAttribute('plant_count'); // CHANGE
        const defaults = state.spacingBody.querySelector('input[type=checkbox]'); assert.equal(defaults.checked, false); defaults.checked = true; defaults.dispatchEvent(new h.window.Event('change')); // CHANGE
        await until(() => state.draft?.companionLayout.saveDefaults && !state.spacingPending); // CHANGE: review remains disabled until the latest editor event publishes its draft.
        assert.equal(h.undoManager.history.length, 0); assert.equal(tasks(), 0); assert.equal(h.source.getAttribute('plant_count'), beforeCount); // CHANGE
        state.hudRefs.create.click(); await until(() => !!h.getDialog()); dialogButton(h, 'Cancel').click(); await until(() => !state.reviewing); // CHANGE: cancelling review never commits the live draft.
        assert.equal(h.undoManager.history.length, 0); assert.equal(tasks(), 0); assert.equal(h.writes.some(sql => /INSERT.*CompanionSetLayoutDefaults/s.test(sql)), false); // CHANGE
        state.hudRefs.companion.click(); await until(() => state.draft?.companionLayout && !state.spacingPending && !state.reviewing); // CHANGE: inline editing replaces the companion dialog.
        assert.ok(snapshots.some(input => input.plantingCountOverrides?.[h.source.id] != null)); // CHANGE
        const saveDefaults = state.spacingBody.querySelector('input[type=checkbox]'); assert.equal(saveDefaults.checked, false); saveDefaults.checked = true; saveDefaults.dispatchEvent(new h.window.Event('change')); // CHANGE
        await until(() => state.draft?.companionLayout.saveDefaults && !state.spacingPending); // CHANGE
        state.hudRefs.create.click(); await until(() => h.getDialog()?.textContent.includes('Generated tasks')); // CHANGE: the HUD reviews the current inline draft.
        assert.match(h.getDialog().textContent, /Tomato: shortage/); assert.equal(h.getDialog().textContent.includes('\\n'), false); // CHANGE
        assert.match(h.getDialog().textContent, /2027-05-12/); // CHANGE
        dialogButton(h, 'Create anyway').click(); await until(() => !state.reviewing); // CHANGE
        assert.equal(tasks(), 1, state.noticeMessage); assert.ok(h.writes.some(sql => /INSERT.*CompanionSetLayoutDefaults/s.test(sql)), state.noticeMessage); // CHANGE
        const added = h.tiler.listPlantingFootprints(h.moduleCell, { includeUndatedOccupancy: true }).find(item => item.plantId === '2'); // CHANGE
        assert.ok(added, state.noticeMessage); assert.equal(added.harvestEndISO, '2027-05-12'); // CHANGE
        assert.equal(h.undoManager.history.length, 1); h.undoManager.undo(); // CHANGE
        assert.equal(h.source.getAttribute('plant_count'), beforeCount); assert.equal(h.graph.getModel().getCell(added.groupId), undefined); // CHANGE
        h.undoManager.redo(); assert.ok(h.graph.getModel().getCell(added.groupId)); // CHANGE
        h.window.USL.allocate.close(); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('Allocate disables incompatible beds and requires a target chooser for repeated companions', async () => { // CHANGE
    const blocked = setup(); // CHANGE
    try { const { state } = await startAllocate(blocked, 'incompatible'); assert.equal(state.hudRefs.companion.disabled, true); state.hudRefs.companion.click(); assert.equal(blocked.getDialog(), null); blocked.window.USL.allocate.close(); } // CHANGE
    finally { blocked.close(); } // CHANGE
    const h = setup(); // CHANGE
    try { // CHANGE
        const { state } = await startAllocate(h, 'companion', 1); state.hudRefs.companion.click(); await until(() => !!state.spacingBody && !state.reviewing); // CHANGE
        const choose = state.spacingBody.querySelector('[aria-label="Companion footprint"]'); assert.equal(choose.value, ''); assert.equal(choose.options.length, 3); // CHANGE
        assert.match(choose.options[1].textContent, /2027-04-01 to 2027-07-01/); // CHANGE
        assert.equal(state.spacingBody.querySelector('[data-spacing-pattern]'), null); choose.value = h.source.id; choose.dispatchEvent(new h.window.Event('change')); // CHANGE
        await until(() => state.draft?.companionLayout && !state.spacingPending); assert.equal(h.getDialog(), null); // CHANGE
        const initialSpacing = state.companionRows.map(row => Number(row.spacingXCm)); // CHANGE: generated companion defaults can differ from each crop's ordinary spacing.
        const fields = state.spacingBody.querySelectorAll('input[type=number]'); fields[0].value = '45'; fields[5].value = '15'; fields[5].dispatchEvent(new h.window.Event('input')); // CHANGE
        await until(() => state.draft?.companionLayout && !state.spacingPending); // CHANGE
        const nextTarget = choose.options[2].value, nextChooser = state.spacingBody.querySelector('[aria-label="Companion footprint"]'); // CHANGE
        nextChooser.value = nextTarget; nextChooser.dispatchEvent(new h.window.Event('change')); // CHANGE
        await until(() => state.draft?.companionLayout.targetId === nextTarget && !state.spacingPending); // CHANGE
        state.companionRows.forEach((row, index) => assert.ok(Math.abs(Number(row.spacingXCm) - initialSpacing[index]) < 1e-8)); // CHANGE: switching footprints discards both halves of the previous pair's edits; generated pitches permit floating-point rounding.
        h.window.USL.allocate.close(); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('companion allocation lifecycle Edit preserves the chosen layout and deferred-default choices through revalidation', async () => { // CHANGE
    const h = setup(); // CHANGE
    try { // CHANGE
        const { state, tasks } = await startAllocate(h); // CHANGE
        let savedCell, fitted; // CHANGE
        h.window.USL.scheduler.openAllocationScheduleDialog = async (ui, draft, options) => { // CHANGE
            assert.ok(draft.companionLayout); assert.equal(draft.bedOccupancy, state.occupancy); // CHANGE
            const lifecycle = { ...draft.lifecycle, startISO: '2027-04-12', primaryDateISO: '2027-04-12', attributePatch: { ...draft.lifecycle.attributePatch, sow_date: '2027-04-12', harvest_start: '2027-04-19', harvest_end: '2027-05-19' }, taskPreview: [{ title: 'Edited sow task', startISO: '2027-04-12', endISO: '2027-04-12' }] }; // CHANGE
            const candidate = { ...draft, lifecycle, actionStartISO: lifecycle.startISO, taskPreview: lifecycle.taskPreview, saveLifecycleDefaults: true, saveSpacingDefaults: true, commitAllocationDefaults: async cell => { savedCell = cell; } }; // CHANGE
            fitted = await options.revalidateDraft(candidate); // CHANGE
            const outside = await options.revalidateDraft({ ...candidate, lifecycle: { ...lifecycle, primaryDateISO: '2027-08-01', startISO: '2027-08-01', attributePatch: { harvest_start: '2027-08-08', harvest_end: '2027-09-01' } } }); // CHANGE
            assert.equal(outside.ok, false); assert.match(outside.reason, /No companion|no longer overlaps/); // CHANGE
            return { action: 'preview', draft: fitted }; // CHANGE
        }; // CHANGE
        state.hudRefs.companion.click(); await until(() => state.draft?.companionLayout && !state.spacingPending && !state.reviewing); // CHANGE: inline editing replaces the companion dialog.
        state.hudRefs.create.click(); await until(() => h.getDialog()?.textContent.includes('Generated tasks')); // CHANGE: the HUD reviews the current inline draft.
        dialogButton(h, 'Edit').click(); await until(() => !state.reviewing); // CHANGE
        assert.equal(fitted.ok, true); assert.equal(state.draft.harvestEnd, '2027-05-19'); // CHANGE
        assert.equal(state.draft.companionLayout.targetId, h.source.id); assert.equal(state.draft.geometry.sharedFootprint, true); // CHANGE
        assert.equal(state.draft.saveLifecycleDefaults, true); assert.equal(state.draft.saveSpacingDefaults, true); // CHANGE
        assert.equal(savedCell, undefined); assert.equal(tasks(), 0); assert.equal(h.undoManager.history.length, 0); // CHANGE
        state.hudRefs.create.click(); await until(() => h.getDialog()?.textContent.includes('Generated tasks')); // CHANGE
        dialogButton(h, 'Create anyway').click(); await until(() => !state.reviewing); // CHANGE
        assert.ok(savedCell?.id, state.noticeMessage); assert.equal(tasks(), 1); // CHANGE
        h.window.USL.allocate.close(); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('ordinary planting Spacing exposes both patterns and commits only the chosen pair with undo', async () => { // CHANGE
    const h = setup(); // CHANGE
    try { // CHANGE
        const pair = await h.tools.prepareCompanionPair(h.graph, h.source, h.row), row = pair.rows[1]; // CHANGE
        const proposalPreview = h.tools.buildSpacingPreviewModel(h.graph, pair.rows).rows[1].groupPreview; // CHANGE
        const companion = h.tiler.createPlantingFromProposal({ moduleCell: h.moduleCell, attributes: { plant_id: '2', plant_name: 'Basil', plant_abbr: 'BAS', plant_yield: '1', sow_date: '2027-04-15', harvest_end: '2027-08-01' }, // CHANGE
            proposal: { ok: true, sharedFootprint: true, geometry: row.modelRect, rotation: row.rotationDeg, plantCount: proposalPreview.actual, spacingXCm: row.spacingXCm, spacingYCm: row.spacingYCm, // CHANGE
                vegDiameterCm: row.vegDiameterCm, layoutOffsetXCm: row.offsetXCm, layoutOffsetYCm: row.offsetYCm, disabledSlots: proposalPreview.disabledSlots } }); // CHANGE
        const context = await h.tools.buildSpacingLayoutRows(h.graph, h.source); // CHANGE
        assert.equal(context.companionTargets[0].cellId, companion.id); // CHANGE
        const before = h.source.value.outerHTML, beforeCompanion = companion.value.outerHTML; h.undoManager.clear(); // CHANGE
        const body = h.window.document.createElement('div'); h.window.document.body.appendChild(body); // CHANGE
        h.graph.__trellisPlantingSpacingEditor.render(body, context, {}); // CHANGE
        const staggered = body.querySelector('[data-spacing-pattern="staggered"]'); assert.equal(staggered.disabled, false); staggered.click(); // CHANGE
        const apply = Array.from(body.querySelectorAll('button')).find(button => button.textContent === 'Apply'); assert.equal(apply.disabled, false); apply.click(); // CHANGE
        await until(() => h.undoManager.history.length > 0); // CHANGE
        assert.equal(h.undoManager.history.length, 1); assert.notEqual(h.source.value.outerHTML, before); // CHANGE
        h.undoManager.undo(); assert.equal(h.source.value.outerHTML, before); assert.equal(companion.value.outerHTML, beforeCompanion); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('unknown bed relationships always appear in companion review and do not suppress it', async () => { // CHANGE
    const h = setup(); // CHANGE
    try { // CHANGE
        h.tiler.createPlantingFromProposal({ moduleCell: h.moduleCell, attributes: { plant_id: '3', plant_name: 'Unknown crop', sow_date: '2027-04-01', harvest_end: '2027-07-01' }, // CHANGE
            proposal: { ok: true, geometry: { ...h.source.geometry }, plantCount: 4, spacingXCm: 30, spacingYCm: 30 } }); // CHANGE
        const { state } = await startAllocate(h); state.hudRefs.companion.click(); await until(() => state.draft?.companionLayout && !state.spacingPending && !state.reviewing); // CHANGE: inline editing replaces the companion dialog.
        assert.match(state.spacingBody.textContent, /Unknown relationship: Unknown crop/); // CHANGE
        state.hudRefs.create.click(); await until(() => h.getDialog()?.textContent.includes('Generated tasks')); // CHANGE: the HUD reviews the current inline draft.
        assert.match(h.getDialog().textContent, /Unknown relationship: Unknown crop/); assert.equal(h.getDialog().textContent.includes("Don't show again"), false); // CHANGE
        dialogButton(h, 'Cancel').click(); await until(() => !state.reviewing); assert.equal(h.undoManager.history.length, 0); h.window.USL.allocate.close(); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('zero-capacity edits and model changes cannot commit a stale companion preview', async () => { // CHANGE
    const h = setup(); // CHANGE
    try { // CHANGE
        const { state, tasks } = await startAllocate(h); state.hudRefs.companion.click(); await until(() => state.draft?.companionLayout && !state.spacingPending && !state.reviewing); // CHANGE: inline editing replaces the companion dialog.
        // Allocate uses its own proposed descriptor ID; target the second planting row. // CHANGE
        const controls = state.spacingBody.querySelectorAll('.manual-link-spacing-row'); // CHANGE
        const offset = controls[1].querySelectorAll('input')[2]; offset.value = '100000'; offset.dispatchEvent(new h.window.Event('input')); // CHANGE
        assert.equal(state.hudRefs.create.disabled, true); assert.equal(tasks(), 0); // CHANGE
        h.graph.getModel().execute(new h.window.mxCellAttributeChange(h.source, 'spacing_y_cm', '35')); // CHANGE
        await until(() => !state.reviewing); assert.equal(h.getDialog(), null); assert.equal(tasks(), 0); // CHANGE
        h.window.USL.allocate.close(); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('failed task creation rolls back resized crops and the new planting', async () => { // CHANGE
    const h = setup(); // CHANGE
    try { // CHANGE
        const { state } = await startAllocate(h); const before = h.source.value.outerHTML; // CHANGE
        h.window.USL.tasks.applySchedulerTaskReplacement = () => { throw new Error('injected task failure'); }; // CHANGE
        state.hudRefs.companion.click(); await until(() => state.draft?.companionLayout && !state.spacingPending && !state.reviewing); // CHANGE: inline editing replaces the companion dialog.
        state.hudRefs.create.click(); await until(() => h.getDialog()?.textContent.includes('Generated tasks')); // CHANGE: the HUD reviews the current inline draft.
        dialogButton(h, 'Create anyway').click(); await until(() => !state.reviewing); // CHANGE
        assert.match(state.noticeMessage, /injected task failure/); assert.equal(h.source.value.outerHTML, before); // CHANGE
        assert.equal(h.tiler.listPlantingFootprints(h.moduleCell, { includeUndatedOccupancy: true }).filter(item => item.plantId === '2').length, 0); // CHANGE
        assert.equal(h.undoManager.history.length, 0); h.window.USL.allocate.close(); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('plant-level saved companion layout is used when no variety-specific layout exists', async () => { // CHANGE
    const saved = { rows: [{ identityKey: 'p:1', spacingXCm: 25, spacingYCm: 50, offsetXCm: 0, offsetYCm: 0 }, { identityKey: 'p:2', spacingXCm: 25, spacingYCm: 50, offsetXCm: 0, offsetYCm: 20 }] }; // CHANGE
    const h = setup(); // CHANGE
    try { // CHANGE
        const query = h.window.dbBridge.query, keys = []; h.row.varietyId = '7'; // CHANGE
        h.window.dbBridge.query = async (id, sql, params) => { // CHANGE
            if (sql.includes('FROM CompanionSetLayoutDefaults')) { keys.push(params[0]); return { rows: params[0] === 'p:1+p:2' ? [{ crop_set_key: params[0], layout_json: JSON.stringify(saved) }] : [] }; } // CHANGE
            return query(id, sql, params); // CHANGE
        }; // CHANGE
        const pair = await h.tools.prepareCompanionPair(h.graph, h.source, h.row); // CHANGE
        assert.equal(pair.layoutSource, 'Saved layout'); assert.equal(pair.rows[1].offsetYCm, 20); assert.deepEqual(keys, ['p:1+v:7', 'p:1+p:2']); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE


test('closing companion review clears the busy state without graph or default changes', async () => { // CHANGE
    const h = setup(); // CHANGE
    try { // CHANGE
        const { state, tasks } = await startAllocate(h); const before = h.source.value.outerHTML; // CHANGE
        state.hudRefs.companion.click(); await until(() => state.draft?.companionLayout && !state.spacingPending && !state.reviewing); // CHANGE: inline editing replaces the companion dialog.
        state.hudRefs.create.click(); await until(() => h.getDialog()?.textContent.includes('Generated tasks')); // CHANGE: the HUD reviews the current inline draft.
        h.ui.hideDialog(); await until(() => !state.reviewing); // CHANGE
        assert.equal(h.source.value.outerHTML, before); assert.equal(tasks(), 0); assert.equal(h.writes.some(sql => /^\s*(?:INSERT|UPDATE|DELETE)\b/.test(sql)), false); assert.equal(h.undoManager.history.length, 0); // CHANGE
        h.window.USL.allocate.close(); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE


test('Allocate perennial badges include companion occupancy after the first harvest year', async () => { // CHANGE
    const h = setup(); // CHANGE
    try { // CHANGE
        const model = h.graph.getModel(); // CHANGE
        model.execute(new h.window.mxCellAttributeChange(h.source, 'sow_date', '2028-04-01')); // CHANGE
        model.execute(new h.window.mxCellAttributeChange(h.source, 'harvest_start', '2028-06-01')); // CHANGE
        model.execute(new h.window.mxCellAttributeChange(h.source, 'harvest_end', '2028-07-01')); // CHANGE
        const { state } = await startAllocate(h, 'companion', 0, { lifespan_start: '2027-04-05', lifespan_end: '2029-10-01' }); // CHANGE
        const summary = state.bedResults.get(h.bed.id).bedRelationships; // CHANGE
        assert.equal(summary.companion.length, 1); assert.equal(summary.companion[0].overlapStartISO, '2028-04-01'); // CHANGE
        assert.equal(state.hudRefs.companion.disabled, false); h.window.USL.allocate.close(); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE
