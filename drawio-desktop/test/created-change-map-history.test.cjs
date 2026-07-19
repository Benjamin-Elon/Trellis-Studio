const assert = require("node:assert/strict"); // NEW
const fs = require("node:fs"); // NEW
const path = require("node:path"); // NEW
const test = require("node:test"); // NEW
const vm = require("node:vm"); // NEW
const { JSDOM } = require("jsdom"); // NEW

const projectRoot = path.resolve(__dirname, ".."); // NEW
const pluginPath = path.join(projectRoot, "drawio/src/main/webapp/plugins/garden_planner_plugins/Created_Change_Map.js"); // NEW
const pluginDir = path.join(projectRoot, "drawio/src/main/webapp/plugins/garden_planner_plugins"); // NEW

class TestCell { // NEW
    constructor(id, value = null, style = "") { // NEW
        this.id = id; // NEW
        this.value = value; // NEW
        this.style = style; // NEW
        this.children = []; // NEW
        this.geometry = { x: 0, y: 0, width: 80, height: 40 }; // NEW
    } // NEW
    getId() { return this.id; } // NEW
    getStyle() { return this.style; } // NEW
    getAttribute(key) { return this.value && this.value.nodeType === 1 ? this.value.getAttribute(key) : null; } // NEW
    setAttribute(key, value) { if (this.value && this.value.nodeType === 1) this.value.setAttribute(key, value); } // NEW
    removeAttribute(key) { if (this.value && this.value.nodeType === 1) this.value.removeAttribute(key); } // NEW
} // NEW

class TestModel { // NEW
    constructor(root) { // NEW
        this.root = root; // NEW
        this.listeners = new Map(); // NEW
        this.cells = new Map(); // NEW
        this.index(root); // NEW
    } // NEW
    index(cell) { this.cells.set(cell.id, cell); (cell.children || []).forEach(child => this.index(child)); } // NEW
    getRoot() { return this.root; } // NEW
    getParent(cell) { return cell && cell.parent ? cell.parent : null; } // NEW
    getChildCount(cell) { return cell && cell.children ? cell.children.length : 0; } // NEW
    getChildAt(cell, index) { return cell.children[index]; } // NEW
    getCell(id) { return this.cells.get(id) || null; } // NEW
    isVertex(cell) { return !!cell && cell !== this.root; } // NEW
    isEdge() { return false; } // NEW
    beginUpdate() {} // NEW
    endUpdate() {} // NEW
    setValue(cell, value) { cell.value = value; } // NEW
    setStyle(cell, style) { cell.style = style; } // NEW
    addListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(fn); } // NEW
    fireChange(edit) { (this.listeners.get("change") || []).forEach(fn => fn(this, { getProperty: key => key === "edit" ? edit : null })); } // NEW
} // NEW

function appendChild(parent, child) { // NEW
    child.parent = parent; // NEW
    parent.children.push(child); // NEW
    return child; // NEW
} // NEW

function makeXmlCell(document, id, attrs = {}) { // NEW
    const node = document.implementation.createDocument("", "", null).createElement("object"); // NEW
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value)); // NEW
    return new TestCell(id, node); // NEW
} // NEW

