const assert = require("node:assert/strict"); // NEW
const fs = require("node:fs"); // NEW
const path = require("node:path"); // NEW
const test = require("node:test"); // NEW
const vm = require("node:vm"); // NEW
const { JSDOM } = require("jsdom"); // NEW

const PROJECT_ROOT = path.join(__dirname, ".."); // NEW
const PLUGIN_PATH = path.join(PROJECT_ROOT, "drawio", "src", "main", "webapp", "plugins", "garden_planner_plugins", "Modules_Standalone.js"); // NEW

let nextCellId = 1; // NEW

class TestGeometry { // NEW
    constructor(x, y, width, height) { // NEW
        this.x = x; // NEW
        this.y = y; // NEW
        this.width = width; // NEW
        this.height = height; // NEW
        this.relative = false; // NEW
    } // NEW

    clone() { // NEW
        const copy = new TestGeometry(this.x, this.y, this.width, this.height); // NEW
        copy.relative = this.relative; // NEW
        copy.alternateBounds = this.alternateBounds; // NEW
        return copy; // NEW
    } // NEW
} // NEW

class TestCell { // NEW
    constructor(value, geometry, style) { // NEW
        this.id = "cell-" + nextCellId++; // NEW
        this.value = value; // NEW
        this.geometry = geometry || null; // NEW
        this.style = style || ""; // NEW
        this.children = []; // NEW
        this.parent = null; // NEW
        this.vertex = false; // NEW
    } // NEW

    getId() { return this.id; } // NEW
    getStyle() { return this.style || ""; } // NEW
    getGeometry() { return this.geometry; } // NEW
    isVertex() { return !!this.vertex; } // NEW
    getAttribute(key) { return this.value && this.value.nodeType === 1 ? this.value.getAttribute(key) : null; } // NEW
} // NEW

class TestModel { // NEW
    constructor(root) { // NEW
        this.root = root; // NEW
        this.cells = {}; // NEW
        this.listeners = new Map(); // NEW
        this.updateLevel = 0; // NEW
        this.topLevelUpdateCount = 0; // NEW
        this.register(root); // NEW
    } // NEW

    register(cell) { // NEW
        if (cell && cell.id) this.cells[cell.id] = cell; // NEW
        (cell.children || []).forEach(child => this.register(child)); // NEW
    } // NEW

    beginUpdate() { if (this.updateLevel === 0) this.topLevelUpdateCount += 1; this.updateLevel += 1; } // CHANGE
    endUpdate() { this.updateLevel = Math.max(0, this.updateLevel - 1); } // CHANGE
    getRoot() { return this.root; } // NEW
    getCell(id) { return this.cells[id] || null; } // NEW
    getParent(cell) { return cell && cell.parent ? cell.parent : null; } // NEW
    getChildren(cell) { return cell && cell.children ? cell.children.slice() : []; } // NEW
    getChildCount(cell) { return cell && cell.children ? cell.children.length : 0; } // NEW
    getChildAt(cell, index) { return cell.children[index]; } // NEW
    getGeometry(cell) { return cell && cell.geometry ? cell.geometry : null; } // NEW
    isVertex(cell) { return !!cell && !!cell.vertex; } // NEW

    add(parent, cell, index) { // NEW
        if (!parent || !cell) return cell; // NEW
        if (cell.parent && cell.parent.children) cell.parent.children = cell.parent.children.filter(child => child !== cell); // NEW
        cell.parent = parent; // NEW
        if (typeof index === "number") parent.children.splice(index, 0, cell); // NEW
        else parent.children.push(cell); // NEW
        this.register(cell); // NEW
        return cell; // NEW
    } // NEW

    remove(cell) { // NEW
        if (!cell) return null; // NEW
        if (cell.parent && cell.parent.children) cell.parent.children = cell.parent.children.filter(child => child !== cell); // NEW
        cell.parent = null; // NEW
        return cell; // NEW
    } // NEW

    setGeometry(cell, geometry) { if (cell) cell.geometry = geometry; } // NEW
    setStyle(cell, style) { if (cell) cell.style = style || ""; } // NEW
    setValue(cell, value) { if (cell) cell.value = value; } // NEW

    addListener(eventName, listener) { // NEW
        if (!this.listeners.has(eventName)) this.listeners.set(eventName, []); // NEW
        this.listeners.get(eventName).push(listener); // NEW
    } // NEW

    fire(eventName) { // NEW
        (this.listeners.get(eventName) || []).forEach(listener => listener(this, {})); // NEW
    } // NEW
} // NEW

function makeEventObject(name, pairs) { // NEW
    const props = {}; // NEW
    for (let i = 0; i < pairs.length; i += 2) props[pairs[i]] = pairs[i + 1]; // NEW
    return { name, getProperty(key) { return props[key]; } }; // NEW
} // NEW

