/** Exercise native label editing against the shipped graph and independently loaded Trellis plugins. */ // NEW
const test = require('node:test'); // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const { JSDOM } = require('jsdom'); // NEW
const webapp = path.resolve(__dirname, '../drawio/src/main/webapp'); // NEW

function harness(t, plugins = ['Trellis_UI_Cleanup.js']) { // NEW
    const dom = new JSDOM('<!doctype html><div id="graph" style="position:relative;width:800px;height:600px"></div>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true }); // NEW
    const w = dom.window; // NEW
    t.after(() => dom.window.close()); // NEW
    w.mxLoadResources = false; w.mxLoadStylesheets = false; w.urlParams = {}; // NEW
    w.HTMLCanvasElement.prototype.getContext = () => ({ fillStyle: '#000000', fillRect() {}, getImageData: () => ({ data: [0, 0, 0, 255] }) }); // NEW
    w.HTMLCanvasElement.prototype.toDataURL = () => ''; // NEW
    w.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 100, height: 24 }); // NEW
    w.HTMLElement.prototype.scrollIntoView = function () {}; w.document.execCommand = () => false; // NEW
    w.eval(fs.readFileSync(path.join(webapp, 'js/app.min.js'), 'utf8')); // NEW
    const graph = new w.Graph(w.document.getElementById('graph')); // NEW
    const ui = { editor: { graph }, menus: { get: () => null }, actions: { get: () => null } }; // NEW
    w.Draw = { loadPlugin: fn => fn(ui) }; // NEW
    const load = name => w.eval(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins', name), 'utf8')); // NEW
    plugins.forEach(load); // NEW
    const vertex = (value = 'Original label', style = 'rounded=1;whiteSpace=wrap;html=1;') => graph.insertVertex(null, null, value, 40, 40, 240, 120, style); // NEW
    const tick = () => new Promise(resolve => w.setTimeout(resolve, 10)); // NEW
    const frame = () => new Promise(resolve => w.requestAnimationFrame(resolve)); // NEW
    const xml = () => w.mxUtils.getXml(new w.mxCodec().encode(graph.model)); // NEW
    async function edit(cell, draft = 'Draft label') { // NEW
        graph.startEditingAtCell(cell); await tick(); // NEW
        const input = graph.cellEditor.textarea; // NEW
        input.tabIndex = -1; input.focus(); // NEW: jsdom does not implement contentEditable focusability; Chromium verifies native focus separately.
        input.textContent = draft; input.dispatchEvent(new w.InputEvent('input', { bubbles: true, data: draft, inputType: 'insertText' })); // NEW
        await tick(); return input; // NEW
    } // NEW
    return { w, graph, ui, load, vertex, tick, frame, xml, edit }; // NEW
} // NEW

for (const alreadySelected of [false, true]) { // NEW
    test('Roadmap alone preserves an ordinary editing label: already selected=' + alreadySelected, async t => { // NEW
        const h = harness(t, ['Garden_Roadmap_Core.js', 'Garden_Roadmap_Manager.js']), cell = h.vertex(); // NEW
        await h.frame(); h.graph.setSelectionCell(cell); if (alreadySelected) await h.frame(); // NEW
        const node = h.graph.view.getState(cell).text.node, before = h.xml(); // NEW
        const input = await h.edit(cell); await h.frame(); // NEW
        assert.equal(h.graph.view.getState(cell).text.node, node, 'selection must not replace the label'); // NEW
        assert.equal(node.style.visibility, 'hidden'); assert.equal(h.graph.cellEditor.textarea, input); // NEW
        assert.equal(h.xml(), before, 'selection and draft typing must not write the model'); // NEW
        h.graph.stopEditing(false); assert.equal(cell.value, 'Draft label'); // NEW
    }); // NEW
} // NEW

for (const html of [false, true]) for (const cancel of [false, true]) { // NEW
    test('native editing survives repeated replacement: html=' + html + ', cancel=' + cancel, async t => { // NEW
        const h = harness(t), cell = h.vertex('Original label', 'whiteSpace=wrap;html=' + Number(html) + ';'), other = h.vertex('Unrelated label'); // NEW
        const undo = new h.w.mxUndoManager(); h.graph.model.addListener(h.w.mxEvent.UNDO, (_sender, event) => undo.undoableEditHappened(event.getProperty('edit'))); // NEW
        const input = await h.edit(cell, 'Draft\nSecond line'), before = h.xml(); // NEW
        const selection = h.w.getSelection(), range = h.w.document.createRange(); range.selectNodeContents(input); range.collapse(false); selection.removeAllRanges(); selection.addRange(range); // NEW
        const anchor = selection.anchorNode, offset = selection.anchorOffset, oldNode = h.graph.cellEditor.textNode; // NEW
        for (let i = 0; i < 3; i++) { // NEW
            h.graph.refresh(); // NEW
            const shape = h.graph.view.getState(cell).text; // NEW
            assert.equal(shape.node.style.visibility, 'hidden'); assert.equal(h.graph.cellEditor.textNode, shape.node); assert.equal(h.graph.cellEditor.textShape, shape); // NEW
            assert.equal(h.graph.cellEditor.textarea, input); assert.equal(input.textContent, 'Draft\nSecond line'); assert.equal(h.w.document.activeElement, input); // NEW
            assert.equal(selection.anchorNode, anchor); assert.equal(selection.anchorOffset, offset); // NEW
            assert.notEqual(h.graph.view.getState(other).text.node.style.visibility, 'hidden'); // NEW
        } // NEW
        assert.equal(oldNode.isConnected, false); assert.equal(h.xml(), before); assert.equal(undo.history.length, 0); // NEW
        h.graph.stopEditing(cancel); // NEW
        const committed = html ? 'Draft<br/>Second line' : 'Draft\nSecond line'; // NEW: preserve native HTML versus plain-text newline serialization.
        assert.equal(cell.value, cancel ? 'Original label' : committed); // NEW
        assert.notEqual(h.graph.view.getState(cell).text.node.style.visibility, 'hidden'); // NEW
        assert.equal(h.graph.cellEditor.textarea, null); assert.equal(undo.history.length, cancel ? 0 : 1); // NEW
        if (!cancel) { undo.undo(); assert.equal(cell.value, 'Original label'); undo.redo(); assert.equal(cell.value, committed); } // NEW
    }); // NEW
} // NEW

