/**
 * Draw.io Plugin: Trellis UI Cleanup
 *
 * Keeps Trellis' primary drawing surface compact while preserving draw.io's
 * less common commands behind explicit overflow submenus.
 */

(function () { // NEW
    if (typeof window === 'undefined') return; // NEW

    window.Trellis = window.Trellis || {}; // NEW
    window.Trellis.ui = window.Trellis.ui || {}; // NEW

    const BUTTON_TOKENS = Object.freeze({ // NEW
        open: { border: '#2563eb', color: '#1d4ed8', background: '#fff', hoverBackground: '#eff6ff' }, // NEW
        add: { border: '#188038', color: '#166534', background: '#fff', hoverBackground: '#f0fdf4' }, // NEW
        danger: { border: '#b91c1c', color: '#b91c1c', background: '#fff', hoverBackground: '#fef2f2' }, // NEW
        neutral: { border: '#6b7280', color: '#111827', background: '#fff', hoverBackground: '#f9fafb' }, // NEW
        focus: 'rgba(37, 99, 235, 0.28)', // NEW
        disabledOpacity: '0.55' // NEW
    }); // NEW

    function normalizeButtonVariant(variant) { // NEW
        return BUTTON_TOKENS[variant] ? variant : 'neutral'; // NEW
    } // NEW

    function classForVariant(variant) { // NEW
        return 'trellis-button trellis-button-' + normalizeButtonVariant(variant); // NEW
    } // NEW

    function ensureButtonStyles(doc) { // NEW
        const owner = doc || (typeof document !== 'undefined' ? document : null); // NEW
        if (!owner || owner.getElementById('trellis-shared-button-styles')) return; // NEW

        const style = owner.createElement('style'); // NEW
        style.id = 'trellis-shared-button-styles'; // NEW
        style.textContent = [ // NEW
            '.trellis-button{box-sizing:border-box;border-radius:6px;cursor:pointer;font:12px Arial,sans-serif;padding:6px 10px;background:#fff;transition:background-color 120ms ease,border-color 120ms ease,color 120ms ease}', // NEW
            '.trellis-button-open{border:1px solid #2563eb;color:#1d4ed8}', // NEW
            '.trellis-button-open:hover{background:#eff6ff}', // NEW
            '.trellis-button-add{border:1px solid #188038;color:#166534}', // NEW
            '.trellis-button-add:hover{background:#f0fdf4}', // NEW
            '.trellis-button-add.trellis-button-filled{background:#188038;color:#fff}', // NEW
            '.trellis-button-add.trellis-button-filled:hover{background:#166534}', // NEW
            '.trellis-button-danger{border:1px solid #b91c1c;color:#b91c1c}', // NEW
            '.trellis-button-danger:hover{background:#fef2f2}', // NEW
            '.trellis-button-neutral{border:1px solid #6b7280;color:#111827}', // NEW
            '.trellis-button-neutral:hover{background:#f9fafb}', // NEW
            '.trellis-button-compact{padding:3px 6px;font-size:12px}', // NEW
            '.trellis-button:disabled,.trellis-button[aria-disabled="true"]{opacity:.55;cursor:not-allowed}', // NEW
            '.trellis-button:focus-visible{outline:2px solid #2563eb;outline-offset:2px;box-shadow:0 0 0 3px rgba(37,99,235,.28)}' // NEW
        ].join('\n'); // NEW
        (owner.head || owner.documentElement || owner.body).appendChild(style); // NEW
    } // NEW

    function applyButtonStyle(button, variant, options) { // NEW
        if (!button || !button.style) return button; // NEW
        const opts = options || {}; // NEW
        const normalized = normalizeButtonVariant(variant); // NEW
        const tokens = BUTTON_TOKENS[normalized]; // NEW
        ensureButtonStyles(button.ownerDocument); // NEW

        ['trellis-button', 'trellis-button-open', 'trellis-button-add', 'trellis-button-danger', 'trellis-button-neutral', 'trellis-button-compact', 'trellis-button-filled'].forEach(function (className) { // NEW
            if (button.classList) button.classList.remove(className); // NEW
        }); // NEW
        if (button.classList) { // NEW
            button.classList.add('trellis-button', 'trellis-button-' + normalized); // NEW
            if (opts.compact) button.classList.add('trellis-button-compact'); // NEW
            if (opts.filled) button.classList.add('trellis-button-filled'); // NEW
        } // NEW
        button.setAttribute('data-trellis-button-variant', normalized); // NEW
        button.type = button.type || 'button'; // NEW
        button.style.border = '1px solid ' + tokens.border; // NEW
        button.style.borderRadius = opts.radius || '6px'; // NEW
        button.style.background = opts.filled && normalized === 'add' ? tokens.border : tokens.background; // NEW
        button.style.color = opts.filled && normalized === 'add' ? '#fff' : tokens.color; // NEW
        button.style.cursor = button.disabled ? 'not-allowed' : 'pointer'; // NEW
        button.style.font = opts.font || '12px Arial, sans-serif'; // NEW
        button.style.padding = opts.compact ? '3px 6px' : (opts.padding || '6px 10px'); // NEW
        button.style.boxSizing = 'border-box'; // NEW
        return button; // NEW
    } // NEW

    function button(label, variant, onClick, options) { // NEW
        const b = document.createElement('button'); // NEW
        b.type = 'button'; // NEW
        b.textContent = String(label == null ? '' : label); // NEW
        applyButtonStyle(b, variant, options); // NEW
        if (options && options.title != null) b.title = String(options.title); // NEW
        if (options && options.ariaLabel != null) b.setAttribute('aria-label', String(options.ariaLabel)); // NEW
        if (typeof onClick === 'function') b.addEventListener('click', onClick); // NEW
        return b; // NEW
    } // NEW

    window.Trellis.ui.buttonTokens = BUTTON_TOKENS; // NEW
    window.Trellis.ui.applyButtonStyle = window.Trellis.ui.applyButtonStyle || applyButtonStyle; // NEW
    window.Trellis.ui.button = window.Trellis.ui.button || button; // NEW
    window.Trellis.ui.classForVariant = window.Trellis.ui.classForVariant || classForVariant; // NEW
    window.Trellis.ui.ensureButtonStyles = window.Trellis.ui.ensureButtonStyles || ensureButtonStyles; // NEW
})(); // NEW

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

    function shouldPreserveMainToolbarChild(child, index) { // CHANGE
        return index === 0 || !!(child && child.classList && child.classList.contains('geZoomInput')); // CHANGE
    } // CHANGE

    function pruneMainToolbar() {
        const container = ui.toolbar && ui.toolbar.container;
        if (!container || !container.children) {
            return;
        }

        Array.prototype.slice.call(container.children).forEach(function (child, index) {
            if (!shouldPreserveMainToolbarChild(child, index)) { // CHANGE
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
