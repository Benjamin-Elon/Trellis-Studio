/** Behavioral coverage for Guide autosave, safe rendering, and explicit recipe reuse. */ // CHANGE
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const plugin = fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins/Garden_Guide.js'), 'utf8');

function hooks() {
    const window = { __TRELLIS_GUIDE_TEST__: true };
    vm.runInNewContext(plugin, { window, Draw: { loadPlugin() {} }, URL, setTimeout, clearTimeout });
    return window.__TRELLIS_GUIDE_TEST_HOOKS__;
}

/** Simulated clock exercises debounce and composition without wall-clock races. */ // CHANGE
function autosaveFixture() {
    const { createAutosave } = hooks();
    let saved = 'Inherited', fail = false, next = 0;
    const writes = [], timers = new Map(), states = [];
    const controller = createAutosave({
        read: () => saved,
        write(value) { if (fail) throw new Error('Permission changed'); saved = value; writes.push(value); },
        schedule(fn, ms) { assert.equal(ms, 500); timers.set(++next, fn); return next; },
        cancelTimer(id) { timers.delete(id); },
        onState(state, error) { states.push([state, error && error.message]); }
    });
    return { controller, writes, timers, states, set fail(value) { fail = value; }, set saved(value) { saved = value; }, fire() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); } };
}

test('autosave commits the latest multiline typing burst once and flushes pending changes', () => {
    const f = autosaveFixture();
    f.controller.edit('First'); f.controller.edit('First\nSecond');
    assert.equal(f.timers.size, 1); assert.deepEqual(f.writes, []);
    f.fire(); assert.deepEqual(f.writes, ['First\nSecond']);
    f.controller.edit('First\nSecond'); assert.equal(f.timers.size, 0);
    f.controller.edit(''); assert.equal(f.controller.flush(), true);
    assert.deepEqual(f.writes, ['First\nSecond', '']); assert.equal(f.timers.size, 0);
});

test('composition cannot save partial input; failed writes retain text and retry', () => {
    const f = autosaveFixture();
    f.controller.beginComposition(); f.controller.edit('苗');
    assert.equal(f.timers.size, 0); assert.equal(f.controller.flush(), false);
    f.controller.endComposition('苗を植える'); f.fail = true; f.fire();
    assert.equal(f.controller.value(), '苗を植える'); assert.equal(f.controller.dirty(), true);
    assert.equal(f.states.at(-1)[0], 'failed');
    f.fail = false; assert.equal(f.controller.flush(), true); assert.deepEqual(f.writes, ['苗を植える']);
});

test('history reload and disposal cancel stale autosaves', () => {
    const f = autosaveFixture();
    f.controller.edit('Stale'); f.saved = 'Undone';
    assert.equal(f.controller.reload(), 'Undone'); f.fire(); assert.deepEqual(f.writes, []);
    f.controller.beginComposition(); f.controller.edit('Old composition'); f.controller.reload(); f.controller.endComposition('Old composition'); f.fire(); assert.deepEqual(f.writes, []); // CHANGE
    f.controller.edit('Discarded'); f.controller.dispose(); f.fire();
    assert.deepEqual(f.writes, []); assert.equal(f.controller.flush(), false);
});

test('recipe instruction patch preserves timing, other rules, and the original template', () => {
    const template = { version: 2, rules: [{ id: 'sow', title: 'Sow', startOffsetDays: 3 }, { id: 'harvest', instructions: 'Pick', repeatEveryDays: 2 }] };
    const result = hooks().withInstructions(template, 'sow', 'Sow carefully\nWater', { status: 'draft', sourceUrls: ['https://example.test/crop'] });
    assert.equal(result.rules[0].startOffsetDays, 3); assert.equal(result.rules[1].instructions, 'Pick');
    assert.equal(template.rules[0].instructions, undefined); assert.equal(result.rules[0].instructionProvenance.status, 'customized');
    assert.throws(() => hooks().withInstructions(template, 'missing', '', {}), /exactly one/);
    assert.throws(() => hooks().withInstructions({ rules: [{ id: 'sow' }, { id: 'sow' }] }, 'sow', '', {}), /exactly one/);
});

test('source links reject executable and local URL schemes', () => {
    const { sourceUrl } = hooks();
    assert.equal(sourceUrl('javascript:alert(1)'), null); assert.equal(sourceUrl('file:///secrets'), null);
    assert.equal(sourceUrl('https://example.test/crop'), 'https://example.test/crop');
});

