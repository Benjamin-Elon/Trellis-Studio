const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const test = require('node:test'); // NEW
const { loadPlantTilerMxGraph } = require('./helpers/plant-tiler-mxgraph-harness.cjs'); // NEW
const plugins = path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins'); // NEW

/** Build real graph objects; all assertions exercise the production controller and undo manager. */ // NEW
function fixture() { // NEW
    const h = loadPlantTilerMxGraph(); // NEW
    h.value = attrs => { const value = h.window.mxUtils.createXmlDocument().createElement('object'); Object.entries(attrs).forEach(([key, entry]) => value.setAttribute(key, String(entry))); return value; }; // NEW
    h.attrs = (cell, attrs) => { const next = cell.value.cloneNode(true); Object.entries(attrs).forEach(([key, entry]) => entry == null ? next.removeAttribute(key) : next.setAttribute(key, String(entry))); h.graph.model.setValue(cell, next); }; // NEW
    h.group = (id, width = 150, height = 110, garden = h.moduleCell, attrs = {}) => { // NEW
        h.graph.model.beginUpdate(); let group; // NEW
        try { group = h.graph.insertVertex(garden, id, h.value({ tiler_group: '1', plant_abbr: 'RAD', plant_name: 'Radish', spacing_cm: '30', plant_yield: '2', bed_auto_fit: '0', ...attrs }), 200, 200, width, height, 'verticalAlign=top;rotation=30;'); h.tiler.retileGroup(h.graph, group); } finally { h.graph.model.endUpdate(); } // NEW
        return group; // NEW
    }; // NEW
    h.limits = (perPlanting, total, garden = h.moduleCell) => h.attrs(garden, { plant_circle_max_per_planting: perPlanting, plant_circle_max_total: total }); // NEW
    h.serialize = () => h.window.mxUtils.getXml(new h.window.mxCodec().encode(h.graph.model)); // NEW
    h.circles = group => h.graph.getChildVertices(group).filter(child => child.getAttribute('plant_tiler') === '1'); // NEW
    h.count = group => Number(group.getAttribute('plant_count_actual')); // NEW
    h.collapsed = group => group.getAttribute('lod_collapsed') === '1'; // NEW
    h.users = () => { // NEW
        h.window.eval(fs.readFileSync(path.join(plugins, '../../js/trellis-permission-core.js'), 'utf8')); // NEW
        h.window.eval(fs.readFileSync(path.join(plugins, 'Trellis_Users.js'), 'utf8')); // NEW
        const users = h.window.Trellis.users; assert.equal(users.enableUsers('Alice', '1234').ok, true); users.stampCreatedOwner(h.moduleCell); // NEW
        return users; // NEW
    }; // NEW
    return h; // NEW
} // NEW