function makeHarness() { // NEW
    nextCellId = 1; // NEW
    const dom = new JSDOM("<!doctype html><body><div id='graph'></div></body>"); // NEW
    const document = dom.window.document; // NEW
    const root = new TestCell("", null, ""); // NEW
    root.id = "root"; // NEW
    const model = new TestModel(root); // NEW
    const mouseListeners = []; // NEW
    const graphListeners = new Map(); // NEW
    const viewListeners = new Map(); // NEW
    const selectionListeners = new Map(); // NEW
    const firedEvents = []; // NEW
    const contextMenuContributors = []; // NEW
    let insertImageCalls = 0; // NEW
    let promptValue = "40"; // NEW
    const promptCalls = []; // NEW
    let selectedCells = []; // CHANGE
    const container = document.getElementById("graph"); // NEW
    Object.defineProperty(container, "clientWidth", { value: 800, configurable: true }); // NEW
    Object.defineProperty(container, "clientHeight", { value: 600, configurable: true }); // NEW
    container.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600 }); // NEW

    function addMappedListener(map, eventName, listener) { // NEW
        if (!map.has(eventName)) map.set(eventName, []); // NEW
        map.get(eventName).push(listener); // NEW
    } // NEW

    const graph = { // NEW
        container, // NEW
        popupMenuHandler: {}, // NEW
        resizeChildCells() {}, // NEW
        view: { // NEW
            scale: 1, // NEW
            translate: { x: 0, y: 0 }, // NEW
            getState(cell) { const g = model.getGeometry(cell); return g ? { x: g.x, y: g.y, width: g.width, height: g.height } : null; }, // NEW
            addListener(eventName, listener) { addMappedListener(viewListeners, eventName, listener); } // NEW
        }, // NEW
        getModel() { return model; }, // NEW
        getDefaultParent() { return root; }, // NEW
        getCellGeometry(cell) { return model.getGeometry(cell); }, // NEW
        getStartSize() { return { width: 0, height: 0 }; }, // NEW
        getPointForEvent(evt) { return { x: evt.graphX == null ? evt.clientX : evt.graphX, y: evt.graphY == null ? evt.clientY : evt.graphY }; }, // NEW
        getCellAt() { return graph.__hitCell || null; }, // NEW
        getView() { return this.view; }, // NEW
        refresh() {}, // NEW
        insertVertex(parent, id, value, x, y, w, h, style) { const cell = new TestCell(value, new TestGeometry(x, y, w, h), style); cell.vertex = true; return model.add(parent || root, cell); }, // NEW
        setSelectionCell(cell) { selectedCells = cell ? [cell] : []; (selectionListeners.get("change") || []).forEach(listener => listener(this, {})); }, // CHANGE
        setSelectionCells(cells) { selectedCells = (cells || []).filter(Boolean); (selectionListeners.get("change") || []).forEach(listener => listener(this, {})); }, // NEW
        getSelectionCell() { return selectedCells[0] || null; }, // CHANGE
        getSelectionCells() { return selectedCells.slice(); }, // CHANGE
        getSelectionModel() { return { addListener(eventName, listener) { addMappedListener(selectionListeners, eventName, listener); } }; }, // NEW
        addMouseListener(listener) { mouseListeners.push(listener); }, // NEW
        addListener(eventName, listener) { addMappedListener(graphListeners, eventName, listener); }, // NEW
        fireEvent(evt) { firedEvents.push(evt); (graphListeners.get(evt && evt.name) || []).forEach(listener => listener(this, evt)); } // CHANGE
    }; // NEW

    dom.window.TrellisContextMenu = { // NEW
        install() {}, // NEW
        register(contributor) { contextMenuContributors.push(contributor); } // NEW
    }; // NEW

    const actions = { // NEW
        get(name) { // NEW
            if (name !== "insertImage") return null; // NEW
            return { // NEW
                funct() { // NEW
                    insertImageCalls += 1; // NEW
                    graph.insertVertex(root, null, "avatar", 0, 0, 20, 20, "shape=image;image=data:image/png;base64,test", false); // NEW
                } // NEW
            }; // NEW
        } // NEW
    }; // NEW

    const ui = { // NEW
        editor: { graph }, // NEW
        actions, // NEW
        prompt(message, value, callback) { // NEW
            promptCalls.push({ message, value }); // NEW
            callback(promptValue); // NEW
        } // NEW
    }; // NEW

    const context = { // NEW
        window: dom.window, // NEW
        document, // NEW
        console: { log() {}, warn() {}, error() {} }, // NEW
        setTimeout, // NEW
        clearTimeout, // NEW
        Draw: { loadPlugin(callback) { callback(ui); } }, // CHANGE
        mxCell: TestCell, // NEW
        mxGeometry: TestGeometry, // NEW
        mxLayoutManager: function mxLayoutManager() {}, // NEW
        mxStackLayout: function mxStackLayout() {}, // NEW
        mxEventObject: function mxEventObject(name, ...pairs) { return makeEventObject(name, pairs); }, // NEW
        mxUtils: { // NEW
            createXmlDocument() { return document.implementation.createDocument("", "", null); } // NEW
        }, // NEW
        mxEvent: { // NEW
            CHANGE: "change", // NEW
            ADD_CELLS: "addCells", // NEW
            CELLS_ADDED: "cellsAdded", // NEW
            CELLS_MOVED: "cellsMoved", // NEW
            CELLS_RESIZED: "cellsResized", // NEW
            SCALE: "scale", // NEW
            TRANSLATE: "translate", // NEW
            SCALE_AND_TRANSLATE: "scaleAndTranslate", // NEW
            DESTROY: "destroy", // NEW
            addListener(node, eventName, listener) { node.addEventListener(eventName, listener); }, // NEW
            consume(evt) { if (evt && evt.preventDefault) evt.preventDefault(); if (evt && evt.stopPropagation) evt.stopPropagation(); }, // NEW
            getSource(evt) { return evt && (evt.target || evt.srcElement); }, // NEW
            getClientX(evt) { return evt && evt.clientX || 0; }, // NEW
            getClientY(evt) { return evt && evt.clientY || 0; }, // NEW
            isControlDown(evt) { return !!(evt && evt.ctrlKey); }, // NEW
            isMetaDown(evt) { return !!(evt && evt.metaKey); }, // NEW
            isShiftDown(evt) { return !!(evt && evt.shiftKey); }, // NEW
            isPopupTrigger(evt) { return !!(evt && evt.button === 2); } // NEW
        } // NEW
    }; // NEW

    vm.runInNewContext(fs.readFileSync(PLUGIN_PATH, "utf8"), context, { filename: PLUGIN_PATH }); // NEW
    return { dom, document, graph, model, root, mouseListeners, graphListeners, viewListeners, selectionListeners, firedEvents, contextMenuContributors, promptCalls, setPromptValue(value) { promptValue = value; }, get insertImageCalls() { return insertImageCalls; }, get selectedCell() { return selectedCells[0] || null; } }; // CHANGE
} // NEW

