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
        h.graph.__trellisPlantingSpacingEditor.render(body, context, { proposed: true, applyLabel: 'Review companion', onChange: (rows, value) => { preview = value; }, onApply: () => { applied = true; } }); // CHANGE
        assert.equal(preview.status, 'ok'); // CHANGE
        body.querySelector('[data-spacing-pattern="staggered"]').click(); // CHANGE
        assert.equal(preview.status, 'ok'); assert.ok(body.textContent.includes('Staggered')); // CHANGE
        const patternSource = body.querySelector('.manual-link-spacing-pattern-source'), offset = body.querySelectorAll('.manual-link-spacing-row')[1].querySelectorAll('input')[2]; // CHANGE
        const generatedOffset = offset.value; offset.value = String(Number(generatedOffset) + 1); offset.dispatchEvent(new h.window.Event('input')); // CHANGE
        assert.equal(patternSource.textContent, 'Custom'); offset.value = generatedOffset; offset.dispatchEvent(new h.window.Event('input')); // CHANGE
        assert.equal(patternSource.textContent, 'Staggered'); // CHANGE
        assert.equal(h.undoManager.history.length, 0); assert.equal(h.writes.length, writes); // CHANGE
        assert.equal(h.graph.getModel().getCell('new-companion'), undefined); // CHANGE
        const review = Array.from(body.querySelectorAll('button')).find(button => button.textContent === 'Review companion'); review.click(); // CHANGE
        assert.equal(applied, true); h.graph.__trellisPlantingSpacingEditor.clear(); // CHANGE
        assert.equal(h.undoManager.history.length, 0); // CHANGE
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
        state.hudRefs.companion.click(); await until(() => h.getDialog()?.querySelector('[data-spacing-pattern]')); // CHANGE
        const beforeCount = h.source.getAttribute('plant_count'); // CHANGE
        const defaults = h.getDialog().querySelector('input[type=checkbox]'); assert.equal(defaults.checked, false); defaults.checked = true; // CHANGE
        assert.equal(h.undoManager.history.length, 0); assert.equal(tasks(), 0); assert.equal(h.source.getAttribute('plant_count'), beforeCount); // CHANGE
        dialogButton(h, 'Cancel').click(); await until(() => !state.reviewing); // CHANGE
        assert.equal(h.undoManager.history.length, 0); assert.equal(tasks(), 0); assert.equal(h.writes.some(sql => /INSERT.*CompanionSetLayoutDefaults/s.test(sql)), false); // CHANGE
        state.hudRefs.companion.click(); await until(() => h.getDialog()?.querySelector('[data-spacing-pattern]')); // CHANGE
        assert.ok(snapshots.some(input => input.plantingCountOverrides?.[h.source.id] != null)); // CHANGE
        const saveDefaults = h.getDialog().querySelector('input[type=checkbox]'); assert.equal(saveDefaults.checked, false); saveDefaults.checked = true; // CHANGE
        dialogButton(h, 'Review companion').click(); await until(() => h.getDialog()?.textContent.includes('Generated tasks')); // CHANGE
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
        const { state } = await startAllocate(h, 'companion', 1); state.hudRefs.companion.click(); await until(() => !!h.getDialog()); // CHANGE
        const choose = h.getDialog().querySelector('[aria-label="Companion footprint"]'); assert.equal(choose.value, ''); assert.equal(choose.options.length, 3); // CHANGE
        assert.match(choose.options[1].textContent, /2027-04-01 to 2027-07-01/); // CHANGE
        assert.equal(h.getDialog().querySelector('[data-spacing-pattern]'), null); choose.value = h.source.id; choose.dispatchEvent(new h.window.Event('change')); // CHANGE
        await until(() => h.getDialog()?.querySelector('[data-spacing-pattern]')); dialogButton(h, 'Cancel').click(); await until(() => !state.reviewing); h.window.USL.allocate.close(); // CHANGE
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
        state.hudRefs.companion.click(); await until(() => h.getDialog()?.querySelector('[data-spacing-pattern]')); // CHANGE
        dialogButton(h, 'Review companion').click(); await until(() => h.getDialog()?.textContent.includes('Generated tasks')); // CHANGE
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
        const { state } = await startAllocate(h); state.hudRefs.companion.click(); await until(() => h.getDialog()?.querySelector('[data-spacing-pattern]')); // CHANGE
        assert.match(h.getDialog().textContent, /Unknown relationship: Unknown crop/); // CHANGE
        dialogButton(h, 'Review companion').click(); await until(() => h.getDialog()?.textContent.includes('Generated tasks')); // CHANGE
        assert.match(h.getDialog().textContent, /Unknown relationship: Unknown crop/); assert.equal(h.getDialog().textContent.includes("Don't show again"), false); // CHANGE
        dialogButton(h, 'Cancel').click(); await until(() => !state.reviewing); assert.equal(h.undoManager.history.length, 0); h.window.USL.allocate.close(); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('zero-capacity edits and model changes cannot commit a stale companion preview', async () => { // CHANGE
    const h = setup(); // CHANGE
    try { // CHANGE
        const { state, tasks } = await startAllocate(h); state.hudRefs.companion.click(); await until(() => h.getDialog()?.querySelector('[data-spacing-pattern]')); // CHANGE
        // Allocate uses its own proposed descriptor ID; target the second planting row. // CHANGE
        const controls = h.getDialog().querySelectorAll('.manual-link-spacing-row'); // CHANGE
        const offset = controls[1].querySelectorAll('input')[2]; offset.value = '100000'; offset.dispatchEvent(new h.window.Event('input')); // CHANGE
        assert.equal(dialogButton(h, 'Review companion').disabled, true); assert.equal(tasks(), 0); // CHANGE
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
        state.hudRefs.companion.click(); await until(() => h.getDialog()?.querySelector('[data-spacing-pattern]')); // CHANGE
        dialogButton(h, 'Review companion').click(); await until(() => h.getDialog()?.textContent.includes('Generated tasks')); // CHANGE
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
        state.hudRefs.companion.click(); await until(() => h.getDialog()?.querySelector('[data-spacing-pattern]')); // CHANGE
        dialogButton(h, 'Review companion').click(); await until(() => h.getDialog()?.textContent.includes('Generated tasks')); // CHANGE
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
