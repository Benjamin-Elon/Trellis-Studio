/** Compose save qualification with real-editor interaction and portable-export evidence. */ // NEW
const fs = require('node:fs'), path = require('node:path'); // NEW
const { verifyQualification, verifyRuntime } = require('./check-coordinator-qualification.cjs'); // NEW
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8')); // NEW
const fail = message => { throw Error('Saving redesign qualification remains closed: ' + message); }; // NEW
function verifyInteractionWorkload(result, protocol, sourceRoot) { // NEW
    if (result.fullApplication !== true || result.scenario !== 'bed-then-dill' || result.gardenProtocol !== protocol || path.resolve(result.sourceRoot || '.') !== sourceRoot || result.stable !== true || result.mutations !== 0 || result.rejections?.length !== 0 || result.frameTimeouts !== 0) fail('Missing stable, source-bound full-application evidence.'); // NEW
    if (result.selectionStable !== true || result.selectionMutations !== 0 || result.undoRedoRestored !== true) fail('Selection and undo/redo must preserve content without rejection loops.'); // NEW
    if (result.pointerTargetVerified !== true) fail('Pointer input must hit a visible generated planting circle.'); // NEW
    if (result.focusedDuringPointer !== true) fail('Interaction feedback requires a focused foreground editor.'); // NEW
    if (!Array.isArray(result.feedbackSamples) || result.feedbackSamples.length !== 30 || result.feedbackSamples.some(value => !Number.isFinite(value) || value < 0)) fail('Thirty feedback samples are required.'); // NEW
    const p95 = result.feedbackSamples.slice().sort((a, b) => a - b)[28]; if (p95 > 100) fail('Interaction feedback exceeded 100 ms p95.'); // NEW
    if (result.lifecycle?.reopened !== true || result.lifecycle.portableChars < 1900000 || result.portableExport?.verified !== true || result.portableExport.modified !== true) fail('Representative definitions, reopen, and native portable export must pass.'); // NEW
    if (result.portableSaveAs?.verified !== true || result.portableSaveAs.sourceUnchanged !== true || result.portableSaveAs.modified !== true) fail('Native Save As must preserve the managed source and its draft.'); // NEW
    return p95; // NEW
} // NEW
function verifyInteractionQualification(project, filename) { // NEW
    const summary = read(filename), sourceRoot = path.resolve(summary.sourceRoot || '.'); // NEW
    if (summary.complete !== true || summary.accepted !== true || summary.requestedCampaigns !== 3 || summary.sampleCount !== 30 || summary.targetMs !== 100 || summary.runs?.length !== 6) fail('Three full-application campaigns for both formats must pass.'); // NEW
    const expected = new Set([4, 5].flatMap(protocol => [1, 2, 3].map(campaign => protocol + '/' + campaign))); // NEW
    for (const run of summary.runs) { if (!expected.delete(run.gardenProtocol + '/' + run.campaignIndex) || run.exitCode !== 0) fail('Missing, duplicated, or failed interaction campaign.'); verifyInteractionWorkload(read(run.resultFile), run.gardenProtocol, sourceRoot); } // NEW
    verifyRuntime(project, sourceRoot); return { accepted: true, sourceRoot, workloads: 6 }; // NEW
} // NEW
function verifySavingRedesign(project, saveReport, interactionReport) { // NEW
    const saves = verifyQualification(project, saveReport), interactions = verifyInteractionQualification(project, interactionReport); // NEW
    return { accepted: true, saves, interactions }; // NEW: both source inventories independently match the exact current runtime.
} // NEW
if (require.main === module) { // NEW
    try { const supplied = process.argv.slice(2); if (supplied.length !== 2) fail('Supply the save and interaction summary paths.'); console.log(JSON.stringify(verifySavingRedesign(path.resolve(__dirname, '..'), ...supplied.map(filename => path.resolve(filename))), null, 2)); } catch (error) { console.error(error.message); process.exitCode = 1; } // NEW
} // NEW
module.exports = { verifyInteractionWorkload, verifyInteractionQualification, verifySavingRedesign }; // NEW
