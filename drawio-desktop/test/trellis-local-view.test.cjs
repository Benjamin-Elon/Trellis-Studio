/** Real shipped mxGraph exercises folding geometry, encoding, preferences, and non-undoable refresh patches. */ // NEW
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const harness = require('./helpers/object-details-harness.cjs');
const webapp = path.resolve(__dirname, '../drawio/src/main/webapp');
function setup(t) {
    const h = harness(t), { w, ui, graph } = h;
    Object.setPrototypeOf(ui, w.EditorUi.prototype); // NEW: exercise the complete native patch/codec helper contract.
    ui.getCurrentFile = () => current;
    ui.getXmlFileData = () => new w.mxCodec().encode(graph.model);
    ui.getFileData = () => w.mxUtils.getXml(ui.getXmlFileData());
    const current = { fileObject: { path: 'C:/test/local.drawio' }, ui, modified: false, isModified() { return this.modified; }, setModified(value) { this.modified = value; }, patch: w.DrawioFile.prototype.patch };
    const page = new w.DiagramPage(w.mxUtils.parseXml('<diagram id="page-a"/>').documentElement); // CHANGE
    page.root = graph.model.root; page.viewState = {}; ui.pages = [page]; ui.currentPage = page; // CHANGE
    for (const name of ['applyPatches', 'patchPages', 'patchPage', 'patchCellRecursive', 'patchCell', 'createParentLookup', 'getCellForJson', 'getJsonForCell', 'diffCell', 'updatePageRoot']) ui[name] = w.EditorUi.prototype[name];
    w.eval(fs.readFileSync(path.join(webapp, 'js/trellis-local-view.js'), 'utf8'));
    return { ...h, current, install: () => w.TrellisLocalView.install(ui) };
}

test('folding does not change authored XML, native undo, dirty state, or nested edit transactions', t => {
    const { graph, ui, w, undo, install } = setup(t);
    const parent = graph.insertVertex(null, 'group', 'Group', 10, 10, 300, 200, 'collapsible=1;');
    graph.insertVertex(parent, 'child', 'Child', 10, 10, 20, 20);
    const baseline = ui.getFileData(); undo.clear(); let changes = 0;
    graph.model.addListener(w.mxEvent.CHANGE, () => changes++);
    install(); graph.foldCells(true, false, [parent]);
    assert.equal(parent.collapsed, true); assert.equal(ui.getFileData(), baseline); assert.equal(changes, 0); assert.equal(undo.canUndo(), false);
    graph.model.beginUpdate();
    try { graph.model.setValue(graph.model.getCell('child'), 'Authored edit'); graph.foldCells(false, false, [parent]); }
    finally { graph.model.endUpdate(); }
    assert.equal(changes, 1); assert.equal(undo.canUndo(), true);
    undo.undo(); assert.equal(graph.model.getCell('child').value, 'Child');
});

test('fold preferences isolate users and deliberate moves still change authored geometry', t => {
    const { graph, ui, policy, install, w } = setup(t);
    const cell = graph.insertVertex(null, 'group', 'Group', 10, 10, 300, 200, 'collapsible=1;');
    graph.insertVertex(cell, 'child', 'Child', 10, 10, 20, 20);
    const view = install(); graph.foldCells(true, false, [cell]);
    const moved = cell.geometry.clone(); moved.x += 25; graph.model.setGeometry(cell, moved);
    const persisted = w.mxUtils.parseXml(ui.getFileData()).querySelector('mxCell[id="group"] mxGeometry');
    assert.equal(Number(persisted.getAttribute('x')), 35); assert.equal(Number(persisted.getAttribute('width')), 300);
    policy.currentUser = 'user-b'; view.apply(() => {}); assert.equal(cell.collapsed, false);
    policy.currentUser = 'user-a'; view.apply(() => {}); assert.equal(cell.collapsed, true);
});

test('scoped native incoming patches preserve unrelated edits, selection and editing undo', t => {
    const { graph, ui, w, undo, current } = setup(t);
    const a = graph.insertVertex(null, 'a', 'A1', 10, 10, 40, 40), b = graph.insertVertex(null, 'b', 'B0', 100, 10, 40, 40);
    undo.clear(); graph.model.setValue(a, 'A2'); graph.setSelectionCell(a);
    w.eval(fs.readFileSync(path.join(webapp, 'js/trellis-incoming-changes.js'), 'utf8'));
    const incoming = w.TrellisIncomingChanges.create(ui, { status() {} });
    const patch = incoming.patchFor([{ key: JSON.stringify(['page-a', 'b']), xml: '<mxCell id="b" value="B1" vertex="1" parent="1"><mxGeometry x="100" y="10" width="40" height="40" as="geometry"/></mxCell>' }]);
    current.patch([patch], null, false, false);
    assert.equal(a.value, 'A2'); assert.equal(b.value, 'B1'); assert.equal(graph.getSelectionCell(), a);
    undo.undo(); assert.equal(a.value, 'A1'); assert.equal(b.value, 'B1');
});

