/** Independent activity/recovery cadence while content persistence is deliberately stalled. */ // NEW
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path'); // NEW
function harness() { // NEW
    const timers = new Map(), activities = [], checkpoints = []; let sequence = 0, now = 0, revision = 0, dirty = false, pending = []; // NEW
    const window = { setInterval(fn, delay) { timers.set(++sequence, { fn, delay, next: now + delay }); return sequence; }, clearInterval(id) { timers.delete(id); } }; // NEW
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-background-saving.js'), 'utf8'), { window, Promise }); // NEW
    const controller = window.TrellisBackgroundSaving.create({ pending: () => pending, viewing: () => [], revision: () => revision, dirty: () => dirty, capture: () => ({ revision, xml: 'revision-' + revision }), publish: async data => activities.push(data), checkpoint: async data => checkpoints.push(data), report: message => assert.fail(message) }); // NEW
    const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }; // NEW
    return { controller, activities, checkpoints, timers, async edit() { revision++; dirty = true; pending = ['["page","a"]']; controller.changed(); await settle(); }, async advance(duration) { const end = now + duration; while (true) { const timer = [...timers.values()].filter(timer => timer.next <= end).sort((a, b) => a.next - b.next)[0]; if (!timer) break; now = timer.next; timer.next += timer.delay; timer.fn(); await settle(); } now = end; }, async undo() { revision++; dirty = false; pending = []; controller.changed(); await settle(); } }; // NEW
} // NEW
test('typing alone produces no immediate publication or recovery checkpoint and keeps the graph clean', async () => { // CHANGE
    const h = harness(), count = h.activities.length; h.controller.activity(); await Promise.resolve(); assert.equal(h.activities.length, count); await h.advance(10000); assert.equal(h.checkpoints.length, 0); assert.ok(h.activities.every(value => value.pending.length === 0 && value.saveState === 'saved')); // CHANGE
    h.controller.dispose(); // CHANGE
}); // CHANGE
test('requests arriving as a drain finishes still capture and publish the latest revision', async () => { // NEW
    const window = { setInterval: () => 1, clearInterval() {} }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-background-saving.js'), 'utf8'), { window, Promise }); // NEW
    let revision = 1; const captures = [], publications = []; // NEW
    const controller = window.TrellisBackgroundSaving.create({ pending: () => ['object'], viewing: () => [], revision: () => revision, dirty: () => true, capture: () => ({ revision }), checkpoint: async input => { captures.push(input.revision); }, publish: async input => { publications.push(input.revision); }, report: assert.fail }); // NEW
    const first = controller.checkpoint(true); for (let turn = 0; turn < 4; turn++) await Promise.resolve(); revision = 2; await controller.checkpoint(true); await first; assert.deepEqual(captures, [1, 2]); // CHANGE: cover the gap between an async drain returning and its outer finally reaction.
    const published = controller.publish(); for (let turn = 0; turn < 4; turn++) await Promise.resolve(); revision = 3; await controller.publish(); await published; assert.equal(publications.at(-1), 3); controller.dispose(); // CHANGE
}); // NEW
test('continuous editing and a sixty-second stalled content save cannot postpone recovery or heartbeats', async () => { // NEW
    const h = harness(); const stalledContentSave = new Promise(() => {}); assert.ok(stalledContentSave); // NEW
    for (let second = 0; second < 60; second++) { await h.edit(); await h.advance(1000); } // NEW
    assert.equal(h.checkpoints.length, 6); assert.deepEqual(h.checkpoints.map(value => value.revision), [10, 20, 30, 40, 50, 60]); // NEW
    assert.ok(h.activities.length >= 12); assert.equal(h.activities.at(-1).revision, 60); h.controller.dispose(); assert.equal(h.timers.size, 0); // NEW
}); // NEW
test('undo to the saved state clears pending status without waiting for a project save', async () => { // NEW
    const h = harness(); await h.edit(); assert.equal(h.activities.at(-1).saveState, 'pending'); await h.undo(); assert.equal(h.activities.at(-1).saveState, 'saved'); await h.advance(10000); assert.equal(h.checkpoints.length, 0); h.controller.dispose(); // NEW
}); // NEW
test('checkpoint requests combine while a write is active and capture the newest state afterward', async () => { // NEW
    const window = { setInterval: () => 1, clearInterval() {} }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-background-saving.js'), 'utf8'), { window, Promise }); // NEW
    let revision = 1, release; const captured = []; // NEW
    const controller = window.TrellisBackgroundSaving.create({ pending: () => [], viewing: () => [], revision: () => revision, dirty: () => true, capture: () => ({ revision }), publish: async () => {}, checkpoint: data => { captured.push(data.revision); return captured.length === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(); }, report: assert.fail }); // NEW
    const first = controller.checkpoint(true); await Promise.resolve(); revision = 2; controller.checkpoint(true); revision = 3; const latest = controller.checkpoint(true); release(); await first; await latest; assert.deepEqual(captured, [1, 3]); controller.dispose(); // NEW
}); // NEW
test('edits reset an already queued automatic follow-up indefinitely, and explicit Save can flush it', async () => { // NEW
    let time = 0, timerId = 0, automatic = true, composing = false; const waits = new Map(); // CHANGE
    const window = { setInterval: () => 1, clearInterval() {}, setTimeout(fn, delay) { waits.set(++timerId, { fn, at: time + delay }); return timerId; }, clearTimeout(id) { waits.delete(id); } }; // NEW
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-background-saving.js'), 'utf8'), { window, Promise, Date }); // NEW
    const controller = window.TrellisBackgroundSaving.create({ now: () => time, busy: () => composing, pending: () => [], viewing: () => [], revision: () => 1, dirty: () => true, capture: () => ({}), publish: async () => {}, checkpoint: async () => {}, report: assert.fail }); // CHANGE
    const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }; // NEW
    const advance = async value => { time = value; for (const [id, timer] of [...waits]) if (timer.at <= time) { waits.delete(id); timer.fn(); } await settle(); }; // NEW
    let completed = false; const waiting = controller.waitForQuiet(() => automatic).then(() => { completed = true; }); // NEW
    for (let i = 1; i <= 20; i++) { await advance(i * 4000); controller.changed(); } // NEW
    assert.equal(completed, false, 'continuous editing must not hit a forced-save deadline'); automatic = false; controller.flushQuiet(); await waiting; assert.equal(completed, true); assert.equal(waits.size, 0); // NEW
    automatic = true; controller.changed(); completed = false; const afterPause = controller.waitForQuiet().then(() => { completed = true; }); await advance(time + 19999); controller.activity(); await advance(time + 19999); assert.equal(completed, false); // CHANGE
    composing = true; await advance(time + 10000); assert.equal(completed, false); composing = false; controller.activity(); await advance(time + 19999); assert.equal(completed, false); await advance(time + 1); await afterPause; assert.equal(completed, true); controller.dispose(); // CHANGE
}); // NEW

