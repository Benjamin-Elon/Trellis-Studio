const assert = require('node:assert/strict'); // CHANGE
const test = require('node:test'); // CHANGE
const fs = require('node:fs'); // CHANGE
const path = require('node:path'); // CHANGE
const root = process.env.TRELLIS_TEST_ROOT || path.resolve(__dirname, '..'); // CHANGE
const { loadPlantTilerMxGraph } = require(path.join(root, 'test/helpers/plant-tiler-mxgraph-harness.cjs')); // CHANGE

/** Production graph, real edit history, and a manually positioned child prevent implementation-only assertions. */ // CHANGE
function fixture(rotation = 0) { // CHANGE
    const h = loadPlantTilerMxGraph(), { graph, window } = h; // CHANGE
    graph.setExtendParents(false); graph.setConstrainChildren(false); // CHANGE
    function value(attrs) { // CHANGE
        const node = window.mxUtils.createXmlDocument().createElement('object'); // CHANGE
        Object.entries(attrs).forEach(([key, val]) => node.setAttribute(key, val)); return node; // CHANGE
    } // CHANGE
    const bed = h.bed(400, 300, rotation, 200, 200); // CHANGE
    const group = graph.insertVertex(h.moduleCell, 'crop', value({ tiler_group: '1', plant_abbr: 'CAR', label: 'Carrots', bed_auto_fit: '0', plant_count: '2', plant_count_actual: '2', spacing_x_cm: '20', spacing_y_cm: '30' }), 260, 260, 80, 70, 'rotation=12;locked=1;verticalAlign=top;'); // CHANGE: real titles exercise gesture cleanup alongside circle labels.
    const plant = graph.insertVertex(group, 'manual', value({ plant_tiler: '1', auto: '0', dirty: '1', label: 'CAR' }), 7, 33, 12, 12, 'ellipse;rotation=5;'); // CHANGE: include a real circle label in preview coverage.
    const assembly = graph.insertVertex(h.moduleCell, 'pipes', value({ irrigation_assembly: '1', irrigation_assembly_type: 'bed' }), 440, 340, 100, 80, 'rotation=22;locked=1;'); // CHANGE
    const part = graph.insertVertex(assembly, 'part', value({ irrigation_part: '1' }), 10, 20, 16, 10, 'rotation=22;'); // CHANGE
    const outside = graph.insertVertex(h.moduleCell, 'outside', value({ tiler_group: '1', bed_auto_fit: '0' }), 750, 500, 40, 30); // CHANGE
    h.undoManager.clear(); // CHANGE
    return Object.assign(h, { createBed: h.bed, bed, group, plant, assembly, part, outside, value }); // CHANGE
} // CHANGE

