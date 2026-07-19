const assert = require("node:assert/strict"); // NEW
const fs = require("node:fs"); // NEW
const path = require("node:path"); // NEW
const test = require("node:test"); // NEW
const vm = require("node:vm"); // NEW
const { JSDOM } = require("jsdom"); // NEW

const projectRoot = path.resolve(__dirname, ".."); // NEW
const pluginPath = path.join(projectRoot, "drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Users.js"); // NEW

class TestCell { // NEW
    constructor(id, value = null, style = "") { // NEW
        this.id = id; // NEW
        this.value = value; // NEW
        this.style = style; // NEW
        this.children = []; // NEW
        this.vertex = true; // NEW
    } // NEW
    getId() { return this.id; } // NEW
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
    beginUpdate() {} // NEW
    endUpdate() {} // NEW
    setValue(cell, value) { cell.value = value; } // NEW
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

function loadUsersPlugin() { // NEW
    const dom = new JSDOM("<!doctype html><body><div id='host'><div id='graph'></div></div></body>", { url: "https://app.test/" }); // NEW
    const document = dom.window.document; // NEW
    const root = new TestCell("root"); // NEW
    const layer = appendChild(root, makeXmlCell(document, "layer", { label: "Layer" })); // NEW
    const module = appendChild(layer, makeXmlCell(document, "module", { label: "Module" })); // NEW
    const card = appendChild(module, makeXmlCell(document, "card", { label: "Card" })); // NEW
    const outside = appendChild(layer, makeXmlCell(document, "outside", { label: "Outside" })); // NEW
    const model = new TestModel(root); // NEW
    const graphListeners = new Map(); // NEW
    const graph = { // NEW
        container: document.getElementById("graph"), // NEW
        getModel() { return model; }, // NEW
        getDefaultParent() { return layer; }, // NEW
        getSelectionCell() { return graph.selected || null; }, // NEW
        getSelectionCells() { return graph.selected ? [graph.selected] : []; }, // NEW
        setSelectionCell(cell) { graph.selected = cell; }, // NEW
        getSelectionModel() { return { addListener() {} }; }, // NEW
        addListener(name, fn) { if (!graphListeners.has(name)) graphListeners.set(name, []); graphListeners.get(name).push(fn); }, // NEW
        refresh() { graph.refreshed = true; } // NEW
    }; // NEW
    const actions = {}; // NEW
    const ui = { // NEW
        editor: { graph }, // NEW
        actions: { addAction(id, fn) { actions[id] = { funct: fn }; } }, // NEW
        menus: { get() { return null; }, addMenuItems() {} } // NEW
    }; // NEW
    const context = { // NEW
        window: dom.window, document, console, Promise, Error, String, Number, Math, Date, Set, Map, JSON, // NEW
        setTimeout: fn => { fn(); return 1; }, // NEW
        Draw: { loadPlugin(callback) { callback(ui); } }, // NEW
        mxEvent: { CHANGE: "change" }, // NEW
        mxUtils: { createXmlDocument() { return document.implementation.createDocument("", "", null); } } // NEW
    }; // NEW
    vm.runInNewContext(fs.readFileSync(pluginPath, "utf8"), context, { filename: pluginPath }); // NEW
    return { context, document, graph, model, layer, module, card, outside, actions }; // NEW
} // NEW

test("disabled diagrams do not prompt or block edits", () => { // CHANGE
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    assert.equal(users.isEnabled(), false); // NEW
    assert.equal(users.canEditCell(harness.card), true); // NEW
    assert.equal(users.login("Alice", "1234").ok, false); // NEW
    let undone = false; // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxValueChange" }, cell: harness.card }], undo() { undone = true; } }); // NEW
    assert.equal(undone, false); // NEW
    assert.ok(harness.actions.trellisUsers); // NEW
}); // NEW

test("enable users creates the first admin and persists usersEnabled", () => { // CHANGE
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    const result = users.enableUsers("Alice", "1234"); // NEW
    assert.equal(result.ok, true); // NEW
    assert.equal(users.isEnabled(), true); // NEW
    assert.equal(users.isLoggedIn(), true); // NEW
    assert.equal(users.isAdmin(), true); // NEW
    assert.equal(users.getCurrentUser().name, "Alice"); // NEW
    assert.equal(users.listUsers().length, 1); // NEW
    assert.equal(users._test.readStore().usersEnabled, true); // NEW
    assert.match(harness.layer.getAttribute("trellis_users_json"), /Alice/); // CHANGE
}); // NEW

test("logged-out enabled diagrams reject edits", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    users.logout(); // NEW
    let undone = false; // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxValueChange" }, cell: harness.card }], undo() { undone = true; } }); // NEW
    assert.equal(undone, true); // NEW
}); // NEW

