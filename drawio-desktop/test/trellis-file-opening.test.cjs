/** File-opening boundaries and their production Electron error-dialog integration. */ // NEW
const test = require('node:test'), assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'); // NEW
const { spawn } = require('node:child_process'), { parse } = require('@babel/parser'); // NEW
const project = path.resolve(__dirname, '..'), protectedMessage = 'This file is inside Trellis’s application folder. Copy it to Documents or another folder, then open the copy.'; // NEW

/** Execute the actual main-process functions without starting a user application profile. */ // NEW
function readerFixture() { // NEW
    const source = fs.readFileSync(path.join(project, 'src/main/electron.js'), 'utf8'), ast = parse(source, { sourceType: 'module' }); // NEW
    const declarations = ['readFile', 'checkFileContent'].map(name => ast.program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === name)); // NEW
    const state = { reads: 0, data: '<mxfile><diagram><mxGraphModel><root/></mxGraphModel></diagram></mxfile>', error: null }; // NEW
    const appBaseDir = path.join(project, path.sep), context = vm.createContext({ Buffer, path, appBaseDir, LIMITS: { diagram: 10000000 }, async readBounded() { state.reads++; if (state.error) throw state.error; return state.data; } }); // NEW
    for (const node of declarations) { assert.ok(node); vm.runInContext(source.slice(node.start, node.end), context); } // NEW
    return { state, read: context.readFile, appBaseDir }; // NEW
} // NEW
test('application-folder reads explain the protected location before I/O or content classification', async () => { // NEW
    const f = readerFixture(); // NEW
    for (const filename of ['diagram.drawio', 'missing.drawio', 'invalid.txt']) { // NEW
        await assert.rejects(f.read(path.join(project, filename), 'utf-8'), error => error.message === protectedMessage); // NEW
    } // NEW
    assert.equal(f.state.reads, 0); // NEW
}); // NEW
test('external files retain successful reads, malformed-content rejection and filesystem failures', async () => { // NEW
    const f = readerFixture(), filename = path.join(os.tmpdir(), 'trellis-external-open.drawio'); // NEW
    assert.equal(await f.read(filename, 'utf-8'), f.state.data); // NEW
    f.state.data = 'not diagram content'; await assert.rejects(f.read(filename, 'utf-8'), /Invalid file data/); // NEW
    for (const message of ['ENOENT: file not found', 'EACCES: permission denied']) { // NEW
        f.state.error = new Error(message); await assert.rejects(f.read(filename, 'utf-8'), error => error === f.state.error); // NEW
    } // NEW
}); // NEW
test('Browse failures use native stacked error dialogs and an external two-page file opens', { timeout: 195000 }, async () => { // NEW
    const env = { ...process.env, TRELLIS_FILE_OPEN_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    const child = spawn(process.execPath, [path.join(project, 'scripts/run-production-smoke.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); // NEW
    let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; }); // NEW
    const deadline = setTimeout(() => child.kill(), 180000); // NEW: the existing parent owns bounded process-tree cleanup.
    try { const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); assert.equal(code, 0, output); assert.match(output, /FILE_OPEN_RESULT:passed/); } finally { clearTimeout(deadline); } // NEW
}); // NEW
