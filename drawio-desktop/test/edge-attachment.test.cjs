/** Behavioral regressions against the shipped Graph renderer and the actual Trellis installer. */ // NEW
const test = require('node:test'); // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const { JSDOM } = require('jsdom'); // NEW
const webapp = path.resolve(__dirname, '../drawio/src/main/webapp'); // NEW
const runtime = fs.readFileSync(path.join(webapp, 'js/app.min.js'), 'utf8'); // NEW
const plugin = fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins/Trellis_UI_Cleanup.js'), 'utf8'); // NEW

/** Keep loading, undo, export and preview on production mechanics; only browser layout APIs are stubbed. */ // NEW
function harness(t, install = true) { // NEW
    const dom = new JSDOM('<!doctype html><div id="graph" style="position:relative;width:1000px;height:800px"></div>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true }); // NEW
    const w = dom.window; t.after(() => w.close()); // NEW
    w.mxLoadResources = false; w.mxLoadStylesheets = false; w.urlParams = {}; // NEW
    w.HTMLCanvasElement.prototype.getContext = () => ({ fillStyle: '#000', fillRect() {}, getImageData: () => ({ data: [0, 0, 0, 255] }) }); // NEW
    w.HTMLCanvasElement.prototype.toDataURL = () => ''; w.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 100, height: 24 }); // NEW
    w.eval(runtime); // NEW
    const graph = new w.Graph(w.document.getElementById('graph')), model = graph.model; // NEW
    const ui = { editor: { graph }, menus: { get: () => null }, actions: { get: () => null }, hoverIcons: new w.HoverIcons(graph) }; // CHANGE
    w.Draw = { loadPlugin: callback => callback(ui) }; // NEW
    const load = () => w.eval(plugin); // NEW
    if (install) load(); // NEW
    const undo = new w.mxUndoManager(); model.addListener(w.mxEvent.UNDO, (_s, event) => undo.undoableEditHappened(event.getProperty('edit'))); // NEW
    const point = (x, y) => new w.mxPoint(x, y); // NEW
    const vertex = (x, y, parent = null, style = '') => graph.insertVertex(parent, null, '', x, y, 120, 60, style); // NEW
    function transaction(callback) { model.beginUpdate(); try { return callback(); } finally { model.endUpdate(); } } // NEW
    function edge(source, target, points, style = '', parent = null) { // NEW
        return transaction(() => { // NEW
            const cell = graph.insertEdge(parent, null, '', source, target, 'edgeStyle=orthogonalEdgeStyle;rounded=0;' + style); // NEW
            if (points) { const geometry = cell.geometry.clone(); geometry.points = w.Array.from(points, p => point(p[0], p[1])); model.setGeometry(cell, geometry); } // NEW
            return cell; // NEW
        }); // NEW
    } // NEW
    function points(cell) { graph.view.validate(); return Array.from(graph.view.getState(cell).absolutePoints, p => ({ x: p.x / graph.view.scale - graph.view.translate.x, y: p.y / graph.view.scale - graph.view.translate.y })); } // NEW
    const xml = () => w.mxUtils.getXml(new w.mxCodec().encode(model)); // NEW
    return { w, graph, model, ui, undo, load, point, vertex, transaction, edge, points, xml }; // NEW
} // NEW

function enrolled(h, edge) { assert.equal(String(h.graph.getCurrentCellStyle(edge).trellisPreserveAttachment), '1'); } // NEW
function near(actual, expected, message) { assert.ok(Math.abs(actual - expected) < 0.15, `${message || 'coordinate'}: ${actual} vs ${expected}`); } // NEW
function anchored(h, edge) { // NEW
    const state = h.graph.view.getState(edge), points = state.absolutePoints; // NEW
    for (const source of [true, false]) { // NEW
        const terminal = state.getVisibleTerminalState(source), port = h.graph.view.getTerminalPort(state, terminal, source); // NEW
        const constraint = h.graph.getConnectionConstraint(state, terminal, source), fixed = h.graph.getConnectionPoint(port, constraint, false); // NEW
        assert.ok(fixed, 'must have a fixed anchor: ' + edge.style); // NEW
        const actual = points[source ? 0 : points.length - 1]; near(actual.x, fixed.x); near(actual.y, fixed.y); // NEW
    } // NEW
} // NEW
function cleanU(h, edge, axis, bar) { // NEW
    const pts = h.points(edge), other = axis === 'y' ? 'x' : 'y'; // NEW
    assert.equal(pts.length, 4, JSON.stringify(pts)); // NEW
    near(pts[0][other], pts[1][other], 'source leg'); near(pts[2][other], pts[3][other], 'target leg'); // NEW
    near(pts[1][axis], bar, 'crossbar'); near(pts[2][axis], bar, 'crossbar'); anchored(h, edge); // NEW
} // NEW

