/** Exercise native project definitions, authority isolation, and portable round trips. */ // NEW
import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import fs from 'node:fs/promises'; // NEW
import os from 'node:os'; // NEW
import path from 'node:path'; // NEW
import crypto from 'node:crypto'; // NEW
import { createReferenceSnapshots } from '../src/main/trellis-reference-snapshots.js'; // NEW
import { createCollaborationStore } from '../src/main/trellis-collaboration-store.js'; // NEW
import { writeImmutable } from '../src/main/trellis-syncthing-service.js'; // NEW
import { inspectDiagram, digest, canonical } from '../src/main/trellis-share-protocol.js'; // NEW
import { diffObjects } from '../src/main/trellis-collaboration-protocol.js'; // NEW
import { documentContentHash } from '../src/main/trellis-collaboration-protocol.js'; // NEW
import { createRequire } from 'node:module'; // NEW
const require = createRequire(import.meta.url), { JSDOM } = require('jsdom'); // NEW
const C = globalThis.TrellisReferenceCore; // NEW
const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'); // NEW
function references() { return C.putCatalog(C.newStore({}), 'irrigation_catalog_json', { version: 1, items: [{ id: 'pipe', name: 'Pipe', stockState: 'owned', stockQuantity: 7 }] }); } // NEW
function diagram(store) { const users = { usersEnabled: true, users: [{ id: 'owner', admin: true }] }; return '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_users_diagram_id="diagram" trellis_users_json="' + escape(JSON.stringify(users)) + '"><mxCell parent="0"/></object><object id="garden" garden_module="1" label="Garden" trellis_owner_user_id="owner" trellis_references_json="' + escape(JSON.stringify(store)) + '" irrigation_catalog_json="' + escape(JSON.stringify({ version: 1, items: [{ id: 'pipe', name: 'Pipe', stockState: 'owned', stockQuantity: 7 }] })) + '"><mxCell parent="1" vertex="1"/></object><object id="independent" label="Other"><mxCell parent="1" vertex="1"/></object></root></mxGraphModel>'; } // NEW
async function fixture(t) { // NEW
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-reference-snapshots-')); t.after(async () => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); await fs.rm(root, { recursive: true, force: true }); }); // NEW
    const pair = crypto.generateKeyPairSync('ed25519'), keys = { publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }), privateKey: pair.privateKey }, canvas = { shareId: 'project', diagramId: 'diagram', protocolVersion: 5, projectFormat: 2, folderPath: root, diagramPath: path.join(root, 'Garden.drawio'), filename: 'Garden.drawio', coordinatorDeviceId: 'device', coordinatorPublicKey: keys.publicKey, members: [{ deviceId: 'device', userId: 'owner', publicKey: keys.publicKey }] }; // NEW
    const writeAtomic = async (file, text) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file + '.tmp', text); await fs.rename(file + '.tmp', file); }; // NEW
    const parameters = { canvas, keys, deviceId: 'device', profile: path.join(root, 'private'), writeAtomic, writeImmutable }; return { root, parameters, snapshots: createReferenceSnapshots(parameters) }; // NEW
} // NEW
test('canonical addresses, compact stock overlays and portable export preserve pinned definitions', async t => { // NEW
    const f = await fixture(t), store = references(), input = diagram(store), compact = await f.snapshots.compact(input), garden = inspectDiagram(compact).cells.find(c => c.id === 'garden'), pointer = JSON.parse(garden.node.getAttribute(C.ATTR)); // NEW
    assert.equal(pointer.digest, digest(canonical(store))); assert.equal(C.snapshotDigest(canonical(store)), pointer.digest); // NEW
    assert.equal(JSON.parse(garden.node.getAttribute('irrigation_catalog_json')).items[0].name, undefined); // NEW
    const portable = await f.snapshots.portable(compact); assert.equal(diffObjects(input, portable).changes.length, 0); // NEW
    await f.snapshots.compact(input); assert.equal((await fs.readdir(path.join(f.root, '.trellis', 'references'))).length, 1); // NEW
    const copied = createReferenceSnapshots(f.parameters); assert.equal((await copied.hydrate(compact)).unavailable.garden, undefined); // NEW
    const corruptPath = path.join(f.root, '.trellis', 'references', pointer.digest + '.json'); await fs.writeFile(corruptPath, '{}'); const fresh = createReferenceSnapshots(f.parameters); assert.match((await fresh.hydrate(compact)).unavailable.garden.reason, /verification/); await assert.rejects(fresh.portable(compact), /verification/); // NEW
}); // NEW

