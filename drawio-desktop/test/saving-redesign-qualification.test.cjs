/** Release evidence must contain real raw measurements, stable content, portable drafts, and exact sources. */ // NEW
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'); // NEW
const { captureSources } = require('./helpers/responsiveness-sources.cjs'); // NEW
const { verifyInteractionWorkload, verifyInteractionQualification } = require('../scripts/check-saving-redesign-qualification.cjs'); // NEW
async function fixture(t) { // NEW
    const project = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-interaction-gate-')); t.after(async () => { assert.equal(path.dirname(project), path.resolve(os.tmpdir())); assert.ok(path.basename(project).startsWith('trellis-interaction-gate-')); await fs.rm(project, { recursive: true, force: true }); }); // NEW
    for (const name of ['src/main', 'drawio/src/main/webapp/js', 'drawio/src/main/webapp/plugins/garden_planner_plugins', 'test/helpers', 'drawio/src/main/webapp/mxgraph']) await fs.mkdir(path.join(project, name), { recursive: true }); // NEW
    for (const name of ['src/main/runtime.js', 'drawio/src/main/webapp/mxgraph/mxClient.js', 'drawio/src/main/webapp/index.html', 'package.json', 'package-lock.json']) await fs.writeFile(path.join(project, name), 'source'); // NEW
    const sourceRoot = captureSources(project, path.join(project, 'frozen')), result = { fullApplication: true, sampleCount: 5, statistic: 'slowest-three-mean', scenario: 'bed-then-dill', gardenProtocol: 5, sourceRoot, stable: true, mutations: 0, selectionStable: true, selectionMutations: 0, undoRedoRestored: true, pointerTargetVerified: true, focusedDuringPointer: true, rejections: [], frameTimeouts: 0, feedbackSamples: Array(5).fill(20), lifecycle: { reopened: true, portableChars: 2000000 }, portableExport: { verified: true, modified: true }, portableSaveAs: { verified: true, sourceUnchanged: true, modified: true } }; // CHANGE
    const summary = { sourceRoot, complete: true, accepted: true, requestedCampaigns: 1, sampleCount: 5, statistic: 'slowest-three-mean', targetMs: 100, runs: [] }; // CHANGE
    const resultFile = path.join(project, '5-1.json'); await fs.writeFile(resultFile, JSON.stringify(result)); summary.runs.push({ gardenProtocol: 5, campaignIndex: 1, exitCode: 0, resultFile }); // CHANGE
    const filename = path.join(project, 'summary.json'); await fs.writeFile(filename, JSON.stringify(summary)); return { project, sourceRoot, result, summary, filename }; // NEW
} // NEW
test('protocol 5 qualifies one real-application campaign against exact current sources', async t => { const f = await fixture(t); assert.equal(verifyInteractionQualification(f.project, f.filename).workloads, 1); }); // CHANGE
test('raw samples control the gate even when a supplied average claims success', async t => { const f = await fixture(t); f.result.slowestThreeMeanMs = 1; f.result.feedbackSamples[3] = 200; f.result.feedbackSamples[4] = 200; assert.throws(() => verifyInteractionWorkload(f.result, 5, f.sourceRoot), /100 ms/); }); // CHANGE
test('an individual slow sample may pass when the three-slowest average meets the limit', async t => { const f = await fixture(t); f.result.feedbackSamples[4] = 260; assert.equal(verifyInteractionWorkload(f.result, 5, f.sourceRoot), 100); assert.equal(f.result.feedbackSamples[4], 260); }); // CHANGE
for (const [name, mutate] of [ // NEW
    ['pointer edits', result => { result.mutations = 1; }], ['rejection attempts', result => { result.rejections = [{}]; }], ['timed-out frames', result => { result.frameTimeouts = 1; }], ['lost modified state', result => { result.portableExport.modified = false; }], ['a missing sample', result => { result.feedbackSamples.pop(); }], ['small catalogs', result => { result.lifecycle.portableChars = 100; }], // CHANGE
    ['blank-canvas pointer input', result => { result.pointerTargetVerified = false; }], // CHANGE
    ['background-frame measurements', result => { result.focusedDuringPointer = false; }] // NEW
]) test('interaction gate rejects ' + name, async t => { const f = await fixture(t); mutate(f.result); assert.throws(() => verifyInteractionWorkload(f.result, 5, f.sourceRoot), /remains closed/); }); // NEW
test('runtime source changes invalidate otherwise passing native evidence', async t => { const f = await fixture(t); await fs.writeFile(path.join(f.project, 'src/main/runtime.js'), 'changed'); assert.throws(() => verifyInteractionQualification(f.project, f.filename), /Runtime source changed/); }); // NEW
test('a protocol-4 workload cannot replace protocol 5', async t => { const f = await fixture(t); f.summary.runs[0].gardenProtocol = 4; await fs.writeFile(f.filename, JSON.stringify(f.summary)); assert.throws(() => verifyInteractionQualification(f.project, f.filename), /duplicated/); }); // CHANGE

