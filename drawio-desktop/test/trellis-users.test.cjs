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
    index(cell) { cell.model = this; this.cells.set(cell.id, cell); (cell.children || []).forEach(child => this.index(child)); } // CHANGE
    getRoot() { return this.root; } // NEW
    getParent(cell) { return cell && cell.parent ? cell.parent : null; } // NEW
    getChildCount(cell) { return cell && cell.children ? cell.children.length : 0; } // NEW
    getChildAt(cell, index) { return cell.children[index]; } // NEW
    getCell(id) { return this.cells.get(id) || null; } // NEW
    beginUpdate() {} // NEW
    endUpdate() {} // NEW
    setValue(cell, value) { this.setValueCalls = (this.setValueCalls || 0) + 1; cell.value = value; } // CHANGE
    addListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(fn); } // NEW
    fireChange(edit) { (this.listeners.get("change") || []).forEach(fn => fn(this, { getProperty: key => key === "edit" ? edit : null })); } // NEW
} // NEW

function appendChild(parent, child) { // NEW
    child.parent = parent; // NEW
    parent.children.push(child); // NEW
    if (parent.model) parent.model.index(child); // NEW
    return child; // NEW
} // NEW

function makeXmlCell(document, id, attrs = {}) { // NEW
    const node = document.implementation.createDocument("", "", null).createElement("object"); // NEW
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value)); // NEW
    return new TestCell(id, node); // NEW
} // NEW

function loadUsersPlugin(options = {}) { // CHANGE
    const dom = new JSDOM("<!doctype html><body><div id='host'><div id='graph'></div></div></body>", { url: "https://app.test/" }); // NEW
    const document = dom.window.document; // NEW
    Object.defineProperty(dom.window, "innerWidth", { configurable: true, value: 1024 }); // NEW
    Object.defineProperty(dom.window, "innerHeight", { configurable: true, value: 768 }); // NEW
    const root = new TestCell("root"); // NEW
    const layer = appendChild(root, makeXmlCell(document, "layer", { label: "Layer" })); // NEW
    const module = appendChild(layer, makeXmlCell(document, "module", { label: "Module" })); // NEW
    const card = appendChild(module, makeXmlCell(document, "card", { label: "Card" })); // NEW
    const outside = appendChild(layer, makeXmlCell(document, "outside", { label: "Outside" })); // NEW
    const model = new TestModel(root); // NEW
    const graphListeners = new Map(); // NEW
    const editorListeners = new Map(); // NEW
    const graph = { // NEW
        container: document.getElementById("graph"), // NEW
        getModel() { return model; }, // NEW
        getDefaultParent() { return layer; }, // NEW
        getSelectionCell() { return graph.selectedCells && graph.selectedCells.length ? graph.selectedCells[0] : (graph.selected || null); }, // CHANGE
        getSelectionCells() { return graph.selectedCells || (graph.selected ? [graph.selected] : []); }, // CHANGE
        setSelectionCell(cell) { graph.selected = cell; graph.selectedCells = cell ? [cell] : []; }, // CHANGE
        setSelectionCells(cells) { graph.selectedCells = (cells || []).filter(Boolean); graph.selected = graph.selectedCells[0] || null; }, // NEW
        getSelectionModel() { return { addListener() {} }; }, // NEW
        addListener(name, fn) { if (!graphListeners.has(name)) graphListeners.set(name, []); graphListeners.get(name).push(fn); }, // NEW
        setEnabled(value) { graph.enabled = value; }, // NEW
        refresh() { graph.refreshed = true; } // NEW
    }; // NEW
    const actions = {}; // NEW
    const toolbarContainer = document.createElement("div"); // NEW
    document.body.insertBefore(toolbarContainer, document.body.firstChild); // NEW
    if (options.historyButton) { // NEW
        const history = document.createElement("button"); // NEW
        history.className = "geButton trellis-changemap-history-button"; // NEW
        history.textContent = "History"; // NEW
        toolbarContainer.appendChild(history); // NEW
    } // NEW
    const ui = { // NEW
        editor: { // CHANGE
            graph, // NEW
            addListener(name, fn) { if (!editorListeners.has(name)) editorListeners.set(name, []); editorListeners.get(name).push(fn); }, // CHANGE
            setGraphXml(node) { // NEW
                ui.setGraphXmlCalls = (ui.setGraphXmlCalls || 0) + 1; // NEW
                const edit = ui.setGraphXmlEdit || { changes: [{ constructor: { name: "mxChildChange" }, child: module, parent: layer }], undo() { ui.setGraphXmlUndone = true; } }; // NEW
                model.fireChange(edit); // NEW
                ui.setGraphXmlNode = node; // NEW
            } // NEW
        }, // CHANGE
        actions: { addAction(id, fn) { actions[id] = { funct: fn }; } }, // NEW
        menus: { get() { return null; }, addMenuItems() {} }, // CHANGE
        toolbarContainer, // NEW
        fileLoaded(file) { ui.loadedFile = file; (editorListeners.get("fileLoaded") || []).forEach(fn => fn()); }, // NEW
        getCurrentFile() { return ui.currentFile || null; } // NEW
    }; // NEW
    const testConsole = Object.prototype.hasOwnProperty.call(options, "console") ? options.console : console; // NEW
    const context = { // NEW
        window: dom.window, document, console: testConsole, Promise, Error, String, Number, Math, Date, Set, Map, JSON, // CHANGE
        setTimeout: fn => { fn(); return 1; }, // NEW
        Draw: { loadPlugin(callback) { callback(ui); } }, // NEW
        mxEvent: { CHANGE: "change" }, // NEW
        mxUtils: { createXmlDocument() { return document.implementation.createDocument("", "", null); } } // NEW
    }; // NEW
    vm.runInNewContext(fs.readFileSync(pluginPath, "utf8"), context, { filename: pluginPath }); // NEW
    const loginButton = document.querySelector(".trellis-users-login-button"); // NEW
    if (loginButton) loginButton.getBoundingClientRect = () => ({ left: 850, right: 910, top: 10, bottom: 34, width: 60, height: 24 }); // NEW
    return { context, document, graph, model, layer, module, card, outside, actions, ui, toolbarContainer, editorListeners }; // CHANGE
} // NEW

function buttonByText(document, text) { // NEW
    return Array.from(document.querySelectorAll("button")).find(button => button.textContent === text); // NEW
} // NEW

function inputByPlaceholder(document, text) { // NEW
    return Array.from(document.querySelectorAll("input")).find(input => input.placeholder === text); // NEW
} // NEW

function userGroupByTitle(document, title) { // NEW
    return Array.from(document.querySelectorAll(".trellis-users-user-group")).find(group => group.getAttribute("data-trellis-users-group") === title); // NEW
} // NEW

function selectByOptionText(document, text) { // NEW
    return Array.from(document.querySelectorAll("select")).find(select => Array.from(select.options || []).some(option => option.textContent === text)); // NEW
} // NEW

