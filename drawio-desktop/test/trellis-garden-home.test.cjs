// NEW: Splash placement and safe opening use the production home module.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const openHomes = new Set(); test.afterEach(() => { for (const dom of openHomes) dom.window.close(); openHomes.clear(); }); // NEW: window-local snapshots and DOM must not outlive test fixtures.

/** Controlled time proves that idle snapshot browsing performs no scheduled work. */ // NEW
function homeClock(f) { // NEW
    let now = 1000, next = 0; const timers = new Map(); f.window.Date.now = () => now; // NEW
    f.window.setTimeout = (action, delay = 0) => { timers.set(++next, { action, at: now + delay }); return next; }; f.window.clearTimeout = id => timers.delete(id); // NEW
    return { timers, async advance(milliseconds) { now += milliseconds; const due = [...timers].filter(([, timer]) => timer.at <= now); for (const [id, timer] of due) { timers.delete(id); timer.action(); } await tick(); } }; // NEW
} // NEW

/** Legacy interaction checks explicitly reload both project sections. */ // CHANGE
function reloadProjects(state) { state.projectLoadHeaders.shared.reload.click(); state.projectLoadHeaders.private.reload.click(); } // CHANGE

for (const count of [0, 1, 10, 11, 50, 51]) test('snapshot of ' + count + ' gardens makes no requests on idle, status, tabs or reopening', async () => { // CHANGE
    const f = fixture(), clock = homeClock(f); f.setSession({ identityId: 'alice', generation: 1, username: 'Alice' }); let calls = 0, local = 0, cities = 0; // CHANGE
    f.window.trellisGardenLibrary.list = async () => { calls++; return { gardens: Array.from({ length: count }, (_, index) => ({ diagramId: 'g' + index, name: 'Garden ' + index, classification: 'private' })) }; }; // CHANGE
    f.window.trellisGardenLibrary.listLocal = async () => { local++; return { gardens: [], folder: '/local' }; }; f.window.trellisGardenLibrary.cities = async () => { cities++; return { cities: [] }; }; // CHANGE
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome; assert.equal(calls, 1); // CHANGE
    await clock.advance(300000); await f.emitStatus({ session: await f.window.trellisIdentity.getSession() }); state.setProjectView('trash'); state.setProjectView('active'); f.ui.hideDialog(); f.window.TrellisGardenHome.showProjects(f.ui); await tick(); // CHANGE
    assert.equal(calls, 1); assert.equal(local, 1); assert.equal(cities, 1); assert.equal(clock.timers.size, 0); // CHANGE
}); // CHANGE

test('sections load independently, suppress repeat clicks, retain failed rows and timestamp, and retry explicitly', async () => { // CHANGE
    const f = fixture(), clock = homeClock(f); f.setSession({ identityId: 'alice', generation: 1, username: 'Alice' }); let releaseCommunity, releaseRequests, calls = 0, fail = false, releaseLibrary; // CHANGE
    f.window.trellisGardenLibrary.list = async () => { calls++; if (fail) throw new Error('Offline'); if (releaseLibrary === null) return new Promise(resolve => { releaseLibrary = resolve; }); return { gardens: [{ diagramId: 'g', name: 'Ready', classification: 'private' }] }; }; // CHANGE
    f.window.trellisGardenCommunities = { onStatus() {}, list: () => new Promise(resolve => { releaseCommunity = resolve; }), listRequests: () => new Promise(resolve => { releaseRequests = resolve; }) }; // CHANGE
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome, header = state.projectLoadHeaders.private, row = state.privateRows.querySelector('strong'), timestamp = header.updated.textContent; // CHANGE
    assert.equal(row.textContent, 'Ready'); assert.equal(header.status.textContent, ''); assert.match(header.updated.getAttribute('aria-label'), /Updated at/); assert.equal(state.projectLoadHeaders.communities.status.textContent, 'Loading…'); state.projectSectionToggles.communities.click(); // CHANGE
    releaseCommunity({ communities: [] }); await tick(); assert.equal(state.privateRows.querySelector('strong'), row); assert.equal(state.projectLoadHeaders.requests.status.textContent, 'Loading…'); releaseRequests({ requests: [] }); await tick(); // CHANGE
    fail = true; header.reload.click(); await tick(); assert.equal(header.updated.textContent, timestamp); assert.match(header.status.textContent, /Offline/); assert.equal(state.privateRows.querySelector('strong'), row); assert.equal(header.reload.disabled, false); // CHANGE
    fail = false; releaseLibrary = null; header.reload.click(); header.reload.click(); await clock.advance(300000); assert.equal(calls, 3); assert.equal(header.reload.disabled, true); assert.equal(state.projectLoadHeaders.shared.reload.disabled, false); // CHANGE
    releaseLibrary({ gardens: [{ diagramId: 'g', name: 'Ready', classification: 'private' }] }); await tick(); assert.equal(header.reload.disabled, false); assert.notEqual(header.updated.textContent, timestamp); assert.equal(state.privateRows.querySelector('strong'), row); // CHANGE
}); // CHANGE

test('pending initial requests survive closure and reopen without duplication or detached UI updates', async () => { // CHANGE
    const f = fixture(); f.setSession({ identityId: 'alice', generation: 1, username: 'Alice' }); let calls = 0, finish; f.window.trellisGardenLibrary.list = () => { calls++; return new Promise(resolve => { finish = resolve; }); }; // CHANGE
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const old = f.ui.__trellisGardenHome.privateRows; f.ui.hideDialog(); f.window.TrellisGardenHome.showProjects(f.ui); await tick(); assert.equal(calls, 1); f.ui.hideDialog(); finish({ gardens: [{ diagramId: 'g', name: 'Cached while closed', classification: 'private' }] }); await tick(); assert.doesNotMatch(old.textContent, /Cached while closed/); // CHANGE
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); assert.equal(calls, 1); assert.match(f.ui.__trellisGardenHome.privateRows.textContent, /Cached while closed/); // CHANGE
}); // CHANGE

test('identity snapshots survive logout and return, while obsolete generations cannot publish', async () => { // CHANGE
    const f = fixture(); let name = 'Alice garden', finish; const alice = { identityId: 'alice', generation: 1, username: 'Alice' }; f.setSession(alice); // CHANGE
    f.window.trellisGardenLibrary.list = async () => ({ gardens: [{ diagramId: 'g', name, classification: 'private' }] }); f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome; // CHANGE
    f.window.trellisGardenLibrary.list = () => new Promise(resolve => { finish = resolve; }); state.projectLoadHeaders.private.reload.click(); await tick(); f.setSession(null); await f.emitStatus({ session: null }); await tick(); assert.doesNotMatch(state.projectsRoot.textContent, /Alice garden/); // CHANGE
    finish({ gardens: [{ diagramId: 'late', name: 'Obsolete', classification: 'private' }] }); await tick(); name = 'Bob garden'; f.window.trellisGardenLibrary.list = async () => ({ gardens: [{ diagramId: 'b', name, classification: 'private' }] }); const bob = { identityId: 'bob', generation: 2, username: 'Bob' }; f.setSession(bob); await f.emitStatus({ session: bob }); await tick(); assert.match(state.privateRows.textContent, /Bob garden/); // CHANGE
    let returnedReads = 0; f.window.trellisGardenLibrary.list = async () => { returnedReads++; return { gardens: [] }; }; const returned = { ...alice, generation: 3 }; f.setSession(returned); await f.emitStatus({ session: returned }); await tick(); assert.equal(returnedReads, 0); assert.match(state.privateRows.textContent, /Alice garden/); assert.doesNotMatch(state.privateRows.textContent, /Obsolete/); // CHANGE
}); // CHANGE

test('community Reload refreshes discovery explicitly and unjoined rows omit active counts', async () => { // CHANGE
    const f = fixture(); f.setSession({ identityId: 'alice', generation: 1, username: 'Alice' }); let calls = 0, fail = true; // CHANGE
    f.window.trellisGardenCommunities = { onStatus() {}, list: async () => { calls++; if (fail) throw new Error('Discovery failed'); return { communities: [{ id: 'c', name: 'Community', gardens: [{ diagramId: 'g', name: 'Unjoined', joined: false, people: { userCount: 2, onlineCount: 1 } }] }] }; }, listRequests: async () => ({ requests: [] }) }; // CHANGE
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome; assert.match(state.projectLoadHeaders.communities.status.textContent, /Discovery failed/); f.ui.hideDialog(); f.window.TrellisGardenHome.showProjects(f.ui); await tick(); assert.equal(calls, 1); // CHANGE
    fail = false; state.projectLoadHeaders.communities.reload.click(); await tick(); assert.equal(calls, 2); assert.match(state.communitiesRows.textContent, /Unjoined/); assert.doesNotMatch(state.communitiesRows.textContent, /online/); state.projectLoadHeaders.requests.reload.click(); await tick(); assert.equal(calls, 2); // CHANGE
}); // CHANGE

test('section-only reload moves changed categories and preserves unrelated garden DOM', async () => { // CHANGE
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); let moved = false; // CHANGE
    f.window.trellisGardenLibrary.list = async () => ({ gardens: [{ diagramId: 'a', name: 'Transfer', classification: moved ? 'shared' : 'private' }, { diagramId: 'b', name: moved ? 'Incoming unrelated edit' : 'Unchanged', classification: 'shared' }] }); // CHANGE
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome, unchanged = state.sharedRows.querySelector('strong'); moved = true; state.projectLoadHeaders.private.reload.click(); await tick(); assert.doesNotMatch(state.privateRows.textContent, /Transfer/); assert.match(state.sharedRows.textContent, /Transfer/); assert.match(state.sharedRows.textContent, /Unchanged/); assert.doesNotMatch(state.sharedRows.textContent, /Incoming unrelated edit/); assert.equal([...state.sharedRows.querySelectorAll('strong')].find(node => node.textContent === 'Unchanged'), unchanged); // CHANGE
}); // CHANGE

test('separate windows own independent identity snapshots', async () => { // CHANGE
    for (const name of ['Window one', 'Window two']) { const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); f.window.trellisGardenLibrary.list = async () => ({ gardens: [{ diagramId: 'g', name, classification: 'private' }] }); f.window.TrellisGardenHome.showProjects(f.ui); await tick(); assert.match(f.ui.__trellisGardenHome.privateRows.textContent, new RegExp(name)); } // CHANGE
}); // CHANGE

test('managed projects publish before local Trash recovery and standalone scans', async () => { // CHANGE
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); let finishTrash, scans = 0; // CHANGE
    f.window.trellisGardenLibrary.list = async () => ({ gardens: [{ diagramId: 'g', name: 'Managed', classification: 'private' }] }); f.window.trellisGardenLibrary.listTrash = () => new Promise(resolve => { finishTrash = resolve; }); f.window.trellisGardenLibrary.listLocal = async () => { scans++; return { gardens: [], folder: '/local' }; }; // CHANGE
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome; assert.match(state.privateRows.textContent, /Managed/); assert.equal(scans, 0); finishTrash({ gardens: [] }); await tick(); assert.equal(scans, 1); // CHANGE
}); // CHANGE

test('community reload transfers gardens in both directions while preserving unrelated project metadata', async () => { // CHANGE
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); let grouped = false, reads = 0; // CHANGE
    f.window.trellisGardenLibrary.list = async () => { reads++; return { gardens: [{ diagramId: 'g', name: 'Transfer', classification: 'shared', available: true }, { diagramId: 'p', name: reads === 1 ? 'Unrelated snapshot' : 'Incoming unrelated edit', classification: 'private' }] }; }; // CHANGE
    f.window.trellisGardenCommunities = { onStatus() {}, list: async () => ({ communities: grouped ? [{ id: 'c', name: 'Community', gardens: [{ diagramId: 'g', name: 'Transfer', joined: true }] }] : [] }), listRequests: async () => ({ requests: [] }) }; // CHANGE
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome, untouched = state.privateRows.querySelector('strong'), timestamp = state.projectLoadHeaders.private.updated.textContent; grouped = true; state.projectLoadHeaders.communities.reload.click(); await tick(); // CHANGE
    assert.doesNotMatch(state.sharedRows.textContent, /Transfer/); assert.match(state.communitiesRows.textContent, /Transfer/); assert.equal(state.libraryProjects.filter(project => project.diagramId === 'g').length, 1); assert.equal(state.privateRows.querySelector('strong'), untouched); assert.equal(state.projectLoadHeaders.private.updated.textContent, timestamp); // CHANGE
    grouped = false; state.projectLoadHeaders.communities.reload.click(); await tick(); assert.match(state.sharedRows.textContent, /Transfer/); assert.doesNotMatch(state.communitiesRows.textContent, /Transfer/); assert.equal(state.privateRows.querySelector('strong'), untouched); // CHANGE
}); // CHANGE

test('window unload releases all snapshots and suppresses pending publication', async () => { // CHANGE
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); let finish; f.window.trellisGardenLibrary.list = () => new Promise(resolve => { finish = resolve; }); f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome; // CHANGE
    f.window.dispatchEvent(new f.window.Event('unload')); assert.equal(state.projectSnapshots.size, 0); finish({ gardens: [{ diagramId: 'g', name: 'Late', classification: 'private' }] }); await tick(); assert.doesNotMatch(state.privateRows.textContent, /Late/); // CHANGE
}); // CHANGE

test('a successful targeted edit stays immediate and survives an older pending section response', async () => { // CHANGE
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); const original = { diagramId: 'g', name: 'Before', projectName: 'Before', classification: 'private', available: true, canEditSuffix: true }, other = { diagramId: 'other', name: 'Other', classification: 'private' }; // CHANGE
    f.window.trellisGardenLibrary.list = async () => ({ gardens: [original, other] }); f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome; let finish; // CHANGE
    f.window.trellisGardenLibrary.list = input => input?.diagramId ? Promise.resolve({ gardens: [{ ...original, name: 'Edited locally', suffix: 'Me' }] }) : new Promise(resolve => { finish = resolve; }); f.window.trellisGardenLibrary.setSuffix = async () => ({ ok: true }); // CHANGE
    [...state.privateRows.querySelectorAll('button')].find(control => control.textContent === 'Edit my suffix').click(); const form = state.actionPanel; state.projectLoadHeaders.private.reload.click(); await tick(); form.querySelector('input').value = 'Me'; [...form.querySelectorAll('button')].find(control => control.textContent === 'Save suffix').click(); await tick(); // CHANGE
    assert.match(state.privateRows.textContent, /Edited locally/); assert.equal(state.projectLoadHeaders.private.status.textContent, 'Loading…'); finish({ gardens: [original, { ...other, name: 'Other incoming update' }] }); await tick(); assert.match(state.privateRows.textContent, /Edited locally/); assert.match(state.privateRows.textContent, /Other incoming update/); assert.doesNotMatch(state.privateRows.textContent, /BeforeDownloaded/); // CHANGE
}); // CHANGE

