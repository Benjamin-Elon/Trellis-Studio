import { readJson as readBoundedJson, readBounded, LIMITS } from './trellis-input-policy.js'; // NEW
/** Private object checkpoints and dependency-complete incoming reviews. No shared records are written here. */ // NEW
import fs from 'node:fs/promises';
import path from 'node:path';
import { XMLSerializer } from '@xmldom/xmldom';
import { applyChanges, diffObjects, objects, targetsForChange, objectContentHash, envelope } from './trellis-collaboration-protocol.js'; // CHANGE
import { canonical, digest, inspectDiagram, makeId } from './trellis-share-protocol.js';

const serialize = node => new XMLSerializer().serializeToString(node);

/** Keep the existing protocol hashes; presentation extracts human-readable fields separately. */ // NEW
export function fields(object) { // CHANGE: share sanitized review fields with private draft conflict review.
    if (!object) return {};
    const result = Object.create(null); // CHANGE
    for (const node of [object.node, object.model]) for (const attr of Array.from(node.attributes || [])) {
        if (attr.name !== 'id') result[attr.name] = attr.value; // CHANGE
    }
    if (result.trellis_users_json) { // NEW: reviews describe accounts, never password hashes or invitation secrets.
        const store = JSON.parse(result.trellis_users_json);
        result.trellis_users_json = JSON.stringify({ enabled: store.usersEnabled, users: (store.users || []).map(user => ({ name: user.name, administrator: !!user.admin, disabled: !!user.disabled })), pendingUsers: (store.pendingUsers || []).map(user => ({ name: user.name })) }, null, 2);
    }
    const geometry = object.model.getElementsByTagName('mxGeometry')[0];
    if (geometry) result.geometry = serialize(geometry);
    return result;
}

/** Group current differences using logical locks, signed transaction boundaries, and structural dependencies. */ // NEW
export function incomingGroups(viewXml, state, indexes) { // CHANGE
    const delta = diffObjects(viewXml, state.xml);
    if (!delta.changes.length) return [];
    const before = indexes?.before || objects(viewXml), after = indexes?.after || objects(state.xml); // CHANGE
    if (delta.changes[0].key === '*') return [{ id: '*', keys: [...new Set([...before.keys(), ...after.keys()])], targets: ['*'], changes: delta.changes, structural: true }];
    const pending = new Map(delta.changes.map(change => [change.key, change]));
    const nodes = new Map(delta.changes.map(change => [change.key, { parent: change.key, targets: new Set(targetsForChange(before, after, change.key)) }])); // CHANGE
    function find(key) { let cursor = key; while (nodes.get(cursor).parent !== cursor) cursor = nodes.get(cursor).parent; while (key !== cursor) { const next = nodes.get(key).parent; nodes.get(key).parent = cursor; key = next; } return cursor; } // NEW
    function join(a, b) { a = find(a); b = find(b); if (a !== b) nodes.get(b).parent = a; } // NEW
    const accepted = new Set(state.accepted || []);
    for (const record of state.records || []) if (record.kind === 'edit' && accepted.has(record.id)) {
        // Already-viewed historical transactions must not couple later independent edits forever. // NEW
        const keys = record.changes.filter(change => pending.has(change.key) && (change.hash && change.hash === after.get(change.key)?.hash || change.xml === after.get(change.key)?.xml || change.xml && objectContentHash(change.xml) === after.get(change.key)?.hash || !change.xml && !after.has(change.key))).map(change => change.key); // CHANGE
        if (!keys.length) continue;
        for (const key of keys.slice(1)) join(keys[0], key); // NEW
        for (const target of record.targets || []) nodes.get(keys[0]).targets.add(target); // NEW
    }
    const targetOwner = new Map(), groups = new Map(); // CHANGE
    for (const [key, node] of nodes) for (const target of node.targets) { // NEW: union by dependency avoids pairwise group comparisons.
        if (targetOwner.has(target)) join(key, targetOwner.get(target)); else targetOwner.set(target, key);
    }
    for (const [key, node] of nodes) { const id = find(key), group = groups.get(id) || { keys: [], targets: new Set() }; group.keys.push(key); for (const target of node.targets) group.targets.add(target); groups.set(id, group); } // NEW
    return [...groups.values()].map(group => { const keys = group.keys.sort(); return { id: digest(canonical(keys)), keys, targets: [...group.targets].sort(), changes: keys.map(key => pending.get(key)), structural: false }; }); // CHANGE
}