test('header toggle preserves footprint, disabled slots, moved circles, counts and one-step Undo/Redo', () => { // NEW
    const h = fixture(); // NEW
    try { // NEW
        const group = h.group('crop', 180, 130, h.moduleCell, { disabled_plants: '[[0,0]]' }); // NEW
        assert.ok(h.circles(group).every(child => child.getAttribute('tile_r') !== '0' || child.getAttribute('tile_c') !== '0')); // NEW: verify a genuinely disabled slot, not just persistence of an arbitrary attribute string.
        const tile = h.circles(group)[0], moved = tile.geometry.clone(); moved.x += 2; moved.y += 3; // NEW
        h.graph.model.beginUpdate(); try { h.attrs(tile, { auto: '0', tile_dirty: '1' }); h.graph.model.setGeometry(tile, moved); } finally { h.graph.model.endUpdate(); } // NEW
        h.graph.setSelectionCell(tile); // NEW
        const button = h.window.document.querySelector('.trellis-planting-detail-toggle'); // NEW
        assert.equal(button.getAttribute('aria-label'), 'Show planting summary'); // NEW
        let bubbled = 0; h.graph.container.addEventListener('mousedown', () => bubbled++); // NEW
        button.dispatchEvent(new h.window.MouseEvent('mousedown', { bubbles: true, cancelable: true })); assert.equal(bubbled, 0); // NEW
        const footprint = JSON.stringify(group.geometry), count = h.count(group); h.limits(count, count); h.undoManager.clear(); const before = h.serialize(); // NEW: admission counts only enabled circles, including at the exact hard limit.
        button.click(); assert.equal(h.collapsed(group), true); assert.equal(group.getAttribute('plant_circle_detail_mode'), 'collapsed'); assert.equal(h.graph.getSelectionCell(), group); // NEW
        assert.equal(JSON.stringify(group.geometry), footprint); assert.equal(h.count(group), count); assert.equal(Number(group.getAttribute('planting_expected_yield_kg')), count * 2); // NEW
        const after = h.serialize(); assert.equal(h.undoManager.history.length, 1); h.undoManager.undo(); assert.equal(h.serialize(), before); h.undoManager.redo(); assert.equal(h.serialize(), after); // NEW
        h.tiler.retileGroup(h.graph, group); assert.equal(h.collapsed(group), true); // NEW
        assert.equal(h.tiler.setPlantingGroupDetail(group, true).ok, true); // NEW
        const restored = h.circles(group).find(child => child.getAttribute('tile_r') === tile.getAttribute('tile_r') && child.getAttribute('tile_c') === tile.getAttribute('tile_c')); // NEW
        assert.ok(Math.abs(restored.geometry.x - moved.x) < 1e-6); assert.ok(Math.abs(restored.geometry.y - moved.y) < 1e-6); assert.equal(restored.getAttribute('auto'), '0'); // NEW: rotation round trips preserve coordinates within floating-point precision.
        assert.equal(group.getAttribute('disabled_plants'), '[[0,0]]'); assert.equal(h.count(group), count); assert.ok(h.circles(group).every(child => child.getAttribute('tile_r') !== '0' || child.getAttribute('tile_c') !== '0')); // NEW
    } finally { h.close(); } // NEW
}); // NEW

test('exact limits admit detail, exceeded limits refuse without edits, and zero renders summaries', () => { // NEW
    const h = fixture(); // NEW
    try { // NEW
        const group = h.group('crop'), count = h.count(group); h.limits(count, count); // NEW
        h.tiler.setPlantingGroupDetail(group, false); assert.equal(h.tiler.setPlantingGroupDetail(group, true).ok, true); assert.equal(h.circles(group).length, count); // NEW
        h.limits(count - 1, count); assert.equal(h.collapsed(group), true); const before = h.serialize(); // NEW
        assert.match(h.tiler.setPlantingGroupDetail(group, true).reason, /per-planting limit/); assert.equal(h.serialize(), before); // NEW
        h.limits(count, count - 1); assert.match(h.tiler.setPlantingGroupDetail(group, true).reason, /garden limit/); // NEW
        h.limits(0, 1000); assert.equal(h.circles(group).length, 0); h.limits(1000, 0); assert.equal(h.circles(group).length, 0); // NEW
        assert.equal(group.getAttribute('plant_circle_detail_mode'), 'expanded'); h.limits(count, count); assert.equal(h.collapsed(group), false); // NEW
        assert.equal(h.count(group), count); // NEW
    } finally { h.close(); } // NEW
}); // NEW

test('manual expansion observes the garden total without displacing other plantings', () => { // NEW
    const h = fixture(); // NEW
    try { // NEW
        const first = h.group('a'), second = h.group('b'), count = h.count(first); h.limits(1000, count); // NEW
        assert.equal(h.collapsed(first), false); assert.equal(h.collapsed(second), true); const before = h.serialize(); // NEW
        assert.equal(h.tiler.setPlantingGroupDetail(second, true).ok, false); assert.equal(h.serialize(), before); // NEW
        h.tiler.setPlantingGroupDetail(first, false); assert.equal(h.tiler.setPlantingGroupDetail(second, true).ok, true); // NEW
        assert.equal(h.collapsed(first), true); assert.equal(h.collapsed(second), false); // NEW
    } finally { h.close(); } // NEW
}); // NEW

