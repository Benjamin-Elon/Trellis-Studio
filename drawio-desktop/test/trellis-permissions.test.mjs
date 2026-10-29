/** Permission semantics are exercised through both runtime cores and the real journal reducer. */ // NEW
import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import fs from 'node:fs'; // NEW
import { JSDOM } from 'jsdom'; // NEW
import { inspectDiagram } from '../src/main/trellis-share-protocol.js'; // NEW
import { permissions as C, permissionSnapshot, validatePermissionChanges } from '../src/main/trellis-permission-policy.js'; // NEW
import { replay, diffObjects } from '../src/main/trellis-collaboration-protocol.js'; // NEW
const escaped = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); // NEW
const key = id => JSON.stringify(['', id]); // NEW
const users = [{ id: 'admin', name: 'Admin', admin: true }, { id: 'owner', name: 'Owner' }, { id: 'gardener', name: 'Gardener' }, { id: 'coordinator', name: 'Coordinator' }, { id: 'visitor', name: 'Visitor' }, { id: 'other', name: 'Other' }, { id: 'disabled', name: 'Disabled', disabled: true }]; // NEW
const store = { usersEnabled: true, users, pendingUsers: [], invites: [] }; // NEW
const grant = (userId, preset) => ({ userId, preset }); // NEW
/** Real XML fixtures keep page identities and dependency calculation on the production path. */ // NEW
function fixture(options = {}) { // NEW
    const values = options.grants || [grant('gardener', 'gardener'), grant('coordinator', 'coordinator'), grant('visitor', 'visitor'), grant('disabled', 'coordinator')]; // NEW
    const cell = (id, parent, attributes = {}, style = '') => '<object id="' + id + '" ' + Object.entries(attributes).map(([name, value]) => name + '="' + escaped(String(value)) + '"').join(' ') + '><mxCell vertex="1" parent="' + parent + '" style="' + style + '"/></object>'; // NEW
    return '<mxGraphModel><root><mxCell id="0"/><object id="1" trellis_users_json="' + escaped(JSON.stringify(store)) + '"><mxCell parent="0"/></object>' + // NEW
        cell('garden', '1', { garden_module: '1', trellis_owner_user_id: 'owner', trellis_access_grants_json: JSON.stringify(values) }) + // NEW
        cell('own', 'garden', { tiler_group: '1', trellis_owner_user_id: 'gardener', label: 'Own', linkedTo: 'linked-task' }) + // NEW
        cell('foreign', 'garden', { tiler_group: '1', trellis_owner_user_id: 'other', label: 'Foreign' }) + // NEW
        cell('board', 'garden', { board_key: 'KANBAN_BOARD' }) + // NEW
        cell('own-task', 'board', { kanban_card: '1', createdByUserId: 'gardener', label: 'Own task' }) + // NEW
        cell('foreign-task', 'board', { kanban_card: '1', createdByUserId: 'other', label: 'Foreign task' }) + // NEW
        cell('linked-task', 'board', { kanban_card: '1', linkedTo: 'own', label: 'Linked task' }) + // NEW
        cell('team', '1', { trellis_team_section: '1', trellis_team_id: 'team-a', ...(options.archived ? { trellis_team_archived: '1' } : {}) }) + // NEW
        cell('role', 'team', { trellis_role_user_id: 'visitor', ...(options.inactive ? { trellis_role_inactive: '1' } : {}) }, 'role_card=1;') + '</root></mxGraphModel>'; // NEW
} // NEW
function transact(before, after, actor) { // NEW
    const delta = diffObjects(before, after), base = { schema: 3, userId: actor, sessionId: 'session', deviceId: 'device', at: 1000 }; // NEW
    const claim = { ...base, id: 'claim', kind: 'claim', targets: delta.targets, clock: 1, parents: [] }; // NEW
    const edit = { ...base, ...delta, id: 'edit', kind: 'edit', at: 1001, clock: 2, parents: ['claim'], claimIds: ['claim'] }; // NEW
    return replay(before, [claim, edit], 2000); // NEW
} // NEW

