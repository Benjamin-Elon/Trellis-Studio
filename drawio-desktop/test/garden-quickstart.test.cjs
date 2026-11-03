/** Quickstart exercises real DOM, local preferences, and committed-state transitions. */ // NEW
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins/Garden_Quickstart.js'), 'utf8');
const homes = new Set();
test.afterEach(() => { for (const dom of homes) dom.window.close(); homes.clear(); });

function emitter() { // NEW
    const events = new Map();
    return { addListener(name, fn) { if (!events.has(name)) events.set(name, []); events.get(name).push(fn); }, removeListener(fn) { for (const handlers of events.values()) { const index = handlers.indexOf(fn); if (index >= 0) handlers.splice(index, 1); } }, emit(name) { for (const fn of events.get(name) || []) fn(); } };
}
function fixture(options = {}) { // NEW
    const dom = new JSDOM('<!doctype html><html><head></head><body><div id="graph"></div></body></html>', { url: 'https://trellis.test', runScripts: 'outside-only' }); homes.add(dom);
    const w = dom.window, timers = new Map(); let timerId = 0;
    w.setTimeout = fn => { timers.set(++timerId, fn); return timerId; }; w.clearTimeout = id => timers.delete(id);
    for (const [key, value] of Object.entries(options.storage || {})) w.localStorage.setItem(key, value);
    const cell = (id, attrs = {}, parent = null) => {
        const value = w.document.createElement('object'); for (const [key, val] of Object.entries(attrs)) value.setAttribute(key, val);
        const result = { id, value, parent, children: [], geometry: { width: 100, height: 100 }, getAttribute: key => value.getAttribute(key) };
        if (parent) parent.children.push(result); return result;
    };
    const parent = cell('1', { trellis_users_diagram_id: 'diagram-a' });
    const attrs = { garden_module: '1', garden_name: 'Apple garden', city_id: '1', unit_system: 'metric', default_bed_width_cm: '80', default_bed_length_cm: '300' };
    const garden = options.empty ? null : cell('garden-a', attrs, parent);
    const model = Object.assign(emitter(), { getChildren: cell => cell.children, getParent: cell => cell.parent, getCell(id) { const find = node => node.id === id ? node : node.children.map(find).find(Boolean); return find(parent); } });
    let selection = null, enabled = true, currentFile = { getTitle: () => 'Apple project', fileObject: { path: 'apple.drawio' } }, user = { id: 'u1', portableIdentityId: 'alice' };
    const selectionModel = emitter(), view = Object.assign(emitter(), { getState: cell => ({ cell }) });
    const graph = { container: w.document.querySelector('#graph'), getModel: () => model, getDefaultParent: () => parent, getSelectionModel: () => selectionModel, getSelectionCell: () => selection, view, isEnabled: () => enabled, scrollCellToVisible() {}, __trellisUsers: { getCurrentUser: () => user, isLoggedIn: () => !!user, canEditCell: () => enabled, listPendingInvites: () => [] } };
    const actions = new Map(), editor = Object.assign(emitter(), { graph });
    const ui = { editor, getCurrentFile: () => currentFile, actions: { addAction(name, funct) { const action = { funct }; actions.set(name, action); return action; }, get: name => actions.get(name) }, menus: { get: () => null }, addListener() {} };
    let highlighted = null, plan = null;
    w.mxCellHighlight = class { highlight(state) { highlighted = state.cell; } destroy() { highlighted = null; } };
    w.Draw = { loadPlugin: fn => fn(ui) }; w.__TRELLIS_QUICKSTART_TEST__ = true;
    w.USL = { planningCore: { loadPlanForYear: () => plan } };
    w.mxClient = { IS_POINTER: options.pointer !== false, IS_TOUCH: !!options.touch }; // NEW: exercise native gesture registration rather than a drag-specific mock.
    w.eval(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/mxgraph/src/util/mxEvent.js'), 'utf8')); // NEW
    w.Editor = { moveImage: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==' }; // NEW
    w.eval(source);
    const api = graph.__trellisQuickstart;
    async function flush() { for (let n = 0; n < 20; n++) { await Promise.resolve(); if (!timers.size) return; const work = [...timers.values()]; timers.clear(); work.forEach(fn => fn()); } throw new Error('Quickstart render did not settle'); }
    const press = text => { const button = [...w.document.querySelectorAll('.trellis-quickstart-card button')].find(node => node.textContent === text); assert.ok(button, 'Missing guide button: ' + text); button.click(); };
    const choose = (label, value) => { const input = w.document.querySelector('.trellis-quickstart-card select[aria-label="' + label + '"]'); assert.ok(input, label); input.value = value; input.dispatchEvent(new w.Event('change')); };
    const target = (name, tag = 'button', host = w.document.body) => { const node = w.document.createElement(tag); node.setAttribute('data-trellis-quickstart', name); host.appendChild(node); return node; };
    return { dom, w, ui, graph, model, garden, parent, cell, api, flush, press, choose, target, highlighted: () => highlighted, state: () => api.getState(), text: () => w.document.querySelector('.trellis-quickstart-card')?.textContent || '', select(value) { selection = value; selectionModel.emit('change'); }, user(value) { user = value; w.dispatchEvent(new w.Event('trellisUsersSessionChanged')); }, enabled(value) { enabled = value; }, open() { editor.emit('fileLoaded'); }, plan(value) { plan = value; model.emit('change'); }, file(value) { currentFile = value; editor.emit('fileLoaded'); } };
}
function samplePlan(year) { return { year, crops: [{ id: 'crop', method: 'direct', kgPerPlant: 1 }], selfSufficiency: { enabled: true, lines: [{ cropId: 'crop', qty: 1, from: year + '-05-01', to: year + '-06-01' }] }, demands: [] }; } // NEW
async function start(f) { await f.flush(); f.press('Start / Resume'); await f.flush(); } // NEW
async function stage(f, key) { f.w.document.querySelector('[data-quickstart-focus="' + key + '"]').click(); await f.flush(); } // NEW

/** A semantic planner fixture includes hidden lines, matching the production view contract. */ // NEW
async function planner(f) { // NEW
    await start(f); await stage(f, 'plan'); // NEW
    const workflow = companionWorkflow(f, 'plan', { left: 200, top: 50, width: 700, height: 600 }), node = workflow.node; // NEW
    Object.assign(node.dataset, { quickstartGarden: f.garden.id, quickstartYear: String(f.state().progress.year), quickstartSession: 'session-one', quickstartCrop: 'crop-one' }); // NEW
    const lines = { self: [{ id: 'self-one', cropId: 'crop-one' }, { id: 'self-two', cropId: 'crop-one' }, { id: 'self-other', cropId: 'crop-two' }], sales: [{ id: 'sales-one', cropId: 'crop-one', channelId: 'shop' }] }; // NEW
    const shown = []; node.__trellisQuickstartView = { getDemandLines: route => lines[route], showFields: (...args) => shown.push(args) }; // NEW
    function field(name, data = {}) { const input = f.w.document.createElement('input'); input.dataset.yearPlanField = name; Object.assign(input.dataset, data); node.appendChild(input); return input; } // NEW
    const variety = field('varietyId', { cropId: 'crop-one' }), method = field('method', { cropId: 'crop-one' }), other = field('method', { cropId: 'crop-two' }); // NEW
    const source = field('harvestWindowSource', { cropId: 'crop-one' }), from = field('harvestStart', { cropId: 'crop-one' }), to = field('harvestEnd', { cropId: 'crop-one' }); // NEW
    for (const route of ['self', 'sales']) for (const line of lines[route]) for (const name of ['cropId', 'qty', 'unit', 'frequency', 'from', 'to']) { const input = field(name, { [route === 'self' ? 'yearPlanSelfLineId' : 'yearPlanDemandLineId']: line.id }); input.value = name === 'cropId' ? line.cropId : '1'; } // NEW
    f.target('plan-year', 'input', node); f.target('plan-add-crops', 'button', node); f.target('plan-review', 'section', node); f.target('plan-save', 'button', node); // NEW
    await f.flush(); // NEW
    return { node, lines, shown, variety, method, other, source, from, to, group: async name => { f.state().progress.positions.planGroup = name; f.api.refresh(); await f.flush(); } }; // NEW
} // NEW

/** Rectangle fixtures model dialog movement while retaining production ownership, persistence, and input. */ // CHANGE
function companionWorkflow(f, kind, initial, host = f.w.document.body) { // CHANGE
    const node = f.w.document.createElement('div'); node.dataset.quickstartSurface = kind; node.style.cssText = 'position:fixed;z-index:2000000000'; // CHANGE
    let rect = initial; node.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height }); host.appendChild(node); // CHANGE
    return { node, move(next) { rect = { ...rect, ...next }; f.api.refresh(); } }; // CHANGE
} // CHANGE

