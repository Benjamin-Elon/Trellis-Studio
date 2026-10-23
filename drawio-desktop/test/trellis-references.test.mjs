/** Portable references, owner authority and SQL isolation regression coverage. */ // NEW
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url'; // NEW
import { createReferenceDatabaseService, materialize, snapshotDatabase, referenceCore as C } from '../src/main/trellis-reference-database.js';
import { validateReferenceChanges } from '../src/main/trellis-reference-policy.js';
import { replay, diffObjects } from '../src/main/trellis-collaboration-protocol.js'; // NEW
const table = (columns, pk, foreignKeys = []) => ({ columns: columns.map(([name, type]) => ({ name, type, notnull: 0, dflt_value: null, pk: pk.indexOf(name) + 1 })), pk, foreignKeys });
function fixture(name = 'Lettuce') {
    return C.capture({ schema: {
        Plants: table([['plant_id', 'INTEGER'], ['plant_name', 'TEXT'], ['spacing_cm', 'REAL'], ['yield_per_plant_kg', 'REAL']], ['plant_id']),
        PlantVarieties: table([['variety_id', 'INTEGER'], ['plant_id', 'INTEGER'], ['variety_name', 'TEXT']], ['variety_id'], [{ id: 0, seq: 0, table: 'Plants', from: 'plant_id', to: 'plant_id' }])
    }, tables: { Plants: [{ plant_id: 1, plant_name: name, spacing_cm: 20, yield_per_plant_kg: 1 }], PlantVarieties: [{ variety_id: 10, plant_id: 1, variety_name: 'Early' }] } });
}
const plantEntity = store => Object.entries(store.bindings).find(([, value]) => value.table === 'Plants')[0];
function edit(store, patch) { const entity = plantEntity(store), old = store.revisions[store.manifests[store.current].heads[entity]]; return C.publish(store, [C.revision(entity, old.kind, { ...old.data, ...patch }, false, { source: 'test' })]); }
const proposal = (base, candidate) => C.proposal(base, candidate, 'editor', { gardenId: 'source' }, { gardenId: 'garden' });

