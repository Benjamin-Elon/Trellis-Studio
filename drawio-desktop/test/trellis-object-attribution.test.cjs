/** Native-model integration checks for attribution, operation provenance and deferred automation. // NEW */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const webapp = path.resolve(__dirname, '../drawio/src/main/webapp');

function fixture(t) { // NEW
    const dom = new JSDOM('<!doctype html><body><div id="graph"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://trellis.test' });
    const w = dom.window; t.after(() => w.close());
    w.mxLoadResources = false; w.mxLoadStylesheets = false; w.HTMLCanvasElement.prototype.getContext = () => null;
    const load = file => w.eval(fs.readFileSync(path.join(webapp, file), 'utf8'));
    load('mxgraph/mxClient.js'); load('js/trellis-edit-context.js'); load('js/trellis-object-attribution.js'); load('js/trellis-permission-core.js');
    const graph = new w.mxGraph(w.document.getElementById('graph')), model = graph.getModel(), undo = new w.mxUndoManager();
    graph.isSpecialColor = () => false;
    graph.convertValueToString = cell => cell?.getAttribute?.('label') || '';
    const editor = new w.mxEventSource(); Object.assign(editor, { graph, undoManager: undo });
    const actions = new Map(), menu = { funct() {} }, file = {};
    const ui = { editor, getCurrentFile: () => file, getFileData: () => w.mxUtils.getXml(new w.mxCodec().encode(model)), hideDialog() {},
        actions: { get: key => actions.get(key), addAction(key, funct) { const action = { funct, setToggleAction() {}, setSelectedCallback(fn) { action.selected = fn; } }; actions.set(key, action); return action; } },
        menus: { get: () => menu, addMenuItems() {} } };
    w.Draw = { loadPlugin: callback => callback(ui) };
    load('js/trellis-permission-core.js'); // NEW: mirror the production dependency order.
    load('plugins/garden_planner_plugins/Trellis_Users.js');
    const users = w.Trellis.users; assert.equal(users.enableUsers('Alice', '1234').ok, true);
    load('plugins/garden_planner_plugins/Created_Change_Map.js');
    model.addListener(w.mxEvent.UNDO, (_sender, event) => undo.undoableEditHappened(event.getProperty('edit')));
    let time = 1900000000000; w.Date.now = () => time;
    const value = attrs => { const node = w.mxUtils.createXmlDocument().createElement('object'); for (const [key, val] of Object.entries(attrs)) node.setAttribute(key, String(val)); return node; };
    const create = (id, attrs = {}, parent) => graph.insertVertex(parent || graph.getDefaultParent(), id, value({ label: id, ...attrs }), 30, 30, 100, 60);
    const patch = (cell, attrs) => { const node = cell.value.cloneNode(true); for (const [key, val] of Object.entries(attrs)) node.setAttribute(key, String(val)); model.setValue(cell, node); };
    return { w, graph, model, undo, users, ui, actions, create, patch, context: graph.__trellisEditContext, badge: graph.__trellisObjectAttribution, advance(ms = 60000) { time += ms; }, load };
}

test('unselected content edits share Change Map facts, while maintenance and no-ops preserve them', t => { // NEW
    const h = fixture(t), cell = h.create('object');
    const created = cell.getAttribute('createdAt'), actor = h.users.getCurrentUser().id;
    assert.equal(created, '1900000000000'); assert.equal(cell.getAttribute('createdByUserId'), actor);
    assert.equal(h.badge.read(cell).editedAt, Number(created));
    h.graph.clearSelection(); h.advance(); h.patch(cell, { label: 'Changed without selection' });
    assert.equal(cell.getAttribute('lastEditedAt'), '1900000060000'); assert.equal(cell.getAttribute('lastEditedByUserId'), actor);
    const facts = JSON.stringify(h.badge.read(cell)); h.advance();
    h.context.scope('derived-presentation', () => h.model.setGeometry(cell, new h.w.mxGeometry(50, 50, 100, 60)));
    h.context.scope('generated-content', () => h.patch(cell, { label: 'Changed without selection' }));
    assert.equal(JSON.stringify(h.badge.read(cell)), facts);
    h.context.scope('generated-content', () => h.patch(cell, { label: 'Generated update' }));
    assert.equal(cell.getAttribute('createdAt'), created); assert.equal(cell.getAttribute('createdByUserId'), actor);
    assert.equal(cell.getAttribute('lastEditedAt'), '1900000120000');
});

test('native Undo and Redo restore both timestamps and authors without restamping', t => { // NEW
    const h = fixture(t), cell = h.create('object'); h.undo.clear();
    const original = cell.value.outerHTML; h.advance(); h.patch(cell, { label: 'Edited' }); const edited = cell.value.outerHTML;
    assert.notEqual(original, edited); h.advance(); h.undo.undo(); assert.equal(cell.value.outerHTML, original);
    h.advance(); h.undo.redo(); assert.equal(cell.value.outerHTML, edited);
});