const orientations = { // NEW
    bottom: { a: [100, 100], b: [400, 100], bends: [[160, 280], [460, 280]], axis: 'y', bar: 280 }, // NEW
    top: { a: [100, 220], b: [400, 220], bends: [[160, 100], [460, 100]], axis: 'y', bar: 100 }, // NEW
    right: { a: [100, 100], b: [100, 350], bends: [[320, 130], [320, 380]], axis: 'x', bar: 320 }, // NEW
    left: { a: [300, 100], b: [300, 350], bends: [[180, 130], [180, 380]], axis: 'x', bar: 180 } // NEW
}; // NEW

for (const [name, spec] of Object.entries(orientations)) test(`new ${name} U preserves both legs at multiple zoom levels`, t => { // NEW
    const h = harness(t), a = h.vertex(...spec.a), b = h.vertex(...spec.b), edge = h.edge(a, b, spec.bends); // NEW
    enrolled(h, edge); cleanU(h, edge, spec.axis, spec.bar); // NEW
    for (const scale of [0.5, 1, 2.95]) { // NEW
        h.graph.view.scaleAndTranslate(scale, 17, -9); // NEW
        h.graph.moveCells([b], 25, 15); cleanU(h, edge, spec.axis, spec.bar); // NEW
        h.graph.moveCells([a], -20, -10); cleanU(h, edge, spec.axis, spec.bar); // NEW
    } // NEW
}); // NEW

test('one movement and its route repair undo and redo together', t => { // NEW
    const h = harness(t), a = h.vertex(100, 100), b = h.vertex(400, 100), edge = h.edge(a, b, orientations.bottom.bends); // NEW
    h.undo.clear(); const before = h.xml(); // NEW
    h.graph.moveCells([b], 35, 25); const after = h.xml(); // NEW
    assert.equal(h.undo.history.length, 1); cleanU(h, edge, 'y', 280); // NEW
    h.undo.undo(); assert.equal(h.xml(), before); h.undo.redo(); assert.equal(h.xml(), after); cleanU(h, edge, 'y', 280); // NEW
}); // NEW

test('creation enrolls and infers both anchors in one undo edit', t => { // NEW
    const h = harness(t), a = h.vertex(100, 100), b = h.vertex(400, 100); h.undo.clear(); // NEW
    const before = h.xml(), edge = h.edge(a, b, orientations.bottom.bends), after = h.xml(); // NEW
    assert.equal(h.undo.history.length, 1); enrolled(h, edge); anchored(h, edge); // NEW
    h.undo.undo(); assert.equal(h.xml(), before); h.undo.redo(); assert.equal(h.xml(), after); // NEW
}); // NEW

test('legacy edges keep floating behavior through install, movement and undo replay', t => { // NEW
    const h = harness(t, false), a = h.vertex(100, 100), b = h.vertex(400, 100), edge = h.edge(a, b, orientations.bottom.bends); // NEW
    const originalStyle = edge.style; h.load(); h.graph.moveCells([b], 30, 0); // NEW
    assert.equal(edge.style, originalStyle); near(h.points(edge).at(-1).x, 460, 'legacy waypoint still controls endpoint'); // NEW
    h.undo.undo(); h.undo.redo(); assert.equal(edge.style, originalStyle); // NEW
}); // NEW

test('a common move translates the crossbar once, including nested groups', t => { // NEW
    const h = harness(t), outer = h.graph.insertVertex(null, null, '', 50, 60, 800, 600), inner = h.graph.insertVertex(outer, null, '', 20, 30, 650, 450); // NEW
    const a = h.vertex(100, 100, inner), b = h.vertex(400, 100, inner), edge = h.edge(a, b, orientations.bottom.bends, '', inner); // NEW
    h.graph.moveCells([a, b], 20, 25); cleanU(h, edge, 'y', 395); // NEW
    h.graph.moveCells([outer], 40, 35); cleanU(h, edge, 'y', 430); // NEW
    const before = h.points(edge); h.graph.moveCells([inner], 15, 20); const after = h.points(edge); // NEW
    before.forEach((p, i) => { near(after[i].x, p.x + 15); near(after[i].y, p.y + 20); }); // NEW
}); // NEW

test('explicit off-center points and offset constraints survive resize and movement', t => { // NEW
    const h = harness(t), a = h.vertex(100, 100), b = h.vertex(400, 100); // NEW
    const style = 'exitX=0.25;exitY=1;exitDx=3;exitDy=0;exitPerimeter=0;entryX=0.75;entryY=1;entryDx=-2;entryDy=0;entryPerimeter=0;'; // NEW
    const edge = h.edge(a, b, [[133, 280], [488, 280]], style), original = h.graph.getCurrentCellStyle(edge); // NEW
    h.graph.resizeCells([b], [new h.w.mxRectangle(400, 100, 180, 90)]); cleanU(h, edge, 'y', 280); // NEW
    h.graph.moveCells([a], 20, 15); cleanU(h, edge, 'y', 280); // NEW
    const current = h.graph.getCurrentCellStyle(edge); // NEW
    for (const key of ['exitX', 'exitY', 'exitDx', 'exitDy', 'exitPerimeter', 'entryX', 'entryY', 'entryDx', 'entryDy', 'entryPerimeter']) assert.equal(current[key], original[key], key); // NEW
}); // NEW

