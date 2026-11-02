import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import '../drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Seeds_Core.js'; // NEW
import '../drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Allocation_Core.js'; // NEW
import '../drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Exchange_Core.js'; // NEW
const E = globalThis.TrellisExchangeCore, A = globalThis.TrellisAllocationCore; // NEW
const source = { diagramId: 'private-source', pageId: 'page', gardenId: 'garden-a' }, receiving = { diagramId: 'private-receiver', pageId: 'page', gardenId: 'garden-b' }; // NEW
const at = Date.parse('2026-06-01T12:00:00Z'); let sequence = 0; // NEW
const context = (identityId = 'alice', overrides = {}) => ({ identityId, member: true, can: garden => E.sameGarden(garden, identityId === 'alice' ? source : receiving), operatorHasAccess: () => identityId === 'alice', operatorAuthorized: () => true, reservationsVerified: () => true, releaseVerified: () => true, inventoryReceiptVerified: () => true, capacityVerified: () => true, projectCsa: () => ({ sourceRevision: 'plan-1', supplyByDate: {} }), ...overrides }); // CHANGE: an arbitrary member is not the operator.
const apply = (state, kind, data = {}, target, actor = context()) => E.apply(state, { id: 'operation-' + ++sequence, at, kind, data, ...(target ? { target } : {}) }, actor); // NEW
const proposal = (id = 'trade', overrides = {}) => ({ id, parties: ['alice', 'bob'], lines: [{ from: source, to: receiving, cropRef: 'tomato', varietyRef: 'roma', seeds: 20 }], ...overrides }); // NEW
const program = () => ({ id: 'season', garden: source, year: 2026, name: 'Garden CSA', operator: 'alice', capacity: 1, start: '2026-06-01', end: '2026-06-29', weekday: 1, currency: 'USD', sizes: [{ id: 'half', multiplier: 0.5, price: 12 }, { id: 'base', multiplier: 1, price: 20 }], components: [{ cropKey: 'lettuce', qty: 1, unit: 'plant' }], pickup: { location: 'Private address', start: '16:00', end: '18:00' } }); // NEW
function acceptedTrade(overrides = {}) { // NEW
    let state = apply(E.empty(), 'trade.propose', proposal('trade', overrides)); // NEW
    state = apply(state, 'trade.accept', {}, 'trade', context('bob')); // NEW
    return apply(state, 'trade.commit', {}, 'trade'); // NEW
} // NEW
function acceptedShare() { // NEW
    let state = apply(E.empty(), 'csa.publish', program()); // NEW
    state = apply(state, 'csa.request', { id: 'share', programId: 'season', sizeId: 'half', count: 1 }, null, context('bob')); // NEW
    return apply(state, 'csa.decide', { accept: true }, 'share'); // NEW
} // NEW
test('a different request cannot overwrite an accepted enrollment or its private thread', () => { // NEW
    let state = acceptedShare(); state = apply(state, 'message', { text: 'Pickup arranged.' }, 'share', context('bob')); // NEW
    assert.throws(() => apply(state, 'csa.request', { id: 'share', programId: 'season', sizeId: 'base', count: 1 }, null, context('carol')), /identity.*use|already exists/i); // NEW
    assert.equal(state.enrollments.share.member, 'bob'); assert.equal(state.threads.share.length, 1); // NEW
}); // NEW
test('capacity updates cannot invalidate confirmed commitments', () => { // NEW
    const state = acceptedShare(); assert.throws(() => apply(state, 'csa.publish', { ...program(), capacity: 0.25 }), /capacity/i); // NEW
}); // NEW
test('repeated closure preserves its first effective date and emits no second event', () => { // NEW
    const ended = apply(acceptedShare(), 'csa.end', {}, 'season'); // NEW
    const repeated = E.apply(ended, { id: 'later-closure', kind: 'csa.end', target: 'season', at: at + 86400000, data: {} }, context()); // NEW
    assert.equal(repeated.programs.season.endedDate, ended.programs.season.endedDate); assert.equal(repeated.events.length, ended.events.length); // NEW
}); // NEW
test('public revisions reject hand-authored allocations and unchanged projections remain silent', () => { // NEW
    const state = acceptedShare(); assert.throws(() => apply(state, 'csa.revise', { distributions: {} }, 'season'), /projection|allocation/i); // NEW
    const projected = context('alice', { projectCsa: () => ({ sourceRevision: 'plan-1', supplyByDate: {} }) }); // NEW
    const first = apply(state, 'csa.revise', {}, 'season', projected), repeated = apply(first, 'csa.revise', {}, 'season', projected); // NEW
    assert.equal(repeated.events.length, first.events.length); // NEW
}); // NEW
test('operators revise future prices and calendars without member approval while retaining quote history', () => { // NEW
    const state = acceptedShare(), original = structuredClone(state.enrollments.share.acceptedTerms); // NEW
    const revised = apply(state, 'csa.update', { effectiveDate: '2026-06-15', terms: { end: '2026-06-22', sizes: [{ id: 'half', multiplier: 0.5, price: 15 }, { id: 'base', multiplier: 1, price: 25 }] }, notify: false }, 'season'); // NEW
    assert.equal(revised.enrollments.share.quote.amount, 54, 'two original pickups and two revised pickups'); // NEW
    assert.deepEqual(revised.enrollments.share.acceptedTerms, original); assert.equal(revised.enrollments.share.quoteHistory[0].quote.amount, 60); // NEW
    assert.equal(revised.events.length, state.events.length); assert.equal(revised.programs.season.termChanges[0].actor, 'alice'); // NEW
    assert.equal(A.programAt(revised.programs.season, '2026-06-08').sizes[0].price, 12); // NEW
    assert.equal(A.programAt(revised.programs.season, '2026-06-15').sizes[0].price, 15); // NEW
    assert.throws(() => apply(state, 'csa.update', { effectiveDate: '2026-06-15', terms: { currency: 'EUR' } }, 'season'), /Unsupported/); // NEW
    assert.throws(() => apply(state, 'csa.update', { effectiveDate: '2026-06-15', terms: { capacity: 0.1 } }, 'season'), /capacity/); // NEW
}); // NEW
test('first confirmed collection freezes the whole pickup while future expected allocations may change', () => { // NEW
    let state = acceptedShare(); state = apply(state, 'csa.request', { id: 'second', programId: 'season', sizeId: 'half', count: 1 }, null, context('carol')); state = apply(state, 'csa.decide', { accept: true }, 'second'); // NEW
    const projected = context('alice', { projectCsa: () => ({ sourceRevision: 'plan-a', supplyByDate: { '2026-06-01': { lettuce: 1 }, '2026-06-08': { lettuce: 1 } } }) }); // NEW
    state = apply(state, 'csa.revise', {}, 'season', projected); const original = structuredClone(state.programs.season.distributions['2026-06-01']); // NEW
    state = apply(state, 'csa.collect', { date: '2026-06-01', confirm: true }, 'share'); // NEW
    state = apply(state, 'csa.revise', {}, 'season', context('alice', { projectCsa: () => ({ sourceRevision: 'plan-b', supplyByDate: {} }) })); // NEW
    assert.deepEqual(state.programs.season.distributions['2026-06-01'], original); // NEW
    assert.equal(state.programs.season.distributions['2026-06-08'].items[0].allocations.reduce((sum, row) => sum + row.allocated, 0), 0); // NEW
}); // NEW
test('publishing private-garden offers needs seed authority and exposes no private pickup details', () => { // NEW
    const data = { id: 'offer', garden: source, cropRef: 'tomato', varietyRef: 'roma', seeds: 100, terms: { kind: 'gift' }, pickup: 'Home address' }; // NEW
    const state = apply(E.empty(), 'offer.publish', data); // NEW
    assert.equal(state.offers.offer.garden.diagramId, 'private-source'); assert.equal(E.discovery(state).offers[0].pickup, undefined); // NEW
    assert.throws(() => apply(state, 'offer.withdraw', {}, 'offer', context('bob', { communityAdmin: true, can: () => false })), /access/); // NEW
    assert.throws(() => apply(E.empty(), 'offer.publish', data, null, context('alice', { member: false })), /membership/); // NEW
}); // NEW
test('acceptance remains pending until both parties approve and every reservation is validated', () => { // NEW
    const proposed = apply(E.empty(), 'trade.propose', proposal()); // NEW
    const oneParty = apply(proposed, 'trade.accept', {}, 'trade'); // NEW
    assert.throws(() => apply(oneParty, 'trade.commit', {}, 'trade'), /Both participants/); // NEW
    const pending = apply(proposed, 'trade.accept', {}, 'trade', context('bob')); // NEW
    assert.equal(pending.trades.trade.status, 'awaiting-validation'); // NEW
    assert.throws(() => apply(pending, 'trade.commit', {}, 'trade', context('alice', { reservationsVerified: () => false })), /durable reservations/); // NEW
    assert.equal(apply(pending, 'trade.commit', {}, 'trade').trades.trade.status, 'accepted'); // NEW
}); // NEW
test('partial fulfillment counts receipts once and competing commitments cannot exceed the request', () => { // NEW
    let state = apply(E.empty(), 'want.publish', { id: 'wanted', garden: receiving, cropRef: 'tomato', varietyRef: 'roma', seeds: 30 }, null, context('bob')); // NEW
    for (const id of ['first', 'second']) { state = apply(state, 'trade.propose', proposal(id, { wantId: 'wanted' })); state = apply(state, 'trade.accept', {}, id, context('bob')); } // NEW
    assert.equal(E.matches(state, state.wants.wanted).committed, 0); // NEW
    state = apply(state, 'trade.commit', {}, 'first'); // NEW
    assert.throws(() => apply(state, 'trade.commit', {}, 'second'), /remaining request/); // NEW
    assert.equal(E.matches(state, state.wants.wanted).remaining, 10); // NEW
    state = apply(state, 'trade.handover', { line: 0 }, 'first'); state = apply(state, 'trade.receive', { line: 0 }, 'first', context('bob')); // NEW
    const match = E.matches(state, state.wants.wanted); assert.equal(match.received, 20); assert.equal(match.committed, 0); assert.equal(match.remaining, 10); // NEW
}); // NEW
test('same-crop variety substitutions are suggested after exact matches and need explicit approval', () => { // NEW
    let state = apply(E.empty(), 'want.publish', { id: 'wanted', garden: receiving, cropRef: 'tomato', varietyRef: 'roma', seeds: 30 }, null, context('bob')); // NEW
    for (const [id, varietyRef] of [['other', 'cherry'], ['exact', 'roma']]) state = apply(state, 'offer.publish', { id, garden: source, cropRef: 'tomato', varietyRef, seeds: 50, terms: { kind: 'gift' } }); // NEW
    assert.deepEqual(E.matches(state, state.wants.wanted).offers.map(row => [row.id, row.substitution]), [['exact', false], ['other', true]]); // NEW
    const trade = proposal('trade', { wantId: 'wanted' }); trade.lines[0].varietyRef = 'cherry'; // NEW
    state = apply(state, 'trade.propose', trade); state = apply(state, 'trade.accept', {}, 'trade', context('bob')); // NEW
    assert.throws(() => apply(state, 'trade.commit', {}, 'trade'), /substitution/); // NEW
}); // NEW
test('handover prevents untouched cancellation; repeated receipts are silent and source currency is fixed', () => { // NEW
    let state = acceptedTrade({ price: { amount: 12, currency: 'USD' } }); // NEW
    state = apply(state, 'trade.handover', { line: 0 }, 'trade'); // NEW
    assert.throws(() => apply(state, 'trade.cancel', {}, 'trade'), /Handover/); // NEW
    state = apply(state, 'trade.receive', { line: 0 }, 'trade', context('bob')); // NEW
    const repeated = apply(state, 'trade.receive', { line: 0 }, 'trade', context('bob')); // NEW
    assert.equal(repeated.events.length, state.events.length); assert.equal(repeated.trades.trade.status, 'completed'); assert.deepEqual(repeated.trades.trade.price, { amount: 12, currency: 'USD' }); // NEW
}); // NEW
test('membership departure preserves existing cancellation and private agreement coordination', () => { // NEW
    const actor = context('alice', { member: false }); let state = acceptedTrade(); // NEW
    state = apply(state, 'message', { text: 'We can finish the handover tomorrow.' }, 'trade', actor); // NEW
    assert.equal(state.threads.trade.length, 1); state = apply(state, 'trade.cancel', {}, 'trade', actor); assert.equal(state.trades.trade.status, 'cancelled'); // NEW
    assert.throws(() => apply(state, 'trade.propose', proposal('new'), null, actor), /membership/); // NEW
}); // NEW
test('CSA publication is stricter than routine management and rejects reopened seasons and mixed units', () => { // NEW
    assert.throws(() => apply(E.empty(), 'csa.publish', program(), null, context('alice', { can: (_garden, capability) => capability === 'manage_csa' })), /publish_csa/); // NEW
    const mixed = program(); mixed.components.push({ cropKey: 'lettuce', qty: 1, unit: 'kg' }); assert.throws(() => apply(E.empty(), 'csa.publish', mixed), /consistent base unit/); // NEW
    let state = apply(E.empty(), 'csa.publish', program()); state = apply(state, 'csa.end', {}, 'season'); // NEW
    assert.throws(() => apply(state, 'csa.publish', program()), /ended program/); // NEW
}); // NEW
test('share sizes use base equivalents and capacity checks reject a second competing acceptance', () => { // NEW
    let state = acceptedShare(); assert.equal(state.enrollments.share.quote.amount, 60); // NEW
    state = apply(state, 'csa.request', { id: 'large', programId: 'season', sizeId: 'base', count: 1 }, null, context('carol')); // NEW
    assert.throws(() => apply(state, 'csa.decide', { accept: true }, 'large'), /capacity exceeded/); // NEW
    const pending = apply(apply(E.empty(), 'csa.publish', program()), 'csa.request', { id: 'share', programId: 'season', sizeId: 'half', count: 1 }, null, context('bob')); // NEW
    assert.throws(() => apply(pending, 'csa.decide', { accept: true }, 'share', context('alice', { capacityVerified: () => false })), /capacity confirmation/); // NEW
}); // NEW
test('member cancellation requests require operator approval and preserve earlier distributions', () => { // CHANGE
    let state = acceptedShare(); const original = structuredClone(state.enrollments.share.acceptedTerms); // NEW
    state = apply(state, 'csa.amend', { effectiveDate: '2026-06-15', cancel: true, contribution: 'Settle prior collections outside Trellis.' }, 'share', context('bob')); // NEW
    state = apply(state, 'csa.amend.accept', {}, 'share'); // NEW
    const member = state.enrollments.share; assert.deepEqual(member.acceptedTerms, original); assert.equal(member.changes[0].quote.amount, 0); assert.equal(member.changes[0].replaces.amount, 36); assert.equal(member.changes[0].priceDifference, -36); // NEW // NEW
    assert.equal(A.enrollmentAt(member, '2026-06-08').cancel, undefined); assert.equal(A.enrollmentAt(member, '2026-06-15').cancel, true); // NEW
    const supply = Object.fromEntries(A.pickupDates(program().start, program().end, 1).map(day => [day, { lettuce: 10 }])); // NEW
    const schedule = A.schedule(program(), supply, [member]); assert.equal(schedule[1].items[0].allocations.length, 1); assert.equal(schedule[2].items[0].allocations.length, 0); // NEW
    assert.throws(() => apply(state, 'csa.amend', { effectiveDate: '2026-05-30', sizeId: 'base' }, 'share', context('bob')), /future effective date/); // NEW
}); // NEW
test('operators change future enrollment terms directly and may suppress the announcement', () => { // NEW
    const state = acceptedShare(), revised = apply(state, 'csa.amend', { effectiveDate: '2026-06-15', distributionPrice: 9, notify: false }, 'share'); // NEW
    assert.equal(revised.enrollments.share.amendment, undefined); assert.equal(revised.enrollments.share.changes[0].distributionPrice, 9); // NEW
    assert.equal(revised.enrollments.share.quote.amount, 51); assert.equal(revised.enrollments.share.acceptedTerms.quote.amount, 60); // NEW
    assert.equal(revised.events.length, state.events.length); // NEW
}); // NEW
test('members report collections, operators confirm, and completed distributions remain immutable', () => { // NEW
    let state = acceptedShare(); // CHANGE
    const projected = context('alice', { projectCsa: () => ({ sourceRevision: 'plan-1', supplyByDate: { '2026-06-01': { lettuce: 1 } } }) }); // NEW
    state = apply(state, 'csa.revise', {}, 'season', projected); const distribution = state.programs.season.distributions['2026-06-01']; // CHANGE
    state = apply(state, 'csa.collect', { date: '2026-06-01' }, 'share', context('bob')); assert.equal(state.programs.season.collections['share:2026-06-01'], 'reported'); // NEW
    assert.throws(() => apply(state, 'csa.collect', { date: '2026-06-01', confirm: true }, 'share', context('bob', { can: () => false })), /operator confirms/); // NEW
    state = apply(state, 'csa.collect', { date: '2026-06-01', confirm: true }, 'share'); // NEW
    assert.deepEqual(state.programs.season.completed['2026-06-01'], distribution); // NEW
    state = apply(state, 'csa.revise', {}, 'season', context('alice', { projectCsa: () => ({ sourceRevision: 'plan-2', supplyByDate: {} }) })); // NEW
    assert.deepEqual(state.programs.season.distributions['2026-06-01'], distribution); // CHANGE
    assert.throws(() => apply(state, 'csa.revise', { distributions: {} }, 'season'), /projection/); // CHANGE
}); // NEW
test('operator departure ends future pickups while retaining private settlement history', () => { // NEW
    let state = acceptedShare(); state = apply(state, 'csa.end', {}, 'season', context('observer', { can: () => false, operatorDepartureVerified: () => true })); // NEW
    assert.equal(state.programs.season.status, 'ended'); assert.equal(E.discovery(state).programs.length, 0); // NEW
    assert.throws(() => apply(state, 'csa.collect', { date: '2026-06-08' }, 'share', context('bob')), /No allocation/); // NEW
    state = apply(state, 'message', { text: 'Please settle the outstanding contribution.' }, 'share', context('alice', { can: () => false, member: false, operatorHasAccess: () => false })); assert.equal(state.threads.share.length, 1); // NEW
}); // NEW
