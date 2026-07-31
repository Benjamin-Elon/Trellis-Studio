const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const projectRoot = path.resolve(__dirname, "..");
const pluginPath = path.join(projectRoot, "drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Users.js");

class TestCell {
    constructor(id, value = null, style = "") {
        this.id = id;
        this.value = value;
        this.style = style;
        this.children = [];
        this.vertex = true;
    }
    getId() { return this.id; }
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
    index(cell) { cell.model = this; this.cells.set(cell.id, cell); (cell.children || []).forEach(child => this.index(child)); }
    getRoot() { return this.root; }
    getParent(cell) { return cell && cell.parent ? cell.parent : null; }
    getChildCount(cell) { return cell && cell.children ? cell.children.length : 0; }
    getChildAt(cell, index) { return cell.children[index]; }
    getCell(id) { return this.cells.get(id) || null; }
    beginUpdate() {}
    endUpdate() {}
    setValue(cell, value) { this.setValueCalls = (this.setValueCalls || 0) + 1; cell.value = value; }
    addListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(fn); }
    fireChange(edit) { (this.listeners.get("change") || []).forEach(fn => fn(this, { getProperty: key => key === "edit" ? edit : null })); }
}

function appendChild(parent, child) {
    child.parent = parent;
    parent.children.push(child);
    if (parent.model) parent.model.index(child);
    return child;
}

function linkCells(left, right) {
    [
        [left, right],
        [right, left]
    ].forEach(([source, target]) => {
        const ids = new Set(String(source.getAttribute("linkedTo") || "").split(",").map(part => part.trim()).filter(Boolean));
        ids.add(target.id);
        source.setAttribute("linkedTo", Array.from(ids).join(","));
    });
}

function installGardenRoleModuleApi(harness) {
    harness.graph.__trellisModules = {
        ensureGardenTeamModule(garden) {
            const existingId = garden.getAttribute("trellis_team_module_id");
            const existing = existingId && harness.model.getCell(existingId);
            if (existing) return existing;
            const team = appendChild(harness.layer, makeXmlCell(harness.document, "team-" + garden.id, { label: (garden.getAttribute("label") || "Garden") + " Team", team_module: "1", trellis_garden_module_id: garden.id }));
            team.style = "module=1";
            garden.setAttribute("trellis_team_module_id", team.id);
            linkCells(garden, team);
            return team;
        },
        createRoleCard(team, x, y) {
            const role = appendChild(team, new TestCell("role-" + team.id + "-" + (team.children.length + 1), makeXmlCell(harness.document, "role-value", { label: "Role" }).value, "shape=swimlane;role_card=1;role_card_version=2;"));
            appendChild(role, new TestCell(role.id + "-name", "", "shape=rectangle;role_name=1;"));
            appendChild(role, new TestCell(role.id + "-title", "", "shape=rectangle;role_title=1;"));
            appendChild(role, new TestCell(role.id + "-contact", "", "shape=rectangle;role_contact=1;"));
            role.createdAt = { x, y };
            return role;
        },
        addReciprocalLink: linkCells,
        applyModuleMargins(moduleCell, opts) {
            harness.moduleMarginCalls = harness.moduleMarginCalls || [];
            harness.moduleMarginCalls.push({ moduleCell, opts });
        }
    };
}

function roleFieldText(roleCard, flag) {
    const field = (roleCard.children || []).find(child => String(child.style || "").includes(flag + "=1"));
    return field && field.value && field.value.nodeType === 1 ? field.value.getAttribute("label") : (field ? field.value : "");
}

function makeXmlCell(document, id, attrs = {}) {
    const node = document.implementation.createDocument("", "", null).createElement("object");
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    return new TestCell(id, node);
}

function loadUsersPlugin(options = {}) {
    const dom = new JSDOM("<!doctype html><body><div id='host'><div id='graph'></div></div></body>", { url: "https://app.test/" });
    const document = dom.window.document;
    Object.defineProperty(dom.window, "innerWidth", { configurable: true, value: 1024 });
    Object.defineProperty(dom.window, "innerHeight", { configurable: true, value: 768 });
    const root = new TestCell("root");
    const layer = appendChild(root, makeXmlCell(document, "layer", { label: "Layer" }));
    const module = appendChild(layer, makeXmlCell(document, "module", { label: "Module" }));
    const card = appendChild(module, makeXmlCell(document, "card", { label: "Card" }));
    const outside = appendChild(layer, makeXmlCell(document, "outside", { label: "Outside" }));
    const model = new TestModel(root);
    const graphListeners = new Map();
    const editorListeners = new Map();
    const timers = [];
    let nextTimerId = 1;
    function setTestTimeout(fn, delay) {
        const ms = Number(delay) || 0;
        if (ms <= 0) { fn(); return 0; }
        const timer = { id: nextTimerId++, fn, delay: ms, cleared: false };
        timers.push(timer);
        return timer.id;
    }
    function clearTestTimeout(id) {
        const timer = timers.find(entry => entry.id === id);
        if (timer) timer.cleared = true;
    }
    function flushTimers() {
        const pending = timers.splice(0, timers.length);
        pending.forEach(timer => { if (!timer.cleared) timer.fn(); });
    }
    function pendingTimers() { return timers.filter(timer => !timer.cleared); }
    const graph = {
        container: document.getElementById("graph"),
        getModel() { return model; },
        getDefaultParent() { return layer; },
        getSelectionCell() { return graph.selectedCells && graph.selectedCells.length ? graph.selectedCells[0] : (graph.selected || null); },
        getSelectionCells() { return graph.selectedCells || (graph.selected ? [graph.selected] : []); },
        setSelectionCell(cell) { graph.selected = cell; graph.selectedCells = cell ? [cell] : []; },
        setSelectionCells(cells) { graph.selectedCells = (cells || []).filter(Boolean); graph.selected = graph.selectedCells[0] || null; },
        getSelectionModel() { return { addListener() {} }; },
        addListener(name, fn) { if (!graphListeners.has(name)) graphListeners.set(name, []); graphListeners.get(name).push(fn); },
        setEnabled(value) { graph.enabled = value; },
        refresh() { graph.refreshed = true; }
    };
    const actions = {};
    const toolbarContainer = document.createElement("div");
    document.body.insertBefore(toolbarContainer, document.body.firstChild);
    if (options.historyButton) {
        const history = document.createElement("button");
        history.className = "geButton trellis-changemap-history-button";
        history.textContent = "History";
        toolbarContainer.appendChild(history);
    }
    const ui = {
        editor: {
            graph,
            addListener(name, fn) { if (!editorListeners.has(name)) editorListeners.set(name, []); editorListeners.get(name).push(fn); },
            setGraphXml(node) {
                ui.setGraphXmlCalls = (ui.setGraphXmlCalls || 0) + 1;
                const edit = ui.setGraphXmlEdit || { changes: [{ constructor: { name: "mxChildChange" }, child: module, parent: layer }], undo() { ui.setGraphXmlUndone = true; } };
                model.fireChange(edit);
                ui.setGraphXmlNode = node;
            }
        },
        actions: { addAction(id, fn) { actions[id] = { funct: fn }; } },
        menus: { get() { return null; }, addMenuItems() {} },
        toolbarContainer,
        alerts: [],
        lastDialog: null,
        lastDialogArgs: null,
        alert(message) { ui.alerts.push(String(message || "")); },
        hideDialog() {
            if (ui.dialog && ui.dialog.bg && ui.dialog.bg.parentNode) ui.dialog.bg.parentNode.removeChild(ui.dialog.bg);
            if (ui.dialog && ui.dialog.container && ui.dialog.container.parentNode) ui.dialog.container.parentNode.removeChild(ui.dialog.container);
            ui.dialog = null;
            ui.lastDialog = null;
        },
        showDialog(node, width, height, modal, closable) {
            const bg = document.createElement("div");
            const container = document.createElement("div");
            container.appendChild(node);
            document.body.appendChild(bg);
            document.body.appendChild(container);
            ui.dialog = { bg, container };
            ui.lastDialog = node;
            ui.lastDialogArgs = { node, width, height, modal, closable };
        },
        fileLoaded(file) { ui.loadedFile = file; (editorListeners.get("fileLoaded") || []).forEach(fn => fn()); },
        getCurrentFile() { return ui.currentFile || null; }
    };
    const testConsole = Object.prototype.hasOwnProperty.call(options, "console") ? options.console : console;
    const context = {
        window: dom.window, document, console: testConsole, Promise, Error, String, Number, Math, Date, Set, Map, JSON,
        setTimeout: setTestTimeout,
        clearTimeout: clearTestTimeout,
        Draw: { loadPlugin(callback) { callback(ui); } },
        mxEvent: { CHANGE: "change" },
        mxUtils: { createXmlDocument() { return document.implementation.createDocument("", "", null); } }
    };
    vm.runInNewContext(fs.readFileSync(pluginPath, "utf8"), context, { filename: pluginPath });
    const loginButton = document.querySelector(".trellis-users-login-button");
    if (loginButton) loginButton.getBoundingClientRect = () => ({ left: 850, right: 910, top: 10, bottom: 34, width: 60, height: 24 });
    return { context, document, graph, model, layer, module, card, outside, actions, ui, toolbarContainer, editorListeners, flushTimers, pendingTimers, get lastDialog() { return ui.lastDialog; } };
}

function buttonByText(document, text) {
    return Array.from(document.querySelectorAll("button")).find(button => button.textContent === text);
}

function buttonByTextIn(root, text) {
    return Array.from(root.querySelectorAll("button")).find(button => button.textContent === text);
}

function inputByPlaceholder(document, text) {
    return Array.from(document.querySelectorAll("input")).find(input => input.placeholder === text);
}

function authOverlays(document) {
    return Array.from(document.querySelectorAll(".trellis-users-auth-overlay"));
}

function resetUiNotifications(harness) {
    harness.ui.alerts = [];
    if (harness.ui.dialog) harness.ui.hideDialog();
    harness.ui.dialog = null;
    harness.ui.lastDialog = null;
    harness.ui.lastDialogArgs = null;
    const users = harness.context.window.Trellis && harness.context.window.Trellis.users;
    if (users && users._test && users._test.closeRejectedEditPopover) users._test.closeRejectedEditPopover();
}

function rejectedPopover(document) {
    return document.querySelector(".trellis-users-rejected-edit-popover");
}

function fireGraphPointer(harness, x, y, type = "mousemove") {
    const evt = new harness.context.window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
    harness.graph.container.dispatchEvent(evt);
}

function userGroupByTitle(document, title) {
    return Array.from(document.querySelectorAll(".trellis-users-user-group")).find(group => group.getAttribute("data-trellis-users-group") === title);
}

function selectByOptionText(document, text) {
    return Array.from(document.querySelectorAll("select")).find(select => Array.from(select.options || []).some(option => option.textContent === text));
}

function checkboxByLabel(document, text) {
    return labelByText(document, text)?.querySelector("input[type='checkbox']") || null;
}

function accessRowByUserId(document, userId) {
    return document.querySelector('.trellis-users-access-row[data-trellis-users-user-id="' + userId + '"]');
}

function openGardenAccessPopover(document, userId) {
    const dropdown = document.querySelector('.trellis-users-garden-access-dropdown[data-trellis-users-user-id="' + userId + '"]');
    assert.ok(dropdown);
    const button = dropdown.querySelector(".trellis-users-garden-access-button");
    assert.ok(button);
    if (button.getAttribute("aria-expanded") !== "true") button.click();
    const reopened = document.querySelector('.trellis-users-garden-access-dropdown[data-trellis-users-user-id="' + userId + '"]');
    assert.ok(reopened);
    return reopened;
}

function gardenAccessRow(document, userId, gardenId) {
    const selector = '.trellis-users-garden-access-row[data-trellis-users-user-id="' + userId + '"]' + (gardenId ? '[data-trellis-users-garden-id="' + gardenId + '"]' : '');
    return document.querySelector(selector);
}

function labelByText(root, text) {
    return Array.from(root.querySelectorAll("label")).find(label => label.textContent.trim() === text) || null;
}