function createDbBridge() { // NEW
    const state = { snapshots: new Map(), events: [], execs: [] }; // NEW
    return { // NEW
        state, // NEW
        resolvePath() { return Promise.resolve({ ok: true, dbPath: "C:/Users/user/AppData/Roaming/draw.io/trellis_database/Trellis_history.sqlite" }); }, // NEW
        open() { return Promise.resolve({ ok: true, dbId: "history-db" }); }, // NEW
        exec(dbId, sql, params = []) { // NEW
            state.execs.push({ sql, params }); // NEW
            if (/INSERT OR IGNORE INTO history_snapshots/.test(sql)) { // NEW
                state.snapshots.set(params[0], { snapshot_id: params[0], diagram_id: params[1], hash: params[2], compressed_kind: params[3], compressed_xml: params[4], byte_size: params[5], checksum: params[6] }); // NEW
            } // NEW
            if (/INSERT INTO history_events/.test(sql)) { // NEW
                state.events.push({ id: params[0], diagram_id: params[1], timestamp: params[2], category: params[3], action: params[4], origin: params[5], title: params[6], affected_cell_ids: params[7], change_types: params[8], counts_json: params[9], snapshot_id: params[10], parent_revision_id: params[11], restored_from_revision_id: params[12], tags_json: params[13], metadata_json: params[14], checkpoint: params[15], diagram_hash: params[16] }); // NEW
            } // NEW
            return Promise.resolve({ ok: true, changes: 1, lastInsertRowid: "1" }); // NEW
        }, // NEW
        query(dbId, sql, params = []) { // NEW
            if (/SELECT \* FROM history_events/.test(sql) && /ORDER BY timestamp DESC/.test(sql)) { // NEW
                return Promise.resolve({ ok: true, rows: state.events.slice(-1) }); // NEW
            } // NEW
            if (/SELECT \* FROM history_events/.test(sql)) { // NEW
                return Promise.resolve({ ok: true, rows: state.events.filter(row => row.diagram_id === params[0]) }); // NEW
            } // NEW
            if (/SELECT \* FROM history_snapshots/.test(sql)) { // NEW
                return Promise.resolve({ ok: true, rows: [state.snapshots.get(params[0])].filter(Boolean) }); // NEW
            } // NEW
            return Promise.resolve({ ok: true, rows: [] }); // NEW
        } // NEW
    }; // NEW
} // NEW

function loadPlugin(options = {}) { // NEW
    const dom = new JSDOM("<!doctype html><body><div id='host'><div id='graph'></div></div></body>", { url: "https://app.test/" }); // NEW
    const document = dom.window.document; // NEW
    const root = new TestCell("root"); // NEW
    const layer = appendChild(root, makeXmlCell(document, "layer", { label: "Layer" })); // NEW
    const cell = appendChild(layer, makeXmlCell(document, "cell-a", { label: "A" })); // NEW
    cell.geometry = { x: 10, y: 20, width: 80, height: 40 }; // NEW
    const model = new TestModel(root); // NEW
    let serialized = options.serialized || "<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1'><mxGeometry x='10' y='20' width='80' height='40' as='geometry'/></mxCell></root></mxGraphModel>"; // NEW
    let restoredXml = null; // NEW
    const graphListeners = new Map(); // NEW
    const graph = { // NEW
        container: document.getElementById("graph"), // NEW
        popupMenuHandler: {}, // NEW
        view: { getState: target => ({ x: target.geometry.x, y: target.geometry.y, width: target.geometry.width, height: target.geometry.height }), addListener() {} }, // NEW
        getModel() { return model; }, // NEW
        getDefaultParent() { return layer; }, // NEW
        getSelectionCells() { return []; }, // NEW
        setSelectionCells(cells) { graph.selected = cells; }, // NEW
        setSelectionCell(cell) { graph.selected = [cell]; }, // NEW
        scrollCellToVisible(cellArg) { graph.scrolled = cellArg; }, // NEW
        fitWindow(bounds, border) { graph.fitted = { bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, border }; }, // NEW
        scrollRectToVisible(bounds) { graph.scrolledRect = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }; }, // NEW
        addListener(name, fn) { if (!graphListeners.has(name)) graphListeners.set(name, []); graphListeners.get(name).push(fn); }, // NEW
        refresh() { graph.refreshed = true; }, // NEW
        __trellisHistoryTestSerialize() { return serialized; }, // NEW
        __trellisHistoryTestRestore(xml) { restoredXml = xml; serialized = xml; } // NEW
    }; // NEW
    const actions = {}; // NEW
    const ui = { // NEW
        editor: { graph, undoManager: { clear() { ui.undoCleared = true; } } }, // NEW
        actions: { addAction(id, fn) { actions[id] = { funct: fn }; } }, // NEW
        menus: { get() { return null; }, addMenuItems() {} } // NEW
    }; // NEW
    const dbBridge = options.dbBridge === false ? null : createDbBridge(); // NEW
    const context = { // NEW
        window: dom.window, document, console, Promise, Error, String, Number, Math, Date, Set, Map, JSON, Graph: options.Graph, // NEW
        setTimeout: options.instantTimers ? fn => { fn(); return 1; } : setTimeout, // NEW
        clearTimeout, // NEW
        Draw: { loadPlugin(callback) { callback(ui); } }, // NEW
        mxEvent: { CHANGE: "change", CELLS_ADDED: "cellsAdded", PASTE: "paste", SCALE: "scale" }, // NEW
        mxUtils: { createXmlDocument() { return document.implementation.createDocument("", "", null); }, parseXml(xml) { return new dom.window.DOMParser().parseFromString(xml, "text/xml"); }, getXml(node) { return new dom.window.XMLSerializer().serializeToString(node); } }, // NEW
        requestAnimationFrame(fn) { fn(); } // NEW
    }; // NEW
    context.window.dbBridge = dbBridge; // NEW
    context.window.confirm = () => true; // NEW
    if (options.users) context.window.Trellis = { users: options.users }; // NEW
    vm.runInNewContext(fs.readFileSync(pluginPath, "utf8"), context, { filename: pluginPath }); // NEW
    return { context, document, graph, model, cell, layer, dbBridge, actions, restoredXml: () => restoredXml, setSerialized(xml) { serialized = xml; }, ui }; // NEW
} // NEW

