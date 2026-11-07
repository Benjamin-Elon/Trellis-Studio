/** Real signed accepted history with a compact current checkpoint; this is correctness, not release qualification. */ // CHANGE
import test from 'node:test'; // CHANGE
import assert from 'node:assert/strict'; // CHANGE
import fs from 'node:fs/promises'; // CHANGE
import os from 'node:os'; // CHANGE
import path from 'node:path'; // CHANGE
import crypto from 'node:crypto'; // CHANGE
import { createCollaborationStore } from '../src/main/trellis-collaboration-store.js'; // CHANGE
import { diffObjects, applyChanges, objects } from '../src/main/trellis-collaboration-protocol.js'; // CHANGE
import { signRecord, digest, canonical } from '../src/main/trellis-share-protocol.js'; // CHANGE

test('10,000 signed accepted decisions preserve current state across cold, warm and restarted reads: protocol 5', { skip: process.env.TRELLIS_SAVE_STRESS_TEST !== '1', timeout: 240000 }, async t => { // CHANGE
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-save-stress-')); // CHANGE
    t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })); // CHANGE
    const pair = crypto.generateKeyPairSync('ed25519'), keys = { publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), privateKey: pair.privateKey }; // CHANGE
    const canvas = { protocolVersion: 5, membershipVersion: 1, shareId: 'stress', diagramId: 'diagram', folderPath: directory, diagramPath: path.join(directory, 'Garden.drawio'), coordinatorDeviceId: 'device', coordinatorPublicKey: keys.publicKey, members: [{ deviceId: 'device', userId: 'admin', publicKey: keys.publicKey }] }; // CHANGE
    const writeAtomic = async (filename, text) => { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename + '.tmp', text); await fs.rename(filename + '.tmp', filename); }; // CHANGE
    const writeImmutable = async (filename, record) => { await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, JSON.stringify(record), { flag: 'wx' }); }; // CHANGE
    const users = JSON.stringify({ usersEnabled: true, users: [{ id: 'admin', admin: true }] }).replaceAll('"', '&quot;'); // CHANGE
    const xml = '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_users_json="' + users + '"><mxCell parent="0"/></object><object id="a" label="Original"><mxCell vertex="1" parent="1"/></object>' + Array.from({ length: 100 }, (_, i) => '<object id="notes-' + i + '" notes="' + 'garden planning '.repeat(1350) + '"><mxCell vertex="1" parent="1"/></object>').join('') + '</root></mxGraphModel>'; // CHANGE
    const samples = [], make = () => createCollaborationStore({ canvas, keys, deviceId: 'device', profile: path.join(directory, 'private'), now: () => 2000, writeAtomic, writeImmutable, onTiming: sample => samples.push(sample) }); // CHANGE
    const journal = make(); await journal.initialize(xml); // CHANGE
    const actor = { userId: 'admin', sessionId: journal.sessionFor(1, 'admin') }, key = '["","a"]'; // CHANGE
    const claimed = await journal.action(1, 'admin', { kind: 'claim', targets: [key] }), hold = claimed.collaboration.holds[0], initial = await journal.snapshot(); // CHANGE
    const first = diffObjects(initial.xml, initial.xml.replace('label="Original"', 'label="Updated"')), firstXml = applyChanges(initial.xml, first.changes), second = diffObjects(firstXml, initial.xml); // CHANGE
    const variants = [firstXml, initial.xml], hashes = variants.map(digest), deltas = [first, second], acceptedDirectory = path.join(directory, '.trellis', 'collaboration-v' + protocolVersion); // CHANGE
    let previous = initial.headHash, last; const pending = []; // CHANGE
    for (let index = 0; index < 10000; index++) { // CHANGE
        const sequence = initial.sequence + index + 1, variant = index % 2; // CHANGE
        const proposal = signRecord({ schema: protocolVersion, shareId: canvas.shareId, diagramId: canvas.diagramId, id: 'historical-edit-' + index, deviceId: 'device', ...actor, kind: 'edit', at: 2000, ...deltas[variant], claimIds: [hold.claimId] }, keys.privateKey); // CHANGE
        const commit = signRecord({ schema: protocolVersion, shareId: canvas.shareId, diagramId: canvas.diagramId, kind: 'commit', epoch: initial.epoch, sequence, previous, acceptedAt: 2000, proposal, contentHash: hashes[variant] }, keys.privateKey); // CHANGE
        pending.push(writeImmutable(path.join(acceptedDirectory, 'epochs', initial.epoch, String(sequence).padStart(12, '0') + '.json'), commit)); // CHANGE
        previous = digest(canonical(commit)); last = proposal.payload; if (pending.length === 20) { await Promise.all(pending); pending.length = 0; } // CHANGE
    } // CHANGE
    await Promise.all(pending); // CHANGE
    const state = { xml: initial.xml, sequence: initial.sequence + 10000, epoch: initial.epoch, headHash: previous, snapshotHash: initial.snapshotHash, objectVersions: { ...initial.objectVersions, [key]: { version: initial.sequence + 10000, hash: objects(initial.xml).get(key).hash } }, attribution: { [key]: { id: last.id, kind: 'edit', userId: last.userId, deviceId: last.deviceId, at: last.at, key, hash: objects(initial.xml).get(key).hash, targets: last.targets } }, holds: initial.holds, presence: [], reservations: [], lastEditId: last.id }; // CHANGE
    const checkpoint = signRecord({ schema: protocolVersion, shareId: canvas.shareId, diagramId: canvas.diagramId, kind: 'checkpoint', deviceId: 'device', state, members: canvas.members, membershipVersion: canvas.membershipVersion }, keys.privateKey), checkpointId = digest(canonical(checkpoint)); // CHANGE
    await writeImmutable(path.join(acceptedDirectory, 'checkpoints', checkpointId + '.json'), checkpoint); // CHANGE
    await writeAtomic(path.join(acceptedDirectory, 'heads', 'device.json'), JSON.stringify(signRecord({ schema: protocolVersion, shareId: canvas.shareId, diagramId: canvas.diagramId, deviceId: 'device', epoch: initial.epoch, sequence: state.sequence, hash: previous, checkpointId, checkpointSequence: state.sequence }, keys.privateKey))); // CHANGE
    const archived = path.join(directory, 'unavailable-history'); await fs.rename(path.join(acceptedDirectory, 'epochs', initial.epoch), archived); // CHANGE: any attempted covered-record read must now fail.
    assert.equal((await fs.readdir(archived)).length, 10001); // CHANGE: the fixture contains the claim plus 10,000 real signed accepted decisions.
    const observations = []; samples.length = 0; // CHANGE
    for (const [label, store] of [['cold', make()], ['warm', journal], ['restart', make()]]) { // CHANGE
        const started = performance.now(), current = await store.snapshot(); observations.push({ label, durationMs: performance.now() - started }); // CHANGE
        assert.equal(current.xml, initial.xml); assert.equal(current.sequence, state.sequence); assert.equal(current.lastEditId, last.id); assert.equal(current.errors.length, 0); assert.ok(current.records.length < 10); // CHANGE
        assert.equal(current.objectVersions[key].hash, objects(initial.xml).get(key).hash); // CHANGE
    } // CHANGE
    assert.ok(samples.filter(sample => sample.phase === 'read').every(sample => sample.replayCount === 0 && sample.historicalRecordsRead === 0)); // CHANGE
    const latest = journal, next = initial.xml.replace('label="Original"', 'label="After history"'); // CHANGE
    assert.equal((await latest.action(1, 'admin', { kind: 'save', baseXml: initial.xml, xml: next })).ok, true); assert.equal((await make().snapshot()).xml, next); // CHANGE: correctness includes an actual current save after historical accumulation.
    t.diagnostic(JSON.stringify({ protocolVersion, records: 10000, observations, releaseQualified: false })); // CHANGE
}); // CHANGE
