import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import '../drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Seeds_Core.js'; // NEW
import '../drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Allocation_Core.js'; // NEW
const S = globalThis.TrellisSeedsCore, A = globalThis.TrellisAllocationCore; // NEW
const crop = { cropRef: 'tomato', varietyRef: 'roma' }; // NEW
const stock = (seeds = 100) => S.normalize({ version: 1, items: [{ ...crop, seeds }], initialized: true }); // NEW
const complete = (revision = 1, completed = true, seeds = 20) => ({ ...crop, id: 'sowing:1', year: 2026, revision, completed, seeds }); // NEW
test('seed conversions require estimates for weight and packets', () => { // NEW
    assert.equal(S.counts(2.5, { unit: 'g', seedsPerUnit: 12 }), 30); // NEW
    assert.equal(S.counts(3, { unit: 'packet', seedsPerUnit: 25 }), 75); // NEW
    assert.throws(() => S.normalize({ version: 1, items: [{ ...crop, seeds: 10, unit: 'packet' }] }), /seeds per unit/); // NEW
    assert.throws(() => S.normalize({ version: 1, items: [{ ...crop, seeds: 10 }, { ...crop, seeds: 5 }] }), /one balance/); // NEW
}); // NEW
test('current-stock initialization baselines historical work; reopening and recompleting remain reversible', () => { // NEW
    const initial = S.initialize({ ...stock(), initialized: false }, [complete()]); // NEW
    assert.equal(initial.items[0].seeds, 100); // NEW
    const reopened = S.usage(initial, complete(2, false)); // NEW
    assert.equal(reopened.items[0].seeds, 120); // NEW
    assert.equal(S.usage(reopened, complete(3)).items[0].seeds, 100); // NEW
    assert.deepEqual(S.initialize(initial, [complete()]), initial); // NEW
}); // NEW
test('sowing completion survives repeated delivery, restart, reopen and corrected recompletion', () => { // NEW
    let state = S.usage(stock(), complete()); // NEW
    assert.equal(state.items[0].seeds, 80); // NEW
    state = S.usage(JSON.parse(JSON.stringify(state)), complete()); // NEW
    assert.equal(state.items[0].seeds, 80); // NEW
    state = S.usage(state, complete(2, false)); // NEW
    assert.equal(state.items[0].seeds, 100); // NEW
    state = S.usage(state, complete(3, true, 25)); // NEW
    assert.equal(state.items[0].seeds, 75); // NEW
    assert.equal(S.usage(state, complete()).items[0].seeds, 75); // NEW
    assert.throws(() => S.usage(state, complete(3, true, 30)), /Conflicting/); // NEW
}); // NEW
test('negative balances are retained and shortages remain visible', () => { // NEW
    const state = S.usage(stock(5), complete()); // NEW
    assert.equal(state.items[0].seeds, -15); // NEW
    assert.equal(S.availability(state)[0].shortage, 15); // NEW
}); // NEW
test('unknown plan protection is explicit in read-only views and strict accounting still rejects unmapped plans', () => { // NEW
    const plans = { 2026: { year: 2026, crops: [{ plantId: 'unmapped', seedsReq: 30 }] } }, current = stock(); // NEW
    const view = S.planningStatus(current, plans); // NEW
    assert.equal(view.protectionKnown, false); assert.equal(view.availability[0].seeds, 100); // NEW
    assert.equal(view.availability[0].planned, null); assert.equal(view.availability[0].available, null); // NEW
    assert.match(view.warnings[0], /protection is unavailable/); assert.throws(() => S.requirements(plans, current), /portable reference/); // NEW
    assert.equal(S.planningStatus(current, {}).protectionKnown, true); // NEW
}); // NEW
test('published needs aggregate growth stages before subtracting completed work once', () => { // NEW
    const state = S.usage(stock(), complete()); // NEW
    const needs = S.requirements({ 2026: { year: 2026, crops: [{ ...crop, seedsReq: 30 }, { ...crop, seedsReq: 40 }] }, 2027: { year: 2027, crops: [{ ...crop, seedsReq: 10 }] } }, state); // NEW
    assert.equal(needs[S.key(crop)], 60); // NEW
    assert.equal(S.availability(state, needs)[0].available, 20); // NEW
    assert.throws(() => S.reserve(state, 'trade', [{ ...crop, seeds: 21 }], needs), /published plan/); // NEW
}); // NEW
test('competing acceptances cannot reserve protected or already reserved stock', () => { // NEW
    const first = S.reserve(stock(), 'first', [{ ...crop, seeds: 60 }]); // NEW
    assert.throws(() => S.reserve(first, 'second', [{ ...crop, seeds: 41 }]), /published plan/); // NEW
    assert.deepEqual(S.reserve(first, 'first', [{ ...crop, seeds: 60 }]), first); // NEW
    assert.throws(() => S.reserve(first, 'first', [{ ...crop, seeds: 59 }]), /terms changed/); // NEW
    assert.equal(S.availability(S.release(first, 'first'))[0].available, 100); // NEW
}); // NEW
test('barter source lines combine; handover and receipt each affect stock exactly once', () => { // NEW
    let sender = S.reserve(stock(), 'barter', [{ ...crop, seeds: 20 }, { ...crop, seeds: 10 }]); // NEW
    sender = S.handover(sender, 'barter'); // NEW
    assert.equal(S.handover(sender, 'barter').items[0].seeds, 70); // NEW
    assert.throws(() => S.release(sender, 'barter'), /Handover/); // NEW
    const receiver = S.receive(stock(0), 'receipt', [{ ...crop, seeds: 30 }]); // NEW
    assert.equal(S.receive(receiver, 'receipt', [{ ...crop, seeds: 30 }]).items[0].seeds, 30); // NEW
}); // NEW
test('copies preserve definitions and conversions while resetting all operational records', () => { // NEW
    const source = S.usage(stock(), complete()), copy = S.reset(source); // NEW
    assert.equal(copy.items[0].seeds, 0); // NEW
    assert.equal(copy.items[0].cropRef, 'tomato'); // NEW
    assert.deepEqual(copy.usage, {}); assert.deepEqual(copy.reservations, {}); assert.deepEqual(copy.receipts, {}); // NEW
    assert.equal(source.items[0].seeds, 80); // NEW
}); // NEW
test('priority levels fill in order with proportional equal-level shortages and capped demand', () => { // NEW
    const result = A.allocate(20, [{ id: 'home', level: 1, demand: 5 }, { id: 'csa', level: 2, demand: 3 }, { id: 'shop', level: 3, demand: 8 }, { id: 'market', level: 3, demand: 24 }]); // NEW
    assert.deepEqual(result.rows.map(row => row.allocated), [5, 3, 3, 9]); // NEW
    assert.equal(result.remaining, 0); // NEW
    assert.equal(A.allocate(100, [{ demand: 3, level: 1 }]).remaining, 97); // NEW
    assert.deepEqual(A.priorities({ demandChannels: [{ id: 'farm' }] }), { self: 1, csa: 2, 'sales:farm': 3 }); // NEW
}); // NEW
const program = { year: 2026, start: '2026-06-01', end: '2026-06-15', weekday: 1, currency: 'USD', sizes: [{ id: 'small', multiplier: 0.5, price: 12 }, { id: 'base', multiplier: 1, price: 20 }], components: [{ cropKey: 'lettuce', qty: 1, unit: 'plant' }] }; // NEW
test('season quotes use eligible scheduled pickups and preserve original currency', () => { // NEW
    const quote = A.quote({ ...program, exceptions: { '2026-06-08': { cancelled: true } } }, { sizeId: 'small', count: 2, from: '2026-06-08' }); // NEW
    assert.deepEqual(quote, { dates: ['2026-06-15'], equivalents: 1, amount: 24, currency: 'USD' }); // NEW
    assert.throws(() => A.pickupDates('2026-12-20', '2027-01-02', 1), /one plan year/); // NEW
    assert.throws(() => A.pickupDates('2026-02-30', '2026-03-10', 1), /Invalid/); // NEW
}); // NEW
test('plant requirements round per member and shortages rotate to seasonally underserved members', () => { // NEW
    const members = ['a', 'b'].map(id => ({ id, sizeId: 'small', count: 1, status: 'accepted' })); // NEW
    const supply = Object.fromEntries(A.pickupDates(program.start, program.end, 1).map(day => [day, { lettuce: 1 }])); // NEW
    const schedule = A.schedule(program, supply, members); // NEW
    assert.deepEqual(schedule.map(day => day.items[0].allocations.map(row => row.allocated)), [[1, 0], [0, 1], [1, 0]]); // NEW
    assert.deepEqual(schedule[0].items[0].allocations.map(row => row.demand), [1, 1]); // NEW
    const revised = A.schedule(program, {}, members, { [schedule[0].date]: schedule[0] }); // NEW
    assert.deepEqual(revised[0], schedule[0]); // NEW
    assert.equal(revised[1].items[0].allocations.reduce((sum, row) => sum + row.allocated, 0), 0); // NEW
}); // NEW

test('completed distribution identities never write through object prototypes', () => { // NEW
    const completed = { '2026-06-01': { date: '2026-06-01', items: [{ cropKey: '__proto__', allocations: [{ id: 'unexpectedMember', demand: 1, allocated: 1 }] }] } }; // NEW
    A.schedule(program, {}, [], completed); assert.equal(Object.prototype.unexpectedMember, undefined); // NEW
}); // NEW