test("admin roster management supports PIN reset disable reactivate and last-admin guards", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    const bob = users.createUser("Bob", "5678", false).user; // NEW
    assert.equal(users.resetUserPin(bob.id, "9999").ok, true); // NEW
    users.logout(); // NEW
    assert.equal(users.login("Bob", "5678").ok, false); // NEW
    assert.equal(users.login("Bob", "9999").ok, true); // NEW
    assert.equal(users.setUserAdmin(bob.id, true).ok, false); // NEW
    users.logout(); // NEW
    users.login("Alice", "1234"); // NEW
    assert.equal(users.setUserAdmin(bob.id, true).ok, true); // NEW
    const alice = users.getCurrentUser(); // NEW
    assert.equal(users.setUserDisabled(alice.id, true).ok, true); // NEW
    assert.equal(users.isLoggedIn(), false); // NEW
    users.login("Bob", "9999"); // NEW
    assert.equal(users.setUserAdmin(bob.id, false).ok, false); // NEW
    assert.equal(users.setUserDisabled(bob.id, true).ok, false); // NEW
    assert.equal(users.setUserDisabled(alice.id, false).ok, true); // NEW
}); // NEW

test("owner grants regular edit-only subtree access", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const bob = users.createUser("Bob", "5678", false).user; // NEW
    assert.equal(users.setAccess(harness.module, { open: false, userIds: [bob.id] }).ok, true); // NEW
    users.logout(); // NEW
    assert.equal(users.login("Bob", "5678").ok, true); // NEW
    assert.equal(users.canEditCell(harness.card), true); // NEW
    assert.equal(users.canAddCell(harness.module), false); // NEW
    assert.equal(users.canDeleteCell(harness.card), false); // NEW
    assert.equal(users.canManageAccess(harness.module), false); // NEW
}); // NEW

test("open access allows logged-in regular users to edit existing cells only", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    users.stampCreatedOwner(harness.module); // NEW
    users.createUser("Bob", "5678", false); // NEW
    assert.equal(users.setAccess(harness.module, { open: true, userIds: [] }).ok, true); // NEW
    users.logout(); // NEW
    users.login("Bob", "5678"); // NEW
    assert.equal(users.canEditCell(harness.card), true); // NEW
    assert.equal(users.canAddCell(harness.module), false); // NEW
    assert.equal(users.canDeleteCell(harness.card), false); // NEW
}); // NEW

test("owner can transfer ownership to an active user", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const bob = users.createUser("Bob", "5678", false).user; // NEW
    assert.equal(users.setOwner(harness.module, bob.id).ok, true); // NEW
    users.logout(); // NEW
    users.login("Bob", "5678"); // NEW
    assert.equal(users.canManageAccess(harness.module), true); // NEW
    assert.equal(users.canAddCell(harness.module), true); // NEW
}); // NEW

test("regular granted users cannot add delete move reparent or change protected access attributes", () => { // CHANGE
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const bob = users.createUser("Bob", "5678", false).user; // NEW
    users.setAccess(harness.module, { open: false, userIds: [bob.id] }); // NEW
    users.logout(); // NEW
    users.login("Bob", "5678"); // NEW

    let undone = false; // NEW
    const added = appendChild(harness.module, makeXmlCell(harness.document, "added", { label: "Added" })); // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: added, parent: harness.module }], undo() { undone = true; } }); // NEW
    assert.equal(undone, true); // NEW

    undone = false; // NEW
    harness.card.parent = null; // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: harness.card, previous: harness.module }], undo() { undone = true; } }); // NEW
    assert.equal(undone, true); // NEW
    harness.card.parent = harness.module; // NEW

    undone = false; // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxGeometryChange" }, cell: harness.card }], undo() { undone = true; } }); // NEW
    assert.equal(undone, true); // NEW

    undone = false; // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: harness.card, previous: harness.module, parent: harness.module }], undo() { undone = true; } }); // NEW
    assert.equal(undone, true); // NEW

    undone = false; // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxCellAttributeChange" }, cell: harness.module, attribute: users.attrs.owner }], undo() { undone = true; } }); // NEW
    assert.equal(undone, true); // NEW
}); // NEW

test("owner and admin can add delete and move within owned scopes", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    users.stampCreatedOwner(harness.module); // NEW
    let undone = false; // NEW
    const added = appendChild(harness.module, makeXmlCell(harness.document, "owner-added", { label: "Owner Added" })); // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: added, parent: harness.module }], undo() { undone = true; } }); // NEW
    assert.equal(undone, false); // NEW

    undone = false; // NEW
    added.parent = null; // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: added, previous: harness.module }], undo() { undone = true; } }); // NEW
    assert.equal(undone, false); // NEW

    undone = false; // NEW
    harness.card.parent = harness.module; // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: harness.card, previous: harness.module, parent: harness.module }], undo() { undone = true; } }); // NEW
    assert.equal(undone, false); // NEW

    undone = false; // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxGeometryChange" }, cell: harness.card }], undo() { undone = true; } }); // NEW
    assert.equal(undone, false); // NEW
}); // NEW