function makeMouseEvent(window, type, opts) { // NEW
    const event = new window.MouseEvent(type, { // NEW
        bubbles: true, // NEW
        button: opts.button == null ? 0 : opts.button, // NEW
        clientX: opts.clientX, // NEW
        clientY: opts.clientY, // NEW
        detail: opts.detail == null ? 1 : opts.detail, // NEW
        ctrlKey: !!opts.ctrlKey, // NEW
        shiftKey: !!opts.shiftKey, // NEW
        altKey: !!opts.altKey // NEW
    }); // NEW
    Object.defineProperty(event, "graphX", { value: opts.graphX == null ? opts.clientX : opts.graphX }); // NEW
    Object.defineProperty(event, "graphY", { value: opts.graphY == null ? opts.clientY : opts.graphY }); // NEW
    return event; // NEW
} // NEW

function fireGraphClick(harness, opts = {}) { // NEW
    const graph = harness.graph; // NEW
    const cell = opts.cell || null; // NEW
    graph.__hitCell = opts.hitCell === undefined ? cell : opts.hitCell; // NEW
    const down = makeMouseEvent(harness.dom.window, "mousedown", { clientX: opts.clientX || 100, clientY: opts.clientY || 120, graphX: opts.graphX || 90, graphY: opts.graphY || 100, detail: opts.detail }); // NEW
    const up = makeMouseEvent(harness.dom.window, "mouseup", { clientX: opts.upClientX || opts.clientX || 100, clientY: opts.upClientY || opts.clientY || 120, graphX: opts.graphX || 90, graphY: opts.graphY || 100, detail: opts.detail }); // NEW
    const makeMe = event => ({ // NEW
        getEvent() { return event; }, // NEW
        getCell() { return cell; }, // NEW
        getGraphX() { return event.graphX; }, // NEW
        getGraphY() { return event.graphY; } // NEW
    }); // NEW
    harness.mouseListeners.forEach(listener => listener.mouseDown(graph, makeMe(down))); // NEW
    if (opts.selectCellOnDown) graph.setSelectionCell(opts.selectCellOnDown); // NEW
    harness.mouseListeners.forEach(listener => listener.mouseUp(graph, makeMe(up))); // NEW
} // NEW

function overlayButtons(document) { // NEW
    return Array.from(document.querySelectorAll(".trellis-root-module-overlay button")); // NEW
} // NEW

function roleOverlay(document) { // NEW
    return document.querySelector(".trellis-team-role-overlay"); // NEW
} // NEW

function roleOverlayButtons(document) { // NEW
    return Array.from(document.querySelectorAll(".trellis-team-role-overlay button")); // NEW
} // NEW

function roleImageOverlay(document) { // NEW
    return document.querySelector(".trellis-role-image-overlay"); // NEW
} // NEW

function roleImageOverlayButtons(document) { // NEW
    return Array.from(document.querySelectorAll(".trellis-role-image-overlay button")); // NEW
} // NEW

function isRoleImageOverlayVisible(document) { // NEW
    const overlay = roleImageOverlay(document); // NEW
    return !!overlay && overlay.style.display !== "none"; // NEW
} // NEW

function fireMappedListeners(map, eventName) { // NEW
    (map.get(eventName) || []).forEach(listener => listener({}, {})); // NEW
} // NEW

function menuItemsFor(harness, cell, evt) { // NEW
    const items = []; // NEW
    const menu = { // NEW
        addItem(label, _icon, funct) { items.push({ label, funct }); }, // NEW
        addSeparator() {} // NEW
    }; // NEW
    harness.contextMenuContributors.forEach(contributor => contributor.addItems(menu, cell, evt)); // NEW
    return items; // NEW
} // NEW