test('budget reconciliation keeps smaller groups and uses stable IDs for equal counts', () => { // NEW
    const h = fixture(); // NEW
    try { // NEW
        const large = h.group('large', 260, 180), b = h.group('b'), a = h.group('a'), count = h.count(a); // NEW
        const before = h.serialize(); h.undoManager.clear(); h.limits(1000, count); // NEW
        assert.equal(h.collapsed(a), false); assert.equal(h.collapsed(b), true); assert.equal(h.collapsed(large), true); // NEW
        assert.equal(h.undoManager.history.length, 1); const after = h.serialize(); h.undoManager.undo(); assert.equal(h.serialize(), before); h.undoManager.redo(); assert.equal(h.serialize(), after); // NEW
    } finally { h.close(); } // NEW
}); // NEW

test('resize, spacing changes and whole-garden accounting preserve manual intent and independent budgets', () => { // NEW
    const h = fixture(); // NEW
    try { // NEW
        const group = h.group('crop'), otherGarden = h.graph.insertVertex(null, 'other-garden', h.value({ garden_module: '1' }), 3000, 3000, 2000, 2000); // NEW
        const other = h.group('other', 150, 110, otherGarden); h.limits(1000, 1000, otherGarden); // NEW
        h.limits(h.count(group), h.count(group)); h.tiler.setPlantingGroupDetail(group, true); // NEW
        const larger = group.geometry.clone(); larger.width *= 2; h.graph.resizeCells([group], [larger]); // NEW
        assert.equal(h.collapsed(group), true); assert.equal(group.getAttribute('plant_circle_detail_mode'), 'expanded'); assert.equal(h.collapsed(other), false); // NEW
        h.graph.model.beginUpdate(); try { h.attrs(group, { spacing_cm: '60' }); h.tiler.retileGroup(h.graph, group); } finally { h.graph.model.endUpdate(); } // NEW
        assert.equal(h.collapsed(group), false); h.tiler.setPlantingGroupDetail(group, false); // NEW
        const smaller = group.geometry.clone(); smaller.width *= 0.9; h.graph.resizeCells([group], [smaller]); assert.equal(h.collapsed(group), true); // NEW
        h.graph.view.setCurrentRoot(otherGarden); assert.equal(h.graph.__trellisPlantingGroup.circleLimits.admission(group).ok, true); // NEW: accounting is independent of the viewport and current root.
    } finally { h.close(); } // NEW
}); // NEW

test('legacy gardens stay unchanged on installation; serialized manual choices survive reopening', () => { // NEW
    const h = fixture(); // NEW
    try { // NEW
        const group = h.group('legacy', 650, 600); assert.ok(h.count(group) > 300); assert.equal(h.tiler.readPlantCircleLimits(h.moduleCell).active, false); // NEW
        assert.equal(h.tiler.setPlantingGroupDetail(group, true).ok, true); h.tiler.retileGroup(h.graph, group); assert.equal(h.collapsed(group), false); // NEW
        const saved = h.serialize(); h.undoManager.clear(); h.window.eval(fs.readFileSync(path.join(plugins, 'Planting_Group.js'), 'utf8')); assert.equal(h.serialize(), saved); assert.equal(h.undoManager.history.length, 0); // NEW
        const reopened = fixture(); // NEW
        try { const document = reopened.window.mxUtils.parseXml(saved); new reopened.window.mxCodec(document).decode(document.documentElement, reopened.graph.model); const loaded = reopened.graph.model.getCell('legacy'); reopened.tiler.retileGroup(reopened.graph, loaded); assert.equal(loaded.getAttribute('plant_circle_detail_mode'), 'expanded'); assert.equal(reopened.collapsed(loaded), false); } finally { reopened.close(); } // NEW
    } finally { h.close(); } // NEW
}); // NEW