for (const section of ['shared', 'trash']) test(section + ' reload transfers a restored garden out of cached Trash', async () => { // CHANGE
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); let restored = false, targeted = 0; const garden = { diagramId: 'g', name: 'Restored', classification: 'shared', available: true }; // CHANGE
    f.window.trellisGardenLibrary.list = async input => { if (input?.diagramId) targeted++; return { gardens: restored ? [garden] : [] }; }; f.window.trellisGardenLibrary.listTrash = async () => ({ gardens: restored ? [] : [{ ...garden, source: 'library', trashId: 't' }] }); // CHANGE
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome; assert.equal(state.trashedProjects.length, 1); restored = true; state.projectLoadHeaders[section].reload.click(); await tick(); assert.equal(state.trashedProjects.length, 0); assert.match(state.sharedRows.textContent, /Restored/); assert.equal(state.libraryProjects.length, 1); assert.equal(targeted, section === 'trash' ? 1 : 0); // CHANGE
}); // CHANGE

test('Trash reload moves a known community garden out of accessible cached rows', async () => { // CHANGE
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); let trashed = false; const garden = { diagramId: 'g', name: 'Move to Trash', classification: 'shared', available: true }; // CHANGE
    f.window.trellisGardenLibrary.list = async () => ({ gardens: [garden] }); f.window.trellisGardenLibrary.listTrash = async () => ({ gardens: trashed ? [{ ...garden, source: 'library', trashId: 't' }] : [] }); f.window.trellisGardenCommunities = { onStatus() {}, list: async () => ({ communities: [{ id: 'c', name: 'Community', gardens: [{ ...garden, joined: true }] }] }), listRequests: async () => ({ requests: [] }) }; // CHANGE
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome; assert.match(state.communitiesRows.textContent, /Move to Trash/); trashed = true; state.projectLoadHeaders.trash.reload.click(); await tick(); assert.equal(state.libraryProjects.length, 0); assert.equal(state.trashedProjects.length, 1); assert.doesNotMatch(state.communitiesRows.textContent, /Move to Trash/); // CHANGE
}); // CHANGE

test('shared counters deduplicate people and radius filters preserve private projects', async () => { // NEW
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); // NEW
    const people = (keys, online, complete = true) => ({ userCount: keys.length, memberKeys: keys, onlineMemberKeys: online, onlineCount: online.length || (complete ? 0 : null), membershipComplete: true, presenceComplete: complete }); // NEW
    const gardens = [{ diagramId: 'far', name: 'Far', classification: 'shared', distanceKm: 80, people: people(['alice', 'bob'], ['alice'], false) }, { diagramId: 'near', name: 'Near', classification: 'shared', distanceKm: 25, people: people(['alice', 'carol'], ['alice', 'carol']) }, { diagramId: 'unknown', name: 'Unknown', classification: 'shared', distanceKm: null, people: people(['dave'], []) }, { diagramId: 'private', name: 'Private', classification: 'private' }]; // NEW
    f.window.trellisGardenLibrary.list = async () => ({ gardens }); f.window.trellisGardenLibrary.getReferenceCity = async () => ({ city: { cityId: 'origin', name: 'Origin', latitude: 0, longitude: 0 } }); // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome, counts = state.projectSectionCounts.shared; // NEW
    assert.match(counts.textContent, /3 projects.*at least 2 online \/ 4 users/); assert.deepEqual([...state.sharedRows.querySelectorAll('strong')].map(node => node.textContent), ['Near', 'Far', 'Unknown']); // NEW
    const radius = state.referenceHost.querySelector('input[type=number]'); radius.value = '25'; radius.dispatchEvent(new f.window.Event('input')); // NEW
    assert.match(counts.textContent, /1 of 3 projects.*2 online \/ 2 users/); assert.match(state.privateRows.textContent, /Private/); assert.match(state.distanceNotice.textContent, /1 shared garden hidden/); // CHANGE
    radius.value = '-1'; radius.dispatchEvent(new f.window.Event('input')); assert.equal(state.maxDistanceKm, 25); assert.equal(radius.getAttribute('aria-invalid'), 'true'); // NEW
    radius.value = '0'; radius.dispatchEvent(new f.window.Event('input')); assert.match(counts.textContent, /0 of 3 projects/); assert.equal(f.window.localStorage.getItem('trellis.gardenProjects.radius.v1.alice'), '0'); // NEW
    state.projectSectionToggles.shared.click(); assert.match(counts.textContent, /0 of 3 projects/); radius.value = ''; radius.dispatchEvent(new f.window.Event('input')); assert.match(counts.textContent, /3 projects/); assert.equal(state.sharedRows.hidden, true); // CHANGE
    gardens[0].people = people(['alice', 'bob'], ['alice', 'bob']); reloadProjects(state); await tick(); assert.match(counts.textContent, /3 online \/ 4 users/); assert.equal(state.sharedRows.hidden, true); // NEW
    f.window.trellisGardenLibrary.list = async () => { throw new Error('Transport unavailable'); }; reloadProjects(state); await tick(); assert.match(counts.textContent, /3 online \/ 4 users/); f.dom.window.close(); // NEW
}); // NEW

test('community membership folds remember choices and search overrides them temporarily', async () => { // NEW
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); // NEW
    f.window.trellisGardenCommunities = { onStatus() {}, list: async () => ({ communities: [{ id: 'one', name: 'Community', description: '', gardens: [{ diagramId: 'a', name: 'Joined', joined: true }, { diagramId: 'b', name: 'Orchids', joined: false }] }] }), listRequests: async () => ({ requests: [] }) }; // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); let state = f.ui.__trellisGardenHome; // NEW
    assert.deepEqual([...state.projectsRoot.querySelectorAll('.trellis-projects-title')].map(node => node.textContent), ['Garden communities', 'Shared garden projects', 'Private garden projects']); // NEW
    const find = key => state.communitiesRows.querySelector('[data-project-details="community:one' + key + '"]'); // NEW
    assert.equal(find(':joined').open, true); assert.equal(find(':not-joined').open, false); find('').querySelector('summary').click(); find(':not-joined').querySelector('summary').click(); // NEW
    f.ui.hideDialog(); f.window.TrellisGardenHome.showProjects(f.ui); await tick(); state = f.ui.__trellisGardenHome; assert.equal(find('').open, true); assert.equal(find(':not-joined').open, true); // NEW
    find(':not-joined').querySelector('summary').click(); state.searchControl.value = 'orchids'; state.searchControl.dispatchEvent(new f.window.Event('input')); assert.equal(find(':not-joined').open, true); assert.equal(find(':joined'), null); // NEW
    state.searchControl.value = ''; state.searchControl.dispatchEvent(new f.window.Event('input')); assert.equal(find(':not-joined').open, false); assert.equal(find(':joined').open, true); f.dom.window.close(); // NEW
}); // NEW

test('popover outside clicks preserve their target action and Escape restores trigger focus', async () => { // NEW
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); f.window.trellisGardenLibrary.list = async () => ({ gardens: [{ diagramId: 'a', name: 'A', shared: true }] }); // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome, menu = state.sharedRows.querySelector('.trellis-project-menu'), summary = menu.querySelector('summary'); // NEW
    summary.focus(); menu.open = true; state.searchControl.dispatchEvent(new f.window.MouseEvent('click', { bubbles: true })); assert.equal(menu.open, false); // NEW
    menu.open = true; summary.focus(); const event = new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); summary.dispatchEvent(event); assert.equal(menu.open, false); assert.equal(event.defaultPrevented, true); assert.equal(f.window.document.activeElement, summary); assert.equal(state.projectsRoot.isConnected, true); // NEW
    menu.open = true; state.projectSectionToggles.private.click(); assert.equal(menu.open, false); assert.equal(state.privateRows.hidden, true); // NEW
    assert.equal(state.accountHost.parentNode.className, 'trellis-projects-top'); assert.match(state.accountHost.textContent, /Alice/); f.dom.window.close(); // NEW
}); // NEW

test('city picker searches country and territory, selects cities, and preserves focused drafts', async () => { // NEW
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); const city = { cityId: 'langley', name: 'Langley', region: 'British Columbia', country: 'Canada', latitude: 49, longitude: -122 }; let selected = null; // NEW
    f.window.trellisGardenLibrary.cities = async () => ({ cities: [city, { ...city, cityId: 'seattle', name: 'Seattle', region: 'Washington', country: 'United States' }] }); // NEW
    f.window.trellisGardenLibrary.getReferenceCity = async () => ({ city: selected }); f.window.trellisGardenLibrary.setReferenceCity = async ({ cityId }) => { selected = cityId ? city : null; return { city: selected }; }; // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome, picker = state.referenceHost.querySelector('.trellis-city-picker'), search = picker.querySelector('input'); // NEW
    assert.equal(state.referenceHost.querySelector('input[type=number]').disabled, true); picker.open = true; search.focus(); search.value = 'British Columbia'; search.dispatchEvent(new f.window.Event('input')); // NEW
    assert.match(picker.textContent, /Canada.*British Columbia.*Langley/); assert.doesNotMatch(picker.querySelector('.trellis-city-tree').textContent, /Seattle/); // NEW
    reloadProjects(state); await tick(); assert.equal(picker.querySelector('input'), search); assert.equal(search.value, 'British Columbia'); // NEW
    [...picker.querySelectorAll('button')].find(button => button.textContent === 'Langley').click(); await tick(); assert.equal(selected.cityId, city.cityId); assert.equal(picker.open, false); assert.equal(state.referenceHost.querySelector('input[type=number]').disabled, false); // NEW
    assert.match(picker.querySelector('summary').textContent, /Langley, British Columbia, Canada/); f.dom.window.close(); // NEW
}); // NEW

test('community headings, restricted discovery, and ungrouped migration preserve private gardens and search', async () => { // NEW
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); // NEW
    f.window.trellisGardenCommunities = { onStatus() {}, list: async () => ({ communities: [{ id: 'community', name: 'Neighborhood', description: 'Grow together', canAdminister: false, gardens: [{ diagramId: 'joined', name: 'Joined garden', description: 'Known plot', joined: true }, { diagramId: 'discover', name: 'Hidden garden', description: 'Rare orchids', joined: false }], admissions: [] }] }), listRequests: async () => ({ requests: [] }) }; // NEW
    f.window.trellisGardenLibrary.list = async () => ({ gardens: [{ diagramId: 'joined', name: 'Joined garden - My role', source: 'library', available: false, shared: false }, { diagramId: 'ungrouped', name: 'Old shared garden', source: 'library', shared: true }, { diagramId: 'private', name: 'My private garden', source: 'library', shared: false }] }); // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome, root = state.projectsRoot; // NEW
    assert.match(root.textContent, /Garden communities/); assert.match(state.sharedRows.textContent, /Old shared garden/); assert.match(state.privateRows.textContent, /My private garden/); assert.doesNotMatch(state.privateRows.textContent, /Joined garden/); // NEW
    const group = state.communitiesRows.querySelector('details[data-project-details="community:community"]'); group.open = true; assert.match(group.textContent, /Rare orchids/); // NEW
    assert.equal([...group.querySelectorAll('button')].filter(b => b.textContent === 'Request access').length, 1); // NEW
    const search = root.querySelector('input[aria-label="Search garden projects"]'); search.value = 'orchids'; search.dispatchEvent(new f.window.Event('input')); assert.match(state.communitiesRows.textContent, /Neighborhood/); assert.match(state.communitiesRows.textContent, /Hidden garden/); assert.doesNotMatch(state.communitiesRows.textContent, /Joined garden/); // NEW
    assert.equal(state.communitiesRows.querySelector('details[data-project-details="community:community"]').open, true); // NEW
}); // NEW

test('request forms retain typed notes during refresh and report server errors without losing input', async () => { // NEW
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); let changed, received; // NEW
    f.window.trellisGardenCommunities = { onStatus(listener) { changed = listener; }, list: async () => ({ communities: [{ id: 'community', name: 'Community', description: '', gardens: [{ diagramId: 'garden', name: 'Garden', description: '', joined: false }], admissions: [] }] }), listRequests: async () => ({ requests: [] }), requestAccess: async payload => { received = payload; throw new Error('Garden membership changed.'); } }; // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome; [...state.communitiesRows.querySelectorAll('button')].find(b => b.textContent === 'Request access').click(); // NEW
    const panel = state.actionPanel, note = panel.querySelector('input[aria-label="Optional note"]'); note.value = 'Let me help'; note.focus(); changed?.(); await tick(); assert.equal(state.actionPanel, panel); assert.equal(f.window.document.activeElement, note); assert.equal(note.value, 'Let me help'); // NEW
    panel.querySelector('form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true })); await tick(); assert.equal(received.note, 'Let me help'); assert.match(panel.textContent, /Garden membership changed/); assert.equal(note.value, 'Let me help'); assert.equal(panel.querySelector('button[type="submit"]').disabled, false); // NEW
}); // NEW

test('personal access requests remain visible when no community membership remains', async () => { // NEW
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); // NEW
    f.window.trellisGardenCommunities = { onStatus() {}, list: async () => ({ communities: [] }), listRequests: async () => ({ requests: [{ id: 'request', gardenName: 'Another garden', requesterName: 'Alice', requesterIdentityId: 'alice', note: 'Still waiting', status: 'queued', scopes: [], canDecide: false }] }) }; // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome; assert.match(state.communityRequestRows.textContent, /Another garden/); assert.match(state.communityRequestRows.textContent, /Still waiting/); assert.match(state.communityRequestRows.textContent, /queued/); // NEW
}); // NEW
test('Join on Home opens the browser guide; signed-out preview preserves native paste defaults and asks for identity', async () => { // NEW
    const f = fixture(); let started = 0; f.window.trellisGardenJoin = { preview: async () => ({ label: 'Invited garden', email: 'member@example.org', expiresAt: Date.now() + 86400000 }), list: async () => ({ requests: [] }), start: async () => { started++; } }; // NEW
    const splash = { container: f.window.document.getElementById('splash'), isTrellisLicenseWizardComplete: () => true }; f.window.TrellisGardenHome.attachSplash(splash, f.ui); await tick(); f.window.TrellisGardenHome.attachSplash(splash, f.ui); // NEW
    assert.equal(splash.container.querySelectorAll('[data-join-project]').length, 1); splash.container.querySelector('[data-join-project]').click(); await tick(); // NEW
    const guide = f.ui.__trellisGardenHome.projectsRoot.querySelector('.trellis-join-guide'), text = guide.querySelector('textarea'); text.value = 'Whole invitation email'; text.dispatchEvent(new f.window.Event('input')); // NEW
    const key = new f.window.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true }); text.dispatchEvent(key); assert.equal(key.defaultPrevented, false); // NEW
    [...guide.querySelectorAll('button')].find(b => b.textContent === 'Continue').click(); await tick(); assert.match(guide.textContent, /Invited garden/); assert.match(guide.textContent, /Log in, create an identity/); assert.equal([...guide.querySelectorAll('button')].find(b => b.textContent === 'Join project').disabled, true); assert.equal(started, 0); // NEW
}); // NEW

