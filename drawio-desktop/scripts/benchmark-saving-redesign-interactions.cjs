/** Serial real-editor qualification. Every failed sample set or changed source keeps release closed. */ // NEW
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process'); // NEW
const { captureSources } = require('../test/helpers/responsiveness-sources.cjs'); // NEW
const { verifyRuntime } = require('./check-coordinator-qualification.cjs'); // NEW
const { verifyInteractionWorkload, verifyInteractionQualification } = require('./check-saving-redesign-qualification.cjs'); // NEW
const project = path.resolve(__dirname, '..'), campaign = path.join(project, '.test-artifacts/saving-redesign/interactions-' + Date.now()); fs.mkdirSync(campaign, { recursive: true }); // NEW
const sourceRoot = captureSources(project, path.join(campaign, 'sources')), summaryPath = path.join(campaign, 'summary.json'); // NEW
const summary = { sourceRoot, requestedCampaigns: 3, sampleCount: 30, targetMs: 100, complete: false, accepted: false, runs: [] }; // NEW
const persist = () => fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2)); persist(); console.log('Interaction campaign:', campaign); // NEW
for (const gardenProtocol of [4, 5]) for (const campaignIndex of [1, 2, 3]) { // NEW
    const label = 'protocol-' + gardenProtocol + '-run-' + campaignIndex, resultFile = path.join(campaign, label + '.json'), logFile = path.join(campaign, label + '.log'), log = fs.openSync(logFile, 'wx'); // NEW
    const env = { ...process.env, TRELLIS_RESPONSIVENESS_PROJECT: project, TRELLIS_REDESIGN_PROTOCOL: String(gardenProtocol), TRELLIS_REDESIGN_SOURCE_ROOT: sourceRoot, TRELLIS_REDESIGN_REPORT: resultFile, TRELLIS_REDESIGN_GATE_FEEDBACK: '1' }; delete env.ELECTRON_RUN_AS_NODE; delete env.TRELLIS_REDESIGN_INCIDENT; delete env.TRELLIS_REDESIGN_PROFILE; // NEW
    let child, p95, error; // NEW
    try { verifyRuntime(project, sourceRoot); child = spawnSync(require('electron'), [path.join(project, 'test/helpers/module-clusters-production-electron.cjs'), '--saving-redesign'], { cwd: project, env, windowsHide: true, stdio: ['ignore', log, log], timeout: 11 * 60 * 1000 }); if (child.error) throw child.error; if (child.status !== 0) throw Error('Full-application regression failed.'); p95 = verifyInteractionWorkload(JSON.parse(fs.readFileSync(resultFile, 'utf8')), gardenProtocol, sourceRoot); verifyRuntime(project, sourceRoot); } catch (failure) { error = failure.message; } finally { fs.closeSync(log); } // NEW
    summary.runs.push({ gardenProtocol, campaignIndex, resultFile, logFile, exitCode: child?.status ?? null, p95, error }); persist(); console.log(label, error || 'passed', p95 ?? ''); // NEW
    if (error) { process.exitCode = 1; console.log('Release remains closed:', summaryPath); return; } // NEW
} // NEW
summary.complete = true; summary.accepted = true; persist(); // NEW
try { verifyInteractionQualification(project, summaryPath); console.log('Qualified interactions:', summaryPath); } catch (error) { summary.accepted = false; summary.error = error.message; persist(); process.exitCode = 1; } // NEW
