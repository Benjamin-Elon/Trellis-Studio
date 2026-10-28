/** Private author/session checkpoints, independent of the content journal and its queue. */ // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import { digest } from './trellis-share-protocol.js'; // NEW
import { readBounded, LIMITS } from './trellis-input-policy.js'; // NEW

export function createDraftStore({ profile, canvas, writeAtomic, now = Date.now }) { // NEW
    const directory = path.join(profile, 'drafts-v3', canvas.shareId), writers = new Map(); // NEW
    const filename = (userId, sessionId) => path.join(directory, digest(JSON.stringify([userId, sessionId])) + '.json'); // NEW
    function validate(input) { // NEW
        if (typeof input.xml !== 'string' || typeof input.baseXml !== 'string' || Buffer.byteLength(input.xml) > LIMITS.diagram || Buffer.byteLength(input.baseXml) > LIMITS.diagram || !Number.isSafeInteger(input.revision) || input.revision < 0) throw new Error('Invalid private recovery checkpoint.'); // NEW
        if (!Array.isArray(input.editorDrafts || []) || (input.editorDrafts || []).some(editor => !editor || !['planting', 'year-planner'].includes(editor.kind) || !Array.isArray(editor.targets))) throw new Error('Invalid private editor recovery data.'); // NEW
        const size = Buffer.byteLength(JSON.stringify(input.editorDrafts || [])); if (size > LIMITS.diagram) throw new Error('Editor recovery data is too large.'); // NEW
    } // NEW
    function checkpoint(userId, sessionId, input) { // NEW
        validate(input); const key = JSON.stringify([userId, sessionId]); // NEW
        let writer = writers.get(key); // NEW
        if (!writer) { writer = { active: false, pending: null, waiters: [], revision: -1, sequence: 0 }; writers.set(key, writer); } // CHANGE
        if (input.revision < writer.revision) return Promise.reject(new Error('Stale recovery checkpoint.')); // NEW
        writer.revision = input.revision; // NEW
        const ticket = ++writer.sequence; // NEW: unapplied editor entries may change without a committed model revision.
        writer.pending = { ticket, record: { schema: 1, diagramId: canvas.diagramId, userId, sessionId, revision: input.revision, xml: input.xml, baseXml: input.baseXml, editorDrafts: input.editorDrafts || [], at: now() } }; // CHANGE
        const promise = new Promise((resolve, reject) => writer.waiters.push({ ticket, resolve, reject })); // CHANGE
        if (!writer.active) { // NEW
            writer.active = true; // NEW
            void (async () => { // NEW
                try { while (writer.pending) { // NEW
                    const captured = writer.pending; writer.pending = null; // NEW
                    await writeAtomic(filename(userId, sessionId), JSON.stringify(captured.record)); // CHANGE
                    const completed = writer.waiters.filter(waiter => waiter.ticket <= captured.ticket); writer.waiters = writer.waiters.filter(waiter => waiter.ticket > captured.ticket); // CHANGE
                    completed.forEach(waiter => waiter.resolve({ ok: true, revision: captured.record.revision })); // CHANGE
                } } catch (error) { writer.pending = null; writer.waiters.splice(0).forEach(waiter => waiter.reject(error)); } // NEW
                finally { writer.active = false; } // NEW
            })(); // NEW
        } // NEW
        return promise; // NEW
    } // NEW
    async function restore(userId) { // NEW
        const names = await fs.readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; }); // NEW
        if (names.length > 4096) throw new Error('Too many private recovery checkpoints.'); // NEW
        const records = []; // NEW
        for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) { // NEW
            try { const record = JSON.parse(await readBounded(path.join(directory, name), LIMITS.diagram * 4)); if (record.schema === 1 && record.diagramId === canvas.diagramId && record.userId === userId) { validate(record); records.push(record); } } // NEW
            catch (_) { /* A damaged session must not hide other valid author checkpoints. */ } // NEW
        } // NEW
        return { ok: true, drafts: records.sort((a, b) => b.at - a.at || b.revision - a.revision) }; // NEW
    } // NEW
    async function discard(userId, sessionId, revision) { // NEW
        if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid discarded checkpoint revision.'); // NEW
        const writer = writers.get(JSON.stringify([userId, sessionId])); // NEW
        if (writer?.active) await new Promise((resolve, reject) => writer.waiters.push({ ticket: writer.sequence, resolve, reject })); // CHANGE: a queued checkpoint cannot recreate a deliberately discarded draft.
        const file = filename(userId, sessionId); // NEW
        const record = await fs.readFile(file, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; }); // NEW
        if (record && record.revision <= revision) await fs.rm(file, { force: true }); // NEW
        return { ok: true }; // NEW
    } // NEW
    return { checkpoint, restore, discard }; // NEW
} // NEW