test("pending invite creates regular pending user grants and email draft", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    harness.module.style = "swimlane;module=1"; // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const result = users.createPendingInvite({ email: "Bob@Example.com", scopeCellIds: [harness.module.id], shareInfo: { deviceId: "DEV", folderId: "FOL", folderLabel: "Garden", folderPath: "C:/Garden" } }); // NEW
    assert.equal(result.ok, true); // NEW
    assert.equal(result.invite.email, "bob@example.com"); // NEW
    assert.match(result.emailDraft.body, /DEV/); // NEW
    assert.match(result.emailDraft.body, /FOL/); // NEW
    assert.match(result.emailDraft.body, new RegExp(result.code.replace("-", "\\-"))); // NEW
    const store = users._test.readStore(); // NEW
    assert.equal(store.pendingUsers.length, 1); // NEW
    assert.equal(store.invites.length, 1); // NEW
    assert.equal(store.invites[0].status, "pending"); // NEW
    assert.ok(store.invites[0].expiresAt > Date.now() + 13 * 24 * 60 * 60 * 1000); // NEW
    assert.match(harness.module.getAttribute(users.attrs.accessUsers), new RegExp(store.pendingUsers[0].id)); // NEW
}); // NEW

test("duplicate invite email is rejected for pending users", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    harness.module.style = "module=1"; // NEW
    users.stampCreatedOwner(harness.module); // NEW
    assert.equal(users.createPendingInvite({ email: "bob@example.com", scopeCellIds: [harness.module.id] }).ok, true); // NEW
    const duplicate = users.createPendingInvite({ email: "BOB@example.com", scopeCellIds: [harness.module.id] }); // NEW
    assert.equal(duplicate.ok, false); // NEW
    assert.match(duplicate.reason, /already/); // NEW
}); // NEW

test("accept invite activates pending regular user and prevents token reuse", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    harness.module.style = "module=1"; // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const invite = users.createPendingInvite({ email: "bob@example.com", scopeCellIds: [harness.module.id] }); // NEW
    users.logout(); // NEW
    const accepted = users.acceptInvite({ email: "bob@example.com", code: invite.code, name: "Bob", pin: "5678" }); // NEW
    assert.equal(accepted.ok, true); // NEW
    assert.equal(users.getCurrentUser().email, "bob@example.com"); // NEW
    assert.equal(users.canEditCell(harness.card), true); // NEW
    assert.equal(users.canAddCell(harness.module), false); // NEW
    users.logout(); // NEW
    const reuse = users.acceptInvite({ email: "bob@example.com", code: invite.code, name: "Bob 2", pin: "9999" }); // NEW
    assert.equal(reuse.ok, false); // NEW
    assert.match(reuse.reason, /No active invite/); // NEW
}); // NEW

test("revoking pending invite removes pending grants", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    harness.module.style = "module=1"; // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const invite = users.createPendingInvite({ email: "bob@example.com", scopeCellIds: [harness.module.id] }); // NEW
    const pendingId = invite.invite.pendingUserId; // NEW
    assert.match(harness.module.getAttribute(users.attrs.accessUsers), new RegExp(pendingId)); // NEW
    assert.equal(users.revokeInvite(invite.invite.id).ok, true); // NEW
    assert.doesNotMatch(harness.module.getAttribute(users.attrs.accessUsers) || "", new RegExp(pendingId)); // NEW
    assert.equal(users.acceptInvite({ email: "bob@example.com", code: invite.code, name: "Bob", pin: "5678" }).ok, false); // NEW
}); // NEW

test("resend invite rotates code and expiry", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    harness.module.style = "module=1"; // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const invite = users.createPendingInvite({ email: "bob@example.com", scopeCellIds: [harness.module.id] }); // NEW
    const firstHash = users._test.readStore().invites[0].codeHash; // NEW
    const resent = users.resendInvite(invite.invite.id, { deviceId: "NEWDEV" }); // NEW
    assert.equal(resent.ok, true); // NEW
    const next = users._test.readStore().invites[0]; // NEW
    assert.notEqual(next.codeHash, firstHash); // NEW
    assert.notEqual(resent.code, invite.code); // NEW
    assert.match(resent.emailDraft.body, /NEWDEV/); // NEW
}); // NEW

test("regular non-owner cannot invite selected scopes", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    harness.module.style = "module=1"; // NEW
    users.stampCreatedOwner(harness.module); // NEW
    users.createUser("Bob", "5678", false); // NEW
    users.logout(); // NEW
    users.login("Bob", "5678"); // NEW
    const result = users.createPendingInvite({ email: "carol@example.com", scopeCellIds: [harness.module.id] }); // NEW
    assert.equal(result.ok, false); // NEW
    assert.match(result.reason, /own or administer/); // NEW
}); // NEW

test("expired invites are hidden and remove pending grants", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    harness.module.style = "module=1"; // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const invite = users.createPendingInvite({ email: "bob@example.com", scopeCellIds: [harness.module.id] }); // NEW
    const store = users._test.readStore(); // NEW
    store.invites[0].expiresAt = Date.now() - 1; // NEW
    users._test.writeStore(store); // NEW
    assert.deepEqual(users.listPendingInvites(), []); // NEW
    assert.doesNotMatch(harness.module.getAttribute(users.attrs.accessUsers) || "", new RegExp(invite.invite.pendingUserId)); // NEW
    assert.equal(users.acceptInvite({ email: "bob@example.com", code: invite.code, name: "Bob", pin: "5678" }).ok, false); // NEW
}); // NEW
