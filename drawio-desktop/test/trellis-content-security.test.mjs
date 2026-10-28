/** Regression coverage for received-data boundaries, using production validators and host code. */ // NEW
import test from 'node:test'; // NEW
import assert from 'node:assert/strict'; // NEW
import fs from 'node:fs/promises'; // NEW
import os from 'node:os'; // NEW
import path from 'node:path'; // NEW
import crypto from 'node:crypto'; // NEW
import zlib from 'node:zlib'; // NEW
import { prepareExportAssets } from '../src/main/trellis-export-assets.js'; // NEW
import { parse as parseJavaScript } from '@babel/parser'; // NEW
import { JSDOM } from 'jsdom'; // NEW
import { policy, LIMITS, readBounded, readJson } from '../src/main/trellis-input-policy.js'; // NEW
import { inspectDiagram, diagramDocument, digest, canonical, signRecord, verifyRecord } from '../src/main/trellis-share-protocol.js'; // NEW
import { diffObjects, applyChanges } from '../src/main/trellis-collaboration-protocol.js'; // NEW
import { readVerifiedAsset, createAssetBroker, saveReceivedAsset } from '../src/main/trellis-asset-policy.js'; // NEW
import '../drawio/src/main/webapp/js/trellis-identity-protocol.js'; // NEW
import { replayInWorker } from '../src/main/trellis-collaboration-worker.js'; // NEW
import { replayCacheBudget } from '../src/main/trellis-save-cache.js'; // NEW
const webapp = path.resolve('drawio/src/main/webapp'); // NEW
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR2kAAAAASUVORK5CYII=', 'base64'); // NEW
const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" parent="1" vertex="1"/><mxCell id="b" parent="1" vertex="1"/></root></mxGraphModel>'; // NEW
async function folder(t) { const name = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-security-')); t.after(() => fs.rm(name, { recursive: true, force: true })); return name; } // NEW
async function browser(t) { // NEW
    const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://fixture.test/' }), w = dom.window; t.after(() => dom.window.close()); // NEW
    w.mxLoadResources = false; w.mxLoadStylesheets = false; w.urlParams = {}; w.DOM_PURIFY_CONFIG = {}; w.Editor = function () {}; w.EditorUi = function () {}; w.HTMLCanvasElement.prototype.getContext = () => null; // NEW
    w.Editor.prototype.setStatus = function(value) { w.statusValue = value; }; // NEW
    w.EditorUi.prototype.setFileData = w.EditorUi.prototype.replaceFileData = function () { w.replaced = true; }; // NEW
    for (const file of ['mxgraph/mxClient.js', 'js/sanitizer/purify.min.js', 'js/deflate/pako.min.js', 'js/grapheditor/Graph.js', 'js/trellis-content-policy.js']) w.eval(await fs.readFile(path.join(webapp, file), 'utf8')); // NEW
    w.TrellisContentPolicy.install(); return w; // NEW
} // NEW
test('canonical signatures preserve bytes while malformed JSON and excessive nesting are rejected', () => { // NEW
    const value = { z: [1, 'é'], a: { enabled: true } }, keys = crypto.generateKeyPairSync('ed25519'); // NEW
    assert.equal(canonical(value), '{"a":{"enabled":true},"z":[1,"é"]}'); assert.equal(verifyRecord(signRecord(value, keys.privateKey), keys.publicKey), true); // NEW
    assert.throws(() => policy.json('{"__proto__":{"admin":true}}'), /Unsafe/); assert.throws(() => policy.json('{"x":1e999}'), /finite/); // NEW
    assert.throws(() => policy.json('['.repeat(129) + '0' + ']'.repeat(129)), error => error.code === 'DEPTH_LIMIT'); assert.throws(() => policy.textLimit('éé', 3), /byte/); // NEW
    const shared = {}; assert.doesNotThrow(() => canonical({ a: shared, b: shared })); // NEW
}); // NEW
test('all diagram readers reject includes, duplicate identities, parent cycles and non-finite geometry', () => { // NEW
    for (const xml of [model.replace('<mxCell id="a"', '<mxCell id="b"'), model.replace('id="a" parent="1"', 'id="a" parent="a"'), model.replace('vertex="1"/>', 'vertex="1"><include name="https://invalid.test/"/></mxCell>'), model.replace('vertex="1"/>', 'vertex="1"><mxGeometry x="Infinity" as="geometry"/></mxCell>')]) assert.throws(() => inspectDiagram(xml)); // NEW
    assert.throws(() => policy.xmlText('<x>'.repeat(129) + '</x>'.repeat(129)), /complexity/); // NEW
    const cyclic = model.replace('id="a" parent="1"', 'id="a" parent="b"').replace('id="b" parent="1"', 'id="b" parent="a"'); // NEW
    assert.throws(() => applyChanges(model, [{ key: '*', before: digest(model), xml: cyclic }]), /parent cycle/); // NEW
    assert.equal(diagramDocument(model).serialize(), model); // NEW
}); // NEW
test('bounded readers check actual bytes and close handles even when metadata understates size', async t => { // NEW
    const directory = await folder(t), filename = path.join(directory, 'input.json'); await fs.writeFile(filename, '{"value":1}'); // NEW
    assert.equal((await readJson(filename)).value, 1); await assert.rejects(readBounded(filename, 4), /limit/); // NEW
    const open = fs.open; let closed = false; // NEW
    t.mock.method(fs, 'open', async (...args) => { const handle = await open(...args), close = handle.close.bind(handle); handle.stat = async () => ({ isFile: () => true, size: 0 }); handle.close = async () => { closed = true; await close(); }; return handle; }); // NEW
    await assert.rejects(readBounded(filename, 4), /limit/); assert.equal(closed, true); // NEW
}); // NEW
test('image bytes determine MIME and reject type disguises, oversized dimensions and active SVG', async t => { // NEW
    const directory = await folder(t), filename = path.join(directory, digest(png).slice(0, 16) + '.png'); await fs.writeFile(filename, png); // NEW
    assert.equal((await readVerifiedAsset(filename, true)).mime, 'image/png'); const disguised = filename.replace(/png$/, 'jpg'); await fs.writeFile(disguised, png); await assert.rejects(readVerifiedAsset(disguised, true), error => error.code === 'INVALID_IMAGE'); // CHANGE // NEW
    await fs.writeFile(filename, '<script>bad()</script>'); await assert.rejects(readVerifiedAsset(filename, true), /verification/); // NEW
    const huge = Buffer.from(png); huge.writeUInt32BE(100000, 16); huge.writeUInt32BE(100000, 20); assert.throws(() => policy.rasterInfo(huge), /pixel/); // NEW
    for (const content of ['<script/>', '<foreignObject/>', '<image href="https://invalid.test/pixel"/>', '<path onclick="bad()"/>', '<path style="fill:url(https://invalid.test/x)"/>']) { const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">' + content + '</svg>'), file = path.join(directory, digest(svg).slice(0, 16) + '.svg'); await fs.writeFile(file, svg); await assert.rejects(readVerifiedAsset(file, true)); } // NEW
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>'), file = path.join(directory, digest(svg).slice(0, 16) + '.svg'); await fs.writeFile(file, svg); assert.equal((await readVerifiedAsset(file, true)).mime, 'image/svg+xml'); // NEW
}); // NEW
test('asset capabilities bind windows and contexts and return the exact verified bytes', async t => { // NEW
    const directory = await folder(t), filename = path.join(directory, digest(png).slice(0, 16) + '.png'); await fs.writeFile(filename, png); let context = 'garden:user:1'; // NEW
    const broker = createAssetBroker({ currentContext: id => id === 7 ? context : 'other', readImage: async () => { const result = await readVerifiedAsset(filename, true); await fs.writeFile(filename, 'replacement'); return result; } }); // NEW
    const url = broker.baseUrl(7, 'share') + 'assets/' + path.basename(filename); assert.equal(broker.authorize(7, url, 'image'), true); assert.equal(broker.authorize(8, url, 'image'), false); assert.equal(broker.authorize(7, url, 'xhr'), false); // NEW
    const response = await broker.response({ url, method: 'GET' }); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), png); // NEW
    context = 'garden:user:2'; assert.equal(broker.authorize(7, url, 'image'), false); assert.equal((await broker.response({ url })).status, 403); // NEW
    const next = broker.baseUrl(7, 'share') + 'assets/' + path.basename(filename); broker.revoke(7); assert.equal(broker.authorize(7, next, 'image'), false); // NEW
}); // NEW
test('navigation during asset reading revokes the response', async () => { // NEW
    let context = 'before'; const broker = createAssetBroker({ currentContext: () => context, readImage: async () => { context = 'after'; return { bytes: png, mime: 'image/png' }; } }); // NEW
    const url = broker.baseUrl(1, 'share') + 'assets/' + digest(png).slice(0, 16) + '.png'; assert.equal((await broker.response({ url })).status, 403); // NEW
}); // NEW
test('attachments are save-only and cancellation never writes', async () => { // NEW
    const calls = [], config = { input: {}, read: async () => ({ bytes: Buffer.from('received executable'), filename: 'sample.exe' }), choose: async options => { calls.push(options); return { filePath: 'chosen-destination', canceled: false }; }, write: async (filename, bytes) => calls.push([filename, bytes.toString()]) }; // NEW
    assert.equal((await saveReceivedAsset(config)).ok, true); assert.equal(calls[0].title, 'Save attachment'); assert.deepEqual(calls[1], ['chosen-destination', 'received executable']); // NEW
    config.choose = async () => ({ canceled: true }); config.write = () => assert.fail('canceled save wrote bytes'); assert.equal((await saveReceivedAsset(config)).canceled, true); // NEW
}); // NEW
test('production display policy preserves Unicode and formatting without live resources or canonical edits', async t => { // NEW
    const w = await browser(t), source = '<b>Jalapeño 🌱 &amp; soil</b><img src="http://127.0.0.1:9/pixel" onerror="bad()"><script>bad()</script>'; // NEW
    assert.equal(w.TrellisContentPolicy.plainText(source), 'Jalapeño 🌱 & soil'); // NEW
    const html = w.Graph.sanitizeHtml(source + '<a href="javascript:bad()">link</a><div style="background-image:url(https://invalid.test);color:red">Keep</div>'); // NEW
    assert.match(html, /<b>Jalapeño/); assert.match(html, /color:\s*red/); assert.doesNotMatch(html, /onerror|javascript:|<script|background-image|127\.0\.0\.1/); // NEW
    assert.equal(w.TrellisContentPolicy.imageSource('data:image/png;base64,' + png.toString('base64')), 'data:image/png;base64,' + png.toString('base64')); assert.equal(source.includes('127.0.0.1'), true); // NEW
    const plugin = await fs.readFile(path.join(webapp, 'plugins/garden_planner_plugins/Modules_Standalone.js'), 'utf8'), fn = plugin.slice(plugin.indexOf('    function getCellDisplayText(cell)'), plugin.indexOf('    function getCellRawLabel(cell)')); w.eval(fn); assert.equal(w.getCellDisplayText({ value: source }), 'Jalapeño 🌱 & soil'); // NEW
}); // NEW
test('native decoding rejects includes before loading and file replacement rejects before clearing the editor', async t => { // NEW
    const w = await browser(t); let loads = 0; w.mxUtils.load = () => { loads++; throw Error('network'); }; // NEW
    const bad = model.replace('vertex="1"/>', 'vertex="1"><include name="https://invalid.test/include"/></mxCell>'), doc = w.mxUtils.parseXml(bad); // NEW
    assert.throws(() => new w.mxCodec(doc).decode(doc.documentElement), /codec/); assert.equal(loads, 0); // NEW
    const ui = new w.EditorUi(); assert.throws(() => ui.setFileData(bad)); assert.notEqual(w.replaced, true); ui.setFileData(model); assert.equal(w.replaced, true); // NEW
}); // NEW
test('explicit refresh validates the entire batch before any native object is decoded', async t => { // NEW
    const w = await browser(t), source = await fs.readFile(path.join(webapp, 'js/trellis-incoming-changes.js'), 'utf8'), fn = source.slice(source.indexOf('        function patchFor(changes)'), source.indexOf('        async function refresh()')); // NEW
    const patch = w.eval('(function(root){' + fn + ';return patchFor;})(window)'); let decoded = 0; w.mxCodec.prototype.decodeCell = () => { decoded++; }; // NEW
    assert.throws(() => patch([{ key: '["","a"]', xml: '<mxCell id="a"/>' }, { key: '["","b"]', xml: '<mxCell id="b"><include name="https://invalid.test/"/></mxCell>' }])); assert.equal(decoded, 0); // NEW
}); // NEW
test('replay rejects oversized collections before spawning and failed workers release reservations', async () => { // NEW
    assert.throws(() => replayInWorker(model, new Array(LIMITS.records + 1).fill(null), Date.now()), /record limit/); // NEW
    await assert.rejects(replayInWorker('<mxGraphModel><root><mxCell id="0"><include name="x"/></mxCell></root></mxGraphModel>', [], Date.now())); // NEW
    assert.equal(Atomics.load(new Int32Array(replayCacheBudget), 0), 0); // NEW
}); // NEW

