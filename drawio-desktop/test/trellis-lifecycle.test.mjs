/** Behavioral shutdown transactions and window IPC ownership, independent of native dialogs. */ // NEW
import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import { EventEmitter } from 'node:events'; // NEW
import { createLifecycleCoordinator, requestWindowReply, cleanupClosedWindow, lastWindowPolicy } from '../src/main/trellis-lifecycle.js'; // NEW
import { createSharingGroup } from '../src/main/trellis-sharing-tray.js'; // NEW

function window(id) { // NEW
    const value = new EventEmitter(); value.id = id; value.destroyed = false; // NEW
    value.isDestroyed = () => value.destroyed; // NEW
    value.webContents = { id, send() {} }; // NEW
    value.destroy = () => { value.destroyed = true; value.emit('closed'); }; // NEW
    return value; // NEW
} // NEW
function fixture(overrides = {}) { // NEW
    const windows = [window(1), window(2)], events = []; // NEW
    const options = { // NEW
        getWindows: () => windows, prepare: async win => ({ snapshotId: win.id }), validate: async () => true, // NEW
        release: async win => events.push(['release', win.id]), discard: async win => events.push(['discard', win.id]), // NEW
        commit: async win => { events.push(['commit', win.id]); win.destroy(); }, // NEW
        destroy: async win => { events.push(['destroy', win.id]); win.destroy(); }, // NEW
        stop: async input => events.push(['stop', input.deadline]), exit: () => events.push(['exit']), // NEW
        onError: error => events.push(['error', error.message]), ...overrides // NEW
    }; // NEW
    return { windows, events, coordinator: createLifecycleCoordinator(options) }; // NEW
} // NEW

