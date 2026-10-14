// NEW: Splash placement and safe opening use the production home module.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
function fixture() {
    const dom = new JSDOM('<body><div id="splash" class="trellis-splash-root"><div class="trellis-splash-center"><div class="trellis-license-contact-panel">License</div></div><div class="trellis-splash-actions"><button>Create New Garden</button><button>Open Existing Garden</button><button>Explore &amp; Support My Projects</button></div></div></body>', { runScripts: 'outside-only' });
    const window = dom.window, calls = [], actions = new Map();
    let current = null, session = null, statusListener; // CHANGE: exercise actual background session invalidation.
    window.trellisIdentity = { list: async () => ({ identities: [], session }), getSession: async () => session, onStatus(listener) { statusListener = listener; }, onLocked() {} }; // CHANGE
    window.trellisGardenLibrary = { list: async () => ({ gardens: [] }), listLocal: async () => ({ gardens: [], folder: '/local' }), cities: async () => ({ cities: [] }), getReferenceCity: async () => ({ city: null }) }; // CHANGE
    window.mxResources = { get: key => key };
    window.mxUtils = { parseXml: text => new window.DOMParser().parseFromString(text, 'text/xml') };
    window.LocalFile = class { constructor(ui, data, name) { this.data = data; this.name = name; } setModified(value) { this.modified = value; } };
    const ui = { pickFile() { calls.push('local-picker'); }, actions: { get: id => actions.get(id), addAction(id, funct) { const action = { funct }; actions.set(id, action); return action; } }, menus: { get: () => null }, getCurrentFile: () => current, showSplash() {}, hideDialog() { calls.push('hide'); }, fileLoaded(file) { calls.push(['loaded', file]); current = file; }, confirm(_text, cancel, ok) { ok(); }, readGraphFile(success, error, filename) { error(new Error('Missing ' + filename)); }, handleError() {} };
    const splash = dom.window.document.getElementById('splash'); // NEW
    ui.showSplash = () => dom.window.document.body.append(splash); // NEW
    ui.showDialog = (panel, _w, _h, _modal, _closable, onClose) => { const container = dom.window.document.createElement('div'); container.className = 'geDialog'; container.append(panel); dom.window.document.body.append(container); ui.dialog = { container }; ui.onClose = onClose; }; // NEW
    ui.hideDialog = cancel => { calls.push('hide'); if (ui.dialog) { const close = ui.onClose; ui.dialog.container.remove(); ui.dialog = null; ui.onClose = null; close?.(cancel); } else splash.remove(); }; // NEW
    actions.set('new', { funct: () => calls.push('new') }); // NEW
    window.eval(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-garden-home.js'), 'utf8'));
    return { dom, window, ui, calls, setCurrent: value => { current = value; }, setSession: value => { session = value; }, emitStatus: value => statusListener(value) }; // CHANGE
}
test('splash displays status after license, preserves launch buttons, and gates incomplete licenses', async () => { // CHANGE
    const f = fixture(), container = f.window.document.getElementById('splash'); // CHANGE
    f.window.TrellisGardenHome.attachSplash({ container, isTrellisLicenseWizardComplete: () => false }, f.ui); // CHANGE
    assert.equal(container.querySelector('.trellis-splash-login-status'), null); // CHANGE
    const splash = { container, isTrellisLicenseWizardComplete: () => true }; // CHANGE
    f.window.TrellisGardenHome.attachSplash(splash, f.ui); await new Promise(resolve => setImmediate(resolve)); // CHANGE
    assert.equal(container.querySelector('.trellis-splash-login-status').textContent, 'Not logged in'); // CHANGE
    assert.equal(container.querySelector('.trellis-home-panel'), null); // CHANGE
    assert.match(container.textContent, /Create New Garden Project.*Open Existing Garden Project.*Explore & Support My Projects.*Create local diagram/); // CHANGE
    f.window.TrellisGardenHome.attachSplash(splash, f.ui); // CHANGE
    assert.equal(container.querySelectorAll('.trellis-splash-login-status').length, 1); // CHANGE
    assert.equal(container.querySelectorAll('.trellis-splash-local-create').length, 1); // CHANGE
}); // CHANGE

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
            assert.equal(password.value, ''); assert.match(f.window.document.querySelector('.trellis-home-panel').textContent, /Logged in as Alice/); // NEW
            assert.equal(f.window.document.querySelector('[role=status]').textContent, warning); // NEW
            f.find('Refresh').click(); await f.tick(); // NEW
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
test('Create and Open splash buttons reuse the dialog with different focus and preserve its origin', async () => { // NEW
    for (const intent of ['create', 'open']) { // NEW
        const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); // NEW
        const container = f.window.document.getElementById('splash'); f.window.TrellisGardenHome.attachSplash({ container, isTrellisLicenseWizardComplete: () => true }, f.ui); await tick(); // NEW
        container.querySelector('[data-project-launcher=' + intent + ']').click(); await tick(); // NEW
        assert.equal(f.window.document.querySelectorAll('.trellis-projects-root').length, 1); // NEW
        assert.equal(f.ui.__trellisGardenHome.focus, intent); // NEW
        if (intent === 'create') assert.equal(f.window.document.activeElement.textContent, 'Create New Shared Garden Project'); // NEW
        f.ui.__trellisGardenHome.projectsRoot.querySelector('.trellis-home-row:last-child button:last-child').click(); await new Promise(resolve => setTimeout(resolve, 10)); // NEW
        assert.equal(f.window.document.querySelector('.trellis-projects-root'), null); assert.ok(f.window.document.getElementById('splash')); // NEW
    } // NEW
}); // NEW
test('local creation uses the existing new action after draft protection', async () => { // NEW
    const f = fixture(), container = f.window.document.getElementById('splash'); // NEW
    f.window.TrellisGardenHome.attachSplash({ container, isTrellisLicenseWizardComplete: () => true }, f.ui); await tick(); // NEW
    f.setCurrent({ isModified: () => true }); f.ui.confirm = (_text, cancel) => cancel(); // NEW
    container.querySelector('.trellis-splash-local-create').click(); await tick(); assert.deepEqual(f.calls, []); // NEW
    f.ui.confirm = (_text, _cancel, ok) => ok(); container.querySelector('.trellis-splash-local-create').click(); await tick(); assert.deepEqual(f.calls, ['hide', 'new']); // NEW
}); // NEW
test('shared bands, private sources, deduplication, and Unknown seeds are rendered without nested lists', async () => { // NEW
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
    assert.deepEqual([...shared.querySelectorAll('h4')].map(node => node.textContent), ['Under 25 km', '100–500 km', 'Unknown distance']); // NEW
    assert.match(shared.textContent, /2 users · 3 seeds/); assert.match(shared.textContent, /Seeds: Unknown/); // NEW
    assert.match(f.ui.__trellisGardenHome.privateRows.textContent, /Local file.*On this computer.*Private library.*Identity library/); // NEW
    assert.equal(root.textContent.includes('Duplicate project identity'), false); assert.equal(root.textContent.includes('Duplicate file'), false); // CHANGE assert.equal(root.querySelector('.trellis-home-list'), null); // NEW
    const protocol = f.window.TrellisGardenHome; assert.deepEqual([0, 25, 100, 500, null].map(protocol.distanceBand), [0, 1, 2, 3, 4]); // NEW
}); // NEW
test('availability refresh preserves search input, row focus, expanded details, scroll, and login form input', async () => { // NEW
    const f = await loginFixture(), state = f.ui.__trellisGardenHome; // NEW
    f.window.trellisGardenLibrary.listLocal = async () => ({ folder: '/local', gardens: [{ path: '/local/a', name: 'Apple', source: 'local', available: true }] }); // NEW
    f.find('Refresh').click(); await tick(); // NEW
    const search = f.window.document.querySelector('input[aria-label="Search garden projects"]'); search.value = 'App'; search.dispatchEvent(new f.window.Event('input')); // NEW
    const details = state.privateRows.querySelector('details'); details.open = true; // NEW
    const open = state.privateRows.querySelector('button'); open.focus(); state.projectsRoot.scrollTop = 123; // NEW
    f.find('Refresh').click(); await tick(); assert.equal(f.window.document.activeElement.getAttribute('data-project-focus'), '/local/a:open'); // NEW
    assert.equal(search.value, 'App'); assert.equal(state.privateRows.querySelector('details').open, true); assert.equal(state.projectsRoot.scrollTop, 123); // NEW
    f.find('Log in').click(); const password = f.window.document.querySelector('input[type=password]'); password.value = 'keep typing'; // NEW
    await f.emitStatus({ session: null }); await tick(); assert.equal(password.isConnected, true); assert.equal(password.value, 'keep typing'); // NEW
}); // NEW
test('a failed identity library does not hide signed-out-capable local browsing', async () => { // NEW
    const f = fixture(); f.setSession({ identityId: 'alice', username: 'Alice' }); // NEW
    f.window.trellisGardenLibrary.list = async () => { throw new Error('Metadata unavailable'); }; // NEW
    f.window.trellisGardenLibrary.listLocal = async () => ({ folder: '/local', gardens: [{ path: '/local/a', name: 'Local project', source: 'local', available: true }] }); // NEW
    f.window.TrellisGardenHome.showProjects(f.ui); await tick(); // NEW
    assert.match(f.ui.__trellisGardenHome.privateRows.textContent, /Local project/); assert.match(f.ui.__trellisGardenHome.projectsStatus.textContent, /Metadata unavailable/); // NEW
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
test('an older empty project is opened without starter initialization', async () => { // NEW
    const f = await loginFixture(), mechanics = creationMechanics(f); f.setSession({ identityId: 'alice', username: 'Alice' }); // NEW
    f.window.trellisGardenLibrary.list = async () => ({ gardens: [{ diagramId: 'old', name: 'Old empty', path: '/old', source: 'library', available: true, starterPending: false, classification: 'private', conflicts: [] }] }); // NEW
    await f.emitStatus({ session: await f.window.trellisIdentity.getSession() }); await tick(); f.find('Open').click(); await tick(); // NEW
    assert.equal(f.ui.getCurrentFile().fileObject.path, '/old'); assert.equal(mechanics.seeded.length, 0); // NEW
}); // NEW
