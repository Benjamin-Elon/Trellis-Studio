/** Alerts use real object discussion, authorization, history and private draft persistence. */ // CHANGE
const assert = require('node:assert/strict'); // CHANGE
const fs = require('node:fs'), path = require('node:path'); // CHANGE
const test = require('node:test'); // CHANGE
const harness = require('./helpers/object-details-harness.cjs'); // CHANGE
const panel = (h, cell) => [...h.w.document.querySelectorAll('.trellis-object-details')].find(node => node.dataset.collaborationObjectId === cell.id && !node.hidden); // CHANGE
const records = (h, cell) => h.core.parseComments(cell.getAttribute('trellis_comments_json')); // CHANGE
const encode = (comments, version = 2) => JSON.stringify({ version, comments }); // CHANGE
const record = (id, extra = {}) => ({ id, authorUserId: 'user-a', authorName: 'user-a', html: '<p>Attention ' + id + '</p>', createdAt: 1000, updatedAt: 1000, resolvedAt: null, resolvedByUserId: null, resolvedByName: null, isAlert: true, ...extra }); // CHANGE
function compose(h, node, html) { // CHANGE
    const editor = node.querySelector('.trellis-comment-editor'); editor.innerHTML = html; editor.dispatchEvent(new h.w.InputEvent('input', { bubbles: true })); return editor; // CHANGE
} // CHANGE

test('alerts prioritize attention and filter shared records without replacing or publishing the private composer', async t => { // CHANGE
    const h = harness(t), cell = h.vertex('garden', '<p>Garden info</p>', { garden_module: '1', trellis_comments_json: encode([record('active'), record('ordinary', { isAlert: false }), record('resolved', { resolvedAt: 2000, resolvedByUserId: 'owner', resolvedByName: 'Owner' })]) }); // CHANGE
    h.controller.open(cell); const node = panel(h, cell), editor = node.querySelector('.trellis-comment-editor'), toggle = node.querySelector('[data-comment-alert]'); // CHANGE
    assert.equal(node.querySelector('[data-details-tab="alerts"]').getAttribute('aria-pressed'), 'true'); assert.equal(node.querySelector('[data-details-tab="alerts"]').textContent, 'Alerts (1)'); // CHANGE
    assert.deepEqual([...node.querySelectorAll('article')].map(item => item.dataset.commentId).sort(), ['active', 'resolved']); assert.equal(toggle.checked, true); // CHANGE
    compose(h, node, '<b>Private alert</b>'); const before = h.ui.getFileData(); // CHANGE
    node.querySelector('[data-details-tab="comments"]').click(); assert.equal(node.querySelectorAll('article').length, 3); assert.match(node.querySelector('[data-comment-id="active"]').textContent, /Alert/); // CHANGE
    node.querySelector('[data-details-tab="info"]').click(); node.querySelector('[data-details-tab="alerts"]').click(); // CHANGE
    assert.equal(node.querySelector('.trellis-comment-editor'), editor); assert.equal(toggle.checked, true); assert.match(editor.innerHTML, /Private alert/); assert.equal(h.ui.getFileData(), before); // CHANGE
    node.querySelector('[data-comment-action="submit"]').click(); await h.tick(); // CHANGE
    assert.equal(records(h, cell).length, 4); assert.equal(records(h, cell).at(-1).isAlert, true); assert.equal(editor.innerHTML, ''); // CHANGE
    const badge = h.w.document.querySelector('[data-cell-id="garden"]'); // CHANGE
    assert.equal(badge.style.backgroundColor, 'rgb(30, 64, 175)'); assert.equal(badge.firstElementChild.style.backgroundColor, 'rgb(250, 204, 21)'); assert.match(badge.style.outline, /2px solid/); // CHANGE
    assert.match(badge.getAttribute('aria-label'), /2 active alerts/); assert.equal(node.querySelector('[data-details-tab="alerts"]').textContent, 'Alerts (2)'); // CHANGE
    const xml = h.w.mxUtils.parseXml(h.ui.getFileData()), restored = new h.w.mxGraphModel(); new h.w.mxCodec(xml).decode(xml.documentElement, restored); // CHANGE
    assert.equal(restored.getCell(cell.id).getAttribute('trellis_comments_json'), cell.getAttribute('trellis_comments_json')); // CHANGE
}); // CHANGE

