import { serialize, deserialize } from 'node:v8'; // NEW
import { deflateRawSync, inflateRawSync } from 'node:zlib'; // NEW
import { saveCache } from './trellis-save-cache.js'; // NEW
import { REVISION, listBounded, readJson as readBoundedJson, readBounded, parseJson, LIMITS, diagnostic } from './trellis-input-policy.js'; // NEW
/** Community orchestration: small shared directories, private request channels, existing garden grants. */ // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import { EventEmitter } from 'node:events'; // NEW
import { safeId, makeId, canonical, digest, verifyRecord } from './trellis-share-protocol.js'; // NEW
import { COMMUNITY_VERSION, COMMUNITY_PRESETS, communityHash, communityText, reduceCommunity, verifyGardenEvidence, evidenceSigner } from './trellis-community-protocol.js'; // NEW
import { projectPeople } from './trellis-project-people.js'; // NEW
import { nearestDistance } from './trellis-project-summary.js'; // NEW

async function read(filename, budget) { return readBoundedJson(filename, LIMITS.metadata, budget) /* CHANGE */.catch(error => { if (error.code === 'ENOENT') return null; throw error; }); } // NEW
async function immutable(filename, value) { // NEW
    await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 }); // NEW
    try { await fs.writeFile(filename, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST' || canonical(await read(filename)) !== canonical(value)) throw error; } // NEW
} // NEW
async function records(directory) { // NEW
    const names = await listBounded(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; }); // NEW
    const sorted = names.filter(n => /^[A-Za-z0-9_-]+\.json$/.test(n)).sort(), result = [], budget = { used: 0, maximum: LIMITS.replay }; // NEW
    for (let offset = 0; offset < sorted.length; offset += 32) { // NEW
        const loaded = await Promise.allSettled(sorted.slice(offset, offset + 32).map(async name => { const filename = path.join(directory, name); if (!(await fs.lstat(filename)).isFile()) throw new Error('Metadata records must be ordinary files.'); return read(filename, budget); })); // CHANGE
        for (const entry of loaded) { if (entry.status === 'fulfilled' && entry.value) result.push(entry.value); else if (entry.reason?.code === 'REPLAY_LIMIT' || entry.reason?.code === 'INPUT_LIMIT') throw entry.reason; } // NEW
    } // NEW
    return result; // CHANGE
} // NEW

