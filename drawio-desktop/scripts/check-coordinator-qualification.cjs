/** Fail closed unless the complete production campaign qualifies the exact current runtime sources. */ // NEW
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'); // NEW
const operations = ['manual', 'autosave', 'overlap', 'unchanged', 'refresh', 'checkpoint', 'invitation']; // NEW
const groups = { main: 'src/main', 'browser-js': 'drawio/src/main/webapp/js', plugins: 'drawio/src/main/webapp/plugins/garden_planner_plugins', helpers: 'test/helpers' }; // NEW
const files = { 'package.json': 'package.json', 'package-lock.json': 'package-lock.json', 'mxClient.js': 'drawio/src/main/webapp/mxgraph/mxClient.js', 'index.html': 'drawio/src/main/webapp/index.html' }; // NEW
const fail = message => { throw new Error('Coordinator qualification remains closed: ' + message); }; // NEW
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8')); // NEW
const hash = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'); // NEW

/** Compare inventories as well as hashes so new, unmeasured production code cannot pass an older gate. */ // NEW
function verifyRuntime(project, sourceRoot) { // NEW
    const manifest = read(path.join(sourceRoot, 'manifest.json')), current = new Map(); // NEW
    function visit(directory, prefix) { // NEW
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { // NEW
            const filename = path.join(directory, entry.name), relative = prefix + '/' + entry.name; // NEW
            if (entry.isDirectory()) visit(filename, relative); else if (entry.isFile()) current.set(relative, filename); else fail('Unsupported runtime source: ' + relative); // NEW
        } // NEW
    } // NEW
    for (const [prefix, directory] of Object.entries(groups)) visit(path.join(project, directory), prefix); // NEW
    for (const [relative, filename] of Object.entries(files)) current.set(relative, path.join(project, filename)); // NEW
    const normalized = new Map(Object.entries(manifest).map(([relative, digest]) => [relative.replaceAll('\\', '/'), digest])); // NEW
    if (normalized.size !== current.size) fail('Runtime source inventory changed.'); // NEW
    for (const [relative, filename] of current) { // NEW
        const expected = normalized.get(relative); // NEW
        if (!expected || hash(filename) !== expected || hash(path.join(sourceRoot, relative)) !== expected) fail('Runtime source changed: ' + relative); // NEW
    } // NEW
} // NEW

/** Validate scheduling separately from real execution, including strict legacy all-real reports. */ // NEW
function verifyAutosaveTiming(workload, expectedMode = 'real') { // NEW
    const invalid = () => fail('Autosave did not preserve its scheduling and automatic execution.'); // NEW
    if (!['real', 'split'].includes(expectedMode) || workload.rendererTimings?.filter(item => item.phase === 'save queue' && item.automatic === true).length !== 30) invalid(); // NEW
    const timing = workload.autosaveTiming; // NEW
    if (timing === undefined) { // NEW
        if (expectedMode !== 'real' || !Array.isArray(workload.autosaveScheduling) || workload.autosaveScheduling.length !== 30 || workload.autosaveScheduling.some(value => !Number.isFinite(value) || value < 20000)) invalid(); // NEW
        return; // NEW: historical evidence keeps its original strict wall-clock requirements.
    } // NEW
    if (!timing || timing.version !== 1 || timing.mode !== expectedMode || workload.autosaveScheduling !== undefined || !Array.isArray(timing.records) || timing.records.length !== 30) invalid(); // NEW
    timing.records.forEach((record, index) => { // NEW
        const controlled = expectedMode === 'split' && index > 0; // NEW
        if (!record || record.sampleIndex !== index || record.mode !== (controlled ? 'controlled' : 'real') || !Number.isFinite(record.wallWaitMs) || record.wallWaitMs < (controlled ? 0 : 20000) || record.quietAdvanceMs !== (controlled ? 20000 : 0) || !Number.isFinite(record.remainingBeforeMs) || record.remainingBeforeMs <= 0 || record.remainingBeforeMs > 20000 || record.remainingAfterMs !== 0 || record.executionAdvanceMs !== 0) invalid(); // NEW
    }); // NEW
} // NEW

