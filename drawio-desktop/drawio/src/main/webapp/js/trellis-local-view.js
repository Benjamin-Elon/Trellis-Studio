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
            const internal = graph.__trellisUsersInternalChange;
            depth++; graph.__trellisLocalViewChanging = true; graph.__trellisUsersInternalChange = true;
            model.beginUpdate();
            try { return operation(); }
            finally {
                if (model.currentEdit === edit) edit.changes.splice(start);
                try { model.endUpdate(); }
                finally { depth--; graph.__trellisLocalViewChanging = false; graph.__trellisUsersInternalChange = internal; persist(); }
            }
        }
        for (const name of ['foldCells', 'cellsFolded']) if (graph[name]) {
            const original = graph[name];
            graph[name] = function () { const args = arguments; return fold(() => original.apply(this, args)); };
        }

        /** Temporary direct assignments affect synchronous encoding only; no model events or view invalidation occur. */ // NEW
        function canonical(operation) {
            const display = [];
            for (const [cell, state] of authored) {
                display.push([cell, cell.geometry, cell.collapsed]);
                cell.geometry = state.geometry; cell.collapsed = state.collapsed;
            }
            try { return operation(); }
            finally { for (const [cell, geometry, collapsed] of display) { cell.geometry = geometry; cell.collapsed = collapsed; } }
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
        }
        /** Incoming authored objects replace their canonical bases, then the personal view is reapplied. */ // NEW
        function apply(operation) {
            if (applying) return operation(); // NEW
            applying = true; // NEW
            for (const [cell, state] of authored) { cell.geometry = state.geometry; cell.collapsed = state.collapsed; }
            authored.clear();
            try { return operation(); }
            finally { try { restore(); graph.view?.revalidate?.(); } finally { applying = false; } } // CHANGE
        }
        if (ui.getXmlFileData) {
            const encode = ui.getXmlFileData;
            ui.getXmlFileData = function () { const args = arguments; return canonical(() => encode.apply(this, args)); };
        }
        const api = { canonical, apply, restore, isChanging: () => depth > 0, isApplying: () => applying }; // CHANGE
        graph.__trellisLocalView = api;
        ui.editor.addListener?.('fileLoaded', () => { authored.clear(); preferenceKey = ''; restore(); });
        ui.editor.addListener?.('pageSelected', restore);
        root.addEventListener?.('trellisUsersSessionChanged', () => apply(() => {}));
        restore(); return api;
    }
    root.TrellisLocalView = Object.freeze({ install });
})(typeof window !== 'undefined' ? window : globalThis);