test('pending invitations survive guide closure, ignore project filters and update to ready without navigating', async () => { // NEW
    const f = fixture(); f.setSession({ identityId: 'alice', generation: 1, username: 'Alice' }); let phase = 'waiting', finishStart, starts = 0; // NEW
    const request = () => ({ id: 'request', label: 'Invited garden', email: 'member@example.org', expiresAt: Date.now() + 86400000, state: phase, reply: 'approval reply', path: '/joined.drawio' }); // NEW
    f.window.trellisGardenJoin = { list: async () => ({ requests: starts ? [request()] : [] }), preview: async () => request(), start: () => { starts++; return new Promise(resolve => { finishStart = () => resolve(request()); }); }, resume: async () => request() }; // NEW
    f.window.TrellisGardenHome.showProjects(f.ui, { focus: 'join' }); await tick(); let state = f.ui.__trellisGardenHome, guide = state.projectsRoot.querySelector('.trellis-join-guide'), text = guide.querySelector('textarea'); // NEW
    text.value = 'Invitation'; text.dispatchEvent(new f.window.Event('input')); [...guide.querySelectorAll('button')].find(b => b.textContent === 'Continue').click(); await tick(); const join = [...guide.querySelectorAll('button')].find(b => b.textContent === 'Join project'); join.click(); join.click(); assert.equal(starts, 1); // NEW
    f.ui.hideDialog(); finishStart(); await tick(); f.window.TrellisGardenHome.showProjects(f.ui); await tick(); state = f.ui.__trellisGardenHome; guide = state.projectsRoot.querySelector('.trellis-join-guide'); assert.match(guide.textContent, /Pending invitations.*Invited garden.*Waiting for approval/); // NEW
    state.searchControl.value = 'Nothing matches'; state.searchControl.dispatchEvent(new f.window.Event('input')); assert.match(guide.textContent, /Invited garden/); [...guide.querySelectorAll('button')].find(b => b.textContent === 'Resume invitation').click(); await tick(); // NEW
    assert.equal(guide.querySelector('textarea[readonly]').value, 'approval reply'); phase = 'ready'; await f.emitStatus({ session: { identityId: 'alice', generation: 1, username: 'Alice' } }); await tick(); // NEW
    assert.match(guide.textContent, /Ready to open/); assert.ok([...guide.querySelectorAll('button')].find(b => b.textContent === 'Open project')); assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === 'loaded'), false); // NEW
}); // NEW

test('Open project completes under the watched file, retries PIN proof without reloading and saves before library registration', async () => { // NEW
    const f = fixture(); f.setSession({ identityId: 'alice', generation: 1, username: 'Alice' }); const order = []; let reads = 0; // NEW
    const request = { id: 'request', label: 'Garden', email: 'member@example.org', displayName: 'Member', state: 'ready', path: '/joined.drawio' }; // NEW
    f.window.trellisGardenJoin = { list: async () => ({ requests: [request] }), resume: async () => request, prepare: async () => { order.push('prepare'); assert.equal(f.ui.getCurrentFile().fileObject.path, request.path); return { ...request, identityId: 'alice', userId: 'member' }; }, complete: async () => { order.push('register'); return { state: 'complete' }; } }; // NEW
    f.window.Trellis = { users: { async finishIdentityJoin(input) { if (!input.pin) return { ok: false, needsPin: true, reason: 'Enter your existing project PIN' }; assert.equal(input.pin, '5678'); order.push('authenticate'); return { ok: true }; } }, sharing: { async refresh() { order.push('refresh'); } } }; // NEW
    f.window.LocalFile.prototype.save = function(_revision, success) { order.push('save'); success(); }; // NEW
    f.ui.readGraphFile = success => { reads++; success({ path: request.path }, '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>', {}, 'Joined.drawio'); }; // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); let guide = f.ui.__trellisGardenHome.projectsRoot.querySelector('.trellis-join-guide'); [...guide.querySelectorAll('button')].find(b => b.textContent === 'Resume invitation').click(); await tick(); [...guide.querySelectorAll('button')].find(b => b.textContent === 'Open project').click(); await tick(); await tick(); // NEW
    guide = f.ui.__trellisGardenHome.projectsRoot.querySelector('.trellis-join-guide'); const pin = guide.querySelector('input[type=password]'); assert.ok(pin); pin.value = '5678'; [...guide.querySelectorAll('button')].find(b => b.textContent === 'Retry finishing join').click(); await tick(); await tick(); // NEW
    assert.deepEqual(order, ['prepare', 'prepare', 'authenticate', 'refresh', 'save', 'register']); assert.equal(reads, 1); assert.equal(pin.value, ''); assert.equal(f.ui.dialog, null); // NEW
}); // NEW

test('identity switching clears invitation drafts and ignores late preview and request results', async () => { // NEW
    const f = fixture(); f.setSession({ identityId: 'alice', generation: 1, username: 'Alice' }); let resolvePreview; f.window.trellisGardenJoin = { list: async () => ({ requests: [] }), preview: () => new Promise(resolve => { resolvePreview = resolve; }) }; // NEW
    f.window.TrellisGardenHome.showProjects(f.ui, { focus: 'join' }); await tick(); const guide = f.ui.__trellisGardenHome.projectsRoot.querySelector('.trellis-join-guide'), text = guide.querySelector('textarea'); text.value = 'Private email'; text.dispatchEvent(new f.window.Event('input')); [...guide.querySelectorAll('button')].find(b => b.textContent === 'Continue').click(); // NEW
    const bob = { identityId: 'bob', generation: 2, username: 'Bob' }; f.setSession(bob); await f.emitStatus({ session: bob }); resolvePreview({ label: 'Late private project' }); await tick(); assert.equal(text.value, ''); assert.doesNotMatch(guide.textContent, /Late private project/); // NEW
}); // NEW