test('a later window cancellation preserves every window, draft and transport', async () => { // NEW
    const f = fixture({ prepare: async win => win.id === 1 ? { snapshotId: 1 } : null }); // NEW
    assert.equal(await f.coordinator.requestQuit(), false); // NEW
    assert.equal(f.coordinator.state, 'running'); assert.ok(f.windows.every(win => !win.destroyed)); // NEW
    assert.deepEqual(f.events.map(event => event[0]), ['release', 'release']); // NEW
}); // NEW
test('Quit requests share one transaction and stop only after all approvals and discards', async () => { // NEW
    const f = fixture(); const before = Date.now(); // NEW
    const first = f.coordinator.requestQuit(); assert.equal(first, f.coordinator.requestQuit('tray')); // NEW
    assert.equal(f.coordinator.acceptsWindows, false); assert.equal(f.coordinator.acceptsWork, true); // NEW
    assert.equal(await first, true); // NEW
    assert.deepEqual(f.events.map(event => event[0]), ['discard', 'discard', 'stop', 'destroy', 'destroy', 'exit']); // NEW
    assert.ok(f.events[2][1] >= before + 10000); assert.equal(f.coordinator.acceptsWork, false); // NEW
}); // NEW
test('a changed document is reconfirmed before any discard', async () => { // NEW
    let changes = 1, preparations = 0; // NEW
    const f = fixture({ prepare: async () => ({ snapshotId: ++preparations }), validate: async win => win.id !== 1 || changes-- <= 0 }); // NEW
    assert.equal(await f.coordinator.requestQuit(), true); assert.equal(preparations, 3); // NEW
    assert.deepEqual(f.events[0], ['release', 1]); // NEW
}); // NEW
test('Cancel after snapshot invalidation still performs no destructive work', async () => { // NEW
    let preparations = 0; // NEW
    const f = fixture({ prepare: async () => ++preparations > 2 ? null : {}, validate: async () => false }); // NEW
    assert.equal(await f.coordinator.requestQuit(), false); // NEW
    assert.ok(f.events.every(event => event[0] === 'release')); // NEW
}); // NEW
test('draft removal failure releases preparation and keeps transports running', async () => { // NEW
    const f = fixture({ discard: async () => { throw new Error('Disk failure'); } }); // NEW
    assert.equal(await f.coordinator.requestQuit(), false); assert.equal(f.coordinator.state, 'running'); // NEW
    assert.equal(f.events.some(event => event[0] === 'stop'), false); assert.ok(f.windows.every(win => !win.destroyed)); // NEW
}); // NEW
test('repeated Close shares one operation and Quit awaits that operation', async () => { // NEW
    let release; const gate = new Promise(resolve => { release = resolve; }); // NEW
    const f = fixture({ prepare: async () => { await gate; return {}; } }); // NEW
    const close = f.coordinator.requestClose(f.windows[0]); assert.equal(close, f.coordinator.requestClose(f.windows[0])); // NEW
    const quit = f.coordinator.requestQuit(); release(); await close; await quit; // NEW
    assert.equal(f.events.filter(event => event[0] === 'commit').length, 1); // NEW
    assert.equal(f.events.filter(event => event[0] === 'destroy').length, 1); // NEW
}); // NEW
test('updater exit uses the same approval and resource sequence', async () => { // NEW
    const f = fixture(); await f.coordinator.requestQuit('update', () => f.events.push(['install'])); // NEW
    assert.equal(f.events.at(-1)[0], 'install'); assert.equal(f.events.some(event => event[0] === 'exit'), false); // NEW
}); // NEW
test('installer failure falls back to approved native Quit after releasing resources', async () => { // NEW
    const f = fixture(); assert.equal(await f.coordinator.requestQuit('update', () => { throw new Error('Installer unavailable'); }), false); // NEW
    assert.equal(f.coordinator.state, 'ready to exit'); assert.ok(f.windows.every(win => win.destroyed)); // NEW
    assert.deepEqual(f.events.at(-1), ['exit']); assert.equal(f.events.filter(event => event[0] === 'stop').length, 1); // NEW
}); // NEW
test('failed owned termination is reported and prevents installer launch', async () => { // NEW
    const f = fixture({ stop: async () => { throw new Error('Owned process did not exit'); } }); // NEW
    assert.equal(await f.coordinator.requestQuit('update', () => f.events.push(['install'])), false); // NEW
    assert.equal(f.events.some(event => event[0] === 'install'), false); assert.deepEqual(f.events.at(-1), ['exit']); // NEW
    assert.equal(f.coordinator.acceptsWork, false); assert.ok(f.events.some(event => event[0] === 'error')); // NEW
}); // NEW
test('closed cleanup never touches webContents and is safe when called twice', () => { // NEW
    const closed = window(1), survivor = window(2), windows = [closed, survivor], paths = new Map([[1, 'a'], [2, 'b']]), calls = []; // NEW
    Object.defineProperty(closed, 'webContents', { get() { throw new TypeError('Object has been destroyed'); } }); // NEW
    const cleanup = () => cleanupClosedWindow({ window: closed, contentsId: 1, windows, paths, watches: { unwatchWindow: win => calls.push(win.id) }, services: [{ forgetContext: id => calls.push(id) }, { forgetContext: id => calls.push(id) }], disposers: [() => calls.push('listener')] }); // NEW
    cleanup(); cleanup(); assert.deepEqual(windows, [survivor]); assert.deepEqual([...paths.keys()], [2]); // NEW
    assert.equal(calls.filter(value => value === 'listener').length, 2); // NEW
}); // NEW
test('cleanup continues if an already disposed subsystem fails', () => { // NEW
    const win = window(1), windows = [win], forgotten = []; // NEW
    cleanupClosedWindow({ window: win, contentsId: 1, windows, paths: new Map(), watches: { unwatchWindow() { throw new Error('disposed'); } }, services: [{ forgetContext: id => forgotten.push(id) }] }); // NEW
    assert.deepEqual(forgotten, [1]); assert.equal(windows.length, 0); // NEW
}); // NEW
test('close replies require both sender and request ID; resolution removes listeners', async () => { // NEW
    const ipcMain = new EventEmitter(), win = window(4); // NEW
    const pending = requestWindowReply({ ipcMain, window: win, channel: 'isModified', replyChannel: 'reply', payload: { uniqueId: 'a' }, validateSender: () => true }); // NEW
    ipcMain.emit('reply', { sender: { id: 5 } }, { uniqueId: 'a' }); // NEW
    ipcMain.emit('reply', { sender: { id: 4 } }, { uniqueId: 'b' }); // NEW
    assert.equal(ipcMain.listenerCount('reply'), 1); // NEW
    ipcMain.emit('reply', { sender: { id: 4 } }, { uniqueId: 'a', isModified: true }); // NEW
    assert.equal((await pending).isModified, true); assert.equal(ipcMain.listenerCount('reply'), 0); assert.equal(win.listenerCount('closed'), 0); // NEW
}); // NEW
test('destroyed windows and missing replies reject without retaining IPC or timers', async () => { // NEW
    for (const destroy of [true, false]) { // NEW
        const ipcMain = new EventEmitter(), win = window(1); // NEW
        const pending = requestWindowReply({ ipcMain, window: win, channel: 'check', replyChannel: 'reply', payload: { uniqueId: 'a' }, validateSender: () => true, timeoutMs: 10 }); // NEW
        const rejected = assert.rejects(pending, /closed|did not answer/); if (destroy) win.destroy(); await rejected; // NEW
        assert.equal(ipcMain.listenerCount('reply'), 0); assert.equal(win.listenerCount('closed'), 0); // NEW
    } // NEW
}); // NEW
test('a disposed renderer frame is rejected before send even when its window survives', async () => { // NEW
    const ipcMain = new EventEmitter(), win = window(1); let sent = false; // NEW
    win.webContents.mainFrame = { isDestroyed: () => true }; win.webContents.send = () => { sent = true; }; // NEW
    await assert.rejects(requestWindowReply({ ipcMain, window: win, channel: 'check', replyChannel: 'reply', payload: { uniqueId: 'a' }, validateSender: () => true }), /renderer is unavailable/); // NEW
    assert.equal(sent, false); assert.equal(ipcMain.listenerCount('reply'), 0); // NEW
}); // NEW
test('last-window policy covers all platforms and failed tray creation', () => { // NEW
    for (const platform of ['win32', 'darwin', 'linux']) { // NEW
        assert.equal(lastWindowPolicy({ platform, configuredSync: true, trayAvailable: true }), 'background'); // NEW
        assert.equal(lastWindowPolicy({ platform, configuredSync: true, trayAvailable: false }), 'explain and quit'); // NEW
        assert.equal(lastWindowPolicy({ platform, configuredSync: false }), platform === 'darwin' ? 'stay open' : 'quit'); // NEW
    } // NEW
}); // NEW
test('aggregate tray controls reach legacy and identity transports, including locked identities', async () => { // NEW
    const calls = [], services = ['legacy', 'locked identity'].map(name => ({ listStatus: () => [{ label: name }], setPaused: async input => calls.push([name, input.paused]), stop: async () => calls.push([name, 'stop']), start: async () => calls.push([name, 'start']) })); // NEW
    let running = true; // NEW
    const group = createSharingGroup({ getServices: () => services, getIdentityStatuses: () => [{ label: 'identity catalog' }], subscribe: () => () => {}, canStart: () => running }); // NEW
    assert.equal(group.listStatus().length, 3); await group.setPaused({ paused: true }); await group.stop(); await group.start(); // NEW
    assert.equal(calls.length, 6); running = false; await assert.rejects(group.start(), /shutting down/); assert.equal(calls.length, 6); // NEW
}); // NEW
