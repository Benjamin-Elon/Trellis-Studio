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

test('field guidance uses Back and Next without editing values and remains inside the dialog', async () => { // NEW
    const f = fixture(); await start(f); f.select(f.garden);
    const dialog = f.w.document.createElement('div'); dialog.dataset.quickstartSurface = 'settings'; dialog.dataset.quickstartGarden = f.garden.id; f.w.document.body.appendChild(dialog); f.ui.dialog = { container: dialog };
    const name = f.target('settings-name', 'input', dialog), city = f.target('settings-city', 'select', dialog); name.value = 'My value'; await f.flush();
    assert.equal(f.w.document.querySelector('.trellis-quickstart-card').parentNode, dialog); assert.ok(name.classList.contains('trellis-quickstart-target'));
    f.press('Next'); await f.flush(); assert.ok(city.classList.contains('trellis-quickstart-target')); assert.equal(name.value, 'My value');
    f.press('Back'); await f.flush(); assert.ok(name.classList.contains('trellis-quickstart-target'));
    f.ui.dialog = null; dialog.remove(); await f.flush(); assert.equal(f.w.document.querySelector('.trellis-quickstart-card').parentNode, f.w.document.body);
});

test('self-use and sales resolve their own existing planner fields', async () => { // NEW
    const f = fixture(); await start(f); f.select(f.garden); await stage(f, 'plan');
    const dialog = f.w.document.createElement('div'); dialog.dataset.quickstartSurface = 'plan'; dialog.dataset.quickstartGarden = f.garden.id; f.w.document.body.appendChild(dialog);
    const self = f.w.document.createElement('input'); self.setAttribute('data-year-plan-field', 'qty'); self.setAttribute('data-year-plan-self-line-id', 'self-line'); dialog.appendChild(self);
    const sales = self.cloneNode(); sales.removeAttribute('data-year-plan-self-line-id'); sales.setAttribute('data-year-plan-demand-line-id', 'sales-line'); dialog.appendChild(sales);
    f.state().progress.positions.plan = 10; f.api.refresh(); await f.flush(); assert.ok(self.classList.contains('trellis-quickstart-target'));
    f.choose('Planning for', 'sales'); await f.flush(); f.state().progress.positions.plan = 13; f.api.refresh(); await f.flush(); assert.ok(sales.classList.contains('trellis-quickstart-target'));
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
    f.press('Collapse'); await f.flush(); f.press('Collapse'); await f.flush(); assert.match(f.text(), /could not be saved/);
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
