const assert = require('node:assert/strict'); // CHANGE
const fs = require('node:fs'); // CHANGE
const path = require('node:path'); // CHANGE
const test = require('node:test'); // CHANGE
const { loadPlantTilerMxGraph } = require('./helpers/plant-tiler-mxgraph-harness.cjs'); // CHANGE
const { createPreviewHistoryUi } = require('./helpers/preview-history-ui.cjs'); // CHANGE
const { assertFootprintFrame } = require('./helpers/planting-preview-geometry.cjs'); // CHANGE
const plugin = path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins/Planting_Group.js'); // CHANGE

/** Use native labels, real rotations, and diagram history rather than a simulated rendering API. */ // CHANGE
function fixture(angle = 30, html = 0) { // CHANGE
    const h = loadPlantTilerMxGraph(); // CHANGE
    const value = attrs => { const node = h.window.mxUtils.createXmlDocument().createElement('object'); Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v)); return node; }; // CHANGE
    const bed = h.bed(420, 300); // CHANGE
    const group = h.graph.insertVertex(h.moduleCell, 'crop-title', value({ tiler_group: '1', bed_auto_fit: '0', label: 'Very long zucchini planting title', plant_count_actual: '2' }), 260, 260, 180, 100, `rotation=${angle};verticalAlign=top;spacingTop=4;fontSize=14;html=${html};`); // CHANGE
    const ordinary = h.graph.insertVertex(h.moduleCell, 'ordinary-label', value({ label: 'Irrigation' }), 440, 340, 70, 40, 'rotation=22;verticalAlign=top;'); // CHANGE
    h.undoManager.clear(); // CHANGE
    return Object.assign(h, { bedCell: bed, group, ordinary, value, serialize: () => h.window.mxUtils.getXml(new h.window.mxCodec().encode(h.graph.getModel())) }); // CHANGE
} // CHANGE

