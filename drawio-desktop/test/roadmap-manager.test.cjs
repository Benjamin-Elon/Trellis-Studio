const test = require('node:test'); // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const { JSDOM } = require('jsdom'); // NEW
const webapp = path.resolve(__dirname, '../drawio/src/main/webapp'); // NEW

/** Exercise production mxGraph model, codecs, view and undo; only desktop dialogs are stubbed. */ // NEW
function harness(t, extraPlugins = []) {
    const dom = new JSDOM('<!doctype html><html><body><div id="graph" style="width:1000px;height:700px;position:relative"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    t.after(() => dom.window.close()); // NEW: dispose timers even when setup fails.
    w.mxLoadResources = false; w.mxLoadStylesheets = false;
    w.HTMLCanvasElement.prototype.getContext = () => ({ fillStyle: '#000000', fillRect() {}, getImageData: () => ({ data: [0, 0, 0, 255] }) }); // CHANGE: Graph resolves CSS colors through canvas; diagram rendering remains SVG.
    w.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 50, height: 16 });
    w.eval(fs.readFileSync(path.join(webapp, 'mxgraph/mxClient.js'), 'utf8'));
    w.urlParams = { grid: '0' }; w.DOM_PURIFY_CONFIG = {}; w.Editor = function () {}; w.EditorUi = function () {}; // NEW: shell constructors; graph behavior is production Draw.io.
    w.eval(fs.readFileSync(path.join(webapp, 'js/sanitizer/purify.min.js'), 'utf8')); // NEW
    w.eval(fs.readFileSync(path.join(webapp, 'js/grapheditor/Graph.js'), 'utf8')); // NEW
    const graph = new w.Graph(w.document.getElementById('graph'));
    graph.isSpecialColor = () => -1; // NEW: Draw.io color-placeholder adapter; geometry/model/view remain production mxGraph.
    const model = graph.getModel(), alerts = [], dialogs = [], undo = new w.mxUndoManager();
    model.addListener(w.mxEvent.UNDO, (_sender, event) => undo.undoableEditHappened(event.getProperty('edit')));
    const actions = new Map();
    const ui = { editor: { graph, getGraphXml: () => new w.mxCodec().encode(model) }, alert: message => alerts.push(message), showDialog: body => { dialogs.push(body); w.document.body.appendChild(body); }, hideDialog: () => { dialogs.forEach(body => body.remove()); dialogs.length = 0; }, actions: { get: key => actions.get(key) || { funct() {} }, addAction: (key, fn) => { const action = { funct: fn }; actions.set(key, action); return action; } }, menus: { createPopupMenu() {}, get: () => ({ funct() {} }) }, format: { refresh() {} } };
    w.Draw = { loadPlugin: fn => fn(ui) };
    w.ExportDialog = { exportFile(editorUi) { return editorUi.editor.getGraphXml(); } };
    const load = name => w.eval(fs.readFileSync(path.join(webapp, 'plugins/garden_planner_plugins', name), 'utf8'));
    load('Garden_Roadmap_Core.js'); // CHANGE: core registers native roadmap rendering.
    extraPlugins.filter(name => ['Trellis_Users.js', 'Garden_Task_Manager.js'].includes(name)).forEach(load); // NEW
    load('Garden_Roadmap_Manager.js'); extraPlugins.filter(name => !['Trellis_Users.js', 'Garden_Task_Manager.js'].includes(name)).forEach(load); // CHANGE
    function cell(parent, attrs, style) { const value = w.mxUtils.createXmlDocument().createElement('object'); Object.entries(attrs).forEach(([key, val]) => value.setAttribute(key, String(val))); return graph.insertVertex(parent || graph.getDefaultParent(), null, value, 20, 20, 300, 200, style || ''); }
    const module = cell(null, { label: 'Roadmaps', roadmap_type: 'module', roadmap_module: '1' }, 'module=1;container=1;');
    const api = graph.__trellisRoadmapManager;
    const board = api.ensureMainRoadmapInRoadmapModule(module);
    const typed = (parent, kind) => (model.getChildren(parent) || []).filter(child => child.getAttribute('roadmap_type') === kind);
    const process = board && typed(board, 'process')[0], object = process && typed(process, 'object')[0];
    const xml = () => w.mxUtils.getXml(ui.editor.getGraphXml());
    return { w, graph, model, api, module, board, process, object, alerts, dialogs, undo, typed, cell, ui, xml, load };
}

function frame(h) { return new Promise(resolve => h.w.requestAnimationFrame(resolve)); } // NEW
function roadmapNameInputs(h) { return Array.from(h.graph.container.querySelectorAll('.trellis-roadmap-control input[aria-label="Name"]')); } // NEW
function roadmapNameInputFor(h, cell) { return roadmapNameInputs(h).find(input => input.value === cell.getAttribute('label')); } // NEW
function styleValue(style, key) { return style && typeof style === 'object' ? style[key] : (String(style || '').match(new RegExp('(?:^|;)' + key + '=([^;]*)(?=;|$)')) || [])[1]; } // NEW
function callRecordingCanvas() { const calls = []; let fillColor = null, strokeColor = null; return { calls, setFillColor(color) { fillColor = color; calls.push(['setFillColor', color]); }, setStrokeColor(color) { strokeColor = color; calls.push(['setStrokeColor', color]); }, rect(x, y, width, height) { calls.push(['rect', x, y, width, height]); }, roundrect(x, y, width, height, arcWidth, arcHeight) { calls.push(['roundrect', x, y, width, height, arcWidth, arcHeight]); }, begin() { calls.push(['begin']); }, moveTo(x, y) { calls.push(['moveTo', x, y]); }, lineTo(x, y) { calls.push(['lineTo', x, y]); }, quadTo() { calls.push(['quadTo']); }, close() { calls.push(['close']); }, fillAndStroke() { calls.push(['fillAndStroke', fillColor, strokeColor]); } }; } // CHANGE
function graphButton(h, text) { return Array.from(h.graph.container.querySelectorAll('button')).find(button => button.textContent === text); } // NEW
const THIS_WEEK_DAY_PX = 400 / 7; // NEW
const BOUNDARY_SCALES = [0.31, 0.73, 5, 11, 2, 6, 1.3, 0.42]; // NEW
function relativeHintText(c, day) { const offset = day - c.todayDay(); return offset === 0 ? 'today' : Math.abs(offset) + ' ' + (Math.abs(offset) === 1 ? 'day' : 'days') + (offset > 0 ? ' from now' : ' ago'); } // NEW
function expectedDragHint(c, dates, edge) { const day = edge === 'right' ? dates.end : dates.start, duration = dates.end - dates.start + 1; return relativeHintText(c, day) + '\nDuration: ' + duration + ' ' + (duration === 1 ? 'day' : 'days'); } // NEW
function dateRange(c, cell) { return { start: c.parseDay(cell.getAttribute('roadmap_start')), end: c.parseDay(cell.getAttribute('roadmap_end')) }; } // NEW
function applyBoundaryScaleView(h) { h.api.setViewState(h.board, { today: { scales: BOUNDARY_SCALES, multiplier: 1, leftHidden: 2, rightHidden: 0 } }); h.graph.refresh(); } // NEW
function timelineDx(h, fromDay, toDay) { const c = h.w.TrellisRoadmapCore, timeline = h.api.getLayout(h.board).timeline; return c.dayToX(timeline, toDay) - c.dayToX(timeline, fromDay); } // NEW
function pointerEvent(x, y) { return { button: 0, clientX: x, clientY: y, preventDefault() {} }; } // NEW
function handlerMouseMove(h, handler, x, y, cell) { const rect = h.graph.container.getBoundingClientRect(); const event = new h.w.MouseEvent('mousemove', { bubbles: true, button: 0, clientX: x - h.graph.container.scrollLeft + rect.left, clientY: y - h.graph.container.scrollTop + rect.top }); Object.defineProperty(event, 'target', { value: h.graph.container }); const me = new h.w.mxMouseEvent(event, cell && h.graph.view.getState(cell)); me.graphX = x; me.graphY = y; handler.mouseMove(h.graph, me); } // NEW

test('Main creation is usable, idempotent, inclusive, and gives secondary projects unused names', t => {
    const h = harness(t); assert.ok(h.board, h.alerts.join('\n'));
    assert.equal(h.api.ensureMainRoadmapInRoadmapModule(h.module), h.board);
    assert.equal(h.typed(h.board, 'timeframe').length, 8);
    assert.equal(h.typed(h.board, 'marker').length, 1);
    assert.equal(h.process.getAttribute('label'), 'Planning');
    assert.equal(h.object.getAttribute('label'), 'First Step');
    assert.equal(h.board.getAttribute('roadmap_header_version'), '1'); // NEW
    assert.equal(h.process.getAttribute('roadmap_header_version'), '1'); // NEW
    assert.equal(h.process.getAttribute('roadmap_color'), '#2563eb'); // NEW
    assert.equal(styleValue(h.process.style, 'rounded'), '1'); // CHANGE
    assert.equal(styleValue(h.process.style, 'arcSize'), '12'); // CHANGE
    assert.equal(styleValue(h.object.style, 'rounded'), '1'); // CHANGE
    assert.equal(styleValue(h.object.style, 'arcSize'), '12'); // CHANGE
    const c = h.w.TrellisRoadmapCore;
    assert.equal(c.parseDay(h.process.getAttribute('roadmap_end')) - c.parseDay(h.process.getAttribute('roadmap_start')), 30);
    assert.equal(c.parseDay(h.object.getAttribute('roadmap_end')) - c.parseDay(h.object.getAttribute('roadmap_start')), 7);
    assert.equal(h.api.createSecondaryRoadmapInRoadmapModule(h.module).getAttribute('label'), 'Roadmap 2');
    assert.equal(h.api.createSecondaryRoadmapInRoadmapModule(h.module).getAttribute('label'), 'Roadmap 3');
});