test('crossing the crossbar extends the U outward instead of reversing its legs', t => { // NEW
    const h = harness(t), a = h.vertex(100, 100), b = h.vertex(400, 100), edge = h.edge(a, b, orientations.bottom.bends); // NEW
    h.graph.moveCells([b], 20, 200); // NEW
    const pts = h.points(edge); assert.equal(pts.length, 4); assert.ok(pts[1].y > pts[0].y && pts[2].y > pts[3].y); anchored(h, edge); // NEW
}); // NEW

test('model-added edges, pasted diagrams and duplicate groups enroll, but reparenting does not enroll old edges', t => { // NEW
    const h = harness(t, false), a = h.vertex(100, 100), b = h.vertex(400, 100), legacy = h.edge(a, b, orientations.bottom.bends); h.load(); // NEW
    const group = h.graph.insertVertex(null, null, '', 0, 0, 800, 500), style = legacy.style; // NEW
    h.graph.addCells([legacy], group); assert.equal(legacy.style, style); // NEW
    const direct = new h.w.mxCell('', new h.w.mxGeometry(), 'edgeStyle=orthogonalEdgeStyle;'); direct.setEdge(true); direct.geometry.relative = true; // NEW
    h.transaction(() => { h.model.add(h.graph.getDefaultParent(), direct); h.model.setTerminal(direct, a, true); h.model.setTerminal(direct, b, false); }); enrolled(h, direct); anchored(h, direct); // NEW
    const clones = h.graph.importCells([a, b, legacy], 20, 20); const pasted = clones.find(cell => h.model.isEdge(cell)); enrolled(h, pasted); anchored(h, pasted); // NEW
    const newGroup = h.graph.insertVertex(null, null, '', 0, 0, 800, 500), c = h.vertex(100, 100, newGroup), d = h.vertex(400, 100, newGroup); // NEW
    h.edge(c, d, orientations.bottom.bends, '', newGroup); // NEW
    const duplicated = h.graph.moveCells([newGroup], 30, 30, true)[0]; // NEW
    const duplicateEdge = h.model.getChildCells(duplicated, false, true)[0]; enrolled(h, duplicateEdge); anchored(h, duplicateEdge); // NEW
}); // NEW

test('save/reopen preserves participation without enrolling older document edges', t => { // NEW
    const h = harness(t, false), a = h.vertex(100, 100), b = h.vertex(400, 100), legacy = h.edge(a, b, orientations.bottom.bends); h.load(); // NEW
    const modern = h.edge(a, b, orientations.bottom.bends), document = h.w.mxUtils.parseXml(h.xml()); // NEW
    const restored = new h.w.mxGraphModel(); new h.w.mxCodec(document).decode(document.documentElement, restored); // NEW
    h.model.setRoot(restored.getRoot()); // NEW
    const oldEdge = h.model.getCell(legacy.id), newEdge = h.model.getCell(modern.id), target = h.model.getCell(b.id); // NEW
    assert.equal(oldEdge.style, legacy.style); enrolled(h, newEdge); // NEW
    h.graph.moveCells([target], 30, 20); cleanU(h, newEdge, 'y', 280); assert.equal(oldEdge.style, legacy.style); // NEW
}); // NEW

test('reconnecting an enrolled endpoint onto a shape body fixes the newly chosen position', t => { // NEW
    const h = harness(t), a = h.vertex(100, 100), b = h.vertex(400, 100), c = h.vertex(600, 100), edge = h.edge(a, b, orientations.bottom.bends); // NEW
    h.undo.clear(); h.graph.connectCell(edge, c, false, new h.w.mxConnectionConstraint()); // NEW
    assert.equal(h.undo.history.length, 1); enrolled(h, edge); anchored(h, edge); // NEW
    const state = h.graph.view.getState(edge), constraint = h.graph.getConnectionConstraint(state, state.visibleTargetState, false); // NEW
    const before = [constraint.point.x, constraint.point.y]; h.graph.moveCells([c], 15, 5); // NEW
    const after = h.graph.getConnectionConstraint(h.graph.view.getState(edge), h.graph.view.getState(c), false); // NEW
    assert.deepEqual([after.point.x, after.point.y], before); anchored(h, edge); // NEW
}); // NEW