async function settle(ms = 0) { // NEW
    await Promise.resolve(); // NEW
    await new Promise(resolve => setTimeout(resolve, ms)); // NEW
    await Promise.resolve(); // NEW
} // NEW

test("history API records a baseline and exposes a side-panel action", async () => { // NEW
    const harness = loadPlugin(); // NEW
    await settle(); // NEW
    assert.ok(harness.context.window.Trellis.history.run); // NEW
    assert.ok(harness.context.window.Trellis.history.getLastRestoreAudit); // NEW
    assert.ok(harness.context.window.Trellis.history._test.components.ChangeMapRenderer); // NEW
    assert.ok(harness.context.window.Trellis.history._test.components.HistoryRecorder); // NEW
    assert.ok(harness.context.window.Trellis.history._test.components.HistoryStore); // NEW
    assert.ok(harness.context.window.Trellis.history._test.components.HistoryRail); // NEW
    assert.ok(harness.actions.trellisChangeMapHistory); // NEW
    assert.match(harness.document.body.textContent, /History/); // NEW
    assert.equal(harness.dbBridge.state.events[0].category, "System"); // NEW
    assert.equal(harness.layer.getAttribute("trellis_history_id").startsWith("diagram_"), true); // NEW
}); // NEW

test("semantic run records outer category and nested category as a tag", async () => { // NEW
    const harness = loadPlugin({ instantTimers: true }); // NEW
    await settle(); // NEW
    harness.setSerialized("<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1' value='changed'><mxGeometry x='10' y='20' width='80' height='40' as='geometry'/></mxCell></root></mxGraphModel>"); // NEW
    harness.context.window.Trellis.history.run({ category: "Garden scheduling", action: "generate", title: "Generate schedule" }, () => { // NEW
        harness.context.window.Trellis.history.run({ category: "Tasks", action: "sync", title: "Sync tasks" }, () => { // NEW
            harness.model.fireChange({ changes: [{ constructor: { name: "mxValueChange" }, cell: harness.cell }] }); // NEW
        }); // NEW
    }); // NEW
    await settle(); // NEW
    const event = harness.dbBridge.state.events[harness.dbBridge.state.events.length - 1]; // NEW
    assert.equal(event.category, "Garden scheduling"); // NEW
    assert.equal(event.title, "Generate schedule"); // NEW
    assert.deepEqual(JSON.parse(event.tags_json), ["Tasks"]); // NEW
    assert.deepEqual(JSON.parse(event.affected_cell_ids), ["cell-a"]); // NEW
    const metadata = JSON.parse(event.metadata_json); // NEW
    assert.deepEqual(metadata.bounds, { x: 10, y: 20, width: 80, height: 40 }); // NEW
    assert.deepEqual(metadata.center, { x: 50, y: 40 }); // NEW
}); // NEW

