/** Discussion behavior against the shipped mxGraph and shared lifecycle policy. */ // CHANGE
const assert = require('node:assert/strict'); // CHANGE
const test = require('node:test'); // CHANGE
const harness = require('./helpers/object-details-harness.cjs'); // CHANGE
const panel = (h, cell) => [...h.w.document.querySelectorAll('.trellis-object-details')].find(node => node.dataset.collaborationObjectId === cell.id && node.style.display !== 'none'); // CHANGE
const comments = (h, cell) => h.core.parseComments(cell.getAttribute('trellis_comments_json')); // CHANGE
const encode = records => JSON.stringify({ version: 1, comments: records }); // CHANGE
const record = (id, createdAt = Date.now() - 1000, extra = {}) => ({ id, authorUserId: 'user-a', authorName: 'user-a', html: '<p>Comment ' + id + '</p>', createdAt, updatedAt: createdAt, resolvedAt: null, resolvedByUserId: null, resolvedByName: null, ...extra }); // CHANGE
function compose(h, cell, html) { // CHANGE
    const element = panel(h, cell).querySelector('.trellis-comment-editor'); element.innerHTML = html; element.dispatchEvent(new h.w.InputEvent('input', { bubbles: true })); return element; // CHANGE
} // CHANGE

test('badges independently indicate saved details and unresolved comments while preserving resolved history', async t => { // CHANGE
    const h = harness(t), now = Date.now(), resolved = record('resolved', now - 2000, { resolvedAt: now - 1000, resolvedByUserId: 'user-a', resolvedByName: 'user-a' }); // CHANGE
    const cases = [ // CHANGE
        { id: 'details', html: '<p>Info</p>', records: [], outer: 'rgb(30, 64, 175)', center: 'rgb(239, 246, 255)', count: 0 }, // CHANGE
        { id: 'unresolved', html: null, records: [record('one')], outer: 'rgb(239, 246, 255)', center: 'rgb(250, 204, 21)', count: 1 }, // CHANGE
        { id: 'both', html: '<p>Info</p>', records: [record('one'), record('two'), resolved], outer: 'rgb(30, 64, 175)', center: 'rgb(250, 204, 21)', count: 2 }, // CHANGE
        { id: 'resolved-only', html: null, records: [resolved], outer: 'rgb(239, 246, 255)', center: 'rgb(239, 246, 255)', count: 0 }, // CHANGE
        { id: 'details-resolved', html: '<p>Info</p>', records: [resolved], outer: 'rgb(30, 64, 175)', center: 'rgb(239, 246, 255)', count: 0 }, // CHANGE
        { id: 'empty', html: null, records: [] }, // CHANGE
        { id: 'whitespace', html: '<p> \u200b<br></p>', records: [] } // CHANGE
    ]; // CHANGE
    for (const item of cases) h.vertex(item.id, item.html, { trellis_comments_json: encode(item.records) }); // CHANGE
    const before = h.ui.getFileData(); h.controller.refresh(); // CHANGE
    for (const item of cases) { // CHANGE
        const badge = h.w.document.querySelector('.trellis-object-details-badge[data-cell-id="' + item.id + '"]'); // CHANGE
        if (!item.outer) { assert.equal(badge, null, item.id); continue; } // CHANGE
        assert.equal(badge.style.backgroundColor, item.outer, item.id); assert.equal(badge.firstElementChild.style.backgroundColor, item.center, item.id); // CHANGE
        assert.equal(badge.style.width, '20px'); assert.equal(badge.firstElementChild.style.width, '14px'); assert.equal(badge.firstElementChild.textContent, 'i'); // CHANGE
        assert.equal(badge.firstElementChild.getAttribute('aria-hidden'), 'true'); assert.equal(badge.getAttribute('aria-expanded'), 'false'); // CHANGE
        assert.equal(badge.getAttribute('aria-label'), badge.title); assert.ok(badge.title.includes(item.count + ' unresolved comment' + (item.count === 1 ? '.' : 's.')), badge.title); // CHANGE
        assert.ok(badge.title.includes(item.html ? 'Extra details available' : 'No extra details')); // CHANGE
    } // CHANGE
    assert.equal(h.ui.getFileData(), before, 'reading badge state must not rewrite model data'); // CHANGE
    const cell = h.graph.model.getCell('resolved-only'), badge = h.w.document.querySelector('[data-cell-id="resolved-only"]'); // CHANGE
    badge.firstElementChild.click(); await h.tick(); assert.ok(h.graph.isCellSelected(cell)); assert.ok(panel(h, cell)); assert.equal(badge.getAttribute('aria-expanded'), 'true'); // CHANGE
    badge.firstElementChild.click(); await h.tick(); assert.equal(panel(h, cell), undefined); assert.equal(badge.getAttribute('aria-expanded'), 'false'); // CHANGE
}); // CHANGE