function checkboxByLabel(document, text) { // NEW
    return labelByText(document, text)?.querySelector("input[type='checkbox']") || null; // CHANGE
} // NEW

function accessRowByUserId(document, userId) { // NEW
    return document.querySelector('.trellis-users-access-row[data-trellis-users-user-id="' + userId + '"]'); // NEW
} // NEW

function labelByText(root, text) { // NEW
    return Array.from(root.querySelectorAll("label")).find(label => label.textContent.trim() === text) || null; // NEW
} // NEW

function checkboxByLabelIn(root, text) { // NEW
    return labelByText(root, text)?.querySelector("input[type='checkbox']") || null; // CHANGE
} // NEW

test("disabled diagrams do not prompt or block edits", () => { // CHANGE
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    assert.equal(users.isEnabled(), false); // NEW
    assert.equal(harness.document.querySelector(".trellis-users-auth-overlay"), null); // NEW
    assert.ok(harness.document.querySelector(".trellis-users-login-button")); // NEW
    assert.equal(users.canEditCell(harness.card), true); // NEW
    assert.equal(users.login("Alice", "1234").ok, false); // NEW
    let undone = false; // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxValueChange" }, cell: harness.card }], undo() { undone = true; } }); // NEW
    assert.equal(undone, false); // NEW
    assert.ok(harness.actions.trellisUsers); // NEW
}); // NEW

test("toolbar login enables users and keeps the first admin logged in for this diagram", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    harness.document.querySelector(".trellis-users-login-button").click(); // NEW
    assert.ok(harness.document.querySelector(".trellis-users-auth-overlay")); // NEW
    inputByPlaceholder(harness.document, "Admin name").value = "Alice"; // NEW
    inputByPlaceholder(harness.document, "PIN").value = "1234"; // NEW
    harness.document.querySelector(".trellis-users-auth-overlay input[type='checkbox']").checked = true; // NEW
    buttonByText(harness.document, "Enable Users").click(); // NEW
    assert.equal(users.isEnabled(), true); // NEW
    assert.equal(users.isLoggedIn(), true); // NEW
    assert.equal(harness.document.querySelector(".trellis-users-auth-overlay"), null); // NEW
    const key = users._test.getDiagramLoginKey(false); // NEW
    assert.equal(harness.context.window.localStorage.getItem("trellis_users_remembered_login_v1:" + key), users.getCurrentUser().id); // NEW
}); // NEW

test("users toolbar button is inserted beside an existing ChangeMap History button", () => { // NEW
    const harness = loadUsersPlugin({ historyButton: true }); // NEW
    const buttons = Array.from(harness.toolbarContainer.querySelectorAll("button")); // NEW
    assert.equal(buttons[0].className.includes("trellis-users-login-button"), true); // NEW
    assert.equal(buttons[1].className.includes("trellis-changemap-history-button"), true); // NEW
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

test("accepted visible edits merge actor metadata into the same undoable edit", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    const edit = { changes: [{ constructor: { name: "mxGeometryChange" }, cell: harness.card }] }; // NEW
    harness.model.fireChange(edit); // NEW
    assert.equal(edit.changes.length, 2); // NEW
    assert.equal(harness.card.getAttribute(users.attrs.editedBy), users.getCurrentUser().id); // NEW
    const actorChange = edit.changes.find(change => change.__trellisUsersActorStamp); // NEW
    assert.ok(actorChange); // NEW
    actorChange.execute(); // NEW
    assert.equal(harness.card.getAttribute(users.attrs.editedBy), null); // NEW
    actorChange.execute(); // NEW
    assert.equal(harness.card.getAttribute(users.attrs.editedBy), users.getCurrentUser().id); // NEW
}); // NEW

test("created planting ownership metadata is included in the creation undo edit", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    const planting = makeXmlCell(harness.document, "planting", { label: "Planting", tiler_group: "1" }); // NEW
    appendChild(harness.module, planting); // NEW
    const edit = { changes: [{ constructor: { name: "mxChildChange" }, child: planting, parent: harness.module }] }; // NEW
    harness.model.fireChange(edit); // NEW
    assert.equal(edit.changes.length, 2); // NEW
    assert.equal(planting.getAttribute(users.attrs.owner), users.getCurrentUser().id); // NEW
    assert.equal(planting.getAttribute(users.attrs.createdBy), users.getCurrentUser().id); // NEW
    const actorChange = edit.changes.find(change => change.__trellisUsersActorStamp); // NEW
    actorChange.execute(); // NEW
    assert.equal(planting.getAttribute(users.attrs.owner), null); // NEW
    assert.equal(planting.getAttribute(users.attrs.createdBy), null); // NEW
    actorChange.execute(); // NEW
    assert.equal(planting.getAttribute(users.attrs.owner), users.getCurrentUser().id); // NEW
}); // NEW

test("direct actor stamping mutates XML without model setValue calls", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    const preInsert = new TestCell("pre-insert", "Pre Insert"); // NEW
    harness.model.setValueCalls = 0; // NEW
    assert.equal(users.stampActorDirect(preInsert, "created"), true); // NEW
    assert.equal(harness.model.setValueCalls, 0); // NEW
    assert.equal(preInsert.getAttribute(users.attrs.createdBy), users.getCurrentUser().id); // NEW
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

test("enabled diagram load changes are allowed while logged out but later edits are rejected", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    users.logout(); // NEW
    let loadUndone = false; // NEW
    harness.ui.openingFile = true; // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: harness.module, parent: harness.layer }], undo() { loadUndone = true; } }); // NEW
    harness.ui.openingFile = false; // NEW
    harness.ui.fileLoaded({}); // NEW
    assert.equal(loadUndone, false); // NEW
    assert.ok(harness.document.querySelector(".trellis-users-auth-overlay")); // NEW
    let editUndone = false; // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxValueChange" }, cell: harness.card }], undo() { editUndone = true; } }); // NEW
    assert.equal(editUndone, true); // NEW
}); // NEW

test("direct setGraphXml load changes are allowed and then show the auth gate", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    users.logout(); // NEW
    harness.ui.setGraphXmlUndone = false; // NEW
    harness.ui.editor.setGraphXml(harness.document.createElement("mxGraphModel")); // NEW
    assert.equal(harness.ui.setGraphXmlCalls, 1); // NEW
    assert.equal(harness.ui.setGraphXmlUndone, false); // NEW
    assert.ok(harness.document.querySelector(".trellis-users-auth-overlay")); // NEW
}); // NEW

test("logged-out enabled diagrams show an opaque auth gate until login succeeds", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    users.logout(); // NEW
    assert.ok(harness.document.querySelector(".trellis-users-auth-overlay")); // NEW
    assert.equal(harness.graph.enabled, false); // NEW
    assert.equal(users.login("Alice", "bad").ok, false); // NEW
    assert.ok(harness.document.querySelector(".trellis-users-auth-overlay")); // NEW
    assert.equal(users.login("Alice", "1234").ok, true); // NEW
    assert.equal(harness.document.querySelector(".trellis-users-auth-overlay"), null); // NEW
    assert.equal(harness.graph.enabled, true); // NEW
}); // NEW

