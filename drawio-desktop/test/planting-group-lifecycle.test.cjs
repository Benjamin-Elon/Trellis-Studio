const assert = require('node:assert/strict'); // CHANGE
const fs = require('node:fs'); // CHANGE
const path = require('node:path'); // CHANGE
const test = require('node:test'); // CHANGE
const { loadPlantTilerMxGraph } = require('./helpers/plant-tiler-mxgraph-harness.cjs'); // CHANGE

/** Build saved-diagram cells using their existing XML markers; no data migration is involved. */ // CHANGE
function cellValue(window, attrs) { // CHANGE
    const node = window.mxUtils.createXmlDocument().createElement('object'); // CHANGE
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value)); // CHANGE
    return node; // CHANGE
} // CHANGE

test('planting-group initialization and legacy API aliases install one controller', () => { // CHANGE
    const h = loadPlantTilerMxGraph(); // CHANGE
    try { // CHANGE
        const owner = h.graph.__trellisPlantingGroup, listeners = h.graph.getSelectionModel().eventListeners.length; // CHANGE
        const source = fs.readFileSync(path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins/Planting_Group.js'), 'utf8'); // CHANGE
        h.window.eval(source); // CHANGE
        assert.equal(h.graph.__trellisPlantingGroup, owner); // CHANGE
        assert.equal(h.graph.getSelectionModel().eventListeners.length, listeners); // CHANGE
        assert.equal(h.window.USL.tiler, h.window.USL.plantingGroup); // CHANGE
        assert.equal(owner.spacingEditor, h.graph.__trellisPlantingSpacingEditor); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('owner upgrades a selected planting to linked Cards when the linking adapter becomes available', () => { // CHANGE
    const h = loadPlantTilerMxGraph(), { graph, window } = h; // CHANGE
    try { // CHANGE
        const source = graph.insertVertex(h.moduleCell, 'planting', cellValue(window, { tiler_group: '1', plant_name: 'Radish', label: 'Radish' }), 250, 250, 120, 90); // CHANGE
        graph.setSelectionCell(source); // CHANGE
        const overlay = graph.__trellisPlantingGroup.overlay; // CHANGE
        assert.equal(overlay.registry.get(source.id).scheduleOnly, true); // CHANGE
        const board = graph.insertVertex(null, 'board', cellValue(window, { board_key: 'KANBAN_BOARD' }), 500, 500, 500, 500); // CHANGE
        const lane = graph.insertVertex(board, 'lane', cellValue(window, { lane_key: 'TODO', label: 'To do' }), 0, 0, 400, 400); // CHANGE
        const card = graph.insertVertex(lane, 'task', cellValue(window, { kanban_card: '1', title: 'Sow Radish', start: '2027-05-09', end: '2027-05-09' }), 0, 0, 160, 80); // CHANGE
        graph.__trellisPlantingLinking = { normalizeSelection: cell => cell, getContext: cell => ({ source: cell, cards: [card], linkLabels: new Map() }), navigate: cell => graph.setSelectionCell(cell) }; // CHANGE
        graph.fireEvent(new window.mxEventObject('trellisPlantingLinkingReady')); // CHANGE
        assert.deepEqual(Array.from(overlay.registry.get(source.id).targetIds), ['task']); // CHANGE
        assert.match(window.document.body.textContent, /Sow Radish/); // CHANGE
        overlay.setMode('schedule'); assert.match(window.document.body.textContent, /Schedule/); // CHANGE
        let active = true; window.Trellis = { users: { isTeamPermissionModeActive: () => active } }; // CHANGE
        window.dispatchEvent(new window.CustomEvent('trellisTeamPermissionModeChanged')); // CHANGE
        assert.equal(overlay.registry.size, 0); // CHANGE
        active = false; window.dispatchEvent(new window.CustomEvent('trellisTeamPermissionModeChanged')); // CHANGE
        assert.equal(overlay.registry.size, 1); // CHANGE
        window.dispatchEvent(new window.CustomEvent('trellisHistoryBeforeRestore')); // CHANGE
        graph.setCellStyles('fillColor', '#ffffff', [source]); // CHANGE
        assert.equal(overlay.registry.size, 0); // CHANGE: model edits during restore must not reopen panels.
        window.dispatchEvent(new window.CustomEvent('trellisHistoryAfterRestore')); // CHANGE
        assert.equal(overlay.registry.size, 1); // CHANGE
        graph.removeCells([source]); assert.equal(overlay.registry.size, 0); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE

test('migrated overlay preserves linked task panels for ordinary non-planting sources', () => { // CHANGE
    const h = loadPlantTilerMxGraph(), { graph, window } = h; // CHANGE
    try { // CHANGE
        const board = graph.insertVertex(null, 'board', cellValue(window, { board_key: 'KANBAN_BOARD' }), 500, 500, 500, 500); // CHANGE
        const lane = graph.insertVertex(board, 'lane', cellValue(window, { lane_key: 'TODO', label: 'To do' }), 0, 0, 400, 400); // CHANGE
        const card = graph.insertVertex(lane, 'task', cellValue(window, { kanban_card: '1', title: 'Inspect bed', start: '2027-05-09' }), 0, 0, 160, 80); // CHANGE
        const source = graph.insertVertex(h.moduleCell, 'ordinary', cellValue(window, { label: 'Bed note', linkedTo: 'task' }), 100, 100, 80, 50); // CHANGE
        card.value.setAttribute('linkedTo', source.id); // CHANGE
        const plugin = path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins/Vertex_Linking_Standalone.js'); // CHANGE
        window.eval(fs.readFileSync(plugin, 'utf8')); // CHANGE
        graph.setSelectionCell(source); // CHANGE
        const entry = graph.__trellisPlantingGroup.overlay.registry.get(source.id); // CHANGE
        assert.ok(entry); assert.deepEqual(Array.from(entry.targetIds), ['task']); // CHANGE
        assert.match(window.document.body.textContent, /Inspect bed/); // CHANGE
        graph.setSelectionCells([]); assert.equal(graph.__trellisPlantingGroup.overlay.registry.size, 0); // CHANGE
    } finally { h.close(); } // CHANGE
}); // CHANGE
