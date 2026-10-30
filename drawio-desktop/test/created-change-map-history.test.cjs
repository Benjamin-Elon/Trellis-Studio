const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const projectRoot = path.resolve(__dirname, "..");
const pluginPath = path.join(projectRoot, "drawio/src/main/webapp/plugins/garden_planner_plugins/Created_Change_Map.js");
const pluginDir = path.join(projectRoot, "drawio/src/main/webapp/plugins/garden_planner_plugins");

class TestCell {
    constructor(id, value = null, style = "") {
        this.id = id;
        this.value = value;
        this.style = style;
        this.children = [];
        this.geometry = { x: 0, y: 0, width: 80, height: 40 };
    }
    getId() { return this.id; }
    getStyle() { return this.style; }
    getAttribute(key) { return this.value && this.value.nodeType === 1 ? this.value.getAttribute(key) : null; }
    setAttribute(key, value) { if (this.value && this.value.nodeType === 1) this.value.setAttribute(key, value); }
    removeAttribute(key) { if (this.value && this.value.nodeType === 1) this.value.removeAttribute(key); }
}

class TestModel {
    constructor(root) {
        this.root = root;
        this.listeners = new Map();
        this.cells = new Map();
        this.index(root);
    }
    index(cell) { this.cells.set(cell.id, cell); (cell.children || []).forEach(child => this.index(child)); }
    getRoot() { return this.root; }
    getParent(cell) { return cell && cell.parent ? cell.parent : null; }
    getChildCount(cell) { return cell && cell.children ? cell.children.length : 0; }
    getChildAt(cell, index) { return cell.children[index]; }
    getCell(id) { return this.cells.get(id) || null; }
    isVertex(cell) { return !!cell && cell !== this.root; }
    isEdge() { return false; }
    beginUpdate() {}
    endUpdate() {}
    setValue(cell, value) { cell.value = value; }
    setStyle(cell, style) { cell.style = style; }
    addListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(fn); }
    fireChange(edit) { (this.listeners.get("change") || []).forEach(fn => fn(this, { getProperty: key => key === "edit" ? edit : null })); }
}

function appendChild(parent, child) {
    child.parent = parent;
    parent.children.push(child);
    return child;
}

function makeXmlCell(document, id, attrs = {}) {
    const node = document.implementation.createDocument("", "", null).createElement("object");
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    return new TestCell(id, node);
}

test("change map stamps Trellis user actor metadata before deferred history recording", () => {
    const source = fs.readFileSync(pluginPath, "utf8");
    assert.match(source, /function stampActor\(cell, kind, edit\)[\s\S]*stampActorIntoEdit\(edit, cell, kind\)/);
    assert.match(source, /const capturedMetadata = historyRecorder\.captureActiveTransactionMetadata\(\);[\s\S]*const createdStamped = stampCreatedOnInsert\(edit\);[\s\S]*Promise\.resolve\(\)\.then/);
    assert.doesNotMatch(source, /Promise\.resolve\(\)\.then\(function \(\) \{[\s\S]{0,900}stampCreatedOnInsert\(edit\)/);
});

// NEW: run the renderer against the real transactional history implementation.
const { DatabaseSync } = require('node:sqlite');
const { createHistoryService } = require('../src/main/trellis-history-service.js');
const { encodeRevision, normalizeDocument } = require('../src/main/trellis-history-codec.js');
function createDbBridge() {
    const service = createHistoryService({ Database: DatabaseSync, dbPath: ':memory:' });
    const state = { get events() { return service._test.database.prepare('SELECT * FROM history_v2_revisions ORDER BY timestamp,rowid').all().map(row => ({ ...JSON.parse(row.metadata), metadata_json: row.metadata, affected_cell_ids: JSON.stringify(JSON.parse(row.metadata).affectedCellIds || []), tags_json: JSON.stringify(JSON.parse(row.metadata).tags || []) })); } };
    return { service, state, request(method, payload) { return service.request(1, method, payload); }, corrupt(id) { service._test.database.prepare('UPDATE history_v2_revisions SET payload=? WHERE id=?').run(Buffer.from('broken'), id); } };
}

function loadPlugin(options = {}) {
    const dom = new JSDOM("<!doctype html><body><div id='toolbar'><button class='trellis-users-login-button'>User</button></div><div id='host'><div id='format'><div id='native-format'>Format</div></div><div id='graph'></div></div></body>", { url: "https://app.test/" });
    const document = dom.window.document;
    const root = new TestCell("root");
    const layer = appendChild(root, makeXmlCell(document, "layer", { label: "Layer" }));
    const cell = appendChild(layer, makeXmlCell(document, "cell-a", { label: "A" }));
    cell.geometry = { x: 10, y: 20, width: 80, height: 40 };
    const model = new TestModel(root);
    let serialized = options.serialized || "<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1'><mxGeometry x='10' y='20' width='80' height='40' as='geometry'/></mxCell></root></mxGraphModel>";
    let restoredXml = null;
    const graphListeners = new Map();
    const editorListeners = new Map();
    const graph = {
        container: document.getElementById("graph"),
        popupMenuHandler: {},
        view: { getState: target => ({ x: target.geometry.x, y: target.geometry.y, width: target.geometry.width, height: target.geometry.height }), addListener() {} },
        getModel() { return model; },
        getDefaultParent() { return layer; },
        getSelectionCells() { return []; },
        setSelectionCells(cells) { graph.selected = cells; },
        setSelectionCell(cell) { graph.selected = [cell]; },
        scrollCellToVisible(cellArg) { graph.scrolled = cellArg; },
        fitWindow(bounds, border) { graph.fitted = { bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, border }; },
        scrollRectToVisible(bounds) { graph.scrolledRect = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }; },
        addListener(name, fn) { if (!graphListeners.has(name)) graphListeners.set(name, []); graphListeners.get(name).push(fn); },
        refresh() { graph.refreshed = true; },
        __trellisHistoryTestSerialize() { return serialized; },
        __trellisHistoryTestRestore(xml) { restoredXml = xml; serialized = xml; }
    };
    const actions = {};
    const formatContainer = document.getElementById("format");
    const firedEvents = [];
    const nativeFormat = {
        refreshCalls: 0,
        clearCalls: 0,
        refresh() {
            this.refreshCalls += 1;
            this.clear();
            const div = document.createElement("div");
            div.id = "native-format";
            div.textContent = "Format";
            formatContainer.appendChild(div);
        },
        immediateRefresh() { this.refresh(); },
        clear() { this.clearCalls += 1; formatContainer.textContent = ""; }
    };
    const editor = {
        graph,
        undoManager: { clear() { ui.undoCleared = true; } },
        addListener(name, fn) { if (!editorListeners.has(name)) editorListeners.set(name, []); editorListeners.get(name).push(fn); }
    };
    const ui = {
        editor,
        toolbarContainer: document.getElementById("toolbar"), // NEW
        getCurrentFile() { return options.file || null; }, // NEW
        actions: { addAction(id, fn) { actions[id] = { funct: fn }; } },
        menus: { get() { return null; }, addMenuItems() {} },
        formatContainer,
        format: nativeFormat,
        formatWidth: 0,
        refresh(sizeDidChange) { ui.refreshed = sizeDidChange; },
        fireEvent(evt) {
            const name = evt && evt.name ? evt.name : evt;
            firedEvents.push(name);
            if (name === "formatWidthChanged" && ui.format && typeof ui.format.refresh === "function") ui.format.refresh();
        }
    };
    const dbBridge = options.dbBridge === false ? null : createDbBridge();
    const context = {
        window: dom.window, document, console, Promise, Error, String, Number, Math, Date, Set, Map, JSON, Graph: options.Graph,
        setTimeout: options.instantTimers ? fn => { fn(); return 1; } : setTimeout,
        clearTimeout,
        Draw: { loadPlugin(callback) { callback(ui); } },
        mxEvent: { CHANGE: "change", CELLS_ADDED: "cellsAdded", PASTE: "paste", SCALE: "scale" },
        mxEventObject: function mxEventObject(name) { this.name = name; },
        mxUtils: { createXmlDocument() { return document.implementation.createDocument("", "", null); }, parseXml(xml) { return new dom.window.DOMParser().parseFromString(xml, "text/xml"); }, getXml(node) { return new dom.window.XMLSerializer().serializeToString(node); } },
        requestAnimationFrame(fn) { fn(); }
    };
    context.window.trellisHistory = dbBridge; // CHANGE
    context.window.confirm = () => true;
    if (options.users) context.window.Trellis = { users: options.users };
    vm.runInNewContext(fs.readFileSync(pluginPath, "utf8"), context, { filename: pluginPath });
    return { context, document, graph, model, cell, layer, dbBridge, actions, restoredXml: () => restoredXml, setSerialized(xml) { serialized = xml; }, ui, formatContainer, firedEvents, fireEditorEvent(name) { (editorListeners.get(name) || []).forEach(fn => fn(editor, { name })); } };
}

async function settle(ms = 0) {
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, ms));
    await Promise.resolve();
}