test('companions choose right, then left, then a bounded overlay without stretching or saving automatic positions', async () => { // CHANGE
    const f = fixture(); await start(f); const view = floatingCard(f); // CHANGE
    const workflow = companionWorkflow(f, 'settings', { left: 250, top: 90, width: 400, height: 500 }); await f.flush(); // CHANGE
    assert.deepEqual(view.position(), { x: 662, y: 90 }); assert.equal(view.card.style.width, '310px'); // CHANGE
    workflow.move({ left: 600 }); await f.flush(); assert.deepEqual(view.position(), { x: 278, y: 90 }); // CHANGE
    f.w.innerWidth = 500; workflow.move({ left: 20, width: 460 }); await f.flush(); // CHANGE
    const overlay = view.position(); assert.ok(overlay.x >= 8 && overlay.x + 310 <= 492 && overlay.y >= 8); // CHANGE
    assert.equal(Object.keys(f.state().preferences.workflowPositions).length, 0); // CHANGE
    f.press('Collapse'); await f.flush(); assert.equal(view.handle.hidden, false); assert.equal(f.w.getComputedStyle(view.card.querySelector('header')).flex, '0 0 auto'); // CHANGE
    f.w.innerWidth = 260; f.w.dispatchEvent(new f.w.Event('resize')); await f.flush(); assert.equal(view.position().x, 8); // CHANGE
}); // CHANGE

test('workflow offsets follow the full native frame, survive reloads, and remain independent of canvas and pickers', async () => { // CHANGE
    const f = fixture(); await start(f); const view = floatingCard(f); // CHANGE
    view.handle.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); const canvas = view.position(); // CHANGE
    const frame = companionWorkflow(f, 'settings', { left: 200, top: 50, width: 350, height: 400 }); f.ui.dialog = { container: frame.node }; // CHANGE
    const content = f.w.document.createElement('div'); content.dataset.quickstartSurface = 'settings'; frame.node.removeAttribute('data-quickstart-surface'); frame.node.appendChild(content); await f.flush(); // CHANGE
    assert.deepEqual(view.position(), { x: 562, y: 50 }); // CHANGE
    mouse(f, view.handle, 'pointerdown', 570, 60); mouse(f, f.w.document, 'pointerup', 600, 100); await f.flush(); // CHANGE
    const preferred = { ...f.state().preferences.workflowPositions.settings }; assert.deepEqual(preferred, { x: 392, y: 40 }); // CHANGE
    frame.move({ left: 230, top: 70 }); await f.flush(); assert.deepEqual(view.position(), { x: 622, y: 110 }); // CHANGE
    const picker = companionWorkflow(f, 'crop-picker', { left: 260, top: 100, width: 300, height: 300 }, frame.node); picker.node.setAttribute('role', 'dialog'); await f.flush(); // CHANGE
    assert.equal(f.api.getCompanion(content), null); assert.equal(f.api.getCompanion(frame.node), view.card); // CHANGE
    view.handle.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await f.flush(); // CHANGE
    assert.deepEqual({ ...f.state().preferences.workflowPositions.settings }, preferred); assert.ok(f.state().preferences.workflowPositions['crop-picker']); // CHANGE
    picker.node.remove(); await f.flush(); assert.deepEqual(view.position(), { x: 622, y: 110 }); // CHANGE
    f.w.innerWidth = 700; f.w.dispatchEvent(new f.w.Event('resize')); await f.flush(); assert.ok(view.position().x <= 382); // CHANGE
    f.w.innerWidth = 1024; f.w.dispatchEvent(new f.w.Event('resize')); await f.flush(); assert.deepEqual(view.position(), { x: 622, y: 110 }); // CHANGE
    const storage = Object.fromEntries(Object.keys(f.w.localStorage).map(key => [key, f.w.localStorage.getItem(key)])); // CHANGE
    frame.node.remove(); f.ui.dialog = null; await f.flush(); assert.deepEqual(view.position(), canvas); // CHANGE
    const restored = fixture({ storage }); await start(restored); const next = floatingCard(restored); companionWorkflow(restored, 'settings', { left: 230, top: 70, width: 350, height: 400 }); await restored.flush(); // CHANGE
    assert.deepEqual(next.position(), { x: 622, y: 110 }); // CHANGE
}); // CHANGE

test('highlight avoidance temporarily overrides a saved offset and malformed offsets fall back to placement', async () => { // CHANGE
    const f = fixture(); await start(f); const view = floatingCard(f); // CHANGE
    const workflow = companionWorkflow(f, 'settings', { left: 150, top: 70, width: 400, height: 450 }); // CHANGE
    const name = f.target('settings-name', 'input', workflow.node); let targetRect = { left: 750, top: 500, width: 80, height: 20 }; // CHANGE
    name.getBoundingClientRect = () => ({ ...targetRect, right: targetRect.left + targetRect.width, bottom: targetRect.top + targetRect.height }); // CHANGE
    f.state().preferences.workflowPositions.settings = { x: 412, y: 0 }; await f.flush(); assert.deepEqual(view.position(), { x: 562, y: 70 }); // CHANGE
    targetRect = { left: 580, top: 90, width: 80, height: 20 }; f.api.refresh(); await f.flush(); assert.notDeepEqual(view.position(), { x: 562, y: 70 }); // CHANGE
    assert.deepEqual(f.state().preferences.workflowPositions.settings, { x: 412, y: 0 }); // CHANGE
    targetRect = { left: 750, top: 500, width: 80, height: 20 }; f.api.refresh(); await f.flush(); assert.deepEqual(view.position(), { x: 562, y: 70 }); // CHANGE
    f.state().preferences.workflowPositions.settings = { x: 'invalid', y: null }; f.api.refresh(); await f.flush(); assert.deepEqual(view.position(), { x: 562, y: 70 }); // CHANGE
}); // CHANGE