test('browser and main cores agree on action permissions for every existing user category', t => { // NEW
    const dom = new JSDOM('', { runScripts: 'outside-only' }); t.after(() => dom.window.close()); // NEW
    dom.window.eval(fs.readFileSync(new URL('../drawio/src/main/webapp/js/trellis-permission-core.js', import.meta.url), 'utf8')); // NEW
    const server = permissionSnapshot(inspectDiagram(fixture())), browser = dom.window.TrellisPermissionCore; // NEW
    const represented = browser.snapshot({ store: server.store, cells: Object.values(server.cells) }); // NEW
    for (const [actor, action, target, expected] of [ // NEW
        ['admin', 'edit', 'foreign', true], ['gardener', 'edit', 'own', true], ['gardener', 'edit', 'foreign', false], // NEW
        ['coordinator', 'edit', 'foreign', true], ['visitor', 'edit', 'foreign', false], ['disabled', 'edit', 'foreign', false], // NEW
        ['other', 'edit', 'foreign', true], ['owner', 'manageAccess', 'garden', true], ['coordinator', 'transferOwnership', 'garden', false], // NEW
        ['gardener', 'editTaskDetails', 'own-task', true], ['gardener', 'editTaskDetails', 'foreign-task', false], // NEW
        ['gardener', 'editTaskDetails', 'linked-task', true], ['gardener', 'manageAccess', 'own', false], // NEW
        ['gardener', 'createPlanting', 'garden', true], ['gardener', 'add', 'garden', false], ['owner', 'configureCircleLimits', 'garden', true] // NEW
    ]) { // NEW
        assert.equal(C.authorize(server, actor, action, key(target), 1000).allowed, expected, actor + ':' + action + ':' + target); // NEW
        assert.equal(browser.authorize(represented, actor, action, key(target), 1000).allowed, expected); // NEW
    } // NEW
}); // NEW

test('a coordination rank cannot authorize changing another user’s planting or task', () => { // NEW
    const before = fixture(), snapshot = permissionSnapshot(inspectDiagram(before)); // NEW
    assert.equal(C.authority(snapshot, 'gardener', key('foreign'), 1000), 1); // NEW
    for (const label of ['Foreign', 'Foreign task']) { // NEW
        const after = before.replace('label="' + label + '"', 'label="Unauthorized"'); // NEW
        assert.equal(validatePermissionChanges(before, after, 'gardener', 1001).allowed, false); // NEW
        const result = transact(before, after, 'gardener'); assert.deepEqual(result.accepted, []); assert.equal(result.xml, before); // NEW
        assert.equal(transact(before, after, 'coordinator').accepted.includes('edit'), true); // NEW
    } // NEW
}); // NEW

test('team membership is authoritative even when stale derived mirrors remain stored', () => { // NEW
    const grants = [{ subjectType: 'team', teamId: 'team-a', preset: 'coordinator' }, { userId: 'visitor', derived: true, sourceTeamIds: ['team-a'], preset: 'coordinator' }]; // NEW
    for (const [options, expected] of [[{}, true], [{ archived: true }, false], [{ inactive: true }, false]]) { // NEW
        const xml = fixture({ grants, ...options }), snapshot = permissionSnapshot(inspectDiagram(xml)); // NEW
        assert.equal(C.authorize(snapshot, 'visitor', 'edit', key('foreign'), 1000).allowed, expected); // NEW
        assert.equal(transact(xml, xml.replace('label="Foreign"', 'label="Team edit"'), 'visitor').accepted.includes('edit'), expected); // NEW
    } // NEW
}); // NEW

