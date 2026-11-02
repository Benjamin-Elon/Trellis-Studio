import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import fs from 'node:fs/promises'; // NEW
import { JSDOM } from 'jsdom'; // NEW
import { referenceCore as R } from '../src/main/trellis-reference-database.js'; // NEW
const directory = new URL('../drawio/src/main/webapp/plugins/garden_planner_plugins/', import.meta.url); // NEW
async function harness(t, options = {}) { // NEW
    const dom = new JSDOM('<!doctype html><body><button id="anchor">Inventories ▾</button><input id="underlying" value="Unsaved plan draft"></body>', { runScripts: 'outside-only' }); t.after(() => dom.window.close()); // NEW
    const window = dom.window, document = window.document, alerts = [], saves = []; // NEW
    let confirmations = 0, fail = options.fail || false; window.alert = message => alerts.push(message); window.confirm = () => { confirmations++; return options.confirm !== false; }; // NEW
    const references = R.capture({ schema: { Plants: { columns: [{ name: 'plant_id', type: 'INTEGER', pk: 1 }, { name: 'plant_name', type: 'TEXT', pk: 0 }], pk: ['plant_id'], foreignKeys: [] } }, tables: { Plants: [{ plant_id: 1, plant_name: 'Tomato' }] } }); // NEW
    const cropRef = Object.keys(references.bindings)[0], garden = { diagramId: 'diagram', pageId: 'page', gardenId: 'garden', name: 'Garden' }; // NEW
    for (const name of ['Trellis_Allocation_Core.js', 'Trellis_Seeds_Core.js']) window.eval(await fs.readFile(new URL(name, directory), 'utf8')); // NEW
    window.TrellisReferenceCore = R; // NEW
    let seeds = window.TrellisSeedsCore.normalize({ version: 1, initialized: true, items: [{ cropRef, seeds: 100 }] }); // NEW
    window.trellisInventories = { async list() { return { gardens: options.gardens || [garden] }; }, async read() { return { garden, seeds, plans: options.plans || { 2026: { year: 2026, crops: [{ cropRef, seedsReq: 40 }] } }, references, canEdit: options.canEdit !== false }; }, async saveSeeds(input) { saves.push(input); if (fail) throw new Error('The seed inventory changed. Reconcile the latest stock.'); seeds = window.TrellisSeedsCore.normalize({ ...seeds, items: input.items }); } }; // CHANGE
    await window.eval(await fs.readFile(new URL('Trellis_Inventories.js', directory), 'utf8')); // NEW
    const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text); // NEW
    const settle = () => new Promise(resolve => setTimeout(resolve, 0)); // NEW
    return { window, document, saves, alerts, button, settle, get confirmations() { return confirmations; }, setFailure: value => { fail = value; } }; // NEW
} // NEW
test('inventory dropdown exposes Equipment and Seeds and Escape returns focus to its anchor', async t => { // NEW
    const h = await harness(t), anchor = h.document.querySelector('#anchor'); // NEW
    h.window.TrellisInventories.showMenu(anchor); assert.deepEqual([...h.document.querySelector('[role="menu"]').children].map(node => node.textContent), ['Equipment', 'Seeds']); // NEW
    h.button('Seeds').dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert.equal(h.document.querySelector('[role="menu"]'), null); assert.equal(h.document.activeElement, anchor); // NEW
}); // NEW
test('seed edits preserve the underlying plan, save current stock, and update the base for subsequent saves', async t => { // NEW
    const h = await harness(t); h.document.querySelector('#underlying').focus(); // NEW
    await h.window.TrellisInventories.openSeeds(); // NEW
    const dialog = h.document.querySelector('[role="dialog"]'), row = dialog.querySelector('tbody tr'); assert.match(row.textContent, /Tomato/); assert.match(row.textContent, /40/); // NEW
    let quantity = row.querySelectorAll('input')[1]; quantity.value = '70'; quantity.dispatchEvent(new h.window.Event('change')); // NEW
    h.button('Save').click(); await h.settle(); await h.settle(); assert.equal(h.saves[0].items[0].seeds, 70); // NEW
    quantity = dialog.querySelectorAll('tbody tr input')[1]; quantity.value = '60'; quantity.dispatchEvent(new h.window.Event('change')); // NEW
    h.button('Save').click(); await h.settle(); await h.settle(); assert.equal(h.saves[1].base.items[0].seeds, 70); // NEW
    assert.equal(h.document.querySelector('#underlying').value, 'Unsaved plan draft'); // NEW
    h.button('Close').click(); assert.equal(h.document.querySelector('[role="dialog"]'), null); assert.equal(h.document.activeElement.id, 'underlying'); // NEW
}); // NEW
test('stale-save errors retain edits, retry remains possible, and Escape respects the dirty draft', async t => { // NEW
    const h = await harness(t, { fail: true, confirm: false }); await h.window.TrellisInventories.openSeeds(); // NEW
    const dialog = h.document.querySelector('[role="dialog"]'); let quantity = dialog.querySelectorAll('tbody tr input')[1]; quantity.value = '45'; quantity.dispatchEvent(new h.window.Event('change')); // NEW
    h.button('Save').click(); await h.settle(); assert.match(dialog.querySelector('[role="status"]').textContent, /changed/); // NEW
    quantity = dialog.querySelectorAll('tbody tr input')[1]; assert.equal(quantity.value, '45'); // NEW
    dialog.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert.equal(h.confirmations, 1); assert.equal(dialog.isConnected, true); // NEW
    h.setFailure(false); h.button('Save').click(); await h.settle(); await h.settle(); assert.match(dialog.querySelector('[role="status"]').textContent, /saved/); // NEW
}); // NEW
test('weight conversion keeps canonical seed stock stable and read-only inventories expose no Save action', async t => { // NEW
    const h = await harness(t); await h.window.TrellisInventories.openSeeds(); // NEW
    let row = h.document.querySelector('tbody tr'), unit = row.querySelector('select'); unit.value = 'g'; unit.dispatchEvent(new h.window.Event('change')); // NEW
    row = h.document.querySelector('tbody tr'); const conversion = row.querySelector('input'); conversion.value = '20'; conversion.dispatchEvent(new h.window.Event('change')); // NEW
    row = h.document.querySelector('tbody tr'); assert.equal(row.querySelectorAll('input')[1].value, '5'); // NEW
    h.button('Save').click(); await h.settle(); await h.settle(); assert.equal(h.saves[0].items[0].seeds, 100); assert.equal(h.saves[0].items[0].seedsPerUnit, 20); // NEW
    const other = await harness(t, { canEdit: false }); await other.window.TrellisInventories.openSeeds(); assert.equal(other.button('Save'), undefined); assert.equal([...other.document.querySelectorAll('tbody input,tbody select')].every(node => node.disabled), true); // NEW
}); // NEW
test('canceling a multiple-garden picker, including Escape, leaves no pending inventory dialog', async t => { // NEW
    const h = await harness(t, { gardens: [{ diagramId: 'a', gardenId: 'a', name: 'A' }, { diagramId: 'b', gardenId: 'b', name: 'B' }] }); // NEW
    const pending = h.window.TrellisInventories.openSeeds(); await h.settle(); const picker = h.document.querySelector('[role="dialog"]'); // NEW
    picker.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await pending; assert.equal(h.document.querySelector('[role="dialog"]'), null); // NEW
}); // NEW
test('unmapped published crops leave stock editable without manufacturing available surplus', async t => { // NEW
    const h = await harness(t, { plans: { 2026: { year: 2026, crops: [{ plantId: 'unmapped', seedsReq: 40 }] } } }); // NEW
    await h.window.TrellisInventories.openSeeds(); // NEW
    const dialog = h.document.querySelector('[role="dialog"]'); assert.ok(dialog); // NEW
    assert.match(dialog.textContent, /protection.*unavailable/i); assert.match(dialog.querySelector('tbody').textContent, /Unknown/); // NEW
    assert.equal(h.alerts.length, 0); assert.ok(h.button('Save')); // NEW
}); // NEW
test('Home Equipment keeps its comparison base immutable and refreshes it after each save', async t => { // NEW
    const h = await harness(t), readSeeds = h.window.trellisInventories.read, calls = []; // NEW
    let accepted = { equipment: { version: 1, items: [{ id: 'tool', name: 'Tool', quantity: 1 }] }, taskTypes: { version: 1, items: [{ id: 'sow', name: 'Sowing' }] }, capabilities: { version: 1, items: [] } }, save; // NEW
    h.window.trellisInventories.read = async () => ({ ...await readSeeds(), ...JSON.parse(JSON.stringify(accepted)) }); // NEW
    h.window.trellisInventories.saveEquipment = async request => { calls.push(JSON.parse(JSON.stringify(request))); accepted.equipment = JSON.parse(JSON.stringify(request.catalogs.equipment_inventory_json)); }; // NEW
    h.window.TrellisEquipmentEditor = { open(snapshot, callback) { snapshot.taskTypes.items[0].name = 'Edited draft'; save = callback; } }; // NEW
    h.window.TrellisInventories.showMenu(h.document.querySelector('#anchor')); h.button('Equipment').click(); await h.settle(); // NEW
    const catalogs = { equipment_inventory_json: { version: 1, items: [{ id: 'tool', name: 'Tool', quantity: 2 }] } }; // NEW
    await save(catalogs); assert.equal(calls[0].base.taskTypes.items[0].name, 'Sowing'); // NEW
    catalogs.equipment_inventory_json.items[0].quantity = 3; await save(catalogs); // NEW
    assert.equal(calls[1].base.equipment.items[0].quantity, 2); // NEW
}); // NEW
