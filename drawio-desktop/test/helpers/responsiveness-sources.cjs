/** Freeze benchmark inputs and verify runtime resources without touching application data. */ // CHANGE
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'); // CHANGE
const { fileURLToPath } = require('node:url'); // CHANGE
const hashFile = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'); // CHANGE
/** Manifest creation is also used once for the manually retained pre-edit checkpoint. */ // CHANGE
function manifestSources(destination) { // CHANGE
    const files = {}; // CHANGE
    function visit(directory) { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const filename = path.join(directory, entry.name); if (entry.isDirectory()) visit(filename); else if (filename !== path.join(destination, 'manifest.json')) files[path.relative(destination, filename)] = hashFile(filename); } } // CHANGE
    visit(destination); fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(files, null, 2)); // CHANGE
} // CHANGE
/** Snapshots are write-once and include preload, native XML support, and test fixtures. */ // CHANGE
function captureSources(project, destination) { // CHANGE
    fs.mkdirSync(destination, { recursive: false }); // CHANGE
    for (const [source, target] of [['src/main', 'main'], ['drawio/src/main/webapp/js', 'browser-js'], ['drawio/src/main/webapp/plugins/garden_planner_plugins', 'plugins'], ['test/helpers', 'helpers']]) fs.cpSync(path.join(project, source), path.join(destination, target), { recursive: true }); // CHANGE
    fs.copyFileSync(path.join(project, 'drawio/src/main/webapp/mxgraph/mxClient.js'), path.join(destination, 'mxClient.js')); // CHANGE
    for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(project, name), path.join(destination, name)); // CHANGE
    manifestSources(destination); return destination; // CHANGE
} // CHANGE
function verifySources(destination) { // CHANGE
    for (const [relative, expected] of Object.entries(JSON.parse(fs.readFileSync(path.join(destination, 'manifest.json'), 'utf8')))) if (hashFile(path.join(destination, relative)) !== expected) throw Error('Frozen benchmark input changed: ' + relative); // CHANGE
} // CHANGE
/** Record resources on first load and verify them before accepting a production result. */ // CHANGE
function resourceTracker() { // CHANGE
    const files = new Map(); // CHANGE
    return { files, observe(url) { if (!url.startsWith('file:')) return; const filename = fileURLToPath(url.split('?')[0]); if (!files.has(filename) && fs.existsSync(filename) && fs.statSync(filename).isFile()) files.set(filename, hashFile(filename)); }, verify() { for (const [filename, expected] of files) if (!fs.existsSync(filename) || hashFile(filename) !== expected) throw Error('Runtime benchmark resource changed: ' + filename); } }; // CHANGE
} // CHANGE
module.exports = { captureSources, manifestSources, verifySources, resourceTracker }; // CHANGE
