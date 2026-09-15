(function () {
    "use strict";

    const ACTION_ID = "trellisRestoreBuiltInDatabase";
    const ACTION_LABEL = "Restore Built-in Trellis Database...";
    const TRELLIS_DIALOG_Z = 2000000000;

    function createEl(tag, className, text) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        if (text != null) el.textContent = String(text);
        return el;
    }

    function clearNode(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
    }

    function closeDialog(ui) {
        if (ui && typeof ui.hideDialog === "function") ui.hideDialog();
    }

    function elevateTrellisDialog(ui) {
        const dlg = ui && ui.dialog;
        if (dlg && dlg.bg && dlg.bg.style) dlg.bg.style.zIndex = String(TRELLIS_DIALOG_Z - 1);
        if (dlg && dlg.container && dlg.container.style) dlg.container.style.zIndex = String(TRELLIS_DIALOG_Z);
    }

    function addStyles(root) {
        const style = createEl("style");
        style.textContent = [
            ".trellis-db-tools{font-family:Arial,sans-serif;color:#1f2933;padding:16px;box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:12px}",
            ".trellis-db-tools-title{font-size:18px;font-weight:700}",
            ".trellis-db-tools-status{padding:10px 12px;background:#f5f7fa;border:1px solid #d7dde5;border-radius:4px;line-height:1.4}",
            ".trellis-db-tools-danger{background:#fff7ed;border-color:#f59e0b}",
            ".trellis-db-tools-error{background:#fef2f2;border-color:#ef4444}",
            ".trellis-db-tools-warning{margin-top:6px;color:#b91c1c;font-weight:700}", // CHANGE
            ".trellis-db-tools-paths{font-size:12px;line-height:1.45;word-break:break-all}",
            ".trellis-db-tools-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:auto}",
            ".trellis-db-tools-btn{border:1px solid #6b7280;background:#fff;color:#111827;padding:7px 10px;border-radius:4px;cursor:pointer}",
            ".trellis-db-tools-btn-close{border-color:#b91c1c;color:#b91c1c}", // NEW
            ".trellis-db-tools-btn-close:hover{background:#fef2f2}", // NEW
            ".trellis-db-tools-btn-danger{border-color:#b91c1c;background:#b91c1c;color:#fff}", // CHANGE
            ".trellis-db-tools-btn-danger:hover{background:#991b1b;border-color:#991b1b}", // CHANGE
            ".trellis-db-tools-btn-neutral:hover{background:#f9fafb}",
            ".trellis-db-tools-btn:disabled{opacity:.65;cursor:default}"
        ].join("\n");
        root.appendChild(style);
    }

    function createButton(label, onClick, variant) {
        const semanticVariant = variant || "neutral";
        const button = createEl("button", "trellis-db-tools-btn trellis-db-tools-btn-" + semanticVariant, label);
        button.type = "button";
        if (window.Trellis && window.Trellis.ui && typeof window.Trellis.ui.applyButtonStyle === "function") window.Trellis.ui.applyButtonStyle(button, semanticVariant);
        else { // NEW
            button.setAttribute("data-trellis-button-variant", semanticVariant); // NEW
            if (semanticVariant === "danger") { button.style.background = "#b91c1c"; button.style.borderColor = "#b91c1c"; button.style.color = "#fff"; } // NEW
            else if (semanticVariant === "close") { button.style.borderColor = "#b91c1c"; button.style.color = "#b91c1c"; } // NEW
        } // NEW
        button.addEventListener("click", onClick);
        return button;
    }

    function appendPath(container, label, value) {
        const line = createEl("div");
        line.appendChild(createEl("strong", "", label + ": "));
        line.appendChild(document.createTextNode(value || "[none]"));
        container.appendChild(line);
    }

    function formatDbSummary(info) {
        if (!info || !info.exists) return "missing";
        const visible = Number(info.visiblePlantCount || 0);
        const total = Number(info.plantCount || 0);
        const modified = info.modifiedAt ? new Date(info.modifiedAt).toLocaleString() : "unknown modified time";
        return `${visible} visible crops / ${total} plants, modified ${modified}`; // CHANGE: expose the catalog size before restore.
    }

    function renderDatabaseInfo(container, info) {
        clearNode(container);
        const live = info && info.live;
        const builtin = info && info.builtin;
        appendPath(container, "Live AppData", formatDbSummary(live));
        appendPath(container, "Built-in source", formatDbSummary(builtin));
        appendPath(container, "Live path", live && live.path);
        appendPath(container, "Built-in path", builtin && builtin.path);
        const liveVisible = Number(live && live.visiblePlantCount || 0);
        const builtinVisible = Number(builtin && builtin.visiblePlantCount || 0);
        const liveTime = live && live.modifiedAt ? Date.parse(live.modifiedAt) : 0;
        const builtinTime = builtin && builtin.modifiedAt ? Date.parse(builtin.modifiedAt) : 0;
        if (liveVisible > 0 && builtinVisible < liveVisible) {
            container.appendChild(createEl("div", "trellis-db-tools-warning", "Warning: the built-in source has fewer visible crops than the live database.")); // CHANGE
        } else if (liveTime > 0 && builtinTime > 0 && builtinTime < liveTime) {
            container.appendChild(createEl("div", "trellis-db-tools-warning", "Warning: the built-in source is older than the live database.")); // CHANGE
        }
        if ((live && live.error) || (builtin && builtin.error)) {
            container.appendChild(createEl("div", "trellis-db-tools-warning", "Some database metadata could not be read.")); // CHANGE
        }
    }

    function loadDatabaseInfo(container) {
        if (!window.trellisApp || typeof window.trellisApp.getDatabaseInfo !== "function") {
            container.textContent = "Database metadata is not available in this build.";
            return;
        }
        window.trellisApp.getDatabaseInfo().then(function (info) {
            renderDatabaseInfo(container, info || {});
        }).catch(function (error) {
            container.textContent = error && error.message ? error.message : String(error || "Database metadata could not be read.");
        });
    }

    function renderResult(root, result) {
        clearNode(root);
        addStyles(root);
        root.appendChild(createEl("div", "trellis-db-tools-title", "Built-in database restored"));
        root.appendChild(createEl("div", "trellis-db-tools-status", "The local AppData Trellis database was overwritten with the built-in database. Reopen any active Trellis dialogs to read the restored database."));
        const paths = createEl("div", "trellis-db-tools-status trellis-db-tools-paths");
        appendPath(paths, "Restored DB", result && result.dbPath);
        appendPath(paths, "Backup", result && result.backupPath ? result.backupPath : "No previous AppData database existed");
        appendPath(paths, "Built-in source", result && result.sourcePath);
        root.appendChild(paths);
    }

    function renderError(root, error) {
        clearNode(root);
        addStyles(root);
        root.appendChild(createEl("div", "trellis-db-tools-title", "Restore failed"));
        root.appendChild(createEl("div", "trellis-db-tools-status trellis-db-tools-error", error && error.message ? error.message : String(error || "Unknown restore error.")));
    }

    function buildRestoreDialog(ui) {
        const root = createEl("div", "trellis-db-tools");
        addStyles(root);
        root.appendChild(createEl("div", "trellis-db-tools-title", ACTION_LABEL));
        root.appendChild(createEl("div", "trellis-db-tools-status trellis-db-tools-danger", "This will replace the local AppData Trellis database with the built-in database. A timestamped backup of the current AppData database will be created first."));
        root.appendChild(createEl("div", "trellis-db-tools-status", "This does not reload the current diagram. Reopen any active Trellis dialogs after the restore completes."));
        const databaseInfo = createEl("div", "trellis-db-tools-status trellis-db-tools-paths", "Loading database details...");
        root.appendChild(databaseInfo);
        loadDatabaseInfo(databaseInfo); // CHANGE: show live/source counts before destructive restore.

        const actions = createEl("div", "trellis-db-tools-actions");
        const cancel = createButton("Cancel", function () { closeDialog(ui); }, "neutral");
        const restore = createButton("Restore built-in database", function () {
            restore.disabled = true;
            cancel.disabled = true;
            restore.textContent = "Restoring...";
            if (!window.trellisApp || typeof window.trellisApp.restoreBuiltInDatabase !== "function") {
                renderError(root, new Error("Trellis database restore bridge is not available."));
                return;
            }
            window.trellisApp.restoreBuiltInDatabase().then(function (result) {
                try { window.dispatchEvent(new window.CustomEvent("trellis:database-restored", { detail: result || {} })); } catch (_) { } // CHANGE: invalidate open crop caches after restore.
                renderResult(root, result || {});
            }).catch(function (error) {
                renderError(root, error);
            });
        }, "danger");
        actions.appendChild(cancel);
        actions.appendChild(restore);
        root.appendChild(actions);
        return root;
    }

    function install(ui) {
        if (!ui || !ui.actions || ui.__trellisDatabaseToolsInstalled) return;
        ui.__trellisDatabaseToolsInstalled = true;

        ui.actions.addAction(ACTION_ID, function () {
            ui.showDialog(buildRestoreDialog(ui), 560, 320, true, true);
            elevateTrellisDialog(ui);
        });

        const action = ui.actions.get && ui.actions.get(ACTION_ID);
        if (action) action.label = ACTION_LABEL;

        if (ui.menus && ui.menus.get) {
            const extras = ui.menus.get("extras");
            if (extras && !extras.__trellisDatabaseToolsPatched) {
                const oldFunct = extras.funct;
                extras.funct = function (menu, parent) {
                    if (typeof oldFunct === "function") oldFunct.apply(this, arguments);
                    ui.menus.addMenuItems(menu, ["-", ACTION_ID], parent);
                };
                extras.__trellisDatabaseToolsPatched = true;
            }
        }
    }

    window.TrellisDatabaseTools = {
        install: install,
        _test: { buildRestoreDialog: buildRestoreDialog }
    };

    Draw.loadPlugin(function (ui) {
        install(ui);
    });
})();
