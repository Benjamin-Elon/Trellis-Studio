/** Compose save qualification with real-editor interaction and portable-export evidence. */ // NEW
const fs = require('node:fs'), path = require('node:path'); // NEW
const { verifyQualification, verifyRuntime } = require('./check-coordinator-qualification.cjs'); // NEW
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8')); // NEW
const fail = message => { throw Error('Saving redesign qualification remains closed: ' + message); }; // NEW
function verifyInteractionWorkload(result, protocol, sourceRoot) { // NEW
    if (protocol !== 5 || result.sampleCount !== 5 || result.statistic !== 'slowest-three-mean') fail('Five samples and the slowest-three-mean statistic are required.'); // CHANGE
    if (result.fullApplication !== true || result.scenario !== 'bed-then-dill' || result.gardenProtocol !== protocol || path.resolve(result.sourceRoot || '.') !== sourceRoot || result.stable !== true || result.mutations !== 0 || result.rejections?.length !== 0 || result.frameTimeouts !== 0) fail('Missing stable, source-bound full-application evidence.'); // NEW
    if (result.selectionStable !== true || result.selectionMutations !== 0 || result.undoRedoRestored !== true) fail('Selection and undo/redo must preserve content without rejection loops.'); // NEW
    if (result.pointerTargetVerified !== true) fail('Pointer input must hit a visible generated planting circle.'); // NEW
    if (result.focusedDuringPointer !== true) fail('Interaction feedback requires a focused foreground editor.'); // NEW
    if (!Array.isArray(result.feedbackSamples) || result.feedbackSamples.length !== 5 || result.feedbackSamples.some(value => !Number.isFinite(value) || value < 0)) fail('Five feedback samples are required.'); // CHANGE
    const slowestThreeMeanMs = result.feedbackSamples.slice().sort((a, b) => b - a).slice(0, 3).reduce((sum, value) => sum + value, 0) / 3; if (slowestThreeMeanMs > 100) fail('Interaction feedback exceeded the 100 ms slowest-three mean.'); // CHANGE
    if (result.lifecycle?.reopened !== true || result.lifecycle.portableChars < 1900000 || result.portableExport?.verified !== true || result.portableExport.modified !== true) fail('Representative definitions, reopen, and native portable export must pass.'); // NEW
    if (result.portableSaveAs?.verified !== true || result.portableSaveAs.sourceUnchanged !== true || result.portableSaveAs.modified !== true) fail('Native Save As must preserve the managed source and its draft.'); // NEW
    return slowestThreeMeanMs; // CHANGE
} // NEW
function verifyInteractionQualification(project, filename) { // NEW
    const summary = read(filename), sourceRoot = path.resolve(summary.sourceRoot || '.'); // NEW
    if (summary.complete !== true || summary.accepted !== true || summary.requestedCampaigns !== 1 || summary.sampleCount !== 5 || summary.statistic !== 'slowest-three-mean' || summary.targetMs !== 100 || summary.runs?.length !== 1) fail('One full-application campaign for protocol 5 must pass.'); // CHANGE
    const run = summary.runs[0]; // CHANGE: the only supported workload is protocol 5, repetition 1.
    if (run.gardenProtocol !== 5 || run.campaignIndex !== 1 || run.exitCode !== 0) fail('Missing, duplicated, or failed interaction campaign.'); // CHANGE
    verifyInteractionWorkload(read(run.resultFile), run.gardenProtocol, sourceRoot); // CHANGE
    verifyRuntime(project, sourceRoot); return { accepted: true, sourceRoot, workloads: 1 }; // CHANGE
} // NEW
function verifySavingRedesign(project, saveReport, interactionReport) { // NEW
    const saves = verifyQualification(project, saveReport), interactions = verifyInteractionQualification(project, interactionReport); // NEW
    return { accepted: true, saves, interactions }; // NEW: both source inventories independently match the exact current runtime.
} // NEW
if (require.main === module) { // NEW
    try { const supplied = process.argv.slice(2); if (supplied.length !== 2) fail('Supply the save and interaction summary paths.'); console.log(JSON.stringify(verifySavingRedesign(path.resolve(__dirname, '..'), ...supplied.map(filename => path.resolve(filename))), null, 2)); } catch (error) { console.error(error.message); process.exitCode = 1; } // NEW
} // NEW
module.exports = { verifyInteractionWorkload, verifyInteractionQualification, verifySavingRedesign }; // NEW
