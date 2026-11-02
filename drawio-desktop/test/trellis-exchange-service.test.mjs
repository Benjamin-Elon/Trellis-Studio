import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import { createExchangeService } from '../src/main/trellis-exchange-service.js'; // NEW
function fixture() { // NEW
    let session = { identityId: 'alice', generation: 1 }; // NEW
    const calls = [], service = createExchangeService({ identities: { async requireSession() { if (!session) throw new Error('Log in'); }, session: () => session }, library: { async getReferenceCity() { return { city: { country: 'Canada' } }; } }, communities: { async list() { return { ok: true, communities: [] }; } }, rates: { async estimate(input) { calls.push(input); return { amount: 15 }; } }, coordinator: { async qualified() { throw new Error('Unqualified transport must not run'); } } }); // NEW
    return { service, calls, setSession: value => { session = value; } }; // NEW
} // NEW
test('unqualified production synchronization cannot publish, accept, or enumerate private agreement transport', async () => { // NEW
    const { service } = fixture(), status = await service.status(); // NEW
    assert.equal(status.currency, 'CAD'); assert.equal(status.qualified, false); // NEW
    for (const kind of ['offer.publish', 'trade.propose', 'trade.accept', 'trade.handover', 'csa.publish', 'csa.decide', 'message']) await assert.rejects(service.command({ kind, communityId: 'community', data: {}, qualified: true, receipts: { reservations: true } }), { code: 'EXCHANGE_NOT_QUALIFIED' }); // NEW
    const list = await service.list({ communityId: 'community' }); assert.deepEqual(list.discovery.offers, []); assert.deepEqual(list.threads, {}); // NEW
    await service.refresh(); // NEW
}); // NEW
test('bridge derives its identity from the current session and protects rate requests after logout', async () => { // NEW
    const f = fixture(); assert.deepEqual(await f.service.estimate({ base: 'USD', quote: 'CAD', amount: 10 }), { amount: 15 }); // NEW
    assert.equal(f.calls.length, 1); f.setSession(null); // NEW
    await assert.rejects(f.service.status(), /Log in/); await assert.rejects(f.service.estimate({ base: 'USD', quote: 'CAD', amount: 10 }), /Log in/); assert.equal(f.calls.length, 1); // NEW
}); // NEW
