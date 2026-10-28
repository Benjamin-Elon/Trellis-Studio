/** Lifecycle convergence and recoverable filesystem failure scenarios. */ // NEW
import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import os from 'node:os'; // NEW
import { projectLifecycle, moveRetained, readOptional } from '../src/main/trellis-project-trash.js'; // NEW
import { createProjectTransport } from '../src/main/trellis-project-transport.js'; // CHANGE
const record = (id, operation, parents = [], target) => ({ payload: { kind: 'garden-lifecycle', diagramId: 'garden', id, operation, parents, target } }); // NEW

test('causal lifecycle replay ignores delivery order and concurrent deletion wins over restoration', () => { // NEW
    const trash = record('trash', 'trash'), restore = record('restore', 'restore', ['trash'], 'trash'), concurrent = record('other', 'trash', ['trash']); // NEW
    assert.equal(projectLifecycle([restore, trash], 'garden').state, 'active'); // NEW
    assert.equal(projectLifecycle([concurrent, restore, trash], 'garden').state, 'trashed'); // NEW
    const purge = record('purge', 'purge', ['trash'], 'trash'); // NEW
    assert.equal(projectLifecycle([restore, purge, trash], 'garden').state, 'purged'); // NEW
}); // NEW

test('missing predecessors, cycles, and invalid restoration fence rather than reactivate a project', () => { // NEW
    assert.equal(projectLifecycle([record('a', 'restore', ['missing'], 'missing')], 'garden').pending, true); // NEW
    assert.equal(projectLifecycle([record('a', 'trash', ['b']), record('b', 'trash', ['a'])], 'garden').pending, true); // NEW
    assert.equal(projectLifecycle([record('a', 'restore')], 'garden').pending, true); // NEW
    const left = record('left', 'left'); // NEW
    assert.equal(projectLifecycle([left, record('back', 'rejoin', ['left'], 'left')], 'garden').state, 'active'); // NEW
    assert.equal(projectLifecycle([left, record('restore', 'restore', ['left'], 'left')], 'garden').state, 'left'); // NEW
}); // NEW

async function fixture(t) { // NEW
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-trash-move-')); // NEW
    t.after(() => fs.rm(root, { recursive: true, force: true })); // NEW
    return { root, source: path.join(root, 'source'), destination: path.join(root, 'retained'), journal: path.join(root, 'journal.json') }; // NEW
} // NEW