test("history metadata includes the active Trellis user actor", async () => { // NEW
    const harness = loadPlugin({ // NEW
        instantTimers: true, // NEW
        users: { // NEW
            withActorMetadata(metadata) { return Object.assign({}, metadata, { actorUserId: "user_alice", actorName: "Alice", actorRole: "admin" }); }, // NEW
            listUsers() { return [{ id: "user_alice", name: "Alice", admin: true }]; } // NEW
        } // NEW
    }); // NEW
    await settle(); // NEW
    harness.setSerialized("<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1' value='actor'><mxGeometry x='10' y='20' width='80' height='40' as='geometry'/></mxCell></root></mxGraphModel>"); // NEW
    harness.context.window.Trellis.history.run({ category: "Tasks", action: "actor", title: "Actor change" }, () => { // NEW
        harness.model.fireChange({ changes: [{ constructor: { name: "mxValueChange" }, cell: harness.cell }] }); // NEW
    }); // NEW
    await settle(); // NEW
    const event = harness.dbBridge.state.events[harness.dbBridge.state.events.length - 1]; // NEW
    const metadata = JSON.parse(event.metadata_json); // NEW
    assert.equal(metadata.actorUserId, "user_alice"); // NEW
    assert.equal(metadata.actorName, "Alice"); // NEW
    assert.equal(metadata.actorRole, "admin"); // NEW
}); // NEW

test("history event targets accept explicit semantic bounds and union multi-cell model bounds", async () => { // NEW
    const harness = loadPlugin({ instantTimers: true }); // NEW
    await settle(); // NEW
    harness.setSerialized("<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1' value='changed'/><mxCell id='cell-b' parent='1' value='changed'/></root></mxGraphModel>"); // NEW
    const cellB = appendChild(harness.layer, makeXmlCell(harness.document, "cell-b", { label: "B" })); // NEW
    cellB.geometry = { x: 120, y: 70, width: 30, height: 20 }; // NEW
    harness.model.index(cellB); // NEW
    harness.context.window.Trellis.history.run({ category: "Tasks", action: "bulk", title: "Bulk task update" }, () => { // NEW
        harness.model.fireChange({ changes: [{ constructor: { name: "mxGeometryChange" }, cell: harness.cell }, { constructor: { name: "mxGeometryChange" }, cell: cellB }] }); // NEW
    }); // NEW
    await settle(); // NEW
    let metadata = JSON.parse(harness.dbBridge.state.events[harness.dbBridge.state.events.length - 1].metadata_json); // NEW
    assert.deepEqual(metadata.bounds, { x: 10, y: 20, width: 140, height: 70 }); // NEW
    assert.deepEqual(metadata.center, { x: 80, y: 55 }); // NEW

    harness.setSerialized("<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1' value='explicit'/></root></mxGraphModel>"); // NEW
    harness.context.window.Trellis.history.run({ category: "Tasks", action: "explicit", title: "Explicit target", bounds: { x: 200, y: 300, width: 40, height: 60 }, center: { x: 220, y: 330 } }, () => { // NEW
        harness.model.fireChange({ changes: [{ constructor: { name: "mxValueChange" }, cell: harness.cell }] }); // NEW
    }); // NEW
    await settle(); // NEW
    metadata = JSON.parse(harness.dbBridge.state.events[harness.dbBridge.state.events.length - 1].metadata_json); // NEW
    assert.deepEqual(metadata.bounds, { x: 200, y: 300, width: 40, height: 60 }); // NEW
    assert.deepEqual(metadata.center, { x: 220, y: 330 }); // NEW
}); // NEW

