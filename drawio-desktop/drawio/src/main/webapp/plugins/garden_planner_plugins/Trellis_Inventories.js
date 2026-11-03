/** Shared inventory navigation and editors. Graph adapters retain the editor's unsaved document. */ // NEW
(function (root) { // NEW
    'use strict'; // NEW
    const S = root.TrellisSeedsCore; // NEW
    function element(tag, text) { const node = document.createElement(tag); if (text != null) node.textContent = text; return node; } // NEW
    function button(text, action) { // NEW
        const node = element('button', text); node.type = 'button'; node.addEventListener('click', action); // NEW
        root.Trellis?.ui?.applyButtonStyle?.(node, 'neutral'); return node; // NEW
    } // NEW
    function showError(error) { root.alert(error.message || String(error)); } // NEW
    /** Independent overlays leave the active Year Planner and its draft mounted underneath. */ // NEW
    function modal(title) { // NEW
        const previous = document.activeElement, overlay = element('div'), dialog = element('section'), heading = element('h2', title), body = element('div'), footer = element('div'), status = element('p'); // NEW
        overlay.style.cssText = 'position:fixed;inset:0;z-index:12000;background:#0006;display:flex;align-items:center;justify-content:center;padding:24px;'; // NEW
        dialog.style.cssText = 'background:var(--ge-dialog-background,#fff);color:var(--ge-text-color,#222);border:1px solid #888;border-radius:8px;width:1000px;max-width:100%;max-height:90vh;overflow:auto;padding:20px;box-sizing:border-box;font:13px/1.5 system-ui,sans-serif;'; // NEW
        dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', title); // NEW
        dialog.classList.add('trellis-surfaces'); body.dataset.trellisSurface = 'entry'; heading.dataset.trellisSurface = 'header'; dialog.style.setProperty('--trellis-surface-base', 'var(--ge-dialog-background,#fff)'); dialog.style.setProperty('--trellis-surface-ink', 'var(--ge-text-color,#222)'); // NEW: shared surface hierarchy.
        status.setAttribute('role', 'status'); footer.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:18px;'; // NEW
        let dirty = () => false, busy = false; const disposers = []; // NEW // NEW
        const destroy = () => { overlay.remove(); disposers.forEach(dispose => dispose()); previous?.focus?.(); return true; }; // NEW
        const close = () => { if (busy || dirty() && !root.confirm('Discard unsaved changes?')) return false; return destroy(); }; // NEW
        overlay.addEventListener('keydown', event => { // NEW
            if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); close(); } // NEW
            if (event.key === 'Tab') { // NEW
                const nodes = [...dialog.querySelectorAll('button,input,select,textarea,[tabindex]')].filter(node => !node.disabled && node.offsetParent !== null), first = nodes[0], last = nodes.at(-1); // NEW
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } // NEW
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } // NEW
            } // NEW
        }); // NEW
        footer.append(button('Close', close)); dialog.append(heading, body, status, footer); overlay.append(dialog); document.body.append(overlay); footer.firstChild.focus(); // NEW
        return { body, footer, status, close, destroy, onClose: fn => disposers.push(fn), dirty: fn => { dirty = fn; }, async run(action) { if (busy) return; busy = true; status.textContent = ''; try { return await action(); } catch (error) { status.textContent = error.message; } finally { busy = false; } } }; // NEW
    } // NEW
    function input(value, change, type = 'text') { // NEW
        const node = element('input'); node.type = type; node.value = value ?? ''; node.defaultValue = node.value; node.style.width = type === 'number' ? '100px' : '150px'; node.style.maxWidth = '100%'; node.addEventListener('input', () => node.setCustomValidity('')); node.addEventListener('change', () => { try { change(node.value); } catch (error) { node.setCustomValidity(error.message); node.reportValidity(); } }); return node; // NEW
    } // NEW
    function select(values, value, change) { // NEW
        const node = element('select'); for (const entry of values) { const option = element('option', entry.label); option.value = entry.id; node.append(option); } // NEW
        node.value = value; node.addEventListener('change', () => change(node.value)); return node; // NEW
    } // NEW
    function graphAdapter(ui, garden) { // NEW
        const graph = ui.editor.graph, model = graph.getModel(), raw = name => garden.getAttribute(name) || ''; // NEW
        const users = graph.__trellisUsers; // NEW
        const canEdit = () => !users?.isEnabled?.() || users.getCurrentUser()?.admin || raw('trellis_owner_user_id') === users.getCurrentUser()?.id || users.effectiveCapabilitiesForCell(garden).includes('manage_scope_content'); // NEW
        return { // NEW
            async read() { // NEW
                const seeds = S.normalize(raw(S.ATTR) || null), plans = JSON.parse(raw('plan_year_json') || '{}'), references = JSON.parse(raw('trellis_references_json') || 'null'); // NEW
                return { seeds, plans, references, ...S.planningStatus(seeds, plans, references), canEdit: canEdit(), revision: raw(S.ATTR) }; // CHANGE
            }, // NEW
            async save(snapshot, items) { // NEW
                if (model.getCell(garden.id) !== garden || !canEdit()) throw new Error('Garden access changed. Reopen Inventories.'); // NEW
                if (raw(S.ATTR) !== snapshot.revision) throw new Error('The seed inventory changed. Keep this draft open and reconcile the latest stock before saving.'); // NEW
                S.validateDefinitions(items, JSON.parse(raw('trellis_references_json') || 'null')); // NEW
                const next = S.normalize({ ...snapshot.seeds, items }); // NEW
                const node = garden.value?.cloneNode?.(true) || mxUtils.createXmlDocument().createElement('object'); node.setAttribute(S.ATTR, JSON.stringify(next)); // NEW
                const context = graph.__trellisEditContext || root.TrellisEditContext?.install(ui); // CHANGE
                const apply = () => { model.beginUpdate(); try { model.setValue(garden, node); } finally { model.endUpdate(); } }; // CHANGE
                if (context?.apply) context.apply({ cells: [garden], manualSources: [garden], includeAncestors: false }, apply); else apply(); // CHANGE
                snapshot.seeds = S.normalize(raw(S.ATTR)); snapshot.revision = raw(S.ATTR); return { persistence: 'diagram-draft' }; // NEW
            }, // NEW
            equipment: () => graph.__trellisEquipment.openDialog(garden) // NEW
        }; // NEW
    } // NEW
    async function chooseGarden() { // NEW
        if (!root.trellisInventories) throw new Error('Inventories requires the Trellis desktop bridge.'); // NEW
        const result = await root.trellisInventories.list(); // NEW
        if (!result.gardens.length) throw new Error(result.errors?.[0]?.message || 'Add a garden with accepted crop references to Garden Projects first.'); // NEW
        if (result.gardens.length === 1) return result.gardens[0]; // NEW
        return new Promise(resolve => { // NEW
            const view = modal('Choose a garden'); let selected = result.gardens[0]; // NEW
            view.body.append(select(result.gardens.map((garden, index) => ({ id: String(index), label: garden.name })), '0', index => { selected = result.gardens[Number(index)]; })); // NEW
            view.footer.prepend(button('Open inventory', () => { resolve(selected); view.close(); })); // NEW
            view.onClose(() => resolve(null)); // NEW
        }); // NEW
    } // NEW
    async function provider(options) { // NEW
        if (options.garden && options.ui) return graphAdapter(options.ui, options.garden); // NEW
        const garden = options.gardenRef || await chooseGarden(); if (!garden) return null; // NEW
        return { // NEW
            read: () => root.trellisInventories.read({ garden }), // NEW
            async save(snapshot, items) { await root.trellisInventories.saveSeeds({ garden, items, base: snapshot.seeds }); Object.assign(snapshot, await root.trellisInventories.read({ garden })); return { persistence: 'accepted' }; }, // NEW // NEW
            async equipment() { // NEW
                let snapshot = await root.trellisInventories.read({ garden }); // CHANGE: advance the accepted comparison base after every save.
                if (!root.TrellisEquipmentEditor) throw new Error('The Equipment editor is still loading.'); // NEW
                root.TrellisEquipmentEditor.open(JSON.parse(JSON.stringify(snapshot)), async catalogs => { // CHANGE: the editor receives a draft, never the comparison base.
                    const result = await root.trellisInventories.saveEquipment({ garden, catalogs, base: { equipment: snapshot.equipment, taskTypes: snapshot.taskTypes, capabilities: snapshot.capabilities, manifest: snapshot.references?.current || '' } }); // CHANGE
                    snapshot = await root.trellisInventories.read({ garden }); root.alert('Equipment saved. Review definition changes in Garden references.'); return result; // CHANGE
                }); // CHANGE
            } // NEW
        }; // NEW
    } // NEW
    /** Crop choices use accepted portable entities, never display-name matching. */ // NEW
    function cropChoices(references) { // NEW
        if (!references) return []; // NEW
        const projected = root.TrellisReferenceCore.project(references); // NEW
        return projected.entities.filter(entry => !entry.retired && entry.table === 'Plants').flatMap(entry => { // NEW
            const plant = projected.tables.Plants.find(row => String(row.plant_id) === String(entry.key.plant_id)), name = plant?.plant_name || plant?.name || entry.entityId; // NEW
            const varieties = projected.entities.filter(variety => !variety.retired && variety.table === 'PlantVarieties').map(variety => ({ entry: variety, row: projected.tables.PlantVarieties.find(row => String(row.variety_id) === String(variety.key.variety_id)) })).filter(variety => String(variety.row?.plant_id) === String(entry.key.plant_id)); // NEW
            return [{ cropRef: entry.entityId, varietyRef: '', label: name }, ...varieties.map(variety => ({ cropRef: entry.entityId, varietyRef: variety.entry.entityId, label: name + ' / ' + (variety.row.variety_name || variety.row.name || variety.entry.entityId) }))]; // NEW
        }); // NEW
    } // NEW
    async function openSeeds(options = {}) {
        if (!options.editTransitionResolved && root.Trellis?.sharing?.transitionEditor) return root.Trellis.sharing.transitionEditor(() => openSeeds({ ...options, editTransitionResolved: true })); // CHANGE // NEW
        const source = await provider(options); if (!source) return; // NEW
        const snapshot = await source.read(), view = modal('Seeds inventory'), items = JSON.parse(JSON.stringify(snapshot.seeds.items)), choices = cropChoices(snapshot.references); // NEW
        let baseline = JSON.stringify(items); view.dirty(() => baseline !== JSON.stringify(items) || [...view.body.querySelectorAll('input')].some(node => node.value !== node.defaultValue)); // NEW
        const warnings = element('div'); warnings.setAttribute('aria-live', 'polite'); view.body.append(warnings); // CHANGE: recompute warnings alongside the editable stock view.
        view.body.append(element('p', 'Balances are current stock. Gram and packet conversions are estimates. Published sowing needs and accepted trades reduce available surplus.')); // NEW
        const table = element('table'); table.style.cssText = 'width:100%;min-width:630px;border-collapse:collapse;text-align:left;'; const body = element('tbody'); // NEW
        const header = element('tr'); for (const name of ['Crop / variety', 'Unit', 'Seeds per unit', 'Stock', 'Seeds', 'Protected', 'Reserved', 'Available']) { const th = element('th', name); th.scope = 'col'; th.style.cssText = 'padding:8px 8px 8px 0;border-bottom:1px solid #ddd;white-space:nowrap;'; header.append(th); } // NEW
        table.append(header, body); const tableScroll = element('div'); tableScroll.style.cssText = 'max-width:100%;overflow-x:auto;margin:12px 0;'; tableScroll.append(table); view.body.append(tableScroll); // NEW
        tableScroll.dataset.trellisSurface = 'inset'; // NEW: shared surface hierarchy.
        function render() { // NEW
            body.replaceChildren(); // NEW
            const current = S.normalize({ ...snapshot.seeds, items }), protection = S.planningStatus(current, snapshot.plans, snapshot.references), availability = protection.availability; // CHANGE
            warnings.replaceChildren(...protection.warnings.map(warning => element('p', warning))); // NEW
            for (const item of items) { // NEW
                const row = element('tr'), entry = availability.find(entry => S.key(entry) === S.key(item)), name = choices.find(choice => S.key(choice) === S.key(item))?.label || item.label || S.key(item); // NEW
                row.append(element('td', name)); // NEW
                const unit = select([{ id: 'seed', label: 'Seeds' }, { id: 'g', label: 'Grams' }, { id: 'packet', label: 'Packets' }], item.unit, value => { item.unit = value; item.seedsPerUnit = value === 'seed' ? 1 : item.seedsPerUnit || 1; render(); }); // NEW
                const conversion = input(item.seedsPerUnit, value => { if (!(Number(value) > 0)) { view.status.textContent = 'Enter a positive estimated seed count per unit.'; return; } item.seedsPerUnit = Number(value); render(); }, 'number'); conversion.required = true; conversion.min = '0.000001'; conversion.step = 'any'; conversion.disabled = item.unit === 'seed'; // NEW
                const quantity = input(item.seeds / item.seedsPerUnit, value => { const number = Number(value); if (!Number.isFinite(number)) return; item.seeds = Math.sign(number) * S.counts(Math.abs(number), item); render(); }, 'number'); quantity.required = true; quantity.step = 'any'; // NEW
                for (const control of [unit, conversion, quantity]) { if (!snapshot.canEdit) control.disabled = true; const cell = element('td'); cell.append(control); row.append(cell); } // NEW
                for (const value of [item.seeds, entry.planned, entry.reserved, entry.available]) row.append(element('td', value == null ? 'Unknown' : String(value))); // CHANGE
                if (entry.shortage) { row.style.color = '#a82020'; row.lastChild.textContent += ' — short ' + entry.shortage; } // NEW
                [...row.children].forEach(cell => { cell.style.cssText = 'padding:8px 8px 8px 0;border-bottom:1px solid #eee;'; }); body.append(row); // NEW
            } // NEW
        } // NEW
        const pageId = options.ui?.currentPage?.getId?.() || options.ui?.currentPage?.node?.getAttribute('id') || ''; // NEW
        const hold = options.garden && options.ui ? root.Trellis?.sharing?.registerEditor?.({ // NEW
            kind: 'inventory', inventoryType: 'seeds', targets: [JSON.stringify([pageId, options.garden.id])], // NEW
            resume() { view.dirty(() => baseline !== JSON.stringify(items)); }, reopen: cell => openSeeds({ ...options, garden: cell, editTransitionResolved: true }), // CHANGE
            element: view.body.closest('[role="dialog"]'), freeze() { view.dirty(() => false); }, // CHANGE
            capture: () => ({ pageId, objectId: options.garden.id, inventoryType: 'seeds', items: JSON.parse(JSON.stringify(items)), fields: [...view.body.querySelectorAll('input,select')].map(node => ({ type: node.type, value: node.value })) }), // NEW
            restore: draft => { if (draft) { items.splice(0, items.length, ...JSON.parse(JSON.stringify(draft.items))); baseline = JSON.stringify(items); render(); } }, // CHANGE
            save: async () => await save() === true, discard: () => view.destroy() // NEW
        }) : null; // NEW
        view.onClose(() => hold?.dispose(true)); // NEW
        view.body.addEventListener('input', () => hold?.touch()); view.body.addEventListener('change', () => hold?.touch()); // NEW
        async function save() { // NEW
            if (hold?.frozen?.()) return false; // CHANGE: programmatic Save cannot mutate a retained inventory draft.
            return view.run(async () => { // NEW
                for (const node of [...view.body.querySelectorAll('input')]) { if (!node.checkValidity()) { node.reportValidity(); throw new Error('Correct the highlighted inventory quantity.'); } if (node.value !== node.defaultValue) node.dispatchEvent(new Event('change')); } // NEW
                if (hold && root.Trellis?.sharing?.getInfo?.()?.managed) await hold.acquire(); // NEW
                const submitted = JSON.stringify(items), result = await source.save(snapshot, JSON.parse(submitted)); // CHANGE: native IPC receives immutable choices while later typing stays local.
                const unchanged = JSON.stringify(items) === submitted; // CHANGE
                if (unchanged) items.splice(0, items.length, ...JSON.parse(JSON.stringify(snapshot.seeds.items))); // CHANGE
                baseline = JSON.stringify(snapshot.seeds.items); render(); if (unchanged) hold?.complete?.(); // CHANGE
                view.status.textContent = !unchanged ? 'Earlier inventory changes saved. Newer edits remain in this editor.' : result.persistence === 'accepted' ? 'Seed inventory saved.' : 'Seed inventory applied. Project save is pending.'; return unchanged ? true : { draftRetained: true }; // CHANGE
            }); // NEW
        } // NEW
        if (snapshot.canEdit) { // NEW
            const picker = select([{ id: '', label: 'Choose a crop / variety' }, ...choices.map(choice => ({ id: S.key(choice), label: choice.label }))], '', () => {}); // NEW
            view.body.append(picker, button('Add seed definition', () => { const choice = choices.find(choice => S.key(choice) === picker.value); if (!choice || items.some(item => S.key(item) === S.key(choice))) return; items.push({ ...choice, seeds: 0, unit: 'seed', seedsPerUnit: 1 }); render(); })); // NEW
            view.footer.prepend(button('Save', save)); // NEW
        } // NEW
        render(); // NEW
    } // NEW
    function showMenu(anchor, options = {}) { // NEW
        const menu = element('div'), bounds = anchor.getBoundingClientRect(); menu.setAttribute('role', 'menu'); // NEW
        menu.style.cssText = 'position:fixed;z-index:13000;background:var(--ge-dialog-background,#fff);border:1px solid #888;padding:8px;display:flex;flex-direction:column;gap:6px;box-shadow:0 4px 14px #0004;'; menu.style.left = Math.min(bounds.left, root.innerWidth - 180) + 'px'; menu.style.top = bounds.bottom + 'px'; // NEW
        const close = () => { menu.remove(); document.removeEventListener('pointerdown', outside, true); }; // NEW
        const outside = event => { if (!menu.contains(event.target) && event.target !== anchor) close(); }; // NEW
        for (const [name, action] of [['Equipment', async () => { const source = await provider(options); await source?.equipment(); }], ['Seeds', () => openSeeds(options)]]) menu.append(button(name, () => { close(); anchor.focus(); Promise.resolve().then(action).catch(showError); })); // NEW
        menu.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); anchor.focus(); } }); document.body.append(menu); document.addEventListener('pointerdown', outside, true); menu.firstChild.focus(); // NEW
    } // NEW
    async function openExchange(options = {}) { // NEW
        const view = modal('The Grand Exchange'), tabs = element('div'), content = element('div'); view.body.append(tabs, content); // NEW
        if (!root.trellisExchange) { content.append(element('p', 'The Exchange service is unavailable in this build.')); return; } // NEW
        const status = await root.trellisExchange.status(); // NEW
        view.status.textContent = status.qualified ? '' : status.reason; // NEW
        content.append(element('p', status.currency ? 'Your display currency: ' + status.currency : 'Choose your city and confirm a currency before publishing priced records.')); // NEW
        for (const name of ['Seed Library', 'CSA', 'Activity']) tabs.append(button(name, () => view.run(async () => { // NEW
            content.replaceChildren(); content.append(element('h3', name)); // NEW
            const listing = await root.trellisExchange.list(); // NEW
            if (!listing.qualified) { content.append(element('p', listing.reason)); return; } // NEW
            content.append(element('p', 'Choose an existing community to browse its offers and programs.')); // NEW
        }))); // NEW
        if (options.publishCsa) { content.append(element('p', 'CSA publication uses the saved yearly plan. Save your plan before publishing.')); } // NEW
    } // NEW
    root.TrellisInventories = Object.freeze({ showMenu, openSeeds: options => openSeeds(options).catch(showError), openExchange: options => openExchange(options).catch(showError) }); // NEW
    if (root.Draw?.loadPlugin) root.Draw.loadPlugin(function () {}); // NEW: complete the startup reservation after registration.
})(window); // NEW
