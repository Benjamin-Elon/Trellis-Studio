/** Qualification cannot be unlocked by incomplete samples, summary flags, or changed runtime sources. */ // NEW
const test = require('node:test'), assert = require('node:assert/strict'); // NEW
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto'); // NEW
const { verifyQualification, verifyWorkload } = require('../scripts/check-coordinator-qualification.cjs'); // CHANGE
const operations = ['manual', 'autosave', 'overlap', 'unchanged', 'refresh', 'checkpoint', 'invitation']; // NEW
/** Execute the benchmark's actual I/O guard so a missing protocol path cannot silently report zero scans. */ // NEW
test('archive audit blocks covered reads and enumeration in protocol 5', async () => { // CHANGE
    const parser = require('@babel/parser'), traverse = require('@babel/traverse').default, vm = require('node:vm'); // NEW
    const source = await fs.readFile(path.join(__dirname, 'helpers/garden-save-performance-electron.cjs'), 'utf8'); let guard; // NEW
    traverse(parser.parse(source), { noScope: true, AssignmentExpression(entry) { const node = entry.node; if (node.left.object?.name === 'fs' && node.left.property?.name === 'method' && node.right.type === 'FunctionExpression') guard = source.slice(node.right.start, node.right.end); } }); // NEW
    assert.ok(guard, 'The production benchmark I/O guard must be exercised.'); // NEW
    const folderPath = path.resolve('isolated-audit-project'), audit = { archiveScans: 0, historicalRecordsRead: 0, coveredSequence: 100 }; // NEW
    const context = { path, canvas: { folderPath }, archiveAudit: audit, method: 'readFile', original: async () => 'allowed' }, invoke = vm.runInNewContext('(' + guard + ')', context); // NEW
    const epoch = path.join(folderPath, '.trellis', 'collaboration-v5', 'epochs', 'epoch'); // CHANGE
    for (const method of ['open', 'readFile']) { context.method = method; await assert.rejects(invoke(path.join(epoch, '000000000100.json')), /covered historical decision/); } // NEW
    assert.equal(audit.historicalRecordsRead, 2); // NEW
    for (const method of ['readdir', 'opendir']) { context.method = method; await assert.rejects(invoke(epoch), /enumerate committed archives/); } // NEW
    assert.equal(audit.archiveScans, 2); context.method = 'readFile'; // NEW
    assert.equal(await invoke(path.join(epoch, '000000000101.json')), 'allowed'); // NEW: current uncovered tail records remain readable.
    assert.equal(await invoke(path.join(folderPath, '..', 'other-project', '.trellis', 'collaboration-v5', 'epochs', 'epoch', '000000000100.json')), 'allowed'); // CHANGE
    context.archiveAudit = null; assert.equal(await invoke(path.join(epoch, '000000000100.json')), 'allowed'); // NEW: fixture seeding occurs outside the measured audit.
}); // NEW
async function fixture(t, timingMode = 'split') { // CHANGE: all fixtures use the versioned evidence emitted by current runners.
    const project = await fs.mkdtemp(path.join(os.tmpdir(), 'trellis-qualification-')), sourceRoot = path.join(project, 'frozen'); // NEW
    t.after(async () => { assert.equal(path.dirname(project), path.resolve(os.tmpdir())); assert.ok(path.basename(project).startsWith('trellis-qualification-')); await fs.rm(project, { recursive: true, force: true }); }); // NEW
    const locations = { 'main/contract.js': 'src/main/contract.js', 'package.json': 'package.json', 'package-lock.json': 'package-lock.json', 'mxClient.js': 'drawio/src/main/webapp/mxgraph/mxClient.js', 'index.html': 'drawio/src/main/webapp/index.html' }; // NEW
    for (const directory of ['src/main', 'drawio/src/main/webapp/js', 'drawio/src/main/webapp/plugins/garden_planner_plugins', 'test/helpers']) await fs.mkdir(path.join(project, directory), { recursive: true }); // NEW
    const manifest = {}; // NEW
    for (const [relative, filename] of Object.entries(locations)) { // NEW
        const contents = 'source fixture: ' + relative, original = path.join(project, filename), frozen = path.join(sourceRoot, relative); // NEW
        await fs.mkdir(path.dirname(original), { recursive: true }); await fs.mkdir(path.dirname(frozen), { recursive: true }); // NEW
        await fs.writeFile(original, contents); await fs.writeFile(frozen, contents); manifest[relative] = crypto.createHash('sha256').update(contents).digest('hex'); // NEW
    } // NEW
    await fs.writeFile(path.join(sourceRoot, 'manifest.json'), JSON.stringify(manifest)); // NEW
    const summary = { complete: true, accepted: true, requestedCampaigns: 1, protocols: [5], editCounts: [0, 10000], sampleCount: 5, statistic: 'slowest-three-mean', targetMs: 5000, sourceRoot, runs: [] }; // CHANGE
    summary.autosaveTimingMode = timingMode; // CHANGE
    const gardenProtocol = 5, campaignIndex = 1; // CHANGE
    for (const edits of [0, 10000]) { // CHANGE
        const resultFile = path.join(project, 'protocol-' + gardenProtocol + '-run-' + campaignIndex + '-' + edits + '.json'); // NEW
        const rendererTimings = operations.flatMap(operation => Array.from({ length: 5 }, () => ({ phase: 'save UI completion', operation }))).concat(Array.from({ length: 5 }, () => ({ phase: 'save queue', automatic: true }))); // CHANGE
        const workload = { gardenProtocol, mode: 'shared', productionService: true, historicalContentRevisions: edits, archiveAudit: { archiveScans: 0, historicalRecordsRead: 0 }, timings: [{ phase: 'read', replayCount: 0, historicalRecordsRead: 0 }], rendererTimings, samples: Object.fromEntries(operations.map(name => [name, Array(5).fill(1000)])) }; // CHANGE: qualification independently requires the twenty-second production quiet period.
        workload.autosaveTiming = { version: 1, mode: timingMode, records: Array.from({ length: 5 }, (_, sampleIndex) => { const controlled = timingMode === 'split' && sampleIndex > 0; return { sampleIndex, mode: controlled ? 'controlled' : 'real', wallWaitMs: controlled ? 0.01 : 20000, quietAdvanceMs: controlled ? 20000 : 0, remainingBeforeMs: 19999, remainingAfterMs: 0, executionAdvanceMs: 0 }; }) }; // CHANGE
        await fs.writeFile(resultFile, JSON.stringify({ complete: true, accepted: true, sampleCount: 5, statistic: 'slowest-three-mean', recordCount: edits, sourceRoot, cases: [workload] })); // CHANGE
        summary.runs.push({ autosaveTimingMode: timingMode, gardenProtocol, campaignIndex, edits, exitCode: 0, qualified: true, measurementComplete: true, historyIndependent: true, resultFile }); // CHANGE
    } // NEW
    const reportFile = path.join(project, 'summary.json'), writeSummary = () => fs.writeFile(reportFile, JSON.stringify(summary)); await writeSummary(); // NEW
    return { project, sourceRoot, reportFile, summary, writeSummary }; // NEW
} // NEW

