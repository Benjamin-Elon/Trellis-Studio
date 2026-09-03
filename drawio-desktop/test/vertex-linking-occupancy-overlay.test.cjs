const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const PLUGIN_PATH = path.join(
    __dirname,
    "..",
    "drawio",
    "src",
    "main",
    "webapp",
    "plugins",
    "garden_planner_plugins",
    "Vertex_Linking_Standalone.js"
);

function readSource() {
    return fs.readFileSync(PLUGIN_PATH, "utf8");
}

function sourceBetween(source, startMarker, endMarker) {
    const startIndex = source.indexOf(startMarker);
    assert.notEqual(startIndex, -1, "Missing start marker: " + startMarker);
    const endIndex = source.indexOf(endMarker, startIndex);
    assert.notEqual(endIndex, -1, "Missing end marker: " + endMarker);
    return source.slice(startIndex, endIndex);
}

test("lane overlay headers do not use browser title tooltips", () => {
    const source = readSource();
    const headerSource = sourceBetween(source, "function createLaneHeader", "function renderCardView");

    assert.doesNotMatch(headerSource, /setAttribute\('title'|\.title\s*=/);
    assert.match(headerSource, /toggle\.textContent = collapsed \? '\+' : '-'/);
    assert.match(headerSource, /setLaneGroupCollapsed\(group, !isLaneGroupCollapsed\(group\)\)/);
});

test("planting overlay has Cards, Schedule, and Spacing modes", () => {
    const source = readSource();

    assert.match(source, /const MODE_SPACING = 'spacing';/); // CHANGE: physical layout controls moved into the diagram overlay.
    assert.match(source, /createModeButton\(entry, 'Cards', MODE_CARDS\)/);
    assert.match(source, /createModeButton\(entry, 'Schedule', MODE_SCHEDULE\)/);
    assert.match(source, /createModeButton\(entry, 'Spacing', MODE_SPACING\)/);
    assert.match(source, /activeMode = mode === MODE_SPACING \? MODE_SPACING : \(mode === MODE_SCHEDULE \? MODE_SCHEDULE : MODE_CARDS\)/);
});

test("schedule-only planting overlays expose Spacing without linked tasks", () => {
    const source = readSource();

    assert.match(source, /function createScheduleOnlyHeader\(entry\)[\s\S]*createModeButton\(entry, 'Schedule', MODE_SCHEDULE, effectiveMode\)/);
    assert.match(source, /function createScheduleOnlyHeader\(entry\)[\s\S]*createModeButton\(entry, 'Spacing', MODE_SPACING, effectiveMode\)/); // CHANGE: schedule-only overlays can still edit diagram spacing.
    assert.match(source, /if \(activeMode === MODE_SPACING\) \{[\s\S]*renderSpacingView\(entry, body\);[\s\S]*\}/);
});

test("spacing editor isolates each plant in a fixed-width row and labels inactive rows", () => {
    const source = readSource();
    const editorSource = sourceBetween(source, "function renderSpacingEditor", "function renderSpacingView");

    assert.match(source, /const SPACING_ROW_GRID_COLUMNS = 'minmax\(92px,1fr\) repeat\(4,minmax\(42px,46px\)\) 24px';/); // CHANGE: companion template column is removed; all rows use ordinary layout fields.
    assert.match(source, /function createSpacingGridRow\(className\)[\s\S]*row\.style\.gridTemplateColumns = SPACING_ROW_GRID_COLUMNS;[\s\S]*return row;/); // CHANGE: each plant owns one grid row.
    assert.match(editorSource, /const rowsWrap = document\.createElement\('div'\);/);
    assert.match(editorSource, /const headerRow = createSpacingGridRow\('manual-link-spacing-header'\);/);
    assert.match(editorSource, /const rowEl = createSpacingGridRow\('manual-link-spacing-row'\);/);
    assert.match(editorSource, /rowsWrap\.appendChild\(rowEl\);/);
    assert.match(editorSource, /marker\.textContent = 'Inactive';/); // CHANGE: visible but disabled rows must explain why they are not editable.
    assert.match(source, /input\.step = '1';/); // CHANGE: spacing tab number fields use native 1cm spinner intervals without changing decimal parsing.
    assert.match(source, /input\.style\.width = '100%';/);
    assert.match(source, /select\.style\.width = '100%';/);
    assert.match(editorSource, /rowEl\.appendChild\(labelCell\);[\s\S]*\[spacingX, spacingY, offsetX, offsetY\]\.forEach\(input => rowEl\.appendChild\(input\)\);[\s\S]*rowEl\.appendChild\(revert\);/); // CHANGE: plant fields cannot flow into another plant row.
    assert.doesNotMatch(editorSource, /rowEl\.appendChild\(template\);/); // CHANGE: companion templates are not part of spacing rows.
    assert.doesNotMatch(editorSource, /minmax\(80px,1fr\) 84px 64px 64px 64px 64px 50px/);
});

test("spacing editor preserves active-window preview and reserved revert gating", () => {
    const source = readSource();
    const editorSource = sourceBetween(source, "function renderSpacingEditor", "function renderSpacingView");

    assert.match(source, /function spacingIdleStatus\(rows\)[\s\S]*Only active-window rows preview and apply\./); // CHANGE: inactive rows remain context, not targets.
    assert.match(editorSource, /const changed = rowStates\.filter\(state => state\.row\.enabled !== false && spacingRowChanged\(state\)\);/);
    assert.match(editorSource, /revert\.textContent = '↺';/); // CHANGE: compact row action uses a revert symbol.
    assert.match(editorSource, /revert\.setAttribute\('aria-label', 'Restore plant defaults'\);/);
    assert.match(editorSource, /revert\.title = 'Restore plant defaults';/);
    assert.match(editorSource, /revert\.style\.visibility = 'hidden';/); // CHANGE: the revert cell stays in layout even when hidden.
    assert.match(editorSource, /state\.revert\.style\.visibility = showRevert \? 'visible' : 'hidden';/);
    assert.match(editorSource, /state\.revert\.style\.pointerEvents = showRevert \? 'auto' : 'none';/);
    assert.doesNotMatch(editorSource, /reset\.style\.display = 'none'|state\.reset\.style\.display/); // CHANGE: row actions must not remove a grid slot.
    assert.match(editorSource, /status\.textContent = validation\.ok \? idleStatus : validation\.errors\.join\(' '\);/);
    assert.match(editorSource, /const previewRows = draft\.map\(row => Object\.assign\(\{\}, row, \{ enabled: changed\.some\(state => state\.row\.cellId === row\.cellId\) \}\)\);/);
});

test("selected planting overlay clamps to cluster top instead of measuring occupancy navigator bounds", () => {
    const source = readSource();
    const boundsSource = sourceBetween(source, "function getClusterBoundsForPanel", "function positionPanel");
    const positionSource = sourceBetween(source, "function positionPanel", "function itemCenterFromRow");

    assert.match(boundsSource, /context\.overlayAnchorBounds \|\| context\.clusterBounds/); // CHANGE: overlay placement has a dedicated-anchor fallback before source bounds.
    assert.match(positionSource, /const sourceBounds = getClusterBoundsForPanel\(source\);/);
    assert.match(positionSource, /const left = sourceBounds\.x - PANEL_GAP - PANEL_SIDE_OFFSET - PANEL_WIDTH;/);
    assert.match(positionSource, /const centeredTop = sourceBounds\.y \+ sourceBounds\.h \/ 2 - panelHeight \/ 2;/);
    assert.match(positionSource, /const top = centeredTop < sourceBounds\.y \? sourceBounds\.y : centeredTop;/);
    assert.doesNotMatch(source, /function getOccupancyNavigatorBoundsForPanel|function rectsOverlap|occupancyNavigatorBounds/); // CHANGE: avoid render-order-sensitive Occupancy DOM measurement.
});

test("schedule action button mirrors Trellis user planting permissions", () => {
    const source = readSource();
    const helperSource = sourceBetween(source, "function canScheduleTilerGroup", "function getOccupancyNavigatorApi");
    const buttonSource = sourceBetween(source, "function createScheduleActionButton", "function createSetPlantActionButton");

    assert.match(helperSource, /window\.Trellis && window\.Trellis\.users/);
    assert.match(helperSource, /users\.isEnabled\(\)[\s\S]*users\.canManagePlanting\(cell\)/);
    assert.match(buttonSource, /const allowed = canScheduleTilerGroup\(source\);/);
    assert.match(buttonSource, /button\.title = scheduleActionButtonTitleFor\(source, opener, allowed\);/);
    assert.match(buttonSource, /button\.disabled = !opener \|\| !allowed;/);
    assert.match(buttonSource, /if \(!canScheduleTilerGroup\(liveSource\)\) return;/);
});

test("schedule action button label uses ordinary schedule wording for all plantings", () => {
    const source = readSource();
    const helperSource = sourceBetween(source, "function scheduleActionButtonLabelFor", "function createScheduleActionButton");
    const buttonSource = sourceBetween(source, "function createScheduleActionButton", "function createSetPlantActionButton");
    assert.match(helperSource, /return hasTilerSchedule\(source\) \? 'Edit schedule' : 'Set schedule';/);
    assert.doesNotMatch(source, /function existingCompanionSourceCell/);
    assert.doesNotMatch(source, /Edit companion/);
    assert.doesNotMatch(source, /Opens companion scheduling for this derived companion\./);
    assert.match(buttonSource, /button\.textContent = scheduleActionButtonLabelFor\(source\);/);
});

test("occupancy uses navigator API with selected-group fallback", () => {
    const source = readSource();

    assert.match(source, /graph\.__trellisBedSuccessionNavigator\.getSelectedClusterOccupancy/);
    assert.match(source, /const result = api\.getSelectedClusterOccupancy\(source\);/);
    assert.match(source, /return fallbackOccupancyForSource\(source\);/);
});

test("occupancy interval prefers transplant date, then sow date, and requires harvest end", () => {
    const source = readSource();

    assert.match(source, /parseTaskOverlayDate\(getAttr\(cell, 'transplant_date'\)\) \|\| parseTaskOverlayDate\(getAttr\(cell, 'sow_date'\)\)/);
    assert.match(source, /parseTaskOverlayDate\(getAttr\(cell, 'harvest_end'\)\)/);
    assert.match(source, /parseTaskOverlayDate\(getAttr\(cell, 'lifespan_start'\)\)/);
    assert.match(source, /parseTaskOverlayDate\(getAttr\(cell, 'lifespan_end'\)\)/);
    assert.match(source, /if \(!start \|\| !end \|\| end\.dayNumber < start\.dayNumber\) return \{ startISO: null, endISO: null \};/);
    assert.match(source, /renderOccupancyUnscheduledSection\(entry, body, unscheduledItems\);/);
});

test("derived schedule actions are gated by schedule dates and annual turnover", () => {
    const source = readSource();
    const helperSource = sourceBetween(source, "function createDerivedScheduleActionButton", "function hasAssignedPlant");
    assert.match(helperSource, /button\.textContent = mode === 'turnover' \? 'Add Turnover' : 'Add Companion';/);
    assert.match(helperSource, /const hasDates = sourceOccupancyCompleteForDerived\(source\);/);
    assert.match(helperSource, /const annualOk = mode !== 'turnover' \|\| sourceIsAnnual\(source\);/);
    assert.match(helperSource, /await opener\(ui, liveSource, \{ mode \}\);/);
});

test("occupancy relationship badges expose only explicit turnover gaps by tooltip", () => {
    const source = readSource();
    const badgeSource = sourceBetween(source, "function renderOccupancyRelationshipBadges", "function renderOccupancyRow");
    assert.doesNotMatch(badgeSource, /rel\.mode === 'companion'/);
    assert.doesNotMatch(badgeSource, /makeRelationshipBadge\('companion /);
    assert.match(badgeSource, /rel\.gapDays !== '' \? rel\.gapDays \+ 'd gap' : 'turnover'/);
    assert.match(badgeSource, /return 'Turnover relationship: ' \+ gap \+ '\.';/);
    assert.doesNotMatch(badgeSource, /makeRelationshipBadge\(gap, '#92400e'\)/);
    const rowSource = sourceBetween(source, "function renderOccupancyRow", "function renderScheduleRow");
    assert.match(rowSource, /const relationshipTooltip = renderOccupancyRelationshipBadges\(entry, labelCell, item, range\);/);
    assert.match(rowSource, /row\.title = relationshipTooltip;/);
    assert.match(rowSource, /track\.title = relationshipTooltip;/);
});

test("occupancy rows select and reveal their planting group", () => {
    const source = readSource();

    assert.match(source, /function makeOccupancyRow\(entry, item\)[\s\S]*const cell = item && item\.cellId \? model\.getCell\(item\.cellId\) : null;/);
    assert.match(source, /if \(cell && model\.isVertex\(cell\)\) selectAndReveal\(cell\);/);
});

test("role-card multi-selection dispatches to the multi-role link renderer", () => {
    const source = readSource();
    const refreshSource = sourceBetween(source, "function refreshCurrentHighlight", "function assignStandardLinkLabelOffsets");
    const selectionSource = sourceBetween(source, "graph.getSelectionModel().addListener(mxEvent.CHANGE", "// -------------------- Context Menu Hook");

    assert.match(source, /function isRoleCard\(cell\) \{[\s\S]*role_card=1/);
    assert.match(refreshSource, /const selected = selectedLinkableVertices\(\);/);
    assert.match(refreshSource, /if \(selected\.length === 1\) \{[\s\S]*highlightLinked\(cell\);/);
    assert.match(refreshSource, /if \(selected\.every\(isRoleCard\)\) \{[\s\S]*highlightLinkedRoleCards\(selected\);/);
    assert.match(selectionSource, /refreshCurrentHighlight\(\);/);
});

test("selection visual refresh event rebuilds link and schedule overlays", () => {
    const source = readSource();
    const selectionSource = sourceBetween(source, "graph.getSelectionModel().addListener(mxEvent.CHANGE", "// -------------------- Context Menu Hook");

    assert.match(source, /const TRELLIS_SELECTION_VISUALS_REFRESH_EVENT = 'trellisSelectionVisualsRefresh';/);
    assert.match(selectionSource, /graph\.addListener\(TRELLIS_SELECTION_VISUALS_REFRESH_EVENT,\s*function \(\) \{[\s\S]*refreshCurrentHighlight\(\);[\s\S]*taskScheduleOverlay\.refresh\(\);/);
});

test("multi-selected role cards draw links without opening task overlays", () => {
    const source = readSource();
    const multiRoleSource = sourceBetween(source, "function highlightLinkedRoleCards", "function highlightLinked(cell)");

    assert.match(multiRoleSource, /clearAllHighlights\(\);/);
    assert.match(multiRoleSource, /pruneBrokenLinks\(cell\);/);
    assert.match(multiRoleSource, /highlight\(cell, selIsPrimary \? YELLOW : RED\);/);
    assert.match(multiRoleSource, /if \(linkedIds\.size === 0\) continue;/);
    assert.match(multiRoleSource, /visibleLinkOverlayRecords\.push\(\{ source: cell, other, exitHint, edgeColor, label, labelOffset: \{ x: 0, y: 0 \} \}\);/);
    assert.match(multiRoleSource, /linkOverlays\.setLinkOverlay\(record\.source, record\.other, record\.exitHint, record\.edgeColor, record\.label, record\.labelOffset\);/);
    assert.doesNotMatch(multiRoleSource, /taskScheduleOverlay\.show/);
    assert.doesNotMatch(multiRoleSource, /taskScheduleOverlay\.showScheduleOnly/);
});

test("linked task navigation delegates hidden-card paging to the task manager", () => {
    const source = readSource();
    const revealSource = sourceBetween(source, "function revealKanbanCardForNavigation", "// Works for arbitrarily nested children");

    assert.match(revealSource, /const pagingApi = graph\.__trellisTaskPagingApi;/);
    assert.match(revealSource, /pagingApi\.revealCard\(card\)/);
    assert.doesNotMatch(revealSource, /setCellAttrUndoable\(lane, 'page_index'/);
    assert.doesNotMatch(source, /function getLanePageSizeForReveal/);
});

test("plant-tiler sibling task highlights use blue without changing direct non-task red", () => {
    const source = readSource();
    const cardSiblingSource = sourceBetween(source, "function collectSameBoardLinkedKanbanCards", "function collectLinkedTaskCardSiblingIdsForTiler");
    const tilerSiblingSource = sourceBetween(source, "function collectLinkedTaskCardSiblingIdsForTiler", "function collectLinkedKanbanCardsForSource");
    const directHighlightSource = sourceBetween(source, "const sameBoardLinkedCards = collectSameBoardLinkedKanbanCards", "// If link touches a Kanban task card");

    assert.match(source, /const RED = '#ff0000';/);
    assert.match(source, /const SAME_CROP_HIGHLIGHT = '#2563eb';/);
    assert.match(cardSiblingSource, /if \(!isTilerGroup\(source\)\) continue;/);
    assert.match(tilerSiblingSource, /if \(!isTilerGroup\(selectedTiler\)\) return new Set\(\);/);
    assert.match(tilerSiblingSource, /if \(!isKanbanCard\(target\)\) continue;/);
    assert.match(tilerSiblingSource, /if \(!findKanbanBoardAncestor\(target\)\) continue;/);
    assert.match(tilerSiblingSource, /if \(cards\.length < 2\) return new Set\(\);/);
    assert.match(directHighlightSource, /const selectedTilerTaskSiblingIds = collectLinkedTaskCardSiblingIdsForTiler\(cell, targets\);/);
    assert.match(directHighlightSource, /const linkedTargetHighlight = selectedTilerTaskSiblingIds\.has\(other\.id\) \? SAME_CROP_HIGHLIGHT : RED;/);
    assert.match(directHighlightSource, /highlight\(other, otherIsPrimary \? YELLOW : linkedTargetHighlight\);/);
    assert.match(source, /for \(const otherCard of sameBoardLinkedCards\)[\s\S]*highlight\(otherCard, otherIsPrimary \? YELLOW : SAME_CROP_HIGHLIGHT, 1\.5\);/);
});

test("standard link overlays use the native draw.io overlay pane", () => {
    const source = readSource();
    const linkOverlaySource = sourceBetween(source, "const linkOverlays = (function () {", "function formatLinkOverlayBadgeLabel");

    assert.match(linkOverlaySource, /function getOverlayPane\(\) \{[\s\S]*const view = graph\.getView && graph\.getView\(\);[\s\S]*return view && view\.getOverlayPane \? view\.getOverlayPane\(\) : null;/);
    assert.doesNotMatch(linkOverlaySource, /ensureGraphOverlaySvgLayer\('connection'\)/);
});

test("standard link overlays navigate on plain left click without a vertex shift fallback", () => {
    const source = readSource();
    const labelClickSource = sourceBetween(source, "txt.node.__manualLinkMeta = {", "entry.labelElt = txt;");
    const lineClickSource = sourceBetween(source, "poly.node.__manualLinkMeta = {", "entry.poly = poly;");

    assert.match(labelClickSource, /mxEvent\.addListener\(txt\.node, 'mousedown', function \(evt\) \{[\s\S]*const isLeft = \(evt\.button === 0\);[\s\S]*if \(isLeft\) \{[\s\S]*navigateOverlayLink\(/);
    assert.match(lineClickSource, /mxEvent\.addListener\(poly\.node, 'mousedown', function \(evt\) \{[\s\S]*const isLeft = \(evt\.button === 0\);[\s\S]*if \(isLeft\) \{[\s\S]*navigateOverlayLink\(/);
    assert.doesNotMatch(labelClickSource, /isShift|isShiftDown/);
    assert.doesNotMatch(lineClickSource, /isShift|isShiftDown/);
    assert.doesNotMatch(source, /tryNavigateSingleLinkedSelection|getValidLinkedVertices/);
    assert.doesNotMatch(source, /Shift\+Click cycles between linked vertices/);
});

test("task overlay guide lines keep the custom connection layer", () => {
    const source = readSource();
    const taskOverlaySource = sourceBetween(source, "const taskScheduleOverlay = (function () {", "function getPanelHost");

    assert.match(taskOverlaySource, /ensureGraphOverlaySvgLayer\('connection'\)/);
});

test("selected linked vertices draw direct connections even when task overlay is active", () => {
    const source = readSource();
    const drawDecisionSource = sourceBetween(source, "// Decide visibility using internal lane-based policy", "for (const otherCard of sameBoardLinkedCards)");

    assert.match(drawDecisionSource, /const shouldShow = shouldShowEdgeInternal\(cell, other\);/);
    assert.match(drawDecisionSource, /if \(shouldShow\) \{/);
    assert.match(drawDecisionSource, /linkOverlays\.setLinkOverlay\(/);
    assert.doesNotMatch(drawDecisionSource, /!taskOverlayActive/);
});

test("standard link endpoints use a five pixel center offset", () => {
    const source = readSource();
    const helperSource = sourceBetween(source, "function avoidStandardLinkEndpointCenterT", "function anchorStandardLinkEndpointOnSide");
    const computePointsSource = sourceBetween(source, "function computePointsFor(entry)", "// Create or update text label");

    assert.match(source, /const LINK_ENDPOINT_CENTER_OFFSET_PX = 5;/);
    assert.match(helperSource, /LINK_ENDPOINT_CENTER_OFFSET_PX/);
    assert.match(helperSource, /Math\.abs\(clampedT - 0\.5\)/);
    assert.match(computePointsSource, /anchorStandardLinkEndpointOnSide\(srcC, hint\.side, hint\.t, 4\)/);
    assert.match(computePointsSource, /anchorStandardLinkEndpointOnSide\(dstC, trgSide, 0\.5, 4\)/);
    assert.doesNotMatch(computePointsSource, /anchorOnSide\(dstC, trgSide, 0\.5\)/);
});

test("standard link labels stagger visible same-side labels by fifteen pixels", () => {
    const source = readSource();
    const labelSource = sourceBetween(source, "function createOrUpdateLabel(entry, pts)", "function createOrUpdatePolyline(entry)");
    const setOverlaySource = sourceBetween(source, "function setLinkOverlay(a, b, exitHint, color, label, labelOffset)", "function clearAll()");
    const staggerSource = sourceBetween(source, "function assignStandardLinkLabelOffsets(records)", "// Config: whether a Primary vertex should be highlighted even without links");
    const drawSource = sourceBetween(source, "const exitMap = computeExitParamsForOrigin(cell, targets);", "for (const otherCard of sameBoardLinkedCards)");

    assert.match(source, /const LINK_LABEL_STAGGER_PX = 15;/);
    assert.match(staggerSource, /const groups = \{ left: \[\], right: \[\], top: \[\], bottom: \[\] \};/);
    assert.match(staggerSource, /const offsetPx = i \* LINK_LABEL_STAGGER_PX;/);
    assert.match(staggerSource, /\? \{ x: 0, y: offsetPx \}/);
    assert.match(staggerSource, /: \{ x: offsetPx, y: 0 \};/);
    assert.match(drawSource, /const visibleLinkOverlayRecords = \[\];/);
    assert.match(drawSource, /visibleLinkOverlayRecords\.push\(\{ other, exitHint, edgeColor, label, labelOffset: \{ x: 0, y: 0 \} \}\);/);
    assert.match(drawSource, /assignStandardLinkLabelOffsets\(visibleLinkOverlayRecords\);/);
    assert.match(drawSource, /cell, record\.other, record\.exitHint, record\.edgeColor, record\.label, record\.labelOffset/);
    assert.match(setOverlaySource, /labelOffset: normalizeLabelOffset\(labelOffset\)/);
    assert.match(setOverlaySource, /entry\.labelOffset = normalizeLabelOffset\(labelOffset\);/);
    assert.match(labelSource, /const labelOffset = normalizeLabelOffset\(entry\.labelOffset\);/);
    assert.match(labelSource, /entry\.labelElt\.bounds\.x = labelX;/);
    assert.match(labelSource, /entry\.labelElt\.bounds\.y = labelY;/);
    assert.match(labelSource, /new mxRectangle\(labelX, labelY, 1, 1\)/);
});

test("task overlay guide lines keep centered anchors", () => {
    const source = readSource();
    const taskLineSource = sourceBetween(source, "function createOrUpdateLine(entry, cardId, row)", "function refreshLines(entry)");

    assert.match(taskLineSource, /anchorOnSide\(itemC, sideToward\(itemC, dstC\), 0\.5\)/);
    assert.match(taskLineSource, /anchorOnSide\(dstC, sideToward\(dstC, itemC\), 0\.5\)/);
    assert.doesNotMatch(taskLineSource, /anchorStandardLinkEndpointOnSide/);
});
