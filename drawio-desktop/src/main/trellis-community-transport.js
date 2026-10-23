/** Garden-side community integration. Only a garden coordinator commits roster/device changes. */ // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import { canonical, makeId, safeId, signRecord, verifyRecord, activeAdmin, hasCanvasAccess, activeAccessTeams } from './trellis-share-protocol.js'; // CHANGE
import { COMMUNITY_VERSION, COMMUNITY_PRESETS, verifyGardenEvidence, evidenceSigner, reduceCommunity } from './trellis-community-protocol.js'; // CHANGE
import { projectName } from './trellis-project-naming.js'; // NEW
import { cityRecord, projectSummary } from './trellis-project-summary.js'; // NEW
import '../../drawio/src/main/webapp/js/trellis-identity-protocol.js'; // NEW
const cryptoProtocol = globalThis.TrellisIdentityProtocol; // NEW
async function optional(filename) { return fs.readFile(filename, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error; }); } // NEW

export function createCommunityTransport(context) { // NEW
    const { profile, initialize, writeAtomic, writeImmutable, persist, configureCanvas, publishMembership, collaborationStore, canvasState } = context; // NEW
    const area = canvas => path.join(canvas.folderPath, '.trellis', 'garden-community'); // NEW
    const bindingPath = canvas => path.join(profile, 'community-bindings', safeId(canvas.shareId) + '.json'); // NEW: synchronized peers cannot overwrite the coordinator's association state.
    const evidencePath = canvas => path.join(profile, 'community-evidence', safeId(canvas.shareId) + '.json'); // NEW
    let encryptionKeys; // NEW
    let cityCatalog = null, cityCatalogExpires = 0, cityCatalogLoad = null; // NEW
    /** All gardens in a polling cycle share one catalog read; edits still resolve against the full catalog. */ // NEW
    async function locationCatalog() { // NEW
        if (!context.listCities) return null; // NEW
        if (!cityCatalogLoad && Date.now() >= cityCatalogExpires) cityCatalogLoad = Promise.resolve().then(() => context.listCities()).then(cities => { cityCatalog = cities; cityCatalogExpires = Date.now() + 30000; return cities; }).finally(() => { cityCatalogLoad = null; }); // NEW
        return cityCatalogLoad || cityCatalog; // NEW
    } // NEW
    async function previousEvidence(canvas) { // NEW
        const anchor = { shareId: canvas.shareId, diagramId: canvas.diagramId, genesisCoordinatorPublicKey: canvas.genesisCoordinatorPublicKey || canvas.coordinatorPublicKey }, candidates = []; // NEW
        for (const filename of [evidencePath(canvas), path.join(area(canvas), 'evidence.json')]) { try { const record = await optional(filename); if (record) { verifyGardenEvidence(record, anchor); candidates.push(record); } } catch (_) { /* Untrusted shared metadata cannot become a coordinator attestation. */ } } // NEW
        return candidates.sort((a, b) => b.payload.revision - a.payload.revision)[0] || null; // NEW
    } // NEW
    async function binding(canvas) { return await optional(bindingPath(canvas)) || (await previousEvidence(canvas))?.payload.binding || null; } // NEW: coordinator handoff bootstraps from verified predecessor evidence.
    async function endpoint() { // NEW
        await initialize(); // NEW
        if (!encryptionKeys) { // NEW
            encryptionKeys = await optional(path.join(profile, 'community-exchange.json')); // NEW
            if (!encryptionKeys) { encryptionKeys = await cryptoProtocol.keyPair('ECDH'); await writeAtomic(path.join(profile, 'community-exchange.json'), JSON.stringify(encryptionKeys)); } // NEW
        } // NEW
        const deviceId = context.deviceId(); // NEW
        if (!deviceId) throw new Error('The sharing device is not initialized yet. Connect once before using communities.'); // NEW
        return signRecord({ schema: COMMUNITY_VERSION, kind: 'community-endpoint', deviceId, publicKey: context.keys().publicKey, exchangeKey: encryptionKeys.publicKey }, context.keys().privateKey); // NEW
    } // NEW
    async function sign(payload) { await initialize(); return signRecord({ ...payload, authorDeviceId: context.deviceId() }, context.keys().privateKey); } // NEW
    async function seal(value, recipients, channelId) { // NEW
        const ownEndpoint = await endpoint(), key = crypto.getRandomValues(new Uint8Array(32)); // NEW
        try { // NEW
            const envelopes = []; // NEW
            for (const recipient of recipients) { // NEW
                if (!verifyRecord(recipient, recipient?.payload?.publicKey) || recipient.payload.kind !== 'community-endpoint') throw new Error('Invalid request encryption endpoint.'); // NEW
                const exchange = await cryptoProtocol.keyPair('ECDH'), shared = await cryptoProtocol.sharedKey(exchange.privateKey, recipient.payload.exchangeKey); // NEW
                try { envelopes.push({ deviceId: recipient.payload.deviceId, exchangeKey: exchange.publicKey, envelope: await cryptoProtocol.seal({ key: cryptoProtocol.b64(key) }, shared, channelId) }); } finally { shared.fill(0); } // NEW
            } // NEW
            return signRecord({ schema: COMMUNITY_VERSION, kind: 'private-community-message', id: makeId(), channelId, sender: ownEndpoint, envelopes, body: await cryptoProtocol.seal(value, key, channelId) }, context.keys().privateKey); // NEW
        } finally { key.fill(0); } // NEW
    } // NEW
    async function open(record, channelId) { // NEW
        const ownEndpoint = await endpoint(), p = record?.payload; // NEW
        if (p?.schema !== COMMUNITY_VERSION || p.kind !== 'private-community-message' || p.channelId !== channelId || !verifyRecord(p.sender, p.sender?.payload?.publicKey) || !verifyRecord(record, p.sender.payload.publicKey)) throw new Error('Invalid private request message.'); // NEW
        const envelope = p.envelopes.find(e => e.deviceId === ownEndpoint.payload.deviceId); // NEW
        if (!envelope) return null; // NEW
        const shared = await cryptoProtocol.sharedKey(encryptionKeys.privateKey, envelope.exchangeKey); // NEW
        try { const { key } = await cryptoProtocol.open(envelope.envelope, shared, channelId); const raw = cryptoProtocol.un64(key); try { return await cryptoProtocol.open(p.body, raw, channelId); } finally { raw.fill(0); } } finally { shared.fill(0); } // NEW
    } // NEW
    function linked(state, identityId) { // NEW
        const user = state.store.users?.find(u => u.portableIdentityId === identityId && !u.disabled && hasCanvasAccess(state, u.id)); // NEW
        if (!user) throw new Error('An active identity-linked garden account is required.'); // NEW
        return user; // NEW
    } // NEW
    function manages(state, user, cell) { // NEW
        if (user.admin) return true; // NEW
        const teams = activeAccessTeams(state, user.id), seen = new Set(); let ownerSeen = false; // CHANGE
        for (let scope = cell; scope && !seen.has(scope.id); scope = scope.page.get(scope.parentId)) { // NEW
            seen.add(scope.id); const owner = scope.node.getAttribute('trellis_owner_user_id'); // NEW
            if (owner && !ownerSeen) { ownerSeen = true; if (owner === user.id) return true; } // CHANGE: respect the nearest owner, as the existing replay permission checks do.
            const grants = JSON.parse(scope.node.getAttribute('trellis_access_grants_json') || '[]'); // NEW
            if (grants.some(g => (g.userId === user.id || g.subjectType === 'team' && teams.has(g.teamId)) && g.capabilities?.includes('manage_access'))) return true; // NEW
        } // NEW
        return false; // NEW
    } // NEW
    const scopeCells = state => state.cells.filter(c => ['garden_module', 'team_module', 'task_module', 'garden_bed', 'gardenBed', 'is_garden_bed'].some(a => c.node.getAttribute(a) === '1') || ['KANBAN_BOARD', 'MAIN_KANBAN_BOARD'].includes(c.node.getAttribute('board_key')) || c.node.getAttribute('roadmap_type') === 'board' || /(?:^|;)module=1(?:;|$)/.test(c.node.getElementsByTagName('mxCell')[0]?.getAttribute('style') || '')); // CHANGE: enumerate the same module, bed, and board scopes as People & Access.
    async function garden(input) { // NEW
        await initialize(); const canvas = context.known(input.shareId); // NEW
        if (!canvas) return null; // NEW
        if (input.probeOnly && !await fs.stat(area(canvas)).then(s => s.isDirectory()).catch(error => { if (error.code === 'ENOENT') return false; throw error; })) return null; // NEW
        if (canvas.projectRetired && canvas.projectRetired !== 'left') return { proof: await optional(path.join(profile, 'community-retirements', safeId(canvas.shareId) + '.json')), bootstrap: null, scopes: [], canAdminister: false }; // NEW
        if (canvas.localRemoved || canvas.pending || canvas.revoked || canvas.projectRetired) return null; // NEW
        if (!input.readOnly) await refresh(canvas, true); const state = await canvasState(canvas); // CHANGE: listing permissions uses the projection without publishing attestations.
        if (input.identityId) linked(state, input.identityId); // NEW
        const proof = await optional(path.join(area(canvas), 'evidence.json')); // NEW
        const bootstrap = await optional(path.join(area(canvas), 'bootstrap.json')); // NEW
        const user = input.identityId ? linked(state, input.identityId) : null; // NEW
        return { proof, bootstrap, canAdminister: !!user?.admin, scopes: user ? scopeCells(state).filter(c => manages(state, user, c)).map(c => ({ id: c.id, pageId: c.node.ownerDocument.documentElement === state.document.pages[0].doc.documentElement ? state.document.pages[0].container?.getAttribute('id') || '' : state.document.pages.find(p => p.doc === c.node.ownerDocument)?.container?.getAttribute('id') || '', label: c.node.getAttribute('label') || c.node.getAttribute('name') || c.id })) : [] }; // NEW
    } // NEW
    async function command(input) { // NEW
        await initialize(); const canvas = context.known(input.shareId); // NEW
        if (!canvas || canvas.localRemoved || canvas.projectRetired) throw new Error('Download the garden before changing its community.'); // NEW
        const state = await canvasState(canvas), user = linked(state, input.identityId); // NEW
        if (!user.admin) throw new Error('A garden administrator must approve this change.'); // NEW
        const record = await sign({ schema: COMMUNITY_VERSION, id: input.id || makeId(), kind: input.kind, actorIdentityId: input.identityId, shareId: canvas.shareId, diagramId: canvas.diagramId, data: input.data }); // NEW
        await writeImmutable(path.join(area(canvas), 'commands', safeId(record.payload.id) + '.json'), record); // NEW
        await refresh(canvas, true); // CHANGE
        const receipt = await optional(path.join(area(canvas), 'receipts', record.payload.id + '.json')); if (receipt && !receipt.ok) throw new Error(receipt.reason); // NEW
        return { ok: true, queued: canvas.coordinatorDeviceId !== context.deviceId() }; // NEW
    } // NEW
    /** Materialize eligibility from accepted Users policy, never from UI claims or pending invites. */ // NEW
    async function evidence(canvas, state) { // NEW
        const members = (state.store.users || []).filter(u => u.portableIdentityId && !u.disabled && hasCanvasAccess(state, u.id)).map(u => ({ identityId: u.portableIdentityId, userId: u.id, admin: !!u.admin, devices: canvas.members.filter(d => d.userId === u.id).map(d => ({ deviceId: d.deviceId, publicKey: d.publicKey })), manager: scopeCells(state).some(c => manages(state, u, c)) })); // NEW
        const membership = []; // NEW
        for (const name of (await fs.readdir(path.join(canvas.folderPath, '.trellis', 'membership'))).filter(n => /^\d{12}\.json$/.test(n)).sort()) membership.push(await optional(path.join(canvas.folderPath, '.trellis', 'membership', name))); // NEW
        const association = await binding(canvas), previous = await previousEvidence(canvas); // CHANGE
        const descriptor = await context.descriptor(canvas.shareId); // NEW
        const catalog = await locationCatalog().catch(() => null); // CHANGE
        const knownCities = new Map((catalog || []).map(cityRecord).filter(Boolean).map(city => [city.cityId, city])); // CHANGE
        for (const city of (previous?.payload.moduleCities || []).map(cityRecord).filter(Boolean)) if (!knownCities.has(city.cityId)) knownCities.set(city.cityId, city); // NEW: retain verified coordinates missing from this device's catalog.
        const locations = projectSummary(state, [...knownCities.values()], true); // CHANGE
        const retiredSigners = [...(previous?.payload.retiredSigners || [])]; // NEW
        if (previous?.payload.binding?.communityId) { // NEW
            const changes = []; // NEW
            for (const name of (await fs.readdir(path.join(path.dirname(profile), 'community-data', safeId(previous.payload.binding.communityId), 'records')).catch(() => [])).filter(n => /^[A-Za-z0-9_-]+\.json$/.test(n))) changes.push(await optional(path.join(path.dirname(profile), 'community-data', previous.payload.binding.communityId, 'records', name)).catch(() => null)); // CHANGE
            for (const old of previous.payload.members) for (const device of old.devices) if ((association?.communityId !== previous.payload.binding.communityId || !members.some(m => m.identityId === old.identityId && m.devices.some(d => d.deviceId === device.deviceId && d.publicKey === device.publicKey))) && !retiredSigners.some(r => r.identityId === old.identityId && r.deviceId === device.deviceId && r.communityId === previous.payload.binding.communityId)) retiredSigners.push({ communityId: previous.payload.binding.communityId, identityId: old.identityId, deviceId: device.deviceId, recordIds: changes.filter(r => r?.payload?.actorIdentityId === old.identityId && r.payload.authorDeviceId === device.deviceId && verifyRecord(r, device.publicKey)).map(r => r.payload.id).sort() }); // CHANGE
        } // NEW
        const fields = { schema: COMMUNITY_VERSION, kind: 'garden-evidence', descriptor, binding: association, name: projectName(state) || canvas.projectName || canvas.label, members, membership, retiredSigners, userCount: locations.userCount, moduleCities: locations.moduleCities, gardenModuleCount: locations.gardenModuleCount, locationsComplete: locations.locationsComplete, deleted: false }; // CHANGE: only city-level locations join the coordinator attestation; no live presence or changing timestamps.
        if (previous && canonical({ ...previous.payload, revision: 0 }) === canonical({ ...fields, revision: 0 })) { if (canonical(await optional(path.join(area(canvas), 'evidence.json')).catch(() => null)) !== canonical(previous)) await writeAtomic(path.join(area(canvas), 'evidence.json'), JSON.stringify(previous)); return previous; } // CHANGE: repair tampering without rewriting unchanged evidence on every poll.
        const record = signRecord({ ...fields, revision: (previous?.payload.revision || 0) + 1 }, context.keys().privateKey); // NEW
        await writeAtomic(evidencePath(canvas), JSON.stringify(record)); await writeAtomic(path.join(area(canvas), 'evidence.json'), JSON.stringify(record)); return record; // CHANGE
    } // NEW
    async function refresh(canvas, force = false) { // CHANGE
        if (canvas.localRemoved || canvas.revoked || canvas.pending || canvas.projectRetired) return; // NEW
        if (!force && !await fs.stat(area(canvas)).then(s => s.isDirectory()).catch(error => { if (error.code === 'ENOENT') return false; throw error; })) return; // NEW
        const localEndpoint = await endpoint(); // NEW
        const endpointPath = path.join(area(canvas), 'endpoints', safeId(context.deviceId()) + '.json'); // NEW
        if (canonical(await optional(endpointPath)) !== canonical(localEndpoint)) await writeAtomic(endpointPath, JSON.stringify(localEndpoint)); // CHANGE
        if (canvas.coordinatorDeviceId !== context.deviceId()) return; // NEW
        const state = await canvasState(canvas); // NEW
        for (const name of (await fs.readdir(path.join(area(canvas), 'commands')).catch(() => [])).filter(n => /^[A-Za-z0-9_-]+\.json$/.test(n)).sort()) { // NEW
            const receipt = path.join(area(canvas), 'receipts', name); if (await optional(receipt)) continue; // NEW
            const record = await optional(path.join(area(canvas), 'commands', name)), p = record?.payload, member = canvas.members.find(m => m.deviceId === p?.authorDeviceId); // NEW
            try { // NEW
                const user = linked(state, p.actorIdentityId); // NEW
                if (!member || member.userId !== user.id || !user.admin || !verifyRecord(record, member.publicKey) || p.shareId !== canvas.shareId || p.diagramId !== canvas.diagramId) throw new Error('Invalid garden community command.'); // NEW
                const bindingFile = bindingPath(canvas), currentBinding = await binding(canvas); // CHANGE
                if (p.kind === 'bind') { // NEW
                    safeId(p.data.communityId); // NEW
                    if (currentBinding?.communityId && currentBinding.communityId !== p.data.communityId) throw new Error('Detach the garden from its current community first.'); // CHANGE
                    await writeAtomic(bindingFile, JSON.stringify({ communityId: p.data.communityId, generation: currentBinding?.generation || makeId() })); // CHANGE
                } else if (p.kind === 'unbind') { // NEW
                    if (currentBinding?.communityId !== p.data.communityId) throw new Error('Garden community changed.'); // CHANGE
                    await writeAtomic(bindingFile, JSON.stringify({ communityId: null, generation: makeId() })); // NEW
                } else if (p.kind === 'bootstrap') { // NEW
                    if (currentBinding?.communityId !== p.data.communityId) throw new Error('Garden community changed.'); // CHANGE
                    await writeAtomic(path.join(area(canvas), 'bootstrap.json'), JSON.stringify(record)); // CHANGE: recipients verify the garden administrator's endorsement.
                    await writeImmutable(path.join(area(canvas), 'bootstrap-history', safeId(p.data.communityId) + '-' + safeId(p.data.entry.genesisHash) + '.json'), record).catch(async error => { const previous = await optional(path.join(area(canvas), 'bootstrap-history', p.data.communityId + '-' + p.data.entry.genesisHash + '.json')); if (!previous) throw error; }); // NEW: requests retain their original trusted association after a move.
                } else throw new Error('Unsupported garden community command.'); // NEW
                await writeAtomic(receipt, JSON.stringify({ ok: true })); // NEW
            } catch (error) { await writeAtomic(receipt, JSON.stringify({ ok: false, reason: error.message })); } // NEW
        } // NEW
        await evidence(canvas, state); // NEW
    } // NEW
    async function endpoints(input) { // NEW
        const canvas = context.known(input.shareId); if (!canvas) return []; // NEW
        const state = await canvasState(canvas), result = []; // NEW
        for (const member of canvas.members) { // NEW
            const user = state.store.users?.find(u => u.id === member.userId && !u.disabled); // NEW
            if (!user || !hasCanvasAccess(state, user.id) || !scopeCells(state).some(c => manages(state, user, c))) continue; // NEW
            const record = await optional(path.join(area(canvas), 'endpoints', safeId(member.deviceId) + '.json')); // NEW
            if (record && verifyRecord(record, member.publicKey)) result.push(record); // NEW
        } // NEW
        return result; // NEW
    } // NEW
    /** Recheck the actual manager and selected scopes against fresh accepted project policy. */ // NEW
    async function grant(input) { // NEW
        await initialize(); const canvas = context.known(input.shareId); // NEW
        if (!canvas || canvas.localRemoved || canvas.projectRetired) throw new Error('The garden is unavailable.'); // NEW
        if (canvas.coordinatorDeviceId !== context.deviceId()) return { ok: false, waiting: true, reason: 'Waiting for the garden coordinator.' }; // NEW
        const state = await canvasState(canvas), request = input.request, decision = input.decision, d = decision.payload.data; // NEW
        const grantPath = path.join(area(canvas), 'applied-grants', safeId(request.payload.id) + '.json'), applied = await optional(grantPath); // NEW
        if (applied) { // NEW
            verifyGardenEvidence(applied.evidence, { shareId: canvas.shareId, diagramId: canvas.diagramId, genesisCoordinatorPublicKey: canvas.genesisCoordinatorPublicKey || canvas.coordinatorPublicKey }); // NEW
            if (!verifyRecord(applied.receipt, applied.evidence.payload.descriptor.coordinatorPublicKey) || applied.receipt.payload.requestId !== request.payload.id) throw new Error('Invalid durable access receipt.'); // NEW
            const active = state.store.users.find(u => u.id === applied.receipt.payload.workerId && u.portableIdentityId === request.payload.actorIdentityId && !u.disabled); // NEW
            if (!active || !hasCanvasAccess(state, active.id)) throw new Error('This request was already applied and access later changed. Submit a fresh request.'); // NEW
            await configureCanvas(canvas); return { ok: true, descriptor: await context.descriptor(canvas.shareId), workerId: active.id }; // NEW
        } // NEW
        if (request.payload.schema !== COMMUNITY_VERSION || request.payload.kind !== 'access-request' || request.payload.data.shareId !== canvas.shareId || request.payload.data.diagramId !== canvas.diagramId || decision.payload.kind !== 'access-decision') throw new Error('Garden access request context does not match.'); // NEW
        const bootstrap = await optional(path.join(area(canvas), 'bootstrap-history', safeId(request.payload.communityId) + '-' + safeId(input.communityProof?.genesisHash) + '.json')) || await optional(path.join(area(canvas), 'bootstrap.json')), communityEntry = bootstrap?.payload?.data?.entry; // CHANGE
        if (!communityEntry || input.communityProof?.genesisHash !== communityEntry.genesisHash || request.payload.communityId !== communityEntry.id) throw new Error('Access request has no trusted community association.'); // NEW
        const community = reduceCommunity(input.communityProof.records, communityEntry.genesisHash, input.communityProof.evidence); // NEW
        if (!community.members.has(request.payload.actorIdentityId) || !community.gardens.some(g => g.anchor.shareId === input.sourceAnchor.shareId && g.anchor.genesisCoordinatorPublicKey === input.sourceAnchor.genesisCoordinatorPublicKey) || !community.gardens.some(g => g.anchor.shareId === canvas.shareId) || input.sourceEvidence.payload.binding?.communityId !== communityEntry.id) throw new Error('The requester was not a member of this garden community.'); // NEW
        const manager = linked(state, decision.payload.actorIdentityId), managerDevice = canvas.members.find(m => m.deviceId === decision.payload.authorDeviceId && m.userId === manager.id); // NEW
        if (!managerDevice || !verifyRecord(decision, managerDevice.publicKey) || d.requestId !== request.payload.id || d.shareId !== canvas.shareId || !Object.hasOwn(COMMUNITY_PRESETS, d.preset)) throw new Error('Invalid access-manager decision.'); // NEW
        verifyGardenEvidence(input.sourceEvidence, input.sourceAnchor); // NEW
        if (!evidenceSigner(input.sourceEvidence, request) || !request.payload.data.devices?.length) throw new Error('The requester did not have verified community membership.'); // NEW
        const devices = request.payload.data.devices, trusted = input.sourceEvidence.payload.members.find(m => m.identityId === request.payload.actorIdentityId)?.devices; // NEW
        for (const device of devices) if (!trusted?.some(d => d.deviceId === device.deviceId && d.publicKey === device.publicKey)) throw new Error('Unapproved requester device.'); // NEW
        for (const device of devices) { const current = canvas.members.find(m => m.deviceId === device.deviceId), owner = state.store.users.find(u => u.id === current?.userId); if (owner && !owner.disabled && owner.portableIdentityId !== request.payload.actorIdentityId) throw new Error('The requester device belongs to another garden account.'); } // NEW
        safeId(request.payload.data.workerId); // NEW
        if (typeof request.payload.data.name !== 'string' || !request.payload.data.name.trim() || request.payload.data.name.length > 120 || state.store.users.some(u => u.id === request.payload.data.workerId && u.portableIdentityId !== request.payload.actorIdentityId)) throw new Error('Invalid requester account.'); // NEW
        const selected = d.scopes.map(s => state.cells.find(c => c.id === s.id && (state.document.pages.find(p => p.doc === c.node.ownerDocument)?.container?.getAttribute('id') || '') === (s.pageId || ''))); // NEW
        if (!selected.length || selected.some(c => !c || !manages(state, manager, c))) throw new Error('The approving manager cannot grant these scopes.'); // NEW
        const coordinator = canvas.members.find(m => m.deviceId === context.deviceId()); // NEW
        if (!activeAdmin(state, coordinator?.userId)) throw new Error('The coordinator must have active administrator access.'); // NEW
        let user = state.store.users.find(u => u.portableIdentityId === request.payload.actorIdentityId && !u.disabled); // CHANGE: a fresh approved request creates a new account instead of reactivating old grants.
        if (!user) { user = { id: request.payload.data.workerId, portableIdentityId: request.payload.actorIdentityId, name: request.payload.data.name, admin: false, disabled: false, pinSalt: '', pinHash: '', createdAt: Date.now() }; state.store.users.push(user); } // NEW
        for (const cell of selected) { // NEW
            const grants = JSON.parse(cell.node.getAttribute('trellis_access_grants_json') || '[]').filter(g => g.userId !== user.id); // NEW
            grants.push({ subjectType: 'user', userId: user.id, preset: d.preset, capabilities: [...COMMUNITY_PRESETS[d.preset]] }); // NEW
            cell.node.setAttribute('trellis_access_grants_json', JSON.stringify(grants)); // NEW
            const ids = JSON.parse(cell.node.getAttribute('trellis_access_user_ids_json') || '[]'); if (!ids.includes(user.id)) ids.push(user.id); cell.node.setAttribute('trellis_access_user_ids_json', JSON.stringify(ids)); // NEW
        } // NEW
        for (const cell of state.cells) if (cell.node.hasAttribute('trellis_users_json')) cell.node.setAttribute('trellis_users_json', JSON.stringify(state.store)); // NEW
        const baseXml = await fs.readFile(canvas.diagramPath, 'utf8'), xml = state.document.serialize(); // NEW
        const store = collaborationStore(canvas), result = await store.action('community-approval', coordinator.userId, { kind: 'save', baseXml, xml, usersPolicyAction: true }); // CHANGE
        await store.action('community-approval', coordinator.userId, { kind: 'release' }); // CHANGE
        if (!result.ok) return { ok: false, waiting: true, reason: result.reason }; // CHANGE
        const next = canvas.members.filter(m => !devices.some(d => d.deviceId === m.deviceId) || m.userId === user.id); for (const device of devices) if (!next.some(m => m.deviceId === device.deviceId)) next.push({ deviceId: device.deviceId, publicKey: device.publicKey, userId: user.id }); // CHANGE
        if (canonical(next) !== canonical(canvas.members)) { await publishMembership(canvas, next); await persist(); } // CHANGE
        await configureCanvas(canvas); // NEW: retries must also finish a previously interrupted transport configuration.
        await refresh(canvas); // NEW
        const descriptor = await context.descriptor(canvas.shareId), proof = await optional(path.join(area(canvas), 'evidence.json')); // NEW
        await writeImmutable(grantPath, { receipt: await sign({ schema: COMMUNITY_VERSION, kind: 'access-applied', requestId: request.payload.id, workerId: user.id }), evidence: proof }); // NEW
        return { ok: true, descriptor, workerId: user.id }; // CHANGE
    } // NEW
    /** Retain a signed tombstone outside folders that Trash or purge can move/remove. */ // NEW
    async function retire(canvas) { // NEW
        if (canvas.coordinatorDeviceId !== context.deviceId()) return; // NEW
        const target = path.join(profile, 'community-retirements', safeId(canvas.shareId) + '.json'); // NEW
        if (await optional(target)) return; // NEW
        const previous = await optional(path.join(area(canvas), 'evidence.json')); if (!previous?.payload.binding?.communityId) return; // NEW
        await writeAtomic(bindingPath(canvas), JSON.stringify({ communityId: null, generation: makeId() })); // CHANGE
        const fresh = await evidence(canvas, await canvasState(canvas)); // NEW
        const record = signRecord({ ...fresh.payload, revision: fresh.payload.revision + 1, deleted: true, members: [], binding: { communityId: null, generation: makeId() } }, context.keys().privateKey); // CHANGE
        await writeAtomic(target, JSON.stringify(record)); // NEW
    } // NEW
    /** Accept a fresh verified entitlement without materializing or resuming a garden download. */ // NEW
    async function prepareGrant(input) { // NEW
        await initialize(); const canvas = context.known(input.shareId); if (!canvas || canvas.communityGrantId === input.communityGrantId) return; // NEW
        safeId(input.communityGrantId); // NEW
        if (canvas.projectRetired && canvas.projectRetired !== 'left') throw new Error('Restore this garden before accepting new access.'); // NEW
        if ((canvas.genesisCoordinatorPublicKey || canvas.coordinatorPublicKey) !== input.genesisCoordinatorPublicKey) throw new Error('The approved garden trust anchor changed.'); // NEW
        Object.assign(canvas, { communityGrantId: input.communityGrantId, projectRetired: null, projectFenced: false, retirementComplete: null, departureRequestId: null, localRemoved: true, revoked: false, paused: false, pending: true, rejoined: true, membershipVersion: 0, members: input.members, bootstrapMembers: input.members, joinMembershipVersion: Math.max(0, input.membershipVersion - 1), coordinatorDeviceId: input.originCoordinatorDeviceId || input.coordinatorDeviceId, coordinatorPublicKey: input.genesisCoordinatorPublicKey }); // NEW
        context.reset(canvas.shareId); await persist(); // NEW
    } // NEW
    return { endpoint, sign, seal, open, garden, command, refresh, endpoints, grant, retire, prepareGrant }; // CHANGE
} // NEW
