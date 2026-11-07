const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const { parse } = require('@babel/parser'); // NEW
/** Execute the production toolbar construction and lifecycle without unrelated garden metrics or startup navigation. */ // NEW
function exchangeDashboardSource() { // NEW
    const source = fs.readFileSync(path.join(__dirname, '../../drawio/src/main/webapp/plugins/garden_planner_plugins/Garden_Dashboard.js'), 'utf8'); // NEW
    const statements = parse(source).program.body[0].expression.arguments[0].body.body; // NEW
    const names = ['createToolbarButton', 'createYearButton', 'createWorkspaceSegment', 'attachTaskWorkspaceBadge', 'createWorkspaceSwitcher', 'createTaskBoardSelect', 'isToolbarNativeControl', 'stopToolbarNativeControlEvent', 'ensureViewportToolbar', 'hideViewportToolbar']; // NEW
    const functions = names.map(name => { const node = statements.find(node => node.type === 'FunctionDeclaration' && node.id.name === name); if (!node) throw new Error('Missing production toolbar function: ' + name); return source.slice(node.start, node.end); }); // NEW
    const destroyStart = source.indexOf('    const destroyDashboardGraph = graph.destroy;'), destroyEnd = source.indexOf('    window.addEventListener', destroyStart); // NEW
    if (destroyStart < 0 || destroyEnd < 0) throw new Error('Missing production dashboard disposal.'); // NEW
    return `(function () { // NEW
        const ui = window.ui, graph = ui.editor.graph, BTN_SIZE = 22, BTN_GAP = 6, GRAPH_OVERLAY_Z = { CONTROL: 10020 }; // NEW
        let viewportToolbar = null, activeToolbarModule = null, dashboardDisposed = false, toolbarRefreshTimer = null, canvasToolbarObserver = null, canvasViewControls = null; // NEW
        const ensureViewportToolbarHost = () => document.getElementById('dashboard-host') || document.body; // NEW
        function refreshSharingCount() {} function refreshCanvasViewControls() {} function scheduleViewportToolbarRefresh() {} // NEW
        function handleCanvasPreferenceStorage() {} function closeCanvasOptionsForNavigation() {} // NEW
        ${functions.join('\n')}
        ${source.slice(destroyStart, destroyEnd)}
        window.exchangeDashboard = { // NEW
            mount() { const toolbar = ensureViewportToolbar(); toolbar.wrap.style.display = 'block'; return toolbar; }, // NEW
            setGarden(garden) { activeToolbarModule = garden; }, hide: hideViewportToolbar, destroy: () => graph.destroy() // NEW
        }; // NEW
    })();`; // NEW
} // NEW
module.exports = { exchangeDashboardSource }; // NEW
