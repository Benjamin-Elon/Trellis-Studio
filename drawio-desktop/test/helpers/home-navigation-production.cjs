/** Exercise the real desktop save bridge and document lifecycle in the owning smoke's isolated profile. */ // NEW
const assert = require('node:assert/strict'); // NEW
const fs = require('node:fs'); // NEW
const path = require('node:path'); // NEW

module.exports = async function homeNavigationSmoke({ app, dialog, BrowserWindow, primary, profile, until }) { // NEW
    const expression = (target, code) => target.webContents.executeJavaScript(code); // NEW
    const current = target => expression(target, '!!smokeUi.getCurrentFile()'); // NEW
    const destination = path.join(profile, 'documents', 'Home navigation.drawio'); // NEW
    const nativeSave = dialog.showSaveDialog; let saveDialogs = 0, cancel = true; // NEW
    dialog.showSaveDialog = async () => { saveDialogs++; return { canceled: cancel, filePath: cancel ? undefined : destination }; }; // NEW: deterministic native boundary, with production IPC and filesystem writes intact.
    async function loadDocument(target, label, pages = 1) { // NEW
        await expression(target, `(async () => { // NEW
            const ui = smokeUi, xml = '<mxfile>' + Array.from({ length: ${pages} }, (_, index) => '<diagram id="home-page-' + index + '" name="Page ' + (index + 1) + '"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram>').join('') + '</mxfile>'; // NEW
            const file = new LocalFile(ui, xml, ${JSON.stringify(label + '.drawio')}); file.isAutosave = () => false; await ui.fileLoaded(file); // NEW
            ui.editor.graph.insertVertex(null, 'home-test-cell', ${JSON.stringify(label)}, 20, 20, 80, 30); file.setModified(true); // NEW
        })()`); // NEW
    } // NEW
    try { // NEW
        const startup = await expression(primary, `(() => { // NEW
            const ui = smokeUi, dialog = ui.dialog; ui.hideDialog(true, true); // NEW
            dialog.bg.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); dialog.bg.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); // NEW
            return { empty: !ui.getCurrentFile(), stayed: ui.dialog === dialog, exitControls: [...dialog.container.children].filter(node => node.classList.contains('geButton')).length }; // NEW
        })()`); // NEW
        assert.deepEqual(startup, { empty: true, stayed: true, exitControls: 0 }); // NEW
        const existing = new Set(BrowserWindow.getAllWindows()); app.emit('second-instance', {}, ['trellis-home-navigation-smoke'], profile); // NEW: create a second window through the production application handler.
        const second = await until(() => BrowserWindow.getAllWindows().find(candidate => !existing.has(candidate)), 'second Home test window'); // NEW
        await until(() => expression(second, '!!window.Draw?.loadPlugin && !!window.TrellisGardenHome').catch(() => false), 'second window Home scripts'); // NEW
        await expression(second, 'new Promise(resolve => Draw.loadPlugin(ui => { window.smokeUi = ui; resolve(); }))'); // NEW
        await loadDocument(second, 'Other window stays open'); // NEW
        await loadDocument(primary, 'Saved before returning Home', 2); // NEW
        const canceled = await expression(primary, `(async () => { const file = smokeUi.getCurrentFile(); await smokeUi.showSplash(true); return { same: smokeUi.getCurrentFile() === file, modified: file.isModified(), pending: !!smokeUi.__trellisGardenHome.homeTransition, splash: !!document.querySelector('.trellis-splash-root') }; })()`); // NEW
        assert.deepEqual(canceled, { same: true, modified: true, pending: false, splash: false }); assert.equal(saveDialogs, 1); assert.equal(await current(second), true); // NEW
        cancel = false; // NEW
        const saved = await expression(primary, `(async () => { await smokeUi.showSplash(true); const ui = smokeUi, graph = ui.editor.graph, dialog = ui.dialog; ui.hideDialog(true, true); return { empty: !ui.getCurrentFile(), pages: ui.pages?.length || 0, graphCleared: !graph.model.getCell('home-test-cell'), undoCleared: !ui.editor.undoManager.canUndo(), splash: !!document.querySelector('.trellis-splash-root'), stayed: ui.dialog === dialog }; })()`); // NEW
        assert.deepEqual(saved, { empty: true, pages: 0, graphCleared: true, undoCleared: true, splash: true, stayed: true }); assert.equal(saveDialogs, 2); // NEW
        const data = fs.readFileSync(destination, 'utf8'); assert.match(data, /<diagram /); // NEW
        const reopened = await expression(primary, `(async () => { await TrellisGardenHome.openPath(smokeUi, ${JSON.stringify(destination)}); const cell = smokeUi.editor.graph.model.getCell('home-test-cell'); return { pages: smokeUi.pages.length, label: typeof cell.value === 'string' ? cell.value : cell.getAttribute('label') }; })()`); // CHANGE: Trellis plugins normalize saved labels into object XML.
        assert.deepEqual(reopened, { pages: 2, label: 'Saved before returning Home' }); // NEW
        await expression(primary, 'smokeUi.getCurrentFile().setModified(false); smokeUi.showSplash(true)'); assert.equal(saveDialogs, 2); // NEW
        await loadDocument(primary, 'Untouched blank'); // NEW
        await expression(primary, `(async () => { smokeUi.editor.graph.removeCells([smokeUi.editor.graph.model.getCell('home-test-cell')]); smokeUi.getCurrentFile().setModified(false); await smokeUi.showSplash(true); })()`); // NEW
        assert.equal(await current(primary), false); assert.equal(saveDialogs, 2); // NEW
        assert.equal(await expression(second, '(() => { const cell = smokeUi.editor.graph.model.getCell("home-test-cell"); return typeof cell.value === "string" ? cell.value : cell.getAttribute("label"); })()'), 'Other window stays open'); // CHANGE
        await expression(second, 'smokeUi.getCurrentFile().setModified(false)'); // NEW
        return { ok: true, startupStaysOpen: true, nativeSaveCancellation: true, saveRetry: true, multipageSaved: true, lifecycleCleanup: true, blankSkipsSave: true, secondWindowPreserved: true }; // NEW
    } finally { dialog.showSaveDialog = nativeSave; } // NEW
}; // NEW
