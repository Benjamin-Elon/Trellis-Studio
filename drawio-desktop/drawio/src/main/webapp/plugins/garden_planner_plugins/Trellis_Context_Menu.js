/**
 * Trellis Plugin: Deterministic Context Menu Dispatcher
 *
 * - Provides window.TrellisContextMenu for Trellis-owned context menu contributors. // NEW
 * - Calls draw.io's original popup factory once, then runs Trellis contributors in priority order. // NEW
 * - Keeps contributor ordering independent of plugin script load timing. // NEW
 */
(function () {
    if (typeof window === 'undefined') return; // NEW

    function createTrellisContextMenuRegistry() { // NEW
        const contributorsById = Object.create(null); // NEW
        let popupMenuHandler = null; // NEW
        let baseFactory = null; // NEW
        let editorUi = null; // NEW

        function getOrderedContributors() { // NEW
            return Object.keys(contributorsById) // NEW
                .map(function (id) { return contributorsById[id]; }) // NEW
                .sort(function (a, b) { // NEW
                    const priorityDelta = Number(a.priority || 0) - Number(b.priority || 0); // NEW
                    return priorityDelta || String(a.id).localeCompare(String(b.id)); // NEW
                }); // NEW
        } // NEW

        function dispatchContextMenu(menu, cell, evt) { // NEW
            if (typeof baseFactory === 'function') { // NEW
                baseFactory.apply(this, arguments); // NEW
            } // NEW

            getOrderedContributors().forEach(function (contributor) { // NEW
                try { // NEW
                    contributor.addItems(menu, cell, evt, editorUi); // NEW
                } catch (e) { // NEW
                    if (window.console && console.error) { // NEW
                        console.error('Trellis context menu contributor error:', contributor.id, e); // NEW
                    } // NEW
                } // NEW
            }); // NEW
        } // NEW

        return { // NEW
            install: function (ui) { // NEW
                const graph = ui && ui.editor && ui.editor.graph; // NEW
                const nextPopupMenuHandler = graph && graph.popupMenuHandler; // NEW
                if (!nextPopupMenuHandler) return this; // NEW

                editorUi = ui; // NEW

                if (popupMenuHandler === nextPopupMenuHandler && nextPopupMenuHandler.__trellisContextMenuDispatcherInstalled) { // NEW
                    return this; // NEW
                } // NEW

                popupMenuHandler = nextPopupMenuHandler; // NEW
                baseFactory = popupMenuHandler.factoryMethod; // NEW
                popupMenuHandler.factoryMethod = dispatchContextMenu; // NEW
                popupMenuHandler.__trellisContextMenuDispatcherInstalled = true; // NEW
                return this; // NEW
            }, // NEW

            register: function (contributor) { // NEW
                if (!contributor || !contributor.id || typeof contributor.addItems !== 'function') return; // NEW
                contributorsById[String(contributor.id)] = { // NEW
                    id: String(contributor.id), // NEW
                    priority: Number(contributor.priority || 0), // NEW
                    addItems: contributor.addItems // NEW
                }; // NEW
            }, // NEW

            _getOrderedIdsForTests: function () { // NEW
                return getOrderedContributors().map(function (contributor) { return contributor.id; }); // NEW
            } // NEW
        }; // NEW
    } // NEW

    window.TrellisContextMenu = window.TrellisContextMenu || createTrellisContextMenuRegistry(); // NEW

    if (typeof Draw !== 'undefined' && Draw.loadPlugin) { // NEW
        Draw.loadPlugin(function (ui) { // NEW
            window.TrellisContextMenu.install(ui); // NEW
        }); // NEW
    } // NEW
})();