function checkboxByLabelIn(root, text) {
    return labelByText(root, text)?.querySelector("input[type='checkbox']") || null;
}

test("disabled diagrams do not prompt or block edits", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    assert.equal(users.isEnabled(), false);
    assert.equal(harness.document.querySelector(".trellis-users-auth-overlay"), null);
    assert.ok(harness.document.querySelector(".trellis-users-login-button"));
    assert.equal(users.canEditCell(harness.card), true);
    assert.equal(users.login("Alice", "1234").ok, false);
    let undone = false;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxValueChange" }, cell: harness.card }], undo() { undone = true; } });
    assert.equal(undone, false);
    assert.ok(harness.actions.trellisUsers);
});

test("toolbar login enables users and keeps the first admin logged in for this diagram", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    harness.document.querySelector(".trellis-users-login-button").click();
    assert.ok(harness.document.querySelector(".trellis-users-auth-overlay"));
    inputByPlaceholder(harness.document, "Admin name").value = "Alice";
    inputByPlaceholder(harness.document, "PIN").value = "1234";
    harness.document.querySelector(".trellis-users-auth-overlay input[type='checkbox']").checked = true;
    buttonByText(harness.document, "Enable Users").click();
    assert.equal(users.isEnabled(), true);
    assert.equal(users.isLoggedIn(), true);
    assert.equal(harness.document.querySelector(".trellis-users-auth-overlay"), null);
    const key = users._test.getDiagramLoginKey(false);
    assert.equal(harness.context.window.localStorage.getItem("trellis_users_remembered_login_v1:" + key), users.getCurrentUser().id);
});

test("users toolbar button is inserted beside an existing ChangeMap History button", () => {
    const harness = loadUsersPlugin({ historyButton: true });
    const buttons = Array.from(harness.toolbarContainer.querySelectorAll("button"));
    assert.equal(buttons[0].className.includes("trellis-users-login-button"), true);
    assert.equal(buttons[1].className.includes("trellis-changemap-history-button"), true);
});

test("enable users creates the first admin and persists usersEnabled", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    const result = users.enableUsers("Alice", "1234");
    assert.equal(result.ok, true);
    assert.equal(users.isEnabled(), true);
    assert.equal(users.isLoggedIn(), true);
    assert.equal(users.isAdmin(), true);
    assert.equal(users.getCurrentUser().name, "Alice");
    assert.equal(users.listUsers().length, 1);
    assert.equal(users._test.readStore().usersEnabled, true);
    assert.match(harness.layer.getAttribute("trellis_users_json"), /Alice/);
});

test("accepted visible edits merge actor metadata into the same undoable edit", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    const edit = { changes: [{ constructor: { name: "mxGeometryChange" }, cell: harness.card }] };
    harness.model.fireChange(edit);
    assert.equal(edit.changes.length, 2);
    assert.equal(harness.card.getAttribute(users.attrs.editedBy), users.getCurrentUser().id);
    const actorChange = edit.changes.find(change => change.__trellisUsersActorStamp);
    assert.ok(actorChange);
    actorChange.execute();
    assert.equal(harness.card.getAttribute(users.attrs.editedBy), null);
    actorChange.execute();
    assert.equal(harness.card.getAttribute(users.attrs.editedBy), users.getCurrentUser().id);
});

test("created planting ownership metadata is included in the creation undo edit", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    const planting = makeXmlCell(harness.document, "planting", { label: "Planting", tiler_group: "1" });
    appendChild(harness.module, planting);
    const edit = { changes: [{ constructor: { name: "mxChildChange" }, child: planting, parent: harness.module }] };
    harness.model.fireChange(edit);
    assert.equal(edit.changes.length, 2);
    assert.equal(planting.getAttribute(users.attrs.owner), users.getCurrentUser().id);
    assert.equal(planting.getAttribute(users.attrs.createdBy), users.getCurrentUser().id);
    const actorChange = edit.changes.find(change => change.__trellisUsersActorStamp);
    actorChange.execute();
    assert.equal(planting.getAttribute(users.attrs.owner), null);
    assert.equal(planting.getAttribute(users.attrs.createdBy), null);
    actorChange.execute();
    assert.equal(planting.getAttribute(users.attrs.owner), users.getCurrentUser().id);
});

test("direct actor stamping mutates XML without model setValue calls", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    const preInsert = new TestCell("pre-insert", "Pre Insert");
    harness.model.setValueCalls = 0;
    assert.equal(users.stampActorDirect(preInsert, "created"), true);
    assert.equal(harness.model.setValueCalls, 0);
    assert.equal(preInsert.getAttribute(users.attrs.createdBy), users.getCurrentUser().id);
});

test("logged-out enabled diagrams reject edits", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    users.logout();
    fireGraphPointer(harness, 100, 120);
    let undone = false;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxValueChange" }, cell: harness.card }], undo() { undone = true; } });
    assert.equal(undone, true);
    const popover = rejectedPopover(harness.document);
    assert.ok(popover);
    assert.match(popover.textContent, /Log in before editing this diagram\./);
    assert.ok(buttonByTextIn(popover, "Log in"));
    assert.equal(harness.lastDialog, null);
    assert.equal(popover.style.zIndex, "2000000000");
});

test("permission rejected edits show a cursor popover with request access", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    users.createUser("Bob", "5678", false);
    users.logout();
    users.login("Bob", "5678");
    fireGraphPointer(harness, 200, 210);
    let undone = false;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxGeometryChange" }, cell: harness.card }], undo() { undone = true; } });
    assert.equal(undone, true);
    const popover = rejectedPopover(harness.document);
    assert.ok(popover);
    assert.match(popover.textContent, /Change rejected by Trellis user permissions\./);
    assert.ok(buttonByTextIn(popover, "Request Access"));
    assert.equal(harness.lastDialog, null);
    assert.equal(harness.ui.lastDialogArgs, null);
    buttonByTextIn(popover, "Request Access").click();
    assert.equal(rejectedPopover(harness.document), null);
    assert.ok(harness.document.querySelector(".trellis-users-access-dialog"));
});

test("rejected edit popover clamps to the viewport and replaces prior notices", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    users.logout();
    fireGraphPointer(harness, 1015, 760);
    harness.model.fireChange({ changes: [{ constructor: { name: "mxValueChange" }, cell: harness.card }], undo() {} });
    let popover = rejectedPopover(harness.document);
    assert.ok(popover);
    assert.ok(parseInt(popover.style.left, 10) <= 696);
    assert.ok(parseInt(popover.style.top, 10) <= 634);
    fireGraphPointer(harness, 20, 30);
    harness.model.fireChange({ changes: [{ constructor: { name: "mxStyleChange" }, cell: harness.card }], undo() {} });
    const popovers = harness.document.querySelectorAll(".trellis-users-rejected-edit-popover");
    assert.equal(popovers.length, 1);
    popover = popovers[0];
    assert.equal(parseInt(popover.style.left, 10), 32);
    assert.equal(parseInt(popover.style.top, 10), 42);
});

test("rejected edit popover auto-dismiss pauses while hovered or focused", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    users.logout();
    harness.model.fireChange({ changes: [{ constructor: { name: "mxValueChange" }, cell: harness.card }], undo() {} });
    let popover = rejectedPopover(harness.document);
    assert.ok(popover);
    assert.equal(harness.pendingTimers().length, 1);
    popover.dispatchEvent(new harness.context.window.MouseEvent("mouseenter", { bubbles: false }));
    harness.flushTimers();
    assert.ok(rejectedPopover(harness.document));
    popover.dispatchEvent(new harness.context.window.MouseEvent("mouseleave", { bubbles: false }));
    assert.equal(harness.pendingTimers().length, 1);
    popover.dispatchEvent(new harness.context.window.FocusEvent("focusin", { bubbles: true }));
    harness.flushTimers();
    assert.ok(rejectedPopover(harness.document));
    popover.dispatchEvent(new harness.context.window.FocusEvent("focusout", { bubbles: true }));
    assert.equal(harness.pendingTimers().length, 1);
    harness.flushTimers();
    assert.equal(rejectedPopover(harness.document), null);
});

test("rejected edit popover login action opens auth dialog", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    users.logout();
    harness.model.fireChange({ changes: [{ constructor: { name: "mxValueChange" }, cell: harness.card }], undo() {} });
    const popover = rejectedPopover(harness.document);
    assert.ok(popover);
    buttonByTextIn(popover, "Log in").click();
    assert.equal(rejectedPopover(harness.document), null);
    assert.ok(harness.document.querySelector(".trellis-users-auth-overlay"));
});

test("rejected edit popover falls back to status when no host is available", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    const body = harness.document.body;
    if (body && body.parentNode) body.parentNode.removeChild(body);
    harness.graph.container = null;
    users._test.showRejectedEditPopover("Fallback rejection.");
    assert.deepEqual(harness.ui.alerts, ["Fallback rejection."]);
});

test("enabled diagram load changes are allowed while logged out but later edits are rejected", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    users.logout();
    let loadUndone = false;
    harness.ui.openingFile = true;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: harness.module, parent: harness.layer }], undo() { loadUndone = true; } });
    harness.ui.openingFile = false;
    harness.ui.fileLoaded({});
    assert.equal(loadUndone, false);
    assert.ok(harness.document.querySelector(".trellis-users-auth-overlay"));
    let editUndone = false;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxValueChange" }, cell: harness.card }], undo() { editUndone = true; } });
    assert.equal(editUndone, true);
});

test("direct setGraphXml load changes are allowed and then show the auth gate", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    users.logout();
    harness.ui.setGraphXmlUndone = false;
    harness.ui.editor.setGraphXml(harness.document.createElement("mxGraphModel"));
    assert.equal(harness.ui.setGraphXmlCalls, 1);
    assert.equal(harness.ui.setGraphXmlUndone, false);
    assert.ok(harness.document.querySelector(".trellis-users-auth-overlay"));
});

test("auth gate failed login stays inline without a Draw.io alert", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    users.logout();
    resetUiNotifications(harness);
    const overlay = harness.document.querySelector(".trellis-users-auth-overlay");
    inputByPlaceholder(overlay, "Name").value = "Alice";
    inputByPlaceholder(overlay, "PIN").value = "bad";
    buttonByTextIn(overlay, "Login").click();
    assert.equal(authOverlays(harness.document).length, 1);
    assert.match(harness.document.querySelector(".trellis-users-auth-overlay").textContent, /Unknown user or incorrect PIN\./);
    assert.deepEqual(harness.ui.alerts, []);
    assert.equal(harness.ui.dialog, null);
});

test("auth gate successful login closes silently and leaves no stale failed alert", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    users.logout();
    resetUiNotifications(harness);
    const overlay = harness.document.querySelector(".trellis-users-auth-overlay");
    inputByPlaceholder(overlay, "Name").value = "Alice";
    inputByPlaceholder(overlay, "PIN").value = "bad";
    buttonByTextIn(overlay, "Login").click();
    inputByPlaceholder(overlay, "Name").value = "Alice";
    inputByPlaceholder(overlay, "PIN").value = "1234";
    buttonByTextIn(overlay, "Login").click();
    assert.equal(harness.document.querySelector(".trellis-users-auth-overlay"), null);
    assert.equal(harness.graph.enabled, true);
    assert.equal(harness.document.querySelector(".trellis-users-login-button").textContent, "Alice");
    assert.deepEqual(harness.ui.alerts, []);
    assert.equal(harness.ui.dialog, null);
});

test("repeated auth gate triggers reuse one overlay", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    users.logout();
    resetUiNotifications(harness);
    assert.equal(authOverlays(harness.document).length, 1);
    users._test.applyAuthGateIfNeeded("Log in again.");
    harness.ui.fileLoaded({});
    harness.ui.editor.setGraphXml(harness.document.createElement("mxGraphModel"));
    assert.equal(authOverlays(harness.document).length, 1);
    assert.match(harness.document.querySelector(".trellis-users-auth-overlay").textContent, /Log in to open this diagram\./);
});

