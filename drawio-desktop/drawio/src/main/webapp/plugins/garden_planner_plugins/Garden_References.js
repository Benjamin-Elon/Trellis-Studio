/** Garden-scoped reference orchestration, templates, drafts and owner review. */ // NEW
(function (root) {
    function install(ui) {
        const C = root.TrellisReferenceCore, graph = ui.editor.graph, model = graph.getModel();
        if (graph.__trellisReferences) return;
        const drafts = new Map(), contexts = new Set(), authorizedReferenceChanges = new WeakSet(), draftLoads = new Map(), draftWrites = new Map(), draftReady = new Set(); // CHANGE
        const attr = (cell, key) => cell?.getAttribute?.(key) ?? cell?.value?.getAttribute?.(key) ?? '';
        const json = (cell, key, fallback) => { const raw = attr(cell, key); return raw ? JSON.parse(raw) : fallback; };
        const users = () => graph.__trellisUsers || root.Trellis?.users;
        const actor = () => users()?.isEnabled() ? users().getCurrentUser()?.id || '' : 'local-owner';
        const isGarden = cell => ['garden_module', 'trellis_garden_module'].some(key => attr(cell, key) === '1') || attr(cell, 'module_type') === 'garden';
        const gardens = () => Object.values(model.cells || {}).filter(isGarden);
        function pageGardens() { // NEW: off-page roots use draw.io's existing page cache without changing the selection.
            const entries = gardens().map(cell => ({ cell, page: ui.currentPage })); // NEW
            for (const page of ui.pages || []) if (page !== ui.currentPage) { ui.updatePageRoot?.(page); function visit(cell) { if (!cell) return; if (isGarden(cell)) entries.push({ cell, page }); (cell.children || []).forEach(visit); } visit(page.root); } return entries; // NEW
        } // NEW
        function gardenFor(cell) { const seen = new Set(); while (cell && !seen.has(cell)) { if (isGarden(cell)) return cell; seen.add(cell); cell = model.getParent(cell); } return null; }
        function owner(cell) { return !users()?.isEnabled() || !!actor() && attr(cell, 'trellis_owner_user_id') === actor(); }
        function editor(cell) { if (!users()?.isEnabled()) return true; const user = users().getCurrentUser(); return !!user && (user.admin || owner(cell) || users().effectiveCapabilitiesForCell(cell).some(cap => ['create_plantings', 'manage_own_plantings', 'move_tasks', 'edit_task_details', 'manage_scope_content'].includes(cap))); }
        function activeGarden() { return graph.__trellisGardenDashboard?.resolveContext?.().moduleCell || gardenFor(graph.getSelectionCell?.()) || (gardens().length === 1 ? gardens()[0] : null); }
        function diagramId() { return Object.values(model.cells || {}).map(cell => attr(cell, 'trellis_users_diagram_id')).find(Boolean) || users()?.getDiagramKey?.() || ''; } // CHANGE
        function pageId(page = ui.currentPage) { return page?.getId?.() || page?.node?.getAttribute?.('id') || page?.id || ''; } // NEW
        function set(cell, key, value) {
            let node = cell.value?.nodeType === 1 ? cell.value.cloneNode(true) : mxUtils.createXmlDocument().createElement('object');
            node.setAttribute(key, typeof value === 'string' ? value : JSON.stringify(value)); model.setValue(cell, node); // CHANGE
            const page = isGarden(cell) && model.getCell(cell.id) !== cell ? pageGardens().find(entry => entry.cell === cell)?.page : null; // CHANGE
            if (page && page !== ui.currentPage) { page.needsUpdate = true; const change = model.currentEdit?.changes?.at(-1); if (change) { const execute = change.execute; change.execute = function () { execute.call(this); page.needsUpdate = true; }; } } // NEW: off-page edits and their undo/redo invalidate the serialized page cache.
            if (key === C.ATTR && model.currentEdit?.changes?.length) authorizedReferenceChanges.add(model.currentEdit.changes[model.currentEdit.changes.length - 1]); // NEW: raw attribute edits cannot impersonate a reviewed acceptance.
        }
        function transact(fn) {
            model.beginUpdate(); const edit = model.currentEdit, start = edit?.changes?.length || 0;
            try { return fn(); }
            catch (error) { if (edit?.changes) for (const change of edit.changes.splice(start).reverse()) change.execute(); throw error; }
            finally { model.endUpdate(); }
        }
        const readCache = new WeakMap(); // NEW
        function read(cell) { const garden = gardenFor(cell) || cell, raw = attr(garden, C.ATTR), cached = readCache.get(garden); if (cached?.raw === raw) return cached.store; const store = C.freeze(C.validate(raw ? JSON.parse(raw) : null)); readCache.set(garden, { raw, store }); return store; } // CHANGE
        function consumerCell(garden, manifestId) { if (!manifestId) return garden; return { parent: garden, getParent: () => garden, getAttribute: key => key === C.PIN ? manifestId : ['garden_module', 'trellis_garden_module', 'module_type'].includes(key) ? '' : attr(garden, key) }; } // CHANGE: implement mxGraph's parent contract while keeping a pinned view distinct from its real garden.
        function scopeForConsumer(garden, cell) { // NEW
            const seen = new Set(); for (let current = cell; current && current !== garden && !seen.has(current); current = model.getParent(current)) { seen.add(current); if (attr(current, C.PIN)) return consumerCell(garden, attr(current, C.PIN)); } // NEW
            for (const id of String(attr(cell, 'linkedTo')).split(',').map(id => id.trim())) { const linked = model.getCell(id); if (linked && gardenFor(linked) === garden && attr(linked, C.PIN)) return consumerCell(garden, attr(linked, C.PIN)); } // NEW
            return garden; // NEW
        } // NEW
        function notify(message) { ui.setStatus?.(message); }
        function draftKey(cell) { return JSON.stringify([diagramId(), pageId(), String(cell.id), actor()]); } // CHANGE
        function persistDraft(cell, remove = false, key = draftKey(cell)) { // CHANGE: an in-flight delivery retains its original author's storage key.
            const value = drafts.get(key), storage = root.TrellisReferenceDrafts; // CHANGE
            if (!storage) return Promise.resolve(); // NEW: browser test harnesses and older environments can still export session drafts.
            const record = value ? { version: 1, author: value.actor, base: C.clone(value.base), candidate: C.clone(value.candidate), deliveries: [...(value.deliveries || new Map()).entries()] } : null; // CHANGE
            const operation = (draftWrites.get(key) || Promise.resolve()).catch(() => {}).then(() => remove ? storage.remove(key) : storage.write(key, record)); draftWrites.set(key, operation); // NEW
            operation.catch(error => notify('Local draft could not be saved. Export it before closing: ' + error.message)); return operation; // NEW
        } // NEW
        function restoreDraft(cell) { // NEW
            const key = draftKey(cell), author = actor(), diagram = model.getRoot(); if (drafts.has(key)) return Promise.resolve(drafts.get(key)); // NEW
            if (!draftLoads.has(key)) draftLoads.set(key, Promise.resolve().then(() => root.TrellisReferenceDrafts?.read(key)).then(record => { // NEW
                if (model.getRoot() !== diagram || actor() !== author || model.getCell(cell.id) !== cell) { draftLoads.delete(key); return null; } draftReady.add(key); if (!record || record.author !== author) return null; // CHANGE
                C.validate(record.base); C.validate(record.candidate); if (!C.equal(read(cell).schema, record.base.schema)) throw new Error('The saved draft uses a different garden schema.'); // NEW
                const draft = { base: record.base, candidate: record.candidate, actor: author, deliveries: new Map(record.deliveries || []) }; drafts.set(key, draft); return draft; // NEW
            }).catch(error => { draftLoads.delete(key); throw error; })); return draftLoads.get(key); // NEW
        } // NEW
        function putDraft(cell, base, candidate) {
            if (C.equal(base.manifests[base.current].heads, candidate.manifests[candidate.current].heads)) return;
            const key = draftKey(cell), old = drafts.get(key);
            if (old && old.candidate.current !== base.current) { const incoming = C.proposal(base, candidate, actor(), {}, { gardenId: cell.id }); const merged = C.review(old.candidate, incoming, incoming.changes.map(item => item.entityId)); if (merged.conflicts.length) throw new Error('Another unsent draft changed the same fields. Export or review that draft before saving this edit.'); candidate = merged.store; } // CHANGE
            drafts.set(key, { base: old?.base || C.clone(base), candidate, actor: actor() }); draftReady.add(key); // CHANGE
            const persisting = persistDraft(cell); // CHANGE
            notify('Reference draft saved. Open Garden references to review and send it.');
            root.dispatchEvent(new CustomEvent('trellisReferenceDraftChanged', { detail: { gardenId: cell.id } }));
            return persisting; // NEW
        }
        const request = (method, payload) => {
            if (!root.trellisReferenceDatabase?.request) throw new Error('Garden reference database is unavailable in this build.');
            return root.trellisReferenceDatabase.request(method, payload);
        };
        /** A context captures both garden and consumer pin. No ambient selection is used by its SQL calls. */
        function sqlContext(cell, options = {}) {
            const garden = gardenFor(cell) || cell;
            if (!garden || !attr(garden, C.ATTR) && !options.store) { // CHANGE
                if (attr(garden, 'trellis_reference_pending') === '1') throw new Error('Finish the new garden settings before using its catalogs.');
                return null; // Existing diagrams remain outside the fresh-diagram workflow.
            }
            const base = options.store || read(garden), pin = options.manifestId || attr(cell, C.PIN) || base.current; // CHANGE
            const draft = options.draft === true && drafts.get(draftKey(garden)); // CHANGE: scheduling never consumes an unaccepted definition draft.
            const store = options.store || (draft ? draft.candidate : base), manifestId = options.store ? options.manifestId || store.current : draft ? store.current : pin;
            C.validate(store, manifestId);
            const userId = actor(), diagramRoot = model.getRoot(); let scopePromise, released = false, dirty = false, inTransaction = false, draftBase = store; // CHANGE
            const handles = new Set(), delegated = new Map(); let writeContext; // CHANGE
            function permissionIdentity() { // NEW: invalidate on authority changes, not an unrelated accepted content write.
                const access = users()?.getAccessSummary?.(garden) || { ownerUserId: attr(garden, 'trellis_owner_user_id'), directGrants: json(garden, 'trellis_access_grants_json', []) }, account = users()?.getCurrentUser(); // NEW
                return C.canonical([access.ownerUserId || '', !!access.directOpen, access.directGrants || [], access.directTeamGrants || [], access.inheritedAccessGrant || null, !!account?.admin, graph.__trellisSharedPolicy ? graph.__trellisSharedPolicy.teams?.[userId] || [] : access.effectiveCapabilities || []]); // NEW: derived copies and presentation labels are not authority.
            } // NEW
            const capturedPermission = permissionIdentity(); // NEW
            function guard() {
                if (released || diagramRoot !== model.getRoot() || model.getCell(garden.id) !== garden || actor() !== userId || capturedPermission !== permissionIdentity() || !editor(garden) && options.editable) throw new Error('The garden or active user changed. Reopen this dialog.'); // CHANGE: readers and writers both stop when their captured authority changes.
            }
            async function scope() { guard(); if (!scopePromise) scopePromise = request('create', { store, manifestId, editable: options.draft === true && options.editable === true }); return scopePromise; } // CHANGE
            async function captureDraft() {
                if (!dirty) return; guard(); const { scopeId } = await scope(), result = await request('snapshot', { scopeId });
                const candidate = C.capture(result.snapshot, draftBase, { source: 'manual', author: userId }); // CHANGE
                await putDraft(garden, draftBase, candidate); draftBase = candidate; dirty = false; // CHANGE
            }
            const bridge = {
                resolvePath: async () => ({ dbPath: (await scope()).scopeId }),
                open: async (_path, settings = {}) => { // CHANGE: legacy write helpers are redirected to a separate draft connection.
                    guard(); if (settings.readOnly === false && options.draft !== true) { await restoreDraft(garden); guard(); writeContext ||= sqlContext(garden, { editable: true, draft: true }); const result = await writeContext.bridge.open('', settings); delegated.set(result.dbId, writeContext.bridge); return result; } // CHANGE: recover prior unsent work before opening any delegated definition writer.
                    const result = await request('open', { scopeId: (await scope()).scopeId, readOnly: settings.readOnly !== false }); handles.add(result.dbId); return result; // NEW
                },
                query: async (dbId, sql, params) => { guard(); return delegated.has(dbId) ? delegated.get(dbId).query(dbId, sql, params) : request('query', { dbId, sql, params }); }, // CHANGE
                exec: async (dbId, sql, params) => { guard(); if (delegated.has(dbId)) return delegated.get(dbId).exec(dbId, sql, params); const result = await request('exec', { dbId, sql, params }); if (/^\s*BEGIN\b/i.test(sql)) inTransaction = true; if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) dirty = true; if (/^\s*(COMMIT|ROLLBACK)\b/i.test(sql)) inTransaction = false; if (dirty && !inTransaction) await captureDraft(); return result; }, // CHANGE
                close: async dbId => { if (delegated.has(dbId)) { const bridge = delegated.get(dbId); delegated.delete(dbId); return bridge.close(dbId); } const result = await request('close', { dbId }); handles.delete(dbId); if (!handles.size) await captureDraft(); return result; } // CHANGE
            };
            bridge.run = bridge.exec;
            const context = { garden, store, manifestId, bridge, guard, definitionEditor: options.draft === true, filterRows(table, rows) { const retired = Object.entries(store.manifests[manifestId].heads).filter(([entity, rid]) => store.bindings[entity]?.table === table && store.revisions[rid].retired).map(([entity]) => store.bindings[entity].key); return rows.filter(row => !retired.some(key => Object.entries(key).every(([name, value]) => String(row[name]) === String(value)))); }, async release() { if (released) return; released = true; contexts.delete(context); await writeContext?.release(); if (scopePromise) await request('release', { scopeId: (await scopePromise).scopeId }); } }; // CHANGE
            contexts.add(context); return context;
        }
        async function query(cell, sql, params = []) {
            const context = sqlContext(cell); if (!context) return null;
            try { const { dbId } = await context.bridge.open('', { readOnly: true }); try { return (await context.bridge.query(dbId, sql, params)).rows; } finally { await context.bridge.close(dbId); } }
            finally { await context.release(); }
        }
        function catalog(cell, kind, options = {}) {
            const garden = gardenFor(cell) || cell; if (!attr(garden, C.ATTR)) return null;
            const store = options.draft ? drafts.get(draftKey(garden))?.candidate || read(garden) : read(garden);
            const accepted = C.catalog(store, kind, attr(cell, C.PIN) || store.current);
            if (!accepted) throw new Error('The garden is missing its accepted ' + kind + ' definitions.');
            const operational = json(garden, kind, {}), archived = json(garden, 'trellis_reference_operations_json', {})[kind] || {}; // CHANGE
            if (accepted.items && operational.items) accepted.items.forEach(item => {
                const saved = operational.items.find(value => value.id === item.id) || archived[item.id]; // CHANGE: retirement preserves a pinned consumer's existing inventory state.
                if (saved) (C.OPERATIONAL[kind] || []).forEach(key => { if (saved[key] !== undefined) item[key] = C.clone(saved[key]); });
            });
            return accepted;
        }
        function saveCatalog(cell, kind, payload) {
            const garden = gardenFor(cell) || cell; if (!attr(garden, C.ATTR)) return false;
            if (!editor(garden)) throw new Error('Editing access is required to propose definitions.');
            const base = read(garden), prior = drafts.get(draftKey(garden))?.candidate || base;
            const candidate = C.putCatalog(prior, kind, payload, { source: 'manual', author: actor() });
            putDraft(garden, prior, candidate); // CHANGE
            // Persist operational fields only; accepted definitions stay unchanged until review.
            const accepted = C.catalog(base, kind), incoming = payload.items || [];
            if (accepted?.items && C.OPERATIONAL[kind]) {
                const next = catalog(garden, kind);
                next.items.forEach(item => { const updated = incoming.find(value => value.id === item.id); if (updated) C.OPERATIONAL[kind].forEach(key => { if (updated[key] !== undefined) item[key] = C.clone(updated[key]); }); });
                transact(() => set(garden, kind, next));
            }
            return true;
        }
        const SETTINGS = ['city_id', 'city_name', 'unit_system', 'default_bed_width_cm', 'default_bed_length_cm', 'module_external_margin', 'plant_circle_max_per_planting', 'plant_circle_max_total', 'path_width_presets_json'];
        function settings(cell) {
            const result = {}; for (const item of Array.from(cell.value?.attributes || [])) if (SETTINGS.includes(item.name) || /^default_path_.+_(?:width_cm|enabled)$/.test(item.name)) result[item.name] = item.value; // CHANGE
            const margin = /(?:^|;)module_external_margin=([^;]+)/.exec(model.getStyle?.(cell) || cell.style || ''); if (margin) result.module_external_margin = margin[1]; // NEW
            const geometry = model.getGeometry(cell); if (geometry) result.geometry = { width: geometry.width, height: geometry.height }; return result;
        }
        function snapshot(cell, page = ui.currentPage) { return { name: attr(cell, 'garden_name') || attr(cell, 'label') || 'Garden', source: { gardenId: cell.id, diagramId: diagramId(), pageId: pageId(page) }, references: C.template(read(cell)), settings: settings(cell) }; } // CHANGE
        async function templates(target) {
            const values = pageGardens().filter(({ cell }) => cell !== target && attr(cell, C.ATTR)).map(({ cell, page }) => { const entry = snapshot(cell, page); if (page && page !== ui.currentPage) entry.name = (page.getName?.() || page.node?.getAttribute('name') || pageId(page)) + ' / ' + entry.name; return entry; }); // CHANGE
            if (root.trellisGardenLibrary?.referenceTemplates) { // CHANGE: an unsigned-in library does not prevent local-default creation.
                try { const result = await root.trellisGardenLibrary.referenceTemplates(); values.push(...result.templates.filter(item => item.source.diagramId !== diagramId())); } catch (error) { notify('Library templates unavailable: ' + error.message); } // NEW
            }
            return values;
        }
        async function initialize(cell, source = null) {
            if (!owner(cell)) throw new Error('Only the new garden owner can initialize its definitions.');
            if (attr(cell, C.ATTR) || attr(cell, 'trellis_reference_pending') !== '1') throw new Error('Only a new garden awaiting its first settings can initialize definitions.'); // NEW
            users()?.getDiagramKey?.({ create: true }); // NEW: private draft keys use the existing stable diagram identity.
            const original = attr(cell, C.ATTR), userId = actor(), diagramRoot = model.getRoot();
            let store = source ? C.template(source.references) : C.capture((await request('defaults')).snapshot, null, { source: 'local-defaults' });
            const equipment = graph.__trellisEquipment, irrigation = graph.__trellisIrrigationPlanner;
            const defaults = {
                equipment_inventory_json: { version: 1, items: equipment?.readEquipmentInventory(cell) || [] }, // CHANGE: capture effective normalized defaults once.
                task_type_registry_json: { version: 1, items: equipment?.readTaskTypeRegistry(cell) || [] }, // CHANGE
                equipment_capability_registry_json: { version: 1, items: equipment?.readCapabilityRegistry(cell) || [] }, // CHANGE
                workload_model_json: json(cell, 'workload_model_json', {}),
                irrigation_catalog_json: irrigation?.starterCatalog?.() || { version: 1, items: [] },
                task_recipe_library_json: { version: 1, items: [] }
                , scheduler_climate_model_defaults_json: root.USL?.scheduler?.referenceDefaults?.climatePolicy || {}, scheduler_climate_model_plant_overrides_json: {} // NEW
            };
            const missing = Object.fromEntries(C.CATALOGS.filter(kind => !C.catalog(store, kind)).map(kind => [kind, C.resetInventory(kind, defaults[kind])])); store = C.putCatalogBatch(store, missing, { source: 'creation-defaults' }); // CHANGE: normalize dependent catalogs together before sealing their identities.
            await request('validate', { store });
            if (original !== attr(cell, C.ATTR) || userId !== actor() || diagramRoot !== model.getRoot() || model.getCell(cell.id) !== cell) throw new Error('The garden changed while preparing its defaults.');
            return { store, source, finalize(cityId) { store = C.creationSnapshot(store, cityId); this.store = store; }, apply() { // CHANGE
                if (original !== attr(cell, C.ATTR) || !owner(cell) || userId !== actor()) throw new Error('The garden changed. Prepare its settings again.');
                set(cell, C.ATTR, store); set(cell, 'trellis_reference_pending', '0');
                for (const kind of C.CATALOGS) set(cell, kind, C.resetInventory(kind, C.catalog(store, kind)));
                if (source) { set(cell, 'trellis_template_source_json', source.source); for (const [key, value] of Object.entries(source.settings || {})) if (key !== 'geometry') set(cell, key, value); }
            } };
        }
        function messages(cell) { return json(cell, C.PROPOSALS, { version: 1, requests: [], decisions: [] }); }
        function saveCatalogBatch(cell, payloads) { // NEW
            const garden = gardenFor(cell) || cell; if (!attr(garden, C.ATTR)) return false; if (!editor(garden)) throw new Error('Editing access is required to propose definitions.'); // NEW
            const prior = drafts.get(draftKey(garden))?.candidate || read(garden), candidate = C.putCatalogBatch(prior, payloads, { source: 'manual', author: actor() }); putDraft(garden, prior, candidate); // NEW
            for (const [kind, payload] of Object.entries(payloads)) if (C.OPERATIONAL[kind]) { // NEW
                const accepted = catalog(garden, kind), incoming = payload.items || []; accepted.items.forEach(item => { const value = incoming.find(next => next.id === item.id); if (value) C.OPERATIONAL[kind].forEach(key => { if (value[key] !== undefined) item[key] = C.clone(value[key]); }); }); transact(() => set(garden, kind, accepted)); // NEW
            } // NEW
            return true; // NEW
        } // NEW
        function pendingCount(options = {}) { return (options?.scopeCell ? [gardenFor(options.scopeCell) || options.scopeCell] : gardens()).filter(cell => attr(cell, C.ATTR) && owner(cell)).reduce((count, cell) => { const log = messages(cell); return count + log.requests.filter(item => item.changes.some(change => !selectedItems(log, item.id).has(change.entityId))).length; }, 0); } // NEW
        function submit(source, target, base, candidate, note = '') {
            if (!editor(target)) throw new Error('Editing access to the receiving garden is required.');
            const request = C.proposal(base, candidate, actor(), { gardenId: source.id, diagramId: diagramId(), pageId: pageId() }, { gardenId: target.id, pageId: pageId() }, note); // CHANGE
            const targetHeads = read(target).manifests[read(target).current].heads; request.changes = request.changes.filter(item => !item.dependency || !targetHeads[item.entityId]); // NEW
            const log = messages(target); log.requests.push(request); transact(() => set(target, C.PROPOSALS, log)); return request;
        }
        async function sendDraft(source, draft, targets, note) { // NEW
            const failures = [], storageKey = draftKey(source), diagramRoot = model.getRoot(); draft.deliveries ||= new Map(); // CHANGE
            function guardDelivery() { if (actor() !== draft.actor || model.getRoot() !== diagramRoot || model.getCell(source.id) !== source) throw new Error('The active user or diagram changed. Reopen your draft to continue sending.'); } // NEW
            for (const target of targets) { // NEW
                guardDelivery(); // NEW
                const key = target.diagramId + ':' + (target.pageId || '') + ':' + target.gardenId; let delivery = draft.deliveries.get(key); // CHANGE
                if (delivery?.sent) continue; // NEW
                if (!delivery) { delivery = { request: C.proposal(draft.base, draft.candidate, actor(), { gardenId: source.id, diagramId: diagramId(), pageId: pageId() }, target, note) }; draft.deliveries.set(key, delivery); await persistDraft(source, false, storageKey); } guardDelivery(); // CHANGE
                try { // NEW
                    if (target.local) { // NEW
                        const cell = pageGardens().find(entry => String(entry.cell.id) === String(target.gardenId) && pageId(entry.page) === (target.pageId || ''))?.cell; if (!cell || !editor(cell)) throw new Error('Editing access to the receiving garden is required.'); // CHANGE
                        const log = messages(cell), heads = read(cell).manifests[read(cell).current].heads; delivery.request.changes = delivery.request.changes.filter(item => !item.dependency || !heads[item.entityId]); // NEW
                        if (!log.requests.some(item => item.id === delivery.request.id)) { log.requests.push(delivery.request); transact(() => set(cell, C.PROPOSALS, log)); } // NEW
                    } else { const result = await root.trellisGardenLibrary.sendReferenceProposal({ ...target, proposal: delivery.request }); if (!result.ok) throw new Error(result.reason + (result.recoveryPath ? ' Recovery: ' + result.recoveryPath : '')); } // NEW
                    delivery.sent = true; await persistDraft(source, false, storageKey); // CHANGE
                } catch (error) { failures.push(target.name + ': ' + error.message); } // NEW
            } // NEW
            if (failures.length) throw new Error('Some proposals remain unsent. ' + failures.join('\n')); // NEW
            guardDelivery(); drafts.delete(storageKey); await persistDraft(source, true, storageKey); // CHANGE
        } // NEW
        function selectedItems(log, requestId) { return new Set(log.decisions.filter(decision => decision.proposalId === requestId).flatMap(decision => decision.items)); }
        async function preview(cell, requestId, selected, resolutions = {}, mappings = {}, plantingIds = []) { // CHANGE
            if (!owner(cell)) throw new Error('Only the receiving garden owner can accept definitions.');
            const baseText = attr(cell, C.ATTR), logText = attr(cell, C.PROPOSALS), base = read(cell), log = messages(cell), proposal = log.requests.find(item => item.id === requestId);
            if (!proposal) throw new Error('Proposal is unavailable.');
            const decided = selectedItems(log, requestId); if (selected.some(item => decided.has(item))) throw new Error('A selected item already has an owner decision.');
            const result = C.review(base, proposal, selected, resolutions, C.uuid, mappings); // CHANGE
            if (!result.conflicts.length) await request('validate', { store: result.store });
            const recalculations = []; // NEW
            if (!result.conflicts.length && plantingIds.length) { // NEW
                const scheduler = root.USL?.scheduler?.forGarden?.(cell, { store: result.store, manifestId: result.store.current }); // NEW
                if (!scheduler?.prepareReferenceRecalculation) throw new Error('Scheduler reference recalculation is unavailable.'); // NEW
                for (const plantingId of plantingIds) { const planting = model.getCell(plantingId); if (!planting || gardenFor(planting) !== cell) throw new Error('A selected planting is unavailable.'); requireRecalculable(planting); requireRecalculable(planting, result.store); recalculations.push(await scheduler.prepareReferenceRecalculation(planting)); } // CHANGE
            } // NEW
            return { ...result, baseText, logText, proposal, actor: actor(), garden: cell, resolutions: C.clone(resolutions), mappings: C.clone(mappings), recalculations, plantingIds: [...plantingIds], diagramRoot: model.getRoot() }; // CHANGE
        }
        function commit(preview) {
            const cell = preview.garden;
            if (!owner(cell) || actor() !== preview.actor || model.getCell(cell.id) !== cell || attr(cell, C.ATTR) !== preview.baseText || attr(cell, C.PROPOSALS) !== preview.logText) throw new Error('The garden or owner changed. Refresh the review.');
            if (preview.conflicts.length) throw new Error('Resolve every overlapping field before acceptance.');
            const log = messages(cell), before = read(cell);
            if (preview.diagramRoot !== model.getRoot()) throw new Error('The diagram changed. Preview again.'); // NEW
            preview.recalculations?.forEach(item => { requireRecalculable(item.cell); requireRecalculable(item.cell, preview.store); item.check(); }); // CHANGE
            const decision = { id: C.uuid(), proposalId: preview.proposal.id, actor: actor(), items: preview.selected, status: 'accepted', resolutions: preview.resolutions, mappings: preview.mappings, plantingIds: preview.plantingIds, before: before.current, after: preview.store.current, at: new Date().toISOString() }; // CHANGE
            log.decisions.push(decision);
            transact(() => {
                const operations = json(cell, 'trellis_reference_operations_json', {}); // NEW
                for (const [kind, keys] of Object.entries(C.OPERATIONAL)) { operations[kind] ||= {}; for (const item of json(cell, kind, {}).items || []) operations[kind][item.id] = Object.fromEntries(keys.filter(key => item[key] !== undefined).map(key => [key, C.clone(item[key])])); } set(cell, 'trellis_reference_operations_json', operations); // NEW: operational history is separate from immutable reusable definitions and omitted from templates.
                set(cell, C.ATTR, preview.store); set(cell, C.PROPOSALS, log);
                for (const kind of C.CATALOGS) { const accepted = C.catalog(preview.store, kind); if (!accepted) continue; const current = catalog(cell, kind); set(cell, kind, { ...accepted, ...(current?.items ? { items: accepted.items.map(item => { const old = current.items.find(value => value.id === item.id); const next = C.resetInventory(kind, { items: [item] }).items[0]; if (old) (C.OPERATIONAL[kind] || []).forEach(key => { if (old[key] !== undefined) next[key] = old[key]; }); return next; }) } : {}) }); }
                preview.recalculations?.forEach(item => item.apply()); // CHANGE: definitions, consumer pins, schedules and generated tasks share one graph transaction.
            });
            root.dispatchEvent(new CustomEvent('trellisReferencesChanged', { detail: { gardenId: cell.id } })); return decision;
        }
        function plantingStatus(cell, candidate) { // CHANGE
            const garden = gardenFor(cell), attrs = Object.fromEntries(Array.from(cell.value?.attributes || []).map(item => [item.name, item.value])), store = candidate || read(garden); // CHANGE
            const city = C.rowByKey(store, candidate ? store.current : attr(cell, C.PIN) || store.current, 'Cities', { city_id: attrs.city_id || attr(garden, 'city_id') }); // CHANGE
            const tasks = Object.values(model.cells || {}).filter(item => String(attr(item, 'linkedTo')).split(',').map(value => value.trim()).includes(String(cell.id))).map(item => Object.fromEntries(Array.from(item.value?.attributes || []).map(attr => [attr.name, attr.value]))); // NEW
            try { return C.canRecalculate(attrs, tasks, C.localToday(city?.timezone)); } catch (error) { return { ok: false, reason: error.message }; } // NEW
        } // NEW
        function requireRecalculable(cell, candidate) { const result = plantingStatus(cell, candidate); if (!result.ok) throw new Error((attr(cell, 'label') || cell.id) + ': ' + result.reason); } // CHANGE
        function reject(cell, proposalId, items, note = '') {
            if (!owner(cell)) throw new Error('Only the receiving garden owner can decline definitions.');
            const log = messages(cell), proposal = log.requests.find(item => item.id === proposalId), decided = selectedItems(log, proposalId);
            if (!proposal || !items.length || items.some(entity => decided.has(entity) || !proposal.changes.some(item => item.entityId === entity))) throw new Error('Refresh the selected proposal items.');
            log.decisions.push({ id: C.uuid(), proposalId, actor: actor(), items, status: 'declined', note, at: new Date().toISOString() }); transact(() => set(cell, C.PROPOSALS, log));
        }
        function button(label, fn, parent) { const control = document.createElement('button'); control.textContent = label; control.type = 'button'; control.addEventListener('click', () => Promise.resolve().then(fn).catch(error => ui.handleError ? ui.handleError(error) : mxUtils.alert(error.message))); parent.appendChild(control); root.Trellis?.ui?.applyButtonStyle?.(control, 'neutral'); return control; }
        function text(parent, value) { const node = document.createElement('div'); node.textContent = value; parent.appendChild(node); return node; }
        function show(cell = activeGarden()) {
            if (!cell) throw new Error('Select a garden first.');
            if (!draftReady.has(draftKey(cell)) && !drafts.has(draftKey(cell))) { const user = actor(), diagram = model.getRoot(); restoreDraft(cell).then(() => { if (actor() === user && model.getRoot() === diagram && model.getCell(cell.id) === cell) show(cell); }).catch(error => ui.handleError?.(error)); return; } // CHANGE
            const store = read(cell), panel = document.createElement('div'); panel.style.cssText = 'padding:16px;overflow:auto;max-height:70vh;';
            text(panel, 'Garden references — ' + (attr(cell, 'garden_name') || attr(cell, 'label') || 'Garden')).style.fontWeight = 'bold';
            text(panel, 'Accepted definitions travel with this garden. Existing plantings retain their pinned revisions.');
            const input = document.createElement('textarea'); input.rows = 8; input.style.width = '100%'; input.setAttribute('aria-label', 'Reference JSON'); panel.appendChild(input);
            button('Export accepted JSON', () => { input.value = JSON.stringify(C.template(store), null, 2); }, panel);
            if (editor(cell)) button('Import JSON as a draft', async () => { // CHANGE: cross-garden identity choices belong to owner review, after submission.
                if (drafts.has(draftKey(cell))) throw new Error('Send or discard your existing draft before importing another snapshot.'); // NEW
                const candidate = C.validate(JSON.parse(input.value)), accepted = read(cell); if (!C.equal(candidate.schema, accepted.schema)) throw new Error('The imported snapshot uses a different reference schema.'); await request('validate', { store: candidate }); // NEW
                const known = Object.keys(candidate.manifests[candidate.current].heads).some(entity => accepted.manifests[accepted.current].heads[entity]); await putDraft(cell, known ? accepted : C.newStore(candidate.schema), candidate); ui.hideDialog(); show(cell); // NEW
            }, panel); // NEW
            const draft = drafts.get(draftKey(cell));
            if (draft) {
                text(panel, 'Your unsent draft');
                const target = document.createElement('select'), targets = new Map(); target.multiple = true; target.size = 5; target.setAttribute('aria-label', 'Receiving gardens'); // CHANGE
                function targetOption(value) { const key = String(targets.size), option = document.createElement('option'); targets.set(key, value); option.value = key; option.textContent = value.name; option.selected = value.local && value.gardenId === cell.id; target.appendChild(option); } // NEW
                pageGardens().filter(({ cell }) => editor(cell) && attr(cell, C.ATTR)).forEach(({ cell: garden, page }) => targetOption({ local: true, diagramId: diagramId(), pageId: pageId(page), gardenId: garden.id, name: (page && page !== ui.currentPage ? (page.getName?.() || pageId(page)) + ' / ' : '') + (attr(garden, 'garden_name') || attr(garden, 'label') || garden.id) })); panel.appendChild(target); // CHANGE
                if (root.trellisGardenLibrary?.referenceTemplates) root.trellisGardenLibrary.referenceTemplates().then(result => { if (!panel.isConnected) return; result.templates.filter(item => item.canPropose && item.source.diagramId !== diagramId()).forEach(item => targetOption({ ...item.source, name: item.name })); }).catch(error => text(panel, 'Library recipients unavailable: ' + error.message)); // NEW
                const note = document.createElement('textarea'); note.placeholder = 'Reason and sources'; panel.appendChild(note);
                button('View draft JSON', () => { input.value = JSON.stringify(draft.candidate, null, 2); }, panel);
                button('Send proposal to selected gardens', async () => { const selected = Array.from(target.selectedOptions).map(option => targets.get(option.value)); if (!selected.length) throw new Error('Select at least one receiving garden.'); await sendDraft(cell, draft, selected, note.value); ui.hideDialog(); show(cell); }, panel); // CHANGE
                button('Discard draft', async () => { drafts.delete(draftKey(cell)); await persistDraft(cell, true); ui.hideDialog(); show(cell); }, panel); // CHANGE
            }
            renderMessages(panel, { scopeCell: cell }); // CHANGE
            if (root.trellisGardenLibrary?.referenceTemplates) root.trellisGardenLibrary.referenceTemplates().then(result => { if (!panel.isConnected) return; result.messages.filter(item => item.diagramId !== diagramId() && item.source?.diagramId === diagramId()).forEach(item => text(panel, 'Proposal to ' + item.gardenName + ': ' + item.pending + ' item(s) awaiting a decision; ' + item.decisions.map(decision => decision.status + ' ' + decision.items.length).join(', '))); }).catch(() => {}); // NEW
            const records = document.createElement('details'); text(records, 'Retire or restore definitions'); panel.appendChild(records);
            const picker = document.createElement('select'); Object.entries(store.manifests[store.current].heads).forEach(([entity, rid]) => { const rev = store.revisions[rid]; if (C.CATALOGS.includes(rev.kind) && !rev.data.item) return; const option = document.createElement('option'); option.value = entity; option.textContent = rev.kind + ': ' + (rev.data.item?.name || rev.data.item?.id || rev.data.plant_name || rev.data.city_name || rev.data.variety_name || rev.data.name || entity) + (rev.retired ? ' (retired)' : ''); picker.appendChild(option); }); records.appendChild(picker); // CHANGE
            if (editor(cell)) button('Propose retirement / restoration', () => { const entity = picker.value, rev = store.revisions[store.manifests[store.current].heads[entity]]; putDraft(cell, store, C.retire(store, entity, !rev.retired, { author: actor() })); ui.hideDialog(); show(cell); }, records);
            button('Close', () => ui.hideDialog(), panel); ui.showDialog(panel, 780, 640, true, true);
        }
        function renderMessages(parent, options = {}) {
            const candidates = options.scopeCell ? [gardenFor(options.scopeCell) || options.scopeCell] : gardens(); let count = 0;
            candidates.forEach(cell => {
                if (!attr(cell, C.ATTR)) return;
                const log = messages(cell);
                log.requests.filter(item => owner(cell) || item.author === actor()).forEach(proposal => {
                    count++; const box = document.createElement('fieldset'); parent.appendChild(box);
                    text(box, 'Reference proposal: ' + (attr(cell, 'garden_name') || cell.id) + ' — ' + proposal.author); text(box, proposal.note || 'No rationale supplied.');
                    const decided = selectedItems(log, proposal.id), checked = [], resolutions = {}, mappings = {}, plantingChoices = []; let prepared; // CHANGE
                    proposal.changes.forEach(item => {
                        const label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.checked = !decided.has(item.entityId); check.disabled = decided.has(item.entityId); checked.push({ check, item }); label.appendChild(check); label.appendChild(document.createTextNode(item.candidate.kind + ': ' + (item.candidate.data.plant_name || item.candidate.data.city_name || item.candidate.data.item?.name || item.candidate.data.item?.id || item.candidate.data.name || item.entityId) + (!item.base ? ' (new distinct entity)' : '') + (decided.has(item.entityId) ? ' — decided' : ''))); box.appendChild(label); box.appendChild(document.createElement('br'));
                        const details = document.createElement('details'); text(details, 'Base and proposed definition'); const pre = document.createElement('pre'); pre.textContent = JSON.stringify({ base: item.base, candidate: item.candidate }, null, 2); details.appendChild(pre); box.appendChild(details);
                        if (owner(cell) && !decided.has(item.entityId) && !read(cell).manifests[read(cell).current].heads[item.entityId]) { // NEW
                            const select = document.createElement('select'), distinct = document.createElement('option'); distinct.value = ''; distinct.textContent = 'Adopt as a distinct new identity'; select.appendChild(distinct); // NEW
                            Object.entries(read(cell).manifests[read(cell).current].heads).forEach(([entity, rid]) => { const local = read(cell).revisions[rid]; if (local.kind !== item.candidate.kind) return; const option = document.createElement('option'); option.value = entity; option.textContent = 'Map to: ' + (local.data.item?.name || local.data.item?.id || local.data.plant_name || local.data.variety_name || local.data.city_name || (local.data.metadata ? 'Catalog metadata' : entity)); select.appendChild(option); }); // NEW
                            select.setAttribute('aria-label', 'Identity mapping for ' + item.entityId); select.onchange = () => { if (select.value) mappings[item.entityId] = select.value; else delete mappings[item.entityId]; prepared = null; }; box.appendChild(select); // NEW
                        } // NEW
                    });
                    log.decisions.filter(item => item.proposalId === proposal.id).forEach(decision => text(box, decision.status + ': ' + decision.items.length + ' item(s), ' + decision.actor + ' — ' + decision.at));
                    if (owner(cell) && checked.some(entry => !entry.check.disabled)) {
                        const status = text(box, ''), conflicts = document.createElement('div'); box.appendChild(conflicts); // CHANGE
                        const plantingPanel = document.createElement('details'); text(plantingPanel, 'Optional: recalculate selected unstarted plantings'); box.appendChild(plantingPanel); // NEW
                        Object.values(model.cells || {}).filter(item => gardenFor(item) === cell && (attr(item, 'tiler_group') === '1' || /(?:^|;)tiler_group=1(?:;|$)/.test(model.getStyle?.(item) || item.style || ''))).forEach(planting => { // NEW
                            const status = plantingStatus(planting), label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.disabled = !status.ok; input.onchange = () => { prepared = null; }; label.appendChild(input); label.appendChild(document.createTextNode((attr(planting, 'label') || planting.id) + (status.ok ? '' : ' — ' + status.reason))); plantingPanel.appendChild(label); plantingPanel.appendChild(document.createElement('br')); plantingChoices.push({ input, planting }); // NEW
                        }); // NEW
                        button('Preview selected changes', async () => {
                            conflicts.replaceChildren(); prepared = await preview(cell, proposal.id, checked.filter(entry => entry.check.checked && !entry.check.disabled).map(entry => entry.item.entityId), resolutions, mappings, plantingChoices.filter(entry => entry.input.checked && !entry.input.disabled).map(entry => entry.planting.id)); // CHANGE
                            status.textContent = prepared.conflicts.length ? 'Choose a value for each overlapping field, then preview again.' : 'Validated. ' + prepared.recalculations.length + ' selected planting(s) will be recalculated. Other plantings retain their revisions.'; // CHANGE
                            if (prepared.recalculations.length) { const detail = document.createElement('pre'); detail.textContent = JSON.stringify(prepared.recalculations.map(item => ({ plantingId: item.cell.id, before: item.before, after: item.patch, generatedTasks: item.tasks })), null, 2); conflicts.appendChild(detail); } // NEW
                            prepared.conflicts.forEach(conflict => { text(conflicts, conflict.path + '\nCurrent: ' + JSON.stringify(conflict.current) + '\nIncoming: ' + JSON.stringify(conflict.incoming)); const select = document.createElement('select'); ['', 'current', 'incoming'].forEach(value => { const option = document.createElement('option'); option.value = value; option.textContent = value || 'Choose…'; select.appendChild(option); }); select.onchange = () => { (resolutions[conflict.entityId] ||= {})[conflict.path] = select.value; prepared = null; }; conflicts.appendChild(select); });
                        }, box);
                        checked.forEach(entry => entry.check.addEventListener('change', () => { prepared = null; }));
                        button('Accept preview', () => { if (!prepared) throw new Error('Preview the current selection first.'); commit(prepared); ui.hideDialog(); show(cell); }, box);
                        button('Decline selected', () => { reject(cell, proposal.id, checked.filter(entry => entry.check.checked && !entry.check.disabled).map(entry => entry.item.entityId)); ui.hideDialog(); show(cell); }, box);
                    }
                });
            }); return count;
        }
        function pin(cell, manifestId) { const garden = gardenFor(cell); if (garden && attr(garden, C.ATTR)) set(cell, C.PIN, manifestId || read(garden).current); }
        function changeAllowed(change, context) {
            const cell = change.cell || change.child;
            if (!cell) return null;
            let before = change.previous?.nodeType === 1 ? change.previous : null; const after = cell.value; // CHANGE
            if (change.constructor.name === 'mxCellAttributeChange' && [C.ATTR, C.PROPOSALS, ...C.CATALOGS].includes(change.attribute || change.key) && after?.nodeType === 1) { before = after.cloneNode(true); const key = change.attribute || change.key; if (change.previous == null) before.removeAttribute(key); else before.setAttribute(key, change.previous); } // NEW
            if (before && after?.nodeType === 1 && isGarden(cell)) { // CHANGE
                const keys = [C.ATTR, C.PROPOSALS, ...C.CATALOGS], changed = keys.filter(key => before.getAttribute(key) !== after.getAttribute(key));
                if (!changed.length) return null;
                try {
                    if (before.getAttribute(C.ATTR) !== after.getAttribute(C.ATTR)) { // CHANGE: validate the complete action in signed replay; mxValueChanges here can be intermediate steps of that action.
                        if (!owner(cell) || !authorizedReferenceChanges.has(change)) return false; C.validate(JSON.parse(after.getAttribute(C.ATTR))); // CHANGE
                    } // NEW
                    const oldLog = C.logValid(JSON.parse(before.getAttribute(C.PROPOSALS) || '{"version":1,"requests":[],"decisions":[]}')), log = C.logValid(JSON.parse(after.getAttribute(C.PROPOSALS) || '{"version":1,"requests":[],"decisions":[]}')); // NEW
                    for (const field of ['requests', 'decisions']) for (const item of oldLog[field]) if (!log[field].some(next => next.id === item.id && C.equal(next, item))) return false; // NEW
                    if (log.requests.some(item => !oldLog.requests.some(old => old.id === item.id) && (!editor(cell) || item.author !== actor()))) return false; // NEW
                    if (log.decisions.some(item => !oldLog.decisions.some(old => old.id === item.id) && (!owner(cell) || item.actor !== actor()))) return false; // NEW
                    if (before.getAttribute(C.ATTR) === after.getAttribute(C.ATTR)) for (const kind of C.CATALOGS) if (before.getAttribute(kind) !== after.getAttribute(kind) && after.getAttribute(C.ATTR)) { const accepted = C.catalog(read(cell), kind); if (!C.equal(C.catalogDefinition(kind, JSON.parse(after.getAttribute(kind))), accepted)) return false; } // NEW
                    const names = new Set([...Array.from(before.attributes), ...Array.from(after.attributes)].map(item => item.name));
                    return [...names].every(key => before.getAttribute(key) === after.getAttribute(key) || keys.includes(key)) ? true : null;
                } catch (_) { return false; }
            }
            return null;
        }
        const api = { read, owner, editor, gardenFor, activeGarden, sqlContext, query, catalog, saveCatalog, saveCatalogBatch, snapshot, templates, initialize, submit, preview, commit, reject, messages, renderMessages, pendingCount, show, pin, consumerCell, scopeForConsumer, changeAllowed, putDraft, drafts, getDraft: cell => drafts.get(draftKey(cell)), isDraftReady: cell => draftReady.has(draftKey(cell)) || drafts.has(draftKey(cell)), restoreDraft, persistDraft, flushDrafts: () => Promise.all([...draftWrites.values()]), settings, request }; // CHANGE
        graph.__trellisReferences = api; root.Trellis = root.Trellis || {}; root.Trellis.references = api;
        ui.actions.addAction('trellisGardenReferences', () => { try { show(); } catch (error) { ui.handleError?.(error); } });
        const action = ui.actions.get('trellisGardenReferences'); if (action) action.label = 'Garden references…';
        const extras = ui.menus?.get('extras'); if (extras) { const old = extras.funct; extras.funct = function (menu, parent) { old?.apply(this, arguments); ui.menus.addMenuItems(menu, ['-', 'trellisGardenReferences'], parent); }; }
        ui.editor.addListener?.('fileLoaded', () => { drafts.clear(); draftLoads.clear(); draftReady.clear(); for (const context of contexts) context.release().catch(() => {}); }); // CHANGE
        root.addEventListener('trellisUsersSessionChanged', () => { // CHANGE: same-user policy revalidation must not close a valid in-flight SQL view.
            for (const context of contexts) { try { context.guard(); } catch (_) { context.release().catch(() => {}); } } // NEW: actor, document and write-authority changes still invalidate their captured context.
        }); // NEW
    }
    Draw.loadPlugin(ui => { const ready = () => root.indexedDB && !root.TrellisReferenceDrafts ? mxscript('js/trellis-reference-drafts.js', () => install(ui)) : install(ui); if (root.TrellisReferenceCore) ready(); else mxscript('js/trellis-reference-core.js', ready); }); // CHANGE
})(window); // NEW
