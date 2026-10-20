/** Naming policy, replay authorization, and recoverable no-overwrite projection moves. */ // NEW
import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import os from 'node:os'; // NEW
import { naming, projectName, withProjectName, validateProjectNameChange } from '../src/main/trellis-project-naming.js'; // NEW
import { inspectDiagram, digest } from '../src/main/trellis-share-protocol.js'; // NEW
import { replay, diffObjects } from '../src/main/trellis-collaboration-protocol.js'; // NEW
import { createProjectionNaming } from '../src/main/trellis-projection-naming.js'; // NEW
const escape = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;'); // NEW
const xml = (users = [{ id: 'admin', admin: true }, { id: 'member' }]) => '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_history_id="diagram" trellis_users_diagram_id="diagram" trellis_users_json="' + escape(JSON.stringify({ usersEnabled: true, users })) + '"><mxCell parent="0"/></object></root></mxGraphModel>'; // NEW
test('display text, validation and portable filenames have deterministic Unicode-safe rules', () => { // NEW
    assert.equal(naming.displayName('Community Garden', 'Coordinator'), 'Community Garden - Coordinator'); // NEW
    assert.equal(naming.filename('Garden/A:B', 'a?b*'), 'Garden-A-B - a-b-.drawio'); // NEW
    assert.equal(naming.filename('CON'), '_CON.drawio'); assert.equal(naming.filename('NUL.txt'), '_NUL.txt.drawio'); // NEW
    assert.equal(naming.filename('Garden...  '), 'Garden.drawio'); assert.equal(naming.filename('...'), 'Garden.drawio'); // NEW
    const unicode = naming.filename('🌻'.repeat(120), 'Volunteer'); assert.ok(Buffer.byteLength(unicode) <= 227); assert.ok(!unicode.includes('\ufffd')); // CHANGE
    assert.ok(Buffer.byteLength('.$' + unicode + '_1234567890.dtmp') <= 255); // NEW: concurrent editor drafts also need portable basenames.
    assert.equal(naming.suffix(''), ''); assert.throws(() => naming.suffix('x'.repeat(81)), /80/); assert.throws(() => naming.projectName(''), /project name/); // NEW
    assert.equal(naming.projectName('  Garden.  '), '  Garden.  '); assert.equal(naming.suffix(' West  '), ' West  '); assert.throws(() => naming.projectName('  '), /project name/); // NEW
}); // NEW
test('active admins alone may add, change, or remove shared names, including deleting metadata', () => { // NEW
    const initial = withProjectName(xml(), 'Community Garden'); // NEW
    for (const changed of [withProjectName(initial, 'Renamed'), initial.replace(' trellis_project_name="Community Garden"', ''), initial.replace(/<object.*?<\/object>/, '')]) { // NEW
        assert.throws(() => validateProjectNameChange(initial, changed, 'member'), /administrator/); // NEW
        assert.doesNotThrow(() => validateProjectNameChange(initial, changed, 'admin')); // NEW
    } // NEW
    const disabled = withProjectName(xml([{ id: 'admin', admin: true, disabled: true }]), 'Garden'); // NEW
    assert.throws(() => validateProjectNameChange(disabled, withProjectName(disabled, 'Bad'), 'admin'), /administrator/); // NEW
}); // NEW
test('remote replay rejects a non-admin naming edit even on an editable metadata object', () => { // NEW
    const initial = withProjectName(xml(), 'Community Garden'), proposed = withProjectName(initial, 'Forged'), targets = diffObjects(initial, proposed).targets; // NEW
    const claim = { id: 'claim', kind: 'claim', userId: 'member', deviceId: 'device', sessionId: 'session', clock: 1, parents: [], at: 1000, targets }; // NEW
    const edit = { ...claim, ...diffObjects(initial, proposed), id: 'edit', kind: 'edit', clock: 2, parents: ['claim'], claimIds: ['claim'], at: 1001 }; // NEW
    const result = replay(initial, [claim, edit], 1002); assert.equal(projectName(inspectDiagram(result.xml)), 'Community Garden'); assert.match(result.rejected[0].reason, /administrator/); // NEW
}); // NEW
test('concurrent administrator names converge through ordinary collaboration arbitration', () => { // NEW
    const initial = withProjectName(xml([{ id: 'admin', admin: true }, { id: 'other', admin: true }]), 'Original'); // NEW
    const records = []; // NEW
    for (const [userId, deviceId, name] of [['admin', 'A', 'First'], ['other', 'B', 'Second']]) { // NEW
        const delta = diffObjects(initial, withProjectName(initial, name)); // NEW
        const claim = { id: deviceId + '-claim', kind: 'claim', userId, deviceId, sessionId: deviceId, clock: 1, parents: [], at: 1000, targets: delta.targets }; // NEW
        records.push(claim, { ...claim, ...delta, id: deviceId + '-edit', kind: 'edit', clock: 2, parents: [claim.id], claimIds: [claim.id], at: 1001 }); // NEW
    } // NEW
    const forward = replay(initial, records, 2000), reverse = replay(initial, [...records].reverse(), 2000); // NEW
    assert.equal(forward.xml, reverse.xml); assert.equal(projectName(inspectDiagram(forward.xml)), 'First'); assert.equal(forward.accepted.length, 1); assert.ok(forward.rejected.some(record => record.id === 'B-edit')); // NEW
    assert.equal(naming.filename(projectName(inspectDiagram(forward.xml)), 'My role'), 'First - My role.drawio'); // NEW
}); // NEW
async function fixture(t, beforeRename) { // NEW
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-project-names-')), folderPath = path.join(root, 'canvas'), profile = path.join(root, 'profile'); // NEW
    await fs.mkdir(folderPath); const document = withProjectName(xml(), 'Community Garden'); // NEW
    const canvas = { shareId: 'share', diagramId: 'diagram', folderPath, diagramPath: path.join(folderPath, 'Garden.drawio'), filename: 'Garden.drawio', namingEnabled: true, namingSuffix: 'Coordinator' }; // NEW
    await fs.writeFile(canvas.diagramPath, document); // NEW
    const sessions = new Map([['window', { diagramPath: canvas.diagramPath }]]), moves = []; // NEW
    const writeAtomic = async (filename, content) => { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, content); }; // NEW
    const engine = createProjectionNaming({ profile, sessions, writeAtomic, persist: async () => {}, beforeRename: beforeRename || (async input => outcome => { moves.push({ input, outcome }); }) }); // NEW
    t.after(() => fs.rm(root, { recursive: true, force: true })); return { root, profile, document, canvas, engine, moves, sessions, writeAtomic }; // NEW
} // NEW
test('projection renames update sessions, preserve bytes and IDs, and support clearing and case-only changes', async t => { // NEW
    const f = await fixture(t), original = f.canvas.diagramPath; await f.engine.reconcile(f.canvas, f.document); // NEW
    assert.equal(f.canvas.filename, 'Community Garden - Coordinator.drawio'); assert.equal(await fs.readFile(f.canvas.diagramPath, 'utf8'), f.document); await assert.rejects(fs.access(original)); // NEW
    assert.equal(f.sessions.get('window').diagramPath, f.canvas.diagramPath); assert.equal(f.moves[0].outcome.committed, true); // NEW
    f.canvas.namingSuffix = ''; await f.engine.reconcile(f.canvas, f.document); assert.equal(f.canvas.filename, 'Community Garden.drawio'); // NEW
    await f.engine.reconcile(f.canvas, withProjectName(f.document, 'community garden')); assert.equal(f.canvas.filename, 'community garden.drawio'); assert.equal(f.canvas.filenamePending, false); // NEW
}); // NEW
test('collisions and busy editors preserve files and permit retry or choosing another suffix', async t => { // NEW
    const f = await fixture(t), collision = path.join(f.canvas.folderPath, 'Community Garden - Coordinator.drawio'); await fs.writeFile(collision, 'unrelated'); // NEW
    await f.engine.reconcile(f.canvas, f.document); assert.equal(f.canvas.filenamePending, true); assert.equal(await fs.readFile(collision, 'utf8'), 'unrelated'); assert.equal(await fs.readFile(f.canvas.diagramPath, 'utf8'), f.document); // NEW
    f.canvas.namingSuffix = 'Other'; await f.engine.reconcile(f.canvas, f.document); assert.equal(f.canvas.filename, 'Community Garden - Other.drawio'); // NEW
    let busy = true; const g = await fixture(t, async () => { if (busy) throw new Error('Saving'); return async () => {}; }); // NEW
    await g.engine.reconcile(g.canvas, g.document); assert.equal(g.canvas.filenamePending, true); busy = false; await g.engine.reconcile(g.canvas, g.document); assert.equal(g.canvas.filenamePending, false); // NEW
}); // NEW
test('a locked original rolls back our new link before a subsequent save changes the source', async t => { // NEW
    const f = await fixture(t), source = f.canvas.diagramPath, unlink = fs.unlink; // NEW
    fs.unlink = async filename => { if (filename === source) throw Object.assign(new Error('File is locked'), { code: 'EBUSY' }); return unlink(filename); }; // NEW
    try { await f.engine.reconcile(f.canvas, f.document); } finally { fs.unlink = unlink; } // NEW
    assert.equal(f.canvas.filenamePending, true); assert.equal(f.canvas.diagramPath, source); assert.deepEqual(await fs.readdir(f.canvas.folderPath), ['Garden.drawio']); // NEW
    const saved = withProjectName(f.document, 'Saved while pending'); await fs.writeFile(source, saved); await f.engine.reconcile(f.canvas, saved); // NEW
    assert.equal(f.canvas.filenamePending, false); assert.equal(await fs.readFile(f.canvas.diagramPath, 'utf8'), saved); // NEW
}); // NEW
test('an unremovable partial link blocks projection writes until its recovery journal can finish', async t => { // NEW
    const f = await fixture(t), source = f.canvas.diagramPath, target = path.join(f.canvas.folderPath, 'Community Garden - Coordinator.drawio'), unlink = fs.unlink; // NEW
    fs.unlink = async filename => { if (filename === source || filename === target) throw Object.assign(new Error('File is locked'), { code: 'EBUSY' }); return unlink(filename); }; // NEW
    try { await assert.rejects(f.engine.reconcile(f.canvas, f.document), /locked/); } finally { fs.unlink = unlink; } // NEW
    assert.equal(f.canvas.filenamePending, true); assert.equal(await fs.readFile(source, 'utf8'), f.document); // NEW
    await f.engine.reconcile(f.canvas, f.document); assert.equal(f.canvas.filenamePending, false); assert.equal(f.canvas.diagramPath, target); await assert.rejects(fs.access(source)); // NEW
}); // NEW
test('restart completes a journaled case rename after its old directory entry disappeared', async t => { // NEW
    const f = await fixture(t), source = f.canvas.diagramPath, temporary = '.trellis-rename-interrupted.tmp', target = 'Community Garden - Coordinator.drawio'; // NEW
    await f.writeAtomic(path.join(f.profile, 'projection-renames', 'share.json'), JSON.stringify({ diagramId: 'diagram', source: path.basename(source), target, temporary, hash: digest(f.document) })); // NEW
    await fs.link(source, path.join(f.canvas.folderPath, temporary)); await fs.unlink(source); // NEW
    await f.engine.reconcile(f.canvas, f.document); assert.equal(f.canvas.filename, target); assert.equal(await fs.readFile(f.canvas.diagramPath, 'utf8'), f.document); // NEW
    await assert.rejects(fs.access(path.join(f.profile, 'projection-renames', 'share.json'))); // NEW
}); // NEW
test('external filenames are recovered by identity without becoming naming metadata', async t => { // NEW
    const f = await fixture(t); await fs.rename(f.canvas.diagramPath, path.join(f.canvas.folderPath, 'External name.drawio')); // NEW
    await f.engine.reconcile(f.canvas, f.document); assert.equal(f.canvas.filename, 'Community Garden - Coordinator.drawio'); assert.equal(f.canvas.projectName, 'Community Garden'); // NEW
}); // NEW
test('a failed post-move handle or draft update retries with its persisted previous filenames', async t => { // NEW
    let fail = true; const notices = []; // NEW
    const f = await fixture(t, async input => async outcome => { notices.push({ input, outcome }); if (fail) throw new Error('A draft is locked'); }); // NEW
    const original = f.canvas.diagramPath; await f.engine.reconcile(f.canvas, f.document); // NEW
    assert.equal(f.canvas.filenamePending, true); assert.equal(f.canvas.filename, 'Community Garden - Coordinator.drawio'); // NEW
    fail = false; await f.engine.reconcile(f.canvas, f.document); assert.equal(f.canvas.filenamePending, false); // NEW
    assert.ok(notices.at(-1).outcome.previousPaths.includes(original)); assert.equal(f.sessions.get('window').diagramPath, f.canvas.diagramPath); // NEW
}); // NEW