test('save timing snapshots use the quiet clock and heartbeat without adding IPC work or timers', async () => { // NEW
    let time = 0, composing = false, publications = 0; const timers = [], snapshots = []; // NEW
    const window = { setInterval(fn, delay) { timers.push({ fn, delay }); return timers.length; }, clearInterval() {} }; // NEW
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-background-saving.js'), 'utf8'), { window, Promise }); // NEW
    const controller = window.TrellisBackgroundSaving.create({ now: () => time, busy: () => composing, pending: () => ['object'], viewing: () => [], revision: () => 1, dirty: () => true, capture: () => ({}), checkpoint: async () => {}, publish: async () => { publications++; }, report: assert.fail, onStatusChange: snapshot => snapshots.push(snapshot) }); // NEW
    assert.deepEqual(timers.map(timer => timer.delay), [5000, 10000]); controller.changed(); await Promise.resolve(); await Promise.resolve(); // NEW
    assert.equal(controller.getSaveStatus().remainingMs, 20000); time = 5321; const count = publications; // NEW
    const detached = controller.getSaveStatus(); detached.remainingMs = 0; assert.equal(controller.getSaveStatus().remainingMs, 14679); assert.equal(publications, count); // NEW
    timers[0].fn(); assert.equal(snapshots.at(-1).remainingMs, 14679); await Promise.resolve(); await Promise.resolve(); // NEW
    const afterHeartbeat = publications; time = 8000; controller.activity(); assert.equal(snapshots.at(-1).remainingMs, 20000); assert.equal(publications, afterHeartbeat); // NEW
    composing = true; time = 50000; timers[0].fn(); assert.equal(snapshots.at(-1).remainingMs, 0); assert.equal(snapshots.at(-1).busy, true); // NEW
    controller.state('failed'); assert.equal(snapshots.at(-1).state, 'failed'); controller.dispose(); const observations = snapshots.length; timers[0].fn(); controller.activity(); assert.equal(snapshots.length, observations); // NEW
}); // NEW

test('a failed status observer cannot stop editing, publication, or save-state transitions', async () => { // NEW
    const window = { setInterval: () => 1, clearInterval() {} }; let publications = 0; // NEW
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-background-saving.js'), 'utf8'), { window, Promise }); // NEW
    const controller = window.TrellisBackgroundSaving.create({ pending: () => ['object'], viewing: () => [], revision: () => 1, dirty: () => true, publish: async () => { publications++; }, onStatusChange() { throw new Error('Presentation failed'); }, report: assert.fail }); // NEW
    controller.activity(); controller.changed(); controller.state('saving'); await controller.publish(); assert.ok(publications > 0); assert.equal(controller.getSaveStatus().state, 'saving'); controller.dispose(); // NEW
}); // NEW

test('heartbeat refreshes the local countdown while an activity publication is still blocked', async () => { // NEW
    let time = 0, heartbeat, release, publications = 0; const snapshots = [], gate = new Promise(resolve => { release = resolve; }); // NEW
    const window = { setInterval(fn, delay) { if (delay === 5000) heartbeat = fn; return delay; }, clearInterval() {} }; // NEW
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-background-saving.js'), 'utf8'), { window, Promise }); // NEW
    const controller = window.TrellisBackgroundSaving.create({ now: () => time, pending: () => ['object'], viewing: () => [], revision: () => 1, dirty: () => true, publish: async () => { publications++; await gate; }, onStatusChange: snapshot => snapshots.push(snapshot), report: assert.fail }); // NEW
    controller.changed(); await Promise.resolve(); time = 5000; heartbeat(); assert.equal(snapshots.at(-1).remainingMs, 15000); time = 10000; heartbeat(); assert.equal(snapshots.at(-1).remainingMs, 10000); assert.equal(publications, 1); // NEW
    controller.dispose(); release(); await controller.publish(); // NEW
}); // NEW
