const { read } = require('./garden-structures-harness.cjs'); // NEW

/** Run the production view-options functions with a minimal toolbar instead of the unrelated dashboard shell. */ // NEW
function canvasViewControlsSource() { // NEW
    const source = read('plugins/garden_planner_plugins/Garden_Dashboard.js'); // NEW
    const start = source.indexOf('    function closeCanvasViewOptions('), end = source.indexOf('    function ensureViewportToolbar()', start); // NEW
    if (start < 0 || end < 0) throw new Error('Missing canvas view controls.'); // NEW
    const listenersStart = source.indexOf("    for (const event of ['trellisStructuresReady'"), listenersEnd = source.indexOf('    const destroyDashboardGraph', listenersStart); // NEW
    if (listenersStart < 0 || listenersEnd < 0) throw new Error('Missing canvas view lifecycle.'); // NEW
    return `(function () { // NEW
        const ui = window.ui, graph = ui.editor.graph; // NEW
        let canvasViewControls = null, canvasToolbarObserver = null, dashboardDisposed = false, activeToolbarModule = window.garden || null; // NEW
        const gardenLabel = cell => cell.getAttribute('label') || 'Garden'; // NEW
        ${source.slice(start, end)}
        const scheduleViewportToolbarRefresh = () => refreshCanvasViewControls(); // NEW
        ${source.slice(listenersStart, listenersEnd)}
        window.canvasControlsTest = { refresh: refreshCanvasViewControls, close: closeCanvasViewOptions, // NEW
            setGarden(cell) { activeToolbarModule = cell; refreshCanvasViewControls(); }, // NEW
            dispose() { dashboardDisposed = true; canvasToolbarObserver?.disconnect(); graph.removeListener(scheduleViewportToolbarRefresh); ui.editor?.removeListener?.(closeCanvasOptionsForNavigation); canvasViewControls?.dispose(); } }; // NEW
        refreshCanvasViewControls(); // NEW
    })();`; // NEW
} // NEW
module.exports = { canvasViewControlsSource }; // NEW
