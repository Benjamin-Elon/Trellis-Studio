const test = require('node:test'); // NEW
const assert = require('node:assert/strict'); // NEW
const { fixture } = require('./helpers/garden-structures-harness.cjs'); // NEW
const { canvasViewControlsSource } = require('./helpers/canvas-view-controls-harness.cjs'); // NEW

function toolbarFixture(t) { // NEW
    let controls; t.after(() => controls?.dispose()); // NEW: release document listeners before the fixture closes its window.
    const f = fixture(t, { plugins: ['Garden_Scale.js'] }), doc = f.w.document, toolbar = doc.createElement('div'), zoom = doc.createElement('button'); // NEW
    zoom.className = 'geZoomInput'; zoom.textContent = '100%'; toolbar.appendChild(zoom); doc.body.appendChild(toolbar); // NEW
    const changes = []; let links = true, harvest = false; // NEW
    f.graph.__trellisPlantingLinking = { getShowLinks: () => links, setShowLinks: value => { links = value; changes.push(['links', value]); } }; // NEW
    f.graph.__trellisPlantingGroup = { growth: { getShowHarvestSize: () => harvest, setShowHarvestSize: (garden, value) => { assert.equal(garden, f.garden); harvest = value; changes.push(['harvest', value]); } } }; // NEW
    f.ui.editor = Object.assign(new f.w.mxEventSource(), { graph: f.graph }); f.ui.toolbar = { container: toolbar }; f.w.ui = f.ui; f.w.garden = f.garden; f.w.eval(canvasViewControlsSource()); // CHANGE: exercise production navigation and readiness subscriptions.
    const api = f.w.canvasControlsTest, trigger = toolbar.querySelector('.trellis-canvas-view-options'), popover = doc.querySelector('[aria-label="Canvas view options"]'); // NEW
    controls = api; // NEW
    return { ...f, doc, toolbar, zoom, trigger, popover, controls: api, changes }; // NEW
} // NEW

test('view dropdown replaces inline checkboxes, delegates unchanged scopes and remains open for multiple toggles', t => { // NEW
    const f = toolbarFixture(t), before = f.serialized(); f.undo.clear(); f.graph.setEnabled(false); // NEW
    assert.equal(f.zoom.nextSibling.dataset.trellisCanvasViewControls, '1'); assert.equal(f.toolbar.querySelectorAll('input').length, 0); // NEW
    assert.equal(f.trigger.textContent, 'View options ▾'); assert.equal(f.trigger.getAttribute('aria-expanded'), 'false'); // NEW
    assert.equal(f.popover.hidden, true); f.trigger.click(); assert.equal(f.popover.hidden, false); // NEW
    assert.equal(f.trigger.getAttribute('aria-expanded'), 'true'); assert.equal(f.doc.activeElement.dataset.trellisHarvestSize, '1'); // NEW
    const inputs = [...f.popover.querySelectorAll('input')]; assert.deepEqual(inputs.map(input => input.checked), [false, true, false]); // NEW
    inputs.forEach(input => input.click()); assert.deepEqual(f.changes, [['harvest', true], ['links', false]]); assert.equal(f.api.getShowSideLengths(), true); // NEW
    assert.equal(f.popover.hidden, false); assert.equal(f.serialized(), before); assert.equal(f.undo.history.length, 0); // NEW
    assert.match(f.popover.textContent, /Side lengths are always shown while editing a footprint/); // NEW
    f.controls.setGarden(null); assert.equal(inputs[0].disabled, true); assert.equal(inputs[1].disabled, false); assert.equal(inputs[2].disabled, false); // NEW
}); // NEW

test('Escape and outside interaction dismiss cleanly without reaching footprint shortcuts', async t => { // NEW
    const f = toolbarFixture(t), cell = f.api.create(f.garden); await f.api.editFootprint(cell); f.trigger.click(); // NEW
    const input = f.popover.querySelector('input'); input.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); // NEW
    assert.equal(f.popover.hidden, true); assert.equal(f.doc.activeElement, f.trigger); assert.ok(f.api.getDraft()); // NEW
    f.trigger.click(); const outside = f.doc.createElement('button'); f.doc.body.appendChild(outside); // NEW
    outside.dispatchEvent(new f.w.Event('pointerdown', { bubbles: true })); assert.equal(f.popover.hidden, true); assert.ok(f.api.getDraft()); // NEW
    f.trigger.click(); outside.focus(); assert.equal(f.popover.hidden, true); // NEW
}); // NEW

test('toolbar swaps reuse one control and popover, unavailable dependencies disable options, disposal stops rebuilding', async t => { // NEW
    const f = toolbarFixture(t), popover = f.popover; f.trigger.click(); f.toolbar.replaceChildren(); await f.tick(); assert.equal(popover.hidden, true); // NEW
    assert.equal(f.toolbar.querySelectorAll('[data-trellis-canvas-view-controls]').length, 0); // NEW
    f.toolbar.appendChild(f.zoom); await f.tick(); assert.equal(f.toolbar.querySelector('.trellis-canvas-view-options'), f.trigger); // NEW
    assert.equal(f.doc.querySelectorAll('[aria-label="Canvas view options"]').length, 1); // NEW
    const linking = f.graph.__trellisPlantingLinking; delete f.graph.__trellisPlantingLinking; const formatter = f.graph.__gardenScaleController.formatLengthFromUnits; delete f.graph.__gardenScaleController.formatLengthFromUnits; f.controls.refresh(); // NEW
    assert.equal(popover.querySelector('[data-trellis-show-links]').disabled, true); assert.equal(popover.querySelector('[data-trellis-show-structure-lengths]').disabled, true); // NEW
    f.graph.__trellisPlantingLinking = linking; f.graph.__gardenScaleController.formatLengthFromUnits = formatter; f.controls.refresh(); // NEW
    assert.equal(popover.querySelector('[data-trellis-show-links]').disabled, false); assert.equal(popover.querySelector('[data-trellis-show-structure-lengths]').disabled, false); // NEW
    f.controls.dispose(); assert.equal(popover.isConnected, false); f.toolbar.replaceChildren(f.zoom); await f.tick(); assert.equal(f.toolbar.children.length, 1); // NEW
}); // NEW

test('navigation dismisses the popover and readiness/preferences refresh the page-specific checkbox', t => { // NEW
    const f = toolbarFixture(t); f.api.setShowSideLengths(true); // NEW
    assert.equal(f.popover.querySelector('[data-trellis-show-structure-lengths]').checked, true); // NEW
    for (const event of ['pageSelected', 'fileLoaded']) { f.trigger.click(); f.ui.editor.fireEvent(new f.w.mxEventObject(event)); assert.equal(f.popover.hidden, true); } // NEW
    const controller = f.graph.__trellisStructures; delete f.graph.__trellisStructures; f.controls.refresh(); assert.equal(f.popover.querySelector('[data-trellis-show-structure-lengths]').disabled, true); // NEW
    f.graph.__trellisStructures = controller; f.graph.fireEvent(new f.w.mxEventObject('trellisStructuresReady')); assert.equal(f.popover.querySelector('[data-trellis-show-structure-lengths]').disabled, false); // NEW
}); // NEW
