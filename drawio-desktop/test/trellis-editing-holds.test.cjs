/** Exercise editor generation ownership and countdown behavior without real clocks or user profiles. */ // NEW
const test = require('node:test'); // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const vm = require('node:vm'); // NEW
const { JSDOM } = require('jsdom'); // NEW
const source = fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-editing-holds.js'), 'utf8'); // NEW
const key = id => JSON.stringify(['page', id]); // NEW
function fixture(t, overrides = {}) { // NEW
    const dom = new JSDOM('<!doctype html><body><input id="typing"></body>'); t.after(() => dom.window.close()); // NEW
    const { window } = dom, calls = [], timers = []; let now = 1000, onSave = async () => true, onRelease = async () => {}; // NEW
    window.setInterval = callback => { timers.push(callback); return timers.length; }; // NEW
    vm.runInNewContext(source, { window, Date: { now: () => now } }); // NEW
    const instance = window.TrellisEditingHolds.create({}, { // NEW
        isCollaborative: () => true, status: message => calls.push(['status', message]), // NEW
        async claim(targets) { calls.push(['claim', targets]); instance.update(targets.map(target => ({ key: target, sessionId: 'local', claimId: 'claim', expiresAt: null })), 'local'); return { ok: true }; }, // NEW
        async release(targets) { calls.push(['release', targets]); await onRelease(); instance.update([], 'local'); }, // NEW
        ...overrides, // CHANGE: control navigation decisions and asynchronous claims without browser dialogs.
        async lose(targets, reason) { calls.push(['recover', targets, instance.capture(targets)]); instance.freeze(targets, reason); calls.push(['freeze', targets]); instance.update([], 'local'); } // CHANGE
    }); // NEW
    const register = (id, kind = 'year-planner') => instance.register({ kind, targets: [key(id)], capture: () => ({ year: 2026, plan: { label: 'unfinished' } }), save: async () => { calls.push(['save', id]); return onSave(); }, discard: () => calls.push(['discard', id]) }); // NEW
    const hold = (id = 'garden', overrides = {}) => ({ key: key(id), claimId: 'claim', sessionId: 'local', requested: true, expiresAt: 301000, objectLabel: 'Garden plan', requesters: [{ name: 'Bob' }], ...overrides }); // NEW
    return { window, calls, instance, register, hold, tick: () => timers[0](), setNow(value) { now = value; }, save(fn) { onSave = fn; }, release(fn) { onRelease = fn; } }; // NEW
} // NEW
test('a frozen generation retains its exact capture and blocks handoff, reacquisition and release-on-close', async t => { // CHANGE
    const f = fixture(t), panel = f.window.document.createElement('section'); panel.innerHTML = '<textarea>keep this text</textarea><button>Apply</button><button>Close</button>'; f.window.document.body.append(panel); let freezes = 0, submits = 0, closed = 0; // CHANGE
    panel.querySelectorAll('button')[0].addEventListener('click', () => submits++); panel.querySelectorAll('button')[1].addEventListener('click', () => closed++); // CHANGE
    const editor = f.instance.register({ kind: 'inventory', element: panel, targets: [key('garden')], capture: () => ({ text: panel.querySelector('textarea').value }), freeze: () => freezes++, save: async () => { submits++; return true; }, discard() {} }); // CHANGE
    await editor.acquire(); f.instance.freeze([key('garden')], 'Access changed'); f.instance.freeze([key('garden')], 'duplicate'); f.instance.preservation([key('garden')], true); // CHANGE
    assert.equal(freezes, 1); assert.equal(editor.active(), false); assert.equal(editor.frozen(), true); assert.equal(panel.querySelector('textarea').readOnly, true); assert.match(panel.textContent, /private recovery draft has been saved/); // CHANGE
    panel.querySelectorAll('button')[0].click(); panel.querySelectorAll('button')[1].click(); assert.equal(submits, 0); assert.equal(closed, 1); // CHANGE
    panel.querySelector('textarea').value = 'programmatic replacement'; assert.equal(f.instance.capture([key('garden')])[0].text, 'keep this text'); // CHANGE
    f.instance.update([f.hold()], 'local'); await assert.rejects(editor.acquire(), /frozen/); await assert.rejects(f.instance.handoff([key('garden')]), /frozen/); editor.dispose(true); assert.equal(f.calls.filter(call => call[0] === 'release').length, 0); // CHANGE
}); // CHANGE
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
test('deadline preserves editor content and freezes its expired generation without reacquiring', async t => { // CHANGE
    const f = fixture(t), handle = f.register('garden'); await handle.acquire(); f.instance.update([f.hold()], 'local'); f.setNow(301000); f.tick(); await Promise.resolve(); // NEW
    assert.deepEqual(f.calls.filter(call => ['recover', 'freeze', 'discard'].includes(call[0])).map(call => call[0]), ['recover', 'freeze']); // CHANGE
    assert.equal(f.calls.find(call => call[0] === 'recover')[2][0].plan.label, 'unfinished'); assert.equal(f.instance.capture([key('garden')])[0].plan.label, 'unfinished'); await assert.rejects(handle.acquire(), /frozen/); // CHANGE
}); // NEW
test('Save & release waits for editor and diagram durability, then closes only the affected editor', async t => { // NEW
    const f = fixture(t); f.register('garden'); f.register('planting', 'planting'); let finish; f.release(() => new Promise(resolve => { finish = resolve; })); // NEW
    const handoff = f.instance.handoff([key('garden')]); await new Promise(resolve => setImmediate(resolve)); // NEW
    assert.deepEqual(f.calls.map(call => call[0]), ['save', 'release']); finish(); await handoff; // NEW
    assert.deepEqual(f.calls.map(call => call[0]), ['save', 'release', 'discard']); assert.deepEqual(Array.from(f.instance.pinnedTargets()), [], 'the unrelated clean panel must not pin a hold'); // CHANGE // NEW
}); // NEW
test('a delayed explicit handoff carries its original claim generation through the editor save', async t => { // CHANGE
    let released, complete; const f = fixture(t, { release: async (targets, options) => { released = { targets: Array.from(targets), claims: options.claims }; } }); // CHANGE
    f.register('garden'); f.instance.update([f.hold('garden', { claimId: 'original' })], 'local'); f.save(() => new Promise(resolve => { complete = resolve; })); // CHANGE
    const handoff = f.instance.handoff([key('garden')]); f.instance.update([f.hold('garden', { claimId: 'replacement' })], 'local'); complete(true); await handoff; // CHANGE
    assert.deepEqual(released.targets, [key('garden')]); assert.equal(released.claims.get(key('garden')), 'original'); // CHANGE
}); // CHANGE
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