test('a timed-out worker stops before rejection and leaves reservations usable', async () => { // NEW
    await assert.rejects(replayInWorker(model, [], Date.now(), () => {}, { timeoutMs: 1 }), error => error.code === 'REPLAY_TIMEOUT'); // NEW
    assert.equal(Atomics.load(new Int32Array(replayCacheBudget), 0), 0); await replayInWorker(model, [], Date.now()); // NEW
}); // NEW


test('multi-page decompression shares one document budget and keeps canonical bytes unchanged', () => { // NEW
    const page = model.replace('vertex="1"/>', 'vertex="1" value="' + 'x'.repeat(1000) + '"/>'), compressed = zlib.deflateRawSync(Buffer.from(encodeURIComponent(page))).toString('base64'); // NEW
    const xml = '<mxfile><diagram id="first">' + compressed + '</diagram><diagram id="second">' + compressed + '</diagram></mxfile>'; // NEW
    assert.equal(diagramDocument(xml).pages.length, 2); assert.throws(() => diagramDocument(xml, Buffer.byteLength(page) * 2 - 1)); assert.equal(xml.includes(compressed), true); // NEW
}); // NEW

test('export projections embed verified image bytes, remove remote image dependencies and retain source', async () => { // NEW
    const source = model.replace('id="a" parent=', 'id="a" style="image=assets/' + digest(png).slice(0, 16) + '.png;" parent=').replace('id="b" parent=', 'id="b" style="image=http://127.0.0.1/pixel;" parent='); // NEW
    let reads = 0; const result = await prepareExportAssets(source, async reference => { reads++; assert.ok(reference.startsWith('assets/')); return { bytes: png, mime: 'image/png' }; }); // NEW
    assert.equal(reads, 1); assert.ok(result.includes('data:image/png,')); assert.doesNotMatch(result, /127.0.0.1/); assert.ok(source.includes('assets/')); assert.equal(source.includes('127.0.0.1'), true); // NEW
}); // NEW


