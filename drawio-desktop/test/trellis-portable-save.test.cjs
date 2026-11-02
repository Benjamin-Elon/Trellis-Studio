/** Native Save As must preserve managed project identity, unresolved drafts, and recovery state. */ // NEW
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), parser = require('@babel/parser'), traverse = require('@babel/traverse').default; // NEW
const source = fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/diagramly/ElectronApp.js'), 'utf8'), ast = parser.parse(source); // NEW
function method(owner, name, context) { // NEW
    let expression; traverse(ast, { AssignmentExpression(entry) { const left = entry.node.left; if (left.type === 'MemberExpression' && left.property.name === name && left.object?.property?.name === 'prototype' && left.object.object?.name === owner) expression = entry.node.right; } }); // NEW
    assert.ok(expression, owner + '.' + name); return vm.runInNewContext('(' + source.slice(expression.start, expression.end) + ')', context); // NEW
} // NEW
function fixture(options = {}) { // NEW
    const writes = [], errors = [], successes = [], dialogs = []; let canceled = 0, classificationReady = !options.delayedClassification; // NEW
    const context = { window: { Trellis: { sharing: { getInfo: () => classificationReady ? { managed: true } : null, whenDocumentReady: async () => { await Promise.resolve(); classificationReady = true; }, portableXml: async xml => { if (options.dependencyFailure) throw Error('Missing definitions'); return '<portable>' + xml + '</portable>'; } } } }, LocalLibrary: function () {}, mxClient: { IS_WIN: true }, localStorage: { getItem: () => null, setItem() {} }, requestSync: async request => { if (request.action === 'dirname') return 'C:/managed'; if (request.action === 'showSaveDialog') { dialogs.push(request); return options.cancel ? null : options.destination || 'C:/copies/Garden.drawio'; } if (request.action === 'writeFile') { if (options.writeFailure) throw Error('Disk full'); writes.push(request); } } }; // NEW
    const file = { fileObject: { path: 'C:/managed/Garden.drawio' }, title: 'Garden.drawio', data: '<baseline/>', modified: true, recovery: '<retained draft/>', getTitle() { return this.title; }, ui: { editor: { graph: { __trellisProjectFormat: options.format || 2 } }, getFileData: () => '<current Unicode 🌱/>', normalizeFilename: value => value, createFileSystemFilters: () => [] } }; // NEW
    const save = () => method('LocalFile', 'saveAs', context).call(file, null, value => successes.push(value), error => errors.push(error.message), () => canceled++); // NEW
    return { file, writes, errors, successes, dialogs, save, canceled: () => canceled }; // NEW
} // NEW
for (const format of [1, 2]) test('managed format ' + format + ' Save As exports a complete copy and preserves its source', async () => { // NEW
    const f = fixture({ format }), before = JSON.stringify(f.file); await f.save(); // NEW
    assert.equal(JSON.stringify(f.file), before); assert.equal(f.writes.length, 1); assert.match(f.writes[0].data, /portable.*Unicode 🌱/); assert.equal(f.dialogs[0].title, 'Save a portable copy'); assert.equal(f.successes[0].portableCopy, true); // NEW
}); // NEW
for (const [name, options, message] of [['same destination', { destination: 'c:\\MANAGED\\garden.DRAWIO' }, /different destination/], ['missing dependency', { dependencyFailure: true }, /Missing definitions/], ['failed write', { writeFailure: true }, /Disk full/]]) test('portable Save As preserves its source after ' + name, async () => { // NEW
    const f = fixture(options), before = JSON.stringify(f.file); await f.save(); assert.equal(JSON.stringify(f.file), before); assert.equal(f.writes.length, 0); assert.equal(f.successes.length, 0); assert.match(f.errors[0], message); // NEW
}); // NEW
test('canceling portable Save As completes cancellation without changing the source', async () => { const f = fixture({ cancel: true }); await f.save(); assert.equal(f.canceled(), 1); assert.equal(f.writes.length, 0); assert.equal(f.file.modified, true); }); // NEW
test('the Save As action retains the managed draft after a portable copy completes', () => { // NEW
    let removed = 0, marked = 0, status; const file = { fileObject: {}, saveAs(_title, success) { success({ portableCopy: true }); }, removeDraft() { removed++; }, handleFileSuccess() { marked++; } }; // NEW
    const context = { EditorUi: { enableDrafts: true }, mxUtils: { bind: (owner, callback) => callback.bind(owner) } }, ui = { getCurrentFile: () => file, editor: { setStatus: value => { status = value; } } }; // NEW
    method('App', 'saveFile', context).call(ui, true); assert.equal(removed, 0); assert.equal(marked, 0); assert.equal(status, 'Portable copy saved'); // CHANGE
}); // NEW

test('legacy managed Save As waits for document classification before selecting its storage path', async () => { // NEW
    const f = fixture({ format: 1, delayedClassification: true }), before = JSON.stringify(f.file); await f.save(); // NEW
    assert.equal(JSON.stringify(f.file), before); assert.deepEqual(f.errors, []); assert.equal(f.writes.length, 1); assert.equal(f.successes[0].portableCopy, true); // NEW
}); // NEW
test('Save As refuses a replacement document after classification without changing the source', async () => { // NEW
    const f = fixture({ format: 1, delayedClassification: true }); f.file.ui.getCurrentFile = () => ({}); const before = JSON.stringify(f.file); await f.save(); // NEW
    assert.equal(JSON.stringify(f.file), before); assert.equal(f.writes.length, 0); assert.match(f.errors[0], /diagram changed/); // NEW
}); // NEW