/** An editable domain value makes the tests independent of internal registry state. */ // CHANGE
function editable(f, id, initial = 'saved', saveResult = true) { // CHANGE
    let text = initial, saved = initial; // CHANGE
    const handle = f.instance.register({ kind: 'planting', title: id, targets: [key(id)], capture: () => ({ text }), save: async () => { if (!saveResult) return false; saved = text; return true; }, restore: draft => { text = draft.text; }, discard() {} }); // CHANGE
    return { handle, type(value) { text = value; }, text: () => text, saved: () => saved }; // CHANGE
} // CHANGE

test('clean panels neither pin objects nor prompt when switching', async t => { // CHANGE
    const f = fixture(t, { decide: () => assert.fail('clean navigation must not prompt') }), a = editable(f, 'a'); let moved = false; // CHANGE
    assert.deepEqual(Array.from(f.instance.pinnedTargets()), []); await a.handle.transition(() => { moved = true; }); assert.equal(moved, true); assert.equal(f.calls.length, 0); // CHANGE
}); // CHANGE

test('Commit saves once, ends active editing and keeps an open panel usable', async t => { // CHANGE
    const f = fixture(t, { decide: async () => 'commit' }), a = editable(f, 'a'); a.type('new'); await a.handle.acquire(); let moved = 0; // CHANGE
    await a.handle.transition(() => moved++); assert.equal(a.saved(), 'new'); assert.equal(moved, 1); assert.equal(a.handle.dirty(), false); assert.equal(a.handle.active(), true); assert.deepEqual(Array.from(f.instance.pinnedTargets()), []); // CHANGE
    a.type('newer'); await a.handle.acquire(); assert.deepEqual(Array.from(f.instance.pinnedTargets()), [key('a')]); // CHANGE
}); // CHANGE

test('Discard restores the latest commit rather than the opening value; Stay and failed Commit preserve edits', async t => { // CHANGE
    let choice = 'commit'; const f = fixture(t, { decide: async () => choice }), a = editable(f, 'a'); a.type('committed'); await a.handle.transition(() => {}); // CHANGE
    a.type('discard me'); choice = 'discard'; await a.handle.transition(() => {}); assert.equal(a.text(), 'committed'); assert.equal(a.saved(), 'committed'); // CHANGE
    a.type('keep me'); choice = 'stay'; assert.equal(await a.handle.transition(() => assert.fail('Stay cannot navigate')), false); assert.equal(a.text(), 'keep me'); // CHANGE
    const b = editable(f, 'b', 'original', false); a.type('committed'); choice = 'commit'; b.type('invalid'); assert.equal(await b.handle.transition(() => assert.fail('invalid save cannot navigate')), false); assert.equal(b.text(), 'invalid'); // CHANGE
}); // CHANGE

