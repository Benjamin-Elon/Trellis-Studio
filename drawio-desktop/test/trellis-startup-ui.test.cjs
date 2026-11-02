/** Exercise the desktop scheduler against real DOM and existing palette entry points. */ // NEW
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'); // NEW
const { JSDOM } = require('jsdom'); // NEW
function fixture(t, open = false) { // NEW
    const dom = new JSDOM('<body><aside></aside></body>', { runScripts: 'outside-only' }); t.after(() => dom.window.close()); // NEW
    const window = dom.window, timers = [], listeners = new Set(), calls = []; let file = open ? {} : null; // NEW
    window.setTimeout = callback => { timers.push(callback); return timers.length; }; // NEW
    window.Sidebar = function () {}; // NEW
    window.Sidebar.prototype = { showEntries(value) { calls.push(['show', value]); }, searchEntries(...args) { calls.push(['search', args[0]]); args[3]?.([]); }, destroy() { calls.push(['destroy']); } }; // NEW
    window.eval(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/js/trellis-startup-ui.js'), 'utf8')); // NEW
    window.TrellisStartupUI.install(); // NEW
    const sidebar = new window.Sidebar(); sidebar.wrapper = window.document.querySelector('aside'); sidebar.editorUi = { getCurrentFile: () => file, handleError: error => calls.push(['error', error.message]), editor: { addListener(_name, listener) { listeners.add(listener); }, removeListener(listener) { listeners.delete(listener); } } }; // NEW
    const drain = async () => { while (timers.length) { timers.shift()(); await Promise.resolve(); } await Promise.resolve(); }; // NEW
    return { window, sidebar, calls, timers, drain, open() { file = {}; for (const listener of listeners) listener(); }, listeners }; // NEW
} // NEW
test('Home defers palettes and first editor opening initializes once with saved preferences', async t => { // NEW
    const f = fixture(t); let builds = 0; // NEW
    f.window.TrellisStartupUI.registerPalettes(f.sidebar, [function () { builds++; }, function () { this.showEntries(); }]); // NEW
    f.sidebar.showEntries('custom;saved'); assert.equal(builds, 0); assert.equal(f.timers.length, 0); // NEW
    f.open(); f.open(); await f.drain(); assert.equal(builds, 1); assert.deepEqual(f.calls, [['show', 'custom;saved']]); // NEW
    f.open(); await f.drain(); assert.equal(builds, 1); assert.equal(f.sidebar.wrapper.textContent, ''); // NEW
}); // NEW
test('direct-file opening and search wait for the same palette construction', async t => { // NEW
    const f = fixture(t, true); let builds = 0, searched = false; // NEW
    f.window.TrellisStartupUI.registerPalettes(f.sidebar, [() => { builds++; }]); // NEW
    f.sidebar.searchEntries('tomato', 10, 0, () => { searched = true; }); assert.equal(searched, false); // NEW
    await f.drain(); assert.equal(builds, 1); assert.equal(searched, true); assert.deepEqual(f.calls, [['search', 'tomato']]); // NEW
}); // NEW
test('destroy and refresh retire queued generations without installing obsolete palettes', async t => { // NEW
    const f = fixture(t, true); let old = 0, fresh = 0; // NEW
    f.window.TrellisStartupUI.registerPalettes(f.sidebar, [() => { old++; }]); // NEW
    f.window.TrellisStartupUI.registerPalettes(f.sidebar, [() => { fresh++; }]); // NEW
    await f.drain(); assert.equal(old, 0); assert.equal(fresh, 1); // NEW
    f.window.TrellisStartupUI.registerPalettes(f.sidebar, [() => { fresh++; }]); f.sidebar.destroy(); await f.drain(); assert.equal(fresh, 1); assert.equal(f.listeners.size, 0); // NEW
}); // NEW
test('a failed builder remains retryable instead of silently skipping the library', async t => { // NEW
    const f = fixture(t); let fail = true, builds = 0; // NEW
    f.window.TrellisStartupUI.registerPalettes(f.sidebar, [() => { if (fail) throw new Error('Injected library failure'); builds++; }]); // NEW
    const first = f.window.TrellisStartupUI.ensurePalettes(f.sidebar); const rejected = assert.rejects(first, /Injected library failure/); await f.drain(); await rejected; // NEW
    fail = false; const retry = f.window.TrellisStartupUI.ensurePalettes(f.sidebar); await f.drain(); await retry; assert.equal(builds, 1); // NEW
}); // NEW
