const fs = require('node:fs'); // CHANGE
const path = require('node:path'); // CHANGE
const { JSDOM } = require('jsdom'); // CHANGE

/** Runs the complete production tiler against the bundled mxGraph model and SVG renderer. */ // CHANGE
function loadPlantTilerMxGraph() { // CHANGE
    const dom = new JSDOM('<!doctype html><body><div id="graph"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true }); // CHANGE
    const window = dom.window; // CHANGE
    window.mxLoadResources = false; window.mxLoadStylesheets = false; // CHANGE
    window.HTMLCanvasElement.prototype.getContext = () => null; // CHANGE: jsdom has no raster canvas; these tests use the SVG renderer.
    const webapp = path.join(__dirname, '../../drawio/src/main/webapp'); // CHANGE
    window.eval(fs.readFileSync(path.join(webapp, 'mxgraph/mxClient.js'), 'utf8')); // CHANGE
    const graph = new window.mxGraph(window.document.getElementById('graph')); // CHANGE
    graph.setHtmlLabels(true); // CHANGE
    graph.isSpecialColor = () => false; // CHANGE: editor hook; fixture styles use ordinary concrete colors.
    graph.convertValueToString = cell => cell.value && cell.value.getAttribute ? cell.value.getAttribute('label') || '' : String(cell.value || ''); // CHANGE: draw.io's XML label convention.
    const undoManager = new window.mxUndoManager(); // CHANGE
    graph.getModel().addListener(window.mxEvent.UNDO, (sender, event) => undoManager.undoableEditHappened(event.getProperty('edit'))); // CHANGE
    window.Draw = { loadPlugin(callback) { callback({ editor: { graph, undoManager }, actions: { get: () => null }, hideDialog() {} }); } }; // CHANGE
    window.eval(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Planting_Group.js'), 'utf8')); // CHANGE
    function value(attrs) { // CHANGE
        const node = window.mxUtils.createXmlDocument().createElement('object'); // CHANGE
        Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value)); // CHANGE
        return node; // CHANGE
    } // CHANGE
    const moduleCell = graph.insertVertex(null, 'garden', value({ garden_module: '1', label: 'Garden' }), 0, 0, 2000, 2000, 'swimlane;module=1;'); // CHANGE
    function bed(width, height, rotation = 0, x = 200, y = 200) { // CHANGE
        return graph.insertVertex(moduleCell, null, value({ garden_bed: '1', label: 'Bed' }), x, y, width, height, `rotation=${rotation};dashed=1;fillColor=#afb576;`); // CHANGE
    } // CHANGE
    return { dom, window, graph, undoManager, moduleCell, bed, tiler: window.USL.tiler, close: () => window.close() }; // CHANGE
} // CHANGE

module.exports = { loadPlantTilerMxGraph }; // CHANGE
