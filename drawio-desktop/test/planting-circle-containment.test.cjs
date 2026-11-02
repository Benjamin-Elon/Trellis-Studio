/** Exercise production movement with the native model, rotations and Undo boundaries. */ // CHANGE
const test = require('node:test'); // CHANGE
const assert = require('node:assert/strict'); // CHANGE
const { loadPlantTilerMxGraph } = require('./helpers/plant-tiler-mxgraph-harness.cjs'); // CHANGE

function fixture(t) { // CHANGE
    const h = loadPlantTilerMxGraph(); t.after(h.close); // CHANGE
    const value = attrs => { const node = h.window.mxUtils.createXmlDocument().createElement('object'); for (const [key, entry] of Object.entries(attrs)) node.setAttribute(key, entry); return node; }; // CHANGE
    const group = (id, angle = 0) => h.graph.insertVertex(h.moduleCell, id, value({ tiler_group: '1', bed_auto_fit: '0' }), 100, 100, 200, 160, 'rotation=' + angle); // CHANGE
    const circle = (parent, id, x = 50, y = 50, width = 20) => { // CHANGE
        const angle = Number(h.graph.getCellStyle(parent).rotation || 0) * Math.PI / 180, cx = x + width / 2 - 100, cy = y + width / 2 - 80; // CHANGE
        return h.graph.insertVertex(parent, id, value({ plant_tiler: '1', auto: '0' }), 100 + cx * Math.cos(angle) - cy * Math.sin(angle) - width / 2, 80 + cx * Math.sin(angle) + cy * Math.cos(angle) - width / 2, width, width, 'ellipse;movable=1;'); // CHANGE
    }; // CHANGE
    const logical = cell => { // CHANGE
        const geo = cell.geometry, angle = -Number(h.graph.getCellStyle(cell.parent).rotation || 0) * Math.PI / 180, cx = geo.x + geo.width / 2 - 100, cy = geo.y + geo.height / 2 - 80; // CHANGE
        return { x: 100 + cx * Math.cos(angle) - cy * Math.sin(angle) - geo.width / 2, y: 80 + cx * Math.sin(angle) + cy * Math.cos(angle) - geo.height / 2 }; // CHANGE
    }; // CHANGE
    return { ...h, group, circle, logical }; // CHANGE
} // CHANGE

test('circle moves clamp at every edge, preserve size and parent, and Undo as one action', t => { // CHANGE
    const h = fixture(t), group = h.group('crop'), other = h.group('other'), tile = h.circle(group, 'tile'); // CHANGE
    assert.equal(h.graph.isValidDropTarget(other, [tile]), false); assert.equal(h.graph.isValidDropTarget(h.moduleCell, [tile]), false); // CHANGE
    for (const [dx, dy, x, y] of [[999, 0, 180, 50], [-999, 0, 0, 50], [0, 999, 50, 140], [0, -999, 50, 0]]) { // CHANGE
        h.undoManager.clear(); h.graph.moveCells([tile], dx, dy, false, other); // CHANGE
        assert.equal(tile.parent, group); assert.equal(tile.geometry.x, x); assert.equal(tile.geometry.y, y); assert.equal(tile.geometry.width, 20); assert.equal(tile.geometry.height, 20); // CHANGE
        assert.equal(group.geometry.width, 200); assert.equal(group.geometry.height, 160); assert.equal(h.undoManager.history.length, 1); // CHANGE
        h.undoManager.undo(); assert.equal(tile.geometry.x, 50); assert.equal(tile.geometry.y, 50); // CHANGE
        h.undoManager.redo(); assert.equal(tile.geometry.x, x); h.undoManager.undo(); // CHANGE
    } // CHANGE
}); // CHANGE

test('no-op and impossible movement creates no model edit; nudging at an edge stays put', t => { // CHANGE
    const h = fixture(t), group = h.group('crop'), tile = h.circle(group, 'tile', 180, 50), oversized = h.circle(group, 'large', 0, 0, 250); // CHANGE
    h.undoManager.clear(); let edits = 0; h.graph.model.addListener(h.window.mxEvent.CHANGE, () => edits++); // CHANGE
    h.graph.moveCells([tile], 10, 0); h.graph.moveCells([tile], 0, 0, false, h.moduleCell); h.graph.moveCells([oversized], 10, 10); // CHANGE
    assert.equal(edits, 0); assert.equal(h.undoManager.history.length, 0); assert.equal(tile.geometry.x, 180); assert.equal(oversized.geometry.width, 250); // CHANGE
    h.graph.moveCells([tile], -1, 0); assert.equal(tile.geometry.x, 179); assert.equal(edits, 1); // CHANGE
}); // CHANGE