test('storage button follows the user menu, opens history, and exposes accessible compact labels', async () => { // NEW
    const harness = loadPlugin(); await settle();
    const user = harness.document.querySelector('.trellis-users-login-button'), button = user.nextElementSibling;
    assert.ok(button.classList.contains('trellis-history-storage-button')); assert.match(button.textContent, /Diagram unsaved.*History/);
    assert.match(button.getAttribute('aria-label'), /Open document history/); button.click(); await settle();
    assert.match(harness.document.body.textContent, /Storage details/);
    harness.context.window.innerWidth = 700; harness.context.window.dispatchEvent(new harness.context.window.Event('resize'));
    assert.match(button.textContent, /^D unsaved.*H /); assert.match(button.getAttribute('aria-label'), /Diagram unsaved/);
}); // NEW

test('recorded history events keep lightweight references instead of queued whole-document copies', async () => { // NEW
    const harness = loadPlugin(); await settle(); let recorded;
    harness.context.window.addEventListener('trellisHistoryRevisionRecorded', event => { recorded = event.detail; });
    await harness.context.window.Trellis.history.createCheckpoint('Reference checkpoint');
    assert.equal(recorded.snapshot.snapshotId, recorded.revision.id);
    assert.equal(recorded.snapshot.compressedXml, undefined); assert.equal(recorded.snapshot.compressedKind, undefined);
    assert.ok(recorded.snapshot.byteSize > 0); assert.equal(recorded.snapshot.storageKind, 'full');
}); // NEW

test('whole-document comparison distinguishes identical object IDs on different pages and wrapper attributes', async () => { // NEW
    const harness = loadPlugin(); await settle();
    const page = (id, label) => `<diagram id="${id}"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><object id="bed" label="${label}"><mxCell parent="1" vertex="1"/></object></root></mxGraphModel></diagram>`;
    const before = '<mxfile>' + page('a', 'One') + page('b', 'Two') + '</mxfile>', after = '<mxfile>' + page('a', 'One') + page('b', 'Changed') + '</mxfile>';
    const diff = harness.context.window.Trellis.history._test.diffSnapshotWithCurrent(before, after);
    assert.deepEqual(Array.from(diff.changed), [JSON.stringify(['b', 'bed'])]);
}); // NEW

