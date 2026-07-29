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
    assert.match(source, /if \(!toolbar \|\| !labelInputWrap \|\| !settingsBtn \|\| !addBedBtn \|\| !addGroupBtn \|\| !irrigationSourceBtn \|\| !moduleCell\) return;/); // CHANGE
}); // CHANGE

test('Garden module overlay uses a single editable bed-style label input', () => { // NEW
    const source = readPlantTilerSource(); // NEW
    const toolbarSource = sourceSlice(source, 'function makeGardenModuleLabelInput', 'function ensureToolbar'); // NEW
    const labelWriterSource = sourceSlice(source, 'function writeGardenModuleLabel', 'function stopGardenLabelEvent'); // NEW
    const attrWriterSource = sourceSlice(source, 'function setCellAttrsNoTxn', 'function cloneXmlValueWithAttrs'); // CHANGE

    assert.match(source, /let labelInputWrap = null;/); // NEW
    assert.match(source, /labelInputWrap = document\.createElement\("div"\);/); // NEW
    assert.match(source, /labelInputWrap\.className = "trellis-garden-module-label-controls";/); // NEW
    assert.match(source, /toolbar\.appendChild\(labelInputWrap\);[\s\S]*toolbar\.appendChild\(settingsBtn\);/); // NEW
    assert.match(toolbarSource, /input\.setAttribute\("aria-label", "Garden label"\);/); // NEW
    assert.match(toolbarSource, /display:block;box-sizing:border-box;width:100%;min-width:0;margin-bottom:2px;border:1px solid rgba\(75,85,99,0\.35\);border-radius:4px;padding:3px 5px;font:12px Arial,sans-serif;font-weight:600;/); // NEW
    assert.match(toolbarSource, /if \(evt\.key === "Enter"\) \{[\s\S]*writeGardenModuleLabel\(moduleCell, input\.value\)[\s\S]*input\.blur/); // NEW
    assert.match(toolbarSource, /else if \(evt\.key === "Escape"\) \{[\s\S]*input\.value = initialLabel;/); // NEW
    assert.match(labelWriterSource, /setCellAttrsNoTxn\(graphModel, moduleCell, \{ label: next \}\);/); // CHANGE
    assert.match(attrWriterSource, /const clone = base\.cloneNode\(true\);[\s\S]*model\.setValue\(cell, clone\);/); // NEW
    assert.match(source, /labelInputWrap\.style\.display = bedMode \? "none" : "flex";/); // NEW
    assert.match(source, /if \(!bedMode\) renderGardenModuleLabelInput\(moduleCell\);/); // NEW
}); // NEW

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

test('Garden module overlay suppresses plan actions while irrigation mode is active', () => { // NEW
    const source = readPlantTilerSource(); // NEW
    assert.match(source, /function isIrrigationModeActiveForOverlay\(\)/); // NEW
    assert.match(source, /planner\.isIrrigationModeActive\(\)/); // NEW
    assert.match(source, /function positionToolbar\(\) \{[\s\S]*if \(isIrrigationModeActiveForOverlay\(\)\) \{ hideToolbar\(\); return; \}/); // NEW
    assert.match(source, /function refreshForSelection\(\) \{[\s\S]*if \(isIrrigationModeActiveForOverlay\(\)\) \{[\s\S]*hideToolbar\(\);[\s\S]*return;/); // NEW
    assert.match(source, /mxEvent\.addListener\(window, "trellisIrrigationModeChanged", scheduleRefresh\);/); // NEW
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

test('scheduler sibling plant groups clone footprint and attrs without reusing source id', () => { // ADDED
    const source = readPlantTilerSource(); // ADDED
    const helperSource = sourceSlice(source, 'function createSiblingTilerGroupFromSource', 'function computeGridStatsXY'); // ADDED
    assert.match(helperSource, /const geometry = sourceGeo\.clone \? sourceGeo\.clone\(\) : new mxGeometry\(sourceGeo\.x, sourceGeo\.y, sourceGeo\.width, sourceGeo\.height\);/); // CHANGED
    assert.match(helperSource, /const offsetCm = opts\.layoutOffsetCm \|\| opts\.offsetCm \|\| null;/); // ADDED
    assert.match(helperSource, /geometry\.x = Number\(geometry\.x \|\| 0\) \+ offsetXPx;/); // ADDED
    assert.match(helperSource, /attrs\.companion_layout_clamped = "1";/); // ADDED
    assert.match(helperSource, /const group = new mxCell\(value, geometry, style \|\| groupFrameStyle\(\)\);/); // CHANGED
    assert.match(helperSource, /group\.setVertex\(true\);/); // ADDED
    assert.match(helperSource, /activeGraphArg\.addCell\(group, parent\);/); // CHANGED
    assert.match(helperSource, /reorderModuleChildrenForLayering\(model, parent\);/); // CHANGED
    assert.doesNotMatch(helperSource, /group\.id\s*=\s*sourceCell\.id/); // ADDED
    assert.match(source, /createSiblingTilerGroupFromSource, \/\/ ADDED/); // CHANGE
}); // ADDED

test('interplant companion groups offset alternating tile slots during retile', () => { // ADDED
    const source = readPlantTilerSource(); // ADDED
    const slotSource = sourceSlice(source, 'function logicalSlotCenterLocal', 'function geometryFromVisualCenter'); // ADDED
    const expandSource = sourceSlice(source, 'function expandTiles', 'function hasTileRC'); // ADDED
    assert.match(slotSource, /function isInterplantLayoutGroup\(groupCell\)/); // ADDED
    assert.match(slotSource, /getXmlAttr\(groupCell, "companion_layout_interplant", ""\) === "1"/); // ADDED
    assert.match(slotSource, /function interplantSlotCenterLocal\(groupCell, r, c, spacingXpx, spacingYpx, bandPx\)/); // ADDED
    assert.match(slotSource, /if \(\(r \+ c\) % 2 !== 0\) return center;/); // ADDED
    assert.match(slotSource, /x: Math\.min\(maxX, center\.x \+ spacingXpx \/ 2\)/); // ADDED
    assert.match(slotSource, /const logical = interplantSlotCenterLocal\(groupCell, r, c, spacingXpx, spacingYpx, bandPx\);/); // ADDED
    assert.match(expandSource, /tileGeometryAtSlot\(groupCell, r, c, spacingXpx, spacingYpx, iconDiamPx, bandPx\)/); // ADDED
}); // ADDED

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

test('Bed fit centers only fitted axes after plant group resize', () => { // NEW
    const source = readPlantTilerSource(); // NEW
    const helperSource = sourceSlice(source, 'function positionGeometryForLocalPointAxisAware', 'function plantingFrameLocalCenter'); // NEW
    const fitSource = sourceSlice(source, 'function applyBedFitGeometry', 'function retileAfterBedFit'); // NEW
    const trimSource = sourceSlice(source, 'function buildAxisAwareTrimGeometry', 'function trimGroupToPlantFootprint'); // NEW

    assert.match(helperSource, /const preserved = preservePoint \|\| modelPointForLocalPoint\(next, localPoint, angleDeg\);/); // NEW
    assert.match(helperSource, /const preserveLocal = rotateModelPoint\(preserved, targetPoint, -angleRad\);/); // NEW
    assert.match(helperSource, /x: fitWidth \? centerLocal\.x : preserveLocal\.x/); // NEW
    assert.match(helperSource, /y: fitHeight \? centerLocal\.y : preserveLocal\.y/); // NEW
    assert.match(helperSource, /const axisTargetPoint = rotateModelPoint\(axisTargetLocal, targetPoint, angleRad\);/); // NEW
    assert.match(fitSource, /positionGeometryForLocalPointAxisAware\(next, frameCenter, bedCenter, bedRotation, fitWidth, fitHeight\);/); // NEW
    assert.match(trimSource, /positionGeometryForLocalPointAxisAware\(next, localPlantCenter, bedCenter, getTilerRotationDeg\(bed\), fitWidth, fitHeight\);/); // NEW
    assert.doesNotMatch(fitSource, /positionGeometryForLocalPoint\(next, frameCenter, bedCenter, bedRotation\);/); // NEW
    assert.doesNotMatch(trimSource, /positionGeometryForLocalPoint\(next, localPlantCenter, bedCenter, getTilerRotationDeg\(bed\)\);/); // NEW
    assert.match(fitSource, /if \(!fitWidth && !fitHeight\) \{[\s\S]*reason: "not-close-enough"[\s\S]*return null;/); // NEW
}); // NEW

test('Bed fit persists per-axis intent and bed resize consumes only persisted axes', () => { // NEW
    const source = readPlantTilerSource(); // NEW
    const fitSource = sourceSlice(source, 'function applyBedFitGeometry', 'function retileAfterBedFit'); // NEW
    const normalizeSource = sourceSlice(source, 'function normalizeMovedTilerGroupsToBeds', 'function retileAndFitToContainingBed'); // NEW
    const listenerSource = sourceSlice(source, 'function installBedAutoFitListeners', 'function minGroupSizePx'); // NEW

    assert.match(source, /const BED_FIT_WIDTH_ATTR = "bed_fit_width";/); // NEW
    assert.match(source, /const BED_FIT_HEIGHT_ATTR = "bed_fit_height";/); // NEW
    assert.match(source, /function bedFitAxesForGroup\(groupCell\)/); // NEW
    assert.match(source, /function writeBedFitAxesNoTxn\(model, groupCell, fitWidth, fitHeight\)/); // NEW
    assert.match(source, /isTilerGroup\(groupCell\) \|\| isIrrigationBedAssembly\(groupCell\)/); // NEW
    assert.match(source, /function normalizeMovedBedAssembliesToBeds\(cells, opts\)/); // NEW
    assert.match(source, /fitOnDrag \? \{ fitWidth: true, fitHeight: true \} : inferBedAssemblyFitAxes\(assembly, bed\)/); // NEW
    assert.match(source, /syncBedAssemblyFitToBed\(parent, assembly, bed, axes, \{ inTransaction: true \}\)/); // NEW
    assert.match(fitSource, /const usePersistedFitAxes = !!\(debugCtx && debugCtx\.usePersistedFitAxes\);/); // NEW
    assert.match(fitSource, /const fitWidth = usePersistedFitAxes \? forcedFitWidth : \(widthClose \|\| canDragFit\);/); // NEW
    assert.match(fitSource, /const fitHeight = usePersistedFitAxes \? forcedFitHeight : \(heightClose \|\| canDragFit\);/); // NEW
    assert.match(fitSource, /if \(persistAxisIntent\) writeBedFitAxesNoTxn\(model, tg, fitWidth, fitHeight\);/); // NEW
    assert.match(fitSource, /if \(persistAxisIntent\) writeBedFitAxesNoTxn\(model, tg, false, false\);/); // NEW
    assert.match(normalizeSource, /const persistAxisIntent = !!\(opts && opts\.persistAxisIntent\);/); // NEW
    assert.match(listenerSource, /source: "cells-moved"[\s\S]*persistAxisIntent: true/); // NEW
    assert.match(listenerSource, /source: "cells-resized"[\s\S]*persistAxisIntent: true[\s\S]*clearFitAxisIntentOnNoBed: true/); // NEW
}); // NEW

test('Garden bed resize refits before-contained groups without capturing expanded-bed neighbors', () => { // NEW
    const source = readPlantTilerSource(); // NEW
    const snapshotSource = sourceSlice(source, 'function buildBedResizeSnapshot', 'function collectBedResizeSnapshots'); // NEW
    const resizeIntegrationSource = sourceSlice(source, 'function syncIrrigationBedAssembliesForSnapshot', '// -------------------- Resize'); // NEW
    const refitSource = sourceSlice(source, 'function refitGroupsForResizedBeds', '// -------------------- Resize'); // NEW
    const wrapperSource = sourceSlice(source, 'function installResizeCellsWrapper', '// ---- Public API export'); // NEW

    assert.match(snapshotSource, /const previousRect = getModelRect\(bed\);/); // NEW
    assert.match(snapshotSource, /const previousRotatedRect = rotatedRectForModelRect\(bed, previousRect\);/); // NEW
    assert.match(snapshotSource, /const assemblyTargets = \[\];/); // NEW
    assert.match(snapshotSource, /const geometryBed = resolveBedForAssemblyGeometry\(parent, child, null\);/); // CHANGE
    assert.match(snapshotSource, /const ownsByCachedLink = !geometryBed && child\.getAttribute\("irrigation_linked_bed_id"\) === bedId;/); // NEW
    assert.match(snapshotSource, /const axes = bedFitAxesForBedAssembly\(child, bed\);/); // NEW
    assert.match(snapshotSource, /assemblyTargets\.push\(\{ assembly: child, axes \}\)/); // CHANGE
    assert.match(snapshotSource, /child\.getAttribute\(BED_AUTO_FIT_ATTR\) === "0"/); // NEW
    assert.match(snapshotSource, /const axes = bedFitAxesForGroup\(child\);[\s\S]*if \(!axes\.fitWidth && !axes\.fitHeight\) continue;/); // NEW
    assert.match(snapshotSource, /if \(!pointInRotatedRectModel\(center, previousRotatedRect\)\) continue;/); // NEW
    assert.match(resizeIntegrationSource, /planner\.syncLinkedBedAssemblyToBed\(snapshot\.parent, assembly, snapshot\.bed, \{ inTransaction: !!\(opts && opts\.inTransaction\), fitWidth: !!axes\.fitWidth, fitHeight: !!axes\.fitHeight \}\)/); // CHANGE
    assert.match(refitSource, /syncIrrigationBedAssembliesForSnapshot\(snap, \{ inTransaction: !ownsTransaction \}\)/); // NEW
    assert.match(refitSource, /usePersistedFitAxes: true/); // NEW
    assert.match(refitSource, /forceFitWidth: !!\(item\.axes && item\.axes\.fitWidth\)/); // NEW
    assert.match(refitSource, /forceFitHeight: !!\(item\.axes && item\.axes\.fitHeight\)/); // NEW
    assert.match(refitSource, /retileAfterBedFit\(item\.tg/); // NEW
    assert.match(refitSource, /trimGroupToPlantFootprint\(item\.tg, item\.bed, bbox, item\.fitWidth, item\.fitHeight/); // NEW
    assert.match(wrapperSource, /const bedSnapshots = collectBedResizeSnapshots\(cells\);/); // NEW
    assert.match(wrapperSource, /const hasResizedBeds = bedSnapshots\.size > 0;/); // NEW
    assert.match(wrapperSource, /refitGroupsForResizedBeds\(bedSnapshots, \{ source: "bed-resized", inTransaction: true, txnId: bedResizeTxnId \}\);/); // NEW
    assert.match(wrapperSource, /for \(const assembly of bedFitResult\.syncedAssemblies \|\| \[\]\) groupsNeedingRefresh\.push\(assembly\);/); // NEW
}); // NEW

test('Layering orders bed assemblies between beds and planting groups', () => { // NEW
    const source = readPlantTilerSource(); // NEW
    const layeringSource = sourceSlice(source, 'function isIrrigationBedAssembly', 'function findTilerGroupAncestor'); // NEW
    const exportSource = sourceSlice(source, '// ---- Public API export', 'installTrellisDebugSurface'); // NEW

    assert.match(layeringSource, /cell\.getAttribute\("irrigation_assembly"\) === "1" && cell\.getAttribute\("irrigation_assembly_type"\) === "bed"/); // NEW
    assert.match(layeringSource, /const bedAssemblies = \[\];/); // NEW
    assert.match(layeringSource, /else if \(isIrrigationBedAssembly\(ch\)\) bedAssemblies\.push\(ch\);/); // NEW
    assert.match(layeringSource, /const ordered = beds\.concat\(bedAssemblies, others, groups\);/); // NEW
    assert.match(source, /if \(isGardenBed\(c\) \|\| isIrrigationBedAssembly\(c\) \|\| isTilerGroup\(c\)\)/); // CHANGE
    assert.match(exportSource, /reorderModuleChildrenForLayering/); // NEW
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