test("logged-out enabled diagrams show an opaque auth gate until login succeeds", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    users.logout();
    assert.ok(harness.document.querySelector(".trellis-users-auth-overlay"));
    assert.equal(harness.graph.enabled, false);
    assert.equal(users.login("Alice", "bad").ok, false);
    assert.ok(harness.document.querySelector(".trellis-users-auth-overlay"));
    assert.equal(users.login("Alice", "1234").ok, true);
    assert.equal(harness.document.querySelector(".trellis-users-auth-overlay"), null);
    assert.equal(harness.graph.enabled, true);
});

test("remembered login restores on file load and logout forgets it", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    const alice = users.getCurrentUser();
    assert.equal(users.rememberLogin(alice.id, true).ok, true);
    harness.ui.fileLoaded({});
    assert.equal(users.isLoggedIn(), true);
    assert.equal(users.getCurrentUser().id, alice.id);
    users.logout();
    const key = users._test.getDiagramLoginKey(false);
    assert.equal(harness.context.window.localStorage.getItem("trellis_users_remembered_login_v1:" + key), null);
    assert.ok(harness.document.querySelector(".trellis-users-auth-overlay"));
});

test("remembered login is ignored when the stored user is disabled", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    const bob = users.createUser("Bob", "5678", false).user;
    assert.equal(users.rememberLogin(bob.id, true).ok, true);
    users.setUserDisabled(bob.id, true);
    harness.ui.fileLoaded({});
    assert.equal(users.isLoggedIn(), false);
    assert.ok(harness.document.querySelector(".trellis-users-auth-overlay"));
});

test("logged-in toolbar button toggles a user panel below the button", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    const button = harness.document.querySelector(".trellis-users-login-button");
    assert.equal(button.textContent, "Alice");
    button.click();
    assert.equal(harness.document.querySelector(".trellis-users-account-menu"), null);
    const panel = harness.document.body.querySelector("div[style*='width: 400px'], div[style*='width:400px']");
    assert.ok(panel);
    assert.equal(panel.parentNode, harness.document.body);
    assert.equal(panel.style.position, "fixed");
    assert.equal(panel.style.zIndex, "2000000000");
    assert.equal(panel.style.top, "38px");
    assert.equal(panel.style.left, "510px");
    assert.ok(buttonByText(harness.document, "Close"));
    button.click();
    assert.equal(panel.style.display, "none");
    button.click();
    assert.notEqual(panel.style.display, "none");
    buttonByText(harness.document, "Close").click();
    assert.equal(panel.style.display, "none");
    button.click();
    buttonByText(harness.document, "Logout").click();
    assert.equal(users.isLoggedIn(), false);
    assert.equal(harness.document.querySelector(".trellis-users-account-menu"), null);
    assert.ok(harness.document.querySelector(".trellis-users-auth-overlay"));
});

test("admin roster management supports PIN reset disable reactivate and last-admin guards", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    const bob = users.createUser("Bob", "5678", false).user;
    assert.equal(users.resetUserPin(bob.id, "9999").ok, true);
    users.logout();
    assert.equal(users.login("Bob", "5678").ok, false);
    assert.equal(users.login("Bob", "9999").ok, true);
    assert.equal(users.setUserAdmin(bob.id, true).ok, false);
    users.logout();
    users.login("Alice", "1234");
    assert.equal(users.setUserAdmin(bob.id, true).ok, true);
    const alice = users.getCurrentUser();
    assert.equal(users.setUserDisabled(alice.id, true).ok, true);
    assert.equal(users.isLoggedIn(), false);
    users.login("Bob", "9999");
    assert.equal(users.setUserAdmin(bob.id, false).ok, false);
    assert.equal(users.setUserDisabled(bob.id, true).ok, false);
    assert.equal(users.setUserDisabled(alice.id, false).ok, true);
});

test("admin roster PIN reset uses an inline form without native prompt", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    users.createUser("Bob", "5678", false);
    harness.context.window.prompt = function () { throw new Error("prompt() is not supported"); };
    harness.actions.trellisUsers.funct();
    const firstPinButtons = Array.from(harness.document.querySelectorAll("button")).filter(button => button.textContent === "PIN");
    assert.equal(firstPinButtons.length, 2);
    assert.doesNotThrow(() => firstPinButtons[1].click());
    assert.ok(inputByPlaceholder(harness.document, "New PIN"));
    buttonByText(harness.document, "Cancel").click();
    assert.equal(inputByPlaceholder(harness.document, "New PIN"), undefined);
    const secondPinButtons = Array.from(harness.document.querySelectorAll("button")).filter(button => button.textContent === "PIN");
    assert.doesNotThrow(() => secondPinButtons[1].click());
    inputByPlaceholder(harness.document, "New PIN").value = "9999";
    buttonByText(harness.document, "Save").click();
    assert.equal(inputByPlaceholder(harness.document, "New PIN"), undefined);
    users.logout();
    assert.equal(users.login("Bob", "5678").ok, false);
    assert.equal(users.login("Bob", "9999").ok, true);
});

test("admin panel groups networked local and pending users", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const bobInvite = users.createPendingInvite({ email: "bob@example.com", scopeCellIds: [harness.module.id] });
    assert.equal(bobInvite.ok, true);
    users.logout();
    assert.equal(users.acceptInvite({ email: "bob@example.com", code: bobInvite.code, name: "Bob", pin: "5678" }).ok, true);
    users.logout();
    assert.equal(users.login("Alice", "1234").ok, true);
    assert.equal(users.createPendingInvite({ email: "carol@example.com", scopeCellIds: [harness.module.id] }).ok, true);
    harness.actions.trellisUsers.funct();
    const networked = userGroupByTitle(harness.document, "Networked users");
    const local = userGroupByTitle(harness.document, "Local users");
    assert.ok(networked);
    assert.ok(local);
    assert.match(networked.textContent, /Bob/);
    assert.doesNotMatch(networked.textContent, /Alice/);
    assert.match(local.textContent, /Alice/);
    assert.doesNotMatch(local.textContent, /Bob/);
    assert.match(harness.document.body.textContent, /Pending invites/);
    assert.match(harness.document.body.textContent, /carol@example\.com/);
    local.querySelector("input[placeholder='Local user']").value = "Dana";
    local.querySelector("input[placeholder='PIN']").value = "2468";
    buttonByText(harness.document, "Add local user").click();
    assert.ok(users.listUsers().find(user => user.name === "Dana" && !user.email));
});

test("people access panel title and filters search roster invites and access rows by name or email", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const bobInvite = users.createPendingInvite({ email: "bob@example.com", scopeCellIds: [harness.module.id] });
    users.logout();
    const accepted = users.acceptInvite({ email: "bob@example.com", code: bobInvite.code, name: "Bob", pin: "5678" });
    assert.equal(accepted.ok, true);
    users.logout();
    assert.equal(users.login("Alice", "1234").ok, true);
    const dana = users.createUser("Dana", "2468", false).user;
    assert.equal(users.setScopeGrant(harness.module, { userId: accepted.user.id, preset: "visitor" }).ok, true);
    assert.equal(users.setScopeGrant(harness.module, { userId: dana.id, preset: "visitor" }).ok, true);
    assert.equal(users.createPendingInvite({ email: "carol@example.com", scopeCellIds: [harness.module.id] }).ok, true);
    harness.graph.setSelectionCell(harness.module);
    harness.actions.trellisUsers.funct();
    assert.match(harness.document.body.textContent, /People & Access/);
    assert.match(harness.document.body.textContent, /Module: Module/);
    assert.match(harness.document.body.textContent, /Bob/);
    assert.match(harness.document.body.textContent, /Dana/);
    const search = inputByPlaceholder(harness.document, "Search name or email");
    search.value = "bob@example";
    search.dispatchEvent(new harness.context.window.Event("input", { bubbles: true }));
    assert.match(userGroupByTitle(harness.document, "Networked users").textContent, /Bob/);
    assert.doesNotMatch(harness.document.body.textContent, /carol@example\.com/);
    assert.doesNotMatch(harness.document.body.textContent, /Dana\s*Visitor/);
    assert.match(harness.document.body.textContent, /Granted/);
    assert.match(harness.document.body.textContent, /1 granted user is hidden by the current filter/);
    const filter = selectByOptionText(harness.document, "Networked");
    search.value = "";
    search.dispatchEvent(new harness.context.window.Event("input", { bubbles: true }));
    filter.value = "networked";
    filter.dispatchEvent(new harness.context.window.Event("change", { bubbles: true }));
    assert.match(harness.document.body.textContent, /Pending invites/);
    assert.match(harness.document.body.textContent, /carol@example\.com/);
    assert.equal(userGroupByTitle(harness.document, "Local users"), undefined);
    filter.value = "local";
    filter.dispatchEvent(new harness.context.window.Event("change", { bubbles: true }));
    assert.equal(userGroupByTitle(harness.document, "Networked users"), undefined);
    assert.equal(harness.document.body.textContent.includes("Pending invites"), false);
});

test("selected access summarizes scope labels and hides editor for multiple selections", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const bed = appendChild(harness.module, makeXmlCell(harness.document, "bed", { garden_bed: "1", label: "North Bed" }));
    const board = appendChild(harness.module, makeXmlCell(harness.document, "board", { board_key: "KANBAN_BOARD", label: "Harvest Board" }));
    const bob = users.createUser("Bob", "5678", false).user;
    assert.equal(users.setScopeGrant(board, { userId: bob.id, preset: "gardener" }).ok, true);
    harness.graph.setSelectionCell(bed);
    harness.actions.trellisUsers.funct();
    assert.match(harness.document.body.textContent, /Garden Bed: North Bed/);
    harness.graph.setSelectionCell(board);
    users._test.refreshPanel();
    assert.match(harness.document.body.textContent, /Task Board: Harvest Board/);
    assert.match(harness.document.body.textContent, /Granted/);
    harness.graph.setSelectionCells([harness.module, bed, board]);
    users._test.refreshPanel();
    assert.match(harness.document.body.textContent, /Module: Module/);
    assert.match(harness.document.body.textContent, /Garden Bed: North Bed/);
    assert.match(harness.document.body.textContent, /Task Board: Harvest Board/);
    assert.match(harness.document.body.textContent, /Access editor is hidden while multiple scopes are selected/);
    assert.doesNotMatch(harness.document.body.textContent, /Your effective access/);
});

test("visitor grant keeps regular users view-only", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const bob = users.createUser("Bob", "5678", false).user;
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "visitor" }).ok, true);
    users.logout();
    assert.equal(users.login("Bob", "5678").ok, true);
    assert.equal(users.canEditCell(harness.card), false);
    assert.equal(users.canAddCell(harness.module), false);
    assert.equal(users.canDeleteCell(harness.card), false);
    assert.equal(users.canManageAccess(harness.module), false);
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxCellAttributeChange" }, cell: harness.card, attribute: "label" }), false);
    const planting = appendChild(harness.module, makeXmlCell(harness.document, "viewer-planting", { tiler_group: "1" }));
    let undone = false;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: planting, parent: harness.module }], undo() { undone = true; } });
    assert.equal(undone, true);
    const bed = appendChild(harness.module, makeXmlCell(harness.document, "viewer-bed", { garden_bed: "1" }));
    undone = false;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: bed, parent: harness.module }], undo() { undone = true; } });
    assert.equal(undone, true);
    bed.parent = null;
    undone = false;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: bed, previous: harness.module }], undo() { undone = true; } });
    assert.equal(undone, true);
});

test("access request from inaccessible child resolves to nearest shareable scope", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const bed = appendChild(harness.module, makeXmlCell(harness.document, "request-bed", { garden_bed: "1", label: "North Bed" }));
    const child = appendChild(bed, makeXmlCell(harness.document, "request-child", { label: "Locked Planting" }));
    const bob = users.createUser("Bob", "5678", false).user;
    users.logout();
    assert.equal(users.login("Bob", "5678").ok, true);
    assert.equal(users.canEditCell(child), false);
    const result = users.requestAccess(child, { requestedPreset: "gardener", note: "Need to tend this bed." });
    assert.equal(result.ok, true);
    assert.equal(result.request.scopeCellId, bed.id);
    assert.equal(result.request.scopeType, "garden bed");
    assert.equal(result.request.requesterUserId, bob.id);
    assert.equal(result.request.requestedPreset, "gardener");
    assert.equal(users._test.readStore().accessRequests.length, 1);
});

