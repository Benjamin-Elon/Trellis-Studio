/** Project-local, content-addressed definitions. Publication precedes signed references; no files are collected automatically. */ // NEW
import path from 'node:path';
import fs from 'node:fs/promises'; // NEW // NEW
import { AsyncLocalStorage } from 'node:async_hooks'; // NEW
import { readBounded, LIMITS } from './trellis-input-policy.js'; // NEW
import { inspectDiagram, canonical, digest } from './trellis-share-protocol.js'; // NEW
import '../../drawio/src/main/webapp/js/trellis-reference-core.js'; // NEW
import { analyzeDocument } from './trellis-analysis-worker.js'; // NEW
const C = globalThis.TrellisReferenceCore, contexts = new AsyncLocalStorage(); // NEW
globalThis.TrellisReferenceResolver = hash => contexts.getStore()?.resolve(hash); // NEW: isolated authority context survives asynchronous operations and concurrent projects.
/** Verification has immutable public dependencies but no publication capability. */ // NEW
export function withReferenceResolver(resolve, operation) { return contexts.run({ resolve }, operation); } // NEW
/** Read-only consumers resolve within the selected project; they cannot publish or modify definitions. */ // NEW
export async function portableProjectXml(xml, folderPath) { if (!xml.includes('&quot;digest&quot;') && !xml.includes('"digest"')) return xml; return createReferenceSnapshots({ canvas: { folderPath } }).portable(xml); } // NEW
export async function projectReference(raw, folderPath) { const value = typeof raw === 'string' ? JSON.parse(raw) : raw; return C.externalReference(value) ? createReferenceSnapshots({ canvas: { folderPath } }).load(value.digest) : C.validate(value); } // NEW

