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
        const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`);
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
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
        console.log(JSON.stringify({ ok: true, ...result, checkboxToggled: true }));
        window.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        window.destroy();
        app.exit(1);
    }
});