function fixture({ sharedButtons = true } = {}) { // CHANGE
    const dom = new JSDOM('<body><div id="splash" class="trellis-splash-root"><div class="trellis-splash-center"><div class="trellis-license-contact-panel">License</div></div><div class="trellis-splash-actions"><button>Create New Garden</button><button>Open Existing Garden</button><button>Explore and Support Trellis</button></div></div></body>', { runScripts: 'outside-only', url: 'https://trellis.test/' }); // CHANGE: match the base splash labels before desktop integration attaches.
    openHomes.add(dom); const window = dom.window, calls = [], actions = new Map(); // CHANGE
    let current = null, session = null, statusListener; // CHANGE: exercise actual background session invalidation.
    window.trellisIdentity = { list: async () => ({ identities: [], session }), getSession: async () => session, onStatus(listener) { statusListener = listener; }, onLocked() {} }; // CHANGE
    window.trellisGardenLibrary = { list: async () => ({ gardens: [] }), listLocal: async () => ({ gardens: [], folder: '/local' }), cities: async () => ({ cities: [] }), getReferenceCity: async () => ({ city: null }) }; // CHANGE
    window.mxResources = { get: key => key };
    window.mxUtils = { parseXml: text => new window.DOMParser().parseFromString(text, 'text/xml') };
    window.LocalFile = class { constructor(ui, data, name) { this.data = data; this.name = name; } setModified(value) { this.modified = value; } };
    const ui = { pickFile() { calls.push('local-picker'); }, actions: { get: id => actions.get(id), addAction(id, funct) { const action = { funct }; actions.set(id, action); return action; } }, menus: { get: () => null }, getCurrentFile: () => current, showSplash() {}, hideDialog() { calls.push('hide'); }, fileLoaded(file) { calls.push(['loaded', file]); current = file; }, confirm(_text, cancel, ok) { ok(); }, readGraphFile(success, error, filename) { error(new Error('Missing ' + filename)); }, handleError() {} };
    const splash = dom.window.document.getElementById('splash'); // NEW
    ui.showSplash = () => dom.window.document.body.append(splash); // NEW
    ui.dialogs = []; // CHANGE: exercise the same stacked ownership and close veto as EditorUi.
    ui.showDialog = (panel, width, height, _modal, closable, onClose, _noScroll, _transparent, _minSize, ignoreBgClick) => { // CHANGE
        const container = window.document.createElement('div'), bg = window.document.createElement('div'); container.className = 'geDialog'; bg.className = 'geBackground'; container.append(panel); // CHANGE
        if (closable) { const close = window.document.createElement('div'); close.className = 'geButton'; close.title = 'close'; close.addEventListener('click', () => ui.hideDialog(true)); container.append(close); } // CHANGE
        if (!ignoreBgClick) bg.addEventListener('click', () => ui.hideDialog(true)); // CHANGE
        window.document.body.append(bg, container); ui.dialog = { container, bg, onClose, width, height, ignoreBgClick }; ui.dialogs.push(ui.dialog); // CHANGE
    }; // CHANGE
    ui.hideDialog = (cancel, isEsc, matchContainer) => { // CHANGE
        calls.push('hide'); const dialog = ui.dialog; // CHANGE
        if (!dialog) { splash.remove(); return; } // CHANGE
        if (matchContainer && matchContainer !== dialog.container.firstChild || dialog.onClose?.(cancel, isEsc) === false) return; // CHANGE
        dialog.container.remove(); dialog.bg.remove(); ui.dialogs.splice(ui.dialogs.indexOf(dialog), 1); ui.dialog = ui.dialogs.at(-1) || null; // CHANGE
    }; // CHANGE
    if (sharedButtons) { window.Draw = { loadPlugin() {} }; window.eval(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_UI_Cleanup.js'), 'utf8')); } // CHANGE: use production style tokens rather than a test imitation.
    actions.set('new', { funct: () => calls.push('new') }); // NEW
    window.eval(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-garden-home.js'), 'utf8'));
    return { dom, window, ui, calls, setCurrent: value => { current = value; }, setSession: value => { session = value; }, emitStatus: value => statusListener(value) }; // CHANGE
}
/** Observe navigation ordering while retaining the real Home installation and file save contract. */ // NEW
function homeFixture(modified = false) { // NEW
    const f = fixture(), events = [], errors = []; let dirty = modified; // NEW
    f.window.document.getElementById('splash').remove(); // NEW
    const file = { isModified: () => dirty, save(_revision, success) { events.push('save'); dirty = false; success(); } }; // NEW
    const graph = { isEditing: () => false, stopEditing() { events.push('edit'); }, __trellisReferences: { async flushDrafts() { events.push('references'); } } }; // NEW
    f.setCurrent(file); f.ui.editor = { graph }; f.ui.handleError = error => errors.push(error); // NEW
    f.ui.showSplash = () => events.push('splash'); // NEW
    f.ui.fileLoaded = async (next, noDialogs) => { events.push(['close', next, noDialogs]); f.setCurrent(next); }; // NEW
    const state = f.window.TrellisGardenHome.install(f.ui); // NEW
    return { ...f, file, graph, state, events, errors, dirty: value => { dirty = value; } }; // NEW
} // NEW
test('Home closes clean and untouched blank documents without saving and flushes references first', async () => { // NEW
    const f = homeFixture(); await f.ui.showSplash(true); // NEW
    assert.deepEqual(f.events, ['references', ['close', null, true], 'splash']); assert.equal(f.ui.getCurrentFile(), null); assert.equal(f.state.homeTransition, null); assert.equal(f.state.savedFile, null); // CHANGE
    f.dom.window.close(); // NEW
}); // NEW
test('Home commits active editing and saves the entire modified document before closing', async () => { // NEW
    const f = homeFixture(), pages = ['page one', 'page two']; let editing = true; // NEW
    f.graph.isEditing = () => editing; f.graph.stopEditing = () => { editing = false; f.dirty(true); f.events.push('edit'); }; // NEW
    f.file.save = (_revision, success) => { f.events.push(['save', ...pages]); f.dirty(false); success(); }; // NEW
    await f.ui.showSplash(true); // NEW
    assert.deepEqual(f.events, ['edit', 'references', ['save', ...pages], ['close', null, true], 'splash']); assert.deepEqual(f.errors, []); // NEW
    f.dom.window.close(); // NEW
}); // NEW
test('canceled and failed Home saves keep the document and allow a later retry', async () => { // NEW
    for (const canceled of [true, false]) { // NEW
        const f = homeFixture(true); f.file.draft = 'recovery'; // NEW
        f.file.save = (_revision, _success, error, _unloading, _overwrite, cancel) => canceled ? cancel() : error(new Error('Permission denied')); // NEW
        await f.ui.showSplash(true); // NEW
        assert.equal(f.ui.getCurrentFile(), f.file); assert.equal(f.file.draft, 'recovery'); assert.equal(f.file.isModified(), true); assert.equal(f.state.homeTransition, null); // NEW
        assert.equal(f.errors.length, canceled ? 0 : 1); assert.equal(f.events.includes('splash'), false); // NEW
        f.file.save = (_revision, success) => { f.dirty(false); success(); }; await f.ui.showSplash(true); // NEW
        assert.equal(f.ui.getCurrentFile(), null); assert.equal(f.events.filter(event => event === 'splash').length, 1); f.dom.window.close(); // NEW
    } // NEW
}); // NEW
test('Home requests share one save and late callbacks cannot close a replacement or changed document', async () => { // NEW
    for (const change of ['none', 'replacement', 'edit']) { // NEW
        const f = homeFixture(true); let saved, saves = 0; // NEW
        f.file.save = (_revision, success) => { saves++; saved = success; }; // NEW
        const first = f.ui.showSplash(true), second = f.ui.showSplash(true); assert.equal(first, second); await tick(); assert.equal(saves, 1); // NEW
        f.dirty(false); const replacement = { isModified: () => false }; // NEW
        if (change === 'replacement') f.setCurrent(replacement); // NEW
        if (change === 'edit') { f.graph.isEditing = () => true; f.graph.stopEditing = () => f.dirty(true); } // NEW
        saved(); await first; // NEW
        assert.equal(f.ui.getCurrentFile(), change === 'none' ? null : change === 'replacement' ? replacement : f.file); // NEW
        assert.equal(f.events.filter(event => event === 'splash').length, change === 'none' ? 1 : 0); assert.equal(f.errors.length, change === 'edit' ? 1 : 0); f.dom.window.close(); // NEW
    } // NEW
}); // NEW
test('Home refuses in-flight saves, renames, retirement, and closing without touching the document', async () => { // NEW
    for (const busy of ['savingFile', '__trellisCollaborativeSaving', '__trellisNamingMove', 'retirement', 'closing']) { // NEW
        const f = homeFixture(true); // NEW
        if (busy === 'retirement') f.state.retirement = {}; else if (busy === 'closing') f.window.__trellisClosing = true; else f.file[busy] = true; // NEW
        await f.ui.showSplash(true); assert.equal(f.ui.getCurrentFile(), f.file); assert.deepEqual(f.events, []); assert.match(f.errors[0].message, /finish/); assert.equal(f.state.homeTransition, null); f.dom.window.close(); // NEW
    } // NEW
}); // NEW
test('reference persistence failures abort Home before saving or closing', async () => { // NEW
    const f = homeFixture(true); f.graph.__trellisReferences.flushDrafts = async () => { throw new Error('Reference storage unavailable'); }; // NEW
    await f.ui.showSplash(true); assert.equal(f.ui.getCurrentFile(), f.file); assert.deepEqual(f.events, []); assert.match(f.errors[0].message, /Reference/); f.dom.window.close(); // NEW
}); // NEW
test('Home operates only on its own window and does not replace an existing splash', async () => { // NEW
    const first = homeFixture(true), second = homeFixture(true); await first.ui.showSplash(true); // NEW
    assert.equal(second.ui.getCurrentFile(), second.file); assert.deepEqual(second.events, []); // NEW
    const panel = first.window.document.createElement('div'); panel.className = 'trellis-splash-root'; first.ui.showDialog(panel, 700, 630, true, false); // NEW
    await first.ui.showSplash(true); assert.equal(first.events.filter(event => event === 'splash').length, 1); first.dom.window.close(); second.dom.window.close(); // NEW
}); // NEW
test('personal suffix controls preserve the shared prefix and expose server validation errors', async () => { // NEW
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); // NEW
    const project = { diagramId: 'garden', source: 'library', projectName: 'Community Garden', suffix: '', name: 'Community Garden', available: false, canRename: false, canEditSuffix: true }; // NEW
    f.window.trellisGardenLibrary.list = async () => ({ gardens: [project] }); // NEW
    const received = []; f.window.trellisGardenLibrary.setSuffix = async value => { received.push(value); throw new Error('Use at most 80 characters.'); }; // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); // NEW
    const root = f.ui.__trellisGardenHome.projectsRoot; assert.equal([...root.querySelectorAll('button')].some(control => control.textContent === 'Rename'), false); // NEW
    [...root.querySelectorAll('button')].find(control => control.textContent === 'Edit my suffix').click(); // NEW
    const panel = root.querySelector('.trellis-project-action'), control = panel.querySelector('input'); assert.match(panel.textContent, /Project: Community Garden/); // NEW
    control.value = 'Volunteer'; control.dispatchEvent(new f.window.Event('input')); assert.match(panel.textContent, /Community Garden - Volunteer.drawio/); // NEW
    [...panel.querySelectorAll('button')].find(control => control.textContent === 'Save suffix').click(); await tick(); // NEW
    assert.equal(received[0].suffix, 'Volunteer'); assert.match(panel.textContent, /at most 80/); assert.equal(control.value, 'Volunteer'); // NEW
}); // NEW
test('two open editors update handles without replacing their unsaved documents and cancel safely while saving', async () => { // NEW
    const frames = [fixture(), fixture()]; // NEW
    for (const f of frames) { // NEW
        const file = { fileObject: { path: '/garden/Old.drawio', name: 'Old.drawio', draftFileName: '/garden/old.draft' }, isModified: () => true, data: 'unsaved data', descriptorChanged() {} }; f.setCurrent(file); // NEW
        let receive; f.window.trellisGardenLibrary.onNaming = callback => { receive = callback; }; f.window.electron = { request(_input, success) { success({ mtimeMs: 42 }); } }; // NEW
        let watched; f.ui.watchFile = async current => { watched = current.fileObject.path; }; f.window.TrellisGardenHome.install(f.ui); // NEW
        const message = { oldPath: '/garden/Old.drawio', path: '/garden/New - Role.drawio', filename: 'New - Role.drawio', displayName: 'New - Role', diagramId: 'garden' }; // NEW
        file.savingFile = true; await assert.rejects(receive({ ...message, phase: 'prepare' }), /finish saving/); file.savingFile = false; // NEW
        await receive({ ...message, phase: 'prepare' }); assert.ok(file.__trellisNamingMove); // NEW
        await receive({ ...message, phase: 'commit', drafts: [['/garden/old.draft', '/garden/new.draft']] }); // NEW
        assert.equal(file.fileObject.path, message.path); assert.equal(file.fileObject.draftFileName, '/garden/new.draft'); assert.equal(watched, message.path); assert.equal(file.stat.mtimeMs, 42); // NEW
        assert.equal(file.data, 'unsaved data'); assert.equal(file.isModified(), true); assert.equal(file.__trellisNamingMove, null); assert.equal(f.ui.getCurrentFile(), file); // NEW
        await receive({ ...message, oldPath: message.path, phase: 'prepare' }); const waiting = file.__trellisNamingMove; await receive({ ...message, phase: 'cancel' }); await waiting; // NEW
        file.fileObject.path = message.oldPath; const retry = { ...message, oldPath: message.path, previousPaths: [message.oldPath] }; // NEW
        f.ui.editor = { graph: { getModel: () => ({ getCell: () => ({ value: { getAttribute: () => 'another-project' } }) }) } }; // NEW
        await assert.rejects(receive({ ...retry, phase: 'prepare' }), /open project changed/); // NEW
        f.ui.editor.graph.getModel = () => ({ getCell: () => ({ value: { getAttribute: () => message.diagramId } }) }); // NEW
        await receive({ ...retry, phase: 'prepare' }); await receive({ ...retry, phase: 'commit' }); assert.equal(file.fileObject.path, message.path); assert.equal(file.data, 'unsaved data'); // NEW
    } // NEW
}); // NEW
test('splash combines library actions after licensing and attaches exactly three actions once', async () => { // CHANGE
    const f = fixture(), container = f.window.document.getElementById('splash'); // CHANGE
    f.window.trellisGardenJoin = { list: async () => ({ requests: [] }) }; // CHANGE
    f.window.TrellisGardenHome.attachSplash({ container, isTrellisLicenseWizardComplete: () => false }, f.ui); // CHANGE
    assert.equal(container.querySelector('.trellis-splash-login-status'), null); // CHANGE
    const splash = { container, isTrellisLicenseWizardComplete: () => true }; // CHANGE
    f.window.TrellisGardenHome.attachSplash(splash, f.ui); await new Promise(resolve => setImmediate(resolve)); // CHANGE
    assert.equal(container.querySelector('.trellis-splash-login-status').textContent, 'Not logged in'); // CHANGE
    assert.equal(container.querySelector('.trellis-home-panel'), null); // CHANGE
    const actions = container.querySelector('.trellis-splash-actions'), labels = () => [...actions.querySelectorAll('button')].map(node => node.textContent); // CHANGE
    assert.deepEqual(labels(), ['Create or Open a Garden Project', 'Join a Garden Project', 'Explore and Support Trellis']); // CHANGE
    f.window.TrellisGardenHome.attachSplash(splash, f.ui); // CHANGE
    assert.equal(container.querySelectorAll('.trellis-splash-login-status').length, 1); // CHANGE
    assert.equal(container.querySelectorAll('.trellis-splash-local-create').length, 0); // CHANGE: repeated splash attachment must not add local creation.
    assert.deepEqual(labels(), ['Create or Open a Garden Project', 'Join a Garden Project', 'Explore and Support Trellis']); // CHANGE
    assert.equal(actions.querySelectorAll('[data-project-launcher]').length, 1); // CHANGE
}); // CHANGE

test('splash preserves base Create and Open actions when either desktop bridge is unavailable', () => { // NEW
    for (const bridge of ['trellisIdentity', 'trellisGardenLibrary']) { // NEW
        const f = fixture(), container = f.window.document.getElementById('splash'); delete f.window[bridge]; // NEW
        f.window.TrellisGardenHome.attachSplash({ container, isTrellisLicenseWizardComplete: () => true }, f.ui); // NEW
        assert.deepEqual([...container.querySelectorAll('.trellis-splash-actions button')].map(node => node.textContent), ['Create New Garden', 'Open Existing Garden', 'Explore and Support Trellis']); // NEW
        assert.equal(container.querySelector('[data-project-launcher]'), null); // NEW
    } // NEW
}); // NEW

test('splash identity status follows login and logout without exposing identity forms', async () => { // CHANGE
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); // CHANGE
    f.window.TrellisGardenHome.attachSplash({ container: f.window.document.getElementById('splash'), isTrellisLicenseWizardComplete: () => true }, f.ui); // CHANGE
    await new Promise(resolve => setImmediate(resolve)); // CHANGE
    assert.equal(f.window.document.querySelector('.trellis-splash-login-status').textContent, 'Logged in as Alice'); // CHANGE
    f.setSession(null); await f.emitStatus({ session: null }); // CHANGE
    assert.equal(f.window.document.querySelector('.trellis-splash-login-status').textContent, 'Not logged in'); // CHANGE
    assert.equal(f.window.document.querySelector('.trellis-home-panel'), null); // CHANGE
}); // CHANGE

test('missing and malformed files never replace the current document or hide the dialog', async () => {
    const f = fixture(), old = { isModified: () => false }; f.setCurrent(old);
    await assert.rejects(f.window.TrellisGardenHome.openPath(f.ui, 'missing.drawio'), /Missing/);
    assert.deepEqual(f.calls, []);
    f.ui.readGraphFile = success => success({}, '<not-a-diagram/>', {}, '', false);
    await assert.rejects(f.window.TrellisGardenHome.openPath(f.ui, 'bad.drawio'), /valid diagram/);
    assert.deepEqual(f.calls, []);
});
test('unsaved navigation cancellation leaves draft and document untouched', async () => {
    const f = fixture(); f.setCurrent({ isModified: () => true }); f.ui.confirm = (_text, cancel) => cancel();
    assert.equal(await f.window.TrellisGardenHome.openPath(f.ui, 'garden.drawio'), false);
    assert.deepEqual(f.calls, []);
});
test('creation retains the explicit reminder copy action after identity controls are replaced', async () => { // NEW
    const f = fixture(), copied = [];
    f.window.electron = { request(payload, success) { copied.push(payload); success(); } };
    f.window.trellisIdentity.create = async () => { f.setSession({ identityId: 'alice', username: 'Alice' }); };
    f.window.TrellisGardenHome.attachSplash({ container: f.window.document.getElementById('splash'), isTrellisLicenseWizardComplete: () => true }, f.ui);
    f.window.TrellisGardenHome.showProjects(f.ui); // NEW
    await new Promise(resolve => setImmediate(resolve));
    const find = label => [...f.window.document.querySelectorAll('button')].find(button => button.textContent === label);
    find('Create identity').click();
    f.window.document.querySelector('input[aria-label="Username"]').value = 'Alice';
    f.window.document.querySelector('input[aria-label="Password"]').value = 'secret';
    find('Create identity').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(find('Copy login reminder'));
    assert.equal(copied.length, 0);
    find('Copy login reminder').click(); await new Promise(resolve => setImmediate(resolve));
    assert.match(copied[0].data, /^Username: Alice\nPassword: secret\nDate: /);
    assert.equal(copied[0].data.split('\n').length, 3);
});

/** Render the real Home controls with a connected identity fixture. */ // NEW
async function loginFixture() { // NEW
    const f = fixture(); // NEW
    f.window.trellisIdentity.list = async () => ({ identities: [{ id: 'alice', username: 'Alice' }], session: await f.window.trellisIdentity.getSession() }); // NEW
    f.window.TrellisGardenHome.attachSplash({ container: f.window.document.getElementById('splash'), isTrellisLicenseWizardComplete: () => true }, f.ui); // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); // NEW
    await new Promise(resolve => setImmediate(resolve)); f.calls.length = 0; // CHANGE
    f.find = label => [...f.window.document.querySelectorAll('button')].find(button => button.textContent === label); // NEW
    f.tick = () => new Promise(resolve => setImmediate(resolve)); // NEW
    return f; // NEW
} // NEW

for (const flow of ['Log in', 'Create identity', 'Connect existing identity']) { // NEW
    for (const checked of [true, false]) { // NEW
        test(`${flow} defaults to remembered login, sends ${checked}, and retains a failure notice`, async () => { // NEW
            const f = await loginFixture(), calls = []; // NEW
            const warning = 'You’re logged in, but Trellis couldn’t keep you logged in. Enter your password next time.'; // NEW
            const authenticate = async payload => { calls.push(payload); f.setSession({ identityId: 'alice', username: 'Alice' }); return { ok: true, persistenceWarning: warning }; }; // NEW
            f.window.trellisIdentity.create = authenticate; f.window.trellisIdentity.unlock = authenticate; // NEW
            f.window.trellisIdentity.importSetup = async payload => { assert.equal(payload.password, 'sample-password'); return { identityId: 'alice' }; }; // NEW
            f.window.electron = { request(payload, success) { if (payload.action === 'showOpenDialog') success(['approved.json']); else if (payload.action === 'readFile') success('{}'); else success(); } }; // NEW
            f.find(flow).click(); // NEW
            const keep = f.window.document.querySelector('input[type=checkbox]'), password = f.window.document.querySelector('input[type=password]'); // NEW
            assert.equal(keep.checked, true); assert.equal(keep.getAttribute('aria-label'), 'Keep me logged in on this device'); // NEW
            assert.equal(keep.parentNode.tagName, 'LABEL'); assert.equal(keep.parentNode.textContent, 'Keep me logged in on this device'); // NEW
            assert.equal(password.closest('form'), keep.closest('form')); assert.equal(password.parentNode.nextElementSibling, keep.parentNode); // NEW
            keep.parentNode.click(); assert.equal(keep.checked, false); // NEW: native label activation toggles the control.
            keep.focus(); assert.equal(f.window.document.activeElement, keep); // NEW: the native checkbox remains keyboard focusable.
            keep.checked = checked; password.value = 'sample-password'; // NEW
            const name = f.window.document.querySelector('input[aria-label=Username]'); if (name) name.value = 'Alice'; // NEW
            const form = keep.closest('form'); // NEW
            form.dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true })); await f.tick(); // NEW: Enter uses the form's submit event.
            assert.equal(calls.length, 1); assert.equal(calls[0].keepLoggedIn, checked); assert.equal(calls[0].password, 'sample-password'); // NEW
            if (flow === 'Create identity') assert.equal(calls[0].username, 'Alice'); else assert.equal(calls[0].identityId, 'alice'); // NEW
            assert.equal(password.value, ''); assert.match(f.ui.__trellisGardenHome.accountHost.textContent, /Alice/); // NEW
            assert.equal(f.window.document.querySelector('[role=status]').textContent, warning); // NEW
            f.ui.__trellisGardenHome.projectLoadHeaders.private.reload.click(); await f.tick(); // NEW
            assert.equal(f.window.document.querySelector('[role=status]').textContent, warning); // NEW: subsequent logged-in redraws retain the notice.
            if (flow === 'Create identity') assert.ok(f.find('Copy login reminder')); // CHANGE: refreshing projects preserves the explicit reminder action. // NEW: navigating away uses the existing reminder lifetime.
        }); // NEW
    } // NEW
} // NEW