function close(actual, expected, label) { assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} != ${expected}`); } // CHANGE

/** The unmodified renderer supplies the old rotated header anchor, independent of our title hooks. */ // CHANGE
function assertUprightAtNativeAnchor(h) { // CHANGE
    const state = h.graph.view.getState(h.group), nativeText = Object.create(state.text); // CHANGE
    nativeText.getTextRotation = () => state.shape.getTextRotation(); // CHANGE
    const expected = new h.window.mxCellRenderer().getLabelBounds(state, nativeText); // CHANGE
    assert.equal(state.text.getTextRotation(), 0); // CHANGE
    for (const key of ['x', 'y', 'width', 'height']) close(state.text.bounds[key], expected[key], 'title anchor ' + key); // CHANGE
    const ordinary = h.graph.view.getState(h.ordinary); assert.equal(ordinary.text.getTextRotation(), ordinary.shape.getTextRotation()); // CHANGE: unrelated labels still follow their shapes, including bed rotation.
} // CHANGE

for (const html of [0, 1]) for (const angle of [0, 30, 45, 90, -33]) test(`${html ? 'HTML' : 'SVG'} title at ${angle} stays upright at its native header anchor through view changes`, () => { // CHANGE
    const h = fixture(angle, html); // CHANGE
    try { // CHANGE
        const before = h.serialize(); assertUprightAtNativeAnchor(h); // CHANGE
        for (const scale of [0.75, 1.2]) { h.graph.view.setScale(scale); h.graph.view.setTranslate(11, 23); assertUprightAtNativeAnchor(h); } // CHANGE
        h.graph.view.setCurrentRoot(h.moduleCell); assertUprightAtNativeAnchor(h); h.graph.refresh(); assertUprightAtNativeAnchor(h); // CHANGE
        assert.equal(h.serialize(), before); assert.equal(h.undoManager.history.length, 0); // CHANGE: upright rendering performs no migration or geometry writes.
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('bed and independent group rotations retain upright titles through Undo/Redo and resizing', async () => { // CHANGE
    const h = fixture(12); // CHANGE
    try { // CHANGE
        h.tiler.retileGroup(h.graph, h.group, { forceExpand: true }); // CHANGE: history comparisons use a complete generated layout rather than an empty saved-frame fixture.
        const snapshot = () => h.serialize().replace(/<mxGeometry\b[^>]*>/g, geometry => geometry.replace(/ (x|y|width|height)="([^"]+)"/g, (_, key, value) => ` ${key}="${Math.round(Number(value) * 1e6) / 1e6}"`)); // CHANGE: compare geometry within 1e-6 while retaining exact styles, metadata, counts, and identities.
        for (const [cell, angle] of [[h.bedCell, 30], [h.group, -45], [h.bedCell, 90]]) { // CHANGE
            const before = snapshot(); h.undoManager.clear(); h.graph.setCellStyles('rotation', String(angle), [cell]); // CHANGE
            await new Promise(resolve => h.window.setTimeout(resolve, 200)); // CHANGE: independent group rotation uses the existing deferred tiling path.
            assertUprightAtNativeAnchor(h); const after = snapshot(); assert.equal(h.undoManager.history.length, 1); // CHANGE
            h.undoManager.undo(); await new Promise(resolve => h.window.setTimeout(resolve, 200)); assertUprightAtNativeAnchor(h); assert.equal(snapshot(), before); // CHANGE
            h.undoManager.redo(); await new Promise(resolve => h.window.setTimeout(resolve, 200)); assertUprightAtNativeAnchor(h); assert.equal(snapshot(), after); // CHANGE
        } // CHANGE
        const geometry = h.group.geometry.clone(); geometry.width += 50; geometry.height += 20; h.graph.getModel().setGeometry(h.group, geometry); assertUprightAtNativeAnchor(h); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('installation refreshes existing saved titles once without global renderer or diagram changes', () => { // CHANGE
    const h = fixture(), container = h.window.document.createElement('div'); h.window.document.body.appendChild(container); // CHANGE
    const graph = new h.window.mxGraph(container); graph.isSpecialColor = () => false; graph.convertValueToString = h.graph.convertValueToString; // CHANGE
    const undoManager = new h.window.mxUndoManager(), ui = createPreviewHistoryUi(h.window, graph, undoManager); // CHANGE
    graph.getModel().addListener(h.window.mxEvent.UNDO, (_, e) => undoManager.undoableEditHappened(e.getProperty('edit'))); // CHANGE
    try { // CHANGE
        const group = graph.insertVertex(null, null, h.value({ tiler_group: '1', label: 'Saved planting' }), 200, 200, 180, 100, 'rotation=45;verticalAlign=top;'); // CHANGE
        assert.equal(graph.view.getState(group).text.getTextRotation(), 45); undoManager.clear(); // CHANGE
        const serialize = () => h.window.mxUtils.getXml(new h.window.mxCodec().encode(graph.getModel())), before = serialize(); // CHANGE
        const prototypeFactory = h.window.mxCellRenderer.prototype.createTextShape, prototypeBounds = h.window.mxCellRenderer.prototype.rotateLabelBounds; // CHANGE
        h.window.Draw.loadPlugin = callback => callback(ui); h.window.eval(fs.readFileSync(plugin, 'utf8')); // CHANGE
        assert.equal(graph.view.getState(group).text.getTextRotation(), 0); assert.equal(serialize(), before); assert.equal(undoManager.history.length, 0); // CHANGE
        const factory = graph.cellRenderer.createTextShape, bounds = graph.cellRenderer.rotateLabelBounds; h.window.eval(fs.readFileSync(plugin, 'utf8')); // CHANGE
        assert.equal(graph.cellRenderer.createTextShape, factory); assert.equal(graph.cellRenderer.rotateLabelBounds, bounds); // CHANGE
        assert.equal(h.window.mxCellRenderer.prototype.createTextShape, prototypeFactory); assert.equal(h.window.mxCellRenderer.prototype.rotateLabelBounds, prototypeBounds); // CHANGE
    } finally { graph.destroy(); h.close(); } // CHANGE
}); // CHANGE

for (const html of [0, 1]) for (const operation of ['move', 'rotate']) test(`${operation} bed preview hides the ${html ? 'HTML' : 'SVG'} title and restores its exact visibility`, async () => { // CHANGE
    const h = fixture(30, html); // CHANGE
    try { // CHANGE
        const node = h.graph.view.getState(h.group).text.node; node.style.visibility = 'hidden'; // CHANGE
        const before = h.serialize(), preview = h.graph.__trellisBedTransforms.createPreview([h.bedCell]); // CHANGE
        preview.update(() => operation === 'move' ? { dx: 30, dy: 20 } : { delta: 45 }); await new Promise(resolve => h.window.requestAnimationFrame(resolve)); // CHANGE
        assert.equal(h.window.document.querySelectorAll('[data-trellis-bed-preview-cell="crop-title"][data-trellis-bed-preview-kind="text"]').length, 0); // CHANGE
        assert.ok(h.window.document.querySelector('[data-trellis-bed-preview-cell="crop-title"][data-trellis-bed-preview-kind="shape"]')); // CHANGE
        assert.equal(node.style.visibility, 'hidden'); assert.equal(h.serialize(), before); preview.clear(); assert.equal(node.style.visibility, 'hidden'); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

for (const angle of [0, 30, 45, 90, -33]) test(`Allocate and spacing titles at ${angle} are upright siblings anchored to the rotating header`, () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        h.graph.view.setScale(1.2); h.graph.view.setTranslate(11, 23); const before = h.serialize(); // CHANGE
        const row = { cellId: h.group.id, label: 'Long zucchini title', rect: { x: 260, y: 260, width: 180, height: 100 }, rotationDeg: angle, groupLabelFontPx: 14, groupLabelBandPx: 29, circles: [], summaryText: '× 2' }; // CHANGE: explicit header geometry must take precedence over native fallback metrics.
        for (const owner of ['allocate', 'spacing']) { // CHANGE
            const host = h.graph.__trellisPlantingGroup.preview.render(owner, { rows: [row] }), title = host.querySelector('.manual-link-spacing-preview-group-title'), frame = host.querySelector('.manual-link-spacing-preview-group-frame'); // CHANGE
            assert.ok(title); assert.equal(title.parentNode, host); assert.equal(title.textContent, row.label); assert.doesNotMatch(title.style.transform, /rotate/); // CHANGE
            assert.equal(title.style.borderBottom, ''); // CHANGE
            const scale = h.graph.view.scale, tr = h.graph.view.translate, height = parseFloat(title.style.height); // CHANGE
            const pivot = { x: (row.rect.x + row.rect.width / 2 + tr.x) * scale, y: (row.rect.y + row.rect.height / 2 + tr.y) * scale }, deltaY = parseFloat(frame.style.borderWidth) + height / 2 - row.rect.height * scale / 2, radians = angle * Math.PI / 180; // CHANGE: preserve the header's original position inside the border.
            close(parseFloat(title.style.left), pivot.x - deltaY * Math.sin(radians), 'preview title x'); close(parseFloat(title.style.top), pivot.y + deltaY * Math.cos(radians), 'preview title y'); // CHANGE
            assert.equal(frame.style.transform, angle ? `rotate(${angle}deg)` : ''); assert.equal(frame.querySelector('.planting-preview-summary').textContent, '× 2'); // CHANGE
            assertFootprintFrame(frame, row.rect, { minX: 4, minY: 33, maxX: 176, maxY: 96 }, angle, scale, tr); // CHANGE: the rotated footprint excludes the header and padding without moving the upright title.
            assert.equal(frame.querySelector('.planting-preview-summary').style.top, '50%'); // CHANGE
            h.graph.__trellisPlantingGroup.preview.clear(owner); // CHANGE
        } // CHANGE
        assert.equal(h.serialize(), before); assert.equal(h.undoManager.history.length, 0); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

for (const overhang of [0, 30, 50]) test(`usable preview at ${overhang}% overhang retains the assigned area with sparse circles`, () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        const proposal = h.tiler.proposePlantingGeometry({ maxWidthPx: 120, maxHeightPx: 90, spacingXCm: 20, spacingYCm: 20, vegDiameterCm: 10, plantCount: 4, fillAvailableBed: true, allowedOverhangPct: overhang }); // CHANGE
        assert.ok(proposal.ok); // CHANGE
        const rect = proposal.geometry, band = proposal.labelBandPx, bounds = { minX: 4, minY: 4 + band, maxX: rect.width - 4, maxY: rect.height - 4 }; // CHANGE
        close(bounds.maxX - bounds.minX, 120 + 2 * proposal.iconDiameterPx * overhang / 100, 'available width includes overhang once'); // CHANGE
        close(bounds.maxY - bounds.minY, 90 + 2 * proposal.iconDiameterPx * overhang / 100, 'available height includes overhang once'); // CHANGE
        const before = h.serialize(), row = { rect, groupLabelBandPx: band, label: 'Radish', rotationDeg: -33, circles: [{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, r: 3 }] }; // CHANGE
        for (const owner of ['allocate', 'spacing']) { // CHANGE
            const host = h.graph.__trellisPlantingGroup.preview.render(owner, { rows: [row] }); // CHANGE
            assertFootprintFrame(host.querySelector('.manual-link-spacing-preview-group-frame'), rect, bounds, -33, h.graph.view.scale, h.graph.view.translate); // CHANGE
            assert.equal(host.querySelectorAll('.manual-link-spacing-preview-plant').length, 1); // CHANGE: a sparse rendered sample cannot shrink the available footprint.
        } // CHANGE
        assert.equal(h.serialize(), before); assert.equal(h.undoManager.history.length, 0); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('preview consumes explicit local bounds and preserves bed frames and native fallback geometry', () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        const rect = { x: 50, y: 70, width: 180, height: 100 }, contentBounds = { minX: 9, minY: 42, maxX: 155, maxY: 87 }; // CHANGE
        const row = { cellId: 'explicit', rect, contentBounds, groupLabelBandPx: 29, rotationDeg: 45, circles: [] }; // CHANGE
        const canonical = JSON.stringify(row), service = h.graph.__trellisPlantingGroup.preview; // CHANGE
        const host = service.render('spacing', { rows: [row, { cellId: 'fallback', rect, circles: [] }], bedPreview: { rect, rotationDeg: 30 } }); // CHANGE
        assertFootprintFrame(host.querySelector('[data-spacing-preview-cell="explicit"]'), rect, contentBounds, 45, 1, { x: 0, y: 0 }); // CHANGE
        assertFootprintFrame(host.querySelector('[data-spacing-preview-cell="fallback"]'), rect, { minX: 4, minY: 23, maxX: 176, maxY: 96 }, 0, 1, { x: 0, y: 0 }); // CHANGE: native 10px font reserves a 19px header band.
        assertFootprintFrame(host.querySelector('.manual-link-spacing-preview-bed-frame'), rect, { minX: 0, minY: 0, maxX: 180, maxY: 100 }, 30, 1, { x: 0, y: 0 }); // CHANGE
        assert.equal(JSON.stringify(row), canonical); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

for (const rect of [{ x: 0, y: 0, width: 8, height: 100 }, { x: 0, y: 0, width: 100, height: 20 }]) test(`empty usable area ${rect.width}×${rect.height} retains only its title`, () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        const host = h.graph.__trellisPlantingGroup.preview.render('spacing', { rows: [{ rect, label: 'Radish', summaryText: '0 plants', circles: [] }] }); // CHANGE
        assert.equal(host.querySelector('.manual-link-spacing-preview-group-frame'), null); // CHANGE
        assert.equal(host.querySelector('.manual-link-spacing-preview-group-title').textContent, 'Radish'); // CHANGE
        assert.equal(host.querySelector('.planting-preview-summary'), null); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

for (const method of ['reset', 'destroy']) test(`native move-handler ${method} restores an upright title without diagram writes`, () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        h.graph.setSelectionCell(h.bedCell); const handler = h.graph.graphHandler, title = h.graph.view.getState(h.group).text.node, visibility = title.style.visibility, before = h.serialize(); // CHANGE
        handler.start(h.bedCell, 300, 300, [h.bedCell]); handler.currentDx = 20; handler.currentDy = 30; handler.updatePreview(); // CHANGE
        assert.equal(title.style.visibility, 'hidden'); handler[method](); assert.equal(title.style.visibility, visibility); // CHANGE
        assert.equal(h.serialize(), before); assert.equal(h.window.document.querySelectorAll('[data-trellis-bed-transform-preview]').length, 0); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE
