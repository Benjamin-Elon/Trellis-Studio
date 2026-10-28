/** Real shipped mxGraph with a small editor boundary for deterministic details-controller tests. */ // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const { JSDOM } = require('jsdom'); // NEW
const webapp = path.resolve(__dirname, '../../drawio/src/main/webapp'); // NEW
module.exports = function harness(t, options = {}) { // CHANGE
    const dom = new JSDOM('<!doctype html><body><div id="graph" style="position:relative;width:1000px;height:800px"></div></body>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true }); // NEW
    const w = dom.window; w.mxLoadResources = false; w.mxLoadStylesheets = false; w.urlParams = {}; // NEW
    w.HTMLCanvasElement.prototype.getContext = () => ({ fillStyle: '#000000', fillRect() {}, getImageData: () => ({ data: [0, 0, 0, 255] }) }); // NEW
    w.HTMLCanvasElement.prototype.toDataURL = () => ''; w.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 100, height: 24 }); // NEW
    w.HTMLElement.prototype.scrollIntoView = function () {}; w.document.execCommand = () => false; // NEW
    w.eval(fs.readFileSync(path.join(webapp, 'js/app.min.js'), 'utf8')); // NEW
    const graph = new w.Graph(w.document.getElementById('graph')), editor = new w.mxEventSource(), undo = new w.mxUndoManager(); // NEW
    editor.graph = graph; editor.undoManager = undo; graph.model.addListener(w.mxEvent.UNDO, (_sender, event) => undo.undoableEditHappened(event.getProperty('edit'))); // NEW
    const ui = { editor, isSelectionAllowed: options.isSelectionAllowed || w.EditorUi.prototype.isSelectionAllowed, actions: { get: () => null }, menus: { get: () => null }, currentPage: { getId: () => 'page-a' }, getFileData: () => w.mxUtils.getXml(new w.mxCodec().encode(graph.model)) }; // CHANGE: exercise the host selection hook rather than omitting it.
    const policy = { currentUser: 'user-a', editable: true, enabled: true, owner: 'owner', admin: false, diagram: 'diagram-a', isEnabled() { return this.enabled; }, getCurrentUser() { return this.currentUser ? { id: this.currentUser, name: this.currentUser, admin: this.admin } : null; }, getAccessSummary() { return { ownerUserId: this.owner }; }, getDiagramKey() { return this.diagram; }, canEditCell() { return this.editable; } }; // CHANGE
    w.Trellis = { users: policy }; w.Draw = { loadPlugin: fn => fn(ui) }; // NEW
    const resizeObservers = []; // NEW
    if (options.observePanelResizes) w.ResizeObserver = class { // NEW: explicitly deliver notifications, including callbacks queued before disconnect.
        constructor(callback) { this.callback = callback; resizeObservers.push(this); } // NEW
        observe(node) { this.node = node; } // NEW
        disconnect() { this.disconnected = true; } // NEW
        emit(entries = []) { this.callback(entries, this); } // NEW
    }; // NEW
    if (options.overlayVisibility) { // NEW: exercise the production controller without changing the fixture's toolbar or menus.
        const cleanup = fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Trellis_UI_Cleanup.js'), 'utf8'); // NEW
        w.eval(cleanup.slice(0, cleanup.indexOf('\nDraw.loadPlugin'))); w.Trellis.ui.installOverlayVisibility(graph); // NEW
    } // NEW
    w.eval(fs.readFileSync(path.join(webapp, 'js/trellis-permission-core.js'), 'utf8')); // NEW
    for (const name of ['Trellis_Context_Menu.js', 'Trellis_Details_Core.js', 'Trellis_Details_Toolbar.js', 'Trellis_Details_Comments.js', 'Trellis_Object_Details.js']) w.eval(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins', name), 'utf8')); // CHANGE
    const controller = graph.__trellisObjectDetails; // NEW
    t.after(() => { controller.destroy(); graph.destroy(); dom.window.close(); }); // NEW
    function vertex(id, details, attributes = {}) { // NEW
        let value = 'Label ' + id; // NEW
        if (details != null || Object.keys(attributes).length) { value = w.mxUtils.createXmlDocument().createElement('object'); value.setAttribute('label', 'Label ' + id); if (details != null) value.setAttribute('trellis_details_html', details); Object.entries(attributes).forEach(([key, valueString]) => value.setAttribute(key, valueString)); } // NEW
        return graph.insertVertex(null, id, value, 150, 100, 200, 80, 'html=1;whiteSpace=wrap;'); // NEW
    } // NEW
    const tick = () => new Promise(resolve => w.setTimeout(resolve, 15)); // NEW
    const input = cell => [...w.document.querySelectorAll('.trellis-object-details')].find(node => node.dataset.collaborationObjectId === cell.id && node.style.display !== 'none')?.querySelector('.trellis-object-details-editor'); // NEW
    function type(cell, html) { const node = input(cell); node.innerHTML = html; node.dispatchEvent(new w.InputEvent('input', { bubbles: true, inputType: 'insertText', data: node.textContent })); return node; } // NEW
    return { w, graph, ui, undo, policy, controller, vertex, tick, input, type, resizeObservers, core: w.TrellisDetailsCore }; // CHANGE
}; // NEW