test('worker heap failures release reservations before allowing the next replay', async () => { // NEW
    const large = model.replace('id="a"', 'id="a" value="' + 'x'.repeat(8 * 1024 * 1024) + '"'); // NEW
    await assert.rejects(replayInWorker(large, [], Date.now(), () => {}, { heapMb: 16 }), error => error.code === 'ERR_WORKER_OUT_OF_MEMORY'); // NEW
    assert.equal(Atomics.load(new Int32Array(replayCacheBudget), 0), 0); await replayInWorker(model, [], Date.now()); // NEW
}); // NEW


test('encoded rich text, generated export styles and cyclic static SVG stay inert', async t => { // NEW
    const w = await browser(t), source = '<a href="&#106;avascript:bad()">Click</a><img src="https://invalid.test" onerror="bad()"><b>🌱 &amp; soil</b>'; // NEW
    assert.doesNotMatch(w.Graph.sanitizeHtml(source), /javascript:|onerror=|invalid.test/); // NEW
    const svg = new w.DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://invalid.test/font)</style><rect style="fill:red;filter:url(https://invalid.test/filter)"/><a href="https://example.org">Link</a></svg>', 'image/svg+xml').documentElement; // NEW
    const exported = new w.XMLSerializer().serializeToString(w.TrellisContentPolicy.cleanExport(svg)); assert.doesNotMatch(exported, /invalid.test|@import/); assert.match(exported, /fill:red|fill: red/); assert.match(exported, /https:\/\/example.org/); // NEW
    for (const content of ['<g id="a"><use href="#a"/></g>', '<defs><g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g></defs>']) assert.throws(() => w.TrellisContentPolicy.validateSvg(new w.DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg">' + content + '</svg>', 'image/svg+xml').documentElement), /cycle/); // NEW
    const inert = model.replace('</root>', '<object id="metadata"><mxCell parent="1"/><plugin-data><note>Preserve 🌱</note></plugin-data></object></root>'); assert.equal(diagramDocument(inert).serialize(), inert); // NEW
}); // NEW


test('animation frames cannot escape their declared canvas or reuse its pixel budget', () => { // NEW
    const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'); assert.equal(policy.rasterInfo(gif).mime, 'image/gif'); // NEW
    const descriptor = gif.indexOf(44), escaped = Buffer.from(gif); escaped.writeUInt16LE(2, descriptor + 1); assert.throws(() => policy.rasterInfo(escaped), /canvas/); // NEW
    const animated = Buffer.concat([gif.subarray(0, gif.length - 1), gif.subarray(descriptor, gif.length)]); animated.writeUInt16LE(6000, 6); animated.writeUInt16LE(3000, 8); assert.throws(() => policy.rasterInfo(animated), /frames|pixel/); // NEW
}); // NEW


test('encrypted metadata authenticates its context and validates plaintext before consumers receive it', async () => { // NEW
    const protocol = globalThis.TrellisIdentityProtocol, key = crypto.randomBytes(32), context = 'community:fixture'; // NEW
    const valid = await protocol.seal({ label: '🌱' }, key, context); assert.deepEqual(await protocol.open(valid, key, context), { label: '🌱' }); await assert.rejects(protocol.open(valid, key, 'other-channel')); // NEW
    for (const [text, code] of [['['.repeat(129) + '0' + ']'.repeat(129), 'DEPTH_LIMIT'], ['{"__proto__":{"admin":true}}', 'INVALID_KEY']]) { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(context)); const bytes = Buffer.concat([cipher.update(text), cipher.final(), cipher.getAuthTag()]); await assert.rejects(protocol.open({ iv: iv.toString('base64'), data: bytes.toString('base64') }, key, context), error => error.code === code); } // NEW
}); // NEW

test('URI-encoded Unicode pages are charged by decoded UTF-8 bytes', () => { // NEW
    const page = model.replace('id="a"', 'id="a" value="' + '🌱'.repeat(500) + '"'), compressed = zlib.deflateRawSync(Buffer.from(encodeURIComponent(page))).toString('base64'); // NEW
    assert.equal(diagramDocument('<mxfile><diagram id="unicode">' + compressed + '</diagram></mxfile>', Buffer.byteLength(page)).pages.length, 1); // NEW
}); // NEW


test('native dictionary identities are rejected before decoding while Unicode labels remain valid', () => { // NEW
    for (const id of ['toString', 'hasOwnProperty', '__defineGetter__', 'push', 'length']) assert.throws(() => inspectDiagram(model.replace('id="a"', 'id="' + id + '"')), error => error.code === 'INVALID_MODEL'); // NEW
    assert.doesNotThrow(() => inspectDiagram(model.replace('id="a"', 'id="a" value="🌱 toString"'))); // NEW
}); // NEW


test('embedded SVG copies and whole replacements validate before the host clears current pages', async t => { // NEW
    const w = await browser(t), source = await fs.readFile(path.join(webapp, 'js/diagramly/Editor.js'), 'utf8'), ast = parseJavaScript(source); let extract; // NEW
    function visit(node) { if (!node || typeof node !== 'object') return; if (node.type === 'AssignmentExpression' && node.left?.object?.name === 'Editor' && node.left?.property?.name === 'extractGraphModel') extract = node; for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value); } visit(ast); assert.ok(extract); w.eval(source.slice(extract.start, extract.end)); // NEW
    const ui = new w.EditorUi(), bad = model.replace('id="a" parent="1"', 'id="a" parent="a"'), svg = '<svg xmlns="http://www.w3.org/2000/svg" content="' + encodeURIComponent(bad) + '"/>'; // NEW
    for (const method of ['setFileData', 'replaceFileData']) { w.replaced = false; assert.throws(() => ui[method](svg), /parent cycle/); assert.equal(w.replaced, false); } // NEW
    w.replaced = false; ui.setFileData('<svg xmlns="http://www.w3.org/2000/svg" content="' + encodeURIComponent(model) + '"/>'); assert.equal(w.replaced, true); // NEW
    const html = xml => '<!DOCTYPE html><html><body><div class="mxgraph" data-mxgraph="' + JSON.stringify({ xml }).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') + '"></div></body></html>'; // NEW
    w.replaced = false; assert.throws(() => ui.setFileData(html(bad)), /parent cycle/); assert.equal(w.replaced, false); ui.setFileData(html(model)); assert.equal(w.replaced, true); // NEW
}); // NEW


