/** Exercise the actual production publication primitive, including partial writes and competing writers. */ // NEW
import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import os from 'node:os'; // NEW
import { writeImmutable } from '../src/main/trellis-syncthing-service.js'; // NEW

async function recordPath(t) { // NEW
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-record-publication-')); // NEW
    t.after(async () => { assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('trellis-record-publication-')); await fs.rm(directory, { recursive: true, force: true }); }); // NEW
    return path.join(directory, 'accepted.json'); // NEW
} // NEW

test('an interrupted immutable write never publishes a truncated record and can be retried', async t => { // NEW
    const filename = await recordPath(t), original = fs.writeFile; // NEW
    fs.writeFile = async function (temporary, data, options) { if (temporary.startsWith(filename + '.')) { await original(temporary, data.slice(0, 4), options); throw Object.assign(new Error('Interrupted temporary write'), { code: 'EIO' }); } return original(temporary, data, options); }; // NEW
    try { await assert.rejects(writeImmutable(filename, { accepted: true }), /Interrupted temporary write/); } finally { fs.writeFile = original; } // NEW
    await assert.rejects(fs.stat(filename), { code: 'ENOENT' }); // NEW
    assert.deepEqual(await fs.readdir(path.dirname(filename)), []); // NEW
    await writeImmutable(filename, { accepted: true }); // NEW
    assert.deepEqual(JSON.parse(await fs.readFile(filename, 'utf8')), { accepted: true }); // NEW
}); // NEW

test('immutable retries are idempotent and conflicting writers cannot replace the accepted record', async t => { // NEW
    const filename = await recordPath(t); // NEW
    await Promise.all(Array.from({ length: 8 }, () => writeImmutable(filename, { accepted: 'original' }))); // NEW
    await assert.rejects(writeImmutable(filename, { accepted: 'conflict' }), { code: 'EEXIST' }); // NEW
    assert.deepEqual(JSON.parse(await fs.readFile(filename, 'utf8')), { accepted: 'original' }); // NEW
    assert.deepEqual(await fs.readdir(path.dirname(filename)), ['accepted.json']); // NEW
}); // NEW

test('a failed immutable publication preserves the existing record and removes its temporary file', async t => { // NEW
    const filename = await recordPath(t), original = fs.link; // NEW
    await writeImmutable(filename, { accepted: 'original' }); // NEW
    fs.link = async function (source, target) { if (target === filename) throw Object.assign(new Error('Publication unavailable'), { code: 'EPERM' }); return original(source, target); }; // NEW
    try { await assert.rejects(writeImmutable(filename, { accepted: 'replacement' }), /Publication unavailable/); } finally { fs.link = original; } // NEW
    assert.deepEqual(JSON.parse(await fs.readFile(filename, 'utf8')), { accepted: 'original' }); // NEW
    assert.deepEqual(await fs.readdir(path.dirname(filename)), ['accepted.json']); // NEW
}); // NEW