test("history panel filters revisions and restore loads the selected snapshot", async () => { // NEW
    const harness = loadPlugin({ instantTimers: true }); // NEW
    const lifecycle = []; // NEW
    const audits = []; // NEW
    harness.context.window.addEventListener("trellisHistoryBeforeRestore", ev => { lifecycle.push("before"); audits.push(ev.detail.audit); assert.equal(harness.context.window.Trellis.history.isRestoring(), true); }); // NEW
    harness.context.window.addEventListener("trellisHistoryAfterRestore", ev => { lifecycle.push("after"); audits.push(ev.detail.audit); assert.equal(harness.context.window.Trellis.history.isRestoring(), true); }); // NEW
    harness.context.window.addEventListener("trellisHistoryCompareCleared", () => lifecycle.push("cleared")); // NEW
    await settle(); // NEW
    harness.actions.trellisChangeMapHistory.funct(); // NEW
    harness.setSerialized("<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1' value='restored'><mxGeometry x='30' y='40' width='90' height='45' as='geometry'/></mxCell></root></mxGraphModel>"); // NEW
    await harness.context.window.Trellis.history.createCheckpoint("Manual checkpoint"); // NEW
    await settle(); // NEW
    const filter = harness.document.querySelector("select:last-of-type"); // NEW
    filter.value = "History"; // NEW
    filter.dispatchEvent(new harness.context.window.Event("change")); // NEW
    assert.match(harness.document.body.textContent, /Manual checkpoint/); // NEW
    const revision = harness.context.window.Trellis.history.list().find(entry => entry.title === "Manual checkpoint"); // NEW
    assert.ok(revision, "missing checkpoint revision"); // NEW
    harness.context.window.Trellis.history._test.components.HistoryRail.select(revision.id); // NEW
    assert.deepEqual(harness.graph.fitted.bounds, revision.bounds); // NEW
    assert.equal(harness.graph.fitted.border, 16); // NEW
    assert.equal(harness.graph.scrolled, undefined); // NEW
    const restoreResult = await harness.context.window.Trellis.history.restore(revision.id); // NEW
    await settle(); // NEW
    assert.equal(restoreResult, true); // NEW
    assert.equal(harness.context.window.Trellis.history.isRestoring(), false); // NEW
    assert.match(harness.restoredXml(), /value='restored'|value="restored"/); // NEW
    assert.equal(harness.ui.undoCleared, true); // NEW
    assert.deepEqual(lifecycle.filter(name => name === "before" || name === "after"), ["before", "after"]); // NEW
    assert.ok(lifecycle.includes("cleared")); // NEW
    assert.equal(audits.length, 2); // NEW
    assert.equal(audits[0], audits[1]); // NEW
    const audit = harness.context.window.Trellis.history.getLastRestoreAudit(); // NEW
    assert.equal(audit.sourceRevisionId, revision.id); // NEW
    assert.equal(audit.loadedHash, audit.afterRehydrateHash); // NEW
    assert.equal(audit.warnings.length, 0); // NEW
    assert.match(harness.document.body.textContent, /Graph restored\. External Trellis data was not rolled back\./); // NEW
    const restoreRevision = harness.context.window.Trellis.history.list().find(entry => entry.restoredFromRevisionId === revision.id); // NEW
    assert.ok(restoreRevision, "missing restore revision"); // NEW
    assert.equal(restoreRevision.restoreAudit.sourceRevisionId, revision.id); // NEW
}); // NEW

test("history compare reports added changed and deleted revisions", async () => { // NEW
    const harness = loadPlugin(); // NEW
    await settle(); // NEW
    const oldXml = "<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1' value='old'><mxGeometry x='10' y='20' width='80' height='40' as='geometry'/></mxCell><mxCell id='cell-deleted' parent='1'><mxGeometry x='70' y='80' width='25' height='25' as='geometry'/></mxCell></root></mxGraphModel>"; // NEW
    const currentXml = "<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1' value='new'><mxGeometry x='10' y='20' width='80' height='40' as='geometry'/></mxCell><mxCell id='cell-added' parent='1'><mxGeometry x='100' y='120' width='30' height='30' as='geometry'/></mxCell></root></mxGraphModel>"; // NEW
    const diff = harness.context.window.Trellis.history._test.diffSnapshotWithCurrent(oldXml, currentXml); // NEW
    assert.deepEqual(Array.from(diff.added), ["cell-added"]); // NEW
    assert.deepEqual(Array.from(diff.changed), ["cell-a"]); // NEW
    assert.deepEqual(Array.from(diff.deleted).map(entry => entry.id), ["cell-deleted"]); // NEW
}); // NEW

