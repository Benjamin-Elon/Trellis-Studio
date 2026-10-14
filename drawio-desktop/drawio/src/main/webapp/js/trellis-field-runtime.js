/** Field export/import orchestration over existing Users and Task Manager commands. // NEW */
(function(root) {
    'use strict';
    const ID_ATTR = 'trellis_field_object_id', VERSIONS = 'trellis_field_versions_json', ACKS = 'trellis_field_acknowledgments_json';
    const attr = (cell, name) => cell?.value?.getAttribute?.(name) || '';
    const parse = (text, fallback) => { try { return JSON.parse(text || 'null') || fallback; } catch (_) { return fallback; } };
    const localDay = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    function install(ui) {
        if (ui.__trellisFieldRuntime || !root.trellisField) return;
        ui.__trellisFieldRuntime = true;
        const graph = ui.editor.graph, model = graph.getModel(), p = root.TrellisFieldProtocol;
        let applying = false, polling = false, session = null, lastWork = null, lastPublishedHash = '', revision = 0; // CHANGE: saved content determines when a new package is needed.
        const versionSource = root.crypto.randomUUID(); // NEW: distinct windows cannot allocate the same field-version tuple.
        root.trellisIdentity.getSession().then(value => { session = value; }); // NEW: desktop version tracking starts before the first field export.
        root.trellisIdentity.onStatus(value => { if (session?.identityId !== value.session?.identityId || session?.deviceId !== value.session?.deviceId) lastPublishedHash = ''; session = value.session; }); // CHANGE: publication caching cannot cross an identity switch or lock.
        const cells = () => Object.values(model.cells || {});
        const users = () => graph.__trellisUsers || root.Trellis?.users;
        const commands = () => root.Trellis?.taskCommands;
        const file = () => ui.getCurrentFile();
        const metadata = () => graph.getDefaultParent();
        function setAttribute(cell, name, value) {
            const node = cell.value?.nodeType === 1 ? cell.value.cloneNode(true) : mxUtils.createXmlDocument().createElement('object');
            if (value == null || value === '') node.removeAttribute(name); else node.setAttribute(name, String(value));
            model.setValue(cell, node);
        }
        function stamp() { // CHANGE: retain a counter across command calls and document changes.
            const key = 'trellis.field.counter:' + session.deviceId + ':' + versionSource; // NEW
            const counter = Number(localStorage.getItem(key) || 0) + 1; localStorage.setItem(key, String(counter)); // NEW
            return { time: Date.now(), deviceId: session.deviceId + ':' + versionSource, counter }; // CHANGE
        }
        /** Metadata still notifies save/history observers, but must not create or trim user Undo/Redo steps. */ // NEW
        function editMetadata(operation, recordHistory = false) { // CHANGE
            const undoManager = ui.editor.undoManager, registerEdit = undoManager?.undoableEditHappened; // CHANGE: use the same registration boundary as existing Trellis undo suppression.
            if (!recordHistory && registerEdit) undoManager.undoableEditHappened = () => {}; // CHANGE: IDs, versions, and immutable receipts cannot create or trim command history.
            applying = true; graph.__trellisFieldMetadataChange = true; model.beginUpdate();
            try { return operation(); } finally { // CHANGE
                try { model.endUpdate(); } finally { if (registerEdit) undoManager.undoableEditHappened = registerEdit; graph.__trellisFieldMetadataChange = false; applying = false; } // CHANGE: preserve existing Trellis suppression hooks and restore them after observer failures.
            } // NEW
        }
        /** Clone identity must never match a deleted source's pending mobile work. */
        const cloneCells = graph.cloneCells;
        graph.cloneCells = function() {
            const result = cloneCells.apply(this, arguments);
            function reset(cell) {
                if (cell.value?.nodeType === 1) { cell.value = cell.value.cloneNode(true); cell.value.removeAttribute(ID_ATTR); cell.value.removeAttribute(VERSIONS); cell.value.removeAttribute(ACKS); }
                for (const child of cell.children || []) reset(child);
            }
            for (const cell of result) reset(cell); return result;
        };
        /** Track desktop edits with the same independent-field versions as Android. */
        model.addListener(mxEvent.CHANGE, (_sender, event) => {
            if (!applying) revision++; // NEW: an asynchronous preview must never publish across a user edit or document reload.
            if (applying || !session || !users()?.isLoggedIn()) return;
            const changes = event.getProperty('edit')?.changes || [];
            const targets = new Map();
            for (const change of changes) {
                const cell = change.cell;
                if (!cell || attr(cell, 'kanban_card') !== '1' || change.constructor.name !== 'mxValueChange') continue;
                const before = change.previous;
                if (!before?.getAttribute) continue;
                const fields = [];
                if (['workflow_state', 'completed'].some(key => (before.getAttribute(key) || '') !== attr(cell, key))) fields.push('progress'); // CHANGE: use the existing Task Manager attribute contract.
                if ((before.getAttribute('card_note') || '') !== attr(cell, 'card_note')) fields.push('annotation');
                if (fields.length) targets.set(cell, fields);
            }
            if (targets.size) editMetadata(() => {
                for (const [cell, fields] of targets) {
                    const versions = parse(attr(cell, VERSIONS), {});
                    for (const field of fields) versions[field] = stamp();
                    setAttribute(cell, VERSIONS, JSON.stringify(versions));
                }
            });
        });
        function ensureObjectIds() {
            const seen = new Set();
            editMetadata(() => {
                for (const cell of cells()) {
                    if (!cell.vertex || cell.value?.nodeType !== 1) continue;
                    const current = attr(cell, ID_ATTR);
                    if (!current || seen.has(current)) setAttribute(cell, ID_ATTR, root.crypto.randomUUID());
                    seen.add(attr(cell, ID_ATTR));
                }
            });
        }
        function assignedToWorker(cell, workerId) {
            const ids = parse(attr(cell, 'task_assignee_role_ids_json'), []);
            return ids.some(roleId => attr(model.getCell(roleId), 'trellis_role_user_id') === workerId);
        }
        function readable(cell) {
            if (users()?.isAdmin()) return true;
            const access = users()?.getAccessSummary(cell);
            return !!(access?.effectiveOpen || access?.inheritedAccessGrant || access?.effectiveCapabilities?.length);
        }
        /** Task links use the existing linker's planting-group normalization, including individual plant children. */ // NEW
        function linkedPlantingGroups(task) { // NEW
            const linked = attr(task, 'linkedTo').split(',').map(id => model.getCell(id.trim())).filter(cell => cell && readable(cell)); // NEW
            return [...new Set(linked.map(cell => graph.__trellisPlantingLinking?.normalizeSelection(cell) || cell))].filter(cell => attr(cell, 'tiler_group') === '1' && readable(cell) && attr(cell, ID_ATTR)); // NEW
        } // NEW
        /** Region types distinguish selectable garden objects from the planting groups a task highlights. */ // NEW
        function gardenObjectKind(cell) { // NEW
            if (attr(cell, 'tiler_group') === '1') return 'planting-group'; // NEW
            if (attr(cell, 'garden_bed') === '1') return 'bed'; // NEW
            if (attr(cell, 'plant_tiler') === '1') return 'plant'; // NEW
            return 'garden-object'; // NEW
        } // NEW
        async function snapshot(previews = true) {
            session = await root.trellisIdentity.getSession();
            const worker = users()?.getCurrentUser();
            if (!session || !worker || worker.portableIdentityId !== session.identityId) throw new Error('Log in to a linked diagram user before exporting field work.');
            if (previews) ensureObjectIds(); // CHANGE: polling a clean diagram must not create unsaved metadata without incoming work.
            const tasks = cells().filter(cell => attr(cell, 'kanban_card') === '1' && attr(cell, 'schedule_break') !== '1' && assignedToWorker(cell, worker.id) && readable(cell)).map(cell => { // CHANGE
                let state = attr(cell, 'workflow_state') || (attr(cell, 'completed') ? 'DONE' : 'TODO'); // CHANGE
                if (state === 'STAGED') state = 'TODO';
                const links = linkedPlantingGroups(cell); // CHANGE: highlight the actual linked planting groups, never substitute their beds.
                const responsibilities = parse(attr(cell, 'task_assignee_role_ids_json'), []).map(id => model.getCell(id)).filter(role => attr(role, 'trellis_role_user_id') === worker.id).map(role => attr(role, 'role_title') || attr(role, 'label') || worker.name); // NEW
                return { id: attr(cell, ID_ATTR), title: attr(cell, 'title') || attr(cell, 'label') || 'Task', instructions: attr(cell, 'notes'), plannedDay: attr(cell, 'start') || attr(cell, 'assigned_day'), plannedEnd: attr(cell, 'end'), responsibilities, progress: { state: ['TODO', 'DOING', 'DONE'].includes(state) ? state : 'TODO', completedDay: state === 'DONE' ? attr(cell, 'completed') || localDay() : null }, annotation: p.normalizeAnnotation(attr(cell, 'card_note')), versions: parse(attr(cell, VERSIONS), {}), locations: links.map(target => attr(target, ID_ATTR)) }; // CHANGE
            });
            const gardens = previews ? await gardenPreviews() : lastWork?.diagramId === users().getDiagramKey(false) && lastWork.workerId === worker.id ? lastWork.gardens : []; // CHANGE: a different garden's cached preview cannot enter this worker package.
            return p.validateWork({ schema: 1, kind: 'field-work', packageId: root.crypto.randomUUID(), diagramId: users().getDiagramKey(false), workerId: worker.id, exportedAt: Date.now(), tasks, gardens, acknowledgments: parse(attr(metadata(), ACKS), []) });
        }
        /** Render the whole permitted garden with the production exporter; keep task/team subtrees out of the image. */ // CHANGE
        async function gardenPreviews() {
            const gardens = [];
            for (const garden of cells().filter(cell => attr(cell, 'garden_module') === '1' && attr(cell, ID_ATTR) && readable(cell))) { // CHANGE
                const descendants = [];
                function walk(cell) { // CHANGE: include garden context and decorative layout, rather than cropping to recognized location objects.
                    if (cell !== garden && (['kanban_card', 'team_module', 'task_module', 'roadmap_module'].some(name => attr(cell, name) === '1') || attr(cell, 'board_key') || attr(cell, 'trellis_role_user_id') || /(?:^|;)role_card=1(?:;|$)/.test(cell.style || ''))) return; // NEW: unrelated task/team data and all its children stay private.
                    if (cell !== garden && (cell.vertex || cell.edge) && readable(cell)) descendants.push(cell); // CHANGE
                    for (const child of cell.children || []) walk(child); // CHANGE
                } // CHANGE
                walk(garden);
                const permittedVertices = new Set([garden, ...descendants.filter(cell => cell.vertex)]); // NEW
                const drawing = [garden, ...descendants.filter(cell => !cell.edge || ((!cell.source || permittedVertices.has(cell.source)) && (!cell.target || permittedVertices.has(cell.target))))]; // CHANGE: unrelated endpoints must not leak through an otherwise readable connector.
                const states = drawing.map(cell => graph.view.getState(cell)).filter(Boolean); // CHANGE
                if (!states.length) continue;
                const exporter = graph.createSvgImageExport(); // CHANGE: retain production shape/text export behavior.
                const permitted = new Set(drawing); // CHANGE
                const visitStates = exporter.visitStatesRecursive; // NEW
                exporter.visitStatesRecursive = function(state, canvas, visitor) { // CHANGE: filter before the production exporter adds secondary labels or enumeration decorations.
                    return visitStates.call(this, state, canvas, (candidate, target) => { if (permitted.has(candidate.cell)) visitor(candidate, target); }); // CHANGE
                }; // CHANGE
                const originalSelection = graph.getSelectionCells, originalCss = graph.useCssTransforms; let svg, regions; // CHANGE
                try { // NEW: use exactly the production export bounds and rounding for location coordinates.
                    if (originalCss) { graph.useCssTransforms = false; graph.view.revalidate(); graph.sizeDidChange(); } // NEW
                    graph.getSelectionCells = () => drawing; // CHANGE: bounds cover the whole garden without changing the editor's selected task.
                    const bounds = graph.getBoundingBox(drawing), scale = graph.view.scale; // CHANGE
                    const offsetX = Math.floor(-bounds.x / scale), offsetY = Math.floor(-bounds.y / scale); // NEW
                    regions = descendants.filter(cell => cell.vertex && attr(cell, ID_ATTR)).map(cell => graph.view.getState(cell)).filter(Boolean).map(state => ({ id: attr(state.cell, ID_ATTR), kind: gardenObjectKind(state.cell), x: state.x / scale + offsetX, y: state.y / scale + offsetY, width: state.width / scale, height: state.height / scale, rotation: Number(state.shape?.getShapeRotation?.() || 0) % 360, label: attr(state.cell, 'label') || attr(state.cell, 'plant_name'), details: { plant: attr(state.cell, 'plant_name'), variety: attr(state.cell, 'variety_name'), notes: attr(state.cell, 'notes') } })); // CHANGE: selection frames follow the production planting-group transform.
                    svg = graph.getSvg('#ffffff', 1, 0, false, false, true, true, exporter, '_blank', false, false, 'light', null, drawing, true, true); // CHANGE
                } finally { // NEW
                    graph.getSelectionCells = originalSelection; // NEW
                    if (originalCss) { graph.useCssTransforms = originalCss; graph.view.revalidate(); graph.sizeDidChange(); } // NEW
                } // NEW
                const svgWidth = parseFloat(svg.getAttribute('width')), svgHeight = parseFloat(svg.getAttribute('height')); // CHANGE: production SVG dimensions include the px unit.
                if (!(svgWidth > 0 && svgHeight > 0)) throw new Error('The garden preview has no drawable bounds.'); // NEW
                const canvas = await new Promise((resolve, reject) => ui.editor.convertImages(svg, converted => {
                    const image = new Image(); image.onload = () => { try { const output = document.createElement('canvas'); const scale = Math.min(1, 2048 / Math.max(svgWidth, svgHeight)); output.width = Math.ceil(svgWidth * scale); output.height = Math.ceil(svgHeight * scale); output.getContext('2d').drawImage(image, 0, 0, output.width, output.height); resolve(output); } catch (error) { reject(error); } };
                    image.onerror = () => reject(new Error('Could not render the garden preview.'));
                    image.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(mxUtils.getXml(converted))));
                }));
                const width = canvas.width, height = canvas.height;
                gardens.push({ id: attr(garden, ID_ATTR), name: attr(garden, 'label') || 'Garden', png: canvas.toDataURL('image/png'), width, height, regions: regions.map(region => ({ ...region, x: region.x * width / svgWidth, y: region.y * height / svgHeight, width: region.width * width / svgWidth, height: region.height * height / svgHeight })) }); // CHANGE: scale highlights by the raster transform, including padded bounds and labels.
            }
            return gardens;
        }
        const save = () => new Promise((resolve, reject) => file().save(false, resolve, reject));
        async function digest(text) { const bytes = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join(''); }
        async function exportWork() {
            lastWork = await snapshot(true); await save();
            lastWork = (await root.trellisField.publishWork({ work: lastWork })).work; // CHANGE: both export paths include the catalog display name.
            const savedXml = await new Promise((resolve, reject) => root.electron.request({ action: 'readFile', filename: file().fileObject.path, encoding: 'utf8' }, resolve, reject)); lastPublishedHash = await digest(savedXml); // NEW
            await root.TrellisGardenHome.saveJson(lastWork, 'trellis-field-work.json');
        }
        /** Never process an unreadable, conflicted, unsaved, or replacement document. */
        async function processIncoming() {
            if (root.__trellisClosing || polling || !file()?.fileObject?.path || file().isModified() || file().savingFile || file().inConflictState || file().isEditable?.() === false || !users()?.isLoggedIn() || !commands()) return; // CHANGE
            polling = true;
            const currentFile = file();
            try {
                const inbox = await root.trellisField.pendingUpdates({ diagramId: users().getDiagramKey(false) }); // NEW: check publication state before assigning IDs to an unrelated local garden.
                if (!inbox.enabled && !inbox.packages.length) return; // NEW
                if (root.__trellisClosing || file() !== currentFile || currentFile.isModified() || currentFile.savingFile || currentFile.inConflictState || currentFile.isEditable?.() === false || !users()?.isLoggedIn()) return; // NEW: the inbox read may finish after the user starts editing.
                const observedRevision = revision; ensureObjectIds(); // NEW: objects created since the last publication need persistent identities.
                if (root.__trellisClosing || file() !== currentFile || revision !== observedRevision) return; // NEW
                if (currentFile.isModified()) await save(); // NEW: save only this synchronous metadata change, before asynchronous preview work begins.
                if (root.__trellisClosing || file() !== currentFile || revision !== observedRevision || currentFile.isModified() || currentFile.inConflictState) return; // CHANGE
                const base = await snapshot(false), packets = inbox.packages; // CHANGE
                if (root.__trellisClosing || file() !== currentFile || revision !== observedRevision || currentFile.isModified() || currentFile.inConflictState) return; // NEW: session lookup must not cross a new draft or document replacement.
                const completed = new Set(base.acknowledgments.map(ack => ack.id));
                const fresh = packets.flatMap(packet => packet.operations).filter(op => !completed.has(op.id));
                if (!fresh.length) { // CHANGE: saved desktop edits refresh an already published worker package automatically.
                    const savedXml = await new Promise((resolve, reject) => root.electron.request({ action: 'readFile', filename: currentFile.fileObject.path, encoding: 'utf8' }, resolve, reject)), savedHash = await digest(savedXml); // CHANGE
                    if (savedHash === lastPublishedHash) return; // NEW: unchanged polls preserve Android pan and zoom and create no extra signed files.
                    base.gardens = await gardenPreviews(); // CHANGE: refresh the production PNG, locations, permissions, and current task fields together.
                    if (root.__trellisClosing || file() !== currentFile || revision !== observedRevision || currentFile.isModified() || currentFile.savingFile || currentFile.inConflictState || !users()?.isLoggedIn()) return; // NEW: preserve drafts changed during asynchronous rendering.
                    lastWork = (await root.trellisField.acknowledge({ work: base, path: currentFile.fileObject.path, savedHash })).work; lastPublishedHash = savedHash; // CHANGE: the main process still verifies the durable file and receipts.
                    return; // NEW
                } // NEW
                const byId = new Map(cells().map(cell => [attr(cell, ID_ATTR), cell]));
                let merged = base;
                for (const packet of packets) merged = p.mergeUpdates(merged, packet, { hasObject: id => byId.has(id), canApply(task, operation, workerId) { const cell = byId.get(task.id); if (packet.senderAuthorized === false || !assignedToWorker(cell, workerId) || !readable(cell)) return false; return operation.field === 'progress' ? users().canMoveTask(cell) : users().canEditTaskDetails(cell); } }).work; // CHANGE: recheck device authorization, assignment, and access for every operation.
                editMetadata(() => {
                    for (const task of merged.tasks) {
                        const original = base.tasks.find(t => t.id === task.id), cell = byId.get(task.id);
                        if (!cell || !original || JSON.stringify(original.versions) === JSON.stringify(task.versions)) continue;
                        const patch = { [VERSIONS]: JSON.stringify(task.versions) };
                        if (p.compareVersions(task.versions.progress, original.versions.progress) > 0) { patch.workflow_state = task.progress.state; patch.completed = task.progress.completedDay || null; } // CHANGE
                        if (p.compareVersions(task.versions.annotation, original.versions.annotation) > 0) patch.card_note = task.annotation || null;
                        if (!commands().commitCardPatch(cell, patch, { reflow: true })) throw new Error('The task command could not apply this update. Its acknowledgment remains pending.'); // CHANGE: rejected commands must never become durable applied results.
                    }
                }, true); // CHANGE: the actual task-command transaction remains undoable.
                editMetadata(() => setAttribute(metadata(), ACKS, JSON.stringify(merged.acknowledgments))); // CHANGE: Undo must retain durable operation receipts so polling cannot replay an acknowledged phone edit.
                await save();
                if (root.__trellisClosing || file() !== currentFile || currentFile.isModified() || currentFile.inConflictState) return;
                const savedXml = await new Promise((resolve, reject) => root.electron.request({ action: 'readFile', filename: currentFile.fileObject.path, encoding: 'utf8' }, resolve, reject));
                merged = { ...merged, gardens: await gardenPreviews(), packageId: root.crypto.randomUUID(), exportedAt: Date.now() }; // CHANGE: recheck preview permissions for refreshed packages after an acknowledgment.
                await root.trellisField.acknowledge({ work: merged, path: currentFile.fileObject.path, savedHash: await digest(savedXml) });
                lastPublishedHash = await digest(savedXml); // CHANGE
                lastWork = merged;
            } catch (error) { if (!/not in this identity|Log in/.test(error.message)) ui.editor.setStatus('Field updates: ' + error.message); }
            finally { polling = false; }
        }
        const exportAction = ui.actions.addAction('trellisExportFieldWork', () => exportWork().catch(error => ui.handleError(error))); exportAction.label = 'Export field work';
        const importAction = ui.actions.addAction('trellisImportFieldUpdates', async () => { try { const updates = await root.TrellisGardenHome.chooseJson(); if (updates) { await root.trellisField.importUpdates({ updates }); await processIncoming(); } } catch (error) { ui.handleError(error); } }); importAction.label = 'Import field updates';
        const menu = ui.menus.get('file'), originalMenu = menu.funct;
        menu.funct = function(menuRoot, parent) { originalMenu.apply(this, arguments); ui.menus.addMenuItems(menuRoot, ['trellisExportFieldWork', 'trellisImportFieldUpdates'], parent); };
        setInterval(processIncoming, 5000);
        root.Trellis = root.Trellis || {}; root.Trellis.field = { snapshot, processIncoming, exportWork };
    }
    root.TrellisFieldRuntime = { install };
})(window);