test('editing retains canonical asset references and failed display loads do not dirty editable content', async t => { // NEW
    const w = await browser(t), base = 'trellis-asset://' + 'a'.repeat(48) + '/', reference = 'assets/' + digest(png).slice(0, 16) + '.png'; w.TrellisContentPolicy.setAssetBase(base); assert.equal(w.TrellisContentPolicy.imageSource(reference), base + reference); // NEW
    const textarea = w.document.createElement('div'); textarea.setAttribute('contenteditable', 'true'); textarea.innerHTML = w.Graph.sanitizeHtml('<b>Edited 🌱</b><img src="' + reference + '">'); w.document.body.appendChild(textarea); const before = textarea.innerHTML; // NEW
    assert.equal(textarea.querySelector('img').getAttribute('src'), base + reference); textarea.querySelector('img').dispatchEvent(new w.Event('error')); assert.equal(textarea.innerHTML, before); // NEW
    const value = w.mxCellEditor.prototype.getCurrentValue.call({ textarea }, { style: { html: '1', nl2Br: '0' } }); assert.ok(value.includes('src="' + reference + '"'), value); assert.equal(value.includes(base), false); // NEW
}); // NEW


test('display complexity fails as a placeholder and status HTML uses the shared sanitizer', async t => { // NEW
    const w = await browser(t), source = '</z>'.repeat(20) + '<div>'.repeat(129) + 'text' + '</div>'.repeat(129); // NEW
    assert.equal(w.Graph.sanitizeHtml(source), 'Content unavailable'); assert.equal(w.TrellisContentPolicy.plainText(source), 'Content unavailable'); assert.equal(w.TrellisContentPolicy.plainText('<br>'.repeat(300) + '🌱'), '🌱'); // NEW
    new w.Editor().setStatus('<b>Saved</b><img src="http://127.0.0.1/private" onerror="bad()">'); assert.match(w.statusValue, /<b>Saved/); assert.doesNotMatch(w.statusValue, /127\.0\.0\.1|onerror/); // NEW
    assert.throws(() => policy.xmlText('</z>'.repeat(200) + '<x>'.repeat(129) + '</x>'.repeat(129))); // NEW
}); // NEW