test('rejected holds close only the matching details and discard their private comment draft', async t => {
    const h = setup(t), a = h.vertex('a', 'Details'), b = h.vertex('b', 'Other');
    h.controller.open(a); h.controller.open(b);
    const panel = [...h.w.document.querySelectorAll('.trellis-object-details')].find(node => node.dataset.collaborationObjectId === a.id);
    panel.querySelector('[data-details-tab="comments"]').click();
    const composer = panel.querySelector('.trellis-comment-editor'); composer.innerHTML = '<p>Unapplied draft</p>'; composer.dispatchEvent(new h.w.InputEvent('input', { bubbles: true }));
    h.controller.rejectHolds([JSON.stringify(['page-a', 'a'])]);
    assert.equal(panel.isConnected, false);
    assert.equal([...h.w.document.querySelectorAll('.trellis-object-details')].some(node => node.dataset.collaborationObjectId === b.id), true);
    assert.equal([...Array(h.w.localStorage.length).keys()].some(i => (h.w.localStorage.getItem(h.w.localStorage.key(i)) || '').includes('Unapplied draft')), false);
});

test('native refresh adds linked cells, reparents them, and deletes a complete group outside undo', t => { // NEW
    const { graph, ui, w, undo, current, install } = setup(t);
    const left = graph.insertVertex(null, 'left', 'Left', 0, 0, 200, 200), right = graph.insertVertex(null, 'right', 'Right', 300, 0, 200, 200);
    const child = graph.insertVertex(left, 'child', 'Child', 10, 20, 40, 40);
    install(); undo.clear();
    w.eval(fs.readFileSync(path.join(webapp, 'js/trellis-incoming-changes.js'), 'utf8'));
    const incoming = w.TrellisIncomingChanges.create(ui, { status() {} });
    const change = (id, xml, previous) => ({ key: JSON.stringify(['page-a', id]), xml, previous });
    const vertex = (id, parent) => '<mxCell id="' + id + '" value="' + id + '" vertex="1" parent="' + parent + '"><mxGeometry x="10" y="20" width="40" height="40" as="geometry"/></mxCell>';
    const apply = changes => graph.__trellisLocalView.apply(() => current.patch([incoming.patchFor(changes)], null, false, false));
    apply([change('new', vertex('new', 'right')), change('child', vertex('child', 'right'), 'new'), change('edge', '<mxCell id="edge" edge="1" parent="1" source="child" target="new"><mxGeometry relative="1" as="geometry"/></mxCell>')]);
    assert.equal(child.parent, right); assert.equal(right.children[0].id, 'new');
    assert.equal(graph.model.getCell('edge').source, child); assert.equal(graph.model.getCell('edge').target.id, 'new');
    assert.equal(undo.canUndo(), false);
    apply([change('edge', null), change('child', null), change('new', null), change('right', null)]);
    assert.equal(graph.model.getCell('right'), undefined); assert.equal(left.children.length, 0); assert.equal(undo.canUndo(), false); // CHANGE
});

test('folded deliberate geometry edits undo back to authored bounds and a restore reapplies personal folding', t => { // NEW
    const { graph, ui, w, undo, install } = setup(t);
    const cell = graph.insertVertex(null, 'group', 'Group', 10, 10, 300, 200, 'collapsible=1;');
    graph.insertVertex(cell, 'child', 'Child', 10, 10, 20, 20);
    const view = install(), baseline = ui.getFileData(); undo.clear(); graph.foldCells(true, false, [cell]);
    const moved = cell.geometry.clone(); moved.x += 25; graph.model.setGeometry(cell, moved); undo.undo();
    assert.equal(ui.getFileData(), baseline); assert.equal(cell.collapsed, true);
    view.apply(() => { const model = new w.mxGraphModel(); new w.mxCodec(w.mxUtils.parseXml(baseline)).decode(w.mxUtils.parseXml(baseline).documentElement, model); graph.model.setRoot(model.root); });
    assert.equal(graph.model.getCell('group').collapsed, true); // CHANGE
    const persisted = w.mxUtils.parseXml(ui.getFileData()).querySelector('mxCell[id="group"] mxGeometry'); // NEW: the native codec may reorder attributes on decode.
    assert.equal(persisted.getAttribute('x'), '10'); assert.equal(persisted.getAttribute('width'), '300'); assert.equal(persisted.querySelector('mxRectangle'), null);
});

test('the real cluster controller retains two expanded clusters without document or undo changes', t => { // NEW
    const { graph, ui, w, undo, install } = setup(t); install();
    const modules = ['one', 'two', 'three'].map((id, i) => { const value = w.mxUtils.createXmlDocument().createElement('object'); value.setAttribute('garden_module', '1'); const cell = new w.mxCell(value, new w.mxGeometry(i * 300, 50, 200, 150), 'swimlane;module=1;collapsible=1;'); cell.id = id; cell.vertex = true; cell.collapsed = true; graph.model.add(graph.getDefaultParent(), cell); return cell; });
    w.eval(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Modules_Standalone.js'), 'utf8'));
    const baseline = ui.getFileData(); undo.clear();
    graph.foldCells(false, false, modules); assert.equal(modules.filter(cell => !cell.collapsed).length, 2);
    graph.foldCells(false, false, [modules[2]]); assert.equal(modules.filter(cell => !cell.collapsed).length, 2); assert.equal(modules[2].collapsed, false);
    assert.equal(ui.getFileData(), baseline); assert.equal(undo.canUndo(), false);
});