/** Minimal host models real dialog close veto, permission changes, and model history events. */ // CHANGE
function dialogFixture() {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://trellis.test/' });
    const { window } = dom, document = window.document;
    const cells = new Map(), listeners = new Map(), historyListeners = new Map(), writes = [];
    let editable = true, reject = false, closeCallback = null, dialog = null;
    function cell(id, attributes) { const value = document.createElement('object'); Object.entries(attributes).forEach(([key, val]) => value.setAttribute(key, val)); const result = { id, value, getAttribute: key => result.value.getAttribute(key) }; cells.set(id, result); return result; }
    const card = cell('task', { kanban_card: '1', title: '<img src=x onerror=alert(1)>', task_instructions: 'Seeded draft', task_instruction_provenance_json: JSON.stringify({ status: 'draft', sourceUrls: ['javascript:alert(1)', 'https://example.test/source'], sourceNote: '<b>Source</b>' }) });
    const graph = { getModel: () => model };
    const model = { getCell: id => cells.get(id), addListener: (event, fn) => listeners.set(event, fn), removeListener(fn) { for (const [key, val] of listeners) if (val === fn) listeners.delete(key); } };
    const history = { addListener: (event, fn) => historyListeners.set(event, fn), removeListener(fn) { for (const [key, val] of historyListeners) if (val === fn) historyListeners.delete(key); } };
    const ui = {
        editor: { graph, undoManager: history },
        showDialog(node, w, h, modal, closable, onClose) { dialog = node; closeCallback = onClose; document.body.appendChild(node); },
        hideDialog() { if (closeCallback && closeCallback() === false) return false; dialog && dialog.remove(); dialog = null; return true; }
    };
    window.Trellis = { users: { canEditTaskDetails: () => editable }, taskCommands: { commitCardPatch(target, patch, options) {
        assert.equal(options.reflow, false); if (reject) return false;
        const value = target.value.cloneNode(true); Object.entries(patch).forEach(([key, val]) => val == null ? value.removeAttribute(key) : value.setAttribute(key, val)); target.value = value; writes.push(patch);
    } } };
    vm.runInNewContext(plugin, { window, document, Draw: { loadPlugin: register => register(ui) }, mxEvent: { CHANGE: 'change', UNDO: 'undo', REDO: 'redo' }, mxUtils: { button(text, fn) { const button = document.createElement('button'); button.textContent = text; button.addEventListener('click', fn); return button; } }, URL, setTimeout, clearTimeout });
    window.USL.guide.open(card);
    return { window, document, ui, card, cells, writes, historyListeners, listeners, cell,
        get dialog() { return dialog; }, set editable(value) { editable = value; }, set reject(value) { reject = value; },
        input(text) { const input = dialog.querySelector('textarea'); input.value = text; input.dispatchEvent(new window.Event('input')); },
        click(text) { [...dialog.querySelectorAll('button')].find(node => node.textContent === text).click(); }
    };
}

test('Guide opens without writes, renders safely, autosaves on close, and reset removes empty overrides', () => {
    const f = dialogFixture();
    assert.equal(f.writes.length, 0); assert.equal(f.dialog.querySelector('img'), null);
    assert.equal(f.dialog.querySelectorAll('a').length, 1); assert.equal(f.dialog.querySelector('b'), null);
    assert.equal(f.dialog.querySelector('textarea').value, 'Seeded draft');
    f.click('Reset to inherited instructions'); assert.equal(f.writes.length, 0); // CHANGE: an unchanged reset is not an undo edit.
    f.input('Pending text'); f.click('Reset to inherited instructions'); assert.equal(f.writes.length, 0); assert.equal(f.dialog.querySelector('textarea').value, 'Seeded draft'); // CHANGE
    f.input(''); f.dialog.querySelector('textarea').dispatchEvent(new f.window.Event('blur'));
    assert.equal(f.card.getAttribute('task_instruction_override'), '');
    f.click('Reset to inherited instructions'); assert.equal(f.card.getAttribute('task_instruction_override'), null);
    assert.equal(f.dialog.querySelector('textarea').value, 'Seeded draft');
    f.input('1. Sow\n2. Water'); f.click('Close');
    assert.equal(f.card.getAttribute('task_instruction_override'), '1. Sow\n2. Water'); assert.equal(f.dialog, null);
    f.window.close();
});

test('permission change and rejected writes veto close, preserve entered text, and permit retry', () => {
    const f = dialogFixture(); f.input('Keep this text'); f.editable = false;
    assert.equal(f.ui.hideDialog(), false); assert.equal(f.dialog.querySelector('textarea').value, 'Keep this text');
    assert.match(f.dialog.textContent, /permission/); assert.equal(f.card.getAttribute('task_instruction_override'), null);
    f.editable = true; f.reject = true; f.click('Retry save'); assert.match(f.dialog.textContent, /could not be saved/);
    f.reject = false; f.click('Retry save'); f.click('Close');
    assert.equal(f.card.getAttribute('task_instruction_override'), 'Keep this text'); f.window.close();
});

test('history and deletion cannot resurrect pending Guide edits', () => {
    const f = dialogFixture(); f.input('Stale'); f.historyListeners.get('undo')();
    assert.equal(f.dialog.querySelector('textarea').value, 'Seeded draft'); assert.equal(f.writes.length, 0);
    f.input('Removed task text'); f.cells.delete('task'); f.listeners.get('change')();
    assert.equal(f.dialog.querySelector('textarea').value, 'Removed task text');
    assert.equal(f.dialog.querySelector('textarea').disabled, true);
    f.click('Discard unsaved text and close'); assert.equal(f.dialog, null); assert.equal(f.writes.length, 0); f.window.close();
});

