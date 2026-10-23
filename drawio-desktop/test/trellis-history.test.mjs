/** Exact reconstruction, migration and retention tests against a real SQLite engine. */ // NEW
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto'; // NEW
import { normalizeDocument, createDocumentDelta, applyDocumentDelta, encodePayload } from '../src/main/trellis-history-codec.js';
import { createHistoryService } from '../src/main/trellis-history-service.js';

function fixture(edit = 0, populated = true) {
    const gardens = Array.from({ length: 50 }, (_, i) => { // NEW: populated gardens, with distinct persisted bed/planting data.
        const beds = Array.from({ length: populated ? 6 : 0 }, (_, b) => `<object id="bed-${i}-${b}" label="Bed ${b}" planting_id="planting-${i}-${b}" crop_plan="${createHash('sha256').update('plan-' + i + '-' + b).digest('hex')}" notes="${createHash('sha256').update('notes-' + i + '-' + b).digest('hex')}"><mxCell parent="garden-${i}" vertex="1"><mxGeometry x="${b * 20}" y="${b * 5}" width="20" height="80" as="geometry"/></mxCell></object>`).join(''); // NEW
        return `<object id="garden-${i}" label="Garden ${i}" garden_module="1" notes="${i === edit % 50 ? 'Edited ' + edit : 'Unchanged'}"><mxCell parent="1" vertex="1"><mxGeometry x="${i * 10}" y="0" width="120" height="200" as="geometry"/></mxCell></object>` + beds; // NEW
    }).join(''); // NEW
    return `<mxfile><diagram id="page-a" name="Gardens"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${gardens}</root></mxGraphModel></diagram><diagram id="page-b" name="Notes"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><object id="note" label="é 🌱"><mxCell parent="1" vertex="1"/></object></root></mxGraphModel></diagram></mxfile>`;
}
const service = options => createHistoryService({ Database: DatabaseSync, dbPath: ':memory:', ...options });
async function initialize(store, xml = fixture()) { return store.run('initialize', { diagramId: 'document-a', xml }); }
const record = (store, xml, metadata = {}) => store.run('record', { diagramId: 'document-a', xml, metadata });

test('document deltas preserve wrappers, Unicode, page/object order and page structure', () => {
    const before = fixture(), after = fixture(8).replace('name="Notes"', 'name="日記"').replace('parent="1" vertex="1"/></object>', 'parent="0" vertex="1" custom="yes"/></object>');
    assert.equal(applyDocumentDelta(before, createDocumentDelta(before, after)), normalizeDocument(after));
    const deleted = after.replace(/<diagram id="page-b"[\s\S]*?<\/diagram>/, '');
    assert.equal(applyDocumentDelta(after, createDocumentDelta(after, deleted)), normalizeDocument(deleted));
    const reordered = before.replace(/(<mxCell id="0"\/>)(<mxCell id="1" parent="0"\/>)/g, '$2$1');
    assert.equal(applyDocumentDelta(before, createDocumentDelta(before, reordered)), normalizeDocument(reordered));
    assert.equal(normalizeDocument(before), normalizeDocument(before.replace('<mxfile>', '<mxfile modified="today" agent="test">').replace('<mxGraphModel>', '<mxGraphModel dx="100" dy="200">')));
});