test('newer native modals outrank nested workflow layers and owner removal cancels active gestures', async () => { // CHANGE
    const f = fixture(); await start(f); const view = floatingCard(f); // CHANGE
    const workflow = companionWorkflow(f, 'plan', { left: 100, top: 40, width: 450, height: 450 }); // CHANGE
    const picker = companionWorkflow(f, 'crop-picker', { left: 120, top: 60, width: 400, height: 300 }, workflow.node); picker.node.style.zIndex = '2147483647'; await f.flush(); // CHANGE
    const modal = f.w.document.createElement('div'); modal.style.cssText = 'position:fixed;z-index:2000000001'; f.w.document.body.appendChild(modal); f.ui.dialog = { container: modal }; // CHANGE
    assert.equal(f.api.getCompanion(picker.node), null, 'ownership checks must reject stale companions before render'); await f.flush(); // CHANGE
    assert.equal(f.api.getCompanion(modal), view.card); assert.equal(f.w.getComputedStyle(view.card).zIndex, '2000000001'); // CHANGE
    mouse(f, view.handle, 'pointerdown', 20, 20); mouse(f, f.w.document, 'pointermove', 100, 100); // CHANGE
    modal.remove(); f.ui.dialog = null; await f.flush(); assert.equal((f.w.document.mxListenerList || []).length, 0); assert.equal(f.api.getCompanion(picker.node), view.card); // CHANGE
    let dismissed = 0; f.w.addEventListener('keydown', () => dismissed++, true); const origin = view.position(); // CHANGE
    mouse(f, view.handle, 'pointerdown', 20, 20); mouse(f, f.w.document, 'pointermove', 40, 40); // CHANGE
    f.w.document.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await f.flush(); // CHANGE
    assert.equal(dismissed, 0); assert.deepEqual(view.position(), origin); // CHANGE
}); // CHANGE

/** Supply layout measurements only; input still passes through the real mxEvent implementation. */ // NEW
function floatingCard(f) { // NEW
    const card = f.w.document.querySelector('.trellis-quickstart-card'); // NEW
    card.getBoundingClientRect = () => { // NEW
        const left = parseFloat(card.style.left) || 0, top = parseFloat(card.style.top) || 0; // NEW
        const width = Math.min(310, f.w.innerWidth - 16), height = Math.min(180, f.w.innerHeight - 24); // NEW
        return { left, top, width, height, right: left + width, bottom: top + height }; // NEW
    }; // NEW
    return { card, handle: card.querySelector('[data-trellis-quickstart-drag-handle]'), position: () => ({ x: parseFloat(card.style.left), y: parseFloat(card.style.top) }) }; // NEW
} // NEW
function mouse(f, node, type, x, y, button = 0) { // NEW
    const event = new f.w.MouseEvent(type, { clientX: x, clientY: y, button, bubbles: true, cancelable: true }); // NEW
    node.dispatchEvent(event); return event; // NEW
} // NEW

test('module-style handle moves on both axes outside the handle and survives refresh without graph changes', async () => { // NEW
    const f = fixture(); await start(f); const { card, handle, position } = floatingCard(f); // NEW
    assert.equal(handle.getAttribute('aria-label'), 'Move Quickstart'); assert.equal(handle.querySelector('img').src, f.w.Editor.moveImage); // NEW
    assert.equal(f.w.getComputedStyle(handle).width, '18px'); assert.equal(card.querySelector('strong').hasAttribute('tabindex'), false); // NEW
    const origin = position(), graphBefore = JSON.stringify(f.garden.geometry), stored = JSON.stringify(f.state().preferences.position); // NEW
    const body = card.lastElementChild; // NEW
    assert.equal(mouse(f, handle, 'pointerdown', 20, 105).defaultPrevented, true); // NEW
    mouse(f, f.w.document, 'pointermove', 100, 160); f.api.refresh(); await f.flush(); // NEW
    assert.deepEqual(position(), { x: origin.x + 80, y: origin.y + 55 }); assert.equal(card.lastElementChild, body); // NEW
    assert.equal(JSON.stringify(f.state().preferences.position), stored, 'an unfinished drag must not save its position'); // NEW
    mouse(f, f.w.document, 'pointerup', 110, 170); await f.flush(); f.api.refresh(); await f.flush(); // NEW
    assert.deepEqual(position(), { x: origin.x + 90, y: origin.y + 65 }); // NEW
    assert.equal((f.w.document.mxListenerList || []).length, 0); assert.equal(f.graph.getSelectionCell(), null); assert.equal(JSON.stringify(f.garden.geometry), graphBefore); // NEW
    const storage = Object.fromEntries(Object.keys(f.w.localStorage).map(key => [key, f.w.localStorage.getItem(key)])); // NEW
    const restored = fixture({ storage }); await start(restored); assert.deepEqual(floatingCard(restored).position(), position()); // NEW
}); // NEW

test('title, card controls, and secondary mouse buttons do not start dragging', async () => { // NEW
    const f = fixture(); await start(f); const { card, handle, position } = floatingCard(f), before = position(); // NEW
    for (const [node, button] of [[card.querySelector('strong'), 0], [card.querySelector('select'), 0], [handle, 2]]) { // NEW
        mouse(f, node, 'pointerdown', 20, 105, button); mouse(f, f.w.document, 'pointermove', 200, 200); mouse(f, f.w.document, 'pointerup', 200, 200, button); // NEW
        assert.deepEqual(position(), before); assert.equal((f.w.document.mxListenerList || []).length, 0); // NEW
    } // NEW
}); // NEW