test('shared checkpoints record accepted objects while the displayed canvas remains stale', async () => { // NEW
    const harness = loadPlugin(); await settle();
    const viewed = "<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='b' parent='1' value='B0'/></root></mxGraphModel>", accepted = viewed.replace('B0', 'B1');
    harness.setSerialized(viewed); harness.graph.__trellisSharing = { isExplicitRefresh: () => true, historyXml: async () => accepted };
    const saved = await harness.context.window.Trellis.history.createCheckpoint('Accepted shared state');
    const snapshot = await harness.context.window.Trellis.history._test.components.HistoryStore.loadSnapshot(saved.revision.id);
    assert.match(snapshot.compressed_xml || snapshot.xml || snapshot.compressedXml, /B1/); assert.equal(harness.restoredXml(), null);
});

test("history API records a baseline and exposes a side-panel action", async () => {
    const harness = loadPlugin();
    await settle();
    assert.ok(harness.context.window.Trellis.history.run);
    assert.ok(harness.context.window.Trellis.history.getLastRestoreAudit);
    assert.ok(harness.context.window.Trellis.history._test.components.ChangeMapRenderer);
    assert.ok(harness.context.window.Trellis.history._test.components.HistoryRecorder);
    assert.ok(harness.context.window.Trellis.history._test.components.HistoryStore);
    assert.ok(harness.context.window.Trellis.history._test.components.HistoryRail);
    assert.ok(harness.actions.trellisChangeMapHistory);
    assert.match(harness.document.body.textContent, /History/);
    assert.equal(harness.dbBridge.state.events[0].category, "System");
    assert.equal(harness.layer.getAttribute("trellis_history_id").startsWith("diagram_"), true);
});

test('shared history imports are idempotent and retain original attribution without re-export events', async () => { // NEW
    const harness = loadPlugin();
    await settle(20);
    const history = harness.context.window.Trellis.history;
    const compressedXml = '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>';
    const encoded = encodeRevision(compressedXml); // NEW
    const entry = { version: 2, generation: 'local-v2', // CHANGE
        revision: { id: 'remote-revision', diagramHistoryId: history.getDiagramId(), actorUserId: 'remote-user', actorName: 'Remote', actorRole: 'regular', timestamp: Date.now(), category: 'Diagram', action: 'change', origin: 'remote', title: 'Remote saved work', parentRevisionId: 'not-yet-arrived' },
        record: { ...encoded, payload: encoded.payload.toString('base64'), hash: encoded.contentHash }
    };
    await harness.dbBridge.service.run('import', { entry }); // NEW: the transport verifies and stores before notifying the renderer.
    let exported = 0;
    harness.context.window.addEventListener('trellisHistoryRevisionRecorded', () => exported++);
    await history.importShared(entry);
    await history.importShared(entry);
    assert.equal(harness.dbBridge.state.events.filter(row => row.id === 'remote-revision').length, 1);
    assert.equal(history.list().find(row => row.id === 'remote-revision').actorUserId, 'remote-user');
    assert.equal(history.list().find(row => row.id === 'remote-revision').parentRevisionId, 'not-yet-arrived');
    assert.equal(exported, 0);
});

test("history panel takes over and restores the format sidebar", async () => {
    const harness = loadPlugin();
    await settle();
    const nativeFormat = harness.document.getElementById("native-format");
    const originalRefresh = harness.ui.format.refresh;
    const originalImmediateRefresh = harness.ui.format.immediateRefresh;
    const originalClear = harness.ui.format.clear;
    assert.equal(nativeFormat.parentNode, harness.formatContainer);
    harness.actions.trellisChangeMapHistory.funct();
    assert.equal(harness.ui.formatWidth, 340);
    assert.equal(harness.ui.refreshed, true);
    assert.ok(harness.firedEvents.includes("formatWidthChanged"));
    assert.match(harness.formatContainer.textContent, /ChangeMap History/);
    assert.notEqual(nativeFormat.parentNode, harness.formatContainer);
    assert.notEqual(harness.ui.format.refresh, originalRefresh);
    assert.notEqual(harness.ui.format.immediateRefresh, originalImmediateRefresh);
    assert.notEqual(harness.ui.format.clear, originalClear);
    assert.equal(harness.ui.format.refreshCalls, 0);
    harness.ui.format.refresh();
    harness.ui.format.immediateRefresh();
    harness.ui.format.clear();
    assert.match(harness.formatContainer.textContent, /ChangeMap History/);
    assert.equal(harness.ui.format.refreshCalls, 0);
    assert.equal(harness.ui.format.clearCalls, 0);
    harness.actions.trellisChangeMapHistory.funct();
    assert.equal(harness.ui.formatWidth, 0);
    assert.equal(harness.ui.format.refresh, originalRefresh);
    assert.equal(harness.ui.format.immediateRefresh, originalImmediateRefresh);
    assert.equal(harness.ui.format.clear, originalClear);
    assert.equal(harness.ui.format.refreshCalls, 1);
    assert.equal(harness.ui.format.clearCalls, 1);
    assert.equal(harness.document.getElementById("native-format").parentNode, harness.formatContainer);
    assert.doesNotMatch(harness.formatContainer.textContent, /ChangeMap History/);
});