/** The collaboration store serializes all calls, including disk writes and cross-window acknowledgement merges. */ // NEW
export function createObjectViews({ profile, canvas, writeAtomic, now = Date.now }) {
    const sessions = new Map(), receipts = new Map(), remembered = new Map();
    const analysisCache = new WeakMap(); // NEW: unchanged polls reuse object indexes and coalesced groups.
    let sequence = 0;
    const keyFor = actor => JSON.stringify([actor.callerId, actor.userId]);
    const filename = userId => path.join(profile, 'object-views', digest(JSON.stringify([canvas.diagramId, userId])) + '.json');

    async function load(userId, initialXml) {
        if (remembered.has(userId)) return remembered.get(userId);
        let record;
        try {
            record = await readBoundedJson(filename(userId), LIMITS.record) /* CHANGE: bound received JSON before parsing. */;
            if (record.schema !== 1 || record.diagramId !== canvas.diagramId || record.userId !== userId || digest(record.xml) !== record.hash) throw new Error('The remembered object checkpoint failed verification.');
            if (!Number.isSafeInteger(record.sequence) || record.sequence < 1 || !Number.isSafeInteger(record.floor) || record.floor < 1 || record.floor > record.sequence || !record.versions || Array.isArray(record.versions) || typeof record.versions !== 'object' || Object.values(record.versions).some(value => !Number.isSafeInteger(value) || value < 1 || value > record.sequence)) throw new Error('The remembered object ordering is corrupt.'); // NEW
            objects(record.xml); sequence = Math.max(sequence, record.sequence || 0);
        } catch (error) {
            if (error.code !== 'ENOENT') throw new Error('Remembered view unavailable. Open the latest accepted objects explicitly to recover. ' + error.message);
            const known = await readBounded(filename(userId) + '.initialized', 16).then(() => true).catch(failure => { if (failure.code === 'ENOENT') return false; throw failure; }); // NEW
            if (known) throw new Error('Remembered view unavailable. Its saved objects are missing. Open the latest accepted objects explicitly to recover.'); // NEW
            record = { schema: 1, diagramId: canvas.diagramId, userId, xml: initialXml, hash: digest(initialXml), sequence: ++sequence, floor: sequence, versions: {} }; // CHANGE
            await writeAtomic(filename(userId), JSON.stringify(record));
        }
        await writeAtomic(filename(userId) + '.initialized', '1'); // NEW: distinguish first use from loss of a previously initialized object checkpoint.
        remembered.set(userId, record); return record;
    }

    async function open(actor, state, reset = false) {
        const key = keyFor(actor);
        if (reset) {
            const record = { schema: 1, diagramId: canvas.diagramId, userId: actor.userId, xml: state.xml, hash: digest(state.xml), sequence: ++sequence, floor: sequence, versions: {} }; // CHANGE
            await writeAtomic(filename(actor.userId), JSON.stringify(record)); await writeAtomic(filename(actor.userId) + '.initialized', '1'); remembered.set(actor.userId, record); // CHANGE
        }
        if (reset || !sessions.has(key)) sessions.set(key, { xml: (await load(actor.userId, state.xml)).xml });
        return sessions.get(key);
    }

    function summaries(view, state) {
        const analysis = analyze(view, state); if (analysis.summaries) return analysis.summaries; // NEW
        const { before, after, groups } = analysis, accepted = new Set(state.accepted || []); // CHANGE
        const names = new Map((inspectDiagram(state.xml).store.users || []).map(user => [user.id, user.name]));
        return analysis.summaries = groups.map(group => { // CHANGE
            const authors = [...new Set((state.records || []).filter(record => accepted.has(record.id) && record.changes?.some(change => change.key === '*' || group.keys.includes(change.key))).map(record => names.get(record.userId) || record.userId))];
            return { id: group.id, version: digest(canonical(group.changes)), keys: group.keys, targets: group.targets, structural: group.structural, authors, // CHANGE
                objects: group.keys.filter(key => before.get(key)?.hash !== after.get(key)?.hash).map(key => ({ key, parent: after.get(key)?.parent || before.get(key)?.parent || '', label: after.get(key)?.label || before.get(key)?.label || key, operation: !after.has(key) ? 'deleted' : !before.has(key) ? 'added' : 'modified' })) }; // CHANGE: new descendants can roll up to an existing visible cluster without renderer decoding.
        });
    }

    function analyze(view, state) { // NEW
        const previous = analysisCache.get(view), accepted = (state.accepted || []).join(','); // CHANGE
        if (previous?.viewXml === view.xml && previous.stateXml === state.xml && previous.accepted === accepted) return previous; // CHANGE
        const analysis = { viewXml: view.xml, stateXml: state.xml, accepted, before: objects(view.xml), after: objects(state.xml) }; // CHANGE
        analysis.groups = incomingGroups(view.xml, state, analysis); analysisCache.set(view, analysis); return analysis;
    }

    function review(view, state, ids) {
        const analysis = analyze(view, state), all = analysis.groups, groups = ids ? all.filter(group => ids.includes(group.id)) : all; // CHANGE
        const { before, after } = analysis; // CHANGE
        const token = digest(canonical(groups.map(group => ({ id: group.id, targets: group.targets, changes: group.changes }))));
        const details = groups.flatMap(group => group.keys.map(key => {
            const a = fields(before.get(key)), b = fields(after.get(key));
            return { key, fields: [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(name => a[name] !== b[name]).map(name => ({ name, before: a[name] ?? '', after: b[name] ?? '' })) }; // CHANGE
        })); // CHANGE
        if (groups.some(group => group.structural)) details.push({ key: '*', fields: [{ name: 'Pages and page settings', before: JSON.stringify(JSON.parse(envelope(view.xml)), null, 2), after: JSON.stringify(JSON.parse(envelope(state.xml)), null, 2) }] }); // NEW
        return { token, groups: summaries(view, state).filter(group => groups.some(selected => selected.id === group.id)), details };
    }

    /** Merge only acknowledged objects; a later acknowledgement cannot regress another window's newer review. */ // NEW
    async function remember(actor, baseXml, targetXml, changes, stamp) {
        const record = await load(actor.userId, baseXml);
        let xml = record.xml, versions = { ...record.versions };
        if (changes.some(change => change.key === '*')) {
            if (stamp >= Object.values(versions).reduce((highest, value) => Math.max(highest, value), record.sequence)) { xml = targetXml; versions = {}; } // CHANGE: large projects cannot exceed the JavaScript argument limit.
        } else {
            const index = objects(xml);
            const selected = changes.filter(change => stamp >= (versions[change.key] || record.floor || 0)).map(change => ({ ...change, before: index.get(change.key)?.hash || null })); // CHANGE
            xml = applyChanges(xml, selected);
            for (const change of selected) versions[change.key] = stamp;
        }
        let floor = changes.some(change => change.key === '*') && xml === targetXml ? stamp : record.floor; // CHANGE
        const pending = [...receipts.values()].filter(receipt => !receipt.committed && receipt.expires >= now() && JSON.parse(receipt.actor)[1] === actor.userId); // NEW
        const oldest = pending.reduce((value, receipt) => Math.min(value, receipt.sequence), stamp); // NEW
        floor = Math.max(floor || 0, oldest); // NEW: only outstanding acknowledgements can still need older per-object ordering.
        for (const key of Object.keys(versions)) if (versions[key] <= floor) delete versions[key]; // NEW: deletion tombstones never accumulate with the project's lifetime edits.
        const next = { ...record, xml, hash: digest(xml), sequence: Math.max(stamp, record.sequence), floor, versions }; // CHANGE
        await writeAtomic(filename(actor.userId), JSON.stringify(next)); remembered.set(actor.userId, next);
    }

    async function saved(actor, baseXml, capturedXml) {
        const view = await open(actor, { xml: baseXml });
        const changes = diffObjects(baseXml, capturedXml).changes;
        if (!changes.length) { view.xml = capturedXml; return; } // NEW: no-op autosaves do not rewrite private checkpoints.
        await remember(actor, baseXml, capturedXml, changes, ++sequence);
        view.xml = capturedXml;
    }

    async function action(actor, input, state) {
        for (const [id, receipt] of receipts) if (receipt.expires < now()) receipts.delete(id); // NEW
        const view = await open(actor, state, input.kind === 'reset-view');
        if (input.kind === 'open-view' || input.kind === 'reset-view') return { xml: view.xml, groups: summaries(view, state) };
        if (input.kind === 'changes') return { groups: summaries(view, state) };
        if (input.kind === 'review') return review(view, state, input.groups);
        if (input.kind === 'prepare-refresh') {
            const prepared = review(view, state, input.groups);
            if (prepared.token !== input.token) return { ok: false, reason: 'The available changes changed. Review them and click Refresh again.', review: prepared };
            const blocked = new Set(input.blockedTargets || []), groups = analyze(view, state).groups.filter(group => prepared.groups.some(item => item.id === group.id)); // CHANGE
            const safe = groups.filter(group => !group.targets.some(key => blocked.has(key) || blocked.has('*')) && !group.keys.some(key => blocked.has(key)));
            const changes = safe.flatMap(group => group.changes), targetXml = applyChanges(view.xml, changes);
            if (!changes.length) return { changes: [], skipped: groups.map(group => group.id) }; // NEW
            for (const [id, receipt] of receipts) if (receipt.actor === keyFor(actor)) receipts.delete(id); // NEW: bound outstanding preimages to one refresh per view.
            const predecessors = new Map(), previous = new Map(); // NEW: native insertion/reparenting retains authored sibling order.
            for (const item of objects(targetXml).values()) { const parent = JSON.stringify([item.pageId, item.parent]); predecessors.set(item.key, previous.get(parent) || ''); previous.set(parent, item.id); } // NEW
            const id = makeId();
            receipts.set(id, { actor: keyFor(actor), before: view.xml, xml: targetXml, changes, sequence: ++sequence, expires: now() + 60000 });
            return { receipt: id, changes: changes.map(change => ({ ...change, previous: predecessors.get(change.key) })), structural: changes.some(change => change.key === '*'), xml: changes.some(change => change.key === '*') ? targetXml : undefined, skipped: groups.filter(group => !safe.includes(group)).map(group => group.id) }; // CHANGE
        }
        if (input.kind === 'ack-refresh') {
            const receipt = receipts.get(input.receipt);
            if (!receipt || receipt.actor !== keyFor(actor) || receipt.expires < now() || (receipt.committed ? receipt.xml : receipt.before) !== view.xml) throw new Error('The refresh expired or this view changed. Review the changes again.'); // CHANGE
            if (receipt.committed) return { xml: view.xml, groups: summaries(view, state) }; // NEW: a lost IPC response can safely retry the durable acknowledgement.
            await remember(actor, receipt.before, receipt.xml, receipt.changes, receipt.sequence);
            view.xml = receipt.xml; receipt.committed = true; // CHANGE
            return { xml: view.xml, groups: summaries(view, state) };
        }
        throw new Error('Unsupported object view action.');
    }
    return { action, open, saved, pending: (actor, state) => analyze(sessions.get(keyFor(actor)), state).groups, get: actor => sessions.get(keyFor(actor)), forget(callerId) { for (const key of sessions.keys()) if (JSON.parse(key)[0] === callerId) sessions.delete(key); for (const [id, receipt] of receipts) if (JSON.parse(receipt.actor)[0] === callerId) receipts.delete(id); } }; // CHANGE
}
