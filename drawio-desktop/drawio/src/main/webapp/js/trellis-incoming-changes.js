/** Incoming changes are view reconciliation, never diagram edits or journal submissions. */ // NEW
(function (root) {
    'use strict';
    function create(ui, options) {
        const graph = ui.editor.graph, document = root.document;
        const badges = new Map(); // NEW: stationary badges retain their DOM, focus, and hover state.
        let groups = [], layer = null, toolbar = null, panel = null, review = null, selection = null, pinned = false, hideTimer = null, busy = false, generation = 0, panelMessage = ''; // CHANGE
        const pageId = () => ui.currentPage?.getId?.() || ui.currentPage?.node?.getAttribute('id') || '';
        const mark = node => graph.__trellisOverlayVisibility?.mark(node);
        const note = (parent, text) => { const element = document.createElement('div'); element.textContent = text; parent.appendChild(element); return element; };
        function button(parent, label, action) {
            const element = document.createElement('button'); element.type = 'button'; element.textContent = label;
            root.Trellis?.ui?.applyButtonStyle?.(element, 'neutral');
            element.addEventListener('click', event => { event.stopPropagation(); Promise.resolve(action(event)).catch(error => options.status(error.message)); });
            parent.appendChild(element); return element;
        }
        function close(force = false) { if (busy && !force) return; panel?.remove(); panel = null; review = null; selection = null; pinned = false; panelMessage = ''; generation++; root.clearTimeout(hideTimer); } // CHANGE: dismissal cannot cancel a patch awaiting its durable checkpoint.
        function navigate(key) {
            const [page, id] = JSON.parse(key), targetPage = ui.pages?.find(item => item.getId() === page);
            if (targetPage && page !== pageId()) ui.selectPage(targetPage);
            const cell = graph.getModel().getCell(id);
            if (cell) { graph.__trellisModules?.clusters?.revealCell(cell); graph.setSelectionCell(cell); graph.scrollCellToVisible(cell); }
            else options.status('This object is not in the displayed view. Refresh its related group to display it.');
        }
        function appendDetails(section, detail) { // NEW: both structural and object reviews use the same accessible disclosure.
            if (!detail?.fields.length) return;
            const expanded = document.createElement('details'), title = document.createElement('summary'); title.textContent = 'Before / after'; expanded.appendChild(title);
            for (const field of detail.fields) {
                const name = ({ label: 'Name', geometry: 'Position and size', style: 'Appearance', trellis_comments_json: 'Comments and alerts', trellis_details_html: 'Details', trellis_users_json: 'People and permissions' })[field.name] || field.name.replace(/_/g, ' ');
                note(expanded, name.charAt(0).toUpperCase() + name.slice(1)).style.fontWeight = '600';
                const values = document.createElement('pre'); values.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font:11px monospace;';
                values.textContent = 'Before: ' + field.before + '\nAfter: ' + field.after; expanded.appendChild(values);
            }
            section.appendChild(expanded);
        }
        function renderReview(message) {
            if (!panel) return;
            if (message !== undefined) panelMessage = message; // NEW
            panel.replaceChildren();
            note(panel, selection ? 'Incoming changes' : 'All incoming changes').style.fontWeight = '700';
            if (panelMessage) note(panel, panelMessage).setAttribute('role', 'status'); // CHANGE
            const visible = review?.groups || groups.filter(group => !selection || selection.includes(group.id));
            for (const group of visible) {
                const section = document.createElement('details'); section.open = true;
                const heading = document.createElement('summary'); heading.textContent = (group.structural ? 'Page / project structure' : 'Related changes') + ' · ' + group.objects.length + (group.objects.length === 1 ? ' object' : ' objects'); section.appendChild(heading); // CHANGE
                if (group.authors.length) note(section, 'Changed by ' + group.authors.join(', '));
                if (group.structural) { note(section, 'Refresh affects the entire project, including all pages.'); appendDetails(section, review?.details.find(item => item.key === '*')); } // NEW
                for (const object of group.objects) {
                    button(section, object.label + ' · ' + object.operation, () => navigate(object.key));
                    const detail = review?.details.find(item => item.key === object.key);
                    appendDetails(section, detail); // CHANGE
                }
                panel.appendChild(section);
            }
            if (!visible.length) note(panel, 'No incoming differences.');
            const apply = button(panel, selection ? 'Refresh related changes' : 'Refresh All', refresh);
            apply.disabled = busy || !review || !visible.length;
            button(panel, 'Close', () => close()); // CHANGE
        }
        async function show(anchor, ids = null, pin = false) {
            if (busy) return; // NEW: keep the submitted review stable until acknowledgement or rollback.
            if (panel && pinned && pin && panel.__anchor === anchor) { close(); return; } // NEW
            close(); selection = ids; pinned = pin;
            panel = document.createElement('div'); panel.className = 'trellis-incoming-review'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Incoming changes');
            panel.__anchor = anchor; // NEW
            panel.style.cssText = 'position:fixed;z-index:10020;box-sizing:border-box;width:400px;max-width:calc(100vw - 16px);max-height:65vh;overflow:auto;background:#fff;color:#111827;border:1px solid #b56a00;border-radius:7px;padding:10px;box-shadow:0 6px 18px #0003;font:12px Arial;line-height:1.5;';
            const bounds = anchor.getBoundingClientRect(); panel.style.left = Math.max(8, Math.min(bounds.left, root.innerWidth - 408)) + 'px'; panel.style.top = Math.max(8, Math.min(bounds.bottom + 4, root.innerHeight * .3)) + 'px';
            document.body.appendChild(panel); mark(panel); renderReview('Loading review…');
            panel.addEventListener('mouseenter', () => root.clearTimeout(hideTimer)); panel.addEventListener('mouseleave', scheduleHide);
            for (const event of ['pointerdown', 'mousedown', 'keydown', 'keypress', 'keyup']) panel.addEventListener(event, value => { value.stopPropagation(); if (value.key === 'Escape') close(); });
            const captured = generation, result = await options.coordinate({ kind: 'review', groups: ids || undefined });
            if (!panel || captured !== generation) return;
            review = result; renderReview(''); // CHANGE
            if (pin) panel.querySelector('button')?.focus(); // NEW: keyboard activation enters the pinned review.
        }
        function scheduleHide(event) {
            if (panel?.contains(event?.relatedTarget)) return;
            root.clearTimeout(hideTimer); hideTimer = root.setTimeout(() => { if (!pinned && !busy) close(); }, 90);
        }
        function bindBadge(element, ids) {
            element.__incomingGroups = ids; // NEW
            element.addEventListener('mouseenter', () => { if (!pinned) show(element, element.__incomingGroups).catch(error => options.status(error.message)); }); // CHANGE
            element.addEventListener('focus', () => { if (!pinned) show(element, element.__incomingGroups).catch(error => options.status(error.message)); }); // CHANGE
            element.addEventListener('mouseleave', scheduleHide);
            for (const type of ['pointerdown', 'mousedown', 'mouseup', 'keydown', 'keypress', 'keyup']) element.addEventListener(type, event => event.stopPropagation());
        }
        function render() {
            if (!graph.container) return;
            if (!toolbar) {
                toolbar = document.createElement('div'); toolbar.style.cssText = 'position:absolute;right:12px;top:8px;z-index:25;'; toolbar.dataset.incomingToolbar = ''; graph.container.appendChild(toolbar);
            }
            toolbar.hidden = !groups.length; // CHANGE
            const total = new Set(groups.flatMap(group => group.objects.map(object => object.key))).size;
            const all = toolbar.firstElementChild || button(toolbar, '', event => show(event.currentTarget, null, true)); // CHANGE
            const label = total + (total === 1 ? ' changed object' : ' changed objects') + (groups.some(group => group.structural) ? ' · structural changes' : ''); // CHANGE
            if (all.textContent !== label) all.textContent = label; all.setAttribute('aria-label', 'Review all incoming changes: ' + label); // CHANGE
            if (!layer) { layer = document.createElement('div'); layer.dataset.incomingBadges = ''; layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:21;'; graph.container.appendChild(layer); mark(layer); }
            const wanted = new Set(); // CHANGE
            function badgeFor(key, text, ids, left, top, label) { // NEW
                wanted.add(key); let badge = badges.get(key);
                if (!badge) { badge = button(layer, text, event => show(event.currentTarget, event.currentTarget.__incomingGroups, true)); badge.style.cssText += 'position:absolute;pointer-events:auto;border:1px solid #b56a00;background:#fff4df;color:#8a5000;border-radius:7px;padding:3px 7px;font:12px Arial;'; bindBadge(badge, ids); badges.set(key, badge); } // CHANGE
                badge.__incomingGroups = ids; if (badge.textContent !== text) badge.textContent = text;
                badge.setAttribute('aria-label', label);
                if (badge.style.left !== left + 'px') badge.style.left = left + 'px'; if (badge.style.top !== top + 'px') badge.style.top = top + 'px';
                return badge;
            }
            const clusters = new Map(), controller = graph.__trellisModules?.clusters, pendingObjects = new Map(groups.flatMap(group => group.objects.map(object => [object.key, object]))); // CHANGE
            for (const group of groups) for (const object of group.objects) {
                const [page, id] = JSON.parse(object.key); if (page !== pageId() && !(page === '' && (ui.pages?.length || 1) === 1)) continue; // CHANGE
                const cell = graph.getModel?.().getCell(id), state = cell && graph.view?.getState(cell); // CHANGE
                let owner = cell, ancestor = object; const visited = new Set(); // NEW: added descendants have no native cell until refreshed.
                while (!owner && ancestor?.parent && !visited.has(ancestor.parent)) { visited.add(ancestor.parent); owner = graph.getModel?.().getCell(ancestor.parent); ancestor = pendingObjects.get(JSON.stringify([page, ancestor.parent])); }
                const cluster = owner && controller?.getCluster(owner); // CHANGE
                if (cluster) { const entry = clusters.get(cluster.id) || { cluster, groups: new Set(), objects: new Set() }; entry.groups.add(group.id); entry.objects.add(object.key); clusters.set(cluster.id, entry); }
                if (!state) continue;
                const badge = badgeFor('object:' + object.key, object.operation === 'deleted' ? '−' : '↻', [group.id], state.x + state.width - 10, state.y - 10, object.label + ': incoming ' + object.operation + '; review related changes'); // CHANGE
                badge.style.borderRadius = '50%'; badge.style.width = badge.style.height = '20px'; badge.style.padding = '0'; // NEW
                badge.dataset.incomingObject = object.key; // CHANGE
            }
            for (const entry of clusters.values()) {
                const visible = entry.cluster.modules.map(cell => ({ cell, state: graph.view?.getState(cell) })).filter(item => item.state);
                const anchor = visible.find(item => item.cell.getAttribute?.('garden_module') === '1') || visible[0]; if (!anchor) continue;
                const ids = [...entry.groups], badge = badgeFor('cluster:' + entry.cluster.id, entry.objects.size + (entry.objects.size === 1 ? ' change' : ' changes'), ids, anchor.state.x, anchor.state.y - 26, 'Review cluster changes: ' + entry.objects.size + ' changed objects'); // CHANGE
                badge.dataset.incomingCluster = entry.cluster.id; // CHANGE
            }
            for (const [key, badge] of badges) if (!wanted.has(key)) { badge.remove(); badges.delete(key); } // NEW
        }
        /** Convert only requested object XML into the native patch format; preserve the existing page/cell instances. */ // NEW
        function patchFor(changes) {
            for (const change of changes) if (change.xml) root.TrellisContentPolicy?.validateNode(root.mxUtils.parseXml(change.xml).documentElement); // NEW: validate the complete batch before any native decoder runs.
            const pages = Object.create(null); // CHANGE
            for (const change of changes) {
                const [page, id] = JSON.parse(change.key), target = ui.pages?.find(item => item.getId() === page) || (!page ? ui.currentPage : null);
                if (!target) throw new Error('The refreshed object page is unavailable.');
                const model = target === ui.currentPage ? graph.getModel() : new root.mxGraphModel(target.root), existing = model.getCell(id);
                const cells = (pages[target.getId()] ||= { cells: {} }).cells;
                if (!change.xml) { (cells.r ||= []).push(id); continue; }
                const node = root.mxUtils.parseXml(change.xml).documentElement, raw = node.nodeName === 'mxCell' ? node : node.getElementsByTagName('mxCell')[0]; // CHANGE
                if (!raw) throw new Error('The incoming object has no native cell.'); // NEW
                const links = Object.fromEntries(['parent', 'source', 'target'].map(attribute => [attribute, raw.getAttribute(attribute)])); // NEW: decodeCell removes mxCell from an XML wrapper.
                for (const attribute of Object.keys(links)) raw.removeAttribute(attribute); // NEW: references are restored below, including cells inserted in this same patch.
                const decoder = new root.mxCodec(node.ownerDocument), cell = decoder.decodeCell(node, false); // CHANGE
                for (const [attribute, value] of Object.entries(links)) cell[attribute] = value ? model.getCell(value) || { getId: () => value } : null; // CHANGE
                if (existing) {
                    const diff = ui.diffCell(existing, cell);
                    if (diff.parent != null) diff.previous = change.previous || '';
                    (cells.u ||= Object.create(null))[id] = diff; // CHANGE
                } else (cells.i ||= []).push(ui.getJsonForCell(cell, change.previous ? { getId: () => change.previous } : { getId: () => '' }));
            }
            return { u: pages };
        }
        async function refresh() {
            if (busy || !review) return;
            const capturedGeneration = generation;
            busy = true; renderReview(''); // CHANGE
            const saveBarrier = options.beginRefresh?.(); // NEW
            let rollback = null, thaw = () => {}, appliedFile = null, beforeApplyModified = false, waitingForAck = false; // CHANGE
            try {
                await (saveBarrier ? saveBarrier.settle() : options.settle()); // CHANGE
                if (capturedGeneration !== generation) return;
                const result = await options.coordinate({ kind: 'prepare-refresh', groups: selection || undefined, token: review.token, blockedTargets: options.blockedTargets() });
                if (result.ok === false) { review = result.review; renderReview(result.reason); return; }
                if (!result.changes.length) { renderReview('These groups are blocked by an active edit. Finish that edit before refreshing them.'); return; }
                thaw = options.freeze(review.groups.flatMap(group => [...group.targets, ...group.keys]));
                const current = ui.getCurrentFile(), wasModified = current.isModified(), start = root.performance.now();
                appliedFile = current; // NEW
                beforeApplyModified = wasModified; // NEW
                const apply = () => {
                    if (result.structural) {
                        const previous = ui.getFileData(); rollback = () => options.applyXml(previous);
                        options.applyXml(result.xml);
                    } else {
                        const patch = patchFor(result.changes), originals = [];
                        const encoder = new root.mxCodec();
                        for (const change of result.changes) {
                            const [page, id] = JSON.parse(change.key), target = ui.pages.find(item => item.getId() === page) || ui.currentPage;
                            const model = target === ui.currentPage ? graph.getModel() : new root.mxGraphModel(target.root), cell = model.getCell(id);
                            const parent = cell && model.getParent(cell), index = parent && model.getIndex ? model.getIndex(cell) : parent?.getIndex?.(cell); // NEW
                            const previous = parent && index > 0 ? model.getChildAt(parent, index - 1)?.id : ''; // NEW
                            originals.push({ key: change.key, previous, xml: cell ? root.mxUtils.getXml(encodeObject(encoder, cell)) : null }); // CHANGE
                        }
                        rollback = () => current.patch([patchFor(originals)], null, false, false);
                        current.patch([patch], null, false, false);
                    }
                };
                options.applying(() => graph.__trellisLocalView ? graph.__trellisLocalView.apply(apply) : apply());
                current.setModified(wasModified); // NEW: remove refresh dirtiness synchronously; later unrelated edits must stay dirty while acknowledgement waits.
                options.observe?.(); // NEW: local claims compare against the actual display, including this provisional patch.
                waitingForAck = true; // NEW
                options.timing?.({ phase: 'canvas-refresh', durationMs: root.performance.now() - start, objects: result.changes.length });
                let acknowledged; // CHANGE: retry once to resolve an acknowledgement committed before a lost bridge reply.
                try { acknowledged = await options.coordinate({ kind: 'ack-refresh', receipt: result.receipt }); }
                catch (_) { acknowledged = await options.coordinate({ kind: 'ack-refresh', receipt: result.receipt }); } // NEW
                if (capturedGeneration !== generation || ui.getCurrentFile() !== current) { rollback = null; return; } // NEW: a delayed acknowledgement cannot mutate the next document.
                if (acknowledged.ok === false) throw new Error(acknowledged.reason);
                rollback = null; options.adopt(acknowledged.xml); setGroups(acknowledged.groups || []); // CHANGE
                if (result.skipped.length) { review = await options.coordinate({ kind: 'review', groups: selection || undefined }); renderReview(result.skipped.length + ' groups remain blocked by active edits.'); } else close(true); // CHANGE
            } catch (error) {
                if (rollback && capturedGeneration === generation && ui.getCurrentFile() === appliedFile) { const modified = waitingForAck ? appliedFile.isModified() : beforeApplyModified; options.applying(() => graph.__trellisLocalView ? graph.__trellisLocalView.apply(rollback) : rollback()); appliedFile.setModified(modified); options.observe?.(); } // CHANGE: rollback preserves unrelated work entered during acknowledgement.
                renderReview('Refresh failed; changes remain pending. ' + error.message); // NEW
                options.status('Refresh failed; changes remain pending. ' + error.message);
            } finally { thaw(); saveBarrier?.finish(); busy = false; if (panel) renderReview(); } // CHANGE
        }
        function encodeObject(codec, cell) {
            const container = codec.document.createElement('root'); codec.encodeCell(cell, container, false); return container.firstChild;
        }
        function setGroups(next) {
            if (selection) { const keys = new Set(groups.filter(group => selection.includes(group.id)).flatMap(group => group.keys)); selection = next.filter(group => group.keys.some(key => keys.has(key))).map(group => group.id); } // NEW: follow a reviewed dependency group when its membership changes.
            const changed = JSON.stringify(groups) !== JSON.stringify(next); groups = next; render();
            if (changed && panel && !busy) {
                const captured = generation;
                review = null; renderReview('Changes updated. Review the latest details before refreshing.');
                options.coordinate({ kind: 'review', groups: selection || undefined }).then(result => { if (panel && captured === generation) { review = result; renderReview('Changes updated. Review the latest details before refreshing.'); } }).catch(error => options.status(error.message));
            }
        }
        document.addEventListener('pointerdown', event => { if (panel && !panel.contains(event.target) && !event.target.closest?.('[data-incoming-object],[data-incoming-cluster],[data-incoming-toolbar]')) close(); }, true);
        graph.view?.addListener && ['scale', 'translate', 'scaleAndTranslate'].forEach(event => graph.view.addListener(event, render));
        ui.editor.addListener?.('pageSelected', render);
        graph.getModel?.().addListener?.('change', render);
        return { setGroups, render, reviewAll(anchor) { // CHANGE: menu/native commands ensure the inbox is open; badge clicks still toggle pinned previews.
            if (panel && pinned && selection === null) { panel.querySelector('button')?.focus(); return Promise.resolve(); }
            return show(anchor || toolbar?.firstElementChild || graph.container, null, true);
        }, reset() { close(true); groups = []; badges.clear(); layer?.remove(); toolbar?.remove(); layer = toolbar = null; }, getGroups: () => groups, patchFor }; // CHANGE
    }
    root.TrellisIncomingChanges = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