function styleHas(cell, flag) { // NEW
    return new RegExp("(^|;)" + flag + "(;|$)").test(cell && cell.style || ""); // NEW
} // NEW

function cellText(cell) { // NEW
    if (!cell) return ""; // NEW
    const raw = cell.value && cell.value.getAttribute ? (cell.value.getAttribute("label") || "") : (cell.value == null ? "" : String(cell.value)); // NEW
    return String(raw).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); // NEW
} // NEW

function createRoleFixture(harness) { // NEW
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team"); // NEW
    const role = harness.graph.__trellisModules.createRoleCard(team, 90, 100); // NEW
    const imageRow = role.children.find(child => styleHas(child, "role_imagerow=1")); // NEW
    const nameRow = role.children.find(child => styleHas(child, "role_name=1")); // CHANGE
    const titleRow = role.children.find(child => styleHas(child, "role_title=1")); // CHANGE
    const fieldLabels = role.children.filter(child => styleHas(child, "role_field_label=1")); // NEW
    return { team, role, imageRow, nameRow, titleRow, fieldLabels }; // CHANGE
} // NEW

function runModulesContextMenu(harness, cell) { // NEW
    const contributor = harness.contextMenuContributors.find(item => item.id === "modules"); // NEW
    assert.ok(contributor); // NEW
    const labels = []; // NEW
    const actions = new Map(); // NEW
    const menu = { // NEW
        addSeparator() { labels.push("---"); }, // NEW
        addItem(label, _image, funct) { labels.push(label); if (typeof funct === "function") actions.set(label, funct); } // NEW
    }; // NEW
    contributor.addItems(menu, cell, { graphX: 90, graphY: 100, clientX: 100, clientY: 120 }); // NEW
    return { labels, actions }; // NEW
} // NEW

function getRoleAvatar(imageRow) { // NEW
    return (imageRow.children || []).find(child => styleHas(child, "role_avatar=1")) || null; // NEW
} // NEW

function waitForTimers() { // NEW
    return new Promise(resolve => setTimeout(resolve, 5)); // NEW
} // NEW

test("createModuleAtPoint creates a regular module at requested coordinates", () => { // NEW
    const harness = makeHarness(); // NEW
    const mod = harness.graph.__trellisModules.createModuleAtPoint({ x: 11, y: 22 }, "regular"); // NEW
    assert.equal(harness.root.children[0], mod); // NEW
    assert.equal(mod.geometry.x, 11); // NEW
    assert.equal(mod.geometry.y, 22); // NEW
    assert.match(mod.style, /module=1/); // NEW
    assert.equal(mod.getAttribute("garden_module"), null); // NEW
    assert.equal(mod.getAttribute("team_module"), null); // NEW
    assert.equal(harness.selectedCell, mod); // NEW
}); // NEW

test("createModuleAtPoint creates garden module with settings-needed event", async () => { // NEW
    const harness = makeHarness(); // NEW
    const mod = harness.graph.__trellisModules.createModuleAtPoint({ x: 30, y: 40 }, "garden"); // NEW
    await new Promise(resolve => setTimeout(resolve, 5)); // NEW
    assert.equal(mod.getAttribute("garden_module"), "1"); // NEW
    assert.equal(mod.getAttribute("team_module"), null); // NEW
    assert.match(mod.style, /swimlaneFillColor=#B9E0A5/); // NEW
    assert.equal(mod.geometry.width, 440); // NEW
    assert.equal(mod.geometry.height, 340); // NEW
    assert.equal(harness.selectedCell, mod); // NEW
    assert.equal(harness.firedEvents.length, 1); // NEW
    assert.equal(harness.firedEvents[0].name, "usl:gardenModuleNeedsSettings"); // NEW
    assert.equal(harness.firedEvents[0].getProperty("cell"), mod); // NEW
}); // NEW

test("createModuleAtPoint creates team module", () => { // NEW
    const harness = makeHarness(); // NEW
    const mod = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team"); // NEW
    assert.equal(mod.getAttribute("team_module"), "1"); // NEW
    assert.equal(mod.getAttribute("garden_module"), null); // NEW
    assert.match(mod.style, /swimlaneFillColor=#FFF2CC/); // NEW
    assert.equal(harness.selectedCell, mod); // NEW
}); // NEW

test("promptSetModuleMargin updates style and reapplies module sizing", async () => { // NEW
    const harness = makeHarness(); // NEW
    const mod = harness.graph.__trellisModules.createModuleAtPoint({ x: 11, y: 22 }, "regular"); // NEW
    mod.style += ";module_margin=12"; // NEW
    const child = new TestCell("child", new TestGeometry(20, 30, 220, 80), ""); // NEW
    child.vertex = true; // NEW
    harness.model.add(mod, child); // NEW
    harness.setPromptValue("45"); // NEW
    harness.graph.__trellisModules.promptSetModuleMargin(mod); // NEW
    await waitForTimers(); // NEW
    assert.equal(harness.promptCalls.length, 1); // NEW
    assert.equal(harness.promptCalls[0].value, "12"); // NEW
    assert.match(mod.style, /(?:^|;)module_margin=45(?:;|$)/); // NEW
    assert.doesNotMatch(mod.style, /(?:^|;)module_margin=12(?:;|$)/); // NEW
    assert.equal(mod.geometry.width, 285); // NEW
    assert.equal(mod.geometry.height, 155); // NEW
}); // NEW

test("module margin prompt can be requested through the fallback graph event", async () => { // NEW
    const harness = makeHarness(); // NEW
    const mod = harness.graph.__trellisModules.createModuleAtPoint({ x: 11, y: 22 }, "regular"); // NEW
    harness.setPromptValue("30"); // NEW
    harness.graph.fireEvent(makeEventObject("usl:requestPromptSetModuleMargin", ["cell", mod])); // NEW
    await waitForTimers(); // NEW
    assert.equal(harness.promptCalls.length, 1); // NEW
    assert.match(mod.style, /(?:^|;)module_margin=30(?:;|$)/); // NEW
}); // NEW

test("empty canvas click renders root module overlay buttons", () => { // NEW
    const harness = makeHarness(); // NEW
    fireGraphClick(harness, { clientX: 120, clientY: 150, graphX: 200, graphY: 230 }); // NEW
    const buttons = overlayButtons(harness.document); // NEW
    assert.deepEqual(buttons.map(button => button.textContent), ["Add Module", "Add Garden Module", "Add Team Module"]); // NEW
    assert.equal(harness.document.querySelector(".trellis-root-module-overlay").style.display, "flex"); // NEW
}); // NEW

test("overlay buttons create the selected module type at stored click point and hide", async () => { // NEW
    const harness = makeHarness(); // NEW
    fireGraphClick(harness, { clientX: 130, clientY: 160, graphX: 210, graphY: 240 }); // NEW
    overlayButtons(harness.document)[1].dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true })); // NEW
    await new Promise(resolve => setTimeout(resolve, 5)); // NEW
    const mod = harness.root.children[0]; // NEW
    assert.equal(mod.geometry.x, 210); // NEW
    assert.equal(mod.geometry.y, 240); // NEW
    assert.equal(mod.getAttribute("garden_module"), "1"); // NEW
    assert.equal(harness.document.querySelector(".trellis-root-module-overlay").style.display, "none"); // NEW
}); // NEW

