const assert = require('node:assert/strict'); // CHANGE
const test = require('node:test'); // CHANGE
const { loadPlantTilerMxGraph } = require('./helpers/plant-tiler-mxgraph-harness.cjs'); // CHANGE

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
