/** Resumable, device-local onboarding. Workflow owners retain all editing and validation. */ // NEW
(function (root) {
    'use strict';
    const STORAGE = 'trellis.quickstart.v1:'; // NEW
    const TARGET = 'data-trellis-quickstart'; // NEW
    const CREATOR = [
        ['settings', 'Garden and settings'], ['layout', 'Create your layout'],
        ['irrigation', 'Connect one irrigated bed', true], ['plan', 'Plan your year'],
        ['allocation', 'Allocate a planting'], ['people', 'Share with a user or device', true],
        ['community', 'Share with a community', true]
    ]; // NEW
    const INVITEE = [['access', 'Join and open the project'], ['orientation', 'Find your garden and layout'], ['view-plan', 'Find the year plan'], ['view-plantings', 'Find allocated plantings']]; // NEW

    /** XML-backed mxCells and small test hosts share the same attribute reader. */ // NEW
    function attr(cell, name) {
        const value = cell && cell.value;
        return String((value && value.getAttribute ? value.getAttribute(name) : cell && cell.getAttribute && cell.getAttribute(name)) || '');
    }
    function id(cell) { return String(cell && (cell.id || cell.getId && cell.getId()) || ''); } // NEW
    function isBed(cell) { return ['garden_bed', 'gardenBed', 'is_garden_bed'].some(key => attr(cell, key) === '1'); } // NEW
    function gardenOf(cell, model) { // NEW
        while (cell) { if (attr(cell, 'garden_module') === '1') return cell; cell = model.getParent ? model.getParent(cell) : cell.parent; }
        return null;
    }
    /** Current-page descendants only; model roots may also contain inactive pages. */ // NEW
    function descendants(model, parent) {
        const out = [], queue = model.getChildren ? model.getChildren(parent) || [] : parent && parent.children || [];
        for (const cell of queue) { out.push(cell); out.push(...descendants(model, cell)); }
        return out;
    }
    function settingsReady(garden) { // NEW
        const geo = garden && (garden.geometry || garden.getGeometry && garden.getGeometry());
        return !!garden && !!(attr(garden, 'city_id') || attr(garden, 'city_name')) && ['metric', 'imperial'].includes(attr(garden, 'unit_system')) &&
            Number(attr(garden, 'default_bed_width_cm')) > 0 && Number(attr(garden, 'default_bed_length_cm')) > 0 &&
            (!geo || geo.width > 0 && geo.height > 0) && attr(garden, 'trellis_reference_pending') !== '1';
    }
    /** A saved crop list without positive demand must not finish the planning milestone. */ // NEW
    function planReady(plan) {
        if (!plan || !Array.isArray(plan.crops) || !plan.crops.length) return false;
        const channels = new Set((plan.demandChannels || []).filter(channel => channel.enabled !== false).map(channel => String(channel.id))); // NEW
        const lines = [...(plan.demands || []).filter(line => channels.has(String(line.channelId))), ...(plan.selfSufficiency?.enabled !== false && plan.selfSufficiency?.lines || [])];
        return lines.some(line => Number(line.qty) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(line.from || '') && /^\d{4}-\d{2}-\d{2}$/.test(line.to || '') && line.from <= line.to && Number(String(line.to).slice(0, 4)) >= Number(plan.year) && Number(String(line.from).slice(0, 4)) <= Number(plan.year) && plan.crops.some(crop => String(crop.id) === String(line.cropId) && crop.method && Number(crop.kgPerPlant) > 0)); // NEW
    }
    /** Ignore hidden ancestors, including collapsed details, without requiring a layout engine. */ // NEW
    function visible(node) {
        if (!node || !node.isConnected) return false;
        for (let item = node; item && item.nodeType === 1; item = item.parentElement) {
            if (item.hidden || item.getAttribute('aria-hidden') === 'true') return false;
            const style = root.getComputedStyle(item);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            if (item.tagName === 'DETAILS' && !item.open && !item.querySelector('summary')?.contains(node)) return false;
        }
        return true;
    }
    if (root.__TRELLIS_QUICKSTART_TEST__) root.__trellisQuickstartTest = { attr, settingsReady, planReady, visible }; // NEW
    if (!root.Draw) return;

    Draw.loadPlugin(function (ui) {
        const graph = ui.editor && ui.editor.graph;
        if (!graph || graph.__trellisQuickstart) return;
        let preferences, identity = '', active = false, offering = false, card = null, body = null, prompt = null;
        let observer = null, scheduled = null, highlighted = null, highlightedCell = null, cellHighlight = null, surface = null, observedModel = null, generation = 0; // NEW
        let notice = '', storageWarning = '', dragging = null, lastPromptKey = '', contextKey = '', portableIdentity = ui.__trellisGardenHome?.session?.identityId || null; // NEW
        const model = () => graph.getModel(), file = () => ui.getCurrentFile && ui.getCurrentFile();
        const users = () => graph.__trellisUsers || root.Trellis && root.Trellis.users;
        const selected = () => graph.getSelectionCell && graph.getSelectionCell();
        const stages = () => preferences.journey === 'invitee' ? INVITEE : CREATOR;
        const stage = () => stages().find(item => item[0] === progress().stage) || stages()[0];
        const pageId = () => String(ui.currentPage && (ui.currentPage.getId ? ui.currentPage.getId() : ui.currentPage.node && ui.currentPage.node.getAttribute('id')) || 'page');

        /** Portable identities are global; legacy diagram users cannot alias identities in other files. */ // NEW
        function userKey() {
            const user = users()?.getCurrentUser?.();
            if (portableIdentity) return 'identity:' + portableIdentity; // NEW
            return user?.portableIdentityId ? 'identity:' + user.portableIdentityId : user ? 'local:' + documentId() + ':' + user.id : 'signed-out';
        }
        function documentId() { // NEW
            const base = model().getCell && model().getCell('1');
            return attr(base, 'trellis_users_diagram_id') || attr(base, 'trellis_history_id') || file()?.fileObject?.path || file()?.getTitle?.() || 'unsaved';
        }
        function readPreferences() { // NEW
            try { const data = JSON.parse(root.localStorage.getItem(STORAGE + identity) || '{}'); return { ...data, contexts: data.contexts && typeof data.contexts === 'object' && !Array.isArray(data.contexts) ? data.contexts : {} }; }
            catch (_) { storageWarning = 'Quickstart progress cannot be restored on this device. You can continue for this session.'; return { contexts: {} }; }
        }
        function persist() { // NEW
            try { root.localStorage.setItem(STORAGE + identity, JSON.stringify(preferences)); return true; }
            catch (_) { storageWarning = 'Quickstart progress could not be saved. It is retained for this session; use Close when you are done.'; return false; } // NEW
        }
        function gardens() { return descendants(model(), graph.getDefaultParent()).filter(cell => attr(cell, 'garden_module') === '1'); } // NEW
        function currentGarden() { return gardens().find(cell => id(cell) === progress().gardenId) || null; } // NEW
        function progress() { // NEW
            const key = documentId() + ':' + pageId() + ':' + (preferences.journey || 'creator');
            let value = preferences.contexts[key];
            if (!value || typeof value !== 'object' || Array.isArray(value)) value = preferences.contexts[key] = {};
            value.gardenId = String(value.gardenId || '');
            value.year = Number.isInteger(Number(value.year)) && Number(value.year) >= 1900 && Number(value.year) <= 3000 ? Number(value.year) : new Date().getFullYear();
            value.stage ||= preferences.journey === 'invitee' ? 'access' : 'settings';
            for (const field of ['positions', 'skipped', 'viewed', 'successes', 'bindings']) if (!value[field] || typeof value[field] !== 'object' || Array.isArray(value[field])) value[field] = {};
            return value; // NEW: malformed local progress cannot break diagram opening.
        }
        /** Keep independent walkthrough positions and optional choices for every garden/year. */ // NEW
        function switchBinding(gardenId, year) {
            const p = progress(), fields = ['positions', 'skipped', 'viewed', 'successes'];
            p.bindings[p.gardenId + ':' + p.year] = Object.fromEntries(fields.map(key => [key, p[key]]));
            p.gardenId = String(gardenId); p.year = Number(year);
            const saved = p.bindings[p.gardenId + ':' + p.year] || {};
            for (const key of fields) p[key] = saved[key] || {};
            generation++; clearHighlight(); lastPromptKey = ''; persist();
        }
        function bindGarden() { // NEW
            const p = progress(), list = gardens();
            if (p.gardenId && list.some(g => id(g) === p.gardenId)) return;
            const candidate = gardenOf(selected(), model()) || (list.length === 1 ? list[0] : null);
            p.gardenId = id(candidate);
            if (candidate && Number(attr(candidate, 'current_year')) >= 1900 && Number(attr(candidate, 'current_year')) <= 3000) p.year = Number(attr(candidate, 'current_year')); // NEW
        }
        /** Captures are checked again after asynchronous sharing operations and identity changes. */ // NEW
        function capture() { return { generation, identity, diagramId: documentId(), pageId: pageId(), gardenId: progress().gardenId, year: progress().year }; }
        function record(name, token) { // NEW
            if (!token || token.generation !== generation || token.identity !== identity || token.diagramId !== documentId() || token.pageId !== pageId() || token.gardenId !== progress().gardenId || token.year !== progress().year) return;
            if (!['people', 'community'].includes(name)) return;
            progress().successes[name] = true; persist(); schedule();
        }
        function savedPlan(garden) { // NEW
            try { return root.USL?.planningCore?.loadPlanForYear(garden, Number(progress().year)); } catch (_) { return null; }
        }
        /** Completion derives from committed domain state, never explanation buttons or previews. */ // NEW
        function completions() {
            const garden = currentGarden(), cells = garden ? descendants(model(), garden) : [], p = progress();
            const beds = cells.filter(isBed), plan = savedPlan(garden);
            const plantings = cells.filter(cell => attr(cell, 'tiler_group') === '1' && attr(cell, 'allocation_source') === 'year_plan' && attr(cell, 'allocation_year') === String(p.year) && attr(cell, 'allocation_plan_crop_id'));
            let irrigation = false;
            const api = graph.__trellisIrrigationPlanner;
            try { irrigation = !!(garden && api?.hasConnectedBed?.(garden)); } catch (_) { /* Unavailable analysis remains an explicit optional step. */ }
            return {
                settings: settingsReady(garden), layout: beds.some(bed => Number(bed.geometry?.width || bed.getGeometry?.()?.width) > 0 && Number(bed.geometry?.height || bed.getGeometry?.()?.height) > 0),
                irrigation, plan: planReady(plan), allocation: plantings.length > 0,
                people: !!p.successes.people || !!users()?.listPendingInvites?.().length,
                community: !!p.successes.community || !!ui.__trellisGardenHome?.communities?.some(group => group.gardens.some(item => item.diagramId === documentId())), // NEW
                access: !!file() && !!users()?.isLoggedIn?.(),
                orientation: !!p.viewed.orientation, 'view-plan': !!p.viewed['view-plan'], 'view-plantings': !!p.viewed['view-plantings']
            };
        }
        function completeAll(values = completions()) { return stages().every(([key, , optional]) => values[key] || optional && progress().skipped[key]); } // NEW

        function element(tag, text, parent) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (parent) parent.appendChild(node); return node; } // NEW
        function button(label, action, parent = body) { // NEW
            const node = element('button', label, parent); node.type = 'button'; node.className = 'geBtn'; node.dataset.quickstartFocus = 'button:' + label; // NEW
            node.addEventListener('click', () => { notice = ''; try { const result = action(); if (result?.catch) result.catch(error => { notice = error.message; schedule(); }); } catch (error) { notice = error.message; } schedule(); });
            return node;
        }
        function target(name, parent = document) { return [...parent.querySelectorAll('[' + TARGET + '="' + name + '"]')].find(visible); } // NEW
        function clearHighlight() { // NEW
            if (highlighted) highlighted.classList.remove('trellis-quickstart-target'); highlighted = null;
            cellHighlight?.destroy(); cellHighlight = null; highlightedCell = null;
        }
        function highlight(node, cell) { // NEW
            if (node === highlighted && !cell || cell && cell === highlightedCell && cellHighlight) return;
            clearHighlight();
            if (node) { highlighted = node; node.classList.add('trellis-quickstart-target'); }
            else if (cell && typeof mxCellHighlight !== 'undefined') {
                const state = graph.view?.getState(cell); highlightedCell = cell;
                if (state) { cellHighlight = new mxCellHighlight(graph, '#2563eb', 4); cellHighlight.highlight(state); }
            }
        }
        function clampCard() { // NEW
            if (!card || surface) return;
            const width = card.getBoundingClientRect().width || 310, height = card.getBoundingClientRect().height || 180;
            const position = preferences.position || { x: 16, y: 100 };
            card.style.left = Math.max(8, Math.min(position.x, root.innerWidth - width - 8)) + 'px';
            card.style.top = Math.max(8, Math.min(position.y, root.innerHeight - height - 8)) + 'px';
        }
        /** One card follows the active modal, keeping its buttons inside native focus containment. */ // NEW
        function moveCard(destination) {
            if (!card || card.parentNode === destination) return;
            destination.appendChild(card); surface = destination === document.body ? null : destination;
            card.style.position = surface ? 'sticky' : 'fixed'; card.style.bottom = surface ? '0' : ''; // NEW card.style.left = surface ? '0' : ''; card.style.top = surface ? '0' : '';
            card.style.width = surface ? 'auto' : '310px'; card.style.margin = surface ? '8px 0' : '0';
            card.style.maxHeight = surface ? 'min(34vh, 260px)' : 'calc(100vh - 24px)'; card.style.flex = '0 0 auto'; // NEW
            clampCard();
        }
        /** Prefer a free viewport corner when the floating card would cover its target control. */ // NEW
        function avoidTarget(node) {
            if (surface || !card || !node) return;
            const box = card.getBoundingClientRect(), targetBox = node.getBoundingClientRect();
            const overlaps = (x, y) => x < targetBox.right + 8 && x + box.width > targetBox.left - 8 && y < targetBox.bottom + 8 && y + box.height > targetBox.top - 8;
            if (!overlaps(box.left, box.top)) return;
            const right = Math.max(8, root.innerWidth - box.width - 16), bottom = Math.max(8, root.innerHeight - box.height - 16);
            for (const [x, y] of [[right, 100], [16, bottom], [right, bottom], [16, 100]]) {
                if (y + box.height <= root.innerHeight && !overlaps(x, y)) { card.style.left = x + 'px'; card.style.top = y + 'px'; return; }
            }
        }
        function ensureCard() { // NEW
            if (card?.isConnected) return;
            surface = null; card = element('section'); card.className = 'trellis-quickstart-card'; card.style.position = 'fixed'; card.style.width = '310px'; card.setAttribute('aria-label', 'Trellis Quickstart'); // NEW
            for (const event of ['mousedown', 'click', 'dblclick']) card.addEventListener(event, event => event.stopPropagation()); // NEW
            const header = element('header', null, card), heading = element('strong', 'Quickstart', header);
            heading.tabIndex = 0; heading.title = 'Drag to move; use arrow keys to move the card';
            button('Collapse', () => { preferences.collapsed = !preferences.collapsed; persist(); }, header);
            button('Close', close, header);
            body = element('div', null, card); document.body.appendChild(card);
            heading.addEventListener('pointerdown', event => { if (surface) return; dragging = { x: event.clientX, y: event.clientY, left: card.offsetLeft, top: card.offsetTop }; heading.setPointerCapture?.(event.pointerId); event.preventDefault(); });
            heading.addEventListener('pointermove', event => { if (!dragging) return; preferences.position = { x: dragging.left + event.clientX - dragging.x, y: dragging.top + event.clientY - dragging.y }; clampCard(); });
            heading.addEventListener('pointerup', () => { dragging = null; persist(); });
            heading.addEventListener('keydown', event => { if (surface || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; preferences.position = { x: card.offsetLeft + (event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0), y: card.offsetTop + (event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0) }; event.preventDefault(); clampCard(); persist(); });
            clampCard();
        }
        function selectStage(key) { progress().stage = key; lastPromptKey = ''; persist(); schedule(); } // NEW
        function advanceField(delta) { const p = progress(), key = stage()[0]; p.positions[key] = Math.max(0, (p.positions[key] || 0) + delta); persist(); } // NEW
        function choose(label, values, value, change, parent = body) { // NEW
            const wrapper = element('label', label + ' ', parent), input = element('select', null, wrapper);
            input.setAttribute('aria-label', label); input.dataset.quickstartFocus = 'select:' + label; // NEW
            for (const [key, text] of values) { const option = element('option', text, input); option.value = key; }
            input.value = String(value); input.addEventListener('change', () => { change(input.value); persist(); schedule(); }); return input;
        }
        async function openProjects(highlightName) { // NEW
            if (!root.TrellisGardenHome) { notice = 'Garden Projects is still loading. Use Open, or retry this step after the garden tools finish loading.'; return; }
            if (highlightName === 'community-sharing' && root.Trellis?.sharing?.ensureManaged) { // NEW: preparing transport does not require inviting a user or pairing a device.
                const token = capture(), managed = await root.Trellis.sharing.ensureManaged();
                if (token.generation !== generation || token.identity !== identity || token.diagramId !== documentId()) return;
                if (!managed || managed.ok === false) { notice = managed?.reason || 'Sharing preparation was cancelled. Retry when ready, or skip community sharing for now.'; schedule(); return; }
            }
            root.TrellisGardenHome.showProjects(ui, { highlight: highlightName, diagramId: documentId() });
        }
        function invoke(actionName) { // NEW
            const action = ui.actions?.get(actionName);
            if (!action || action.isEnabled && !action.isEnabled()) { notice = 'This command is unavailable. Check your project access and finish any open workflow, then retry.'; return; }
            return action.funct();
        }
        function currentSurface() { // NEW
            const candidates = [...document.querySelectorAll('[data-quickstart-surface]')].filter(visible);
            const garden = progress().gardenId;
            return candidates.reverse()[0] || null; // NEW: mismatched workflows receive an explicit context action rather than a hidden guide.
        }
        /** Return an explicit prerequisite rather than waiting for an absent contextual toolbar. */ // NEW
        function prerequisite(key) {
            const garden = currentGarden(), list = gardens();
            if (!garden) return { text: list.length ? 'Choose the garden you want to use in the Garden selector above.' : 'Create a garden first. Use the highlighted Create Garden control, or open Garden Projects to create a project.', node: target('create-garden'), action: () => openProjects('create-project'), label: 'Open Garden Projects' };
            if (selected() !== garden && ['settings', 'layout', 'irrigation'].includes(key)) return { text: 'Select ' + (attr(garden, 'garden_name') || attr(garden, 'label') || 'your garden') + ' to show its layout controls.', cell: garden, action: () => { graph.__trellisModules?.clusters?.revealCell(garden); graph.scrollCellToVisible?.(garden); }, label: 'Show garden' };
            if (key !== 'settings' && !settingsReady(garden)) return { text: 'Finish Garden Settings first, then return to this step.', node: target('settings'), action: () => selectStage('settings'), label: 'Guide Garden Settings' };
            if (graph.isCellCollapsed?.(garden) || garden.isCollapsed?.()) return { text: 'Expand this garden module to reveal its layout and controls, then select it again.', cell: garden, action: () => graph.foldCells?.(false, false, [garden]), label: 'Expand garden' }; // NEW
            const mode = root.Trellis?.interactionModes?.getActive?.();
            if (mode && (key === 'layout' || key === 'settings')) return { text: 'Close ' + mode.mode + ' mode to show the garden layout controls.', node: target('mode-close'), action: () => root.Trellis.interactionModes.closeActive('quickstart'), label: 'Close active mode' };
            if (graph.isEnabled && !graph.isEnabled()) return { text: 'This diagram is read only. Ask its owner for editing access, or switch to the invitee orientation.', action: () => { preferences.journey = 'invitee'; bindGarden(); persist(); }, label: 'Use invitee guide' };
            if (users()?.canEditCell && !users().canEditCell(garden)) return { text: 'You do not have permission to edit this garden. Use the invitee guide or ask the owner for access.', action: () => { preferences.journey = 'invitee'; bindGarden(); persist(); }, label: 'Use invitee guide' };
            return null;
        }
        const fields = { // NEW: these sequences describe existing controls, without writing their values.
            settings: [
                ['settings-source', 'Choose local defaults or a garden template, if this is a new garden.'],
                ['settings-name', 'Name this garden.'], ['settings-city', 'Choose its city so scheduling uses the right climate.'],
                ['settings-units', 'Choose the units you use.'], ['settings-width', 'Enter the garden width.'], ['settings-length', 'Enter its length.'],
                ['settings-bed-width', 'Choose the default bed width.'], ['settings-bed-length', 'Choose the default bed length.'], ['settings-save', 'Save Garden Settings. Any validation issues must be resolved before this step completes.']
            ],
            plan: [
                ['plan-year', 'Confirm the planning year. Keep it aligned with the year in this guide.'], ['plan-add-crops', 'Add one crop using Add/Remove crops. Choose an available crop, then Apply changes.'],
                ['plan-variety', 'Choose a variety, or keep the base plant.'], ['plan-method', 'Choose its planting method.'], ['plan-harvest-source', 'Choose a harvest window source. With manual dates, enter a feasible start and end.'],
                ['plan-harvest-start', 'Set the harvest start if using manual dates.'], ['plan-harvest-end', 'Set the harvest end if using manual dates.'],
                ['plan-demand', 'Open the demand section for your chosen self-use or sales route.'], ['plan-demand-add', 'Add one demand line for the crop.'],
                ['plan-demand-crop', 'Choose your crop for this demand line.'], ['plan-demand-qty', 'Enter a small positive quantity.'], ['plan-demand-unit', 'Choose the quantity unit.'],
                ['plan-demand-frequency', 'Choose how often you need this quantity.'], ['plan-demand-from', 'Choose the first demand date.'], ['plan-demand-to', 'Choose the last demand date.'],
                ['plan-review', 'Review Plan Check. Resolve blocking issues so this plan can produce an allocation.'], ['plan-save', 'Save the plan. A saved draft does not complete this step.']
            ],
            allocation: [['allocation-week', 'Choose an actionable sow/start week.'], ['allocation-crop', 'Choose the crop to allocate.'], ['allocation-bed', 'Select a bed in the garden, or use Find best bed.'], ['allocation-defaults', 'Resolve any missing required defaults using these links.'], ['allocation-preview', 'Inspect the proposed planting and any warnings.'], ['allocation-create', 'Choose Create planting when the existing validation enables it.']],
            irrigation: [['irrigation-source', 'Create or select one water source.'], ['irrigation-bed', 'Select a garden bed and configure its irrigation assembly.'], ['irrigation-connect', 'Select compatible source and bed ports to connect them using the existing connection controls.'], ['irrigation-analysis', 'Open analysis to inspect the connection. This example does not validate the entire garden irrigation design.']]
        };
        /** Prefer workflow-owned semantic targets, then the Year Planner's existing field identities. */ // NEW
        function fieldTarget(name, container) {
            const direct = target(name, container);
            if (direct) return name === 'plan-demand-self' || name === 'plan-demand-sales' ? direct.querySelector('.yp-strip-header') || direct : direct;
            const basics = { 'plan-variety': 'varietyId', 'plan-method': 'method', 'plan-harvest-source': 'harvestWindowSource', 'plan-harvest-start': 'harvestStart', 'plan-harvest-end': 'harvestEnd', 'plan-sales-name': 'label', 'plan-sales-type': 'type' };
            let selector = basics[name] ? '[data-year-plan-field="' + basics[name] + '"]' : '';
            const match = /^plan-demand-(crop|qty|unit|frequency|from|to)-(self|sales)$/.exec(name);
            if (match) selector = '[data-year-plan-field="' + (match[1] === 'crop' ? 'cropId' : match[1]) + '"][' + (match[2] === 'self' ? 'data-year-plan-self-line-id' : 'data-year-plan-demand-line-id') + ']';
            return selector ? [...container.querySelectorAll(selector)].find(visible) : null;
        }

        function fieldInstruction(key, container) { // NEW
            let steps = fields[key] || [];
            if (key === 'settings' && !container.querySelector('[' + TARGET + '="settings-source"]')) steps = steps.slice(1);
            if (key === 'plan' && progress().demand === 'sales') { const at = steps.findIndex(step => step[0] === 'plan-demand-add'); steps = [...steps.slice(0, at), ['plan-sales-channel', 'Add a sales channel if none exists, then expand its details.'], ['plan-sales-name', 'Name the sales channel.'], ['plan-sales-type', 'Choose its channel type.'], ...steps.slice(at)]; } // NEW
            const index = Math.min(progress().positions[key] || 0, steps.length - 1), step = steps[index];
            if (!step) return null;
            let node = fieldTarget(step[0], container), cell = null;
            if (key === 'plan' && step[0].startsWith('plan-demand')) node = fieldTarget(step[0] + '-' + (progress().demand || 'self'), container);
            let prerequisiteText = '';
            if (key === 'plan' && !node && step[0].startsWith('plan-demand')) { // NEW
                const area = target('plan-demand-' + (progress().demand || 'self'), container);
                node = area && [...area.querySelectorAll('button[aria-expanded="false"]')].find(visible) || fieldTarget('plan-demand-' + (progress().demand || 'self'), container);
                prerequisiteText = ' First expand the highlighted demand section, channel, or line. Use Manage packages to add the crop’s demand line if needed.';
            } else if (key === 'plan' && !node && ['plan-variety', 'plan-method', 'plan-harvest-source', 'plan-harvest-start', 'plan-harvest-end'].includes(step[0])) {
                node = target('plan-basics', container) || target('plan-add-crops', container);
                prerequisiteText = ' First add a crop and Apply changes, then select its Basics tab.';
            } // NEW
            if (key === 'irrigation' && !node) { // NEW: canvas selections are first-class targets.
                const cells = descendants(model(), currentGarden());
                if (step[0] === 'irrigation-bed') cell = cells.find(isBed);
                if (step[0] === 'irrigation-source') cell = cells.find(item => attr(item, 'irrigation_assembly_type') === 'source' || attr(item, 'irrigation_endpoint_type') === 'source');
                if (step[0] === 'irrigation-connect') node = [...document.querySelectorAll('.trellis-irrigation-inline-connection-action,.trellis-irrigation-port-badge')].find(visible);
            }
            const suffix = !node && !cell ? ' The control is not visible yet. Complete the previous action or expand the relevant section, then use Retry.' : node?.disabled ? ' This control is disabled. Resolve the workflow’s displayed prerequisites, then retry; the guide will not bypass them.' : '';
            return { text: step[1] + prerequisiteText + suffix, node, cell, index, total: steps.length, sequence: true };
        }
        function instruction() { // NEW
            const key = stage()[0], container = currentSurface(), kind = container?.dataset.quickstartSurface;
            if (container && (container.dataset.quickstartGarden && container.dataset.quickstartGarden !== progress().gardenId || container.dataset.quickstartYear && container.dataset.quickstartYear !== String(progress().year))) return { text: 'This workflow is for another garden or year. Close it to continue here, or explicitly use its context.', action: () => switchBinding(container.dataset.quickstartGarden || progress().gardenId, container.dataset.quickstartYear || progress().year), label: 'Use this workflow’s garden and year' }; // NEW
            if (container && fields[kind] && kind !== key) return { text: 'You opened ' + kind + '. Finish or close it before continuing this step, or switch to its guidance.', action: () => selectStage(kind), label: 'Guide this workflow' }; // NEW
            if (container && (kind === key || key === 'plan' && ['crop-picker', 'package-picker'].includes(kind))) {
                if (kind === 'package-picker') return { text: 'Choose one available crop package using its Add control, then Apply changes to return to the demand fields.', node: target('plan-package-apply', container) }; // NEW
                if (kind === 'crop-picker') return { text: 'Select the crop you want to grow, then Apply changes to return to the year plan.', node: target('plan-crop-apply', container) };
                return fieldInstruction(key, container);
            }
            if (container && kind === 'projects' && container.dataset.quickstartIntent === 'create-project') return { text: 'Create a private garden project using the highlighted control. Give it a name and submit; the existing project workflow will open its starter garden.', node: target('create-project', container) }; // NEW
            if (container && kind === 'projects' && preferences.journey === 'invitee') return { text: 'Open the invited project from Shared garden projects, or finish the access request if approval is pending. Then return to its diagram for orientation.' }; // NEW
            if (container && kind === 'projects') return { community: true, text: 'Choose Add garden in an existing community or Create Garden Community. Select this project in the form and submit. Approval may remain pending.', node: target('community-sharing', container) };
            if (preferences.journey === 'invitee') {
                const texts = { access: 'Join Shared Canvas using your invitation, finish its approval/access steps, and open the project. If it is already open with access, this step is complete.', orientation: currentGarden() ? 'Select your garden module to reveal its layout controls and locate its beds.' : 'A garden module has not been created yet. The owner can add one later; choose Next to continue.', 'view-plan': savedPlan(currentGarden()) ? 'Use Plan Year or the garden dashboard to inspect the existing year plan. You do not need to edit it.' : 'A year plan has not been created yet. Its owner can add one later. Choose Next to continue.', 'view-plantings': completions().allocation ? 'Locate the allocated plantings inside the garden beds. You do not need to edit them.' : 'No allocated plantings are present for this year yet. Choose Next to finish the orientation.' };
                return { text: texts[key], cell: key === 'orientation' ? currentGarden() : null, node: key === 'view-plan' ? target('plan') : null, action: key === 'access' ? () => invoke('trellisJoinSharedCanvas') : null, label: 'Join Shared Canvas', orientation: key !== 'access' };
            }
            if (ui.dialog && !container) return { text: 'Finish or close the open dialog, then choose Retry to reveal this step’s controls.' }; // NEW
            const pre = prerequisite(key); if (pre) return pre;
            const entries = { settings: ['settings', 'Open Garden Settings to configure this garden.'], layout: ['add-bed', 'Choose Add Garden Bed. The bed uses your saved default dimensions; position it inside the garden.'], irrigation: ['irrigation', 'Open Irrigation to connect one bed. You may skip irrigation for now.'], plan: ['plan', 'Open Plan Year to create a small ' + (progress().demand === 'sales' ? 'sales' : 'self-use') + ' plan.'], allocation: ['allocation', 'Open Allocate after saving the year plan, then create one planting.'], people: ['share', 'Choose Share to invite a user, or Canvas Sync to add another computer. Finish preparing an invitation; approval can happen later.'], community: ['projects', 'Open Garden Projects, then choose an existing community or create one with this project.'] };
            const entry = entries[key], node = target(entry[0]);
            if (key === 'allocation' && !completions().plan) return { text: 'Save a year plan with positive demand before allocating. Finish the planning step first.', action: () => selectStage('plan'), label: 'Guide year planning', node: target('plan') };
            return { text: entry[1] + (!node && key !== 'community' ? ' If the control is hidden, select the garden module again. Close another open dialog or mode, then retry.' : node?.disabled ? ' This control is disabled. Check its tooltip and finish the displayed prerequisites.' : ''), node, action: key === 'community' ? () => openProjects('community-sharing') : key === 'people' ? () => invoke('trellisCanvasSync') : null, label: key === 'community' ? 'Open Garden Projects' : 'Add another device' };
        }
        /** Idempotent rendering is important: mutation observers must not create a render loop. */ // NEW
        function render() {
            scheduled = null; if (!active && !offering) return;
            if (userKey() !== identity) { resetIdentity(); return; }
            if (offering && (ui.dialog || currentSurface())) return; // NEW: never interrupt startup or an existing modal.
            bindGarden(); ensureCard();
            const container = currentSurface();
            const modal = ui.dialog?.container;
            moveCard(container || (modal && visible(modal) ? modal : document.body)); // NEW
            if (surface && !surface.isConnected) { surface = null; document.body.appendChild(card); }
            const focus = document.activeElement, focusKey = card.contains(focus) && focus.dataset.quickstartFocus;
            body.replaceChildren(); body.hidden = !!preferences.collapsed;
            if (offering) {
                element('p', 'Build your first garden plan, or find your way around a shared project.', body);
                button('Start / Resume', () => { offering = false; active = true; preferences.collapsed = false; observe(); persist(); });
                button('Do not show again', () => { preferences.suppressed = true; if (persist()) close(); });
                if (storageWarning) element('p', storageWarning, body).setAttribute('role', 'status'); // NEW
                return;
            }
            const p = progress(), garden = currentGarden(), values = completions();
            element('div', (file()?.getTitle?.() || 'Current project') + ' · ' + (attr(garden, 'garden_name') || attr(garden, 'label') || (garden ? 'Unnamed garden' : 'Choose a garden')) + ' · ' + p.year, body);
            if (!container && !ui.dialog) { // NEW: dialogs show a compact field guide, retaining the full checklist on the diagram.
                choose('Journey', [['creator', 'Create a garden'], ['invitee', 'Join a project']], preferences.journey || 'creator', value => { preferences.journey = value; generation++; bindGarden(); });
                choose('Garden', [['', 'Choose a garden'], ...gardens().map((g, index) => [id(g), attr(g, 'garden_name') || attr(g, 'label') || 'Garden ' + (index + 1)])], p.gardenId, value => switchBinding(value, p.year));
                choose('Year', Array.from({ length: 11 }, (_, n) => [String(Number(p.year) - 5 + n), String(Number(p.year) - 5 + n)]), p.year, value => switchBinding(p.gardenId, value));
                const list = element('ol', null, body);
                for (const [key, label, optional] of stages()) {
                    const row = element('li', null, list), done = values[key], skipped = optional && p.skipped[key];
                    const control = button((done ? '✓ ' : skipped ? 'Skipped · ' : '') + label + (optional ? ' (optional)' : ''), () => selectStage(key), row);
                    control.setAttribute('aria-current', String(stage()[0] === key)); control.dataset.quickstartFocus = key;
                }
            } // NEW
            if (stage()[0] === 'plan') choose('Planning for', [['self', 'Self-use'], ['sales', 'Sales']], p.demand || 'self', value => { p.demand = value; p.positions.plan = 0; });
            const detail = instruction() || { text: 'Reopen the current workflow, then choose Retry to continue.' };
            prompt = element('p', detail.text, body); prompt.setAttribute('role', 'status'); prompt.setAttribute('aria-live', 'polite');
            if (notice || storageWarning) element('p', [notice, storageWarning].filter(Boolean).join(' '), body).setAttribute('role', 'status');
            highlight(detail.node, detail.cell);
            const promptKey = stage()[0] + ':' + (detail.index || 0) + ':' + detail.text;
            if (detail.node && promptKey !== lastPromptKey) { detail.node.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); lastPromptKey = promptKey; }
            if (detail.action) button(detail.label, detail.action);
            if (preferences.journey === 'invitee' && stage()[0] === 'access') button('People & Access', () => invoke('trellisUsers')); // NEW
            if (detail.community) { button('Existing community', () => root.TrellisGardenHome.showProjects(ui, { highlight: 'community-sharing', diagramId: documentId(), communityPath: 'existing' })); button('Create a community', () => root.TrellisGardenHome.showProjects(ui, { highlight: 'community-sharing', diagramId: documentId(), communityPath: 'create' })); } // NEW
            if (detail.sequence) {
                element('div', 'Field ' + (detail.index + 1) + ' of ' + detail.total, body);
                button('Back', () => advanceField(-1)).disabled = detail.index === 0;
                button('Next', () => advanceField(1)).disabled = detail.index === detail.total - 1;
            } else if (detail.orientation) button('Next', () => { p.viewed[stage()[0]] = true; const index = stages().findIndex(item => item[0] === stage()[0]); if (index + 1 < stages().length) p.stage = stages()[index + 1][0]; persist(); });
            button('Retry / Show next action', () => { lastPromptKey = ''; });
            if (stage()[2]) button(p.skipped[stage()[0]] ? 'Resume this step' : 'Skip for now', () => { p.skipped[stage()[0]] = !p.skipped[stage()[0]]; persist(); });
            if (values[stage()[0]] || p.skipped[stage()[0]]) {
                element('p', values[stage()[0]] ? 'This milestone is complete. You can revisit its guidance.' : 'Skipped for now. You can return to it later.', body);
                button('Continue', () => { const next = stages().find(([key, , optional]) => !values[key] && !(optional && p.skipped[key])); if (next) selectStage(next[0]); });
            }
            button('Finish', () => { if (!completeAll(values)) return; preferences.completed = true; if (persist()) close(); }).disabled = !completeAll(values);
            if (focusKey) [...card.querySelectorAll('[data-quickstart-focus]')].find(node => node.dataset.quickstartFocus === focusKey)?.focus({ preventScroll: true });
            clampCard(); avoidTarget(detail.node); // NEW
        }
        function schedule() { if ((active || offering) && scheduled == null) scheduled = root.setTimeout(render, 30); } // NEW
        /** Observe active guidance only; ignore our own DOM and highlight class mutations. */ // NEW
        function observe() {
            observer?.disconnect();
            observer = new MutationObserver(records => { if (records.some(event => !card?.contains(event.target) && event.target !== card && (event.type === 'attributes' || ![...event.addedNodes, ...event.removedNodes].every(node => node === card)))) schedule(); }); // NEW
            observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'hidden', 'disabled', 'open', TARGET] });
        }
        function close() { active = false; offering = false; observer?.disconnect(); observer = null; clearHighlight(); root.clearTimeout(scheduled); scheduled = null; card?.remove(); card = null; surface = null; } // NEW
        function show() { close(); preferences.collapsed = false; active = true; bindGarden(); observe(); render(); } // NEW
        function resetIdentity() { close(); generation++; identity = userKey(); preferences = readPreferences(); contextKey = ''; notice = ''; } // NEW
        function watchModel() { // NEW: files can replace the mxGraph model.
            if (observedModel === model()) return;
            observedModel?.removeListener?.(contextChanged); observedModel = model(); observedModel.addListener?.('change', contextChanged);
        }
        function opened() { // NEW
            close(); generation++; watchModel(); identity = userKey(); preferences = readPreferences(); bindGarden();
            contextKey = documentId() + ':' + pageId();
            if (file() && !preferences.suppressed && !preferences.completed) { offering = true; observe(); schedule(); }
        }
        function contextChanged() { // NEW
            const next = documentId() + ':' + pageId();
            if (contextKey && next !== contextKey) { close(); generation++; contextKey = next; }
            schedule();
        }

        const style = element('style'); style.textContent = '.trellis-quickstart-card{box-sizing:border-box;z-index:2000000010;max-width:calc(100vw - 16px);max-height:calc(100vh - 24px);overflow:auto;padding:10px;border:1px solid #94a3b8;border-radius:8px;background:var(--ge-dialog-bg-color,#fff);color:var(--ge-dialog-color,#172033);box-shadow:0 4px 18px #0003;font:12px/1.45 Arial,sans-serif}.trellis-quickstart-card header{display:flex;align-items:center;gap:4px}.trellis-quickstart-card header strong{flex:1;cursor:move;touch-action:none}.trellis-quickstart-card label{display:block;margin:5px 0}.trellis-quickstart-card select{max-width:100%}.trellis-quickstart-card ol{padding-left:20px}.trellis-quickstart-card li .geBtn{border:0;text-align:left;white-space:normal;margin:1px;padding:3px}.trellis-quickstart-card [aria-current=true]{font-weight:bold;text-decoration:underline}.trellis-quickstart-target{outline:3px solid #2563eb!important;outline-offset:3px;scroll-margin:12px}'; document.head.appendChild(style); // NEW
        const api = { show, close, capture, record, refresh: schedule, getState: () => ({ active, offering, identity, preferences, progress: progress(), completion: completions() }) }; // NEW
        graph.__trellisQuickstart = api; root.Trellis = root.Trellis || {}; root.Trellis.quickstart = api;
        ui.actions.addAction('trellisQuickstart', show).label = 'Quickstart';
        const help = ui.menus?.get('help') || ui.menus?.get('extras');
        if (help) { const original = help.funct; help.funct = function (menu, parent) { original.apply(this, arguments); ui.menus.addMenuItems(menu, ['-', 'trellisQuickstart'], parent); }; }
        graph.getSelectionModel?.().addListener('change', schedule);
        watchModel(); graph.view?.addListener('scaleAndTranslate', schedule);
        ui.editor.addListener?.('fileLoaded', opened); ui.addListener?.('pageSelected', contextChanged);
        for (const event of ['trellisUsersSessionChanged', 'trellisUsersStoreChanged']) root.addEventListener(event, () => { if (identity !== userKey()) resetIdentity(); else schedule(); });
        root.trellisIdentity?.onStatus(value => { portableIdentity = value.session?.identityId || null; if (identity !== userKey()) resetIdentity(); }); // NEW
        for (const event of ['yearFilterChanged', 'trellisIrrigationModeChanged', 'trellisSharingStatusChanged']) root.addEventListener(event, schedule);
        root.addEventListener('resize', () => { clampCard(); schedule(); });
        root.addEventListener('beforeunload', close);
        identity = userKey(); preferences = readPreferences(); if (file()) opened();
        root.trellisIdentity?.getSession?.().then(session => { portableIdentity = session?.identityId || null; if (identity !== userKey()) opened(); }).catch(() => {}); // NEW
    });
})(window);
