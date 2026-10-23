/** Transactional owner of revision history; never writes diagram files or external databases. */ // NEW
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HISTORY_VERSION, normalizeDocument, encodeRevision, decodePayload, applyDocumentDelta } from './trellis-history-codec.js';
import { digest, safeId } from './trellis-share-protocol.js'; // NEW

export const HISTORY_BUDGET = 500 * 1024 * 1024; // NEW
const bytes = value => Buffer.byteLength(value, 'utf8');

/** Database is injected so the same real-SQLite tests run under Node and Electron. */ // NEW
export function createHistoryService({ Database, dbPath, budget = HISTORY_BUDGET, beforeOpen = () => {}, now = Date.now }) {
    let db = null, queue = Promise.resolve(), closed = false, lastCompaction = 0; // NEW
    const contexts = new Map();
    const recent = new Map(); // NEW: one verified recorder base per document; explicit reads always revalidate dependencies.
    function transaction(work) {
        db.exec('BEGIN IMMEDIATE');
        try { const result = work(); db.exec('COMMIT'); return result; }
        catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    function open() {
        if (closed) throw new Error('History storage has shut down.');
        if (db) return;
        beforeOpen();
        if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        db = new Database(dbPath);
        db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;
            CREATE TABLE IF NOT EXISTS history_v2_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS history_v2_documents (diagram_id TEXT PRIMARY KEY, generation TEXT NOT NULL, latest_id TEXT);
            CREATE TABLE IF NOT EXISTS history_v2_revisions (
                id TEXT PRIMARY KEY, diagram_id TEXT NOT NULL, generation TEXT NOT NULL,
                timestamp INTEGER NOT NULL, metadata TEXT NOT NULL, kind TEXT NOT NULL,
                base_id TEXT, hash TEXT NOT NULL, payload BLOB NOT NULL, payload_bytes INTEGER NOT NULL,
                metadata_bytes INTEGER NOT NULL, depth INTEGER NOT NULL, delta_bytes INTEGER NOT NULL,
                full_bytes INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ready');
            CREATE INDEX IF NOT EXISTS history_v2_diagram ON history_v2_revisions(diagram_id, generation, timestamp);
            CREATE TABLE IF NOT EXISTS history_v2_retired (diagram_id TEXT NOT NULL, generation TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(diagram_id,generation,id));`);
        db.exec('CREATE TABLE IF NOT EXISTS history_v2_anchors (diagram_id TEXT NOT NULL, id TEXT PRIMARY KEY)'); // NEW: retain unpublished compaction work across crashes.
    }
    const state = key => db.prepare('SELECT value FROM history_v2_state WHERE key=?').get(key)?.value;
    const setState = (key, value) => db.prepare('INSERT OR REPLACE INTO history_v2_state VALUES (?,?)').run(key, value);
    const document = id => db.prepare('SELECT * FROM history_v2_documents WHERE diagram_id=?').get(safeId(id));
    const row = id => db.prepare('SELECT * FROM history_v2_revisions WHERE id=?').get(safeId(id));
    const rows = id => db.prepare('SELECT * FROM history_v2_revisions WHERE diagram_id=? ORDER BY timestamp, rowid').all(id);
    const retired = (id, generation, revisionId) => !!db.prepare('SELECT 1 FROM history_v2_retired WHERE diagram_id=? AND generation=? AND id=?').get(id, generation, revisionId);
    function metadata(record) {
        return { ...JSON.parse(record.metadata), snapshotId: record.id, diagramHash: record.hash, schemaVersion: HISTORY_VERSION, generation: record.generation, storedBytes: record.payload_bytes + record.metadata_bytes, payloadBytes: record.payload_bytes, storageKind: record.kind, baseRevisionId: record.base_id, pending: record.status !== 'ready' };
    }
    /** Reconstruct off-screen and validate every dependency, depth and content hash. */ // NEW
    function readRevision(id, visiting = new Set()) {
        if (visiting.has(id) || visiting.size > 30) throw new Error('History has a cyclic or excessive dependency chain.');
        const record = row(id);
        if (!record) throw new Error('History dependency is missing; wait for shared history to finish downloading.');
        if (!document(record.diagram_id) || document(record.diagram_id).generation !== record.generation) throw new Error('History belongs to a retired generation.');
        visiting.add(id);
        let xml;
        if (record.kind === 'full') xml = normalizeDocument(decodePayload(record.payload));
        else if (record.kind === 'delta') {
            const base = record.base_id && row(record.base_id);
            if (!base || base.diagram_id !== record.diagram_id || base.generation !== record.generation) throw new Error('History dependency is missing or belongs to another document.');
            xml = applyDocumentDelta(readRevision(record.base_id, visiting), JSON.parse(decodePayload(record.payload)));
        } else throw new Error('Unsupported history record format.');
        visiting.delete(id);
        if (digest(xml) !== record.hash) throw new Error('History content checksum failed; the current diagram was not changed.');
        return xml;
    }
    function insert(revision, encoded, generation, baseId = null, status = 'ready') {
        const clean = { ...revision, id: safeId(revision.id), diagramHistoryId: safeId(revision.diagramHistoryId), schemaVersion: HISTORY_VERSION };
        const json = JSON.stringify(clean);
        db.prepare('INSERT INTO history_v2_revisions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(clean.id, clean.diagramHistoryId, generation, clean.timestamp, json, encoded.kind, encoded.kind === 'delta' ? baseId : null, encoded.contentHash, encoded.payload, encoded.payload.length, bytes(json), encoded.depth, encoded.deltaBytes, encoded.fullBytes, status); // NEW
        return metadata(row(clean.id));
    }
    /** Deleting SQL rows alone does not release disk space. Compaction is retryable. */ // NEW
    function compact() {
        if (state('compact') !== 'pending') return;
        try { db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);'); setState('compact', 'complete'); lastCompaction = now(); } // CHANGE
        catch (_) { /* Keep valid history; statistics expose pending physical reclamation. */ }
    }
    function purgeLegacy() {
        if (state('legacy-purge') === 'complete' && !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name IN ('history_events','history_snapshots')").get()) return; // NEW: a downgraded app cannot permanently revive legacy rows.
        transaction(() => {
            db.exec('DROP TABLE IF EXISTS history_events; DROP TABLE IF EXISTS history_snapshots;');
            setState('legacy-purge', 'complete'); setState('compact', 'pending');
        });
        compact();
    }
    function initialize(input) {
        const diagramId = safeId(input.diagramId);
        const xml = normalizeDocument(input.xml); // Verify the open document before removing any legacy history. // NEW
        let doc = document(diagramId);
        if (!doc) {
            transaction(() => {
                db.prepare('INSERT INTO history_v2_documents VALUES (?,?,NULL)').run(diagramId, 'local-v2');
                record({ diagramId, xml, forceFull: true, metadata: { ...input.metadata, category: 'System', action: 'baseline', title: 'History reset baseline', checkpoint: false } }, false); // CHANGE
            });
            doc = document(diagramId);
        } else if (doc.latest_id) { // NEW: verify the baseline even when resuming a partially completed migration.
            let valid = true; try { readRevision(doc.latest_id); } catch (_) { valid = false; }
            if (!valid || row(doc.latest_id)?.hash !== digest(xml)) record({ diagramId, xml, forceFull: !valid, metadata: { category: 'System', action: 'open', title: valid ? 'Opened diagram state' : 'Recovered document baseline' } });
        }
        purgeLegacy(); compact();
        return { generation: doc.generation, revisions: list(diagramId), statistics: statistics(diagramId) };
    }
    function record(input, useTransaction = true) {
        const work = () => {
            const doc = document(input.diagramId);
            if (!doc) throw new Error('Initialize history before recording.');
            if (input.generation && input.generation !== doc.generation) throw new Error('History reset occurred; refresh the recording baseline.');
            const xml = normalizeDocument(input.xml), previous = doc.latest_id && row(doc.latest_id);
            const meta = input.metadata || {};
            if (previous?.hash === digest(xml) && !input.forceFull && !meta.checkpoint) { // NEW
                try { readRevision(previous.id); return metadata(previous); } catch (_) { input = { ...input, forceFull: true }; } // NEW
            }
            const cached = recent.get(input.diagramId); // NEW
            let baseXml = null; // NEW
            if (previous && !input.forceFull && !meta.checkpoint && meta.action !== 'restore') try { baseXml = cached?.id === previous.id && cached.payloadHash === digest(previous.payload) ? cached.xml : readRevision(previous.id); } catch (_) { /* A new independent full snapshot can recover future recording. */ } // NEW
            const base = previous && baseXml ? { xml: baseXml, depth: previous.depth, deltaBytes: previous.delta_bytes, fullBytes: previous.full_bytes } : null; // CHANGE
            const encoded = encodeRevision(xml, base, input.forceFull || meta.checkpoint || meta.action === 'restore');
            const revision = { ...meta, id: meta.id || randomUUID(), diagramHistoryId: input.diagramId, timestamp: meta.timestamp || now(), parentRevisionId: meta.parentRevisionId === undefined ? previous?.id || null : meta.parentRevisionId };
            const result = insert(revision, encoded, doc.generation, previous?.id);
            db.prepare('UPDATE history_v2_documents SET latest_id=? WHERE diagram_id=?').run(result.id, input.diagramId);
            recent.set(input.diagramId, { id: result.id, xml: encoded.xml, payloadHash: digest(encoded.payload) }); // NEW
            return result;
        };
        const result = useTransaction ? transaction(work) : work();
        if (useTransaction && document(input.diagramId).generation === 'local-v2') { prune(input.diagramId); if (now() - lastCompaction > 60000) compact(); } // CHANGE: batch physical reclamation instead of vacuuming after every edit.
        return result;
    }
    function list(id) { return rows(id).map(metadata); }
    function statistics(id) {
        const aggregate = db.prepare('SELECT COUNT(*) AS revisionCount, COALESCE(SUM(payload_bytes + metadata_bytes),0) AS historyBytes FROM history_v2_revisions WHERE diagram_id=?').get(id);
        const size = filename => { try { return fs.statSync(filename).size; } catch (error) { return error.code === 'ENOENT' ? 0 : null; } }; // NEW
        return { ...aggregate, budgetBytes: budget, overBudget: aggregate.historyBytes > budget, databaseBytes: dbPath === ':memory:' ? 0 : size(dbPath), walBytes: dbPath === ':memory:' ? 0 : size(dbPath + '-wal'), reclamationPending: state('compact') === 'pending', migrationComplete: state('legacy-purge') === 'complete', generation: document(id)?.generation };
    }
    function makeFull(id) {
        const encoded = encodeRevision(readRevision(id), null, true);
        db.prepare("UPDATE history_v2_revisions SET kind='full', base_id=NULL, payload=?, payload_bytes=?, depth=0, delta_bytes=0, full_bytes=? WHERE id=?").run(encoded.payload, encoded.payload.length, encoded.fullBytes, id);
        db.prepare('INSERT OR IGNORE INTO history_v2_anchors VALUES (?,?)').run(row(id).diagram_id, id); // NEW
    }
    /** Promote retained descendants before removing dependencies; categories grant no exemption. */ // NEW
    function prune(id) {
        const candidates = rows(id).filter(item => item.status === 'ready');
        const protectedIds = new Set(candidates.slice(-100).map(item => item.id));
        const initial = db.prepare('SELECT id FROM history_v2_revisions WHERE diagram_id=? ORDER BY rowid LIMIT 1').get(id); if (initial) protectedIds.add(initial.id); // NEW: a peer's clock cannot displace the initial baseline.
        protectedIds.add(document(id).generation + '-baseline'); // NEW: the signed shared reset baseline remains independent of retained private history.
        for (const item of candidates) { const meta = metadata(item); if (meta.checkpoint || meta.action === 'restore') protectedIds.add(item.id); }
        const removed = [], anchors = [];
        transaction(() => {
            for (const candidate of candidates) {
                if (statistics(id).historyBytes <= budget) break;
                if (protectedIds.has(candidate.id)) continue;
                for (const child of db.prepare('SELECT id FROM history_v2_revisions WHERE base_id=?').all(candidate.id)) { makeFull(child.id); anchors.push(child.id); }
                db.prepare('INSERT OR IGNORE INTO history_v2_retired VALUES (?,?,?)').run(id, candidate.generation, candidate.id);
                db.prepare('DELETE FROM history_v2_revisions WHERE id=?').run(candidate.id);
                db.prepare('DELETE FROM history_v2_anchors WHERE id=?').run(candidate.id); // NEW
                removed.push(candidate.id);
            }
            if (removed.length) setState('compact', 'pending');
        });
        return { removed, anchors: [...new Set(anchors)].filter(revisionId => row(revisionId)), overBudget: statistics(id).overBudget };
    }
    /** Shared exports use a published storage base, never private narrative parents. */ // NEW
    function exportRevision(input) {
        const revision = row(input.revisionId);
        if (!revision || revision.diagram_id !== input.diagramId) throw new Error('Unknown history revision.');
        const xml = readRevision(revision.id), base = input.baseRevisionId && row(input.baseRevisionId);
        const usable = base && base.diagram_id === revision.diagram_id && base.generation === revision.generation;
        const baseState = input.baseState || (base && { depth: base.depth, deltaBytes: base.delta_bytes, fullBytes: base.full_bytes }); // NEW
        const encoded = encodeRevision(xml, usable ? { xml: readRevision(base.id), ...baseState } : null, input.forceFull || metadata(revision).checkpoint || metadata(revision).action === 'restore'); // CHANGE
        return { version: HISTORY_VERSION, generation: revision.generation, revision: metadata(revision), record: { kind: encoded.kind, baseRevisionId: encoded.kind === 'delta' ? base.id : null, hash: encoded.contentHash, payload: encoded.payload.toString('base64'), depth: encoded.depth, deltaBytes: encoded.deltaBytes, fullBytes: encoded.fullBytes } };
    }
    /** Only the signed transport may adopt a remote generation. Baseline is independently verified. */ // NEW
    function reset(input) {
        safeId(input.generation);
        const encoded = encodeRevision(input.xml, null, true);
        if (document(input.diagramId)?.generation === input.generation) return list(input.diagramId);
        const retainLocal = document(input.diagramId)?.generation === 'local-v2'; // NEW: delayed shared migration must not erase revisions recorded after the upgrade.
        transaction(() => {
            if (retainLocal) { // NEW
                db.prepare('UPDATE history_v2_revisions SET generation=? WHERE diagram_id=?').run(input.generation, input.diagramId);
                db.prepare('UPDATE history_v2_retired SET generation=? WHERE diagram_id=?').run(input.generation, input.diagramId);
            } else { // NEW
                db.prepare('DELETE FROM history_v2_revisions WHERE diagram_id=?').run(input.diagramId);
                db.prepare('DELETE FROM history_v2_anchors WHERE diagram_id=?').run(input.diagramId);
                db.prepare('DELETE FROM history_v2_retired WHERE diagram_id=?').run(input.diagramId);
            }
            db.prepare('INSERT OR REPLACE INTO history_v2_documents VALUES (?,?,NULL)').run(input.diagramId, input.generation);
            const revision = { category: 'System', action: 'baseline', title: 'Shared history reset baseline', ...input.metadata, id: input.baselineId, diagramHistoryId: input.diagramId, timestamp: input.timestamp || now(), parentRevisionId: null };
            insert(revision, encoded, input.generation);
            db.prepare('UPDATE history_v2_documents SET latest_id=? WHERE diagram_id=?').run(input.baselineId, input.diagramId);
            setState('compact', 'pending');
        });
        return list(input.diagramId);
    }
    function importRevision(entry) {
        if (entry.version !== HISTORY_VERSION || entry.generation !== document(entry.revision?.diagramHistoryId)?.generation) throw new Error('Unsupported or retired shared history generation.');
        const revision = entry.revision, data = entry.record, id = safeId(revision.id);
        if (retired(revision.diagramHistoryId, entry.generation, id)) return false;
        if (row(id)) { if (row(id).hash !== data.hash || row(id).diagram_id !== revision.diagramHistoryId) throw new Error('History revision identity collision.'); return true; }
        if (!['full', 'delta'].includes(data.kind) || !Number.isInteger(data.depth) || data.depth < 0 || data.depth > 30 || !Number.isFinite(data.deltaBytes) || data.deltaBytes < 0 || !Number.isFinite(data.fullBytes) || data.fullBytes < 1 || !Number.isFinite(revision.timestamp) || typeof data.payload !== 'string' || data.payload.length > 180 * 1024 * 1024 || data.kind === 'full' && data.depth !== 0) throw new Error('Malformed shared history record.'); // CHANGE
        const payload = Buffer.from(data.payload, 'base64');
        transaction(() => {
            insert(revision, { ...data, payload, contentHash: data.hash }, entry.generation, data.baseRevisionId, 'pending');
            if (data.kind === 'full' || row(data.baseRevisionId)) { readRevision(id); db.prepare("UPDATE history_v2_revisions SET status='ready' WHERE id=?").run(id); }
        });
        let progress = true;
        while (progress) {
            progress = false;
            for (const pending of rows(revision.diagramHistoryId).filter(item => item.status === 'pending')) {
                try { readRevision(pending.id); db.prepare("UPDATE history_v2_revisions SET status='ready' WHERE id=?").run(pending.id); progress = true; } catch (_) { /* Wait for verified predecessors; never mutate the live diagram. */ }
            }
        }
        return row(id).status === 'ready';
    }
    function applyPrune(input) {
        transaction(() => {
            let changed = false; // NEW
            for (const anchor of input.anchors || []) {
                if (anchor.generation !== document(input.diagramId)?.generation || anchor.revision.diagramHistoryId !== input.diagramId) throw new Error('History anchor belongs to another generation.'); // NEW
                if (retired(input.diagramId, anchor.generation, anchor.revision.id)) continue; // NEW: delayed pruning manifests cannot resurrect retired anchors.
                const existing = row(anchor.revision.id);
                if (!existing) { // NEW: insert inside this transaction, without nesting BEGIN statements.
                    const xml = normalizeDocument(decodePayload(Buffer.from(anchor.record.payload, 'base64')));
                    if (anchor.record.kind !== 'full' || digest(xml) !== anchor.record.hash) throw new Error('Invalid retained history anchor.');
                    insert(anchor.revision, encodeRevision(xml, null, true), anchor.generation);
                    changed = true; // NEW
                }
                else {
                    if (anchor.record.kind !== 'full' || anchor.record.hash !== existing.hash || anchor.generation !== document(input.diagramId).generation) throw new Error('Invalid retained history anchor.');
                    const xml = normalizeDocument(decodePayload(Buffer.from(anchor.record.payload, 'base64')));
                    if (digest(xml) !== existing.hash) throw new Error('History anchor checksum failed.');
                    if (existing.kind === 'full' && existing.status === 'ready') continue; // NEW: polling an applied manifest must not rewrite valid payloads.
                    const encoded = encodeRevision(xml, null, true);
                    db.prepare("UPDATE history_v2_revisions SET kind='full', base_id=NULL, payload=?, payload_bytes=?, depth=0, delta_bytes=0, full_bytes=?, status='ready' WHERE id=?").run(encoded.payload, encoded.payload.length, encoded.fullBytes, existing.id);
                    changed = true; // NEW
                }
            }
            const removed = new Set(input.removed || []); // NEW
            for (const id of removed) for (const child of db.prepare('SELECT id FROM history_v2_revisions WHERE base_id=?').all(id)) if (!removed.has(child.id)) { makeFull(child.id); changed = true; } // NEW: preserve local private branches too.
            for (const id of removed) {
                if (!row(id) && retired(input.diagramId, document(input.diagramId).generation, id)) continue; // NEW
                db.prepare('INSERT OR IGNORE INTO history_v2_retired VALUES (?,?,?)').run(input.diagramId, document(input.diagramId).generation, safeId(id));
                db.prepare('DELETE FROM history_v2_revisions WHERE id=? AND diagram_id=?').run(id, input.diagramId);
                db.prepare('DELETE FROM history_v2_anchors WHERE id=?').run(id); // NEW
                changed = true; // NEW
            }
            if (changed) setState('compact', 'pending'); // NEW: an unchanged polling pass does not fabricate pending disk reclamation.
        });
    }
    function adoptBaseline(input) { // NEW: the clean renderer explicitly adopts a verified remote content base.
        const hash = digest(normalizeDocument(input.xml)), match = rows(input.diagramId).filter(item => item.status === 'ready' && item.hash === hash).at(-1);
        if (!match) return null;
        readRevision(match.id); db.prepare('UPDATE history_v2_documents SET latest_id=? WHERE diagram_id=?').run(match.id, input.diagramId); recent.delete(input.diagramId);
        return metadata(match);
    }
    const operations = { initialize, record, baseline: adoptBaseline, latest: input => { const head = document(input.diagramId)?.latest_id; return head && row(head) ? metadata(row(head)) : null; }, list: input => list(input.diagramId), anchors: input => db.prepare('SELECT id FROM history_v2_anchors WHERE diagram_id=?').all(input.diagramId).map(item => item.id), retired: input => db.prepare('SELECT id FROM history_v2_retired WHERE diagram_id=? AND generation=?').all(input.diagramId, document(input.diagramId)?.generation).map(item => item.id), read: input => { // NEW
        if (input.diagramId && row(input.revisionId)?.diagram_id !== input.diagramId) throw new Error('Revision belongs to another diagram.');
        return { xml: readRevision(input.revisionId), revision: metadata(row(input.revisionId)) };
    }, statistics: input => {
        const result = statistics(input.diagramId), filename = contexts.get(input._owner)?.filePath;
        result.diagramBytes = null;
        if (filename) try { result.diagramBytes = fs.statSync(filename).size; } catch (_) { /* Unavailable is distinct from an empty diagram. */ }
        return result;
    }, export: exportRevision, import: input => importRevision(input.entry), reset, prune: input => prune(input.diagramId), applyPrune, compact };
    function run(method, input = {}) {
        const task = queue.then(() => { // NEW: recheck context inside the queue, after document switches.
            if (input._owner !== undefined) {
                const context = contexts.get(input._owner);
                if (!context || context.diagramId !== input.diagramId || context.token !== input.token) throw new Error('History document context changed.');
            }
            open(); if (!operations[method]) throw new Error('Unknown history operation.'); return operations[method](input);
        });
        queue = task.catch(() => {}); return task;
    }
    /** Renderer scopes are bound once per document open; transport-only mutations stay private. */ // NEW
    async function request(owner, method, input = {}) {
        if (method === 'initialize') contexts.set(owner, { diagramId: safeId(input.diagramId), token: input.token, filePath: input.filePath || null }); // NEW
        const context = contexts.get(owner);
        if (!context || context.diagramId !== input.diagramId || context.token !== input.token || !['initialize', 'record', 'list', 'latest', 'read', 'baseline', 'statistics'].includes(method)) throw new Error('History document context changed.'); // CHANGE
        if (method === 'statistics') context.filePath = input.filePath || null; // NEW: Save As changes the path, not document identity.
        return run(method, { ...input, _owner: owner }); // NEW
    }
    return { run, request, forget: owner => contexts.delete(owner), close() { closed = true; if (db) db.close(); db = null; }, _test: { get database() { open(); return db; }, readRevision } };
}