test('badge fills follow posting, resolving, reopening, description commits and undo/redo without reflecting private drafts', async t => { // CHANGE
    const h = harness(t), cell = h.vertex('shape', '<p>Info</p>'); h.controller.open(cell); await h.tick(); // CHANGE
    const badge = h.w.document.querySelector('[data-cell-id="shape"]'); // CHANGE
    panel(h, cell).querySelector('[data-details-tab="comments"]').click(); compose(h, cell, '<p>Private draft</p>'); h.controller.refresh(); // CHANGE
    assert.equal(badge.firstElementChild.style.backgroundColor, 'rgb(239, 246, 255)'); assert.match(badge.title, /0 unresolved comments/); // CHANGE
    panel(h, cell).querySelector('[data-comment-action="submit"]').click(); await h.tick(); assert.equal(badge.firstElementChild.style.backgroundColor, 'rgb(250, 204, 21)'); // CHANGE
    panel(h, cell).querySelector('[data-comment-action="resolve"]').click(); await h.tick(); // CHANGE
    assert.equal(badge.firstElementChild.style.backgroundColor, 'rgb(239, 246, 255)'); assert.match(badge.title, /0 unresolved comments/); // CHANGE
    h.undo.undo(); await h.tick(); assert.equal(badge.firstElementChild.style.backgroundColor, 'rgb(250, 204, 21)'); // CHANGE
    h.undo.redo(); await h.tick(); assert.equal(badge.firstElementChild.style.backgroundColor, 'rgb(239, 246, 255)'); // CHANGE
    panel(h, cell).querySelector('[data-comment-action="reopen"]').click(); await h.tick(); assert.equal(badge.firstElementChild.style.backgroundColor, 'rgb(250, 204, 21)'); // CHANGE
    panel(h, cell).querySelector('[data-details-tab="info"]').click(); h.type(cell, ''); h.controller.refresh(); // CHANGE
    assert.equal(badge.style.backgroundColor, 'rgb(30, 64, 175)', 'uncommitted description clearing does not change the signal'); // CHANGE
    h.controller.flush(); await h.tick(); assert.equal(badge.style.backgroundColor, 'rgb(239, 246, 255)'); assert.match(badge.title, /No extra details/); // CHANGE
    h.undo.undo(); await h.tick(); assert.equal(badge.style.backgroundColor, 'rgb(30, 64, 175)'); // CHANGE
    h.undo.redo(); await h.tick(); assert.equal(badge.style.backgroundColor, 'rgb(239, 246, 255)'); // CHANGE
    h.graph.clearSelection(); await h.tick(); assert.ok(badge.isConnected); assert.equal(badge.firstElementChild.style.backgroundColor, 'rgb(250, 204, 21)'); // CHANGE
}); // CHANGE