test('roadmap tooltips show relative dates and inclusive duration', t => { // NEW
    const h = harness(t), c = h.w.TrellisRoadmapCore, today = c.todayDay(); // NEW
    const objectTip = h.graph.getTooltipForCell(h.object); // NEW
    assert.match(objectTip, /^First Step\n/); // NEW
    assert.match(objectTip, new RegExp('Start: ' + c.formatDay(today) + ' \\(today\\)')); // NEW
    assert.match(objectTip, new RegExp('End: ' + c.formatDay(today + 7) + ' \\(7 days from now\\)')); // NEW
    assert.match(objectTip, /Duration: 8 days/); // NEW
    assert.match(objectTip, /Planned · 0% · 0 blocked/); // NEW
    const processTip = h.graph.getTooltipForCell(h.process); // NEW
    assert.match(processTip, new RegExp('Start: ' + c.formatDay(today) + ' \\(today\\)')); // NEW
    assert.match(processTip, /Duration: 31 days/); // NEW
    assert.doesNotMatch(processTip, /Planned ·/); // NEW
    h.api.editObject(h.object, { startISO: c.formatDay(today - 2), endISO: c.formatDay(today) }); // NEW
    const pastTip = h.graph.getTooltipForCell(h.object); // NEW
    assert.match(pastTip, new RegExp('Start: ' + c.formatDay(today - 2) + ' \\(2 days ago\\)')); // NEW
    assert.match(pastTip, new RegExp('End: ' + c.formatDay(today) + ' \\(today\\)')); // NEW
    assert.match(pastTip, /Duration: 3 days/); // NEW
}); // NEW

test('roadmap resize hint shows relative active date and duration only', t => { // CHANGE
    const h = harness(t), c = h.w.TrellisRoadmapCore, today = c.todayDay(); h.graph.refresh(); // NEW
    let hiddenNativeTooltip = 0; const originalHide = h.graph.tooltipHandler.hide; h.graph.tooltipHandler.hide = function () { hiddenNativeTooltip += 1; return originalHide.apply(this, arguments); }; // NEW
    const state = h.graph.view.getState(h.object), right = { button: 0, clientX: state.x + state.width, clientY: state.y + 13, preventDefault() {} }; // NEW
    h.api._test.beginGesture(h.object, 'right', right); h.api._test.previewGesture({ ...right, clientX: right.clientX + 3 * THIS_WEEK_DAY_PX }); // NEW
    const hint = h.graph.container.querySelector('.trellis-roadmap-date-hint'); // NEW
    assert.equal(hiddenNativeTooltip, 1); // NEW
    assert.equal(hint.textContent, '10 days from now\nDuration: 11 days'); // CHANGE
    assert.doesNotMatch(hint.textContent, new RegExp(c.formatDay(today + 10) + '|First Step|Start:|End:')); // NEW
    h.api._test.endGesture(true); // NEW
    const left = { button: 0, clientX: state.x, clientY: state.y + 13, preventDefault() {} }; // NEW
    h.api._test.beginGesture(h.object, 'left', left); h.api._test.previewGesture({ ...left, clientX: left.clientX + 2 * THIS_WEEK_DAY_PX }); // NEW
    assert.equal(hint.textContent, '2 days from now\nDuration: 6 days'); // CHANGE
    h.api._test.endGesture(true); // NEW
    h.graph.refresh(); const processState = h.graph.view.getState(h.process), processRight = { button: 0, clientX: processState.x + processState.width, clientY: processState.y + 13, preventDefault() {} }, processDx = timelineDx(h, today + 31, today + 34); // CHANGE
    h.api._test.beginGesture(h.process, 'right', processRight); h.api._test.previewGesture({ ...processRight, clientX: processRight.clientX + processDx * h.graph.view.scale }); // CHANGE
    assert.equal(hint.textContent, '33 days from now\nDuration: 34 days'); // CHANGE
    h.api._test.endGesture(true); // NEW
    const processLeft = { button: 0, clientX: processState.x, clientY: processState.y + 13, preventDefault() {} }; // NEW
    h.api._test.beginGesture(h.process, 'left', processLeft); h.api._test.previewGesture({ ...processLeft, clientX: processLeft.clientX + 2 * THIS_WEEK_DAY_PX }); // NEW
    assert.equal(hint.textContent, 'today\nDuration: 31 days'); // CHANGE
    h.api._test.endGesture(true); // NEW
}); // NEW

test('roadmap right resize hint matches commit across custom timeframe scales', t => { // NEW
    const h = harness(t), c = h.w.TrellisRoadmapCore, today = c.todayDay(); applyBoundaryScaleView(h); // NEW
    h.api.editObject(h.object, { startISO: c.formatDay(today), endISO: c.formatDay(today + 6) }); h.graph.refresh(); // NEW
    const state = h.graph.view.getState(h.object), start = pointerEvent(state.x + state.width, state.y + 13), dx = timelineDx(h, today + 7, today + 10); // NEW
    h.api._test.beginGesture(h.object, 'right', start); h.api._test.previewGesture({ ...start, clientX: start.clientX + dx * h.graph.view.scale }); // NEW
    const preview = h.graph.container.querySelector('.trellis-roadmap-date-hint').textContent; h.api._test.endGesture(true); // NEW
    const bounds = h.graph.getCellGeometry(h.object).clone(); bounds.width += dx; h.api._test.resizeTimelineCell(h.object, bounds, 'right'); // NEW
    assert.deepEqual(dateRange(c, h.object), { start: today, end: today + 9 }); // NEW
    assert.equal(preview, expectedDragHint(c, dateRange(c, h.object), 'right')); // NEW
}); // NEW

test('roadmap left resize hint matches commit across custom timeframe scales', t => { // NEW
    const h = harness(t), c = h.w.TrellisRoadmapCore, today = c.todayDay(); applyBoundaryScaleView(h); // NEW
    h.api.editObject(h.object, { startISO: c.formatDay(today), endISO: c.formatDay(today + 5) }); h.graph.refresh(); // NEW
    const state = h.graph.view.getState(h.object), start = pointerEvent(state.x, state.y + 13), dx = timelineDx(h, today, today - 3); // NEW
    h.api._test.beginGesture(h.object, 'left', start); h.api._test.previewGesture({ ...start, clientX: start.clientX + dx * h.graph.view.scale }); // NEW
    const preview = h.graph.container.querySelector('.trellis-roadmap-date-hint').textContent; h.api._test.endGesture(true); // NEW
    const bounds = h.graph.getCellGeometry(h.object).clone(); bounds.x += dx; bounds.width -= dx; h.api._test.resizeTimelineCell(h.object, bounds, 'left'); // NEW
    assert.deepEqual(dateRange(c, h.object), { start: today - 3, end: today + 5 }); // NEW
    assert.equal(preview, expectedDragHint(c, dateRange(c, h.object), 'left')); // NEW
}); // NEW

test('roadmap process right resize hint keeps child-expanded dates across custom timeframe scales', t => { // NEW
    const h = harness(t), c = h.w.TrellisRoadmapCore, today = c.todayDay(); applyBoundaryScaleView(h); // NEW
    h.api.editObject(h.object, { startISO: c.formatDay(today + 5), endISO: c.formatDay(today + 6) }); h.api.editProcess(h.process, { startISO: c.formatDay(today), endISO: c.formatDay(today + 6) }); // NEW
    h.cell(h.process, { label: 'Beyond Edge', roadmap_type: 'object', roadmap_start: c.formatDay(today + 11), roadmap_end: c.formatDay(today + 11), roadmap_status: 'Planned', roadmap_progress: '0' }); h.graph.refresh(); // NEW
    const state = h.graph.view.getState(h.process), start = pointerEvent(state.x + state.width, state.y + 13), dx = timelineDx(h, today + 7, today + 10); // NEW
    h.api._test.beginGesture(h.process, 'right', start); h.api._test.previewGesture({ ...start, clientX: start.clientX + dx * h.graph.view.scale }); // NEW
    const preview = h.graph.container.querySelector('.trellis-roadmap-date-hint').textContent; h.api._test.endGesture(true); // NEW
    const bounds = h.graph.getCellGeometry(h.process).clone(); bounds.width += dx; h.api._test.resizeTimelineCell(h.process, bounds, 'right'); // NEW
    assert.deepEqual(dateRange(c, h.process), { start: today, end: today + 11 }); // NEW
    assert.equal(preview, expectedDragHint(c, dateRange(c, h.process), 'right')); // NEW
}); // NEW

test('roadmap move hint matches commit across custom timeframe scales', t => { // NEW
    const h = harness(t), c = h.w.TrellisRoadmapCore, today = c.todayDay(); applyBoundaryScaleView(h); // NEW
    h.api.editObject(h.object, { startISO: c.formatDay(today + 5), endISO: c.formatDay(today + 6) }); h.graph.refresh(); // NEW
    const state = h.graph.view.getState(h.object), start = pointerEvent(state.x + 8, state.y + 13), dx = timelineDx(h, today + 5, today + 9); // NEW
    h.api._test.beginGesture(h.object, 'move', start); h.api._test.previewGesture({ ...start, clientX: start.clientX + dx * h.graph.view.scale }); // NEW
    const preview = h.graph.container.querySelector('.trellis-roadmap-date-hint').textContent; h.api._test.endGesture(false); // NEW
    assert.deepEqual(dateRange(c, h.object), { start: today + 9, end: today + 10 }); // NEW
    assert.equal(preview, expectedDragHint(c, dateRange(c, h.object), 'move')); // NEW
}); // NEW

test('roadmap process renderer honors rounded style', t => { // NEW
    const h = harness(t), Shape = h.w.mxCellRenderer.defaultShapes.trellisRoadmapProcess; // NEW
    assert.ok(Shape); // NEW
    const rounded = new Shape(); rounded.style = { rounded: 1, arcSize: 12, fillColor: '#fff', strokeColor: '#123456', roadmapHeaderColor: '#ff0000' }; rounded.isRounded = true; // CHANGE
    const roundedCanvas = callRecordingCanvas(); rounded.paintVertexShape(roundedCanvas, 0, 0, 100, 90); // NEW
    assert.ok(roundedCanvas.calls.some(call => call[0] === 'roundrect')); // CHANGE
    assert.ok(roundedCanvas.calls.some(call => call[0] === 'quadTo')); // CHANGE
    assert.deepEqual(roundedCanvas.calls.filter(call => call[0] === 'fillAndStroke'), [['fillAndStroke', '#fff', '#123456'], ['fillAndStroke', '#899aab', '#123456']]); // CHANGE
    assert.ok(roundedCanvas.calls.some(call => call[0] === 'lineTo' && call[2] === 28)); // NEW
    const square = new Shape(); square.style = { rounded: 0, fillColor: '#fff', strokeColor: '#111' }; square.isRounded = false; // NEW
    const squareCanvas = callRecordingCanvas(); square.paintVertexShape(squareCanvas, 0, 0, 100, 90); // NEW
    assert.equal(squareCanvas.calls.some(call => call[0] === 'roundrect'), false); // CHANGE
}); // NEW

