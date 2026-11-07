/** Frozen, serial milestone-one qualification. Partial runs never unlock later milestones. */ // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const os = require('node:os'); // NEW
const { spawnSync } = require('node:child_process'); // NEW
const { captureSources, verifySources } = require('../test/helpers/responsiveness-sources.cjs'); // NEW
const { verifyRuntime, verifyWorkload, verifyQualification } = require('./check-coordinator-qualification.cjs'); // CHANGE

/** Parse benchmark-only options without launching Electron or creating artifacts. */ // NEW
function parseOptions(args) { // NEW
    const options = { autosaveTimingMode: 'split', resume: null }, seen = new Set(); // CHANGE
    for (let index = 0; index < args.length; index++) { // NEW
        const argument = args[index], key = argument.split('=')[0]; // NEW
        if (seen.has(key)) throw Error('Duplicate benchmark option: ' + key); seen.add(key); // NEW
        if (key === '--pilot') throw Error('--pilot has been retired; run resumable qualification directly.'); // CHANGE
        else if (argument === '--resume' && args[index + 1] && !args[index + 1].startsWith('--')) options.resume = args[++index]; // NEW
        else if (argument.startsWith('--autosave-timing=') && ['real', 'split'].includes(argument.slice(18))) options.autosaveTimingMode = argument.slice(18); // NEW
        else throw Error('Usage: node scripts/benchmark-coordinator-saves.cjs [--autosave-timing=split|real] [--resume summary.json]'); // CHANGE
    } // NEW
    return options; // CHANGE
} // NEW
/** A pilot or different scheduling policy must never supply resumed qualification evidence. */ // NEW
function verifyResumePolicy(prior, mode) { // NEW
    if (prior.pilot !== undefined && prior.pilot !== false) throw Error('Pilot reports cannot be resumed.'); // NEW
    if (prior.sampleCount !== 5 || prior.statistic !== 'slowest-three-mean') throw Error('Resume requires five samples and the slowest-three-mean statistic.'); // CHANGE
    if (JSON.stringify(prior.protocols) !== '[5]') throw Error('Resume requires protocol 5 qualification evidence.'); // CHANGE
    if (!['real', 'split'].includes(mode) || prior.autosaveTimingMode !== mode || !Array.isArray(prior.runs) || prior.runs.some(run => run.autosaveTimingMode !== mode)) throw Error('Resume requires the same autosave timing policy.'); // CHANGE
} // NEW
function main(args = process.argv.slice(2)) { // NEW
    const project = path.resolve(__dirname, '..'), options = parseOptions(args); // CHANGE
    const prior = options.resume ? JSON.parse(fs.readFileSync(path.resolve(options.resume), 'utf8')) : null; // CHANGE
    if (prior) verifyResumePolicy(prior, options.autosaveTimingMode); // NEW: reject before creating any campaign files.
    const campaign = path.join(project, '.test-artifacts', 'coordinator-sync', 'qualification-' + Date.now()); // CHANGE
    fs.mkdirSync(campaign, { recursive: true }); // NEW
    const sourceRoot = prior ? path.resolve(prior.sourceRoot) : captureSources(project, path.join(campaign, 'sources')); // CHANGE: a resumed measurement must bind the same verified source inventory.
    verifySources(sourceRoot); verifyRuntime(project, sourceRoot); // NEW
    const reportPath = path.join(campaign, 'summary.json'); // NEW
    const gardenProtocol = 5, campaignIndex = 1; // CHANGE: protocol and repetition remain explicit report metadata.
    const operations = ['manual', 'autosave', 'overlap', 'unchanged', 'refresh', 'checkpoint', 'invitation']; // CHANGE
    const summary = { sourceRoot, sampleCount: 5, statistic: 'slowest-three-mean', autosaveTimingMode: options.autosaveTimingMode, requestedCampaigns: 1, protocols: [5], editCounts: [0, 10000], operations, targetMs: 5000, complete: false, accepted: false, runs: [], ...(prior ? { resumedFrom: path.resolve(options.resume), extraEvidence: [...(prior.extraEvidence || []), ...(prior.runs || []).filter(run => run.gardenProtocol !== 5 || run.campaignIndex !== 1 || ![0, 10000].includes(run.edits))] } : {}) }; // CHANGE: one repetition and five samples retain protocol 5, both endpoints, and all operations.
    const persist = () => fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2)); // NEW
    persist(); console.log('Campaign:', campaign); // NEW
    for (const edits of summary.editCounts) { // CHANGE
        try { verifySources(sourceRoot); verifyRuntime(project, sourceRoot); } // CHANGE
        catch (error) { summary.error = error.message; persist(); console.error('Milestone one remains closed:', error.message); process.exitCode = 1; return; } // CHANGE: never launch another workload against a stale candidate.
        const label = 'protocol-' + gardenProtocol + '-run-' + campaignIndex + '-edits-' + edits; // CHANGE
        const reused = prior?.runs?.find(run => run.gardenProtocol === gardenProtocol && run.campaignIndex === campaignIndex && run.edits === edits && run.qualified && run.measurementComplete && run.historyIndependent && run.exitCode === 0); // CHANGE
        if (reused) { const slowestThreeMeanMs = verifyWorkload(JSON.parse(fs.readFileSync(reused.resultFile, 'utf8')), reused, sourceRoot); summary.runs.push({ ...reused, slowestThreeMeanMs, reusedFrom: path.resolve(options.resume) }); persist(); console.log(label, 'reused verified raw evidence', JSON.stringify(slowestThreeMeanMs)); continue; } // CHANGE
        const resultFile = path.join(campaign, label + '.json'), logFile = path.join(campaign, label + '.log'); // CHANGE
        const log = fs.openSync(logFile, 'wx'); // CHANGE
        const env = { ...process.env, TRELLIS_SAVE_PROJECT: project, TRELLIS_SAVE_SOURCE_ROOT: sourceRoot, TRELLIS_SAVE_OUTPUT: campaign, TRELLIS_SAVE_REPORT: resultFile }; // CHANGE
        delete env.ELECTRON_RUN_AS_NODE; // CHANGE
        let child; // CHANGE
        try { child = spawnSync(require('electron'), [path.join(sourceRoot, 'helpers', 'garden-save-performance-electron.cjs'), '--mode=shared', '--edits=' + edits, '--protocol=' + gardenProtocol, '--autosave-timing=' + options.autosaveTimingMode], { cwd: project, env, windowsHide: true, stdio: ['ignore', log, log], timeout: 46 * 60 * 1000 }); } finally { fs.closeSync(log); } // CHANGE
        const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : { complete: false, accepted: false, error: 'Native result unavailable.' }; // CHANGE
        if (child.error) { result.complete = false; result.accepted = false; result.launchError = child.error.message; } // CHANGE
        try { verifySources(sourceRoot); verifyRuntime(project, sourceRoot); } catch (error) { result.complete = false; result.accepted = false; result.sourceError = error.message; } // CHANGE: concurrent edits invalidate the candidate before the next workload.
        const workload = result.cases?.[0]; // CHANGE
        const run = { gardenProtocol, campaignIndex, edits, autosaveTimingMode: options.autosaveTimingMode }; // CHANGE
        let measurementComplete = false, validationError, slowestThreeMeanMs; // CHANGE
        try { slowestThreeMeanMs = verifyWorkload(result, run, sourceRoot); measurementComplete = true; } catch (error) { validationError = error.message; } // CHANGE
        const historyIndependent = workload?.archiveAudit?.historicalRecordsRead === 0 && workload.archiveAudit.archiveScans === 0 && workload?.timings?.filter(item => item.phase === 'read').every(item => item.replayCount === 0 && item.historicalRecordsRead === 0) === true; // CHANGE
        const passed = child.status === 0 && measurementComplete, qualified = passed; // CHANGE
        summary.runs.push({ ...run, resultFile, logFile, exitCode: child.status, measurementComplete, historyIndependent, qualified, passed, slowestThreeMeanMs: slowestThreeMeanMs ?? workload?.slowestThreeMeanMs, error: result.error || result.launchError || result.sourceError || validationError }); // CHANGE
        persist(); console.log(label, passed ? 'passed' : 'failed', JSON.stringify(slowestThreeMeanMs ?? workload?.slowestThreeMeanMs ?? result.error)); // CHANGE
        // CHANGE: cleanup is restricted to the exact isolated profile reported by this child.
        if (!child.error && result.profile && path.dirname(path.resolve(result.profile)) === path.resolve(os.tmpdir()) && path.basename(result.profile).startsWith('trellis-save-performance-')) { // CHANGE
            try { fs.rmSync(result.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (error) { summary.runs.at(-1).cleanupError = error.message; persist(); } // CHANGE
        } // NEW
        if (!passed) { console.log('Milestone one remains closed:', reportPath); process.exitCode = 1; return; } // CHANGE: stop at evidence of failure; do not qualify the remaining workloads against a failed candidate.
    } // CHANGE
    summary.complete = summary.runs.length === summary.editCounts.length && summary.runs.every(run => run.measurementComplete); // CHANGE
    summary.accepted = summary.complete && summary.runs.every(run => run.qualified); // CHANGE
    persist(); if (summary.accepted) verifyQualification(project, reportPath); console.log('Report:', reportPath); process.exitCode = summary.complete && summary.runs.every(run => run.passed ?? run.qualified) ? 0 : 1; // CHANGE: only a complete passing qualification exits successfully.
} // NEW
if (require.main === module) main(); // NEW
module.exports = { parseOptions, verifyResumePolicy }; // NEW