test('mixed transactions retain provenance on individual changes after scopes end', t => { // NEW
    const h = fixture(t), a = h.create('manual'), b = h.create('generated'), c = h.create('presentation'); let edit;
    h.model.addListener(h.w.mxEvent.CHANGE, (_sender, event) => { edit = event.getProperty('edit'); });
    h.model.beginUpdate();
    try {
        h.patch(a, { label: 'Manual edit' });
        h.context.scope('generated-content', () => h.patch(b, { label: 'Generated edit' }));
        h.context.scope('derived-presentation', () => h.patch(c, { label: 'Rendered summary' }));
    } finally { h.model.endUpdate(); }
    const kinds = edit.changes.filter(change => !change.__trellisUsersActorStamp).map(change => h.context.kindOf(change));
    assert.deepEqual(Array.from(kinds), ['manual', 'generated-content', 'derived-presentation']);
    assert.equal(c.getAttribute('lastEditedAt') || null, null); assert.equal(h.context.current(), null); // CHANGE
});

test('deferred groups leave the model untouched, independent groups proceed, and Retry recalculates current inputs', async t => { // NEW
    const h = fixture(t), blocked = h.create('blocked'), free = h.create('free'); let holds = [{ key: '["","blocked"]', name: 'Bob' }], input = 'First', calculations = 0;
    h.graph.__trellisSharing = { automationHolds: () => holds };
    function run(cell) { return h.context.run('generated-content', { id: 'group:' + cell.id, title: 'Generate ' + cell.id, cells: () => [h.model.getCell(cell.id)], retry: () => run(cell) }, () => { calculations++; h.patch(cell, { label: input }); }); }
    const before = h.ui.getFileData(); run(blocked); assert.equal(h.ui.getFileData(), before); assert.equal(calculations, 0);
    run(free); assert.equal(free.getAttribute('label'), 'First'); assert.equal(blocked.getAttribute('label'), 'blocked');
    input = 'Current input'; holds = []; h.w.document.querySelector('[data-trellis-deferred-automation] button').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(blocked.getAttribute('label'), 'Current input'); assert.equal(calculations, 2); assert.equal(h.context.deferred.size, 0);
});

test('attribution toggle is local per user; badges are bounded, escaped and read-only', t => { // NEW
    const h = fixture(t), cell = h.create('object', { label: '<img src=x>' }); h.graph.setSelectionCell(cell);
    const before = h.ui.getFileData(), action = h.actions.get('trellisShowObjectAttribution'); h.badge.render();
    assert.equal(h.w.document.querySelectorAll('[data-trellis-attribution]').length, 1);
    assert.match(h.w.document.querySelector('[data-trellis-attribution]').textContent, /Created by Alice/);
    assert.match(h.w.document.querySelector('[data-trellis-attribution]').getAttribute('aria-label'), /Last edited by Alice/);
    action.funct(); assert.equal(h.badge.enabled(), false); assert.equal(h.w.document.querySelectorAll('[data-trellis-attribution]').length, 0);
    h.w.dispatchEvent(new h.w.CustomEvent('trellisUsersSessionChanged')); assert.equal(h.badge.enabled(), false);
    action.funct(); assert.equal(h.badge.enabled(), true); assert.equal(h.ui.getFileData(), before);
    assert.equal(h.w.TrellisObjectAttribution.relativeTime(null), 'time unknown');
    cell.value.removeAttribute('createdByUserId'); cell.value.removeAttribute('lastEditedByUserId');
    assert.match(h.badge.description(cell)[0], /Unknown/);
});

test('remote apply and Change Map styling preserve recorded attribution', t => { // NEW
    const h = fixture(t), cell = h.create('object'), original = h.badge.read(cell); h.advance();
    h.graph.__trellisSharingApplying = true; h.patch(cell, { label: 'Remote content', createdAt: original.createdAt }); h.graph.__trellisSharingApplying = false;
    assert.deepEqual(h.badge.read(cell), original);
    h.graph.__ccMapInternalChange = true; h.graph.setCellStyles('strokeColor', '#abcdef', [cell]); h.graph.__ccMapInternalChange = false;
    assert.deepEqual(h.badge.read(cell), original);
    h.graph.__trellisSharingApplying = true; h.ui.openingFile = true; h.patch(cell, { label: 'Accepted Bob edit', lastEditedByUserId: 'bob', lastEditedAt: '1900000040000' }); h.ui.openingFile = false; h.graph.__trellisSharingApplying = false; // CHANGE: accepted remote installation uses the existing graph-load boundary, after native validation.
    assert.equal(cell.getAttribute('lastEditedByUserId'), 'bob'); assert.equal(cell.getAttribute('lastEditedAt'), '1900000040000'); // NEW
});

