/** Offline field views and signed package transport; no complete diagram is loaded. // NEW */
import { openStore } from './field-store.js';
const p = globalThis.TrellisFieldProtocol, identity = globalThis.TrellisIdentityProtocol;
const native = globalThis.Capacitor?.registerPlugin ? globalThis.Capacitor.registerPlugin('TrellisSync') : globalThis.Capacitor?.Plugins?.TrellisSync;
const db = await openStore();
let account = null, unlocked = null, works = [], current = null, tab = 'work', filter = 'today', search = '', selectedTaskId = null, busy = false, accounts = []; // CHANGE: selection follows the task's current planting-group links after package refresh.
const main = document.getElementById('main'), status = document.getElementById('status');
const node = (tag, text) => { const value = document.createElement(tag); if (text != null) value.textContent = text; return value; };
const day = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function button(label, action) { const value = node('button', label); value.addEventListener('click', () => Promise.resolve(action()).catch(error => { status.textContent = error.message; })); return value; }
function field(label, type = 'text') { const wrap = node('label'), input = node('input'); input.type = type; wrap.append(node('span', label), input); return { wrap, input }; }
const recordKey = (work, installed = account) => 'work:' + installed.identityId + ':' + work.diagramId + ':' + work.workerId; // CHANGE: asynchronous work retains its owning identity after a selection change.
async function nativeCall(method, payload = {}) { if (!native) throw new Error('Native synchronization is available in the Android app.'); return native[method](payload); }
async function exportJson(value, filename) { await nativeCall('exportFile', { text: JSON.stringify(value, null, 2), filename }); }
async function importJson() { const result = await nativeCall('importFile'); return result.canceled ? null : JSON.parse(result.text); }
async function login(password) {
    const reduced = await identity.reduceEvents(account.events, account.identityId);
    if (!reduced.devices.some(device => device.id === account.deviceId)) throw new Error('This device was removed from the identity.');
    let vaultKey;
    for (const head of reduced.passwordHeads) {
        try { vaultKey = await identity.unlockPassword(head.payload.credential, password, account.identityId + ':' + head.payload.id); break; } catch (_) { }
    }
    if (!vaultKey) throw new Error('Incorrect password.');
    const privateKey = await identity.open(account.vault, vaultKey, account.identityId + ':' + account.deviceId); vaultKey.fill(0);
    unlocked = { privateKey }; status.textContent = reduced.passwordHeads.length > 1 ? 'Password conflict: resolve it on a paired desktop. Field work remains available.' : '';
    await loadWorks(); render();
}
async function loadWorks() {
    const installed = account, loaded = []; // CHANGE: do not expose another identity's partial library while awaiting IndexedDB.
    for (const key of await db.get('work-index:' + installed.identityId) || []) { const record = await db.get(key); if (record) loaded.push(record); } // CHANGE
    if (account !== installed) return; works = loaded; // NEW
    if (!current || !works.some(record => record.work.diagramId === current.work.diagramId)) current = works[0] || null;
    else current = works.find(record => record.work.diagramId === current.work.diagramId);
}
async function setupRequest() {
    const transport = await nativeCall('createRequest');
    const exchange = await identity.keyPair('ECDH'), signer = await identity.keyPair(), deviceId = crypto.randomUUID();
    const request = { schema: 1, kind: 'identity-request', requestId: transport.requestId, device: { id: deviceId, publicKey: signer.publicKey, syncthingId: transport.syncthingId, name: 'Android field companion', kind: 'android' }, exchangeKey: exchange.publicKey, expiresAt: Date.now() + 14 * 86400000 };
    const protectedKeys = await nativeCall('protectPending', { text: JSON.stringify({ exchange: exchange.privateKey, signer: signer.privateKey }) });
    await db.put('request:' + request.requestId, { request, protectedKeys });
    await exportJson(await identity.sign(request, signer.privateKey), 'trellis-android-request.json');
    status.textContent = 'Approve this request on an existing desktop, then import its setup package here.';
}
async function importSetup(password) {
    const setup = await importJson(); if (!setup) return;
    const data = setup.payload;
    if (data?.schema !== 1 || data.kind !== 'identity-setup' || data.expiresAt <= Date.now()) throw new Error('Setup package is invalid or expired.');
    const pending = await db.get('request:' + data.requestId);
    if (!pending || pending.request.device.id !== data.targetDeviceId) throw new Error('Setup belongs to another device request.');
    const secrets = JSON.parse((await nativeCall('unprotectPending', pending.protectedKeys)).text);
    const key = await identity.sharedKey(secrets.exchange, data.exchangeKey);
    const content = await identity.open(data.envelope, key, data.requestId + ':' + data.targetDeviceId); key.fill(0);
    const reduced = await identity.reduceEvents(content.records, data.identityId), author = reduced.devices.find(device => device.id === data.author), target = reduced.devices.find(device => device.id === data.targetDeviceId);
    if (!author || !target || identity.canonical(target.publicKey) !== identity.canonical(pending.request.device.publicKey) || !await identity.verify(setup, author.publicKey)) throw new Error('Setup approval is invalid.');
    let vaultKey;
    for (const head of reduced.passwordHeads) { try { vaultKey = await identity.unlockPassword(head.payload.credential, password, data.identityId + ':' + head.payload.id); break; } catch (_) { } }
    if (!vaultKey) throw new Error('Incorrect identity password.');
    const installed = await db.get('account:' + data.identityId);
    if (installed && installed.deviceId !== data.targetDeviceId) throw new Error('This identity is already installed; setup will not overwrite it.');
    account = { identityId: data.identityId, deviceId: data.targetDeviceId, username: reduced.username, genesisHash: await identity.fingerprint(reduced.genesis), events: content.records, vault: await identity.seal(secrets.signer, vaultKey, data.identityId + ':' + data.targetDeviceId) }; vaultKey.fill(0);
    await db.put('account:' + account.identityId, account);
    await db.update('accounts', values => [...new Set([...(values || []), account.identityId])]);
    accounts = await Promise.all((await db.get('accounts')).map(id => db.get('account:' + id))); // NEW
    await db.put('selected-account', account.identityId);
    await nativeCall('configureIdentity', { identityId: account.identityId, requestId: data.requestId, devices: reduced.devices });
    for (const event of content.records) await nativeCall('writeRecord', { identityId: account.identityId, relative: 'events/' + event.payload.id + '.json', text: JSON.stringify(event) });
    await login(password); await sync();
}
async function acceptWork(incoming, installed = account) { // CHANGE
    const work = p.validateWork(incoming), key = recordKey(work, installed); // CHANGE
    await db.update(key, old => { // CHANGE: package refresh and local editing must serialize in one IndexedDB transaction.
        if (old && old.work.exportedAt > work.exportedAt) return old; // CHANGE
        const pending = old?.pending || { schema: 1, kind: 'task-updates', diagramId: work.diagramId, workerId: work.workerId, operations: [] }; // CHANGE
        const refreshed = p.refreshWork(work, pending); // CHANGE
        return { work, pending: refreshed.pending, display: refreshed.work, queued: old?.queued || [], lastSaved: old?.lastSaved || null }; // CHANGE: keep desktop acknowledgments separate from the optimistic local overlay.
    }); // CHANGE
    await db.update('work-index:' + installed.identityId, keys => [...new Set([...(keys || []), key])]); // CHANGE
}
async function signUpdates(updates, installed = account, credentials = unlocked) { // CHANGE
    const reduced = await identity.reduceEvents(installed.events, installed.identityId); // CHANGE
    if (account !== installed || unlocked !== credentials || !credentials?.privateKey) throw new Error('Log in again before signing field updates.'); // NEW
    return identity.sign({ schema: 1, id: crypto.randomUUID(), identityId: installed.identityId, author: installed.deviceId, kind: 'task-updates', time: Date.now(), identityHeads: reduced.heads, updates }, credentials.privateKey); // CHANGE
}
/** Restore other installed transports from public approvals; their vaults and field libraries stay locked. */ // NEW
async function resumeBackgroundTransfers(selectedIdentityId) { // NEW
    const failures = []; // NEW
    for (const installed of accounts) { // NEW
        if (!installed || installed.identityId === selectedIdentityId) continue; // NEW
        try { // NEW
            const saved = await db.get('account:' + installed.identityId), reduced = await identity.reduceEvents(saved.events, saved.identityId); // NEW: a prior selected session may have received newer public approval events.
            if (await identity.fingerprint(reduced.genesis) !== saved.genesisHash) throw new Error('Identity trust anchor changed.'); // NEW
            if (!reduced.devices.some(device => device.id === saved.deviceId)) continue; // NEW: removed local devices cannot restore a transport.
            await nativeCall('configureIdentity', { identityId: saved.identityId, devices: reduced.devices }); // NEW: native files already contain the signed outbox; restoring needs no signing credential.
        } catch (_) { failures.push(installed.username); } // NEW: one damaged or unavailable identity cannot stop another identity's transfers.
    } // NEW
    return failures; // NEW
} // NEW
async function sync() {
    if (!account || busy) return;
    busy = true;
    const installed = account, credentials = unlocked, stillCurrent = () => account === installed && unlocked === credentials; // NEW: public transport can finish, but library display and signing belong to the initiating session.
    const previousPackageId = current?.work.packageId; // NEW: unchanged polls must not reset the garden's pan and zoom.
    try {
        const incoming = await nativeCall('readRecords', { identityId: installed.identityId }); // CHANGE
        if (!Array.isArray(incoming.records)) throw new Error('Synchronization returned an invalid record list.'); // NEW
        const records = incoming.records.map(record => ({ ...record, value: JSON.parse(record.text) })); // CHANGE
        const events = records.filter(record => record.relative.startsWith('events/')).map(record => record.value);
        const reduced = await identity.reduceEvents([...installed.events, ...events], installed.identityId); // CHANGE
        if (await identity.fingerprint(reduced.genesis) !== installed.genesisHash) throw new Error('Identity trust anchor changed.'); // CHANGE
        installed.events = reduced.records; await db.put('account:' + installed.identityId, installed); // CHANGE
        if (!reduced.devices.some(device => device.id === installed.deviceId)) { if (account === installed) { unlocked = null; render(); } throw new Error('This device was removed.'); } // CHANGE
        await nativeCall('configureIdentity', { identityId: installed.identityId, devices: reduced.devices }); // CHANGE
        if (!stillCurrent()) return; // NEW
        const approved = new Map(reduced.records.filter(record => record.payload.device).map(record => [record.payload.device.id, record.payload.device.publicKey]));
        if (unlocked) for (const record of records.filter(record => record.relative.includes('/work/'))) {
            const value = record.value, key = approved.get(value.payload?.author);
            if (!key || value.payload.identityId !== installed.identityId || value.payload.kind !== 'field-work' || !await identity.verify(value, key)) throw new Error('Field-work signature is invalid.'); // CHANGE
            if (!stillCurrent()) return; await acceptWork(value.payload.work, installed); // CHANGE
        }
        if (credentials && stillCurrent()) { // CHANGE
            await loadWorks();
            if (!stillCurrent()) return; // NEW
            for (const record of works) {
                const queued = record.queued || []; // NEW: writing an outbox record is not proof of remote delivery.
                const fresh = record.pending.operations.filter(op => !queued.includes(op.id)); // NEW
                if (!fresh.length) continue; // CHANGE: don't create another signed file every poll.
                const signed = await signUpdates({ ...record.pending, operations: fresh }, installed, credentials); // CHANGE
                if (!stillCurrent()) return; // NEW
                await nativeCall('writeRecord', { identityId: installed.identityId, relative: 'field/' + record.work.diagramId + '/' + record.work.workerId + '/updates/' + signed.payload.id + '.json', text: JSON.stringify(signed) }); // CHANGE
                await db.update(recordKey(record.work, installed), value => ({ ...value, queued: [...new Set([...(value.queued || []), ...fresh.map(op => op.id)])] })); // CHANGE
                if (!stillCurrent()) return; // NEW
            }
            await loadWorks();
            if (!stillCurrent()) return; // NEW
            if (!document.activeElement?.matches('input') && (tab !== 'garden' || current?.work.packageId !== previousPackageId)) render(); // CHANGE: replace the map only when a new package changes its contents.
            status.textContent = incoming.waitingForWifi ? 'Waiting for Wi-Fi. Edits remain saved on this device.' : incoming.networkAvailable === false ? 'Offline. Edits remain saved on this device until synchronization resumes.' : 'Sync available. Changes remain pending until desktop acknowledges them.'; // CHANGE: a blocked transport still permits verified cached work and signed local outbox writes.
        }
    } catch (error) { if (account === installed) status.textContent = 'Sync pending: ' + error.message + ' Your edits remain saved on this device.'; } // CHANGE: a late error belongs to its original identity.
    finally { // CHANGE
        const failures = await resumeBackgroundTransfers(account?.identityId); // NEW: restore every installation's background transfers after restart or Wi-Fi reconnection, including while logged out.
        if (failures.length) status.textContent += ' Background synchronization pending for ' + failures.join(', ') + '.'; // NEW
        busy = false; // CHANGE
    } // CHANGE
}
async function editTask(taskId, name, value) {
    if (!unlocked || !current) throw new Error('Log in before editing field work.');
    const installed = account, credentials = unlocked, key = recordKey(current.work, installed), counterKey = 'counter:' + installed.identityId + ':' + installed.deviceId; // CHANGE
    await db.recordOperation(counterKey, key, counter => ({ id: installed.deviceId + ':' + counter, taskId, field: name, value, version: { time: Date.now(), deviceId: installed.deviceId, counter } }), (work, pending) => p.refreshWork(work, pending).work); // CHANGE: the transaction allocates the initiating identity's counter even if selection changes before it commits.
    if (account !== installed || unlocked !== credentials) return; await loadWorks(); // NEW
    if (account !== installed || unlocked !== credentials) return; render(); // CHANGE: a completed local save cannot replace another identity's screen.
    await sync(); // NEW: queue a signed update immediately while credentials are unlocked; the native engine can deliver it after logout.
}
function renderLogin() {
    main.replaceChildren();
    if (accounts.length > 1) { // NEW: mobile libraries stay isolated when a shared phone switches identity.
        const select = node('select'); for (const installed of accounts) { const option = node('option', installed.username); option.value = installed.identityId; select.append(option); } // NEW
        select.value = account?.identityId || ''; select.addEventListener('change', async () => { account = accounts.find(value => value.identityId === select.value); await db.put('selected-account', account.identityId); current = null; works = []; render(); }); main.append(select); // NEW
    } // NEW
    const title = node('h2', account ? 'Log in as ' + account.username : 'Connect your Trellis identity'); main.append(title);
    const password = field('Identity password', 'password'); main.append(password.wrap);
    if (account) main.append(button('Log in', async () => { const value = password.input.value; password.input.value = ''; await login(value); await sync(); }));
    main.append(button('Export new device request', setupRequest), button('Import approved setup', async () => { const value = password.input.value; password.input.value = ''; await importSetup(value); }));
    main.append(node('p', 'Create and manage identities on desktop. Android receives only your permitted field work.'));
}
function renderWork() {
    main.replaceChildren(); if (!current) { main.append(node('p', 'No field work downloaded yet. Export field work on desktop, or import a package here.')); return; }
    const selection = node('select');
    for (const record of works) { const option = node('option', record.work.name || record.work.diagramId); option.value = record.work.diagramId; selection.append(option); }
    selection.value = current.work.diagramId; selection.addEventListener('change', () => { current = works.find(record => record.work.diagramId === selection.value); render(); });
    main.append(selection, node('p', 'Package age: ' + Math.max(0, Math.floor((Date.now() - current.work.exportedAt) / 3600000)) + ' hours. ' + current.pending.operations.length + ' changes awaiting desktop acknowledgment.'));
    const currentTasks = new Set(current.work.tasks.map(task => task.id)); // NEW: outcomes for deleted or reassigned tasks remain visible.
    for (const operation of current.pending.operations.filter(op => !currentTasks.has(op.taskId))) main.append(node('p', 'An edit to an unavailable task is saved locally and awaiting desktop validation: ' + operation.field + '.')); // NEW
    for (const outcome of current.work.acknowledgments.filter(ack => !currentTasks.has(ack.taskId) && ['missing-object', 'permission-rejected'].includes(ack.status))) main.append(node('p', 'Rejected edit to an unavailable task: ' + (outcome.status === 'missing-object' ? 'the original task was deleted.' : 'your current permissions do not allow it.'))); // NEW
    const query = field('Search tasks'); query.input.value = search; query.input.className = 'search';
    const filters = node('div'); filters.className = 'row';
    for (const choice of ['today', 'upcoming', 'completed', 'all']) { const control = button(choice, () => { filter = choice; render(); }); if (choice === filter) control.className = 'active'; filters.append(control); }
    const list = node('section'); main.append(query.wrap, filters, list);
    function draw() {
        list.replaceChildren();
        for (const task of (current.display || current.work).tasks.filter(task => (task.title + ' ' + task.instructions).toLowerCase().includes(search.toLowerCase())).filter(task => filter === 'all' || filter === 'completed' ? filter === 'all' || task.progress.state === 'DONE' : task.progress.state !== 'DONE' && (filter === 'today' ? !task.plannedDay || task.plannedDay <= day() : task.plannedDay > day()))) {
            const article = node('article'); article.append(node('h2', task.title), node('p', (task.responsibilities || []).join(', ')), node('p', 'Planned: ' + (task.plannedDay || 'Not specified')), node('p', task.instructions));
            const progress = node('div'); progress.className = 'row';
            for (const state of ['TODO', 'DOING', 'DONE']) { const control = button(state, () => editTask(task.id, 'progress', { state, completedDay: state === 'DONE' ? day() : null })); if (state === task.progress.state) control.className = 'active'; progress.append(control); }
            const note = field('Annotation (40 characters)'); note.input.value = task.annotation; note.input.addEventListener('change', () => { note.input.value = p.normalizeAnnotation(note.input.value); editTask(task.id, 'annotation', note.input.value).catch(error => { status.textContent = error.message; }); });
            article.append(progress, note.wrap);
            const locations = task.locations.filter(id => current.work.gardens.some(garden => garden.regions.some(region => region.id === id && region.kind === 'planting-group'))); // CHANGE
            if (locations.length) article.append(button('Show planting groups', () => { selectedTaskId = task.id; tab = 'garden'; render(); })); else article.append(node('small', 'Location unavailable')); // CHANGE
            const operations = current.pending.operations.filter(op => op.taskId === task.id);
            article.append(node('p', operations.length ? operations.every(op => (current.queued || []).includes(op.id)) ? 'Saved to sync outbox; awaiting desktop acknowledgment.' : 'Saved locally; awaiting transfer.' : 'No pending local edits.')); // CHANGE
            const outcomes = current.work.acknowledgments.filter(ack => ack.taskId === task.id); // NEW
            for (const fieldName of ['progress', 'annotation']) { // NEW
                if (operations.some(operation => operation.field === fieldName)) continue; // NEW: a prior acknowledgment cannot describe a newer pending edit to the same field.
                const result = outcomes.filter(ack => ack.field === fieldName).sort((a, b) => p.compareVersions(b.version, a.version))[0]; // NEW
                if (result) article.append(node('p', fieldName + ': ' + ({ applied: 'Saved on desktop.', superseded: 'A newer change won this field conflict.', 'missing-object': 'Rejected: the original task no longer exists.', 'permission-rejected': 'Rejected: your current permissions do not allow this change.' }[result.status] || 'Awaiting a recognized result.'))); // NEW
            } // NEW
            list.append(article);
        }
    }
    query.input.addEventListener('input', () => { search = query.input.value; draw(); }); draw();
}
function renderGarden() {
    main.replaceChildren(); const gardens = current?.work.gardens || [];
    if (!gardens.length) { main.append(node('p', 'No garden preview is available in this package.')); return; }
    const selectedTask = (current.display || current.work).tasks.find(task => task.id === selectedTaskId); // NEW
    const selectedLocations = new Set(selectedTask?.locations || []); // NEW: resolve current links instead of retaining removed objects from an older package.
    if (selectedTask) main.append(node('p', 'Planting groups linked to: ' + selectedTask.title)); // NEW
    for (const garden of gardens) {
        main.append(node('h2', garden.name));
        const controls = node('div'), viewport = node('div'), layer = node('div'), image = node('img');
        controls.className = 'row'; viewport.className = 'map-viewport'; layer.className = 'map-layer'; image.src = garden.png; image.alt = garden.name; layer.append(image); viewport.append(layer);
        let scale = 1; // CHANGE: fit to the actual map viewport after it joins the document.
        const resize = () => { layer.style.width = garden.width * scale + 'px'; layer.style.height = garden.height * scale + 'px'; };
        const details = node('article');
        for (const region of garden.regions) {
            const hit = button('', () => { details.replaceChildren(node('h2', region.label || 'Garden location')); for (const [name, value] of Object.entries(region.details || {})) if (value) details.append(node('p', name + ': ' + value)); for (const task of (current.display || current.work).tasks.filter(task => task.locations.includes(region.id))) details.append(node('p', task.title + ' · ' + task.progress.state)); });
            hit.className = 'map-region' + (region.kind === 'planting-group' && selectedLocations.has(region.id) ? ' selected' : ''); hit.setAttribute('aria-label', region.label || 'Inspect garden location'); // CHANGE: beds and individual plants remain selectable but are never substituted for a linked group.
            hit.style.left = region.x / garden.width * 100 + '%'; hit.style.top = region.y / garden.height * 100 + '%'; hit.style.width = region.width / garden.width * 100 + '%'; hit.style.height = region.height / garden.height * 100 + '%'; layer.append(hit);
            if (region.rotation) hit.style.transform = 'rotate(' + region.rotation + 'deg)'; // NEW: the highlight shares the planting frame's rotation and center.
        }
        controls.append(button('Zoom in', () => { scale = Math.min(8, scale * 1.3); resize(); }), button('Zoom out', () => { scale = Math.max(0.1, scale / 1.3); resize(); }));
        main.append(controls, viewport, details); scale = Math.min(1, (viewport.clientWidth || 360) / garden.width); resize(); // CHANGE: page padding must not crop the initial whole-garden view.
        if (layer.clientWidth > viewport.clientWidth) { scale = Math.min(scale, viewport.clientWidth / garden.width); resize(); } // NEW: a vertical scrollbar can narrow a tall garden's viewport after sizing.
    }
}
function renderSettings() {
    main.replaceChildren(node('h2', 'Devices & sync'));
    main.append(button('Sync now', sync), button('Import field-work package', async () => { const incoming = await importJson(); if (incoming) { await acceptWork(incoming); await loadWorks(); render(); } }), button('Export pending task updates', async () => { if (current) await exportJson(current.pending, 'trellis-task-updates.json'); }));
    const wifi = field('Wi-Fi only', 'checkbox'); let wifiEdited = false; // CHANGE: a late settings read cannot undo a user's tap.
    db.get('wifiOnly').then(value => { if (!wifiEdited) wifi.input.checked = !!value; }); // CHANGE
    wifi.input.addEventListener('change', async () => { wifiEdited = true; const enabled = wifi.input.checked; await db.put('wifiOnly', enabled); await nativeCall('setWifiOnly', { enabled }); }); main.append(wifi.wrap); // CHANGE: use the captured value across asynchronous persistence.
    main.append(node('p', 'File delivery is separate from desktop acknowledgment. Edits remain saved if Android suspends synchronization.'));
}
function render() {
    const header = document.getElementById('identity'); header.replaceChildren();
    if (unlocked) header.append(node('span', 'Logged in as ' + account.username), button('Log out', () => { unlocked.privateKey = null; unlocked = null; current = null; works = []; render(); }));
    if (!unlocked) { renderLogin(); return; }
    if (tab === 'garden') renderGarden(); else if (tab === 'settings') renderSettings(); else renderWork();
}
for (const [name, value] of [['work', 'work'], ['garden', 'garden'], ['settings', 'settings']]) document.getElementById(name + '-tab').addEventListener('click', () => { tab = value; render(); });
const selected = await db.get('selected-account'); if (selected) account = await db.get('account:' + selected);
accounts = await Promise.all((await db.get('accounts') || []).map(id => db.get('account:' + id))); // NEW
render(); setInterval(sync, 10000); if (account) sync();