test("clicking an existing cell does not render the root module overlay", () => { // NEW
    const harness = makeHarness(); // NEW
    const existing = harness.graph.__trellisModules.createModuleAtPoint({ x: 5, y: 6 }, "regular"); // NEW
    fireGraphClick(harness, { cell: existing, hitCell: existing, clientX: 140, clientY: 170, graphX: 220, graphY: 250 }); // NEW
    const overlay = harness.document.querySelector(".trellis-root-module-overlay"); // NEW
    assert.equal(overlay, null); // NEW
}); // NEW

test("overlay dismisses on Escape and outside graph gesture", () => { // NEW
    const harness = makeHarness(); // NEW
    fireGraphClick(harness, { clientX: 150, clientY: 180, graphX: 230, graphY: 260 }); // NEW
    const overlay = harness.document.querySelector(".trellis-root-module-overlay"); // NEW
    assert.equal(overlay.style.display, "flex"); // NEW
    harness.document.dispatchEvent(new harness.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); // NEW
    assert.equal(overlay.style.display, "none"); // NEW
    fireGraphClick(harness, { clientX: 150, clientY: 180, graphX: 230, graphY: 260 }); // NEW
    assert.equal(overlay.style.display, "flex"); // NEW
    const existing = harness.graph.__trellisModules.createModuleAtPoint({ x: 1, y: 2 }, "regular"); // NEW
    fireGraphClick(harness, { cell: existing, hitCell: existing, clientX: 160, clientY: 190, graphX: 240, graphY: 270 }); // NEW
    assert.equal(overlay.style.display, "none"); // NEW
}); // NEW

test("empty canvas click while overlay is active dismisses without reopening", () => { // NEW
    const harness = makeHarness(); // NEW
    fireGraphClick(harness, { clientX: 170, clientY: 200, graphX: 250, graphY: 280 }); // NEW
    const overlay = harness.document.querySelector(".trellis-root-module-overlay"); // NEW
    assert.equal(overlay.style.display, "flex"); // NEW
    fireGraphClick(harness, { clientX: 190, clientY: 220, graphX: 270, graphY: 300 }); // NEW
    assert.equal(overlay.style.display, "none"); // NEW
    fireGraphClick(harness, { clientX: 210, clientY: 240, graphX: 290, graphY: 320 }); // NEW
    assert.equal(overlay.style.display, "flex"); // NEW
}); // NEW

test("selecting one team module renders the add role card overlay", () => { // NEW
    const harness = makeHarness(); // NEW
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team"); // NEW
    const buttons = roleOverlayButtons(harness.document); // NEW
    assert.deepEqual(buttons.map(button => button.textContent), ["Add Role Card", "Set Module Margin"]); // CHANGE
    assert.equal(roleOverlay(harness.document).style.display, "flex"); // NEW
    assert.equal(roleOverlay(harness.document).style.left, "58px"); // NEW
    assert.equal(roleOverlay(harness.document).style.top, "68px"); // NEW
    assert.equal(harness.selectedCell, team); // NEW
}); // NEW

