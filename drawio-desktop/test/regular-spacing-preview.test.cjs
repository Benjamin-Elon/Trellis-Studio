const assert = require('node:assert/strict'); // CHANGE
const fs = require('node:fs'); // CHANGE
const path = require('node:path'); // CHANGE
const test = require('node:test'); // CHANGE
const { loadPlantTilerMxGraph } = require('./helpers/plant-tiler-mxgraph-harness.cjs'); // CHANGE
const { createRegularSpacingFixture } = require('./helpers/regular-spacing-preview.cjs'); // CHANGE

/** Load production plugins; reference data has no saved defaults and records all attempted writes. */ // CHANGE
async function setup(t) { // CHANGE
    const h = loadPlantTilerMxGraph(); t.after(h.close); // CHANGE
    const { window: w, graph } = h, writes = []; // CHANGE
    w.dbBridge = { resolvePath: async () => ({ dbPath: 'spacing-preview' }), open: async () => ({ dbId: 'spacing-preview' }), close: async () => {}, query: async () => ({ rows: [] }), exec: async (...args) => { writes.push(args); return {}; } }; // CHANGE
    w.__TRELLIS_PLANTING_SCHEDULER_TEST__ = true; // CHANGE
    for (const name of ['Garden_Roadmap_Core.js', 'Garden_Roadmap_Manager.js', 'Modules_Standalone.js', 'Garden_Scheduler_Shared_Core.js', 'Garden_Scheduler_Annual_Core.js', 'Garden_Scheduler_Perennial_Core.js', 'Garden_Scheduler_Dialog.js']) { // CHANGE
        w.eval(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins', name), 'utf8')); // CHANGE
    } // CHANGE
    const fixture = await createRegularSpacingFixture(w, graph); h.undoManager.clear(); // CHANGE: setup commands are outside the preview/apply assertions.
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
        assert.ok(Math.abs(parseFloat(frame.style.left) - (canonical.x + dx + tr.x) * scale) <= 1); // CHANGE
        assert.ok(Math.abs(parseFloat(frame.style.top) - (canonical.y + dy + tr.y) * scale) <= 1); // CHANGE
        assert.equal(parseFloat(frame.style.width), Math.round(row.rect.width * scale)); // CHANGE
        assert.equal(parseFloat(frame.style.height), Math.round(row.rect.height * scale)); // CHANGE
    } // CHANGE
    const circles = Array.from(host.querySelectorAll('.manual-link-spacing-preview-plant')); // CHANGE
    let index = 0; // CHANGE
    for (const row of preview.rows) { // CHANGE
        const frame = host.querySelector('[data-spacing-preview-cell="' + row.cellId + '"]'); // CHANGE
        for (const dot of row.groupPreview.circles) { // CHANGE
            const circle = circles[index++], radius = Math.max(2, dot.r * scale); // CHANGE
            assert.ok(Math.abs(parseFloat(circle.style.left) + radius - parseFloat(frame.style.left) - (dot.x - row.rect.x) * scale) <= 1); // CHANGE
            assert.ok(Math.abs(parseFloat(circle.style.top) + radius - parseFloat(frame.style.top) - (dot.y - row.rect.y) * scale) <= 1); // CHANGE
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

for (const pattern of ['aligned', 'staggered']) test(pattern + ' generated frames and upright bed context project together without changing commits', async t => { // CHANGE
    const h = await setup(t), { graph, window: w } = h; // CHANGE
    const contexts = await Promise.all(h.groups.map(group => h.tools.buildSpacingLayoutRows(graph, group))); // CHANGE
    const rows = contexts.map(context => context.rows[0]), generated = h.tools.generateCompanionPairLayout(graph, rows, pattern); // CHANGE
    const before = h.serialize(), beforeGeometries = h.groups.map(group => JSON.stringify(group.getGeometry())); // CHANGE
    graph.setSelectionCell(h.groups[0]); // CHANGE
    const entry = h.overlay.registry.get(h.groups[0].id), body = w.document.createElement('div'); entry.panel.appendChild(body); // CHANGE
    const context = { selectedId: h.groups[0].id, scope: 'bed', rows: generated, companionTargets: [generated[1]], pairTargetId: generated[1].cellId }; // CHANGE
    graph.__trellisPlantingSpacingEditor.render(body, context); // CHANGE
    const fields = body.querySelectorAll('input[type=number]'); fields[0].value = String(generated[0].spacingXCm + 1); fields[0].dispatchEvent(new w.Event('input')); // CHANGE
    const draft = generated.map((row, index) => ({ ...row, spacingXCm: index ? row.spacingXCm : row.spacingXCm + 1, previewUnrotated: true })); // CHANGE
    draft[1].enabled = false; draft[1].previewOnly = true; // CHANGE
    graph.view.scaleAndTranslate(1.35, 5, 10); await h.settle(); // CHANGE
    const preview = h.tools.buildSpacingPreviewModel(graph, draft); assertAligned(h, preview, generated); // CHANGE
    const bedFrame = w.document.querySelector('.manual-link-spacing-preview-bed-frame'); assert.ok(bedFrame); assert.equal(bedFrame.style.transform, ''); // CHANGE
    assert.ok(Math.abs(parseFloat(bedFrame.style.left) - graph.view.getState(h.bed).x) <= 1); // CHANGE
    assert.equal(h.serialize(), before); assert.equal(h.undoManager.history.length, 0); assert.equal(h.writes.length, 0); // CHANGE
    const getState = graph.view.getState; graph.view.getState = function(cell, ...args) { return cell === h.groups[1] ? null : getState.call(this, cell, ...args); }; // CHANGE
    graph.__trellisPlantingGroup.preview.refresh(); assert.equal(w.document.querySelector('.manual-link-spacing-preview'), null); assert.notEqual(getState.call(graph.view, h.bed).shape.node.style.opacity, '0'); // CHANGE
    graph.view.getState = getState; graph.__trellisPlantingGroup.preview.refresh(); assert.ok(w.document.querySelector('.manual-link-spacing-preview')); // CHANGE
    await h.tools.applySpacingDraft(graph, [draft[0]], { saveDefaults: false }); // CHANGE
    assert.equal(h.groups[0].getAttribute('plant_count'), String(preview.rows[0].groupPreview.actual)); // CHANGE
    assert.equal(JSON.stringify(h.groups[0].getGeometry()), beforeGeometries[0]); assert.equal(JSON.stringify(h.groups[1].getGeometry()), beforeGeometries[1]); // CHANGE
    assert.equal(h.undoManager.history.length, 1); h.undoManager.undo(); assert.equal(h.serialize(), before); h.undoManager.redo(); // CHANGE
    assert.equal(h.groups[0].getAttribute('plant_count'), String(preview.rows[0].groupPreview.actual)); // CHANGE
}); // CHANGE