test("history event targets preserve deleted-cell and diff fallback bounds", async () => { // NEW
    const oldXml = "<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1'><mxGeometry x='10' y='20' width='80' height='40' as='geometry'/></mxCell><mxCell id='cell-deleted' parent='1'><mxGeometry x='70' y='80' width='25' height='25' as='geometry'/></mxCell></root></mxGraphModel>"; // NEW
    const currentXml = "<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1'><mxGeometry x='10' y='20' width='80' height='40' as='geometry'/></mxCell></root></mxGraphModel>"; // NEW
    const harness = loadPlugin({ instantTimers: true, serialized: oldXml }); // NEW
    await settle(); // NEW
    harness.setSerialized(currentXml); // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, previous: { id: "cell-deleted" } }] }); // NEW
    await settle(); // NEW
    let metadata = JSON.parse(harness.dbBridge.state.events[harness.dbBridge.state.events.length - 1].metadata_json); // NEW
    assert.deepEqual(metadata.bounds, { x: 70, y: 80, width: 25, height: 25 }); // NEW
    assert.deepEqual(metadata.center, { x: 82.5, y: 92.5 }); // NEW

    const fallback = loadPlugin({ instantTimers: true, serialized: oldXml }); // NEW
    await settle(); // NEW
    fallback.setSerialized("<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1' value='changed'><mxGeometry x='30' y='40' width='90' height='45' as='geometry'/></mxCell><mxCell id='cell-deleted' parent='1'><mxGeometry x='70' y='80' width='25' height='25' as='geometry'/></mxCell></root></mxGraphModel>"); // NEW
    fallback.model.fireChange({ changes: [{ constructor: { name: "mxValueChange" } }] }); // NEW
    await settle(); // NEW
    metadata = JSON.parse(fallback.dbBridge.state.events[fallback.dbBridge.state.events.length - 1].metadata_json); // NEW
    assert.deepEqual(metadata.bounds, { x: 30, y: 40, width: 90, height: 45 }); // NEW
    assert.deepEqual(metadata.center, { x: 75, y: 62.5 }); // NEW
}); // NEW

test("history compare handles corrupt compressed snapshots without throwing", async () => { // NEW
    const harness = loadPlugin({ instantTimers: true, Graph: { decompress() { throw new Error("bad snapshot"); } } }); // NEW
    await settle(); // NEW
    await harness.context.window.Trellis.history.createCheckpoint("Corrupt checkpoint"); // NEW
    await settle(); // NEW
    const revision = harness.context.window.Trellis.history.list().find(entry => entry.title === "Corrupt checkpoint"); // NEW
    const snapshot = harness.dbBridge.state.snapshots.get(revision.snapshotId); // NEW
    snapshot.compressed_kind = "graph-compress"; // NEW
    harness.context.window.Trellis.history._test.components.HistoryRail.select(revision.id); // NEW
    await harness.context.window.Trellis.history._test.components.ChangeMapRenderer.compare(); // NEW
    assert.match(harness.graph.__ccHistoryWarning, /unreadable/); // NEW
}); // NEW

