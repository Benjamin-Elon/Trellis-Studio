/** Reference approval is independent of general administrator/editor ranks. */ // NEW
import '../../drawio/src/main/webapp/js/trellis-reference-core.js';
import { inspectDiagram, activeAccessTeams } from './trellis-share-protocol.js';
const C = globalThis.TrellisReferenceCore;
const attrs = cell => Object.fromEntries(Array.from(cell.node.attributes || []).map(item => [item.name, item.value])); // NEW
const geometry = cell => { const node = cell.node.getElementsByTagName('mxGeometry')[0]; return node ? ['x', 'y', 'width', 'height'].map(key => node.getAttribute(key)) : []; }; // NEW
function under(cell, garden) { const seen = new Set(); for (let current = cell; current && !seen.has(current); current = current.page.get(current.parentId)) { if (current === garden) return true; seen.add(current); } return false; } // NEW
function validateConsumers(before, after, garden, nextGarden, decisions, at) { // NEW
    const accepted = decisions.filter(item => item.status === 'accepted'); if (!accepted.length) return; // NEW
    const ids = accepted.flatMap(item => item.plantingIds || []), selected = new Set(ids); if (selected.size !== ids.length) throw new Error('A planting was selected more than once.'); // NEW
    const oldStore = C.validate(JSON.parse(garden.node.getAttribute(C.ATTR))), nextStore = C.validate(JSON.parse(nextGarden.node.getAttribute(C.ATTR))); // NEW
    const nextPage = after.cells.filter(item => item.node.ownerDocument === nextGarden.node.ownerDocument); // NEW
    const children = before.cells.filter(cell => cell !== garden && under(cell, garden)); // NEW
    for (const cell of children) { // NEW
        const values = attrs(cell), pin = values[C.PIN]; if (!pin || !values.plant_id) continue; // NEW
        const matches = nextPage.filter(next => next.id === cell.id); if (matches.length !== 1) throw new Error('Reference acceptance cannot remove an existing planting.'); const next = matches[0]; // NEW
        if (!selected.has(cell.id)) { // NEW
            if (!C.equal(values, attrs(next)) || !C.equal(geometry(cell), geometry(next))) throw new Error('Acceptance changed an unselected planting.'); // CHANGE
            const linkedTasks = (state, source) => state.cells.filter(item => item.node.ownerDocument === source.node.ownerDocument && String(item.node.getAttribute('linkedTo') || '').split(',').map(id => id.trim()).includes(cell.id)).map(item => [item.id, attrs(item)]).sort((a, b) => a[0].localeCompare(b[0])); // NEW
            if (!C.equal(linkedTasks(before, cell), linkedTasks(after, next))) throw new Error('Acceptance changed an unselected planting task.'); // NEW
            continue; // NEW
        } // NEW
        selected.delete(cell.id); // NEW
        const tasks = before.cells.filter(item => item.node.ownerDocument === cell.node.ownerDocument && String(item.node.getAttribute('linkedTo') || '').split(',').map(id => id.trim()).includes(cell.id)).map(attrs); // NEW
        for (const store of [oldStore, nextStore]) { const manifest = store === oldStore ? pin : store.current, city = C.rowByKey(store, manifest, 'Cities', { city_id: values.city_id || garden.node.getAttribute('city_id') }), status = C.canRecalculate(values, tasks, C.localToday(city?.timezone, new Date(at))); if (!status.ok) throw new Error('A selected planting has started or cannot be safely recalculated: ' + status.reason); } // NEW
        if (next.node.getAttribute(C.PIN) !== nextStore.current || !C.equal(geometry(cell), geometry(next))) throw new Error('Selected reference updates must pin the reviewed manifest and preserve their occupied rectangle.'); // NEW
    } // NEW
    if (selected.size) throw new Error('A selected planting is missing its prior reference pin.'); // NEW
} // NEW
export function referenceEditor(state, cell, actor) {
    const user = state.store.users?.find(user => user.id === actor && !user.disabled); if (!user) return false;
    if (user.admin) return true;
    const teams = activeAccessTeams(state, actor), seen = new Set();
    for (let current = cell; current && !seen.has(current); current = current.page.get(current.parentId)) {
        seen.add(current);
        if (current.node.getAttribute('trellis_owner_user_id') === actor) return true;
        const grants = JSON.parse(current.node.getAttribute('trellis_access_grants_json') || '[]');
        if (grants.some(grant => (grant.userId === actor || grant.subjectType === 'team' && teams.has(grant.teamId)) && grant.capabilities?.some(cap => ['create_plantings', 'manage_own_plantings', 'move_tasks', 'edit_task_details', 'manage_scope_content'].includes(cap)))) return true;
    }
    return false;
}
function states(state) {
    const result = new Map();
    for (const page of state.document.pages) for (const cell of state.cells.filter(cell => cell.node.ownerDocument === page.doc)) result.set(JSON.stringify([page.container?.getAttribute('id') || '', cell.id]), cell);
    return result;
}
function data(cell) { return { references: cell?.node.getAttribute(C.ATTR) || '', proposals: cell?.node.getAttribute(C.PROPOSALS) || '', catalogs: Object.fromEntries(C.CATALOGS.map(name => [name, cell?.node.getAttribute(name) || ''])) }; }
export function validateReferenceChanges(beforeXml, afterXml, actor, at = Date.now()) {
    if (![C.ATTR, C.PROPOSALS].some(name => beforeXml.includes(name) || afterXml.includes(name))) return; // NEW: diagrams without portable references keep the existing replay cost.
    const before = inspectDiagram(beforeXml), after = inspectDiagram(afterXml), old = states(before);
    for (const [key, cell] of states(after)) {
        const previous = old.get(key), original = data(previous), next = data(cell);
        if (original.references === next.references && original.proposals === next.proposals && C.CATALOGS.every(name => original.catalogs[name] === next.catalogs[name])) continue; // CHANGE: ordinary edits do not canonicalize large unchanged snapshots.
        if (!original.references && !next.references && !original.proposals && !next.proposals) continue;
        const owner = previous?.node.getAttribute('trellis_owner_user_id') || cell.node.getAttribute('trellis_owner_user_id');
        const user = before.store.users?.find(user => user.id === actor && !user.disabled);
        C.validateTransition(original, next, { actor, owner: !!user && owner === actor, editor: referenceEditor(before, previous || cell, actor), initializing: !previous || previous.node.getAttribute('trellis_reference_pending') === '1', gardenId: cell.id });
        if (previous && original.references && next.references) { const a = JSON.parse(original.proposals || '{"decisions":[]}'), b = JSON.parse(next.proposals || '{"decisions":[]}'); validateConsumers(before, after, previous, cell, b.decisions.filter(item => !a.decisions.some(old => old.id === item.id)), at); } // NEW
    }
}
