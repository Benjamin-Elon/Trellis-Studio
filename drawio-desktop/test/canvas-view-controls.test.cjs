const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW
const test = require('node:test'); // NEW
const { loadPlantTilerMxGraph } = require('./helpers/plant-tiler-mxgraph-harness.cjs'); // NEW
const plugins = path.join(__dirname, '../drawio/src/main/webapp/plugins/garden_planner_plugins'); // NEW

/** Run complete production controllers against the native model, SVG renderer and browser storage. */ // NEW
function fixture(saved = {}, order = ['Vertex_Linking_Standalone.js', 'Garden_Dashboard.js']) { // NEW
    const h = loadPlantTilerMxGraph(), { window, graph, ui } = h, document = window.document; // NEW
    let user = 'alice', diagram = 'document-a', page = 'page-a'; // NEW
    Object.entries(saved).forEach(([key, value]) => window.localStorage.setItem(key, value)); // NEW
    window.Trellis = { users: { getCurrentUser: () => user ? { id: user } : null, getDiagramKey: () => diagram, isEnabled: () => false } }; // NEW
    ui.currentPage = { root: graph.model.getRoot(), getId: () => page }; ui.pages = [ui.currentPage]; // NEW
    ui.getCurrentFile = () => ({ getId: () => diagram }); // NEW
    ui.toolbar = { container: document.createElement('div') }; ui.toolbar.container.className = 'geToolbar'; // NEW
    const view = document.createElement('button'), zoom = document.createElement('input'); zoom.className = 'geZoomInput'; zoom.value = '100%'; // NEW
    ui.toolbar.container.append(view, zoom); document.body.prepend(ui.toolbar.container); // NEW
    h.value = attrs => { const value = window.mxUtils.createXmlDocument().createElement('object'); Object.entries(attrs).forEach(([key, text]) => value.setAttribute(key, text)); return value; }; // NEW
    h.left = graph.insertVertex(h.moduleCell, 'left', h.value({ label: 'Left', linkedTo: 'right' }), 10, 10, 60, 30); // NEW
    h.right = graph.insertVertex(h.moduleCell, 'right', h.value({ label: 'Right', linkedTo: 'left' }), 200, 10, 60, 30); // NEW
    h.growth = graph.__trellisPlantingGroup.growth; h.load = file => window.eval(fs.readFileSync(path.join(plugins, file), 'utf8')); // NEW
    order.forEach(h.load); // NEW
    h.harvest = () => document.querySelector('[data-trellis-harvest-size]'); h.links = () => document.querySelector('[data-trellis-show-links]'); // NEW
    h.linkNodes = () => Array.from(graph.view.getOverlayPane().querySelectorAll('*')).filter(node => node.__manualLinkMeta); // NEW
    h.serialize = () => window.mxUtils.getXml(new window.mxCodec().encode(graph.model)); // NEW
    h.snapshot = () => Object.fromEntries(Array.from({ length: window.localStorage.length }, (_, i) => { const key = window.localStorage.key(i); return [key, window.localStorage.getItem(key)]; })); // NEW
    h.switchUser = value => { user = value; window.dispatchEvent(new window.CustomEvent('trellisUsersSessionChanged')); }; // NEW
    h.context = (nextDiagram, nextPage) => { diagram = nextDiagram; page = nextPage; }; // NEW
    h.settle = () => new Promise(resolve => window.setTimeout(resolve, 30)); // NEW
    return h; // NEW
} // NEW