test("history restore rejects corrupt snapshots without replacing graph or recording restore", async () => { // NEW
    const harness = loadPlugin({ instantTimers: true, Graph: { decompress() { throw new Error("bad snapshot"); } } }); // NEW
    await settle(); // NEW
    await harness.context.window.Trellis.history.createCheckpoint("Corrupt restore checkpoint"); // NEW
    await settle(); // NEW
    const revision = harness.context.window.Trellis.history.list().find(entry => entry.title === "Corrupt restore checkpoint"); // NEW
    const snapshot = harness.dbBridge.state.snapshots.get(revision.snapshotId); // NEW
    snapshot.compressed_kind = "graph-compress"; // NEW
    const node = harness.document.createElement("div"); // NEW
    harness.document.body.appendChild(node); // NEW
    harness.graph.__ccHistoryCompareOverlays = [node]; // NEW
    const beforeCount = harness.context.window.Trellis.history.list().length; // NEW
    const result = await harness.context.window.Trellis.history.restore(revision.id); // NEW
    await settle(); // NEW
    assert.equal(result, false); // NEW
    assert.equal(harness.restoredXml(), null); // NEW
    assert.equal(harness.context.window.Trellis.history.list().length, beforeCount); // NEW
    assert.equal(harness.context.window.Trellis.history.list().some(entry => entry.restoredFromRevisionId === revision.id), false); // NEW
    assert.equal(node.parentNode, null); // NEW
    const audit = harness.context.window.Trellis.history.getLastRestoreAudit(); // NEW
    assert.equal(audit.sourceRevisionId, revision.id); // NEW
    assert.equal(audit.warnings[0].code, "unreadableSnapshot"); // NEW
    assert.match(harness.graph.__ccHistoryWarning, /unreadable/); // NEW
}); // NEW

test("history restore warns when after-restore rehydration mutates the graph", async () => { // NEW
    const harness = loadPlugin({ instantTimers: true }); // NEW
    await settle(); // NEW
    harness.setSerialized("<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1' value='restore-target'><mxGeometry x='10' y='20' width='80' height='40' as='geometry'/></mxCell></root></mxGraphModel>"); // NEW
    await harness.context.window.Trellis.history.createCheckpoint("Mutation checkpoint"); // NEW
    await settle(); // NEW
    const revision = harness.context.window.Trellis.history.list().find(entry => entry.title === "Mutation checkpoint"); // NEW
    harness.context.window.addEventListener("trellisHistoryAfterRestore", () => { // NEW
        assert.equal(harness.context.window.Trellis.history.isRestoring(), true); // NEW
        harness.setSerialized("<mxGraphModel><root><mxCell id='0'/><mxCell id='1' parent='0'/><mxCell id='cell-a' parent='1' value='mutated-after-restore'><mxGeometry x='10' y='20' width='80' height='40' as='geometry'/></mxCell></root></mxGraphModel>"); // NEW
    }); // NEW
    const result = await harness.context.window.Trellis.history.restore(revision.id); // NEW
    await settle(); // NEW
    assert.equal(result, true); // NEW
    const audit = harness.context.window.Trellis.history.getLastRestoreAudit(); // NEW
    assert.notEqual(audit.loadedHash, audit.afterRehydrateHash); // NEW
    assert.equal(audit.warnings.some(entry => entry.code === "rehydrationMutatedGraph"), true); // NEW
    assert.match(harness.graph.__ccHistoryWarning, /Plugin rehydration changed the graph/); // NEW
    const restoreRevision = harness.context.window.Trellis.history.list().find(entry => entry.restoredFromRevisionId === revision.id); // NEW
    assert.equal(restoreRevision.restoreAudit.warnings.some(entry => entry.code === "rehydrationMutatedGraph"), true); // NEW
}); // NEW

test("history degrades when dbBridge is unavailable", async () => { // NEW
    const harness = loadPlugin({ dbBridge: false }); // NEW
    await settle(); // NEW
    harness.actions.trellisChangeMapHistory.funct(); // NEW
    assert.match(harness.document.body.textContent, /History storage is unavailable/); // NEW
}); // NEW