test("duplicate pending access request updates level note and timestamp", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const bob = users.createUser("Bob", "5678", false).user;
    users.logout();
    users.login("Bob", "5678");
    users.requestAccess(harness.card, { requestedPreset: "visitor", note: "First ask" });
    const first = users._test.readStore().accessRequests[0];
    users.requestAccess(harness.card, { requestedPreset: "coordinator", note: "Updated ask" });
    const store = users._test.readStore();
    assert.equal(store.accessRequests.length, 1);
    assert.equal(store.accessRequests[0].id, first.id);
    assert.equal(store.accessRequests[0].requesterUserId, bob.id);
    assert.equal(store.accessRequests[0].requestedPreset, "coordinator");
    assert.equal(store.accessRequests[0].note, "Updated ask");
    assert.ok(store.accessRequests[0].updatedAt >= first.updatedAt);
});

test("denied access request persists with note and can be reopened", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    users.createUser("Bob", "5678", false);
    users.logout();
    users.login("Bob", "5678");
    const requested = users.requestAccess(harness.card, { requestedPreset: "gardener", note: "Need access" }).request;
    users.logout();
    users.login("Alice", "1234");
    const denied = users.denyAccessRequest(requested.id, "Not this week.");
    assert.equal(denied.ok, true);
    users.logout();
    users.login("Bob", "5678");
    assert.equal(users.getAccessRequestForCurrentUser(harness.card).status, "denied");
    assert.equal(users.getAccessRequestForCurrentUser(harness.card).decisionNote, "Not this week.");
    const reopened = users.requestAccess(harness.card, { requestedPreset: "coordinator", note: "Updated reason" });
    assert.equal(reopened.ok, true);
    assert.equal(reopened.request.status, "pending");
    assert.equal(reopened.request.decisionNote, "");
    assert.equal(reopened.request.requestedPreset, "coordinator");
});

test("approving access request creates grant and removes request", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const bob = users.createUser("Bob", "5678", false).user;
    users.logout();
    users.login("Bob", "5678");
    const request = users.requestAccess(harness.card, { requestedPreset: "gardener" }).request;
    users.logout();
    users.login("Alice", "1234");
    const approved = users.approveAccessRequest(request.id, { preset: "gardener" });
    assert.equal(approved.ok, true);
    assert.equal(users._test.readStore().accessRequests.length, 0);
    assert.deepEqual(JSON.parse(harness.module.getAttribute(users.attrs.accessGrants)), [{ userId: bob.id, preset: "gardener", capabilities: ["create_plantings", "edit_task_details", "manage_own_plantings", "move_tasks"] }]);
});

test("approval creates unread requester message and supports read and dismiss lifecycle", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    users.createUser("Bob", "5678", false);
    users.logout();
    users.login("Bob", "5678");
    const request = users.requestAccess(harness.card, { requestedPreset: "gardener" }).request;
    users.logout();
    users.login("Alice", "1234");
    const approved = users.approveAccessRequest(request.id, { preset: "gardener", decisionNote: "Welcome to the bed." });
    assert.equal(approved.ok, true);
    let store = users._test.readStore();
    assert.equal(store.accessRequests.length, 0);
    assert.equal(store.accessMessages.length, 1);
    assert.equal(store.accessMessages[0].decision, "approved");
    assert.equal(store.accessMessages[0].note, "Welcome to the bed.");
    users.logout();
    users.login("Bob", "5678");
    let messages = users.listAccessMessages({ scopeCell: harness.module });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].decision, "approved");
    assert.equal(messages[0].reviewerName, "Alice");
    assert.equal(messages[0].unread, true);
    assert.equal(users.unreadAccessMessageCount({ scopeCell: harness.module }), 1);
    assert.equal(users.markAccessMessageRead(messages[0].id).ok, true);
    messages = users.listAccessMessages({ scopeCell: harness.module });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].unread, false);
    assert.equal(users.unreadAccessMessageCount({ scopeCell: harness.module }), 0);
    assert.equal(users.dismissAccessMessage(messages[0].id).ok, true);
    assert.equal(users.listAccessMessages({ scopeCell: harness.module }).length, 0);
    store = users._test.readStore();
    assert.equal(store.accessMessages.length, 1);
    assert.ok(store.accessMessages[0].dismissedAt > 0);
});

test("denial creates requester message while denied request remains reopenable", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    users.createUser("Bob", "5678", false);
    users.logout();
    users.login("Bob", "5678");
    const request = users.requestAccess(harness.card, { requestedPreset: "coordinator", note: "Need full access." }).request;
    users.logout();
    users.login("Alice", "1234");
    const denied = users.denyAccessRequest(request.id, "Not this season.");
    assert.equal(denied.ok, true);
    assert.equal(users._test.readStore().accessRequests.length, 1);
    users.logout();
    users.login("Bob", "5678");
    const messages = users.listAccessMessages({ scopeCell: harness.module });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].decision, "denied");
    assert.equal(messages[0].preset, "coordinator");
    assert.equal(messages[0].note, "Not this season.");
    assert.equal(users.getAccessRequestForCurrentUser(harness.card).status, "denied");
});

test("already-granted access request cleanup still creates requester message", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const bob = users.createUser("Bob", "5678", false).user;
    users.logout();
    users.login("Bob", "5678");
    const request = users.requestAccess(harness.card, { requestedPreset: "gardener" }).request;
    users.logout();
    users.login("Alice", "1234");
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "gardener" }).ok, true);
    const approved = users.approveAccessRequest(request.id, { preset: "gardener", decisionNote: "Already done." });
    assert.equal(approved.ok, true);
    assert.equal(approved.alreadyGranted, true);
    const store = users._test.readStore();
    assert.equal(store.accessRequests.length, 0);
    assert.equal(store.accessMessages.length, 1);
    assert.equal(store.accessMessages[0].decision, "approved");
    assert.equal(store.accessMessages[0].note, "Already done.");
});

test("selected access panel shows requester approval response without no-access contradiction", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    users.createUser("Bob", "5678", false);
    users.logout();
    users.login("Bob", "5678");
    const request = users.requestAccess(harness.card, { requestedPreset: "gardener" }).request;
    users.logout();
    users.login("Alice", "1234");
    assert.equal(users.approveAccessRequest(request.id, { preset: "gardener", decisionNote: "Welcome to the bed." }).ok, true);
    users.logout();
    assert.equal(users.login("Bob", "5678").ok, true);
    harness.graph.setSelectionCell(harness.card);
    harness.actions.trellisUsers.funct();
    assert.match(harness.document.body.textContent, /Your effective access: Gardener/);
    assert.match(harness.document.body.textContent, /Access approved \(Gardener\)\. Welcome to the bed\./);
    assert.match(harness.document.body.textContent, /You have Gardener access here, but this selected cell is not directly editable\./);
    assert.match(harness.document.body.textContent, /Request More Access/);
    assert.doesNotMatch(harness.document.body.textContent, /You do not have access to this cell/);
});

test("deleted scope response remains visible as unavailable in requester messages", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const bed = appendChild(harness.module, makeXmlCell(harness.document, "message-deleted-bed", { garden_bed: "1", label: "Old Bed" }));
    const child = appendChild(bed, makeXmlCell(harness.document, "message-deleted-child", { label: "Child" }));
    users.createUser("Bob", "5678", false);
    users.logout();
    users.login("Bob", "5678");
    const request = users.requestAccess(child, { requestedPreset: "gardener" }).request;
    users.logout();
    users.login("Alice", "1234");
    assert.equal(users.denyAccessRequest(request.id, "Bed is gone.").ok, true);
    bed.parent = null;
    users.logout();
    users.login("Bob", "5678");
    const messages = users.listAccessMessages({ scopeCell: harness.module });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].scopeLabel, "Old Bed");
    assert.equal(messages[0].scopeMissing, true);
});

test("requester access messages are private to the requester", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    users.createUser("Bob", "5678", false);
    users.createUser("Cara", "9999", false);
    users.logout();
    users.login("Bob", "5678");
    const bobRequest = users.requestAccess(harness.card, { requestedPreset: "visitor" }).request;
    users.logout();
    users.login("Cara", "9999");
    const caraRequest = users.requestAccess(harness.card, { requestedPreset: "gardener" }).request;
    users.logout();
    users.login("Alice", "1234");
    assert.equal(users.denyAccessRequest(bobRequest.id, "No.").ok, true);
    assert.equal(users.denyAccessRequest(caraRequest.id, "Later.").ok, true);
    users.logout();
    users.login("Bob", "5678");
    const bobMessages = users.listAccessMessages({ scopeCell: harness.module });
    assert.equal(bobMessages.length, 1);
    assert.equal(bobMessages[0].preset, "visitor");
    users.logout();
    users.login("Cara", "9999");
    const caraMessages = users.listAccessMessages({ scopeCell: harness.module });
    assert.equal(caraMessages.length, 1);
    assert.equal(caraMessages[0].preset, "gardener");
});

test("messages dialog renders access request and response sections with response actions", () => {
    const text = fs.readFileSync(pluginPath, "utf8");
    assert.match(text, /requestTitle\.textContent = "Access requests";/);
    assert.match(text, /responseTitle\.textContent = "Responses";/);
    assert.match(text, /approveAccessRequest\(request\.id, \{ preset: preset\.value, decisionNote: decisionNote\.value \}\)/);
    assert.match(text, /const result = markAccessMessageRead\(message\.id\);/);
    assert.match(text, /const result = dismissAccessMessage\(message\.id\);/);
});

test("incoming access request count is visible only to owner or admin", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const owner = users.createUser("Olive", "1111", false).user;
    users.setOwner(harness.module, owner.id);
    users.createUser("Bob", "5678", false);
    users.createUser("Cara", "9999", false);
    users.logout();
    users.login("Bob", "5678");
    const request = users.requestAccess(harness.card, { requestedPreset: "gardener" });
    assert.equal(request.ok, true);
    assert.equal(users.incomingAccessRequestCount({ scopeCell: harness.module }), 0);
    users.logout();
    users.login("Cara", "9999");
    assert.equal(users.incomingAccessRequestCount({ scopeCell: harness.module }), 0);
    users.logout();
    users.login("Olive", "1111");
    assert.equal(users.incomingAccessRequestCount({ scopeCell: harness.module }), 1);
    users.logout();
    users.login("Alice", "1234");
    assert.equal(users.incomingAccessRequestCount({ scopeCell: harness.module }), 1);
});

test("disabled requester and deleted scope access requests cannot be approved", () => {
    const disabledHarness = loadUsersPlugin();
    const disabledUsers = disabledHarness.context.window.Trellis.users;
    disabledUsers.enableUsers("Alice", "1234");
    disabledHarness.module.style = "module=1";
    disabledUsers.stampCreatedOwner(disabledHarness.module);
    const bob = disabledUsers.createUser("Bob", "5678", false).user;
    disabledUsers.logout();
    disabledUsers.login("Bob", "5678");
    const disabledRequest = disabledUsers.requestAccess(disabledHarness.card, { requestedPreset: "gardener" }).request;
    disabledUsers.logout();
    disabledUsers.login("Alice", "1234");
    assert.equal(disabledUsers.setUserDisabled(bob.id, true).ok, true);
    const disabledApproval = disabledUsers.approveAccessRequest(disabledRequest.id, { preset: "gardener" });
    assert.equal(disabledApproval.ok, false);
    assert.match(disabledApproval.reason, /disabled|unavailable/);

    const deletedHarness = loadUsersPlugin();
    const deletedUsers = deletedHarness.context.window.Trellis.users;
    deletedUsers.enableUsers("Alice", "1234");
    deletedHarness.module.style = "module=1";
    deletedUsers.stampCreatedOwner(deletedHarness.module);
    const bed = appendChild(deletedHarness.module, makeXmlCell(deletedHarness.document, "deleted-request-bed", { garden_bed: "1" }));
    const child = appendChild(bed, makeXmlCell(deletedHarness.document, "deleted-request-child", { label: "Child" }));
    deletedUsers.createUser("Bob", "5678", false);
    deletedUsers.logout();
    deletedUsers.login("Bob", "5678");
    const deletedRequest = deletedUsers.requestAccess(child, { requestedPreset: "gardener" }).request;
    deletedUsers.logout();
    deletedUsers.login("Alice", "1234");
    bed.parent = null;
    const deletedApproval = deletedUsers.approveAccessRequest(deletedRequest.id, { preset: "gardener" });
    assert.equal(deletedApproval.ok, false);
    assert.match(deletedApproval.reason, /no longer available/);
});