test("remembered login restores on file load and logout forgets it", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    const alice = users.getCurrentUser(); // NEW
    assert.equal(users.rememberLogin(alice.id, true).ok, true); // NEW
    harness.ui.fileLoaded({}); // NEW
    assert.equal(users.isLoggedIn(), true); // NEW
    assert.equal(users.getCurrentUser().id, alice.id); // NEW
    users.logout(); // NEW
    const key = users._test.getDiagramLoginKey(false); // NEW
    assert.equal(harness.context.window.localStorage.getItem("trellis_users_remembered_login_v1:" + key), null); // NEW
    assert.ok(harness.document.querySelector(".trellis-users-auth-overlay")); // NEW
}); // NEW

test("remembered login is ignored when the stored user is disabled", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    const bob = users.createUser("Bob", "5678", false).user; // NEW
    assert.equal(users.rememberLogin(bob.id, true).ok, true); // NEW
    users.setUserDisabled(bob.id, true); // NEW
    harness.ui.fileLoaded({}); // NEW
    assert.equal(users.isLoggedIn(), false); // NEW
    assert.ok(harness.document.querySelector(".trellis-users-auth-overlay")); // NEW
}); // NEW

test("logged-in toolbar button toggles a user panel below the button", () => { // CHANGE
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    const button = harness.document.querySelector(".trellis-users-login-button"); // NEW
    assert.equal(button.textContent, "Alice"); // NEW
    button.click(); // NEW
    assert.equal(harness.document.querySelector(".trellis-users-account-menu"), null); // CHANGE
    const panel = harness.document.body.querySelector("div[style*='width: 400px'], div[style*='width:400px']"); // CHANGE
    assert.ok(panel); // NEW
    assert.equal(panel.parentNode, harness.document.body); // NEW
    assert.equal(panel.style.position, "fixed"); // CHANGE
    assert.equal(panel.style.zIndex, "2000000000"); // CHANGE
    assert.equal(panel.style.top, "38px"); // NEW
    assert.equal(panel.style.left, "510px"); // CHANGE
    assert.ok(buttonByText(harness.document, "Close")); // NEW
    button.click(); // NEW
    assert.equal(panel.style.display, "none"); // NEW
    button.click(); // NEW
    assert.notEqual(panel.style.display, "none"); // NEW
    buttonByText(harness.document, "Close").click(); // NEW
    assert.equal(panel.style.display, "none"); // NEW
    button.click(); // NEW
    buttonByText(harness.document, "Logout").click(); // NEW
    assert.equal(users.isLoggedIn(), false); // NEW
    assert.equal(harness.document.querySelector(".trellis-users-account-menu"), null); // NEW
    assert.ok(harness.document.querySelector(".trellis-users-auth-overlay")); // NEW
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

test("admin roster PIN reset uses an inline form without native prompt", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    users.createUser("Bob", "5678", false); // NEW
    harness.context.window.prompt = function () { throw new Error("prompt() is not supported"); }; // NEW
    harness.actions.trellisUsers.funct(); // NEW
    const firstPinButtons = Array.from(harness.document.querySelectorAll("button")).filter(button => button.textContent === "PIN"); // NEW
    assert.equal(firstPinButtons.length, 2); // NEW
    assert.doesNotThrow(() => firstPinButtons[1].click()); // NEW
    assert.ok(inputByPlaceholder(harness.document, "New PIN")); // NEW
    buttonByText(harness.document, "Cancel").click(); // NEW
    assert.equal(inputByPlaceholder(harness.document, "New PIN"), undefined); // NEW
    const secondPinButtons = Array.from(harness.document.querySelectorAll("button")).filter(button => button.textContent === "PIN"); // NEW
    assert.doesNotThrow(() => secondPinButtons[1].click()); // NEW
    inputByPlaceholder(harness.document, "New PIN").value = "9999"; // NEW
    buttonByText(harness.document, "Save").click(); // NEW
    assert.equal(inputByPlaceholder(harness.document, "New PIN"), undefined); // NEW
    users.logout(); // NEW
    assert.equal(users.login("Bob", "5678").ok, false); // NEW
    assert.equal(users.login("Bob", "9999").ok, true); // NEW
}); // NEW

test("admin panel groups networked local and pending users", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    harness.module.style = "module=1"; // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const bobInvite = users.createPendingInvite({ email: "bob@example.com", scopeCellIds: [harness.module.id] }); // NEW
    assert.equal(bobInvite.ok, true); // NEW
    users.logout(); // NEW
    assert.equal(users.acceptInvite({ email: "bob@example.com", code: bobInvite.code, name: "Bob", pin: "5678" }).ok, true); // NEW
    users.logout(); // NEW
    assert.equal(users.login("Alice", "1234").ok, true); // NEW
    assert.equal(users.createPendingInvite({ email: "carol@example.com", scopeCellIds: [harness.module.id] }).ok, true); // NEW
    harness.actions.trellisUsers.funct(); // NEW
    const networked = userGroupByTitle(harness.document, "Networked users"); // NEW
    const local = userGroupByTitle(harness.document, "Local users"); // NEW
    assert.ok(networked); // NEW
    assert.ok(local); // NEW
    assert.match(networked.textContent, /Bob/); // NEW
    assert.doesNotMatch(networked.textContent, /Alice/); // NEW
    assert.match(local.textContent, /Alice/); // NEW
    assert.doesNotMatch(local.textContent, /Bob/); // NEW
    assert.match(harness.document.body.textContent, /Pending invites/); // NEW
    assert.match(harness.document.body.textContent, /carol@example\.com/); // NEW
    local.querySelector("input[placeholder='Local user']").value = "Dana"; // NEW
    local.querySelector("input[placeholder='PIN']").value = "2468"; // NEW
    buttonByText(harness.document, "Add local user").click(); // NEW
    assert.ok(users.listUsers().find(user => user.name === "Dana" && !user.email)); // NEW
}); // NEW

