/** Persistence, preference isolation and failure handling against real mxGraph rather than implementation-shaped mocks. */ // NEW
const assert = require('node:assert/strict'); // NEW
const test = require('node:test'); // NEW
const harness = require('./helpers/object-details-harness.cjs'); // NEW

/** Supply real-world layout outcomes explicitly; JSDOM has neither rendered boxes nor a native ResizeObserver. */ // NEW
async function resizedPanel(t) { // NEW
    const h = harness(t, { observePanelResizes: true, overlayVisibility: true }); // NEW
    const cell = h.vertex('resize-shape', '<p>Keep this description</p>'); h.graph.setSelectionCell(cell); await h.tick(); // NEW
    const field = h.input(cell), panel = field.closest('section'), layout = { width: 360, height: 220, rendered: true }; // NEW
    Object.defineProperties(panel, { offsetWidth: { get: () => layout.width }, offsetHeight: { get: () => layout.height } }); // NEW
    panel.getClientRects = () => layout.rendered ? [{ width: layout.width, height: layout.height }] : []; // NEW
    const observer = h.resizeObservers.find(observer => observer.node === panel), writes = []; // NEW
    const setItem = h.w.Storage.prototype.setItem; // NEW
    h.w.Storage.prototype.setItem = function (key, value) { if (key.startsWith('trellis.details.view.v1:')) writes.push(value); return setItem.call(this, key, value); }; // NEW
    panel.querySelector('[data-side=right]').click(); observer.emit(); // NEW
    const key = Object.keys(h.w.localStorage).find(key => key.startsWith('trellis.details.view.v1:')); // NEW
    return { ...h, cell, field, panel, layout, observer, writes, saved: () => JSON.parse(h.w.localStorage.getItem(key)) }; // NEW
} // NEW

test('extra-info dimensions survive suppression and stale callbacks without preference writes', async t => { // NEW
    const h = await resizedPanel(t), expected = h.saved(), before = h.writes.length, xml = h.ui.getFileData(); // NEW
    assert.equal(expected.width, 360); assert.equal(expected.height, 220); assert.equal(expected.side, 'right'); // NEW
    for (let cycle = 0; cycle < 3; cycle++) { // NEW
        h.graph.__trellisOverlayVisibility.begin('drag'); h.layout.width = 0; h.layout.height = 0; h.layout.rendered = false; h.observer.emit(); // NEW
        assert.deepEqual(h.saved(), expected); // NEW
        h.layout.width = 400; h.layout.height = 260; h.layout.rendered = true; h.observer.emit(); // NEW: even nonzero interim measurements must not save while suppressed.
        assert.deepEqual(h.saved(), expected); // NEW
        h.layout.width = 360; h.layout.height = 220; h.graph.__trellisOverlayVisibility.end('drag'); // NEW
        await new Promise(resolve => h.w.requestAnimationFrame(resolve)); // NEW
        h.observer.emit([{ target: h.panel, contentRect: { width: 0, height: 0 } }]); // NEW: queued hidden-state data must not replace the current live measurements.
        h.controller.refresh(); assert.deepEqual(h.saved(), expected); // NEW
        assert.equal(h.panel.style.width, '360px'); assert.equal(h.panel.style.height, '220px'); assert.equal(h.input(h.cell), h.field); // NEW
    } // NEW
    assert.equal(h.writes.length, before); assert.equal(h.ui.getFileData(), xml); // NEW
}); // NEW

test('extra-info rejects unrendered, detached, zero, and nonfinite resize measurements', async t => { // NEW
    const h = await resizedPanel(t), expected = h.saved(), before = h.writes.length; // NEW
    h.layout.width = 410; h.layout.rendered = false; h.observer.emit(); h.layout.rendered = true; // NEW: an ancestor can be hidden without setting panel.hidden.
    h.panel.hidden = true; h.layout.width = 410; h.observer.emit(); h.panel.hidden = false; // NEW
    const host = h.panel.parentNode; h.panel.remove(); h.observer.emit(); host.appendChild(h.panel); // NEW
    for (const [width, height] of [[0, 220], [360, 0], [NaN, 220], [360, Infinity], [-1, 220]]) { h.layout.width = width; h.layout.height = height; h.observer.emit(); } // NEW
    assert.deepEqual(h.saved(), expected); assert.equal(h.writes.length, before); // NEW
}); // NEW

