/** Verify shipped coverage and packaging without installing a model, FFmpeg, or a speech service. */ // NEW
const test = require('node:test'); // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const vm = require('node:vm'); // NEW
const project = path.resolve(__dirname, '..'), webapp = path.join(project, 'drawio/src/main/webapp'); // NEW
function data(name, property) { // NEW
    const window = {}; vm.runInNewContext(fs.readFileSync(path.join(webapp, name), 'utf8'), { window }); return window[property]; // NEW
} // NEW
test('every current complete prompt has an exact transcript and readable bundled MP3', () => { // NEW
    const catalog = data('js/trellis-narration-catalog.js', 'TrellisNarrationCatalog'); // NEW
    const manifest = data('audio/narration/manifest.js', 'TrellisNarrationRecordings'); // NEW
    const recorded = new Map(); // NEW
    for (const clip of manifest.clips) { // NEW
        assert.equal(recorded.has(clip.text), false, 'Duplicate transcript: ' + clip.text); // NEW
        assert.match(clip.file, /^clip-\d+\.mp3$/); assert.ok(clip.duration > 0); // NEW
        assert.equal(clip.provenance.voice, 'am_michael'); assert.equal(clip.provenance.dtype, 'fp32'); assert.equal(clip.provenance.speed, 1); // NEW
        const bytes = fs.readFileSync(path.join(webapp, 'audio/narration', clip.file)); // NEW
        assert.ok(bytes.length > 1000); assert.equal(bytes.subarray(0, 3).toString(), 'ID3'); recorded.set(clip.text, clip); // NEW
    } // NEW
    for (const text of catalog.entries()) assert.ok(recorded.has(text), 'Missing recording: ' + text); // NEW
}); // NEW
test('browser startup loads the catalog and recording manifest before the player and license shell', () => { // NEW
    const index = fs.readFileSync(path.join(webapp, 'index.html'), 'utf8'); // NEW
    const scripts = ['js/trellis-narration-catalog.js', 'audio/narration/manifest.js', 'js/trellis-narration.js', 'js/trellis-splash.js']; // NEW
    const positions = scripts.map(script => index.indexOf('src="' + script + '"')); // NEW
    assert.ok(positions.every(position => position >= 0)); assert.deepEqual(positions, [...positions].sort((a,b) => a-b)); // NEW
}); // NEW
test('all installers exclude development models and generator tooling without excluding narration assets', () => { // NEW
    const { FileMatcher } = require('app-builder-lib/out/fileMatcher'); // NEW
    const metadata = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8')); // NEW
    assert.equal(metadata.dependencies['kokoro-js'], undefined); assert.equal(metadata.devDependencies['kokoro-js'], undefined); // NEW
    for (const name of fs.readdirSync(project).filter(name => /^electron-builder.*\.json$/.test(name))) { // NEW
        const config = JSON.parse(fs.readFileSync(path.join(project, name), 'utf8')); // NEW
        assert.ok(config.files.includes('!tools/narration{,/**}'), name); assert.ok(config.files.includes('!.test-artifacts{,/**}'), name); // NEW
        const filter = new FileMatcher(project, project, value => value, config.files).createFilter(); // NEW
        const stats = { isDirectory: () => false }; // NEW
        for (const file of ['tools/narration/package.json', 'tools/narration/node_modules/kokoro-js/dist/kokoro.js', '.test-artifacts/narration-model/pinned/onnx/model.onnx']) assert.equal(filter(path.join(project, file), stats), false, name + ': ' + file); // NEW
        for (const file of ['js/trellis-narration-catalog.js', 'js/trellis-narration.js', 'audio/narration/manifest.js', 'audio/narration/clip-0001.mp3']) assert.equal(filter(path.join(webapp, file), stats), true, name + ': ' + file); // NEW
    } // NEW
}); // NEW
