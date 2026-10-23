/** Snapshot integrity failures must prevent benchmark acceptance. */ // CHANGE
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'); // CHANGE
const { pathToFileURL } = require('node:url'); // CHANGE
const { captureSources, verifySources, resourceTracker } = require('./helpers/responsiveness-sources.cjs'); // CHANGE
test('source snapshots preserve preload and fixtures, reject replacement, and detect subsequent edits', t => { // CHANGE
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-sources-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); // CHANGE
    for (const directory of ['src/main', 'drawio/src/main/webapp/js', 'drawio/src/main/webapp/plugins/garden_planner_plugins', 'test/helpers', 'drawio/src/main/webapp/mxgraph']) { fs.mkdirSync(path.join(root, directory), { recursive: true }); fs.writeFileSync(path.join(root, directory, directory.endsWith('main') ? 'electron-preload.js' : directory.endsWith('mxgraph') ? 'mxClient.js' : 'fixture.js'), 'original'); } // CHANGE
    for (const name of ['package.json', 'package-lock.json']) fs.writeFileSync(path.join(root, name), '{}'); // CHANGE
    const destination = captureSources(root, path.join(root, 'snapshot')); verifySources(destination); // CHANGE
    fs.writeFileSync(path.join(root, 'src/main/electron-preload.js'), 'live change'); assert.equal(fs.readFileSync(path.join(destination, 'main/electron-preload.js'), 'utf8'), 'original'); // CHANGE
    assert.throws(() => captureSources(root, destination), /EEXIST/); fs.writeFileSync(path.join(destination, 'helpers/fixture.js'), 'changed'); assert.throws(() => verifySources(destination), /Frozen benchmark input changed/); // CHANGE
}); // CHANGE
test('runtime resource changes and deletions invalidate a run, while query strings share one resource', t => { // CHANGE
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-resources-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); // CHANGE
    const filename = path.join(root, 'file with spaces.css'); fs.writeFileSync(filename, 'original'); const tracker = resourceTracker(), url = pathToFileURL(filename).href; // CHANGE
    tracker.observe(url + '?v=1'); tracker.observe(url + '?v=2'); tracker.verify(); assert.equal(tracker.files.size, 1); // CHANGE
    fs.writeFileSync(filename, 'changed'); assert.throws(() => tracker.verify(), /resource changed/); fs.unlinkSync(filename); assert.throws(() => tracker.verify(), /resource changed/); // CHANGE
}); // CHANGE