test('page identifiers cannot collide with native dictionary properties and inert CDATA is preserved', () => { // NEW
    for (const id of ['__proto__', 'constructor', 'toString']) assert.throws(() => diagramDocument('<mxfile><diagram id="' + id + '">' + model + '</diagram></mxfile>'), /page identifiers/); // NEW
    const inert = model.replace('</root>', '<object id="metadata"><mxCell parent="1"/><plugin-data><![CDATA[<!DOCTYPE example>]]></plugin-data></object></root>'); assert.equal(diagramDocument(inert).serialize(), inert); // NEW
    assert.throws(() => policy.xmlText('<!DOCTYPE svg SYSTEM "https://invalid.test/"><svg/>'), /entities/); // NEW
}); // NEW


test('concurrent bounded readers release in-flight reservations after aggregate failure', async t => { // NEW
    const directory = await folder(t), files = [path.join(directory, 'first'), path.join(directory, 'second')]; await Promise.all(files.map(file => fs.writeFile(file, '123456789012'))); const budget = { used: 0, maximum: 20 }; // NEW
    const results = await Promise.allSettled(files.map(file => readBounded(file, 64, null, budget))); assert.ok(results.some(result => result.status === 'rejected' && result.reason.code === 'REPLAY_LIMIT')); assert.equal(budget.pending, 0); // NEW
}); // NEW

