/** Incremental generation uses real files and a fake synthesizer, requiring no model or encoder. */ // NEW
import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import fs from 'node:fs/promises'; // NEW
import os from 'node:os'; // NEW
import path from 'node:path'; // NEW
import { generateNarration, loadData, readExistingAudio } from '../scripts/generate-narration.mjs'; // NEW
async function fixture(t) { // NEW
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-narration-')); // NEW
    t.after(async () => { assert.equal(path.dirname(directory), os.tmpdir()); await fs.rm(directory, { recursive: true, force: true }); }); // NEW
    const synthesized = [], loaded = []; // NEW
    const options = { directory, provenance: { voice: 'test', revision: 'one' }, // NEW
        createSynthesizer: async () => { loaded.push(true); return async (text, filename) => { synthesized.push(text); await fs.writeFile(filename, text); }; }, // NEW
        encode: async (wav, destination) => fs.writeFile(destination, 'mp3:' + await fs.readFile(wav, 'utf8')), // NEW
        validate: async filename => { assert.match(await fs.readFile(filename, 'utf8'), /^mp3:/); return 1; } // NEW
    }; // NEW
    options.validateGenerated = options.validate; // NEW
    const manifest = () => loadData(path.join(directory, 'manifest.js'), 'TrellisNarrationRecordings'); // NEW
    async function snapshot() { // NEW
        const result = {}; // NEW
        for (const name of await fs.readdir(directory)) result[name] = { bytes: await fs.readFile(path.join(directory, name), 'utf8'), modified: (await fs.stat(path.join(directory, name))).mtimeMs }; // NEW
        return result; // NEW
    } // NEW
    return { directory, options, synthesized, loaded, manifest, snapshot }; // NEW
} // NEW
test('exact text deduplicates, no-op tooling changes never load the model or rewrite files, and reversions reuse old recordings', async t => { // NEW
    const f = await fixture(t); // NEW
    assert.deepEqual(await generateNarration({ ...f.options, texts: ['Hello.', 'World.', 'Hello.'] }), { generated: 2, reused: 0, retained: 2 }); // NEW
    assert.deepEqual(f.synthesized, ['Hello.', 'World.']); assert.equal(f.loaded.length, 1); // NEW
    const before = await f.snapshot(); // NEW
    const forbidden = async () => { throw new Error('Unchanged text must not load a model'); }; // NEW
    await generateNarration({ ...f.options, texts: ['World.', 'Hello.'], createSynthesizer: forbidden, provenance: { voice: 'changed', revision: 'two' } }); // NEW
    assert.deepEqual(await f.snapshot(), before); // NEW
    await generateNarration({ ...f.options, texts: ['Hello!', 'World.'] }); // NEW
    assert.deepEqual(f.synthesized, ['Hello.', 'World.', 'Hello!']); // NEW
    const after = await f.snapshot(); assert.deepEqual(after['clip-0001.mp3'], before['clip-0001.mp3']); // NEW
    await generateNarration({ ...f.options, texts: ['Hello.'], createSynthesizer: forbidden }); // NEW
    assert.deepEqual(await f.snapshot(), after); assert.equal((await f.manifest()).clips.length, 3); // NEW
}); // NEW
test('check mode reports new text without loading a model or creating output', async t => { // NEW
    const f = await fixture(t); // NEW
    await assert.rejects(generateNarration({ ...f.options, texts: ['New.'], check: true }), /need recording/); // NEW
    assert.deepEqual(await fs.readdir(f.directory), []); assert.equal(f.loaded.length, 0); // NEW
}); // NEW
test('ordinary reuse needs no encoder or generator and detects unreadable or truncated stored assets', async t => { // NEW
    const f = await fixture(t), file = 'clip-0001.mp3', filename = path.join(f.directory, file); // NEW
    const bytes = Buffer.alloc(1200); bytes.write('ID3'); await fs.writeFile(filename, bytes); // NEW
    const manifest = { version: 1, clips: [{ text: 'Stored.', file, bytes: bytes.length, duration: 1 }] }; // NEW
    await fs.writeFile(path.join(f.directory, 'manifest.js'), 'window.TrellisNarrationRecordings=' + JSON.stringify(manifest)); // NEW
    const before = await f.snapshot(); // NEW
    const result = await generateNarration({ directory: f.directory, texts: ['Stored.'] }); // NEW
    assert.deepEqual(result, { generated: 0, reused: 1, retained: 1 }); assert.deepEqual(await f.snapshot(), before); // NEW
    await fs.writeFile(filename, bytes.subarray(0, 1100)); // NEW
    await assert.rejects(readExistingAudio(filename, manifest.clips[0]), /truncated/); // NEW
    await fs.rm(filename); await assert.rejects(readExistingAudio(filename, manifest.clips[0]), /Restore the existing recording/); // NEW
}); // NEW
test('missing or corrupt existing clips are errors rather than regeneration requests', async t => { // NEW
    const f = await fixture(t); await generateNarration({ ...f.options, texts: ['Existing.'] }); // NEW
    const clip = path.join(f.directory, (await f.manifest()).clips[0].file); // NEW
    await fs.writeFile(clip, 'corrupt'); // NEW
    await assert.rejects(generateNarration({ ...f.options, texts: ['Existing.'] })); // NEW
    await fs.rm(clip); // NEW
    await assert.rejects(generateNarration({ ...f.options, texts: ['Existing.'] }), /ENOENT/); // NEW
    assert.equal(f.loaded.length, 1); assert.equal(f.synthesized.length, 1); // NEW
}); // NEW
test('completed recordings survive interrupted generation and an orphan file is never overwritten', async t => { // NEW
    const f = await fixture(t); // NEW
    const fail = async () => async (text, filename) => { if (text === 'Second.') throw new Error('Interrupted'); await fs.writeFile(filename, text); }; // NEW
    await assert.rejects(generateNarration({ ...f.options, texts: ['First.', 'Second.'], createSynthesizer: fail }), /Interrupted/); // NEW
    assert.equal((await f.manifest()).clips.length, 1); // NEW
    await fs.writeFile(path.join(f.directory, 'clip-0002.mp3'), 'mp3:uncommitted'); // NEW
    await generateNarration({ ...f.options, texts: ['First.', 'Second.'] }); // NEW
    assert.deepEqual(f.synthesized, ['Second.']); // NEW
    assert.equal((await f.manifest()).clips[1].file, 'clip-0003.mp3'); // NEW
    assert.equal(await fs.readFile(path.join(f.directory, 'clip-0002.mp3'), 'utf8'), 'mp3:uncommitted'); // NEW
}); // NEW