/** Re-evaluate raw samples instead of trusting summary booleans or precomputed p95 values. */ // NEW
function verifyWorkload(result, run, sourceRoot) { // NEW
    const workload = result.cases?.[0]; // NEW
    if (!result.complete || !result.accepted || result.suspended || result.sampleCount !== 30 || result.recordCount !== run.edits || result.cases?.length !== 1 || path.resolve(result.sourceRoot) !== sourceRoot || workload?.gardenProtocol !== run.gardenProtocol || workload?.mode !== 'shared' || workload.productionService !== true || workload.historicalContentRevisions !== run.edits) fail('Missing complete production workload: ' + run.campaignIndex + '/' + run.edits); // NEW
    if (workload.archiveAudit?.archiveScans !== 0 || workload.archiveAudit?.historicalRecordsRead !== 0 || !workload.timings?.some(item => item.phase === 'read') || workload.timings.filter(item => item.phase === 'read').some(item => item.replayCount !== 0 || item.historicalRecordsRead !== 0)) fail('Historical work was observed.'); // NEW
    verifyAutosaveTiming(workload, run.autosaveTimingMode ?? 'real'); // CHANGE: split evidence never presents injected time as a real wait.
    for (const operation of operations) { // NEW
        const samples = workload.samples?.[operation]; // NEW
        if (!Array.isArray(samples) || samples.length !== 30 || samples.some(value => !Number.isFinite(value) || value < 0) || workload.rendererTimings.filter(item => item.phase === 'save UI completion' && item.operation === operation).length !== 30) fail('Incomplete operation: ' + operation); // NEW
        if (samples.slice().sort((a, b) => a - b)[Math.ceil(samples.length * .95) - 1] > 5000) fail('Five-second p95 exceeded: ' + operation); // NEW
    } // NEW
} // NEW

function verifyQualification(project, reportFile) { // NEW
    const summary = read(reportFile), sourceRoot = path.resolve(summary.sourceRoot); // NEW
    if (summary.pilot !== undefined && summary.pilot !== false) fail('Pilot reports cannot qualify a release.'); // NEW
    const autosaveTimingMode = summary.autosaveTimingMode ?? 'real'; // NEW
    if (!['real', 'split'].includes(autosaveTimingMode)) fail('Unknown autosave timing policy.'); // NEW
    if (!summary.complete || !summary.accepted || summary.requestedCampaigns !== 3 || summary.sampleCount !== 30 || summary.targetMs !== 5000 || JSON.stringify(summary.protocols) !== '[4,5]' || JSON.stringify(summary.editCounts) !== '[0,10000]' || summary.runs?.length !== 12) fail('All twelve fresh-and-10000 workloads across both formats must qualify.'); // CHANGE: user-approved matrix retains fresh initialization and large-history cases.
    const expected = new Set([4, 5].flatMap(protocol => [1, 2, 3].flatMap(campaign => [0, 10000].map(edits => protocol + '/' + campaign + '/' + edits)))); // CHANGE
    for (const run of summary.runs) { // NEW
        if (!expected.delete(run.gardenProtocol + '/' + run.campaignIndex + '/' + run.edits) || run.exitCode !== 0 || !run.qualified || !run.measurementComplete || !run.historyIndependent) fail('Missing, duplicated, or failed campaign workload.'); // NEW
        if ((run.autosaveTimingMode ?? 'real') !== autosaveTimingMode) fail('Mixed autosave timing policies.'); // NEW
        verifyWorkload(read(run.resultFile), run, sourceRoot); // NEW
    } // NEW
    verifyRuntime(project, sourceRoot); // NEW
    return { accepted: true, reportFile: path.resolve(reportFile), sourceRoot, workloads: 12 }; // CHANGE
} // NEW

if (require.main === module) { // NEW
    try { // NEW
        const project = path.resolve(__dirname, '..'), supplied = process.argv.slice(2); // NEW
        if (supplied.length !== 1) fail('Supply the qualification summary.json path.'); // NEW
        console.log(JSON.stringify(verifyQualification(project, path.resolve(supplied[0])), null, 2)); // NEW
    } catch (error) { console.error(error.message); process.exitCode = 1; } // NEW
} // NEW
module.exports = { verifyQualification, verifyRuntime, verifyWorkload, verifyAutosaveTiming }; // CHANGE: runner and verifier share the same scheduling evidence validation.
