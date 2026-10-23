/** Run production cases serially, with immutable inputs and campaign-specific reports. */ // CHANGE
const fs = require('node:fs'), path = require('node:path'); // CHANGE
const { spawnSync } = require('node:child_process'); // CHANGE
const { captureSources, manifestSources, verifySources } = require('../test/helpers/responsiveness-sources.cjs'); // CHANGE
const project = path.resolve(__dirname, '..'), root = path.join(project, '.test-artifacts/responsiveness'); // CHANGE
const argument = name => process.argv.find(value => value.startsWith('--' + name + '='))?.slice(name.length + 3); // CHANGE
const campaign = argument('campaign') || 'campaign-' + Date.now(); // CHANGE
if (!/^[a-zA-Z0-9-]+$/.test(campaign)) throw Error('Invalid campaign name.'); // CHANGE
const output = path.join(root, campaign); fs.mkdirSync(output, { recursive: true }); // CHANGE
if (process.argv.includes('--capture-baseline')) { captureSources(project, path.join(output, 'baseline-sources')); console.log('Captured baseline:', output); process.exit(0); } // CHANGE
const baseline = process.argv.includes('--baseline'), profiling = process.argv.includes('--profile'), smoke = process.argv.includes('--smoke'); // CHANGE
const sourceRoot = baseline ? path.join(output, 'baseline-sources') : captureSources(project, path.join(output, 'sources-' + Date.now())); // CHANGE
if (baseline && !fs.existsSync(path.join(sourceRoot, 'manifest.json'))) manifestSources(sourceRoot); // CHANGE: retain the manually captured checkpoint.
const harnessRoot = path.join(output, 'harness-sources'); // CHANGE
if (!fs.existsSync(harnessRoot)) captureSources(project, harnessRoot); // CHANGE: every comparison uses the same instrumented machinery.
const summary = { campaign, baseline, profiling, smoke, sourceRoot, complete: false, accepted: false, cases: [] }; // CHANGE
const selectedMode = argument('mode'), selectedRecords = argument('records'); // CHANGE
if (selectedMode && !['local', 'private', 'shared'].includes(selectedMode) || selectedRecords && !['0', '1000'].includes(selectedRecords)) throw Error('Invalid benchmark mode or record count.'); // CHANGE
const variants = [['local', 0], ['private', 0], ['private', 1000], ['shared', 0], ['shared', 1000]].filter(([mode, records]) => (!selectedMode || mode === selectedMode) && (!selectedRecords || String(records) === selectedRecords)); // CHANGE
const prefix = `${baseline ? 'before' : 'after'}${profiling ? '-profile' : smoke ? '-smoke' : ''}-${Date.now()}`, summaryPath = path.join(output, prefix + '-matrix.json'); // CHANGE
for (const [mode, records] of variants) for (let run = 1; run <= (smoke || profiling ? 1 : 3); run++) { // CHANGE
    verifySources(sourceRoot); verifySources(harnessRoot); // CHANGE
    const label = `${prefix}-${mode}-${records}-run${run}`, log = fs.openSync(path.join(output, label + '.log'), 'wx'); // CHANGE
    const env = { ...process.env, TRELLIS_RESPONSIVENESS_PROJECT: project, TRELLIS_RESPONSIVENESS_OUTPUT: output, TRELLIS_RESPONSIVENESS_LABEL: label, TRELLIS_RESPONSIVENESS_SOURCE_ROOT: sourceRoot, TRELLIS_RESPONSIVENESS_MODE: mode, TRELLIS_JOURNAL_RECORDS: String(records), TRELLIS_RESPONSIVENESS_RUN: String(run), TRELLIS_RESPONSIVENESS_SAMPLES: smoke || profiling ? '3' : '30', TRELLIS_RESPONSIVENESS_IDLE_MS: smoke || profiling ? '100' : '60000' }; delete env.ELECTRON_RUN_AS_NODE; // CHANGE
    console.log('Running', label); // CHANGE
    const child = spawnSync(require('electron'), [path.join(harnessRoot, 'helpers/module-clusters-production-electron.cjs'), '--responsiveness', ...(baseline ? ['--baseline'] : []), ...(profiling ? ['--profile'] : [])], { cwd: project, env, windowsHide: true, stdio: ['ignore', log, log], timeout: 660000 }); // CHANGE
    fs.closeSync(log); const filename = path.join(output, label + '.json'); // CHANGE
    const result = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : { complete: false, accepted: false, error: child.error?.message || 'No production result was written.' }; // CHANGE
    try { verifySources(sourceRoot); verifySources(harnessRoot); } catch (error) { result.complete = false; result.accepted = false; result.error = error.message; } // CHANGE
    summary.cases.push({ label, run, exitCode: child.status, ...result }); fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2)); // CHANGE
    console.log(label, result.complete ? 'completed' : 'incomplete', result.accepted ? 'passed' : 'acceptance not met'); // CHANGE
} // CHANGE
summary.complete = summary.cases.every(result => result.complete); // CHANGE
summary.accepted = !smoke && !profiling && summary.cases.length === 15 && summary.cases.every(result => result.accepted && result.exitCode === 0); // CHANGE
if (!baseline && !smoke && !profiling) { // CHANGE
    const beforeName = fs.readdirSync(output).filter(name => /^before-\d+-matrix\.json$/.test(name)).sort().at(-1); // CHANGE
    const before = beforeName && JSON.parse(fs.readFileSync(path.join(output, beforeName), 'utf8')); // CHANGE
    summary.saveComparisons = summary.cases.map(after => { const previous = before?.cases.find(item => item.mode === after.mode && item.records === after.records && item.run === after.run); const beforeMs = previous?.interactions?.saveP95, afterMs = after.interactions?.saveP95; return { label: after.label, beforeMs, afterMs, passed: !!previous?.complete && Number.isFinite(beforeMs) && Number.isFinite(afterMs) && afterMs <= beforeMs }; }); // CHANGE
    summary.accepted &&= summary.saveComparisons.every(result => result.passed); // CHANGE
} // CHANGE
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2)); console.log('Report:', summaryPath); // CHANGE
process.exitCode = summary.accepted || profiling && summary.complete ? 0 : 1; // CHANGE
