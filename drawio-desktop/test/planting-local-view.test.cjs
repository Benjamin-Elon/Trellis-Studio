/** Native model regressions for personal planting detail, persistence, and export projection. */ // NEW
const test = require('node:test'); // NEW
const assert = require('node:assert/strict'); // NEW
const { loadPlantTilerMxGraph } = require('./helpers/plant-tiler-mxgraph-harness.cjs'); // NEW

function fixture(t) { // NEW
    const h = loadPlantTilerMxGraph(), { graph, ui, window: w } = h; // NEW
    t.after(h.close); // NEW
    let user = 'alice', page = 'page-a', path = 'C:/garden.drawio'; // NEW
    ui.getCurrentFile = () => ({ fileObject: { path }, isEditable: () => false }); // NEW
    ui.currentPage = { getId: () => page }; // NEW
    graph.__trellisUsers = { getCurrentUser: () => ({ id: user }) }; // NEW
    const value = attrs => { const node = w.mxUtils.createXmlDocument().createElement('object'); Object.entries(attrs).forEach(([key, entry]) => node.setAttribute(key, String(entry))); return node; }; // NEW
    const group = (id = 'crop', width = 180, height = 130, attrs = {}) => { // NEW
        graph.model.beginUpdate(); // NEW
        try { // NEW
            const cell = graph.insertVertex(h.moduleCell, id, value({ tiler_group: '1', plant_abbr: 'RAD', plant_name: 'Radish', spacing_cm: '30', bed_auto_fit: '0', ...attrs }), 100, 100, width, height, 'verticalAlign=top;rotation=30;'); // NEW
            h.tiler.retileGroup(graph, cell); return cell; // NEW
        } finally { graph.model.endUpdate(); } // NEW
    }; // NEW
    const attrs = (cell, values) => { const next = cell.value.cloneNode(true); Object.entries(values).forEach(([key, entry]) => next.setAttribute(key, String(entry))); graph.model.setValue(cell, next); }; // NEW
    const xml = () => w.mxUtils.getXml(ui.getXmlFileData()); // NEW
    const circles = cell => graph.getChildVertices(cell).filter(child => child.getAttribute('plant_tiler') === '1'); // NEW
    const folded = cell => cell.getAttribute('lod_collapsed') === '1'; // NEW
    const context = values => { user = values.user ?? user; page = values.page ?? page; path = values.path ?? path; graph.__trellisLocalView.apply(() => {}); }; // NEW
    return { ...h, w, group, attrs, xml, circles, folded, context }; // NEW
} // NEW

test('local folds preserve save XML, actual child identities, dirty notifications and existing Undo/Redo', t => { // NEW
    const h = fixture(t), group = h.group(), children = h.circles(group).slice(); // NEW
    h.undoManager.clear(); h.attrs(h.moduleCell, { label: 'Edited garden' }); // NEW
    const baseline = h.xml(); let changes = 0; // NEW
    h.graph.model.addListener(h.w.mxEvent.CHANGE, () => changes++); // NEW
    assert.equal(h.tiler.setPlantingGroupDetail(group, false).ok, true); // NEW
    assert.equal(h.folded(group), true); assert.equal(h.xml(), baseline); assert.equal(changes, 0); assert.equal(h.undoManager.history.length, 1); // NEW
    assert.equal(h.graph.view.states.getValues().some(state => !h.graph.model.contains(state.cell)), false); // NEW: replaced circles must not leave painted SVG behind.
    h.undoManager.undo(); assert.equal(h.moduleCell.getAttribute('label'), 'Garden'); assert.equal(h.folded(group), true); // NEW
    h.undoManager.redo(); assert.equal(h.xml(), baseline); assert.equal(h.folded(group), true); // NEW
    assert.equal(h.tiler.setPlantingGroupDetail(group, true).ok, true); // NEW
    assert.deepEqual(h.circles(group), children); assert.equal(h.xml(), baseline); // NEW
    assert.equal(h.graph.view.states.getValues().some(state => !h.graph.model.contains(state.cell)), false); // NEW: expanded detail must remove the old summary's DOM.
}); // NEW

test('XML cloned before beginUpdate cannot carry personal folding into an authored value change', t => { // NEW
    const h = fixture(t), group = h.group(); h.tiler.setPlantingGroupDetail(group, false); // NEW
    const value = group.value.cloneNode(true); value.setAttribute('notes', 'Prepared before transaction'); h.undoManager.clear(); // NEW
    h.graph.model.beginUpdate(); // NEW
    try { h.graph.model.setValue(group, value); } finally { h.graph.model.endUpdate(); } // NEW
    const saved = h.w.mxUtils.parseXml(h.xml()).querySelector('object[id="crop"]'); // NEW
    assert.equal(saved.getAttribute('notes'), 'Prepared before transaction'); assert.equal(saved.getAttribute('lod_collapsed'), '0'); assert.equal(saved.getAttribute('lod_layout_snapshot_at'), null); // NEW
    assert.equal(h.folded(group), true); assert.equal(h.undoManager.history.length, 1); // NEW
    h.undoManager.undo(); assert.equal(group.getAttribute('notes'), undefined); assert.equal(h.folded(group), true); // NEW
}); // NEW