test('extra-info still persists real resizes and an intentional minimum size across reopening', async t => { // NEW
    for (const [width, height] of [[480, 280], [180, 100]]) { // NEW
        const h = await resizedPanel(t); // NEW
        h.layout.width = width; h.layout.height = height; const before = h.writes.length; h.observer.emit(); // NEW
        assert.equal(h.saved().width, width); assert.equal(h.saved().height, height); assert.equal(h.writes.length, before + 1); // NEW
        h.observer.emit(); assert.equal(h.writes.length, before + 1); // NEW: unchanged dimensions do not write preferences again.
        h.graph.clearSelection(); h.controller.refresh(); h.graph.setSelectionCell(h.cell); h.controller.refresh(); // NEW
        const panel = h.input(h.cell).closest('section'); assert.equal(panel.style.width, width + 'px'); assert.equal(panel.style.height, height + 'px'); assert.equal(h.saved().side, 'right'); // NEW
    } // NEW
}); // NEW

test('extra-info resize callbacks respect user ownership, removed objects, and controller disposal', async t => { // NEW
    const h = await resizedPanel(t), expected = h.saved(), before = h.writes.length; // NEW
    h.layout.width = 440; h.policy.currentUser = 'other-user'; h.observer.emit(); h.policy.currentUser = 'user-a'; // NEW
    const parent = h.graph.model.getParent(h.cell); h.graph.model.remove(h.cell); h.observer.emit(); h.graph.model.add(parent, h.cell); // NEW
    h.controller.destroy(); h.observer.emit(); assert.equal(h.observer.disconnected, true); // NEW
    assert.deepEqual(h.saved(), expected); assert.equal(h.writes.length, before); // NEW
}); // NEW

test('native selection is allowed only inside this controller editors, including read-only rich text', async t => { // NEW
    const h = harness(t), cell = h.vertex('shape', '<p><b>Nested text</b> <a href="https://example.test/">Link text</a></p>'); // NEW
    h.graph.setSelectionCell(cell); await h.tick(); const field = h.input(cell); // NEW
    assert.equal(h.ui.getActiveRichTextTarget(), null, 'the initial click must be allowed before toolbar activation'); // NEW
    for (const target of [field, field.querySelector('p'), field.querySelector('b'), field.querySelector('a'), field.querySelector('b').firstChild]) assert.equal(h.ui.isSelectionAllowed({ target }), true); // NEW
    for (const target of [field.closest('section'), field.closest('section').firstChild, field.closest('section').querySelector('button'), h.graph.container, field.cloneNode(true)]) assert.equal(h.ui.isSelectionAllowed({ target }), false); // NEW
    const unrelated = h.w.document.createElement('div'); unrelated.contentEditable = 'true'; h.w.document.body.appendChild(unrelated); // NEW
    assert.equal(h.ui.isSelectionAllowed({ target: unrelated }), false); // NEW
    for (const tag of ['input', 'select']) assert.equal(h.ui.isSelectionAllowed({ target: h.w.document.createElement(tag) }), true); // NEW
    h.policy.editable = false; h.controller.refresh(); assert.equal(field.contentEditable, 'false'); // NEW
    assert.equal(h.ui.isSelectionAllowed({ target: field.querySelector('a').firstChild }), true, 'read-only details can still be selected and copied'); // NEW
    const target = h.w.TrellisDetailsToolbar.createTarget({ element: field, cell, canEdit: () => h.policy.editable, changed() { throw new Error('Read-only text must not change.'); } }); // NEW
    assert.equal(target.execute('insertText', 'Forbidden'), false); target.dispose(); // NEW
    assert.equal(h.controller.flush(), true); assert.equal(cell.getAttribute('trellis_details_html'), '<p><b>Nested text</b> <a href="https://example.test/">Link text</a></p>'); // NEW
}); // NEW

test('the selection hook preserves fallback arguments, receiver and return value and restores on teardown', t => { // NEW
    const calls = [], result = { original: true }; // NEW
    function original() { calls.push({ receiver: this, args: Array.from(arguments) }); return result; } // NEW
    const h = harness(t, { isSelectionAllowed: original }), receiver = { unrelated: true }, event = { target: h.graph.container }, extra = { retained: true }; // NEW
    assert.equal(h.ui.isSelectionAllowed.call(receiver, event, extra), result); // NEW
    assert.equal(calls.length, 1); assert.equal(calls[0].receiver, receiver); assert.deepEqual(calls[0].args, [event, extra]); // NEW
    h.controller.destroy(); assert.equal(h.ui.isSelectionAllowed, original); // NEW
    assert.equal(h.ui.isSelectionAllowed(event, extra), result); assert.equal(calls[1].receiver, h.ui); // NEW
}); // NEW

