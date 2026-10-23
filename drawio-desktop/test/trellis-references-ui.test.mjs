/** Real mxGraph integration for portable garden creation, drafts and owner review. */ // NEW
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { createReferenceDatabaseService } from '../src/main/trellis-reference-database.js';
const require = createRequire(import.meta.url), { loadPlantTilerMxGraph } = require('./helpers/plant-tiler-mxgraph-harness.cjs');
const webapp = new URL('../drawio/src/main/webapp/', import.meta.url), database = fileURLToPath(new URL('../trellis_database/Trellis_database.sqlite', import.meta.url));
class Sqlite {
    constructor(filename, options = {}) { this.db = new DatabaseSync(filename, { readOnly: options.readonly }); }
    prepare(sql) { const statement = this.db.prepare(sql), params = values => Array.isArray(values[0]) ? values[0] : values; return { readonly: /^\s*(SELECT|PRAGMA)\b/i.test(sql), all: (...values) => statement.all(...params(values)), get: (...values) => statement.get(...params(values)), run: (...values) => statement.run(...params(values)) }; }
    exec(sql) { return this.db.exec(sql); } close() { this.db.close(); }
    transaction(fn) { return () => { this.exec('BEGIN'); try { const result = fn(); this.exec('COMMIT'); return result; } catch (error) { this.exec('ROLLBACK'); throw error; } }; }
}
function fixture(t, storage) { // CHANGE
    const h = loadPlantTilerMxGraph(), w = h.window, model = h.graph.getModel(), errors = [], dialogs = [];
    const service = createReferenceDatabaseService({ Database: Sqlite, readDefaults: () => new Sqlite(database, { readonly: true }) });
    const user = { id: 'owner', admin: false }, policy = { attrs: { owner: 'trellis_owner_user_id' }, isEnabled: () => true, isAdmin: () => user.admin, getCurrentUser: () => user, effectiveCapabilitiesForCell: () => user.id === 'viewer' ? [] : ['create_plantings'], getDiagramKey: () => 'diagram', canManagePlanting: () => true, canCreatePlanting: () => true }; // CHANGE
    h.graph.__trellisUsers = policy; w.Trellis = { users: policy };
    if (storage) w.TrellisReferenceDrafts = storage; // NEW
    w.dbBridge = { resolvePath() { throw new Error('Unexpected local database access.'); }, open() { throw new Error('Unexpected local database access.'); } };
    w.trellisReferenceDatabase = { request: async (method, payload) => JSON.parse(JSON.stringify(await service.request(1, method, JSON.parse(JSON.stringify(payload || {}))))) }; // CHANGE: emulate Electron IPC's plain structured row objects rather than node:sqlite's null prototypes.
    h.ui.editor.addListener = () => {}; h.ui.setStatus = message => { h.status = message; }; h.ui.handleError = error => { errors.push(error); };
    h.ui.showDialog = (panel, _width, _height, _modal, _closable, onClose) => { w.document.body.appendChild(panel); dialogs.push({ panel, onClose }); h.ui.dialog = { container: panel }; };
    h.ui.hideDialog = () => { const dialog = dialogs.pop(); if (dialog) { dialog.panel.remove(); dialog.onClose?.(); } h.ui.dialog = dialogs.length ? { container: dialogs.at(-1).panel } : null; };
    function load(relative) { w.eval(fs.readFileSync(new URL(relative, webapp), 'utf8')); }
    load('js/trellis-reference-core.js'); load('plugins/garden_planner_plugins/Garden_References.js');
    const C = w.TrellisReferenceCore, api = h.graph.__trellisReferences;
    function attrs(cell, values) { const node = cell.value?.nodeType === 1 ? cell.value.cloneNode(true) : w.mxUtils.createXmlDocument().createElement('object'); Object.entries(values).forEach(([key, value]) => node.setAttribute(key, value)); model.setValue(cell, node); }
    function garden(id, label = id) { const node = w.mxUtils.createXmlDocument().createElement('object'); Object.entries({ garden_module: '1', label, garden_name: label, trellis_owner_user_id: 'owner', trellis_reference_pending: '1' }).forEach(([key, value]) => node.setAttribute(key, value)); return h.graph.insertVertex(null, id, node, 0, 0, 2000, 2000, 'swimlane;module=1;'); }
    async function initialize(cell) { const prepared = await api.initialize(cell), cities = C.project(prepared.store).tables.Cities, city = cities.find(city => city.timezone) || cities[0]; prepared.finalize(city.city_id); model.beginUpdate(); try { prepared.apply(); attrs(cell, { city_id: city.city_id, city_name: city.city_name, unit_system: 'metric', default_bed_width_cm: '120', default_bed_length_cm: '300' }); } finally { model.endUpdate(); } return city; }
    t.after(() => { service.closeOwner(1); h.close(); });
    return { ...h, w, model, user, api, C, errors, dialogs, load, attrs, garden, initialize };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(predicate) { for (let attempt = 0; attempt < 400; attempt++) { if (predicate()) return; await tick(); } throw new Error('Timed out waiting for the reference UI.'); }
function changed(C, store, patch) { const [entity] = Object.entries(store.bindings).find(([, value]) => value.table === 'Plants'), revision = store.revisions[store.manifests[store.current].heads[entity]]; return C.publish(store, [C.revision(entity, revision.kind, { ...revision.data, ...patch }, false, { source: 'manual-test' })]); }
test('creation captures the chosen climate, compacts manifests, and templates reset inventory without copying children', async t => {
    const h = fixture(t), source = h.garden('source', 'Source Garden'); await h.initialize(source);
    let base = h.api.read(source), candidate = h.C.putCatalog(base, 'equipment_inventory_json', { version: 1, items: [{ id: 'tractor', name: 'Tractor', status: 'owned', purchaseDate: '2026-01-01' }] });
    const proposal = h.api.submit(source, source, base, candidate); const preview = await h.api.preview(source, proposal.id, proposal.changes.map(item => item.entityId)); h.api.commit(preview);
    const bed = h.graph.insertVertex(source, null, 'Existing bed', 20, 80, 200, 200, '');
    h.attrs(source, { equipment_inventory_json: JSON.stringify({ version: 1, items: [{ id: 'tractor', name: 'Tractor', status: 'owned', purchaseDate: '2026-01-01' }] }) });
    const target = h.garden('target'), snapshot = h.api.snapshot(source), prepared = await h.api.initialize(target, snapshot); prepared.finalize(source.getAttribute('city_id'));
    h.model.beginUpdate(); try { prepared.apply(); } finally { h.model.endUpdate(); }
    assert.equal(h.model.getChildCount(target), 0); assert.equal(h.model.getParent(bed), source);
    assert.equal(h.api.catalog(target, 'equipment_inventory_json').items[0].status, 'wishlist');
    assert.equal(h.api.catalog(target, 'equipment_inventory_json').items[0].purchaseDate, undefined);
    assert.equal(target.getAttribute('trellis_owner_user_id'), 'owner'); assert.ok(target.getAttribute(h.C.PROPOSALS) == null); // CHANGE
    const store = h.api.read(target); assert.equal(Object.keys(store.manifests).length, 1);
    assert.ok(h.C.project(store).tables.CityWeatherMonthly.every(row => String(row.city_id) === source.getAttribute('city_id')));
});
test('SQL editor writes stay in an unsent draft and reopening a context preserves the same portable identities', async t => {
    const h = fixture(t), garden = h.garden('draft'); await h.initialize(garden); const before = garden.getAttribute(h.C.ATTR), base = h.api.read(garden), entity = Object.entries(base.bindings).find(([, row]) => row.table === 'Plants')[0], plantId = base.bindings[entity].key.plant_id;
    const context = h.api.sqlContext(garden, { editable: true }), opened = await context.bridge.open('', { readOnly: false });
    await context.bridge.exec(opened.dbId, 'UPDATE Plants SET spacing_cm=? WHERE plant_id=?', [41, plantId]);
    await context.bridge.exec(opened.dbId, 'UPDATE Plants SET spacing_cm=? WHERE plant_id=?', [42, plantId]);
    await context.bridge.close(opened.dbId); await context.release();
    assert.equal(garden.getAttribute(h.C.ATTR), before); assert.equal(h.api.messages(garden).requests.length, 0);
    const draft = h.api.getDraft(garden); assert.equal(h.C.rowByKey(draft.candidate, draft.candidate.current, 'Plants', { plant_id: plantId }).spacing_cm, 42); // CHANGE
    const request = h.api.submit(garden, garden, draft.base, draft.candidate, 'Reviewed spacing');
    const preview = await h.api.preview(garden, request.id, request.changes.filter(item => !item.dependency).map(item => item.entityId)); h.api.commit(preview);
    assert.equal(h.C.rowByKey(h.api.read(garden), h.api.read(garden).current, 'Plants', { plant_id: plantId }).spacing_cm, 42);
});
test('owners review partial proposals, stale previews fail, and administrators without ownership cannot accept', async t => {
    const h = fixture(t), garden = h.garden('review'); await h.initialize(garden); const base = h.api.read(garden), candidate = changed(h.C, base, { spacing_cm: 145 }), request = h.api.submit(garden, garden, base, candidate); // CHANGE
    const selected = request.changes.filter(item => !item.dependency).map(item => item.entityId), preview = await h.api.preview(garden, request.id, selected);
    h.user.id = 'admin'; h.user.admin = true; assert.throws(() => h.api.commit(preview), /owner/); await assert.rejects(h.api.preview(garden, request.id, selected), /owner/);
    h.user.id = 'owner'; h.user.admin = false;
    const another = h.api.submit(garden, garden, base, changed(h.C, base, { spacing_cm: 146 })); assert.throws(() => h.api.commit(preview), /changed/); // CHANGE
    h.api.reject(garden, another.id, another.changes.filter(item => !item.dependency).map(item => item.entityId));
    const refreshed = await h.api.preview(garden, request.id, selected); h.api.commit(refreshed); await assert.rejects(h.api.preview(garden, request.id, selected), /already/);
    assert.equal(h.api.messages(garden).decisions.length, 2);
});
test('creation dropdown copies reviewed settings and an empty garden through the production settings dialog', async t => {
    const h = fixture(t), source = h.garden('source-settings', 'Settings source'); await h.initialize(source);
    h.attrs(source, { default_path_wheelbarrow_width_cm: '123', default_path_wheelbarrow_enabled: '1', plant_circle_max_per_planting: '55', plant_circle_max_total: '250' });
    const target = h.garden('new-settings', 'New garden');
    h.graph.fireEvent(new h.w.mxEventObject('usl:gardenModuleNeedsSettings', 'cell', target));
    await until(() => h.dialogs.some(dialog => dialog.panel.textContent.includes('Start from:')));
    const panel = h.dialogs.at(-1).panel, select = [...panel.querySelectorAll('select')].find(select => [...select.options].some(option => option.textContent === 'Settings source'));
    assert.ok(select); select.value = [...select.options].find(option => option.textContent === 'Settings source').value; select.dispatchEvent(new h.w.Event('change'));
    await until(() => panel.querySelector('input[data-plant-circle-limit="plant_circle_max_per_planting"]')?.value === '55');
    [...panel.querySelectorAll('button')].find(button => button.textContent === 'OK').click(); await tick();
    assert.equal(target.getAttribute('trellis_reference_pending'), '0'); assert.equal(target.getAttribute('city_id'), source.getAttribute('city_id'));
    assert.equal(target.getAttribute('default_bed_width_cm'), '120'); assert.equal(target.getAttribute('plant_circle_max_per_planting'), '55'); assert.equal(h.model.getChildCount(target), 0);
});
test('scoped scheduler reads the embedded data after the active garden changes, with no local SQLite fallback', async t => {
    const h = fixture(t), garden = h.garden('schedule'); await h.initialize(garden);
    for (const name of ['Garden_Scheduler_Shared_Core.js', 'Garden_Scheduler_Annual_Core.js', 'Garden_Scheduler_Perennial_Core.js', 'Garden_Scheduler_Dialog.js']) h.load('plugins/garden_planner_plugins/' + name);
    const scheduler = h.w.USL.scheduler.forGarden(garden), options = await scheduler.listPlantOptions(); assert.ok(options.length > 0);
    const other = h.garden('other'); await h.initialize(other); h.graph.setSelectionCell(other);
    assert.equal((await scheduler.listPlantOptions())[0].id, options[0].id);
    const source = h.api.read(garden), entity = Object.entries(source.bindings).find(([, binding]) => binding.table === 'Plants')[0], original = source.revisions[source.manifests[source.current].heads[entity]];
    const candidate = h.C.publish(source, [h.C.revision(entity, original.kind, { ...original.data, plant_name: 'Embedded-only name' }, false)]), request = h.api.submit(garden, garden, source, candidate);
    h.api.commit(await h.api.preview(garden, request.id, request.changes.filter(item => !item.dependency).map(item => item.entityId)));
    assert.ok((await h.w.USL.scheduler.forGarden(garden).listPlantOptions()).some(option => option.name === 'Embedded-only name'));
    assert.ok(!(await scheduler.listPlantOptions()).some(option => option.name === 'Embedded-only name'), 'an existing view remains pinned');
});

test('private unsent work survives reopening and stays isolated from another active user', async t => { // NEW
    const records = new Map(), storage = { read: async key => structuredClone(records.get(key)), write: async (key, value) => { records.set(key, structuredClone(value)); }, remove: async key => { records.delete(key); } }; // NEW
    const h = fixture(t, storage), garden = h.garden('persistent-draft'); await h.initialize(garden); // NEW
    const base = h.api.read(garden), candidate = changed(h.C, base, { spacing_cm: 123 }); await h.api.putDraft(garden, base, candidate); await h.api.flushDrafts(); h.api.drafts.clear(); // NEW
    h.user.id = 'other'; assert.equal(await h.api.restoreDraft(garden), null); assert.equal(h.api.getDraft(garden), undefined); // NEW
    h.user.id = 'owner'; await h.api.restoreDraft(garden); assert.equal(h.api.getDraft(garden).candidate.current, candidate.current); // NEW
    const context = h.api.sqlContext(garden), opened = await context.bridge.open('', { readOnly: true }), binding = Object.entries(base.bindings).find(([, value]) => value.table === 'Plants')[1]; // NEW
    const rows = (await context.bridge.query(opened.dbId, 'SELECT spacing_cm FROM Plants WHERE plant_id=?', [binding.key.plant_id])).rows; // NEW
    assert.notEqual(rows[0].spacing_cm, 123); await context.bridge.close(opened.dbId); await context.release(); // NEW
}); // NEW

test('selected future planting updates share the acceptance transaction and task failures roll the whole transaction back', async t => { // NEW
    const h = fixture(t), garden = h.garden('recalculation'); await h.initialize(garden); // NEW
    for (const name of ['Garden_Scheduler_Shared_Core.js', 'Garden_Scheduler_Annual_Core.js', 'Garden_Scheduler_Perennial_Core.js', 'Garden_Scheduler_Dialog.js']) h.load('plugins/garden_planner_plugins/' + name); // NEW
    const base = h.api.read(garden), [entity, binding] = Object.entries(base.bindings).find(([, value]) => value.table === 'Plants'); // NEW
    const planting = h.graph.insertVertex(garden, 'future', '', 100, 100, 350, 300, 'tiler_group=1;'); // NEW
    const attrs = { tiler_group: '1', plant_id: binding.key.plant_id, city_id: garden.getAttribute('city_id'), sow_date: '2099-06-15', season_start_year: '2099', method_id: 'direct_sow.field', method_category_id: 'direct_sow', [h.C.PIN]: base.current, spacing_cm: '30', spacing_x_cm: '30', spacing_y_cm: '30', plant_abbr: 'TEST' }; h.attrs(planting, attrs); // CHANGE
    const neighbor = h.graph.insertVertex(garden, 'neighbor', '', 500, 100, 350, 300, 'tiler_group=1;'); h.attrs(neighbor, attrs); const neighborText = neighbor.value.outerHTML, rectangle = [planting.geometry.x, planting.geometry.y, planting.geometry.width, planting.geometry.height]; // NEW
    const candidate = changed(h.C, base, { annual: 1, biennial: 0, perennial: 0, lifespan_years: 1, days_maturity: 30, gdd_to_maturity: null, days_germ: 5, days_transplant: 0, harvest_window_days: 7, tbase_c: 5, tmin_c: 0, topt_low_c: 15, topt_high_c: 25, tmax_c: 40, spacing_cm: 60, spacing_x_cm: 60, spacing_y_cm: 60, yield_per_plant_kg: 2 }); // NEW
    const request = h.api.submit(garden, garden, base, candidate), selected = request.changes.filter(item => !item.dependency).map(item => item.entityId); let fail = true, taskCalls = 0; // NEW
    h.w.USL.tasks = { applySchedulerTaskReplacement() { taskCalls++; if (fail) throw new Error('Injected task reconciliation failure'); } }; // NEW
    const preview = await h.api.preview(garden, request.id, selected, {}, {}, [planting.id]); assert.equal(preview.recalculations.length, 1); // NEW
    const gardenText = garden.value.outerHTML, plantingText = planting.value.outerHTML; assert.throws(() => h.api.commit(preview), /Injected task/); // NEW
    assert.equal(garden.value.outerHTML, gardenText); assert.equal(planting.value.outerHTML, plantingText); assert.equal(neighbor.value.outerHTML, neighborText); // NEW
    fail = false; h.api.commit(preview); assert.equal(taskCalls, 2); assert.equal(planting.getAttribute(h.C.PIN), h.api.read(garden).current); assert.equal(planting.getAttribute('spacing_cm'), '60'); assert.equal(neighbor.getAttribute(h.C.PIN), base.current); // NEW
    assert.deepEqual([planting.geometry.x, planting.geometry.y, planting.geometry.width, planting.geometry.height], rectangle); assert.equal(neighbor.value.outerHTML, neighborText); // NEW
    h.attrs(neighbor, { actual_yield_kg: '1' }); await assert.rejects(h.api.preview(garden, request.id, selected, {}, {}, [neighbor.id]), /already/); // NEW
    assert.equal(h.C.rowByKey(h.api.read(garden), base.current, 'Plants', binding.key).plant_id, binding.key.plant_id); assert.ok(entity); // NEW
}); // NEW

test('production equipment defaults capture their dependencies and existing irrigation parts retain saved costs', async t => { // NEW
    const h = fixture(t); for (const name of ['Garden_Equipment.js', 'Garden_Irrigation_Planner.js']) h.load('plugins/garden_planner_plugins/' + name); // NEW
    const garden = h.garden('physical-catalogs'); await h.initialize(garden); const base = h.api.read(garden), equipment = h.api.catalog(garden, 'equipment_inventory_json'); // NEW
    assert.ok(equipment.items.length); assert.ok(equipment.items.every(item => item.status === 'wishlist')); assert.ok(h.api.catalog(garden, 'equipment_capability_registry_json').items.length); // NEW
    const catalog = h.api.catalog(garden, 'irrigation_catalog_json'), part = catalog.items.find(item => item.category !== 'pipe_tubing' && Number(item.cost || item.unitCost) > 0); assert.ok(part); // NEW
    const component = h.graph.insertVertex(garden, 'saved-part', '', 50, 50, 150, 34, ''); h.attrs(component, { irrigation_component: '1', irrigation_catalog_part_id: part.id, [h.C.PIN]: base.current }); // NEW
    const changed = h.C.clone(catalog); changed.items.find(item => item.id === part.id).cost = 999; changed.items.find(item => item.id === part.id).unitCost = 999; // NEW
    const candidate = h.C.putCatalog(base, 'irrigation_catalog_json', changed), request = h.api.submit(garden, garden, base, candidate); h.api.commit(await h.api.preview(garden, request.id, request.changes.filter(item => !item.dependency).map(item => item.entityId))); // NEW
    const cost = h.graph.__trellisIrrigationPlanner.__test.partCostForReport(garden, h.api.catalog(garden, 'irrigation_catalog_json'), { partIds: [part.id], componentCellIds: [component.id] }, part.id); // NEW
    assert.equal(cost, Number(part.cost || part.unitCost)); assert.equal(h.api.catalog(garden, 'irrigation_catalog_json').items.find(item => item.id === part.id).cost, 999); // NEW
}); // NEW

test('the send dialog targets another cached page without selecting it and marks that page for serialization', async t => { // NEW
    const h = fixture(t), source = h.garden('page-source'); await h.initialize(source); const sourcePage = { id: 'source-page', root: h.model.getRoot() }, targetPage = { id: 'target-page', root: new h.w.mxGraphModel().getRoot(), getName: () => 'Other page' }; // NEW
    h.ui.currentPage = sourcePage; h.ui.pages = [sourcePage, targetPage]; const target = new h.w.mxCell(); target.id = 'page-target'; h.attrs(target, { garden_module: '1', label: 'Other garden', trellis_owner_user_id: 'owner', [h.C.ATTR]: source.getAttribute(h.C.ATTR) }); targetPage.root.children[0].insert(target); // NEW
    const base = h.api.read(source); await h.api.putDraft(source, base, changed(h.C, base, { spacing_cm: 123 })); h.api.show(source); const panel = h.dialogs.at(-1).panel, recipients = panel.querySelector('select[aria-label="Receiving gardens"]'); // NEW
    for (const option of recipients.options) option.selected = option.textContent.includes('Other garden'); [...panel.querySelectorAll('button')].find(button => button.textContent === 'Send proposal to selected gardens').click(); // NEW
    await until(() => !!target.getAttribute(h.C.PROPOSALS)); assert.equal(h.ui.currentPage, sourcePage); assert.equal(targetPage.needsUpdate, true); assert.equal(h.api.messages(target).requests[0].target.pageId, 'target-page'); assert.equal(h.api.messages(source).requests.length, 0); // NEW
}); // NEW
