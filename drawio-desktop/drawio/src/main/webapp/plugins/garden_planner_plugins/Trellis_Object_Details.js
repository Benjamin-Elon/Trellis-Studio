/** Object-scoped details: persistent content, personal display preferences and selection-driven rich-text overlays. */ // NEW
(function (root) { // NEW
    'use strict'; // NEW
    if (!root.Draw || !Draw.loadPlugin) return; // NEW
    Draw.loadPlugin(function (ui) { // NEW
        function loadToolbar() { // NEW
            const loadComments = () => root.TrellisDetailsComments ? install(ui) : mxscript('plugins/garden_planner_plugins/Trellis_Details_Comments.js', () => install(ui)); // CHANGE
            if (root.TrellisDetailsToolbar) loadComments(); // CHANGE
            else mxscript('plugins/garden_planner_plugins/Trellis_Details_Toolbar.js', loadComments); // CHANGE
        } // NEW
        if (root.TrellisDetailsCore) loadToolbar(); // NEW
        else mxscript('plugins/garden_planner_plugins/Trellis_Details_Core.js', loadToolbar); // NEW
    }); // NEW

    /** Own exactly one graph's listeners and DOM. Model data and display preferences use independent write paths. */ // NEW
    function install(ui) { // NEW
        const graph = ui.editor && ui.editor.graph; // NEW
        if (!graph || graph.__trellisObjectDetails) return; // NEW
        const core = root.TrellisDetailsCore, toolbar = root.TrellisDetailsToolbar.install(ui); // NEW
        const GRAPH_OVERLAY_Z = Object.freeze({ ANNOTATION: 10000, CONNECTION: 10010, CONTROL: 10020, CONTROL_TOP: 10030 }); // NEW
        const entries = new Map(), retainedEntries = new Set(), badges = new Map(), preferences = new Map(), readCache = new WeakMap(), rootIds = new WeakMap(), removers = []; // NEW
        let refreshTimer = null, disposed = false, writing = false, flushing = false, rootSequence = 0, interactionSequence = 0; // CHANGE
        const layer = document.createElement('div'); layer.className = 'trellis-object-details-layer'; // NEW
        graph.__trellisOverlayVisibility?.mark(layer); // NEW: informational overlays must not obstruct manipulation.
        layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:' + GRAPH_OVERLAY_Z.CONTROL + ';pointer-events:none;'; // NEW
        graph.container.appendChild(layer); // NEW
        const previousSelectionAllowed = ui.isSelectionAllowed; // NEW
        if (typeof previousSelectionAllowed === 'function') { // NEW
            /** The host cancels selectstart outside its label editor; independent fields need native caret placement before focus activates their toolbar. */ // NEW
            ui.isSelectionAllowed = function (event) { // NEW
                const source = mxEvent.getSource(event), element = source && (source.nodeType === 1 ? source : source.parentElement); // NEW
                const editor = element && element.closest('.trellis-object-details-editor'); // NEW
                if (editor && layer.contains(editor)) return true; // NEW: read-only text remains selectable; editing still follows canEdit and model permissions.
                return previousSelectionAllowed.apply(this, arguments); // NEW
            }; // NEW
            removers.push(() => { ui.isSelectionAllowed = previousSelectionAllowed; }); // NEW
        } // NEW
        const previousProperties = graph.builtInProperties; graph.builtInProperties = [...previousProperties, core.ATTRIBUTE, core.COMMENTS_ATTRIBUTE]; // CHANGE: discussion metadata belongs to the dedicated overlay.
        removers.push(() => { graph.builtInProperties = previousProperties; }); // NEW
        function model() { return graph.getModel(); } // NEW
        function users() { return graph.__trellisUsers || root.Trellis && root.Trellis.users; } // NEW
        function userKey() { const policy = users(), user = policy && policy.getCurrentUser && policy.getCurrentUser(); return user && user.id || 'anonymous'; } // NEW
        function pageKey() { const page = ui.currentPage; return String(page && (page.getId ? page.getId() : page.node && page.node.getAttribute('id')) || ''); } // NEW
        function diagramKey() { const policy = users(); return policy && policy.getDiagramKey ? policy.getDiagramKey({ create: false }) || '' : ''; } // NEW
        function rootKey() { const cell = model().getRoot(); if (!rootIds.has(cell)) rootIds.set(cell, 'session-' + (++rootSequence)); return rootIds.get(cell); } // NEW
        function preferenceIdentity(cell) { // NEW
            const diagram = diagramKey(); // NEW
            return { key: 'trellis.details.view.v1:' + JSON.stringify([diagram || rootKey(), pageKey(), userKey(), String(cell.id)]), persistent: !!diagram }; // NEW
        } // NEW
        function getPreferences(cell) { // NEW
            const identity = preferenceIdentity(cell); // NEW
            if (!preferences.has(identity.key)) { // NEW
                let value = null; // NEW
                if (identity.persistent) try { value = JSON.parse(root.localStorage.getItem(identity.key)); } catch (_) { /* Session preferences remain usable when storage is unavailable. */ } // NEW
                preferences.set(identity.key, core.normalizePreferences(value)); // NEW
            } // NEW
            return preferences.get(identity.key); // NEW
        } // NEW
        function savePreferences(cell, value) { // NEW
            const identity = preferenceIdentity(cell), normalized = core.normalizePreferences(value); preferences.set(identity.key, normalized); // NEW
            if (identity.persistent) try { root.localStorage.setItem(identity.key, JSON.stringify(normalized)); } catch (_) { /* Local persistence is optional. */ } // NEW
            return normalized; // NEW
        } // NEW
        function read(cell) { // NEW
            const value = cell && cell.value, raw = value && value.getAttribute ? value.getAttribute(core.ATTRIBUTE) || '' : ''; // NEW
            const cached = cell && readCache.get(cell); if (cached && cached.raw === raw) return cached.html; // NEW
            const html = raw ? core.normalizeHtml(raw) : ''; if (cell) readCache.set(cell, { raw, html }); return html; // NEW
        } // NEW
        function readComments(cell) { return cell && cell.value && cell.value.getAttribute ? cell.value.getAttribute(core.COMMENTS_ATTRIBUTE) || '' : ''; } // CHANGE
        function hasContent(cell) { return !!(read(cell) || readComments(cell)); } // CHANGE
        function hasCommentDraft(cell) { return root.TrellisDetailsComments.hasDraft(preferenceIdentity(cell)); } // CHANGE
        /** Keep description and discussion writes independent while preserving every other XML attribute. */ // CHANGE
        function writeComments(entry, raw) { // CHANGE
            if (!canEdit(entry)) throw new Error('The original object is unavailable or editing is no longer permitted.'); // CHANGE
            const previous = entry.cell.value, value = previous && previous.nodeType === 1 ? previous.cloneNode(true) : mxUtils.createXmlDocument().createElement('object'); // CHANGE
            if (!previous || previous.nodeType !== 1) value.setAttribute('label', previous == null ? '' : String(previous)); // CHANGE
            if (raw) value.setAttribute(core.COMMENTS_ATTRIBUTE, raw); else value.removeAttribute(core.COMMENTS_ATTRIBUTE); // CHANGE
            writing = true; entry.model.beginUpdate(); // CHANGE
            try { entry.model.setValue(entry.cell, value); } finally { entry.model.endUpdate(); writing = false; } // CHANGE
            if (readComments(entry.cell) !== raw) throw new Error('The comment change was rejected.'); requestRefresh(); // CHANGE
        } // CHANGE
        function exists(entry) { return !disposed && entry.model === model() && entry.root === model().getRoot() && model().getCell(entry.cell.id) === entry.cell; } // NEW
        function canEdit(entry) { // NEW
            const policy = users(); // NEW
            return exists(entry) && entry.user === userKey() && entry.page === pageKey() && entry.identity.key === preferenceIdentity(entry.cell).key && graph.isEnabled() && (!graph.isCellLocked || !graph.isCellLocked(entry.cell)) && (!policy || !policy.canEditCell || policy.canEditCell(entry.cell)); // CHANGE: a stale panel cannot write into another page or diagram context.
        } // NEW
        function listen(target, event, handler, dom) { // NEW
            if (!target) return; // NEW
            if (dom) { target.addEventListener(event, handler); removers.push(() => target.removeEventListener(event, handler)); } // NEW
            else if (target.addListener) { target.addListener(event, handler); removers.push(() => target.removeListener(handler)); } // NEW
        } // NEW
        function selectedOwners() { return new Set(graph.getSelectionCells().map(cell => core.detailsOwner(cell, model())).filter(Boolean)); } // NEW
        function cellBounds(cell) { // NEW
            const state = graph.view.getState(cell); if (!state) return null; // NEW
            const bounds = model().isEdge(cell) ? core.edgeBounds(state.absolutePoints) : state; if (!bounds) return null; // CHANGE
            const scale = graph.useCssTransforms ? graph.view.scale : 1, translate = graph.useCssTransforms ? graph.view.translate : { x: 0, y: 0 }; // NEW
            return { x: (bounds.x + translate.x) * scale + (graph.panDx || 0), y: (bounds.y + translate.y) * scale + (graph.panDy || 0), width: bounds.width * scale, height: bounds.height * scale }; // CHANGE
        } // NEW
        /** Share screen/export placement while retaining the original vertex inset at each badge size. */ // CHANGE
        function badgeBounds(cell, size = 20) { // CHANGE
            const bounds = cellBounds(cell); if (!bounds) return null; // CHANGE
            return { x: model().isEdge(cell) ? bounds.x - size / 2 : bounds.x + Math.max(4, bounds.width - size - 4), y: model().isEdge(cell) ? bounds.y - size - 4 : bounds.y + 4, width: size, height: size }; // CHANGE
        } // CHANGE
        function title(cell) { const node = document.createElement('div'); node.innerHTML = Graph.sanitizeHtml(graph.convertValueToString(cell)); return node.textContent || 'Object'; } // NEW
        function state(entry, name, error) { // NEW
            entry.error = name === 'failed' ? error || new Error('The details could not be saved.') : null; // NEW
            entry.status.textContent = entry.error ? entry.error.message + ' Your text is retained.' : name === 'pending' ? 'Saving…' : canEdit(entry) ? 'Saved to diagram' : 'Read only'; // NEW
            entry.status.style.color = entry.error ? '#b91c1c' : '#64748b'; entry.recovery.hidden = !entry.error; // NEW
        } // NEW
        function write(entry, html, baseline) { // NEW
            if (!canEdit(entry)) throw new Error(exists(entry) ? 'Editing is no longer permitted.' : 'The original object is no longer available.'); // NEW
            if (read(entry.cell) !== baseline) throw new Error('Details changed elsewhere. Copy your draft before reloading.'); // NEW
            const previous = entry.cell.value; // NEW
            const value = previous && previous.nodeType === 1 ? previous.cloneNode(true) : mxUtils.createXmlDocument().createElement('object'); // NEW
            if (!previous || previous.nodeType !== 1) value.setAttribute('label', previous == null ? '' : String(previous)); // NEW
            if (html) value.setAttribute(core.ATTRIBUTE, html); else value.removeAttribute(core.ATTRIBUTE); // NEW
            writing = true; entry.model.beginUpdate(); // NEW
            try { entry.model.setValue(entry.cell, value); } finally { entry.model.endUpdate(); writing = false; } // NEW
            if (read(entry.cell) !== html) throw new Error('The change was rejected.'); // NEW
            entry.creating = !html && document.activeElement === entry.editor; requestRefresh(); // NEW
        } // NEW
        function removeEntry(entry) { // NEW
            if (entry.comments) entry.comments.destroy(); // CHANGE
            if (ui.getActiveRichTextTarget() === entry.target) toolbar.deactivate(); // NEW
            entry.target.dispose(); entry.draft.dispose(); if (entry.observer) entry.observer.disconnect(); // NEW
            entry.panel.remove(); if (entries.get(entry.cell) === entry) entries.delete(entry.cell); retainedEntries.delete(entry); // NEW
        } // NEW
        function flushEntry(entry, retry = false) { // NEW
            if (entry.error && !retry) return false; // NEW: background serialization must never replay a rejected collaboration edit.
            if (!entry.draft.composing()) entry.draft.edit(entry.editor.innerHTML); // NEW
            return entry.draft.flush(); // NEW
        } // NEW
        function flushAll() { // NEW
            if (writing || flushing) return true; // NEW
            flushing = true; let ok = true; // NEW
            try { for (const entry of entries.values()) if (entry.user === userKey()) { if (entry.comments) entry.comments.persist(); if (entry.draft.dirty() || entry.draft.composing()) ok = flushEntry(entry) && ok; } } // CHANGE
            finally { flushing = false; } // NEW
            return ok; // NEW
        } // NEW
        function requireFlush() { if (!flushAll()) throw new Error('Some details are unsaved. Resolve the retained draft before saving or exporting.'); } // NEW
        function makeButton(label, tooltip, callback) { // NEW
            const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.title = tooltip; button.setAttribute('aria-label', tooltip); // NEW
            button.style.cssText = 'min-width:25px;height:24px;border:1px solid #cbd5e1;border-radius:3px;background:#fff;color:#334155;cursor:pointer;'; // NEW
            button.addEventListener('mousedown', event => event.preventDefault()); button.addEventListener('click', callback); return button; // NEW
        } // NEW
        function positionEntry(entry) { // NEW
            const cellState = exists(entry) && cellBounds(entry.cell); // NEW
            if (!cellState) return; // NEW
            const bounds = core.panelBounds(cellState, entry.preferences); // NEW
            entry.panel.style.left = bounds.x + 'px'; entry.panel.style.top = bounds.y + 'px'; // NEW
            entry.panel.style.width = bounds.width + 'px'; entry.panel.style.height = bounds.height + 'px'; // NEW
            for (const button of entry.arrows.children) { const pressed = button.dataset.side === entry.preferences.side; button.setAttribute('aria-pressed', String(pressed)); button.style.background = pressed ? '#dbeafe' : '#fff'; } // NEW
        } // NEW
        /** Change stacking without detaching a focused editor or the target of an in-flight pointer gesture. */ // NEW
        function bringToFront(entry) { // NEW
            entry.interactionOrder = ++interactionSequence; // NEW
            const ordered = [...entries.values(), ...retainedEntries].sort((a, b) => a.interactionOrder - b.interactionOrder); // NEW
            ordered.forEach((item, index) => { item.panel.style.zIndex = String(GRAPH_OVERLAY_Z.CONTROL - ordered.length + index + 1); }); // NEW: all fields remain below badges while retaining interaction order.
        } // NEW
        /** Match the planting overlay's joined selector without replacing either editor DOM or its native selection. */ // CHANGE
        function installTabs(entry) { // CHANGE
            const row = document.createElement('div'), toggle = document.createElement('div'); // CHANGE
            row.style.cssText = 'padding:4px 6px;flex-shrink:0;border-bottom:1px solid #e2e8f0;'; // CHANGE
            toggle.style.cssText = 'display:inline-flex;align-items:stretch;gap:0;max-width:100%;border:1px solid #c7c7cc;border-radius:4px;overflow:hidden;box-sizing:border-box;'; // CHANGE
            toggle.setAttribute('role', 'group'); toggle.setAttribute('aria-label', 'Details section'); row.appendChild(toggle); // CHANGE
            entry.activeTab = read(entry.cell) || !readComments(entry.cell) && !hasCommentDraft(entry.cell) ? 'info' : 'comments'; entry.tabButtons = []; // CHANGE
            if (badgeStatus(entry.cell).activeAlerts > 0) entry.activeTab = 'alerts'; // CHANGE
            entry.comments = root.TrellisDetailsComments.mount({ entry, core, toolbar, title: title(entry.cell), graph, ui, users, identity: preferenceIdentity(entry.cell), // CHANGE
                button: makeButton, isCurrent: () => exists(entry) && entry.user === userKey(), canEdit: () => canEdit(entry), read: () => readComments(entry.cell), write: raw => writeComments(entry, raw), changed: requestRefresh, flush: flushAll }); // CHANGE
            for (const [key, label] of [['info', 'Additional info'], ['comments', 'Comments'], ['alerts', 'Alerts']]) { // CHANGE
                const button = makeButton(label, 'Show ' + label.toLowerCase(), () => { // CHANGE
                    if (key === entry.activeTab) return; // CHANGE
                    if (entry.activeTab === 'info' && !flushEntry(entry)) return; // CHANGE
                    entry.comments.persist(); toolbar.deactivate(); entry.activeTab = key; entry.creating = true; updateTabs(entry); // CHANGE
                }); // CHANGE
                button.dataset.detailsTab = key; toggle.appendChild(button); entry.tabButtons.push(button); // CHANGE
            } // CHANGE
            entry.panel.insertBefore(row, entry.editor); entry.panel.insertBefore(entry.comments.element, entry.status); updateTabs(entry); // CHANGE
        } // CHANGE
        function updateTabs(entry) { // CHANGE
            let count = '?', activeAlerts = '?'; try { const records = core.parseComments(readComments(entry.cell)); count = records.length; activeAlerts = records.filter(item => item.isAlert && item.resolvedAt === null).length; } catch (_) { /* Keep damaged discussion discoverable. */ } // CHANGE
            for (const button of entry.tabButtons) { // CHANGE
                const active = button.dataset.detailsTab === entry.activeTab; button.setAttribute('aria-pressed', String(active)); // CHANGE
                if (button.dataset.detailsTab === 'comments') button.textContent = 'Comments (' + count + ')'; // CHANGE
                if (button.dataset.detailsTab === 'alerts') button.textContent = 'Alerts (' + activeAlerts + ')'; // CHANGE
                if (root.Trellis && root.Trellis.ui && root.Trellis.ui.applyButtonStyle) root.Trellis.ui.applyButtonStyle(button, 'mode', { compact: true, active }); // CHANGE
                else button.style.cssText = 'box-sizing:border-box;border:0;border-radius:0;padding:3px 6px;font:12px Arial,sans-serif;white-space:nowrap;outline-offset:-2px;cursor:pointer;background:' + (active ? '#ecfeff' : '#fff') + ';color:' + (active ? '#155e75' : '#374151') + ';font-weight:' + (active ? '700' : '400') + ';'; // CHANGE
                button.style.minWidth = '0'; button.style.whiteSpace = 'normal'; button.style.height = 'auto'; button.style.minHeight = '24px'; // CHANGE: the joined selector remains usable at the existing minimum panel width.
            } // CHANGE
            entry.editor.style.display = entry.activeTab === 'info' ? '' : 'none'; entry.status.style.display = entry.activeTab === 'info' ? '' : 'none'; // CHANGE
            entry.comments.element.style.display = entry.activeTab !== 'info' ? '' : 'none'; entry.comments.refresh(); // CHANGE
        } // CHANGE
        function createEntry(cell, creating) { // NEW
            const entry = { cell, model: model(), root: model().getRoot(), page: pageKey(), user: userKey(), identity: preferenceIdentity(cell), preferences: getPreferences(cell), creating: !!creating, error: null }; // CHANGE
            const panel = document.createElement('section'); entry.panel = panel; panel.className = 'trellis-object-details'; panel.dataset.collaborationObjectId = cell.id; // NEW
            panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Details — ' + title(cell)); // NEW
            panel.style.cssText = 'position:absolute;z-index:' + GRAPH_OVERLAY_Z.CONTROL + ';pointer-events:auto;display:flex;flex-direction:column;box-sizing:border-box;min-width:180px;min-height:100px;resize:both;overflow:hidden;border:1px solid #94a3b8;border-radius:5px;background:#fff;color:#111827;box-shadow:0 2px 7px #0002;font:13px/1.4 Arial,sans-serif;'; // NEW
            const header = document.createElement('div'); header.style.cssText = 'display:flex;align-items:center;gap:4px;padding:3px 5px;border-bottom:1px solid #e2e8f0;flex-shrink:0;'; // NEW
            const label = document.createElement('span'); label.textContent = title(cell); label.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;'; header.appendChild(label); // NEW
            entry.arrows = document.createElement('span'); entry.arrows.style.cssText = 'display:flex;gap:2px;'; header.appendChild(entry.arrows); // NEW
            for (const [side, arrow] of [['above', '↑'], ['below', '↓'], ['left', '←'], ['right', '→']]) { // NEW
                const button = makeButton(arrow, 'Place details ' + side, () => { entry.preferences = savePreferences(cell, { ...entry.preferences, side }); positionEntry(entry); }); // NEW
                button.dataset.side = side; entry.arrows.appendChild(button); // NEW
            } // NEW
            entry.editor = document.createElement('div'); entry.editor.className = 'trellis-object-details-editor'; entry.editor.tabIndex = 0; // NEW
            entry.editor.setAttribute('role', 'textbox'); entry.editor.setAttribute('aria-multiline', 'true'); entry.editor.setAttribute('aria-label', 'Details for ' + title(cell)); // NEW
            entry.editor.style.cssText = 'flex:1;min-height:0;padding:8px;overflow:auto;overflow-wrap:anywhere;white-space:normal;outline:none;box-sizing:border-box;'; // NEW
            entry.editor.innerHTML = read(cell); // NEW
            entry.status = document.createElement('div'); entry.status.setAttribute('role', 'status'); entry.status.setAttribute('aria-live', 'polite'); entry.status.style.cssText = 'font-size:10px;padding:2px 6px;flex-shrink:0;'; // NEW
            entry.recovery = document.createElement('div'); entry.recovery.hidden = true; entry.recovery.style.cssText = 'padding:3px;flex-shrink:0;'; // NEW
            entry.recovery.appendChild(makeButton('Retry', 'Retry saving details', () => { flushEntry(entry, true); requestRefresh(); })); // NEW
            entry.recovery.appendChild(makeButton('Copy', 'Copy retained details', () => { const range = document.createRange(); range.selectNodeContents(entry.editor); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.execCommand('copy'); })); // NEW
            entry.recovery.appendChild(makeButton('Discard', 'Discard unsaved details', () => { entry.draft.reload(); removeEntry(entry); requestRefresh(); })); // NEW
            panel.append(header, entry.editor, entry.status, entry.recovery); layer.appendChild(panel); entries.set(cell, entry); // NEW
            entry.draft = core.createDraft({ read: () => read(cell), write: (html, baseline) => write(entry, html, baseline), state: (name, error) => state(entry, name, error) }); // NEW
            entry.target = toolbar.createTarget({ cell, element: entry.editor, canEdit: () => canEdit(entry), changed: () => entry.draft.edit(entry.editor.innerHTML) }); // NEW
            installTabs(entry); // CHANGE
            for (const name of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'keydown', 'keyup', 'keypress']) panel.addEventListener(name, event => event.stopPropagation()); // NEW
            panel.addEventListener('pointerdown', () => bringToFront(entry)); // CHANGE: reparenting here interrupts Chromium focus and native click delivery.
            entry.editor.addEventListener('focus', () => { if (canEdit(entry)) toolbar.activate(entry.target); else toolbar.deactivate(); }); // NEW
            entry.editor.addEventListener('input', () => { if (canEdit(entry)) entry.draft.edit(entry.editor.innerHTML); }); // NEW
            entry.editor.addEventListener('compositionstart', () => entry.draft.beginComposition()); // NEW
            entry.editor.addEventListener('compositionend', () => { entry.draft.endComposition(entry.editor.innerHTML); requestRefresh(); }); // NEW
            entry.editor.addEventListener('blur', () => { entry.target.saveSelection(); flushEntry(entry); entry.creating = false; requestRefresh(); }); // NEW
            entry.editor.addEventListener('keydown', event => { // NEW
                if (event.key === 'Escape') { event.preventDefault(); flushEntry(entry); toolbar.deactivate(); graph.container.focus(); return; } // NEW
                if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 's') { event.preventDefault(); if (flushAll()) { const action = ui.actions.get(event.shiftKey ? 'saveAs' : 'save'); if (action) action.funct(); } return; } // NEW: the field consumes graph shortcuts but retains the native Save shortcut.
                const command = (event.ctrlKey || event.metaKey) && !event.altKey ? { b: 'bold', i: 'italic', u: 'underline', z: event.shiftKey ? 'redo' : 'undo', y: 'redo' }[event.key.toLowerCase()] : null; // NEW
                if (command) { event.preventDefault(); entry.target.saveSelection(); entry.target.execute(command); } // NEW
            }); // NEW
            entry.editor.addEventListener('paste', event => { // NEW
                if (!canEdit(entry)) return; event.preventDefault(); entry.target.saveSelection(); // NEW
                const clipboard = event.clipboardData, html = clipboard && clipboard.getData('text/html'), plain = document.createElement('div'); // NEW
                plain.textContent = clipboard && clipboard.getData('text/plain') || ''; // NEW
                entry.target.execute('insertHTML', core.normalizeHtml(html || plain.innerHTML.replace(/\r?\n/g, '<br>'))); // NEW
            }); // NEW
            entry.editor.addEventListener('drop', event => event.preventDefault()); // NEW
            if (root.ResizeObserver) { // NEW
                entry.observer = new ResizeObserver(() => { // NEW
                    if (disposed || panel.hidden || !exists(entry) || entry.user !== userKey()) return; // NEW
                    if (graph.__trellisOverlayVisibility?.isSuppressed() || !panel.isConnected || !panel.getClientRects().length) return; // NEW: temporary ancestor hiding and detachment are not user resizes.
                    const width = Math.round(panel.offsetWidth), height = Math.round(panel.offsetHeight); // NEW
                    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return; // NEW: read live layout, ignoring zero-sized notifications queued during suppression.
                    if (width !== entry.preferences.width || height !== entry.preferences.height) { entry.preferences = savePreferences(cell, { ...entry.preferences, width, height }); positionEntry(entry); } // NEW
                }); entry.observer.observe(panel); // NEW
            } // NEW
            entry.editor.contentEditable = String(canEdit(entry)); state(entry, 'saved'); positionEntry(entry); bringToFront(entry); return entry; // CHANGE
        } // NEW

        /** Read saved content only; unsupported discussion remains discoverable without implying a known resolution state. */ // CHANGE
        function badgeStatus(cell) { // CHANGE
            const hasDetails = !!read(cell); // CHANGE
            try { // CHANGE
                const comments = core.parseComments(readComments(cell)); // CHANGE
                return { hasDetails, commentCount: comments.length, unresolvedCount: comments.filter(comment => comment.resolvedAt === null).length, activeAlerts: comments.filter(comment => comment.isAlert && comment.resolvedAt === null).length }; // CHANGE
            } catch (_) { return { hasDetails, commentCount: null, unresolvedCount: null, activeAlerts: null }; } // CHANGE
        } // CHANGE

        /** Badges occupy the inside corner; collaboration activity labels occupy the outside corner. */ // NEW
        function updateBadge(cell) { // NEW
            const bounds = badgeBounds(cell), status = badgeStatus(cell); let badge = badges.get(cell); // CHANGE
            if (!bounds || !status.hasDetails && status.commentCount === 0) { if (badge) { badge.remove(); badges.delete(cell); } return; } // CHANGE
            if (!badge) { // NEW
                badge = makeButton('', '', () => { // CHANGE
                    const selected = selectedOwners().has(cell), preferences = getPreferences(cell); // NEW
                    if (!selected) graph.setSelectionCell(cell); // NEW
                    const entry = entries.get(cell); if (selected && entry && !flushEntry(entry)) return; // NEW
                    savePreferences(cell, { ...preferences, visible: selected ? !preferences.visible : true }); requestRefresh(); // NEW
                }); // NEW
                badge.className = 'trellis-object-details-badge'; badge.dataset.cellId = cell.id; // NEW
                badge.style.cssText = 'position:absolute;z-index:' + GRAPH_OVERLAY_Z.CONTROL_TOP + ';pointer-events:auto;box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:20px;height:20px;min-width:20px;padding:2px;border:1px solid #2563eb;border-radius:50%;color:#1e40af;font:bold 12px Arial;cursor:pointer;'; // CHANGE
                const center = document.createElement('span'); center.setAttribute('aria-hidden', 'true'); center.textContent = 'i'; // CHANGE
                center.style.cssText = 'display:block;flex:none;width:14px;height:14px;border-radius:50%;line-height:14px;text-align:center;'; badge.appendChild(center); // CHANGE
                for (const name of ['pointerdown', 'mousedown', 'mouseup', 'click', 'keydown', 'keyup']) badge.addEventListener(name, event => event.stopPropagation()); // NEW
                badges.set(cell, badge); layer.appendChild(badge); // NEW
            } // NEW
            badge.style.backgroundColor = status.hasDetails ? '#1e40af' : '#eff6ff'; // CHANGE
            badge.firstElementChild.style.backgroundColor = status.unresolvedCount > 0 ? '#facc15' : '#eff6ff'; // CHANGE
            badge.style.outline = status.activeAlerts > 0 ? '2px solid #dc2626' : ''; badge.style.outlineOffset = status.activeAlerts > 0 ? '1px' : ''; // CHANGE
            const commentStatus = status.unresolvedCount === null ? 'Comment status unavailable' : status.unresolvedCount + ' unresolved comment' + (status.unresolvedCount === 1 ? '' : 's'); // CHANGE
            const alertStatus = status.activeAlerts === null ? 'Alert status unavailable' : status.activeAlerts + ' active alert' + (status.activeAlerts === 1 ? '' : 's'); // CHANGE
            badge.title = 'Show or hide details for ' + title(cell) + '. ' + (status.hasDetails ? 'Extra details available' : 'No extra details') + '. ' + commentStatus + '. ' + alertStatus + '.'; badge.setAttribute('aria-label', badge.title); // CHANGE
            badge.style.left = bounds.x + 'px'; badge.style.top = bounds.y + 'px'; // CHANGE
        } // NEW
        function refresh() { // NEW
            if (disposed) return; refreshTimer = null; // NEW
            const selected = selectedOwners(), currentUser = userKey(), live = new Set(); // NEW
            for (const cell of Object.values(model().cells || {})) if (core.detailsOwner(cell, model()) === cell && hasContent(cell)) { live.add(cell); updateBadge(cell); } // CHANGE
            for (const [cell, badge] of badges) if (!live.has(cell)) { badge.remove(); badges.delete(cell); } // NEW
            for (const entry of Array.from(entries.values())) if (entry.user === currentUser && !entry.draft.dirty() && (entry.page !== pageKey() || entry.identity.key !== preferenceIdentity(entry.cell).key)) removeEntry(entry); // CHANGE: private comment drafts never follow reused cell IDs into another context.
            for (const entry of Array.from(entries.values())) if (entry.user !== currentUser) { // NEW
                if (entry.draft.dirty()) { entry.draft.cancel(); entry.panel.hidden = true; entry.panel.style.display = 'none'; entries.delete(entry.cell); retainedEntries.add(entry); } // NEW
                else removeEntry(entry); // NEW
            } // NEW
            for (const entry of Array.from(retainedEntries)) if (entry.user === currentUser && !entries.has(entry.cell)) { retainedEntries.delete(entry); entries.set(entry.cell, entry); } // NEW: a deleted original still exposes its retained draft when its author returns.
            for (const cell of selected) { const preferences = getPreferences(cell); if (preferences.visible && (hasContent(cell) || hasCommentDraft(cell)) && !entries.has(cell)) createEntry(cell); } // CHANGE
            for (const entry of Array.from(entries.values())) { // NEW
                if (entry.user !== currentUser) { entry.panel.hidden = true; entry.panel.style.display = 'none'; entry.draft.cancel(); continue; } // NEW
                const onPage = exists(entry) && entry.page === pageKey(), preferences = onPage ? getPreferences(entry.cell) : entry.preferences; // NEW
                entry.preferences = preferences; // NEW
                if (onPage && !cellBounds(entry.cell)) { entry.panel.hidden = true; entry.panel.style.display = 'none'; entry.draft.cancel(); continue; } // CHANGE: retain private work without showing an unanchored overlay.
                const showing = onPage && cellBounds(entry.cell) && selected.has(entry.cell) && preferences.visible && (hasContent(entry.cell) || entry.creating || entry.draft.dirty() || entry.comments.hasDraft() || entry.panel.contains(document.activeElement)); // CHANGE
                if (!showing && !entry.error) { if (!flushEntry(entry)) { entry.panel.hidden = false; continue; } removeEntry(entry); continue; } // NEW
                entry.panel.hidden = false; entry.panel.style.display = 'flex'; entry.editor.contentEditable = String(canEdit(entry)); // NEW
                updateTabs(entry); // CHANGE
                if (onPage) { // NEW
                    const current = read(entry.cell); // NEW
                    if (current !== entry.draft.baseline() && !entry.draft.dirty() && !entry.error) entry.editor.innerHTML = entry.draft.reload(); // NEW
                    positionEntry(entry); // NEW
                } else if (!entry.error) state(entry, 'failed', new Error('The original object is no longer available.')); // NEW
                if (!entry.error && !entry.draft.dirty()) state(entry, 'saved'); // NEW
            } // NEW
            for (const [cell, badge] of badges) { const entry = entries.get(cell); badge.setAttribute('aria-expanded', String(!!entry && !entry.panel.hidden)); } // CHANGE: announce the final panel state after creation or removal in this refresh.
        } // NEW
        function requestRefresh() { if (!disposed && refreshTimer == null) refreshTimer = root.setTimeout(refresh, 0); } // NEW
        function open(cell) { // NEW
            cell = core.detailsOwner(cell, model()); if (!cell) return; // NEW
            if (!graph.isCellSelected(cell)) graph.addSelectionCell(cell); // NEW
            const preferences = savePreferences(cell, { ...getPreferences(cell), visible: true }); // NEW
            let entry = entries.get(cell); if (!entry) entry = createEntry(cell, true); entry.creating = true; entry.preferences = preferences; // NEW
            if (!cellBounds(cell)) { entry.panel.hidden = true; entry.panel.style.display = 'none'; requestRefresh(); return; } // CHANGE
            positionEntry(entry); entry.panel.hidden = false; entry.panel.style.display = 'flex'; if (entry.activeTab !== 'info') entry.comments.focus(); else entry.editor.focus(); requestRefresh(); // CHANGE
        } // NEW

        /** Export snapshots are display data, with screen dimensions converted to unscaled diagram coordinates. */ // NEW
        function exportProjection() { // NEW
            requireFlush(); refresh(); // NEW
            const records = [], scale = graph.view.scale, translate = graph.view.translate; // NEW
            const geometry = bounds => ({ x: (bounds.x - (graph.panDx || 0)) / scale - translate.x, y: (bounds.y - (graph.panDy || 0)) / scale - translate.y, width: bounds.width / scale, height: bounds.height / scale }); // NEW
            for (const entry of Array.from(entries.values()).sort((a, b) => a.interactionOrder - b.interactionOrder)) { // CHANGE: exports follow visual stacking independently of DOM order.
                if (!exists(entry) || entry.user !== userKey() || entry.panel.hidden || entry.error || !read(entry.cell)) continue; // NEW
                const measuring = entry.editor.cloneNode(true); measuring.removeAttribute('contenteditable'); // NEW
                measuring.style.cssText = 'position:absolute;visibility:hidden;left:-100000px;top:0;box-sizing:border-box;width:' + entry.preferences.width + 'px;padding:8px;overflow-wrap:anywhere;white-space:normal;font:13px/1.4 Arial,sans-serif;'; // NEW
                measuring.innerHTML = read(entry.cell); document.body.appendChild(measuring); const height = Math.max(1, measuring.scrollHeight); // NEW
                const typography = Array.from(measuring.querySelectorAll('*'), element => ({ element, values: ['fontSize', 'marginLeft', 'marginRight', 'paddingLeft'].map(property => [property, parseFloat(getComputedStyle(element)[property]) || 0]) })); // NEW
                for (const { element, values } of typography) for (const [property, value] of values) if (value) element.style[property] = value / scale + 'px'; // NEW: font tags, headings and list indents preserve wrapping at every zoom level.
                const bounds = core.panelBounds(cellBounds(entry.cell), entry.preferences, height); // NEW
                const html = '<div style="font-size:' + 13 / scale + 'px;line-height:1.4;font-family:Arial,sans-serif;">' + measuring.innerHTML + '</div>'; measuring.remove(); // NEW
                records.push({ ownerId: entry.cell.id, html, fontSize: 13 / scale, padding: 8 / scale, geometry: geometry(bounds) }); // NEW
            } // NEW
            for (const cell of badges.keys()) { // CHANGE
                if (!read(cell)) continue; // CHANGE: comment-only badges never enter rendered exports.
                const bounds = badgeBounds(cell, 18); if (!bounds) continue; // CHANGE: exports share edge anchors and keep the original 18px appearance.
                records.push({ ownerId: cell.id, badge: true, fontSize: 14 / scale, geometry: geometry(bounds) }); // CHANGE
            } // NEW
            return { [pageKey()]: records }; // NEW
        } // NEW
        function createExportGraph(snapshot = exportProjection()) { // NEW
            const container = document.createElement('div'); // NEW
            container.style.cssText = 'position:absolute;left:-100000px;top:0;visibility:hidden;'; document.body.appendChild(container); // NEW
            const temporary = new Graph(container); temporary.setStylesheet(graph.getStylesheet()); // NEW
            const xml = new mxCodec().encode(model()); new mxCodec(xml.ownerDocument).decode(xml, temporary.getModel()); // NEW
            for (const key of ['background', 'backgroundImage', 'pageFormat', 'pageScale', 'pageVisible', 'mathEnabled']) temporary[key] = graph[key]; // NEW
            temporary.model.beginUpdate(); // NEW
            try { // NEW
                for (const original of Object.values(model().cells)) { // NEW
                    const copy = temporary.model.getCell(original.id); if (!copy || !model().isVertex(original) && !model().isEdge(original)) continue; // NEW
                    const geometry = graph.getCellGeometry(original); if (geometry) temporary.model.setGeometry(copy, geometry.clone()); // NEW
                    const style = graph.getCellStyle(original); // NEW
                    temporary.model.setStyle(copy, Object.entries(style).filter(([, value]) => typeof value === 'string' || typeof value === 'number').map(([key, value]) => key + '=' + value).join(';') + ';'); // NEW
                    const value = copy.value && copy.value.cloneNode ? copy.value.cloneNode(true) : mxUtils.createXmlDocument().createElement('object'); // NEW
                    value.setAttribute('label', graph.getLabel(original)); temporary.model.setValue(copy, value); // NEW: preserve instance-specific Trellis labels and projected geometry in the isolated graph.
                    if (!graph.isCellVisible(original)) temporary.model.setVisible(copy, false); // NEW
                } // NEW
            } finally { temporary.model.endUpdate(); } // NEW
            if (root.TrellisRoadmapRenderer && graph.getExportVariables) { const variables = graph.getExportVariables(); TrellisRoadmapRenderer.applyProjection(temporary, variables.__trellisRoadmapProjection, pageKey()); } // NEW
            core.applyProjection(temporary, snapshot, pageKey()); // NEW
            temporary.view.scaleAndTranslate(graph.view.scale, graph.view.translate.x, graph.view.translate.y); // NEW
            const selected = new Set(graph.getSelectionCells().map(cell => cell.id)), owners = new Set(Array.from(selectedOwners(), cell => cell.id)); // NEW
            const isIncluded = owner => { for (let cell = owner; cell; cell = model().getParent(cell)) if (selected.has(cell.id) || owners.has(cell.id)) return true; return false; }; // NEW
            temporary.setSelectionCells(Object.values(temporary.model.cells).filter(cell => selected.has(cell.id) || cell.__trellisDetailsOwner && isIncluded(cell.__trellisDetailsOwner))); // NEW
            temporary.__trellisDetailsCleanup = () => { temporary.destroy(); container.remove(); }; return temporary; // NEW
        } // NEW

        const baseSvg = graph.getSvg, baseVariables = graph.getExportVariables; // NEW
        graph.getSvg = function () { // NEW
            const snapshot = exportProjection(); if (!snapshot[pageKey()].length) return baseSvg.apply(this, arguments); // NEW
            const temporary = createExportGraph(snapshot); // NEW
            try { // NEW
                const args = Array.from(arguments); // NEW
                if (args[13]) { // NEW
                    const included = new Set(args[13].map(cell => cell.id)); // NEW
                    args[13] = args[13].map(cell => temporary.model.getCell(cell.id)).filter(Boolean); // NEW
                    args[13].push(...Object.values(temporary.model.cells).filter(cell => { for (let owner = cell.__trellisDetailsOwner; owner; owner = temporary.model.getParent(owner)) if (included.has(owner.id)) return true; return false; })); // NEW
                } // NEW
                return baseSvg.apply(temporary, args); // NEW
            } finally { temporary.__trellisDetailsCleanup(); } // NEW
        }; // NEW
        graph.getExportVariables = function () { return { ...(baseVariables ? baseVariables.apply(this, arguments) : {}), __trellisDetailsProjection: exportProjection() }; }; // NEW
        removers.push(() => { graph.getSvg = baseSvg; graph.getExportVariables = baseVariables; }); // NEW
        for (const name of ['getFileData', 'saveFile', 'save', 'selectPage', 'fileLoaded']) { // NEW
            if (typeof ui[name] !== 'function') continue; const original = ui[name]; // NEW
            ui[name] = function () { // NEW
                if (name === 'getFileData') { // NEW
                    if (!writing && !flushing && !model().updateLevel && !graph.__trellisSharingApplying && !graph.__trellisUsersRejecting) flushAll(); // NEW
                } else requireFlush(); // NEW: explicit save, export and navigation retain failed drafts; internal model snapshots always serialize canonical state.
                if (name === 'selectPage' || name === 'fileLoaded') toolbar.deactivate(); return original.apply(this, arguments); // NEW
            }; // NEW
            removers.push(() => { ui[name] = original; }); // NEW
        } // NEW
        listen(graph.getSelectionModel(), mxEvent.CHANGE, () => { flushAll(); if (!selectedOwners().size) toolbar.deactivate(); requestRefresh(); }); // NEW
        listen(model(), mxEvent.CHANGE, () => { // NEW
            if (!writing && graph.__trellisSharingApplying) for (const entry of entries.values()) if (exists(entry) && read(entry.cell) !== entry.draft.baseline()) { entry.draft.retain(entry.editor.innerHTML); state(entry, 'failed', new Error('The collaboration change was rejected or replaced.')); } // NEW
            requestRefresh(); // NEW
        }); // NEW
        for (const name of [mxEvent.UNDO, mxEvent.REDO]) listen(ui.editor.undoManager, name, () => { for (const entry of entries.values()) if (exists(entry)) { entry.editor.innerHTML = entry.draft.reload(); entry.error = null; } requestRefresh(); }); // NEW
        for (const name of [mxEvent.SCALE, mxEvent.TRANSLATE, mxEvent.SCALE_AND_TRANSLATE]) listen(graph.view, name, requestRefresh); // NEW
        listen(graph, mxEvent.PAN, requestRefresh); listen(graph.container, 'scroll', requestRefresh, true); // NEW
        listen(root, 'resize', requestRefresh, true); // NEW
        listen(root, 'trellisUsersSessionChanged', () => { toolbar.deactivate(); requestRefresh(); }, true); // NEW
        listen(ui.editor, 'fileLoaded', requestRefresh); listen(ui.editor, 'pageSelected', requestRefresh); // NEW
        listen(document, 'pointerdown', event => { // NEW
            const target = ui.getActiveRichTextTarget(); if (!target) return; // NEW
            if (target.element.contains(event.target) || event.target.closest('.trellis-object-details,.geToolbarContainer,.mxPopupMenu,.geDialog')) return; // NEW
            flushAll(); toolbar.deactivate(); // NEW
        }, true); // NEW
        listen(root, 'beforeunload', event => { if (!flushAll() || [...entries.values(), ...retainedEntries].some(entry => entry.draft.dirty() || entry.comments.needsUnloadWarning())) { event.preventDefault(); event.returnValue = ''; } }, true); // CHANGE: warn when private work could not be retained durably.
        function destroy() { // NEW
            if (disposed) return; flushAll(); disposed = true; if (refreshTimer != null) clearTimeout(refreshTimer); // NEW
            for (const entry of [...entries.values(), ...retainedEntries]) removeEntry(entry); toolbar.destroy(); // NEW
            removers.splice(0).reverse().forEach(remove => remove()); layer.remove(); // NEW
        } // NEW
        listen(graph, mxEvent.DESTROY, destroy); // NEW
        graph.__trellisObjectDetails = { open, refresh, flush: flushAll, exportProjection, createExportGraph, destroy }; // NEW
        function registerMenu() { // NEW
            root.TrellisContextMenu.install(ui); root.TrellisContextMenu.register({ // NEW
                id: 'objectDetails', priority: 850, addItems(menu, clicked) { // NEW
                    const cell = core.detailsOwner(clicked, model()); if (!cell) return; // NEW
                    const policy = users(), editable = graph.isEnabled() && (!policy || !policy.canEditCell || policy.canEditCell(cell)); // NEW
                    if (!hasContent(cell) && !editable) return; // CHANGE
                    menu.addSeparator(); menu.addItem((hasContent(cell) ? editable ? 'Edit details…' : 'View details…' : 'Add details…') + (cell !== clicked ? ' (planting group)' : ''), null, () => open(cell)); // CHANGE
                } // NEW
            }); // NEW
        } // NEW
        if (root.TrellisContextMenu) registerMenu(); else mxscript('plugins/garden_planner_plugins/Trellis_Context_Menu.js', registerMenu); // NEW
        requestRefresh(); // NEW
    } // NEW
})(globalThis); // NEW
