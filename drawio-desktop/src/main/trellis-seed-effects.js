/** Derive seed usage inside accepted collaboration saves, including field/Android imports. */ // NEW
import '../../drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Seeds_Core.js'; // NEW
import { inspectDiagram, canonical } from './trellis-share-protocol.js'; // NEW
const S = globalThis.TrellisSeedsCore; // NEW
const attr = (cell, name) => cell?.node.getAttribute(name) || ''; // NEW
const isGarden = cell => attr(cell, 'garden_module') === '1' || attr(cell, 'trellis_garden_module') === '1'; // NEW
function key(state, cell) { return JSON.stringify([state.document.pages.find(page => page.doc === cell.node.ownerDocument)?.container?.getAttribute('id') || '', cell.id]); } // NEW
function facts(state) { // NEW
    return Object.fromEntries(state.cells.map(cell => { const cellKey = key(state, cell), pageId = JSON.parse(cellKey)[0]; return [cellKey, { key: cellKey, id: cell.id, pageId, parent: cell.parentId ? JSON.stringify([pageId, cell.parentId]) : null, attributes: Object.fromEntries(Array.from(cell.node.attributes).map(attr => [attr.name, attr.value])) }]; })); // NEW
} // NEW
function inventoryPairs(beforeXml, afterXml) { // NEW
    if (!beforeXml.includes(S.ATTR) && !afterXml.includes(S.ATTR)) return null; // NEW
    const before = inspectDiagram(beforeXml), after = inspectDiagram(afterXml), index = new Map(before.cells.filter(isGarden).map(cell => [key(before, cell), cell])); // NEW
    const pairs = [], cells = facts(after); // NEW
    for (const cell of after.cells.filter(isGarden)) { // NEW
        const previousCell = index.get(key(after, cell)), oldRaw = attr(previousCell, S.ATTR), raw = attr(cell, S.ATTR); // NEW
        if (!oldRaw && !raw) continue; // NEW
        if (!raw) throw new Error('Seed accounting history cannot be removed from an existing garden.'); // NEW
        const previous = oldRaw ? S.normalize(oldRaw) : null, proposed = S.normalize(raw); // NEW
        const tasks = S.sowings(cells, key(after, cell)); // NEW
        pairs.push({ key: key(after, cell), cell, previous, proposed, tasks }); // NEW
    } // NEW
    return { before, after, pairs }; // NEW
} // NEW
/** Derived garden and task changes are diffed and held as one signed transaction. */ // NEW
export function prepareSeedTransaction(beforeXml, afterXml) { // NEW
    const transaction = inventoryPairs(beforeXml, afterXml); if (!transaction) return afterXml; // NEW
    let changed = false; // NEW
    for (const { cell, previous, proposed, tasks } of transaction.pairs) { // NEW
        const next = S.prepare(previous, proposed, tasks); // NEW
        if (canonical(next) !== canonical(proposed)) { cell.node.setAttribute(S.ATTR, JSON.stringify(next)); changed = true; } // NEW
    } // NEW
    return changed ? transaction.after.document.serialize() : afterXml; // NEW
} // NEW
/** The general content permission never authorizes forged usage effects or reservations. */ // NEW
export function validateSeedTransaction(beforeXml, afterXml) { // NEW
    const transaction = inventoryPairs(beforeXml, afterXml), automatic = new Set(); // NEW
    if (!transaction) return automatic; // NEW
    for (const { key, previous, proposed, tasks } of transaction.pairs) if (S.validate(previous, proposed, tasks)) automatic.add(key); // NEW
    return automatic; // NEW
} // NEW

/** A copied garden baselines its already completed copied tasks before any new work can occur. */ // NEW
export function initializeCopiedSeedInventories(xml) { // NEW
    if (!xml.includes(S.ATTR)) return xml; // NEW
    const state = inspectDiagram(xml), cells = facts(state); // NEW
    for (const cell of state.cells.filter(isGarden)) { // NEW
        const raw = attr(cell, S.ATTR); if (!raw) continue; // NEW
        const initialized = S.initialize({ ...S.normalize(raw), initialized: false }, S.sowings(cells, key(state, cell))); // NEW
        cell.node.setAttribute(S.ATTR, JSON.stringify(initialized)); // NEW
    } // NEW
    return state.document.serialize(); // NEW
} // NEW