test('a local toggle inside an authored transaction retains only the real edit in Undo', t => { // NEW
    const h = fixture(t), group = h.group(); h.undoManager.clear(); // NEW
    h.graph.model.beginUpdate(); // NEW
    try { h.attrs(h.moduleCell, { notes: 'Keep this edit' }); assert.equal(h.tiler.setPlantingGroupDetail(group, false).ok, true); } finally { h.graph.model.endUpdate(); } // NEW
    assert.equal(h.folded(group), true); assert.equal(h.undoManager.history.length, 1); // NEW
    h.undoManager.undo(); assert.equal(h.moduleCell.getAttribute('notes'), undefined); assert.equal(h.folded(group), true); // NEW
}); // NEW

test('folded edits update authored data without copying local attributes into a later save', t => { // NEW
    const h = fixture(t), group = h.group(); // NEW
    h.tiler.setPlantingGroupDetail(group, false); h.undoManager.clear(); // NEW
    h.attrs(group, { notes: 'An authored note' }); // NEW
    assert.equal(h.folded(group), true); assert.equal(group.getAttribute('notes'), 'An authored note'); // NEW
    const saved = h.w.mxUtils.parseXml(h.xml()).querySelector('object[id="crop"]'); // NEW
    assert.equal(saved.getAttribute('notes'), 'An authored note'); assert.equal(saved.getAttribute('lod_collapsed'), '0'); assert.equal(saved.getAttribute('plant_circle_detail_mode'), null); // NEW
    assert.equal(h.undoManager.history.length, 1); h.undoManager.undo(); assert.equal(group.getAttribute('notes'), undefined); assert.equal(h.folded(group), true); // NEW
    const geometry = group.geometry.clone(); geometry.x += 30; h.graph.resizeCells([group], [geometry]); // NEW
    assert.equal(group.geometry.x, geometry.x); assert.equal(h.folded(group), true); // NEW
    const persisted = h.w.mxUtils.parseXml(h.xml()).querySelector('object[id="crop"] mxGeometry'); // NEW
    assert.equal(Number(persisted.getAttribute('x')), geometry.x); // NEW
}); // NEW

test('local preferences restore across reopen and isolate users, pages, and diagrams', t => { // NEW
    const h = fixture(t), group = h.group(); // NEW
    const saved = h.xml(); h.tiler.setPlantingGroupDetail(group, false); // NEW
    assert.equal(h.w.localStorage.length, 1); // NEW
    h.context({ user: 'bob' }); assert.equal(h.folded(group), false); // NEW
    h.context({ user: 'alice' }); assert.equal(h.folded(group), true); // NEW
    h.context({ page: 'page-b' }); assert.equal(h.folded(group), false); // NEW
    h.context({ page: 'page-a', path: 'C:/other.drawio' }); assert.equal(h.folded(group), false); // NEW
    h.context({ path: 'C:/garden.drawio' }); assert.equal(h.folded(group), true); // NEW
    h.graph.__trellisLocalView.apply(() => { const doc = h.w.mxUtils.parseXml(saved); new h.w.mxCodec(doc).decode(doc.documentElement, h.graph.model); }); // NEW
    assert.equal(h.folded(h.graph.model.getCell('crop')), true); // CHANGE
    const before = new h.w.mxGraphModel(), after = new h.w.mxGraphModel(); // NEW
    for (const [xml, model] of [[saved, before], [h.xml(), after]]) { const doc = h.w.mxUtils.parseXml(xml); new h.w.mxCodec(doc).decode(doc.documentElement, model); } // NEW
    assert.equal(h.w.mxUtils.getXml(new h.w.mxCodec().encode(after)), h.w.mxUtils.getXml(new h.w.mxCodec().encode(before))); // NEW: native decode may reorder XML attributes.
}); // NEW

