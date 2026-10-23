/** Signed community directories. Garden coordinators attest access; community roles never grant it. */ // NEW
import { canonical, digest, safeId, verifyRecord } from './trellis-share-protocol.js'; // NEW
import { cityRecord } from './trellis-project-summary.js'; // NEW

export const COMMUNITY_VERSION = 1; // NEW
export const COMMUNITY_PRESETS = Object.freeze({ visitor: [], gardener: ['create_plantings', 'manage_own_plantings', 'move_tasks', 'edit_task_details'], coordinator: ['create_plantings', 'manage_own_plantings', 'move_tasks', 'edit_task_details', 'manage_scope_content', 'manage_access'] }); // NEW
export const communityHash = record => digest(canonical(record)); // NEW
export function communityText(value, maximum, required = false) { // NEW
    if (typeof value !== 'string' || value.length > maximum || required && !value.trim()) throw new Error('Enter valid community details.'); // NEW
    return value.trim(); // NEW
} // NEW

/** Verify every coordinator transition from the project's pinned genesis key. */ // NEW
export function verifyGardenEvidence(record, anchor) { // NEW
    const p = record?.payload, descriptor = p?.descriptor; // NEW
    if (p?.schema !== COMMUNITY_VERSION || p.kind !== 'garden-evidence' || !descriptor || descriptor.shareId !== anchor.shareId || descriptor.diagramId !== anchor.diagramId || !Number.isSafeInteger(p.revision) || p.revision < 1 || !Array.isArray(p.members)) throw new Error('Invalid garden eligibility evidence.'); // NEW
    safeId(descriptor.shareId); safeId(descriptor.diagramId); // NEW
    let key = anchor.genesisCoordinatorPublicKey || anchor.coordinatorPublicKey, version = 0, members = []; // NEW
    for (const membership of p.membership || []) { // NEW
        const m = membership.payload; // NEW
        if (m.shareId !== descriptor.shareId || m.diagramId !== descriptor.diagramId || m.version !== version + 1 || !verifyRecord(membership, key)) throw new Error('Invalid garden coordinator chain.'); // NEW
        version = m.version; members = m.members; // NEW
        if (m.nextCoordinator) { if (!members.some(d => d.deviceId === m.nextCoordinator.deviceId && d.publicKey === m.nextCoordinator.publicKey)) throw new Error('Invalid coordinator successor.'); key = m.nextCoordinator.publicKey; } // NEW
    } // NEW
    if (!version || descriptor.membershipVersion !== version || descriptor.coordinatorPublicKey !== key || !verifyRecord(record, key)) throw new Error('Garden evidence is not signed by its coordinator.'); // NEW
    const identities = new Set(); // NEW
    if (p.userCount !== undefined && (!Number.isSafeInteger(p.userCount) || p.userCount < p.members.length)) throw new Error('Invalid garden member count.'); // NEW
    if (p.moduleCities !== undefined && (!Array.isArray(p.moduleCities) || !Number.isSafeInteger(p.gardenModuleCount) || p.gardenModuleCount < p.moduleCities.length || typeof p.locationsComplete !== 'boolean' || p.locationsComplete !== (p.moduleCities.length === p.gardenModuleCount) || p.moduleCities.some(city => !cityRecord(city)?.cityId))) throw new Error('Invalid garden location summary.'); // NEW
    for (const member of p.members) { // NEW
        safeId(member.identityId); safeId(member.userId); // NEW
        if (identities.has(member.identityId) || !Array.isArray(member.devices)) throw new Error('Duplicate or invalid garden identity.'); // NEW
        identities.add(member.identityId); // NEW
        for (const device of member.devices) if (!members.some(d => d.deviceId === device.deviceId && d.publicKey === device.publicKey && d.userId === member.userId)) throw new Error('Unapproved garden device in eligibility evidence.'); // NEW
    } // NEW
    return p; // NEW
} // NEW

export function evidenceSigner(evidence, record, admin = false) { // NEW
    const p = record?.payload; // NEW
    const member = evidence?.payload?.members.find(m => m.identityId === p?.actorIdentityId && (!admin || m.admin)); // NEW
    const device = member?.devices.find(d => d.deviceId === p.authorDeviceId); // NEW
    return device && verifyRecord(record, device.publicKey) ? member : null; // NEW
} // NEW

/** Causal order is independent of arrival order and local wall clocks. */ // NEW
export function orderedCommunityRecords(records) { // NEW
    const unique = new Map(), rejected = [], ordered = [], done = new Set(); // NEW
    for (const record of records) { // NEW
        const p = record?.payload; // NEW
        try { // NEW
            safeId(p.id); safeId(p.communityId); // NEW
            if (p.schema !== COMMUNITY_VERSION || !Number.isSafeInteger(p.clock) || p.clock < 1 || !Array.isArray(p.parents) || p.parents.some(id => typeof id !== 'string') || unique.has(p.id) && canonical(unique.get(p.id)) !== canonical(record)) throw new Error('Invalid community record.'); // NEW
            unique.set(p.id, record); // NEW
        } catch (error) { rejected.push({ id: p?.id, reason: error.message }); } // NEW
    } // NEW
    const pending = [...unique.values()].sort((a, b) => a.payload.clock - b.payload.clock || compareIds(a.payload.id, b.payload.id)); // NEW
    for (const record of pending) { // NEW
        const p = record.payload; // NEW
        if (p.parents.every(id => done.has(id) && unique.get(id).payload.clock < p.clock)) { ordered.push(record); done.add(p.id); } // NEW
    } // NEW
    return { ordered, pending: pending.filter(r => !done.has(r.payload.id)), rejected }; // NEW
} // NEW
export function compareIds(a, b) { return a < b ? -1 : a > b ? 1 : 0; } // NEW