test('native stencil script evaluation stays disabled through the actual registry consumer', async t => { // NEW
    const w = await browser(t); let loads = 0; w.mxUtils.load = () => { loads++; return { getStatus: () => 200, getText: () => 'window.executed=true' }; }; w.executed = false; // NEW
    w.mxStencilRegistry.dynamicLoading = true; w.mxStencilRegistry.getBasenameForStencil = () => 'fixture'; w.mxStencilRegistry.libraries.fixture = ['fixture.js']; w.mxStencilRegistry.getStencil('fixture.unsafe'); assert.equal(loads, 0); assert.equal(w.executed, false); // NEW
}); // NEW


test('the shipped streaming inflater enforces decoded UTF-8 budgets before replacing a browser document', async t => { // NEW
    const w = await browser(t), page = model.replace('id="a"', 'id="a" value="' + '🌱'.repeat(200) + '"'), compressed = zlib.deflateRawSync(Buffer.from(encodeURIComponent(page))).toString('base64'); // NEW
    assert.equal(w.Graph.decompress(compressed, null, true, Buffer.byteLength(page)), page); assert.throws(() => w.Graph.decompress(compressed, null, true, 100), /limit/); // NEW
}); // NEW


test('image-role byte limits precede hashing and escaped SVG dependencies are rejected', async t => { // NEW
    const directory = await folder(t), filename = path.join(directory, '0123456789abcdef.png'), handle = await fs.open(filename, 'w'); await handle.truncate(LIMITS.raster + 1); await handle.close(); await assert.rejects(readVerifiedAsset(filename, true), error => error.code === 'INPUT_LIMIT'); // NEW
    const escape = String.fromCharCode(92), svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path fill="u' + escape + '72l(relative.svg)"/></svg>'), file = path.join(directory, digest(svg).slice(0, 16) + '.svg'); await fs.writeFile(file, svg); await assert.rejects(readVerifiedAsset(file, true), error => error.code === 'INVALID_IMAGE'); // NEW
}); // NEW

test('a resolved missing asset context reports one notice while pending verified assets do not', async t => { // NEW
    const w = await browser(t), source = 'assets/' + digest(png).slice(0, 16) + '.png'; assert.equal(w.TrellisContentPolicy.imageSource(source), null); await new Promise(resolve => w.setTimeout(resolve, 0)); assert.equal(w.document.querySelector('[data-trellis-content-notice]'), null); // NEW
    w.TrellisContentPolicy.setAssetBase(null); await new Promise(resolve => w.setTimeout(resolve, 0)); assert.equal(w.document.querySelectorAll('[data-trellis-content-notice]').length, 1); w.TrellisContentPolicy.imageSource(source); assert.equal(w.document.querySelectorAll('[data-trellis-content-notice]').length, 1); // NEW
}); // NEW

test('Unicode XML names and unsupported copies fail before parsing or clearing current pages', async t => { // NEW
    assert.throws(() => policy.xmlText('<植物>'.repeat(129) + '</植物>'.repeat(129)), error => error.code === 'DEPTH_LIMIT'); // NEW
    assert.doesNotThrow(() => policy.xmlText('<植物>🌱</植物>')); // NEW
    const w = await browser(t), ui = new w.EditorUi(); // NEW
    for (const xml of ['<unknown/>', '<svg xmlns="http://www.w3.org/2000/svg"/>', '<mxfile/>']) { w.replaced = false; assert.throws(() => ui.setFileData(xml), error => error.code === 'INVALID_MODEL'); assert.equal(w.replaced, false); } // NEW
    for (const id of ['toString', 'push']) { const doc = w.mxUtils.parseXml('<mxCell id="' + id + '"/>'); assert.throws(() => new w.mxCodec(doc).decodeCell(doc.documentElement), error => error.code === 'INVALID_MODEL'); } // NEW
}); // NEW

test('legacy embedded SVG declarations project safely without changing sources or weakening XML validation', async t => { // NEW
    const w = await browser(t), declaration = '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">', svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Jalapeño 🌱</text></svg>', source = 'data:image/svg+xml;base64,' + Buffer.from(declaration + svg).toString('base64'); // NEW
    const safe = w.TrellisContentPolicy.imageSource(source); assert.equal(Buffer.from(safe.split(',')[1], 'base64').toString('utf8'), svg); assert.ok(Buffer.from(source.split(',')[1], 'base64').toString().startsWith(declaration)); assert.throws(() => w.TrellisContentPolicy.xmlText(declaration + svg)); // NEW
    for (const xml of [declaration.replace('svg11.dtd', 'other.dtd') + svg, '<!DOCTYPE svg [<!ENTITY x "unsafe">]>' + svg, declaration + svg.replace('<text>', '<script/> <text>'), declaration + svg.replace('<text>', '<image href="https://private.example.test/secret"/> <text>')]) assert.equal(w.TrellisContentPolicy.imageSource('data:image/svg+xml;base64,' + Buffer.from(xml).toString('base64')), null); // NEW
    assert.equal(w.TrellisContentPolicy.imageSource(safe), safe); const plain = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'); assert.equal(w.TrellisContentPolicy.imageSource(plain), plain); // NEW: safe URI encoding is stable, including Unicode.
    const diagnostics = w.TrellisContentPolicy.diagnostics(); assert.ok(diagnostics.some(item => item.code === 'INVALID_XML')); assert.ok(diagnostics.some(item => item.code === 'INVALID_IMAGE')); assert.doesNotMatch(JSON.stringify(diagnostics), /private|secret|DOCTYPE|http/); diagnostics[0].code = 'changed'; assert.notEqual(w.TrellisContentPolicy.diagnostics()[0].code, 'changed'); // NEW
    w.TrellisContentPolicy.resetDocument(); assert.equal(w.TrellisContentPolicy.diagnostics().length, 0); assert.equal(w.TrellisContentPolicy.imageSource('https://private.example.test/secret'), null); w.TrellisContentPolicy.resetDocument(); assert.equal(w.TrellisContentPolicy.imageSource('https://private.example.test/secret'), null); assert.deepEqual(Array.from(w.TrellisContentPolicy.diagnostics(), item => item.code), ['IMAGE_REJECTED']); // NEW
}); // NEW

