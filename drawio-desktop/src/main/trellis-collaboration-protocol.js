/** Deterministic, transport-independent object transactions and editing holds. // NEW
 * A saved proposal is durable, not globally final: delayed concurrent claims can // NEW
 * reject it. All replicas replay the same signed causal records from genesis. // NEW */
import { XMLSerializer } from '@xmldom/xmldom'; // NEW
import { validateProjectNameChange } from './trellis-project-naming.js'; // NEW
import { diagramDocument, inspectDiagram, parseXml, digest, canonical, activeAccessTeams } from './trellis-share-protocol.js'; // NEW
export const COLLABORATION_VERSION = 2; // NEW
export const HOLD_MS = 300000; // NEW
export const HANDOFF_MS = 30000; // NEW
const serialize = node => new XMLSerializer().serializeToString(node); // NEW
const objectKey = (page, id) => JSON.stringify([page, id]); // NEW
const attrs = node => Object.fromEntries(Array.from(node.attributes || []).map(a => [a.name, a.value])); // NEW
function normalized(node) { // NEW
    return node.nodeType === 1 ? { name: node.nodeName, attrs: attrs(node), children: Array.from(node.childNodes).filter(n => n.nodeType === 1 || n.nodeType === 3 && n.nodeValue.trim()).map(normalized) } : node.nodeValue; // NEW
} // NEW
/** Index all model cells, including metadata and edges, using stable page identities. */ // NEW
export function objects(xml) { // NEW
    const document = diagramDocument(xml), result = new Map(); // NEW
    for (const page of document.pages) { // NEW
        const pageId = page.container?.getAttribute('id') || ''; // NEW
        const root = page.doc.getElementsByTagName('root')[0]; // NEW
        if (!root) throw new Error('Canvas model has no root.'); // NEW
        for (const node of Array.from(root.childNodes).filter(n => n.nodeType === 1)) { // NEW
            const model = node.nodeName === 'mxCell' ? node : node.getElementsByTagName('mxCell')[0]; // NEW
            if (!model) throw new Error('Unsupported canvas root content.'); // NEW
            const id = node.getAttribute('id') || model.getAttribute('id'), key = objectKey(pageId, id); // NEW
            if (!id || result.has(key)) throw new Error('Canvas objects need unique identifiers.'); // NEW
            result.set(key, { key, pageId, id, node, model, xml: serialize(node), hash: digest(canonical(normalized(node))), parent: model.getAttribute('parent'), label: node.getAttribute('label') || node.getAttribute('value') || id }); // NEW
        } // NEW
    } // NEW
    return result; // NEW
} // NEW
/** A planting's generated circles share its lock; structural operations include dependents. */ // NEW
export function logicalKey(index, key) { // NEW
    let cell = index.get(key), planting = null; const visited = new Set(); // NEW
    while (cell && !visited.has(cell.key)) { // NEW
        visited.add(cell.key); // NEW
        if (/(?:^|;)tiler_group=1(?:;|$)/.test(cell.model.getAttribute('style')) || cell.node.getAttribute('tiler_group') === '1' || cell.node.hasAttribute('planting_id')) planting = cell.key; // NEW
        cell = index.get(objectKey(cell.pageId, cell.parent)); // NEW
    } // NEW
    return planting || key; // NEW
} // NEW
function envelope(xml) { // NEW
    const document = diagramDocument(xml); // NEW
    const localView = new Set(['dx', 'dy', 'grid', 'gridSize', 'guides', 'tooltips', 'connect', 'arrows']); // NEW
    return canonical(document.pages.map(page => ({ id: page.container?.getAttribute('id') || '', page: attrs(page.container || {}), model: Object.fromEntries(Object.entries(attrs(page.doc.documentElement)).filter(([key]) => !localView.has(key))) }))); // NEW: local viewport/preferences cannot force an unrelated project-wide edit.
} // NEW
/** Generated tasks and derived plantings also reserve their source planting. */ // NEW
export function targetsForObject(index, key) { // NEW
    const cell = index.get(key), targets = new Set([logicalKey(index, key)]); // NEW
    if (!cell) return [...targets]; // NEW
    const linked = String(cell.node.getAttribute('linkedTo') || '').split(',').map(id => id.trim()).filter(Boolean); // NEW
    const task = cell.node.getAttribute('kanban_card') === '1' || /(?:^|;)kanban_card=1(?:;|$)/.test(cell.model.getAttribute('style')); // NEW
    const sourceIds = [cell.node.getAttribute('derived_source_group_id'), ...(task ? linked : [])].filter(Boolean); // NEW
    for (const id of sourceIds) { const source = index.get(objectKey(cell.pageId, id)); if (source) targets.add(logicalKey(index, source.key)); } // NEW
    return [...targets]; // NEW
} // NEW
/** Structural changes reserve descendants, incident edges, and reciprocal links together. */ // NEW
function structuralDependents(index, cell) { // NEW
    if (!cell) return []; // NEW
    const dependent = new Set([cell.id]); let expanded = true; // NEW
    while (expanded) { // NEW
        expanded = false; // NEW
        for (const item of index.values()) if (item.pageId === cell.pageId && dependent.has(item.parent) && !dependent.has(item.id)) { dependent.add(item.id); expanded = true; } // NEW
    } // NEW
    return [...index.values()].filter(item => item.pageId === cell.pageId && (dependent.has(item.id) || dependent.has(item.model.getAttribute('source')) || dependent.has(item.model.getAttribute('target')) || String(item.node.getAttribute('linkedTo') || '').split(',').some(id => dependent.has(id.trim())))); // NEW
} // NEW
export function diffObjects(beforeXml, afterXml) { // NEW
    const before = objects(beforeXml), after = objects(afterXml); // NEW
    if (envelope(beforeXml) !== envelope(afterXml)) return { changes: [{ key: '*', before: digest(beforeXml), xml: afterXml }], targets: ['*', ...new Set([...before.keys(), ...after.keys()].map(k => logicalKey(after.has(k) ? after : before, k)))] }; // NEW
    const changes = [], targets = new Set(); // NEW
    for (const key of new Set([...before.keys(), ...after.keys()])) { // NEW
        const a = before.get(key), b = after.get(key); // NEW
        if (a?.hash === b?.hash) continue; // NEW
        changes.push({ key, before: a?.hash || null, xml: b?.xml || null }); // NEW
        for (const target of targetsForObject(before, a ? key : objectKey(b.pageId, b.parent))) targets.add(target); // NEW
        if (b) for (const target of targetsForObject(after, key)) if (before.has(target)) targets.add(target); // NEW: new objects inherit their existing parent's hold rather than requiring a nonexistent base identity.
        if (!a || !b || a.parent !== b.parent || serialize(a.model.getElementsByTagName('mxGeometry')[0] || a.model) !== serialize(b.model.getElementsByTagName('mxGeometry')[0] || b.model)) { // NEW
            if (a?.parent && before.get(objectKey(a.pageId, a.parent))?.model.getAttribute('vertex') === '1') targets.add(logicalKey(before, objectKey(a.pageId, a.parent))); // NEW
            if (b?.parent && after.get(objectKey(b.pageId, b.parent))?.model.getAttribute('vertex') === '1') targets.add(logicalKey(after, objectKey(b.pageId, b.parent))); // NEW
            for (const item of structuralDependents(before, a)) for (const target of targetsForObject(before, item.key)) targets.add(target); // NEW
        } // NEW
        for (const item of [a, b].filter(Boolean)) for (const endpoint of ['source', 'target']) { // NEW
            const id = item.model.getAttribute(endpoint); if (id) targets.add(logicalKey(after.has(objectKey(item.pageId, id)) ? after : before, objectKey(item.pageId, id))); // NEW
        } // NEW
        if (a?.node.getAttribute('linkedTo') !== b?.node.getAttribute('linkedTo')) for (const item of [a, b].filter(Boolean)) for (const id of String(item.node.getAttribute('linkedTo') || '').split(',').map(id => id.trim()).filter(Boolean)) { const linkedKey = objectKey(item.pageId, id); if (before.has(linkedKey)) targets.add(logicalKey(before, linkedKey)); } // NEW
    } // NEW
    return { changes, targets: [...targets].sort() }; // NEW
} // NEW
/** Authority is derived from saved Users policy, never a caller-supplied rank. */ // NEW
export function authorityFor(xml, key, userId) { // NEW
    const state = inspectDiagram(xml), user = (state.store.users || []).find(u => u.id === userId && !u.disabled); // NEW
    const pending = (state.store.invites || []).find(i => i.pendingUserId === userId && i.status === 'pending'); // NEW
    if (!user && !pending) return 0; if (user?.admin) return 4; if (key === '*') return 0; // NEW
    const index = objects(xml); let cell = index.get(key), ownerSeen = false, manager = false, editor = false, unowned = false; const visited = new Set(); // NEW
    const teamIds = activeAccessTeams(state, userId); // NEW
    while (cell && !visited.has(cell.key)) { // NEW
        visited.add(cell.key); const node = cell.node; // NEW
        const owner = node.getAttribute('trellis_owner_user_id'); // NEW
        unowned ||= !owner && (['garden_module', 'team_module', 'task_module'].some(name => node.getAttribute(name) === '1') || /(?:^|;)module=1(?:;|$)/.test(cell.model.getAttribute('style'))); // NEW: Users permits an active user to claim an unowned module.
        if (owner && !ownerSeen) { ownerSeen = true; if (owner === userId) return 3; } // NEW
        let grants = []; try { grants = JSON.parse(node.getAttribute('trellis_access_grants_json') || '[]'); } catch (_) { return 0; } // NEW
        const caps = grants.filter(g => g.userId === userId || g.subjectType === 'team' && teamIds.has(g.teamId)).flatMap(g => g.capabilities || []); // NEW
        manager ||= caps.includes('manage_scope_content'); // NEW
        editor ||= caps.some(c => ['create_plantings', 'manage_own_plantings', 'move_tasks', 'edit_task_details'].includes(c)); // NEW
        cell = index.get(objectKey(cell.pageId, cell.parent)); // NEW
    } // NEW
    const target = index.get(key); // NEW
    return manager ? 2 : editor || unowned || target && target.model.getAttribute('vertex') !== '1' && target.model.getAttribute('edge') !== '1' ? 1 : 0; // NEW
} // NEW
function canManageAccess(xml, key, userId) { // NEW
    if (authorityFor(xml, key, userId) >= 3) return true; // NEW
    const state = inspectDiagram(xml), teams = activeAccessTeams(state, userId), index = objects(xml), visited = new Set(); // NEW
    for (let cell = index.get(key); cell && !visited.has(cell.key); cell = index.get(objectKey(cell.pageId, cell.parent))) { // NEW
        visited.add(cell.key); let grants = []; try { grants = JSON.parse(cell.node.getAttribute('trellis_access_grants_json') || '[]'); } catch (_) { return false; } // NEW
        if (grants.some(g => (g.userId === userId || g.subjectType === 'team' && teams.has(g.teamId)) && g.capabilities?.includes('manage_access'))) return true; // NEW
    } // NEW
    return false; // NEW
} // NEW
/** Preserve existing invitation acceptance and scope-owner invitations without opening roster edits. */ // NEW
export function rosterChangeAllowed(before, after, actor, xml, at) { // NEW
    if (before.users?.some(u => u.id === actor && u.admin && !u.disabled)) return true; // NEW
    const accountFields = new Set(['users', 'pendingUsers', 'invites', 'accessRequests', 'accessMessages']); // NEW
    if (canonical(Object.fromEntries(Object.entries(before).filter(([key]) => !accountFields.has(key)))) !== canonical(Object.fromEntries(Object.entries(after).filter(([key]) => !accountFields.has(key))))) return false; // NEW: invitation acceptance cannot disable Users or alter unrelated roster policy.
    const invited = before.invites?.find(i => i.pendingUserId === actor && i.status === 'pending' && i.expiresAt > at); // NEW
    if (invited) { // NEW
        const added = after.users?.find(u => u.id === actor); // NEW
        return !!added && !added.admin && !added.disabled && added.email === invited.email && canonical(after.users.filter(u => u.id !== actor)) === canonical(before.users || []) && canonical(after.pendingUsers || []) === canonical((before.pendingUsers || []).filter(u => u.id !== actor)) && canonical((after.invites || []).filter(i => i.id !== invited.id)) === canonical((before.invites || []).filter(i => i.id !== invited.id)) && after.invites.some(i => i.id === invited.id && i.status === 'accepted' && i.pendingUserId === actor && i.codeHash === invited.codeHash); // NEW
    } // NEW
    if (canonical(before.users || []) !== canonical(after.users || []) || before.usersEnabled !== after.usersEnabled) return false; // NEW
    const index = objects(xml), beforeInvites = new Map((before.invites || []).map(i => [i.id, i])); // NEW
    const changed = (after.invites || []).filter(i => canonical(beforeInvites.get(i.id) || null) !== canonical(i)); // NEW
    if ((before.invites || []).some(i => !(after.invites || []).some(next => next.id === i.id))) return false; // NEW
    if (changed.some(i => { const old = beforeInvites.get(i.id); if (old && old.expiresAt <= at && i.status === 'expired') return false; return i.createdBy !== (old?.createdBy || actor) || !(i.scopeCellIds || []).length || [...(i.scopeCellIds || []), ...(old?.scopeCellIds || [])].some(id => ![...index.values()].some(c => c.id === id && canManageAccess(xml, c.key, actor))); })) return false; // NEW
    const allowedPending = new Set(changed.map(i => i.pendingUserId)); // NEW
    if (canonical((before.pendingUsers || []).filter(u => !allowedPending.has(u.id))) !== canonical((after.pendingUsers || []).filter(u => !allowedPending.has(u.id)))) return false; // NEW
    for (const field of ['accessRequests', 'accessMessages']) { // NEW
        const old = new Map((before[field] || []).map(i => [i.id, i])); // NEW
        for (const item of after[field] || []) { const previous = old.get(item.id); if (canonical(previous || null) !== canonical(item) && item.requesterUserId !== actor && ![...index.values()].some(c => c.id === item.scopeCellId && authorityFor(xml, c.key, actor) >= 3)) return false; } // NEW
        if ((before[field] || []).some(i => !(after[field] || []).some(next => next.id === i.id) && i.requesterUserId !== actor)) return false; // NEW
    } // NEW
    return true; // NEW
} // NEW
/** Existing Users validates its generated role/profile setup; signed devices attest that action. */ // NEW
export function invitationAcceptance(beforeXml, afterXml, actor, at) { // NEW
    const before = inspectDiagram(beforeXml).store, after = inspectDiagram(afterXml).store; // NEW
    return !!before.invites?.some(i => i.pendingUserId === actor && i.status === 'pending' && i.expiresAt > at) && !before.users?.some(u => u.id === actor) && !!after.users?.some(u => u.id === actor && !u.admin && !u.disabled) && rosterChangeAllowed(before, after, actor, beforeXml, at); // NEW
} // NEW
function claimAuthority(xml, claim, key) { // NEW
    const rank = authorityFor(xml, key, claim.userId); if (rank || !claim.usersPolicyAction || !claim.policyChanges) return rank; // NEW
    try { return invitationAcceptance(xml, applyChanges(xml, claim.policyChanges), claim.userId, claim.at) ? 1 : 0; } catch (_) { return 0; } // NEW: an accepted/revoked invite cannot keep granting bootstrap authority.
} // NEW
/** Apply one all-or-nothing proposal; base mismatches never overwrite a newer object. */ // NEW
export function applyChanges(xml, changes) { // NEW
    if (!Array.isArray(changes) || !changes.length) return xml; // NEW
    if (changes.some(c => c.key === '*')) { // NEW
        if (changes.length !== 1 || changes[0].before !== digest(xml)) throw new Error('The project structure changed.'); // NEW
        objects(changes[0].xml); return changes[0].xml; // NEW
    } // NEW
    const index = objects(xml), doc = diagramDocument(xml); // NEW
    for (const change of changes) if ((index.get(change.key)?.hash || null) !== change.before) throw new Error('The object changed while this proposal was pending.'); // NEW
    for (const change of changes) { // NEW
        const [pageId, id] = JSON.parse(change.key), page = doc.pages.find(p => (p.container?.getAttribute('id') || '') === pageId); // NEW
        if (!page) throw new Error('The proposal refers to an unavailable page.'); // NEW
        const root = page.doc.getElementsByTagName('root')[0]; // NEW
        const previous = Array.from(root.childNodes).find(n => n.nodeType === 1 && (n.getAttribute('id') || n.getElementsByTagName('mxCell')[0]?.getAttribute('id')) === id); // NEW
        if (change.xml) { // NEW
            const node = page.doc.importNode(parseXml(change.xml).documentElement, true); // NEW
            if ((node.getAttribute('id') || node.getElementsByTagName('mxCell')[0]?.getAttribute('id')) !== id) throw new Error('Proposal object identity is mismatched.'); // NEW
            if (previous) root.replaceChild(node, previous); else root.appendChild(node); // NEW
        } else if (previous) root.removeChild(previous); // NEW
    } // NEW
    const result = doc.serialize(), cells = objects(result); // NEW
    for (const cell of cells.values()) { // NEW
        if (cell.parent && !cells.has(objectKey(cell.pageId, cell.parent))) throw new Error('A proposal removes a parent that is still in use.'); // NEW
        for (const endpoint of ['source', 'target']) { const id = cell.model.getAttribute(endpoint); if (id && !cells.has(objectKey(cell.pageId, id))) throw new Error('A proposal leaves a dangling edge.'); } // NEW
    } // NEW
    inspectDiagram(result); return result; // NEW
} // NEW
const stableCompare = (a, b) => a < b ? -1 : a > b ? 1 : 0; // NEW: identifiers use code-point order, independent of each computer's locale.
export const recordOrder = (a, b) => a.clock - b.clock || stableCompare(a.deviceId, b.deviceId) || stableCompare(a.id, b.id); // NEW
const sameActor = (a, b) => a.deviceId === b.deviceId && a.sessionId === b.sessionId && a.userId === b.userId; // NEW: a peer cannot borrow another computer's session ID.
/** Missing predecessors stay pending; malformed clocks and causal cycles cannot execute. */ // NEW
export function causalRecords(records) { // NEW
    const map = new Map(records.map(r => [r.id, r])), ordered = [], pending = new Set(map.keys()); // NEW
    let progressed = true; // NEW
    while (progressed) { // NEW
        progressed = false; // NEW
        for (const record of [...pending].map(id => map.get(id)).sort(recordOrder)) { // NEW
            if (!Number.isSafeInteger(record.clock) || record.clock < 1 || !Array.isArray(record.parents)) throw new Error('Invalid collaboration record clock.'); // NEW
            if (record.parents.some(id => !map.has(id) || pending.has(id))) continue; // NEW
            if (record.parents.some(id => map.get(id).clock >= record.clock)) throw new Error('Invalid collaboration causal order.'); // NEW
            ordered.push(record); pending.delete(record.id); progressed = true; // NEW
        } // NEW
    } // NEW
    return { ordered, pending: [...pending] }; // NEW
} // NEW
/** Replay ownership and proposals; concurrent claim priority also fences earlier losing edits. */ // NEW
export function replay(genesisXml, records, time = Date.now()) { // NEW
    let eligibleEdits = new Set(records.filter(r => r.kind === 'edit').map(r => r.id)); // NEW
    const seen = new Set(); // NEW
    for (let pass = 0; pass <= eligibleEdits.size + records.length + 1; pass++) { // NEW
        const result = replayOnce(genesisXml, records, time, eligibleEdits); // NEW
        const accepted = new Set(result.accepted), fingerprint = [...accepted].sort().join(','); // NEW
        if (accepted.size === eligibleEdits.size && [...accepted].every(id => eligibleEdits.has(id))) return result; // NEW
        if (seen.has(fingerprint)) throw new Error('Collaboration policy dependencies do not settle. All proposals remain preserved for review.'); // NEW
        seen.add(fingerprint); eligibleEdits = accepted; // NEW
    } // NEW
    throw new Error('Collaboration policy replay exceeded its dependency bound.'); // NEW
} // NEW
/** Exclude rejected policy changes from claim ranks, then repeat until acceptance settles. */ // NEW
function replayOnce(genesisXml, records, time, eligibleEdits) { // NEW
    const { ordered, pending } = causalRecords(records), ancestors = new Map(), claims = new Map(), rejected = []; // NEW
    for (const r of ordered) { // NEW
        if (r.parents.length === 1 && !claims.has(r.parents[0])) ancestors.set(r.id, ancestors.get(r.parents[0]) || new Set()); // NEW: read-only ancestry can be shared across ordinary edits and heartbeats.
        else { const seen = new Set(r.parents.filter(id => claims.has(id))); for (const p of r.parents) for (const id of ancestors.get(p) || []) seen.add(id); ancestors.set(r.id, seen); } // NEW: only claims and causal branch joins require a new ancestry set.
        if (r.kind === 'claim') claims.set(r.id, r); // NEW
    } // NEW
    const lost = new Set(), claimRanks = new Map(), allowedRequests = new Set(); let contextXml = genesisXml; // NEW
    for (const r of ordered) { // NEW
        if (r.kind === 'claim') claimRanks.set(r.id, new Map((r.targets || []).map(key => [key, claimAuthority(contextXml, r, key)]))); // NEW
        if (r.kind === 'request' && r.claimIds?.some(id => claims.get(id)?.targets.some(key => authorityFor(contextXml, key, r.userId) > 0))) allowedRequests.add(r.id); // NEW: authority is checked when the request was made, preserving its deadline after later revocation.
        if (r.kind === 'edit' && eligibleEdits.has(r.id)) try { const next = applyChanges(contextXml, r.changes), setup = r.claimIds?.some(id => claims.get(id)?.usersPolicyAction) && invitationAcceptance(contextXml, next, r.userId, r.at); if ((setup || r.targets?.every(key => authorityFor(contextXml, key, r.userId) > 0)) && rosterChangeAllowed(inspectDiagram(contextXml).store, inspectDiagram(next).store, r.userId, contextXml, r.at)) contextXml = next; } catch (_) {} // NEW: derive authority only from accepted policy, never from rejected proposals or claimed ranks.
    } // NEW
    const rank = (claim, key) => claimRanks.get(claim.id)?.get(key) || 0; // NEW
    const activeUntil = new Map([...claims.values()].map(c => [c.id, c.at + HOLD_MS])), stoppedAt = new Map([...claims.values()].filter(c => c.retiredAt).map(c => [c.id, c.retiredAt])); // NEW
    for (const r of ordered) { // NEW
        if (r.kind === 'activity' || r.kind === 'edit' && eligibleEdits.has(r.id)) for (const id of r.claimIds || []) { // NEW
            const claim = claims.get(id); // NEW
            if (claim && sameActor(claim, r) && ancestors.get(r.id).has(id) && r.at < Math.min(activeUntil.get(id), stoppedAt.get(id) || Infinity)) activeUntil.set(id, Math.max(activeUntil.get(id), r.at + HOLD_MS)); // NEW: delayed stale activity cannot resurrect an abandoned hold.
        } // NEW
        if (r.kind === 'request' && allowedRequests.has(r.id)) for (const id of r.claimIds || []) stoppedAt.set(id, Math.min(stoppedAt.get(id) || Infinity, r.at + HOLD_MS)); // NEW
        if (r.kind === 'release') for (const c of claims.values()) if (sameActor(c, r) && ancestors.get(r.id).has(c.id) && (!r.targets || c.targets.some(k => r.targets.includes(k)))) stoppedAt.set(c.id, Math.min(stoppedAt.get(c.id) || Infinity, r.at)); // NEW
    } // NEW
    const endOf = claim => Math.min(activeUntil.get(claim.id), stoppedAt.get(claim.id) || Infinity); // NEW
    for (const a of claims.values()) for (const b of claims.values()) { // NEW
        if (a.id === b.id || ancestors.get(a.id).has(b.id) || ancestors.get(b.id).has(a.id) || sameActor(a, b)) continue; // NEW
        if (a.at >= endOf(b) || b.at >= endOf(a)) continue; // NEW
        for (const key of a.targets || []) if ((b.targets || []).includes(key) && (rank(b, key) > rank(a, key) || rank(b, key) === rank(a, key) && recordOrder(b, a) < 0)) lost.add(a.id); // NEW
    } // NEW
    let xml = genesisXml; const holds = new Map(), reservations = new Map(), presence = new Map(), accepted = [], deadlines = new Map(), waiters = new Map(); // NEW
    for (const r of ordered) { // NEW
        if (!Number.isFinite(r.at) || !r.sessionId || !r.userId) { rejected.push({ id: r.id, reason: 'Invalid session record.' }); continue; } // NEW
        const expire = t => { for (const [key, hold] of holds) { const deadline = Math.min(hold.activeAt + HOLD_MS, deadlines.get(hold.claimId) || Infinity, claims.get(hold.claimId)?.retiredAt || Infinity); if (t >= deadline || claimAuthority(xml, claims.get(hold.claimId), key) < 1) release(key, hold, deadline); } }; // NEW: a late record cannot restart the handoff cooldown.
        const release = (key, hold, at) => { // NEW
            holds.delete(key); const candidates = (waiters.get(hold.claimId) || []).filter(w => !w.cancelled && authorityFor(xml, key, w.userId) > 0).sort((a, b) => authorityFor(xml, key, b.userId) - authorityFor(xml, key, a.userId) || recordOrder(a, b)); // NEW
            if (candidates.length) reservations.set(key, { deviceId: candidates[0].deviceId, sessionId: candidates[0].sessionId, userId: candidates[0].userId, previousSession: hold.sessionId, until: at + HANDOFF_MS }); // NEW
        }; // NEW
        expire(r.at); // NEW
        if (r.kind === 'view') { presence.set(r.deviceId + ':' + r.sessionId, r); continue; } // NEW
        if (r.kind === 'request') { // NEW
            for (const claimId of r.claimIds || []) { // NEW
                const hold = [...holds.values()].find(h => h.claimId === claimId); if (!hold || sameActor(hold, r) || authorityFor(xml, hold.key, r.userId) < 1) continue; // NEW: imported release requests must respect the same existing access policy as local requests.
                if (!deadlines.has(claimId)) deadlines.set(claimId, r.at + HOLD_MS); // NEW
                const queue = waiters.get(claimId) || []; if (!queue.some(q => sameActor(q, r))) queue.push({ ...r }); waiters.set(claimId, queue); // NEW
            } // NEW
            continue; // NEW
        } // NEW
        if (r.kind === 'release') { // NEW
            for (const [key, hold] of [...holds]) if (sameActor(hold, r) && (!r.targets || r.targets.includes(key))) release(key, hold, r.at); // NEW
            for (const queue of waiters.values()) for (const waiter of queue) if (sameActor(waiter, r)) waiter.cancelled = true; // NEW
            presence.delete(r.deviceId + ':' + r.sessionId); continue; // NEW
        } // NEW
        if (r.kind === 'claim') { // NEW
            const keys = r.targets || []; // NEW
            if (!keys.length || lost.has(r.id) || holds.has('*') && !sameActor(holds.get('*'), r) || keys.includes('*') && [...holds.values()].some(h => !sameActor(h, r)) || keys.some(key => holds.has(key) && !sameActor(holds.get(key), r) || reservations.has(key) && reservations.get(key).until > r.at && !sameActor(reservations.get(key), r) || claimAuthority(xml, r, key) < 1)) { rejected.push({ id: r.id, reason: 'Another editing hold has priority, or access changed.' }); continue; } // NEW
            for (const key of keys) { holds.set(key, { key, claimId: r.id, deviceId: r.deviceId, sessionId: r.sessionId, userId: r.userId, activeAt: r.at }); reservations.delete(key); } // NEW
            continue; // NEW
        } // NEW
        if (r.kind === 'activity') { // NEW
            if (r.targets?.every(key => holds.has(key) && sameActor(holds.get(key), r) && r.claimIds?.includes(holds.get(key)?.claimId))) for (const key of r.targets) holds.get(key).activeAt = r.at; // NEW
            continue; // NEW
        } // NEW
        if (r.kind === 'edit') { // NEW
            try { // NEW
                const proposed = applyChanges(xml, r.changes); // NEW
                const accountSetup = r.claimIds?.some(id => claims.get(id)?.usersPolicyAction) && invitationAcceptance(xml, proposed, r.userId, r.at); // NEW
                if (!Array.isArray(r.targets) || !r.targets.length || r.targets.some(key => !holds.has(key) || !sameActor(holds.get(key), r) || !r.claimIds?.includes(holds.get(key)?.claimId) || !accountSetup && authorityFor(xml, key, r.userId) < 1)) throw new Error('The editing hold expired or another editor has priority.'); // NEW
                const required = diffObjects(xml, proposed).targets; // NEW
                if (required.some(key => !r.targets.includes(key))) throw new Error('The group edit did not acquire every dependent object.'); // NEW
                validateProjectNameChange(xml, proposed, r.userId); // NEW: applies even to invitation acceptance and metadata removal.
                const before = inspectDiagram(xml), after = inspectDiagram(proposed); // NEW
                if (canonical(before.store) !== canonical(after.store) && !rosterChangeAllowed(before.store, after.store, r.userId, xml, r.at)) throw new Error('The roster change is not an authorized invitation or account action.'); // NEW
                if (!accountSetup) validateProtectedChanges(xml, proposed, r.userId); // NEW: keep the existing validated Users bootstrap for generated role bindings.
                xml = proposed; accepted.push(r.id); for (const key of r.targets) holds.get(key).activeAt = r.at; // NEW
            } catch (err) { rejected.push({ id: r.id, reason: err.message }); } // NEW
        } // NEW
    } // NEW
    for (const [key, hold] of [...holds]) if (time >= Math.min(hold.activeAt + HOLD_MS, deadlines.get(hold.claimId) || Infinity, claims.get(hold.claimId)?.retiredAt || Infinity) || claimAuthority(xml, claims.get(hold.claimId), key) < 1) { // NEW
        holds.delete(key); const deadline = Math.min(hold.activeAt + HOLD_MS, deadlines.get(hold.claimId) || Infinity, claims.get(hold.claimId)?.retiredAt || Infinity); // NEW
        const queue = (waiters.get(hold.claimId) || []).filter(w => !w.cancelled && authorityFor(xml, key, w.userId) > 0).sort((a, b) => authorityFor(xml, key, b.userId) - authorityFor(xml, key, a.userId) || recordOrder(a, b)); // NEW
        if (queue.length && time < deadline + HANDOFF_MS) reservations.set(key, { deviceId: queue[0].deviceId, sessionId: queue[0].sessionId, userId: queue[0].userId, previousSession: hold.sessionId, until: deadline + HANDOFF_MS }); // NEW
    } // NEW
    return { xml, accepted, rejected, pending, holds: [...holds.values()].map(h => ({ ...h, requested: deadlines.has(h.claimId), expiresAt: Math.min(h.activeAt + HOLD_MS, deadlines.get(h.claimId) || Infinity) })), reservations: [...reservations].filter(([, r]) => time < r.until).map(([key, r]) => ({ key, ...r })), presence: [...presence.values()].filter(p => time < p.at + HOLD_MS) }; // NEW
} // NEW
/** Preserve Users' grant-management and self-claim exceptions at the replay boundary. */ // NEW
function validateProtectedChanges(beforeXml, afterXml, userId) { // NEW
    const before = objects(beforeXml), after = objects(afterXml); // NEW
    for (const [key, old] of before) { // NEW
        const next = after.get(key); if (!next || authorityFor(beforeXml, key, userId) >= 3) continue; // NEW
        const original = attrs(old.node), updated = attrs(next.node); // NEW
        const changed = [...new Set([...Object.keys(original), ...Object.keys(updated)])].filter(name => /^trellis_(owner|access|role|team|garden_team)/.test(name) && original[name] !== updated[name]); // NEW
        if (!changed.length) continue; // NEW
        if (changed.every(name => ['trellis_access_user_ids_json', 'trellis_access_grants_json', 'trellis_access_open'].includes(name)) && canManageAccess(beforeXml, key, userId)) continue; // NEW
        const module = ['garden_module', 'team_module', 'task_module'].some(name => old.node.getAttribute(name) === '1') || /(?:^|;)module=1(?:;|$)/.test(old.model.getAttribute('style')); // NEW
        if (changed.length === 1 && changed[0] === 'trellis_owner_user_id' && module && !original.trellis_owner_user_id && updated.trellis_owner_user_id === userId) continue; // NEW
        throw new Error('Ownership and access need owner or admin review.'); // NEW
    } // NEW
} // NEW