test('details preserve labels and metadata, survive XML roundtrip, and undo as one typing burst', async t => { // NEW
    const h = harness(t), cell = h.vertex('shape', null, { custom: 'retain', task_instructions: 'Separate instructions' }); // NEW
    h.controller.open(cell); h.undo.clear(); h.type(cell, '<b>Notes</b><div>Second paragraph</div>'); // NEW
    assert.equal(h.controller.flush(), true); assert.match(cell.getAttribute('trellis_details_html'), /<b>Notes/); // NEW
    assert.equal(cell.getAttribute('label'), 'Label shape'); assert.equal(cell.getAttribute('custom'), 'retain'); assert.equal(cell.getAttribute('task_instructions'), 'Separate instructions'); // NEW
    const xml = h.ui.getFileData(), document = h.w.mxUtils.parseXml(xml), restored = new h.w.mxGraphModel(); new h.w.mxCodec(document).decode(document.documentElement, restored); // NEW
    assert.equal(restored.getCell('shape').getAttribute('trellis_details_html'), cell.getAttribute('trellis_details_html')); // NEW
    h.undo.undo(); assert.equal(cell.value.getAttribute('trellis_details_html'), null); assert.equal(h.input(cell).textContent, ''); // NEW
    await new Promise(resolve => h.w.setTimeout(resolve, 550)); assert.equal(cell.value.getAttribute('trellis_details_html'), null, 'a stale autosave must not overwrite Undo'); // NEW
    h.undo.redo(); assert.match(cell.getAttribute('trellis_details_html'), /Notes/); // NEW
}); // NEW

test('multiple selected shapes have independent fields and a badge remains after deselection', async t => { // NEW
    const h = harness(t), a = h.vertex('a', '<p>A</p>'), b = h.vertex('b', '<p>B</p>'); // NEW
    h.graph.setSelectionCells([a, b]); await h.tick(); // NEW
    assert.equal(h.w.document.querySelectorAll('.trellis-object-details').length, 2); // NEW
    assert.equal(h.w.document.activeElement, h.w.document.body, 'automatic opening must not steal focus'); // NEW
    const panel = h.input(a).closest('section'); panel.querySelector('[data-side="left"]').click(); // NEW
    assert.equal(panel.querySelector('[data-side="left"]').getAttribute('aria-pressed'), 'true'); // NEW
    h.w.document.querySelector('[data-cell-id="a"]').click(); await h.tick(); assert.equal(h.input(a), undefined); assert.ok(h.input(b)); // NEW
    h.graph.clearSelection(); await h.tick(); assert.equal(h.w.document.querySelectorAll('.trellis-object-details').length, 0); // NEW
    assert.equal(h.w.document.querySelectorAll('.trellis-object-details-badge').length, 2); // NEW
    h.graph.setSelectionCell(a); await h.tick(); assert.equal(h.input(a), undefined, 'the hidden preference survives re-selection'); // NEW
    h.w.document.querySelector('[data-cell-id="a"]').click(); await h.tick(); assert.ok(h.input(a)); // NEW
    assert.equal(h.input(a).closest('section').querySelector('[aria-pressed="true"]').dataset.side, 'left'); // NEW
}); // NEW

test('interacting fields change visual and export stacking without moving their DOM nodes', async t => { // NEW
    const h = harness(t), a = h.vertex('a', '<p>A</p>'), b = h.vertex('b', '<p>B</p>'); // NEW
    h.graph.setSelectionCells([a, b]); await h.tick(); // NEW
    const field = h.input(a), panel = field.closest('section'), sibling = panel.nextSibling; field.focus(); // NEW
    panel.dispatchEvent(new h.w.Event('pointerdown', { bubbles: true })); // NEW
    assert.equal(h.w.document.activeElement, field); assert.equal(panel.nextSibling, sibling, 'pointer handling must not reparent the focused editor'); // NEW
    assert.ok(Number(panel.style.zIndex) > Number(h.input(b).closest('section').style.zIndex)); // NEW
    assert.ok(Number(panel.style.zIndex) < Number(h.w.document.querySelector('.trellis-object-details-badge').style.zIndex)); // NEW
    assert.deepEqual(Array.from(h.controller.exportProjection()['page-a'].filter(record => !record.badge), record => record.ownerId), ['b', 'a']); // NEW
}); // NEW