test('login button sends the checkbox value and authentication failure leaves the form usable', async () => { // NEW
    const f = await loginFixture(); let attempts = 0; // NEW
    f.window.trellisIdentity.unlock = async payload => { attempts++; assert.equal(payload.keepLoggedIn, true); if (attempts === 1) throw new Error('Incorrect password.'); f.setSession({ identityId: 'alice', username: 'Alice' }); return { ok: true }; }; // NEW
    f.find('Log in').click(); const password = f.window.document.querySelector('input[type=password]'); password.value = 'sample'; // NEW
    f.find('Log in').click(); await f.tick(); // NEW
    assert.match(f.window.document.querySelector('.trellis-home-panel').textContent, /Incorrect password/); assert.equal(password.value, 'sample'); // NEW
    f.find('Log in').click(); await f.tick(); assert.equal(attempts, 2); assert.equal(password.value, ''); // NEW
    assert.equal(f.window.document.querySelector('[role=status]'), null); // NEW
}); // NEW

test('canceling approved-setup selection does not authenticate or change the checkbox', async () => { // NEW
    const f = await loginFixture(); let calls = 0; // NEW
    f.window.electron = { request(_payload, success) { success([]); } }; f.window.trellisIdentity.unlock = async () => { calls++; }; // NEW
    f.find('Connect existing identity').click(); f.find('Import approved setup').click(); await f.tick(); // NEW
    assert.equal(calls, 0); assert.equal(f.window.document.querySelector('input[type=checkbox]').checked, true); // NEW
}); // NEW

test('received identity invalidation returns settings to login and preserves the unsaved document', async () => { // NEW
    const f = await loginFixture(), draft = { isModified: () => true }; let logouts = 0; // NEW
    f.setCurrent(draft); f.setSession({ identityId: 'alice', username: 'Alice' }); // NEW
    await f.emitStatus({ session: await f.window.trellisIdentity.getSession() }); // NEW
    f.window.Trellis = { users: { getCurrentUser: () => ({ portableIdentityId: 'alice' }), logout: () => { logouts++; } } }; // NEW
    f.find('Identity settings').click(); f.setSession(null); await f.emitStatus({ session: null }); // NEW
    assert.equal(logouts, 1); assert.equal(f.ui.getCurrentFile(), draft); assert.deepEqual(f.calls, []); // NEW
    assert.ok(f.find('Log in')); assert.equal(f.window.document.querySelector('[role=status]'), null); // NEW
}); // NEW

test('a delayed identity-list response cannot erase an opened login form', async () => { // NEW
    const f = await loginFixture(); let release; // NEW
    f.window.trellisIdentity.list = () => new Promise(resolve => { release = resolve; }); // NEW
    const refreshing = f.emitStatus({ session: { identityId: 'changed', username: 'Changed' } }); // NEW
    f.find('Log in').click(); const password = f.window.document.querySelector('input[type=password]'), keep = f.window.document.querySelector('input[type=checkbox]'); // NEW
    password.value = 'typed-password'; keep.checked = false; // NEW
    release({ identities: [{ id: 'alice', username: 'Alice' }], session: null }); await refreshing; // NEW
    assert.equal(password.isConnected, true); assert.equal(password.value, 'typed-password'); assert.equal(keep.isConnected, true); assert.equal(keep.checked, false); // NEW
}); // NEW

const tick = () => new Promise(resolve => setImmediate(resolve)); // NEW
const foldStorageKey = identity => 'trellis.gardenProjects.folds.v1.' + (identity ? 'identity:' + identity : 'signed-out'); // NEW
test('section symbols fold contents and creation while headings remain visible', async () => { // NEW
    for (const communities of [false, true]) { // NEW
        const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); // NEW
        if (communities) f.window.trellisGardenCommunities = { onStatus() {}, list: async () => ({ communities: [] }), listRequests: async () => ({ requests: [] }) }; // NEW
        f.window.TrellisGardenHome.showProjects(f.ui); await tick(); // NEW
        const state = f.ui.__trellisGardenHome, { shared, private: privateToggle } = state.projectSectionToggles; // NEW
        assert.equal(shared.textContent, '−'); assert.equal(privateToggle.getAttribute('aria-expanded'), 'true'); // NEW
        assert.equal(shared.getAttribute('aria-label'), 'Collapse Shared garden projects'); // NEW
        assert.equal(f.window.document.getElementById(shared.getAttribute('aria-controls')), state.sharedRows); // NEW
        const detail = f.window.document.createElement('details'); detail.open = true; state.privateRows.append(detail); // NEW
        privateToggle.click(); assert.equal(state.privateRows.hidden, true); assert.equal(state.sharedRows.hidden, false); // NEW
        assert.equal(privateToggle.textContent, '+'); assert.equal(privateToggle.title, 'Expand Private garden projects'); // NEW
        assert.equal(privateToggle.getAttribute('aria-expanded'), 'false'); assert.equal(detail.isConnected, true); // NEW
        state.privateRows.parentNode.querySelector('.trellis-projects-title').click(); assert.equal(state.privateRows.hidden, true); // NEW
        const privateCreate = state.creationButtons.at(-1); assert.equal(privateCreate.hidden, true); assert.equal(privateCreate.disabled, false); privateToggle.click(); // CHANGE
        privateCreate.click(); const form = state.creationForm; // NEW
        assert.equal(form.closest('[hidden]'), null); assert.equal(f.window.document.activeElement.getAttribute('aria-label'), 'Project name'); // NEW
        privateToggle.click(); assert.equal(form.hidden, true); privateToggle.click(); assert.equal(detail.open, true); assert.equal(state.privateRows.hidden, false); // NEW
        assert.equal(form.isConnected, true); shared.click(); assert.equal(state.sharedRows.hidden, true); // NEW
        privateToggle.click(); assert.equal(state.privateRows.hidden, true); assert.equal(form.hidden, true); // CHANGE // NEW
        f.dom.window.close(); // NEW
    } // NEW
}); // NEW
test('saved section folds survive UI recreation and remain isolated by identity and signed-out use', async () => { // NEW
    const f = fixture(); f.window.TrellisGardenHome.showProjects(f.ui); await tick(); // NEW
    let state = f.ui.__trellisGardenHome; state.projectSectionToggles.private.click(); // NEW
    const changeIdentity = async identity => { const session = identity ? { identityId: identity, username: identity } : null; f.setSession(session); await f.emitStatus({ session }); await tick(); }; // NEW
    await changeIdentity('alice'); assert.equal(state.privateRows.hidden, false); state.projectSectionToggles.shared.click(); // NEW
    await changeIdentity('bob'); assert.equal(state.sharedRows.hidden, false); assert.equal(state.privateRows.hidden, false); // NEW
    state.projectSectionToggles.private.click(); await changeIdentity('alice'); // NEW
    assert.equal(state.sharedRows.hidden, true); assert.equal(state.privateRows.hidden, false); // NEW
    await changeIdentity(null); assert.equal(state.sharedRows.hidden, false); assert.equal(state.privateRows.hidden, true); // NEW
    const restarted = fixture(); restarted.setSession({ identityId: 'alice', username: 'Alice' }); // NEW
    for (const identity of [null, 'alice', 'bob']) restarted.window.localStorage.setItem(foldStorageKey(identity), f.window.localStorage.getItem(foldStorageKey(identity))); // NEW
    restarted.window.TrellisGardenHome.showProjects(restarted.ui); await tick(); state = restarted.ui.__trellisGardenHome; // NEW
    assert.equal(state.sharedRows.hidden, true); assert.equal(state.privateRows.hidden, false); // NEW
    f.dom.window.close(); restarted.dom.window.close(); // NEW
}); // NEW
test('search folds are temporary and survive typing, refreshes and identity changes correctly', async () => { // NEW
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome; // NEW
    state.projectSectionToggles.shared.click(); state.projectSectionToggles.private.click(); // NEW
    const saved = f.window.localStorage.getItem(foldStorageKey('alice')); // NEW
    const search = value => { state.searchControl.value = value; state.searchControl.dispatchEvent(new f.window.Event('input')); }; // NEW
    search('a'); assert.equal(state.sharedRows.hidden, false); assert.equal(state.privateRows.hidden, false); // NEW
    state.projectSectionToggles.shared.click(); search('ap'); // NEW
    assert.equal(state.sharedRows.hidden, true); assert.equal(state.privateRows.hidden, false); // NEW
    reloadProjects(state); await tick(); // NEW
    assert.equal(state.sharedRows.hidden, true); assert.equal(f.window.localStorage.getItem(foldStorageKey('alice')), saved); // NEW
    search(''); assert.equal(state.sharedRows.hidden, true); assert.equal(state.privateRows.hidden, true); // NEW
    search('a'); state.projectSectionToggles.shared.click(); // NEW
    const bob = { identityId: 'bob', username: 'Bob' }; f.setSession(bob); await f.emitStatus({ session: bob }); await tick(); // NEW
    assert.equal(state.sharedRows.hidden, false); assert.equal(state.privateRows.hidden, false); // NEW
    state.projectSectionToggles.private.click(); search(''); // NEW
    assert.equal(state.sharedRows.hidden, false); assert.equal(state.privateRows.hidden, false); // NEW
    assert.equal(f.window.localStorage.getItem(foldStorageKey('bob')), null); f.dom.window.close(); // NEW
}); // NEW
test('section folds survive refresh, Trash navigation and reopening and hide creation', async () => { // NEW
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); let state = f.ui.__trellisGardenHome; // NEW
    state.projectSectionToggles.private.click(); // NEW
    for (const label of ['Reload', 'Trash', 'Projects']) { // NEW
        [...state.projectsRoot.querySelectorAll('button')].find(b => b.textContent === label).click(); await tick(); // NEW
        assert.equal(state.privateRows.hidden, true); assert.equal(state.sharedRows.hidden, false); // NEW
        assert.equal(state.privateRows.parentNode.hidden, label === 'Trash'); // NEW
    } // NEW
    f.ui.hideDialog(); f.window.TrellisGardenHome.showProjects(f.ui, { focus: 'create' }); await tick(); state = f.ui.__trellisGardenHome; // NEW
    assert.equal(state.privateRows.hidden, true); assert.equal(f.window.document.activeElement, state.creationButtons[0]); // NEW
    assert.equal(state.creationButtons[1].hidden, true); f.dom.window.close(); // NEW
}); // NEW
test('invalid or unavailable fold storage defaults safely and storage failures keep in-memory choices', async () => { // NEW
    for (const value of ['broken', 'null', 'true', '{"shared":"true","private":1}', '{"shared":true,"private":"bad"}']) { // NEW
        const f = fixture(); f.window.localStorage.setItem(foldStorageKey(null), value); // NEW
        f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome; // NEW
        assert.equal(state.sharedRows.hidden, value.includes('"shared":true')); assert.equal(state.privateRows.hidden, false); // NEW
        f.dom.window.close(); // NEW
    } // NEW
    const f = fixture(); Object.defineProperty(f.window, 'localStorage', { value: { getItem() { throw new Error('Storage blocked'); }, setItem() { throw new Error('Storage full'); } } }); // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); let state = f.ui.__trellisGardenHome; // NEW
    assert.equal(state.sharedRows.hidden, false); state.projectSectionToggles.shared.click(); // NEW
    f.ui.hideDialog(); f.window.TrellisGardenHome.showProjects(f.ui); await tick(); state = f.ui.__trellisGardenHome; // NEW
    assert.equal(state.sharedRows.hidden, true); state.projectSectionToggles.shared.click(); assert.equal(state.sharedRows.hidden, false); // NEW
    f.dom.window.close(); // NEW
}); // NEW
test('opening and refresh never focus rows in folded sections', async () => { // NEW
    const f = fixture(); f.window.localStorage.setItem(foldStorageKey(null), JSON.stringify({ shared: true, private: true })); // NEW
    f.window.trellisGardenLibrary.listLocal = async () => ({ folder: '/local', gardens: [{ path: '/local/a', name: 'Apple', source: 'local', available: true }] }); // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome; // NEW
    assert.equal(f.window.document.activeElement, state.projectSectionToggles.shared); // NEW
    state.projectSectionToggles.private.click(); const open = state.privateRows.querySelector('button'); open.focus(); // NEW
    state.projectSectionToggles.private.click(); assert.equal(f.window.document.activeElement, state.projectSectionToggles.private); // NEW
    reloadProjects(state); await tick(); // NEW
    assert.equal(f.window.document.activeElement, state.projectSectionToggles.private); assert.equal(f.window.document.activeElement.closest('[hidden]'), null); // NEW
    f.dom.window.close(); // NEW
}); // NEW
test('combined splash action opens the library once and preserves local access, creation gates, focus and origin', async () => { // CHANGE
    for (const signedIn of [false, true]) { // CHANGE
        const f = fixture(); if (signedIn) f.setSession({ identityId: 'alice', username: 'Alice' }); // CHANGE
        f.window.trellisGardenLibrary.listLocal = async () => ({ folder: '/local', gardens: [{ path: '/local/garden', name: 'Local garden', source: 'local', available: true }] }); // CHANGE
        const container = f.window.document.getElementById('splash'); f.window.TrellisGardenHome.attachSplash({ container, isTrellisLicenseWizardComplete: () => true }, f.ui); await tick(); // NEW
        f.window.TrellisGardenHome.attachSplash({ container, isTrellisLicenseWizardComplete: () => true }, f.ui); // CHANGE
        const launcher = container.querySelector('[data-project-launcher=open]'); let baseNew = 0; launcher.addEventListener('click', () => { baseNew++; }); launcher.focus(); assert.equal(f.window.document.activeElement, launcher); // CHANGE
        launcher.click(); await tick(); // CHANGE
        assert.equal(f.window.document.querySelectorAll('.trellis-projects-root').length, 1); // NEW
        const state = f.ui.__trellisGardenHome; assert.equal(state.focus, 'open'); assert.equal(baseNew, 0); assert.equal(f.calls.filter(call => call === 'hide').length, 1); // CHANGE
        assert.match(state.privateRows.textContent, /Local garden/); assert.equal(f.window.document.activeElement.textContent, 'Open'); // CHANGE
        assert.ok(state.creationButtons.every(node => node.disabled === !signedIn)); // CHANGE
        f.ui.__trellisGardenHome.projectsBody.lastElementChild.querySelector('button:last-child').click(); await new Promise(resolve => setTimeout(resolve, 10)); // NEW
        assert.equal(f.window.document.querySelector('.trellis-projects-root'), null); assert.ok(f.window.document.getElementById('splash')); // NEW
    } // NEW
}); // NEW
test('shared rows, private sources, deduplication, and Unknown seeds render without distance bands', async () => { // NEW
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); // NEW
    f.window.trellisGardenLibrary.list = async () => ({ gardens: [ // NEW
        { diagramId: 'near', path: '/near', name: 'Nearby', available: true, classification: 'shared', userCount: 2, seeds: 3, distanceKm: 24.9 }, // NEW
        { diagramId: 'far', path: '/far', name: 'Far away', available: true, classification: 'shared', userCount: 4, seeds: null, distanceKm: 100 }, // NEW
        { diagramId: 'unknown', name: 'No location', available: false, classification: 'shared', userCount: null, seeds: null, distanceKm: null }, // NEW
        { diagramId: 'private', path: '/private', name: 'Private library', available: true, classification: 'private', source: 'library' } // NEW
    ] }); // NEW
    f.window.trellisGardenLibrary.listLocal = async () => ({ folder: '/local', gardens: [{ path: '/private', name: 'Duplicate file', source: 'local', available: true }, { path: '/local/file', name: 'Local file', source: 'local', available: true }, { diagramId: 'private', path: '/copied', name: 'Duplicate project identity', source: 'local', available: true }] }); // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); // NEW
    const root = f.window.document.querySelector('.trellis-projects-root'), shared = f.ui.__trellisGardenHome.sharedRows; // NEW
    assert.deepEqual([...shared.querySelectorAll('h4')], []); // CHANGE // NEW
    assert.match(shared.textContent, /2 users · 3 seeds/); assert.match(shared.textContent, /Seeds: Unknown/); // NEW
    assert.match(f.ui.__trellisGardenHome.privateRows.textContent, /Local file.*Local file.*Private library.*Downloaded/); // NEW
    assert.equal(root.textContent.includes('Duplicate project identity'), false); assert.equal(root.textContent.includes('Duplicate file'), false); // CHANGE assert.equal(root.querySelector('.trellis-home-list'), null); // NEW
    const protocol = f.window.TrellisGardenHome; assert.deepEqual([0, 25, 100, 500, null].map(protocol.distanceBand), [0, 1, 2, 3, 4]); // NEW
}); // NEW
test('availability refresh preserves search input, row focus, expanded details, scroll, and login form input', async () => { // NEW
    const f = await loginFixture(), state = f.ui.__trellisGardenHome; // NEW
    f.window.trellisGardenLibrary.listLocal = async () => ({ folder: '/local', gardens: [{ path: '/local/a', name: 'Apple', source: 'local', available: true }] }); // NEW
    f.ui.__trellisGardenHome.projectLoadHeaders.private.reload.click(); await tick(); // NEW
    const search = f.window.document.querySelector('input[aria-label="Search garden projects"]'); search.value = 'App'; search.dispatchEvent(new f.window.Event('input')); // NEW
    const details = state.privateRows.querySelector('details'); details.open = true; // NEW
    const open = state.privateRows.querySelector('button'); open.focus(); state.projectsBody.scrollTop = 123; // NEW
    f.ui.__trellisGardenHome.projectLoadHeaders.private.reload.click(); await tick(); assert.equal(f.window.document.activeElement.getAttribute('data-project-focus'), '/local/a:open'); // NEW
    assert.equal(search.value, 'App'); assert.equal(state.privateRows.querySelector('details').open, true); assert.equal(state.projectsBody.scrollTop, 123); // NEW
    f.find('Log in').click(); const password = f.window.document.querySelector('input[type=password]'); password.value = 'keep typing'; // NEW
    await f.emitStatus({ session: null }); await tick(); assert.equal(password.isConnected, true); assert.equal(password.value, 'keep typing'); // NEW
}); // NEW
test('a failed identity library does not hide signed-out-capable local browsing', async () => { // NEW
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); // NEW
    f.window.trellisGardenLibrary.list = async () => { throw new Error('Metadata unavailable'); }; // NEW
    f.window.trellisGardenLibrary.listLocal = async () => ({ folder: '/local', gardens: [{ path: '/local/a', name: 'Local project', source: 'local', available: true }] }); // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); // NEW
    assert.match(f.ui.__trellisGardenHome.privateRows.textContent, /Local project/); assert.match(f.ui.__trellisGardenHome.projectLoadHeaders.private.status.textContent, /Metadata unavailable/); // CHANGE: failures remain section-local.
}); // NEW
function creationMechanics(f) { // NEW
    const children = [], seeded = [], invited = [], saved = [], completed = []; // CHANGE
    f.window.trellisGardenLibrary.completeStarter = async input => { completed.push(input.path); return { ok: true }; }; // NEW // NEW
    const graph = { __trellisTaskManager: {}, __trellisRoadmapManager: {}, getDefaultParent: () => ({}), model: { getChildren: () => children }, setSelectionCell: garden => { graph.selected = garden; }, __trellisModules: { createModuleAtPoint: (_point, type) => { seeded.push(type); const garden = { value: { getAttribute: name => name === 'garden_module' ? '1' : null } }; children.push(garden); return garden; } } }; // NEW
    f.ui.editor = { graph }; f.window.Trellis = { users: { restorePortableLogin: async () => true, isLoggedIn: () => true } }; // NEW
    f.ui.actions.addAction('trellisShareGardenProject', () => invited.push(graph.selected)); // NEW
    f.window.LocalFile.prototype.save = (_force, success) => { saved.push(true); success(); }; // NEW
    f.ui.readGraphFile = (success, _error, filename) => success({ path: filename }, '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>', {}, filename, false); // NEW
    return { seeded, invited, saved, completed }; // CHANGE // NEW
} // NEW
test('project creation seeds through existing mechanics and Shared additionally opens invitations', async () => { // NEW
    for (const kind of ['Shared', 'Private']) { // NEW
        const f = await loginFixture(), mechanics = creationMechanics(f), created = []; // NEW
        f.setSession({ identityId: 'alice', username: 'Alice' }); await f.emitStatus({ session: await f.window.trellisIdentity.getSession() }); await tick(); // NEW
        f.window.trellisGardenLibrary.create = async input => { created.push(input); return { path: '/created', entry: { name: input.name } }; }; // NEW
        f.find('Create New ' + kind + ' Garden Project').click(); // NEW
        f.window.document.querySelector('input[aria-label="Project name"]').value = 'Named project'; f.find('Create project').click(); await tick(); // NEW
        assert.equal(created.length, 1); assert.equal(created[0].name, 'Named project'); assert.deepEqual(mechanics.seeded, ['garden']); assert.equal(mechanics.saved.length, 1); assert.deepEqual(mechanics.completed, ['/created']); // CHANGE // NEW
        assert.equal(mechanics.invited.length, kind === 'Shared' ? 1 : 0); assert.equal(f.ui.getCurrentFile().fileObject.path, '/created'); // NEW
    } // NEW
}); // NEW
test('creation cancellation does not create, and a failed opening retries without duplicate creation', async () => { // NEW
    const f = await loginFixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); await f.emitStatus({ session: await f.window.trellisIdentity.getSession() }); await tick(); // NEW
    let created = 0; f.window.trellisGardenLibrary.create = async () => { created++; return { path: '/created' }; }; // NEW
    f.setCurrent({ isModified: () => true }); f.ui.confirm = (_text, cancel) => cancel(); // NEW
    f.find('Create New Private Garden Project').click(); f.window.document.querySelector('input[aria-label="Project name"]').value = 'One project'; f.find('Create project').click(); await tick(); assert.equal(created, 0); // NEW
    f.ui.confirm = (_text, _cancel, ok) => ok(); f.find('Create project').click(); await tick(); assert.equal(created, 1); assert.ok(f.find('Retry opening created project')); // NEW
    creationMechanics(f); f.find('Retry opening created project').click(); await tick(); assert.equal(created, 1); assert.equal(f.ui.getCurrentFile().fileObject.path, '/created'); // NEW
}); // NEW

