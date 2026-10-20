const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const test = require('node:test'); // NEW
const vm = require('node:vm'); // NEW

const source = fs.readFileSync(path.join(__dirname, '../src/main/electron.js'), 'utf8'); // NEW

/** Exercise the production email handler without starting Electron or an external email app. */ // NEW
function fixture(platform, openExternal) { // NEW
    const start = source.indexOf('async function openTrellisEmailDraft(args)'); // NEW
    const end = source.indexOf('async function getTrellisReleases()', start); // NEW
    assert.ok(start >= 0 && end > start); // NEW
    const context = vm.createContext({ process: { platform }, shell: { openExternal } }); // NEW
    vm.runInContext(source.slice(start, end), context); // NEW
    return context.openTrellisEmailDraft; // NEW
} // NEW

test('email launch waits for the system handoff and preserves encoded fields', async () => { // NEW
    let resolveLaunch, url, finished = false; // NEW
    const launch = fixture('win32', value => { url = value; return new Promise(resolve => { resolveLaunch = resolve; }); }); // NEW
    const draft = { to: 'grower@example.com', subject: 'Jalapeño & herbs', body: 'First line\nSecond line + setup=%' }; // NEW
    const pending = launch(draft).then(result => { finished = true; return result; }); // NEW
    await Promise.resolve(); // NEW
    assert.equal(finished, false); // NEW
    const parsed = new URL(url); // NEW
    assert.equal(decodeURIComponent(parsed.pathname), draft.to); // NEW
    assert.equal(parsed.searchParams.get('subject'), draft.subject); // NEW
    assert.equal(parsed.searchParams.get('body'), draft.body); // NEW
    resolveLaunch(); // NEW
    assert.equal((await pending).ok, true); // NEW
    assert.match(source, /case 'openTrellisEmailDraft':\s*ret = await openTrellisEmailDraft\(args\)/); // NEW
}); // NEW

test('email launch converts thrown and rejected launch errors to actionable results', async () => { // NEW
    for (const open of [() => { throw new Error('No handler'); }, () => Promise.reject(new Error('Launch rejected'))]) { // NEW
        const result = await fixture('win32', open)({ to: 'grower@example.com', body: 'Invitation' }); // NEW
        assert.equal(result.ok, false); // NEW
        assert.match(result.reason, /default email app/); // NEW
        assert.match(result.reason, /Copy Invitation/); // NEW
    } // NEW
}); // NEW

test('Windows email links enforce the 2081-character boundary without launching oversized links', async () => { // NEW
    const calls = []; // NEW
    const launch = fixture('win32', async url => { calls.push(url); }); // NEW
    const base = 'mailto:' + encodeURIComponent('grower@example.com') + '?subject=s&body='; // NEW
    assert.equal((await launch({ to: 'grower@example.com', subject: 's', body: 'x'.repeat(2081 - base.length) })).ok, true); // NEW
    const oversized = await launch({ to: 'grower@example.com', subject: 's', body: 'x'.repeat(2082 - base.length) }); // NEW
    assert.equal(calls.length, 1); // NEW
    assert.equal(calls[0].length, 2081); // NEW
    assert.equal(oversized.ok, false); // NEW
    assert.match(oversized.reason, /too long.*Copy Invitation/); // NEW
    assert.equal((await fixture('darwin', async () => {})({ to: 'grower@example.com', body: 'x'.repeat(3000) })).ok, true); // NEW
}); // NEW

test('invalid email recipients never reach the external handler', async () => { // NEW
    let calls = 0; // NEW
    const launch = fixture('win32', async () => { calls++; }); // NEW
    assert.equal((await launch({ to: 'invalid' })).ok, false); // NEW
    assert.equal(calls, 0); // NEW
}); // NEW