test('wrapping and HTML rendering changes rebind the active editor to the live label', async t => { // NEW
    const h = harness(t), cell = h.vertex(), input = await h.edit(cell); // NEW
    for (const [key, value] of [['whiteSpace', null], ['html', '0'], ['html', '1'], ['overflow', 'hidden'], ['fontSize', '18']]) { // NEW
        h.graph.setCellStyles(key, value, [cell]); await h.tick(); // NEW
        assert.equal(h.graph.view.getState(cell).text.node.style.visibility, 'hidden'); // NEW
        assert.equal(h.graph.cellEditor.textShape, h.graph.view.getState(cell).text); assert.equal(h.graph.cellEditor.textarea, input); assert.equal(input.textContent, 'Draft label'); // NEW
    } // NEW
    h.graph.stopEditing(false); assert.equal(cell.value, 'Draft label'); assert.notEqual(h.graph.view.getState(cell).text.node.style.visibility, 'hidden'); // NEW
}); // NEW

test('empty labels tolerate refresh and hide a label subsequently created by a model update', async t => { // NEW
    const h = harness(t), cell = h.vertex(''), input = await h.edit(cell); // NEW
    h.graph.refresh(); assert.equal(h.graph.view.getState(cell).text, null); assert.equal(h.graph.cellEditor.textarea, input); // NEW
    h.graph.model.setValue(cell, 'External label'); // NEW
    assert.equal(h.graph.view.getState(cell).text.node.style.visibility, 'hidden'); assert.equal(input.textContent, 'Draft label'); // NEW
    h.graph.stopEditing(true); assert.equal(cell.value, 'External label'); assert.notEqual(h.graph.view.getState(cell).text.node.style.visibility, 'hidden'); // NEW
}); // NEW

test('edge label refresh, switching cells and deleting an edited cell finish safely', async t => { // NEW
    const h = harness(t), first = h.vertex('First'), second = h.vertex('Second'), edge = h.graph.insertEdge(null, null, 'Original edge', first, second, 'html=1;'); // NEW
    await h.edit(edge, 'Draft edge'); h.graph.refresh(); assert.equal(h.graph.view.getState(edge).text.node.style.visibility, 'hidden'); // NEW
    await h.edit(second, 'Second draft'); assert.equal(edge.value, 'Original edge'); assert.notEqual(h.graph.view.getState(edge).text.node.style.visibility, 'hidden'); // NEW
    h.graph.refresh(); h.graph.removeCells([second]); assert.equal(h.graph.isEditing(), false); assert.equal(h.graph.cellEditor.textarea, null); // NEW
    await h.edit(first); h.graph.refresh(); h.graph.stopEditing(false); assert.equal(first.value, 'Draft label'); // NEW
}); // NEW

test('label hiding opt-out, graph isolation and repeated plugin loading preserve renderer policy', async t => { // NEW
    const h = harness(t), cell = h.vertex(), redraw = h.graph.cellRenderer.redrawLabel; // NEW
    h.load('Trellis_UI_Cleanup.js'); assert.equal(h.graph.cellRenderer.redrawLabel, redraw); // NEW
    const secondGraph = new h.w.Graph(h.w.document.createElement('div')); // NEW
    assert.equal(secondGraph.cellRenderer.redrawLabel, h.w.mxCellRenderer.prototype.redrawLabel); secondGraph.destroy(); // NEW
    h.graph.cellEditor.isHideLabel = () => false; await h.edit(cell); h.graph.refresh(); // NEW
    assert.notEqual(h.graph.view.getState(cell).text.node.style.visibility, 'hidden'); assert.equal(h.graph.cellEditor.textNode, null); // NEW
    h.graph.stopEditing(false); assert.equal(cell.value, 'Draft label'); // NEW
}); // NEW

test('SVG export retains saved label text while the canvas label is hidden', async t => { // NEW
    const h = harness(t), cell = h.vertex('Exported original label'); await h.edit(cell); h.graph.refresh(); // NEW
    const svg = h.graph.getSvg('#ffffff'); // NEW
    assert.match(svg.textContent, /Exported original label/); assert.equal(h.graph.view.getState(cell).text.node.style.visibility, 'hidden'); // NEW
    for (const node of svg.getElementsByTagName('*')) { assert.notEqual(node.getAttribute('visibility'), 'hidden'); assert.notEqual(node.style && node.style.visibility, 'hidden'); } // NEW: exported text must be drawable, not merely present in the SVG.
    assert.equal(h.graph.cellEditor.textNode, h.graph.view.getState(cell).text.node); h.graph.stopEditing(true); // NEW
}); // NEW