test('complete source-bound qualification opens the gate', async t => { // NEW
    const f = await fixture(t); assert.equal(verifyQualification(f.project, f.reportFile).workloads, 2); // CHANGE
}); // NEW
test('longer scheduling waits qualify with autosave execution at the five-second slowest-three mean limit', async t => { // CHANGE
    const f = await fixture(t, 'real'), filename = f.summary.runs[0].resultFile, result = JSON.parse(await fs.readFile(filename, 'utf8')); // CHANGE
    for (const record of result.cases[0].autosaveTiming.records) record.wallWaitMs = 20001; // CHANGE: scheduling is excluded from execution timing.
    result.cases[0].samples.autosave = Array(5).fill(5000); // CHANGE
    await fs.writeFile(filename, JSON.stringify(result)); assert.equal(verifyQualification(f.project, f.reportFile).workloads, 2); // CHANGE
}); // NEW
for (const [name, mutate] of [ // NEW
    ['a single 19,999 ms wait', workload => { workload.autosaveTiming.records[4].wallWaitMs = 19999; }], // CHANGE
    ['five-second waits', workload => { for (const record of workload.autosaveTiming.records) record.wallWaitMs = 5000; }], // CHANGE
    ['a missing measurement', workload => { workload.autosaveTiming.records.pop(); }], // CHANGE
    ['missing scheduling evidence', workload => { delete workload.autosaveTiming; }], // CHANGE
    ['a null measurement', workload => { workload.autosaveTiming.records[0].wallWaitMs = null; }], // CHANGE
    ['a nonnumeric measurement', workload => { workload.autosaveTiming.records[0].wallWaitMs = '20000'; }], // CHANGE
]) test('autosave scheduling rejects ' + name, async t => { // NEW
    const f = await fixture(t, 'real'), filename = f.summary.runs[0].resultFile, result = JSON.parse(await fs.readFile(filename, 'utf8')); // CHANGE
    mutate(result.cases[0]); await fs.writeFile(filename, JSON.stringify(result)); // NEW
    assert.throws(() => verifyQualification(f.project, f.reportFile), /Autosave did not preserve its scheduling and automatic execution/); // NEW
}); // NEW
test('autosave scheduling rejects a non-finite numeric measurement', async t => { // NEW
    const f = await fixture(t, 'real'), filename = f.summary.runs[0].resultFile, result = JSON.parse(await fs.readFile(filename, 'utf8')); // CHANGE
    result.cases[0].autosaveTiming.records[0].wallWaitMs = 'overflow'; // CHANGE
    await fs.writeFile(filename, JSON.stringify(result).replace('"overflow"', '1e400')); // NEW: valid JSON can parse to Infinity, which exceeds the minimum but is not a finite measurement.
    assert.throws(() => verifyQualification(f.project, f.reportFile), /Autosave did not preserve its scheduling and automatic execution/); // NEW
}); // NEW
test('partial campaigns and duplicated history sizes cannot qualify', async t => { // NEW
    const f = await fixture(t); f.summary.complete = false; await f.writeSummary(); // NEW
    assert.throws(() => verifyQualification(f.project, f.reportFile), /Both fresh/); // CHANGE
    f.summary.complete = true; f.summary.runs[1].edits = 0; await f.writeSummary(); // NEW
    assert.throws(() => verifyQualification(f.project, f.reportFile), /duplicated/); // NEW
}); // NEW
for (const [name, mutate] of [ // NEW
    ['checkpoint slowest-three mean', result => { result.cases[0].samples.checkpoint = Array(5).fill(5001); }], // CHANGE
    ['autosave execution slowest-three mean', result => { result.cases[0].samples.autosave = Array(5).fill(5001); }], // CHANGE
    ['autosave branch', result => { result.cases[0].rendererTimings = result.cases[0].rendererTimings.filter(item => item.phase !== 'save queue'); }], // NEW
    ['UI completion', result => { result.cases[0].rendererTimings.pop(); result.cases[0].rendererTimings.shift(); }], // NEW
    ['archive scan', result => { result.cases[0].archiveAudit.archiveScans = 1; }], // NEW
    ['machine suspension', result => { result.suspended = true; }], // NEW
]) test('summary flags cannot conceal failed ' + name, async t => { // NEW
    const f = await fixture(t), filename = f.summary.runs[0].resultFile, result = JSON.parse(await fs.readFile(filename, 'utf8')); mutate(result); await fs.writeFile(filename, JSON.stringify(result)); // NEW
    assert.throws(() => verifyQualification(f.project, f.reportFile), /qualification remains closed/); // NEW
}); // NEW
test('changed or newly added runtime sources invalidate previous performance evidence', async t => { // NEW
    const f = await fixture(t), filename = path.join(f.project, 'src/main/contract.js'), original = await fs.readFile(filename); // NEW
    await fs.writeFile(filename, 'changed'); assert.throws(() => verifyQualification(f.project, f.reportFile), /Runtime source changed/); // NEW
    await fs.writeFile(filename, original); await fs.writeFile(path.join(f.project, 'src/main/new-module.js'), 'new'); // NEW
    assert.throws(() => verifyQualification(f.project, f.reportFile), /inventory changed/); // NEW
}); // NEW