test("selected access panel shows request access action and requester status", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    users.createUser("Bob", "5678", false);
    users.logout();
    users.login("Bob", "5678");
    harness.graph.setSelectionCell(harness.card);
    harness.actions.trellisUsers.funct();
    assert.ok(harness.document.querySelector(".trellis-users-request-access-button"));
    users.requestAccess(harness.card, { requestedPreset: "gardener" });
    users._test.refreshPanel();
    assert.match(harness.document.querySelector(".trellis-users-access-request-status").textContent, /pending/i);
});

test("permission diagnostics stay quiet unless explicitly enabled", () => {
    const calls = [];
    const fakeConsole = { groupCollapsed() { calls.push("group"); }, log() { calls.push("log"); }, table() { calls.push("table"); }, groupEnd() { calls.push("end"); } };
    const harness = loadUsersPlugin({ console: fakeConsole });
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    users.stampCreatedOwner(harness.module);
    users.createUser("Bob", "5678", false);
    users.logout();
    users.login("Bob", "5678");
    harness.model.fireChange({ changes: [{ constructor: { name: "mxGeometryChange" }, cell: harness.card }], undo() {} });
    assert.equal(calls.length, 0);
});

test("permission diagnostics do not throw when console is unavailable", () => {
    const harness = loadUsersPlugin({ console: undefined });
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    users.stampCreatedOwner(harness.module);
    users.createUser("Bob", "5678", false);
    users.logout();
    users.login("Bob", "5678");
    harness.context.window.localStorage.setItem("trellis_users_debug", "1");
    assert.doesNotThrow(function () {
        harness.model.fireChange({ changes: [{ constructor: { name: "mxGeometryChange" }, cell: harness.card }], undo() {} });
    });
});

test("trellis debug surface reports users status and toggles debug flags", () => {
    const calls = [];
    const fakeConsole = { groupCollapsed(label) { calls.push(["group", label]); }, log(value) { calls.push(["log", value]); }, groupEnd() { calls.push(["end"]); } };
    const harness = loadUsersPlugin({ console: fakeConsole });
    const debug = harness.context.window.Trellis.debug;
    assert.equal(typeof debug.usersStatus, "function");
    assert.equal(typeof debug.enable, "function");
    assert.equal(typeof debug.disable, "function");
    assert.equal(typeof debug.probe, "function");
    assert.equal(debug.usersStatus().loaded, true);
    assert.equal(debug.usersStatus().storage.trellis_users_debug, null);
    const probe = debug.probe();
    assert.equal(probe.usersPluginLoaded, true);
    assert.equal(probe.bedFitPluginLoaded, false);
    assert.ok(calls.some(call => call[0] === "group" && call[1] === "[TrellisDebug] probe"));
    const enabled = debug.enable();
    assert.equal(harness.context.window.localStorage.getItem("trellis_users_debug"), "1");
    assert.equal(harness.context.window.localStorage.getItem("trellis_bed_fit_debug"), "1");
    assert.equal(enabled.windowFlags.users, true);
    assert.equal(enabled.windowFlags.bedFit, true);
    const disabled = debug.disable();
    assert.equal(harness.context.window.localStorage.getItem("trellis_users_debug"), null);
    assert.equal(harness.context.window.localStorage.getItem("trellis_bed_fit_debug"), null);
    assert.equal(disabled.windowFlags.users, false);
    assert.equal(disabled.windowFlags.bedFit, false);
});

test("admin remains allowed for bed-fit relevant child geometry and style changes", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    const planting = appendChild(harness.module, makeXmlCell(harness.document, "admin-planting", { tiler_group: "1" }));
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxChildChange" }, child: planting, parent: harness.module }), true);
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxGeometryChange" }, cell: planting }), true);
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxStyleChange" }, cell: planting }), true);
});

test("admin planting creation allows generated plant tile churn in the same edit", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    const planting = appendChild(harness.module, makeXmlCell(harness.document, "admin-planting-fit", { tiler_group: "1" }));
    const generatedTile = makeXmlCell(harness.document, "generated-tile", { plant_tiler: "1", auto: "1", tile_r: "0", tile_c: "0" });
    let undone = false;
    harness.model.fireChange({
        changes: [
            { constructor: { name: "mxChildChange" }, child: planting, parent: harness.module },
            { constructor: { name: "mxChildChange" }, child: generatedTile }
        ],
        undo() { undone = true; }
    });
    assert.equal(undone, false);
});

test("gardener grant creates and manages only owned planting groups", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    assert.deepEqual(Array.from(users._test.normalizeCapabilities(null, "gardener")), ["create_plantings", "edit_task_details", "manage_own_plantings", "move_tasks"]);
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const bed = appendChild(harness.module, makeXmlCell(harness.document, "bed", { garden_bed: "1" }));
    const board = appendChild(harness.module, makeXmlCell(harness.document, "grower-board", { board_key: "KANBAN_BOARD" }));
    const lane = appendChild(board, makeXmlCell(harness.document, "grower-lane", { lane_key: "TODO" }));
    const taskCard = appendChild(lane, makeXmlCell(harness.document, "gardener-task", { kanban_card: "1", title: "Water" }));
    const alicePlanting = appendChild(bed, makeXmlCell(harness.document, "alice-planting", { tiler_group: "1", [users.attrs.owner]: users.getCurrentUser().id }));
    const bob = users.createUser("Bob", "5678", false).user;
    const bobLinkedPlanting = appendChild(bed, makeXmlCell(harness.document, "bob-linked-planting", { tiler_group: "1", [users.attrs.owner]: bob.id }));
    linkCells(bobLinkedPlanting, taskCard);
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "gardener" }).ok, true);
    users.logout();
    users.login("Bob", "5678");
    assert.equal(users.canCreatePlanting(bed), true);
    assert.equal(users.canMoveTask(taskCard), true);
    assert.equal(users.canEditTaskDetails(taskCard), true);
    assert.equal(users.canEditCell(bed), false);
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxCellAttributeChange" }, cell: bed, attribute: "garden_bed" }), false);
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxCellAttributeChange" }, cell: harness.module, attribute: "label" }), false);
    assert.equal(users.canManagePlanting(alicePlanting), false);
    const bobPlanting = appendChild(bed, makeXmlCell(harness.document, "bob-planting", { tiler_group: "1" }));
    let undone = false;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: bobPlanting, parent: bed }], undo() { undone = true; } });
    assert.equal(undone, false);
    assert.equal(bobPlanting.getAttribute(users.attrs.owner), bob.id);
    assert.equal(users.canManagePlanting(bobPlanting), true);
    assert.equal(users.canManageAccess(bobPlanting), false);
    assert.equal(users.setOwner(bed, bob.id).ok, false);
});

test("gardener planting creation allows initialization edits and generated plant tile churn", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const bob = users.createUser("Bob", "5678", false).user;
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "gardener" }).ok, true);
    users.logout();
    assert.equal(users.login("Bob", "5678").ok, true);
    const planting = appendChild(harness.module, makeXmlCell(harness.document, "bob-planting-fit", { tiler_group: "1" }));
    const previousValue = planting.value.cloneNode(true);
    planting.setAttribute("label", "?");
    const generatedTile = appendChild(planting, makeXmlCell(harness.document, "bob-generated-tile", { plant_tiler: "1", auto: "1", tile_r: "0", tile_c: "0" }));
    const previousTileValue = generatedTile.value.cloneNode(true);
    generatedTile.setAttribute("label", "?");
    let undone = false;
    harness.model.fireChange({
        changes: [
            { constructor: { name: "mxChildChange" }, child: planting, parent: harness.module },
            { constructor: { name: "mxValueChange" }, cell: planting, previous: previousValue, value: planting.value },
            { constructor: { name: "mxChildChange" }, child: generatedTile, parent: planting },
            { constructor: { name: "mxGeometryChange" }, cell: generatedTile },
            { constructor: { name: "mxValueChange" }, cell: generatedTile, previous: previousTileValue, value: generatedTile.value },
            { constructor: { name: "mxStyleChange" }, cell: generatedTile }
        ],
        undo() { undone = true; }
    });
    assert.equal(undone, false);
    assert.equal(planting.getAttribute(users.attrs.owner), bob.id);
});

test("gardener cannot create or delete garden beds in a granted module", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const bob = users.createUser("Bob", "5678", false).user;
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "gardener" }).ok, true);
    users.logout();
    assert.equal(users.login("Bob", "5678").ok, true);
    const createdBed = appendChild(harness.module, makeXmlCell(harness.document, "grower-created-bed", { garden_bed: "1" }));
    let undone = false;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: createdBed, parent: harness.module }], undo() { undone = true; } });
    assert.equal(undone, true);
    const existingBed = appendChild(harness.module, makeXmlCell(harness.document, "grower-existing-bed", { garden_bed: "1" }));
    existingBed.parent = null;
    undone = false;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: existingBed, previous: harness.module }], undo() { undone = true; } });
    assert.equal(undone, true);
});

test("generated plant tile churn still requires a valid planting context", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    const generatedTile = makeXmlCell(harness.document, "orphan-generated-tile", { plant_tiler: "1", auto: "1", tile_r: "0", tile_c: "0" });
    let undone = false;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: generatedTile }], undo() { undone = true; } });
    assert.equal(undone, true);
});

test("generated plant tile initialization rejects outside the created planting context", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const existingPlanting = appendChild(harness.module, makeXmlCell(harness.document, "existing-planting", { tiler_group: "1" }));
    const generatedTile = appendChild(existingPlanting, makeXmlCell(harness.document, "existing-generated-tile", { plant_tiler: "1", auto: "1", tile_r: "0", tile_c: "0" }));
    const bob = users.createUser("Bob", "5678", false).user;
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "gardener" }).ok, true);
    users.logout();
    assert.equal(users.login("Bob", "5678").ok, true);
    let undone = false;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxGeometryChange" }, cell: generatedTile }], undo() { undone = true; } });
    assert.equal(undone, true);
});

test("created planting context does not allow manual plant tile initialization", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const bob = users.createUser("Bob", "5678", false).user;
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "gardener" }).ok, true);
    users.logout();
    assert.equal(users.login("Bob", "5678").ok, true);
    const planting = appendChild(harness.module, makeXmlCell(harness.document, "manual-tile-planting", { tiler_group: "1" }));
    const manualTile = appendChild(planting, makeXmlCell(harness.document, "manual-child-tile", { plant_tiler: "1", auto: "0" }));
    let undone = false;
    harness.model.fireChange({
        changes: [
            { constructor: { name: "mxChildChange" }, child: planting, parent: harness.module },
            { constructor: { name: "mxChildChange" }, child: manualTile, parent: planting },
            { constructor: { name: "mxGeometryChange" }, cell: manualTile }
        ],
        undo() { undone = true; }
    });
    assert.equal(undone, true);
});

test("planting context does not allow ordinary or manual orphan child changes", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    const ordinary = makeXmlCell(harness.document, "ordinary-orphan", { label: "Ordinary" });
    const manualTile = makeXmlCell(harness.document, "manual-tile", { plant_tiler: "1", auto: "0" });
    let undone = false;
    const plantingA = appendChild(harness.module, makeXmlCell(harness.document, "admin-planting-ordinary", { tiler_group: "1" }));
    harness.model.fireChange({
        changes: [
            { constructor: { name: "mxChildChange" }, child: plantingA, parent: harness.module },
            { constructor: { name: "mxChildChange" }, child: ordinary }
        ],
        undo() { undone = true; }
    });
    assert.equal(undone, true);
    undone = false;
    const plantingB = appendChild(harness.module, makeXmlCell(harness.document, "admin-planting-manual", { tiler_group: "1" }));
    harness.model.fireChange({
        changes: [
            { constructor: { name: "mxChildChange" }, child: plantingB, parent: harness.module },
            { constructor: { name: "mxChildChange" }, child: manualTile }
        ],
        undo() { undone = true; }
    });
    assert.equal(undone, true);
});

