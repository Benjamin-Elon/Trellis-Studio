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
    assertFoldRendering(graph, graph.model.getCell('group'), true); // NEW: restored personal folding must also update the actual renderer.
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

/** Use shipped graph rendering and optional module policies, with no redraw in assertions. */ // NEW
function foldingFixture(t, { modules = false, adapterFirst = true, css = false } = {}) { // NEW
    const h = setup(t), { graph, w } = h; // NEW
    if (css) { graph.useCssTransforms = true; graph.currentTranslate = new w.mxPoint(); } // NEW
    if (adapterFirst) h.install(); // NEW
    if (modules) w.eval(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Modules_Standalone.js'), 'utf8')); // NEW
    if (!adapterFirst) h.install(); // NEW
    function group(id, parent = graph.getDefaultParent(), collapsed = false) { // NEW
        const value = w.mxUtils.createXmlDocument().createElement('object'); value.setAttribute('label', id); // NEW
        if (modules) value.setAttribute('garden_module', '1'); // NEW
        const geometry = new w.mxGeometry(40, 60, collapsed ? 120 : 300, collapsed ? 40 : 200); // NEW
        geometry.alternateBounds = new w.mxRectangle(40, 60, collapsed ? 300 : 120, collapsed ? 200 : 40); // NEW
        const cell = new w.mxCell(value, geometry, 'swimlane;collapsible=1;startSize=40;' + (modules ? 'module=1;' : '')); // NEW
        cell.id = id; cell.vertex = true; cell.collapsed = collapsed; // NEW
        graph.model.beginUpdate(); // NEW
        try { graph.model.add(parent, cell); graph.insertVertex(cell, id + '-child', 'Child', 15, 50, 30, 20); } // NEW
        finally { graph.model.endUpdate(); } // NEW
        return cell; // NEW
    } // NEW
    return { ...h, group }; // NEW
} // NEW

/** Compare cached geometry, actual child states, and the rendered control with model truth. */ // NEW
function assertFoldRendering(graph, cell, collapsed) { // NEW
    assert.equal(cell.collapsed, collapsed); // NEW
    const state = graph.view.getState(cell), geo = cell.geometry; assert.ok(state, cell.id + ' has a rendered state'); // NEW
    const origin = graph.view.getState(graph.model.getParent(cell))?.origin || { x: 0, y: 0 }; // NEW
    const scale = graph.useCssTransforms ? 1 : graph.view.scale, translate = graph.useCssTransforms ? { x: 0, y: 0 } : graph.view.translate; // NEW
    for (const [key, expected] of Object.entries({ x: (origin.x + geo.x + translate.x) * scale, y: (origin.y + geo.y + translate.y) * scale, width: geo.width * scale, height: geo.height * scale })) { // NEW
        assert.ok(Math.abs(state[key] - expected) < 1e-6, cell.id + ' rendered ' + key + ': expected ' + expected + ', got ' + state[key]); // NEW
    } // NEW
    assert.equal(!!graph.view.getState(graph.model.getChildAt(cell, 0)), !collapsed, cell.id + ' child visibility'); // NEW
    assert.ok(state.control?.node.isConnected, cell.id + ' has an attached fold control'); // NEW
    assert.equal(state.control.image, graph.getFoldingImage(state).src, cell.id + ' fold icon'); // NEW
} // NEW

test('local collapse immediately synchronizes bounds, children, controls, selection and connected edges', t => { // NEW
    const { graph, group, w, ui, current, undo } = foldingFixture(t), cell = group('collapse'); // NEW
    const child = graph.model.getChildAt(cell, 0), peer = graph.insertVertex(null, 'peer', 'Peer', 500, 80, 40, 40); // NEW
    const edge = graph.insertEdge(null, 'edge', '', child, peer), baseline = ui.getFileData(), events = []; undo.clear(); // NEW
    for (const event of [w.mxEvent.CHANGE, w.mxEvent.NOTIFY, w.mxEvent.UNDO]) graph.model.addListener(event, () => { events.push(event); current.setModified(true); }); // NEW
    graph.setSelectionCell(child); graph.cellsFolded([cell], true, false); // NEW
    assertFoldRendering(graph, cell, true); assert.equal(graph.getSelectionCount(), 0); // NEW
    assert.equal(graph.view.getState(edge).getVisibleTerminalState(true).cell, cell); // NEW
    for (const collapsed of [false, true, false, true]) { graph.foldCells(collapsed, false, [cell]); assertFoldRendering(graph, cell, collapsed); assert.equal(graph.getSelectionCell(), cell); } // NEW
    assert.equal(ui.getFileData(), baseline); assert.deepEqual(events, []); assert.equal(current.isModified(), false); assert.equal(undo.canUndo(), false); // NEW
}); // NEW

test('local expansion immediately restores bounds and children before any zoom or validation', t => { // NEW
    const { graph, group } = foldingFixture(t), cell = group('expand', graph.getDefaultParent(), true); // NEW
    graph.foldCells(false, false, [cell]); assertFoldRendering(graph, cell, false); // NEW
}); // NEW

test('fold rendering waits for an authored transaction and coalesces nested calls without changing editing undo', t => { // NEW
    const { graph, group, undo, ui } = foldingFixture(t), cell = group('transaction'), note = graph.insertVertex(null, 'note', 'Before', 500, 10, 40, 40); // NEW
    const deliveries = [], changed = graph.graphModelChanged; // NEW
    graph.graphModelChanged = function (changes) { if (graph.__trellisLocalViewChanging) deliveries.push(changes.slice()); return changed.apply(this, arguments); }; // NEW
    undo.clear(); graph.model.beginUpdate(); // NEW
    try { // NEW
        graph.model.setValue(note, 'After'); graph.foldCells(true, false, [cell]); // NEW
        graph.model.beginUpdate(); try { graph.foldCells(false, false, [cell]); graph.foldCells(true, false, [cell]); } finally { graph.model.endUpdate(); } // NEW
        assert.equal(deliveries.length, 0); // NEW
    } finally { graph.model.endUpdate(); } // NEW
    assertFoldRendering(graph, cell, true); assert.equal(deliveries.length, 1); assert.equal(undo.history.length, 1); // NEW
    const saved = ui.getFileData(); undo.undo(); assert.equal(note.value, 'Before'); assertFoldRendering(graph, cell, true); // NEW
    undo.redo(); assert.equal(ui.getFileData(), saved); assertFoldRendering(graph, cell, true); // NEW
}); // NEW

for (const adapterFirst of [true, false]) for (const css of [false, true]) { // NEW
    test('module controls, nested folds, cluster eviction and zoom stay synchronized: ' + JSON.stringify({ adapterFirst, css }), t => { // NEW
        const { graph, group, w, ui, undo } = foldingFixture(t, { modules: true, adapterFirst, css }); // NEW
        const a = group('a', graph.getDefaultParent(), true), b = group('b', graph.getDefaultParent(), true), c = group('c', graph.getDefaultParent(), true); // NEW
        const nested = group('nested', a, true), baseline = ui.getFileData(); undo.clear(); // NEW
        const center = cell => [cell.geometry.x + cell.geometry.width / 2, cell.geometry.y + cell.geometry.height / 2], originalCenter = center(a); // NEW
        graph.foldCells(false, false, [a, b, c]); assertFoldRendering(graph, a, false); assertFoldRendering(graph, b, false); assertFoldRendering(graph, c, true); // NEW
        graph.foldCells(false, false, [nested]); assertFoldRendering(graph, nested, false); // NEW
        graph.foldCells(false, false, [c]); assertFoldRendering(graph, a, false); assertFoldRendering(graph, b, true); assertFoldRendering(graph, c, false); // NEW
        graph.setSelectionCells([a, c, nested]); // NEW
        for (const collapsed of [true, false, true, false]) { // NEW
            const state = graph.view.getState(a), control = state.control.innerNode || state.control.node; // NEW
            state.__trellisFoldSelectionCells = [a, c, nested]; control.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); // NEW
            assertFoldRendering(graph, a, collapsed); assertFoldRendering(graph, c, collapsed); assert.equal(nested.collapsed, false); // NEW
            assert.deepEqual(center(a), originalCenter); // NEW
        } // NEW
        for (const scale of [0.5, 1.5, 1]) { graph.view.setScale(scale); assertFoldRendering(graph, a, false); assertFoldRendering(graph, c, false); assertFoldRendering(graph, b, true); } // NEW
        graph.setSelectionCell(c); graph.foldCells(false, false, [b]); assertFoldRendering(graph, a, true); assertFoldRendering(graph, b, false); assertFoldRendering(graph, c, false); // NEW
        assert.equal(nested.collapsed, true); assert.equal(graph.view.getState(nested), undefined); // NEW
        assert.equal(ui.getFileData(), baseline); assert.equal(undo.canUndo(), false); // NEW
    }); // NEW
} // NEW