test('controls live after zoom, follow active gardens in every workspace and survive toolbar swaps once', async () => { // NEW
    const h = fixture(), { graph, window, ui } = h; // NEW
    try { // NEW
        await h.settle(); const harvest = h.harvest(), links = h.links(), wrap = harvest.closest('[data-trellis-canvas-view-controls]'); // NEW
        assert.equal(ui.toolbar.container.querySelector('.geZoomInput').nextSibling, wrap); // NEW
        assert.equal(window.document.querySelector('.trellis-garden-dashboard-toolbar [data-trellis-harvest-size]'), null); // NEW
        assert.equal(harvest.disabled, false); assert.equal(harvest.checked, false); assert.equal(links.checked, true); // NEW
        for (const [attribute, link] of [['task_module', 'trellis_garden_module_id'], ['team_module', 'linkedTo'], ['roadmap_module', 'roadmap_garden_module_id']]) { // NEW
            const workspace = graph.insertVertex(null, attribute, h.value({ [attribute]: '1', [link]: h.moduleCell.id }), 0, 0, 100, 100, 'module=1;'); // NEW
            graph.setSelectionCell(workspace); await h.settle(); assert.equal(harvest.disabled, false, attribute); // NEW
        } // NEW
        const second = graph.insertVertex(null, 'garden-two', h.value({ garden_module: '1', label: 'Second garden' }), 0, 0, 100, 100, 'module=1;'); // NEW
        graph.setSelectionCell(h.moduleCell); await h.settle(); harvest.click(); assert.equal(h.growth.getShowHarvestSize(h.moduleCell), true); // NEW
        graph.setSelectionCell(second); await h.settle(); assert.equal(harvest.checked, false); assert.match(harvest.parentElement.title, /Second garden/); // NEW
        graph.clearSelection(); await h.settle(); assert.equal(harvest.disabled, true); assert.equal(links.disabled, false); // NEW
        graph.setSelectionCell(h.moduleCell); await h.settle(); assert.equal(harvest.checked, true); // NEW
        const nodes = Array.from(ui.toolbar.container.childNodes); ui.toolbar.container.replaceChildren(window.document.createElement('button')); await h.settle(); // NEW
        assert.equal(h.harvest(), null, 'text toolbar temporarily replaces canvas controls'); // NEW
        ui.toolbar.container.replaceChildren(...nodes); await h.settle(); assert.equal(h.harvest(), harvest); // NEW
        wrap.remove(); await h.settle(); assert.equal(h.harvest(), harvest, 'toolbar rebuild reuses the original controls'); // NEW
        let writes = 0; const setter = h.growth.setShowHarvestSize; h.growth.setShowHarvestSize = (...args) => { writes++; setter(...args); }; // NEW
        harvest.click(); assert.equal(writes, 1); assert.equal(window.document.querySelectorAll('[data-trellis-harvest-size]').length, 1); // NEW
        graph.setEnabled(false); assert.equal(harvest.disabled, false); harvest.click(); assert.equal(writes, 2, 'personal view changes remain usable in read-only graphs'); // NEW
        delete graph.__trellisPlantingGroup.growth; window.dispatchEvent(new window.CustomEvent('trellisPlantGrowthReady')); await h.settle(); assert.equal(harvest.disabled, true); // NEW
        graph.__trellisPlantingGroup.growth = h.growth; window.dispatchEvent(new window.CustomEvent('trellisPlantGrowthReady')); await h.settle(); assert.equal(harvest.disabled, false); // NEW
    } finally { h.close(); } // NEW
}); // NEW

test('link hiding removes lines, labels and hit targets through redraws while retaining highlights and roadmap arrows', async () => { // NEW
    const h = fixture(), { graph, window } = h; // NEW
    try { // NEW
        await h.settle(); graph.setSelectionCell(h.left); await h.settle(); assert.equal(h.linkNodes().length, 2); // NEW
        const roadmap = window.document.createElement('div'); roadmap.className = 'trellis-roadmap-dependency-layer'; graph.container.appendChild(roadmap); // NEW
        h.undoManager.clear(); const before = h.serialize(), highlight = graph.view.getState(h.right).shape.node.outerHTML; // NEW
        h.links().click(); assert.equal(h.linkNodes().length, 0); assert.equal(h.serialize(), before); assert.equal(h.undoManager.history.length, 0); // NEW
        assert.equal(graph.view.getState(h.right).shape.node.outerHTML, highlight); assert.equal(roadmap.isConnected, true); // NEW
        graph.setSelectionCell(h.right); graph.view.setScale(0.75); graph.view.setTranslate(10, 20); // NEW
        graph.model.setGeometry(h.left, Object.assign(graph.model.getGeometry(h.left).clone(), { x: 80 })); // NEW
        window.dispatchEvent(new window.CustomEvent('trellisHistoryAfterRestore')); await h.settle(); assert.equal(h.linkNodes().length, 0); // NEW
        h.undoManager.undo(); await h.settle(); assert.equal(h.linkNodes().length, 0); // NEW
        const current = h.serialize(), historyLength = h.undoManager.history.length; h.links().click(); // NEW
        assert.equal(h.linkNodes().length, 2); assert.equal(h.serialize(), current); assert.equal(h.undoManager.history.length, historyLength); // NEW
        assert.ok(h.linkNodes().every(node => node.__manualLinkMeta.srcId === h.right.id)); // NEW
        h.context('another-document', 'another-page'); assert.equal(graph.__trellisPlantingLinking.getShowLinks(), true); // NEW
    } finally { h.close(); } // NEW
}); // NEW

