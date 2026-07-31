/**
 * Trellis Plugin: Deterministic Context Menu Dispatcher
 *
 * - Provides window.TrellisContextMenu for Trellis-owned context menu contributors.
 * - Calls draw.io's original popup factory once, then runs Trellis contributors in priority order.
 * - Keeps contributor ordering independent of plugin script load timing.
 */
(function () {
    if (typeof window === 'undefined') return;

    function createTrellisContextMenuRegistry() {
        const contributorsById = Object.create(null);
        let popupMenuHandler = null;
        let baseFactory = null;
        let editorUi = null;

        function getOrderedContributors() {
            return Object.keys(contributorsById)
                .map(function (id) { return contributorsById[id]; })
                .sort(function (a, b) {
                    const priorityDelta = Number(a.priority || 0) - Number(b.priority || 0);
                    return priorityDelta || String(a.id).localeCompare(String(b.id));
                });
        }

        function dispatchContextMenu(menu, cell, evt) {
            if (typeof baseFactory === 'function') {
                baseFactory.apply(this, arguments);
            }

            getOrderedContributors().forEach(function (contributor) {
                try {
                    contributor.addItems(menu, cell, evt, editorUi);
                } catch (e) {
                    if (window.console && console.error) {
                        console.error('Trellis context menu contributor error:', contributor.id, e);
                    }
                }
            });
        }

        return {
            install: function (ui) {
                const graph = ui && ui.editor && ui.editor.graph;
                const nextPopupMenuHandler = graph && graph.popupMenuHandler;
                if (!nextPopupMenuHandler) return this;

                editorUi = ui;

                if (popupMenuHandler === nextPopupMenuHandler && nextPopupMenuHandler.__trellisContextMenuDispatcherInstalled) {
                    return this;
                }

                popupMenuHandler = nextPopupMenuHandler;
                baseFactory = popupMenuHandler.factoryMethod;
                popupMenuHandler.factoryMethod = dispatchContextMenu;
                popupMenuHandler.__trellisContextMenuDispatcherInstalled = true;
                return this;
            },

            register: function (contributor) {
                if (!contributor || !contributor.id || typeof contributor.addItems !== 'function') return;
                contributorsById[String(contributor.id)] = {
                    id: String(contributor.id),
                    priority: Number(contributor.priority || 0),
                    addItems: contributor.addItems
                };
            },

            _getOrderedIdsForTests: function () {
                return getOrderedContributors().map(function (contributor) { return contributor.id; });
            }
        };
    }

    window.TrellisContextMenu = window.TrellisContextMenu || createTrellisContextMenuRegistry();

    if (typeof Draw !== 'undefined' && Draw.loadPlugin) {
        Draw.loadPlugin(function (ui) {
            window.TrellisContextMenu.install(ui);
        });
    }
})();