test('new roadmap view defaults hide past frames and use 75px/400px nominal widths', t => { // NEW
    const h = harness(t), frames = h.typed(h.board, 'timeframe'); // NEW
    const state = h.api.getViewState(h.board); // NEW
    assert.equal(state.today.leftHidden, 3); assert.equal(state.inception.leftHidden, 3); // NEW
    assert.deepEqual(Array.from(frames, frame => h.graph.isCellVisible(frame)), [false, false, false, true, true, true, true, true]); // CHANGE
    assert.deepEqual(Array.from(frames, frame => Math.round(h.graph.getCellGeometry(frame).width)), [0, 0, 0, 400, 400, 400, 400, 400]); // CHANGE
    h.api.setViewState(h.board, { today: { leftHidden: 0 } }); // NEW
    assert.deepEqual(Array.from(frames.slice(0, 3), frame => Math.round(h.graph.getCellGeometry(frame).width)), [75, 75, 75]); // CHANGE
}); // NEW

test('explicit view preferences keep past visibility', t => { // CHANGE
    const h = harness(t); h.api.setViewState(h.board, { today: { leftHidden: 0 }, inception: { leftHidden: 0 } }); // CHANGE
    const state = h.api.getViewState(h.board); // NEW
    assert.equal(state.today.leftHidden, 0); assert.equal(state.inception.leftHidden, 0); // NEW
    assert.equal(h.graph.isCellVisible(h.typed(h.board, 'timeframe')[0]), true); // NEW
}); // NEW

test('personal perspectives change projection but neither serialized XML nor undo history', t => {
    const h = harness(t); assert.ok(h.board, h.alerts.join('\n'));
    const before = h.xml(), history = h.undo.history.length, originalWidth = h.graph.getCellGeometry(h.board).width;
    h.api.setViewState(h.board, { today: { multiplier: 2, leftHidden: 2, rightHidden: 1, scales: [4, 4, 7, 8, 4, 4, 4, 4] } });
    assert.notEqual(h.graph.getCellGeometry(h.board).width, originalWidth);
    assert.equal(h.xml(), before); assert.equal(h.undo.history.length, history);
    h.api.setViewState(h.board, { perspective: 'inception' });
    assert.equal(h.api.getViewState(h.board).inception.multiplier, 1);
    h.api.setViewState(h.board, { perspective: 'today' });
    assert.equal(h.api.getViewState(h.board).today.multiplier, 2);
    assert.equal(h.xml(), before);
});

test('object shifts expand processes, shrinking clamps to children, and every edit undoes together', t => {
    const h = harness(t); const c = h.w.TrellisRoadmapCore, previousEnd = h.process.getAttribute('roadmap_end');
    const before = h.xml(); h.api.shiftObjects([h.object], 40);
    assert.equal(h.process.getAttribute('roadmap_end'), h.object.getAttribute('roadmap_end'));
    h.undo.undo(); assert.equal(h.xml(), before); h.undo.redo();
    const expanded = h.process.getAttribute('roadmap_end');
    h.api.shiftObjects([h.object], -40); assert.equal(h.process.getAttribute('roadmap_end'), expanded);
    h.api.editProcess(h.process, { endISO: h.object.getAttribute('roadmap_start') });
    assert.equal(h.process.getAttribute('roadmap_end'), h.object.getAttribute('roadmap_end'));
    assert.ok(c.parseDay(previousEnd) < c.parseDay(expanded));
});

test('status transitions retain progress and reject Done to Blocked without changing XML', t => {
    const h = harness(t);
    h.api.editObject(h.object, { status: 'Doing', progress: 60 });
    h.api.editObject(h.object, { status: 'Blocked' }); assert.equal(h.api.getSummary(h.board).percent, 60); assert.equal(h.api.getSummary(h.board).blockedCount, 1);
    h.api.editObject(h.object, { status: 'Planned' }); assert.equal(h.api.getSummary(h.board).percent, 0);
    h.api.editObject(h.object, { status: 'Doing' }); assert.equal(h.api.getSummary(h.board).percent, 60);
    h.api.editObject(h.object, { status: 'Done' }); const before = h.xml();
    assert.equal(h.api.editObject(h.object, { status: 'Blocked' }), null); assert.equal(h.xml(), before);
    h.api.editObject(h.object, { status: 'Doing' }); assert.equal(h.api.getSummary(h.board).percent, 100);
});

test('new processes rotate colors while object borders stay neutral', t => { // CHANGE
    const h = harness(t), second = h.api.addProcess(h.board); // NEW
    assert.equal(second.getAttribute('roadmap_color'), '#059669'); // NEW
    assert.equal(styleValue(h.graph.getCellStyle(h.process), 'strokeColor'), '#2563eb'); // NEW
    assert.equal(styleValue(h.graph.getCellStyle(h.process), 'roadmapHeaderColor'), undefined); // NEW
    assert.equal(styleValue(h.graph.getCellStyle(h.object), 'strokeColor'), '#64748b'); // CHANGE
    h.api._test.setProcessColor(h.process, '#123456'); // NEW
    assert.equal(h.process.getAttribute('roadmap_color'), '#123456'); // NEW
    assert.equal(styleValue(h.graph.getCellStyle(h.process), 'strokeColor'), '#123456'); // NEW
    assert.equal(styleValue(h.graph.getCellStyle(h.process), 'roadmapHeaderColor'), undefined); // CHANGE
    assert.equal(styleValue(h.graph.getCellStyle(h.object), 'strokeColor'), '#64748b'); // CHANGE
    h.api.editObject(h.object, { status: 'Doing', progress: 40 }); // NEW
    assert.equal(styleValue(h.graph.getCellStyle(h.object), 'fillColor'), '#bfdbfe'); // NEW
    assert.equal(styleValue(h.graph.getCellStyle(h.object), 'strokeColor'), '#64748b'); // CHANGE
}); // NEW

test('process overlay exposes color picker without inline date fields', async t => { // CHANGE
    const h = harness(t); h.graph.setSelectionCell(h.process); h.api.refresh(); await frame(h); // NEW
    const color = h.graph.container.querySelector('.trellis-roadmap-control input[aria-label="Process color"]'); // NEW
    assert.ok(color); color.value = '#654321'; color.dispatchEvent(new h.w.Event('change', { bubbles: true })); // NEW
    assert.equal(h.process.getAttribute('roadmap_color'), '#654321'); // NEW
    assert.equal(styleValue(h.graph.getCellStyle(h.process), 'strokeColor'), '#654321'); // CHANGE
    assert.equal(styleValue(h.graph.getCellStyle(h.object), 'strokeColor'), '#64748b'); // CHANGE
    assert.equal(h.graph.container.querySelectorAll('.trellis-roadmap-control input[type="date"]').length, 0); // NEW
}); // NEW

test('transparent columns select the object; process handles are movable; view is exported from a clone', t => {
    const h = harness(t); h.graph.refresh();
    const state = h.graph.view.getState(h.object); assert.ok(state);
    assert.equal(h.api.getHitCellAt(state.x + state.width / 2, state.y + state.height / 2), h.object);
    assert.equal(h.graph.isCellMovable(h.process), true); // CHANGE
    const before = h.xml(); h.api.setViewState(h.board, { today: { multiplier: 2, leftHidden: 1 } });
    const exported = h.api.projectExportXml(h.ui.editor.getGraphXml()); // CHANGE: test this clone helper honestly; real renderer coverage is separate.
    assert.notEqual(h.w.mxUtils.getXml(exported), before); assert.equal(h.xml(), before);
});

test('readers can change their view but cannot mutate roadmap content', t => {
    const h = harness(t); h.graph.__trellisUsers = { canEditCell: () => false, canAddCell: () => false, canDeleteCell: () => false, getCurrentUser: () => ({ id: 'reader' }) };
    const before = h.xml(); assert.equal(h.api.addProcess(h.board), null); assert.equal(h.api.shiftObjects([h.object], 2), null);
    h.api.setViewState(h.board, { perspective: 'inception' }); assert.equal(h.api.getViewState(h.board).perspective, 'inception'); assert.equal(h.xml(), before);
});

module.exports = { harness }; // NEW: shared production graph fixture for integration coverage.

test('standalone roadmap task creation integrates production Modules and Task Manager atomically', t => {
    const h = harness(t, ['Garden_Task_Manager.js', 'Modules_Standalone.js']);
    assert.ok(h.board, h.alerts.join('\n'));
    const before = h.xml();
    const task = h.api.createTaskFromRoadmapObject(h.object, { title: 'Execution task', startISO: h.object.getAttribute('roadmap_start'), endISO: h.object.getAttribute('roadmap_end'), linkMissingAssignees: false });
    assert.ok(task, h.alerts.join('\n')); assert.equal(task.getAttribute('workflow_state'), 'TODO');
    assert.equal(task.getAttribute('title'), 'Execution task'); assert.ok(!task.getAttribute('assigned_day'));
    assert.equal(h.api.linkedTasks(h.object).length, 1);
    h.undo.undo(); assert.equal(h.xml(), before); h.undo.redo();
    assert.equal(h.api.linkedTasks(h.object).length, 1);
    const second = h.api.createTaskFromRoadmapObject(h.object, { title: 'Second task', linkMissingAssignees: false });
    assert.ok(second, h.alerts.join('\n')); assert.equal(h.api.linkedTasks(h.object).length, 2);
    h.api.editObject(h.object, { status: 'Blocked' });
    assert.equal(h.api.createTaskFromRoadmapObject(h.object, { title: 'Forbidden', linkMissingAssignees: false }), null);
});

