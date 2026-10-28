/** Read-only, bounded object attribution overlays using Change Map's canonical fields. // NEW */
(function (root) {
    'use strict';
    function relativeTime(timestamp, now = Date.now()) { // NEW
        if (!Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(new Date(timestamp).getTime())) return 'time unknown'; // CHANGE
        const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
        if (seconds < 60) return 'just now';
        for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]]) if (seconds >= size) {
            const value = Math.floor(seconds / size); return value + ' ' + unit + (value === 1 ? '' : 's') + ' ago';
        }
    }
    function install(ui) { // NEW
        const graph = ui.editor.graph, model = graph.getModel();
        if (graph.__trellisObjectAttribution || !graph.container) return graph.__trellisObjectAttribution;
        const context = root.TrellisEditContext?.install(ui), users = () => graph.__trellisUsers || root.Trellis?.users;
        let hovered = null, layer = null, timer = null;
        const preferences = new Map(); // NEW: the toggle remains usable when persistent storage is unavailable.
        const preferenceKey = () => 'trellis.objectAttribution:' + (users()?.getCurrentUser?.()?.id || 'anonymous');
        function enabled() { const key = preferenceKey(); if (preferences.has(key)) return preferences.get(key); try { return root.localStorage.getItem(key) !== 'false'; } catch (_) { return true; } } // CHANGE
        function read(cell) { // NEW: retain known historical values; never reconstruct missing facts from the current user.
            const get = key => cell?.getAttribute?.(key) || '';
            const timestamp = key => { const value = Number(get(key)); return Number.isFinite(value) && value > 0 && Number.isFinite(new Date(value).getTime()) ? value : null; }; // CHANGE
            const createdAt = timestamp('createdAt'), createdBy = get('createdByUserId'); // CHANGE
            return { createdAt, createdBy, editedAt: timestamp('lastEditedAt') || createdAt, editedBy: get('lastEditedByUserId') || createdBy }; // CHANGE
        }
        function name(id) { return users()?.listUsers?.().find(user => user.id === id)?.name || (id ? 'Unknown user' : 'Unknown'); } // NEW
        function description(cell, exact = false) { // NEW
            const facts = read(cell), time = value => exact ? value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString() : 'time unknown' : relativeTime(value);
            return ['Created by ' + name(facts.createdBy) + ' ' + time(facts.createdAt), 'Last edited by ' + name(facts.editedBy) + ' ' + time(facts.editedAt)];
        }
        function render() { // NEW: visit only selected/hovered objects, never all diagram cells.
            root.clearTimeout(timer); timer = null;
            layer?.remove(); layer = null;
            if (!enabled()) return;
            const cells = [...new Set([...(graph.getSelectionCells?.() || []), hovered].filter(Boolean).map(cell => context?.logicalCell(cell) || cell))];
            for (const cell of cells) {
                if (!model.isVertex(cell) && !model.isEdge(cell)) continue;
                const state = graph.view?.getState(cell); if (!state) continue;
                if (!layer) { layer = root.document.createElement('div'); layer.dataset.trellisAttributionLayer = ''; layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:19;'; graph.container.appendChild(layer); graph.__trellisOverlayVisibility?.mark(layer); }
                const badge = root.document.createElement('div'); badge.dataset.trellisAttribution = String(cell.id);
                badge.style.cssText = 'position:absolute;pointer-events:none;white-space:nowrap;background:#fff;color:#444;border:1px solid #bbb;border-radius:4px;padding:4px 6px;font:11px/16px Arial;box-shadow:0 1px 4px #0002;';
                badge.style.left = Math.round(state.x) + 'px'; badge.style.top = Math.round(state.y + state.height + 4) + 'px';
                for (const text of description(cell)) { const line = root.document.createElement('div'); line.textContent = text; badge.appendChild(line); }
                badge.title = description(cell, true).join('\n'); badge.setAttribute('role', 'note'); badge.setAttribute('aria-label', badge.title); layer.appendChild(badge);
            }
            if (layer) timer = root.setTimeout(render, 30000);
        }
        graph.addMouseListener?.({ mouseDown() {}, mouseUp() {}, mouseMove(_sender, event) { const cell = event.getCell?.() || null; if (hovered !== cell) { hovered = cell; render(); } } });
        graph.container.addEventListener('mouseleave', () => { hovered = null; render(); });
        graph.getSelectionModel?.().addListener('change', render);
        model.addListener?.('change', render);
        for (const event of ['scale', 'translate', 'scaleAndTranslate']) graph.view?.addListener?.(event, render);
        for (const event of ['fileLoaded', 'pageSelected']) ui.editor.addListener?.(event, () => { hovered = null; render(); });
        for (const event of ['trellisUsersStoreChanged', 'trellisUsersSessionChanged']) root.addEventListener(event, render); // CHANGE
        root.addEventListener('storage', event => { if (event.key) preferences.delete(event.key); else preferences.clear(); render(); }); // NEW
        const action = ui.actions?.addAction('trellisShowObjectAttribution', () => { const value = !enabled(), key = preferenceKey(); preferences.set(key, value); try { root.localStorage.setItem(key, String(value)); } catch (_) {} render(); }); // CHANGE
        if (action) { action.label = 'Show object attribution'; action.setToggleAction?.(true); action.setSelectedCallback?.(enabled); }
        const menu = ui.menus?.get?.('view') || ui.menus?.get?.('extras');
        if (menu) { const original = menu.funct; menu.funct = function (menu, parent) { original?.apply(this, arguments); ui.menus.addMenuItems(menu, ['-', 'trellisShowObjectAttribution'], parent); }; }
        const api = { read, description, render, enabled }; graph.__trellisObjectAttribution = api; return api; // NEW
    }
    root.TrellisObjectAttribution = { install, relativeTime }; // NEW
})(window);