test('interrupted drags restore the start, release listeners, and permit a subsequent drag', async () => { // NEW
    for (const interruption of ['Escape', 'blur', 'pointercancel', 'touchcancel', 'close', 'removed', 'year', 'identity', 'file']) { // NEW
        const f = fixture(); await start(f); let view = floatingCard(f); // NEW
        view.handle.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); // NEW
        const before = view.position(), saved = JSON.stringify(f.state().preferences.position); // NEW
        mouse(f, view.handle, 'pointerdown', 40, 105); mouse(f, f.w.document, 'pointermove', 140, 205); // NEW
        if (interruption === 'Escape') f.w.document.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); // NEW
        else if (interruption === 'blur') f.w.dispatchEvent(new f.w.Event('blur')); // NEW
        else if (interruption === 'close') f.api.close(); // NEW
        else if (interruption === 'removed') { view.card.remove(); f.api.refresh(); await f.flush(); } // NEW
        else if (interruption === 'year') f.choose('Year', String(f.state().progress.year + 1)); // NEW
        else if (interruption === 'identity') f.user({ id: 'u2', portableIdentityId: 'bob' }); // NEW
        else if (interruption === 'file') f.open(); // NEW
        else f.w.document.dispatchEvent(new f.w.Event(interruption, { bubbles: true })); // NEW
        assert.deepEqual(view.position(), before, interruption); assert.equal((f.w.document.mxListenerList || []).length, 0, interruption); // NEW
        if (interruption !== 'identity') assert.equal(JSON.stringify(f.state().preferences.position), saved, interruption); // NEW
        mouse(f, f.w.document, 'pointermove', 300, 300); assert.deepEqual(view.position(), before, interruption); // NEW
        if (!view.card.isConnected || f.state().offering) { f.api.show(); await f.flush(); view = floatingCard(f); } // NEW
        mouse(f, view.handle, 'pointerdown', 40, 105); mouse(f, f.w.document, 'pointerup', 60, 125); await f.flush(); // NEW
        assert.equal(view.card.classList.contains('trellis-quickstart-dragging'), false, interruption); // NEW
    } // NEW
}); // NEW

test('a modal cancels a drag, retains its handle, and restores canvas offsets on return', async () => { // CHANGE
    const f = fixture(); await start(f); const { card, handle, position } = floatingCard(f), before = position(), saved = JSON.stringify(f.state().preferences.position); // CHANGE
    mouse(f, handle, 'pointerdown', 20, 105); mouse(f, f.w.document, 'pointermove', 100, 150); // NEW
    const modal = f.w.document.createElement('div'); modal.style.cssText = 'position:fixed;z-index:2000000001'; f.w.document.body.appendChild(modal); f.ui.dialog = { container: modal }; await f.flush(); // CHANGE
    assert.equal(f.w.getComputedStyle(card).zIndex, '2000000001'); assert.equal(f.api.getCompanion(modal), card); // CHANGE
    assert.equal(handle.hidden, false); assert.equal(card.style.position, 'fixed'); assert.equal(card.style.width, '310px'); // CHANGE
    assert.equal((f.w.document.mxListenerList || []).length, 0); assert.equal(JSON.stringify(f.state().preferences.position), saved); // CHANGE
    handle.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); assert.ok(f.state().preferences.workflowPositions.dialog); // CHANGE
    f.ui.dialog = null; f.api.refresh(); await f.flush(); assert.equal(handle.hidden, false); assert.equal(card.style.position, 'fixed'); assert.deepEqual(position(), before); // NEW
    assert.equal(f.w.getComputedStyle(card).zIndex, '10020'); // CHANGE: undocking restores the control contract.
}); // NEW

test('floating offers and recreated cards use the standard control layer', async () => { // CHANGE
    const f = fixture(); await f.flush(); // CHANGE
    assert.equal(f.w.getComputedStyle(f.w.document.querySelector('.trellis-quickstart-card')).zIndex, '10020'); // CHANGE
    f.press('Start / Resume'); await f.flush(); // CHANGE
    const { card, handle, position } = floatingCard(f); // CHANGE
    handle.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); // CHANGE
    const before = position(), saved = JSON.stringify(f.state().preferences.position); // CHANGE
    card.remove(); f.api.refresh(); await f.flush(); // CHANGE
    const recreated = floatingCard(f); // CHANGE
    assert.notEqual(recreated.card, card); assert.equal(recreated.card.parentNode, f.w.document.body); // CHANGE
    assert.equal(f.w.getComputedStyle(recreated.card).zIndex, '10020'); assert.deepEqual(recreated.position(), before); // CHANGE
    assert.equal(JSON.stringify(f.state().preferences.position), saved); // CHANGE
}); // CHANGE

test('nested picker companions and removed workflows restore ownership and the canvas layer', async () => { // CHANGE
    const f = fixture(); await start(f); // CHANGE
    const { handle, position } = floatingCard(f); // CHANGE
    handle.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); // CHANGE
    const before = position(), saved = JSON.stringify(f.state().preferences.position); // CHANGE
    const modal = f.w.document.createElement('div'); modal.dataset.quickstartSurface = 'plan'; modal.style.zIndex = '2000000000'; // CHANGE
    f.w.document.body.appendChild(modal); f.ui.dialog = { container: modal }; await f.flush(); // CHANGE
    let card = f.w.document.querySelector('.trellis-quickstart-card'); // CHANGE
    assert.equal(card.parentNode, f.w.document.body); assert.equal(f.w.getComputedStyle(card).zIndex, '2000000000'); assert.equal(f.api.getCompanion(modal), card); // CHANGE
    const layer = f.w.document.createElement('div'); layer.style.zIndex = '5'; modal.appendChild(layer); // CHANGE
    const picker = f.w.document.createElement('div'); picker.dataset.quickstartSurface = 'crop-picker'; layer.appendChild(picker); await f.flush(); // CHANGE
    assert.equal(card.parentNode, f.w.document.body); assert.equal(f.w.getComputedStyle(card).zIndex, '2000000000'); assert.equal(f.api.getCompanion(picker), card); // CHANGE
    assert.equal(card.querySelector('[data-trellis-quickstart-drag-handle]').hidden, false); // CHANGE
    layer.remove(); await f.flush(); card = f.w.document.querySelector('.trellis-quickstart-card'); // CHANGE
    assert.equal(card.parentNode, f.w.document.body); assert.equal(f.w.getComputedStyle(card).zIndex, '2000000000'); assert.equal(f.api.getCompanion(picker), null); assert.equal(f.api.getCompanion(modal), card); // CHANGE
    modal.remove(); f.ui.dialog = null; f.api.refresh(); await f.flush(); // CHANGE
    const floating = floatingCard(f); // CHANGE
    assert.equal(floating.card.parentNode, f.w.document.body); assert.equal(f.w.getComputedStyle(floating.card).zIndex, '10020'); // CHANGE
    assert.equal(floating.handle.hidden, false); assert.deepEqual(floating.position(), before); // CHANGE
    assert.equal(JSON.stringify(f.state().preferences.position), saved); assert.equal((f.w.document.mxListenerList || []).length, 0); // CHANGE
}); // CHANGE