test('Garden creation links all companions while unavailable Roadmap Manager leaves no shell', t => {
    const h = harness(t, ['Garden_Task_Manager.js', 'Modules_Standalone.js']);
    const modules = h.graph.__trellisModules, garden = modules.createModuleAtPoint({ x: 100, y: 100 }, 'garden');
    const roadmap = h.model.getCell(garden.getAttribute('roadmap_module_id'));
    assert.ok(roadmap, h.alerts.join('\n'));
    assert.equal(roadmap.getAttribute('roadmap_garden_module_id'), garden.id);
    assert.equal(roadmap.getAttribute('roadmap_task_module_id'), garden.getAttribute('trellis_task_module_id'));
    assert.equal(roadmap.getAttribute('roadmap_team_module_id'), garden.getAttribute('trellis_team_module_id'));
    assert.equal(h.typed(roadmap, 'board').length, 1);
    assert.equal(h.model.getGeometry(h.typed(roadmap, 'board')[0]).y, h.graph.getStartSize(roadmap).height + 12); // NEW
    h.graph.__trellisRoadmapManager = null;
    const incompleteGarden = modules.createModuleAtPoint({ x: 500, y: 100 }, 'garden');
    assert.ok(incompleteGarden); assert.ok(incompleteGarden.getAttribute('trellis_task_module_id'));
    assert.ok(!incompleteGarden.getAttribute('roadmap_module_id'));
    assert.equal(modules.createModuleAtPoint({ x: 100, y: 100 }, 'roadmap'), null);
    assert.ok(h.alerts.some(message => /unavailable/.test(message)));
});

test('task creation validates dates before mutation and rolls back a failed destination command', t => {
    const h = harness(t, ['Garden_Task_Manager.js', 'Modules_Standalone.js']), before = h.xml();
    assert.equal(h.api.createTaskFromRoadmapObject(h.object, { title: 'Invalid', startISO: '2000-01-01', linkMissingAssignees: false }), null);
    assert.equal(h.xml(), before);
    h.graph.__trellisTaskManager.createRoadmapTaskInBoard = () => { throw new Error('Injected creation failure'); };
    assert.equal(h.api.createTaskFromRoadmapObject(h.object, { title: 'Rollback', linkMissingAssignees: false }), null);
    assert.equal(h.xml(), before);
});

test('missing assignee linking is explicit, permission checked, and never changes source assignments', t => {
    const h = harness(t, ['Garden_Task_Manager.js', 'Modules_Standalone.js']);
    const role = h.cell(null, { label: 'Alex' }, 'role_card=1;');
    h.graph.__trellisModules.addReciprocalLink(role, h.board);
    h.api.setAssignments(h.object, [role.id]);
    const original = h.object.getAttribute('roadmap_assignee_role_ids_json');
    const omitted = h.api.createTaskFromRoadmapObject(h.object, { title: 'Without role', linkMissingAssignees: false });
    assert.ok(omitted, h.alerts.join('\n')); assert.ok(!omitted.getAttribute('task_assignee_role_ids_json')); // CHANGE: Task Manager represents empty assignments by removing the attribute.
    assert.equal(h.object.getAttribute('roadmap_assignee_role_ids_json'), original);
    const copied = h.api.createTaskFromRoadmapObject(h.object, { title: 'With role', linkMissingAssignees: true });
    assert.ok(copied, h.alerts.join('\n')); assert.equal(copied.getAttribute('task_assignee_role_ids_json'), original);
    const taskBoard = h.model.getParent(h.model.getParent(copied));
    assert.ok(role.getAttribute('linkedTo').split(',').includes(taskBoard.id));
    const otherRole = h.cell(null, { label: 'Blair' }, 'role_card=1;'); h.graph.__trellisModules.addReciprocalLink(otherRole, h.board); h.api.setAssignments(h.object, [otherRole.id]);
    h.graph.__trellisUsers = { canEditCell: () => true, canAddCell: () => true, canManageAccess: () => false };
    const before = h.xml(); assert.equal(h.api.createTaskFromRoadmapObject(h.object, { title: 'Denied', linkMissingAssignees: true }), null); assert.equal(h.xml(), before);
});

test('deletion prompts only with tasks, preserves tasks by default, and undo restores reciprocal links', t => {
    const h = harness(t, ['Garden_Task_Manager.js', 'Modules_Standalone.js']);
    const empty = h.api.addObject(h.process); h.graph.removeCells([empty]); assert.equal(h.dialogs.length, 0);
    const task = h.api.createTaskFromRoadmapObject(h.object, { title: 'Keep me', linkMissingAssignees: false });
    const before = h.xml(); h.graph.removeCells([h.process]); assert.equal(h.dialogs.length, 1); assert.equal(h.xml(), before);
    h.ui.hideDialog(); h.api.deleteRoadmapCells([h.process], 'keep');
    assert.ok(h.model.getCell(task.id)); assert.ok(!task.getAttribute('roadmap_source_object_id')); assert.equal(task.getAttribute('roadmap_source_object_name'), 'First Step');
    h.undo.undo(); assert.equal(h.xml(), before);
    h.api.deleteRoadmapCells([h.process], 'delete'); assert.equal(h.model.getCell(task.id), undefined);
});

test('roadmap process and object overlays expose delete buttons', async t => { // NEW
    const h = harness(t, ['Garden_Task_Manager.js', 'Modules_Standalone.js']); // NEW
    const empty = h.api.addObject(h.process); h.graph.refresh(); h.graph.setSelectionCell(empty); h.api.refresh(); await frame(h); // NEW
    const objectDelete = graphButton(h, 'Delete Object'); assert.ok(objectDelete); assert.equal(objectDelete.getAttribute('data-trellis-button-variant'), 'danger'); // NEW
    assert.equal(Array.from(objectDelete.closest('.trellis-roadmap-control').querySelectorAll('button')).map(button => button.textContent).at(-1), 'Delete Object'); // CHANGE: object delete stays at the bottom of its overlay.
    objectDelete.click(); assert.equal(h.dialogs.length, 0); assert.equal(h.model.getCell(empty.id), undefined); // NEW
    const task = h.api.createTaskFromRoadmapObject(h.object, { title: 'Prompt from overlay', linkMissingAssignees: false }); // NEW
    h.graph.refresh(); h.graph.setSelectionCell(h.process); h.api.refresh(); await frame(h); // NEW
    const processDelete = graphButton(h, 'Delete Process'); assert.ok(processDelete); assert.equal(processDelete.getAttribute('data-trellis-button-variant'), 'danger'); // NEW
    assert.equal(Array.from(processDelete.closest('.trellis-roadmap-control').querySelectorAll('button')).map(button => button.textContent).at(-1), 'Delete Process'); // CHANGE: process delete stays at the bottom of its overlay.
    processDelete.click(); assert.equal(h.dialogs.length, 1); assert.match(h.dialogs[0].textContent, /Delete Roadmap Content/); assert.ok(h.model.getCell(h.process.id)); assert.ok(h.model.getCell(task.id)); // CHANGE
    h.ui.hideDialog(); h.api.deleteRoadmapCells([h.process], 'keep'); assert.ok(h.model.getCell(task.id)); // NEW
}); // NEW

test('copying planning content clears task links and source IDs while retaining dates and valid roles', t => {
    const h = harness(t, ['Garden_Task_Manager.js', 'Modules_Standalone.js']);
    const task = h.api.createTaskFromRoadmapObject(h.object, { title: 'Original only', linkMissingAssignees: false });
    assert.ok(task);
    const copy = h.graph.cloneCells([h.process], true)[0], object = h.typed(copy, 'object')[0];
    assert.equal(object.getAttribute('roadmap_start'), h.object.getAttribute('roadmap_start'));
    assert.ok(!object.getAttribute('roadmap_task_ids_json'));
    assert.ok(!String(object.getAttribute('linkedTo') || '').split(',').includes(task.id));
    assert.equal(h.api.linkedTasks(h.object).length, 1);
});

test('live gestures leave XML untouched until release, Escape cancels, and multiple objects shift equally', t => {
    const h = harness(t); const second = h.api.addObject(h.process);
    h.graph.refresh(); h.graph.setSelectionCells([h.object, second]);
    const state = h.graph.view.getState(h.object), before = h.xml();
    const event = (x, y) => ({ button: 0, clientX: x, clientY: y, preventDefault() {} });
    const start = event(state.x + 10, state.y + 10), moved = event(state.x + 10 + 5 * THIS_WEEK_DAY_PX, state.y + 10); // CHANGE
    h.api._test.beginGesture(h.object, 'move', start); h.api._test.previewGesture(moved);
    assert.equal(h.xml(), before); h.api._test.endGesture(true); assert.equal(h.xml(), before);
    const c = h.w.TrellisRoadmapCore, initial = c.parseDay(h.object.getAttribute('roadmap_start'));
    h.api._test.beginGesture(h.object, 'move', start); h.api._test.previewGesture(moved); h.api._test.endGesture(false);
    assert.equal(c.parseDay(h.object.getAttribute('roadmap_start')), initial + 5);
    assert.equal(second.getAttribute('roadmap_start'), h.object.getAttribute('roadmap_start'));
});

test('actual Users identity changes invalidate personal geometry without XML changes', t => { // NEW
    const h = harness(t, ['Trellis_Users.js']); // NEW
    const users = h.graph.__trellisUsers; users.enableUsers('Alice', '1234'); users.createUser('Bob', '5678', false); // NEW
    const before = h.xml(), history = h.undo.history.length; // NEW
    h.api.setViewState(h.board, { today: { multiplier: 2 } }); const wide = h.graph.getCellGeometry(h.board).width; // NEW
    users.login('Bob', '5678'); assert.equal(h.api.getViewState(h.board).today.multiplier, 1); assert.ok(h.graph.getCellGeometry(h.board).width < wide); // NEW
    users.login('Alice', '1234'); assert.equal(h.graph.getCellGeometry(h.board).width, wide); // NEW
    assert.equal(h.xml(), before); assert.equal(h.undo.history.length, history); // NEW
}); // NEW

test('reader clicks select short objects without beginning a date gesture', t => { // NEW
    const h = harness(t); h.api.editObject(h.object, { endISO: h.object.getAttribute('roadmap_start') }); // NEW
    h.api.setViewState(h.board, { today: { multiplier: 0.01 } }); h.graph.refresh(); // NEW
    h.graph.__trellisUsers = { canEditCell: () => false }; // NEW
    const state = h.graph.view.getState(h.object); const before = h.xml(); // NEW
    const x = state.x + state.width + 3, y = state.y + 5; // NEW
    assert.equal(h.api.getHitCellAt(x, y), h.object); // NEW
    h.graph.container.dispatchEvent(new h.w.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: x, clientY: y })); // NEW
    assert.equal(h.graph.getSelectionCell(), h.object); assert.equal(h.api._test.gesture, null); assert.equal(h.xml(), before); // NEW
}); // NEW