test("owner can transfer ownership to an active user", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const bob = users.createUser("Bob", "5678", false).user;
    assert.equal(users.setOwner(harness.module, bob.id).ok, true);
    users.logout();
    users.login("Bob", "5678");
    assert.equal(users.canManageAccess(harness.module), true);
    assert.equal(users.canAddCell(harness.module), true);
});

test("regular granted users cannot add delete move reparent or change protected access attributes", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const bob = users.createUser("Bob", "5678", false).user;
    users.setAccess(harness.module, { open: false, userIds: [bob.id] });
    users.logout();
    users.login("Bob", "5678");

    let undone = false;
    const added = appendChild(harness.module, makeXmlCell(harness.document, "added", { label: "Added" }));
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: added, parent: harness.module }], undo() { undone = true; } });
    assert.equal(undone, true);

    undone = false;
    harness.card.parent = null;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: harness.card, previous: harness.module }], undo() { undone = true; } });
    assert.equal(undone, true);
    harness.card.parent = harness.module;

    undone = false;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxGeometryChange" }, cell: harness.card }], undo() { undone = true; } });
    assert.equal(undone, true);

    undone = false;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: harness.card, previous: harness.module, parent: harness.module }], undo() { undone = true; } });
    assert.equal(undone, true);

    undone = false;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxCellAttributeChange" }, cell: harness.module, attribute: users.attrs.owner }], undo() { undone = true; } });
    assert.equal(undone, true);
});

test("owner and admin can add delete and move within owned scopes", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    users.stampCreatedOwner(harness.module);
    let undone = false;
    const added = appendChild(harness.module, makeXmlCell(harness.document, "owner-added", { label: "Owner Added" }));
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: added, parent: harness.module }], undo() { undone = true; } });
    assert.equal(undone, false);

    undone = false;
    added.parent = null;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: added, previous: harness.module }], undo() { undone = true; } });
    assert.equal(undone, false);

    undone = false;
    harness.card.parent = harness.module;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: harness.card, previous: harness.module, parent: harness.module }], undo() { undone = true; } });
    assert.equal(undone, false);

    undone = false;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxGeometryChange" }, cell: harness.card }], undo() { undone = true; } });
    assert.equal(undone, false);
});

test("unowned modules are claimed on first allowed edit and only owner or admin can delete modules", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    const bob = users.createUser("Bob", "5678", false).user;
    users.logout();
    users.login("Bob", "5678");
    harness.module.style = "module=1";
    assert.equal(harness.module.getAttribute(users.attrs.owner), null);
    let undone = false;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxCellAttributeChange" }, cell: harness.module, key: "label" }], undo() { undone = true; } });
    assert.equal(undone, false);
    assert.equal(harness.module.getAttribute(users.attrs.owner), bob.id);
    assert.equal(users.canDeleteCell(harness.module), true);
    users.logout();
    users.login("Alice", "1234");
    assert.equal(users.canDeleteCell(harness.module), true);
    const carol = users.createUser("Carol", "9999", false).user;
    users.logout();
    users.login("Carol", "9999");
    assert.equal(users.canDeleteCell(harness.module), false);
    assert.ok(carol);
});

test("gardener grant allows only owned linked or created manual task edits", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const board = appendChild(harness.module, makeXmlCell(harness.document, "board", { board_key: "KANBAN_BOARD" }));
    const lane = appendChild(board, makeXmlCell(harness.document, "lane", { lane_key: "TODO" }));
    const bob = users.createUser("Bob", "5678", false).user;
    const bobPlanting = appendChild(harness.module, makeXmlCell(harness.document, "task-bob-planting", { tiler_group: "1", [users.attrs.owner]: bob.id }));
    const alicePlanting = appendChild(harness.module, makeXmlCell(harness.document, "task-alice-planting", { tiler_group: "1", [users.attrs.owner]: users.getCurrentUser().id }));
    const ownedLinked = appendChild(lane, makeXmlCell(harness.document, "owned-linked-task", { kanban_card: "1", title: "Water" }));
    const otherLinked = appendChild(lane, makeXmlCell(harness.document, "other-linked-task", { kanban_card: "1", title: "Weed" }));
    const createdManual = appendChild(lane, makeXmlCell(harness.document, "created-manual-task", { kanban_card: "1", title: "Manual", [users.attrs.createdBy]: bob.id }));
    const unownedManual = appendChild(lane, makeXmlCell(harness.document, "unowned-manual-task", { kanban_card: "1", title: "Manual" }));
    linkCells(bobPlanting, ownedLinked);
    linkCells(alicePlanting, otherLinked);
    assert.equal(users.setScopeGrant(board, { userId: bob.id, preset: "gardener" }).ok, true);
    users.logout(); users.login("Bob", "5678");
    assert.equal(users.canMoveTask(ownedLinked), true);
    assert.equal(users.canEditTaskDetails(ownedLinked), true);
    assert.equal(users.canMoveTask(otherLinked), false);
    assert.equal(users.canEditTaskDetails(otherLinked), false);
    assert.equal(users.canMoveTask(createdManual), true);
    assert.equal(users.canEditTaskDetails(createdManual), true);
    assert.equal(users.canMoveTask(unownedManual), false);
    assert.equal(users.canEditTaskDetails(unownedManual), false);
    assert.equal(users.canAddCell(board), false);
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxCellAttributeChange" }, cell: ownedLinked, attribute: "title" }), true);
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxCellAttributeChange" }, cell: otherLinked, attribute: "title" }), false);
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxCellAttributeChange" }, cell: createdManual, attribute: "title" }), true);
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxCellAttributeChange" }, cell: ownedLinked, attribute: "task_assignee_role_ids_json" }), false);
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxCellAttributeChange" }, cell: board, attribute: "task_view_mode" }), false);
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxCellAttributeChange" }, cell: lane, attribute: "lane_key" }), false);
});

test("coordinator grant can manage access but cannot transfer ownership", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const bob = users.createUser("Bob", "5678", false).user;
    const carol = users.createUser("Carol", "9999", false).user;
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "coordinator" }).ok, true);
    users.logout(); users.login("Bob", "5678");
    assert.equal(users.canManageAccess(harness.module), true);
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxCellAttributeChange" }, cell: harness.card, attribute: "label" }), true);
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxCellAttributeChange" }, cell: harness.module, attribute: users.attrs.owner }), false);
    assert.equal(users.setScopeGrant(harness.module, { userId: carol.id, preset: "visitor" }).ok, true);
    assert.equal(users.setOwner(harness.module, carol.id).ok, false);
});

test("coordinator preset manages all content and access", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    assert.deepEqual(Array.from(users._test.normalizeCapabilities(null, "coordinator")), [
        users.capabilities.createPlantings,
        users.capabilities.editTaskDetails,
        users.capabilities.manageAccess,
        users.capabilities.manageOwnPlantings,
        users.capabilities.manageScopeContent,
        users.capabilities.moveTasks
    ]);
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const board = appendChild(harness.module, makeXmlCell(harness.document, "coordinator-board", { board_key: "KANBAN_BOARD" }));
    const card = appendChild(board, makeXmlCell(harness.document, "coordinator-card", { kanban_card: "1", title: "Task" }));
    const bob = users.createUser("Bob", "5678", false).user;
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "coordinator" }).ok, true);
    users.logout();
    assert.equal(users.login("Bob", "5678").ok, true);
    assert.equal(users.canCreatePlanting(harness.module), true);
    const alicePlanting = appendChild(harness.module, makeXmlCell(harness.document, "coordinator-alice-planting", { tiler_group: "1", [users.attrs.owner]: users.listUsers().find(user => user.name === "Alice").id }));
    assert.equal(users.canManagePlanting(alicePlanting), true);
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxGeometryChange" }, cell: alicePlanting }), true);
    assert.equal(users.canMoveTask(card), true);
    assert.equal(users.canEditTaskDetails(card), true);
    assert.equal(users.canManageAccess(harness.module), true);
});

test("access editor exposes presets without granular capability checkboxes", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const bob = users.createUser("Bob", "5678", false).user;
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "visitor" }).ok, true);
    harness.graph.setSelectionCell(harness.module);
    harness.actions.trellisUsers.funct();
    const select = selectByOptionText(harness.document, "Gardener");
    assert.ok(select);
    assert.deepEqual(Array.from(select.options).map(option => option.textContent), ["Visitor", "Gardener", "Coordinator"]);
    assert.equal(checkboxByLabel(harness.document, "Manage scope content"), null);
    assert.equal(checkboxByLabel(harness.document, "Create plantings"), null);
    assert.equal(checkboxByLabel(harness.document, "Manage access"), null);
});

test("child access view shows inherited coordinator without writing grants", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const child = appendChild(harness.module, makeXmlCell(harness.document, "inherited-child", { label: "Child Cell" }));
    const bob = users.createUser("Bob", "5678", false).user;
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "coordinator" }).ok, true);
    const parentGrantsBefore = harness.module.getAttribute(users.attrs.accessGrants);
    const writesBefore = harness.model.setValueCalls || 0;
    users.logout();
    assert.equal(users.login("Bob", "5678").ok, true);
    harness.graph.setSelectionCell(child);
    harness.actions.trellisUsers.funct();
    assert.equal(accessRowByUserId(harness.document, bob.id), null);
    assert.match(harness.document.body.textContent, /Coordinator in Module/);
    assert.match(harness.document.body.textContent, /Your effective access: Coordinator/);
    assert.match(harness.document.body.textContent, /Select a module, garden bed, or task board to manage grants/);
    assert.doesNotMatch(harness.document.body.textContent, /You do not have access to this cell/);
    assert.equal(child.getAttribute(users.attrs.accessGrants), null);
    assert.equal(harness.module.getAttribute(users.attrs.accessGrants), parentGrantsBefore);
    assert.equal(harness.model.setValueCalls || 0, writesBefore);
});

test("ordinary child cells cannot receive direct access grants", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const child = appendChild(harness.module, makeXmlCell(harness.document, "direct-child-denied", { label: "Child Cell" }));
    const bob = users.createUser("Bob", "5678", false).user;
    assert.equal(users.setScopeGrant(child, { userId: bob.id, preset: "coordinator" }).ok, false);
    assert.equal(users._test.changeAllowed({ constructor: { name: "mxCellAttributeChange" }, cell: child, attribute: users.attrs.accessGrants }), false);
    assert.equal(child.getAttribute(users.attrs.accessGrants), null);
});

test("direct named child grants remain distinguishable from inherited parent access", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const bed = appendChild(harness.module, makeXmlCell(harness.document, "direct-and-inherited-bed", { garden_bed: "1", label: "North Bed" }));
    const bob = users.createUser("Bob", "5678", false).user;
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "coordinator" }).ok, true);
    assert.equal(users.setScopeGrant(bed, { userId: bob.id, preset: "visitor" }).ok, true);
    const parentGrantsBefore = harness.module.getAttribute(users.attrs.accessGrants);
    harness.graph.setSelectionCell(bed);
    harness.actions.trellisUsers.funct();
    const row = accessRowByUserId(harness.document, bob.id);
    assert.ok(row);
    assert.match(row.textContent, /Granted/);
    assert.match(row.textContent, /Coordinator in Module/);
    assert.equal(harness.module.getAttribute(users.attrs.accessGrants), parentGrantsBefore);
});