test('mouse fallback, keyboard movement, and resizing keep persisted coordinates within the viewport', async () => { // NEW
    const f = fixture({ pointer: false }); await start(f); const { handle, position } = floatingCard(f); // NEW
    mouse(f, handle, 'mousedown', 20, 105); mouse(f, f.w.document, 'mouseup', 5000, 5000); await f.flush(); // NEW
    assert.deepEqual(position(), { x: f.w.innerWidth - 318, y: f.w.innerHeight - 188 }); // NEW
    assert.equal(f.state().preferences.position.x, position().x); assert.equal(f.state().preferences.position.y, position().y); // NEW
    f.w.innerWidth = 260; f.w.innerHeight = 220; f.w.dispatchEvent(new f.w.Event('resize')); await f.flush(); // NEW
    assert.deepEqual(position(), { x: 8, y: 32 }); // NEW
    handle.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })); assert.deepEqual(position(), { x: 8, y: 16 }); // NEW
    assert.equal(f.state().preferences.position.y, 16); // NEW
}); // NEW

test('legacy touch gestures follow document movement and commit on touch end', async () => { // NEW
    const f = fixture({ pointer: false, touch: true }); await start(f); const { handle, position } = floatingCard(f), before = position(); // NEW
    const touch = (node, type, clientX, clientY) => { // NEW
        const event = new f.w.Event(type, { bubbles: true, cancelable: true }), point = { clientX, clientY, identifier: 1 }; // NEW
        Object.defineProperties(event, { touches: { value: type === 'touchend' ? [] : [point] }, changedTouches: { value: [point] } }); node.dispatchEvent(event); // NEW
    }; // NEW
    touch(handle, 'touchstart', 20, 105); touch(f.w.document, 'touchmove', 60, 155); touch(f.w.document, 'touchend', 70, 170); await f.flush(); // NEW
    assert.deepEqual(position(), { x: before.x + 50, y: before.y + 65 }); assert.equal((f.w.document.mxListenerList || []).length, 0); // NEW
}); // NEW

test('manual drops survive target overlap until the guidance target changes', async () => { // NEW
    const f = fixture(); await start(f); f.select(f.garden); const target = f.target('add-bed'); // NEW
    const box = () => ({ left: 400, top: 150, right: 460, bottom: 180, width: 60, height: 30 }); target.getBoundingClientRect = box; // NEW
    await stage(f, 'layout'); const { handle, position } = floatingCard(f); // NEW
    mouse(f, handle, 'pointerdown', 20, 105); mouse(f, f.w.document, 'pointerup', 420, 155); await f.flush(); // NEW
    const manual = position(); f.api.refresh(); await f.flush(); assert.deepEqual(position(), manual); // NEW
    target.remove(); const replacement = f.target('add-bed'); replacement.getBoundingClientRect = box; await f.flush(); // NEW
    assert.notDeepEqual(position(), manual, 'a new target may reposition the card to keep the control clear'); // NEW
}); // NEW

test('automatic canvas avoidance does not replace the preferred position and clears when the target disappears', async () => { // CHANGE
    const f = fixture(); await start(f); f.select(f.garden); const view = floatingCard(f); // CHANGE
    view.handle.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); const preferred = view.position(); // CHANGE
    const target = f.target('add-bed'); target.getBoundingClientRect = () => ({ left: 16, top: 116, right: 96, bottom: 136, width: 80, height: 20 }); await stage(f, 'layout'); // CHANGE
    assert.notDeepEqual(view.position(), preferred); assert.deepEqual({ ...f.state().preferences.position }, preferred); // CHANGE
    f.api.refresh(); await f.flush(); assert.notDeepEqual(view.position(), preferred); // CHANGE
    target.remove(); await f.flush(); assert.deepEqual(view.position(), preferred); // CHANGE
}); // CHANGE

test('layout explicitly requests the intended garden selection and never changes it silently', async () => { // NEW
    const f = fixture(); await start(f); await stage(f, 'layout');
    assert.match(f.text(), /Select Apple garden to show its layout controls/); assert.equal(f.graph.getSelectionCell(), null); assert.equal(f.highlighted(), f.garden);
    const other = f.cell('other', { garden_module: '1', garden_name: 'Other garden' }, f.parent); f.select(other); await f.flush();
    assert.match(f.text(), /Select Apple garden/); assert.equal(f.graph.getSelectionCell(), other);
    const add = f.target('add-bed'); f.select(f.garden); await f.flush();
    assert.ok(add.classList.contains('trellis-quickstart-target')); assert.match(f.text(), /Choose Add Garden Bed/);
});

test('layout recovers from no garden, missing settings, hidden controls, active modes, and read-only access', async () => { // NEW
    const empty = fixture({ empty: true }); await start(empty); await stage(empty, 'layout'); assert.match(empty.text(), /Create a garden first/); assert.match(empty.text(), /Open Garden Projects/);
    const f = fixture(); await start(f); f.select(f.garden); f.garden.value.removeAttribute('city_id'); await stage(f, 'layout'); assert.match(f.text(), /Finish Garden Settings first/);
    f.garden.value.setAttribute('city_id', '1'); f.select(f.garden); const add = f.target('add-bed'); add.hidden = true; await f.flush(); assert.match(f.text(), /control is hidden/);
    let mode = { mode: 'irrigation' }; f.w.Trellis.interactionModes = { getActive: () => mode, closeActive: () => { mode = null; } }; f.api.refresh(); await f.flush(); assert.match(f.text(), /Close irrigation mode/);
    f.press('Close active mode'); await f.flush(); add.hidden = false; await f.flush(); assert.ok(add.classList.contains('trellis-quickstart-target'));
    f.enabled(false); f.api.refresh(); await f.flush(); assert.match(f.text(), /read only/); assert.match(f.text(), /Use invitee guide/);
});

test('late controls and disabled controls produce useful guidance and observer rendering settles', async () => { // NEW
    const f = fixture(); await start(f); f.select(f.garden); await stage(f, 'layout');
    const add = f.target('add-bed'); add.disabled = true; await f.flush(); assert.match(f.text(), /control is disabled/);
    add.disabled = false; await f.flush(); assert.ok(add.classList.contains('trellis-quickstart-target'));
    add.remove(); await f.flush(); assert.match(f.text(), /control is hidden/);
});

test('committed work counts, while a crop list, disabled demand, and a preview do not', async () => { // NEW
    const f = fixture(); await start(f); const year = f.state().progress.year;
    f.cell('bed', { garden_bed: '1' }, f.garden); f.plan({ year, crops: [{ id: 'crop', method: 'direct', kgPerPlant: 1 }] }); await f.flush();
    assert.equal(f.state().completion.layout, true); assert.equal(f.state().completion.plan, false);
    const plan = samplePlan(year); plan.selfSufficiency.enabled = false; f.plan(plan); await f.flush(); assert.equal(f.state().completion.plan, false);
    plan.selfSufficiency.enabled = true; f.plan(plan); await f.flush(); assert.equal(f.state().completion.plan, true); assert.equal(f.state().completion.allocation, false);
    const planting = f.cell('planting', { tiler_group: '1', allocation_source: 'year_plan', allocation_year: year, allocation_plan_crop_id: 'crop' }, f.garden); f.model.emit('change'); await f.flush(); assert.equal(f.state().completion.allocation, true);
    f.garden.children.splice(f.garden.children.indexOf(planting), 1); f.model.emit('change'); await f.flush(); assert.equal(f.state().completion.allocation, false);
});