test('large-history results cannot replace required fresh-project workloads', async t => { // NEW
    const f = await fixture(t); f.summary.editCounts = [10000]; f.summary.runs = f.summary.runs.filter(run => run.edits === 10000); await f.writeSummary(); // NEW
    assert.throws(() => verifyQualification(f.project, f.reportFile), /Both fresh/); // CHANGE
}); // NEW
test('resumed evidence is rechecked against raw samples instead of its prior success flag', async t => { // NEW
    const f = await fixture(t), run = f.summary.runs[0], raw = JSON.parse(await fs.readFile(run.resultFile, 'utf8')); run.reusedFrom = 'previous-summary.json'; raw.cases[0].samples.manual = Array(5).fill(5001); // CHANGE
    await fs.writeFile(run.resultFile, JSON.stringify(raw)); await f.writeSummary(); assert.throws(() => verifyQualification(f.project, f.reportFile), /Five-second slowest-three mean exceeded/); // CHANGE
}); // NEW

for (const mode of ['split', 'real']) test('versioned ' + mode + ' scheduling qualifies only with matching raw evidence', async t => { // NEW
    const f = await fixture(t, mode); assert.equal(verifyQualification(f.project, f.reportFile).workloads, 2); // CHANGE
}); // NEW
for (const [name, mutate] of [ // NEW
    ['short real wait', timing => { timing.records[0].wallWaitMs = 19999; }], // NEW
    ['short clock advance', timing => { timing.records[1].quietAdvanceMs = 19999; }], // NEW
    ['advanced first sample', timing => { timing.records[0].quietAdvanceMs = 20000; }], // NEW
    ['second real sample', timing => { timing.records[1].mode = 'real'; }], // NEW
    ['missing record', timing => { timing.records.pop(); }], // NEW
    ['duplicated index', timing => { timing.records[1].sampleIndex = 0; }], // NEW
    ['null record', timing => { timing.records[1] = null; }], // NEW
    ['negative wall time', timing => { timing.records[1].wallWaitMs = -1; }], // NEW
    ['nonnumeric wall time', timing => { timing.records[1].wallWaitMs = '20000'; }], // NEW
    ['missing wall time', timing => { delete timing.records[1].wallWaitMs; }], // NEW
    ['missing countdown reset', timing => { timing.records[1].remainingBeforeMs = 0; }], // NEW
    ['invalid countdown', timing => { timing.records[1].remainingBeforeMs = 20001; }], // NEW
    ['unexpired countdown', timing => { timing.records[1].remainingAfterMs = 1; }], // NEW
    ['execution clock advance', timing => { timing.records[1].executionAdvanceMs = 20000; }], // NEW
    ['missing mode', timing => { delete timing.mode; }], // CHANGE
    ['unknown mode', timing => { timing.mode = 'fast'; }], // NEW
    ['missing version', timing => { delete timing.version; }], // CHANGE
    ['unknown version', timing => { timing.version = 2; }], // NEW
]) test('split scheduling rejects ' + name, async t => { // NEW
    const f = await fixture(t, 'split'), filename = f.summary.runs[0].resultFile, result = JSON.parse(await fs.readFile(filename, 'utf8')); // NEW
    mutate(result.cases[0].autosaveTiming); await fs.writeFile(filename, JSON.stringify(result)); // NEW
    assert.throws(() => verifyQualification(f.project, f.reportFile), /Autosave did not preserve/); // NEW
}); // NEW
test('split policy rejects legacy waits, contradictory metadata and non-finite wall time', async t => { // NEW
    const f = await fixture(t, 'split'), filename = f.summary.runs[0].resultFile, result = JSON.parse(await fs.readFile(filename, 'utf8')); // NEW
    result.cases[0].autosaveScheduling = Array(5).fill(20000); await fs.writeFile(filename, JSON.stringify(result)); // CHANGE
    assert.throws(() => verifyQualification(f.project, f.reportFile), /Autosave did not preserve/); // NEW
    delete result.cases[0].autosaveScheduling; result.cases[0].autosaveTiming.records[1].wallWaitMs = 'overflow'; // NEW
    await fs.writeFile(filename, JSON.stringify(result).replace('"overflow"', '1e400')); assert.throws(() => verifyQualification(f.project, f.reportFile), /Autosave did not preserve/); // NEW
    delete result.cases[0].autosaveTiming; result.cases[0].autosaveScheduling = Array(5).fill(20000); await fs.writeFile(filename, JSON.stringify(result)); // CHANGE
    assert.throws(() => verifyQualification(f.project, f.reportFile), /Autosave did not preserve/); // NEW
}); // NEW
test('pilot flags and mixed timing policies cannot open the gate even with a complete passing matrix', async t => { // NEW
    const f = await fixture(t, 'split'); f.summary.pilot = true; await f.writeSummary(); // NEW
    assert.throws(() => verifyQualification(f.project, f.reportFile), /Pilot reports/); // NEW
    f.summary.pilot = false; f.summary.runs[0].autosaveTimingMode = 'real'; await f.writeSummary(); // NEW
    assert.throws(() => verifyQualification(f.project, f.reportFile), /Mixed autosave timing/); // NEW
    f.summary.autosaveTimingMode = 'fast'; await f.writeSummary(); assert.throws(() => verifyQualification(f.project, f.reportFile), /Unknown autosave timing/); // NEW
}); // NEW
test('qualification options default to split timing and explicitly retire pilot mode', () => { // CHANGE
    const { parseOptions } = require('../scripts/benchmark-coordinator-saves.cjs'); // CHANGE
    assert.deepEqual(parseOptions([]), { autosaveTimingMode: 'split', resume: null }); // CHANGE
    assert.equal(parseOptions(['--autosave-timing=real', '--resume', 'report.json']).autosaveTimingMode, 'real'); // CHANGE
    for (const args of [['--pilot'], ['--pilot=true'], ['--pilot', '--resume', 'report.json']]) assert.throws(() => parseOptions(args), /retired/); // CHANGE
    for (const args of [['--resume'], ['--autosave-timing=fast'], ['--autosave-timing=real', '--autosave-timing=split']]) assert.throws(() => parseOptions(args)); // CHANGE
}); // CHANGE