/** A bounded cache retains immutable snapshots; eviction never removes durable project dependencies. */ // NEW
export function createReferenceSnapshots({ canvas, writeImmutable, budget = 32 * 1024 * 1024 }) { // NEW
    const entries = new Map(), unavailable = new Map(); let bytes = 0; // NEW
    const directory = path.join(canvas.folderPath, '.trellis', 'references'); // NEW
    function retain(hash, value, stamp) { // NEW
        const size = canonical(value).length * 2; if (size > budget) throw new Error('Reference snapshot exceeds its memory budget.'); // NEW
        if (entries.has(hash)) { entries.get(hash).stamp = stamp; return entries.get(hash).value; } // CHANGE // NEW
        while (bytes + size > budget) { const key = entries.keys().next().value; bytes -= entries.get(key).size; entries.delete(key); } // NEW
        const frozen = C.freeze(value); entries.set(hash, { value: frozen, size, stamp }); bytes += size; return frozen; // NEW
    } // NEW
    function resolve(hash) { const item = entries.get(hash); if (item) { entries.delete(hash); entries.set(hash, item); } return item?.value; } // NEW
    const fileStamp = stat => [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino].join(':'); // NEW
    async function load(hash) { // CHANGE
        if (!/^[a-f0-9]{64}$/.test(hash || '')) throw new Error('Invalid reference snapshot address.'); // CHANGE
        const filename = path.join(directory, hash + '.json'), stamp = fileStamp(await fs.stat(filename)); // NEW
        const cached = resolve(hash); if (cached && entries.get(hash).stamp === stamp) return cached; // CHANGE: cached bytes cannot conceal deleted or replaced dependencies.
        const raw = await readBounded(filename, LIMITS.diagram), value = JSON.parse(raw); // CHANGE
        if (digest(raw) !== hash || C.canonical(value) !== raw) throw new Error('Reference snapshot failed content verification.'); // CHANGE: the filename addresses the exact canonical UTF-8 file.
        if (await analyzeDocument('reference', value) !== hash || fileStamp(await fs.stat(filename)) !== stamp) throw new Error('Reference snapshot changed during verification.'); // CHANGE
        return retain(hash, value, stamp); // CHANGE
    } // CHANGE
    async function publish(value) { // CHANGE
        const hash = await analyzeDocument('reference', value), text = C.canonical(value), filename = path.join(directory, hash + '.json'); // CHANGE: one canonical reference encoding is shared with the browser.
        const stamp = await fs.stat(filename).then(fileStamp).catch(error => { if (error.code === 'ENOENT') return null; throw error; }); // NEW
        if (!entries.has(hash) || stamp !== entries.get(hash).stamp) await writeImmutable(filename, text, { canonicalText: true }); // CHANGE: repair missing files but never overwrite divergent bytes.
        retain(hash, value, fileStamp(await fs.stat(filename))); return { version: 2, digest: hash }; // CHANGE
    } // CHANGE
    /** Missing definitions disable only their gardens; changed definitions must resolve during ordinary domain validation. */ // NEW
    async function hydrate(xml) { // NEW
        unavailable.clear(); const state = inspectDiagram(xml), snapshots = {}; // NEW
        for (const cell of state.cells) { const raw = cell.node.getAttribute(C.ATTR); if (!raw) continue; const value = JSON.parse(raw); if (!C.externalReference(value)) continue; // NEW
            try { snapshots[value.digest] = await load(value.digest); } catch (error) { unavailable.set(cell.id, { digest: value.digest, reason: error.code === 'ENOENT' ? 'Reference definitions are still arriving or missing.' : error.message }); } // NEW
        } // NEW
        for (const [hash] of Object.entries(snapshots)) if (!entries.has(hash)) { delete snapshots[hash]; for (const cell of state.cells) { const raw = cell.node.getAttribute(C.ATTR); if (raw && JSON.parse(raw).digest === hash) unavailable.set(cell.id, { digest: hash, reason: 'Reference memory budget reached. Open fewer gardens before editing this garden.' }); } } // CHANGE: response objects cannot retain definitions evicted from the bounded owner cache.
        return { snapshots, unavailable: Object.fromEntries(unavailable) }; // NEW
    } // NEW
    /** All managed projects use compact pointers; standalone exports embed their definitions. */ // CHANGE
    async function compact(xml) { // NEW
        const state = inspectDiagram(xml); // NEW
        for (const cell of state.cells) { const raw = cell.node.getAttribute(C.ATTR); if (!raw) continue; let value = JSON.parse(raw); if (C.externalReference(value)) value = await load(value.digest); // NEW
            const pointer = await publish(value); cell.node.setAttribute(C.ATTR, JSON.stringify(pointer)); // NEW
            for (const kind of C.CATALOGS) { const catalog = cell.node.getAttribute(kind); if (catalog) cell.node.setAttribute(kind, JSON.stringify(C.operationalOverlay(kind, JSON.parse(catalog)))); } // NEW
        } // NEW
        return state.document.serialize(); // NEW
    } // NEW
    /** Standalone export materializes definitions and operational overlays from one captured revision. */ // NEW
    async function portable(xml) { // NEW
        const state = inspectDiagram(xml); // NEW
        for (const cell of state.cells) { const raw = cell.node.getAttribute(C.ATTR); if (!raw) continue; const pointer = JSON.parse(raw); if (!C.externalReference(pointer)) continue; const store = await load(pointer.digest); // NEW
            cell.node.setAttribute(C.ATTR, JSON.stringify(store)); // NEW
            for (const kind of C.CATALOGS) { const overlay = JSON.parse(cell.node.getAttribute(kind) || 'null'), catalog = C.mergeOperational(store, kind, overlay); if (catalog) cell.node.setAttribute(kind, JSON.stringify(catalog)); } // NEW
        } // NEW
        return state.document.serialize(); // NEW
    } // NEW
    /** Raw dependency transport is main-owned; hashing and validation occur in the requesting worker. */ // NEW
    const readForVerification = hash => { if (!/^[a-f0-9]{64}$/.test(hash || '')) throw new Error('Invalid reference snapshot address.'); return readBounded(path.join(directory, hash + '.json'), LIMITS.diagram); }; // NEW
    const api = { resolve, load, publish, hydrate, compact, portable, readForVerification, run: operation => contexts.run(api, operation), stats: () => ({ bytes, entries: entries.size, budget }) }; return api; // NEW
} // NEW