test('drag preview uses committed routing without writing model or undo, and cancellation restores it', t => { // NEW
    const h = harness(t), a = h.vertex(100, 100), b = h.vertex(400, 100), edge = h.edge(a, b, orientations.bottom.bends); // NEW
    const handler = h.graph.graphHandler; handler.guidesEnabled = false; // NEW
    h.undo.clear(); const before = h.xml(); handler.start(b, 460, 130, [b]); // NEW
    handler.livePreviewUsed = true; handler.livePreviewActive = true; handler.updateLivePreview(35, 25); // NEW
    const preview = Array.from(h.graph.view.getState(edge).shape.points, p => ({ x: p.x, y: p.y })); // NEW
    assert.equal(h.xml(), before); assert.equal(h.undo.history.length, 0); // NEW
    handler.reset(); assert.equal(h.xml(), before); cleanU(h, edge, 'y', 280); // NEW
    h.graph.moveCells([b], 35, 25); const committed = h.points(edge); // NEW
    assert.equal(preview.length, committed.length); preview.forEach((p, i) => { near(p.x, committed[i].x); near(p.y, committed[i].y); }); // NEW
}); // NEW

test('explicit bend editing stays editable, and straight/L edges retain their route shape', t => { // NEW
    const h = harness(t), a = h.vertex(100, 100), b = h.vertex(400, 100), edge = h.edge(a, b, orientations.bottom.bends); // NEW
    const geometry = edge.geometry.clone(); geometry.points = [h.point(160, 320), h.point(460, 320)]; h.model.setGeometry(edge, geometry); cleanU(h, edge, 'y', 320); // NEW
    h.graph.moveCells([b], 20, 10); cleanU(h, edge, 'y', 320); // NEW
    const straight = h.edge(a, b, null); anchored(h, straight); const points = straight.geometry.points; // NEW
    h.graph.moveCells([b], 10, 5); assert.equal(straight.geometry.points, points); anchored(h, straight); // NEW
    const c = h.vertex(500, 400), elbow = h.edge(a, c, [[160, 430]]), elbowPoints = JSON.stringify(elbow.geometry.points); // NEW
    h.graph.moveCells([c], 10, 10); assert.equal(JSON.stringify(elbow.geometry.points), elbowPoints); anchored(h, elbow); // NEW
}); // NEW

test('dangling endpoints become fixed only when connected, including reattaching to the same shape', t => { // NEW
    const h = harness(t), a = h.vertex(100, 100), b = h.vertex(400, 100); // NEW
    const edge = h.transaction(() => { // NEW
        const cell = h.edge(a, null, [[160, 280]]), geo = cell.geometry.clone(); geo.setTerminalPoint(h.point(460, 280), false); h.model.setGeometry(cell, geo); return cell; // NEW
    }); // NEW
    enrolled(h, edge); assert.equal(h.graph.getCurrentCellStyle(edge).entryX, undefined); // NEW
    h.graph.connectCell(edge, b, false, new h.w.mxConnectionConstraint()); anchored(h, edge); // NEW
    h.graph.connectCell(edge, b, false, new h.w.mxConnectionConstraint()); anchored(h, edge); // NEW
}); // NEW

test('hidden terminal inference waits for expansion, including save and reopen while collapsed', t => { // NEW
    const h = harness(t), group = h.graph.insertVertex(null, null, '', 50, 50, 700, 400), a = h.vertex(100, 100, group), b = h.vertex(850, 100); // NEW
    h.model.setCollapsed(group, true); const edge = h.edge(a, b, [[210, 500], [910, 500]]); enrolled(h, edge); // NEW
    assert.equal(h.graph.getCurrentCellStyle(edge).exitX, undefined, 'do not pin to the collapsed ancestor'); // NEW
    const document = h.w.mxUtils.parseXml(h.xml()), restored = new h.w.mxGraphModel(); new h.w.mxCodec(document).decode(document.documentElement, restored); h.model.setRoot(restored.getRoot()); // NEW
    const reopened = h.model.getCell(edge.id); h.model.setCollapsed(h.model.getCell(group.id), false); anchored(h, reopened); // NEW
}); // NEW

test('explicit ports and transforms preserve constraints and attachment coordinates', t => { // NEW
    const h = harness(t), parent = h.graph.insertVertex(null, null, '', 100, 100, 180, 100), b = h.vertex(500, 100); // NEW
    const port = h.graph.insertVertex(parent, 'port', '', 0.5, 1, 10, 10, 'shape=ellipse;', true); // NEW
    const edge = h.edge(parent, b, [[195, 300], [560, 300]], 'sourcePort=port;exitX=0.5;exitY=0.5;exitPerimeter=0;entryX=0.5;entryY=1;entryPerimeter=0;'); // NEW
    const before = edge.style; h.graph.moveCells([parent], 25, 15); anchored(h, edge); assert.equal(edge.style, before); // NEW
    for (const [key, value] of [['rotation', '90'], ['flipH', '1'], ['flipV', '1']]) { // NEW
        h.graph.setCellStyles(key, value, [parent, b]); h.graph.moveCells([b], 15, 10); anchored(h, edge); assert.equal(edge.style, before); // NEW
    } // NEW
}); // NEW

