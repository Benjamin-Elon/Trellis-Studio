/** Exercise the actual desktop acquisition functions without a profile or native windows. */ // NEW
const test = require('node:test'), assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { parse } = require('@babel/parser'); // NEW

function fixture() { // NEW
    const source = fs.readFileSync(path.join(__dirname, '../src/main/electron.js'), 'utf8'), ast = parse(source, { sourceType: 'module' }); // NEW
    const windows = [], loads = new Map(), sent = [], state = { created: 0, acceptsWindows: true }; // NEW
    const context = vm.createContext({ windowsRegistry: windows, readyEditorWindows: new WeakSet(), busyEditorWindows: new WeakSet(), lifecycle: state, dialogOpen: false, canNotifyWindow: win => !win.crashed, bindWindowLoad: (win, action) => loads.set(win, action) }); // NEW
    for (const name of ['reportEditorBusy', 'requestEditorOpen']) { const node = ast.program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === name); assert.ok(node); vm.runInContext(source.slice(node.start, node.end), context); } // NEW
    context.createWindow = () => { // NEW
        state.created++; const win = { destroyed: false, minimized: true, shown: 0, focused: 0, isDestroyed() { return this.destroyed; }, isMinimized() { return this.minimized; }, restore() { this.minimized = false; }, show() { this.shown++; }, focus() { this.focused++; }, webContents: { send: (channel, value) => sent.push({ channel, value }) } }; windows.push(win); return win; // NEW
    }; // NEW
    return { context, windows, loads, sent, state, open: context.requestEditorOpen, ready(win) { context.readyEditorWindows.add(win); const action = loads.get(win); loads.delete(win); action?.(); } }; // NEW
} // NEW

test('relaunch restores the sole editor without reloading its garden', () => { // NEW
    const f = fixture(), win = f.open(); f.ready(win); for (let i = 0; i < 5; i++) assert.equal(f.open(), win); // NEW
    assert.equal(f.state.created, 1); assert.equal(win.minimized, false); assert.equal(win.focused, 6); assert.deepEqual(f.sent, []); // NEW
}); // NEW

test('only the opening that creates an editor waits for startup; later requests require retry', () => { // NEW
    const f = fixture(), win = f.open('/first.drawio'); f.open('/rejected.drawio'); f.open(null, true); // NEW
    assert.equal(f.state.created, 1); assert.equal(f.context.busyEditorWindows.has(win), true); assert.deepEqual(f.sent, []); // NEW
    f.ready(win); assert.equal(f.sent.length, 1); assert.equal(f.sent[0].channel, 'trellisEditorOpen'); assert.equal(f.sent[0].value.path, '/first.drawio'); // NEW
    f.open('/retried.drawio'); assert.equal(f.sent.at(-1).value.path, '/retried.drawio'); // NEW
}); // NEW

test('native dialogs, crashed renderers, and shutdown never acquire a second editor', () => { // NEW
    const f = fixture(), win = f.open(); f.ready(win); f.context.dialogOpen = true; f.open('/busy.drawio'); // NEW
    assert.equal(f.sent.at(-1).channel, 'trellisEditorBusy'); f.context.dialogOpen = false; win.crashed = true; f.open('/crashed.drawio'); // NEW
    assert.equal(f.state.created, 1); assert.equal(f.sent.filter(item => item.channel === 'trellisEditorOpen').length, 0); // NEW
    f.state.acceptsWindows = false; assert.equal(f.open('/shutdown.drawio'), null); assert.equal(f.state.created, 1); // NEW
}); // NEW

test('a destroyed editor releases ownership for one replacement, including New from the tray', () => { // NEW
    const f = fixture(), first = f.open(); f.ready(first); first.destroyed = true; const second = f.open(null, true); // NEW
    assert.notEqual(first, second); assert.equal(f.state.created, 2); f.ready(second); assert.equal(f.sent.at(-1).value.create, true); // NEW
    f.open('/another.drawio'); assert.equal(f.state.created, 2); assert.equal(f.sent.at(-1).value.path, '/another.drawio'); // NEW
}); // NEW

test('the normal editor constructor reuses a surviving window before native allocation', () => { // NEW
    const source = fs.readFileSync(path.join(__dirname, '../src/main/electron.js'), 'utf8'), ast = parse(source, { sourceType: 'module' }), node = ast.program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'createWindow'); // NEW
    const existing = { isDestroyed: () => false }, context = vm.createContext({ windowsRegistry: [existing], lifecycle: { acceptsWindows: true } }); // NEW
    vm.runInContext(source.slice(node.start, node.end), context); assert.equal(context.createWindow(), existing); // NEW: any attempted allocation would fail because the native dependencies are deliberately absent.
}); // NEW
