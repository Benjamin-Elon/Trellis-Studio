/** Exercise the production spacing editor independently of legacy overlay selection/mounting. */ // NEW
const test = require('node:test'); // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const { loadPlantTilerMxGraph } = require('./helpers/plant-tiler-mxgraph-harness.cjs'); // NEW
const { createRegularSpacingFixture } = require('./helpers/regular-spacing-preview.cjs'); // NEW
test('planting spacing claims on editing and captures unapplied rows before discard without graph changes', async t => { // NEW
    const h = loadPlantTilerMxGraph(); t.after(h.close); const w = h.window; // NEW
    w.dbBridge = { resolvePath: async () => ({ dbPath: 'holds-test' }), open: async () => ({ dbId: 'holds-test' }), close: async () => {}, query: async () => ({ rows: [] }), exec: async () => { throw new Error('Drafts must not write defaults'); } }; // NEW
    for (const name of ['Garden_Roadmap_Core.js', 'Garden_Roadmap_Manager.js', 'Modules_Standalone.js', 'Garden_Scheduler_Shared_Core.js', 'Garden_Scheduler_Annual_Core.js', 'Garden_Scheduler_Perennial_Core.js', 'Garden_Scheduler_Dialog.js']) w.eval(fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins', name), 'utf8')); // NEW
    const fixture = await createRegularSpacingFixture(w, h.graph); let editor, touches = 0; // NEW
    w.Trellis = w.Trellis || {}; w.Trellis.sharing = { registerEditor(config) { editor = config; return { touch() { touches++; }, acquire: async () => true, active: () => true, dispose() {} }; } }; // NEW
    const body = w.document.createElement('div'); w.document.body.appendChild(body); const context = await fixture.tools.buildSpacingLayoutRows(h.graph, fixture.groups[0]); // NEW
    h.graph.__trellisPlantingSpacingEditor.render(body, context, {}); assert.ok(editor); assert.equal(touches, 0); const baseline = fixture.serialize(); // NEW
    const field = body.querySelector('input[type=number]'); assert.ok(field); field.value = '33'; field.dispatchEvent(new w.Event('input')); // NEW
    assert.ok(touches > 0); const recovered = JSON.parse(JSON.stringify(editor.capture())); assert.equal(recovered.rows[0].spacingXCm, '33'); assert.equal(fixture.serialize(), baseline); // NEW
    assert.ok(editor.targets().some(key => key.includes(fixture.groups[0].id))); editor.discard(); assert.equal(body.querySelector('input'), null); assert.equal(fixture.serialize(), baseline); // NEW
}); // NEW