test('the production details toolbar restores the same controls and their current user values', async () => { // NEW
    const h = fixture(), { window, ui } = h; // NEW
    try { // NEW
        await h.settle(); h.harvest().click(); h.links().click(); const harvest = h.harvest(), links = h.links(); // NEW
        h.load('Trellis_Details_Toolbar.js'); // NEW
        ui.toolbar.createTextToolbar = () => ui.toolbar.container.append(window.document.createElement('button')); // NEW
        ui.toolbar.setFontName = ui.toolbar.setFontSize = () => {}; // NEW
        const adapter = window.TrellisDetailsToolbar.install(ui), field = window.document.createElement('div'); window.document.body.append(field); // NEW
        adapter.activate({ element: field, saveSelection() {}, computedStyle: () => ({ fontFamily: 'Arial', fontSize: '12px' }) }); // NEW
        await h.settle(); assert.equal(h.harvest(), null); // NEW
        h.switchUser('bob'); await h.settle(); adapter.deactivate(); await h.settle(); // NEW
        assert.equal(h.harvest(), harvest); assert.equal(h.links(), links); assert.equal(harvest.checked, false); assert.equal(links.checked, true); // NEW
        adapter.destroy(); // NEW
        h.graph.destroy(); await h.settle(); h.switchUser('alice'); await h.settle(); assert.equal(h.harvest(), null); // NEW
    } finally { h.close(); } // NEW
}); // NEW

test('both preferences survive restart and stay isolated by user; harvest also isolates diagram, page and garden', async () => { // NEW
    let h = fixture(), saved; // NEW
    try { // NEW
        await h.settle(); h.harvest().click(); h.links().click(); // NEW
        const inactive = h.graph.insertVertex(null, 'inactive', h.value({ garden_module: '1', label: 'Inactive garden' }), 0, 0, 100, 100, 'module=1;'); // NEW
        h.growth.setShowHarvestSize(inactive, true); saved = h.snapshot(); // NEW
        h.switchUser('bob'); await h.settle(); assert.equal(h.harvest().checked, false); assert.equal(h.links().checked, true); // NEW
        h.switchUser(null); await h.settle(); assert.equal(h.harvest().checked, false); assert.equal(h.links().checked, true); // NEW
        h.harvest().click(); h.links().click(); h.switchUser('bob'); await h.settle(); assert.equal(h.harvest().checked, false); assert.equal(h.links().checked, true); // NEW
        h.switchUser('alice'); await h.settle(); assert.equal(h.harvest().checked, true); assert.equal(h.links().checked, false); // NEW
        h.context('document-a', 'page-b'); assert.equal(h.growth.getShowHarvestSize(h.moduleCell), false); // NEW
        h.context('document-b', 'page-a'); assert.equal(h.growth.getShowHarvestSize(h.moduleCell), false); // NEW
        h.context('document-a', 'page-a'); assert.equal(h.growth.getShowHarvestSize(h.moduleCell), true); // NEW
    } finally { h.close(); } // NEW
    h = fixture(saved, ['Garden_Dashboard.js', 'Vertex_Linking_Standalone.js']); // NEW
    try { // NEW
        await h.settle(); assert.equal(h.harvest().checked, true); assert.equal(h.links().checked, false); // NEW
        graphOutlineCheck(h); // NEW
    } finally { h.close(); } // NEW
}); // NEW

/** Render a saved outline in a garden that was never selected in the reopened editor. */ // NEW
function graphOutlineCheck(h) { // NEW
    const inactive = h.graph.insertVertex(null, 'inactive', h.value({ garden_module: '1', label: 'Inactive garden' }), 0, 0, 100, 100, 'module=1;'); // NEW
    const group = h.graph.insertVertex(inactive, 'planting', h.value({ tiler_group: '1', spacing_cm: '40', veg_diameter_cm: '40' }), 300, 300, 100, 100); // NEW
    h.tiler.retileGroup(h.graph, group); h.growth.refresh(); // NEW
    const tile = h.graph.getChildVertices(group)[0]; // NEW
    assert.ok(h.graph.view.getState(tile).shape.node.querySelector('ellipse[stroke="#2563eb"]')); // NEW
    h.switchUser('bob'); h.growth.refresh(); assert.equal(h.graph.view.getState(tile).shape.node.querySelector('ellipse[stroke="#2563eb"]'), null); // NEW
} // NEW