test('field guidance uses Back and Next without editing values in a body-level companion', async () => { // CHANGE
    const f = fixture(); await start(f); f.select(f.garden);
    const dialog = f.w.document.createElement('div'); dialog.dataset.quickstartSurface = 'settings'; dialog.dataset.quickstartGarden = f.garden.id; f.w.document.body.appendChild(dialog); f.ui.dialog = { container: dialog };
    const name = f.target('settings-name', 'input', dialog), city = f.target('settings-city', 'select', dialog); name.value = 'My value'; await f.flush();
    assert.equal(f.w.document.querySelector('.trellis-quickstart-card').parentNode, f.w.document.body); assert.ok(f.api.getCompanion(dialog)); assert.ok(name.classList.contains('trellis-quickstart-target')); // CHANGE
    f.press('Next'); await f.flush(); assert.ok(city.classList.contains('trellis-quickstart-target')); assert.equal(name.value, 'My value');
    f.press('Back'); await f.flush(); assert.ok(name.classList.contains('trellis-quickstart-target'));
    f.ui.dialog = null; dialog.remove(); await f.flush(); assert.equal(f.w.document.querySelector('.trellis-quickstart-card').parentNode, f.w.document.body);
});

test('self-use and sales resolve their own existing planner fields', async () => { // NEW
    const f = fixture(); await start(f); f.select(f.garden); await stage(f, 'plan');
    const dialog = f.w.document.createElement('div'); dialog.dataset.quickstartSurface = 'plan'; dialog.dataset.quickstartGarden = f.garden.id; f.w.document.body.appendChild(dialog);
    const self = f.w.document.createElement('input'); self.setAttribute('data-year-plan-field', 'qty'); self.setAttribute('data-year-plan-self-line-id', 'self-line'); dialog.appendChild(self);
    const sales = self.cloneNode(); sales.removeAttribute('data-year-plan-self-line-id'); sales.setAttribute('data-year-plan-demand-line-id', 'sales-line'); dialog.appendChild(sales);
    dialog.__trellisQuickstartView = { getDemandLines: route => [{ id: route === 'sales' ? 'sales-line' : 'self-line', cropId: '' }], showFields() {} }; // NEW
    f.state().progress.positions.plan = 10; f.api.refresh(); await f.flush(); assert.ok(self.classList.contains('trellis-quickstart-target'));
    f.choose('Planning for', 'sales'); await f.flush(); f.state().progress.positions.planGroup = 'demand-values'; f.api.refresh(); await f.flush(); assert.ok(sales.classList.contains('trellis-quickstart-target')); assert.equal(self.classList.contains('trellis-quickstart-target'), false); // CHANGE
});

test('optional skips and success records are independent across gardens and years', async () => { // NEW
    const f = fixture(); await start(f); await stage(f, 'people'); f.press('Skip for now'); await f.flush(); assert.equal(f.state().progress.skipped.people, true); assert.equal(f.state().progress.skipped.community, undefined);
    const other = f.cell('other', { garden_module: '1', garden_name: 'Other' }, f.parent); f.api.refresh(); await f.flush();
    f.choose('Garden', other.id); await f.flush(); assert.equal(f.state().progress.skipped.people, undefined);
    f.choose('Garden', f.garden.id); await f.flush(); assert.equal(f.state().progress.skipped.people, true);
    const token = f.api.capture(); f.choose('Year', String(f.state().progress.year + 1)); await f.flush(); f.api.record('community', token); assert.equal(f.state().progress.successes.community, undefined);
});

test('identity changes reject stale callbacks and isolate suppression across diagrams', async () => { // NEW
    const f = fixture(); await f.flush(); f.press('Do not show again'); await f.flush(); f.open(); await f.flush(); assert.equal(f.state().offering, false);
    f.api.show(); await f.flush(); const token = f.api.capture(); f.user({ id: 'u2', portableIdentityId: 'bob' }); f.open(); await f.flush(); assert.equal(f.state().offering, true);
    f.api.record('community', token); assert.equal(f.state().progress.successes.community, undefined);
    f.user({ id: 'u1', portableIdentityId: 'alice' }); f.parent.value.setAttribute('trellis_users_diagram_id', 'diagram-b'); f.open(); await f.flush(); assert.equal(f.state().offering, false);
    f.api.show(); await f.flush(); assert.equal(f.state().active, true);
});

test('ordinary dismissal reoffers, completion suppresses, and manual launch still works', async () => { // NEW
    const f = fixture(); await f.flush(); f.press('Close'); f.open(); await f.flush(); assert.equal(f.state().offering, true);
    await start(f); const year = f.state().progress.year; f.cell('bed', { garden_bed: '1' }, f.garden); f.cell('planting', { tiler_group: '1', allocation_source: 'year_plan', allocation_year: year, allocation_plan_crop_id: 'crop' }, f.garden); f.plan(samplePlan(year)); await f.flush();
    for (const key of ['irrigation', 'people', 'community']) { await stage(f, key); f.press('Skip for now'); await f.flush(); }
    const finish = [...f.w.document.querySelectorAll('button')].find(node => node.textContent === 'Finish'); assert.equal(finish.disabled, false); finish.click(); f.open(); await f.flush(); assert.equal(f.state().offering, false);
    f.api.show(); await f.flush(); assert.equal(f.state().active, true);
});

test('invitees acknowledge missing content without modifying the diagram', async () => { // NEW
    const f = fixture(); await start(f); f.choose('Journey', 'invitee'); await f.flush(); assert.equal(f.state().completion.access, true);
    await stage(f, 'orientation'); f.press('Next'); await f.flush(); assert.match(f.text(), /year plan has not been created yet/);
    f.press('Next'); await f.flush(); assert.match(f.text(), /No allocated plantings/); f.press('Next'); await f.flush();
    assert.equal(f.state().completion['view-plantings'], true); assert.equal(f.garden.children.length, 0);
});

test('corrupt progress is recoverable and failed storage reports session-only progress', async () => { // NEW
    const f = fixture({ storage: { 'trellis.quickstart.v1:identity:alice': '{broken' } }); await start(f); assert.match(f.text(), /cannot be restored/);
    Object.defineProperty(Object.getPrototypeOf(f.w.localStorage), 'setItem', { value() { throw new Error('full'); } }); // NEW
    f.press('Collapse'); await f.flush(); f.press('Expand'); await f.flush(); assert.match(f.text(), /could not be saved/); // CHANGE
});

