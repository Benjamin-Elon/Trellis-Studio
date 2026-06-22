/**
 * Draw.io Plugin: Context Menu Submenus for Copy/Paste, Move, and Edit
 *
 * - Adds tidy standard draw.io submenus to normal cell right-click menus. // CHANGE
 *   - "Copy / Paste": cut, copy, copy as image, copy as SVG, duplicate
 *   - "Move / Arrange": to front, to back, bring forward, send backward // CHANGE
 *   - "Edit Shape": edit style, edit data, edit link, edit connection points // CHANGE
 *   - "Style": set as default style // NEW
 * - Hides the original top-level entries for those actions to clean up the menu.
 * - Cleans up leftover separators after hiding items.
 * - Suppresses draw.io XML data hover tooltips for Trellis-owned cells. // NEW
 */

Draw.loadPlugin(function (ui) {
    const graph = ui.editor && ui.editor.graph;
    if (!graph) {
        return;
    }

    if (graph.__contextSubmenusInstalled) {
        return;
    }
    graph.__contextSubmenusInstalled = true;

    // -----------------------------
    // 1. Configuration
    // -----------------------------

    const COPY_PASTE_ACTIONS = [
        'cut',
        'copy',
        'copyAsImage',
        'copyAsSvg',
        'duplicate'
    ];

    const MOVE_ACTIONS = [
        'toFront',
        'toBack',
        'bringForward',
        'sendBackward'
    ];

    const EDIT_ACTIONS = [
        'editStyle',
        'editData',
        'editLink',
        'editConnectionPoints' // NEW
    ];

    const STYLE_ACTIONS = [ // NEW
        'setAsDefaultStyle' // NEW
    ]; // NEW

    const COPY_PASTE_LABEL = 'Copy / Paste';
    const STANDARD_ACTIONS_LABEL = 'Standard draw.io actions'; // NEW
    const MOVE_LABEL = 'Move / Arrange'; // CHANGE
    const EDIT_LABEL = 'Edit Shape'; // CHANGE
    const STYLE_LABEL = 'Style'; // NEW

    // Manual display labels for actions (human-friendly)
    const DISPLAY_LABELS = {
        cut: 'Cut',
        copy: 'Copy',
        copyAsImage: 'Copy As Image',
        copyAsSvg: 'Copy As SVG',
        duplicate: 'Duplicate',

        toFront: 'To Front',
        toBack: 'To Back',
        bringForward: 'Bring Forward',
        sendBackward: 'Send Backward',

        editStyle: 'Edit Style',
        editData: 'Edit Data',
        editLink: 'Edit Link',
        editConnectionPoints: 'Edit Connection Points', // CHANGE

        setAsDefaultStyle: 'Set As Default Style' // NEW
    };

    // -----------------------------
    // 2. Helpers
    // -----------------------------

    /**
     * Reads an XML-backed cell attribute without assuming the value type.
     */
    function getCellAttribute(cell, key) { // NEW
        if (cell && typeof cell.getAttribute === 'function') { // NEW
            return cell.getAttribute(key); // NEW
        } // NEW
        return null; // NEW
    } // NEW

    /**
     * Identifies cells owned by Trellis features.
     */
    function isTrellisCell(cell) { // NEW
        if (!cell) return false; // NEW

        const trellisFlags = [ // NEW
            'garden_module', // NEW
            'garden_bed', // NEW
            'tiler_group', // NEW
            'plant_tiler', // NEW
            'kanban_card', // NEW
            'garden_dashboard' // NEW
        ]; // NEW

        for (let i = 0; i < trellisFlags.length; i++) { // NEW
            if (getCellAttribute(cell, trellisFlags[i]) === '1') return true; // NEW
        } // NEW

        return String(getCellAttribute(cell, 'board_key') || '').trim().length > 0; // NEW
    } // NEW

    /**
     * Detects whether the graph currently has selected cells for selection-driven cell menus.
     */
    function getSelectedCells() { // NEW
        return graph.getSelectionCells ? (graph.getSelectionCells() || []) : []; // NEW
    } // NEW

    function hasSelectedCells() { // CHANGE
        const selectedCells = getSelectedCells(); // CHANGE
        return !!(selectedCells && selectedCells.length > 0); // CHANGE
    } // CHANGE

    /**
     * Applies the tidy standard-actions menu to cell or selected-cell context menus.
     */
    function shouldUseTidyStandardActionsMenu(cell) { // CHANGE
        return !!cell || hasSelectedCells(); // CHANGE
    } // CHANGE

    /**
     * Keeps Trellis-owned cells on the nested standard actions menu while regular cells get top-level tidy submenus.
     */
    function shouldNestTidySubmenusUnderStandardActions(cell) { // NEW
        if (cell) return isTrellisCell(cell); // NEW

        const selectedCells = getSelectedCells(); // NEW
        if (!selectedCells.length) return false; // NEW

        return selectedCells.every(function (selectedCell) { // NEW
            return isTrellisCell(selectedCell); // NEW
        }); // NEW
    } // NEW

    function getDisplayLabelForAction(actionKey) {
        if (Object.prototype.hasOwnProperty.call(DISPLAY_LABELS, actionKey)) {
            return DISPLAY_LABELS[actionKey];
        }
        const action = ui.actions.get(actionKey);
        if (action && action.label) {
            return action.label;
        }
        return actionKey;
    }

    /**
     * Adds a menu item for a named UI action to the given menu/submenu.
     * Uses manual display labels for consistency.
     */
    function addActionMenuItem(menu, parent, actionKey) {
        const action = ui.actions.get(actionKey);
        if (!action) {
            return;
        }

        const label = getDisplayLabelForAction(actionKey);

        menu.addItem(label, null, function () {
            if (typeof action.funct === 'function') {
                action.funct();
            }
        }, parent);
    }

    /**
     * Hides the first menu row whose text matches the given candidates
     * (case-insensitive, exact or simple substring match).
     */
    function hideRowByLabelCandidates(menu, labelCandidates) {
        if (!menu || !menu.div) {
            return;
        }

        const rows = menu.div.getElementsByTagName('tr');
        if (!rows || !rows.length) {
            return;
        }

        const normalizedCandidates = (labelCandidates || [])
            .map(function (s) {
                return (s || '').trim().toLowerCase();
            })
            .filter(function (s) {
                return s.length > 0;
            });

        if (!normalizedCandidates.length) {
            return;
        }

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (row.tbody) continue; // NEW

            const text = (row.innerText || row.textContent || '').trim().toLowerCase();
            if (!text) continue;

            const match = normalizedCandidates.some(function (cand) {
                return text === cand || text.indexOf(cand) !== -1;
            });

            if (match) {
                row.style.display = 'none';
                break; // hide first match only
            }
        }
    }

    /**
     * Hides all top-level menu items for the given action keys by trying:
     * - the action's native label
     * - the manual display label
     * - a spaced version of camelCase if applicable
     */
    function hideOriginalActionItems(menu, actionKeys) {
        if (!Array.isArray(actionKeys)) return;

        actionKeys.forEach(function (key) {
            const action = ui.actions.get(key);
            const nativeLabel = action && action.label ? action.label : null;
            const displayLabel = DISPLAY_LABELS[key] || nativeLabel || key;

            const candidates = [];
            if (nativeLabel) candidates.push(nativeLabel);
            if (DISPLAY_LABELS[key]) candidates.push(DISPLAY_LABELS[key]);

            if (
                !DISPLAY_LABELS[key] &&
                nativeLabel &&
                /^[a-z]+([A-Z][a-z0-9]+)+$/.test(nativeLabel)
            ) {
                const spaced = nativeLabel.replace(/([a-z])([A-Z])/g, '$1 $2');
                candidates.push(spaced);
            }

            if (!candidates.length) {
                candidates.push(displayLabel);
            }

            hideRowByLabelCandidates(menu, candidates);
        });
    }

    /**
     * Builds one submenu with items mapped from the given action keys.
     */
    function buildSubmenu(menu, title, actionKeys, parent) { // CHANGE
        if (!actionKeys || !actionKeys.length) {
            return null;
        }

        const submenuParent = menu.addItem(title, null, null, parent); // CHANGE

        actionKeys.forEach(function (key) {
            addActionMenuItem(menu, submenuParent, key); // CHANGE
        });

        return submenuParent; // CHANGE
    }

    function buildTidyActionSubmenus(menu, parent) { // NEW
        buildSubmenu(menu, COPY_PASTE_LABEL, COPY_PASTE_ACTIONS, parent); // NEW
        buildSubmenu(menu, MOVE_LABEL, MOVE_ACTIONS, parent); // NEW
        buildSubmenu(menu, EDIT_LABEL, EDIT_ACTIONS, parent); // NEW
        buildSubmenu(menu, STYLE_LABEL, STYLE_ACTIONS, parent); // NEW
    } // NEW

    /**
     * Builds the grouped standard draw.io submenu for Trellis cell menus.
     */
    function buildStandardActionsSubmenu(menu) { // NEW
        const parent = menu.addItem(STANDARD_ACTIONS_LABEL, null, null); // NEW
        buildTidyActionSubmenus(menu, parent); // CHANGE
        return parent; // NEW
    } // NEW

    /**
     * Removes hidden rows and collapses redundant separators.
     */
    function cleanSeparators(menu) {
        if (!menu || !menu.div) return;

        // Remove rows that are fully hidden (old items we set display:none)
        let rows = Array.from(menu.div.querySelectorAll('tr'));

        rows.forEach(function (row) {
            if (row.style && row.style.display === 'none') {
                if (row.parentNode) row.parentNode.removeChild(row);
            }
        });

        // Recompute rows after removing hidden ones
        rows = Array.from(menu.div.querySelectorAll('tr'));

        function isSeparator(row) {
            if (!row) return false;

            // Separator class on <tr>
            if (row.classList && row.classList.contains('mxPopupMenuSeparator')) return true;

            // Separator class on descendants (<td>, <div>, etc.)
            if (row.querySelector('.mxPopupMenuSeparator')) return true;

            // HR-based separator
            if (row.querySelector('hr')) return true;

            // Treat completely empty spacer rows as separators
            const text = (row.innerText || row.textContent || '')
                .replace(/\u00a0/g, ' ')
                .trim();

            if (!text) {
                const tds = row.getElementsByTagName('td');
                if (tds.length <= 1) return true;
            }

            return false;
        }

        // Remove leading separators
        while (rows.length && isSeparator(rows[0])) {
            rows[0].remove();
            rows.shift();
        }

        // Remove trailing separators
        while (rows.length && isSeparator(rows[rows.length - 1])) {
            rows[rows.length - 1].remove();
            rows.pop();
        }

        // Remove consecutive separators
        for (let i = 1; i < rows.length; i++) {
            if (isSeparator(rows[i]) && isSeparator(rows[i - 1])) {
                rows[i].remove();
                rows.splice(i, 1);
                i--;
            }
        }
    }

    /**
     * Main post-processor to reorganize the popup menu.
     */
    function reorganizeContextMenu(menu, cell, evt) {
        // Only adjust cell or selected-cell popups; leave blank-canvas menus alone. // CHANGE
        if (!shouldUseTidyStandardActionsMenu(cell)) { // CHANGE
            return;
        }

        // Add tidy draw.io submenus. Trellis cells keep the nested standard actions parent. // CHANGE
        menu.addSeparator();
        if (shouldNestTidySubmenusUnderStandardActions(cell)) { // NEW
            buildStandardActionsSubmenu(menu); // CHANGE
        } else { // NEW
            buildTidyActionSubmenus(menu, null); // NEW
        } // NEW

        // Hide originals
        hideOriginalActionItems(menu, COPY_PASTE_ACTIONS);
        hideOriginalActionItems(menu, MOVE_ACTIONS);
        hideOriginalActionItems(menu, EDIT_ACTIONS);
        hideOriginalActionItems(menu, STYLE_ACTIONS); // NEW

        // Cleanup separators (and remove hidden rows)
        cleanSeparators(menu);
    }

    /**
     * Prevents Trellis metadata attributes from showing as draw.io hover tooltips.
     */
    function installTrellisTooltipSuppression() { // NEW
        if (graph.__trellisTooltipsSuppressedInstalled) { // NEW
            return; // NEW
        } // NEW
        graph.__trellisTooltipsSuppressedInstalled = true; // NEW

        const oldGetTooltipForCell = graph.getTooltipForCell; // NEW
        graph.getTooltipForCell = function (cell) { // NEW
            if (isTrellisCell(cell)) { // NEW
                return ''; // NEW
            } // NEW

            if (typeof oldGetTooltipForCell === 'function') { // NEW
                return oldGetTooltipForCell.apply(this, arguments); // NEW
            } // NEW

            return ''; // NEW
        }; // NEW
    } // NEW

    // -----------------------------
    // 3. Install graph hooks // CHANGE
    // -----------------------------

    installTrellisTooltipSuppression(); // NEW

    function registerTrellisContextMenuContributor(contributor) { // NEW
        function finishRegistration() { // NEW
            if (!window.TrellisContextMenu) return; // NEW
            window.TrellisContextMenu.install(ui); // NEW
            window.TrellisContextMenu.register(contributor); // NEW
        } // NEW

        if (window.TrellisContextMenu) { // NEW
            finishRegistration(); // NEW
        } else if (typeof mxscript === "function") { // NEW
            mxscript("plugins/garden_planner_plugins/Trellis_Context_Menu.js", finishRegistration); // NEW
        } // NEW
    } // NEW

    registerTrellisContextMenuContributor({ // CHANGE
        id: "tidyContextMenu", // NEW
        priority: 900, // NEW
        addItems: function (menu, cell, evt) { // CHANGE
            try {
                reorganizeContextMenu(menu, cell, evt);
            } catch (e) {
                if (window && window.console && console.error) {
                    console.error('Context submenu plugin error:', e);
                }
            }
        } // CHANGE
    }); // CHANGE
});
