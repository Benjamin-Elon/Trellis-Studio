// NEW: Exercise the actual desktop plugin and IPC allowlist with isolated DOM and identity services.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8');
const plugin = read('drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_API_Keys.js');

function fixture(t, overrides = {}) {
    const dom = new JSDOM('<!doctype html><body></body>'); t.after(() => dom.window.close());
    const actions = {}, calls = [], listeners = {};
    const result = { identityId: 'alice', username: 'Alice', sessionToken: 'session-a', providers: { openai: 'missing', fdc: 'configured' } };
    dom.window.trellisApiKeys = {
        status: async () => result,
        save: async payload => { calls.push({ ...payload }); return { ...result, providers: { ...result.providers, [payload.provider]: 'configured' } }; },
        remove: async payload => { calls.push({ ...payload, removed: true }); return { ...result, providers: { ...result.providers, [payload.provider]: 'missing' } }; },
        ...overrides
    };
    dom.window.trellisIdentity = { onStatus: listener => { listeners.status = listener; }, onLocked: listener => { listeners.locked = listener; } };
    const extras = { funct(menu) { menu.push('existing'); } };
    let closeCallback;
    const ui = {
        actions: { addAction(id, fn) { return actions[id] = { execute: fn }; } },
        menus: { get: () => extras, addMenuItems: (menu, items) => menu.push(...items) },
        showDialog(element, _w, _h, _modal, _closable, closed) { dom.window.document.body.appendChild(element); closeCallback = closed; },
        hideDialog() { dom.window.document.body.replaceChildren(); closeCallback?.(); },
        confirm(_message, ok) { ok(); }
    };
    vm.runInNewContext(plugin, { window: dom.window, document: dom.window.document, Draw: { loadPlugin: install => install(ui) } });
    return { dom, actions, calls, listeners, ui, extras };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('Extras dialog masks input, shows status only, saves and removes keys', async t => {
    const f = fixture(t); const menu = []; f.extras.funct(menu);
    assert.deepEqual(menu, ['existing', '-', 'trellisApiKeys']);
    await f.actions.trellisApiKeys.execute();
    const document = f.dom.window.document;
    assert.match(document.body.textContent, /Profile: Alice/);
    const input = document.querySelector('input');
    assert.equal(input.type, 'password'); assert.equal(input.value, '');
    input.value = 'synthetic-renderer-key'; input.dispatchEvent(new f.dom.window.Event('input'));
    document.querySelector('fieldset button').click();
    assert.equal(input.value, ''); await flush();
    assert.equal(f.calls[0].value, 'synthetic-renderer-key');
    assert.equal(f.calls[0].sessionToken, 'session-a');
    assert.equal(document.body.textContent.includes('synthetic-renderer-key'), false);
    document.querySelectorAll('fieldset button')[1].click(); await flush();
    assert.equal(f.calls[1].removed, true);
    input.value = 'unsaved'; f.listeners.locked(); assert.equal(input.value, ''); assert.equal(document.querySelector('input'), null);
});

test('close, profile changes, pending responses, and failed saves discard sensitive input', async t => {
    let finish;
    const f = fixture(t, { save: () => new Promise(resolve => { finish = resolve; }) });
    await f.actions.trellisApiKeys.execute();
    let input = f.dom.window.document.querySelector('input');
    input.value = 'synthetic-pending'; input.dispatchEvent(new f.dom.window.Event('input'));
    f.dom.window.document.querySelector('fieldset button').click();
    f.listeners.status({ session: { identityId: 'bob' } }); assert.equal(input.value, '');
    finish({ username: 'Alice', providers: { openai: 'configured', fdc: 'missing' } }); await flush();
    assert.equal(f.dom.window.document.body.textContent, '');
    await f.actions.trellisApiKeys.execute(); input = f.dom.window.document.querySelector('input');
    input.value = 'unsaved-close'; f.ui.hideDialog(); assert.equal(input.value, '');
    f.dom.window.trellisApiKeys.save = async () => { throw new Error('synthetic-sensitive-error'); };
    await f.actions.trellisApiKeys.execute(); input = f.dom.window.document.querySelector('input');
    input.value = 'failed-key'; input.dispatchEvent(new f.dom.window.Event('input')); f.dom.window.document.querySelector('fieldset button').click(); await flush();
    assert.equal(input.value, ''); assert.match(f.dom.window.document.body.textContent, /Key change failed/);
    assert.equal(f.dom.window.document.body.textContent.includes('synthetic-sensitive-error'), false);
});

test('signed-out dialog disables writes and browser mode installs no action', async t => {
    const f = fixture(t, { status: async () => { throw new Error('Log in'); } });
    await f.actions.trellisApiKeys.execute();
    assert.match(f.dom.window.document.body.textContent, /Sign in/);
    assert.equal(f.dom.window.document.querySelector('input').disabled, true);
    let added = false;
    vm.runInNewContext(plugin, { window: {}, Draw: { loadPlugin: callback => callback({ actions: { addAction: () => { added = true; } } }) } });
    assert.equal(added, false);
});

test('desktop bridge and dispatcher permit status/save/remove but no secret retrieval', async () => {
    const source = read('src/main/electron.js');
    const start = source.indexOf("case 'trellisApiKeys':");
    const block = source.slice(start, source.indexOf("case 'trellisIdentity':", start));
    assert.ok(start > source.indexOf('if (!validateSender(event.senderFrame)) return null;', source.indexOf('ipcMain.on("rendererReq"')));
    for (const method of ['status', 'save', 'remove', 'read', 'export', '__proto__']) {
        const expected = ['status', 'save', 'remove'].includes(method);
        let called = false;
        const result = vm.runInNewContext('(async () => { let ret; switch(args.action) {' + block + '} return ret; })()', {
            args: { action: 'trellisApiKeys', method, payload: {} },
            getIdentityService: async () => ({ apiKeys: async operation => { called = true; return operation; } })
        });
        if (expected) assert.equal(await result, method); else await assert.rejects(result, /Unsupported/);
        assert.equal(called, expected);
    }
    const preload = read('src/main/electron-preload.js');
    const exposed = {};
    const bridgeStart = preload.indexOf("contextBridge.exposeInMainWorld('trellisApiKeys'");
    vm.runInNewContext(preload.slice(bridgeStart, preload.indexOf("contextBridge.exposeInMainWorld('trellisIdentity'", bridgeStart)), { contextBridge: { exposeInMainWorld: (name, methods) => { exposed[name] = methods; } }, identityRequest: () => {} });
    assert.deepEqual(Object.keys(exposed.trellisApiKeys), ['status', 'save', 'remove']);
});

test('desktop startup installs API keys without overwriting saved plugin choices', () => {
    const source = read('drawio/src/main/webapp/js/diagramly/ElectronApp.js');
    const start = source.indexOf("\t\tApp.pluginRegistry.trellisApiKeys =");
    const snippet = source.slice(start, source.indexOf('\t\tApp.initPluginCallback();', start));
    const values = new Map(), context = { App: { pluginRegistry: {}, publicPlugin: [] }, plugins: ['existing-plugin'], localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }, mxSettings: { setPlugins: () => {}, save: () => {} } };
    vm.runInNewContext(snippet, context); assert.equal(context.plugins[0], 'existing-plugin'); // CHANGE: other independent migrations may also install plugins.
    const apiKeysPlugin = context.App.pluginRegistry.trellisApiKeys; // CHANGE
    assert.ok(apiKeysPlugin); assert.equal(context.plugins.filter(plugin => plugin === apiKeysPlugin).length, 1); // CHANGE: assert API-key installation without coupling to Quickstart.
    const installed = Array.from(context.plugins); vm.runInNewContext(snippet, context); assert.deepEqual(Array.from(context.plugins), installed); // CHANGE: migrations remain idempotent.
    context.plugins = ['deliberate-user-choice']; vm.runInNewContext(snippet, context); assert.deepEqual(context.plugins, ['deliberate-user-choice']);
});