test('self-loop anchors preserve the initial rendered loop and remain attached after movement', t => { // NEW
    const h = harness(t), a = h.vertex(300, 200); // NEW
    let before; const edge = h.transaction(() => { // NEW
        const cell = h.graph.insertEdge(null, null, '', a, a, 'edgeStyle=orthogonalEdgeStyle;orthogonalLoop=1;'); h.graph.view.validate(); before = h.points(cell); return cell; // NEW
    }); // NEW
    enrolled(h, edge); const after = h.points(edge); assert.equal(after.length, before.length); before.forEach((p, i) => { near(after[i].x, p.x); near(after[i].y, p.y); }); anchored(h, edge); // NEW
    h.graph.moveCells([a], 30, 20); anchored(h, edge); const moved = h.points(edge); after.forEach((p, i) => { near(moved[i].x, p.x + 30); near(moved[i].y, p.y + 20); }); // NEW
}); // NEW

test('resize preview matches commit and remains outside undo history', t => { // NEW
    const h = harness(t), a = h.vertex(100, 100), b = h.vertex(400, 100), edge = h.edge(a, b, orientations.bottom.bends); // NEW
    const handler = h.graph.createVertexHandler(h.graph.view.getState(b)); t.after(() => handler.destroy()); // NEW
    handler.livePreview = true; handler.start(520, 160, 7); handler.bounds = new h.w.mxRectangle(400, 100, 180, 90); // NEW
    h.undo.clear(); const before = h.xml(); handler.updateLivePreview(); // NEW
    const preview = Array.from(h.graph.view.getState(edge).shape.points, p => ({ x: p.x, y: p.y })); // NEW
    assert.equal(h.xml(), before); assert.equal(h.undo.history.length, 0); // NEW
    h.graph.fireEvent(new h.w.mxEventObject(h.w.mxEvent.ESCAPE)); // NEW
    h.graph.resizeCells([b], [new h.w.mxRectangle(400, 100, 180, 90)]); const committed = h.points(edge); // NEW
    assert.equal(preview.length, committed.length); preview.forEach((p, i) => { near(p.x, committed[i].x); near(p.y, committed[i].y); }); // NEW
}); // NEW

test('multi-selection preview and nested group preview match a single committed translation', t => { // NEW
    for (const grouped of [false, true]) { // NEW
        const h = harness(t), group = grouped ? h.graph.insertVertex(null, null, '', 50, 60, 800, 500) : null; // NEW
        const a = h.vertex(100, 100, group), b = h.vertex(400, 100, group), edge = h.edge(a, b, orientations.bottom.bends, '', group), cells = grouped ? [group] : [a, b]; // NEW
        const handler = h.graph.graphHandler; handler.guidesEnabled = false; handler.start(cells[0], 150, 150, cells); handler.livePreviewUsed = true; // NEW
        handler.updateLivePreview(35, 25); const preview = Array.from(h.graph.view.getState(edge).shape.points, p => ({ x: p.x, y: p.y })); handler.reset(); // NEW
        h.graph.moveCells(cells, 35, 25); const committed = h.points(edge); // NEW
        assert.equal(preview.length, committed.length); preview.forEach((p, i) => { near(p.x, committed[i].x); near(p.y, committed[i].y); }); // NEW
    } // NEW
}); // NEW

test('no-op movement and repeated installation do not create geometry edits or shared overrides', t => { // NEW
    const h = harness(t), a = h.vertex(100, 100), b = h.vertex(400, 100); h.edge(a, b, orientations.bottom.bends); // NEW
    h.undo.clear(); const before = h.xml(), move = h.graph.cellsMoved, update = h.graph.view.updatePoints; h.load(); // NEW
    assert.equal(h.graph.cellsMoved, move); assert.equal(h.graph.view.updatePoints, update); h.graph.cellsMoved([b], 0, 0); // NEW
    assert.equal(h.xml(), before); assert.equal(h.undo.history.length, 0); // NEW
    const other = new h.w.Graph(h.w.document.createElement('div')); assert.equal(other.view.updatePoints, h.w.mxGraphView.prototype.updatePoints); other.destroy(); // NEW
}); // NEW