test('malformed and externally updated comments keep badge state readable without rewriting discussion', async t => { // CHANGE
    const h = harness(t), broken = '{"version":9,"comments":[]}', cell = h.vertex('shape', null, { trellis_comments_json: broken }); h.controller.refresh(); // CHANGE
    const badge = h.w.document.querySelector('[data-cell-id="shape"]'); // CHANGE
    assert.ok(badge); assert.equal(badge.firstElementChild.style.backgroundColor, 'rgb(239, 246, 255)'); assert.match(badge.title, /Comment status unavailable/); assert.equal(cell.getAttribute('trellis_comments_json'), broken); // CHANGE
    const remote = cell.value.cloneNode(true); remote.setAttribute('trellis_comments_json', encode([record('remote')])); h.graph.model.setValue(cell, remote); await h.tick(); // CHANGE
    assert.equal(badge.firstElementChild.style.backgroundColor, 'rgb(250, 204, 21)'); assert.match(badge.title, /1 unresolved comment\./); // CHANGE
    const empty = remote.cloneNode(true); empty.setAttribute('trellis_comments_json', encode([])); h.graph.model.setValue(cell, empty); await h.tick(); // CHANGE
    assert.equal(h.w.document.querySelector('[data-cell-id="shape"]'), null); // CHANGE
}); // CHANGE

test('deleting the last retained comment removes a comment-only badge and undo restores its neutral state', async t => { // CHANGE
    const h = harness(t), now = Date.now(), old = record('old', now - h.core.COMMENT_RETENTION_MS - 2000, { resolvedAt: now - h.core.COMMENT_RETENTION_MS, resolvedByUserId: 'user-a', resolvedByName: 'user-a' }); // CHANGE
    const cell = h.vertex('shape', null, { trellis_comments_json: encode([old]) }); h.controller.open(cell); await h.tick(); // CHANGE
    assert.equal(h.w.document.querySelector('[data-cell-id="shape"]').firstElementChild.style.backgroundColor, 'rgb(239, 246, 255)'); // CHANGE
    h.w.confirm = () => true; panel(h, cell).querySelector('[data-comment-action="delete"]').click(); await h.tick(); assert.equal(h.w.document.querySelector('[data-cell-id="shape"]'), null); // CHANGE
    h.undo.undo(); await h.tick(); assert.equal(h.w.document.querySelector('[data-cell-id="shape"]').firstElementChild.style.backgroundColor, 'rgb(239, 246, 255)'); // CHANGE
}); // CHANGE

test('tabs prefer existing content, preserve selection, and discover comment-only objects without exporting discussion', async t => { // CHANGE
    const h = harness(t), a = h.vertex('a', '<p>Description</p>', { trellis_comments_json: encode([record('a-comment')]) }), b = h.vertex('b', null, { trellis_comments_json: encode([record('b-comment')]) }); // CHANGE
    h.graph.setSelectionCells([a, b]); await h.tick(); // CHANGE
    assert.equal(panel(h, a).querySelector('[data-details-tab="info"]').getAttribute('aria-pressed'), 'true'); // CHANGE
    assert.equal(panel(h, b).querySelector('[data-details-tab="comments"]').getAttribute('aria-pressed'), 'true'); // CHANGE
    assert.equal(panel(h, b).querySelector('[data-details-tab="comments"]').textContent, 'Comments (1)'); // CHANGE
    panel(h, a).querySelector('[data-details-tab="comments"]').click(); h.controller.refresh(); // CHANGE
    assert.equal(panel(h, a).querySelector('[data-details-tab="comments"]').getAttribute('aria-pressed'), 'true'); // CHANGE
    const projection = h.controller.exportProjection()['page-a']; assert.equal(projection.length, 2); assert.ok(projection.every(item => item.ownerId === 'a')); assert.doesNotMatch(JSON.stringify(projection), /a-comment|b-comment/); // CHANGE
    h.graph.clearSelection(); await h.tick(); assert.equal(h.w.document.querySelectorAll('.trellis-object-details-badge').length, 2); // CHANGE
    h.w.document.querySelector('[data-cell-id="b"]').click(); await h.tick(); assert.ok(panel(h, b)); // CHANGE
}); // CHANGE