test("people access panel title and filters search roster invites and access rows by name or email", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    harness.module.style = "module=1"; // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const bobInvite = users.createPendingInvite({ email: "bob@example.com", scopeCellIds: [harness.module.id] }); // NEW
    users.logout(); // NEW
    const accepted = users.acceptInvite({ email: "bob@example.com", code: bobInvite.code, name: "Bob", pin: "5678" }); // NEW
    assert.equal(accepted.ok, true); // NEW
    users.logout(); // NEW
    assert.equal(users.login("Alice", "1234").ok, true); // NEW
    const dana = users.createUser("Dana", "2468", false).user; // NEW
    assert.equal(users.setScopeGrant(harness.module, { userId: accepted.user.id, preset: "viewer" }).ok, true); // NEW
    assert.equal(users.setScopeGrant(harness.module, { userId: dana.id, preset: "viewer" }).ok, true); // NEW
    assert.equal(users.createPendingInvite({ email: "carol@example.com", scopeCellIds: [harness.module.id] }).ok, true); // NEW
    harness.graph.setSelectionCell(harness.module); // NEW
    harness.actions.trellisUsers.funct(); // NEW
    assert.match(harness.document.body.textContent, /People & Access/); // NEW
    assert.match(harness.document.body.textContent, /Module: Module/); // NEW
    assert.match(harness.document.body.textContent, /Bob/); // NEW
    assert.match(harness.document.body.textContent, /Dana/); // NEW
    const search = inputByPlaceholder(harness.document, "Search name or email"); // NEW
    search.value = "bob@example"; // NEW
    search.dispatchEvent(new harness.context.window.Event("input", { bubbles: true })); // NEW
    assert.match(userGroupByTitle(harness.document, "Networked users").textContent, /Bob/); // NEW
    assert.doesNotMatch(harness.document.body.textContent, /carol@example\.com/); // NEW
    assert.doesNotMatch(harness.document.body.textContent, /Dana\s*Viewer/); // NEW
    assert.match(harness.document.body.textContent, /Granted/); // NEW
    assert.match(harness.document.body.textContent, /1 granted user is hidden by the current filter/); // NEW
    const filter = selectByOptionText(harness.document, "Networked"); // NEW
    search.value = ""; // NEW
    search.dispatchEvent(new harness.context.window.Event("input", { bubbles: true })); // NEW
    filter.value = "networked"; // NEW
    filter.dispatchEvent(new harness.context.window.Event("change", { bubbles: true })); // NEW
    assert.match(harness.document.body.textContent, /Pending invites/); // NEW
    assert.match(harness.document.body.textContent, /carol@example\.com/); // NEW
    assert.equal(userGroupByTitle(harness.document, "Local users"), undefined); // NEW
    filter.value = "local"; // NEW
    filter.dispatchEvent(new harness.context.window.Event("change", { bubbles: true })); // NEW
    assert.equal(userGroupByTitle(harness.document, "Networked users"), undefined); // NEW
    assert.equal(harness.document.body.textContent.includes("Pending invites"), false); // NEW
}); // NEW

test("selected access summarizes scope labels and hides editor for multiple selections", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    harness.module.style = "module=1"; // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const bed = appendChild(harness.module, makeXmlCell(harness.document, "bed", { garden_bed: "1", label: "North Bed" })); // NEW
    const board = appendChild(harness.module, makeXmlCell(harness.document, "board", { board_key: "KANBAN_BOARD", label: "Harvest Board" })); // NEW
    const bob = users.createUser("Bob", "5678", false).user; // NEW
    assert.equal(users.setScopeGrant(board, { userId: bob.id, preset: "task" }).ok, true); // NEW
    harness.graph.setSelectionCell(bed); // NEW
    harness.actions.trellisUsers.funct(); // NEW
    assert.match(harness.document.body.textContent, /Garden Bed: North Bed/); // NEW
    harness.graph.setSelectionCell(board); // NEW
    users._test.refreshPanel(); // NEW
    assert.match(harness.document.body.textContent, /Task Board: Harvest Board/); // NEW
    assert.match(harness.document.body.textContent, /Granted/); // NEW
    harness.graph.setSelectionCells([harness.module, bed, board]); // NEW
    users._test.refreshPanel(); // NEW
    assert.match(harness.document.body.textContent, /Module: Module/); // NEW
    assert.match(harness.document.body.textContent, /Garden Bed: North Bed/); // NEW
    assert.match(harness.document.body.textContent, /Task Board: Harvest Board/); // NEW
    assert.match(harness.document.body.textContent, /Access editor is hidden while multiple scopes are selected/); // NEW
    assert.doesNotMatch(harness.document.body.textContent, /Your effective access/); // NEW
}); // NEW

test("viewer grant keeps regular users view-only", () => { // CHANGE
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const bob = users.createUser("Bob", "5678", false).user; // NEW
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "viewer" }).ok, true); // CHANGE
    users.logout(); // NEW
    assert.equal(users.login("Bob", "5678").ok, true); // NEW
    assert.equal(users.canEditCell(harness.card), false); // CHANGE
    assert.equal(users.canAddCell(harness.module), false); // NEW
    assert.equal(users.canDeleteCell(harness.card), false); // NEW
    assert.equal(users.canManageAccess(harness.module), false); // NEW
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxCellAttributeChange" }, cell: harness.card, attribute: "label" }), false); // NEW
    const planting = appendChild(harness.module, makeXmlCell(harness.document, "viewer-planting", { tiler_group: "1" })); // NEW
    let undone = false; // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: planting, parent: harness.module }], undo() { undone = true; } }); // NEW
    assert.equal(undone, true); // NEW
    const bed = appendChild(harness.module, makeXmlCell(harness.document, "viewer-bed", { garden_bed: "1" })); // NEW
    undone = false; // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: bed, parent: harness.module }], undo() { undone = true; } }); // NEW
    assert.equal(undone, true); // NEW
    bed.parent = null; // NEW
    undone = false; // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: bed, previous: harness.module }], undo() { undone = true; } }); // NEW
    assert.equal(undone, true); // NEW
}); // NEW

test("permission diagnostics stay quiet unless explicitly enabled", () => { // NEW
    const calls = []; // NEW
    const fakeConsole = { groupCollapsed() { calls.push("group"); }, log() { calls.push("log"); }, table() { calls.push("table"); }, groupEnd() { calls.push("end"); } }; // NEW
    const harness = loadUsersPlugin({ console: fakeConsole }); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    users.stampCreatedOwner(harness.module); // NEW
    users.createUser("Bob", "5678", false); // NEW
    users.logout(); // NEW
    users.login("Bob", "5678"); // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxGeometryChange" }, cell: harness.card }], undo() {} }); // NEW
    assert.equal(calls.length, 0); // NEW
}); // NEW

test("permission diagnostics do not throw when console is unavailable", () => { // NEW
    const harness = loadUsersPlugin({ console: undefined }); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    users.stampCreatedOwner(harness.module); // NEW
    users.createUser("Bob", "5678", false); // NEW
    users.logout(); // NEW
    users.login("Bob", "5678"); // NEW
    harness.context.window.localStorage.setItem("trellis_users_debug", "1"); // NEW
    assert.doesNotThrow(function () { // NEW
        harness.model.fireChange({ changes: [{ constructor: { name: "mxGeometryChange" }, cell: harness.card }], undo() {} }); // NEW
    }); // NEW
}); // NEW