test('irrigation can highlight source and bed cells before their contextual controls exist', async () => { // NEW
    const f = fixture(); await start(f); f.select(f.garden); await stage(f, 'irrigation');
    const bed = f.cell('bed', { garden_bed: '1' }, f.garden), sourceCell = f.cell('source', { irrigation_assembly_type: 'source' }, f.garden);
    const hud = f.w.document.createElement('div'); hud.dataset.quickstartSurface = 'irrigation'; hud.dataset.quickstartGarden = f.garden.id; f.w.document.body.appendChild(hud); await f.flush();
    assert.equal(f.highlighted(), sourceCell); assert.match(f.text(), /water source/);
    f.press('Next'); await f.flush(); assert.equal(f.highlighted(), bed); assert.match(f.text(), /configure its irrigation assembly/);
    f.press('Next'); await f.flush(); assert.match(f.text(), /control is not visible yet/);
});

test('collapsed gardens have an explicit expansion action and suppression survives a new window', async () => { // NEW
    const f = fixture(); await start(f); f.select(f.garden); f.graph.isCellCollapsed = () => true; let expanded = false;
    f.graph.foldCells = (collapse, recurse, cells) => { assert.equal(collapse, false); assert.equal(cells[0], f.garden); expanded = true; };
    await stage(f, 'layout'); assert.match(f.text(), /Expand this garden module/); f.press('Expand garden'); assert.equal(expanded, true);
    f.api.close(); f.open(); await f.flush(); f.press('Do not show again');
    const storage = Object.fromEntries(Object.keys(f.w.localStorage).map(key => [key, f.w.localStorage.getItem(key)]));
    const next = fixture({ storage }); await next.flush(); assert.equal(next.state().offering, false); next.api.show(); await next.flush(); assert.equal(next.state().active, true);
});

test('seven groups highlight related editable fields and freely navigate without modifying values', async () => { // NEW
    const f = fixture(), p = await planner(f); p.variety.value = 'Keep me'; // NEW
    assert.match(f.text(), /Step 1 of 7/); f.press('Next'); await f.flush(); // NEW
    assert.match(f.text(), /Step 2 of 7/); assert.ok(p.variety.classList.contains('trellis-quickstart-target')); assert.ok(p.method.classList.contains('trellis-quickstart-target')); assert.equal(p.other.classList.contains('trellis-quickstart-target'), false); // NEW
    p.from.disabled = p.to.disabled = true; f.press('Next'); await f.flush(); // NEW
    assert.match(f.text(), /Step 3 of 7/); assert.ok(p.source.classList.contains('trellis-quickstart-target')); assert.equal(p.from.classList.contains('trellis-quickstart-target'), false); assert.equal(p.method.classList.contains('trellis-quickstart-target'), false); // NEW
    p.from.disabled = p.to.disabled = false; f.api.refresh(); await f.flush(); assert.ok(p.from.classList.contains('trellis-quickstart-target')); assert.ok(p.to.classList.contains('trellis-quickstart-target')); // NEW
    for (let index = 4; index <= 7; index++) { f.press('Next'); await f.flush(); assert.match(f.text(), new RegExp('Step ' + index + ' of 7')); } // NEW
    assert.equal(p.variety.value, 'Keep me'); f.press('Back'); await f.flush(); assert.match(f.text(), /Step 6 of 7/); // NEW
    const button = f.w.document.querySelector('[aria-controls="trellis-quickstart-body"]'); f.press('Collapse'); await f.flush(); // NEW
    assert.equal(button.textContent, 'Expand'); assert.equal(button.getAttribute('aria-expanded'), 'false'); assert.equal(f.w.document.querySelectorAll('.trellis-quickstart-target').length, 0); // NEW
    f.press('Expand'); await f.flush(); assert.equal(button.getAttribute('aria-expanded'), 'true'); assert.match(f.text(), /Step 6 of 7/); // NEW
}); // NEW

test('demand groups follow one matching focused line across rerenders and isolate crop and route', async () => { // NEW
    const f = fixture(), p = await planner(f); await p.group('demand-values'); // NEW
    const targets = () => [...p.node.querySelectorAll('.trellis-quickstart-target')]; // NEW
    assert.equal(targets().length, 6); assert.ok(targets().every(node => node.dataset.yearPlanSelfLineId === 'self-one')); // NEW
    p.node.querySelector('[data-year-plan-self-line-id="self-two"][data-year-plan-field="qty"]').focus(); await f.flush(); // NEW
    assert.ok(targets().every(node => node.dataset.yearPlanSelfLineId === 'self-two')); // NEW
    const old = p.node.querySelector('[data-year-plan-self-line-id="self-two"][data-year-plan-field="qty"]'), replacement = old.cloneNode(); old.replaceWith(replacement); f.api.refresh(); await f.flush(); assert.ok(replacement.classList.contains('trellis-quickstart-target')); // NEW
    p.node.querySelector('[data-year-plan-self-line-id="self-other"][data-year-plan-field="qty"]').focus(); await f.flush(); assert.ok(targets().every(node => node.dataset.yearPlanSelfLineId === 'self-two')); // NEW
    p.node.dataset.quickstartCrop = 'crop-two'; await f.flush(); assert.ok(targets().every(node => node.dataset.yearPlanSelfLineId === 'self-other')); // NEW
    p.node.dataset.quickstartCrop = 'crop-one'; f.choose('Planning for', 'sales'); await f.flush(); await p.group('demand-values'); // NEW
    assert.equal(targets().length, 6); assert.ok(targets().every(node => node.dataset.yearPlanDemandLineId === 'sales-one')); // NEW
    p.lines.sales.length = 0; f.api.refresh(); await f.flush(); assert.match(f.text(), /Add a matching demand line/); assert.equal(targets().length, 0); // NEW
}); // NEW

test('Show fields requests the current group and line; nested picker cancellation preserves the group', async () => { // NEW
    const f = fixture(), p = await planner(f); await p.group('demand-values'); // NEW
    f.press('Show fields'); await f.flush(); assert.deepEqual(p.shown[0], ['demand-values', 'self', 'self-one']); // NEW
    const picker = companionWorkflow(f, 'package-picker', { left: 300, top: 80, width: 500, height: 300 }); Object.assign(picker.node.dataset, { quickstartGarden: f.garden.id }); // NEW
    f.target('plan-package-apply', 'button', picker.node); await f.flush(); assert.match(f.text(), /Choose one available crop package/); // NEW
    assert.equal(f.w.document.querySelectorAll('[data-year-plan-field].trellis-quickstart-target').length, 0); // NEW
    picker.node.remove(); await f.flush(); assert.match(f.text(), /Step 5 of 7/); // NEW
}); // NEW