test('the real transition prompt has Commit, Discard and Stay and coalesces rapid navigation', async t => { // CHANGE
    const f = fixture(t), a = editable(f, 'a'); a.type('draft'); const first = a.handle.transition(() => 1), second = a.handle.transition(() => assert.fail('duplicate navigation')); // CHANGE
    const prompt = f.window.document.querySelector('[data-trellis-edit-decision]'); assert.ok(prompt); assert.deepEqual([...prompt.querySelectorAll('button')].map(button => button.textContent), ['Commit changes', 'Discard changes', 'Stay here']); // CHANGE
    prompt.querySelector('button:last-child').click(); assert.equal(await first, false); assert.equal(await second, false); assert.equal(a.text(), 'draft'); // CHANGE
}); // CHANGE

test('closing during claim acquisition releases the orphan claim without releasing another active owner', async t => { // CHANGE
    let deliver; const f = fixture(t, { claim: targets => new Promise(resolve => { deliver = () => { f.instance.update(targets.map(target => f.hold('a', { key: target, sessionId: 'local', claimId: 'late' })), 'local'); resolve({ ok: true }); }; }) }), a = editable(f, 'a'); // CHANGE
    const pending = a.handle.acquire(); a.handle.dispose(true); deliver(); await assert.rejects(pending, /editor changed/); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.calls.filter(call => call[0] === 'release').length, 1); // CHANGE
}); // CHANGE

test('composition cannot be committed by a tab switch and reset cancels a pending decision', async t => { // CHANGE
    let decide; const f = fixture(t, { decide: () => new Promise(resolve => { decide = resolve; }) }), panel = f.window.document.createElement('section'); panel.innerHTML = '<textarea></textarea>'; f.window.document.body.append(panel); let text = 'saved'; // CHANGE
    const handle = f.instance.register({ kind: 'details', element: panel, targets: [key('a')], capture: () => ({ text }), save: () => assert.fail('composition must not submit'), restore() {} }); text = 'partial'; // CHANGE
    panel.firstChild.dispatchEvent(new f.window.CompositionEvent('compositionstart', { bubbles: true })); assert.equal(await handle.transition(() => assert.fail('composition cannot navigate')), false); // CHANGE
    panel.firstChild.dispatchEvent(new f.window.CompositionEvent('compositionend', { bubbles: true })); const pending = handle.transition(() => assert.fail('reset cannot navigate')); f.instance.reset(); decide('discard'); assert.equal(await pending, false); // CHANGE
}); // CHANGE

test('a clean panel cannot submit stale controls after another operation changes its object', async t => { // CHANGE
    let revision = 'initial'; const f = fixture(t, { targetState: () => revision }), editor = editable(f, 'a'); // CHANGE
    revision = 'changed elsewhere'; editor.type('old controls plus typing'); await assert.rejects(editor.handle.acquire(), /object changed/); assert.equal(editor.text(), 'old controls plus typing'); // CHANGE
    assert.equal(f.calls.some(call => call[0] === 'claim'), false); // CHANGE
}); // CHANGE

test('child editor normalization preserves group targets and private draft values when its hold ends', async t => { // CHANGE
    const f = fixture(t, { logicalTarget: target => target === key('circle') ? key('planting') : target }), editor = f.register('circle', 'planting'); // CHANGE
    await editor.acquire(); assert.deepEqual(Array.from(f.calls.find(call => call[0] === 'claim')[1]), [key('planting')]); // CHANGE
    f.instance.update([f.hold('planting', { expiresAt: 2000 })], 'local'); f.setNow(2001); f.tick(); await new Promise(resolve => setImmediate(resolve)); // CHANGE
    const recovery = f.calls.find(call => call[0] === 'recover'); assert.ok(recovery); assert.deepEqual(Array.from(recovery[2][0].targets), [key('planting')]); assert.equal(recovery[2][0].plan.label, 'unfinished'); // CHANGE
    assert.equal(editor.active(), false); await assert.rejects(editor.acquire(), /frozen/); // CHANGE
}); // CHANGE
test('button and navigation submissions coalesce, and an older save cannot complete newer draft fields', async t => { // CHANGE
    const f = fixture(t); let text = 'draft', release, started, saves = 0; const ready = new Promise(resolve => { started = resolve; }); // CHANGE
    const editor = f.instance.register({ kind: 'inventory', targets: [key('garden')], capture: () => ({ text }), save: async () => { saves++; started(); await new Promise(resolve => { release = resolve; }); return { draftRetained: true }; }, discard() {} }); // CHANGE
    const first = editor.commit(), second = editor.commit(); assert.equal(first, second); await ready; text = 'newer'; release(); assert.equal(await first, false); assert.equal(saves, 1); assert.equal(editor.dirty(), true); assert.deepEqual(Array.from(f.instance.activeTargets()), [key('garden')]); // CHANGE
}); // CHANGE