test('local preferences isolate users, pages, diagrams and copied cell IDs without modifying XML', async t => { // NEW
    const h = harness(t), cell = h.vertex('shape', '<p>Details</p>'); h.graph.setSelectionCell(cell); await h.tick(); // NEW
    const before = h.ui.getFileData(); h.input(cell).closest('section').querySelector('[data-side="right"]').click(); // NEW
    h.w.document.querySelector('.trellis-object-details-badge').click(); await h.tick(); assert.equal(h.ui.getFileData(), before); // NEW
    h.policy.currentUser = 'user-b'; h.w.dispatchEvent(new h.w.Event('trellisUsersSessionChanged')); await h.tick(); // NEW
    assert.ok(h.input(cell)); assert.equal(h.input(cell).closest('section').querySelector('[aria-pressed="true"]').dataset.side, 'below'); // NEW
    h.policy.currentUser = 'user-a'; h.w.dispatchEvent(new h.w.Event('trellisUsersSessionChanged')); await h.tick(); assert.equal(h.input(cell), undefined); // NEW
    h.ui.currentPage = { getId: () => 'page-b' }; h.controller.refresh(); await h.tick(); assert.ok(h.input(cell)); // NEW
    h.policy.diagram = 'diagram-b'; h.controller.refresh(); assert.equal(h.input(cell).closest('section').querySelector('[aria-pressed="true"]').dataset.side, 'below'); // NEW
    const duplicate = h.graph.cloneCells([cell])[0]; h.graph.addCell(duplicate); h.graph.setSelectionCell(duplicate); await h.tick(); // NEW
    assert.equal(duplicate.getAttribute('trellis_details_html'), '<p>Details</p>'); assert.ok(h.input(duplicate)); // NEW
}); // NEW

test('composition delays saving and clearing removes only the details attribute and badge', async t => { // NEW
    const h = harness(t), cell = h.vertex('shape', '<b>Original</b>'); h.controller.open(cell); // NEW
    const input = h.input(cell); input.dispatchEvent(new h.w.CompositionEvent('compositionstart')); h.type(cell, '途中'); // NEW
    assert.equal(h.controller.flush(), false); assert.equal(cell.getAttribute('trellis_details_html'), '<b>Original</b>'); // NEW
    input.dispatchEvent(new h.w.CompositionEvent('compositionend')); assert.equal(h.controller.flush(), true); assert.equal(cell.getAttribute('trellis_details_html'), '途中'); // NEW
    h.type(cell, '<div><b><br></b>&nbsp;</div>'); h.controller.flush(); input.blur(); h.graph.clearSelection(); await h.tick(); // NEW
    assert.equal(cell.value.getAttribute('trellis_details_html'), null); assert.equal(cell.getAttribute('label'), 'Label shape'); assert.equal(h.w.document.querySelectorAll('.trellis-object-details-badge').length, 0); // NEW
}); // NEW

test('permission loss and removed objects retain drafts and prevent stale writes', async t => { // NEW
    const h = harness(t), cell = h.vertex('shape', '<p>Original</p>'); h.controller.open(cell); h.type(cell, '<p>Retain my draft</p>'); // NEW
    h.policy.editable = false; assert.equal(h.controller.flush(), false); h.graph.clearSelection(); await h.tick(); // NEW
    assert.match(h.input(cell).textContent, /Retain my draft/); assert.match(h.input(cell).closest('section').textContent, /Your text is retained/); // NEW
    assert.equal(cell.getAttribute('trellis_details_html'), '<p>Original</p>'); assert.throws(() => h.controller.exportProjection(), /unsaved/); // NEW
    h.policy.editable = true; h.graph.removeCells([cell]); await h.tick(); assert.match(h.input(cell).textContent, /Retain my draft/); // NEW
    assert.equal(h.controller.flush(), false); // NEW
}); // NEW

