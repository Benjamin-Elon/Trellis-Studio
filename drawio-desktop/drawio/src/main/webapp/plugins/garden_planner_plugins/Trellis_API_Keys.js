/** Profile API key management. Saved secrets are never read back into the renderer. */ // NEW
Draw.loadPlugin(function (ui) {
    'use strict';
    const bridge = window.trellisApiKeys;
    if (!bridge || ui.__trellisApiKeysInstalled) return; // NEW: desktop only, installed once.
    ui.__trellisApiKeysInstalled = true;
    let current = null;

    function close() {
        if (!current) return;
        const view = current;
        view.clear();
        current = null;
        ui.hideDialog(null, null, view.root);
    }
    async function show() {
        close();
        const root = document.createElement('div');
        root.style.cssText = 'padding:20px;box-sizing:border-box;';
        const title = document.createElement('h2'); title.textContent = 'API keys'; root.appendChild(title);
        const profile = document.createElement('p'); profile.textContent = 'Loading profile…'; root.appendChild(profile);
        const note = document.createElement('p'); note.textContent = 'Keys are encrypted on this device for your Trellis profile. Enter a new key to replace a saved key.'; root.appendChild(note);
        const message = document.createElement('p'); message.setAttribute('role', 'status'); root.appendChild(message);
        const inputs = [], controls = [], rows = {};
        let snapshot = null, busy = false;
        const view = { root, clear() { for (const input of inputs) input.value = ''; } };
        current = view;
        function enable() {
            for (const control of controls) control.disabled = busy || !snapshot;
            for (const row of Object.values(rows)) row.save.disabled = busy || !snapshot || !row.input.value.trim();
        }
        function render(result) {
            if (current !== view) return;
            snapshot = result;
            profile.textContent = 'Profile: ' + result.username;
            for (const [provider, row] of Object.entries(rows)) row.status.textContent = result.providers[provider] === 'configured' ? 'Configured' : result.providers[provider] === 'missing' ? 'Missing' : 'Storage error — remove and replace';
        }
        async function change(method, provider, input) {
            if (busy || !snapshot || current !== view) return;
            busy = true;
            const payload = { provider, sessionToken: snapshot.sessionToken };
            if (method === 'save') payload.value = input.value;
            view.clear(); enable(); message.textContent = '';
            try {
                const result = await bridge[method](payload);
                if (current !== view) return;
                render(result); message.textContent = method === 'save' ? 'Key saved.' : 'Key removed.';
            } catch (_) {
                if (current === view) message.textContent = 'Key change failed. Check your profile session and secure storage, then reopen this dialog.';
            } finally { delete payload.value; busy = false; if (current === view) enable(); }
        }
        for (const [provider, label] of [['openai', 'OpenAI'], ['fdc', 'FoodData Central']]) {
            const group = document.createElement('fieldset'); group.style.cssText = 'margin:12px 0;padding:12px;';
            const legend = document.createElement('legend'); legend.textContent = label; group.appendChild(legend);
            const status = document.createElement('span'); status.textContent = 'Loading…'; group.appendChild(status);
            const input = document.createElement('input'); input.type = 'password'; input.autocomplete = 'new-password'; input.spellcheck = false; input.setAttribute('aria-label', label + ' API key'); input.style.cssText = 'display:block;width:100%;box-sizing:border-box;margin:8px 0;'; group.appendChild(input); inputs.push(input);
            const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Save / replace'; save.className = 'geBtn gePrimaryBtn'; save.addEventListener('click', () => change('save', provider, input)); group.appendChild(save);
            const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.className = 'geBtn'; remove.addEventListener('click', () => { if (!busy && snapshot) ui.confirm('Remove the ' + label + ' key for this profile on this device?', () => change('remove', provider, input)); }); group.appendChild(remove);
            controls.push(input, save, remove); rows[provider] = { status, input, save };
            input.addEventListener('input', enable); root.appendChild(group);
        }
        const done = document.createElement('button'); done.type = 'button'; done.className = 'geBtn'; done.textContent = 'Close'; done.addEventListener('click', close); root.appendChild(done);
        enable();
        ui.showDialog(root, 500, 455, true, true, () => { view.clear(); if (current === view) current = null; });
        try { render(await bridge.status()); }
        catch (_) { if (current === view) { profile.textContent = 'Sign in to your Trellis profile to manage API keys.'; message.textContent = 'If you are already signed in, check that your profile is available and reopen this dialog.'; } }
        finally { if (current === view) enable(); }
    }
    // NEW: discard unsaved inputs on any authentication change, including re-login to the same profile.
    if (window.trellisIdentity) { window.trellisIdentity.onStatus(close); window.trellisIdentity.onLocked(close); }
    const action = ui.actions.addAction('trellisApiKeys', show); action.label = 'API keys…';
    const extras = ui.menus.get('extras');
    if (extras) { const original = extras.funct; extras.funct = function (menu, parent) { original.apply(this, arguments); ui.menus.addMenuItems(menu, ['-', 'trellisApiKeys'], parent); }; }
});
