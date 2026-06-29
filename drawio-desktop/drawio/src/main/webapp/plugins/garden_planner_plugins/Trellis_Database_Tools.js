(function () {
    "use strict";

    const ACTION_ID = "trellisRestoreBuiltInDatabase"; // NEW
    const ACTION_LABEL = "Restore Built-in Trellis Database..."; // NEW

    function createEl(tag, className, text) { // NEW
        const el = document.createElement(tag); // NEW
        if (className) el.className = className; // NEW
        if (text != null) el.textContent = String(text); // NEW
        return el; // NEW
    } // NEW

    function clearNode(node) { // NEW
        while (node.firstChild) node.removeChild(node.firstChild); // NEW
    } // NEW

    function closeDialog(ui) { // NEW
        if (ui && typeof ui.hideDialog === "function") ui.hideDialog(); // NEW
    } // NEW

    function addStyles(root) { // NEW
        const style = createEl("style"); // NEW
        style.textContent = [
            ".trellis-db-tools{font-family:Arial,sans-serif;color:#1f2933;padding:16px;box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:12px}",
            ".trellis-db-tools-title{font-size:18px;font-weight:700}",
            ".trellis-db-tools-status{padding:10px 12px;background:#f5f7fa;border:1px solid #d7dde5;border-radius:4px;line-height:1.4}",
            ".trellis-db-tools-danger{background:#fff7ed;border-color:#f59e0b}",
            ".trellis-db-tools-error{background:#fef2f2;border-color:#ef4444}",
            ".trellis-db-tools-paths{font-size:12px;line-height:1.45;word-break:break-all}",
            ".trellis-db-tools-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:auto}",
            ".trellis-db-tools-btn{border:1px solid #9fb0c2;background:#fff;padding:7px 10px;border-radius:4px;cursor:pointer}",
            ".trellis-db-tools-btn-primary{background:#b91c1c;color:#fff;border-color:#b91c1c}",
            ".trellis-db-tools-btn:disabled{opacity:.65;cursor:default}"
        ].join("\n"); // NEW
        root.appendChild(style); // NEW
    } // NEW

    function createButton(label, onClick, primary) { // NEW
        const button = createEl("button", primary ? "trellis-db-tools-btn trellis-db-tools-btn-primary" : "trellis-db-tools-btn", label); // NEW
        button.type = "button"; // NEW
        button.addEventListener("click", onClick); // NEW
        return button; // NEW
    } // NEW

    function appendPath(container, label, value) { // NEW
        const line = createEl("div"); // NEW
        line.appendChild(createEl("strong", "", label + ": ")); // NEW
        line.appendChild(document.createTextNode(value || "[none]")); // NEW
        container.appendChild(line); // NEW
    } // NEW

    function renderResult(root, result) { // NEW
        clearNode(root); // NEW
        addStyles(root); // NEW
        root.appendChild(createEl("div", "trellis-db-tools-title", "Built-in database restored")); // NEW
        root.appendChild(createEl("div", "trellis-db-tools-status", "The local AppData Trellis database was overwritten with the built-in database. Reopen any active Trellis dialogs to read the restored database.")); // NEW
        const paths = createEl("div", "trellis-db-tools-status trellis-db-tools-paths"); // NEW
        appendPath(paths, "Restored DB", result && result.dbPath); // NEW
        appendPath(paths, "Backup", result && result.backupPath ? result.backupPath : "No previous AppData database existed"); // NEW
        appendPath(paths, "Built-in source", result && result.sourcePath); // NEW
        root.appendChild(paths); // NEW
    } // NEW

    function renderError(root, error) { // NEW
        clearNode(root); // NEW
        addStyles(root); // NEW
        root.appendChild(createEl("div", "trellis-db-tools-title", "Restore failed")); // NEW
        root.appendChild(createEl("div", "trellis-db-tools-status trellis-db-tools-error", error && error.message ? error.message : String(error || "Unknown restore error."))); // NEW
    } // NEW

    function buildRestoreDialog(ui) { // NEW
        const root = createEl("div", "trellis-db-tools"); // NEW
        addStyles(root); // NEW
        root.appendChild(createEl("div", "trellis-db-tools-title", ACTION_LABEL)); // NEW
        root.appendChild(createEl("div", "trellis-db-tools-status trellis-db-tools-danger", "This will replace the local AppData Trellis database with the built-in database. A timestamped backup of the current AppData database will be created first.")); // NEW
        root.appendChild(createEl("div", "trellis-db-tools-status", "This does not reload the current diagram. Reopen any active Trellis dialogs after the restore completes.")); // NEW

        const actions = createEl("div", "trellis-db-tools-actions"); // NEW
        const cancel = createButton("Cancel", function () { closeDialog(ui); }, false); // NEW
        const restore = createButton("Restore built-in database", function () { // NEW
            restore.disabled = true; // NEW
            cancel.disabled = true; // NEW
            restore.textContent = "Restoring..."; // NEW
            if (!window.trellisApp || typeof window.trellisApp.restoreBuiltInDatabase !== "function") { // NEW
                renderError(root, new Error("Trellis database restore bridge is not available.")); // NEW
                return; // NEW
            } // NEW
            window.trellisApp.restoreBuiltInDatabase().then(function (result) { // NEW
                renderResult(root, result || {}); // NEW
            }).catch(function (error) { // NEW
                renderError(root, error); // NEW
            }); // NEW
        }, true); // NEW
        actions.appendChild(cancel); // NEW
        actions.appendChild(restore); // NEW
        root.appendChild(actions); // NEW
        return root; // NEW
    } // NEW

    function install(ui) { // NEW
        if (!ui || !ui.actions || ui.__trellisDatabaseToolsInstalled) return; // NEW
        ui.__trellisDatabaseToolsInstalled = true; // NEW

        ui.actions.addAction(ACTION_ID, function () { // NEW
            ui.showDialog(buildRestoreDialog(ui), 560, 320, true, true); // NEW
        }); // NEW

        const action = ui.actions.get && ui.actions.get(ACTION_ID); // NEW
        if (action) action.label = ACTION_LABEL; // NEW

        if (ui.menus && ui.menus.get) { // NEW
            const extras = ui.menus.get("extras"); // NEW
            if (extras && !extras.__trellisDatabaseToolsPatched) { // NEW
                const oldFunct = extras.funct; // NEW
                extras.funct = function (menu, parent) { // NEW
                    if (typeof oldFunct === "function") oldFunct.apply(this, arguments); // NEW
                    ui.menus.addMenuItems(menu, ["-", ACTION_ID], parent); // NEW
                }; // NEW
                extras.__trellisDatabaseToolsPatched = true; // NEW
            } // NEW
        } // NEW
    } // NEW

    window.TrellisDatabaseTools = { // NEW
        install: install, // NEW
        _test: { buildRestoreDialog: buildRestoreDialog } // NEW
    }; // NEW

    Draw.loadPlugin(function (ui) { // NEW
        install(ui); // NEW
    }); // NEW
})();