test('context menus target the clicked object and generated planting visuals resolve to their stable parent', async t => { // NEW
    const h = harness(t), group = h.vertex('planting', null, { tiler_group: '1' }), circle = h.vertex('circle', null, { plant_tiler: '1', auto: '1' }), other = h.vertex('other', '<p>Other</p>'); // NEW
    h.graph.addCell(circle, group); h.graph.setSelectionCell(other); // NEW
    const items = [], menu = { addItem(label, icon, action) { items.push({ label, action }); }, addSeparator() {} }; // NEW
    h.graph.popupMenuHandler.factoryMethod(menu, circle, null); // NEW
    const item = items.find(item => item.label.includes('details')); assert.match(item.label, /planting group/); item.action(); // NEW
    assert.ok(h.graph.isCellSelected(other)); assert.ok(h.input(group)); assert.equal(h.input(circle), undefined); // NEW
    const edge = h.graph.insertEdge(null, 'edge', '', group, other); assert.equal(h.core.detailsOwner(edge, h.graph.model), edge); // CHANGE
}); // NEW

test('specialized vertices and pipe edges share one details command and retain independent metadata through history', async t => { // CHANGE
    const h = harness(t), garden = h.vertex('garden', null, { garden_module: '1' }), bed = h.vertex('bed', null, { garden_bed: '1' }), task = h.vertex('task', null, { kanban_card: '1' }); // CHANGE
    h.graph.addCell(bed, garden); const board = h.vertex('board', null, { board_key: 'KANBAN_BOARD' }), group = h.vertex('group', null, { tiler_group: '1' }), module = h.vertex('module'); // CHANGE
    h.graph.model.setStyle(module, 'module=1;'); h.graph.model.setStyle(group, 'group;'); // CHANGE
    const value = h.w.mxUtils.createXmlDocument().createElement('object'); value.setAttribute('irrigation_pipe_edge', '1'); value.setAttribute('irrigation_generated', '1'); value.setAttribute('irrigation_path_id', 'path-1'); // CHANGE
    const pipe = h.graph.insertEdge(null, 'pipe', value, bed, task), connector = h.graph.insertEdge(null, 'connector', '', task, board); // CHANGE
    h.w.TrellisContextMenu.install(h.ui); h.w.TrellisContextMenu.install(h.ui); // CHANGE
    for (const cell of [garden, bed, task, board, group, module, pipe, connector]) { // CHANGE
        h.graph.clearSelection(); const items = [], menu = { addSeparator() {}, addItem(label, icon, action) { items.push({ label, action }); } }; // CHANGE
        h.graph.popupMenuHandler.factoryMethod(menu, cell, null); const commands = items.filter(item => /details…/.test(item.label)); assert.equal(commands.length, 1, cell.id); commands[0].action(); // CHANGE
        assert.ok(h.input(cell), cell.id); h.type(cell, '<p>Info for ' + cell.id + '</p>'); assert.equal(h.controller.flush(), true); // CHANGE
        assert.equal(cell.getAttribute('trellis_details_html'), '<p>Info for ' + cell.id + '</p>'); // CHANGE
    } // CHANGE
    assert.equal(pipe.getAttribute('irrigation_path_id'), 'path-1'); h.undo.undo(); await h.tick(); assert.ok(!connector.getAttribute('trellis_details_html')); // CHANGE
    h.undo.redo(); await h.tick(); assert.equal(connector.getAttribute('trellis_details_html'), '<p>Info for connector</p>'); // CHANGE
    h.graph.moveCells([task], 50, 30); assert.equal(task.getAttribute('trellis_details_html'), '<p>Info for task</p>'); // CHANGE
    const replacement = h.graph.insertEdge(null, 'replacement', '', bed, task); assert.ok(!replacement.getAttribute('trellis_details_html')); // CHANGE
    for (const cell of [h.graph.model.getRoot(), h.graph.getDefaultParent()]) { // CHANGE
        assert.equal(h.core.detailsOwner(cell, h.graph.model), null); const labels = []; h.graph.popupMenuHandler.factoryMethod({ addSeparator() {}, addItem(label) { labels.push(label); } }, cell, null); assert.equal(labels.some(label => /details…/.test(label)), false); // CHANGE
    } // CHANGE
}); // CHANGE

