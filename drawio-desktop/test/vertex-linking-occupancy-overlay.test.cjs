const assert = require("node:assert/strict"); // NEW
const fs = require("node:fs"); // NEW
const path = require("node:path"); // NEW
const test = require("node:test"); // NEW

const PLUGIN_PATH = path.join( // NEW
    __dirname, // NEW
    "..", // NEW
    "drawio", // NEW
    "src", // NEW
    "main", // NEW
    "webapp", // NEW
    "plugins", // NEW
    "garden_planner_plugins", // NEW
    "Vertex_Linking_Standalone.js" // NEW
); // NEW

function readSource() { // NEW
    return fs.readFileSync(PLUGIN_PATH, "utf8"); // NEW
} // NEW

function sourceBetween(source, startMarker, endMarker) { // NEW
    const startIndex = source.indexOf(startMarker); // NEW
    assert.notEqual(startIndex, -1, "Missing start marker: " + startMarker); // NEW
    const endIndex = source.indexOf(endMarker, startIndex); // NEW
    assert.notEqual(endIndex, -1, "Missing end marker: " + endMarker); // NEW
    return source.slice(startIndex, endIndex); // NEW
} // NEW

test("planting overlay has Cards, Schedule, and Occupancy modes", () => { // NEW
    const source = readSource(); // NEW

    assert.match(source, /const MODE_OCCUPANCY = 'occupancy';/); // NEW
    assert.match(source, /createModeButton\(entry, 'Cards', MODE_CARDS\)/); // NEW
    assert.match(source, /createModeButton\(entry, 'Schedule', MODE_SCHEDULE\)/); // NEW
    assert.match(source, /createModeButton\(entry, 'Occupancy', MODE_OCCUPANCY\)/); // NEW
    assert.match(source, /activeMode = mode === MODE_OCCUPANCY \? MODE_OCCUPANCY : \(mode === MODE_SCHEDULE \? MODE_SCHEDULE : MODE_CARDS\)/); // NEW
}); // NEW

test("schedule-only planting overlays expose Occupancy without linked tasks", () => { // NEW
    const source = readSource(); // NEW

    assert.match(source, /function createScheduleOnlyHeader\(entry\)[\s\S]*createModeButton\(entry, 'Schedule', MODE_SCHEDULE, effectiveMode\)/); // NEW
    assert.match(source, /function createScheduleOnlyHeader\(entry\)[\s\S]*createModeButton\(entry, 'Occupancy', MODE_OCCUPANCY, effectiveMode\)/); // NEW
    assert.match(source, /if \(activeMode === MODE_OCCUPANCY\) \{[\s\S]*renderOccupancyView\(entry, body\);[\s\S]*\}/); // NEW
}); // NEW

test("occupancy uses navigator API with selected-group fallback", () => { // NEW
    const source = readSource(); // NEW

    assert.match(source, /graph\.__trellisBedSuccessionNavigator\.getSelectedClusterOccupancy/); // NEW
    assert.match(source, /const result = api\.getSelectedClusterOccupancy\(source\);/); // NEW
    assert.match(source, /return fallbackOccupancyForSource\(source\);/); // NEW
}); // NEW

test("occupancy interval prefers transplant date, then sow date, and requires harvest end", () => { // NEW
    const source = readSource(); // NEW

    assert.match(source, /parseTaskOverlayDate\(getAttr\(cell, 'transplant_date'\)\) \|\| parseTaskOverlayDate\(getAttr\(cell, 'sow_date'\)\)/); // NEW
    assert.match(source, /parseTaskOverlayDate\(getAttr\(cell, 'harvest_end'\)\)/); // NEW
    assert.match(source, /if \(!start \|\| !end \|\| end\.dayNumber < start\.dayNumber\) return \{ startISO: null, endISO: null \};/); // NEW
    assert.match(source, /renderOccupancyUnscheduledSection\(entry, body, unscheduledItems\);/); // NEW
}); // NEW

test("occupancy rows select and reveal their planting group", () => { // NEW
    const source = readSource(); // NEW

    assert.match(source, /function makeOccupancyRow\(entry, item\)[\s\S]*const cell = item && item\.cellId \? model\.getCell\(item\.cellId\) : null;/); // NEW
    assert.match(source, /if \(cell && model\.isVertex\(cell\)\) selectAndReveal\(cell\);/); // NEW
}); // NEW