test("coordinator can create and delete garden beds in a granted module", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const bob = users.createUser("Bob", "5678", false).user;
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "coordinator" }).ok, true);
    users.logout();
    assert.equal(users.login("Bob", "5678").ok, true);
    const createdBed = appendChild(harness.module, makeXmlCell(harness.document, "coordinator-created-bed", { garden_bed: "1" }));
    let undone = false;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: createdBed, parent: harness.module }], undo() { undone = true; } });
    assert.equal(undone, false);
    const existingBed = appendChild(harness.module, makeXmlCell(harness.document, "coordinator-existing-bed", { garden_bed: "1" }));
    existingBed.parent = null;
    undone = false;
    harness.model.fireChange({ changes: [{ constructor: { name: "mxChildChange" }, child: existingBed, previous: harness.module }], undo() { undone = true; } });
    assert.equal(undone, false);
});

test("linked role cards do not bypass gardener task ownership rules", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    users.stampCreatedOwner(harness.module);
    const board = appendChild(harness.module, makeXmlCell(harness.document, "board", { board_key: "KANBAN_BOARD", linkedTo: "role-bob" }));
    const lane = appendChild(board, makeXmlCell(harness.document, "lane", { lane_key: "TODO" }));
    const card = appendChild(lane, makeXmlCell(harness.document, "task", { kanban_card: "1", title: "Water" }));
    const role = appendChild(harness.module, new TestCell("role-bob", makeXmlCell(harness.document, "role-value", { label: "Bob Role", linkedTo: "board" }).value, "shape=swimlane;role_card=1;"));
    const bob = users.createUser("Bob", "5678", false).user;
    assert.equal(users.setUserRoleCard(bob.id, role).ok, true);
    users.logout(); users.login("Bob", "5678");
    assert.equal(users.canMoveTask(card), false);
    assert.equal(users.canEditTaskDetails(card), false);
    const duplicate = appendChild(harness.module, new TestCell("role-bob-2", makeXmlCell(harness.document, "role-value-2", { label: "Bob Role 2", linkedTo: "board", [users.attrs.roleUser]: bob.id }).value, "shape=swimlane;role_card=1;"));
    assert.ok(duplicate);
    assert.equal(users.getUserRoleCard(bob.id), null);
    assert.equal(users.canMoveTask(card), false);
});

test("garden grant creates a garden-scoped role card and links it to garden task boards", () => {
    const harness = loadUsersPlugin();
    installGardenRoleModuleApi(harness);
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    harness.module.setAttribute("garden_module", "1");
    users.stampCreatedOwner(harness.module);
    const board = appendChild(harness.module, makeXmlCell(harness.document, "garden-board", { board_key: "KANBAN_BOARD" }));
    const bob = users.createUser("Bob", "5678", false).user;
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "gardener" }).ok, true);
    const team = harness.model.getCell(harness.module.getAttribute(users.attrs.gardenTeamModule));
    const role = team.children.find(child => String(child.style || "").includes("role_card=1"));
    assert.ok(role);
    assert.equal(role.getAttribute(users.attrs.roleUser), bob.id);
    assert.equal(role.getAttribute(users.attrs.roleGardenModule), harness.module.id);
    assert.equal(role.getAttribute(users.attrs.roleTeamModule), team.id);
    assert.equal(roleFieldText(role, "role_name"), "Bob");
    assert.equal(roleFieldText(role, "role_title"), "Gardener");
    assert.match(board.getAttribute("linkedTo") || "", new RegExp(role.id));
    assert.match(role.getAttribute("linkedTo") || "", new RegExp(board.id));
});

test("user can have separate active role cards in multiple gardens", () => {
    const harness = loadUsersPlugin();
    installGardenRoleModuleApi(harness);
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    harness.module.setAttribute("garden_module", "1");
    users.stampCreatedOwner(harness.module);
    const secondGarden = appendChild(harness.layer, makeXmlCell(harness.document, "garden-two", { label: "Second Garden", garden_module: "1" }));
    secondGarden.style = "module=1";
    users.stampCreatedOwner(secondGarden);
    const bob = users.createUser("Bob", "5678", false).user;
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "gardener" }).ok, true);
    assert.equal(users.setScopeGrant(secondGarden, { userId: bob.id, preset: "coordinator" }).ok, true);
    const firstRole = users._test.getUserGardenRoleCard(bob.id, harness.module);
    const secondRole = users._test.getUserGardenRoleCard(bob.id, secondGarden);
    assert.ok(firstRole);
    assert.ok(secondRole);
    assert.notEqual(firstRole.id, secondRole.id);
    assert.equal(users.getUserRoleCard(bob.id), null);
});

test("removing garden access unlinks the user but preserves the role card", () => {
    const harness = loadUsersPlugin();
    installGardenRoleModuleApi(harness);
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    harness.module.setAttribute("garden_module", "1");
    users.stampCreatedOwner(harness.module);
    const bob = users.createUser("Bob", "5678", false).user;
    users.setScopeGrant(harness.module, { userId: bob.id, preset: "gardener" });
    const role = users._test.getUserGardenRoleCard(bob.id, harness.module).cell;
    const team = harness.model.getCell(harness.module.getAttribute(users.attrs.gardenTeamModule));
    assert.equal(users.removeScopeGrant(harness.module, bob.id).ok, true);
    assert.equal(role.parent !== null, true);
    assert.equal(role.getAttribute(users.attrs.roleUser), null);
    assert.equal(role.getAttribute(users.attrs.roleArchivedUser), bob.id);
    assert.equal(role.getAttribute(users.attrs.roleInactive), "1");
    assert.equal(roleFieldText(role, "role_status"), "Inactive - restorable");
    assert.equal(role.getAttribute(users.attrs.roleGardenModule), harness.module.id);
    const archive = JSON.parse(team.getAttribute(users.attrs.teamRoleArchive));
    assert.equal(archive.roles[bob.id].roleCardId, role.id);
    assert.equal(archive.roles[bob.id].preset, "gardener");
});

test("rechecking garden access restores the archived role card without duplicating profile data in archive", () => {
    const harness = loadUsersPlugin();
    installGardenRoleModuleApi(harness);
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    harness.module.setAttribute("garden_module", "1");
    users.stampCreatedOwner(harness.module);
    const bob = users.createUser("Bob", "5678", false).user;
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "gardener" }).ok, true);
    const team = harness.model.getCell(harness.module.getAttribute(users.attrs.gardenTeamModule));
    const role = users._test.getUserGardenRoleCard(bob.id, harness.module).cell;
    assert.equal(users.removeScopeGrant(harness.module, bob.id).ok, true);
    const archive = JSON.parse(team.getAttribute(users.attrs.teamRoleArchive));
    assert.equal(archive.roles[bob.id].roleCardId, role.id);
    assert.equal(Object.prototype.hasOwnProperty.call(archive.roles[bob.id], "name"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(archive.roles[bob.id], "title"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(archive.roles[bob.id], "contact"), false);
    assert.equal(harness.moduleMarginCalls.filter(call => call.moduleCell === team).length, 1);
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "coordinator" }).ok, true);
    const restored = users._test.getUserGardenRoleCard(bob.id, harness.module).cell;
    assert.equal(restored.id, role.id);
    assert.equal(restored.getAttribute(users.attrs.roleUser), bob.id);
    assert.equal(restored.getAttribute(users.attrs.roleArchivedUser), null);
    assert.equal(restored.getAttribute(users.attrs.roleInactive), null);
    assert.equal(roleFieldText(restored, "role_status"), "");
    assert.equal(roleFieldText(restored, "role_title"), "Gardener");
    assert.equal(team.children.filter(child => String(child.style || "").includes("role_card=1")).length, 1);
    assert.equal(harness.moduleMarginCalls.filter(call => call.moduleCell === team).length, 2);
});

test("admin roster garden access view does not repair missing companion teams", () => {
    const harness = loadUsersPlugin();
    installGardenRoleModuleApi(harness);
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    harness.module.setAttribute("garden_module", "1");
    harness.module.setAttribute("label", "North Garden");
    users.stampCreatedOwner(harness.module);
    const bob = users.createUser("Bob", "5678", false).user;
    harness.module.setAttribute(users.attrs.accessGrants, JSON.stringify([{ userId: bob.id, preset: "gardener", capabilities: [] }]));
    harness.actions.trellisUsers.funct();
    openGardenAccessPopover(harness.document, bob.id);
    const row = gardenAccessRow(harness.document, bob.id, harness.module.id);
    assert.ok(row);
    assert.match(row.textContent, /Missing role/);
    assert.equal(harness.module.getAttribute(users.attrs.gardenTeamModule), null);
    assert.equal(harness.model.getCell("team-" + harness.module.id), null);
});

test("admin roster shows one garden access dropdown per user with checkbox rows", () => {
    const harness = loadUsersPlugin();
    installGardenRoleModuleApi(harness);
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    harness.module.setAttribute("garden_module", "1");
    harness.module.setAttribute("label", "North Garden");
    users.stampCreatedOwner(harness.module);
    const bob = users.createUser("Bob", "5678", false).user;
    users.setScopeGrant(harness.module, { userId: bob.id, preset: "gardener" });
    harness.actions.trellisUsers.funct();
    const dropdown = harness.document.querySelector('.trellis-users-garden-access-dropdown[data-trellis-users-user-id="' + bob.id + '"]');
    assert.ok(dropdown);
    const button = dropdown.querySelector(".trellis-users-garden-access-button");
    assert.ok(button);
    assert.match(button.textContent, /Garden access \(1\)/);
    assert.equal(button.getAttribute("aria-haspopup"), "dialog");
    assert.equal(button.getAttribute("aria-expanded"), "false");
    const openDropdown = openGardenAccessPopover(harness.document, bob.id);
    assert.equal(openDropdown.querySelector(".trellis-users-garden-access-button").getAttribute("aria-expanded"), "true");
    assert.ok(openDropdown.querySelector(".trellis-users-garden-access-popover"));
    const row = gardenAccessRow(harness.document, bob.id, harness.module.id);
    assert.ok(row);
    assert.match(row.textContent, /North Garden/);
    assert.match(row.textContent, /Active/);
    assert.equal(row.querySelector('input[type="checkbox"]').checked, true);
    assert.equal(row.querySelector("select").value, "gardener");
});

