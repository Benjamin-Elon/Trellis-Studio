/** Durable field-package inbox/outbox; applying graph changes remains renderer-owned. // NEW */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { inspectDiagram } from './trellis-share-protocol.js'; // NEW
import '../../drawio/src/main/webapp/js/trellis-field-protocol.js';
const p = globalThis.TrellisFieldProtocol;
export function createFieldService({ identities, library }) {
    async function context(diagramId) {
        await identities.requireSession();
        const session = identities.session(), entry = await library.getEntry(diagramId);
        return { session, entry, directory: path.join(identities.metadataRoot(session.identityId), 'field', p.identifier(diagramId, 'diagram'), p.identifier(entry.workerId, 'worker')) };
    }
    async function writeRecord(directory, record) {
        await fs.mkdir(directory, { recursive: true });
        const filename = path.join(directory, record.payload.id + '.json');
        await fs.writeFile(filename, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
    }
    async function publishWork(input) {
        const validated = p.validateWork(input.work), ctx = await context(validated.diagramId), work = { ...validated, name: ctx.entry.name }; // CHANGE: use the catalog display name in worker packages.
        if (work.workerId !== ctx.entry.workerId) throw new Error('Export only this identity’s linked worker information.');
        const record = await identities.signAction('field-work', { work });
        await writeRecord(path.join(ctx.directory, 'work'), record);
        return { ok: true, packageId: work.packageId, work }; // CHANGE: manual export uses the same worker package as automatic transport.
    }
    async function pendingUpdates(input) {
        const ctx = await context(input.diagramId);
        const records = await library.verifiedRecords(ctx.session.identityId, path.join(ctx.directory, 'updates'));
        const approvedDevices = new Set((await identities.state(ctx.session.identityId)).devices.map(device => device.id)); // NEW
        const published = await fs.readdir(path.join(ctx.directory, 'work')).catch(error => { if (error.code === 'ENOENT') return []; throw error; }); // NEW: automatic refresh starts only after this worker's first field publication.
        return { ok: true, enabled: published.some(name => /^[A-Za-z0-9_-]+\.json$/.test(name)), packages: records.map(record => { // CHANGE
            if (record.payload.kind !== 'task-updates') throw new Error('Unsupported field update record.');
            const updates = p.validateUpdates(record.payload.updates);
            if (updates.diagramId !== ctx.entry.diagramId || updates.workerId !== ctx.entry.workerId) throw new Error('Field updates belong to another garden or worker.');
            return { ...updates, senderAuthorized: approvedDevices.has(record.payload.author) }; // CHANGE: removed devices cannot apply newly arriving field updates.
        }) };
    }
    /** Manual files enter the same validated inbox and are never acknowledged here. */
    async function importUpdates(input) {
        const updates = p.validateUpdates(input.updates), ctx = await context(updates.diagramId);
        if (updates.workerId !== ctx.entry.workerId) throw new Error('Updates belong to another worker.');
        await writeRecord(path.join(ctx.directory, 'updates'), await identities.signAction('task-updates', { updates }));
        return { ok: true, queued: true };
    }
    /** Verify the saved hash before publishing acknowledgments or refreshed previews. */
    async function acknowledge(input) {
        const work = p.validateWork(input.work), ctx = await context(work.diagramId);
        const listed = (await library.list()).gardens.find(entry => entry.diagramId === work.diagramId);
        if (!listed?.available || path.resolve(listed.path) !== path.resolve(input.path)) throw new Error('Acknowledgment does not match the managed garden.');
        const bytes = await fs.readFile(listed.path);
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== input.savedHash) throw new Error('Save the applied updates before acknowledging them.');
        const diagram = inspectDiagram(bytes.toString('utf8')); // NEW: a valid file hash alone does not prove operation results were persisted.
        const saved = diagram.cells.map(cell => cell.node.getAttribute('trellis_field_acknowledgments_json')).filter(Boolean).flatMap(value => JSON.parse(value)); // NEW
        if (work.acknowledgments.some(ack => !saved.some(record => record.id === ack.id && record.status === ack.status))) throw new Error('Acknowledgments are not present in the saved diagram.'); // NEW
        const objects = new Map(diagram.cells.map(cell => [cell.node.getAttribute('trellis_field_object_id'), cell.node])); // NEW
        for (const task of work.tasks) { // NEW: an applied ledger entry is insufficient if a command's actual field change was rejected.
            const fields = new Set(work.acknowledgments.filter(ack => ack.taskId === task.id && ack.status === 'applied').map(ack => ack.field)); // NEW
            if (!fields.size) continue; // NEW
            const node = objects.get(task.id); // NEW
            if (!node) throw new Error('Acknowledged task is absent from the saved diagram.'); // NEW
            const versions = JSON.parse(node.getAttribute('trellis_field_versions_json') || '{}'); // NEW
            for (const field of fields) if (p.compareVersions(versions[field], task.versions[field]) !== 0) throw new Error('Acknowledged field version is not durably saved.'); // NEW
            if (fields.has('progress') && (node.getAttribute('workflow_state') !== task.progress.state || (node.getAttribute('completed') || null) !== task.progress.completedDay)) throw new Error('Acknowledged progress is not durably saved.'); // NEW
            if (fields.has('annotation') && p.normalizeAnnotation(node.getAttribute('card_note')) !== task.annotation) throw new Error('Acknowledged annotation is not durably saved.'); // NEW
        } // NEW
        return publishWork({ work });
    }
    return { publishWork, pendingUpdates, importUpdates, acknowledge };
}
