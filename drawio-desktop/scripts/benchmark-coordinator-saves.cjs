/** Frozen, serial milestone-one qualification. Partial runs never unlock later milestones. */ // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const os = require('node:os'); // NEW
const { spawnSync } = require('node:child_process'); // NEW
const { captureSources, verifySources } = require('../test/helpers/responsiveness-sources.cjs'); // NEW
const { verifyRuntime, verifyWorkload, verifyQualification } = require('./check-coordinator-qualification.cjs'); // CHANGE

/** Parse benchmark-only options without launching Electron or creating artifacts. */ // NEW
function parseOptions(args) { // NEW
    const options = { pilot: false, autosaveTimingMode: 'split', resume: null }, seen = new Set(); // NEW
    for (let index = 0; index < args.length; index++) { // NEW
        const argument = args[index], key = argument.split('=')[0]; // NEW
        if (seen.has(key)) throw Error('Duplicate benchmark option: ' + key); seen.add(key); // NEW
        if (argument === '--pilot') options.pilot = true; // NEW
        else if (argument === '--resume' && args[index + 1] && !args[index + 1].startsWith('--')) options.resume = args[++index]; // NEW
        else if (argument.startsWith('--autosave-timing=') && ['real', 'split'].includes(argument.slice(18))) options.autosaveTimingMode = argument.slice(18); // NEW
        else throw Error('Usage: node scripts/benchmark-coordinator-saves.cjs [--pilot] [--autosave-timing=split|real] [--resume summary.json]'); // NEW
    } // NEW
    if (options.pilot && options.resume) throw Error('Pilot and resume cannot be combined.'); return options; // NEW
} // NEW
/** A pilot or different scheduling policy must never supply resumed qualification evidence. */ // NEW
function verifyResumePolicy(prior, mode) { // NEW
    if (prior.pilot !== undefined && prior.pilot !== false) throw Error('Pilot reports cannot be resumed.'); // NEW
    if ((prior.autosaveTimingMode ?? 'real') !== mode || !Array.isArray(prior.runs) || prior.runs.some(run => (run.autosaveTimingMode ?? 'real') !== mode)) throw Error('Resume requires the same autosave timing policy.'); // NEW
} // NEW
function main(args = process.argv.slice(2)) { // NEW
    const project = path.resolve(__dirname, '..'), options = parseOptions(args); // CHANGE
    const prior = options.resume ? JSON.parse(fs.readFileSync(path.resolve(options.resume), 'utf8')) : null; // CHANGE
    if (prior) verifyResumePolicy(prior, options.autosaveTimingMode); // NEW: reject before creating any campaign files.
    const campaign = path.join(project, '.test-artifacts', 'coordinator-sync', (options.pilot ? 'pilot-' : 'qualification-') + Date.now()); // NEW
    fs.mkdirSync(campaign, { recursive: true }); // NEW
    const sourceRoot = prior ? path.resolve(prior.sourceRoot) : captureSources(project, path.join(campaign, 'sources')); // CHANGE: a resumed measurement must bind the same verified source inventory.
    verifySources(sourceRoot); verifyRuntime(project, sourceRoot); // NEW
    const reportPath = path.join(campaign, 'summary.json'); // NEW
    const operations = ['manual', 'autosave', 'overlap', 'unchanged', 'refresh', 'checkpoint', 'invitation']; // CHANGE
    const summary = { sourceRoot, sampleCount: 30, pilot: options.pilot, autosaveTimingMode: options.autosaveTimingMode, requestedCampaigns: options.pilot ? 1 : 3, protocols: [4, 5], editCounts: [0, 10000], operations, targetMs: 5000, complete: false, accepted: false, runs: [], ...(prior ? { resumedFrom: path.resolve(options.resume), extraEvidence: (prior.runs || []).filter(run => ![0, 10000].includes(run.edits)) } : {}) }; // CHANGE: user-approved endpoints halve the matrix without reducing repetitions or operation coverage.
    const persist = () => fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2)); // NEW
    persist(); console.log('Campaign:', campaign); // NEW
    for (const gardenProtocol of summary.protocols) { // CHANGE: both persisted formats qualify the same engine.
        for (let campaignIndex = 1; campaignIndex <= summary.requestedCampaigns; campaignIndex++) { // NEW
            for (const edits of summary.editCounts) { // NEW
                try { verifySources(sourceRoot); verifyRuntime(project, sourceRoot); } // CHANGE
                catch (error) { summary.error = error.message; persist(); console.error('Milestone one remains closed:', error.message); process.exitCode = 1; return; } // NEW: never launch another workload against a stale candidate.
                const label = 'protocol-' + gardenProtocol + '-run-' + campaignIndex + '-edits-' + edits; // NEW
                const reused = prior?.runs?.find(run => run.gardenProtocol === gardenProtocol && run.campaignIndex === campaignIndex && run.edits === edits && run.qualified && run.measurementComplete && run.historyIndependent && run.exitCode === 0); // NEW
                if (reused) { verifyWorkload(JSON.parse(fs.readFileSync(reused.resultFile, 'utf8')), reused, sourceRoot); summary.runs.push({ ...reused, reusedFrom: path.resolve(options.resume) }); persist(); console.log(label, 'reused verified raw evidence', JSON.stringify(reused.p95)); continue; } // NEW
                const resultFile = path.join(campaign, label + '.json'), logFile = path.join(campaign, label + '.log'); // NEW
                const log = fs.openSync(logFile, 'wx'); // NEW
                const env = { ...process.env, TRELLIS_SAVE_PROJECT: project, TRELLIS_SAVE_SOURCE_ROOT: sourceRoot, TRELLIS_SAVE_OUTPUT: campaign, TRELLIS_SAVE_REPORT: resultFile }; // NEW
                delete env.ELECTRON_RUN_AS_NODE; // NEW
                let child; // NEW
                try { child = spawnSync(require('electron'), [path.join(sourceRoot, 'helpers', 'garden-save-performance-electron.cjs'), '--mode=shared', '--edits=' + edits, '--protocol=' + gardenProtocol, '--autosave-timing=' + options.autosaveTimingMode], { cwd: project, env, windowsHide: true, stdio: ['ignore', log, log], timeout: 46 * 60 * 1000 }); } finally { fs.closeSync(log); } // NEW
                const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : { complete: false, accepted: false, error: 'Native result unavailable.' }; // NEW
                if (child.error) { result.complete = false; result.accepted = false; result.launchError = child.error.message; } // NEW
                try { verifySources(sourceRoot); verifyRuntime(project, sourceRoot); } catch (error) { result.complete = false; result.accepted = false; result.sourceError = error.message; } // CHANGE: concurrent edits invalidate the candidate before the next workload.
                const workload = result.cases?.[0]; // NEW
                const run = { gardenProtocol, campaignIndex, edits, autosaveTimingMode: options.autosaveTimingMode }; // NEW
                let measurementComplete = false, validationError; // CHANGE
                try { verifyWorkload(result, run, sourceRoot); measurementComplete = true; } catch (error) { validationError = error.message; } // NEW
                const historyIndependent = workload?.archiveAudit?.historicalRecordsRead === 0 && workload.archiveAudit.archiveScans === 0 && workload?.timings?.filter(item => item.phase === 'read').every(item => item.replayCount === 0 && item.historicalRecordsRead === 0) === true; // CHANGE
                const passed = child.status === 0 && measurementComplete, qualified = !options.pilot && passed; // CHANGE
                summary.runs.push({ ...run, resultFile, logFile, exitCode: child.status, measurementComplete, historyIndependent, qualified, passed, p95: workload?.p95, error: result.error || result.launchError || result.sourceError || validationError }); // CHANGE
                persist(); console.log(label, passed ? 'passed' : 'failed', JSON.stringify(workload?.p95 || result.error)); // NEW
                // NEW: cleanup is restricted to the exact isolated profile reported by this child.
                if (!child.error && result.profile && path.dirname(path.resolve(result.profile)) === path.resolve(os.tmpdir()) && path.basename(result.profile).startsWith('trellis-save-performance-')) { // NEW
                    try { fs.rmSync(result.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (error) { summary.runs.at(-1).cleanupError = error.message; persist(); } // NEW
                } // NEW
                if (!passed) { console.log('Milestone one remains closed:', reportPath); process.exitCode = 1; return; } // NEW: stop at evidence of failure; do not spend another eleven runs qualifying a failed candidate.
            } // NEW
        } // NEW
    } // CHANGE
    summary.complete = summary.runs.length === summary.protocols.length * summary.editCounts.length * summary.requestedCampaigns && summary.runs.every(run => run.measurementComplete); // CHANGE
    summary.accepted = !options.pilot && summary.complete && summary.runs.every(run => run.qualified); // NEW
    persist(); if (summary.accepted) verifyQualification(project, reportPath); console.log('Report:', reportPath); process.exitCode = summary.complete && summary.runs.every(run => run.passed ?? run.qualified) ? 0 : 1; // CHANGE: a successful pilot exits zero while accepted remains false.
} // NEW
if (require.main === module) main(); // NEW
module.exports = { parseOptions, verifyResumePolicy }; // NEW