test("same-crop sibling task highlights use blue without changing direct link red", () => { // NEW
    const source = readSource(); // NEW

    assert.match(source, /const RED = '#ff0000';/); // NEW
    assert.match(source, /const SAME_CROP_HIGHLIGHT = '#2563eb';/); // NEW
    assert.match(source, /for \(const otherCard of sameBoardLinkedCards\)[\s\S]*highlight\(otherCard, otherIsPrimary \? YELLOW : SAME_CROP_HIGHLIGHT, 1\.5\);/); // NEW
}); // NEW

test("standard link overlays use the native draw.io overlay pane", () => { // NEW
    const source = readSource(); // NEW
    const linkOverlaySource = sourceBetween(source, "const linkOverlays = (function () {", "function formatLinkOverlayBadgeLabel"); // NEW

    assert.match(linkOverlaySource, /function getOverlayPane\(\) \{[\s\S]*const view = graph\.getView && graph\.getView\(\);[\s\S]*return view && view\.getOverlayPane \? view\.getOverlayPane\(\) : null;/); // NEW
    assert.doesNotMatch(linkOverlaySource, /ensureGraphOverlaySvgLayer\('connection'\)/); // NEW
}); // NEW

test("task overlay guide lines keep the custom connection layer", () => { // NEW
    const source = readSource(); // NEW
    const taskOverlaySource = sourceBetween(source, "const taskScheduleOverlay = (function () {", "function getPanelHost"); // NEW

    assert.match(taskOverlaySource, /ensureGraphOverlaySvgLayer\('connection'\)/); // NEW
}); // NEW

test("selected linked vertices draw direct connections even when task overlay is active", () => { // NEW
    const source = readSource(); // NEW
    const drawDecisionSource = sourceBetween(source, "// Decide visibility using internal lane-based policy", "for (const otherCard of sameBoardLinkedCards)"); // NEW

    assert.match(drawDecisionSource, /const shouldShow = shouldShowEdgeInternal\(cell, other\);/); // NEW
    assert.match(drawDecisionSource, /if \(shouldShow\) \{/); // NEW
    assert.match(drawDecisionSource, /linkOverlays\.setLinkOverlay\(/); // NEW
    assert.doesNotMatch(drawDecisionSource, /!taskOverlayActive/); // NEW
}); // NEW

test("standard link endpoints use a five pixel center offset", () => { // NEW
    const source = readSource(); // NEW
    const helperSource = sourceBetween(source, "function avoidStandardLinkEndpointCenterT", "function anchorStandardLinkEndpointOnSide"); // NEW
    const computePointsSource = sourceBetween(source, "function computePointsFor(entry)", "// Create or update text label"); // NEW

    assert.match(source, /const LINK_ENDPOINT_CENTER_OFFSET_PX = 5;/); // NEW
    assert.match(helperSource, /LINK_ENDPOINT_CENTER_OFFSET_PX/); // NEW
    assert.match(helperSource, /Math\.abs\(clampedT - 0\.5\)/); // NEW
    assert.match(computePointsSource, /anchorStandardLinkEndpointOnSide\(srcC, hint\.side, hint\.t, 4\)/); // NEW
    assert.match(computePointsSource, /anchorStandardLinkEndpointOnSide\(dstC, trgSide, 0\.5, 4\)/); // NEW
    assert.doesNotMatch(computePointsSource, /anchorOnSide\(dstC, trgSide, 0\.5\)/); // NEW
}); // NEW

test("task overlay guide lines keep centered anchors", () => { // NEW
    const source = readSource(); // NEW
    const taskLineSource = sourceBetween(source, "function createOrUpdateLine(entry, cardId, row)", "function refreshLines(entry)"); // NEW

    assert.match(taskLineSource, /anchorOnSide\(itemC, sideToward\(itemC, dstC\), 0\.5\)/); // NEW
    assert.match(taskLineSource, /anchorOnSide\(dstC, sideToward\(dstC, itemC\), 0\.5\)/); // NEW
    assert.doesNotMatch(taskLineSource, /anchorStandardLinkEndpointOnSide/); // NEW
}); // NEW
