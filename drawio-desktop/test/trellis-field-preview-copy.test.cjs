/** Exercise the production canonical-copy helper against the bundled mxGraph codec. */ // CHANGE
const test = require('node:test'); // CHANGE
const assert = require('node:assert/strict'); // CHANGE
const fs = require('node:fs'); // CHANGE
const path = require('node:path'); // CHANGE
const { JSDOM } = require('jsdom'); // CHANGE

test('preview copying preserves field IDs, canonical geometry and readable descendants without denied metadata', t => { // CHANGE
    const dom = new JSDOM('<body><div id="graph"></div></body>', { runScripts: 'outside-only', url: 'http://localhost' }); t.after(() => dom.window.close()); // CHANGE
    const w = dom.window, webapp = path.join(__dirname, '../drawio/src/main/webapp'); w.mxLoadResources = false; w.mxLoadStylesheets = false; // CHANGE
    w.HTMLCanvasElement.prototype.getContext = () => null; // CHANGE: this codec test does not rasterize images.
    w.eval(fs.readFileSync(path.join(webapp, 'mxgraph/mxClient.js'), 'utf8')); // CHANGE
    const graph = w.graph = new w.mxGraph(w.document.getElementById('graph')), model = graph.model; // CHANGE
    graph.isSpecialColor = () => false; graph.convertValueToString = cell => cell.value?.getAttribute?.('label') || ''; // CHANGE: use the editor's ordinary XML label convention in the bare mxGraph harness.
    const value = attrs => { const node = w.mxUtils.createXmlDocument().createElement('object'); for (const [key, item] of Object.entries(attrs)) node.setAttribute(key, item); return node; }; // CHANGE
    const garden = graph.insertVertex(null, 'garden', value({ garden_module: '1', trellis_field_object_id: 'garden-id' }), 0, 0, 600, 400); // CHANGE
    const denied = graph.insertVertex(garden, 'private-container', value({ label: 'Never copy this secret' }), 30, 40, 100, 100, 'fillColor=#00ff00;'); // CHANGE
    const child = graph.insertVertex(denied, 'readable-child', value({ label: 'Allowed child', trellis_field_object_id: 'child-id' }), 10, 20, 30, 40); // CHANGE
    graph.cloneCells = () => { throw new Error('User-paste identity reset must not run during previews'); }; // CHANGE
    const canonicalGeometry = garden.geometry.clone(), displayGeometry = garden.geometry.clone(); displayGeometry.width = 10; displayGeometry.height = 10; garden.geometry = displayGeometry; garden.collapsed = true; // CHANGE
    graph.__trellisLocalView = { canonical(operation) { garden.geometry = canonicalGeometry; garden.collapsed = false; try { return operation(); } finally { garden.geometry = displayGeometry; garden.collapsed = true; } } }; // CHANGE
    const source = fs.readFileSync(path.join(webapp, 'js/trellis-field-runtime.js'), 'utf8'), start = source.indexOf('        function copyGarden(drawing) {'), end = source.indexOf('        /** Use the production graph/exporter', start); // CHANGE
    assert.ok(start >= 0 && end > start); w.eval('window.copyGardenForTest = ' + source.slice(start, end)); // CHANGE
    const before = w.mxUtils.getXml(new w.mxCodec().encode(model)), copies = w.copyGardenForTest([garden, child]); // CHANGE
    assert.equal(copies[0].geometry.width, 600); assert.equal(copies[0].collapsed, false); assert.equal(copies[1].getAttribute('trellis_field_object_id'), 'child-id'); // CHANGE
    assert.equal(copies[1].parent.id, denied.id); assert.ok(copies[1].parent.value == null); assert.doesNotMatch(copies[1].parent.style, /00ff00/); // CHANGE: the codec omits the neutral carrier's empty value.
    assert.notEqual(copies[1].parent, denied); assert.equal(copies[1].parent.geometry.x + copies[1].geometry.x, 40); // CHANGE
    assert.equal(w.mxUtils.getXml(new w.mxCodec().encode(model)), before); assert.equal(garden.geometry, displayGeometry); assert.equal(garden.collapsed, true); // CHANGE
}); // CHANGE
