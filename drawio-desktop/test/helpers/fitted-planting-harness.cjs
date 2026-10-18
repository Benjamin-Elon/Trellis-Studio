const fs = require('node:fs'); // CHANGE
const path = require('node:path'); // CHANGE
const vm = require('node:vm'); // CHANGE
const pluginPath = path.join(__dirname, '../../drawio/src/main/webapp/plugins/garden_planner_plugins/Planting_Group.js'); // CHANGE
const source = fs.readFileSync(pluginPath, 'utf8'); // CHANGE

/** Evaluate production geometry without booting unrelated draw.io controls. */ // CHANGE
function sourceFunction(name) { // CHANGE
    const start = source.indexOf(`    function ${name}(`); // CHANGE
    if (start < 0) throw new Error(`Missing tiler function: ${name}`); // CHANGE
    const end = source.slice(start + 1).search(/^    (?:async )?function /m); // CHANGE
    return end < 0 ? source.slice(start) : source.slice(start, start + 1 + end); // CHANGE
} // CHANGE

function loadFittedPlantingGeometry() { // CHANGE
    const model = { getChildCount: cell => (cell.children || []).length, getChildAt: (cell, i) => cell.children[i], isVertex: () => true }; // CHANGE
    const graph = { getModel: () => model, getCellStyle: cell => ({ rotation: cell.rotation || 0 }) }; // CHANGE
    const context = vm.createContext({ graph, mxConstants: { STYLE_ROTATION: 'rotation' }, console, window: { addEventListener() {} } }); // CHANGE: pure geometry fixtures do not dispatch crop-default UI events.
    const config = source.slice(source.indexOf('    const PX_PER_CM'), source.indexOf('    // -------------------- Debug helper')); // CHANGE
    const names = ['toPx', 'clamp', 'groupLabelMetrics', 'resolveAllowedOverhangPct', 'allowedOverhangForDiameter', 'bedFitLabelBandPxForSize', 'solveOuterHeightForPlantingFrame', // CHANGE
        'nearlySameNumber', 'toRad', 'rotateVectorModel', 'rotatePointAround', 'positionGeometryForLocalPoint', 'modelPointForLocalPoint', 'getTilerRotationDeg', // CHANGE
        'ymdValue', 'ymdIntervalsOverlap', 'plantingProposalConflictRank', 'computeGridStatsXY', 'classifyPlantingSlots', 'getXmlAttr', 'finiteNumberOrNull', // CHANGE
        'layoutGridOffsetPx', 'layoutGridBaseOffsetPx', 'plantingLayoutDiameterPx', 'shiftedSlotCenterLocal', 'interplantSlotCenterLocal', 'logicalSlotCenterLocal', 'isInterplantLayoutGroup', // CHANGE
        'plantingContentBoundsLocal', 'isPointInPlantingContentArea', 'snapshotTileMap', 'readDisabledSet', 'safeJsonParse', 'applyCounts', 'writeDisabledSet', // CHANGE
        'writeBedFitAxesNoTxn', 'createPlantingFromProposal', 'readPlantingFootprint']; // CHANGE
    const geometryCode = source.slice(source.indexOf('    /** Returns the corners of a planting footprint'), source.indexOf('    function previewDraftNumber')); // CHANGE
    vm.runInContext(config + names.map(sourceFunction).join('\n') + geometryCode, context); // CHANGE
    // Only graph plumbing/rendering is substituted; production slot classification supplies committed counts. // CHANGE
    vm.runInContext(`
        function setCellAttrsNoTxn(model, cell, attrs) { Object.assign(cell.attrs, attrs); } // CHANGE
        function isGardenModule() { return true; } // CHANGE
        function isTilerGroup() { return true; } // CHANGE
        function isCollapsedLOD(cell) { return cell.attrs.lod_collapsed === '1'; } // CHANGE
        function getPlantCircleDiameterPx(cell) { return toPx(Number(cell.attrs.veg_diameter_cm || 0)); } // CHANGE
        function getPlantCircleBBoxLogical() { return null; } // CHANGE
        function getCurrentGardenYear() { return 2027; } // CHANGE: proposal creation initializes the final cell directly.
        function createXmlValue(name, attrs) { return attrs; } // CHANGE
        function groupFrameStyle() { return ''; } // CHANGE
        function reorderModuleChildrenForLayering() {} // CHANGE
        function notifyTilerGroupCreated() {} // CHANGE
        let bedFitTxnSeq = 0; // CHANGE
        function mxCell(attrs, geometry) { Object.assign(this, { attrs, geometry }); } // CHANGE
        mxCell.prototype.getAttribute = function (key) { return this.attrs[key]; }; // CHANGE
        mxCell.prototype.getGeometry = function () { return this.geometry; }; // CHANGE
        mxCell.prototype.setVertex = mxCell.prototype.setConnectable = mxCell.prototype.setCollapsed = function () {}; // CHANGE
        function setCellRotationDeg(cell, rotation) { cell.rotation = rotation; } // CHANGE
        function retileGroup(graph, cell, opts) { // CHANGE
            const sx = toPx(Number(cell.attrs.spacing_x_cm)), sy = toPx(Number(cell.attrs.spacing_y_cm)); // CHANGE
            const stats = classifyPlantingSlots(cell, sx, sy, groupLabelMetrics(cell).bandPx, readDisabledSet(cell)); // CHANGE
            applyCounts(graph.getModel(), cell, stats, readDisabledSet(cell)); // CHANGE
            cell.attrs.lod_collapsed = opts.forceCollapse ? '1' : '0'; // CHANGE
        } // CHANGE
        function mxGeometry(x, y, width, height) { Object.assign(this, { x, y, width, height }); } // CHANGE
    `, context); // CHANGE
    model.beginUpdate = () => {}; model.endUpdate = () => {}; model.setGeometry = (cell, geo) => { cell.geometry = geo; }; // CHANGE
    graph.addCell = cell => cell; graph.setSelectionCell = () => {}; // CHANGE: leave graph rendering to the real-mxGraph integration tests.
    const api = vm.runInContext('({ proposePlantingGeometry, plantingFootprintPolygon, clipPlantingFootprint, plantingFootprintUnionArea, groupLabelMetrics, computeGridStatsXY, classifyPlantingSlots, shiftedSlotCenterLocal, readDisabledSet, createPlantingFromProposal, readPlantingFootprint, modelPointForLocalPoint, toPx })', context); // CHANGE
    return Object.assign(api, { graph }); // CHANGE
} // CHANGE

module.exports = { loadFittedPlantingGeometry }; // CHANGE
