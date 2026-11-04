/** Real scheduler tabs and details sections share the production transition registry. */ // CHANGE
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'); // CHANGE
const holdsSource = fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-editing-holds.js'), 'utf8'); // CHANGE
const { createSchedulerOverlapFixture, waitFor } = require('./helpers/scheduler-overlap-fixture.cjs'); // CHANGE

test('scheduler tabs preserve one draft and leaving the editor requires Commit, Discard or Stay', async t => { // CHANGE
    const h = createSchedulerOverlapFixture(t), w = h.api.__testWindow.document.defaultView; // CHANGE
    vm.runInNewContext(holdsSource, { window: w }); // CHANGE
    let choice = 'stay', prompts = 0; // CHANGE
    const registry = w.TrellisEditingHolds.create(h.ui, { isCollaborative: () => false, status(message) { console.log('NAVIGATION_STATUS', message); }, release: async () => {}, decide: async () => { prompts++; return choice; } }); // CHANGE
    const sharing = { registerEditor: config => registry.register(config), transitionEditor: operation => registry.transition(operation), automationHolds: () => [] }; // CHANGE
    h.api.__testWindow.Trellis = { sharing }; h.graph.__trellisSharing = sharing; h.graph.removeCells([h.basil]); // CHANGE
    await h.open(); const dialog = h.getDialog(), date = dialog.querySelector('input[type="date"]'); assert.ok(date); const initial = date.value; // CHANGE
    date.value = '2026-10-18'; h.dispatch(date, 'input'); h.dispatch(date, 'change'); // CHANGE
    h.button('Tasks').click(); await waitFor(() => dialog.querySelector('.usl-scheduler-tab[data-active="true"]').textContent === 'Tasks'); assert.equal(prompts, 0); assert.equal(date.value, '2026-10-18'); assert.equal(h.state.taskCalls, 0); // CHANGE
    assert.equal(await sharing.transitionEditor(() => true), false); assert.equal(prompts, 1); assert.equal(date.value, '2026-10-18'); // CHANGE
    choice = 'discard'; assert.equal(await sharing.transitionEditor(() => true), true); assert.equal(date.value, initial); assert.equal(h.state.taskCalls, 0); // CHANGE
    h.button('Schedule').click(); await waitFor(() => dialog.querySelector('.usl-scheduler-tab[data-active="true"]').textContent === 'Schedule'); await new Promise(resolve => setImmediate(resolve)); // CHANGE
    date.value = '2026-10-19'; h.dispatch(date, 'input'); h.dispatch(date, 'change'); choice = 'commit'; h.button('Tasks').click(); await waitFor(() => dialog.querySelector('.usl-scheduler-tab[data-active="true"]').textContent === 'Tasks'); assert.equal(h.state.taskCalls, 0); await sharing.transitionEditor(() => true); // CHANGE
    await waitFor(() => h.state.taskCalls === 1 || [...dialog.querySelectorAll('div')].some(node => node.textContent.startsWith('Scheduling error:'))); assert.equal(h.state.taskCalls, 1, dialog.textContent); await waitFor(() => dialog.querySelector('.usl-scheduler-tab[data-active="true"]').textContent === 'Tasks'); // CHANGE
    assert.equal(dialog.isConnected, true); assert.equal(h.crop.getAttribute('sow_date'), '2026-10-19'); assert.deepEqual(Array.from(registry.pinnedTargets()), []); // CHANGE
}); // CHANGE

test('details formatting remains inside the editor; switching sections can discard without writing', async t => { // CHANGE
    const h = require('./helpers/object-details-harness.cjs')(t), w = h.w; w.eval(holdsSource); let choice = 'stay'; // CHANGE
    const registry = w.TrellisEditingHolds.create(h.ui, { isCollaborative: () => false, status() {}, release: async () => {}, decide: async () => choice }); // CHANGE
    h.w.Trellis.sharing = { registerEditor: config => registry.register(config) }; // CHANGE
    const cell = h.vertex('editing-section', '<p>Saved</p>'); h.graph.setSelectionCell(cell); await h.tick(); const field = h.input(cell); field.focus(); h.type(cell, '<p>Draft</p>'); // CHANGE
    const panel = field.closest('.trellis-object-details'), comments = panel.querySelector('[data-details-tab="comments"]'); comments.click(); await h.tick(); assert.equal(field.style.display, ''); assert.equal(cell.getAttribute('trellis_details_html'), '<p>Saved</p>'); // CHANGE
    choice = 'discard'; comments.click(); await h.tick(); assert.equal(field.innerHTML, '<p>Saved</p>'); assert.equal(field.style.display, 'none'); assert.equal(cell.getAttribute('trellis_details_html'), '<p>Saved</p>'); // CHANGE
}); // CHANGE
