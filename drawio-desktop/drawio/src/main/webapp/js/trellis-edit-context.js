/** Explicit, synchronous edit provenance and conservative automation preflight. // NEW
 * Context is captured on each model change, not on the whole transaction: a manual
 * schedule edit may contain generated tasks and presentation-only layout changes.
 * This is activity/attribution metadata, never permission or commit authority.
 */
(function (root) {
    'use strict';
    const metadata = new Set(['createdAt', 'lastEditedAt', 'createdByUserId', 'lastEditedByUserId', 'trellis_actor_name', 'trellis_actor_role']); // NEW
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
        const recreated = new WeakSet(); // NEW: stable logical replacements preserve unknown creation facts as well as known ones.
        const manualSources = new Set(); let sourceCleanup = false; // NEW: only this synchronous manual action may maintain its own held source.
        const user = () => (graph.__trellisUsers || root.Trellis?.users)?.getCurrentUser?.();
        const page = () => ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || '';
        const documentIdentity = () => ui.getCurrentFile?.() || model.getRoot?.();
        function logicalCell(cell) { // NEW: generated planting children share their group's identity.
            let result = cell;
            for (let cursor = cell; cursor; cursor = model.getParent(cursor)) if (cursor.getAttribute?.('tiler_group') === '1' || cursor.getAttribute?.('planting_id') || /(?:^|;)tiler_group=1(?:;|$)/.test(cursor.style || '')) result = cursor;
            return result;
        }
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
            const kind = graph.__ccMapInternalChange || graph.__trellisLocalViewChanging ? 'derived-presentation' : graph.__trellisFieldMetadataChange ? 'attribution' : active?.kind;
            if (!change.__trellisUsersActorStamp) Object.defineProperty(change, '__trellisOperation', { value: { kind: kind || 'manual', actorUserId: active?.actorUserId || user()?.id || '' }, configurable: true, writable: true }); // CHANGE: provenance must not enter native change serialization.
            if (kindOf(change) === 'manual' && !graph.__trellisSharingApplying && !graph.__ccHistoryRestoring && !graph.__trellisUsersInternalChange && !ui.openingFile) rememberManualSource(change.cell || change.child); // CHANGE
            return execute.apply(this, arguments);
        };
        function targets(cells) { // NEW: include each subtree and ancestor; shared containers make the group conservative.
            const result = new Set();
            function visit(cell) {
                if (!cell) return;
                result.add(JSON.stringify([page(), String(cell.id)]));
                for (let i = 0; i < model.getChildCount(cell); i++) visit(model.getChildAt(cell, i));
            }
            for (const cell of cells || []) {
                visit(typeof cell === 'string' ? model.getCell(cell) : cell);
                for (let cursor = model.getParent(typeof cell === 'string' ? model.getCell(cell) : cell); cursor && cursor !== model.getRoot(); cursor = model.getParent(cursor)) result.add(JSON.stringify([page(), String(cursor.id)]));
            }
            return [...result];
        }
        function blocked(cells, sources = []) { // CHANGE: unrelated local drafts are protected too; only the initiating action's source is exempt.
            const keys = new Set(targets(cells));
            const allowed = new Set([...manualSources, ...sources.filter(Boolean).map(cell => JSON.stringify([page(), String(cell.id)]))]); // NEW
            return (graph.__trellisSharing?.automationHolds?.() || []).filter(hold => (hold.key === '*' || keys.has(hold.key)) && !(hold.local && allowed.has(hold.key))); // CHANGE
        }
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
            const cells = options.cells().filter(Boolean), holds = blocked(cells, options.manualSources || []); // CHANGE
            if (holds.length) {
                const id = options.id || kind + ':' + cells.map(cell => cell.id).join(',') || String(++sequence);
                const labels = [...new Set(holds.map(hold => hold.objectLabel || (hold.key === '*' ? 'the document' : graph.convertValueToString?.(model.getCell(JSON.parse(hold.key)[1]))) || hold.name || 'an edited object'))]; // CHANGE
                deferred.set(id, { title: options.title || 'Automatic update', labels, retry: options.retry, document: documentIdentity(), page: page(), userId: user()?.id || '' }); renderDeferred();
                return options.deferredValue;
            }
            if (kind === 'manual') (options.manualSources || []).forEach(rememberManualSource); // NEW: an unchanged scheduler source can still initiate regenerated tasks within this action.
            const result = scope(kind, operation);
            if (options.id && deferred.delete(options.id)) renderDeferred(); // CHANGE: unrelated successful automation must not rebuild or steal focus from Retry controls.
            return result; // NEW
        }
        const api = { scope, run, blocked, logicalCell, kindOf, isContentChange, deferred, recreated, current: () => active }; // CHANGE
        graph.__trellisEditContext = api;
        ui.editor.addListener?.('fileLoaded', () => { deferred.clear(); manualSources.clear(); renderDeferred(); }); // CHANGE
        return api;
    }
    root.TrellisEditContext = { install, kindOf, isContentChange }; // NEW
})(window);