test('Guide saves recipe copies and explicitly updates only compatible owned recipe instructions', async () => {
    const f = dialogFixture();
    const garden = f.cell('garden', { garden_module: '1' }), group = f.cell('group', { tiler_group: '1', plant_name: 'Carrot', growth_stage_label: 'Mature' });
    f.card.value.setAttribute('linkedTo', 'group'); f.card.value.setAttribute('scheduler_rule_id', 'sow');
    const template = { version: 2, rules: [{ id: 'sow', startOffsetDays: 1 }, { id: 'harvest', instructions: 'Harvest', repeatEveryDays: 7 }] };
    const recipes = [{ id: 'owned', name: 'Owned', plantId: 1, methodIds: ['direct_sow.field'], growthStageKeys: ['mature'], template }, { id: 'other', name: 'Other owner', plantId: 1, methodIds: ['direct_sow.field'], growthStageKeys: ['mature'], template }];
    const saved = [];
    f.window.USL.scheduler = { taskGuide: {
        resolveContext: async () => ({ moduleCell: garden, plantId: 1, methodId: 'direct_sow.field', growthStageKey: 'mature', template, rule: template.rules[0], plant: { planting_depth: '1 cm' } }),
        readRecipes: () => recipes, canUpdateRecipe: recipe => recipe.id === 'owned',
        saveRecipe(moduleCell, recipe, options) { assert.equal(moduleCell, garden); saved.push({ recipe, options }); }
    } };
    f.click('Close'); f.window.USL.guide.open(f.card); await new Promise(resolve => setImmediate(resolve));
    f.input('Custom sowing'); f.click('Save as new recipe');
    assert.equal(f.card.getAttribute('task_instruction_override'), 'Custom sowing');
    f.dialog.querySelector('[aria-label="New recipe name"]').value = 'My carrots'; f.click('Create recipe'); await new Promise(resolve => setImmediate(resolve)); // CHANGE
    assert.equal(saved[0].recipe.name, 'My carrots'); assert.equal(saved[0].recipe.template.rules[1].instructions, 'Harvest');
    f.click('Update existing recipe'); assert.equal(f.dialog.querySelector('select').options.length, 1);
    f.click('Update recipe instructions'); await new Promise(resolve => setImmediate(resolve)); assert.equal(saved[1].options.allowUpdateId, 'owned'); // CHANGE
    assert.equal(saved[1].recipe.template.rules[0].startOffsetDays, 1); assert.equal(template.rules[0].instructions, undefined);
    f.click('Close'); f.window.close();
});

test('legacy duplicate links are normalized and ambiguous plantings require a choice without overwriting typed guidance', async () => { // CHANGE
    const f = dialogFixture(); // CHANGE
    const garden = f.cell('garden', { garden_module: '1' }), first = f.cell('first', { tiler_group: '1', plant_name: 'Carrot' }), second = f.cell('second', { tiler_group: '1', plant_name: 'Pea' }); // CHANGE
    f.card.value.removeAttribute('task_instructions'); f.card.value.removeAttribute('task_instruction_provenance_json'); f.card.value.setAttribute('linkedTo', 'first, first ,second'); // CHANGE
    f.window.USL.scheduler = { taskGuide: { resolveContext: async group => ({ moduleCell: garden, plantId: 1, methodId: 'direct_sow.field', growthStageKey: 'mature', template: { rules: [{ id: 'sow' }] }, rule: { id: 'sow', instructions: group.id + ' instructions' } }), readRecipes: () => [], canUpdateRecipe: () => true } }; // CHANGE
    f.click('Close'); f.window.USL.guide.open(f.card); // CHANGE
    const select = f.dialog.querySelector('[aria-label="Linked planting"]'); assert.equal(select.options.length, 3); // CHANGE
    assert.match(f.dialog.textContent, /Choose a linked planting/); // CHANGE
    select.value = first.id; select.dispatchEvent(new f.window.Event('change')); await new Promise(resolve => setImmediate(resolve)); // CHANGE
    assert.equal(f.dialog.querySelector('textarea').value, 'first instructions'); assert.equal(f.writes.length, 0); // CHANGE
    select.value = second.id; select.dispatchEvent(new f.window.Event('change')); await new Promise(resolve => setImmediate(resolve)); // CHANGE
    assert.equal(f.dialog.querySelector('textarea').value, 'second instructions'); // CHANGE
    f.input('User text'); select.value = first.id; select.dispatchEvent(new f.window.Event('change')); await new Promise(resolve => setImmediate(resolve)); // CHANGE
    assert.equal(f.dialog.querySelector('textarea').value, 'User text'); // CHANGE
    f.click('Close'); assert.equal(f.card.getAttribute('task_instruction_override'), 'User text'); f.window.close(); // CHANGE
}); // CHANGE