test('flag moderation preserves text and resolution while resolution, reopening and history update the red signal', async t => { // CHANGE
    const h = harness(t), original = record('one'), cell = h.vertex('bed', null, { garden_bed: '1', trellis_comments_json: encode([original]) }); h.controller.open(cell); h.controller.refresh(); // CHANGE
    const node = panel(h, cell), badge = h.w.document.querySelector('[data-cell-id="bed"]'); h.undo.clear(); // CHANGE
    node.querySelector('[data-comment-action="resolve"]').click(); await h.tick(); // CHANGE
    const resolved = records(h, cell)[0]; assert.equal(resolved.isAlert, true); assert.equal(badge.style.outline, ''); assert.equal(node.querySelector('[data-details-tab="alerts"]').textContent, 'Alerts (0)'); // CHANGE
    assert.ok(node.querySelector('[data-comment-section="resolved"] [data-comment-id="one"]')); // CHANGE
    node.querySelector('[data-comment-action="removeAlert"]').click(); await h.tick(); // CHANGE
    assert.equal(JSON.stringify(records(h, cell)[0]), JSON.stringify({ ...resolved, isAlert: false })); assert.equal(node.querySelectorAll('article').length, 0); // CHANGE
    node.querySelector('[data-details-tab="comments"]').click(); node.querySelector('[data-comment-action="markAlert"]').click(); await h.tick(); // CHANGE
    assert.equal(JSON.stringify(records(h, cell)[0]), JSON.stringify(resolved)); assert.equal(badge.style.outline, ''); // CHANGE
    node.querySelector('[data-comment-action="reopen"]').click(); await h.tick(); assert.match(badge.style.outline, /2px solid/); // CHANGE
    assert.equal(node.querySelector('[data-details-tab="comments"]').getAttribute('aria-pressed'), 'true', 'model changes do not override the chosen tab'); // CHANGE
    h.undo.undo(); await h.tick(); assert.equal(badge.style.outline, ''); h.undo.redo(); await h.tick(); assert.match(badge.style.outline, /2px solid/); // CHANGE
    node.querySelector('[data-comment-action="resolve"]').click(); await h.tick(); const beforeEdit = records(h, cell)[0]; // CHANGE
    node.querySelector('[data-comment-action="edit"]').click(); node.querySelector('[data-comment-alert]').click(); node.querySelector('[data-comment-action="submit"]').click(); await h.tick(); // CHANGE
    assert.equal(JSON.stringify(records(h, cell)[0]), JSON.stringify({ ...beforeEdit, isAlert: false }), 'flag-only author saves do not reopen or mark text edited'); // CHANGE
}); // CHANGE