test('rich comments post explicitly, sanitize, preserve metadata, roundtrip XML, and support host undo/redo', async t => { // CHANGE
    const h = harness(t), cell = h.vertex('shape', '<p>Info</p>', { custom: 'preserve' }); h.controller.open(cell); h.undo.clear(); // CHANGE
    panel(h, cell).querySelector('[data-details-tab="comments"]').click(); compose(h, cell, '<p onclick="bad()"><b>Question</b><img src=x><a href="javascript:bad()">link</a></p>'); // CHANGE
    h.controller.flush(); assert.equal(cell.value.getAttribute('trellis_comments_json'), null); // CHANGE
    panel(h, cell).querySelector('[data-details-tab="info"]').click(); panel(h, cell).querySelector('[data-details-tab="comments"]').click(); // CHANGE
    assert.match(panel(h, cell).querySelector('.trellis-comment-editor').innerHTML, /Question/); // CHANGE
    panel(h, cell).querySelector('[data-comment-action="submit"]').click(); await h.tick(); // CHANGE
    const value = comments(h, cell)[0]; assert.equal(value.authorUserId, 'user-a'); assert.equal(value.resolvedAt, null); assert.doesNotMatch(value.html, /onclick|<img|javascript:/); // CHANGE
    assert.equal(cell.getAttribute('custom'), 'preserve'); assert.equal(cell.getAttribute('trellis_details_html'), '<p>Info</p>'); // CHANGE
    const xml = h.w.mxUtils.parseXml(h.ui.getFileData()), restored = new h.w.mxGraphModel(); new h.w.mxCodec(xml).decode(xml.documentElement, restored); // CHANGE
    assert.equal(restored.getCell('shape').getAttribute('trellis_comments_json'), cell.getAttribute('trellis_comments_json')); // CHANGE
    h.undo.undo(); await h.tick(); assert.equal(cell.value.getAttribute('trellis_comments_json'), null); h.undo.redo(); await h.tick(); assert.equal(comments(h, cell)[0].id, value.id); // CHANGE
}); // CHANGE

test('sections sort by posting time and preserve collapsed resolution history and resolution metadata', async t => { // CHANGE
    const h = harness(t), now = Date.now(), cell = h.vertex('shape', null, { trellis_comments_json: encode([record('old', now - 2000), record('new', now - 1000), record('resolved', now - 3000, { resolvedAt: now - 500, resolvedByUserId: 'owner', resolvedByName: 'Owner' })]) }); // CHANGE
    h.graph.setSelectionCell(cell); await h.tick(); const node = panel(h, cell); // CHANGE
    assert.deepEqual([...node.querySelectorAll('[data-comment-section="unresolved"] article')].map(item => item.dataset.commentId), ['new', 'old']); // CHANGE
    assert.equal(node.querySelector('[data-comment-section="resolved"]').open, false); // CHANGE
    assert.match(node.textContent, /Resolved by Owner/); assert.match(node.textContent, /Deletion available/); // CHANGE
    node.querySelector('[data-comment-id="new"] [data-comment-action="resolve"]').click(); await h.tick(); assert.equal(comments(h, cell).find(item => item.id === 'new').resolvedByUserId, 'user-a'); // CHANGE
    node.querySelector('[data-comment-id="new"] [data-comment-action="edit"]').click(); compose(h, cell, '<p>Corrected question</p>'); node.querySelector('[data-comment-action="submit"]').click(); await h.tick(); // CHANGE
    const updated = comments(h, cell).find(item => item.id === 'new'); assert.equal(updated.resolvedAt, null, node.querySelector('.trellis-details-comments [role="status"]').textContent); assert.equal(updated.resolvedByUserId, null); assert.equal(updated.createdAt, now - 1000); // CHANGE
    assert.match(node.querySelector('[data-comment-id="new"]').textContent, /edited/); // CHANGE
}); // CHANGE