/** Replay only authorized changes. Invalid parents cannot lend authority to their children. */ // NEW
export function reduceCommunity(records, genesisHash, evidenceRecords = []) { // NEW
    const sorted = orderedCommunityRecords(records), accepted = [], rejected = [...sorted.rejected], evidence = new Map(), gardens = new Map(), admissions = new Map(), proofIndex = new Map(evidenceRecords.map(r => [communityHash(r), r])); // CHANGE
    let community = null, administrators = [], automaticSuccessor = null; // NEW
    const installEvidence = (record, anchor) => { // NEW
        const previous = evidence.get(anchor.shareId); // NEW
        if (previous === record) return; // NEW
        verifyGardenEvidence(record, anchor); // CHANGE
        if (!previous || record.payload.revision > previous.payload.revision || record.payload.revision === previous.payload.revision && compareIds(communityHash(record), communityHash(previous)) > 0) evidence.set(anchor.shareId, record); // NEW
    }; // NEW
    const refreshEvidence = () => { for (const garden of gardens.values()) for (const record of evidenceRecords.filter(r => r?.payload?.descriptor?.shareId === garden.anchor.shareId)) { try { installEvidence(record, garden.anchor); } catch (_) { /* Invalid evidence cannot change eligibility. */ } } }; // NEW
    const associated = (garden, proof) => proof?.binding?.communityId === community?.id && proof.binding.generation === garden.bindingGeneration; // NEW
    const memberIdentities = () => new Set([...gardens.values()].filter(g => associated(g, evidence.get(g.anchor.shareId)?.payload)).flatMap(g => evidence.get(g.anchor.shareId)?.payload.members.map(m => m.identityId) || [])); // CHANGE
    function eligibleAdministrators() { // NEW
        const members = memberIdentities(), eligible = administrators.filter(id => members.has(id)); // NEW
        if (eligible.length) return eligible; // NEW
        const candidates = [...gardens.values()].sort((a, b) => a.order - b.order || compareIds(a.anchor.diagramId, b.anchor.diagramId)); // NEW
        for (const garden of candidates) { // NEW
            const proof = evidence.get(garden.anchor.shareId)?.payload; // NEW
            if (!associated(garden, proof)) continue; // CHANGE
            const ids = proof.members.filter(m => m.admin).map(m => m.identityId).sort(compareIds); // NEW
            if (ids.length) { automaticSuccessor = ids[0]; return [ids[0]]; } // NEW
        } // NEW
        return []; // NEW
    } // NEW
    function signedMember(record, admin = false) { // NEW
        return [...gardens.values()].some(g => { // NEW
            const proof = evidence.get(g.anchor.shareId); // NEW
            if (!associated(g, proof?.payload) || !evidenceSigner(proof, record, admin)) return false; // CHANGE
            let latest = proof; // NEW
            for (const candidate of evidenceRecords.filter(r => r?.payload?.descriptor?.shareId === g.anchor.shareId && r.payload.revision > latest.payload.revision)) { try { verifyGardenEvidence(candidate, g.anchor); latest = candidate; } catch (_) { /* Ignore untrusted revocations. */ } } // NEW
            if (associated(g, latest.payload) && latest.payload.members.some(m => m.identityId === record.payload.actorIdentityId && m.devices.some(d => d.deviceId === record.payload.authorDeviceId))) return true; // CHANGE
            const cutoff = latest.payload.retiredSigners?.find(r => r.communityId === community.id && r.identityId === record.payload.actorIdentityId && r.deviceId === record.payload.authorDeviceId); // NEW
            return !!cutoff?.recordIds.includes(record.payload.id); // CHANGE
        }); // NEW
    } // NEW
    for (const record of sorted.ordered) { // NEW
        const p = record.payload, d = p.data || {}; // NEW
        try { // NEW
            if (p.parents.some(id => !accepted.some(r => r.payload.id === id))) throw new Error('Community predecessor was rejected.'); // NEW
            if (!community) { // NEW
                if (p.kind !== 'create' || p.parents.length || communityHash(record) !== genesisHash) throw new Error('Community genesis does not match its garden invitation.'); // NEW
                const proof = verifyGardenEvidence(d.evidence, d.anchor); // NEW
                if (proof.binding?.communityId !== p.communityId || !evidenceSigner(d.evidence, record, true)) throw new Error('Create a community with a garden you administer.'); // NEW
                community = { id: p.communityId, name: communityText(d.name, 120, true), description: communityText(d.description || '', 1000) }; // NEW
                administrators = [p.actorIdentityId]; installEvidence(d.evidence, d.anchor); // NEW
                gardens.set(d.anchor.diagramId, { anchor: d.anchor, bindingGeneration: proof.binding.generation, name: proof.name, description: d.gardenDescription || '', order: p.clock }); // CHANGE
            } else { // NEW
                if (p.communityId !== community.id) throw new Error('Community identifier mismatch.'); // NEW
                for (const hash of p.evidenceHashes || []) { const proof = proofIndex.get(hash), garden = [...gardens.values()].find(g => g.anchor.shareId === proof?.payload?.descriptor?.shareId); if (!proof || !garden) throw new Error('Missing community eligibility predecessor.'); installEvidence(proof, garden.anchor); } // NEW
                const admins = eligibleAdministrators(), isAdmin = admins.includes(p.actorIdentityId) && signedMember(record); // NEW
                if (p.kind === 'admission') { // NEW
                    verifyGardenEvidence(d.evidence, d.anchor); // NEW
                    if (d.evidence.payload.binding?.communityId !== community.id || !evidenceSigner(d.evidence, record, true)) throw new Error('Garden administrator approval is required.'); // NEW
                    if (gardens.has(d.anchor.diagramId) || [...admissions.values()].some(a => a.status === 'pending' && a.record.payload.data.anchor.diagramId === d.anchor.diagramId)) throw new Error('This garden already has an association or pending admission.'); // NEW
                    admissions.set(p.id, { record, status: 'pending' }); // NEW
                } else if (p.kind === 'admit' || p.kind === 'deny-admission') { // NEW
                    const admission = admissions.get(d.admissionId); // NEW
                    if (!isAdmin || !admission || admission.status !== 'pending') throw new Error('Community administrator approval is required.'); // NEW
                    admission.status = p.kind === 'admit' ? 'approved' : 'denied'; // NEW
                    if (p.kind === 'admit') { // NEW
                        const source = admission.record.payload.data; installEvidence(source.evidence, source.anchor); // NEW
                        gardens.set(source.anchor.diagramId, { anchor: source.anchor, bindingGeneration: source.evidence.payload.binding.generation, name: source.evidence.payload.name, description: communityText(source.description || '', 1000), order: p.clock }); // CHANGE
                    } // NEW
                } else if (p.kind === 'detach') { // NEW
                    const garden = gardens.get(d.diagramId); // NEW
                    const pending = [...admissions.values()].find(a => a.status === 'pending' && a.record.payload.data.anchor.diagramId === d.diagramId); // NEW
                    if (!garden && pending && evidenceSigner(pending.record.payload.data.evidence, record, true)) pending.status = 'withdrawn'; // NEW
                    else { if (!garden || !isAdmin && !evidenceSigner(evidence.get(garden.anchor.shareId), record, true)) throw new Error('A garden or community administrator must detach this garden.'); gardens.delete(d.diagramId); } // CHANGE
                } else if (p.kind === 'details') { // NEW
                    if (!isAdmin) throw new Error('Community administrator access is required.'); // NEW
                    community.name = communityText(d.name, 120, true); community.description = communityText(d.description || '', 1000); // NEW
                } else if (p.kind === 'administrators') { // NEW
                    const members = memberIdentities(); // NEW
                    if (!isAdmin || !Array.isArray(d.identityIds) || !d.identityIds.length || d.identityIds.some(id => !members.has(id))) throw new Error('Choose current community members as administrators.'); // NEW
                    administrators = [...new Set(d.identityIds)].sort(compareIds); // NEW
                } else if (p.kind === 'garden-description') { // NEW
                    const garden = gardens.get(d.diagramId); // NEW
                    if (!garden || !evidenceSigner(evidence.get(garden.anchor.shareId), record, true)) throw new Error('Garden administrator access is required.'); // NEW
                    garden.description = communityText(d.description || '', 1000); // NEW
                } else throw new Error('Unsupported community operation.'); // NEW
            } // NEW
            accepted.push(record); // NEW
        } catch (error) { rejected.push({ id: p.id, reason: error.message }); } // NEW
    } // NEW
    refreshEvidence(); // NEW
    const members = memberIdentities(), effectiveAdmins = eligibleAdministrators(); // NEW
    const activeGardens = [...gardens.values()].filter(g => { const p = evidence.get(g.anchor.shareId)?.payload; return !p?.deleted && associated(g, p); }); // CHANGE
    const referenced = new Set(accepted.flatMap(r => r.payload.parents)); // NEW
    return { community, gardens: activeGardens, admissions: [...admissions.values()], evidence, members, administrators: effectiveAdmins, automaticSuccessor, archived: !!community && !activeGardens.length, accepted, heads: accepted.filter(r => !referenced.has(r.payload.id)).map(r => r.payload.id), clock: accepted.reduce((n, r) => Math.max(n, r.payload.clock), 0), rejected, pending: sorted.pending }; // NEW
} // NEW
