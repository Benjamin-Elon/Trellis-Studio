/** Whole-document history codec. Storage dependencies are separate from narrative ancestry. */ // NEW
import { XMLSerializer } from '@xmldom/xmldom';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { objects } from './trellis-collaboration-protocol.js';
import { diagramDocument, parseXml, canonical, digest } from './trellis-share-protocol.js';

export const HISTORY_VERSION = 2; // NEW
const serializer = new XMLSerializer();
const transientFileAttributes = new Set(['modified', 'agent', 'etag', 'host', 'version']);
const normalizedCache = new Map(), indexCache = new Map(); // NEW: bounded working set for recording successive small edits.
function remember(cache, key, value) { if (key.length < 8 * 1024 * 1024) { cache.set(key, value); while (cache.size > 4) cache.delete(cache.keys().next().value); } return value; } // NEW

/** Normalize serialization details, preserving content, sibling order and wrapper attributes. */ // NEW
function normalizeNode(node) {
    if (node.nodeType !== 1) return node.cloneNode(true);
    const clone = node.cloneNode(false);
    for (const attribute of Array.from(clone.attributes)) clone.removeAttribute(attribute.name);
    for (const attribute of Array.from(node.attributes).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) clone.setAttribute(attribute.name, attribute.value); // NEW: code-point order is independent of locale.
    const hasElements = Array.from(node.childNodes).some(child => child.nodeType === 1);
    for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 1 || child.nodeType === 3 && (!hasElements || child.nodeValue.trim()) || child.nodeType === 4) clone.appendChild(normalizeNode(child));
    }
    return clone;
}

/** One canonical uncompressed mxfile/model is the verification boundary for every revision. */ // NEW
export function normalizeDocument(xml) {
    if (normalizedCache.has(xml)) return normalizedCache.get(xml); // NEW
    const document = diagramDocument(xml);
    for (const page of document.pages) {
        page.compressed = false;
        for (const name of ['dx', 'dy']) page.doc.documentElement.removeAttribute(name);
    }
    const outer = parseXml(document.serialize());
    if (outer.documentElement.nodeName === 'mxfile') for (const name of transientFileAttributes) outer.documentElement.removeAttribute(name);
    const result = serializer.serializeToString(normalizeNode(outer.documentElement));
    objects(result); // Validate stable page/object identities using the existing collaboration index. // NEW
    remember(normalizedCache, result, result); return remember(normalizedCache, xml, result); // NEW
}

/** Separate the document envelope, complete objects and their exact sibling order. */ // NEW
function indexDocument(xml) {
    const normalized = normalizeDocument(xml); // NEW
    if (indexCache.has(normalized)) return indexCache.get(normalized); // NEW
    const index = objects(normalized), document = diagramDocument(normalized); // NEW
    const order = {};
    for (const page of document.pages) {
        const pageId = page.container?.getAttribute('id') || '';
        const root = page.doc.getElementsByTagName('root')[0];
        order[pageId] = [...index.values()].filter(item => item.pageId === pageId).map(item => item.key);
        while (root.firstChild) root.removeChild(root.firstChild);
    }
    return remember(indexCache, normalized, { normalized, envelope: document.serialize(), order, index }); // NEW
}

export function createDocumentDelta(beforeXml, afterXml) {
    const before = indexDocument(beforeXml), after = indexDocument(afterXml);
    const changes = [];
    for (const key of new Set([...before.index.keys(), ...after.index.keys()])) {
        const a = before.index.get(key), b = after.index.get(key);
        if (a?.xml !== b?.xml) changes.push({ key, before: a ? digest(a.xml) : null, xml: b?.xml || null });
    }
    return { version: HISTORY_VERSION, baseHash: digest(before.normalized), contentHash: digest(after.normalized), envelope: before.envelope === after.envelope ? null : after.envelope, order: canonical(before.order) === canonical(after.order) ? null : after.order, changes };
}

/** Apply a persisted delta without replaying editor commands or plugin business logic. */ // NEW
export function applyDocumentDelta(beforeXml, delta) {
    if (!delta || delta.version !== HISTORY_VERSION || !Array.isArray(delta.changes)) throw new Error('Unsupported history delta.');
    const before = indexDocument(beforeXml);
    if (digest(before.normalized) !== delta.baseHash) throw new Error('History dependency does not match its expected content.');
    const index = new Map([...before.index].map(([key, item]) => [key, item.xml]));
    const seen = new Set();
    for (const change of delta.changes) {
        if (!change || typeof change.key !== 'string' || seen.has(change.key) || (index.has(change.key) ? digest(index.get(change.key)) : null) !== change.before) throw new Error('Invalid or mismatched history object.');
        seen.add(change.key);
        if (change.xml === null) index.delete(change.key);
        else if (typeof change.xml === 'string') index.set(change.key, change.xml);
        else throw new Error('Invalid history object content.');
    }
    const document = diagramDocument(delta.envelope || before.envelope), order = delta.order || before.order;
    const used = new Set();
    for (const page of document.pages) {
        const pageId = page.container?.getAttribute('id') || '', root = page.doc.getElementsByTagName('root')[0];
        if (!root || !Array.isArray(order[pageId])) throw new Error('History page ordering is missing.');
        while (root.firstChild) root.removeChild(root.firstChild);
        for (const key of order[pageId]) {
            if (!index.has(key) || used.has(key) || JSON.parse(key)[0] !== pageId) throw new Error('History object ordering is invalid.');
            used.add(key);
            root.appendChild(page.doc.importNode(parseXml(index.get(key)).documentElement, true));
        }
    }
    if (used.size !== index.size) throw new Error('History delta omits document objects.');
    const result = normalizeDocument(document.serialize());
    if (digest(result) !== delta.contentHash) throw new Error('History reconstruction failed content verification.');
    return result;
}

export const encodePayload = value => deflateRawSync(Buffer.from(typeof value === 'string' ? value : canonical(value), 'utf8')); // NEW
export const decodePayload = bytes => inflateRawSync(Buffer.from(bytes), { maxOutputLength: 128 * 1024 * 1024 }).toString('utf8'); // NEW

/** Choose bounded independent snapshots; verify every candidate delta before persisting it. */ // NEW
export function encodeRevision(xml, base = null, forceFull = false) {
    const normalized = normalizeDocument(xml), full = encodePayload(normalized), contentHash = digest(normalized);
    if (base && !forceFull && base.depth < 30) {
        try {
            const delta = createDocumentDelta(base.xml, normalized), payload = encodePayload(delta);
            if (payload.length < full.length && base.deltaBytes + payload.length < base.fullBytes && applyDocumentDelta(base.xml, delta) === normalized) return { kind: 'delta', payload, contentHash, depth: base.depth + 1, deltaBytes: base.deltaBytes + payload.length, fullBytes: base.fullBytes, xml: normalized };
        } catch (_) { /* A standalone snapshot is the safe fallback for an unrepresentable delta. */ }
    }
    return { kind: 'full', payload: full, contentHash, depth: 0, deltaBytes: 0, fullBytes: full.length, xml: normalized };
}
