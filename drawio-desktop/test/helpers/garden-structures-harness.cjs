const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const { JSDOM } = require('jsdom'); // NEW
const webapp = path.resolve(__dirname, '../../drawio/src/main/webapp'); // NEW
const plugins = path.join(webapp, 'plugins/garden_planner_plugins'); // NEW
const read = name => fs.readFileSync(path.join(webapp, name), 'utf8').replace(/\r\n/g, '\n'); // NEW

/** Exercise the actual editor history actions and keyboard routing rather than a custom shortcut handler. */ // NEW
function historyScripts() { // NEW
    const source = read('js/grapheditor/EditorUi.js'), actions = read('js/grapheditor/Actions.js'); // NEW
    const methods = ['undo', 'redo', 'canUndo', 'canRedo', 'createKeyHandler'].map(name => { // NEW
        const match = source.match(new RegExp('^EditorUi\\.prototype\\.' + name + ' = function[^]*?^};', 'm')); // NEW
        if (!match) throw new Error('Missing production EditorUi.' + name); return match[0]; // NEW
    }).join('\n'); // NEW
    const bindings = ['undo', 'redo'].map(name => actions.match(new RegExp("this.addAction\\('" + name + "',[^\\n]+"))[0]).join('\n'); // NEW
    return ['window.EditorUi=function(){};\n' + methods, actions, ` // NEW
        window.Editor={ctrlKey:'Ctrl',shiftKey:'Shift'};
        window.installStructureHistoryUi=function(graph,undoManager){
            const ui=new EditorUi();ui.editor={graph,undoManager};ui.hideDialog=()=>{};
            ui.actions=Object.create(Actions.prototype);ui.actions.actions={};
            (function(ui,Editor){${bindings}}).call(ui.actions,ui,Editor);
            ui.updateActionStates=()=>{ui.actions.get('undo').setEnabled(ui.canUndo());ui.actions.get('redo').setEnabled(ui.canRedo());};
            undoManager.addListener(null,()=>ui.updateActionStates());ui.updateActionStates();return ui;
        };void 0;
    `]; // NEW
} // NEW

function editorFocusSource() { // NEW
    const match = read('js/grapheditor/EditorUi.js').match(/var graphFireMouseEvent = graph.fireMouseEvent;[\s\S]*?^\s*};/m); // NEW
    if (!match) throw new Error('Missing production canvas-focus handler.'); return match[0]; // NEW
} // NEW

/** Load production compression, embedded-stencil rendering, and the shared mode controller without the shell. */ // NEW
function runtimeScripts() { // NEW
    const source = read('js/grapheditor/Graph.js'), rendererStart = source.indexOf('\tvar mxCellRendererCreateShape ='); // NEW
    const methods = ['zapGremlins', 'arrayBufferToString', 'stringToArrayBuffer', 'compress', 'decompress'].map(name => { // NEW
        const match = source.match(new RegExp('^Graph\\.' + name + ' = function[^]*?^};', 'm')); // NEW
        if (!match) throw new Error('Missing production Graph.' + name); return match[0]; // NEW
    }).join('\n'); // NEW
    const planner = read('plugins/garden_planner_plugins/Year_Planner.js'); // NEW
    const modes = planner.slice(planner.indexOf('    function installTrellisInteractionModeController()'), planner.indexOf('    // -------------------- SessionController')); // NEW
    const cleanup = read('plugins/garden_planner_plugins/Trellis_UI_Cleanup.js'); // NEW
    return [read('js/deflate/pako.min.js'), 'window.Graph=mxGraph;\n' + methods, source.slice(rendererStart, source.indexOf('\n})();', rendererStart)), modes, cleanup.slice(0, cleanup.indexOf('\nDraw.loadPlugin'))]; // NEW
} // NEW

function fixture(t, options = {}) { // NEW
    const dom = new JSDOM('<!doctype html><body><div id="graph" style="position:relative;width:1000px;height:800px"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true }); // NEW
    const w = dom.window; w.mxLoadResources = false; w.mxLoadStylesheets = false; w.HTMLCanvasElement.prototype.getContext = () => null; // NEW
    w.eval(read('mxgraph/mxClient.js')); runtimeScripts().forEach(script => w.eval(script)); // NEW
    const graph = new w.mxGraph(w.document.getElementById('graph')); graph.isSpecialColor = () => false; graph.getCompositeParent = cell => cell; // NEW
    graph.graphHandler.isPropagateSelectionCell = () => false; // NEW: match the existing garden-overlay fixtures' editor child-selection policy.
    graph.convertValueToString = cell => cell.getAttribute?.('label') || ''; // NEW
    const model = graph.getModel(), undo = new w.mxUndoManager(); model.addListener(w.mxEvent.UNDO, (_sender, event) => undo.undoableEditHappened(event.getProperty('edit'))); // CHANGE: initialize history before plugins register their controller.
    if (options.history) historyScripts().forEach(script => w.eval(script)); // NEW
    const ui = options.history ? w.installStructureHistoryUi(graph, undo) : { editor: { graph }, actions: { get: () => null, addAction: () => ({}) } }; // CHANGE
    if (options.editorFocus) { graph.container.tabIndex = 0; w.Function('graph', 'ui', editorFocusSource())(graph, ui); } // NEW
    w.Draw = { loadPlugin: callback => callback(ui) }; // NEW
    w.Trellis.ui.installOverlayVisibility(graph); // NEW
    for (const name of options.plugins || []) w.eval(read('plugins/garden_planner_plugins/' + name)); // NEW
    w.eval(read('plugins/garden_planner_plugins/Garden_Structures.js')); // NEW
    const value = attrs => { const node = w.mxUtils.createXmlDocument().createElement('object'); Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value)); return node; }; // NEW
    const garden = graph.insertVertex(null, 'garden', value({ garden_module: '1', label: 'Garden', unit_system: options.units || 'metric' }), 100, 100, options.width || 1000, options.height || 700); // NEW
    undo.clear(); // CHANGE: garden setup is outside each test's user history.
    const tick = () => new Promise(resolve => w.setTimeout(resolve, 15)); // NEW
    const serialized = () => w.mxUtils.getXml(new w.mxCodec().encode(model)); // NEW
    const choose = text => { const node = Array.from(w.document.querySelectorAll('.trellis-structure-discard button')).find(node => node.textContent === text); if (!node) throw new Error('Missing confirmation: ' + text); node.click(); }; // NEW
    t.after(() => { graph.destroy(); w.close(); }); // NEW
    return { w, graph, model, garden, undo, api: graph.__trellisStructures, tick, value, serialized, choose, ui }; // NEW
} // NEW
module.exports = { fixture, runtimeScripts, historyScripts, editorFocusSource, read, webapp, plugins }; // CHANGE