test('regeneration by another user preserves the creator and the toggle is isolated per user', t => { // NEW
    const h = fixture(t), cell = h.create('object'), alice = h.users.getCurrentUser();
    h.actions.get('trellisShowObjectAttribution').funct(); assert.equal(h.badge.enabled(), false);
    assert.equal(h.users.createUser('Bob', '5678', true).ok, true); assert.equal(h.users.login('Bob', '5678').ok, true);
    assert.equal(h.badge.enabled(), true); h.advance();
    h.context.scope('generated-content', () => h.patch(cell, { label: 'Bob regenerated this' }));
    assert.equal(cell.getAttribute('createdByUserId'), alice.id); assert.equal(cell.getAttribute('lastEditedByUserId'), h.users.getCurrentUser().id);
    assert.match(h.badge.description(cell)[0], /Created by Alice/); assert.match(h.badge.description(cell)[1], /Last edited by Bob/);
    assert.equal(h.users.login('Alice', '1234').ok, true); assert.equal(h.badge.enabled(), false);
});

test('local drafts block unrelated automation while a manual action can maintain its own held source', async t => { // NEW
    const h = fixture(t), source = h.create('source'), other = h.create('other'); await Promise.resolve();
    h.graph.__trellisSharing = { automationHolds: () => [{ key: '["","source"]', local: true }, { key: '["","other"]', local: true }] };
    assert.equal(h.context.blocked([source]).length, 1);
    h.model.beginUpdate();
    try { h.patch(source, { label: 'Manual source' }); assert.equal(h.context.blocked([source]).length, 0); assert.equal(h.context.blocked([other]).length, 1); } finally { h.model.endUpdate(); }
    await Promise.resolve(); assert.equal(h.context.blocked([source]).length, 1);
});

test('rejected edits restore attribution along with content even when rejection follows the map observer', t => { // NEW
    const h = fixture(t), cell = h.create('object'), original = cell.value.outerHTML; h.advance();
    h.model.addListener(h.w.mxEvent.CHANGE, (_sender, event) => { const edit = event.getProperty('edit'); if (!edit.undone && !edit.__trellisUsersRejected && cell.getAttribute('label') === 'Rejected') { edit.__trellisUsersRejected = true; edit.undo(); } });
    h.patch(cell, { label: 'Rejected' }); assert.equal(cell.value.outerHTML, original);
});

test('generated presentation children use their logical parent badge and age refreshes never mutate XML', t => { // NEW
    const h = fixture(t), group = h.create('planting', { tiler_group: '1' });
    const tile = h.context.scope('derived-presentation', () => h.create('tile', { plant_tiler: '1', auto: '1' }, group));
    h.graph.setSelectionCell(tile); const before = h.ui.getFileData(); h.badge.render();
    const badges = h.w.document.querySelectorAll('[data-trellis-attribution]'); assert.equal(badges.length, 1); assert.equal(badges[0].dataset.trellisAttribution, group.id);
    h.advance(120000); h.badge.render(); assert.match(h.w.document.querySelector('[data-trellis-attribution]').textContent, /2 minutes ago/); assert.equal(h.ui.getFileData(), before);
});

test('editing an old unowned module can assign ownership without inventing creation attribution', t => { // NEW
    const h = fixture(t), cell = h.create('legacy-garden', { garden_module: '1' }); // NEW
    for (const key of ['createdAt', 'createdByUserId', h.users.attrs.owner, 'lastEditedAt', 'lastEditedByUserId']) cell.value.removeAttribute(key); // CHANGE
    h.advance(); h.patch(cell, { label: 'Updated legacy garden' }); // NEW
    assert.equal(cell.getAttribute(h.users.attrs.owner), h.users.getCurrentUser().id); // CHANGE
    assert.equal(h.badge.read(cell).createdAt, null); assert.equal(h.badge.read(cell).createdBy, ''); // NEW
    assert.match(h.badge.description(cell)[0], /Created by Unknown time unknown/); assert.match(h.badge.description(cell)[1], /Last edited by Alice/); // NEW
}); // NEW

test('recreating an older logical object preserves missing creation facts', t => { // NEW
    const h = fixture(t), old = h.create('old-task', { kanban_card: '1' }); // NEW
    const value = old.value.cloneNode(true); value.removeAttribute('createdAt'); value.removeAttribute('createdByUserId'); // NEW
    const replacement = new h.w.mxCell(value, new h.w.mxGeometry(100, 100, 100, 60), ''); replacement.setVertex(true); // NEW
    h.context.recreated.add(replacement); // NEW
    h.context.scope('generated-content', () => h.graph.addCell(replacement, h.graph.getDefaultParent())); // NEW
    assert.equal(h.badge.read(replacement).createdAt, null); assert.equal(h.badge.read(replacement).createdBy, ''); // NEW
}); // NEW
