/** Startup discovery may finish after the user has navigated to Home or another document. */ // CHANGE
const test = require('node:test'), assert = require('node:assert/strict'); // CHANGE
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'); // CHANGE
const { parse } = require('@babel/parser'), traverse = require('@babel/traverse').default; // CHANGE
const root = path.resolve(__dirname, '../drawio/src/main/webapp/js'); // CHANGE

for (const file of ['diagramly/App.js', 'app.min.js', 'integrate.min.js']) { // CHANGE
    const source = fs.readFileSync(path.join(root, file), 'utf8'); let implementation; // CHANGE
    traverse(parse(source), { noScope: true, AssignmentExpression({ node }) { if (node.left.type === 'MemberExpression' && node.left.property.name === 'checkDrafts' && node.left.object.type === 'MemberExpression' && node.left.object.object.name === 'App') implementation = source.slice(node.right.start, node.right.end); } }); // CHANGE
    assert.ok(implementation); // CHANGE
    for (const navigation of ['none', 'dialog', 'file']) test(`${file}: delayed draft discovery respects ${navigation} ownership`, () => { // CHANGE
        const timers = [], calls = [], originalFile = {}, originalDialog = {}; let discovery; // CHANGE
        const ui = { dialog: originalDialog, current: originalFile, getCurrentFile() { return this.current; }, filterDrafts(_path, _guid, callback) { discovery = callback; }, loadFile() { calls.push('load'); }, loadDraft(_data, callback) { calls.push('draft'); callback(); }, removeDatabaseItem() { calls.push('remove'); } }; // CHANGE
        const check = vm.runInNewContext('(' + implementation + ')', { Editor: { guid: () => 'startup' }, localStorage: { setItem() {}, removeItem() {} }, window: { setTimeout: callback => timers.push(callback) }, mxUtils: { bind: (owner, callback) => callback.bind(owner) }, urlParams: {} }); // CHANGE
        check.call(ui); timers.shift()(); // CHANGE
        if (navigation === 'dialog') ui.dialog = {}; if (navigation === 'file') ui.current = {}; // CHANGE
        discovery([{ key: 'retained-draft', data: 'draft' }]); // CHANGE
        assert.deepEqual(calls, navigation === 'none' ? ['draft', 'remove'] : []); // CHANGE: obsolete discovery neither navigates nor deletes recovery data.
    }); // CHANGE
    test(`${file}: empty discovery does not close a newer project browser`, () => { // CHANGE
        const timers = []; let discovery, loaded = false; // CHANGE
        const ui = { dialog: {}, getCurrentFile: () => null, filterDrafts(_path, _guid, callback) { discovery = callback; }, loadFile() { loaded = true; } }; // CHANGE
        const check = vm.runInNewContext('(' + implementation + ')', { Editor: { guid: () => 'startup' }, localStorage: { setItem() {}, removeItem() {} }, window: { setTimeout: callback => timers.push(callback) }, mxUtils: { bind: (owner, callback) => callback.bind(owner) }, urlParams: {} }); // CHANGE
        check.call(ui); timers.shift()(); ui.dialog = {}; discovery([]); assert.equal(loaded, false); // CHANGE
    }); // CHANGE
    test(file + ': obsolete discovery releases only its own native startup gate', () => { // CHANGE
        const timers = [], callbacks = []; const ui = { dialog: {}, __trellisCheckingDrafts: true, getCurrentFile: () => null, filterDrafts(_path, _guid, callback) { callbacks.push(callback); }, loadFile() { assert.fail('An obsolete startup cannot navigate'); } }; // CHANGE
        const check = vm.runInNewContext('(' + implementation + ')', { Editor: { guid: () => 'startup' }, localStorage: { setItem() {}, removeItem() {} }, window: { setTimeout: callback => timers.push(callback) }, mxUtils: { bind: (owner, callback) => callback.bind(owner) }, urlParams: {} }); // CHANGE
        check.call(ui); timers.shift()(); check.call(ui); timers.shift()(); ui.dialog = {}; // CHANGE
        callbacks[0]([]); assert.equal(ui.__trellisCheckingDrafts, true); callbacks[1]([]); assert.equal(ui.__trellisCheckingDrafts, false); // CHANGE
    }); // CHANGE
} // CHANGE
