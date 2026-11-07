/** Explicit comment commands and private drafts. The host owns graph lifecycle and canonical transactions. */ // CHANGE
(function (root) { // CHANGE
    'use strict'; // CHANGE
    const privateDrafts = new Map(); // CHANGE: retain session drafts when local storage is unavailable or a panel is removed.
    const pendingByGraph = new WeakMap(); // NEW: a submitted command outlives the panel that started it.
    const saveContext = graph => graph.__trellisSharing?.commentSaveContext?.() ?? null; // NEW
    const pendingKey = (graph, identity) => JSON.stringify([saveContext(graph), identity.key]); // NEW
    const hasPendingAction = (graph, identity) => !!pendingByGraph.get(graph)?.has(pendingKey(graph, identity)); // NEW

    function reconcileSaved(graph) { // NEW
        const operations = pendingByGraph.get(graph); // NEW
        if (operations) for (const operation of operations.values()) { // NEW
            try { operation.reconcile(operation.running); } catch (error) { operation.error = error.message; } // NEW: an unreadable saved view must not interrupt save completion.
        } // NEW
    } // NEW

    function mount(options) { // CHANGE
        const { entry, toolbar, core } = options, userId = entry.user; // CHANGE
        const storageKey = 'trellis.comments.draft.v1:' + options.identity.key; // CHANGE
        let operations = pendingByGraph.get(options.graph); // NEW
        if (!operations) { operations = new Map(); pendingByGraph.set(options.graph, operations); } // NEW
        const sharing = () => options.graph.__trellisSharing; // NEW
        const operationKey = () => pendingKey(options.graph, options.identity); // NEW
        const pendingAction = () => operations.get(operationKey()); // NEW
        let destroyed = false, frozen = false, discarded = false, composing = false, pending = false, unresolvedExpanded = true, resolvedExpanded = false, retentionTimer = null, fingerprint = '', storageError = '', commandError = ''; // CHANGE
        let saved = privateDrafts.get(storageKey), loadedDraft; // CHANGE
        if (!saved) { // CHANGE
            saved = { active: 'new', drafts: {} }; // CHANGE
            if (options.identity.persistent) try { // CHANGE
                const value = JSON.parse(root.localStorage.getItem(storageKey)); // CHANGE
                if (value && typeof value.active === 'string' && value.drafts && typeof value.drafts === 'object' && !Array.isArray(value.drafts)) saved = value; // CHANGE
            } catch (_) { storageError = 'Private draft storage is unavailable; drafts remain in this session.'; } // CHANGE
            privateDrafts.set(storageKey, saved); // CHANGE
        } // CHANGE
        const container = document.createElement('div'); container.className = 'trellis-details-comments'; // CHANGE
        container.classList.add('trellis-surfaces'); container.dataset.trellisSurface = 'canvas'; // NEW: comments share their host panel's light surface hierarchy.
        container.style.cssText = 'flex:1;min-height:0;overflow:auto;padding:6px;box-sizing:border-box;'; // CHANGE
        const list = document.createElement('div'), composer = document.createElement('div'), heading = document.createElement('div'); // CHANGE
        composer.style.cssText = 'border-top:1px solid #e2e8f0;margin-top:6px;padding-top:6px;'; // CHANGE
        composer.dataset.trellisSurface = 'inset'; composer.style.borderTop = ''; // NEW: private drafts sit inside the comments canvas.
        const editor = document.createElement('div'); editor.className = 'trellis-object-details-editor trellis-comment-editor'; editor.tabIndex = 0; // CHANGE
        const alertLabel = document.createElement('label'), alertToggle = document.createElement('input'); alertToggle.type = 'checkbox'; alertToggle.dataset.commentAlert = 'true'; alertLabel.append(alertToggle, document.createTextNode('Mark as alert')); // CHANGE
        alertLabel.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;margin-top:4px;'; // CHANGE
        editor.setAttribute('role', 'textbox'); editor.setAttribute('aria-multiline', 'true'); editor.setAttribute('aria-label', 'Comment for ' + options.title); // CHANGE
        editor.style.cssText = 'min-height:44px;max-height:160px;overflow:auto;overflow-wrap:anywhere;outline:none;padding:5px;border:1px solid #cbd5e1;'; // CHANGE
        const message = document.createElement('div'); message.setAttribute('role', 'status'); message.setAttribute('aria-live', 'polite'); message.style.cssText = 'font-size:11px;color:#64748b;padding:3px 0;'; // CHANGE
        const actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;'; // CHANGE
        const submit = options.button('Post', 'Post comment', () => submitDraft()); submit.dataset.commentAction = 'submit'; // CHANGE
        const discard = options.button('Discard', 'Discard this private draft', () => { delete saved.drafts[saved.active]; saved.active = 'new'; commandError = ''; loadDraft(); persist(); refresh(); }); // CHANGE
        discard.dataset.commentAction = 'discard'; actions.append(submit, discard); // CHANGE
        const newComment = options.button('New comment', 'Keep this edit draft and compose a new comment', () => { capture(); saved.active = 'new'; loadDraft(); persist(); refresh(); editor.focus(); }); // CHANGE
        const copy = options.button('Copy', 'Copy this private draft', () => { // CHANGE
            const selection = root.getSelection(), range = document.createRange(); range.selectNodeContents(editor); selection.removeAllRanges(); selection.addRange(range); // CHANGE
            if (!document.execCommand('copy')) { commandError = 'Select the draft and press Ctrl+C to copy it.'; updateMessage(); } // CHANGE
        }); // CHANGE
        const retry = options.button('Retry save', 'Save the pending comment change', () => { const operation = pendingAction(); if (operation) void run(operation); }); // NEW
        retry.dataset.commentAction = 'retry-save'; actions.append(retry); // NEW
        const reload = options.button('Reload comment', 'Replace this edit draft with the current saved comment after confirmation', () => { // CHANGE
            try { // CHANGE
                const item = core.parseComments(options.read()).find(value => value.id === draft().id); // CHANGE
                if (!item) throw new Error('The original comment is no longer available. Copy or discard your draft.'); // CHANGE
                if (!root.confirm('Replace your private edit draft with the saved comment? Copy your draft first if you want to keep it.')) return; // CHANGE
                saved.drafts[saved.active] = { id: item.id, html: item.html, isAlert: item.isAlert, baseline: JSON.stringify(item) }; commandError = ''; loadDraft(); persist(); refresh(); // CHANGE
            } catch (error) { commandError = error.message; updateMessage(); } // CHANGE
        }); // CHANGE
        reload.dataset.commentAction = 'reload'; actions.append(newComment, copy, reload); composer.append(heading, editor, alertLabel, actions); container.append(list, composer, message); // CHANGE

        function actor() { // CHANGE
            const policy = options.users(), user = policy && policy.getCurrentUser && policy.getCurrentUser(); // CHANGE
            return { enabled: !!(policy && policy.isEnabled && policy.isEnabled()), user, editable: options.canEdit(), ownerUserId: policy && policy.getAccessSummary ? policy.getAccessSummary(entry.cell).ownerUserId : '' }; // CHANGE
        } // CHANGE
        function canAct() { const value = actor(); return !frozen && !destroyed && value.enabled && value.editable && value.user && value.user.id === userId; } // NEW
        function editable() { return canAct() && !pending && !pendingAction(); } // CHANGE
        function draft() { // CHANGE
            let value = saved.drafts[saved.active]; // CHANGE
            if (!value || typeof value.html !== 'string' || typeof value.id !== 'string') value = saved.drafts[saved.active] = { id: root.crypto.randomUUID(), html: '', isAlert: entry.activeTab === 'alerts', baseline: null }; // CHANGE
            if (typeof value.isAlert !== 'boolean') value.isAlert = false; // CHANGE: legacy private drafts are ordinary comments.
            return value; // CHANGE
        } // CHANGE
        function loadDraft() { loadedDraft = draft(); editor.innerHTML = core.normalizeHtml(loadedDraft.html); alertToggle.checked = loadedDraft.isAlert; } // CHANGE
        function capture() { if (loadedDraft !== saved.drafts[saved.active]) return; if (!composing) loadedDraft.html = core.normalizeHtml(editor.innerHTML); loadedDraft.isAlert = alertToggle.checked; } // CHANGE: a detached panel cannot restore text cleared by a save.
        function persist() { // CHANGE
            privateDrafts.set(storageKey, saved); // CHANGE
            if (!options.identity.persistent) { storageError = 'This diagram has no stable identity; private drafts remain in this session.'; return; } // CHANGE
            try { root.localStorage.setItem(storageKey, JSON.stringify(saved)); storageError = ''; } // CHANGE
            catch (_) { storageError = 'Private draft storage is unavailable; drafts remain in this session.'; } // CHANGE
            updateMessage(); // CHANGE
        } // CHANGE
        function updateMessage() { // CHANGE
            const value = actor(); // CHANGE
            const operation = pendingAction(); // NEW
            message.textContent = [commandError, storageError, pending || operation?.running ? 'Saving comment…' : operation ? 'Comment change unsaved. ' + operation.error : !value.enabled ? 'Enable Trellis users and log in to post or manage comments.' : !value.user ? 'Log in to post or manage comments.' : !value.editable ? 'Comments are read only.' : 'Drafts are private. Use Post or Save changes to publish.'].filter(Boolean).join(' '); // CHANGE
        } // CHANGE
        function rememberInput() { // CHANGE
            if (!editable()) return; capture(); persist(); entry.editHold?.touch(); submit.disabled = composing || !core.normalizeHtml(editor.innerHTML); // CHANGE
        } // CHANGE
        alertToggle.addEventListener('change', () => { if (!editable()) { alertToggle.checked = draft().isAlert; return; } draft().alertChosen = true; capture(); persist(); }); // CHANGE: checkbox choices stay device-local until explicit submission.
        const target = toolbar.createTarget({ cell: entry.cell, element: editor, canEdit: editable, changed: rememberInput }); // CHANGE
        editor.addEventListener('focus', () => { if (editable()) toolbar.activate(target); else toolbar.deactivate(); }); // CHANGE
        editor.addEventListener('input', rememberInput); // CHANGE
        editor.addEventListener('compositionstart', () => { composing = true; submit.disabled = true; }); // CHANGE
        editor.addEventListener('compositionend', () => { composing = false; rememberInput(); }); // CHANGE
        editor.addEventListener('blur', () => { target.saveSelection(); capture(); persist(); }); // CHANGE
        editor.addEventListener('drop', event => event.preventDefault()); // CHANGE
        editor.addEventListener('paste', event => { // CHANGE
            event.preventDefault(); if (!editable()) return; target.saveSelection(); // CHANGE
            const clipboard = event.clipboardData, plain = document.createElement('div'); plain.textContent = clipboard && clipboard.getData('text/plain') || ''; // CHANGE
            target.execute('insertHTML', core.normalizeHtml(clipboard && clipboard.getData('text/html') || plain.innerHTML.replace(/\r?\n/g, '<br>'))); // CHANGE
        }); // CHANGE
        editor.addEventListener('keydown', event => { // CHANGE
            if (event.key === 'Escape') { event.preventDefault(); capture(); persist(); toolbar.deactivate(); options.graph.container.focus(); return; } // CHANGE
            if (!(event.ctrlKey || event.metaKey) || event.altKey) return; // CHANGE
            const key = event.key.toLowerCase(); // CHANGE
            if (key === 's') { event.preventDefault(); capture(); persist(); if (options.flush()) { const action = options.ui.actions.get(event.shiftKey ? 'saveAs' : 'save'); if (action) action.funct(); } return; } // CHANGE
            const command = { b: 'bold', i: 'italic', u: 'underline', z: event.shiftKey ? 'redo' : 'undo', y: 'redo' }[key]; // CHANGE
            if (command) { event.preventDefault(); target.saveSelection(); target.execute(command); } // CHANGE
        }); // CHANGE

        function finishDraft(action, submittedDraft, submittedState, active) { // NEW
            if (submittedDraft && submittedState.drafts[active] === submittedDraft && submittedDraft.html === action.html && submittedDraft.isAlert === action.isAlert) { // NEW
                delete submittedState.drafts[active]; if (submittedState.active === active) submittedState.active = 'new'; // NEW
                if (privateDrafts.get(storageKey) === submittedState) persist(); // NEW
            } // NEW
        } // NEW

        function savedDiscussion() { return sharing().savedDiscussion(entry.page, entry.cell.id); } // NEW

        /** Retry a staged change by saving its current revision. Apply a command only on the first attempt. */ // NEW
        async function run(operation, action) { // NEW
            if (operation.running || !canAct()) return false; // NEW
            operation.running = true; operation.error = ''; commandError = ''; // NEW
            try { // NEW
                refresh(); // NEW
                if (entry.editHold) await entry.editHold.acquire(); // NEW
                if (!canAct() || operation.key !== operationKey()) throw new Error('The comment editor changed before editing could begin.'); // NEW
                operation.hold = entry.editHold; // NEW
                const before = options.read(); // NEW
                if (action) { // NEW
                    const accepted = savedDiscussion(); // NEW
                    if (accepted === undefined) throw new Error('The saved discussion is still loading. Try again when the garden is ready.'); // NEW
                    if (before !== (accepted ?? '')) { // NEW
                        operation.expected = before; operation.acceptDraft = null; // NEW: recovered edits or undo may already have changed the discussion.
                        throw new Error('Save the earlier change before changing this discussion again.'); // NEW
                    } // NEW
                    const next = core.changeComments(before, action, actor()); // NEW
                    if (before === next) { operation.finish(); return true; } // NEW
                    options.write(next); operation.expected = next; // NEW
                } else if (before !== operation.expected) { // NEW
                    throw new Error('The pending comment change was replaced.'); // NEW
                } // NEW
                await sharing().settleObjectEdits(); // NEW: explicit save uses the existing queue without the quiet countdown.
                if (operation.reconcile()) return true; // NEW
                throw new Error('The save did not accept this comment change.'); // NEW
            } catch (error) { // NEW
                if (operation.accepted && operation.key === operationKey()) { operation.finish(); return true; } // NEW: an earlier completed save may have covered this action.
                if (operation.key !== operationKey() || operation.expected === undefined) { // NEW
                    operations.delete(operation.key); commandError = error.message; // NEW
                } else { operation.error = error.message; } // NEW
                return false; // NEW
            } finally { // NEW
                operation.running = false; if (!destroyed) refresh(); options.changed(); // NEW
            } // NEW
        } // NEW

        async function execute(action, submittedDraft) { // CHANGE
            if (!editable() || composing) return false; // CHANGE
            const active = saved.active, submittedState = saved; // NEW
            const acceptDraft = () => finishDraft(action, submittedDraft, submittedState, active); // NEW
            if (saveContext(options.graph) !== null) { // NEW
                const key = operationKey(), operation = { key, acceptDraft, submittedDraft, active, running: false, expected: undefined, error: '' }; // NEW
                operation.finish = () => { operations.delete(key); operation.acceptDraft?.(); if (!destroyed && options.isCurrent()) loadDraft(); operation.hold?.complete?.(); options.changed(); }; // NEW
                operation.reconcile = defer => { // NEW
                    if (key !== operationKey()) { operations.delete(key); return false; } // NEW
                    if (!operation.accepted && operation.expected !== undefined) operation.accepted = savedDiscussion() === operation.expected; // NEW
                    if (!operation.accepted) return false; // NEW
                    if (!defer) operation.finish(); // NEW
                    return true; // NEW
                }; // NEW
                operations.set(key, operation); // NEW
                return run(operation, action); // NEW
            } // NEW
            pending = true; commandError = ''; refresh(); // CHANGE
            try { // CHANGE
                if (entry.editHold) await entry.editHold.acquire(); // CHANGE
                if (!canAct()) throw new Error('The comment editor changed before editing could begin.'); // NEW
                const before = options.read(), next = core.changeComments(before, action, actor()); // CHANGE
                if (before !== next) options.write(next); // CHANGE
                const legacySharing = sharing(); // NEW
                if (!legacySharing?.commentSaveContext && legacySharing?.settleObjectEdits) await legacySharing.settleObjectEdits(); // CHANGE: preserve the legacy integration without saving standalone files.
                if (options.read() !== next) throw new Error('The comment change was rejected or replaced.'); // CHANGE
                acceptDraft(); entry.editHold?.complete?.(); return true; // CHANGE
            } catch (error) { commandError = error.message + (submittedDraft ? ' Your draft is retained.' : ''); return false; } // CHANGE
            finally { pending = false; if (!destroyed) refresh(); options.changed(); } // CHANGE
        } // CHANGE
        function submitDraft() { // CHANGE
            if (!editable() || composing) return false; capture(); persist(); const value = draft(); // CHANGE
            if (!value.html) return true; // CHANGE
            return execute({ type: saved.active === 'new' ? 'post' : 'edit', id: value.id, html: value.html, isAlert: value.isAlert, baseline: value.baseline }, value); // CHANGE
        } // CHANGE
        function startEdit(item) { // CHANGE
            if (!editable()) return; capture(); saved.active = 'edit:' + item.id; // CHANGE
            if (!saved.drafts[saved.active]) saved.drafts[saved.active] = { id: item.id, html: item.html, isAlert: item.isAlert, baseline: JSON.stringify(item) }; // CHANGE
            loadDraft(); persist(); refresh(); editor.focus(); // CHANGE
        } // CHANGE
        function actionButton(parent, label, type, item, disabled = false, tooltip = label) { // CHANGE
            const button = options.button(label, tooltip, () => { // CHANGE
                if (type === 'edit') startEdit(item); // CHANGE
                else if (type !== 'delete' || root.confirm('Delete this resolved comment? This removes it from the diagram.')) execute({ type, id: item.id, baseline: JSON.stringify(item) }); // CHANGE
            }); // CHANGE
            button.dataset.commentAction = type; button.disabled = disabled || !editable(); parent.appendChild(button); // CHANGE
        } // CHANGE
        function renderComment(item, currentActor) { // CHANGE
            const article = document.createElement('article'); article.dataset.commentId = item.id; article.style.cssText = 'padding:6px 0;border-bottom:1px solid #e2e8f0;'; // CHANGE
            article.dataset.trellisSurface = 'entry'; // NEW: posted comments remain compact, without extra elevation.
            const meta = document.createElement('div'); meta.style.cssText = 'font-size:10px;color:#64748b;'; // CHANGE
            meta.textContent = item.authorName + ' · ' + new Date(item.createdAt).toLocaleString() + (item.updatedAt !== item.createdAt ? ' · edited' : ''); // CHANGE
            if (item.isAlert) { const flag = document.createElement('strong'); flag.textContent = ' · Alert'; flag.style.color = '#b91c1c'; meta.appendChild(flag); } // CHANGE
            const body = document.createElement('div'); body.className = 'trellis-comment-body trellis-object-details-editor'; body.style.overflowWrap = 'anywhere'; body.innerHTML = core.normalizeHtml(item.html); // CHANGE
            body.tabIndex = 0; body.addEventListener('focus', () => toolbar.deactivate()); body.addEventListener('pointerdown', () => toolbar.deactivate()); // CHANGE: selecting posted text must not format the private composer through a stale toolbar target.
            article.append(meta, body); // CHANGE
            if (item.resolvedAt !== null) { // CHANGE
                const resolution = document.createElement('div'); resolution.style.cssText = 'font-size:10px;color:#64748b;'; // CHANGE
                resolution.textContent = 'Resolved by ' + item.resolvedByName + ' · ' + new Date(item.resolvedAt).toLocaleString() + ' · Deletion available ' + new Date(item.resolvedAt + core.COMMENT_RETENTION_MS).toLocaleString(); article.appendChild(resolution); // CHANGE
            } // CHANGE
            const controls = document.createElement('div'); controls.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin-top:3px;'; // CHANGE
            const user = currentActor.user, author = user && user.id === item.authorUserId, moderator = user && (author || user.admin || user.id === currentActor.ownerUserId); // CHANGE
            if (author) actionButton(controls, 'Edit', 'edit', item); // CHANGE
            if (moderator) { // CHANGE
                actionButton(controls, item.isAlert ? 'Remove alert' : 'Mark as alert', item.isAlert ? 'removeAlert' : 'markAlert', item); // CHANGE
                actionButton(controls, item.resolvedAt === null ? 'Resolve' : 'Reopen', item.resolvedAt === null ? 'resolve' : 'reopen', item); // CHANGE
                if (item.resolvedAt !== null) actionButton(controls, 'Delete', 'delete', item, Date.now() - item.resolvedAt < core.COMMENT_RETENTION_MS, 'Delete after 30 continuous days resolved'); // CHANGE
            } // CHANGE
            article.appendChild(controls); return article; // CHANGE
        } // CHANGE
        function renderSection(label, records, open, currentActor) { // CHANGE
            const section = document.createElement('details'), summary = document.createElement('summary'); section.open = open; section.dataset.commentSection = label.toLowerCase(); // CHANGE
            section.dataset.trellisSurface = 'section'; summary.dataset.trellisSurface = 'header'; // NEW: resolved and unresolved groups keep native disclosure behavior.
            summary.textContent = label + ' (' + records.length + ')'; summary.style.cursor = 'pointer'; section.appendChild(summary); // CHANGE
            section.addEventListener('toggle', () => { if (section.isConnected) { if (label === 'Resolved') resolvedExpanded = section.open; else unresolvedExpanded = section.open; } }); // CHANGE
            for (const item of records) section.appendChild(renderComment(item, currentActor)); // CHANGE
            if (!records.length) { const empty = document.createElement('div'); empty.textContent = 'No ' + label.toLowerCase() + (entry.activeTab === 'alerts' ? ' alerts.' : ' comments.'); empty.style.cssText = 'font-size:11px;color:#64748b;padding:4px 0;'; section.appendChild(empty); } // CHANGE
            return section; // CHANGE
        } // CHANGE
        function refresh() { // CHANGE
            if (destroyed) return; const currentActor = actor(); let records = [], error = ''; // CHANGE
            let operation = pendingAction(); // NEW
            if (operation && !operation.running && operation.expected !== undefined && options.isCurrent() && options.read() !== operation.expected) { // NEW
                operations.delete(operation.key); commandError = [operation.error, 'The pending comment change was replaced.'].filter(Boolean).join(' '); operation = null; // NEW: recovery or undo superseded the staged change.
            } // NEW
            if (loadedDraft !== saved.drafts[saved.active]) loadDraft(); // NEW: an accepted draft may have been cleared by another mount.
            try { records = core.parseComments(options.read()); } catch (failure) { error = failure.message; } // CHANGE
            if (entry.activeTab === 'alerts') records = records.filter(item => item.isAlert); // CHANGE: both tabs read the same canonical records and share one composer.
            const signature = JSON.stringify([options.read(), entry.activeTab, currentActor, pending || !!operation, records.map(item => item.resolvedAt !== null && Date.now() - item.resolvedAt >= core.COMMENT_RETENTION_MS)]); // CHANGE
            if (signature !== fingerprint) { // CHANGE
                fingerprint = signature; list.replaceChildren(); // CHANGE
                records.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)); // CHANGE
                if (error) { const notice = document.createElement('div'); notice.setAttribute('role', 'alert'); notice.textContent = error + ' Comments have been preserved unchanged.'; list.appendChild(notice); } // CHANGE
                else list.append(renderSection('Unresolved', records.filter(item => item.resolvedAt === null), unresolvedExpanded, currentActor), renderSection('Resolved', records.filter(item => item.resolvedAt !== null), resolvedExpanded, currentActor)); // CHANGE
            } // CHANGE
            if (retentionTimer !== null) root.clearTimeout(retentionTimer); retentionTimer = null; // CHANGE
            const futureEligibility = records.filter(item => item.resolvedAt !== null).map(item => item.resolvedAt + core.COMMENT_RETENTION_MS).filter(time => time > Date.now()); // CHANGE
            if (futureEligibility.length) retentionTimer = root.setTimeout(refresh, Math.min(2147483647, Math.max(1, Math.min(...futureEligibility) - Date.now()))); // CHANGE: enable Delete at the boundary even if no graph event occurs; long waits respect the browser timer limit.
            editor.contentEditable = String(!!editable() && !error); submit.disabled = !editable() || !!error || composing || !core.normalizeHtml(editor.innerHTML); // CHANGE
            const value = draft(); if (saved.active === 'new' && !value.html && !value.alertChosen && !composing && !pending) alertToggle.checked = value.isAlert = entry.activeTab === 'alerts'; // CHANGE: only untouched empty composers adopt a tab's default.
            alertToggle.disabled = !editable() || !!error; // CHANGE
            discard.disabled = pending || !!operation; newComment.disabled = discard.disabled; newComment.hidden = saved.active === 'new'; reload.hidden = saved.active === 'new'; reload.disabled = !editable(); // CHANGE
            retry.hidden = !operation || operation.running || operation.expected === undefined; retry.disabled = retry.hidden || !canAct(); // NEW
            submit.textContent = saved.active === 'new' ? 'Post' : 'Save changes'; heading.textContent = saved.active === 'new' ? 'New comment' : 'Edit comment'; // CHANGE
            updateMessage(); // CHANGE
        } // CHANGE
        loadDraft(); refresh(); // CHANGE
        const hasDraft = () => !!core.normalizeHtml(editor.innerHTML) || Object.values(saved.drafts).some(value => value && (value.html || value.alertChosen)); // CHANGE
        function hasUnsubmittedDraft() { // NEW
            const submitted = pendingAction()?.submittedDraft; // NEW
            return submitted ? Object.values(saved.drafts).some(value => value && value !== submitted && (value.html || value.alertChosen)) : hasDraft(); // NEW
        } // NEW
        function restore(value) { // NEW
            const restored = value ? JSON.parse(JSON.stringify(value)) : { active: 'new', drafts: {} }; // NEW
            const operation = pendingAction(); // NEW
            if (operation?.submittedDraft) { // NEW: restoring other edits must retain the submitted draft until its save is accepted.
                restored.drafts[operation.active] = operation.submittedDraft; Object.assign(saved, restored); // NEW
            } else saved = restored; // NEW
            loadDraft(); persist(); refresh(); // NEW
        } // NEW
        return { element: container, submit: submitDraft, restore, refresh, focus: () => editor.focus(), hasDraft, hasUnsubmittedDraft, hasPendingAction: () => !!pendingAction(), needsUnloadWarning: () => hasDraft() && (!!storageError || composing), // CHANGE
            snapshot() { capture(); return JSON.parse(JSON.stringify(saved)); }, resume() { if (pending) throw new Error('Wait for the previous comment operation to finish before resuming.'); frozen = false; refresh(); }, freeze() { frozen = true; capture(); persist(); editor.contentEditable = 'false'; }, // CHANGE
            discard() { discarded = true; saved = { active: 'new', drafts: {} }; editor.innerHTML = ''; privateDrafts.delete(storageKey); if (options.identity.persistent) root.localStorage.removeItem(storageKey); }, // NEW: explicit hold rejection discards unapplied entries rather than retaining them on close.
            persist() { capture(); persist(); }, // CHANGE
            destroy() { if (!discarded) { capture(); persist(); } destroyed = true; if (retentionTimer !== null) root.clearTimeout(retentionTimer); if (options.ui.getActiveRichTextTarget() === target) toolbar.deactivate(); target.dispose(); } }; // CHANGE
    } // CHANGE
    /** Discover private work when reselecting an object with no posted content, without adding diagram metadata. */ // CHANGE
    function hasDraft(identity) { // CHANGE
        const key = 'trellis.comments.draft.v1:' + identity.key; let value = privateDrafts.get(key); // CHANGE
        if (!value && identity.persistent) try { value = JSON.parse(root.localStorage.getItem(key)); } catch (_) { /* Session drafts are still discoverable. */ } // CHANGE
        return !!(value && value.drafts && Object.values(value.drafts).some(item => item && typeof item.html === 'string' && (item.html || item.alertChosen))); // CHANGE
    } // CHANGE
    root.TrellisDetailsComments = Object.freeze({ mount, hasDraft, hasPendingAction, reconcileSaved }); // CHANGE
})(globalThis); // CHANGE
