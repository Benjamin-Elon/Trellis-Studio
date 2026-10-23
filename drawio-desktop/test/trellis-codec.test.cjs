/** Native codecs must preserve complete XML-valued models without probing unconstructible DOM constructors. */ // CHANGE
const test = require('node:test'); // CHANGE
const assert = require('node:assert/strict'); // CHANGE
const fs = require('node:fs'); // CHANGE
const path = require('node:path'); // CHANGE
const parser = require('@babel/parser'); // CHANGE
const traverse = require('@babel/traverse').default; // CHANGE
const { JSDOM } = require('jsdom'); // CHANGE
const webapp = path.resolve(__dirname, '../drawio/src/main/webapp'); // CHANGE
function fixture(t) { // CHANGE
    const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' }), w = dom.window; t.after(() => dom.window.close()); // CHANGE
    w.mxLoadResources = false; w.mxLoadStylesheets = false; w.HTMLCanvasElement.prototype.getContext = () => null; w.eval(fs.readFileSync(path.join(webapp, 'mxgraph/mxClient.js'), 'utf8')); // CHANGE
    const source = fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Trellis_UI_Cleanup.js'), 'utf8'); let install; // CHANGE
    traverse(parser.parse(source), { noScope: true, FunctionDeclaration(entry) { if (entry.node.id?.name === 'installXmlNodeEncoding') install = source.slice(entry.node.start, entry.node.end); } }); // CHANGE
    assert.ok(install); w.eval('(' + install + ')()'); return w; // CHANGE
} // CHANGE
test('XML-valued native cells round trip without DOM-constructor probes or lost attributes', t => { // CHANGE
    const w = fixture(t), model = new w.mxGraphModel(), doc = w.mxUtils.createXmlDocument(); let probes = 0, tagProbes = 0; const getCodec = w.mxCodecRegistry.getCodec, getFunctionName = w.mxUtils.getFunctionName; // CHANGE
    w.mxUtils.getFunctionName = function (constructor) { if (typeof constructor === 'string') tagProbes++; return getFunctionName.apply(this, arguments); }; // CHANGE
    w.mxCodecRegistry.getCodec = function (constructor) { if (constructor === doc.createElement('object').constructor) probes++; return getCodec.apply(this, arguments); }; // CHANGE
    model.beginUpdate(); try { for (let i = 0; i < 100; i++) { const value = doc.createElement('object'); value.setAttribute('label', '<Plant & ' + i + '>'); value.setAttribute('trellis_owner_user_id', 'owner'); const cell = new w.mxCell(value, new w.mxGeometry(i, 10, 20, 30), 'rounded=1;'); cell.setId('plant-' + i); cell.setVertex(true); model.add(model.getRoot().getChildAt(0), cell); } } finally { model.endUpdate(); } // CHANGE
    const xml = w.mxUtils.getXml(new w.mxCodec().encode(model)), document = w.mxUtils.parseXml(xml), restored = new w.mxCodec(document).decode(document.documentElement); // CHANGE
    assert.equal(probes, 0); assert.equal(tagProbes, 0); assert.equal(restored.getCell('plant-99').getAttribute('label'), '<Plant & 99>'); assert.equal(restored.getCell('plant-0').getAttribute('trellis_owner_user_id'), 'owner'); assert.equal(restored.getCell('plant-99').geometry.x, 99); // CHANGE
}); // CHANGE
test('dynamic custom XML codecs and ignored values retain native precedence', t => { // CHANGE
    const w = fixture(t), object = w.mxUtils.createXmlDocument().createElement('object'), codec = new w.mxCodec(); // CHANGE
    const name = w.mxUtils.getFunctionName(object.constructor); w.mxCodecRegistry.codecs[name] = { encode: () => 'custom result' }; // CHANGE
    assert.equal(codec.encode(object), 'custom result'); codec.isObjectIgnored = () => true; assert.equal(codec.encode(object), null); // CHANGE
    assert.equal(w.mxCodecRegistry.getCodec('future-tag'), undefined); w.mxCodecRegistry.addAlias('future-tag', 'future-codec'); const custom = {}; w.mxCodecRegistry.codecs['future-codec'] = custom; assert.equal(w.mxCodecRegistry.getCodec('future-tag'), custom); // CHANGE: failed lookups must not cache away later registrations.
}); // CHANGE
test('unchanged page-break display is reused while layout and rendering changes retain native updates', () => { // CHANGE
    const source = fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Trellis_UI_Cleanup.js'), 'utf8'); let install; // CHANGE
    traverse(parser.parse(source), { noScope: true, FunctionDeclaration(entry) { if (entry.node.id?.name === 'installPageBreakReuse') install = source.slice(entry.node.start, entry.node.end); } }); // CHANGE
    let renders = 0, bounds = { x: 0, y: 0, width: 1000, height: 1000 }; const graph = { getGraphBounds: () => bounds, view: { scale: 1, translate: { x: 0, y: 0 }, backgroundPane: {} }, pageFormat: { width: 850, height: 1100 }, updatePageBreaks() { renders++; this.horizontalPageBreaks ||= []; this.verticalPageBreaks ||= []; } }; // CHANGE
    new Function('return (' + install + ')')()(graph); graph.updatePageBreaks(true); graph.updatePageBreaks(true); assert.equal(renders, 1); // CHANGE
    bounds = { ...bounds, width: 1100 }; graph.updatePageBreaks(true); graph.view.scale = 2; graph.updatePageBreaks(true); graph.view.translate.x = 5; graph.updatePageBreaks(true); graph.pageBreakColor = 'red'; graph.updatePageBreaks(true); graph.view.backgroundPane = {}; graph.updatePageBreaks(true); graph.horizontalPageBreaks = []; graph.updatePageBreaks(true); graph.updatePageBreaks(false); assert.equal(renders, 8); // CHANGE
}); // CHANGE