test("fileLoaded turns off ChangeMap and does not reopen history on the next diagram", async () => {
    const harness = loadPlugin();
    await settle();
    const originalRefresh = harness.ui.format.refresh;
    const originalImmediateRefresh = harness.ui.format.immediateRefresh;
    const originalClear = harness.ui.format.clear;
    harness.actions.trellisChangeMapHistory.funct();
    harness.context.window.Trellis.history._test.components.ChangeMapRenderer.enable("createdmap");
    harness.graph.__ccHistorySelectedId = "old-revision";
    harness.graph.__ccFiltered = [{ cell: harness.cell, ts: 1 }];
    harness.graph.__ccNavIndex = 0;
    const overlay = harness.document.createElement("div");
    harness.document.body.appendChild(overlay);
    harness.graph.__ccHistoryCompareOverlays = [overlay];
    assert.equal(harness.graph.__ccMode, "createdmap");
    assert.ok(harness.graph.__ccApplyTimer);
    assert.match(harness.formatContainer.textContent, /ChangeMap History/);
    harness.fireEditorEvent("fileLoaded");
    await settle();
    assert.equal(harness.graph.__ccMode, "none");
    assert.equal(harness.graph.__ccPanelVisible, false);
    assert.equal(harness.graph.__ccApplyTimer, null);
    assert.equal(harness.graph.__ccFiltered.length, 0);
    assert.equal(harness.graph.__ccHistorySelectedId, null);
    assert.equal(harness.graph.__ccHistoryCompareOverlays.length, 0);
    assert.equal(overlay.parentNode, null);
    assert.equal(harness.ui.formatWidth, 0);
    assert.equal(harness.ui.format.refresh, originalRefresh);
    assert.equal(harness.ui.format.immediateRefresh, originalImmediateRefresh);
    assert.equal(harness.ui.format.clear, originalClear);
    assert.equal(harness.document.getElementById("native-format").parentNode, harness.formatContainer);
    assert.doesNotMatch(harness.formatContainer.textContent, /ChangeMap History/);
    harness.fireEditorEvent("fileLoaded");
    await settle();
    assert.equal(harness.graph.__ccMode, "none");
    assert.equal(harness.graph.__ccPanelVisible, false);
    assert.doesNotMatch(harness.formatContainer.textContent, /ChangeMap History/);
});

test("semantic run records outer category and nested category as a tag", async () => {
    const harness = loadPlugin({ instantTimers: true });
    await settle();
    harness.setSerialized("<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1' value='changed'><mxGeometry x='10' y='20' width='80' height='40' as='geometry'/></mxCell></root></mxGraphModel>");
    harness.context.window.Trellis.history.run({ category: "Garden scheduling", action: "generate", title: "Generate schedule" }, () => {
        harness.context.window.Trellis.history.run({ category: "Tasks", action: "sync", title: "Sync tasks" }, () => {
            harness.model.fireChange({ changes: [{ constructor: { name: "mxValueChange" }, cell: harness.cell }] });
        });
    });
    await settle();
    const event = harness.dbBridge.state.events[harness.dbBridge.state.events.length - 1];
    assert.equal(event.category, "Garden scheduling");
    assert.equal(event.title, "Generate schedule");
    assert.deepEqual(JSON.parse(event.tags_json), ["Tasks"]);
    assert.deepEqual(JSON.parse(event.affected_cell_ids), ["cell-a"]);
    const metadata = JSON.parse(event.metadata_json);
    assert.deepEqual(metadata.bounds, { x: 10, y: 20, width: 80, height: 40 });
    assert.deepEqual(metadata.center, { x: 50, y: 40 });
});

test("history metadata includes the active Trellis user actor", async () => {
    const harness = loadPlugin({
        instantTimers: true,
        users: {
            withActorMetadata(metadata) { return Object.assign({}, metadata, { actorUserId: "user_alice", actorName: "Alice", actorRole: "admin" }); },
            listUsers() { return [{ id: "user_alice", name: "Alice", admin: true }]; }
        }
    });
    await settle();
    harness.setSerialized("<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1' value='actor'><mxGeometry x='10' y='20' width='80' height='40' as='geometry'/></mxCell></root></mxGraphModel>");
    harness.context.window.Trellis.history.run({ category: "Tasks", action: "actor", title: "Actor change" }, () => {
        harness.model.fireChange({ changes: [{ constructor: { name: "mxValueChange" }, cell: harness.cell }] });
    });
    await settle();
    const event = harness.dbBridge.state.events[harness.dbBridge.state.events.length - 1];
    const metadata = JSON.parse(event.metadata_json);
    assert.equal(metadata.actorUserId, "user_alice");
    assert.equal(metadata.actorName, "Alice");
    assert.equal(metadata.actorRole, "admin");
});

test("history event targets accept explicit semantic bounds and union multi-cell model bounds", async () => {
    const harness = loadPlugin({ instantTimers: true });
    await settle();
    harness.setSerialized("<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1' value='changed'/><mxCell id='cell-b' parent='1' value='changed'/></root></mxGraphModel>");
    const cellB = appendChild(harness.layer, makeXmlCell(harness.document, "cell-b", { label: "B" }));
    cellB.geometry = { x: 120, y: 70, width: 30, height: 20 };
    harness.model.index(cellB);
    harness.context.window.Trellis.history.run({ category: "Tasks", action: "bulk", title: "Bulk task update" }, () => {
        harness.model.fireChange({ changes: [{ constructor: { name: "mxGeometryChange" }, cell: harness.cell }, { constructor: { name: "mxGeometryChange" }, cell: cellB }] });
    });
    await settle();
    let metadata = JSON.parse(harness.dbBridge.state.events[harness.dbBridge.state.events.length - 1].metadata_json);
    assert.deepEqual(metadata.bounds, { x: 10, y: 20, width: 140, height: 70 });
    assert.deepEqual(metadata.center, { x: 80, y: 55 });

    harness.setSerialized("<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1' value='explicit'/></root></mxGraphModel>");
    harness.context.window.Trellis.history.run({ category: "Tasks", action: "explicit", title: "Explicit target", bounds: { x: 200, y: 300, width: 40, height: 60 }, center: { x: 220, y: 330 } }, () => {
        harness.model.fireChange({ changes: [{ constructor: { name: "mxValueChange" }, cell: harness.cell }] });
    });
    await settle();
    metadata = JSON.parse(harness.dbBridge.state.events[harness.dbBridge.state.events.length - 1].metadata_json);
    assert.deepEqual(metadata.bounds, { x: 200, y: 300, width: 40, height: 60 });
    assert.deepEqual(metadata.center, { x: 220, y: 330 });
});

