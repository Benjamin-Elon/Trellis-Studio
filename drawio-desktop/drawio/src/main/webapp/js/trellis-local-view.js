/** Local folding adapter. Native geometry remains the display model; encoders see authored geometry. */ // NEW
(function (root) {
    'use strict';
    function install(ui) {
        const graph = ui.editor.graph, model = graph.getModel?.();
        if (!model || graph.__trellisLocalView) return graph.__trellisLocalView;
        const authored = new Map();
        let preferenceKey = '', preferences = {}, depth = 0, applying = false; // CHANGE
        const pageId = () => ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || '';
        const objectKey = cell => JSON.stringify([pageId(), String(cell.id)]);
        const clone = value => value?.clone ? value.clone() : value;
        let pendingFolds = null, flushingFolds = false; // NEW: suppressed model edits still need native rendering notifications.

        /** Deliver already-applied folds only to the graph, after the complete display transaction. */ // NEW
        function flushFoldRendering() { // NEW
            if (!pendingFolds || flushingFolds || depth || model.updateLevel || model.endingUpdate || suspended || presentationDepth || mutationDepth || encoding || applying) return; // NEW
            const previous = graph.__trellisLocalViewChanging, internal = graph.__trellisUsersInternalChange; // NEW
            flushingFolds = true; graph.__trellisLocalViewChanging = true; graph.__trellisUsersInternalChange = true; // NEW
            try { // NEW
                while (pendingFolds && !model.updateLevel) { // NEW: cluster normalization can enqueue more native folds while processing this batch.
                    const pending = pendingFolds; pendingFolds = null; // NEW
                    if (pending.root === model.getRoot() && pending.page === pageId()) fold(() => graph.graphModelChanged(pending.changes)); // NEW: obsolete pages are skipped; normalization stays private even through pre-install native references.
                } // NEW
            } finally { flushingFolds = false; graph.__trellisLocalViewChanging = previous; graph.__trellisUsersInternalChange = internal; } // NEW
        } // NEW

        // Presentation journals retain the actual authored cells, including native undo references. // NEW
        const presentations = new Map(); // NEW
        const valueOrigins = new WeakMap(), trackedValues = new WeakSet(); // CHANGE: remember XML clones made before an authored transaction suspends presentation.
        const hasPresentationPreferences = () => Array.from(presentations.values()).some(entry => Object.keys(entry.preferences).length); // NEW
        let presentationChanges = [], presentationDepth = 0, suspended = 0, mutationDepth = 0, transaction = false, endingTransaction = false, history = false, encoding = 0; // CHANGE

        /** Direct replay changes no history, events, attribution, or dirty state. */ // NEW
        function replayPresentation(reverse) { // NEW
            const previous = graph.__trellisLocalViewChanging; // NEW
            graph.__trellisLocalViewChanging = true; presentationDepth++; // NEW
            try { // NEW
                const changes = reverse ? presentationChanges.slice().reverse() : presentationChanges; // NEW
                for (const change of changes) change.execute(); // NEW
            } finally { presentationDepth--; graph.__trellisLocalViewChanging = previous; } // NEW
        } // NEW

        function suspendPresentations() { // CHANGE
            if (suspended++ !== 0) return; // NEW
            replayPresentation(true); // NEW
        } // NEW

        /** Track only displayed XML instances, without patching DOM or graph prototypes. */ // NEW
        function trackValueClones(value, origin = value) { // NEW
            if (!value?.nodeType || trackedValues.has(value)) return; // NEW
            trackedValues.add(value); // NEW
            const cloneNode = value.cloneNode; // NEW
            value.cloneNode = function (deep) { // NEW
                const copy = cloneNode.call(this, deep); valueOrigins.set(copy, origin); trackValueClones(copy, origin); return copy; // NEW
            }; // NEW
        } // NEW

        /** Collect only this synchronous rendering operation, before native END_UPDATE observers run. */ // NEW
        function renderPresentation(operation) { // NEW
            const edit = model.currentEdit, start = edit.changes.length; // NEW
            const previous = graph.__trellisLocalViewChanging, internal = graph.__trellisUsersInternalChange; // NEW
            presentationDepth++; graph.__trellisLocalViewChanging = true; graph.__trellisUsersInternalChange = true; // NEW
            model.beginUpdate(); // NEW
            try { return operation(); } // NEW
            finally { // NEW
                if (model.currentEdit === edit) presentationChanges.push(...edit.changes.splice(start)); // NEW
                try { model.endUpdate(); } // NEW
                finally { presentationDepth--; graph.__trellisLocalViewChanging = previous; graph.__trellisUsersInternalChange = internal; } // NEW
            } // NEW
        } // NEW

        /** Reject malformed entries individually; storage failure never prevents a local view change. */ // NEW
        function loadPresentationPreferences(entry) { // NEW
            const key = storageKey().replace('trellis.local-folds.v1:', 'trellis.local-' + entry.name + '.v1:'); // NEW
            if (entry.key === key) return; // NEW
            entry.key = key; entry.preferences = {}; // NEW
            try { // NEW
                const saved = key && JSON.parse(root.localStorage.getItem(key) || '{}'); // NEW
                if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return; // NEW
                for (const [object, expanded] of Object.entries(saved)) { // NEW
                    try { // NEW
                        const identity = JSON.parse(object); // NEW
                        if (Array.isArray(identity) && identity.length === 2 && identity.every(part => typeof part === 'string') && typeof expanded === 'boolean') entry.preferences[object] = expanded; // NEW
                    } catch (_) { /* Ignore one corrupt object identity. */ } // NEW
                } // NEW
            } catch (error) { ui.editor.setStatus?.('Local planting preferences could not be read: ' + error.message); } // NEW
        } // NEW

        function rebuildPresentations() { // NEW
            presentationChanges = []; // NEW
            for (const entry of presentations.values()) { // NEW
                loadPresentationPreferences(entry); // NEW
                renderPresentation(() => entry.adapter.restore(entry.preferences, pageId())); // NEW
            } // NEW
            for (const change of presentationChanges) if (change.cell) trackValueClones(change.cell.value); // NEW
        } // NEW

        function resumePresentations(rebuild) { // NEW
            if (--suspended !== 0) return; // NEW
            if (rebuild) rebuildPresentations(); else replayPresentation(false); // NEW
            if (rebuild) { // CHANGE
                graph.view?.states?.visit?.((_key, state) => { if (!model.contains(state.cell)) graph.view.removeState(state.cell); }); // NEW: suppressed model edits must still remove orphaned summary/circle DOM.
                graph.updateSelection?.(); // NEW: prune deleted objects only after local children are back in the model.
            } // NEW
            flushFoldRendering(); // NEW: native fold changes may have waited for the planting display to be restored.
        } // NEW

        const updateSelection = graph.updateSelection; // NEW
        if (updateSelection) graph.updateSelection = function () { // NEW
            if (!suspended && !presentationDepth) return updateSelection.apply(this, arguments); // NEW: native CHANGE processing must not deselect temporarily detached local circles.
        }; // NEW

        /** Canonical edits may be nested inside an existing native transaction. */ // NEW
        function editPresentationBase(operation) { // NEW
            if (presentationDepth || suspended) return operation(); // NEW
            suspendPresentations(); // NEW
            try { return operation(); } // NEW
            finally { resumePresentations(true); graph.view?.revalidate?.(); } // NEW
        } // NEW

        /** Change objects are sometimes constructed from a clone of the displayed XML value. */ // NEW
        function preparePresentationChange(change) { // NEW
            const incoming = change.constructor?.name === 'mxValueChange' && change.value; // NEW
            const cell = change.cell, displayed = valueOrigins.get(incoming) || (!suspended && cell?.value); // CHANGE: canonical tiler writes must not be compared with an old personal view.
            const prepare = Array.from(presentations.values(), entry => entry.adapter.prepareChange?.(change)).filter(Boolean); // NEW
            return () => { // NEW
                if (incoming?.nodeType === 1 && displayed?.nodeType === 1 && cell.value?.nodeType === 1 && cell.value !== displayed) { // NEW
                    const value = cell.value.cloneNode(true), names = new Set([...Array.from(displayed.attributes, attr => attr.name), ...Array.from(incoming.attributes, attr => attr.name)]); // NEW
                    for (const name of names) if (incoming.getAttribute(name) !== displayed.getAttribute(name)) { // NEW
                        if (incoming.hasAttribute(name)) value.setAttribute(name, incoming.getAttribute(name)); else value.removeAttribute(name); // NEW
                    } // NEW
                    change.value = change.previous = value; // NEW
                } // NEW
                for (const apply of prepare) change = apply(change) || change; // NEW
                return change; // NEW
            }; // NEW
        } // NEW

        // Native execute runs change.execute BEFORE beginUpdate, so both boundaries are necessary. // NEW
        const presentationExecute = model.execute, presentationBegin = model.beginUpdate, presentationEnd = model.endUpdate; // NEW
        model.execute = function (change) { // NEW
            if (!hasPresentationPreferences() || presentationDepth || depth) return presentationExecute.call(this, change); // CHANGE: ordinary edits pay no rendering cost before any personal choice exists.
            const prepare = preparePresentationChange(change); // NEW
            if (suspended) return presentationExecute.call(this, prepare()); // NEW: a circle selected before beginUpdate may now be detached from the authored model.
            mutationDepth++; suspendPresentations(); // NEW
            try { return presentationExecute.call(this, prepare()); } // NEW
            finally { mutationDepth--; resumePresentations(true); graph.view?.revalidate?.(); } // NEW
        }; // NEW
        model.beginUpdate = function () { // NEW
            if (hasPresentationPreferences() && !this.updateLevel && !presentationDepth && !suspended && !depth && !mutationDepth) { transaction = true; suspendPresentations(); } // CHANGE
            return presentationBegin.apply(this, arguments); // NEW
        }; // NEW
        model.endUpdate = function () { // NEW
            const outer = transaction && this.updateLevel === 1 && !endingTransaction; // CHANGE
            if (outer) endingTransaction = true; // NEW: nested edits from native publish observers remain on the same canonical base.
            try { return presentationEnd.apply(this, arguments); } // NEW
            finally { // CHANGE: a native outer edit can contain private folds even without planting preferences.
                try { if (outer) { endingTransaction = false; if (!this.updateLevel && transaction) { transaction = false; resumePresentations(true); graph.view?.revalidate?.(); } } } // CHANGE
                finally { flushFoldRendering(); } // NEW
            } // CHANGE
        }; // NEW
        model.addListener?.(root.mxEvent.START_EDIT, () => { // NEW
            if (hasPresentationPreferences() && !model.updateLevel && !presentationDepth && !suspended && !depth) { history = true; suspendPresentations(); } // CHANGE
        }); // NEW
        model.addListener?.(root.mxEvent.END_EDIT, () => { // NEW
            if (history) { history = false; resumePresentations(true); graph.view?.revalidate?.(); } // NEW
        }); // NEW

        /** Register a graph-local renderer; its preferences and journal never enter authored XML. */ // NEW
        function registerPresentation(name, adapter) { // NEW
            if (presentations.has(name)) return presentations.get(name).api; // NEW
            const entry = { name, adapter, key: null, preferences: {} }; // NEW
            const api = { // NEW
                get: cell => { loadPresentationPreferences(entry); return entry.preferences[objectKey(cell)]; }, // NEW
                set(cell, expanded) { // NEW
                    loadPresentationPreferences(entry); // NEW
                    entry.preferences[objectKey(cell)] = !!expanded; // NEW
                    if (entry.key) { // NEW
                        try { root.localStorage.setItem(entry.key, JSON.stringify(entry.preferences)); } // NEW
                        catch (error) { ui.editor.setStatus?.('Planting folding remains local, but its preferences could not be saved: ' + error.message); } // NEW
                    } // NEW
                    if (model.updateLevel && !suspended) { transaction = true; suspendPresentations(); } // NEW: the first toggle inside a real edit waits until that edit publishes.
                    else editPresentationBase(() => {}); // CHANGE
                }, // NEW
                authored: editPresentationBase // NEW
            }; // NEW
            entry.api = api; presentations.set(name, entry); // NEW
            editPresentationBase(() => {}); // NEW
            return api; // NEW
        } // NEW

        function storageKey() {
            const parent = graph.getDefaultParent?.(), file = ui.getCurrentFile?.();
            const documentId = parent?.getAttribute?.('trellis_history_id') || parent?.getAttribute?.('trellis_users_diagram_id') || file?.fileObject?.path;
            const user = graph.__trellisUsers?.getCurrentUser?.() || root.Trellis?.users?.getCurrentUser?.();
            return documentId ? 'trellis.local-folds.v1:' + JSON.stringify([documentId, user?.id || 'local']) : '';
        }
        function persist() {
            if (!preferenceKey) return;
            try { root.localStorage.setItem(preferenceKey, JSON.stringify(preferences)); }
            catch (error) { ui.editor.setStatus?.('Folding remains local, but its preferences could not be saved: ' + error.message); }
        }
        function capture(cell) {
            if (!authored.has(cell)) authored.set(cell, { geometry: clone(model.getGeometry(cell)), collapsed: !!cell.collapsed, geometries: new WeakMap() }); // CHANGE
        }
        const geometryChanged = model.geometryForCellChanged; // CHANGE: this boundary also sees native undo/redo.
        model.geometryForCellChanged = function (cell, geometry) { // CHANGE
            if (depth) { capture(cell); if (geometry) authored.get(cell).geometries.set(geometry, clone(authored.get(cell).geometry)); } // CHANGE
            else if (authored.has(cell) && geometry && !graph.__trellisSharingApplying) {
                const original = authored.get(cell), previous = model.getGeometry(cell), next = clone(geometry);
                if (previous) original.geometries.set(previous, clone(original.geometry)); // NEW: native geometry undo retains the matching authored preimage.
                // Translate deliberate edits from the locally folded orientation back to the persisted orientation. // NEW
                if (!!cell.collapsed !== original.collapsed) next.swap?.();
                if (previous && original.geometry) {
                    next.x = original.geometry.x + geometry.x - previous.x;
                    next.y = original.geometry.y + geometry.y - previous.y;
                    if (next.alternateBounds && original.geometry.alternateBounds) {
                        next.alternateBounds.x = original.geometry.alternateBounds.x + geometry.x - previous.x;
                        next.alternateBounds.y = original.geometry.alternateBounds.y + geometry.y - previous.y;
                    }
                    if (!original.geometry.alternateBounds && geometry.width === previous.width && geometry.height === previous.height) next.alternateBounds = null; // NEW: moving a personal fold does not persist its generated alternate bounds.
                }
                original.geometry = original.geometries.has(geometry) ? clone(original.geometries.get(geometry)) : next; // CHANGE
                original.geometries.set(geometry, clone(original.geometry)); // NEW
            }
            return geometryChanged.apply(this, arguments); // CHANGE
        };
        const setCollapsed = model.setCollapsed;
        model.setCollapsed = function (cell, collapsed) {
            if (graph.__trellisSharingApplying && !depth) return setCollapsed.apply(this, arguments); // NEW: incoming authored bases are distinct from personal folding.
            if (!depth) return fold(() => this.setCollapsed(cell, collapsed));
            capture(cell); preferences[objectKey(cell)] = !!collapsed;
            return setCollapsed.apply(this, arguments);
        };

        /** An outer transaction removes only fold-generated edits before native dirty/undo/history listeners run. */ // NEW
        function fold(operation) {
            if (depth) return operation();
            const edit = model.currentEdit, start = edit?.changes.length || 0;
            const internal = graph.__trellisUsersInternalChange, previous = graph.__trellisLocalViewChanging; // CHANGE
            const foldRoot = model.getRoot(), foldPage = pageId(); // NEW
            depth++; graph.__trellisLocalViewChanging = true; graph.__trellisUsersInternalChange = true;
            model.beginUpdate();
            try { return operation(); }
            finally {
                if (model.currentEdit === edit) { // CHANGE
                    const changes = edit.changes.splice(start); // CHANGE: keep native invalidation data outside document history.
                    if (changes.length && foldRoot === model.getRoot() && foldPage === pageId()) { // NEW
                        if (!pendingFolds || pendingFolds.root !== foldRoot || pendingFolds.page !== foldPage) pendingFolds = { root: foldRoot, page: foldPage, changes: [] }; // NEW
                        for (const change of changes) pendingFolds.changes.push(change); // NEW
                    } // NEW
                } // CHANGE
                try { model.endUpdate(); }
                finally { // CHANGE
                    depth--; graph.__trellisLocalViewChanging = previous; graph.__trellisUsersInternalChange = internal; // CHANGE
                    try { persist(); } finally { flushFoldRendering(); } // CHANGE
                } // CHANGE
            }
        }
        for (const name of ['foldCells', 'cellsFolded']) if (graph[name]) {
            const original = graph[name];
            graph[name] = function () { const args = arguments; return fold(() => original.apply(this, args)); };
        }

        /** Temporary direct assignments affect synchronous encoding only; no model events or view invalidation occur. */ // NEW
        function canonical(operation) {
            if (encoding) return operation(); // NEW: nested encoders must not replay the same journal twice.
            encoding++; suspendPresentations(); // NEW
            const display = [];
            for (const [cell, state] of authored) {
                display.push([cell, cell.geometry, cell.collapsed]);
                cell.geometry = state.geometry; cell.collapsed = state.collapsed;
            }
            try { return operation(); }
            finally { // CHANGE
                for (const [cell, geometry, collapsed] of display) { cell.geometry = geometry; cell.collapsed = collapsed; } // CHANGE
                try { resumePresentations(false); } finally { encoding--; flushFoldRendering(); } // CHANGE
            } // CHANGE
        }
        function restore() {
            const next = storageKey();
            if (next !== preferenceKey) {
                preferenceKey = next; preferences = {};
                try { preferences = preferenceKey && JSON.parse(root.localStorage.getItem(preferenceKey) || '{}') || {}; }
                catch (error) { ui.editor.setStatus?.('Local folding preferences could not be read: ' + error.message); }
            }
            const page = pageId();
            fold(() => {
                for (const [key, collapsed] of Object.entries(preferences)) {
                    const [savedPage, id] = JSON.parse(key), cell = savedPage === page && model.getCell(id);
                    if (cell && !!cell.collapsed !== collapsed) graph.foldCells(collapsed, false, [cell]);
                }
            });
            if (!suspended && !presentationDepth) editPresentationBase(() => {}); // NEW
        }
        /** Incoming authored objects replace their canonical bases, then the personal view is reapplied. */ // NEW
        function apply(operation) {
            if (applying) return operation(); // NEW
            applying = true; // NEW
            suspendPresentations(); // NEW
            for (const [cell, state] of authored) { // CHANGE
                if (!!cell.collapsed !== state.collapsed) graph.removeStateForCell(cell); // NEW: direct base restoration must recreate the fold icon, as native collapse processing does.
                cell.geometry = state.geometry; cell.collapsed = state.collapsed; // CHANGE
            } // CHANGE
            authored.clear();
            try { return operation(); }
            finally { try { restore(); resumePresentations(true); graph.view?.revalidate?.(); } finally { applying = false; flushFoldRendering(); } } // CHANGE
        }
        if (ui.getXmlFileData) {
            const encode = ui.getXmlFileData;
            ui.getXmlFileData = function () { const args = arguments; return canonical(() => encode.apply(this, args)); };
        }
        if (ui.editor.getGraphXml) { // NEW: XML export also uses this native encoder directly.
            const encode = ui.editor.getGraphXml; // NEW
            ui.editor.getGraphXml = function () { const args = arguments; return canonical(() => encode.apply(this, args)); }; // NEW
        } // NEW
        if (graph.cloneCells) { // NEW: copied plantings start from authored detail without inheriting personal state.
            const cloneCells = graph.cloneCells; // NEW
            graph.cloneCells = function () { const args = arguments; return canonical(() => cloneCells.apply(this, args)); }; // NEW
        } // NEW
        const api = { canonical, apply, restore, registerPresentation, isChanging: () => depth > 0 || presentationDepth > 0, isApplying: () => applying }; // CHANGE
        graph.__trellisLocalView = api;
        ui.editor.addListener?.('fileLoaded', () => { authored.clear(); preferenceKey = ''; restore(); });
        ui.editor.addListener?.('pageSelected', restore);
        root.addEventListener?.('trellisUsersSessionChanged', () => apply(() => {}));
        restore(); return api;
    }
    /** Apply captured planting visuals only to an isolated export model, never its embedded XML. */ // NEW
    function applyPlantingProjection(graph, projection, page) { // NEW
        const entries = projection?.[page || '']; // CHANGE: unpaged exports use the same empty identity as the editor.
        if (!Array.isArray(entries)) return; // NEW
        const model = graph.getModel(); // NEW
        model.beginUpdate(); // NEW
        try { // NEW
            for (const entry of entries) { // NEW
                const group = model.getCell(entry.id); // NEW
                if (!group || group.getAttribute?.('tiler_group') !== '1') continue; // NEW
                const doc = root.mxUtils.parseXml(entry.xml), decoder = new root.mxCodec(doc); // NEW
                const copies = Array.from(doc.documentElement.childNodes).filter(node => node.nodeType === 1).map(node => decoder.decodeCell(node)); // NEW
                const display = copies.find(cell => cell.id === group.id); // NEW
                if (!display) continue; // NEW
                for (const child of (group.children || []).slice()) model.remove(child); // NEW
                model.setValue(group, display.value); model.setStyle(group, display.style); // NEW
                for (const child of (display.children || []).slice()) model.add(group, child); // NEW
            } // NEW
        } finally { model.endUpdate(); } // NEW
    } // NEW
    root.TrellisLocalView = Object.freeze({ install, applyPlantingProjection }); // CHANGE
})(typeof window !== 'undefined' ? window : globalThis);