test("trellis debug surface reports users status and toggles debug flags", () => { // NEW
    const calls = []; // NEW
    const fakeConsole = { groupCollapsed(label) { calls.push(["group", label]); }, log(value) { calls.push(["log", value]); }, groupEnd() { calls.push(["end"]); } }; // NEW
    const harness = loadUsersPlugin({ console: fakeConsole }); // NEW
    const debug = harness.context.window.Trellis.debug; // NEW
    assert.equal(typeof debug.usersStatus, "function"); // NEW
    assert.equal(typeof debug.enable, "function"); // NEW
    assert.equal(typeof debug.disable, "function"); // NEW
    assert.equal(typeof debug.probe, "function"); // NEW
    assert.equal(debug.usersStatus().loaded, true); // NEW
    assert.equal(debug.usersStatus().storage.trellis_users_debug, null); // NEW
    const probe = debug.probe(); // NEW
    assert.equal(probe.usersPluginLoaded, true); // NEW
    assert.equal(probe.bedFitPluginLoaded, false); // NEW
    assert.ok(calls.some(call => call[0] === "group" && call[1] === "[TrellisDebug] probe")); // NEW
    const enabled = debug.enable(); // NEW
    assert.equal(harness.context.window.localStorage.getItem("trellis_users_debug"), "1"); // NEW
    assert.equal(harness.context.window.localStorage.getItem("trellis_bed_fit_debug"), "1"); // NEW
    assert.equal(enabled.windowFlags.users, true); // NEW
    assert.equal(enabled.windowFlags.bedFit, true); // NEW
    const disabled = debug.disable(); // NEW
    assert.equal(harness.context.window.localStorage.getItem("trellis_users_debug"), null); // NEW
    assert.equal(harness.context.window.localStorage.getItem("trellis_bed_fit_debug"), null); // NEW
    assert.equal(disabled.windowFlags.users, false); // NEW
    assert.equal(disabled.windowFlags.bedFit, false); // NEW
}); // NEW

test("admin remains allowed for bed-fit relevant child geometry and style changes", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    const planting = appendChild(harness.module, makeXmlCell(harness.document, "admin-planting", { tiler_group: "1" })); // NEW
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxChildChange" }, child: planting, parent: harness.module }), true); // NEW
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxGeometryChange" }, cell: planting }), true); // NEW
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxStyleChange" }, cell: planting }), true); // NEW
}); // NEW

test("admin planting creation allows generated plant tile churn in the same edit", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    const planting = appendChild(harness.module, makeXmlCell(harness.document, "admin-planting-fit", { tiler_group: "1" })); // NEW
    const generatedTile = makeXmlCell(harness.document, "generated-tile", { plant_tiler: "1", auto: "1", tile_r: "0", tile_c: "0" }); // NEW
    let undone = false; // NEW
    harness.model.fireChange({ // NEW
        changes: [ // NEW
            { constructor: { name: "mxChildChange" }, child: planting, parent: harness.module }, // NEW
            { constructor: { name: "mxChildChange" }, child: generatedTile } // NEW
        ], // NEW
        undo() { undone = true; } // NEW
    }); // NEW
    assert.equal(undone, false); // NEW
}); // NEW

test("grower grant creates and manages only owned planting groups", () => { // CHANGE
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    assert.deepEqual(Array.from(users._test.normalizeCapabilities(null, "grower")), ["create_plantings", "edit_task_details", "manage_own_plantings", "move_tasks"]); // CHANGE
    users.enableUsers("Alice", "1234"); // NEW
    harness.module.style = "module=1"; // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const bed = appendChild(harness.module, makeXmlCell(harness.document, "bed", { garden_bed: "1" })); // NEW
    const board = appendChild(harness.module, makeXmlCell(harness.document, "grower-board", { board_key: "KANBAN_BOARD" })); // NEW
    const lane = appendChild(board, makeXmlCell(harness.document, "grower-lane", { lane_key: "TODO" })); // NEW
    const taskCard = appendChild(lane, makeXmlCell(harness.document, "grower-task", { kanban_card: "1", title: "Water" })); // NEW
    const alicePlanting = appendChild(bed, makeXmlCell(harness.document, "alice-planting", { tiler_group: "1", [users.attrs.owner]: users.getCurrentUser().id })); // NEW
    const bob = users.createUser("Bob", "5678", false).user; // NEW
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "grower" }).ok, true); // NEW
    users.logout(); // NEW
    users.login("Bob", "5678"); // NEW
    assert.equal(users.canCreatePlanting(bed), true); // NEW
    assert.equal(users.canMoveTask(taskCard), true); // NEW
    assert.equal(users.canEditTaskDetails(taskCard), true); // NEW
    assert.equal(users.canEditCell(bed), false); // NEW
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxCellAttributeChange" }, cell: bed, attribute: "garden_bed" }), false); // NEW
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxCellAttributeChange" }, cell: harness.module, attribute: "label" }), false); // NEW
    assert.equal(users.canManagePlanting(alicePlanting), false); // NEW
    const bobPlanting = appendChild(bed, makeXmlCell(harness.document, "bob-planting", { tiler_group: "1" })); // NEW
    let undone = false; // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: bobPlanting, parent: bed }], undo() { undone = true; } }); // NEW
    assert.equal(undone, false); // NEW
    assert.equal(bobPlanting.getAttribute(users.attrs.owner), bob.id); // NEW
    assert.equal(users.canManagePlanting(bobPlanting), true); // NEW
    assert.equal(users.canManageAccess(bobPlanting), false); // NEW
    assert.equal(users.setOwner(bed, bob.id).ok, false); // NEW
}); // NEW

test("grower planting creation allows initialization edits and generated plant tile churn", () => { // CHANGE
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    harness.module.style = "module=1"; // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const bob = users.createUser("Bob", "5678", false).user; // NEW
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "grower" }).ok, true); // NEW
    users.logout(); // NEW
    assert.equal(users.login("Bob", "5678").ok, true); // NEW
    const planting = appendChild(harness.module, makeXmlCell(harness.document, "bob-planting-fit", { tiler_group: "1" })); // NEW
    const previousValue = planting.value.cloneNode(true); // NEW
    planting.setAttribute("label", "?"); // NEW
    const generatedTile = appendChild(planting, makeXmlCell(harness.document, "bob-generated-tile", { plant_tiler: "1", auto: "1", tile_r: "0", tile_c: "0" })); // CHANGE
    const previousTileValue = generatedTile.value.cloneNode(true); // NEW
    generatedTile.setAttribute("label", "?"); // NEW
    let undone = false; // NEW
    harness.model.fireChange({ // NEW
        changes: [ // NEW
            { constructor: { name: "mxChildChange" }, child: planting, parent: harness.module }, // NEW
            { constructor: { name: "mxValueChange" }, cell: planting, previous: previousValue, value: planting.value }, // NEW
            { constructor: { name: "mxChildChange" }, child: generatedTile, parent: planting }, // CHANGE
            { constructor: { name: "mxGeometryChange" }, cell: generatedTile }, // NEW
            { constructor: { name: "mxValueChange" }, cell: generatedTile, previous: previousTileValue, value: generatedTile.value }, // NEW
            { constructor: { name: "mxStyleChange" }, cell: generatedTile } // NEW
        ], // NEW
        undo() { undone = true; } // NEW
    }); // NEW
    assert.equal(undone, false); // NEW
    assert.equal(planting.getAttribute(users.attrs.owner), bob.id); // NEW
}); // NEW

