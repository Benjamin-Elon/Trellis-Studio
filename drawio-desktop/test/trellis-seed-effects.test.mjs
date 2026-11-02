import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import fs from 'node:fs/promises'; // NEW
import os from 'node:os'; // NEW
import path from 'node:path'; // NEW
import crypto from 'node:crypto'; // NEW
import { prepareSeedTransaction, validateSeedTransaction, initializeCopiedSeedInventories } from '../src/main/trellis-seed-effects.js'; // NEW
import { inspectDiagram } from '../src/main/trellis-share-protocol.js'; // NEW
import { validatePermissionChanges } from '../src/main/trellis-permission-policy.js'; // NEW
import { referenceCore as R } from '../src/main/trellis-reference-database.js'; // NEW
import { createCollaborationStore } from '../src/main/trellis-collaboration-store.js'; // NEW
const S = globalThis.TrellisSeedsCore; // NEW
const references = R.capture({ schema: { Plants: { columns: [{ name: 'plant_id', type: 'INTEGER', pk: 1 }, { name: 'plant_name', type: 'TEXT', pk: 0 }], pk: ['plant_id'], foreignKeys: [] } }, tables: { Plants: [{ plant_id: 1, plant_name: 'Tomato' }] } }); // NEW
const cropRef = Object.keys(references.bindings)[0]; // NEW
const stock = seeds => S.normalize({ version: 1, initialized: true, items: [{ cropRef, seeds, unit: 'seed', seedsPerUnit: 1 }] }); // NEW
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'); // NEW
function diagram({ inventory = stock(100), completed = false, quantity, taskType = 'direct_sowing', stage, crops = [{ plantId: '1', germRate: 0.8, seedsReq: 20 }] } = {}) { // CHANGE: exercise stage-specific requirements through the real XML adapter.
    const cell = (id, parent, attrs) => '<object id="' + id + '" ' + Object.entries(attrs).map(([key, value]) => key + '="' + escape(typeof value === 'object' ? JSON.stringify(value) : value) + '"').join(' ') + '><mxCell vertex="1" parent="' + parent + '"/></object>'; // NEW
    const users = { usersEnabled: true, users: [{ id: 'owner', name: 'Owner', admin: true }, { id: 'worker', name: 'Worker' }] }; // NEW
    return '<mxGraphModel><root><mxCell id="0"/>' + cell('1', '0', { trellis_users_json: users }) + // NEW
        cell('garden', '1', { garden_module: '1', trellis_owner_user_id: 'owner', trellis_access_grants_json: [{ userId: 'worker', preset: 'gardener' }], trellis_references_json: references, plan_year_json: { 2026: { year: 2026, crops } }, ...(inventory ? { [S.ATTR]: inventory } : {}) }) + // CHANGE
        cell('planting', 'garden', { tiler_group: '1', trellis_owner_user_id: 'worker', plant_id: '1', plant_count: '16', sow_date: '2026-06-01', linkedTo: 'task', ...(stage === undefined ? {} : { growth_stage_key: stage }) }) + // CHANGE
        cell('board', 'garden', { board_key: 'KANBAN_BOARD' }) + // NEW
        cell('task', 'board', { kanban_card: '1', createdByUserId: 'worker', linkedTo: 'planting', task_type_id: taskType, scheduler_task_key: 'sow::0', start: '2026-06-01', ...(completed ? { completed: '2026-06-01', workflow_state: 'DONE' } : {}), ...(quantity === undefined ? {} : { trellis_seed_quantity: quantity }) }) + '</root></mxGraphModel>'; // NEW
} // NEW
const inventory = xml => S.normalize(inspectDiagram(xml).cells.find(cell => cell.id === 'garden').node.getAttribute(S.ATTR)); // NEW
test('sowing requirements use the planting stage and keep planned protection separate from corrections', () => { // NEW
    const crops = [{ plantId: '1', growthStageKey: 'young', germRate: 0.5, seedsReq: 32 }, { plantId: '1', growthStageKey: 'mature', germRate: 0.8, seedsReq: 20 }]; // NEW
    const before = diagram({ crops }), completed = prepareSeedTransaction(before, diagram({ crops, completed: true })); // NEW
    assert.equal(inventory(completed).items[0].seeds, 80, 'missing stage means Mature'); // NEW
    const corrected = prepareSeedTransaction(completed, diagram({ crops, completed: true, quantity: 25, inventory: inventory(completed) })); // NEW
    assert.equal(inventory(corrected).items[0].seeds, 75); assert.equal(Object.values(inventory(corrected).usage)[0].plannedSeeds, 20); // NEW
    const young = prepareSeedTransaction(diagram({ crops, stage: 'Young' }), diagram({ crops, stage: 'Young', completed: true })); // NEW
    assert.equal(inventory(young).items[0].seeds, 68); // NEW
}); // NEW
test('historical ambiguous protection is flagged conservatively without changing actual seed deductions', () => { // NEW
    const state = stock(75); state.usage.old = { id: 'old', cropRef, year: 2026, active: true, seeds: 25, plannedSeeds: 32 }; // NEW
    const plans = { 2026: { year: 2026, crops: [{ cropRef, growthStageKey: 'young', germRate: 0.5, seedsReq: 32 }, { cropRef, germRate: 0.8, seedsReq: 20 }] } }; // NEW
    assert.equal(S.auditUsage(plans, state).length, 1); assert.equal(S.requirements(plans, state)[S.key({ cropRef })], 52); // NEW
    assert.equal(state.items[0].seeds, 75); assert.equal(state.usage.old.plannedSeeds, 32); // NEW
}); // NEW
test('completed requirement evidence remains frozen across later plan changes and actual corrections', () => { // NEW
    const before = diagram(), completed = prepareSeedTransaction(before, diagram({ completed: true })); // NEW
    const crops = [{ plantId: '1', germRate: 0.5, seedsReq: 32 }]; // NEW
    const corrected = prepareSeedTransaction(completed, diagram({ crops, completed: true, quantity: 25, inventory: inventory(completed) })); // NEW
    const effect = Object.values(inventory(corrected).usage)[0]; assert.equal(effect.plannedSeeds, 20); assert.equal(effect.requirementBasis.germRate, 0.8); // NEW
    assert.equal(S.auditUsage({ 2026: { year: 2026, crops } }, inventory(corrected), references).length, 0); // NEW
}); // NEW
test('accepted sowing effects include germination, reopening, correction and retransmission', () => { // NEW
    const before = diagram(), completed = prepareSeedTransaction(before, diagram({ completed: true })); // NEW
    assert.equal(inventory(completed).items[0].seeds, 80); // NEW
    assert.equal(validateSeedTransaction(before, completed).has('["","garden"]'), true); // NEW
    assert.equal(validatePermissionChanges(before, completed, 'worker', Date.now()).allowed, true); // NEW
    const corrected = prepareSeedTransaction(completed, diagram({ inventory: inventory(completed), completed: true, quantity: 25 })); // NEW
    assert.equal(inventory(corrected).items[0].seeds, 75); // NEW
    assert.equal(S.requirements({ 2026: { year: 2026, crops: [{ cropRef, seedsReq: 50 }] } }, inventory(corrected))[S.key({ cropRef })], 30, 'a quantity correction changes actual stock, not other outstanding planned sowings'); // NEW
    const reopened = prepareSeedTransaction(corrected, diagram({ inventory: inventory(corrected), quantity: 25 })); // NEW
    assert.equal(inventory(reopened).items[0].seeds, 100); // NEW
    const recompleted = prepareSeedTransaction(reopened, diagram({ inventory: inventory(reopened), completed: true, quantity: 25 })); // NEW
    assert.equal(inventory(recompleted).items[0].seeds, 75); // NEW
    assert.equal(inventory(prepareSeedTransaction(recompleted, recompleted)).items[0].seeds, 75); // NEW
}); // NEW
test('historical completed sowings baseline current stock; transplant tasks never deduct', () => { // NEW
    const before = diagram({ inventory: null, completed: true }); // NEW
    const initialized = prepareSeedTransaction(before, diagram({ completed: true })); // NEW
    assert.equal(inventory(initialized).items[0].seeds, 100); // NEW
    assert.equal(Object.values(inventory(initialized).usage)[0].baseline, true); // NEW
    const transplant = prepareSeedTransaction(diagram({ taskType: 'transplanting' }), diagram({ taskType: 'transplanting', completed: true })); // NEW
    assert.equal(inventory(transplant).items[0].seeds, 100); // NEW
}); // NEW
test('ledger forgery is rejected even for administrators; automatic effects cannot authorize stock edits', () => { // NEW
    const before = diagram(), forged = stock(100); forged.usage.fake = { active: true, seeds: 1 }; // NEW
    assert.throws(() => prepareSeedTransaction(before, diagram({ inventory: forged })), /validated domain operation/); // NEW
    assert.equal(validatePermissionChanges(before, diagram({ inventory: forged }), 'owner', Date.now()).allowed, false); // NEW
    assert.equal(validatePermissionChanges(before, diagram({ inventory: stock(500) }), 'worker', Date.now()).allowed, false); // NEW
    assert.equal(validatePermissionChanges(before, diagram({ inventory: stock(500) }), 'owner', Date.now()).allowed, true); // NEW
    assert.equal(validatePermissionChanges(before, diagram({ completed: true }), 'worker', Date.now()).allowed, false, 'raw task completion without its derived ledger is rejected'); // NEW
}); // NEW
test('real signed saves retain seed effects across duplicate delivery and coordinator restart', async t => { // NEW
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-seed-effects-')); // NEW
    t.after(async () => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('trellis-seed-effects-')); await fs.rm(root, { recursive: true, force: true }); }); // NEW
    const pair = crypto.generateKeyPairSync('ed25519'), keys = { privateKey: pair.privateKey, publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }) }; // NEW
    const canvas = { protocolVersion: 4, shareId: 'garden', diagramId: 'diagram', filename: 'Garden.drawio', folderPath: root, diagramPath: path.join(root, 'Garden.drawio'), coordinatorDeviceId: 'A', coordinatorPublicKey: keys.publicKey, members: [{ deviceId: 'A', userId: 'owner', publicKey: keys.publicKey }] }; // NEW
    const writeAtomic = async (filename, contents) => { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename + '.tmp', contents); await fs.rename(filename + '.tmp', filename); }; // NEW
    const writeImmutable = async (filename, value) => { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, JSON.stringify(value), { flag: 'wx' }); }; // NEW
    const create = () => createCollaborationStore({ canvas, keys, deviceId: 'A', profile: path.join(root, 'private'), writeAtomic, writeImmutable }); // NEW
    const store = create(), before = diagram(), after = diagram({ completed: true }); await store.initialize(before); // NEW
    const request = { kind: 'save', proposalId: 'sowing-completion', baseXml: before, xml: after }; // NEW
    const result = await store.action('editor', 'worker', request); // NEW
    assert.equal(result.ok, true, result.reason); // NEW
    assert.equal(inventory((await store.snapshot()).xml).items[0].seeds, 80); // NEW
    assert.equal((await store.action('editor', 'worker', request)).ok, true); // NEW
    const restarted = create(), state = await restarted.snapshot(); // NEW
    assert.equal(inventory(state.xml).items[0].seeds, 80); // NEW
    const reopened = state.xml.replace(' completed="2026-06-01"', '').replace(' workflow_state="DONE"', ''); // NEW
    assert.equal((await restarted.action('editor', 'worker', { kind: 'save', proposalId: 'sowing-reopen', baseXml: state.xml, xml: reopened })).ok, true); // NEW
    assert.equal(inventory((await restarted.snapshot()).xml).items[0].seeds, 100); // NEW
}); // NEW