test('growing projects resolves collisions without imposing a fixed stack', t => { // NEW
    const h = harness(t), second = h.api.createSecondaryRoadmapInRoadmapModule(h.module); // NEW
    for (let i = 0; i < 8; i++) h.api.addObject(h.process); // NEW
    const first = h.graph.getCellGeometry(h.board), next = h.graph.getCellGeometry(second); // NEW
    assert.ok(next.y >= first.y + first.height + 40 || next.x >= first.x + first.width + 40 || next.y + next.height + 40 <= first.y || next.x + next.width + 40 <= first.x); assert.equal(h.graph.isCellMovable(second), true); // CHANGE // NEW
    const before = h.xml(); h.api.deleteRoadmapCells([h.board], 'keep'); assert.ok(h.model.getGeometry(second)); // CHANGE // NEW
    h.undo.undo(); assert.equal(h.xml(), before); // NEW
}); // NEW

test('clipped date gestures keep preview bars inside visible timeframes', t => { // NEW
    const h = harness(t), core = h.w.TrellisRoadmapCore, anchor = h.api.getLayout(h.board).anchor; // NEW
    h.api.editObject(h.object, { startISO: core.formatDay(anchor - 20) }); h.api.setViewState(h.board, { today: { leftHidden: 3, rightHidden: 4 } }); h.graph.refresh(); // NEW
    const before = h.xml(), state = h.graph.view.getState(h.object); // NEW
    const event = { button: 0, clientX: state.x + 2, clientY: state.y + 2, preventDefault() {} }; // NEW
    h.api._test.beginGesture(h.object, 'move', event); h.api._test.previewGesture({ ...event, clientX: event.clientX + THIS_WEEK_DAY_PX }); // CHANGE
    assert.equal(Math.round(h.graph.getCellGeometry(h.object).width), 400); assert.equal(h.graph.getCellGeometry(h.object).x, 0); // CHANGE
    assert.equal(h.xml(), before); h.api._test.endGesture(true); assert.equal(h.xml(), before); // NEW
}); // NEW

test('Main deletion is explicit, recreation is on request, and secondary names fill unused numbers', t => { // NEW
    const h = harness(t), second = h.api.createSecondaryRoadmapInRoadmapModule(h.module), third = h.api.createSecondaryRoadmapInRoadmapModule(h.module); // NEW
    h.api.deleteRoadmapCells([h.board, second], 'keep'); assert.equal(h.typed(h.module, 'board').length, 1); // NEW
    assert.equal(h.api.createSecondaryRoadmapInRoadmapModule(h.module).getAttribute('label'), 'Roadmap 2'); assert.equal(third.getAttribute('label'), 'Roadmap 3'); // NEW
    const main = h.api.ensureMainRoadmapInRoadmapModule(h.module); assert.equal(main.getAttribute('roadmap_role'), 'main'); assert.ok(h.typed(main, 'process').length); // NEW
}); // NEW

test('copy insertion remaps role membership, preserves module Main, and clears task links', t => { // NEW
    const h = harness(t, ['Garden_Task_Manager.js', 'Modules_Standalone.js']); // NEW
    const role = h.cell(null, { label: 'Alex' }, 'role_card=1;'); h.graph.__trellisModules.addReciprocalLink(role, h.board); h.api.setAssignments(h.object, [role.id]); // NEW
    const task = h.api.createTaskFromRoadmapObject(h.object, { title: 'Original task', linkMissingAssignees: false }); assert.ok(task); // NEW
    const before = h.xml(), copy = h.graph.cloneCells([h.module], true)[0]; h.graph.addCells([copy]); // NEW
    const board = h.typed(copy, 'board')[0], object = h.typed(h.typed(board, 'process')[0], 'object')[0]; // NEW
    assert.equal(board.getAttribute('roadmap_role'), 'main'); assert.deepEqual(Array.from(h.api.roleRoster(board), role => role.id), [role.id]); // NEW
    assert.equal(object.getAttribute('roadmap_assignee_role_ids_json'), JSON.stringify([role.id])); assert.equal(h.api.linkedTasks(object).length, 0); // NEW
    assert.ok(!copy.getAttribute('roadmap_task_module_id')); assert.equal(h.api.getViewState(board).today.multiplier, 1); // NEW
    h.undo.undo(); assert.equal(h.xml(), before); h.undo.redo(); assert.equal(h.api.roleRoster(board).length, 1); // NEW
    const separate = h.graph.cloneCells([h.board], true)[0]; h.graph.addCells([separate], h.module); assert.equal(separate.getAttribute('roadmap_role'), 'secondary'); // NEW
}); // NEW

test('Users permits task companion creation and navigation cleanup without task edit access', t => { // NEW
    const h = harness(t, ['Trellis_Users.js', 'Garden_Task_Manager.js', 'Modules_Standalone.js']); // NEW
    const users = h.graph.__trellisUsers, alice = users.enableUsers('Alice', '1234').user, bob = users.createUser('Bob', '5678', false).user; // NEW
    users.setOwner(h.module, alice.id); // NEW
    const task = h.api.createTaskFromRoadmapObject(h.object, { title: 'Keep me', linkMissingAssignees: false }); assert.ok(task, h.alerts.join('\n')); // NEW
    const taskModule = h.model.getCell(h.module.getAttribute('roadmap_task_module_id')); users.setOwner(taskModule, alice.id); // NEW
    users.setScopeGrant(h.module, { userId: bob.id, preset: 'coordinator' }); users.login('Bob', '5678'); // NEW
    assert.equal(users.canDeleteCell(h.object), true); assert.equal(users.canEditCell(task), false); // NEW
    const before = h.xml(); assert.equal(h.api.deleteRoadmapCells([h.object], 'delete'), null); assert.equal(h.xml(), before); // NEW
    assert.ok(h.api.deleteRoadmapCells([h.object], 'keep')); assert.ok(!h.model.getCell(h.object.id)); assert.ok(h.model.getCell(task.id)); // NEW
    assert.ok(!task.getAttribute('roadmap_source_object_id')); assert.equal(task.getAttribute('roadmap_source_object_name'), 'First Step'); // NEW
    h.undo.undo(); assert.equal(h.api.linkedTasks(h.object)[0], task); h.undo.redo(); assert.ok(!h.model.getCell(h.object.id)); // NEW
}); // NEW

test('the real isolated renderer applies personal geometry while embedded XML stays canonical', t => { // NEW
    const h = harness(t); const canonical = h.xml(); // NEW
    h.api.setViewState(h.board, { today: { multiplier: 2, leftHidden: 2 } }); // NEW
    const projection = JSON.parse(JSON.stringify(h.graph.getExportVariables().__trellisRoadmapProjection)); // NEW
    const container = h.w.document.createElement('div'); h.w.document.body.appendChild(container); const exported = new h.w.Graph(container); exported.isSpecialColor = () => -1; // NEW: Draw.io placeholder adapter. // NEW
    const doc = h.w.mxUtils.parseXml(canonical), renderingXml = doc.cloneNode(true); new h.w.mxCodec(renderingXml).decode(renderingXml.documentElement, exported.model); // CHANGE
    h.w.TrellisRoadmapRenderer.applyProjection(exported, projection, ''); exported.refresh(); // NEW
    assert.equal(exported.model.getGeometry(exported.model.getCell(h.board.id)).width, h.graph.getCellGeometry(h.board).width); // NEW
    const frame = h.typed(h.board, 'timeframe')[2], state = exported.view.getState(exported.model.getCell(frame.id)); // NEW
    assert.ok(state.shape); assert.equal(state.shape.constructor.name, 'TimeframeShape'); // NEW
    assert.match(container.innerHTML, /\d{4}-\d{2}-\d{2}/); // NEW
    assert.equal(h.xml(), canonical); assert.equal(h.w.mxUtils.getXml(doc), canonical); // NEW
}); // NEW

/** A calendar rollover must never move the anchor beneath an active pointer. */ // NEW
test('Today rollover waits for gesture release and preserves document data', t => { // NEW
    const h = harness(t), initial = h.api.getLayout(h.board).anchor, before = h.xml(); // NEW
    h.graph.refresh(); const state = h.graph.view.getState(h.object); // NEW
    h.api._test.beginGesture(h.object, 'move', { button: 0, clientX: state.x + 4, clientY: state.y + 4, preventDefault() {} }); // NEW
    const NativeDate = h.w.Date; const tomorrow = new NativeDate(); tomorrow.setDate(tomorrow.getDate() + 1); // NEW
    h.w.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [tomorrow.getTime()])); } }; // NEW
    h.api._test.checkToday(); assert.equal(h.api.getLayout(h.board).anchor, initial); // NEW
    h.api._test.endGesture(true); assert.equal(h.api.getLayout(h.board).anchor, initial + 1); assert.equal(h.xml(), before); // NEW
}); // NEW

test('unavailable storage retains isolated session preferences', t => { // NEW
    const h = harness(t), second = h.api.createSecondaryRoadmapInRoadmapModule(h.module); // NEW
    Object.defineProperty(h.w, 'localStorage', { get() { throw new Error('Storage denied'); } }); // NEW
    const before = h.xml(), history = h.undo.history.length; // NEW
    h.api.setViewState(h.board, { today: { multiplier: 3 } }); // NEW
    assert.equal(h.api.getViewState(h.board).today.multiplier, 3); assert.equal(h.api.getViewState(second).today.multiplier, 1); // NEW
    assert.equal(h.xml(), before); assert.equal(h.undo.history.length, history); // NEW
}); // NEW

