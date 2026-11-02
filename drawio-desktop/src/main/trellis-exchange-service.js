/** Authenticated Exchange facade. The qualified coordinator owns transport and durable domain receipts. */ // NEW
import crypto from 'node:crypto'; // NEW
import { SYNC_PROTOCOL } from './trellis-share-protocol.js'; // NEW
import { countryCurrency } from './trellis-exchange-rates.js'; // NEW
const METHODS = new Set(['offer.publish', 'offer.withdraw', 'want.publish', 'want.withdraw', 'trade.propose', 'trade.accept', 'trade.cancel', 'trade.handover', 'trade.receive', 'csa.publish', 'csa.withdraw', 'csa.update', 'csa.request', 'csa.decide', 'csa.amend', 'csa.amend.accept', 'csa.revise', 'csa.collect', 'csa.end', 'message']); // CHANGE: operator term revisions are distinct from authoritative allocation refreshes.
const CLOSED = 'The Grand Exchange is awaiting qualified coordinator peer and community synchronization, garden authorization, and durable inventory reservation receipts.'; // NEW
const empty = () => ({ discovery: { offers: [], wants: [], programs: [] }, trades: [], programs: [], enrollments: [], threads: {}, inbox: [] }); // NEW
const id = value => { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new Error('Invalid Exchange identity.'); return value; }; // NEW
/** There is deliberately no parallel metadata journal or renderer-controlled readiness flag. */ // NEW
export function createExchangeService({ identities, library, communities, rates, coordinator }) { // NEW
    let queue = Promise.resolve(); // NEW
    async function own() { // NEW
        await identities.requireSession(); const session = identities.session(); if (!session) throw new Error('Log in to use The Grand Exchange.'); // NEW
        return { identityId: session.identityId, generation: session.generation }; // NEW
    } // NEW
    function unchanged(session) { // NEW
        const current = identities.session(); if (current?.identityId !== session.identityId || current.generation !== session.generation) throw new Error('Your identity changed. Reopen The Grand Exchange.'); // NEW
    } // NEW
    async function ready() { // NEW
        return SYNC_PROTOCOL.garden === 4 && SYNC_PROTOCOL.community === 2 && SYNC_PROTOCOL.capabilities.peerProposals && SYNC_PROTOCOL.capabilities.communities && !!coordinator && await coordinator.qualified() === true; // NEW
    } // NEW
    async function status() { // NEW
        const session = await own(), location = await library.getReferenceCity(), qualified = await ready(); unchanged(session); // NEW
        return { identityId: session.identityId, currency: countryCurrency(location?.city?.country), qualified, reason: qualified ? '' : CLOSED }; // NEW
    } // NEW
    async function list(input = {}) { // NEW
        const session = await own(), current = await status(); unchanged(session); // NEW
        if (!current.qualified) return { ...empty(), ...current, ...(input.communityId ? {} : await communities.list({ scope: 'accessible' })) }; // NEW
        if (!input.communityId) { const result = await communities.list({ scope: 'accessible' }); unchanged(session); return { ...empty(), ...result, ...current }; } // NEW
        const result = await coordinator.readExchange({ communityId: id(input.communityId), session }); unchanged(session); // NEW
        return { ...result, ...current }; // NEW
    } // NEW
    async function execute(input) { // NEW
        const session = await own(); // NEW
        if (!METHODS.has(input.kind)) throw new Error('Unsupported Exchange command.'); // NEW
        if (!await ready()) throw Object.assign(new Error(CLOSED), { code: 'EXCHANGE_NOT_QUALIFIED' }); // NEW
        if (input.actorIdentityId || input.authorization || input.receipts) throw new Error('Exchange authority is derived from the authenticated session.'); // NEW
        const operation = { id: input.operationId ? id(input.operationId) : crypto.randomUUID(), kind: input.kind, ...(input.target ? { target: id(input.target) } : {}), data: structuredClone(input.data || {}) }; // NEW
        unchanged(session); // NEW
        // commitExchange rechecks current community/garden authority and returns durable validation states. // NEW
        const result = await coordinator.commitExchange({ communityId: id(input.communityId), session, operation }); // NEW
        unchanged(session); // NEW
        if (!result || !['queued', 'delivered', 'awaiting-validation', 'accepted', 'resolved'].includes(result.state)) throw new Error('The coordinator did not return a validated Exchange result.'); // NEW
        return result; // NEW
    } // NEW
    function command(input) { const run = queue.then(() => execute(input)); queue = run.catch(() => {}); return run; } // NEW
    async function estimate(input) { const session = await own(), result = await rates.estimate(input); unchanged(session); return result; } // NEW
    async function refresh() { if (identities.session() && await ready()) return coordinator.refreshExchange(); } // NEW
    return { status, list, command, estimate, refresh, onStatus: listener => coordinator?.onExchangeStatus(listener) || (() => {}) }; // NEW
} // NEW