test('header follows view changes, hides on deselection or read-only access, and is absent from exports', async () => { // NEW
    const h = fixture(); // NEW
    try { // NEW
        const group = h.group('crop'); h.graph.setSelectionCell(group); const button = h.window.document.querySelector('.trellis-planting-detail-toggle'), left = button.style.left, before = h.serialize(); // NEW
        h.graph.view.setScale(1.5); h.graph.view.setTranslate(12, 23); await new Promise(resolve => h.window.requestAnimationFrame(resolve)); // NEW
        assert.notEqual(button.style.left, left); assert.equal(button.style.transform, ''); assert.equal(h.serialize(), before); assert.equal(h.graph.view.drawPane.querySelector('.trellis-planting-detail-toggle'), null); // NEW
        h.graph.view.setCurrentRoot(h.moduleCell); await new Promise(resolve => h.window.requestAnimationFrame(resolve)); assert.equal(button.style.display, 'block'); // NEW
        const panLeft = parseInt(button.style.left, 10), panTop = parseInt(button.style.top, 10); h.graph.panGraph(20, 15); await new Promise(resolve => h.window.requestAnimationFrame(resolve)); assert.equal(parseInt(button.style.left, 10), panLeft + 20); assert.equal(parseInt(button.style.top, 10), panTop + 15); h.graph.panGraph(0, 0); // NEW
        h.graph.clearSelection(); assert.equal(button.style.display, 'none'); h.graph.setSelectionCell(group); // NEW
        h.ui.getCurrentFile = () => ({ isEditable: () => false }); h.graph.__trellisPlantingGroup.overlay.syncSelection(); assert.equal(button.style.display, 'none'); assert.equal(h.tiler.setPlantingGroupDetail(group, false).ok, false); // NEW
    } finally { h.close(); } // NEW
}); // NEW

test('sibling creation and bed fitting use the same whole-garden limits', () => { // NEW
    const h = fixture(); // NEW
    try { // NEW
        const source = h.group('source'), count = h.count(source); h.limits(count, count); // NEW
        const sibling = h.tiler.createSiblingTilerGroupFromSource(h.graph, source, { select: false }); // NEW
        const retained = String(source.id) < String(sibling.id) ? source : sibling, summarized = retained === source ? sibling : source; // NEW: creation reconciles equal-count groups by ID, just like every other over-budget layout edit.
        assert.equal(h.collapsed(retained), false); assert.equal(h.collapsed(summarized), true); assert.equal(h.circles(retained).length, count); // NEW
        h.bed(500, 400); h.attrs(source, { bed_auto_fit: '1', bed_fit_width: '1', bed_fit_height: '1' }); // NEW
        h.tiler.retileAndFitToContainingBed(h.graph, source); // NEW
        const total = h.circles(source).length + h.circles(sibling).length; assert.ok(total <= count); assert.ok(h.circles(source).length <= count); // NEW
        h.tiler.setPlantingGroupDetail(source, false); const collapsedSibling = h.tiler.createSiblingTilerGroupFromSource(h.graph, source, { select: false }); // NEW
        assert.equal(h.collapsed(collapsedSibling), true); assert.equal(h.graph.getChildVertices(collapsedSibling).length, 1); assert.equal(h.graph.getChildVertices(collapsedSibling)[0].getAttribute('lod_summary'), '1'); // NEW
    } finally { h.close(); } // NEW
}); // NEW

test('model permissions protect garden budgets and allow only derived presentation across ownership', () => { // NEW
    const h = fixture(); // NEW
    try { // NEW
        const aliceGroup = h.group('alice', 200, 150), bobGroup = h.group('bob'), users = h.users(), bob = users.createUser('Bob', '5678', false).user; // NEW
        users.stampCreatedOwner(aliceGroup); users.setOwner(bobGroup, bob.id); users.setScopeGrant(h.moduleCell, { userId: bob.id, preset: 'coordinator' }); // NEW
        const before = h.serialize(); h.undoManager.clear(); h.limits(1000, h.count(bobGroup)); // NEW
        assert.equal(h.collapsed(aliceGroup), true); assert.equal(h.collapsed(bobGroup), false); assert.equal(h.tiler.readPlantCircleLimits(h.moduleCell).active, true); // NEW
        const after = h.serialize(); h.undoManager.undo(); assert.equal(h.serialize(), before); h.undoManager.redo(); assert.equal(h.serialize(), after); // NEW
        users.logout(); users.login('Bob', '5678'); assert.equal(h.graph.__trellisPlantingGroup.circleLimits.canConfigure(h.moduleCell), false); // NEW
        const saved = h.serialize(); h.limits(0, 0); assert.equal(h.serialize(), saved); // NEW
        assert.equal(h.tiler.setPlantingGroupDetail(bobGroup, false).ok, true); // NEW
        users.logout(); users.login('Alice', '1234'); h.limits(1000, 1000); // NEW
        const visitor = users.createUser('Visitor', '9012', false).user; users.setScopeGrant(h.moduleCell, { userId: visitor.id, preset: 'visitor' }); users.logout(); users.login('Visitor', '9012'); // NEW
        assert.equal(h.tiler.setPlantingGroupDetail(bobGroup, true).ok, false); // NEW
    } finally { h.close(); } // NEW
}); // NEW