test('corrupt or blocked storage defaults safely and preserves session choices without diagram metadata', async () => { // NEW
    const h = fixture(); // NEW
    try { // NEW
        await h.settle(); // NEW
        h.window.localStorage.setItem('trellis.showLinks.v1:' + JSON.stringify('user:corrupt'), '{broken'); // NEW
        h.window.localStorage.setItem('trellis.harvestSize.v1:' + JSON.stringify(['user:corrupt', 'document-a', 'page-a', 'garden']), '{broken'); h.switchUser('corrupt'); // NEW
        assert.equal(h.graph.__trellisPlantingLinking.getShowLinks(), true); // NEW
        assert.equal(h.growth.getShowHarvestSize(h.moduleCell), false); // NEW
        h.switchUser('blocked'); Object.defineProperty(h.window, 'localStorage', { configurable: true, get() { throw new Error('Storage blocked'); } }); // NEW
        assert.equal(h.growth.getShowHarvestSize(h.moduleCell), false); assert.equal(h.graph.__trellisPlantingLinking.getShowLinks(), true); // NEW
        const before = h.serialize(); h.undoManager.clear(); h.growth.setShowHarvestSize(h.moduleCell, true); h.graph.__trellisPlantingLinking.setShowLinks(false); // NEW
        assert.equal(h.growth.getShowHarvestSize(h.moduleCell), true); assert.equal(h.graph.__trellisPlantingLinking.getShowLinks(), false); // NEW
        assert.equal(h.serialize(), before); assert.equal(h.undoManager.history.length, 0); // NEW
        h.context('', 'page-a'); h.growth.setShowHarvestSize(h.moduleCell, true); h.switchUser('other'); assert.equal(h.growth.getShowHarvestSize(h.moduleCell), false); // NEW
        h.switchUser('blocked'); assert.equal(h.growth.getShowHarvestSize(h.moduleCell), true); // NEW
    } finally { h.close(); } // NEW
}); // NEW

test('storage updates from another editor refresh both preferences without diagram edits', async () => { // NEW
    const h = fixture(); // NEW
    try { // NEW
        await h.settle(); h.graph.setSelectionCell(h.left); await h.settle(); h.harvest().click(); h.links().click(); // NEW
        const keys = Object.keys(h.snapshot()), harvestKey = keys.find(key => key.startsWith('trellis.harvestSize.v1:')), linksKey = keys.find(key => key.startsWith('trellis.showLinks.v1:')); // NEW
        const before = h.serialize(); h.undoManager.clear(); // NEW
        for (const [key, value] of [[harvestKey, 'false'], [linksKey, 'true']]) { // NEW
            h.window.localStorage.setItem(key, value); h.window.dispatchEvent(new h.window.StorageEvent('storage', { key, newValue: value })); // NEW
        } // NEW
        await h.settle(); assert.equal(h.harvest().checked, false); assert.equal(h.links().checked, true); assert.equal(h.linkNodes().length, 2); // NEW
        assert.equal(h.serialize(), before); assert.equal(h.undoManager.history.length, 0); // NEW
    } finally { h.close(); } // NEW
}); // NEW

test('unidentified diagrams keep harvest choices per object and user without requesting metadata creation', () => { // NEW
    const h = fixture({}, []); // NEW
    try { // NEW
        h.window.Trellis.users.getDiagramKey = options => { assert.equal(options.create, false); return ''; }; // NEW
        const before = h.serialize(), other = new h.window.mxCell(); other.id = h.moduleCell.id; // NEW
        h.growth.setShowHarvestSize(h.moduleCell, true); assert.equal(h.growth.getShowHarvestSize(h.moduleCell), true); assert.equal(h.growth.getShowHarvestSize(other), false); // NEW
        h.switchUser('bob'); assert.equal(h.growth.getShowHarvestSize(h.moduleCell), false); h.switchUser('alice'); assert.equal(h.growth.getShowHarvestSize(h.moduleCell), true); // NEW
        assert.equal(Object.keys(h.snapshot()).length, 0); assert.equal(h.serialize(), before); // NEW
    } finally { h.close(); } // NEW
}); // NEW