test('real SQLite migration purges all legacy rows without touching unrelated tables and is restart safe', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trellis-history-')), dbPath = path.join(dir, 'history.sqlite');
    const legacy = new DatabaseSync(dbPath);
    legacy.exec('CREATE TABLE history_events(id TEXT); CREATE TABLE history_snapshots(payload BLOB); CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES (\'keep\');');
    legacy.prepare('INSERT INTO history_snapshots VALUES (?)').run(Buffer.alloc(2 * 1024 * 1024, 4)); legacy.close();
    const sizeBefore = fs.statSync(dbPath).size, store = service({ dbPath });
    try {
        await assert.rejects(initialize(store, '<invalid/>'));
        assert.ok(store._test.database.prepare("SELECT name FROM sqlite_master WHERE name='history_snapshots'").get());
        const start = performance.now(); await initialize(store);
        assert.equal(store._test.database.prepare("SELECT name FROM sqlite_master WHERE name='history_snapshots'").get(), undefined);
        assert.equal(store._test.database.prepare('SELECT value FROM unrelated').get().value, 'keep');
        assert.equal((await store.run('list', { diagramId: 'document-a' })).length, 1);
        await record(store, fixture(2)); store.close();
        const reopened = service({ dbPath }); await initialize(reopened, fixture(2));
        assert.equal((await reopened.run('list', { diagramId: 'document-a' })).length, 2);
        const stats = await reopened.run('statistics', { diagramId: 'document-a' });
        assert.ok(stats.databaseBytes < sizeBefore / 2); assert.equal(stats.reclamationPending, false);
        console.log('History purge:', Math.round(performance.now() - start), 'ms;', sizeBefore, '->', stats.databaseBytes, 'bytes'); reopened.close();
    } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('50 gardens and 500 edits reconstruct exactly with bounded chains and at least 80% payload savings', async () => {
    const store = service(); await initialize(store); let fullBytes = encodePayload(normalizeDocument(fixture())).length, last;
    const start = performance.now();
    for (let i = 1; i <= 500; i++) { const xml = fixture(i); last = await record(store, xml); fullBytes += encodePayload(normalizeDocument(xml)).length; }
    const captureMs = performance.now() - start, readStart = performance.now();
    assert.equal((await store.run('read', { revisionId: last.id })).xml, normalizeDocument(fixture(500)));
    const totals = store._test.database.prepare('SELECT SUM(payload_bytes) AS bytes, MAX(depth) AS depth FROM history_v2_revisions').get();
    assert.ok(totals.depth <= 30); assert.ok(totals.bytes < fullBytes * 0.2, JSON.stringify({ totals, fullBytes }));
    console.log('History benchmark:', JSON.stringify({ captureMs: Math.round(captureMs), reconstructMs: Math.round(performance.now() - readStart), payloadBytes: totals.bytes, fullSnapshotBytes: fullBytes, savedPercent: Math.round(100 * (1 - totals.bytes / fullBytes)), maxDepth: totals.depth })); store.close();
});

test('checkpoints are standalone, corrupt dependencies fail, and failed writes are atomic', async () => {
    const store = service(); await initialize(store);
    const a = await record(store, fixture(1)), b = await record(store, fixture(2), { checkpoint: true, title: 'Keep' });
    assert.equal(b.storageKind, 'full');
    store._test.database.prepare('UPDATE history_v2_revisions SET payload=? WHERE id=?').run(Buffer.from('bad'), a.id);
    await assert.rejects(store.run('read', { revisionId: a.id }));
    assert.equal((await store.run('read', { revisionId: b.id })).xml, normalizeDocument(fixture(2)));
    const count = (await store.run('list', { diagramId: 'document-a' })).length;
    await assert.rejects(record(store, '<invalid/>')); assert.equal((await store.run('list', { diagramId: 'document-a' })).length, count); store.close();
});

test('retention protects checkpoints, baseline and latest 100 and anchors retained dependencies', async () => {
    const store = service({ budget: 1 }); await initialize(store, fixture(0, false));
    const keep = await record(store, fixture(1, false), { checkpoint: true });
    for (let i = 2; i < 115; i++) await record(store, fixture(i, false));
    const revisions = await store.run('list', { diagramId: 'document-a' });
    assert.equal(revisions.length, 102); assert.ok(revisions.some(r => r.id === keep.id));
    for (const revision of revisions) await store.run('read', { revisionId: revision.id });
    assert.equal((await store.run('statistics', { diagramId: 'document-a' })).overBudget, true); store.close();
});

test('remote deltas wait for predecessors; retired generations and identity collisions are rejected', async () => {
    const a = service(), b = service(); await initialize(a); await initialize(b);
    const first = await record(a, fixture(1)), second = await record(a, fixture(2));
    const base = await a.run('export', { diagramId: 'document-a', revisionId: first.id });
    const delta = await a.run('export', { diagramId: 'document-a', revisionId: second.id, baseRevisionId: first.id });
    assert.equal(await b.run('import', { entry: delta }), false);
    await b.run('import', { entry: base });
    assert.equal((await b.run('read', { revisionId: second.id })).xml, normalizeDocument(fixture(2)));
    await b.run('reset', { diagramId: 'document-a', generation: 'reset-v2', baselineId: 'reset-baseline', xml: fixture(3) });
    await assert.rejects(b.run('import', { entry: base }), /retired/); a.close(); b.close();
});

test('SQLite write failure rolls back the revision and latest pointer; compaction retries after interruption', async () => { // NEW
    const store = service(); await initialize(store, fixture(0, false));
    const before = await store.run('list', { diagramId: 'document-a' });
    store._test.database.exec("CREATE TRIGGER fail_history BEFORE INSERT ON history_v2_revisions BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END");
    await assert.rejects(record(store, fixture(1, false)), /simulated disk/);
    assert.equal((await store.run('list', { diagramId: 'document-a' })).length, before.length);
    assert.equal(store._test.database.prepare('SELECT latest_id FROM history_v2_documents').get().latest_id, before[0].id);
    store._test.database.exec('DROP TRIGGER fail_history'); await record(store, fixture(1, false));
    store._test.database.prepare("UPDATE history_v2_state SET value='pending' WHERE key='compact'").run(); await store.run('compact');
    assert.equal((await store.run('statistics', { diagramId: 'document-a' })).reclamationPending, false); store.close();
}); // NEW

test('document contexts reject stale writes and cross-document reads while windows remain independent', async () => { // NEW
    const store = service(), first = { diagramId: 'document-a', token: 1, xml: fixture(0, false) };
    await store.request('window-a', 'initialize', first); await store.request('window-b', 'initialize', first);
    const old = await store.request('window-b', 'record', { ...first, xml: fixture(2, false) });
    await store.request('window-a', 'initialize', { ...first, diagramId: 'document-b', token: 2 });
    await assert.rejects(store.request('window-a', 'record', first), /context changed/);
    await assert.rejects(store.request('window-a', 'read', { diagramId: 'document-b', token: 2, revisionId: old.id }), /another diagram/);
    assert.ok((await store.request('window-b', 'list', first)).some(item => item.id === old.id)); store.close();
}); // NEW
