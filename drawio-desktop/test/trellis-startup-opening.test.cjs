/** Exercise the actual native opening adapter without a renderer or user profile. */ // NEW
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'); // NEW
function fixture(prepareOpen) { // NEW
    const source = fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/diagramly/ElectronApp.js'), 'utf8'), start = source.indexOf('var readVerifiedGraphFile ='), end = source.indexOf('// Disables temp files in Electron', start); assert.ok(start > 0 && end > start); // NEW
    const opened = [], errors = []; let current = null; function App() {} // NEW
    App.prototype.readGraphFile = function (success, _failure, filename) { opened.push(filename); success({ path: filename }); }; // NEW
    const context = vm.createContext({ App, window: { trellisGardenLibrary: { prepareOpen } } }); vm.runInContext(source.slice(start, end), context); // NEW
    const ui = new App(); ui.editor = { status: 'Previous', setStatus(value) { this.status = value; } }; ui.getCurrentFile = () => current; // NEW
    return { ui, context, opened, errors, read: filename => ui.readGraphFile(() => {}, error => errors.push(error.message), filename), changeFile() { current = {}; } }; // NEW
} // NEW
test('native opening waits for verification and uses its renamed projection path', async () => { // NEW
    let release; const f = fixture(() => new Promise(resolve => { release = resolve; })), opening = f.read('/old.drawio'); // NEW
    assert.equal(f.opened.length, 0); assert.equal(f.ui.editor.status, 'Checking garden…'); release({ path: '/verified.drawio' }); await opening; // NEW
    assert.deepEqual(f.opened, ['/verified.drawio']); assert.deepEqual(f.errors, []); assert.equal(f.ui.editor.status, 'Previous'); // NEW
}); // NEW
test('native opening cannot replace a document changed while verification was pending', async () => { // NEW
    let release; const f = fixture(() => new Promise(resolve => { release = resolve; })), opening = f.read('/garden.drawio'); f.changeFile(); release({ path: '/garden.drawio' }); await opening; // NEW
    assert.deepEqual(f.opened, []); assert.match(f.errors[0], /document changed/); assert.equal(f.ui.editor.status, 'Previous'); // NEW
}); // NEW
test('native verification failure has no read fallback and other import types keep their existing path', async () => { // NEW
    const f = fixture(async () => { throw new Error('Worker stopped; retry'); }); await f.read('/garden.drawio'); assert.deepEqual(f.opened, []); assert.match(f.errors[0], /retry/); // NEW
    await f.read('/drawing.pdf'); assert.deepEqual(f.opened, ['/drawing.pdf']); assert.equal(f.ui.editor.status, 'Previous'); // NEW
}); // NEW

test('prepared opening reads exactly once without repeating garden verification', async () => { // NEW
    let checks = 0; const f = fixture(async () => { checks++; return {}; }); // NEW
    f.ui.readGraphFile(() => {}, error => { throw error; }, '/garden.drawio', true, { prepared: true }); // NEW
    assert.equal(checks, 0); assert.deepEqual(f.opened, ['/garden.drawio']); // NEW
}); // NEW
/** Exercise the native recovery dialog callbacks while retaining the production adapter. */ // NEW
function recoveryFixture() { // NEW
    const f = fixture(async () => ({})), requests = []; let dialog, onClose, active = true, canceled = false; // NEW
    f.context.requestSync = async value => { requests.push(value); return value.action === 'getFileDrafts' ? [{ data: 'recovered XML', path: '/retained.draft' }] : true; }; // NEW
    f.context.mxResources = { get: value => value }; // NEW
    f.context.DraftDialog = function(...args) { dialog = { restore: args[3], discard: args[4], ignore: args[7] }; this.container = {}; this.init = () => {}; }; // NEW
    f.ui.showDialog = (_panel, _width, _height, _modal, _closeable, close) => { onClose = close; f.ui.dialog = { container: { contains: () => true } }; }; // NEW
    f.ui.hideDialog = () => { onClose?.(); f.ui.dialog = null; }; // NEW
    const operation = { active: () => active, assertActive() { assert.ok(active); }, cancel() { canceled = true; } }; // NEW
    return { ...f, requests, operation, dialog: () => dialog, canceled: () => canceled, invalidate() { active = false; operation.cleanupDraft?.(); } }; // NEW
} // NEW
test('recovery selection returns a deferred-consumption draft and cancellation preserves it', async () => { // NEW
    const f = recoveryFixture(), input = { entry: { path: '/garden.drawio' }, data: 'original XML' }; // NEW
    const choosing = f.ui.chooseGardenDraft(input, f.operation); await new Promise(resolve => setImmediate(resolve)); // NEW
    f.dialog().restore(0); const result = await choosing; assert.equal(result.data, 'recovered XML'); assert.equal(result.draftPath, '/retained.draft'); // NEW
    assert.equal(f.requests.some(value => value.action === 'deleteFile'), false); // NEW
    const canceled = recoveryFixture(), pending = canceled.ui.chooseGardenDraft(input, canceled.operation); await new Promise(resolve => setImmediate(resolve)); // NEW
    canceled.ui.hideDialog(true); await pending; assert.equal(canceled.canceled(), true); assert.equal(canceled.requests.some(value => value.action === 'deleteFile'), false); // NEW
}); // NEW
test('discarding the last recovery draft continues opening the original file and obsolete prompts close safely', async () => { // NEW
    const f = recoveryFixture(), input = { entry: { path: '/garden.drawio' }, data: 'original XML' }; // NEW
    const choosing = f.ui.chooseGardenDraft(input, f.operation); await new Promise(resolve => setImmediate(resolve)); // NEW
    await f.dialog().discard(0, () => { throw new Error('A removed last draft must finish the selection directly'); }); // NEW
    assert.equal(await choosing, input); assert.equal(f.canceled(), false); assert.equal(f.requests.at(-1).action, 'deleteFile'); // NEW
    const obsolete = recoveryFixture(); obsolete.ui.chooseGardenDraft(input, obsolete.operation); await new Promise(resolve => setImmediate(resolve)); obsolete.invalidate(); // NEW
    assert.equal(obsolete.ui.dialog, null); obsolete.dialog().restore(0); assert.equal(obsolete.requests.some(value => value.action === 'deleteFile'), false); // NEW
}); // NEW