test('Users rejection cannot hide unauthorized task edits inside authorized roadmap cleanup', t => { // NEW
    const h = harness(t, ['Trellis_Users.js', 'Garden_Task_Manager.js', 'Modules_Standalone.js']); // NEW
    const users = h.graph.__trellisUsers, alice = users.enableUsers('Alice', '1234').user, bob = users.createUser('Bob', '5678', false).user; // NEW
    users.setOwner(h.module, alice.id); // NEW
    const task = h.api.createTaskFromRoadmapObject(h.object, { title: 'Protected task', linkMissingAssignees: false }); // NEW
    users.setOwner(h.model.getCell(h.module.getAttribute('roadmap_task_module_id')), alice.id); // NEW
    users.setScopeGrant(h.module, { userId: bob.id, preset: 'coordinator' }); users.login('Bob', '5678'); // NEW
    const before = h.xml(); // NEW
    const result = h.api.runModelCommand(() => { // NEW
        h.api.deleteRoadmapCells([h.object], 'keep'); // NEW
        const value = task.value.cloneNode(true); value.setAttribute('label', 'Unauthorized'); h.model.setValue(task, value); return task; // NEW
    }); // NEW
    assert.equal(result, null); assert.equal(h.xml(), before); // NEW
}); // NEW

/** Exercise the actual dialog DOM; cancellation must not provision a Task Module. */ // NEW
test('task dialog cancellation leaves no companion or document edit', t => { // NEW
    const h = harness(t, ['Garden_Task_Manager.js', 'Modules_Standalone.js']); const before = h.xml(), history = h.undo.history.length; // NEW
    h.api.showTaskCreationDialog(h.object); const body = h.dialogs[0]; // NEW
    assert.ok(body.textContent.includes('Allowed range:')); // NEW
    assert.deepEqual(Array.from(body.querySelectorAll('input[type=date]'), input => input.value), [h.object.getAttribute('roadmap_start'), h.object.getAttribute('roadmap_end')]); // NEW
    Array.from(body.querySelectorAll('button')).find(button => button.textContent === 'Cancel').click(); // NEW
    assert.equal(h.dialogs.length, 0); assert.equal(h.xml(), before); assert.equal(h.undo.history.length, history); // NEW
}); // NEW

test('focused trim buttons refresh state across repeated clicks', async t => { // NEW
    const h = harness(t); h.api.setViewState(h.board, { today: { leftHidden: 0 } }); h.graph.setSelectionCell(h.board); h.api.refresh(); // CHANGE
    const frame = () => new Promise(resolve => h.w.requestAnimationFrame(resolve)); await frame(); // NEW
    const before = h.xml(); // NEW
    for (let hidden = 1; hidden <= 3; hidden++) { // NEW
        const button = Array.from(h.graph.container.querySelectorAll('button')).find(button => button.textContent === 'Hide past'); // NEW
        assert.ok(button); button.focus(); button.click(); await frame(); assert.equal(h.api.getViewState(h.board).today.leftHidden, hidden); // NEW
    } // NEW
    assert.equal(h.xml(), before); // NEW
}); // NEW

/** Unopened pages need personal export projection without changing the live page cache. */ // NEW
test('export decodes unopened pages in isolation', t => { // NEW
    const h = harness(t), before = h.xml(); // NEW
    const node = h.w.mxUtils.parseXml('<diagram id="unopened"/>').documentElement; // NEW
    const current = { root: h.model.getRoot(), getId: () => 'current' }, unopened = { node, getId: () => 'unopened' }; h.ui.pages = [current, unopened]; // NEW
    h.ui.updatePageRoot = page => { assert.notEqual(page, unopened); assert.notEqual(page.node, node); const doc = h.w.mxUtils.parseXml(before); page.root = new h.w.mxCodec(doc).decode(doc.documentElement).root; }; // NEW
    const projection = h.api.exportProjection(); // NEW
    assert.ok(projection.current.length); assert.ok(projection.unopened.length); assert.equal(unopened.root, undefined); assert.equal(node.childNodes.length, 0); assert.equal(h.xml(), before); // NEW
}); // NEW

/** Send real mxMouseEvents through the production Graph dispatcher and installed handlers. */ // NEW
function pointer(h, type, x, y, cell, extras = {}) { // NEW
    const event = new h.w.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, ...extras }); // NEW
    Object.defineProperty(event, 'target', { value: h.graph.container }); // NEW
    h.graph.fireMouseEvent(type, new h.w.mxMouseEvent(event, cell && h.graph.view.getState(cell))); // NEW
} // NEW

test('native graph handler previews without XML edits, commits dates and supports Escape', t => { // NEW
    const h = harness(t); h.graph.setGridEnabled(false); h.graph.refresh(); h.graph.setSelectionCell(h.object); // NEW
    const state = h.graph.view.getState(h.object), x = state.x + 12, y = state.y + 12, before = h.xml(), start = h.object.getAttribute('roadmap_start'); // NEW
    pointer(h, 'mouseDown', x, y, h.object); pointer(h, 'mouseMove', x + 5 * THIS_WEEK_DAY_PX, y, h.object); // CHANGE
    assert.ok(h.graph.graphHandler.shape); assert.equal(h.xml(), before); // NEW
    h.graph.escape(); pointer(h, 'mouseUp', x + 5 * THIS_WEEK_DAY_PX, y, h.object); assert.equal(h.xml(), before); assert.equal(h.api._test.gesture, null); // CHANGE: release the cancelled native gesture before starting another. // NEW
    pointer(h, 'mouseDown', x, y, h.object); pointer(h, 'mouseMove', x + 5 * THIS_WEEK_DAY_PX, y, h.object); pointer(h, 'mouseUp', x + 5 * THIS_WEEK_DAY_PX, y, h.object); // CHANGE
    assert.equal(h.w.TrellisRoadmapCore.parseDay(h.object.getAttribute('roadmap_start')) - h.w.TrellisRoadmapCore.parseDay(start), 5); // NEW
    h.undo.undo(); assert.equal(h.xml(), before); h.undo.redo(); assert.notEqual(h.xml(), before); // NEW
}); // NEW

test('native vertex handlers expose only horizontal external handles and resize semantic dates', t => { // NEW
    const h = harness(t); h.graph.setGridEnabled(false); h.graph.refresh(); h.graph.setSelectionCell(h.object); // NEW
    const handler = h.graph.selectionCellsHandler.getHandler(h.object), state = h.graph.view.getState(h.object), end = h.w.TrellisRoadmapCore.parseDay(h.object.getAttribute('roadmap_end')), before = h.xml(); // NEW
    assert.ok(handler instanceof h.w.mxVertexHandler); assert.equal(handler.isSizerVisible(4), true); assert.equal(handler.isSizerVisible(1), false); // NEW
    handler.start(state.x + state.width, state.y + 13, 4); handler.resizeCell(h.object, 3 * THIS_WEEK_DAY_PX, 0, 4); handler.reset(); // CHANGE
    assert.equal(h.w.TrellisRoadmapCore.parseDay(h.object.getAttribute('roadmap_end')), end + 3); h.undo.undo(); assert.equal(h.xml(), before); // NEW
    h.api.editObject(h.object, { endISO: h.object.getAttribute('roadmap_start') }); h.api.setViewState(h.board, { today: { multiplier: 0.01 } }); h.graph.refresh(); // NEW
    const short = h.graph.selectionCellsHandler.getHandler(h.object); short.redraw(); assert.ok(short.horizontalOffset > 0); // NEW
}); // NEW

test('native vertex resize hint uses handler bounds under viewport offset and scroll', t => { // NEW
    const h = harness(t), c = h.w.TrellisRoadmapCore, today = c.todayDay(); h.graph.setGridEnabled(false); h.graph.view.setScale(1.35); h.graph.container.scrollLeft = 240; h.graph.container.scrollTop = 60; h.graph.container.getBoundingClientRect = () => ({ left: 100, top: 45, right: 1100, bottom: 745, width: 1000, height: 700 }); // NEW
    h.graph.refresh(); h.graph.setSelectionCell(h.object); // NEW
    const handler = h.graph.selectionCellsHandler.getHandler(h.object), state = h.graph.view.getState(h.object), before = h.xml(); // NEW
    const startX = state.x + state.width, startY = state.y + 13, dx = 3 * THIS_WEEK_DAY_PX * h.graph.view.scale; // NEW
    handler.start(startX, startY, 4); handlerMouseMove(h, handler, startX + dx, startY, h.object); // NEW
    const hint = h.graph.container.querySelector('.trellis-roadmap-date-hint'); // NEW
    assert.equal(hint.textContent, expectedDragHint(c, { start: today, end: today + 10 }, 'right')); // NEW
    assert.equal(h.graph.container.querySelector('.geHint'), null); // NEW
    assert.equal(h.xml(), before); handler.reset(); // NEW
}); // NEW

test('native process movement shifts descendants once and persists compact row preference', t => { // NEW
    const h = harness(t), second = h.api.addProcess(h.board); h.graph.refresh(); const before = h.xml(), day = h.w.TrellisRoadmapCore.parseDay(h.object.getAttribute('roadmap_start')); // NEW
    const moved = h.graph.moveCells([h.process, h.object], 5 * THIS_WEEK_DAY_PX, 100, false); assert.equal(moved.length, 1); // CHANGE
    assert.equal(h.w.TrellisRoadmapCore.parseDay(h.object.getAttribute('roadmap_start')), day + 5); assert.equal(h.process.getAttribute('roadmap_preferred_row'), '1'); // NEW
    assert.equal(h.api.getLayout(h.board).packedProcesses.rows.length, 2); h.undo.undo(); assert.equal(h.xml(), before); // NEW
    assert.ok(second); // NEW
}); // NEW

test('native movement reparents objects and cross-project transfers preserve calendar dates', t => { // NEW
    const h = harness(t), destination = h.api.addProcess(h.board), original = h.object.getAttribute('roadmap_start'); // NEW
    assert.equal(h.graph.moveCells([h.object], 2 * THIS_WEEK_DAY_PX, 0, false, destination)[0], h.object); assert.equal(h.model.getParent(h.object), destination); // CHANGE
    assert.equal(h.w.TrellisRoadmapCore.parseDay(h.object.getAttribute('roadmap_start')) - h.w.TrellisRoadmapCore.parseDay(original), 2); // NEW
    const board = h.api.createSecondaryRoadmapInRoadmapModule(h.module), target = h.typed(board, 'process')[0], before = h.xml(), dates = [h.object.getAttribute('roadmap_start'), h.object.getAttribute('roadmap_end')]; // NEW
    h.graph.moveCells([h.object], 800, 300, false, target); assert.equal(h.model.getParent(h.object), target); assert.deepEqual([h.object.getAttribute('roadmap_start'), h.object.getAttribute('roadmap_end')], dates); // NEW
    h.undo.undo(); assert.equal(h.xml(), before); // NEW
}); // NEW

