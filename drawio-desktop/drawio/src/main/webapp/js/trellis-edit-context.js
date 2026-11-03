/** Explicit, synchronous edit provenance and conservative automation preflight. // NEW
 * Context is captured on each model change, not on the whole transaction: a manual
 * schedule edit may contain generated tasks and presentation-only layout changes.
 * This is activity/attribution metadata, never permission or commit authority.
 */
(function (root) {
    'use strict';
    const metadata = new Set(['createdAt', 'lastEditedAt', 'createdByUserId', 'lastEditedByUserId', 'trellis_actor_name', 'trellis_actor_role', 'trellis_starter_attribution_pending']); // CHANGE: starter badge eligibility is metadata, not a content edit.
    const kinds = new Set(['manual', 'generated-content', 'derived-presentation', 'attribution']); // NEW
    function valueContent(value) { // NEW: compare XML without attribution, independent of attribute ordering.
        if (!value?.nodeType) return String(value ?? '');
        const attrs = Array.from(value.attributes || []).filter(attr => !metadata.has(attr.name)).map(attr => [attr.name, attr.value]).sort((a, b) => a[0].localeCompare(b[0]));
        return JSON.stringify([value.nodeName, attrs, Array.from(value.childNodes || []).map(child => new root.XMLSerializer().serializeToString(child))]); // CHANGE
    }
    function kindOf(change) { return change?.__trellisOperation?.kind || 'manual'; } // NEW
    function isContentChange(change) { // NEW: unchanged writes and metadata must not advance attribution.
        if (!change || change.__trellisUsersActorStamp || ['derived-presentation', 'attribution'].includes(kindOf(change))) return false;
        const name = change.constructor?.name, cell = change.cell || change.child;
        if (!cell) return false;
        if (name === 'mxCellAttributeChange') return !metadata.has(change.attribute) && String(change.previous ?? '') !== String(cell.getAttribute?.(change.attribute) ?? '');
        if (name === 'mxValueChange') return valueContent(change.previous) !== valueContent(cell.value);
        if (name === 'mxStyleChange') return change.previous !== cell.style;
        if (name === 'mxGeometryChange') return JSON.stringify(change.previous) !== JSON.stringify(cell.geometry);
        return ['mxChildChange', 'mxTerminalChange', 'mxCollapseChange', 'mxVisibleChange'].includes(name);
    }
    function install(ui) { // NEW
        const graph = ui.editor.graph, model = graph.getModel();
        if (graph.__trellisEditContext) return graph.__trellisEditContext;
        let active = null, notice = null, sequence = 0;
        const deferred = new Map();
        let committing = null, captureFailure = null; // CHANGE: one owner protects native edits through rendering and compensation.
        const submissions = new Map(); // CHANGE: repeated submissions share preparation rather than applying twice.
        const defaultWrites = new Map(); let defaultNoticeHost = null; // CHANGE: retain only failed captured defaults; visible retries share one stack.
        /** Defaults are independent, guarded storage commands; successful tasks are never repeated on retry. */ // CHANGE
        function saveDefaults(options) { // CHANGE
            const check = commitGuard(options), key = options.id || 'defaults:' + (++sequence); // CHANGE
            const predecessor = defaultWrites.get(key)?.pending; // CHANGE: a newer write waits for an already-started older write, so completion order cannot regress defaults.
            defaultWrites.get(key)?.notice?.remove(); // CHANGE
            const record = { remaining: (options.tasks || []).slice(), completed: [], pending: null, check }; defaultWrites.set(key, record); // CHANGE
            function notify(result) { // CHANGE
                if (!options.notify || defaultWrites.get(key) !== record || !root.document) return; // CHANGE
                record.notice?.remove(); record.notice = null; // CHANGE
                try { check(); } catch (_) { return; } // CHANGE: another document or author must never see an obsolete private failure notice.
                if (result.status === 'saved') return; // CHANGE
                const notice = root.document.createElement('section'); notice.dataset.trellisDefaultRetry = key; notice.setAttribute('role', 'status'); // CHANGE
                notice.style.cssText = 'max-width:420px;padding:12px;background:#fff4d6;color:#452700;border:1px solid #a65b00;font:13px Arial;white-space:normal'; // CHANGE
                const text = root.document.createElement('span'); text.textContent = (options.title || 'Changes applied') + '. Reusable defaults failed: ' + result.failures.map(item => item.name + ': ' + item.reason).join('; ') + '. '; notice.append(text); // CHANGE
                const retry = root.document.createElement('button'); retry.textContent = 'Retry defaults'; retry.onclick = async () => { retry.disabled = true; await attempt(); }; notice.append(retry); // CHANGE
                if (!defaultNoticeHost?.isConnected) { defaultNoticeHost = root.document.createElement('div'); defaultNoticeHost.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483100;display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow:auto'; root.document.body.append(defaultNoticeHost); } // CHANGE
                for (const type of ['pointerdown', 'mousedown', 'click', 'keydown']) notice.addEventListener(type, event => event.stopPropagation()); // CHANGE
                defaultNoticeHost.append(notice); record.notice = notice; // CHANGE
            } // CHANGE
            function attempt() { // CHANGE
                if (record.pending) return record.pending; // CHANGE
                record.pending = Promise.resolve().then(async () => { // CHANGE
                    if (predecessor) await predecessor.catch(() => {}); // CHANGE
                    const failures = []; // CHANGE
                    const guard = () => { check(); if (defaultWrites.get(key) !== record) throw new Error('These defaults were superseded. Review the current choices before saving again.'); }; // CHANGE
                    for (const task of record.remaining) { // CHANGE
                        try { guard(); await task.save(guard); record.completed.push(task.name); } catch (error) { failures.push({ task, reason: error.message }); } // CHANGE
                    } // CHANGE
                    record.remaining = failures.map(item => item.task); // CHANGE
                    const result = { status: failures.length ? 'failed' : 'saved', completed: record.completed.slice(), failures: failures.map(item => ({ name: item.task.name, reason: item.reason })), retry: attempt }; // CHANGE
                    notify(result); try { check(); if (defaultWrites.get(key) === record) options.onOutcome?.(result); } catch (_) { /* A closed view or status observer cannot undo a completed storage operation. */ } // CHANGE
                    if (!failures.length && defaultWrites.get(key) === record) defaultWrites.delete(key); return result; // CHANGE
                }).finally(() => { record.pending = null; }); // CHANGE
                return record.pending; // CHANGE
            } // CHANGE
            return attempt(); // CHANGE
        } // CHANGE
        function pruneDefaultNotices() { // CHANGE: private failures cannot remain visible after their author or document changes.
            for (const [key, record] of defaultWrites) try { record.check(); } catch (_) { record.notice?.remove(); defaultWrites.delete(key); } // CHANGE
        } // CHANGE
        /** Capture identity and actual source versions before asynchronous preparation. */ // CHANGE
        function commitGuard(options) { // CHANGE
            const document = documentIdentity(), rootCell = model.getRoot(), actor = user()?.id || '', targetPage = page(); // CHANGE
            const cells = (typeof options.cells === 'function' ? options.cells() : options.cells || []).filter(Boolean); // CHANGE
            const version = cell => JSON.stringify([valueContent(cell.value), cell.geometry, cell.style, (cell.children || []).map(child => child.id)]); // CHANGE: attribute changes mutate XML in place; object identity alone is insufficient.
            const versions = cells.map(cell => [cell, version(cell), model.getParent(cell)]); // CHANGE
            return () => { // CHANGE
                if (document !== documentIdentity() || rootCell !== model.getRoot() || actor !== (user()?.id || '') || targetPage !== page() || options.isCurrent && !options.isCurrent() || versions.some(([cell, value, parent]) => model.getCell(cell.id) !== cell || version(cell) !== value || model.getParent(cell) !== parent)) { // CHANGE
                    const error = new Error('The editor, source object, document or user changed. Review the current draft and try again.'); error.code = 'TRELLIS_EDIT_STALE'; throw error; // CHANGE
                } // CHANGE
            }; // CHANGE
        } // CHANGE
        /** Saving and private graph checkpoints must never capture a provisional or failed operation. */ // CHANGE
        async function whenSettled() { // CHANGE
            while (committing) await committing.settled; // CHANGE
            if (captureFailure) throw captureFailure; // CHANGE
        } // CHANGE
        function assertCapturable() { // CHANGE
            if (captureFailure) throw captureFailure; // CHANGE
            if (committing) throw new Error('Finish applying or restoring the current editor before capturing the diagram.'); // CHANGE
        } // CHANGE
        /** Enforce synchronous graph application; I/O belongs to preparation or a separate storage command. */ // CHANGE
        function synchronous(operation, value) { // CHANGE
            if (operation?.constructor?.name === 'AsyncFunction') throw new Error('Graph commit callbacks must be synchronous. Prepare asynchronous data before applying.'); // CHANGE
            const result = operation?.(value); // CHANGE
            if (result && typeof result.then === 'function') { result.catch(() => {}); throw new Error('Graph commit callbacks must be synchronous. Prepare asynchronous data before applying.'); } // CHANGE
            return result; // CHANGE
        } // CHANGE
        /** Reverse the exact native edits, preserving earlier Undo and Redo entries. */ // CHANGE
        function restoreCommit(operation, error) { // CHANGE
            const outstanding = () => [...operation.edits].filter(([edit, start]) => !edit.undone && edit.changes.length > start); // CHANGE
            for (let attempt = 0; attempt < 4; attempt++) { // CHANGE: selection/render listeners may append native edits during compensation.
                for (const [edit, start] of outstanding().reverse()) { // CHANGE
                    if (operation.open && edit === model.currentEdit) { // CHANGE
                        const changes = edit.changes.splice(start); // CHANGE
                        for (let index = changes.length - 1; index >= 0; index--) changes[index].execute(); // CHANGE
                    } else if (graph.__trellisSharing?.rejectOperation) graph.__trellisSharing.rejectOperation(edit, error.message); // CHANGE
                    else { edit.__trellisUsersRejected = true; edit.__trellisUsersRejectedReason = error.message; edit.undo(); } // CHANGE
                } // CHANGE
                const selected = operation.selection.filter(cell => model.getCell(cell.id) === cell), current = graph.getSelectionCells?.() || []; // CHANGE: deleted preexisting selections are available only after their inverse edits execute.
                if (selected.length !== current.length || selected.some((cell, index) => current[index] !== cell)) graph.setSelectionCells?.(selected); // CHANGE
                graph.refresh?.(); // CHANGE
                if (!outstanding().length) { // CHANGE
                    const undo = ui.editor.undoManager; // CHANGE
                    if (operation.undo && Array.isArray(undo?.history)) { undo.history.splice(0, undo.history.length, ...operation.undo); undo.indexOfNextAdd = operation.undoIndex; } // CHANGE
                    return; // CHANGE
                } // CHANGE
            } // CHANGE
            throw new Error('Graph listeners kept changing content during rollback.'); // CHANGE
        } // CHANGE
        /** Own one native graph action, including nested domain commands and required rendering. */ // CHANGE
        function apply(options, operation) { // CHANGE
            const history = root.Trellis?.history; // CHANGE
            if (options.metadata && history?.run && !history.isRestoring?.()) return history.run(options.metadata, () => apply({ ...options, metadata: null }, operation)); // CHANGE: native events retain domain history metadata through finalization and rollback.
            if (captureFailure) throw captureFailure; // CHANGE
            const cells = (typeof options.cells === 'function' ? options.cells() : options.cells || []).filter(Boolean); // CHANGE
            const holds = blocked(cells, options.manualSources || [], options.includeAncestors !== false, options.exactCells?.() || []); // CHANGE
            if (holds.length) { // CHANGE
                options.onBlocked?.(holds); // CHANGE
                const error = new Error('Changes were blocked by ' + describeHolds(holds) + '. Your entries remain in this editor.'); error.code = 'TRELLIS_EDIT_BLOCKED'; error.blocked = holds; error.targets = holds.map(hold => hold.key); graph.__trellisSharing?.showBlockedEdit?.(error, options.editor?.element?.()); throw error; // CHANGE
            } // CHANGE
            options.assertCurrent?.(); // CHANGE
            if (options.isCurrent && !options.isCurrent()) { const error = new Error('This editor is no longer current.'); error.code = 'TRELLIS_EDIT_STALE'; throw error; } // CHANGE
            if (committing) { const value = scope(options.kind || 'manual', () => synchronous(operation)); synchronous(options.finalize, value); return value; } // CHANGE: nested commands join their synchronous owner.
            if (model.updateLevel) throw new Error('Start the editor commit outside an existing native transaction.'); // CHANGE
            const undo = ui.editor.undoManager, owner = { id: options.id || 'editor-commit:' + (++sequence), edits: new Map(), children: new Map(), document: documentIdentity(), actor: user()?.id || '', selection: graph.getSelectionCells?.().slice() || [], undo: undo?.history?.slice(), undoIndex: undo?.indexOfNextAdd, open: false }; // CHANGE
            owner.settled = new Promise(resolve => { owner.release = resolve; }); committing = owner; // CHANGE
            try { // CHANGE
                model.beginUpdate(); owner.open = true; owner.edits.set(model.currentEdit, model.currentEdit.changes.length); // CHANGE
                const value = scope(options.kind || 'manual', () => { (options.manualSources || cells).forEach(rememberManualSource); return synchronous(operation); }); // CHANGE
                owner.open = false; model.endUpdate(); // CHANGE: native permission validation runs before final rendering succeeds.
                for (const edit of owner.edits.keys()) if (edit.__trellisUsersRejected) { const error = new Error(edit.__trellisUsersRejectedReason || 'Changes were rejected by user permissions.'); error.code = 'TRELLIS_EDIT_REJECTED'; throw error; } // CHANGE
                synchronous(options.finalize, value); // CHANGE
                for (const edit of owner.edits.keys()) if (edit.__trellisUsersRejected) { const error = new Error(edit.__trellisUsersRejectedReason || 'Changes were rejected.'); error.code = 'TRELLIS_EDIT_REJECTED'; throw error; } // CHANGE
                const changes = [...owner.edits].flatMap(([edit, start]) => edit.changes.slice(start)).filter(isContentChange); // CHANGE
                options.onApplied?.({ operationId: owner.id, changed: !!changes.length, targets: [...new Set(changes.flatMap(change => changeCells(change)).map(cell => JSON.stringify([page(), String(cell.id)])))] }); // CHANGE: successful outcomes identify actual effects, including newly created objects.
                return value; // CHANGE
            } catch (error) { // CHANGE
                owner.failed = true; // CHANGE
                if (error.code === 'TRELLIS_EDIT_REJECTED') graph.__trellisSharing?.showBlockedEdit?.({ ...error, message: error.message, targets: cells.map(cell => JSON.stringify([page(), String(cell.id)])) }, options.editor?.element?.()); // CHANGE
                try { restoreCommit(owner, error); } catch (rollbackError) { // CHANGE
                    captureFailure = new Error('Editor rollback failed. Saving is blocked until the diagram is reopened or recovered: ' + rollbackError.message); captureFailure.cause = rollbackError; // CHANGE
                    try { (options.recoveryEditor || options.editor)?.freeze?.(captureFailure.message); graph.__trellisSharing?.retainFailedCommit?.(captureFailure.message); } catch (preservationError) { root.console?.error('Failed to preserve the frozen editor', preservationError); } // CHANGE: preservation failure cannot release quarantine or replace the original operation error.
                    error.rollbackError = rollbackError; // CHANGE
                } // CHANGE
                throw error; // CHANGE
            } finally { // CHANGE
                try { if (owner.open) { owner.open = false; model.endUpdate(); } } finally { // CHANGE
                    committing = null; owner.release(); // CHANGE
                    if (owner.failed && !captureFailure && graph.__trellisSharing?.releaseRemovedCreations) { // CHANGE
                        const removed = new Set(); const visit = cell => { if (cell.id && !model.getCell(cell.id)) removed.add(String(cell.id)); (cell.children || []).forEach(visit); }; // CHANGE
                        for (const [cell, existed] of owner.children) if (!existed) visit(cell); // CHANGE
                        if (removed.size) Promise.resolve().then(() => { if (owner.document === documentIdentity() && owner.actor === (user()?.id || '')) return graph.__trellisSharing.releaseRemovedCreations([...removed]); }).catch(error => root.console?.error('Failed to release removed creation holds', error)); // CHANGE
                    } // CHANGE
                } // CHANGE
            } // CHANGE
        } // CHANGE
        /** Prepare a draft once, then return an explicit local outcome, independent of persistence. */ // CHANGE
        function commit(options) { // CHANGE
            const key = options.editor || options.id; // CHANGE
            if (key && submissions.has(key)) return submissions.get(key); // CHANGE
            const guard = commitGuard(options), captured = options.capture ? JSON.stringify(options.capture()) : undefined, draft = captured === undefined ? undefined : JSON.parse(captured); // CHANGE
            const check = () => { guard(); if (options.capture && JSON.stringify(options.capture()) !== captured) { const error = new Error('Newer entries remain in this editor. Review them before applying.'); error.code = 'TRELLIS_EDIT_STALE'; throw error; } }; // CHANGE: preparation cannot bless newer typing as the baseline of an older draft.
            const task = Promise.resolve().then(async () => { // CHANGE
                let prepared; // CHANGE
                try { // CHANGE
                    await options.editor?.acquire?.(); check(); // CHANGE
                    prepared = await options.prepare({ draft, assertCurrent: check }); check(); // CHANGE
                    let effects; const value = apply({ ...options, ...prepared, assertCurrent: () => { check(); prepared.assertCurrent?.(); }, onApplied: result => { effects = result; } }, prepared.apply); // CHANGE
                    options.editor?.complete?.(); // CHANGE
                    return { status: effects?.changed ? 'applied' : 'unchanged', operationId: effects?.operationId || options.id, targets: effects?.targets || [], value }; // CHANGE
                } catch (error) { // CHANGE
                    if (error.blocked || error.code === 'TRELLIS_EDIT_REJECTED') graph.__trellisSharing?.showBlockedEdit?.({ ...error, message: error.message, targets: error.targets || (options.cells || []).map?.(cell => JSON.stringify([page(), String(cell.id)])) }, options.editor?.element?.()); // CHANGE
                    const status = error.code === 'TRELLIS_EDIT_BLOCKED' ? 'blocked' : error.code === 'TRELLIS_EDIT_STALE' ? 'stale' : 'rejected'; // CHANGE
                    return { status, operationId: options.id, reason: error.message, error }; // CHANGE
                } // CHANGE
            }).finally(() => { if (key && submissions.get(key) === task) submissions.delete(key); }); // CHANGE
            if (key) submissions.set(key, task); return task; // CHANGE
        } // CHANGE
        function pruneDeferred() { let changed = false; for (const [id, item] of deferred) if (item.document !== documentIdentity() || item.page !== page() || item.userId !== (user()?.id || '') || item.cells?.some(cell => model.getCell(cell.id) !== cell)) { deferred.delete(id); changed = true; } if (changed) renderDeferred(); } // CHANGE: queued automation cannot target a removed object or another actor/page generation.
        const recreated = new WeakSet(); // NEW: stable logical replacements preserve unknown creation facts as well as known ones.
        const manualSources = new Set(); let sourceCleanup = false; // NEW: only this synchronous manual action may maintain its own held source.
        const user = () => (graph.__trellisUsers || root.Trellis?.users)?.getCurrentUser?.();
        const page = () => ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || '';
        const documentIdentity = () => ui.getCurrentFile?.() || model.getRoot?.();
        function logicalCell(cell) { // NEW: generated planting children share their group's identity.
            let result = cell; const visited = new Set(); // CHANGE
            for (let cursor = cell; cursor && !visited.has(cursor); cursor = model.getParent?.(cursor) || cursor.parent) { // CHANGE
                visited.add(cursor); // CHANGE
                if (cursor.getAttribute?.('tiler_group') === '1' || cursor.getAttribute?.('planting_id') || /(?:^|;)tiler_group=1(?:;|$)/.test(cursor.style || '')) result = cursor; // CHANGE
            } // CHANGE
            return result;
        }
        /** Structural edits retain both ancestry scopes after native execution detaches the child. */ // CHANGE
        function changeCells(change) { // CHANGE
            const cell = change.cell || change.child, result = new Set([logicalCell(cell)]); // CHANGE
            if (change.constructor?.name === 'mxChildChange') for (const parent of [change.previous, change.parent]) if (parent) { // CHANGE
                const logical = logicalCell(parent); // CHANGE
                if (logical !== parent || parent.getAttribute?.('tiler_group') === '1' || parent.getAttribute?.('planting_id') || /(?:^|;)tiler_group=1(?:;|$)/.test(parent.style || '')) result.add(logical); // CHANGE
            } // CHANGE
            if (!model.getParent(cell) && result.size > 1) result.delete(cell); // CHANGE: a removed circle belongs to its former group, not an orphan hold.
            return [...result].filter(Boolean); // CHANGE
        } // CHANGE
        function scope(kind, operation) { // NEW: asynchronous computations must enter a fresh scope at their mutation boundary.
            if (!kinds.has(kind)) throw new Error('Unknown Trellis edit kind.');
            const previous = active;
            active = { kind, actorUserId: user()?.id || '' };
            try { return operation(); } finally { active = previous; }
        }
        function rememberManualSource(cell) { // NEW: capture explicit mutations, never infer editing intent from selection.
            for (let cursor = cell; cursor && cursor !== model.getRoot(); cursor = model.getParent(cursor)) manualSources.add(JSON.stringify([page(), String(cursor.id)]));
            if (!sourceCleanup) { sourceCleanup = true; Promise.resolve().then(() => { manualSources.clear(); sourceCleanup = false; }); }
        }
        const execute = model.execute;
        if (execute) model.execute = function (change) { // NEW: tag before native execute dispatches a synchronous model event.
            if (committing && !committing.edits.has(model.currentEdit)) committing.edits.set(model.currentEdit, model.currentEdit.changes.length); // CHANGE: include synchronous finalization and listener-generated native edits.
            if (committing && change.constructor?.name === 'mxChildChange' && change.child && !committing.children.has(change.child)) committing.children.set(change.child, !!model.getCell(change.child.id)); // CHANGE: remember initial membership before removal or reparenting can obscure creation identity.
            if (root.__TRELLIS_USERS_DEBUG__ === true && !change.__trellisOriginStack) Object.defineProperty(change, '__trellisOriginStack', { value: new Error('Model mutation origin').stack?.slice(0, 6000), configurable: true }); // CHANGE: opt-in call sites never serialize into diagram XML.
            const kind = graph.__ccMapInternalChange || graph.__trellisLocalViewChanging ? 'derived-presentation' : graph.__trellisFieldMetadataChange ? 'attribution' : active?.kind;
            if (!change.__trellisUsersActorStamp) Object.defineProperty(change, '__trellisOperation', { value: { kind: kind || 'manual', actorUserId: active?.actorUserId || user()?.id || '' }, configurable: true, writable: true }); // CHANGE: provenance must not enter native change serialization.
            if (kindOf(change) === 'manual' && !graph.__trellisSharingApplying && !graph.__ccHistoryRestoring && !graph.__trellisUsersInternalChange && !ui.openingFile) rememberManualSource(change.cell || change.child); // CHANGE
            return execute.apply(this, arguments);
        };
        function targets(cells, includeAncestors = true, exactCells = []) { // NEW: include each subtree and ancestor; shared containers make the group conservative.
            const result = new Set();
            function visit(cell) {
                if (!cell) return;
                result.add(JSON.stringify([page(), String(cell.id)]));
                for (let i = 0; i < model.getChildCount(cell); i++) visit(model.getChildAt(cell, i));
            }
            for (const cell of cells || []) {
                visit(typeof cell === 'string' ? model.getCell(cell) : cell);
                for (let cursor = includeAncestors && model.getParent(typeof cell === 'string' ? model.getCell(cell) : cell); cursor && cursor !== model.getRoot(); cursor = model.getParent(cursor)) result.add(JSON.stringify([page(), String(cursor.id)]));
            }
            for (const cell of exactCells) if (cell) result.add(JSON.stringify([page(), String(cell.id)])); // CHANGE: parent resizing does not imply edits to every sibling.
            return [...result];
        }
        function blocked(cells, sources = [], includeAncestors = true, exactCells = []) { // CHANGE: unrelated local drafts are protected too; only the initiating action's source is exempt.
            const keys = new Set(targets(cells, includeAncestors, exactCells));
            const allowed = new Set([...manualSources, ...sources.filter(Boolean).map(cell => JSON.stringify([page(), String(cell.id)]))]); // NEW
            return (graph.__trellisSharing?.automationHolds?.() || []).filter(hold => (hold.key === '*' || keys.has(hold.key)) && !(hold.local && (hold.active === false || allowed.has(hold.key)))); // CHANGE
        }
        /** Resolve presentation names as text; canonical task titles must retain literal special characters. */ // CHANGE
        function holdObjectName(hold) { // CHANGE
            if (hold.key === '*') return 'project structure'; // CHANGE
            let cell; // CHANGE
            try { const [targetPage, id] = JSON.parse(hold.key); if (targetPage === page()) cell = model.getCell(id); } catch (_) { /* Malformed or unavailable targets still need readable diagnostics. */ } // CHANGE
            const title = cell?.getAttribute?.('title'); // CHANGE
            if (title?.trim()) return title.replace(/\s+/g, ' ').trim(); // CHANGE
            const label = hold.objectLabel || (cell && graph.convertValueToString?.(cell)) || cell?.getAttribute?.('label'); // CHANGE
            if (!label) return 'unavailable object'; // CHANGE
            const document = new root.DOMParser().parseFromString(String(label), 'text/html'); // CHANGE: detached parsing never inserts label markup into the application.
            document.querySelectorAll('script,style').forEach(node => node.remove()); // CHANGE
            document.querySelectorAll('br').forEach(node => node.replaceWith(document.createTextNode(' '))); // CHANGE
            return document.body.textContent.replace(/\s+/g, ' ').trim() || 'unavailable object'; // CHANGE
        } // CHANGE
        function renderDeferred() { // NEW: private, session-local retry controls never enter diagram XML.
            if (!root.document || !graph.container) return;
            notice?.remove(); notice = null;
            if (!deferred.size) return;
            notice = root.document.createElement('div'); notice.dataset.trellisDeferredAutomation = '';
            notice.setAttribute('role', 'status'); notice.style.cssText = 'position:absolute;right:12px;bottom:12px;z-index:30;max-width:340px;max-height:35%;overflow:auto;background:#fff;color:#333;border:1px solid #aaa;border-radius:5px;padding:8px;font:12px Arial;'; // CHANGE
            for (const [id, item] of deferred) {
                const row = root.document.createElement('div'); row.style.margin = '4px';
                const text = root.document.createElement('span'); text.textContent = item.title + ' deferred: ' + item.labels.join(', ') + '. '; row.appendChild(text);
                const retry = root.document.createElement('button'); retry.textContent = 'Retry';
                retry.onclick = async event => {
                    event.stopPropagation(); retry.disabled = true;
                    try {
                        if (item.document !== documentIdentity() || item.page !== page() || item.userId !== (user()?.id || '')) throw new Error('Return to the original document, page and user before retrying.');
                        deferred.delete(id); await item.retry(); renderDeferred();
                    } catch (error) { deferred.set(id, item); text.textContent = error.message + ' '; retry.disabled = false; }
                };
                row.appendChild(retry); notice.appendChild(row);
            }
            for (const type of ['mousedown', 'pointerdown', 'click', 'keydown']) notice.addEventListener(type, event => event.stopPropagation());
            graph.container.appendChild(notice);
        }
        function run(kind, options, operation) { // NEW: one invocation is an indivisible dependency group, checked before any mutation.
            pruneDeferred(); // CHANGE
            const cells = options.cells().filter(Boolean), holds = blocked(cells, options.manualSources || [], options.includeAncestors !== false, options.exactCells?.() || []); // CHANGE
            if (holds.length) {
                options.onBlocked?.(holds); // CHANGE: synchronous callers may throw the actual blocker before any mutation or queued Retry; default deferral is unchanged.
                if (committing) { const error = new Error('Changes were blocked by ' + describeHolds(holds) + '. Your entries remain in this editor.'); error.code = 'TRELLIS_EDIT_BLOCKED'; error.blocked = holds; error.targets = holds.map(hold => hold.key); throw error; } // CHANGE: nested domain commands must never silently defer part of a commit.
                const id = options.id || kind + ':' + cells.map(cell => cell.id).join(',') || String(++sequence);
                const labels = [...new Set(holds.map(holdObjectName))]; // CHANGE
                const previous = deferred.get(id); deferred.set(id, { title: options.title || 'Automatic update', labels, retry: options.retry, document: documentIdentity(), page: page(), userId: user()?.id || '', cells }); if (!previous || JSON.stringify(previous.labels) !== JSON.stringify(labels)) renderDeferred(); // CHANGE: repeated blocked updates neither mutate content nor rebuild the same notice.
                return options.deferredValue;
            }
            if (kind === 'manual') (options.manualSources || []).forEach(rememberManualSource); // NEW: an unchanged scheduler source can still initiate regenerated tasks within this action.
            const result = scope(kind, operation);
            if (options.id && deferred.delete(options.id)) renderDeferred(); // CHANGE: unrelated successful automation must not rebuild or steal focus from Retry controls.
            return result; // NEW
        }
        const describeHolds = holds => holds.map(hold => (hold.local ? 'unfinished local editor' : (hold.name || hold.userId || 'another session')) + ' on ' + holdObjectName(hold)).join(', '); // CHANGE
        /** A failed document replacement must not clear the original capture quarantine. */ // CHANGE
        async function replaceDocument(operation) { const failure = captureFailure; try { await operation(); captureFailure = null; } catch (error) { captureFailure = failure; throw error; } } // CHANGE
        const api = { scope, run, apply, commit, saveDefaults, whenSettled, assertCapturable, replaceDocument, blocked, describeHolds, logicalCell, changeCells, kindOf, isContentChange, deferred, recreated, current: () => active, committing: () => !!committing }; // CHANGE
        graph.__trellisEditContext = api;
        ui.editor.addListener?.('fileLoaded', () => { captureFailure = null; defaultNoticeHost?.remove(); defaultNoticeHost = null; defaultWrites.clear(); deferred.clear(); manualSources.clear(); renderDeferred(); }); // CHANGE
        ui.editor.addListener?.('pageSelected', () => { pruneDeferred(); pruneDefaultNotices(); }); root.addEventListener?.('trellisUsersSessionChanged', () => { pruneDeferred(); pruneDefaultNotices(); }); // CHANGE
        return api;
    }
    root.TrellisEditContext = { install, kindOf, isContentChange }; // NEW
})(window);