test('layout lookup strings and climate override keys follow portable dependencies across different numeric bindings', () => { // NEW
    const snapshot = C.project(fixture()); snapshot.schema.Cities = table([['city_id', 'INTEGER'], ['city_name', 'TEXT']], ['city_id']); snapshot.tables.Cities = [{ city_id: 1, city_name: 'Test City' }]; // NEW
    snapshot.schema.CompanionSetLayoutDefaults = table([['set_default_id', 'INTEGER'], ['crop_set_key', 'TEXT'], ['layout_json', 'TEXT']], ['set_default_id']); snapshot.tables.CompanionSetLayoutDefaults = [{ set_default_id: 1, crop_set_key: 'p:1+v:10', layout_json: JSON.stringify({ cropSetKey: 'p:1+v:10', rows: [{ identityKey: 'p:1', plantId: 1 }, { identityKey: 'v:10', plantId: 1, varietyId: 10 }] }) }]; // NEW
    let source = C.capture(snapshot); source = C.putCatalog(source, 'scheduler_climate_model_plant_overrides_json', { 'test city::1': { enabled: true } }); const target = C.capture(snapshot); // NEW
    const request = C.proposal(C.newStore(source.schema), source, 'editor', {}, {}), result = C.review(target, request, request.changes.map(item => item.entityId)), rows = C.project(result.store).tables; // NEW
    const plantId = result.store.bindings[plantEntity(source)].key.plant_id, varietyEntity = Object.entries(source.bindings).find(([, binding]) => binding.table === 'PlantVarieties')[0], varietyId = result.store.bindings[varietyEntity].key.variety_id; // NEW
    const layout = rows.CompanionSetLayoutDefaults.find(row => row.set_default_id !== 1); assert.equal(layout.crop_set_key, 'p:' + plantId + '+v:' + varietyId); assert.equal(JSON.parse(layout.layout_json).rows[1].varietyId, varietyId); // NEW
    assert.ok(C.catalog(result.store, 'scheduler_climate_model_plant_overrides_json')['test city::' + plantId]); // NEW
}); // NEW
test('pinned manifests retain values while accepted heads advance and retirement preserves history', () => {
    const base = fixture(), next = edit(base, { spacing_cm: 30 }), retired = C.retire(next, plantEntity(next), true);
    assert.equal(C.project(retired, base.current).tables.Plants[0].spacing_cm, 20);
    assert.equal(C.project(retired).tables.Plants[0].spacing_cm, 30);
    assert.equal(C.project(retired).entities.find(item => item.table === 'Plants').retired, true);
    assert.equal(C.project(C.retire(retired, plantEntity(retired), false)).entities.find(item => item.table === 'Plants').retired, false);
});
test('relationships use portable identity rather than matching recipient numeric IDs or names', () => {
    const source = fixture('Lettuce'), target = fixture('Carrot'), request = C.proposal(C.newStore(source.schema), source, 'editor', {}, { gardenId: 'garden' });
    const result = C.review(target, request, request.changes.map(item => item.entityId));
    const rows = C.project(result.store).tables;
    assert.equal(rows.Plants.length, 2);
    const lettuce = rows.Plants.find(row => row.plant_name === 'Lettuce');
    assert.notEqual(lettuce.plant_id, 1);
    assert.equal(rows.PlantVarieties.find(row => row.variety_id !== 10).plant_id, lettuce.plant_id);
});
test('three-way merging preserves unrelated changes and requires explicit choices for same-field edits', () => {
    const base = fixture(), request = proposal(base, edit(base, { spacing_cm: 30 })), current = edit(base, { yield_per_plant_kg: 2 });
    let result = C.review(current, request, [plantEntity(base)]);
    assert.equal(result.conflicts.length, 0); assert.equal(C.project(result.store).tables.Plants[0].yield_per_plant_kg, 2);
    result = C.review(edit(base, { spacing_cm: 40 }), request, [plantEntity(base)]);
    assert.equal(result.conflicts[0].path, '/data/spacing_cm');
    result = C.review(edit(base, { spacing_cm: 40 }), request, [plantEntity(base)], { [plantEntity(base)]: { '/data/spacing_cm': 'incoming' } });
    assert.equal(result.conflicts.length, 0); assert.equal(C.project(result.store).tables.Plants[0].spacing_cm, 30);
    assert.equal(C.merge([1], [2], [3]).conflicts.length, 1);
});
test('template snapshots exclude pending messages and reset operational inventory', () => {
    let store = fixture(); store = C.putCatalogBatch(store, { equipment_inventory_json: { version: 1, items: [{ id: 'tractor', name: 'Tractor', status: 'owned', purchaseDate: '2026-01-01', availability: { mode: 'always' }, capabilities: ['till'] }] }, equipment_capability_registry_json: { version: 1, items: [{ id: 'till', name: 'Till' }] } }); // CHANGE
    const copied = C.template(edit(store, { spacing_cm: 30 }));
    assert.equal(Object.keys(copied.manifests).length, 1); assert.equal(copied.proposals, undefined);
    const equipment = C.resetInventory('equipment_inventory_json', C.catalog(copied, 'equipment_inventory_json'));
    assert.equal(equipment.items[0].status, 'wishlist'); assert.equal(equipment.items[0].purchaseDate, undefined); assert.equal(equipment.items[0].availability, undefined);
    assert.deepEqual(C.resetInventory('irrigation_catalog_json', { items: [{ id: 'pipe', stockState: 'owned', stockQuantity: 10 }] }).items[0], { id: 'pipe', stockState: 'unknown', stockQuantity: 0 });
});
test('catalog proposals select individual definitions and preserve a distinct item untouched', () => {
    let base = fixture(); base = C.putCatalog(base, 'task_type_registry_json', { version: 1, items: [{ id: 'sow', name: 'Sow' }, { id: 'water', name: 'Water' }] });
    const candidate = C.putCatalog(base, 'task_type_registry_json', { version: 1, items: [{ id: 'sow', name: 'Sow seeds' }, { id: 'water', name: 'Water beds' }] });
    const request = proposal(base, candidate); assert.equal(request.changes.filter(item => !item.dependency).length, 2);
    const selected = request.changes.find(item => item.candidate.data.item.id === 'water').entityId;
    const reviewed = C.review(base, request, [selected]);
    assert.deepEqual(C.catalog(reviewed.store, 'task_type_registry_json').items.map(item => item.name), ['Sow', 'Water beds']);
});
const emptyLog = () => ({ version: 1, requests: [], decisions: [] });
function envelope(store, log = emptyLog()) { return { references: JSON.stringify(store), proposals: JSON.stringify(log), catalogs: {} }; }
test('owner acceptance validates exact proposal data, stale bases, immutable messages and item idempotency', () => {
    const base = fixture(), request = proposal(base, edit(base, { spacing_cm: 30 })), log = { ...emptyLog(), requests: [request] }, selected = [plantEntity(base)], result = C.review(base, request, selected);
    const decision = { id: 'decision', proposalId: request.id, actor: 'owner', items: selected, status: 'accepted', before: base.current, after: result.store.current, resolutions: {} };
    const nextLog = { ...log, decisions: [decision] }, before = envelope(base, log), after = envelope(result.store, nextLog), policy = { actor: 'owner', owner: true, editor: true, gardenId: 'garden' };
    assert.equal(C.validateTransition(before, after, policy), true);
    assert.throws(() => C.validateTransition(before, after, { ...policy, actor: 'admin', owner: false }), /owner/);
    const tampered = C.clone(result.store); tampered.revisions[tampered.manifests[tampered.current].heads[plantEntity(base)]].data.spacing_cm = 999;
    assert.throws(() => C.validateTransition(before, envelope(tampered, nextLog), policy), /reviewed/);
    assert.throws(() => C.validateTransition(before, envelope(result.store, { ...nextLog, decisions: [{ ...decision, before: 'stale' }] }), policy), /stale/);
    assert.throws(() => C.logValid({ ...nextLog, decisions: [decision, { ...decision, id: 'duplicate' }] }), /Duplicate/);
    assert.throws(() => C.validateTransition(after, envelope(result.store, emptyLog()), policy), /immutable/);
});
test('only editors can append their own typed proposals, including when an administrator is not the owner', () => {
    const base = fixture(), request = proposal(base, edit(base, { spacing_cm: 30 })), before = envelope(base), after = envelope(base, { ...emptyLog(), requests: [request] });
    assert.equal(C.validateTransition(before, after, { actor: 'editor', editor: true, owner: false, gardenId: 'garden' }), true);
    assert.throws(() => C.validateTransition(before, after, { actor: 'viewer', editor: false, owner: false, gardenId: 'garden' }), /editor/);
    assert.throws(() => C.validateTransition(before, after, { actor: 'other', editor: true, owner: true, gardenId: 'garden' }), /own proposal/);
});
test('missing manifests, corrupted revisions and missing dependencies never fall back to local data', () => {
    const base = fixture(); assert.throws(() => C.project(base, 'missing'), /missing/);
    const corrupt = C.clone(base), entity = plantEntity(corrupt); delete corrupt.revisions[corrupt.manifests[corrupt.current].heads[entity]];
    assert.throws(() => C.project(corrupt), /identity/);
    const dependency = C.clone(base); delete dependency.manifests[dependency.current].heads[entity]; assert.throws(() => C.validate(dependency), /relationship/);
});
test('recalculation excludes missing/arrived dates, actual work, harvest, and garden-local date boundaries', () => {
    const future = { sow_date: '2026-10-21' }, today = C.localToday('America/Los_Angeles', new Date('2026-10-21T02:00:00Z'));
    assert.equal(today, '2026-10-20'); assert.equal(C.canRecalculate(future, [], today).ok, true);
    for (const attrs of [{}, { sow_date: '2026-10-20' }, { sow_date: '2026-02-30' }, { ...future, tg_completed: '1' }, { ...future, actual_yield_kg: '2' }]) assert.equal(C.canRecalculate(attrs, [], today).ok, false);
    assert.equal(C.canRecalculate(future, [{ workflow_state: 'DOING' }], today).ok, false);
    assert.equal(C.canRecalculate(future, [{ completed: '1' }], today).ok, false);
});
// The service accepts a database constructor; this adapter exercises real SQLite without Electron's native ABI.
class Sqlite {
    constructor(filename, options = {}) { this.db = new DatabaseSync(filename, { readOnly: options.readonly }); }
    prepare(sql) { const statement = this.db.prepare(sql); return { readonly: /^\s*(SELECT|PRAGMA)\b/i.test(sql), all: (...params) => statement.all(...(Array.isArray(params[0]) ? params[0] : params)), get: (...params) => statement.get(...(Array.isArray(params[0]) ? params[0] : params)), run: (...params) => statement.run(...(Array.isArray(params[0]) ? params[0] : params)) }; } // CHANGE
    exec(sql) { return this.db.exec(sql); }
    close() { this.db.close(); }
    transaction(fn) { return () => { this.db.exec('BEGIN'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }; }
}
test('captured reference views keep two gardens isolated and SQL writes stay in an explicit scratch draft', async () => {
    const a = fixture(), b = fixture('Carrot'), service = createReferenceDatabaseService({ Database: Sqlite, readDefaults() { throw new Error('Local defaults must not be used.'); } });
    const first = await service.request(1, 'create', { store: a, editable: true }), second = await service.request(1, 'create', { store: b });
    const opened = await service.request(1, 'open', { scopeId: first.scopeId, readOnly: false }), read = await service.request(1, 'open', { scopeId: second.scopeId });
    await service.request(1, 'exec', { dbId: opened.dbId, sql: 'UPDATE Plants SET spacing_cm=? WHERE plant_id=?', params: [40, 1] });
    const snapshot = await service.request(1, 'snapshot', { scopeId: first.scopeId }), candidate = C.capture(snapshot.snapshot, a);
    assert.equal(C.project(a).tables.Plants[0].spacing_cm, 20); assert.equal(C.project(candidate).tables.Plants[0].spacing_cm, 40);
    assert.equal((await service.request(1, 'query', { dbId: read.dbId, sql: 'SELECT plant_name FROM Plants' })).rows[0].plant_name, 'Carrot');
    await assert.rejects(service.request(2, 'query', { dbId: opened.dbId, sql: 'SELECT * FROM Plants' }), /unavailable/);
    await assert.rejects(service.request(1, 'exec', { dbId: read.dbId, sql: 'DELETE FROM Plants' }), /read-only/);
    await assert.rejects(service.request(1, 'exec', { dbId: opened.dbId, sql: "ATTACH DATABASE 'bad' AS other" }), /schema/);
    await assert.rejects(service.request(1, 'exec', { dbId: opened.dbId, sql: "BEGIN; ATTACH DATABASE 'bad' AS other" }), /schema/); // NEW
    service.closeOwner(1); await assert.rejects(service.request(1, 'open', { scopeId: first.scopeId }), /unavailable/);
});

test('SQL draft projections preserve unique conflict targets and never recycle a deleted numeric identity', async () => { // NEW
    const snapshot = C.project(fixture()); snapshot.schema.Plants.uniqueKeys = [['plant_name']]; const store = C.capture(snapshot), db = materialize(Sqlite, store); // NEW
    try { db.prepare('INSERT INTO Plants (plant_name,spacing_cm) VALUES (?,?) ON CONFLICT(plant_name) DO UPDATE SET spacing_cm=excluded.spacing_cm').run('Lettuce', 25); assert.equal(db.prepare('SELECT spacing_cm FROM Plants WHERE plant_id=1').get().spacing_cm, 25); db.prepare('DELETE FROM PlantVarieties').run(); db.prepare('DELETE FROM Plants').run(); db.prepare('INSERT INTO Plants (plant_name) VALUES (?)').run('Basil'); assert.ok(db.prepare('SELECT plant_id FROM Plants').get().plant_id > 1); } finally { db.close(); } // NEW
}); // NEW
test('the shipped reference snapshot materializes without local database access', () => {
    const source = new Sqlite(fileURLToPath(new URL('../trellis_database/Trellis_database.sqlite', import.meta.url)), { readonly: true }); // CHANGE
    try { const snapshot = snapshotDatabase(source), store = C.capture(snapshot), projected = materialize(Sqlite, store); try { assert.equal(projected.prepare('SELECT count(*) AS n FROM Plants').get().n, snapshot.tables.Plants.length); assert.equal(store.schema['Experiment results'], undefined); } finally { projected.close(); } }
    finally { source.close(); }
});
const escaped = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); // NEW
function canvas(store, log, group = null, taskState = '') { // NEW
    const users = { usersEnabled: true, users: [{ id: 'owner' }, { id: 'editor' }, { id: 'admin', admin: true }, { id: 'viewer' }] }; // NEW
    const grants = [{ userId: 'editor', capabilities: ['create_plantings'] }]; // NEW
    const attr = values => Object.entries(values).map(([key, value]) => key + '="' + escaped(value) + '"').join(' '); // NEW
    return '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_users_json="' + escaped(JSON.stringify(users)) + '"><mxCell parent="0"/></object><object id="garden" ' + attr({ garden_module: '1', trellis_owner_user_id: 'owner', trellis_access_grants_json: JSON.stringify(grants), [C.ATTR]: JSON.stringify(store), [C.PROPOSALS]: JSON.stringify(log) }) + '><mxCell vertex="1" parent="1"/></object>' + (group ? '<object id="planting" ' + attr(group) + '><mxCell vertex="1" parent="garden"><mxGeometry x="1" y="2" width="100" height="100" as="geometry"/></mxCell></object><object id="task" linkedTo="planting" workflow_state="' + taskState + '"><mxCell vertex="1" parent="garden"/></object>' : '') + '</root></mxGraphModel>'; // NEW
} // NEW
test('the actual signed collaboration replay rejects an administrator acceptance despite their higher editing rank', () => { // NEW
    const base = fixture(), request = proposal(base, edit(base, { spacing_cm: 31 })), log = { ...emptyLog(), requests: [request] }, reviewed = C.review(base, request, [plantEntity(base)]); // NEW
    const decision = { id: 'admin-decision', proposalId: request.id, actor: 'admin', items: [plantEntity(base)], status: 'accepted', before: base.current, after: reviewed.store.current, resolutions: {} }; // NEW
    const before = canvas(base, log), after = canvas(reviewed.store, { ...log, decisions: [decision] }), delta = diffObjects(before, after); // NEW
    const hold = { id: 'hold', kind: 'claim', schema: 2, deviceId: 'device', sessionId: 'session', userId: 'admin', clock: 1, parents: [], at: 1000, targets: delta.targets }; // NEW
    const result = replay(before, [hold, { ...hold, id: 'edit', kind: 'edit', clock: 2, parents: ['hold'], claimIds: ['hold'], at: 1001, ...delta }], 2000); // NEW
    assert.equal(result.accepted.length, 0); assert.ok(result.rejected.some(item => /owner/.test(item.reason))); // NEW
    assert.throws(() => validateReferenceChanges(before, after, 'admin'), /owner/); // NEW
}); // NEW
test('reference-specific XML authority permits gardener proposals and forbids viewer proposals and mutable requests', () => { // NEW
    const base = fixture(), request = proposal(base, edit(base, { spacing_cm: 31 })), before = canvas(base, emptyLog()), after = canvas(base, { ...emptyLog(), requests: [request] }); // NEW
    assert.doesNotThrow(() => validateReferenceChanges(before, after, 'editor')); // NEW
    assert.throws(() => validateReferenceChanges(before, canvas(base, { ...emptyLog(), requests: [{ ...request, author: 'viewer' }] }), 'viewer'), /editor/); // NEW
    assert.throws(() => validateReferenceChanges(after, canvas(base, { ...emptyLog(), requests: [{ ...request, note: 'Rewritten' }] }), 'editor'), /immutable/); // NEW
}); // NEW
test('XML acceptance protects started plantings and pins while allowing an explicitly selected future planting', () => { // NEW
    const data = C.project(fixture()); data.schema.Cities = table([['city_id', 'INTEGER'], ['timezone', 'TEXT']], ['city_id']); data.tables.Cities = [{ city_id: 1, timezone: 'UTC' }]; const base = C.capture(data); // NEW
    const request = proposal(base, edit(base, { spacing_cm: 31 })), log = { ...emptyLog(), requests: [request] }, reviewed = C.review(base, request, [plantEntity(base)]); // NEW
    const group = { tiler_group: '1', plant_id: '1', city_id: '1', sow_date: '2027-04-01', [C.PIN]: base.current }, at = Date.parse('2026-10-20T12:00:00Z'); // NEW
    const decision = { id: 'owner-decision', proposalId: request.id, actor: 'owner', items: [plantEntity(base)], status: 'accepted', before: base.current, after: reviewed.store.current, resolutions: {}, plantingIds: ['planting'], at: new Date(at).toISOString() }; // NEW
    const before = canvas(base, log, group, 'TODO'), after = canvas(reviewed.store, { ...log, decisions: [decision] }, { ...group, [C.PIN]: reviewed.store.current }, 'TODO'); // NEW
    assert.doesNotThrow(() => validateReferenceChanges(before, after, 'owner', at)); // NEW
    assert.throws(() => validateReferenceChanges(canvas(base, log, group, 'DOING'), after, 'owner', at), /started/); // NEW
    assert.throws(() => validateReferenceChanges(canvas(base, log, { ...group, planting_actual_yield_kg: '2' }, 'TODO'), after, 'owner', at), /started/); // NEW
    assert.throws(() => validateReferenceChanges(before, canvas(reviewed.store, { ...log, decisions: [{ ...decision, plantingIds: [] }] }, { ...group, [C.PIN]: reviewed.store.current }, 'TODO'), 'owner', at), /unselected/); // NEW
}); // NEW
test('catalog dependencies use portable IDs and repeated saves do not manufacture definition changes', () => { // NEW
    const base = C.putCatalogBatch(fixture(), { equipment_inventory_json: { version: 1, items: [{ id: 'hoe', name: 'Hoe', capabilities: ['till'], relevantCropIds: ['1'] }] }, equipment_capability_registry_json: { version: 1, items: [{ id: 'till', name: 'Tilling' }] } }); // NEW
    const definitions = C.catalog(base, 'equipment_inventory_json'), saved = C.putCatalog(base, 'equipment_inventory_json', definitions); // NEW
    assert.equal(saved.current, base.current); assert.deepEqual(definitions.items[0].capabilities, ['till']); // NEW
    const revision = Object.values(base.revisions).find(rev => rev.data.item?.id === 'hoe' && C.references(rev.data).length); assert.ok(revision); assert.equal(C.references(revision.data).length, 2); // NEW
}); // NEW