test('a mixed unauthorized edit rolls back budget reconciliation and settings together', () => { // NEW
    const h = fixture(); // NEW
    try { // NEW
        const group = h.group('crop'), users = h.users(), alice = users.getCurrentUser(), bob = users.createUser('Bob', '5678', false).user; // NEW
        users.stampCreatedOwner(group); users.setScopeGrant(h.moduleCell, { userId: bob.id, preset: 'gardener' }); users.logout(); users.login('Bob', '5678'); // NEW
        const before = h.serialize(); h.graph.model.beginUpdate(); try { h.limits(0, 0); h.attrs(group, { plant_name: 'Unauthorized' }); } finally { h.graph.model.endUpdate(); } assert.equal(h.serialize(), before); // NEW
        assert.equal(group.getAttribute(users.attrs.owner), alice.id); // NEW
    } finally { h.close(); } // NEW
}); // NEW

test('a gardener may trigger only the budget-derived collapse of another owner\'s planting', () => { // NEW
    const h = fixture(); // NEW
    try { // NEW
        const large = h.group('alice', 230, 180), small = h.group('bob', 100, 90), users = h.users(), bob = users.createUser('Bob', '5678', false).user; // NEW
        users.stampCreatedOwner(large); users.setOwner(small, bob.id); users.setScopeGrant(h.moduleCell, { userId: bob.id, preset: 'gardener' }); // NEW
        const total = h.count(large) + h.count(small); h.limits(1000, total); users.logout(); users.login('Bob', '5678'); // NEW
        assert.equal(users.canEditCell(large), false); assert.equal(users.canEditCell(small), true); // NEW
        const before = h.serialize(), wider = small.geometry.clone(); wider.width *= 1.5; h.undoManager.clear(); h.graph.resizeCells([small], [wider]); // NEW
        assert.equal(small.geometry.width, wider.width); assert.equal(h.collapsed(large), true); assert.equal(h.collapsed(small), false); // NEW
        const after = h.serialize(); assert.equal(h.undoManager.history.length, 1); h.undoManager.undo(); assert.equal(h.serialize(), before); h.undoManager.redo(); assert.equal(h.serialize(), after); // NEW
        const safe = h.serialize(); h.graph.model.beginUpdate(); try { const bigger = small.geometry.clone(); bigger.width *= 1.2; h.graph.resizeCells([small], [bigger]); h.attrs(large, { plant_name: 'Forbidden' }); } finally { h.graph.model.endUpdate(); } assert.equal(h.serialize(), safe); // NEW
    } finally { h.close(); } // NEW
}); // NEW

/** Open the production settings dialog while mocking only its unrelated city database dependency. */ // NEW
async function openSettings(h) { // NEW
    h.window.dbBridge = { resolvePath: async () => ({ dbPath: 'test.sqlite' }), open: async () => ({ dbId: 'test' }), close: async () => {}, exec: async () => ({}), query: async (_db, sql) => ({ rows: sql.includes('SELECT *') ? [{ city_id: 1, city_name: 'Town' }] : [] }) }; // NEW
    let dialog; h.ui.showDialog = node => { dialog = node; h.window.document.body.appendChild(node); }; h.ui.hideDialog = () => {}; // NEW
    h.attrs(h.moduleCell, { unit_system: 'metric', city_id: '1', city_name: 'Town' }); h.graph.setSelectionCell(h.moduleCell); // NEW
    let button; for (let i = 0; i < 30 && !button; i++) { await new Promise(resolve => h.window.setTimeout(resolve, 10)); button = Array.from(h.window.document.querySelectorAll('button')).find(node => node.textContent === 'Set Garden Settings'); } // NEW
    assert.ok(button, 'garden selection renders its settings control'); button.click(); // NEW
    for (let i = 0; i < 20 && !dialog; i++) await new Promise(resolve => h.window.setTimeout(resolve, 10)); // NEW
    assert.ok(dialog, 'production settings dialog opens'); return dialog; // NEW
} // NEW