test('combined changes reject atomically and a proposal cannot grant itself authority', () => { // NEW
    const before = fixture(), mixed = before.replace('label="Own"', 'label="Allowed"').replace('label="Foreign"', 'label="Forbidden"'); // NEW
    const result = transact(before, mixed, 'gardener'); assert.deepEqual(result.accepted, []); assert.equal(result.xml, before); // NEW
    const escalation = before.replace('trellis_owner_user_id="other" label="Foreign"', 'trellis_owner_user_id="gardener" label="Escalated"'); // NEW
    assert.equal(validatePermissionChanges(before, escalation, 'gardener', 1001).allowed, false); // NEW
    const transferred = before.replace('trellis_owner_user_id="owner"', 'trellis_owner_user_id="coordinator"'); // NEW
    assert.equal(validatePermissionChanges(before, transferred, 'coordinator', 1001).allowed, false); // NEW
    assert.equal(validatePermissionChanges(before, transferred, 'owner', 1001).allowed, true); // NEW
}); // NEW

test('pure snapshots and repeated queries never mutate their inputs or use wall-clock time', () => { // NEW
    const state = permissionSnapshot(inspectDiagram(fixture())), input = { store: state.store, cells: Object.values(state.cells) }, original = JSON.stringify(input), snapshot = C.snapshot(input); // NEW
    for (let i = 0; i < 5; i++) { C.effectiveCapabilities(snapshot, 'gardener', key('own'), 1000); C.validateTransition(snapshot, snapshot, 'gardener', 1000); } // NEW
    assert.equal(JSON.stringify(input), original); assert.throws(() => { snapshot.cells[key('own')].attributes.label = 'Mutated'; }, TypeError); // NEW
    assert.equal(C.invitationStatus({ status: 'pending', expiresAt: 1000 }, 999), 'pending'); // NEW
    assert.equal(C.invitationStatus({ status: 'pending', expiresAt: 1000 }, 1000), 'expired'); // NEW
    assert.equal(C.invitationStatus({ status: 'pending', expiresAt: 1000 }, 1001), 'expired'); // NEW
}); // NEW

test('comments retain author restrictions even for administrators and combined metadata edits', () => { // NEW
    const record = { id: 'comment', authorUserId: 'other', authorName: 'Other', html: '<p>Original</p>', createdAt: 900, updatedAt: 900, resolvedAt: null, resolvedByUserId: null, resolvedByName: null, isAlert: false }; // NEW
    const before = fixture().replace('label="Own"', 'label="Own" trellis_comments_json="' + escaped(JSON.stringify({ version: 2, comments: [record] })) + '"'); // NEW
    const after = before.replace(escaped('<p>Original</p>'), escaped('<p>Rewritten</p>')); // NEW
    assert.equal(validatePermissionChanges(before, after, 'admin', 1001).allowed, false); // NEW
    const resolved = before.replace(escaped(JSON.stringify(record)), escaped(JSON.stringify({ ...record, resolvedAt: 1001, resolvedByUserId: 'admin', resolvedByName: 'Admin' }))); // NEW
    assert.equal(validatePermissionChanges(before, resolved, 'admin', 1001).allowed, true); // NEW
    assert.deepEqual(transact(before, after, 'admin').accepted, []); // NEW
}); // NEW

test('generated children require an authorized planting and cannot borrow a foreign parent', () => { // NEW
    const before = fixture(), summary = parent => before.replace('</root>', '<object id="summary" lod_summary="1" label="Summary"><mxCell parent="' + parent + '" vertex="1"/></object></root>'); // NEW
    assert.equal(validatePermissionChanges(before, summary('own'), 'gardener', 1001).allowed, true); // NEW
    assert.equal(validatePermissionChanges(before, summary('foreign'), 'gardener', 1001).allowed, false); // NEW
    const malformed = C.snapshot; assert.throws(() => malformed({ store, cells: [{ key: 'a', parent: 'b' }, { key: 'b', parent: 'a' }] }), /Cyclic/); // NEW
}); // NEW