test('edge details follow route distance and view transforms, retain unanchored drafts and export at their own anchor', async t => { // CHANGE
    const h = harness(t), a = h.vertex('a'), b = h.vertex('b'), edge = h.graph.insertEdge(null, 'edge', '', a, b); // CHANGE
    const route = [new h.w.mxPoint(100, 100), new h.w.mxPoint(300, 100), new h.w.mxPoint(300, 200)]; // CHANGE
    h.controller.open(edge); h.type(edge, '<p>Pipe annotation</p>'); h.controller.flush(); const state = h.graph.view.getState(edge); state.absolutePoints = route; h.controller.refresh(); // CHANGE
    const field = h.input(edge), node = field.closest('section'), badge = h.w.document.querySelector('[data-cell-id="edge"]'); // CHANGE
    assert.equal(badge.style.left, '240px'); assert.equal(badge.style.top, '76px'); assert.equal(node.style.left, '90px'); assert.equal(node.style.top, '108px'); // CHANGE
    h.graph.panDx = 30; h.graph.panDy = 20; h.controller.refresh(); assert.equal(badge.style.left, '270px'); assert.equal(badge.style.top, '96px'); // CHANGE
    h.graph.useCssTransforms = true; h.graph.view.scale = 2; h.graph.view.translate = new h.w.mxPoint(10, 15); h.controller.refresh(); // CHANGE
    assert.equal(badge.style.left, '540px'); assert.equal(badge.style.top, '226px'); assert.equal(node.style.left, '390px'); assert.equal(node.style.top, '258px'); // CHANGE
    state.absolutePoints = [new h.w.mxPoint(50, 60), new h.w.mxPoint(50, 60)]; h.controller.refresh(); assert.equal(badge.style.left, '140px'); // CHANGE
    const projection = h.controller.exportProjection()['page-a'].filter(item => item.ownerId === edge.id); // CHANGE
    assert.equal(projection.length, 2); assert.equal(projection.find(item => item.badge).geometry.x, 45.5); // CHANGE
    h.type(edge, '<p>Retained while invisible</p>'); state.absolutePoints = [null, { x: NaN, y: 1 }]; h.controller.refresh(); // CHANGE
    assert.equal(node.hidden, true); assert.equal(h.w.document.querySelector('[data-cell-id="edge"]'), null); assert.match(field.innerHTML, /Retained while invisible/); // CHANGE
    state.absolutePoints = route; h.controller.refresh(); assert.equal(node.hidden, false); assert.equal(h.input(edge), field); assert.equal(h.controller.flush(), true); // CHANGE
    assert.match(edge.getAttribute('trellis_details_html'), /Retained while invisible/); // CHANGE
    const xml = h.w.mxUtils.parseXml(h.ui.getFileData()), restored = new h.w.mxGraphModel(); new h.w.mxCodec(xml).decode(xml.documentElement, restored); // CHANGE
    assert.equal(restored.getCell(edge.id).getAttribute('trellis_details_html'), edge.getAttribute('trellis_details_html')); // CHANGE
}); // CHANGE

test('route anchors support loops, dangling routes and zero-length edges without creating invalid positions', t => { // CHANGE
    const h = harness(t), anchor = points => { const bounds = h.core.edgeBounds(points); return bounds && [bounds.x, bounds.y, bounds.width, bounds.height]; }; // CHANGE
    assert.deepEqual(anchor([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 }]), [100, 100, 0, 0]); // CHANGE
    assert.deepEqual(anchor([null, { x: 12, y: 34 }]), [12, 34, 0, 0]); assert.deepEqual(anchor([{ x: 12, y: 34 }, { x: 12, y: 34 }]), [12, 34, 0, 0]); // CHANGE
    for (const route of [null, [], [null], [{ x: Infinity, y: 10 }]]) assert.equal(anchor(route), null); // CHANGE
}); // CHANGE

test('text-only HTML sanitization rejects executable markup and media while preserving rich formatting', t => { // NEW
    const { core } = harness(t); // NEW
    const html = core.normalizeHtml('<p onclick="alert(1)" style="color:red;position:fixed;background-image:url(https://invalid.test/x)"><b>Keep</b><img src=x onerror=alert(1)><a href="javascript:alert(1)">link</a></p><table><tr><td>Text</td></tr></table><script>alert(2)</script>'); // NEW
    assert.match(html, /<b>Keep<\/b>/); assert.match(html, /color:\s*red/); assert.match(html, /Text/); // NEW
    assert.doesNotMatch(html, /onclick|onerror|javascript:|<script|<img|<table|position:|background-image/); // NEW
    assert.equal(core.normalizeHtml('<p><br></p>'), ''); // NEW
    const link = core.normalizeHtml('<h2 style=""><a style="color:red" href="https://example.test/">Stable link</a></h2>'); // NEW
    assert.equal(core.normalizeHtml(link), link, 'sanitizer serialization must remain stable across write and read'); // NEW
}); // NEW

