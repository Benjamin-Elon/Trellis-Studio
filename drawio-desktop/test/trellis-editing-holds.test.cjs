/** Exercise editor generation ownership and countdown behavior without real clocks or user profiles. */ // NEW
const test = require('node:test'); // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const vm = require('node:vm'); // NEW
const { JSDOM } = require('jsdom'); // NEW
const source = fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-editing-holds.js'), 'utf8'); // NEW
const key = id => JSON.stringify(['page', id]); // NEW
function fixture(t) { // NEW
    const dom = new JSDOM('<!doctype html><body><input id="typing"></body>'); t.after(() => dom.window.close()); // NEW
    const { window } = dom, calls = [], timers = []; let now = 1000, onSave = async () => true, onRelease = async () => {}; // NEW
    window.setInterval = callback => { timers.push(callback); return timers.length; }; // NEW
    vm.runInNewContext(source, { window, Date: { now: () => now } }); // NEW
    const instance = window.TrellisEditingHolds.create({}, { // NEW
        isCollaborative: () => true, status: message => calls.push(['status', message]), // NEW
        async claim(targets) { calls.push(['claim', targets]); instance.update(targets.map(target => ({ key: target, sessionId: 'local', claimId: 'claim', expiresAt: null })), 'local'); return { ok: true }; }, // NEW
        async release(targets) { calls.push(['release', targets]); await onRelease(); instance.update([], 'local'); }, // NEW
        async lose(targets, reason) { calls.push(['recover', targets, instance.capture(targets)]); instance.discard(targets); instance.update([], 'local'); } // NEW
    }); // NEW
    const register = (id, kind = 'year-planner') => instance.register({ kind, targets: [key(id)], capture: () => ({ year: 2026, plan: { label: 'unfinished' } }), save: async () => { calls.push(['save', id]); return onSave(); }, discard: () => calls.push(['discard', id]) }); // NEW
    const hold = (id = 'garden', overrides = {}) => ({ key: key(id), claimId: 'claim', sessionId: 'local', requested: true, expiresAt: 301000, objectLabel: 'Garden plan', requesters: [{ name: 'Bob' }], ...overrides }); // NEW
    return { window, calls, instance, register, hold, tick: () => timers[0](), setNow(value) { now = value; }, save(fn) { onSave = fn; }, release(fn) { onRelease = fn; } }; // NEW
} // NEW
test('clean editor registration does not claim; first edit claims once and retains pinned targets', async t => { // NEW
    const f = fixture(t), handle = f.register('garden'); assert.equal(f.calls.length, 0); // NEW
    await handle.acquire(); await handle.acquire(); assert.equal(f.calls.filter(call => call[0] === 'claim').length, 1); // NEW
    assert.deepEqual(Array.from(f.instance.pinnedTargets()), [key('garden')]); handle.dispose(true); await Promise.resolve(); // NEW
    assert.equal(f.calls.filter(call => call[0] === 'release').length, 1); // NEW
}); // NEW
test('popup leaves focus in the editor, uses the actual deadline, and keeps a stable DOM node', t => { // NEW
    const f = fixture(t), field = f.window.document.getElementById('typing'); field.focus(); f.instance.update([f.hold()], 'local'); // NEW
    const popup = f.window.document.querySelector('[data-trellis-hold-countdown]'); assert.ok(popup); assert.equal(f.window.document.activeElement, field); // NEW
    assert.match(popup.textContent, /Bob.*Garden plan/); assert.match(popup.textContent, /5:00/); // NEW
    f.setNow(241000); f.tick(); assert.match(popup.textContent, /1:00/); assert.equal(f.window.document.querySelector('[data-trellis-hold-countdown]'), popup); // NEW
    assert.ok(popup.querySelector('[data-trellis-hold-drag-handle]')); f.instance.update([f.hold('garden', { requested: false })], 'local'); assert.equal(popup.isConnected, false); // NEW
}); // NEW
test('deadline recovers editor content before discarding and does not reacquire its expired generation', async t => { // NEW
    const f = fixture(t), handle = f.register('garden'); await handle.acquire(); f.instance.update([f.hold()], 'local'); f.setNow(301000); f.tick(); await Promise.resolve(); // NEW
    assert.deepEqual(f.calls.filter(call => ['recover', 'discard'].includes(call[0])).map(call => call[0]), ['recover', 'discard']); // NEW
    assert.equal(f.calls.find(call => call[0] === 'recover')[2][0].plan.label, 'unfinished'); await assert.rejects(handle.acquire(), /closed/); // NEW
}); // NEW
test('Save & release waits for editor and diagram durability, then closes only the affected editor', async t => { // NEW
    const f = fixture(t); f.register('garden'); f.register('planting', 'planting'); let finish; f.release(() => new Promise(resolve => { finish = resolve; })); // NEW
    const handoff = f.instance.handoff([key('garden')]); await new Promise(resolve => setImmediate(resolve)); // NEW
    assert.deepEqual(f.calls.map(call => call[0]), ['save', 'release']); finish(); await handoff; // NEW
    assert.deepEqual(f.calls.map(call => call[0]), ['save', 'release', 'discard']); assert.deepEqual(Array.from(f.instance.pinnedTargets()), [key('planting')]); // NEW
}); // NEW
test('failed save leaves the editor and countdown available, while reset cancels a delayed handoff', async t => { // NEW
    const f = fixture(t); f.register('garden'); f.save(async () => false); f.instance.update([f.hold()], 'local'); // NEW
    await assert.rejects(f.instance.handoff([key('garden')]), /Finish or correct/); assert.equal(f.calls.some(call => call[0] === 'release'), false); // NEW
    assert.ok(f.window.document.querySelector('[data-trellis-hold-countdown]')); // NEW
    let finish; f.save(() => new Promise(resolve => { finish = resolve; })); const handoff = f.instance.handoff([key('garden')]); f.instance.reset(); finish(true); await handoff; // NEW
    assert.equal(f.calls.some(call => call[0] === 'release'), false); // NEW
}); // NEW
test('editing another spacing row acquires its hold while retaining ownership of applied rows', async t => { // NEW
    const f = fixture(t); let changed = [key('a')]; // NEW
    const editor = f.instance.register({ kind: 'planting', targets: () => changed, capture: () => ({ rows: [] }), save: async () => true, discard() {} }); // NEW
    await editor.acquire(); changed = []; assert.deepEqual(Array.from(f.instance.pinnedTargets()), [key('a')]); // NEW
    changed = [key('b')]; await editor.acquire(); assert.deepEqual(f.calls.filter(call => call[0] === 'claim').map(call => Array.from(call[1])), [[key('a')], [key('b'), key('a')]]); // NEW
    f.instance.update([f.hold('a', { claimId: 'replacement', requested: false }), f.hold('b', { requested: false })], 'local'); // NEW
    await assert.rejects(editor.acquire(), /ended/); assert.ok(f.calls.some(call => call[0] === 'recover')); // NEW
}); // NEW