test('resume requires compatible sampling, statistic, and scheduling without accepting pilot reports', () => { // CHANGE
    const { verifyResumePolicy } = require('../scripts/benchmark-coordinator-saves.cjs'); // CHANGE
    const prior = { protocols: [5], sampleCount: 5, statistic: 'slowest-three-mean', autosaveTimingMode: 'split', runs: [{ autosaveTimingMode: 'split' }] }; // CHANGE
    verifyResumePolicy(prior, 'split'); // CHANGE
    assert.throws(() => verifyResumePolicy({ ...prior, protocols: [4, 5] }, 'split'), /protocol 5/); // CHANGE
    verifyResumePolicy({ ...prior, autosaveTimingMode: 'real', runs: [{ autosaveTimingMode: 'real' }] }, 'real'); // CHANGE
    assert.throws(() => verifyResumePolicy({ ...prior, pilot: true }, 'split'), /Pilot reports/); // CHANGE
    for (const incompatible of [{ sampleCount: 30 }, { statistic: 'p95' }, { statistic: undefined }]) assert.throws(() => verifyResumePolicy({ ...prior, ...incompatible }, 'split'), /five samples/); // CHANGE
    for (const incompatible of [{ autosaveTimingMode: 'real' }, { runs: [{}] }, { runs: null }]) assert.throws(() => verifyResumePolicy({ ...prior, ...incompatible }, 'split'), /same autosave timing/); // CHANGE
}); // CHANGE