test('constructor-time detached splash status remains registered until mounting', async () => { // NEW
    const f = fixture(), container = f.window.document.getElementById('splash'); container.remove(); // NEW
    f.setSession({ identityId: 'alice', username: 'Alice' }); // NEW
    f.window.TrellisGardenHome.attachSplash({ container, isTrellisLicenseWizardComplete: () => true }, f.ui); // NEW
    f.window.document.body.append(container); await tick(); // NEW
    assert.equal(container.querySelector('.trellis-splash-login-status').textContent, 'Logged in as Alice'); // NEW
    f.setSession(null); await f.emitStatus({ session: null }); assert.equal(container.querySelector('.trellis-splash-login-status').textContent, 'Not logged in'); // NEW
}); // NEW

test('closing a browser before a read finishes preserves the document and suppresses late read errors', async () => { // NEW
    for (const fail of [false, true]) { // NEW
        const f = fixture(), previous = { isModified: () => false }; f.setCurrent(previous); // NEW
        let release, active = true; f.ui.readGraphFile = (success, error) => { release = fail ? error : success; }; // NEW
        const opening = f.window.TrellisGardenHome.openPath(f.ui, '/late', { isActive: () => active }); await tick(); active = false; // NEW
        if (fail) release(new Error('Late missing file')); else release({ path: '/late' }, '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>', {}, 'Late', false); // NEW
        assert.equal(await opening, false); assert.equal(f.ui.getCurrentFile(), previous); assert.deepEqual(f.calls, []); // NEW
    } // NEW
}); // NEW
test('closing during creation keeps the previous document and opening the retained pending project seeds it once', async () => { // NEW
    const f = fixture(), previous = { isModified: () => false }; f.setCurrent(previous); f.setSession({ identityId: 'alice', username: 'Alice' }); // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); // NEW
    const find = label => [...f.window.document.querySelectorAll('button')].find(button => button.textContent === label); // NEW
    let release, creates = 0; f.window.trellisGardenLibrary.create = () => { creates++; return new Promise(resolve => { release = resolve; }); }; // NEW
    find('Create New Private Garden Project').click(); f.window.document.querySelector('input[aria-label="Project name"]').value = 'Retained'; find('Create project').click(); await tick(); // NEW
    find('Close').click(); release({ path: '/retained', entry: { diagramId: 'retained', name: 'Retained', starterPending: true } }); await tick(); // NEW
    assert.equal(f.ui.getCurrentFile(), previous); assert.equal(creates, 1); assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === 'loaded'), false); // NEW
    const mechanics = creationMechanics(f); // NEW
    f.window.trellisGardenLibrary.list = async () => ({ gardens: [{ diagramId: 'retained', name: 'Retained', source: 'library', path: '/retained', available: true, starterPending: true, classification: 'private', conflicts: [] }] }); // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); find('Open').click(); await tick(); // NEW
    assert.equal(f.ui.getCurrentFile().fileObject.path, '/retained'); assert.deepEqual(mechanics.seeded, ['garden']); assert.equal(creates, 1); // NEW
}); // NEW
test('Reload removes cached old projects while current projects remain visible and open normally', async () => { // CHANGE
    const f = await loginFixture(), mechanics = creationMechanics(f); f.setSession({ identityId: 'alice', username: 'Alice' }); // CHANGE
    let includeOld = true; const old = { diagramId: 'old', name: 'Retained local garden', path: '/old', source: 'library', available: true, starterPending: false, classification: 'private', localOnly: true, userCount: 3 }, current = { diagramId: 'current', name: 'Current garden', path: '/current', source: 'library', available: true, starterPending: false, classification: 'private', protocolVersion: 3 }; // CHANGE
    f.window.trellisGardenLibrary.list = async () => ({ gardens: includeOld ? [old, current] : [current] }); // CHANGE: simulate a cached response followed by the filtered library listing.
    await f.emitStatus({ session: await f.window.trellisIdentity.getSession() }); await tick(); // CHANGE
    const state = f.ui.__trellisGardenHome; assert.match(state.privateRows.textContent, /Retained local garden/); // CHANGE
    includeOld = false; state.projectLoadHeaders.private.reload.click(); await tick(); // CHANGE
    assert.doesNotMatch(state.projectsRoot.textContent, /Retained local garden|Local only · Sharing off/); assert.match(state.privateRows.textContent, /Current garden/); // CHANGE
    f.ui.hideDialog(); f.window.TrellisGardenHome.showProjects(f.ui); await tick(); assert.doesNotMatch(state.projectsRoot.textContent, /Retained local garden/); // CHANGE
    state.privateRows.querySelector('button').click(); await tick(); assert.equal(f.ui.getCurrentFile().fileObject.path, '/current'); assert.equal(mechanics.seeded.length, 0); // CHANGE
}); // CHANGE

test('an older empty project is opened without starter initialization', async () => { // NEW
    const f = await loginFixture(), mechanics = creationMechanics(f); f.setSession({ identityId: 'alice', username: 'Alice' }); // NEW
    f.window.trellisGardenLibrary.list = async () => ({ gardens: [{ diagramId: 'old', name: 'Old empty', path: '/old', source: 'library', available: true, starterPending: false, classification: 'private', conflicts: [] }] }); // NEW
    await f.emitStatus({ session: await f.window.trellisIdentity.getSession() }); await tick(); f.find('Open').click(); await tick(); // NEW
    assert.equal(f.ui.getCurrentFile().fileObject.path, '/old'); assert.equal(mechanics.seeded.length, 0); // NEW
}); // NEW

/** User-visible lifecycle actions exercise the same production dialog callbacks. */ // NEW
test('delete removes the active row, exposes Trash, restores it, and omits the old device controls', async () => { // NEW
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); let active = true; // NEW
    const project = { diagramId: 'garden', name: 'Kitchen garden', source: 'library', userCount: 1, available: false }; // NEW
    f.window.trellisGardenLibrary.list = async () => ({ gardens: active ? [project] : [] }); // NEW
    f.window.trellisGardenLibrary.listTrash = async () => ({ gardens: active ? [] : [{ ...project, trashId: 'trash-one' }] }); // NEW
    f.window.trellisGardenLibrary.actions = async () => ({ canDelete: true }); // NEW
    f.window.trellisGardenLibrary.trash = async payload => { assert.equal(payload.confirm, true); active = false; return { ok: true }; }; // NEW
    f.window.trellisGardenLibrary.restore = async () => { active = true; return { ok: true }; }; // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); // NEW
    const root = f.window.document.querySelector('.trellis-projects-root'); assert.doesNotMatch(root.textContent, /Keep available offline|Remove from this device|Remove download/); // NEW
    assert.equal(root.querySelector('[aria-label="Actions for Kitchen garden"]').textContent, '⋯'); // NEW
    root.querySelector('[data-project-focus="garden:remove"]').click(); await tick(); // NEW
    assert.match(f.ui.__trellisGardenHome.confirmation.panel.textContent, /paired devices.*invitations/); // NEW
    [...f.ui.__trellisGardenHome.confirmation.panel.querySelectorAll('button')].find(b => b.textContent === 'Move to Trash').click(); await tick(); await tick(); // NEW
    assert.equal(f.ui.__trellisGardenHome.privateRows.querySelector('.trellis-home-garden'), null); // NEW
    [...root.querySelectorAll('button')].find(b => b.textContent === 'Trash').click(); await tick(); // NEW
    assert.equal(f.ui.__trellisGardenHome.trashSection.hidden, false); root.querySelector('[data-project-focus="trash-one:restore"]').click(); await tick(); // NEW
    [...root.querySelectorAll('button')].find(b => b.textContent === 'Projects').click(); await tick(); assert.match(f.ui.__trellisGardenHome.privateRows.textContent, /Kitchen garden/); // NEW
}); // NEW

