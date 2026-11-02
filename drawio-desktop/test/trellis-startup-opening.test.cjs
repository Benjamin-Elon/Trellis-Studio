/** Exercise the actual native opening adapter without a renderer or user profile. */ // NEW
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'); // NEW
function fixture(prepareOpen) { // NEW
    const source = fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/diagramly/ElectronApp.js'), 'utf8'), start = source.indexOf('var readVerifiedGraphFile ='), end = source.indexOf('// Disables temp files in Electron', start); assert.ok(start > 0 && end > start); // NEW
    const opened = [], errors = []; let current = null; function App() {} // NEW
    App.prototype.readGraphFile = function (success, _failure, filename) { opened.push(filename); success({ path: filename }); }; // NEW
    const context = vm.createContext({ App, window: { trellisGardenLibrary: { prepareOpen } } }); vm.runInContext(source.slice(start, end), context); // NEW
    const ui = new App(); ui.editor = { status: 'Previous', setStatus(value) { this.status = value; } }; ui.getCurrentFile = () => current; // NEW
    return { ui, opened, errors, read: filename => ui.readGraphFile(() => {}, error => errors.push(error.message), filename), changeFile() { current = {}; } }; // NEW
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
