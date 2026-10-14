const assert = require('node:assert/strict'); // CHANGE
const fs = require('node:fs'); // CHANGE
const path = require('node:path'); // CHANGE
const test = require('node:test'); // CHANGE
const { loadPlantTilerMxGraph } = require('./helpers/plant-tiler-mxgraph-harness.cjs'); // CHANGE
const { createRegularSpacingFixture } = require('./helpers/regular-spacing-preview.cjs'); // CHANGE
const { assertFootprintFrame } = require('./helpers/planting-preview-geometry.cjs'); // CHANGE

/** Load production plugins; reference data has no saved defaults and records all attempted writes. */ // CHANGE
async function setup(t, options = {}) { // CHANGE
    const h = loadPlantTilerMxGraph(); t.after(h.close); // CHANGE
    const { window: w, graph } = h, writes = []; // CHANGE
    w.dbBridge = { resolvePath: async () => ({ dbPath: 'spacing-preview' }), open: async () => ({ dbId: 'spacing-preview' }), close: async () => {}, query: async () => ({ rows: [] }), exec: async (...args) => { writes.push(args); return {}; } }; // CHANGE
    w.__TRELLIS_PLANTING_SCHEDULER_TEST__ = true; // CHANGE
    for (const name of ['Garden_Roadmap_Core.js', 'Garden_Roadmap_Manager.js', 'Modules_Standalone.js', 'Garden_Scheduler_Shared_Core.js', 'Garden_Scheduler_Annual_Core.js', 'Garden_Scheduler_Perennial_Core.js', 'Garden_Scheduler_Dialog.js']) { // CHANGE
        w.eval(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins', name), 'utf8')); // CHANGE
    } // CHANGE
    const fixture = await createRegularSpacingFixture(w, graph, options); h.undoManager.clear(); // CHANGE: setup commands are outside the preview/apply assertions.
    return Object.assign(h, fixture, { writes }); // CHANGE
} // CHANGE

/** Compare generated frames and every circle against their canonical geometry plus the current anchor displacement. */ // CHANGE
function assertAligned(h, preview, sourceRows = null) { // CHANGE
    const { graph, window: w } = h, view = graph.view, scale = view.scale, tr = view.translate; // CHANGE
    const host = w.document.querySelector('.manual-link-spacing-preview'); assert.ok(host); // CHANGE
    for (const row of preview.rows) { // CHANGE
        const state = view.getState(graph.model.getCell(row.cellId)); // CHANGE
        const canonical = sourceRows?.find(item => item.cellId === row.cellId)?.rect || row.rect; // CHANGE
        const original = h.groups.find(group => group.id === row.cellId)?.getGeometry(); // CHANGE
        let savedX = original.x, savedY = original.y; // CHANGE
        for (let parent = graph.model.getParent(state.cell); parent; parent = graph.model.getParent(parent)) { const g = parent.getGeometry(); if (g) { savedX += g.x; savedY += g.y; } } // CHANGE
        const dx = state.x / scale - tr.x - savedX, dy = state.y / scale - tr.y - savedY; // CHANGE
        const frame = host.querySelector('[data-spacing-preview-cell="' + row.cellId + '"]'); assert.ok(frame); // CHANGE
        assertFootprintFrame(frame, { ...row.rect, x: canonical.x + dx, y: canonical.y + dy }, row.groupPreview.contentBounds, row.groupPreview.rotationDeg || 0, scale, tr); // CHANGE: validate the footprint, including its top header boundary, around the original group pivot.
        const title = host.querySelector('[data-spacing-preview-title="' + row.cellId + '"]'); assert.ok(title); // CHANGE: real regular-overlay drafts share the upright title renderer with Allocate.
        assert.equal(title.parentNode, host); assert.doesNotMatch(title.style.transform, /rotate/); // CHANGE
        assert.equal(title.style.borderBottom, ''); // CHANGE: the footprint's top edge replaces the upright title underline.
        const radians = (row.groupPreview.rotationDeg || 0) * Math.PI / 180, offset = 2 + parseFloat(title.style.height) / 2 - row.rect.height * scale / 2; // CHANGE
        const centerX = (canonical.x + dx + tr.x + row.rect.width / 2) * scale, centerY = (canonical.y + dy + tr.y + row.rect.height / 2) * scale; // CHANGE
        assert.ok(Math.abs(parseFloat(title.style.left) - (centerX - offset * Math.sin(radians))) < 1e-6); assert.ok(Math.abs(parseFloat(title.style.top) - (centerY + offset * Math.cos(radians))) < 1e-6); // CHANGE
    } // CHANGE
    const circles = Array.from(host.querySelectorAll('.manual-link-spacing-preview-plant')); // CHANGE
    let index = 0; // CHANGE
    for (const row of preview.rows) { // CHANGE
        const state = view.getState(graph.model.getCell(row.cellId)); // CHANGE: circles retain full-group coordinates rather than following the smaller frame's origin.
        const canonical = sourceRows?.find(item => item.cellId === row.cellId)?.rect || row.rect; // CHANGE
        const group = h.groups.find(group => group.id === row.cellId), original = group.getGeometry(); // CHANGE
        let savedX = original.x, savedY = original.y; // CHANGE
        for (let parent = graph.model.getParent(group); parent; parent = graph.model.getParent(parent)) { const g = parent.getGeometry(); if (g) { savedX += g.x; savedY += g.y; } } // CHANGE
        const dx = state.x / scale - tr.x - savedX, dy = state.y / scale - tr.y - savedY; // CHANGE
        for (const dot of row.groupPreview.circles) { // CHANGE
            const circle = circles[index++], radius = Math.max(2, dot.r * scale); // CHANGE
            assert.ok(Math.abs(parseFloat(circle.style.left) + radius - (dot.x + canonical.x - row.rect.x + dx + tr.x) * scale) <= 1); // CHANGE
            assert.ok(Math.abs(parseFloat(circle.style.top) + radius - (dot.y + canonical.y - row.rect.y + dy + tr.y) * scale) <= 1); // CHANGE
        } // CHANGE
    } // CHANGE
    assert.equal(circles.length, index); // CHANGE
} // CHANGE

test('regular spacing follows personal projection, zoom, scroll and root changes without rebuilding the draft', async t => { // CHANGE
    const h = await setup(t), { graph, window: w } = h; // CHANGE
    const entry = await h.open(), before = h.serialize(), history = h.undoManager.history.length; // CHANGE
    const field = h.edit(entry), rows = await h.tools.buildSpacingLayoutRows(graph, h.groups[0]); // CHANGE
    rows.rows[0].spacingXCm = 33; const preview = h.tools.buildSpacingPreviewModel(graph, rows.rows), canonical = JSON.stringify(preview); // CHANGE
    assert.notEqual(graph.getCellGeometry(h.outer).x, h.outer.getGeometry().x, 'fixture must expose saved/displayed origins'); // CHANGE
    for (const scale of [1.35, 1.75]) { // CHANGE
        graph.view.scaleAndTranslate(scale, 5, 10); graph.container.scrollLeft = 300; graph.container.scrollTop = 250; await h.settle(); // CHANGE
        assertAligned(h, preview); assert.equal(entry.panel.querySelector('input[type=number]'), field); assert.equal(w.document.activeElement, field); assert.equal(field.value, '33'); // CHANGE
    } // CHANGE
    h.roadmap.setViewState(h.board, { today: { multiplier: 3 } }); await h.settle(); assertAligned(h, preview); // CHANGE
    assert.equal(w.document.activeElement, field); assert.equal(field.value, '33'); // CHANGE
    assert.equal(graph.view.getState(h.groups[0]).shape.node.style.opacity, '0'); // CHANGE
    graph.view.setCurrentRoot(h.garden); await h.settle(); assertAligned(h, preview); // CHANGE
    graph.view.setCurrentRoot(null); await h.settle(); assertAligned(h, preview); // CHANGE
    assert.equal(h.serialize(), before); assert.equal(h.undoManager.history.length, history); assert.equal(h.writes.length, 0); assert.equal(JSON.stringify(preview), canonical); // CHANGE
}); // CHANGE

test('missing anchors suspend and resume spacing while cleanup restores shapes and preserves other owners', async t => { // CHANGE
    const h = await setup(t), { graph, window: w } = h, entry = await h.open(); // CHANGE
    const field = h.edit(entry), service = graph.__trellisPlantingGroup.preview, view = graph.view; // CHANGE
    service.render('allocate:sentinel', { className: 'trellis-allocate-ghost', rows: [{ rect: { x: 0, y: 0, width: 20, height: 20 }, circles: [] }] }); // CHANGE
    const getState = view.getState, node = getState.call(view, h.groups[0]).shape.node; // CHANGE
    view.getState = function (cell, ...args) { return cell === h.groups[0] ? null : getState.call(this, cell, ...args); }; // CHANGE
    service.refresh(); assert.equal(w.document.querySelector('.manual-link-spacing-preview'), null); assert.notEqual(node.style.opacity, '0'); // CHANGE
    assert.equal(field.value, '33'); view.getState = getState; service.refresh(); // CHANGE
    assert.ok(w.document.querySelector('.manual-link-spacing-preview')); assert.equal(node.style.opacity, '0'); // CHANGE
    const handles = graph.selectionCellsHandler.getHandler(h.groups[0]); assert.equal(handles.sizers[0].node.style.display, 'none'); // CHANGE
    field.value = '30'; field.dispatchEvent(new w.Event('input')); // CHANGE
    assert.equal(w.document.querySelector('.manual-link-spacing-preview'), null); assert.notEqual(node.style.opacity, '0'); assert.notEqual(handles.sizers[0].node.style.display, 'none'); // CHANGE
    h.edit(entry); graph.setSelectionCell(h.bed); await h.settle(); assert.equal(w.document.querySelector('.manual-link-spacing-preview'), null); // CHANGE
    const reopened = await h.open(); h.edit(reopened); graph.removeCells([h.groups[0]]); await h.settle(); // CHANGE
    assert.equal(w.document.querySelector('.manual-link-spacing-preview'), null); assert.ok(w.document.querySelector('.trellis-allocate-ghost')); // CHANGE
}); // CHANGE

for (const pattern of ['aligned', 'staggered']) test(pattern + ' generated frames and rotated bed context project together without changing commits', async t => { // CHANGE
    const h = await setup(t), { graph, window: w } = h; // CHANGE
    const contexts = await Promise.all(h.groups.map(group => h.tools.buildSpacingLayoutRows(graph, group))); // CHANGE
    const rows = contexts.map(context => context.rows[0]), generated = h.tools.generateCompanionPairLayout(graph, rows, pattern); // CHANGE
    const before = h.serialize(), beforeGeometries = h.groups.map(group => JSON.stringify(group.getGeometry())); // CHANGE
    graph.setSelectionCell(h.groups[0]); // CHANGE
    const entry = h.overlay.registry.get(h.groups[0].id), body = w.document.createElement('div'); entry.panel.appendChild(body); // CHANGE
    const context = { selectedId: h.groups[0].id, scope: 'bed', rows: generated, companionTargets: [generated[1]], pairTargetId: generated[1].cellId }; // CHANGE
    graph.__trellisPlantingSpacingEditor.render(body, context); // CHANGE
    const fields = body.querySelectorAll('input[type=number]'); fields[0].value = String(generated[0].spacingXCm + 1); fields[0].dispatchEvent(new w.Event('input')); // CHANGE
    const draft = generated.map((row, index) => ({ ...row, spacingXCm: index ? row.spacingXCm : row.spacingXCm + 1, previewBedContext: true })); // CHANGE
    draft[1].enabled = false; draft[1].previewOnly = true; // CHANGE
    graph.view.scaleAndTranslate(1.35, 5, 10); await h.settle(); // CHANGE
    const preview = h.tools.buildSpacingPreviewModel(graph, draft); assertAligned(h, preview, generated); // CHANGE
    const bedFrame = w.document.querySelector('.manual-link-spacing-preview-bed-frame'); assert.ok(bedFrame); assert.equal(bedFrame.style.transform, 'rotate(37deg)'); // CHANGE: bed context retains its actual angle. // CHANGE
    assert.ok(Math.abs(parseFloat(bedFrame.style.left) - graph.view.getState(h.bed).x) <= 1); // CHANGE
    assert.equal(h.serialize(), before); assert.equal(h.undoManager.history.length, 0); assert.equal(h.writes.length, 0); // CHANGE
    const getState = graph.view.getState; graph.view.getState = function(cell, ...args) { return cell === h.groups[1] ? null : getState.call(this, cell, ...args); }; // CHANGE
    graph.__trellisPlantingGroup.preview.refresh(); assert.equal(w.document.querySelector('.manual-link-spacing-preview'), null); assert.notEqual(getState.call(graph.view, h.bed).shape.node.style.opacity, '0'); // CHANGE
    graph.view.getState = getState; graph.__trellisPlantingGroup.preview.refresh(); assert.ok(w.document.querySelector('.manual-link-spacing-preview')); // CHANGE
    await h.tools.applySpacingDraft(graph, [draft[0]], { saveDefaults: false }); // CHANGE
    assert.equal(h.groups[0].getAttribute('plant_count'), String(preview.rows[0].groupPreview.actual)); // CHANGE
    assert.equal(JSON.stringify(h.groups[0].getGeometry()), beforeGeometries[0]); assert.equal(JSON.stringify(h.groups[1].getGeometry()), beforeGeometries[1]); // CHANGE
    assert.equal(h.undoManager.history.length, 1); // CHANGE
    const applied = h.serialize(); h.undoManager.undo(); assert.equal(h.serialize(), applied); assert.equal(h.undoManager.indexOfNextAdd, 1); // CHANGE: the manually retained preview is dismissed first.
    h.undoManager.undo(); assert.equal(h.serialize(), before); h.undoManager.redo(); // CHANGE
    assert.equal(h.groups[0].getAttribute('plant_count'), String(preview.rows[0].groupPreview.actual)); // CHANGE
}); // CHANGE


for (const [groupAngle, bedAngle] of [[0, 37], [37, -30], [90, 0], [-30, 90]]) test(`spacing preserves group ${groupAngle} and bed ${bedAngle} rotation through view changes`, async t => { // CHANGE
    const h = await setup(t, { groupAngle, bedAngle }), { graph, window: w } = h; // CHANGE
    h.undoManager.clear(); const entry = await h.open(), before = h.serialize(); // CHANGE
    const context = await h.tools.buildSpacingLayoutRows(graph, h.groups[0]); // CHANGE
    const body = w.document.createElement('div'); entry.panel.replaceChildren(body); // CHANGE
    graph.__trellisPlantingSpacingEditor.render(body, { ...context, scope: 'bed' }); // CHANGE: exercise the production bed-context editor explicitly.
    const field = body.querySelector('[data-spacing-row-cell="' + h.groups[0].id + '"] input[type=number]'); // CHANGE
    field.value = '33'; field.dispatchEvent(new w.Event('input')); // CHANGE
    const rows = context.rows.map(row => ({ ...row, spacingXCm: row.cellId === h.groups[0].id ? 33 : row.spacingXCm, enabled: row.cellId === h.groups[0].id, previewOnly: row.cellId !== h.groups[0].id, previewBedContext: true })); // CHANGE
    const preview = h.tools.buildSpacingPreviewModel(graph, rows), canonical = JSON.stringify(preview); // CHANGE
    for (const scale of [1.35, 1.75]) { // CHANGE
        graph.view.scaleAndTranslate(scale, 5, 10); graph.container.scrollLeft = 240; graph.container.scrollTop = 180; await h.settle(); // CHANGE
        assertAligned(h, preview, context.rows); // CHANGE
        const frame = w.document.querySelector('[data-spacing-preview-cell="' + h.groups[0].id + '"]'); // CHANGE
        assert.equal(frame.style.transform, groupAngle ? `rotate(${groupAngle}deg)` : ''); // CHANGE
        assert.equal(w.document.querySelector('.manual-link-spacing-preview-bed-frame').style.transform, bedAngle ? `rotate(${bedAngle}deg)` : ''); // CHANGE
    } // CHANGE
    h.roadmap.setViewState(h.board, { today: { multiplier: 3 } }); await h.settle(); assertAligned(h, preview, context.rows); // CHANGE
    graph.view.setCurrentRoot(h.garden); await h.settle(); assertAligned(h, preview, context.rows); // CHANGE
    graph.view.setCurrentRoot(null); await h.settle(); assertAligned(h, preview, context.rows); // CHANGE
    assert.equal(JSON.stringify(preview), canonical); assert.equal(h.serialize(), before); assert.equal(h.undoManager.history.length, 0); assert.equal(h.writes.length, 0); // CHANGE
}); // CHANGE

for (const target of ['group', 'bed', 'ancestor', 'unrelated']) test(`Undo/Redo discard regular spacing after ${target} history changes`, async t => { // CHANGE
    const h = await setup(t), { graph, window: w } = h; // CHANGE
    const cell = target === 'group' ? h.groups[0] : target === 'bed' ? h.bed : target === 'ancestor' ? h.garden : h.roadmapModule; // CHANGE
    graph.model.execute(new w.mxCellAttributeChange(cell, 'history_probe', 'changed')); // CHANGE
    const entry = await h.open(); h.edit(entry); assert.ok(w.document.querySelector('.manual-link-spacing-preview')); // CHANGE
    const index = h.undoManager.indexOfNextAdd, history = Array.from(h.undoManager.history), before = h.serialize(); // CHANGE
    h.undoManager.undo(); assert.equal(w.document.querySelector('.manual-link-spacing-preview'), null); // CHANGE
    assert.equal(h.serialize(), before); assert.equal(h.undoManager.indexOfNextAdd, index); assert.deepEqual(Array.from(h.undoManager.history), history); // CHANGE
    await h.settle(); await h.settle(); // CHANGE
    assert.equal(w.document.querySelector('.manual-link-spacing-preview'), null); assert.equal(entry.spacingDraftByCellId.size, 0); // CHANGE
    assert.notEqual(graph.view.getState(h.groups[0]).shape.node.style.opacity, '0'); // CHANGE
    assert.notEqual(graph.selectionCellsHandler.getHandler(h.groups[0]).sizers[0].node.style.display, 'none'); // CHANGE
    assert.equal(entry.panel.querySelector('[data-spacing-row-cell="' + h.groups[0].id + '"] input[type=number]').value, '30'); // CHANGE
    h.undoManager.undo(); assert.equal(cell.getAttribute('history_probe'), undefined); assert.equal(h.undoManager.indexOfNextAdd, index - 1); // CHANGE
    await h.settle(); await h.settle(); h.edit(entry); // CHANGE
    const undone = h.serialize(); h.undoManager.redo(); assert.equal(h.serialize(), undone); assert.equal(h.undoManager.indexOfNextAdd, index - 1); // CHANGE
    await h.settle(); await h.settle(); // CHANGE
    assert.equal(w.document.querySelector('.manual-link-spacing-preview'), null); assert.equal(entry.spacingDraftByCellId.size, 0); // CHANGE
    h.undoManager.redo(); assert.equal(cell.getAttribute('history_probe'), 'changed'); assert.equal(h.undoManager.indexOfNextAdd, index); // CHANGE
    assert.equal(h.undoManager.history.length, 1); assert.equal(h.writes.length, 0); // CHANGE
}); // CHANGE

test('history rejects a spacing context load that resolves after cleanup', async t => { // CHANGE
    const h = await setup(t), { graph, window: w } = h; // CHANGE
    const entry = await h.open(), buildRows = h.tools.buildSpacingLayoutRows; // CHANGE
    let release; const pending = new Promise(resolve => { release = resolve; }); // CHANGE
    const staleContext = await buildRows(graph, h.groups[0]); staleContext.rows.forEach(row => { row.spacingXCm = 99; }); // CHANGE
    h.edit(entry); h.tools.buildSpacingLayoutRows = (...args) => pending; h.overlay.refresh(); // CHANGE: retain an active draft while its context is loading.
    graph.model.execute(new w.mxCellAttributeChange(h.roadmapModule, 'history_probe', 'changed')); // CHANGE
    const index = h.undoManager.indexOfNextAdd; h.tools.buildSpacingLayoutRows = buildRows; h.undoManager.undo(); release(staleContext); // CHANGE
    assert.equal(h.undoManager.indexOfNextAdd, index); assert.equal(h.roadmapModule.getAttribute('history_probe'), 'changed'); // CHANGE
    await h.settle(); await h.settle(); // CHANGE
    assert.equal(w.document.querySelector('.manual-link-spacing-preview'), null); // CHANGE
    assert.equal(entry.panel.querySelector('[data-spacing-row-cell="' + h.groups[0].id + '"] input[type=number]').value, '30'); // CHANGE
}); // CHANGE


for (const direction of ['undo', 'redo']) test(`${direction} dismisses invalid and suspended drafts with empty graph history`, async t => { // CHANGE
    const h = await setup(t), { window: w, graph, ui } = h; // CHANGE
    const entry = await h.open(); h.edit(entry, 0, ''); // CHANGE
    assert.equal(w.document.querySelector('.manual-link-spacing-preview'), null); assert.ok(entry.spacingDraftByCellId.size); // CHANGE
    assert.equal(ui.canUndo(), true); assert.equal(ui.canRedo(), true); assert.equal(ui.actions.get(direction).isEnabled(), true); // CHANGE
    ui.actions.get(direction).funct(); await h.settle(); await h.settle(); // CHANGE
    assert.equal(entry.spacingDraftByCellId.size, 0); assert.equal(ui.canUndo(), false); assert.equal(ui.canRedo(), false); // CHANGE
    assert.equal(ui.actions.get(direction).isEnabled(), false); assert.equal(h.undoManager.history.length, 0); // CHANGE
    h.edit(entry); const getState = graph.view.getState; // CHANGE
    graph.view.getState = function(cell, ...args) { return cell === h.groups[0] ? null : getState.call(this, cell, ...args); }; // CHANGE
    graph.__trellisPlantingGroup.preview.refresh(); assert.equal(w.document.querySelector('.manual-link-spacing-preview'), null); // CHANGE
    h.undoManager[direction](); graph.view.getState = getState; await h.settle(); await h.settle(); graph.__trellisPlantingGroup.preview.refresh(); // CHANGE
    assert.equal(w.document.querySelector('.manual-link-spacing-preview'), null); assert.equal(h.undoManager.history.length, 0); assert.equal(h.writes.length, 0); // CHANGE
}); // CHANGE

test('production editor actions and keyboard bindings dismiss before changing history', async t => { // CHANGE
    const h = await setup(t), { window: w, graph, ui } = h; // CHANGE
    graph.model.execute(new w.mxCellAttributeChange(h.roadmapModule, 'history_probe', 'changed')); // CHANGE
    const entry = await h.open(), handler = ui.createKeyHandler(ui.editor); t.after(() => handler.destroy()); // CHANGE
    const key = (code, shiftKey = false) => graph.container.dispatchEvent(new w.KeyboardEvent('keydown', { keyCode: code, ctrlKey: true, shiftKey, bubbles: true })); // CHANGE
    h.edit(entry); graph.container.focus(); key(90); assert.equal(h.roadmapModule.getAttribute('history_probe'), 'changed'); // CHANGE
    assert.equal(h.undoManager.indexOfNextAdd, 1); key(90); assert.equal(h.roadmapModule.getAttribute('history_probe'), undefined); // CHANGE
    await h.settle(); await h.settle(); h.edit(entry); graph.container.focus(); key(90, true); assert.equal(h.undoManager.indexOfNextAdd, 0); // CHANGE
    key(89); assert.equal(h.roadmapModule.getAttribute('history_probe'), 'changed'); // CHANGE
    await h.settle(); await h.settle(); h.edit(entry); // CHANGE
    const menu = w.document.createElement('button'), toolbar = w.document.createElement('button'); // CHANGE
    for (const button of [menu, toolbar]) button.addEventListener('click', () => ui.actions.get('undo').funct()); // CHANGE
    menu.click(); assert.equal(h.undoManager.indexOfNextAdd, 1); toolbar.click(); assert.equal(h.undoManager.indexOfNextAdd, 0); // CHANGE
    assert.equal(h.writes.length, 0); // CHANGE
}); // CHANGE

test('native label-text history retains priority over graph preview dismissal', async t => { // CHANGE
    const h = await setup(t), { window: w, graph, ui } = h; const entry = await h.open(); h.edit(entry); // CHANGE
    const textarea = w.document.createElement('div'); textarea.innerHTML = 'Current label'; // CHANGE
    const isEditing = graph.isEditing, editor = graph.cellEditor; graph.isEditing = () => true; graph.cellEditor = { textarea }; // CHANGE
    t.after(() => { graph.isEditing = isEditing; graph.cellEditor = editor; }); // CHANGE
    const commands = []; w.document.execCommand = direction => { commands.push(direction); textarea.innerHTML += direction; }; // CHANGE
    ui.undo(); ui.redo(); assert.deepEqual(commands, ['undo', 'redo']); assert.ok(w.document.querySelector('.manual-link-spacing-preview')); // CHANGE
    assert.equal(h.undoManager.history.length, 0); // CHANGE
}); // CHANGE


for (const direction of ['undo', 'redo']) test(`${direction} dismissal preserves existing Undo and Redo stacks and emits no completed-history event`, async t => { // CHANGE
    const h = await setup(t), { window: w, graph } = h; // CHANGE
    graph.model.execute(new w.mxCellAttributeChange(h.roadmapModule, 'history_probe', 'first')); // CHANGE
    graph.model.execute(new w.mxCellAttributeChange(h.roadmapModule, 'history_probe', 'second')); h.undoManager.undo(); // CHANGE
    const entry = await h.open(); h.edit(entry); // CHANGE
    let completed = 0; h.undoManager.addListener(w.mxEvent.UNDO, () => completed++); h.undoManager.addListener(w.mxEvent.REDO, () => completed++); // CHANGE
    const history = Array.from(h.undoManager.history), before = h.serialize(); // CHANGE
    h.undoManager[direction](); assert.equal(h.serialize(), before); assert.equal(h.undoManager.indexOfNextAdd, 1); assert.equal(completed, 0); // CHANGE
    assert.deepEqual(Array.from(h.undoManager.history), history); assert.equal(h.undoManager.canUndo(), true); assert.equal(h.undoManager.canRedo(), true); // CHANGE
    h.undoManager[direction](); assert.equal(completed, 1); assert.equal(h.undoManager.indexOfNextAdd, direction === 'undo' ? 0 : 2); // CHANGE
    assert.equal(h.roadmapModule.getAttribute('history_probe'), direction === 'undo' ? undefined : 'second'); // CHANGE
    assert.deepEqual(Array.from(h.undoManager.history), history); assert.equal(h.writes.length, 0); // CHANGE
}); // CHANGE