test("first click selecting a team module shows role overlay next to the click", () => { // NEW
    const harness = makeHarness(); // NEW
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team"); // NEW
    harness.graph.setSelectionCell(null); // NEW
    fireGraphClick(harness, { cell: team, hitCell: team, selectCellOnDown: team, clientX: 180, clientY: 220, graphX: 90, graphY: 100 }); // NEW
    const overlay = roleOverlay(harness.document); // NEW
    assert.equal(overlay.style.display, "flex"); // NEW
    assert.equal(overlay.style.left, "178px"); // NEW
    assert.equal(overlay.style.top, "208px"); // NEW
}); // NEW

test("selecting regular or garden modules does not render the role card overlay", () => { // NEW
    const harness = makeHarness(); // NEW
    const regular = harness.graph.__trellisModules.createModuleAtPoint({ x: 10, y: 20 }, "regular"); // NEW
    assert.equal(roleOverlay(harness.document), null); // NEW
    const garden = harness.graph.__trellisModules.createModuleAtPoint({ x: 30, y: 40 }, "garden"); // NEW
    assert.equal(roleOverlay(harness.document), null); // NEW
    harness.graph.setSelectionCell(regular); // NEW
    assert.equal(roleOverlay(harness.document), null); // NEW
    harness.graph.setSelectionCell(garden); // NEW
    assert.equal(roleOverlay(harness.document), null); // NEW
}); // NEW

test("role overlay button creates role card from stored click point and hides", () => { // NEW
    const harness = makeHarness(); // NEW
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team"); // NEW
    harness.document.dispatchEvent(new harness.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); // NEW
    fireGraphClick(harness, { cell: team, hitCell: team, clientX: 100, clientY: 120, graphX: 90, graphY: 100 }); // NEW
    harness.graph.setSelectionCell(team); // NEW
    const updateCountBefore = harness.model.topLevelUpdateCount; // NEW
    roleOverlayButtons(harness.document)[0].dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true })); // NEW
    const role = team.children.find(child => /(^|;)role_card=1(;|$)/.test(child.style)); // NEW
    assert.ok(role); // NEW
    assert.equal(role.geometry.x, 40); // NEW
    assert.equal(role.geometry.y, 40); // NEW
    assert.equal(harness.selectedCell, role); // NEW
    assert.equal(roleOverlay(harness.document).style.display, "none"); // NEW
    assert.equal(harness.model.topLevelUpdateCount - updateCountBefore, 1); // NEW
}); // NEW

test("context menu add role card uses one top-level model transaction", () => { // NEW
    const harness = makeHarness(); // NEW
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team"); // NEW
    const evt = makeMouseEvent(harness.dom.window, "mouseup", { clientX: 110, clientY: 130, graphX: 95, graphY: 105 }); // NEW
    const addRole = menuItemsFor(harness, team, evt).find(item => item.label === "Add Role Card"); // NEW
    assert.ok(addRole); // NEW
    const updateCountBefore = harness.model.topLevelUpdateCount; // NEW
    addRole.funct(); // NEW
    const role = team.children.find(child => /(^|;)role_card=1(;|$)/.test(child.style)); // NEW
    assert.ok(role); // NEW
    assert.equal(role.geometry.x, 45); // NEW
    assert.equal(role.geometry.y, 45); // NEW
    assert.equal(harness.selectedCell, role); // NEW
    assert.equal(harness.model.topLevelUpdateCount - updateCountBefore, 1); // NEW
}); // NEW

test("role overlay button falls back to top-left content placement", () => { // NEW
    const harness = makeHarness(); // NEW
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team"); // NEW
    roleOverlayButtons(harness.document)[0].dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true })); // NEW
    const role = team.children.find(child => /(^|;)role_card=1(;|$)/.test(child.style)); // NEW
    assert.ok(role); // NEW
    assert.equal(role.geometry.x, 100); // NEW
    assert.equal(role.geometry.y, 100); // NEW
    assert.equal(harness.selectedCell, role); // NEW
    assert.equal(roleOverlay(harness.document).style.display, "none"); // NEW
}); // NEW

test("role overlay margin button invokes shared module margin prompt", async () => { // NEW
    const harness = makeHarness(); // NEW
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team"); // NEW
    harness.setPromptValue("65"); // NEW
    roleOverlayButtons(harness.document)[1].dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true })); // NEW
    await waitForTimers(); // NEW
    assert.equal(harness.promptCalls.length, 1); // NEW
    assert.match(team.style, /(?:^|;)module_margin=65(?:;|$)/); // NEW
    assert.equal(roleOverlay(harness.document).style.display, "none"); // NEW
}); // NEW

test("clicking the already-selected team module hides role overlay without reopening", () => { // NEW
    const harness = makeHarness(); // NEW
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team"); // NEW
    const overlay = roleOverlay(harness.document); // NEW
    assert.equal(overlay.style.display, "flex"); // NEW
    fireGraphClick(harness, { cell: team, hitCell: team, clientX: 100, clientY: 120, graphX: 90, graphY: 100 }); // NEW
    assert.equal(overlay.style.display, "none"); // NEW
    assert.equal(roleOverlayButtons(harness.document).length, 2); // CHANGE
}); // NEW