test('history pages retain access to old revisions while recording stays bounded', async t => { // NEW
    const h = loadPlugin({ instantTimers: true }); // NEW
    t.after(() => { h.dbBridge.service.close(); h.context.window.close(); }); // NEW
    await settle(); const api = h.context.window.Trellis.history, diagramId = api.getDiagramId(); // NEW
    for (let index = 0; index < 125; index++) { // NEW
        const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><object id="a" label="Edit '+index+'"><mxCell parent="1" vertex="1"/></object></root></mxGraphModel>'; // NEW
        await h.dbBridge.service.run('record',{diagramId,xml,metadata:{id:'old-'+index,title:'Edit '+index,timestamp:1000+index}}); // NEW
    } // NEW
    await api.refresh(); assert.equal(api.list().length,100); // NEW
    h.actions.trellisChangeMapHistory.funct(); await settle(); // NEW
    const older = Array.from(h.document.querySelectorAll('button')).find(button => button.textContent === 'Older revisions'); // NEW
    assert.ok(older); assert.equal(older.disabled,false); older.click(); await settle(); // NEW
    assert.equal(h.graph.__ccHistoryOffset,100); assert.ok(api.list().some(revision => revision.id === 'old-0')); // NEW
    const oldPage = api.list().map(revision => revision.id).join(','); // NEW
    await api.createCheckpoint('New checkpoint while browsing'); // NEW
    assert.equal(api.list().map(revision => revision.id).join(','),oldPage); // NEW
    const newer = Array.from(h.document.querySelectorAll('button')).find(button => button.textContent === 'Newer revisions'); // NEW
    newer.click(); await settle(); assert.equal(api.list().length,100); assert.ok(api.list().some(revision => revision.title === 'New checkpoint while browsing')); // NEW
}); // NEW

test("history panel filters revisions and restore loads the selected snapshot", async () => {
    const harness = loadPlugin({ instantTimers: true });
    const lifecycle = [];
    const audits = [];
    harness.context.window.addEventListener("trellisHistoryBeforeRestore", ev => { lifecycle.push("before"); audits.push(ev.detail.audit); assert.equal(harness.context.window.Trellis.history.isRestoring(), true); });
    harness.context.window.addEventListener("trellisHistoryAfterRestore", ev => { lifecycle.push("after"); audits.push(ev.detail.audit); assert.equal(harness.context.window.Trellis.history.isRestoring(), true); });
    harness.context.window.addEventListener("trellisHistoryCompareCleared", () => lifecycle.push("cleared"));
    await settle();
    harness.actions.trellisChangeMapHistory.funct();
    harness.setSerialized("<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1' value='restored'><mxGeometry x='30' y='40' width='90' height='45' as='geometry'/></mxCell></root></mxGraphModel>");
    await harness.context.window.Trellis.history.createCheckpoint("Manual checkpoint");
    await settle();
    const filter = harness.document.querySelector("select:last-of-type");
    filter.value = "History";
    filter.dispatchEvent(new harness.context.window.Event("change"));
    assert.match(harness.document.body.textContent, /Manual checkpoint/);
    const revision = harness.context.window.Trellis.history.list().find(entry => entry.title === "Manual checkpoint");
    assert.ok(revision, "missing checkpoint revision");
    harness.context.window.Trellis.history._test.components.HistoryRail.select(revision.id);
    assert.deepEqual(harness.graph.fitted.bounds, revision.bounds);
    assert.equal(harness.graph.fitted.border, 16);
    assert.equal(harness.graph.scrolled, undefined);
    const restoreResult = await harness.context.window.Trellis.history.restore(revision.id);
    await settle();
    assert.equal(restoreResult, true);
    assert.equal(harness.context.window.Trellis.history.isRestoring(), false);
    assert.match(harness.restoredXml(), /value='restored'|value="restored"/);
    assert.equal(harness.ui.undoCleared, true);
    assert.deepEqual(lifecycle.filter(name => name === "before" || name === "after"), ["before", "after"]);
    assert.ok(lifecycle.includes("cleared"));
    assert.equal(audits.length, 2);
    assert.equal(audits[0], audits[1]);
    const audit = harness.context.window.Trellis.history.getLastRestoreAudit();
    assert.equal(audit.sourceRevisionId, revision.id);
    assert.equal(audit.loadedHash, audit.afterRehydrateHash);
    assert.equal(audit.warnings.length, 0);
    assert.match(harness.document.body.textContent, /Graph restored\. External Trellis data was not rolled back\./);
    const restoreRevision = harness.context.window.Trellis.history.list().find(entry => entry.restoredFromRevisionId === revision.id);
    assert.ok(restoreRevision, "missing restore revision");
    assert.equal(restoreRevision.restoreAudit.sourceRevisionId, revision.id);
});

test("history compare reports added changed and deleted revisions", async () => {
    const harness = loadPlugin();
    await settle();
    const oldXml = "<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1' value='old'><mxGeometry x='10' y='20' width='80' height='40' as='geometry'/></mxCell><mxCell id='cell-deleted' parent='1'><mxGeometry x='70' y='80' width='25' height='25' as='geometry'/></mxCell></root></mxGraphModel>";
    const currentXml = "<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1' value='new'><mxGeometry x='10' y='20' width='80' height='40' as='geometry'/></mxCell><mxCell id='cell-added' parent='1'><mxGeometry x='100' y='120' width='30' height='30' as='geometry'/></mxCell></root></mxGraphModel>";
    const diff = harness.context.window.Trellis.history._test.diffSnapshotWithCurrent(oldXml, currentXml);
    assert.deepEqual(Array.from(diff.added), ["cell-added"]);
    assert.deepEqual(Array.from(diff.changed), ["cell-a"]);
    assert.deepEqual(Array.from(diff.deleted).map(entry => entry.id), ["cell-deleted"]);
});

