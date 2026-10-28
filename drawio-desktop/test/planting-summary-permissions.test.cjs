const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const test = require('node:test'); // NEW
const { loadPlantTilerMxGraph } = require('./helpers/plant-tiler-mxgraph-harness.cjs'); // NEW

/** Load both production plugins and observe rejection on the real executed model edits. */ // NEW
function loadSummaryPermissions() { // NEW
    const h = loadPlantTilerMxGraph(); // NEW
    h.window.Draw.loadPlugin = callback => callback({ editor: { graph: h.graph, undoManager: h.undoManager }, actions: { get: () => null, addAction: () => ({}) }, hideDialog() {} }); // NEW
    h.window.eval(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-permission-core.js'), 'utf8')); // NEW
    h.window.eval(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Users.js'), 'utf8')); // NEW
    h.users = h.window.Trellis.users; // NEW
    assert.equal(h.users.enableUsers('Alice', '1234').ok, true); // NEW
    h.users.stampCreatedOwner(h.moduleCell); // NEW
    h.rejected = new Set(); // NEW
    h.graph.getModel().addListener(h.window.mxEvent.CHANGE, (_sender, event) => { // NEW
        const edit = event.getProperty('edit'); // NEW
        if (edit.__trellisUsersRejected) h.rejected.add(edit); // NEW
    }); // NEW
    return h; // NEW
} // NEW

/** A legacy rotated frame near a bed exercises fitting plus the resize summary rebuild. */ // NEW
function createCollapsedGroup(h) { // NEW
    h.bed(900, 1000, 30); // NEW
    const value = h.window.mxUtils.createXmlDocument().createElement('object'); // NEW
    Object.entries({ tiler_group: '1', plant_abbr: 'RAD', spacing_cm: '8', plant_yield: '0.025', label: 'Radish' }).forEach(([key, val]) => value.setAttribute(key, val)); // NEW
    const group = h.graph.insertVertex(h.moduleCell, null, value, 200, 200, 900, 1000, 'rotation=30;'); // NEW
    h.tiler.retileGroup(h.graph, group); // NEW
    assertSummary(h, group); // NEW
    return group; // NEW
} // NEW

/** Check the user-visible summary and authoritative metadata agree after each operation. */ // NEW
function assertSummary(h, group) { // NEW
    const children = h.graph.getChildVertices(group); // NEW
    assert.equal(group.getAttribute('lod_collapsed'), '1'); // NEW
    assert.equal(children.length, 1); // NEW
    assert.equal(children[0].getAttribute('lod_summary'), '1'); // NEW
    const count = Number(group.getAttribute('plant_count_actual')); // NEW
    assert.ok(count > 300); // NEW
    assert.equal(Number(group.getAttribute('plant_count')), count); // NEW
    assert.equal(Number(group.getAttribute('planting_expected_yield_kg')), count * 0.025); // NEW
    assert.ok(children[0].getAttribute('label').includes(`× ${count}`)); // NEW
    assert.ok(children[0].getAttribute('label').includes('Expected yield')); // NEW
    assert.equal(h.rejected.size, 0); // NEW
    assert.equal(h.window.document.querySelector('.trellis-users-rejected-edit-popover'), null); // NEW
} // NEW

test('admin rotated collapsed resize keeps summary, counts, yield and one-step undo/redo', () => { // NEW
    const h = loadSummaryPermissions(); // NEW
    try { // NEW
        const group = createCollapsedGroup(h); // NEW
        h.tiler.retileAndFitToContainingBed(h.graph, group); assertSummary(h, group); // NEW: establish fitted axes before testing a user resize.
        const model = h.graph.getModel(); // NEW
        const serialize = () => h.window.mxUtils.getXml(new h.window.mxCodec().encode(model)); // NEW
        h.undoManager.clear(); // NEW
        const before = serialize(), originalCount = Number(group.getAttribute('plant_count')); // NEW
        const previousSummary = h.graph.getChildVertices(group)[0]; // NEW
        const bounds = group.geometry.clone(); bounds.width *= 0.9; // NEW
        h.graph.resizeCells([group], [bounds]); // NEW
        assertSummary(h, group); // NEW
        assert.ok(Number(group.getAttribute('plant_count')) < originalCount); // NEW
        assert.equal(group.geometry.width, bounds.width); // NEW
        assert.notEqual(h.graph.getChildVertices(group)[0], previousSummary); // NEW
        const after = serialize(); // NEW
        h.undoManager.undo(); assert.equal(serialize(), before); // NEW
        h.undoManager.redo(); assert.equal(serialize(), after); // NEW
        assertSummary(h, group); // NEW
        const next = group.geometry.clone(); next.width *= 0.95; // NEW
        h.graph.resizeCells([group], [next]); assertSummary(h, group); // NEW
    } finally { h.close(); } // NEW
}); // NEW

test('repeated summary rebuilding and bed fitting allow temporary summaries in one edit', () => { // NEW
    const h = loadSummaryPermissions(); // NEW
    try { // NEW
        const group = createCollapsedGroup(h), model = h.graph.getModel(); // NEW
        const before = JSON.stringify(group.geometry); // NEW
        model.beginUpdate(); // NEW
        try { h.tiler.retileGroup(h.graph, group); h.tiler.retileGroup(h.graph, group); } finally { model.endUpdate(); } // NEW
        assertSummary(h, group); // NEW
        assert.equal(JSON.stringify(group.geometry), before); // NEW
        assert.equal(h.tiler.retileAndFitToContainingBed(h.graph, group).fitted, true); // NEW
        assertSummary(h, group); // NEW
    } finally { h.close(); } // NEW
}); // NEW

for (const preset of ['gardener', 'coordinator']) { // NEW
    test(`${preset} can rebuild a permitted summary and create a collapsed planting`, () => { // NEW
        const h = loadSummaryPermissions(); // NEW
        try { // NEW
            const group = createCollapsedGroup(h); // NEW
            const targetBed = h.bed(900, 1000, 0, 1100, 200); // NEW
            const bob = h.users.createUser('Bob', '5678', false).user; // NEW
            assert.equal(h.users.setScopeGrant(h.moduleCell, { userId: bob.id, preset }).ok, true); // NEW
            if (preset === 'gardener') assert.equal(h.users.setOwner(group, bob.id).ok, true); // NEW
            h.users.logout(); assert.equal(h.users.login('Bob', '5678').ok, true); // NEW
            const bounds = group.geometry.clone(); bounds.width *= 0.9; // NEW
            h.graph.resizeCells([group], [bounds]); assertSummary(h, group); // NEW
            const value = group.value.cloneNode(true); value.removeAttribute(h.users.attrs.owner); // NEW
            const model = h.graph.getModel(); let created; // NEW
            model.beginUpdate(); // NEW
            try { // NEW
                created = h.graph.insertVertex(h.moduleCell, null, value, targetBed.geometry.x, targetBed.geometry.y, 900, 1000, 'rotation=0;'); // NEW
                h.tiler.retileGroup(h.graph, created); h.tiler.retileGroup(h.graph, created); // NEW: summary creation and replacement before ownership is stamped.
            } finally { model.endUpdate(); } // NEW
            assertSummary(h, created); // NEW
            assert.equal(created.getAttribute(h.users.attrs.owner), bob.id); // NEW
        } finally { h.close(); } // NEW
    }); // NEW
} // NEW

test('summary lifecycle transitions between detail and collapsed presentation with users enabled', () => { // NEW
    const h = loadSummaryPermissions(); // NEW
    try { // NEW
        const group = createCollapsedGroup(h); // NEW
        const value = group.value.cloneNode(true); value.setAttribute('bed_auto_fit', '0'); // NEW
        h.graph.getModel().setValue(group, value); // NEW: prevent bed fitting from overriding the transition dimensions.
        const small = group.geometry.clone(); small.width = 100; small.height = 100; // NEW
        h.graph.resizeCells([group], [small]); // NEW
        assert.equal(h.rejected.size, 0); // NEW
        assert.equal(group.getAttribute('lod_collapsed'), '0'); // NEW
        assert.equal(h.graph.getChildVertices(group).length, Number(group.getAttribute('plant_count_actual'))); // NEW
        assert.ok(h.graph.getChildVertices(group).every(cell => cell.getAttribute('plant_tiler') === '1')); // NEW
        const large = group.geometry.clone(); large.width = 900; large.height = 1000; // NEW
        h.graph.resizeCells([group], [large]); assertSummary(h, group); // NEW
    } finally { h.close(); } // NEW
}); // NEW

for (const preset of ['visitor', 'gardener']) { // NEW
    test(`${preset} cannot resize another user's collapsed planting`, () => { // NEW
        const h = loadSummaryPermissions(); // NEW
        try { // NEW
            const group = createCollapsedGroup(h); // NEW
            const bob = h.users.createUser('Bob', '5678', false).user; // NEW
            assert.equal(h.users.setScopeGrant(h.moduleCell, { userId: bob.id, preset }).ok, true); // NEW
            h.users.logout(); h.users.login('Bob', '5678'); // NEW
            const geometry = JSON.stringify(group.geometry), value = group.value.outerHTML; // NEW
            const originalSummary = h.graph.getChildVertices(group)[0]; // NEW
            const bounds = group.geometry.clone(); bounds.width *= 0.9; // NEW
            h.graph.resizeCells([group], [bounds]); // NEW
            assert.ok(h.rejected.size > 0); // NEW
            assert.equal(JSON.stringify(group.geometry), geometry); // NEW
            assert.equal(group.value.outerHTML, value); // NEW
            assert.equal(h.graph.getChildVertices(group)[0], originalSummary); // NEW
        } finally { h.close(); } // NEW
    }); // NEW
} // NEW

test('a mixed authorized and unauthorized summary edit rolls back the complete real transaction', () => { // NEW
    const h = loadSummaryPermissions(); // NEW
    try { // NEW
        const owned = createCollapsedGroup(h), otherValue = owned.value.cloneNode(true); // NEW
        const other = h.graph.insertVertex(h.moduleCell, null, otherValue, 1100, 200, 900, 1000, 'rotation=0;'); // NEW
        h.tiler.retileGroup(h.graph, other); // NEW
        const bob = h.users.createUser('Bob', '5678', false).user; // NEW
        h.users.setScopeGrant(h.moduleCell, { userId: bob.id, preset: 'gardener' }); // NEW
        h.users.setOwner(owned, bob.id); h.users.logout(); h.users.login('Bob', '5678'); // NEW
        const model = h.graph.getModel(), serialize = () => h.window.mxUtils.getXml(new h.window.mxCodec().encode(model)); // NEW
        const before = serialize(); // NEW
        model.beginUpdate(); // NEW
        try { h.tiler.retileGroup(h.graph, owned); h.tiler.retileGroup(h.graph, other); } finally { model.endUpdate(); } // NEW
        assert.equal(h.rejected.size, 1); // NEW
        assert.equal(serialize(), before); // NEW
    } finally { h.close(); } // NEW
}); // NEW