test('export projections expand text, preserve canonical XML and filter absent owners', async t => { // NEW
    const h = harness(t), cell = h.vertex('shape', '<h2>Title</h2><ul><li>First</li><li>Last</li></ul>'); h.graph.setSelectionCell(cell); await h.tick(); // NEW
    const before = h.ui.getFileData(), projection = h.controller.exportProjection(), records = projection['page-a']; // NEW
    assert.equal(records.length, 2); assert.match(records.find(record => !record.badge).html, /Last/); // NEW
    const exportGraph = h.controller.createExportGraph(); try { // NEW
        assert.equal(Object.values(exportGraph.model.cells).filter(cell => cell.__trellisDetailsOwner).length, 2); // NEW
        assert.equal(h.ui.getFileData(), before); // NEW
    } finally { exportGraph.__trellisDetailsCleanup(); } // NEW
    const emptyGraph = new h.w.Graph(h.w.document.createElement('div')); h.core.applyProjection(emptyGraph, projection, 'page-a'); // NEW
    assert.equal(Object.values(emptyGraph.model.cells).filter(cell => cell.__trellisDetailsOwner).length, 0); emptyGraph.destroy(); // NEW
}); // NEW

test('canvas badge enlargement preserves the original export geometry and appearance at each zoom mode', async t => { // CHANGE
    const h = harness(t), cell = h.vertex('shape', '<p>Info</p>'); // CHANGE
    for (const useCssTransforms of [false, true]) for (const scale of [1, 1.5]) { // CHANGE
        h.graph.useCssTransforms = useCssTransforms; h.graph.view.scaleAndTranslate(scale, 12, 18); h.graph.view.revalidate(); h.controller.refresh(); // CHANGE
        const badge = h.w.document.querySelector('[data-cell-id="shape"]'), projection = h.controller.exportProjection(), record = projection['page-a'].find(item => item.badge), state = h.graph.view.getState(cell); // CHANGE
        const x = useCssTransforms ? (state.x + 12) * scale : state.x, y = useCssTransforms ? (state.y + 18) * scale : state.y, width = useCssTransforms ? state.width * scale : state.width; // CHANGE
        assert.equal(badge.style.width, '20px'); assert.equal(parseFloat(badge.style.left), x + Math.max(4, width - 24)); // CHANGE
        assert.equal(record.geometry.x, (x + Math.max(4, width - 22)) / scale - 12); assert.equal(record.geometry.y, (y + 4) / scale - 18); // CHANGE
        assert.equal(record.geometry.width, 18 / scale); assert.equal(record.geometry.height, 18 / scale); assert.equal(record.fontSize, 14 / scale); // CHANGE
        const exported = h.controller.createExportGraph(projection); // CHANGE
        try { // CHANGE
            const exportedBadge = Object.values(exported.model.cells).find(item => item.__trellisDetailsOwner?.id === cell.id && item.value === '&#9432;'); // CHANGE
            assert.ok(exportedBadge); assert.match(exportedBadge.style, /fillColor=#eff6ff;strokeColor=#2563eb;fontColor=#2563eb;/); assert.doesNotMatch(exportedBadge.style, /#1e40af|#facc15/); // CHANGE
        } finally { exported.__trellisDetailsCleanup(); } // CHANGE
    } // CHANGE
}); // CHANGE

test('local storage failure falls back to session preferences and Save flushes the focused field', async t => { // NEW
    const h = harness(t), cell = h.vertex('shape', '<p>Before</p>'); // NEW
    h.w.Storage.prototype.setItem = () => { throw new Error('Storage unavailable'); }; // NEW
    h.controller.open(cell); h.input(cell).closest('section').querySelector('[data-side="above"]').click(); // NEW
    h.type(cell, '<p>Saved through shortcut</p>'); let saves = 0; h.ui.actions.get = name => name === 'save' ? { funct() { saves++; assert.equal(cell.getAttribute('trellis_details_html'), '<p>Saved through shortcut</p>'); } } : null; // NEW
    h.input(cell).dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })); assert.equal(saves, 1); // NEW
    h.graph.clearSelection(); await h.tick(); h.graph.setSelectionCell(cell); await h.tick(); // NEW
    assert.equal(h.input(cell).closest('section').querySelector('[aria-pressed="true"]').dataset.side, 'above'); // NEW
}); // NEW

