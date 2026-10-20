const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const test = require('node:test'); // NEW
const { JSDOM } = require('jsdom'); // NEW

test('opt-in focus tracing preserves input behavior, omits text, bounds records and restores hooks', async t => { // NEW
    const dom = new JSDOM('<!doctype html><body><div class="geDialog"><input type="text"></div><div id="graph" tabindex="0"></div></body>', { runScripts: 'outside-only', pretendToBeVisual: true }); // NEW
    t.after(() => dom.window.close()); // NEW
    const { window } = dom, input = window.document.querySelector('input'); // NEW
    window.document.elementFromPoint = () => input; // NEW: jsdom has no layout engine; native hit-testing is covered in Electron.
    const listeners = new Set(); // NEW
    const source = { addListener(_name, handler) { listeners.add(handler); }, removeListener(handler) { listeners.delete(handler); } }; // NEW
    const graph = { ...source, container: window.document.getElementById('graph'), isEditing: () => false, startEditingAtCell: () => 'editing-result' }; // NEW
    const ui = { editor: { ...source, graph }, dialogs: [], showDialog: () => 'dialog-result', hideDialog() {} }; // NEW
    window.Draw = { loadPlugin: callback => callback(ui) }; // NEW
    const originalFocus = window.HTMLElement.prototype.focus, originalWindowFocus = window.focus; // NEW
    const originalShow = ui.showDialog, originalEditing = graph.startEditingAtCell; // NEW
    const script = fs.readFileSync(path.join(__dirname, 'helpers/garden-settings-focus-trace.js'), 'utf8'); // NEW
    window.eval(script); // NEW
    input.value = 'PRIVATE_FIELD_VALUE'; input.focus(); // NEW
    const pointer = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }); input.dispatchEvent(pointer); // NEW
    assert.equal(pointer.defaultPrevented, false); assert.equal(window.document.activeElement, input); // NEW
    assert.equal(ui.showDialog(), 'dialog-result'); assert.equal(graph.startEditingAtCell(), 'editing-result'); // NEW
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'PRIVATE_KEY', bubbles: true })); // NEW
    // Verify final cancellation is observed, rather than relying on a capture-phase microtask. // NEW
    input.addEventListener('mousedown', event => event.preventDefault(), { once: true }); // NEW
    input.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true })); // NEW
    await new Promise(resolve => window.setTimeout(resolve, 0)); // NEW
    const beforeLimit = window.trellisGardenFocusTrace.snapshot(); // NEW
    assert.ok(beforeLimit.records.some(record => record.kind === 'mousedown-settled' && record.prevented)); // NEW
    for (let i = 0; i < 600; i++) input.focus(); // NEW
    const result = window.trellisGardenFocusTrace.stop(), serialized = JSON.stringify(result); // NEW
    assert.equal(result.records.length, 500); assert.ok(result.dropped > 0); // NEW
    assert.doesNotMatch(serialized, /PRIVATE_FIELD_VALUE|PRIVATE_KEY/); // NEW
    assert.equal(window.document.activeElement, input); assert.equal(input.value, 'PRIVATE_FIELD_VALUE'); // NEW
    assert.equal(window.HTMLElement.prototype.focus, originalFocus); assert.equal(window.focus, originalWindowFocus); // NEW
    assert.equal(ui.showDialog, originalShow); assert.equal(graph.startEditingAtCell, originalEditing); assert.equal(listeners.size, 0); // NEW
    const frozen = JSON.stringify(window.trellisGardenFocusTrace.snapshot()); graph.container.focus(); // NEW
    assert.equal(JSON.stringify(window.trellisGardenFocusTrace.stop()), frozen); // NEW
    window.eval(script); window.trellisGardenFocusTrace.stop(); // NEW: an observer can be safely restarted in the same renderer.
    assert.equal(window.HTMLElement.prototype.focus, originalFocus); // NEW
}); // NEW