for (const samples of [ // CHANGE
    [50, 1, 150.25, 2, 99.75], // CHANGE
    [100, 2, 100, 4, 100], // CHANGE
]) test('feedback uses the three slowest values with ties and fractions at the inclusive limit', async t => { // CHANGE
    const f = await fixture(t); f.result.feedbackSamples = samples; f.result.slowestThreeMeanMs = 99999; // CHANGE
    const original = samples.slice(); assert.equal(verifyInteractionWorkload(f.result, 5, f.sourceRoot), 100); assert.deepEqual(samples, original); // CHANGE
    f.result.feedbackSamples = samples.map(value => value + 0.125); assert.throws(() => verifyInteractionWorkload(f.result, 5, f.sourceRoot), /100 ms/); // CHANGE
}); // CHANGE

for (const [name, mutate] of [ // CHANGE
    ['extra sample', result => { result.feedbackSamples.push(1); }], // CHANGE
    ['thirty raw samples', result => { result.feedbackSamples = Array(30).fill(1); }], // CHANGE
    ['null sample', result => { result.feedbackSamples[0] = null; }], // CHANGE
    ['nonnumeric sample', result => { result.feedbackSamples[0] = '1'; }], // CHANGE
    ['negative sample', result => { result.feedbackSamples[0] = -1; }], // CHANGE
    ['non-finite sample', result => { result.feedbackSamples[0] = Infinity; }], // CHANGE
    ['old raw count', result => { result.sampleCount = 30; }], // CHANGE
    ['old raw statistic', result => { result.statistic = 'p95'; }], // CHANGE
    ['missing raw statistic', result => { delete result.statistic; }], // CHANGE
    ['selection changes', result => { result.selectionMutations = 1; }], // CHANGE
    ['undo/redo failure', result => { result.undoRedoRestored = false; }], // CHANGE
    ['reopen failure', result => { result.lifecycle.reopened = false; }], // CHANGE
    ['Save As changes source', result => { result.portableSaveAs.sourceUnchanged = false; }], // CHANGE
]) test('interaction qualification rejects ' + name, async t => { // CHANGE
    const f = await fixture(t); mutate(f.result); assert.throws(() => verifyInteractionWorkload(f.result, 5, f.sourceRoot), /remains closed/); // CHANGE
}); // CHANGE

for (const [name, mutate] of [ // CHANGE
    ['duplicate workload', summary => { summary.runs.push({ ...summary.runs[0] }); }], // CHANGE
    ['missing workload', summary => { summary.runs.pop(); }], // CHANGE
    ['incorrect campaign index', summary => { summary.runs[0].campaignIndex = 2; }], // CHANGE
    ['old repetitions', summary => { summary.requestedCampaigns = 3; }], // CHANGE
    ['old sample count', summary => { summary.sampleCount = 30; }], // CHANGE
    ['old statistic', summary => { summary.statistic = 'p95'; }], // CHANGE
    ['missing statistic', summary => { delete summary.statistic; }], // CHANGE
]) test('interaction summary rejects ' + name, async t => { // CHANGE
    const f = await fixture(t); mutate(f.summary); await fs.writeFile(f.filename, JSON.stringify(f.summary)); assert.throws(() => verifyInteractionQualification(f.project, f.filename), /remains closed/); // CHANGE
}); // CHANGE