test('automatic advancement requires matching native success, live session and unchanged guidance context', async () => { // NEW
    const f = fixture(), p = await planner(f); const token = f.api.capture(); // NEW
    f.api.refresh(); await f.flush(); assert.match(f.text(), /Step 1 of 7/); // NEW
    f.api.recordPlanAction('demand-added', token); await f.flush(); assert.match(f.text(), /Step 1 of 7/); // NEW
    f.api.recordPlanAction('crops-applied', token); await f.flush(); assert.match(f.text(), /Step 2 of 7/); // NEW
    f.api.recordPlanAction('crops-applied', token); await f.flush(); assert.match(f.text(), /Step 2 of 7/); // NEW
    f.press('Back'); await f.flush(); f.api.recordPlanAction('crops-applied', token); await f.flush(); assert.match(f.text(), /Step 1 of 7/); // NEW
    const oldSession = f.api.capture(); p.node.dataset.quickstartSession = 'session-two'; f.api.recordPlanAction('crops-applied', oldSession); await f.flush(); assert.match(f.text(), /Step 1 of 7/); // NEW
    await p.group('demand-setup'); f.api.recordPlanAction('demand-added', f.api.capture()); await f.flush(); assert.match(f.text(), /Step 5 of 7/); // NEW
    await p.group('save'); f.api.recordPlanAction('plan-committed', f.api.capture()); await f.flush(); assert.equal(f.state().completion.plan, false); assert.doesNotMatch(f.text(), /Your year plan is saved/); // NEW
    f.plan(samplePlan(f.state().progress.year)); f.api.recordPlanAction('plan-committed', f.api.capture()); await f.flush(); assert.equal(f.state().completion.plan, true); assert.match(f.text(), /Your year plan is saved/); // NEW
    await p.group('year-crops'); const oldYear = f.api.capture(); p.node.remove(); await f.flush(); f.choose('Year', String(f.state().progress.year + 1)); await f.flush(); f.api.recordPlanAction('crops-applied', oldYear); await f.flush(); assert.equal(f.state().progress.positions.planGroup, 'year-crops'); // CHANGE: stale success cannot advance the new year's initial group.
}); // NEW

test('legacy field positions migrate to stable groups for self-use and inserted sales steps', async () => { // NEW
    const f = fixture(), p = await planner(f); // NEW
    for (const [route, index, expected] of [['self', 2, 'growing'], ['self', 5, 'harvest'], ['self', 8, 'demand-setup'], ['self', 10, 'demand-values'], ['self', 16, 'save'], ['sales', 8, 'demand-setup'], ['sales', 11, 'demand-setup'], ['sales', 13, 'demand-values'], ['sales', 18, 'review'], ['sales', 19, 'save']]) { // NEW
        const progress = f.state().progress; progress.demand = route; progress.positions.plan = index; delete progress.positions.planGroup; f.api.refresh(); await f.flush(); assert.equal(progress.positions.planGroup, expected, route + ':' + index); // NEW
    } // NEW
    f.api.close(); f.api.show(); await f.flush(); assert.match(f.text(), /Step 7 of 7/); assert.ok(p.node.isConnected); // NEW
}); // NEW

test('planner defaults to bottom left, follows viewport and card size, preserves manual offsets and avoids every target', async () => { // NEW
    const f = fixture(), p = await planner(f), view = floatingCard(f); await f.flush(); // NEW
    assert.deepEqual(view.position(), { x: 16, y: f.w.innerHeight - view.card.getBoundingClientRect().height - 16 }); // NEW
    f.w.innerHeight = 680; f.w.dispatchEvent(new f.w.Event('resize')); await f.flush(); assert.equal(view.position().y, 680 - view.card.getBoundingClientRect().height - 16); // NEW
    const original = view.card.getBoundingClientRect; view.card.getBoundingClientRect = () => ({ ...original(), height: 200 }); f.api.refresh(); await f.flush(); assert.equal(view.position().y, 464); // NEW
    const blocker = p.node.querySelector('[data-trellis-quickstart="plan-add-crops"]'); blocker.getBoundingClientRect = () => ({ left: 16, top: 464, right: 120, bottom: 490, width: 104, height: 26 }); f.api.refresh(); await f.flush(); assert.notDeepEqual(view.position(), { x: 16, y: 464 }); assert.equal(f.state().preferences.workflowPositions.plan, undefined); // NEW
    blocker.getBoundingClientRect = () => ({ width: 0, height: 0 }); f.api.refresh(); await f.flush(); assert.deepEqual(view.position(), { x: 16, y: 464 }); // NEW
    view.handle.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await f.flush(); const saved = { ...f.state().preferences.workflowPositions.plan }; // NEW
    f.api.close(); f.api.show(); await f.flush(); assert.equal(view.position().x, 200 + saved.x); // NEW
}); // NEW

test('read aloud deduplicates renders, follows context, replays and cancels on collapse, close and identity change', async () => { // NEW
    const f = fixture(), p = await planner(f), spoken = []; let cancelled = 0; // NEW
    f.w.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } }; f.w.speechSynthesis = { speak: item => spoken.push(item), cancel: () => cancelled++ }; // NEW
    assert.equal(f.w.document.querySelector('[data-quickstart-focus="read-aloud"]').checked, false); // NEW
    f.w.document.querySelector('[data-quickstart-focus="read-aloud"]').click(); await f.flush(); assert.equal(spoken.length, 1); // NEW
    p.method.value = 'direct'; f.api.refresh(); await f.flush(); assert.equal(spoken.length, 1); // NEW
    f.press('Read again'); await f.flush(); assert.equal(spoken.length, 2); f.press('Next'); await f.flush(); assert.equal(spoken.length, 3); // NEW
    f.press('Collapse'); await f.flush(); assert.ok(cancelled >= 3); const before = spoken.length; f.api.refresh(); await f.flush(); assert.equal(spoken.length, before); // NEW
    f.press('Expand'); await f.flush(); assert.equal(spoken.length, before + 1); // NEW
    const oldSpeech = spoken.at(-1); f.api.close(); oldSpeech.onerror(); await f.flush(); assert.equal(f.w.document.querySelector('.trellis-quickstart-card'), null); // NEW
    f.api.show(); await f.flush(); assert.equal(f.state().preferences.readAloud, true); const afterShow = spoken.length; f.user({ id: 'bob', portableIdentityId: 'bob' }); await f.flush(); f.api.show(); await f.flush(); assert.equal(spoken.length, afterShow); assert.equal(f.w.document.querySelector('[data-quickstart-focus="read-aloud"]').checked, false); // NEW
}); // NEW

test('unavailable and failing speech retain usable text guidance without retry loops', async () => { // NEW
    const f = fixture(); await start(f); f.w.document.querySelector('[data-quickstart-focus="read-aloud"]').click(); await f.flush(); // NEW
    assert.match(f.text(), /Read aloud is unavailable/); f.api.refresh(); await f.flush(); assert.match(f.text(), /Read aloud is unavailable/); // NEW
    const spoken = []; f.w.SpeechSynthesisUtterance = class {}; f.w.speechSynthesis = { speak: item => spoken.push(item), cancel() {} }; // NEW
    f.press('Read again'); await f.flush(); assert.equal(spoken.length, 1); spoken[0].onerror(); await f.flush(); assert.equal(spoken.length, 1); assert.match(f.text(), /written instructions/); // NEW
    f.w.document.querySelector('[data-quickstart-focus="read-aloud"]').click(); await f.flush(); assert.equal(f.state().preferences.readAloud, false); assert.doesNotMatch(f.text(), /Read aloud is unavailable/); // NEW
}); // NEW
