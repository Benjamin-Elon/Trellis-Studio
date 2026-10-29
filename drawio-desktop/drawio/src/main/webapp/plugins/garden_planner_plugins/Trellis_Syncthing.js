// NEW: Renderer orchestration for managed canvas sharing; credentials stay in Electron.
Draw.loadPlugin(function (ui) {
    'use strict';
    window.TrellisLocalView?.install(ui); // NEW: local-only diagrams use the same folding mechanics.
    const bridge = window.trellisShare;
    if (!bridge || typeof bridge.setContext !== 'function') return;
    const graph = ui.editor.graph;
    const editContext = window.TrellisEditContext?.install(ui); // NEW: automation and manual changes can coexist in one native edit.
    let info = null;
    let lastStatus = null;
    let refreshing = false;
    let identityJoinInProgress = false; // NEW: guided authentication acquires its account hold after opening the authenticated collaboration session.
    let refreshFinished = null, finishRefresh = null; // NEW: callers opening a dialog await an in-flight context refresh.
    let importRunning = false;
    let dialog = null;
    let savedQueue = Promise.resolve();
    let saveOperationSequence = 0; // NEW: diagnostic IDs carry no document or invitation contents.
    const importedIds = new Set();
    const publishedIds = new Set();
    const queuedHistory = new Map();
    let localRecovery = null;
    let remoteBaselinePending = false; // NEW: imported history may arrive after its diagram replacement.
    let modelRevision = 0, tracksModelChanges = false, remoteReadTask = null; // CHANGE: invalidate captures without serializing the live graph.
    let background = null, backgroundFile = null, dirtyObjects = new Set(), savedObjects = new Map(), conflictDialog = null; // NEW
    let assetAvailability = null, assetSequence = null; // CHANGE: retain observations independently of mutable status objects.
    const explicitMode = !window.__trellisLiveUpdatesForBenchmark; // CHANGE: missing review code must never silently enable automatic content updates.
    let incoming = null, viewIdentity = null, pendingHash = null, refreshingTargets = new Set(), formTargets = []; // NEW
    const releasingClaims = new Set(); // NEW: intentional handoffs must not produce hold-loss discard notices.
    let refreshSaveBarrier = Promise.resolve(); // NEW: autosave waits until incoming patches are acknowledged or restored.
    let indexedPending = null, pendingKeys = new Set(), pendingStructure = false; // NEW
    const timings = value => { try { window.TrellisSyncTiming?.({ ...value, diagramId: info?.diagramId }); } catch (_) {} }; // CHANGE: diagnostics never alter save completion. // NEW
    const users = () => graph.__trellisUsers || window.Trellis && window.Trellis.users;
    const file = () => ui.getCurrentFile && ui.getCurrentFile();
    const history = () => graph.__trellisHistory || window.Trellis && window.Trellis.history;
    if (ui.setStatusText && ui.statusContainer) { // NEW: trusted UI callbacks receive real controls after document HTML sanitization.
        const renderStatus = ui.setStatusText; // NEW
        ui.setStatusText = function () { // NEW
            const result = renderStatus.apply(this, arguments), current = file(), generation = contextGeneration; // NEW
            const message = ui.statusContainer.textContent, syncMessage = window.mxResources?.get?.('fileChangedSync'); // NEW
            const callback = ui.editor.statusFunction || (current && syncMessage && message.includes(syncMessage) ? () => ui.synchronizeCurrentFile?.(false) : null); // NEW
            if (typeof callback === 'function' && message) { // NEW
                const container = document.createElement('div'), control = document.createElement('button'); container.className = 'geStatusAlert'; container.dataset.action = 'statusFunction'; control.type = 'button'; control.textContent = message; // NEW
                control.addEventListener('click', event => { event.stopPropagation(); if (file() === current && generation === contextGeneration) callback(); }); // NEW
                control.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); control.click(); } }); // NEW
                container.appendChild(control); ui.statusContainer.replaceChildren(container); // NEW: no document markup or sanitizer exemption is introduced.
            } // NEW
            return result; // NEW
        }; // NEW
    } // NEW
    function pathKey(value) { // NEW: filesystem identity must survive Windows slash and drive-letter variations.
        const normalized = String(value || '').replace(/\\/g, '/'); return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized; // NEW
    } // NEW
    function context() {
        const current = file();
        const parent = graph.getDefaultParent();
        const diagramId = history() && history().getDiagramId ? history().getDiagramId() : parent.getAttribute && (parent.getAttribute('trellis_history_id') || parent.getAttribute('trellis_users_diagram_id'));
        return { documentGeneration: contextGeneration, diagramPath: current && current.fileObject && current.fileObject.path || null, diagramId: diagramId || '', userId: users() && users().getCurrentUser() && users().getCurrentUser().id || '' };
    }
    function request(action, payload) {
        return new Promise((resolve, reject) => window.electron.request({ action, ...payload }, resolve, message => reject(new Error(message))));
    }
    async function hash(text) {
        const bytes = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(bytes)).map(value => value.toString(16).padStart(2, '0')).join('');
    }
    function status(message) { if (ui.editor.setStatus) ui.editor.setStatus(String(message)); }
    function objectFingerprint(key) { // NEW: encode only the affected cell; never serialize the whole document for a badge.
        if (key === '*') return ui.getFileData(); // NEW: genuinely project-wide structural changes require the complete envelope.
        const [page, id] = JSON.parse(key), currentPage = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; // NEW
        let cell = page === currentPage ? graph.getModel().getCell?.(id) : null; // CHANGE
        if (!cell) { const target = ui.pages?.find(item => (item.getId?.() || item.node?.getAttribute('id') || '') === page); const visit = value => { if (!value) return null; if (String(value.id) === id) return value; for (const child of value.children || []) { const found = visit(child); if (found) return found; } return null; }; cell = visit(target?.root); } // NEW
        if (!cell) return null; // NEW
        const encode = () => mxUtils.getXml(new mxCodec().encode(cell)); // NEW
        return graph.__trellisLocalView?.canonical ? graph.__trellisLocalView.canonical(encode) : encode(); // NEW
    } // NEW
    function resetObjectBaselines() { // NEW
        savedObjects = new Map(); dirtyObjects = new Set(); // NEW
        const currentPage = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; // NEW
        const visit = (cell, page) => { if (!cell) return; const key = JSON.stringify([page, String(cell.id)]); savedObjects.set(key, objectFingerprint(key)); for (const child of cell.children || []) visit(child, page); }; // NEW
        if (ui.pages?.length) for (const page of ui.pages) visit(page.root, page.getId?.() || page.node?.getAttribute('id') || ''); // NEW
        else visit(graph.getModel().getRoot?.(), currentPage); // NEW
    } // NEW
    function pendingObjects() { // NEW
        const tracked = dirtyObjects.size; // NEW
        for (const key of dirtyObjects) if ((savedObjects.get(key) || null) === objectFingerprint(key)) dirtyObjects.delete(key); // NEW
        if (tracked && !dirtyObjects.size && !holdEditors?.pinnedTargets().length) file()?.setModified(false); // NEW: undo to the saved baseline must not launch a no-op content save.
        return [...dirtyObjects]; // NEW
    } // NEW
    function startBackground() { // NEW
        const current = file(); if (!isCollaborative() || backgroundFile === current || !window.TrellisBackgroundSaving || !bridge.activityAction || !bridge.recoveryAction) return; // NEW
        background?.dispose(); backgroundFile = current; resetObjectBaselines(); current.autosaveDelay = 5000; current.maxAutosaveDelay = Infinity; // NEW
        const generation = contextGeneration, shareId = info.shareId, expectedUserId = context().userId; // CHANGE
        background = window.TrellisBackgroundSaving.create({ // NEW
            pending: pendingObjects, viewing: selectedObjectKeys, revision: () => modelRevision, // NEW
            dirty: () => !window.__trellisClosing && (current.isModified() || !!holdEditors?.pinnedTargets().length), // CHANGE
            publish: async input => { if (file() !== current || generation !== contextGeneration) return; const result = await bridge.activityAction({ shareId, expectedUserId, ...input }); if (file() === current && generation === contextGeneration) adoptActivity(result.collaboration); }, // CHANGE
            capture: () => ({ kind: 'checkpoint', shareId, expectedUserId, revision: modelRevision, baseXml: collaborationBaseline || current.data, xml: ui.getFileData(), editorDrafts: holdEditors?.capture(['*']) || [] }), // CHANGE
            checkpoint: input => bridge.recoveryAction(input), report: status, // NEW
        }); // NEW
        current.isAutosaveNow = function () { this.__trellisAutomaticRequest = true; return true; }; // NEW: native autosave identifies its call synchronously; explicit Save remains an immediate flush.
        current.__trellisCheckpoint = () => backgroundFile === current ? background.checkpoint(true) : Promise.resolve(); // NEW
        current.__trellisDiscardCheckpoint = () => bridge.recoveryAction({ shareId, kind: 'discard', revision: modelRevision }); // NEW
        const previousDraft = current.saveDraft; // NEW
        current.saveDraft = function () { if (file() === current && backgroundFile === current) return background.checkpoint().catch(error => status('Recovery checkpoint failed: ' + error.message)); return previousDraft?.apply(this, arguments); }; // NEW
        const previousUnsaved = current.addUnsavedStatus; // NEW
        current.addUnsavedStatus = function () { const result = previousUnsaved?.apply(this, arguments); if (backgroundFile === current && this.saveDraftThread != null) { window.clearTimeout(this.saveDraftThread); this.saveDraftThread = null; } return result; }; // NEW: the independent ten-second timer owns recovery scheduling for this file.
        bridge.recoveryAction({ shareId, kind: 'restore' }).then(result => { if (file() === current && generation === contextGeneration) { current.__trellisRecoveredDrafts = (result.drafts || []).filter(draft => draft.xml !== draft.baseXml || draft.editorDrafts?.length); if (current.__trellisRecoveredDrafts.length) status('A private local draft is available in Sharing → Recovery copies.'); } }).catch(error => status(error.message)); // NEW
        void background.publish(); // NEW
    } // NEW
    function adoptActivity(next) { // NEW
        if (!next || !isCollaborative()) return; // CHANGE
        const started = window.performance.now(); // NEW
        const people = users()?.listUsers?.() || [], named = value => ({ ...value, name: people.find(user => user.id === value.userId)?.name || value.name || value.userId }); // NEW
        collaboration = { ...collaboration, ...next, holds: (next.holds || []).map(named), presence: (next.presence || []).map(named), pendingChanges: (next.pendingChanges || []).map(named) }; localSessionId = next.sessionId || localSessionId; // CHANGE
        if (lastStatus) lastStatus.collaboration = collaboration; holdEditors?.update(collaboration.holds, localSessionId); announce(); // NEW
        timings({ phase: 'activity render', durationMs: window.performance.now() - started }); // NEW
        if (window.TrellisSyncTiming && window.requestAnimationFrame) window.requestAnimationFrame(() => timings({ phase: 'activity paint', durationMs: window.performance.now() - started })); // NEW
    } // NEW
    function applyDraftResolution(resolution, current) { // NEW
        applyRemote(resolution.baseXml, current); resetObjectBaselines(); applyRemote(resolution.remainingXml, current); // NEW
        collaborationBaseline = resolution.baseXml; current.data = resolution.baseXml; observedXml = resolution.remainingXml; // NEW
        for (const group of resolution.review.groups) for (const key of group.keys) dirtyObjects.add(key); // NEW
        current.setModified(!!resolution.remaining?.length); current.__trellisConflict = resolution.remaining?.length ? true : null; // NEW
        background?.state(resolution.remaining?.length ? 'conflict' : 'saved'); pendingObjects(); renderBadges(); // NEW
    } // NEW
    async function showDraftConflicts() { // NEW
        const current = file(), generation = contextGeneration, revision = modelRevision, baseXml = collaborationBaseline || current.data, xml = ui.getFileData(); // NEW
        const result = await coordinate({ kind: 'draft-review', baseXml, xml }); // NEW
        if (!result || file() !== current || generation !== contextGeneration) return; // NEW
        const root = showDialog('Review local changes', showSharingDialog); // CHANGE: reuse the existing focus trap, keyboard handling and semantic controls.
        const selected = new Map(), message = document.createElement('p'), overlay = root.closest('.trellis-collaboration-dialog'); let submitting = false; root.appendChild(message); // CHANGE
        for (const group of result.review.groups) { // NEW
            const section = document.createElement('details'); section.open = true; const heading = document.createElement('summary'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = true; check.setAttribute('aria-label', 'Select ' + group.labels.join(', ')); selected.set(group.id, check); heading.appendChild(check); heading.appendChild(document.createTextNode(' ' + group.labels.join(', ') + (group.conflict ? ' · conflict' : ' · non-conflicting'))); section.appendChild(heading); // NEW
            for (const detail of group.details || []) for (const field of detail.fields) { const comparison = document.createElement('pre'); comparison.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;'; comparison.textContent = field.name + '\nBefore: ' + field.before + '\nAccepted: ' + field.accepted + '\nMine: ' + field.mine; section.appendChild(comparison); } // NEW
            check.addEventListener('change', () => updatePartial()); root.appendChild(section); // CHANGE: partial application follows the reviewed selection.
        } // NEW
        const actions = document.createElement('div'); root.appendChild(actions); // NEW
        const resolve = async mode => { // NEW
            if (file() !== current || generation !== contextGeneration || revision !== modelRevision) { message.textContent = 'Your draft changed. Close this review and reopen it.'; return; } // NEW
            const groups = [...selected].filter(([, check]) => check.checked).map(([id]) => id); // NEW
            if (!groups.length) { message.textContent = 'Select at least one complete change group.'; return; } // NEW
            submitting = true; overlay.__submitting = true; for (const control of root.querySelectorAll('button,input')) control.disabled = true; // CHANGE
            try { // NEW
                await background?.checkpoint(true); // NEW
                const applied = await coordinate({ kind: 'draft-resolve', baseXml, xml, token: result.review.token, groups, mode, editorDrafts: holdEditors?.capture(['*']) || [] }); // NEW
                if (!applied?.ok) { message.textContent = applied?.reason || 'Resolution failed. Your draft is retained.'; return; } // NEW
                if (file() !== current || generation !== contextGeneration || revision !== modelRevision) { message.textContent = 'The document changed. Reopen the review; the original draft remains preserved.'; return; } // NEW
                applyDraftResolution(applied.resolution, current); await background?.checkpoint(true); overlay.__submitting = false; closeDialog(); conflictDialog = null; // CHANGE
            } catch (error) { message.textContent = error.message; } // NEW
            finally { submitting = false; overlay.__submitting = false; for (const control of root.querySelectorAll('button,input')) control.disabled = false; updatePartial(); } // CHANGE
        }; // NEW
        button('Keep accepted version', () => resolve('accepted'), actions, 'neutral'); button('Apply my version', () => resolve('mine'), actions, 'add'); // NEW
        const partial = button('Apply non-conflicting edits', () => resolve('non-conflicting'), actions, 'add'); // CHANGE
        function updatePartial() { partial.disabled = submitting || !result.review.groups.some(group => selected.get(group.id)?.checked && !group.conflict && !group.alreadyApplied); partial.dataset.keepDisabled = String(partial.disabled); } updatePartial(); // NEW
        button('Resolve later', async () => { await background?.checkpoint(true); closeDialog(); conflictDialog = null; }, actions, 'close'); // CHANGE
        conflictDialog = root; // CHANGE
    } // NEW
    async function showPrivateDrafts() { // NEW
        const current = file(), generation = contextGeneration, result = await bridge.recoveryAction({ shareId: info.shareId, kind: 'restore' }); // NEW
        if (file() !== current || generation !== contextGeneration) return; // NEW
        const panel = showDialog('Private recovery drafts', showSharingDialog), drafts = (result.drafts || []).filter(draft => draft.xml !== draft.baseXml || draft.editorDrafts?.length); // NEW
        if (!drafts.length) note(panel, 'No pending private drafts.'); // NEW
        for (const draft of drafts) { // NEW
            const section = details(panel, 'Draft saved ' + new Date(draft.at).toLocaleString()); // NEW
            button('Recover this draft', async () => { // NEW
                if (file() !== current || generation !== contextGeneration) throw new Error('The project changed.'); // NEW
                await background?.checkpoint(true); applyRemote(draft.baseXml, current); resetObjectBaselines(); applyRemote(draft.xml, current); // NEW
                collaborationBaseline = draft.baseXml; current.data = draft.baseXml; observedXml = draft.xml; modelRevision = Math.max(modelRevision, draft.revision) + 1; // NEW
                for (const key of savedObjects.keys()) dirtyObjects.add(key); // NEW
                const page = ui.currentPage?.getId?.() || ''; for (const id of Object.keys(graph.getModel().cells || {})) dirtyObjects.add(JSON.stringify([page, id])); // NEW
                current.setModified(true); current.__trellisConflict = true; background?.state('conflict'); closeDialog(); await showDraftConflicts(); // NEW
            }, section, 'open'); // NEW
            if (draft.editorDrafts?.length) { const data = document.createElement('textarea'); data.readOnly = true; data.setAttribute('aria-label', 'Recovered editor entries'); data.value = JSON.stringify(draft.editorDrafts, null, 2); data.style.cssText = 'width:100%;height:160px;'; section.appendChild(data); note(section, 'Unapplied editor entries are preserved here for inspection and copying.'); } // NEW
        } // NEW
    } // NEW
    function announce() {
        window.dispatchEvent(new window.CustomEvent('trellisSharingStatusChanged', { detail: { info, status: lastStatus } }));
        if (updateDialog) updateDialog(); renderBadges(); // NEW: update status only; never rebuild active forms.
    }
    /** Progress belongs to one file and must never block a save if an observer fails. */ // NEW
    function saveProgress(current, stage) { // NEW
        current.__trellisSaveStage = stage; // NEW
        for (const listener of current.__trellisSaveObservers || []) { try { listener(stage); } catch (_) {} } // NEW
    } // NEW
    async function saveCurrent(options = {}) { // CHANGE
        const current = file(); // CHANGE
        if (!current) throw new Error('Open a canvas before sharing.'); // CHANGE
        const listeners = current.__trellisSaveObservers ||= new Set(), observer = options.onProgress; // NEW
        if (observer) listeners.add(observer); // NEW
        try { // NEW
            if (observer) { try { observer(current.__trellisSaveStage || 'queued'); } catch (_) {} } // NEW
            await new Promise((resolve, reject) => current.save(false, resolve, error => reject(new Error(error && error.message || String(error))), undefined, undefined, () => reject(new Error('Save cancelled. The invitation has not been prepared.')))); // CHANGE
        } finally { if (observer) listeners.delete(observer); } // NEW
    } // CHANGE
    async function synchronizeContext() {
        if (ui.watchFile && file()) await ui.watchFile(file());
        await bridge.setContext(context());
    }
    let documentReady = null, classifiedFile = null; // NEW: one readiness result belongs to one document, actor and generation.
    function invalidateDocumentReady() { // NEW: obsolete waiters fail immediately, even if their old request never returns.
        if (documentReady && !documentReady.settled) { documentReady.settled = true; documentReady.reject(new Error('The user or document changed during initialization.')); } // NEW
        documentReady = null; // NEW
    } // NEW
    function settleDocumentReady(error) { // NEW
        const entry = documentReady; if (!entry || entry.settled || entry.actor === null) return; // NEW
        if (file() !== entry.file || contextGeneration !== entry.generation || context().userId !== entry.actor) error = new Error('The user or document changed during initialization.'); // NEW
        if (!error && info?.managed && !entry.actor) error = new Error('Log in before initializing this garden project.'); // NEW
        if (!error && (classifiedFile !== entry.file || isCollaborative() && (!graph.__trellisSharedPolicy || explicitMode && viewIdentity !== entry.actor))) return; // CHANGE
        entry.settled = true; // NEW
        if (error) { entry.error = error; entry.reject(error); } else entry.resolve({ file: entry.file, userId: entry.actor, diagramId: context().diagramId, generation: entry.generation, managed: !!info?.managed }); // NEW
    } // NEW
    function whenDocumentReady() { // NEW
        const current = file(), actor = context().userId; // NEW
        if (documentReady && !documentReady.error && documentReady.file === current && documentReady.generation === contextGeneration && (documentReady.actor === null || documentReady.actor === actor)) return documentReady.promise; // NEW
        invalidateDocumentReady(); // CHANGE
        const entry = { file: current, generation: contextGeneration, actor: null, settled: false }; // NEW
        entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; }); documentReady = entry; // NEW
        Promise.resolve().then(async () => { // NEW
            await users()?.restorePortableLogin?.(); // NEW
            if (file() !== current || contextGeneration !== entry.generation || documentReady !== entry) throw new Error('The document changed during initialization.'); // NEW
            entry.actor = context().userId; // NEW
            if (info?.managed && !entry.actor) throw new Error('Log in before initializing this garden project.'); // NEW
            settleDocumentReady(); if (!entry.settled) await refresh(); // NEW
        }).catch(error => { if (!entry.settled) { entry.settled = true; entry.error = error; entry.reject(error); } }); // NEW
        return entry.promise; // NEW
    } // NEW
    async function refresh() {
        if (refreshing) { const generation = contextGeneration; await refreshFinished; if (generation === contextGeneration && file() && (classifiedFile !== file() || explicitMode && isCollaborative() && context().userId && viewIdentity !== context().userId)) return refresh(); return; } // CHANGE: a previous document or user's refresh cannot initialize the next view.
        const openedFile = file(), generation = contextGeneration; // NEW
        refreshing = true; let failure = null; // CHANGE
        refreshFinished = new Promise(resolve => { finishRefresh = resolve; }); // NEW
        try {
            await synchronizeContext();
            if (file() !== openedFile || generation !== contextGeneration) return; // NEW
            const current = context();
            if (!current.diagramPath) { info = null; lastStatus = null; classifiedFile = openedFile; settleDocumentReady(); announce(); return; } // CHANGE
            const result = await bridge.getStatus();
            if (file() !== openedFile || generation !== contextGeneration) return; // NEW
            const entry = (result.canvases || []).find(canvas => pathKey(canvas.diagramPath) === pathKey(current.diagramPath)); // CHANGE
            if (!entry) { info = null; lastStatus = null; classifiedFile = openedFile; settleDocumentReady(); announce(); return; } // CHANGE
            const nextInfo = await bridge.getSyncthingShareInfo({ diagramPath: current.diagramPath }); // CHANGE
            if (file() !== openedFile || generation !== contextGeneration) return; // CHANGE
            const assetContextChanged = info?.assetBaseUrl !== nextInfo.assetBaseUrl; info = nextInfo; window.TrellisContentPolicy?.setAssetBase(info?.assetBaseUrl); // CHANGE
            if (assetContextChanged) refreshManagedImages(); // CHANGE: unchanged context must not refresh the complete graph.
            lastStatus = entry; classifiedFile = openedFile; // CHANGE
            assetAvailability = entry.state; // CHANGE
            assetSequence = entry.folderSequence ?? null; // CHANGE
            if (isCollaborative() && (collaborationBaseline == null || explicitMode && viewIdentity !== current.userId) && current.userId) { // CHANGE: each authenticated user restores their remembered objects.
                const opened = file(); collaborationBaseline = opened.data; observedXml = collaborationBaseline; // NEW
                const baseline = await coordinate({ kind: explicitMode ? 'open-view' : 'get' }); // CHANGE
                if (!baseline || file() !== opened || generation !== contextGeneration) return; collaborationBaseline = baseline.xml; collaboration = baseline.collaboration; // CHANGE
                if (explicitMode) { // NEW
                    viewIdentity = current.userId;
                    if (baseline.xml !== opened.data && !identityJoinInProgress) applyRemote(baseline.xml, opened); // CHANGE: retain the just-proven account mutation until its explicit claim and save.
                    incoming?.setGroups(baseline.groups || []); pendingHash = baseline.collaboration?.hash;
                } // NEW
            } // NEW
            settleDocumentReady(); // NEW: history may depend on readiness; resolve before importing history.
            startBackground(); // NEW: begin independent services only after the document/user baseline is initialized.
            await importNewHistory();
            announce();
        } catch (err) { failure = err; status(err.message + (explicitMode && /Remembered view unavailable/.test(err.message) ? ' Use Extras → Recover Remembered View.' : '')); } // CHANGE
        finally { refreshing = false; finishRefresh(); if (generation === contextGeneration) settleDocumentReady(failure); } // CHANGE
    }
    /** Invalidate rendered managed images only when their base or download availability changes. */ // CHANGE
    function refreshManagedImages() { // CHANGE
        const states = graph.view?.states?.getValues?.(); // CHANGE
        if (!states) { graph.refresh?.(); return; } // CHANGE: compatibility with older graph integrations.
        let invalidated = false; // CHANGE
        for (const state of states) if (/assets\/[a-f0-9]{16}/.test(String(state.style?.image || '') + String(state.cell?.value?.outerHTML || state.cell?.value || ''))) { graph.view.invalidate(state.cell); invalidated = true; } // CHANGE
        if (invalidated) graph.view.validate(); // CHANGE
    } // CHANGE
    /** Apply native differences while keeping decoded incoming pages separate from live model objects. */ // CHANGE
    function applyRemote(xml, current, stat, savedDraft) { // CHANGE: patch from a captured save when newer local edits exist.
        if (graph.__trellisLocalView && !graph.__trellisLocalView.isApplying()) return graph.__trellisLocalView.apply(() => applyRemote(xml, current, stat, savedDraft)); // NEW: restores and reopen preserve personal folds.
        const oldUsersInternal = graph.__trellisUsersInternalChange;
        graph.__trellisSharingApplying = true;
        graph.__trellisUsersInternalChange = true;
        try {
            const nativePatch = isCollaborative() && current.patch && ui.diffPages && ui.getPagesForXml && ui.pages?.length; // CHANGE
            const pages = ui.getPagesForXml && (current.setShadowPages || nativePatch) ? ui.getPagesForXml(xml) : null; // CHANGE: decode incoming XML once.
            let changed = true; // CHANGE
            if (nativePatch) { // CHANGE
                const patches = [ui.diffPages(savedDraft ? ui.getPagesForXml(savedDraft) : ui.pages, pages)]; // CHANGE: clean updates use native live pages rather than encoding the document.
                changed = current.ignorePatches ? !current.ignorePatches(patches) : Object.keys(patches[0]).length > 0; // CHANGE
                if (changed) current.patch(patches, null, false, false); // CHANGE
            } // CHANGE
            else ui.setFileData(xml); // CHANGE: retain initial-load fallback when the native page patcher is unavailable.
            current.data = xml;
            if (isCollaborative()) { collaborationBaseline = xml; observedXml = savedDraft ? ui.getFileData() : xml; } // NEW
            current.stat = stat || current.stat;
            current.inConflictState = false;
            current.setModified(!!savedDraft); // CHANGE: a peer patch must not acknowledge newer unsaved input.
            if (current.setShadowPages && pages) current.setShadowPages(pages); // CHANGE
            if (changed && users()?.revalidateCurrentSession) users().revalidateCurrentSession(); // CHANGE
            if (changed && !savedDraft && history()?.applyRemoteBaseline) history().applyRemoteBaseline(); // CHANGE
            if (changed) remoteBaselinePending = true; // CHANGE: empty native diffs do not rebuild history baselines.
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
        if (result.localOnly) throw new Error(result.reason || 'Sharing is disabled for this old project.'); // CHANGE
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
        result = await bridge.setupCanvas({ ...context(), protocolVersion: 3, filename: current.getTitle && current.getTitle() || 'Garden.drawio', xml: current.getData() });
        await adoptCanvas(result);
        return result;
    }
    async function prepareInvite(result, options = {}) { // CHANGE
        if (info?.localOnly) throw new Error(info.reason || 'Sharing is disabled for this old project.'); // CHANGE
        const current = file(), shareId = info?.shareId, generation = contextGeneration, started = window.performance.now(); // NEW
        await saveCurrent(options); // CHANGE
        await synchronizeContext(); // CHANGE
        if (file() !== current || contextGeneration !== generation || info?.shareId !== shareId) throw new Error('The project changed before preparing the invitation.'); // NEW
        try { options.onProgress?.('preparing invitation'); } catch (_) {} // NEW
        const block = await bridge.createInviteBlock({ shareId, inviteId: result.invite.id, code: result.code }); // CHANGE
        if (file() !== current || contextGeneration !== generation || info?.shareId !== shareId) throw new Error('The project changed before preparing the invitation.'); // NEW
        if (!block?.ok || !block.block) throw new Error(block?.reason || 'The complete invitation could not be prepared.'); // NEW
        await releaseUnpinnedHolds(); // NEW: handing off a saved invitation must not leave its account/grant objects held by the sender.
        if (file() !== current || contextGeneration !== generation || info?.shareId !== shareId) throw new Error('The project changed before preparing the invitation.'); // NEW
        timings({ phase: 'invitation', durationMs: window.performance.now() - started }); // NEW
        return { ...result.emailDraft, body: result.emailDraft.body + '\n\n' + block.block }; // CHANGE
    } // CHANGE
    /** Validate retained email/copy text without saving again or changing the invitation code. */ // NEW
    async function validateInvite(result) { // NEW
        const current = file(), shareId = info?.shareId, generation = contextGeneration; // NEW
        await synchronizeContext(); // NEW
        const value = await bridge.createInviteBlock({ shareId, inviteId: result.invite.id, code: result.code }); // NEW
        if (file() !== current || generation !== contextGeneration || info?.shareId !== shareId) throw new Error('The project changed before validating the invitation.'); // NEW
        if (!value?.ok || !value.block) throw new Error(value?.reason || 'This invitation is no longer valid.'); // NEW
    } // NEW
    function historyRecorded(event) {
        const entry = event.detail;
        if (!graph.__trellisSharingApplying) remoteBaselinePending = false; // NEW: imported history must not erase a newer local edit baseline.
        if (info && info.managed && entry && entry.revision.diagramHistoryId === info.diagramId && !graph.__trellisSharingApplying) queuedHistory.set(entry.revision.id, entry);
    }
    async function publishSavedHistory(savedXml, checkpoint, isCurrent) { // CHANGE
        if (!info || !info.managed || graph.__trellisSharingApplying) return; // CHANGE
        const entries = checkpoint ? [checkpoint] : []; // CHANGE: a newer recorder event cannot substitute or bundle a different saved version.
        if (!entries.length) return;
        const shareId = info.shareId; // NEW
        await synchronizeContext();
        if (!isCurrent() || shareId !== info?.shareId) return; // NEW
        const savedHash = await hash(savedXml); if (!isCurrent()) return; // NEW
        const historyResult = await bridge.exportHistory({ shareId, savedHash, entries }); // CHANGE
        if (!isCurrent()) return; // NEW
        graph.__ccSharedHistoryStorage = historyResult && historyResult.storage || null; // CHANGE
        if (history()?.refresh) await history().refresh(); // NEW: reset/pruning may have changed the local generation.
        if (document.querySelector('.trellis-history-storage-details[open]')) await window.Trellis.sharing.refreshHistoryStorage(); // NEW: avoid scanning the collaboration journal on ordinary autosaves.
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
            const capturedInfo = info, result = await bridge.importHistory({ shareId: info.shareId, knownIds: Array.from(importedIds) }); // CHANGE
            if (info !== capturedInfo) return; // NEW
            if (result.generation && result.generation !== graph.__ccImportedHistoryGeneration) { importedIds.clear(); publishedIds.clear(); queuedHistory.clear(); graph.__ccImportedHistoryGeneration = result.generation; } // NEW
            if (history().refresh) await history().refresh(); // NEW: transport has already persisted the verified records.
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
            const automatic = !!current.__trellisAutomaticRequest; delete current.__trellisAutomaticRequest; // NEW
            if (current.__trellisNamingMove) { const args = arguments; current.__trellisNamingMove.then(() => current.save.apply(current, args)); return; } // NEW
            if (file() === current && refreshing) { const args = arguments; refreshFinished.then(() => current.save.apply(current, args)); return; } // NEW: never fall back to a native write while managed status is unresolved.
            if (file() === current && isCollaborative()) { saveCollaborative(current, arguments[1], arguments[2], automatic); return; } // CHANGE
            return originalSave.apply(this, arguments);
        };
        const originalSaved = current.fileSaved;
        current.fileSaved = function () {
            const args = Array.from(arguments);
            const savedXml = args[0];
            const success = args[2];
            args[2] = function () {
                const generation = contextGeneration, actor = context().userId; // NEW
                const matches = () => file() === current && generation === contextGeneration && actor === context().userId; // NEW
                savedQueue = savedQueue.then(async function () {
                    const historyStarted = window.performance.now(); // NEW: history is measured separately from project persistence and activity.
                    let checkpoint = null; // NEW
                    // Flush stable history only if the in-memory canvas still matches the saved work.
                    if (matches() && info?.managed && pathKey(current.fileObject?.path) === pathKey(info.diagramPath) && history()?.flushForSharing && !current.isModified()) { // CHANGE: plain local files need no sharing checkpoint.
                        checkpoint = savedCheckpoint(await history().flushForSharing()); // CHANGE
                        if (!matches()) return; // NEW
                        queuedHistory.clear(); // NEW: unsaved intermediate revisions are never published.
                        if (checkpoint) queuedHistory.set(checkpoint.revision.id, checkpoint);
                    } else return;
                    const sharedXml = explicitMode ? (await coordinate({ kind: 'history-state' }))?.xml : savedXml; // NEW: history always describes the accepted project, never the stale view.
                    if (!matches() || !checkpoint || checkpoint.xml && checkpoint.xml !== sharedXml) return; // NEW: a superseding save owns its own history completion.
                    if (sharedXml) await publishSavedHistory(sharedXml, checkpoint, matches); // CHANGE
                    timings({ phase: 'history completion', durationMs: window.performance.now() - historyStarted }); // NEW
                }).catch(err => { if (matches()) status('Shared history export failed: ' + err.message); }); // CHANGE
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
    if (ui.openLink) { const original = ui.openLink; ui.openLink = function (reference) { if (info && /^assets\//.test(reference || '')) { bridge.saveAsset({ shareId: info.shareId, relativePath: reference }).then(result => { if (!result.ok) status(result.reason); }).catch(err => status(err.message)); return; } return original.apply(this, arguments); }; }
    const originalHandleFileChange = ui.handleFileChange;
    const originalSynchronizeCurrentFile = ui.synchronizeCurrentFile; // NEW: native Synchronize/Reload must enter review rather than merging the projection.
    if (originalSynchronizeCurrentFile) ui.synchronizeCurrentFile = function () {
        if (explicitMode && isCollaborative()) return readRemote('get').then(() => incoming?.reviewAll()).catch(error => status(error.message));
        return originalSynchronizeCurrentFile.apply(this, arguments);
    }; // NEW
    if (originalHandleFileChange) ui.handleFileChange = function (curr, prev, current) { // CHANGE
        const generation = contextGeneration, deliver = async () => { // NEW
            if (classifiedFile !== current) await whenDocumentReady(); // NEW: an early own write must not enter the native external-conflict path.
            if (file() !== current || contextGeneration !== generation) return; // NEW
            if (!info?.managed || !current.fileObject || pathKey(current.fileObject.path) !== pathKey(info.diagramPath)) return originalHandleFileChange.call(ui, curr, prev, current); // CHANGE
            return readRemote('get', curr); // CHANGE: the main process verifies the projection and preserves unexpected external content.
        }; // NEW
        return deliver().catch(err => { if (file() === current && contextGeneration === generation) status(err.message); }); // CHANGE
    }; // CHANGE
    let updateDialog = null; // NEW
    let collaborationBaseline = null, observedXml = null, localSessionId = null, acquiring = false, editingForm = null; // NEW
    let collaboration = null, collaborationSave = Promise.resolve(), contextGeneration = 0; // NEW
    let recoveryQueue = Promise.resolve(), recoveryFailure = null, retryRecovery = null, saveFence = Promise.resolve(); const unsavedActions = [], recoveringTargets = new Map(); // CHANGE
    const isCollaborative = () => !!(info && info.protocolVersion === 3 && bridge.collaborationAction); // NEW
    const holdEditors = window.TrellisEditingHolds?.create(ui, { isCollaborative, status, claim: targets => coordinate({ kind: 'claim', targets }), release: releaseHolds, lose: recoverLostHolds }); // NEW
    function describeStatus(state = lastStatus) { // NEW
        if (info?.localOnly || state?.localOnly) return 'Local only · Sharing off'; // CHANGE
        if (!state) return 'Not shared'; // NEW
        if (state.pending) return 'Awaiting approval'; // NEW
        if (info && info.protocolVersion === 3 && ['upToDate', 'syncing', 'unavailable'].includes(state.state) && ((state.connectedPeers ?? state.connectedCollaborators) === 0 || state.state === 'unavailable')) return 'Working locally'; // NEW: local work must not conceal pause, revocation, or approval states.
        return ({ upToDate: 'Up to date', syncing: 'Syncing', paused: 'Paused', awaitingApproval: 'Awaiting approval', revoked: 'Access removed', unavailable: 'Unavailable' })[state.state] || 'Checking connection'; // CHANGE
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
        if (!dialog || dialog.__submitting) return; const previous = dialog.__previousFocus; dialog.remove(); dialog = null; updateDialog = null; // CHANGE
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
        if (window.trellisGardenJoin && window.TrellisGardenHome) return window.TrellisGardenHome.showProjects(ui, { focus: 'join' }); // NEW: all desktop join entry points share the identity guide.
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
        const quickstartToken = graph.__trellisQuickstart?.capture(); // NEW
        const panel = showDialog('Add another computer', showSharingDialog); // NEW
        note(panel, 'For someone who already has canvas access. Create an invitation here, use Join another canvas on their other computer, then return its approval reply to an admin. To invite a new person, use Share on the garden toolbar.'); // NEW
        const select = document.createElement('select'), wrapper = document.createElement('label'); wrapper.textContent = 'Person using the other computer'; select.style.cssText = 'display:block;width:100%;margin:8px 0;padding:8px;'; wrapper.appendChild(select); panel.appendChild(wrapper); // NEW
        const membership = await bridge.listRequests({ shareId: info.shareId }); if (!panel.isConnected) return; // NEW
        const eligible = membership.eligibleUsers || (users() ? users().listUsers().filter(u => !u.disabled && u.email) : []); // NEW: use the main process's existing canvas access policy.
        for (const user of eligible) { const option = document.createElement('option'); option.value = user.id; option.textContent = user.name + ' (' + user.email + ')'; select.appendChild(option); } // NEW
        if (!eligible.length) note(panel, 'No active users have an email address. Add an email and canvas access in People & Access before creating a computer invitation.'); // NEW
        const create = button('Create invitation', async () => { // NEW
            await saveCurrent(); await synchronizeContext(); const result = await bridge.createDeviceInvite({ shareId: info.shareId, userId: select.value }); // NEW
            if (!panel.isConnected) return;
            graph.__trellisQuickstart?.record('people', quickstartToken); // NEW
            create.dataset.keepDisabled = 'true'; select.disabled = true; copyBlock(panel, 'Invitation — send to the person above', result.block); // NEW
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
            health.textContent = describeStatus() + '. ' + (info?.localOnly ? info.reason : info?.managed ? collaborationSummary() : 'This canvas is not shared. Use Share on the garden toolbar to invite someone.') + (lastStatus?.reason ? ' ' + lastStatus.reason : '') + (collaboration?.recoveries?.length ? ' Rejected or recovered edits are available below.' : '') + (collaboration?.pending ? ' Waiting for missing change records.' : ''); // CHANGE
            if (recoveryList) { recoveryList.replaceChildren(); for (const copy of collaboration?.recoveries || []) { note(recoveryList, copy.reason || 'Recovery copy'); if (copy.editorDataPath) button('Open editor data', () => showRecoveredEditorData(copy), recoveryList); // CHANGE
                 button('Open copy', () => { closeDialog(); if (ui.loadArgs) ui.loadArgs({ args: [copy.recoveryPath] }); }, recoveryList); note(recoveryList, copy.recoveryPath); } if (!collaboration?.recoveries?.length) note(recoveryList, localRecovery ? localRecovery.recoveryPath : 'No recovered edits.'); } // NEW
            people.replaceChildren(); note(people, lastStatus?.connectedCollaborators == null ? 'Collaborator connection status is unavailable.' : lastStatus.connectedCollaborators ? lastStatus.connectedCollaborators + ' connected collaborator' + (lastStatus.connectedCollaborators === 1 ? '' : 's') : 'No other collaborators are connected.'); // NEW
            for (const person of lastStatus?.collaborators || []) if (!collaboration?.holds.some(h => h.userId === person.id)) note(people, person.name || 'Unknown user'); // NEW
            for (const viewer of collaboration?.presence || []) for (const key of viewer.targets || []) if (!collaboration?.holds.some(h => h.key === key && h.sessionId === viewer.sessionId && h.deviceId === viewer.deviceId)) note(people, (viewer.name || viewer.userId) + (viewer.online === false ? ' · offline · status unconfirmed for ' : ' is viewing ') + objectLabel(key)); // CHANGE: last-known activity cannot imply a live viewer in the overview.
            for (const turn of collaboration?.reservations || []) note(people, (turn.sessionId === localSessionId ? 'Your next editing turn' : turn.name + ' has the next editing turn') + ' for ' + objectLabel(turn.key) + '. Begin within ' + Math.max(0, Math.ceil((turn.until - Date.now()) / 1000)) + ' seconds.'); // NEW
            for (const hold of collaboration?.holds || lastStatus?.collaboration?.holds || []) { const row = document.createElement('div'); row.style.margin = '8px 0'; note(row, hold.name + ' is editing ' + objectLabel(hold.key)); if (hold.sessionId === localSessionId) button('Release now', () => holdEditors ? holdEditors.handoff([hold.key]) : releaseHolds([hold.key]), row, 'neutral'); else button('Request release', () => coordinate({ kind: 'request', targets: [hold.key] }), row); if (hold.expiresAt) note(row, (hold.requested ? 'Release requested. ' : '') + 'Reservation expires in ' + Math.max(0, Math.ceil((hold.expiresAt - Date.now()) / 1000)) + ' seconds without a fresh heartbeat.'); people.appendChild(row); } // NEW
        }; updateDialog = update; update(); // NEW
        button('Join another canvas', () => showJoinDialog(showSharingDialog), panel); // NEW
        if (!info?.managed) return; // NEW
        const pause = button(lastStatus?.state === 'paused' ? 'Resume syncing' : 'Pause syncing', async () => { await bridge.setPaused({ shareId: info.shareId, paused: lastStatus?.state !== 'paused' }); await refresh(); if (panel.isConnected) { pause.textContent = lastStatus?.state === 'paused' ? 'Resume syncing' : 'Pause syncing'; update(); } }, panel, 'neutral'); // NEW
        if (users()?.isAdmin()) { // NEW
            button('Add another computer', showAddComputer, panel); button('Approve a computer', showApproveComputer, panel); // NEW
        } // NEW
        const technical = details(panel, 'Details'); note(technical, 'Sharing ID: ' + info.shareId + '\nLocal file: ' + info.diagramPath); // NEW
        copies = details(panel, 'Recovery copies'); recoveryList = document.createElement('div'); copies.appendChild(recoveryList); update(); // NEW
        if (bridge.recoveryAction) button('Private recovery drafts', showPrivateDrafts, copies, 'open'); // NEW
        button('Review local changes', showDraftConflicts, panel, 'open'); // NEW
        button('Save recovery copy', async () => { localRecovery = await bridge.saveRecoveryCopy({ shareId: info.shareId, xml: ui.getFileData() }); note(copies, 'Saved: ' + localRecovery.recoveryPath); copies.open = true; }, copies, 'add'); // NEW
        if (users()?.isAdmin()) { // NEW
            const advanced = details(panel, 'Advanced — approved computers and replacement share'); // NEW
            bridge.listRequests({ shareId: info.shareId }).then(membership => { if (!advanced.isConnected) return; for (const member of membership.members || []) { const row = document.createElement('div'); const person = users().listUsers().find(u => u.id === member.userId); note(row, (person?.name || 'Unknown user') + (member.deviceId === info.deviceId ? ' · this computer' : '') + (member.deviceId === info.coordinatorDeviceId ? ' · manages approvals' : '') + '\nDevice: ' + member.deviceId); if (member.deviceId !== info.coordinatorDeviceId) button('Remove computer', async () => { const approved = await new Promise(resolve => ui.confirm('Remove this computer? This stops future sharing but cannot erase its downloaded copy.', () => resolve(true), () => resolve(false), 'Remove', 'Cancel', false)); if (approved) { await saveCurrent(); await synchronizeContext(); const result = await bridge.requestMembership({ shareId: info.shareId, operation: 'remove', targetDeviceId: member.deviceId }); panel.querySelector('[data-status]').textContent = 'Removal pending: ' + result.requestId; } }, row, 'danger'); advanced.appendChild(row); } }).catch(err => note(advanced, err.message)); // NEW
            note(advanced, 'Creating a replacement share requires everyone to join again. Use this only when the approval-managing computer cannot be recovered.'); // NEW
            button('Create replacement share', async () => { const approved = await new Promise(resolve => ui.confirm('Create a replacement share? Everyone must join again. A local recovery copy will be retained.', () => resolve(true), () => resolve(false), 'Create replacement', 'Cancel', false)); if (!approved) return; await bridge.saveRecoveryCopy({ shareId: info.shareId, xml: ui.getFileData() }); await saveCurrent(); await synchronizeContext(); await adoptCanvas(await bridge.recovery({ shareId: info.shareId })); await showSharingDialog(); }, advanced, 'danger'); // CHANGE
        } // NEW
    } // CHANGE
    /** Recovery data is inert text for inspection/export, never an automatic restore or journal edit. */ // NEW
    async function showRecoveredEditorData(copy) { // NEW
        const result = await coordinate({ kind: 'recovery-data', filename: copy.filename }); // NEW
        if (!result?.ok) throw new Error(result?.reason || 'Editor recovery data is unavailable.'); // NEW
        const text = JSON.stringify(result.data, null, 2), panel = showDialog('Recovered editor data', showSharingDialog); // NEW
        note(panel, 'Saved editor entries. Review these before manually reapplying changes.'); // NEW
        const field = document.createElement('textarea'); field.readOnly = true; field.value = text; field.setAttribute('aria-label', 'Recovered editor data'); field.style.cssText = 'width:100%;height:300px;box-sizing:border-box;font:12px monospace'; panel.appendChild(field); // NEW
        button('Export JSON', () => { const link = document.createElement('a'), url = URL.createObjectURL(new window.Blob([text], { type: 'application/json' })); link.href = url; link.download = copy.filename + '.editors.json'; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 0); }, panel); // NEW
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
        if (!isCollaborative()) return null; const current = file(), shareId = info.shareId, generation = contextGeneration; // CHANGE
        if (bridge.activityAction && ['claim', 'view', 'request', 'release'].includes(input.kind)) { const { baseXml, xml, ...activity } = input; const result = input.kind === 'claim' && input.xml && !input.targets ? await bridge.collaborationAction({ shareId, ...input }) : await bridge.activityAction({ shareId, ...activity }); if (file() === current && generation === contextGeneration) adoptActivity(result.collaboration); return result; } // CHANGE: XML claims use the independent native activity adapter while retaining the existing capture and rejection path.
        await synchronizeContext(); // CHANGE
        if (file() !== current || info?.shareId !== shareId || generation !== contextGeneration) throw new Error('The project changed before the collaboration action.'); // NEW
        const result = await bridge.collaborationAction({ shareId, explicitRefresh: explicitMode, ...input }); // CHANGE
        if (file() !== current || info?.shareId !== shareId || generation !== contextGeneration) return null; // CHANGE: ignore delayed replies after a document switch.
        const previousHolds = collaboration?.holds?.filter(hold => hold.sessionId === localSessionId) || []; // NEW
        adoptActivity(result.collaboration); // CHANGE: content completion must retain the independent snapshot's resolved display names.
        adoptPolicy(collaboration); // NEW
        if (explicitMode) { // NEW
            if (result.ok === false && input.kind === 'claim' && !holdEditors?.pinnedTargets().some(key => (input.targets || formTargets).includes(key))) rejectDialogs(input.targets || formTargets, result.reason); // CHANGE: registered drafts must be preserved before their editor closes.
            const lost = previousHolds.filter(hold => !releasingClaims.has(hold.claimId) && !collaboration?.holds?.some(next => next.claimId === hold.claimId && next.sessionId === localSessionId)); // CHANGE
            if (!['release', 'recover-holds'].includes(input.kind) && !(input.kind === 'save' && result.code === 'HOLD_LOST') && lost.length) { // CHANGE
                const recovery = recoverLostHolds(lost.map(hold => hold.key), 'Your editing hold expired, access changed, or another concurrent editor has priority.'); // NEW
                if (input.kind === 'save') recovery.catch(() => {}); else await recovery; // NEW: an accepted save must settle before background expiry can roll it back.
            } // NEW
        } // NEW
        holdEditors?.update(collaboration?.holds, localSessionId); // NEW
        announce(); return result; // CHANGE
    } // NEW
    /** Serialize recovery with itself; never wait for a save that may already be awaiting this reply. */ // NEW
    function recoverLostHolds(targets, reason, insideSave = false) { // CHANGE
        if (!file()?.isModified() && !unsavedActions.length && !(holdEditors?.capture(targets).length)) { rejectDialogs(targets, reason); return Promise.resolve(); } // NEW: clean editors need no asynchronous disk operation.
        const current = file(), generation = contextGeneration, pendingSave = insideSave ? Promise.resolve() : saveFence; targets.forEach(key => recoveringTargets.set(key, (recoveringTargets.get(key) || 0) + 1)); // CHANGE
        const operation = async () => { // NEW
            await background?.checkpoint(true); // NEW: preserve a private, author-scoped checkpoint before the existing rejection/rollback path runs.
            await pendingSave; // NEW: accepted actions leave the rollback set before an asynchronous status loss is processed.
            if (file() !== current || generation !== contextGeneration) return; // NEW
            const editors = holdEditors?.capture(targets) || [], captured = ui.getFileData(), baseline = collaborationBaseline || current.data; // NEW
            if (current.isModified() || unsavedActions.length || editors.length) { // CHANGE
                const result = await coordinate({ kind: 'recover-holds', baseXml: baseline, xml: captured, targets, actions: unsavedActions.map(action => action.keys), editorDrafts: editors, reason }); // NEW
                if (!result || file() !== current || generation !== contextGeneration) return; // NEW
                if (!result.ok || typeof result.xml !== 'string') throw new Error(result.reason || 'The recovery copy or draft rollback could not be completed.'); // NEW
                const discarded = new Set(result.discardedKeys || []), removed = unsavedActions.filter(action => action.keys.some(key => discarded.has(key) || discarded.has('*'))); // NEW
                const undo = ui.editor.undoManager, priorUndo = new Set(undo?.history || []); // NEW
                if (result.xml !== captured) { // NEW
                    const saved = current.data, live = ui.getFileData(); // CHANGE
                    try { applyRemote(result.xml, current, current.stat, captured); } // NEW: patch only rejected local differences, retaining newer unrelated typing.
                    catch (error) { const applying = graph.__trellisSharingApplying; graph.__trellisSharingApplying = true; try { ui.setFileData(live); } finally { graph.__trellisSharingApplying = applying; collaborationBaseline = baseline; current.data = saved; current.setModified(true); } throw error; } // CHANGE
                    collaborationBaseline = baseline; current.data = saved; observedXml = ui.getFileData(); current.setModified(observedXml !== baseline); // NEW
                } // NEW
                if (undo?.history) { const keep = edit => priorUndo.has(edit) && !removed.some(action => action.edit === edit); const before = undo.history.slice(0, undo.indexOfNextAdd).filter(keep).length; undo.history = undo.history.filter(keep); undo.indexOfNextAdd = before; } // CHANGE: neither the original rejected action nor its inverse rollback may re-enter Undo/Redo.
                for (const action of removed) { action.edit.__trellisUsersRejected = true; unsavedActions.splice(unsavedActions.indexOf(action), 1); } // NEW
                localRecovery = result; status(reason + ' Affected unsaved actions were reverted. Recovery copy: ' + result.recoveryPath); // NEW
            } // NEW
            holdEditors?.discard(targets); rejectDialogs(targets, reason); recoveryFailure = null; retryRecovery = null; // CHANGE
        }; // NEW
        const recovery = (insideSave ? operation() : recoveryQueue.catch(() => {}).then(operation)).catch(error => { if (generation === contextGeneration) { recoveryFailure = error; retryRecovery = { targets, reason }; status('The draft remains open because recovery failed: ' + error.message); } throw error; }).finally(() => { if (generation === contextGeneration) targets.forEach(key => { const count = recoveringTargets.get(key) || 0; if (count <= 1) recoveringTargets.delete(key); else recoveringTargets.set(key, count - 1); }); }); // CHANGE
        if (!insideSave) recoveryQueue = recovery; return recovery; // CHANGE
    } // NEW
    /** Serialize incoming reads and coalesce file notifications without delaying claims or saves. */ // CHANGE
    function readRemote(kind, stat) { // CHANGE
        const current = file(), generation = contextGeneration; // CHANGE
        if (remoteReadTask?.current === current && remoteReadTask.generation === generation) { if (stat) remoteReadTask.stat = stat; return remoteReadTask.promise; } // CHANGE
        const task = { current, generation, stat, promise: null }; remoteReadTask = task; // CHANGE
        task.promise = (async () => { // CHANGE
            do { // CHANGE
                const observedStat = task.stat, baseline = collaborationBaseline; task.stat = null; // CHANGE
                const result = await coordinate(kind === 'view' ? { kind, objects: selectedObjectKeys() } : { kind }); // CHANGE
                if (!result || file() !== current || generation !== contextGeneration) return; // CHANGE
                if (baseline !== collaborationBaseline) { task.stat ||= observedStat || {}; kind = 'get'; continue; } // CHANGE: a read started before a completed save cannot revert that save.
                if (explicitMode) { // NEW: status/presence and notifications never apply content.
                    if (pendingHash !== result.collaboration?.hash) {
                        const changes = await coordinate({ kind: 'changes' });
                        if (changes && file() === current && generation === contextGeneration) { incoming?.setGroups(changes.groups || []); pendingHash = changes.collaboration?.hash; }
                    }
                } else if (result.xml && !current.isModified() && result.xml !== collaborationBaseline) applyRemote(result.xml, current, observedStat); // CHANGE
                if (result.projection) { // CHANGE: background refresh may discover the external write before a stat notification arrives.
                    if (observedStat) current.stat = observedStat; // CHANGE
                    if (result.projection.externalRecoveryPath) { // NEW
                        ui.editor.setStatus('External file changes were preserved. Open Sharing to inspect recovery copies.', () => { if (file() === current && generation === contextGeneration) showSharingDialog().catch(error => status(error.message)); }); // CHANGE: the trusted status renderer supplies its accessible control.
                    } else if (observedStat && current.inConflictState && !current.__trellisConflict) { // CHANGE
                        current.inConflictState = false; // NEW
                        const message = window.mxResources?.get?.('fileChangedSync'); // NEW
                        if (message && ui.editor.getStatus?.().includes(message)) ui.editor.setStatus(''); // NEW: clear this obsolete native warning, never an unrelated error or draft conflict.
                    } // NEW
                } // NEW
                kind = 'get'; // CHANGE: follow-up file notifications need no presence publication.
            } while (task.stat && file() === current && generation === contextGeneration); // CHANGE
        })().finally(() => { if (remoteReadTask === task) remoteReadTask = null; }); // CHANGE
        return task.promise; // CHANGE
    } // CHANGE
    async function releaseHolds(targets) { // NEW
        const current = file(), shareId = info?.shareId; // NEW
        if (graph.isEditing?.()) { // NEW: finish a native label only at handoff, keeping ordinary autosave from closing the editor.
            stoppingForSave = true; // NEW
            try { graph.stopEditing(false); } finally { stoppingForSave = false; } // NEW
        } // NEW
        await saveCurrent(); if (file() !== current || info?.shareId !== shareId) return;
        const claims = (collaboration?.holds || []).filter(hold => hold.sessionId === localSessionId && (!targets || targets.includes(hold.key))).map(hold => hold.claimId); // NEW
        claims.forEach(id => releasingClaims.add(id));
        try { return await coordinate({ kind: 'release', targets }); } finally { claims.forEach(id => releasingClaims.delete(id)); } // CHANGE
    } // NEW
    /** Share only a capture covering the same file generation, refresh barrier, and requested revision. */ // NEW
    async function saveCollaborative(current, success, error, automatic = false) { // CHANGE
        const priorRefresh = refreshSaveBarrier, generation = contextGeneration, saveUser = context().userId; // CHANGE: queued saves remain bound to their originating user.
        let batch = current.__trellisSaveBatch; // NEW
        if (!batch || batch.generation !== generation || batch.capturedRevision !== null && (!tracksModelChanges || batch.barrier !== priorRefresh || modelRevision > batch.capturedRevision)) { // CHANGE: every uncaptured request shares the single latest pending capture.
            batch = { id: ++saveOperationSequence, generation, barrier: priorRefresh, capturedRevision: null, promise: null, automatic }; // CHANGE
            current.__trellisSaveBatch = batch; saveProgress(current, 'queued'); // NEW
            const started = window.performance.now(); // NEW
            const operation = async () => { // CHANGE
                timings({ operationId: batch.id, phase: 'save queue', durationMs: window.performance.now() - started }); // NEW
                if (batch.automatic && background) { saveProgress(current, 'waiting for an editing pause'); await background.waitForQuiet(() => batch.automatic); } // NEW: edits made after a follow-up was queued still reset its quiet period.
                saveProgress(current, 'waiting for editing access'); // NEW
                const claimStarted = window.performance.now(); // NEW
                let barrier; do { // NEW: a superseding explicit refresh updates the pending request without adding a queued snapshot.
                    barrier = batch.barrier; await barrier; // CHANGE
                    if (batch.generation !== contextGeneration || saveUser !== context().userId) throw new Error('The user or document changed before saving. The previous draft was not submitted under the new user.'); // NEW
                    await current.__trellisNamingSync; // NEW: capture a draft only after a shared-name update has patched its saved baseline.
                    await acquisitionPromise; await recoveryQueue.catch(() => {}); if (retryRecovery) await recoverLostHolds(retryRecovery.targets, retryRecovery.reason); if (recoveryFailure) throw recoveryFailure; // CHANGE
                    if (batch.automatic && background) { saveProgress(current, 'waiting for an editing pause'); await background.waitForQuiet(() => batch.automatic); } // NEW: edits during access or refresh waits also restart the five-second quiet period.
                    if (file() !== current || !isCollaborative() || batch.generation !== contextGeneration || saveUser !== context().userId) throw new Error('The project or user changed before saving.'); // CHANGE
                } while (barrier !== batch.barrier); // NEW
                saveFence = new Promise(resolve => { batch.finishFence = resolve; }); // NEW
                timings({ operationId: batch.id, phase: 'save claims', durationMs: window.performance.now() - claimStarted }); // NEW
                if (explicitMode && !viewIdentity) throw new Error('Open or explicitly recover your remembered objects before saving.'); // NEW
                const captureStarted = window.performance.now(); // NEW
                let captured = ui.getFileData(), capturedRevision = modelRevision; const generation = contextGeneration, baseline = collaborationBaseline || current.data; // CHANGE
                const capturedObjects = new Map([...dirtyObjects].map(key => [key, objectFingerprint(key)])); background?.state('saving'); // NEW
                batch.capturedRevision = capturedRevision; // NEW: subscribers may only share a capture that covers their requested revision.
                timings({ operationId: batch.id, phase: 'save capture', durationMs: window.performance.now() - captureStarted, characters: captured.length }); // NEW
                saveProgress(current, 'saving garden'); // NEW
                const claimIds = [...new Set((collaboration?.holds || []).filter(h => h.sessionId === localSessionId).map(h => h.claimId))]; // NEW: saves retain their editing generation; delayed drafts cannot reacquire a released hold.
                let result; current.__trellisCollaborativeSaving = true; // NEW
                try { result = await coordinate({ kind: 'save', baseXml: baseline, xml: captured, claimIds, usersPolicyAction: !!policyActionPending }); } finally { current.__trellisCollaborativeSaving = false; } // CHANGE: preserve Users bootstrap intent; native replay still validates the exact invitation transition.
                const recovered = new Set(); // NEW: every retry must remove at least one rejected target from this capture.
                while (result?.code === 'HOLD_LOST' && result.targets?.some(key => !recovered.has(key))) { // NEW
                    result.targets.forEach(key => recovered.add(key)); await recoverLostHolds(result.targets, result.reason, true); // CHANGE
                    if (file() !== current || generation !== contextGeneration) throw new Error('The diagram changed during recovery.'); // NEW
                    captured = ui.getFileData(); capturedRevision = modelRevision; batch.capturedRevision = capturedRevision; // NEW
                    const freshClaims = [...new Set((collaboration?.holds || []).filter(h => h.sessionId === localSessionId).map(h => h.claimId))]; // NEW
                    result = await coordinate({ kind: 'save', baseXml: baseline, xml: captured, claimIds: freshClaims }); // NEW
                } // NEW
                if (!result || file() !== current || generation !== contextGeneration) throw new Error('The diagram changed before the save completed.'); // CHANGE
                const unchanged = () => tracksModelChanges ? modelRevision === capturedRevision : ui.getFileData() === captured; // CHANGE: native revision checks avoid full-document equality captures.
                if (!result.ok) { // CHANGE
                    if (result.code === 'CONFLICT') { current.__trellisConflict = result.review; background?.state('conflict'); await background?.checkpoint(true); status('Conflicting changes are preserved. Use Sharing → Review local changes.'); } // NEW
                    else { background?.state('failed'); status(result.reason || 'Saving failed.'); } // NEW
                    if (!explicitMode && unchanged() && result.xml) applyRemote(result.xml, current); // CHANGE
                    throw new Error((result.reason || 'Saving failed.') + (result.recoveryPath ? ' Submitted work preserved: ' + result.recoveryPath : '')); // CHANGE
                } // CHANGE
                const nativeStarted = window.performance.now(); // NEW
                const stat = await request('fileStat', { file: current.fileObject.path }); // CHANGE
                if (file() !== current || generation !== contextGeneration) throw new Error('The diagram changed before the save completed.'); // CHANGE
                if (result.resolution) { // NEW
                    current.stat = stat; // NEW
                    if (unchanged()) applyDraftResolution(result.resolution, current); // NEW
                    else { current.setModified(true); current.__trellisConflict = true; background?.state('pending'); } // NEW
                    return new Promise((resolve, reject) => current.fileSaved(result.resolution.baseXml, null, resolve, reject)); // NEW
                } // NEW
                current.stat = stat; current.data = explicitMode ? captured : result.xml; // CHANGE
                for (const [key, fingerprint] of capturedObjects) { savedObjects.set(key, fingerprint); dirtyObjects.add(key); } current.__trellisConflict = null; // NEW: compare newer edits against exactly the objects captured by this completed save.
                for (let index = unsavedActions.length - 1; index >= 0; index--) if (unsavedActions[index].revision <= capturedRevision) unsavedActions.splice(index, 1); // NEW: accepted actions are no longer eligible for expiry rollback.
                if (explicitMode) { collaborationBaseline = captured; current.setModified(!unchanged()); if (unchanged()) observedXml = captured; pendingHash = null; } // NEW: newer typing and unseen objects remain exactly as displayed.
                else if (unchanged()) { collaborationBaseline = result.xml; if (captured !== result.xml) applyRemote(result.xml, current, current.stat); else { current.setModified(false); observedXml = captured; } } // CHANGE
                else if (current.patch && ui.diffPages && ui.getPagesForXml && ui.pages?.length) applyRemote(result.xml, current, current.stat, captured); // NEW: apply only differences returned by the captured save, leaving subsequent local changes intact.
                else { collaborationBaseline = captured; current.setModified(true); } // NEW: compatibility fallback keeps the captured object bases so unseen peer changes cannot be mistaken for local reversions.
                return new Promise((resolve, reject) => current.fileSaved(explicitMode ? captured : result.xml, null, () => { current.contentChanged?.(); background?.state(current.isModified() ? 'pending' : 'saved'); void background?.checkpoint(true).catch(error => status('Recovery checkpoint failed: ' + error.message)); timings({ operationId: batch.id, phase: 'save native completion', durationMs: window.performance.now() - nativeStarted }); resolve(); }, err => { background?.state('failed'); reject(err); })); // CHANGE
            }; // NEW
            const slowTimer = window.setInterval(() => { // NEW
                if (file() === current && window.performance.now() - started >= 5000) status('Still working: ' + (current.__trellisSaveStage || 'saving garden') + ' (' + Math.floor((window.performance.now() - started) / 1000) + ' seconds).'); // NEW
            }, 1000); // NEW
            batch.promise = collaborationSave.catch(() => {}).then(operation).catch(error => { if (file() === current && batch.generation === contextGeneration) background?.state(current.__trellisConflict ? 'conflict' : 'failed'); throw error; }).finally(() => { // CHANGE: transport and persistence exceptions also leave a precise recoverable failure badge.
                batch.finishFence?.(); // NEW: release waiting expiry processing after native save bookkeeping.
                window.clearInterval(slowTimer); if (current.__trellisSaveBatch === batch) { current.__trellisSaveBatch = null; delete current.__trellisSaveStage; } // NEW
                timings({ operationId: batch.id, phase: 'save total', durationMs: window.performance.now() - started }); // NEW
            }); // NEW
            collaborationSave = batch.promise; // CHANGE
        } else { if (batch.capturedRevision === null) batch.barrier = priorRefresh; if (!automatic) { batch.automatic = false; background?.flushQuiet(); } timings({ operationId: batch.id, phase: 'save coalesced', count: 1 }); } // CHANGE
        return batch.promise.then(() => { if (success) success(); }, err => { if (error) error({ message: err.message }); else status('Autosave failed: ' + err.message); }); // CHANGE
    } // CHANGE
    let acquisitionPromise = Promise.resolve(); // NEW
    let stoppingForSave = false; // NEW: mxGraph emits editingStopped even when no label editor was open.
    let editingLabel = false, labelClaim = Promise.resolve(), labelEditorRegistration = null; // CHANGE
    let pendingEdits = [], acquisitionObjects = new Set(), claimDispatched = false, policyActionPending = false; // NEW: one synchronous Users/domain action may produce several model edits before its atomic claim is sent.
    function editObjectIds(edit, manualOnly = false) { // CHANGE
        return (edit.changes || []).filter(change => !change.__trellisUsersActorStamp && (!manualOnly || !editContext || editContext.kindOf(change) === 'manual')).map(change => { // CHANGE
            const cell = change.cell || change.child; if (!cell) return null; // NEW
            if (editContext) return editContext.logicalCell(cell)?.id; // NEW: activity and pending badges share the same logical-parent attribution policy.
            let planting = null; // NEW: retain the existing fallback for older shells without the context runtime.
            for (let cursor = cell; cursor; cursor = graph.getModel().getParent(cursor)) if (/(?:^|;)tiler_group=1(?:;|$)/.test(cursor.style || '') || cursor.getAttribute?.('planting_id')) planting = cursor; // NEW
            return (planting || cell).id; // NEW
        }).filter(Boolean); // NEW
    } // NEW
    function undoRejected(edit, reason) { // NEW
        for (const item of Array.isArray(edit) ? edit : [edit]) if (item) item.__trellisUsersRejected = true; // NEW: deferred history must not attribute rejected optimistic work.
        for (let index = unsavedActions.length - 1; index >= 0; index--) if (unsavedActions[index].edit.__trellisUsersRejected) unsavedActions.splice(index, 1); // NEW
        const previous = graph.__trellisUsersInternalChange; graph.__trellisSharingApplying = true; graph.__trellisUsersInternalChange = true; // NEW
        try { for (const item of (Array.isArray(edit) ? [...edit].reverse() : [edit])) if (item?.undo) item.undo(); } finally { graph.__trellisSharingApplying = false; graph.__trellisUsersInternalChange = previous; observedXml = ui.getFileData(); } status(reason); // NEW
    } // NEW
    /** Reuse the existing all-or-nothing UndoableEdit rejection boundary. */ // NEW
    function installCollaborationHooks() { // NEW
        const model = graph.getModel?.(); if (!model?.addListener || model.__trellisCollaboration) return; model.__trellisCollaboration = true; // NEW
        tracksModelChanges = true; // CHANGE
        model.addListener('change', (_sender, event) => { // NEW
            modelRevision++; // CHANGE: internal and remote edits also invalidate pending captures.
            if (!isCollaborative() || identityJoinInProgress || graph.__trellisSharingApplying || graph.__trellisLocalViewChanging || graph.__trellisUsersRejecting || ui.openingFile) return; // CHANGE
            const edit = event.getProperty?.('edit'); if (!edit?.changes?.some(change => !change.__trellisUsersActorStamp) || edit.__trellisUsersRejected) return; // NEW
            if (explicitMode && editObjectIds(edit).some(id => isPendingCell(model.getCell(id)))) { undoRejected(edit, 'Refresh this object and its related changes before editing.'); return; } // NEW
            const before = observedXml || collaborationBaseline || file().data; // CHANGE: the first claim captures its snapshot in the existing deferred operation, without a redundant full-diagram serialization here.
            const page = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; // NEW
            const keys = [...new Set(editObjectIds(edit))].map(id => JSON.stringify([page, String(id)])); // CHANGE: generated planting tiles share their source's pending status instead of creating hundreds of badges.
            for (const key of keys.length ? keys : ['*']) dirtyObjects.add(key); // NEW
            const badgeStarted = window.performance.now(); background?.changed(); renderBadges(); // CHANGE: rejection and recovery handling below remains intact.
            timings({ phase: 'pending badge', durationMs: window.performance.now() - badgeStarted }); // NEW
            if (window.TrellisSyncTiming && window.requestAnimationFrame) window.requestAnimationFrame(() => timings({ phase: 'pending badge paint', durationMs: window.performance.now() - badgeStarted })); // NEW
            unsavedActions.push({ edit, keys: keys.length ? [...new Set(keys)] : ['*'], revision: modelRevision }); // NEW
            if (!editObjectIds(edit, true).length) { if (acquiring && editObjectIds(edit).some(id => acquisitionObjects.has(id))) pendingEdits.push(edit); return; } // CHANGE: dependent generation rolls back with a rejected manual source; independent generation retains its own save/recovery tracking.
            if (acquiring) { const ids = editObjectIds(edit, true); if (!claimDispatched || ids.every(id => acquisitionObjects.has(id))) { pendingEdits.push(edit); policyActionPending ||= !!graph.__trellisUsersInternalChange; for (const id of ids) acquisitionObjects.add(id); return; } bridge.saveRecoveryCopy({ shareId: info.shareId, xml: ui.getFileData() }).catch(err => status(err.message)); undoRejected(edit, 'Wait for the pending editing hold before changing another object.'); return; } // CHANGE: automated portions never expand the activity reservation.
            acquiring = true; claimDispatched = false; policyActionPending = !!graph.__trellisUsersInternalChange; pendingEdits = [edit]; acquisitionObjects = new Set(editObjectIds(edit, true)); const current = file(), generation = contextGeneration; // CHANGE
            let capturedXml, capturedRevision; // CHANGE
            acquisitionPromise = Promise.resolve().then(() => { claimDispatched = true; capturedXml = ui.getFileData(); capturedRevision = modelRevision; const targets = [...acquisitionObjects].map(id => JSON.stringify([page, String(id)])); return coordinate({ kind: 'claim', targets, baseXml: before, xml: capturedXml, usersPolicyAction: policyActionPending }); }).then(async result => { // CHANGE: retain capture/rejection handling while sending explicit object targets to the independent activity lane.
                if (file() !== current) return; // NEW
                if (!result) return; // CHANGE
                if (!result.ok) { const copy = await bridge.saveRecoveryCopy({ shareId: info.shareId, xml: ui.getFileData() }); if (file() === current) undoRejected(pendingEdits, result.reason + ' Recovery copy: ' + copy.recoveryPath); } // NEW: preserve continued typing durably before rolling back a losing action.
                else { observedXml = modelRevision === capturedRevision ? capturedXml : ui.getFileData(); editingForm = document.activeElement?.closest?.('[role="dialog"],.geDialog,.usl-scheduler-dialog'); } // CHANGE
            }).catch(async err => { // NEW
                if (file() !== current) return; // NEW
                try { const copy = await bridge.saveRecoveryCopy({ shareId: info.shareId, xml: ui.getFileData() }); if (file() === current) undoRejected(pendingEdits, err.message + ' Recovery copy: ' + copy.recoveryPath); } // NEW
                catch (copyError) { status('The draft remains open because its recovery copy could not be saved: ' + copyError.message); } // NEW
            }).finally(() => { if (generation === contextGeneration) { acquiring = false; pendingEdits = []; acquisitionObjects.clear(); } }); // NEW
        }); // NEW
        graph.getSelectionModel?.().addListener('change', () => { // NEW
            if (!isCollaborative() || graph.__trellisSharingApplying) return; const objects = selectedObjectKeys(); // NEW
            const holds = collaboration?.holds.filter(h => h.sessionId === localSessionId) || []; // NEW
            const pinned = holdEditors?.pinnedTargets() || []; // NEW
            const leaving = holds.filter(h => !pinned.includes(h.key) && !objects.includes(h.key) && !objects.some(k => { try { let cell = model.getCell(JSON.parse(k)[1]); while (cell) { if (cell.id === JSON.parse(h.key)[1]) return true; cell = model.getParent(cell); } } catch (_) {} return false; })).map(h => h.key); // CHANGE
            const update = async () => { await coordinate({ kind: 'view', objects }); await acquisitionPromise; if (leaving.length) await releaseHolds(leaving); }; update().catch(err => status(err.message)); // CHANGE: viewing is announced before any save required to release an editing hold.
        }); // NEW
    } // NEW
    let formActivityTimer = null; // NEW
    document.addEventListener('input', event => { // NEW: form drafts reserve their object on actual typing, before Apply mutates the model.
        if (event.target.closest('[data-trellis-collaborative-editor]')) return; // NEW: registered editors own their claim and recovery lifecycle.
        if (!isCollaborative() || !event.isTrusted || event.target.closest('.trellis-collaboration-dialog,.trellis-garden-share-dialog')) return; // NEW
        const labelCell = editingLabel && graph.cellEditor?.textarea?.contains(event.target) ? graph.cellEditor.editingCell : null; // NEW
        if (labelCell) { // NEW: contenteditable native labels count as editing activity; viewing does not.
            const page = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; // NEW
            window.clearTimeout(formActivityTimer); formActivityTimer = window.setTimeout(() => coordinate({ kind: 'claim', targets: [JSON.stringify([page, labelCell.id])] }).catch(err => status(err.message)), 250); return; // NEW
        } // NEW
        if (!event.target.matches?.('input,textarea,select,[contenteditable="true"]')) return; // CHANGE: independent rich-text details participate in existing object holds.
        const binding = event.target.closest('[data-collaboration-object-id],[data-spacing-row-cell]'); // NEW
        const form = event.target.closest('[role="dialog"],.geDialog,.usl-scheduler-dialog'); if (!binding && !form) return; // NEW
        const page = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; // NEW
        const id = binding?.dataset.collaborationObjectId || binding?.dataset.spacingRowCell; const targets = id ? [JSON.stringify([page, id])] : selectedObjectKeys(); if (!targets.length) return; // NEW
        editingForm = form || binding; formTargets = targets; window.clearTimeout(formActivityTimer); // CHANGE
        formActivityTimer = window.setTimeout(() => coordinate({ kind: 'claim', targets }).then(result => { if (!result.ok && editingForm?.isConnected) { if (explicitMode) { rejectDialogs(targets, result.reason); return; } let message = editingForm.querySelector('[data-collaboration-notice]'); if (!message) { message = note(editingForm, ''); message.dataset.collaborationNotice = ''; message.setAttribute('role', 'status'); } message.textContent = result.reason + ' Your form entries remain here. Request release before applying them.'; } }).catch(err => status(err.message)), 250); // CHANGE
    }, true); // NEW
    let badgeLayer = null, badgeFingerprint = '', popover = null, popoverKey = null, popoverPinned = false, popoverTimer = null; // NEW
    function closeObjectPopover() { if (popover) popover.remove(); popover = null; popoverKey = null; popoverPinned = false; window.clearTimeout(popoverTimer); } // NEW
    function updateObjectPopover() { // NEW: live coordination details preserve focus and pinned state.
        if (!popover) return; // NEW
        const hold = collaboration?.holds.find(h => h.key === popoverKey), turn = collaboration?.reservations?.find(r => r.key === popoverKey); // NEW
        const message = popover.querySelector('[data-editing-status]'), action = popover.querySelector('[data-hold-action]'); // NEW
        message.textContent = hold ? hold.name + ' is editing.' + (hold.requested ? ' Release requested; ' + Math.max(0, Math.ceil((hold.expiresAt - Date.now()) / 1000)) + ' seconds left to finish.' : ' Holds remain until editing ends or release is requested.') : turn ? turn.name + ' has the next turn. Begin within ' + Math.max(0, Math.ceil((turn.until - Date.now()) / 1000)) + ' seconds.' : 'No editing hold is currently reported.'; // NEW
        action.hidden = !hold; action.textContent = hold?.sessionId === localSessionId ? 'Release now' : 'Request release'; // NEW
    } // NEW
    function showObjectPopover(key, anchor, pinned) { // NEW
        window.clearTimeout(popoverTimer); if (popoverKey === key && popover) { if (pinned) { popoverPinned = !popoverPinned; if (popoverPinned) popover.querySelector('button:not([hidden])')?.focus(); } return; } closeObjectPopover(); // NEW
        popoverKey = key; popoverPinned = !!pinned; popover = document.createElement('section'); popover.setAttribute('role', 'dialog'); popover.setAttribute('aria-label', 'Activity for ' + objectLabel(key)); // NEW
        popover.style.cssText = 'position:fixed;z-index:2147483099;width:300px;max-width:calc(100vw - 24px);max-height:300px;overflow:auto;padding:12px;background:#fff;color:#111827;border:1px solid #9ca3af;border-radius:6px;box-shadow:0 6px 18px #0003;font:13px Arial;'; // NEW
        const bounds = anchor.getBoundingClientRect(); popover.style.left = Math.max(12, Math.min(bounds.left, window.innerWidth - 324)) + 'px'; popover.style.top = Math.max(12, Math.min(bounds.bottom + 4, window.innerHeight - 312)) + 'px'; // NEW
        note(popover, objectLabel(key)); // NEW
        for (const viewer of collaboration?.presence.filter(p => p.targets.includes(key)) || []) note(popover, (viewer.name || viewer.userId) + (viewer.online === false ? ' · offline · status unconfirmed' : ' is viewing')); // CHANGE
        note(popover, '').dataset.editingStatus = ''; // NEW
        const action = button('Request release', async () => { const hold = collaboration?.holds.find(h => h.key === key); if (hold?.sessionId === localSessionId) await (holdEditors ? holdEditors.handoff([key]) : releaseHolds([key])); else if (hold) await coordinate({ kind: 'request', targets: [key] }); updateObjectPopover(); }, popover); action.dataset.holdAction = ''; updateObjectPopover(); // NEW
        note(popover, (lastStatus?.connectedPeers ?? lastStatus?.connectedCollaborators) ? 'Activity is reported by peers; updates may be delayed.' : 'Working locally — holds are unconfirmed.'); // NEW
        button('Close', closeObjectPopover, popover, 'close'); // NEW
        for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click', 'keydown', 'keypress', 'keyup']) popover.addEventListener(type, e => { e.stopPropagation(); if (e.key === 'Escape') closeObjectPopover(); }); // NEW
        popover.addEventListener('mouseenter', () => window.clearTimeout(popoverTimer)); popover.addEventListener('mouseleave', () => { if (!popoverPinned) popoverTimer = window.setTimeout(closeObjectPopover, 90); }); document.body.appendChild(popover); if (pinned) popover.querySelector('button:not([hidden])')?.focus(); // NEW
    } // NEW
    function renderBadges() { // NEW
        if (!graph.container || !isCollaborative()) { badgeLayer?.remove(); badgeLayer = null; badgeFingerprint = ''; closeObjectPopover(); return; } // NEW
        const entries = new Map(), pageId = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; // NEW
        for (const pending of collaboration?.pendingChanges || []) for (const key of pending.targets) { const labels = entries.get(key) || []; labels.push((pending.name || pending.userId) + (pending.online ? pending.saveState === 'failed' ? ' · save failed' : pending.saveState === 'conflict' ? ' · conflict' : ' · changed · pending project save' : ' · offline · status unconfirmed')); entries.set(key, labels); } // NEW
        for (const key of dirtyObjects) { const labels = entries.get(key) || []; if (!collaboration?.pendingChanges?.some(change => change.sessionId === localSessionId && change.targets.includes(key))) labels.push('You · changed · pending project save'); entries.set(key, labels); } // CHANGE: a peer's pending work cannot hide the local pending indication.
        for (const viewer of collaboration?.presence || []) for (const key of viewer.targets) { const list = entries.get(key) || [], label = (viewer.name || viewer.userId) + (viewer.online === false ? ' · offline · status unconfirmed' : ' · viewing'); if (!collaboration?.holds.some(h => h.key === key && h.sessionId === viewer.sessionId) && !list.includes(label)) list.push(label); entries.set(key, list); } // CHANGE
        for (const holder of collaboration?.holds || []) { const list = entries.get(holder.key) || []; list.push(holder.name + ' · editing'); entries.set(holder.key, list); } // NEW
        for (const turn of collaboration?.reservations || []) { const list = entries.get(turn.key) || []; list.push(turn.name + ' · next turn'); entries.set(turn.key, list); } // NEW
        for (const [key] of entries) { // CHANGE: hidden objects remain listed in the overview, without thousands of hidden DOM badges.
            if (key === '*') { entries.delete(key); continue; } // CHANGE
            const [page, id] = JSON.parse(key); // CHANGE
            if (page !== pageId || !graph.view?.getState(graph.getModel?.().getCell(id))) entries.delete(key); // CHANGE
        } // CHANGE
        const fingerprint = JSON.stringify([pageId, ...entries]); // CHANGE: view changes rebuild badges when rendered membership changes.
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
        for (const badge of badgeLayer.querySelectorAll('[data-object-key]')) { const [, id] = JSON.parse(badge.dataset.objectKey), cell = graph.getModel?.().getCell(id), state = graph.view?.getState(cell); badge.hidden = !state; if (state) { const left = state.x + state.width + 4 + 'px', top = state.y + 'px'; if (badge.style.left !== left) badge.style.left = left; if (badge.style.top !== top) badge.style.top = top; } } // CHANGE: do not rewrite stationary badge geometry.
        updateObjectPopover(); // NEW
    } // NEW
    const collaborationTimer = window.setInterval(async () => { // NEW
        if (!isCollaborative() || acquiring) return; try { // NEW
            if (editingForm && !editingForm.isConnected) { editingForm = null; const pinned = holdEditors?.pinnedTargets() || []; const targets = (collaboration?.holds || []).filter(hold => hold.sessionId === localSessionId && !pinned.includes(hold.key)).map(hold => hold.key); if (targets.length) await releaseHolds(targets); } // CHANGE
            await readRemote('view'); // CHANGE: retain cadence while serializing content applications.
        } catch (err) { status(err.message); } // NEW
    }, 5000); // NEW
    window.addEventListener('beforeunload', () => { window.clearInterval(collaborationTimer); closeObjectPopover(); }); // NEW
    if (bridge.onActivity) bridge.onActivity(snapshot => { if (snapshot.diagramPath === context().diagramPath && snapshot.shareId === info?.shareId) adoptActivity(snapshot.collaboration); }); // NEW
    window.addEventListener('beforeunload', () => { background?.dispose(); }); // NEW
    if (graph.view?.addListener) for (const event of ['scale', 'translate', 'scaleAndTranslate']) graph.view.addListener(event, renderBadges); // NEW
    ui.editor.addListener?.('pageSelected', renderBadges); // NEW
    installCollaborationHooks(); // NEW
    if (graph.addListener) { // NEW: explicit native label-editing intent acquires a hold before text is committed.
        graph.addListener('startEditing', (_sender, event) => { // CHANGE
            if (!isCollaborative()) return; const cell = event.getProperty?.('cell') || graph.getSelectionCell?.(); if (!cell) return; // NEW
            const page = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; let planting = null; // NEW
            for (let cursor = cell; cursor; cursor = graph.getModel().getParent(cursor)) if (/(?:^|;)tiler_group=1(?:;|$)/.test(cursor.style || '') || cursor.getAttribute?.('planting_id') || cursor.getAttribute?.('tiler_group') === '1') planting = cursor; // NEW
            labelEditorRegistration?.dispose(); labelEditorRegistration = null; // NEW
            if (planting) labelEditorRegistration = holdEditors?.register({ // NEW
                kind: 'planting', targets: [JSON.stringify([page, planting.id])], capture: () => ({ pageId: page, objectId: planting.id, labelCellId: cell.id, labelHtml: graph.cellEditor?.textarea?.innerHTML || '' }), // NEW
                save() { if (graph.cellEditor?.editingCell === cell) { stoppingForSave = true; try { graph.stopEditing(false); } finally { stoppingForSave = false; } } return true; }, // NEW
                discard() { if (graph.cellEditor?.editingCell === cell) { stoppingForSave = true; try { graph.stopEditing(true); } finally { stoppingForSave = false; } } } // NEW
            }); // NEW
            labelClaim = labelEditorRegistration ? labelEditorRegistration.acquire() : coordinate({ kind: 'claim', targets: [JSON.stringify([page, cell.id])] }).then(result => { if (!result.ok) { graph.stopEditing?.(true); status(result.reason); } }); // NEW
            labelClaim = labelClaim.catch(error => status(error.message)); // NEW
        }); // CHANGE
        graph.addListener('editingStarted', () => { editingLabel = true; }); // NEW
        graph.addListener('editingStopped', () => { const wasEditing = editingLabel; editingLabel = false; if (!wasEditing || stoppingForSave || !isCollaborative()) return; labelEditorRegistration?.dispose(); labelEditorRegistration = null; labelClaim.then(() => { const pinned = holdEditors?.pinnedTargets() || [], targets = (collaboration?.holds || []).filter(hold => hold.sessionId === localSessionId && !pinned.includes(hold.key)).map(hold => hold.key); if (targets.length) return releaseHolds(targets); }).catch(err => status(err.message)); }); // CHANGE
    } // NEW
    window.Trellis = window.Trellis || {};
    /** Explicit forms keep their private drafts until the existing claim and collaborative save have both settled. */ // CHANGE
    async function settleObjectEdits(options = {}) { // CHANGE
        if (!isCollaborative()) return; const current = file(); // CHANGE
        await acquisitionPromise; // CHANGE
        if (file() !== current) throw new Error('The diagram changed before the comment was accepted.'); // CHANGE
        await saveCurrent(); // CHANGE
        if (options.release) await releaseUnpinnedHolds(); // CHANGE: command cleanup must not release an active planner's hold.
    } // CHANGE
    /** Hand off completed edits while retaining holds pinned by an active editor. */ // NEW
    async function releaseUnpinnedHolds() { // NEW
        const pinned = holdEditors?.pinnedTargets() || [], targets = (collaboration?.holds || []).filter(hold => hold.sessionId === localSessionId && !pinned.includes(hold.key)).map(hold => hold.key); // NEW
        if (targets.length) await coordinate({ kind: 'release', targets }); // NEW
    } // NEW
    window.Trellis.sharing = { ensureManaged, prepareInvite, validateInvite, showJoinDialog, showSharingDialog, refresh, whenDocumentReady, context, describeStatus, settleObjectEdits, registerEditor: config => holdEditors?.register(config), getStatus: () => lastStatus, getInfo: () => info, isApplyingRemote: () => !!graph.__trellisSharingApplying, isExplicitRefresh: () => explicitMode && isCollaborative(), isPendingCell, permissionChanges: () => unsavedActions.filter(action => !action.edit.__trellisUsersRejected && !action.edit.undone).flatMap(action => action.edit.changes || []), historyXml: async () => (await coordinate({ kind: 'history-state' }))?.xml, getPendingChanges: () => incoming?.getGroups() || [] }; // CHANGE
    /** Authenticate, initialize the remembered base, then claim and save the same account transition. */ // NEW
    window.Trellis.sharing.finishIdentityJoin = async function (options) { // NEW
        if (identityJoinInProgress) throw new Error('This invitation is already being completed.'); // NEW
        const current = file(); identityJoinInProgress = true; // NEW
        try { // NEW
            const result = await users().finishIdentityJoin(options); if (!result.ok) return result; // NEW
            if (file() !== current) throw new Error('The project changed before the invitation could be saved.'); // NEW
            await refresh(); // NEW
            if (file() !== current || context().userId !== result.user.id) throw new Error('The project account changed before saving. Resume the invitation.'); // NEW
            if (isCollaborative() && current.isModified()) { // NEW
                const claim = await coordinate({ kind: 'claim', baseXml: collaborationBaseline || current.data, xml: ui.getFileData(), usersPolicyAction: true }); // NEW
                if (!claim?.ok) throw new Error(claim?.reason || 'Project access is still loading. Resume the invitation.'); // NEW
            } // NEW
            await saveCurrent(); return result; // NEW
        } finally { identityJoinInProgress = false; } // NEW
    }; // NEW
    /** Generated descendants and derived tasks share source freshness; unrelated ancestors do not freeze content editing. */ // CHANGE
    function isPendingCell(cell) {
        const recoveryPage = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; // NEW
        if (recoveringTargets.has('*')) return true; // CHANGE
        for (let cursor = cell; cursor; cursor = graph.getModel?.().getParent(cursor)) if (recoveringTargets.has(JSON.stringify([recoveryPage, String(cursor.id)]))) return true; // NEW
        if (!explicitMode || !isCollaborative() || !cell) return false;
        if (!viewIdentity) return true; // NEW: loading/recovery cannot expose editing against an unknown remembered base.
        const pending = incoming?.getGroups() || [], page = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || '';
        if (pending !== indexedPending) { indexedPending = pending; pendingKeys = new Set(pending.flatMap(group => [...group.keys, ...group.targets])); pendingStructure = pending.some(group => group.structural); } // NEW
        if (refreshingTargets.has('*') || pendingStructure) return true; // CHANGE
        let logical = cell; // NEW: ancestors are not automatically content dependencies; a new sibling must not freeze the entire canvas.
        for (let cursor = cell; cursor; cursor = graph.getModel().getParent(cursor)) if (/(?:^|;)tiler_group=1(?:;|$)/.test(cursor.style || '') || cursor.getAttribute?.('planting_id')) logical = cursor; // NEW
        const ids = new Set([String(cell.id), String(logical.id)]); // NEW
        const source = cell.getAttribute?.('derived_source_group_id'); if (source) ids.add(source); // NEW
        if (cell.getAttribute?.('kanban_card') === '1' || /(?:^|;)kanban_card=1(?:;|$)/.test(cell.style || '')) for (const id of String(cell.getAttribute?.('linkedTo') || '').split(',').map(value => value.trim()).filter(Boolean)) ids.add(id); // NEW
        for (const id of ids) {
            const key = JSON.stringify([page, id]), raw = JSON.stringify(['', id]); // CHANGE
            if (refreshingTargets.has(key) || pendingKeys.has(key) || (ui.pages?.length || 1) === 1 && pendingKeys.has(raw)) return true; // CHANGE
        }
        return false;
    }
    function adoptPolicy(state) { // NEW: Users reads effective policy without rewriting stale content or acquiring editing holds.
        if (!explicitMode || !state?.policy) return;
        const previous = graph.__trellisSharedPolicy?.cells || new Map();
        const cells = new Map([...previous.keys()].map(key => [key, { attributes: {} }]));
        for (const cell of state.policy.cells) cells.set(cell.key, cell);
        graph.__trellisSharedPolicy = { ...state.policy, diagramId: info?.diagramId, cells }; // CHANGE
        users()?.revalidateCurrentSession?.();
    }
    /** Lost holds discard only the affected forms; submitted diagram proposals retain the existing recovery copies. */ // NEW
    function rejectDialogs(targets, reason) {
        if (!targets?.length) return;
        const page = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; // CHANGE
        const all = targets.includes('*'), keys = new Set(targets);
        const affected = id => { // NEW: a logical parent hold also protects the forms of its descendants.
            let cell = graph.getModel().getCell(id);
            do { if (keys.has(JSON.stringify([page, String(cell?.id || id)])) || keys.has(JSON.stringify(['', String(cell?.id || id)]))) return true; cell = cell && graph.getModel().getParent(cell); } while (cell);
            return all;
        };
        const forms = new Set(); // NEW
        graph.__trellisObjectDetails?.rejectHolds?.(targets);
        const label = graph.cellEditor?.editingCell;
        if (label && affected(label.id)) { stoppingForSave = true; try { graph.stopEditing?.(true); } finally { stoppingForSave = false; } }
        for (const binding of document.querySelectorAll('[data-collaboration-object-id],[data-spacing-row-cell]')) {
            if (!affected(binding.dataset.collaborationObjectId || binding.dataset.spacingRowCell)) continue; // CHANGE
            const form = binding.closest('[role="dialog"],.geDialog,.usl-scheduler-dialog');
            if (form) forms.add(form); // CHANGE
        }
        if (editingForm?.isConnected && (all || formTargets.some(key => targets.includes(key)))) {
            forms.add(editingForm); // CHANGE
        }
        for (const dialog of [...(ui.dialogs || [])].reverse()) if ([...forms].some(form => dialog.container === form || dialog.container?.contains(form) || form.contains(dialog.container))) { // NEW
            if (dialog === ui.dialog) ui.hideDialog(true, false, dialog.container.firstChild);
            else { // NEW: use the native cancel lifecycle without dismissing an unrelated top dialog.
                dialog.closing = true;
                if (dialog.close(true, false) !== false) { const index = ui.dialogs.indexOf(dialog); if (index >= 0) ui.dialogs.splice(index, 1); ui.dialog = ui.dialogs[ui.dialogs.length - 1] || null; ui.editor.fireEvent(new mxEventObject('hideDialog', 'dialog', dialog)); }
                delete dialog.closing;
            }
        }
        if (all || formTargets.some(key => { const [targetPage, id] = JSON.parse(key); return (targetPage === page || !targetPage) && affected(id); })) { editingForm = null; formTargets = []; window.clearTimeout(formActivityTimer); } // CHANGE
        status((reason || 'Editing hold rejected.') + ' The affected edit dialogs were closed and their unapplied entries discarded. Submitted diagram edits remain available in Recovery copies.');
    }
    if (explicitMode && !window.TrellisIncomingChanges) { status('Incoming change review could not load. Reopen Trellis before editing shared canvases.'); graph.setEnabled?.(false); return; } // NEW
    if (explicitMode) incoming = window.TrellisIncomingChanges.create(ui, { // NEW
        coordinate, status, timing: timings,
        settle: async () => { await acquisitionPromise; await collaborationSave; },
        beginRefresh: () => { // NEW: capture prior work before installing the save barrier, avoiding a save/refresh wait cycle.
            const claims = acquisitionPromise, saves = collaborationSave, previous = refreshSaveBarrier;
            let finish; refreshSaveBarrier = new Promise(resolve => { finish = resolve; });
            return { settle: async () => { await previous; await claims; await saves; }, finish };
        },
        blockedTargets: () => { const held = collaboration?.holds.filter(hold => hold.sessionId === localSessionId).map(hold => hold.key) || []; return [...(holdEditors?.pinnedTargets() || []), ...(acquiring ? ['*'] : []), ...(editingForm?.isConnected ? formTargets : []), ...(graph.isEditing?.() ? selectedObjectKeys() : []), ...(file()?.isModified() ? held.length ? held : ['*'] : [])]; }, // CHANGE
        freeze: targets => { refreshingTargets = new Set(targets); return () => { refreshingTargets.clear(); }; },
        applying: operation => {
            const before = graph.__trellisSharingApplying, internal = graph.__trellisUsersInternalChange;
            graph.__trellisSharingApplying = true; graph.__trellisUsersInternalChange = true;
            try { return operation(); } finally { graph.__trellisSharingApplying = before; graph.__trellisUsersInternalChange = internal; }
        },
        applyXml: xml => applyRemote(xml, file()),
        observe: () => { observedXml = ui.getFileData(); }, // NEW: update the claim base without advancing the saved or remembered objects.
        adopt: xml => { collaborationBaseline = xml; observedXml = file().isModified() ? ui.getFileData() : xml; file().data = xml; pendingHash = null; },
    }); // NEW
    for (const name of ['isCellEditable', 'isCellMovable', 'isCellResizable', 'isCellDeletable', 'isCellRotatable', 'isCellConnectable']) if (graph[name]) { const allowed = graph[name]; graph[name] = function (cell) { return !isPendingCell(cell) && allowed.apply(this, arguments); }; } // CHANGE
    window.Trellis.sharing.refreshHistoryStorage = async function () { // NEW
        const captured = info; if (!captured?.managed || !bridge.historyStorage) return;
        try { // NEW
            const result = await bridge.historyStorage({ shareId: captured.shareId });
            if (info === captured) { graph.__ccSharedHistoryStorage = result; await history()?.refreshStorage?.(); }
        } catch (_) { if (info === captured) { graph.__ccSharedHistoryStorage = null; await history()?.refreshStorage?.(); } } // NEW: unreadable storage is unavailable, not zero or an unhandled rejection.
    };
    window.Trellis.sharing.restoreHistory = async function (xml) { // NEW
        if (!info?.managed) { if (graph.__trellisLocalView) graph.__trellisLocalView.apply(() => ui.setFileData(xml)); else ui.setFileData(xml); return; } // CHANGE
        const current = file(), generation = contextGeneration;
        const proposal = { kind: 'claim', baseXml: collaborationBaseline || current.data, xml };
        const claim = await coordinate(proposal);
        if (!claim.ok) throw new Error(claim.reason || 'History restore could not acquire editing holds.');
        const result = await coordinate({ ...proposal, kind: 'save' });
        if (file() !== current || generation !== contextGeneration) throw new Error('The document changed before history restore completed.');
        if (!result.ok) throw new Error(result.reason || 'History restore was rejected by collaboration policy.');
        applyRemote(explicitMode ? xml : result.xml, current); // CHANGE: explicit restore is the user's own authorized edit.
        pendingHash = null; // NEW
    };
    window.Trellis.sharing.adoptOwnProjectName = async function (diagramId) { // NEW: the library's own rename is already accepted and remembered for this view.
        if (!explicitMode || !isCollaborative() || info.diagramId !== diagramId) return;
        const current = file(), before = collaborationBaseline, result = await coordinate({ kind: 'open-view', retry: true });
        if (!result || file() !== current) return;
        applyRemote(result.xml, current, current.stat, current.isModified() ? before : undefined);
        incoming?.setGroups(result.groups || []); pendingHash = result.collaboration?.hash;
    };
    window.Trellis.sharing.automationHolds = () => isCollaborative() ? (collaboration?.holds || []).map(hold => ({ ...hold, local: hold.sessionId === localSessionId })) : []; // CHANGE: preflight protects remote editors and unrelated local drafts.
    graph.__trellisSharing = window.Trellis.sharing;
    ui.actions.addAction('trellisJoinSharedCanvas', showJoinDialog).label = 'Join Shared Canvas';
    ui.actions.addAction('trellisCanvasSync', () => showSharingDialog().catch(err => status(err.message))).label = 'Canvas Sync';
    ui.actions.addAction('trellisIncomingChanges', () => incoming?.reviewAll().catch(err => status(err.message))).label = 'Review Incoming Changes'; // NEW
    ui.actions.addAction('trellisRecoverRememberedView', async () => { // NEW: recovery requires an explicit action, never silent adoption of current content.
        if (!explicitMode || !isCollaborative()) return;
        if (viewIdentity || file()?.isModified()) { status('Finish saving or preserve the current draft in Recovery copies. Use Review Incoming Changes for an available remembered view.'); return; } // NEW: recovery cannot bypass freshness or overwrite unsaved work.
        const panel = showDialog('Remembered view recovery'); note(panel, 'Opening the latest accepted objects replaces your unavailable remembered view. Existing submitted-edit recovery copies are retained.');
        button('Open latest accepted objects', async () => { const result = await coordinate({ kind: 'reset-view' }); if (!result) return; applyRemote(result.xml, file()); viewIdentity = context().userId; incoming?.setGroups(result.groups || []); pendingHash = null; closeDialog(); users()?.revalidateCurrentSession?.(); }, panel);
    }).label = 'Recover Remembered View'; // NEW
    const extras = ui.menus.get('extras');
    if (extras) { const original = extras.funct; extras.funct = function (menu, parent) { original.apply(this, arguments); ui.menus.addMenuItems(menu, ['-', 'trellisJoinSharedCanvas', 'trellisCanvasSync', 'trellisIncomingChanges', 'trellisRecoverRememberedView'], parent); }; } // CHANGE
    let sessionIdentity = context().userId; // NEW: Users also emits this event during same-user permission revalidation.
    window.addEventListener('trellisUsersSessionChanged', () => { // CHANGE
        if (!explicitMode) { refresh().catch(err => status(err.message)); return; }
        const nextIdentity = context().userId; if (nextIdentity === sessionIdentity) return;
        sessionIdentity = nextIdentity;
        invalidateDocumentReady(); // NEW
        const current = file(), previousIdentity = viewIdentity, shareId = info?.shareId, generation = ++contextGeneration; // CHANGE
        const privateDraft = previousIdentity && isCollaborative() && bridge.recoveryAction && (current?.isModified() || holdEditors?.pinnedTargets().length) ? { shareId, kind: 'checkpoint', expectedUserId: previousIdentity, revision: modelRevision, baseXml: collaborationBaseline || current.data, xml: ui.getFileData(), editorDrafts: holdEditors?.capture(['*']) || [] } : null; // NEW
        const privatePreservation = privateDraft ? bridge.recoveryAction(privateDraft) : null; // NEW: capture before disposing the previous author's editor registrations.
        background?.dispose(); background = null; backgroundFile = null; savedObjects.clear(); dirtyObjects.clear(); // NEW
        holdEditors?.reset(); labelEditorRegistration = null; unsavedActions.length = 0; recoveringTargets.clear(); recoveryQueue = Promise.resolve(); recoveryFailure = null; retryRecovery = null; saveFence = Promise.resolve(); // NEW
        incoming?.reset(); viewIdentity = null; pendingHash = null;
        const draft = previousIdentity && isCollaborative() && current?.isModified() ? ui.getFileData() : null;
        const preservation = privatePreservation ? privatePreservation.then(() => ({ private: true })) : draft ? bridge.saveRecoveryCopy({ shareId, xml: draft }) : Promise.resolve(null); // CHANGE
        preservation.then(copy => {
            if (file() !== current || generation !== contextGeneration) return;
            if (copy) { localRecovery = copy.private ? null : copy; current.setModified(false); status(copy.private ? 'The previous user’s draft was preserved privately for that author.' : 'The previous user’s unsaved diagram edits were preserved in Recovery copies: ' + copy.recoveryPath); } // CHANGE
            return refresh();
        }).catch(error => status('The previous draft remains open; its recovery copy could not be saved. ' + error.message));
    });
    window.addEventListener('trellisProjectNamed', event => { // CHANGE
        if (info && info.diagramId === event.detail.diagramId) info.diagramPath = event.detail.path; // NEW
        const current = file(), metadata = graph.getModel?.().getCell?.('1'); // NEW
        if (explicitMode && isCollaborative()) { pendingHash = null; readRemote('view').catch(err => status(err.message)); return; } // NEW: path bookkeeping is immediate; remote canvas naming content still waits.
        if (!isCollaborative() || metadata?.getAttribute?.('trellis_project_name') === event.detail.projectName) { synchronizeContext().catch(err => status(err.message)); return; } // NEW
        const task = (current.__trellisNamingSync || Promise.resolve()).then(async () => { // NEW
            const result = await coordinate({ kind: 'get' }); // NEW
            if (file() !== current || !result) return; // NEW
            applyRemote(result.xml, current, current.stat, current.isModified() ? collaborationBaseline : undefined); // NEW: patch changes since the saved baseline, retaining unrelated unsaved objects.
        }); // NEW
        current.__trellisNamingSync = task; task.catch(err => status(err.message)).finally(() => { if (current.__trellisNamingSync === task) current.__trellisNamingSync = null; }); // NEW
    }); // NEW
    window.addEventListener('trellisHistoryRevisionRecorded', historyRecorded);
    bridge.onStatus(canvases => {
        const current = context();
        const previousState = assetAvailability, previousSequence = assetSequence; // CHANGE
        lastStatus = canvases.find(canvas => canvas.diagramPath === current.diagramPath) || null;
        assetAvailability = lastStatus?.state || null; // CHANGE
        assetSequence = lastStatus?.folderSequence ?? null; // CHANGE
        if (info?.assetBaseUrl && lastStatus?.state === 'upToDate' && (previousState !== 'upToDate' || previousSequence !== null && assetSequence !== null && previousSequence !== assetSequence)) refreshManagedImages(); // CHANGE: downloads may complete between two otherwise identical idle observations.
        if (lastStatus?.collaboration) { // CHANGE
            const next = { ...lastStatus.collaboration, sessionId: localSessionId }, previous = collaboration?.holds?.filter(hold => hold.sessionId === localSessionId) || [];
            if (explicitMode) { const lost = previous.filter(hold => !releasingClaims.has(hold.claimId) && !next.holds?.some(item => item.claimId === hold.claimId && item.sessionId === localSessionId)); if (lost.length) recoverLostHolds(lost.map(hold => hold.key), 'Your editing hold expired, access changed, or another concurrent editor has priority.').catch(() => {}); adoptPolicy(next); } // CHANGE
            adoptActivity(next); // CHANGE: polling preserves the same names and badge meanings as the independent subscription.
        } // CHANGE
        if (lastStatus && info) importNewHistory().catch(err => status(err.message));
        if (explicitMode && isCollaborative() && viewIdentity && lastStatus?.collaboration?.hash !== pendingHash) readRemote('view').catch(err => status(err.message)); // NEW
        announce();
    });
    ui.editor.addListener('pageSelected', () => { modelRevision++; }); // CHANGE: page switches invalidate pending captures too.
    ui.editor.addListener('fileLoaded', () => { window.TrellisContentPolicy?.resetDocument(); contextGeneration++; modelRevision++; holdEditors?.reset(); labelEditorRegistration = null; unsavedActions.length = 0; recoveringTargets.clear(); recoveryQueue = Promise.resolve(); recoveryFailure = null; retryRecovery = null; saveFence = Promise.resolve(); // CHANGE
         background?.dispose(); background = null; backgroundFile = null; savedObjects.clear(); dirtyObjects.clear(); conflictDialog?.remove(); conflictDialog = null; // NEW
         invalidateDocumentReady(); classifiedFile = null; // CHANGE
         delete graph.__trellisSharedPolicy; remoteReadTask = null; window.clearTimeout(formActivityTimer); closeDialog(); acquiring = false; pendingEdits = []; acquisitionObjects.clear(); info = null; collaborationBaseline = null; observedXml = null; localSessionId = null; collaboration = null; viewIdentity = null; pendingHash = null; incoming?.reset(); refreshingTargets.clear(); formTargets = []; closeObjectPopover(); localRecovery = null; remoteBaselinePending = false; queuedHistory.clear(); importedIds.clear(); publishedIds.clear(); installFileHooks(); refresh(); }); // CHANGE
    installFileHooks();
    refresh();
    if (window.CustomEvent) window.dispatchEvent(new window.CustomEvent('trellisGardenToolsReady')); // NEW: notify document startup after installing this tool's API.
});