test('the native connection handler pins a hand-drawn connection in its creation undo edit', t => { // NEW
    const h = harness(t), a = h.vertex(100, 100), b = h.vertex(400, 100), handler = h.graph.connectionHandler; // NEW
    handler.previous = h.graph.view.getState(a); handler.first = h.point(220, 130); handler.currentPoint = h.point(400, 130); // NEW
    handler.sourceConstraint = new h.w.mxConnectionConstraint(h.point(1, 0.5), true); handler.constraintHandler.currentConstraint = null; // NEW
    h.undo.clear(); handler.connect(a, b, new h.w.MouseEvent('mouseup', { clientX: 400, clientY: 130 }), null); // NEW
    const edges = h.model.getChildCells(h.graph.getDefaultParent(), false, true); assert.equal(edges.length, 1); // NEW
    const edge = edges[0]; enrolled(h, edge); anchored(h, edge); assert.equal(h.undo.history.length, 1); // NEW
    assert.equal(h.graph.getCurrentCellStyle(edge).exitX, 1); assert.equal(h.graph.getCurrentCellStyle(edge).exitY, 0.5); // NEW
}); // NEW

test('inferred anchors on rotated and flipped shapes retain their initially rendered attachment', t => { // NEW
    for (const transform of ['rotation=90;', 'rotation=30;', 'flipH=1;', 'flipV=1;', 'direction=north;flipH=1;']) { // NEW
        const h = harness(t), a = h.vertex(100, 100, null, transform), b = h.vertex(400, 100, null, transform); // NEW
        let initial; const edge = h.transaction(() => { // NEW
            const cell = h.graph.insertEdge(null, null, '', a, b, 'edgeStyle=orthogonalEdgeStyle;'); h.graph.view.validate(); initial = h.points(cell); return cell; // NEW
        }); // NEW
        const after = h.points(edge); near(after[0].x, initial[0].x, transform); near(after[0].y, initial[0].y, transform); near(after.at(-1).x, initial.at(-1).x, transform); near(after.at(-1).y, initial.at(-1).y, transform); // NEW
        h.graph.moveCells([b], 20, 15); anchored(h, edge); // NEW
    } // NEW
}); // NEW

const sideVectors = { west: [-1, 0], east: [1, 0], north: [0, -1], south: [0, 1] }; // NEW
const sidePoints = { west: [0, 0.5], east: [1, 0.5], north: [0.5, 0], south: [0.5, 1] }; // NEW

/** Drive the real hover/connection handlers; capture the last preview before committing through native insertion. */ // NEW
function drawn(h, source, target, departure, arrival, bends, commit = true) { // NEW
    const handler = h.graph.connectionHandler, hover = h.ui.hoverIcons, state = h.graph.view.getState(source); // NEW
    hover.currentState = state; hover.activeArrow = { west: hover.arrowLeft, east: hover.arrowRight, north: hover.arrowUp, south: hover.arrowDown }[departure]; // NEW
    hover.drag(new h.w.MouseEvent('mousedown'), state.getCenterX(), state.getCenterY()); // NEW
    handler.currentState = h.graph.view.getState(target); handler.currentPoint = h.point(handler.currentState.getCenterX(), handler.currentState.getCenterY()); // NEW
    const constraint = arrival ? new h.w.mxConnectionConstraint(h.point(...sidePoints[arrival]), false) : null; // NEW
    handler.constraintHandler.currentConstraint = constraint; handler.constraintHandler.currentFocus = constraint ? handler.currentState : null; // NEW
    handler.waypoints = bends ? h.w.Array.from(bends, p => h.point((p[0] + h.graph.view.translate.x) * h.graph.view.scale, (p[1] + h.graph.view.translate.y) * h.graph.view.scale)) : null; // NEW
    handler.updateEdgeState(handler.currentPoint, constraint); // NEW
    const preview = Array.from(handler.edgeState.absolutePoints, p => ({ x: p.x, y: p.y })); // NEW
    if (!commit) return { preview, handler }; // NEW
    handler.connect(source, target, new h.w.MouseEvent('mouseup'), null); // NEW
    const edge = h.graph.getSelectionCell(); handler.reset(); return { edge, preview }; // NEW
} // NEW

function outward(h, edge, source, side) { // NEW
    const pts = h.points(edge), p = source ? pts[0] : pts.at(-1), q = source ? pts[1] : pts.at(-2), vector = sideVectors[side]; // NEW
    near(vector[0] ? p.y : p.x, vector[0] ? q.y : q.x, side + ' perpendicular departure'); // NEW
    assert.ok((q.x - p.x) * vector[0] + (q.y - p.y) * vector[1] >= 9.8, side + ' must have outward clearance: ' + JSON.stringify(pts)); // NEW
} // NEW