test('the shipped bundle retains every embedded editor icon and uses CSS for its static spinner', async t => { // NEW
    const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://fixture.test/' }), w = dom.window; t.after(() => w.close()); w.mxLoadResources = false; w.mxLoadStylesheets = false; w.urlParams = {}; w.HTMLCanvasElement.prototype.getContext = () => null; w.HTMLCanvasElement.prototype.toDataURL = () => ''; // NEW
    for (const file of ['js/trellis-content-policy.js', 'js/app.min.js', 'js/trellis-content-install.js']) w.eval(await fs.readFile(path.join(webapp, file), 'utf8')); // NEW
    let icons = 0, declarations = 0; // NEW
    for (const object of [w.HoverIcons.prototype, w.Editor, w.mxVertexHandler.prototype, w.mxEdgeHandler.prototype, w.mxWindow.prototype]) for (const key of Object.keys(object)) { const value = typeof object[key] === 'string' ? object[key] : object[key]?.src; if (!value?.startsWith('data:image/svg+xml')) continue; const safe = w.TrellisContentPolicy.imageSource(value); assert.ok(safe, key); const xml = safe.startsWith('data:image/svg+xml;base64,') ? w.atob(safe.split(',')[1]) : decodeURIComponent(safe.split(',')[1]); assert.doesNotMatch(xml, /<!DOCTYPE|animateTransform/); if (value.startsWith('data:image/svg+xml;base64,') && w.atob(value.split(',')[1]).startsWith('<!DOCTYPE')) declarations++; icons++; } // NEW
    assert.ok(icons >= 175); assert.ok(declarations >= 29); assert.ok([...w.document.styleSheets].some(sheet => [...sheet.cssRules].some(rule => rule.cssText.includes('trellis-status-spin')))); await new Promise(resolve => w.setTimeout(resolve, 0)); assert.equal(w.document.querySelector('[data-trellis-content-notice]'), null); assert.equal(w.TrellisContentPolicy.diagnostics().length, 0); // NEW
}); // NEW

const svgUriForms = ['', ';utf8', ';charset=utf-8', ';charset=utf8', ';base64', ';charset=utf-8;base64', ';charset=utf8;base64', ';UTF8;BASE64']; // NEW
function svgUri(xml, parameters = '') { return 'data:image/svg+xml' + parameters + ',' + (/base64/i.test(parameters) ? Buffer.from(xml, 'utf8').toString('base64') : encodeURIComponent(xml)); } // NEW

test('SVG data URI headers select one explicit decoding and preserve safe Unicode sources', async t => { // NEW
    const w = await browser(t), svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Jalapeño 🌱, 50% &amp; %3C</text></svg>'; // NEW
    for (const parameters of svgUriForms) { const uri = svgUri(svg, parameters); assert.equal(w.TrellisContentPolicy.imageSource(uri), uri, parameters); assert.equal(w.Graph.sanitizeHtml('<img src="' + uri + '">').includes(uri), true, parameters); } // NEW
    for (const uri of ['data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><text>raw, 🌱</text></svg>', svgUri('<?xml version="1.0" encoding="UTF-8"?>\n' + svg, ';utf8'), svgUri(svg, ';charset=UTF-8').replace('data:image/svg+xml', 'DATA:IMAGE/SVG+XML')]) assert.equal(w.TrellisContentPolicy.imageSource(uri), uri); // NEW
    assert.equal(w.TrellisContentPolicy.diagnostics().length, 0); // NEW
}); // NEW

