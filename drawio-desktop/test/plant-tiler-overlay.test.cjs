const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const test = require('node:test'); // NEW

const plantTilerPath = path.join( // NEW
    __dirname, // NEW
    '..', // NEW
    'drawio', // NEW
    'src', // NEW
    'main', // NEW
    'webapp', // NEW
    'plugins', // NEW
    'garden_planner_plugins', // NEW
    'Plant_Tiler.js' // NEW
); // NEW

function readPlantTilerSource() { // NEW
    return fs.readFileSync(plantTilerPath, 'utf8'); // NEW
} // NEW

test('Garden Settings suppresses the garden options overlay while the dialog is open', () => { // NEW
    const source = readPlantTilerSource(); // NEW

    assert.match(source, /let openGardenSettingsDialogWithOverlaySuppressed = null;/); // NEW
    assert.match(source, /let gardenSettingsOverlaySuppressed = false;/); // NEW
    assert.match(source, /gardenSettingsOverlaySuppressed = true;[\s\S]*hideToolbar\(\);[\s\S]*showGardenSettingsDialog\(ui, graph, moduleCell, clearSuppressionAndNotify\)/); // NEW
    assert.match(source, /gardenSettingsOverlaySuppressed = false;[\s\S]*scheduleRefresh\(\);/); // NEW
    assert.match(source, /function refreshForSelection\(\) \{[\s\S]*if \(gardenSettingsOverlaySuppressed\) \{[\s\S]*hideToolbar\(\);[\s\S]*return;/); // NEW
    assert.match(source, /function positionToolbar\(\) \{[\s\S]*if \(gardenSettingsOverlaySuppressed\) \{ hideToolbar\(\); return; \}/); // NEW
}); // NEW

test('Garden Settings entry points route through the overlay-suppressed opener', () => { // NEW
    const source = readPlantTilerSource(); // NEW

    assert.match(source, /await openGardenSettingsDialogWithOverlaySuppressed\(moduleCell\);/); // NEW
    assert.match(source, /if \(hasGardenSettingsSet\(moduleCell\)\) return;[\s\S]*openGardenSettingsDialogWithOverlaySuppressed\(moduleCell\);/); // NEW
    assert.match(source, /await openGardenSettingsDialogWithOverlaySuppressed\(targetMod\);/); // NEW

    const directDialogReferences = source.match(/showGardenSettingsDialog\(ui, graph,/g) || []; // NEW
    assert.equal(directDialogReferences.length, 4); // NEW
}); // NEW

test('Garden Settings can open with an empty city table so City Manager can add the first city', () => { // ADDED
    const source = readPlantTilerSource(); // ADDED
    assert.doesNotMatch(source, /No cities found in database/); // ADDED
    assert.match(source, /Empty city lists are allowed so the City Manager can create the first scheduler-ready city/); // ADDED
}); // ADDED

test('Garden module overlay can route first irrigation source creation through the irrigation planner', () => { // NEW
    const source = readPlantTilerSource(); // NEW
    assert.match(source, /irrigationSourceBtn = makeButton\("Create Irrigation Source"\);/); // NEW
    assert.match(source, /function gardenModuleHasIrrigationSource\(moduleCell\)/); // NEW
    assert.match(source, /getXmlAttr\(cell, "irrigation_endpoint_type", ""\) === "source"/); // NEW
    assert.match(source, /window\.TrellisIrrigationPlanner\.openIrrigationMode\(moduleCell, \{ sourceForm: true, preserveViewport: true \}\);/); // NEW
    assert.match(source, /ui\.actions[\s\S]*trellisIrrigationCreateSourceEndpoint/); // NEW
    assert.match(source, /irrigationSourceBtn\.disabled = !hasSettings;/); // NEW
    assert.match(source, /const showIrrigationSource = !bedMode && !gardenModuleHasIrrigationSource\(moduleCell\);/); // NEW
    const helperStart = source.indexOf('function collectModuleDescendants(moduleCell)'); // FIX
    const helperEnd = source.indexOf('function openIrrigationSourceFormForModule', helperStart); // FIX
    assert.notEqual(helperStart, -1); // FIX
    assert.notEqual(helperEnd, -1); // FIX
    const helperSource = source.slice(helperStart, helperEnd); // FIX
    assert.match(helperSource, /const graphModel = graph\.getModel && graph\.getModel\(\);/); // FIX
    assert.doesNotMatch(helperSource, /\bmodel\.getChild(?:Count|At)\b/); // FIX
}); // NEW