export function createGardenCommunityService({ identities, library }) { // NEW
    let queue = Promise.resolve(); const events = new EventEmitter(), warnings = new Map(); // CHANGE
    const run = fn => { const task = queue.then(fn); queue = task.catch(() => {}); return task; }; // NEW
    const directory = (identityId, id) => path.join(identities.identityRoot(identityId), 'community-data', safeId(id)); // NEW
    const requestDirectory = (identityId, id) => path.join(identities.identityRoot(identityId), 'community-requests', safeId(id)); // NEW
    const privateArea = identityId => path.join(identities.identityRoot(identityId), 'community-local'); // NEW
    async function own() { await identities.requireSession(); const session = identities.session(); if (!session) throw new Error('Log in before using garden communities.'); return session; } // NEW
    const endpointDevices = endpoints => [...new Set(endpoints.map(e => e.payload.deviceId))]; // NEW
    async function registrations(identityId) { // NEW
        const errors = [], all = await library.verifiedRecords(identityId, path.join(identities.metadataRoot(identityId), 'community-registrations'), errors); // NEW
        return [...new Map(all.filter(r => r.payload.kind === 'community-registration').map(r => [r.payload.entry.id, r.payload.entry])).values()]; // NEW
    } // NEW
    async function register(identityId, entry) { // NEW
        safeId(entry.id); const genesis = reduceCommunity([entry.genesis], entry.genesisHash); // NEW
        if (genesis.rejected.length || genesis.community?.id !== entry.id) throw new Error('Invalid community registration.'); // NEW
        for (const record of entry.initialRecords || [entry.genesis]) await immutable(path.join(directory(identityId, entry.id), 'records', safeId(record.payload.id) + '.json'), record); // NEW
        for (const proof of entry.initialEvidence || []) await immutable(path.join(directory(identityId, entry.id), 'evidence', communityHash(proof) + '.json'), proof); // NEW
        const existing = (await registrations(identityId)).find(e => e.id === entry.id); // NEW
        if (existing) { if (existing.genesisHash !== entry.genesisHash) throw new Error('Community trust anchor changed.'); return; } // NEW
        if (identities.session()?.identityId !== identityId) return; // NEW
        const record = await identities.signAction('community-registration', { entry }); // NEW
        await immutable(path.join(identities.metadataRoot(identityId), 'community-registrations', record.payload.id + '.json'), record); // NEW
        await immutable(path.join(directory(identityId, entry.id), 'records', entry.genesis.payload.id + '.json'), entry.genesis); // NEW
    } // NEW
    /** Observe current bounded bytes in each channel, then reuse only an identical verified replay. */ // NEW
    async function cachedRecords(folder, budget) { // NEW
        const names = (await listBounded(folder).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).filter(n => /^[A-Za-z0-9_-]+\.json$/.test(n)).sort(), loaded = []; // NEW
        for (let offset = 0; offset < names.length; offset += 32) { // NEW: bounded parallel reads preserve current-byte validation without serial filesystem latency.
            const batch = await Promise.allSettled(names.slice(offset, offset + 32).map(async name => { // NEW
                const filename = path.join(folder, name), stat = await fs.lstat(filename); if (!stat.isFile()) return null; // NEW
                const text = await readBounded(filename, LIMITS.metadata, 'utf8', budget); return { text, hash: digest(text), name }; // CHANGE: exact-input proofs let unchanged validated state reuse its schema checks. // CHANGE: cache fingerprints use observed bytes; signed community hashes remain canonical. // NEW
            })); // NEW
            for (const entry of batch) { if (entry.status === 'fulfilled' && entry.value) loaded.push(entry.value); else if (entry.reason?.code === 'INPUT_LIMIT' || entry.reason?.code === 'REPLAY_LIMIT') throw entry.reason; } // NEW
        } // NEW
        return loaded; // NEW
    } // NEW
    async function state(identityId, entry) { // NEW
        const base = directory(identityId, entry.id); // NEW
        const budget = { used: 0, maximum: LIMITS.replay }; // NEW
        const [changes, proofs] = await Promise.all([cachedRecords(path.join(base, 'records'), budget), cachedRecords(path.join(base, 'evidence'), budget)]), token = digest(JSON.stringify([entry.genesisHash, changes.map(r => [r.name, r.hash]), proofs.map(r => [r.name, r.hash])])), cacheKey = 'community:' + REVISION + ':' + base, cached = saveCache.get(cacheKey); // CHANGE
        if (cached?.token === token) return deserialize(inflateRawSync(cached.bytes, { maxOutputLength: LIMITS.replay })); // CHANGE: copied, bounded cache projection. // NEW
        const parseRecords = records => records.flatMap(record => { try { return [parseJson(record.text, LIMITS.metadata)]; } catch (error) { if (error.code === 'INPUT_LIMIT') throw error; const issue = diagnostic(error, record.name); warnings.set(identityId, [...new Set([...(warnings.get(identityId) || []), '[' + issue.code + '] Community metadata could not be verified: ' + (issue.recordId || 'record')])].slice(0, 32)); return []; } }); // NEW
        const value = reduceCommunity(parseRecords(changes), entry.genesisHash, parseRecords(proofs)); const bytes = serialize(value); if (bytes.length <= LIMITS.replay) { const compressed = deflateRawSync(bytes); saveCache.set(cacheKey, { token, bytes: compressed }, compressed.length + token.length * 2 + 512); } return value; // CHANGE: charge exact compressed storage to the existing main cache budget. // NEW
    } // NEW
    async function signed(identityId, community, kind, data, id = makeId()) { // NEW
        const daemon = await identities.transport(identityId); // NEW
        return daemon.communities.sign({ schema: COMMUNITY_VERSION, id, kind, communityId: community.community.id, parents: community.heads, clock: community.clock + 1, evidenceHashes: community.gardens.map(g => communityHash(community.evidence.get(g.anchor.shareId))), actorIdentityId: identityId, data }); // CHANGE
    } // NEW
    async function append(identityId, entry, kind, data, id) { // NEW
        const current = await state(identityId, entry), record = await signed(identityId, current, kind, data, id); // NEW
        for (const proof of current.evidence.values()) await immutable(path.join(directory(identityId, entry.id), 'evidence', communityHash(proof) + '.json'), proof); // NEW
        const next = reduceCommunity([...current.accepted, record], entry.genesisHash, await records(path.join(directory(identityId, entry.id), 'evidence'))); // CHANGE
        const rejection = next.rejected.find(r => r.id === record.payload.id); if (rejection) throw new Error(rejection.reason); // NEW
        await immutable(path.join(directory(identityId, entry.id), 'records', record.payload.id + '.json'), record); return record; // NEW
    } // NEW
    async function visible(identityId, id, requireAdmin = false) { // NEW
        const entry = (await registrations(identityId)).find(e => e.id === id); if (!entry) throw new Error('Community is not in this identity library.'); // NEW
        const current = await state(identityId, entry); // NEW
        if (current.archived || !current.members.has(identityId) || requireAdmin && !current.administrators.includes(identityId)) throw new Error('Current community membership' + (requireAdmin ? ' and administrator access are' : ' is') + ' required.'); // NEW
        return { entry, current }; // NEW
    } // NEW
    async function source(identityId, diagramId, admin = false) { // NEW
        const located = await library.communitySource(identityId, diagramId); if (!located) throw new Error('Choose a garden in your library.'); // NEW
        if (located.entry.protocolVersion !== 3) throw new Error('Unsupported Trellis sharing protocol. Only version 3 gardens are supported.'); // CHANGE
        const daemon = await identities.transport(identityId); // NEW
        if (located.daemon !== daemon) throw new Error('Download the identity-managed garden copy before using communities.'); // NEW
        const info = await daemon.communities.garden({ shareId: located.entry.shareId, identityId }); // NEW
        if (!info || admin && !info.canAdminister) throw new Error('Download a garden you administer first.'); // NEW
        return { ...located, info }; // NEW
    } // NEW
    async function storeOperation(session, operation) { // NEW
        const record = await identities.signAction('community-operation', { operation }); // NEW
        await immutable(path.join(identities.metadataRoot(session.identityId), 'community-operations', record.payload.id + '.json'), record); // NEW
    } // NEW
    async function finishOperation(identityId, operation) { // NEW
        const located = await source(identityId, operation.diagramId, true), daemon = located.daemon, proof = located.info.proof; // NEW
        if (!proof || proof.payload.binding?.communityId !== operation.communityId) return false; // NEW
        const anchor = { shareId: located.entry.shareId, diagramId: located.entry.diagramId, genesisCoordinatorPublicKey: located.entry.genesisCoordinatorPublicKey || located.entry.coordinatorPublicKey }; // NEW
        verifyGardenEvidence(proof, anchor); // NEW
        if (operation.kind === 'create') { // NEW
            let genesis = await read(path.join(privateArea(identityId), operation.id + '-genesis.json')); // NEW
            if (!genesis) { // NEW
                genesis = await daemon.communities.sign({ schema: COMMUNITY_VERSION, id: operation.id, communityId: operation.communityId, parents: [], clock: 1, kind: 'create', actorIdentityId: identityId, data: { name: operation.name, description: operation.description, gardenDescription: operation.gardenDescription, evidence: proof, anchor } }); // NEW
                await immutable(path.join(privateArea(identityId), operation.id + '-genesis.json'), genesis); // NEW
            } // NEW
            const entry = { id: operation.communityId, genesis, genesisHash: communityHash(genesis), anchor }; // NEW
            if (reduceCommunity([genesis], entry.genesisHash).rejected.length) throw new Error('The community creator is not an approved administrator on this device.'); // NEW
            await register(identityId, entry); // NEW
            await daemon.communities.command({ shareId: located.entry.shareId, identityId, id: operation.id + '-bootstrap', kind: 'bootstrap', data: { communityId: entry.id, entry } }); // NEW
        } else { // NEW
            const { entry, current } = await visible(identityId, operation.communityId); // NEW
            const existing = current.accepted.find(r => r.payload.id === operation.id); // NEW
            if (!existing) await append(identityId, entry, 'admission', { evidence: proof, anchor, description: operation.description }, operation.id); // NEW
            const after = await state(identityId, entry); // NEW
            if (after.administrators.includes(identityId) && !after.accepted.some(r => r.payload.id === operation.id + '-approve')) await append(identityId, entry, 'admit', { admissionId: operation.id }, operation.id + '-approve'); // NEW
            if ((await state(identityId, entry)).gardens.some(g => g.anchor.diagramId === operation.diagramId)) await daemon.communities.command({ shareId: located.entry.shareId, identityId, id: operation.id + '-bootstrap', kind: 'bootstrap', data: { communityId: entry.id, entry } }); // NEW
        } // NEW
        await immutable(path.join(privateArea(identityId), operation.id + '-done.json'), { ok: true }); return true; // NEW
    } // NEW
    async function create(input) { return run(async () => { // NEW
        const session = await own(), located = await source(session.identityId, input.diagramId, true), operation = { id: makeId(), kind: 'create', communityId: makeId(), diagramId: input.diagramId, name: communityText(input.name, 120, true), description: communityText(input.description || '', 1000), gardenDescription: communityText(input.gardenDescription || '', 1000) }; // NEW
        if (located.info.proof?.payload.binding?.communityId) throw new Error('Detach the garden from its current community first.'); // NEW
        await storeOperation(session, operation); await located.daemon.communities.command({ shareId: located.entry.shareId, identityId: session.identityId, kind: 'bind', data: { communityId: operation.communityId } }); // NEW
        const complete = await finishOperation(session.identityId, operation); await refreshInternal(session.identityId); // NEW
        return { ok: true, communityId: operation.communityId, status: complete ? 'completed' : 'waiting', reason: complete ? '' : 'Waiting for the garden coordinator.' }; // NEW
    }); } // NEW
    async function addGarden(input) { return run(async () => { // NEW
        const session = await own(); await visible(session.identityId, input.communityId); // NEW
        const located = await source(session.identityId, input.diagramId, true), operation = { id: makeId(), kind: 'admission', communityId: input.communityId, diagramId: input.diagramId, description: communityText(input.description || '', 1000) }; // NEW
        if (located.info.proof?.payload.binding?.communityId && located.info.proof.payload.binding.communityId !== input.communityId) throw new Error('Detach the garden from its current community first.'); // NEW
        await storeOperation(session, operation); await located.daemon.communities.command({ shareId: located.entry.shareId, identityId: session.identityId, kind: 'bind', data: { communityId: operation.communityId } }); // NEW
        const complete = await finishOperation(session.identityId, operation); return { ok: true, status: complete ? 'pending' : 'waiting' }; // NEW
    }); } // NEW
    async function mutate(input, kind, data, admin = true) { // NEW
        const session = await own(), { entry } = await visible(session.identityId, input.communityId, admin); // NEW
        await append(session.identityId, entry, kind, data); await refreshInternal(session.identityId); return { ok: true }; // NEW
    } // NEW
    async function decideAdmission(input) { return run(() => mutate(input, input.approved ? 'admit' : 'deny-admission', { admissionId: safeId(input.admissionId) })); } // NEW
    async function update(input) { return run(() => mutate(input, 'details', { name: communityText(input.name, 120, true), description: communityText(input.description || '', 1000) })); } // NEW
    async function setAdministrators(input) { return run(() => mutate(input, 'administrators', { identityIds: input.identityIds })); } // NEW
    async function describeGarden(input) { return run(() => mutate(input, 'garden-description', { diagramId: safeId(input.diagramId), description: communityText(input.description || '', 1000) }, false)); } // NEW
    async function detachGarden(input) { return run(() => mutate(input, 'detach', { diagramId: safeId(input.diagramId) }, false)); } // NEW

    /** Registrations may outlive membership, but directory transport and UI eligibility may not. */ // NEW
    async function refreshInternal(identityId) { // NEW
        const daemon = await identities.transport(identityId), errors = []; // NEW
        for (const entry of await library.catalog(identityId, errors)) { // NEW
            try { // NEW
                const located = await library.communitySource(identityId, entry.diagramId); // NEW
                const info = await located.daemon.communities.garden({ shareId: entry.shareId, probeOnly: true }); // CHANGE: ordinary private gardens do not acquire community files during background scans.
                if (!info?.proof) continue; verifyGardenEvidence(info.proof, entry); // NEW
                const bootstrap = info.bootstrap, b = bootstrap?.payload; // NEW
                if (b?.data?.entry && b.data.communityId === info.proof.payload.binding?.communityId && evidenceSigner(info.proof, bootstrap, true)) await register(identityId, { ...b.data.entry, directoryDevices: b.data.directoryDevices || [], bootstrapEvidence: info.proof, bootstrapAnchor: { shareId: entry.shareId, diagramId: entry.diagramId, genesisCoordinatorPublicKey: entry.genesisCoordinatorPublicKey || entry.coordinatorPublicKey }, initialEvidence: [info.proof] }); // CHANGE
            } catch (error) { errors.push(error.message); } // NEW
        } // NEW
        if (identities.session()?.identityId === identityId) { // NEW
            const operations = await library.verifiedRecords(identityId, path.join(identities.metadataRoot(identityId), 'community-operations'), errors); // NEW
            for (const r of operations.filter(r => r.payload.kind === 'community-operation' && r.payload.author === identities.session()?.deviceId)) if (!await read(path.join(privateArea(identityId), r.payload.operation.id + '-done.json'))) { try { await finishOperation(identityId, r.payload.operation); } catch (error) { errors.push(error.message); } } // CHANGE: another paired device must not mint a different genesis for an already queued operation.
        } // NEW
        for (const entry of await registrations(identityId)) { // NEW
            try { // NEW
                let current = await state(identityId, entry); const base = directory(identityId, entry.id); // NEW
                const pendingGardens = current.admissions.filter(a => a.status === 'pending').map(a => ({ anchor: a.record.payload.data.anchor })); // NEW
                for (const g of [...current.gardens, ...pendingGardens]) { // CHANGE
                    const located = await library.communitySource(identityId, g.anchor.diagramId); if (!located) continue; // NEW
                    const info = await located.daemon.communities.garden({ shareId: g.anchor.shareId }); // NEW
                    if (!info?.proof) continue; verifyGardenEvidence(info.proof, g.anchor); // NEW
                    await immutable(path.join(base, 'evidence', communityHash(info.proof) + '.json'), info.proof); // NEW
                    for (const endpoint of await located.daemon.communities.endpoints({ shareId: g.anchor.shareId })) await immutable(path.join(base, 'endpoints', communityHash(endpoint) + '.json'), endpoint); // NEW
                } // NEW
                current = await state(identityId, entry); // NEW
                const devices = [...new Set(current.gardens.flatMap(g => current.evidence.get(g.anchor.shareId)?.payload.members.flatMap(m => m.devices.map(d => d.deviceId)) || []))]; // NEW
                const bootstrapData = { communityId: entry.id, entry: { id: entry.id, genesis: entry.genesis, genesisHash: entry.genesisHash, anchor: entry.anchor }, directoryDevices: devices }; // CHANGE: garden files carry only trust and transport bootstrap, not copies of the directory journal.
                const snapshotHash = communityHash(bootstrapData); // NEW
                for (const g of current.gardens) { // NEW
                    const located = await library.communitySource(identityId, g.anchor.diagramId); if (!located) continue; // NEW
                    const info = await located.daemon.communities.garden({ shareId: g.anchor.shareId, identityId }).catch(() => null); // NEW
                    if (info?.canAdminister && (info.bootstrap?.payload?.data?.snapshotHash !== snapshotHash || !evidenceSigner(info.proof, info.bootstrap, true))) await located.daemon.communities.command({ shareId: g.anchor.shareId, identityId, id: 'bootstrap-' + communityHash({ snapshotHash, identityId, deviceId: (await located.daemon.communities.endpoint()).payload.deviceId }), kind: 'bootstrap', data: { ...bootstrapData, snapshotHash } }); // CHANGE
                } // NEW
                let bootstrapEligible = false; // NEW
                if (entry.bootstrapEvidence && !current.evidence.has(entry.bootstrapAnchor.shareId)) { // NEW
                    verifyGardenEvidence(entry.bootstrapEvidence, entry.bootstrapAnchor); // NEW
                    const located = await library.communitySource(identityId, entry.bootstrapAnchor.diagramId), local = await located?.daemon.communities.garden({ shareId: entry.bootstrapAnchor.shareId }); // NEW
                    const proof = local?.proof || entry.bootstrapEvidence; // NEW
                    bootstrapEligible = proof.payload.binding?.communityId === entry.id && proof.payload.members.some(m => m.identityId === identityId); // NEW
                    if (bootstrapEligible) devices.push(...(entry.directoryDevices || []), ...proof.payload.members.flatMap(m => m.devices.map(d => d.deviceId))); // NEW
                } // NEW
                await daemon.configureMetadataChannel({ kind: 'community', id: entry.id, directory: base, devices, disabled: !bootstrapEligible && (current.archived || !current.members.has(identityId)) }); // CHANGE: a verified joined garden can bootstrap transport before the remaining directory records arrive.
                await discoverRequests(identityId, entry, current); // NEW
                // Clear garden-side bindings after an authorized community detachment arrives. // NEW
                const detached = [...current.accepted.filter(r => r.payload.kind === 'detach').map(r => r.payload.data.diagramId), ...current.admissions.filter(a => ['denied', 'withdrawn'].includes(a.status) || current.archived && a.status === 'pending').map(a => a.record.payload.data.anchor.diagramId)]; // CHANGE: pending gardens are released when their community closes.
                for (const diagramId of detached.filter(id => !current.gardens.some(g => g.anchor.diagramId === id))) { // NEW
                    const located = await library.communitySource(identityId, diagramId); if (!located) continue; // NEW
                    const info = await located.daemon.communities.garden({ shareId: located.entry.shareId, identityId }).catch(() => null); // NEW
                    if (info?.canAdminister && info.proof?.payload.binding?.communityId === entry.id) await located.daemon.communities.command({ shareId: located.entry.shareId, identityId, kind: 'unbind', data: { communityId: entry.id } }); // NEW
                } // NEW
            } catch (error) { errors.push(error.message); } // NEW
        } // NEW
        await processRequests(identityId, errors); warnings.set(identityId, [...new Set(errors)]); // CHANGE: reads must not recursively trigger picker refreshes.
    } // NEW
    async function refresh(identityId) { return run(async () => { await refreshInternal(identityId); events.emit('status'); }); } // NEW
    async function requestSubscriptions(identityId) { // NEW
        const local = await records(path.join(privateArea(identityId), 'request-subscriptions')); // NEW
        const signed = await library.verifiedRecords(identityId, path.join(identities.metadataRoot(identityId), 'community-request-subscriptions'), []); // NEW
        return [...new Map([...local, ...signed.filter(r => r.payload.kind === 'community-request-subscription').map(r => r.payload.subscription)].map(s => [s.id, s])).values()]; // NEW
    } // NEW
    async function subscribe(identityId, subscription) { // NEW
        await immutable(path.join(privateArea(identityId), 'request-subscriptions', safeId(subscription.id) + '.json'), subscription); // NEW
        if (identities.session()?.identityId === identityId && !(await library.verifiedRecords(identityId, path.join(identities.metadataRoot(identityId), 'community-request-subscriptions'), [])).some(r => r.payload.subscription?.id === subscription.id)) { // NEW
            const record = await identities.signAction('community-request-subscription', { subscription }); await immutable(path.join(identities.metadataRoot(identityId), 'community-request-subscriptions', record.payload.id + '.json'), record); // NEW
        } // NEW
        const recipients = await requestRecipients(identityId, subscription); // NEW
        await (await identities.transport(identityId)).configureMetadataChannel({ kind: 'access-request', id: subscription.id, directory: requestDirectory(identityId, subscription.id), devices: endpointDevices(recipients) }); // CHANGE
    } // NEW
    /** Apply coordinator-signed access changes to request transport as well as message encryption. */ // NEW
    async function requestRecipients(identityId, subscription) { // NEW
        verifyGardenEvidence(subscription.targetEvidence, subscription.targetAnchor); // NEW
        const policies = (await records(requestDirectory(identityId, subscription.id))).filter(r => r.kind === 'request-policy'), candidates = [{ evidence: subscription.targetEvidence, endpoints: subscription.endpoints }]; // NEW
        const located = await library.communitySource(identityId, subscription.diagramId), local = await located?.daemon.communities.garden({ shareId: subscription.shareId }); // NEW
        if (local?.proof) { // NEW
            const endpoints = local.proof.payload.deleted ? subscription.endpoints : await located.daemon.communities.endpoints({ shareId: subscription.shareId }); // NEW
            const policy = { kind: 'request-policy', evidence: local.proof, endpoints }; // NEW
            await immutable(path.join(requestDirectory(identityId, subscription.id), 'policy-' + communityHash(policy) + '.json'), policy); policies.push(policy); // NEW
        } // NEW
        for (const policy of policies) { try { verifyGardenEvidence(policy.evidence, subscription.targetAnchor); candidates.push(policy); } catch (_) { /* A participant cannot forge the coordinator's current policy. */ } } // NEW
        candidates.sort((a, b) => b.evidence.payload.revision - a.evidence.payload.revision); // NEW
        const latest = candidates[0], allowed = latest.evidence.payload.members.filter(m => m.manager).flatMap(m => m.devices); // NEW
        if (latest.evidence.payload.deleted) allowed.push({ deviceId: latest.evidence.payload.descriptor.coordinatorDeviceId, publicKey: latest.evidence.payload.descriptor.coordinatorPublicKey }); // NEW
        const requesterDevices = subscription.sourceEvidence.payload.members.find(m => m.identityId === subscription.requesterIdentityId)?.devices || []; // NEW
        const endpoints = [...new Map([...subscription.endpoints, ...latest.endpoints].filter(e => verifyRecord(e, e.payload.publicKey) && [...allowed, ...requesterDevices].some(d => d.deviceId === e.payload.deviceId && d.publicKey === e.payload.publicKey)).map(e => [e.payload.deviceId, e])).values()]; // NEW
        return endpoints; // NEW
    } // NEW
    async function discoverRequests(identityId, entry, current) { // NEW
        for (const marker of await records(path.join(directory(identityId, entry.id), 'requests'))) { // NEW
            try { // NEW
                const s = marker.payload.data; verifyGardenEvidence(s.sourceEvidence, s.sourceAnchor); // NEW
                if (!evidenceSigner(s.sourceEvidence, marker) || marker.payload.kind !== 'request-channel' || marker.payload.communityId !== entry.id || s.requesterIdentityId !== marker.payload.actorIdentityId || s.sourceEvidence.payload.binding?.communityId !== entry.id || !current.gardens.some(g => g.anchor.shareId === s.sourceAnchor.shareId && g.anchor.genesisCoordinatorPublicKey === s.sourceAnchor.genesisCoordinatorPublicKey)) continue; // CHANGE
                const garden = current.gardens.find(g => g.anchor.shareId === s.shareId && g.anchor.diagramId === s.diagramId); // NEW
                if (!garden || canonical(garden.anchor) !== canonical(s.targetAnchor)) continue; verifyGardenEvidence(s.targetEvidence, garden.anchor); // NEW
                const target = current.evidence.get(s.shareId)?.payload; // NEW
                if (marker.payload.actorIdentityId !== identityId && !target?.members.some(m => m.identityId === identityId && m.manager)) continue; // NEW
                await subscribe(identityId, { ...s, marker, communityId: entry.id }); // NEW
            } catch (_) { /* Unverifiable advertisements cannot configure folders. */ } // NEW
        } // NEW
    } // NEW
    async function requestAccess(input) { return run(async () => { // NEW
        const session = await own(), { entry, current } = await visible(session.identityId, input.communityId); // NEW
        const target = current.gardens.find(g => g.anchor.diagramId === input.diagramId); if (!target) throw new Error('Garden is not listed in this community.'); // NEW
        const existing = (await listRequestsInternal(session.identityId)).requests.find(r => r.diagramId === input.diagramId && r.requesterIdentityId === session.identityId && ['queued', 'waiting', 'pending'].includes(r.status)); if (existing) return { ok: true, id: existing.id, status: existing.status }; // NEW
        if (!Object.hasOwn(COMMUNITY_PRESETS, input.preset || 'gardener')) throw new Error('Choose a valid access role.'); // NEW
        const targetEvidence = current.evidence.get(target.anchor.shareId); // NEW
        if (targetEvidence.payload.members.some(m => m.identityId === session.identityId)) throw new Error('You already have garden access.'); // NEW
        const sourceEvidence = [...current.evidence.values()].find(p => p.payload.binding?.communityId === entry.id && p.payload.members.some(m => m.identityId === session.identityId)); // NEW
        const daemon = await identities.transport(session.identityId), ownEndpoint = await daemon.communities.endpoint(); // NEW
        const managers = targetEvidence.payload.members.filter(m => m.manager).flatMap(m => m.devices); // NEW
        const available = await records(path.join(directory(session.identityId, entry.id), 'endpoints')); // NEW
        const endpoints = [ownEndpoint, ...available.filter(e => managers.some(d => e.payload.deviceId === d.deviceId && verifyRecord(e, d.publicKey)))]; // NEW
        if (endpoints.length < 2) throw new Error('Garden managers have not published request endpoints yet. Refresh when a manager connects.'); // NEW
        const id = makeId(), request = await signed(session.identityId, current, 'access-request', { diagramId: target.anchor.diagramId, shareId: target.anchor.shareId, name: session.username, workerId: makeId(), preset: input.preset || 'gardener', note: communityText(input.note || '', 4000), devices: sourceEvidence.payload.members.find(m => m.identityId === session.identityId).devices }, id); // NEW
        if (!evidenceSigner(sourceEvidence, request)) throw new Error('This device must be approved on a community garden before requesting access.'); // NEW
        const sourceAnchor = current.gardens.find(g => g.anchor.shareId === sourceEvidence.payload.descriptor.shareId).anchor; // NEW
        const communityProof = { genesisHash: entry.genesisHash, records: current.accepted, evidence: await records(path.join(directory(session.identityId, entry.id), 'evidence')) }; // NEW
        const subscription = { id, requestHash: communityHash(request), diagramId: target.anchor.diagramId, shareId: target.anchor.shareId, gardenName: target.name, communityId: entry.id, endpoints, sourceEvidence, sourceAnchor, targetEvidence, targetAnchor: target.anchor, requesterIdentityId: session.identityId }; // CHANGE
        await subscribe(session.identityId, subscription); // NEW
        await send(session.identityId, subscription, { kind: 'request', request, communityProof }); // CHANGE: immutable evidence preserves eligibility for requests that outlive membership.
        const marker = await signed(session.identityId, current, 'request-channel', { ...subscription }, id + '-channel'); // NEW
        await immutable(path.join(directory(session.identityId, entry.id), 'requests', marker.payload.id + '.json'), marker); // NEW
        return { ok: true, id, status: 'queued' }; // NEW
    }); } // NEW
    async function archiveMessage(identityId, subscription, value) { // NEW
        if (identities.session()?.identityId !== identityId) return; // NEW
        const messageId = communityHash(value), folder = path.join(identities.metadataRoot(identityId), 'community-message-archives', safeId(subscription.id)), filename = path.join(folder, messageId + '.json'); // NEW
        if (await read(filename)) return; // NEW
        const envelope = await identities.communityArchive('seal', value, 'trellis-community-request:' + subscription.id + ':' + messageId), record = await identities.signAction('community-message-archive', { requestId: subscription.id, messageId, envelope }); // NEW
        if (record.payload.identityId !== identityId) throw new Error('The active identity changed while retaining a private request.'); // NEW
        await immutable(filename, record); // NEW
    } // NEW
    async function messages(identityId, subscription) { // NEW
        const daemon = await identities.transport(identityId), result = []; // NEW
        for (const record of await records(requestDirectory(identityId, subscription.id))) { // NEW
            try { // NEW
                const message = await daemon.communities.open(record, subscription.id); // NEW
                if (message && (message.kind !== 'request' || communityHash(message.request) === subscription.requestHash)) { await archiveMessage(identityId, subscription, message); result.push({ ...message, envelopeId: communityHash(message) }); } // CHANGE: inner signatures authorize messages; paired manager devices may have newer transport keys.
            } catch (_) { /* Corrupt messages never authorize garden access. */ } // NEW
        } // NEW
        if (identities.session()?.identityId === identityId) for (const archive of await library.verifiedRecords(identityId, path.join(identities.metadataRoot(identityId), 'community-message-archives', safeId(subscription.id)), [])) { // NEW
            try { // NEW
                const p = archive.payload; if (p.kind !== 'community-message-archive' || p.requestId !== subscription.id || result.some(m => m.envelopeId === p.messageId)) continue; // NEW
                const value = await identities.communityArchive('open', p.envelope, 'trellis-community-request:' + subscription.id + ':' + p.messageId); // NEW
                if (communityHash(value) === p.messageId && (value.kind !== 'request' || communityHash(value.request) === subscription.requestHash)) result.push({ ...value, envelopeId: p.messageId, archiveOnly: true }); // NEW
            } catch (_) { /* Invalid archives do not replace authentic peer messages. */ } // NEW
        } // NEW
        return result; // NEW
    } // NEW
    async function send(identityId, subscription, value) { // NEW
        const daemon = await identities.transport(identityId), record = await daemon.communities.seal(value, await requestRecipients(identityId, subscription), subscription.id); // CHANGE
        await immutable(path.join(requestDirectory(identityId, subscription.id), record.payload.id + '.json'), record); // NEW
        await archiveMessage(identityId, subscription, value); // NEW
    } // NEW
    /** Receipts must match the pinned garden chain; a request participant cannot mint a grant. */ // NEW
    function validResult(subscription, message) { // NEW
        try { // NEW
            if (message.kind !== 'result') return false; verifyGardenEvidence(message.evidence, subscription.targetAnchor); // NEW
            const p = message.receipt?.payload, evidence = message.evidence.payload; // NEW
            if (p?.schema !== COMMUNITY_VERSION || p.kind !== 'access-granted' || p.requestId !== subscription.id || !verifyRecord(message.receipt, evidence.descriptor.coordinatorPublicKey) || canonical(p.descriptor) !== canonical(evidence.descriptor)) return false; // NEW
            return p.status === 'unavailable' ? evidence.deleted === true : evidence.members.some(m => m.identityId === subscription.requesterIdentityId && m.userId === p.workerId); // NEW
        } catch (_) { return false; } // NEW
    } // NEW
    function validDecision(subscription, message) { // NEW
        try { const proof = message.decisionEvidence || subscription.targetEvidence; verifyGardenEvidence(proof, subscription.targetAnchor); return message.kind === 'decision' && message.decision?.payload?.data?.requestId === subscription.id && !!evidenceSigner(proof, message.decision)?.manager; } catch (_) { return false; } // NEW
    } // NEW
    function validReceived(subscription, message) { // NEW
        try { verifyGardenEvidence(message.evidence, subscription.targetAnchor); return message.kind === 'received' && message.receipt?.payload?.requestId === subscription.id && !!evidenceSigner(message.evidence, message.receipt)?.manager; } catch (_) { return false; } // NEW
    } // NEW
    async function decideAccess(input) { return run(async () => { // NEW
        const session = await own(), subscription = (await requestSubscriptions(session.identityId)).find(s => s.id === input.requestId); if (!subscription) throw new Error('Access request is unavailable.'); // NEW
        const all = await messages(session.identityId, subscription), request = all.find(m => m.kind === 'request')?.request; if (!request) throw new Error('Waiting for the access request to synchronize.'); // NEW
        if (all.some(m => validResult(subscription, m) || validDecision(subscription, m))) throw new Error('This request already has a decision.'); // CHANGE: forged participant messages cannot block an authorized decision.
        const located = await source(session.identityId, subscription.diagramId), scopes = input.scopes || []; // NEW
        if (input.approved && !Object.hasOwn(COMMUNITY_PRESETS, input.preset || request.payload.data.preset)) throw new Error('Choose a valid access role.'); // NEW
        if (input.approved && (!scopes.length || scopes.some(s => !located.info.scopes.some(c => c.id === s.id && c.pageId === (s.pageId || ''))))) throw new Error('Choose scopes you are authorized to manage.'); // NEW
        const proof = located.info.proof; if (!proof?.payload.members.some(m => m.identityId === session.identityId && m.manager)) throw new Error('Garden access-manager permission is required.'); // NEW
        const decision = await located.daemon.communities.sign({ schema: COMMUNITY_VERSION, id: makeId(), kind: 'access-decision', actorIdentityId: session.identityId, data: { requestId: input.requestId, shareId: subscription.shareId, approved: !!input.approved, preset: input.preset || request.payload.data.preset, scopes, note: communityText(input.note || '', 4000) } }); // NEW
        await send(session.identityId, subscription, { kind: 'decision', decision, decisionEvidence: proof }); await processRequests(session.identityId, []); // CHANGE
        return { ok: true, status: input.approved ? 'waiting' : 'denied' }; // NEW
    }); } // NEW
    async function processRequests(identityId, errors) { // NEW
        for (const subscription of await requestSubscriptions(identityId)) { // NEW
            try { // NEW
                await subscribe(identityId, subscription); const all = await messages(identityId, subscription), request = all.find(m => m.kind === 'request')?.request; // NEW
                if (!request || !evidenceSigner(subscription.sourceEvidence, request) || request.payload.id !== subscription.id) continue; // NEW
                const daemon = await identities.transport(identityId), localEndpoint = await daemon.communities.endpoint(); // NEW
                if (subscription.endpoints.some(e => e.payload.deviceId === localEndpoint.payload.deviceId)) for (const message of all.filter(m => m.archiveOnly)) { // NEW
                    const relayPath = path.join(privateArea(identityId), 'relayed', safeId(localEndpoint.payload.deviceId) + '-' + message.envelopeId + '.json'); // NEW
                    if (!await read(relayPath)) { const { envelopeId, archiveOnly, ...value } = message; await send(identityId, subscription, value); await immutable(relayPath, { ok: true }); } // NEW
                } // NEW
                const result = all.find(m => validResult(subscription, m)); // CHANGE
                if (result) { // NEW
                    const payload = result.receipt.payload; // NEW
                    if (payload.status !== 'unavailable' && identityId === subscription.requesterIdentityId) { // NEW
                        if (payload.community && payload.community.id === result.evidence.payload.binding?.communityId) await register(identityId, { ...payload.community, initialEvidence: [...(payload.community.initialEvidence || []), result.evidence] }); // NEW
                        if (identities.session()?.identityId === identityId) await library.acceptCommunityGrant(payload); // NEW
                    } // CHANGE
                    continue; // NEW
                } // NEW
                const located = await library.communitySource(identityId, subscription.diagramId); // NEW
                const info = await located?.daemon.communities.garden({ shareId: subscription.shareId }); // NEW
                if (info?.proof?.payload.members.some(m => m.identityId === identityId && m.manager) && !all.some(m => validReceived(subscription, m))) { // NEW
                    const receipt = await located.daemon.communities.sign({ schema: COMMUNITY_VERSION, kind: 'request-received', requestId: subscription.id, actorIdentityId: identityId }); // NEW
                    if (evidenceSigner(info.proof, receipt)?.manager) await send(identityId, subscription, { kind: 'received', receipt, evidence: info.proof }); // NEW
                } // NEW
                if (info?.proof?.payload.deleted) { // NEW
                    const receipt = await located.daemon.communities.sign({ schema: COMMUNITY_VERSION, kind: 'access-granted', requestId: subscription.id, status: 'unavailable', descriptor: info.proof.payload.descriptor }); // NEW
                    if (verifyRecord(receipt, info.proof.payload.descriptor.coordinatorPublicKey)) await send(identityId, subscription, { kind: 'result', receipt, evidence: info.proof }); // NEW
                    continue; // NEW
                } // NEW
                const decisions = all.filter(m => validDecision(subscription, m)).sort((a, b) => a.decision.payload.id < b.decision.payload.id ? -1 : 1); // CHANGE
                if (!decisions.length) continue; const decision = decisions[0].decision; // NEW
                const decisionEvidence = all.find(m => m.kind === 'decision' && m.decision === decision)?.decisionEvidence || subscription.targetEvidence; // NEW
                verifyGardenEvidence(decisionEvidence, subscription.targetAnchor); // NEW
                if (!evidenceSigner(decisionEvidence, decision)?.manager || !decision.payload.data.approved) continue; // CHANGE
                if (!located) continue; // CHANGE
                const grant = await located.daemon.communities.grant({ shareId: subscription.shareId, request, decision, communityProof: all.find(m => m.kind === 'request').communityProof, sourceEvidence: subscription.sourceEvidence, sourceAnchor: subscription.sourceAnchor }); // CHANGE
                if (!grant.ok) continue; // NEW
                const fresh = await located.daemon.communities.garden({ shareId: subscription.shareId }); // NEW
                const registration = (await registrations(identityId)).find(e => e.id === fresh.proof.payload.binding?.communityId); // NEW
                let community = null; // NEW
                if (registration) { const current = await state(identityId, registration); community = { id: registration.id, genesisHash: registration.genesisHash, genesis: registration.genesis, anchor: registration.anchor, initialRecords: current.accepted, initialEvidence: await records(path.join(directory(identityId, registration.id), 'evidence')) }; } // NEW
                const receipt = await located.daemon.communities.sign({ schema: COMMUNITY_VERSION, kind: 'access-granted', requestId: subscription.id, status: 'approved', descriptor: grant.descriptor, workerId: grant.workerId, community }); // CHANGE
                await send(identityId, subscription, { kind: 'result', receipt, evidence: fresh.proof }); // CHANGE
            } catch (error) { errors.push('Access request: ' + error.message); } // NEW
        } // NEW
    } // NEW
    async function listRequestsInternal(identityId) { // NEW
        const requests = []; // NEW
        for (const subscription of await requestSubscriptions(identityId)) { // NEW
            const all = await messages(identityId, subscription), request = all.find(m => m.kind === 'request')?.request; // NEW
            if (!request || !evidenceSigner(subscription.sourceEvidence, request)) continue; // NEW
            const decision = all.filter(m => validDecision(subscription, m)).sort((a, b) => a.decision.payload.id < b.decision.payload.id ? -1 : 1)[0]?.decision; // CHANGE
            const result = all.find(m => validResult(subscription, m)); // CHANGE
            let scopes = [], canDecide = false; // NEW
            if (identityId !== subscription.requesterIdentityId) { const located = await library.communitySource(identityId, subscription.diagramId); const info = await located?.daemon.communities.garden({ shareId: subscription.shareId, identityId, readOnly: true }).catch(() => null); scopes = info?.scopes || []; canDecide = scopes.length > 0 && !decision && !result; } // NEW
            requests.push({ id: subscription.id, communityId: subscription.communityId, diagramId: subscription.diagramId, gardenName: subscription.gardenName, requesterIdentityId: subscription.requesterIdentityId, requesterName: request.payload.data.name, note: request.payload.data.note, preset: request.payload.data.preset, status: result ? result.receipt.payload.status : decision ? decision.payload.data.approved ? 'waiting' : 'denied' : identityId === subscription.requesterIdentityId && !all.some(m => validReceived(subscription, m)) ? 'queued' : 'pending', decisionNote: decision?.payload.data.note || '', canDecide, scopes }); // CHANGE
        } // NEW
        return { ok: true, requests }; // NEW
    } // NEW
    /** Browsing reads verified completed state without waiting behind background mutations. */ // NEW
    async function listRequests() { const session = await own(), result = await listRequestsInternal(session.identityId); assertLogin(session); return result; } // CHANGE
    const loginKey = session => session ? session.identityId + ':' + session.generation : ''; // CHANGE
    function assertLogin(session) { if (loginKey(identities.session()) !== loginKey(session)) throw new Error('The active identity changed while loading garden metadata.'); } // CHANGE
    /** Window renderers own display snapshots; each explicit browse reads current verified state. */ // CHANGE
    async function list(input = {}) { // CHANGE
        const scope = input.scope; if (scope !== undefined && !['accessible', 'discovery'].includes(scope)) throw new Error('Unsupported garden community browsing scope.'); // CHANGE
        return readListing(await own(), scope); // CHANGE
    } // CHANGE
    async function readListing(session, scope) { // NEW
        const communities = []; // CHANGE: cached browsing must never wait for peer startup or garden scans.
        const transport = await identities.transport(session.identityId).catch(() => null); // NEW
        const telemetry = transport?.memberConnections?.(), reference = await Promise.resolve(library.getReferenceCity?.()).catch(() => null); // NEW
        for (const entry of await registrations(session.identityId)) { // NEW
            const current = await state(session.identityId, entry); if (current.archived || !current.members.has(session.identityId)) continue; // NEW
            const gardens = current.gardens.filter(g => scope !== 'accessible' || current.evidence.get(g.anchor.shareId)?.payload.members.some(m => m.identityId === session.identityId)).map(g => { // CHANGE // NEW
                const proof = current.evidence.get(g.anchor.shareId)?.payload; // NEW
                return { diagramId: g.anchor.diagramId, name: proof?.name || g.name, description: g.description, joined: !!proof?.members.some(m => m.identityId === session.identityId), canAdminister: !!proof?.members.some(m => m.identityId === session.identityId && m.admin), people: projectPeople(proof?.members, session.identityId, proof?.members.some(member => member.identityId === session.identityId) ? telemetry : null, proof?.userCount ?? proof?.members.length ?? null), moduleCities: proof?.moduleCities || [], gardenModuleCount: proof?.gardenModuleCount ?? null, locationsComplete: proof?.locationsComplete === true, distanceKm: nearestDistance(reference?.city, proof?.moduleCities) }; // NEW
            }); // NEW
            communities.push({ ...current.community, canAdminister: current.administrators.includes(session.identityId), administrators: current.administrators, automaticSuccessor: current.automaticSuccessor, gardens, admissions: current.administrators.includes(session.identityId) ? current.admissions.filter(a => a.status === 'pending').map(a => ({ id: a.record.payload.id, name: a.record.payload.data.evidence.payload.name, description: a.record.payload.data.description })) : [], memberIds: current.administrators.includes(session.identityId) ? [...current.members] : undefined }); // CHANGE
        } // NEW
        assertLogin(session); communities.sort((a, b) => a.name.localeCompare(b.name)); return { ok: true, communities, errors: warnings.get(session.identityId) || [] }; // NEW
    } // NEW
    return { list, create, update, addGarden, decideAdmission, detachGarden, describeGarden, setAdministrators, requestAccess, decideAccess, listRequests, refresh, onStatus: listener => { events.on('status', listener); return () => events.off('status', listener); } }; // NEW
} // NEW