for (const departure of Object.keys(sideVectors)) test(`ordinary ${departure} hover-arrow drag preserves its source side without modifier keys`, t => { // NEW
    const h = harness(t), source = h.vertex(400, 300), target = h.vertex(100, 100); h.undo.clear(); // NEW
    const { edge, preview } = drawn(h, source, target, departure, null, [[460, 500], [160, 500]]); // NEW
    const style = h.graph.getCurrentCellStyle(edge); enrolled(h, edge); anchored(h, edge); // NEW
    assert.equal(style.sourcePortConstraint, departure); assert.equal(style.targetPortConstraint, undefined); // NEW
    near(style.exitX, sidePoints[departure][0]); near(style.exitY, sidePoints[departure][1]); outward(h, edge, true, departure); // NEW
    const committed = h.graph.view.getState(edge).absolutePoints; assert.equal(committed.length, preview.length); preview.forEach((p, i) => { near(committed[i].x, p.x); near(committed[i].y, p.y); }); // NEW
    assert.equal(h.undo.history.length, 1); // NEW
}); // NEW

test('both explicitly chosen sides survive conflicting waypoints, save/reopen and movement', t => { // NEW
    const h = harness(t), source = h.vertex(400, 300), target = h.vertex(100, 100); // NEW
    const { edge } = drawn(h, source, target, 'west', 'south', [[400, 550], [160, 550]]); // NEW
    outward(h, edge, true, 'west'); outward(h, edge, false, 'south'); // NEW
    h.graph.moveCells([source], 20, 15); outward(h, edge, true, 'west'); outward(h, edge, false, 'south'); // NEW
    assert.ok(h.points(edge).some(p => Math.abs(p.y - 550) < 0.15), 'keep the U crossbar'); // NEW
    const document = h.w.mxUtils.parseXml(h.xml()), restored = new h.w.mxGraphModel(); new h.w.mxCodec(document).decode(document.documentElement, restored); h.model.setRoot(restored.getRoot()); // NEW
    const reopened = h.model.getCell(edge.id); outward(h, reopened, true, 'west'); outward(h, reopened, false, 'south'); // NEW
    h.graph.moveCells([h.model.getCell(target.id)], 25, 20); outward(h, reopened, true, 'west'); outward(h, reopened, false, 'south'); // NEW
}); // NEW

test('canceling a hover drag and changing arrival targets does not leak direction into later gestures', t => { // NEW
    const h = harness(t), source = h.vertex(400, 300), target = h.vertex(100, 100); h.undo.clear(); const before = h.xml(); // NEW
    const { handler } = drawn(h, source, target, 'west', 'south', null, false); // NEW
    handler.constraintHandler.currentConstraint = null; handler.updateEdgeState(handler.currentPoint, null); assert.equal(handler.edgeState.style.targetPortConstraint, undefined); // NEW
    handler.reset(); assert.equal(h.xml(), before); assert.equal(h.undo.history.length, 0); // NEW
    const { edge } = drawn(h, source, target, 'north', null, null); // NEW
    assert.equal(h.graph.getCurrentCellStyle(edge).sourcePortConstraint, 'north'); assert.equal(h.graph.getCurrentCellStyle(edge).targetPortConstraint, undefined); outward(h, edge, true, 'north'); // NEW
}); // NEW

test('explicit off-center drag points keep their point and side instead of snapping to the center', t => { // NEW
    const h = harness(t), source = h.vertex(400, 300), target = h.vertex(100, 100), handler = h.graph.connectionHandler; // NEW
    handler.start(h.graph.view.getState(source), 400, 312); handler.sourceConstraint = new h.w.mxConnectionConstraint(h.point(0, 0.2), false); // NEW
    handler.currentState = h.graph.view.getState(target); handler.currentPoint = h.point(160, 160); handler.constraintHandler.currentConstraint = new h.w.mxConnectionConstraint(h.point(0.8, 1), false); // NEW
    handler.updateEdgeState(handler.currentPoint, handler.constraintHandler.currentConstraint); handler.connect(source, target, new h.w.MouseEvent('mouseup'), null); // NEW
    const edge = h.graph.getSelectionCell(), style = h.graph.getCurrentCellStyle(edge); near(style.exitY, 0.2); near(style.entryX, 0.8); // NEW
    assert.equal(style.sourcePortConstraint, 'west'); assert.equal(style.targetPortConstraint, 'south'); outward(h, edge, true, 'west'); outward(h, edge, false, 'south'); anchored(h, edge); // NEW
}); // NEW