test("role overlay hides on Escape, outside gesture, model change, and view change", () => { // NEW
    const harness = makeHarness(); // NEW
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team"); // NEW
    const overlay = roleOverlay(harness.document); // NEW
    assert.equal(overlay.style.display, "flex"); // NEW
    harness.document.dispatchEvent(new harness.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); // NEW
    assert.equal(overlay.style.display, "none"); // NEW
    harness.graph.setSelectionCell(team); // NEW
    assert.equal(overlay.style.display, "flex"); // NEW
    fireGraphClick(harness, { clientX: 200, clientY: 220, graphX: 190, graphY: 200 }); // NEW
    assert.equal(overlay.style.display, "none"); // NEW
    harness.graph.setSelectionCell(team); // NEW
    assert.equal(overlay.style.display, "flex"); // NEW
    harness.model.fire("change"); // NEW
    assert.equal(overlay.style.display, "none"); // NEW
    harness.graph.setSelectionCell(team); // NEW
    assert.equal(overlay.style.display, "flex"); // NEW
    fireMappedListeners(harness.viewListeners, "scale"); // NEW
    assert.equal(overlay.style.display, "none"); // NEW
    harness.graph.setSelectionCell(team); // NEW
    assert.equal(overlay.style.display, "flex"); // NEW
    fireMappedListeners(harness.viewListeners, "translate"); // NEW
    assert.equal(overlay.style.display, "none"); // NEW
}); // NEW

test("new role cards use v2 compact roster profile geometry", () => { // CHANGE
    const harness = makeHarness(); // NEW
    const { role, imageRow, nameRow, titleRow, fieldLabels } = createRoleFixture(harness); // CHANGE
    assert.match(role.style, /(?:^|;)role_card=1(?:;|$)/); // NEW
    assert.match(role.style, /(?:^|;)role_card_version=2(?:;|$)/); // NEW
    assert.equal(role.geometry.width, 260); // NEW
    assert.equal(role.geometry.height, 220); // NEW
    assert.equal(role.geometry.alternateBounds.width, 180); // NEW
    assert.equal(role.geometry.alternateBounds.height, 64); // NEW
    assert.equal(imageRow.value, "click to add image"); // NEW
    assert.equal(imageRow.geometry.y, 76); // NEW
    assert.equal(nameRow.geometry.y, 76); // NEW
    assert.equal(titleRow.geometry.y, 118); // NEW
    assert.equal(styleHas(nameRow, "role_name=1"), true); // NEW
    assert.equal(styleHas(titleRow, "role_title=1"), true); // NEW
    assert.equal(nameRow.value, ""); // NEW
    assert.equal(titleRow.value, ""); // NEW
    assert.deepEqual(fieldLabels.map(cell => cell.value), ["Photo", "Name", "Role / title", "Description / notes", "Contact info"]); // NEW
    assert.equal(fieldLabels.every(cell => /(?:^|;)editable=0(?:;|$)/.test(cell.style)), true); // NEW
    assert.doesNotMatch(String(role.value), /<img/i); // NEW
    assert.match(role.style, /(?:^|;)image=data:image\/svg\+xml,/); // NEW
    assert.match(role.style, /(?:^|;)imageWidth=38(?:;|$)/); // NEW
    assert.match(role.style, /(?:^|;)imageHeight=38(?:;|$)/); // NEW
    assert.match(role.style, /(?:^|;)imageAlign=left(?:;|$)/); // NEW
}); // CHANGE

test("v2 role card summary syncs name and role without prefixing value fields", () => { // NEW
    const harness = makeHarness(); // NEW
    const { role, nameRow, titleRow } = createRoleFixture(harness); // NEW
    assert.match(String(role.value), /Unnamed person/); // NEW
    assert.match(String(role.value), /Unspecified role/); // NEW
    harness.model.setValue(nameRow, "Bob"); // NEW
    harness.model.setValue(titleRow, "Lead gardener"); // NEW
    harness.model.fire("change"); // NEW
    assert.match(String(role.value), /Bob/); // NEW
    assert.match(String(role.value), /Lead gardener/); // NEW
    assert.equal(nameRow.value, "Bob"); // NEW
    assert.equal(titleRow.value, "Lead gardener"); // NEW
    assert.doesNotMatch(String(nameRow.value), /^Name:/); // NEW
    assert.doesNotMatch(String(titleRow.value), /^Role/); // NEW
}); // NEW

test("legacy role cards are not rewritten by summary sync", () => { // NEW
    const harness = makeHarness(); // NEW
    const team = harness.graph.__trellisModules.createModuleAtPoint({ x: 50, y: 60 }, "team"); // NEW
    const role = new TestCell("Legacy Role", new TestGeometry(10, 20, 240, 160), "shape=swimlane;role_card=1;"); // NEW
    role.vertex = true; // NEW
    harness.model.add(team, role); // NEW
    const name = new TestCell("Legacy Name", new TestGeometry(0, 0, 100, 30), "role_name=1;"); // NEW
    name.vertex = true; // NEW
    harness.model.add(role, name); // NEW
    harness.model.fire("change"); // NEW
    assert.equal(role.value, "Legacy Role"); // NEW
}); // NEW