test("garden access dropdown checkbox creates archives and restores role cards", () => {
    const harness = loadUsersPlugin();
    installGardenRoleModuleApi(harness);
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    harness.module.setAttribute("garden_module", "1");
    harness.module.setAttribute("label", "North Garden");
    users.stampCreatedOwner(harness.module);
    const bob = users.createUser("Bob", "5678", false).user;
    harness.actions.trellisUsers.funct();
    openGardenAccessPopover(harness.document, bob.id);
    let row = gardenAccessRow(harness.document, bob.id, harness.module.id);
    let checkbox = row.querySelector('input[type="checkbox"]');
    const select = row.querySelector("select");
    select.value = "gardener";
    checkbox.checked = true;
    checkbox.dispatchEvent(new harness.context.window.Event("change", { bubbles: true }));
    assert.deepEqual(JSON.parse(harness.module.getAttribute(users.attrs.accessGrants)).map(grant => ({ userId: grant.userId, preset: grant.preset })), [{ userId: bob.id, preset: "gardener" }]);
    const team = harness.model.getCell(harness.module.getAttribute(users.attrs.gardenTeamModule));
    assert.ok(team);
    assert.equal(harness.moduleMarginCalls.filter(call => call.moduleCell === team).length, 1);
    const role = users._test.getUserGardenRoleCard(bob.id, harness.module).cell;
    assert.ok(role);
    assert.ok(harness.document.querySelector(".trellis-users-garden-access-popover"));
    row = gardenAccessRow(harness.document, bob.id, harness.module.id);
    checkbox = row.querySelector('input[type="checkbox"]');
    checkbox.checked = false;
    checkbox.dispatchEvent(new harness.context.window.Event("change", { bubbles: true }));
    assert.equal(harness.module.getAttribute(users.attrs.accessGrants), null);
    assert.equal(role.getAttribute(users.attrs.roleUser), null);
    assert.equal(role.getAttribute(users.attrs.roleInactive), "1");
    assert.equal(roleFieldText(role, "role_status"), "Inactive - restorable");
    assert.ok(harness.document.querySelector(".trellis-users-garden-access-popover"));
    row = gardenAccessRow(harness.document, bob.id, harness.module.id);
    assert.match(row.textContent, /Inactive\/restorable/);
    checkbox = row.querySelector('input[type="checkbox"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new harness.context.window.Event("change", { bubbles: true }));
    const restored = users._test.getUserGardenRoleCard(bob.id, harness.module).cell;
    assert.equal(restored.id, role.id);
    assert.equal(restored.getAttribute(users.attrs.roleUser), bob.id);
    assert.equal(roleFieldText(restored, "role_status"), "");
    assert.ok(harness.document.querySelector(".trellis-users-garden-access-popover"));
    assert.equal(harness.moduleMarginCalls.filter(call => call.moduleCell === team).length, 2);
});

test("garden access popover filters by garden name and preserves search after checkbox changes", () => {
    const harness = loadUsersPlugin();
    installGardenRoleModuleApi(harness);
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    harness.module.setAttribute("garden_module", "1");
    harness.module.setAttribute("label", "North Garden");
    users.stampCreatedOwner(harness.module);
    const southGarden = appendChild(harness.layer, makeXmlCell(harness.document, "south-filter-garden", { label: "South Garden", garden_module: "1" }));
    southGarden.style = "module=1";
    users.stampCreatedOwner(southGarden);
    const bob = users.createUser("Bob", "5678", false).user;
    harness.actions.trellisUsers.funct();
    let dropdown = openGardenAccessPopover(harness.document, bob.id);
    let search = dropdown.querySelector(".trellis-users-garden-access-search");
    search.value = "south";
    search.dispatchEvent(new harness.context.window.Event("input", { bubbles: true }));
    dropdown = harness.document.querySelector('.trellis-users-garden-access-dropdown[data-trellis-users-user-id="' + bob.id + '"]');
    search = dropdown.querySelector(".trellis-users-garden-access-search");
    assert.equal(search.value, "south");
    assert.equal(gardenAccessRow(harness.document, bob.id, harness.module.id), null);
    const southRow = gardenAccessRow(harness.document, bob.id, southGarden.id);
    assert.ok(southRow);
    const checkbox = southRow.querySelector('input[type="checkbox"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new harness.context.window.Event("change", { bubbles: true }));
    dropdown = harness.document.querySelector('.trellis-users-garden-access-dropdown[data-trellis-users-user-id="' + bob.id + '"]');
    assert.ok(dropdown.querySelector(".trellis-users-garden-access-popover"));
    assert.equal(dropdown.querySelector(".trellis-users-garden-access-search").value, "south");
    assert.ok(gardenAccessRow(harness.document, bob.id, southGarden.id));
    assert.equal(gardenAccessRow(harness.document, bob.id, harness.module.id), null);
});

test("restored garden role keeps task assignment ids and relinks boards", () => {
    const harness = loadUsersPlugin();
    installGardenRoleModuleApi(harness);
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    harness.module.setAttribute("garden_module", "1");
    users.stampCreatedOwner(harness.module);
    const board = appendChild(harness.module, makeXmlCell(harness.document, "assignment-board", { board_key: "KANBAN_BOARD" }));
    const task = appendChild(board, makeXmlCell(harness.document, "assigned-task", { kanban_card: "1" }));
    const bob = users.createUser("Bob", "5678", false).user;
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "gardener" }).ok, true);
    const role = users._test.getUserGardenRoleCard(bob.id, harness.module).cell;
    task.setAttribute("task_assignee_role_ids_json", JSON.stringify([role.id]));
    assert.equal(users.removeScopeGrant(harness.module, bob.id).ok, true);
    board.setAttribute("linkedTo", "");
    role.setAttribute("linkedTo", "");
    assert.equal(users.setScopeGrant(harness.module, { userId: bob.id, preset: "gardener" }).ok, true);
    const restored = users._test.getUserGardenRoleCard(bob.id, harness.module).cell;
    assert.equal(restored.id, role.id);
    assert.deepEqual(JSON.parse(task.getAttribute("task_assignee_role_ids_json")), [role.id]);
    assert.match(board.getAttribute("linkedTo") || "", new RegExp(role.id));
    assert.match(role.getAttribute("linkedTo") || "", new RegExp(board.id));
});

test("garden access dropdown checkboxes keep multiple gardens independent for one user", () => {
    const harness = loadUsersPlugin();
    installGardenRoleModuleApi(harness);
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    harness.module.setAttribute("garden_module", "1");
    harness.module.setAttribute("label", "North Garden");
    users.stampCreatedOwner(harness.module);
    const southGarden = appendChild(harness.layer, makeXmlCell(harness.document, "south-garden", { label: "South Garden", garden_module: "1" }));
    southGarden.style = "module=1";
    users.stampCreatedOwner(southGarden);
    const bob = users.createUser("Bob", "5678", false).user;
    harness.actions.trellisUsers.funct();
    openGardenAccessPopover(harness.document, bob.id);
    const setGardenChecked = function (garden, checked, preset) {
        const row = gardenAccessRow(harness.document, bob.id, garden.id);
        if (preset) row.querySelector("select").value = preset;
        const checkbox = row.querySelector('input[type="checkbox"]');
        checkbox.checked = checked;
        checkbox.dispatchEvent(new harness.context.window.Event("change", { bubbles: true }));
    };
    setGardenChecked(harness.module, true, "gardener");
    setGardenChecked(southGarden, true, "coordinator");
    const northRole = users._test.getUserGardenRoleCard(bob.id, harness.module).cell;
    const southRole = users._test.getUserGardenRoleCard(bob.id, southGarden).cell;
    assert.notEqual(northRole.id, southRole.id);
    setGardenChecked(harness.module, false);
    assert.equal(users._test.getUserGardenRoleCard(bob.id, harness.module), null);
    assert.equal(northRole.getAttribute(users.attrs.roleInactive), "1");
    assert.equal(users._test.getUserGardenRoleCard(bob.id, southGarden).cell.id, southRole.id);
    assert.equal(southRole.getAttribute(users.attrs.roleUser), bob.id);
});

test("pending invite creates regular pending user grants and email draft", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "swimlane;module=1";
    users.stampCreatedOwner(harness.module);
    const result = users.createPendingInvite({ email: "Bob@Example.com", scopeCellIds: [harness.module.id], shareInfo: { deviceId: "DEV", folderId: "FOL", folderLabel: "Garden", folderPath: "C:/Garden" } });
    assert.equal(result.ok, true);
    assert.equal(result.invite.email, "bob@example.com");
    assert.match(result.emailDraft.body, /DEV/);
    assert.match(result.emailDraft.body, /FOL/);
    assert.match(result.emailDraft.body, new RegExp(result.code.replace("-", "\\-")));
    const store = users._test.readStore();
    assert.equal(store.pendingUsers.length, 1);
    assert.equal(store.invites.length, 1);
    assert.equal(store.invites[0].status, "pending");
    assert.ok(store.invites[0].expiresAt > Date.now() + 13 * 24 * 60 * 60 * 1000);
    const grants = JSON.parse(harness.module.getAttribute(users.attrs.accessGrants));
    assert.deepEqual(grants, [{ userId: store.pendingUsers[0].id, preset: "visitor", capabilities: [] }]);
});

test("pending garden invite creates no role card until acceptance", () => {
    const harness = loadUsersPlugin();
    installGardenRoleModuleApi(harness);
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    harness.module.setAttribute("garden_module", "1");
    users.stampCreatedOwner(harness.module);
    const invite = users.createPendingInvite({ email: "bob@example.com", scopeCellIds: [harness.module.id], preset: "gardener" });
    assert.equal(invite.ok, true);
    assert.equal(harness.model.getCell(harness.module.getAttribute(users.attrs.gardenTeamModule)), null);
    const accepted = users.acceptInvite({ email: "bob@example.com", code: invite.code, name: "Bob", pin: "5678" });
    assert.equal(accepted.ok, true);
    const role = users._test.getUserGardenRoleCard(accepted.user.id, harness.module);
    assert.ok(role);
    assert.equal(roleFieldText(role.cell, "role_title"), "Gardener");
});

test("duplicate invite email is rejected for pending users", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    assert.equal(users.createPendingInvite({ email: "bob@example.com", scopeCellIds: [harness.module.id] }).ok, true);
    const duplicate = users.createPendingInvite({ email: "BOB@example.com", scopeCellIds: [harness.module.id] });
    assert.equal(duplicate.ok, false);
    assert.match(duplicate.reason, /already/);
});

test("pending invite stores selected preset capabilities", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const invite = users.createPendingInvite({ email: "gardener@example.com", scopeCellIds: [harness.module.id], preset: "gardener" });
    assert.equal(invite.ok, true);
    assert.equal(invite.invite.preset, "gardener");
    assert.deepEqual(Array.from(invite.invite.capabilities), ["create_plantings", "edit_task_details", "manage_own_plantings", "move_tasks"]);
    assert.deepEqual(JSON.parse(harness.module.getAttribute(users.attrs.accessGrants))[0].capabilities, ["create_plantings", "edit_task_details", "manage_own_plantings", "move_tasks"]);
});

test("accept invite activates pending regular user and prevents token reuse", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const invite = users.createPendingInvite({ email: "bob@example.com", scopeCellIds: [harness.module.id] });
    users.logout();
    const accepted = users.acceptInvite({ email: "bob@example.com", code: invite.code, name: "Bob", pin: "5678" });
    assert.equal(accepted.ok, true);
    assert.equal(users.getCurrentUser().email, "bob@example.com");
    assert.equal(users.canEditCell(harness.card), false);
    assert.equal(users.canAddCell(harness.module), false);
    users.logout();
    const reuse = users.acceptInvite({ email: "bob@example.com", code: invite.code, name: "Bob 2", pin: "9999" });
    assert.equal(reuse.ok, false);
    assert.match(reuse.reason, /No active invite/);
});

test("revoking pending invite removes pending grants", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const invite = users.createPendingInvite({ email: "bob@example.com", scopeCellIds: [harness.module.id] });
    const pendingId = invite.invite.pendingUserId;
    assert.match(harness.module.getAttribute(users.attrs.accessGrants), new RegExp(pendingId));
    assert.equal(users.revokeInvite(invite.invite.id).ok, true);
    assert.doesNotMatch(harness.module.getAttribute(users.attrs.accessGrants) || "", new RegExp(pendingId));
    assert.equal(users.acceptInvite({ email: "bob@example.com", code: invite.code, name: "Bob", pin: "5678" }).ok, false);
});

test("resend invite rotates code and expiry", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const invite = users.createPendingInvite({ email: "bob@example.com", scopeCellIds: [harness.module.id] });
    const firstHash = users._test.readStore().invites[0].codeHash;
    const resent = users.resendInvite(invite.invite.id, { deviceId: "NEWDEV" });
    assert.equal(resent.ok, true);
    const next = users._test.readStore().invites[0];
    assert.notEqual(next.codeHash, firstHash);
    assert.notEqual(resent.code, invite.code);
    assert.match(resent.emailDraft.body, /NEWDEV/);
});

test("regular non-owner cannot invite selected scopes", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    users.createUser("Bob", "5678", false);
    users.logout();
    users.login("Bob", "5678");
    const result = users.createPendingInvite({ email: "carol@example.com", scopeCellIds: [harness.module.id] });
    assert.equal(result.ok, false);
    assert.match(result.reason, /own or administer/);
});

test("expired invites are hidden and remove pending grants", () => {
    const harness = loadUsersPlugin();
    const users = harness.context.window.Trellis.users;
    users.enableUsers("Alice", "1234");
    harness.module.style = "module=1";
    users.stampCreatedOwner(harness.module);
    const invite = users.createPendingInvite({ email: "bob@example.com", scopeCellIds: [harness.module.id] });
    const store = users._test.readStore();
    store.invites[0].expiresAt = Date.now() - 1;
    users._test.writeStore(store);
    assert.deepEqual(users.listPendingInvites(), []);
    assert.doesNotMatch(harness.module.getAttribute(users.attrs.accessGrants) || "", new RegExp(invite.invite.pendingUserId));
    assert.equal(users.acceptInvite({ email: "bob@example.com", code: invite.code, name: "Bob", pin: "5678" }).ok, false);
});
