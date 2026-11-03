// NEW: Renderer orchestration for managed canvas sharing; credentials stay in Electron.
Draw.loadPlugin(function (ui) {
    'use strict';
    const GRAPH_OVERLAY_Z = Object.freeze({ ANNOTATION: 10000, CONNECTION: 10010, CONTROL: 10020, CONTROL_TOP: 10030 }); // CHANGE: nonmodal activity details share the Trellis overlay-layer contract.
    const protocol = window.TrellisSyncContract; // NEW: index.html installs the shared protocol contract before plugins.
    if (!protocol) throw new Error('The synchronization contract was not loaded.'); // NEW
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
    const publishedIds = new Set(); // CHANGE: only recent UI receipts; signed transport heads own durable deduplication.
    const queuedHistory = new Map();
    let localRecovery = null;
    let remoteBaselinePending = false; // NEW: imported history may arrive after its diagram replacement.
    let modelRevision = 0, tracksModelChanges = false, remoteReadTask = null; // CHANGE: invalidate captures without serializing the live graph.
    let background = null, backgroundFile = null, dirtyObjects = new Set(), savedObjects = new Map(), conflictDialog = null; // NEW
    let saveStatusOwner = null; // NEW: only owned progress text may be replaced by countdown ticks.
    let assetAvailability = null, assetSequence = null; // CHANGE: retain observations independently of mutable status objects.
    const explicitMode = !window.__trellisLiveUpdatesForBenchmark; // CHANGE: missing review code must never silently enable automatic content updates.
    let incoming = null, viewIdentity = null, pendingHash = null, refreshingTargets = new Set(), formTargets = []; // NEW
    const releasingClaims = new Set(); // NEW: intentional handoffs must not produce hold-loss discard notices.
    let activityRevision = -1; const lossChecks = new Map(), frozenForms = new Map(), retainedLosses = new Map(); // CHANGE: observations and retained drafts belong to one renderer context.
    const editingResolutions = new Map(), resumingTargets = new Set(); // CHANGE: UI actions retain their originating author, document and loss generation.
    const composingFields = new Set(); // CHANGE: an active IME composition is not an editing pause.
    const gardenCreations = new Map(), creationMembers = new Map(), creationDrafts = new Map(), creationEditors = new Set(); // NEW: presentation state is private to the current author/document, never save authority.
    let creationEdits = new WeakMap(), creationDraftObserver = null; // NEW: native edits retain their creation identity through Undo/Redo without serializing it.
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
    function status(message, action) { if (ui.editor.setStatus) ui.editor.setStatus(String(message), action); } // CHANGE
    /** Preserve unrelated notices, callbacks and alerts when refreshing local save progress. */ // NEW
    function setSaveStatus(current, message, submitting = false) { // NEW
        if (file() !== current || !isCollaborative()) return; // NEW
        const visible = ui.statusContainer?.textContent ?? ui.editor.getStatus?.() ?? ''; // NEW
        const owned = saveStatusOwner?.file === current && saveStatusOwner.generation === contextGeneration && saveStatusOwner.message === visible; // NEW
        const saved = current.allChangesSavedKey && window.mxResources?.get?.(current.allChangesSavedKey); // NEW
        if (!submitting && (ui.editor.statusFunction || ui.statusContainer?.querySelector('.geStatusAlert') || visible && !owned && visible !== saved)) return; // NEW
        if (!message && !owned) return; // NEW
        if (visible !== message) status(message); // NEW
        saveStatusOwner = message ? { file: current, generation: contextGeneration, message } : null; // NEW
    } // NEW
    /** Drop only our own text when a file or author context is invalidated. */ // NEW
    function clearSaveStatus() { // NEW
        const visible = ui.statusContainer?.textContent ?? ui.editor.getStatus?.() ?? ''; // NEW
        if (saveStatusOwner?.message === visible && !ui.editor.statusFunction) status(''); // NEW
        saveStatusOwner = null; // NEW
    } // NEW
    /** The countdown measures the editing pause, never a promise of completed persistence. */ // NEW
    function renderSaveStatus(current) { // NEW
        if (file() !== current || backgroundFile !== current || !background || window.__trellisClosing) return; // NEW
        const timing = background.getSaveStatus(), batch = current.__trellisSaveBatch, stage = current.__trellisSaveStage; // NEW
        if (timing.state === 'saving' || current.__trellisCollaborativeSaving || batch?.capturedRevision != null && stage === 'saving garden') return; // NEW: finish displaying an active capture before counting down newer edits.
        if (!current.isModified()) { setSaveStatus(current, ''); return; } // NEW
        if (!coordinationAvailable()) { setSaveStatus(current, lastStatus?.editingAvailability?.reason || info?.editingAvailability?.reason || 'Waiting for saving to become available…'); return; } // NEW
        const seconds = Math.ceil(timing.remainingMs / 1000); // NEW
        let message; // NEW
        if (timing.busy) message = 'Waiting for editing to finish…'; // NEW
        else if (seconds > 0 && (!batch || batch.automatic)) message = 'Changes waiting to save · ' + seconds + ' ' + (seconds === 1 ? 'second' : 'seconds') + ' remaining'; // NEW
        else if (stage === 'waiting for editing access') message = 'Waiting for editing access…'; // NEW
        else if (stage === 'queued') message = 'Waiting for queued save…'; // NEW
        else message = 'Preparing to save…'; // NEW
        setSaveStatus(current, message); // NEW
    } // NEW
    function objectFingerprint(key) { // NEW: encode only the affected cell; never serialize the whole document for a badge.
        if (key === '*') return ui.getFileData(); // NEW: genuinely project-wide structural changes require the complete envelope.
        const [page, id] = JSON.parse(key), currentPage = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; // NEW
        let cell = page === currentPage ? graph.getModel().getCell?.(id) : null; // CHANGE
        if (!cell) { const target = ui.pages?.find(item => (item.getId?.() || item.node?.getAttribute('id') || '') === page); const visit = value => { if (!value) return null; if (String(value.id) === id) return value; for (const child of value.children || []) { const found = visit(child); if (found) return found; } return null; }; cell = visit(target?.root); } // NEW
        if (!cell) return null; // NEW
        const encode = () => { // CHANGE: a planting's pending baseline includes the actual content represented by its group badge.
            const codec = new mxCodec(), values = []; // CHANGE
            const visit = node => { values.push(mxUtils.getXml(codec.encode(node))); for (const child of node.children || []) visit(child); }; // CHANGE
            if (cell.getAttribute?.('tiler_group') === '1' || cell.getAttribute?.('planting_id') || /(?:^|;)tiler_group=1(?:;|$)/.test(cell.style || '')) { visit(cell); return JSON.stringify(values); } // CHANGE
            return mxUtils.getXml(codec.encode(cell)); // CHANGE
        }; // CHANGE
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
    /** Forget presentation state without changing holds, dirty objects, or serialized content. */ // NEW
    function resetGardenCreations() { // NEW
        gardenCreations.clear(); creationMembers.clear(); creationDrafts.clear(); creationEditors.clear(); creationEdits = new WeakMap(); // NEW
        creationDraftObserver?.disconnect(); creationDraftObserver = null; // NEW
    } // NEW
    /** Capture only the real factory's accepted native creation edit; selection cannot create a group. */ // NEW
    function observeGardenCreation(edit, page) { // NEW
        const source = graph.__trellisModuleCreation; // NEW
        if (!creationEdits.has(edit) && source?.gardenId && source.actorUserId === context().userId && !edit.undone && !edit.redone) { // NEW
            const gardenKey = JSON.stringify([page, String(source.gardenId)]); // NEW
            if (!gardenCreations.has(gardenKey) && edit.changes.some(change => change.constructor?.name === 'mxChildChange' && String(change.child?.id) === String(source.gardenId) && change.parent && !change.previous)) { // NEW
                const descriptor = { gardenKey, cells: source.cells.slice() }; // NEW
                Object.defineProperty(edit, '__trellisGardenCreation', { value: descriptor, configurable: true }); // NEW
                const group = { ...descriptor, garden: source.cells.find(cell => String(cell.id) === String(source.gardenId)), edit, revision: modelRevision, file: file(), generation: contextGeneration, userId: context().userId, sessionId: localSessionId, saved: false, manualEdits: new Map() }; // NEW
                gardenCreations.set(gardenKey, group); creationEdits.set(edit, group); // NEW
                for (const cell of group.cells) creationMembers.set(JSON.stringify([page, String(cell.id)]), { group, cell }); // NEW
            } // NEW
        } // NEW
        for (const change of edit.changes) { // NEW
            if (editContext?.kindOf(change) !== 'manual' || !editContext.isContentChange(change)) continue; // NEW
            const cell = editContext.logicalCell(change.cell || change.child), member = creationMembers.get(JSON.stringify([page, String(cell?.id)])); // NEW
            if (!member || member.group.edit === edit) continue; // NEW: creating the garden is not a later manual edit to its starter content.
            const first = member.group.manualEdits.get(cell.id); // NEW
            if (!first || first.undone || first.__trellisUsersRejected) member.group.manualEdits.set(cell.id, edit); // NEW: the first active manual edit suffices; do not retain every later Undo record.
        } // NEW
    } // NEW
    /** Saved creation groups stop aggregating pending work; untouched initial holds still need no editing label. */ // NEW
    function untouchedCreationMember(key, includeSaved = false) { // NEW
        const member = creationMembers.get(key), group = member?.group; // NEW
        if (!group || group.file !== file() || group.generation !== contextGeneration || group.userId !== context().userId || group.sessionId && group.sessionId !== localSessionId || group.edit.undone || group.edit.__trellisUsersRejected || !includeSaved && group.saved) return null; // NEW
        if (!group.garden?.parent || !member.cell.parent || member.cell.getAttribute?.('trellis_starter_attribution_pending') !== '1') return null; // NEW
        const [page, id] = JSON.parse(key), currentPage = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; // NEW
        if (page === currentPage && graph.getModel?.().getCell(id) !== member.cell) return null; // NEW: a remote/root replacement cannot inherit stale session presentation state.
        const first = group.manualEdits.get(member.cell.id); // NEW
        if (first && !first.undone && !first.__trellisUsersRejected) return null; // NEW
        return member; // NEW
    } // NEW
    /** Project status only: every original key remains in dirtyObjects, save captures and recovery journals. */ // NEW
    function creationPendingKeys(keys, state) { // NEW
        if (state === 'failed' || state === 'conflict') return [...keys]; // NEW: errors retain their actual affected-object anchors.
        return [...new Set([...keys].map(key => untouchedCreationMember(key)?.group.gardenKey || key))]; // NEW
    } // NEW
    function captureGardenCreations(capturedRevision) { // NEW
        return [...gardenCreations.values()].filter(group => !group.saved && group.revision <= capturedRevision && !group.edit.undone && !group.edit.__trellisUsersRejected && group.garden?.parent); // NEW: record membership at capture, before typing or Undo can change the live graph.
    } // NEW
    function finishGardenCreations(captured, current, generation, userId) { // NEW
        if (file() !== current || contextGeneration !== generation || context().userId !== userId) return; // NEW: late native completion cannot retire another author or document's new groups.
        for (const group of captured) group.saved = true; // NEW: a successful captured creation is saved even if the user undid it while persistence was in flight.
    } // NEW
    /** Draft visibility follows its real editor lifetime, including cancellation before a model edit. */ // NEW
    function pruneCreationDrafts() { // NEW
        let changed = false; // NEW
        for (const [key, drafts] of creationDrafts) { // NEW
            for (const draft of drafts) { // NEW
                let visible = draft.element.isConnected && (!draft.editor || creationEditors.has(draft.editor)) && (!draft.nativeCell || graph.cellEditor?.editingCell === draft.nativeCell); // NEW
                for (let node = draft.element; visible && node; node = node.parentElement) if (node.hidden || node.style?.display === 'none') visible = false; // NEW
                if (!visible) { drafts.delete(draft); changed = true; } // NEW
            } // NEW
            if (!drafts.size) creationDrafts.delete(key); // NEW
        } // NEW
        if (!creationDrafts.size) { creationDraftObserver?.disconnect(); creationDraftObserver = null; } // NEW
        return changed; // NEW
    } // NEW
    /** Reuse trusted typing signals and existing editor target bindings; focus is never editing intent. */ // NEW
    function rememberCreationDraft(field) { // NEW
        const page = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || '', binding = field.closest('[data-collaboration-object-id],[data-spacing-row-cell]'); // NEW
        const nativeCell = graph.cellEditor?.textarea?.contains(field) ? graph.cellEditor.editingCell : null; // NEW
        const registered = [...creationEditors].find(entry => { const element = typeof entry.config.element === 'function' ? entry.config.element() : entry.config.element; return element?.contains(field); }); // NEW
        const element = registered ? typeof registered.config.element === 'function' ? registered.config.element() : registered.config.element : nativeCell ? graph.cellEditor.textarea : field.closest('[role="dialog"],.geDialog,.usl-scheduler-dialog,.trellis-object-details') || binding; // NEW
        if (!element) return; // NEW
        const id = nativeCell ? (editContext?.logicalCell(nativeCell) || nativeCell).id : binding?.dataset.collaborationObjectId || binding?.dataset.spacingRowCell; // NEW
        const targets = registered ? typeof registered.config.targets === 'function' ? registered.config.targets() : registered.config.targets : id ? [JSON.stringify([page, String(id)])] : selectedObjectKeys(); // NEW
        for (const key of targets || []) if (untouchedCreationMember(key, true)) { // NEW
            const drafts = creationDrafts.get(key) || new Set(); // NEW
            if (![...drafts].some(draft => draft.element === element)) drafts.add({ element, nativeCell, editor: registered }); // NEW
            creationDrafts.set(key, drafts); // NEW
        } // NEW
        if (creationDrafts.size && !creationDraftObserver && window.MutationObserver) { // NEW
            creationDraftObserver = new window.MutationObserver(() => { if (pruneCreationDrafts()) renderBadges(); }); // NEW
            creationDraftObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style'] }); // NEW
        } // NEW
        renderBadges(); // NEW
    } // NEW
    /** Preserve the registered editor API while removing cancelled draft intent immediately on disposal. */ // NEW
    function registerSharingEditor(config) { // NEW
        const editor = holdEditors?.register(config); if (!editor) return editor; // NEW
        const entry = { config }, dispose = editor.dispose; creationEditors.add(entry); // NEW
        editor.dispose = function () { creationEditors.delete(entry); try { return dispose.apply(this, arguments); } finally { pruneCreationDrafts(); renderBadges(); } }; // NEW
        return editor; // NEW
    } // NEW
    function startBackground() { // NEW
        const current = file(); if (!isCollaborative() || backgroundFile === current || !window.TrellisBackgroundSaving || !bridge.activityAction || !bridge.recoveryAction) return; // NEW
        clearSaveStatus(); background?.dispose(); backgroundFile = current; resetObjectBaselines(); current.autosaveDelay = window.TrellisBackgroundSaving.QUIET_PERIOD_MS; current.maxAutosaveDelay = Infinity; // CHANGE
        const generation = contextGeneration, shareId = info.shareId, expectedUserId = context().userId; // CHANGE
        background = window.TrellisBackgroundSaving.create({ // NEW
            pending: pendingObjects, viewing: selectedObjectKeys, revision: () => modelRevision, // NEW
            busy: () => [...composingFields].some(field => field.isConnected && !field.closest('[data-trellis-frozen]')), // CHANGE
            dirty: () => !window.__trellisClosing && (current.isModified() || !!holdEditors?.pinnedTargets().length), // CHANGE
            publish: async input => { if (file() !== current || generation !== contextGeneration) return; const result = await bridge.activityAction({ shareId, expectedUserId, ...input, pending: creationPendingKeys(input.pending, input.saveState) }); if (file() === current && generation === contextGeneration) adoptActivity(result.collaboration); }, // CHANGE: peers receive the same garden summary while private save tracking stays per object.
            whenCapturable: () => graph.__trellisEditContext?.whenSettled(), // CHANGE: graph recovery shares the local commit barrier with content saves.
            capture: () => { graph.__trellisEditContext?.assertCapturable(); if (file() !== current || generation !== contextGeneration || expectedUserId !== context().userId) throw new Error('The recovery context changed before capture.'); return { kind: 'checkpoint', shareId, expectedUserId, revision: modelRevision, baseXml: collaborationBaseline || current.data, xml: ui.getFileData(), editorDrafts: holdEditors?.capture(['*']) || [] }; }, // CHANGE
            checkpoint: input => bridge.recoveryAction({ ...input, ...(graph.__trellisProjectFormat === 2 ? { references: referenceDependencies() } : {}) }), report: status, // CHANGE: unsaved immutable definitions accompany private checkpoints without entering the content queue.
            onStatusChange: () => { if (file() === current && generation === contextGeneration && expectedUserId === context().userId) { renderSaveStatus(current); renderBadges(); } }, // CHANGE: failure/conflict transitions immediately restore affected-object badge anchors.
        }); // NEW
        current.isAutosaveNow = function () { const marker = {}; this.__trellisAutomaticRequest = marker; Promise.resolve().then(() => { if (this.__trellisAutomaticRequest === marker) delete this.__trellisAutomaticRequest; }); return true; }; // CHANGE: a native no-op autosave must not misclassify a later manual Save.
        const previousChanged = current.fileChanged; // CHANGE
        if (previousChanged && !current.__trellisQuietStatusHook) { current.__trellisQuietStatusHook = true; current.fileChanged = function () { // CHANGE: install once per file; native fileChanged announces Saving before its timer fires.
            const key = this.savingStatusKey; if (file() === current && isCollaborative()) this.savingStatusKey = null; // CHANGE
            try { return previousChanged.apply(this, arguments); } finally { this.savingStatusKey = key; if (file() === current && isCollaborative()) renderSaveStatus(current); } // CHANGE
        }; } // CHANGE
        current.__trellisCheckpoint = () => backgroundFile === current ? background.checkpoint(true) : Promise.resolve(); // NEW
        current.__trellisDiscardCheckpoint = () => bridge.recoveryAction({ shareId, kind: 'discard', revision: modelRevision }); // NEW
        const previousDraft = current.saveDraft; // NEW
        current.saveDraft = function () { if (file() === current && backgroundFile === current) return background.checkpoint().catch(error => status('Recovery checkpoint failed: ' + error.message)); return previousDraft?.apply(this, arguments); }; // NEW
        const previousUnsaved = current.addUnsavedStatus; // NEW
        current.addUnsavedStatus = function () { const result = previousUnsaved?.apply(this, arguments); if (backgroundFile === current && this.saveDraftThread != null) { window.clearTimeout(this.saveDraftThread); this.saveDraftThread = null; } return result; }; // NEW: the independent ten-second timer owns recovery scheduling for this file.
        bridge.recoveryAction({ shareId, kind: 'restore' }).then(result => { if (file() === current && generation === contextGeneration) { current.__trellisRecoveredDrafts = (result.drafts || []).filter(draft => draft.xml !== draft.baseXml || draft.editorDrafts?.length); if (current.__trellisRecoveredDrafts.length) status('A private local draft is available in Sharing → Recovery copies.'); } }).catch(error => status(error.message)); // NEW
        void background.publish(); // NEW
        void retryPrivatePreservation(); // CHANGE: a failed loss draft stays author-scoped in memory across context switches until its author can retry.
    } // NEW
    function adoptActivity(next, intentional = false) { // CHANGE
        if (!next || !isCollaborative()) return; // CHANGE
        if (bridge.activityAction && !Number.isSafeInteger(next.observationRevision)) return false; // CHANGE: an unversioned durable-claim projection is never native activity ownership, including during startup.
        if (next.actorUserId && next.actorUserId !== context().userId) return false; // CHANGE
        if (next.sessionId && localSessionId && next.sessionId !== localSessionId) return false; // CHANGE
        if (Number.isSafeInteger(next.observationRevision)) { if (next.observationRevision <= activityRevision) return false; activityRevision = next.observationRevision; } else if (activityRevision >= 0) return false; // CHANGE: unversioned/cached content cannot replace authoritative activity.
        const previous = collaboration?.holds?.filter(hold => hold.sessionId === localSessionId) || []; // CHANGE
        const started = window.performance.now(); // NEW
        const people = users()?.listUsers?.() || [], named = value => ({ ...value, name: people.find(user => user.id === value.userId)?.name || value.name || value.userId }); // NEW
        const { policy, policyHash, policyRevision, ...activity } = next; // CHANGE: permission snapshots have a separate adoption boundary and clock.
        collaboration = { ...collaboration, ...activity, holds: (next.holds || []).map(named), presence: (next.presence || []).map(named), pendingChanges: (next.pendingChanges || []).map(named) }; localSessionId = next.sessionId || localSessionId; // CHANGE
        if (lastStatus) lastStatus.collaboration = collaboration; holdEditors?.update(collaboration.holds, localSessionId); // CHANGE
        const revoked = previous.filter(hold => collaboration.losses?.some(loss => loss.key === hold.key && loss.code === 'ACCESS_CHANGED')); // CHANGE
        if (revoked.length) { const staged = stageLostDraft(revoked.map(hold => hold.key), 'Your access to this object changed.'); staged.preservation.catch(() => {}); } // CHANGE: capture the old author's private fields before policy revalidation can sign them out.
        announce(); // CHANGE
        timings({ phase: 'activity render', durationMs: window.performance.now() - started }); // NEW
        if (window.TrellisSyncTiming && window.requestAnimationFrame) window.requestAnimationFrame(() => timings({ phase: 'activity paint', durationMs: window.performance.now() - started })); // NEW
        if (explicitMode && !intentional) { const lost = previous.filter(hold => !releasingClaims.has(hold.claimId) && !collaboration.holds.some(item => item.claimId === hold.claimId && item.sessionId === localSessionId)); if (lost.length) void confirmLostHolds(lost); } return true; // CHANGE
    } // NEW
    /** Refresh only activity authority, without renewing a lease or changing graph content. */ // CHANGE
    async function refreshActivity() { // CHANGE
        const current = file(), generation = contextGeneration, expectedUserId = context().userId; // CHANGE
        const result = await bridge.activityAction({ shareId: info.shareId, expectedUserId, kind: 'snapshot' }); // CHANGE
        if (file() !== current || generation !== contextGeneration || expectedUserId !== context().userId) throw new Error('The project or author changed during editing-status confirmation.'); // CHANGE
        if (!result?.ok || !Number.isSafeInteger(result.collaboration?.observationRevision)) throw new Error('Editing status unconfirmed. Your draft has not been reverted.'); // CHANGE
        adoptActivity(result.collaboration, true); return collaboration; // CHANGE
    } // CHANGE
    /** Native editors and countdowns must confirm the same claim generation before freezing a draft. */ // CHANGE
    async function loseEditorHolds(targets, reason, claims) { // CHANGE
        if (bridge.activityAction) { // CHANGE
            const state = await refreshActivity(); // CHANGE
            if (claims?.size && targets.every(key => state.holds.some(hold => hold.key === key && hold.claimId === claims.get(key) && hold.sessionId === localSessionId && (!Number.isFinite(hold.expiresAt) || hold.expiresAt > Date.now())))) return; // CHANGE
            reason = state.losses?.find(loss => targets.includes(loss.key))?.reason || reason; // CHANGE
        } // CHANGE
        return recoverLostHolds(targets, reason); // CHANGE
    } // CHANGE
    /** Confirm absence independently of content saves; a failed status read cannot authorize rollback. */ // CHANGE
    function confirmLostHolds(holds) { // CHANGE
        const current = file(), generation = contextGeneration, expectedUserId = context().userId, shareId = info?.shareId; // CHANGE
        const valid = () => file() === current && contextGeneration === generation && context().userId === expectedUserId && info?.shareId === shareId; // CHANGE
        return Promise.all(holds.map(hold => { // CHANGE
            if (lossChecks.has(hold.claimId)) return lossChecks.get(hold.claimId); // CHANGE
            let confirmed = false; // CHANGE
            const task = Promise.resolve().then(async () => { // CHANGE
                if (bridge.activityAction) { const result = await bridge.activityAction({ shareId, expectedUserId, kind: 'snapshot' }); if (!valid()) return; if (!result?.ok || !result.collaboration || !Number.isSafeInteger(result.collaboration.observationRevision)) throw new Error('A fresh editing-status observation is unavailable.'); adoptActivity(result.collaboration, true); } // CHANGE
                if (!valid() || releasingClaims.has(hold.claimId) || collaboration?.holds?.some(item => item.claimId === hold.claimId && item.sessionId === localSessionId)) return; // CHANGE
                const reported = collaboration?.losses?.find(item => item.key === hold.key), competing = collaboration?.holds?.some(item => item.sessionId !== localSessionId && (item.key === hold.key || item.key === '*' || hold.key === '*')); // CHANGE
                const reason = reported?.reason || (competing ? 'Another concurrent editor has priority for this object.' : hold.requested && hold.expiresAt <= Date.now() ? 'The requested editing handoff deadline ended.' : 'Your editing ownership ended or access to this object changed.'); // CHANGE
                confirmed = true; await recoverLostHolds([hold.key], reason); // CHANGE
            }).catch(error => { if (valid() && !confirmed) status('Editing status unconfirmed. Your draft has not been reverted. ' + error.message); }).finally(() => { if (lossChecks.get(hold.claimId) === task) lossChecks.delete(hold.claimId); }); // CHANGE
            lossChecks.set(hold.claimId, task); return task; // CHANGE
        })); // CHANGE
    } // CHANGE
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
        const current = file(), generation = contextGeneration, expectedUserId = context().userId; let result, storageError; // CHANGE
        try { result = await bridge.recoveryAction({ shareId: info.shareId, kind: 'restore' }); if (!result?.ok) throw new Error(result?.reason || 'Recovery drafts could not be read.'); } catch (error) { result = { drafts: [] }; storageError = error; } // CHANGE
        if (file() !== current || generation !== contextGeneration || expectedUserId !== context().userId) return; // CHANGE
        const pending = [...retainedLosses.values()].filter(record => !record.saved && !record.discarded && record.input.shareId === info.shareId && record.input.expectedUserId === context().userId).map(record => ({ ...record.input, retained: true, unsavedPrivateCopy: true, at: record.at })); // CHANGE
        const panel = showDialog('Private recovery drafts', showSharingDialog), drafts = [...(result.drafts || []), ...pending].filter(draft => draft.xml !== draft.baseXml || draft.editorDrafts?.length); // CHANGE
        if (storageError) note(panel, 'Stored drafts could not be read: ' + storageError.message + '. Entries still in memory are shown below.'); // CHANGE
        if (!drafts.length) note(panel, 'No pending private drafts.'); // NEW
        for (const draft of drafts) { // NEW
            const section = details(panel, 'Draft saved ' + new Date(draft.at).toLocaleString()); // NEW
            if (!draft.retained) button('Recover this draft', async () => { // CHANGE: a loss draft is review-only and must never resume its old editing generation. // NEW
                if (file() !== current || generation !== contextGeneration) throw new Error('The project changed.'); // NEW
                await background?.checkpoint(true); for (const [hash, store] of Object.entries(draft.references || {})) await window.TrellisReferenceCore.registerSnapshotAsync(store, hash); // CHANGE
                if (file() !== current || generation !== contextGeneration) throw new Error('The project changed during recovery verification.'); // NEW
                applyRemote(draft.baseXml, current); resetObjectBaselines(); applyRemote(draft.xml, current); // CHANGE
                collaborationBaseline = draft.baseXml; current.data = draft.baseXml; observedXml = draft.xml; modelRevision = Math.max(modelRevision, draft.revision) + 1; // NEW
                for (const key of savedObjects.keys()) dirtyObjects.add(key); // NEW
                const page = ui.currentPage?.getId?.() || ''; for (const id of Object.keys(graph.getModel().cells || {})) dirtyObjects.add(JSON.stringify([page, id])); // NEW
                current.setModified(true); current.__trellisConflict = true; background?.state('conflict'); closeDialog(); await showDraftConflicts(); // NEW
            }, section, 'open'); // NEW
            if (draft.retained) { // CHANGE
                note(section, draft.reason + ' This retained draft is available for review, copying, and export only.'); // CHANGE
                if (draft.unsavedPrivateCopy) { note(section, 'This copy is still only in memory because private preservation failed. Copy or export it before closing Trellis.'); button('Retry preservation', async () => { await retryPrivatePreservation(); await showPrivateDrafts(); }, section); } // CHANGE
                button('Export draft', () => { const link = document.createElement('a'), url = URL.createObjectURL(new window.Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' })); link.href = url; link.download = 'Trellis-retained-draft.json'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0); }, section, 'open'); // CHANGE
            } // CHANGE
            if (draft.editorDrafts?.length) { const data = document.createElement('textarea'); data.readOnly = true; data.setAttribute('aria-label', 'Recovered editor entries'); data.value = JSON.stringify(draft.editorDrafts, null, 2); data.style.cssText = 'width:100%;height:160px;'; section.appendChild(data); note(section, 'Unapplied editor entries are preserved here for inspection and copying.'); } // NEW
        } // NEW
    } // NEW
    function announce() {
        window.dispatchEvent(new window.CustomEvent('trellisSharingStatusChanged', { detail: { info, status: lastStatus } }));
        if (updateDialog) updateDialog(); renderBadges(); // NEW: update status only; never rebuild active forms.
    }
    /** Progress belongs to one file and must never block a save if an observer fails. */ // NEW
    function saveProgress(current, stage, operation) { // CHANGE
        if (operation) operation.stage = stage; // CHANGE: progress remains associated with the capture that owns the work.
        current.__trellisSaveStage = stage; // NEW
        renderSaveStatus(current); // NEW: access and queue transitions need not wait for the next heartbeat.
        for (const listener of current.__trellisSaveObservers || []) { try { listener(stage); } catch (_) {} } // NEW
    } // NEW
    async function saveCurrent(options = {}) { // CHANGE
        const current = file(); // CHANGE
        if (!current) throw new Error('Open a canvas before sharing.'); // CHANGE
        const listeners = current.__trellisSaveObservers ||= new Set(), observer = options.onProgress; // NEW
        if (observer) listeners.add(observer); // NEW
        try { // NEW
            if (observer) { try { observer(current.__trellisSaveStage || 'queued'); } catch (_) {} } // NEW
            await new Promise((resolve, reject) => { if (options.automatic) current.__trellisAutomaticRequest = true; current.save(false, resolve, error => reject(new Error(error && error.message || String(error))), undefined, undefined, () => reject(new Error('Save cancelled. The invitation has not been prepared.'))); }); // CHANGE: automatic release uses the same quiet queue; explicit actions still flush it.
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
            const assetContextChanged = info?.assetBaseUrl !== nextInfo.assetBaseUrl; info = nextInfo; graph.__trellisProjectFormat = info.projectFormat || (info.protocolVersion === 5 ? 2 : 1); window.TrellisContentPolicy?.setAssetBase(info?.assetBaseUrl); // CHANGE
            if (assetContextChanged) refreshManagedImages(); // CHANGE: unchanged context must not refresh the complete graph.
            lastStatus = entry; classifiedFile = openedFile; // CHANGE
            assetAvailability = entry.state; // CHANGE
            assetSequence = entry.folderSequence ?? null; // CHANGE
            if (isCollaborative() && (collaborationBaseline == null || explicitMode && viewIdentity !== current.userId) && current.userId) { // CHANGE: each authenticated user restores their remembered objects.
                const opened = file(); collaborationBaseline = opened.data; observedXml = collaborationBaseline; // NEW
                const baseline = await coordinate({ kind: explicitMode ? 'open-view' : 'get' }); // CHANGE
                if (!baseline || file() !== opened || generation !== contextGeneration) return; collaborationBaseline = baseline.xml; adoptActivity(baseline.collaboration); // CHANGE: initialization cannot replace a newer independent ownership observation.
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
        result = await bridge.setupCanvas({ ...context(), protocolVersion: protocol.newGarden, filename: current.getTitle && current.getTitle() || 'Garden.drawio', xml: current.getData() }); // CHANGE: creating managed storage chooses format 2; opening existing registrations preserves their format.
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
        if (info && info.managed && entry && entry.revision.diagramHistoryId === info.diagramId && !graph.__trellisSharingApplying) { // CHANGE
            queuedHistory.set(entry.revision.id, entry); // CHANGE
            while (queuedHistory.size > 100) queuedHistory.delete(queuedHistory.keys().next().value); // NEW: old private intermediates remain in local history, outside the save queue.
        } // NEW
    }
    function rememberPublished(id) { // NEW
        publishedIds.add(id); // NEW
        while (publishedIds.size > 100) publishedIds.delete(publishedIds.values().next().value); // NEW
    } // NEW
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
        if (historyResult?.storage) graph.__ccSharedHistoryStorage = historyResult.storage; // CHANGE: preserve the last explicitly inspected disk totals.
        if (historyResult?.generation && historyResult.generation !== checkpoint.revision.generation && history()?.refresh) await history().refresh(); // CHANGE: unchanged generations do not reload the entire timeline on save.
        // CHANGE: an open storage panel must not turn ordinary publication into an archive scan; its explicit inspection refresh owns disk accounting.
        entries.forEach(entry => { rememberPublished(entry.revision.id); queuedHistory.delete(entry.revision.id); }); // CHANGE
    }
    function savedCheckpoint(entry) {
        if (!entry || publishedIds.has(entry.revision.id) || info && info.createdAt && entry.revision.timestamp < info.createdAt) return null;
        return entry; // CHANGE: main-process transport assigns the published parent directly, without traversing private revision history.
    }
    async function importNewHistory() {
        if (!info || !info.managed || importRunning || !history() || !history().importShared) return;
        importRunning = true;
        try {
            const capturedInfo = info, result = await bridge.importHistory({ shareId: info.shareId }); // CHANGE: indexed transport heads replace lifetime receipt arrays.
            if (info !== capturedInfo) return; // NEW
            if (result.generation && result.generation !== graph.__ccImportedHistoryGeneration) { publishedIds.clear(); queuedHistory.clear(); graph.__ccImportedHistoryGeneration = result.generation; } // CHANGE
            if (history().refreshStorage) await history().refreshStorage(); // CHANGE: background import does not reload the entire timeline.
            for (const entry of result.entries || []) { await history().importShared(entry); rememberPublished(entry.revision.id); } // CHANGE
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
        current.isAutosave = function () { return file() === current && isCollaborative() ? !!current.fileObject && coordinationAvailable() && !lastStatus?.pending && !['revoked', 'awaitingApproval'].includes(lastStatus?.state) : originalAutosave ? originalAutosave.apply(this, arguments) : false; }; // NEW
        current.isAutosaveOptional = function () { return file() === current && isCollaborative() ? false : originalOptional ? originalOptional.apply(this, arguments) : true; }; // NEW
        current.save = function () {
            const automatic = !!current.__trellisAutomaticRequest; delete current.__trellisAutomaticRequest; // NEW
            if (current.__trellisNamingMove) { const args = arguments; current.__trellisNamingMove.then(() => { current.__trellisAutomaticRequest = automatic; current.save.apply(current, args); }); return; } // CHANGE: retain request intent through native naming waits.
            if (file() === current && refreshing) { const args = arguments; refreshFinished.then(() => { current.__trellisAutomaticRequest = automatic; current.save.apply(current, args); }); return; } // CHANGE: retain request intent while managed status is unresolved.
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
    const coordinationAvailable = () => info?.editingAvailability?.available !== false && lastStatus?.editingAvailability?.available !== false; // NEW: connection loss alone does not disable the local coordinator.
    const isCollaborative = () => !!(info && protocol.supportedGardens.includes(info.protocolVersion) && bridge.collaborationAction); // NEW
    const holdEditors = window.TrellisEditingHolds?.create(ui, { isCollaborative, status, captureBaseline: captureEditingBaseline, prepareReopen: prepareEditorReopen, logicalTarget: logicalObjectKey, claim: targets => coordinate({ kind: 'claim', targets }), release: (targets, options = { automatic: true }) => releaseHolds(targets, options), lose: loseEditorHolds, refresh: bridge.activityAction ? refreshActivity : undefined, targetState: objectFingerprint, validate: targets => { if (targets.some(key => { try { return isPendingCell(graph.getModel().getCell(JSON.parse(key)[1])); } catch (_) { return false; } })) throw new Error('Refresh this object before starting another edit.'); } }); // CHANGE: normalize all registered form targets before their claim/recovery lifecycle begins.
    function describeStatus(state = lastStatus) { // NEW
        if (info?.localOnly || state?.localOnly) return 'Local only · Sharing off'; // CHANGE
        if (!state) return 'Not shared'; // NEW
        if (state.pending) return 'Awaiting approval'; // NEW
        if (info && protocol.supportedGardens.includes(info.protocolVersion) && ['upToDate', 'syncing', 'unavailable'].includes(state.state) && ((state.connectedPeers ?? state.connectedCollaborators) === 0 || state.state === 'unavailable')) return 'Working locally'; // NEW: local work must not conceal pause, revocation, or approval states.
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
            if (element.disabled) return; const panel = element.closest('[role="dialog"]'), restoreActivityFocus = element.hasAttribute('data-activity-action') && document.activeElement === element; element.disabled = true; // CHANGE: native Chromium drops focus when an activity control becomes disabled.
            try { await handler(); } catch (err) { const target = panel && panel.querySelector('[data-status]'); if (target && panel.isConnected) { target.textContent = err.message; target.setAttribute('role', 'alert'); } else status(err.message); } // CHANGE
            finally { if (element.isConnected && element.dataset.keepDisabled !== 'true') element.disabled = false; if (restoreActivityFocus && panel?.isConnected && document.activeElement === document.body) (element.isConnected && !element.hidden && !element.disabled ? element : panel.querySelector('[data-activity-close]'))?.focus(); } // CHANGE: restore activity focus after completion unless the user moved it elsewhere.
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
        dialog.classList.add('trellis-surfaces'); // NEW: shared surface hierarchy.
        dialog.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:2147483100;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;'; // CHANGE
        const panel = document.createElement('section'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', title); panel.tabIndex = -1; // NEW
        panel.style.cssText = 'width:640px;max-width:100%;max-height:calc(100vh - 32px);overflow:auto;background:#fff;color:#111827;border:1px solid #d1d5db;border-radius:8px;padding:20px;font:13px Arial;box-sizing:border-box;box-shadow:0 12px 40px #0003;'; // CHANGE
        const header = document.createElement('div'); header.style.cssText = 'display:flex;justify-content:space-between;gap:12px;align-items:center;'; // CHANGE
        const heading = document.createElement('h2'); heading.textContent = title; heading.style.cssText = 'font-size:19px;margin:0;flex:1;'; // CHANGE
        if (back) button('Back', back, header, 'neutral'); header.appendChild(heading); button('Close', closeDialog, header, 'close').dataset.activityClose = ''; panel.appendChild(header); // CHANGE: a disappearing activity action can return keyboard focus to Close.
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
    function details(panel, title) { const d = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = title; d.appendChild(summary); d.dataset.trellisSurface = 'inset'; summary.dataset.trellisSurface = 'header'; d.style.cssText = 'margin:16px 0;padding-top:12px;'; panel.appendChild(d); return d; } // CHANGE: shared inset surfaces keep native disclosure behavior.
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
        health.dataset.trellisSurface = 'inset'; health.style.background = ''; health.style.borderColor = ''; // NEW: shared surface hierarchy.
        const people = document.createElement('div'); panel.appendChild(people); // NEW
        const activityRows = document.createElement('div'); panel.appendChild(activityRows); // CHANGE: activity controls survive overview updates and share object-dialog descriptions.
        const update = () => { // NEW
            health.textContent = describeStatus() + '. ' + (info?.localOnly ? info.reason : info?.managed ? collaborationSummary() : 'This canvas is not shared. Use Share on the garden toolbar to invite someone.') + (lastStatus?.reason ? ' ' + lastStatus.reason : '') + (collaboration?.recoveries?.length ? ' Rejected or recovered edits are available below.' : '') + (collaboration?.pending ? ' Waiting for missing change records.' : ''); // CHANGE
            if (recoveryList) { recoveryList.replaceChildren(); for (const copy of collaboration?.recoveries || []) { note(recoveryList, copy.reason || 'Recovery copy'); if (copy.editorDataPath) button('Open editor data', () => showRecoveredEditorData(copy), recoveryList); // CHANGE
                 button('Open copy', () => { closeDialog(); if (ui.loadArgs) ui.loadArgs({ args: [copy.recoveryPath] }); }, recoveryList); note(recoveryList, copy.recoveryPath); } if (!collaboration?.recoveries?.length) note(recoveryList, localRecovery ? localRecovery.recoveryPath : 'No recovered edits.'); } // NEW
            people.replaceChildren(); note(people, lastStatus?.connectedCollaborators == null ? 'Collaborator connection status is unavailable.' : lastStatus.connectedCollaborators ? lastStatus.connectedCollaborators + ' connected collaborator' + (lastStatus.connectedCollaborators === 1 ? '' : 's') : 'No other collaborators are connected.'); // NEW
            for (const person of lastStatus?.collaborators || []) if (!collaboration?.holds.some(h => h.userId === person.id)) note(people, person.name || 'Unknown user'); // NEW
            renderActivityRows(activityRows, [...objectActivity().values()].flat(), true); // CHANGE: pending-only and uncertain sessions have the same explanations/actions as object badges.
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
    /** Resolve activity for any loaded page without changing its signed source key. */ // CHANGE
    function logicalObjectKey(key) { // CHANGE
        if (key === '*') return key; // CHANGE
        const [page, id] = JSON.parse(key), currentPage = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; // CHANGE
        let cell = page === currentPage ? graph.getModel?.().getCell?.(id) : null; // CHANGE
        if (!cell && page !== currentPage) { // CHANGE
            const visit = node => { if (!node || String(node.id) === id) return node; for (const child of node.children || []) { const found = visit(child); if (found) return found; } return null; }; // CHANGE
            cell = visit(ui.pages?.find(item => (item.getId?.() || item.node?.getAttribute('id') || '') === page)?.root); // CHANGE
        } // CHANGE
        if (!cell) return key; // CHANGE: unknown or deleted objects remain discoverable under their original identity.
        if (editContext) return JSON.stringify([page, String(editContext.logicalCell(cell).id)]); // CHANGE
        let logical = cell; const visited = new Set(); // CHANGE: older shells retain the same planting markers.
        for (let cursor = cell; cursor && !visited.has(cursor); cursor = graph.getModel?.().getParent?.(cursor) || cursor.parent) { // CHANGE
            visited.add(cursor); // CHANGE
            if (cursor.getAttribute?.('tiler_group') === '1' || cursor.getAttribute?.('planting_id') || /(?:^|;)tiler_group=1(?:;|$)/.test(cursor.style || '')) logical = cursor; // CHANGE
        } // CHANGE
        return JSON.stringify([page, String(logical.id)]); // CHANGE
    } // CHANGE
    function selectedObjectKeys() { // CHANGE
        const pageId = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; return [...new Set((graph.getSelectionCells?.() || []).map(cell => logicalObjectKey(JSON.stringify([pageId, String(cell.id)]))))]; // CHANGE
    } // CHANGE
    /** Only planting selection retains a completed native hold; other objects keep their existing lifecycle. */ // CHANGE
    function selectedPlanting(key) { // CHANGE
        if (!selectedObjectKeys().includes(logicalObjectKey(key)) || key === '*') return false; // CHANGE
        const [page, id] = JSON.parse(logicalObjectKey(key)), currentPage = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; // CHANGE
        const cell = page === currentPage && graph.getModel?.().getCell?.(id); // CHANGE
        return !!cell && (cell.getAttribute?.('tiler_group') === '1' || !!cell.getAttribute?.('planting_id') || /(?:^|;)tiler_group=1(?:;|$)/.test(cell.style || '')); // CHANGE
    } // NEW
    async function coordinate(input) { // NEW
        if (!isCollaborative()) return null; const current = file(), shareId = info.shareId, generation = contextGeneration, expectedUserId = context().userId; // CHANGE
        if (bridge.activityAction && ['claim', 'view', 'request', 'release'].includes(input.kind)) { // CHANGE
            const { baseXml, xml, ...activity } = input; // CHANGE
            if (input.kind === 'release' && activity.claimIds === undefined) activity.claimIds = [...(collaboration?.holds || []).filter(hold => hold.sessionId === localSessionId), ...(collaboration?.losses || [])].filter(hold => !input.targets || input.targets.includes(hold.key)).map(hold => hold.claimId); // CHANGE: recovery and ordinary release name only their observed generation.
            const releasing = input.kind === 'release' ? (collaboration?.holds || []).filter(hold => hold.sessionId === localSessionId && (!input.targets || input.targets.includes(hold.key)) && !releasingClaims.has(hold.claimId)).map(hold => hold.claimId) : []; // CHANGE
            releasing.forEach(id => releasingClaims.add(id)); // CHANGE
            try { // CHANGE
                const result = input.kind === 'claim' && input.xml && !input.targets ? await bridge.collaborationAction({ shareId, ...input, ...(graph.__trellisProjectFormat === 2 ? { references: referenceDependencies() } : {}) }) : await bridge.activityAction({ shareId, expectedUserId, ...activity }); // CHANGE: native authority verifies new definition dependencies before granting a content-derived claim.
                if (file() !== current || generation !== contextGeneration || expectedUserId !== context().userId) return null; const adopted = adoptActivity(result.collaboration); // CHANGE
                if (input.kind === 'claim' && result.ok === false && adopted === false && input.targets?.length && input.targets.every(key => collaboration.holds.some(hold => hold.sessionId === localSessionId && (hold.key === key || hold.key === '*') && (!Number.isFinite(hold.expiresAt) || hold.expiresAt > Date.now())))) return { ...result, ok: true, collaboration }; // CHANGE: a stale refusal cannot reject a hold already confirmed by a newer observation.
                return result; // CHANGE: releasing one object must not hide a confirmed loss on a different object.
            } finally { releasing.forEach(id => releasingClaims.delete(id)); } // CHANGE
        } // CHANGE
        await synchronizeContext(); // CHANGE
        if (file() !== current || info?.shareId !== shareId || generation !== contextGeneration) throw new Error('The project changed before the collaboration action.'); // NEW
        const references = graph.__trellisProjectFormat === 2 && ['save', 'claim', 'portable-export'].includes(input.kind) ? referenceDependencies() : undefined; // CHANGE: immutable definitions cross IPC only when introduced by a local edit.
        let contentInput = input; // CHANGE
        if (graph.__trellisProjectFormat === 2 && input.kind === 'save') { if (!window.TrellisObjectTransactions) await new Promise(resolve => mxscript('js/trellis-object-transactions.js', resolve)); const transport = graph.__trellisObjectTransactions || (graph.__trellisObjectTransactions = window.TrellisObjectTransactions.create()), transaction = transport.transaction(input.baseXml, input.xml); if (transaction) { const { baseXml, xml, ...rest } = input; contentInput = { ...rest, transaction }; } } // CHANGE: routine save IPC carries changed objects, not the full document twice.
        const result = await bridge.collaborationAction({ shareId, explicitRefresh: explicitMode, ...contentInput, ...(references ? { references } : {}) }); // CHANGE
        if (file() !== current || info?.shareId !== shareId || generation !== contextGeneration || expectedUserId !== context().userId) return null; // CHANGE: replies cannot install another actor's policy.
        for (const [hash, store] of Object.entries(result.collaboration?.references?.snapshots || {})) { if (!window.TrellisReferenceCore) await new Promise(resolve => mxscript('js/trellis-reference-core.js', resolve)); await window.TrellisReferenceCore.registerSnapshotAsync(store, hash); } // CHANGE: immutable cache publication cannot alter document authority.
        if (file() !== current || info?.shareId !== shareId || generation !== contextGeneration || expectedUserId !== context().userId) return null; // NEW: asynchronous verification cannot install another document's policy or dependency availability.
        for (const hash of Object.keys(result.collaboration?.references?.snapshots || {})) stagedReferenceDigests.add(hash); if (result.ok && references) for (const hash of Object.keys(references)) stagedReferenceDigests.add(hash); graph.__trellisReferenceUnavailable = result.collaboration?.references?.unavailable || {}; // CHANGE: install definitions before policy or decoded objects can be queried.
        adoptActivity(result.collaboration, ['release', 'recover-holds'].includes(input.kind) || input.kind === 'save' && result.code === 'HOLD_LOST'); // CHANGE: activity adoption alone determines loss; durable claims are separate.
        adoptPolicy(result.collaboration); // CHANGE: a newer heartbeat must not discard the accepted save's permission policy.
        if (explicitMode && result.ok === false && input.kind === 'claim') await recoverLostHolds(input.targets || formTargets, result.reason); // CHANGE
        announce(); return result; // CHANGE
    } // NEW
    /** Stage only immutable definitions referenced by this document; the native owner verifies every digest. */ // NEW
    const stagedReferenceDigests = new Set(); ui.editor.addListener?.('fileLoaded', () => { stagedReferenceDigests.clear(); graph.__trellisObjectTransactions?.reset(); }); // CHANGE
    function referenceDependencies() { // NEW
        const C = window.TrellisReferenceCore, result = {}; if (!C) return result; // NEW
        const visit = cell => { if (!cell) return; const raw = cell.getAttribute?.(C.ATTR); if (raw) { const pointer = JSON.parse(raw); if (C.externalReference(pointer) && !stagedReferenceDigests.has(pointer.digest)) { const store = C.cachedSnapshot(pointer.digest); if (store) result[pointer.digest] = store; } } for (const child of cell.children || []) visit(child); }; // CHANGE: ordinary save payloads never retransmit definitions already staged in this project.
        if (ui.pages?.length) for (const page of ui.pages) visit(page.root); else visit(graph.getModel?.().getRoot?.()); return result; // NEW
    } // NEW
    /** Capture the saved view used by the editor, never a later frozen or locally modified graph. */ // CHANGE
    function captureEditingBaseline(entry, targets) { // CHANGE
        if (!targets || targets.includes('*')) return null; // CHANGE
        const dependencies = entry.resumeDependencies?.() || []; // CHANGE
        return { baseXml: collaborationBaseline || file()?.data, targets: [...targets], dependencies: [...new Set(dependencies)], scope: entry.kind === 'year-planner' ? 'year-planner' : 'object' }; // CHANGE
    } // CHANGE
    /** Validate the current page-scoped target before retiring its retained editor. */ // CHANGE
    function prepareEditorReopen(entry) { // CHANGE
        const draft = entry.frozenCapture, targets = typeof entry.targets === 'function' ? entry.targets() : entry.targets; // CHANGE
        const key = draft?.pageId !== undefined && (draft.labelCellId || draft.objectId) ? JSON.stringify([draft.pageId, String(draft.labelCellId || draft.objectId)]) : targets[0]; // CHANGE
        const cell = resolveEditorCell(key, true); // CHANGE
        if (!cell) throw new Error('This object was deleted. Your entries remain available for copying.'); // CHANGE
        if (users()?.canEditCell && !users().canEditCell(cell)) throw new Error('You no longer have editing access to this object.'); // CHANGE
        return cell; // CHANGE
    } // CHANGE
    const resolutionKey = targets => JSON.stringify([contextGeneration, [...targets].sort()]); // CHANGE
    function resolutionCurrent(resolution) { return !!resolution && !resolution.finished && file() === resolution.file && contextGeneration === resolution.generation && context().userId === resolution.userId && info?.shareId === resolution.shareId; } // CHANGE
    /** Use registered adapters where possible; legacy surfaces still expose copy, review and discard. */ // CHANGE
    function resolutionEditors(resolution) { // CHANGE
        const editors = holdEditors?.recoveryEditors(resolution.targets) || [], elements = new Set(editors.map(editor => editor.element)); // CHANGE
        for (const [element, item] of frozenForms) if (element.dataset.trellisFrozen && !elements.has(element) && item.draft.targets.some(key => resolution.targets.includes(key) || resolution.targets.includes('*'))) editors.push({ // CHANGE
            title: 'Retained editor', element, targets: item.draft.targets, draft: item.draft, baseline: item.baseline, claimIds: item.claimIds, resume: item.resume, canResume: !!item.resume && !!item.baseline, canReopen: !!item.reopen, // CHANGE
            connected: () => element.isConnected, setActions: (actions, detail) => item.view?.setActions(actions, detail), focus: () => item.view?.focus(), reopen: item.reopen, retire() { item.view?.dispose(); element.remove(); frozenForms.delete(element); }, // CHANGE
        }); // CHANGE
        return editors; // CHANGE
    } // CHANGE
    async function copyEditorEntries(editor) { // CHANGE
        const text = JSON.stringify(editor.draft, null, 2); // CHANGE
        try { await window.navigator.clipboard.writeText(text); } catch (_) { const panel = showDialog('Copy retained entries'); copyBlock(panel, 'Retained entries', text).select(); } // CHANGE
    } // CHANGE
    function focusResolution(resolution) { // CHANGE
        if (!resolutionCurrent(resolution)) return; const editor = resolutionEditors(resolution).find(item => item.connected()); // CHANGE
        if (editor) editor.focus(); else showPrivateDrafts().catch(error => status(error.message)); // CHANGE
    } // CHANGE
    function renderResolution(resolution) { // CHANGE
        if (!resolutionCurrent(resolution)) return; // CHANGE
        const scope = resolution.scope || resolution.targets, labels = scope.map(objectLabel).join(', '); // CHANGE
        for (const editor of resolutionEditors(resolution)) { // CHANGE
            const actions = [ // CHANGE
                { id: 'resume', label: 'Resume editing', enabled: resolution.complete && resolution.code === 'SESSION_OFFLINE' && editor.canResume, run: () => resumeEditor(resolution, editor) }, // CHANGE
                { id: 'review', label: 'Review & continue', enabled: resolution.complete, run: () => reviewEditor(resolution, editor) }, // CHANGE
                { id: 'copy', label: 'Copy entries', run: () => copyEditorEntries(editor) }, // CHANGE
            ]; // CHANGE
            if (resolution.error) { // CHANGE
                actions.push({ id: 'retry', label: 'Retry saving draft', run: () => recoverLostHolds(resolution.targets, resolution.reason) }); // CHANGE
                actions.push({ id: 'discard', label: 'Discard unfinished changes', destructive: true, enabled: !!resolution.scope, run: () => discardResolution(resolution) }); // CHANGE
            } // CHANGE
            if (resolution.blocked?.length) { // CHANGE
                actions.push({ id: 'blocker', label: 'View blocking edit', run: () => { showObjectPopover(resolution.blocked[0].key, editor.element || graph.container); if (popover) popover.style.zIndex = '2147483150'; } }); // CHANGE
                actions.push({ id: 'request', label: 'Request release', run: async () => { if (!resolutionCurrent(resolution)) return; const result = await coordinate({ kind: 'request', targets: resolution.blocked.map(hold => hold.key) }); if (!result?.ok) throw new Error(result?.reason || 'Release could not be requested.'); } }); // CHANGE
            } // CHANGE
            if (resolution.code === 'ACCESS_CHANGED') actions.push({ id: 'access', label: context().userId ? 'Request Access' : 'Log in', run: () => showBlockedEdit({ code: 'PERMISSION_DENIED', targets: editor.targets, message: resolution.reason }, editor.element) }); // CHANGE
            editor.setActions(actions, resolution.error ? 'Discard affects these objects and related changes: ' + labels + '.' : !editor.canResume ? 'Review current changes to open a fresh editor.' : 'Resume keeps your entries if this object and its required inputs are unchanged.'); // CHANGE
        } // CHANGE
    } // CHANGE
    /** A clicked action checks both main-process authority and the original renderer context. */ // CHANGE
    async function resumeEditor(resolution, editor) { // CHANGE
        if (!resolutionCurrent(resolution) || !editor.connected() || resolution.busy) return; // CHANGE
        if (!resolution.complete || resolution.code !== 'SESSION_OFFLINE' || !editor.canResume) throw new Error('Review this object before continuing.'); // CHANGE
        resolution.busy = true; const revision = modelRevision; let result; // CHANGE
        try { // CHANGE
            result = await coordinate({ kind: 'resume-holds', ...editor.baseline, claimIds: editor.claimIds }); // CHANGE
            if (!resolutionCurrent(resolution) || !editor.connected() || revision !== modelRevision) throw new Error('The editor or diagram changed while resuming. Review the current object.'); // CHANGE
            if (!result?.ok) { resolution.blocked = result?.blocked; renderResolution(resolution); if (result?.code === 'PERMISSION_DENIED') showBlockedEdit({ code: result.code, targets: editor.targets, message: result.reason }); throw new Error(result?.reason || 'Editing access could not be confirmed.'); } // CHANGE
            editor.targets.forEach(key => resumingTargets.add(key)); // CHANGE
            await editor.resume(result); for (const [element, item] of frozenForms) if (element === editor.element) { item.view?.dispose(); frozenForms.delete(element); } // CHANGE
            resolution.finished = !resolutionEditors(resolution).some(item => item.connected()); // CHANGE
            status('Editing resumed.'); // CHANGE
        } catch (error) { // CHANGE
            if (result?.ok) { const claimIds = result.collaboration?.holds.filter(hold => hold.sessionId === localSessionId && editor.targets.includes(hold.key)).map(hold => hold.claimId) || []; if (claimIds.length && resolutionCurrent(resolution)) await coordinate({ kind: 'release', targets: editor.targets, claimIds }); } // CHANGE
            throw error; // CHANGE
        } finally { editor.targets.forEach(key => resumingTargets.delete(key)); resolution.busy = false; } // CHANGE
    } // CHANGE
    async function reviewEditor(resolution, editor) { // CHANGE
        if (!resolutionCurrent(resolution) || !editor.connected()) return; // CHANGE
        await readRemote('get'); if (!resolutionCurrent(resolution) || !editor.connected()) return; // CHANGE
        const targets = [...editor.targets, ...(editor.baseline?.dependencies || [])]; // CHANGE
        await incoming.reviewTargets(targets, { label: editor.canReopen ? 'Open fresh editor' : 'Show current object', isCurrent: () => resolutionCurrent(resolution) && editor.connected(), run: async () => { // CHANGE
            if (!editor.canReopen) { const cell = resolveEditorCell(editor.targets[0]); if (!cell) throw new Error('This object was deleted. Your entries remain available for copying.'); editor.retire(); graph.setSelectionCell?.(cell); graph.scrollCellToVisible?.(cell); status('Open the selected object’s editor to continue. Retained entries are available in Recovery drafts.'); return; } // CHANGE
            await editor.reopen(); resolution.finished = !resolutionEditors(resolution).some(item => item.connected()); // CHANGE
        } }, editor.element || graph.container); // CHANGE
    } // CHANGE
    /** Page identity is part of an object identity, including when IDs repeat on different pages. */ // CHANGE
    function resolveEditorCell(key, selectPage = false) { // CHANGE
        if (!key || key === '*') return null; const [page, id] = JSON.parse(key), currentPage = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; // CHANGE
        if (page !== currentPage) { const target = ui.pages?.find(item => item.getId?.() === page); if (!target) return null; if (selectPage) ui.selectPage(target); else return null; } // CHANGE
        return graph.getModel?.().getCell(id) || null; // CHANGE
    } // CHANGE
    /** Preview and execution share the existing dependency/action closure; preview never changes the graph. */ // CHANGE
    async function previewDiscard(resolution) { // CHANGE
        if (!resolutionCurrent(resolution)) return null; await saveFence; if (!resolutionCurrent(resolution)) return null; // CHANGE
        const captured = ui.getFileData(), baseline = collaborationBaseline || file().data; // CHANGE
        const result = await coordinate({ kind: 'discard-holds', targets: resolution.targets, baseXml: baseline, xml: captured, actions: unsavedActions.map(action => action.keys) }); // CHANGE
        if (!resolutionCurrent(resolution) || !result?.ok || captured !== ui.getFileData()) return null; // CHANGE
        return { result, captured, baseline, scope: [...new Set([...resolution.targets, ...(result.targets || []), ...(result.discardedKeys || [])])] }; // CHANGE
    } // CHANGE
    async function prepareDiscard(resolution) { // CHANGE
        try { const preview = await previewDiscard(resolution); if (preview) { resolution.scope = preview.scope; resolution.scopeXml = preview.captured; renderResolution(resolution); } } catch (_) { /* Retry and copying remain available if even the accepted state cannot be read. */ } // CHANGE
    } // CHANGE
    /** Resolving one loss must not clear a different object's outstanding recovery failure. */ // CHANGE
    function updateRecoveryFailure() { // CHANGE
        const pending = [...editingResolutions.values()].find(item => resolutionCurrent(item) && item.error && !item.complete); // CHANGE
        recoveryFailure = pending ? new Error(pending.error) : null; retryRecovery = pending ? { targets: pending.targets, reason: pending.reason } : null; // CHANGE
    } // CHANGE
    async function discardResolution(resolution) { // CHANGE
        if (!resolutionCurrent(resolution) || resolution.busy) return; resolution.busy = true; // CHANGE
        try { // CHANGE
            await recoveryQueue.catch(() => {}); const preview = await previewDiscard(resolution); // CHANGE
            if (!preview) throw new Error('The diagram changed. Review the affected changes and retry.'); // CHANGE
            if (preview.captured !== resolution.scopeXml || JSON.stringify(preview.scope) !== JSON.stringify(resolution.scope)) { resolution.scope = preview.scope; resolution.scopeXml = preview.captured; renderResolution(resolution); throw new Error('Affected changes updated. Review the listed objects before discarding.'); } // CHANGE
            const retained = retainedLosses.get(resolution.key); if (retained) retained.discarded = true; // CHANGE
            try { reconcileRejected(preview.result, preview.captured, resolution.file, preview.baseline); } catch (error) { if (retained) retained.discarded = false; throw error; } // CHANGE
            resolution.finished = true; retainedLosses.delete(resolution.key); editingResolutions.delete(resolution.key); // CHANGE
            holdEditors?.discard(preview.scope); // CHANGE
            for (const [element, item] of frozenForms) if (item.draft.targets.some(key => preview.scope.includes(key) || preview.scope.includes('*'))) { item.view?.dispose(); element.remove(); frozenForms.delete(element); } // CHANGE
            updateRecoveryFailure(); status('Unfinished changes discarded.'); // CHANGE
            void background?.checkpoint(true).catch(error => status('Changes discarded; updating the recovery checkpoint failed: ' + error.message)); // CHANGE
        } finally { resolution.busy = false; } // CHANGE
    } // CHANGE
    /** Apply one verified rollback while preserving unrelated typing and accepted saves. */ // CHANGE
    function reconcileRejected(result, captured, current, baseline) { // CHANGE
        const discarded = new Set(result.discardedKeys || []), removed = unsavedActions.filter(action => action.keys.some(key => discarded.has(key) || discarded.has('*'))); // CHANGE
        const undo = ui.editor.undoManager, priorUndo = new Set(undo?.history || []); // CHANGE
        if (result.xml !== captured) { // CHANGE
            const saved = current.data, live = ui.getFileData(); // CHANGE
            try { applyRemote(result.xml, current, current.stat, captured); } // CHANGE
            catch (error) { const applying = graph.__trellisSharingApplying; graph.__trellisSharingApplying = true; try { ui.setFileData(live); } finally { graph.__trellisSharingApplying = applying; collaborationBaseline = baseline; current.data = saved; current.setModified(true); } throw error; } // CHANGE
            collaborationBaseline = baseline; current.data = saved; observedXml = ui.getFileData(); current.setModified(observedXml !== baseline); // CHANGE
        } // CHANGE
        if (undo?.history) { const keep = edit => priorUndo.has(edit) && !removed.some(action => action.edit === edit); const before = undo.history.slice(0, undo.indexOfNextAdd).filter(keep).length; undo.history = undo.history.filter(keep); undo.indexOfNextAdd = before; } // CHANGE
        for (const action of removed) { action.edit.__trellisUsersRejected = true; unsavedActions.splice(unsavedActions.indexOf(action), 1); } // CHANGE
    } // CHANGE
    /** Serialize recovery with itself; never wait for a save that may already be awaiting this reply. */ // NEW
    function recoverLostHolds(targets, reason, insideSave = false) { // CHANGE
        if (!targets?.length) return Promise.resolve(); const staged = stageLostDraft(targets, reason); // CHANGE: freeze, capture and start private persistence before waiting for any content save.
        const current = file(), generation = contextGeneration, pendingSave = insideSave ? Promise.resolve() : saveFence; targets.forEach(key => recoveringTargets.set(key, (recoveringTargets.get(key) || 0) + 1)); // CHANGE
        const expectedUserId = context().userId, lossKey = staged.lossKey; // CHANGE
        const operation = async () => { // NEW
            await staged.preservation; // CHANGE: private preservation is independent of content durability and its queue.
            await pendingSave; // NEW: accepted actions leave the rollback set before an asynchronous status loss is processed.
            if (file() !== current || generation !== contextGeneration || context().userId !== expectedUserId) return; // CHANGE
            const editors = holdEditors?.capture(targets) || [], captured = ui.getFileData(), baseline = collaborationBaseline || current.data; // NEW
            const extraEditors = [...frozenForms.values()].map(item => item.draft).filter(draft => draft.targets.some(key => targets.includes(key) || targets.includes('*') || key === '*')); // CHANGE
            if (current.isModified() || unsavedActions.length || editors.length || extraEditors.length) { // CHANGE
                const result = await coordinate({ kind: 'recover-holds', baseXml: baseline, xml: captured, targets, actions: unsavedActions.map(action => action.keys), editorDrafts: editors, reason }); // NEW
                if (!result || file() !== current || generation !== contextGeneration) return; // NEW
                if (!result.ok || typeof result.xml !== 'string') throw new Error(result.reason || 'The recovery copy or draft rollback could not be completed.'); // NEW
                reconcileRejected(result, captured, current, baseline); // CHANGE
                localRecovery = result; status(reason + ' Affected unsaved actions were reverted.', () => focusResolution(editingResolutions.get(lossKey))); // CHANGE
            } // NEW
            const resolution = editingResolutions.get(lossKey); if (resolution) { resolution.complete = true; resolution.error = null; renderResolution(resolution); } // CHANGE
            updateRecoveryFailure(); retainedLosses.delete(lossKey); // CHANGE: frozen editor generations stay mounted and cannot reacquire authority.
        }; // NEW
        const recovery = (insideSave ? operation() : recoveryQueue.catch(() => {}).then(operation)).catch(error => { if (generation === contextGeneration) { recoveryFailure = error; retryRecovery = { targets, reason }; const retry = () => recoverLostHolds(targets, reason).catch(() => {}); preservationStatus(targets, !!retainedLosses.get(lossKey)?.saved, error.message, retry); const resolution = editingResolutions.get(lossKey); if (resolution) { resolution.error = error.message; resolution.complete = false; renderResolution(resolution); void prepareDiscard(resolution); } status('Recovery failed. Your entries remain available.', () => focusResolution(resolution)); } throw error; }).finally(() => { if (generation === contextGeneration) targets.forEach(key => { const count = recoveringTargets.get(key) || 0; if (count <= 1) recoveringTargets.delete(key); else recoveringTargets.set(key, count - 1); }); }); // CHANGE
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
    async function releaseHolds(targets, options = {}) { // CHANGE
        const current = file(), shareId = info?.shareId, generation = contextGeneration, actor = context().userId; // CHANGE
        const originalClaims = options.claims || new Map((collaboration?.holds || []).filter(hold => hold.sessionId === localSessionId).map(hold => [hold.key, hold.claimId])); // CHANGE: completion carries the originating claim, never a newer replacement. // CHANGE
        if (!options.automatic && graph.isEditing?.()) { // CHANGE: a delayed automatic release must never commit a reopened label editor.
            stoppingForSave = true; // NEW
            try { graph.stopEditing(false); } finally { stoppingForSave = false; } // NEW
        } // NEW
        if (!options.persisted && (!options.automatic || current.isModified())) await saveCurrent(options); if (file() !== current || info?.shareId !== shareId || generation !== contextGeneration || actor !== context().userId) return; // CHANGE: closing a private text-only draft must not create a graph save.
        if (options.automatic) { // CHANGE: selection and pinned editors may change while waiting for the quiet period.
            const retained = holdEditors?.pinnedTargets() || []; // CHANGE: selection and ancestors are viewing, not unfinished editing.
            targets = (targets || []).filter(key => !retained.includes(key) && !selectedPlanting(key) && (!options.shouldRelease || options.shouldRelease(key))); // CHANGE: recheck after persistence so returning to the planting cancels a queued release.
            targets = targets.filter(key => (collaboration?.holds || []).some(hold => hold.key === key && hold.sessionId === localSessionId && hold.claimId === originalClaims.get(key))); if (!targets.length) return; // CHANGE: an old automatic handoff cannot release a newer hold generation.
        } // CHANGE
        targets = (targets || [...originalClaims.keys()]).filter(key => (collaboration?.holds || []).some(hold => hold.key === key && hold.sessionId === localSessionId && hold.claimId === originalClaims.get(key))); if (!targets.length) return; // CHANGE: explicit saves may also finish after another editor acquired a newer generation.
        const claims = targets.map(key => originalClaims.get(key)); // CHANGE
        claims.forEach(id => releasingClaims.add(id));
        try { return await coordinate({ kind: 'release', targets, claimIds: claims }); } finally { claims.forEach(id => releasingClaims.delete(id)); } // CHANGE
    } // NEW
    /** Share only a capture covering the same file generation, refresh barrier, and requested revision. */ // NEW
    /** Retire only captured, still-unmodified objects whose editor has not resumed. */ // CHANGE
    async function releaseSavedHolds(candidates, current, generation, actor) { // CHANGE
        if (file() !== current || generation !== contextGeneration || actor !== context().userId) return; // CHANGE
        const pinned = holdEditors?.pinnedTargets() || [], pending = new Set(pendingObjects()); // CHANGE
        const targets = [...candidates].filter(([key, claim]) => !pinned.includes(key) && !pending.has(key) && collaboration?.holds?.some(hold => hold.key === key && hold.claimId === claim && hold.sessionId === localSessionId)).map(([key]) => key); // CHANGE
        if (targets.length) await releaseHolds(targets, { automatic: true, claims: candidates, persisted: true }); // CHANGE
    } // CHANGE
    /** Failed native creation may have claimed new IDs before a later guard rejected the edit. */ // CHANGE
    async function releaseRemovedCreations(ids) { // CHANGE
        const current = file(), generation = contextGeneration, actor = context().userId, page = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; // CHANGE
        await acquisitionPromise; // CHANGE
        if (current !== file() || generation !== contextGeneration || actor !== context().userId) return; // CHANGE
        const model = graph.getModel(), pinned = new Set(holdEditors?.pinnedTargets() || []); // CHANGE
        const keys = new Set(ids.filter(id => !model.getCell(id)).map(id => JSON.stringify([page, String(id)]))); // CHANGE
        const candidates = new Map((collaboration?.holds || []).filter(hold => hold.sessionId === localSessionId && keys.has(hold.key) && !pinned.has(hold.key)).map(hold => [hold.key, hold.claimId])); // CHANGE
        if (candidates.size) await releaseHolds([...candidates.keys()], { automatic: true, persisted: true, claims: candidates }); // CHANGE
    } // CHANGE
    /** Keep one immutable save identity across transport/native-completion retries of the same capture. */ // NEW
    function proposalIdFor(current, baseXml, xml, claimIds, usersPolicyAction = false) { // NEW
        const userId = context().userId, claims = JSON.stringify(claimIds.slice().sort()), pending = current.__trellisPendingProposal; // NEW
        if (pending && pending.userId === userId && pending.baseXml === baseXml && pending.xml === xml && pending.claims === claims && pending.usersPolicyAction === usersPolicyAction) return pending.id; // NEW
        const id = Array.from(window.crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join(''); // NEW
        current.__trellisPendingProposal = { id, userId, baseXml, xml, claims, usersPolicyAction }; return id; // NEW
    } // NEW
    async function saveCollaborative(current, success, error, automatic = false) { // CHANGE
        if (!coordinationAvailable()) { if (error) error(new Error(lastStatus?.editingAvailability?.reason || info?.editingAvailability?.reason || 'No usable coordinator is available.')); return; } // NEW: manual saves respect the same availability boundary as autosave.
        const priorRefresh = refreshSaveBarrier, generation = contextGeneration, saveUser = context().userId; // CHANGE: queued saves remain bound to their originating user.
        let batch = current.__trellisSaveBatch; // NEW
        if (!batch || batch.generation !== generation || batch.capturedRevision !== null && (!tracksModelChanges || batch.barrier !== priorRefresh || modelRevision > batch.capturedRevision)) { // CHANGE: every uncaptured request shares the single latest pending capture.
            batch = { id: ++saveOperationSequence, generation, barrier: priorRefresh, capturedRevision: null, promise: null, automatic, stage: 'queued', blockedBy: batch }; // CHANGE: one predecessor identity explains queue waits without treating a timer as progress.
            current.__trellisSaveBatch = batch; saveProgress(current, 'queued', batch); // NEW
            const started = window.performance.now(); // NEW
            const operation = async () => { // CHANGE
                timings({ operationId: batch.id, phase: 'save queue', automatic: batch.automatic, durationMs: window.performance.now() - started }); // CHANGE: diagnostics distinguish native autosave execution from an explicit save.
                if (batch.automatic && background) { saveProgress(current, 'waiting for an editing pause', batch); await background.waitForQuiet(() => batch.automatic); } // NEW: edits made after a follow-up was queued still reset its quiet period.
                saveProgress(current, 'waiting for editing access', batch); // NEW
                const claimStarted = window.performance.now(); // NEW
                let barrier; do { // NEW: a superseding explicit refresh updates the pending request without adding a queued snapshot.
                    barrier = batch.barrier; await barrier; // CHANGE
                    if (batch.generation !== contextGeneration || saveUser !== context().userId) throw new Error('The user or document changed before saving. The previous draft was not submitted under the new user.'); // NEW
                    await current.__trellisNamingSync; // NEW: capture a draft only after a shared-name update has patched its saved baseline.
                    await acquisitionPromise; await recoveryQueue.catch(() => {}); if (retryRecovery) await recoverLostHolds(retryRecovery.targets, retryRecovery.reason); if (recoveryFailure) throw recoveryFailure; // CHANGE
                    if (batch.automatic && background) { saveProgress(current, 'waiting for an editing pause', batch); await background.waitForQuiet(() => batch.automatic); } // NEW: edits during access or refresh waits also restart the five-second quiet period.
                    if (file() !== current || !isCollaborative() || batch.generation !== contextGeneration || saveUser !== context().userId) throw new Error('The project or user changed before saving.'); // CHANGE
                } while (barrier !== batch.barrier); // NEW
                saveFence = new Promise(resolve => { batch.finishFence = resolve; }); // NEW
                timings({ operationId: batch.id, phase: 'save claims', durationMs: window.performance.now() - claimStarted }); // NEW
                if (explicitMode && !viewIdentity) throw new Error('Open or explicitly recover your remembered objects before saving.'); // NEW
                const captureStarted = window.performance.now(); // NEW
                await graph.__trellisEditContext?.whenSettled(); // CHANGE: final rendering and complete rollback precede every managed save capture.
                if (file() !== current || batch.generation !== contextGeneration || saveUser !== context().userId) throw new Error('The project or user changed before capture.'); // CHANGE
                graph.__trellisEditContext?.assertCapturable(); // CHANGE
                let captured = ui.getFileData(), capturedRevision = modelRevision; const generation = contextGeneration, baseline = collaborationBaseline || current.data; // CHANGE
                const releaseCandidates = new Map((collaboration?.holds || []).filter(hold => hold.sessionId === localSessionId && !(holdEditors?.pinnedTargets() || []).includes(hold.key)).map(hold => [hold.key, hold.claimId])); // CHANGE
                const capturedObjects = new Map([...dirtyObjects].map(key => [key, objectFingerprint(key)])); background?.state('saving'); // NEW
                let capturedCreations = captureGardenCreations(capturedRevision); // NEW
                batch.capturedRevision = capturedRevision; // NEW: subscribers may only share a capture that covers their requested revision.
                timings({ operationId: batch.id, phase: 'save capture', durationMs: window.performance.now() - captureStarted, characters: captured.length }); // NEW
                saveProgress(current, 'saving garden', batch); // NEW
                setSaveStatus(current, 'Saving…', true); // CHANGE: report persistence only when an accepted capture is actually submitted.
                const claimIds = [...new Set((collaboration?.holds || []).filter(h => h.sessionId === localSessionId).map(h => h.claimId))]; // NEW: saves retain their editing generation; delayed drafts cannot reacquire a released hold.
                let result; current.__trellisCollaborativeSaving = true; // NEW
                try { result = await coordinate({ kind: 'save', proposalId: proposalIdFor(current, baseline, captured, claimIds, !!policyActionPending), baseXml: baseline, xml: captured, claimIds, usersPolicyAction: !!policyActionPending }); } finally { current.__trellisCollaborativeSaving = false; } // CHANGE: preserve one signed save intent while validating the exact invitation transition.
                const recovered = new Set(); // NEW: every retry must remove at least one rejected target from this capture.
                while (result?.code === 'HOLD_LOST' && result.targets?.some(key => !recovered.has(key))) { // NEW
                    result.targets.forEach(key => recovered.add(key)); await recoverLostHolds(result.targets, result.reason, true); // CHANGE
                    if (file() !== current || generation !== contextGeneration) throw new Error('The diagram changed during recovery.'); // NEW
                    captured = ui.getFileData(); capturedRevision = modelRevision; batch.capturedRevision = capturedRevision; // NEW
                    capturedCreations = captureGardenCreations(capturedRevision); // NEW: recovery may remove a rejected creation from the submitted snapshot.
                    const freshClaims = [...new Set((collaboration?.holds || []).filter(h => h.sessionId === localSessionId).map(h => h.claimId))]; // NEW
                    result = await coordinate({ kind: 'save', proposalId: proposalIdFor(current, baseline, captured, freshClaims), baseXml: baseline, xml: captured, claimIds: freshClaims }); // CHANGE: changed recovery content gets a distinct immutable proposal.
                } // NEW
                if (!result || file() !== current || generation !== contextGeneration) throw new Error('The diagram changed before the save completed.'); // CHANGE
                const unchanged = () => tracksModelChanges ? modelRevision === capturedRevision : ui.getFileData() === captured; // CHANGE: native revision checks avoid full-document equality captures.
                if (!result.ok) { // CHANGE
                    if (result.code === 'CONFLICT') { current.__trellisConflict = result.review; background?.state('conflict'); await background?.checkpoint(true); status('Conflicting changes are preserved. Use Sharing → Review local changes.'); } // NEW
                    else { background?.state('failed'); if (result.blocked || result.code === 'PERMISSION_DENIED') showBlockedEdit({ ...result, message: result.reason, targets: result.targets || result.blocked?.map(hold => hold.key) || [...dirtyObjects] }); else status(result.reason || 'Saving failed.'); } // NEW
                    if (!explicitMode && unchanged() && result.xml) applyRemote(result.xml, current); // CHANGE
                    throw new Error((result.reason || 'Saving failed.') + (result.recoveryPath ? ' Submitted work preserved: ' + result.recoveryPath : '')); // CHANGE
                } // CHANGE
                const nativeStarted = window.performance.now(); // NEW
                const stat = await request('fileStat', { file: current.fileObject.path }); // CHANGE
                if (file() !== current || generation !== contextGeneration) throw new Error('The diagram changed before the save completed.'); // CHANGE
                if (result.resolution) { // NEW
                    current.stat = stat; // NEW
                    if (unchanged()) applyDraftResolution(result.resolution, current); // CHANGE
                    else { // CHANGE: acceptance advances independently of subsequent typing; never replace that newer draft.
                        if (current.patch && ui.diffPages && ui.getPagesForXml && ui.pages?.length) applyRemote(result.resolution.remainingXml, current, stat, captured); // CHANGE: apply only returned differences against the submitted capture.
                        collaborationBaseline = result.resolution.baseXml; current.data = collaborationBaseline; observedXml = ui.getFileData(); // CHANGE
                        for (const [key, fingerprint] of capturedObjects) if (!result.resolution.remaining?.includes(key)) { if (fingerprint == null) savedObjects.delete(key); else savedObjects.set(key, fingerprint); } // CHANGE
                        current.setModified(true); current.__trellisConflict = result.resolution.remaining?.length ? result.resolution.review : null; background?.state(current.__trellisConflict ? 'conflict' : 'pending'); // CHANGE
                    } // CHANGE
                    return new Promise((resolve, reject) => current.fileSaved(result.resolution.baseXml, null, resolve, reject)); // NEW
                } // NEW
                current.stat = stat; current.data = explicitMode ? captured : result.xml; // CHANGE
                for (const [key, fingerprint] of capturedObjects) { if (fingerprint === null) savedObjects.delete(key); else savedObjects.set(key, fingerprint); dirtyObjects.add(key); } current.__trellisConflict = null; // CHANGE: deleted objects have an absent baseline; completed deletions do not accumulate in renderer bookkeeping.
                const policyCovered = !Number.isSafeInteger(result.collaboration?.policyRevision) || graph.__trellisSharedPolicy?.policyRevision >= result.collaboration.policyRevision; // CHANGE
                for (let index = unsavedActions.length - 1; index >= 0; index--) if (policyCovered && unsavedActions[index].revision <= capturedRevision) unsavedActions.splice(index, 1); // CHANGE: retain creation proof until policy adoption covers this accepted save.
                if (explicitMode) { collaborationBaseline = captured; current.setModified(!unchanged()); if (unchanged()) observedXml = captured; pendingHash = null; } // NEW: newer typing and unseen objects remain exactly as displayed.
                else if (unchanged()) { collaborationBaseline = result.xml; if (captured !== result.xml) applyRemote(result.xml, current, current.stat); else { current.setModified(false); observedXml = captured; } } // CHANGE
                else if (current.patch && ui.diffPages && ui.getPagesForXml && ui.pages?.length) applyRemote(result.xml, current, current.stat, captured); // NEW: apply only differences returned by the captured save, leaving subsequent local changes intact.
                else { collaborationBaseline = captured; current.setModified(true); } // NEW: compatibility fallback keeps the captured object bases so unseen peer changes cannot be mistaken for local reversions.
                return new Promise((resolve, reject) => current.fileSaved(explicitMode ? captured : result.xml, null, () => { current.contentChanged?.(); if (background && file() === current && generation === contextGeneration) pendingObjects(); finishGardenCreations(capturedCreations, current, generation, saveUser); void releaseSavedHolds(releaseCandidates, current, generation, saveUser).catch(error => status('Changes saved; releasing editing activity failed: ' + error.message)); background?.state(current.isModified() ? 'pending' : 'saved'); void background?.checkpoint(true).catch(error => status('Recovery checkpoint failed: ' + error.message)); timings({ operationId: batch.id, phase: 'save native completion', durationMs: window.performance.now() - nativeStarted }); resolve(); }, err => { background?.state('failed'); reject(err); })); // CHANGE: reconcile the captured objects before retiring their creation summary, avoiding a completion-time badge flash.
            }; // NEW
            const slowTimer = window.setInterval(() => { // NEW
                if (file() === current && batch.generation === contextGeneration && batch.stage !== 'waiting for an editing pause' && window.performance.now() - started >= 5000) { const stage = batch.stage === 'queued' && batch.blockedBy ? 'queued behind save #' + batch.blockedBy.id + ' (' + batch.blockedBy.stage + ')' : batch.stage; setSaveStatus(current, 'Still working: ' + (stage || 'saving garden') + ' (' + Math.floor((window.performance.now() - started) / 1000) + ' seconds).'); } // CHANGE: report the actual blocking operation while preserving unrelated warnings.
            }, 1000); // NEW
            batch.promise = collaborationSave.catch(() => {}).then(operation).catch(error => { if (file() === current && batch.generation === contextGeneration) background?.state(current.__trellisConflict ? 'conflict' : 'failed'); throw error; }).finally(() => { // CHANGE: transport and persistence exceptions also leave a precise recoverable failure badge.
                batch.finishFence?.(); // NEW: release waiting expiry processing after native save bookkeeping.
                batch.blockedBy = null; // CHANGE: completed batches do not retain the predecessor chain.
                window.clearInterval(slowTimer); if (current.__trellisSaveBatch === batch) { current.__trellisSaveBatch = null; delete current.__trellisSaveStage; } // NEW
                if (batch.generation === contextGeneration) renderSaveStatus(current); // NEW: resume the countdown for edits made during the completed capture.
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
        return (edit.changes || []).filter(change => !change.__trellisUsersActorStamp && (!manualOnly || !editContext || editContext.kindOf(change) === 'manual')).flatMap(change => { // CHANGE
            const cell = change.cell || change.child; if (!cell) return null; // NEW
            if (editContext) return editContext.changeCells(change).map(target => target.id); // CHANGE: detached children retain their pre-edit planting target.
            let planting = null; // NEW: retain the existing fallback for older shells without the context runtime.
            for (let cursor = cell; cursor; cursor = graph.getModel().getParent(cursor)) if (/(?:^|;)tiler_group=1(?:;|$)/.test(cursor.style || '') || cursor.getAttribute?.('planting_id')) planting = cursor; // NEW
            return (planting || cell).id; // NEW
        }).filter(Boolean); // NEW
    } // NEW
    function undoRejected(edit, reason) { // NEW
        for (const item of Array.isArray(edit) ? edit : [edit]) if (item) { item.__trellisUsersRejected = true; item.__trellisUsersRejectedReason = reason; } // CHANGE: initiating creation commands retain the specific rejection rather than reporting an unknown cluster error.
        for (let index = unsavedActions.length - 1; index >= 0; index--) if (unsavedActions[index].edit.__trellisUsersRejected) unsavedActions.splice(index, 1); // NEW
        const previous = graph.__trellisUsersInternalChange; graph.__trellisSharingApplying = true; graph.__trellisUsersInternalChange = true; // NEW
        try { for (const item of (Array.isArray(edit) ? [...edit].reverse() : [edit])) if (item?.undo) item.undo(); } finally { graph.__trellisSharingApplying = false; graph.__trellisUsersInternalChange = previous; observedXml = ui.getFileData(); } status(reason); // NEW
    } // NEW
    /** Reuse the existing all-or-nothing UndoableEdit rejection boundary. */ // NEW
    function installCollaborationHooks() { // NEW
        const model = graph.getModel?.(); if (!model?.addListener || model.__trellisCollaboration) return; model.__trellisCollaboration = true; // NEW
        tracksModelChanges = true; // CHANGE
        model.addListener('change', (_sender, event) => { // NEW
            const edit = event?.getProperty?.('edit'); // CHANGE: rejected transactions and their nested rollback cannot invalidate an accepted capture.
            if (graph.__trellisUsersRejecting || graph.__trellisLocalViewChanging || edit?.__trellisUsersRejected) return; // CHANGE
            if (edit?.changes?.length && editContext && edit.changes.every(change => change.__trellisUsersActorStamp || ['derived-presentation', 'attribution'].includes(editContext.kindOf(change)))) return; // CHANGE: presentation-only transactions cannot become pending content.
            modelRevision++; // CHANGE: internal and remote edits also invalidate pending captures.
            if (!isCollaborative() || identityJoinInProgress || graph.__trellisSharingApplying || graph.__trellisLocalViewChanging || graph.__trellisUsersRejecting || ui.openingFile) return; // CHANGE
            if (!edit?.changes?.some(change => !change.__trellisUsersActorStamp) || edit.__trellisUsersRejected) return; // CHANGE
            if (!coordinationAvailable()) { undoRejected(edit, lastStatus?.editingAvailability?.reason || info?.editingAvailability?.reason || 'This scope is read-only until a coordinator is available.'); return; } // NEW: internal remote updates have already passed the trusted-update guard.
            if (explicitMode && editObjectIds(edit).some(id => isPendingCell(model.getCell(id)))) { undoRejected(edit, 'Refresh this object and its related changes before editing.'); return; } // NEW
            const before = observedXml || collaborationBaseline || file().data; // CHANGE: the first claim captures its snapshot in the existing deferred operation, without a redundant full-diagram serialization here.
            const page = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; // NEW
            observeGardenCreation(edit, page); // NEW: register the group before either synchronous paint or activity publication.
            const keys = [...new Set(editObjectIds(edit))].map(id => JSON.stringify([page, String(id)])); // CHANGE: generated planting tiles share their source's pending status instead of creating hundreds of badges.
            if (editingForm?.isConnected && formTargets.some(key => keys.includes(key))) { editingForm = null; formTargets = []; } // CHANGE: applying a legacy object form completes its draft; persistence keeps the hold.
            for (const key of keys.length ? keys : ['*']) dirtyObjects.add(key); // NEW
            const badgeStarted = window.performance.now(); background?.changed(); renderBadges(); // CHANGE: rejection and recovery handling below remains intact.
            timings({ phase: 'pending badge', durationMs: window.performance.now() - badgeStarted }); // NEW
            if (window.TrellisSyncTiming && window.requestAnimationFrame) window.requestAnimationFrame(() => timings({ phase: 'pending badge paint', durationMs: window.performance.now() - badgeStarted })); // NEW
            unsavedActions.push({ edit, keys: keys.length ? [...new Set(keys)] : ['*'], revision: modelRevision }); // NEW
            if (!editObjectIds(edit, true).length) { if (acquiring && editObjectIds(edit).some(id => acquisitionObjects.has(id))) pendingEdits.push(edit); return; } // CHANGE: dependent generation rolls back with a rejected manual source; independent generation retains its own save/recovery tracking.
            if (acquiring) { const ids = editObjectIds(edit, true); if (!claimDispatched || ids.every(id => acquisitionObjects.has(id)) || graph.__trellisModuleCreation?.actorUserId === context().userId) { pendingEdits.push(edit); policyActionPending ||= !!graph.__trellisUsersInternalChange; for (const id of ids) acquisitionObjects.add(id); return; } bridge.saveRecoveryCopy({ shareId: info.shareId, xml: ui.getFileData() }).catch(err => status(err.message)); undoRejected(edit, 'Wait for the pending editing hold before changing another object.'); return; } // CHANGE: authorized module creation joins the existing claim drain without waiting for persistence.
            acquiring = true; claimDispatched = false; policyActionPending = !!graph.__trellisUsersInternalChange; pendingEdits = [edit]; acquisitionObjects = new Set(editObjectIds(edit, true)); const current = file(), generation = contextGeneration; // CHANGE
            let capturedXml, capturedRevision; // CHANGE
            acquisitionPromise = Promise.resolve().then(async () => { // CHANGE: serialize an extending creation batch using the existing claim lane.
                let result, requested; // CHANGE
                do { // CHANGE
                    claimDispatched = true; capturedXml = ui.getFileData(); capturedRevision = modelRevision; requested = new Set(acquisitionObjects); // CHANGE
                    const targets = [...requested].map(id => JSON.stringify([page, String(id)])); result = await coordinate({ kind: 'claim', targets, baseXml: before, xml: capturedXml, usersPolicyAction: policyActionPending }); // CHANGE
                    if (file() !== current || generation !== contextGeneration || !result?.ok) return result; // CHANGE
                } while ([...acquisitionObjects].some(id => !requested.has(id))); // CHANGE: new roots added while a claim was in flight receive their own confirmed claim before saving.
                return result; // CHANGE
            }).then(async result => { // CHANGE
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
            const leaving = holds.filter(h => !pinned.includes(h.key) && !selectedPlanting(h.key)).map(h => h.key); // CHANGE: navigating among planting siblings continues the same editing session.
            const update = async () => { await coordinate({ kind: 'view', objects }); await acquisitionPromise; if (leaving.length) await releaseHolds(leaving, { automatic: true }); }; update().catch(err => status(err.message)); // CHANGE: navigation must not promote autosave to an immediate manual flush.
        }); // NEW
    } // NEW
    let formActivityTimer = null; // NEW
    /** Observe typing before registered-editor handlers consume it; do not turn private text into a graph change. */ // CHANGE
    for (const type of ['input', 'change', 'compositionstart', 'compositionupdate', 'compositionend']) document.addEventListener(type, event => { // CHANGE
        const field = event.target; if (!isCollaborative() || !event.isTrusted || !field.matches?.('input,textarea,select,[contenteditable="true"]') || field.closest('[data-trellis-frozen],.trellis-collaboration-dialog,.trellis-garden-share-dialog') || field.matches('input[type="search"],[data-trellis-search]') || /search|filter/i.test(field.name + ' ' + field.id)) return; // CHANGE
        if (!field.closest('[data-trellis-collaborative-editor],[data-collaboration-object-id],[data-spacing-row-cell],.trellis-object-details') && !graph.cellEditor?.textarea?.contains(field)) return; // CHANGE
        if (type === 'compositionstart') composingFields.add(field); if (type === 'compositionend') composingFields.delete(field); background?.activity(); // CHANGE
        if (type === 'input' || type === 'change' || type === 'compositionupdate') rememberCreationDraft(field); // NEW: only actual typing or a field change reveals the creator's editing label.
    }, true); // CHANGE
    document.addEventListener('input', event => { // NEW: form drafts reserve their object on actual typing, before Apply mutates the model.
        if (event.target.closest('[data-trellis-frozen]')) return; // CHANGE
        if (event.target.closest('[data-trellis-collaborative-editor]')) return; // NEW: registered editors own their claim and recovery lifecycle.
        if (!isCollaborative() || !event.isTrusted || event.target.closest('.trellis-collaboration-dialog,.trellis-garden-share-dialog')) return; // NEW
        const labelCell = editingLabel && graph.cellEditor?.textarea?.contains(event.target) ? graph.cellEditor.editingCell : null; // NEW
        if (labelCell) { // NEW: contenteditable native labels count as editing activity; viewing does not.
            const page = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; // NEW
            labelEditorRegistration?.touch(); labelClaim = labelEditorRegistration?.acquire() || Promise.resolve(); labelClaim = labelClaim.catch(error => status(error.message)); return; // CHANGE // NEW
        } // NEW
        if (!event.target.matches?.('input,textarea,select,[contenteditable="true"]')) return; // CHANGE: independent rich-text details participate in existing object holds.
        const binding = event.target.closest('[data-collaboration-object-id],[data-spacing-row-cell]'); // NEW
        const form = event.target.closest('[role="dialog"],.geDialog,.usl-scheduler-dialog'); if (!binding && !form) return; // NEW
        rememberCreationDraft(event.target); // NEW: unregistered settings dialogs use the same existing selection/binding targets as their claim.
        const page = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; // NEW
        const id = binding?.dataset.collaborationObjectId || binding?.dataset.spacingRowCell; const targets = id ? [logicalObjectKey(JSON.stringify([page, id]))] : selectedObjectKeys(); if (!targets.length) return; // CHANGE
        editingForm = form || binding; formTargets = targets; window.clearTimeout(formActivityTimer); // CHANGE
        formActivityTimer = window.setTimeout(() => coordinate({ kind: 'claim', targets }).then(result => { if (!result) return; if (!result.ok && editingForm?.isConnected) { if (explicitMode) { recoverLostHolds(targets, result.reason).catch(() => {}); return; } let message = editingForm.querySelector('[data-collaboration-notice]'); if (!message) { message = note(editingForm, ''); message.dataset.collaborationNotice = ''; message.setAttribute('role', 'status'); } message.textContent = result.reason + ' Your form entries remain here. Request release before applying them.'; } }).catch(err => status(err.message)), 250); // CHANGE
    }, true); // NEW
    let badgeLayer = null, badgeFingerprint = '', popover = null, popoverKey = null; // CHANGE: activity details open only through deliberate activation.
    /** Resolve the current badge after live updates replace its original DOM node. */ // CHANGE
    function closeObjectPopover(restoreFocus = false) { // CHANGE
        const anchor = [...(badgeLayer?.querySelectorAll('[data-object-key]') || [])].find(badge => badge.dataset.objectKey === popoverKey); // CHANGE
        if (popover) popover.remove(); popover = null; popoverKey = null; // CHANGE
        anchor?.setAttribute('aria-expanded', 'false'); // CHANGE
        if (restoreFocus && anchor?.isConnected && !anchor.hidden) anchor.focus(); // CHANGE
    } // CHANGE
    document.addEventListener('pointerdown', event => { // CHANGE: dismiss without consuming the outside control's normal action or focus.
        if (popover && !popover.contains(event.target) && !badgeLayer?.contains(event.target)) closeObjectPopover(); // CHANGE
    }, true); // CHANGE
    document.addEventListener('keydown', event => { // CHANGE: Escape dismisses even after keyboard focus moves outside the panel.
        if (popover && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeObjectPopover(true); } // CHANGE
    }, true); // CHANGE
    /** A user can have several windows/devices; only this session may save this window's draft. */ // CHANGE
    function isLocalActivity(source) { return !!localSessionId && source.sessionId === localSessionId && (!source.userId || source.userId === context().userId) && (!source.deviceId || !info?.deviceId || source.deviceId === info.deviceId); } // CHANGE
    function activityPerson(source) { return isLocalActivity(source) ? source.name || 'You' : (source.name || source.userId || 'Unknown user') + (source.userId === context().userId ? ' (your other session)' : ''); } // CHANGE: retain familiar author names while distinguishing their other sessions.
    /** Shared presentation records keep pending work, presence and ownership independent. No diagram serialization. */ // CHANGE
    function objectActivity() { // CHANGE
        const entries = new Map(), publishedLocal = new Set(), holds = collaboration?.holds || [], state = background?.getSaveStatus?.().state || 'pending'; // CHANGE
        const add = (sourceKey, kind, source, visible = true) => { // CHANGE: aggregate display only; commands still address the original signed hold.
            const key = logicalObjectKey(sourceKey), entry = { key, sourceKey, kind, source, visible }, list = entries.get(key) || []; // CHANGE
            const previous = list.find(item => activityIdentity(item) === activityIdentity(entry)); // CHANGE
            if (previous) previous.visible ||= visible; else list.push(entry); entries.set(key, list); // CHANGE
        }; // CHANGE
        for (const pending of collaboration?.pendingChanges || []) { // CHANGE
            const local = isLocalActivity(pending), targets = local && pending.online ? creationPendingKeys(pending.targets, pending.saveState) : pending.targets; // CHANGE
            for (const key of targets) { add(key, 'pending', pending); if (local) publishedLocal.add(logicalObjectKey(key)); } // CHANGE
        } // CHANGE
        for (const key of creationPendingKeys(dirtyObjects, state)) if (!publishedLocal.has(logicalObjectKey(key))) add(key, 'pending', { userId: context().userId, sessionId: localSessionId, deviceId: info?.deviceId, online: true, saveState: state, name: 'You' }); // CHANGE
        for (const viewer of collaboration?.presence || []) for (const key of viewer.targets) add(key, 'viewing', viewer, !holds.some(hold => logicalObjectKey(hold.key) === logicalObjectKey(key) && hold.sessionId === viewer.sessionId && hold.deviceId === viewer.deviceId)); // CHANGE
        for (const hold of holds) add(hold.key, 'editing', hold, !(isLocalActivity(hold) && !hold.requested && !collaboration?.losses?.some(loss => loss.key === hold.key) && untouchedCreationMember(hold.key, true) && !creationDrafts.has(hold.key))); // CHANGE
        for (const turn of collaboration?.reservations || []) add(turn.key, 'turn', turn); // CHANGE
        return entries; // CHANGE
    } // CHANGE
    /** Use the same wording in badges, the live object dialog and the Sharing overview. */ // CHANGE
    function describeActivity(entry) { // CHANGE
        const { kind, source, key } = entry, person = activityPerson(source), subject = isLocalActivity(source) ? person === 'You' ? 'This window' : person + ' (this window)' : person, uncertain = source.online === false, suffix = uncertain ? ' · offline · status unconfirmed' : ''; // CHANGE
        if (kind === 'pending') { // CHANGE
            const state = source.saveState, meaning = state === 'failed' ? 'save failed' : state === 'conflict' ? 'conflict' : state === 'saving' ? 'saving changes' : 'changed · pending project save'; // CHANGE
            let detail = subject + (uncertain ? ' last reported ' : ' · ') + meaning + (uncertain ? '; current save status is unknown.' : '.'); // CHANGE
            if (!isLocalActivity(source)) { // CHANGE
                if (!(collaboration?.holds || []).some(hold => logicalObjectKey(hold.key) === key || hold.key === '*' || key === '*')) detail += ' No editing hold is reported for this object; this notice does not block editing.'; // CHANGE
                detail += source.userId === context().userId ? ' Check private recovery drafts on this computer; a draft from another computer may only be available there.' : ' Their private recovery draft can only be checked by its author on the computer where it was stored.'; // CHANGE
            } // CHANGE
            return { label: person + ' · ' + meaning + suffix, detail }; // CHANGE
        } // CHANGE
        if (kind === 'editing') return { label: person + ' · editing' + suffix, detail: subject + ' is editing' + (uncertain ? ' (disconnected or presence unconfirmed)' : '') + '. ' + (source.requested ? 'Release requested. Editing ends in ' + Math.max(0, Math.ceil(((source.requestDeadline ?? source.expiresAt) - Date.now()) / 1000)) + ' seconds. ' : '') + 'The editing hold automatically releases after thirty seconds without a fresh session heartbeat.' }; // CHANGE
        if (kind === 'turn') return { label: person + ' · next turn', detail: subject + ' has the next editing turn. Begin within ' + Math.max(0, Math.ceil((source.until - Date.now()) / 1000)) + ' seconds.' }; // CHANGE
        return { label: person + ' · viewing' + suffix, detail: subject + (uncertain ? ' last reported viewing; current presence is unconfirmed.' : ' is viewing.') }; // CHANGE
    } // CHANGE
    function activityIdentity(entry) { return JSON.stringify([entry.key, entry.kind, entry.source.userId || '', entry.source.deviceId || '', entry.source.sessionId || '', entry.kind === 'editing' || entry.kind === 'turn' ? entry.sourceKey : '']); } // CHANGE: deduplicate child viewing while retaining separate claims and stable controls through save-state changes.
    /** A source's live state determines which existing workflow it may invoke. */ // CHANGE
    function activityCommand(entry) { // CHANGE
        if (entry.kind === 'editing') return { action: 'hold', label: isLocalActivity(entry.source) ? 'Release now' : 'Request release' }; // CHANGE
        if (entry.kind === 'pending' && isLocalActivity(entry.source) && entry.source.saveState !== 'saving') return entry.source.saveState === 'conflict' ? { action: 'review', label: 'Review changes' } : { action: 'save', label: entry.source.saveState === 'failed' ? 'Retry save' : 'Save now' }; // CHANGE
        if (entry.kind === 'pending' && entry.source.userId === context().userId && !isLocalActivity(entry.source) && bridge.recoveryAction) return { action: 'recovery', label: 'Check private recovery drafts' }; // CHANGE
        return { action: '', label: '' }; // CHANGE
    } // CHANGE
    /** Reuse existing persistence/recovery commands; stale views cannot submit actions for a different author. */ // CHANGE
    async function runActivityAction(panel, operation) { // CHANGE
        const owner = panel.__activityContext, valid = () => panel.isConnected && file() === owner.file && contextGeneration === owner.generation && context().userId === owner.actor && info?.shareId === owner.shareId; // CHANGE
        if (panel.__activityBusy || !valid()) return; panel.__activityBusy = true; // CHANGE
        const error = panel.querySelector('[data-status]'); if (error) error.textContent = ''; // CHANGE
        for (const control of panel.querySelectorAll('[data-activity-action]')) { control.disabled = true; control.dataset.keepDisabled = 'true'; } // CHANGE
        try { await operation(); } catch (failure) { if (valid() && error) { error.textContent = failure.message; error.setAttribute('role', 'alert'); } } // CHANGE
        finally { panel.__activityBusy = false; if (valid()) { announce(); for (const control of panel.querySelectorAll('[data-activity-action]')) { control.disabled = false; control.dataset.keepDisabled = 'false'; } } } // CHANGE
    } // CHANGE
    /** Keyed rows keep focused controls mounted while heartbeats update their descriptions. */ // CHANGE
    function renderActivityRows(container, entries, includeObject = false) { // CHANGE
        const panel = container.closest('[role="dialog"]'); panel.__activityContext ||= { file: file(), generation: contextGeneration, actor: context().userId, shareId: info?.shareId }; // CHANGE
        const existing = new Map([...container.children].map(row => [row.dataset.activityId, row])), seen = new Set(); // CHANGE
        for (const entry of entries) { // CHANGE
            const id = activityIdentity(entry); seen.add(id); let row = existing.get(id); // CHANGE
            if (!row) { row = document.createElement('div'); row.dataset.activityId = id; note(row, '').dataset.activityDescription = ''; container.appendChild(row); } // CHANGE
            row.__activityEntry = entry; const description = describeActivity(entry); row.querySelector('[data-activity-description]').textContent = (includeObject ? objectLabel(entry.key) + ': ' : '') + description.detail; // CHANGE
            const { action, label } = activityCommand(entry); // CHANGE
            let control = row.querySelector('[data-activity-action]'); // CHANGE
            if (action && !control) { // CHANGE
                control = button(label, () => runActivityAction(panel, async () => { // CHANGE
                    const current = row.__activityEntry, latest = [...objectActivity().values()].flat().find(item => activityIdentity(item) === id); // CHANGE
                    if (!latest || !row.dataset.action || activityCommand(latest).action !== row.dataset.action || latest.kind === 'editing' && latest.source.claimId !== current.source.claimId) return; // CHANGE: queued or hidden controls cannot submit after their applicable action changes.
                    if (row.dataset.action === 'save') await saveCurrent(); // CHANGE
                    else if (row.dataset.action === 'review') { closeObjectPopover(); await showDraftConflicts(); } // CHANGE
                    else if (row.dataset.action === 'recovery') { closeObjectPopover(); await showPrivateDrafts(); } // CHANGE
                    else if (isLocalActivity(latest.source)) await (holdEditors ? holdEditors.handoff([latest.sourceKey]) : releaseHolds([latest.sourceKey])); // CHANGE
                    else await coordinate({ kind: 'request', targets: [latest.sourceKey] }); // CHANGE
                }), row); control.dataset.activityAction = ''; // CHANGE
            } // CHANGE
            row.dataset.action = action; // CHANGE
            if (control) { const focused = document.activeElement === control; control.hidden = !action; control.textContent = label; control.disabled = !!panel.__activityBusy; control.dataset.keepDisabled = String(!!panel.__activityBusy); if (!action && focused) panel.querySelector('[data-activity-close]')?.focus(); } // CHANGE
            let scope = row.querySelector('[data-save-scope]'); if (action === 'save' && !scope) { scope = note(row, 'Saves all committed pending changes in this window.'); scope.dataset.saveScope = ''; } if (scope) scope.hidden = action !== 'save'; // CHANGE
        } // CHANGE
        for (const [id, row] of existing) if (!seen.has(id)) { const focused = row.contains(document.activeElement); row.remove(); if (focused) panel.querySelector('[data-activity-close]')?.focus(); } // CHANGE
    } // CHANGE
    function updateObjectPopover() { // CHANGE: live pending status and ownership retain focus and the open panel.
        if (!popover) return; // CHANGE
        const entries = objectActivity(), records = [...(entries.get(popoverKey) || []), ...(popoverKey === '*' ? [] : entries.get('*') || [])]; // CHANGE
        renderActivityRows(popover.querySelector('[data-activity-rows]'), records); // CHANGE
        popover.querySelector('[data-editing-status]').textContent = records.length ? '' : 'No viewing activity, pending changes, or editing holds are currently reported for this object.'; // CHANGE: automatic presence expiry leaves the open details panel useful without retaining a stale viewing row.
        const peers = lastStatus?.connectedPeers ?? lastStatus?.connectedCollaborators; // CHANGE
        popover.querySelector('[data-connection-status]').textContent = peers == null ? 'Connection status is unavailable; reported activity may be out of date.' : peers > 0 ? 'Other computers are connected; reported activity updates may be delayed.' : 'Working locally. No other computers are connected; their activity may be out of date.'; // CHANGE
        if (popover.isConnected) { const bounds = popover.getBoundingClientRect(); if (bounds.bottom > window.innerHeight - 12) popover.style.top = Math.max(12, window.innerHeight - bounds.height - 12) + 'px'; } // CHANGE: expanded session explanations and actions stay within the viewport.
    } // CHANGE
    function showObjectPopover(key, anchor) { // CHANGE
        if (popoverKey === key && popover) { closeObjectPopover(); return; } closeObjectPopover(); // CHANGE: activating another badge switches objects; the same badge toggles closed.
        popoverKey = key; anchor.setAttribute('aria-expanded', 'true'); popover = document.createElement('section'); popover.setAttribute('role', 'dialog'); popover.setAttribute('aria-label', 'Activity for ' + objectLabel(key)); // CHANGE
        popover.style.cssText = 'position:fixed;z-index:' + GRAPH_OVERLAY_Z.CONTROL_TOP + ';width:324px;max-width:calc(100vw - 24px);box-sizing:border-box;max-height:min(480px,calc(100vh - 24px));overflow:auto;padding:12px;background:#fff;color:#111827;border:1px solid #9ca3af;border-radius:6px;box-shadow:0 6px 18px #0003;font:13px Arial;'; // CHANGE: expanded activity details sit above ordinary controls and below modal dialogs.
        popover.classList.add('trellis-surfaces'); // NEW: shared surface hierarchy.
        const bounds = anchor.getBoundingClientRect(); popover.style.left = Math.max(12, Math.min(bounds.left, window.innerWidth - 324)) + 'px'; popover.style.top = Math.max(12, Math.min(bounds.bottom + 4, window.innerHeight - 312)) + 'px'; // NEW
        note(popover, objectLabel(key)); // NEW
        const rows = document.createElement('div'); rows.dataset.activityRows = ''; popover.appendChild(rows); // CHANGE
        note(popover, '').dataset.editingStatus = ''; note(popover, '').dataset.connectionStatus = ''; // CHANGE
        const error = note(popover, ''); error.dataset.status = ''; error.setAttribute('role', 'status'); // CHANGE
        // CHANGE: activity notifications keep this panel current; internal authority confirmation still uses refreshActivity.
        button('Close', () => closeObjectPopover(true), popover, 'close').dataset.activityClose = ''; updateObjectPopover(); // CHANGE
        for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click', 'keydown', 'keypress', 'keyup']) popover.addEventListener(type, e => { e.stopPropagation(); }); // CHANGE: panel input must not invoke graph shortcuts or selection gestures.
        document.body.appendChild(popover); updateObjectPopover(); popover.querySelector('button:not([hidden])')?.focus(); // CHANGE: keep details open when the pointer leaves, and clamp the mounted panel.
    } // NEW
    function renderBadges() { // NEW
        if (!graph.container || !isCollaborative()) { badgeLayer?.remove(); badgeLayer = null; badgeFingerprint = ''; closeObjectPopover(); return; } // NEW
        pruneCreationDrafts(); // NEW
        const entries = new Map(), pageId = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || ''; // CHANGE
        for (const [key, records] of objectActivity()) { const labels = [...new Set(records.filter(entry => entry.visible).map(entry => describeActivity(entry).label))]; if (labels.length) entries.set(key, labels); } // CHANGE
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
                const badge = button(labels.join(' · '), () => showObjectPopover(key, badge), badgeLayer); badge.dataset.objectKey = key; badge.setAttribute('aria-label', objectLabel(key) + ': ' + labels.join(', ')); badge.setAttribute('aria-haspopup', 'dialog'); badge.setAttribute('aria-expanded', String(popoverKey === key && !!popover)); // CHANGE: no native hover tooltip; native buttons retain Enter/Space activation.
                badge.style.cssText += 'position:absolute;pointer-events:auto;font-size:11px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:rgba(255,255,255,0.5);'; // CHANGE: only the fill is translucent; text, border and focus outline remain opaque.
                for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click', 'keydown', 'keypress', 'keyup']) badge.addEventListener(type, e => { e.stopPropagation(); }); // CHANGE
            } // NEW
        } // NEW
        for (const badge of badgeLayer.querySelectorAll('[data-object-key]')) { const [, id] = JSON.parse(badge.dataset.objectKey), cell = graph.getModel?.().getCell(id), state = graph.view?.getState(cell); badge.hidden = !state; if (state) { const left = state.x + state.width + 4 + 'px', top = state.y + 'px'; if (badge.style.left !== left) badge.style.left = left; if (badge.style.top !== top) badge.style.top = top; } } // CHANGE: do not rewrite stationary badge geometry.
        updateObjectPopover(); // NEW
    } // NEW
    const collaborationTimer = window.setInterval(async () => { // NEW
        if (!isCollaborative() || acquiring) return; try { // NEW
            if (editingForm && !editingForm.isConnected) { editingForm = null; const pinned = holdEditors?.pinnedTargets() || []; const targets = (collaboration?.holds || []).filter(hold => hold.sessionId === localSessionId && !pinned.includes(hold.key)).map(hold => hold.key); if (targets.length) await releaseHolds(targets, { automatic: true }); } // CHANGE
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
            labelEditorRegistration = holdEditors?.register({ // CHANGE: ordinary labels use the same editing lifecycle as planting labels. // NEW
                kind: 'label', title: 'Object label', reopen: currentCell => graph.startEditingAtCell(currentCell), element: () => graph.cellEditor?.textarea, targets: [JSON.stringify([page, planting?.id || cell.id])], restore: draft => { if (graph.cellEditor?.textarea) graph.cellEditor.textarea.innerHTML = draft.labelHtml; }, capture: () => ({ pageId: page, objectId: planting?.id || cell.id, labelCellId: cell.id, labelHtml: graph.cellEditor?.textarea?.innerHTML || '' }), // NEW
                save() { if (graph.cellEditor?.editingCell === cell) { stoppingForSave = true; try { graph.stopEditing(false); } finally { stoppingForSave = false; } } return true; }, // NEW
                discard() { if (graph.cellEditor?.editingCell === cell) { stoppingForSave = true; try { graph.stopEditing(true); } finally { stoppingForSave = false; } } } // NEW
            }); // NEW
            labelClaim = Promise.resolve(); // CHANGE: opening an unchanged label does not claim editing activity.
        }); // CHANGE
        graph.addListener('editingStarted', () => { editingLabel = true; labelEditorRegistration?.checkpoint?.(); }); // CHANGE // NEW
        graph.addListener('editingStopped', () => { const wasEditing = editingLabel; editingLabel = false; if (!wasEditing || stoppingForSave || !isCollaborative()) return; labelEditorRegistration?.complete?.(); labelEditorRegistration?.dispose(); labelEditorRegistration = null; labelClaim.then(() => { const pinned = holdEditors?.pinnedTargets() || [], targets = (collaboration?.holds || []).filter(hold => hold.sessionId === localSessionId && !pinned.includes(hold.key)).map(hold => hold.key); if (targets.length) return releaseHolds(targets, { automatic: true }); }).catch(err => status(err.message)); }); // CHANGE
    } // NEW
    window.Trellis = window.Trellis || {};
    /** Explicit forms keep their private drafts until the existing claim and collaborative save have both settled. */ // CHANGE
    async function settleObjectEdits(options = {}) { // CHANGE
        if (!isCollaborative()) return; const current = file(); // CHANGE
        await acquisitionPromise; // CHANGE
        if (file() !== current) throw new Error('The diagram changed before the comment was accepted.'); // CHANGE
        await saveCurrent(options); // CHANGE: object commands may use the automatic quiet queue.
        if (options.release) await releaseUnpinnedHolds(); // CHANGE: command cleanup must not release an active planner's hold.
    } // CHANGE
    /** Hand off completed edits while retaining holds pinned by an active editor. */ // NEW
    async function releaseUnpinnedHolds() { // NEW
        const pinned = holdEditors?.pinnedTargets() || [], targets = (collaboration?.holds || []).filter(hold => hold.sessionId === localSessionId && !pinned.includes(hold.key)).map(hold => hold.key); // NEW
        if (targets.length) await coordinate({ kind: 'release', targets }); // NEW
    } // NEW
    /** Retain a failed local commit separately; never replace a usable checkpoint with quarantined graph state. */ // CHANGE
    function retainFailedCommit(reason) { // CHANGE
        if (!isCollaborative()) return; // CHANGE
        const current = file(), generation = contextGeneration, expectedUserId = context().userId; // CHANGE
        holdEditors?.freeze(['*'], reason); // CHANGE
        let input; // CHANGE
        try { input = { shareId: info.shareId, expectedUserId, kind: 'retain', lossId: window.crypto.randomUUID(), reason, revision: modelRevision, baseXml: collaborationBaseline || current.data, xml: ui.getFileData(), editorDrafts: holdEditors?.capture(['*']) || [], ...(graph.__trellisProjectFormat === 2 ? { references: referenceDependencies() } : {}) }; } catch (error) { status(reason + ' Recovery capture failed: ' + error.message, () => showSavingRecovery(reason)); return; } // CHANGE
        const preserve = async () => { // CHANGE
            try { await bridge.recoveryAction(input); if (file() === current && generation === contextGeneration && expectedUserId === context().userId) holdEditors?.preservation(['*'], true); } // CHANGE
            catch (error) { if (file() === current && generation === contextGeneration && expectedUserId === context().userId) { holdEditors?.preservation(['*'], false, error.message, preserve); status(reason + ' Recovery preservation failed: ' + error.message, () => showSavingRecovery(reason)); } } // CHANGE
        }; // CHANGE
        for (const editor of holdEditors?.recoveryEditors(['*']) || []) editor.setActions([{ id: 'saved-version', label: 'Open latest saved version', destructive: true, run: openLatestSavedVersion }, { id: 'copy', label: 'Copy entries', run: () => copyEditorEntries(editor) }], 'Discards all unsaved work in this window.'); // CHANGE
        void preserve(); status(reason, () => showSavingRecovery(reason)); // CHANGE
    } // CHANGE
    window.Trellis.sharing = { retainFailedCommit, showBlockedEdit, openLatestSavedVersion, resolveEditorCell, ensureManaged, prepareInvite, validateInvite, showJoinDialog, showSharingDialog, refresh, whenDocumentReady, context, describeStatus, settleObjectEdits, registerEditor: registerSharingEditor, rejectOperation: (edit, reason) => undoRejected(edit, reason), releaseRemovedCreations, registerObjectForm: config => holdEditors?.registerForm(config), whenEditingReady: async () => { const current = file(), generation = contextGeneration, actor = context().userId; await acquisitionPromise; if (current !== file() || generation !== contextGeneration || actor !== context().userId) throw new Error('The editing context changed before the operation could begin.'); }, transitionEditor: operation => holdEditors ? holdEditors.transition(operation) : Promise.resolve(operation()), activeEditorTargets: () => holdEditors?.activeTargets() || [], getStatus: () => lastStatus, getInfo: () => info, isApplyingRemote: () => !!graph.__trellisSharingApplying, isExplicitRefresh: () => explicitMode && isCollaborative(), isPendingCell, permissionChanges: () => unsavedActions.filter(action => !action.edit.__trellisUsersRejected && !action.edit.undone).flatMap(action => action.edit.changes || []), whenHistoryPublished: () => savedQueue, historyXml: async () => (await coordinate({ kind: 'history-state' }))?.xml, getPendingChanges: () => incoming?.getGroups() || [] }; // CHANGE: registered editors retain their API and report draft disposal to creation-badge presentation.
    /** Blocked operations retain their fields and expose existing activity/access commands in place. */ // CHANGE
    function showBlockedEdit(error, element) { // CHANGE
        const current = file(), generation = contextGeneration, actor = context().userId; // CHANGE
        const host = element || document.activeElement?.closest?.('[data-trellis-collaborative-editor]') || graph.container; // CHANGE
        if (!host) return; host.querySelector('[data-trellis-blocked-edit]')?.remove(); // CHANGE
        const notice = document.createElement('section'); notice.dataset.trellisBlockedEdit = ''; notice.dataset.trellisReviewAllow = ''; notice.setAttribute('role', 'status'); // CHANGE
        notice.style.cssText = 'padding:8px;margin:6px 0;border:1px solid #a65b00;background:#fff4d6;color:#452700;font:13px/1.4 Arial;'; // CHANGE
        note(notice, error.message || error.reason || 'Saving is blocked. Your entries remain here.'); const message = note(notice, ''); message.dataset.status = ''; // CHANGE
        const valid = () => notice.isConnected && file() === current && contextGeneration === generation && context().userId === actor; // CHANGE
        const run = action => async () => { if (!valid()) throw new Error('The editor or author changed.'); await action(); }; // CHANGE
        const holds = error.blocked || [], targets = error.targets || holds.map(hold => hold.key); // CHANGE
        if (holds.length) { // CHANGE
            button('View blocking edit', run(() => { showObjectPopover(holds[0].key, notice); if (popover) popover.style.zIndex = '2147483150'; }), notice); // CHANGE
            if (holds.some(hold => !hold.local && hold.sessionId !== localSessionId)) button('Request release', run(async () => { const result = await coordinate({ kind: 'request', targets: holds.filter(hold => !hold.local && hold.sessionId !== localSessionId).map(hold => hold.key) }); if (!result?.ok) throw new Error(result?.reason || 'Release could not be requested.'); message.textContent = 'Release requested. Retry Save when editing is available.'; }), notice); // CHANGE
        } else if (!actor) button('Log in', run(() => users()?.showAuthDialog?.({ blocking: false })), notice); // CHANGE
        else if (error.code === 'PERMISSION_DENIED' || error.code === 'TRELLIS_EDIT_REJECTED') button('Request Access', run(() => { const cell = resolveEditorCell(targets[0], true); if (!cell) throw new Error('The object is no longer available.'); users()?.openAccessRequestDialog?.(cell); }), notice); // CHANGE
        host.prepend(notice); status(error.message || error.reason || 'Saving is blocked.', () => { if (valid()) notice.querySelector('button')?.focus(); }); // CHANGE
    } // CHANGE
    /** Replace a quarantined diagram only with verified accepted XML; failed loading retains quarantine. */ // CHANGE
    async function openLatestSavedVersion() { // CHANGE
        const current = file(), generation = contextGeneration, actor = context().userId, original = ui.getFileData(); // CHANGE
        const result = await coordinate({ kind: 'reset-view' }); // CHANGE
        if (!result?.ok || typeof result.xml !== 'string') throw new Error(result?.reason || 'The latest saved version could not be loaded.'); // CHANGE
        if (file() !== current || contextGeneration !== generation || context().userId !== actor) throw new Error('The document or author changed before recovery.'); // CHANGE
        if (!window.LocalFile || !ui.fileLoaded) throw new Error('Saved-version recovery is unavailable. Keep this diagram open and retry.'); // CHANGE
        // Decode every page before replacing the current file, including compressed pages. // CHANGE
        const parsed = window.mxUtils?.parseXml(result.xml); // CHANGE
        if (parsed) { // CHANGE
            if (parsed.getElementsByTagName('parsererror').length || !['mxGraphModel', 'mxfile'].includes(parsed.documentElement.nodeName)) throw new Error('The saved diagram is invalid.'); // CHANGE
            const pages = parsed.documentElement.nodeName === 'mxfile' ? [...parsed.getElementsByTagName('diagram')] : [parsed.documentElement]; // CHANGE
            if (!pages.length) throw new Error('The saved diagram has no pages.'); // CHANGE
            for (const page of pages) { const model = page.nodeName === 'diagram' ? window.Editor.parseDiagramNode(page, true) : page; if (!model?.getElementsByTagName('root').length) throw new Error('A saved diagram page is invalid.'); if (window.mxCodec && window.mxGraphModel) new window.mxCodec(model.ownerDocument).decode(model, new window.mxGraphModel()); } // CHANGE
        } // CHANGE
        const replacement = new window.LocalFile(ui, result.xml, current.getTitle()); replacement.fileObject = current.fileObject; replacement.stat = current.stat; replacement.setModified(false); // CHANGE
        const replace = async () => { try { await ui.fileLoaded(replacement); } catch (error) { if (file() !== current) { try { await ui.fileLoaded(current); ui.setFileData(original); } catch (_) { /* The original error and capture quarantine remain authoritative. */ } } throw error; } }; // CHANGE
        if (editContext?.replaceDocument) await editContext.replaceDocument(replace); else await replace(); // CHANGE
        closeDialog(); status('Latest saved version opened.'); // CHANGE
    } // CHANGE
    function showSavingRecovery(reason) { // CHANGE
        const current = file(), generation = contextGeneration, actor = context().userId, panel = showDialog('Saving is blocked'); // CHANGE
        note(panel, reason); note(panel, 'Discards all unsaved work in this window.'); // CHANGE
        button('Open latest saved version', async () => { if (file() !== current || contextGeneration !== generation || context().userId !== actor) throw new Error('The document or author changed.'); await openLatestSavedVersion(); }, panel, 'danger'); // CHANGE
    } // CHANGE
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
        const frozen = [...(holdEditors?.frozenTargets() || []), ...[...frozenForms].filter(([element]) => element.isConnected && element.dataset.trellisFrozen).flatMap(([, item]) => item.draft.targets)]; // CHANGE
        const active = [...resumingTargets, ...(holdEditors?.activeTargets() || [])]; // CHANGE
        if (frozen.length && cell && affectsTarget(frozen, cell.id, recoveryPage) && !affectsTarget(active, cell.id, recoveryPage)) return true; // CHANGE: close-time handlers cannot submit into a frozen object's live graph.
        if (recoveringTargets.has('*')) return true; // CHANGE
        if (recoveringTargets.size) for (let cursor = cell; cursor; cursor = graph.getModel?.().getParent(cursor)) if (recoveringTargets.has(JSON.stringify([recoveryPage, String(cursor.id)]))) return true; // CHANGE: an empty recovery index cannot match any ancestor.
        if (!explicitMode || !isCollaborative() || !cell) return false;
        if (!viewIdentity) return true; // NEW: loading/recovery cannot expose editing against an unknown remembered base.
        const pending = incoming?.getGroups() || [], page = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || '';
        if (pending !== indexedPending) { indexedPending = pending; pendingKeys = new Set(pending.flatMap(group => [...group.keys, ...group.targets])); pendingStructure = pending.some(group => group.structural); } // NEW
        if (refreshingTargets.has('*') || pendingStructure) return true; // CHANGE
        if (!pendingKeys.size && !refreshingTargets.size) return false; // NEW: skip dependency parsing only after frozen, recovery, loading, and structural boundaries have been checked.
        let logical = cell; // NEW: ancestors are not automatically content dependencies; a new sibling must not freeze the entire canvas.
        for (let cursor = cell; cursor; cursor = graph.getModel().getParent(cursor)) if (/(?:^|;)tiler_group=1(?:;|$)/.test(cursor.style || '') || cursor.getAttribute?.('planting_id') || cursor.getAttribute?.('tiler_group') === '1') logical = cursor; // CHANGE
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
        if (state?.policyDelta && Number.isSafeInteger(graph.__trellisSharedPolicy?.policyRevision) && state.policyRevision <= graph.__trellisSharedPolicy.policyRevision) return false; // CHANGE: repeated status snapshots cannot request the predecessor of an already applied delta.
        if (state?.policyDelta && !state.policy) { const previous = graph.__trellisSharedPolicy, delta = state.policyDelta; if (!previous || previous.policyHash !== delta.baseHash) { void coordinate({ kind: 'get' }).catch(error => status(error.message)); return false; } const cells = new Map(previous.cells); for (const key of delta.removed) cells.delete(key); for (const cell of delta.cells) cells.set(cell.key, cell); state = { ...state, policy: { store: delta.store, teams: delta.teams, cells: [...cells.values()] } }; } // CHANGE: a missing predecessor requests a full policy without applying an unbound delta.
        if (!explicitMode || !state?.policy) return;
        if (state.actorUserId && state.actorUserId !== context().userId || state.sessionId && localSessionId && state.sessionId !== localSessionId) return false; // CHANGE
        const previousRevision = graph.__trellisSharedPolicy?.policyRevision; // CHANGE
        if (Number.isSafeInteger(previousRevision) && (!Number.isSafeInteger(state.policyRevision) || state.policyRevision <= previousRevision)) return false; // CHANGE
        const previous = graph.__trellisSharedPolicy?.cells || new Map();
        const cells = new Map([...previous.keys()].map(key => [key, { attributes: {} }]));
        for (const cell of state.policy.cells) cells.set(cell.key, cell);
        graph.__trellisSharedPolicy = { ...state.policy, diagramId: info?.diagramId, policyRevision: state.policyRevision, policyHash: state.policyHash, cells }; // CHANGE
        collaboration = { ...collaboration, policy: state.policy, policyHash: state.policyHash, policyRevision: state.policyRevision }; if (lastStatus) lastStatus.collaboration = collaboration; // CHANGE
        users()?.revalidateCurrentSession?.();
        return true; // CHANGE
    }
    /** Match a lost logical parent without confusing reused IDs on other pages. */ // CHANGE
    function affectsTarget(targets, id, page = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || '') { // CHANGE
        let cell = graph.getModel?.().getCell(id); // CHANGE
        do { if (targets.includes('*') || targets.includes(JSON.stringify([page, String(cell?.id || id)])) || targets.includes(JSON.stringify(['', String(cell?.id || id)]))) return true; cell = cell && graph.getModel().getParent(cell); } while (cell); // CHANGE
        return false; // CHANGE
    } // CHANGE
    /** Only fields bound to a collaboration object are captured; credentials and unrelated dialogs are excluded. */ // CHANGE
    function captureObjectFields(element) { // CHANGE
        return [element, ...element.querySelectorAll('input,textarea,select,[contenteditable="true"]')].filter(field => field.matches('input,textarea,select,[contenteditable="true"]') && !['password', 'file', 'hidden'].includes(field.type) && !/password|\bpin\b|secret|token|credential/i.test(field.name + ' ' + field.id + ' ' + field.autocomplete)).map((field, index) => ({ index, id: field.id, name: field.name, type: field.type || 'rich-text', value: field.value ?? field.innerHTML, checked: !!field.checked })); // CHANGE
    } // CHANGE
    /** Keep the original label node available after mxCellEditor cancels its graph submission. */ // CHANGE
    function freezeLabel(targets, reason) { // CHANGE
        const editor = graph.cellEditor, cell = editor?.editingCell, field = editor?.textarea; // CHANGE
        if (!cell || !field || !affectsTarget(targets, cell.id)) return; // CHANGE
        const registration = labelEditorRegistration, frozen = holdEditors?.recoveryEditors(targets).find(entry => entry.kind === 'label'), pageId = ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || '', draft = { kind: 'label', targets, pageId, objectId: String(cell.id), html: field.innerHTML, text: field.value ?? field.textContent }, bounds = field.getBoundingClientRect(); // CHANGE
        stoppingForSave = true; try { graph.stopEditing?.(true); } finally { stoppingForSave = false; } // CHANGE
        labelEditorRegistration = null; // CHANGE: a future label editor must not dispose or revive this frozen generation.
        const panel = document.createElement('section'), close = document.createElement('button'); // CHANGE
        panel.style.cssText = 'position:fixed;z-index:12001;background:white;border:1px solid #888;padding:10px;max-height:80vh;overflow:auto;min-width:260px;left:' + Math.max(8, bounds.left) + 'px;top:' + Math.max(8, Math.min(bounds.top, window.innerHeight - 200)) + 'px'; // CHANGE
        panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Retained label draft'); field.style.cssText = 'position:static;min-height:50px;white-space:pre-wrap;user-select:text;'; // CHANGE
        close.type = 'button'; close.textContent = 'Close'; close.addEventListener('click', () => { registration?.dispose(); frozenForms.get(panel)?.view?.dispose(); frozenForms.delete(panel); panel.remove(); }); panel.append(field, close); document.body.appendChild(panel); registration?.dispose(); // CHANGE
        const openLabel = retained => { // CHANGE
            const currentCell = resolveEditorCell(JSON.stringify([pageId, String(cell.id)]), true); if (!currentCell) throw new Error('This object was deleted. Your entries remain available for copying.'); // CHANGE
            if (users()?.canEditCell && !users().canEditCell(currentCell)) throw new Error('Your editing access changed.'); // CHANGE
            registration?.dispose(); frozenForms.get(panel)?.view?.dispose(); panel.remove(); frozenForms.delete(panel); graph.startEditingAtCell(currentCell); // CHANGE
            if (retained && graph.cellEditor?.editingCell === currentCell) { graph.cellEditor.textarea.innerHTML = draft.html; labelEditorRegistration?.touch(); } // CHANGE
        }; // CHANGE
        frozenForms.set(panel, { draft, baseline: frozen?.baseline, claimIds: frozen?.claimIds, resume: frozen?.baseline ? () => openLabel(true) : null, reopen: () => openLabel(false), view: window.TrellisEditingHolds?.freezeElement(panel, reason) }); // CHANGE
    } // CHANGE
    /** Freeze only affected original surfaces. Their adapters guard programmatic commits as well as UI events. */ // CHANGE
    function rejectDialogs(targets, reason) { // CHANGE
        if (!targets?.length) return; // CHANGE
        holdEditors?.freeze(targets, reason); // CHANGE
        for (const item of graph.__trellisObjectDetails?.freezeHolds?.(targets, reason) || []) if (!frozenForms.has(item.element)) frozenForms.set(item.element, { draft: item.draft, view: window.TrellisEditingHolds?.freezeElement(item.element, reason) }); // CHANGE
        freezeLabel(targets, reason); // CHANGE
        for (const binding of document.querySelectorAll('[data-collaboration-object-id],[data-spacing-row-cell]')) { // CHANGE
            if (!affectsTarget(targets, binding.dataset.collaborationObjectId || binding.dataset.spacingRowCell)) continue; // CHANGE
            const form = binding.closest('[role="dialog"],.geDialog,.usl-scheduler-dialog') || binding; // CHANGE
            if (form.querySelector('[data-trellis-collaborative-editor]') || form.matches('[data-trellis-collaborative-editor]') || frozenForms.has(form) || form.closest('[data-trellis-frozen]')) continue; // CHANGE
            const draft = { kind: 'object-form', targets: [...targets], objectId: binding.dataset.collaborationObjectId || binding.dataset.spacingRowCell, fields: captureObjectFields(form) }; // CHANGE
            frozenForms.set(form, { draft, view: window.TrellisEditingHolds?.freezeElement(form, reason) }); // CHANGE
        } // CHANGE
        if (formTargets.some(key => targets.includes(key)) || targets.includes('*')) { editingForm = null; formTargets = []; window.clearTimeout(formActivityTimer); } // CHANGE
        status(reason, () => focusResolution(editingResolutions.get(resolutionKey(targets)))); // CHANGE
    } // CHANGE
    function preservationStatus(targets, saved, error, retry) { // CHANGE
        holdEditors?.preservation(targets, saved, error, retry); // CHANGE
        for (const item of frozenForms.values()) if (item.draft.targets.some(key => targets.includes(key) || key === '*' || targets.includes('*'))) item.view?.update(saved, error, retry);
        const resolution = editingResolutions.get(resolutionKey(targets)); if (resolution) { resolution.saved = saved; if (error) resolution.error = error; renderResolution(resolution); } // CHANGE // CHANGE
    } // CHANGE
    /** Capture once and start private preservation while the originating author and original controls still exist. */ // CHANGE
    function stageLostDraft(targets, reason) { // CHANGE
        const generation = contextGeneration, expectedUserId = context().userId, current = file(), lossKey = resolutionKey(targets); // CHANGE
        let resolution = editingResolutions.get(lossKey); // CHANGE
        if (!resolution || resolution.finished) { resolution = { key: lossKey, file: current, generation, userId: expectedUserId, shareId: info.shareId, targets: [...targets], reason, code: collaboration?.losses?.find(loss => targets.includes(loss.key))?.code, complete: false }; editingResolutions.set(lossKey, resolution); } // CHANGE
        rejectDialogs(targets, reason); renderResolution(resolution); // CHANGE
        let record = retainedLosses.get(lossKey); // CHANGE
        if (!record && bridge.recoveryAction) { // CHANGE
            const editors = [...(holdEditors?.capture(targets) || []), ...[...frozenForms.values()].map(item => item.draft).filter(draft => draft.targets.some(key => targets.includes(key) || targets.includes('*') || key === '*'))]; // CHANGE
            if (current.isModified() || unsavedActions.length || editors.length) { record = { input: { shareId: info.shareId, expectedUserId, kind: 'retain', lossId: window.crypto.randomUUID(), reason, revision: modelRevision, baseXml: collaborationBaseline || current.data, xml: ui.getFileData(), editorDrafts: editors, ...(graph.__trellisProjectFormat === 2 ? { references: referenceDependencies() } : {}) }, saved: false, at: Date.now() }; retainedLosses.set(lossKey, record); } // CHANGE
        } // CHANGE
        if (bridge.activityAction && !record?.released) { if (record) record.released = true; void coordinate({ kind: 'release', targets }).catch(error => { if (generation === contextGeneration) status('The editor is frozen; releasing its activity report failed: ' + error.message); }); } // CHANGE
        if (!record || record.saved) { if (record?.saved) preservationStatus(targets, true); return { lossKey, preservation: Promise.resolve() }; } // CHANGE
        if (!record.task) { // CHANGE
            const task = Promise.resolve(bridge.recoveryAction(record.input)).then(result => { if (!result?.ok) throw new Error(result?.reason || 'Private preservation failed.'); if (record.discarded) return; record.saved = true; if (generation === contextGeneration) preservationStatus(targets, true); }).catch(error => { if (!record.discarded && generation === contextGeneration) preservationStatus(targets, false, error.message, () => recoverLostHolds(targets, reason).catch(() => {})); throw error; }).finally(() => { if (record.task === task) record.task = null; }); // CHANGE
            record.task = task; // CHANGE
        } // CHANGE
        return { lossKey, preservation: record.task }; // CHANGE
    } // CHANGE
    /** Context teardown hides the previous author's frozen work, without deleting its durable private copy. */ // CHANGE
    function resetFrozenEditors() { // CHANGE
        editingResolutions.clear(); resumingTargets.clear(); // CHANGE
        resetGardenCreations(); // NEW: groups, native-edit identities and private intent cannot cross author/document boundaries.
        activityRevision = -1; lossChecks.clear(); composingFields.clear(); for (const [key, record] of retainedLosses) if (record.saved) retainedLosses.delete(key); // CHANGE
        for (const [element, item] of frozenForms) { item.view?.dispose(); element.remove(); } frozenForms.clear(); // CHANGE
    } // CHANGE
    /** Retry only private persistence for the originating author; never replay an old graph draft into a new context. */ // CHANGE
    async function retryPrivatePreservation() { // CHANGE
        if (!bridge.recoveryAction || !info?.shareId) return; // CHANGE
        const shareId = info.shareId, expectedUserId = context().userId, generation = contextGeneration; // CHANGE
        for (const [key, record] of retainedLosses) if (!record.saved && !record.discarded && record.input.shareId === shareId && record.input.expectedUserId === expectedUserId) { // CHANGE
            try { const result = await bridge.recoveryAction(record.input); if (!result?.ok) throw new Error(result?.reason || 'Private preservation failed.'); record.saved = true; retainedLosses.delete(key); } // CHANGE
            catch (error) { if (generation === contextGeneration) status('A previous private draft remains only in memory. Open Sharing → Recovery copies to copy or export it. ' + error.message); } // CHANGE
        } // CHANGE
    } // CHANGE
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
    window.Trellis.sharing.portableXml = async xml => { if (graph.__trellisProjectFormat !== 2) return xml; const result = await coordinate({ kind: 'portable-export', xml }); if (!result?.ok) throw new Error(result?.reason || 'The portable export could not resolve its definitions.'); return result.xml; }; // CHANGE: a captured local draft can export without accepting a conflict.
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
    /** Activity is always boolean: local persistence holds are inactive once their actual editor completes. */ // CHANGE
    window.Trellis.sharing.automationHolds = () => { // CHANGE
        if (!isCollaborative()) return []; // CHANGE
        const activeTargets = new Set(holdEditors?.activeTargets() || []); // CHANGE
        return (collaboration?.holds || []).map(hold => ({ ...hold, local: hold.sessionId === localSessionId, active: !!(hold.sessionId === localSessionId && (activeTargets.has(hold.key) || editingForm?.isConnected && formTargets.includes(hold.key))) })); // CHANGE: remote holds remain protected independently of their active flag.
    }; // CHANGE
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
        sessionIdentity = nextIdentity; closeObjectPopover(); // CHANGE: actions and private recovery links belong to the previous author.
        invalidateDocumentReady(); // NEW
        const current = file(), previousIdentity = viewIdentity, shareId = info?.shareId, generation = ++contextGeneration; // CHANGE
        const privateDraft = previousIdentity && isCollaborative() && bridge.recoveryAction && (current?.isModified() || holdEditors?.pinnedTargets().length) ? { shareId, kind: 'checkpoint', expectedUserId: previousIdentity, revision: modelRevision, baseXml: collaborationBaseline || current.data, xml: ui.getFileData(), editorDrafts: holdEditors?.capture(['*']) || [] } : null; // NEW
        const privatePreservation = privateDraft ? bridge.recoveryAction(privateDraft) : null; // NEW: capture before disposing the previous author's editor registrations.
        clearSaveStatus(); background?.dispose(); background = null; backgroundFile = null; savedObjects.clear(); dirtyObjects.clear(); // CHANGE
        holdEditors?.reset(); resetFrozenEditors(); localSessionId = null; labelEditorRegistration = null; unsavedActions.length = 0; recoveringTargets.clear(); recoveryQueue = Promise.resolve(); recoveryFailure = null; retryRecovery = null; saveFence = Promise.resolve(); // NEW
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
            const next = { ...lastStatus.collaboration, sessionId: lastStatus.collaboration.sessionId || localSessionId }; // CHANGE
            adoptActivity(next); adoptPolicy(next); if (collaboration) lastStatus.collaboration = collaboration; // CHANGE: policy and activity order independently.
        } // CHANGE
        if (lastStatus && info) importNewHistory().catch(err => status(err.message));
        if (explicitMode && isCollaborative() && viewIdentity && lastStatus?.collaboration?.hash !== pendingHash) readRemote('view').catch(err => status(err.message)); // NEW
        announce();
    });
    ui.editor.addListener('pageSelected', () => { renderBadges(); }); // CHANGE: navigation updates presentation; it is not an authored content revision.
    ui.editor.addListener('fileLoaded', () => { window.TrellisContentPolicy?.resetDocument(); contextGeneration++; modelRevision++; holdEditors?.reset(); resetFrozenEditors(); localSessionId = null; labelEditorRegistration = null; unsavedActions.length = 0; recoveringTargets.clear(); recoveryQueue = Promise.resolve(); recoveryFailure = null; retryRecovery = null; saveFence = Promise.resolve(); // CHANGE
         clearSaveStatus(); background?.dispose(); background = null; backgroundFile = null; savedObjects.clear(); dirtyObjects.clear(); conflictDialog?.remove(); conflictDialog = null; // CHANGE
         invalidateDocumentReady(); classifiedFile = null; // CHANGE
         delete graph.__trellisSharedPolicy; remoteReadTask = null; window.clearTimeout(formActivityTimer); closeDialog(); acquiring = false; pendingEdits = []; acquisitionObjects.clear(); info = null; collaborationBaseline = null; observedXml = null; localSessionId = null; collaboration = null; viewIdentity = null; pendingHash = null; incoming?.reset(); refreshingTargets.clear(); formTargets = []; closeObjectPopover(); localRecovery = null; remoteBaselinePending = false; queuedHistory.clear(); publishedIds.clear(); installFileHooks(); refresh(); }); // CHANGE
    installFileHooks();
    refresh();
    if (window.CustomEvent) window.dispatchEvent(new window.CustomEvent('trellisGardenToolsReady')); // NEW: notify document startup after installing this tool's API.
});
