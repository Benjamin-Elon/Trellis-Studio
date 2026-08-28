const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const plantTilerPath = path.join(
    __dirname,
    '..',
    'drawio',
    'src',
    'main',
    'webapp',
    'plugins',
    'garden_planner_plugins',
    'Plant_Tiler.js'
);

function readPlantTilerSource() {
    return fs.readFileSync(plantTilerPath, 'utf8');
}

function sourceSlice(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1);
    return source.slice(start, end);
}

test('Garden Settings suppresses the garden options overlay while the dialog is open', () => {
    const source = readPlantTilerSource();

    assert.match(source, /let openGardenSettingsDialogWithOverlaySuppressed = null;/);
    assert.match(source, /let gardenSettingsOverlaySuppressed = false;/);
    assert.match(source, /gardenSettingsOverlaySuppressed = true;[\s\S]*hideToolbar\(\);[\s\S]*showGardenSettingsDialog\(ui, graph, moduleCell, clearSuppressionAndNotify\)/);
    assert.match(source, /gardenSettingsOverlaySuppressed = false;[\s\S]*scheduleRefresh\(\);/);
    assert.match(source, /function refreshForSelection\(\) \{[\s\S]*if \(gardenSettingsOverlaySuppressed\) \{[\s\S]*hideToolbar\(\);[\s\S]*return;/);
    assert.match(source, /function positionToolbar\(\) \{[\s\S]*if \(gardenSettingsOverlaySuppressed\) \{ hideToolbar\(\); return; \}/);
});

test('Garden Settings entry points route through the overlay-suppressed opener', () => {
    const source = readPlantTilerSource();

    assert.match(source, /await openGardenSettingsDialogWithOverlaySuppressed\(moduleCell\);/);
    assert.match(source, /if \(hasGardenSettingsSet\(moduleCell\)\) return;[\s\S]*openGardenSettingsDialogWithOverlaySuppressed\(moduleCell\);/);
    assert.match(source, /await openGardenSettingsDialogWithOverlaySuppressed\(targetMod\);/);

    const directDialogReferences = source.match(/showGardenSettingsDialog\(ui, graph,/g) || [];
    assert.equal(directDialogReferences.length, 4);
});

test('Garden Settings can open with an empty city table so City Manager can add the first city', () => {
    const source = readPlantTilerSource();
    assert.doesNotMatch(source, /No cities found in database/);
    assert.match(source, /Empty city lists are allowed so the City Manager can create the first scheduler-ready city/);
});

test('Garden module and bed overlays expose exclusive mode launchers', () => { // CHANGE
    const source = readPlantTilerSource();
    assert.match(source, /const ALLOCATE_PLAN_EVENT = "usl:allocatePlanRequested";/); // NEW
    assert.match(source, /allocateModeBtn = makeButton\("Enter Allocation Mode", "open"\);/); // NEW
    assert.match(source, /irrigationModeBtn = makeButton\("Enter Irrigation Design Mode", "open"\);/); // CHANGE
    assert.match(source, /toolbar\.appendChild\(addGroupBtn\);[\s\S]*toolbar\.appendChild\(allocateModeBtn\);[\s\S]*toolbar\.appendChild\(irrigationModeBtn\);/); // NEW
    assert.doesNotMatch(source, /function gardenModuleHasIrrigationSource\(moduleCell\)/); // CHANGE
    assert.doesNotMatch(source, /getXmlAttr\(cell, "irrigation_endpoint_type", ""\) === "source"/); // CHANGE
    assert.match(source, /window\.dispatchEvent\(new CustomEvent\(ALLOCATE_PLAN_EVENT, \{ detail: \{ moduleCellId: moduleCellId, year: getCurrentGardenYear\(moduleCell\) \} \}\)\)/); // NEW
    assert.match(source, /window\.TrellisIrrigationPlanner\.openIrrigationMode\(moduleCell, \{ selectCell: selectedBedCell \|\| null, preserveViewport: true \}\);/); // CHANGE
    assert.doesNotMatch(source, /sourceForm: true/); // CHANGE
    assert.match(source, /ui\.actions[\s\S]*trellisIrrigationPlanner/); // CHANGE
    assert.match(source, /allocateModeBtn\.disabled = !hasSettings;/); // NEW
    assert.match(source, /irrigationModeBtn\.disabled = !hasSettings;/); // CHANGE
    assert.match(source, /allocateModeBtn\.style\.display = bedMode \? "" : "none";/); // NEW
    assert.match(source, /irrigationModeBtn\.style\.display = "";/); // CHANGE
    assert.doesNotMatch(source, /gardenModuleHasIrrigationSource\(moduleCell\)/); // CHANGE
});

test('Garden module settings expose external margin but no internal margin', () => {
    const source = readPlantTilerSource();
    const dialogSource = sourceSlice(source, 'async function showGardenSettingsDialog', 'function plainGardenModuleLabel'); // CHANGE
    assert.doesNotMatch(source, /let marginBtn = null;/);
    assert.doesNotMatch(source, /marginBtn = makeButton\("Set Module Margin"\);/);
    assert.doesNotMatch(source, /toolbar\.appendChild\(marginBtn\);/);
    assert.doesNotMatch(source, /mxEvent\.addListener\(marginBtn, "click"/);
    assert.doesNotMatch(source, /function promptSetModuleMarginForModule\(moduleCell\)/);
    assert.doesNotMatch(source, /new mxEventObject\("usl:requestPromptSetModuleMargin", "cell", moduleCell\)/);
    assert.match(source, /const gardenWidthRow = row\("Garden width:", gardenWidthInput\);/); // CHANGE
    assert.match(source, /const gardenLengthRow = row\("Garden length:", gardenLengthInput\);/); // CHANGE
    assert.doesNotMatch(source, /row\("Internal margin:/); // CHANGE
    assert.match(source, /const moduleExternalMarginRow = row\("External margin:", moduleExternalMarginInput\);/); // NEW
    assert.match(source, /function getGardenModuleMargin\(moduleCell\) \{[\s\S]*return 0; \/\/ CHANGE: garden modules no longer expose or honor internal margins\./); // CHANGE
    assert.match(source, /const curModuleExternalMargin = getGardenModuleExternalMargin\(moduleCell\);/); // NEW
    assert.doesNotMatch(source, /chosenModuleMargin/); // CHANGE
    assert.match(source, /const chosenModuleExternalMargin = readModuleMarginInput\(moduleExternalMarginInput, chosenUnits\);/); // NEW
    assert.doesNotMatch(source, /Internal margin must be a non-negative number\./); // CHANGE
    assert.match(source, /External margin must be a non-negative number\./); // NEW
    assert.match(source, /Garden dimensions must be at least \$\{width\} by \$\{length\} \$\{bedDisplayUnitLabel\(units\)\} to fit existing contents\./); // CHANGE
    assert.match(source, /nextGeo\.width = chosenGardenWidthUnits;/); // CHANGE
    assert.match(source, /nextGeo\.height = chosenGardenHeightUnits;/); // CHANGE
    assert.doesNotMatch(dialogSource, /setGardenModuleMargin\(moduleCell,/); // CHANGE
    assert.match(source, /setGardenModuleExternalMargin\(moduleCell, chosenModuleExternalMargin\);/); // NEW
    assert.match(source, /if \(!toolbar \|\| !labelInputWrap \|\| !settingsBtn \|\| !addBedBtn \|\| !addGroupBtn \|\| !allocateModeBtn \|\| !irrigationModeBtn \|\| !moduleCell\) return;/); // CHANGE
});

test('Garden module overlay uses a single editable bed-style label input', () => {
    const source = readPlantTilerSource();
    const toolbarSource = sourceSlice(source, 'function makeGardenModuleLabelInput', 'function ensureToolbar');
    const labelWriterSource = sourceSlice(source, 'function writeGardenModuleLabel', 'function stopGardenLabelEvent');
    const attrWriterSource = sourceSlice(source, 'function setCellAttrsNoTxn', 'function cloneXmlValueWithAttrs');

    assert.match(source, /let labelInputWrap = null;/);
    assert.match(source, /labelInputWrap = document\.createElement\("div"\);/);
    assert.match(source, /labelInputWrap\.className = "trellis-garden-module-label-controls";/);
    assert.match(source, /toolbar\.appendChild\(labelInputWrap\);[\s\S]*toolbar\.appendChild\(settingsBtn\);/);
    assert.match(toolbarSource, /input\.setAttribute\("aria-label", "Garden label"\);/);
    assert.match(toolbarSource, /display:block;box-sizing:border-box;width:100%;min-width:0;margin-bottom:2px;border:1px solid rgba\(75,85,99,0\.35\);border-radius:4px;padding:3px 5px;font:12px Arial,sans-serif;font-weight:600;/);
    assert.match(toolbarSource, /if \(evt\.key === "Enter"\) \{[\s\S]*writeGardenModuleLabel\(moduleCell, input\.value\)[\s\S]*input\.blur/);
    assert.match(toolbarSource, /else if \(evt\.key === "Escape"\) \{[\s\S]*input\.value = initialLabel;/);
    assert.match(labelWriterSource, /setCellAttrsNoTxn\(graphModel, moduleCell, \{ label: next \}\);/);
    assert.match(attrWriterSource, /const clone = base\.cloneNode\(true\);[\s\S]*model\.setValue\(cell, clone\);/);
    assert.match(source, /labelInputWrap\.style\.display = bedMode \? "none" : "flex";/);
    assert.match(source, /if \(!bedMode\) renderGardenModuleLabelInput\(moduleCell\);/);
});

test('Garden module overlay repeated selected-module clicks toggle visibility without changing selection', () => {
    const source = readPlantTilerSource();

    assert.match(source, /let manuallyHiddenModuleCell = null;/);
    assert.match(source, /let pendingSelectedModuleToggle = null;/);
    assert.match(source, /function selectedGardenModulePlainClickTarget\(me, evt\) \{[\s\S]*const selectedModule = getSingleSelectedGardenModule\(\);[\s\S]*if \(activeOverlayMode !== "module" \|\| activeModuleCell !== selectedModule\) return null;[\s\S]*return mouseEventCell\(me, evt\) === selectedModule \? selectedModule : null;/);
    assert.match(source, /function clearHiddenModuleIfTargetChanged\(target\) \{[\s\S]*if \(!target \|\| target\.mode !== "module" \|\| target\.moduleCell !== manuallyHiddenModuleCell\) manuallyHiddenModuleCell = null;/);
    assert.match(source, /function toggleHiddenModuleAfterSimpleClick\(evt\) \{[\s\S]*manuallyHiddenModuleCell = manuallyHiddenModuleCell === pending \? null : pending;/);
    assert.match(source, /pendingSelectedModuleToggle = selectedGardenModulePlainClickTarget\(me, evt\);/);
    assert.match(source, /toggleHiddenModuleAfterSimpleClick\(evt\);/);
    assert.match(source, /clearHiddenModuleIfTargetChanged\(target\);[\s\S]*if \(target\.mode === "module" && target\.moduleCell === manuallyHiddenModuleCell\) \{ hideToolbar\(\); return; \}/);
});

test('Garden module overlay suppresses plan actions while irrigation mode is active', () => {
    const source = readPlantTilerSource();
    assert.match(source, /function isIrrigationModeActiveForOverlay\(\)/);
    assert.match(source, /planner\.isIrrigationModeActive\(\)/);
    assert.match(source, /function positionToolbar\(\) \{[\s\S]*if \(isIrrigationModeActiveForOverlay\(\)\) \{ hideToolbar\(\); return; \}/);
    assert.match(source, /function refreshForSelection\(\) \{[\s\S]*if \(isIrrigationModeActiveForOverlay\(\)\) \{[\s\S]*hideToolbar\(\);[\s\S]*return;/);
    assert.match(source, /mxEvent\.addListener\(window, "trellisIrrigationModeChanged", scheduleRefresh\);/);
});

test('Plant group creation finalizes tiling and bed fit inside the creation transaction', () => {
    const source = readPlantTilerSource();
    const finalizer = sourceSlice(source, 'function finalizeCreatedTilerGroup', 'function createDefaultGardenBed');
    const createEmpty = sourceSlice(source, 'function createEmptyTilerGroup', '// ---------- Debug helpers');

    assert.match(finalizer, /retileAndFitToContainingBed\(graph, group, \{ source: debugSource, inTransaction: true, txnId \}\);/);
    assert.match(createEmpty, /const creationSource = \(opts && opts\.source\) \|\| "empty-group";[\s\S]*const creationTxnId = \+\+bedFitTxnSeq;[\s\S]*model\.beginUpdate\(\);[\s\S]*graph\.addCell\(group, moduleCell\);[\s\S]*finalizeCreatedTilerGroup\(graph, group, moduleCell, creationSource, creationTxnId\);[\s\S]*model\.endUpdate\(\);/);
    assert.match(createEmpty, /notifyTilerGroupCreated\(graph, group, creationSource, creationTxnId\);/);
    assert.doesNotMatch(createEmpty, /retileGroup\(graph, group\);/);
});

test('scheduler sibling plant groups clone footprint and attrs without reusing source id', () => {
    const source = readPlantTilerSource();
    const helperSource = sourceSlice(source, 'function createSiblingTilerGroupFromSource', 'function computeGridStatsXY');
    assert.match(helperSource, /const geometry = sourceGeo\.clone \? sourceGeo\.clone\(\) : new mxGeometry\(sourceGeo\.x, sourceGeo\.y, sourceGeo\.width, sourceGeo\.height\);/);
    assert.match(helperSource, /const offsetCm = opts\.layoutOffsetCm \|\| opts\.offsetCm \|\| null;/);
    assert.match(helperSource, /value\.setAttribute\("layout_offset_x_cm", String\(offsetXCm\)\)/);
    assert.match(helperSource, /value\.setAttribute\("layout_offset_y_cm", String\(offsetYCm\)\)/);
    assert.doesNotMatch(helperSource, /geometry\.x = Number\(geometry\.x \|\| 0\) \+/);
    assert.doesNotMatch(helperSource, /attrs\.companion_layout_clamped = "1";/);
    assert.match(helperSource, /const sourceStyle = typeof sourceCell\.getStyle === "function" \? sourceCell\.getStyle\(\) : sourceCell\.style;/); // CHANGE
    assert.match(helperSource, /const style = upsertStyleKV\(sourceStyle \|\| groupFrameStyle\(\), "connectable", "0"\);/); // CHANGE
    assert.match(helperSource, /const group = new mxCell\(value, geometry, style\);/); // CHANGE
    assert.match(helperSource, /group\.setVertex\(true\);/);
    assert.match(helperSource, /activeGraphArg\.addCell\(group, parent\);/);
    assert.match(helperSource, /reorderModuleChildrenForLayering\(model, parent\);/);
    assert.doesNotMatch(helperSource, /group\.id\s*=\s*sourceCell\.id/);
    assert.match(source, /createSiblingTilerGroupFromSource,/);
});

test('planting groups and plant circles disable native Draw.io connectors', () => { // CHANGE
    const source = readPlantTilerSource(); // CHANGE
    const circleStyle = sourceSlice(source, 'function plantCircleStyle', 'function groupFrameStyle'); // CHANGE
    const groupStyle = sourceSlice(source, 'function groupFrameStyle', 'let __dbPathCached'); // CHANGE
    assert.match(circleStyle, /"connectable=0"/); // CHANGE
    assert.match(groupStyle, /"connectable=0"/); // CHANGE
}); // CHANGE

test('interplant companion groups offset alternating tile slots during retile', () => {
    const source = readPlantTilerSource();
    const slotSource = sourceSlice(source, 'function logicalSlotCenterLocal', 'function geometryFromVisualCenter');
    const expandSource = sourceSlice(source, 'function expandTiles', 'function hasTileRC');
    const trimSource = sourceSlice(source, 'function trimGroupToPlantFootprint', 'function applyBedFitGeometry');
    assert.match(slotSource, /function isInterplantLayoutGroup\(groupCell\)/);
    assert.match(slotSource, /getXmlAttr\(groupCell, "companion_layout_interplant", ""\) === "1"/);
    assert.match(slotSource, /function interplantSlotCenterLocal\(groupCell, r, c, spacingXpx, spacingYpx, bandPx\)/);
    assert.match(slotSource, /if \(\(r \+ c\) % 2 !== 0\) return center;/);
    assert.match(slotSource, /x: Math\.min\(maxX, center\.x \+ spacingXpx \/ 2\)/);
    assert.match(source, /function layoutGridOffsetPx\(groupCell\)/);
    assert.match(source, /getXmlAttr\(groupCell, "companion_offset_x_cm", ""\)/);
    assert.match(source, /function clampSlotCenterInsidePlantingFrame\(groupCell, center, iconDiamPx, bandPx\)/);
    assert.match(slotSource, /function layoutSlotCenterLocal\(groupCell, r, c, spacingXpx, spacingYpx, bandPx, iconDiamPx\)/);
    assert.match(slotSource, /const logical = interplantSlotCenterLocal\(groupCell, r, c, spacingXpx, spacingYpx, bandPx\);/);
    assert.match(slotSource, /const shifted = \{[\s\S]*x: logical\.x \+ offset\.x,[\s\S]*y: logical\.y \+ offset\.y/);
    assert.match(expandSource, /tileGeometryAtSlot\(groupCell, r, c, spacingXpx, spacingYpx, iconDiamPx, bandPx\)/);
    assert.match(trimSource, /reason: "layout-grid-offset"/);
});

test('Bed fit diagnostics expose a self-verifying debug surface', () => {
    const source = readPlantTilerSource();
    assert.match(source, /function bedFitStatus\(\)/);
    assert.match(source, /function installTrellisDebugSurface\(\)/);
    assert.match(source, /win\.Trellis = win\.Trellis \|\| \{\};/);
    assert.match(source, /debug\.bedFitStatus = bedFitStatus;/);
    assert.match(source, /debug\.enable = function \(\) \{[\s\S]*trellis_users_debug", "1"[\s\S]*trellis_bed_fit_debug", "1"/);
    assert.match(source, /debug\.disable = function \(\) \{[\s\S]*removeItem\("trellis_users_debug"\)[\s\S]*removeItem\("trellis_bed_fit_debug"\)/);
    assert.match(source, /debug\.probe = debugProbe;/);
    assert.match(source, /installTrellisDebugSurface\(\);[\s\S]*bedFitLog\("loaded", bedFitStatus\(\)\);/);
});

test('Bed fit centers only fitted axes after plant group resize', () => {
    const source = readPlantTilerSource();
    const helperSource = sourceSlice(source, 'function positionGeometryForLocalPointAxisAware', 'function plantingFrameLocalCenter');
    const fitSource = sourceSlice(source, 'function applyBedFitGeometry', 'function retileAfterBedFit');
    const trimSource = sourceSlice(source, 'function buildAxisAwareTrimGeometry', 'function trimGroupToPlantFootprint');

    assert.match(helperSource, /const preserved = preservePoint \|\| modelPointForLocalPoint\(next, localPoint, angleDeg\);/);
    assert.match(helperSource, /const preserveLocal = rotateModelPoint\(preserved, targetPoint, -angleRad\);/);
    assert.match(helperSource, /x: fitWidth \? centerLocal\.x : preserveLocal\.x/);
    assert.match(helperSource, /y: fitHeight \? centerLocal\.y : preserveLocal\.y/);
    assert.match(helperSource, /const axisTargetPoint = rotateModelPoint\(axisTargetLocal, targetPoint, angleRad\);/);
    assert.match(fitSource, /positionGeometryForLocalPointAxisAware\(next, frameCenter, bedCenter, bedRotation, fitWidth, fitHeight\);/);
    assert.match(trimSource, /positionGeometryForLocalPointAxisAware\(next, localPlantCenter, bedCenter, getTilerRotationDeg\(bed\), fitWidth, fitHeight\);/);
    assert.doesNotMatch(fitSource, /positionGeometryForLocalPoint\(next, frameCenter, bedCenter, bedRotation\);/);
    assert.doesNotMatch(trimSource, /positionGeometryForLocalPoint\(next, localPlantCenter, bedCenter, getTilerRotationDeg\(bed\)\);/);
    assert.match(fitSource, /if \(!fitWidth && !fitHeight\) \{[\s\S]*reason: "not-close-enough"[\s\S]*return null;/);
});

test('Bed fit persists per-axis intent and bed resize consumes only persisted axes', () => {
    const source = readPlantTilerSource();
    const fitSource = sourceSlice(source, 'function applyBedFitGeometry', 'function retileAfterBedFit');
    const normalizeSource = sourceSlice(source, 'function normalizeMovedTilerGroupsToBeds', 'function retileAndFitToContainingBed');
    const listenerSource = sourceSlice(source, 'function installBedAutoFitListeners', 'function minGroupSizePx');

    assert.match(source, /const BED_FIT_WIDTH_ATTR = "bed_fit_width";/);
    assert.match(source, /const BED_FIT_HEIGHT_ATTR = "bed_fit_height";/);
    assert.match(source, /function bedFitAxesForGroup\(groupCell\)/);
    assert.match(source, /function writeBedFitAxesNoTxn\(model, groupCell, fitWidth, fitHeight\)/);
    assert.match(source, /isTilerGroup\(groupCell\) \|\| isIrrigationBedAssembly\(groupCell\)/);
    assert.match(source, /function normalizeMovedBedAssembliesToBeds\(cells, opts\)/);
    assert.match(source, /fitOnDrag \? \{ fitWidth: true, fitHeight: true \} : inferBedAssemblyFitAxes\(assembly, bed\)/);
    assert.match(source, /syncBedAssemblyFitToBed\(parent, assembly, bed, axes, \{ inTransaction: true \}\)/);
    assert.match(fitSource, /const usePersistedFitAxes = !!\(debugCtx && debugCtx\.usePersistedFitAxes\);/);
    assert.match(fitSource, /const fitWidth = usePersistedFitAxes \? forcedFitWidth : \(widthClose \|\| canDragFit\);/);
    assert.match(fitSource, /const fitHeight = usePersistedFitAxes \? forcedFitHeight : \(heightClose \|\| canDragFit\);/);
    assert.match(fitSource, /if \(persistAxisIntent\) writeBedFitAxesNoTxn\(model, tg, fitWidth, fitHeight\);/);
    assert.match(fitSource, /if \(persistAxisIntent\) writeBedFitAxesNoTxn\(model, tg, false, false\);/);
    assert.match(normalizeSource, /const persistAxisIntent = !!\(opts && opts\.persistAxisIntent\);/);
    assert.match(listenerSource, /source: "cells-moved"[\s\S]*persistAxisIntent: true/);
    assert.match(listenerSource, /source: "cells-resized"[\s\S]*persistAxisIntent: true[\s\S]*clearFitAxisIntentOnNoBed: true/);
});

test('Garden bed resize refits before-contained groups without capturing expanded-bed neighbors', () => {
    const source = readPlantTilerSource();
    const snapshotSource = sourceSlice(source, 'function buildBedResizeSnapshot', 'function collectBedResizeSnapshots');
    const resizeIntegrationSource = sourceSlice(source, 'function syncIrrigationBedAssembliesForSnapshot', '// -------------------- Resize');
    const refitSource = sourceSlice(source, 'function refitGroupsForResizedBeds', '// -------------------- Resize');
    const wrapperSource = sourceSlice(source, 'function installResizeCellsWrapper', '// ---- Public API export');

    assert.match(snapshotSource, /const previousRect = getModelRect\(bed\);/);
    assert.match(snapshotSource, /const previousRotatedRect = rotatedRectForModelRect\(bed, previousRect\);/);
    assert.match(snapshotSource, /const assemblyTargets = \[\];/);
    assert.match(snapshotSource, /const geometryBed = resolveBedForAssemblyGeometry\(parent, child, null\);/);
    assert.match(snapshotSource, /const ownsByCachedLink = !geometryBed && child\.getAttribute\("irrigation_linked_bed_id"\) === bedId;/);
    assert.match(snapshotSource, /const axes = bedFitAxesForBedAssembly\(child, bed\);/);
    assert.match(snapshotSource, /assemblyTargets\.push\(\{ assembly: child, axes \}\)/);
    assert.match(snapshotSource, /child\.getAttribute\(BED_AUTO_FIT_ATTR\) === "0"/);
    assert.match(snapshotSource, /const axes = bedFitAxesForGroup\(child\);[\s\S]*if \(!axes\.fitWidth && !axes\.fitHeight\) continue;/);
    assert.match(snapshotSource, /if \(!pointInRotatedRectModel\(center, previousRotatedRect\)\) continue;/);
    assert.match(resizeIntegrationSource, /planner\.syncLinkedBedAssemblyToBed\(snapshot\.parent, assembly, snapshot\.bed, \{ inTransaction: !!\(opts && opts\.inTransaction\), fitWidth: !!axes\.fitWidth, fitHeight: !!axes\.fitHeight \}\)/);
    assert.match(refitSource, /syncIrrigationBedAssembliesForSnapshot\(snap, \{ inTransaction: !ownsTransaction \}\)/);
    assert.match(refitSource, /usePersistedFitAxes: true/);
    assert.match(refitSource, /forceFitWidth: !!\(item\.axes && item\.axes\.fitWidth\)/);
    assert.match(refitSource, /forceFitHeight: !!\(item\.axes && item\.axes\.fitHeight\)/);
    assert.match(refitSource, /retileAfterBedFit\(item\.tg/);
    assert.match(refitSource, /trimGroupToPlantFootprint\(item\.tg, item\.bed, bbox, item\.fitWidth, item\.fitHeight/);
    assert.match(wrapperSource, /const bedSnapshots = collectBedResizeSnapshots\(cells\);/);
    assert.match(wrapperSource, /const hasResizedBeds = bedSnapshots\.size > 0;/);
    assert.match(wrapperSource, /refitGroupsForResizedBeds\(bedSnapshots, \{ source: "bed-resized", inTransaction: true, txnId: bedResizeTxnId \}\);/);
    assert.match(wrapperSource, /for \(const assembly of bedFitResult\.syncedAssemblies \|\| \[\]\) groupsNeedingRefresh\.push\(assembly\);/);
});

test('Layering orders bed assemblies between beds and planting groups', () => {
    const source = readPlantTilerSource();
    const layeringSource = sourceSlice(source, 'function isIrrigationBedAssembly', 'function findTilerGroupAncestor');
    const exportSource = sourceSlice(source, '// ---- Public API export', 'installTrellisDebugSurface');

    assert.match(layeringSource, /cell\.getAttribute\("irrigation_assembly"\) === "1" && cell\.getAttribute\("irrigation_assembly_type"\) === "bed"/);
    assert.match(layeringSource, /const bedAssemblies = \[\];/);
    assert.match(layeringSource, /else if \(isIrrigationBedAssembly\(ch\)\) bedAssemblies\.push\(ch\);/);
    assert.match(layeringSource, /const ordered = beds\.concat\(bedAssemblies, others, groups\);/);
    assert.match(source, /if \(isGardenBed\(c\) \|\| isIrrigationBedAssembly\(c\) \|\| isTilerGroup\(c\)\)/);
    assert.match(exportSource, /reorderModuleChildrenForLayering/);
});

test('Garden module overlay exposes plant group creation only in bed mode', () => { // CHANGE
    const source = readPlantTilerSource();
    const overlayAdd = sourceSlice(source, 'mxEvent.addListener(addGroupBtn, "click"', 'mxEvent.addListener(irrigationModeBtn, "click"'); // CHANGE
    const toolbarState = sourceSlice(source, 'function syncToolbarState()', 'function refreshForSelection()'); // CHANGE

    assert.match(overlayAdd, /const bedCell = activeBedCell;/); // CHANGE
    assert.match(overlayAdd, /if \(!moduleCell \|\| !bedCell \|\| activeOverlayMode !== "bed" \|\| !pt \|\| !hasGardenSettingsSet\(moduleCell\)\) return;/); // CHANGE
    assert.match(overlayAdd, /createEmptyTilerGroup\(graph, moduleCell, pt\.x, pt\.y, \{ source: "overlay-bed-add" \}\);/); // CHANGE
    assert.doesNotMatch(overlayAdd, /overlay-module-add/); // CHANGE
    assert.doesNotMatch(overlayAdd, /retileAndFitToContainingBed\(graph, group/);
    assert.match(toolbarState, /addGroupBtn\.style\.display = bedMode \? "" : "none";/); // CHANGE
});

test('Context menu plant group creation requires a garden bed target', () => { // CHANGE
    const source = readPlantTilerSource();
    const contextMenu = sourceSlice(source, 'function resolveGardenBedTarget', 'log("[bed] empty tiler group created"'); // CHANGE
    const wrapCreate = sourceSlice(source, 'function createTilerGroupFromCircle', 'function computeGridStatsXY');

    assert.match(contextMenu, /const t = isGardenBed\(cand\) \? cand : null;/); // CHANGE
    assert.match(contextMenu, /if \(targetBed && targetMod && isGardenModule\(targetMod\)\)/); // CHANGE
    assert.match(contextMenu, /createEmptyTilerGroup\(graph, targetMod, pt\.x, pt\.y, \{ source: "context-bed-add" \}\);/); // CHANGE
    assert.doesNotMatch(contextMenu, /createEmptyTilerGroup\(graph, targetMod, pt\.x, pt\.y\);/); // CHANGE
    assert.match(wrapCreate, /model\.beginUpdate\(\);[\s\S]*graph\.addCell\(group, parent\);[\s\S]*finalizeCreatedTilerGroup\(graph, group, parent, "plant-circle-wrap"\);[\s\S]*model\.endUpdate\(\);/);
    assert.match(wrapCreate, /model\.setGeometry\(c, local\);/);
    assert.doesNotMatch(wrapCreate, /retileGroup\(graph, group\);/);
});

test('Plant Tiler exposes Allocate proposal and creation contracts', () => {
    const source = readPlantTilerSource();
    assert.match(source, /function proposePlantingGeometry\(input = \{\}\)/);
    assert.match(source, /function createPlantingFromProposal\(input = \{\}, opts = \{\}\)/);
    assert.match(source, /function listGardenBeds\(moduleCell\)/);
    assert.match(source, /function readBedProfile\(bedCell\)/);
    assert.match(source, /function listPlantingFootprints\(moduleCell, options = \{\}\)/);
    assert.match(source, /function proposalConflictsForRect\(input, rect\)/);
    assert.match(source, /orientationOverride/);
    assert.match(source, /entryISO/);
    assert.match(source, /harvestEndISO/);
    assert.match(source, /proposePlantingGeometry,/);
    assert.match(source, /createPlantingFromProposal,/);
    assert.match(source, /listGardenBeds,/);
    assert.match(source, /readBedProfile,/);
    assert.match(source, /listPlantingFootprints,/);
    assert.match(source, /slots: buildProposalSlots\(best, plantCount\)/);
    assert.match(source, /lodCollapsed: best\.capacity > LOD_TILE_THRESHOLD/);
    assert.match(source, /const vegHeightCm = Number\(input\.vegHeightCm \?\? input\.veg_height_cm\)/);
    assert.match(source, /vegHeightCm: Number\.isFinite\(vegHeightCm\) && vegHeightCm > 0 \? vegHeightCm : null/);
    assert.match(source, /veg_height_cm: proposal\.vegHeightCm == null/);
    assert.match(source, /const insideUpdate = !!\(input\.insideUpdate \|\| opts\.insideUpdate\)/);
    assert.match(source, /createEmptyTilerGroup\(activeGraphArg, moduleCell/);
});
