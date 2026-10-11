const assert = require('node:assert/strict'); // CHANGE
const test = require('node:test'); // CHANGE
const { loadPlantTilerMxGraph } = require('./helpers/plant-tiler-mxgraph-harness.cjs'); // CHANGE

/** Rotated generated children must never change their authoritative parent frame. */ // CHANGE
test('dense rotated planting creation and repeated tiling retain proposal geometry and count', () => { // CHANGE
    const h = loadPlantTilerMxGraph(); // CHANGE
    try { // CHANGE
        for (const rotation of [0, 30, 45, 90, -30]) { // CHANGE
            const bed = h.bed(100, 250, rotation); // CHANGE
            const { group, proposal } = create(h, bed, { fillAvailableBed: true, spacingXCm: 15, spacingYCm: 15, vegDiameterCm: 10 }); // CHANGE
            for (let pass = 0; pass < 3; pass++) { // CHANGE
                for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(group.geometry[key] - proposal.geometry[key]) < 1e-6, `${rotation}: ${key}`); // CHANGE
                assert.equal(Number(group.getAttribute('plant_count_actual')), proposal.plantCount); // CHANGE
                h.tiler.retileGroup(h.graph, group); // CHANGE
            } // CHANGE
        } // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

/** Fitting with no grid offsets exercises the trimming path and its changing rotation pivot. */ // CHANGE
test('trimming rotated fitted frames centers the actual plants on the bed', () => { // CHANGE
    const h = loadPlantTilerMxGraph(); // CHANGE
    try { // CHANGE
        // Isolate trimming from the separate parent-expansion failure. // CHANGE
        h.graph.setExtendParents(false); h.graph.setConstrainChildren(false); // CHANGE
        for (const rotation of [0, 30, 45, 90, -30]) { // CHANGE
            const bed = h.bed(100, 250, rotation); // CHANGE
            const value = h.window.mxUtils.createXmlDocument().createElement('object'); // CHANGE
            for (const [key, val] of Object.entries({ tiler_group: '1', plant_abbr: 'RAD', spacing_cm: '25', veg_diameter_cm: '20' })) value.setAttribute(key, val); // CHANGE
            const group = h.graph.insertVertex(h.moduleCell, null, value, 220, 220, 100, 250, `rotation=${rotation};`); // CHANGE
            assert.equal(h.tiler.retileAndFitToContainingBed(h.graph, group).trimmed, true); // CHANGE
            const points = h.graph.getChildVertices(group).map(cell => ({ x: group.geometry.x + cell.geometry.x + cell.geometry.width / 2, y: group.geometry.y + cell.geometry.y + cell.geometry.height / 2 })); // CHANGE
            for (const [axis, target] of [['x', 250], ['y', 325]]) { // CHANGE
                const center = (Math.min(...points.map(p => p[axis])) + Math.max(...points.map(p => p[axis]))) / 2; // CHANGE
                assert.ok(Math.abs(center - target) < 1e-6, `${rotation}: ${axis}: ${center}`); // CHANGE
            } // CHANGE
            h.graph.removeCells([group, bed]); // CHANGE: keep containing-bed lookup unambiguous across rotations.
        } // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('insertion guard leaves ordinary parent expansion enabled and detail/summary transitions stable', () => { // CHANGE
    const h = loadPlantTilerMxGraph(); // CHANGE
    try { // CHANGE
        const parent = h.graph.insertVertex(null, null, '', 0, 0, 20, 20); // CHANGE
        h.graph.insertVertex(parent, null, '', 30, 30, 20, 20); assert.equal(parent.geometry.width, 50); // CHANGE
        assert.equal(h.graph.isExtendParents(), true); assert.equal(h.graph.isConstrainChildren(), true); // CHANGE
        const bed = h.bed(100, 250, 45), { group, proposal } = create(h, bed, { fillAvailableBed: true, spacingXCm: 15, spacingYCm: 15, vegDiameterCm: 10 }); // CHANGE
        const before = JSON.stringify(group.geometry); // CHANGE
        h.tiler.retileGroup(h.graph, group, { forceCollapse: true }); assert.equal(JSON.stringify(group.geometry), before); // CHANGE
        h.tiler.retileGroup(h.graph, group, { forceExpand: true }); assert.equal(JSON.stringify(group.geometry), before); // CHANGE
        assert.equal(Number(group.getAttribute('plant_count_actual')), proposal.plantCount); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

function create(harness, bed, options = {}) { // CHANGE
    const proposal = harness.tiler.proposePlantingGeometry({ bedCell: bed, plantCount: 7, spacingXCm: 20, spacingYCm: 30, fillCompleteRows: true, ...options }); // CHANGE
    const model = harness.graph.getModel(); // CHANGE
    model.beginUpdate(); // CHANGE
    let group; // CHANGE
    try { group = harness.tiler.createPlantingFromProposal({ moduleCell: harness.moduleCell, proposal, attributes: { plant_name: 'Carrot', plant_abbr: 'CAR', plant_yield: '0.1', sow_date: '2027-04-01', harvest_end: '2027-07-01' }, insideUpdate: true }); } // CHANGE
    finally { model.endUpdate(); } // CHANGE
    return { group, proposal }; // CHANGE
} // CHANGE

test('production detail/LOD tiling and rotated geometry match the reviewed proposal', () => { // CHANGE
    const harness = loadPlantTilerMxGraph(); // CHANGE
    try { // CHANGE
        for (const [width, height, rotation, count] of [[100, 500, 0, 7], [500, 100, 37, 7], [1500, 1500, 90, 1200], [100, 27, 0, 5]]) { // CHANGE
            const bed = harness.bed(width, height, rotation); // CHANGE
            const { group, proposal } = create(harness, bed, { plantCount: count }); // CHANGE
            assert.equal(Number(group.getAttribute('plant_count_actual')), proposal.plantCount); // CHANGE
            assert.equal(Number(group.getAttribute('planting_expected_yield_kg')), proposal.plantCount * 0.1); // CHANGE
            const children = harness.graph.getChildVertices(group); // CHANGE
            assert.equal(children.filter(cell => cell.getAttribute('plant_tiler') === '1').length, proposal.lodCollapsed ? 0 : proposal.plantCount); // CHANGE
            assert.equal(children.filter(cell => cell.getAttribute('lod_summary') === '1').length, proposal.lodCollapsed ? 1 : 0); // CHANGE
            const footprint = harness.tiler.readPlantingFootprint(group); // CHANGE
            for (const key of ['x', 'y', 'width', 'height', 'rotation']) assert.ok(Math.abs(footprint[key] - proposal.plantingRect[key]) < 1e-6, key); // CHANGE
            const saved = harness.tiler.listPlantingFootprints(harness.moduleCell, { year: 2027 }).find(item => item.groupId === group.id); // CHANGE
            assert.equal(saved.bedId, bed.id); assert.ok(saved.plantingRect); // CHANGE
        } // CHANGE
    } finally { harness.close(); } // CHANGE
}); // CHANGE

test('a single undo/redo restores the fitted group, tiles, counts and axis attributes', () => { // CHANGE
    const harness = loadPlantTilerMxGraph(); // CHANGE
    try { // CHANGE
        const bed = harness.bed(100, 500); // CHANGE
        harness.undoManager.clear(); // CHANGE
        const { group, proposal } = create(harness, bed); // CHANGE
        const model = harness.graph.getModel(); // CHANGE
        const geometry = JSON.stringify(group.geometry); // CHANGE
        harness.undoManager.undo(); assert.equal(model.getCell(group.id), undefined); // CHANGE
        harness.undoManager.redo(); assert.equal(model.getCell(group.id), group); // CHANGE
        assert.equal(JSON.stringify(group.geometry), geometry); assert.equal(group.getAttribute('bed_fit_width'), '1'); // CHANGE
        assert.equal(Number(group.getAttribute('plant_count')), proposal.plantCount); // CHANGE
        assert.equal(harness.graph.getChildVertices(group).filter(cell => cell.getAttribute('plant_tiler') === '1').length, proposal.plantCount); // CHANGE
    } finally { harness.close(); } // CHANGE
}); // CHANGE

test('a shallow fitted bed retains membership and axis intent during resize', () => { // CHANGE
    const harness = loadPlantTilerMxGraph(); // CHANGE
    try { // CHANGE
        const bed = harness.bed(100, 27); // CHANGE
        const { group } = create(harness, bed, { fitAxisOverride: 'width', plantCount: 5 }); // CHANGE
        const before = group.geometry.width; // CHANGE
        const geometry = bed.geometry.clone(); geometry.width = 150; // CHANGE
        harness.graph.resizeCells([bed], [geometry]); // CHANGE
        assert.ok(group.geometry.width > before); assert.equal(group.getAttribute('bed_fit_width'), '1'); // CHANGE
        assert.equal(group.getAttribute('bed_fit_height'), '0'); // CHANGE
    } finally { harness.close(); } // CHANGE
}); // CHANGE

/** Use production fitting so both persisted axes start fitted, including its footprint trim. */ // CHANGE
function createFullyFitted(harness, rotation = 0, size = [300, 500]) { // CHANGE
    const bed = harness.bed(size[0], size[1], rotation); // CHANGE
    const { group } = create(harness, bed, { fillAvailableBed: true }); // CHANGE
    assert.equal(harness.tiler.retileAndFitToContainingBed(harness.graph, group).fitted, true); // CHANGE
    assert.equal(group.getAttribute('bed_fit_width'), '1'); // CHANGE
    assert.equal(group.getAttribute('bed_fit_height'), '1'); // CHANGE
    return { bed, group }; // CHANGE
} // CHANGE

/** Serialized model includes tiles, geometry, fit flags, disabled slots, counts and yield. */ // CHANGE
function serializeModel(harness) { // CHANGE
    return harness.window.mxUtils.getXml(new harness.window.mxCodec().encode(harness.graph.getModel())); // CHANGE
} // CHANGE

test('small fitted resizes release only changed local dimensions and undo in one step', () => { // CHANGE
    for (const rotation of [0, 37, 90]) { // CHANGE
        for (const dimensions of [['width'], ['height'], ['width', 'height']]) { // CHANGE
            const h = loadPlantTilerMxGraph(); // CHANGE
            try { // CHANGE
                const { group } = createFullyFitted(h, rotation); // CHANGE
                h.undoManager.clear(); // CHANGE
                const before = serializeModel(h), bounds = group.geometry.clone(); // CHANGE
                for (const dimension of dimensions) bounds[dimension] += 5; // CHANGE: well inside the existing 25% tolerance.
                h.graph.resizeCells([group], [bounds]); // CHANGE
                for (const dimension of ['width', 'height']) { // CHANGE
                    assert.ok(Math.abs(group.geometry[dimension] - bounds[dimension]) < 0.001, `${rotation}: ${dimension}`); // CHANGE
                    assert.equal(group.getAttribute(`bed_fit_${dimension}`), dimensions.includes(dimension) ? '0' : '1'); // CHANGE
                } // CHANGE
                assert.ok(Math.abs(group.geometry.x - bounds.x) < 0.001); // CHANGE
                assert.ok(Math.abs(group.geometry.y - bounds.y) < 0.001); // CHANGE
                const after = serializeModel(h); // CHANGE
                h.undoManager.undo(); assert.equal(serializeModel(h), before); // CHANGE
                h.undoManager.redo(); assert.equal(serializeModel(h), after); // CHANGE
            } finally { h.close(); } // CHANGE
        } // CHANGE
    } // CHANGE
}); // CHANGE

test('unfitted axes still snap, including a corner resize that releases its fitted axis', () => { // CHANGE
    const h = loadPlantTilerMxGraph(); // CHANGE
    try { // CHANGE
        const { group } = createFullyFitted(h); // CHANGE
        const value = group.value.cloneNode(true); value.setAttribute('bed_fit_height', '0'); // CHANGE
        h.graph.getModel().setValue(group, value); // CHANGE
        const bounds = group.geometry.clone(); bounds.width += 5; bounds.height += 5; // CHANGE
        h.graph.resizeCells([group], [bounds]); // CHANGE
        assert.equal(group.geometry.width, bounds.width); // CHANGE
        assert.equal(group.getAttribute('bed_fit_width'), '0'); // CHANGE
        assert.equal(group.getAttribute('bed_fit_height'), '1'); // CHANGE
        assert.notEqual(group.geometry.height, bounds.height); // CHANGE: the unfitted dimension retains existing snap-and-trim behavior.
        const next = group.geometry.clone(); next.width += 1; // CHANGE
        h.graph.resizeCells([group], [next]); // CHANGE
        assert.equal(group.getAttribute('bed_fit_width'), '1'); // CHANGE
        assert.notEqual(group.geometry.width, next.width); // CHANGE: release is temporary, even inside the recent-fit suppression window.
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('a fitted dimension cannot snap back during repeated events in the same drag', () => { // CHANGE
    const h = loadPlantTilerMxGraph(); // CHANGE
    try { // CHANGE
        const { group } = createFullyFitted(h), originalWidth = group.geometry.width; // CHANGE
        h.graph.setSelectionCell(group); // CHANGE
        const mouseEvent = new h.window.mxMouseEvent(new h.window.MouseEvent('mousedown', { button: 0 })); // CHANGE
        h.graph.fireEvent(new h.window.mxEventObject(h.window.mxEvent.FIRE_MOUSE_EVENT, 'eventName', h.window.mxEvent.MOUSE_DOWN, 'event', mouseEvent)); // CHANGE
        const model = h.graph.getModel(); model.beginUpdate(); // CHANGE
        try { // CHANGE
            h.graph.isMouseDown = true; // CHANGE
            for (const width of [originalWidth + 5, originalWidth + 1, originalWidth]) { // CHANGE
                const bounds = group.geometry.clone(); bounds.width = width; // CHANGE
                h.graph.resizeCells([group], [bounds]); // CHANGE
                assert.equal(group.geometry.width, width); // CHANGE
                assert.equal(group.getAttribute('bed_fit_width'), '0'); // CHANGE
            } // CHANGE
            h.graph.isMouseDown = false; // CHANGE
            h.graph.resizeCells([group], [group.geometry.clone()]); // CHANGE: commit preserves the gesture's original fitted state.
        } finally { h.graph.isMouseDown = false; model.endUpdate(); } // CHANGE
        assert.equal(group.getAttribute('bed_fit_width'), '0'); // CHANGE
        const next = group.geometry.clone(); next.width += 1; // CHANGE
        h.graph.resizeCells([group], [next]); // CHANGE
        assert.equal(group.getAttribute('bed_fit_width'), '1'); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('bed resizing follows retained axes and cannot restore a release in a mixed batch', () => { // CHANGE
    for (const mixedBatch of [false, true]) { // CHANGE
        const h = loadPlantTilerMxGraph(); // CHANGE
        try { // CHANGE
            const { bed, group } = createFullyFitted(h), groupBounds = group.geometry.clone(), bedBounds = bed.geometry.clone(); // CHANGE
            groupBounds.width += 5; bedBounds.width += 50; bedBounds.height += 150; // CHANGE
            if (mixedBatch) h.graph.resizeCells([bed, group], [bedBounds, groupBounds]); // CHANGE
            else { h.graph.resizeCells([group], [groupBounds]); h.graph.resizeCells([bed], [bedBounds]); } // CHANGE
            assert.equal(group.geometry.width, groupBounds.width); // CHANGE
            assert.equal(group.getAttribute('bed_fit_width'), '0'); // CHANGE
            assert.equal(group.getAttribute('bed_fit_height'), '1'); // CHANGE
            assert.ok(group.geometry.height > groupBounds.height); // CHANGE
        } finally { h.close(); } // CHANGE
    } // CHANGE
}); // CHANGE

test('same-bed moves preserve released geometry while entering another bed restores fitting', () => { // CHANGE
    const h = loadPlantTilerMxGraph(); // CHANGE
    try { // CHANGE
        const { group } = createFullyFitted(h), bounds = group.geometry.clone(); bounds.width += 5; // CHANGE
        h.graph.resizeCells([group], [bounds]); // CHANGE
        h.graph.moveCells([group], 5, 0); // CHANGE
        assert.equal(group.geometry.width, bounds.width); assert.equal(group.getAttribute('bed_fit_width'), '0'); // CHANGE
        h.bed(300, 500, 0, 1000, 200); // CHANGE
        h.graph.moveCells([group], 795, 0); // CHANGE
        assert.equal(group.getAttribute('bed_fit_width'), '1'); // CHANGE
        assert.equal(group.getAttribute('bed_fit_height'), '1'); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('no-op, child and explicit internal fits do not release axes; minimum-size clamping still applies', () => { // CHANGE
    const h = loadPlantTilerMxGraph(); // CHANGE
    try { // CHANGE
        const { group } = createFullyFitted(h); // CHANGE
        h.graph.resizeCells([group], [group.geometry.clone()]); // CHANGE
        const child = h.graph.getChildVertices(group)[0]; // CHANGE: either a detailed tile or its collapsed representation is a child-only resize.
        const childBounds = child.geometry.clone(); childBounds.width += 1; // CHANGE
        h.graph.resizeCells([child], [childBounds]); // CHANGE
        assert.equal(group.getAttribute('bed_fit_width'), '1'); assert.equal(group.getAttribute('bed_fit_height'), '1'); // CHANGE
        assert.equal(h.tiler.retileAndFitToContainingBed(h.graph, group).fitted, true); // CHANGE
        assert.equal(group.getAttribute('bed_fit_width'), '1'); assert.equal(group.getAttribute('bed_fit_height'), '1'); // CHANGE
        const bounds = group.geometry.clone(); bounds.width = 1; // CHANGE
        h.graph.resizeCells([group], [bounds]); // CHANGE
        assert.ok(group.geometry.width > 1); assert.equal(group.getAttribute('bed_fit_width'), '0'); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('collapsed planting resizes release fitting without expanding thousands of tiles', () => { // CHANGE
    const h = loadPlantTilerMxGraph(); // CHANGE
    try { // CHANGE
        const { group } = createFullyFitted(h, 0, [5000, 5000]), bounds = group.geometry.clone(); bounds.width += 5; // CHANGE
        h.graph.resizeCells([group], [bounds]); // CHANGE
        assert.equal(group.geometry.width, bounds.width); assert.equal(group.getAttribute('bed_fit_width'), '0'); // CHANGE
        assert.ok(h.graph.getChildVertices(group).some(cell => cell.getAttribute('lod_summary') === '1')); // CHANGE
        assert.equal(h.graph.getChildVertices(group).filter(cell => cell.getAttribute('plant_tiler') === '1').length, 0); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('production numeric size fields use the release pipeline and preserve ordinary shape edits', () => { // CHANGE
    const fs = require('node:fs'), path = require('node:path'), h = loadPlantTilerMxGraph(); // CHANGE
    try { // CHANGE
        h.window.Graph = { createSvgImage: () => '' }; // CHANGE: only static toolbar images need the draw.io Graph class in this mxGraph fixture.
        h.graph.isRecursiveVertexResize = () => false; // CHANGE: ordinary shapes use the editor's default nonrecursive resize policy.
        h.window.eval(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/grapheditor/Format.js'), 'utf8')); // CHANGE
        const { group } = createFullyFitted(h); // CHANGE
        let selected = group; // CHANGE
        const panel = Object.create(h.window.ArrangePanel.prototype); // CHANGE
        panel.editorUi = { editor: { graph: h.graph }, getSelectionState: () => ({ cells: [selected] }) }; // CHANGE
        panel.getUnit = () => ''; // CHANGE
        const input = h.window.document.createElement('input'); // CHANGE
        h.window.document.body.appendChild(input); // CHANGE
        let dimension = 'width'; // CHANGE
        panel.addGeometryHandler(input, (geometry, value) => { geometry[dimension] = value; }); // CHANGE
        for (dimension of ['width', 'height']) { // CHANGE
            input.value = String(group.geometry[dimension]); input.dispatchEvent(new h.window.Event('focus')); // CHANGE
            const size = group.geometry[dimension] + 5; h.undoManager.clear(); const before = serializeModel(h); // CHANGE
            input.value = String(size); input.dispatchEvent(new h.window.Event('change')); // CHANGE
            assert.equal(group.geometry[dimension], size); assert.equal(group.getAttribute(`bed_fit_${dimension}`), '0'); // CHANGE
            const after = serializeModel(h); h.undoManager.undo(); assert.equal(serializeModel(h), before); // CHANGE
            h.undoManager.redo(); assert.equal(serializeModel(h), after); // CHANGE
        } // CHANGE
        dimension = 'width'; // CHANGE
        selected = h.graph.insertVertex(null, null, '', 0, 0, 20, 20); // CHANGE
        input.value = '20'; input.dispatchEvent(new h.window.Event('focus')); // CHANGE
        input.value = '30'; input.dispatchEvent(new h.window.Event('change')); assert.equal(selected.geometry.width, 30); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE
