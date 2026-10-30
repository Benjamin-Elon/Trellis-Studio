/** Frozen, serial milestone-one qualification. Partial runs never unlock later milestones. */ // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const os = require('node:os'); // NEW
const { spawnSync } = require('node:child_process'); // NEW
const { captureSources, verifySources } = require('../test/helpers/responsiveness-sources.cjs'); // NEW

const project = path.resolve(__dirname, '..'); // NEW
const campaign = path.join(project, '.test-artifacts', 'coordinator-sync', 'qualification-' + Date.now()); // NEW
fs.mkdirSync(campaign, { recursive: true }); // NEW
const sourceRoot = captureSources(project, path.join(campaign, 'sources')); // NEW
const reportPath = path.join(campaign, 'summary.json'); // NEW
const operations = ['manual', 'autosave', 'overlap', 'unchanged', 'refresh', 'checkpoint', 'invitation']; // CHANGE
const summary = { sourceRoot, sampleCount: 30, requestedCampaigns: 3, editCounts: [0, 100, 1000, 10000], operations, targetMs: 5000, complete: false, accepted: false, runs: [] }; // NEW
const persist = () => fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2)); // NEW
persist(); console.log('Campaign:', campaign); // NEW
for (let campaignIndex = 1; campaignIndex <= 3; campaignIndex++) { // NEW
    for (const edits of summary.editCounts) { // NEW
        verifySources(sourceRoot); // NEW
        const label = 'run-' + campaignIndex + '-edits-' + edits; // NEW
        const resultFile = path.join(campaign, label + '.json'), logFile = path.join(campaign, label + '.log'); // NEW
        const log = fs.openSync(logFile, 'wx'); // NEW
        const env = { ...process.env, TRELLIS_SAVE_PROJECT: project, TRELLIS_SAVE_SOURCE_ROOT: sourceRoot, TRELLIS_SAVE_OUTPUT: campaign, TRELLIS_SAVE_REPORT: resultFile }; // NEW
        delete env.ELECTRON_RUN_AS_NODE; // NEW
        let child; // NEW
        try { child = spawnSync(require('electron'), [path.join(sourceRoot, 'helpers', 'garden-save-performance-electron.cjs'), '--mode=shared', '--edits=' + edits], { cwd: project, env, windowsHide: true, stdio: ['ignore', log, log], timeout: 46 * 60 * 1000 }); } finally { fs.closeSync(log); } // NEW
        const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : { complete: false, accepted: false, error: 'Native result unavailable.' }; // NEW
        if (child.error) { result.complete = false; result.accepted = false; result.launchError = child.error.message; } // NEW
        try { verifySources(sourceRoot); } catch (error) { result.complete = false; result.accepted = false; result.sourceError = error.message; } // NEW
        const workload = result.cases?.[0]; // NEW
        const measurementComplete = result.sampleCount === 30 && result.recordCount === edits && workload?.productionService === true && workload.historicalContentRevisions === edits && workload.autosaveScheduling?.length === 30 && workload.autosaveScheduling.every(delay => delay >= 5000) && operations.every(operation => workload?.samples?.[operation]?.length === 30 && workload.rendererTimings?.filter(item => item.phase === 'save UI completion' && item.operation === operation).length === 30); // CHANGE
        const historyIndependent = workload?.archiveAudit?.historicalRecordsRead === 0 && workload.archiveAudit.archiveScans === 0 && workload?.timings?.filter(item => item.phase === 'read').every(item => item.replayCount === 0 && item.historicalRecordsRead === 0) === true; // CHANGE
        const qualified = child.status === 0 && result.complete && result.accepted && measurementComplete && historyIndependent; // NEW
        summary.runs.push({ campaignIndex, edits, resultFile, logFile, exitCode: child.status, measurementComplete, historyIndependent, qualified, p95: workload?.p95, error: result.error || result.launchError || result.sourceError }); // NEW
        persist(); console.log(label, qualified ? 'passed' : 'failed', JSON.stringify(workload?.p95 || result.error)); // NEW
        // NEW: cleanup is restricted to the exact isolated profile reported by this child.
        if (!child.error && result.profile && path.dirname(path.resolve(result.profile)) === path.resolve(os.tmpdir()) && path.basename(result.profile).startsWith('trellis-save-performance-')) { // NEW
            try { fs.rmSync(result.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (error) { summary.runs.at(-1).cleanupError = error.message; persist(); } // NEW
        } // NEW
        if (!qualified) { console.log('Milestone one remains closed:', reportPath); process.exitCode = 1; return; } // NEW: stop at evidence of failure; do not spend another eleven runs qualifying a failed candidate.
    } // NEW
} // NEW
summary.complete = summary.runs.length === 12 && summary.runs.every(run => run.measurementComplete); // NEW
summary.accepted = summary.complete && summary.runs.every(run => run.qualified); // NEW
persist(); console.log('Report:', reportPath); process.exitCode = summary.accepted ? 0 : 1; // NEW