test('numeric keys share exact browser/file addresses and cached dependencies detect deletion and replacement', async t => { // NEW
    const f = await fixture(t), store = { ...references(), provenance: { '2': 'two', '10': 'ten' } }, compact = await f.snapshots.compact(diagram(store)), pointer = JSON.parse(inspectDiagram(compact).cells.find(cell => cell.id === 'garden').node.getAttribute(C.ATTR)); // NEW
    const filename = path.join(f.root, '.trellis', 'references', pointer.digest + '.json'), raw = await fs.readFile(filename, 'utf8'); // NEW
    assert.equal(raw, C.canonical(store)); assert.equal(digest(raw), pointer.digest); assert.equal(C.snapshotDigest(raw), pointer.digest); // NEW
    await fs.unlink(filename); assert.ok((await f.snapshots.hydrate(compact)).unavailable.garden); // NEW
    await f.snapshots.publish(store); assert.equal((await f.snapshots.hydrate(compact)).unavailable.garden, undefined); // NEW: a late valid dependency restores editing without substituting defaults.
    await fs.writeFile(filename, '{}'); assert.match((await f.snapshots.hydrate(compact)).unavailable.garden.reason, /verification/); // NEW
}); // NEW
test('new-format coordinator saves, restarts and exports without embedding definitions or changing legacy sources', async t => { // NEW
    const f = await fixture(t), source = diagram(references()), store = createCollaborationStore(f.parameters), initial = await store.initialize(source); // NEW
    assert.ok(initial.xml.length < source.length); const opened = await store.action(1, 'owner', { kind: 'open-view', explicitRefresh: true }); assert.equal(opened.collaboration.projectFormat, 2); // NEW
    const next = initial.xml.replace('label="Other"', 'label="Edited"'), saved = await store.action(1, 'owner', { kind: 'save', proposalId: 'test-save', baseXml: initial.xml, xml: next, explicitRefresh: true }); assert.equal(saved.ok, true, saved.reason); // NEW
    const restarted = createCollaborationStore(f.parameters); assert.equal(diffObjects((await restarted.snapshot()).xml, next).changes.length, 0); // NEW
    const portable = await restarted.action(1, 'owner', { kind: 'portable-export', xml: next }); assert.equal(JSON.parse(inspectDiagram(portable.xml).cells.find(c => c.id === 'garden').node.getAttribute(C.ATTR)).version, 1); // NEW
    const head = JSON.parse(await fs.readFile(path.join(f.root, '.trellis', 'collaboration-v5', 'heads', 'device.json'))); assert.equal(head.payload.schema, 5); // NEW
}); // NEW
test('missing references keep unrelated gardens editable and reject edits in the affected garden', async t => { // NEW
    const f = await fixture(t), store = createCollaborationStore(f.parameters), initial = await store.initialize(diagram(references())); // NEW
    const pointer = JSON.parse(inspectDiagram(initial.xml).cells.find(c => c.id === 'garden').node.getAttribute(C.ATTR)); await fs.unlink(path.join(f.root, '.trellis', 'references', pointer.digest + '.json')); // NEW
    const reopened = createCollaborationStore(f.parameters), opened = await reopened.action(2, 'owner', { kind: 'open-view', explicitRefresh: true }); assert.ok(opened.collaboration.references.unavailable.garden); // NEW
    const next = initial.xml.replace('label="Other"', 'label="Allowed"'), result = await reopened.action(2, 'owner', { kind: 'save', baseXml: initial.xml, xml: next }); assert.equal(result.ok, true, result.reason); // NEW
    await assert.rejects(reopened.action(2, 'owner', { kind: 'save', baseXml: next, xml: next.replace('label="Garden"', 'label="Blocked"') }), /unavailable/); // NEW
    const withoutGarden = next.replace(/<object id="garden"[\s\S]*?<\/object>/, ''); await assert.rejects(reopened.action(2, 'owner', { kind: 'save', baseXml: next, xml: withoutGarden }), /unavailable/); // NEW: deleting a missing-dependency garden remains a content mutation.
}); // NEW