test('shared lifecycle policy enforces authorship, ownership, admins, object access, and the exact retention boundary', t => { // CHANGE
    const h = harness(t), now = Date.now(), retention = h.core.COMMENT_RETENTION_MS, original = record('comment', now - retention - 2000), unresolved = encode([original]); // CHANGE
    const author = { enabled: true, editable: true, user: { id: 'user-a', name: 'user-a' }, ownerUserId: 'owner' }; // CHANGE
    const owner = { ...author, user: { id: 'owner', name: 'Owner' } }, stranger = { ...author, user: { id: 'stranger', name: 'Stranger' } }, admin = { ...stranger, user: { ...stranger.user, admin: true } }; // CHANGE
    const action = type => ({ type, id: original.id, html: '<p>Edited</p>', baseline: JSON.stringify(original) }); // CHANGE
    for (const actor of [owner, admin, stranger]) assert.throws(() => h.core.changeComments(unresolved, action('edit'), actor, now), /not permitted/); // CHANGE
    for (const actor of [author, owner, admin]) assert.ok(h.core.changeComments(unresolved, action('resolve'), actor, now)); // CHANGE
    assert.throws(() => h.core.changeComments(unresolved, action('resolve'), stranger, now), /not permitted/); // CHANGE
    for (const actor of [{ ...author, enabled: false }, { ...author, editable: false }, { ...author, user: null }]) assert.throws(() => h.core.changeComments(unresolved, action('resolve'), actor, now), /Log in/); // CHANGE
    assert.throws(() => h.core.changeComments(unresolved, action('delete'), author, now), /not permitted/); // CHANGE
    const resolved = { ...original, resolvedAt: now - retention, resolvedByUserId: 'owner', resolvedByName: 'Owner' }, raw = encode([resolved]), deletion = { type: 'delete', id: original.id, baseline: JSON.stringify(resolved) }; // CHANGE
    assert.throws(() => h.core.changeComments(raw, deletion, author, now - 1), /not permitted/); // CHANGE
    for (const actor of [author, owner, admin]) assert.equal(h.core.changeComments(raw, deletion, actor, now), ''); // CHANGE
    assert.throws(() => h.core.changeComments(raw, deletion, stranger, now), /not permitted/); // CHANGE
    const reopened = h.core.changeComments(raw, { ...deletion, type: 'reopen' }, author, now), item = h.core.parseComments(reopened)[0]; // CHANGE
    const reResolved = h.core.changeComments(reopened, { type: 'resolve', id: item.id, baseline: JSON.stringify(item) }, author, now + 1), latest = h.core.parseComments(reResolved)[0]; // CHANGE
    assert.throws(() => h.core.changeComments(reResolved, { type: 'delete', id: item.id, baseline: JSON.stringify(latest) }, author, now + retention), /not permitted/); // CHANGE
}); // CHANGE

test('manual deletion requires confirmation and author edits reopen resolved comments', async t => { // CHANGE
    const h = harness(t), now = Date.now(), item = record('old', now - h.core.COMMENT_RETENTION_MS - 2000, { resolvedAt: now - h.core.COMMENT_RETENTION_MS, resolvedByUserId: 'user-a', resolvedByName: 'user-a' }), cell = h.vertex('shape', '<p>Info</p>', { trellis_comments_json: encode([item]) }); // CHANGE
    h.controller.open(cell); panel(h, cell).querySelector('[data-details-tab="comments"]').click(); // CHANGE
    h.w.confirm = () => false; panel(h, cell).querySelector('[data-comment-action="delete"]').click(); await h.tick(); assert.equal(comments(h, cell).length, 1); // CHANGE
    h.w.confirm = () => true; panel(h, cell).querySelector('[data-comment-action="delete"]').click(); await h.tick(); assert.equal(cell.value.getAttribute('trellis_comments_json'), null); // CHANGE
}); // CHANGE