test("history event targets preserve deleted-cell and diff fallback bounds", async () => {
    const oldXml = "<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1'><mxGeometry x='10' y='20' width='80' height='40' as='geometry'/></mxCell><mxCell id='cell-deleted' parent='1'><mxGeometry x='70' y='80' width='25' height='25' as='geometry'/></mxCell></root></mxGraphModel>";
    const currentXml = "<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1'><mxGeometry x='10' y='20' width='80' height='40' as='geometry'/></mxCell></root></mxGraphModel>";
    const harness = loadPlugin({ instantTimers: true, serialized: oldXml });
    await settle();
    harness.setSerialized(currentXml);
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, previous: { id: "cell-deleted" } }] });
    await settle();
    let metadata = JSON.parse(harness.dbBridge.state.events[harness.dbBridge.state.events.length - 1].metadata_json);
    assert.deepEqual(metadata.bounds, { x: 70, y: 80, width: 25, height: 25 });
    assert.deepEqual(metadata.center, { x: 82.5, y: 92.5 });

    const fallback = loadPlugin({ instantTimers: true, serialized: oldXml });
    await settle();
    fallback.setSerialized("<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1' value='changed'><mxGeometry x='30' y='40' width='90' height='45' as='geometry'/></mxCell><mxCell id='cell-deleted' parent='1'><mxGeometry x='70' y='80' width='25' height='25' as='geometry'/></mxCell></root></mxGraphModel>");
    fallback.model.fireChange({ changes: [{ constructor: { name: "mxValueChange" } }] });
    await settle();
    metadata = JSON.parse(fallback.dbBridge.state.events[fallback.dbBridge.state.events.length - 1].metadata_json);
    assert.deepEqual(metadata.bounds, { x: 30, y: 40, width: 90, height: 45 });
    assert.deepEqual(metadata.center, { x: 75, y: 62.5 });
});

test("history compare handles corrupt compressed snapshots without throwing", async () => {
    const harness = loadPlugin({ instantTimers: true, Graph: { decompress() { throw new Error("bad snapshot"); } } });
    await settle();
    await harness.context.window.Trellis.history.createCheckpoint("Corrupt checkpoint");
    await settle();
    const revision = harness.context.window.Trellis.history.list().find(entry => entry.title === "Corrupt checkpoint");
    harness.dbBridge.corrupt(revision.id); // CHANGE: corrupt the actual stored payload.
    harness.context.window.Trellis.history._test.components.HistoryRail.select(revision.id);
    await harness.context.window.Trellis.history._test.components.ChangeMapRenderer.compare();
    assert.match(harness.graph.__ccHistoryWarning, /unreadable/);
});

test("history restore rejects corrupt snapshots without replacing graph or recording restore", async () => {
    const harness = loadPlugin({ instantTimers: true, Graph: { decompress() { throw new Error("bad snapshot"); } } });
    await settle();
    await harness.context.window.Trellis.history.createCheckpoint("Corrupt restore checkpoint");
    await settle();
    const revision = harness.context.window.Trellis.history.list().find(entry => entry.title === "Corrupt restore checkpoint");
    harness.dbBridge.corrupt(revision.id); // CHANGE: corrupt the actual stored payload.
    const node = harness.document.createElement("div");
    harness.document.body.appendChild(node);
    harness.graph.__ccHistoryCompareOverlays = [node];
    const beforeCount = harness.context.window.Trellis.history.list().length;
    const result = await harness.context.window.Trellis.history.restore(revision.id);
    await settle();
    assert.equal(result, false);
    assert.equal(harness.restoredXml(), null);
    assert.equal(harness.context.window.Trellis.history.list().length, beforeCount);
    assert.equal(harness.context.window.Trellis.history.list().some(entry => entry.restoredFromRevisionId === revision.id), false);
    assert.equal(node.parentNode, null);
    const audit = harness.context.window.Trellis.history.getLastRestoreAudit();
    assert.equal(audit.sourceRevisionId, revision.id);
    assert.equal(audit.warnings[0].code, "unreadableSnapshot");
    assert.match(harness.graph.__ccHistoryWarning, /unreadable/);
});

test("history restore warns when after-restore rehydration mutates the graph", async () => {
    const harness = loadPlugin({ instantTimers: true });
    await settle();
    harness.setSerialized("<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1' value='restore-target'><mxGeometry x='10' y='20' width='80' height='40' as='geometry'/></mxCell></root></mxGraphModel>");
    await harness.context.window.Trellis.history.createCheckpoint("Mutation checkpoint");
    await settle();
    const revision = harness.context.window.Trellis.history.list().find(entry => entry.title === "Mutation checkpoint");
    harness.context.window.addEventListener("trellisHistoryAfterRestore", () => {
        assert.equal(harness.context.window.Trellis.history.isRestoring(), true);
        harness.setSerialized("<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1' value='mutated-after-restore'><mxGeometry x='10' y='20' width='80' height='40' as='geometry'/></mxCell></root></mxGraphModel>");
    });
    const result = await harness.context.window.Trellis.history.restore(revision.id);
    await settle();
    assert.equal(result, true);
    const audit = harness.context.window.Trellis.history.getLastRestoreAudit();
    assert.notEqual(audit.loadedHash, audit.afterRehydrateHash);
    assert.equal(audit.warnings.some(entry => entry.code === "rehydrationMutatedGraph"), true);
    assert.match(harness.graph.__ccHistoryWarning, /Plugin rehydration changed the graph/);
    const restoreRevision = harness.context.window.Trellis.history.list().find(entry => entry.restoredFromRevisionId === revision.id);
    assert.equal(restoreRevision.restoreAudit.warnings.some(entry => entry.code === "rehydrationMutatedGraph"), true);
});