test('multiple unsaved complete/reopen transitions are independently validated as one accepted save', () => { // NEW
    const before = diagram(); let local = before; // NEW
    for (const completed of [true, false, true]) local = prepareSeedTransaction(local, diagram({ inventory: inventory(local), completed })); // NEW
    assert.equal(inventory(local).items[0].seeds, 80); // NEW
    assert.equal(Object.values(inventory(local).usage)[0].revision, 3); // NEW
    assert.equal(prepareSeedTransaction(before, local), local); // NEW
    assert.equal(validateSeedTransaction(before, local).has('["","garden"]'), true); // NEW
}); // NEW

test('copies baseline historical completed tasks before the first new completion', () => { // NEW
    const baseline = initializeCopiedSeedInventories(diagram({ inventory: S.reset(stock(100)), completed: true })); // NEW
    assert.equal(inventory(baseline).items[0].seeds, 0); assert.equal(inventory(baseline).initialized, true); // NEW
    const newTask = baseline.replace('</root>', '<object id="new-sowing" task_type_id="direct_sowing" scheduler_task_key="new::0" linkedTo="planting" completed="2026-06-01"><mxCell vertex="1" parent="board"/></object></root>'); // NEW
    assert.equal(inventory(prepareSeedTransaction(baseline, newTask)).items[0].seeds, -20); // NEW
}); // NEW