test('cross-project transfer prompts once and cancellation has no side effects', t => { // NEW
    const h = harness(t, ['Garden_Task_Manager.js', 'Modules_Standalone.js']); // NEW
    const role = h.cell(null, { label: 'Alex' }, 'role_card=1;'); h.graph.__trellisModules.addReciprocalLink(role, h.board); h.api.setAssignments(h.object, [role.id]); // NEW
    const board = h.api.createSecondaryRoadmapInRoadmapModule(h.module), target = h.typed(board, 'process')[0], before = h.xml(); // NEW
    h.graph.moveCells([h.object], 0, 0, false, target); assert.equal(h.dialogs.length, 1); assert.equal(h.xml(), before); // NEW
    Array.from(h.dialogs[0].querySelectorAll('button')).find(button => button.textContent === 'Cancel').click(); assert.equal(h.xml(), before); // NEW
    h.graph.moveCells([h.object], 0, 0, false, target); Array.from(h.dialogs[0].querySelectorAll('button')).find(button => button.textContent === 'Link and move').click(); // NEW
    assert.equal(h.model.getParent(h.object), target); assert.ok(h.api.roleRoster(board).some(item => item.id === role.id)); h.undo.undo(); assert.equal(h.xml(), before); // NEW
}); // NEW

test('bulk status is atomic and roadmap labels are not native-editable', t => { // CHANGE
    const h = harness(t), second = h.api.addObject(h.process); h.api.editObject(second, { status: 'Done' }); const before = h.xml(); // NEW
    assert.equal(h.api._test.setObjectStatuses([h.object, second], 'Blocked'), null); assert.equal(h.xml(), before); // NEW
    assert.ok(h.api._test.setObjectStatuses([h.object, second], 'Doing')); assert.equal(second.getAttribute('roadmap_progress'), '100'); // NEW
    const renamed = h.xml(); [h.board, h.process, h.object].forEach(cell => assert.equal(h.graph.isCellEditable(cell), false)); // CHANGE
    assert.equal(h.graph.getEditingValue(h.process), ''); h.graph.labelChanged(h.process, 'Release'); assert.equal(h.process.getAttribute('label'), 'Planning'); assert.equal(h.xml(), renamed); // CHANGE
    assert.match(h.graph.convertValueToString(h.process), /Planning.*%/); // CHANGE
}); // NEW

test('roadmap overlay name inputs commit on blur and Enter while Escape reverts', async t => { // NEW
    const h = harness(t); h.graph.setSelectionCell(h.process); h.api.refresh(); await frame(h); // NEW
    let input = roadmapNameInputFor(h, h.process); assert.ok(input); input.value = 'Release'; input.dispatchEvent(new h.w.Event('blur', { bubbles: true })); // NEW
    assert.equal(h.process.getAttribute('label'), 'Release'); // NEW
    h.graph.setSelectionCell(h.object); h.api.refresh(); await frame(h); input = roadmapNameInputFor(h, h.object); assert.ok(input); // NEW
    const beforeEscape = h.xml(); input.value = 'Draft Step'; input.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); // NEW
    assert.equal(input.value, 'First Step'); assert.equal(h.object.getAttribute('label'), 'First Step'); assert.equal(h.xml(), beforeEscape); // NEW
    input.value = 'Launch Step'; input.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); // NEW
    assert.equal(h.object.getAttribute('label'), 'Launch Step'); // NEW
    h.graph.setSelectionCell(h.board); h.api.refresh(); await frame(h); input = roadmapNameInputFor(h, h.board); assert.ok(input); // NEW
    input.value = '   '; input.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); // NEW
    assert.equal(h.board.getAttribute('label'), 'Main Roadmap'); // NEW
}); // NEW

test('roadmap overlay name inputs consume graph gesture events', async t => { // NEW
    const h = harness(t); h.graph.setSelectionCell(h.process); h.api.refresh(); await frame(h); // NEW
    const input = roadmapNameInputFor(h, h.process), bubbled = []; assert.ok(input); // NEW
    ['mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'pointerup', 'keydown', 'keypress', 'keyup'].forEach(type => h.graph.container.addEventListener(type, event => bubbled.push(event.type))); // NEW
    ['mousedown', 'mouseup', 'click', 'dblclick'].forEach(type => input.dispatchEvent(new h.w.MouseEvent(type, { bubbles: true, cancelable: true }))); // NEW
    ['pointerdown', 'pointerup'].forEach(type => input.dispatchEvent(new h.w.Event(type, { bubbles: true, cancelable: true }))); // NEW
    ['keydown', 'keypress', 'keyup'].forEach(type => input.dispatchEvent(new h.w.KeyboardEvent(type, { key: 'a', bubbles: true, cancelable: true }))); // NEW
    assert.deepEqual(bubbled, []); // NEW
}); // NEW

test('reader roadmap overlay name inputs are disabled and reject scripted writes', async t => { // NEW
    const h = harness(t); h.graph.__trellisUsers = { canEditCell: () => false, canAddCell: () => false, canDeleteCell: () => false, getCurrentUser: () => ({ id: 'reader' }) }; // NEW
    h.graph.setSelectionCell(h.process); h.api.refresh(); await frame(h); // NEW
    const input = roadmapNameInputFor(h, h.process); assert.ok(input); assert.equal(input.disabled, true); // NEW
    const before = h.xml(); input.value = 'Forbidden'; input.dispatchEvent(new h.w.Event('blur', { bubbles: true })); // NEW
    assert.equal(input.value, 'Planning'); assert.equal(h.process.getAttribute('label'), 'Planning'); assert.equal(h.xml(), before); // NEW
}); // NEW

test('native modifier-copy uses remapped planning data and clears task links', t => { // NEW
    const h = harness(t); const date = h.w.TrellisRoadmapCore.parseDay(h.object.getAttribute('roadmap_start')), before = h.xml(); // NEW
    const result = h.graph.moveCells([h.object], 5 * THIS_WEEK_DAY_PX, 0, true); assert.equal(result.length, 1, h.alerts.join(' | ')); assert.notEqual(result[0], h.object); // CHANGE
    assert.equal(h.w.TrellisRoadmapCore.parseDay(result[0].getAttribute('roadmap_start')), date + 5); assert.equal(h.api.linkedTasks(result[0]).length, 0); h.undo.undo(); assert.equal(h.xml(), before); // NEW
}); // NEW

test('timeframe native resize changes only personal scale', t => { // NEW
    const h = harness(t), frame = h.typed(h.board, 'timeframe')[3], before = h.xml(), history = h.undo.history.length, geometry = h.graph.getCellGeometry(frame); // NEW
    const resized = geometry.clone(); resized.width *= 2; h.graph.resizeCells([frame], [resized]); // NEW
    assert.equal(h.api.getViewState(h.board).today.scales[3], 800 / 7); assert.equal(h.xml(), before); assert.equal(h.undo.history.length, history); // CHANGE
}); // NEW

test('timeframe resize hint reports effective px per day while dragging', t => { // NEW
    const h = harness(t), frame = h.typed(h.board, 'timeframe')[3]; h.graph.refresh(); // NEW
    const state = h.graph.view.getState(frame), start = { button: 0, clientX: state.x + state.width, clientY: state.y + 20, preventDefault() {} }; // NEW
    h.api._test.beginGesture(frame, 'right', start); // NEW
    h.api._test.previewGesture({ ...start, clientX: start.clientX + 400 }); // NEW
    const hint = h.graph.container.querySelector('.trellis-roadmap-date-hint'); // NEW
    assert.equal(hint.textContent, (800 / 7).toFixed(2) + ' px/day'); // NEW
    h.api._test.endGesture(true); // NEW
}); // NEW

test('shared workspace handles move processes through the native handler', t => { // NEW
    const h = harness(t, ['Deep_Click_Through.js']); h.graph.setGridEnabled(false); h.graph.refresh(); h.graph.setSelectionCell(h.process); // NEW
    const policy = h.graph.__trellisWorkspaceDragPolicy; policy.refreshHandles(); // NEW
    assert.equal(policy.getWorkspaceContainerType(h.process), 'process'); assert.ok(policy.getHandleCells().includes(h.process)); // NEW
    const handle = h.graph.container.querySelector('[data-trellis-workspace-drag-handle="1"]'); assert.ok(handle); // NEW
    const state = h.graph.view.getState(h.process), x = state.x + 4, y = state.y + 4, before = h.xml(), start = h.w.TrellisRoadmapCore.parseDay(h.object.getAttribute('roadmap_start')); // NEW
    handle.dispatchEvent(new h.w.MouseEvent('mousedown', { button: 0, bubbles: true, clientX: x, clientY: y })); // NEW
    h.w.document.dispatchEvent(new h.w.MouseEvent('mousemove', { button: 0, bubbles: true, clientX: x + 5 * THIS_WEEK_DAY_PX, clientY: y })); assert.equal(h.xml(), before); // CHANGE
    h.w.document.dispatchEvent(new h.w.MouseEvent('mouseup', { button: 0, bubbles: true, clientX: x + 5 * THIS_WEEK_DAY_PX, clientY: y })); // CHANGE
    assert.equal(h.w.TrellisRoadmapCore.parseDay(h.object.getAttribute('roadmap_start')), start + 5); h.undo.undo(); assert.equal(h.xml(), before); // NEW
}); // NEW

test('roadmap module workspace handle moves the module without folding or deleting boards', t => { // NEW
    const h = harness(t, ['Modules_Standalone.js', 'Deep_Click_Through.js']); h.graph.setGridEnabled(false); h.graph.refresh(); h.graph.setSelectionCells([h.module, h.board]); // NEW
    const policy = h.graph.__trellisWorkspaceDragPolicy; policy.beginHandleDragForTests(h.module, { button: 0, clientX: 25, clientY: 25, preventDefault() {}, stopPropagation() {} }); // CHANGE
    const dragCells = policy.getHandleDragCellsForTests(h.module); assert.equal(dragCells.length, 1); assert.equal(dragCells[0], h.module); // CHANGE
    h.w.document.dispatchEvent(new h.w.MouseEvent('mousemove', { button: 0, bubbles: true, clientX: 65, clientY: 25 })); // NEW
    h.w.document.dispatchEvent(new h.w.MouseEvent('mouseup', { button: 0, bubbles: true, clientX: 65, clientY: 25 })); // NEW
    assert.equal(h.model.getParent(h.board), h.module); assert.equal(h.dialogs.length, 0); assert.ok(h.model.getCell(h.board.id)); // NEW
}); // NEW

test('Users permits only task navigation repair during authorized cross-project transfers', t => { // NEW
    const h = harness(t, ['Trellis_Users.js', 'Garden_Task_Manager.js', 'Modules_Standalone.js']), users = h.graph.__trellisUsers; // NEW
    const alice = users.enableUsers('Alice', '1234').user, bob = users.createUser('Bob', '5678', false).user; users.setOwner(h.module, alice.id); // NEW
    const task = h.api.createTaskFromRoadmapObject(h.object, { title: 'Independent task', linkMissingAssignees: false }); assert.ok(task, h.alerts.join(' | ')); // NEW
    const taskModule = h.model.getCell(h.module.getAttribute('roadmap_task_module_id')); users.setOwner(taskModule, alice.id); // NEW
    const away = h.model.getGeometry(taskModule).clone(); away.x = 100000; h.model.setGeometry(taskModule, away); // NEW: isolate navigation permission from the separately tested permission to displace neighboring modules.
    const board = h.api.createSecondaryRoadmapInRoadmapModule(h.module), target = h.typed(board, 'process')[0]; users.setScopeGrant(h.module, { userId: bob.id, preset: 'coordinator' }); users.login('Bob', '5678'); // NEW
    const before = h.xml(), provenance = task.getAttribute('roadmap_source_board_name'); assert.equal(users.canEditCell(task), false); // NEW
    const moved = h.graph.moveCells([h.object], 300, 0, false, target); assert.equal(moved[0], h.object, h.alerts.join(' | ')); // NEW
    assert.equal(task.getAttribute('roadmap_source_board_id'), board.id); assert.equal(task.getAttribute('roadmap_source_board_name'), provenance); assert.equal(h.api.linkedTasks(h.object)[0], task); // NEW
    h.undo.undo(); assert.equal(h.xml(), before); // NEW
    const rejected = h.api.runModelCommand(() => { h.api._test.moveContent([h.object], target, {}); const value = task.value.cloneNode(true); value.setAttribute('label', 'Forbidden'); h.model.setValue(task, value); return task; }); // NEW
    assert.equal(rejected, null); assert.equal(h.xml(), before); // NEW
}); // NEW

test('free board movement resolves peer collisions atomically and rejects protected neighbors', t => { // NEW
    const h = harness(t), second = h.api.createSecondaryRoadmapInRoadmapModule(h.module), before = h.xml(), first = h.model.getGeometry(h.board), other = h.model.getGeometry(second); // NEW
    assert.ok(h.graph.moveCells([second], first.x - other.x + 5, first.y - other.y + 5, false).length); // NEW
    const a = h.model.getGeometry(h.board), b = h.model.getGeometry(second); assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y); // NEW
    h.undo.undo(); assert.equal(h.xml(), before); // NEW
    h.graph.__trellisUsers = { canEditCell: cell => cell !== h.board }; // NEW
    assert.equal(h.graph.moveCells([second], first.x - other.x + 5, first.y - other.y + 5, false).length, 0); assert.equal(h.xml(), before); // NEW
}); // NEW

