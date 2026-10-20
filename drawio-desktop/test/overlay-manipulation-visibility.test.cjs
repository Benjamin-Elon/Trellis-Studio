const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const test = require('node:test'); // NEW
const { JSDOM } = require('jsdom'); // NEW
const webapp = path.resolve(__dirname, '../drawio/src/main/webapp'); // NEW
const plugins = path.join(webapp, 'plugins/garden_planner_plugins'); // NEW

/** Use production mxGraph handlers; manually drain animation frames to inspect the hidden interval. */ // NEW
function fixture(t, pluginNames = []) { // NEW
    const dom = new JSDOM('<!doctype html><body><div id="graph" style="position:relative"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true }); // NEW
    const w = dom.window, frames = new Map(); let sequence = 0; // NEW
    t.after(() => w.close()); // NEW
    w.requestAnimationFrame = callback => { frames.set(++sequence, callback); return sequence; }; // NEW
    w.cancelAnimationFrame = id => frames.delete(id); // NEW
    w.mxLoadResources = false; w.mxLoadStylesheets = false; w.HTMLCanvasElement.prototype.getContext = () => null; // NEW
    w.eval(fs.readFileSync(path.join(webapp, 'mxgraph/mxClient.js'), 'utf8')); // NEW
    const source = fs.readFileSync(path.join(plugins, 'Trellis_UI_Cleanup.js'), 'utf8'); // NEW
    w.eval(source.slice(0, source.indexOf('\nDraw.loadPlugin'))); // NEW
    const graph = new w.mxGraph(w.document.getElementById('graph')); // NEW
    graph.isSpecialColor = () => false; graph.getCompositeParent = cell => cell; // NEW
    const api = w.Trellis.ui.installOverlayVisibility(graph); // NEW
    const ui = { editor: { graph }, actions: { get: () => null, addAction: () => ({}) } }; // NEW
    w.Draw = { loadPlugin: callback => callback(ui) }; // NEW
    pluginNames.forEach(name => w.eval(fs.readFileSync(path.join(plugins, name), 'utf8'))); // NEW
    const cell = graph.insertVertex(null, 'a', 'A', 100, 100, 120, 80); // NEW
    const other = graph.insertVertex(null, 'b', 'B', 400, 100, 120, 80); graph.view.validate(); // NEW
    const panel = w.document.createElement('div'); panel.innerHTML = '<input value="saved">'; graph.container.appendChild(panel); api.mark(panel); // NEW
    const fixed = w.document.createElement('button'); graph.container.appendChild(fixed); // NEW
    function flush() { const pending = Array.from(frames.values()); frames.clear(); pending.forEach(callback => callback()); } // NEW
    function me(x, y, options = {}) { return new w.mxMouseEvent(new w.MouseEvent('mousemove', { clientX: x, clientY: y, ...options }), graph.view.getState(cell)); } // NEW
    function start(cells = [cell]) { graph.setSelectionCells(cells); graph.isMouseDown = true; graph.graphHandler.start(cell, 120, 120, cells); } // NEW
    return { w, graph, api, panel, fixed, cell, other, flush, me, start, display: node => w.getComputedStyle(node).display }; // NEW
} // NEW

test('suppression is graph-local, source-owned, and preserves drafts and owner visibility', t => { // NEW
    const f = fixture(t), { w, api, panel, fixed, flush, display } = f; // NEW
    const input = panel.firstChild; input.value = 'unsaved'; const a = {}, b = {}; // NEW
    const install = w.Trellis.ui.installOverlayVisibility, cleanup = fs.readFileSync(path.join(plugins, 'Trellis_UI_Cleanup.js'), 'utf8'); // NEW
    w.eval(cleanup.slice(0, cleanup.indexOf('\nDraw.loadPlugin'))); assert.equal(w.Trellis.ui.installOverlayVisibility, install); // NEW: plugin reload must retain graph ownership sequencing.
    const second = new w.mxGraph(w.document.body.appendChild(w.document.createElement('div'))); // NEW
    const secondApi = w.Trellis.ui.installOverlayVisibility(second), secondPanel = w.document.createElement('div'); // NEW
    assert.equal(w.Trellis.ui.installOverlayVisibility(second), secondApi); // NEW: repeated installation preserves one controller.
    w.document.body.appendChild(secondPanel); secondApi.mark(secondPanel); // NEW
    assert.notEqual(panel.getAttribute('data-trellis-overlay-owner'), secondPanel.getAttribute('data-trellis-overlay-owner')); // NEW
    const hidden = w.document.createElement('div'); hidden.style.display = 'none'; w.document.body.appendChild(hidden); api.mark(hidden); // NEW
    api.begin(a); api.begin(a); api.begin(b); // NEW
    assert.equal(display(panel), 'none'); assert.equal(display(fixed), 'inline-block'); assert.notEqual(display(secondPanel), 'none'); // NEW
    const late = w.document.createElement('div'); w.document.body.appendChild(late); api.mark(late); assert.equal(display(late), 'none'); // NEW
    api.end(a); flush(); assert.equal(display(panel), 'none'); // NEW
    api.end(b); assert.equal(display(panel), 'none'); flush(); // NEW
    assert.equal(display(panel), 'block'); assert.equal(panel.firstChild, input); assert.equal(input.value, 'unsaved'); assert.equal(display(hidden), 'none'); // NEW
    api.begin(a); api.end(a); api.begin(b); flush(); assert.equal(display(panel), 'none'); api.end(b); flush(); assert.equal(display(panel), 'block'); // NEW
}); // NEW

test('native multi-selection and copy drags hide before drop evaluation and remain hidden at the origin', t => { // NEW
    for (const clone of [false, true]) { // NEW
        const f = fixture(t); f.graph.setDropEnabled(true); f.start([f.cell, f.other]); // NEW
        f.graph.graphHandler.mouseMove(f.graph, f.me(121, 120)); assert.equal(f.api.isSuppressed(), false); // NEW
        let evaluations = 0; f.graph.getDropTarget = () => { evaluations++; assert.equal(f.display(f.panel), 'none'); return null; }; // NEW
        f.graph.graphHandler.mouseMove(f.graph, f.me(160, 155, { ctrlKey: clone })); // NEW
        assert.ok(evaluations); assert.equal(f.display(f.panel), 'none'); assert.ok(f.graph.graphHandler.shape || f.graph.graphHandler.livePreviewActive); // NEW
        f.graph.graphHandler.mouseMove(f.graph, f.me(120, 120, { ctrlKey: clone })); assert.equal(f.display(f.panel), 'none'); // NEW
        f.graph.graphHandler.mouseUp(f.graph, f.me(160, 155, { ctrlKey: clone })); f.graph.isMouseDown = false; f.flush(); // NEW
        assert.equal(f.display(f.panel), 'block'); // NEW
    } // NEW
}); // NEW

test('resize and rotation begin on movement and retain their native preview', t => { // NEW
    for (const rotation of [false, true]) { // NEW
        const f = fixture(t); f.graph.setSelectionCell(f.cell); // NEW
        const handler = new f.w.mxVertexHandler(f.graph.view.getState(f.cell)); // NEW
        handler.rotationEnabled = true; handler.start(220, 180, rotation ? f.w.mxEvent.ROTATION_HANDLE : 7); // NEW
        assert.equal(f.display(f.panel), 'block'); // NEW
        handler.mouseMove(f.graph, f.me(240, 205)); assert.equal(f.display(f.panel), 'none'); // NEW
        assert.notEqual(f.w.getComputedStyle((handler.preview || handler.selectionBorder).node).display, 'none'); // NEW
        handler.reset(); f.flush(); assert.equal(f.display(f.panel), 'block'); handler.destroy(); // NEW
    } // NEW
}); // NEW

test('library entry, exit, reentry, reset, and drop restore overlays without hiding its preview', t => { // NEW
    const f = fixture(t), source = new f.w.mxDragSource(f.fixed, () => {}); // NEW
    source.createPreviewElement = () => f.w.document.createElement('div'); // NEW
    source.dragEnter(f.graph, new f.w.MouseEvent('mousemove')); source.currentGraph = f.graph; // NEW
    assert.equal(f.display(f.panel), 'none'); assert.notEqual(f.display(source.previewElement), 'none'); // NEW
    source.dragExit(f.graph); source.currentGraph = null; f.flush(); assert.equal(f.display(f.panel), 'block'); // NEW
    source.dragEnter(f.graph, new f.w.MouseEvent('mousemove')); source.currentGraph = f.graph; source.reset(); f.flush(); // NEW
    assert.equal(f.display(f.panel), 'block'); // NEW
    source.dragEnter(f.graph, new f.w.MouseEvent('mousemove')); source.currentGraph = f.graph; source.currentPoint = new f.w.mxPoint(300, 300); // NEW
    source.mouseUp(new f.w.MouseEvent('mouseup')); f.flush(); assert.equal(f.display(f.panel), 'block'); // NEW
}); // NEW

test('release, Escape, cancellation, blur, and graph destruction cannot leave overlays hidden', t => { // NEW
    for (const ending of ['mouseup', 'pointerup', 'pointercancel', 'touchcancel', 'blur', 'escape', 'destroy']) { // NEW
        const f = fixture(t); f.start(); f.graph.graphHandler.mouseMove(f.graph, f.me(160, 150)); // NEW
        assert.equal(f.display(f.panel), 'none'); // NEW
        if (ending === 'escape') f.graph.escape(); // NEW
        else if (ending === 'destroy') { const count = f.w.document.querySelectorAll('style').length; f.graph.destroy(); assert.equal(f.w.document.querySelectorAll('style').length, count - 1); assert.equal(f.api.isSuppressed(), false); } // NEW
        else f.w.dispatchEvent(new f.w.Event(ending)); // NEW
        f.flush(); assert.equal(f.display(f.panel), 'block', ending); // NEW
    } // NEW
}); // NEW

test('clicks, marquee, panning, nudges, and label handles do not activate suppression', t => { // NEW
    const f = fixture(t); // NEW
    f.graph.isMouseDown = true; f.graph.graphHandler.mouseMove(f.graph, f.me(300, 300)); // NEW: no object handler owns a blank-canvas gesture.
    assert.equal(f.api.isSuppressed(), false); // NEW
    f.graph.moveCells([f.cell], 10, 0); assert.equal(f.api.isSuppressed(), false); // NEW
    f.graph.panGraph(15, 10); assert.equal(f.api.isSuppressed(), false); // NEW
    f.graph.setSelectionCell(f.cell); const handler = new f.w.mxVertexHandler(f.graph.view.getState(f.cell)); // NEW
    handler.start(120, 120, f.w.mxEvent.LABEL_HANDLE); handler.mouseMove(f.graph, f.me(150, 150)); // NEW
    assert.equal(f.api.isSuppressed(), false); handler.reset(); handler.destroy(); // NEW
}); // NEW

test('handle commit, Escape, blur, and destruction detach document listeners and release suppression', t => { // NEW
    for (const ending of ['commit', 'escape', 'blur', 'destroy']) { // NEW
        const f = fixture(t, ['Deep_Click_Through.js']); // NEW
        const initial = f.graph.getCellGeometry(f.cell).clone(); // NEW
        f.graph.__trellisWorkspaceDragPolicy.beginHandleDragForTests(f.cell, new f.w.MouseEvent('mousedown', { clientX: 120, clientY: 120, button: 0 })); // NEW
        assert.equal(f.api.isSuppressed(), false); // NEW
        const moveType = f.w.mxClient.IS_POINTER ? 'pointermove' : 'mousemove', upType = f.w.mxClient.IS_POINTER ? 'pointerup' : 'mouseup'; // NEW
        f.w.document.dispatchEvent(new f.w.MouseEvent(moveType, { clientX: 180, clientY: 170, bubbles: true })); // NEW
        assert.equal(f.api.isSuppressed(), true); // NEW
        if (ending === 'commit') f.w.document.dispatchEvent(new f.w.MouseEvent(upType, { clientX: 180, clientY: 170, bubbles: true })); // NEW
        else if (ending === 'escape') f.graph.escape(); // NEW
        else if (ending === 'blur') f.w.dispatchEvent(new f.w.Event('blur')); // NEW
        else f.graph.destroy(); // NEW
        f.flush(); assert.equal(f.display(f.panel), 'block'); assert.equal(f.graph.__trellisWorkspaceHandleDragActive, false); // NEW
        if (ending !== 'commit') assert.equal(f.graph.getCellGeometry(f.cell).x, initial.x); // NEW
        f.w.document.dispatchEvent(new f.w.MouseEvent(moveType, { clientX: 250, clientY: 240, bubbles: true })); // NEW
        assert.equal(f.api.isSuppressed(), false); // NEW
    } // NEW
}); // NEW

test('bed, occupancy, planting, and handle roots participate without rebuilding on temporary hiding', async t => { // NEW
    const f = fixture(t, ['Planting_Group.js', 'Garden_Beds.js', 'Bed_Succession_Navigator.js', 'Deep_Click_Through.js']); // NEW
    const xml = attrs => { const node = f.w.mxUtils.createXmlDocument().createElement('object'); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); return node; }; // NEW
    const garden = f.graph.insertVertex(null, 'garden', xml({ garden_module: '1', label: 'Garden' }), 0, 0, 900, 800); // NEW
    const bed = f.graph.insertVertex(garden, 'bed', xml({ garden_bed: '1', label: 'Bed' }), 100, 100, 400, 300); // NEW
    f.graph.insertVertex(garden, 'crop', xml({ tiler_group: '1', label: 'Crop', bed_auto_fit: '0' }), 120, 120, 160, 100); // NEW
    f.graph.setSelectionCell(bed); await new Promise(resolve => f.w.setTimeout(resolve, 30)); f.flush(); // NEW
    const roots = Array.from(f.w.document.querySelectorAll('[data-trellis-overlay-owner]')); // NEW
    assert.ok(roots.some(node => node.classList.contains('trellis-bed-conditions-overlay'))); // NEW
    const bedPanel = roots.find(node => node.classList.contains('trellis-bed-conditions-overlay')), name = bedPanel.querySelector('input'); name.value = 'pending bed name'; // NEW
    assert.ok(roots.length > 2); const snapshot = f.w.mxUtils.getXml(new f.w.mxCodec().encode(f.graph.model)); // NEW
    f.api.begin('test'); assert.equal(f.api.isSuppressed(), true); roots.forEach(node => assert.equal(node.getAttribute('data-trellis-overlay-owner'), f.panel.getAttribute('data-trellis-overlay-owner'))); // NEW
    f.graph.view.fireEvent(new f.w.mxEventObject(f.w.mxEvent.REPAINT)); f.flush(); // NEW
    assert.equal(f.api.isSuppressed(), true); assert.ok(roots.some(node => node.isConnected)); // NEW
    f.api.end('test'); f.flush(); assert.equal(f.w.mxUtils.getXml(new f.w.mxCodec().encode(f.graph.model)), snapshot); // NEW
    assert.equal(bedPanel.querySelector('input'), name); assert.equal(name.value, 'pending bed name'); // NEW
}); // NEW