test("grower cannot create or delete garden beds in a granted module", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    harness.module.style = "module=1"; // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const bob = users.createUser("Bob", "5678", false).user; // NEW
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "grower" }).ok, true); // NEW
    users.logout(); // NEW
    assert.equal(users.login("Bob", "5678").ok, true); // NEW
    const createdBed = appendChild(harness.module, makeXmlCell(harness.document, "grower-created-bed", { garden_bed: "1" })); // NEW
    let undone = false; // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: createdBed, parent: harness.module }], undo() { undone = true; } }); // NEW
    assert.equal(undone, true); // NEW
    const existingBed = appendChild(harness.module, makeXmlCell(harness.document, "grower-existing-bed", { garden_bed: "1" })); // NEW
    existingBed.parent = null; // NEW
    undone = false; // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: existingBed, previous: harness.module }], undo() { undone = true; } }); // NEW
    assert.equal(undone, true); // NEW
}); // NEW

test("generated plant tile churn still requires a valid planting context", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    const generatedTile = makeXmlCell(harness.document, "orphan-generated-tile", { plant_tiler: "1", auto: "1", tile_r: "0", tile_c: "0" }); // NEW
    let undone = false; // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: generatedTile }], undo() { undone = true; } }); // NEW
    assert.equal(undone, true); // NEW
}); // NEW

test("generated plant tile initialization rejects outside the created planting context", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    harness.module.style = "module=1"; // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const existingPlanting = appendChild(harness.module, makeXmlCell(harness.document, "existing-planting", { tiler_group: "1" })); // NEW
    const generatedTile = appendChild(existingPlanting, makeXmlCell(harness.document, "existing-generated-tile", { plant_tiler: "1", auto: "1", tile_r: "0", tile_c: "0" })); // NEW
    const bob = users.createUser("Bob", "5678", false).user; // NEW
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "grower" }).ok, true); // NEW
    users.logout(); // NEW
    assert.equal(users.login("Bob", "5678").ok, true); // NEW
    let undone = false; // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxGeometryChange" }, cell: generatedTile }], undo() { undone = true; } }); // NEW
    assert.equal(undone, true); // NEW
}); // NEW

test("created planting context does not allow manual plant tile initialization", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    harness.module.style = "module=1"; // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const bob = users.createUser("Bob", "5678", false).user; // NEW
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "grower" }).ok, true); // NEW
    users.logout(); // NEW
    assert.equal(users.login("Bob", "5678").ok, true); // NEW
    const planting = appendChild(harness.module, makeXmlCell(harness.document, "manual-tile-planting", { tiler_group: "1" })); // NEW
    const manualTile = appendChild(planting, makeXmlCell(harness.document, "manual-child-tile", { plant_tiler: "1", auto: "0" })); // NEW
    let undone = false; // NEW
    harness.model.fireChange({ // NEW
        changes: [ // NEW
            { constructor: { name: "mxChildChange" }, child: planting, parent: harness.module }, // NEW
            { constructor: { name: "mxChildChange" }, child: manualTile, parent: planting }, // NEW
            { constructor: { name: "mxGeometryChange" }, cell: manualTile } // NEW
        ], // NEW
        undo() { undone = true; } // NEW
    }); // NEW
    assert.equal(undone, true); // NEW
}); // NEW

test("planting context does not allow ordinary or manual orphan child changes", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    const ordinary = makeXmlCell(harness.document, "ordinary-orphan", { label: "Ordinary" }); // NEW
    const manualTile = makeXmlCell(harness.document, "manual-tile", { plant_tiler: "1", auto: "0" }); // NEW
    let undone = false; // NEW
    const plantingA = appendChild(harness.module, makeXmlCell(harness.document, "admin-planting-ordinary", { tiler_group: "1" })); // NEW
    harness.model.fireChange({ // NEW
        changes: [ // NEW
            { constructor: { name: "mxChildChange" }, child: plantingA, parent: harness.module }, // NEW
            { constructor: { name: "mxChildChange" }, child: ordinary } // NEW
        ], // NEW
        undo() { undone = true; } // NEW
    }); // NEW
    assert.equal(undone, true); // NEW
    undone = false; // NEW
    const plantingB = appendChild(harness.module, makeXmlCell(harness.document, "admin-planting-manual", { tiler_group: "1" })); // NEW
    harness.model.fireChange({ // NEW
        changes: [ // NEW
            { constructor: { name: "mxChildChange" }, child: plantingB, parent: harness.module }, // NEW
            { constructor: { name: "mxChildChange" }, child: manualTile } // NEW
        ], // NEW
        undo() { undone = true; } // NEW
    }); // NEW
    assert.equal(undone, true); // NEW
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

test("task grant allows task movement and details but not assignment or board changes", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const board = appendChild(harness.module, makeXmlCell(harness.document, "board", { board_key: "KANBAN_BOARD" })); // NEW
    const lane = appendChild(board, makeXmlCell(harness.document, "lane", { lane_key: "TODO" })); // NEW
    const card = appendChild(lane, makeXmlCell(harness.document, "task", { kanban_card: "1", title: "Water" })); // NEW
    const bob = users.createUser("Bob", "5678", false).user; // NEW
    assert.equal(users.setScopeGrant(board, { userId: bob.id, preset: "task" }).ok, true); // NEW
    users.logout(); users.login("Bob", "5678"); // NEW
    assert.equal(users.canMoveTask(card), true); // NEW
    assert.equal(users.canEditTaskDetails(card), true); // NEW
    assert.equal(users.canAddCell(board), false); // NEW
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxCellAttributeChange" }, cell: card, attribute: "title" }), true); // NEW
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxCellAttributeChange" }, cell: card, attribute: "task_assignee_role_ids_json" }), false); // NEW
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxCellAttributeChange" }, cell: board, attribute: "task_view_mode" }), false); // NEW
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxCellAttributeChange" }, cell: lane, attribute: "lane_key" }), false); // NEW
}); // NEW

test("manager grant can manage access but cannot transfer ownership", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const bob = users.createUser("Bob", "5678", false).user; // NEW
    const carol = users.createUser("Carol", "9999", false).user; // NEW
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "manager" }).ok, true); // NEW
    users.logout(); users.login("Bob", "5678"); // NEW
    assert.equal(users.canManageAccess(harness.module), true); // NEW
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxCellAttributeChange" }, cell: harness.card, attribute: "label" }), true); // NEW
    assert.equal(users.setScopeGrant(harness.module, { userId: carol.id, preset: "viewer" }).ok, true); // NEW
    assert.equal(users.setOwner(harness.module, carol.id).ok, false); // NEW
}); // NEW