for (const samples of [ // CHANGE: unsorted values, ties, and fractions must all select the three slowest.
    [4500.25, 2, 6000, 3, 4499.75], // CHANGE
    [1, 5000, 5000, 2, 5000], // CHANGE
]) test('save acceptance averages the three slowest raw samples at the inclusive limit', async t => { // CHANGE
    const f = await fixture(t), run = f.summary.runs[0], result = JSON.parse(await fs.readFile(run.resultFile, 'utf8')); // CHANGE
    result.cases[0].samples.manual = samples; result.cases[0].slowestThreeMeanMs = { manual: 999999 }; // CHANGE
    const original = samples.slice(), means = verifyWorkload(result, run, f.sourceRoot); // CHANGE
    assert.equal(means.manual, 5000); assert.deepEqual(samples, original); assert.equal(means.refresh, 1000); // CHANGE
    await fs.writeFile(run.resultFile, JSON.stringify(result)); assert.equal(verifyQualification(f.project, f.reportFile).workloads, 2); // CHANGE
    result.cases[0].samples.manual = samples.map(value => value + 0.125); result.cases[0].slowestThreeMeanMs.manual = 1; // CHANGE
    await fs.writeFile(run.resultFile, JSON.stringify(result)); assert.throws(() => verifyQualification(f.project, f.reportFile), /Five-second slowest-three mean exceeded/); // CHANGE
}); // CHANGE