test('native endpoint reconnection replaces direction intent and body reconnection clears it in the same undo edit', t => { // NEW
    const h = harness(t), source = h.vertex(400, 300), target = h.vertex(100, 100), other = h.vertex(650, 200); // NEW
    const { edge } = drawn(h, source, target, 'west', 'south', [[400, 550], [160, 550]]); // NEW
    const handler = h.graph.createEdgeHandler(h.graph.view.getState(edge), h.w.mxEdgeStyle.OrthConnector); t.after(() => handler.destroy()); // NEW
    handler.getConstraintHandler().currentConstraint = new h.w.mxConnectionConstraint(h.point(1, 0.5), false); // NEW
    h.undo.clear(); handler.connect(edge, other, true, false, null); assert.equal(h.undo.history.length, 1); // NEW
    assert.equal(h.graph.getCurrentCellStyle(edge).sourcePortConstraint, 'east'); assert.equal(h.graph.getCurrentCellStyle(edge).targetPortConstraint, 'south'); outward(h, edge, true, 'east'); // NEW
    h.undo.undo(); assert.equal(h.graph.getCurrentCellStyle(edge).sourcePortConstraint, 'west'); h.undo.redo(); // NEW
    handler.getConstraintHandler().currentConstraint = null; handler.connect(edge, target, false, false, null); // NEW
    assert.equal(h.graph.getCurrentCellStyle(edge).targetPortConstraint, undefined); assert.equal(h.graph.getCurrentCellStyle(edge).sourcePortConstraint, 'east'); // NEW
}); // NEW

test('side intent follows rotation and flipping and retains clearance at fractional zoom', t => { // NEW
    const h = harness(t), source = h.vertex(400, 300), target = h.vertex(100, 100); // NEW
    const { edge } = drawn(h, source, target, 'west', 'south', [[400, 550], [160, 550]]), style = edge.style; // NEW
    h.graph.setCellStyles('rotation', '90', [source]); outward(h, edge, true, 'north'); // NEW
    h.graph.setCellStyles('flipH', '1', [source]); outward(h, edge, true, 'south'); // NEW
    for (const scale of [0.5, 1.45, 2.95]) { // NEW
        h.graph.view.scaleAndTranslate(scale, 13, -7); h.graph.moveCells([source], 20, 10); // NEW
        outward(h, edge, true, 'south'); outward(h, edge, false, 'south'); anchored(h, edge); assert.equal(edge.style, style, 'rendering resolves transforms without rewriting side styles'); // NEW
    } // NEW
}); // NEW

test('reconnection preview matches commit without changing the live edge or undo history', t => { // NEW
    const h = harness(t), source = h.vertex(400, 300), target = h.vertex(100, 100), other = h.vertex(650, 200); // NEW
    const { edge } = drawn(h, source, target, 'west', 'south', [[400, 550], [160, 550]]); // NEW
    const handler = h.graph.createEdgeHandler(h.graph.view.getState(edge), h.w.mxEdgeStyle.OrthConnector); t.after(() => handler.destroy()); // NEW
    handler.isSource = true; handler.isTarget = false; handler.points = edge.geometry.points; // NEW
    const constraint = new h.w.mxConnectionConstraint(h.point(1, 0.5), false); handler.getConstraintHandler().currentConstraint = constraint; // NEW
    const state = handler.state.clone(), terminal = h.graph.view.getState(other), point = h.point(770, 230); // NEW
    h.undo.clear(); const before = h.xml(), me = new h.w.mxMouseEvent(new h.w.MouseEvent('mousemove'), terminal); // NEW
    handler.updatePreviewState(state, point, terminal, me, false); // NEW
    const preview = Array.from(state.absolutePoints, p => ({ x: p.x, y: p.y })); assert.equal(h.xml(), before); assert.equal(h.undo.history.length, 0); // NEW
    handler.abspoints = state.absolutePoints; handler.connect(edge, other, true, false, me); // NEW
    const committed = h.points(edge); assert.equal(preview.length, committed.length); preview.forEach((p, i) => { near(committed[i].x, p.x); near(committed[i].y, p.y); }); // NEW
}); // NEW

test('a new edge with a declared port restriction honors that restriction while keeping explicit port coordinates', t => { // NEW
    const h = harness(t), source = h.vertex(400, 300, null, 'portConstraint=west;'), target = h.vertex(100, 100); // NEW
    const { edge } = drawn(h, source, target, 'west', 'south', [[400, 550], [160, 550]]); // NEW
    outward(h, edge, true, 'west'); outward(h, edge, false, 'south'); // NEW
    assert.equal(h.graph.getCurrentCellStyle(source).portConstraint, 'west'); anchored(h, edge); // NEW
}); // NEW

test('legacy explicit direction styles remain native until their edge is duplicated', t => { // NEW
    const h = harness(t, false), source = h.vertex(400, 300), target = h.vertex(100, 100); // NEW
    const legacy = h.edge(source, target, [[400, 550], [160, 550]], 'sourcePortConstraint=west;exitX=0;exitY=0.5;entryX=0.5;entryY=1;'); // NEW
    const before = h.points(legacy); h.load(); assert.deepEqual(h.points(legacy), before); // NEW
    const clones = h.graph.importCells([source, target, legacy], 20, 20), edge = clones.find(cell => h.model.isEdge(cell)); enrolled(h, edge); outward(h, edge, true, 'west'); // NEW
}); // NEW
