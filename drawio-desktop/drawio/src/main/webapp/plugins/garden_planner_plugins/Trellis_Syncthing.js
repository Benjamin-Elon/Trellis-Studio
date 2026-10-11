// NEW: Renderer orchestration for managed canvas sharing; credentials stay in Electron.
Draw.loadPlugin(function (ui) {
    'use strict';
    const bridge = window.trellisShare;
    if (!bridge || typeof bridge.setContext !== 'function') return;
    const graph = ui.editor.graph;
    let info = null;
    let lastStatus = null;
    let conflicted = false;
    let remoteUpdatePending = false;
    let refreshing = false;
    let importRunning = false;
    let dialog = null;
    let savedQueue = Promise.resolve();
    const importedIds = new Set();
    const publishedIds = new Set();
    const queuedHistory = new Map();
    let localRecovery = null;
    let remoteBaselinePending = false; // NEW: imported history may arrive after its diagram replacement.
    const users = () => graph.__trellisUsers || window.Trellis && window.Trellis.users;
    const file = () => ui.getCurrentFile && ui.getCurrentFile();
    const history = () => graph.__trellisHistory || window.Trellis && window.Trellis.history;
    function context() {
        const current = file();
        const parent = graph.getDefaultParent();
        const diagramId = history() && history().getDiagramId ? history().getDiagramId() : parent.getAttribute && (parent.getAttribute('trellis_history_id') || parent.getAttribute('trellis_users_diagram_id'));
        return { diagramPath: current && current.fileObject && current.fileObject.path || null, diagramId: diagramId || '', userId: users() && users().getCurrentUser() && users().getCurrentUser().id || '' };
    }
    function request(action, payload) {
        return new Promise((resolve, reject) => window.electron.request({ action, ...payload }, resolve, message => reject(new Error(message))));
    }
    async function hash(text) {
        const bytes = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(bytes)).map(value => value.toString(16).padStart(2, '0')).join('');
    }
    function status(message) { if (ui.editor.setStatus) ui.editor.setStatus(String(message)); }
    function announce() {
        window.dispatchEvent(new window.CustomEvent('trellisSharingStatusChanged', { detail: { info, status: lastStatus } }));
    }
    function pauseAutosave() {
        const firstConflict = !conflicted;
        const current = file();
        if (current) { current.inConflictState = true; if (current.clearAutosave) current.clearAutosave(); }
        conflicted = true;
        if (firstConflict && info) {
            bridge.setConflictState({ shareId: info.shareId, conflicted: true }).catch(err => status(err.message));
            bridge.saveRecoveryCopy({ shareId: info.shareId, xml: ui.getFileData() }).then(result => { localRecovery = result; }).catch(err => status('Local recovery copy failed: ' + err.message));
        }
        status('Shared canvas conflict. Preserve your work and ask an admin to resolve it.');
    }
    async function saveCurrent() {
        const current = file();
        if (!current) throw new Error('Open a canvas before sharing.');
        if (conflicted) throw new Error('Resolve the canvas conflict before saving shared work.');
        return new Promise((resolve, reject) => current.save(false, resolve, error => reject(new Error(error && error.message || String(error)))));
    }
    async function synchronizeContext() {
        if (ui.watchFile && file()) await ui.watchFile(file());
        await bridge.setContext(context());
    }
    async function refresh() {
        if (refreshing) return;
        refreshing = true;
        try {
            await synchronizeContext();
            const current = context();
            if (!current.diagramPath) { info = null; lastStatus = null; announce(); return; }
            const result = await bridge.getStatus();
            const entry = (result.canvases || []).find(canvas => canvas.diagramPath === current.diagramPath);
            if (!entry) { info = null; lastStatus = null; announce(); return; }
            info = await bridge.getSyncthingShareInfo({ diagramPath: current.diagramPath });
            if (graph.refresh) graph.refresh(); // NEW: refresh images after their managed asset base becomes available.
            lastStatus = entry;
            if (entry.state === 'conflict') pauseAutosave();
            await importNewHistory();
            announce();
        } catch (err) { status(err.message); }
        finally { refreshing = false; }
    }
    function applyRemote(xml, current, stat) {
        const oldUsersInternal = graph.__trellisUsersInternalChange;
        graph.__trellisSharingApplying = true;
        graph.__trellisUsersInternalChange = true;
        try {
            ui.setFileData(xml);
            current.data = xml;
            current.stat = stat || current.stat;
            current.inConflictState = false;
            current.setModified(false);
            if (current.setShadowPages && ui.getPagesForXml) current.setShadowPages(ui.getPagesForXml(xml));
            if (users() && users().revalidateCurrentSession) users().revalidateCurrentSession();
            if (history() && history().applyRemoteBaseline) history().applyRemoteBaseline();
            remoteBaselinePending = true; // NEW: refresh the parent checkpoint when matching shared history arrives.
        } finally {
            graph.__trellisUsersInternalChange = oldUsersInternal;
            graph.__trellisSharingApplying = false;
        }
    }
    async function adoptCanvas(result) {
        const current = file();
        const oldPath = current.fileObject && current.fileObject.path;
        current.fileObject = { path: result.diagramPath, name: result.filename, type: 'utf-8' };
        current.title = result.filename;
        applyRemote(result.xml, current, await request('fileStat', { file: result.diagramPath }));
        if (oldPath && ui.getRecent) { // CHANGE: draw.io has getRecent/addRecent, not removeRecent.
            const recent = ui.getRecent();
            if (Array.isArray(recent)) window.localStorage.setItem('.recent', JSON.stringify(recent.filter(entry => entry.id !== oldPath || entry.mode != null)));
        }
        if (current.addToRecent) current.addToRecent();
        if (current.descriptorChanged) current.descriptorChanged();
        await synchronizeContext();
        info = result;
        queuedHistory.clear(); // NEW: pre-sharing history remains local.
        if (result.startup && !result.startup.ok) status(result.startup.reason);
        await refresh();
    }
    async function ensureManaged() {
        await synchronizeContext();
        let result = await bridge.getSyncthingShareInfo({ diagramPath: context().diagramPath });
        if (!result.ok) throw new Error(result.reason);
        if (result.managed) { info = result; return result; }
        // Use the editor dialog rather than a blocking browser prompt that can strand Electron input focus. // CHANGE
        const approved = await new Promise(resolve => { // NEW
            ui.confirm('Sharing moves this canvas into Documents/Trellis/Shared Canvases. Every approved device receives the entire canvas, Users metadata, referenced assets, and new saved history. Selected scopes limit editing, not visibility. Continue?', // CHANGE
                () => resolve(true), () => resolve(false), 'Continue', 'Cancel', false); // NEW: explicit buttons always settle the setup decision.
        }); // NEW
        if (!approved) throw new Error('Sharing setup cancelled.'); // CHANGE
        const current = file();
        if (!current) throw new Error('Open a canvas before sharing.');
        // Setup saves existing files; unsaved canvases receive their first save directly in the managed folder.
        if (current.fileObject && current.fileObject.path) await saveCurrent();
        else current.data = ui.getFileData();
        await synchronizeContext();
        result = await bridge.setupCanvas({ ...context(), filename: current.getTitle && current.getTitle() || 'Garden.drawio', xml: current.getData() });
        await adoptCanvas(result);
        return result;
    }
    async function prepareInvite(result) {
        await saveCurrent();
        await synchronizeContext();
        const block = await bridge.createInviteBlock({ shareId: info.shareId, inviteId: result.invite.id, code: result.code });
        return { ...result.emailDraft, body: result.emailDraft.body + '\n\n' + block.block };
    }
    function historyRecorded(event) {
        const entry = event.detail;
        if (!graph.__trellisSharingApplying) remoteBaselinePending = false; // NEW: imported history must not erase a newer local edit baseline.
        if (info && info.managed && entry && entry.revision.diagramHistoryId === info.diagramId && !graph.__trellisSharingApplying) queuedHistory.set(entry.revision.id, entry);
    }
    async function publishSavedHistory(savedXml) {
        if (!info || !info.managed || graph.__trellisSharingApplying || conflicted) return;
        const entries = Array.from(queuedHistory.values());
        if (!entries.length) return;
        await synchronizeContext();
        await bridge.exportHistory({ shareId: info.shareId, savedHash: await hash(savedXml), entries });
        entries.forEach(entry => { publishedIds.add(entry.revision.id); queuedHistory.delete(entry.revision.id); });
    }
    function savedCheckpoint(entry) {
        if (!entry || publishedIds.has(entry.revision.id) || info && info.createdAt && entry.revision.timestamp < info.createdAt) return null;
        const revisions = new Map((history().list ? history().list() : []).map(revision => [revision.id, revision]));
        for (const item of queuedHistory.values()) revisions.set(item.revision.id, item.revision);
        let parent = entry.revision.parentRevisionId;
        const visited = new Set();
        // A shared checkpoint links to its nearest published ancestor, not private unsaved intermediates.
        while (parent && !publishedIds.has(parent)) {
            if (visited.has(parent)) { parent = null; break; }
            visited.add(parent);
            parent = revisions.get(parent)?.parentRevisionId || null;
        }
        return { ...entry, revision: { ...entry.revision, parentRevisionId: parent || null } };
    }
    async function importNewHistory() {
        if (!info || !info.managed || importRunning || !history() || !history().importShared) return;
        importRunning = true;
        try {
            const result = await bridge.importHistory({ shareId: info.shareId, knownIds: Array.from(importedIds) });
            for (const entry of result.entries || []) { await history().importShared(entry); importedIds.add(entry.revision.id); publishedIds.add(entry.revision.id); }
            if (remoteBaselinePending && (result.entries || []).length && file() && !file().isModified() && history().applyRemoteBaseline) { // NEW: never replace the baseline after local work has begun.
                remoteBaselinePending = !history().applyRemoteBaseline();
            }
            if (result.errors && result.errors.length) status('Some shared history could not be imported: ' + result.errors[0].reason);
        } finally { importRunning = false; }
    }
    function installFileHooks() {
        const current = file();
        if (!current || current.__trellisSharingHooks) return;
        current.__trellisSharingHooks = true;
        const originalSave = current.save;
        current.save = function () {
            if (file() === current && info && current.fileObject && current.fileObject.path === info.diagramPath && (conflicted || remoteUpdatePending)) {
                if (typeof arguments[2] === 'function') arguments[2]({ message: 'Resolve the shared canvas conflict before saving. Save a recovery copy to retain local work.' });
                return;
            }
            return originalSave.apply(this, arguments);
        };
        const originalSaved = current.fileSaved;
        current.fileSaved = function () {
            const args = Array.from(arguments);
            const savedXml = args[0];
            const success = args[2];
            args[2] = function () {
                savedQueue = savedQueue.then(async function () {
                    // Flush stable history only if the in-memory canvas still matches the saved work.
                    if (history() && history().flushForSharing && !current.isModified()) {
                        const checkpoint = savedCheckpoint(await history().flushForSharing());
                        queuedHistory.clear(); // NEW: unsaved intermediate revisions are never published.
                        if (checkpoint) queuedHistory.set(checkpoint.revision.id, checkpoint);
                    } else return;
                    await publishSavedHistory(savedXml);
                }).catch(err => status('Shared history export failed: ' + err.message));
                if (success) success.apply(this, arguments);
            };
            return originalSaved.apply(this, args);
        };
    }
    function assetUrl(reference) {
        return info && info.assetBaseUrl && /^assets\/[a-f0-9]{16}(?:\.[a-z0-9_-]+)?$/.test(reference || '') ? new URL(reference, info.assetBaseUrl).href : reference;
    }
    if (graph.getImage) { const original = graph.getImage; graph.getImage = function () { return assetUrl(original.apply(this, arguments)); }; }
    if (graph.getLabel) { // NEW: resolve copied HTML images for rendering without writing local paths into shared XML.
        const original = graph.getLabel;
        graph.getLabel = function () {
            const label = original.apply(this, arguments);
            if (!info || typeof label !== 'string' || !/src=["']assets\//i.test(label)) return label;
            const template = document.createElement('template');
            template.innerHTML = label;
            for (const image of template.content.querySelectorAll('img[src]')) image.setAttribute('src', assetUrl(image.getAttribute('src')));
            return template.innerHTML;
        };
    }
    if (ui.openLink) { const original = ui.openLink; ui.openLink = function (reference) { if (info && /^assets\//.test(reference || '')) { bridge.openAsset({ shareId: info.shareId, relativePath: reference }).then(result => { if (!result.ok) status(result.reason); }).catch(err => status(err.message)); return; } return original.apply(this, arguments); }; }
    const originalHandleFileChange = ui.handleFileChange;
    if (originalHandleFileChange) ui.handleFileChange = function (curr, prev, current) {
        if (!info || !current.fileObject || current.fileObject.path !== info.diagramPath) return originalHandleFileChange.apply(this, arguments);
        if (curr.mtimeMs === prev.mtimeMs || current.stat && current.stat.mtimeMs === curr.mtimeMs || current.unwatchedSaves) { current.unwatchedSaves = false; return; }
        if (!curr.mtimeMs || current.isModified() || conflicted) { pauseAutosave(); return; }
        current.inConflictState = true;
        remoteUpdatePending = true;
        if (current.clearAutosave) current.clearAutosave();
        window.fsBridge.readText(info.diagramPath).then(async result => {
            if (file() !== current) return;
            if (current.isModified()) { pauseAutosave(); return; }
            applyRemote(result.data, current, curr);
            await refresh();
        }).catch(err => { pauseAutosave(); status(err.message); }).finally(() => { remoteUpdatePending = false; });
    };
    function button(label, handler, parent) {
        const element = document.createElement('button');
        element.type = 'button';
        element.textContent = label;
        element.style.cssText = 'padding:6px 10px;border:1px solid #999;border-radius:4px;background:#fff;cursor:pointer;';
        element.addEventListener('click', () => Promise.resolve().then(handler).catch(err => { const target = dialog && dialog.querySelector('[data-status]'); if (target) target.textContent = err.message; else status(err.message); }));
        parent.appendChild(element);
        return element;
    }
    function showDialog(title) {
        if (dialog) dialog.remove();
        dialog = document.createElement('div');
        dialog.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:2147483100;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';
        const panel = document.createElement('section');
        panel.style.cssText = 'width:640px;max-width:100%;max-height:calc(100vh - 32px);overflow:auto;background:#fff;color:#222;border:1px solid #777;border-radius:6px;padding:16px;font:13px Arial;box-sizing:border-box;';
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;gap:16px;align-items:center;';
        const heading = document.createElement('h2');
        heading.textContent = title;
        heading.style.cssText = 'font-size:17px;margin:0;';
        header.appendChild(heading);
        button('Close', () => { dialog.remove(); dialog = null; }, header);
        panel.appendChild(header);
        dialog.appendChild(panel);
        document.body.appendChild(dialog);
        const message = document.createElement('p');
        message.setAttribute('data-status', '');
        message.setAttribute('role', 'status');
        panel.appendChild(message);
        dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { dialog.remove(); dialog = null; } });
        return panel;
    }
    function field(panel, label, multiline) {
        const wrapper = document.createElement('label');
        wrapper.textContent = label;
        wrapper.style.cssText = 'display:block;margin:12px 0;';
        const input = document.createElement(multiline ? 'textarea' : 'input');
        input.style.cssText = 'display:block;box-sizing:border-box;width:100%;margin-top:5px;padding:8px;border:1px solid #999;border-radius:4px;';
        if (multiline) { input.rows = 6; input.style.resize = 'vertical'; }
        wrapper.appendChild(input);
        panel.appendChild(wrapper);
        return input;
    }
    function showJoinDialog() {
        const panel = showDialog('Join Shared Canvas');
        const invite = field(panel, 'Canvas invitation', true);
        const sender = field(panel, 'Sender email');
        button('Join Canvas', async () => {
            const result = await bridge.joinCanvas({ block: invite.value, senderEmail: sender.value });
            invite.value = result.reply;
            invite.readOnly = true;
            panel.querySelector('[data-status]').textContent = 'Device approval requested. The canvas will arrive after an admin approves this device.' + (result.startup && !result.startup.ok ? ' ' + result.startup.reason : '');
            button('Open Reply Email', async () => { const draft = await bridge.openEmailDraft(result.emailDraft); if (!draft.ok) throw new Error(draft.reason); }, panel);
            button('Open Canvas', async () => { try { await window.fsBridge.readText(result.diagramPath); } catch (_) { throw new Error('The canvas has not arrived yet. Wait for device approval and synchronization.'); } if (ui.loadArgs) ui.loadArgs({ args: [result.diagramPath] }); }, panel);
        }, panel);
        invite.focus();
    }
    async function showSharingDialog() {
        await refresh();
        const panel = showDialog('Canvas Sync');
        panel.querySelector('[data-status]').textContent = lastStatus ? (lastStatus.connectedCollaborators == null ? 'Connection count unavailable' : lastStatus.connectedCollaborators + ' connected collaborators') + ' - ' + lastStatus.state : 'This canvas is not shared.';
        button('Join Another Canvas', showJoinDialog, panel);
        if (!info || !info.managed) return;
        button(lastStatus && lastStatus.state === 'paused' ? 'Resume Syncing' : 'Pause Syncing', () => bridge.setPaused({ shareId: info.shareId, paused: !(lastStatus && lastStatus.state === 'paused') }), panel);
        if (users() && users().isAdmin()) {
            const existingLabel = document.createElement('label');
            existingLabel.textContent = 'Additional device for';
            const existingUser = document.createElement('select');
            existingUser.style.cssText = 'display:block;width:100%;padding:8px;margin:8px 0;';
            for (const user of users().listUsers().filter(user => !user.disabled && user.email)) {
                const option = document.createElement('option'); option.value = user.id; option.textContent = user.name + ' (' + user.email + ')'; existingUser.appendChild(option);
            }
            existingLabel.appendChild(existingUser);
            panel.appendChild(existingLabel);
            button('Create Device Setup Invite', async () => {
                await saveCurrent();
                await synchronizeContext();
                const result = await bridge.createDeviceInvite({ shareId: info.shareId, userId: existingUser.value.trim() });
                const block = field(panel, 'Additional-device invitation', true);
                block.value = result.block;
                block.readOnly = true;
                button('Open Device Invite Email', async () => { const draft = await bridge.openEmailDraft({ to: result.email, subject: 'Trellis canvas additional device', body: 'Use Join Shared Canvas on your additional computer, then return the approval reply to an admin.\n\n' + result.block }); if (!draft.ok) throw new Error(draft.reason); }, panel);
            }, panel);
            const reply = field(panel, 'Device approval reply', true);
            button('Approve Device', async () => { await saveCurrent(); await synchronizeContext(); const result = await bridge.requestMembership({ shareId: info.shareId, operation: 'approve', reply: reply.value }); panel.querySelector('[data-status]').textContent = 'Approval request queued: ' + result.requestId; }, panel);
            const membership = await bridge.listRequests({ shareId: info.shareId });
            for (const member of membership.members || []) {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:8px;overflow-wrap:anywhere;';
                const name = document.createElement('span');
                name.textContent = member.userId + ' - ' + member.deviceId;
                row.appendChild(name);
                if (member.deviceId !== info.coordinatorDeviceId) button('Remove Device', async () => { await saveCurrent(); await synchronizeContext(); await bridge.requestMembership({ shareId: info.shareId, operation: 'remove', targetDeviceId: member.deviceId }); }, row);
                panel.appendChild(row);
            }
            for (const item of membership.requests || []) { const row = document.createElement('p'); row.textContent = item.operation + ': ' + item.status + (item.reason ? ' (' + item.reason + ')' : ''); panel.appendChild(row); }
            button('Recover With New Share', async () => { if (!window.confirm('Create a replacement share? Collaborators will need to join it again.')) return; if (conflicted) await bridge.saveRecoveryCopy({ shareId: info.shareId, xml: ui.getFileData() }); else await saveCurrent(); await synchronizeContext(); await adoptCanvas(await bridge.recovery({ shareId: info.shareId })); }, panel);
        }
        if (conflicted || lastStatus && lastStatus.conflicts && lastStatus.conflicts.length) {
            button('Save Recovery Copy', async () => { localRecovery = await bridge.saveRecoveryCopy({ shareId: info.shareId, xml: ui.getFileData() }); panel.querySelector('[data-status]').textContent = 'Local recovery saved: ' + localRecovery.recoveryPath; }, panel);
            button('Reload Shared Version', async () => {
                if (!window.confirm('Reload the saved shared canvas and discard in-memory changes? Save a recovery copy first to retain them.')) return;
                const result = await window.fsBridge.readText(info.diagramPath);
                applyRemote(result.data, file(), await request('fileStat', { file: info.diagramPath }));
                conflicted = false;
                queuedHistory.clear();
                await bridge.setConflictState({ shareId: info.shareId, conflicted: false });
                await refresh();
            }, panel);
            const label = document.createElement('label');
            label.textContent = 'Version to review';
            const select = document.createElement('select');
            select.style.cssText = 'display:block;max-width:100%;margin:12px 0;';
            for (const filename of [file().fileObject.name, ...(lastStatus && lastStatus.conflicts || []), ...(localRecovery ? [localRecovery.filename] : [])]) { const option = document.createElement('option'); option.value = filename; option.textContent = filename; select.appendChild(option); }
            label.appendChild(select);
            panel.appendChild(label);
            const preview = field(panel, 'Version XML', true);
            preview.readOnly = true;
            const differences = document.createElement('div'); // NEW: cell-level comparison is available to every logged-in collaborator.
            differences.style.cssText = 'max-height:180px;overflow:auto;overflow-wrap:anywhere;';
            panel.appendChild(differences);
            let currentHash = '';
            let reviewedFilename = '';
            let reviewedHash = '';
            button('Inspect Version', async () => { // CHANGE: use atomic review hashes and show content changes without merging.
                const result = await bridge.inspectConflict({ shareId: info.shareId, filename: select.value });
                preview.value = result.xml;
                reviewedFilename = select.value;
                reviewedHash = result.chosenHash;
                currentHash = result.currentHash;
                differences.replaceChildren();
                const summary = document.createElement('p');
                summary.textContent = result.differences.added + ' added, ' + result.differences.changed + ' changed, ' + result.differences.removed + ' removed';
                differences.appendChild(summary);
                for (const cell of result.differences.cells) {
                    const row = document.createElement('div');
                    row.textContent = cell.kind + ': ' + cell.label + ' [' + cell.cellId + ']';
                    differences.appendChild(row);
                }
                if (result.differences.truncated) { const more = document.createElement('p'); more.textContent = 'First 100 changes shown.'; differences.appendChild(more); }
            }, panel);
            if (users() && users().isAdmin()) button('Publish Reviewed Version', async () => { if (!currentHash || reviewedFilename !== select.value) throw new Error('Inspect the selected version before publishing.'); const result = await bridge.resolveConflict({ shareId: info.shareId, filename: select.value, expectedHash: currentHash, expectedChosenHash: reviewedHash }); conflicted = false; queuedHistory.clear(); applyRemote(result.xml, file()); file().stat = await request('fileStat', { file: info.diagramPath }); await refresh(); panel.querySelector('[data-status]').textContent = 'Conflict resolved. Recovery copies retained.'; }, panel);
        }
    }
    window.Trellis = window.Trellis || {};
    window.Trellis.sharing = { ensureManaged, prepareInvite, showJoinDialog, showSharingDialog, refresh, context, getStatus: () => lastStatus, getInfo: () => info, isApplyingRemote: () => !!graph.__trellisSharingApplying };
    graph.__trellisSharing = window.Trellis.sharing;
    ui.actions.addAction('trellisJoinSharedCanvas', showJoinDialog).label = 'Join Shared Canvas';
    ui.actions.addAction('trellisCanvasSync', () => showSharingDialog().catch(err => status(err.message))).label = 'Canvas Sync';
    const extras = ui.menus.get('extras');
    if (extras) { const original = extras.funct; extras.funct = function (menu, parent) { original.apply(this, arguments); ui.menus.addMenuItems(menu, ['-', 'trellisJoinSharedCanvas', 'trellisCanvasSync'], parent); }; }
    window.addEventListener('trellisUsersSessionChanged', () => synchronizeContext().catch(err => status(err.message)));
    window.addEventListener('trellisHistoryRevisionRecorded', historyRecorded);
    bridge.onStatus(canvases => {
        const current = context();
        lastStatus = canvases.find(canvas => canvas.diagramPath === current.diagramPath) || null;
        if (lastStatus && lastStatus.state === 'conflict') pauseAutosave();
        if (lastStatus && info) importNewHistory().catch(err => status(err.message));
        announce();
    });
    ui.editor.addListener('fileLoaded', () => { info = null; conflicted = false; localRecovery = null; remoteBaselinePending = false; queuedHistory.clear(); importedIds.clear(); publishedIds.clear(); installFileHooks(); refresh(); }); // CHANGE: do not reuse a previous canvas's remote baseline.
    installFileHooks();
    refresh();
});