for (const [name, mutate] of [ // CHANGE
    ['missing sample', result => { result.cases[0].samples.manual.pop(); }], // CHANGE
    ['extra sample', result => { result.cases[0].samples.manual.push(1); }], // CHANGE
    ['thirty raw samples', result => { result.cases[0].samples.manual = Array(30).fill(1); }], // CHANGE
    ['null sample', result => { result.cases[0].samples.manual[0] = null; }], // CHANGE
    ['nonnumeric sample', result => { result.cases[0].samples.manual[0] = '1'; }], // CHANGE
    ['negative sample', result => { result.cases[0].samples.manual[0] = -1; }], // CHANGE
    ['old raw count', result => { result.sampleCount = 30; }], // CHANGE
    ['old raw statistic', result => { result.statistic = 'p95'; }], // CHANGE
    ['missing raw statistic', result => { delete result.statistic; }], // CHANGE
    ['historical read', result => { result.cases[0].archiveAudit.historicalRecordsRead = 1; }], // CHANGE
]) test('save qualification rejects ' + name, async t => { // CHANGE
    const f = await fixture(t), run = f.summary.runs[0], result = JSON.parse(await fs.readFile(run.resultFile, 'utf8')); mutate(result); // CHANGE
    await fs.writeFile(run.resultFile, JSON.stringify(result)); assert.throws(() => verifyQualification(f.project, f.reportFile), /qualification remains closed/); // CHANGE
}); // CHANGE

test('save qualification rejects a non-finite raw operation sample', async t => { // CHANGE
    const f = await fixture(t), run = f.summary.runs[0], result = JSON.parse(await fs.readFile(run.resultFile, 'utf8')); result.cases[0].samples.manual[0] = 'overflow'; // CHANGE
    await fs.writeFile(run.resultFile, JSON.stringify(result).replace('"overflow"', '1e400')); assert.throws(() => verifyQualification(f.project, f.reportFile), /Incomplete operation/); // CHANGE
}); // CHANGE

for (const [name, mutate] of [ // CHANGE
    ['missing workload', summary => { summary.runs.pop(); }], // CHANGE
    ['unsupported history size', summary => { summary.runs[0].edits = 100; }], // CHANGE
    ['unsupported workload protocol', summary => { summary.runs[0].gardenProtocol = 4; }], // CHANGE
    ['incorrect campaign index', summary => { summary.runs[0].campaignIndex = 2; }], // CHANGE
    ['retired protocol', summary => { summary.protocols = [4]; summary.runs[0].gardenProtocol = 4; }], // CHANGE
    ['old repetitions', summary => { summary.requestedCampaigns = 3; }], // CHANGE
    ['old sample count', summary => { summary.sampleCount = 30; }], // CHANGE
    ['old statistic', summary => { summary.statistic = 'p95'; }], // CHANGE
    ['missing statistic', summary => { delete summary.statistic; }], // CHANGE
]) test('save summary rejects ' + name, async t => { // CHANGE
    const f = await fixture(t); mutate(f.summary); await f.writeSummary(); assert.throws(() => verifyQualification(f.project, f.reportFile), /qualification remains closed/); // CHANGE
}); // CHANGE

test('all-real qualification rejects unversioned scheduling arrays', async t => { // CHANGE
    const f = await fixture(t, 'real'), run = f.summary.runs[0], result = JSON.parse(await fs.readFile(run.resultFile, 'utf8')); // CHANGE
    delete result.cases[0].autosaveTiming; result.cases[0].autosaveScheduling = Array(5).fill(20000); // CHANGE
    await fs.writeFile(run.resultFile, JSON.stringify(result)); assert.throws(() => verifyQualification(f.project, f.reportFile), /Autosave did not preserve/); // CHANGE
}); // CHANGE

for (const mode of ['real', 'split']) test(mode + ' qualification and resume require explicit summary and run timing modes', async t => { // CHANGE
    const { verifyResumePolicy } = require('../scripts/benchmark-coordinator-saves.cjs'), f = await fixture(t, mode); // CHANGE
    delete f.summary.autosaveTimingMode; await f.writeSummary(); // CHANGE
    assert.throws(() => verifyQualification(f.project, f.reportFile), /Unknown autosave timing policy/); // CHANGE
    assert.throws(() => verifyResumePolicy(f.summary, mode), /same autosave timing policy/); // CHANGE
    f.summary.autosaveTimingMode = mode; delete f.summary.runs[0].autosaveTimingMode; await f.writeSummary(); // CHANGE
    assert.throws(() => verifyQualification(f.project, f.reportFile), /Mixed autosave timing policies/); // CHANGE
    assert.throws(() => verifyResumePolicy(f.summary, mode), /same autosave timing policy/); // CHANGE
}); // CHANGE