test("history degrades when dbBridge is unavailable", async () => {
    const harness = loadPlugin({ dbBridge: false });
    await settle();
    harness.actions.trellisChangeMapHistory.funct();
    assert.match(harness.document.body.textContent, /History storage is unavailable/);
});

test("rejected user edits are not recorded even when rejection is marked by a later listener", async () => {
    const harness = loadPlugin({ instantTimers: true });
    await settle();
    const before = harness.dbBridge.state.events.length;
    harness.model.addListener("change", (_sender, evt) => {
        const edit = evt && evt.getProperty && evt.getProperty("edit");
        if (edit) edit.__trellisUsersRejected = true;
    });
    harness.model.fireChange({ changes: [{ constructor: { name: "mxValueChange" }, cell: harness.cell }] });
    await settle();
    assert.equal(harness.dbBridge.state.events.length, before);
});

test("user map filter dims nonmatching cells when time slicing is disabled", async () => {
    const harness = loadPlugin({ instantTimers: true });
    await settle();
    const cellB = appendChild(harness.layer, makeXmlCell(harness.document, "cell-b", { label: "B" }));
    cellB.geometry = { x: 120, y: 20, width: 80, height: 40 };
    harness.model.index(cellB);
    harness.cell.setAttribute("createdAt", "1000");
    harness.cell.setAttribute("createdByUserId", "alice");
    cellB.setAttribute("createdAt", "2000");
    cellB.setAttribute("createdByUserId", "bob");
    harness.graph.__ccWindowValue = 0;
    harness.graph.__ccUserFilter = "user:alice";
    harness.context.window.Trellis.history._test.components.ChangeMapRenderer.enable("createdmap");
    await settle();
    assert.match(harness.cell.style, /strokeOpacity=100/);
    assert.match(cellB.style, /strokeColor=#c7c7cc/);
    assert.match(cellB.style, /strokeOpacity=25/);
});

test("domain plugins declare semantic history transactions and restore listeners", () => {
    const scheduler = fs.readFileSync(path.join(pluginDir, "Garden_Scheduler_Dialog.js"), "utf8");
    const taskManager = fs.readFileSync(path.join(pluginDir, "Garden_Task_Manager.js"), "utf8");
    const irrigation = fs.readFileSync(path.join(pluginDir, "Garden_Irrigation_Planner.js"), "utf8");
    const linking = fs.readFileSync(path.join(pluginDir, "Vertex_Linking_Standalone.js"), "utf8");
    assert.match(scheduler, /category:\s*"Garden scheduling"[\s\S]*action:\s*"saveSchedule"/);
    assert.match(taskManager, /category:\s*"Assignments"[\s\S]*action:\s*"assign"/);
    assert.match(taskManager, /category:\s*replacement\.mode === 'sync' \? "Garden scheduling" : "Tasks"/);
    assert.match(irrigation, /category:\s*"Irrigation"[\s\S]*action:\s*label/);
    assert.match(linking, /category:\s*"Data"[\s\S]*tags:\s*\["Links"\]/);
    assert.match(taskManager, /trellisHistoryBeforeRestore[\s\S]*cancelPendingKanbanRepairs/);
    assert.match(taskManager, /if \(isTrellisHistoryRestoring\(\)\) \{ cancelPendingKanbanRepairs\(\); return; \}/);
    assert.match(taskManager, /function repairChangedCards[\s\S]*if \(isTrellisHistoryRestoring\(\)\) return;/);
    assert.match(irrigation, /trellisHistoryBeforeRestore[\s\S]*cancelPendingHudGraphStateSync/);
    assert.match(irrigation, /function syncHudGraphState[\s\S]*if \(isTrellisHistoryRestoring\(\)\) return \[\];/);
    assert.match(linking, /trellisHistoryBeforeRestore[\s\S]*clearAllHighlights/);
    assert.match(taskManager, /trellisHistoryAfterRestore/);
    assert.match(irrigation, /trellisHistoryAfterRestore/);
    assert.match(linking, /trellisHistoryAfterRestore/);
});

/** Deferred XML is owned by the document that requested it, not the document current when it resolves. */ // NEW
test('late history XML cannot initialize a replacement document or overwrite its successful state', async () => { // NEW
    const first = { fileObject: { path: '/first' }, stat: { size: 1024 } }, next = { fileObject: { path: '/next' }, stat: { size: 2048 } }, h = loadPlugin({ file: first }); // NEW
    let current = first, release, reads = 0; const gate = new Promise(resolve => { release = resolve; }), requests = [], request = h.dbBridge.request; // NEW
    h.ui.getCurrentFile = () => current; h.dbBridge.request = (method, input) => { requests.push({ method, input }); return request(method, input); }; // NEW
    const xml = label => '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><object id="note" label="'+label+'"><mxCell parent="1" vertex="1"/></object></root></mxGraphModel>'; // NEW
    h.graph.__trellisSharing = { whenDocumentReady: async () => {}, isExplicitRefresh: () => true, historyXml: async () => ++reads === 1 ? gate : xml('Second') }; // NEW
    await settle(); current = next; h.layer.setAttribute('trellis_history_id', 'next-document'); h.fireEditorEvent('fileLoaded'); await settle(); // NEW
    release(xml('First')); await settle(); await h.context.window.Trellis.history.refresh(); // NEW
    const initialized = requests.filter(item => item.method === 'initialize'); assert.equal(initialized.length, 1); assert.equal(initialized[0].input.diagramId, 'next-document'); assert.match(initialized[0].input.xml, /Second/); // NEW
    assert.doesNotMatch(h.document.body.textContent, /History initialization failed/); h.dbBridge.service.close(); h.context.window.close(); // NEW
}); // NEW

/** Fix the initialization failure, then verify recovery and independent diagram accounting. */ // NEW
test('history refresh retries failed initialization and keeps diagram size when statistics fail', async () => { // NEW
    const file = { fileObject: { path: '/garden' }, stat: { size: 2048 } }, h = loadPlugin({ file }), request = h.dbBridge.request; let fail = true, statisticsFail = false; // NEW
    h.dbBridge.request = (method, input) => { if (method === 'initialize' && fail) return Promise.reject(new Error('Injected initialization failure')); if (method === 'statistics' && statisticsFail) return Promise.reject(new Error('Injected statistics failure')); return request(method, input); }; // NEW
    await settle(); assert.match(h.document.querySelector('.trellis-history-storage-button').textContent, /Diagram 2.0 KiB.*History error/); // NEW
    fail = false; await h.context.window.Trellis.history.refresh(); assert.ok(h.context.window.Trellis.history.list().length); // NEW
    statisticsFail = true; await h.context.window.Trellis.history.refreshStorage(); assert.match(h.document.querySelector('.trellis-history-storage-button').textContent, /Diagram 2.0 KiB.*History error/); // NEW
    statisticsFail = false; await h.context.window.Trellis.history.refreshStorage(); assert.doesNotMatch(h.document.querySelector('.trellis-history-storage-button').textContent, /History error/); h.dbBridge.service.close(); h.context.window.close(); // NEW
}); // NEW

/** A fresh visit to A has a new generation even if the same File and diagram IDs are reused. */ // NEW
test('rapid A to B to A switching discards old successes and failures', async () => { // NEW
    const a = { fileObject: { path: '/a' } }, b = { fileObject: { path: '/b' } }, h = loadPlugin({ file: a }); let current = a, releaseA, rejectB, reads = 0; // NEW
    const oldA = new Promise(resolve => { releaseA = resolve; }), oldB = new Promise((_resolve, reject) => { rejectB = reject; }), requests = [], request = h.dbBridge.request; // NEW
    h.ui.getCurrentFile = () => current; h.dbBridge.request = (method, input) => { requests.push({ method, input }); return request(method, input); }; // NEW
    const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><object id="note" label="Latest A"><mxCell parent="1" vertex="1"/></object></root></mxGraphModel>'; // NEW
    h.graph.__trellisSharing = { whenDocumentReady: async () => {}, isExplicitRefresh: () => true, historyXml: async () => ++reads === 1 ? oldA : reads === 2 ? oldB : xml }; // NEW
    await settle(); const id = h.layer.getAttribute('trellis_history_id'); current = b; h.layer.setAttribute('trellis_history_id', 'document-b'); h.fireEditorEvent('fileLoaded'); await settle(); // NEW
    current = a; h.layer.setAttribute('trellis_history_id', id); h.fireEditorEvent('fileLoaded'); await settle(); rejectB(new Error('Obsolete B failed')); releaseA(xml.replace('Latest A', 'Obsolete A')); await settle(); // NEW
    await h.context.window.Trellis.history.refresh(); const initialized = requests.filter(item => item.method === 'initialize'); assert.equal(initialized.length, 1); assert.match(initialized[0].input.xml, /Latest A/); assert.doesNotMatch(h.document.body.textContent, /Obsolete/); // NEW
    h.dbBridge.service.close(); h.context.window.close(); // NEW
}); // NEW

/** Same-actor policy updates are common during open-view and must not repeatedly bind history. */ // NEW
test('permission revalidation preserves the existing history context and recording warnings survive statistics refresh', async () => { // NEW
    const h = loadPlugin(), request = h.dbBridge.request; let initialized = 0, failRecording = false; // NEW
    h.dbBridge.request = (method, input) => { if (method === 'initialize') initialized++; if (method === 'record' && failRecording) return Promise.reject(new Error('Recording disk full')); return request(method, input); }; // NEW
    await settle(); const count = initialized; h.context.window.dispatchEvent(new h.context.window.CustomEvent('trellisUsersSessionChanged')); await settle(); assert.equal(initialized, count); // NEW
    failRecording = true; await h.context.window.Trellis.history.createCheckpoint('Rejected checkpoint'); await h.context.window.Trellis.history.refreshStorage(); // NEW
    assert.match(h.document.querySelector('.trellis-history-storage-button').title, /History recording failed: Recording disk full/); // NEW
    failRecording = false; await h.context.window.Trellis.history.createCheckpoint('Recovered checkpoint'); assert.doesNotMatch(h.document.querySelector('.trellis-history-storage-button').title, /Recording disk full/); assert.doesNotMatch(h.graph.__ccHistoryWarning || '', /Recording disk full/); // NEW
    h.dbBridge.service.close(); h.context.window.close(); // NEW
}); // NEW

/** Main-process replies may reject after the renderer has already initialized another document. */ // NEW
test('an old latest-revision failure cannot overwrite the replacement document warning', async () => { // NEW
    const a = { fileObject: { path: '/a' } }, b = { fileObject: { path: '/b' } }, h = loadPlugin({ file: a }), request = h.dbBridge.request; let rejectOld, held = false, current = a; // NEW
    h.ui.getCurrentFile = () => current; h.dbBridge.request = (method, input) => { if (method === 'latest' && !held) { held = true; return new Promise((_resolve, reject) => { rejectOld = reject; }); } return request(method, input); }; // NEW
    await settle(); assert.ok(rejectOld); current = b; h.layer.setAttribute('trellis_history_id', 'new-document'); h.fireEditorEvent('fileLoaded'); await settle(); rejectOld(new Error('Obsolete native failure')); await settle(); // NEW
    assert.doesNotMatch(h.graph.__ccHistoryWarning || '', /Obsolete/); assert.doesNotMatch(h.document.body.textContent, /Obsolete/); h.dbBridge.service.close(); h.context.window.close(); // NEW
}); // NEW