test('multi-circle movement preserves offsets and drag-copy keeps its source group', t => { // CHANGE
    const h = fixture(t), group = h.group('crop'), a = h.circle(group, 'a', 20, 40), b = h.circle(group, 'b', 80, 70), other = h.group('other'); // CHANGE
    h.graph.moveCells([a, b], 999, 999, false, other); // CHANGE
    assert.equal(b.geometry.x - a.geometry.x, 60); assert.equal(b.geometry.y - a.geometry.y, 30); assert.equal(b.geometry.x, 180); assert.equal(b.geometry.y, 140); // CHANGE
    const copies = h.graph.moveCells([a, b], -25, -15, true, other); // CHANGE
    assert.equal(copies.length, 2); assert.ok(copies.every(cell => cell.parent === group && cell !== a && cell !== b)); // CHANGE
    assert.equal(copies[1].geometry.x - copies[0].geometry.x, 60); assert.equal(copies[1].geometry.y - copies[0].geometry.y, 30); // CHANGE
}); // CHANGE

test('rotated and zoomed groups constrain full circles in their local coordinates', t => { // CHANGE
    const h = fixture(t); h.graph.view.scaleAndTranslate(1.7, 23, 41); // CHANGE
    for (const angle of [25, 90, 135, 270]) { // CHANGE
        const group = h.group('crop-' + angle, angle), tile = h.circle(group, 'tile-' + angle), original = group.geometry.clone(); // CHANGE
        h.graph.moveCells([tile], 999, -999, false, h.moduleCell); const point = h.logical(tile); // CHANGE
        assert.ok(point.x >= -1e-6 && point.x <= 180 + 1e-6 && point.y >= -1e-6 && point.y <= 140 + 1e-6, JSON.stringify({ angle, point })); // CHANGE
        assert.equal(tile.geometry.width, 20); assert.equal(tile.parent, group); assert.deepEqual(group.geometry, original); // CHANGE
    } // CHANGE
}); // CHANGE

test('different rotated groups share one translation and ancestor selection moves each circle once', t => { // CHANGE
    const h = fixture(t), first = h.group('first'), second = h.group('second', 30), a = h.circle(first, 'a'), b = h.circle(second, 'b'), beforeA = a.geometry.clone(), beforeB = b.geometry.clone(); // CHANGE
    h.graph.moveCells([a, b], 999, 200); // CHANGE
    assert.ok(Math.abs((a.geometry.x - beforeA.x) - (b.geometry.x - beforeB.x)) < 1e-6); assert.ok(Math.abs((a.geometry.y - beforeA.y) - (b.geometry.y - beforeB.y)) < 1e-6); // CHANGE
    for (const tile of [a, b]) { const point = h.logical(tile); assert.ok(point.x >= -1e-6 && point.x <= 180 + 1e-6 && point.y >= -1e-6 && point.y <= 140 + 1e-6); } // CHANGE
    assert.equal(h.graph.isValidDropTarget(h.moduleCell, [first, a]), true); // CHANGE
    const geo = a.geometry.clone(), x = first.geometry.x; h.graph.moveCells([first, a], 17, 9); // CHANGE
    assert.equal(first.geometry.x, x + 17); assert.deepEqual(a.geometry, geo); // CHANGE
}); // CHANGE

test('legacy planting markers receive the same containment as current groups', t => { // CHANGE
    const h = fixture(t); // CHANGE
    for (const marker of ['planting_id', 'style']) { // CHANGE
        const group = h.group('legacy-' + marker), tile = h.circle(group, 'tile-' + marker); // CHANGE
        const value = group.value.cloneNode(true); value.removeAttribute('tiler_group'); if (marker === 'planting_id') value.setAttribute('planting_id', 'legacy'); // CHANGE
        h.graph.model.setValue(group, value); if (marker === 'style') h.graph.model.setStyle(group, 'tiler_group=1;'); // CHANGE
        h.graph.moveCells([tile], 999, 999, false, h.moduleCell); // CHANGE
        assert.equal(tile.parent, group); assert.equal(tile.geometry.x, 180); assert.equal(tile.geometry.y, 140); // CHANGE
    } // CHANGE
}); // CHANGE