test('ambiguous or malformed SVG encodings never fall back to another interpretation', async t => { // NEW
    const w = await browser(t), svg = '<svg xmlns="http://www.w3.org/2000/svg"/>', prefix = 'data:image/svg+xml'; // NEW
    for (const parameters of [';', ';unknown=1', ';charset=iso-8859-1', ';charset=utf-16', ';utf8;charset=utf-8', ';charset=utf-8;charset=utf8', ';base64;base64', ';base64;charset=utf-8', ';utf8;utf8', ';base64;unknown=1']) assert.equal(w.TrellisContentPolicy.imageSource(svgUri(svg, parameters)), null, parameters); // NEW
    for (const uri of [prefix + ';utf8,%', prefix + ';utf8,%GG', prefix + ';utf8,%FF', prefix + ';base64,A', prefix + ';base64,%%%%', prefix + ';base64,/w==', prefix + ',' + Buffer.from(svg).toString('base64'), prefix + ';utf8,' + encodeURIComponent(encodeURIComponent(svg)), prefix + ';' + 'x'.repeat(257) + ',' + encodeURIComponent(svg), prefix + ';utf8']) assert.equal(w.TrellisContentPolicy.imageSource(uri), null); // NEW
    assert.doesNotMatch(JSON.stringify(w.TrellisContentPolicy.diagnostics()), /DOCTYPE|data:|unknown=|http/); // NEW
}); // NEW

test('every SVG encoding retains active-content, entity, dependency and cycle rejection', async t => { // NEW
    const w = await browser(t), contents = ['<script>bad()</script>', '<path onclick="bad()"/>', '<image href="http://127.0.0.1/private"/>', '<path style="fill:url(https://invalid.test/image)"/>', '<animateTransform attributeName="transform"/>', '<g id="a"><use href="#a"/></g>']; // NEW
    for (const parameters of svgUriForms) { for (const content of contents) assert.equal(w.TrellisContentPolicy.imageSource(svgUri('<svg xmlns="http://www.w3.org/2000/svg">' + content + '</svg>', parameters)), null, parameters + ': ' + content); assert.equal(w.TrellisContentPolicy.imageSource(svgUri('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///private">]><svg xmlns="http://www.w3.org/2000/svg"/>', parameters)), null); } // NEW
}); // NEW

test('SVG URI byte limits precede decoding and DOM allocation, including threefold percent expansion', async t => { // NEW
    const w = await browser(t), originalParse = w.DOMParser.prototype.parseFromString, svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>', suffix = '</text></svg>', textSize = LIMITS.svg - Buffer.byteLength(svg + suffix); let parses = 0, decodedBytes = 0, resolvedUrls = 0; // NEW
    t.mock.method(w, 'URL', function () { resolvedUrls++; throw Error('Inline SVG must not enter the general URL resolver.'); }); // NEW
    t.mock.method(w.DOMParser.prototype, 'parseFromString', function (xml, mime) { parses++; decodedBytes = Buffer.byteLength(xml); return originalParse.call(this, '<svg xmlns="http://www.w3.org/2000/svg"/>', mime); }); // NEW: inspect bytes reaching the boundary without allocating a multi-megabyte test DOM.
    const encoded = encodeURIComponent(svg) + '%61'.repeat(textSize) + encodeURIComponent(suffix), exact = 'data:image/svg+xml;utf8,' + encoded; assert.ok(w.TrellisContentPolicy.imageSource(exact) === exact, 'At-limit SVG rejected: ' + JSON.stringify(w.TrellisContentPolicy.diagnostics())); assert.equal(decodedBytes, LIMITS.svg); assert.equal(parses, 1); // NEW
    assert.equal(w.TrellisContentPolicy.imageSource('data:image/svg+xml;utf8,' + encoded + 'a'), null); assert.equal(parses, 1); // NEW
    const oversizedBase64 = 'data:image/svg+xml;base64,' + 'A'.repeat(4 * Math.ceil(LIMITS.svg / 3) + 4), oversizedPercent = 'data:image/svg+xml;utf8,' + '%61'.repeat(LIMITS.svg + 1); let decodes = 0; // NEW
    t.mock.method(w, 'atob', () => { decodes++; throw Error('should be bounded first'); }); t.mock.method(w, 'decodeURIComponent', () => { decodes++; throw Error('should be bounded first'); }); // NEW
    assert.equal(w.TrellisContentPolicy.imageSource(oversizedBase64), null); assert.equal(w.TrellisContentPolicy.imageSource(oversizedPercent), null); assert.equal(decodes, 0); assert.equal(parses, 1); assert.equal(resolvedUrls, 0); // NEW
}); // NEW

test('the navigator plugin actual five SVG constants pass the shared policy', async t => { // NEW
    const w = await browser(t), source = await fs.readFile(path.join(webapp, 'plugins/garden_planner_plugins/Bed_Succession_Navigator.js'), 'utf8'), ast = parseJavaScript(source), icons = []; // NEW
    function visit(node) { if (!node || typeof node !== 'object') return; if (node.type === 'VariableDeclarator' && /^ICON_/.test(node.id?.name)) icons.push({ name: node.id.name, uri: w.eval(source.slice(node.init.start, node.init.end)) }); for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value); } visit(ast); // NEW
    assert.deepEqual(icons.map(icon => icon.name).sort(), ['ICON_NEXT', 'ICON_PREV', 'ICON_SELECT', 'ICON_SELECT_ASSEMBLY', 'ICON_SELECT_BEDS']); for (const icon of icons) assert.equal(w.TrellisContentPolicy.imageSource(icon.uri), icon.uri, icon.name); await new Promise(resolve => w.setTimeout(resolve, 0)); assert.equal(w.document.querySelector('[data-trellis-content-notice]'), null); // NEW
}); // NEW