/** Model-only attributes must not disappear from the XML authorization projection. */ // NEW
test('model attribute changes cannot bypass object permission checks', () => { // NEW
    const before = fixture(), state = inspectDiagram(before), foreign = state.cells.find(cell => cell.id === 'foreign'); // NEW
    foreign.node.getElementsByTagName('mxCell')[0].setAttribute('connectable', '0'); // NEW
    assert.equal(validatePermissionChanges(before, state.document.serialize(), 'gardener', 1001).allowed, false); // NEW
}); // NEW

test('delayed project saves retain authored comments while rejecting future timestamps and impersonation', () => { // NEW
    const before = fixture(), at = 180000, record = { id: 'delayed-comment', authorUserId: 'gardener', authorName: 'Gardener', html: '<p>Authored earlier</p>', createdAt: 1000, updatedAt: 1000, resolvedAt: null, resolvedByUserId: null, resolvedByName: null, isAlert: false }; // NEW
    const withComment = value => before.replace('label="Own"', 'label="Own" trellis_comments_json="' + escaped(JSON.stringify({ version: 2, comments: [value] })) + '"'); // NEW
    assert.equal(validatePermissionChanges(before, withComment(record), 'gardener', at).allowed, true); // NEW
    assert.equal(validatePermissionChanges(before, withComment({ ...record, createdAt: at + 1, updatedAt: at + 1 }), 'gardener', at).allowed, false); // NEW
    assert.equal(validatePermissionChanges(before, withComment({ ...record, authorUserId: 'other', authorName: 'Other' }), 'gardener', at).allowed, false); // NEW
}); // NEW

/** Access fields require the same real scopes as the renderer, even for administrators. */ // NEW
test('access fields require real scopes and the last active administrator is retained', () => { // NEW
    const before = fixture(), state = inspectDiagram(before), layer = state.cells.find(cell => cell.id === '1'); // NEW
    layer.node.setAttribute('trellis_access_open', '1'); // NEW
    assert.equal(validatePermissionChanges(before, state.document.serialize(), 'admin', 1001).allowed, false); // NEW
    assert.equal(validatePermissionChanges(before, state.document.serialize(), 'gardener', 1001).allowed, false); // NEW
    layer.node.setAttribute('trellis_access_grants_json', JSON.stringify([grant('gardener', 'coordinator')])); // NEW
    assert.equal(validatePermissionChanges(before, state.document.serialize(), 'admin', 1001).allowed, false); // NEW
    layer.node.removeAttribute('trellis_access_open'); layer.node.removeAttribute('trellis_access_grants_json'); state.cells.find(cell => cell.id === 'garden').node.setAttribute('trellis_access_open', '1'); // NEW
    assert.equal(validatePermissionChanges(before, state.document.serialize(), 'admin', 1001).allowed, true); // NEW
    const prior = permissionSnapshot(inspectDiagram(before)), disabled = C.snapshot({ store: { ...prior.store, users: prior.store.users.map(user => user.id === 'admin' ? { ...user, disabled: true } : user) }, cells: Object.values(prior.cells) }); // NEW
    assert.equal(C.validateTransition(prior, disabled, 'admin', 1001).allowed, false); // NEW
}); // NEW

/** New objects cannot introduce comments attributed to somebody else, including through admin publication. */ // NEW
test('new-object comments require the actual author and ordinary creation permission', () => { // NEW
    const before = fixture(), record = { id: 'new-comment', authorUserId: 'admin', authorName: 'Admin', html: '<p>Created</p>', createdAt: 1000, updatedAt: 1000, resolvedAt: null, resolvedByUserId: null, resolvedByName: null, isAlert: false }; // NEW
    const proposal = value => before.replace('</root>', '<object id="new-object" trellis_comments_json="' + escaped(JSON.stringify({ version: 2, comments: [value] })) + '"><mxCell parent="garden" vertex="1"/></object></root>'); // NEW
    assert.equal(validatePermissionChanges(before, proposal(record), 'admin', 1001).allowed, true); // NEW
    assert.equal(validatePermissionChanges(before, proposal({ ...record, authorUserId: 'other', authorName: 'Other' }), 'admin', 1001).allowed, false); // NEW
    assert.deepEqual(transact(before, proposal({ ...record, authorUserId: 'other', authorName: 'Other' }), 'admin').accepted, []); // NEW
}); // NEW

