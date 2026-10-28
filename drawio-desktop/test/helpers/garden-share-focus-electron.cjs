// NEW: Run with Electron to verify browser-default focus and typing in production share fields.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('in-process-gpu');
const profile = path.join(app.getPath('temp'), 'trellis-share-focus-' + process.pid);
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);

/** Click through Chromium rather than dispatching synthetic DOM events. */
async function click(window, selector) {
    const point = await window.webContents.executeJavaScript(`(() => {
        const target = document.querySelector(${JSON.stringify(selector)}); target.scrollIntoView({ block: 'center' }); // CHANGE: expanded help can move controls outside the scroll viewport.
        const rect = target.getBoundingClientRect(); // CHANGE
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`);
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    await new Promise(resolve => setTimeout(resolve, 50)); // NEW: native input is queued separately from executeJavaScript.
}

app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false, width: 1000, height: 750, webPreferences: { sandbox: false, backgroundThrottling: false } }); // CHANGE: match the existing restricted-environment Electron fixtures.
    try {
        await window.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><body><div id="graph" tabindex="0"></div></body>'));
        const source = fs.readFileSync(path.join(__dirname, '../../drawio/src/main/webapp/plugins/garden_planner_plugins/Garden_Dashboard.js'), 'utf8');
        const eventStart = source.indexOf('    function stopToolbarNativeControlEvent(evt)');
        const eventEnd = source.indexOf('    function taskManagerApi()', eventStart);
        const start = source.indexOf('    function closeShareDialog(dialog)');
        const end = source.indexOf('    async function openShareGardenCanvasDialog()', start);
        await window.webContents.executeJavaScript(`
            const TRELLIS_DIALOG_Z = 2000000000;
            function trellisUsersApi() { return {}; }
            function createToolbarButton(label) { const button = document.createElement('button'); button.textContent = label; return button; }
            function openShareGardenCanvasDialog() {}
            ${source.slice(eventStart, eventEnd)}
            ${source.slice(start, end)}
            window.editorEvents = 0;
            ['mousedown', 'mouseup', 'click', 'keydown', 'keypress', 'keyup'].forEach(type => document.addEventListener(type, event => {
                window.editorEvents++;
                event.preventDefault();
                document.getElementById('graph').focus();
            }));
            openShareInviteDialog([{ id: 'bed', label: 'Garden bed' }], {});
            document.getElementById('graph').focus();
            void 0;
        `);
        await new Promise(resolve => setTimeout(resolve, 50));
        await click(window, 'input[type=email]');
        for (const character of 'recipient@example.com') window.webContents.sendInputEvent({ type: 'char', keyCode: character });
        await new Promise(resolve => setTimeout(resolve, 50));
        const result = await window.webContents.executeJavaScript(`({
            focused: document.activeElement === document.querySelector('input[type=email]'),
            value: document.querySelector('input[type=email]').value,
            editorEvents: window.editorEvents
        })`);
        assert.equal(result.focused, true);
        assert.equal(result.value, 'recipient@example.com');
        assert.equal(result.editorEvents, 0);
        await click(window, 'input[type=checkbox]');
        assert.equal(await window.webContents.executeJavaScript("document.querySelector('input[type=checkbox]').checked"), true);
        const usersSource = fs.readFileSync(path.join(__dirname, '../../drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Users.js'), 'utf8'); // NEW
        const deliveryStart = usersSource.indexOf('    /** Explain browser-profile and mail-handler failures'); // NEW
        const deliveryEnd = usersSource.indexOf('    function showAuthStatus(', deliveryStart); // NEW
        const shellStart = usersSource.indexOf('    function makeAccessDialogShell('); // NEW
        const shellEnd = usersSource.indexOf('    function openAccessRequestDialog(', shellStart); // NEW
        const buttonStart = usersSource.indexOf('    function makeButton('); // NEW
        const buttonEnd = usersSource.indexOf('    function makeInput(', buttonStart); // NEW
        assert.ok(deliveryStart >= 0 && deliveryEnd > deliveryStart && shellStart >= 0 && shellEnd > shellStart && buttonStart >= 0 && buttonEnd > buttonStart); // NEW
        await window.webContents.executeJavaScript(` // NEW
            document.querySelector('.trellis-garden-share-dialog').remove(); // NEW
            const USERS_UI_LAYER_Z = 2000000000; // NEW
            function applyUsersButtonStyle() {} // NEW
            ${usersSource.slice(buttonStart, buttonEnd)}
            ${usersSource.slice(shellStart, shellEnd)}
            ${usersSource.slice(deliveryStart, deliveryEnd)}
            window.launches = 0; window.preparations = 0; // NEW
            window.Trellis = { sharing: { async prepareInvite(result) { window.preparations++; return { ...result.emailDraft, body: 'You have been invited to a shared garden.\\n\\nTRELLIS INVITE\\nComplete setup block: jalapeño 🌱\\nEND INVITE' }; } } }; // NEW
            window.trellisShare = { async openEmailDraft() { window.launches++; return { ok: false, reason: 'Your mail app could not be opened. See Email didn’t open? or use Copy Invitation.' }; } }; // NEW
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(value) { window.copiedInvitation = value; } } }); // NEW
            openInviteDelivery({ ok: true, invite: { id: 'original-invite' }, code: 'ORIGINAL', emailDraft: { to: 'grower@example.com', subject: 'Garden invitation', body: 'Base message' } }); // NEW
            document.getElementById('graph').focus(); // NEW
            void 0; // NEW
        `); // NEW
        await new Promise(resolve => setTimeout(resolve, 50)); // NEW
        assert.equal(await window.webContents.executeJavaScript("document.activeElement.textContent"), 'Done'); // NEW
        await click(window, '.trellis-invite-delivery-dialog summary'); // NEW
        await click(window, '.trellis-invite-delivery-dialog textarea'); // NEW
        assert.equal(await window.webContents.executeJavaScript("document.activeElement.tagName"), 'TEXTAREA'); // NEW
        const delivery = await window.webContents.executeJavaScript(`({ // NEW
            readonly: document.querySelector('.trellis-invite-delivery-dialog textarea').readOnly, // NEW
            launches: window.launches, preparations: window.preparations, editorEvents: window.editorEvents, // NEW
            help: document.querySelector('.trellis-invite-delivery-dialog details').open // NEW
        })`); // NEW
        assert.equal(delivery.readonly, true); assert.equal(delivery.help, true); // NEW
        assert.equal(delivery.launches, 1); assert.equal(delivery.preparations, 1); assert.equal(delivery.editorEvents, 0); // NEW
        window.setSize(480, 640); // NEW
        await new Promise(resolve => setTimeout(resolve, 50)); // NEW
        const layout = await window.webContents.executeJavaScript(`(() => { // NEW
            const box = document.querySelector('.trellis-invite-delivery-dialog > div'), rect = box.getBoundingClientRect(); // NEW
            return { left: rect.left, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight, scrollable: box.scrollHeight > box.clientHeight }; // NEW
        })()`); // NEW
        assert.ok(layout.left >= 0 && layout.right <= layout.width && layout.bottom <= layout.height); // NEW
        assert.equal(layout.scrollable, true); // NEW
        if (process.env.TRELLIS_DELIVERY_SCREENSHOT) fs.writeFileSync(process.env.TRELLIS_DELIVERY_SCREENSHOT, (await window.webContents.capturePage()).toPNG()); // NEW
        await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.trellis-invite-delivery-dialog button')).find(button => button.textContent === 'Copy Invitation').scrollIntoView({ block: 'center' }); void 0;"); // NEW
        const copySelector = await window.webContents.executeJavaScript("(() => { const button = Array.from(document.querySelectorAll('.trellis-invite-delivery-dialog button')).find(button => button.textContent === 'Copy Invitation'); button.id = 'copy-invitation'; return '#copy-invitation'; })()"); // NEW
        await click(window, copySelector); // NEW
        const copyDiagnostics = await window.webContents.executeJavaScript("({status:document.querySelector('.trellis-invite-delivery-dialog [role=status]').textContent,disabled:document.getElementById('copy-invitation').disabled,active:document.activeElement.outerHTML.slice(0,160)})"); // NEW
        assert.match(await window.webContents.executeJavaScript('window.copiedInvitation'), /To: grower@example.com\nSubject: Garden invitation\n\n.*\nEND INVITE/s, JSON.stringify(copyDiagnostics)); // CHANGE: retain native diagnostics for asynchronous delivery failures.
        await window.webContents.executeJavaScript("document.addEventListener('keydown', event => { window.deliveryKey = { key: event.key, target: event.target.outerHTML.slice(0, 120) }; }, true); void 0;"); // NEW
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); // NEW
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); // NEW
        await new Promise(resolve => setTimeout(resolve, 50)); // NEW
        assert.equal(await window.webContents.executeJavaScript("document.querySelector('.trellis-invite-delivery-dialog') === null"), true, JSON.stringify(await window.webContents.executeJavaScript("({ key: window.deliveryKey, active: document.activeElement.outerHTML.slice(0, 120) })"))); // NEW
        console.log('INVITE_DELIVERY:passed'); // NEW
        console.log(JSON.stringify({ ok: true, ...result, checkboxToggled: true }));
        window.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        window.destroy();
        app.exit(1);
    }
});