test('personal collision offsets protect outer modules and are included in visual export only', t => { // NEW
    const h = harness(t, ['Modules_Standalone.js']), saved = h.model.getGeometry(h.module); // NEW
    const neighbor = h.cell(null, { label: 'Neighbor' }, 'module=1;container=1;'); const geometry = h.model.getGeometry(neighbor).clone(); geometry.x = saved.x + saved.width + 40; geometry.y = saved.y; h.model.setGeometry(neighbor, geometry); // NEW
    const before = h.xml(), history = h.undo.history.length, x = h.graph.getCellGeometry(neighbor).x; // NEW
    h.api.setViewState(h.board, { today: { multiplier: 2 } }); const projected = h.graph.getCellGeometry(neighbor); // NEW
    assert.ok(projected.x > x); assert.equal(h.model.getGeometry(neighbor).x, geometry.x); assert.equal(h.xml(), before); assert.equal(h.undo.history.length, history); // NEW
    const exported = h.api.exportProjection()[''].find(record => record.id === neighbor.id); assert.equal(exported.geometry.x, projected.x); // NEW
    h.api.setViewState(h.board, { today: { multiplier: 1 } }); assert.equal(h.graph.getCellGeometry(neighbor).x, x); // NEW
}); // NEW

test('Task-style multi-selection controls use shared styling and an anchored assignment picker', async t => { // NEW
    const h = harness(t, ['Garden_Task_Manager.js', 'Modules_Standalone.js']), second = h.api.addObject(h.process); // NEW
    const role = h.cell(null, { label: 'Alex' }, 'role_card=1;'); h.graph.__trellisModules.addReciprocalLink(role, h.board); // NEW
    h.graph.setSelectionCells([h.object, second]); h.api.refresh(); await new Promise(resolve => h.w.requestAnimationFrame(resolve)); // NEW
    const buttons = Array.from(h.graph.container.querySelectorAll('button')); assert.ok(buttons.some(button => button.textContent === 'Status')); assert.ok(!buttons.some(button => button.textContent === 'Create Task')); // NEW
    buttons.find(button => button.textContent === 'Assign').click(); const picker = h.graph.container.querySelector('.trellis-task-assignment-picker'); assert.ok(picker); assert.equal(h.dialogs.length, 0); // NEW
    const check = picker.querySelector('input[type=checkbox]'); check.checked = true; check.dispatchEvent(new h.w.Event('change')); // NEW
    const apply = Array.from(picker.querySelectorAll('button')).find(button => button.textContent === 'Apply'); assert.equal(apply.getAttribute('data-trellis-button-variant'), 'add'); apply.click(); // NEW
    assert.equal(h.object.getAttribute('roadmap_assignee_role_ids_json'), JSON.stringify([role.id])); assert.equal(second.getAttribute('roadmap_assignee_role_ids_json'), JSON.stringify([role.id])); // NEW
}); // NEW
// NEW: exercise the delayed transfer decision at the native graph command boundary.
test('cross-project decline removes only moved assignments and stale transfer decisions do not mutate', t => { // NEW
    const h = harness(t, ['Garden_Task_Manager.js', 'Modules_Standalone.js']); // NEW
    const role = h.cell(null, { label: 'Alex' }, 'role_card=1;'); h.graph.__trellisModules.addReciprocalLink(role, h.board); h.api.setAssignments(h.object, [role.id]); // NEW
    const board = h.api.createSecondaryRoadmapInRoadmapModule(h.module), target = h.typed(board, 'process')[0], before = h.xml(); // NEW
    h.graph.moveCells([h.object], 100, 0, false, target); // NEW
    Array.from(h.dialogs[0].querySelectorAll('button')).find(button => button.textContent === 'Move without missing assignments').click(); // NEW
    assert.equal(h.model.getParent(h.object), target); assert.equal(h.object.getAttribute('roadmap_assignee_role_ids_json'), '[]'); assert.equal(h.api.roleRoster(board).length, 0); // NEW
    h.undo.undo(); assert.equal(h.xml(), before); // NEW
    h.graph.moveCells([h.object], 0, 0, false, target); h.api.setAssignments(h.object, []); const changed = h.xml(); // NEW
    Array.from(h.dialogs[0].querySelectorAll('button')).find(button => button.textContent === 'Link and move').click(); // NEW
    assert.equal(h.xml(), changed); assert.equal(h.model.getParent(h.object), h.process); assert.equal(h.api.roleRoster(board).length, 0); // NEW
}); // NEW

test('native project copying remains inside its module and undoes atomically', t => { // NEW
    const h = harness(t), before = h.xml(), geometry = h.model.getGeometry(h.board); // NEW
    const copies = h.graph.moveCells([h.board], 0, geometry.height + 80, true); // NEW
    assert.equal(copies.length, 1, h.alerts.join(' | ')); assert.equal(h.model.getParent(copies[0]), h.module); assert.equal(h.typed(copies[0], 'process').length, 1); // NEW
    h.undo.undo(); assert.equal(h.xml(), before); // NEW
}); // NEW
test('native outlines at 50 processes and 500 objects reuse the frozen layout without model edits', t => { // NEW
    const h = harness(t), start = h.process.getAttribute('roadmap_start'), end = h.process.getAttribute('roadmap_end'); // NEW
    h.api._test.command(() => { // NEW
        for (let p = 0; p < 50; p++) { // NEW
            const process = p ? h.cell(h.board, { label: 'Process ' + p, roadmap_type: 'process', roadmap_start: start, roadmap_end: end }) : h.process; // NEW
            for (let o = p ? 0 : 1; o < 10; o++) h.cell(process, { label: 'Object ' + o, roadmap_type: 'object', roadmap_start: start, roadmap_end: end, roadmap_status: 'Planned', roadmap_progress: '0' }); // NEW
        } // NEW
        h.api.editProcess(h.process, { start, end }); // NEW
    }); // NEW
    assert.equal(h.typed(h.board, 'process').length, 50); assert.equal(h.typed(h.board, 'process').reduce((n, process) => n + h.typed(process, 'object').length, 0), 500); // NEW
    h.graph.refresh(); const initial = h.graph.view.getState(h.object); h.graph.view.setTranslate(200 - initial.x, 200 - initial.y); h.graph.setSelectionCell(h.object); const state = h.graph.view.getState(h.object), x = state.x + 12, y = state.y + 12, before = h.xml(); // NEW
    h.graph.graphHandler.start(h.object, x, y); const layout = h.api._test.gesture.layout; // NEW
    for (let i = 1; i <= 20; i++) { pointer(h, 'mouseMove', x + i * 4, y, h.object); assert.equal(h.api._test.gesture.layout, layout); } // NEW
    assert.equal(h.xml(), before); h.graph.escape(); pointer(h, 'mouseUp', x + 80, y, h.object); assert.equal(h.xml(), before); // NEW
}); // NEW