test('concurrent project verification cannot borrow another project’s matching reference evidence', async t => { // NEW
    const first = await fixture(t), second = await fixture(t), left = createCollaborationStore(first.parameters), right = createCollaborationStore(second.parameters); // NEW
    const definitions = references(), initial = await left.initialize(diagram(definitions)); await right.initialize(diagram(definitions)); // CHANGE
    const pointer = JSON.parse(inspectDiagram(initial.xml).cells.find(cell => cell.id === 'garden').node.getAttribute(C.ATTR)); await fs.unlink(path.join(second.root, '.trellis', 'references', pointer.digest + '.json')); // NEW
    const reopenedLeft = createCollaborationStore(first.parameters), reopenedRight = createCollaborationStore(second.parameters); // NEW
    const [available, unavailable] = await Promise.all([reopenedLeft.action(1, 'owner', { kind: 'open-view', explicitRefresh: true }), reopenedRight.action(1, 'owner', { kind: 'open-view', explicitRefresh: true })]); // NEW
    assert.equal(available.collaboration.references.unavailable.garden, undefined); assert.ok(unavailable.collaboration.references.unavailable.garden); // NEW
    await assert.rejects(reopenedRight.action(1, 'owner', { kind: 'save', baseXml: initial.xml, xml: initial.xml.replace('label="Garden"', 'label="Blocked"') }), /unavailable/); // NEW
}); // NEW
test('browser object transactions match native hashes, enforce predecessor versions and retry once', async t => { // NEW
    const f = await fixture(t), store = createCollaborationStore(f.parameters), initial = await store.initialize(diagram(references())), dom = new JSDOM('', { runScripts: 'outside-only' }); t.after(() => dom.window.close()); // NEW
    dom.window.eval(await fs.readFile(new URL('../drawio/src/main/webapp/js/trellis-reference-core.js', import.meta.url), 'utf8')); dom.window.eval(await fs.readFile(new URL('../drawio/src/main/webapp/js/trellis-object-transactions.js', import.meta.url), 'utf8')); // NEW
    const transport = dom.window.TrellisObjectTransactions.create(); assert.equal(transport.capture(initial.xml).hash, documentContentHash(initial.xml)); // NEW
    const opened = await store.action(1, 'owner', { kind: 'open-view', explicitRefresh: true }), next = initial.xml.replace('label="Other"', 'label="Changed"'), transaction = JSON.parse(JSON.stringify(transport.transaction(initial.xml, next))), input = { kind: 'save', explicitRefresh: true, proposalId: 'compact-save', transaction }; // NEW
    assert.equal(transaction.changes.length, 1); const accepted = await store.action(1, 'owner', input); assert.equal(accepted.ok, true, accepted.reason); assert.equal(accepted.collaboration.policyDelta.baseHash, opened.collaboration.policyHash); assert.equal(accepted.collaboration.policyDelta.cells.length, 1); // NEW
    const retry = await store.action(1, 'owner', input); assert.equal(retry.duplicate, true); assert.equal((await store.snapshot()).sequence, 1); // NEW
    const broken = { ...input, proposalId: 'bad-version', transaction: { ...transaction, baseHash: documentContentHash(next), changes: transaction.changes.map(change => ({ ...change, before: '0'.repeat(64) })) } }; await assert.rejects(store.action(1, 'owner', broken), /changed|version|base|conflict/i); // NEW
    await assert.rejects(store.action(1, 'owner', { ...input, transaction: { ...transaction, changes: [] } }), /different contents/); // NEW
}); // NEW

