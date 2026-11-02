/** Clock acceleration must be confined to the real production controller's quiet-period dependency. */ // NEW
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'); // NEW
const { installAutosaveClock } = require('./helpers/autosave-benchmark-clock.cjs'); // NEW
function fixture(mode) { // NEW
    let realTime = 0; const intervals = [], sleeps = []; // NEW
    const root = { performance: { now: () => realTime }, setInterval: (_fn, delay) => { intervals.push(delay); return intervals.length; }, clearInterval() {}, setTimeout: (fn, delay) => { sleeps.push(delay); realTime += delay; fn(); return sleeps.length; }, clearTimeout() {} }; // NEW
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-background-saving.js'), 'utf8'), { window: root, Promise }); // NEW
    const originalNow = root.performance.now, originalTimeout = root.setTimeout, clock = installAutosaveClock(root, mode); // NEW
    const controller = root.TrellisBackgroundSaving.create({ pending: () => [], viewing: () => [], revision: () => 1, dirty: () => true, capture: () => ({}), checkpoint: async () => {}, publish: async () => {}, report: assert.fail }); // NEW
    return { root, clock, controller, intervals, sleeps, originalNow, originalTimeout, advance: duration => { realTime += duration; } }; // NEW
} // NEW
test('split mode waits once, then expires the production quiet countdown without advancing real time', async () => { // NEW
    const h = fixture('split'), first = await h.clock.prepare(0, () => h.controller.changed()); // NEW
    assert.equal(first.wallWaitMs, 20000); assert.equal(first.quietAdvanceMs, 0); assert.equal(first.mode, 'real'); // NEW
    h.clock.beginExecution(); h.advance(25); assert.equal(h.clock.endExecution(), 0); // NEW
    const before = h.root.performance.now(), next = await h.clock.prepare(1, () => h.controller.changed()); // NEW
    assert.equal(next.remainingBeforeMs, 20000); assert.equal(next.remainingAfterMs, 0); assert.equal(next.wallWaitMs, 0); assert.equal(next.quietAdvanceMs, 20000); // NEW
    assert.equal(h.root.performance.now(), before); await h.controller.waitForQuiet(); // NEW: delegate to the actual controller rather than stubbing readiness.
    h.clock.beginExecution(); const start = h.root.performance.now(); h.advance(31); assert.equal(h.clock.endExecution(), 0); // NEW
    assert.equal(h.root.performance.now() - start, 31); assert.equal(next.executionAdvanceMs, 0); // NEW
    assert.equal(h.root.performance.now, h.originalNow); assert.equal(h.root.setTimeout, h.originalTimeout); // NEW
    assert.deepEqual(h.intervals, [5000, 10000]); assert.deepEqual(h.sleeps, [20000]); h.controller.dispose(); // NEW
}); // NEW
test('real mode preserves a full wall-clock quiet wait for every preparation', async () => { // NEW
    const h = fixture('real'); // NEW
    for (const index of [0, 1, 2]) { const record = await h.clock.prepare(index, () => h.controller.changed()); assert.equal(record.mode, 'real'); assert.equal(record.wallWaitMs, 20000); assert.equal(record.quietAdvanceMs, 0); } // NEW
    assert.deepEqual(h.sleeps, [20000, 20000, 20000]); h.controller.dispose(); // NEW
}); // NEW
test('accelerated edits continue resetting the quiet countdown and cannot advance during execution', async () => { // NEW
    const h = fixture('split'); await h.clock.prepare(1, () => h.controller.changed()); // NEW
    h.controller.activity(); assert.equal(h.controller.getSaveStatus().remainingMs, 20000); // NEW
    h.clock.beginExecution(); await assert.rejects(h.clock.prepare(2, () => h.controller.changed()), /idle managed controller/); h.clock.endExecution(); // NEW
    await h.clock.prepare(2, () => h.controller.changed()); assert.equal(h.controller.getSaveStatus().remainingMs, 0); h.controller.dispose(); // NEW
}); // NEW
test('replacing the execution clock or failing to reset the countdown invalidates the fixture', async () => { // NEW
    const h = fixture('split'); await h.clock.prepare(1, () => h.controller.changed()); // NEW
    await assert.rejects(h.clock.prepare(2, () => {}), /reset the quiet countdown/); // NEW
    h.root.performance.now = () => 0; assert.throws(() => h.clock.beginExecution(), /unmodified real performance clock/); h.controller.dispose(); // NEW
}); // NEW