test('a locked Trash move retries the actual source, rechecks membership and reports its retained copy', async t => { // CHANGE
    const f = await fixture(t), user = { id: 'owner', admin: true, portableIdentityId: 'identity' }; // CHANGE
    const xmlFor = users => '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_users_json="' + JSON.stringify({ usersEnabled: true, users, invites: [] }).replace(/"/g, '&quot;') + '"><mxCell parent="0"/></object></root></mxGraphModel>'; // CHANGE
    const xml = xmlFor([user]), canvas = { shareId: 'retry-share', filename: 'Garden.drawio', folderPath: f.source, diagramPath: path.join(f.source, 'Garden.drawio') }; // CHANGE
    await fs.mkdir(f.source); await fs.writeFile(canvas.diagramPath, xml); // CHANGE
    const journal = { refresh: async () => {}, runExclusive: operation => operation() }; // CHANGE: filesystem and authorization stay real; this test has no journal projection writes.
    const transport = createProjectTransport({ initialize: async () => {}, registry: () => [canvas], profile: f.root, now: Date.now, validateManaged() {}, persist: async () => {}, detach: async () => {}, emit() {}, collaborationStore: () => journal }); // CHANGE
    const input = { shareId: canvas.shareId, userId: user.id, identityId: 'identity', operation: 'trashed', recordId: 'retry-record' }, rename = fs.rename; let locked = true; // CHANGE
    t.mock.method(fs, 'rename', async (source, destination) => { if (source === f.source && locked) { locked = false; throw Object.assign(new Error('Folder still open'), { code: 'EBUSY' }); } return rename(source, destination); }); // CHANGE
    await assert.rejects(transport.applyProjectLifecycle(input), { code: 'EBUSY' }); assert.equal(canvas.localRemoved, true); // CHANGE
    const changed = xmlFor([user, { id: 'other', admin: true }]); await fs.writeFile(canvas.diagramPath, changed); // CHANGE
    await assert.rejects(transport.applyProjectLifecycle(input), /Membership changed/); assert.equal(await fs.readFile(canvas.diagramPath, 'utf8'), changed); // CHANGE: retry must not skip authorization just because localRemoved was persisted before the failed move.
    await fs.writeFile(canvas.diagramPath, xml); const result = await transport.applyProjectLifecycle(input); // CHANGE
    assert.equal(result.reason, ''); assert.equal(await fs.readFile(path.join(f.root, 'project-trash', canvas.shareId, canvas.filename), 'utf8'), xml); // CHANGE
    await assert.rejects(fs.access(canvas.diagramPath), { code: 'ENOENT' }); assert.equal((await transport.applyProjectLifecycle(input)).reason, ''); // CHANGE
}); // CHANGE

test('a move retains the full folder and resumes after a completed rename without its final journal write', async t => { // NEW
    const f = await fixture(t); await fs.mkdir(f.source); await fs.writeFile(path.join(f.source, 'Garden.drawio'), 'diagram'); await fs.mkdir(path.join(f.source, 'assets')); await fs.writeFile(path.join(f.source, 'assets', 'image.png'), 'asset'); // NEW
    await moveRetained(f.source, f.destination, f.journal); // NEW
    const journal = await readOptional(f.journal); await fs.writeFile(f.journal, JSON.stringify({ ...journal, phase: 'moving' })); // NEW
    await moveRetained(f.source, f.destination, f.journal); // NEW
    assert.equal(await fs.readFile(path.join(f.destination, 'assets', 'image.png'), 'utf8'), 'asset'); // NEW
    assert.equal((await readOptional(f.journal)).phase, 'complete'); await assert.rejects(fs.access(f.source)); // NEW
}); // NEW

test('a restore collision preserves both the retained project and the unrelated destination', async t => { // NEW
    const f = await fixture(t); await fs.writeFile(f.source, 'project'); await fs.writeFile(f.destination, 'unrelated'); // NEW
    await assert.rejects(moveRetained(f.source, f.destination, f.journal), /already exists/); // NEW
    assert.equal(await fs.readFile(f.source, 'utf8'), 'project'); assert.equal(await fs.readFile(f.destination, 'utf8'), 'unrelated'); // NEW
}); // NEW

test('cross-volume fallback verifies a complete copy before removing the original', async t => { // NEW
    const f = await fixture(t); await fs.writeFile(f.source, 'project'); const rename = fs.rename; // NEW
    await fs.writeFile(f.destination + '.copying', 'unrelated neighbor'); // NEW
    t.mock.method(fs, 'rename', async (source, destination) => { if (source === f.source) throw Object.assign(new Error('Different volume'), { code: 'EXDEV' }); return rename(source, destination); }); // NEW
    await moveRetained(f.source, f.destination, f.journal); assert.equal(await fs.readFile(f.destination, 'utf8'), 'project'); await assert.rejects(fs.access(f.source)); // NEW
    assert.equal(await fs.readFile(f.destination + '.copying', 'utf8'), 'unrelated neighbor'); // NEW
}); // NEW
test('junctions cannot make a retained move traverse an unrelated folder', async t => { // NEW
    const f = await fixture(t), unrelated = path.join(f.root, 'unrelated'); await fs.mkdir(unrelated); await fs.writeFile(path.join(unrelated, 'Garden.drawio'), 'untouched'); // NEW
    await fs.symlink(unrelated, f.source, process.platform === 'win32' ? 'junction' : 'dir'); // NEW
    await assert.rejects(moveRetained(f.source, f.destination, f.journal), /links|junctions/); // NEW
    assert.equal(await fs.readFile(path.join(unrelated, 'Garden.drawio'), 'utf8'), 'untouched'); // NEW
}); // NEW

test('a failed cross-volume copy leaves the original intact and its journal can be retried', async t => { // NEW
    const f = await fixture(t); await fs.writeFile(f.source, 'project'); const rename = fs.rename; // NEW
    const failure = t.mock.method(fs, 'rename', async (source, destination) => { if (source === f.source) throw Object.assign(new Error('Different volume'), { code: 'EXDEV' }); return rename(source, destination); }); // NEW
    const copying = t.mock.method(fs, 'cp', async () => { throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' }); }); // NEW
    await assert.rejects(moveRetained(f.source, f.destination, f.journal), /Disk full/); assert.equal(await fs.readFile(f.source, 'utf8'), 'project'); // NEW
    failure.mock.restore(); copying.mock.restore(); await moveRetained(f.source, f.destination, f.journal); assert.equal(await fs.readFile(f.destination, 'utf8'), 'project'); // NEW
}); // NEW
