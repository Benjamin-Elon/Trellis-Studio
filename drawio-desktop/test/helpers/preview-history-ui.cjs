const fs = require('node:fs'); // CHANGE
const path = require('node:path'); // CHANGE

/** Exercise production history actions, text-edit dispatch and keyboard bindings without the full application shell. */ // CHANGE
function createPreviewHistoryUi(window, graph, undoManager) { // CHANGE
    const webapp = path.join(__dirname, '../../drawio/src/main/webapp'); // CHANGE
    const source = fs.readFileSync(path.join(webapp, 'js/grapheditor/EditorUi.js'), 'utf8').replace(/\r\n/g, '\n'); // CHANGE
    window.EditorUi = function () {}; // CHANGE
    for (const name of ['undo', 'redo', 'canUndo', 'canRedo', 'createKeyHandler']) { // CHANGE
        const method = source.match(new RegExp('EditorUi\\.prototype\\.' + name + ' = function\\([^)]*\\)\\s*\\{[\\s\\S]*?^\\};', 'm')); // CHANGE
        if (!method) throw new Error('Missing production EditorUi method ' + name); // CHANGE
        window.eval(method[0]); // CHANGE
    } // CHANGE
    const ui = new window.EditorUi(); ui.editor = { graph, undoManager }; ui.hideDialog = () => {}; // CHANGE
    const actionsSource = fs.readFileSync(path.join(webapp, 'js/grapheditor/Actions.js'), 'utf8'); // CHANGE
    window.eval(actionsSource); window.Editor = { ctrlKey: 'Ctrl', shiftKey: 'Shift' }; // CHANGE
    ui.actions = Object.create(window.Actions.prototype); ui.actions.actions = {}; // CHANGE
    const init = ['undo', 'redo'].map(name => actionsSource.match(new RegExp("this.addAction\\('" + name + "',[^\\r\\n]+"))[0]).join('\n'); // CHANGE
    window.Function('ui', 'Editor', init).call(ui.actions, ui, window.Editor); // CHANGE: the actual menu/toolbar action callbacks call the production editor methods.
    ui.updateActionStates = () => { ui.actions.get('undo').setEnabled(ui.canUndo()); ui.actions.get('redo').setEnabled(ui.canRedo()); }; // CHANGE
    undoManager.addListener(null, () => ui.updateActionStates()); // CHANGE: mirror the shell's history-event availability updates.
    ui.updateActionStates(); // CHANGE
    return ui; // CHANGE
} // CHANGE

module.exports = { createPreviewHistoryUi }; // CHANGE