test('saved summaries expand locally, export current detail, and retain canonical embedded source', t => { // NEW
    const h = fixture(t), group = h.group('crop', 180, 130, { plant_circle_detail_mode: 'collapsed' }); // NEW
    const baseline = h.xml(); h.undoManager.clear(); // NEW
    assert.equal(h.folded(group), true); assert.equal(h.tiler.setPlantingGroupDetail(group, true).ok, true); assert.ok(h.circles(group).length); // NEW
    assert.equal(h.xml(), baseline); assert.equal(h.undoManager.canUndo(), false); // NEW
    const projection = h.graph.getExportVariables().__trellisPlantingProjection; // NEW
    const exported = new h.w.mxGraph(h.w.document.createElement('div')); // CHANGE: destroy before fixture cleanup closes its window.
    exported.isSpecialColor = () => false; // NEW: production Graph supplies this renderer hook.
    const doc = h.w.mxUtils.parseXml(baseline); new h.w.mxCodec(doc).decode(doc.documentElement, exported.model); // NEW
    h.w.TrellisLocalView.applyPlantingProjection(exported, projection, 'page-a'); // NEW
    assert.equal(h.folded(exported.model.getCell('crop')), false); // NEW
    assert.ok(exported.getChildVertices(exported.model.getCell('crop')).some(child => child.getAttribute('plant_tiler') === '1')); // NEW
    assert.equal(h.xml(), baseline); assert.equal(h.folded(group), false); // NEW
    exported.destroy(); // NEW
}); // NEW

test('editing a circle in a personal expansion persists its manual position through Undo and refolding', t => { // NEW
    const h = fixture(t), group = h.group('crop', 180, 130, { plant_circle_detail_mode: 'collapsed' }); // NEW
    h.tiler.setPlantingGroupDetail(group, true); // NEW
    const tile = h.circles(group)[0], row = tile.getAttribute('tile_r'), col = tile.getAttribute('tile_c'), geometry = tile.geometry.clone(); // NEW
    geometry.x += 3; geometry.y += 2; h.undoManager.clear(); // NEW
    h.graph.model.beginUpdate(); // NEW
    try { h.attrs(tile, { auto: '0', dirty: '1' }); h.graph.model.setGeometry(tile, geometry); } finally { h.graph.model.endUpdate(); } // NEW
    const moved = () => h.circles(group).find(child => child.getAttribute('tile_r') === row && child.getAttribute('tile_c') === col); // NEW
    assert.ok(Math.abs(moved().geometry.x - geometry.x) < 1e-6); assert.equal(h.undoManager.history.length, 1); // NEW
    h.tiler.setPlantingGroupDetail(group, false); h.tiler.setPlantingGroupDetail(group, true); // NEW
    assert.ok(Math.abs(moved().geometry.x - geometry.x) < 1e-6); // NEW
    h.undoManager.undo(); assert.ok(Math.abs(moved().geometry.x - geometry.x) > 1); // NEW
    h.undoManager.redo(); assert.ok(Math.abs(moved().geometry.x - geometry.x) < 1e-6); // NEW
}); // NEW

test('incoming edits and deletion cannot restore stale authored cells', t => { // NEW
    const h = fixture(t), group = h.group(); h.tiler.setPlantingGroupDetail(group, false); h.undoManager.clear(); // NEW
    h.graph.__trellisLocalView.apply(() => { h.attrs(group, { spacing_cm: '45' }); h.tiler.retileGroup(h.graph, group); }); // NEW
    assert.equal(h.folded(group), true); assert.equal(group.getAttribute('spacing_cm'), '45'); // NEW
    h.graph.removeCells([group]); assert.equal(h.graph.model.getCell(group.id), undefined); assert.ok(!h.xml().includes('id="crop"')); // NEW
    h.undoManager.undo(); assert.equal(h.folded(h.graph.model.getCell(group.id)), true); // NEW
}); // NEW

test('personal expansion retains child identity and selection across unrelated edits', t => { // NEW
    const h = fixture(t), group = h.group('crop', 180, 130, { plant_circle_detail_mode: 'collapsed' }); // NEW
    h.tiler.setPlantingGroupDetail(group, true); // NEW
    const tile = h.circles(group)[0]; h.graph.setSelectionCell(tile); // NEW
    h.attrs(h.moduleCell, { notes: 'Unrelated garden edit' }); // NEW
    assert.ok(h.circles(group).includes(tile)); assert.equal(h.graph.getSelectionCell(), tile); assert.equal(h.graph.model.getCell(tile.id), tile); // NEW
}); // NEW

test('storage corruption and write failures leave local folding usable for the session', t => { // NEW
    const h = fixture(t), group = h.group(); // NEW
    h.w.localStorage.setItem('trellis.local-planting-folds.v1:' + JSON.stringify(['C:/garden.drawio', 'corrupt']), JSON.stringify({ broken: false, '[1,2]': true, '["page-a","crop"]': 'false' })); // NEW
    h.context({ user: 'corrupt' }); assert.equal(h.folded(group), false); // NEW
    Object.defineProperty(h.w, 'localStorage', { configurable: true, get() { throw new Error('storage unavailable'); } }); // NEW
    h.context({ user: 'without-storage' }); // NEW
    const baseline = h.xml(); h.undoManager.clear(); // NEW
    assert.equal(h.tiler.setPlantingGroupDetail(group, false).ok, true); assert.equal(h.folded(group), true); // NEW
    h.graph.__trellisLocalView.restore(); assert.equal(h.folded(group), true); assert.equal(h.xml(), baseline); assert.equal(h.undoManager.canUndo(), false); // NEW
    assert.equal(h.tiler.setPlantingGroupDetail(group, true).ok, true); assert.equal(h.folded(group), false); // NEW
}); // NEW

