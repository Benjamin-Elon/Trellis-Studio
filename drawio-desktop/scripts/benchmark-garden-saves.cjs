/** Serial, frozen-source save measurements; incomplete runs never count as acceptance. */ // NEW
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'); // NEW
const { spawnSync } = require('node:child_process'); // NEW
const { captureSources, verifySources } = require('../test/helpers/responsiveness-sources.cjs'); // NEW
const project = path.resolve(__dirname, '..'), root = path.join(project, '.test-artifacts/save-performance'); // NEW
const campaign = path.join(root, 'campaign-' + Date.now()); fs.mkdirSync(campaign, { recursive: true }); // NEW
const sources = captureSources(project, path.join(campaign, 'sources')); // NEW
const args = process.argv.slice(2); // NEW
if (args.some(arg => !['--smoke', '--stress', '--mode=local', '--mode=private', '--mode=shared'].includes(arg))) throw new Error('Unsupported save benchmark argument.'); // NEW
const summary = { sourceRoot: sources, samplesPerOperation: args.includes('--smoke') ? 1 : 30, requestedRuns: 3, complete: false, accepted: false, runs: [] }; // NEW
const filename = path.join(campaign, 'summary.json'); // NEW
for (let run = 1; run <= 3; run++) { // NEW
    verifySources(sources); // NEW
    const resultFile = path.join(campaign, 'run-' + run + '.json'), logFile = path.join(campaign, 'run-' + run + '.log'), log = fs.openSync(logFile, 'wx'); // NEW
    const env = { ...process.env, TRELLIS_SAVE_PROJECT: project, TRELLIS_SAVE_SOURCE_ROOT: sources, TRELLIS_SAVE_OUTPUT: campaign, TRELLIS_SAVE_REPORT: resultFile }; delete env.ELECTRON_RUN_AS_NODE; // NEW
    let execution; // NEW
    try { execution = spawnSync(require('electron'), [path.join(sources, 'helpers/garden-save-performance-electron.cjs'), ...args], { cwd: project, env, windowsHide: true, stdio: ['ignore', log, log], timeout: 46 * 60 * 1000 }); } finally { fs.closeSync(log); } // NEW
    const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : { complete: false, accepted: false, error: 'No native result was written.' }; // NEW
    if (execution.error) { result.complete = false; result.accepted = false; result.launchError = execution.error.message; } // NEW
    try { verifySources(sources); } catch (error) { result.complete = false; result.accepted = false; result.sourceError = error.message; } // NEW
    summary.runs.push({ run, exitCode: execution.status, resultFile, logFile, ...result }); fs.writeFileSync(filename, JSON.stringify(summary, null, 2)); // NEW
    // Cleanup is limited to the exact temporary profile recorded by this test executable. // NEW
    if (result.profile && path.dirname(path.resolve(result.profile)) === path.resolve(os.tmpdir()) && path.basename(result.profile).startsWith('trellis-save-performance-')) { // NEW
        if (execution.error && process.platform === 'win32' && Number.isInteger(result.pid)) spawnSync('taskkill', ['/PID', String(result.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); // NEW
        try { fs.rmSync(result.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (error) { summary.runs.at(-1).cleanupError = error.message; } // NEW
    } // NEW
    console.log('Save run', run, result.complete ? 'completed' : 'incomplete', result.accepted ? 'target met' : 'acceptance not met'); // NEW
} // NEW
summary.complete = summary.runs.every(run => run.complete && run.exitCode === 0); // NEW
summary.accepted = !args.includes('--smoke') && !args.includes('--stress') && !args.some(arg => arg.startsWith('--mode=')) && summary.complete && summary.runs.every(run => run.accepted); // NEW
fs.writeFileSync(filename, JSON.stringify(summary, null, 2)); console.log('Report:', filename); process.exitCode = summary.accepted ? 0 : 1; // NEW