test('Garden Settings validates both budgets and activates legacy limits only on save', async () => { // NEW
    const h = fixture(); // NEW
    try { // NEW
        const group = h.group('crop'), dialog = await openSettings(h); // NEW
        const per = dialog.querySelector('[data-plant-circle-limit="plant_circle_max_per_planting"]'), total = dialog.querySelector('[data-plant-circle-limit="plant_circle_max_total"]'), save = Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'OK'); // NEW
        assert.equal(per.value, '200'); assert.equal(total.value, '1000'); assert.equal(h.tiler.readPlantCircleLimits(h.moduleCell).active, false); // NEW
        for (const bad of ['', '-1', '2.5', '1001']) { per.value = bad; save.click(); assert.equal(h.tiler.readPlantCircleLimits(h.moduleCell).active, false); } // NEW
        per.value = '200'; total.value = '9007199254740992'; save.click(); assert.equal(h.tiler.readPlantCircleLimits(h.moduleCell).active, false); // NEW
        const before = h.serialize(); h.undoManager.clear(); total.value = '0'; save.click(); assert.equal(h.collapsed(group), true); assert.equal(h.moduleCell.getAttribute('plant_circle_max_total'), '0'); // NEW
        assert.equal(h.undoManager.history.length, 1); h.undoManager.undo(); assert.equal(h.serialize(), before); // NEW
    } finally { h.close(); } // NEW
}); // NEW

test('Garden Settings budget fields are disabled for a content coordinator', async () => { // NEW
    const h = fixture(); // NEW
    try { // NEW
        const users = h.users(), bob = users.createUser('Bob', '5678', false).user; users.setScopeGrant(h.moduleCell, { userId: bob.id, preset: 'coordinator' }); users.logout(); users.login('Bob', '5678'); // NEW
        const dialog = await openSettings(h); assert.ok(Array.from(dialog.querySelectorAll('[data-plant-circle-limit]')).every(input => input.disabled)); // NEW
        Array.from(dialog.querySelectorAll('button')).find(button => button.textContent === 'OK').click(); assert.equal(h.tiler.readPlantCircleLimits(h.moduleCell).active, false); // NEW
    } finally { h.close(); } // NEW
}); // NEW

test('non-admin garden creators initialize only factory budgets before ownership is stamped', () => { // NEW
    const h = fixture(); // NEW
    try { // NEW
        const users = h.users(), bob = users.createUser('Bob', '5678', false).user; users.logout(); users.login('Bob', '5678'); // NEW
        let garden; h.graph.model.beginUpdate(); try { garden = h.graph.insertVertex(null, 'new-garden', h.value({ garden_module: '1' }), 3000, 3000, 2000, 2000); h.attrs(garden, { plant_circle_max_per_planting: '200', plant_circle_max_total: '1000' }); } finally { h.graph.model.endUpdate(); } // NEW: exercise the module factory's attribute writes within its creation transaction.
        assert.equal(h.graph.model.contains(garden), true); assert.equal(garden.getAttribute(users.attrs.owner), bob.id); assert.equal(h.graph.__trellisPlantingGroup.circleLimits.canConfigure(garden), true); // NEW
        let invalid; h.graph.model.beginUpdate(); try { invalid = h.graph.insertVertex(null, 'invalid-garden', h.value({ garden_module: '1' }), 5000, 5000, 2000, 2000); h.attrs(invalid, { plant_circle_max_per_planting: '999', plant_circle_max_total: '9999' }); } finally { h.graph.model.endUpdate(); } assert.equal(h.graph.model.contains(invalid), false); // NEW
    } finally { h.close(); } // NEW
}); // NEW
