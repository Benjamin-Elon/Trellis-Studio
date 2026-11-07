import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import fs from 'node:fs/promises'; // NEW
import { JSDOM } from 'jsdom'; // NEW
import { referenceCore as R } from '../src/main/trellis-reference-database.js'; // NEW
const directory = new URL('../drawio/src/main/webapp/plugins/garden_planner_plugins/', import.meta.url); // NEW
/** Supply layout and identity notifications while executing the actual shared Exchange controller. */ // NEW
async function exchangeHarness(t, options = {}) { // NEW
    const h = await harness(t), anchor = h.document.querySelector('#anchor'), statusListeners = new Set(), lockListeners = new Set(); // NEW
    let session = options.signedOut ? null : { identityId: 'alice', generation: 1 }, status = options.status || { qualified: false, reason: 'The Exchange service is not ready.' }, reads = 0; // NEW
    anchor.textContent = 'The Grand Exchange'; anchor.title = 'Open community seed trading and CSA'; anchor.getClientRects = () => anchor.isConnected && !anchor.hidden ? [{}] : []; // NEW
    h.window.trellisIdentity = { getSession: async () => session, onStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); }, onLocked(fn) { lockListeners.add(fn); return () => lockListeners.delete(fn); } }; // NEW
    h.window.trellisExchange = { async status() { reads++; if (status instanceof Error) throw status; return typeof status === 'function' ? status() : status; } }; // NEW
    const control = h.window.TrellisInventories.bindExchangeButton(anchor, options.getOptions); t.after(() => control.dispose()); // NEW
    return { ...h, anchor, control, statusListeners, lockListeners, get reads() { return reads; }, setStatus(value) { status = value; }, changeIdentity(value, locked = false) { session = value; for (const fn of locked ? lockListeners : statusListeners) fn({ session }); } }; // NEW
} // NEW
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
test('unavailable Exchange remains focusable and explains sign-in on focus, hover, and click without opening', async t => { // NEW
    const h = await exchangeHarness(t, { signedOut: true }); // NEW
    assert.equal(h.anchor.getAttribute('aria-disabled'), 'true'); assert.equal(h.anchor.disabled, false); await h.control.refresh(); assert.equal(h.reads, 0); // NEW
    h.anchor.focus(); let tooltip = h.document.querySelector('[role="tooltip"]'); assert.match(tooltip.textContent, /Log in/); assert.equal(h.anchor.getAttribute('aria-describedby'), tooltip.id); // NEW
    h.anchor.dispatchEvent(new h.window.MouseEvent('mouseleave')); await new Promise(resolve => setTimeout(resolve, 140)); assert.ok(tooltip.isConnected, 'Keyboard focus keeps the explanation visible'); // NEW
    const escape = new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); h.anchor.dispatchEvent(escape); assert.equal(escape.defaultPrevented, true); assert.equal(tooltip.isConnected, false); assert.equal(h.document.activeElement, h.anchor); // NEW
    h.anchor.blur(); h.anchor.dispatchEvent(new h.window.MouseEvent('mouseenter')); assert.ok(tooltip.isConnected); // NEW
    h.anchor.dispatchEvent(new h.window.MouseEvent('mouseleave')); tooltip.dispatchEvent(new h.window.MouseEvent('mouseenter')); await new Promise(resolve => setTimeout(resolve, 140)); assert.ok(tooltip.isConnected, 'The explanation is hoverable across the gap'); // NEW
    tooltip.dispatchEvent(new h.window.MouseEvent('mouseleave')); await new Promise(resolve => setTimeout(resolve, 140)); assert.equal(tooltip.isConnected, false); // NEW
    h.anchor.click(); await h.settle(); assert.ok(tooltip.isConnected); assert.equal(h.document.querySelector('[role="dialog"]'), null); // NEW
    h.document.querySelector('#underlying').dispatchEvent(new h.window.Event('pointerdown', { bubbles: true })); assert.equal(tooltip.isConnected, false); assert.equal(h.anchor.hasAttribute('aria-describedby'), false); // NEW
}); // NEW
test('ready Exchange opens once with current options without requiring a city or garden setup', async t => { // NEW
    const resolved = []; let garden = { id: 'first' }; // NEW
    const h = await exchangeHarness(t, { status: { qualified: true, currency: '' }, getOptions: () => { resolved.push(garden); return { garden }; } }); await h.control.refresh(); // NEW
    assert.equal(h.anchor.getAttribute('aria-disabled'), 'false'); garden = { id: 'second' }; h.anchor.click(); h.anchor.click(); await h.settle(); // NEW
    assert.deepEqual(resolved, [garden]); assert.equal(h.document.querySelectorAll('[role="dialog"]').length, 1); assert.match(h.document.querySelector('[role="dialog"]').textContent, /Choose your city/); // NEW
    assert.equal(h.document.querySelector('[role="tooltip"]'), null); assert.equal(h.anchor.title, 'Open community seed trading and CSA'); // NEW
}); // NEW
test('activation rechecks readiness and status failures remain grey and recover on window focus', async t => { // NEW
    const h = await exchangeHarness(t, { status: { qualified: true } }); await h.control.refresh(); // NEW
    h.setStatus({ qualified: false, reason: '<img src=x onerror=alert(1)> Service is unavailable.' }); h.anchor.click(); await h.settle(); // NEW
    assert.equal(h.document.querySelector('[role="dialog"]'), null); assert.match(h.document.querySelector('[role="tooltip"]').textContent, /<img/); assert.equal(h.document.querySelector('img'), null); // NEW
    h.setStatus(new Error('Connection lost. Try again.')); await h.control.refresh(); assert.match(h.document.querySelector('[role="tooltip"]').textContent, /Unable to check.*Connection lost/); // NEW
    h.setStatus({ qualified: true }); h.window.dispatchEvent(new h.window.Event('focus')); await h.settle(); assert.equal(h.anchor.getAttribute('aria-disabled'), 'false'); assert.equal(h.document.querySelector('[role="tooltip"]'), null); // NEW
}); // NEW
test('a newly unavailable focus check explains itself, and dismissal survives its pending result', async t => { // NEW
    const h = await exchangeHarness(t, { status: { qualified: true } }); await h.control.refresh(); h.setStatus({ qualified: false, reason: 'Service is offline.' }); h.anchor.focus(); await h.settle(); // NEW
    assert.match(h.document.querySelector('[role="tooltip"]').textContent, /offline/); // NEW
    let finish; h.setStatus(() => new Promise(resolve => { finish = resolve; })); h.anchor.dispatchEvent(new h.window.MouseEvent('mouseenter')); await h.settle(); // NEW
    h.anchor.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); finish({ qualified: false, reason: 'Still offline.' }); await h.settle(); assert.equal(h.document.querySelector('[role="tooltip"]'), null); // NEW
    h.setStatus({ qualified: false, reason: 'Service is offline.' }); h.anchor.click(); await h.settle(); h.document.querySelector('#underlying').focus(); h.anchor.dispatchEvent(new h.window.MouseEvent('mouseleave')); await new Promise(resolve => setTimeout(resolve, 140)); assert.equal(h.document.querySelector('[role="tooltip"]'), null, 'Tabbing away releases a click-opened explanation'); // NEW
}); // NEW
test('missing bridges and unfinished qualification explain availability without exposing internal prerequisites', async t => { // NEW
    const h = await exchangeHarness(t); delete h.window.trellisExchange; await h.control.refresh(); h.anchor.click(); await h.settle(); assert.match(h.document.querySelector('[role="tooltip"]').textContent, /unavailable in this build/); // NEW
    h.window.trellisExchange = { status: async () => ({ qualified: false, reason: 'The Grand Exchange is awaiting qualified coordinator peer and community synchronization, garden authorization, and durable inventory reservation receipts.' }) }; // NEW
    await h.control.refresh(); assert.match(h.document.querySelector('[role="tooltip"]').textContent, /app update/); assert.doesNotMatch(h.document.querySelector('[role="tooltip"]').textContent, /coordinator|receipts/); // NEW
}); // NEW
test('identity invalidation cancels an in-flight activation and discards late readiness results', async t => { // NEW
    let finish; const h = await exchangeHarness(t, { status: () => new Promise(resolve => { finish = resolve; }) }); await h.settle(); // NEW
    h.anchor.focus(); h.anchor.click(); const reads = h.reads; h.anchor.dispatchEvent(new h.window.MouseEvent('mouseenter')); assert.equal(h.reads, reads, 'Interaction reads are coalesced'); // NEW
    h.changeIdentity(null, true); await h.settle(); finish({ qualified: true }); await h.settle(); // NEW
    assert.equal(h.anchor.getAttribute('aria-disabled'), 'true'); assert.equal(h.document.querySelector('[role="dialog"]'), null); // NEW
    assert.match(h.document.querySelector('[role="tooltip"]').textContent, /Log in/, 'Identity invalidation updates the focused explanation'); // NEW
    h.setStatus({ qualified: true }); h.changeIdentity({ identityId: 'bob', generation: 2 }); await h.settle(); assert.equal(h.anchor.getAttribute('aria-disabled'), 'false'); // NEW
}); // NEW
test('hiding or disposing Exchange removes explanations and prevents detached pending activations', async t => { // NEW
    const h = await exchangeHarness(t); await h.control.refresh(); h.anchor.setAttribute('aria-describedby', 'existing-help'); h.anchor.focus(); assert.match(h.anchor.getAttribute('aria-describedby'), /existing-help trellis-exchange/); // NEW
    h.control.dismiss(); assert.equal(h.anchor.getAttribute('aria-describedby'), 'existing-help'); assert.equal(h.document.querySelector('[role="tooltip"]'), null); // NEW
    let finish; h.setStatus(() => new Promise(resolve => { finish = resolve; })); h.anchor.click(); await h.settle(); h.anchor.hidden = true; h.control.dismiss(); h.anchor.hidden = false; finish({ qualified: true }); await h.settle(); assert.equal(h.document.querySelector('[role="dialog"]'), null, 'An immediate reopen cannot revive a hidden surface activation'); // NEW
    h.anchor.hidden = false; h.control.dispose(); h.control.dispose(); assert.equal(h.statusListeners.size, 0); assert.equal(h.lockListeners.size, 0); h.anchor.click(); h.anchor.focus(); await h.settle(); assert.equal(h.document.querySelector('[role="tooltip"]'), null); // NEW
    const other = await exchangeHarness(t, { status: () => new Promise(resolve => { finish = resolve; }) }); await other.settle(); other.anchor.click(); other.control.dispose(); finish({ qualified: true }); await other.settle(); assert.equal(other.document.querySelector('[role="dialog"]'), null); assert.equal(other.anchor.getAttribute('aria-disabled'), 'true'); // NEW
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
test('a delayed seed save preserves newer quantities and the next save uses the accepted older base', async t => { // CHANGE
    const h = await harness(t), save = h.window.trellisInventories.saveSeeds; let release, started; const ready = new Promise(resolve => { started = resolve; }); // CHANGE
    h.window.trellisInventories.saveSeeds = async input => { started(); await new Promise(resolve => { release = resolve; }); return save(input); }; // CHANGE
    await h.window.TrellisInventories.openSeeds(); const dialog = h.document.querySelector('[role="dialog"]'); // CHANGE
    let quantity = dialog.querySelectorAll('tbody input')[1]; quantity.value = '70'; quantity.dispatchEvent(new h.window.Event('change')); h.button('Save').click(); await ready; // CHANGE
    quantity = dialog.querySelectorAll('tbody input')[1]; quantity.value = '60'; quantity.dispatchEvent(new h.window.Event('change')); release(); await h.settle(); await h.settle(); // CHANGE
    assert.equal(dialog.querySelectorAll('tbody input')[1].value, '60'); assert.match(dialog.querySelector('[role="status"]').textContent, /Newer edits remain/); // CHANGE
    h.window.trellisInventories.saveSeeds = save; h.button('Save').click(); await h.settle(); await h.settle(); assert.equal(h.saves[1].base.items[0].seeds, 70); assert.equal(h.saves[1].items[0].seeds, 60); // CHANGE
}); // CHANGE