test('remote rollback preserves rejected text and another user cannot see its retained draft', async t => { // NEW
    const h = harness(t), cell = h.vertex('shape', '<p>Original</p>'); h.controller.open(cell); h.type(cell, '<p>My unsaved text</p>'); // NEW
    const replacement = cell.value.cloneNode(true); replacement.setAttribute('trellis_details_html', '<p>Collaborator text</p>'); // NEW
    h.graph.__trellisSharingApplying = true; h.graph.model.setValue(cell, replacement); h.graph.__trellisSharingApplying = false; await h.tick(); // NEW
    assert.match(h.input(cell).textContent, /My unsaved text/); assert.match(h.input(cell).closest('section').textContent, /rejected or replaced/); // NEW
    h.policy.currentUser = 'user-b'; h.w.dispatchEvent(new h.w.Event('trellisUsersSessionChanged')); await h.tick(); // NEW
    assert.match(h.input(cell).textContent, /Collaborator text/); assert.equal([...h.w.document.querySelectorAll('.trellis-object-details')].filter(node => node.style.display !== 'none').length, 1); // NEW
    h.policy.currentUser = 'user-a'; h.w.dispatchEvent(new h.w.Event('trellisUsersSessionChanged')); await h.tick(); // NEW
    assert.match(h.input(cell).textContent, /My unsaved text/); assert.equal(h.controller.flush(), false); // NEW
    assert.match(h.ui.getFileData(), /Collaborator text/); assert.equal(cell.getAttribute('trellis_details_html'), '<p>Collaborator text</p>', 'internal serialization cannot replay a rejected edit'); // NEW
    h.input(cell).closest('section').querySelector('[aria-label="Retry saving details"]').click(); assert.equal(cell.getAttribute('trellis_details_html'), '<p>My unsaved text</p>'); // NEW
}); // NEW

test('export-only annotations inherit owner layers and keep all four placement directions', async t => { // NEW
    const h = harness(t), cell = h.vertex('shape', '<p>Details</p>'); // NEW
    const layer = new h.w.mxCell(); layer.setId('second-layer'); h.graph.model.add(h.graph.model.getRoot(), layer); h.graph.model.add(layer, cell); // NEW
    h.controller.open(cell); const panel = h.input(cell).closest('section'); // NEW
    for (const side of ['above', 'below', 'left', 'right']) { // NEW
        panel.querySelector('[data-side="' + side + '"]').click(); // NEW
        const bounds = { x: parseFloat(panel.style.left), y: parseFloat(panel.style.top), width: 320, height: 180 }, owner = h.graph.view.getState(cell); // NEW
        assert.equal(side === 'above' ? bounds.y + bounds.height < owner.y : side === 'below' ? bounds.y > owner.y + owner.height : side === 'left' ? bounds.x + bounds.width < owner.x : bounds.x > owner.x + owner.width, true); // NEW
    } // NEW
    const temporary = h.controller.createExportGraph(); // NEW
    try { // NEW
        const annotations = Object.values(temporary.model.cells).filter(cell => cell.__trellisDetailsOwner); assert.equal(annotations.length, 2); // NEW
        assert.ok(annotations.every(cell => temporary.model.getParent(cell).id === 'second-layer')); // NEW
        temporary.model.setVisible(temporary.model.getCell('second-layer'), false); assert.ok(annotations.every(cell => !temporary.view.getState(cell))); // NEW
    } finally { temporary.__trellisDetailsCleanup(); } // NEW
}); // NEW

test('a diagram without stable identity keeps personal preferences in memory without adding metadata', async t => { // NEW
    const h = harness(t); h.policy.diagram = ''; let creates = 0; h.policy.getDiagramKey = options => { if (options.create) creates++; return ''; }; // NEW
    const cell = h.vertex('shape', '<p>Before</p>'); h.controller.open(cell); h.input(cell).closest('section').querySelector('[data-side="left"]').click(); // NEW
    h.type(cell, '<p>After</p>'); assert.equal(h.controller.flush(), true); // NEW
    assert.equal(creates, 0); assert.equal(h.w.localStorage.length, 0); // NEW
    h.graph.clearSelection(); await h.tick(); h.graph.setSelectionCell(cell); await h.tick(); // NEW
    assert.equal(h.input(cell).closest('section').querySelector('[aria-pressed="true"]').dataset.side, 'left'); // NEW
}); // NEW