test("empty role image slot shows add affordances for role card and image row only", () => { // NEW
    const harness = makeHarness(); // NEW
    const { role, imageRow, nameRow } = createRoleFixture(harness); // NEW
    harness.graph.setSelectionCell(role); // NEW
    assert.equal(roleImageOverlayButtons(harness.document)[0].textContent, "Add Image"); // NEW
    assert.equal(isRoleImageOverlayVisible(harness.document), true); // NEW
    harness.graph.setSelectionCell(imageRow); // NEW
    assert.equal(roleImageOverlayButtons(harness.document)[0].textContent, "Add Image"); // NEW
    assert.equal(isRoleImageOverlayVisible(harness.document), true); // NEW
    harness.graph.setSelectionCell(nameRow); // NEW
    assert.equal(isRoleImageOverlayVisible(harness.document), false); // NEW
    assert.equal(runModulesContextMenu(harness, role).labels.includes("Add Role Image"), true); // NEW
    assert.equal(runModulesContextMenu(harness, imageRow).labels.includes("Add Role Image"), true); // NEW
    assert.equal(runModulesContextMenu(harness, nameRow).labels.includes("Add Role Image"), false); // NEW
}); // NEW

test("existing role image shows change overlay from image section or avatar only", async () => { // CHANGE
    const harness = makeHarness(); // NEW
    const { role, imageRow } = createRoleFixture(harness); // NEW
    harness.graph.__trellisModules.selectRoleImage(role); // NEW
    await waitForTimers(); // NEW
    const avatar = getRoleAvatar(imageRow); // NEW
    assert.ok(avatar); // NEW
    harness.graph.setSelectionCell(role); // NEW
    assert.equal(isRoleImageOverlayVisible(harness.document), false); // NEW
    harness.graph.setSelectionCell(imageRow); // NEW
    assert.equal(roleImageOverlayButtons(harness.document)[0].textContent, "Change Image"); // CHANGE
    assert.equal(isRoleImageOverlayVisible(harness.document), true); // CHANGE
    harness.graph.setSelectionCell(avatar); // NEW
    assert.equal(roleImageOverlayButtons(harness.document)[0].textContent, "Change Image"); // NEW
    assert.equal(isRoleImageOverlayVisible(harness.document), true); // NEW
    assert.equal(runModulesContextMenu(harness, role).labels.includes("Change Role Image"), false); // NEW
    assert.equal(runModulesContextMenu(harness, imageRow).labels.includes("Change Role Image"), false); // NEW
    assert.equal(runModulesContextMenu(harness, avatar).labels.includes("Change Role Image"), true); // NEW
}); // NEW

test("role image overlay button invokes insert image and creates the avatar", async () => { // NEW
    const harness = makeHarness(); // NEW
    const { role, imageRow } = createRoleFixture(harness); // NEW
    harness.graph.setSelectionCell(role); // NEW
    roleImageOverlayButtons(harness.document)[0].dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true })); // NEW
    await waitForTimers(); // NEW
    const avatar = getRoleAvatar(imageRow); // NEW
    assert.equal(harness.insertImageCalls, 1); // NEW
    assert.ok(avatar); // NEW
    assert.equal(avatar.parent, imageRow); // NEW
    assert.equal(avatar.geometry.width, 40); // CHANGE
    assert.equal(avatar.geometry.height, 40); // CHANGE
    assert.equal(avatar.geometry.x, 5); // NEW
    assert.equal(avatar.geometry.y, 5); // NEW
    assert.equal(imageRow.value, ""); // NEW
    assert.doesNotMatch(String(role.value), /<img/i); // CHANGE
    assert.match(role.style, /(?:^|;)image=data:image\/png;base64,test(?:;|$)/); // CHANGE
    assert.match(role.style, /(?:^|;)imageWidth=38(?:;|$)/); // NEW
}); // NEW

test("inserted role image replaces any prior avatar", async () => { // NEW
    const harness = makeHarness(); // NEW
    const { role, imageRow } = createRoleFixture(harness); // NEW
    harness.graph.__trellisModules.selectRoleImage(role); // NEW
    await waitForTimers(); // NEW
    const firstAvatar = getRoleAvatar(imageRow); // NEW
    assert.ok(firstAvatar); // NEW
    harness.graph.__trellisModules.selectRoleImage(role); // NEW
    await waitForTimers(); // NEW
    const avatars = imageRow.children.filter(child => styleHas(child, "role_avatar=1")); // NEW
    assert.equal(avatars.length, 1); // NEW
    assert.notEqual(avatars[0], firstAvatar); // NEW
    assert.equal(firstAvatar.parent, null); // NEW
    assert.equal(avatars[0].geometry.width, 40); // CHANGE
    assert.equal(avatars[0].geometry.height, 40); // CHANGE
    assert.match(role.style, /(?:^|;)image=data:image\/png;base64,test(?:;|$)/); // NEW
    assert.doesNotMatch(String(role.value), /<img/i); // NEW
}); // NEW