test("rejected user edits are not recorded even when rejection is marked by a later listener", async () => { // NEW
    const harness = loadPlugin({ instantTimers: true }); // NEW
    await settle(); // NEW
    const before = harness.dbBridge.state.events.length; // NEW
    harness.model.addListener("change", (_sender, evt) => { // NEW
        const edit = evt && evt.getProperty && evt.getProperty("edit"); // NEW
        if (edit) edit.__trellisUsersRejected = true; // NEW
    }); // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxValueChange" }, cell: harness.cell }] }); // NEW
    await settle(); // NEW
    assert.equal(harness.dbBridge.state.events.length, before); // NEW
}); // NEW

test("user map filter dims nonmatching cells when time slicing is disabled", async () => { // NEW
    const harness = loadPlugin({ instantTimers: true }); // NEW
    await settle(); // NEW
    const cellB = appendChild(harness.layer, makeXmlCell(harness.document, "cell-b", { label: "B" })); // NEW
    cellB.geometry = { x: 120, y: 20, width: 80, height: 40 }; // NEW
    harness.model.index(cellB); // NEW
    harness.cell.setAttribute("createdAt", "1000"); // NEW
    harness.cell.setAttribute("createdByUserId", "alice"); // NEW
    cellB.setAttribute("createdAt", "2000"); // NEW
    cellB.setAttribute("createdByUserId", "bob"); // NEW
    harness.graph.__ccWindowValue = 0; // NEW
    harness.graph.__ccUserFilter = "user:alice"; // NEW
    harness.context.window.Trellis.history._test.components.ChangeMapRenderer.enable("createdmap"); // NEW
    await settle(); // NEW
    assert.match(harness.cell.style, /strokeOpacity=100/); // NEW
    assert.match(cellB.style, /strokeColor=#c7c7cc/); // NEW
    assert.match(cellB.style, /strokeOpacity=25/); // NEW
}); // NEW

test("domain plugins declare semantic history transactions and restore listeners", () => { // NEW
    const scheduler = fs.readFileSync(path.join(pluginDir, "Garden_Scheduler_Dialog.js"), "utf8"); // NEW
    const taskManager = fs.readFileSync(path.join(pluginDir, "Garden_Task_Manager.js"), "utf8"); // NEW
    const irrigation = fs.readFileSync(path.join(pluginDir, "Garden_Irrigation_Planner.js"), "utf8"); // NEW
    const linking = fs.readFileSync(path.join(pluginDir, "Vertex_Linking_Standalone.js"), "utf8"); // NEW
    assert.match(scheduler, /category:\s*"Garden scheduling"[\s\S]*action:\s*"emitTasks"/); // NEW
    assert.match(taskManager, /category:\s*"Assignments"[\s\S]*action:\s*"assign"/); // NEW
    assert.match(taskManager, /category:\s*replacement\.mode === 'sync' \? "Garden scheduling" : "Tasks"/); // NEW
    assert.match(irrigation, /category:\s*"Irrigation"[\s\S]*action:\s*label/); // NEW
    assert.match(linking, /category:\s*"Data"[\s\S]*tags:\s*\["Links"\]/); // NEW
    assert.match(taskManager, /trellisHistoryBeforeRestore[\s\S]*cancelPendingKanbanRepairs/); // NEW
    assert.match(taskManager, /if \(isTrellisHistoryRestoring\(\)\) \{ cancelPendingKanbanRepairs\(\); return; \}/); // NEW
    assert.match(taskManager, /function repairChangedCards[\s\S]*if \(isTrellisHistoryRestoring\(\)\) return;/); // NEW
    assert.match(irrigation, /trellisHistoryBeforeRestore[\s\S]*cancelPendingHudGraphStateSync/); // NEW
    assert.match(irrigation, /function syncHudGraphState[\s\S]*if \(isTrellisHistoryRestoring\(\)\) return \[\];/); // NEW
    assert.match(linking, /trellisHistoryBeforeRestore[\s\S]*clearAllHighlights/); // NEW
    assert.match(taskManager, /trellisHistoryAfterRestore/); // NEW
    assert.match(irrigation, /trellisHistoryAfterRestore/); // NEW
    assert.match(linking, /trellisHistoryAfterRestore/); // NEW
}); // NEW