for (const adapterFirst of [true, false]) { // NEW
    test('fold rendering drains cluster normalization without reentry or document edits: ' + adapterFirst, t => { // NEW
        const { graph, group, w, undo, ui } = foldingFixture(t, { modules: true, adapterFirst }); // NEW
        const cells = ['first', 'second', 'third'].map(id => group(id, graph.getDefaultParent(), true)), baseline = ui.getFileData(); undo.clear(); // NEW
        let calls = 0, nesting = 0, maxNesting = 0, events = 0; const changed = graph.graphModelChanged; // NEW
        graph.graphModelChanged = function () { calls++; maxNesting = Math.max(maxNesting, ++nesting); try { return changed.apply(this, arguments); } finally { nesting--; } }; // NEW
        graph.model.addListener(w.mxEvent.CHANGE, () => events++); // NEW
        graph.cellsFolded(cells, false, false); // NEW: bypass the command's preflight so the render hook itself must enforce the cluster cap.
        assert.equal(cells.filter(cell => !cell.collapsed).length, 2); // NEW
        for (const cell of cells) assertFoldRendering(graph, cell, cell.collapsed); // NEW
        assert.ok(calls >= 1 && calls <= 2); assert.equal(maxNesting, 1); // NEW
        assert.equal(events, 0); assert.equal(undo.canUndo(), false); assert.equal(ui.getFileData(), baseline); // NEW
    }); // NEW
} // NEW