test('remembered expansion observes changing budgets and does not displace existing detail', t => { // NEW
    const h = fixture(t), group = h.group('crop', 180, 130, { plant_circle_detail_mode: 'collapsed' }); // NEW
    assert.equal(h.tiler.setPlantingGroupDetail(group, true).ok, true); // NEW
    h.attrs(h.moduleCell, { plant_circle_max_per_planting: 0, plant_circle_max_total: 1000 }); assert.equal(h.folded(group), true); // NEW
    const before = h.xml(); h.undoManager.clear(); // NEW
    assert.equal(h.tiler.setPlantingGroupDetail(group, true).ok, false); assert.equal(h.xml(), before); assert.equal(h.undoManager.canUndo(), false); // NEW
    h.attrs(h.moduleCell, { plant_circle_max_per_planting: 200 }); assert.equal(h.folded(group), false); // NEW
    const other = h.group('other'); h.attrs(h.moduleCell, { plant_circle_max_total: h.circles(other).length }); // NEW
    assert.equal(h.folded(other), false); assert.equal(h.folded(group), true); // NEW
}); // NEW

test('new sibling and native duplicate inherit authored defaults without a personal preference', t => { // NEW
    const h = fixture(t), group = h.group(); h.tiler.setPlantingGroupDetail(group, false); // NEW
    const sibling = h.tiler.createSiblingTilerGroupFromSource(h.graph, group, { select: false }); h.tiler.retileGroup(h.graph, sibling); // NEW
    assert.equal(h.folded(sibling), false); assert.equal(sibling.getAttribute('lod_layout_snapshot_at'), undefined); // NEW
    const duplicate = h.graph.cloneCells([group])[0]; h.graph.addCell(duplicate, h.moduleCell); h.tiler.retileGroup(h.graph, duplicate); // NEW
    assert.equal(h.folded(duplicate), false); assert.equal(duplicate.getAttribute('lod_layout_snapshot_at'), undefined); assert.equal(h.folded(group), true); // NEW
}); // NEW

test('fixed-size controls follow opposite header corners through rotation, zoom, pan and drill-in', async t => { // NEW
    const h = fixture(t), group = h.group(), growth = h.graph.__trellisPlantingGroup.growth; // NEW
    h.graph.setSelectionCell(group); // NEW
    for (const angle of [0, 30, 90, 180, 270, -33]) for (const scale of [0.25, 1, 2]) { // NEW
        h.graph.setCellStyles('rotation', String(angle), [group]); h.graph.view.scaleAndTranslate(scale, 12, 23); h.graph.panGraph(20, 15); // NEW
        await new Promise(resolve => h.w.requestAnimationFrame(resolve)); growth.refresh(); h.graph.__trellisPlantingGroup.overlay.syncSelection(); // NEW
        const state = h.graph.view.getState(group), button = h.w.document.querySelector('.trellis-planting-detail-toggle'), badge = h.w.document.querySelector('[data-trellis-growth-badge="crop"]'); // NEW
        const center = { x: state.x + state.width / 2 + 20, y: state.y + state.height / 2 + 15 }, radians = -angle * Math.PI / 180; // NEW
        for (const [node, width, height, side] of [[button, 22, 20, 'left'], [badge, 30, 30, 'right']]) { // NEW
            assert.equal(parseFloat(node.style.width), width); assert.equal(parseFloat(node.style.height), height); assert.equal(node.style.transform, ''); // NEW
            const dx = parseFloat(node.style.left) + width / 2 - center.x, dy = parseFloat(node.style.top) + height / 2 - center.y; // NEW
            const localX = dx * Math.cos(radians) - dy * Math.sin(radians) + state.width / 2, localY = dx * Math.sin(radians) + dy * Math.cos(radians) + state.height / 2; // NEW
            assert.ok(Math.abs(localX - (side === 'left' ? width / 2 + 2 : state.width - width / 2 - 2)) < 1, `${side} at ${angle} and ${scale}`); // NEW
            assert.ok(localY >= height / 2 + 1 && localY < 30); // NEW
        } // NEW
    } // NEW
    h.graph.panGraph(0, 0); h.graph.view.setCurrentRoot(h.moduleCell); await new Promise(resolve => h.w.requestAnimationFrame(resolve)); // NEW
    assert.equal(h.w.document.querySelector('.trellis-planting-detail-toggle').style.display, 'block'); // NEW
}); // NEW
