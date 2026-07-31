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

function createDbBridge() {
    const state = { snapshots: new Map(), events: [], execs: [] };
    return {
        state,
        resolvePath() { return Promise.resolve({ ok: true, dbPath: "C:/Users/user/AppData/Roaming/draw.io/trellis_database/Trellis_history.sqlite" }); },
        open() { return Promise.resolve({ ok: true, dbId: "history-db" }); },
        exec(dbId, sql, params = []) {
            state.execs.push({ sql, params });
            if (/INSERT OR IGNORE INTO history_snapshots/.test(sql)) {
                state.snapshots.set(params[0], { snapshot_id: params[0], diagram_id: params[1], hash: params[2], compressed_kind: params[3], compressed_xml: params[4], byte_size: params[5], checksum: params[6] });
            }
            if (/INSERT INTO history_events/.test(sql)) {
                state.events.push({ id: params[0], diagram_id: params[1], timestamp: params[2], category: params[3], action: params[4], origin: params[5], title: params[6], affected_cell_ids: params[7], change_types: params[8], counts_json: params[9], snapshot_id: params[10], parent_revision_id: params[11], restored_from_revision_id: params[12], tags_json: params[13], metadata_json: params[14], checkpoint: params[15], diagram_hash: params[16] });
            }
            return Promise.resolve({ ok: true, changes: 1, lastInsertRowid: "1" });
        },
        query(dbId, sql, params = []) {
            if (/SELECT \* FROM history_events/.test(sql) && /ORDER BY timestamp DESC/.test(sql)) {
                return Promise.resolve({ ok: true, rows: state.events.slice(-1) });
            }
            if (/SELECT \* FROM history_events/.test(sql)) {
                return Promise.resolve({ ok: true, rows: state.events.filter(row => row.diagram_id === params[0]) });
            }
            if (/SELECT \* FROM history_snapshots/.test(sql)) {
                return Promise.resolve({ ok: true, rows: [state.snapshots.get(params[0])].filter(Boolean) });
            }
            return Promise.resolve({ ok: true, rows: [] });
        }
    };
}

function loadPlugin(options = {}) {
    const dom = new JSDOM("<!doctype html><body><div id='host'><div id='format'><div id='native-format'>Format</div></div><div id='graph'></div></div></body>", { url: "https://app.test/" });
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
    context.window.dbBridge = dbBridge;
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
    const snapshot = harness.dbBridge.state.snapshots.get(revision.snapshotId);
    snapshot.compressed_kind = "graph-compress";
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
    const snapshot = harness.dbBridge.state.snapshots.get(revision.snapshotId);
    snapshot.compressed_kind = "graph-compress";
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