test('fold preferences render correctly after user, page and root replacement without delivering obsolete cells', t => { // NEW
    const { graph, group, ui, w, policy } = foldingFixture(t), cell = group('restored'), view = graph.__trellisLocalView; // NEW
    const baseline = ui.getFileData(); graph.foldCells(true, false, [cell]); // NEW
    policy.currentUser = 'other'; view.apply(() => {}); assertFoldRendering(graph, cell, false); // NEW
    policy.currentUser = 'user-a'; view.apply(() => {}); assertFoldRendering(graph, cell, true); // NEW
    const oldRoot = graph.model.getRoot(), oldPage = ui.currentPage, oldCell = cell; // NEW
    const doc = w.mxUtils.parseXml(baseline), replacement = new w.mxGraphModel(); new w.mxCodec(doc).decode(doc.documentElement, replacement); // NEW
    const delivered = [], changed = graph.graphModelChanged; // NEW
    graph.graphModelChanged = function (changes) { if (graph.__trellisLocalViewChanging) delivered.push(...changes); return changed.apply(this, arguments); }; // NEW
    graph.model.beginUpdate(); // NEW
    try { // NEW
        graph.foldCells(false, false, [oldCell]); // NEW
        ui.currentPage = { getId: () => 'page-b' }; graph.model.setRoot(replacement.root); ui.editor.fireEvent(new w.mxEventObject('pageSelected')); // NEW
    } finally { graph.model.endUpdate(); } // NEW
    const newCell = graph.model.getCell('restored'); assertFoldRendering(graph, newCell, false); // NEW
    assert.equal(delivered.some(change => change.cell === oldCell), false); assert.equal(graph.view.getState(oldCell), undefined); // NEW
    ui.currentPage = oldPage; graph.model.setRoot(oldRoot); ui.editor.fireEvent(new w.mxEventObject('pageSelected')); assertFoldRendering(graph, oldCell, false); // NEW
    view.apply(() => { graph.model.setRoot(replacement.root); }); assertFoldRendering(graph, newCell, false); // NEW
    graph.foldCells(true, false, [newCell]); assertFoldRendering(graph, newCell, true); // NEW
}); // NEW

test('file reopen renders remembered folds and unchanged fold requests do not notify the renderer', t => { // NEW
    const { graph, group, w, ui } = foldingFixture(t), cell = group('reopened'), baseline = ui.getFileData(); // NEW
    graph.foldCells(true, false, [cell]); // NEW
    const doc = w.mxUtils.parseXml(baseline), replacement = new w.mxGraphModel(); new w.mxCodec(doc).decode(doc.documentElement, replacement); // NEW
    graph.model.setRoot(replacement.root); ui.editor.fireEvent(new w.mxEventObject('fileLoaded')); // NEW
    const reopened = graph.model.getCell('reopened'); assertFoldRendering(graph, reopened, true); // NEW
    const changed = graph.graphModelChanged; let deliveries = 0; // NEW
    graph.graphModelChanged = function () { deliveries++; return changed.apply(this, arguments); }; // NEW
    graph.foldCells(true, false, [reopened]); assert.equal(deliveries, 0); assertFoldRendering(graph, reopened, true); // NEW
    graph.foldCells(false, false, [reopened]); assert.equal(deliveries, 1); assertFoldRendering(graph, reopened, false); // NEW
}); // NEW

test('fold operations and rendering failures restore internal guards and allow the next toggle', t => { // NEW
    const { graph, group, w } = foldingFixture(t), cell = group('failure'), view = graph.__trellisLocalView; // NEW
    const failFold = () => { throw new Error('fold listener failed'); }; graph.addListener(w.mxEvent.CELLS_FOLDED, failFold); // NEW
    assert.throws(() => graph.foldCells(true, false, [cell]), /fold listener failed/); graph.removeListener(failFold); // NEW
    assertFoldRendering(graph, cell, true); assert.equal(view.isChanging(), false); assert.equal(graph.model.updateLevel, 0); // NEW
    const changed = graph.graphModelChanged; graph.graphModelChanged = () => { throw new Error('render failed'); }; // NEW
    assert.throws(() => graph.foldCells(false, false, [cell]), /render failed/); graph.graphModelChanged = changed; // NEW
    assert.equal(view.isChanging(), false); assert.equal(graph.__trellisLocalViewChanging, undefined); assert.equal(graph.__trellisUsersInternalChange, undefined); // NEW
    graph.foldCells(true, false, [cell]); assertFoldRendering(graph, cell, true); // NEW
    graph.__trellisLocalViewChanging = true; graph.__trellisUsersInternalChange = true; graph.foldCells(false, false, [cell]); // NEW
    assertFoldRendering(graph, cell, false); assert.equal(graph.__trellisLocalViewChanging, true); assert.equal(graph.__trellisUsersInternalChange, true); // NEW
}); // NEW
