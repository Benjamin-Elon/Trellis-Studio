/** Garden seed balances, sowing effects and reservations. No DOM, clock, I/O or signing. */ // NEW
(function (root) { // NEW
    'use strict'; // NEW
    const VERSION = 1, ATTR = 'trellis_seeds_json'; // NEW
    const clone = value => JSON.parse(JSON.stringify(value)); // NEW
    function fail(message) { throw new Error(message); } // NEW
    function finite(value, name) { const number = Number(value); if (!Number.isFinite(number)) fail('Invalid ' + name + '.'); return number; } // NEW
    function operationId(id) { if (typeof id !== 'string' || !id || id.length > 1000 || ['__proto__', 'constructor', 'prototype'].includes(id)) fail('A stable operation identity is required.'); return id; } // NEW
    function key(item) { // NEW
        if (!item || typeof item.cropRef !== 'string' || !item.cropRef.trim() || item.varietyRef != null && typeof item.varietyRef !== 'string') fail('Choose a portable crop reference.'); // NEW
        return JSON.stringify([String(item.cropRef), String(item.varietyRef || '')]); // NEW
    } // NEW
    /** Match Year Planner's legacy Mature identity before selecting a sowing requirement. */ // NEW
    function growthStage(value) { return String(value || 'mature').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'mature'; } // NEW
    function normalize(input) { // NEW
        const value = typeof input === 'string' ? JSON.parse(input || 'null') : input; // NEW
        if (value && value.version !== VERSION) fail('Unsupported seed inventory version.'); // NEW
        const state = clone(value || { version: VERSION, items: [], usage: {}, reservations: {}, receipts: {}, initialized: false }); // NEW
        if (!Array.isArray(state.items) || state.items.length > 10000) fail('Invalid seed items.'); // NEW
        state.usage ||= {}; state.reservations ||= {}; state.receipts ||= {}; // NEW
        for (const log of [state.usage, state.reservations, state.receipts]) { if (!log || typeof log !== 'object' || Array.isArray(log)) fail('Invalid seed accounting log.'); Object.keys(log).forEach(operationId); } // NEW
        const seen = new Set(); // NEW
        state.items.forEach(item => { // NEW
            const id = key(item); if (seen.has(id)) fail('Only one balance per variety is allowed.'); seen.add(id); // NEW
            item.seeds = finite(item.seeds, 'seed balance'); // NEW
            if (!Number.isSafeInteger(item.seeds)) fail('Seed balances must be whole seed counts.'); // NEW
            item.unit ||= 'seed'; // NEW
            if (!['seed', 'g', 'packet'].includes(item.unit)) fail('Use seeds, grams or packets.'); // NEW
            item.seedsPerUnit = item.unit === 'seed' ? 1 : finite(item.seedsPerUnit, 'seeds per unit'); // NEW
            if (item.seedsPerUnit <= 0) fail('A positive seed-count conversion is required.'); // NEW
        }); // NEW
        return state; // NEW
    } // NEW
    function counts(quantity, item) { // NEW
        const converted = finite(quantity, 'quantity') * (item.unit === 'seed' ? 1 : finite(item.seedsPerUnit, 'conversion')); // NEW
        if (converted < 0 || !Number.isSafeInteger(Math.floor(converted))) fail('Enter a nonnegative, representable seed quantity.'); // NEW
        return Math.floor(converted + 1e-9); // NEW
    } // NEW
    function find(state, item) { return state.items.find(row => key(row) === key(item)) || fail('This seed variety is not in the inventory.'); } // NEW
    function held(state, item, except) { // NEW
        return Object.entries(state.reservations).filter(([id, reservation]) => id !== except && reservation.status === 'reserved') // NEW
            .reduce((sum, [, reservation]) => sum + (reservation.lines || []).filter(line => key(line) === key(item)).reduce((n, line) => n + line.seeds, 0), 0); // NEW
    } // NEW
    function availability(input, needs = {}) { // NEW
        const state = normalize(input); // NEW
        return state.items.map(item => { // NEW
            const planned = Math.max(0, Number(needs[key(item)]) || 0), reserved = held(state, item); // NEW
            return { ...item, planned, reserved, available: Math.max(0, item.seeds - planned - reserved), shortage: Math.max(0, planned + reserved - item.seeds) }; // NEW
        }); // NEW
    } // NEW
    /** Read-only projections retain current stock when a legacy plan cannot yet be mapped. */ // NEW
    function planningStatus(input, plans, references) { // NEW
        const state = normalize(input); // NEW
        try { // NEW
            const needs = requirements(plans, state, references); // NEW
            return { protectionKnown: true, availability: availability(state, needs), warnings: auditUsage(plans, state, references).map(row => row.reason) }; // NEW
        } catch (error) { // NEW
            return { protectionKnown: false, availability: availability(state).map(row => ({ ...row, planned: null, available: null, shortage: null })), warnings: ['Published-plan protection is unavailable: ' + error.message] }; // NEW
        } // NEW
    } // NEW
    /** Existing completed work is a baseline, not a second deduction from today's stock. */ // NEW
    function initialize(input, sowings = []) { // NEW
        const state = normalize(input); if (state.initialized) return state; // NEW
        for (const sowing of sowings.filter(row => row.completed)) state.usage[sowing.id] = { ...clone(sowing), active: true, seeds: Math.ceil(Math.max(0, finite(sowing.seeds, 'seed usage'))), baseline: true }; // NEW
        state.initialized = true; return state; // NEW
    } // NEW
    /** Repeated completion/reopen delivery converges to the stored revision, never another subtraction. */ // NEW
    function usage(input, operation) { // NEW
        const state = normalize(input); // NEW
        if (!operation.id || !Number.isSafeInteger(operation.revision) || operation.revision < 1) fail('A stable sowing identity and revision are required.'); // NEW
        operationId(operation.id); // NEW
        const quantity = Math.ceil(Math.max(0, finite(operation.seeds, 'seed usage'))); // NEW
        const prior = state.usage[operation.id]; // NEW
        if (prior && Number(prior.revision || 0) >= operation.revision) { // NEW
            if (prior.revision === operation.revision && (prior.active !== !!operation.completed || prior.seeds !== quantity)) fail('Conflicting seed-usage revision.'); // NEW
            return state; // NEW
        } // NEW
        if (prior?.active) find(state, prior).seeds += prior.seeds; // NEW
        if (operation.completed) find(state, operation).seeds -= quantity; // NEW
        state.usage[operation.id] = { ...clone(operation), seeds: quantity, active: !!operation.completed }; // NEW
        return state; // NEW
    } // NEW
    /** Protect all accepted published plan requirements, without counting completed sowings twice. */ // NEW
    /** Definitions refer to accepted portable entities, including their crop/variety relationship. */ // NEW
    function validateDefinitions(items, references) { // NEW
        if (references?.version === 2) references = root.TrellisReferenceCore.resolveReference(references); // CHANGE
        const heads = references?.manifests?.[references.current]?.heads || {}; // NEW
        for (const item of items) { // NEW
            if (!heads[item.cropRef] || references.bindings[item.cropRef]?.table !== 'Plants') fail('Map the crop to an accepted garden reference first.'); // NEW
            if (item.varietyRef) { // NEW
                const revision = references.revisions[heads[item.varietyRef]], binding = references.bindings[item.varietyRef]; // NEW
                if (!revision || binding?.table !== 'PlantVarieties' || revision.data.plant_id?.$ref !== item.cropRef) fail('Map the variety to its accepted crop reference first.'); // NEW
            } // NEW
        } // NEW
        return items; // NEW
    } // NEW
    function portable(crop, references) { // NEW
        if (crop.cropRef) return { cropRef: crop.cropRef, varietyRef: crop.varietyRef || '' }; // NEW
        if (references?.version === 2) references = root.TrellisReferenceCore.resolveReference(references); // CHANGE
        const bindings = Object.entries(references?.bindings || {}), heads = references?.manifests?.[references.current]?.heads || {}; // NEW
        const resolve = (table, column, id) => bindings.find(([entity, binding]) => heads[entity] && binding.table === table && String(binding.key[column]) === String(id))?.[0]; // NEW
        const cropRef = resolve('Plants', 'plant_id', crop.plantId), varietyRef = crop.varietyId ? resolve('PlantVarieties', 'variety_id', crop.varietyId) : ''; // NEW
        if (!cropRef || crop.varietyId && !varietyRef) fail('A published plan crop needs an accepted portable reference.'); // NEW
        return { cropRef, varietyRef }; // NEW
    } // NEW
    function requirements(plans, input, references) { // NEW
        const state = normalize(input), result = {}, ambiguous = new Set(auditUsage(plans, state, references).map(row => row.id)); // CHANGE
        for (const plan of Object.values(plans || {})) { // NEW
            const totals = {}; // NEW
            for (const crop of plan.crops || []) { // NEW
                const reference = portable(crop, references), cropKey = key(reference); // NEW
                totals[cropKey] = (totals[cropKey] || 0) + Math.ceil(Math.max(0, Number(crop.seedsReq) || 0)); // NEW
            } // NEW
            for (const [cropKey, total] of Object.entries(totals)) { // NEW
                const used = Object.values(state.usage).filter(row => row.active && !ambiguous.has(row.id) && Number(row.year) === Number(plan.year) && key(row) === cropKey).reduce((sum, row) => sum + (row.plannedSeeds ?? row.seeds), 0); // CHANGE: uncertain legacy evidence cannot silently release protected stock.
                result[cropKey] = (result[cropKey] || 0) + Math.max(0, total - used); // NEW
            } // NEW
        } // NEW
        return result; // NEW
    } // NEW
    /** Audit protection evidence without rewriting historical actual deductions from today's plan. */ // NEW
    function auditUsage(plans, input, references) { // NEW
        const state = normalize(input), issues = []; // NEW
        for (const [id, row] of Object.entries(state.usage)) { // NEW
            if (!row.active) continue; // NEW
            const basis = row.requirementBasis; // NEW
            if (basis) { // NEW
                const valid = Number.isSafeInteger(basis.plantCount) && basis.plantCount >= 0 && Number.isFinite(basis.germRate) && basis.germRate > 0 && basis.germRate <= 1 && row.plannedSeeds === Math.ceil(basis.plantCount / basis.germRate); // NEW
                if (!valid) issues.push({ id, reason: 'The saved planned seed requirement disagrees with its completion evidence.' }); // NEW
                continue; // NEW
            } // NEW
            const plan = Object.values(plans || {}).find(plan => Number(plan.year) === Number(row.year)); // NEW
            const candidates = (plan?.crops || []).filter(crop => key(portable(crop, references)) === key(row)); // NEW
            if (new Set(candidates.map(crop => Number(crop.germRate) || 1)).size > 1) issues.push({ id, reason: 'Historical sowing protection needs reconciliation: its original growth-stage requirement was not recorded.' }); // NEW
        } // NEW
        return issues; // NEW
    } // NEW
    /** Plain page-qualified facts let the editor and accepted-save validator identify the same sowings. */ // NEW
    function sowings(cells, gardenKey) { // NEW
        const garden = cells[gardenKey], attrs = garden.attributes,  references = JSON.parse(attrs.trellis_references_json || 'null'), plans = JSON.parse(attrs.plan_year_json || '{}'), result = new Map(); // NEW
        const gardenFor = cell => { const seen = new Set(); while (cell && !seen.has(cell.key)) { if (cell.attributes.garden_module === '1' || cell.attributes.trellis_garden_module === '1') return cell.key; seen.add(cell.key); cell = cells[cell.parent]; } return null; }; // NEW
        for (const task of Object.values(cells)) { // NEW
            const values = task.attributes; if (!['direct_sowing', 'seedling_starting'].includes(values.task_type_id)) continue; // NEW
            const sources = [...new Set(String(values.linkedTo || '').split(',').map(id => id.trim()).filter(Boolean))].map(id => cells[JSON.stringify([task.pageId || '', id])]).filter(cell => cell?.attributes.plant_id && gardenFor(cell) === gardenKey); // NEW
            if (!sources.length) continue; if (sources.length !== 1) fail('A sowing task needs one unambiguous source planting.'); // NEW
            const source = sources[0], fields = source.attributes, reference = portable({ plantId: fields.plant_id, varietyId: fields.variety_id }, references); // NEW
            const year = Number(String(fields.sow_date || fields.indoor_start || values.start || '').slice(0, 4)); // NEW
            if (!Number.isInteger(year) || year < 1900 || year > 9999) fail('A sowing task needs its plan year.'); // NEW
            const stage = growthStage(fields.growth_stage_key); // NEW
            const crops = (plans[year]?.crops || []).filter(crop => String(crop.plantId) === fields.plant_id && String(crop.varietyId || '') === String(fields.variety_id || '') && growthStage(crop.growthStageKey) === stage); // CHANGE: stages share stock, but never borrow each other's germination requirement.
            const rates = [...new Set(crops.map(crop => Number(crop.germRate) || 1))], corrected = values.trellis_seed_quantity || ''; // NEW
            if (!corrected && rates.length > 1) fail('Correct the sowing quantity because this crop has differing planned germination rates.'); // NEW
            const rate = rates[0] || 1, plannedSeeds = Math.ceil(Number(fields.plant_count) / rate), quantity = corrected !== '' ? Number(corrected) : plannedSeeds; // NEW
            if (!(rate > 0 && rate <= 1) || !Number.isSafeInteger(quantity) || quantity < 0 || !Number.isSafeInteger(plannedSeeds) || plannedSeeds < 0) fail('Enter a nonnegative whole seed quantity for this sowing task.'); // NEW
            const id = JSON.stringify([source.id, values.scheduler_task_key || task.id]), row = { ...reference, id, year, growthStageKey: stage, requirementBasis: { plantCount: Number(fields.plant_count), germRate: rate, growthStageKey: stage }, seeds: quantity, plannedSeeds, correction: corrected, completed: !!values.completed || values.workflow_state === 'DONE' }; // CHANGE: retain the accepted completion's requirement evidence for later audits.
            if (result.has(id) && JSON.stringify(result.get(id)) !== JSON.stringify(row)) fail('Sowing task representations disagree. Reconcile them before saving.'); // NEW
            result.set(id, row); // NEW
        } // NEW
        return [...result.values()]; // NEW
    } // NEW
    /** Completed effects freeze their requirement until a quantity correction or a reopen is recorded. */ // NEW
    function reconcile(previous, proposed, tasks) { // NEW
        let state = normalize(previous || { ...proposed, initialized: false, usage: {}, reservations: {}, receipts: {} }); // NEW
        for (const task of tasks) if (!state.items.some(item => key(item) === key(task))) state.items.push({ cropRef: task.cropRef, varietyRef: task.varietyRef, seeds: 0, unit: 'seed', seedsPerUnit: 1 }); // NEW
        if (!previous || !previous.initialized) return initialize({ ...state, initialized: false }, tasks); // NEW
        for (const task of tasks) { // NEW
            const prior = state.usage[task.id], candidate = proposed?.usage?.[task.id]; // NEW
            const revision = Number(candidate?.revision || 0), hinted = Number.isSafeInteger(revision) && revision > Number(prior?.revision || 0); // NEW
            const evidence = prior?.active ? { growthStageKey: prior.growthStageKey, requirementBasis: prior.requirementBasis } : {}; // NEW: retain original completion evidence even if the planting or plan later changes.
            if (hinted) { state = usage(state, { ...task, ...evidence, seeds: !task.completed && prior ? prior.seeds : task.seeds, plannedSeeds: prior?.active ? prior.plannedSeeds ?? prior.seeds : task.plannedSeeds, revision }); continue; } // CHANGE
            if (!prior && !task.completed) continue; // NEW
            if (prior && prior.active === task.completed && String(prior.correction || '') === task.correction) continue; // NEW
            state = usage(state, { ...task, ...evidence, seeds: !task.completed && prior ? prior.seeds : task.seeds, plannedSeeds: prior?.active ? prior.plannedSeeds ?? prior.seeds : task.plannedSeeds, revision: Number(prior?.revision || 0) + 1 }); // CHANGE
        } // NEW
        return state; // NEW
    } // NEW
    const logs = state => ({ initialized: state.initialized, usage: state.usage, reservations: state.reservations, receipts: state.receipts }); // NEW
    /** Preserve explicit stock edits while adding only independently derived usage deltas. */ // NEW
    function prepare(previous, proposed, tasks) { // NEW
        const expected = reconcile(previous, proposed, tasks), equal = (a, b) => JSON.stringify(a) === JSON.stringify(b); // NEW
        if (!previous) { // NEW
            if (Object.keys(proposed.usage).length || Object.keys(proposed.reservations).length || Object.keys(proposed.receipts).length) { if (!equal(logs(proposed), logs(expected))) fail('A new seed inventory cannot import operational history.'); } // NEW
            return expected; // NEW
        } // NEW
        if (!equal(logs(proposed), logs(previous))) { if (!equal(logs(proposed), logs(expected))) fail('Seed usage and reservations require their validated domain operation.'); return proposed; } // NEW
        const next = { ...expected, items: clone(proposed.items) }; // NEW
        for (const item of expected.items) { // NEW
            let target = next.items.find(row => key(row) === key(item)); // NEW
            const old = previous.items.find(row => key(row) === key(item)); // NEW
            if (!target) { if (old) fail('Keep seed definitions with accounting history.'); target = { ...item, seeds: 0 }; next.items.push(target); } // NEW
            target.seeds += item.seeds - (old?.seeds || 0); // NEW
        } // NEW
        return normalize(next); // NEW
    } // NEW
    function validate(previous, proposed, tasks) { // NEW
        const expected = reconcile(previous, proposed, tasks); // NEW
        if (JSON.stringify(logs(proposed)) !== JSON.stringify(logs(expected))) fail('The sowing task and its seed accounting must commit together.'); // NEW
        return !!previous && JSON.stringify(proposed) === JSON.stringify(expected); // NEW
    } // NEW
    /** Compute native updates before authorization; the host still validates every non-seed effect. */ // NEW
    function transition(before, after) { // NEW
        const updates = [], automatic = new Set(); // NEW
        for (const cell of Object.values(after.cells)) { // NEW
            const raw = cell.attributes[ATTR], old = before.cells[cell.key]?.attributes[ATTR]; // NEW
            if (!raw && !old) continue; if (cell.attributes.garden_module !== '1' && cell.attributes.trellis_garden_module !== '1') fail('Seed inventories belong to garden modules.'); if (!raw) fail('Seed accounting history cannot be removed from an existing garden.'); // NEW
            const previous = old ? normalize(old) : null, proposed = normalize(raw), tasks = sowings(after.cells, cell.key); // NEW
            const prepared = prepare(previous, proposed, tasks); // NEW
            if (JSON.stringify(prepared) !== JSON.stringify(proposed)) updates.push({ key: cell.key, value: prepared }); // NEW
            if (validate(previous, prepared, tasks)) automatic.add(cell.key); // NEW
        } // NEW
        return { updates, automatic }; // NEW
    } // NEW
    function adjust(input, item, quantity, operationId) { // NEW
        const state = normalize(input); // NEW
        if (!operationId || ['__proto__', 'constructor', 'prototype'].includes(operationId)) fail('A stock adjustment ID is required.'); // NEW
        const receipt = { kind: 'adjustment', item: key(item), seeds: finite(quantity, 'seed adjustment') }; // NEW
        if (state.receipts[operationId]) { if (JSON.stringify(state.receipts[operationId]) !== JSON.stringify(receipt)) fail('Adjustment terms changed.'); return state; } // NEW
        find(state, item).seeds += receipt.seeds; // NEW
        state.receipts[operationId] = receipt; // NEW
        return normalize(state); // NEW
    } // NEW
    /** Called only within an authoritative accepted garden transaction. */ // NEW
    function reserve(input, id, lines, needs = {}) { // NEW
        const state = normalize(input); // NEW
        operationId(id); // NEW
        if (!Array.isArray(lines) || !lines.length) fail("A reservation identity and seed lines are required."); // NEW
        const combined = new Map(); // NEW
        for (const line of lines) { // NEW
            const item = find(state, line), quantity = finite(line.seeds, 'reservation quantity'); // NEW
            if (!Number.isSafeInteger(quantity) || quantity <= 0) fail('Reserve a positive whole seed count.'); // NEW
            const id = key(item), row = combined.get(id) || { cropRef: item.cropRef, varietyRef: item.varietyRef || '', seeds: 0 }; // NEW
            row.seeds += quantity; combined.set(id, row); // NEW
        } // NEW
        const normalized = [...combined.values()].sort((a, b) => key(a).localeCompare(key(b), 'en')); // NEW
        const existing = state.reservations[id]; // NEW
        if (existing) { if (JSON.stringify(existing.lines) !== JSON.stringify(normalized)) fail('Reservation terms changed.'); if (existing.status === 'released') fail('This reservation was cancelled.'); return state; } // NEW
        for (const line of normalized) if (find(state, line).seeds - held(state, line) - Math.max(0, Number(needs[key(line)]) || 0) < line.seeds) fail('Adjust the published plan or seed stock before accepting this trade.'); // NEW
        state.reservations[id] = { lines: normalized, status: 'reserved' }; return state; // NEW
    } // NEW
    function release(input, id) { // NEW
        const state = normalize(input), reservation = state.reservations[id]; // NEW
        if (!reservation) return state; // NEW
        if (reservation.status === 'handed-over') fail('Handover has begun; resolve this agreement instead.'); // NEW
        reservation.status = 'released'; return state; // NEW
    } // NEW
    function handover(input, id) { // NEW
        const state = normalize(input), reservation = state.reservations[id]; // NEW
        if (!reservation || reservation.status === 'released') fail('No accepted reservation.'); // NEW
        if (reservation.status === 'handed-over') return state; // NEW
        reservation.lines.forEach(line => { find(state, line).seeds -= line.seeds; }); // NEW
        reservation.status = 'handed-over'; return state; // NEW
    } // NEW
    function receive(input, receiptId, lines) { // NEW
        const state = normalize(input); // NEW
        operationId(receiptId); // NEW
        if (state.receipts[receiptId]) { if (state.receipts[receiptId].kind !== 'receipt' || JSON.stringify(state.receipts[receiptId].lines) !== JSON.stringify(lines)) fail('Receipt terms changed.'); return state; } // NEW
        for (const line of lines) { // NEW
            if (!Number.isSafeInteger(line.seeds) || line.seeds <= 0) fail('Invalid received seed quantity.'); // NEW
            find(state, line).seeds += line.seeds; // NEW
        } // NEW
        state.receipts[receiptId] = { kind: 'receipt', lines: clone(lines) }; return state; // NEW
    } // NEW
    function reset(input) { // NEW
        const state = normalize(input); // NEW
        return { version: VERSION, initialized: false, items: state.items.map(item => ({ ...item, seeds: 0 })), usage: {}, reservations: {}, receipts: {} }; // NEW
    } // NEW
    root.TrellisSeedsCore = Object.freeze({ VERSION, ATTR, key, normalize, portable, validateDefinitions, counts, availability, planningStatus, initialize, usage, requirements, auditUsage, sowings, reconcile, prepare, validate, transition, adjust, reserve, release, handover, receive, reset }); // CHANGE
})(typeof window !== 'undefined' ? window : globalThis); // NEW