test('private drafts survive deselection and controller reload, remain isolated by user, and never enter canonical data', async t => { // CHANGE
    const h = harness(t), cell = h.vertex('shape'); h.controller.open(cell); panel(h, cell).querySelector('[data-details-tab="comments"]').click(); compose(h, cell, '<b>Private draft</b>'); // CHANGE
    h.graph.clearSelection(); await h.tick(); assert.ok(!cell.getAttribute('trellis_comments_json')); assert.doesNotMatch(h.ui.getFileData(), /Private draft/); // CHANGE
    h.graph.setSelectionCell(cell); await h.tick(); assert.match(panel(h, cell).querySelector('.trellis-comment-editor').innerHTML, /Private draft/); // CHANGE
    h.policy.currentUser = 'user-b'; h.w.dispatchEvent(new h.w.Event('trellisUsersSessionChanged')); await h.tick(); assert.equal(panel(h, cell), undefined); // CHANGE
    h.controller.open(cell); panel(h, cell).querySelector('[data-details-tab="comments"]').click(); assert.equal(panel(h, cell).querySelector('.trellis-comment-editor').textContent, ''); // CHANGE
    h.policy.currentUser = 'user-a'; h.w.dispatchEvent(new h.w.Event('trellisUsersSessionChanged')); await h.tick(); assert.match(panel(h, cell).querySelector('.trellis-comment-editor').innerHTML, /Private draft/); // CHANGE
    const key = [...Array(h.w.localStorage.length)].map((_, index) => h.w.localStorage.key(index)).find(key => key.startsWith('trellis.comments.draft.v1:') && key.includes('user-a')); assert.ok(key); // CHANGE
    assert.match(h.w.localStorage.getItem(key), /Private draft/); // CHANGE
    h.controller.destroy(); h.w.eval(require('node:fs').readFileSync(require('node:path').join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Details_Comments.js'), 'utf8')); // CHANGE: reset the module's memory cache to exercise durable draft loading.
    delete h.graph.__trellisObjectDetails; h.w.eval(require('node:fs').readFileSync(require('node:path').join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins/Trellis_Object_Details.js'), 'utf8')); // CHANGE
    h.graph.__trellisObjectDetails.refresh(); assert.match(panel(h, cell).querySelector('.trellis-comment-editor').innerHTML, /Private draft/); // CHANGE
    h.graph.__trellisObjectDetails.destroy(); // CHANGE
}); // CHANGE

test('storage failures retain private drafts in memory and visibly report loss of durable storage', async t => { // CHANGE
    const h = harness(t), cell = h.vertex('shape'); h.w.Storage.prototype.setItem = () => { throw new Error('quota'); }; h.controller.open(cell); // CHANGE
    panel(h, cell).querySelector('[data-details-tab="comments"]').click(); compose(h, cell, '<p>Keep in memory</p>'); assert.match(panel(h, cell).textContent, /draft storage is unavailable/); // CHANGE
    h.graph.clearSelection(); await h.tick(); h.graph.setSelectionCell(cell); await h.tick(); assert.match(panel(h, cell).querySelector('.trellis-comment-editor').innerHTML, /Keep in memory/); // CHANGE
}); // CHANGE

test('draft identity isolates pages, diagrams, and objects and restores each private composer independently', async t => { // CHANGE
    const h = harness(t), a = h.vertex('a'), b = h.vertex('b'); h.controller.open(a); panel(h, a).querySelector('[data-details-tab="comments"]').click(); compose(h, a, '<p>Page A diagram A</p>'); // CHANGE
    h.graph.setSelectionCell(b); h.controller.open(b); panel(h, b).querySelector('[data-details-tab="comments"]').click(); assert.equal(panel(h, b).querySelector('.trellis-comment-editor').textContent, ''); // CHANGE
    h.graph.setSelectionCell(a); await h.tick(); h.ui.currentPage = { getId: () => 'page-b' }; h.controller.refresh(); h.controller.open(a); panel(h, a).querySelector('[data-details-tab="comments"]').click(); // CHANGE
    assert.equal(panel(h, a).querySelector('.trellis-comment-editor').textContent, ''); compose(h, a, '<p>Page B draft</p>'); // CHANGE
    h.policy.diagram = 'diagram-b'; h.controller.refresh(); h.controller.open(a); panel(h, a).querySelector('[data-details-tab="comments"]').click(); assert.equal(panel(h, a).querySelector('.trellis-comment-editor').textContent, ''); // CHANGE
    h.policy.diagram = 'diagram-a'; h.controller.refresh(); assert.match(panel(h, a).querySelector('.trellis-comment-editor').textContent, /Page B draft/); // CHANGE
    h.ui.currentPage = { getId: () => 'page-a' }; h.controller.refresh(); assert.match(panel(h, a).querySelector('.trellis-comment-editor').textContent, /Page A diagram A/); // CHANGE
}); // CHANGE

test('selecting posted text deactivates the private composer toolbar and keyboard switching retains its draft', async t => { // CHANGE
    const h = harness(t), cell = h.vertex('shape', '<p>Info</p>', { trellis_comments_json: encode([record('comment')]) }); h.controller.open(cell); // CHANGE
    const toggle = panel(h, cell).querySelector('[data-details-tab="comments"]'); toggle.focus(); toggle.click(); const editor = compose(h, cell, '<b>Private text</b>'); editor.focus(); // CHANGE
    assert.equal(h.ui.getActiveRichTextTarget().element, editor); panel(h, cell).querySelector('.trellis-comment-body').focus(); assert.equal(h.ui.getActiveRichTextTarget(), null); // CHANGE
    editor.focus(); let saves = 0; h.ui.actions.get = name => name === 'save' ? { funct() { saves++; } } : null; // CHANGE
    editor.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })); assert.equal(saves, 1); assert.equal(comments(h, cell).length, 1); // CHANGE
    panel(h, cell).querySelector('[data-details-tab="info"]').click(); assert.equal(h.ui.getActiveRichTextTarget(), null); // CHANGE
    toggle.click(); assert.match(panel(h, cell).querySelector('.trellis-comment-editor').innerHTML, /Private text/); // CHANGE
}); // CHANGE

test('bad schemas and duplicate IDs cannot overwrite stored discussion, and unrelated concurrent posts survive editing', t => { // CHANGE
    const h = harness(t), now = Date.now(), actor = { enabled: true, editable: true, user: { id: 'user-a', name: 'user-a' } }, first = record('first', now - 2000), second = record('second', now - 1000); // CHANGE
    for (const raw of ['broken JSON', '{"version":9,"comments":[]}', JSON.stringify({ version: 1, comments: [first], extra: true }), encode([first, first]), encode([{ ...first, resolvedAt: now, resolvedByUserId: null }])]) { // CHANGE
        assert.throws(() => h.core.changeComments(raw, { type: 'post', id: 'new', html: '<p>New</p>' }, actor, now)); assert.equal(h.core.commentsChangeAllowed(raw, '', actor, now), false); // CHANGE
    } // CHANGE
    const result = h.core.changeComments(encode([first, second]), { type: 'edit', id: first.id, baseline: JSON.stringify(first), html: '<p>Updated first</p>' }, actor, now); // CHANGE
    const records = h.core.parseComments(result); assert.equal(records.length, 2); assert.equal(JSON.stringify(records[1]), JSON.stringify({ ...second, isAlert: false })); // CHANGE
}); // CHANGE

test('composition and permission loss cannot post text; the native selection and toolbar belong to the composer', async t => { // CHANGE
    const h = harness(t), cell = h.vertex('shape'); h.controller.open(cell); panel(h, cell).querySelector('[data-details-tab="comments"]').click(); const editor = compose(h, cell, '<b>Draft</b>'); editor.focus(); // CHANGE
    assert.equal(h.ui.getActiveRichTextTarget().element, editor); assert.equal(h.ui.isSelectionAllowed({ target: editor.querySelector('b') }), true); // CHANGE
    editor.dispatchEvent(new h.w.CompositionEvent('compositionstart')); panel(h, cell).querySelector('[data-comment-action="submit"]').click(); assert.ok(!cell.getAttribute('trellis_comments_json')); // CHANGE
    editor.dispatchEvent(new h.w.CompositionEvent('compositionend')); h.policy.enabled = false; h.controller.refresh(); assert.equal(editor.contentEditable, 'false'); assert.equal(panel(h, cell).querySelector('[data-comment-action="submit"]').disabled, true); // CHANGE
    h.policy.enabled = true; h.policy.editable = false; h.controller.refresh(); assert.equal(editor.contentEditable, 'false'); // CHANGE
    h.policy.editable = true; h.policy.currentUser = null; h.controller.refresh(); assert.equal(panel(h, cell), undefined); // CHANGE
}); // CHANGE

test('stale edits and malformed discussion are preserved rather than overwritten', async t => { // CHANGE
    const h = harness(t), cell = h.vertex('shape', null, { trellis_comments_json: encode([record('comment')]) }); h.controller.open(cell); panel(h, cell).querySelector('[data-comment-action="edit"]').click(); compose(h, cell, '<p>My edit</p>'); // CHANGE
    const remote = record('comment', comments(h, cell)[0].createdAt, { html: '<p>Remote edit</p>', updatedAt: Date.now() }); cell.value.setAttribute('trellis_comments_json', encode([remote])); // CHANGE
    panel(h, cell).querySelector('[data-comment-action="submit"]').click(); await h.tick(); assert.match(comments(h, cell)[0].html, /Remote edit/); assert.match(panel(h, cell).querySelector('.trellis-comment-editor').innerHTML, /My edit/); assert.match(panel(h, cell).textContent, /changed elsewhere/); // CHANGE
    const broken = '{"version":9,"comments":[]}'; cell.value.setAttribute('trellis_comments_json', broken); h.controller.refresh(); // CHANGE
    assert.equal(panel(h, cell).querySelector('[data-comment-action="submit"]').disabled, true); assert.match(panel(h, cell).textContent, /preserved unchanged/); assert.equal(cell.getAttribute('trellis_comments_json'), broken); // CHANGE
}); // CHANGE

test('collaboration acceptance controls draft clearing and rejection retains a retryable stable submission ID', async t => { // CHANGE
    const h = harness(t), cell = h.vertex('shape', '<p>Info</p>'); h.controller.open(cell); let settle, acceptedRaw; // CHANGE
    h.graph.__trellisSharing = { settleObjectEdits: () => new Promise(resolve => { settle = resolve; }) }; // CHANGE
    panel(h, cell).querySelector('[data-details-tab="comments"]').click(); compose(h, cell, '<p>Retained until accepted</p>'); panel(h, cell).querySelector('[data-comment-action="submit"]').click(); // CHANGE
    acceptedRaw = cell.getAttribute('trellis_comments_json'); const originalId = comments(h, cell)[0].id; assert.match(panel(h, cell).querySelector('.trellis-comment-editor').innerHTML, /Retained until accepted/); // CHANGE
    const previous = cell.value.cloneNode(true); previous.removeAttribute('trellis_comments_json'); h.graph.__trellisSharingApplying = true; h.graph.model.setValue(cell, previous); h.graph.__trellisSharingApplying = false; settle(); await h.tick(); // CHANGE
    assert.match(panel(h, cell).querySelector('.trellis-comment-editor').innerHTML, /Retained until accepted/); assert.match(panel(h, cell).textContent, /rejected or replaced/); // CHANGE
    h.graph.__trellisSharing = { settleObjectEdits: async () => {} }; panel(h, cell).querySelector('[data-comment-action="submit"]').click(); await h.tick(); // CHANGE
    assert.equal(comments(h, cell).length, 1); assert.equal(comments(h, cell)[0].id, originalId); assert.equal(panel(h, cell).querySelector('.trellis-comment-editor').textContent, ''); // CHANGE
    const actor = { enabled: true, editable: true, user: { id: 'user-a', name: 'user-a' } }; // CHANGE
    assert.equal(h.core.changeComments(acceptedRaw, { type: 'post', id: originalId, html: '<p>Retained until accepted</p>' }, actor), acceptedRaw); // CHANGE
}); // CHANGE