test("manage scope content implies content capabilities but not access management", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    assert.deepEqual(Array.from(users._test.normalizeCapabilities([users.capabilities.manageScopeContent], "viewer")), [ // NEW
        users.capabilities.createPlantings, // NEW
        users.capabilities.editTaskDetails, // NEW
        users.capabilities.manageOwnPlantings, // NEW
        users.capabilities.manageScopeContent, // NEW
        users.capabilities.moveTasks // NEW
    ]); // NEW
    users.enableUsers("Alice", "1234"); // NEW
    harness.module.style = "module=1"; // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const board = appendChild(harness.module, makeXmlCell(harness.document, "scope-content-board", { board_key: "KANBAN_BOARD" })); // NEW
    const card = appendChild(board, makeXmlCell(harness.document, "scope-content-card", { kanban_card: "1", title: "Task" })); // NEW
    const bob = users.createUser("Bob", "5678", false).user; // NEW
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, capabilities: [users.capabilities.manageScopeContent] }).ok, true); // NEW
    const grants = JSON.parse(harness.module.getAttribute(users.attrs.accessGrants)); // NEW
    assert.deepEqual(grants[0].capabilities, [ // NEW
        users.capabilities.createPlantings, // NEW
        users.capabilities.editTaskDetails, // NEW
        users.capabilities.manageOwnPlantings, // NEW
        users.capabilities.manageScopeContent, // NEW
        users.capabilities.moveTasks // NEW
    ]); // NEW
    users.logout(); // NEW
    assert.equal(users.login("Bob", "5678").ok, true); // NEW
    assert.equal(users.canCreatePlanting(harness.module), true); // NEW
    const alicePlanting = appendChild(harness.module, makeXmlCell(harness.document, "scope-content-alice-planting", { tiler_group: "1", [users.attrs.owner]: users.listUsers().find(user => user.name === "Alice").id })); // NEW
    assert.equal(users.canManagePlanting(alicePlanting), true); // NEW
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxGeometryChange" }, cell: alicePlanting }), true); // NEW
    assert.equal(users.canManagePlanting(appendChild(harness.module, makeXmlCell(harness.document, "scope-content-planting", { tiler_group: "1", [users.attrs.owner]: bob.id }))), true); // NEW
    assert.equal(users.canMoveTask(card), true); // NEW
    assert.equal(users.canEditTaskDetails(card), true); // NEW
    assert.equal(users.canManageAccess(harness.module), false); // NEW
}); // NEW

test("manage scope content checkbox auto-checks implied capabilities", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const bob = users.createUser("Bob", "5678", false).user; // NEW
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "viewer" }).ok, true); // NEW
    harness.graph.setSelectionCell(harness.module); // NEW
    harness.actions.trellisUsers.funct(); // NEW
    const manageScope = checkboxByLabel(harness.document, "Manage scope content"); // NEW
    assert.ok(manageScope); // NEW
    [ // NEW
        ["Create plantings", "Create new planting groups in granted garden beds/modules."], // NEW
        ["Manage own plantings", "Edit, move, resize, schedule, and delete planting groups the user owns."], // NEW
        ["Move tasks", "Move task cards between lanes/days and reorder task schedules in granted task boards."], // NEW
        ["Edit task details", "Edit task titles, notes, dates, estimates, and other non-assignment task details."], // NEW
        ["Manage scope content", "Manage all non-access content in the scope, including plantings and task content."], // NEW
        ["Manage access", "Invite users and change grants for the scope; ownership transfer remains owner/admin-only."] // NEW
    ].forEach(function (entry) { // NEW
        const label = labelByText(harness.document, entry[0]); // NEW
        assert.ok(label); // NEW
        assert.equal(label.title, entry[1]); // NEW
        assert.equal(label.querySelector("input[type='checkbox']").title, entry[1]); // NEW
    }); // NEW
    manageScope.checked = true; // NEW
    manageScope.dispatchEvent(new harness.context.window.Event("change", { bubbles: true })); // NEW
    assert.equal(checkboxByLabel(harness.document, "Create plantings").checked, true); // NEW
    assert.equal(checkboxByLabel(harness.document, "Manage own plantings").checked, true); // NEW
    assert.equal(checkboxByLabel(harness.document, "Move tasks").checked, true); // NEW
    assert.equal(checkboxByLabel(harness.document, "Edit task details").checked, true); // NEW
    assert.equal(checkboxByLabel(harness.document, "Manage access").checked, false); // NEW
    const grant = JSON.parse(harness.module.getAttribute(users.attrs.accessGrants))[0]; // NEW
    assert.deepEqual(grant.capabilities, [ // NEW
        users.capabilities.createPlantings, // NEW
        users.capabilities.editTaskDetails, // NEW
        users.capabilities.manageOwnPlantings, // NEW
        users.capabilities.manageScopeContent, // NEW
        users.capabilities.moveTasks // NEW
    ]); // NEW
}); // NEW

test("child access rows visibly show inherited manage scope content without writing grants", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    harness.module.style = "module=1"; // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const child = appendChild(harness.module, makeXmlCell(harness.document, "inherited-child", { label: "Child Cell" })); // NEW
    const bob = users.createUser("Bob", "5678", false).user; // NEW
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, capabilities: [users.capabilities.manageScopeContent] }).ok, true); // NEW
    const parentGrantsBefore = harness.module.getAttribute(users.attrs.accessGrants); // NEW
    const writesBefore = harness.model.setValueCalls || 0; // NEW
    harness.graph.setSelectionCell(child); // NEW
    harness.actions.trellisUsers.funct(); // NEW
    const row = accessRowByUserId(harness.document, bob.id); // NEW
    assert.ok(row); // NEW
    assert.match(row.textContent, /Inherited from Module: Module/); // NEW
    assert.doesNotMatch(row.textContent, /Granted/); // NEW
    assert.equal(checkboxByLabelIn(row, "Manage scope content").checked, true); // NEW
    assert.equal(checkboxByLabelIn(row, "Create plantings").checked, true); // NEW
    assert.equal(checkboxByLabelIn(row, "Manage own plantings").checked, true); // NEW
    assert.equal(checkboxByLabelIn(row, "Move tasks").checked, true); // NEW
    assert.equal(checkboxByLabelIn(row, "Edit task details").checked, true); // NEW
    assert.equal(checkboxByLabelIn(row, "Manage access").checked, false); // NEW
    assert.equal(child.getAttribute(users.attrs.accessGrants), null); // NEW
    assert.equal(harness.module.getAttribute(users.attrs.accessGrants), parentGrantsBefore); // NEW
    assert.equal(harness.model.setValueCalls || 0, writesBefore); // NEW
}); // NEW

