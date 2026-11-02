/** Authenticated garden inventory access through the existing collaboration facade. */ // NEW
import crypto from 'node:crypto'; // NEW
import path from 'node:path'; // NEW
import { projectReference } from './trellis-reference-snapshots.js'; // NEW
import { referenceCore } from './trellis-reference-database.js'; // NEW
import '../../drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Seeds_Core.js'; // NEW
import { hasCanvasAccess, inspectDiagram } from './trellis-share-protocol.js'; // NEW
import { readBounded, LIMITS } from './trellis-input-policy.js'; // NEW
import { permissionSnapshot, permissions } from './trellis-permission-policy.js'; // NEW
const seeds = globalThis.TrellisSeedsCore; // NEW
export function createInventoryService({ identities, library }) { // NEW
    let queue = Promise.resolve(); // NEW
    async function session() { await identities.requireSession(); const value = identities.session(); if (!value) throw new Error('Log in to manage inventories.'); return { ...value }; } // NEW
    function assertSession(login) { const current = identities.session(); if (current?.identityId !== login.identityId || current.generation !== login.generation) throw new Error('Your identity changed. Reopen Inventories.'); } // NEW
    async function access(ref, operation) { // NEW
        const login = await session(); // NEW
        if (!ref || typeof ref.diagramId !== 'string' || typeof ref.gardenId !== 'string' || typeof (ref.pageId || '') !== 'string') throw new Error('Choose a garden.'); // NEW
        const located = await library.communitySource(login.identityId, ref.diagramId); // NEW
        if (!located) throw new Error('The garden project is not in your library.'); // NEW
        const canvases = await located.daemon.listCanvases(), canvas = canvases.find(row => row.shareId === located.entry.shareId && row.available); // NEW
        if (!canvas) throw new Error('Download this garden before editing its inventory.'); // NEW
        const caller = 'inventory:' + crypto.randomUUID(); // NEW
        located.daemon.setContext(caller, { diagramPath: canvas.path, diagramId: ref.diagramId, userId: located.entry.workerId }); // NEW
        try { // NEW
            const accepted = await located.daemon.collaborationAction(caller, { shareId: canvas.shareId, kind: 'get' }); // NEW
            if (typeof accepted.xml !== 'string') throw new Error('The accepted garden state is unavailable.'); // NEW
            const state = inspectDiagram(accepted.xml), page = state.document.pages.find(page => (page.container?.getAttribute('id') || '') === (ref.pageId || '')); // NEW
            const matches = state.cells.filter(cell => cell.node.ownerDocument === page?.doc && cell.id === ref.gardenId && (cell.node.getAttribute('garden_module') === '1' || cell.node.getAttribute('trellis_garden_module') === '1')); // NEW
            if (matches.length !== 1) throw new Error('The garden is missing or ambiguous.'); // NEW
            const user = state.store.users?.find(row => row.id === located.entry.workerId && row.portableIdentityId === login.identityId && !row.disabled); // NEW
            if (!user) throw new Error('Active garden membership is required.'); // NEW
            const snapshot = permissionSnapshot(state), key = JSON.stringify([ref.pageId || '', ref.gardenId]); // NEW
            const can = action => permissions.authorize(snapshot, user.id, action, key, Date.now()).allowed; // NEW
            if (!hasCanvasAccess(state, user.id)) throw new Error('Garden access denied.'); // NEW
            const context = { login, user, state, cell: matches[0], can, ref, accepted, canvas, daemon: located.daemon, caller }; // NEW
            const referenceRaw = matches[0].node.getAttribute(referenceCore.ATTR); context.references = referenceRaw ? await projectReference(referenceRaw, path.dirname(canvas.path)) : null; // CHANGE: read-only inventory consumers receive the same verified definitions as the editor.
            assertSession(login); // NEW
            const result = await operation(context); // NEW
            assertSession(login); // NEW // NEW
            return result; // NEW
        } finally { located.daemon.forgetContext(caller); } // NEW
    } // NEW
    const parse = (cell, name, fallback) => JSON.parse(cell.node.getAttribute(name) || JSON.stringify(fallback)); // NEW
    const catalogPayload = value => Array.isArray(value) ? { version: 1, items: value } : value; // NEW
    function seedState(context) { return seeds.normalize(parse(context.cell, seeds.ATTR, null)); } // NEW
    async function list() { // NEW
        const login = await session(), projects = await library.list(), gardens = [], errors = [...(projects.errors || [])]; // NEW
        for (const entry of projects.gardens.filter(row => row.available && row.path)) { // NEW
            try { // NEW
                const state = inspectDiagram(await readBounded(entry.path, LIMITS.diagram)), user = state.store.users?.find(row => row.id === entry.workerId && row.portableIdentityId === login.identityId && !row.disabled); // NEW
                if (!user || !hasCanvasAccess(state, user.id)) continue; // NEW
                for (const cell of state.cells.filter(cell => cell.node.getAttribute('garden_module') === '1' || cell.node.getAttribute('trellis_garden_module') === '1')) { // NEW
                    const pageId = state.document.pages.find(page => page.doc === cell.node.ownerDocument)?.container?.getAttribute('id') || ''; // NEW
                    gardens.push({ diagramId: entry.diagramId, pageId, gardenId: cell.id, name: entry.name + ' / ' + (cell.node.getAttribute('garden_name') || cell.node.getAttribute('label') || cell.id) }); // NEW
                } // NEW
            } catch (error) { errors.push({ diagramId: entry.diagramId, message: error.message }); } // NEW
        } // NEW
        assertSession(login); return { gardens, errors }; // NEW
    } // NEW
    async function read(input) { // NEW
        return access(input.garden, async context => { // NEW
            const inventory = seedState(context), plans = parse(context.cell, 'plan_year_json', {}); // CHANGE
            const protection = seeds.planningStatus(inventory, plans, context.references); // CHANGE
            return { garden: input.garden, seeds: inventory, ...protection, // CHANGE: unknown plan protection never becomes freely available stock.
                equipment: context.references ? referenceCore.mergeOperational(context.references, 'equipment_inventory_json', parse(context.cell, 'equipment_inventory_json', null)) : catalogPayload(parse(context.cell, 'equipment_inventory_json', { version: 1, items: [] })), // CHANGE
                taskTypes: context.references ? referenceCore.mergeOperational(context.references, 'task_type_registry_json', null) : catalogPayload(parse(context.cell, 'task_type_registry_json', { version: 1, items: [] })), // CHANGE
                capabilities: context.references ? referenceCore.mergeOperational(context.references, 'equipment_capability_registry_json', null) : catalogPayload(parse(context.cell, 'equipment_capability_registry_json', { version: 1, items: [] })), // CHANGE
                references: context.references, plans, // CHANGE
                canEdit: context.can('manageContent'), canTrade: context.can('manage_seed_exchange'), canManageCsa: context.can('manage_csa'), canPublishCsa: context.can('publish_csa') }; // NEW
        }); // NEW
    } // NEW
    function mutate(input, update) { // NEW
        const run = queue.then(() => access(input.garden, async context => { // NEW
            if (!context.can('manageContent')) throw new Error('Inventory editing access is required.'); // NEW
            const attributes = await update(context); assertSession(context.login); // NEW // NEW
            for (const [name, value] of Object.entries(attributes)) context.cell.node.setAttribute(name, JSON.stringify(value)); // NEW
            const result = await context.daemon.collaborationAction(context.caller, { shareId: context.canvas.shareId, kind: 'save', baseXml: context.accepted.xml, xml: context.state.document.serialize() }); // NEW
            if (!result.ok) throw new Error(result.reason || 'Inventory changes await accepted synchronization.'); // NEW
            return { ok: true }; // NEW
        })); // NEW
        queue = run.catch(() => {}); return run; // NEW
    } // NEW
    function saveSeeds(input) { // NEW
        return mutate(input, context => { // NEW
            const current = seedState(context); // NEW
            if (!input.base || referenceCore.canonical(current) !== referenceCore.canonical(seeds.normalize(input.base))) throw new Error('The seed inventory changed. Reconcile the latest stock before saving.'); // NEW
            const items = seeds.normalize({ ...current, items: input.items }).items; seeds.validateDefinitions(items, context.references); // CHANGE
            return { [seeds.ATTR]: seeds.normalize({ ...current, items }) }; // NEW
        }); // NEW
    } // NEW
    /** Equipment definitions use the same reference acceptance check as the canvas editor. */ // NEW
    function saveEquipment(input) { // NEW
        return mutate(input, context => { // NEW
            const core = referenceCore, current = context.references, compact = core.externalReference(parse(context.cell, core.ATTR, null)); // CHANGE
            const allowed = ['equipment_inventory_json', 'task_type_registry_json', 'equipment_capability_registry_json']; // NEW
            if (!input.catalogs || Object.keys(input.catalogs).some(name => !allowed.includes(name))) throw new Error('Unsupported inventory catalog.'); // NEW
            const effective = kind => current ? core.mergeOperational(current, kind, parse(context.cell, kind, null)) : catalogPayload(parse(context.cell, kind, { version: 1, items: [] })); // CHANGE
            const base = { equipment: effective('equipment_inventory_json'), taskTypes: effective('task_type_registry_json'), capabilities: effective('equipment_capability_registry_json'), manifest: current?.current || '' }; // CHANGE
            if (!input.base || core.canonical(base) !== core.canonical(input.base)) throw new Error('Equipment or its references changed. Reconcile the latest inventory before saving.'); // NEW
            if (!current) return input.catalogs; // NEW
            const next = core.putCatalogBatch(current, input.catalogs), attributes = {}; // NEW
            const request = core.proposal(current, next, context.user.id, context.ref, context.ref, 'Equipment editor changes from Garden Projects'); // NEW
            if (request.changes.length) { // NEW
                const log = parse(context.cell, core.PROPOSALS, { version: 1, requests: [], decisions: [] }); // NEW
                log.requests.push(request); attributes[core.PROPOSALS] = log; // NEW
            } // NEW
            for (const [kind, fields] of Object.entries(core.OPERATIONAL)) { // NEW
                if (!input.catalogs[kind]) continue; // NEW
                const accepted = core.catalog(current, kind), saved = parse(context.cell, kind, { items: [] }); // NEW
                if (!accepted?.items) continue; // NEW
                for (const item of accepted.items) { // NEW
                    const previous = saved.items?.find(row => row.id === item.id), incoming = input.catalogs[kind].items?.find(row => row.id === item.id); // NEW
                    for (const field of fields) if (incoming?.[field] !== undefined || previous?.[field] !== undefined) item[field] = incoming && Object.hasOwn(incoming, field) ? incoming[field] : previous?.[field]; // NEW
                } // NEW
                attributes[kind] = compact ? core.operationalOverlay(kind, accepted) : accepted; // CHANGE
            } // NEW
            return attributes; // NEW
        }); // NEW
    } // NEW
    return { list, read, saveSeeds, saveEquipment, access }; // NEW
} // NEW