/** XML values may contain non-model data; it receives ordinary object authorization. */ // NEW
test('nested XML value changes cannot bypass permission checks with unchanged attributes', () => { // NEW
    const before = fixture(); // NEW
    for (const [target, allowed] of [['own', true], ['foreign', false]]) { // NEW
        const parsed = inspectDiagram(before), cell = parsed.cells.find(cell => cell.id === target), note = cell.node.ownerDocument.createElement('note'); // NEW
        note.appendChild(cell.node.ownerDocument.createTextNode('Nested value')); cell.node.appendChild(note); // NEW
        const after = parsed.document.serialize(); assert.equal(validatePermissionChanges(before, after, 'gardener', 1001).allowed, allowed); // NEW
        assert.equal(transact(before, after, 'gardener').accepted.includes('edit'), allowed); // NEW
    } // NEW
}); // NEW

/** A real layout source may update foreign presentation, never unrelated generated-child structure. */ // NEW
test('generated presentation cannot authorize hidden model or XML payload changes', () => { // NEW
    const before = fixture().replace('</root>', '<object id="foreign-circle" label="Circle"><mxCell parent="foreign" vertex="1" style="plant_tiler=1;auto=1;"/></object></root>'); // NEW
    function proposal(mode) { // NEW
        const parsed = inspectDiagram(before); parsed.cells.find(cell => cell.id === 'own').node.setAttribute('spacing_cm', '20'); // NEW
        const circle = parsed.cells.find(cell => cell.id === 'foreign-circle'); // NEW
        if (mode === 'label') circle.node.setAttribute('label', 'Recomputed'); // NEW
        if (mode === 'model') circle.node.getElementsByTagName('mxCell')[0].setAttribute('connectable', '0'); // NEW
        if (mode === 'payload') circle.node.appendChild(circle.node.ownerDocument.createElement('hidden')); // NEW
        return parsed.document.serialize(); // NEW
    } // NEW
    assert.equal(validatePermissionChanges(before, proposal('label'), 'gardener', 1001).allowed, true); // NEW
    for (const mode of ['model', 'payload']) { // NEW
        const after = proposal(mode); assert.equal(validatePermissionChanges(before, after, 'gardener', 1001).allowed, false); // NEW
        assert.deepEqual(transact(before, after, 'gardener').accepted, []); // NEW
    } // NEW
}); // NEW

/** The first save may wrap a standalone model without deleting its logical page or bypassing its prior authority. */ // NEW
test('standalone first-save wrapping preserves object authority and journal validation', () => { // NEW
    const before = fixture(), wrapped = '<mxfile><diagram id="first-page" name="Page-1">' + before.replace('label="Own"', 'label="Wrapped"') + '</diagram></mxfile>'; // NEW
    assert.equal(validatePermissionChanges(before, wrapped, 'admin', 1001).allowed, true); // NEW
    assert.equal(transact(before, wrapped, 'admin').accepted.includes('edit'), true); // NEW
    const snapshot = permissionSnapshot(inspectDiagram(before)), after = permissionSnapshot(inspectDiagram(before.replace('</root>', '<object id="new" trellis_owner_user_id="gardener" trellis_access_grants_json="' + escaped(JSON.stringify([grant('gardener', 'coordinator')])) + '"><mxCell parent="foreign" vertex="1"/></object></root>'))); // NEW
    assert.equal(C.authorizePendingCreation(snapshot, after, 'gardener', 'edit', key('new'), 1001, { policy: snapshot }).allowed, false); // NEW
    assert.equal(C.authorizePendingCreation(snapshot, snapshot, 'admin', 'edit', key('foreign'), 1001, { policy: snapshot }).allowed, false); // NEW
}); // NEW