test("editing inherited child access creates a direct child grant and leaves parent grants unchanged", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    harness.module.style = "module=1"; // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const child = appendChild(harness.module, makeXmlCell(harness.document, "edited-inherited-child", { label: "Child Cell" })); // NEW
    const bob = users.createUser("Bob", "5678", false).user; // NEW
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, capabilities: [users.capabilities.manageScopeContent] }).ok, true); // NEW
    const parentGrantsBefore = harness.module.getAttribute(users.attrs.accessGrants); // NEW
    harness.graph.setSelectionCell(child); // NEW
    harness.actions.trellisUsers.funct(); // NEW
    const row = accessRowByUserId(harness.document, bob.id); // NEW
    checkboxByLabelIn(row, "Manage access").checked = true; // NEW
    checkboxByLabelIn(row, "Manage access").dispatchEvent(new harness.context.window.Event("change", { bubbles: true })); // NEW
    assert.equal(harness.module.getAttribute(users.attrs.accessGrants), parentGrantsBefore); // NEW
    const childGrant = JSON.parse(child.getAttribute(users.attrs.accessGrants))[0]; // NEW
    assert.equal(childGrant.userId, bob.id); // NEW
    assert.equal(childGrant.capabilities.includes(users.capabilities.manageScopeContent), true); // NEW
    assert.equal(childGrant.capabilities.includes(users.capabilities.manageAccess), true); // NEW
}); // NEW

test("direct child grants remain distinguishable from inherited parent access", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    harness.module.style = "module=1"; // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const child = appendChild(harness.module, makeXmlCell(harness.document, "direct-and-inherited-child", { label: "Child Cell" })); // NEW
    const bob = users.createUser("Bob", "5678", false).user; // NEW
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, capabilities: [users.capabilities.manageScopeContent] }).ok, true); // NEW
    assert.equal(users.setScopeGrant(child, { userId: bob.id, preset: "viewer" }).ok, true); // NEW
    harness.graph.setSelectionCell(child); // NEW
    harness.actions.trellisUsers.funct(); // NEW
    const row = accessRowByUserId(harness.document, bob.id); // NEW
    assert.match(row.textContent, /Granted/); // NEW
    assert.match(row.textContent, /Inherited from Module: Module/); // NEW
    assert.equal(checkboxByLabelIn(row, "Manage scope content").checked, true); // NEW
}); // NEW

test("manager can create and delete garden beds in a granted module", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    harness.module.style = "module=1"; // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const bob = users.createUser("Bob", "5678", false).user; // NEW
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "manager" }).ok, true); // NEW
    users.logout(); // NEW
    assert.equal(users.login("Bob", "5678").ok, true); // NEW
    const createdBed = appendChild(harness.module, makeXmlCell(harness.document, "manager-created-bed", { garden_bed: "1" })); // NEW
    let undone = false; // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: createdBed, parent: harness.module }], undo() { undone = true; } }); // NEW
    assert.equal(undone, false); // NEW
    const existingBed = appendChild(harness.module, makeXmlCell(harness.document, "manager-existing-bed", { garden_bed: "1" })); // NEW
    existingBed.parent = null; // NEW
    undone = false; // NEW
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: existingBed, previous: harness.module }], undo() { undone = true; } }); // NEW
    assert.equal(undone, false); // NEW
}); // NEW

test("linked role cards imply task access for reciprocal boards and fail closed when ambiguous", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const board = appendChild(harness.module, makeXmlCell(harness.document, "board", { board_key: "KANBAN_BOARD", linkedTo: "role-bob" })); // NEW
    const lane = appendChild(board, makeXmlCell(harness.document, "lane", { lane_key: "TODO" })); // NEW
    const card = appendChild(lane, makeXmlCell(harness.document, "task", { kanban_card: "1", title: "Water" })); // NEW
    const role = appendChild(harness.module, new TestCell("role-bob", makeXmlCell(harness.document, "role-value", { label: "Bob Role", linkedTo: "board" }).value, "shape=swimlane;role_card=1;")); // NEW
    const bob = users.createUser("Bob", "5678", false).user; // NEW
    assert.equal(users.setUserRoleCard(bob.id, role).ok, true); // NEW
    users.logout(); users.login("Bob", "5678"); // NEW
    assert.equal(users.canMoveTask(card), true); // NEW
    assert.equal(users.canEditTaskDetails(card), true); // NEW
    const duplicate = appendChild(harness.module, new TestCell("role-bob-2", makeXmlCell(harness.document, "role-value-2", { label: "Bob Role 2", linkedTo: "board", [users.attrs.roleUser]: bob.id }).value, "shape=swimlane;role_card=1;")); // NEW
    assert.ok(duplicate); // NEW
    assert.equal(users.getUserRoleCard(bob.id), null); // NEW
    assert.equal(users.canMoveTask(card), false); // NEW
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
    const grants = JSON.parse(harness.module.getAttribute(users.attrs.accessGrants)); // CHANGE
    assert.deepEqual(grants, [{ userId: store.pendingUsers[0].id, preset: "viewer", capabilities: [] }]); // NEW
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

test("pending invite stores selected preset capabilities", () => { // NEW
    const harness = loadUsersPlugin(); // NEW
    const users = harness.context.window.Trellis.users; // NEW
    users.enableUsers("Alice", "1234"); // NEW
    harness.module.style = "module=1"; // NEW
    users.stampCreatedOwner(harness.module); // NEW
    const invite = users.createPendingInvite({ email: "grower@example.com", scopeCellIds: [harness.module.id], preset: "grower" }); // NEW
    assert.equal(invite.ok, true); // NEW
    assert.equal(invite.invite.preset, "grower"); // NEW
    assert.deepEqual(Array.from(invite.invite.capabilities), ["create_plantings", "edit_task_details", "manage_own_plantings", "move_tasks"]); // CHANGE
    assert.deepEqual(JSON.parse(harness.module.getAttribute(users.attrs.accessGrants))[0].capabilities, ["create_plantings", "edit_task_details", "manage_own_plantings", "move_tasks"]); // CHANGE
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
    assert.equal(users.canEditCell(harness.card), false); // CHANGE
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
    assert.match(harness.module.getAttribute(users.attrs.accessGrants), new RegExp(pendingId)); // CHANGE
    assert.equal(users.revokeInvite(invite.invite.id).ok, true); // NEW
    assert.doesNotMatch(harness.module.getAttribute(users.attrs.accessGrants) || "", new RegExp(pendingId)); // CHANGE
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
    assert.doesNotMatch(harness.module.getAttribute(users.attrs.accessGrants) || "", new RegExp(invite.invite.pendingUserId)); // CHANGE
    assert.equal(users.acceptInvite({ email: "bob@example.com", code: invite.code, name: "Bob", pin: "5678" }).ok, false); // NEW
}); // NEW
