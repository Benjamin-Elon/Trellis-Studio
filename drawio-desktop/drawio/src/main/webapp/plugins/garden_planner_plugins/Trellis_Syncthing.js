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
    let refreshFinished = null, finishRefresh = null; // NEW: callers opening a dialog await an in-flight context refresh.
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
        if (updateDialog) updateDialog(); renderBadges(); // NEW: update status only; never rebuild active forms.
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
        if (refreshing) return refreshFinished; // CHANGE
        refreshing = true;
        refreshFinished = new Promise(resolve => { finishRefresh = resolve; }); // NEW
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
            if (entry.state === 'conflict' && info.protocolVersion !== 2) pauseAutosave(); // CHANGE: object arbitration does not stop unrelated autosaves.
            if (isCollaborative() && collaborationBaseline == null) { collaborationBaseline = ui.getFileData(); observedXml = collaborationBaseline; collaboration = entry.collaboration || null; } // NEW
            await importNewHistory();
            announce();
        } catch (err) { status(err.message); }
        finally { refreshing = false; finishRefresh(); } // CHANGE
    }
    function applyRemote(xml, current, stat, savedDraft) { // CHANGE: optionally patch from a captured save while newer local edits remain in the model.
        const oldUsersInternal = graph.__trellisUsersInternalChange;
        graph.__trellisSharingApplying = true;
        graph.__trellisUsersInternalChange = true;
        try {
            if (isCollaborative() && current.patch && ui.diffPages && ui.getPagesForXml && ui.pages?.length) { const pages = ui.getPagesForXml(xml); current.patch([ui.diffPages(ui.getPagesForXml(savedDraft || ui.getFileData()), pages)], null, false, false); } // NEW: preserve cell identity, selection, open forms, and newer typing through draw.io's existing page patcher.
            else ui.setFileData(xml); // CHANGE: retain the legacy reload path and compatibility fallback.
            current.data = xml;
            if (isCollaborative()) { collaborationBaseline = xml; observedXml = savedDraft ? ui.getFileData() : xml; } // NEW
            current.stat = stat || current.stat;
            current.inConflictState = false;
            current.setModified(!!savedDraft); // CHANGE: a peer patch must not acknowledge newer unsaved input.
            if (current.setShadowPages && ui.getPagesForXml) current.setShadowPages(ui.getPagesForXml(xml));
            if (users() && users().revalidateCurrentSession) users().revalidateCurrentSession();
            if (!savedDraft && history() && history().applyRemoteBaseline) history().applyRemoteBaseline(); // CHANGE
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
        result = await bridge.setupCanvas({ ...context(), protocolVersion: 2, filename: current.getTitle && current.getTitle() || 'Garden.drawio', xml: current.getData() });
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
        const originalAutosave = current.isAutosave, originalOptional = current.isAutosaveOptional; // NEW
        current.isAutosave = function () { return file() === current && isCollaborative() ? !!current.fileObject && !lastStatus?.pending && !['revoked', 'awaitingApproval'].includes(lastStatus?.state) : originalAutosave ? originalAutosave.apply(this, arguments) : false; }; // NEW
        current.isAutosaveOptional = function () { return file() === current && isCollaborative() ? false : originalOptional ? originalOptional.apply(this, arguments) : true; }; // NEW
        current.save = function () {
            if (file() === current && isCollaborative()) { saveCollaborative(current, arguments[1], arguments[2]); return; } // NEW
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
        if (isCollaborative()) { coordinate({ kind: 'get' }).then(result => { if (file() === current && !current.isModified() && result.xml !== collaborationBaseline) applyRemote(result.xml, current, curr); }).catch(err => status(err.message)); return; } // NEW: a local projection is never treated as a competing full-file replacement.
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
    let updateDialog = null; // NEW
    let collaborationBaseline = null, observedXml = null, localSessionId = null, acquiring = false, editingForm = null; // NEW
    let collaboration = null, collaborationSave = Promise.resolve(), contextGeneration = 0; // NEW
    const isCollaborative = () => !!(info && info.protocolVersion === 2 && bridge.collaborationAction); // NEW
    function describeStatus(state = lastStatus) { // NEW
        if (!state) return 'Not shared'; // NEW
        if (state.pending) return 'Awaiting approval'; // NEW
        if (info && info.protocolVersion === 2 && ['upToDate', 'syncing', 'unavailable'].includes(state.state) && ((state.connectedPeers ?? state.connectedCollaborators) === 0 || state.state === 'unavailable')) return 'Working locally'; // NEW: local work must not conceal pause, revocation, or approval states.
        return ({ upToDate: 'Up to date', syncing: 'Syncing', paused: 'Paused', conflict: 'Needs review', awaitingApproval: 'Awaiting approval', revoked: 'Access removed', unavailable: 'Unavailable' })[state.state] || 'Checking connection'; // NEW
    } // NEW
    function collaborationSummary() { // NEW
        if (lastStatus?.pending || lastStatus?.state === 'awaitingApproval') return 'This computer is waiting for approval before it can publish shared edits.'; // NEW
        if (lastStatus?.state === 'revoked') return 'This computer’s access was removed. Recovery copies remain available.'; // NEW
        const local = file()?.isModified() ? 'Changes are waiting to be saved locally.' : 'Local changes are saved.'; // NEW
        const peers = ['upToDate', 'syncing'].includes(lastStatus?.state) && (lastStatus?.connectedPeers ?? lastStatus?.connectedCollaborators) > 0; // NEW
        return 'Autosave is always on. ' + local + ' ' + (lastStatus?.state === 'paused' ? 'Peer synchronization is paused; editing holds are unconfirmed.' : peers ? 'Sharing changes with connected peers.' : 'Working locally—locks unconfirmed until peers connect.'); // NEW
    } // NEW
    function note(panel, text) { const p = document.createElement('p'); p.textContent = text; p.style.cssText = 'line-height:1.5;color:#4b5563;margin:10px 0;'; panel.appendChild(p); return p; } // NEW
    function button(label, handler, parent, variant = 'open') { // CHANGE: every action uses the existing semantic style contract.
        const element = document.createElement('button'); element.type = 'button'; element.textContent = label; // CHANGE
        if (window.Trellis && window.Trellis.ui && window.Trellis.ui.applyButtonStyle) window.Trellis.ui.applyButtonStyle(element, variant); // NEW
        else { const color = { open: '#2563eb', add: '#188038', close: '#b91c1c', danger: '#b91c1c', neutral: '#6b7280' }[variant]; element.style.cssText = 'padding:6px 10px;border:1px solid ' + color + ';border-radius:6px;background:#fff;color:' + color + ';cursor:pointer;'; } // NEW
        element.style.margin = '4px 6px 4px 0'; // NEW
        element.addEventListener('click', async () => { // CHANGE
            if (element.disabled) return; const panel = element.closest('[role="dialog"]'); element.disabled = true; // NEW
            try { await handler(); } catch (err) { const target = panel && panel.querySelector('[data-status]'); if (target && panel.isConnected) { target.textContent = err.message; target.setAttribute('role', 'alert'); } else status(err.message); } // CHANGE
            finally { if (element.isConnected && element.dataset.keepDisabled !== 'true') element.disabled = false; } // NEW
        }); // CHANGE
        parent.appendChild(element); return element; // CHANGE
    } // CHANGE
    function closeDialog() { // NEW
        if (!dialog) return; const previous = dialog.__previousFocus; dialog.remove(); dialog = null; updateDialog = null; // NEW
        if (previous && previous.isConnected && previous.focus) previous.focus(); // NEW
    } // NEW
    function showDialog(title, back) { // CHANGE
        const previous = dialog && dialog.__previousFocus || document.activeElement; if (dialog) dialog.remove(); updateDialog = null; // CHANGE
        dialog = document.createElement('div'); dialog.__previousFocus = previous; dialog.className = 'trellis-collaboration-dialog'; // CHANGE
        dialog.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:2147483100;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;'; // CHANGE
        const panel = document.createElement('section'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', title); panel.tabIndex = -1; // NEW
        panel.style.cssText = 'width:640px;max-width:100%;max-height:calc(100vh - 32px);overflow:auto;background:#fff;color:#111827;border:1px solid #d1d5db;border-radius:8px;padding:20px;font:13px Arial;box-sizing:border-box;box-shadow:0 12px 40px #0003;'; // CHANGE
        const header = document.createElement('div'); header.style.cssText = 'display:flex;justify-content:space-between;gap:12px;align-items:center;'; // CHANGE
        const heading = document.createElement('h2'); heading.textContent = title; heading.style.cssText = 'font-size:19px;margin:0;flex:1;'; // CHANGE
        if (back) button('Back', back, header, 'neutral'); header.appendChild(heading); button('Close', closeDialog, header, 'close'); panel.appendChild(header); // CHANGE
        const message = document.createElement('p'); message.dataset.status = ''; message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite'); panel.appendChild(message); // CHANGE
        dialog.appendChild(panel); document.body.appendChild(dialog); // CHANGE
        for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'dblclick', 'keypress', 'keyup']) dialog.addEventListener(type, e => e.stopPropagation()); // NEW
        dialog.addEventListener('keydown', e => { // CHANGE
            e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); closeDialog(); return; } // CHANGE
            if (e.key === 'Tab') { const controls = [...panel.querySelectorAll('button,input,textarea,select,summary,a[href],[tabindex="0"]')].filter(n => !n.disabled && !n.closest('[hidden]') && (!n.closest('details:not([open])') || n.tagName === 'SUMMARY' && !n.parentElement.parentElement.closest('details:not([open])'))); const first = controls[0], last = controls[controls.length - 1]; if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } } // NEW
        }); // CHANGE
        window.setTimeout(() => { if (panel.isConnected) (panel.querySelector('input,textarea,select') || panel).focus(); }, 0); return panel; // CHANGE
    } // CHANGE
    function field(panel, label, multiline) { // CHANGE
        const wrapper = document.createElement('label'); wrapper.textContent = label; wrapper.style.cssText = 'display:block;margin:14px 0;line-height:1.4;'; // CHANGE
        const input = document.createElement(multiline ? 'textarea' : 'input'); input.style.cssText = 'display:block;box-sizing:border-box;width:100%;margin-top:6px;padding:8px;border:1px solid #9ca3af;border-radius:6px;font:13px Arial;'; // CHANGE
        if (multiline) { input.rows = 4; input.style.resize = 'vertical'; } wrapper.appendChild(input); panel.appendChild(wrapper); return input; // CHANGE
    } // CHANGE
    function details(panel, title) { const d = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = title; d.appendChild(summary); d.style.cssText = 'margin:16px 0;padding-top:12px;border-top:1px solid #e5e7eb;'; panel.appendChild(d); return d; } // NEW
    function copyBlock(panel, label, value) { // NEW
        const block = field(panel, label, true); block.value = value; block.readOnly = true; // NEW
        button('Copy', async () => { try { await window.navigator.clipboard.writeText(value); panel.querySelector('[data-status]').textContent = 'Copied.'; } catch (_) { block.focus(); block.select(); throw new Error('Copy was unavailable. The complete text is selected; use your copy shortcut.'); } }, panel, 'add'); return block; // NEW
    } // NEW
    function showJoinDialog(back) { // CHANGE
        const panel = showDialog('Join another canvas', typeof back === 'function' ? back : null); // CHANGE
        note(panel, '1. Paste the complete invitation you received. 2. Send the generated approval reply to the sender. 3. Open the canvas after approval and download. New collaborators then use Accept Invite with the sender’s code to set their name and PIN; existing users sign in normally.'); // NEW
        const invite = field(panel, 'Invitation text', true), sender = field(panel, 'Sender email (optional)'); sender.type = 'email'; // CHANGE
        const join = button('Join Canvas', async () => { // CHANGE
            const result = await bridge.joinCanvas({ block: invite.value.trim(), senderEmail: sender.value.trim() }); // CHANGE
            if (!panel.isConnected) return; invite.readOnly = true; join.dataset.keepDisabled = 'true'; // NEW
            copyBlock(panel, 'Approval reply — send this back to the sender', result.reply); // NEW
            panel.querySelector('[data-status]').textContent = 'Waiting for approval. Send the reply below; joining alone does not approve this computer.' + (result.startup && !result.startup.ok ? ' ' + result.startup.reason : ''); // CHANGE
            const email = button('Open reply email', async () => { const draft = await bridge.openEmailDraft({ ...result.emailDraft, to: sender.value.trim() }); if (!draft.ok) throw new Error(draft.reason); }, panel); // CHANGE
            const updateEmail = () => { email.disabled = !sender.value.trim() || !sender.checkValidity(); }; sender.addEventListener('input', updateEmail); updateEmail(); // NEW
            const open = button('Open Canvas', async () => { try { await window.fsBridge.readText(result.diagramPath); } catch (_) { throw new Error('The canvas has not arrived yet. Wait for approval and download, then try again.'); } if (ui.loadArgs) ui.loadArgs({ args: [result.diagramPath] }); }, panel); open.disabled = true; // CHANGE
            let checkingDownload = false; // NEW
            const checkDownload = async () => { // NEW
                if (checkingDownload || !panel.isConnected) return; checkingDownload = true; // NEW
                try { // NEW
                    const state = (await bridge.getStatus()).canvases.find(canvas => canvas.diagramPath === result.diagramPath); // NEW
                    if (!panel.isConnected) return; open.disabled = true; // NEW
                    const message = panel.querySelector('[data-status]'); // NEW
                    if (!state || state.pending || state.state === 'awaitingApproval') { message.textContent = 'Waiting for approval. Copy the approval reply and return it to the sender.'; return; } // NEW
                    if (state.state === 'revoked') { message.textContent = 'This computer was not approved or its access was removed. Ask the sender for a new invitation.'; return; } // NEW
                    try { await window.fsBridge.readText(result.diagramPath); } catch (_) { message.textContent = 'Computer approved, but the canvas has not arrived yet. Wait for the download to finish.'; return; } // NEW
                    if (panel.isConnected) { open.disabled = false; message.textContent = 'Computer approved and canvas downloaded. You can open it now.'; } // NEW
                } finally { checkingDownload = false; } // NEW
            }; // NEW
            updateDialog = () => checkDownload().catch(err => { if (panel.isConnected) panel.querySelector('[data-status]').textContent = err.message; }); // NEW
            button('Check download', checkDownload, panel, 'neutral'); await checkDownload(); // NEW
        }, panel, 'add'); // CHANGE
        join.disabled = true; invite.addEventListener('input', () => { join.disabled = !invite.value.trim(); }); invite.focus(); // NEW
    } // CHANGE
    async function showAddComputer() { // NEW
        const panel = showDialog('Add another computer', showSharingDialog); // NEW
        note(panel, 'For someone who already has canvas access. Create an invitation here, use Join another canvas on their other computer, then return its approval reply to an admin. To invite a new person, use Share on the garden toolbar.'); // NEW
        const select = document.createElement('select'), wrapper = document.createElement('label'); wrapper.textContent = 'Person using the other computer'; select.style.cssText = 'display:block;width:100%;margin:8px 0;padding:8px;'; wrapper.appendChild(select); panel.appendChild(wrapper); // NEW
        const membership = await bridge.listRequests({ shareId: info.shareId }); if (!panel.isConnected) return; // NEW
        const eligible = membership.eligibleUsers || (users() ? users().listUsers().filter(u => !u.disabled && u.email) : []); // NEW: use the main process's existing canvas access policy.
        for (const user of eligible) { const option = document.createElement('option'); option.value = user.id; option.textContent = user.name + ' (' + user.email + ')'; select.appendChild(option); } // NEW
        if (!eligible.length) note(panel, 'No active users have an email address. Add an email and canvas access in People & Access before creating a computer invitation.'); // NEW
        const create = button('Create invitation', async () => { // NEW
            await saveCurrent(); await synchronizeContext(); const result = await bridge.createDeviceInvite({ shareId: info.shareId, userId: select.value }); // NEW
            if (!panel.isConnected) return; create.dataset.keepDisabled = 'true'; select.disabled = true; copyBlock(panel, 'Invitation — send to the person above', result.block); // NEW
            note(panel, 'This invitation is valid for 14 days. After they join, use Approve a computer to paste their returned reply.'); // NEW
            button('Open invitation email', async () => { const draft = await bridge.openEmailDraft({ to: result.email, subject: 'Trellis additional computer', body: 'On your other computer, choose Join another canvas and paste the invitation below. Send the generated approval reply back to an admin.\n\n' + result.block }); if (!draft.ok) throw new Error(draft.reason); }, panel); // NEW
        }, panel, 'add'); create.disabled = !eligible.length; // NEW
    } // NEW
    function showApproveComputer() { // NEW
        const panel = showDialog('Approve a computer', showSharingDialog); note(panel, 'Paste the complete approval reply returned after someone joined. Submitting queues a request; the computer that manages approvals must confirm it.'); // NEW
        const reply = field(panel, 'Returned approval reply', true); let requestId = null, checking = false; // NEW
        const approve = button('Submit approval', async () => { // NEW
            await saveCurrent(); await synchronizeContext(); const result = await bridge.requestMembership({ shareId: info.shareId, operation: 'approve', reply: reply.value.trim() }); // NEW
            if (!panel.isConnected) return; requestId = result.requestId; approve.dataset.keepDisabled = 'true'; reply.readOnly = true; panel.querySelector('[data-status]').textContent = 'Approval pending.'; await check(); // NEW
        }, panel, 'add'); approve.disabled = true; reply.addEventListener('input', () => { approve.disabled = !reply.value.trim(); }); // NEW
        async function check() { // NEW
            if (!requestId || checking || !panel.isConnected) return; checking = true; // NEW
            try { const result = await bridge.listRequests({ shareId: info.shareId }); if (!panel.isConnected) return; const item = (result.requests || []).find(r => r.id === requestId); const message = panel.querySelector('[data-status]'); if (item?.status === 'applied') message.textContent = 'Computer approved. It can now download and open this canvas.'; else if (item?.status === 'rejected') { message.textContent = 'Approval rejected: ' + item.reason; requestId = null; reply.readOnly = false; approve.dataset.keepDisabled = 'false'; approve.disabled = false; } else message.textContent = 'Approval pending.' + (lastStatus?.coordinatorConnected === false ? ' The approval-managing computer is offline.' : ''); } finally { checking = false; } // NEW
        } // NEW
        updateDialog = () => check().catch(err => { if (panel.isConnected) panel.querySelector('[data-status]').textContent = err.message; }); // NEW
        button('Check approval', check, panel, 'neutral'); // NEW
    } // NEW
    async function showSharingDialog() { // CHANGE
        await refresh(); const panel = showDialog('Canvas collaboration'); // CHANGE
        const canvasTitle = document.createElement('h3'); canvasTitle.textContent = info?.folderLabel || file()?.getTitle?.() || 'Current canvas'; panel.appendChild(canvasTitle); // NEW
        let copies = null, recoveryList = null; // NEW: refresh recovery entries without replacing their controls.
        const health = document.createElement('div'); health.style.cssText = 'padding:14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;line-height:1.6;'; health.setAttribute('aria-live', 'polite'); panel.appendChild(health); // NEW
        const people = document.createElement('div'); panel.appendChild(people); // NEW
        const update = () => { // NEW
            health.textContent = describeStatus() + '. ' + (isCollaborative() ? collaborationSummary() : info?.managed ? 'Saved files synchronize between approved computers.' : 'This canvas is not shared. Use Share on the garden toolbar to invite someone.') + (lastStatus?.reason ? ' ' + lastStatus.reason : '') + (collaboration?.recoveries?.length ? ' Rejected or recovered edits are available below.' : '') + (collaboration?.pending ? ' Waiting for missing change records.' : ''); // NEW
            if (recoveryList) { recoveryList.replaceChildren(); for (const copy of collaboration?.recoveries || []) { note(recoveryList, copy.reason || 'Recovery copy'); button('Open copy', () => { closeDialog(); if (ui.loadArgs) ui.loadArgs({ args: [copy.recoveryPath] }); }, recoveryList); note(recoveryList, copy.recoveryPath); } if (!collaboration?.recoveries?.length) note(recoveryList, localRecovery ? localRecovery.recoveryPath : 'No recovered edits.'); } // NEW
            people.replaceChildren(); note(people, lastStatus?.connectedCollaborators == null ? 'Collaborator connection status is unavailable.' : lastStatus.connectedCollaborators ? lastStatus.connectedCollaborators + ' connected collaborator' + (lastStatus.connectedCollaborators === 1 ? '' : 's') : 'No other collaborators are connected.'); // NEW
            for (const person of lastStatus?.collaborators || []) if (!collaboration?.holds.some(h => h.userId === person.id)) note(people, person.name || 'Unknown user'); // NEW
            for (const viewer of collaboration?.presence || []) for (const key of viewer.targets || []) if (!collaboration?.holds.some(h => h.key === key && h.sessionId === viewer.sessionId && h.deviceId === viewer.deviceId)) note(people, viewer.name + ' is viewing ' + objectLabel(key)); // NEW: the overview also lists viewing activity for hidden and other-page objects.
            for (const turn of collaboration?.reservations || []) note(people, (turn.sessionId === localSessionId ? 'Your next editing turn' : turn.name + ' has the next editing turn') + ' for ' + objectLabel(turn.key) + '. Begin within ' + Math.max(0, Math.ceil((turn.until - Date.now()) / 1000)) + ' seconds.'); // NEW
            for (const hold of collaboration?.holds || lastStatus?.collaboration?.holds || []) { const row = document.createElement('div'); row.style.margin = '8px 0'; note(row, hold.name + ' is editing ' + objectLabel(hold.key)); if (hold.sessionId === localSessionId) button('Release now', () => releaseHolds([hold.key]), row, 'neutral'); else button('Request release', () => coordinate({ kind: 'request', targets: [hold.key] }), row); if (hold.expiresAt) note(row, (hold.requested ? 'Release requested. Finish within ' : 'Hold expires after ') + Math.max(0, Math.ceil((hold.expiresAt - Date.now()) / 60000)) + (hold.requested ? ' min; this deadline cannot be extended.' : ' idle min. Request release to allow up to five minutes to finish.')); people.appendChild(row); } // NEW
        }; updateDialog = update; update(); // NEW
        button('Join another canvas', () => showJoinDialog(showSharingDialog), panel); // NEW
        if (!info?.managed) return; // NEW
        const pause = button(lastStatus?.state === 'paused' ? 'Resume syncing' : 'Pause syncing', async () => { await bridge.setPaused({ shareId: info.shareId, paused: lastStatus?.state !== 'paused' }); await refresh(); if (panel.isConnected) { pause.textContent = lastStatus?.state === 'paused' ? 'Resume syncing' : 'Pause syncing'; update(); } }, panel, 'neutral'); // NEW
        if (users()?.isAdmin()) { // NEW
            button('Add another computer', showAddComputer, panel); button('Approve a computer', showApproveComputer, panel); // NEW
            if (info.protocolVersion !== 2 && bridge.upgradeCollaboration) button('Enable object locking', async () => { // NEW
                const approved = await new Promise(resolve => ui.confirm('Upgrade this shared canvas? A verified recovery copy is kept. Collaborators must use the new invitation and an updated Trellis version. Older computers cannot publish into the upgraded project.', () => resolve(true), () => resolve(false), 'Upgrade', 'Cancel', false)); // NEW
                if (!approved) return; await saveCurrent(); await synchronizeContext(); await adoptCanvas(await bridge.upgradeCollaboration({ shareId: info.shareId })); await showSharingDialog(); // NEW
            }, panel, 'add'); // NEW
        } // NEW
        const technical = details(panel, 'Details'); note(technical, 'Sharing ID: ' + info.shareId + '\nLocal file: ' + info.diagramPath); // NEW
        copies = details(panel, 'Recovery copies'); recoveryList = document.createElement('div'); copies.appendChild(recoveryList); update(); // NEW
        button('Save recovery copy', async () => { localRecovery = await bridge.saveRecoveryCopy({ shareId: info.shareId, xml: ui.getFileData() }); note(copies, 'Saved: ' + localRecovery.recoveryPath); copies.open = true; }, copies, 'add'); // NEW
        if (users()?.isAdmin()) { // NEW
            const advanced = details(panel, 'Advanced — approved computers and replacement share'); // NEW
            bridge.listRequests({ shareId: info.shareId }).then(membership => { if (!advanced.isConnected) return; for (const member of membership.members || []) { const row = document.createElement('div'); const person = users().listUsers().find(u => u.id === member.userId); note(row, (person?.name || 'Unknown user') + (member.deviceId === info.deviceId ? ' · this computer' : '') + (member.deviceId === info.coordinatorDeviceId ? ' · manages approvals' : '') + '\nDevice: ' + member.deviceId); if (member.deviceId !== info.coordinatorDeviceId) button('Remove computer', async () => { const approved = await new Promise(resolve => ui.confirm('Remove this computer? This stops future sharing but cannot erase its downloaded copy.', () => resolve(true), () => resolve(false), 'Remove', 'Cancel', false)); if (approved) { await saveCurrent(); await synchronizeContext(); const result = await bridge.requestMembership({ shareId: info.shareId, operation: 'remove', targetDeviceId: member.deviceId }); panel.querySelector('[data-status]').textContent = 'Removal pending: ' + result.requestId; } }, row, 'danger'); advanced.appendChild(row); } }).catch(err => note(advanced, err.message)); // NEW
            note(advanced, 'Creating a replacement share requires everyone to join again. Use this only when the approval-managing computer cannot be recovered.'); // NEW
            button('Create replacement share', async () => { const approved = await new Promise(resolve => ui.confirm('Create a replacement share? Everyone must join again. A local recovery copy will be retained.', () => resolve(true), () => resolve(false), 'Create replacement', 'Cancel', false)); if (!approved) return; await bridge.saveRecoveryCopy({ shareId: info.shareId, xml: ui.getFileData() }); if (!conflicted) await saveCurrent(); await synchronizeContext(); await adoptCanvas(await bridge.recovery({ shareId: info.shareId })); await showSharingDialog(); }, advanced, 'danger'); // NEW
        } // NEW
        if (conflicted || lastStatus?.conflicts?.length) renderConflictTools(details(panel, 'Review conflicting saved versions')); // CHANGE: recovery controls appear only when they apply. // NEW
    } // CHANGE
    function renderConflictTools(panel) { // NEW: legacy recovery remains available during migration.
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
    } // NEW
    function objectLabel(key) { // NEW
        if (key === '*') return 'project structure'; // NEW
        const reported = collaboration?.holds.find(h => h.key === key)?.objectLabel || collaboration?.presence.flatMap(p => p.objects || []).find(o => o.key === key)?.label; // NEW
        if (reported) return reported; // NEW
        try { const [page, id] = JSON.parse(key), currentPage = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || '', cell = page === currentPage && graph.getModel?.().getCell(id); return cell && (cell.getAttribute?.('label') || cell.getAttribute?.('value') || graph.convertValueToString?.(cell)) || id + (page === currentPage ? ' (deleted or unavailable)' : ' (other page)'); } catch (_) { return 'unavailable object'; } // NEW
    } // NEW
    function selectedObjectKeys() { // NEW
        const pageId = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; return (graph.getSelectionCells?.() || []).map(cell => JSON.stringify([pageId, cell.id])); // NEW
    } // NEW
    async function coordinate(input) { // NEW
        if (!isCollaborative()) return null; const current = file(), shareId = info.shareId; await synchronizeContext(); // NEW
        const result = await bridge.collaborationAction({ shareId, ...input }); // NEW
        if (file() === current && info?.shareId === shareId) { collaboration = result.collaboration; localSessionId = collaboration?.sessionId || localSessionId; if (lastStatus) lastStatus.collaboration = collaboration; announce(); } return result; // NEW
    } // NEW
    async function releaseHolds(targets) { // NEW
        if (graph.isEditing?.()) { // NEW: finish a native label only at handoff, keeping ordinary autosave from closing the editor.
            stoppingForSave = true; // NEW
            try { graph.stopEditing(false); } finally { stoppingForSave = false; } // NEW
        } // NEW
        await saveCurrent(); return coordinate({ kind: 'release', targets }); // NEW
    } // NEW
    async function saveCollaborative(current, success, error) { // NEW
        const operation = async () => { // NEW
            await acquisitionPromise; if (file() !== current || !isCollaborative()) throw new Error('The project changed before saving.'); // NEW
            const captured = ui.getFileData(), baseline = collaborationBaseline || current.data; // NEW
            const claimIds = [...new Set((collaboration?.holds || []).filter(h => h.sessionId === localSessionId).map(h => h.claimId))]; // NEW: saves retain their editing generation; delayed drafts cannot reacquire a released hold.
            const result = await coordinate({ kind: 'save', baseXml: baseline, xml: captured, claimIds }); // NEW
            if (!result.ok) { status((result.reason || 'Editing hold lost.') + ' Recovery copy: ' + result.recoveryPath); if (ui.getFileData() === captured) applyRemote(result.xml, current); throw new Error((result.reason || 'Editing hold lost.') + ' Your changes were preserved: ' + result.recoveryPath); } // NEW
            current.stat = await request('fileStat', { file: current.fileObject.path }); current.data = result.xml; // NEW
            if (ui.getFileData() === captured) { collaborationBaseline = result.xml; if (captured !== result.xml) applyRemote(result.xml, current, current.stat); else { current.setModified(false); observedXml = captured; } } // NEW
            else if (current.patch && ui.diffPages && ui.getPagesForXml && ui.pages?.length) applyRemote(result.xml, current, current.stat, captured); // NEW: apply only differences returned by the captured save, leaving subsequent local changes intact.
            else { collaborationBaseline = captured; current.setModified(true); } // NEW: compatibility fallback keeps the captured object bases so unseen peer changes cannot be mistaken for local reversions.
            return new Promise((resolve, reject) => current.fileSaved(result.xml, null, () => { if (success) success(); resolve(); }, err => { reject(err); })); // NEW
        }; // NEW
        collaborationSave = collaborationSave.catch(() => {}).then(operation); // NEW
        return collaborationSave.catch(err => { if (error) error({ message: err.message }); else status('Autosave failed: ' + err.message); }); // NEW
    } // NEW
    let acquisitionPromise = Promise.resolve(); // NEW
    let stoppingForSave = false; // NEW: mxGraph emits editingStopped even when no label editor was open.
    let editingLabel = false, labelClaim = Promise.resolve(); // NEW: release only a label editor that actually opened.
    let pendingEdits = [], acquisitionObjects = new Set(), claimDispatched = false, policyActionPending = false; // NEW: one synchronous Users/domain action may produce several model edits before its atomic claim is sent.
    function editObjectIds(edit) { // NEW
        return (edit.changes || []).filter(change => !change.__trellisUsersActorStamp).map(change => { let cell = change.cell || change.child; if (!cell) return null; let planting = null; for (let cursor = cell; cursor; cursor = graph.getModel().getParent(cursor)) if (/(?:^|;)tiler_group=1(?:;|$)/.test(cursor.style || '') || cursor.getAttribute?.('planting_id')) planting = cursor; return (planting || cell).id; }).filter(Boolean); // NEW
    } // NEW
    function undoRejected(edit, reason) { // NEW
        const previous = graph.__trellisUsersInternalChange; graph.__trellisSharingApplying = true; graph.__trellisUsersInternalChange = true; // NEW
        try { for (const item of (Array.isArray(edit) ? [...edit].reverse() : [edit])) if (item?.undo) item.undo(); } finally { graph.__trellisSharingApplying = false; graph.__trellisUsersInternalChange = previous; observedXml = ui.getFileData(); } status(reason); // NEW
    } // NEW
    /** Reuse the existing all-or-nothing UndoableEdit rejection boundary. */ // NEW
    function installCollaborationHooks() { // NEW
        const model = graph.getModel?.(); if (!model?.addListener || model.__trellisCollaboration) return; model.__trellisCollaboration = true; // NEW
        model.addListener('change', (_sender, event) => { // NEW
            if (!isCollaborative() || graph.__trellisSharingApplying || graph.__trellisUsersRejecting || ui.openingFile) return; // NEW: authorized local Users actions use their internal flag and still need collaboration holds.
            const edit = event.getProperty?.('edit'); if (!edit?.changes?.some(change => !change.__trellisUsersActorStamp) || edit.__trellisUsersRejected) return; // NEW
            const after = ui.getFileData(), before = observedXml || collaborationBaseline || file().data; // NEW
            if (acquiring) { if (!claimDispatched || editObjectIds(edit).every(id => acquisitionObjects.has(id))) { pendingEdits.push(edit); policyActionPending ||= !!graph.__trellisUsersInternalChange; for (const id of editObjectIds(edit)) acquisitionObjects.add(id); observedXml = after; return; } bridge.saveRecoveryCopy({ shareId: info.shareId, xml: after }).catch(err => status(err.message)); undoRejected(edit, 'Wait for the pending editing hold before changing another object.'); return; } // NEW
            acquiring = true; claimDispatched = false; policyActionPending = !!graph.__trellisUsersInternalChange; pendingEdits = [edit]; acquisitionObjects = new Set(editObjectIds(edit)); const current = file(), generation = contextGeneration; // NEW
            acquisitionPromise = Promise.resolve().then(() => { claimDispatched = true; return coordinate({ kind: 'claim', baseXml: before, xml: ui.getFileData(), usersPolicyAction: policyActionPending }); }).then(async result => { // NEW: batch synchronous account/login changes into one claim before capturing the actor context.
                if (file() !== current) return; // NEW
                if (!result.ok) { const copy = await bridge.saveRecoveryCopy({ shareId: info.shareId, xml: ui.getFileData() }); if (file() === current) undoRejected(pendingEdits, result.reason + ' Recovery copy: ' + copy.recoveryPath); } // NEW: preserve continued typing durably before rolling back a losing action.
                else { observedXml = ui.getFileData(); editingForm = document.activeElement?.closest?.('[role="dialog"],.geDialog,.usl-scheduler-dialog'); } // NEW
            }).catch(async err => { // NEW
                if (file() !== current) return; // NEW
                try { const copy = await bridge.saveRecoveryCopy({ shareId: info.shareId, xml: ui.getFileData() }); if (file() === current) undoRejected(pendingEdits, err.message + ' Recovery copy: ' + copy.recoveryPath); } // NEW
                catch (copyError) { status('The draft remains open because its recovery copy could not be saved: ' + copyError.message); } // NEW
            }).finally(() => { if (generation === contextGeneration) { acquiring = false; pendingEdits = []; acquisitionObjects.clear(); } }); // NEW
        }); // NEW
        graph.getSelectionModel?.().addListener('change', () => { // NEW
            if (!isCollaborative() || graph.__trellisSharingApplying) return; const objects = selectedObjectKeys(); // NEW
            const holds = collaboration?.holds.filter(h => h.sessionId === localSessionId) || []; // NEW
            const leaving = holds.filter(h => !objects.includes(h.key) && !objects.some(k => { try { let cell = model.getCell(JSON.parse(k)[1]); while (cell) { if (cell.id === JSON.parse(h.key)[1]) return true; cell = model.getParent(cell); } } catch (_) {} return false; })).map(h => h.key); // NEW
            const update = async () => { await acquisitionPromise; if (leaving.length) await releaseHolds(leaving); await coordinate({ kind: 'view', objects }); }; update().catch(err => status(err.message)); // NEW
        }); // NEW
    } // NEW
    let formActivityTimer = null; // NEW
    document.addEventListener('input', event => { // NEW: form drafts reserve their object on actual typing, before Apply mutates the model.
        if (!isCollaborative() || !event.isTrusted || event.target.closest('.trellis-collaboration-dialog,.trellis-garden-share-dialog')) return; // NEW
        const labelCell = editingLabel && graph.cellEditor?.textarea?.contains(event.target) ? graph.cellEditor.editingCell : null; // NEW
        if (labelCell) { // NEW: contenteditable native labels count as editing activity; viewing does not.
            const page = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; // NEW
            window.clearTimeout(formActivityTimer); formActivityTimer = window.setTimeout(() => coordinate({ kind: 'claim', targets: [JSON.stringify([page, labelCell.id])] }).catch(err => status(err.message)), 250); return; // NEW
        } // NEW
        if (!event.target.matches?.('input,textarea,select')) return; // NEW
        const binding = event.target.closest('[data-collaboration-object-id],[data-spacing-row-cell]'); // NEW
        const form = event.target.closest('[role="dialog"],.geDialog,.usl-scheduler-dialog'); if (!binding && !form) return; // NEW
        const page = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; // NEW
        const id = binding?.dataset.collaborationObjectId || binding?.dataset.spacingRowCell; const targets = id ? [JSON.stringify([page, id])] : selectedObjectKeys(); if (!targets.length) return; // NEW
        editingForm = form || binding; window.clearTimeout(formActivityTimer); // NEW
        formActivityTimer = window.setTimeout(() => coordinate({ kind: 'claim', targets }).then(result => { if (!result.ok && editingForm?.isConnected) { let message = editingForm.querySelector('[data-collaboration-notice]'); if (!message) { message = note(editingForm, ''); message.dataset.collaborationNotice = ''; message.setAttribute('role', 'status'); } message.textContent = result.reason + ' Your form entries remain here. Request release before applying them.'; } }).catch(err => status(err.message)), 250); // NEW
    }, true); // NEW
    let badgeLayer = null, badgeFingerprint = '', popover = null, popoverKey = null, popoverPinned = false, popoverTimer = null; // NEW
    function closeObjectPopover() { if (popover) popover.remove(); popover = null; popoverKey = null; popoverPinned = false; window.clearTimeout(popoverTimer); } // NEW
    function updateObjectPopover() { // NEW: live coordination details preserve focus and pinned state.
        if (!popover) return; // NEW
        const hold = collaboration?.holds.find(h => h.key === popoverKey), turn = collaboration?.reservations?.find(r => r.key === popoverKey); // NEW
        const message = popover.querySelector('[data-editing-status]'), action = popover.querySelector('[data-hold-action]'); // NEW
        message.textContent = hold ? hold.name + ' is editing.' + (hold.requested ? ' Release requested; ' + Math.max(0, Math.ceil((hold.expiresAt - Date.now()) / 1000)) + ' seconds left to finish.' : ' Holds release after five idle minutes.') : turn ? turn.name + ' has the next turn. Begin within ' + Math.max(0, Math.ceil((turn.until - Date.now()) / 1000)) + ' seconds.' : 'No editing hold is currently reported.'; // NEW
        action.hidden = !hold; action.textContent = hold?.sessionId === localSessionId ? 'Release now' : 'Request release'; // NEW
    } // NEW
    function showObjectPopover(key, anchor, pinned) { // NEW
        window.clearTimeout(popoverTimer); if (popoverKey === key && popover) { if (pinned) { popoverPinned = !popoverPinned; if (popoverPinned) popover.querySelector('button:not([hidden])')?.focus(); } return; } closeObjectPopover(); // NEW
        popoverKey = key; popoverPinned = !!pinned; popover = document.createElement('section'); popover.setAttribute('role', 'dialog'); popover.setAttribute('aria-label', 'Activity for ' + objectLabel(key)); // NEW
        popover.style.cssText = 'position:fixed;z-index:2147483099;width:300px;max-width:calc(100vw - 24px);max-height:300px;overflow:auto;padding:12px;background:#fff;color:#111827;border:1px solid #9ca3af;border-radius:6px;box-shadow:0 6px 18px #0003;font:13px Arial;'; // NEW
        const bounds = anchor.getBoundingClientRect(); popover.style.left = Math.max(12, Math.min(bounds.left, window.innerWidth - 324)) + 'px'; popover.style.top = Math.max(12, Math.min(bounds.bottom + 4, window.innerHeight - 312)) + 'px'; // NEW
        note(popover, objectLabel(key)); // NEW
        for (const viewer of collaboration?.presence.filter(p => p.targets.includes(key)) || []) note(popover, viewer.name + ' is viewing'); // NEW
        note(popover, '').dataset.editingStatus = ''; // NEW
        const action = button('Request release', async () => { const hold = collaboration?.holds.find(h => h.key === key); if (hold?.sessionId === localSessionId) await releaseHolds([key]); else if (hold) await coordinate({ kind: 'request', targets: [key] }); updateObjectPopover(); }, popover); action.dataset.holdAction = ''; updateObjectPopover(); // NEW
        note(popover, (lastStatus?.connectedPeers ?? lastStatus?.connectedCollaborators) ? 'Activity is reported by peers; updates may be delayed.' : 'Working locally — holds are unconfirmed.'); // NEW
        button('Close', closeObjectPopover, popover, 'close'); // NEW
        for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click', 'keydown', 'keypress', 'keyup']) popover.addEventListener(type, e => { e.stopPropagation(); if (e.key === 'Escape') closeObjectPopover(); }); // NEW
        popover.addEventListener('mouseenter', () => window.clearTimeout(popoverTimer)); popover.addEventListener('mouseleave', () => { if (!popoverPinned) popoverTimer = window.setTimeout(closeObjectPopover, 90); }); document.body.appendChild(popover); if (pinned) popover.querySelector('button:not([hidden])')?.focus(); // NEW
    } // NEW
    function renderBadges() { // NEW
        if (!graph.container || !isCollaborative()) { badgeLayer?.remove(); badgeLayer = null; badgeFingerprint = ''; closeObjectPopover(); return; } // NEW
        const entries = new Map(), pageId = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; // NEW
        for (const viewer of collaboration?.presence || []) for (const key of viewer.targets) { const list = entries.get(key) || []; if (!collaboration?.holds.some(h => h.key === key && h.sessionId === viewer.sessionId)) list.push(viewer.name + ' · viewing'); entries.set(key, list); } // NEW
        for (const holder of collaboration?.holds || []) { const list = entries.get(holder.key) || []; list.push(holder.name + ' · editing'); entries.set(holder.key, list); } // NEW
        for (const turn of collaboration?.reservations || []) { const list = entries.get(turn.key) || []; list.push(turn.name + ' · next turn'); entries.set(turn.key, list); } // NEW
        const fingerprint = JSON.stringify([pageId, ...entries]); // NEW: switching pages rebuilds badges even when peer activity is unchanged.
        if (!badgeLayer) { badgeLayer = document.createElement('div'); badgeLayer.dataset.collaborationBadges = ''; badgeLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:20;'; graph.container.appendChild(badgeLayer); } // NEW
        if (fingerprint !== badgeFingerprint) { // NEW
            badgeFingerprint = fingerprint; badgeLayer.replaceChildren(); // NEW
            for (const [key, labels] of entries) { // NEW
                if (key === '*') continue; const [page, id] = JSON.parse(key); if (page !== pageId) continue; const cell = graph.getModel?.().getCell(id); if (!cell) continue; // NEW
                const badge = button(labels.join(' · '), () => showObjectPopover(key, badge, true), badgeLayer); badge.dataset.objectKey = key; badge.title = labels.join('\n'); badge.setAttribute('aria-label', objectLabel(key) + ': ' + labels.join(', ')); // NEW
                badge.style.cssText += 'position:absolute;pointer-events:auto;font-size:11px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:#fff;'; // NEW
                for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click', 'keydown', 'keypress', 'keyup']) badge.addEventListener(type, e => { e.stopPropagation(); if (e.key === 'Escape') closeObjectPopover(); }); // NEW
                badge.addEventListener('mouseenter', () => showObjectPopover(key, badge, false)); badge.addEventListener('focus', () => showObjectPopover(key, badge, false)); badge.addEventListener('mouseleave', () => { if (!popoverPinned) popoverTimer = window.setTimeout(closeObjectPopover, 90); }); // NEW
            } // NEW
        } // NEW
        for (const badge of badgeLayer.querySelectorAll('[data-object-key]')) { const [, id] = JSON.parse(badge.dataset.objectKey), cell = graph.getModel?.().getCell(id), state = graph.view?.getState(cell); badge.hidden = !state; if (state) { badge.style.left = state.x + state.width + 4 + 'px'; badge.style.top = state.y + 'px'; } } // NEW
        updateObjectPopover(); // NEW
    } // NEW
    const collaborationTimer = window.setInterval(async () => { // NEW
        if (!isCollaborative() || acquiring) return; try { // NEW
            if (editingForm && !editingForm.isConnected) { editingForm = null; await releaseHolds(); } // NEW
            const result = await coordinate({ kind: 'view', objects: selectedObjectKeys() }); // NEW
            if (result?.xml && !file()?.isModified() && result.xml !== collaborationBaseline) applyRemote(result.xml, file()); // NEW
        } catch (err) { status(err.message); } // NEW
    }, 5000); // NEW
    window.addEventListener('beforeunload', () => { window.clearInterval(collaborationTimer); closeObjectPopover(); }); // NEW
    if (graph.view?.addListener) for (const event of ['scale', 'translate', 'scaleAndTranslate']) graph.view.addListener(event, renderBadges); // NEW
    ui.editor.addListener?.('pageSelected', renderBadges); // NEW
    installCollaborationHooks(); // NEW
    if (graph.addListener) { // NEW: explicit native label-editing intent acquires a hold before text is committed.
        graph.addListener('startEditing', (_sender, event) => { if (!isCollaborative()) return; const cell = event.getProperty?.('cell') || graph.getSelectionCell?.(); if (!cell) return; const page = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; labelClaim = coordinate({ kind: 'claim', targets: [JSON.stringify([page, cell.id])] }).then(result => { if (!result.ok) { graph.stopEditing?.(true); status(result.reason); } }).catch(err => status(err.message)); }); // NEW
        graph.addListener('editingStarted', () => { editingLabel = true; }); // NEW
        graph.addListener('editingStopped', () => { const wasEditing = editingLabel; editingLabel = false; if (!wasEditing || stoppingForSave || !isCollaborative()) return; labelClaim.then(() => { if (collaboration?.holds.some(h => h.sessionId === localSessionId)) return releaseHolds(); }).catch(err => status(err.message)); }); // NEW
    } // NEW
    window.Trellis = window.Trellis || {};
    window.Trellis.sharing = { ensureManaged, prepareInvite, showJoinDialog, showSharingDialog, refresh, context, describeStatus, getStatus: () => lastStatus, getInfo: () => info, isApplyingRemote: () => !!graph.__trellisSharingApplying };
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
        if (lastStatus && lastStatus.state === 'conflict' && !isCollaborative()) pauseAutosave(); // CHANGE
        if (lastStatus?.collaboration) collaboration = { ...lastStatus.collaboration, sessionId: localSessionId }; // NEW
        if (lastStatus && info) importNewHistory().catch(err => status(err.message));
        announce();
    });
    ui.editor.addListener('fileLoaded', () => { contextGeneration++; window.clearTimeout(formActivityTimer); closeDialog(); acquiring = false; pendingEdits = []; acquisitionObjects.clear(); info = null; collaborationBaseline = null; observedXml = null; localSessionId = null; collaboration = null; closeObjectPopover(); conflicted = false; localRecovery = null; remoteBaselinePending = false; queuedHistory.clear(); importedIds.clear(); publishedIds.clear(); installFileHooks(); refresh(); }); // CHANGE: do not reuse a previous canvas's remote baseline.
    installFileHooks();
    refresh();
});
