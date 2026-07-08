/**
 * Draw.io Plugin: Trellis UI Cleanup
 *
 * Keeps Trellis' primary drawing surface compact while preserving draw.io's
 * less common commands behind explicit overflow submenus.
 */

Draw.loadPlugin(function (ui) {
    if (!ui || ui.__trellisUiCleanupInstalled) {
        return;
    }

    ui.__trellisUiCleanupInstalled = true;

    const menus = ui.menus;
    const actions = ui.actions;

    const MENU_LABELS = {
        file: 'More draw.io file options',
        edit: 'More draw.io edit options',
        view: 'More draw.io view options',
        arrange: 'More draw.io arrange options',
        extras: 'More draw.io extras',
        help: 'More draw.io help options'
    };

    const ACTION_LABELS = {
        synchronize: 'Synchronize',
        newLibrary: 'New Library',
        openLibraryFrom: 'Open Library',
        pageSetup: 'Page Setup',
        close: 'Close',
        exit: 'Exit',
        desktopResetZoom: 'Actual Size',
        desktopZoomIn: 'Zoom In',
        desktopZoomOut: 'Zoom Out'
    };

    function getMenu(name) {
        return menus && typeof menus.get === 'function' ? menus.get(name) : null;
    }

    function getAction(actionKey) {
        return actions && typeof actions.get === 'function' ? actions.get(actionKey) : null;
    }

    function getActionLabel(actionKey) {
        const action = getAction(actionKey);
        return ACTION_LABELS[actionKey] || (action && action.label) || actionKey;
    }

    function getOwner(parent) {
        return parent && parent.tbody ? parent : null;
    }

    function getRows(menu, parent) {
        const owner = getOwner(parent) || menu;
        const tbody = owner && owner.tbody;
        return tbody ? Array.prototype.slice.call(tbody.children || []) : [];
    }

    function isSeparator(row) {
        return !!(row && row.querySelector && row.querySelector('.mxPopupMenuSeparator'));
    }

    function getRowText(row) {
        return (row && (row.innerText || row.textContent) || '').trim();
    }

    function normalizeLabel(value) {
        return String(value || '').replace(/\.\.\./g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function hideRowsByLabels(menu, parent, labels) {
        if (!menu || !labels || !labels.length) {
            return;
        }

        const labelSet = labels.reduce(function (result, label) {
            const normalized = normalizeLabel(label);
            if (normalized) result[normalized] = true;
            return result;
        }, {});

        getRows(menu, parent).forEach(function (row) {
            if (isSeparator(row)) return;
            const text = normalizeLabel(getRowText(row));
            const matched = Object.keys(labelSet).some(function (label) {
                return text === label || text.indexOf(label) === 0;
            });
            if (matched) {
                row.style.display = 'none';
            }
        });

        cleanSeparators(menu, parent);
    }

    function cleanSeparators(menu, parent) {
        const rows = getRows(menu, parent);
        let previousVisibleWasSeparator = true;
        let lastVisibleSeparator = null;

        rows.forEach(function (row) {
            if (row.style && row.style.display === 'none') return;

            if (isSeparator(row)) {
                if (previousVisibleWasSeparator) {
                    row.style.display = 'none';
                } else {
                    lastVisibleSeparator = row;
                    previousVisibleWasSeparator = true;
                }
                return;
            }

            lastVisibleSeparator = null;
            previousVisibleWasSeparator = false;
        });

        if (lastVisibleSeparator) {
            lastVisibleSeparator.style.display = 'none';
        }
    }

    function addSeparator(menu, parent) {
        if (menu && typeof menu.addSeparator === 'function') {
            menu.addSeparator(parent || null);
        }
    }

    function addSubmenu(menu, parent, label) {
        if (!menu || typeof menu.addItem !== 'function') {
            return null;
        }

        return menu.addItem(label, null, null, parent || null);
    }

    function addActionItem(menu, parent, actionKey, labelOverride) {
        const action = getAction(actionKey);
        if (!action || !menu || typeof menu.addItem !== 'function') {
            return false;
        }

        menu.addItem(labelOverride || getActionLabel(actionKey), null, function () {
            if (typeof action.funct === 'function') {
                action.funct();
            }
        }, parent || null);
        return true;
    }

    function addActionGroup(menu, parent, actionKeys) {
        let added = false;

        actionKeys.forEach(function (actionKey) {
            if (actionKey === '-') {
                if (added) addSeparator(menu, parent);
                added = false;
                return;
            }

            added = addActionItem(menu, parent, actionKey) || added;
        });

        cleanSeparators(menu, parent);
    }

    function addNamedSubmenu(menu, parent, menuKey, labelOverride) {
        if (!menus || typeof menus.addSubmenu !== 'function') {
            return false;
        }

        if (typeof menus.get === 'function' && !menus.get(menuKey)) {
            return false;
        }

        menus.addSubmenu(menuKey, menu, parent || null, labelOverride || null);
        return true;
    }

    function addMenuOverflow(menu, parent, label, buildItems) {
        const submenu = addSubmenu(menu, parent, label);
        if (submenu && typeof buildItems === 'function') {
            buildItems(submenu);
            cleanSeparators(menu, submenu);
        }
        return submenu;
    }

    function withOriginalMenu(menuName, replacement) {
        const menu = getMenu(menuName);
        if (!menu || typeof replacement !== 'function') {
            return;
        }

        const originalFunct = typeof menu.funct === 'function' ? menu.funct : function () {};
        menu.funct = function (menuInstance, parent) {
            return replacement.call(this, menuInstance, parent || null, originalFunct);
        };
    }

    function installFileCleanup() {
        withOriginalMenu('file', function (menu, parent, originalFunct) {
            originalFunct.call(this, menu, parent);
            hideRowsByLabels(menu, parent, [
                getActionLabel('synchronize'),
                getActionLabel('newLibrary'),
                getActionLabel('openLibraryFrom'),
                getActionLabel('pageSetup'),
                getActionLabel('close'),
                getActionLabel('exit')
            ]);

            addSeparator(menu, parent);
            addMenuOverflow(menu, parent, MENU_LABELS.file, function (submenu) {
                addActionItem(menu, submenu, 'synchronize');
                addNamedSubmenu(menu, submenu, 'newLibrary', ACTION_LABELS.newLibrary) ||
                    addActionItem(menu, submenu, 'newLibrary', ACTION_LABELS.newLibrary);
                addNamedSubmenu(menu, submenu, 'openLibraryFrom', ACTION_LABELS.openLibraryFrom) ||
                    addActionItem(menu, submenu, 'openLibraryFrom', ACTION_LABELS.openLibraryFrom);
                addActionItem(menu, submenu, 'pageSetup');
                addActionItem(menu, submenu, 'close');
                addActionItem(menu, submenu, 'exit');
            });
            cleanSeparators(menu, parent);
        });
    }

    function installEditCleanup() {
        withOriginalMenu('edit', function (menu, parent) {
            addMenuOverflow(menu, parent, MENU_LABELS.edit, function (submenu) {
                addActionGroup(menu, submenu, [
                    'undo', 'redo', '-',
                    'cut', 'copy', 'copyAsImage', 'copyAsSvg', 'paste', 'delete', 'duplicate', '-',
                    'findReplace', '-',
                    'editData', 'editTooltip', 'editStyle', 'editGeometry', 'edit', 'editLink', 'openLink', '-',
                    'selectVertices', 'selectEdges', 'selectAll', 'selectNone', '-',
                    'lockUnlock'
                ]);
            });
        });
    }

    function installViewCleanup() {
        withOriginalMenu('view', function (menu, parent) {
            addActionItem(menu, parent, 'grid');
            addActionItem(menu, parent, 'guides');
            addSeparator(menu, parent);
            addMenuOverflow(menu, parent, MENU_LABELS.view, function (submenu) {
                addActionGroup(menu, submenu, [
                    'format', 'toggleShapes', 'pageTabs', 'ruler', 'search', 'scratchpad',
                    'findReplace', 'outline', 'layers', 'tags', 'comments', '-',
                    'pageView', 'pageScale', 'tooltips', 'animations', 'connectionArrows',
                    'connectionPoints', '-',
                    'resetView', 'zoomIn', 'zoomOut', 'fullscreen'
                ]);
            });
            cleanSeparators(menu, parent);
        });
    }

    function installArrangeCleanup() {
        withOriginalMenu('arrange', function (menu, parent) {
            addMenuOverflow(menu, parent, MENU_LABELS.arrange, function (submenu) {
                addActionGroup(menu, submenu, ['toFront', 'toBack', 'bringForward', 'sendBackward']);
                addNamedSubmenu(menu, submenu, 'direction');
                addNamedSubmenu(menu, submenu, 'turn');
                addNamedSubmenu(menu, submenu, 'align');
                addNamedSubmenu(menu, submenu, 'distribute');
                addNamedSubmenu(menu, submenu, 'navigation');
                addNamedSubmenu(menu, submenu, 'insert');
                addNamedSubmenu(menu, submenu, 'layout');
                addActionGroup(menu, submenu, ['group', 'ungroup', 'removeFromGroup', '-', 'clearWaypoints', 'autosize']);
            });
        });
    }

    function installExtrasCleanup() {
        withOriginalMenu('extras', function (menu, parent, originalFunct) {
            addActionItem(menu, parent, 'plugins');
            addActionItem(menu, parent, 'trellisRestoreBuiltInDatabase');
            addSeparator(menu, parent);
            addMenuOverflow(menu, parent, MENU_LABELS.extras, function (submenu) {
                originalFunct.call(this, menu, submenu);
                hideRowsByLabels(menu, submenu, [
                    getActionLabel('plugins'),
                    getActionLabel('trellisRestoreBuiltInDatabase')
                ]);
            });
            cleanSeparators(menu, parent);
        });
    }

    function installHelpCleanup() {
        withOriginalMenu('help', function (menu, parent, originalFunct) {
            originalFunct.call(this, menu, parent);
            hideRowsByLabels(menu, parent, [
                getActionLabel('desktopResetZoom'),
                getActionLabel('desktopZoomIn'),
                getActionLabel('desktopZoomOut')
            ]);

            addSeparator(menu, parent);
            addMenuOverflow(menu, parent, MENU_LABELS.help, function (submenu) {
                addActionItem(menu, submenu, 'desktopResetZoom', ACTION_LABELS.desktopResetZoom);
                addActionItem(menu, submenu, 'desktopZoomIn', ACTION_LABELS.desktopZoomIn);
                addActionItem(menu, submenu, 'desktopZoomOut', ACTION_LABELS.desktopZoomOut);
            });
            cleanSeparators(menu, parent);
        });
    }

    function removeChild(child) {
        if (child && child.parentNode) {
            child.parentNode.removeChild(child);
        }
    }

    function pruneMainToolbar() {
        const container = ui.toolbar && ui.toolbar.container;
        if (!container || !container.children) {
            return;
        }

        Array.prototype.slice.call(container.children).forEach(function (child, index) {
            if (index > 0) {
                removeChild(child);
            }
        });
    }

    function pruneHeaderToolbar() {
        const container = ui.toolbarContainer;
        if (!container || !container.querySelector) {
            return;
        }

        const toolbarEnd = container.querySelector('.geToolbarEnd');
        if (!toolbarEnd || !toolbarEnd.children) {
            return;
        }

        while (toolbarEnd.children.length > 2) {
            removeChild(toolbarEnd.children[0]);
        }
    }

    function pruneToolbar() {
        pruneMainToolbar();
        pruneHeaderToolbar();
    }

    function applyStartupLayout() {
        if (typeof ui.setCompactMode === 'function') {
            ui.setCompactMode(true, false, 0);
        }

        if (typeof ui.toggleShapesPanel === 'function') {
            ui.toggleShapesPanel(false);
        }

        if (typeof ui.toggleFormatPanel === 'function') {
            ui.toggleFormatPanel(false);
        }

        pruneToolbar();

        if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
            window.setTimeout(pruneToolbar, 0);
        }
    }

    installFileCleanup();
    installEditCleanup();
    installViewCleanup();
    installArrangeCleanup();
    installExtrasCleanup();
    installHelpCleanup();
    applyStartupLayout();
});
