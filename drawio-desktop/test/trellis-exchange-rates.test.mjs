import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import fs from 'node:fs/promises'; // NEW
import path from 'node:path'; // NEW
import os from 'node:os'; // NEW
import { countryCurrency, createExchangeRates } from '../src/main/trellis-exchange-rates.js'; // NEW
async function directory(t) { // NEW
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-rates-')); // NEW
    t.after(async () => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('trellis-rates-')); await fs.rm(root, { recursive: true, force: true }); }); // NEW
    return root; // NEW
} // NEW
const now = Date.parse('2026-10-30T18:00:00Z'), response = row => ({ ok: true, text: async () => JSON.stringify(row) }); // NEW
test('country inference uses the existing city country and leaves missing or ambiguous defaults unresolved', () => { // NEW
    for (const [country, currency] of [['US', 'USD'], ['United States', 'USD'], ['United Kingdom', 'GBP'], ['France', 'EUR'], ['Canada', 'CAD'], ['Japan', 'JPY']]) assert.equal(countryCurrency(country), currency); // NEW
    assert.equal(countryCurrency(null), null); assert.equal(countryCurrency('Zimbabwe'), null); assert.equal(countryCurrency('unknown'), null); // NEW
}); // NEW
test('display rates cache the provider date and retrieval time across restart without leaking amounts', async t => { // NEW
    const root = await directory(t), calls = [], fetchRate = async (url, options) => { calls.push({ url, options }); return response({ base: 'USD', quote: 'EUR', rate: 0.9, date: '2026-10-30' }); }; // NEW
    let service = createExchangeRates({ directory: root, fetchRate, now: () => now }); // NEW
    const estimate = await service.estimate({ base: 'USD', quote: 'EUR', amount: 30 }); // NEW
    assert.equal(estimate.amount, 27); assert.equal(estimate.originalAmount, 30); assert.equal(estimate.approximate, true); assert.equal(estimate.date, '2026-10-30'); assert.equal(estimate.retrievedAt, now); // NEW
    assert.equal(calls[0].url, 'https://api.frankfurter.dev/v2/rate/usd/eur'); assert.equal(calls[0].options.body, undefined); // NEW
    service = createExchangeRates({ directory: root, fetchRate, now: () => now + 3600000 }); // NEW
    assert.equal((await service.estimate({ base: 'USD', quote: 'EUR', amount: 10 })).amount, 9); assert.equal(calls.length, 1); // NEW
}); // NEW
test('offline stale rates retain dated estimates and missing pairs retain original prices', async t => { // NEW
    const root = await directory(t); // NEW
    await fs.writeFile(path.join(root, 'exchange-display-rates.json'), JSON.stringify({ 'USD:EUR': { rate: 0.8, date: '2026-10-27', retrievedAt: now - 3 * 86400000 } })); // NEW
    let calls = 0; const service = createExchangeRates({ directory: root, now: () => now, fetchRate: async () => { calls++; throw new Error('Offline'); } }); // NEW
    const stale = await service.estimate({ base: 'USD', quote: 'EUR', amount: 10 }); // NEW
    assert.equal(stale.amount, 8); assert.equal(stale.stale, true); assert.equal(stale.date, '2026-10-27'); // NEW
    await service.estimate({ base: 'USD', quote: 'EUR', amount: 20 }); assert.equal(calls, 1, 'failure backoff prevents each visible price from retrying'); // NEW
    const missing = await service.estimate({ base: 'USD', quote: 'XXX', amount: 10 }); assert.equal(missing.unavailable, true); assert.equal(missing.originalAmount, 10); assert.equal(missing.amount, null); // NEW
}); // NEW
test('simultaneous viewers share one currency-pair request, and same-currency displays need no provider', async t => { // NEW
    const root = await directory(t); let calls = 0; // NEW
    const service = createExchangeRates({ directory: root, now: () => now, fetchRate: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return response({ base: 'USD', quote: 'EUR', rate: 0.9, date: '2026-10-30' }); } }); // NEW
    const estimates = await Promise.all([1, 2, 3].map(amount => service.estimate({ base: 'USD', quote: 'EUR', amount }))); // NEW
    assert.equal(calls, 1); assert.equal(estimates[2].originalAmount, 3); // NEW
    assert.equal((await service.estimate({ base: 'USD', quote: 'USD', amount: 5 })).approximate, false); assert.equal(calls, 1); // NEW
}); // NEW
test('provider failure, invalid dates, damaged cache, and invalid input cannot manufacture display values', async t => { // NEW
    const root = await directory(t); await fs.writeFile(path.join(root, 'exchange-display-rates.json'), '{broken'); // NEW
    const service = createExchangeRates({ directory: root, now: () => now, fetchRate: async () => response({ base: 'USD', quote: 'EUR', rate: 1.1, date: '2026-02-30' }) }); // NEW
    assert.equal((await service.estimate({ base: 'USD', quote: 'EUR', amount: 10 })).unavailable, true); // NEW
    await assert.rejects(service.estimate({ base: 'USD/../secret', quote: 'EUR', amount: 10 }), /Invalid currency/); // NEW
    await assert.rejects(service.estimate({ base: 'USD', quote: 'EUR', amount: -1 }), /Invalid display amount/); // NEW
}); // NEW
