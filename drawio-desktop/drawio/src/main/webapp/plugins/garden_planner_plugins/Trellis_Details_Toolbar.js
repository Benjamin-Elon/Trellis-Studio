/** Bind draw.io's existing top text toolbar to an independent rich-text field without impersonating its label editor. */ // NEW
(function (root) { // NEW
    'use strict'; // NEW

    /** A selection belongs to exactly one field; delayed dialogs cannot format a different field or a cell label. */ // NEW
    function createTarget(options) { // NEW
        const element = options.element; // NEW
        let selection = null, disposed = false; // NEW
        function saveSelection() { // NEW
            const current = root.getSelection(); // NEW
            if (current && current.rangeCount && element.contains(current.anchorNode) && element.contains(current.focusNode)) selection = current.getRangeAt(0).cloneRange(); // NEW
        } // NEW
        function restoreSelection() { // NEW
            if (disposed || !element.isConnected) return false; // NEW
            element.focus(); // NEW
            const current = root.getSelection(); // NEW
            if (selection && element.contains(selection.startContainer) && element.contains(selection.endContainer)) { current.removeAllRanges(); current.addRange(selection); } // NEW
            else { const range = document.createRange(); range.selectNodeContents(element); range.collapse(false); current.removeAllRanges(); current.addRange(range); } // NEW
            return true; // NEW
        } // NEW
        function execute(command, value) { // NEW
            saveSelection(); // NEW: synchronous toolbar/keyboard actions may precede the browser's selectionchange event.
            if (disposed || !options.canEdit() || !restoreSelection()) return false; // NEW
            if (command === 'fontSizePx') { // NEW
                const size = Number(value); if (!Number.isFinite(size) || size < 1 || size > 999) return false; // NEW
                for (const font of element.querySelectorAll('font[size]')) { const sizes = [0, 10, 13, 16, 18, 24, 32, 48]; font.style.fontSize = (sizes[Number(font.getAttribute('size'))] || 13) + 'px'; font.removeAttribute('size'); } // NEW
                document.execCommand('fontSize', false, '7'); // NEW
                for (const font of element.querySelectorAll('font[size="7"]')) { font.removeAttribute('size'); font.style.fontSize = size + 'px'; } // NEW
            } else if (command === 'createLink') { // NEW
                const link = root.Graph.sanitizeLink(String(value || '').trim()); // NEW
                if (link && !/^(https?:|mailto:|tel:|#)/i.test(link)) return false; // NEW
                if (!link) document.execCommand('unlink', false, null); // NEW
                else if (root.getSelection().isCollapsed) { const anchor = document.createElement('a'); anchor.href = link; anchor.textContent = link; document.execCommand('insertHTML', false, anchor.outerHTML); } // NEW
                else document.execCommand('createLink', false, link); // NEW
            } else document.execCommand(command, false, value == null ? null : value); // NEW
            saveSelection(); options.changed(); return true; // NEW
        } // NEW
        function applyStyles(keys, values) { // NEW
            const commands = { fontFamily: 'fontName', fontSize: 'fontSizePx', fontColor: 'foreColor', labelBackgroundColor: 'backColor' }; // NEW
            if (!keys.every(key => commands[key] || ['fontSource', 'FType'].includes(key))) return false; // NEW
            keys.forEach((key, index) => { if (commands[key]) execute(commands[key], values[index]); }); return true; // NEW
        } // NEW
        function computedStyle() { // NEW
            const node = selection && selection.startContainer; // NEW
            return getComputedStyle(node && element.contains(node) ? node.nodeType === 1 ? node : node.parentElement : element); // NEW
        } // NEW
        return { element, cell: options.cell, canEdit: options.canEdit, execute, applyStyles, saveSelection, restoreSelection, computedStyle, dispose() { disposed = true; selection = null; } }; // NEW
    } // NEW

    /** Scoped menu/action routing is active only while a details field owns the toolbar. Original handlers remain the fallback. */ // NEW
    function install(ui) { // NEW
        if (ui.__trellisDetailsToolbar) return ui.__trellisDetailsToolbar; // NEW
        const graph = ui.editor.graph, removers = []; // NEW
        let active = null, savedToolbar = null, detailNodes = null, detailFont = null, detailSize = null; // NEW
        ui.getActiveRichTextTarget = () => active; // NEW
        function listen(target, event, handler, capture) { target.addEventListener(event, handler, capture); removers.push(() => target.removeEventListener(event, handler, capture)); } // NEW
        function updateFont() { // NEW
            if (!active || !ui.toolbar || !active.element.isConnected) return; // NEW
            const css = active.computedStyle(); // NEW
            ui.toolbar.setFontName(mxUtils.getCssFontFamily(css.fontFamily)); ui.toolbar.setFontSize(parseFloat(css.fontSize) || 13); // NEW
        } // NEW
        function deactivate() { // NEW
            if (!active) return; // NEW
            active.saveSelection(); active = null; // NEW
            if (savedToolbar && ui.toolbar) { // NEW
                detailNodes = Array.from(ui.toolbar.container.childNodes); detailFont = ui.toolbar.fontMenu; detailSize = ui.toolbar.sizeMenu; // NEW
                ui.toolbar.container.replaceChildren(...savedToolbar.nodes); ui.toolbar.fontMenu = savedToolbar.font; ui.toolbar.sizeMenu = savedToolbar.size; // NEW
                savedToolbar = null; // NEW
                delete ui.toolbar.container.dataset.trellisDetailsToolbar; // NEW
            } // NEW
        } // NEW
        function activate(target) { // NEW
            if (active === target) return; // NEW
            if (active) deactivate(); // NEW
            active = target; // NEW
            if (ui.toolbar && ui.toolbar.createTextToolbar) { // NEW
                if (graph.isEditing()) { graph.stopEditing(false); target.element.focus(); } // NEW: finish a real label edit, then preserve the explicit details focus.
                savedToolbar = { nodes: Array.from(ui.toolbar.container.childNodes), font: ui.toolbar.fontMenu, size: ui.toolbar.sizeMenu }; // NEW
                ui.toolbar.container.replaceChildren(); // NEW
                if (detailNodes) { ui.toolbar.container.append(...detailNodes); ui.toolbar.fontMenu = detailFont; ui.toolbar.sizeMenu = detailSize; } // NEW
                else ui.toolbar.createTextToolbar(); // NEW
                ui.toolbar.container.dataset.trellisDetailsToolbar = '1'; // NEW
            } // NEW
            updateFont(); // NEW
        } // NEW

        const commands = { bold: 'bold', italic: 'italic', underline: 'underline', subscript: 'subscript', superscript: 'superscript', undo: 'undo', redo: 'redo', cut: 'cut', copy: 'copy', selectAll: 'selectAll' }; // NEW
        Object.entries(commands).forEach(([key, command]) => { // NEW
            const action = ui.actions && ui.actions.get(key); if (!action) return; // NEW
            const original = action.funct; // NEW
            action.funct = function () { if (active) return active.execute(command); return original.apply(this, arguments); }; // NEW
            removers.push(() => { action.funct = original; }); // NEW
        }); // NEW
        for (const name of ['undo', 'redo']) { // NEW
            if (typeof ui[name] !== 'function') continue; const original = ui[name]; // NEW
            ui[name] = function () { if (active) return active.execute(name); return original.apply(this, arguments); }; // NEW
            removers.push(() => { ui[name] = original; }); // NEW
        } // NEW
        for (const name of ['link', 'insertLink']) { // NEW
            const action = ui.actions && ui.actions.get(name); if (!action) continue; const original = action.funct; // NEW
            action.funct = function () { // NEW
                if (!active) return original.apply(this, arguments); // NEW
                const target = active; target.saveSelection(); // NEW
                if (!target.canEdit()) return; // NEW
                ui.showLinkDialog('', mxResources.get('ok'), value => { if (active === target && value != null) target.execute('createLink', value); }); // NEW
            }; // NEW
            removers.push(() => { action.funct = original; }); // NEW
        } // NEW
        if (ui.menus) { // NEW
            const menus = ui.menus, styleChange = menus.styleChange, promptChange = menus.promptChange, pickColor = menus.pickColor; // NEW
            menus.styleChange = function (menu, label, keys, values, sprite, parent, fn, post, iconOnly, image) { // NEW
                if (!active || !keys.every(key => ['fontFamily', 'fontSize', 'fontSource', 'FType'].includes(key))) return styleChange.apply(this, arguments); // NEW
                const target = active; target.saveSelection(); // NEW
                const row = menu.addItem(label, image, () => { if (active === target) target.applyStyles(keys, values); }, parent, sprite); // NEW
                if (iconOnly) this.showIconOnly(row); return row; // NEW
            }; // NEW
            menus.promptChange = function (menu, label, hint, defaultValue, key, parent, enabled, fn, sprite) { // NEW
                if (!active || !['fontFamily', 'fontSize'].includes(key)) return promptChange.apply(this, arguments); // NEW
                const target = active; // NEW
                return menu.addItem(label, null, () => { // NEW
                    target.saveSelection(); // NEW
                    const dialog = new FilenameDialog(ui, String(defaultValue), mxResources.get('apply'), value => { // NEW
                        if (active !== target || !value) return; target.applyStyles([key], [value]); // NEW
                        if (key === 'fontFamily' && fn) fn(value); // NEW
                    }, mxResources.get('enterValue') + (hint ? ' ' + hint : '')); // NEW
                    ui.showDialog(dialog.container, 300, 80, true, true); dialog.init(); // NEW
                }, parent, sprite, enabled); // NEW
            }; // NEW
            menus.pickColor = function (key, command, defaultValue, defaultColor, defaultColorValue, singleColorMode) { // NEW
                if (!active || !command) return pickColor.apply(this, arguments); // NEW
                const target = active; target.saveSelection(); // NEW
                const css = target.computedStyle(), color = command.toLowerCase() === 'forecolor' ? css.color : css.backgroundColor; // NEW
                ui.pickColor(color, value => { if (active === target) target.execute(command, value === 'none' ? 'transparent' : value); }, defaultColor, defaultColorValue, singleColorMode); // NEW
            }; // NEW
            const blockMenu = menus.get('formatBlock'); // NEW
            if (blockMenu) { // NEW
                const original = blockMenu.funct; // NEW
                blockMenu.funct = function (menu, parent) { // NEW
                    if (!active) return original.apply(this, arguments); // NEW
                    const target = active; target.saveSelection(); // NEW
                    const blocks = [['normal', 'p'], ...[1, 2, 3, 4, 5, 6].map(level => ['heading', 'h' + level]), ['formatted', 'pre'], ['blockquote', 'blockquote']]; // NEW
                    blocks.forEach(([key, tag]) => menu.addItem((mxResources.get(key) || key) + (/^h\d$/.test(tag) ? ' ' + tag.slice(1) : ''), null, () => { if (active === target) target.execute('formatBlock', '<' + tag + '>'); }, parent)); // NEW
                }; // NEW
                removers.push(() => { blockMenu.funct = original; }); // NEW
            } // NEW
            const fontMenu = menus.get('fontFamily'); // NEW
            if (fontMenu) { // NEW
                const original = fontMenu.funct; // NEW
                fontMenu.funct = function (menu, parent) { // NEW
                    if (!active) return original.apply(this, arguments); // NEW
                    const target = active, proxy = Object.create(menu); target.saveSelection(); // NEW
                    proxy.addSeparator = function () { return menu.addSeparator.apply(menu, arguments); }; // NEW
                    proxy.addItem = function (label, icon, callback) { // NEW
                        const args = Array.from(arguments); // NEW
                        if (label === mxResources.get('custom') + '...') args[2] = () => { // NEW
                            const dialog = new FontDialog(ui, target.computedStyle().fontFamily, null, 's', (name, url) => { // NEW
                                if (active !== target || !name) return; menus.addCustomFont(name, url); Graph.addFont(name, url); target.execute('fontName', name); // NEW
                            }); // NEW
                            ui.showDialog(dialog.container, 380, 250, true, true); dialog.init(); // NEW
                        }; // NEW
                        return menu.addItem.apply(menu, args); // NEW
                    }; // NEW
                    return original.call(this, proxy, parent); // NEW
                }; // NEW
                removers.push(() => { fontMenu.funct = original; }); // NEW
            } // NEW
            removers.push(() => { menus.styleChange = styleChange; menus.promptChange = promptChange; menus.pickColor = pickColor; }); // NEW
        } // NEW
        if (ui.toolbar) { // NEW
            listen(ui.toolbar.container, 'mousedown', () => { if (active) active.saveSelection(); }, true); // NEW
            listen(ui.toolbar.container, 'mouseup', updateFont); // NEW
        } // NEW
        listen(document, 'selectionchange', () => { if (active) { active.saveSelection(); updateFont(); } }); // NEW
        const startEditing = graph.cellEditor.startEditing; // NEW
        graph.cellEditor.startEditing = function () { deactivate(); return startEditing.apply(this, arguments); }; // NEW
        removers.push(() => { graph.cellEditor.startEditing = startEditing; }); // NEW
        ui.__trellisDetailsToolbar = { // NEW
            activate, deactivate, createTarget, // NEW
            destroy() { deactivate(); removers.splice(0).reverse().forEach(remove => remove()); delete ui.getActiveRichTextTarget; delete ui.__trellisDetailsToolbar; } // CHANGE: a reopened controller must install a live toolbar adapter.
        }; // NEW
        return ui.__trellisDetailsToolbar; // NEW
    } // NEW
    root.TrellisDetailsToolbar = Object.freeze({ install, createTarget }); // NEW
})(globalThis); // NEW