test('leaving requires a selected connected successor and remains visible while acknowledgement is pending', async () => { // NEW
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); let departing = false, submitted; // NEW
    f.window.trellisGardenLibrary.list = async () => ({ gardens: [{ diagramId: 'shared', name: 'Community', source: 'library', classification: 'shared', available: true, path: '/community', userCount: 2, departing }] }); // NEW
    f.window.trellisGardenLibrary.actions = async () => ({ canDelete: false, canLeave: true, requiresSuccessor: true, requiresCoordinator: true, successors: [{ id: 'bob', name: 'Connected Bob' }] }); // NEW
    f.window.trellisGardenLibrary.leave = async payload => { submitted = payload; departing = true; return { ok: true, complete: false, reason: 'Leaving… Waiting for acknowledgement.' }; }; // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const root = f.window.document.querySelector('.trellis-projects-root'); // NEW
    root.querySelector('[data-project-focus="shared:remove"]').click(); await tick(); // NEW
    const panel = f.ui.__trellisGardenHome.confirmation.panel, select = panel.querySelector('select'); assert.deepEqual([...select.options].map(o => o.textContent), ['Choose a connected member', 'Connected Bob']); // NEW
    [...panel.querySelectorAll('button')].find(b => b.textContent === 'Leave project').click(); await tick(); assert.equal(submitted, undefined); // NEW
    select.value = 'bob'; [...panel.querySelectorAll('button')].find(b => b.textContent === 'Leave project').click(); await tick(); await tick(); // NEW
    assert.equal(submitted.successorUserId, 'bob'); assert.match(f.ui.__trellisGardenHome.sharedRows.textContent, /Leaving/); assert.equal(root.querySelector('[data-project-focus="shared:open"]').disabled, true); // NEW
}); // NEW

test('cancelling deletion keeps the unsaved file and Save and move to Trash saves before the mutation', async () => { // NEW
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); const order = []; let dirty = true; // NEW
    const file = { fileObject: { path: '/garden' }, isModified: () => dirty, save(_force, success) { order.push('save'); dirty = false; success(); } }; f.setCurrent(file); // NEW
    f.window.trellisGardenLibrary.list = async () => ({ gardens: [{ diagramId: 'dirty', name: 'Draft', source: 'library', userCount: 1, available: true, path: '/garden' }] }); // NEW
    f.window.trellisGardenLibrary.actions = async () => ({ canDelete: true }); f.window.trellisGardenLibrary.trash = async () => { order.push('trash'); return { ok: true }; }; // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const root = f.window.document.querySelector('.trellis-projects-root'); // NEW
    root.querySelector('[data-project-focus="dirty:remove"]').click(); await tick(); [...f.ui.__trellisGardenHome.confirmation.panel.querySelectorAll('button')].find(b => b.textContent === 'Cancel').click(); assert.equal(f.ui.getCurrentFile(), file); assert.equal(dirty, true); assert.deepEqual(order, []); // NEW
    root.querySelector('[data-project-focus="dirty:remove"]').click(); await tick(); [...f.ui.__trellisGardenHome.confirmation.panel.querySelectorAll('button')].find(b => b.textContent === 'Save and move to Trash').click(); await tick(); await tick(); assert.deepEqual(order, ['save', 'trash']); // NEW
}); // NEW

test('remote retirement serializes a draft, detects intervening edits, and unfreezes on cancellation', async () => { // NEW
    const f = fixture(); let retiring, changed, enabled = true; f.window.trellisGardenLibrary.onRetiring = listener => { retiring = listener; }; // NEW
    const model = { addListener(_event, listener) { changed = listener; }, removeListener() {} }; f.ui.editor = { graph: { getModel: () => model, isEnabled: () => enabled, setEnabled: value => { enabled = value; } }, addListener() {} }; // NEW
    const file = { fileObject: { path: '/remote.drawio' }, isModified: () => true }; f.setCurrent(file); f.ui.getFileData = () => '<draft/>'; // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const prepared = await retiring({ phase: 'prepare', path: '/remote.drawio' }); // NEW
    assert.equal(prepared.xml, '<draft/>'); assert.equal(enabled, false); changed(); await assert.rejects(retiring({ phase: 'commit', path: '/remote.drawio' }), /changed/); // NEW
    assert.equal(f.ui.getCurrentFile(), file); await retiring({ phase: 'cancel' }); assert.equal(enabled, true); // NEW
}); // NEW

/** A single project keeps lifecycle cases focused on the real controls and bridge boundary. */ // CHANGE
async function removalFixture(overrides = {}, options) { // CHANGE
    const f = fixture(options); f.setSession({ identityId: 'alice', username: 'Alice' }); // CHANGE
    const project = { diagramId: 'garden', name: 'Apple garden', source: 'library', userCount: 1, available: true, path: '/garden', ...overrides }; // CHANGE
    f.window.trellisGardenLibrary.list = async () => ({ gardens: [project] }); // CHANGE
    f.window.trellisGardenLibrary.actions = async () => ({ canDelete: true }); // CHANGE
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); // CHANGE
    return { ...f, project, state: f.ui.__trellisGardenHome }; // CHANGE
} // CHANGE

test('library, identity, creation, and dynamic menu buttons reuse the production semantic contract', async () => { // CHANGE
    const f = await removalFixture({ canRename: true, canEditSuffix: true, projectName: 'Apple garden' }), root = f.state.projectsRoot; // CHANGE
    const find = label => [...root.querySelectorAll('button')].find(node => node.textContent === label); // CHANGE
    const variant = (label, expected) => assert.equal(find(label).getAttribute('data-trellis-button-variant'), expected, label); // CHANGE
    for (const node of root.querySelectorAll('button')) assert.ok(node.classList.contains('trellis-button'), node.textContent); // CHANGE
    variant('Open', 'open'); variant('Create New Private Garden Project', 'add'); variant('Move to Trash…', 'danger'); variant('Log out', 'close'); variant('Reload', 'neutral'); // CHANGE
    assert.equal(root.querySelector('.trellis-project-menu>summary').getAttribute('data-trellis-button-variant'), 'neutral'); // CHANGE
    assert.equal(find('Projects').classList.contains('trellis-button-active'), true); find('Trash').click(); await tick(); // CHANGE
    assert.equal(find('Projects').classList.contains('trellis-button-active'), false); assert.equal(find('Trash').getAttribute('aria-pressed'), 'true'); assert.equal(find('Trash').classList.contains('trellis-button-active'), true); // CHANGE
    find('Projects').click(); await tick(); find('Create New Private Garden Project').click(); // CHANGE
    assert.equal(root.querySelector('button[type=submit]').getAttribute('data-trellis-button-variant'), 'add'); find('Cancel').click(); // CHANGE
    find('Edit my suffix').click(); variant('Save suffix', 'add'); find('Cancel').click(); // CHANGE
    find('Identity settings').click(); find('Change password').click(); // CHANGE
    const form = f.state.panel.querySelector('form'); assert.equal(form.querySelector('button').getAttribute('data-trellis-button-variant'), 'add'); assert.equal(form.querySelector('button:last-child').getAttribute('data-trellis-button-variant'), 'close'); // CHANGE
}); // CHANGE

test('community creation and destructive community submissions have explicit variants', async () => { // CHANGE
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); // CHANGE
    f.window.trellisGardenCommunities = { onStatus() {}, listRequests: async () => ({ requests: [] }), list: async () => ({ communities: [{ id: 'community', name: 'Neighborhood', description: '', canAdminister: true, gardens: [{ diagramId: 'garden', name: 'Apple garden', description: '', joined: false }], admissions: [{ id: 'admission', name: 'New garden' }] }] }) }; // CHANGE
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome; // CHANGE
    const find = label => [...state.projectsRoot.querySelectorAll('button')].find(node => node.textContent === label); // CHANGE
    for (const [label, expected] of [['Create Garden Community', 'add'], ['Detach garden', 'danger'], ['Decline garden', 'danger'], ['Request access', 'add']]) { // CHANGE
        find(label).click(); assert.equal(state.actionPanel.querySelector('button[type=submit]').getAttribute('data-trellis-button-variant'), expected, label); // CHANGE
        [...state.actionPanel.querySelectorAll('button')].find(node => node.textContent === 'Cancel').click(); // CHANGE
    } // CHANGE
}); // CHANGE

test('lifecycle prompts retain functional host button fallbacks before the shared helper loads', async () => { // CHANGE
    const f = await removalFixture({}, { sharedButtons: false }); f.state.projectsRoot.querySelector('[data-project-focus="garden:remove"]').click(); await tick(); // CHANGE
    const panel = f.state.confirmation.panel; assert.equal(panel.querySelector('button').className, 'geBtn'); panel.querySelector('button:last-child').click(); assert.equal(f.ui.dialogs.length, 1); // CHANGE
}); // CHANGE

test('modal cancellation preserves the library, traps focus, and resolves refreshed origins', async () => { // CHANGE
    for (const dismissal of ['cancel', 'escape', 'close']) { // CHANGE
        const f = await removalFixture(), root = f.state.projectsRoot; // CHANGE
        const search = f.state.searchControl; search.value = 'Apple'; search.dispatchEvent(new f.window.Event('input')); // CHANGE
        root.querySelector('details[data-project-details="garden:locations"]').open = true; root.scrollTop = 123; // CHANGE
        root.querySelector('.trellis-project-menu').open = true; root.querySelector('[data-project-focus="garden:remove"]').click(); await tick(); // CHANGE
        const prompt = f.state.confirmation, cancel = prompt.controls.lastChild; assert.equal(f.ui.dialogs.length, 2); assert.equal(root.querySelector('.trellis-project-action'), null); assert.equal(root.inert, true); // CHANGE
        assert.equal(f.window.document.activeElement, cancel); assert.equal(prompt.panel.getAttribute('role'), 'alertdialog'); assert.equal(f.window.document.getElementById(prompt.panel.getAttribute('aria-labelledby')), prompt.heading); // CHANGE
        const key = (name, shiftKey = false) => f.window.document.activeElement.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true })); // CHANGE
        key('Tab'); assert.equal(f.window.document.activeElement, prompt.controls.firstChild); key('Tab', true); assert.equal(f.window.document.activeElement, cancel); // CHANGE
        search.focus(); assert.equal(f.window.document.activeElement, cancel); f.ui.dialog.bg.click(); assert.equal(f.state.confirmation, prompt); // CHANGE
        reloadProjects(f.ui.__trellisGardenHome); await tick(); assert.equal(f.window.document.activeElement, cancel); // CHANGE
        if (dismissal === 'cancel') cancel.click(); else if (dismissal === 'escape') key('Escape'); else f.ui.dialog.container.querySelector('.geButton').click(); // CHANGE
        await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(f.ui.dialogs.length, 1); assert.equal(f.ui.dialog.container.firstChild, root); assert.equal(root.inert, false); // CHANGE
        assert.equal(f.window.document.activeElement.getAttribute('data-project-focus'), 'garden:menu'); assert.equal(search.value, 'Apple'); assert.equal(root.scrollTop, 123); assert.equal(root.querySelector('details[data-project-details="garden:locations"]').open, true); // CHANGE
    } // CHANGE
}); // CHANGE

test('cancelling after the originating project disappears falls back to library search', async () => { // CHANGE
    const f = await removalFixture(); f.state.projectsRoot.querySelector('[data-project-focus="garden:remove"]').click(); await tick(); // CHANGE
    f.window.trellisGardenLibrary.list = async () => ({ gardens: [] }); await f.emitStatus({ session: await f.window.trellisIdentity.getSession() }); reloadProjects(f.state); await tick(); // CHANGE: status signals defer data changes until cadence or explicit refresh.
    f.state.confirmation.controls.lastChild.click(); await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(f.window.document.activeElement, f.state.searchControl); // CHANGE
}); // CHANGE

test('cancelled or identity-invalidated membership responses cannot modify another dialog', async () => { // CHANGE
    for (const invalidate of ['cancel', 'identity']) { // CHANGE
        const f = await removalFixture(); let release; f.window.trellisGardenLibrary.actions = () => new Promise(resolve => { release = resolve; }); // CHANGE
        f.state.projectsRoot.querySelector('[data-project-focus="garden:remove"]').click(); const panel = f.state.confirmation.panel; // CHANGE
        if (invalidate === 'cancel') f.state.confirmation.controls.lastChild.click(); else await f.emitStatus({ session: { identityId: 'bob', username: 'Bob' } }); // CHANGE
        const other = f.window.document.createElement('section'); f.ui.showDialog(other, 200, 100, true, true); release({ canDelete: true }); await tick(); // CHANGE
        assert.equal(panel.isConnected, false); assert.equal(f.ui.dialog.container.firstChild, other); assert.equal(other.textContent, ''); // CHANGE
    } // CHANGE
}); // CHANGE

test('membership failures and ineligible actions stay cancellable without exposing a destructive button', async () => { // CHANGE
    for (const fail of [false, true]) { // CHANGE
        const f = await removalFixture(); f.window.trellisGardenLibrary.actions = async () => { if (fail) throw new Error('Membership unavailable'); return { canDelete: false, canLeave: false, reason: 'No connected successor' }; }; // CHANGE
        f.state.projectsRoot.querySelector('[data-project-focus="garden:remove"]').click(); await tick(); const prompt = f.state.confirmation; // CHANGE
        assert.match(prompt.error.textContent, fail ? /Membership unavailable/ : /No connected successor/); assert.equal(prompt.controls.children.length, 1); prompt.controls.lastChild.click(); assert.equal(f.ui.dialogs.length, 1); // CHANGE
    } // CHANGE
}); // CHANGE