function saved(h) { // CHANGE
    return [h.bed, h.group, h.plant, h.assembly, h.part, h.outside].map(cell => ({ id: cell.id, geometry: JSON.parse(JSON.stringify(cell.geometry)), style: cell.style, value: cell.value.outerHTML })); // CHANGE
} // CHANGE
function close(actual, expected, label) { assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} != ${expected}`); } // CHANGE
function world(cell) { // CHANGE
    let x = cell.geometry.width / 2, y = cell.geometry.height / 2; // CHANGE
    for (let cur = cell; cur && cur.geometry; cur = cur.parent) { x += cur.geometry.x; y += cur.geometry.y; } // CHANGE
    return { x, y }; // CHANGE
} // CHANGE
function rotate(point, center, degrees) { // CHANGE
    const angle = degrees * Math.PI / 180, dx = point.x - center.x, dy = point.y - center.y; // CHANGE
    return { x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle) }; // CHANGE
} // CHANGE

test('ordinary bed movement carries locked contents and hidden dates, preserves manual layout, and undoes once', () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        h.graph.getModel().setVisible(h.group, false); h.undoManager.clear(); // CHANGE
        const before = saved(h), original = world(h.group), child = JSON.stringify(h.plant.geometry); // CHANGE
        h.graph.moveCells([h.bed], 120, -40); // CHANGE
        close(world(h.group).x, original.x + 120, 'group x'); close(world(h.group).y, original.y - 40, 'group y'); // CHANGE
        assert.equal(JSON.stringify(h.plant.geometry), child); assert.match(h.group.style, /locked=1/); assert.match(h.assembly.style, /locked=1/); // CHANGE
        assert.equal(h.plant.getAttribute('dirty'), '1'); assert.equal(h.group.getAttribute('plant_count_actual'), '2'); // CHANGE
        assert.equal(Number(h.graph.getCellStyle(h.plant).rotation), 5); // CHANGE: translation alone must not normalize a saved label angle.
        assert.equal(h.outside.geometry.x, 750); assert.equal(h.undoManager.history.length, 1); // CHANGE
        const after = saved(h); h.undoManager.undo(); assert.deepEqual(saved(h), before); h.undoManager.redo(); assert.deepEqual(saved(h), after); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

for (const start of [0, 37, 90]) test(`rotation from ${start} preserves positions and non-circle angles while keeping circle text upright`, async () => { // CHANGE
    const h = fixture(start); // CHANGE
    try { // CHANGE
        const before = saved(h), center = world(h.bed), members = [h.group, h.plant, h.assembly, h.part]; // CHANGE
        const original = members.map(cell => ({ center: world(cell), angle: Number(h.graph.getCellStyle(cell).rotation || 0) })); // CHANGE
        h.graph.setCellStyles('rotation', String(start + 43), [h.bed]); // CHANGE
        members.forEach((cell, index) => { // CHANGE
            const expected = rotate(original[index].center, center, 43); // CHANGE
            close(world(cell).x, expected.x, cell.id + ' x'); close(world(cell).y, expected.y, cell.id + ' y'); // CHANGE
            close(Number(h.graph.getCellStyle(cell).rotation), cell === h.plant ? 0 : original[index].angle + 43, cell.id + ' angle'); // CHANGE
        }); // CHANGE
        const after = saved(h); assert.equal(h.undoManager.history.length, 1); // CHANGE
        await new Promise(resolve => setTimeout(resolve, 190)); assert.deepEqual(saved(h), after); // CHANGE
        h.undoManager.undo(); await new Promise(resolve => setTimeout(resolve, 190)); assert.deepEqual(saved(h), before); // CHANGE
        h.undoManager.redo(); await new Promise(resolve => setTimeout(resolve, 190)); assert.deepEqual(saved(h), after); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

for (const target of [0, 30, 45, 90, -33]) test(`bed rotation to ${target} keeps generated and manual labels upright through history and repeated rotations`, () => { // CHANGE
    const h = fixture(target === 0 ? 17 : 0); // CHANGE: zero is a real rotation rather than a no-op.
    try { // CHANGE
        const generated = h.graph.insertVertex(h.group, 'generated', h.value({ plant_tiler: '1', auto: '1', tile_r: '0', tile_c: '1', label: 'CAR' }), 30, 33, 12, 12, 'ellipse;rotation=-14;'); // CHANGE
        const circles = [h.plant, generated], before = saved(h), generatedBefore = { geometry: generated.geometry.clone(), style: generated.style }; // CHANGE
        const centers = circles.map(world), pivot = world(h.bed), start = Number(h.graph.getCellStyle(h.bed).rotation || 0), values = circles.map(cell => cell.value.outerHTML); // CHANGE
        h.undoManager.clear(); h.graph.setCellStyles('rotation', String(target), [h.bed]); // CHANGE
        circles.forEach((cell, index) => { // CHANGE
            const expected = rotate(centers[index], pivot, target - start); // CHANGE
            close(world(cell).x, expected.x, 'circle x'); close(world(cell).y, expected.y, 'circle y'); // CHANGE
            assert.equal(Number(h.graph.getCellStyle(cell).rotation || 0), 0); assert.equal(cell.value.outerHTML, values[index]); // CHANGE
        }); // CHANGE
        const after = saved(h), generatedAfter = { geometry: generated.geometry.clone(), style: generated.style }; // CHANGE
        assert.equal(h.undoManager.history.length, 1); h.undoManager.undo(); assert.deepEqual(saved(h), before); // CHANGE
        assert.ok(generated.geometry.equals(generatedBefore.geometry)); assert.equal(generated.style, generatedBefore.style); // CHANGE
        h.undoManager.redo(); assert.deepEqual(saved(h), after); assert.ok(generated.geometry.equals(generatedAfter.geometry)); assert.equal(generated.style, generatedAfter.style); // CHANGE
        h.graph.setCellStyles('rotation', String(target + 21), [h.bed]); // CHANGE
        circles.forEach((cell, index) => { // CHANGE
            const expected = rotate(centers[index], pivot, target + 21 - start); // CHANGE
            close(world(cell).x, expected.x, 'repeated x'); close(world(cell).y, expected.y, 'repeated y'); assert.equal(Number(h.graph.getCellStyle(cell).rotation || 0), 0); // CHANGE
        }); // CHANGE
        const codec = new h.window.mxCodec(), reopened = new h.window.mxGraphModel(); codec.decode(codec.encode(h.graph.getModel()), reopened); // CHANGE
        for (const cell of circles) { assert.ok(reopened.getCell(cell.id).geometry.equals(cell.geometry)); assert.equal(reopened.getCell(cell.id).style, cell.style); } // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('combined position and angle edits derive one rigid transform in nested parent coordinates', () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        const moduleGeo = h.moduleCell.geometry.clone(); moduleGeo.x = 70; moduleGeo.y = 90; h.graph.getModel().setGeometry(h.moduleCell, moduleGeo); h.undoManager.clear(); // CHANGE
        const c = world(h.bed), p = world(h.plant), model = h.graph.getModel(), geo = h.bed.geometry.clone(); // CHANGE
        geo.x += 30; geo.y += 50; model.beginUpdate(); // CHANGE
        try { model.setGeometry(h.bed, geo); h.graph.setCellStyles('rotation', '-33', [h.bed]); } finally { model.endUpdate(); } // CHANGE
        const expected = rotate(p, c, -33); close(world(h.plant).x, expected.x + 30, 'nested x'); close(world(h.plant).y, expected.y + 50, 'nested y'); // CHANGE
        assert.equal(Number(h.graph.getCellStyle(h.plant).rotation || 0), 0); // CHANGE: combined gestures also normalize label orientation.
        assert.equal(h.undoManager.history.length, 1); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

for (const html of [0, 1]) for (const operation of ['move', 'rotate']) test(`${operation} preview hides original ${html ? 'HTML' : 'SVG'} circles without cloning them or changing snapshots`, async () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        h.graph.setCellStyles('html', String(html), [h.plant]); h.graph.refresh(); // CHANGE
        const state = h.graph.view.getState(h.plant), nodes = [state.shape.node, state.text.node]; // CHANGE
        const title = h.graph.view.getState(h.group).text.node, titleVisibility = title.style.visibility; // CHANGE
        nodes[1].style.visibility = 'hidden'; // CHANGE: cleanup must restore a previously hidden label exactly.
        const prior = nodes.map(node => node.style.visibility), before = saved(h); h.undoManager.clear(); // CHANGE
        const preview = h.graph.__trellisBedTransforms.createPreview([h.bed], [h.group]); // CHANGE: duplicate selected contents must not hide or restore twice.
        assert.ok(preview.snapshots[0].records.has(h.plant)); // CHANGE: visual omission does not change committed membership.
        preview.update(() => operation === 'move' ? { dx: 25, dy: -15 } : { delta: 45 }); // CHANGE
        await new Promise(resolve => h.window.requestAnimationFrame(resolve)); // CHANGE
        assert.equal(h.window.document.querySelectorAll('[data-trellis-bed-preview-cell="manual"]').length, 0); // CHANGE
        assert.equal(h.window.document.querySelectorAll('[data-trellis-bed-preview-cell="crop"][data-trellis-bed-preview-kind="text"]').length, 0); assert.equal(title.style.visibility, 'hidden'); // CHANGE
        nodes.forEach(node => assert.equal(node.style.visibility, 'hidden')); assert.deepEqual(saved(h), before); assert.equal(h.undoManager.history.length, 0); // CHANGE
        assert.ok(h.window.document.querySelector('[data-trellis-bed-preview-cell="crop"]')); // CHANGE: frames still participate in the preview.
        preview.clear(); preview.clear(); nodes.forEach((node, index) => assert.equal(node.style.visibility, prior[index])); // CHANGE: cleanup is safe on repeated reset.
        assert.equal(title.style.visibility, titleVisibility); // CHANGE
        assert.deepEqual(saved(h), before); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('selected contents moved before the bed are transformed once using their original geometry', () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        const original = world(h.plant); h.graph.moveCells([h.group, h.assembly, h.bed], 110, 15); // CHANGE
        close(world(h.plant).x, original.x + 110, 'multi x'); close(world(h.plant).y, original.y + 15, 'multi y'); // CHANGE
        assert.equal(h.undoManager.history.length, 1); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('actual child plantings and irrigation are carried once by native rotation with upright circle labels', () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        const model = h.graph.getModel(), geo = h.assembly.geometry.clone(); geo.x -= h.bed.geometry.x; geo.y -= h.bed.geometry.y; // CHANGE
        const groupGeo = h.group.geometry.clone(); groupGeo.x -= h.bed.geometry.x; groupGeo.y -= h.bed.geometry.y; // CHANGE: exercise an actual nested planting as well as spatially contained siblings.
        model.beginUpdate(); try { model.add(h.bed, h.assembly); model.setGeometry(h.assembly, geo); model.add(h.bed, h.group); model.setGeometry(h.group, groupGeo); } finally { model.endUpdate(); } // CHANGE
        h.undoManager.clear(); const before = saved(h), p = world(h.part), circle = world(h.plant), c = world(h.bed); // CHANGE
        const handler = Object.create(h.window.mxVertexHandler.prototype); handler.graph = h.graph; // CHANGE
        model.beginUpdate(); try { handler.rotateCell(h.bed, 57); } finally { model.endUpdate(); } // CHANGE
        const expected = rotate(p, c, 57); close(world(h.part).x, expected.x, 'native child x'); close(world(h.part).y, expected.y, 'native child y'); // CHANGE
        const expectedCircle = rotate(circle, c, 57); close(world(h.plant).x, expectedCircle.x, 'nested circle x'); close(world(h.plant).y, expectedCircle.y, 'nested circle y'); // CHANGE
        assert.equal(Number(h.graph.getCellStyle(h.plant).rotation || 0), 0); // CHANGE: native recursive style changes must not leave circle text tilted.
        assert.equal(h.graph.view.getState(h.group).text.getTextRotation(), 0); // CHANGE: nested planting titles remain upright under native recursive rotation.
        assert.equal(Number(h.graph.getCellStyle(h.part).rotation), 79); assert.equal(h.undoManager.history.length, 1); // CHANGE
        h.undoManager.undo(); assert.deepEqual(saved(h), before); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('overlapping beds carry only groups assigned to the smallest containing bed', () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        const small = h.createBed(120, 100, 0, 240, 245); // CHANGE
        assert.equal(h.graph.__trellisBedTransforms.resolve(h.group).bed, small); // CHANGE
        const original = world(h.group); h.graph.moveCells([h.bed], 50, 40); // CHANGE
        assert.deepEqual(world(h.group), original); // CHANGE
        h.graph.moveCells([small], -100, 30); close(world(h.group).x, original.x - 100, 'small x'); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('a protruding group follows its bed if its center is inside', () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        const model = h.graph.getModel(), geo = h.group.geometry.clone(); geo.x = 570; model.setGeometry(h.group, geo); // CHANGE
        // Center 610 is outside: move to center 590, keeping the right edge at 630. // CHANGE
        geo.x = 550; model.setGeometry(h.group, geo.clone()); h.undoManager.clear(); // CHANGE
        h.graph.moveCells([h.bed], 70, 0); close(h.group.geometry.x, 620, 'protruding x'); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('denied content access rejects the entire operation without an undo entry', () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        h.window.Trellis = { users: { canMoveCell: cell => cell !== h.group, canEditCell: () => true } }; // CHANGE
        const before = saved(h); h.graph.moveCells([h.bed], 90, 0); assert.deepEqual(saved(h), before); // CHANGE
        assert.equal(h.undoManager.history.length, 0); // CHANGE
        assert.equal(h.graph.__trellisBedTransforms.canCarry(h.graph.__trellisBedTransforms.resolve(h.bed)), false); // CHANGE
        h.window.Trellis.users.canMoveCell = () => true; h.window.Trellis.users.canEditCell = cell => cell !== h.assembly; // CHANGE
        h.graph.setCellStyles('rotation', '25', [h.bed]); assert.deepEqual(saved(h), before); assert.equal(h.undoManager.history.length, 0); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('copy, bed resize, and independent group movement retain their previous behavior', () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        const original = world(h.group), copies = h.graph.moveCells([h.bed], 600, 0, true); // CHANGE
        assert.equal(copies.length, 1); assert.deepEqual(world(h.group), original); // CHANGE
        const geo = h.bed.geometry.clone(); geo.width += 20; h.graph.resizeCells([h.bed], [geo]); assert.deepEqual(world(h.group), original); // CHANGE
        const bedBefore = JSON.stringify(h.bed.geometry); h.graph.moveCells([h.group], 10, 5); // CHANGE
        assert.equal(JSON.stringify(h.bed.geometry), bedBefore); close(world(h.group).x, original.x + 10, 'independent x'); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('moving an ancestor and the bed together does not apply a second translation', () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        const original = world(h.plant); h.graph.moveCells([h.moduleCell, h.bed], 30, 20); // CHANGE
        close(world(h.plant).x, original.x + 30, 'ancestor x'); close(world(h.plant).y, original.y + 20, 'ancestor y'); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('collapsed planting snapshot and counts survive rotation and save/reopen', async () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        const proposal = h.tiler.proposePlantingGeometry({ bedCell: h.bed, plantCount: 600, spacingXCm: 5, spacingYCm: 5 }); // CHANGE
        const group = h.tiler.createPlantingFromProposal({ moduleCell: h.moduleCell, proposal, attributes: { plant_abbr: 'RAD' } }); // CHANGE
        h.tiler.retileGroup(h.graph, group, { forceCollapse: true }); // CHANGE
        const beforeValue = group.value.outerHTML, count = group.getAttribute('plant_count_actual'); // CHANGE
        h.graph.setCellStyles('rotation', '37', [h.bed]); await new Promise(resolve => setTimeout(resolve, 190)); // CHANGE
        assert.equal(group.value.outerHTML, beforeValue); assert.equal(group.getAttribute('plant_count_actual'), count); // CHANGE
        const codec = new h.window.mxCodec(), xml = codec.encode(h.graph.getModel()); // CHANGE
        const reopened = new h.window.mxGraphModel(); codec.decode(xml, reopened); // CHANGE
        assert.equal(reopened.getCell(group.id).value.outerHTML, beforeValue); assert.equal(reopened.getCell(group.id).style, group.style); // CHANGE
        assert.ok(reopened.getCell(h.plant.id).geometry.equals(h.plant.geometry)); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('preview carries visible SVG and HTML nodes, changes no model state, and cancels cleanly', async () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        h.graph.getModel().setVisible(h.assembly, false); h.undoManager.clear(); h.graph.view.setScale(1.5); h.graph.view.setTranslate(40, 30); // CHANGE
        const before = saved(h), originalVisibility = h.graph.view.getState(h.group).shape.node.style.visibility, preview = h.graph.__trellisBedTransforms.createPreview([h.bed]); // CHANGE
        const node = h.graph.view.getState(h.group).shape.node; assert.equal(node.style.visibility, 'hidden'); // CHANGE
        assert.equal(h.window.document.querySelectorAll('[data-trellis-bed-transform-preview]').length > 0, true); // CHANGE
        preview.update(() => ({ dx: 20, dy: -10, delta: 37 })); await new Promise(resolve => h.window.requestAnimationFrame(resolve)); // CHANGE
        const wrappers = h.window.document.querySelectorAll('[data-trellis-bed-transform-preview]'); // CHANGE
        assert.ok(Array.from(wrappers).some(wrapper => /rotate\(37\)/.test(wrapper.getAttribute('transform') || ''))); // CHANGE
        assert.deepEqual(saved(h), before); assert.equal(h.undoManager.history.length, 0); // CHANGE
        preview.clear(); assert.equal(node.style.visibility, originalVisibility); assert.equal(h.window.document.querySelectorAll('[data-trellis-bed-transform-preview]').length, 0); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('path snapping carries members by the final snapped delta in the same undo step', () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        // Use the real snap wrapper with a garden path preset and a nearby stationary bed. // CHANGE
        h.moduleCell.value.setAttribute('default_path_small_enabled', '1'); h.moduleCell.value.setAttribute('default_path_small_width_cm', '45'); // CHANGE
        h.createBed(400, 300, 0, 800, 200); h.undoManager.clear(); // CHANGE
        const p = world(h.plant), x = h.bed.geometry.x; h.graph.moveCells([h.bed], 158, 0, false, null, { altKey: false }); // CHANGE
        assert.notEqual(h.bed.geometry.x - x, 158, 'fixture actually triggers path snapping'); // CHANGE
        close(world(h.plant).x - p.x, h.bed.geometry.x - x, 'final snap delta'); assert.equal(h.undoManager.history.length, 1); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('rapid independent planting rotation finishes before a bed operation captures its layout', () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        h.plant.value.setAttribute('tile_r', '0'); h.plant.value.setAttribute('tile_c', '0'); // CHANGE
        h.graph.setCellStyles('rotation', '32', [h.group]); // CHANGE
        // Starting the next real transaction flushes the existing production rotation queue. // CHANGE
        const model = h.graph.getModel(); model.beginUpdate(); // CHANGE
        const original = world(h.plant), c = world(h.bed); // CHANGE
        try { h.graph.setCellStyles('rotation', '43', [h.bed]); } finally { model.endUpdate(); } // CHANGE
        const expected = rotate(original, c, 43); close(world(h.plant).x, expected.x, 'rapid x'); close(world(h.plant).y, expected.y, 'rapid y'); // CHANGE
        h.undoManager.undo(); close(world(h.plant).x, original.x, 'prior independent x'); close(world(h.plant).y, original.y, 'prior independent y'); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('cross-module bed drops carry sibling members into the destination and undo their parenting', () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        const destination = h.graph.insertVertex(null, 'destination', h.value({ garden_module: '1' }), 1000, 0, 2000, 2000); // CHANGE
        const before = saved(h), p = world(h.plant); h.undoManager.clear(); // CHANGE
        h.graph.moveCells([h.bed], 40, 30, false, destination); // CHANGE
        assert.equal(h.bed.parent, destination); assert.equal(h.group.parent, destination); assert.equal(h.assembly.parent, destination); // CHANGE
        close(world(h.plant).x, p.x + 40, 'drop x'); close(world(h.plant).y, p.y + 30, 'drop y'); // CHANGE
        h.undoManager.undo(); assert.equal(h.group.parent, h.moduleCell); assert.deepEqual(saved(h), before); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('production Trellis Users permits owned bed transforms and blocks restricted plantings atomically', () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        h.window.Draw.loadPlugin = callback => callback({ editor: { graph: h.graph, undoManager: h.undoManager }, actions: { get: () => null, addAction: () => ({}) }, hideDialog() {} }); // CHANGE
        h.window.eval(fs.readFileSync(path.join(root, 'drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Users.js'), 'utf8')); // CHANGE
        const users = h.window.Trellis.users; assert.equal(users.enableUsers('Alice', '1234').ok, true); users.stampCreatedOwner(h.moduleCell); // CHANGE
        const before = world(h.group); h.graph.moveCells([h.bed], 50, 20); close(world(h.group).x, before.x + 50, 'owned x'); // CHANGE
        assert.match(h.group.style, /locked=1/); // CHANGE
        const bob = users.createUser('Bob', '5678', false).user; assert.equal(users.setOwner(h.bed, bob.id).ok, true); // CHANGE
        users.logout(); assert.equal(users.login('Bob', '5678').ok, true); // CHANGE
        assert.equal(users.canEditCell(h.bed), true); assert.equal(users.canEditCell(h.group), false); // CHANGE
        h.undoManager.clear(); const restricted = saved(h); h.graph.moveCells([h.bed], 30, 10); // CHANGE
        assert.deepEqual(saved(h), restricted); assert.equal(h.undoManager.history.length, 0); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('move preview retains the native commit marker and reset restores sources', async () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        h.graph.setSelectionCell(h.bed); const handler = h.graph.graphHandler; // CHANGE
        const visibility = [h.graph.view.getState(h.plant).shape.node.style.visibility, h.graph.view.getState(h.plant).text.node.style.visibility]; // CHANGE: mxGraph explicitly sets some nodes to visible.
        const titleVisibility = h.graph.view.getState(h.group).text.node.style.visibility; // CHANGE
        handler.start(h.bed, 300, 300, [h.bed]); handler.currentDx = 30; handler.currentDy = 20; // CHANGE
        handler.livePreviewUsed = true; handler.livePreviewActive = true; handler.updatePreview(); // CHANGE
        assert.ok(handler.shape, 'mouseUp needs a preview marker to commit'); assert.ok(handler.__trellisBedPreview); // CHANGE
        await new Promise(resolve => h.window.requestAnimationFrame(resolve)); // CHANGE
        const p = world(h.group), event = new h.window.MouseEvent('mouseup', { clientX: 330, clientY: 320 }); // CHANGE
        const mouse = new h.window.mxMouseEvent(event, h.graph.view.getState(h.bed)); mouse.graphX = 330; mouse.graphY = 320; // CHANGE
        handler.mouseUp(h.graph, mouse); close(world(h.group).x, p.x + 30, 'release x'); // CHANGE
        assert.equal(h.window.document.querySelectorAll('[data-trellis-bed-transform-preview]').length, 0); // CHANGE
        assert.deepEqual([h.graph.view.getState(h.plant).shape.node.style.visibility, h.graph.view.getState(h.plant).text.node.style.visibility], visibility); // CHANGE: completion restores both circle renderers.
        assert.equal(h.graph.view.getState(h.group).text.node.style.visibility, titleVisibility); // CHANGE: mouse release restores the planting title too.
        assert.equal(h.undoManager.history.length, 1); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('production position fields carry the bed unit and keyboard-style graph moves share undo', () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        h.window.Graph = { createSvgImage: () => '' }; h.graph.isRecursiveVertexResize = () => false; // CHANGE
        h.window.eval(fs.readFileSync(path.join(root, 'drawio/src/main/webapp/js/grapheditor/Format.js'), 'utf8')); // CHANGE
        const panel = Object.create(h.window.ArrangePanel.prototype); // CHANGE
        panel.editorUi = { editor: { graph: h.graph }, getSelectionState: () => ({ cells: [h.bed] }) }; panel.getUnit = () => ''; // CHANGE
        const input = h.window.document.createElement('input'); h.window.document.body.appendChild(input); // CHANGE
        panel.addGeometryHandler(input, (geometry, value) => { geometry.x = value; }); // CHANGE
        input.value = '200'; input.dispatchEvent(new h.window.Event('focus')); const before = saved(h); // CHANGE
        input.value = '320'; input.dispatchEvent(new h.window.Event('change')); close(h.group.geometry.x, 380, 'position field x'); // CHANGE
        assert.equal(h.undoManager.history.length, 1); h.undoManager.undo(); assert.deepEqual(saved(h), before); // CHANGE
        h.graph.moveCells([h.bed], 1, 0); close(h.group.geometry.x, 261, 'keyboard nudge x'); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('rotation handle previews without model writes and Escape restores the rendered originals', async () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        h.graph.setSelectionCell(h.bed); const handler = h.graph.selectionCellsHandler.getHandler(h.bed), before = saved(h); // CHANGE
        const visibility = [h.graph.view.getState(h.plant).shape.node.style.visibility, h.graph.view.getState(h.plant).text.node.style.visibility]; // CHANGE
        const titleVisibility = h.graph.view.getState(h.group).text.node.style.visibility; // CHANGE
        handler.start(400, 180, h.window.mxEvent.ROTATION_HANDLE); // CHANGE
        const event = new h.window.mxMouseEvent(new h.window.MouseEvent('mousemove', { altKey: true }), h.graph.view.getState(h.bed)); // CHANGE
        event.graphX = 520; event.graphY = 180; handler.rotateVertex(event); // CHANGE
        await new Promise(resolve => h.window.requestAnimationFrame(resolve)); // CHANGE
        assert.ok(handler.__trellisBedPreview); assert.deepEqual(saved(h), before); assert.equal(h.undoManager.history.length, 0); // CHANGE
        assert.equal(h.window.document.querySelectorAll('[data-trellis-bed-preview-cell="manual"]').length, 0); // CHANGE
        assert.equal(h.graph.view.getState(h.plant).shape.node.style.visibility, 'hidden'); assert.equal(h.graph.view.getState(h.plant).text.node.style.visibility, 'hidden'); // CHANGE
        assert.equal(h.graph.view.getState(h.group).text.node.style.visibility, 'hidden'); // CHANGE
        h.graph.fireEvent(new h.window.mxEventObject(h.window.mxEvent.ESCAPE)); // CHANGE
        assert.equal(h.window.document.querySelectorAll('[data-trellis-bed-transform-preview]').length, 0); assert.deepEqual(saved(h), before); // CHANGE
        assert.deepEqual([h.graph.view.getState(h.plant).shape.node.style.visibility, h.graph.view.getState(h.plant).text.node.style.visibility], visibility); // CHANGE: Escape restores hidden originals without diagram changes.
        assert.equal(h.graph.view.getState(h.group).text.node.style.visibility, titleVisibility); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('relative irrigation vertices and edge waypoints rotate with their assembly', () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        const model = h.graph.getModel(), relative = h.graph.insertVertex(h.assembly, 'relative', '', 0.5, 0.5, 8, 8, '', true); // CHANGE
        const edge = h.graph.insertEdge(h.assembly, 'pipe-edge', '', null, null); // CHANGE
        const geo = edge.geometry.clone(); geo.points = [new h.window.mxPoint(10, 10)]; geo.sourcePoint = new h.window.mxPoint(0, 0); geo.targetPoint = new h.window.mxPoint(80, 50); geo.offset = new h.window.mxPoint(5, 7); model.setGeometry(edge, geo); // CHANGE
        const c = world(h.bed), assemblyBefore = world(h.assembly), parent = { x: assemblyBefore.x - h.assembly.geometry.width / 2, y: assemblyBefore.y - h.assembly.geometry.height / 2 }; // CHANGE
        const waypoint = rotate({ x: parent.x + 10, y: parent.y + 10 }, c, 90); h.undoManager.clear(); // CHANGE
        h.graph.setCellStyles('rotation', '90', [h.bed]); // CHANGE
        const nextParent = { x: h.assembly.geometry.x, y: h.assembly.geometry.y }; // CHANGE
        close(nextParent.x + edge.geometry.points[0].x, waypoint.x, 'edge waypoint x'); close(nextParent.y + edge.geometry.points[0].y, waypoint.y, 'edge waypoint y'); // CHANGE
        assert.equal(relative.geometry.relative, true); assert.ok(relative.geometry.offset); assert.equal(h.undoManager.history.length, 1); // CHANGE
        h.graph.setCellStyles('rotation', '37', [h.bed]); assert.equal(typeof edge.geometry.offset.equals, 'function'); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('gesture membership is frozen even if a group crosses the boundary before mouse release', () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        h.graph.setSelectionCell(h.bed); const handler = h.graph.graphHandler, original = world(h.group); // CHANGE
        handler.start(h.bed, 300, 300, [h.bed]); handler.currentDx = 40; handler.currentDy = 0; handler.updatePreview(); // CHANGE
        const displaced = h.group.geometry.clone(); displaced.x = 900; h.graph.getModel().setGeometry(h.group, displaced); // CHANGE
        const event = new h.window.mxMouseEvent(new h.window.MouseEvent('mouseup', { clientX: 340, clientY: 300 }), h.graph.view.getState(h.bed)); event.graphX = 340; event.graphY = 300; // CHANGE
        handler.mouseUp(h.graph, event); close(world(h.group).x, original.x + 40, 'frozen membership x'); // CHANGE
        assert.equal(h.window.document.querySelectorAll('[data-trellis-bed-transform-preview]').length, 0); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('a drilled-in module uses the visible bed center as the rotation preview pivot', async () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        const geometry = h.moduleCell.geometry.clone(); geometry.x = 70; geometry.y = 90; h.graph.getModel().setGeometry(h.moduleCell, geometry); // CHANGE
        h.graph.view.setCurrentRoot(h.moduleCell); h.graph.view.setScale(1.2); h.graph.view.setTranslate(10, 20); // CHANGE
        const state = h.graph.view.getState(h.bed), x = state.getCenterX(), y = state.getCenterY(); // CHANGE
        const preview = h.graph.__trellisBedTransforms.createPreview([h.bed]); preview.update(() => ({ delta: 37 })); // CHANGE
        await new Promise(resolve => h.window.requestAnimationFrame(resolve)); // CHANGE
        const wrapper = h.window.document.querySelector('[data-trellis-bed-transform-preview]'); // CHANGE
        assert.ok(wrapper.getAttribute('transform').startsWith(`translate(${x} ${y})`)); preview.clear(); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('global preview adapters preserve destruction of an uninitialized native vertex handler', () => { // CHANGE
    const h = fixture(); // CHANGE
    try { assert.doesNotThrow(() => new h.window.mxVertexHandler().destroy()); } finally { h.close(); } // CHANGE
}); // CHANGE

test('move handler reset restores hidden circles and preserves model-hidden circles', () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        const hidden = h.graph.insertVertex(h.group, 'hidden-circle', h.value({ plant_tiler: '1', label: 'CAR' }), 40, 33, 12, 12, 'ellipse;'); // CHANGE
        h.graph.getModel().setVisible(hidden, false); h.graph.setSelectionCell(h.bed); h.undoManager.clear(); // CHANGE
        const before = saved(h), handler = h.graph.graphHandler, node = h.graph.view.getState(h.plant).shape.node; // CHANGE
        const visibility = node.style.visibility; // CHANGE
        const title = h.graph.view.getState(h.group).text.node, titleVisibility = title.style.visibility; // CHANGE
        handler.start(h.bed, 300, 300, [h.bed]); handler.currentDx = 30; handler.currentDy = 20; handler.updatePreview(); // CHANGE
        assert.equal(node.style.visibility, 'hidden'); handler.reset(); assert.equal(node.style.visibility, visibility); // CHANGE
        assert.equal(title.style.visibility, titleVisibility); // CHANGE: native handler reset uses the same title cleanup as completion and Escape.
        assert.equal(h.graph.getModel().isVisible(hidden), false); assert.deepEqual(saved(h), before); assert.equal(h.undoManager.history.length, 0); // CHANGE
        assert.equal(h.window.document.querySelectorAll('[data-trellis-bed-transform-preview]').length, 0); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('detail-summary transitions preserve rotated circle centers, upright labels, and counts', () => { // CHANGE
    const h = fixture(); // CHANGE
    try { // CHANGE
        const proposal = h.tiler.proposePlantingGeometry({ bedCell: h.bed, plantCount: 8, spacingXCm: 20, spacingYCm: 30 }); // CHANGE
        const group = h.tiler.createPlantingFromProposal({ moduleCell: h.moduleCell, proposal, attributes: { plant_abbr: 'CAR' } }); // CHANGE
        const circles = h.graph.getChildVertices(group).filter(cell => cell.getAttribute('plant_tiler') === '1'); // CHANGE
        assert.equal(circles.length, 8); // CHANGE
        const originals = new Map(circles.map(cell => [cell.getAttribute('tile_r') + ',' + cell.getAttribute('tile_c'), world(cell)])), pivot = world(h.bed); // CHANGE
        h.tiler.retileGroup(h.graph, group, { forceCollapse: true }); // CHANGE
        h.graph.setCellStyles('rotation', '-30', [h.bed]); // CHANGE
        const summary = h.graph.getChildVertices(group).find(cell => cell.getAttribute('lod_summary') === '1'); // CHANGE
        assert.ok(summary); assert.equal(Number(h.graph.getCellStyle(summary).rotation), -30); // CHANGE: summaries retain their established bed rotation behavior.
        assert.equal(h.graph.view.getState(group).text.getTextRotation(), 0); // CHANGE: collapsed groups retain an upright native title.
        h.tiler.retileGroup(h.graph, group, { forceExpand: true }); // CHANGE
        const restored = h.graph.getChildVertices(group).filter(cell => cell.getAttribute('plant_tiler') === '1'); // CHANGE
        assert.equal(restored.length, 8); assert.equal(group.getAttribute('plant_count_actual'), '8'); // CHANGE
        assert.equal(h.graph.view.getState(group).text.getTextRotation(), 0); // CHANGE: expanding details restores circles without rotating the title.
        for (const cell of restored) { // CHANGE
            const expected = rotate(originals.get(cell.getAttribute('tile_r') + ',' + cell.getAttribute('tile_c')), pivot, -30); // CHANGE
            close(world(cell).x, expected.x, 'restored x'); close(world(cell).y, expected.y, 'restored y'); assert.equal(Number(h.graph.getCellStyle(cell).rotation || 0), 0); // CHANGE
        } // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE
