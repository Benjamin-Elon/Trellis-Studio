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

function sourceSlice(source, startNeedle, endNeedle) { // NEW
    const start = source.indexOf(startNeedle); // NEW
    assert.notEqual(start, -1); // NEW
    const end = source.indexOf(endNeedle, start); // NEW
    assert.notEqual(end, -1); // NEW
    return source.slice(start, end); // NEW
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

test('Garden module margin lives in Garden Settings instead of the overlay', () => { // CHANGE
    const source = readPlantTilerSource(); // NEW
    assert.doesNotMatch(source, /let marginBtn = null;/); // CHANGE
    assert.doesNotMatch(source, /marginBtn = makeButton\("Set Module Margin"\);/); // CHANGE
    assert.doesNotMatch(source, /toolbar\.appendChild\(marginBtn\);/); // CHANGE
    assert.doesNotMatch(source, /mxEvent\.addListener\(marginBtn, "click"/); // CHANGE
    assert.doesNotMatch(source, /function promptSetModuleMarginForModule\(moduleCell\)/); // CHANGE
    assert.doesNotMatch(source, /new mxEventObject\("usl:requestPromptSetModuleMargin", "cell", moduleCell\)/); // CHANGE
    assert.match(source, /row\("Module margin \(px\):", moduleMarginInput\);/); // NEW
    assert.match(source, /const curModuleMargin = getGardenModuleMargin\(moduleCell\);/); // NEW
    assert.match(source, /const chosenModuleMargin = readModuleMarginInput\(moduleMarginInput\);/); // NEW
    assert.match(source, /Module margin must be a non-negative whole number\./); // NEW
    assert.match(source, /setGardenModuleMargin\(moduleCell, chosenModuleMargin\);/); // NEW
    assert.match(source, /if \(!toolbar \|\| !settingsBtn \|\| !addBedBtn \|\| !addGroupBtn \|\| !irrigationSourceBtn \|\| !moduleCell\) return;/); // CHANGE
}); // CHANGE

test('Garden module overlay repeated selected-module clicks toggle visibility without changing selection', () => { // NEW
    const source = readPlantTilerSource(); // NEW

    assert.match(source, /let manuallyHiddenModuleCell = null;/); // NEW
    assert.match(source, /let pendingSelectedModuleToggle = null;/); // NEW
    assert.match(source, /function selectedGardenModulePlainClickTarget\(me, evt\) \{[\s\S]*const selectedModule = getSingleSelectedGardenModule\(\);[\s\S]*if \(activeOverlayMode !== "module" \|\| activeModuleCell !== selectedModule\) return null;[\s\S]*return mouseEventCell\(me, evt\) === selectedModule \? selectedModule : null;/); // CHANGE
    assert.match(source, /function clearHiddenModuleIfTargetChanged\(target\) \{[\s\S]*if \(!target \|\| target\.mode !== "module" \|\| target\.moduleCell !== manuallyHiddenModuleCell\) manuallyHiddenModuleCell = null;/); // NEW
    assert.match(source, /function toggleHiddenModuleAfterSimpleClick\(evt\) \{[\s\S]*manuallyHiddenModuleCell = manuallyHiddenModuleCell === pending \? null : pending;/); // NEW
    assert.match(source, /pendingSelectedModuleToggle = selectedGardenModulePlainClickTarget\(me, evt\);/); // NEW
    assert.match(source, /toggleHiddenModuleAfterSimpleClick\(evt\);/); // NEW
    assert.match(source, /clearHiddenModuleIfTargetChanged\(target\);[\s\S]*if \(target\.mode === "module" && target\.moduleCell === manuallyHiddenModuleCell\) \{ hideToolbar\(\); return; \}/); // NEW
}); // NEW

test('Plant group creation finalizes tiling and bed fit inside the creation transaction', () => { // NEW
    const source = readPlantTilerSource(); // NEW
    const finalizer = sourceSlice(source, 'function finalizeCreatedTilerGroup', 'function createDefaultGardenBed'); // NEW
    const createEmpty = sourceSlice(source, 'function createEmptyTilerGroup', '// ---------- Debug helpers'); // NEW

    assert.match(finalizer, /retileAndFitToContainingBed\(graph, group, \{ source: debugSource, inTransaction: true, txnId \}\);/); // CHANGE
    assert.match(createEmpty, /const creationSource = \(opts && opts\.source\) \|\| "empty-group";[\s\S]*const creationTxnId = \+\+bedFitTxnSeq;[\s\S]*model\.beginUpdate\(\);[\s\S]*graph\.addCell\(group, moduleCell\);[\s\S]*finalizeCreatedTilerGroup\(graph, group, moduleCell, creationSource, creationTxnId\);[\s\S]*model\.endUpdate\(\);/); // CHANGE
    assert.match(createEmpty, /notifyTilerGroupCreated\(graph, group, creationSource, creationTxnId\);/); // CHANGE
    assert.doesNotMatch(createEmpty, /retileGroup\(graph, group\);/); // NEW
}); // NEW

test('Bed fit diagnostics expose a self-verifying debug surface', () => { // NEW
    const source = readPlantTilerSource(); // NEW
    assert.match(source, /function bedFitStatus\(\)/); // NEW
    assert.match(source, /function installTrellisDebugSurface\(\)/); // NEW
    assert.match(source, /win\.Trellis = win\.Trellis \|\| \{\};/); // NEW
    assert.match(source, /debug\.bedFitStatus = bedFitStatus;/); // NEW
    assert.match(source, /debug\.enable = function \(\) \{[\s\S]*trellis_users_debug", "1"[\s\S]*trellis_bed_fit_debug", "1"/); // NEW
    assert.match(source, /debug\.disable = function \(\) \{[\s\S]*removeItem\("trellis_users_debug"\)[\s\S]*removeItem\("trellis_bed_fit_debug"\)/); // NEW
    assert.match(source, /debug\.probe = debugProbe;/); // NEW
    assert.match(source, /installTrellisDebugSurface\(\);[\s\S]*bedFitLog\("loaded", bedFitStatus\(\)\);/); // NEW
}); // NEW

test('Garden module overlay plant group add no longer runs a second post-creation bed fit', () => { // NEW
    const source = readPlantTilerSource(); // NEW
    const overlayAdd = sourceSlice(source, 'mxEvent.addListener(addGroupBtn, "click"', 'mxEvent.addListener(irrigationSourceBtn, "click"'); // NEW

    assert.match(overlayAdd, /createEmptyTilerGroup\(graph, moduleCell, pt\.x, pt\.y, \{ source: activeOverlayMode === "bed" \? "overlay-bed-add" : "overlay-module-add" \}\);/); // NEW
    assert.doesNotMatch(overlayAdd, /retileAndFitToContainingBed\(graph, group/); // NEW
}); // NEW

test('Context menu and plant-circle wrap use the shared plant group finalizer', () => { // NEW
    const source = readPlantTilerSource(); // NEW
    const contextMenu = sourceSlice(source, 'menu.addItem("Add New Plant Group"', 'log("[module] empty tiler group created"'); // NEW
    const wrapCreate = sourceSlice(source, 'function createTilerGroupFromCircle', 'function computeGridStatsXY'); // NEW

    assert.match(contextMenu, /createEmptyTilerGroup\(graph, targetMod, pt\.x, pt\.y\);/); // NEW
    assert.match(wrapCreate, /model\.beginUpdate\(\);[\s\S]*graph\.addCell\(group, parent\);[\s\S]*finalizeCreatedTilerGroup\(graph, group, parent, "plant-circle-wrap"\);[\s\S]*model\.endUpdate\(\);/); // NEW
    assert.match(wrapCreate, /model\.setGeometry\(c, local\);/); // NEW
    assert.doesNotMatch(wrapCreate, /retileGroup\(graph, group\);/); // NEW
}); // NEW