test('alert policy enforces author, owner and admin access and rejects combined moderation and stale flags', t => { // CHANGE
    const h = harness(t), item = record('one', { isAlert: false }), raw = encode([item]), now = Date.now(); // CHANGE
    const author = { enabled: true, editable: true, user: { id: 'user-a', name: 'user-a' }, ownerUserId: 'owner' }; // CHANGE
    const owner = { ...author, user: { id: 'owner', name: 'Owner' } }, stranger = { ...author, user: { id: 'stranger', name: 'Stranger' } }, admin = { ...stranger, user: { ...stranger.user, admin: true } }; // CHANGE
    const action = { type: 'markAlert', id: item.id, baseline: JSON.stringify(item) }; // CHANGE
    for (const actor of [author, owner, admin]) { const next = h.core.changeComments(raw, action, actor, now); assert.equal(h.core.parseComments(next)[0].isAlert, true); assert.equal(h.core.commentsChangeAllowed(raw, next, actor, now), true); } // CHANGE
    assert.throws(() => h.core.changeComments(raw, action, stranger, now), /not permitted/); // CHANGE
    for (const actor of [{ ...author, editable: false }, { ...author, enabled: false }, { ...author, user: null }]) assert.throws(() => h.core.changeComments(raw, action, actor, now), /Log in/); // CHANGE
    for (const extra of [{ html: '<p>Rewritten</p>', updatedAt: now }, { updatedAt: now }, { resolvedAt: now, resolvedByUserId: 'owner', resolvedByName: 'Owner' }]) assert.equal(h.core.commentsChangeAllowed(raw, encode([{ ...item, isAlert: true, ...extra }]), owner, now), false); // CHANGE
    const second = record('two', { isAlert: false }); assert.equal(h.core.commentsChangeAllowed(encode([item, second]), encode([{ ...item, isAlert: true }, { ...second, isAlert: true }]), author, now), false); // CHANGE
    assert.throws(() => h.core.changeComments(encode([{ ...item, isAlert: true }]), action, owner, now), /changed elsewhere/); // CHANGE
    assert.equal(h.core.commentsChangeAllowed(encode([item]), encode([{ ...item, isAlert: undefined }], 1), author, now), false, 'version 2 cannot be downgraded'); // CHANGE
}); // CHANGE

test('legacy discussion upgrades only after mutation and malformed version-2 records remain intact', async t => { // CHANGE
    const h = harness(t), { isAlert, ...legacy } = record('legacy'), raw = encode([legacy], 1), cell = h.vertex('legacy', null, { trellis_comments_json: raw }); // CHANGE
    h.controller.open(cell); const node = panel(h, cell); assert.equal(cell.getAttribute('trellis_comments_json'), raw); assert.equal(records(h, cell)[0].isAlert, false); // CHANGE
    node.querySelector('[data-comment-action="markAlert"]').click(); await h.tick(); assert.equal(JSON.parse(cell.getAttribute('trellis_comments_json')).version, 2); assert.equal(records(h, cell)[0].isAlert, true); // CHANGE
    for (const invalid of [encode([legacy]), encode([{ ...legacy, isAlert: 'true' }]), encode([{ ...legacy, isAlert: true, extra: 1 }]), encode([record('same'), record('same')])]) { // CHANGE
        cell.value.setAttribute('trellis_comments_json', invalid); h.controller.refresh(); assert.equal(cell.getAttribute('trellis_comments_json'), invalid); // CHANGE
        assert.match(node.textContent, /preserved unchanged/); assert.equal(node.querySelector('[data-comment-action="submit"]').disabled, true); assert.equal(node.querySelector('[data-comment-alert]').disabled, true); // CHANGE
        const badge = h.w.document.querySelector('[data-cell-id="legacy"]'); assert.equal(badge.style.outline, ''); assert.match(badge.title, /Alert status unavailable/); // CHANGE
    } // CHANGE
}); // CHANGE

test('legacy private edit baselines survive a version upgrade without overwriting unrelated comments', async t => { // CHANGE
    const h = harness(t), { isAlert, ...legacy } = record('legacy'), cell = h.vertex('legacy-draft', null, { trellis_comments_json: encode([legacy], 1) }); // CHANGE
    const key = 'trellis.comments.draft.v1:trellis.details.view.v1:' + JSON.stringify(['diagram-a', 'page-a', 'user-a', cell.id]); // CHANGE
    h.w.localStorage.setItem(key, JSON.stringify({ active: 'edit:legacy', drafts: { 'edit:legacy': { id: 'legacy', html: '<p>My retained edit</p>', baseline: JSON.stringify(legacy) } } })); // CHANGE
    h.controller.open(cell); const node = panel(h, cell); assert.match(node.querySelector('.trellis-comment-editor').innerHTML, /My retained edit/); // CHANGE
    cell.value.setAttribute('trellis_comments_json', encode([{ ...legacy, isAlert: false }, record('unrelated')])); h.controller.refresh(); // CHANGE
    node.querySelector('[data-comment-action="submit"]').click(); await h.tick(); // CHANGE
    assert.match(records(h, cell)[0].html, /My retained edit/); assert.equal(records(h, cell)[0].isAlert, false); assert.equal(records(h, cell)[1].id, 'unrelated'); assert.equal(records(h, cell)[1].isAlert, true); // CHANGE
}); // CHANGE