test('pending mutations block duplicate submission and dismissal; bridge failures remain retryable', async () => { // CHANGE
    const f = await removalFixture(); let reject, calls = 0; f.window.trellisGardenLibrary.trash = () => { calls++; return new Promise((_resolve, failure) => { reject = failure; }); }; // CHANGE
    f.state.projectsRoot.querySelector('[data-project-focus="garden:remove"]').click(); await tick(); const prompt = f.state.confirmation; // CHANGE
    prompt.controls.firstChild.click(); prompt.controls.firstChild.click(); prompt.controls.lastChild.click(); f.ui.dialog.container.querySelector('.geButton').click(); // CHANGE
    prompt.panel.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); // CHANGE
    assert.equal(calls, 1); assert.equal(prompt.busy, true); assert.equal(prompt.panel.getAttribute('aria-busy'), 'true'); assert.equal(f.ui.dialogs.length, 2); // CHANGE
    reject(new Error('Project is busy')); await tick(); assert.equal(prompt.busy, false); assert.match(prompt.error.textContent, /Project is busy/); assert.equal(prompt.controls.firstChild.disabled, false); // CHANGE
    f.window.trellisGardenLibrary.trash = async () => { calls++; return { ok: true }; }; prompt.controls.firstChild.click(); await tick(); // CHANGE
    assert.equal(calls, 2); assert.equal(f.state.confirmation, null); assert.equal(f.ui.dialogs.length, 1); // CHANGE
}); // CHANGE

test('save failures preserve the dirty editor; discard skips saving before moving to Trash', async () => { // CHANGE
    for (const discard of [false, true]) { // CHANGE
        const f = await removalFixture(); let saves = 0, moves = 0; const file = { fileObject: { path: '/garden' }, isModified: () => true, save(_force, _ok, fail) { saves++; fail(new Error('Disk full')); } }; f.setCurrent(file); // CHANGE
        f.window.trellisGardenLibrary.trash = async () => { moves++; return { ok: true }; }; f.state.projectsRoot.querySelector('[data-project-focus="garden:remove"]').click(); await tick(); // CHANGE
        const prompt = f.state.confirmation; (discard ? prompt.controls.children[1] : prompt.controls.firstChild).click(); await tick(); // CHANGE
        if (discard) { assert.equal(saves, 0); assert.equal(moves, 1); assert.equal(f.ui.getCurrentFile(), null); } // CHANGE
        else { assert.equal(saves, 1); assert.equal(moves, 0); assert.equal(f.ui.getCurrentFile(), file); assert.match(prompt.error.textContent, /Disk full/); assert.equal(prompt.controls.firstChild.disabled, false); } // CHANGE
    } // CHANGE
}); // CHANGE

test('a delayed save cannot authorize a mutation after the identity changes', async () => { // CHANGE
    const f = await removalFixture(); let finishSave, moves = 0; const file = { fileObject: { path: '/garden' }, isModified: () => true, save(_force, success) { finishSave = success; } }; f.setCurrent(file); // CHANGE
    f.window.trellisGardenLibrary.trash = async () => { moves++; return { ok: true }; }; f.state.projectsRoot.querySelector('[data-project-focus="garden:remove"]').click(); await tick(); // CHANGE
    f.state.confirmation.controls.firstChild.click(); await f.emitStatus({ session: null }); finishSave(); await tick(); assert.equal(moves, 0); assert.equal(f.ui.getCurrentFile(), file); assert.equal(f.state.confirmation, null); // CHANGE
}); // CHANGE

test('a delayed bridge completion cannot close the editor after identity invalidation', async () => { // CHANGE
    const f = await removalFixture(); let finishMove; const file = { fileObject: { path: '/garden' }, isModified: () => false }; f.setCurrent(file); // CHANGE
    f.window.trellisGardenLibrary.trash = () => new Promise(resolve => { finishMove = resolve; }); f.state.projectsRoot.querySelector('[data-project-focus="garden:remove"]').click(); await tick(); // CHANGE
    f.state.confirmation.controls.firstChild.click(); await f.emitStatus({ session: null }); finishMove({ ok: true }); await tick(); assert.equal(f.ui.getCurrentFile(), file); assert.equal(f.state.confirmation, null); // CHANGE
}); // CHANGE

test('editor changes invalidate an unsubmitted prompt and a delayed save cannot retire a replacement document', async () => { // CHANGE
    for (const saving of [false, true]) { // CHANGE
        const f = fixture(); let onFileLoaded, finishSave, moves = 0; // CHANGE
        f.ui.editor = { addListener(name, callback) { if (name === 'fileLoaded') onFileLoaded = callback; } }; // CHANGE
        const original = { fileObject: { path: '/garden' }, isModified: () => saving, save(_force, success) { finishSave = success; } }, replacement = { isModified: () => true }; f.setCurrent(original); // CHANGE
        f.setSession({ identityId: 'alice', username: 'Alice' }); f.window.trellisGardenLibrary.list = async () => ({ gardens: [{ diagramId: 'garden', name: 'Apple garden', source: 'library', userCount: 1, available: true, path: '/garden' }] }); // CHANGE
        f.window.trellisGardenLibrary.actions = async () => ({ canDelete: true }); f.window.trellisGardenLibrary.trash = async () => { moves++; return { ok: true }; }; // CHANGE
        f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome; state.projectsRoot.querySelector('[data-project-focus="garden:remove"]').click(); await tick(); // CHANGE
        if (saving) state.confirmation.controls.firstChild.click(); f.setCurrent(replacement); onFileLoaded(); if (saving) finishSave(); await tick(); // CHANGE
        assert.equal(moves, 0); assert.equal(f.ui.getCurrentFile(), replacement); assert.equal(state.confirmation, null); assert.equal(f.ui.dialogs.length, 1); // CHANGE
    } // CHANGE
}); // CHANGE

test('retiring the current editor suppresses its automatic splash and leaves only the library', async () => { // CHANGE
    for (const remoteCommit of [false, true]) { // CHANGE
        const f = fixture(); let retiring, suppressed; f.window.trellisGardenLibrary.onRetiring = listener => { retiring = listener; }; // CHANGE
        const file = { fileObject: { path: '/garden' }, isModified: () => false }; f.setCurrent(file); f.setSession({ identityId: 'alice', username: 'Alice' }); // CHANGE
        f.ui.fileLoaded = (value, noDialogs) => { suppressed = noDialogs; f.setCurrent(value); if (!value && !noDialogs) f.ui.showDialog(f.window.document.createElement('section'), 200, 100, true, true); }; // CHANGE
        f.window.trellisGardenLibrary.list = async () => ({ gardens: [{ diagramId: 'garden', name: 'Apple garden', source: 'library', userCount: 1, path: '/garden', available: true }] }); // CHANGE
        f.window.trellisGardenLibrary.actions = async () => ({ canDelete: true }); // CHANGE
        f.window.trellisGardenLibrary.trash = async () => { if (remoteCommit) { await retiring({ phase: 'prepare', path: '/garden' }); await retiring({ phase: 'commit', path: '/garden' }); } return { ok: true }; }; // CHANGE
        f.window.TrellisGardenHome.showProjects(f.ui); await tick(); const state = f.ui.__trellisGardenHome; state.projectsRoot.querySelector('[data-project-focus="garden:remove"]').click(); await tick(); // CHANGE
        state.confirmation.controls.firstChild.click(); await tick(); assert.equal(suppressed, true); assert.equal(f.ui.dialogs.length, 1); assert.equal(f.ui.dialog.container.firstChild, state.projectsRoot); assert.equal(state.confirmation, null); // CHANGE
    } // CHANGE
}); // CHANGE

test('standalone Trash works while signed out and names its device-only consequences', async () => { // CHANGE
    const f = fixture(); let payload; f.window.trellisGardenLibrary.listLocal = async () => ({ folder: '/local', gardens: [{ source: 'local', name: 'Standalone', path: '/local/file.drawio', available: true }] }); // CHANGE
    f.window.trellisGardenLibrary.trash = async input => { payload = input; return { ok: true }; }; f.window.TrellisGardenHome.showProjects(f.ui); await tick(); // CHANGE
    const state = f.ui.__trellisGardenHome; state.projectsRoot.querySelector('[data-project-focus="/local/file.drawio:remove"]').click(); await tick(); // CHANGE
    assert.match(state.confirmation.description.textContent, /on this device.*Neighboring files and assets/); state.confirmation.controls.firstChild.click(); await tick(); // CHANGE
    assert.equal(payload.path, '/local/file.drawio'); assert.equal(payload.source, 'local'); assert.equal(payload.confirm, true); // CHANGE
}); // CHANGE

test('permanent deletion uses explicit modal confirmation and retains local and paired-device copy', async () => { // CHANGE
    for (const source of ['local', 'library']) { // CHANGE
        const f = await removalFixture(); let payload, calls = 0; f.window.trellisGardenLibrary.listTrash = async () => ({ gardens: [{ trashId: 'retained', diagramId: 'garden', name: 'Retained Apple garden', source }] }); // CHANGE
        f.window.trellisGardenLibrary.purge = async input => { calls++; payload = input; if (calls === 1) throw new Error('Retry deletion'); return { ok: true }; }; // CHANGE
        f.state.projectLoadHeaders.trash.reload.click(); await tick(); await f.state.setProjectView('trash'); f.state.trashRows.querySelector('[data-project-focus="retained:purge"]').click(); const prompt = f.state.confirmation; // CHANGE
        assert.match(prompt.heading.textContent, /Retained Apple garden/); assert.match(prompt.description.textContent, source === 'local' ? /retained local file/ : /paired devices/); assert.equal(prompt.panel.querySelector('input'), null); // CHANGE
        assert.equal(f.window.document.activeElement, prompt.controls.lastChild); assert.equal(prompt.controls.firstChild.getAttribute('data-trellis-button-variant'), 'danger'); // CHANGE
        prompt.controls.firstChild.click(); await tick(); assert.match(prompt.error.textContent, /Retry deletion/); prompt.controls.firstChild.click(); await tick(); // CHANGE
        assert.equal(payload.confirm, true); assert.equal(payload.trashId, 'retained'); assert.equal(f.state.confirmation, null); assert.equal(f.ui.dialogs.length, 1); // CHANGE
    } // CHANGE
}); // CHANGE

/** Guide requests are scoped to an existing project and preserve live project-browser forms. */ // NEW
async function quickstartProjectFixture() {
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' });
    const records = [], token = { diagramId: 'target' };
    f.ui.editor = { graph: { __trellisQuickstart: { capture: () => token, record: (kind, captured) => records.push({ kind, captured }) } } };
    f.window.trellisGardenLibrary.list = async () => ({ gardens: [
        { diagramId: 'first', name: 'First project', available: true, canRename: true, source: 'library' },
        { diagramId: 'target', name: 'Current project', available: true, canRename: true, source: 'library' }
    ] });
    f.window.trellisGardenCommunities = { onStatus() {}, listRequests: async () => ({ requests: [] }), list: async () => ({ communities: [
        { id: 'community', name: 'Neighborhood', description: '', gardens: [{ diagramId: 'unrelated', name: 'Other garden', description: '', joined: false }], admissions: [] }
    ] }) };
    f.window.TrellisGardenHome.showProjects(f.ui, { highlight: 'community-sharing', diagramId: 'target' }); await tick();
    return { ...f, records, state: f.ui.__trellisGardenHome };
}

test('quickstart highlights communities after loading and reuses open dialogs without losing drafts or focus', async () => { // NEW
    const f = await quickstartProjectFixture(), original = f.state.projectsRoot;
    assert.equal(original.dataset.quickstartSurface, 'projects');
    f.window.TrellisGardenHome.showProjects(f.ui, { highlight: 'community-sharing', diagramId: 'target', communityPath: 'create' });
    const create = original.querySelector('[data-trellis-quickstart="community-sharing"]'); assert.equal(create.textContent, 'Create Garden Community'); create.click();
    const form = f.state.actionPanel.querySelector('form'), name = form.querySelector('input[aria-label="Community name"]'); name.value = 'My unsent community'; name.focus();
    assert.equal(form.querySelector('select').value, 'target');
    f.window.TrellisGardenHome.showProjects(f.ui, { highlight: 'community-sharing', diagramId: 'target', communityPath: 'existing' }); await tick();
    assert.equal(f.state.projectsRoot, original); assert.equal(f.state.actionPanel.querySelector('form'), form); assert.equal(name.value, 'My unsent community'); assert.equal(f.window.document.activeElement, name);
    f.ui.hideDialog(); assert.equal(f.state.quickstartHighlight, null);
});

test('both community paths preselect the requested project and record only successful submission', async () => { // NEW
    for (const route of ['create', 'existing']) {
        const f = await quickstartProjectFixture(); let sent, fail = true;
        const action = async payload => { sent = payload; if (fail) throw new Error('Try again'); return { status: 'pending' }; };
        f.window.trellisGardenCommunities.create = action; f.window.trellisGardenCommunities.addGarden = action;
        if (route === 'create') f.state.creationButtons.find(node => node.dataset.quickstartProjectKind === 'communities').click();
        else { const group = f.state.communitiesRows.querySelector('details'); group.open = true; group.querySelector('[data-quickstart-community-add]').click(); }
        const form = f.state.actionPanel.querySelector('form');
        assert.equal(form.querySelector('select').value, 'target');
        const name = form.querySelector('input[aria-label="Community name"]'); if (name) name.value = 'Shared neighborhood';
        form.requestSubmit(); await tick(); assert.match(form.textContent, /Try again/); assert.equal(f.records.length, 0);
        fail = false; form.requestSubmit(); await tick(); assert.equal(sent.diagramId, 'target'); assert.equal(f.records.length, 1); assert.equal(f.records[0].kind, 'community');
    }
});

test('community guide requests are cleared on identity changes', async () => { // NEW
    const f = await quickstartProjectFixture(); f.setSession({ identityId: 'bob', username: 'Bob' }); await f.emitStatus({ session: { identityId: 'bob', username: 'Bob' } }); await tick();
    assert.equal(f.state.quickstartHighlight, null);
});

test('switching community paths during a descriptor read retains its completion and pending project selection', async () => { // NEW
    const f = await quickstartProjectFixture(); let release;
    f.window.trellisGardenLibrary.list = async options => options?.diagramId === 'late' ? new Promise(resolve => { release = resolve; }) : { gardens: [] };
    f.window.TrellisGardenHome.showProjects(f.ui, { highlight: 'community-sharing', diagramId: 'late' }); await tick();
    const request = f.state.quickstartHighlight; assert.equal(request.loading, true);
    f.window.TrellisGardenHome.showProjects(f.ui, { highlight: 'community-sharing', diagramId: 'late', communityPath: 'create' });
    assert.equal(f.state.quickstartHighlight, request);
    f.state.creationButtons.find(node => node.dataset.quickstartProjectKind === 'communities').click();
    const form = f.state.actionPanel.querySelector('form'), select = form.querySelector('select');
    assert.equal(select.value, 'late'); assert.equal(select.selectedOptions[0].disabled, true); assert.equal(form.querySelector('[type=submit]').disabled, true);
    release({ gardens: [{ diagramId: 'late', name: 'Loaded current garden', available: true, canRename: true, source: 'library' }] }); await tick(); await tick();
    assert.equal(request.loading, false); assert.equal(select.value, 'late'); assert.equal(select.selectedOptions[0].disabled, false); assert.equal(form.querySelector('[type=submit]').disabled, false);
});
