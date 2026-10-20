const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const dashboardPath = path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins/Garden_Dashboard.js');

/** Execute the production dialog builders without starting the rest of the dashboard. */
function createFixture(t, users = {}) { // CHANGE: exercise the production invitation-to-delivery handoff.
    const dom = new JSDOM('<!doctype html><body><div id="graph" tabindex="0"></div></body>');
    t.after(() => dom.window.close());
    const source = fs.readFileSync(dashboardPath, 'utf8');
    const start = source.indexOf('    function closeShareDialog(dialog)');
    const end = source.indexOf('    async function openShareGardenCanvasDialog()', start);
    assert.ok(start >= 0 && end > start, 'Production share dialog builders must exist');
    const eventStart = source.indexOf('    function stopToolbarNativeControlEvent(evt)');
    const eventEnd = source.indexOf('    function taskManagerApi()', eventStart);
    const timers = [];
    const context = vm.createContext({
        document: dom.window.document,
        window: dom.window,
        TRELLIS_DIALOG_Z: 2000000000,
        setTimeout(callback) { timers.push(callback); },
        trellisUsersApi() { return users; }, // CHANGE
        createToolbarButton(label) {
            const button = dom.window.document.createElement('button');
            button.textContent = label;
            return button;
        },
        openShareGardenCanvasDialog() {}
    });
    vm.runInContext(source.slice(eventStart, eventEnd) + source.slice(start, end), context);
    return {
        window: dom.window,
        document: dom.window.document,
        graph: dom.window.document.getElementById('graph'),
        openShare() { context.openShareInviteDialog([{ id: 'bed-1', label: 'Garden bed' }], {}); },
        openEnable() { context.openEnableUsersForShareDialog(); },
        flushTimers() { while (timers.length) timers.shift()(); }
    };
}

test('share fields keep native pointer and keyboard behavior away from editor handlers', (t) => {
    const fixture = createFixture(t);
    const { document, window, graph } = fixture;
    fixture.openShare();
    const email = document.querySelector('input[type=email]');
    let editorEvents = 0;
    for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'dblclick', 'keydown', 'keypress', 'keyup']) {
        document.addEventListener(type, (event) => {
            editorEvents++;
            event.preventDefault();
            graph.focus();
        });
        email.focus();
        const event = new window.Event(type, { bubbles: true, cancelable: true });
        email.dispatchEvent(event);
        assert.equal(event.defaultPrevented, false, type + ' must preserve native input defaults');
        assert.equal(document.activeElement, email, type + ' must not return focus to the graph');
    }
    assert.equal(editorEvents, 0);
    const checkbox = document.querySelector('input[type=checkbox]');
    checkbox.click();
    assert.equal(checkbox.checked, true, 'Checkboxes must retain browser toggling');
    const preset = document.querySelector('select');
    preset.value = 'grower';
    preset.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(document.querySelectorAll('input[type=checkbox]:checked').length, 2);
});

test('share initial focus follows queued editor focus restoration', (t) => {
    const fixture = createFixture(t);
    fixture.openShare();
    fixture.graph.focus();
    fixture.flushTimers();
    assert.equal(fixture.document.activeElement, fixture.document.querySelector('input[type=email]'));
});

test('enable-users setup also isolates input events and restores initial focus', (t) => {
    const fixture = createFixture(t);
    fixture.openEnable();
    fixture.graph.focus();
    fixture.flushTimers();
    const name = fixture.document.querySelector('input[type=text]');
    assert.equal(fixture.document.activeElement, name);
    fixture.document.addEventListener('mousedown', (event) => event.preventDefault());
    const event = new fixture.window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
    name.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
});

test('Escape closes share and cancelled dialogs cannot steal focus later', (t) => {
    const fixture = createFixture(t);
    fixture.openShare();
    const email = fixture.document.querySelector('input[type=email]');
    let editorEscapes = 0;
    fixture.document.addEventListener('keydown', () => editorEscapes++);
    email.dispatchEvent(new fixture.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(email.isConnected, false);
    assert.equal(editorEscapes, 0);
    fixture.graph.focus();
    fixture.flushTimers();
    assert.equal(fixture.document.activeElement, fixture.graph);

    fixture.openEnable();
    const cancel = Array.from(fixture.document.querySelectorAll('button')).find((button) => button.textContent === 'Cancel');
    cancel.click();
    fixture.flushTimers();
    assert.equal(fixture.document.activeElement, fixture.graph);
});

test('Create Email hands one saved invite to the retained delivery view', (t) => { // NEW
    const result = { ok: true, invite: { id: 'invite-1' }, code: 'ORIGINAL', emailDraft: { body: 'Invitation' } }; // NEW
    const created = [], delivered = []; // NEW
    const fixture = createFixture(t, { // NEW
        createPendingInvite(options) { created.push(options); return result; }, // NEW
        openInviteDelivery(invite) { delivered.push(invite); return { ok: true }; } // NEW
    }); // NEW
    fixture.openShare(); // NEW
    fixture.document.querySelector('input[type=email]').value = 'grower@example.com'; // NEW
    const send = Array.from(fixture.document.querySelectorAll('button')).find(button => button.textContent === 'Create Email'); // NEW
    send.click(); send.click(); // NEW
    assert.equal(created.length, 1); // NEW
    assert.equal(created[0].email, 'grower@example.com'); // NEW
    assert.equal(delivered[0], result); // NEW
    assert.equal(send.isConnected, false); // NEW
}); // NEW

test('invalid invitation input leaves Create Email available for correction', (t) => { // NEW
    const fixture = createFixture(t, { createPendingInvite() { return { ok: false, reason: 'Enter a complete recipient email address.' }; } }); // NEW
    fixture.openShare(); // NEW
    const send = Array.from(fixture.document.querySelectorAll('button')).find(button => button.textContent === 'Create Email'); // NEW
    send.click(); // NEW
    assert.equal(send.disabled, false); // NEW
    assert.equal(send.isConnected, true); // NEW
    assert.match(fixture.document.body.textContent, /complete recipient email/); // NEW
}); // NEW