test('private alert choice survives reload and user changes without being published by save or export', async t => { // CHANGE
    const h = harness(t), cell = h.vertex('private'); h.controller.open(cell); let node = panel(h, cell); // CHANGE
    node.querySelector('[data-details-tab="alerts"]').click(); let checkbox = node.querySelector('[data-comment-alert]'); assert.equal(checkbox.checked, true); // CHANGE
    checkbox.click(); compose(h, node, '<p>Keep my ordinary draft</p>'); node.querySelector('[data-details-tab="comments"]').click(); assert.equal(checkbox.checked, false); // CHANGE
    h.controller.flush(); h.controller.exportProjection(); assert.ok(!cell.getAttribute('trellis_comments_json')); assert.doesNotMatch(h.ui.getFileData(), /Keep my ordinary draft/); // CHANGE
    h.policy.currentUser = 'user-b'; h.controller.refresh(); h.controller.open(cell); assert.equal(panel(h, cell).querySelector('[data-comment-alert]').checked, false); // CHANGE
    h.policy.currentUser = 'user-a'; h.controller.refresh(); node = panel(h, cell); assert.match(node.querySelector('.trellis-comment-editor').innerHTML, /Keep my ordinary draft/); // CHANGE
    checkbox = node.querySelector('[data-comment-alert]'); assert.equal(checkbox.checked, false); checkbox.click(); // CHANGE
    h.controller.destroy(); h.w.eval(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Details_Comments.js'), 'utf8')); // CHANGE
    delete h.graph.__trellisObjectDetails; h.w.eval(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Object_Details.js'), 'utf8')); // CHANGE
    const controller = h.graph.__trellisObjectDetails; controller.refresh(); // CHANGE
    node = panel(h, cell); assert.equal(node.querySelector('[data-comment-alert]').checked, true); assert.match(node.querySelector('.trellis-comment-editor').innerHTML, /Keep my ordinary draft/); // CHANGE
    controller.destroy(); // CHANGE: tear down before the fixture closes its window.
}); // CHANGE

test('flagged submissions retain their ID and private choice across collaboration rejection and retry', async t => { // CHANGE
    const h = harness(t), cell = h.vertex('retry'); h.controller.open(cell); const node = panel(h, cell); node.querySelector('[data-details-tab="alerts"]').click(); compose(h, node, '<p>Retain alert</p>'); // CHANGE
    let settle; h.graph.__trellisSharing = { settleObjectEdits: () => new Promise(resolve => { settle = resolve; }) }; // CHANGE
    node.querySelector('[data-comment-action="submit"]').click(); const id = records(h, cell)[0].id; assert.equal(node.querySelector('[data-comment-alert]').disabled, true); // CHANGE
    const previous = cell.value.cloneNode(true); previous.removeAttribute('trellis_comments_json'); h.graph.model.setValue(cell, previous); settle(); await h.tick(); // CHANGE
    assert.equal(node.querySelector('[data-comment-alert]').checked, true); assert.match(node.textContent, /rejected or replaced/); assert.match(node.querySelector('.trellis-comment-editor').innerHTML, /Retain alert/); // CHANGE
    h.graph.__trellisSharing = { settleObjectEdits: async () => {} }; node.querySelector('[data-comment-action="submit"]').click(); await h.tick(); // CHANGE
    assert.equal(records(h, cell).length, 1); assert.equal(records(h, cell)[0].id, id); assert.equal(records(h, cell)[0].isAlert, true); assert.equal(node.querySelector('.trellis-comment-editor').innerHTML, ''); // CHANGE
}); // CHANGE