test('compact receipt retries finish interrupted private checkpoints before the next save', async t => { // NEW
    const f = await fixture(t), write = f.parameters.writeAtomic; let failView = false; // NEW
    f.parameters.writeAtomic = async (file, text) => { if (failView && file.includes('object-views') && file.endsWith('.json')) throw Error('Interrupted view checkpoint'); return write(file, text); }; // NEW
    const store = createCollaborationStore(f.parameters), initial = await store.initialize(diagram(references())); await store.action(1, 'owner', { kind: 'open-view', explicitRefresh: true }); // NEW
    const next = initial.xml.replace('label="Other"', 'label="First"'), input = { kind: 'save', explicitRefresh: true, proposalId: 'interrupted-compact', transaction: { version: 1, baseHash: documentContentHash(initial.xml), changes: diffObjects(initial.xml, next).changes } }; // NEW
    failView = true; await assert.rejects(store.action(1, 'owner', input), /Interrupted view checkpoint/); failView = false; // NEW
    assert.equal((await store.action(1, 'owner', input)).duplicate, true); // NEW
    const after = next.replace('label="First"', 'label="Second"'), result = await store.action(1, 'owner', { ...input, proposalId: 'next-compact', transaction: { version: 1, baseHash: documentContentHash(next), changes: diffObjects(next, after).changes } }); // NEW
    assert.equal(result.ok, true, result.reason); assert.equal((await store.snapshot()).sequence, 2); // NEW
}); // NEW

for (const invalidation of ['actor', 'revocation', 'document']) test('asynchronous preparation cannot publish after ' + invalidation + ' changes', async t => { // CHANGE
    const f = await fixture(t); let enter, resume; const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { resume = resolve; }); // NEW
    f.parameters.prepareXml = async xml => { enter(); await gate; return xml; }; // NEW
    let documentCurrent = true; f.parameters.validateActor = () => { if (!documentCurrent) throw Error('Document context changed.'); }; // NEW
    const store = createCollaborationStore(f.parameters), initial = await store.initialize(diagram(references())); await store.action(1, 'owner', { kind: 'open-view', explicitRefresh: true }); // NEW
    const pending = store.action(1, 'owner', { kind: 'save', baseXml: initial.xml, xml: initial.xml.replace('label="Other"', 'label="Obsolete"'), explicitRefresh: true }); // NEW
    const rejected = assert.rejects(pending, /author|actor|context|approved|revoked/i); await entered; // NEW
    if (invalidation === 'actor') store.forget(1); else if (invalidation === 'document') documentCurrent = false; else f.parameters.canvas.revoked = true; resume(); await rejected; // CHANGE
    assert.equal((await store.snapshot()).xml.includes('label="Obsolete"'), false); // NEW
}); // NEW

test('a forgotten actor cannot publish after its private proposal write finishes', async t => { // NEW
    const f = await fixture(t), immutable = f.parameters.writeImmutable; let invalidate = false, store; // NEW
    f.parameters.writeImmutable = async (filename, ...args) => { const result = await immutable(filename, ...args); if (invalidate && filename.includes('pending-proposals')) store.forget(1); return result; }; // NEW
    store = createCollaborationStore(f.parameters); const initial = await store.initialize(diagram(references())); await store.action(1, 'owner', { kind: 'open-view', explicitRefresh: true }); // NEW
    invalidate = true; await assert.rejects(store.action(1, 'owner', { kind: 'save', proposalId: 'late-author', baseXml: initial.xml, xml: initial.xml.replace('label="Other"', 'label="Obsolete"'), explicitRefresh: true }), /author|actor|context/i); // NEW
    assert.equal((await store.snapshot()).xml.includes('label="Obsolete"'), false); // NEW
}); // NEW
